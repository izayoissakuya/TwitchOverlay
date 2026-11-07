'use strict';

// One-time Twitch Helix authorization helper for Get Chatters.
// Reads twitch-api-credentials.json + config.json from this project folder.
// Writes twitch-api-token.json. Requires Node.js 18+ (uses built-in fetch).

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const ROOT = __dirname;
const credentialsPath = path.join(ROOT, 'twitch-api-credentials.json');
const configPath = path.join(ROOT, 'config.json');
const tokenPath = path.join(ROOT, 'twitch-api-token.json');
const REDIRECT_URI = 'http://localhost:8787/callback';
const PORT = 8787;
const REQUIRED_SCOPE = 'moderator:read:chatters';

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${label}: ${error.message}`);
  }
}

function saveJsonSafely(filePath, value) {
  const tempPath = filePath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  try { fs.chmodSync(tempPath, 0o600); } catch {}
  fs.renameSync(tempPath, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch {}
}

function sendPage(res, title, message, status = 200) {
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:16px system-ui;background:#15151d;color:#f4f3fa;padding:32px"><main style="max-width:620px;margin:auto;background:#222333;padding:24px;border-radius:14px"><h2>${title}</h2><p>${message}</p><p>You can close this tab and return to the terminal.</p></main></body></html>`;
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

async function main() {
  const credentials = readJson(credentialsPath, 'twitch-api-credentials.json');
  const config = readJson(configPath, 'config.json');
  const clientId = String(credentials.clientId || '').trim();
  const clientSecret = String(credentials.clientSecret || '').trim();
  const channel = String(config.channel || '').trim().replace(/^#/, '').toLowerCase();

  if (!clientId || !clientSecret) throw new Error('twitch-api-credentials.json must contain clientId and clientSecret.');
  if (!/^[a-z0-9_]{1,25}$/.test(channel)) throw new Error('config.json must contain a valid channel login.');

  const state = crypto.randomBytes(24).toString('hex');
  let completed = false;
  let timeout;

  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, REDIRECT_URI);
    if (requestUrl.pathname !== '/callback') {
      sendPage(res, 'Twitch authorization helper', 'Waiting for Twitch authorization.');
      return;
    }

    if (requestUrl.searchParams.get('state') !== state) {
      sendPage(res, 'Authorization check failed', 'The state value did not match. Close this tab and run authorize.js again.', 400);
      return;
    }
    if (requestUrl.searchParams.has('error')) {
      const error = requestUrl.searchParams.get('error_description') || requestUrl.searchParams.get('error');
      sendPage(res, 'Twitch authorization cancelled', `Twitch returned: ${error}`, 400);
      return;
    }
    const code = requestUrl.searchParams.get('code');
    if (!code) {
      sendPage(res, 'Authorization code missing', 'Twitch did not return an authorization code.', 400);
      return;
    }
    if (completed) {
      sendPage(res, 'Already completed', 'Authorization has already been saved.');
      return;
    }
    completed = true;

    try {
      const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: REDIRECT_URI
        })
      });
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok || !tokenData.access_token || !tokenData.refresh_token) {
        throw new Error(`Twitch token exchange failed (HTTP ${tokenResponse.status}). Check the Client ID/Secret and redirect URL in the Twitch Developer Console.`);
      }

      const validateResponse = await fetch('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: `OAuth ${tokenData.access_token}` }
      });
      const validated = await validateResponse.json();
      if (!validateResponse.ok || !validated.user_id || !validated.login) {
        throw new Error('Twitch could not validate the newly issued access token.');
      }
      if (String(validated.client_id) !== clientId) {
        throw new Error('The token belongs to a different Twitch Client ID than twitch-api-credentials.json.');
      }
      const scopes = Array.isArray(validated.scopes) ? validated.scopes : (Array.isArray(tokenData.scope) ? tokenData.scope : []);
      if (!scopes.includes(REQUIRED_SCOPE)) {
        throw new Error(`The authorization did not include ${REQUIRED_SCOPE}. Run the authorization again and approve this permission.`);
      }

      // This project currently requires the authorized Helix user to be the channel broadcaster.
      if (String(validated.login).toLowerCase() !== channel) {
        throw new Error(`You authorized @${validated.login}, but config.json is set to #${channel}. Sign into the broadcaster account @${channel} and run authorize.js again.`);
      }

      const userResponse = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(channel)}`, {
        headers: { 'Client-Id': clientId, Authorization: `Bearer ${tokenData.access_token}` }
      });
      const userData = await userResponse.json();
      if (!userResponse.ok || !Array.isArray(userData.data) || !userData.data[0]?.id) {
        throw new Error(`Could not look up broadcaster @${channel} (HTTP ${userResponse.status}).`);
      }
      const broadcasterId = String(userData.data[0].id);
      const moderatorId = String(validated.user_id);
      if (moderatorId !== broadcasterId) {
        throw new Error('The authorized user ID does not match the broadcaster ID. Sign into the channel owner account and try again.');
      }

      const output = {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresIn: Number(tokenData.expires_in || 0),
        obtainedAt: new Date().toISOString(),
        scopes,
        clientId,
        authorizedUserId: String(validated.user_id),
        authorizedUserLogin: String(validated.login).toLowerCase(),
        broadcasterId,
        moderatorId
      };
      saveJsonSafely(tokenPath, output);
      sendPage(res, 'Twitch authorization successful', `The Helix token for @${channel} was saved locally to twitch-api-token.json. The access and refresh tokens are not displayed.`);
      console.log(`\nSuccess: Helix authorization saved for @${channel}.`);
      console.log(`Scope confirmed: ${REQUIRED_SCOPE}`);
      console.log('Next: stop the overlay server if it is running, then start it again with npm start.');
      clearTimeout(timeout);
      setTimeout(() => server.close(), 700);
    } catch (error) {
      completed = false;
      console.error('\nAuthorization failed:', error.message);
      sendPage(res, 'Twitch authorization failed', error.message, 400);
      clearTimeout(timeout);
      setTimeout(() => server.close(), 3000);
    }
  });

  server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Close the other process using ${REDIRECT_URI} and try again.`);
    } else {
      console.error('Local callback server error:', error.message);
    }
    process.exitCode = 1;
  });

  server.listen(PORT, '127.0.0.1', () => {
    const authorizeUrl = new URL('https://id.twitch.tv/oauth2/authorize');
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', REQUIRED_SCOPE);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('force_verify', 'true');

    console.log('Twitch Helix authorization helper is ready.');
    console.log(`Channel configured in config.json: #${channel}`);
    console.log(`Redirect URL (must be registered in Twitch Developer Console): ${REDIRECT_URI}`);
    console.log('A browser window will open. Sign in as the channel owner and approve moderator:read:chatters.');
    console.log('If the browser does not open, copy this URL into your browser:');
    console.log(authorizeUrl.toString());

    if (process.platform === 'win32') {
      // Do not pass the URL through cmd.exe: its '&' characters can be treated
      // as command separators, truncating the OAuth query string.
      execFile('rundll32.exe', ['url.dll,FileProtocolHandler', authorizeUrl.toString()], { windowsHide: true }, error => {
        if (error) console.error('Could not open the browser automatically. Copy the complete URL printed above into your browser.');
      });
    } else if (process.platform === 'darwin') {
      execFile('open', [authorizeUrl.toString()], error => {
        if (error) console.error('Could not open the browser automatically. Copy the complete URL printed above into your browser.');
      });
    } else {
      execFile('xdg-open', [authorizeUrl.toString()], error => {
        if (error) console.error('Could not open the browser automatically. Copy the complete URL printed above into your browser.');
      });
    }

    timeout = setTimeout(() => {
      console.error('\nTimed out waiting for Twitch authorization. Run node authorize.js again.');
      server.close();
    }, 5 * 60 * 1000);
  });
}

main().catch(error => {
  console.error('\nCannot start Twitch authorization helper:', error.message);
  console.error('Check that authorize.js is in the same folder as config.json and twitch-api-credentials.json.');
  process.exitCode = 1;
});

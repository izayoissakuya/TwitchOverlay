'use strict';
// Combined local static web server + Twitch IRC bridge + Helix Get Chatters reconciliation.
// Keep config.json, twitch-api-credentials.json, and twitch-api-token.json private.
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const root = __dirname;
const botBanListPath = path.join(root, 'bot-ban-list.json');
const configPath = path.join(root, 'config.json');
let config;
try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
catch { console.error('Missing config.json. Copy config.example.json to config.json and fill in your Twitch login and token.'); process.exit(1); }
let channel = String(config.channel || 'XXSefaYT').replace(/^#/, '').toLowerCase();
let login = String(config.login || '').toLowerCase();
let token = String(config.oauthToken || '').trim().replace(/^oauth:/i, '');
if (!/^[a-z0-9_]{1,25}$/.test(channel)) { console.error('Check config.json: channel is required.'); process.exit(1); }
const apiTokenPath = path.join(root, 'twitch-api-token.json');
const apiCredentialsPath = path.join(root, 'twitch-api-credentials.json');
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.txt':'text/plain; charset=utf-8', '.woff':'font/woff', '.woff2':'font/woff2' };
let ircReady = false;
let irc = null;
let retry = null;
let apiTimer = null;
let apiBusy = false;

function loadBotBanList() {
  try {
    const parsed = JSON.parse(fs.readFileSync(botBanListPath, 'utf8'));
    const names = Array.isArray(parsed) ? parsed : parsed.usernames;
    if (!Array.isArray(names)) return new Set();
    return new Set(names.map(name => String(name).trim().replace(/^@/, '').toLowerCase()).filter(name => /^[a-z0-9_]{1,25}$/.test(name)));
  } catch {
    return new Set();
  }
}
function isBannedBot(username) {
  return loadBotBanList().has(String(username || '').trim().replace(/^@/, '').toLowerCase());
}
let pendingTwitchOAuthState = null;
function readTwitchCredentials() {
  try { const c=JSON.parse(fs.readFileSync(apiCredentialsPath,'utf8')); if(c.clientId&&c.clientSecret)return c; } catch {}
  return null;
}
function sendJson(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function isLocalRequest(req){const remote=req.socket.remoteAddress||'';return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote);}
function readRequestJson(req,res,maxBytes=12000){return new Promise((resolve,reject)=>{let body='';req.on('data',chunk=>{body+=chunk;if(body.length>maxBytes){sendJson(res,413,{ok:false,error:'Request too large.'});reject(new Error('Request too large.'));req.destroy();}});req.on('end',()=>{try{resolve(JSON.parse(body||'{}'));}catch{sendJson(res,400,{ok:false,error:'Invalid JSON.'});reject(new Error('Invalid JSON.'));}});req.on('error',reject);});}
function saveTwitchCredentials(clientId,clientSecret){const tmp=apiCredentialsPath+'.tmp';fs.writeFileSync(tmp,JSON.stringify({clientId,clientSecret},null,2)+'\n',{mode:0o600});try{fs.chmodSync(tmp,0o600);}catch{}fs.renameSync(tmp,apiCredentialsPath);}
function saveBotConfig(nextLogin,nextToken){
  const updated={...config,login:nextLogin,oauthToken:nextToken};
  const tmp=configPath+'.tmp';fs.writeFileSync(tmp,JSON.stringify(updated,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,configPath);config=updated;
  login=String(nextLogin||'').toLowerCase();token=String(nextToken||'').replace(/^oauth:/i,'');
}
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(url.parse(req.url).pathname || '/');
  if((pathname==='/api/setup/status'||pathname==='/api/setup/save')&&!isLocalRequest(req)){sendJson(res,403,{ok:false,error:'Setup is available only on this computer.'});return;}
  if(req.method==='GET'&&pathname==='/api/setup/status'){
    const creds=readTwitchCredentials();sendJson(res,200,{ok:true,configured:!!creds,clientIdConfigured:!!(creds&&creds.clientId),secretConfigured:!!(creds&&creds.clientSecret),channel});return;
  }
  if(req.method==='POST'&&pathname==='/api/setup/save'){
    (async()=>{try{
      const data=await readRequestJson(req,res);if(res.writableEnded)return;
      const clientId=String(data.clientId||'').trim();const clientSecret=String(data.clientSecret||'').trim();const nextChannel=String(data.channel||'').trim().replace(/^#/,'').toLowerCase();
      if(!/^[A-Za-z0-9]{10,80}$/.test(clientId))throw new Error('Enter a valid Twitch Client ID.');
      if(clientSecret.length<10||clientSecret.length>300)throw new Error('Enter a valid Twitch Client Secret.');
      if(!/^[a-z0-9_]{1,25}$/.test(nextChannel))throw new Error('Enter a valid Twitch channel login (letters, numbers, underscores; max 25 characters).');
      saveTwitchCredentials(clientId,clientSecret);
      const previousChannel=channel;channel=nextChannel;config={...config,channel:nextChannel};
      const tmp=configPath+'.tmp';fs.writeFileSync(tmp,JSON.stringify(config,null,2)+'\n',{mode:0o600});try{fs.chmodSync(tmp,0o600);}catch{}fs.renameSync(tmp,configPath);
      if(previousChannel!==nextChannel){clearTimeout(retry);clearInterval(apiTimer);apiTimer=null;apiToken=null;apiCredentials=null;if(irc){try{irc.removeAllListeners();irc.close();}catch{}irc=null;}ircReady=false;setTimeout(connectIRC,400);}
      sendJson(res,200,{ok:true,configured:true,channel,restartRequired:false,channelChanged:previousChannel!==nextChannel});
    }catch(e){if(!res.writableEnded)sendJson(res,400,{ok:false,error:e.message||'Could not save Twitch setup.'});}})();return;
  }
  if(req.method==='GET'&&pathname==='/api/twitch/status'){
    const linked=!!(login&&token);sendJson(res,200,{ok:true,linked,username:linked?login:null,channel,connected:!!ircReady});return;
  }
  if((pathname==='/api/twitch/link'||pathname==='/api/twitch/unlink')&&!isLocalRequest(req)){sendJson(res,403,{ok:false,error:'Twitch account management is available only on this computer.'});return;}
  if(req.method==='GET'&&pathname==='/api/twitch/link'){
    const creds=readTwitchCredentials();if(!creds){sendJson(res,500,{ok:false,error:'Missing twitch-api-credentials.json with clientId and clientSecret.'});return;}
    pendingTwitchOAuthState=require('crypto').randomBytes(24).toString('hex');
    const redirect='http://localhost:8081/auth/twitch/callback';
    const auth=new URL('https://id.twitch.tv/oauth2/authorize');
    auth.searchParams.set('client_id',creds.clientId);auth.searchParams.set('redirect_uri',redirect);auth.searchParams.set('response_type','code');auth.searchParams.set('scope','chat:read chat:edit');auth.searchParams.set('state',pendingTwitchOAuthState);
    res.writeHead(302,{Location:auth.toString(),'Cache-Control':'no-store'});res.end();return;
  }
  if(req.method==='GET'&&pathname==='/auth/twitch/callback'){
    (async()=>{try{
      const q=url.parse(req.url,true).query;const creds=readTwitchCredentials();
      if(!creds||!pendingTwitchOAuthState||q.state!==pendingTwitchOAuthState)throw new Error('OAuth state check failed. Please try linking again.');
      pendingTwitchOAuthState=null;if(q.error)throw new Error(String(q.error_description||q.error));if(!q.code)throw new Error('Twitch did not return an authorization code.');
      const redirect='http://localhost:8081/auth/twitch/callback';
      const tokenResponse=await fetch('https://id.twitch.tv/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:creds.clientId,client_secret:creds.clientSecret,code:String(q.code),grant_type:'authorization_code',redirect_uri:redirect})});
      const td=await tokenResponse.json();if(!tokenResponse.ok||!td.access_token)throw new Error('Twitch token exchange failed (HTTP '+tokenResponse.status+').');
      const validate=await fetch('https://id.twitch.tv/oauth2/validate',{headers:{Authorization:'OAuth '+td.access_token}});const vd=await validate.json();
      if(!validate.ok||!vd.login||!Array.isArray(vd.scopes)||!vd.scopes.includes('chat:read'))throw new Error('Could not verify Twitch account or chat:read permission.');
      saveBotConfig(vd.login,td.access_token);if(irc){try{irc.removeAllListeners();irc.close();}catch{}irc=null;}clearTimeout(retry);setTimeout(connectIRC,400);
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end('<!doctype html><meta charset="utf-8"><title>Twitch linked</title><body style="font:16px system-ui;background:#15151b;color:white;padding:32px"><h2>✓ Twitch account linked</h2><p>@'+vd.login+' is now the bot account. You can close this tab and return to Demo Mode.</p><script>setTimeout(()=>window.close(),1800)</script></body>');
    }catch(e){sendJson(res,400,{ok:false,error:e.message});}})();return;
  }
  if(req.method==='POST'&&pathname==='/api/twitch/unlink'){
    saveBotConfig('','');clearTimeout(retry);clearInterval(apiTimer);apiTimer=null;ircReady=false;if(irc){try{irc.removeAllListeners();irc.close();}catch{}irc=null;}
    broadcast({type:'status',message:'Twitch bot account unlinked'});sendJson(res,200,{ok:true,linked:false});return;
  }

  // Demo-only character discovery: enumerate direct normal asset folders on demand.
  if (req.method === 'GET' && pathname === '/api/characters') {
    const remote = req.socket.remoteAddress || '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
      res.writeHead(403, {'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({error:'Available only on this computer.'})); return;
    }
    try {
      const assetsRoot = path.resolve(root, 'assets');
      const characters = fs.existsSync(assetsRoot) ? fs.readdirSync(assetsRoot, {withFileTypes:true})
        .filter(entry => entry.isDirectory() && entry.name !== 'Special Avatars' && !entry.name.startsWith('.') &&
          fs.existsSync(path.join(assetsRoot, entry.name, 'idle.png')))
        .map(entry => entry.name).sort((a,b) => a.localeCompare(b)) : [];
      const specialRoot = path.resolve(assetsRoot, 'Special Avatars');
      const specialCharacters = fs.existsSync(specialRoot) ? fs.readdirSync(specialRoot, {withFileTypes:true})
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') &&
          fs.existsSync(path.join(specialRoot, entry.name, 'idle.png')))
        .map(entry => entry.name).sort((a,b) => a.localeCompare(b)) : [];
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'});
      res.end(JSON.stringify({ok:true, characters, specialCharacters}));
    } catch (error) { res.writeHead(500, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify({error:'Could not scan character folders: ' + error.message})); }
    return;
  }
  // Local-only folder creator used by Demo Mode. Type selects normal or special-avatars root.
  if (req.method === 'POST' && pathname === '/api/characters') {
    const remote = req.socket.remoteAddress || '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
      res.writeHead(403, {'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({error:'Available only on this computer.'})); return;
    }
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 8192) { res.writeHead(413, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify({error:'Request too large.'})); req.destroy(); }
    });
    req.on('end', () => {
      let data;
      try { data = JSON.parse(body || '{}'); } catch { res.writeHead(400, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify({error:'Invalid JSON.'})); return; }
      const folder = String(data.name || '').trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, '_');
      const type = ['special', 'flying'].includes(data.type) ? data.type : 'normal';
      if (!folder || folder.length > 48 || /^\.+$/.test(folder)) { res.writeHead(400, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify({error:'Enter a valid name up to 48 characters.'})); return; }
      const assetsRoot = path.resolve(root, 'assets');
      const baseRoot = type === 'special' ? path.resolve(assetsRoot, 'Special Avatars') : assetsRoot;
      const target = path.resolve(baseRoot, folder);
      if (!target.startsWith(baseRoot + path.sep)) { res.writeHead(400, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify({error:'Invalid folder name.'})); return; }
      try {
        const existed = fs.existsSync(target);
        fs.mkdirSync(path.join(target, 'walk'), {recursive:true});
        fs.mkdirSync(path.join(target, 'conversation'), {recursive:true});
        fs.mkdirSync(path.join(target, 'emotes'), {recursive:true});
        if (type === 'special') { fs.mkdirSync(path.join(target, 'fly'), {recursive:true}); fs.mkdirSync(path.join(target, 'landing'), {recursive:true}); }
        if (type === 'flying') { for (const dir of ['takeoff', 'fly', 'landing', 'falling']) fs.mkdirSync(path.join(target, dir), {recursive:true}); }
        const readmePath = path.join(target, 'README.txt');
        if (!fs.existsSync(readmePath)) fs.writeFileSync(readmePath,
`Character asset folder: ${folder}\nType: ${type}\n\nAdd transparent PNG sprites here:\n- idle.png (standing pose)\n- walk/frame_01.png through frame_06.png (six walking frames)\n- conversation/frame_01.png through frame_06.png (optional six talking frames)\n- conversation/talk.png (optional single talking pose fallback)\n- emotes/emote_01.png through emote_08.png (optional full-character emotes)\n${type === 'special' || type === 'flying' ? '- takeoff/frame_01.png through frame_06.png, fly/frame_01.png through frame_06.png, and landing/frame_01.png through frame_06.png (optional flight animation)\n' : ''}${type === 'flying' ? '- falling/frame_01.png (optional falling/raid entrance sprite)\n' : ''}\nKeep each animation frame aligned on the same transparent canvas.\nFolder creation alone does not register a new character in app.js; add the character to the roster or SPECIAL_AVATARS list to use it in the overlay.\n`);
        const rel = type === 'special' ? `assets/Special Avatars/${folder}/` : `assets/${folder}/`;
        res.writeHead(existed ? 200 : 201, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'});
        res.end(JSON.stringify({ok:true, created:!existed, folder, type, path:rel}));
      } catch (error) { res.writeHead(500, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify({error:'Folder creation failed: ' + error.message})); }
    });
    return;
  }
  if (pathname === '/health') { res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify({ok:true,channel,irc:ircReady})); return; }
  if (pathname === '/bridge') { res.writeHead(426, {'Content-Type':'text/plain'}); res.end('WebSocket endpoint'); return; }
  let requested = pathname === '/' ? '/index.html' : pathname;
  const file = path.resolve(root, '.' + requested);
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control':'no-cache'});
    fs.createReadStream(file).pipe(res);
  });
});
const wss = new WebSocket.Server({server, path:'/bridge'});
const clients = new Set();
// Canonical current chat roster. IRC supplies quick JOIN/PART events; Helix periodically repairs missed events.
const activeViewers = new Map();
// Persistent viewer-selected regular avatars. Stored locally and never served as a static file.
const avatarPreferencesPath = path.join(root, 'avatar-preferences.json');
let avatarPreferences = Object.create(null);
try {
  if (fs.existsSync(avatarPreferencesPath)) {
    const parsed = JSON.parse(fs.readFileSync(avatarPreferencesPath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [username, character] of Object.entries(parsed)) {
        if (/^[a-z0-9_]{1,25}$/.test(username) && typeof character === 'string' && character.trim()) avatarPreferences[username.toLowerCase()] = character.trim().slice(0, 48);
      }
    }
  }
} catch (error) { console.error('Could not load avatar-preferences.json; starting with an empty preference list:', error.message); }
function saveAvatarPreferences() {
  const tempPath = avatarPreferencesPath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(avatarPreferences, null, 2) + '\n', 'utf8');
  fs.renameSync(tempPath, avatarPreferencesPath);
}
function normalizedCharacterName(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
const specialAvatarUsersPath = path.join(root, 'special-avatar-users.json');
const defaultSpecialAvatarUsers = [
  'XXSefaYT',
  'n3koyama',
  'lzayoiisakuya',
  'CapAimex',
  'EmikoAi_',
  'MKOmega',
  'Lifhee',
  'alicepuddingyui',
  'Yukzz___'
];
let specialAvatarUsers = [...defaultSpecialAvatarUsers];
try {
  if (fs.existsSync(specialAvatarUsersPath)) {
    const parsed = JSON.parse(fs.readFileSync(specialAvatarUsersPath, 'utf8'));
    if (Array.isArray(parsed)) {
      const validUsers = parsed
        .filter(name => typeof name === 'string')
        .map(name => name.trim())
        .filter(name => /^[a-zA-Z0-9_]{1,25}$/.test(name));
      if (validUsers.length || parsed.length === 0) specialAvatarUsers = [...new Set(validUsers.map(name => name.toLowerCase()))];
    } else {
      console.error('special-avatar-users.json must contain a JSON array of Twitch usernames; using built-in list.');
    }
  }
} catch (error) {
  console.error('Could not read special-avatar-users.json; using built-in list:', error.message);
}
function isReservedSpecialUsername(username) {
  const key = String(username || '').trim().toLowerCase();
  return specialAvatarUsers.includes(key);
}
function isKnownNormalCharacter(requested) {
  const wanted = normalizedCharacterName(requested);
  if (!wanted || /^special/.test(wanted)) return false;
  // These display-name aliases match the app roster; asset-folder names allow future discovered characters too.
  const knownNames = ['Eika','Yvtte','Chiyo','Yugiri','Ming','Fragrance','Cielle','Audrey','Kanami','Celestia','Fuchia','Michele','Maddalena','Mara'];
  if (knownNames.some(name => normalizedCharacterName(name) === wanted)) return true;
  try {
    const assetsRoot = path.join(root, 'assets');
    return fs.readdirSync(assetsRoot, {withFileTypes:true}).some(entry => entry.isDirectory() && entry.name !== 'Special Avatars' && !entry.name.startsWith('.') && normalizedCharacterName(entry.name) === wanted);
  } catch { return false; }
}
function decodeIrcTagValue(value) {
  return String(value || '').replace(/\\([:\\snr])/g, (_, code) => ({
    ':': ';',
    s: ' ',
    '\\': '\\',
    r: '\r',
    n: '\n'
  }[code] ?? code));
}

function stripChatAction(rawMessage) {
  const value = String(rawMessage || '');
  if (value.startsWith('\u0001ACTION ')) {
    return value.slice(8).replace(/\u0001$/, '');
  }
  return value.replace(/\u0001/g, '');
}
// Twitch emote tag format: emoteId:start-end,start-end/anotherId:start-end
// The wire positions are zero-based and inclusive. Array.from() keeps them
// aligned with Unicode code points instead of JavaScript UTF-16 code units.
function parseTwitchEmoteTag(tagValue) {
  const result = [];
  for (const group of String(tagValue || '').split('/')) {
    const colon = group.indexOf(':');
    if (colon <= 0) continue;
    const id = group.slice(0, colon);
    if (!/^[0-9]+(?:_[A-Za-z0-9]+)?$/.test(id)) continue;

    for (const rangeText of group.slice(colon + 1).split(',')) {
      const match = rangeText.match(/^(\d+)-(\d+)$/);
      if (!match) continue;
      const start = Number(match[1]);
      const end = Number(match[2]);
      if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end >= start) {
        result.push({ id, start, end });
      }
    }
  }
  return result.sort((a, b) => a.start - b.start || a.end - b.end);
}
function broadcast(data) { const msg=JSON.stringify(data); for (const c of clients) if(c.readyState===WebSocket.OPEN)c.send(msg); }
function setViewer(username, present, source='IRC') {
  if (!username || !/^[a-zA-Z0-9_]{1,25}$/.test(username) || username.toLowerCase() === login || isBannedBot(username)) return;
  const key = username.toLowerCase();
  if (present) {
    if (!activeViewers.has(key)) { activeViewers.set(key, username); broadcast({type:'join',username}); if (avatarPreferences[key]) broadcast({type:'avatarChange',username,character:avatarPreferences[key],isVip:false,saved:true}); console.log(`${source} JOIN ${username}`); }
    else activeViewers.set(key, username);
  } else if (activeViewers.has(key)) {
    const existing = activeViewers.get(key); activeViewers.delete(key); broadcast({type:'part',username:existing}); console.log(`${source} PART ${existing}`);
  }
}
wss.on('connection', ws => {
  clients.add(ws);
  ws.send(JSON.stringify({type:'status',message:ircReady?'connected to Twitch':'waiting for Twitch IRC'}));
  ws.send(JSON.stringify({type:'snapshot', usernames:[...activeViewers.values()]}));
  ws.send(JSON.stringify({type:'avatarPreferences', preferences:avatarPreferences}));
  ws.on('close',()=>clients.delete(ws));
});

// Load the separate Helix OAuth token created by node authorize.js. No token is logged or served.
let apiToken = null, apiCredentials = null;
try {
  if (fs.existsSync(apiTokenPath) && fs.existsSync(apiCredentialsPath)) {
    apiToken = JSON.parse(fs.readFileSync(apiTokenPath, 'utf8'));
    apiCredentials = JSON.parse(fs.readFileSync(apiCredentialsPath, 'utf8'));
    if (!apiToken.accessToken || !apiToken.refreshToken || !apiToken.broadcasterId || !apiToken.moderatorId || !apiCredentials.clientId || !apiCredentials.clientSecret) throw new Error('Required fields are missing');
    if (String(apiToken.authorizedUserLogin || '').toLowerCase() !== channel) {
      console.error(`Helix chatters sync disabled: authorized account is @${apiToken.authorizedUserLogin || 'unknown'}, but configured channel is #${channel}. Re-run authorize.js while signed into the broadcaster account.`);
      apiToken = null; apiCredentials = null;
    } else console.log('Helix Get Chatters sync enabled; the API will reconcile chat membership every 60 seconds.');
  } else console.log('Helix sync not configured (twitch-api-token.json or twitch-api-credentials.json missing); IRC-only mode.');
} catch (e) { console.error('Helix sync disabled: could not read API setup files. Check them locally and keep them private.'); apiToken = null; apiCredentials = null; }
function saveApiToken() { fs.writeFileSync(apiTokenPath, JSON.stringify(apiToken, null, 2) + '\n', {mode:0o600}); }
async function refreshApiToken() {
  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'refresh_token', refresh_token:apiToken.refreshToken, client_id:apiCredentials.clientId, client_secret:apiCredentials.clientSecret})
  });
  const data = await response.json();
  if (!response.ok || !data.access_token || !data.refresh_token) throw new Error(`OAuth refresh failed (HTTP ${response.status})`);
  apiToken.accessToken = data.access_token; apiToken.refreshToken = data.refresh_token;
  apiToken.expiresIn = data.expires_in || apiToken.expiresIn; apiToken.obtainedAt = new Date().toISOString();
  apiToken.scopes = data.scope || apiToken.scopes;
  saveApiToken();
}
async function helixGetChatters() {
  // Refresh before expiry, leaving a five-minute margin.
  const ageSeconds = (Date.now() - Date.parse(apiToken.obtainedAt || 0)) / 1000;
  if (!Number.isFinite(ageSeconds) || ageSeconds > Number(apiToken.expiresIn || 0) - 300) await refreshApiToken();
  async function requestAll() {
    const names = new Map(); let cursor = '';
    do {
      const u = new URL('https://api.twitch.tv/helix/chat/chatters');
      u.searchParams.set('broadcaster_id', apiToken.broadcasterId);
      u.searchParams.set('moderator_id', apiToken.moderatorId);
      u.searchParams.set('first', '1000'); if (cursor) u.searchParams.set('after', cursor);
      const response = await fetch(u, {headers:{'Client-Id':apiCredentials.clientId, 'Authorization':'Bearer ' + apiToken.accessToken}});
      if (response.status === 401) { const e = new Error('TOKEN_EXPIRED'); e.retryAuth = true; throw e; }
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.data)) throw new Error(`Get Chatters failed (HTTP ${response.status})`);
      for (const chatter of data.data) if (chatter.user_login && chatter.user_name) names.set(chatter.user_login.toLowerCase(), chatter.user_name);
      cursor = data.pagination && data.pagination.cursor ? data.pagination.cursor : '';
    } while (cursor);
    return names;
  }
  try { return await requestAll(); }
  catch (e) { if (!e.retryAuth) throw e; await refreshApiToken(); return await requestAll(); }
}
async function syncHelixRoster() {
  if (!apiToken || !apiCredentials || apiBusy) return;
  apiBusy = true;
  try {
    const roster = await helixGetChatters();
    // Apply deltas only: a periodic full snapshot would reset the overlay's character animations.
    for (const [key, name] of roster) if (!activeViewers.has(key)) setViewer(name, true, 'API');
    for (const [key, name] of [...activeViewers]) if (!roster.has(key)) setViewer(name, false, 'API');
    console.log(`Helix roster sync complete: ${roster.size} chatters reported; ${activeViewers.size} cached after reconciliation.`);
  } catch (e) { console.error('Helix chatters sync failed; keeping the current roster and continuing IRC:', e.message); }
  finally { apiBusy = false; }
}
function startApiSync() { if (!apiToken) return; clearInterval(apiTimer); syncHelixRoster(); apiTimer = setInterval(syncHelixRoster, 60000); }

function connectIRC(){
  clearTimeout(retry); ircReady=false;
  if(!login||!token){broadcast({type:'status',message:'no Twitch bot account linked'});return;}
  console.log(`Connecting to Twitch IRC for #${channel} as ${login}...`);
  irc = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
  let buffer='';
  irc.on('open',()=>{
    irc.send('CAP REQ :twitch.tv/membership twitch.tv/commands twitch.tv/tags');
    irc.send(`PASS oauth:${token}`); irc.send(`NICK ${login}`); irc.send(`JOIN #${channel}`);
  });
  irc.on('message',raw=>{
    buffer += raw.toString(); const lines=buffer.split('\r\n'); buffer=lines.pop();
    for (const line of lines) {
      if (line.startsWith('PING ')) { if(irc.readyState===WebSocket.OPEN)irc.send('PONG '+line.slice(5)); continue; }
      if (line.includes(' 001 ')) { ircReady=true; console.log(`Authenticated; listening for JOIN/PART, avatar commands, and raid notifications in #${channel}.`); broadcast({type:'status',message:'connected'}); startApiSync(); }
      // Viewers can choose a regular roster character with !avatar <name>.
      // VIPs are marked by Twitch IRC badges and are rejected again by the overlay;
      // their reserved special avatars are protected there as well.
      const chatMatch=line.match(/^(?:@([^ ]+) )?:([^! ]+)!.* PRIVMSG #([^ ]+) :(.*)$/i);
      if(chatMatch && chatMatch[3].toLowerCase()===channel){
        const chatUsername = chatMatch[2];
        const rawMessage = chatMatch[4];
        const message = stripChatAction(rawMessage).trim();
        if(/^[a-zA-Z0-9_]{1,25}$/.test(chatUsername) && !isBannedBot(chatUsername)) broadcast({type:'chatSeen',username:chatUsername});
        const tags={};
        for(const part of (chatMatch[1]||'').split(';')){const eq=part.indexOf('=');if(eq>=0)tags[part.slice(0,eq)]=part.slice(eq+1);}
        const badges=String(tags.badges||'').split(',').filter(Boolean);
        const isVip=badges.some(b=>/^vip(?:\/|$)/i.test(b));
        const command=message.match(/^!avatar\s+(.+?)\s*$/i);
        if(command && /^[a-zA-Z0-9_]{1,25}$/.test(chatUsername)){
          const requested=command[1].trim().slice(0,48);
          if(requested && !/^special\s+/i.test(requested)) {
            const key = chatUsername.toLowerCase();
            // Save only valid normal-roster choices from non-VIPs who do not own reserved special avatars.
            if (!isVip && isKnownNormalCharacter(requested)) {
              avatarPreferences[key] = requested;
              try { saveAvatarPreferences(); }
              catch (error) { console.error('Could not save avatar preference:', error.message); }
            }
            broadcast({type:'avatarChange',username:chatUsername,character:requested,isVip});
          }
        }
        if (
          message &&
          !message.startsWith('!') &&
          /^[a-zA-Z0-9_]{1,25}$/.test(chatUsername) &&
          chatUsername.toLowerCase() !== login &&
          !isBannedBot(chatUsername)
        ) {
          const rawChars = Array.from(stripChatAction(rawMessage));
          const messageChars = Array.from(message);
          const firstVisibleChar = rawChars.findIndex(char => !/\s/u.test(char));
          const leadingWhitespace = firstVisibleChar < 0 ? 0 : firstVisibleChar;

          const emotes = parseTwitchEmoteTag(tags.emotes)
            .map(emote => ({
              id: emote.id,
              start: emote.start - leadingWhitespace,
              end: emote.end - leadingWhitespace
            }))
            .filter(emote =>
              emote.start >= 0 &&
              emote.end >= emote.start &&
              emote.end < messageChars.length
            );

          broadcast({
            type: 'chatMessage',
            username: chatUsername,
            displayName: decodeIrcTagValue(tags['display-name']) || chatUsername,
            text: message.slice(0, 140),
            emotes: emotes.slice(0, 12),
            messageId: tags.id || null
          });
        }
      }
      // Twitch IRC announces incoming raids as USERNOTICE with msg-id=raid and msg-param-viewerCount.
      if (/\bUSERNOTICE\s+#?[^ ]+/i.test(line) && /(?:^|;)msg-id=raid(?:;|\s)/i.test(line)) {
        const raidMatch=line.match(/(?:^|;)msg-param-viewerCount=(\d+)(?:;|\s)/i);
        const raiderMatch=line.match(/(?:^|;)msg-param-login=([^;\s]+)/i);
        const raidViewers=raidMatch?Math.max(1,Math.min(1000000,Number(raidMatch[1])||1)):1;
        console.log(`Raid detected${raiderMatch?` from @${raiderMatch[1]}`:''}: ${raidViewers} viewers.`);
        broadcast({type:'raid',viewers:raidViewers,raider:raiderMatch?raiderMatch[1]:null});
      }
      // IRC NAMES is a useful early seed, but Helix will reconcile missing/incomplete membership shortly.
      if (line.includes(' 353 ')) {
        const namesPart = line.split(' :').pop() || '';
        for (const rawName of namesPart.split(/\s+/)) {
          const name = rawName.replace(/^[@+%&~]+/, '').trim();
          if (name && /^[a-zA-Z0-9_]{1,25}$/.test(name) && name.toLowerCase() !== login && !activeViewers.has(name.toLowerCase())) activeViewers.set(name.toLowerCase(), name);
        }
        continue;
      }
      if (line.includes(' 366 ')) {
        broadcast({type:'snapshot', usernames:[...activeViewers.values()]});
        console.log(`Initial IRC chat roster synced: ${activeViewers.size} usernames reported.`);
        continue;
      }
      const m=line.match(/^:([^! ]+)!.* (JOIN|PART) #([^ ]+)/i);
      if(m && m[3].toLowerCase()===channel && m[1].toLowerCase()!==login) setViewer(m[1], m[2].toLowerCase()==='join');
      const quitMatch=line.match(/^:([^! ]+)!.* QUIT(?: |$)/i);
      if (quitMatch && quitMatch[1].toLowerCase() !== login) setViewer(quitMatch[1], false);
      const nickMatch=line.match(/^:([^! ]+)!.* NICK :?([^ ]+)/i);
      if (nickMatch && nickMatch[1].toLowerCase() !== login) {
        const oldName=nickMatch[1], newName=nickMatch[2], oldKey=oldName.toLowerCase();
        if (activeViewers.has(oldKey)) { activeViewers.delete(oldKey); broadcast({type:'part',username:oldName}); setViewer(newName,true); }
      }
      if (line.includes(' 464 ') || line.includes('Login authentication failed')) { console.error('Twitch IRC authentication failed. Check config.json and the IRC access token.'); ircReady=false; }
    }
  });
  irc.on('close',()=>{ircReady=false; if(login&&token){broadcast({type:'status',message:'reconnecting to Twitch'}); retry=setTimeout(connectIRC,5000);}});
  irc.on('error',err=>{console.error('Twitch IRC connection error:',err.message);});
}
server.listen(8081, '127.0.0.1', () => {
  console.log('Eika Army overlay + Twitch bridge running in ONE process.');
  console.log('OBS Browser Source: http://127.0.0.1:8081/?stream=1');
  console.log('Demo preview:       http://127.0.0.1:8081/?demo=1');
  console.log('Health check:       http://127.0.0.1:8081/health');
  connectIRC();
});

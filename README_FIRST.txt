EIKA ARMY CROWD OVERLAY — SINGLE-WINDOW TWITCH PATCH

This patch runs the static overlay server and Twitch IRC bridge in ONE Command Prompt window and ONE Node.js process.

INSTALL
1. Back up your existing overlay folder.
2. Extract this ZIP into your existing CrowdOverlayV7 project folder, alongside index.html and assets.
3. Allow these files to replace app.js, connector.js, package.json, and Run_Eika_Army_Overlay.bat when prompted.
4. Keep your existing config.json. Do NOT replace it; it contains your private Twitch settings/token.
5. Double-click Run_Eika_Army_Overlay.bat.
6. OBS Browser Source URL remains http://127.0.0.1:8081/?stream=1
7. Demo preview: http://127.0.0.1:8081/?demo=1
8. Health check: http://127.0.0.1:8081/health

The stream URL starts without fake test characters. Demo mode still displays test characters.
Keep the single Command Prompt window open while streaming. Press Ctrl+C to stop both services.
Do not share config.json or your OAuth token.

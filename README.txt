Eika Army Overlay — Special Avatar Assignment Update

This patch adds all 12 usernames shown in your Special Avatars folder list to the
overlay's actual SPECIAL_AVATARS mapping. The app.js mapping is what makes those
viewers spawn with their custom special sprites; the JSON file is an editable copy
of the special-user list for reference and connector-side use.

Install:
1. Stop the overlay with Ctrl+C.
2. Back up your current app.js.
3. Extract app.js and special-avatar-users.json into the CrowdOverlay folder.
4. Replace app.js and overwrite/update special-avatar-users.json.
5. Restart Run_Eika_Army_Overlay.bat.

Included usernames:
XXSefaYT, n3koyama, lzayoiisakuya, CapAimex, EmikoAi_, MKOmega, Lifhee,
alicepuddingyui, Yukzz___, Alas_tt, AleGirl, Skye_Kitsune_Gaming.

Make sure each name has a matching folder under assets/Special Avatars, with
idle.png and the relevant animation folders. If a user's folder is absent or the
image files are missing, the overlay cannot display that user's custom art.
Keep avatar-preferences.json and all Twitch credentials unchanged.

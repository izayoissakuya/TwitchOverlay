REIMU — SWR IDLE + WALK ASSET PACK

Contents
- assets/reimu/idle.png: static fallback required by the folder scanner
- assets/reimu/idle/frame_01.png ... frame_11.png: 11-frame idle loop
- assets/reimu/walk/frame_01.png ... frame_08.png: 8-frame walking loop
- previews/: contact sheets and animated previews

Selected source-sheet frames (left-to-right order)
Idle: 003, 004, 005, 009, 010, 011, 006, 007, 008, 001, 002.
Walk: 023, 024, 026, 027, 028, 025, 030, 029.

Frames were cropped tightly from the original sprite sheet using the source bounds, the solid blue background was made transparent, and every frame was nearest-neighbour normalized to 45px high. This avoids the text label artifacts present in the earlier automatically padded component crops.

CODE CHANGES
1) In app.js, change IDLE_FRAME_COUNT from 4 to 11. Keep your idleFrames loader and C code.

2) In loadNormalCharacterAssets(kind), replace the current six-frame walkFrames assignment with:

   const walkFrameCount = kind.toLowerCase() === "reimu" ? 8 : 6;
   walkFrames[kind] = Array.from({length:walkFrameCount}, (_,i) => {
     const img = new Image();
     img.src = `assets/${kind}/walk/frame_${String(i+1).padStart(2,'0')}.png`;
     return img;
   });

The draw() function already uses frames.length, so it can animate eight Reimu frames without changing the animation timing code. Other characters continue using six frames.

INSTALL
Copy this pack's assets/reimu folder into your project's assets folder. Final location: TwitchOverlay/assets/reimu/.
Save app.js, restart the local server, then open http://127.0.0.1:8081/?demo=1.

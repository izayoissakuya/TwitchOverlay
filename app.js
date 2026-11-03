(() => {
"use strict";
const canvas=document.getElementById("crowd"),ctx=canvas.getContext("2d");
const params=new URLSearchParams(location.search),demo=params.get("demo")==="1",streamPreview=params.get("stream")==="1";
const panel=document.getElementById("demoPanel"),status=document.getElementById("status");

panel.hidden=!demo;status.hidden=!demo;
const twitchCornerStack=document.getElementById("twitchCornerStack");
if(twitchCornerStack)twitchCornerStack.hidden=!demo;
// Demo-only Twitch bot-account linking controls. Credentials stay on the local Node server.
if(demo){
 const accountStatus=document.getElementById('twitchAccountStatus');
 const linkButton=document.getElementById('linkTwitchAccount');
 const unlinkButton=document.getElementById('unlinkTwitchAccount');
 async function refreshTwitchAccount(){try{const r=await fetch('/api/twitch/status',{cache:'no-store'});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'Status unavailable');accountStatus.textContent=d.linked?`● Linked: @${d.username} · ${d.connected?'Connected':'Reconnecting…'} · Channel #${d.channel}`:`○ Not linked · Channel #${d.channel}`;accountStatus.style.color=d.linked?'#8fe3a2':'#f0c978';unlinkButton.disabled=!d.linked;}catch(e){accountStatus.textContent='Connection status unavailable: '+e.message;accountStatus.style.color='#ff9a9a';}}
 if(linkButton)linkButton.addEventListener('click',()=>{window.location.href='/api/twitch/link';});
 if(unlinkButton)unlinkButton.addEventListener('click',async()=>{if(!confirm('Unlink the current Twitch bot account? The overlay will stop connecting to Twitch until another account is linked.'))return;unlinkButton.disabled=true;try{const r=await fetch('/api/twitch/unlink',{method:'POST'});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'Unlink failed');await refreshTwitchAccount();}catch(e){accountStatus.textContent='Unlink failed: '+e.message;unlinkButton.disabled=false;}});
 async function refreshTwitchSetup(){
  const state=document.getElementById('twitchSetupState'),message=document.getElementById('twitchSetupMessage'),channelInput=document.getElementById('twitchChannel');
  try{const r=await fetch('/api/setup/status',{cache:'no-store'});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'Setup status unavailable');
   state.textContent=d.configured?'Application configured':'Application setup needed';state.style.color=d.configured?'#8fe3a2':'#f0c978';
   const setupPanel=document.getElementById('twitchSetupPanel'),easySetupButton=document.getElementById('openEasySetup');
   if(setupPanel&&easySetupButton){setupPanel.hidden=!!d.configured;easySetupButton.hidden=!d.configured;}
   if(channelInput&&!channelInput.value)channelInput.value=d.channel||'';
   message.textContent=d.configured?'Client ID and Client Secret are saved locally. You can update them below.':'Enter your own Twitch app credentials, then save.';
  }catch(e){state.textContent='Setup unavailable';message.textContent=e.message;}
 }
 const saveSetupButton=document.getElementById('saveTwitchSetup');
 if(saveSetupButton)saveSetupButton.addEventListener('click',async()=>{
  const message=document.getElementById('twitchSetupMessage'),clientId=document.getElementById('twitchClientId'),secret=document.getElementById('twitchClientSecret'),channelInput=document.getElementById('twitchChannel');
  saveSetupButton.disabled=true;message.textContent='Saving locally…';
  try{const r=await fetch('/api/setup/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:clientId.value,clientSecret:secret.value,channel:channelInput.value})});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'Could not save setup');
   secret.value='';clientId.value='';message.textContent=d.channelChanged?'Setup saved. Channel changed; Twitch bridge is reconnecting.':'Setup saved securely on this computer.';await refreshTwitchSetup();await refreshTwitchAccount();
  }catch(e){message.textContent='Save failed: '+e.message;}finally{saveSetupButton.disabled=false;}
 });
  const helpButton=document.getElementById('toggleTwitchSetupHelp'),help=document.getElementById('twitchSetupHelp');if(helpButton&&help)helpButton.addEventListener('click',()=>{help.hidden=!help.hidden;});
  const easySetupButton=document.getElementById('openEasySetup');if(easySetupButton)easySetupButton.addEventListener('click',()=>{const setupPanel=document.getElementById('twitchSetupPanel');if(setupPanel)setupPanel.hidden=false;easySetupButton.hidden=true;});
 refreshTwitchSetup();
 refreshTwitchAccount();setInterval(refreshTwitchAccount,5000);
}

const MAX=50, viewers=new Map(), particles=[];
// Scaling/layout controls: sprite height in CSS pixels, plus safe room for labels and rows.
const CHARACTER_HEIGHT=200;
// Crowd-aware sizing: preserve the large chibi look for small audiences, then
// gently scale down as more viewers join so everyone has room along the same ground line.
function crowdCharacterHeight(){
 const count=[...viewers.values()].filter(v=>v.state!=="leave").length;
 if(count<=8)return CHARACTER_HEIGHT;
 return Math.max(118, CHARACTER_HEIGHT-((count-8)/(MAX-8))*82);
}
const CHARACTER_BOTTOM_INSET=4;
const SLOT_WIDTH=160;
const TARGET_RENDER_FPS=30, FRAME_INTERVAL=1000/TARGET_RENDER_FPS;
let W=innerWidth,H=innerHeight,dpr=Math.min(devicePixelRatio||1,2),last=performance.now(),lastRender=last;
const spriteImages = {};
const walkFrames = {};
const emoteSprites = {};
const conversationSprites = {};
const conversationFrames = {};
const CONVERSATION_FRAME_COUNT = 6;
const EMOTE_COUNT = 8; // Add assets/<character>/emotes/emote_01.png through emote_08.png as needed.
// Reserved special-avatar slots, assigned to specific Twitch usernames.
const SPECIAL_AVATARS = [
 {username:"XXSefaYT",folder:"XXSefaYT",fallback:0}, {username:"n3koyama",folder:"n3koyama",fallback:1,canFly:true},
 {username:"lzayoiisakuya",folder:"lzayoiisakuya",fallback:2}, {username:"CapAimex",folder:"CapAimex",fallback:3},
 {username:"EmikoAi_",folder:"EmikoAi_",fallback:4}, {username:"MKOmega",folder:"MKOmega",fallback:5},
 {username:"Lifhee",folder:"Lifhee",fallback:6}, {username:"alicepuddingyui",folder:"alicepuddingyui",fallback:7},
 {username:"Yukzz___",folder:"Yukzz___",fallback:8}, {username:"Alas_tt",folder:"Alas_tt",fallback:9},
 {username:"AleGiirl",folder:"AleGiirl",fallback:10}, {username:"Skye_Kitsune_Gaming",folder:"Skye_Kitsune_Gaming",fallback:11}
];
const SPECIAL_AVATAR_TEMPLATES = SPECIAL_AVATARS.map(item => ({...item}));
const specialByLogin=new Map(SPECIAL_AVATARS.map(item=>[item.username.toLowerCase(),item]));
const specialIdle={},specialWalk={},specialConversation={};
const n3koyamaFlyFrames = Array.from({length:6},(_,i)=>{const img=new Image();img.src=`assets/Special Avatars/n3koyama/fly/frame_${String(i+1).padStart(2,"0")}.png`;return img;});
const n3koyamaLandingFrames = Array.from({length:6},(_,i)=>{const img=new Image();img.src=`assets/Special Avatars/n3koyama/landing/frame_${String(i+1).padStart(2,"0")}.png`;return img;});
for(const item of SPECIAL_AVATARS){
 const idle=new Image(); idle.src=`assets/Special Avatars/${item.folder}/idle.png`; specialIdle[item.username.toLowerCase()]=idle;
 specialWalk[item.username.toLowerCase()]=Array.from({length:6},(_,i)=>{const img=new Image();img.src=`assets/Special Avatars/${item.folder}/walk/frame_${String(i+1).padStart(2,"0")}.png`;return img;});
 specialConversation[item.username.toLowerCase()]=Array.from({length:6},(_,i)=>{const img=new Image();img.src=`assets/Special Avatars/${item.folder}/conversation/frame_${String(i+1).padStart(2,"0")}.png`;return img;});
}

for (const key of ["eika", "yvtte", "chiyo", "yugiri", "ming", "fragrance", "cielle", "audrey", "kanami", "celestia", "fuchsia"]) {
  const img = new Image();
  img.src = `assets/${key}/idle.png`;
  spriteImages[key] = img;
}
// Include newly added characters in idle-sprite lookup too. Michele currently uses the procedural fallback until idle.png is supplied.
for (const key of ["maddelena", "michele", "mara"]) {
  if (!spriteImages[key]) { const img = new Image(); img.src = `assets/${key}/idle.png`; spriteImages[key] = img; }
}
// V8: preload six-frame walk cycles for every character folder. A character walks only when all six frame files exist; otherwise its idle sprite is used.
for (const key of ["eika", "audrey", "celestia", "maddelena", "michele", "yvtte", "chiyo", "yugiri", "ming", "fragrance", "cielle", "kanami", "fuchsia", "mara"]) {
  walkFrames[key] = Array.from({ length: 6 }, (_, i) => {
    const img = new Image();
    img.src = `assets/${key}/walk/frame_${String(i + 1).padStart(2, "0")}.png`;
    return img;
  });
}
// Character-specific six-frame conversation animation. Frame files are optional;
// if all six are not available, use legacy talk.png when supplied, then idle.png.
for (const key of ["eika", "audrey", "celestia", "maddelena", "michele", "yvtte", "chiyo", "yugiri", "ming", "fragrance", "cielle", "kanami", "fuchsia", "mara"]) {
  conversationFrames[key] = Array.from({ length: CONVERSATION_FRAME_COUNT }, (_, i) => {
    const img = new Image();
    img.src = `assets/${key}/conversation/frame_${String(i + 1).padStart(2, "0")}.png`;
    return img;
  });
  const img = new Image();
  img.src = `assets/${key}/conversation/talk.png`; // Backward-compatible single-pose fallback.
  conversationSprites[key] = img;
}
// Optional random emotes. Missing files are ignored, so characters work normally
// until you add your own transparent full-character emote sprites.
for (const key of ["eika", "audrey", "celestia", "maddelena", "michele", "yvtte", "chiyo", "yugiri", "ming", "fragrance", "cielle", "kanami", "fuchsia", "mara"]) {
  emoteSprites[key] = Array.from({ length: EMOTE_COUNT }, (_, i) => {
    const img = new Image();
    img.src = `assets/${key}/emotes/emote_${String(i + 1).padStart(2, "0")}.png`;
    return img;
  });
}
const roster=[
 {name:"Eika",hair:"#ef2947",hair2:"#fff5f6",skin:"#ffe0d0",cloth:"#d51d3d",trim:"#f5f5f5",eye:"#737987",accent:"#ff4769",kind:"eika"},
 {name:"Yvtte",hair:"#493b3e",hair2:"#fff5f6",skin:"#ffe0d0",cloth:"#e9f5ff",trim:"#f5f5f5",eye:"#70dfff",accent:"#75dfff",kind:"yvtte"},
 {name:"Chiyo",hair:"#211d2b",hair2:"#d51d3d",skin:"#ffe0d0",cloth:"#283e79",trim:"#f5f5f5",eye:"#34252f",accent:"#ff4769",kind:"chiyo"},
 {name:"Yugiri",hair:"#9cbcff",hair2:"#e9f0ff",skin:"#ffe5d7",cloth:"#eaf7ff",trim:"#d6e9ff",eye:"#9d83ff",accent:"#9bbcff",kind:"yugiri"},
 {name:"Ming",hair:"#4b2c24",hair2:"#ef6542",skin:"#ffe3cf",cloth:"#29252e",trim:"#fff0ce",eye:"#ff9c38",accent:"#f2bd4f",kind:"ming"},
 {name:"Fragrance",hair:"#c69acb",hair2:"#fff0ff",skin:"#ffe0d2",cloth:"#633657",trim:"#fce6f2",eye:"#e65a9e",accent:"#ff88c6",kind:"fragrance"},
 {name:"Cielle",hair:"#f36a43",hair2:"#ffad73",skin:"#ffe0d2",cloth:"#242a3d",trim:"#e8f7ff",eye:"#3bceff",accent:"#29c7ff",kind:"cielle"},
 {name:"Audrey",hair:"#f5c76b",hair2:"#fff0bb",skin:"#ffe3cf",cloth:"#29252e",trim:"#fff0ce",eye:"#48bfff",accent:"#f2bd4f",kind:"audrey"},
 {name:"Kanami",hair:"#d889ee",hair2:"#ffb4e9",skin:"#ffe3cf",cloth:"#29252e",trim:"#fff0ce",eye:"#48bfff",accent:"#f2bd4f",kind:"kanami"},
 {name:"Celestia",hair:"#83b7ff",hair2:"#e9f0ff",skin:"#ffe5d7",cloth:"#302d69",trim:"#d6e9ff",eye:"#9d83ff",accent:"#9bbcff",kind:"celestia"},
 {name:"Fuchia",hair:"#d9949a",hair2:"#ffd5e8",skin:"#ffe0d2",cloth:"#633657",trim:"#fce6f2",eye:"#e65a9e",accent:"#ff88c6",kind:"fuchsia"},
 {name:"Michele",hair:"#9b8bda",hair2:"#f2eaff",skin:"#ffe0d2",cloth:"#463c72",trim:"#f5f0ff",eye:"#a8a5ff",accent:"#c6b7ff",kind:"michele"},
 {name:"Maddalena",hair:"#d7b6e8",hair2:"#fff0ff",skin:"#ffe0d2",cloth:"#6a4a79",trim:"#fff0ff",eye:"#c69af0",accent:"#e2b8ff",kind:"maddelena"},
 {name:"Mara",hair:"#4b2c24",hair2:"#ef6542",skin:"#ffe3cf",cloth:"#29252e",trim:"#fff0ce",eye:"#ff9c38",accent:"#f2bd4f",kind:"mara"}
 ];
const NORMAL_ROSTER_TEMPLATES = roster.map(character => ({...character}));
const NORMAL_TEMPLATE_BY_KIND = new Map(NORMAL_ROSTER_TEMPLATES.map(character => [character.kind.toLowerCase(), character]));

// Optional single-frame falling pose for raid arrivals. Add assets/<character>/falling/frame_01.png.
const fallingSprites = {};
for (const character of roster) {
  const img = new Image();
  img.src = `assets/${character.kind}/falling/frame_01.png`;
  fallingSprites[character.kind] = img;
}
// Aerial duel sprites are kept separate per character in each character's fight/ folder.
const fightFrames = {};
function loadFightFrames(kind, specialAvatar = null) {
  const key = specialAvatar ? `special:${specialAvatar}` : kind;
  if (fightFrames[key]) return fightFrames[key];
  const base = specialAvatar ? `assets/Special Avatars/${specialAvatar}/fight` : `assets/${kind}/fight`;
  fightFrames[key] = Array.from({length:6}, (_,i) => {
    const img = new Image();
    img.src = `${base}/frame_${String(i+1).padStart(2,"0")}.png`;
    return img;
  });
  return fightFrames[key];
}
const duelTakeoffFrames = {};
function loadDuelTakeoffFrames(kind, specialAvatar = null) {
  const key = specialAvatar ? `special:${specialAvatar}` : kind;
  if (duelTakeoffFrames[key]) return duelTakeoffFrames[key];
  const base = specialAvatar ? `assets/Special Avatars/${specialAvatar}/takeoff` : `assets/${kind}/takeoff`;
  duelTakeoffFrames[key] = Array.from({length:6}, (_,i) => {
    const img = new Image();
    img.src = `${base}/frame_${String(i+1).padStart(2,"0")}.png`;
    return img;
  });
  return duelTakeoffFrames[key];
}
const duelLandingFrames = {};
function loadDuelLandingFrames(kind, specialAvatar = null) {
  const key = specialAvatar ? `special:${specialAvatar}` : kind;
  if (duelLandingFrames[key]) return duelLandingFrames[key];
  const base = specialAvatar ? `assets/Special Avatars/${specialAvatar}/landing` : `assets/${kind}/landing`;
  duelLandingFrames[key] = Array.from({length:6}, (_,i) => {
    const img = new Image();
    img.src = `${base}/frame_${String(i+1).padStart(2,"0")}.png`;
    return img;
  });
  return duelLandingFrames[key];
}
let activeAerialDuel = null;

function loadNormalCharacterAssets(kind) {
  const idle = new Image(); idle.src = `assets/${kind}/idle.png`; spriteImages[kind] = idle;
  walkFrames[kind] = Array.from({length:6}, (_,i) => { const img=new Image(); img.src=`assets/${kind}/walk/frame_${String(i+1).padStart(2,'0')}.png`; return img; });
  conversationFrames[kind] = Array.from({length:CONVERSATION_FRAME_COUNT}, (_,i) => { const img=new Image(); img.src=`assets/${kind}/conversation/frame_${String(i+1).padStart(2,'0')}.png`; return img; });
  const talk = new Image(); talk.src=`assets/${kind}/conversation/talk.png`; conversationSprites[kind]=talk;
  emoteSprites[kind] = Array.from({length:EMOTE_COUNT}, (_,i) => { const img=new Image(); img.src=`assets/${kind}/emotes/emote_${String(i+1).padStart(2,'0')}.png`; return img; });
  const falling = new Image(); falling.src=`assets/${kind}/falling/frame_01.png`; fallingSprites[kind]=falling;
}
function registerDiscoveredCharacter(folder) {
  const kind = String(folder || '').trim();
  if (!kind || roster.some(character => character.kind.toLowerCase() === kind.toLowerCase())) return false;
  const template = NORMAL_TEMPLATE_BY_KIND.get(kind.toLowerCase());
  const name = template?.name || kind.replace(/[_-]+/g, ' ').replace(/\\b\\w/g, letter => letter.toUpperCase());
  roster.push(template ? {...template, kind} : {name, hair:'#777b91', hair2:'#d8d9e4', skin:'#ffe0d0', cloth:'#4d587a', trim:'#f5f5f5', eye:'#70dfff', accent:'#75dfff', kind});
  loadNormalCharacterAssets(kind);
  return true;
}
function registerDiscoveredSpecialAvatar(folder) {
  const safeFolder = String(folder || '').trim();
  if (!safeFolder || SPECIAL_AVATARS.some(item => item.folder.toLowerCase() === safeFolder.toLowerCase() || item.username.toLowerCase() === safeFolder.toLowerCase())) return false;
  const item = { username: safeFolder, folder: safeFolder, fallback: SPECIAL_AVATARS.length };
  SPECIAL_AVATARS.push(item);
  specialByLogin.set(item.username.toLowerCase(), item);
  const key = item.username.toLowerCase();
  const idle = new Image(); idle.src = `assets/Special Avatars/${safeFolder}/idle.png`; specialIdle[key] = idle;
  specialWalk[key] = Array.from({length:6}, (_,i) => { const img=new Image(); img.src=`assets/Special Avatars/${safeFolder}/walk/frame_${String(i+1).padStart(2,'0')}.png`; return img; });
  specialConversation[key] = Array.from({length:6}, (_,i) => { const img=new Image(); img.src=`assets/Special Avatars/${safeFolder}/conversation/frame_${String(i+1).padStart(2,'0')}.png`; return img; });
  return true;
}
let initialCharacterScanComplete = false;
let characterRefreshInProgress = false;
async function refreshCharacterList() {
  if (characterRefreshInProgress) return;
  characterRefreshInProgress = true;
  const button = document.getElementById('refreshCharacters');
  if (button) button.disabled = true;
  try {
    const response = await fetch('/api/characters', {cache:'no-store'});
    const data = await response.json();
    if (!response.ok || !data.ok || !Array.isArray(data.characters) || !Array.isArray(data.specialCharacters)) throw new Error(data.error || 'Character scan failed.');
    const normalFolders = [...new Map(data.characters.filter(x => typeof x === 'string').map(x => [x.toLowerCase(), x])).values()];
    const specialFolders = [...new Map(data.specialCharacters.filter(x => typeof x === 'string').map(x => [x.toLowerCase(), x])).values()];
    const oldRoster = roster.slice();
    const oldKindsByViewer = new Map();
    for (const viewer of viewers.values()) oldKindsByViewer.set(viewer.id, oldRoster[viewer.skin]?.kind || null);

    // Filesystem snapshot is authoritative: rebuild the normal roster on every scan.
    const nextRoster = normalFolders.map(folder => {
      const old = oldRoster.find(c => c.kind.toLowerCase() === folder.toLowerCase());
      const template = NORMAL_TEMPLATE_BY_KIND.get(folder.toLowerCase());
      return old ? {...old, kind:folder} : template ? {...template, kind:folder} : {
        name:folder.replace(/[_-]+/g,' ').replace(/\b\w/g,letter=>letter.toUpperCase()),
        hair:'#777b91',hair2:'#d8d9e4',skin:'#ffe0d0',cloth:'#4d587a',trim:'#f5f5f5',eye:'#70dfff',accent:'#75dfff',kind:folder
      };
    });
    roster.splice(0, roster.length, ...nextRoster);
    for (const character of roster) loadNormalCharacterAssets(character.kind);

    // Rebuild special avatars only from existing Special Avatars folders.
    const oldSpecial = SPECIAL_AVATARS.slice();
    const nextSpecial = specialFolders.map(folder => {
      const known = SPECIAL_AVATAR_TEMPLATES.find(item => item.folder.toLowerCase() === folder.toLowerCase() || item.username.toLowerCase() === folder.toLowerCase());
      const previous = oldSpecial.find(item => item.folder.toLowerCase() === folder.toLowerCase());
      const item = {...(known || previous || {username:folder,folder,fallback:0}), username:known?.username || previous?.username || folder, folder};
      if (known && Number.isInteger(known.fallback) && NORMAL_ROSTER_TEMPLATES[known.fallback]) {
        const intendedKind = NORMAL_ROSTER_TEMPLATES[known.fallback].kind.toLowerCase();
        const mappedFallback = nextRoster.findIndex(character => character.kind.toLowerCase() === intendedKind);
        item.fallback = mappedFallback >= 0 ? mappedFallback : 0;
      } else if (roster.length) item.fallback = Math.max(0, Math.min(Number(item.fallback) || 0, roster.length - 1));
      return item;
    });
    SPECIAL_AVATARS.splice(0, SPECIAL_AVATARS.length, ...nextSpecial);
    specialByLogin.clear();
    for (const item of SPECIAL_AVATARS) {
      const key = item.username.toLowerCase();
      specialByLogin.set(key,item);
      const idle = new Image(); idle.src=`assets/Special Avatars/${item.folder}/idle.png`; specialIdle[key]=idle;
      specialWalk[key]=Array.from({length:6},(_,i)=>{const img=new Image();img.src=`assets/Special Avatars/${item.folder}/walk/frame_${String(i+1).padStart(2,'0')}.png`;return img;});
      specialConversation[key]=Array.from({length:6},(_,i)=>{const img=new Image();img.src=`assets/Special Avatars/${item.folder}/conversation/frame_${String(i+1).padStart(2,'0')}.png`;return img;});
    }

    // Remove viewers assigned to deleted folders; remap surviving normal viewers by folder.
    for (const [id, viewer] of [...viewers]) {
      if (viewer.specialAvatar) {
        const special = specialByLogin.get(String(viewer.username || '').toLowerCase());
        if (!special || !roster.length) { viewers.delete(id); continue; }
        viewer.specialAvatar = special.username.toLowerCase();
        viewer.canFly = !!special.canFly;
        viewer.skin = Math.max(0, Math.min(Number.isInteger(special.fallback) ? special.fallback : 0, roster.length - 1));
      } else {
        const oldKind = oldKindsByViewer.get(id);
        const nextIndex = roster.findIndex(character => character.kind.toLowerCase() === String(oldKind || '').toLowerCase());
        if (nextIndex < 0) { viewers.delete(id); continue; }
        viewer.skin = nextIndex;
      }
    }
    layout(); count();

    // Populate Demo Mode only after the first successful disk scan.
    if (!initialCharacterScanComplete) {
      initialCharacterScanComplete = true;
      if (demo) roster.forEach((character, i) => setTimeout(() => add(character.name, i), i * 120));
    }
    if (demo && status) status.textContent = `Asset folders synced: ${roster.length} normal, ${SPECIAL_AVATARS.length} special.`;
  } catch (error) {
    if (demo && status) status.textContent = `Character refresh failed: ${error.message}`;
  } finally {
    characterRefreshInProgress = false;
    if (button) button.disabled = false;
  }
}
function resize(){W=innerWidth;H=innerHeight;dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);canvas.style.width=W+"px";canvas.style.height=H+"px";ctx.setTransform(dpr,0,0,dpr,0,0);layout()}
addEventListener("resize",resize);
function rand(a,b){return a+Math.random()*(b-a)}
function pick(arr){return arr[Math.floor(Math.random()*arr.length)]}
// Demo mode uses only real character entries from the roster; no generated sample usernames.
let demoRosterIndex=0;
function nextDemoCharacter(){
  for(let tries=0;tries<roster.length;tries++){
    const skin=(demoRosterIndex+tries)%roster.length;
    const character=roster[skin];
    if(!viewers.has(character.name.toLowerCase())){
      demoRosterIndex=(skin+1)%roster.length;
      return {name:character.name,skin};
    }
  }
  return null;
}
function create(username,skinIndex=null){
 if(!roster.length)return null;
 let skin=skinIndex===null?Math.floor(Math.random()*roster.length):skinIndex;
 const special=specialByLogin.get(username.toLowerCase())||null;
 if(special&&skinIndex===null)skin=special.fallback;
 const randomSpawnX = rand(90, Math.max(91, W-90));
 const spawnFromLeft = Math.random() < 0.5;
 const startX = spawnFromLeft ? -160 : W + 160;
 return {id:username.toLowerCase(),username,skin,specialAvatar:special?special.username.toLowerCase():null,canFly:!!special?.canFly,x:startX,targetX:randomSpawnX,randomSpawn:false,y:0,scale:1,phase:rand(0,6.28),state:"enter",time:0,walk:0,moveDir:spawnFromLeft?1:-1,roamTimer:rand(2.5,6),roamTargetX:0,roamKind:"short",socialTimer:rand(8,16),interactionTime:0,interactionPartner:null,turnTimer:0,emoteTimer:rand(12,28),emoteUntil:0,activeEmote:null,flightCountdown:special?.canFly?rand(270,330):Infinity,flightPhase:null,flightPhaseTime:0,flightDuration:0,flightAltitude:0,flightEndX:0};
}
// Keep the whole sprite inside the canvas, accounting for the widest animation frame.
// Transparent padding varies by character, so use the widest available idle/walk/talk/emote image.
function halfSpriteWidth(v){
 const key=roster[v.skin]?.kind;
 const images=[spriteImages[key],...(walkFrames[key]||[]),...(conversationFrames[key]||[]),conversationSprites[key],...(emoteSprites[key]||[]),...(v.canFly?[...n3koyamaFlyFrames,...n3koyamaLandingFrames]:[])].filter(Boolean);
 let maxAspect=0;
 for(const img of images) if(img.complete&&img.naturalWidth>0&&img.naturalHeight>0) maxAspect=Math.max(maxAspect,img.naturalWidth/img.naturalHeight);
 if(!maxAspect)maxAspect=0.8;
 return Math.min(105,Math.max(28,(crowdCharacterHeight()*maxAspect)/2))+EDGE_PADDING;
}
const EDGE_PADDING=14;
function clampCharacterX(v,x){
 const margin=halfSpriteWidth(v);
 return W<=margin*2 ? W/2 : Math.max(margin,Math.min(W-margin,x));
}
function layout(){
 const list=[...viewers.values()].filter(v=>v.state!=="leave");
 // All characters share one baseline: crowd growth never creates a second row above the ground.
 // Spread target positions across the full width; dense crowds may overlap horizontally, but feet stay grounded.
 const spacing=list.length>1 ? Math.max(1,(W-24)/(list.length-1)) : W-24;
 list.forEach((v,i)=>{
   const targetX=list.length>1 ? 12+i*spacing : W/2;
   if(v.randomSpawn){
     // Keep a random safe destination, but preserve the off-screen start so the viewer walks in.
     const margin=Math.min(halfSpriteWidth(v),Math.max(1,W/2-1));
     const minX=Math.min(W/2,margin), maxX=Math.max(minX,W-margin);
     v.targetX=rand(minX,maxX);
     v.randomSpawn=false;
     v.state="enter";
     v.time=0;
   }else if(v.state!=="enter"){
     v.targetX=clampCharacterX(v,targetX);
   }
   if(v.state!=="raidDrop")v.y=H-CHARACTER_BOTTOM_INSET;
   // Keep entering characters off-screen until their walk-in animation brings them inside.
   if(v.state!=="enter") v.x=clampCharacterX(v,v.x);
   if(v.state==="roam")v.roamTargetX=clampCharacterX(v,v.roamTargetX);
 });
}
// Pick a safe place to stop: walkers may pass through the crowd, but never settle overlapped or at an edge.
const MIN_GAP=72;
function gapBetween(a,b){ return halfSpriteWidth(a)+halfSpriteWidth(b)+8; }
function safeRoamStop(v, desiredX){
 const peers=[...viewers.values()].filter(o=>o!==v&&o.state!=="leave"&&Math.abs(o.y-v.y)<28);
 const candidates=[desiredX, ...peers.flatMap(o=>[o.x-gapBetween(v,o),o.x+gapBetween(v,o)])]
  .map(x=>clampCharacterX(v,x))
  .filter((x,i,a)=>a.findIndex(n=>Math.abs(n-x)<1)===i)
  .filter(x=>peers.every(o=>Math.abs(o.x-x)>=gapBetween(v,o)));
 if(!candidates.length)return null;
 return candidates.reduce((best,x)=>Math.abs(x-desiredX)<Math.abs(best-desiredX)?x:best,candidates[0]);
}
function count(){const el=document.getElementById("count");if(el)el.textContent=`${[...viewers.values()].filter(v=>v.state!=="leave").length} / ${MAX}`}
function add(username,skinIndex=null){if(!username||!initialCharacterScanComplete||!roster.length||viewers.has(username.toLowerCase()))return false;if([...viewers.values()].filter(v=>v.state!=="leave").length>=MAX)return false;let v=create(username,skinIndex);if(!v)return false;viewers.set(v.id,v);layout();count();return true}
// Raid arrivals use normal roster sprites only and enter from above the canvas.
let raidSequence=0;
function spawnRaid(requestedCount=8){
 const current=[...viewers.values()].filter(v=>v.state!=="leave").length;
 const slots=Math.max(0,MAX-current);
 const amount=Math.min(slots,Math.max(1,Math.floor(Number(requestedCount)||8)));
 if(!amount){if(demo&&status)status.textContent="Raid arrival skipped: crowd is already at the 50-character limit.";return 0;}
 const batch=++raidSequence;
 let spawned=0;
 for(let i=0;i<amount;i++){
   const skin=Math.floor(Math.random()*roster.length);
   const username=`RaidGuest_${batch}_${i+1}`;
   if(!add(username,skin))continue;
   const v=viewers.get(username.toLowerCase());
   if(!v)continue;
   v.isRaidGuest=true;v.hideName=true;v.state="raidDrop";v.raidDelay=i*0.13;v.raidVelocity=0;v.raidImpact=false;
   v.x=clampCharacterX(v,rand(halfSpriteWidth(v),Math.max(halfSpriteWidth(v),W-halfSpriteWidth(v))));
   v.y=-crowdCharacterHeight()-rand(20,180);v.targetX=v.x;v.moveDir=Math.random()<.5?-1:1;
   spawned++;
 }
 if(demo&&status)status.textContent=`Raid test: ${spawned} normal character${spawned===1?"":"s"} dropping in (${current+spawned}/${MAX}).`;
 return spawned;
}
function testRaid(){if(demo)spawnRaid(8);}
function assignRaidGuestName(username){
 const clean=String(username||"").trim().slice(0,32);
 if(!/^[a-zA-Z0-9_]{1,25}$/.test(clean))return false;
 if(viewers.has(clean.toLowerCase()))return false;
 const guest=[...viewers.values()].find(v=>v.isRaidGuest&&v.hideName&&v.state!=="leave");
 if(!guest)return false;
 guest.username=clean;guest.hideName=false;guest.isRaidGuest=false;
 return true;
}
function remove(username){let v=viewers.get((username||"").toLowerCase());if(!v||v.state==="leave")return false;v.state="leave";v.time=0;return true}
function removeRandom(){let a=[...viewers.values()].filter(v=>v.state!=="leave");if(a.length)remove(pick(a).username)}
function clear(){for(const v of viewers.values()){v.state="leave";v.time=0}}
function cheer(){for(const v of viewers.values())if(v.state!=="leave"){for(let i=0;i<7;i++)particles.push({x:v.x+rand(-15,15),y:v.y-95, vx:rand(-45,45),vy:rand(-110,-45),life:rand(.6,1.2),age:0,color:roster[v.skin].accent,shape:Math.random()<.5?"✦":"♥"})}}
// Demo-only Talk Test: force two visible characters into the conversation animation.
function talkTest(){
 if(!demo)return;
 let idle=[...viewers.values()].filter(v=>v.state==="idle");
 while(idle.length<2 && [...viewers.values()].filter(v=>v.state!=="leave").length<MAX){
   add(fakeName()); idle=[...viewers.values()].filter(v=>v.state==="idle");
 }
 if(idle.length<2)return;
 const a=idle[0], b=idle[1];
 for(const v of [a,b]){v.state="interact";v.interactionPartner=v===a?b.id:a.id;v.interactionTime=5;v.activeEmote=null;v.emoteUntil=0;v.moveDir=Math.sign((v===a?b:a).x-v.x)||v.moveDir;}
}
function rr(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill()}
function draw(v,now,targetHeight){
 const c=roster[v.skin],x=v.x,y=v.y-(v.flightAltitude||0),s=v.scale;
  // Show an emote sprite briefly while standing; movement always uses walk frames.
  if (v.state === "idle" && v.activeEmote && now < v.emoteUntil && v.activeEmote.complete && v.activeEmote.naturalWidth > 0) {
    // The emote sprite is drawn with the same height/aspect-ratio rules as idle sprites below.
  } else if (now >= v.emoteUntil) {
    v.activeEmote = null;
  }
  // Natural standing: keep the body and feet steady; no idle bobbing.
  const step=0;
 ctx.save();ctx.translate(x,y);ctx.scale(s,s);
 ctx.fillStyle="#0003";ctx.beginPath();ctx.ellipse(0,(v.flightAltitude||0)-2,24,5,0,0,6.283);ctx.fill();
 // V5 uses the approved transparent pixel-chibi sprites for every roster character.
 let sprite = (v.state === "idle" && v.activeEmote && v.activeEmote.complete && v.activeEmote.naturalWidth > 0)
   ? v.activeEmote : spriteImages[c.kind];
 // During raid drops, prefer the character's optional single-frame falling pose.
 if (v.state === "raidDrop") {
   const falling = fallingSprites[c.kind];
   if (falling && falling.complete && falling.naturalWidth > 0) sprite = falling;
 }
 if(v.specialAvatar){const img=specialIdle[v.specialAvatar];if(img&&img.complete&&img.naturalWidth>0)sprite=img;}
 if(v.canFly && v.state==="flight"){
   const frames=v.flightPhase==="landing"?n3koyamaLandingFrames:n3koyamaFlyFrames;
   const ready=frames.every(frame=>frame.complete&&frame.naturalWidth>0);
   if(ready)sprite=frames[Math.min(frames.length-1,Math.floor(now/1000*7)%frames.length)];
 }
 if(v.state==="duelTakeoff"){
   const frames=loadDuelTakeoffFrames(c.kind,v.specialAvatar);
   const ready=frames.every(frame=>frame.complete&&frame.naturalWidth>0);
   if(ready){
     const progress=Math.min(1,(v.duelTakeoffElapsed||0)/0.9);
     sprite=frames[Math.min(frames.length-1,Math.floor(progress*frames.length))];
   }
 }
 if(v.state==="duelFight"){
   const frames=loadFightFrames(c.kind, v.specialAvatar);
   const ready=frames.every(frame=>frame.complete&&frame.naturalWidth>0);
   if(ready)sprite=frames[Math.floor((activeAerialDuel?.elapsed||0)*8)%frames.length];
 }
 if(v.state==="duelLand"){
    const frames=loadDuelLandingFrames(c.kind, v.specialAvatar);
    const ready=frames.every(frame=>frame.complete&&frame.naturalWidth>0);
    if(ready){
      const progress=Math.min(1,(activeAerialDuel?.elapsed||0)/1.05);
      sprite=frames[Math.min(frames.length-1,Math.floor(progress*frames.length))];
    }
  }
  if (v.state === "interact") {
   // Special avatars keep their own art while talking; never substitute a regular roster sprite.
   if (v.specialAvatar) {
     const frames = specialConversation[v.specialAvatar] || [];
     const allFramesReady = frames.length === CONVERSATION_FRAME_COUNT && frames.every(frame => frame.complete && frame.naturalWidth > 0);
     if (allFramesReady) sprite = frames[Math.floor(now / 1000 * 6) % CONVERSATION_FRAME_COUNT];
   } else {
     const frames = conversationFrames[c.kind] || [];
     const allFramesReady = frames.length === CONVERSATION_FRAME_COUNT && frames.every(frame => frame.complete && frame.naturalWidth > 0);
     if (allFramesReady) {
       // Animate at 6 frames per second; the pose stays synchronized to elapsed time.
       sprite = frames[Math.floor(now / 1000 * 6) % CONVERSATION_FRAME_COUNT];
     } else if (conversationSprites[c.kind] && conversationSprites[c.kind].complete && conversationSprites[c.kind].naturalWidth > 0) {
       sprite = conversationSprites[c.kind];
     }
   }
 }
 // Play each character's walk cycle while entering or leaving. Frame timing is
 // time-based so it remains consistent across displays.
 if ((v.state === "enter" || v.state === "leave" || v.state === "roam" || v.state === "duelApproach") && (v.specialAvatar ? specialWalk[v.specialAvatar] : walkFrames[c.kind])) {
   const frames = v.specialAvatar ? specialWalk[v.specialAvatar] : walkFrames[c.kind];
   const readyFrames = frames.filter(frame => frame.complete && frame.naturalWidth > 0);
   if (readyFrames.length === frames.length) {
     sprite = frames[Math.floor(now / 1000 * 9) % frames.length];
   }
 }
 if (sprite && sprite.complete && sprite.naturalWidth > 0) {
   // Every character uses one consistent height and keeps its original aspect ratio.
   // Do not randomize sprite scale: viewers should look equally sized in the crowd.
   const targetWidth = targetHeight * (sprite.naturalWidth / sprite.naturalHeight);
   const spriteTop = -targetHeight - CHARACTER_BOTTOM_INSET;
   ctx.imageSmoothingEnabled = true;
   ctx.imageSmoothingQuality = "high";
   // Mirror the walk sprite when moving left so Eika and Audrey face their travel direction.
   if (v.moveDir < 0 && (v.state === "enter" || v.state === "leave" || v.state === "roam" || v.state === "duelApproach" || v.state === "duelTakeoff" || v.state === "duelAirReady" || v.state === "duelFight" || v.state === "duelLand" || v.state === "idle" || v.state === "interact" || v.state === "flight")) {
     ctx.save(); ctx.scale(-1, 1); ctx.drawImage(sprite, -targetWidth / 2, spriteTop, targetWidth, targetHeight); ctx.restore();
   } else {
     ctx.drawImage(sprite, -targetWidth / 2, spriteTop, targetWidth, targetHeight);
   }
   if(!v.hideName){
   const label=v.username.length>15?v.username.slice(0,14)+"…":v.username;
   ctx.font="bold 16px Segoe UI,Arial";
   const tw=Math.min(126,ctx.measureText(label).width+14);
   ctx.fillStyle="#101322e8";rr(-tw/2,spriteTop-19,tw,17,7);
   ctx.fillStyle="#fff";ctx.textAlign="center";ctx.textBaseline="middle";
   ctx.fillText(label,0,spriteTop-10,tw-6);
   }
   ctx.restore();
   return;
 }
 // If a character has no idle.png yet, use the built-in procedural character while idle.
 // Walk frames are still used whenever all six files are available.
 // boots and legs
 ctx.fillStyle="#242638";rr(-12,-31+Math.max(0,step),9,22,3);rr(3,-31+Math.max(0,-step),9,22,3);
 ctx.fillStyle=c.trim;rr(-13,-12,11,7,2);rr(2,-12,11,7,2);
 ctx.fillStyle=c.cloth;ctx.beginPath();ctx.moveTo(-17,-65);ctx.lineTo(17,-65);ctx.lineTo(21,-32);ctx.quadraticCurveTo(0,-24,-21,-32);ctx.closePath();ctx.fill();
 // outfit details
 ctx.fillStyle=c.trim;ctx.beginPath();ctx.moveTo(-7,-64);ctx.lineTo(0,-52);ctx.lineTo(7,-64);ctx.closePath();ctx.fill();
 ctx.strokeStyle=c.skin;ctx.lineWidth=7;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(-16,-61);ctx.lineTo(-22,-43+step);ctx.moveTo(16,-61);ctx.lineTo(22,-43-step);ctx.stroke();
 // signature accessories
 if(c.kind==="eika"){ctx.fillStyle="#24232b";rr(-25,-59,9,31,3);rr(16,-59,9,31,3);ctx.fillStyle="#ff8b22";rr(-25,-43,5,6,1);rr(20,-43,5,6,1)}
 if(c.kind==="audrey"){ctx.fillStyle="#28242b";ctx.beginPath();ctx.moveTo(-22,-96);ctx.lineTo(-26,-119);ctx.lineTo(-10,-108);ctx.lineTo(0,-128);ctx.lineTo(10,-108);ctx.lineTo(26,-119);ctx.lineTo(22,-96);ctx.closePath();ctx.fill();ctx.fillStyle="#f9d879";for(const px of [-21,0,21]){ctx.beginPath();ctx.arc(px,-111-(px===0?15:0),2,0,6.283);ctx.fill()}}
 if(c.kind==="celestia"){ctx.fillStyle="#f3d66b";ctx.beginPath();ctx.arc(0,-64,4,0,6.283);ctx.fill()}
 // head
 ctx.fillStyle=c.skin;ctx.beginPath();ctx.ellipse(0,-84,19,21,0,0,6.283);ctx.fill();
 // hair silhouette
 ctx.fillStyle=c.hair;ctx.beginPath();ctx.moveTo(-19,-84);ctx.quadraticCurveTo(-26,-112,0,-112);ctx.quadraticCurveTo(25,-112,19,-82);ctx.lineTo(13,-91);ctx.lineTo(5,-98);ctx.lineTo(-5,-89);ctx.lineTo(-13,-94);ctx.closePath();ctx.fill();
 ctx.beginPath();ctx.moveTo(-18,-88);ctx.quadraticCurveTo(-28,-75,-18,-64);ctx.lineTo(-12,-83);ctx.fill();
 ctx.beginPath();ctx.moveTo(18,-88);ctx.quadraticCurveTo(28,-75,17,-64);ctx.lineTo(12,-83);ctx.fill();
 // hair streak
 if(c.kind==="eika"){ctx.fillStyle=c.hair2;ctx.beginPath();ctx.moveTo(5,-107);ctx.quadraticCurveTo(22,-103,18,-80);ctx.lineTo(12,-75);ctx.lineTo(9,-94);ctx.closePath();ctx.fill()}
 if(c.kind==="celestia"){ctx.fillStyle=c.hair2;ctx.beginPath();ctx.moveTo(-15,-103);ctx.quadraticCurveTo(0,-116,14,-102);ctx.lineTo(3,-92);ctx.closePath();ctx.fill()}
 if(c.kind==="audrey"){ctx.fillStyle=c.hair;ctx.beginPath();ctx.arc(-19,-70,8,0,6.283);ctx.arc(19,-70,8,0,6.283);ctx.fill()}
 // eyes and blush
 const blink=Math.sin(now*.0018+v.phase)>0.994;
 if(blink){ctx.strokeStyle="#342a3b";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-9,-84);ctx.lineTo(-5,-84);ctx.moveTo(5,-84);ctx.lineTo(9,-84);ctx.stroke()}
 else{ctx.fillStyle=c.eye;ctx.beginPath();ctx.ellipse(-7,-84,3.4,4.3,0,0,6.283);ctx.ellipse(7,-84,3.4,4.3,0,0,6.283);ctx.fill();ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(-6,-86,1.3,0,6.283);ctx.arc(8,-86,1.3,0,6.283);ctx.fill()}
 ctx.fillStyle="#ff9eaf66";ctx.beginPath();ctx.ellipse(-12,-74,4,2,0,0,6.283);ctx.ellipse(12,-74,4,2,0,0,6.283);ctx.fill();
 ctx.strokeStyle="#a94e5c";ctx.lineWidth=1.4;ctx.beginPath();ctx.arc(0,-76,3,.2,Math.PI-.2);ctx.stroke();
 // label
 const label=v.username.length>15?v.username.slice(0,14)+"…":v.username;ctx.font="bold 10px Segoe UI,Arial";const tw=Math.min(126,ctx.measureText(label).width+14);
 ctx.fillStyle="#101322e8";rr(-tw/2,-127,tw,17,7);ctx.fillStyle="#fff";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(label,0,-118,tw-6);
 ctx.restore();
}
function frame(now){
 // Cap overlay painting to 30 FPS. This limits the browser-source work while
 // keeping movement and animation time-based rather than tied to frame count.
 if(now-lastRender<FRAME_INTERVAL){requestAnimationFrame(frame);return;}
 const dt=Math.min((now-last)/1000,.05);last=now;lastRender=now;ctx.clearRect(0,0,W,H);
 const targetHeight=crowdCharacterHeight();
 const renderOrder=[];
 for(const v of viewers.values())renderOrder.push(v);
 renderOrder.sort((a,b)=>a.y-b.y);
 if(activeAerialDuel){
   if(activeAerialDuel.members.some(v=>v.state==="leave")){
     for(const v of activeAerialDuel.members)if(v.state.startsWith("duel")){v.state="idle";v.flightAltitude=0;v.roamTimer=rand(3,7);}
     activeAerialDuel=null;
   }
 }
 if(activeAerialDuel){
   activeAerialDuel.elapsed += dt;
   if(activeAerialDuel.stage==="approach" && activeAerialDuel.members.every(v=>v.state==="duelArrived")){
     activeAerialDuel.stage="takeoff";activeAerialDuel.elapsed=0;
     // Face each other before the takeoff animation starts, not just once
     // the aerial fight begins.
     for(const v of activeAerialDuel.members){
       const partner=activeAerialDuel.members.find(other=>other!==v);
       v.moveDir=Math.sign(partner.x-v.x)||v.moveDir;
       v.state="duelTakeoff";v.duelTakeoffElapsed=0;v.flightAltitude=0;
     }
   }
   for(const v of activeAerialDuel.members){
     if(v.state==="duelTakeoff"){
       v.duelTakeoffElapsed=(v.duelTakeoffElapsed||0)+dt;
       const progress=Math.min(1,v.duelTakeoffElapsed/0.9);
       v.flightAltitude=activeAerialDuel.fightAltitude*progress;
       if(v.duelTakeoffElapsed>=0.9){v.state="duelAirReady";v.flightAltitude=activeAerialDuel.fightAltitude;}
     }
   }
   if(activeAerialDuel.members.every(v=>v.state==="duelAirReady")){
     activeAerialDuel.stage="fight";activeAerialDuel.elapsed=0;
     for(const v of activeAerialDuel.members){
       const partner=activeAerialDuel.members.find(other=>other!==v);
       v.moveDir=Math.sign(partner.x-v.x)||v.moveDir;
       v.state="duelFight";v.flightAltitude=activeAerialDuel.fightAltitude;
       v.activeEmote=null;v.emoteUntil=0;
     }
   }else if(activeAerialDuel.stage==="fight" && activeAerialDuel.elapsed>=3.6){
     activeAerialDuel.stage="land";activeAerialDuel.elapsed=0;
     for(const v of activeAerialDuel.members)v.state="duelLand";
   }else if(activeAerialDuel.stage==="land" && activeAerialDuel.elapsed>=1.05){
     for(const v of activeAerialDuel.members){
       v.state="idle";v.flightAltitude=0;v.time=0;v.roamTimer=rand(3,7);
       v.socialTimer=rand(10,18);v.moveDir=v.duelOriginalDir||v.moveDir;
       delete v.duelTargetX;delete v.duelTakeoffElapsed;delete v.duelStartX;delete v.duelApproachElapsed;delete v.duelApproachDuration;
     }
     activeAerialDuel=null;
     if(demo&&status)status.textContent="Lilith vs N3Koyama: aerial duel complete!";
   }
 }
 for(const v of renderOrder){v.time+=dt;
 if(v.state==="duelApproach"){
   v.duelApproachElapsed=(v.duelApproachElapsed||0)+dt;
   const progress=Math.min(1,v.duelApproachElapsed/v.duelApproachDuration);
   v.moveDir=Math.sign(v.duelTargetX-v.duelStartX)||v.moveDir;
   const eased=progress*progress*(3-2*progress);
   v.x=v.duelStartX+(v.duelTargetX-v.duelStartX)*eased;
   if(progress>=1){v.x=v.duelTargetX;v.state="duelArrived";}
   draw(v,now,targetHeight);continue;
 }
 if(v.state==="duelArrived"){
   draw(v,now,targetHeight);continue;
 }
 if(v.state==="duelTakeoff" || v.state==="duelAirReady"){
   draw(v,now,targetHeight);continue;
 }
 if(v.state==="duelFight"){
   v.flightAltitude=activeAerialDuel.fightAltitude+Math.sin(activeAerialDuel.elapsed*7+(v===activeAerialDuel.members[0]?0:Math.PI))*13;
   draw(v,now,targetHeight);continue;
 }
 if(v.state==="duelLand"){
   v.flightAltitude=activeAerialDuel.fightAltitude*Math.max(0,1-activeAerialDuel.elapsed/1.05);
   draw(v,now,targetHeight);continue;
 }
 if(v.state==="raidDrop"){
   if(v.raidDelay>0){v.raidDelay=Math.max(0,v.raidDelay-dt);draw(v,now,targetHeight);continue;}
   v.raidVelocity=(v.raidVelocity||0)+Math.max(900,H*1.5)*dt;
   v.y+=v.raidVelocity*dt;
   const groundY=H-CHARACTER_BOTTOM_INSET;
   if(v.y>=groundY){
     v.y=groundY;v.state="idle";v.time=0;v.roamTimer=rand(2.5,6.5);v.socialTimer=rand(8,16);v.emoteTimer=rand(12,28);
     if(!v.raidImpact){for(let j=0;j<5;j++)particles.push({x:v.x+rand(-18,18),y:groundY-8,vx:rand(-60,60),vy:rand(-100,-35),life:rand(.35,.7),age:0,color:roster[v.skin].accent,shape:Math.random()<.5?"✦":"·"});v.raidImpact=true;}
   }
   draw(v,now,targetHeight);continue;
 }
 if(v.canFly && v.flightRequested && v.state!=="enter" && v.state!=="leave"){v.flightRequested=false;beginN3KoyamaFlight(v);}
 if(v.canFly && v.state==="idle" && v.flightCountdown!==Infinity){v.flightCountdown-=dt;if(v.flightCountdown<=0)beginN3KoyamaFlight(v);}
 if(v.state==="flight"){
   v.flightPhaseTime-=dt;
   if(v.flightPhase==="takeoff"){
     const progress=1-Math.max(0,v.flightPhaseTime)/0.9;v.flightAltitude=150*Math.max(0,Math.min(1,progress));
     if(v.flightPhaseTime<=0){v.flightPhase="glide";v.flightPhaseTime=v.flightDuration;v.flightAltitude=150;}
   }else if(v.flightPhase==="glide"){
     v.flightAltitude=142+Math.sin(now*0.0018+v.phase)*10;
     const dx=v.flightEndX-v.x;
     if(Math.abs(dx)<5){v.flightEndX=clampCharacterX(v,v.x+rand(-150,150));v.moveDir=Math.sign(v.flightEndX-v.x)||v.moveDir;}
     else v.x=clampCharacterX(v,v.x+Math.sign(dx)*65*dt);
     if(v.flightPhaseTime<=0){v.flightPhase="landing";v.flightPhaseTime=0.9;}
   }else if(v.flightPhase==="landing"){
     const progress=Math.max(0,v.flightPhaseTime)/0.9;v.flightAltitude=150*progress;
     if(v.flightPhaseTime<=0){v.flightAltitude=0;v.flightPhase=null;v.state="idle";v.time=0;v.roamTimer=rand(3,7);v.socialTimer=rand(10,18);v.flightCountdown=rand(270,330);}
   }
   draw(v,now,targetHeight);continue;
 }
 if(v.state==="enter"){
   // Walk into place at a steady speed instead of easing toward the target (which looks like flying).
   const distance=v.targetX-v.x;
   v.moveDir = Math.sign(distance) || v.moveDir;
   const speed=120; // pixels per second — closer to the six-frame walk cycle to reduce foot sliding
   if(Math.abs(distance)<=speed*dt){v.x=v.targetX;v.state="idle";v.time=0;}
   else {v.x+=Math.sign(distance)*speed*dt;}
 }else if(v.state==="idle"){
   // Occasionally play one available emote sprite while idle.
   v.emoteTimer -= dt;
   if (v.emoteTimer <= 0) {
     const available = (emoteSprites[roster[v.skin].kind] || []).filter(img => img.complete && img.naturalWidth > 0);
     if (available.length && Math.random() < 0.72) {
       v.activeEmote = pick(available);
       v.emoteUntil = now + rand(1800, 3200);
     }
     v.emoteTimer = rand(14, 32);
   }
   // A rare longer stroll gives the crowd more variety without breaking its layout.
   v.roamTimer-=dt;
   v.socialTimer-=dt;
   v.turnTimer=Math.max(0,v.turnTimer-dt);
   if(v.socialTimer<=0){
     const socialGap=Math.max(52,Math.min(82,gapBetween(v,v)*0.72));
     const candidates=[...viewers.values()].filter(o=>o!==v&&o.state==="idle"&&Math.abs(o.y-v.y)<28&&Math.abs(o.x-v.x)>=socialGap&&Math.abs(o.x-v.x)<=Math.max(105,socialGap+38));
     if(candidates.length && Math.random()<0.68){
       const partner=pick(candidates);
       // Start a quiet conversation with a nearby character. No walking over,
       // speech bubbles, hearts, or other overhead effects: they simply turn
       // toward each other and pause together for a few seconds.
       const conversationLength=rand(3,6);
       v.state="interact";v.interactionPartner=partner.id;v.interactionTime=conversationLength;v.activeEmote=null;v.emoteUntil=0;v.moveDir=Math.sign(partner.x-v.x)||v.moveDir;
       partner.state="interact";partner.interactionPartner=v.id;partner.interactionTime=conversationLength;partner.activeEmote=null;partner.emoteUntil=0;partner.moveDir=Math.sign(v.x-partner.x)||partner.moveDir;
     }
     v.socialTimer=rand(10,20);
   }
   if(v.state==="idle"&&v.roamTimer<=0){
     const longWalk=Math.random()<0.12;
     const crowdCount=[...viewers.values()].filter(o=>o.state!=="leave").length;
     const maxDrift=longWalk?rand(64,104):Math.min(crowdCount>=20?24:38,Math.max(14,W*0.022));
     v.roamKind=longWalk?"long":"short";
     // Wander around the current position, not the assigned layout slot.
     // This prevents strolls from repeatedly pulling characters toward gaps.
     v.roamTargetX=clampCharacterX(v,v.x+rand(-maxDrift,maxDrift));
     if(Math.abs(v.roamTargetX-v.x)>10){v.state="roam";v.moveDir=Math.sign(v.roamTargetX-v.x)||v.moveDir;v.turnTimer=rand(0.12,0.3);}
     else v.roamTimer=rand(2.5,6.5);
   }
 }else if(v.state==="roam"){
   const distance=v.roamTargetX-v.x, strollSpeed=v.roamKind==="long"?68:78;
   v.moveDir=Math.sign(distance)||v.moveDir;
   if(Math.abs(distance)<=strollSpeed*dt){
     const stopX=safeRoamStop(v,v.roamTargetX);
     if(stopX!==null&&Math.abs(stopX-v.x)>MIN_GAP/2){
       // If the chosen stop is occupied, keep walking toward the nearest clear spot.
       v.roamTargetX=stopX;v.moveDir=Math.sign(stopX-v.x)||v.moveDir;
     }else if(stopX!==null){v.x=stopX;v.state="idle";v.roamTimer=rand(2.5,6.5);v.turnTimer=rand(0.15,0.35);}
     else {v.state="idle";v.roamTimer=rand(2.5,6.5);v.turnTimer=rand(0.15,0.35);}
   }else v.x+=Math.sign(distance)*strollSpeed*dt;
 }else if(v.state==="interact"){
   v.interactionTime-=dt;
   const partner=viewers.get(v.interactionPartner);
   if(partner&&partner.state==="interact")v.moveDir=Math.sign(partner.x-v.x)||v.moveDir;
   if(v.interactionTime<=0||!partner||partner.state!=="interact"){
     v.state="idle";v.interactionPartner=null;v.roamTimer=rand(3,7);v.socialTimer=rand(8,16);
   }
 }else{v.moveDir=-1;v.x-=320*dt;if(v.x< -80||v.time>5){viewers.delete(v.id);layout();count();continue}}draw(v,now,targetHeight)}
 for(let i=particles.length-1;i>=0;i--){let p=particles[i];p.age+=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=130*dt;ctx.globalAlpha=Math.max(0,1-p.age/p.life);ctx.fillStyle=p.color;ctx.font="16px Arial";ctx.fillText(p.shape,p.x,p.y);ctx.globalAlpha=1;if(p.age>p.life)particles.splice(i,1)}
 requestAnimationFrame(frame)}
function startN3KoyamaFlight(){
 let v=viewers.get("n3koyama");
 if(!v){ if(!add("n3koyama")) return; v=viewers.get("n3koyama"); }
 if(!v || !v.canFly) return;
 // If entering, finish getting into the crowd before starting the requested flight.
 if(v.state==="enter"){v.flightRequested=true;return;}
 beginN3KoyamaFlight(v);
}
function beginN3KoyamaFlight(v){
 v.state="flight";v.flightPhase="takeoff";v.flightPhaseTime=0.9;v.flightDuration=rand(5,8);v.flightAltitude=0;
 v.flightEndX=clampCharacterX(v,v.x+rand(-190,190));v.moveDir=Math.sign(v.flightEndX-v.x)||v.moveDir;
 v.activeEmote=null;v.emoteUntil=0;v.flightCountdown=Infinity;
}
async function testAerialDuel(){
 if(!demo)return;
 if(activeAerialDuel){if(status)status.textContent="An aerial duel is already running.";return;}
 // Discover Lilith from the assets directory if she has not been registered yet.
 if(!roster.some(c=>c.kind.toLowerCase()==="lilith")){
   try{
     const response=await fetch('/api/characters',{cache:'no-store'});const data=await response.json();
     if(response.ok&&data.ok&&Array.isArray(data.characters))for(const folder of data.characters)registerDiscoveredCharacter(folder);
   }catch(error){if(status)status.textContent=`Could not scan character folders: ${error.message}`;return;}
 }
 const lilithSkin=roster.findIndex(c=>c.kind.toLowerCase()==="lilith");
 if(lilithSkin<0){if(status)status.textContent="Lilith folder not detected. Check assets/Lilith/ and press Refresh character list.";return;}
 // Ensure the reserved special-avatar mapping is active for the N3Koyama duel participant.
 let lilith=viewers.get("lilith"),n3=viewers.get("n3koyama");
 if(!lilith){add("Lilith",lilithSkin);lilith=viewers.get("lilith");}
 if(!n3){add("n3koyama");n3=viewers.get("n3koyama");}
 if(!lilith||!n3){if(status)status.textContent="Could not add both duel participants (crowd may be full). Remove a character and try again.";return;}
 const unavailable=[lilith,n3].some(v=>v.state==="leave"||v.state==="raidDrop"||v.state==="flight"||v.state.startsWith("duel"));
 if(unavailable){if(status)status.textContent="Lilith or N3Koyama is busy. Let their current animation finish, then try again.";return;}
 lilith.skin=lilithSkin;
 n3.specialAvatar="n3koyama";n3.canFly=true;
 loadFightFrames(roster[lilithSkin].kind);
 loadFightFrames("n3koyama","n3koyama");
 loadDuelTakeoffFrames(roster[lilithSkin].kind);
 loadDuelTakeoffFrames("n3koyama","n3koyama");
 // Choose a random destination across the usable screen width.
 // Keep the fighters in left/right order and separated by a safe gap.
 const leftFighter=lilith.x<=n3.x?lilith:n3;
 const rightFighter=leftFighter===lilith?n3:lilith;
 const edgeMargin=110;
 const fightCenterX=rand(edgeMargin,Math.max(edgeMargin,W-edgeMargin));
 leftFighter.duelTargetX=clampCharacterX(leftFighter,fightCenterX-78);
 rightFighter.duelTargetX=clampCharacterX(rightFighter,fightCenterX+78);
 if(rightFighter.duelTargetX-leftFighter.duelTargetX<150){
   rightFighter.duelTargetX=clampCharacterX(rightFighter,leftFighter.duelTargetX+150);
   leftFighter.duelTargetX=clampCharacterX(leftFighter,rightFighter.duelTargetX-150);
 }
 const fightAltitude=rand(95,205);
 loadDuelLandingFrames(roster[lilithSkin].kind);
 loadDuelLandingFrames("n3koyama","n3koyama");
 lilith.duelOriginalDir=lilith.moveDir;n3.duelOriginalDir=n3.moveDir;
 const sharedTravelDuration=Math.max(Math.abs(lilith.duelTargetX-lilith.x),Math.abs(n3.duelTargetX-n3.x))/155;
 for(const v of [lilith,n3]){
   v.duelStartX=v.x;v.duelApproachElapsed=0;
   v.duelApproachDuration=Math.max(0.45,sharedTravelDuration);
   v.state="duelApproach";v.time=0;v.activeEmote=null;v.emoteUntil=0;
 }
 activeAerialDuel={members:[lilith,n3],stage:"approach",elapsed:0,fightAltitude};
 if(status)status.textContent="Lilith and N3Koyama are approaching each other…";
}
const duelButton=document.getElementById("testAerialDuel");
if(duelButton)duelButton.addEventListener("click",testAerialDuel);
const flyButton=document.getElementById("flyN3Koyama");
if(flyButton)flyButton.addEventListener("click",startN3KoyamaFlight);
const refreshCharactersButton=document.getElementById("refreshCharacters");
if(refreshCharactersButton)refreshCharactersButton.addEventListener("click",refreshCharacterList);
refreshCharacterList();
setInterval(refreshCharacterList, 10000);
document.getElementById("add").addEventListener("click",()=>{
  const character=nextDemoCharacter();
  if(character)add(character.name,character.skin);
});
let specialCursor=0;
function addNextSpecialAvatar(){
 if(!roster.length||!SPECIAL_AVATARS.length)return;
 for(let i=0;i<SPECIAL_AVATARS.length;i++){
  const item=SPECIAL_AVATARS[(specialCursor+i)%SPECIAL_AVATARS.length];
  if(!viewers.has(item.username.toLowerCase())){specialCursor=(specialCursor+i+1)%SPECIAL_AVATARS.length;add(item.username);return;}
 }
}
const addSpecialButton=document.getElementById("addSpecial");
if(addSpecialButton)addSpecialButton.addEventListener("click",addNextSpecialAvatar);
const testRaidButton=document.getElementById("testRaid");if(testRaidButton)testRaidButton.addEventListener("click",testRaid);
document.getElementById("remove").addEventListener("click",removeRandom);
document.getElementById("clear").addEventListener("click",clear);
document.getElementById("burst").addEventListener("click",cheer);
const talkButton=document.getElementById("talkTest");if(talkButton)talkButton.addEventListener("click",talkTest);
addEventListener("keydown",e=>{if(e.key==="+"||e.key==="="){const character=nextDemoCharacter();if(character)add(character.name,character.skin)}if(e.key.toLowerCase()==="s")addNextSpecialAvatar();if(e.key.toLowerCase()==="f")startN3KoyamaFlight();if(e.key==="-"||e.key==="_")removeRandom();if(e.key.toLowerCase()==="r")clear();if(e.key.toLowerCase()==="c")cheer()});
// Initial demo crowd is populated after the first successful assets-directory scan.
// Twitch local connector bridge. This only listens to the local connector and does not alter animation logic.
let twitchSocket=null,twitchRetryTimer=null;
function applyAvatarChoice(username, requestedCharacter, isVip=false){
 const cleanUsername=String(username||"").trim().slice(0,32),key=cleanUsername.toLowerCase();
 // Reserved special-avatar users and Twitch VIPs cannot override their assigned avatar.
 if(!cleanUsername||isVip||specialByLogin.has(key))return false;
 const requested=String(requestedCharacter||"").trim().toLowerCase();
 const character=roster.find(c=>c.name.toLowerCase()===requested||c.kind.toLowerCase()===requested||c.name.toLowerCase().replace(/[^a-z0-9]/g,"")===requested.replace(/[^a-z0-9]/g,""));
 if(!character)return false;
 let viewer=viewers.get(key);
 if(!viewer){add(cleanUsername);viewer=viewers.get(key);}
 if(viewer&&!viewer.specialAvatar){
   viewer.skin=roster.indexOf(character);
   viewer.activeEmote=null;viewer.emoteUntil=0;
   viewer.state=viewer.state==="leave"?"idle":viewer.state;
   layout();
   return true;
 }
 return false;
}

function connectTwitchBridge(){
  if(twitchSocket && (twitchSocket.readyState===WebSocket.OPEN||twitchSocket.readyState===WebSocket.CONNECTING))return;
  try{
    twitchSocket=new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/bridge");
    twitchSocket.addEventListener("message",event=>{
      let data;try{data=JSON.parse(event.data)}catch{return}
      if(!data||typeof data!="object")return;
      if(data.type==="snapshot"&&Array.isArray(data.usernames)){
        // A page refresh loses its in-memory characters. Rebuild them from the
        // connector's current Twitch membership snapshot.
        clear();
        for(const username of data.usernames){if(typeof username==="string")add(username.trim().slice(0,32));}
      }
      if(data.type==="join"&&typeof data.username==="string")add(data.username.trim().slice(0,32));
      if(data.type==="part"&&typeof data.username==="string")remove(data.username.trim());
      if(data.type==="avatarPreferences"&&data.preferences&&typeof data.preferences==="object"){
        // Reapply saved choices after the membership snapshot has rebuilt the live crowd.
        for(const [savedLogin, savedCharacter] of Object.entries(data.preferences)){
          if(typeof savedLogin!=="string"||typeof savedCharacter!=="string")continue;
          const username=[...viewers.values()].find(v=>v.username.toLowerCase()===savedLogin.toLowerCase())?.username;
          if(username)applyAvatarChoice(username,savedCharacter,false);
        }
      }
      if(data.type==="avatarChange"&&typeof data.username==="string"&&typeof data.character==="string"){
        applyAvatarChoice(data.username,data.character,data.isVip===true);
      }
      if(data.type==="raid"){const raidCount=Math.max(1,Math.min(MAX,Number(data.viewers)||1));spawnRaid(raidCount);}
      if(data.type==="chatSeen"&&typeof data.username==="string")assignRaidGuestName(data.username);
      if(data.type==="status"&&demo&&status)status.textContent="Twitch connector: "+String(data.message||"connected");
    });
    twitchSocket.addEventListener("close",()=>{twitchRetryTimer=setTimeout(connectTwitchBridge,3000)});
    twitchSocket.addEventListener("error",()=>{try{twitchSocket.close()}catch{}});
  }catch{twitchRetryTimer=setTimeout(connectTwitchBridge,3000)}
}
connectTwitchBridge();
addEventListener("message",e=>{if(e.origin!==location.origin||!e.data||typeof e.data!=="object")return;if(e.data.type==="crowd:join"&&typeof e.data.username==="string")add(e.data.username.trim().slice(0,32));if(e.data.type==="crowd:leave"&&typeof e.data.username==="string")remove(e.data.username.trim());if(e.data.type==="crowd:cheer")cheer();if(e.data.type==="crowd:clear")clear()});
resize();count();requestAnimationFrame(frame);
})();
(() => {
  "use strict";
  const input = document.getElementById("newCharacterName");
  const normalButton = document.getElementById("createNormalCharacterFolder");
  const specialButton = document.getElementById("createSpecialCharacterFolder");
  const flyingButton = document.getElementById("createFlyingCharacterFolder");
  const status = document.getElementById("characterFolderStatus");
  if (!input || !normalButton || !specialButton || !flyingButton || !status) return;
  async function createFolder(type) {
    const name = input.value.trim();
    if (!name) { status.textContent = "Enter a character name first."; input.focus(); return; }
    const button = type === "special" ? specialButton : type === "flying" ? flyingButton : normalButton;
    normalButton.disabled = specialButton.disabled = flyingButton.disabled = true;
    status.textContent = type === "special" ? "Creating special avatar folders…" : type === "flying" ? "Creating flying character folders…" : "Creating normal character folders…";
    try {
      const response = await fetch("/api/characters", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
      const kind = type === "special" ? "Special avatar" : type === "flying" ? "Flying character" : "Normal character";
      const folders = type === "flying" ? "walk/, takeoff/, fly/, landing/, falling/, emotes/" : "walk/, conversation/, emotes/";
      status.textContent = `${result.created ? "Created" : "Folder already existed; checked folders"}: ${result.path} (${kind}) with ${folders}, idle.png, and README.txt.`;
    } catch (error) {
      status.textContent = `Could not create folder: ${error.message}. Start the included local connector and open its demo URL.`;
    } finally { normalButton.disabled = specialButton.disabled = flyingButton.disabled = false; }
  }
  normalButton.addEventListener("click", () => createFolder("normal"));
  specialButton.addEventListener("click", () => createFolder("special"));
  flyingButton.addEventListener("click", () => createFolder("flying"));
  input.addEventListener("keydown", event => { if (event.key === "Enter") createFolder("normal"); });
})();

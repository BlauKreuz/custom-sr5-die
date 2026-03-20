/**
 * custom-sr5-die.js
 *
 * Adds an "SR5 Die" system to Dice So Nice for the ds (Shadowrun) and d6
 * die types. The GM selects a single-row sprite sheet (1 row, 6 columns,
 * smallest die face at left) from the module's images/ folder in the module settings.
 *
 * Also unlocks all other DSN appearance systems for the ds die type so that
 * Dot Black and others remain selectable.
 */

const MODULE_ID = "custom-sr5-die";
const SR5_SYSTEM_ID = "shadowrun5e";
const DS_TYPE = "ds";
const IMAGES_DIR = `modules/${MODULE_ID}/images`;
const ASSETS_DIR = `modules/${MODULE_ID}/assets/images`;

// Evaluated lazily (not at module parse time) so that ForgeVTT is guaranteed
// to be initialised by the time any hook using it fires.
function isForge() {
  return typeof ForgeVTT !== "undefined" && ForgeVTT.usingTheForge;
}

// DiceSystem class imported during setup so diceSoNiceReady can run synchronously.
let _DiceSystem = null;

// Hooks fire in order: init → setup → ready → diceSoNiceReady.
// Importing here means _DiceSystem is set long before diceSoNiceReady fires.
Hooks.once("setup", async () => {
  if (!game.modules.get("dice-so-nice")?.active) return;
  try {
    ({ DiceSystem: _DiceSystem } = await import("/modules/dice-so-nice/api.js"));
  } catch (err) {
    console.warn("Custom SR5 Die: could not pre-import DiceSystem from Dice So Nice.", err);
  }
});

// ── Settings ──────────────────────────────────────────────────────────────────

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "spriteImage", {
    name: "SR5 Die Sprite Sheet",
    scope: "world",
    config: true,
    type: String,
    default: "",
    restricted: true,
    requiresReload: true,
  });
});

// ── Settings config injection ────────────────────────────────────────────────

// Inject the thumbnail picker into the Game Settings page, replacing the plain
// text input that Foundry renders for the spriteImage setting.
Hooks.on("renderSettingsConfig", async (_app, html) => {
  if (!game.modules.get("dice-so-nice")?.active) return;

  // Handle both jQuery (V11/V12) and plain HTMLElement (V13 ApplicationV2).
  const root = (html instanceof jQuery) ? html[0] : html;
  const input = root.querySelector(`input[name="${MODULE_ID}.spriteImage"]`);
  if (!input) return;
  const formGroup = input.closest(".form-group");
  if (!formGroup) return;

  // Stack the form-group vertically so thumbnails have the full width.
  formGroup.style.flexDirection = "column";
  formGroup.style.alignItems = "flex-start";

  // On Forge, migrate bundled samples from the read-only CDN folder into the
  // writable assets folder so users can manage (replace/delete) them freely.
  const forge = isForge();
  const writableDir = forge ? ASSETS_DIR : IMAGES_DIR;
  if (forge) await migrateBundledImages();

  let available = [];
  try {
    const result = await FilePicker.browse("data", writableDir);
    available = result.files.filter((f) => /\.(webp|png|jpg|jpeg)$/i.test(f));
  } catch { /* folder may not exist yet */ }

  const current = game.settings.get(MODULE_ID, "spriteImage");
  const esc = (v) => foundry.utils.escapeHTML(String(v ?? ""));
  const fname = (p) => p.split("/").pop();

  const thumbsHtml = available.map((path) => {
    const sel = path === current;
    return [
      `<div class="sr5-thumb" data-path="${esc(path)}"`,
      ` style="cursor:pointer;padding:4px;margin-bottom:2px;border-radius:4px;`,
      `display:flex;flex-direction:row;align-items:center;gap:8px;`,
      `border:2px solid ${sel ? "#7272725b" : "transparent"};`,
      `background:${sel ? "rgb(255, 255, 255)" : "transparent"};">`,
      `<img src="${esc(path)}" style="width:80%;height:auto;display:block;border-radius:2px;flex-shrink:0;">`,
      `<span style="font-size:.7em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">`,
      esc(fname(path)),
      `</span></div>`,
    ].join("");
  }).join("");

  const listHtml = available.length
    ? `<div style="width:90%;max-height:400px;overflow-y:auto;border:1px solid var(--color-border-light-tertiary,#999);border-radius:4px;padding:4px;box-sizing:border-box;">${thumbsHtml}</div>`
    : `<p style="font-style:italic;font-size:.85em;margin:4px 0;">No images found in <code>${esc(IMAGES_DIR)}/</code>.</p>`;

  const container = document.createElement("div");
  container.style.cssText = "width:100%;margin-top:4px;";
  container.innerHTML = [
    `<p style="font-size:.85em;margin:0 0 6px;white-space:normal;">`,
    `Place sprite sheets (6 faces, left to right) in <code>${esc(writableDir)}/</code>`,
    forge ? ` (your Forge Assets Library).` : `.`,
    `<br>Click a sprite to select and slice it, then click <strong>Save Changes</strong>.</p>`,
    `<input type="hidden" name="${MODULE_ID}.spriteImage" id="sr5-path-input" value="${esc(current)}">`,
    listHtml,
  ].join("");

  input.replaceWith(container);

  // Thumbnail click — slice the sprite, then update the hidden input and highlight.
  container.querySelectorAll(".sr5-thumb").forEach((card) => {
    card.addEventListener("click", async () => {
      const path = card.dataset.path;
      const allCards = [...container.querySelectorAll(".sr5-thumb")];
      // Disable all cards while slicing, but only dim the clicked one.
      allCards.forEach((c) => { c.style.pointerEvents = "none"; });
      card.style.opacity = "0.6";
      const label = card.querySelector("span");
      const origText = label.textContent;
      label.textContent = "\u29d7 Slicing\u2026";
      try {
        await sliceAndUploadFaces(path);
        container.querySelector("#sr5-path-input").value = path;
        allCards.forEach((c) => {
          const sel = c.dataset.path === path;
          c.style.borderColor = sel ? "#094d97" : "transparent";
          c.style.background  = sel ? "rgb(255, 255, 255)" : "transparent";
          c.querySelector("span").textContent = fname(c.dataset.path);
        });
        label.textContent = "\u2713 " + origText;
      } catch (err) {
        console.error(err);
        ui.notifications.error(`SR5 Dice: ${err.message}`);
        label.textContent = origText;
      } finally {
        allCards.forEach((c) => { c.style.pointerEvents = ""; });
        card.style.opacity = "";
      }
    });
  });
});



// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * On Forge, copy bundled sample images from the read-only CDN folder
 * (modules/…/images/) into the writable assets folder (modules/…/assets/images/)
 * so users can freely replace or delete them. Already-present files are skipped.
 */
async function migrateBundledImages() {
  let bundled = [];
  try {
    const r = await FilePicker.browse("data", IMAGES_DIR);
    bundled = r.files.filter((f) => /\.(webp|png|jpg|jpeg)$/i.test(f));
  } catch { return; }
  if (!bundled.length) return;

  const existing = new Set();
  try {
    const r = await FilePicker.browse("data", ASSETS_DIR);
    for (const f of r.files) existing.add(f.split("/").pop().toLowerCase());
  } catch { /* assets folder doesn't exist yet — that's fine */ }

  for (const path of bundled) {
    const name = path.split("/").pop();
    if (existing.has(name.toLowerCase())) continue;
    try {
      const resp = await fetch(path, { credentials: "same-origin" });
      if (!resp.ok) continue;
      const blob = await resp.blob();
      const file = new File([blob], name, { type: blob.type });
      await FilePicker.upload("data", ASSETS_DIR, file, {}, { notify: false });
    } catch (err) {
      console.warn(`SR5 Dice: could not migrate sample "${name}":`, err);
    }
  }
}

/**
 * Load imagePath, slice it into 6 equal vertical strips (columns), and upload
 * each strip as an individual .webp file. The sprite sheet is a single row of
 * 6 faces arranged left to right (smallest die face at left).
 *
 * DSN's loadTextureType() uses /\.(png|jpg|jpeg|gif|webp)$/i to decide if a
 * label is an image. These filenames end with .webp so DSN loads them as
 * textures. Using individual files avoids needing an atlas JSON.
 *
 * Uploaded as: {folder}/faces/{baseName}-face-1.webp … {baseName}-face-6.webp
 */
async function sliceAndUploadFaces(imagePath) {
  const img = await new Promise((res, rej) => {
    const el = new Image();
    el.crossOrigin = "anonymous";   // prevent canvas taint on Forge / CDN origins
    el.onload = () => {
      if (!el.naturalWidth || !el.naturalHeight)
        rej(new Error(`sprite "${imagePath}" has zero dimensions`));
      else
        res(el);
    };
    el.onerror = () => rej(new Error(`cannot load sprite "${imagePath}"`));
    el.src = imagePath;
  });

  const h   = img.naturalHeight;
  const fw  = Math.floor(img.naturalWidth / 6);
  const folder   = imagePath.substring(0, imagePath.lastIndexOf("/")) + "/faces";
  const baseName = imagePath.split("/").pop().replace(/\.[^.]+$/, "");

  for (let i = 0; i < 6; i++) {
    const cv = document.createElement("canvas");
    cv.width  = fw;
    cv.height = h;
    cv.getContext("2d").drawImage(img, -i * fw, 0);
    const blob = await new Promise((res) => cv.toBlob(res, "image/webp", 0.92));
    const file = new File([blob], `${baseName}-face-${i + 1}.webp`, { type: "image/webp" });
    await FilePicker.upload("data", folder, file, {}, { notify: false });
  }
}

// ── Dice So Nice ready ────────────────────────────────────────────────────────

// This handler is intentionally synchronous. _DiceSystem was imported during
// the setup hook, and the atlas JSON was generated when the setting was saved,
// so no async operations are needed here.
Hooks.once("diceSoNiceReady", (dice3d) => {
  if (!dice3d) return;
  if (game.system?.id !== SR5_SYSTEM_ID) return;

  const factory = dice3d.DiceFactory;

  // Unlock every existing DSN system for the ds die type so that Dot Black
  // and others remain selectable (DSN's filterSystems() requires the die type
  // to be registered in each system's dice map).
  // Skipping "standard" so the SR5 system's own text-label preset for ds is
  // never touched. Passing the d6 reference directly is safe: the same object
  // is already owned by this system so DiceMap.set's diceSystem assignment
  // is a no-op, and its textures are already loaded.
  for (const [sysId, system] of factory.systems) {
    if (sysId !== "standard" && !system.dice.has(DS_TYPE)) {
      const d6 = system.dice.get("d6");
      if (d6) system.dice.set(DS_TYPE, d6);
    }
  }

  // The rest requires DiceSystem and a configured sprite image.
  if (!_DiceSystem) return;
  const imagePath = game.settings.get(MODULE_ID, "spriteImage")?.trim();
  if (!imagePath) return;

  // Derive the 6 pre-uploaded face paths using the same formula as sliceAndUploadFaces.
  // Labels end with .webp so DSN's loadTextureType() treats them as image URLs.
  const folder   = imagePath.substring(0, imagePath.lastIndexOf("/")) + "/faces";
  const baseName = imagePath.split("/").pop().replace(/\.[^.]+$/, "");
  const FACE_LABELS = Array.from({ length: 6 }, (_, i) => `${folder}/${baseName}-face-${i + 1}.webp`);

  const sr5System = new _DiceSystem("sr5-die", "SR5 Die", "default", "Dice So Nice!");
  dice3d.addSystem(sr5System, "default");

  // Save standard's ds preset before registering ours.
  // DSN's register() checks: if standard already has this die type AND the
  // existing preset has internalAdd=true (set by internalAddDicePreset, which
  // is how SR5 registers the ds die), it replaces standard's preset with our
  // new one. We don't want that — SR5 Die must only add a new system option
  // without touching what "standard" shows.
  const standardDs = factory.systems.get("standard").dice.get(DS_TYPE);

  dice3d.addDicePreset({ type: "d6",    labels: FACE_LABELS, system: "sr5-die" }, "d6");
  dice3d.addDicePreset({ type: DS_TYPE, labels: FACE_LABELS, system: "sr5-die" }, "d6");

  // Restore standard's ds immediately after — DSN's register() may have
  // replaced it due to the internalAdd flag. DiceMap.set won't mutate
  // standardDs because the key already exists in the map.
  if (standardDs) factory.systems.get("standard").dice.set(DS_TYPE, standardDs);

  // DSN's register() skips loadTextures() for our presets when standard already
  // has the die type (which it does). Call it explicitly so the face images
  // are actually loaded into the GPU texture cache.
  const d6p = sr5System.dice.get("d6");
  const dsp = sr5System.dice.get(DS_TYPE);
  if (d6p?.loadTextures) d6p.loadTextures().catch((e) => console.error("SR5 Dice (d6):", e));
  if (dsp?.loadTextures) dsp.loadTextures().catch((e) => console.error("SR5 Dice (ds):", e));
});

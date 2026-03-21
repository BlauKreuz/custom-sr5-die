/**
 * custom-sr5-die.js
 *
 * Adds an "SR5 Die" system to Dice So Nice for the ds (Shadowrun) and d6
 * die types. The GM selects a single-row sprite sheet (1 row, 6 columns,
 * smallest die face at left) from the world's sheets folder in the module settings.
 *
 * Also unlocks all other DSN appearance systems for the ds die type so that
 * Dot Black and others remain selectable.
 */

const MODULE_ID = "custom-sr5-die";
const SR5_SYSTEM_ID = "shadowrun5e";
const DS_TYPE = "ds";

// Bundled sample sprite sheets shipped with the module (read-only on Forge CDN).
const BUNDLED_DIR     = `modules/${MODULE_ID}/images`;
// The default sheet pre-selected on first install.
const BUNDLED_DEFAULT = `${BUNDLED_DIR}/A.PNG`;

// Shared top-level folders in the Foundry Data directory.
// V13 explicitly allows uploads into new top-level folders created next to
// modules/, systems/, and worlds/. Storing here means all worlds share the
// same sheet pool; each world independently picks which sheet to use.
const SHEETS_DIR = "sr5-die-sheets";
const FACES_DIR  = "sr5-die-sheets/faces";

// DiceSystem class imported during setup so diceSoNiceReady can run synchronously.
let _DiceSystem = null;
// Migration promise started in setup. diceSoNiceReady awaits it before
// registering face textures so files always exist on the very first load.
let _migrationPromise = null;

// Hooks fire in order: init → setup → ready → diceSoNiceReady.
// Importing here means _DiceSystem is set long before diceSoNiceReady fires.
Hooks.once("setup", async () => {
  if (!game.modules.get("dice-so-nice")?.active) return;

  // Start sheet migration BEFORE any await so _migrationPromise is guaranteed
  // to be assigned before diceSoNiceReady fires, even if the DSN import is slow.
  if (game.user?.isGM) {
    _migrationPromise = migrateBundledSheets().catch((err) =>
      console.error("SR5 Dice | migration (sheets) failed:", err)
    );
  }

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
    default: BUNDLED_DEFAULT,
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

  // SHEETS_DIR is already populated by the ready hook migration.
  // Just browse what is there — no async migration latency here.
  let available = [];
  try {
    const result = await FilePicker.browse("data", SHEETS_DIR);
    available = result.files.filter((f) => /\.(webp|png|jpg|jpeg)$/i.test(f));
  } catch { /* sheets folder may not exist yet */ }

  const current = game.settings.get(MODULE_ID, "spriteImage");
  // If the setting still holds the bundled default path, map it to the
  // equivalent SHEETS_DIR path for highlight purposes so A.PNG appears
  // pre-selected the first time the user opens settings.
  const isBundledSetting = current.startsWith(`modules/${MODULE_ID}/`);
  const displayCurrent = isBundledSetting
    ? `${SHEETS_DIR}/${current.split("/").pop()}`
    : current;
  const esc = (v) => foundry.utils.escapeHTML(String(v ?? ""));
  const fname = (p) => p.split("/").pop();

  const thumbsHtml = available.map((path) => {
    const sel = path === displayCurrent;
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
    : `<p style="font-style:italic;font-size:.85em;margin:4px 0;">No images found in <code>${esc(SHEETS_DIR)}/</code>.</p>`;

  const container = document.createElement("div");
  container.style.cssText = "width:100%;margin-top:4px;";
  container.innerHTML = [
    `<p style="font-size:.85em;margin:0 0 6px;white-space:normal;">`,
    `Add or remove sprite sheets in <code>${esc(SHEETS_DIR)}/</code> — shared across all worlds.<br>`,
    `Click a sprite to select and slice it, then click <strong>Save Changes</strong>.</p>`,
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
        // Set the saved path immediately so that clicking Save before slicing
        // finishes still records the correct sheet. If slicing is still in
        // progress on reload, faces may 404 silently; the user only needs to
        // click the sheet again and save once more.
        container.querySelector("#sr5-path-input").value = path;
        await sliceAndUploadFaces(path);
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
 * Ensure every segment of path exists in the "data" source, creating
 * directories one level at a time. FilePicker.upload does NOT create missing
 * directories, so this must be called before any upload into a new path.
 */
async function ensureDir(path) {
  const parts = path.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    try {
      await FilePicker.createDirectory("data", current, {});
    } catch (err) {
      // Ignore "already exists" — re-throw anything unexpected.
      const msg = String(err?.message ?? err).toLowerCase();
      if (!msg.includes("already exists") && !msg.includes("eexist"))
        console.error(`SR5 Dice | ensureDir: could not create "${current}":`, err);
    }
  }
}

/**
 * Copy bundled sample sheets from the module's images/ folder into the
 * writable SHEETS_DIR. Already-present files are skipped.
 */
async function migrateBundledSheets() {
  let bundled = [];
  try {
    const r = await FilePicker.browse("data", BUNDLED_DIR);
    bundled = r.files.filter((f) => /\.(webp|png|jpg|jpeg|md)$/i.test(f));
  } catch (err) {
    console.error("SR5 Dice | migrateBundledSheets: could not browse bundled dir:", err);
    return;
  }
  if (!bundled.length) {
    console.warn(`SR5 Dice | migrateBundledSheets: no images found in ${BUNDLED_DIR}`);
    return;
  }

  await ensureDir(SHEETS_DIR);

  const existing = new Set();
  try {
    const r = await FilePicker.browse("data", SHEETS_DIR);
    for (const f of r.files) existing.add(f.split("/").pop().toLowerCase());
  } catch { /* still empty — that's fine */ }

  for (const path of bundled) {
    const name = path.split("/").pop();
    if (existing.has(name.toLowerCase())) continue;
    try {
      const resp = await fetch(path, { credentials: "same-origin" });
      if (!resp.ok) { console.error(`SR5 Dice | migrateBundledSheets: fetch failed for "${name}": ${resp.status}`); continue; }
      const blob = await resp.blob();
      const file = new File([blob], name, { type: blob.type });
      await FilePicker.upload("data", SHEETS_DIR, file, {}, { notify: false });
    } catch (err) {
      console.error(`SR5 Dice | migrateBundledSheets: could not migrate "${name}":`, err);
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
 * Writes {baseName}-face-1.webp … {baseName}-face-6.webp, where baseName is derived
 * from imagePath. Unique names per sheet avoid Forge CDN and PIXI texture cache
 * stale hits that occur when overwriting a fixed generic filename.
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

  const h        = img.naturalHeight;
  const fw       = Math.floor(img.naturalWidth / 6);
  const baseName = imagePath.split("/").pop().replace(/\.[^.]+$/, "");

  await ensureDir(FACES_DIR);

  for (let i = 0; i < 6; i++) {
    const cv = document.createElement("canvas");
    cv.width  = fw;
    cv.height = h;
    cv.getContext("2d").drawImage(img, -i * fw, 0);
    const blob = await new Promise((res) => cv.toBlob(res, "image/webp", 0.92));
    const file = new File([blob], `${baseName}-face-${i + 1}.webp`, { type: "image/webp" });
    await FilePicker.upload("data", FACES_DIR, file, {}, { notify: false });
  }
}

// ── Dice So Nice ready ────────────────────────────────────────────────────────

// Declared async so it can await _migrationPromise before registering face
// textures. Foundry does not await hook handler return values, so DSN
// initialisation is not blocked — our handler simply completes in the background.
Hooks.once("diceSoNiceReady", async (dice3d) => {
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

  // Wait for sheet migration, then ensure faces exist for the current sheet.
  // On the very first load the faces won't be in FACES_DIR yet regardless of
  // how migration ran, so we check and slice on demand. sliceAndUploadFaces()
  // is idempotent in practice: it overwrites existing files harmlessly.
  if (_migrationPromise) await _migrationPromise;

  const baseName   = imagePath.split("/").pop().replace(/\.[^.]+$/, "");
  const FACE_LABELS = Array.from({ length: 6 }, (_, i) => `${FACES_DIR}/${baseName}-face-${i + 1}.webp`);

  // Track which sheet was last sliced in localStorage — instant check with no
  // network round-trip, and correctly detects when the sheet has changed.
  // Each sheet uses uniquely-named face files so Forge CDN and PIXI always
  // see fresh URLs when the sheet changes — no stale cache hits.
  const lsKey = `${MODULE_ID}.lastSliced`;
  if (localStorage.getItem(lsKey) !== imagePath) {
    try {
      await sliceAndUploadFaces(imagePath);
      localStorage.setItem(lsKey, imagePath);
    } catch (err) {
      console.error("SR5 Dice | diceSoNiceReady: could not slice faces:", err);
      return; // can't register without faces
    }
  }

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



/* =========================================================
   Instax mini — a state model
   ---------------------------------------------------------
   The camera is modeled as a small set of variables (state)
   plus rules (if / else if) that decide how each user action
   changes that state.
   ========================================================= */

// ---------- 1. STATE VARIABLES ----------
let isOn = false;            // lens retracted (off) or extended (on)
let flashReady = false;      // the flash needs a few seconds to charge after power-on / after each shot
let doorOpen = false;        // back door of the camera
let hasFilmPack = false;     // is there a cartridge inside?
let darkSlideIn = false;     // a new pack starts with a black cover sheet that ejects on the first press
let filmCount = 0;           // shots left in the pack (a real pack holds 10)
let dialSetting = 2;         // brightness dial, 5 steps like my mini 7c: 0 indoor, 1 cloudy, 2 shade, 3 sunny, 4 very sunny
                             // (first version had 4 steps copied from the older mini 7s — corrected after checking my real camera)
let sceneLight = 2;          // how bright the real world is (not a camera setting!)
let isEjecting = false;      // a print is coming out — the camera ignores input meanwhile
let shotsTaken = 0;

const FILM_PER_PACK = 10;
const FLASH_CHARGE_MS = 1800;
const EJECT_MS = 1200;

const DIAL_NAMES = ["Indoor", "Cloudy", "Shade", "Sunny", "Very sunny"];
const SCENE_NAMES = ["Room at night", "Overcast park", "Light shade", "Sunny street", "Noon on the Hudson"];

// ---------- 2. GRAB PAGE ELEMENTS ----------
const $ = (id) => document.getElementById(id);
const camera = $("camera");
const readyLight = $("readyLight");
const counterDisplay = $("counterDisplay");
const ejectSlot = $("ejectSlot");
const message = $("message");
const powerBtn = $("powerBtn");
const shutterBtn = $("shutterBtn");
const dialSelect = $("dialSelect");
const sceneSelect = $("sceneSelect");
const doorBtn = $("doorBtn");
const loadBtn = $("loadBtn");
const stateTable = $("stateTable");
const logList = $("log");
const printsBox = $("prints");

let flashTimer = null;

// ---------- 3. TRANSITIONS (what each input does) ----------

function pressPower() {
  if (isEjecting) return say("Wait — a print is still ejecting.", "warn");

  if (!isOn) {
    // OFF -> ON: lens extends, flash starts charging
    isOn = true;
    startFlashCharge();
    say("Lens extended. The orange light blinks while the flash charges…", "ok");
    log("Power ON → lens out, flash charging");
  } else {
    // ON -> OFF: push lens back in
    isOn = false;
    flashReady = false;
    clearTimeout(flashTimer);
    say("Lens pushed back in. Camera is off.");
    log("Power OFF → lens retracted");
  }
  render();
}

function startFlashCharge() {
  flashReady = false;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    if (isOn) {
      flashReady = true;
      log("Flash ready (orange light steady)");
      render();
    }
  }, FLASH_CHARGE_MS);
}

function pressShutter() {
  // The order of these checks matters: each one is a reason the camera
  // physically cannot take a picture, from most to least obvious.
  if (!isOn) {
    say("Nothing happens — the lens is retracted. Turn the camera on first.", "error");
    log("Shutter pressed while OFF → ignored");
  } else if (isEjecting) {
    say("Still ejecting the last print.", "warn");
  } else if (doorOpen) {
    say("The back door is open — close it first.", "error");
    log("Shutter pressed with door open → ignored");
  } else if (!hasFilmPack) {
    say("Click… but there's no film inside. Load a pack.", "error");
    log("Shutter pressed with no film → ignored");
  } else if (darkSlideIn) {
    // first press after loading ejects the black cover sheet, uses no film
    darkSlideIn = false;
    eject({ darkSlide: true });
    say("Out comes the black dark slide (the cover sheet). NOW you have 10 shots.", "ok");
    log("Dark slide ejected → counter 10");
  } else if (filmCount === 0) {
    say("The counter says 0. This pack is empty.", "error");
    log("Shutter pressed with empty pack → ignored");
  } else if (!flashReady) {
    say("The flash isn't charged yet. The real camera won't fire — wait for the steady orange light.", "warn");
    log("Shutter pressed while flash charging → blocked");
  } else {
    takePhoto();
  }
  render();
}

function takePhoto() {
  filmCount = filmCount - 1;
  shotsTaken = shotsTaken + 1;

  // flash fires every time on this camera
  camera.classList.add("flashing");
  setTimeout(() => camera.classList.remove("flashing"), 150);

  const result = judgeExposure(dialSetting, sceneLight);
  eject({ result });
  say(result.text, result.level);
  log(`Shot #${shotsTaken}: dial=${DIAL_NAMES[dialSetting]}, scene=${SCENE_NAMES[sceneLight]} → ${result.label}`);

  startFlashCharge(); // flash must recharge before the next shot
}

/* The heart of the model.
   The dial tells the camera how bright the world is.
   If the dial says "darker than reality", the camera lets in too much light → overexposed.
   If the dial says "brighter than reality", too little light → underexposed. */
function judgeExposure(dial, scene) {
  const diff = scene - dial; // positive = world is brighter than the dial expects

  if (diff === 0) {
    return { label: "well exposed", level: "ok", filter: "none",
             text: "Nice! Dial matched the light — the print should come out balanced." };
  } else if (diff === 1) {
    return { label: "a bit bright", level: "warn", filter: "brightness(1.35) saturate(0.8)",
             text: "Slightly overexposed — colors a little washed out. Try one step brighter on the dial." };
  } else if (diff >= 2) {
    return { label: "blown out", level: "error", filter: "brightness(2.1) saturate(0.3) contrast(0.6)",
             text: "Very overexposed — almost white. The dial thought it was much darker than it is." };
  } else if (diff === -1) {
    return { label: "a bit dark", level: "warn", filter: "brightness(0.7)",
             text: "Slightly underexposed. Turn the dial one step toward Indoor." };
  } else {
    return { label: "too dark", level: "error", filter: "brightness(0.35) saturate(0.6)",
             text: "Very underexposed — mostly dark. The dial is set for way more light than you have." };
  }
}

function eject({ darkSlide = false, result = null }) {
  isEjecting = true;
  ejectSlot.classList.add("ejecting");
  addPrint(darkSlide, result);

  setTimeout(() => {
    isEjecting = false;
    ejectSlot.classList.remove("ejecting");
    render();
  }, EJECT_MS);
}

function toggleDoor() {
  if (isEjecting) return;

  if (!doorOpen) {
    // opening the door with unused film inside exposes (ruins) it
    if (hasFilmPack && filmCount > 0 && !darkSlideIn) {
      const sure = confirm(`There are still ${filmCount} shots left. Opening the door will expose them to light and ruin them. Open anyway?`);
      if (!sure) return;
      log(`Door opened with ${filmCount} shots left → film ruined`);
      filmCount = 0;
      say("Light leaked in — the remaining film is ruined.", "error");
    } else {
      say("Back door open.");
      log("Door opened");
    }
    doorOpen = true;
  } else {
    doorOpen = false;
    say(hasFilmPack ? "Door closed." : "Door closed — but there's no film inside.");
    log("Door closed");
  }
  render();
}

function loadFilm() {
  if (!doorOpen) {
    say("You have to open the back door before you can load film.", "warn");
    log("Load film with door closed → not possible");
  } else {
    hasFilmPack = true;
    darkSlideIn = true;
    filmCount = FILM_PER_PACK;
    say("New pack loaded. Close the door — the first press will eject the dark slide.", "ok");
    log("New film pack loaded (10 shots + dark slide)");
  }
  render();
}

// ---------- 4. VISUAL FEEDBACK ----------

function render() {
  // camera body
  camera.classList.toggle("off", !isOn);
  camera.classList.toggle("door-open", doorOpen);

  // ready light
  readyLight.classList.remove("charging", "ready");
  if (isOn && flashReady) readyLight.classList.add("ready");
  else if (isOn) readyLight.classList.add("charging");

  // film counter: "S" (start) while the dark slide is in, like the real camera
  if (!hasFilmPack) counterDisplay.textContent = "—";
  else if (darkSlideIn) counterDisplay.textContent = "S";
  else counterDisplay.textContent = filmCount;

  powerBtn.textContent = isOn ? "⏻ Power off (push lens in)" : "⏻ Power (extend lens)";
  doorBtn.textContent = doorOpen ? "Close back door" : "Open back door";
  loadBtn.disabled = !doorOpen;

  renderStateTable();
}

let previousState = {};
function renderStateTable() {
  const state = {
    isOn, flashReady, doorOpen, hasFilmPack, darkSlideIn,
    filmCount, dialSetting: `${dialSetting} (${DIAL_NAMES[dialSetting]})`,
    sceneLight: `${sceneLight} (${SCENE_NAMES[sceneLight]})`, isEjecting, shotsTaken
  };
  stateTable.innerHTML = "";
  for (const key in state) {
    const row = document.createElement("tr");
    if (key in previousState && previousState[key] !== state[key]) row.className = "changed";
    row.innerHTML = `<td>${key}</td><td>${state[key]}</td>`;
    stateTable.appendChild(row);
    // remove highlight on next frame so it fades
    if (row.className) requestAnimationFrame(() => setTimeout(() => row.classList.remove("changed"), 50));
  }
  previousState = state;
}

function addPrint(darkSlide, result) {
  const print = document.createElement("div");
  print.className = "print" + (darkSlide ? " dark-slide" : "");
  print.style.setProperty("--tilt", (Math.random() * 8 - 4).toFixed(1) + "deg");

  const image = document.createElement("div");
  image.className = "image scene-" + sceneLight;
  print.appendChild(image);

  const caption = document.createElement("div");
  caption.textContent = darkSlide ? "dark slide" : `#${shotsTaken} · ${result.label}`;
  print.appendChild(caption);

  if (!darkSlide) {
    print.style.setProperty("--final-filter", result.filter);
    // let the browser paint the dark version first, then start "developing"
    setTimeout(() => print.classList.add("developed"), 300);
  }
  printsBox.prepend(print);
}

function say(text, level = "") {
  message.textContent = text;
  message.className = "message " + level;
}

function log(text) {
  const li = document.createElement("li");
  li.textContent = text;
  logList.prepend(li);
}

// ---------- 5. EVENT LISTENERS (connect inputs to transitions) ----------
powerBtn.addEventListener("click", pressPower);
shutterBtn.addEventListener("click", pressShutter);
doorBtn.addEventListener("click", toggleDoor);
loadBtn.addEventListener("click", loadFilm);

dialSelect.addEventListener("change", () => {
  dialSetting = Number(dialSelect.value);
  log(`Dial turned to ${DIAL_NAMES[dialSetting]}`);
  render();
});

sceneSelect.addEventListener("change", () => {
  sceneLight = Number(sceneSelect.value);
  log(`Moved to: ${SCENE_NAMES[sceneLight]}`);
  render();
});

render();

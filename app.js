"use strict";
/* Telos Special Attack Alerts — Alt1 app
   Reads the RS3 chatbox, matches Telos special-attack messages, and fires
   an on-screen overlay + spoken + beep alert. Triggers are user-editable. */

/* Alt1 globals from the bundled libs (see index.html script order):
   A1lib  = @alt1/base    OCR = @alt1/ocr    Chatbox = @alt1/chatbox (default = reader class) */
var a1lib = window.A1lib;
var ChatBoxReader = window.Chatbox && window.Chatbox.default;

/* ---------- default triggers (verified reaction-critical Telos messages) ---------- */
var DEFAULT_TRIGGERS = [
	{
		id: "charge", label: "CHARGE", say: "Charge", color: "#ffb020",
		tip: "Telos dashes at you — surge / dive / escape away.",
		match: ["Gielinor, give me strength"]
	},
	{
		id: "animabomb", label: "ANIMA BOMB", say: "Anima bomb", color: "#ff4d4f",
		tip: "Big anima ball — block (Resonance / Disrupt) or cleanse at a font.",
		match: ["SO. MUCH. POWER", "so much power"]
	},
	{
		id: "tendrils", label: "TENDRILS", say: "Tendrils", color: "#ffd23f",
		tip: "You're gripped — deal damage to break free before it drains you.",
		match: ["Your anima will return to the source"]
	},
	{
		id: "absorb", label: "ABSORBED — FONT", say: "Font now", color: "#35bdf8",
		tip: "Anima absorbed — step onto / next to a font to cleanse.",
		match: ["absorbs the anima", "Stand near a font to cleanse"]
	}
];

var DEFAULT_SETTINGS = {
	overlay: true, voice: true, beep: true, debug: true,
	volume: 1, voiceName: "", overlaySecs: 2.5, cooldown: 1500
};

/* ---------- state ---------- */
var settings = loadJSON("telos_alert_settings_v1", DEFAULT_SETTINGS);
var triggers = loadJSON("telos_alert_triggers_v1", DEFAULT_TRIGGERS);
var reader = ChatBoxReader ? new ChatBoxReader() : null;
var primed = false;                // skip lines already in chat when the app starts
var nullReads = 0, tickCount = 0;  // loop bookkeeping
var lastRaw = "";                  // last raw chat line read (for diagnostics)
var lastErr = "";                  // last exception message (for diagnostics)
var lastFire = {};                 // trigger id -> timestamp (cooldown)
/* manual chatbox targeting (used when auto-detect can't find the chat) */
var manualBox = loadJSON("telos_manual_box_v1", null); // {x,y,width,height,line0y} or null
var targeting = 0;                 // 0 = off, 1 = awaiting 1st corner, 2 = awaiting 2nd corner
var targetCorner1 = null;
var $ = function (id) { return document.getElementById(id); };

/* ---------- helpers ---------- */
function loadJSON(key, fallback) {
	try { var v = JSON.parse(localStorage.getItem(key)); return v || fallback; }
	catch (e) { return fallback; }
}
function saveJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
function saveSettings() { saveJSON("telos_alert_settings_v1", settings); }
function saveTriggers() { saveJSON("telos_alert_triggers_v1", triggers); }

/* normalize text so OCR quirks (punctuation, spacing, timestamp) don't break matching */
function norm(s) {
	return String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function stripTimestamp(s) { return String(s).replace(/^\s*\[\d{1,2}:\d{2}(:\d{2})?\]\s*/, ""); }

/* ---------- status line ---------- */
function setStatus(text, cls) {
	var el = $("status"); el.textContent = text;
	el.className = "status" + (cls ? " " + cls : "");
}

/* =====================================================================
   ALERT PIPELINE
   ===================================================================== */
function fireAlert(trig) {
	var now = Date.now();
	var cd = Number(settings.cooldown) || 0;
	if (lastFire[trig.id] && now - lastFire[trig.id] < cd) return; // debounce duplicates
	lastFire[trig.id] = now;

	showBanner(trig);
	logDetection(trig);
	if (settings.overlay) overlayAlert(trig);
	if (settings.beep) beep();
	if (settings.voice) speak(trig.say || trig.label);
}

/* in-app banner + anima-core flare */
function showBanner(trig) {
	document.documentElement.style.setProperty("--flare", trig.color || "#35d6c4");
	$("alertWord").textContent = trig.label || trig.say || "Special";
	$("alertTip").textContent = trig.tip || "";
	document.body.classList.remove("firing");
	void document.body.offsetWidth;              // restart CSS animation
	document.body.classList.add("firing");
	clearTimeout(showBanner._t);
	showBanner._t = setTimeout(function () { document.body.classList.remove("firing"); }, 1600);
}

/* recent-detections log */
function logDetection(trig) {
	var ul = $("log");
	var empty = ul.querySelector(".empty");
	if (empty) empty.remove();
	var li = document.createElement("li");
	var t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
	li.innerHTML = '<span class="t"></span><span class="n"></span>';
	li.querySelector(".t").textContent = t;
	var n = li.querySelector(".n");
	n.textContent = trig.label || trig.say;
	n.style.setProperty("--c", trig.color || "#35d6c4");
	ul.prepend(li);
	while (ul.children.length > 40) ul.lastChild.remove();
}

/* on-screen overlay drawn onto the game window */
function overlayAlert(trig) {
	if (!window.alt1 || !alt1.permissionOverlay) return;
	try {
		var col = a1lib.mixColor.apply(a1lib, hexToRgb(trig.color || "#35d6c4"));
		var ms = Math.round((Number(settings.overlaySecs) || 2.5) * 1000);
		var w = alt1.rsWidth || 1000, h = alt1.rsHeight || 700;
		var cx = Math.round(w / 2);
		var cy = Math.round(h * 0.30);
		var text = (trig.label || trig.say || "SPECIAL").toUpperCase();
		// overLayTextEx(str, color, size, x, y, time, fontname, centered, shadow)
		alt1.overLayTextEx(text, col, 28, cx, cy, ms, "", true, true);
		if (trig.tip) alt1.overLayTextEx(trig.tip, col, 14, cx, cy + 34, ms, "", true, true);
	} catch (e) { /* overlay best-effort */ }
}

/* spoken alert (Web Speech API) */
var voices = [];
function speak(text) {
	if (!("speechSynthesis" in window) || !text) return;
	try {
		var u = new SpeechSynthesisUtterance(text);
		u.volume = Number(settings.volume);
		u.rate = 1.1;
		var v = voices.filter(function (x) { return x.name === settings.voiceName; })[0];
		if (v) u.voice = v;
		speechSynthesis.cancel();     // don't queue; latest special wins
		speechSynthesis.speak(u);
	} catch (e) {}
}

/* short beep (WebAudio) */
var audioCtx = null;
function beep() {
	try {
		audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
		if (audioCtx.state === "suspended") audioCtx.resume();
		var o = audioCtx.createOscillator(), g = audioCtx.createGain();
		o.type = "triangle"; o.frequency.value = 880;
		g.gain.value = 0.0001;
		o.connect(g); g.connect(audioCtx.destination);
		var t = audioCtx.currentTime, vol = 0.25 * Number(settings.volume);
		g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + 0.01);
		g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
		o.start(t); o.stop(t + 0.24);
	} catch (e) {}
}

function hexToRgb(hex) {
	var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
	return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [53, 214, 196];
}

/* =====================================================================
   MANUAL CHATBOX TARGETING
   Auto-detect finds the chat by its + / - button and speech-bubble graphics.
   When those don't match (custom themes, client updates), the user can point
   at the chat with Alt+1 instead. read() still auto-detects the font inside
   the box we hand it, so this works regardless of the surrounding graphics.
   ===================================================================== */
function makeChatbox(b) {
	// clamp to the captured RS area so read()'s toData can't go out of bounds
	var W = (window.alt1 && alt1.rsWidth) || 100000, H = (window.alt1 && alt1.rsHeight) || 100000;
	var x = Math.max(0, b.x), y = Math.max(0, b.y);
	var w = Math.min(b.width, W - x), h = Math.min(b.height, H - y);
	return {
		rect: { x: x, y: y, width: w, height: h },
		timestamp: true, type: "main", leftfound: true,
		topright: { x: x + w, y: y, type: "full" },
		botleft: { x: x, y: y + h },
		line0x: 0, line0y: Math.min(b.line0y, h - 1)
	};
}
function applyManualBox() {
	if (!manualBox || !reader) return;
	var box = makeChatbox(manualBox);
	reader.pos = { mainbox: box, boxes: [box] };
}

/* Sweep the baseline (line0y) to find the offset that reads the most text —
   makes the feature forgiving of imprecise pointing. */
function calibrate(img, rect) {
	var best = { score: -1, line0y: rect.height - 4 };
	var lo = Math.max(rect.height - 40, 8);
	for (var oy = rect.height - 1; oy >= lo; oy--) {
		var box = makeChatbox({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, line0y: oy });
		reader.pos = { mainbox: box, boxes: [box] };
		reader.font = null; reader.overlaplines = []; reader.lastReadBuffer = null;
		var score = 0, lines = null;
		try { lines = reader.read(img); } catch (e) {}
		if (lines) for (var i = 0; i < lines.length; i++) {
			var m = lines[i].text.match(/[a-z0-9]/gi); if (m) score += m.length;
		}
		if (score > best.score) best = { score: score, line0y: oy };
	}
	return best;
}

function startTargeting() {
	if (!window.alt1) { setStatus("Open in Alt1 to set the chatbox", "err"); return; }
	targeting = 1; targetCorner1 = null;
	manualInfo('Hover the <b>TOP-LEFT</b> of your chat text and press <b>Alt+1</b>.');
	setStatus("Targeting: top-left corner\u2026", "warn");
}
function cancelTargeting() { targeting = 0; targetCorner1 = null; manualInfo(""); }
function clearManualBox() {
	manualBox = null; targeting = 0;
	try { localStorage.removeItem("telos_manual_box_v1"); } catch (e) {}
	if (reader) { reader.pos = null; reader.font = null; }
	primed = false;
	manualInfo("Back to auto-detect.");
	updateManualUI();
}

function onAlt1Pressed() {
	if (!targeting) return;
	var p = a1lib.getMousePosition && a1lib.getMousePosition();
	if (!p) { manualInfo("Couldn\u2019t read the cursor \u2014 make sure RuneScape is focused, then try again."); return; }
	if (targeting === 1) {
		targetCorner1 = p; targeting = 2;
		manualInfo('Got top-left. Now hover the <b>BOTTOM-RIGHT</b> of your chat and press <b>Alt+1</b>.');
		setStatus("Targeting: bottom-right corner\u2026", "warn");
		return;
	}
	// second corner -> build rect, calibrate, save
	var x = Math.min(targetCorner1.x, p.x), y = Math.min(targetCorner1.y, p.y);
	var w = Math.abs(p.x - targetCorner1.x), h = Math.abs(p.y - targetCorner1.y);
	targeting = 0;
	if (w < 40 || h < 20) { manualInfo("That box was too small \u2014 try again, corner to corner across the chat."); return; }
	var rect = { x: x, y: y, width: w, height: h };
	manualInfo("Calibrating\u2026");
	try {
		var img = a1lib.captureHoldFullRs();
		var best = calibrate(img, rect);
		manualBox = { x: x, y: y, width: w, height: h, line0y: best.line0y };
		saveJSON("telos_manual_box_v1", manualBox);
		reader.font = null; reader.overlaplines = []; reader.lastReadBuffer = null;
		primed = false; applyManualBox();
		manualInfo(best.score > 8
			? "Chat area set. Reading from your box now."
			: "Box saved, but I couldn\u2019t read much text \u2014 re-point tightly around the message lines if it doesn\u2019t catch specials.");
	} catch (e) { manualInfo("Capture failed \u2014 try again."); }
	updateManualUI();
}

function manualInfo(html) { var el = $("manualInfo"); if (el) el.innerHTML = html; }
function updateManualUI() {
	var on = !!manualBox;
	var s = $("manualState"); if (s) s.textContent = on ? "Manual box active" : "Auto-detect";
	var c = $("clearManualBtn"); if (c) c.hidden = !on;
}


function matchLine(rawText) {
	var text = norm(stripTimestamp(rawText));
	if (!text) return;
	for (var i = 0; i < triggers.length; i++) {
		var trig = triggers[i];
		if (trig.enabled === false) continue;
		var phrases = trig.match || [];
		for (var j = 0; j < phrases.length; j++) {
			if (text.indexOf(norm(phrases[j])) !== -1) { fireAlert(trig); return; }
		}
	}
}

function readTick() {
	if (!ensureAlt1()) { setStatus("Open in the Alt1 browser to add this app", "err"); updateDebug(); return; }
	if (!alt1.permissionPixel) { setStatus("Enable \u201CView screen\u201D permission for this app", "warn"); updateDebug(); return; }
	if (!reader) { setStatus("Chat library failed to load", "err"); updateDebug(); return; }
	if (alt1.rsLinked === false) { setStatus("Waiting for RuneScape\u2026", "warn"); updateDebug(); return; }
	if (targeting) { setStatus("Point at your chat, press Alt+1", "warn"); updateDebug(); return; }

	// Capture the game screen ONCE and hand the same image to find() and read().
	var img;
	try { img = a1lib.captureHoldFullRs(); }
	catch (e) { setStatus("Couldn\u2019t capture the game screen", "warn"); updateDebug(); return; }
	if (!img) { setStatus("Couldn\u2019t capture the game screen", "warn"); updateDebug(); return; }

	try {
		if (manualBox) {
			// MANUAL mode: use the box the user pointed at (auto-detect not needed)
			if (!reader.pos) applyManualBox();
		} else if (!reader.pos) {
			var boxes = reader.find(img);
			if (!reader.pos && !(boxes && boxes.length)) {
				setStatus("Can\u2019t auto-find chat \u2014 use \u201CSet chatbox\u201D in settings", "warn"); updateDebug(); return;
			}
		}
		var lines = reader.read(img);
		if (lines === null) {
			setStatus(manualBox ? "Box set \u2014 waiting for chat text\u2026" : "Chatbox found \u2014 waiting for text\u2026", "warn");
			if (!manualBox && ++nullReads > 20) { reader.pos = null; reader.font = null; nullReads = 0; }
			updateDebug();
			return;
		}
		nullReads = 0;
		if (lines.length) lastRaw = lines[lines.length - 1].text;
		setStatus(manualBox ? "Watching chat (manual box)" : "Watching chat \u2014 good hunting", "ok");
		if (!primed) { primed = true; updateDebug(); return; } // ignore lines already on screen at launch
		for (var i = 0; i < lines.length; i++) matchLine(lines[i].text);
	} catch (e) {
		lastErr = (e && e.message) ? e.message : String(e);
		if (!manualBox) { reader.pos = null; setStatus("Re-syncing chatbox\u2026", "warn"); }
		else setStatus("Manual box error \u2014 re-point it (see diagnostics)", "warn");
	}
	updateDebug();
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"]/g, function (c) {
		return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
	});
}
function updateDebug() {
	var el = $("debug");
	if (!el) return;
	if (settings.debug === false) { el.hidden = true; return; }
	el.hidden = false;
	var a = !!window.alt1;
	var pix = a && !!alt1.permissionPixel;
	var pos = !!(reader && reader.pos);
	var n = pos && reader.pos.boxes ? reader.pos.boxes.length : (pos ? 1 : 0);
	var font = !!(reader && reader.font);
	function m(v) { return v ? '<b class="good">Y</b>' : '<b class="bad">N</b>'; }
	var extra = "";
	if (manualBox) {
		var W = (a && alt1.rsWidth) || "?", H = (a && alt1.rsHeight) || "?";
		extra = '<br>box: ' + manualBox.x + "," + manualBox.y + " " + manualBox.width + "x" + manualBox.height +
			" L=" + manualBox.line0y + " | rs: " + W + "x" + H;
	}
	el.innerHTML =
		"mode:<b>" + (manualBox ? "manual" : "auto") + "</b> alt1:" + m(a) + " view:" + m(pix) + " box:" + m(pos) +
		" font:" + m(font) + extra +
		"<br>last: " + (lastRaw ? escapeHtml('"' + lastRaw.slice(0, 56) + '"') : "\u2014") +
		(lastErr ? '<br><span class="bad">err: ' + escapeHtml(lastErr.slice(0, 70)) + "</span>" : "");
}

/* =====================================================================
   UI WIRING
   ===================================================================== */
function initUI() {
	// settings open/close
	$("settingsBtn").onclick = function () { $("settings").hidden = false; };
	$("closeSettings").onclick = function () { $("settings").hidden = true; };

	// test + mute
	$("testBtn").onclick = function () {
		fireAlert(triggers.find(function (t) { return t.enabled !== false; }) || triggers[0] || DEFAULT_TRIGGERS[0]);
	};
	var muteBtn = $("muteBtn");
	function syncMute() {
		muteBtn.dataset.on = settings.voice ? "1" : "0";
		muteBtn.textContent = settings.voice ? "Voice on" : "Voice off";
		$("setVoice").checked = settings.voice;
	}
	muteBtn.onclick = function () { settings.voice = !settings.voice; saveSettings(); syncMute(); };
	syncMute();

	$("clearLog").onclick = function () {
		$("log").innerHTML = '<li class="empty">No specials detected yet.</li>';
	};

	// manual chatbox targeting
	var mb = $("manualBtn"); if (mb) mb.onclick = startTargeting;
	var cb = $("clearManualBtn"); if (cb) cb.onclick = clearManualBox;
	updateManualUI();

	// checkboxes / numbers
	bindCheck("setOverlay", "overlay");
	bindCheck("setVoice", "voice", syncMute);
	bindCheck("setBeep", "beep");
	bindCheck("setDebug", "debug", updateDebug);
	bindNum("setOverlaySecs", "overlaySecs");
	bindNum("setCooldown", "cooldown");
	var vol = $("setVolume"); vol.value = settings.volume;
	vol.oninput = function () { settings.volume = Number(vol.value); saveSettings(); };

	// voice picker
	populateVoices();
	if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = populateVoices;

	// trigger editor
	$("trigEditor").value = JSON.stringify(triggers, null, 2);
	$("applyTriggers").onclick = applyTriggers;
	$("resetTriggers").onclick = function () {
		triggers = JSON.parse(JSON.stringify(DEFAULT_TRIGGERS));
		saveTriggers();
		$("trigEditor").value = JSON.stringify(triggers, null, 2);
		trigMsg("Reset to defaults.", "ok");
	};

	// initial banner state
	$("alertWord").textContent = "Ready";
	$("alertTip").textContent = "Watching the chatbox for Telos\u2019 specials.";
	if (!$("log").children.length) $("log").innerHTML = '<li class="empty">No specials detected yet.</li>';
}

function bindCheck(id, key, after) {
	var el = $(id); el.checked = !!settings[key];
	el.onchange = function () { settings[key] = el.checked; saveSettings(); if (after) after(); };
}
function bindNum(id, key) {
	var el = $(id); el.value = settings[key];
	el.onchange = function () { settings[key] = Number(el.value); saveSettings(); };
}

function populateVoices() {
	if (!("speechSynthesis" in window)) return;
	voices = speechSynthesis.getVoices();
	var sel = $("setVoicePick");
	sel.innerHTML = "";
	var def = document.createElement("option");
	def.value = ""; def.textContent = "Default voice";
	sel.appendChild(def);
	voices.forEach(function (v) {
		var o = document.createElement("option");
		o.value = v.name; o.textContent = v.name + (v.lang ? " (" + v.lang + ")" : "");
		if (v.name === settings.voiceName) o.selected = true;
		sel.appendChild(o);
	});
	sel.onchange = function () { settings.voiceName = sel.value; saveSettings(); };
}

function applyTriggers() {
	try {
		var parsed = JSON.parse($("trigEditor").value);
		if (!Array.isArray(parsed)) throw new Error("Top level must be a list");
		parsed.forEach(function (t, i) {
			if (!t.id) t.id = "t" + i;
			if (!Array.isArray(t.match)) throw new Error('Trigger "' + (t.label || t.id) + '" needs a match list');
		});
		triggers = parsed; saveTriggers();
		trigMsg("Saved " + parsed.length + " triggers.", "ok");
	} catch (e) {
		trigMsg("Invalid: " + e.message, "err");
	}
}
function trigMsg(text, cls) {
	var el = $("trigMsg"); el.textContent = text; el.className = "trig-msg " + (cls || "");
	clearTimeout(trigMsg._t); trigMsg._t = setTimeout(function () { el.textContent = ""; }, 4000);
}

/* ---------- Alt1 registration (handles late injection of window.alt1) ---------- */
var CONFIG_URL = new URL("./appconfig.json", location.href).href;
var identified = false;
function ensureAlt1() {
	if (window.alt1) {
		$("installbar").hidden = true;                 // hide our fallback bar inside Alt1
		if (!identified) {
			try { alt1.identifyAppUrl("./appconfig.json"); identified = true; } catch (e) {}
		}
		return true;
	}
	// opened in a normal browser: show a real clickable protocol link
	var bar = $("installbar");
	bar.hidden = false;
	$("addlink").href = "alt1://addapp/" + CONFIG_URL;
	return false;
}

/* ---------- boot ---------- */
/* ---------- boot ---------- */
function boot() {
	initUI();
	ensureAlt1();
	if (window.alt1 && a1lib.on) a1lib.on("alt1pressed", onAlt1Pressed);
	if (manualBox) applyManualBox();
	setInterval(readTick, 250);
	readTick();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();

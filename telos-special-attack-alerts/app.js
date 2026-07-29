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
	overlay: true, voice: true, beep: true,
	volume: 1, voiceName: "", overlaySecs: 2.5, cooldown: 1500
};

/* ---------- state ---------- */
var settings = loadJSON("telos_alert_settings_v1", DEFAULT_SETTINGS);
var triggers = loadJSON("telos_alert_triggers_v1", DEFAULT_TRIGGERS);
var reader = ChatBoxReader ? new ChatBoxReader() : null;
var primed = false;                // skip lines already in chat when the app starts
var nullReads = 0, tickCount = 0;  // loop bookkeeping
var lastFire = {};                 // trigger id -> timestamp (cooldown)
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
   CHATBOX READING LOOP
   ===================================================================== */
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
	if (!window.alt1) { setStatus("Open this app inside Alt1", "err"); return; }
	if (!alt1.permissionPixel) { setStatus("Grant \u201CScreen capture\u201D in Alt1", "warn"); return; }
	if (!reader) { setStatus("Chat library failed to load", "err"); return; }
	try {
		// periodically drop the box position so we re-locate a chat that was moved/resized
		if (reader.pos && (++tickCount % 40 === 0)) reader.pos = null;

		if (!reader.pos) {
			reader.find();
			if (!reader.pos) { setStatus("Looking for your chatbox\u2026", "warn"); return; }
			setStatus("Watching chat \u2014 good hunting", "ok");
		}

		var lines = reader.read();
		if (lines === null) {                    // box found but font/text not locked yet
			if (++nullReads > 8) { reader.pos = null; nullReads = 0; }
			return;
		}
		nullReads = 0;
		if (!primed) { primed = true; return; }  // ignore whatever was already on screen at launch
		for (var i = 0; i < lines.length; i++) matchLine(lines[i].text);
	} catch (e) {
		reader.pos = null;                       // recover on next tick
		setStatus("Re-syncing chatbox\u2026", "warn");
	}
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

	// checkboxes / numbers
	bindCheck("setOverlay", "overlay");
	bindCheck("setVoice", "voice", syncMute);
	bindCheck("setBeep", "beep");
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

/* ---------- install banner when opened outside Alt1 ---------- */
function initInstallBanner() {
	if (window.alt1) {
		try { alt1.identifyAppUrl("./appconfig.json"); } catch (e) {}
		return;
	}
	var bar = $("installbar");
	bar.hidden = false;
	var cfg = new URL("./appconfig.json", location.href).href;
	$("addlink").href = "alt1://addapp/" + cfg;
	setStatus("Not running in Alt1", "err");
}

/* ---------- boot ---------- */
document.addEventListener("DOMContentLoaded", function () {
	initUI();
	initInstallBanner();
	setInterval(readTick, 250);
	readTick();
});

// Slop Academy: one feature. You talk through code you shipped with an interviewer who has read it.
//
//   onboarding → home ("today's conversation") → the conversation → what you defended + your story
//
// Speech runs in the local server (/api/transcribe, /api/speak); the interviewer runs on your own
// claude CLI. Nothing here talks to a third party. The game layer (XP, streaks, path) is play.js.

import * as play from "./play.js";

const view = document.getElementById("view");
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const html = (strings, ...values) => strings.reduce((out, s, i) => out + s + (i < values.length ? values[i] : ""), "");
const el = (markup) => { const t = document.createElement("template"); t.innerHTML = markup.trim(); return t.content.firstElementChild; };

async function api(url, body) {
  const res = await fetch(url, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
  return data;
}

function toast(text) {
  const t = el(`<div class="toast" role="status">${esc(text)}</div>`);
  document.body.append(t);
  setTimeout(() => t.remove(), 3800);
}

const base = (file) => file.split("/").pop();
const dir = (file) => file.split("/").slice(0, -1).join("/");
const ago = (unix) => {
  const d = (Date.now() / 1000 - unix) / 86400;
  return d < 1 ? "today" : d < 2 ? "yesterday" : d < 30 ? `${Math.round(d)} days ago` : `${Math.round(d / 30)} months ago`;
};
const LENS = {
  purpose: "Purpose", failure: "Failure", scale: "Scale", tradeoff: "Trade-off", data_flow: "Data flow",
  change: "Changing requirements", operations: "Operations", honesty: "Honesty",
};
const MOVE_TAG = { hint: "Hint", explain: "Let me explain", teach_back: "Your turn", curveball: "Curveball" };

// ---------------------------------------------------------------- the interviewer's voice

const VOICES = [["am_michael", "Michael"], ["af_heart", "Heart"], ["bm_george", "George"], ["bf_emma", "Emma"]];

const voice = {
  on: localStorage.getItem("slop.voice") !== "off",
  name: localStorage.getItem("slop.kokoro") ?? "am_michael",
  audio: new Audio(),
  run: 0,
  finish: null,
  // Kokoro on this machine, one sentence at a time: the first one plays while the next is generated.
  async speak(text) {
    if (!this.on || !text) return;
    const run = ++this.run;
    // Long sentences are split at a comma so the first sound arrives in about a second.
    const sentences = (text.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) ?? [text]).map((x) => x.trim()).filter(Boolean)
      .flatMap((x) => (x.length > 110 ? x.split(/(?<=,)\s+(?=\S{2})/).reduce((parts, piece) => {
        if (parts.length && parts.at(-1).length < 45) parts[parts.length - 1] += ` ${piece}`;
        else parts.push(piece);
        return parts;
      }, []) : [x]));
    const fetchOne = (sentence) => fetch("/api/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: sentence, voice: this.name }) })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("voice failed"))));
    let next = fetchOne(sentences[0]);
    for (let i = 0; i < sentences.length; i++) {
      let blob;
      try { blob = await next; } catch { if (run === this.run) await this.fallback(sentences.slice(i).join(" ")); return; }
      if (run !== this.run) return;
      if (i + 1 < sentences.length) next = fetchOne(sentences[i + 1]);
      await this.play(blob);
      if (run !== this.run) return;
    }
  },
  play(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const done = () => { URL.revokeObjectURL(url); this.finish = null; resolve(); };
      this.finish = done;
      this.audio.src = url;
      this.audio.onended = this.audio.onerror = done;
      this.audio.play().catch(done);
    });
  },
  // The browser's own voice, only if the local one is unavailable.
  fallback(text) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      const en = speechSynthesis.getVoices().filter((v) => v.lang?.startsWith("en"));
      u.voice = en.find((v) => /natural|neural|google/i.test(v.name)) ?? en[0] ?? null;
      const guard = setTimeout(resolve, 1500 + text.length * 90);
      u.onend = u.onerror = () => { clearTimeout(guard); resolve(); };
      speechSynthesis.speak(u);
    });
  },
  stop() {
    this.run++;
    this.audio.pause();
    this.finish?.();
    window.speechSynthesis?.cancel();
  },
};

const voiceBtn = document.getElementById("voice");
const syncVoiceBtn = () => {
  voiceBtn.setAttribute("aria-pressed", String(voice.on));
  voiceBtn.setAttribute("aria-label", voice.on ? `Interviewer voice: ${VOICES.find(([id]) => id === voice.name)?.[1]}` : "Interviewer voice off");
};
syncVoiceBtn();
voiceBtn.onclick = (e) => {
  e.stopPropagation();
  const open = $(".voice-menu");
  if (open) return open.remove();
  const menu = el(`<div class="voice-menu" role="menu">
    ${VOICES.map(([id, label]) => `<button role="menuitemradio" aria-checked="${voice.on && voice.name === id}" data-v="${id}">${label}</button>`).join("")}
    <button role="menuitemradio" aria-checked="${!voice.on}" data-v="off">Off</button>
  </div>`);
  voiceBtn.parentElement.append(menu);
  menu.onclick = (ev) => {
    const b = ev.target.closest("[data-v]");
    if (!b) return;
    voice.stop();
    voice.on = b.dataset.v !== "off";
    if (voice.on) voice.name = b.dataset.v;
    localStorage.setItem("slop.voice", voice.on ? "on" : "off");
    localStorage.setItem("slop.kokoro", voice.name);
    syncVoiceBtn();
    menu.remove();
    if (voice.on) voice.speak("Hi. I've read your code, so let's talk it through.");
  };
  setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }));
};

const soundBtn = document.getElementById("sound");
const syncSound = () => { soundBtn.setAttribute("aria-pressed", String(play.sound.on)); soundBtn.setAttribute("aria-label", play.sound.on ? "Sound effects on" : "Sound effects off"); };
syncSound();
soundBtn.onclick = () => { play.sound.toggle(); syncSound(); };

// ---------------------------------------------------------------- your microphone

const FILLERS = /\b(um+|uh+|erm|hmm+|like|you know|sort of|kind of|basically|i mean)\b/gi;

// Hands-free: the mic stays open for the whole conversation. Your turn starts when the interviewer
// stops talking and ends after a pause; a loud, sustained voice while they talk cuts them off.
const SILENCE_MS = Number(localStorage.getItem("slop.silenceMs")) || 1800;

const mic = {
  stream: null, recorder: null, chunks: [], ctx: null, analyser: null, buf: null, timer: 0, watchTimer: 0,
  startedAt: 0, onsetAt: 0, floor: 0.01,
  async open() {
    this.stream ??= await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.ctx ??= new AudioContext();
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.buf = new Float32Array(this.analyser.fftSize);
      this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
    }
    await this.ctx.resume();
  },
  rms() {
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += v * v;
    return Math.sqrt(sum / this.buf.length);
  },
  get recording() { return this.recorder?.state === "recording"; },
  // While the interviewer talks: call onVoice once you clearly start speaking over them.
  watch(onVoice) {
    this.unwatch();
    // Speech dips between syllables, so count loud frames in the last half second rather than demanding
    // an unbroken run. The bar sits well above what echo cancellation leaves of the interviewer's voice.
    const recent = [];
    this.watchTimer = setInterval(() => {
      recent.push(this.rms() > Math.max(0.04, this.floor * 5));
      if (recent.length > 10) recent.shift();
      if (recent.filter(Boolean).length >= 6) { this.unwatch(); onVoice(); }
    }, 50);
  },
  unwatch() { clearInterval(this.watchTimer); this.watchTimer = 0; },
  // Record one answer. onEnd fires once, after you spoke and then went quiet for silenceMs.
  start({ onLevel, onEnd, silenceMs = SILENCE_MS }) {
    this.unwatch();
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, { mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "" });
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(250);
    this.startedAt = performance.now();
    this.onsetAt = 0;
    let voiced = 0;
    let lastVoice = 0;
    clearInterval(this.timer);
    // setInterval, not requestAnimationFrame, so a background tab keeps listening.
    this.timer = setInterval(() => {
      const r = this.rms();
      const now = performance.now();
      onLevel?.(Math.min(1, r * 9));
      if (r > Math.max(0.025, this.floor * 3)) {
        voiced += 50;
        lastVoice = now;
        if (!this.onsetAt && voiced >= 150) this.onsetAt = now - voiced; // first moment you actually spoke
      } else {
        voiced = 0;
        if (!this.onsetAt) this.floor = Math.min(0.03, this.floor * 0.95 + r * 0.05); // learn the room's noise
      }
      if (onEnd && this.onsetAt && now - lastVoice > silenceMs) {
        const end = onEnd;
        onEnd = null;
        end();
      }
    }, 50);
  },
  stop() {
    clearInterval(this.timer);
    return new Promise((resolve) => {
      if (!this.recording) return resolve(new Blob(this.chunks, { type: "audio/webm" }));
      this.recorder.onstop = () => resolve(new Blob(this.chunks, { type: "audio/webm" }));
      this.recorder.stop();
    });
  },
  // Let go of the microphone entirely (conversation over, or you left the page).
  close() {
    this.unwatch();
    clearInterval(this.timer);
    if (this.recording) this.recorder.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.stream = this.ctx = this.analyser = this.recorder = null;
  },
};

/** A recording to 16 kHz mono float32, what Whisper wants. The browser decodes and resamples it. */
async function toSamples(blob) {
  const decoded = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await blob.arrayBuffer());
  return decoded.getChannelData(0);
}

// ---------------------------------------------------------------- speech models (first run downloads them)

const speechChip = document.getElementById("speech-chip");
(async function watchSpeech() {
  for (;;) {
    let s;
    try { s = await api("/api/speech"); } catch { return; }
    const parts = [s.tts, s.stt];
    if (parts.every((p) => p.state === "ready")) { speechChip.hidden = true; return; }
    const failed = parts.find((p) => p.state === "error");
    const downloading = parts.some((p) => p.state === "downloading");
    const pct = Math.round((parts.reduce((a, p) => a + p.progress, 0) / parts.length) * 100);
    speechChip.hidden = false;
    speechChip.textContent = failed ? "Voice models failed to load · you can type" : downloading ? `Downloading voice models · ${pct}%` : "Loading voice models";
    speechChip.title = failed?.error ?? "One-time download from Hugging Face; then everything runs on this machine";
    if (failed) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
})();

// ---------------------------------------------------------------- code view

const KEYWORDS = new Set("const let var function return if else for while do await async import from export default class new try catch finally throw of in type interface extends implements enum def self None True False null undefined true false switch case break continue public private protected static readonly struct fn impl pub use mod match func package go defer select where yield lambda with as and or not is elif pass raise except contract mapping require emit event modifier uint256 address memory storage calldata external internal view payable".split(" "));
const TOKEN = /(\/\/.*$|\/\*.*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\b(\d[\d_.xa-fA-F]*n?)\b|([A-Za-z_$][\w$]*)/g;

function highlight(line, hashComments) {
  if (hashComments) {
    const i = line.search(/(^|\s)#/);
    if (i >= 0 && !/["']/.test(line.slice(0, i))) return highlight(line.slice(0, i), false) + `<span class="tk-c">${esc(line.slice(i))}</span>`;
  }
  let out = "";
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    out += esc(line.slice(last, m.index));
    const [text, comment, string, number, word] = m;
    out += comment ? `<span class="tk-c">${esc(text)}</span>`
      : string ? `<span class="tk-s">${esc(text)}</span>`
      : number ? `<span class="tk-n">${esc(text)}</span>`
      : word && KEYWORDS.has(word) ? `<span class="tk-k">${esc(text)}</span>`
      : esc(text);
    last = m.index + text.length;
  }
  return out + esc(line.slice(last));
}

function renderCode(container, file, source) {
  const hash = /\.(py|rb|sh|ex|exs)$/.test(file);
  container.innerHTML = source.split("\n").map((l, i) => `<div class="ln" data-n="${i + 1}"><i>${i + 1}</i><span>${highlight(l, hash) || " "}</span></div>`).join("");
  container.append(el(`<svg class="bracket" viewBox="0 0 12 100" preserveAspectRatio="none" aria-hidden="true" hidden><path d="M10 2C3 3 3 8 3 20v60c0 12 0 17 7 18"/></svg>`));
}

function focusLines(container, lines) {
  const bracket = $(".bracket", container);
  container.querySelectorAll(".ln.hl").forEach((n) => n.classList.remove("hl"));
  if (!lines) { container.classList.remove("focus"); bracket.setAttribute("hidden", ""); return; }
  const [a, b] = lines;
  const rows = [...container.querySelectorAll(".ln")].slice(a - 1, b);
  if (!rows.length) return;
  rows.forEach((n) => n.classList.add("hl"));
  container.classList.add("focus");
  const top = rows[0].offsetTop;
  const height = rows.at(-1).offsetTop + rows.at(-1).offsetHeight - top;
  Object.assign(bracket.style, { top: `${top}px`, height: `${height}px` });
  bracket.removeAttribute("hidden"); // an SVG element has no .hidden property
  // The caption covers the lower part of the screen: put the lines in the upper third.
  container.scrollTo({ top: Math.max(0, top - container.clientHeight * 0.14), behavior: "smooth" });
}

// ---------------------------------------------------------------- onboarding

const onboarding = { repo: null, scan: null, goal: null, role: "", date: "", confidence: null };

function progress(step) {
  return `<div class="progress" aria-label="Step ${step} of 4">${[1, 2, 3, 4].map((n) => `<i class="${n <= step ? "on" : ""}"></i>`).join("")}</div>`;
}

async function stepRepo() {
  view.innerHTML = html`<section class="onboard"><div class="onboard-inner">
    ${progress(1)}
    <h1 class="rise">Which project do you want to talk about?</h1>
    <p class="lead rise d1">Pick something you shipped. We read it with your own coding agent, on this machine, and ask you about it the way a sharp senior engineer would</p>
    <div class="choices rise d2" id="repos"><p class="status-line">Looking for your repos…</p></div>
    <form class="path-row rise d3" id="path-form">
      <input class="field" id="path" placeholder="Or paste a path, like ~/code/payments-api" autocomplete="off" spellcheck="false">
      <button class="btn btn-secondary" type="submit">Use this</button>
    </form>
  </div></section>`;
  const choose = async (repo) => {
    try {
      onboarding.scan = await api("/api/scan", { repo });
      if (!onboarding.scan.areas.length) return toast(`${onboarding.scan.name} has no source code to talk about yet. Pick a repo with code you've written`);
      onboarding.repo = onboarding.scan.root;
      stepGoal();
    } catch (e) { toast(e.message); }
  };
  $("#path-form").onsubmit = (e) => { e.preventDefault(); const v = $("#path").value.trim(); if (v) choose(v); };
  const repos = await api("/api/repos").catch(() => []);
  $("#repos").innerHTML = repos.length
    ? repos.slice(0, 5).map((r) => `<button class="choice" type="button" data-path="${esc(r.path)}"><b>${esc(r.name)}</b><small>${esc(r.path.replace(/^\/home\/[^/]+/, "~"))}</small><span class="meta">${r.lastEdit > r.lastCommit ? `edited ${ago(r.lastEdit)}` : `committed ${ago(r.lastCommit)}`}</span></button>`).join("")
    : `<p class="status-line">No git repos found in your home folder. Paste a path below</p>`;
  $("#repos").onclick = (e) => { const b = e.target.closest("[data-path]"); if (b) choose(b.dataset.path); };
}

function stepGoal() {
  const goals = [
    ["interview", "An interview is coming up", "Practise defending your work out loud before it counts"],
    ["sharp", "Keep my skills sharp", "Stay fluent in code you ship with AI"],
    ["own", "Really own this codebase", "Be the person who can explain it when it breaks"],
  ];
  view.innerHTML = html`<section class="onboard"><div class="onboard-inner">
    ${progress(2)}
    <h1 class="rise">What's this for?</h1>
    <p class="lead rise d1">It changes how your interviewer talks to you</p>
    <div class="choices rise d2" id="goals">
      ${goals.map(([id, title, sub]) => `<button class="choice" type="button" data-goal="${id}" aria-pressed="${onboarding.goal === id}"><b>${title}</b><small>${sub}</small></button>`).join("")}
    </div>
    <div class="extra" id="extra" ${onboarding.goal === "interview" ? "" : "hidden"}>
      <label>Role you're going for<input class="field" id="role" placeholder="Senior backend engineer" value="${esc(onboarding.role)}"></label>
      <label>When<input class="field" id="date" type="date" value="${esc(onboarding.date)}"></label>
    </div>
    <div class="actions"><button class="btn btn-primary" id="next" ${onboarding.goal ? "" : "disabled"}>Continue</button><button class="link" id="back">Back</button></div>
  </div></section>`;
  $("#goals").onclick = (e) => {
    const b = e.target.closest("[data-goal]");
    if (!b) return;
    onboarding.goal = b.dataset.goal;
    view.querySelectorAll("[data-goal]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    $("#extra").hidden = onboarding.goal !== "interview";
    $("#next").disabled = false;
  };
  $("#back").onclick = stepRepo;
  $("#next").onclick = () => {
    onboarding.role = $("#role").value.trim();
    onboarding.date = $("#date").value;
    stepDaily();
  };
}

function stepDaily() {
  const options = [
    [30, "Casual", "A few good answers"],
    [60, "Regular", "About one conversation"],
    [120, "Serious", "Two conversations"],
  ];
  onboarding.dailyGoal ??= 60;
  view.innerHTML = html`<section class="onboard"><div class="onboard-inner">
    ${progress(3)}
    <h1 class="rise">Pick a daily goal</h1>
    <p class="lead rise d1">Every answer earns XP, more when it's a strong one. Hit your goal each day to build a streak</p>
    <div class="choices rise d2" id="daily">
      ${options.map(([xp, name, sub]) => `<button class="choice" type="button" data-xp="${xp}" aria-pressed="${onboarding.dailyGoal === xp}"><b>${name}</b><small>${sub}</small><span class="meta">${xp} XP a day</span></button>`).join("")}
    </div>
    <div class="actions"><button class="btn btn-primary" id="next">Continue</button><button class="link" id="back">Back</button></div>
  </div></section>`;
  $("#daily").onclick = (e) => {
    const b = e.target.closest("[data-xp]");
    if (!b) return;
    onboarding.dailyGoal = Number(b.dataset.xp);
    view.querySelectorAll("#daily [data-xp]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    play.sound.play("good");
  };
  $("#back").onclick = stepGoal;
  $("#next").onclick = stepConfidence;
}

function scaleButtons(selected) {
  const labels = ["Not really", "The basics", "Most of it", "Confidently", "Every decision"];
  return labels.map((l, i) => `<button type="button" data-v="${i + 1}" aria-pressed="${selected === i + 1}"><b>${i + 1}</b><small>${l}</small></button>`).join("");
}

function stepConfidence() {
  const name = onboarding.scan.name;
  view.innerHTML = html`<section class="onboard"><div class="onboard-inner">
    ${progress(4)}
    <h1 class="rise">With the AI closed, how well could you explain ${esc(name)} to a senior engineer?</h1>
    <p class="lead rise d1">Be honest. Nobody sees this but you, and we'll ask again after each conversation so you can watch it move</p>
    <div class="scale rise d2" id="scale">${scaleButtons(onboarding.confidence)}</div>
    <div class="actions"><button class="btn btn-primary" id="next" ${onboarding.confidence ? "" : "disabled"}>Read my repo</button><button class="link" id="back">Back</button></div>
  </div></section>`;
  $("#scale").onclick = (e) => {
    const b = e.target.closest("[data-v]");
    if (!b) return;
    onboarding.confidence = Number(b.dataset.v);
    view.querySelectorAll("#scale [data-v]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    $("#next").disabled = false;
  };
  $("#back").onclick = stepDaily;
  $("#next").onclick = reading;
}

async function reading() {
  const scan = onboarding.scan;
  const save = api("/api/profile", { repo: onboarding.repo, goal: onboarding.goal, role: onboarding.role, interviewDate: onboarding.date, confidence: onboarding.confidence, dailyGoal: onboarding.dailyGoal });
  const aiShare = scan.commits ? Math.round((scan.aiCommits / scan.commits) * 100) : 0;
  view.innerHTML = html`<section class="onboard"><div class="onboard-inner reading">
    <div>
      <p class="eyebrow rise">Reading ${esc(scan.name)}</p>
      <h1 class="rise d1">Here's what you've been shipping</h1>
    </div>
    <div class="stats rise d2">
      ${scan.commits ? `<div class="stat"><b>${scan.commits}</b><span>commits in 18 months</span></div>` : ""}
      ${aiShare ? `<div class="stat"><b>${aiShare}%</b><span>co-written with an AI agent</span></div>` : ""}
      <div class="stat"><b>${scan.areas.length}</b><span>files worth talking about</span></div>
    </div>
    <ul class="files">
      ${scan.areas.slice(0, 7).map((a, i) => `<li style="animation-delay:${300 + i * 90}ms"><span class="name">${esc(a.file)}</span><span>${a.changes ? `${a.changes} changes` : `${a.lines} lines`}</span></li>`).join("")}
    </ul>
    <div class="actions"><button class="btn btn-primary" id="go" disabled>One moment…</button></div>
  </div></section>`;
  try {
    await save;
    await new Promise((r) => setTimeout(r, 900));
    $("#go").disabled = false;
    $("#go").textContent = "See today's conversation";
    $("#go").onclick = () => { if (location.hash === "#/") route(); else location.hash = "#/"; };
  } catch (e) { toast(e.message); }
}

// ---------------------------------------------------------------- home

async function renderHome() {
  view.innerHTML = `<section class="home"><div class="home-inner"><p class="status-line">Loading…</p></div></section>`;
  const data = await api("/api/home");
  if (!data.profile) return stepRepo();
  const { profile, scan, next, progress: p, catalog } = data;
  $("#repo-chip").hidden = false;
  $("#repo-chip").textContent = scan.name;
  play.renderHud(p);
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const days = profile.interviewDate ? Math.ceil((new Date(profile.interviewDate) - Date.now()) / 86400000) : null;
  const first = profile.confidence.find((c) => c.when === "start")?.value;
  const latest = [...profile.confidence].reverse().find((c) => c.when === "after")?.value;
  const sub = days != null && days >= 0
    ? `${days === 0 ? "Interview today" : `${days} day${days === 1 ? "" : "s"} to your interview`}${profile.role ? ` · ${esc(profile.role)}` : ""}`
    : p.streak.doneToday ? "You've practised today. A bonus round never hurts" : p.streak.count ? `Keep your ${p.streak.count}-day streak alive` : "Your first conversation starts your streak";
  const nextArea = scan.areas.find((a) => a.file === next?.file);
  view.innerHTML = html`<section class="home"><div class="home-inner">
    <div class="path-col">
      <div class="greet rise"><h1>${hello}</h1><p class="muted">${sub}</p></div>
      ${next ? html`<article class="today rise d1">
        <div><p class="eyebrow">Next up · about 8 minutes · ${nextArea?.talks ? `${nextArea.mastery}/5 lenses so far` : "new ground"}</p>
        <h2>${esc(base(next.file))}</h2>
        <p class="why">${esc(next.reason)}</p></div>
        <button class="btn btn-primary btn-big" id="start">Start talking</button>
      </article>` : ""}
      <div class="units rise d2">${play.pathHtml(scan.areas, next?.file, { base, dir })}</div>
    </div>
    <aside class="side rise d3">
      ${play.sideHtml(p, catalog.goals)}
      <div class="card">
        <h3>Achievements <small class="muted">${p.achievements.length}/${Object.keys(catalog.achievements).length}</small></h3>
        ${play.badgesHtml(p.achievements, catalog.achievements)}
      </div>
      <div class="card conf">
        <p>Explaining ${esc(scan.name)} without the AI</p>
        <div class="nums">${first ?? "–"}<span>/5 at the start</span>${latest ? `→ ${latest}<span>/5 now</span>` : ""}</div>
        <p>${latest ? "From your own ratings after each conversation" : "We'll ask again after your first conversation"}</p>
      </div>
      <p class="note"><button class="link" id="reset">Change project or goal</button></p>
    </aside>
  </div></section>`;
  $("#start")?.addEventListener("click", () => openTalk(next.file));
  view.querySelector(".units").onclick = (e) => { const b = e.target.closest("[data-file]"); if (b) openTalk(b.dataset.file); };
  view.querySelector(".goal-pick").onclick = async (e) => {
    const b = e.target.closest("[data-goal]");
    if (!b) return;
    try { await api("/api/goal", { dailyGoal: Number(b.dataset.goal) }); play.sound.play("good"); renderHome(); } catch (err) { toast(err.message); }
  };
  $("#reset").onclick = () => { Object.assign(onboarding, { goal: profile.goal, role: profile.role, date: profile.interviewDate, dailyGoal: profile.dailyGoal }); stepRepo(); };
}

// ---------------------------------------------------------------- the conversation

function openTalk(file) {
  location.hash = `#/talk/${encodeURIComponent(file)}`;
}

async function renderTalk(file) {
  const convo = { file, transcript: [], metrics: [], askedAt: 0, lens: "purpose", done: false, startedAt: Date.now(), busy: false, xp: 0, combo: 0, answers: 0, planned: 6 };
  view.innerHTML = html`<div class="stage">
    <header class="stage-top">
      <button class="close" id="end" type="button" aria-label="End the conversation" title="End"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <div class="lesson-bar" aria-hidden="true"><i id="lesson-fill"></i></div>
      <span class="combo" id="combo" hidden>${play.flame(true)}<b id="combo-n">3</b><small>in a row</small></span>
      <span class="xp-live" id="xp-live">${play.bolt}<b id="xp-n">0</b></span>
      <span class="clock" id="clock">0:00</span>
      <button class="btn btn-secondary btn-small" id="transcript-toggle" type="button" aria-expanded="false" aria-controls="drawer">Transcript</button>
      <div class="top-right" id="stage-tools"></div>
    </header>
    <section class="code-full" aria-label="Your code">
      <div class="code-head"><b>${esc(base(file))}</b><span>${esc(dir(file))}</span><span class="title" id="title">Reading your code…</span><span class="lens-chip" id="lens" hidden></span></div>
      <div class="code" id="code"><div class="scanline"></div></div>
    </section>
    <section class="caption" id="caption" aria-live="polite">
      <div class="q" id="q"><span class="tag" id="q-tag"></span><p id="q-text" class="status-line">Your agent is reading ${esc(base(file))} and the code around it. The first time takes about a minute</p></div>
      <div class="a" id="a" hidden><p id="a-text"></p><div class="assess" id="a-assess"></div></div>
      <div class="dock" id="dock">
        <div class="left"><button class="btn btn-secondary btn-small" id="stuck" disabled>I'm stuck</button></div>
        <div class="mic-wrap">
          <button class="mic" id="mic" disabled aria-label="Answer out loud">
            <svg class="mic-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
            <svg class="stop" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none"/></svg>
          </button>
          <span class="mic-label" id="mic-label">Getting ready</span>
        </div>
        <div class="right"><button class="link" id="type-toggle">Type instead</button></div>
      </div>
      <form class="typebox" id="typebox" hidden><textarea id="typed" rows="2" placeholder="Type your answer"></textarea><button class="btn btn-primary" type="submit">Send</button></form>
    </section>
    <aside class="drawer" id="drawer" aria-label="Transcript" hidden>
      <div class="drawer-head"><b>Transcript</b><button class="close" id="drawer-close" type="button" aria-label="Close transcript"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <div class="messages" id="messages"></div>
    </aside>
  </div>`;
  document.body.classList.add("in-talk");
  $("#stage-tools").append(soundBtn, voiceBtn);
  const code = $("#code");
  const messages = $("#messages");
  const micBtn = $("#mic");
  const micLabel = $("#mic-label");
  const caption = $("#caption");
  const clock = setInterval(() => {
    if (!document.body.contains(micBtn)) { mic.close(); return clearInterval(clock); }
    const s = Math.floor((Date.now() - convo.startedAt) / 1000);
    $("#clock").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }, 1000);

  api(`/api/file?file=${encodeURIComponent(file)}`).then(({ source }) => {
    renderCode(code, file, source);
    if (!convo.brief) code.prepend(el(`<div class="scanline"></div>`));
  }).catch((e) => toast(e.message));

  // The transcript drawer: the whole conversation, out of the way until you want it (T toggles it).
  const drawer = $("#drawer");
  const toggleDrawer = (open = drawer.hidden) => {
    drawer.hidden = !open;
    $("#transcript-toggle").setAttribute("aria-expanded", String(open));
    if (open) messages.scrollTop = messages.scrollHeight;
  };
  $("#transcript-toggle").onclick = () => toggleDrawer();
  $("#drawer-close").onclick = () => toggleDrawer(false);

  const setLabel = (text) => { micLabel.textContent = text; };
  const ready = () => {
    convo.busy = false;
    micBtn.disabled = convo.done;
    $("#stuck").disabled = convo.done;
    if (convo.done) { mic.close(); return setLabel(""); }
    if (convo.paused) return setLabel("Mic paused · tap to answer");
    listen();
  };
  const busy = (text) => { convo.busy = true; micBtn.disabled = true; $("#stuck").disabled = true; setLabel(text); };
  const scroll = () => messages.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });
  const setProgress = () => {
    const f = convo.done ? 1 : Math.min(0.92, convo.answers / convo.planned);
    $("#lesson-fill").style.width = `${Math.max(3, f * 100)}%`;
  };

  // The caption: the current question, big; your answer under it as you say it.
  function showQuestion(turn) {
    const tag = MOVE_TAG[turn.move];
    $("#q-tag").textContent = tag ?? (turn.lens ? LENS[turn.lens] : "");
    $("#q-tag").className = `tag ${tag ? "move" : ""}`;
    const p = $("#q-text");
    p.className = turn.move === "explain" ? "explain" : "";
    p.textContent = turn.say;
    $("#q").classList.remove("swap");
    void $("#q").offsetWidth;
    $("#q").classList.add("swap");
    $("#a").hidden = true;
    $("#a-assess").innerHTML = "";
  }
  function showAnswer(text, { live = false } = {}) {
    $("#a").hidden = false;
    $("#a-text").textContent = text;
    $("#a-text").classList.toggle("live", live);
  }

  async function interviewerSays(turn) {
    convo.transcript.push({ role: "them", text: turn.say, lens: turn.lens, move: turn.move });
    if (turn.lens) { convo.lens = turn.lens; $("#lens").hidden = false; $("#lens").textContent = LENS[turn.lens] ?? turn.lens; }
    const tag = MOVE_TAG[turn.move];
    messages.append(el(`<div class="msg them ${turn.move === "explain" ? "explain" : ""}">${tag ? `<span class="tag">${tag}</span>` : ""}<p>${esc(turn.say)}</p></div>`));
    scroll();
    showQuestion(turn);
    if (turn.lines) focusLines(code, turn.lines);
    if (turn.done) {
      convo.done = true;
      setProgress();
      $("#dock").hidden = true;
      $("#typebox").hidden = true;
      const bar = el(`<div class="done-bar"><button class="btn btn-primary btn-big">See how it went</button></div>`);
      $("#dock").after(bar);
      bar.firstElementChild.onclick = () => finish(convo);
    }
    busy(voice.on && !convo.paused && mic.stream ? "Interviewer speaking · just talk to cut in" : "Interviewer speaking");
    if (voice.on && !convo.paused && mic.stream && !turn.done) mic.watch(() => voice.stop());
    await voice.speak(turn.say);
    mic.unwatch();
    convo.askedAt = performance.now();
    ready();
  }

  // A scored answer: dots, the interviewer's note, and XP written in red pen.
  function scoreAnswer(assessment) {
    const mine = [...messages.querySelectorAll(".msg.you")].at(-1);
    if (!assessment) return;
    const dots = `<span class="dots" aria-label="${assessment.score} of 3">${[1, 2, 3].map((n) => `<i class="${assessment.score >= n ? "on" : ""}"></i>`).join("")}</span>`;
    mine?.append(el(`<div class="assess"><span>${esc(assessment.note)}</span>${dots}</div>`));
    $("#a-assess").innerHTML = `${dots}<span>${esc(assessment.note)}</span>`;
    const { xp, combo } = play.scoreAnswer(assessment.score, convo.combo);
    const comboStarted = combo >= play.COMBO_AT && combo > convo.combo;
    convo.combo = combo;
    convo.xp += xp;
    $("#xp-n").textContent = convo.xp;
    $("#xp-live").classList.remove("bump");
    void $("#xp-live").offsetWidth;
    $("#xp-live").classList.add("bump");
    play.xpPop($("#a"), `+${xp}`, assessment.score >= 2 ? "good" : "", { atRight: true });
    $("#combo").hidden = combo < play.COMBO_AT;
    $("#combo-n").textContent = combo;
    if (comboStarted) { $("#combo").classList.remove("bump"); void $("#combo").offsetWidth; $("#combo").classList.add("bump"); }
    caption.classList.remove("flash-good", "flash-meh");
    void caption.offsetWidth;
    caption.classList.add(assessment.score >= 2 ? "flash-good" : "flash-meh");
    play.sound.play(comboStarted && combo >= play.COMBO_AT ? "combo" : assessment.score === 3 ? "great" : assessment.score === 2 ? "good" : "meh");
  }

  async function answer(text, metric) {
    if (mic.recording) await mic.stop(); // typed or "I'm stuck" while the mic was listening: drop the audio
    micBtn.classList.remove("rec");
    if (!text.trim()) { ready(); return toast("Didn't catch that. Try again, or type it"); }
    convo.transcript.push({ role: "you", text });
    if (metric) convo.metrics.push(metric);
    messages.append(el(`<div class="msg you"><p>${esc(text)}</p></div>`));
    showAnswer(text);
    const wait = el(`<div class="msg them"><div class="thinking" aria-label="Thinking"><i></i><i></i><i></i></div></div>`);
    messages.append(wait);
    scroll();
    busy("Thinking");
    try {
      const turn = await api("/api/talk/turn", { id: convo.id, file, transcript: convo.transcript });
      wait.remove();
      if (turn.assessment) {
        convo.transcript.at(-1).assessment = turn.assessment;
        convo.answers++;
        setProgress();
        scoreAnswer(turn.assessment);
        await new Promise((r) => setTimeout(r, 900)); // let the score land before the next question
      }
      await interviewerSays(turn);
    } catch (e) {
      wait.remove();
      toast(e.message);
      convo.transcript.pop();
      ready();
    }
  }

  // speaking: hands-free, the mic opens once and each answer ends when you pause
  async function listen() {
    if (convo.busy || convo.done || convo.paused || mic.recording) return;
    try {
      await mic.open();
    } catch {
      convo.paused = true;
      setLabel("No microphone · type instead");
      $("#typebox").hidden = false;
      return;
    }
    if (convo.busy || convo.done || !document.body.contains(micBtn)) return;
    mic.start({ onLevel: (level) => micBtn.style.setProperty("--level", level.toFixed(3)), onEnd: submit });
    micBtn.classList.add("rec");
    micBtn.disabled = false;
    setLabel("Listening · answer, then pause");
    livePreview();
  }

  // While you talk, transcribe what you've said so far every couple of seconds, so your words
  // appear under the question as you speak. The final transcript replaces it when you pause.
  async function livePreview() {
    const take = mic.startedAt;
    while (mic.recording && mic.startedAt === take && document.body.contains(micBtn)) {
      await new Promise((r) => setTimeout(r, 1800));
      if (!mic.recording || mic.startedAt !== take || !mic.onsetAt) continue;
      if (performance.now() - mic.startedAt > 45_000) return; // long answers: wait for the final one
      try {
        const samples = await toSamples(new Blob(mic.chunks, { type: "audio/webm" }));
        const res = await fetch("/api/transcribe", { method: "POST", headers: { "content-type": "application/octet-stream" }, body: samples });
        const data = await res.json();
        if (res.ok && data.text && mic.recording && mic.startedAt === take) showAnswer(data.text, { live: true });
      } catch { /* a half-written recording that doesn't decode yet: try again next round */ }
    }
  }

  async function submit() {
    if (!mic.recording) return;
    micBtn.classList.remove("rec");
    micBtn.style.setProperty("--level", 0);
    busy("Transcribing on this machine");
    const blob = await mic.stop();
    const stoppedAt = performance.now();
    const thinkMs = mic.onsetAt ? Math.max(0, mic.onsetAt - Math.max(convo.askedAt, mic.startedAt - 15000)) : null;
    try {
      const samples = await toSamples(blob);
      const res = await fetch("/api/transcribe", { method: "POST", headers: { "content-type": "application/octet-stream" }, body: samples });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "transcription failed");
      const words = data.words ?? [];
      let longPauses = 0;
      for (let i = 1; i < words.length; i++) if (words[i][0] - words[i - 1][1] > 2.5) longPauses++;
      const speakingSec = words.length ? words.at(-1)[1] - words[0][0] : (stoppedAt - mic.startedAt) / 1000;
      await answer(data.text ?? "", {
        thinkMs,
        words: words.length,
        wpm: speakingSec > 3 ? Math.round((words.length / speakingSec) * 60) : null,
        fillers: (data.text?.match(FILLERS) ?? []).length,
        longPauses,
      });
    } catch (e) {
      toast(`${e.message}. You can type instead`);
      ready();
    }
  }

  // The button: while you're talking it sends right away; before you've said anything it pauses the mic.
  micBtn.onclick = async () => {
    if (mic.recording) {
      if (mic.onsetAt) return submit();
      await mic.stop();
      micBtn.classList.remove("rec");
      micBtn.style.setProperty("--level", 0);
      convo.paused = true;
      return setLabel("Mic paused · tap to answer");
    }
    if (convo.busy) return;
    convo.paused = false;
    voice.stop();
    listen();
  };
  const onKey = (e) => {
    if (!document.body.contains(micBtn)) return document.removeEventListener("keydown", onKey);
    if (/TEXTAREA|INPUT/.test(document.activeElement?.tagName)) return;
    if (e.code === "Space" && !micBtn.disabled) { e.preventDefault(); micBtn.click(); }
    if (e.key === "t" || e.key === "T") toggleDrawer();
    if (e.key === "Escape" && !drawer.hidden) toggleDrawer(false);
  };
  document.addEventListener("keydown", onKey);

  // typing
  $("#type-toggle").onclick = () => { $("#typebox").hidden = !$("#typebox").hidden; if (!$("#typebox").hidden) $("#typed").focus(); };
  $("#typebox").onsubmit = (e) => {
    e.preventDefault();
    if (convo.busy || convo.done) return;
    const text = $("#typed").value;
    $("#typed").value = "";
    answer(text, null);
  };
  $("#typed").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#typebox").requestSubmit(); } };
  $("#stuck").onclick = () => { if (!convo.busy) answer("I'm stuck on this one. Can you give me a nudge?", null); };
  $("#end").onclick = () => { voice.stop(); mic.close(); convo.transcript.some((t) => t.role === "you") ? finish(convo) : (location.hash = "#/"); };

  // go
  try {
    const { id, brief, turn } = await api("/api/talk/start", { file });
    convo.id = id;
    convo.brief = brief;
    convo.planned = (brief.angles?.length ?? 5) + 1;
    $("#title").textContent = brief.title;
    code.querySelector(".scanline")?.remove();
    setProgress();
    await interviewerSays(turn);
  } catch (e) {
    $("#q-text").textContent = `Couldn't read this file: ${e.message}`;
    code.querySelector(".scanline")?.remove();
  }
}

// ---------------------------------------------------------------- what you defended

async function finish(convo) {
  voice.stop();
  mic.close();
  document.body.classList.remove("in-talk");
  const headerTools = document.querySelector(".top .top-right");
  if (!headerTools.contains(voiceBtn)) headerTools.append(soundBtn, voiceBtn);
  const minutes = Math.max(1, Math.round((Date.now() - convo.startedAt) / 60000));
  view.innerHTML = `<section class="recap"><div class="recap-inner"><p class="eyebrow">Conversation done · ${minutes} min</p><h1>Scoring your conversation…</h1><div class="thinking" style="margin-top:20px"><i></i><i></i><i></i></div></div></section>`;
  const spoken = convo.metrics.filter(Boolean);
  const avg = (key) => {
    const v = spoken.map((m) => m[key]).filter((x) => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const metrics = spoken.length ? { answers: spoken.length, thinkSec: avg("thinkMs") != null ? +(avg("thinkMs") / 1000).toFixed(1) : null, wpm: avg("wpm") && Math.round(avg("wpm")), fillers: spoken.reduce((a, m) => a + m.fillers, 0), longPauses: spoken.reduce((a, m) => a + m.longPauses, 0) } : null;
  let recap;
  try {
    recap = await api("/api/talk/finish", { id: convo.id, file: convo.file, transcript: convo.transcript, metrics });
  } catch (e) {
    view.innerHTML = `<section class="recap"><div class="recap-inner"><h1>Couldn't write the recap</h1><p class="muted">${esc(e.message)}</p><p><a class="btn btn-secondary" href="#/">Back home</a></p></div></section>`;
    return;
  }
  if (recap.progress) {
    await play.celebrate(view, recap.progress, {
      minutes,
      title: convo.brief?.title ?? base(convo.file),
      onShown: () => api("/api/home").then((d) => play.renderHud(d.progress)).catch(() => {}),
    });
  }
  const tick = (i) => `<svg viewBox="0 0 22 20" aria-hidden="true"><path class="ink draw" style="animation-delay:${200 + i * 160}ms" pathLength="1" d="M2 11l6 6L20 2"/></svg>`;
  view.innerHTML = html`<section class="recap"><div class="recap-inner">
    <p class="eyebrow rise">${esc(convo.brief?.title ?? base(convo.file))} · ${minutes} min</p>
    <h1 class="rise d1">${esc(recap.headline)}</h1>
    <div class="recap-grid">
      <div class="rise d2">
        ${recap.defended.length ? `<h3>You defended</h3><ul class="ticks">${recap.defended.map((d, i) => `<li>${tick(i)}<span>${esc(d)}</span></li>`).join("")}</ul>` : ""}
        <h3>Work on this next</h3>
        <div class="gap">${esc(recap.gap.text)}${recap.gap.lines ? `<small>${esc(base(convo.file))} · lines ${recap.gap.lines[0]}–${recap.gap.lines[1]}</small>` : ""}</div>
      </div>
      <div class="story rise d3">
        <h3>Your one-minute story</h3>
        <p>${esc(recap.story)}</p>
        <div class="row"><span>Built from what you said</span><button class="btn btn-secondary btn-small" id="copy">Copy</button></div>
      </div>
    </div>
    ${metrics ? html`<div class="metrics rise d4">
      ${metrics.thinkSec != null ? `<div><b>${metrics.thinkSec}s</b><span>average before your first word</span></div>` : ""}
      <div><b>${metrics.longPauses}</b><span>long pauses mid-answer</span></div>
      <div><b>${metrics.fillers}</b><span>filler words</span></div>
      ${metrics.wpm ? `<div><b>${metrics.wpm}</b><span>words a minute</span></div>` : ""}
    </div>` : ""}
    <div class="again rise d4">
      <p>With the AI closed, how well could you explain this file now?</p>
      <div class="scale" id="again">${scaleButtons(null)}</div>
      <div class="actions"><a class="btn btn-primary" href="#/">Done</a></div>
    </div>
  </div></section>`;
  $("#copy").onclick = async () => { await navigator.clipboard.writeText(recap.story).catch(() => {}); $("#copy").textContent = "Copied"; };
  $("#again").onclick = async (e) => {
    const b = e.target.closest("[data-v]");
    if (!b) return;
    view.querySelectorAll("#again [data-v]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    await api("/api/confidence", { value: Number(b.dataset.v) }).catch((err) => toast(err.message));
  };
}

// ---------------------------------------------------------------- routing

async function route() {
  voice.stop();
  const hash = location.hash;
  // Leaving a conversation: the header and its buttons come back.
  document.body.classList.remove("in-talk");
  const headerTools = document.querySelector(".top .top-right");
  if (!headerTools.contains(voiceBtn)) headerTools.append(soundBtn, voiceBtn);
  try {
    if (hash.startsWith("#/talk/")) return await renderTalk(decodeURIComponent(hash.slice(7)));
    return await renderHome();
  } catch (e) {
    view.innerHTML = `<section class="onboard"><div class="onboard-inner"><h1>Something went wrong</h1><p class="lead">${esc(e.message)}</p><a class="btn btn-secondary" href="#/">Try again</a></div></section>`;
  }
}
window.addEventListener("hashchange", route);
route();

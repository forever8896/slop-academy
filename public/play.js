// The game layer: XP pops, combo, sounds, confetti, the top-bar HUD, the path of files on the home
// screen and the "conversation complete" celebration. The numbers come from lib/progress.mjs; the
// per-answer XP here mirrors it so the page can award points the moment an answer is scored.

export const XP_PER_SCORE = [2, 5, 10, 15];
export const COMBO_AT = 3;
export const COMBO_XP = 5;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const el = (markup) => { const t = document.createElement("template"); t.innerHTML = markup.trim(); return t.content.firstElementChild; };
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((r) => setTimeout(r, reduced() ? 0 : ms));

/** XP for one scored answer, given the combo it extends. */
export function scoreAnswer(score, combo) {
  const next = score >= 2 ? combo + 1 : 0;
  return { xp: XP_PER_SCORE[score] + (next >= COMBO_AT ? COMBO_XP : 0), combo: next };
}

// ---------------------------------------------------------------- sound (synthesized, no files)

export const sound = {
  on: localStorage.getItem("slop.sound") !== "off",
  ctx: null,
  toggle() {
    this.on = !this.on;
    localStorage.setItem("slop.sound", this.on ? "on" : "off");
    if (this.on) this.play("good");
    return this.on;
  },
  // Short marimba-ish notes: a sine with a fast attack and an exponential tail.
  notes(seq, gain = 0.16) {
    if (!this.on) return;
    try {
      this.ctx ??= new AudioContext();
      const t0 = this.ctx.currentTime + 0.01;
      for (const [freq, at, len = 0.22] of seq) {
        const o = this.ctx.createOscillator();
        const o2 = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = "sine";
        o2.type = "triangle";
        o.frequency.value = freq;
        o2.frequency.value = freq * 2;
        const g2 = this.ctx.createGain();
        g2.gain.value = 0.18;
        o.connect(g);
        o2.connect(g2).connect(g);
        g.connect(this.ctx.destination);
        g.gain.setValueAtTime(0.0001, t0 + at);
        g.gain.exponentialRampToValueAtTime(gain, t0 + at + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
        o.start(t0 + at);
        o2.start(t0 + at);
        o.stop(t0 + at + len + 0.05);
        o2.stop(t0 + at + len + 0.05);
      }
    } catch { /* no audio: fine */ }
  },
  play(kind) {
    const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5, A4 = 440, D5 = 587.33;
    ({
      good: () => this.notes([[E5, 0], [C6, 0.08, 0.3]]),
      great: () => this.notes([[E5, 0], [G5, 0.07], [C6, 0.14, 0.36]]),
      meh: () => this.notes([[A4, 0, 0.18]], 0.1),
      combo: () => this.notes([[C5, 0], [E5, 0.06], [G5, 0.12], [C6, 0.18, 0.4]]),
      tick: () => this.notes([[C6 * 1.5, 0, 0.05]], 0.04),
      complete: () => this.notes([[C5, 0], [E5, 0.12], [G5, 0.24], [C6, 0.36, 0.5], [G5, 0.52, 0.2], [C6, 0.62, 0.6]]),
      levelup: () => this.notes([[G5 / 2, 0], [C5, 0.1], [E5, 0.2], [G5, 0.3], [C6, 0.42, 0.7], [E5 * 2, 0.6, 0.8]], 0.18),
      streak: () => this.notes([[D5, 0], [A4 * 2, 0.09, 0.45]]),
    })[kind]?.();
  },
};

// ---------------------------------------------------------------- confetti, in pen and paper colours

export function confetti(amount = 140) {
  if (reduced()) return;
  const canvas = el(`<canvas class="confetti" aria-hidden="true"></canvas>`);
  document.body.append(canvas);
  const ctx = canvas.getContext("2d");
  const dpr = devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const colors = ["#b8321c", "#e0583e", "#1f1b16", "#e6b07a", "#16a34a", "#efe9df"];
  const bits = Array.from({ length: amount }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.3,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 15 - 4,
    w: 6 + Math.random() * 6,
    h: 3 + Math.random() * 4,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.4,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  (function frame(now) {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const b of bits) {
      b.vy += 0.42;
      b.vx *= 0.99;
      b.x += b.vx;
      b.y += b.vy;
      b.r += b.vr;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.r);
      ctx.fillStyle = b.c;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * Math.abs(Math.cos(b.r * 2)) + 1);
      ctx.restore();
    }
    if (now - t0 < 3200) requestAnimationFrame(frame);
    else canvas.remove();
  })(t0);
}

/** "+15" written in red pen, floating up from an element. */
export function xpPop(anchor, text, kind = "", { atRight = false } = {}) {
  const r = anchor.getBoundingClientRect();
  const pop = el(`<div class="xp-pop ${kind}" aria-hidden="true">${esc(text)}</div>`);
  pop.style.left = `${atRight ? r.right - 40 : r.left + r.width / 2}px`;
  pop.style.top = `${atRight ? r.top + 24 : r.top}px`;
  document.body.append(pop);
  setTimeout(() => pop.remove(), 1400);
}

/** Counts a number up in an element. */
export async function countUp(node, from, to, ms = 900, onStep) {
  if (reduced() || from === to) { node.textContent = to; return; }
  const t0 = performance.now();
  let last = from;
  await new Promise((done) => {
    (function step(now) {
      const k = Math.min(1, (now - t0) / ms);
      const v = Math.round(from + (to - from) * (1 - (1 - k) ** 3));
      node.textContent = v;
      if (v !== last) { last = v; onStep?.(v); }
      if (k < 1) requestAnimationFrame(step); else done();
    })(t0);
  });
}

// ---------------------------------------------------------------- icons

export const flame = (lit = true) => `<svg class="flame ${lit ? "lit" : ""}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c.6 3.2-1.1 5-2.6 6.7C7.8 11 6.5 12.6 6.5 15a5.5 5.5 0 0 0 11 0c0-2.3-1-4-2.2-5.3.1 1.6-.5 2.8-1.6 3.4.4-3.9-.6-7.6-1.7-10.6Z"/><path class="core" d="M12 13.2c-.9 1.1-2 2-2 3.4a2 2 0 0 0 4 0c0-1.3-.8-2.3-2-3.4Z"/></svg>`;
export const bolt = `<svg class="bolt" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2 5 13.2h6l-1 8.8 8.5-11.4h-6l1-8.6Z"/></svg>`;
const snow = `<svg class="snow" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9.5 4 12 6.5 14.5 4M9.5 20l2.5-2.5 2.5 2.5"/></svg>`;
const micIcon = `<svg class="node-mic" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`;
const tickMark = `<svg viewBox="0 0 22 20" aria-hidden="true"><path d="M2 11l6 6L20 2"/></svg>`;

// ---------------------------------------------------------------- the HUD in the top bar

export function renderHud(p) {
  const hud = document.getElementById("hud");
  if (!hud || !p) return;
  hud.hidden = false;
  hud.innerHTML = `
    <span class="hud-item streak ${p.streak.doneToday ? "done" : ""}" title="${p.streak.count}-day streak${p.streak.freezes ? ` · ${p.streak.freezes} freeze${p.streak.freezes > 1 ? "s" : ""}` : ""}">${flame(p.streak.count > 0)}<b>${p.streak.count}</b></span>
    <span class="hud-item xp" title="Level ${p.level.n}: ${esc(p.level.title)}">${bolt}<b>${p.xp}</b></span>
    <span class="hud-item goal" title="Today: ${p.today.xp} of ${p.today.goal} XP">${ring(p.today.xp / p.today.goal, 22, 3)}</span>`;
}

export function ring(fraction, size = 120, stroke = 10, inner = "") {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction));
  return `<span class="ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" class="track"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" class="fill ${f >= 1 ? "full" : ""}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - f)}" style="--c:${c}"/>
  </svg>${inner ? `<span class="ring-in">${inner}</span>` : ""}</span>`;
}

// ---------------------------------------------------------------- home: the path through your repo

const DAY = ["S", "M", "T", "W", "T", "F", "S"];

/** Units of four files; each node is a circle you fill by answering well on more lenses. */
export function pathHtml(areas, nextFile, { base, dir }) {
  const units = [];
  for (let i = 0; i < areas.length; i += 4) units.push(areas.slice(i, i + 4));
  let n = 0;
  return units.map((unit, u) => {
    // Named after the innermost folder the unit's files share ("boat_oneclaw", not "python").
    const parts = unit.map((a) => dir(a.file).split("/").filter(Boolean));
    let common = parts[0]?.length ?? 0;
    for (const p of parts) { let k = 0; while (k < common && p[k] === parts[0][k]) k++; common = k; }
    // No shared folder: name it after the folder most of its files sit in, if there is one.
    const inner = parts.map((p) => p.at(-1) ?? "root");
    const most = inner.sort((a, b) => inner.filter((x) => x === b).length - inner.filter((x) => x === a).length)[0];
    const top = common ? parts[0][common - 1] : inner.filter((x) => x === most).length * 2 >= inner.length ? most : "root";
    const doneCount = unit.filter((a) => a.talks).length;
    return `<section class="unit" style="--u:${u}">
      <header class="unit-head"><div><small>Unit ${u + 1}</small><b>${esc(top === "root" ? "The core" : top)}</b></div><span>${doneCount}/${unit.length}</span></header>
      <ol class="path">
        ${unit.map((a) => {
          const i = n++;
          const x = Math.round(Math.sin(i * 1.15) * 72);
          const current = a.file === nextFile;
          const m = a.mastery ?? 0;
          const state = current ? "current" : m >= 5 ? "mastered" : a.talks ? "started" : "new";
          const label = m >= 5 ? "Mastered" : a.talks ? `${m}/5 lenses` : "Not yet";
          return `<li class="node ${state}" style="--x:${x}px">
            <button type="button" data-file="${esc(a.file)}" aria-label="${esc(base(a.file))}, ${label}">
              ${ring(m / 5, current ? 96 : 84, 6, state === "mastered" ? `<span class="crown">${tickMark}</span>` : current ? micIcon : `<span class="glyph">${i + 1}</span>`)}
            </button>
            <span class="node-name">${esc(base(a.file))}</span>
            <span class="node-sub">${label}</span>
          </li>`;
        }).join("")}
      </ol>
    </section>`;
  }).join("");
}

export function sideHtml(p, goals) {
  const goalLabel = goals[p.today.goal] ?? "";
  const met = p.today.xp >= p.today.goal;
  return `
    <div class="card goal-card">
      ${ring(p.today.xp / p.today.goal, 92, 9, `<b>${p.today.xp}</b><small>/${p.today.goal}</small>`)}
      <div>
        <h3>${met ? "Daily goal met" : "Daily goal"}</h3>
        <p>${met ? "Anything more today is bonus XP" : `${p.today.goal - p.today.xp} XP to go today`}</p>
        <div class="goal-pick" role="group" aria-label="Daily goal">${Object.entries(goals).map(([xp, name]) => `<button type="button" data-goal="${xp}" aria-pressed="${Number(xp) === p.today.goal}">${name}</button>`).join("")}</div>
        <small class="muted">${goalLabel ? `${goalLabel}: ${p.today.goal} XP a day` : ""}</small>
      </div>
    </div>
    <div class="card streak-card ${p.streak.count ? "on" : ""}">
      <div class="streak-top">${flame(p.streak.count > 0)}<div><b>${p.streak.count}</b><span>day streak</span></div>
        ${p.streak.freezes ? `<span class="freezes" title="Streak freezes: they cover a missed day">${snow}×${p.streak.freezes}</span>` : ""}</div>
      <ol class="week">${p.week.map((d) => {
        const wd = DAY[new Date(`${d.day}T12:00`).getDay()];
        return `<li class="${d.xp ? "did" : d.frozen ? "froze" : ""} ${d.today ? "is-today" : ""}"><span>${d.xp ? tickMark : d.frozen ? snow : ""}</span><small>${wd}</small></li>`;
      }).join("")}</ol>
      <p>${p.streak.doneToday ? "You're on it today. Come back tomorrow to keep it going" : p.streak.count ? "One conversation today keeps your streak alive" : "Have one conversation today to start a streak"}</p>
    </div>
    <div class="card level-card">
      <div class="level-top"><span class="lv">${p.level.n}</span><div><b>${esc(p.level.title)}</b><small>${p.level.next ? `${p.level.next - p.xp} XP to ${esc(p.level.nextTitle)}` : "Top level"}</small></div></div>
      <div class="bar"><i style="width:${Math.round(p.level.progress * 100)}%"></i></div>
    </div>`;
}

export function badgesHtml(unlocked, all) {
  const have = new Set(unlocked.map((a) => a.id));
  return `<div class="badges">${Object.entries(all).map(([id, [name, about]]) =>
    `<div class="badge ${have.has(id) ? "got" : ""}" title="${esc(about)}"><span>${have.has(id) ? tickMark : ""}</span><b>${esc(name)}</b></div>`).join("")}</div>`;
}

// ---------------------------------------------------------------- "conversation complete"

/** The celebration: XP counting up, the goal ring, the streak, level, achievements. Resolves on Continue. */
export async function celebrate(view, g, { minutes, title, onShown }) {
  const leveled = g.levelUp;
  const goalCrossed = g.before.todayXp < g.goal && g.after.todayXp >= g.goal;
  view.innerHTML = `<section class="celebrate"><div class="celebrate-inner">
    <div class="burst" aria-hidden="true"><svg viewBox="0 0 120 120"><path class="ink draw" pathLength="1" d="M60 8c26 0 48 20 50 46 2 30-22 56-52 56C30 110 9 88 10 60 11 33 33 10 60 8Z"/><path class="ink draw tick" pathLength="1" d="M38 62l15 15 30-34"/></svg></div>
    <p class="eyebrow">${esc(title)} · ${minutes} min</p>
    <h1>Conversation complete</h1>
    <div class="tiles">
      <div class="tile xp-tile"><small>XP earned</small><b><span id="c-xp">0</span></b></div>
      <div class="tile"><small>Score</small><b>${g.accuracy == null ? "–" : `${g.accuracy}%`}</b></div>
      ${g.bestCombo >= COMBO_AT
        ? `<div class="tile"><small>Best combo</small><b>${g.bestCombo}</b></div>`
        : `<div class="tile"><small>Answers</small><b>${g.answers}</b></div>`}
    </div>
    <ul class="breakdown">${g.breakdown.map((b, i) => `<li style="--i:${i}"><span>${esc(b.label)}</span><b>+${b.xp}</b></li>`).join("")}</ul>
    <div class="cel-row">
      <div class="cel-goal">${ring(g.before.todayXp / g.goal, 104, 10, `<b id="c-today">${g.before.todayXp}</b><small>/${g.goal}</small>`)}<p id="c-goal-note">${goalCrossed ? "" : g.after.todayXp >= g.goal ? "Daily goal met" : `${g.goal - g.after.todayXp} XP to today's goal`}</p></div>
      <div class="cel-streak ${g.streakExtended ? "grow" : g.after.streak ? "lit still" : ""}">${flame(true)}<div><b id="c-streak">${g.before.streak}</b><span>day streak</span></div></div>
      <div class="cel-level"><div class="level-top"><span class="lv" id="c-lv">${g.before.level.n}</span><div><b id="c-lv-title">${esc(g.before.level.title)}</b><small id="c-lv-next"></small></div></div><div class="bar"><i id="c-bar" style="width:${Math.round(g.before.level.progress * 100)}%"></i></div></div>
    </div>
    <div class="unlocks" id="unlocks"></div>
    <div class="actions"><button class="btn btn-primary btn-big" id="continue">See what you defended</button></div>
  </div></section>`;
  const root = view.firstElementChild;
  const $ = (s) => root.querySelector(s);
  const clicked = new Promise((resolve) => { $("#continue").onclick = resolve; });
  $("#continue").focus();
  const SKIPPED = Symbol("skipped");
  const step = async (ms) => { await wait(ms); if (!root.isConnected) throw SKIPPED; };
  const show = animate($, step, g, leveled, goalCrossed).catch((e) => { if (e !== SKIPPED) throw e; });
  await Promise.race([clicked, show]);
  onShown?.();
  return clicked;
}

async function animate($, step, g, leveled, goalCrossed) {
  sound.play("complete");
  await step(500);
  const xpNode = $("#c-xp");
  await countUp(xpNode, 0, g.earned, 1100, () => xpNode.isConnected && sound.play("tick"));

  // The goal ring fills.
  await step(250);
  const fill = $(".cel-goal .fill");
  const c = Number(fill.style.getPropertyValue("--c"));
  fill.style.strokeDashoffset = c * (1 - Math.min(1, g.after.todayXp / g.goal));
  await countUp($("#c-today"), g.before.todayXp, g.after.todayXp, 900);
  await step(0);
  if (goalCrossed) {
    fill.classList.add("full");
    $("#c-goal-note").textContent = "Daily goal met!";
    $("#c-goal-note").classList.add("hot");
    sound.play("great");
    confetti(120);
  }

  // The streak grows.
  if (g.streakExtended) {
    await step(400);
    $(".cel-streak").classList.add("lit");
    $("#c-streak").textContent = g.after.streak;
    sound.play("streak");
    if (g.freezeEarned) unlockCard($("#unlocks"), "Streak freeze earned", "A week straight: one missed day is now covered");
  }
  if (g.freezeUsed) unlockCard($("#unlocks"), "Streak saved", `A streak freeze covered ${g.freezeUsed} missed day${g.freezeUsed > 1 ? "s" : ""}`);

  // The level bar moves; a new level gets its own moment.
  await step(400);
  if (leveled) {
    $("#c-bar").style.width = "100%";
    await step(650);
    $("#c-lv").textContent = g.after.level.n;
    $("#c-lv-title").textContent = g.after.level.title;
    $(".cel-level").classList.add("up");
    $("#c-bar").style.transition = "none";
    $("#c-bar").style.width = "0%";
    void $("#c-bar").offsetWidth;
    $("#c-bar").style.transition = "";
    sound.play("levelup");
    confetti(180);
    unlockCard($("#unlocks"), `Level ${g.after.level.n}: ${g.after.level.title}`, "New level");
    await step(200);
  }
  $("#c-bar").style.width = `${Math.round(g.after.level.progress * 100)}%`;
  $("#c-lv-next").textContent = g.after.level.next ? `${g.after.level.next - g.after.xp} XP to ${g.after.level.nextTitle}` : "Top level";

  for (const a of g.unlocked) {
    await step(350);
    unlockCard($("#unlocks"), a.name, a.about);
    sound.play("great");
  }
}

function unlockCard(container, name, about) {
  container.append(el(`<div class="unlock"><span>${tickMark}</span><div><b>${esc(name)}</b><small>${esc(about)}</small></div></div>`));
}

// Progression: XP for every answer, a daily goal, a day streak with freezes, levels and achievements.
// All of it lives in your profile (profile.progress); the page shows it, the launcher greets you with it.
//
// XP is earned from what the interviewer actually scored (0-3 per answer), so it tracks understanding,
// not time spent. The page computes the same per-answer numbers live (public/talk.js, answerXp).

export const XP_PER_SCORE = [2, 5, 10, 15];
export const COMBO_AT = 3; // three strong answers in a row starts a combo
export const COMBO_XP = 5;
export const FINISH_XP = 20;
export const NO_HINT_XP = 10;
export const DAILY_GOALS = { 30: "Casual", 60: "Regular", 120: "Serious" };
const MAX_FREEZES = 2;

export const LEVELS = [
  [0, "Vibe coder"],
  [60, "Code reader"],
  [180, "Can explain it"],
  [400, "Code owner"],
  [750, "Reviewer"],
  [1250, "Senior"],
  [2000, "Staff"],
  [3200, "The one they page"],
];

export const ACHIEVEMENTS = {
  first_talk: ["First defense", "Finished your first conversation"],
  nailed_it: ["Nailed it", "An answer the interviewer scored 3 of 3"],
  no_hints: ["No hints needed", "A whole conversation without a hint"],
  on_a_roll: ["On a roll", "Five strong answers in a row"],
  streak_3: ["Three days running", "A 3-day streak"],
  streak_7: ["A week of it", "A 7-day streak"],
  streak_30: ["A month of it", "A 30-day streak"],
  every_angle: ["Every angle", "Strong answers on six different lenses"],
  territory: ["Know the territory", "Talked through five different files"],
  night_owl: ["Night owl", "A conversation after 11pm"],
  early_bird: ["Early bird", "A conversation before 8am"],
};

export function level(xp) {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1][0]) i++;
  const [floor, title] = LEVELS[i];
  const next = LEVELS[i + 1];
  return {
    n: i + 1,
    title,
    floor,
    next: next?.[0] ?? null,
    nextTitle: next?.[1] ?? null,
    progress: next ? (xp - floor) / (next[0] - floor) : 1,
  };
}

/** Local calendar day, YYYY-MM-DD: a streak follows your clock, not UTC. */
export function dayKey(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const addDays = (key, n) => {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d + n));
};

function state(profile) {
  profile.progress ??= {};
  const p = profile.progress;
  p.xp ??= 0;
  p.days ??= {}; // day -> XP earned that day
  p.frozen ??= []; // days a streak freeze covered
  p.freezes ??= 0;
  p.best ??= 0;
  p.achievements ??= {}; // id -> ISO time unlocked
  profile.dailyGoal ??= 60;
  return p;
}

/** Consecutive days with a conversation (or a freeze), ending today or, if today is still open, yesterday. */
function streakCount(p, today = dayKey()) {
  const covered = (d) => (p.days[d] ?? 0) > 0 || p.frozen.includes(d);
  let day = covered(today) ? today : addDays(today, -1);
  let n = 0;
  while (covered(day)) { n++; day = addDays(day, -1); }
  return n;
}

/** Per-answer XP and the running combo, exactly as the page shows it live. */
export function answerXp(scores) {
  let combo = 0;
  let best = 0;
  const each = scores.map((s) => {
    combo = s >= 2 ? combo + 1 : 0;
    best = Math.max(best, combo);
    return XP_PER_SCORE[s] + (combo >= COMBO_AT ? COMBO_XP : 0);
  });
  return { each, bestCombo: best };
}

/** What the home screen and the launcher show. */
export function summary(profile, now = new Date()) {
  const p = state(profile);
  const today = dayKey(now);
  const streak = streakCount(p, today);
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    week.push({ day: d, xp: p.days[d] ?? 0, frozen: p.frozen.includes(d), today: d === today });
  }
  return {
    xp: p.xp,
    level: level(p.xp),
    streak: { count: streak, best: Math.max(p.best, streak), freezes: p.freezes, doneToday: (p.days[today] ?? 0) > 0 },
    today: { xp: p.days[today] ?? 0, goal: profile.dailyGoal },
    week,
    achievements: Object.entries(p.achievements).map(([id, at]) => ({ id, at, name: ACHIEVEMENTS[id]?.[0] ?? id, about: ACHIEVEMENTS[id]?.[1] ?? "" })),
  };
}

/**
 * Books one finished conversation into the profile and says what changed, for the celebration screen.
 * Call before saving the profile; the conversation's history entry must already be in profile.history.
 */
export function apply(profile, { transcript, at = new Date() }) {
  const p = state(profile);
  const today = dayKey(at);

  // A missed day or two is covered by freezes, if you have them, so the streak you had still counts.
  let freezeUsed = 0;
  const last = Object.keys(p.days).filter((d) => p.days[d] > 0 && d < today).sort().at(-1);
  if (last && !p.days[today]) {
    const missed = [];
    for (let d = addDays(last, 1); d < today; d = addDays(d, 1)) if (!p.frozen.includes(d)) missed.push(d);
    if (missed.length && missed.length <= p.freezes) {
      p.frozen.push(...missed);
      p.freezes -= missed.length;
      freezeUsed = missed.length;
    }
  }
  const before = summary(profile, at);

  const scores = (transcript ?? []).filter((t) => t.role === "you" && Number.isInteger(t.assessment?.score)).map((t) => Math.max(0, Math.min(3, t.assessment.score)));
  const hints = (transcript ?? []).filter((t) => t.role === "them" && (t.move === "hint" || t.move === "explain")).length;
  const { each, bestCombo } = answerXp(scores);
  const breakdown = [{ label: `${scores.length} answer${scores.length === 1 ? "" : "s"}`, xp: each.reduce((a, b) => a + b, 0) }];
  if (scores.length >= 2) breakdown.push({ label: "Finished the conversation", xp: FINISH_XP });
  if (scores.length >= 3 && !hints) breakdown.push({ label: "No hints", xp: NO_HINT_XP });
  const earned = breakdown.reduce((a, b) => a + b.xp, 0);

  p.xp += earned;
  p.days[today] = (p.days[today] ?? 0) + earned;
  const streak = streakCount(p, today);
  let freezeEarned = false;
  if (streak > before.streak.count && streak % 7 === 0 && p.freezes < MAX_FREEZES) { p.freezes++; freezeEarned = true; }
  p.best = Math.max(p.best, streak);

  // Achievements.
  const unlocked = [];
  const unlock = (id, when) => { if (when && !p.achievements[id]) { p.achievements[id] = at.toISOString(); unlocked.push({ id, name: ACHIEVEMENTS[id][0], about: ACHIEVEMENTS[id][1] }); } };
  const bestLens = {};
  for (const h of profile.history) for (const [lens, s] of Object.entries(h.lensScores ?? {})) bestLens[lens] = Math.max(bestLens[lens] ?? 0, s);
  const hour = new Date(at).getHours();
  unlock("first_talk", true);
  unlock("nailed_it", scores.includes(3));
  unlock("no_hints", scores.length >= 3 && !hints);
  unlock("on_a_roll", bestCombo >= 5);
  unlock("streak_3", streak >= 3);
  unlock("streak_7", streak >= 7);
  unlock("streak_30", streak >= 30);
  unlock("every_angle", Object.values(bestLens).filter((s) => s >= 2).length >= 6);
  unlock("territory", new Set(profile.history.map((h) => h.file)).size >= 5);
  unlock("night_owl", hour >= 23);
  unlock("early_bird", hour < 8);

  const after = summary(profile, at);
  return {
    earned,
    breakdown,
    answers: scores.length,
    accuracy: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / (scores.length * 3)) * 100) : null,
    bestCombo,
    before: { xp: before.xp, level: before.level, streak: before.streak.count, todayXp: before.today.xp },
    after: { xp: after.xp, level: after.level, streak: after.streak.count, todayXp: after.today.xp },
    goal: profile.dailyGoal,
    streakExtended: after.streak.count > before.streak.count,
    freezeUsed,
    freezeEarned,
    levelUp: after.level.n > before.level.n,
    unlocked,
    week: after.week,
  };
}

/** Each file's mastery, 0-5: how many lenses you've answered well on (2+ of 3) across all talks. */
export function mastery(history, file) {
  const best = {};
  for (const h of history) if (h.file === file) for (const [lens, s] of Object.entries(h.lensScores ?? {})) best[lens] = Math.max(best[lens] ?? 0, s);
  return Math.min(5, Object.values(best).filter((s) => s >= 2).length);
}

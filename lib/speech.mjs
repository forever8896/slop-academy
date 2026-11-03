// Local speech for the server and the launcher: Kokoro speaks the interviewer, Whisper hears you.
// The models run on a worker thread (lib/speech-worker.mjs) so loading them never freezes anything;
// this module is the main thread's handle on it.

import path from "node:path";
import { Worker } from "node:worker_threads";
import { DATA } from "./paths.mjs";

export const MODELS = process.env.SLOP_MODELS ?? path.join(DATA, "models");

let state = { tts: { state: "idle", progress: 0 }, stt: { state: "idle", progress: 0 } };
let worker = null;
let seq = 0;
const pending = new Map();

function thread() {
  if (worker) return worker;
  worker = new Worker(new URL("./speech-worker.mjs", import.meta.url), { workerData: { models: MODELS } });
  worker.on("message", (m) => {
    if (m.type === "status") { state = m.state; return; }
    const job = pending.get(m.id);
    if (!job) return;
    pending.delete(m.id);
    if (!pending.size) worker.unref();
    m.error ? job.reject(new Error(m.error)) : job.resolve(m.result);
  });
  worker.on("error", (error) => {
    const message = String(error.message ?? error).slice(0, 300);
    state = { tts: { state: "error", progress: 0, error: message }, stt: { state: "error", progress: 0, error: message } };
    for (const job of pending.values()) job.reject(error);
    pending.clear();
    worker = null;
  });
  worker.unref(); // idle models don't keep the process alive; a pending request does (call())
  return worker;
}

function call(op, payload, transfer = []) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    thread().ref();
    thread().postMessage({ id, op, ...payload }, transfer);
  });
}

/** Load state for each model, with download progress for the launcher and the page. */
export const status = () => state;
export const ttsReady = () => state.tts.state === "ready";

/** Start loading (and on first run downloading) both models without waiting for them. */
export function warm() {
  thread().postMessage({ op: "warm" });
}

/** Text to a WAV file's bytes. */
export async function synthesize(text, voice) {
  return Buffer.from(await call("tts", { text, voice }));
}

/** 16 kHz mono float samples to text with word timings, like {text, words: [[start, end, word]], duration}. */
export function transcribe(samples) {
  const copy = new Float32Array(samples); // the copy's buffer moves to the worker
  return call("stt", { samples: copy }, [copy.buffer]);
}

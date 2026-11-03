// Local speech, on a worker thread (lib/speech.mjs talks to it): Kokoro speaks the interviewer,
// Whisper hears you. Both are ONNX models run by onnxruntime on the CPU. They download once from
// Hugging Face into the models folder; after that nothing about your voice leaves the machine.
//
// A thread of its own because creating the model sessions blocks for seconds at a time, which
// would freeze the server and the launcher's animation.

import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { resolveEngine } from "./runtime.mjs";

// The engine lives in this checkout's node_modules, or in ~/.slop-academy/runtime (lib/runtime.mjs).
// Both load through their CommonJS entry, so kokoro-js and we share one transformers instance.
const engine = (name) => {
  const entry = resolveEngine(name);
  if (!entry) throw new Error("the speech engine isn't installed; restart slop-academy to install it");
  return import(pathToFileURL(entry).href);
};

const MODELS = workerData.models;
const TTS_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
// base.en answers in about a second; small.en hears fillers ("um") better but is ~3x slower.
const STT_MODEL = `onnx-community/whisper-${process.env.SLOP_STT_MODEL ?? "base.en"}_timestamped`;

// transformers.js warns once per file that Hugging Face's CDN sends no content-length. Harmless noise.
const warn = console.warn;
console.warn = (...args) => {
  if (/content-length/i.test(String(args[0]))) return;
  warn(...args);
};

let transformers;
async function lib() {
  transformers ??= engine("@huggingface/transformers").then((m) => m.default ?? m).then((t) => {
    t.env.cacheDir = MODELS;
    t.env.allowLocalModels = false;
    return t;
  });
  return transformers;
}

/** Load state for each model, with download progress the page can show on first run. */
const state = { tts: { state: "idle", progress: 0 }, stt: { state: "idle", progress: 0 } };

function tracker(which) {
  const files = new Map();
  return (p) => {
    if (p.status === "progress" && p.total) files.set(p.file, [p.loaded, p.total]);
    if (p.status === "download") state[which].state = "downloading";
    let loaded = 0;
    let total = 0;
    for (const [l, t] of files.values()) { loaded += l; total += t; }
    if (total) Object.assign(state[which], { progress: loaded / total, loaded, total });
  };
}

function load(which, make) {
  let promise;
  return () => {
    promise ??= (async () => {
      state[which].state = "loading";
      try {
        const model = await make(tracker(which));
        state[which] = { state: "ready", progress: 1, total: state[which].total ?? 0, downloaded: state[which].state === "downloading" };
        return model;
      } catch (error) {
        state[which] = { state: "error", progress: 0, error: String(error.message ?? error).slice(0, 300) };
        promise = null; // try again next time, e.g. after the network comes back
        throw error;
      }
    })();
    return promise;
  };
}

const tts = load("tts", async (progress_callback) => {
  await lib();
  const kokoro = await engine("kokoro-js");
  const { KokoroTTS } = kokoro.default ?? kokoro;
  // fp32: on onnxruntime-node the int8 build is about twice as slow.
  return KokoroTTS.from_pretrained(TTS_MODEL, { dtype: "fp32", device: "cpu", progress_callback });
});

const stt = load("stt", async (progress_callback) => {
  const { pipeline } = await lib();
  return pipeline("automatic-speech-recognition", STT_MODEL, {
    dtype: { encoder_model: "fp32", decoder_model_merged: "q8" },
    device: "cpu",
    progress_callback,
  });
});

/** Start loading (and on first run downloading) both models without waiting for them. */
function warm() {
  tts().catch(() => {}); // the error is in the state the launcher and the page show
  stt().catch(() => {});
}

// One inference at a time per model: they share the CPU, and the page asks in order anyway.
const queues = { tts: Promise.resolve(), stt: Promise.resolve() };
function serial(which, job) {
  const next = queues[which].then(job);
  queues[which] = next.catch(() => {});
  return next;
}

/** Text to a WAV file's bytes. */
async function synthesize(text, voice) {
  const model = await tts();
  return serial("tts", async () => {
    const audio = await model.generate(text, { voice });
    return wav16(audio.audio, audio.sampling_rate);
  });
}

/** 16-bit PCM WAV: half the size of kokoro-js's float WAV, and what every browser plays. */
function wav16(samples, rate) {
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + samples.length * 2, 4);
  out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(1, 22); // mono
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return out;
}

/** 16 kHz mono float samples to text with word timings, like {text, words: [[start, end, word]], duration}. */
async function transcribe(samples) {
  const asr = await stt();
  return serial("stt", async () => {
    const t0 = Date.now();
    const out = await asr(samples, { return_timestamps: "word", chunk_length_s: 30, stride_length_s: 5 });
    const words = (out.chunks ?? [])
      .map((c) => [round(c.timestamp[0]), round(c.timestamp[1] ?? c.timestamp[0]), c.text.replace(/["“”]/g, "")])
      .filter((w) => w[2].trim());
    return {
      text: words.length ? words.map((w) => w[2]).join("").trim() : String(out.text ?? "").replace(/["“”]/g, "").trim(),
      words,
      duration: round(samples.length / 16000),
      took: round((Date.now() - t0) / 1000),
    };
  });
}

const round = (x) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------- talking to the main thread

// Load state goes up whenever it changes, at most ten times a second.
let sent = "";
setInterval(() => {
  const now = JSON.stringify(state);
  if (now !== sent) { sent = now; parentPort.postMessage({ type: "status", state }); }
}, 100);

parentPort.on("message", async ({ id, op, text, voice, samples }) => {
  if (op === "warm") return warm();
  try {
    const result = op === "tts" ? await synthesize(text, voice) : await transcribe(samples);
    parentPort.postMessage({ id, result }, op === "tts" ? [result.buffer] : []);
  } catch (error) {
    parentPort.postMessage({ id, error: String(error.message ?? error) });
  }
});

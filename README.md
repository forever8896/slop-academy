# Slop Academy

**You shipped it. Can you defend it?**

Slop Academy is a practice interviewer for code you've shipped, often with AI help. Pick a repo:
it finds the files you change most, asks you about them out loud one question at a time (how it
fails, how it scales, why it's built this way), scores each answer, and writes up what you could
and couldn't explain. XP, a daily goal and a streak keep you coming back.

```sh
npx slop-academy
```

It runs entirely on your computer. There is no account and no Slop Academy server.

## How one answer travels

```
╭──────╮   ╭─────────╮   ╭─────────────╮   ╭────────╮
│ you  │──▶│ Whisper │──▶│ your claude │──▶│ Kokoro │──╮
│ talk │   │  local  │   │  your plan  │   │ local  │  │
╰──────╯   ╰─────────╯   ╰─────────────╯   ╰────────╯  │
    ▲                                                  │
    ╰──────────────────────────────────────────────────╯
```

Whisper turns your voice into text on your computer. Your own Claude Code reads the file, asks
the next question and scores your answer, on your plan. Kokoro reads the question out loud, on
your computer. Turn on your mic and just talk: your answer is sent when you pause, and you can
talk over the interviewer to cut in.

Run `slop-academy --about` any time to see this in your terminal.

## What you need

- **Node 20+**
- **Claude Code**, installed and logged in (`claude`). The interviewer is your own Claude Code, so
  it runs on your Claude subscription or API key. See https://claude.com/claude-code
- **git**
- A browser with a microphone (or type your answers)

The first start installs the speech engine (transformers.js, Kokoro and Whisper; about 430 MB, or
740 MB on Linux x64) into `~/.slop-academy/runtime` and downloads the voice models (about 460 MB).
Both happen once, with progress on screen. Later starts take seconds.

## Where your data goes

- The app runs on `127.0.0.1` and only answers its own page.
- Your code is read by your local `claude` CLI, which sends it to Anthropic like any Claude Code
  session does, under your own account.
- Your voice never leaves your computer.
- Your profile, conversations, recaps, XP and streak are files in `~/.slop-academy`. Delete that
  folder to forget everything.

## Options

```sh
npx slop-academy --port 9000 --no-open
npx slop-academy --about                 # what this is, how it works, where your data goes
SLOP_MODEL=haiku npx slop-academy        # faster, cheaper interviewer (sonnet by default)
SLOP_STT_MODEL=small.en npx slop-academy # hears "um"s better, about 3x slower than base.en
SLOP_DATA=~/somewhere-else npx slop-academy
```

## Working on it

```sh
git clone https://github.com/forever8896/slop-academy && cd slop-academy
npm install   # the speech engine, as a dev dependency
./run.sh      # http://localhost:8795, with this folder's data/ instead of ~/.slop-academy
```

| Path | What it is |
| --- | --- |
| `bin/slop-academy.mjs` | The command: checks, the live terminal screen, starts the app |
| `server.mjs` | The local HTTP server (127.0.0.1 only) |
| `lib/talk.mjs` | Repo scanning, the interviewer (your `claude` CLI), recaps |
| `lib/progress.mjs` | XP, streaks, daily goal, levels, achievements |
| `lib/speech.mjs`, `lib/speech-worker.mjs` | Kokoro and Whisper on a worker thread |
| `lib/runtime.mjs` | Installs the speech engine on first run |
| `lib/ui.mjs`, `lib/spin3d.mjs` | The terminal screen and the spinning 3D logo |
| `public/` | The app's page |
| `site/` | The website |
| `research/` | How the numbers on the website were made (see below) |

## The research

The statistics on the website come from our own analysis of 7,070 public Reddit and Hacker News
posts and comments (January 2025 to October 2026), each labelled by a language model, plus the
Stack Overflow Developer Survey 2025 and an Anthropic randomized study. `research/REPORT.md` has the
method and results, and the scripts re-run it. The scraped posts themselves aren't in this
repository, since they're other people's writing; the scripts fetch them again from the public
archives.

## License

MIT. Fonts: Instrument Sans, Instrument Serif, JetBrains Mono and Caveat, under the SIL Open Font
License (`public/fonts/OFL.txt`).

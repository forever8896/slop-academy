# How software interviews look in 2025–26, and what Slop Academy should train

Generated 2026-10-31. Re-run: `scrape.py` → `scrape_threads.py` → `classify.mjs` → `deep.mjs` → `analyze.py`, `analyze_deep.py` → `themes.mjs questions|signals`.

## Data

| | |
|---|---|
| Posts collected | 4,012 (Jan 2025 – Oct 2026) |
| Sources | Reddit via the Arctic Shift archive (r/cscareerquestions daily interview threads, leetcode, csMajors, ExperiencedDevs, developersIndia, cscareerquestionsCAD/EU, recruitinghell, programming, webdev); Hacker News comments via Algolia |
| About real interview practice | 2,797 |
| First-hand candidate reports with rounds | 1,078 |
| Interviewer-side posts | 776 |
| Concrete questions extracted | 1,114 (963 non-behavioral, 723 themed) |
| "What separates candidates" statements | 706 |
| Labelling cost | $2.32 total (Haiku labels and extraction, Sonnet for the taxonomies) |

**Caveats.** People post more when an interview goes badly, so the sample skews negative. Hacker News is 59% of the relevant posts and skews senior and opinionated. Arctic Shift doesn't hold every Reddit post. All labels come from Haiku and only a few were spot-checked by hand. Each half-year has only about 270 candidate reports, so differences under about 4 points are noise.

## Findings

### 1. LeetCode-style rounds are still the most common, and haven't declined
Live algorithm rounds appear in 26% of candidate reports, and in 30% for late 2026. They are also 23% of all questions people report being asked. Online assessments add another 11%. This matches Karat and Pragmatic Engineer: Big Tech hasn't dropped algorithm rounds.
**→ Slop Academy should sit alongside LeetCode prep, not compete with it.**

### 2. Take-homes have nearly disappeared
Share of candidate reports that mention a take-home:

| 2025-H1 | 2025-H2 | 2026-H1 | 2026-H2 |
|---|---|---|---|
| 16.8% | 13.3% | 10.9% | **2.4%** |

Interviewers explain why: "LLMs can complete them." Over the same period:
- AI-assisted coding rounds went from 0.7% to 4.0%.
- Interviewers pushing back with "why?" and "what if?" follow-ups went from 6.8% to 9.9%.
- Project deep-dives went from 1.8% to 3.6%.

Companies are moving from "show me code you wrote at home" to "show me you understand code in front of me".

### 3. What interviewers say decides the outcome
Themes from 706 statements about what separates good candidates:

| Theme | Share |
|---|---|
| Narrating your reasoning and thought process | **10.2%** (largest theme apart from complaints about process) |
| Depth on trade-offs and alternatives | 6.2% |
| Depth on your own past projects, ownership and incidents | 5.5% |
| Honesty about gaps, staying calm, accepting hints | 3.8% |
| Debugging and reading existing code | 3.7% |
| Clarifying questions and handling ambiguity | 3.5% |
| Understanding and explaining AI-generated code | 3.5% |
| Using AI tools well | 5.2% |
| **Total for the explain-and-defend skills above** | **≈ 41%** |
| By comparison: LeetCode critique and prep | 6.4% |

Paraphrased examples:
- "Candidates who can explain their thought process are preferred over slightly stronger coders."
- "If they can explain the why and extend it, AI use is fine. If not, reject."
- "Copy-pasters couldn't debug failing tests or explain the architecture."
- "Pushing deeper on real past work: candidates who fall back to surface-level answers fail."

### 4. How candidates fail
Across the 360 reports that give a reason:

| Reason | Share |
|---|---|
| The process itself (ghosting, mismatch) | 29.7% |
| Couldn't solve the problem | 24.7% |
| **Froze or nerves** | **13.1%** |
| **Communication** | **10.8%** |
| **Couldn't explain their reasoning** | **8.3%** |
| Ran out of time | 7.5% |
| Accused of using AI | 3.6% |

Leaving out process failures, **46% of the failures candidates could have prevented are about freezing, communicating, or explaining, not about knowing.**

### 5. Anxiety is common in interview posts (20%), and the skills corpus below shows the AI link
The interview corpus could not test the AI-and-imposter premise, because it was only collected with interview search terms. A second, targeted corpus does test it.

## Part 2: How developers feel about their own skills (added 2026-10-31)

**Corpus.** 3,058 posts and comments from Jan 2025 to Oct 2026:
- 2,898 Hacker News comments, found with searches such as "imposter syndrome AI", "skill atrophy", "forgot how to code", "can't code without" and "dependent on claude";
- 160 Reddit posts so far. The Reddit pass is still running against a slow archive.

736 of these have the author talking about **their own** skills or confidence. Haiku labelled every post ($0.67), and the noticing moments were then grouped into themes ($0.08).

**Read the percentages correctly.** This corpus was found with searches about the topic itself. Its percentages describe people who talk about their skills, not all developers. For figures across all developers, use the published surveys below. The trend over time is the meaningful signal, because the search terms didn't change.

### 2.1 AI went from a minority explanation to the main one
Among developers talking about their own skills, the share who blame AI for what they feel:

| 2025-H1 | 2025-H2 | 2026-H1 | 2026-H2 |
|---|---|---|---|
| 31% | 38% | 56% | **58%** |

The number of such posts also doubled in 2026-H1. In the same period, "my skills are fading" rose from 14.5% to 22.6% of these posts.

### 2.2 The feeling is real, but people mostly don't call it "imposter syndrome"
Among the 356 posts that blame AI:
- **dependence: 33%**
- **skills fading: 30%**
- imposter or fraud: only 10%
- fear of interviews: 1%

The stance is mostly worried (48%) or distressed (9%). 27% say AI helps them.

People describe the same feeling in other words: *rusty, fading, can't do it without the tool, shipping code I don't understand, outsourcing my thinking*. **The landing page should use their words.** "You shipped it. Can you still do it without the tool?" will land better than "imposter syndrome".

### 2.3 Seniors, not only juniors
57 of the 76 posts with a known level come from senior engineers. Hacker News skews senior, but this is still notable: experienced people are noticing the loss in themselves. For example, a four-decade engineer says supervising AI feels like managing a team.

### 2.4 The moments people notice it
The 349 described triggers, grouped into themes:

| Theme | Share |
|---|---|
| **Shipping or owning code they don't understand** | 8.9% (e.g. "debugging feels harder when they didn't write it", "a vibe-coded wallet bug: unsure if funds are lost") |
| Hand-coding ability fading | 8.0% |
| Reflexively offloading thinking ("kept re-prompting until it worked") | 7.7% |
| Fear that hard-won skills are becoming obsolete | 6.6% |
| A concrete moment of being unable to work without the tool | 5.2% |
| Explicit imposter or fraud feeling from AI use | 4.9% |
| Lost joy, pride and ownership | 3.2% |
| Counter-signal: AI enabled things they couldn't do before | 9.5% |
| Counter-signal: AI sharpened their learning | 4.0% |

### 2.5 What they say they want
| Want | Mentions |
|---|---|
| Practice without AI | 89 |
| **Understand their own code** | **67** |
| Fundamentals | 40 |
| Interview prep | 9 |

"Understand my own code" is Slop Academy's pitch almost word for word, and people raise it without being asked.

### 2.6 Published evidence
- **Stack Overflow 2025** (n≈31k answered): 20% say "I've become less confident in my own problem-solving" because of AI, and 16% say it's hard to understand how or why AI code works. On the other side, 63% say AI agents sped up their learning. https://survey.stackoverflow.co/2025/ai
- **Anthropic RCT, Jan 2026** (n=52):
  - The AI group scored 50% on a no-AI quiz vs 67% for the hand-coding group. The biggest gap was on debugging questions.
  - People who handed the work to AI scored 24–39%. People who used AI to understand the code scored 65–86%. That is Slop Academy's method, measured.
  - https://www.anthropic.com/research/AI-assistance-coding-skills
- **METR RCT, 2025:**
  - Developers were 19% slower with AI but believed they were 20% faster.
  - The 2026 follow-up found developers reluctant to work without AI, and 30–50% held back tasks they didn't want to do without it.
  - https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/ and https://metr.org/blog/2026-02-24-uplift-update/
- **Imposter prevalence before AI:** 52.7% of 624 software engineers (2023 data). https://arxiv.org/abs/2312.03966
- **FSE 2026:** developers describe "guilt or self-doubt about relying on AI". This is qualitative and is the only peer-reviewed study that names it. https://arxiv.org/abs/2604.16393
- **Karpathy, Jan 2026:** "I am slowly starting to atrophy my ability to write code manually." 404 Media: "Software developers say AI is rotting their brains" (May 2026).
- **Don't cite** the claim that "30% of daily AI users report imposter syndrome". It traces back to a Stack Overflow blog post that contains no such number.

### 2.7 Verdict
**Strong evidence:**
- skills fading and less understanding under passive AI use (Anthropic, Prather);
- the share of skill self-talk that blames AI nearly doubled in 18 months;
- developers spontaneously ask to understand their own code.

**Moderate evidence:** confidence loss across all developers (20% in Stack Overflow 2025).

**Not yet measured:** AI-caused imposter syndrome as a clinical construct. Slop Academy could measure it, with confidence before and after each session, and own that data.

## Part 3: Systems thinking over syntax (shipped in the generator, 2026-10-31)
The interview data agrees with the founder:
- interviewers reward trade-offs, failure handling and follow-ups on shifting constraints;
- the "adaptive design" and "why not X" themes are where candidates fail;
- syntax and trivia questions are about 1% of rounds.

What changed in the product:
- **Lenses.** Every generated question now carries a lens: purpose, failure, scale, trade-off, data flow, changing requirements, operations, or honesty.
- **Validator rule.** A session is rejected unless its 3 grill questions use 3 different lenses, at least 2 of them from the systems set.
- **No syntax questions.** API, keyword and syntax questions are forbidden.
- **Curveballs.** The grader's follow-up shifts a constraint when you answer well: "Now the RPC is ten blocks behind."
- **Player.** The player shows the lens above each question.
- **Test.** The rules were tested on `crovia-collection-nfts.ts` (session `allstake-crovia-systems`, $0.30). It produced failure, trade-off and scale questions tied to the real caps and the real 999-token supply.

### 6. New formats to prepare for
- **Interviews run by an AI**, such as recorded screens scored by AI: about 2% of reports, appearing since 2025-H2.
- **AI-assisted rounds inside a repo**: for example "normal problem plus an AI-assistant task inside a repo environment" (the Meta and Canva format).
- **Unfamiliar-codebase rounds**: "add an endpoint to a legacy REST skeleton", "which part of the codebase does what?"
- **Interviewer pressure on cheating**: 13% of all relevant posts mention cheating or anti-cheating measures. Candidates are sometimes falsely accused (3.6% of failures).

## What this means for the product

1. **Positioning:** "LeetCode gets you to a solution. Slop Academy gets you through the follow-up questions." The weak spot the data shows is explaining, not solving.
2. **Add a "narrate" mode.** The candidate talks while solving or rebuilding, and the grader scores reasoning out loud, not only the final answer. This is the top interviewer signal.
3. **Add timed, spoken pressure.** The Grill step should run on a clock, with voice and with no retyping. Freezing is a skill you can practice away.
4. **Simulate an AI-assisted round on the user's own repo:** fix a bug, extend a feature with AI, optimize, then defend the AI's code. This is the format that is growing, and no LeetCode clone can run it on your code.
5. **Add an "explain your LeetCode solution" grill** (complexity, "why not X", walk through an example). It's cheap to add and puts the product inside the habit people already have.
6. **Teams and B2B:** interviewers want real understanding and hate cheating, so the "Defended" credential or an interviewer-side deep-dive tool has a clear buyer.
7. **Tell two stories on the landing page.**
   - **The feeling** (Part 2), in developers' own words: "rusty", "can't do it without the tool", "shipping code I don't understand".
   - **The interview** (Part 1): take-homes are dead, follow-ups decide offers, and nearly half of preventable failures are freezing or not explaining.

   The feeling is why people show up. The interview is why they pay.

## Published sources (from desk research)
- **Karat, Jan 2026:**
  - Live technical rounds at 79% of US companies, take-homes at 45%.
  - 62% of organisations ban AI.
  - 71% of leaders say AI makes skills harder to assess.
  - https://karat.com/engineering-interview-trends-2026
- **CoderPad, State of Tech Hiring 2026:** assessments up 48% since 2023, with emerging formats such as debugging AI code and explaining trade-offs. https://coderpad.io/blog/hiring-developers/new-research-the-2026-state-of-tech-hiring-what-ai-means-for-developers-and-hiring-teams/
- **Meta's AI-enabled round:** debug, then build with AI, then optimize; scored on verification and explanation. https://hellointerview.com/blog/meta-ai-enabled-coding
- **Canva:** scores whether candidates can "identify and fix issues in AI-generated code". https://canva.dev/blog/engineering/yes-you-can-use-ai-in-our-interviews
- **interviewing.io / Pragmatic Engineer, Sep 2025:**
  - 81% of Big Tech interviewers suspect AI cheating.
  - 58% changed their questions toward follow-ups.
  - https://newsletter.pragmaticengineer.com/p/the-pulse-146
- **Junior market:**
  - Stanford "Canaries" study: employment for developers aged 22–25 fell about 20% from its peak. https://digitaleconomy.stanford.edu/news/canaries-interest-rates-and-timinga-more-on-recent-drivers-of-employment-changes-for-young-workers
  - SignalFire: new-grad hiring at Big Tech is about 65% below 2019. https://cssh.northeastern.edu/big-tech-quietly-stopped-hiring-junior-coders-and-the-data-proves-it/
- **Policies:**
  - Amazon bans AI in interviews.
  - Google is bringing back in-person rounds.
  - Anthropic allows AI only when the instructions say so.
  - https://fortune.com/2025/07/21/billion-dollar-giant-anthropic-ai-ban-hiring-policy-change-job-seekers-interview-process

## Files
- `raw/posts.jsonl`: scraped text. Keep it private: it's the authors' text, used only for analysis.
- `raw/labels.jsonl`, `raw/deep.jsonl`: per-post labels.
- `findings.json`, `deep_findings.json`, `themes_questions.json`, `themes_signals.json`: aggregates.
- `questions.txt`, `signals.txt`: the extracted question bank and interviewer statements.

# BIGKAS

### Bridging Inclusive Gaps in Knowledge Access and Speech

An AI-powered assistive document formatting tool that turns physical printed
pages — textbooks, worksheets, board notes — into calm, accessible reading
workspaces built for students with **Dyslexia**, **Autism (ASD)**, and
**ESL/Tagalog learners**.

**Live demo:** https://auraread-ai.vercel.app
**Source:** https://github.com/janil231/auraread-ai

> The app UI is currently branded **AuraRead AI** (the repository's original
> working name). BIGKAS is the project name; the in-app string is not yet
> renamed.

---

## The problem we solve

Filipino classrooms still run on physical printed material. Students with
dyslexia struggle with dense typography and visual stress. Autistic students
hit sensory overload from bright colour and figurative language. Teachers have no
time to hand-rebuild an accessible version of every handout. Parents who speak
Tagalog cannot help with English homework.

BIGKAS targets five challenges at once:

- **Inclusive education** — supports Dyslexia and Autism comorbidity
- **Teacher workload** — one scan instead of manual reformatting
- **Parent–school communication** — instant Tagalog
- **Digital literacy** — physical becomes interactive digital
- **Personalised learning** — display chosen per reader, not per class

---

## Features

### 1. Physical-to-digital conversion

- Live camera capture, or upload PNG / JPEG / WebP
- Vision OCR via Google Gemini, with a **three-model fallback chain** so a
  single model outage or rate limit does not break the app
- Detects the "model could not read this page" case and says so plainly instead
  of passing off placeholder text as the real document
- **Load Sample Page** failsafe — the demo never dead-ends
- Images are held in memory and revoked on unload. Nothing is stored.

### 2. Reading profiles (single-select)

Exactly one profile is applied at a time. The profiles genuinely conflict —
one wants wide loose lines, the other a flat calm surface — so they are a radio
group, not a set of independent switches.

| Profile | What it activates |
|---|---|
| **Dyslexia** | Lexend typeface, wide letter-spacing, loose line height, and the reading ruler |
| **Autism / ASD** | Zen Sensory Focus (one flat earth-tone surface, `#E7E1D6` / `#3F382E` / `#D2C9B8`), Literal Language mode, reduced visual stimulation |
| **Default** | Neither profile — plain reader |

Selecting Autism also takes back the ruler, since the line-tracking band is
part of the Dyslexia package. The profiles are also **mutually overriding** at
render time: the Autism surface replaces the page tint so the two can never
fight for the same pixels.

### 3. Reading workspace

- Four sensory page tints — Default (light slate), Warm Cream, Pastel Blue, Soft Yellow
- **Digital reading ruler** — dims every line except the pointer's, to stop line-skipping
- **Colour-coded phonics** — vowels plus the `ng`, `ts`, `sh`, `ch`, `th` digraphs Tagalog leans on
- **Karaoke read aloud** — Web Speech API driven, with word-by-word highlighting
- **Instant English ↔ Tagalog** translation
- **Visual mind map** — AI-generated concept cards in either language
- Copy text, retake photo, and a full-screen view of the original page

### 4. Reading that never jumps

The read-aloud highlight is **paint-only**. Highlighting a word changes its
colour and nothing else — no layout, font, or spacing property is touched — so
the karaoke pass causes zero reflow and the reader never loses their place.
The reading stage is also a fixed-height column with a single internal scroll
area, so opening the controls drawer overlays the text instead of pushing it
down the page.

### 5. Responsible AI

- **No expert AI.** BIGKAS reformats text. It never diagnoses, interprets,
  summarises the material, or advises the reader. The compliance disclaimer
  states this on the landing page, in the reader, in the footer, and in the
  profiles modal.
- **Literal Language is deliberately not AI.** Idioms are matched against a
  fixed 20-entry glossary checked into the source. No model is asked to explain
  a page — a model "explaining" figurative language is exactly the
  interpretation this tool refuses to do.
- **OCR returns text verbatim.** It is not summarised, cleaned up, or improved.

---

## How AI is used

| Capability | Model-generated? |
|---|---|
| Vision OCR (text extraction) | Yes — Gemini vision |
| Visual mind map (structured cards) | Yes — Gemini, JSON-only output |
| English ↔ Tagalog translation | Yes — Gemini |
| Literal Language (idiom restatement) | **No** — fixed glossary |

Every AI output is displayed for a human to accept, change, or discard. Nothing
is written back to a learner's material automatically.

---

## Tech stack

- **Framework** — Next.js 15 (App Router), React 19
- **Language** — TypeScript 5.7, `strict` mode
- **Styling** — Tailwind CSS 3.4
- **Icons** — lucide-react
- **AI** — Google Gemini, called over the REST API (`lib/gemini.ts`) with a
  fallback chain of `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` →
  `gemini-3.5-flash`. Override with `GEMINI_MODEL`.
- **Speech** — browser Web Speech API (`onboundary` karaoke)
- **Fonts** — Lexend via `next/font`, as the global typeface
- **Deployment** — Vercel

There is no component library. The header, drawer, toggles, and profile cards
are hand-rolled to keep the bundle small and the reading surface controllable.

---

## Getting started

```bash
git clone https://github.com/janil231/auraread-ai.git
cd auraread-ai
npm install
cp .env.example .env.local     # add your Gemini key
npm run dev
```

| Script | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |

### Configuration

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Google AI Studio key |
| `GEMINI_MODEL` | No | Pin one model instead of using the fallback chain |

Get a key at https://aistudio.google.com/app/apikey

> **Note on model choice.** Leave `GEMINI_MODEL` unset unless you are
> debugging. Pinning a model that your account cannot reach causes a hard 404,
> and the whole app stops working. The chain is there on purpose.

---

## Architecture

```
app/
  layout.tsx            root layout, compliance banner
  page.tsx              both stages + all UI state (client component)
  globals.css           Lexend, Stage B viewport lock
  api/
    ocr/route.ts        vision OCR + fallback chain
    translate/route.ts  English <-> Tagalog
    mindmap/route.ts    study map generation
lib/
  gemini.ts             Gemini REST client, model fallback, key check
  sample-text.ts        built-in placeholder text
```

The reading stage is driven from CSS rather than JavaScript: the page root
carries `data-stage`, and `body:has([data-stage="B"])` in `globals.css` locks
the document scroll and hides the compliance banner. Those rules sit outside
`@layer utilities` on purpose — Tailwind tree-shakes unused element selectors
inside it.

---

## Privacy

Images are processed in memory and never written to disk. The Gemini API key
lives only in the server-side environment. Every `/api/*` route is public,
however, so the key is reachable by anyone who can call the deployed endpoints —
add rate limiting before treating a public deployment as production-safe.

# FLATPACK

**instructions shouldn't need a language.**
A one-page website (with the working tool embedded) that turns a photo of anything confusing into a wordless IKEA-manual-style visual guide. Numbered panels, one action each, one consistent line-art character, red-X "don't" panels, PDF export, and a "this isn't what I see" button that redraws only the affected steps.

## Setup

```bash
npm install
cp .env.example .env      # put your GEMINI_API_KEY in it
npm run make-character    # optional: the server also does this on first boot
npm start                 # http://localhost:3000
```

Node 20+. No build step.

### Env vars

| var | default | notes |
|---|---|---|
| `GEMINI_API_KEY` | none | required for real output. **Without it the app runs in MOCK MODE** (placeholder panels) so you can test the plumbing |
| `IMAGE_MODEL` | `gemini-3.1-flash-image` | Nano Banana 2. swap models here only (older ones like `gemini-2.5-flash-image` are legacy and 404 for new keys) |
| `VISION_MODEL` | `gemini-3.8-flash` | read / plan / critic |
| `PORT` | `3000` | Railway sets this |
| `IMAGE_ASPECT` | `1:1` | set to empty if your image model rejects `imageConfig` |
| `CALL_TIMEOUT_MS` | `60000` | per model call; one retry on 429/5xx with backoff |
| `GUIDES_PER_HOUR` | `20` | per IP |
| `FLATPACK_MOCK` | | `1` forces mock mode |
| `PUBLIC_URL` | request host | absolute origin used in Open Graph tags |
| `GITHUB_URL` | `https://github.com/MaheshGit31/flatpack` | footer link |

## Structure

```
src/style.js      locked STYLE_PROMPT + CHARACTER_PROMPT
src/character.js  generates assets/character.png once, reuses forever
src/read.js       vision understanding (strict JSON) + fix diagnosis
src/plan.js       4-8 atomic steps, schema validated, one retry
src/draw.js       panel generation: style + character ref + spec + original photo
src/critic.js     QA: claim / stray text / character match; regenerate once
src/pipeline.js   orchestration, concurrency cap 4, SSE events
src/pdf.js        pdf-lib export
src/server.js     express, SSE, rate limit, uploads
public/           the website: index.html + site.css + site.js (vanilla, no framework); share.css/share.js for /g/:id
scripts/          make-character, make-demos, e2e test
data/demos/       stored demo guides (replayed with zero API calls)
data/guides/      user guides (gitignored)
```

## API

`POST /api/guide` (multipart `photo`, `hint`) -> `{id}` · `GET /api/guide/:id/stream` (SSE: status, plan, panel, critic, clarify, done, error) · `POST /api/guide/:id/step/:n/fix` (photo or note, streams replaced panels) · `POST /api/guide/:id/step/:n/retry` · `GET /api/guide/:id/pdf` · `GET /api/guide/:id` · `GET /g/:id` (shareable, printable guide page; `/guide/:id` redirects) · `GET /og/:id.png` (social card) · `GET /api/demos` · `GET /api/health`

## The site

Sections: nav, hero (looping demo panels), how it works, the embedded tool, examples gallery (from `data/demos`), why it matters, how it's built, footer. Shared guides live at `/g/:id` (2-column grid, PDF button, print stylesheet, noindex for user guides).

## Demo mode

Drop `pill-schedule.jpg`, `boxed-gadget.jpg`, `paper-form.jpg` in `demo-inputs/` (see its README), then `npm run make-demos` with a real key. The three "load demo" buttons replay them instantly with no API calls. **The committed demos are mock placeholders until you regenerate them.**

## Test

`npm start` in one terminal, `npm test` in another (works in mock or real mode; asserts SSE order, critic loop, PDF, fix-only-replaces-affected, demo replay, upload validation).

## Deploy on Railway

1. New project from this repo (Nixpacks detects Node, runs `npm start`).
2. Variables: `GEMINI_API_KEY` (required), optionally `IMAGE_MODEL`, `VISION_MODEL`, `GUIDES_PER_HOUR`.
3. Optional: add a Volume mounted at `/app/data/guides` so user guides survive redeploys (demos ship in the repo).
4. Generate a domain. Open `/api/health` to check; `mock:false` means the key is live.

## 60-second demo script

- **0:00** "instructions shouldn't need a language." Hold up a phone, tap **take a photo**, shoot a confusing gadget box.
- **0:10** Numbered skeletons appear, panels pop in one by one. Point out the same character in every panel and the red X warning panel.
- **0:25** Point at the **checked** badges: a second model reviews each panel for the claim, stray text and character match, and redraws failures once.
- **0:35** Tap **this isn't what I see** on a step, add a note or photo: only that step and its dependents redraw, the rest stay untouched.
- **0:50** **Download PDF**, **Share link**. If wifi dies: tap a **demo** button, same experience, zero API calls.

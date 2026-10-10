# Design notes

**Fonts (self-hosted via fontsource, no external requests):** Instrument Serif (display: page titles, big numbers, landing headlines), Geist (UI and body), Geist Mono (timestamps, scores, code-ish labels).

**Type scale (major third, ~1.25):** 13px caption/labels, 15px dashboard body (landing body 17px), 16px lead, 19px section heads, 24px, 30px, 38px page titles, fluid 45-90px landing hero. Body line-height 1.55, headings 1.0-1.2 with slight negative tracking. Weights: 400 body, 500-550 controls, 600 headings. Lines cap near 62-70ch.

**Colour:** warm paper (#F5F3EE) with one accent, deep teal (#0B6B58; #4FD1AE in dark). Recording state is the only red. All text pairs checked by axe in light and dark.

**Structure:** `#/` is the landing page. `#/app/*` is the dashboard (Overview, Record, Search, Timeline, Ask AI, Privacy & data, Benchmark).

**Gemini (optional):** bring your own key, stored in IndexedDB. Only already-redacted frames plus scrubbed OCR text are sent, only after a button press, directly to generativelanguage.googleapis.com. Without a key nothing is ever requested.

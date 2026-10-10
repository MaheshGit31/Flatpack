# Flatpak demo video — 2:50, shot by shot

Record at 1080p in desktop Chrome with demo data loaded and the models already cached (so nothing waits on a download). Keep the Privacy tab's network panel one click away. Voice-over in plain, calm sentences.

| Time | Shot | Voice-over |
|---|---|---|
| 0:00–0:12 | Black. Type in a search box: "the pricing table from tuesday". Cut to a messy desktop of 20 tabs. | "You *know* you saw it. Which tab? Which day? Everything that remembers your screen sends it to someone else's server." |
| 0:12–0:22 | Title card: **Flatpak**. Tagline: *Screen memory. Stays on your device.* Then the Record page. | "Flatpak is Ctrl+F for everything you've looked at. 100% in your browser. No account, no upload, no server." |
| 0:22–0:45 | Click Start recording. Consent modal (hold it a beat). Pick a window. Red REC badge, tab title and favicon turn red. Frame grid fills; counters tick (captured / kept / skipped). | "You choose what to share and consent first. A recording indicator is always on screen. Flatpak samples every few seconds and throws away near-duplicates with a perceptual hash we wrote ourselves, so a static screen costs almost nothing." |
| 0:45–1:10 | Open a page with a fake card number, email and password (the checkout sample). Click into the stored frame in the viewer: it's pixelated. Toggle to the text panel: no digits. | "Before anything is saved, Flatpak OCRs the frame, finds card numbers, emails, phones and secrets, and pixelates them in the stored image. The original is gone, and the CLIP embedding is computed on the *redacted* pixels. A block-list drops a whole frame if, say, a recovery phrase is on screen." |
| 1:10–1:50 | Search tab. Type "red line chart". Results: dashboard first; point at the **visual** chip. Type "route to golden gate park": map; **text** chip and yellow highlight on the matched words. Type "pricing plans": show both chips. | "Search is hybrid. CLIP understands what a screen *looks like*: no text needed to find a red line chart. OCR finds exact words and highlights them. Reciprocal Rank Fusion merges them, and every result tells you which signal found it." |
| 1:50–2:05 | Open the viewer, press → → to step through frames, Esc. Filter by activity "email" and "Last 24 h". | "Open any result, step through the neighbouring frames, and filter by time or by activity, which CLIP labels with zero-shot prompts." |
| 2:05–2:20 | Timeline tab: blocks labelled "coding · invoice, calculateinvoicetotal" etc. Drag the sensitivity slider. | "The timeline groups your day into blocks using time gaps and how far the screen's embedding drifts, then labels each with its activity and its most distinctive words." |
| 2:20–2:35 | Record page, enable voice, mic on. Say a sentence ("let's ship the roadmap on friday"). Stop. Search the sentence with "Has speech" ticked; speech chip. | "Optionally, Whisper tiny transcribes your voice locally. Audio is never stored, only scrubbed text, and it's aligned to the frames you were looking at." |
| 2:35–2:50 | Privacy tab: network audit shows **0 requests since models loaded**. Cut to Benchmark tab: bar chart (fused vs CLIP vs OCR), recall@5 100%, MRR 0.94. End card: Flatpak, the URL. | "Models download once, then it makes zero network requests, and there's a panel and a test that prove it. On a 48-query benchmark, fusion beats either signal alone. It's small and synthetic, so run it on your own screens. Flatpak: screen memory that stays on your device." |

## Shot checklist

- Models cached beforehand; demo data loaded; browser zoom 110% for legibility.
- Have the checkout sample ready as a window to share (use `samples/checkout.png` in an image viewer).
- Say the benchmark caveat out loud; it is in the voice-over on purpose.
- Keep captions on for the on-screen chips ("visual", "text", "speech").

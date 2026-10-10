# Flatpak

**Screen memory. Stays on your device.**
Ctrl+F for everything you've looked at. Search what you saw and heard, 100% in your browser: no account, no upload, no server.

Built for Banana Hacks 2026. It is a static site: the app, the OCR engine, the ONNX runtime and your data all live in the browser. After the AI models are downloaded once, it makes no network requests at all.

## What it does

1. **Record** a screen, window or tab (and optionally your microphone or tab audio). Frames are sampled about every 3 seconds, near-duplicates are dropped, and each kept frame goes through OCR, redaction, a CLIP embedding and a zero-shot activity label, then into IndexedDB.
2. **Search** with plain words. Results fuse a visual signal (CLIP image-text similarity) with a text signal (BM25 over OCR, with prefix and typo tolerance) and, if you used voice, a speech signal, using Reciprocal Rank Fusion (k = 60). Every result shows which signal found it and where the matching words sit on the screenshot.
3. **Timeline** groups your day into labelled blocks (time gaps plus CLIP embedding drift).
4. **Privacy** shows what happens to a frame, lets you tune capture, edit the block-list, expire or delete data, and audit network requests.
5. **Benchmark** runs ~48 labelled queries on this device and reports recall@1, recall@5 and MRR for CLIP-only, OCR-only and fused search.

Click **Load demo data** on the Record tab to try everything without recording (3 pre-indexed sessions of synthetic, public-safe screens).

## Privacy model

- Nothing is uploaded and there is no backend. The only third-party request is the one-time model download from the Hugging Face CDN; everything else (ONNX runtime wasm, Tesseract worker/core/language data) is served from this site's own origin.
- Pipeline order is **dedupe → OCR → redact → CLIP → store**. The original pixels are overwritten in memory before CLIP sees them and before anything is written. Originals are never persisted.
- Redaction covers Luhn-valid card numbers, emails (including ones OCR splits around the @), phone numbers, US SSNs, common API-key/token shapes, and the value next to labels such as password / token / secret / API key / CVC / PIN. Hits are pixelated in the stored image and replaced in the stored OCR text.
- A user-editable block-list drops the **entire frame** when a phrase is on screen (defaults: private key, seed phrase, recovery phrase, one-time password, otp code).
- A recording indicator is always visible (page badge, tab title and favicon, optional Picture-in-Picture mini recorder). Pause/resume with Alt+Shift+P. Consent modals appear before screen and before voice recording.
- Voice: audio is processed in memory and **never stored**; only scrubbed transcript text is kept.
- Auto-expiry (default 7 days), per-session delete, delete-everything, and delete-everything-plus-cached-models.
- The Privacy tab has a network audit. It sees the page and the indexing worker; the Playwright test (`e2e/offline.spec.ts`) checks every thread at the network level.

**Limits, stated plainly:** redaction depends on OCR, so text OCR misses (handwriting, tiny or stylised text, text inside images) is not blurred. The patterns are US-centric and do not detect names or addresses. Treat it as a strong safety net, not a guarantee, and share a single window when you can.

## Browser support

Desktop **Chrome or Edge** is the supported target (screen capture, `MediaStreamTrackProcessor`, `OffscreenCanvas`, workers, Document Picture-in-Picture). Other browsers get a clear "can't run Flatpak" message, with the demo still reachable. A video-element fallback sampler exists for browsers without `MediaStreamTrackProcessor`; it is only tested in Chromium.

## Run it

```bash
npm install          # .npmrc sets ignore-scripts=true (onnxruntime-node's postinstall is not needed)
npm run dev          # http://localhost:5173
npm run build && npm start   # production build served with vite preview
```

`predev`/`prebuild` copy the self-hosted runtime assets (ONNX runtime wasm, Tesseract worker and cores, and the English language data if missing) into `public/`.

### Tests

```bash
npm test                                   # 37 unit tests (dHash, Luhn, redaction, RRF, BM25, clock, chunker, blocks, engine)
CHROME_PATH=/path/to/chrome npm run test:e2e   # 15 Playwright tests (needs network for the first model download)
npm run build:demo                         # regenerate public/demo with the real pipeline (needs a running preview on :4173)
```

The e2e suite drives the real app in Chromium with `--use-fake-ui-for-media-stream`, a fake microphone fed from a speech clip, and a canvas stream standing in for the screen (see "What was and wasn't verified").

## Model and asset sizes

| Asset | Size | Where it comes from |
|---|---|---|
| CLIP ViT-B/32 vision, q8 | 89.1 MB | Hugging Face CDN, once, then Cache Storage |
| CLIP ViT-B/32 text, q8 | 64.5 MB | same |
| CLIP tokenizer + config | 2.2 MB | same |
| Whisper tiny.en, q8 (voice only) | ~43.5 MB | same, only if voice is enabled |
| ONNX runtime wasm (4 variants shipped, 1 used) | 83 MB on disk, ~27 MB fetched | this site |
| Tesseract worker + cores + English data | ~15 MB on disk, ~6 MB fetched | this site |

Total first-run download: about 155 MB (about 200 MB with voice).

## Architecture

```
src/capture   getDisplayMedia, session recorder, capture worker (MediaStreamTrackProcessor → sample → dHash dedupe), fallback sampler, importer
src/workers   index.worker (OCR → redact → CLIP → label → WebP → IDB), search.worker, audio.worker (VAD → Whisper), typed RPC clients
src/models    CLIP (transformers.js), Tesseract.js, progress aggregation
src/privacy   redaction (Luhn, regexes, label rules, block-list), network audit
src/search    BM25 (prefix + typo), RRF, brute-force cosine, engine
src/store     IndexedDB (idb), demo import
src/timeline  block segmentation and labelling
src/audio     energy VAD + chunker, AudioWorklet tap
src/eval      labelled queries, metrics, benchmark runner
src/ui        Record, Search, Timeline, Privacy, Benchmark
```

Notable details: the screen track is read on a worker via a `MediaStreamTrackProcessor` created on the main thread and its `readable` transferred (tracks are not transferable in stable Chrome); the dHash (9×8 box-resized grayscale, 64-bit) and a coarse 32×18 change grid are implemented from scratch; ONNX runtime runs single-threaded wasm (`numThreads = 1`) so no `SharedArrayBuffer` or cross-origin isolation is needed; WebGPU is tried first when an adapter exists and falls back to wasm.

## Benchmark results

Run in headless Chromium (wasm, single thread) on a cloud VM, over the 14 stored demo frames and 48 labelled queries (33 text, 13 visual, 2 mixed). Full output: `docs/benchmark-demo.json`. Re-run it yourself on the Benchmark tab.

| Signal | Recall@1 | Recall@5 | MRR |
|---|---|---|---|
| CLIP only | 40% | 75% | 0.560 |
| OCR only | 71% | 71% | 0.708 |
| **Fused (RRF, k = 60)** | **90%** | **100%** | **0.943** |

By query type, recall@5: text queries CLIP 67% / OCR 100% / fused 100%; visual queries CLIP 100% / OCR 0% / fused 100%. The two signals fail on different queries, which is why fusion helps.

Pipeline: median 0.67 s to index a frame (OCR + redact + CLIP + encode), median search about 26 ms including the query embedding, 24 MB per hour if every 3-second frame were kept (before dedupe), zero-shot activity labels right on 12 of 14 frames (86%), 0 network requests after load. Model load took 8 to 13 s here, including the network download.

**Read these numbers with care:** the corpus is 14 synthetic screens and I wrote the queries, so absolute values are optimistic and a bigger, messier corpus will score lower. The relative result (fused beats either signal) is the useful part.

## What was and wasn't verified

Verified by automated tests: the capture worker path (processor and fallback), dedupe, session clock, OCR + CLIP indexing, hybrid search, visible redaction (card, email, phone, password, CVC pixels changed; untouched text unchanged; digits absent from stored text), block-list frame drop, timeline blocks, benchmark export, voice (fake mic fed a speech clip → transcript → speech-signal search aligned to frames), permission denied, user stopping the share, index worker crash recovery, reload mid-recording, unsupported-browser message, zero external requests after models are cached, and no serious axe-core violations on any tab in light and dark.

Not verified: capturing a real desktop (headless Chromium has no screen, so a canvas stream stands in; Xvfb capture failed to start the video source), the WebGPU path (no GPU available, wasm only), Firefox and Safari, the Picture-in-Picture mini recorder (needs a real window), storage-quota eviction under real pressure, and running two recording tabs at once.

## Known limitations

- English only for OCR and speech. Whisper tiny.en is fast but makes mistakes.
- Zero-shot labels are coarse; the timeline labels are only as good as CLIP and OCR.
- Redaction misses anything OCR misses (see Privacy model).
- First load downloads about 155 MB and needs a modern machine; indexing is single-threaded wasm.
- Clearing site data deletes your memory and the cached models.

## Deploy

Static site. Any static host works (`dist/` after `npm run build`). On Railway: build `npm run build`, start `npm start`. The app needs no environment variables.

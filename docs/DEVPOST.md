# Flatpak — Devpost submission

**Tagline:** Screen memory. Stays on your device.

**Pitch:** Ctrl+F for everything you've looked at. Search what you saw and heard, 100% in your browser: no account, no upload, no server.

## Inspiration

Everyone has lost something they *know* they saw: the pricing table from last Tuesday, the stack trace before the fix, the line someone said on a call. Tools that promise to remember your screen ship it to a server. We wanted the opposite: a memory you can search, that physically cannot leave your machine because there is no server to send it to.

## What it does

Flatpak records a screen (and optionally your voice) in the browser and lets you search it in plain words. Each kept frame is OCR'd, scrubbed of sensitive data, embedded with CLIP and labelled by activity, then stored in IndexedDB. Search fuses what the screen *looks like* (CLIP) with what it *says* (BM25 over OCR, plus speech) using Reciprocal Rank Fusion, and shows which signal found each result and where the matching words are on the screenshot. A timeline groups your day into labelled blocks. A privacy tab shows exactly what happens to a frame and audits the network. A benchmark tab measures retrieval quality on your own device.

## Image AI is the core

- **CLIP ViT-B/32 (q8)** runs in a Web Worker for every kept frame, and again for every query, so searches like "red line chart" or "map with a blue route" work without any text on screen.
- **OCR** (Tesseract.js, self-hosted) gives word boxes, which power the highlight overlay and the redaction.
- **Zero-shot activity labels** (coding, video, documents, slides, chat, shopping, social, maps, email, other) come from CLIP text prompts, with no training.
- **Redaction happens on the pixels**: sensitive boxes are pixelated *before* CLIP and storage, so even the embedding never sees them.

## How we built it

TypeScript (strict), Vite, React, plain CSS. Everything heavy runs in workers: a capture worker (MediaStreamTrackProcessor → sample → self-implemented 64-bit dHash plus a change grid for dedupe), an index worker (OCR → redact → CLIP → label → WebP → IndexedDB), a search worker (typed-array cosine matrix + BM25 with prefix and typo tolerance + RRF), and an optional audio worker (energy VAD → Whisper tiny.en, text only). ONNX Runtime Web runs single-threaded wasm so it needs no cross-origin isolation, with WebGPU tried first when available. Models download once from the Hugging Face CDN; every other asset is served from the site itself, and an automated test checks that nothing else is requested.

## Challenges

- **Transferring the screen track.** Our first design sent the `MediaStreamTrack` to a worker; stable Chrome can't transfer tracks. The e2e test caught that we were silently on the fallback path. The fix is to create the `MediaStreamTrackProcessor` on the main thread and transfer its `readable` stream.
- **OCR defaults.** Tesseract.js v7 defaulted to a single-block mode that read a whole screen as one paragraph and dropped most of it. Switching to automatic layout analysis fixed frames that came back with almost no text (the spreadsheet screen was read as just "EE") and took OCR-only recall@5 on text queries from 91% to 100%.
- **Proving redaction.** We compare stored pixels with the source to assert that the card, email, phone, password and CVC regions changed and untouched text didn't, and that the digits are absent from the stored text.
- **A bug we shipped to ourselves.** Demo vector offsets counted floats instead of rows, which made visual search look 2× worse than it is until the benchmark exposed it.

## Accomplishments

- A fully local pipeline with a measurable result: on our 48-query demo benchmark, fused search reaches recall@5 of 100% and MRR of 0.943, versus 75% / 0.560 for CLIP alone and 71% / 0.708 for OCR alone.
- Zero network requests after the models are cached, verified at the browser's network level.
- 37 unit tests and 15 end-to-end tests, including a fake microphone fed a speech clip and axe-core accessibility checks in light and dark.

## What we learned

Fusion matters more than model size here: CLIP is great at "what does this look like" and weak at reading, OCR is the reverse, and RRF needs no tuning to get the best of both. Privacy claims are only worth making if a test can fail them.

## What's next

Real-corpus evaluation (the benchmark here is 14 synthetic screens and optimistic), tiled CLIP embeddings for finer visual matches (a quick experiment lifted visual recall@1 from 55% to 80 to 90%), WebGPU testing on real hardware, more languages, and encrypted-at-rest storage.

## Honest limitations

Redaction depends on OCR. English only. We could not test capture of a real desktop or the WebGPU path in our environment (details in the README).

## Built with

TypeScript, React, Vite, @huggingface/transformers (CLIP ViT-B/32 q8, Whisper tiny.en q8), onnxruntime-web, Tesseract.js, idb, IndexedDB, Web Workers, MediaStreamTrackProcessor, AudioWorklet, Playwright, Vitest, axe-core.

# Flatpak — Devpost submission

**Tagline:** Private screen memory that works offline in your browser.

**Pitch:** Ctrl+F for everything you've looked at. Cache it once, switch your wifi off, and it still finds the red line chart from last Tuesday. No account, no upload, no server.

## Technical pipeline

Every kept frame goes through one on-device pipeline: **capture** (MediaStreamTrackProcessor in a worker, ~3 s sampling, self-written 64-bit dHash plus change grid to drop near-duplicates) → **OCR** (Tesseract.js, self-hosted, word boxes) → **redact on the pixels** (cards, emails, phones, secrets pixelated before anything else sees them; block-list drops whole frames) → **CLIP ViT-B/32 image embedding** (q8, ONNX Runtime Web, WebGPU if present else wasm) → **trainable classifier head** (activity label) → **IndexedDB**. Search embeds the query with CLIP's text tower, ranks frames by cosine similarity, fuses that with BM25 over OCR via Reciprocal Rank Fusion, and shows which signal found each hit. Everything heavy runs in Web Workers. A **service worker** caches the app shell and Cache Storage holds the models, so the whole thing runs with the network off.

## What's new

1. **A classifier you train yourself, on your own screen.** The activity label is not a fixed zero-shot guess. It is a multinomial logistic-regression head over CLIP image embeddings, initialised from CLIP's zero-shot text weights. Correct a block on the Timeline and the head retrains in a worker, in the browser, in about a second, and the weights persist in IndexedDB. Nothing leaves the device.
2. **Provable offline.** An Airplane mode page caches the app, OCR files and models, then runs search and classification with the network off. The top bar shows a live "Network: offline, still working" chip. An end-to-end test cuts the browser's network, cold-reloads, and searches.
3. **Redaction on pixels, before the embedding.** Even the CLIP vector never sees the card number.

## How image AI is the core

- **CLIP is the search engine.** Query-to-screenshot similarity finds "map with a blue route" or "red line chart" with no text on screen. On our benchmark CLIP alone gets recall@5 of 75% and finds what OCR cannot (visual queries: CLIP 100%, OCR 0%).
- **CLIP embeddings are the training data.** The trainable head, the Timeline segmentation (embedding drift) and the activity filter all run on the same image embeddings.
- **Pixels, not just text.** Redaction edits the image itself, then CLIP embeds the redacted pixels.
- OCR gives exact words and highlight boxes. Fusion beats either signal alone (below).

### Measured results (honest)

All numbers come from running the app's own benchmark in headless Chromium (wasm, single thread). Files: `docs/benchmark-demo.json`, `docs/head-benchmark.json`.

| Retrieval (48 queries, 14 synthetic screens) | Recall@1 | Recall@5 | MRR |
|---|---|---|---|
| CLIP only | 40% | 75% | 0.560 |
| OCR only | 71% | 71% | 0.708 |
| Fused (RRF) | 90% | 100% | 0.943 |

| Activity label on a held-out 40% of 70 labelled frames (8 random splits) | Zero-shot | Trained head |
|---|---|---|
| Same apps come back (random split) | 70.1% | **81.3%** |
| Whole apps never seen in training | **72.1%** | 62.9% |

Learning curve, same apps: 70% with 0 corrections, 73% with 4, 74% with 8, 76% with 16, 85% with 32. Whole-new-apps curve goes the other way (72% down to 55%), because a head fitted to a few apps over-fits to them.

**Caveats we want you to read:** the 70 frames are synthetic (14 apps x 5 looks), the head's hyperparameters were tuned while looking at this set so the gain is optimistic, and 8 splits of 28 frames is noisy (per-split range 64% to 93%). The honest takeaway: correcting labels helps for the apps you actually use, and it can hurt on an app you have never corrected. The Benchmark page lets you run the same test on your own corrected frames.

## Who it helps

People who can't or won't send their screen to a cloud: engineers under NDA, clinicians and lawyers, journalists, students on bad wifi, anyone on a plane. People with ADHD or heavy tab load who "know they saw it". And anyone who wants a memory that *physically cannot* leave their machine because there is no server.

## Demo

Open the site, press **Try it with demo data**, search "red line chart". Then open **Airplane mode**, press *Prepare for offline*, switch your wifi off (or press the simulate button), reload, and search again. Then open the Timeline, change one block's activity, and watch the head retrain. Video script: `docs/VIDEO_SCRIPT.md`.

## Challenges

- Chrome can't transfer a `MediaStreamTrack` to a worker; the e2e test caught that we were silently on the fallback sampler. We create the processor on the main thread and transfer its readable stream.
- Tesseract.js v7 defaulted to a single-block mode that dropped most of a screen's text; automatic layout took OCR recall@5 from 91% to 100%.
- Training a head on ~50 embeddings collapsed at first (held-out accuracy below 20%). Feature centering, plain gradient descent from the zero-shot weights, zero-shot soft anchors for uncorrected frames, and frozen weights for never-corrected classes fixed it.
- `ignore-scripts` skipped our asset-copy hook on the host, so the deploy was missing the wasm files until we called the script from `build`.

## What's next

A real-corpus evaluation (ours is synthetic), a better answer to the new-apps regression (stronger regularisation toward zero-shot, or per-class confidence gating), tiled CLIP embeddings, WebGPU testing on real hardware, and encrypted-at-rest storage.

## Honest limitations

Redaction depends on OCR. English only. Desktop Chrome/Edge. First run downloads about 155 MB. We could not test capture of a real desktop or the WebGPU path in our environment. The optional Gemini analysis (bring your own key) needs the internet and is off by default. A voice experiment exists behind a hidden flag and is not part of the product.

## Built with

TypeScript, React, Vite, @huggingface/transformers (CLIP ViT-B/32 q8), onnxruntime-web, Tesseract.js, idb, IndexedDB, Service Worker, Cache Storage, Web Workers, MediaStreamTrackProcessor, Playwright, Vitest, axe-core.

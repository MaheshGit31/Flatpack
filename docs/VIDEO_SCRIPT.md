# Flatpak demo video — 2:45, shot by shot

Hook: the opening is the offline proof. Record at 1080p in desktop Chrome. Before filming: open the site once, go to **Airplane mode**, press *Prepare for offline*, load demo data, and reload so the service worker controls the page.

| Time | Shot | Voice-over |
|---|---|---|
| 0:00–0:20 | Full screen: the OS wifi menu. Click **Airplane mode ON**. Wifi icon crosses out. Open Flatpak (already cached). Top bar reads **Network: offline, still working**. | "Wifi is off. Airplane mode. And this app still opens." |
| 0:20–0:40 | Search page, offline. Type "red line chart". Dashboard result first, chip says *visual*. Type "route to golden gate park": map, *text* chip, yellow highlight. | "This is Flatpak: private screen memory that works offline in your browser. It just found a chart by what it *looks like*, using CLIP, on this laptop, with no network." |
| 0:40–1:00 | Airplane mode page. Show the readiness checklist all green (service worker, app shell, models). Click **Search offline**: "network was off". | "A service worker caches the app and Cache Storage holds the models. First visit downloads them once; after that there's nothing left to fetch." |
| 1:00–1:25 | Record page, consent modal, pick a window. REC badge. Frame grid fills. | "You consent first, a recording indicator is always on, and near-duplicate frames are thrown away with a perceptual hash we wrote ourselves." |
| 1:25–1:45 | Checkout sample in the viewer: pixelated. Text panel: no digits. | "Before anything is saved, card numbers, emails and passwords are pixelated *in the image*, and CLIP only ever sees the redacted pixels." |
| 1:45–2:15 | Timeline. Show blocks with activity labels. One block is wrong. Change its dropdown. "Training…" then "trained on N frames". Labels update. | "The activity label is a classifier you train. It starts from CLIP's zero-shot guess. Fix a block and it retrains on-device in about a second, on CLIP's image embeddings, and saves the weights in your browser." |
| 2:15–2:35 | Benchmark page. Retrieval chart (fused 100% R@5). Then the head table: recurring apps 70% to 81%, new apps 72% to 63%. | "We measured it. Fusion beats either signal alone. Training helps for apps you correct, and it gets *worse* on apps it has never seen: 63 versus 72. It's synthetic and tuned on, so treat the gain as optimistic." |
| 2:35–2:45 | Top bar chip again. End card: Flatpak, URL. | "Screen memory that stays on your device, even when the device is offline." |

## Checklist

- Real OS airplane mode if possible; the in-app *Airplane mode (simulate)* button is the fallback and is labelled as simulated.
- Say the new-apps regression out loud; it is in the voice-over on purpose.
- No audio feature is shown anywhere. The voice experiment is hidden behind `?exp=audio`.

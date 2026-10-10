# demo inputs

Drop three photos here, then run `npm run make-demos` (needs `GEMINI_API_KEY`):

| file | what to photograph |
|---|---|
| `pill-schedule.jpg` | a weekly pill organizer or a printed medication schedule |
| `boxed-gadget.jpg`  | a gadget still in its box (router, smart plug, kettle) |
| `paper-form.jpg`    | a confusing paper form (tax, visa, school) |

Tips: good light, object fills the frame, under 8MB (resized to 1600px anyway).
Demos are written to `data/demos/<name>/` and replay with no API calls.
Without an API key the script writes placeholder (mock) demos instead, so re-run it with a key before judging.

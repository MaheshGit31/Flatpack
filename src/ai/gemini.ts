/// Optional, opt-in Gemini analysis. This is the ONLY code in Flatpak that talks to a third party after models load.
/// - The key lives in this browser's IndexedDB and is sent only to generativelanguage.googleapis.com, as a header.
/// - Only already-redacted frames (the stored pixelated WebP) and scrubbed OCR text are ever sent.
/// - Nothing is sent unless the user presses an Analyze / Ask button. There is no background use.
import { getBlobs, getFrame, getKv, getOcr, setKv } from '../store/db';
import { fmtWall } from '../util/format';

export const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com';
export const DEFAULT_MODEL = 'gemini-2.5-flash';
export const MODEL_CHOICES = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'];
const MAX_IMAGES = 6;

export interface GeminiConfig { key: string; model: string; consentAt: number | null }
export interface GeminiUsage { calls: number; images: number; chars: number; lastAt: number | null }
export interface FrameAnalysis { title: string; summary: string; details: string[]; tags: string[]; model: string; at: number }

const EMPTY: GeminiConfig = { key: '', model: DEFAULT_MODEL, consentAt: null };
const EMPTY_USAGE: GeminiUsage = { calls: 0, images: 0, chars: 0, lastAt: null };

const subs = new Set<() => void>();
export const onGeminiChange = (fn: () => void): (() => void) => { subs.add(fn); return () => void subs.delete(fn); };
const changed = () => subs.forEach((f) => f());

export async function getGeminiConfig(): Promise<GeminiConfig> {
  return { ...EMPTY, ...((await getKv<Partial<GeminiConfig>>('gemini')) ?? {}) };
}
export async function saveGeminiConfig(patch: Partial<GeminiConfig>): Promise<GeminiConfig> {
  const next = { ...(await getGeminiConfig()), ...patch };
  await setKv('gemini', next);
  changed();
  return next;
}
export async function removeGeminiKey(): Promise<void> {
  await saveGeminiConfig({ key: '' });
}
export async function getGeminiUsage(): Promise<GeminiUsage> {
  return { ...EMPTY_USAGE, ...((await getKv<Partial<GeminiUsage>>('gemini-usage')) ?? {}) };
}
async function bump(images: number, chars: number): Promise<void> {
  const u = await getGeminiUsage();
  await setKv('gemini-usage', { calls: u.calls + 1, images: u.images + images, chars: u.chars + chars, lastAt: Date.now() });
  changed();
}

export function maskKey(k: string): string {
  return k.length <= 8 ? '••••' : `${k.slice(0, 4)}••••••••${k.slice(-4)}`;
}

export class GeminiError extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

async function toBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

function friendly(status: number, body: string): string {
  let msg = '';
  try { msg = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? ''; } catch { /* not json */ }
  if (status === 400 && /api key/i.test(msg)) return 'Google rejected this API key. Check that you copied the whole key.';
  if (status === 401 || status === 403) return 'The key was not accepted for this model (permission denied). Make sure the Generative Language API is enabled for it.';
  if (status === 404) return 'That model name was not found. Pick another model in the AI settings.';
  if (status === 429) return 'Gemini rate limit or free quota reached. Wait a bit, or check billing for this key.';
  if (status >= 500) return 'Gemini is having trouble right now. Try again in a moment.';
  return msg || `Gemini returned HTTP ${status}.`;
}

async function generate(parts: Part[], opts: { json?: boolean; images?: number } = {}): Promise<string> {
  const cfg = await getGeminiConfig();
  if (!cfg.key) throw new GeminiError('Add a Gemini API key first.');
  if (!cfg.consentAt) throw new GeminiError('Confirm the Gemini disclosure first (AI page).');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 60_000);
  let res: Response;
  try {
    res = await fetch(`${GEMINI_ORIGIN}/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.2, ...(opts.json ? { responseMimeType: 'application/json' } : {}) },
      }),
    });
  } catch (e) {
    throw new GeminiError(ctl.signal.aborted ? 'Gemini took too long to answer.' : 'Could not reach Gemini. Check your connection.');
  } finally {
    clearTimeout(t);
  }
  const body = await res.text();
  if (!res.ok) throw new GeminiError(friendly(res.status, body), res.status);
  await bump(opts.images ?? 0, parts.reduce((n, p) => n + ('text' in p ? p.text.length : 0), 0));
  const j = JSON.parse(body) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
  if (!text) throw new GeminiError(j.promptFeedback?.blockReason ? `Gemini declined to answer (${j.promptFeedback.blockReason}).` : 'Gemini returned an empty answer.');
  return text;
}

export async function testKey(): Promise<string> {
  return generate([{ text: 'Reply with the single word: ready' }]);
}

async function framePart(id: string): Promise<{ img: Part; text: string; when: string } | null> {
  const [b, o, f] = await Promise.all([getBlobs(id), getOcr(id), getFrame(id)]);
  if (!b || !f) return null;
  return {
    img: { inline_data: { mime_type: b.full.type || 'image/webp', data: await toBase64(b.full) } },
    text: (o?.text ?? '').slice(0, 1500),
    when: fmtWall(f.wall),
  };
}

const SAFETY = 'The screenshot was already redacted on the user\'s device: pixelated regions hide sensitive values. Never guess what is hidden behind them.';

export async function getCachedAnalysis(frameId: string): Promise<FrameAnalysis | undefined> {
  return getKv<FrameAnalysis>(`gem:frame:${frameId}`);
}

export async function analyzeFrame(frameId: string, force = false): Promise<FrameAnalysis> {
  if (!force) { const hit = await getCachedAnalysis(frameId); if (hit) return hit; }
  const p = await framePart(frameId);
  if (!p) throw new GeminiError('That frame is no longer stored.');
  const prompt = `${SAFETY}
Describe this screenshot for a personal screen-memory archive. Reply as JSON with exactly these keys:
"title" (max 8 words), "summary" (2 sentences: what the person was doing and why it matters), "details" (up to 5 short strings: concrete facts such as names, numbers, errors, decisions), "tags" (up to 5 lowercase words).
Text found on screen by OCR (may contain mistakes):
${p.text || '(none)'}`;
  const raw = await generate([p.img, { text: prompt }], { json: true, images: 1 });
  let parsed: Partial<FrameAnalysis> = {};
  try { parsed = JSON.parse(raw) as Partial<FrameAnalysis>; } catch { parsed = { title: 'Analysis', summary: raw }; }
  const out: FrameAnalysis = {
    title: String(parsed.title ?? 'Analysis').slice(0, 120),
    summary: String(parsed.summary ?? ''),
    details: Array.isArray(parsed.details) ? parsed.details.map(String).slice(0, 8) : [],
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 8) : [],
    model: (await getGeminiConfig()).model,
    at: Date.now(),
  };
  await setKv(`gem:frame:${frameId}`, out);
  changed();
  return out;
}

export async function askAboutFrames(question: string, frameIds: string[]): Promise<string> {
  const ids = frameIds.slice(0, MAX_IMAGES);
  const parts: Part[] = [];
  let used = 0;
  for (let i = 0; i < ids.length; i++) {
    const p = await framePart(ids[i] as string);
    if (!p) continue;
    used++;
    parts.push({ text: `Frame ${i + 1}, seen ${p.when}. OCR text: ${p.text || '(none)'}` }, p.img);
  }
  if (!used) throw new GeminiError('No stored frames to send. Search first, or record something.');
  parts.push({
    text: `${SAFETY}
You are answering a question about the user's own past screen activity, using only the frames above. Cite frames as [Frame N]. If the frames do not contain the answer, say so plainly instead of guessing. Keep it short.
Question: ${question}`,
  });
  return generate(parts, { images: used });
}

import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import { withRetry, withTimeout } from './util.js';
import * as mock from './mock.js';

export const isMock = config.mock;
let client = null;
const ai = () => (client ??= new GoogleGenAI({ apiKey: config.apiKey }));

// parts helpers
export const text = (t) => ({ text: t });
export const img = (buf, mime = 'image/jpeg') => ({ inlineData: { mimeType: mime, data: buf.toString('base64') } });

/** Structured JSON from the vision model. `mockKey` is only used in mock mode. */
export async function generateJson({ system, parts, schema, mockKey, mockArgs }) {
  if (isMock) return mock.json(mockKey, mockArgs);
  const call = async () => {
    const res = await withTimeout(
      ai().models.generateContent({
        model: config.visionModel,
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
      }),
      config.timeoutMs,
      'vision call'
    );
    const raw = res.text;
    if (!raw) throw new Error('empty vision response');
    return JSON.parse(raw.replace(/^```json\s*|```$/g, ''));
  };
  return withRetry(call, { label: 'vision' });
}

/** Image generation. Returns { mime, data (Buffer) }. */
export async function generateImage({ parts, meta }) {
  if (isMock) return mock.image(meta);
  const call = async () => {
    const cfg = { responseModalities: ['IMAGE', 'TEXT'] };
    if (config.imageAspect) cfg.imageConfig = { aspectRatio: config.imageAspect };
    const res = await withTimeout(
      ai().models.generateContent({ model: config.imageModel, contents: [{ role: 'user', parts }], config: cfg }),
      config.timeoutMs,
      'image call'
    );
    const out = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!out) {
      const why = res.candidates?.[0]?.finishReason || 'no image returned';
      const e = new Error(`image model returned no image (${why})`);
      e.status = 502; // retriable once
      throw e;
    }
    return { mime: out.inlineData.mimeType || 'image/png', data: Buffer.from(out.inlineData.data, 'base64') };
  };
  return withRetry(call, { label: 'image' });
}

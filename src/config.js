import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  port: Number(process.env.PORT) || 3000,
  apiKey: process.env.GEMINI_API_KEY || '',
  imageModel: process.env.IMAGE_MODEL || 'gemini-3.1-flash-image',
  visionModel: process.env.VISION_MODEL || 'gemini-3.8-flash',
  imageAspect: process.env.IMAGE_ASPECT === undefined ? '1:1' : process.env.IMAGE_ASPECT,
  timeoutMs: Number(process.env.CALL_TIMEOUT_MS) || 60000,
  guidesPerHour: Number(process.env.GUIDES_PER_HOUR) || 20,
  concurrency: 4,
  mock: process.env.FLATPACK_MOCK === '1' || !process.env.GEMINI_API_KEY,
  dirs: {
    assets: path.join(ROOT, 'assets'),
    guides: path.join(ROOT, 'data', 'guides'),
    demos: path.join(ROOT, 'data', 'demos'),
    demoInputs: path.join(ROOT, 'demo-inputs'),
    public: path.join(ROOT, 'public'),
  },
};

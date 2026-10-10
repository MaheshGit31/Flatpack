import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

export const sample = (id: string) => ({ id, b64: readFileSync(`samples/${id}.png`).toString('base64') });

/** Run PNG samples through the real pipeline (OCR → redact → CLIP → store) inside the page. */
export async function importSamples(page: Page, ids: string[], label = 'test') {
  return page.evaluate(async ({ items, label }) => {
    const f = (window as unknown as { __flatpak: any }).__flatpak;
    const blobs = items.map((i: { id: string; b64: string }) => ({ name: i.id, blob: new Blob([Uint8Array.from(atob(i.b64), (c) => c.charCodeAt(0))], { type: 'image/png' }) }));
    const r = await f.importImages(blobs, { label, gapMs: 60_000 });
    return { sessionId: r.session.id as string, stored: r.stored as number, skipped: r.skipped as number };
  }, { items: ids.map(sample), label });
}

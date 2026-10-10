export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function withTimeout(promise, ms, label = 'call') {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(Object.assign(new Error(`${label} timed out after ${ms}ms`), { status: 504 })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

// one retry on 429 / 5xx / timeout / network error, exponential backoff
export async function withRetry(fn, { retries = 1, base = 1500, label = 'call' } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const status = e?.status || e?.code || 0;
      if (/limit: 0|PerDay|billing/i.test(e?.message || '')) throw e; // hard quota: retrying only burns more
      const retriable = status === 429 || (status >= 500 && status < 600) || /timed out|ECONNRESET|fetch failed|ETIMEDOUT/i.test(e?.message || '');
      if (!retriable || attempt >= retries) throw e;
      await sleep(base * 2 ** attempt + Math.random() * 300);
    }
  }
}

// run async tasks with a concurrency cap; never throws (allSettled semantics)
export async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = { status: 'fulfilled', value: await worker(items[idx], idx) };
      } catch (reason) {
        results[idx] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

export function safeErr(e) {
  // never leak the API key into logs/messages
  const key = process.env.GEMINI_API_KEY;
  let m = String(e?.message || e || 'unknown error');
  if (m.trim().startsWith('{')) { try { const j = JSON.parse(m); m = j?.error?.message || m; } catch { /* keep raw */ } }
  if (key) m = m.split(key).join('[redacted]');
  if (/quota|RESOURCE_EXHAUSTED|\b429\b/i.test(m)) m = 'Gemini quota exceeded for this model/key. Enable billing or check limits at ai.dev/rate-limit. ' + m.slice(0, 160);
  else if (/API key|PERMISSION_DENIED|\b403\b|\b401\b/i.test(m)) m = 'Gemini rejected the API key or the model is not allowed for it. ' + m.slice(0, 160);
  else if (/no longer available|NOT_FOUND|\b404\b/i.test(m)) m = 'Model not available for this key, change IMAGE_MODEL / VISION_MODEL. ' + m.slice(0, 160);
  return m.slice(0, 300);
}

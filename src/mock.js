// MOCK MODE: used only when no GEMINI_API_KEY is set. Draws placeholder panels so the whole
// app (SSE, skeletons, critic loop, PDF, fix button, demos) can be exercised offline.
import sharp from 'sharp';

const wrap = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="768" viewBox="0 0 768 768"><rect width="768" height="768" fill="#fff"/>${inner}</svg>`;

const figure = (x, y, s = 1) => `
<g transform="translate(${x},${y}) scale(${s})" fill="none" stroke="#111" stroke-width="5" stroke-linecap="round">
  <circle cx="0" cy="-120" r="38" fill="#fff"/><circle cx="-13" cy="-125" r="4" fill="#111"/><circle cx="13" cy="-125" r="4" fill="#111"/>
  <path d="M-10 -104 q10 7 20 0"/><path d="M-28 -78 h56 l12 70 h-80z" fill="#fff"/>
  <path d="M-22 -8 v90 M22 -8 v90"/><path d="M-28 -70 l-40 50 M28 -70 l40 50"/></g>`;

export async function image(meta = {}) {
  const { n = 1, is_warning = false, rev = 0 } = meta;
  const box = `<rect x="430" y="330" width="200" height="150" fill="#fff" stroke="#111" stroke-width="5"/><path d="M430 380 h200" stroke="#111" stroke-width="5"/>`;
  const arrow = `<path d="M330 300 q60 -80 140 -40" fill="none" stroke="#111" stroke-width="8"/><path d="M455 235 l30 25 l-38 12z" fill="#111"/>`;
  const x = is_warning ? `<g stroke="#d4181f" stroke-width="16" stroke-linecap="round"><path d="M520 120 l110 110 M630 120 l-110 110"/></g>` : '';
  const dots = Array.from({ length: rev }, (_, i) => `<circle cx="${60 + i * 26}" cy="720" r="8" fill="#111"/>`).join('');
  const shift = (n * 37) % 90;
  const svg = wrap(`${figure(220 + shift / 3, 420)}${box}${arrow}${x}
    <circle cx="70" cy="70" r="40" fill="#fff" stroke="#111" stroke-width="6"/>
    <text x="70" y="86" font-family="Arial,Helvetica,sans-serif" font-weight="800" font-size="46" text-anchor="middle" fill="#111">${n}</text>${dots}`);
  const data = await sharp(Buffer.from(svg)).png().toBuffer();
  return { mime: 'image/png', data };
}

export async function character() {
  const svg = wrap(`${figure(384, 380, 1.9)}`);
  return { mime: 'image/png', data: await sharp(Buffer.from(svg)).png().toBuffer() };
}

export function json(key, a = {}) {
  switch (key) {
    case 'read': {
      const h = (a.hint || '').toLowerCase();
      const safety = /pill|med|dose|tablet|drug/.test(h) ? 'medical' : /form|legal|tax|lease/.test(h) ? 'legal' : /hazard|chem|blade/.test(h) ? 'hazard' : 'none';
      return {
        subject: a.hint ? a.hint.slice(0, 60) : 'a boxed gadget',
        goal: a.hint ? `understand and use: ${a.hint.slice(0, 80)}` : 'unbox and set up the gadget',
        audience_note: 'first-time user, may not read the local language',
        needs_clarification: /^\s*\?\?\s*$/.test(a.hint || ''),
        clarifying_question: /^\s*\?\?\s*$/.test(a.hint || '') ? 'what do you want to do with this?' : null,
        safety_category: safety,
      };
    }
    case 'plan': {
      const acts = [
        ['open the box lid', 'wide shot, character lifts the lid with both hands, arrow 1 pointing up', 'the lid is shown open and lifted'],
        ['take the item out', 'close-up, one hand lifts the item out of the box, arrow 2 upward', 'a hand is lifting the item out of the box'],
        ['do not pull the cable hard', 'character tugs the cable, big red X over the cable', 'a red X is shown over a pulled cable'],
        ['plug the cable in', 'close-up, hand pushes the plug into the socket, arrow 3 toward the socket', 'a plug is being inserted into a socket'],
        ['press the power button once', 'close-up, finger presses a round button, small clock symbol', 'a finger presses a single round button'],
      ];
      return {
        steps: acts.map((s, i) => ({ n: i + 1, action: s[0], panel_spec: s[1], check: s[2], is_warning: i === 2 })),
      };
    }
    case 'critic':
      // fail attempt 0 of step 2 so the regenerate-once loop is exercised
      return a.n === 2 && a.attempt === 0
        ? { pass: false, reasons: ['mock: hand not clearly lifting the item'] }
        : { pass: true, reasons: [] };
    case 'diagnose': {
      const n = Math.min(Math.max(a.clicked || 1, 1), a.total);
      const dep = a.total > n ? [n + 1] : [];
      return {
        affected_step: n,
        dependent_steps: dep,
        what_differs: 'mock: the user reports the real situation differs here',
        revised: [n, ...dep].map((k) => ({ n: k, panel_spec: `revised view of step ${k} reflecting the user's photo`, check: 'the panel matches the revised situation' })),
      };
    }
    default:
      throw new Error('unknown mock key ' + key);
  }
}

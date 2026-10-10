import { Type } from '@google/genai';
import { generateJson, img, text } from './gemini.js';
import { getCharacter } from './character.js';

const SCHEMA = {
  type: Type.OBJECT,
  properties: { pass: { type: Type.BOOLEAN }, reasons: { type: Type.ARRAY, items: { type: Type.STRING } } },
  required: ['pass', 'reasons'],
};

const SYSTEM = `You are a strict QA reviewer for wordless IKEA-style instruction panels. Return JSON {pass, reasons}.
pass is true ONLY if ALL hold:
1) the panel satisfies the given claim,
2) there is no legible text anywhere besides the step number in the top-left circle (universal symbols like check, X, arrow, clock, ? are fine),
3) the character matches the reference figure (bald round head, dot eyes, small mouth, plain tee and trousers, same proportions),
4) the style is black-and-white line art on white, red allowed only for X marks / warning symbols.
If pass is false, reasons are short concrete fixes for the artist.`;

export async function review({ panel, step, n, attempt }) {
  try {
    const character = await getCharacter();
    const r = await generateJson({
      system: SYSTEM,
      parts: [
        text('REFERENCE character:'),
        img(character, 'image/png'),
        text('PANEL to review:'),
        img(panel.data, panel.mime),
        text(`Claim: ${step.check}\nDoes this image satisfy this claim? Also: is there any legible text besides the step number? Does the character match the reference? Answer JSON {pass: boolean, reasons: string[]}`),
      ],
      schema: SCHEMA,
      mockKey: 'critic',
      mockArgs: { n, attempt },
    });
    return { pass: !!r.pass, reasons: Array.isArray(r.reasons) ? r.reasons.map(String).slice(0, 5) : [] };
  } catch (e) {
    // critic outage must never break a guide
    return { pass: null, reasons: [] };
  }
}

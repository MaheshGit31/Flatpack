import { Type } from '@google/genai';
import { generateJson, img, text } from './gemini.js';

const PLAN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    steps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          n: { type: Type.INTEGER },
          action: { type: Type.STRING },
          panel_spec: { type: Type.STRING },
          check: { type: Type.STRING },
          is_warning: { type: Type.BOOLEAN },
        },
        required: ['n', 'action', 'panel_spec', 'check', 'is_warning'],
      },
    },
  },
  required: ['steps'],
};

const PLAN_SYSTEM = `You plan a WORDLESS, IKEA-assembly-manual style visual guide, one picture panel per step.
Break the goal into 4 to 8 atomic steps.
HARD RULES:
- exactly ONE physical action per step (never "open and remove", never two verbs).
- NO text or words may appear in any panel. Only the step number and universal symbols: check mark, X, arrow, clock, question mark. So never plan a panel that needs a label, a caption, or readable writing. Point at things, circle them, use arrows, counts of fingers, clocks, check marks.
- include AT MOST ONE panel with is_warning=true (a red X "don't do this" or caution symbol) and only when something can really go wrong.
- the person is always the same single character: a bald, round-headed simple figure. Never describe other people's faces or clothing.
Per step return:
- n: 1..N in order
- action: short plain-english label of the one action (used for alt text only)
- panel_spec: PRECISE visual description of the panel: what is shown, hand positions, object placement relative to the character, arrow direction and number, close-up vs wide. Describe the object so it matches the photo. Never ask for words inside the image.
- check: ONE sentence that is a yes/no testable claim about what the finished panel must visibly show.
- is_warning: boolean.
Return JSON only.`;

export function validatePlan(p) {
  const steps = p?.steps;
  if (!Array.isArray(steps)) throw new Error('steps missing');
  if (steps.length < 4 || steps.length > 8) throw new Error(`need 4-8 steps, got ${steps.length}`);
  steps.forEach((s, i) => {
    if (s.n !== i + 1) throw new Error(`step numbers must run 1..N, found ${s.n} at position ${i + 1}`);
    for (const k of ['action', 'panel_spec', 'check']) if (typeof s[k] !== 'string' || !s[k].trim()) throw new Error(`step ${s.n} missing ${k}`);
    if (typeof s.is_warning !== 'boolean') throw new Error(`step ${s.n} is_warning must be boolean`);
  });
  if (steps.filter((s) => s.is_warning).length > 1) throw new Error('at most 1 warning panel');
  return steps.map(({ n, action, panel_spec, check, is_warning }) => ({ n, action, panel_spec, check, is_warning }));
}

export async function makePlan({ photo, info, hint }) {
  const base = [
    img(photo),
    text(`Subject: ${info.subject}\nGoal: ${info.goal}\nAudience: ${info.audience_note}\nSafety category: ${info.safety_category}\n${hint ? `User hint: ${hint}\n` : ''}Plan the guide.`),
  ];
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const parts = attempt === 0 ? base : [...base, text(`Your previous answer was invalid: ${lastErr}. Fix it and return valid JSON that follows every hard rule.`)];
    try {
      const raw = await generateJson({ system: PLAN_SYSTEM, parts, schema: PLAN_SCHEMA, mockKey: 'plan' });
      return validatePlan(raw);
    } catch (e) {
      lastErr = e.message;
    }
  }
  throw new Error('could not build a valid plan: ' + lastErr);
}

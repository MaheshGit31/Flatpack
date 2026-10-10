import { STYLE_PROMPT } from './style.js';
import { getCharacter } from './character.js';
import { generateImage, img, text } from './gemini.js';

/**
 * One panel. Conditioning: locked style prompt + character reference image + panel spec + original photo.
 * Optional: fixPhoto (what the user really sees), failure reasons from the critic.
 */
export async function drawPanel({ photo, step, fixPhoto, reasons, rev = 0, attempt = 0 }) {
  const character = await getCharacter();
  const parts = [
    text('IMAGE 1 is the CHARACTER REFERENCE. Draw this exact same character, identical face, proportions and clothing.'),
    img(character, 'image/png'),
    text('IMAGE 2 is the ORIGINAL PHOTO of the real object. Use it ONLY so the object looks right (shape, buttons, layout). Do NOT copy any text from it; redraw it as simple line art with no writing.'),
    img(photo),
  ];
  if (fixPhoto) {
    parts.push(text('IMAGE 3 shows what the user ACTUALLY sees right now. Make the panel match this reality.'), img(fixPhoto));
  }
  let prompt = `${STYLE_PROMPT}\n\nDraw panel number ${step.n}${step.is_warning ? ' (a WARNING panel: show the mistake to avoid with a bold red X, red is allowed only for the X or warning symbol)' : ''}.\nPanel description: ${step.panel_spec}\nThe step number ${step.n} appears in a circle in the top-left corner and no other text.`;
  if (reasons?.length) prompt += `\n\nThe previous attempt FAILED review for these reasons. Fix them: ${reasons.join('; ')}`;
  parts.push(text(prompt));
  const out = await generateImage({
    parts,
    meta: { n: step.n, is_warning: step.is_warning, rev, attempt },
  });
  return out; // { mime, data }
}

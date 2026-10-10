import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readPanel } from './store.js';

const A4 = [595.28, 841.89];
const M = 40;
const RED = rgb(0.83, 0.09, 0.12);
const BLACK = rgb(0.07, 0.07, 0.07);
// standard fonts only encode WinAnsi; strip anything else
const clean = (s) => String(s || '').replace(/[^\x20-\x7e]/g, '').trim();

export async function buildPdf(guide) {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle(`FLATPACK - ${clean(guide.title || guide.subject) || 'guide'}`);
  doc.setProducer('FLATPACK');

  let page = doc.addPage(A4);
  const [W, H] = A4;
  // logo drawn in vector: black block + red dot
  page.drawRectangle({ x: M, y: H - M - 34, width: 150, height: 34, color: BLACK });
  page.drawText('FLATPACK', { x: M + 12, y: H - M - 24, size: 20, font: bold, color: rgb(1, 1, 1) });
  page.drawCircle({ x: M + 150 + 14, y: H - M - 17, size: 6, color: RED });
  page.drawText(clean(guide.title || guide.subject).toUpperCase().slice(0, 60) || 'GUIDE', { x: M, y: H - M - 62, size: 16, font: bold, color: BLACK });
  page.drawText("instructions shouldn't need a language.", { x: M, y: H - M - 80, size: 9, font: reg, color: rgb(0.4, 0.4, 0.4) });
  page.drawLine({ start: { x: M, y: H - M - 90 }, end: { x: W - M, y: H - M - 90 }, thickness: 2, color: BLACK });

  const gap = 18;
  const cell = (W - 2 * M - gap) / 2;
  let y = H - M - 90 - 20; // top of the current row
  let col = 0;

  const newPage = () => { page = doc.addPage(A4); y = H - M; col = 0; };
  const place = async (draw) => {
    if (y - cell < M + 30) newPage();
    const x = M + col * (cell + gap);
    await draw(x, y - cell);
    col++;
    if (col === 2) { col = 0; y -= cell + gap; }
  };

  for (const s of guide.plan) {
    const p = readPanel(guide, s.n);
    await place(async (x, yb) => {
      page.drawRectangle({ x, y: yb, width: cell, height: cell, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.75, color: rgb(1, 1, 1) });
      if (p) {
        try {
          const im = p.mime.includes('jpeg') ? await doc.embedJpg(p.data) : await doc.embedPng(p.data);
          const sc = Math.min((cell - 4) / im.width, (cell - 4) / im.height);
          page.drawImage(im, { x: x + (cell - im.width * sc) / 2, y: yb + (cell - im.height * sc) / 2, width: im.width * sc, height: im.height * sc });
        } catch {
          page.drawText('?', { x: x + cell / 2 - 10, y: yb + cell / 2 - 14, size: 48, font: bold, color: rgb(0.7, 0.7, 0.7) });
        }
      } else {
        page.drawText('?', { x: x + cell / 2 - 10, y: yb + cell / 2 - 14, size: 48, font: bold, color: rgb(0.7, 0.7, 0.7) });
      }
    });
  }

  if (guide.safety_category && guide.safety_category !== 'none') {
    await place(async (x, yb) => {
      page.drawRectangle({ x, y: yb, width: cell, height: cell, borderColor: RED, borderWidth: 2 });
      page.drawText('!', { x: x + cell / 2 - 12, y: yb + cell / 2 + 20, size: 90, font: bold, color: RED });
      const msg = 'Visual aid only.';
      const msg2 = 'Not professional advice.';
      page.drawText(msg, { x: x + (cell - bold.widthOfTextAtSize(msg, 13)) / 2, y: yb + 60, size: 13, font: bold, color: BLACK });
      page.drawText(msg2, { x: x + (cell - bold.widthOfTextAtSize(msg2, 13)) / 2, y: yb + 42, size: 13, font: bold, color: BLACK });
    });
  }

  // footer on every page
  const pages = doc.getPages();
  pages.forEach((pg, i) => pg.drawText(`flatpack  ${i + 1}/${pages.length}`, { x: M, y: 20, size: 8, font: reg, color: rgb(0.5, 0.5, 0.5) }));
  return Buffer.from(await doc.save());
}

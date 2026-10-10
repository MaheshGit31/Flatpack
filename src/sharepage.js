const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const titleOf = (g) => g.title || g.subject || 'a guide';

const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' fill='%23fff'/%3E%3Cg fill='%23fff' stroke='%23111' stroke-width='2.2' stroke-linejoin='round' stroke-linecap='round'%3E%3Ccircle cx='20' cy='11' r='7'/%3E%3Cpath d='M12 19h16l2 11H10zM15 30v8M25 30v8'/%3E%3C/g%3E%3Ccircle cx='17.5' cy='10' r='1' fill='%23111'/%3E%3Ccircle cx='22.5' cy='10' r='1' fill='%23111'/%3E%3C/svg%3E";
export const favicon = FAVICON;

export function renderSharePage(g, origin) {
  const title = titleOf(g);
  const running = g.status === 'running' || g.status === 'new';
  const demo = g.id.startsWith('demo-');
  const url = `${origin}/g/${g.id}`;
  const hasOg = g.plan.length && g.panels[1]?.status === 'ok';
  const cells = g.plan.map((s) => {
    const p = g.panels[s.n];
    const body = p?.status === 'ok'
      ? `<img src="/api/guide/${g.id}/panel/${s.n}?w=900&v=${p.rev}" width="900" height="900" alt="step ${s.n}: ${esc(s.action)}" ${s.n > 2 ? 'loading="lazy"' : ''} decoding="async">`
      : `<div class="empty" aria-label="step ${s.n}: ${esc(s.action)}"><span>${running ? '' : '?'}</span></div>`;
    return `<li class="cell${s.is_warning ? ' warn' : ''}">${body}<span class="n" aria-hidden="true">${s.n}</span></li>`;
  }).join('');
  const disclaimer = g.safety_category && g.safety_category !== 'none'
    ? `<li class="cell disclaimer"><div><b class="bang">!</b><p>Visual aid only.<br>Not professional advice.</p></div></li>` : '';
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} - FLATPACK guide</title>
<meta name="description" content="A wordless, step-by-step visual guide: ${esc(title)}. Made with FLATPACK.">
${demo ? '' : '<meta name="robots" content="noindex">'}
<meta property="og:type" content="article"><meta property="og:site_name" content="FLATPACK"><meta property="og:title" content="${esc(title)} - a wordless guide">
<meta property="og:description" content="Instructions shouldn't need a language."><meta property="og:url" content="${esc(url)}">
${hasOg ? `<meta property="og:image" content="${esc(origin)}/og/${g.id}.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:image" content="${esc(origin)}/og/${g.id}.png">` : ''}
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${FAVICON}">
<link rel="stylesheet" href="/share.css">
</head><body${running ? ' data-running="1"' : ''}>
<header class="bar"><a class="logo" href="/" aria-label="FLATPACK home"><span class="logo-box">FLATPACK</span><i class="logo-dot"></i></a>
<nav class="actions"><a class="btn" href="/api/guide/${g.id}/pdf" download>Download PDF</a><button class="btn ghost" id="copy" type="button">Copy link</button></nav></header>
<main>
<p class="kicker">a wordless guide</p>
<h1>${esc(title)}</h1>
${running ? '<p class="note">still drawing, this page refreshes by itself...</p>' : ''}
<ol class="grid">${cells}${disclaimer}</ol>
<p class="make"><a class="btn red" href="/#try">Make your own guide</a></p>
</main>
<footer><p>Made with FLATPACK. Visual aid only, not professional advice.</p></footer>
<script src="/share.js"></script>
</body></html>`;
}

export function notFoundPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Guide not found - FLATPACK</title><meta name="robots" content="noindex"><link rel="stylesheet" href="/share.css"></head><body><main><p class="kicker">404</p><h1>that guide doesn't exist</h1><p class="make"><a class="btn red" href="/#try">Make a guide</a></p></main></body></html>`;
}

(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var els = {
    form: $('#form'), photo: $('#photo'), drop: $('#drop'), dropMain: $('#dropMain'), preview: $('#preview'), hint: $('#hint'), go: $('#go'),
    out: $('#out'), grid: $('#grid'), subject: $('#subject'), status: $('#status'), disclaimer: $('#disclaimer'),
    outActions: $('#outActions'), pdfBtn: $('#pdfBtn'), shareBtn: $('#shareBtn'), openBtn: $('#openBtn'), toast: $('#toast'),
    clarify: $('#clarify'), clarifyQ: $('#clarifyQ'), clarifyForm: $('#clarifyForm'), clarifyA: $('#clarifyA'),
    fixDlg: $('#fixDlg'), fixForm: $('#fixForm'), fixPhoto: $('#fixPhoto'), fixNote: $('#fixNote'), fixCancel: $('#fixCancel'), fixLbl: $('#fixPhotoLbl'),
    mock: $('#mockBanner'), loop: $('#loop'), gallery: $('#gallery')
  };
  var file = null;
  var state = { id: null, steps: [], abort: null, fixStep: null };
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- helpers ---------- */
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { els.toast.classList.remove('show'); }, 2800);
  }
  function setStatus(msg, busy) {
    els.status.textContent = msg || '';
    els.status.classList.toggle('busy', !!msg && busy !== false);
  }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; }

  /** SSE over fetch: works for GET replays and for streaming POSTs */
  function sse(url, opts, onEvent, signal) {
    opts = opts || {};
    opts.signal = signal;
    return fetch(url, opts).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || 'error ' + res.status); });
      }
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          buf += dec.decode(r.value, { stream: true });
          var i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            var chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            var ev = 'message', data = '';
            chunk.split('\n').forEach(function (line) {
              if (line.indexOf('event:') === 0) ev = line.slice(6).trim();
              else if (line.indexOf('data:') === 0) data += line.slice(5).trim();
            });
            if (data) { try { onEvent(ev, JSON.parse(data)); } catch (e) { console.error(e); } }
          }
          return pump();
        });
      }
      return pump();
    });
  }

  /* ---------- tool rendering ---------- */
  var SKEL = '<svg viewBox="0 0 100 100" fill="none" stroke="#111" stroke-width="3" stroke-linecap="round" aria-hidden="true"><circle class="draw" cx="40" cy="26" r="12"/><path class="draw" d="M26 46h28l6 36H20z"/><path class="draw" d="M62 60h22v22H62z"/></svg>';

  function makeSlot(step) {
    var li = el('li', 'slot' + (step.is_warning ? ' warn' : ''));
    li.dataset.n = step.n;
    li.style.animationDelay = ((step.n - 1) * 70) + 'ms';
    li.innerHTML = '<div class="frame" role="img" aria-label="step ' + step.n + ': ' + step.action.replace(/"/g, '&quot;') + '"><span class="num">' + step.n + '</span><div class="skel">' + SKEL + '</div></div>' +
      '<div class="meta"><span class="badge"></span><button class="fixbtn" type="button">this isn\'t what I see</button></div>';
    li.querySelector('.fixbtn').addEventListener('click', function () { openFix(step.n); });
    return li;
  }
  function slot(n) { return els.grid.querySelector('.slot[data-n="' + n + '"]'); }
  function actionOf(n) { var s = state.steps.filter(function (x) { return x.n === n; })[0]; return s ? s.action : ''; }

  function showPanel(n, src) {
    var li = slot(n); if (!li) return;
    var frame = li.querySelector('.frame');
    var sk = frame.querySelector('.skel'); if (sk) sk.remove();
    var fl = frame.querySelector('.failed'); if (fl) fl.remove();
    var im = new Image();
    im.alt = 'step ' + n + ': ' + actionOf(n);
    im.decoding = 'async';
    im.src = src;
    var old = frame.querySelector('img');
    if (old) old.replaceWith(im); else frame.appendChild(im);
    frame.removeAttribute('role'); frame.removeAttribute('aria-label');
    li.classList.add('has-img'); li.classList.remove('redraw');
    setBadge(n, '', 'checking...');
  }
  function setBadge(n, kind, text) {
    var li = slot(n), b = li && li.querySelector('.badge'); if (!b) return;
    b.className = 'badge ' + (kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : '');
    b.textContent = text || '';
  }
  function showFailed(n) {
    var li = slot(n); if (!li) return;
    var frame = li.querySelector('.frame');
    var sk = frame.querySelector('.skel'); if (sk) sk.remove();
    var im = frame.querySelector('img'); if (im) im.remove();
    li.classList.remove('has-img', 'redraw');
    if (!frame.querySelector('.failed')) {
      var d = el('div', 'failed', '<span class="q" aria-hidden="true">?</span><button class="btn" type="button">Retry this step</button>');
      d.querySelector('button').addEventListener('click', function () { retryStep(n); });
      frame.appendChild(d);
    }
    setBadge(n, 'warn', 'could not draw');
  }
  function setCritic(d) {
    if (d.passed === true) setBadge(d.n, 'ok', d.retried ? 'checked (fixed)' : 'checked');
    else if (d.passed === false) setBadge(d.n, 'warn', 'unverified');
    else setBadge(d.n, '', 'not checked');
  }

  function handle(ev, d) {
    switch (ev) {
      case 'status': setStatus(d.message); break;
      case 'plan':
        state.steps = d.steps;
        els.subject.textContent = d.subject;
        els.grid.replaceChildren.apply(els.grid, d.steps.map(makeSlot));
        els.disclaimer.hidden = !d.safety_category || d.safety_category === 'none';
        break;
      case 'panel': showPanel(d.n, 'data:' + d.mime + ';base64,' + d.imageBase64); break;
      case 'critic': setCritic(d); break;
      case 'panel_error': showFailed(d.n); break;
      case 'fix':
        d.regenerate.forEach(function (n) { var s = slot(n); if (s) s.classList.add('redraw'); setBadge(n, '', 'redrawing...'); });
        setStatus('redrawing step' + (d.regenerate.length > 1 ? 's ' : ' ') + d.regenerate.join(', '));
        break;
      case 'clarify':
        els.clarify.hidden = false; els.clarifyQ.textContent = d.question; setStatus('');
        break;
      case 'done': setStatus(''); els.outActions.hidden = !state.id; break;
      case 'error': setStatus('Something went wrong: ' + d.message, false); toast(d.message); break;
    }
  }

  function openOut(id) {
    state.id = id;
    els.out.hidden = false;
    els.clarify.hidden = true;
    els.outActions.hidden = true;
    els.grid.replaceChildren();
    els.disclaimer.hidden = true;
    if (id) {
      els.pdfBtn.href = '/api/guide/' + id + '/pdf';
      els.openBtn.href = '/g/' + id;
    }
  }
  function watch(id, query) {
    if (state.abort) state.abort.abort();
    state.abort = new AbortController();
    return sse('/api/guide/' + id + '/stream' + (query || ''), {}, handle, state.abort.signal).catch(function (e) {
      if (e.name !== 'AbortError') { setStatus('Something went wrong: ' + e.message, false); toast(e.message); }
    });
  }

  /* ---------- intake ---------- */
  function setFile(f) {
    if (!f) return;
    if (!/^image\//.test(f.type)) return toast('Images only');
    if (f.size > 8 * 1024 * 1024) return toast('Image too big, max 8MB');
    file = f;
    els.preview.src = URL.createObjectURL(f);
    els.preview.hidden = false;
    els.drop.classList.add('has');
    els.dropMain.textContent = 'Tap to retake';
    els.go.disabled = false;
  }
  els.photo.addEventListener('change', function () { setFile(els.photo.files[0]); });
  ['dragenter', 'dragover'].forEach(function (e) { els.drop.addEventListener(e, function (ev) { ev.preventDefault(); els.drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (e) { els.drop.addEventListener(e, function (ev) { ev.preventDefault(); els.drop.classList.remove('over'); }); });
  els.drop.addEventListener('drop', function (ev) { setFile(ev.dataTransfer.files[0]); });

  function scrollToOut() { els.out.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); }

  function submit(hint) {
    if (!file) return;
    els.go.disabled = true;
    var fd = new FormData();
    fd.append('photo', file);
    fd.append('hint', hint);
    openOut(null);
    els.subject.textContent = 'Reading your photo';
    setStatus('uploading');
    scrollToOut();
    fetch('/api/guide', { method: 'POST', body: fd })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'upload failed'); return j; }); })
      .then(function (j) { openOut(j.id); els.subject.textContent = 'Reading your photo'; setStatus('looking at your photo'); return watch(j.id); })
      .catch(function (e) { toast(e.message); setStatus(e.message, false); })
      .then(function () { els.go.disabled = false; });
  }
  els.form.addEventListener('submit', function (e) { e.preventDefault(); submit(els.hint.value.trim()); });
  els.clarifyForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var h = (els.hint.value.trim() + ' ' + els.clarifyA.value.trim()).trim();
    els.hint.value = h; els.clarifyA.value = '';
    submit(h);
  });

  document.querySelectorAll('[data-demo]').forEach(function (b) {
    b.addEventListener('click', function () {
      var id = 'demo-' + b.dataset.demo;
      openOut(id);
      els.subject.textContent = 'Loading example';
      scrollToOut();
      watch(id);
    });
  });

  /* ---------- share / fix / retry ---------- */
  els.shareBtn.addEventListener('click', function () {
    var url = location.origin + '/g/' + state.id;
    var fallback = function () { if (navigator.share) navigator.share({ url: url }).catch(function () {}); else window.prompt('Copy this link', url); };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast('Link copied'); }, fallback); else fallback();
  });
  function openFix(n) {
    if (state.id && state.id.indexOf('demo-') === 0) return toast('Examples are read-only. Make your own guide to use this.');
    state.fixStep = n;
    els.fixPhoto.value = ''; els.fixNote.value = '';
    els.fixLbl.firstElementChild.textContent = 'Add photo';
    els.fixDlg.showModal();
  }
  els.fixPhoto.addEventListener('change', function () { els.fixLbl.firstElementChild.textContent = els.fixPhoto.files[0] ? 'Photo added' : 'Add photo'; });
  els.fixCancel.addEventListener('click', function () { els.fixDlg.close(); });
  els.fixForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = els.fixPhoto.files[0], note = els.fixNote.value.trim();
    if (!f && !note) return toast('Add a photo or a note');
    els.fixDlg.close();
    var fd = new FormData();
    if (f) fd.append('photo', f);
    fd.append('note', note);
    runAction('/api/guide/' + state.id + '/step/' + state.fixStep + '/fix', fd);
  });
  function retryStep(n) { var s = slot(n); if (s) s.classList.add('redraw'); runAction('/api/guide/' + state.id + '/step/' + n + '/retry'); }
  function runAction(url, body) {
    setStatus('working');
    sse(url, { method: 'POST', body: body }, handle).catch(function (e) {
      setStatus('Something went wrong: ' + e.message, false); toast(e.message);
      document.querySelectorAll('.slot.redraw').forEach(function (s) { s.classList.remove('redraw'); });
    });
  }

  /* ---------- hero loop + gallery from stored demos (no API call) ---------- */
  function buildHero(demo) {
    var steps = demo.steps.slice(0, 3);
    if (steps.length < 3) { els.loop.innerHTML = '<div class="lp-fallback">1 &rarr; 2 &rarr; 3</div>'; return; }
    els.loop.replaceChildren.apply(els.loop, steps.map(function (s) {
      var d = el('div', 'lp'); var im = new Image(); im.src = s.url.replace('w=480', 'w=420'); im.alt = ''; im.width = 420; im.height = 420; d.appendChild(im); return d;
    }));
  }
  function buildGallery(demos) {
    els.gallery.replaceChildren();
    if (!demos.length) { els.gallery.innerHTML = '<p class="muted">No examples yet. Run <code>npm run make-demos</code>.</p>'; return; }
    demos.forEach(function (d) {
      var card = el('article', 'strip-card reveal');
      card.innerHTML = '<div class="strip-head"><h3></h3><a href="/g/' + d.id + '">Open full guide &rarr;</a></div><div class="strip"></div>';
      card.querySelector('h3').textContent = d.title;
      var strip = card.querySelector('.strip');
      d.steps.forEach(function (s) {
        var a = el('a'); a.href = '/g/' + d.id;
        var im = new Image(); im.src = s.url; im.loading = 'lazy'; im.decoding = 'async'; im.width = 480; im.height = 480; im.alt = 'step ' + s.n + ': ' + s.action;
        a.appendChild(im); strip.appendChild(a);
      });
      els.gallery.appendChild(card);
      observe(card);
    });
  }
  fetch('/api/demos').then(function (r) { return r.json(); }).then(function (j) {
    var demos = j.demos || [];
    if (demos.length) buildHero(demos[0]); else els.loop.innerHTML = '<div class="lp-fallback">1 &rarr; 2 &rarr; 3</div>';
    buildGallery(demos);
  }).catch(function () { els.gallery.innerHTML = '<p class="muted">Examples unavailable.</p>'; });
  fetch('/api/health').then(function (r) { return r.json(); }).then(function (h) { els.mock.hidden = !h.mock; }).catch(function () {});

  /* ---------- scroll reveal + nav highlight (no libraries) ---------- */
  var io = ('IntersectionObserver' in window) && !reduced ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }) : null;
  function observe(n) { if (io) io.observe(n); else n.classList.add('in'); }
  document.querySelectorAll('.reveal').forEach(observe);

  var links = {};
  document.querySelectorAll('.links a').forEach(function (a) { links[a.dataset.sec] = a; });
  if ('IntersectionObserver' in window) {
    var cur = null;
    var nav = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          cur = e.target.id;
          Object.keys(links).forEach(function (k) { links[k].classList.toggle('on', k === cur); links[k].removeAttribute('aria-current'); });
          if (links[cur]) links[cur].setAttribute('aria-current', 'true');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    ['how', 'try', 'examples', 'why'].forEach(function (id) { var s = document.getElementById(id); if (s) nav.observe(s); });
  }
})();

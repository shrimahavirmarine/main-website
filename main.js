/* ==========================================================================
   Himalayan Maritime Academy — interactions & liquid scroll motion
   GSAP + ScrollTrigger + Lenis. Everything degrades to a readable static page.
   ========================================================================== */
(() => {
  'use strict';
  window.__hmaReady = true;

  const root = document.documentElement;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canHover = matchMedia('(hover: hover)').matches;
  const hasGSAP = !!(window.gsap && window.ScrollTrigger);
  if (!hasGSAP) root.classList.remove('js');
  const motion = hasGSAP && !reduce;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const refresh = debounce(() => hasGSAP && ScrollTrigger.refresh(), 250);

  /* decoded-frame cache for the scroll sequences: createImageBitmap decodes off the main thread, so
     drawing a frame never stalls on a WebP decode mid-scroll. Only frames near the playhead are kept. */
  const frameCache = (imgs, ok, N, keep = 8) => {
    const bm = new Map(), pending = new Set();
    let last = 0;
    const prune = () => { for (const [k, b] of bm) if (Math.abs(k - last) > keep + 2) { b.close(); bm.delete(k); } };
    const want = (i) => {
      if (i < 0 || i >= N || !ok[i] || bm.has(i) || pending.has(i) || !window.createImageBitmap) return;
      pending.add(i);
      createImageBitmap(imgs[i]).then((b) => { pending.delete(i); bm.set(i, b); prune(); }, () => pending.delete(i));
    };
    return {
      get: (i) => bm.get(i) || imgs[i],
      around(i) {
        const dir = i >= last ? 1 : -1;
        last = i;
        for (let d = 0; d <= keep; d++) want(i + dir * d); // mostly ahead, in the direction of travel
        for (let d = 1; d <= 2; d++) want(i - dir * d);
      },
    };
  };

  /* frame packs: each 120-frame sequence ships as 4 files — every 8th frame, then the gaps at every
     4th, every 2nd and the rest — so the first pack alone is enough to start scrubbing. A pack is plain
     WebP files back to back; each frame is split off again by reading its RIFF header. */
  const PASSES = [8, 4, 2, 1];
  const passFrames = (N) => {
    const seen = new Uint8Array(N);
    return PASSES.map((st) => { const l = []; for (let i = 0; i < N; i += st) if (!seen[i]) { seen[i] = 1; l.push(i); } return l; });
  };
  const fetchBytes = async (url, onProgress) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const total = +res.headers.get('content-length') || 0;
    if (!res.body) { const b = await res.arrayBuffer(); if (onProgress) onProgress(1); return b; }
    const reader = res.body.getReader(), chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      if (onProgress && total) onProgress(Math.min(1, got / total));
    }
    const out = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    if (onProgress) onProgress(1);
    return out.buffer;
  };
  const splitPack = (buf) => {
    const dv = new DataView(buf), out = [];
    for (let o = 0; o + 8 <= buf.byteLength;) {
      const size = dv.getUint32(o + 4, true), end = o + 8 + size + (size & 1);
      out.push(new Blob([buf.slice(o, end)], { type: 'image/webp' }));
      o = end;
    }
    return out;
  };
  /* streams `${prefix}-1.bin` … `-4.bin`; onFrame(i, img) as each frame decodes, onProgress(pack, 0..1) */
  const loadSequence = async (prefix, N, onFrame, onProgress) => {
    const passes = passFrames(N);
    for (let p = 0; p < passes.length; p++) {
      let buf;
      try { buf = await fetchBytes(`${prefix}-${p + 1}.bin`, (f) => onProgress && onProgress(p, f)); }
      catch (_) { if (onProgress) onProgress(p, 1); continue; }
      await Promise.all(splitPack(buf).map((blob, k) => {
        const im = new Image();
        im.src = URL.createObjectURL(blob);
        return im.decode().then(() => onFrame(passes[p][k], im), () => {});
      }));
    }
  };

  $('#yr').textContent = new Date().getFullYear();
  const mq = $('#marquee');
  if (mq) mq.innerHTML += mq.innerHTML; // two copies → the -50% loop is seamless

  /* footer wordmark spans the full content width at any screen size */
  const word = $('.foot__word'), wordSpan = word && $('span', word);
  const fitWord = () => {
    if (!wordSpan) return;
    word.style.fontSize = '100px';
    const w = wordSpan.getBoundingClientRect().width;
    if (w) word.style.fontSize = `${((100 * word.clientWidth) / w) * 0.98}px`;
  };
  fitWord();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitWord);
  addEventListener('resize', debounce(fitWord, 120));

  /* ---------- liquid wave edges ---------- */
  const W_ = 2880, H_ = 120;
  const wavePath = (amp, len, phase, mid, fromTop) => {
    const y = (x) => (mid + Math.sin((x / len) * Math.PI * 2 + phase) * amp).toFixed(1);
    let d = fromTop ? `M0 0 L0 ${y(0)}` : `M0 ${H_} L0 ${y(0)}`;
    for (let x = 24; x <= W_; x += 24) d += ` L${x} ${y(x)}`;
    return d + (fromTop ? ` L${W_} 0 Z` : ` L${W_} ${H_} Z`);
  };
  const svgWave = (d) => `<svg viewBox="0 0 ${W_} ${H_}" preserveAspectRatio="none"><path d="${d}"/></svg>`;
  $$('.wave').forEach((w) => { w.innerHTML = svgWave(wavePath(30, 720, 0, 58)) + svgWave(wavePath(20, 480, 1.7, 72)); });
  $$('[data-wave="crest"] path').forEach((p) => p.setAttribute('d', wavePath(26, 480, 0, 60)));
  $$('[data-wave="edge"] path').forEach((p) => p.setAttribute('d', wavePath(26, 720, 0.6, 62, true)));
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => e.target.classList.toggle('is-paused', !e.isIntersecting)), { rootMargin: '120px' });
    $$('.wave').forEach((w) => io.observe(w));
  }

  /* ---------- smooth scroll ---------- */
  let lenis = null;
  if (hasGSAP) {
    gsap.registerPlugin(ScrollTrigger);
    if (window.Lenis && !reduce) {
      lenis = new Lenis({ lerp: 0.085, smoothWheel: true, wheelMultiplier: 1, touchMultiplier: 1.4 });
      ScrollTrigger.config({ ignoreMobileResize: true });
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add((t) => lenis.raf(t * 1000));
      gsap.ticker.lagSmoothing(0);
    }
  }
  const scrollToEl = (target) => {
    const el = typeof target === 'string' ? $(target) : target;
    if (!el) return;
    const glide = (t) => 1 - Math.pow(1 - t, 4); // quick start, long soft landing
    if (el.id === 'top') { lenis ? lenis.scrollTo(0, { duration: 1.8, easing: glide }) : scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); return; }
    if (lenis) lenis.scrollTo(el, { offset: -64, duration: 1.6, easing: glide });
    else el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  };
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href');
    if (id.length < 2) return;
    const el = document.getElementById(id.slice(1));
    if (!el) return;
    e.preventDefault();
    setDrawer(false);
    scrollToEl(el);
  });

  /* ---------- header, progress, back-to-top ---------- */
  const hdr = $('#hdr'), bar = $('.progress i'), totop = $('#totop'), ringP = $('#ringP');
  const onScroll = () => {
    const y = scrollY, max = root.scrollHeight - innerHeight, p = max > 0 ? clamp(y / max, 0, 1) : 0;
    bar.style.transform = `scaleX(${p})`;
    ringP.style.strokeDashoffset = (151 * (1 - p)).toFixed(1);
    hdr.classList.toggle('is-solid', y > innerHeight * 0.4);
    totop.classList.toggle('is-show', y > innerHeight * 1.5);
  };
  lenis ? lenis.on('scroll', onScroll) : addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  totop.addEventListener('click', () => scrollToEl('#top'));

  /* ---------- drawer ---------- */
  const burger = $('#burger'), drawer = $('#drawer');
  function setDrawer(open) {
    if (open === drawer.classList.contains('is-open')) return;
    burger.classList.toggle('is-open', open);
    drawer.classList.toggle('is-open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    drawer.toggleAttribute('inert', !open);
    document.body.classList.toggle('no-scroll', open);
    if (lenis) open ? lenis.stop() : lenis.start();
    $$('a', drawer).forEach((a, i) => { a.style.transitionDelay = open ? `${0.12 + i * 0.045}s` : '0s'; });
  }
  burger.addEventListener('click', () => setDrawer(!drawer.classList.contains('is-open')));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { setDrawer(false); closeLb(); } });

  /* ---------- pointer-following liquid fills ---------- */
  if (canHover) {
    document.addEventListener('pointerover', (e) => {
      const b = e.target.closest('.btn');
      if (!b) return;
      const r = b.getBoundingClientRect();
      b.style.setProperty('--bx', `${e.clientX - r.left}px`);
      b.style.setProperty('--by', `${e.clientY - r.top}px`);
    });
    $$('.card').forEach((c) => c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      c.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
      c.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
    }));
  }

  /* ---------- course explorer ---------- */
  const COURSES = [
    ['Basic Safety Maritime Training (BST)', 'Safety'], ['Advanced Fire Fighting (AFF)', 'Safety'], ['Medical First Aid (MFA)', 'Safety'],
    ['Medical Care (MC)', 'Safety'], ['Proficiency in Survival Craft & Rescue Boats (PSCRB)', 'Safety'], ['Fast Rescue Boats (FRB) — where approved', 'Safety'],
    ['Ship Security Officer (SSO)', 'Safety'], ['Security Awareness Training for Ratings', 'Safety'], ['Security Training — Designated Security Duties', 'Safety'],
    ['Marine Environmental Awareness', 'Safety'],
    ['Basic Oil & Chemical Tanker Familiarization (OTF)', 'Tanker'], ['Advanced Training — Oil Tanker Cargo Operations', 'Tanker'],
    ['Advanced Training — Chemical Tanker Cargo Operations', 'Tanker'],
    ['Bridge Team Management (BTM)', 'Navigation'], ['Bridge Resource Management (BRM)', 'Navigation'], ['Operational Use of ECDIS', 'Navigation'],
    ['ARPA — Operational Level', 'Navigation'], ['ARPA — Management Level', 'Navigation'], ['Global Maritime Distress & Safety System (GMDSS)', 'Navigation'],
    ['Engine Team Management (ETM)', 'Engine'], ['Engine Room Resource Management (ERM)', 'Engine'], ['High Voltage Installation — Operational Level', 'Engine'],
    ['High Voltage Installation — Management Level', 'Engine'], ['Electro Technical Officer (ETO)', 'Engine'],
    ['Leadership & Teamwork — Operational Level', 'Leadership'], ['Leadership & Teamwork — Management Level', 'Leadership'],
    ['Third Mate (Upgradation) — Deck', 'Upgradation'], ['Second Mate (Upgradation) — Deck', 'Upgradation'], ['Chief Mate Unlimited (Upgradation) — Deck', 'Upgradation'],
    ['Master Unlimited (Upgradation) — Deck', 'Upgradation'], ['Third Engineer Officer (Upgradation) — Engine', 'Upgradation'],
    ['Second Engineer Officer (Upgradation) — Engine', 'Upgradation'], ['First Engineer Officer (Upgradation) — Engine', 'Upgradation'],
    ['Chief Engineer Officer (Upgradation) — Engine', 'Upgradation'],
    ['Rating Forming Part of Navigational Watch (RFNW)', 'Ratings'], ['Rating Forming Part of Engineering Watch (RFEW)', 'Ratings'],
    ['Able Seafarer Deck (AB Deck II/5)', 'Ratings'], ['Able Seafarer Engine (AB Engine III/5)', 'Ratings'],
    ['COC Renewal Programme', 'Specialized'], ['COC Upgradation Programme', 'Specialized'], ['Refresher Course for Experienced Seafarers', 'Specialized'],
    ['Customized Maritime Training Programme', 'Specialized'], ['Professional Development Course', 'Specialized'],
  ];
  const DEPT = {
    Safety: { l: 'Safety & basic training', c: '#c2410c', i: 'i-life' },
    Tanker: { l: 'Tanker training', c: '#a16207', i: 'i-drop' },
    Navigation: { l: 'Navigation & bridge', c: '#0b63ce', i: 'i-compass' },
    Engine: { l: 'Engine room', c: '#0f766e', i: 'i-cog' },
    Leadership: { l: 'Leadership & teamwork', c: '#6d28d9', i: 'i-users' },
    Upgradation: { l: 'COC upgradation', c: '#1e3a8a', i: 'i-trend' },
    Ratings: { l: 'Rating courses', c: '#0e7490', i: 'i-anchor' },
    Specialized: { l: 'Specialized training', c: '#be185d', i: 'i-star' },
  };
  let cat = 'All', term = '';
  const picked = [];
  const chips = $('#chips'), grid = $('#courseGrid'), q = $('#q');

  chips.innerHTML = ['All', ...Object.keys(DEPT)].map((k) =>
    `<button class="chip" type="button" data-c="${k}" aria-pressed="${k === 'All'}"${k === 'All' ? '' : ` style="--c:${DEPT[k].c}"`}>` +
    `${k === 'All' ? '' : '<i></i>'}${k === 'All' ? 'All courses' : DEPT[k].l}</button>`).join('');

  function renderCourses() {
    const list = COURSES.filter(([n, d]) => (cat === 'All' || d === cat) && n.toLowerCase().includes(term));
    $('#cCount').textContent = list.length;
    grid.innerHTML = list.length ? list.map(([n, d], i) => {
      const on = picked.includes(n), D = DEPT[d];
      return `<article class="course${on ? ' is-picked' : ''}" style="--c:${D.c};animation-delay:${Math.min(i * 26, 400)}ms">` +
        `<span class="course__ico"><svg class="icon"><use href="#${D.i}"/></svg></span>` +
        `<div class="course__t"><span>${D.l}</span><b>${esc(n)}</b></div>` +
        `<button class="course__add" type="button" data-n="${esc(n)}" aria-pressed="${on}" aria-label="${on ? 'Remove' : 'Add'} ${esc(n)} ${on ? 'from' : 'to'} your enquiry">` +
        `<svg class="icon"><use href="#${on ? 'i-check' : 'i-plus'}"/></svg></button></article>`;
    }).join('') : '<p class="empty">No course matches that search. Try another word, or choose “All courses”.</p>';
    refresh();
  }
  const setCat = (c) => { cat = c; $$('.chip', chips).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.c === c))); renderCourses(); };
  chips.addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) setCat(b.dataset.c); });
  q.addEventListener('input', debounce(() => { term = q.value.toLowerCase().trim(); renderCourses(); }, 120));
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('.course__add');
    if (!b) return;
    const n = b.dataset.n, ix = picked.indexOf(n);
    ix > -1 ? picked.splice(ix, 1) : picked.push(n);
    renderCourses(); syncPicked();
  });
  $$('[data-jump]').forEach((b) => b.addEventListener('click', () => {
    term = ''; q.value = ''; setCat(b.dataset.jump);
    scrollToEl('#courses');
  }));
  renderCourses();

  /* ---------- shortlist ---------- */
  const dock = $('#dock'), pickedBox = $('#picked');
  function syncPicked() {
    $('#dockN').textContent = picked.length;
    dock.classList.toggle('is-show', picked.length > 0);
    pickedBox.innerHTML = picked.map((n) =>
      `<button type="button" data-n="${esc(n)}" aria-label="Remove ${esc(n)}">${esc(n)}<svg class="icon"><use href="#i-x"/></svg></button>`).join('');
  }
  pickedBox.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    picked.splice(picked.indexOf(b.dataset.n), 1);
    syncPicked(); renderCourses();
  });
  dock.addEventListener('click', () => scrollToEl('#contact'));

  /* ---------- application form → prefilled email ---------- */
  const TO = 'admissions@himalayanmaritime.com';
  const form = $('#applyForm'), formBody = $('.form__body', form);
  const fields = { name: $('#fName'), email: $('#fEmail'), phone: $('#fPhone') };
  const valid = {
    name: (v) => v.trim().length >= 2,
    email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()),
    phone: (v) => v.replace(/\D/g, '').length >= 7,
  };
  const check = (k) => {
    const el = fields[k], ok = valid[k](el.value);
    el.closest('.field').classList.toggle('is-bad', !ok);
    el.setAttribute('aria-invalid', String(!ok));
    return ok;
  };
  Object.keys(fields).forEach((k) => {
    fields[k].addEventListener('blur', () => { if (fields[k].value) check(k); });
    fields[k].addEventListener('input', () => { if (fields[k].closest('.is-bad')) check(k); });
  });
  const compose = () => {
    const v = (id) => $(id).value.trim();
    const name = v('#fName'), route = v('#fRoute'), rank = v('#fRank'), msg = v('#fMsg');
    const subject = `Admission enquiry — ${route} — ${name}`;
    const lines = ['Dear Admissions Team,', '', 'I would like to enquire about training at Himalayan Maritime Academy. My details are below.', '',
      `Full name: ${name}`, `Email: ${v('#fEmail')}`, `Phone / WhatsApp: ${v('#fPhone')}`, `Interested in: ${route}`];
    if (rank) lines.push(`Current rank / certificate: ${rank}`);
    if (picked.length) { lines.push('', 'Courses of interest:'); picked.forEach((c) => lines.push(`  • ${c}`)); }
    if (msg) lines.push('', 'Message:', msg);
    lines.push('', 'Kind regards,', name, '', '— Sent from the Himalayan Maritime Academy website');
    const body = lines.join('\n'), enc = encodeURIComponent;
    return {
      subject, body,
      mailto: `mailto:${TO}?subject=${enc(subject)}&body=${enc(body.replace(/\n/g, '\r\n'))}`,
      gmail: `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(TO)}&su=${enc(subject)}&body=${enc(body)}`,
      outlook: `https://outlook.office.com/mail/deeplink/compose?to=${enc(TO)}&subject=${enc(subject)}&body=${enc(body)}`,
    };
  };
  const openMail = (href) => {
    const a = document.createElement('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  };
  let mail = null;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const bad = Object.keys(fields).filter((k) => !check(k));
    if (bad.length) { fields[bad[0]].focus(); return; }
    mail = compose();
    $('#mailGmail').href = mail.gmail;
    $('#mailOutlook').href = mail.outlook;
    openMail(mail.mailto);
    form.classList.add('is-sent');
    formBody.setAttribute('inert', '');
    setTimeout(() => $('#mailAgain').focus({ preventScroll: true }), 400);
  });
  $('#mailAgain').addEventListener('click', () => mail && openMail(mail.mailto));
  $('#mailCopy').addEventListener('click', (e) => {
    if (!mail) return;
    const label = $('span', e.currentTarget);
    const text = `To: ${TO}\nSubject: ${mail.subject}\n\n${mail.body}`;
    const done = () => { label.textContent = 'Copied!'; setTimeout(() => { label.textContent = 'Copy details'; }, 2200); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => { label.textContent = 'Copy failed'; });
  });
  $('#mailEdit').addEventListener('click', () => {
    form.classList.remove('is-sent');
    formBody.removeAttribute('inert');
    fields.name.focus({ preventScroll: true });
  });

  /* ---------- FAQ accordion ---------- */
  $$('.acc__q').forEach((b) => b.addEventListener('click', () => {
    b.setAttribute('aria-expanded', String(b.getAttribute('aria-expanded') !== 'true'));
  }));
  $$('.acc__a').forEach((a) => a.addEventListener('transitionend', refresh));

  /* ---------- gallery lightbox ---------- */
  const gal = $$('.gal'), lb = $('#lb'), lbImg = $('#lbImg'), lbCap = $('#lbCap');
  let li = 0, lastFocus = null;
  const showLb = (i) => {
    li = (i + gal.length) % gal.length;
    const g = gal[li];
    lbImg.src = g.dataset.full;
    lbImg.alt = $('img', g).alt;
    lbCap.textContent = g.dataset.cap;
    if (!lb.classList.contains('is-open')) {
      lastFocus = document.activeElement;
      lb.classList.add('is-open');
      lb.removeAttribute('inert');
      if (lenis) lenis.stop();
      $('.lb__x', lb).focus();
    }
  };
  function closeLb() {
    if (!lb.classList.contains('is-open')) return;
    lb.classList.remove('is-open');
    lb.setAttribute('inert', '');
    if (lenis) lenis.start();
    if (lastFocus) lastFocus.focus({ preventScroll: true });
  }
  gal.forEach((g, i) => g.addEventListener('click', () => showLb(i)));
  $('.lb__x', lb).addEventListener('click', closeLb);
  $('.lb__prev', lb).addEventListener('click', () => showLb(li - 1));
  $('.lb__next', lb).addEventListener('click', () => showLb(li + 1));
  lb.addEventListener('click', (e) => { if (e.target === lb) closeLb(); });
  addEventListener('keydown', (e) => {
    if (!lb.classList.contains('is-open')) return;
    if (e.key === 'ArrowLeft') showLb(li - 1);
    if (e.key === 'ArrowRight') showLb(li + 1);
  });

  /* ---------- tour video ---------- */
  const player = $('#player'), tour = $('video', player);
  $('.player__btn', player).addEventListener('click', () => {
    tour.controls = true;
    tour.play().catch(() => {});
    player.classList.add('is-playing');
  });

  /* ---------- water ripple on image hover ---------- */
  if (motion && canHover) {
    const turb = $('#rippleTurb'), disp = $('#rippleDisp');
    $$('[data-ripple]').forEach((el) => {
      const img = $('img', el);
      el.addEventListener('pointerenter', () => {
        img.style.filter = 'url(#ripple)';
        gsap.fromTo(disp, { attr: { scale: 0 } }, {
          attr: { scale: 26 }, duration: 0.4, ease: 'power2.out', yoyo: true, repeat: 1, overwrite: true,
          onComplete: () => { img.style.filter = ''; },
        });
        gsap.fromTo(turb, { attr: { baseFrequency: '0.02 0.07' } }, { attr: { baseFrequency: '0.006 0.018' }, duration: 0.8, ease: 'power1.out', overwrite: true });
      });
    });
  }

  /* ======================================================================
     Hero — 160-frame drone orbit drawn to canvas, scrubbed by scroll,
     then the camera rises into clouds that wash out to white.
     ====================================================================== */
  const loader = $('#loader');
  const endLoader = () => { if (loader) loader.remove(); document.body.classList.remove('is-loading'); };

  if (!motion) {
    endLoader();
    return finishStatic();
  }

  document.body.classList.add('is-loading');
  if (lenis) lenis.stop();

  const FR = 120;
  const mobileSet = matchMedia('(max-width: 767px) and (orientation: portrait)').matches;
  /* big screens get the 1920px cut, laptops 1280px, phones a portrait crop */
  const set = mobileSet ? 'm' : innerWidth * Math.min(devicePixelRatio || 1, 2) >= 1700 ? 'x' : 'd';
  const imgs = new Array(FR), ok = new Uint8Array(FR);
  /* the loader waits for packs 1–2 (every 4th frame) — enough to scrub smoothly while the rest stream in */
  const packFrac = [0, 0];
  let prio = 0;

  const cv = $('#seq'), ctx = cv.getContext('2d');
  const cl = $('#clouds'), cctx = cl.getContext('2d');
  const view = { f: 0, zoom: 1, rot: 0, px: 0, py: 0 };
  /* where the ship sits in the final frame, as a fraction of the frame from its centre — the cloud gap
     opens around it and the climbing camera pans to keep it centred (portrait crop puts it further left) */
  const FOCUS = mobileSet ? [-0.13, 0.12] : [-0.08, 0.12];
  /* gap: radius of the opening we look down through, in units of the frame's half-size
     (>2 = no cloud on screen, <0 = closed). wisp: thin cloud streaming past the lens. */
  const sky = { gap: 2.4, wisp: 0, drift: 0 };
  let fw = 0, fh = 0; // natural frame size, read from the first frame that loads

  const nearest = (i) => {
    for (let d = 0; d < FR; d++) {
      if (i - d >= 0 && ok[i - d]) return i - d;
      if (i + d < FR && ok[i + d]) return i + d;
    }
    return -1;
  };
  const heroCache = frameCache(imgs, ok, FR);

  function drawSeq() {
    const k = nearest(clamp(Math.round(view.f), 0, FR - 1));
    if (k < 0) return;
    heroCache.around(k);
    const im = heroCache.get(k);
    const W = cv.width, H = cv.height, iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
    if (!W || !H) return;
    const s = Math.max(W / iw, H / ih) * view.zoom, dw = iw * s, dh = ih * s;
    const c = Math.cos(view.rot), sn = Math.sin(view.rot);
    const ox = FOCUS[0] * dw * view.px, oy = FOCUS[1] * dh * view.py;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (view.zoom < 0.999 || view.px > 0.001 || view.py > 0.001) { ctx.fillStyle = '#0e3558'; ctx.fillRect(0, 0, W, H); } // always hidden under cloud
    ctx.setTransform(c, sn, -sn, c, W / 2, H / 2);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(im, -dw / 2 - ox, -dh / 2 - oy, dw, dh);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* clouds: a tileable fractal-noise sheet rendered at low resolution (clouds are soft anyway).
     We look down at the ship through a ragged gap in it; as the camera climbs the gap closes. */
  const NS = 256, noise = new Float32Array(NS * NS);
  {
    let seed = 20261030;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    [[4, 0.5], [8, 0.26], [16, 0.13], [32, 0.07], [64, 0.04]].forEach(([cells, amp]) => {
      const g = Float32Array.from({ length: cells * cells }, rnd), step = NS / cells;
      for (let y = 0; y < NS; y++) for (let x = 0; x < NS; x++) {
        const gx = x / step, gy = y / step, x0 = gx | 0, y0 = gy | 0, x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
        const tx = gx - x0, ty = gy - y0, ux = tx * tx * (3 - 2 * tx), uy = ty * ty * (3 - 2 * ty);
        const a = g[y0 * cells + x0], b = g[y0 * cells + x1], cc = g[y1 * cells + x0], d = g[y1 * cells + x1];
        noise[y * NS + x] += amp * ((a + (b - a) * ux) * (1 - uy) + (cc + (d - cc) * ux) * uy);
      }
    });
    let mn = Infinity, mx = -Infinity;
    for (const v of noise) { if (v < mn) mn = v; if (v > mx) mx = v; }
    for (let i = 0; i < noise.length; i++) noise[i] = (noise[i] - mn) / (mx - mn);
  }
  const sampleN = (u, v) => {
    u = ((u % NS) + NS) % NS; v = ((v % NS) + NS) % NS;
    const x0 = u | 0, y0 = v | 0, x1 = (x0 + 1) & 255, y1 = (y0 + 1) & 255, tx = u - x0, ty = v - y0;
    const a = noise[y0 * NS + x0], b = noise[y0 * NS + x1], cc = noise[y1 * NS + x0], d = noise[y1 * NS + x1];
    return (a + (b - a) * tx) * (1 - ty) + (cc + (d - cc) * tx) * ty;
  };
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const cb = document.createElement('canvas'), cbx = cb.getContext('2d');
  let cimg = null, cloudsOn = false;

  function drawClouds() {
    const W = cl.width, H = cl.height;
    if (!W || !H) return; // canvas has no size yet (hidden, or mid-resize)
    if (!fw || (sky.gap >= 2.3 && sky.wisp <= 0.001)) {
      if (cloudsOn) { cctx.clearRect(0, 0, W, H); cloudsOn = false; }
      return;
    }
    const bw = clamp(Math.round(W / 3), 120, 440), bh = Math.max(1, Math.round((bw * H) / W));
    if (cb.width !== bw || cb.height !== bh || !cimg) { cb.width = bw; cb.height = bh; cimg = cbx.createImageData(bw, bh); }
    const s = Math.max(W / fw, H / fh) * view.zoom, hw = (fw * s) / 2, hh = (fh * s) / 2; // frame half-size now
    const ox = FOCUS[0] * fw * s * view.px, oy = FOCUS[1] * fh * s * view.py; // frame centre sits at (-ox,-oy)
    const gx0 = 2 * FOCUS[0], gy0 = 2 * FOCUS[1]; // the ship, in frame half-size units
    const c = Math.cos(view.rot), sn = Math.sin(view.rot), M = Math.max(W, H);
    const fa = NS / (1.1 * M * Math.pow(view.zoom, 0.75)); // cloud deck shrinks a little slower than the sea
    const fb = NS / (0.75 * M * (1 + sky.wisp * 1.6)); // wisps grow as we fly through them
    const kx = W / bw, ky = H / bh, data = cimg.data, guard = view.zoom < 0.999 || view.px > 0.001 || view.py > 0.001;
    let p = 0;
    for (let y = 0; y < bh; y++) {
      const sy = (y + 0.5) * ky - H / 2;
      for (let x = 0; x < bw; x++, p += 4) {
        const sx = (x + 0.5) * kx - W / 2;
        const fx = sx * c + sy * sn, fy = -sx * sn + sy * c; // into the (rotated) frame's axes
        const n = sampleN(fx * fa + 37 + sky.drift, fy * fa + 71);
        const ux = (fx + ox) / hw, uy = (fy + oy) / hh; // position within the frame, -1..1 at its edges
        const d = Math.sqrt((ux - gx0) * (ux - gx0) + (uy - gy0) * (uy - gy0)); // distance from the ship
        let a = smooth(sky.gap - 0.12, sky.gap + 0.14, d + (n - 0.5) * 0.5);
        if (guard) a = Math.max(a, smooth(0.92, 0.99, Math.max(Math.abs(ux), Math.abs(uy)))); // frame edge never shows
        let lit = smooth(0.28, 0.86, n);
        if (sky.wisp > 0.001) {
          const m = sampleN(fx * fb + 151, fy * fb + 23 - sky.drift * 1.8);
          const w = sky.wisp * smooth(0.48, 0.8, m);
          a += w * (1 - a);
          lit += (1 - lit) * w * 0.7;
        }
        data[p] = 192 + 63 * lit; data[p + 1] = 209 + 46 * lit; data[p + 2] = 230 + 25 * lit; // blue-grey underside → sunlit top
        data[p + 3] = a * 255;
      }
    }
    cbx.putImageData(cimg, 0, 0);
    cctx.clearRect(0, 0, W, H);
    cctx.imageSmoothingEnabled = true; cctx.imageSmoothingQuality = 'high';
    cctx.drawImage(cb, 0, 0, W, H);
    cloudsOn = true;
  }

  let raf = 0;
  const paint = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawSeq(); drawClouds(); }); };
  const sizeCanvases = () => {
    /* never paint more pixels than the frames hold — extra canvas size only costs fill time while scrolling */
    const maxW = { x: 2000, d: 1600, m: 1000 }[set];
    const dpr = Math.min(devicePixelRatio || 1, 1.5, maxW / Math.max(1, cv.clientWidth));
    cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientHeight * dpr);
    cl.width = Math.round(cl.clientWidth * Math.min(dpr, 1)); cl.height = Math.round(cl.clientHeight * Math.min(dpr, 1));
    paint();
  };
  sizeCanvases();
  addEventListener('resize', debounce(sizeCanvases, 150));

  /* stream frames pack by pack: coarse pass first, then fill the gaps */
  loadSequence(`hero-${set}`, FR, (i, im) => {
    imgs[i] = im; ok[i] = 1;
    if (!fw) { fw = im.naturalWidth; fh = im.naturalHeight; }
    if (Math.abs(i - view.f) < 6 || i === 0) paint();
  }, (p, f) => {
    if (p < 2) { packFrac[p] = f; prio = (packFrac[0] + packFrac[1]) / 2; }
  });

  /* loader: the porthole fills with real download progress */
  const water = $('#loaderWater'), pct = $('#loaderPct'), t0 = performance.now();
  let shown = 0, last = t0;
  const tick = () => {
    const now = performance.now(), el = now - t0, dt = Math.min(now - last, 250);
    last = now;
    let target = Math.min(prio, el / 1300);
    if (el > 9000) target = 1; // never hold visitors hostage on a slow connection
    shown += (target - shown) * (1 - Math.exp(-dt / 160)); // time-based, so throttled frames still finish on time
    if (target - shown < 0.006) shown = target;
    water.style.transform = `translateY(${((1 - shown) * 100).toFixed(2)}%)`;
    pct.textContent = Math.round(shown * 100);
    if (shown >= 1) introduce(); else setTimeout(tick, 30); // a timer, not rAF: keeps going in background tabs
  };
  setTimeout(tick, 30);

  function introduce() {
    gsap.timeline()
      .to(loader, { yPercent: -100, duration: 1.15, ease: 'power4.inOut' }, 0.15)
      .add(() => { endLoader(); if (lenis) lenis.start(); ScrollTrigger.refresh(); })
      .from(cv, { scale: 1.14, duration: 2, ease: 'power3.out' }, 0.25)
      .from('.hero .line > span', { yPercent: 115, duration: 1.15, stagger: 0.09, ease: 'power4.out' }, 0.6)
      .from('.hero [data-intro]', { y: 26, opacity: 0, filter: 'blur(8px)', duration: 0.95, stagger: 0.1, ease: 'power3.out', clearProps: 'filter' }, 0.85)
      .from('#scrollHint', { opacity: 0, duration: 0.8 }, 1.4);
  }

  /* HUD readouts */
  const hud = { brg: 0, alt: 40 };
  const brgEl = $('#brg'), altEl = $('#alt'), dial = $('#dial');
  const updHud = () => {
    const b = Math.round(hud.brg);
    brgEl.textContent = `${String(b).padStart(3, '0')}°`;
    altEl.textContent = `${String(Math.round(hud.alt)).padStart(3, '0')} m`;
    dial.style.transform = `rotate(${-b}deg)`;
  };

  /* the opening statement waits in the white the clouds dissolve into */
  const heroEnd = $('#heroEnd'), lead = $('#introLead');
  $('.wrap', heroEnd).appendChild(lead);
  $('.intro').classList.add('is-lifted');
  const leadWords = splitWords($('.statement', lead), false);

  /* the pinned scroll story */
  const story = gsap.timeline({
    defaults: { ease: 'none' },
    onUpdate: () => { paint(); updHud(); },
    scrollTrigger: {
      trigger: '#top', start: 'top top', pin: true, scrub: 0.5, anticipatePin: 1, invalidateOnRefresh: true,
      end: () => `+=${Math.round(innerHeight * (mobileSet ? 4.2 : 5.4))}`,
    },
  });
  story
    .to(view, { f: FR - 1, duration: 7 }, 0)
    .to(hud, { brg: 360, duration: 7 }, 0)
    .fromTo('#heroContent', { y: 0, opacity: 1, filter: 'blur(0px)' }, { y: -90, opacity: 0, filter: 'blur(10px)', duration: 1.1, ease: 'power1.in' }, 0)
    .to('#scrollHint', { opacity: 0, duration: 0.4 }, 0)
    .to('.hero__scrim', { opacity: 0.6, duration: 1.2 }, 0.2)
    .fromTo('#hud', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }, 0.6);
  $$('.chapter').forEach((c, i) => {
    const s = 1.3 + i * 1.85;
    story.fromTo(c, { opacity: 0, y: 50, filter: 'blur(10px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.55, ease: 'power2.out' }, s)
      .to(c, { opacity: 0, y: -40, filter: 'blur(10px)', duration: 0.5, ease: 'power2.in' }, s + 1.25);
  });
  /* the climb: clouds roll in from the edges until we see the ship through a gap (camera still),
     then we rise — the ship shrinks inside the gap while it closes — and everything turns white */
  story
    .to('.hero__scrim', { opacity: 0, duration: 0.9 }, 6.7)
    .to(sky, { gap: 0.42, duration: 1.2, ease: 'power1.inOut' }, 6.7)
    /* portrait crops are wider than the screen, so phones can slide sideways onto the ship early */
    .to(view, { px: mobileSet ? 0.85 : 0, duration: 1.2, ease: 'power1.inOut' }, 6.7)
    .to(sky, { drift: 40, duration: 3.6 }, 6.7)
    .to(hud, { alt: 800, duration: 3.3, ease: 'power1.in' }, 6.7)
    .to(view, { zoom: 0.48, rot: -0.07, px: 1, py: 1, duration: 2.2, ease: 'sine.inOut' }, 7.9)
    .to(sky, { gap: -0.55, duration: 2, ease: 'power1.in' }, 7.95)
    .to(sky, { wisp: 1, duration: 1.9, ease: 'power1.in' }, 8.05)
    .to('#hud', { opacity: 0, y: -12, duration: 0.5 }, 9.5)
    .to('#fog', { opacity: 1, duration: 0.75, ease: 'power1.in' }, 9.6)
    .set(heroEnd, { autoAlpha: 1 }, 10)
    .fromTo($('.eyebrow', lead), { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' }, 10.1)
    .to(leadWords, { opacity: 1, duration: 0.3, stagger: 0.05 }, 10.25)
    .to({}, { duration: 0.35 });

  finishMotion();

  /* ======================================================================
     Section motion
     ====================================================================== */
  function splitWords(el, wrap) {
    const out = [];
    const walk = (node) => [...node.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
          const s = document.createElement('span');
          if (wrap) { s.className = 'w'; const i = document.createElement('span'); i.textContent = part; s.appendChild(i); out.push(i); }
          else { s.className = 'sw'; s.textContent = part; out.push(s); }
          frag.appendChild(s);
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1) walk(n);
    });
    walk(el);
    return out;
  }

  function finishMotion() {
    /* headings rise out of the water line */
    $$('[data-split]').forEach((h) => {
      h.classList.add('split');
      gsap.from(splitWords(h, true), { yPercent: 115, duration: 1.1, stagger: 0.05, ease: 'power4.out', scrollTrigger: { trigger: h, start: 'top 88%', once: true } });
    });

    /* staggered reveals */
    /* once revealed, hand the element back to CSS so its hover states work */
    const settle = (el) => { el.classList.add('is-in'); gsap.set(el, { clearProps: 'opacity,transform' }); };
    ScrollTrigger.batch('[data-reveal]', {
      start: 'top 90%', once: true,
      onEnter: (els) => els.forEach((el, i) => gsap.to(el, {
        opacity: 1, y: 0, duration: 0.9, delay: i * 0.08, ease: 'power3.out', overwrite: true, onComplete: () => settle(el),
      })),
    });
    ScrollTrigger.addEventListener('refresh', () => $$('[data-reveal]:not(.is-in)').forEach((el) => {
      if (el.getBoundingClientRect().bottom < 0) settle(el);
    }));

    /* images surface through a rising water line */
    $$('[data-liquid]').forEach((el) => {
      const img = $('img', el), r = getComputedStyle(el).borderTopLeftRadius || '28px';
      gsap.timeline({
        scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        onComplete: () => { el.classList.add('is-in'); gsap.set(el, { clearProps: 'clipPath' }); gsap.set(img, { clearProps: 'transform' }); },
      })
        .fromTo(el, { clipPath: `inset(100% 0% 0% 0% round ${r})` }, { clipPath: `inset(0% 0% 0% 0% round ${r})`, duration: 1.4, ease: 'expo.out' })
        .fromTo(img, { scale: 1.3 }, { scale: 1, duration: 1.7, ease: 'expo.out' }, 0);
    });
    $$('[data-speed]').forEach((el) => {
      const s = +el.dataset.speed || 1;
      gsap.fromTo(el, { yPercent: 10 * s }, { yPercent: -10 * s, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } });
    });

    /* wave edges swell as each section flows in */
    $$('.wave').forEach((w) => gsap.fromTo(w, { scaleY: 0.3 }, {
      scaleY: 1.15, ease: 'none', scrollTrigger: { trigger: w.parentElement, start: 'top bottom', end: 'top 35%', scrub: true },
    }));

    /* counters */
    $$('[data-count]').forEach((el) => {
      const to = +el.dataset.count, o = { v: 0 };
      el.textContent = '0';
      ScrollTrigger.create({ trigger: el, start: 'top 92%', once: true, onEnter: () => gsap.to(o, { v: to, duration: 1.6, ease: 'power2.out', onUpdate: () => { el.textContent = Math.round(o.v); } }) });
    });

    /* admission steps fill like a gauge */
    const steps = $$('.step');
    gsap.matchMedia().add({ wide: '(min-width: 901px)', narrow: '(max-width: 900px)' }, (c) => {
      const wide = c.conditions.wide, prop = wide ? 'scaleX' : 'scaleY';
      gsap.fromTo('.steps__fill', { scaleX: wide ? 0 : 1, scaleY: wide ? 1 : 0 }, {
        [prop]: 1, ease: 'none',
        scrollTrigger: {
          trigger: '#steps', start: 'top 72%', end: wide ? 'bottom 60%' : 'bottom 55%', scrub: true,
          onUpdate: (self) => steps.forEach((s, i) => s.classList.toggle('is-on', self.progress >= Math.max(0.02, i / (steps.length - 1)) * 0.98)),
        },
      });
    });

    wakeSequences();
    navTracking();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ScrollTrigger.refresh());
    addEventListener('load', () => ScrollTrigger.refresh());
  }

  /* background water behind Vision and the final call to action: the ship sails forward as you
     scroll down and backs up as you scroll up — 120 frames tied to each section's scroll progress */
  function wakeSequences() {
    const res = innerWidth * Math.min(devicePixelRatio || 1, 2) >= 1700 ? 'x' : 'd';
    const N = 120;
    const imgs = new Array(N), ok = new Uint8Array(N);
    const views = $$('canvas[data-seq="wake"]').map((cv) => ({ cv, ctx: cv.getContext('2d'), box: cv.parentElement, f: 0, drawn: -1 }));
    if (!views.length) return;

    const nearestWake = (i) => {
      for (let d = 0; d < N; d++) {
        if (i - d >= 0 && ok[i - d]) return i - d;
        if (i + d < N && ok[i + d]) return i + d;
      }
      return -1;
    };
    const cache = frameCache(imgs, ok, N);
    const draw = (v) => {
      const k = nearestWake(clamp(Math.round(v.f), 0, N - 1));
      if (k < 0 || k === v.drawn) return;
      cache.around(k);
      const im = cache.get(k), iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height, W = v.cv.width, H = v.cv.height;
      const s = Math.max(W / iw, H / ih), dw = iw * s, dh = ih * s;
      v.ctx.imageSmoothingQuality = 'high';
      v.ctx.drawImage(im, (W - dw) / 2, (H - dh) / 2, dw, dh);
      v.drawn = k;
      v.box.classList.add('is-live');
    };
    const size = () => views.forEach((v) => {
      /* a dimmed backdrop: cap the canvas so each redraw stays cheap */
      const dpr = Math.min(devicePixelRatio || 1, 1.25, 1700 / Math.max(1, v.cv.clientWidth));
      v.cv.width = Math.round(v.cv.clientWidth * dpr); v.cv.height = Math.round(v.cv.clientHeight * dpr);
      v.drawn = -1; draw(v);
    });

    let started = false;
    const load = () => {
      if (started) return;
      started = true;
      /* redraw only if a new frame is now the closest one to where a view should be */
      loadSequence(`wake-${res}`, N, (i, im) => { imgs[i] = im; ok[i] = 1; views.forEach(draw); });
    };

    views.forEach((v) => {
      const sec = v.cv.closest('section');
      ScrollTrigger.create({ trigger: sec, start: 'top bottom+=900', end: 'bottom top', onToggle: load });
      const r = sec.getBoundingClientRect();
      if (r.top < innerHeight + 900 && r.bottom > 0) load();
      ScrollTrigger.create({
        trigger: sec, start: 'top bottom', end: 'bottom top',
        onUpdate: (self) => { v.f = self.progress * (N - 1); draw(v); },
      });
    });
    size();
    addEventListener('resize', debounce(size, 150));
  }

  function finishStatic() {
    if (hasGSAP) navTracking();
  }

  function navTracking() {
    const links = $$('.nav a[href^="#"]');
    links.forEach((a) => {
      const sec = $(a.getAttribute('href'));
      if (!sec) return;
      ScrollTrigger.create({
        trigger: sec, start: 'top 45%', end: 'bottom 45%',
        onToggle: (self) => { if (self.isActive) links.forEach((l) => l.classList.toggle('is-active', l === a)); else a.classList.remove('is-active'); },
      });
    });
  }
})();

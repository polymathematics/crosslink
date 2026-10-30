// crosslink solver: renders one published puzzle (see core.js for the format).
(() => {
  const X = window.Crosslink;
  const $ = (id) => document.getElementById(id);

  boot().catch((err) => {
    console.error(err);
    showEmpty("This week's crosslink didn't load. Try refreshing the page.");
  });

  async function boot() {
    // the composer's "Test solve" loads this page with ?preview and hands over an unpublished puzzle
    if (new URLSearchParams(location.search).has('preview')) {
      $('archive').hidden = true;
      $('reset').hidden = true;
      addEventListener('message', (e) => {
        if (e.data?.type !== 'crosslink-preview') return;
        const P = e.data.puzzle;
        try { localStorage.removeItem('crosslink:' + P.id); } catch (err) {}
        start(P);
      }, { once: true });
      parent.postMessage({ type: 'crosslink-preview-ready' }, '*');
      return;
    }
    const index = await fetch('puzzles/index.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : []));
    if (!index.length) { showEmpty('The first crosslink is on its way. Check back soon.'); return; }
    const wanted = decodeURIComponent(location.hash.slice(1));
    const entry = index.find((p) => p.id === wanted) || index[index.length - 1];
    const P = await fetch(`puzzles/${entry.id}.json`, { cache: 'no-cache' }).then((r) => r.json());
    buildArchive(index, entry.id);
    start(P);
  }

  function showEmpty(message) {
    $('puzzleview').hidden = true;
    $('assist').hidden = true;
    $('empty').hidden = false;
    $('empty').textContent = message;
    document.querySelector('.phead').hidden = true;
  }

  // "Past puzzles" picker in the dateline
  function buildArchive(index, currentId) {
    const pick = $('archive');
    if (index.length < 2) { pick.hidden = true; return; }
    [...index].reverse().forEach((p) => {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = `No. ${String(p.number).padStart(3, '0')}: ${p.title}`;
      o.selected = p.id === currentId;
      pick.appendChild(o);
    });
    pick.addEventListener('change', () => { location.hash = pick.value; location.reload(); });
  }

  function start(P) {
  const G = X.numberGrid(P.layout);
  const { H, W, nums, words } = G;
  const isBlock = G.block;
  const { KINDS, PLAIN } = X;
  const kindOf = (w) => (w.link && KINDS[w.link.kind]) || PLAIN;
  const KEY = 'crosslink:' + P.id;
  const SHIM_STEP = 90, SHIM_LEN = 950;
  const no = String(P.number).padStart(3, '0');
  document.title = `crosslink No. ${no}: ${P.title}`;

  const cellWords = {};
  words.forEach((w) => {
    w.clue = P.clues[w.id] || '';
    w.link = P.links[w.id] || null;
    w.color = kindOf(w).color;
    w.cells.forEach(([r, c]) => { (cellWords[r + ',' + c] ||= {})[w.dir] = w; });
  });
  const linkedTotal = words.filter((w) => w.link).length;
  // color key: only the link types this week's puzzle actually uses
  const used = [...Object.keys(KINDS).filter((k) => words.some((w) => w.link?.kind === k)).map((k) => KINDS[k]),
    ...(words.some((w) => !w.link) ? [PLAIN] : [])];
  for (const id of ['key-play', 'key-ans']) {
    const key = $(id);
    key.innerHTML = '<span class="lbl">Key</span>';
    used.forEach((k) => {
      const s = document.createElement('span');
      s.style.setProperty('--kc', k.color);
      s.innerHTML = '<i></i>';
      s.append(k.label);
      key.appendChild(s);
    });
  }
  const dirName = (w) => (w.dir === 'A' ? 'Across' : 'Down');

  // ---- state ----
  const empty = () => Array.from({ length: H }, () => Array(W).fill(''));
  let fills = empty();
  let elapsed = 0, done = false, sel = { r: 0, c: 0 }, dir = 'A';
  // purist: nothing is checked until the grid is full. fun: each answer is checked as you finish it.
  let mode = 'purist', assisted = false, wrongNote = false;
  const solved = new Set();
  try { if (['fun', 'helper'].includes(localStorage.getItem('crosslink:mode'))) mode = 'fun'; } catch (e) {}
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && Array.isArray(s.fills) && s.fills.length === H) { fills = s.fills; elapsed = s.elapsed || 0; done = !!s.done; assisted = !!s.assisted; }
  } catch (e) {}
  if (mode === 'fun' && !done) assisted = true;
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ fills, elapsed, done, assisted }));
      localStorage.setItem('crosslink:mode', mode);
      $('saved').textContent = 'Progress saved in this browser.';
    } catch (e) { $('saved').textContent = 'This browser is not saving progress (private window?).'; }
  };
  // the puzzle only carries a fingerprint of each answer; a word is right when its letters match it
  const letters = (w) => w.cells.map(([r, c]) => fills[r][c]).join('');
  const isSolved = (w) => { const s = letters(w); return s.length === w.cells.length && X.answerHash(P.id, w.id, s) === P.answers[w.id]; };
  // a word only shows as solved (locked, linked) once the current mode allows it
  const shown = (w) => solved.has(w.id) && (mode === 'fun' || done);
  const solvedCell = (r, c) => { const cw = cellWords[r + ',' + c]; return (cw.A && shown(cw.A)) || (cw.D && shown(cw.D)); };
  words.forEach((w) => isSolved(w) && solved.add(w.id));

  // ---- page text ----
  $('pnum').textContent = P.number;
  $('ptitle').textContent = P.title;
  $('pby').textContent = 'by ' + P.author;
  $('pnote').textContent = P.note;
  $('dl-no').textContent = 'No. ' + no;
  $('dl-week').textContent = P.week || X.weekLabel(P.date);

  // ---- links ----
  const openLink = (w) => {
    const a = document.createElement('a');
    a.href = w.link.url; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  };

  // ---- build grid + clue lists ----
  const grid = $('grid');
  grid.style.gridTemplateColumns = `repeat(${W}, 1fr)`;
  const cellEls = {};
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const el = document.createElement('div');
    el.className = 'cell' + (isBlock(r, c) ? ' block' : '');
    el.setAttribute('role', 'gridcell');
    if (!isBlock(r, c)) {
      const k = r + ',' + c, cw = cellWords[k];
      if (nums[k]) el.insertAdjacentHTML('beforeend', `<span class="num">${nums[k]}</span>`);
      el.insertAdjacentHTML('beforeend', '<span class="ltr"></span><span class="bar-a"></span><span class="bar-d"></span>');
      if (cw.A) el.style.setProperty('--ca', cw.A.color);
      if (cw.D) el.style.setProperty('--cd', cw.D.color);
      el.addEventListener('animationend', (e) => { if (e.target.classList.contains('ltr')) el.classList.remove('shim'); });
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        skipped = [];
        const w = curWord(), same = sel.r === r && sel.c === c;
        // a solved word in the grid is itself the hyperlink
        if (!same && shown(w) && w.link && w.cells.some(([rr, cc]) => rr === r && cc === c)) { openLink(w); return; }
        if (same) toggleDir(); else { sel = { r, c }; if (!cellWords[k][dir]) dir = dir === 'A' ? 'D' : 'A'; }
        focusKb(); render();
      });
      cellEls[k] = el;
    }
    grid.appendChild(el);
  }
  for (const d of ['A', 'D']) {
    const ol = $('list-' + d);
    words.filter((w) => w.dir === d).forEach((w) => {
      const li = document.createElement('li');
      li.id = 'clue-' + w.id;
      li.style.setProperty('--wc', w.color);
      li.innerHTML = '<span class="n"></span><span class="t"></span><span class="ans"></span>';
      li.querySelector('.n').textContent = w.num;
      li.querySelector('.t').textContent = w.clue;
      li.addEventListener('click', (e) => { if (e.target.closest('a')) return; selectWord(w); focusKb(); render(); });
      ol.appendChild(li);
    });
  }

  // ---- navigation ----
  const kb = $('kb');
  const focusKb = () => kb.focus({ preventScroll: true });
  const curWord = () => cellWords[sel.r + ',' + sel.c][dir];
  const toggleDir = () => { const o = dir === 'A' ? 'D' : 'A'; if (cellWords[sel.r + ',' + sel.c][o]) dir = o; };
  const selectWord = (w) => {
    dir = w.dir;
    const gap = w.cells.findIndex(([r, c]) => !fills[r][c]);
    const [r, c] = gap >= 0 ? w.cells[gap] : w.cells[0];
    sel = { r, c };
    // squares jumped over to reach the first empty one, in case the solver types the word from the top
    skipped = gap > 0 ? w.cells.slice(0, gap) : [];
  };
  const step = (dr, dc) => {
    let r = sel.r + dr, c = sel.c + dc;
    while (r >= 0 && c >= 0 && r < H && c < W) {
      if (!isBlock(r, c)) { sel = { r, c }; return; }
      r += dr; c += dc;
    }
  };
  // Tab walks every clue; Space stays in the current direction
  const nextWord = (delta) => { const i = words.indexOf(curWord()); selectWord(words[(i + delta + words.length) % words.length]); };
  const nextInDir = (delta) => {
    const list = words.filter((w) => w.dir === dir), i = list.indexOf(curWord());
    selectWord(list[(i + delta + list.length) % list.length]);
  };
  // Up/Down move one square in the grid, staying in the current direction when that square has one
  const moveVert = (dr) => {
    step(dr, 0);
    if (!cellWords[sel.r + ',' + sel.c][dir]) dir = dir === 'A' ? 'D' : 'A';
  };

  // Filled squares the cursor just jumped over on its way to the next empty one. If the solver
  // types those same letters next, they're typing the whole word out, so the letters confirm the
  // filled squares instead of landing in the empty one.
  let skipped = [];
  const echo = ([r, c]) => { const el = cellEls[r + ',' + c]; el.classList.remove('echo'); void el.offsetWidth; el.classList.add('echo'); };
  const type = (ch) => {
    if (done) return;
    if (skipped.length) {
      const [r, c] = skipped[0];
      if (fills[r][c] === ch) { echo(skipped.shift()); render(); return; }
      skipped = [];
    }
    const w = curWord();
    // letters of solved answers are locked
    if (!solvedCell(sel.r, sel.c)) fills[sel.r][sel.c] = ch;
    const i = w.cells.findIndex(([r, c]) => r === sel.r && c === sel.c);
    const rest = w.cells.slice(i + 1);
    const gap = rest.findIndex(([r, c]) => !fills[r][c]);
    const nxt = gap >= 0 ? rest[gap] : rest[0];
    skipped = gap > 0 ? rest.slice(0, gap) : [];
    if (nxt) sel = { r: nxt[0], c: nxt[1] };
    afterChange();
  };
  const back = () => {
    if (done) return;
    if (fills[sel.r][sel.c] && !solvedCell(sel.r, sel.c)) fills[sel.r][sel.c] = '';
    else { dir === 'A' ? step(0, -1) : step(-1, 0); if (!solvedCell(sel.r, sel.c)) fills[sel.r][sel.c] = ''; }
    afterChange();
  };

  kb.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (/^[a-z]$/i.test(k)) { e.preventDefault(); type(k.toUpperCase()); lookAtCell(); return; }
    skipped = [];
    if (k === 'Backspace' || k === 'Delete') { e.preventDefault(); back(); }
    else if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); toggleDir(); render(); }
    else if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); moveVert(k === 'ArrowUp' ? -1 : 1); render(); }
    else if (k === 'Tab') { e.preventDefault(); nextWord(e.shiftKey ? -1 : 1); render(); }
    else if (k === ' ') { e.preventDefault(); nextInDir(e.shiftKey ? -1 : 1); render(); }
    else if (k === 'Enter') { const w = curWord(); if (shown(w) && w.link) { e.preventDefault(); openLink(w); } }
    lookAtCell();
  });
  // phones send text through input events instead of keydown
  kb.addEventListener('input', () => {
    const v = kb.value.replace(/[^a-z]/gi, '');
    kb.value = '';
    for (const ch of v) type(ch.toUpperCase());
    lookAtCell();
  });

  // ---- solving ----
  let toastT;
  const toast = (w) => {
    const t = $('toast');
    t.style.setProperty('--wc', w.color);
    t.innerHTML = '<span class="sq"></span><b></b><span></span>';
    t.querySelector('b').textContent = letters(w);
    t.querySelector('span:last-child').textContent = w.link ? `is now a link to ${w.link.title}` : 'solved';
    t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800);
  };
  const shimmerCell = (r, c, delay, color, settle) => {
    const el = cellEls[r + ',' + c];
    el.style.setProperty('--d', delay + 'ms');
    el.style.setProperty('--bd', settle + 'ms');
    el.style.setProperty('--lc', color);
    el.classList.remove('shim'); void el.offsetWidth; el.classList.add('shim');
  };
  // fun mode: letters of each newly solved word shimmer in order
  const revealWords = (ws) => {
    let settle = 0;
    ws.forEach((w) => {
      const s = w.cells.length * SHIM_STEP + SHIM_LEN * .6;
      w.cells.forEach(([r, c], i) => shimmerCell(r, c, i * SHIM_STEP, w.color, s));
      settle = Math.max(settle, s);
    });
    return settle;
  };
  // purist finish: one wave sweeps the whole grid from the top-left corner
  const revealAll = () => {
    const settle = (H + W) * 70 + SHIM_LEN * .6;
    for (const k in cellEls) {
      const [r, c] = k.split(',').map(Number), cw = cellWords[k];
      shimmerCell(r, c, (r + c) * 70, (cw.A || cw.D).color, settle);
    }
    return settle;
  };
  const finish = (settle) => { done = true; setTimeout(openSheet, settle + 400); };
  const nudge = () => {
    for (const el of [$('grid'), $('assist')]) { el.classList.remove('nudge'); void el.offsetWidth; el.classList.add('nudge'); }
  };
  const afterChange = () => {
    const before = new Set(solved);
    words.forEach((w) => (isSolved(w) ? solved.add(w.id) : solved.delete(w.id)));
    wrongNote = false;
    if (!done && mode === 'fun') {
      const fresh = words.filter((w) => solved.has(w.id) && !before.has(w.id));
      const settle = revealWords(fresh);
      const first = fresh.find((w) => w.link) || fresh[0];
      if (first && fresh.length <= 2) setTimeout(() => toast(first), settle);
      if (solved.size === words.length) finish(settle);
    } else if (!done && fills.every((row, r) => row.every((ch, c) => isBlock(r, c) || ch))) {
      // purist: the grid is full, so check it all at once
      if (solved.size === words.length) finish(revealAll());
      else { wrongNote = true; nudge(); }
    }
    save(); render();
  };
  const setMode = (m) => {
    if (m === mode || done) return;
    mode = m;
    if (mode === 'fun') {
      assisted = true;
      const settle = revealWords(words.filter((w) => solved.has(w.id)));
      if (solved.size === words.length) finish(settle);
    } else if (fills.every((row) => row.every((ch) => !ch))) {
      // nothing typed with help yet, so this is still a clean purist solve
      assisted = false;
    }
    wrongNote = false;
    save(); render(); focusKb();
  };
  $('mode-btn').addEventListener('click', () => setMode(mode === 'purist' ? 'fun' : 'purist'));

  // ---- the cartoon cast ----
  // each visit draws one character per mode: old man or middle-aged woman, boy or girl
  const CAST = { purist: Math.random() < .5 ? 'a' : 'b', fun: Math.random() < .5 ? 'a' : 'b' };
  // eyes follow the cursor, watch the square being typed in, and look up at the bubble when idle
  let lookAt = null, lookQueued = false;
  const look = () => {
    const svg = document.querySelector('.gramps:not([hidden])');
    const m = svg && svg.getScreenCTM();
    if (!m) return;
    let tx, ty;
    if (lookAt) ({ x: tx, y: ty } = lookAt);
    else { const b = $('bubble').getBoundingClientRect(); tx = b.left + b.width / 2; ty = b.top; }
    svg.querySelectorAll('.pupil').forEach((p) => {
      const bx = +p.dataset.x, by = +p.dataset.y, max = +p.dataset.max;
      const vx = tx - (m.a * bx + m.e), vy = ty - (m.d * by + m.f), d = Math.hypot(vx, vy) || 1;
      const k = (max * Math.min(1, d / 120)) / d;
      p.setAttribute('transform', `translate(${(vx * k).toFixed(2)} ${(vy * k).toFixed(2)})`);
    });
  };
  const queueLook = () => {
    if (lookQueued) return;
    lookQueued = true;
    requestAnimationFrame(() => { lookQueued = false; look(); });
  };
  const lookAtCell = () => {
    const el = cellEls[sel.r + ',' + sel.c];
    if (!el) return;
    const r = el.getBoundingClientRect();
    lookAt = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    queueLook();
  };
  addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { lookAt = { x: e.clientX, y: e.clientY }; queueLook(); } });
  document.documentElement.addEventListener('mouseleave', () => { lookAt = null; queueLook(); });
  addEventListener('scroll', queueLook, { passive: true });
  addEventListener('resize', queueLook);
  const renderBubble = () => {
    const say = $('bubble-say'), btn = $('mode-btn'), cap = $('mode-cap');
    // the old man keeps purists company; the kid shows up in fun mode
    const kid = done ? assisted : mode === 'fun';
    // SVG elements have no .hidden property, so set the attribute directly
    const showing = `char-${kid ? 'fun' : 'purist'}-${kid ? CAST.fun : CAST.purist}`;
    document.querySelectorAll('.gramps').forEach((svg) => svg.toggleAttribute('hidden', svg.id !== showing));
    queueLook();
    btn.hidden = done;
    if (done) say.textContent = kid ? 'We did it! Now go follow some of those links.' : 'No help at all? Well, I never. Go follow those links!';
    else if (wrongNote) { say.textContent = "Hmm, something's not right yet. Need a hand?"; btn.textContent = 'Switch out of purist mode!'; }
    else if (mode === 'purist') { say.textContent = 'Need a hand?'; btn.textContent = 'Switch out of purist mode!'; }
    else { say.textContent = "Now you're on a roll,"; btn.textContent = 'switch to purist mode?'; }
    cap.innerHTML = mode === 'purist'
      ? '<b>Purist mode</b><br>Answers are checked when the whole grid is full.'
      : '<b>Fun mode</b><br>Each answer is checked as soon as you finish it.';
  };

  // ---- render ----
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const renderLinkRow = (w) => {
    const lr = $('linkrow');
    lr.style.setProperty('--wc', w.color);
    const live = shown(w) && !!w.link;
    lr.classList.toggle('live', live);
    lr.innerHTML = '<span class="badge"></span>';
    const msg = document.createElement('span');
    if (!shown(w)) {
      lr.firstChild.textContent = '?';
      msg.textContent = mode === 'purist' ? 'Links unlock once the whole grid is correct.' : `Solve ${w.num} ${dirName(w)} to unlock its link.`;
      lr.append(msg); return;
    }
    lr.firstChild.textContent = letters(w)[0];
    if (!w.link) { msg.textContent = `${letters(w)} has no link this week.`; lr.append(msg); return; }
    const a = document.createElement('a');
    a.href = w.link.url; a.target = '_blank'; a.rel = 'noopener';
    a.innerHTML = '<b></b><span></span>';
    a.querySelector('b').textContent = w.link.title + ' ↗';
    a.querySelector('span').textContent = w.link.site;
    const kind = document.createElement('span');
    kind.className = 'kind'; kind.textContent = w.link.kind;
    lr.append(a, kind);
  };
  const render = () => {
    const w = curWord();
    const inW = new Set(w.cells.map(([r, c]) => r + ',' + c));
    const goable = shown(w) && !!w.link;
    for (const k in cellEls) {
      const el = cellEls[k], [r, c] = k.split(',').map(Number), cw = cellWords[k];
      const sa = !!(cw.A && shown(cw.A)), sd = !!(cw.D && shown(cw.D));
      el.querySelector('.ltr').textContent = fills[r][c];
      el.classList.toggle('sel', r === sel.r && c === sel.c);
      el.classList.toggle('inword', inW.has(k));
      el.classList.toggle('sa', sa);
      el.classList.toggle('sd', sd);
      el.classList.toggle('linked', sa || sd);
      el.classList.toggle('go', goable && inW.has(k) && !(r === sel.r && c === sel.c));
      if (!el.classList.contains('shim') && (sa || sd)) el.style.setProperty('--lc', (sa ? cw.A : cw.D).color);
      el.title = goable && inW.has(k) ? `Open ${w.link.title}` : '';
    }
    $('cb-tag').textContent = w.num + w.dir;
    $('cb-txt').textContent = w.clue;
    renderLinkRow(w);
    const cross = cellWords[sel.r + ',' + sel.c][dir === 'A' ? 'D' : 'A'];
    words.forEach((x) => {
      const li = $('clue-' + x.id), a = li.querySelector('.ans');
      li.classList.toggle('cur', x === w);
      li.classList.toggle('cross', x === cross);
      if (!shown(x)) { a.innerHTML = ''; return; }
      if (x.link) {
        if (!a.querySelector('a')) { a.innerHTML = `<a href="${x.link.url}" target="_blank" rel="noopener"></a>`; a.firstChild.textContent = letters(x) + ' ↗'; }
      } else if (!a.querySelector('.plain')) { a.innerHTML = '<span class="plain"></span>'; a.firstChild.textContent = letters(x); }
    });
    $('linked').textContent = `${words.filter((x) => x.link && shown(x)).length}/${linkedTotal}`;
    renderBubble();
    $('time').textContent = fmt(elapsed);
    $('v-answers').disabled = !done;
    $('v-answers').title = done ? '' : 'Unlocks when the grid is complete';
  };

  // ---- answers view ----
  const buildAnswers = () => {
    const lex = $('lex'); lex.innerHTML = '';
    words.filter((w) => w.link).forEach((w) => {
      const a = document.createElement('a');
      a.className = 'card'; a.href = w.link.url; a.target = '_blank'; a.rel = 'noopener';
      a.style.setProperty('--wc', w.color);
      a.innerHTML = `<div class="top"><span class="disc"></span><div><div class="word"></div><div class="where"></div></div></div>
        <div class="clue"></div><div class="preview"><b></b><p></p></div>
        <div class="foot"><span class="site"></span><span class="kind"></span></div>`;
      a.querySelector('.disc').textContent = letters(w)[0];
      a.querySelector('.word').textContent = letters(w);
      a.querySelector('.where').textContent = `${w.num} ${dirName(w)}`;
      a.querySelector('.clue').textContent = w.clue;
      a.querySelector('.preview b').textContent = w.link.title + ' ↗';
      a.querySelector('.preview p').textContent = w.link.blurb;
      a.querySelector('.site').textContent = w.link.site;
      a.querySelector('.kind').textContent = w.link.kind;
      lex.appendChild(a);
    });
    const plain = words.filter((w) => !w.link), pf = $('plainfill');
    pf.innerHTML = plain.length ? '<span class="lbl">Plain fill, no link</span>' : '';
    plain.forEach((w) => {
      const s = document.createElement('span');
      s.innerHTML = '<strong></strong>';
      s.firstChild.textContent = letters(w);
      s.append(w.clue);
      pf.appendChild(s);
    });
    $('ans-sub').textContent = `${P.title}, No. ${no}. Solved in ${fmt(elapsed)}. ${linkedTotal} links to explore this week, in grid order.`;
  };
  const show = (view) => {
    const ans = view === 'answers';
    if (ans) buildAnswers();
    $('puzzleview').hidden = ans; $('answersview').hidden = !ans;
    $('v-puzzle').setAttribute('aria-pressed', String(!ans));
    $('v-answers').setAttribute('aria-pressed', String(ans));
  };
  $('v-puzzle').addEventListener('click', () => { show('puzzle'); focusKb(); });
  $('v-answers').addEventListener('click', () => show('answers'));

  // ---- solved sheet + Kid Pix stamps ----
  const openSheet = () => {
    $('sheet-h').textContent = `Solved in ${fmt(elapsed)}`;
    $('sheet-p').textContent = `${assisted ? 'Solved in fun mode.' : 'A purist solve, no help.'} All ${words.length} answers are in, and ${linkedTotal} of them are now links. Take your time with them this week.`;
    $('sheet').classList.add('open');
    stamps();
  };
  const closeSheet = () => $('sheet').classList.remove('open');
  $('sheet-close').addEventListener('click', () => { closeSheet(); focusKb(); });
  $('sheet-go').addEventListener('click', () => { closeSheet(); show('answers'); });

  function stamps() {
    const cv = $('confetti'), ctx = cv.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    const cols = ['--c-orange', '--c-pink', '--cursor', '--c-green', '--c-violet', '--page'].map((v) => css.getPropertyValue(v).trim());
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // stamps fall and stick where they land, like Kid Pix stamps on a canvas
    const bits = Array.from({ length: 44 }, (_, i) => ({
      x: Math.random() * cv.width, ty: 10 + Math.random() * (cv.height - 20), y: still ? 0 : -40 - Math.random() * 260,
      vy: 4 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - .5) * .2,
      s: 12 + Math.random() * 18, kind: i % 4, col: cols[i % cols.length],
    }));
    if (still) bits.forEach((b) => (b.y = b.ty));
    const star = (s) => { ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5, rr = i % 2 ? s * .45 : s; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); ctx.stroke(); };
    const splat = (s) => { ctx.beginPath(); for (let i = 0; i < 14; i++) { const a = i * Math.PI / 7, rr = s * (i % 2 ? .55 : .9 + ((i * 7) % 3) * .12); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); ctx.stroke(); };
    const squig = (s) => { ctx.beginPath(); ctx.moveTo(-s, 0); for (let i = 0; i <= 8; i++) ctx.lineTo(-s + i * s / 4, i % 2 ? -s / 3 : s / 3); ctx.lineWidth = 5; ctx.strokeStyle = ctx.fillStyle; ctx.stroke(); };
    const check = (s) => { ctx.fillRect(-s / 2, -s / 2, s, s); ctx.strokeRect(-s / 2, -s / 2, s, s); ctx.fillStyle = '#0b0b0b'; ctx.fillRect(-s / 2, -s / 2, s / 2, s / 2); ctx.fillRect(0, 0, s / 2, s / 2); };
    const draw = () => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      bits.forEach((b) => {
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot);
        ctx.fillStyle = b.col; ctx.strokeStyle = '#0b0b0b'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
        [star, splat, squig, check][b.kind](b.s);
        ctx.restore();
        if (b.y < b.ty) { b.y = Math.min(b.ty, b.y + b.vy); b.rot += b.vr; }
      });
      ctx.font = '900 64px Doto, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 8; ctx.strokeStyle = '#0b0b0b'; ctx.strokeText('SOLVED', cv.width / 2, cv.height / 2);
      ctx.fillStyle = '#ffffff'; ctx.fillText('SOLVED', cv.width / 2, cv.height / 2);
      if (bits.some((b) => b.y < b.ty)) requestAnimationFrame(draw);
    };
    draw();
  }

  // ---- timer ----
  setInterval(() => {
    if (done || document.hidden) return;
    elapsed++; $('time').textContent = fmt(elapsed);
    if (elapsed % 5 === 0) save();
  }, 1000);

  // ---- mockup controls ----
  // starting over wipes this week's progress, so it takes a second click
  let resetArmed;
  $('reset').addEventListener('click', () => {
    if (!resetArmed) {
      $('reset').textContent = 'Click again to clear your letters';
      resetArmed = setTimeout(() => { resetArmed = null; $('reset').textContent = 'Start over'; }, 4000);
      return;
    }
    clearTimeout(resetArmed); resetArmed = null; $('reset').textContent = 'Start over';
    fills = empty();
    elapsed = 0; done = false; wrongNote = false; assisted = mode === 'fun';
    solved.clear(); closeSheet(); show('puzzle');
    selectWord(words[0]); save(); render(); focusKb();
  });

  selectWord(words[0]);
  render();
  }
})();

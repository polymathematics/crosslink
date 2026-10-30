// Crosslink Composer: build a grid, write clues, attach links, publish.
// Drafts autosave through the bridge (bridge.js); publishing turns a draft into the site's
// format with Crosslink.publishable (core.js) and hands it to the app to commit and push.
(() => {
  'use strict';
  const X = window.Crosslink;
  const $ = (id) => document.getElementById(id);

  let draft = null;          // the puzzle being edited
  let savedId = null;        // id the draft was last saved under (it follows the date)
  let G = null;              // numbering of the current grid
  let cellWords = {};        // "r,c" -> { A: word, D: word }
  let structure = '';        // which entries exist; the list is rebuilt when this changes
  let sel = { r: 0, c: 0 }, dir = 'A';
  let saveTimer = null, saving = Promise.resolve();
  let repo = { path: '', site: '' };

  // ---------- helpers ----------
  const H = () => draft.grid.length;
  const W = () => draft.grid[0].length;
  const isBlock = (r, c) => draft.grid[r][c] === '#';
  const letterAt = (r, c) => (isBlock(r, c) || draft.grid[r][c] === ' ' ? '' : draft.grid[r][c]);
  const setCell = (r, c, ch) => { const row = draft.grid[r]; draft.grid[r] = row.slice(0, c) + ch + row.slice(c + 1); };
  const entry = (w) => (draft.entries[X.entryKey(w)] ||= { clue: '', link: null });
  const curWord = () => (cellWords[sel.r + ',' + sel.c] || {})[dir];
  const fmtNo = (n) => String(n || 0).padStart(3, '0');
  const today = () => new Date().toISOString().slice(0, 10);
  const nextMonday = () => {
    const d = new Date(); d.setHours(12);
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    return d.toISOString().slice(0, 10);
  };
  const blankGrid = (w, h) => Array.from({ length: h }, () => ' '.repeat(w));

  function setStatus(text, warn) {
    const s = $('status');
    s.textContent = text;
    s.classList.toggle('warn', !!warn);
  }

  // drafts from older versions keyed clues by number; move them to start-square keys
  function normalize(d) {
    d.entries ||= {};
    if (d.clues || d.links) {
      X.numberGrid(d.grid).words.forEach((w) => {
        d.entries[X.entryKey(w)] ||= { clue: (d.clues || {})[w.id] || '', link: (d.links || {})[w.id] || null };
      });
      delete d.clues; delete d.links;
    }
    if (d.symmetry === undefined) d.symmetry = true;
    d.date ||= d.id;
    return d;
  }

  // ---------- load / new / save ----------
  async function refreshList() {
    const res = await Bridge.call('list');
    repo = res.repo || repo;
    return res;
  }

  async function newPuzzle() {
    await flushSave();
    const { drafts = [], published = [] } = await refreshList();
    const all = [...drafts, ...published];
    const number = all.reduce((m, p) => Math.max(m, +p.number || 0), 0) + 1;
    let date = nextMonday();
    while (all.some((p) => p.id === date)) { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + 7); date = d.toISOString().slice(0, 10); }
    const last = drafts[drafts.length - 1];
    draft = normalize({ id: date, date, number, title: '', author: (last && last.author) || '', note: '', grid: blankGrid(15, 15), symmetry: true, entries: {} });
    savedId = null;
    loadIntoUI();
    await save();
    $('f-title').focus();
  }

  async function openPuzzle(id) {
    await flushSave();
    const d = await Bridge.call('load', { id });
    if (!d) { setStatus(`Couldn't open ${id}.`, true); return; }
    draft = normalize(d);
    savedId = draft.id;
    loadIntoUI();
    setStatus('Opened');
  }

  function markDirty() {
    setStatus('Edited');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 700);
  }
  function save() {
    clearTimeout(saveTimer); saveTimer = null;
    if (!draft) return saving;
    const snapshot = JSON.parse(JSON.stringify(draft));
    const previousId = savedId;
    saving = saving.then(async () => {
      try {
        await Bridge.call('save', { draft: snapshot, previousId });
        savedId = snapshot.id;
        setStatus('Saved ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
      } catch (e) {
        setStatus('Not saved: ' + (e.message || e), true);
      }
    });
    return saving;
  }
  const flushSave = () => (saveTimer ? save() : saving);

  // ---------- metadata ----------
  function loadIntoUI() {
    $('f-number').value = draft.number || '';
    $('f-title').value = draft.title || '';
    $('f-author').value = draft.author || '';
    $('f-date').value = draft.date || '';
    $('f-note').value = draft.note || '';
    $('f-w').value = W(); $('f-h').value = H();
    $('f-sym').checked = !!draft.symmetry;
    sel = { r: 0, c: 0 }; dir = 'A';
    structure = '';
    buildGrid();
    update();
    // start the cursor on the first entry rather than a black square
    if (G.words.length) { const [r, c] = G.words[0].cells[0]; sel = { r, c }; dir = G.words[0].dir; update(); }
  }
  const bindMeta = (id, key, parse = (v) => v) => $(id).addEventListener('input', (e) => {
    draft[key] = parse(e.target.value);
    // the puzzle's id follows its date, so drafts and published files are named by week
    if (key === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(draft.date)) draft.id = draft.date;
    markDirty();
  });
  bindMeta('f-number', 'number', (v) => (v ? Math.max(1, Math.round(+v)) : ''));
  bindMeta('f-title', 'title');
  bindMeta('f-author', 'author');
  bindMeta('f-date', 'date');
  bindMeta('f-note', 'note');
  $('f-sym').addEventListener('change', (e) => { draft.symmetry = e.target.checked; markDirty(); });

  // ---------- grid ----------
  const gridEl = $('grid'), gkb = $('gkb');
  const focusGrid = () => gkb.focus({ preventScroll: true });
  let cellEls = {};
  function buildGrid() {
    gridEl.innerHTML = '';
    cellEls = {};
    gridEl.style.gridTemplateColumns = `repeat(${W()}, 1fr)`;
    for (let r = 0; r < H(); r++) for (let c = 0; c < W(); c++) {
      const el = document.createElement('div');
      el.className = 'cell';
      el.innerHTML = '<span class="num"></span><span class="ltr"></span>';
      el.addEventListener('mousedown', (e) => onCellDown(e, r, c));
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      gridEl.appendChild(el);
      cellEls[r + ',' + c] = el;
    }
    sizeCells();
  }
  const sizeCells = () => gridEl.style.setProperty('--cell', gridEl.clientWidth / W() + 'px');
  new ResizeObserver(sizeCells).observe(gridEl);

  function onCellDown(e, r, c) {
    e.preventDefault();
    focusGrid();
    if (e.metaKey || e.ctrlKey || e.button === 2) { sel = { r, c }; toggleBlock(r, c); return; }
    if (sel.r === r && sel.c === c) flipDir();
    else { sel = { r, c }; fixDir(); }
    update();
  }
  const flipDir = () => { const o = dir === 'A' ? 'D' : 'A'; if ((cellWords[sel.r + ',' + sel.c] || {})[o]) dir = o; };
  const fixDir = () => { const cw = cellWords[sel.r + ',' + sel.c] || {}; if (!cw[dir] && cw[dir === 'A' ? 'D' : 'A']) dir = dir === 'A' ? 'D' : 'A'; };

  function toggleBlock(r, c) {
    const makeBlock = !isBlock(r, c);
    const spots = [[r, c]];
    if (draft.symmetry) spots.push([H() - 1 - r, W() - 1 - c]);
    spots.forEach(([rr, cc]) => setCell(rr, cc, makeBlock ? '#' : ' '));
    markDirty(); update(); fixDir(); update();
  }

  function move(dr, dc) {
    const r = sel.r + dr, c = sel.c + dc;
    if (r < 0 || c < 0 || r >= H() || c >= W()) return;
    sel = { r, c };
  }
  function advance(delta) {
    const w = curWord();
    if (w) {
      const i = w.cells.findIndex(([r, c]) => r === sel.r && c === sel.c) + delta;
      if (i >= 0 && i < w.cells.length) { sel = { r: w.cells[i][0], c: w.cells[i][1] }; return; }
      if (delta > 0) return;
    }
    dir === 'A' ? move(0, delta) : move(delta, 0);
  }
  function nextEntry(delta) {
    const words = G.words;
    if (!words.length) return;
    const i = Math.max(0, words.indexOf(curWord()));
    const w = words[(i + delta + words.length) % words.length];
    dir = w.dir;
    const [r, c] = w.cells.find(([r, c]) => !letterAt(r, c)) || w.cells[0];
    sel = { r, c };
  }

  function typeLetter(ch) {
    if (isBlock(sel.r, sel.c)) toggleBlock(sel.r, sel.c);
    setCell(sel.r, sel.c, ch.toUpperCase());
    markDirty(); update(); advance(1);
  }
  function blockHere() { toggleBlock(sel.r, sel.c); dir === 'A' ? move(0, 1) : move(1, 0); }
  // text that arrives without a usable keydown (dictation, input methods) still lands in the grid
  gkb.addEventListener('input', () => {
    const v = gkb.value; gkb.value = '';
    for (const ch of v) { if (/[a-z]/i.test(ch)) typeLetter(ch); else if (ch === '.' || ch === '#') blockHere(); }
    update();
  });
  gkb.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    let handled = true;
    if (/^[a-z]$/i.test(k)) typeLetter(k);
    else if (k === '.' || k === '#') blockHere();
    else if (k === 'Backspace') {
      if (letterAt(sel.r, sel.c)) setCell(sel.r, sel.c, ' ');
      else { advance(-1); if (!isBlock(sel.r, sel.c)) setCell(sel.r, sel.c, ' '); }
      markDirty();
    } else if (k === 'Delete') {
      if (!isBlock(sel.r, sel.c)) { setCell(sel.r, sel.c, ' '); markDirty(); }
    } else if (k.startsWith('Arrow')) {
      const axis = k === 'ArrowLeft' || k === 'ArrowRight' ? 'A' : 'D';
      const delta = k === 'ArrowLeft' || k === 'ArrowUp' ? -1 : 1;
      axis === 'A' ? move(0, delta) : move(delta, 0);
      if ((cellWords[sel.r + ',' + sel.c] || {})[axis]) dir = axis;
    } else if (k === ' ') flipDir();
    else if (k === 'Tab') nextEntry(e.shiftKey ? -1 : 1);
    else if (k === 'Enter') { const w = curWord(); if (w) { const ta = document.querySelector(`[data-key="${X.entryKey(w)}"] .clue`); ta && ta.focus(); } }
    else handled = false;
    if (handled) { e.preventDefault(); update(); }
  });

  $('b-resize').addEventListener('click', () => {
    const w = Math.min(25, Math.max(3, +$('f-w').value || 15)), h = Math.min(25, Math.max(3, +$('f-h').value || 15));
    if (w === W() && h === H()) return;
    draft.grid = Array.from({ length: h }, (_, r) => Array.from({ length: w }, (_, c) => (draft.grid[r] && draft.grid[r][c]) || ' ').join(''));
    sel = { r: 0, c: 0 };
    markDirty(); buildGrid(); update();
  });
  $('b-clear').addEventListener('click', () => confirmSheet('Clear every letter?', 'Black squares, clues and links stay. Only the letters are removed.', 'Clear letters', () => {
    draft.grid = draft.grid.map((row) => row.replace(/[^#]/g, ' '));
    markDirty(); update();
  }));

  // ---------- render ----------
  function update() {
    if (!draft) return;
    G = X.numberGrid(draft.grid);
    cellWords = {};
    G.words.forEach((w) => w.cells.forEach(([r, c]) => { (cellWords[r + ',' + c] ||= {})[w.dir] = w; }));
    if (sel.r >= H() || sel.c >= W()) sel = { r: 0, c: 0 };
    const w = curWord();
    const inW = new Set(w ? w.cells.map(([r, c]) => r + ',' + c) : []);
    let blocks = 0;
    for (let r = 0; r < H(); r++) for (let c = 0; c < W(); c++) {
      const el = cellEls[r + ',' + c], b = isBlock(r, c), k = r + ',' + c, cw = cellWords[k] || {};
      if (b) blocks++;
      el.classList.toggle('block', b);
      el.classList.toggle('sel', r === sel.r && c === sel.c);
      el.classList.toggle('inword', !b && inW.has(k));
      // a white square that isn't part of any 2+ letter entry can't be clued
      el.classList.toggle('short', !b && !cw.A && !cw.D);
      el.querySelector('.num').textContent = G.nums[k] || '';
      el.querySelector('.ltr').textContent = b ? '' : letterAt(r, c);
    }
    $('gridstats').textContent = `${W()}×${H()} · ${G.words.length} entries · ${blocks} black`;
    renderEntries(w);
  }

  // ---------- entries ----------
  const kindOptions = Object.entries(X.KINDS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  function renderEntries(cur) {
    const sig = G.words.map((w) => w.id + ':' + X.entryKey(w)).join('|');
    if (sig !== structure) { structure = sig; buildEntries(); }
    let clued = 0, linked = 0;
    G.words.forEach((w) => {
      const e = entry(w), li = document.querySelector(`[data-key="${X.entryKey(w)}"]`);
      if (e.clue.trim()) clued++;
      if (e.link && e.link.url) linked++;
      li.classList.toggle('cur', w === cur);
      li.querySelector('.pat').innerHTML = w.cells.map(([r, c]) => letterAt(r, c) || '<span class="gap">·</span>').join('');
      fillChip(li, w);
    });
    $('c-clues').textContent = `${clued}/${G.words.length}`;
    $('c-links').textContent = `${linked}/${G.words.length}`;
  }
  function fillChip(li, w) {
    const l = entry(w).link, chip = li.querySelector('.chip');
    const has = l && l.url;
    chip.classList.toggle('none', !has);
    chip.style.setProperty('--kc', has ? X.KINDS[l.kind || 'site'].color : '');
    chip.textContent = has ? `${X.KINDS[l.kind || 'site'].label} · ${l.title || l.url}` : 'No link';
  }

  function buildEntries() {
    for (const d of ['A', 'D']) {
      const ol = $('list-' + d);
      ol.innerHTML = '';
      G.words.filter((w) => w.dir === d).forEach((w) => ol.appendChild(entryItem(w)));
    }
    // clue boxes can only measure their text once they're on the page
    document.querySelectorAll('.ent .clue').forEach(autoGrow);
  }

  function entryItem(w) {
    const e = entry(w);
    const li = document.createElement('li');
    li.className = 'ent';
    li.dataset.key = X.entryKey(w);
    li.innerHTML = `
      <div class="ent-top"><span class="n">${w.num}${w.dir}</span><span class="pat"></span><span class="chip"></span></div>
      <textarea class="clue" rows="1" placeholder="Write a clue"></textarea>
      <div class="linkbox">
        <div class="lbl"><span>Link</span><span class="fetching" hidden>Fetching preview…</span><button type="button" class="refetch">Refresh preview</button></div>
        <div class="row"><input class="url" type="url" placeholder="Paste a link (optional)" spellcheck="false"></div>
        <div class="row"><select class="kind-sel" aria-label="Link type">${kindOptions}</select><input class="ltitle" placeholder="Link title"></div>
        <div class="row"><input class="lsite" placeholder="Site name"></div>
        <textarea class="blurb" rows="2" placeholder="One line on why it's worth the click"></textarea>
        <div class="preview-slot"></div>
      </div>`;
    const q = (s) => li.querySelector(s);
    const clue = q('.clue'), url = q('.url'), kind = q('.kind-sel'), title = q('.ltitle'), site = q('.lsite'), blurb = q('.blurb');
    clue.value = e.clue || '';
    const l = e.link || {};
    url.value = l.url || ''; kind.value = l.kind || 'site'; title.value = l.title || ''; site.value = l.site || ''; blurb.value = l.blurb || '';
    kind.style.setProperty('--kc', X.KINDS[kind.value].color);

    // focusing anything in an entry selects that entry in the grid
    li.addEventListener('focusin', () => {
      const cur = curWord();
      if (cur && X.entryKey(cur) === li.dataset.key) return;
      const now = G.words.find((x) => X.entryKey(x) === li.dataset.key);
      if (!now) return;
      dir = now.dir; sel = { r: now.cells[0][0], c: now.cells[0][1] };
      update();
    });
    li.addEventListener('mousedown', (ev) => { if (ev.target === li || ev.target.closest('.ent-top')) { ev.preventDefault(); clue.focus(); } });

    clue.addEventListener('input', () => { entry(w).clue = clue.value; autoGrow(clue); markDirty(); });
    clue.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); url.focus(); }
      if (ev.key === 'Escape') { ev.preventDefault(); focusGrid(); }
    });

    const link = () => (entry(w).link ||= { url: '', kind: 'site', title: '', site: '', blurb: '' });
    const syncPreview = () => { fillChip(li, w); renderPreviewCard(li, w); };
    url.addEventListener('input', () => {
      const L = link();
      L.url = url.value.trim();
      if (!L.kindManual && L.url) { L.kind = X.guessKind(L.url); kind.value = L.kind; kind.style.setProperty('--kc', X.KINDS[L.kind].color); }
      if (!L.url) entry(w).link = null;
      markDirty(); syncPreview();
    });
    url.addEventListener('change', () => { if (url.value.trim() && !title.value) fetchPreview(li, w, false); });
    url.addEventListener('paste', () => setTimeout(() => { if (url.value.trim()) fetchPreview(li, w, false); }, 0));
    q('.refetch').addEventListener('click', () => { if (url.value.trim()) fetchPreview(li, w, true); });
    kind.addEventListener('change', () => { const L = link(); L.kind = kind.value; L.kindManual = true; kind.style.setProperty('--kc', X.KINDS[L.kind].color); markDirty(); syncPreview(); });
    for (const [el, key] of [[title, 'title'], [site, 'site'], [blurb, 'blurb']]) {
      el.addEventListener('input', () => { link()[key] = el.value; markDirty(); syncPreview(); });
    }
    renderPreviewCard(li, w);
    return li;
  }

  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }

  // the same card solvers see in the recap
  function renderPreviewCard(li, w) {
    const slot = li.querySelector('.preview-slot'), l = entry(w).link;
    slot.innerHTML = '';
    if (!l || !l.url) return;
    const k = X.KINDS[l.kind || 'site'];
    const ans = w.cells.map(([r, c]) => letterAt(r, c) || '·').join('');
    const card = document.createElement('a');
    card.className = 'card'; card.href = l.url;
    card.style.setProperty('--wc', k.color);
    card.innerHTML = `<div class="top"><span class="disc"></span><div><div class="word"></div><div class="where"></div></div></div>
      <div class="clue"></div><div class="preview"><b></b><p></p></div><div class="foot"><span class="site"></span><span class="kind"></span></div>`;
    card.querySelector('.disc').textContent = ans[0];
    card.querySelector('.word').textContent = ans;
    card.querySelector('.where').textContent = `${w.num} ${w.dir === 'A' ? 'Across' : 'Down'} · preview`;
    card.querySelector('.clue').textContent = entry(w).clue || 'No clue yet';
    card.querySelector('.preview b').textContent = (l.title || l.url) + ' ↗';
    card.querySelector('.preview p').textContent = l.blurb || '';
    card.querySelector('.site').textContent = l.site || '';
    card.querySelector('.kind').textContent = k.label;
    card.addEventListener('click', (ev) => { ev.preventDefault(); Bridge.call('open', { url: l.url }); });
    slot.appendChild(card);
  }

  async function fetchPreview(li, w, overwrite) {
    const L = entry(w).link;
    if (!L || !L.url) return;
    const busy = li.querySelector('.fetching');
    busy.hidden = false;
    try {
      const p = await Bridge.call('preview', { url: L.url });
      const put = (key, val, sel) => {
        if (!val || (L[key] && !overwrite)) return;
        L[key] = val; li.querySelector(sel).value = val;
      };
      put('title', p.title, '.ltitle');
      put('site', p.siteName, '.lsite');
      put('blurb', p.description, '.blurb');
      markDirty(); fillChip(li, w); renderPreviewCard(li, w);
      busy.hidden = true;
    } catch (e) {
      busy.textContent = "Couldn't fetch a preview. Fill it in by hand.";
      setTimeout(() => { busy.hidden = true; busy.textContent = 'Fetching preview…'; }, 3500);
    }
  }

  // ---------- open menu ----------
  const pop = $('open-pop');
  $('b-open').addEventListener('click', async () => {
    if (!pop.hidden) { pop.hidden = true; return; }
    const { drafts = [], published = [] } = await refreshList();
    const pubIds = new Set(published.map((p) => p.id));
    pop.innerHTML = '';
    const section = (label, items) => {
      const h = document.createElement('h4'); h.textContent = label; pop.appendChild(h);
      if (!items.length) { const p = document.createElement('p'); p.className = 'none'; p.textContent = 'None yet'; pop.appendChild(p); return; }
      [...items].sort((a, b) => (b.date || b.id).localeCompare(a.date || a.id)).forEach((d) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = '<span class="no"></span><span class="t"></span><span class="dt"></span>';
        b.querySelector('.no').textContent = 'No. ' + fmtNo(d.number);
        b.querySelector('.t').textContent = (d.title || 'Untitled') + (pubIds.has(d.id) ? ' ✓' : '');
        b.querySelector('.dt').textContent = d.date || d.id;
        b.addEventListener('click', () => { pop.hidden = true; openPuzzle(d.id); });
        pop.appendChild(b);
      });
    };
    section('Drafts (✓ = published)', drafts);
    pop.hidden = false;
  });
  document.addEventListener('mousedown', (e) => { if (!pop.hidden && !e.target.closest('.pop-wrap')) pop.hidden = true; });

  // ---------- sheets ----------
  function sheet(title, bodyNodes, buttons) {
    $('m-title').textContent = title;
    const body = $('m-body'); body.innerHTML = '';
    bodyNodes.forEach((n) => body.appendChild(typeof n === 'string' ? Object.assign(document.createElement('p'), { textContent: n }) : n));
    const btns = $('m-btns'); btns.innerHTML = '';
    buttons.forEach(({ label, primary, onClick, disabled }) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'aqua' + (primary ? ' primary' : ''); b.textContent = label; b.disabled = !!disabled;
      b.addEventListener('click', onClick);
      btns.appendChild(b);
    });
    $('modal').hidden = false;
    const primary = btns.querySelector('.primary:not(:disabled)') || btns.querySelector('button');
    primary && primary.focus();
  }
  const closeSheet = () => { $('modal').hidden = true; };
  function confirmSheet(title, text, label, onYes) {
    sheet(title, [text], [{ label: 'Cancel', onClick: closeSheet }, { label, primary: true, onClick: () => { closeSheet(); onYes(); } }]);
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modal').hidden) closeSheet(); });

  // ---------- checks ----------
  function check() {
    const errors = [], warnings = [];
    let missing = 0;
    for (let r = 0; r < H(); r++) for (let c = 0; c < W(); c++) if (!isBlock(r, c) && !letterAt(r, c)) missing++;
    if (missing) errors.push(`${missing} square${missing > 1 ? 's' : ''} still need${missing > 1 ? '' : 's'} a letter.`);
    const noClue = G.words.filter((w) => !entry(w).clue.trim()).map((w) => w.id);
    if (noClue.length) errors.push(`${noClue.length} entr${noClue.length > 1 ? 'ies need' : 'y needs'} a clue: ${noClue.slice(0, 8).join(', ')}${noClue.length > 8 ? '…' : ''}`);
    if (!String(draft.title || '').trim()) errors.push('The puzzle needs a title.');
    if (!draft.number) errors.push('The puzzle needs a number.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date || '')) errors.push('The puzzle needs a week-of date.');
    const orphans = Object.keys(cellWords).length < H() * W() && [...Array(H() * W()).keys()].some((i) => {
      const r = Math.floor(i / W()), c = i % W(); return !isBlock(r, c) && !cellWords[r + ',' + c];
    });
    if (orphans) errors.push('Some white squares (shown in red) aren\'t part of any entry.');

    const seen = {};
    G.words.forEach((w) => { const a = w.cells.map(([r, c]) => letterAt(r, c)).join(''); if (a.length === w.cells.length) (seen[a] ||= []).push(w.id); });
    const dups = Object.entries(seen).filter(([, ids]) => ids.length > 1);
    if (dups.length) warnings.push('Repeated answers: ' + dups.map(([a, ids]) => `${a} (${ids.join(', ')})`).join('; '));
    const twos = G.words.filter((w) => w.cells.length < 3).map((w) => w.id);
    if (twos.length) warnings.push(`Two-letter entries: ${twos.join(', ')}`);
    const untitled = G.words.filter((w) => { const l = entry(w).link; return l && l.url && !String(l.title || '').trim(); }).map((w) => w.id);
    if (untitled.length) warnings.push(`Links without a title (the address will show instead): ${untitled.join(', ')}`);
    const linked = G.words.filter((w) => entry(w).link && entry(w).link.url).length;
    if (!linked) warnings.push('No answers have links yet.');
    return { errors, warnings, linked };
  }

  // ---------- publish ----------
  $('b-publish').addEventListener('click', async () => {
    await flushSave();
    update();
    const { errors, warnings, linked } = check();
    const list = (items, cls) => { const ul = document.createElement('ul'); items.forEach((t) => { const li = document.createElement('li'); li.className = cls; li.textContent = t; ul.appendChild(li); }); return ul; };
    const nodes = [`No. ${fmtNo(draft.number)}: ${draft.title || 'Untitled'}, ${X.weekLabel(draft.date) || 'no date'}. ${G.words.length} entries, ${linked} linked.`];
    if (errors.length) nodes.push('Fix these first:', list(errors, 'err'));
    if (warnings.length) nodes.push('Worth a look (you can still publish):', list(warnings, ''));
    if (!errors.length) {
      const where = document.createElement('div'); where.className = 'where';
      where.textContent = `${repo.site || 'your site'}#${draft.id}`;
      nodes.push('This commits the puzzle to the crosslink repo and pushes it. The site updates about a minute later at:', where);
    }
    sheet(errors.length ? 'Not ready to publish' : 'Publish this crosslink?', nodes, [
      { label: errors.length ? 'Back to editing' : 'Cancel', onClick: closeSheet },
      { label: 'Publish', primary: true, disabled: errors.length > 0, onClick: doPublish },
    ]);
  });

  async function doPublish() {
    sheet('Publishing…', ['Writing the puzzle, committing and pushing.'], []);
    try {
      const res = await Bridge.call('publish', { draft: JSON.parse(JSON.stringify(draft)), published: X.publishable(draft) });
      const pre = document.createElement('pre'); pre.textContent = res.log || '';
      if (res.ok) {
        setStatus('Published');
        sheet('Published', [`No. ${fmtNo(draft.number)} is on its way. GitHub Pages usually updates within a minute or two.`, pre], [
          { label: 'Done', onClick: closeSheet },
          { label: 'Open the site', primary: true, onClick: () => { Bridge.call('open', { url: res.url }); closeSheet(); } },
        ]);
      } else {
        sheet("Couldn't publish", [res.error || 'Something went wrong. The details are below.', pre], [{ label: 'OK', primary: true, onClick: closeSheet }]);
      }
    } catch (e) {
      sheet("Couldn't publish", [String(e.message || e)], [{ label: 'OK', primary: true, onClick: closeSheet }]);
    }
  }

  // ---------- test solve ----------
  $('b-test').addEventListener('click', () => {
    const frame = $('ts-frame');
    const send = (e) => {
      if (e.data?.type !== 'crosslink-preview-ready') return;
      removeEventListener('message', send);
      frame.contentWindow.postMessage({ type: 'crosslink-preview', puzzle: X.publishable(draft) }, '*');
    };
    addEventListener('message', send);
    frame.src = 'site/index.html?preview=' + Date.now();
    $('testsolve').hidden = false;
  });
  $('ts-close').addEventListener('click', () => { $('testsolve').hidden = true; $('ts-frame').src = 'about:blank'; focusGrid(); });

  // ---------- toolbar + app menu ----------
  $('b-new').addEventListener('click', newPuzzle);
  $('b-save').addEventListener('click', save);
  // the native menu bar calls this
  window.composer = {
    command(name) {
      if (name === 'new') newPuzzle();
      else if (name === 'open') $('b-open').click();
      else if (name === 'save') save();
      else if (name === 'publish') $('b-publish').click();
      else if (name === 'test') $('b-test').click();
    },
    flush: () => flushSave(),
  };

  // ---------- start ----------
  (async () => {
    const { drafts = [] } = await refreshList();
    if (drafts.length) {
      const latest = [...drafts].sort((a, b) => (b.date || b.id).localeCompare(a.date || a.id))[0];
      await openPuzzle(latest.id);
    } else {
      await newPuzzle();
    }
    focusGrid();
  })().catch((e) => setStatus('Something went wrong: ' + (e.message || e), true));
})();

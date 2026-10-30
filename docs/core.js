// crosslink core: shared by the website (solver) and the Mac composer.
// Grid numbering, link kinds, answer hashing and the draft -> published transform all live here
// so the two sides can never disagree about what a puzzle means.
(function (global) {
  'use strict';

  // ---- link kinds: one color each, used everywhere a link shows up ----
  const KINDS = {
    wiki: { label: 'Wiki', color: 'var(--k-wiki)' },
    video: { label: 'Video', color: 'var(--k-video)' },
    podcast: { label: 'Podcast', color: 'var(--k-podcast)' },
    read: { label: 'Read', color: 'var(--k-read)' },
    site: { label: 'Site', color: 'var(--k-site)' },
  };
  const PLAIN = { label: 'No link', color: 'var(--k-plain)' };

  // best guess at a link's kind from its address; the composer lets you override it
  function guessKind(url) {
    let host = '', path = '';
    try { const u = new URL(url); host = u.hostname.replace(/^www\./, ''); path = u.pathname; } catch (e) { return 'site'; }
    if (/(^|\.)wikipedia\.org$|(^|\.)wiktionary\.org$|(^|\.)fandom\.com$/.test(host)) return 'wiki';
    if (/(^|\.)(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|twitch\.tv|nebula\.tv|archive\.org)$/.test(host) && !/\/details\/.*(podcast|radio)/i.test(path)) return 'video';
    if (/(^|\.)(podcasts\.apple\.com|overcast\.fm|pca\.st|pocketcasts\.com|castro\.fm|podbean\.com|buzzsprout\.com|transistor\.fm|simplecast\.com|libsyn\.com|anchor\.fm|npr\.org)$/.test(host)
      || (/spotify\.com$/.test(host) && /\/(episode|show)\//.test(path)) || /podcast/i.test(host + path)) return 'podcast';
    if (/(^|\.)(substack\.com|medium\.com|newyorker\.com|theatlantic\.com|nytimes\.com|longreads\.com|aeon\.co|nautil\.us|lrb\.co\.uk|nybooks\.com|wired\.com|theguardian\.com|foreignpolicy\.com|paulgraham\.com|kottke\.org)$/.test(host)) return 'read';
    return 'site';
  }

  // ---- grid ----
  // A grid is a list of row strings. '#' is a black square; any other character is a letter square
  // (drafts use ' ' for a square that has no letter yet, published puzzles use '.').
  const isBlockCh = (ch) => ch === '#';

  // Number the grid the standard way and list every entry, across first, then down.
  function numberGrid(rows) {
    const H = rows.length, W = H ? rows[0].length : 0;
    const block = (r, c) => r < 0 || c < 0 || r >= H || c >= W || isBlockCh(rows[r][c]);
    const nums = {}, words = [];
    let n = 0;
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      if (block(r, c)) continue;
      const sa = block(r, c - 1) && !block(r, c + 1);
      const sd = block(r - 1, c) && !block(r + 1, c);
      if (!sa && !sd) continue;
      nums[r + ',' + c] = ++n;
      if (sa) { const cells = []; for (let cc = c; !block(r, cc); cc++) cells.push([r, cc]); words.push({ id: n + 'A', num: n, dir: 'A', cells }); }
      if (sd) { const cells = []; for (let rr = r; !block(rr, c); rr++) cells.push([rr, c]); words.push({ id: n + 'D', num: n, dir: 'D', cells }); }
    }
    words.sort((a, b) => (a.dir === b.dir ? a.num - b.num : a.dir === 'A' ? -1 : 1));
    return { H, W, nums, words, block };
  }

  // ---- SHA-256 (synchronous, no secure context needed, so it runs in the app's web view too) ----
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  function sha256(str) {
    const bytes = new TextEncoder().encode(str);
    const len = bytes.length, total = ((len + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total);
    buf.set(bytes); buf[len] = 0x80;
    const view = new DataView(buf.buffer);
    view.setUint32(total - 4, len * 8); view.setUint32(total - 8, Math.floor(len / 0x20000000));
    const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const w = new Uint32Array(64);
    const rot = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = (hh + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }
    return [...h].map((x) => x.toString(16).padStart(8, '0')).join('');
  }

  // Published puzzles never contain answers, only this fingerprint of each one.
  const answerHash = (puzzleId, wordId, answer) => sha256(`crosslink:${puzzleId}:${wordId}:${answer.toUpperCase()}`);

  // Drafts key each entry by its first square and direction ("0-1-A"), not by its number,
  // so clues and links stay put when black squares move and the numbering shifts.
  const entryKey = (w) => `${w.cells[0][0]}-${w.cells[0][1]}-${w.dir}`;
  const draftEntry = (draft, w) => (draft.entries && draft.entries[entryKey(w)]) || { clue: '', link: null };

  // Turn a composer draft into the file the website serves.
  function publishable(draft) {
    const { words } = numberGrid(draft.grid);
    const answers = {}, links = {}, clues = {};
    for (const w of words) {
      answers[w.id] = answerHash(draft.id, w.id, w.cells.map(([r, c]) => draft.grid[r][c]).join(''));
      const e = draftEntry(draft, w), l = e.link;
      clues[w.id] = (e.clue || '').trim();
      if (l && l.url) links[w.id] = { kind: l.kind || guessKind(l.url), title: l.title || l.url, url: l.url, site: l.site || '', blurb: l.blurb || '' };
    }
    return {
      format: 1,
      id: draft.id, number: draft.number, title: draft.title, author: draft.author,
      note: draft.note || '', week: draft.week || '', date: draft.date || draft.id,
      layout: draft.grid.map((row) => row.replace(/[^#]/g, '.')),
      answers, clues, links,
    };
  }

  // "2026-11-02" -> "Week of Nov 2, 2026"
  function weekLabel(isoDate) {
    const d = new Date(isoDate + 'T12:00:00');
    if (isNaN(d)) return '';
    return 'Week of ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  global.Crosslink = { KINDS, PLAIN, guessKind, numberGrid, sha256, answerHash, entryKey, publishable, weekLabel };
})(typeof window !== 'undefined' ? window : globalThis);

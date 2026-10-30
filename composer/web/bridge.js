// Talks to the native Mac app (composer/mac/main.swift). Every call returns a promise.
// Opened in a plain browser instead (for working on the UI), a stand-in keeps drafts in
// localStorage and pretends to publish, so the editor can be exercised without the app.
(function () {
  'use strict';
  const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.composer;

  const store = {
    all() { try { return JSON.parse(localStorage.getItem('composer:drafts') || '{}'); } catch (e) { return {}; } },
    put(all) { try { localStorage.setItem('composer:drafts', JSON.stringify(all)); } catch (e) {} },
  };
  const stand_in = {
    async list() {
      let all = store.all();
      if (!Object.keys(all).length) {
        // seed with the sample puzzle from the repo
        try { const d = await fetch('../../drafts/2026-11-02.json').then((r) => r.json()); all = { [d.id]: d }; store.put(all); } catch (e) {}
      }
      const drafts = Object.values(all).map((d) => ({ id: d.id, title: d.title, number: d.number, date: d.date }));
      return { drafts, published: [], repo: { path: '(browser stand-in)', site: 'https://example.invalid/crosslink/' } };
    },
    async load({ id }) { return store.all()[id] || null; },
    async save({ draft, previousId }) {
      const all = store.all();
      if (previousId && previousId !== draft.id) delete all[previousId];
      all[draft.id] = draft; store.put(all);
      return { ok: true };
    },
    async preview({ url }) {
      const host = new URL(url).hostname.replace(/^www\./, '');
      return { title: '', description: '', siteName: host, url };
    },
    async publish({ published }) {
      return { ok: true, url: '#', log: `(browser stand-in) would write docs/puzzles/${published.id}.json, commit and push.` };
    },
    async open({ url }) { window.open(url, '_blank'); return { ok: true }; },
  };

  window.Bridge = {
    native: !!native,
    call(cmd, args = {}) {
      if (native) {
        // puzzles cross to the app as JSON text so files keep their key order and formatting
        const msg = { cmd, ...args };
        for (const k of ['draft', 'published']) if (msg[k] && typeof msg[k] === 'object') msg[k] = JSON.stringify(msg[k], null, 2) + '\n';
        return native.postMessage(msg);
      }
      if (!stand_in[cmd]) return Promise.reject(new Error('Unknown command ' + cmd));
      return stand_in[cmd](args);
    },
  };
})();

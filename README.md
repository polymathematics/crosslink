# crosslink

A weekly crossword where every answer leads somewhere. Solve an answer and it becomes a link to a video, essay, wiki article, podcast or corner of the web. Finish the grid and you get a page of every link to explore through the week.

## What's here

| Folder | What it is |
|---|---|
| `docs/` | The website, served by GitHub Pages. `index.html` + `solver.js` render the newest puzzle; `docs/puzzles/` holds every published puzzle and `index.json` lists them. |
| `docs/core.js` | Shared by the site and the composer: grid numbering, link types, answer fingerprints, and the draft → published transform. |
| `composer/web/` | The composer's editor UI. `site/` is a link to `docs/` so Test Solve uses the real solver. |
| `composer/mac/` | The native Mac app around the editor: saving drafts, fetching link previews, publishing with git. |
| `drafts/` | Your puzzles in progress. Ignored by git, because drafts contain the answers. Back this folder up yourself. |

## Making a puzzle

1. Open **Crosslink Composer** (build it first, below).
2. **New** starts a 15×15 for next Monday. Type letters into the grid; `.` or ⌘-click places a black square (mirrored when Symmetry is on).
3. Each entry on the right gets a clue and, optionally, a link. Paste a URL and the app fetches its title and description; the link type (Wiki, Video, Podcast, Read, Site) is guessed from the address and can be changed.
4. **Test Solve** opens the puzzle in the real solver.
5. **Publish…** checks the puzzle, writes `docs/puzzles/<date>.json`, updates `index.json`, commits just those files and pushes. GitHub Pages updates a minute or two later.

Published puzzles never contain the answers, only a SHA-256 fingerprint of each one (`core.js` → `answerHash`), so they can't be read from the page source.

## Building the app

Needs only the Xcode command line tools.

```bash
./composer/build.sh --install
```

That builds `build/Crosslink Composer.app` and copies it to `/Applications`. The app remembers this folder's location; if you move the folder it asks for it again.

Publishing pushes with your normal git credentials. With the GitHub CLI, `gh auth setup-git` sets that up.

## Working on the site or editor

Any static server works, for example `python3 -m http.server` from the repo root, then open `/docs/` or `/composer/web/composer.html`. In a plain browser the editor keeps drafts in localStorage and pretends to publish.

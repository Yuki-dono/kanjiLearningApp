# Kanji Practice (N5 → N1) — barebones v1

For N4–N3 level study. Library + scoped tests + compound vocab.

## Deploy

Account and sync need **two** deployments, and they cannot be the same one:

| Piece | Where | Why |
|---|---|---|
| The site (HTML/JS/CSS/JSON) | Netlify, GitHub Pages, anything static | No server code |
| **The API** (`server/`) | **Render, Railway, Fly, or a VPS** | It's Python |

**Netlify cannot run the API.** Netlify Functions are Node/TypeScript only. This
is the piece people get stuck on: deploying the site to Netlify gets you a
working app with no sync, because there is no `/api/*` on that origin.

### 1. Deploy the API

`render.yaml` is in the repo root, so Render can pick it up.

1. [render.com](https://render.com) → **New → Blueprint** → connect this repo
2. Render lists the service from `render.yaml`; confirm it
3. In the service's **Environment**, set the two it deliberately left unset:
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Project Settings → API Keys
   - `CORS_ORIGINS` — where the site will live, e.g. `https://yoursite.netlify.app`
     (scheme + host, no trailing slash; comma-separate for preview deploys)
4. Note the URL it gives you, e.g. `https://kanjilearn-api.onrender.com`

Check it: `curl https://kanjilearn-api.onrender.com/api/health` → `{"ok":true}`

Free-tier services **sleep when idle**, so the first request after a quiet spell
takes ~30s while it wakes up. The app shows "Syncing…" and waits it out. If it
looks frozen, wait and hit Sync again.

### 2. Point the site at it

Put the URL from step 1 in `config.js` and push:

```js
API_URL: "https://kanjilearn-api.onrender.com",
```

Then push. That's it — the value is derived from the hostname, so local
development on `localhost:8000` keeps using same-origin and needs no CORS.

### 3. Deploy the site

Netlify: connect the repo, publish directory `.`, no build command.
`netlify.toml` already sets the caching (hard for `data/`, no-cache for code) and
404s `/server/*` so backend source isn't published.

### 4. Set CORS_ORIGINS on the API

This is the step people miss. It must match your site's **exact** origin —
`https://yoursite.netlify.app`, not the bare hostname, not with a trailing slash.
Wrong or missing and the browser silently drops every response, which looks
identical to "sync is broken".

### Verifying

| Check | Expected |
|---|---|
| `curl <api>/api/health` | `{"ok":true}` |
| Site loads, no console errors | dictionaries render |
| Account chip | `● Synced` after signing in |
| If the chip says `⚠ No server` | `API_URL` wrong, or CORS rejecting it |

## Run locally

The site is served by our own FastAPI backend (it serves the static files too, so
everything is one origin).

```powershell
# once
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r server\requirements.txt

# copy server/.env.example -> server/.env and paste your service_role key
#   Supabase Dashboard -> Project Settings -> API Keys

# every time
cd server
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
# open http://localhost:8000
```

Must use http:// (not file://) because the app fetches the kanji and vocabulary JSON.

### Sync fails with "No sync server at this address" / a 404

You opened the site somewhere the API doesn't live. Sync needs the FastAPI server,
so open **http://localhost:8000** — not a static host.

GitHub Pages, Netlify, `file://` and `python -m http.server` all serve the files
but have no `/api/*`, so every sync 404s. Everything else still works, which is
what makes it confusing: the app loads (content falls back to `data/`), sign-in
works (Supabase is external), and only sync breaks.

Two ways out:

1. **Use the API server** — `cd server && uvicorn app.main:app --port 8000`, then open `http://localhost:8000`. One origin, no CORS.
2. **Host them separately** — deploy the API, then set `API_BASE` in `config.js` to its URL and `CORS_ORIGINS` in `server/.env` to the origin serving the page. The account panel will say `⚠ No server` if the two don't line up.

The sidebar chip and account panel both report which server is reachable, so this
is visible without attempting a sync.

Working offline or just browsing without sync? `python -m http.server 8000` still
works — sign-in and cloud sync are disabled, everything else behaves the same.

## Tests

```powershell
cd server
..\.venv\Scripts\python.exe -m pytest
```

Covers token verification, cross-account isolation, the sync merge rules, the
recomputed stats, and that every file `index.html` references is actually served.

## How it fits together

- **Local-first.** Everything works offline in localStorage. When you sign in, the
  same data is mirrored to your account and merged back on every visit, so progress
  follows you between devices.
- **Supabase authenticates.** The browser keeps the access token; only login,
  signup and refresh happen directly against Supabase.
- **Our API owns the data** (`server/app`). It verifies the token against
  Supabase's signing keys, scopes every request to the signed-in account, and
  computes XP and streak itself rather than trusting totals the browser reports.
- **The dictionaries** are public and served from `data/` via `/api/content/…`,
  with the static path kept as a fallback.

## Features
- **Library:** all ~2211 kanji N5–N1 with onyomi, kunyomi, English meaning. Filter by level (e.g. N5–N4 only), search, sort, click for detail + example words.
- **Test:** pick scope (N5–N4 only, N3–N1, custom), mode (Kanji→Meaning, Meaning→Kanji, Kanji→Reading, Vocab→Reading, Mixed), 5–30 Q multiple choice. Best score per scope saved in localStorage.
- **Compounds:** starter jukugo (e.g. 飲 + 食 = 飲食 いんしょく food and drink) + auto-detected 2-kanji vocab with component breakdown. Click a component to jump to library. Add your own (saved locally).

## Data
- `data/kanji-n5…n1.json`, `data/vocab-n5…n1.json` from [OpenJLPT](https://github.com/evanclan/OpenJLPT) (CC BY-SA 4.0) — covers your `kanji-flashcards/n3.tsv` + `n4.tsv`.
- Your TSVs: N4 ~166 entries, N3 ~367 entries — same content is inside OpenJLPT with standardized readings.
- Tables and row-level security: `supabase-schema.sql` (run once in Supabase → SQL Editor; safe to re-run).

## Next ideas (when you want)
- Stroke order diagrams (KanjiVG), spaced repetition (FSRS), listening mode, pitch accent, import your .tsv/.apkg.
- A global leaderboard — the API is already the right place for it.
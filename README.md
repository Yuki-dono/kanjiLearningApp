# Kanji Practice (N5 → N1) — barebones v1

For N4–N3 level study. Library + scoped tests + compound vocab.

## Deploy

**One service on Render does everything.** It runs the API and serves the static
site from the same origin, so there is no second host to configure and the
browser never needs CORS.

`server/app/main.py` lists the site files explicitly and returns them alongside
the `/api/*` routes, and mounts `data/` statically. Nothing else is published,
so backend source and `server/.env` are never reachable.

### 1. Create the service

`render.yaml` is in the repo root, so Render can pick it up.

1. [render.com](https://render.com) → **New → Blueprint** → connect this repo
2. Render lists the service from `render.yaml`; confirm it
3. In the service's **Environment**, set the one it deliberately left unset:
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Project Settings → API Keys
4. Note the URL it gives you, e.g. `https://kanjilearn-api.onrender.com`

Leave `CORS_ORIGINS` empty. That is what same-origin means, and empty is the
default that the server checks.

Check it: `curl https://kanjilearn-api.onrender.com/api/health` → `{"ok":true}`

Free-tier services **sleep when idle**, so the first request after a quiet spell
takes ~30s while it wakes up. That delay is the service starting, not a failed
deploy. The app shows "Syncing…" and waits it out.

### 2. Confirming a deploy landed

A push to `main` does not change what is being served until Render rebuilds.
Two ways to check without guessing:

- The console logs `BUILD` on boot (`config.js`). Compare it against the value
  in `config.js`; a stale number means the old build is still live.
- `curl <your-url>/api/health` returns the Supabase project ref, which confirms
  which project the running code points at.

If the build number looks current but the layout is not, hard-reload. The site
files are served with `ETag`/`Last-Modified`, so the browser revalidates on its
own; a hard reload bypasses a cache that was warm before the deploy.

### When you'd need CORS after all

Only if the site and the API were split across origins again. Then
`CORS_ORIGINS` must match the site's **exact** origin — scheme and host, no
trailing slash. Wrong or missing and the browser silently drops every response,
which looks identical to "sync is broken". There is no reason to split them
today, so this is a note for later, not a step to perform.

### Verifying

| Check | Expected |
|---|---|
| `curl <url>/api/health` | `{"ok":true}` |
| Site loads, no console errors | dictionaries render |
| Console `BUILD` | matches `config.js` |
| Account chip | `● Synced` after signing in |
| If the chip says `⚠ No server` | the API is unreachable or sleeping |

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

Sync needs the FastAPI server, because it is the thing that talks to Supabase.
Open **http://localhost:8000**, not a plain static server.

`file://` and `python -m http.server 8000` both serve the files but have no
`/api/*`, so every sync 404s. Everything else still works, which is what makes
it confusing: the app loads (content falls back to `data/`), sign-in works
(Supabase is external), and only sync breaks.

Fix: `cd server && uvicorn app.main:app --port 8000`, then open
`http://localhost:8000`. One origin, no CORS — the same arrangement Render uses.

The sidebar chip and account panel both report which server is reachable, so this
is visible without attempting a sync.

If it fails on the deployed URL rather than locally, the service is probably
asleep. A free-tier Render service takes ~30s to wake; wait and retry rather
than re-deploying.

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
# Kanji Practice (N5 → N1) — barebones v1

For N4–N3 level study. Library + scoped tests + compound vocab.

## Run

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
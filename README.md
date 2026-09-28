# Kanji Practice (N5 → N1) — barebones v1

For N4–N3 level study. Library + scoped tests + compound vocab.

## Run
```powershell
cd japanese-kanji-app
python -m http.server 8000
# open http://localhost:8000
```
Must use http:// (not file://) because app fetches `data/*.json`.

## Features
- **Library:** all ~2211 kanji N5–N1 with onyomi, kunyomi, English meaning. Filter by level (e.g. N5–N4 only), search, sort, click for detail + example words.
- **Test:** pick scope (N5–N4 only, N3–N1, custom), mode (Kanji→Meaning, Meaning→Kanji, Kanji→Reading, Vocab→Reading, Mixed), 5–30 Q multiple choice. Best score per scope saved in localStorage.
- **Compounds:** starter jukugo (e.g. 飲 + 食 = 飲食 いんしょく food and drink) + auto-detected 2-kanji vocab with component breakdown. Click a component to jump to library. Add your own (saved locally).

## Data
- `data/kanji-n5…n1.json`, `data/vocab-n5…n1.json` from [OpenJLPT](https://github.com/evanclan/OpenJLPT) (CC BY-SA 4.0) — covers your `kanji-flashcards/n3.tsv` + `n4.tsv`.
- Your TSVs: N4 ~166 entries, N3 ~367 entries — same content is inside OpenJLPT with standardized readings.

## Next ideas (when you want)
- Stroke order diagrams (KanjiVG), spaced repetition (FSRS), listening mode, pitch accent, import your .tsv/.apkg.

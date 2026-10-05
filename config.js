// ---------- config ----------
// Public values only. Loaded before app.js (see index.html).
//
// The anon key is a *public* client key — it identifies the project, it does
// not grant access. Every table is scoped to the signed-in account by the
// server (server/app/auth.py), which is what actually keeps rows private.
//
// Anything secret belongs in server/.env and must never appear in this file:
// this is served to every visitor.
window.KANJI_CONFIG = {
  SUPABASE_URL: "https://qkcquwbmmqgbvximphbz.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrY3F1d2JtbXFnYnZ4aW1waGJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NDE1MjgsImV4cCI6MjEwNjQxNzUyOH0.qmt84ec7PIEEiE_su_rU70apUkb2oYJ3uRIDaSM8c00",

  // Where our API lives.
  //
  // "" means same origin, and that's correct whenever you open the site from the
  // API server itself (http://localhost:8000) — the server serves these files, so
  // there is one origin and no CORS.
  //
  // If you open the site some other way (GitHub Pages, file://, any static host)
  // then /api/* hits that host instead and every sync fails with a 404. Two ways
  // out: open http://localhost:8000 instead, or point this at the server, e.g.
  //   API_BASE: "https://kanji-api.example.com",
  // and set CORS_ORIGINS in server/.env to the origin that hosts the page.
  API_BASE: "",
};
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

  // Same-origin by default: the FastAPI server serves this site too, so there is
  // no CORS and no second host to keep in sync. Set to e.g. "http://localhost:8000"
  // only when you serve the static files from somewhere else.
  API_BASE: "",
};
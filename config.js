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

  // Public URL of the deployed API (Render, Railway, Fly — anything that can
  // actually run Python). No trailing slash. Leave "" until you deploy one;
  // account and sync won't work until you do.
  //
  // This is only used when the page is NOT served from localhost. On localhost
  // the API server serves the page itself, so same-origin is used and CORS never
  // comes up. That means one committed value works in both places — see app.js.
  //
  // If this is "" and you're on a static host, every sync fails with a 404:
  // there is no /api/* there. The account chip reads "No server" when that's the
  // case.
  API_URL: "",

  // Escape hatch: forces the API address regardless of hostname. Leave "" for
  // normal use; set it only if you're serving the site and the API from two
  // different local ports.
  API_BASE: "",
};
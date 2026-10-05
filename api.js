// ---------- api client ----------
// Thin wrapper over our own backend (server/app). Every data read and write
// goes through here; Supabase is only asked to prove who the user is.
//
// The access token comes from the supabase-js session, so token refresh and
// persistence stay entirely Supabase's job — this file never handles a password.

async function accessToken() {
  const client = await supaClient();
  if (!client) return null;
  try {
    const { data } = await client.auth.getSession();
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Whether the backend answers at all, checked once on boot. Without this the
// first sign of a missing backend is a sync that fails with a bare 404 — which
// is exactly the case where the most useful thing to say is "start the server".
const API = { reachable: null };

async function apiHealth() {
  try {
    const resp = await fetch(`${API_BASE}/api/health`, { headers: { Accept: "application/json" } });
    API.reachable = resp.ok;
  } catch {
    API.reachable = false;
  }
  return API.reachable;
}

// One retry, and only for an expired token: supabase-js may simply not have
// rotated it yet. Anything else is a real failure and is passed straight up.
//
// A 404 means the request matched no route — the backend isn't at this origin.
// That is distinct from the JSON "Not found." a failed PostgREST call returns,
// so it's detected by the body failing to parse rather than by the status alone.
async function apiFetch(path, opts = {}, retried = false) {
  const token = await accessToken();
  if (!token) throw new ApiError(401, "Sign in to sync your progress.");
  let resp;
  try {
    resp = await fetch(API_BASE + path, {
      ...opts,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
    });
  } catch {
    throw new ApiError(0, "No connection to the server.");
  }
  if (resp.status === 401 && !retried) return apiFetch(path, opts, true);
  if (!resp.ok) {
    let message = `Request failed (${resp.status})`;
    try {
      const body = await resp.json();
      if (body?.detail) message = body.detail;
    } catch {
      if (resp.status === 404) {
        API.reachable = false;
        throw new ApiError(404, "No sync server at this address.");
      }
    }
    throw new ApiError(resp.status, message);
  }
  return resp.status === 204 ? null : resp.json();
}

const apiPull = () => apiFetch("/api/sync/pull");
const apiPush = payload => apiFetch("/api/sync/push", { method: "POST", body: JSON.stringify(payload) });
const apiWipe = () => apiFetch("/api/sync/wipe", { method: "POST" });
const apiStats = () => apiFetch("/api/me/stats");
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

// One retry, and only for an expired token: supabase-js may simply not have
// rotated it yet. Anything else is a real failure and is passed straight up.
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
    } catch {}
    throw new ApiError(resp.status, message);
  }
  return resp.status === 204 ? null : resp.json();
}

const apiPull = () => apiFetch("/api/sync/pull");
const apiPush = payload => apiFetch("/api/sync/push", { method: "POST", body: JSON.stringify(payload) });
const apiWipe = () => apiFetch("/api/sync/wipe", { method: "POST" });
const apiStats = () => apiFetch("/api/me/stats");
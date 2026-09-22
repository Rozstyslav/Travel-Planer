import { state } from "travel/core/state.js";
import { persist } from "travel/core/storage.js";
import { events } from "travel/core/events.js";

let refreshPromise;

export function clearSession() {
  state.sessionVersion += 1;
  state.tokens = null;
  state.remote = [];
  state.saved.clear();
  state.savedLoaded = false;
  state.loaded = false;
  persist("tp-session-v1", null, "sessionStorage");
  events.dispatchEvent(new Event("session-expired"));
}

export async function logoutSession() {
  // If refresh is rotating a token, revoke the replacement rather than the old one.
  if (refreshPromise) await refreshPromise.catch(() => {});
  const refresh = state.tokens?.refresh;
  clearSession();
  if (!refresh) return;
  const { response, data } = await fetchJSON("/api/auth/logout/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });
  if (!response.ok && response.status !== 401)
    throw new Error(errorMessage(data, response.status));
}

export function errorMessage(data, status) {
  if (status === 429) return "Too many requests. Wait a minute and try again.";
  if (data?.code === "provider_configuration")
    return "Search is temporarily unavailable. Please try again later.";
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status >= 500)
    return "The service is temporarily unavailable. Please try again later.";
  const messages =
    typeof data === "object" && data
      ? Object.values(data).flat().join(" ")
      : "";
  const translations = [
    [/visited/i, "Unmark visited places before deleting this trip."],
    [/duplicate|already|more than once/i, "This place is already in the trip."],
    [/10|maximum|limit/i, "A trip can have up to 10 stops."],
    [
      /not found|does not exist/i,
      "This record could not be found. Refresh the page and try again.",
    ],
  ];
  return (
    translations.find(([regex]) => regex.test(messages))?.[1] ||
    (status === 400
      ? "Check your details and try again."
      : "Something went wrong. Please try again.")
  );
}

export async function fetchJSON(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error(
      "Cannot connect to the server. Check your connection and try again.",
    );
  }
  const data =
    response.status === 204 ? null : await response.json().catch(() => null);
  return { response, data };
}

export async function refreshSession() {
  if (!state.tokens) throw new Error("Please sign in to continue.");
  if (!refreshPromise) {
    const previous = state.tokens;
    refreshPromise = (async () => {
      const { response, data } = await fetchJSON("/api/auth/token/refresh/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: previous.refresh }),
      });
      if (state.tokens !== previous)
        throw new Error("Your session has changed. Please try again.");
      if (!response.ok) {
        if (response.status === 401 || response.status === 400) {
          clearSession();
        }
        throw new Error(errorMessage(data, response.status));
      }
      state.tokens = {
        ...previous,
        access: data.access,
        refresh: data.refresh || previous.refresh,
      };
      persist("tp-session-v1", state.tokens, "sessionStorage");
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function api(path, options = {}, retry = true) {
  if (!state.tokens) throw new Error("Please sign in to continue.");
  const sessionVersion = state.sessionVersion;
  const { response, data } = await fetchJSON(`/api/${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.tokens.access}`,
      ...options.headers,
    },
  });
  if (sessionVersion !== state.sessionVersion)
    throw new Error("Your session has changed. Please try again.");
  if (response.status === 401 && retry) {
    await refreshSession();
    return api(path, options, false);
  }
  if (response.status === 401) clearSession();
  if (!response.ok) throw new Error(errorMessage(data, response.status));
  return data;
}

export async function discovery(path, params = {}) {
  const query = new URLSearchParams(params).toString();
  const { response, data } = await fetchJSON(
    `/api/${path}${query ? "?" + query : ""}`,
  );
  if (!response.ok) throw new Error(errorMessage(data, response.status));
  return data;
}

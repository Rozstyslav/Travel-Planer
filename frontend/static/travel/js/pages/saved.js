import { $, $$ } from "travel/core/dom.js";
import { events } from "travel/core/events.js";
import { registerView } from "travel/router.js";
import { state, findPlace } from "travel/core/state.js";
import { api } from "travel/core/api.js";
import { requireSignIn } from "travel/core/auth.js";
import {
  card,
  photoObserver,
  observePhotos,
} from "travel/components/places.js";
import { toast } from "travel/ui/feedback.js";
import { renderTemplate } from "travel/ui/templates.js";
import { registerActions } from "travel/core/actions.js";

let loading;
const saving = new Set();

function syncSaveButtons() {
  $$('[data-action="save"]').forEach((button) => {
    const id = button.dataset.id;
    const saved = state.saved.has(id);
    button.setAttribute("aria-pressed", String(saved));
    button.setAttribute("aria-label", `${saved ? "Remove from saved" : "Save"}: ${findPlace(id)?.name || "place"}`);
  });
}

export function renderSaved() {
  $$("#saved-grid .art-card").forEach((element) =>
    photoObserver.unobserve(element),
  );
  const savedCount = $("#saved-count");
  if (savedCount) savedCount.textContent = state.saved.size;
  $("#saved-grid").innerHTML = !state.tokens
    ? renderTemplate("saved-guest")
    : state.saved.size
    ? [...state.saved.values()].map(card).join("")
    : renderTemplate("saved-empty");
  observePhotos("#saved-grid");
  syncSaveButtons();
}

export async function loadSaved() {
  if (!state.tokens || state.savedLoaded) return;
  const version = state.sessionVersion;
  if (loading?.version === version) return loading.promise;
  $("#saved-grid").innerHTML = renderTemplate("saved-loading");
  const promise = (async () => {
    try {
      const data = await api("saved/");
      if (version !== state.sessionVersion) return;
      state.saved = new Map((Array.isArray(data) ? data : data.results || []).map((p) => [p.place_id, p]));
      state.savedLoaded = true;
      renderSaved();
    } catch (error) {
      if (version !== state.sessionVersion) return;
      $("#saved-grid").innerHTML = renderTemplate("saved-error", { message: error.message });
      throw error;
    } finally {
      if (loading?.version === version) loading = null;
    }
  })();
  loading = { version, promise };
  return promise;
}

export async function toggleSave(id) {
  if (!requireSignIn(() => toggleSave(id), "Sign in to save this place to your favourites.")) return;
  const version = state.sessionVersion;
  const key = `${version}:${id}`;
  if (saving.has(key)) return;
  saving.add(key);
  try {
    await loadSaved();
    if (!state.tokens || version !== state.sessionVersion) return;
    const wasInSaved = document.activeElement?.closest("#saved-grid");
    const existing = state.saved.get(id);
    if (existing) {
      await api(`saved/${encodeURIComponent(id)}/`, { method: "DELETE" });
      state.saved.delete(id);
    } else {
      const place = await api("saved/", { method: "POST", body: JSON.stringify({ place_id: id }) });
      state.saved.set(place.place_id, place);
    }
    renderSaved();
    if (wasInSaved) ($("#saved-grid button") || $('[data-nav="saved"]')).focus();
    toast(existing ? "Removed from saved." : "Place saved.");
  } finally {
    saving.delete(key);
  }
}

export function initSaved() {
  registerView("saved", () => {
    if (state.tokens && !state.savedLoaded) loadSaved().catch((error) => toast(error.message));
    else renderSaved();
  });
  events.addEventListener("saved-changed", renderSaved);
  events.addEventListener("session-expired", renderSaved);
  registerActions({ save: ({ id }) => toggleSave(id), "retry-saved": loadSaved });
  renderSaved();
  if (state.tokens) loadSaved().catch((error) => toast(error.message));
}

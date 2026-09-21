import { $, $$ } from "travel/core/dom.js";
import { events } from "travel/core/events.js";
import { registerView } from "travel/router.js";
import { state, findPlace } from "travel/core/state.js";
import { persist } from "travel/core/storage.js";
import {
  card,
  photoObserver,
  observePhotos,
} from "travel/components/places.js";
import { toast } from "travel/ui/feedback.js";
import { renderTemplate } from "travel/ui/templates.js";
import { registerActions } from "travel/core/actions.js";

export function renderSaved() {
  $$("#saved-grid .art-card").forEach((element) =>
    photoObserver.unobserve(element),
  );
  $("#saved-count").textContent = state.saved.size;
  $("#saved-grid").innerHTML = state.saved.size
    ? [...state.saved.values()].map(card).join("")
    : renderTemplate("saved-empty");
  observePhotos("#saved-grid");
}

export function toggleSave(id) {
  const wasInSaved = document.activeElement?.closest("#saved-grid");
  const name = findPlace(id)?.name || "";
  if (state.saved.has(id)) state.saved.delete(id);
  else state.saved.set(id, findPlace(id));
  persist("tp-saved-v2", [...state.saved.values()]);
  renderSaved();
  $$(`[data-action="save"][data-id="${CSS.escape(id)}"]`).forEach((b) => {
    b.setAttribute("aria-pressed", String(state.saved.has(id)));
    b.setAttribute(
      "aria-label",
      `${state.saved.has(id) ? "Remove from saved" : "Save"}: ${name}`,
    );
  });
  if (wasInSaved) ($("#saved-grid button") || $('[data-nav="saved"]')).focus();
  toast(state.saved.has(id) ? "Place saved." : "Removed from saved.");
}

export function initSaved() {
  registerView("saved", renderSaved);
  events.addEventListener("saved-changed", renderSaved);
  registerActions({ save: ({ id }) => toggleSave(id) });
  renderSaved();
}

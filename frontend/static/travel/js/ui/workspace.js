import { $, $$ } from "travel/core/dom.js";
import { state } from "travel/core/state.js";
import { renderTemplate } from "travel/ui/templates.js";

export function renderAccount() {
  $("#account-label").textContent = state.tokens ? "Account" : "Sign in";
  const message = renderTemplate(
    state.tokens ? "workspace-account" : "workspace-guest",
  );
  $$("[data-workspace-note]").forEach((note) => {
    note.innerHTML = message;
  });
}

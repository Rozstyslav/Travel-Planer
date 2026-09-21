import { $ } from "travel/core/dom.js";
import { state } from "travel/core/state.js";
import { renderTemplate } from "travel/ui/templates.js";

export function renderAccount() {
  $("#account-label").textContent = state.tokens ? "Account" : "Sign in";
  $("#workspace-note").innerHTML = renderTemplate(
    state.tokens ? "workspace-account" : "workspace-guest",
  );
}

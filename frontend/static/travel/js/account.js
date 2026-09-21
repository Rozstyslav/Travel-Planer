import { renderTemplate } from "travel/ui/templates.js";
import { $ } from "travel/core/dom.js";
import { state } from "travel/core/state.js";
import { persist } from "travel/core/storage.js";
import { api, fetchJSON, errorMessage } from "travel/core/api.js";
import {
  openModal,
  closeModal,
  bindForm,
  modalVersion,
} from "travel/ui/modal.js";
import { toast } from "travel/ui/feedback.js";
import {
  loadProjects,
  renderTrips,
  cancelProjectLoad,
} from "travel/pages/trips.js";
import { navigate } from "travel/router.js";
import { registerActions } from "travel/core/actions.js";
import { renderAccount } from "travel/ui/workspace.js";

export function showLogin() {
  openModal(renderTemplate("account-login"));
  const version = modalVersion;
  bindForm(async (formData) => {
    const { response, data } = await fetchJSON("/api/auth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(formData)),
    });
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "Incorrect username or password."
          : errorMessage(data, response.status),
      );
    state.tokens = data;
    state.loaded = false;
    persist("tp-session-v1", data, "sessionStorage");
    renderAccount();
    if (version === modalVersion) closeModal();
    if (location.hash === "#trips") await loadProjects();
    else navigate("trips");
    toast("You’re in the shared workspace. Time to plan!");
  });
}

export function showAccount() {
  if (!state.tokens) return showLogin();
  openModal(renderTemplate("account-details"));
  bindForm(async () => {
    await api("auth/logout/", {
      method: "POST",
      body: JSON.stringify({ refresh: state.tokens.refresh }),
    });
    state.tokens = null;
    state.remote = [];
    state.loaded = false;
    cancelProjectLoad();
    persist("tp-session-v1", null, "sessionStorage");
    renderTrips();
    closeModal();
    toast("You’re in the guest workspace.");
  });
}

export function initAccount() {
  $("#account-button").addEventListener("click", showAccount);
  registerActions({ login: () => showLogin() });
  renderAccount();
}

import { renderTemplate } from "travel/ui/templates.js";
import { $ } from "travel/core/dom.js";
import { state } from "travel/core/state.js";
import { persist } from "travel/core/storage.js";
import { fetchJSON, logoutSession, clearSession } from "travel/core/api.js";
import {
  openModal,
  closeModal,
  bindForm,
  modalVersion,
} from "travel/ui/modal.js";
import { toast } from "travel/ui/feedback.js";
import { loadSaved } from "travel/pages/saved.js";
import { route } from "travel/router.js";
import { events } from "travel/core/events.js";
import { registerActions } from "travel/core/actions.js";
import { renderAccount } from "travel/ui/workspace.js";

let pendingAction = null;
let loginMessage = "Sign in to create trips, add places and save your favourites.";

export function showLogin() {
  openModal(renderTemplate("account-login", { message: loginMessage }));
  const version = modalVersion;
  bindForm(async (formData) => {
    const data = await authRequest("login/", Object.fromEntries(formData));
    if (version !== modalVersion) return;
    state.tokens = data;
    state.sessionVersion += 1;
    state.loaded = false;
    state.remote = [];
    state.saved.clear();
    state.savedLoaded = false;
    persist("tp-session-v1", data, "sessionStorage");
    renderAccount();
    const resume = pendingAction;
    const sessionVersion = state.sessionVersion;
    pendingAction = null;
    closeModal();
    route();
    await loadSaved().catch((error) => toast(error.message));
    if (!state.tokens || sessionVersion !== state.sessionVersion) return;
    toast("You’re signed in. Time to plan!");
    if (resume && !$("#modal").open) await resume();
  });
}

export function showAccount() {
  if (!state.tokens) return showLogin();
  openModal(renderTemplate("account-details"));
  const version = modalVersion;
  bindForm(async () => {
    try {
      await logoutSession();
      toast("Signed out. You can keep exploring places.");
    } catch {
      toast("Signed out on this device. The server could not be reached to revoke the session.");
    } finally {
      if (version === modalVersion) closeModal();
    }
  });
}

async function authRequest(path, payload) {
  const { response, data } = await fetchJSON(`/api/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const message = data?.code === "email_delivery_failed"
      ? "We couldn’t send the email. Please try again later."
      : response.status === 429
      ? "Too many attempts. Please wait and try again."
      : response.status >= 500
        ? "The service is temporarily unavailable. Please try again."
        : Object.values(data || {}).flat().filter((value) => typeof value === "string").join(" ");
    throw new Error(message || "Check your details and try again.");
  }
  return data;
}

function showEmailNotice(message) {
  openModal(renderTemplate("account-notice", { title: "Check your email.", message }));
}

export function showRegister() {
  openModal(renderTemplate("account-register"));
  const version = modalVersion;
  bindForm(async (form) => {
    const result = await authRequest("register/", Object.fromEntries(form));
    if (version === modalVersion) showEmailNotice(result.detail);
  });
}

export function showEmailForm(resend = false) {
  openModal(renderTemplate("account-email-form", {
    title: resend ? "Confirm your email." : "Forgot your password?",
    description: resend ? "Request a new verification link." : "We’ll email you a link to choose a new password.",
  }));
  const version = modalVersion;
  bindForm(async (form) => {
    const result = await authRequest(resend ? "resend-verification/" : "password-reset/", Object.fromEntries(form));
    if (version === modalVersion) showEmailNotice(result.detail);
  });
}

function handleAuthLink() {
  const [action, query = ""] = location.hash.slice(1).split("?");
  if (!["verify-email", "reset-password"].includes(action)) return;
  const params = new URLSearchParams(query);
  history.replaceState(null, "", `${location.pathname}${location.search}#discover`);
  if (action === "reset-password") {
    openModal(renderTemplate("account-reset-password"));
    bindForm(async (form) => {
      if (form.get("password") !== form.get("confirm_password"))
        throw new Error("Passwords do not match.");
      const version = modalVersion;
      const result = await authRequest("password-reset/confirm/", {
        uid: params.get("uid"), token: params.get("token"), password: form.get("password"),
      });
      clearSession();
      if (version === modalVersion) {
        showLogin();
        toast(result.detail);
      }
    });
  } else {
    openModal(renderTemplate("account-notice", { title: "Verifying your email…", message: "Please wait." }));
    const version = modalVersion;
    authRequest("verify-email/", { token: params.get("token") })
      .then((result) => {
        if (version === modalVersion)
          openModal(renderTemplate("account-notice", { title: "Email verified.", message: result.detail }));
      })
      .catch((error) => {
        if (version === modalVersion)
          openModal(renderTemplate("account-notice", { title: "Could not verify email.", message: error.message }));
      });
  }
}

export function initAccount() {
  events.addEventListener("sign-in-required", ({ detail }) => {
    pendingAction = detail.resume;
    loginMessage = detail.message;
    showLogin();
  });
  $("#modal").addEventListener("close", () => {
    if ($("#modal").open) return;
    pendingAction = null;
    loginMessage = "Sign in to create trips, add places and save your favourites.";
  });
  events.addEventListener("session-expired", () => {
    closeModal();
    renderAccount();
  });
  $("#account-button").addEventListener("click", showAccount);
  registerActions({
    login: () => showLogin(),
    register: () => showRegister(),
    "forgot-password": () => showEmailForm(),
    "resend-verification": () => showEmailForm(true),
  });
  window.addEventListener("hashchange", handleAuthLink);
  handleAuthLink();
  renderAccount();
}

import { renderTemplate } from "travel/ui/templates.js";
import { $ } from "travel/core/dom.js";
import { state } from "travel/core/state.js";
import { persist } from "travel/core/storage.js";
import { api, fetchJSON, logoutSession, clearSession } from "travel/core/api.js";
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

export async function showAccount() {
  if (!state.tokens) return showLogin();
  const user = state.tokens.user;
  const sessionVersion = state.sessionVersion;
  openModal(renderTemplate("account-details", {
    username: user?.username || "Loading…",
    email: user ? user.email || "No email address" : "Loading…",
    passwordUnavailable: !user?.email,
  }));
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
  try {
    const user = await api("auth/me/");
    if (!state.tokens || sessionVersion !== state.sessionVersion) return;
    state.tokens.user = user;
    persist("tp-session-v1", state.tokens, "sessionStorage");
    if (version !== modalVersion) return;
    $("#account-username").textContent = user.username;
    $("#account-email").textContent = user.email || "No email address";
    $('[data-action="change-password"]', $("#modal")).disabled = !user.email;
    $("#account-status").hidden = true;
  } catch (error) {
    if (version !== modalVersion) return;
    if (!user) {
      $("#account-username").textContent = "Unavailable";
      $("#account-email").textContent = "Unavailable";
    }
    $("#account-status").textContent = error.message;
    $('[data-action="account"]', $("#modal")).hidden = false;
  }
}

export function showChangePassword() {
  if (!state.tokens) return showLogin();
  const email = state.tokens.user?.email;
  if (!email) return showAccount();
  openModal(renderTemplate("account-password-email", { email }));
  const version = modalVersion;
  const sessionVersion = state.sessionVersion;
  bindForm(async () => {
    const result = await authRequest("password-reset/", { email });
    if (version !== modalVersion || sessionVersion !== state.sessionVersion) return;
    openModal(renderTemplate("account-password-email", { email, sent: true, message: result.detail }));
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

function showEmailNotice(message, registration = false) {
  openModal(renderTemplate("account-notice", { title: "Check your email.", message, registration }));
}

export function showRegister() {
  openModal(renderTemplate("account-register"));
  const version = modalVersion;
  bindForm(async (form) => {
    const result = await authRequest("register/", Object.fromEntries(form));
    if (version === modalVersion) showEmailNotice(result.detail, true);
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
    account: () => showAccount(),
    "change-password": () => showChangePassword(),
    login: () => showLogin(),
    register: () => showRegister(),
    "forgot-password": () => showEmailForm(),
    "resend-verification": () => showEmailForm(true),
  });
  window.addEventListener("hashchange", handleAuthLink);
  handleAuthLink();
  renderAccount();
}

import { state } from "travel/core/state.js";
import { events } from "travel/core/events.js";

export function requireSignIn(resume, message) {
  if (state.tokens) return true;
  events.dispatchEvent(new CustomEvent("sign-in-required", {
    detail: { resume, message },
  }));
  return false;
}

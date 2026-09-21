import { $ } from "travel/core/dom.js";
import { renderTemplate } from "travel/ui/templates.js";

let toastTimer;

export function toast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 4500);
}

export function loading(message) {
  return renderTemplate("loading-state", { message });
}

export function displayError(target, error, action) {
  $(target).innerHTML = renderTemplate("error-state", {
    message: error.message,
    action,
  });
}

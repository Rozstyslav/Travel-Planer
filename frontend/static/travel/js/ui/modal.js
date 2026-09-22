import { $ } from "travel/core/dom.js";
import { toast } from "travel/ui/feedback.js";

export const modal = $("#modal");
export let modalVersion = 0;
let lastFocus;

export function openModal(html, wide = false) {
  if (!modal.open) lastFocus = document.activeElement;
  modalVersion += 1;
  $("#modal-content").innerHTML = html;
  modal.classList.toggle("wide", wide);
  if (!modal.open) modal.showModal();
  document.body.classList.add("modal-open");
  modal.scrollTop = 0;
  requestAnimationFrame(() => {
    if (modal.open) ($("[autofocus]", modal) || $("#close-modal")).focus();
  });
}

export function closeModal() {
  modal.close();
}

export function formError(form, message) {
  let box = $(".form-error", form);
  if (!box) {
    box = document.createElement("p");
    box.className = "form-error";
    box.setAttribute("role", "alert");
    form.append(box);
  }
  box.textContent = message;
}

export function bindForm(handler) {
  const form = $("#modal-content form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $('button[type="submit"]', form);
    if (button.disabled) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Saving…";
    $(".form-error", form)?.remove();
    try {
      await handler(new FormData(form), form);
    } catch (error) {
      if (form.isConnected) formError(form, error.message);
      else toast(error.message);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
}

export function initModal() {
  $("#close-modal").addEventListener("click", closeModal);
  modal.addEventListener("close", () => {
    // The close event is queued: a successful login may already have reopened
    // the dialog for the requested action. Do not invalidate that new dialog.
    if (modal.open) return;
    modalVersion += 1;
    document.body.classList.remove("modal-open");
    if (lastFocus?.isConnected) lastFocus.focus();
    else $("#main").focus({ preventScroll: true });
  });
  modal.addEventListener("click", (e) => {
    const r = modal.getBoundingClientRect();
    if (
      e.target === modal &&
      (e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom)
    )
      closeModal();
  });
}

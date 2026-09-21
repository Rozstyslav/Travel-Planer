import { toast } from "travel/ui/feedback.js";

const actions = new Map();
export function registerActions(handlers) {
  for (const [name, handler] of Object.entries(handlers)) {
    if (actions.has(name)) throw new Error("Duplicate action: " + name);
    actions.set(name, handler);
  }
}
export function initActions() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;
    const handler = actions.get(button.dataset.action);
    if (!handler) return;
    try {
      await handler(button.dataset, button);
    } catch (error) {
      toast(error.message);
    }
  });
}

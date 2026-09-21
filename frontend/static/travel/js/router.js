import { $, $$ } from "travel/core/dom.js";

const views = new Map();
export function registerView(name, render) {
  views.set(name, render);
}

export function route() {
  const hash = location.hash.slice(1);
  const view = ["trips", "saved"].includes(hash) ? hash : "discover";
  $$(".view").forEach((el) => {
    el.hidden = el.id !== `${view}-view`;
  });
  $$("[data-nav]").forEach((el) => {
    el.classList.toggle("active", el.dataset.nav === view);
    if (el.dataset.nav === view) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  document.title = `${{ discover: "Travel with curiosity", trips: "Trips", saved: "Saved" }[view]} — Travel Planner`;
  views.get(view)?.();
  if (hash === "collection")
    requestAnimationFrame(() =>
      $("#collection").scrollIntoView({ behavior: "smooth" }),
    );
  else if (hash !== "main") window.scrollTo(0, 0);
}

export function navigate(hash) {
  if (location.hash === `#${hash}`) route();
  else location.hash = hash;
}

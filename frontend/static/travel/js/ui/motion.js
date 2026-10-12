const revealSelector = [
  ".section-heading", ".destination-form", ".journey-heading",
  ".journey-steps article", ".closing-banner", ".art-card", ".trip-card",
  ".city-option", ".city-story", ".empty-state",
].join(",");

export function initMotion() {
  const main = document.querySelector("#main");
  const hero = document.querySelector(".hero-visual");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const pointer = matchMedia("(hover: hover) and (pointer: fine) and (min-width: 901px)");
  const seen = new WeakSet();
  const pending = new Set();
  let frame = 0;
  let point = null;

  const reveal = (element) => {
    element.classList.add("is-visible");
    pending.delete(element);
    observer.unobserve(element);
  };
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) reveal(entry.target);
    }
  }, { threshold: 0.08 });

  function watch(root) {
    if (reduced.matches || !(root instanceof Element) || !root.isConnected) return;
    const elements = [...root.querySelectorAll(revealSelector)];
    if (root.matches(revealSelector)) elements.unshift(root);
    for (const element of elements) {
      if (seen.has(element) || !element.parentElement) continue;
      seen.add(element);
      const siblings = [...element.parentElement.children].filter((child) => child.matches(revealSelector));
      element.style.setProperty("--reveal-delay", `${Math.min(siblings.indexOf(element), 5) * 70}ms`);
      element.classList.add("motion-reveal");
      pending.add(element);
      observer.observe(element);
    }
  }

  // New search results and account cards use the same reveal as static sections.
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) watch(node);
    }
    for (const element of pending) {
      if (!element.isConnected) {
        pending.delete(element);
        observer.unobserve(element);
      }
    }
  }).observe(main, { childList: true, subtree: true });

  // Keyboard navigation makes a pending section visible immediately.
  main.addEventListener("focusin", (event) => {
    const element = event.target.closest(".motion-reveal:not(.is-visible)");
    if (element) {
      element.style.setProperty("--reveal-delay", "0ms");
      reveal(element);
    }
  });

  function resetHero() {
    point = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    hero?.style.setProperty("--hero-x", "0");
    hero?.style.setProperty("--hero-y", "0");
  }

  function drawHero() {
    frame = 0;
    if (!point || !hero) return;
    const rect = hero.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, (point.x - rect.left) / rect.width * 2 - 1));
    const y = Math.max(-1, Math.min(1, (point.y - rect.top) / rect.height * 2 - 1));
    hero.style.setProperty("--hero-x", x.toFixed(3));
    hero.style.setProperty("--hero-y", y.toFixed(3));
  }

  hero?.addEventListener("pointermove", (event) => {
    if (reduced.matches || !pointer.matches || event.pointerType === "touch") return;
    point = { x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(drawHero);
  });
  hero?.addEventListener("pointerleave", resetHero);
  hero?.addEventListener("pointercancel", resetHero);

  function configure() {
    resetHero();
    hero?.classList.toggle("motion-hero", !reduced.matches && pointer.matches);
    if (reduced.matches) {
      for (const element of pending) reveal(element);
    } else watch(main);
  }

  reduced.addEventListener("change", configure);
  pointer.addEventListener("change", configure);
  configure();
}

// Values are text/attributes by default. data-html is only for markup produced
// by our own renderers (also data-fragment); API data must use data-text or
// data-bind-* instead. data-fragment inserts markup without an extra wrapper.
export function renderTemplate(id, values = {}) {
  const template = document.getElementById(id);
  if (!(template instanceof HTMLTemplateElement)) {
    throw new Error(`Missing HTML template: ${id}`);
  }
  const container = document.createElement("div");
  container.append(template.content.cloneNode(true));
  for (const element of container.querySelectorAll(
    "[data-if], [data-unless]",
  )) {
    if (
      (element.hasAttribute("data-if") && !values[element.dataset.if]) ||
      (element.hasAttribute("data-unless") && values[element.dataset.unless])
    ) {
      element.remove();
    }
    element.removeAttribute("data-if");
    element.removeAttribute("data-unless");
  }
  for (const element of container.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      const value = values[attribute.value];
      if (attribute.name === "data-text") {
        element.textContent = value ?? "";
      } else if (attribute.name === "data-html") {
        element.innerHTML = value ?? "";
      } else if (attribute.name === "data-fragment") {
        element.outerHTML = value ?? "";
      } else if (attribute.name === "data-value") {
        if (element.tagName === "TEXTAREA") element.textContent = value ?? "";
        else element.setAttribute("value", value ?? "");
      } else if (attribute.name.startsWith("data-bind-")) {
        const name = attribute.name.slice("data-bind-".length);
        if (value === false || value == null) element.removeAttribute(name);
        else element.setAttribute(name, value === true ? "" : String(value));
      } else continue;
      element.removeAttribute(attribute.name);
    }
  }
  return container.innerHTML;
}

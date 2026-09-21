import { renderTemplate } from "travel/ui/templates.js";
import { $, $$, ASSETS, safeURL } from "travel/core/dom.js";
import { state, findPlace } from "travel/core/state.js";
import { detailedPlace } from "travel/core/places.js";
import { modal, modalVersion, openModal } from "travel/ui/modal.js";
import { events } from "travel/core/events.js";
import { registerActions } from "travel/core/actions.js";

export const placeImage = (p) =>
  safeURL(p?.image_url) || `${ASSETS}image-placeholder.svg`;
export const mapsLink = (p, label = "") => {
  if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return "";
  return renderTemplate("place-map-link", {
    url: `https://www.openstreetmap.org/?mlat=${p.latitude}&mlon=${p.longitude}#map=17/${p.latitude}/${p.longitude}`,
    ariaLabel: `Open ${p.name} in OpenStreetMap`,
    label:
      label ||
      `${p.latitude.toFixed(4)}\u00b0, ${p.longitude.toFixed(4)}\u00b0 \u00b7 OpenStreetMap \u2197`,
  });
};
const photoQueue = [];
let activePhotos = 0;
export const photoObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      photoObserver.unobserve(entry.target);
      photoQueue.push(entry.target);
    }
    loadCardPhotos();
  },
  { rootMargin: "150px" },
);
export function observePhotos(selector) {
  $$(`${selector} .art-card`).forEach((element) => {
    if (!state.details.has(element.dataset.placeId))
      photoObserver.observe(element);
  });
}

export function photoCredit(p) {
  const source = safeURL(p.image_source_url || p.wikipedia_url);
  if (!p.image_url || !source) return "";
  return renderTemplate("place-photo-credit", {
    search: p.image_match === "search",
    url: source,
  });
}

export function loadCardPhotos() {
  while (activePhotos < 2 && photoQueue.length) {
    const element = photoQueue.shift();
    if (!element.isConnected) continue;
    if (!element.getClientRects().length) {
      photoObserver.observe(element);
      continue;
    }
    activePhotos++;
    detailedPlace(element.dataset.placeId)
      .then((p) => {
        if (!element.isConnected) return;
        const image = safeURL(p.image_url);
        const button = $(".art-image-button", element);
        if (image) {
          button.innerHTML = renderTemplate("place-photo", {
            image,
            name: p.name,
          });
          $(".card-image-credit", element).innerHTML = photoCredit(p);
        }
      })
      // The category illustration stays useful even if photo lookup fails.
      .catch(() => {})
      .finally(() => {
        activePhotos--;
        loadCardPhotos();
      });
  }
}
export const categories = {
  "tourism.sights": "Sights",
  "entertainment.museum": "Museums",
  "leisure.park": "Parks",
  "catering.cafe": "Cafés",
  "catering.restaurant": "Restaurants",
};
const placeKinds = [
  {
    prefix: "entertainment.museum",
    label: "Museum",
    tone: "clay",
    path: '<path d="m3 9 9-5 9 5M4 10h16M6 10v8m6-8v8m6-8v8M3 20h18"/>',
  },
  {
    prefix: "leisure.park",
    label: "Park",
    tone: "sage",
    path: '<path d="M12 21v-5m0 0c-9 3-11-6-5-8-1-7 11-7 10 0 6 2 4 11-5 8Z"/>',
  },
  {
    prefix: "catering.cafe",
    label: "Café",
    tone: "sand",
    path: '<path d="M4 8h12v6a6 6 0 0 1-12 0V8Zm12 1h2a3 3 0 0 1 0 6h-2M3 22h15M7 3v2m5-2v2"/>',
  },
  {
    prefix: "catering.restaurant",
    label: "Restaurant",
    tone: "sand",
    path: '<path d="M5 3v6m3-6v6M2 3v6a3 3 0 0 0 6 0m-3 3v9M20 3c-4 2-5 7-5 10h5m0-10v18"/>',
  },
  {
    prefix: "tourism",
    label: "Sight",
    tone: "blue",
    path: '<path d="M4 21h16M6 21V10h12v11M9 10V6h6v4m-3-4V2M9 14h.01M15 14h.01M10 21v-4h4v4"/>',
  },
];
export function placeKind(p) {
  return (
    placeKinds.find((kind) =>
      (p.categories || []).some((category) => category.startsWith(kind.prefix)),
    ) || {
      label: "Place",
      tone: "sage",
      path: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
    }
  );
}

export function placeIllustration(p) {
  const kind = placeKind(p);
  return renderTemplate("place-illustration", {
    className: `place-illustration tone-${kind.tone}`,
    path: kind.path,
  });
}

export function wikiAttribution(url) {
  const safe = safeURL(url);
  if (!safe) return "";
  return renderTemplate("place-wiki-credit", { url: safe });
}

export function card(p) {
  const saved = state.saved.has(p.place_id);
  return renderTemplate("place-card", {
    id: p.place_id,
    name: p.name,
    category: placeKind(p).label,
    image: safeURL(p.image_url),
    imageTitle: p.wikipedia_title || p.name,
    address: p.address || p.city || p.country_code,
    illustration: placeIllustration(p),
    photoCredit: photoCredit(p),
    map: mapsLink(p, "View on map \u2197"),
    saved: String(saved),
    detailLabel: `More about: ${p.name}`,
    addLabel: `Add to trip: ${p.name}`,
    saveLabel: `${saved ? "Remove from saved" : "Save"}: ${p.name}`,
  });
}

export function placeStory(p) {
  let description =
    typeof p.description === "string" ? p.description.trim() : "";
  if (!description) return "";
  if (p.description_source === "Wikidata") {
    description = description.charAt(0).toUpperCase() + description.slice(1);
    if (!/[.!?]$/.test(description)) description += ".";
  }
  const paragraphs = (text) =>
    text
      .split(/\n+/)
      .filter(Boolean)
      .map((paragraph) =>
        renderTemplate("place-story-paragraph", { text: paragraph }),
      )
      .join("");
  let content = paragraphs(description);
  if (description.length > 500) {
    const sentenceEnd = description.lastIndexOf(". ", 360);
    const wordEnd = description.lastIndexOf(" ", 360);
    const cut =
      sentenceEnd >= 120 ? sentenceEnd + 1 : wordEnd > 0 ? wordEnd : 360;
    const preview = description.slice(0, cut).trim();
    content =
      paragraphs(preview + (/[.!?]$/.test(preview) ? "" : "\u2026")) +
      renderTemplate("place-story-more", {
        content: paragraphs(description.slice(cut).trim()),
      });
  }
  return renderTemplate("place-story", {
    search: p.wikipedia_match === "search",
    title: p.wikipedia_match === "search" ? p.wikipedia_title : "",
    content,
  });
}

export function detailSources(p) {
  const source = p.description_source || "Wikipedia";
  const wikidata = source === "Wikidata";
  return renderTemplate("place-sources", {
    descriptionURL: p.description
      ? safeURL(p.description_url || p.wikipedia_url)
      : "",
    source,
    licenceURL: `https://creativecommons.org/${wikidata ? "publicdomain/zero/1.0/" : "licenses/by-sa/4.0/"}`,
    licence: wikidata ? "CC0" : "CC BY-SA 4.0",
    photoCredit: photoCredit(p),
  });
}

export async function showPlace(id, refresh = false) {
  openModal(renderTemplate("place-detail-loading"));
  const version = modalVersion;
  try {
    const p = await detailedPlace(
      id,
      refresh || state.details.get(id)?.wikipedia_status === "unavailable",
    );
    if (version !== modalVersion) return;
    const image = safeURL(p.image_url);
    const kind = placeKind(p);
    const address = p.address?.startsWith(`${p.name}, `)
      ? p.address.slice(p.name.length + 2)
      : p.address;
    openModal(
      renderTemplate("place-detail", {
        id,
        name: p.name,
        image,
        address,
        detailClass: image ? "art-detail" : "art-detail text-only",
        illustration: placeIllustration(p),
        category: [kind.label, p.city, p.country_code]
          .filter(Boolean)
          .join(" \u00b7 "),
        story: placeStory(p),
        sources: detailSources(p),
        retry: !p.description && p.wikipedia_status === "unavailable",
        map: mapsLink(p, "View on map \u2197"),
      }),
      Boolean(image),
    );
    events.dispatchEvent(new Event("place-details-shown"));
  } catch (error) {
    if (version === modalVersion)
      openModal(
        renderTemplate("place-detail-error", { id, message: error.message }),
      );
  }
}

export function initPlaces() {
  registerActions({
    "place-detail": ({ id }) => showPlace(id),
    "retry-description": ({ id }) => showPlace(id, true),
  });
  document.addEventListener(
    "error",
    (e) => {
      const img = e.target;
      if (img.tagName === "IMG" && !img.dataset.fallback) {
        if (img.classList.contains("detail-photo")) {
          img.closest(".art-detail").classList.add("text-only");
          modal.classList.remove("wide");
          img.remove();
          return;
        }
        const card = img.closest(".art-card");
        if (card) {
          const p = findPlace(card.dataset.placeId);
          img.parentElement.innerHTML = placeIllustration(p || {});
          $(".card-image-credit", card).textContent = "";
          return;
        }
        img.dataset.fallback = "true";
        img.src = `${ASSETS}image-placeholder.svg`;
      }
    },
    true,
  );
}

import { state } from "travel/core/state.js";
import { discovery } from "travel/core/api.js";
import { events } from "travel/core/events.js";

export function samePlace(a, b) {
  if (a.place_id === b.place_id || (a.source_id && a.source_id === b.source_id))
    return true;
  const distance =
    111320 *
    Math.hypot(
      a.latitude - b.latitude,
      (a.longitude - b.longitude) *
        Math.cos(((a.latitude + b.latitude) * Math.PI) / 360),
    );
  if (distance > 150) return false;
  for (const field of ["wikidata_id", "wikipedia_link"]) {
    if (a[field] && b[field]) return a[field] === b[field];
  }
  const normalize = (name) =>
    (
      name
        .normalize("NFKC")
        .toLowerCase()
        .match(/[\p{L}\p{N}_]+/gu) || []
    ).join(" ");
  const names = (p) =>
    [p.name, ...(p.name_aliases || [])].filter(Boolean).map(normalize);
  const aliases = new Set(names(a));
  return names(b).some((name) => aliases.has(name));
}

export function uniquePlaces(places) {
  const result = [];
  for (const p of places) {
    const existing = result.find((item) => samePlace(item, p));
    if (!existing) result.push({ ...p });
    else {
      existing.name_aliases = [
        ...new Set([
          existing.name,
          ...(existing.name_aliases || []),
          p.name,
          ...(p.name_aliases || []),
        ]),
      ];
      if (!existing.english_name && p.english_name)
        existing.name = existing.english_name = p.english_name;
    }
  }
  return result;
}

export async function detailedPlace(id, refresh = false) {
  if (!refresh && state.details.has(id)) return state.details.get(id);
  if (state.detailRequests.has(id)) return state.detailRequests.get(id);
  const request = fetchPlaceDetails(id).finally(() =>
    state.detailRequests.delete(id),
  );
  state.detailRequests.set(id, request);
  return request;
}

export async function fetchPlaceDetails(id) {
  const p = await discovery(`places/${encodeURIComponent(id)}/`);
  const listed = state.places.find((item) => item.place_id === id);
  if (listed?.english_name && !p.english_name) {
    p.name = p.english_name = listed.english_name;
  }
  state.details.set(id, p);
  if (state.saved.has(id)) {
    state.saved.set(id, p);
    events.dispatchEvent(new Event("saved-changed"));
  }
  return p;
}

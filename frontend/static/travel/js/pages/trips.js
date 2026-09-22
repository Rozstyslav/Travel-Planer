import { renderTemplate } from "travel/ui/templates.js";
import { $, $$ } from "travel/core/dom.js";
import {
  state,
  projects,
  project,
  isComplete,
  findPlace,
} from "travel/core/state.js";
import { requireSignIn } from "travel/core/auth.js";
import { api, discovery } from "travel/core/api.js";
import { detailedPlace } from "travel/core/places.js";
import { tripCover, cityCover } from "travel/core/trip-cover.js";
import { createCityCoverLookup } from "travel/core/trip-cover-lookup.js";
import {
  placeImage,
  mapsLink,
  photoCredit,
  wikiAttribution,
} from "travel/components/places.js";
import {
  modal,
  modalVersion,
  openModal,
  closeModal,
  bindForm,
} from "travel/ui/modal.js";
import { toast } from "travel/ui/feedback.js";
import { renderAccount } from "travel/ui/workspace.js";
import { events } from "travel/core/events.js";
import { navigate, registerView } from "travel/router.js";
import { registerActions } from "travel/core/actions.js";

let loadVersion = 0;
const lookupCityCover = createCityCoverLookup(
  async (q) => (await discovery("cities/", { q })).results,
  cityCover,
);

function localTripCover(p) {
  return tripCover(p.name, { countries: state.countries, places: p.places });
}

function renderTripCover(p, cover) {
  return renderTemplate("trip-card-cover", {
    stopCount: String(p.places.length).padStart(2, "0"),
    stopLabel: p.places.length === 1 ? "place" : "places",
    cover,
    coverIcon: cover?.icon,
    coverFlag: cover?.flag,
    coverTone: cover?.tone,
    coverLabel: cover?.label,
  });
}

function refreshTripCovers() {
  if ($("#trips-view").hidden) return;
  $$("#trips-grid .trip-card").forEach((card) => {
    const p = project(card.dataset.tripId);
    if (!p) return;
    const cover = localTripCover(p);
    if (cover) {
      $(".trip-cover", card).outerHTML = renderTripCover(p, cover);
      return;
    }
    const name = p.name;
    lookupCityCover(name).then((resolved) => {
      if (!resolved || !card.isConnected || project(p.id)?.name !== name) return;
      // Late city results must not replace newer country/place information.
      $(".trip-cover", card).outerHTML = renderTripCover(p, localTripCover(p) || resolved);
    });
  });
}
export function cancelProjectLoad() {
  loadVersion += 1;
}
export function formatDate(value) {
  if (!value) return "Date to be decided";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? "Date to be decided"
    : date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

export function renderTrips() {
  renderAccount();
  $(".trips-toolbar").hidden = !state.tokens;
  if (!state.tokens) {
    $("#trip-total").textContent = "";
    $("#trips-grid").innerHTML = renderTemplate("trips-guest");
    return;
  }
  const all = projects();
  const list = all.filter(
    (p) =>
      state.tripFilter === "all" ||
      (state.tripFilter === "complete" ? isComplete(p) : !isComplete(p)),
  );
  $("#trip-total").textContent = `Trips: ${all.length}`;
  $("#trips-grid").innerHTML = list.length
    ? list
        .map((p) => {
          const visited = p.places.filter((place) => place.visited).length;
          return renderTemplate("trip-card", {
            id: p.id,
            name: p.name,
            description: p.description,
            complete: isComplete(p),
            date: formatDate(p.start_date),
            visited,
            total: p.places.length,
            maxStops: Math.max(1, p.places.length),
            progressStyle: `width:${p.places.length ? (visited / p.places.length) * 100 : 0}%`,
            coverMarkup: renderTripCover(p, localTripCover(p)),
          });
        })
        .join("")
    : renderTemplate(all.length ? "trips-filter-empty" : "trips-empty");
  refreshTripCovers();
}

export async function loadProjects() {
  if (!state.tokens) {
    renderTrips();
    return;
  }
  const version = ++loadVersion;
  $("#trips-grid").innerHTML = renderTemplate("trips-loading");
  try {
    const data = await api("projects/");
    if (version !== loadVersion || !state.tokens) return;
    state.remote = Array.isArray(data) ? data : data.results || [];
    state.loaded = true;
    renderTrips();
  } catch (error) {
    if (version !== loadVersion) return;
    $("#trips-grid").innerHTML = renderTemplate("trips-error", {
      message: error.message,
    });
  }
}

export function upsertProject(p) {
  if (!state.tokens) return;
  const list = projects();
  const index = list.findIndex((item) => String(item.id) === String(p.id));
  if (index < 0) list.unshift(p);
  else list[index] = p;
  renderTrips();
}

export function showProjectForm(id = null, selectedPlace = null) {
  if (!requireSignIn(() => showProjectForm(id, selectedPlace), "Sign in to create and manage your own trips.")) return;
  const p = id ? project(id) : null;
  openModal(
    renderTemplate("trip-form", {
      editing: Boolean(p),
      id: p?.id,
      name: p?.name || "",
      startDate: p?.start_date || "",
      description: p?.description || "",
      selectedPlace: selectedPlace ? findPlace(selectedPlace).name : "",
      cancelAction: p ? "trip-detail" : "close",
    }),
  );
  const version = modalVersion;
  bindForm(async (data) => {
    const name = data.get("name").trim();
    if (!name) throw new Error("Give your trip a name.");
    const payload = {
      name,
      start_date: data.get("start_date") || null,
      description: data.get("description").trim(),
    };
    if (!p) payload.places = selectedPlace ? [{ place_id: selectedPlace }] : [];
    const result = await api(p ? `projects/${p.id}/` : "projects/", {
      method: p ? "PATCH" : "POST",
      body: JSON.stringify(payload),
    });
    upsertProject(result);
    navigate("trips");
    if (version === modalVersion) showTrip(result.id);
    toast(p ? "Details updated." : "Your next adventure starts here!");
  });
}

export function showNotes(projectId, placeId) {
  if (!requireSignIn(() => loadProjects(), "Sign in to edit your trip notes.")) return;
  const p = project(projectId);
  const place = p.places.find((item) => String(item.id) === String(placeId));
  openModal(
    renderTemplate("trip-notes-form", {
      id: p.id,
      name: place.name,
      notes: place.notes,
    }),
  );
  bindForm(async (data) => {
    const patch = { notes: data.get("notes").trim() };
    await api(`projects/${p.id}/places/${place.id}/`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    Object.assign(place, patch);
    upsertProject(p);
    showTrip(p.id);
    toast("Note saved.");
  });
}

export function confirmDelete(id) {
  if (!requireSignIn(() => loadProjects(), "Sign in to manage your trips.")) return;
  const p = project(id);
  if (p.places.some((place) => place.visited)) {
    toast("A trip with visited places cannot be deleted.");
    return;
  }
  openModal(renderTemplate("trip-delete-form", { id, name: p.name }));
  bindForm(async () => {
    await api(`projects/${p.id}/`, { method: "DELETE" });
    state.remote = state.remote.filter((item) => item.id !== p.id);
    renderTrips();
    closeModal();
    toast("Trip deleted. New adventures await.");
  });
}

export async function showAddPlace(id) {
  if (!requireSignIn(() => showAddPlace(id), "Sign in to add this place to a trip.")) return;
  const sessionVersion = state.sessionVersion;
  openModal(renderTemplate("trip-add-place-loading"));
  const version = modalVersion;
  try {
    const place = await detailedPlace(id);
    if (!state.tokens || sessionVersion !== state.sessionVersion || version !== modalVersion) return;
    if (!state.loaded) {
      const data = await api("projects/");
      state.remote = Array.isArray(data) ? data : data.results;
      state.loaded = true;
    }
    if (version !== modalVersion) return;
    const list = projects().filter(
      (p) =>
        p.places.length < 10 &&
        !p.places.some(
          (item) => item.place_id === id || item.source_id === place.source_id,
        ),
    );
    openModal(
      renderTemplate("trip-add-place", {
        id,
        name: place.name,
        hasTrips: list.length > 0,
        options: list
          .map((p) =>
            renderTemplate("trip-select-option", {
              id: p.id,
              label: `${p.name} · ${p.places.length}/10`,
            }),
          )
          .join(""),
      }),
    );
    if (list.length)
      bindForm(async (data) => {
        const p = data.get("project_id");
        await addPlace(p, id);
        if (modal.open) showTrip(p);
      });
  } catch (error) {
    if (version === modalVersion)
      openModal(
        renderTemplate("trip-add-place-error", { id, message: error.message }),
      );
  }
}

export async function addPlace(projectId, id) {
  if (!requireSignIn(() => showAddPlace(id), "Sign in to add this place to a trip.")) return;
  const sessionVersion = state.sessionVersion;
  const p = project(projectId);
  if (!p) throw new Error("Trip not found.");
  if (p.places.length >= 10) throw new Error("A trip can have up to 10 stops.");
  const detail = await detailedPlace(id);
  if (!state.tokens || sessionVersion !== state.sessionVersion)
    throw new Error("Your session has changed. Please try again.");
  if (
    p.places.some(
      (item) => item.place_id === id || item.source_id === detail.source_id,
    )
  )
    throw new Error("This place is already in the trip.");
  const place = await api(`projects/${p.id}/places/`, {
    method: "POST",
    body: JSON.stringify({ place_id: id }),
  });
  p.places.push(place);
  upsertProject(p);
  toast("Stop added to your trip.");
}

export function showTrip(id) {
  if (!requireSignIn(() => loadProjects(), "Sign in to view your trips.")) return;
  const p = project(id);
  if (!p) {
    toast("Trip not found.");
    return;
  }
  const visited = p.places.filter((item) => item.visited).length;
  const stops = p.places
    .map((place, index) =>
      renderTemplate("trip-stop", {
        id: place.id,
        projectId: id,
        number: String(index + 1).padStart(2, "0"),
        name: place.name,
        address: place.address,
        notes: place.notes,
        visited: place.visited,
        image: placeImage(place),
        imageTitle: place.wikipedia_title || place.name,
        map: mapsLink(place),
        photoCredit: photoCredit(place),
        wikiCredit: wikiAttribution(place.wikipedia_url),
      }),
    )
    .join("");
  openModal(
    renderTemplate("trip-detail", {
      id,
      name: p.name,
      date: formatDate(p.start_date),
      description: p.description,
      archived: p.archived_place_count,
      visited,
      total: p.places.length,
      stops,
      full: p.places.length >= 10,
      protected: Boolean(visited),
    }),
    true,
  );
}

export function initTrips() {
  events.addEventListener("countries-loaded", refreshTripCovers);
  registerView("trips", () => {
    if (state.tokens && !state.loaded) loadProjects();
    else renderTrips();
  });
  events.addEventListener("session-expired", () => {
    cancelProjectLoad();
    renderTrips();
  });
  registerActions({
    "create-trip": () => showProjectForm(),
    "create-with-place": ({ id }) => showProjectForm(null, id),
    "edit-trip": ({ id }) => showProjectForm(id),
    "trip-detail": ({ id }) => showTrip(id),
    "edit-notes": ({ id, project }) => showNotes(project, id),
    "delete-trip": ({ id }) => confirmDelete(id),
    "retry-trips": () => loadProjects(),
    "add-place": ({ id }) => showAddPlace(id),
  });
  document.addEventListener("change", async (event) => {
    const input = event.target.closest("[data-visited]");
    if (!input) return;
    if (!requireSignIn(() => loadProjects(), "Sign in to update your trips.")) return;
    const p = project(input.dataset.project);
    const place = p.places.find(
      (item) => String(item.id) === input.dataset.visited,
    );
    const checked = input.checked;
    const version = modalVersion;
    input.disabled = true;
    try {
      await api(`projects/${p.id}/places/${place.id}/`, {
        method: "PATCH",
        body: JSON.stringify({ visited: checked }),
      });
      place.visited = checked;
      upsertProject(p);
      if (version === modalVersion) {
        showTrip(p.id);
        $(`[data-visited="${CSS.escape(String(place.id))}"]`)?.focus();
      }
      toast(
        checked
          ? "Another place in your story."
          : "Place marked as not visited.",
      );
    } catch (error) {
      input.checked = !checked;
      toast(error.message);
    } finally {
      input.disabled = false;
    }
  });
  $$("[data-trip-filter]").forEach((button) =>
    button.addEventListener("click", () => {
      state.tripFilter = button.dataset.tripFilter;
      $$("[data-trip-filter]").forEach((el) => {
        el.classList.toggle("active", el === button);
        el.setAttribute("aria-pressed", String(el === button));
      });
      renderTrips();
    }),
  );
}

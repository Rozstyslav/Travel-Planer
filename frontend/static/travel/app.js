/* Countries → cities → places → Wikipedia → travel projects. */
(() => {
  "use strict";
  const ASSETS = "/static/travel/";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [
    ...root.querySelectorAll(selector),
  ];
  const escapeHTML = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const safeURL = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  };
  const readArray = (key) => {
    const value = readStored(key, []);
    return Array.isArray(value) ? value : [];
  };
  const validPlace = (p) =>
    p &&
    typeof p.place_id === "string" &&
    typeof p.name === "string" &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude);
  const state = {
    saved: new Map(
      readArray("tp-saved-v2")
        .filter(validPlace)
        .map((p) => [p.place_id, p]),
    ),
    local: readArray("tp-trips-v2").filter(
      (p) =>
        p &&
        typeof p.name === "string" &&
        Array.isArray(p.places) &&
        p.places.every(validPlace),
    ),
    remote: [],
    tokens: readStored("tp-session-v1", null, "sessionStorage"),
    loaded: false,
    countries: [],
    cities: [],
    city: null,
    places: [],
    details: new Map(),
    detailRequests: new Map(),
    category: "tourism.sights",
    tripFilter: "all",
    offset: 0,
    hasMore: false,
    searchVersion: 0,
    cityVersion: 0,
    countryVersion: 0,
  };
  if (!state.tokens?.access || !state.tokens?.refresh) state.tokens = null;
  const modal = $("#modal");
  let toastTimer,
    refreshPromise,
    loadVersion = 0,
    modalVersion = 0,
    lastFocus;
  const projects = () => (state.tokens ? state.remote : state.local);
  const project = (id) => projects().find((p) => String(p.id) === String(id));
  const isComplete = (p) =>
    p.places.length > 0 && p.places.every((place) => place.visited);
  const findPlace = (id) =>
    state.details.get(id) ||
    state.saved.get(id) ||
    state.places.find((p) => p.place_id === id);
  const placeImage = (p) =>
    safeURL(p?.image_url) || `${ASSETS}image-placeholder.svg`;
  const mapsLink = (p) => {
    if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude))
      return "";
    return `<a class="text-link coordinates-link" href="https://www.openstreetmap.org/?mlat=${p.latitude}&amp;mlon=${p.longitude}#map=17/${p.latitude}/${p.longitude}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHTML(p.name)} in OpenStreetMap">${p.latitude.toFixed(4)}°, ${p.longitude.toFixed(4)}° · OpenStreetMap ↗</a>`;
  };
  function samePlace(a, b) {
    if (
      a.place_id === b.place_id ||
      (a.source_id && a.source_id === b.source_id)
    )
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
  function uniquePlaces(places) {
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
  const photoQueue = [];
  let activePhotos = 0;
  const photoObserver = new IntersectionObserver(
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

  function observePhotos(selector) {
    $$(`${selector} .art-card`).forEach((element) => {
      if (!state.details.has(element.dataset.placeId))
        photoObserver.observe(element);
    });
  }

  function photoCredit(p) {
    const source = safeURL(p.image_source_url || p.wikipedia_url);
    if (!p.image_url || !source) return "";
    return `${p.image_match === "search" ? "Photo found by name · check the match.<br>" : ""}<a class="text-link" href="${escapeHTML(source)}" target="_blank" rel="noopener noreferrer">Wikimedia photo · source and licence ↗</a>`;
  }

  function photoPlaceholder(p) {
    return state.details.has(p.place_id)
      ? "No photo available for this place"
      : "Finding a photo…";
  }

  function loadCardPhotos() {
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
            button.innerHTML = `<img src="${escapeHTML(image)}" alt="${escapeHTML(p.name)}" loading="lazy">`;
            $(".card-image-credit", element).innerHTML = photoCredit(p);
          } else {
            $(".location-art small", element).textContent =
              "No photo available for this place";
          }
        })
        .catch(() => {
          const caption = $(".location-art small", element);
          if (caption) caption.textContent = "Photo temporarily unavailable";
        })
        .finally(() => {
          activePhotos--;
          loadCardPhotos();
        });
    }
  }
  const localPlace = (p) => ({
    ...p,
    id: crypto.randomUUID(),
    notes: "",
    visited: false,
  });
  const categories = {
    "tourism.sights": "Sights",
    "entertainment.museum": "Museums",
    "leisure.park": "Parks",
    "catering.cafe": "Cafés",
    "catering.restaurant": "Restaurants",
  };

  function readStored(key, fallback, storage = "localStorage") {
    try {
      return JSON.parse(window[storage].getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function persist(key, value, storage = "localStorage") {
    try {
      window[storage].setItem(key, JSON.stringify(value));
      return true;
    } catch {
      toast(
        "Browser storage is unavailable. Changes will last only until you close this page.",
      );
      return false;
    }
  }

  function toast(message) {
    clearTimeout(toastTimer);
    $("#toast").textContent = message;
    $("#toast").hidden = false;
    toastTimer = setTimeout(() => {
      $("#toast").hidden = true;
    }, 4500);
  }

  function openModal(html, wide = false) {
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

  function closeModal() {
    modal.close();
  }

  function emptyState(title, message, button = "", action = "") {
    return `<div class="empty-state"><span class="empty-symbol" aria-hidden="true">✳</span><h2>${escapeHTML(title)}</h2><p>${escapeHTML(message)}</p>${button ? `<button class="button button-dark" data-action="${action}">${escapeHTML(button)} <span aria-hidden="true">↗</span></button>` : ""}</div>`;
  }

  function renderAccount() {
    $("#account-label").textContent = state.tokens ? "Account" : "Sign in";
    $("#workspace-note").innerHTML = state.tokens
      ? '<span><span class="status-dot"></span>Shared workspace: trips are saved on the server and available to signed-in users.</span>'
      : '<span><span class="status-dot"></span>Guest workspace. Trips are saved only in this browser.</span><button data-action="login">Sign in to the workspace ↗</button>';
  }

  function formatDate(value) {
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

  function renderTrips() {
    renderAccount();
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
            const progress = p.places.length
              ? (visited / p.places.length) * 100
              : 0;
            const cover = p.places.length
              ? placeImage(p.places[0])
              : `${ASSETS}images/chicago.jpg`;
            return `<article class="trip-card"><img class="trip-cover" src="${escapeHTML(cover)}" alt="" loading="lazy"><div class="trip-body"><div class="trip-topline"><span>${isComplete(p) ? "✓ VISITED" : "↗ PLANNED"}</span><span>${escapeHTML(formatDate(p.start_date))}</span></div><h2>${escapeHTML(p.name)}</h2><p class="trip-description">${escapeHTML(p.description || "A new route, new stories. Add places you want to see.")}</p><div class="progress-track" role="progressbar" aria-label="Trip progress" aria-valuenow="${visited}" aria-valuemin="0" aria-valuemax="${Math.max(1, p.places.length)}"><span style="width:${progress}%"></span></div><div class="trip-bottom"><span class="muted">Visited ${visited} of ${p.places.length}</span><button class="text-link title-button" data-action="trip-detail" data-id="${escapeHTML(p.id)}">Open itinerary ↗</button></div></div></article>`;
          })
          .join("")
      : emptyState(
          all.length ? "Nothing here yet" : "It starts with curiosity",
          all.length
            ? "Trips with this status will appear here."
            : "Give your next adventure a name. Then add the places you dream of seeing.",
          "Create trip",
          "create-trip",
        );
  }

  function errorMessage(data, status) {
    if (status === 429)
      return "Too many requests. Wait a minute and try again.";
    if (data?.code === "provider_configuration")
      return "Search is temporarily unavailable. Please try again later.";
    if (status === 401)
      return "Your session has expired. Please sign in again.";
    if (status >= 500)
      return "The service is temporarily unavailable. Please try again later.";
    const messages =
      typeof data === "object" && data
        ? Object.values(data).flat().join(" ")
        : "";
    const translations = [
      [/visited/i, "Unmark visited places before deleting this trip."],
      [
        /duplicate|already|more than once/i,
        "This place is already in the trip.",
      ],
      [/10|maximum|limit/i, "A trip can have up to 10 stops."],
      [
        /not found|does not exist/i,
        "This record could not be found. Refresh the page and try again.",
      ],
    ];
    return (
      translations.find(([regex]) => regex.test(messages))?.[1] ||
      (status === 400
        ? "Check your details and try again."
        : "Something went wrong. Please try again.")
    );
  }

  async function fetchJSON(url, options = {}) {
    let response;
    try {
      response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new Error(
        "Cannot connect to the server. Check your connection and try again.",
      );
    }
    const data =
      response.status === 204 ? null : await response.json().catch(() => null);
    return { response, data };
  }

  async function refreshSession() {
    if (!refreshPromise) {
      const previous = state.tokens;
      refreshPromise = (async () => {
        const { response, data } = await fetchJSON("/api/auth/token/refresh/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh: previous.refresh }),
        });
        if (state.tokens !== previous)
          throw new Error("Your session has changed. Please try again.");
        if (!response.ok) {
          if (response.status === 401 || response.status === 400) {
            state.tokens = null;
            state.remote = [];
            state.loaded = false;
            persist("tp-session-v1", null, "sessionStorage");
            renderTrips();
          }
          throw new Error(errorMessage(data, response.status));
        }
        state.tokens = {
          access: data.access,
          refresh: data.refresh || previous.refresh,
        };
        persist("tp-session-v1", state.tokens, "sessionStorage");
      })().finally(() => {
        refreshPromise = null;
      });
    }
    return refreshPromise;
  }

  async function api(path, options = {}, retry = true) {
    if (!state.tokens) throw new Error("Please sign in to continue.");
    const { response, data } = await fetchJSON(`/api/${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.tokens.access}`,
        ...options.headers,
      },
    });
    if (response.status === 401 && retry) {
      await refreshSession();
      return api(path, options, false);
    }
    if (!response.ok) throw new Error(errorMessage(data, response.status));
    return data;
  }

  async function loadProjects() {
    if (!state.tokens) {
      renderTrips();
      return;
    }
    const version = ++loadVersion;
    $("#trips-grid").innerHTML =
      '<div class="loading-state" role="status">Loading your trips…</div>';
    try {
      const data = await api("projects/");
      if (version !== loadVersion || !state.tokens) return;
      state.remote = Array.isArray(data) ? data : data.results || [];
      state.loaded = true;
      renderTrips();
    } catch (error) {
      if (version !== loadVersion) return;
      $("#trips-grid").innerHTML =
        `<div class="empty-state error-state"><span class="empty-symbol">↻</span><h2>Could not load your trips</h2><p>${escapeHTML(error.message)}</p><button class="button button-dark" data-action="retry-trips">Try again</button></div>`;
    }
  }

  function route() {
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
    if (view === "trips") {
      if (state.tokens && !state.loaded) loadProjects();
      else renderTrips();
    }
    if (view === "saved") renderSaved();
    if (hash === "collection")
      requestAnimationFrame(() =>
        $("#collection").scrollIntoView({ behavior: "smooth" }),
      );
    else if (hash !== "main") window.scrollTo(0, 0);
  }

  function navigate(hash) {
    if (location.hash === `#${hash}`) route();
    else location.hash = hash;
  }

  function formError(form, message) {
    let box = $(".form-error", form);
    if (!box) {
      box = document.createElement("p");
      box.className = "form-error";
      box.setAttribute("role", "alert");
      form.append(box);
    }
    box.textContent = message;
  }

  function bindForm(handler) {
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

  function showLogin() {
    openModal(
      '<h2 id="modal-title">Welcome back.</h2><p class="modal-description">Sign in to manage trips in the shared workspace. Your guest trips will stay in this browser.</p><form><label class="form-field">Username<input name="username" autocomplete="username" required maxlength="150" autofocus></label><label class="form-field">Password<input name="password" type="password" autocomplete="current-password" required></label><p class="form-help">Use an existing account, or continue as a guest.</p><div class="form-actions"><button type="button" class="button button-outline" data-action="close">Continue as guest</button><button type="submit" class="button button-dark">Sign in ↗</button></div></form>',
    );
    const version = modalVersion;
    bindForm(async (formData) => {
      const { response, data } = await fetchJSON("/api/auth/token/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(formData)),
      });
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? "Incorrect username or password."
            : errorMessage(data, response.status),
        );
      state.tokens = data;
      state.loaded = false;
      persist("tp-session-v1", data, "sessionStorage");
      renderAccount();
      if (version === modalVersion) closeModal();
      if (location.hash === "#trips") await loadProjects();
      else navigate("trips");
      toast("You’re in the shared workspace. Time to plan!");
    });
  }

  function showAccount() {
    if (!state.tokens) return showLogin();
    openModal(
      '<h2 id="modal-title">Your travel workspace.</h2><p class="modal-description">You’re using the shared workspace. Trips are saved on the server. Bookmarks and guest trips stay in this browser.</p><form><div class="form-actions"><button type="button" class="button button-outline" data-action="close">Continue</button><button type="submit" class="button button-dark">Sign out ↗</button></div></form>',
    );
    bindForm(async () => {
      await api("auth/logout/", {
        method: "POST",
        body: JSON.stringify({ refresh: state.tokens.refresh }),
      });
      state.tokens = null;
      state.remote = [];
      state.loaded = false;
      loadVersion += 1;
      persist("tp-session-v1", null, "sessionStorage");
      renderTrips();
      closeModal();
      toast("You’re in the guest workspace.");
    });
  }

  function saveLocal() {
    persist("tp-trips-v2", state.local);
  }

  function upsertProject(p) {
    const list = projects();
    const index = list.findIndex((item) => String(item.id) === String(p.id));
    if (index < 0) list.unshift(p);
    else list[index] = p;
    if (!state.tokens) saveLocal();
    renderTrips();
  }

  function showProjectForm(id = null, selectedPlace = null) {
    const p = id ? project(id) : null;
    openModal(
      `<h2 id="modal-title">${p ? "Your trip details." : "Where will curiosity take you?"}</h2><p class="modal-description">${p ? "Update the name, date, or your plans." : "Start with an idea. The rest will unfold along the way."} ${state.tokens ? "Saved to the shared workspace." : "Saved in this browser."}</p><form><label class="form-field">Trip name<input name="name" placeholder="Weekend in Lviv" value="${escapeHTML(p?.name || "")}" required maxlength="255" autofocus></label><label class="form-field">When do we start?<input name="start_date" type="date" value="${escapeHTML(p?.start_date || "")}"></label><label class="form-field">Ideas and plans<textarea name="description" placeholder="Slow walks, a lovely park, a good coffee…" maxlength="5000">${escapeHTML(p?.description || "")}</textarea></label>${selectedPlace ? `<p class="form-help">Your first stop will be “${escapeHTML(findPlace(selectedPlace).name)}”.</p>` : ""}<div class="form-actions"><button type="button" class="button button-outline" data-action="${p ? "trip-detail" : "close"}" ${p ? `data-id="${escapeHTML(p.id)}"` : ""}>Cancel</button><button type="submit" class="button button-dark">${p ? "Save changes" : "Create trip"} ↗</button></div></form>`,
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
      let result;
      if (state.tokens) {
        if (!p)
          payload.places = selectedPlace ? [{ place_id: selectedPlace }] : [];
        result = await api(p ? `projects/${p.id}/` : "projects/", {
          method: p ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        });
      } else
        result = {
          ...p,
          ...payload,
          id: p?.id || crypto.randomUUID(),
          places:
            p?.places ||
            (selectedPlace ? [localPlace(findPlace(selectedPlace))] : []),
        };
      upsertProject(result);
      navigate("trips");
      if (version === modalVersion) showTrip(result.id);
      toast(p ? "Details updated." : "Your next adventure starts here!");
    });
  }

  function showNotes(projectId, placeId) {
    const p = project(projectId);
    const place = p.places.find((item) => String(item.id) === String(placeId));
    openModal(
      `<h2 id="modal-title">Details worth remembering.</h2><p class="modal-description">${escapeHTML(place.name)}</p><form><label class="form-field">Your note<textarea name="notes" maxlength="2000" autofocus placeholder="What stood out? What would you like to remember?">${escapeHTML(place.notes)}</textarea></label><p class="form-help">Up to 2,000 characters.</p><div class="form-actions"><button type="button" class="button button-outline" data-action="trip-detail" data-id="${escapeHTML(p.id)}">Cancel</button><button type="submit" class="button button-dark">Save note ↗</button></div></form>`,
    );
    bindForm(async (data) => {
      const patch = { notes: data.get("notes").trim() };
      if (state.tokens)
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

  function confirmDelete(id) {
    const p = project(id);
    if (p.archived_visited_count || p.places.some((place) => place.visited)) {
      toast("A trip with visited places cannot be deleted.");
      return;
    }
    openModal(
      `<h2 id="modal-title">Delete this trip?</h2><p class="modal-description">“${escapeHTML(p.name)}” and its notes will be permanently deleted.</p><form><div class="form-actions"><button type="button" class="button button-outline" data-action="trip-detail" data-id="${escapeHTML(id)}">Keep trip</button><button type="submit" class="button button-danger">Yes, delete</button></div></form>`,
    );
    bindForm(async () => {
      if (state.tokens) {
        await api(`projects/${p.id}/`, { method: "DELETE" });
        state.remote = state.remote.filter((item) => item.id !== p.id);
      } else {
        state.local = state.local.filter((item) => item.id !== p.id);
        saveLocal();
      }
      renderTrips();
      closeModal();
      toast("Trip deleted. New adventures await.");
    });
  }

  async function discovery(path, params = {}) {
    const query = new URLSearchParams(params).toString();
    const { response, data } = await fetchJSON(
      `/api/${path}${query ? "?" + query : ""}`,
    );
    if (!response.ok) throw new Error(errorMessage(data, response.status));
    return data;
  }
  function loading(message) {
    return `<div class="loading-state" role="status">${escapeHTML(message)}</div>`;
  }
  function displayError(target, error, action) {
    $(target).innerHTML =
      `<div class="empty-state error-state"><h2>Let’s try again</h2><p>${escapeHTML(error.message)}</p><button class="button button-outline" data-action="${action}">Retry ↻</button></div>`;
  }
  async function loadCountries() {
    const select = $("#country-select");
    try {
      const data = await discovery("countries/");
      state.countries = data.results;
      const names = new Intl.DisplayNames(["en"], { type: "region" });
      state.countries.sort((a, b) =>
        names.of(a.code).localeCompare(names.of(b.code), "en"),
      );
      select.innerHTML =
        '<option value="">All countries</option>' +
        state.countries
          .map(
            (c) =>
              `<option value="${escapeHTML(c.code)}">${escapeHTML(c.emoji)} ${escapeHTML(names.of(c.code))}</option>`,
          )
          .join("");
      select.value = state.countries.some((c) => c.code === "UA") ? "UA" : "";
      await loadCountry();
    } catch (error) {
      select.innerHTML = '<option value="">All countries</option>';
      displayError("#country-info", error, "retry-countries");
    }
  }
  async function loadCountry() {
    const version = ++state.countryVersion;
    const code = $("#country-select").value;
    if (!code) {
      $("#country-info").textContent = "Find cities around the world.";
      return;
    }
    $("#country-info").textContent = "Loading country information…";
    try {
      const c = await discovery(`countries/${encodeURIComponent(code)}/`);
      if (version !== state.countryVersion) return;
      $("#country-info").innerHTML =
        `<strong>${escapeHTML(c.emoji)} ${escapeHTML(c.name)}</strong><span>Capital: ${escapeHTML(c.capital || "—")}</span><span>Currency: ${escapeHTML(c.currency || "—")}</span><span>Languages: ${escapeHTML((c.languages || []).map((l) => l.name).join(", ") || "—")}</span>`;
    } catch (error) {
      if (version === state.countryVersion)
        displayError("#country-info", error, "retry-country");
    }
  }
  function resetDestination() {
    state.cityVersion += 1;
    state.searchVersion += 1;
    state.city = null;
    state.cities = [];
    state.places = [];
    state.offset = 0;
    $("#city-results").innerHTML = "";
    $("#city-story").hidden = true;
    $("#city-story").innerHTML = "";
    $("#places-context").textContent = "";
    $("#load-more").hidden = true;
    $("#places-grid").innerHTML = emptyState(
      "Next stop: your city",
      "Find a city above to discover interesting places nearby.",
    );
  }
  async function searchCities() {
    const query = $("#city-query").value.trim();
    if (query.length < 2) {
      $("#city-query").focus();
      return;
    }
    resetDestination();
    const version = ++state.cityVersion;
    const button = $("#destination-form button");
    button.disabled = true;
    $("#city-results").innerHTML = loading("Finding your city…");
    try {
      const params = { q: query };
      if ($("#country-select").value)
        params.country = $("#country-select").value;
      const data = await discovery("cities/", params);
      if (version !== state.cityVersion) return;
      state.cities = data.results;
      const cityOption = (city, index) =>
        `<button class="city-option" data-action="select-city" data-index="${index}" aria-pressed="false"><strong>${escapeHTML(city.name)}${city.region ? ` · ${escapeHTML(city.region)}` : ""}</strong><span>${escapeHTML(city.address)}</span><b aria-hidden="true">↗</b></button>`;
      $("#city-results").innerHTML = data.results.length
        ? `<p class="muted">Top result</p><div class="city-options city-primary">${cityOption(data.results[0], 0)}</div>${
            data.results.length > 1
              ? `<details class="other-cities"><summary>Other matches (${data.results.length - 1})</summary><p class="muted">Different places can share a name. Check the region before choosing.</p><div class="city-options">${data.results
                  .slice(1)
                  .map((city, index) => cityOption(city, index + 1))
                  .join("")}</div></details>`
              : ""
          }`
        : emptyState(
            "City not found",
            "Check the name or try another country.",
          );
    } catch (error) {
      if (version === state.cityVersion)
        displayError("#city-results", error, "retry-cities");
    } finally {
      button.disabled = false;
    }
  }
  async function selectCity(index) {
    state.city = state.cities[Number(index)];
    const version = ++state.cityVersion;
    $$(".city-option").forEach((el) => {
      el.classList.toggle(
        "selected",
        Number(el.dataset.index) === Number(index),
      );
      el.setAttribute(
        "aria-pressed",
        String(Number(el.dataset.index) === Number(index)),
      );
    });
    $("#city-story").hidden = true;
    loadPlaces();
    try {
      const wiki = await discovery("wikipedia/", {
        title:
          Number(index) === 0
            ? state.city.name
            : [state.city.name, state.city.region].filter(Boolean).join(", "),
      });
      if (version !== state.cityVersion || !wiki.found) return;
      $("#city-story").innerHTML =
        `${wiki.image_url ? `<img src="${escapeHTML(safeURL(wiki.image_url))}" alt="${escapeHTML(wiki.title)}">` : ""}<div><p class="eyebrow">MEET THE CITY · WIKIPEDIA SEARCH RESULT</p><h3>${escapeHTML(wiki.title)}</h3><p>${escapeHTML(wiki.description)}</p>${wikiAttribution(wiki.url)}</div>`;
      $("#city-story").hidden = false;
    } catch {
      if (version === state.cityVersion) {
        $("#city-story").innerHTML =
          '<p class="muted">The city description is temporarily unavailable. You can still explore places.</p>';
        $("#city-story").hidden = false;
      }
    }
  }
  async function loadPlaces(more = false) {
    if (!state.city) return;
    const version = ++state.searchVersion;
    const offset = more ? state.offset + 12 : 0;
    if (!more) {
      state.places = [];
      $("#places-grid").innerHTML = loading("Finding places for your trip…");
    }
    $("#load-more").disabled = true;
    $("#places-context").textContent =
      `${state.city.name} · ${categories[state.category]} · ${Number($("#search-radius").value) / 1000} km`;
    try {
      const data = await discovery("places/", {
        latitude: state.city.latitude,
        longitude: state.city.longitude,
        categories: state.category,
        radius: $("#search-radius").value,
        limit: 12,
        offset,
      });
      if (version !== state.searchVersion) return;
      state.places = uniquePlaces([
        ...(more ? state.places : []),
        ...data.results,
      ]);
      state.offset = offset;
      state.hasMore = data.has_more && offset < 500;
      renderPlaces();
    } catch (error) {
      if (version === state.searchVersion) {
        if (more) toast(error.message);
        else displayError("#places-grid", error, "retry-places");
      }
    } finally {
      if (version === state.searchVersion) {
        $("#load-more").disabled = false;
        $("#load-more").hidden = !state.hasMore || !state.places.length;
      }
    }
  }
  function wikiAttribution(url) {
    const safe = safeURL(url);
    if (!safe) return "";
    return `<p class="detail-caption"><a class="text-link" href="${escapeHTML(safe)}" target="_blank" rel="noopener noreferrer">Wikipedia contributors · source and images ↗</a><br>Text: <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a>. Photo licence details are on its file page.</p>`;
  }
  function card(p) {
    const saved = state.saved.has(p.place_id);
    const image = safeURL(p.image_url);
    return `<article class="art-card" data-place-id="${escapeHTML(p.place_id)}"><div class="art-image-wrap"><button class="art-image-button" data-action="place-detail" data-id="${escapeHTML(p.place_id)}" aria-label="More about: ${escapeHTML(p.name)}">${image ? `<img src="${escapeHTML(image)}" alt="${escapeHTML(p.wikipedia_title || p.name)}" loading="lazy">` : `<span class="location-art" aria-hidden="true"><span>⌖</span><small>${photoPlaceholder(p)}</small></span>`}</button><button class="save-button" data-action="save" data-id="${escapeHTML(p.place_id)}" aria-label="${saved ? "Remove from saved" : "Save"}: ${escapeHTML(p.name)}" aria-pressed="${saved}"><svg viewBox="0 0 16 20" aria-hidden="true"><path d="M3 2h10v15l-5-3-5 3Z"/></svg></button><span class="art-type">${escapeHTML(p.city || p.country_code || "DISCOVER A PLACE")}</span></div><div class="art-card-meta"><div><h3><button class="title-button" data-action="place-detail" data-id="${escapeHTML(p.place_id)}">${escapeHTML(p.name)}</button></h3><p>${escapeHTML(p.address)}</p>${mapsLink(p)}</div><button class="art-add" data-action="add-place" data-id="${escapeHTML(p.place_id)}" aria-label="Add to trip: ${escapeHTML(p.name)}">+</button></div><p class="detail-caption card-image-credit">${photoCredit(p)}</p></article>`;
  }
  function renderPlaces() {
    $$("#places-grid .art-card").forEach((element) =>
      photoObserver.unobserve(element),
    );
    $("#places-grid").innerHTML = state.places.length
      ? state.places
          .map((p) => card(state.details.get(p.place_id) || p))
          .join("")
      : emptyState(
          "No places found here yet",
          "Try another category or a wider search radius.",
        );
    observePhotos("#places-grid");
  }
  function renderSaved() {
    $$("#saved-grid .art-card").forEach((element) =>
      photoObserver.unobserve(element),
    );
    $("#saved-count").textContent = state.saved.size;
    $("#saved-grid").innerHTML = state.saved.size
      ? [...state.saved.values()].map(card).join("")
      : emptyState(
          "Save your first place",
          "Tap the bookmark on a place you’d love to return to.",
          "Find a city",
          "explore",
        );
    observePhotos("#saved-grid");
  }
  function toggleSave(id) {
    const wasInSaved = document.activeElement?.closest("#saved-grid");
    const name = findPlace(id)?.name || "";
    if (state.saved.has(id)) state.saved.delete(id);
    else state.saved.set(id, findPlace(id));
    persist("tp-saved-v2", [...state.saved.values()]);
    renderSaved();
    $$(`[data-action="save"][data-id="${CSS.escape(id)}"]`).forEach((b) => {
      b.setAttribute("aria-pressed", String(state.saved.has(id)));
      b.setAttribute(
        "aria-label",
        `${state.saved.has(id) ? "Remove from saved" : "Save"}: ${name}`,
      );
    });
    if (wasInSaved)
      ($("#saved-grid button") || $('[data-nav="saved"]')).focus();
    toast(state.saved.has(id) ? "Place saved." : "Removed from saved.");
  }
  async function detailedPlace(id) {
    if (state.details.has(id)) return state.details.get(id);
    if (state.detailRequests.has(id)) return state.detailRequests.get(id);
    const request = fetchPlaceDetails(id).finally(() =>
      state.detailRequests.delete(id),
    );
    state.detailRequests.set(id, request);
    return request;
  }
  async function fetchPlaceDetails(id) {
    const p = await discovery(`places/${encodeURIComponent(id)}/`);
    const listed = state.places.find((item) => item.place_id === id);
    if (listed?.english_name && !p.english_name) {
      p.name = p.english_name = listed.english_name;
    }
    state.details.set(id, p);
    if (state.saved.has(id)) {
      state.saved.set(id, p);
      persist("tp-saved-v2", [...state.saved.values()]);
      renderSaved();
    }
    return p;
  }
  async function showPlace(id) {
    openModal(
      '<h2 id="modal-title">Getting to know this place…</h2>' +
        loading("Loading details and stories"),
    );
    const version = modalVersion;
    try {
      const p = await detailedPlace(id);
      if (version !== modalVersion) return;
      openModal(
        `<div class="art-detail">${p.image_url ? `<img src="${escapeHTML(safeURL(p.image_url))}" alt="${escapeHTML(p.wikipedia_title)}">` : '<div class="location-art"><span aria-hidden="true">⌖</span><small>Discover this place in person</small></div>'}<div><p class="eyebrow">${escapeHTML(p.city)} · ${escapeHTML(p.country_code)}</p><h2 id="modal-title">${escapeHTML(p.name)}</h2><p class="modal-description">${escapeHTML(p.address)}</p>${p.wikipedia_match === "search" ? `<p class="form-help">Related Wikipedia search result: ${escapeHTML(p.wikipedia_title)}. Check that it matches this place.</p>` : ""}<p class="modal-description">${escapeHTML(p.description || (p.wikipedia_status === "unavailable" ? "Wikipedia is temporarily unavailable. You can still add this place to a trip." : "No English description is available for this place yet."))}</p><button class="button button-dark" data-action="add-place" data-id="${escapeHTML(id)}">Add to trip +</button>${mapsLink(p)}<p class="detail-caption">Map data: Geoapify / © OpenStreetMap contributors.</p></div></div>`,
        true,
      );
      if (state.places.length) renderPlaces();
    } catch (error) {
      if (version === modalVersion)
        openModal(
          `<h2 id="modal-title">Could not load details</h2><p class="modal-description">${escapeHTML(error.message)}</p><button class="button button-dark" data-action="place-detail" data-id="${escapeHTML(id)}">Retry ↻</button>`,
        );
    }
  }
  async function showAddPlace(id) {
    openModal(
      '<h2 id="modal-title">Choosing a trip…</h2>' +
        loading("Getting this stop ready"),
    );
    const version = modalVersion;
    try {
      const place = await detailedPlace(id);
      if (state.tokens && !state.loaded) {
        const data = await api("projects/");
        state.remote = Array.isArray(data) ? data : data.results;
        state.loaded = true;
      }
      if (version !== modalVersion) return;
      const list = projects().filter(
        (p) =>
          p.places.length < 10 &&
          !p.places.some(
            (item) =>
              item.place_id === id || item.source_id === place.source_id,
          ),
      );
      openModal(
        `<h2 id="modal-title">A place in your journey.</h2><p class="modal-description">${escapeHTML(place.name)}</p>${list.length ? `<form><label class="form-field">Trip<select name="project_id">${list.map((p) => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)} · ${p.places.length}/10</option>`).join("")}</select></label><div class="form-actions"><button type="submit" class="button button-dark">Add to itinerary +</button></div></form>` : '<p class="modal-description">Create a trip or choose another place. Your current trips already include this stop or have all 10 stops filled.</p>'}<div class="form-actions"><button class="button button-outline" data-action="create-with-place" data-id="${escapeHTML(id)}">New trip ↗</button></div>`,
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
          `<h2 id="modal-title">Could not add this place</h2><p class="modal-description">${escapeHTML(error.message)}</p><button class="button button-dark" data-action="add-place" data-id="${escapeHTML(id)}">Retry ↻</button>`,
        );
    }
  }
  async function addPlace(projectId, id) {
    const p = project(projectId);
    if (!p) throw new Error("Trip not found.");
    if (p.places.length >= 10)
      throw new Error("A trip can have up to 10 stops.");
    const detail = await detailedPlace(id);
    if (
      p.places.some(
        (item) => item.place_id === id || item.source_id === detail.source_id,
      )
    )
      throw new Error("This place is already in the trip.");
    const place = state.tokens
      ? await api(`projects/${p.id}/places/`, {
          method: "POST",
          body: JSON.stringify({ place_id: id }),
        })
      : localPlace(detail);
    p.places.push(place);
    upsertProject(p);
    toast("Stop added to your trip.");
  }
  function showTrip(id) {
    const p = project(id);
    if (!p) {
      toast("Trip not found.");
      return;
    }
    const visited = p.places.filter((item) => item.visited).length;
    openModal(
      `<h2 id="modal-title">${escapeHTML(p.name)}</h2><p class="modal-description">${escapeHTML(formatDate(p.start_date))}<br>${escapeHTML(p.description)}</p>${p.archived_place_count ? `<p class="workspace-note">Previous places (${p.archived_place_count}) are archived. Add new places to build your itinerary.</p>` : ""}<div class="trip-detail-top"><span class="muted">Visited ${visited} of ${p.places.length} · Up to 10 stops</span><div class="trip-detail-actions"><button class="button button-outline" data-action="edit-trip" data-id="${escapeHTML(id)}">Edit</button><button class="button button-dark" data-action="pick-place" data-id="${escapeHTML(id)}" ${p.places.length >= 10 ? "disabled" : ""}>Add place +</button></div></div><div class="place-list">${p.places.length ? p.places.map((place, i) => `<article class="place-row"><img src="${escapeHTML(placeImage(place))}" alt="${escapeHTML(place.wikipedia_title || place.name)}"><div><h3>${String(i + 1).padStart(2, "0")} / ${escapeHTML(place.name)}</h3><p>${escapeHTML(place.address)}</p>${mapsLink(place)}${place.notes ? `<p class="place-notes">${escapeHTML(place.notes)}</p>` : ""}<div class="place-actions"><label class="check-label"><input type="checkbox" data-visited="${escapeHTML(place.id)}" data-project="${escapeHTML(id)}" ${place.visited ? "checked" : ""}>Visited</label><button class="note-button" data-action="edit-notes" data-id="${escapeHTML(place.id)}" data-project="${escapeHTML(id)}">${place.notes ? "Edit note" : "+ Add note"}</button></div><p class="detail-caption">${photoCredit(place)}</p>${wikiAttribution(place.wikipedia_url)}</div></article>`).join("") : emptyState("Room for new experiences", "Find a city and add the first stop to your trip.")}</div><div id="place-picker"></div><div class="trip-detail-footer"><p>Trips with visited places, including archived places, cannot be deleted.</p><button class="button button-danger" data-action="delete-trip" data-id="${escapeHTML(id)}" ${visited || p.archived_visited_count ? "disabled" : ""}>Delete trip</button></div>`,
      true,
    );
  }
  function showPicker(id) {
    const p = project(id);
    const available = [
      ...new Map(
        [...state.places, ...state.saved.values()].map((item) => [
          item.place_id,
          item,
        ]),
      ).values(),
    ].filter(
      (item) => !p.places.some((place) => place.place_id === item.place_id),
    );
    $("#place-picker").innerHTML =
      `<div class="inline-picker"><h3>Discovered and saved places</h3><div class="picker-options">${available.map((item) => `<button class="picker-art" data-action="pick-result" data-id="${escapeHTML(item.place_id)}" data-project="${escapeHTML(id)}"><span>${escapeHTML(item.name)}</span><span>+</span></button>`).join("")}</div><div class="form-actions"><button class="button button-outline" data-action="explore">Find another city ↗</button></div></div>`;
    $("#place-picker button")?.focus();
  }
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;
    const { action, id } = button.dataset;
    try {
      switch (action) {
        case "retry-countries":
          await loadCountries();
          break;
        case "retry-country":
          await loadCountry();
          break;
        case "retry-cities":
          await searchCities();
          break;
        case "select-city":
          await selectCity(button.dataset.index);
          break;
        case "retry-places":
          await loadPlaces();
          break;
        case "place-detail":
          await showPlace(id);
          break;
        case "add-place":
          await showAddPlace(id);
          break;
        case "save":
          toggleSave(id);
          break;
        case "create-trip":
          showProjectForm();
          break;
        case "create-with-place":
          showProjectForm(null, id);
          break;
        case "edit-trip":
          showProjectForm(id);
          break;
        case "trip-detail":
          showTrip(id);
          break;
        case "pick-place":
          showPicker(id);
          break;
        case "pick-result":
          button.disabled = true;
          await addPlace(button.dataset.project, id);
          if (modal.open) showTrip(button.dataset.project);
          break;
        case "edit-notes":
          showNotes(button.dataset.project, id);
          break;
        case "delete-trip":
          confirmDelete(id);
          break;
        case "login":
          showLogin();
          break;
        case "close":
          closeModal();
          break;
        case "retry-trips":
          await loadProjects();
          break;
        case "explore":
          if (modal.open) closeModal();
          navigate("collection");
          break;
        case "back-top":
          window.scrollTo({ top: 0, behavior: "smooth" });
          $("#main").focus({ preventScroll: true });
          break;
      }
    } catch (error) {
      toast(error.message);
    } finally {
      if (action === "pick-result") button.disabled = false;
    }
  });
  document.addEventListener("change", async (event) => {
    const input = event.target.closest("[data-visited]");
    if (!input) return;
    const p = project(input.dataset.project);
    const place = p.places.find(
      (item) => String(item.id) === input.dataset.visited,
    );
    const checked = input.checked;
    const version = modalVersion;
    input.disabled = true;
    try {
      if (state.tokens)
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
  $("#destination-form").addEventListener("submit", (event) => {
    event.preventDefault();
    searchCities();
  });
  $("#country-select").addEventListener("change", () => {
    resetDestination();
    loadCountry();
  });
  $("#search-radius").addEventListener("change", () => loadPlaces());
  $("#load-more").addEventListener("click", () => loadPlaces(true));
  $$("[data-category]").forEach((button) =>
    button.addEventListener("click", () => {
      state.category = button.dataset.category;
      $$("[data-category]").forEach((el) => {
        el.classList.toggle("active", el === button);
        el.setAttribute("aria-pressed", String(el === button));
      });
      loadPlaces();
    }),
  );
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
  $("#account-button").addEventListener("click", showAccount);
  $("#close-modal").addEventListener("click", closeModal);
  modal.addEventListener("close", () => {
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
  document.addEventListener(
    "error",
    (e) => {
      const img = e.target;
      if (img.tagName === "IMG" && !img.dataset.fallback) {
        img.dataset.fallback = "true";
        img.src = `${ASSETS}image-placeholder.svg`;
      }
    },
    true,
  );
  window.addEventListener("hashchange", route);
  resetDestination();
  renderSaved();
  renderAccount();
  route();
  loadCountries();
})();

import { renderTemplate } from "travel/ui/templates.js";
import { events } from "travel/core/events.js";
import { $, $$, safeURL } from "travel/core/dom.js";
import { state } from "travel/core/state.js";
import { discovery } from "travel/core/api.js";
import { uniquePlaces } from "travel/core/places.js";
import {
  categories,
  wikiAttribution,
  card,
  photoObserver,
  observePhotos,
} from "travel/components/places.js";
import { loading, displayError, toast } from "travel/ui/feedback.js";
import { registerActions } from "travel/core/actions.js";

export async function loadCountries() {
  const select = $("#country-select");
  try {
    const data = await discovery("countries/");
    state.countries = data.results;
    events.dispatchEvent(new Event("countries-loaded"));
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    state.countries.sort((a, b) =>
      names.of(a.code).localeCompare(names.of(b.code), "en"),
    );
    select.innerHTML =
      renderTemplate("country-option", { code: "", label: "All countries" }) +
      state.countries
        .map((c) =>
          renderTemplate("country-option", {
            code: c.code,
            label: `${c.emoji} ${names.of(c.code)}`,
          }),
        )
        .join("");
    select.value = state.countries.some((c) => c.code === "UA") ? "UA" : "";
    await loadCountry();
  } catch (error) {
    select.innerHTML = renderTemplate("country-option", {
      code: "",
      label: "All countries",
    });
    displayError("#country-info", error, "retry-countries");
  }
}

export async function loadCountry() {
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
    $("#country-info").innerHTML = renderTemplate("country-info-content", {
      emoji: c.emoji,
      name: c.name,
      capital: c.capital || "\u2014",
      currency: c.currency || "\u2014",
      languages: (c.languages || []).map((l) => l.name).join(", ") || "\u2014",
    });
  } catch (error) {
    if (version === state.countryVersion)
      displayError("#country-info", error, "retry-country");
  }
}

export function resetDestination() {
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
  $("#places-grid").innerHTML = renderTemplate("discovery-empty");
}

export async function searchCities() {
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
    if ($("#country-select").value) params.country = $("#country-select").value;
    const data = await discovery("cities/", params);
    if (version !== state.cityVersion) return;
    state.cities = data.results;
    const cityOption = (city, index) =>
      renderTemplate("city-option", {
        index,
        name: [city.name, city.region].filter(Boolean).join(" \u00b7 "),
        address: city.address,
      });
    $("#city-results").innerHTML = data.results.length
      ? renderTemplate("city-results-content", {
          primary: cityOption(data.results[0], 0),
          otherCount: data.results.length - 1,
          others: data.results
            .slice(1)
            .map((city, index) => cityOption(city, index + 1))
            .join(""),
        })
      : renderTemplate("cities-empty");
  } catch (error) {
    if (version === state.cityVersion)
      displayError("#city-results", error, "retry-cities");
  } finally {
    button.disabled = false;
  }
}

export async function selectCity(index) {
  state.city = state.cities[Number(index)];
  const version = ++state.cityVersion;
  $$(".city-option").forEach((el) => {
    el.classList.toggle("selected", Number(el.dataset.index) === Number(index));
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
    $("#city-story").innerHTML = renderTemplate("city-story-content", {
      image: safeURL(wiki.image_url),
      title: wiki.title,
      description: wiki.description,
      attribution: wikiAttribution(wiki.url),
    });
    $("#city-story").hidden = false;
  } catch {
    if (version === state.cityVersion) {
      $("#city-story").innerHTML = renderTemplate("city-story-error");
      $("#city-story").hidden = false;
    }
  }
}

export async function loadPlaces(more = false) {
  if (!state.city) return;
  const version = ++state.searchVersion;
  const offset = more ? state.offset + 12 : 0;
  const sort =
    state.category === "tourism.sights" ? $("#sight-sort").value : "distance";
  if (!more) {
    state.places = [];
    $("#places-grid").innerHTML = loading("Finding places for your trip…");
  }
  $("#load-more").disabled = true;
  $("#places-context").textContent =
    `${state.city.name} · ${categories[state.category]} · ${Number($("#search-radius").value) / 1000} km${state.category === "tourism.sights" ? ` · ${sort === "highlights" ? "Highlights" : "Nearest first"}` : ""}`;
  try {
    const data = await discovery("places/", {
      latitude: state.city.latitude,
      longitude: state.city.longitude,
      categories: state.category,
      radius: $("#search-radius").value,
      limit: 12,
      offset,
      sort,
    });
    if (version !== state.searchVersion) return;
    state.places = uniquePlaces([
      ...(more ? state.places : []),
      ...data.results,
    ]);
    state.offset = offset;
    state.hasMore = data.has_more;
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

export function renderPlaces() {
  $$("#places-grid .art-card").forEach((element) =>
    photoObserver.unobserve(element),
  );
  $("#places-grid").innerHTML = state.places.length
    ? state.places.map((p) => card(state.details.get(p.place_id) || p)).join("")
    : renderTemplate("places-empty");
  observePhotos("#places-grid");
}

export function initDiscover() {
  events.addEventListener("place-details-shown", () => {
    if (state.places.length) renderPlaces();
  });
  registerActions({
    "retry-countries": () => loadCountries(),
    "retry-country": () => loadCountry(),
    "retry-cities": () => searchCities(),
    "select-city": ({ index }) => selectCity(index),
    "retry-places": () => loadPlaces(),
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
  $("#sight-sort").addEventListener("change", () => loadPlaces());
  $("#load-more").addEventListener("click", () => loadPlaces(true));
  $$("[data-category]").forEach((button) =>
    button.addEventListener("click", () => {
      state.category = button.dataset.category;
      $("#sight-sort-field").hidden = state.category !== "tourism.sights";
      $$("[data-category]").forEach((el) => {
        el.classList.toggle("active", el === button);
        el.setAttribute("aria-pressed", String(el === button));
      });
      loadPlaces();
    }),
  );
  resetDestination();
  loadCountries();
}

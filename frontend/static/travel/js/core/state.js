import { readStored } from "travel/core/storage.js";

export const state = {
  saved: new Map(),
  savedLoaded: false,
  sessionVersion: 0,
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
export const projects = () => (state.tokens ? state.remote : []);
export const project = (id) =>
  projects().find((p) => String(p.id) === String(id));
export const isComplete = (p) =>
  p.places.length > 0 && p.places.every((place) => place.visited);
export const findPlace = (id) =>
  state.details.get(id) ||
  state.saved.get(id) ||
  state.places.find((p) => p.place_id === id);

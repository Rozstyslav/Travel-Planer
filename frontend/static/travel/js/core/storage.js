import { toast } from "travel/ui/feedback.js";

export const readArray = (key) => {
  const value = readStored(key, []);
  return Array.isArray(value) ? value : [];
};
export const validPlace = (p) =>
  p &&
  typeof p.place_id === "string" &&
  typeof p.name === "string" &&
  Number.isFinite(p.latitude) &&
  Number.isFinite(p.longitude);

export function readStored(key, fallback, storage = "localStorage") {
  try {
    return JSON.parse(window[storage].getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function persist(key, value, storage = "localStorage") {
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

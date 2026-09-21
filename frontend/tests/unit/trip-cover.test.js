import assert from "node:assert/strict";
import { test } from "node:test";
import { tripCover, cityCover } from "../../static/travel/js/core/trip-cover.js";
import { createCityCoverLookup } from "../../static/travel/js/core/trip-cover-lookup.js";

test("recognizes destination names within Ukrainian and English trip titles", () => {
  for (const name of ["Париж", "Вихідні у Парижі", "PARIS, here we come!", "Paris–2027"]) {
    assert.equal(tripCover(name).icon, "🥐", name);
    assert.equal(tripCover(name).flag, "🇫🇷", name);
  }
  assert.equal(tripCover("Мій Львів").flag, "🇺🇦");
  assert.equal(tripCover("Zürich").flag, "🇨🇭");
  assert.equal(tripCover("Kraków").flag, "🇵🇱");
  assert.equal(tripCover("New-York weekend").icon, "🗽");
});

test("does not match destination names inside unrelated words or country codes", () => {
  for (const name of ["", "Somewhere new", "Romantic weekend", "Comparison", "Римований вечір", "US two"]) {
    assert.equal(tripCover(name), null, name);
  }
});

test("uses a globe for multiple countries and keeps the flag for one country", () => {
  assert.deepEqual(tripCover("Paris → Rome"), {
    icon: "🌍", flag: "", tone: "blue", label: "Multiple destinations",
  });
  assert.equal(tripCover("Paris, France").flag, "🇫🇷");
  assert.equal(tripCover("Львів та Київ").flag, "🇺🇦");
  assert.equal(tripCover("Львів та Київ").icon, "☕");
});

test("themes have no guessed country and a named destination takes priority", () => {
  assert.equal(tripCover("Похід у Карпатах").icon, "🏔️");
  assert.equal(tripCover("Похід у Карпатах").flag, "");
  assert.equal(tripCover("Кав’ярні").icon, "☕");
  assert.equal(tripCover("Coffee in Paris").icon, "🥐");
});

test("recognizes screenshot examples and countries beyond the curated associations", () => {
  assert.equal(tripCover("Australia").icon, "🦘");
  assert.equal(tripCover("Австралія").flag, "🇦🇺");
  assert.equal(tripCover("Buenos Aires").icon, "🧉");
  assert.equal(tripCover("Буенос-Айрес").flag, "🇦🇷");
  assert.equal(tripCover("Madagascar").flag, "🇲🇬");
  assert.equal(tripCover("Мадагаскар").flag, "🇲🇬");
  assert.equal(tripCover("South Korea").flag, "🇰🇷");
  assert.equal(tripCover("Papua New Guinea").flag, "🇵🇬");
  assert.equal(tripCover("Equatorial Guinea").flag, "🇬🇶");
});

test("uses catalog capitals and trip places without requests", () => {
  assert.equal(tripCover("Vilnius", {
    countries: [{ code: "LT", name: "Lithuania", capital: "Vilnius" }],
  }).flag, "🇱🇹");
  assert.equal(tripCover("My holiday", { places: [{ country_code: "au" }] }).flag, "🇦🇺");
  assert.equal(tripCover("My holiday", {
    places: [{ country_code: "AU" }, { country_code: "NZ" }],
  }).icon, "🌍");
  assert.equal(tripCover("My holiday", { places: [{ country_code: "XX" }] }), null);
});

test("accepts matching city aliases and rejects unrelated or ambiguous results", () => {
  const cities = [{ name: "Bergen", country_code: "NO", name_aliases: ["Берген"] }];
  assert.equal(cityCover("Weekend in Bergen", cities).flag, "🇳🇴");
  assert.equal(cityCover("Берген", cities).flag, "🇳🇴");
  assert.equal(cityCover("Somewhere new", cities), null);
  assert.equal(cityCover("Bergen", [{ name: "Bergen", country_code: "XX" }]), null);
  assert.equal(cityCover("Bergen", [...cities, { name: "Bergen", country_code: "DE" }]), null);
});

test("shares in-flight lookups and caches successful and empty results", async () => {
  let requests = 0;
  const lookup = createCityCoverLookup(async () => {
    requests += 1;
    return [{ name: "Bergen", country_code: "NO" }];
  }, cityCover);
  const [first, second] = await Promise.all([lookup("Bergen"), lookup("BERGEN")]);
  assert.equal(first.flag, "🇳🇴");
  assert.deepEqual(first, second);
  await lookup("Bergen");
  assert.equal(requests, 1);
  assert.equal(await lookup("Somewhere new"), null);
  assert.equal(await lookup("Somewhere new"), null);
  assert.equal(requests, 2);
});

test("handles provider errors quietly and limits concurrent requests", async () => {
  let active = 0;
  let peak = 0;
  const lookup = createCityCoverLookup(async () => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    throw new Error("Provider unavailable");
  }, cityCover);
  assert.deepEqual(await Promise.all(["Bergen", "Oslo", "Tromso"].map(lookup)), [null, null, null]);
  assert.equal(peak, 2);
});

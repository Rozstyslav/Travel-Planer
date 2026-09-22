const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const workspaceMock = require("./workspace-mock.cjs");

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "chrome",
    headless: true,
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    const queries = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => sessionStorage.setItem("tp-session-v1", JSON.stringify({ access: "test", refresh: "test" })));
    const workspace = workspaceMock([
        "Australia", "Buenos Aires", "Madagascar", "Vilnius", "Bergen", "Somewhere new", "Oslo",
      ].map((name, id) => ({ id: String(id), name, places: [] })));
    let releaseOslo;
    const osloPending = new Promise((resolve) => { releaseOslo = resolve; });
    await page.route("**/api/**", async (route) => {
      if (await workspace(route)) return;
      const url = new URL(route.request().url());
      if (url.pathname === "/api/countries/") {
        return route.fulfill({ json: { results: [
          { code: "LT", name: "Lithuania", capital: "Vilnius", emoji: "🇱🇹" },
        ] } });
      }
      if (url.pathname === "/api/cities/") {
        const q = url.searchParams.get("q");
        queries.push(q);
        if (q === "Oslo") {
          await osloPending;
          return route.fulfill({ json: { results: [{ name: "Oslo", country_code: "NO" }] } });
        }
        return route.fulfill({ json: { results: q === "Bergen"
          ? [{ name: "Bergen", country_code: "NO", name_aliases: ["Берген"] }]
          : [{ name: "Unrelated city", country_code: "US" }],
        } });
      }
      return route.fulfill({ json: { results: [] } });
    });
    await page.goto(`${process.env.BASE_URL || "http://127.0.0.1:8000"}/#trips`);
    const card = (id) => page.locator(`.trip-card[data-trip-id="${id}"]`);
    await card(4).locator(".trip-association-flag").waitFor();
    await card(3).locator(".trip-association-flag").waitFor();
    for (const [id, flag] of [[0, "🇦🇺"], [1, "🇦🇷"], [2, "🇲🇬"], [3, "🇱🇹"], [4, "🇳🇴"]]) {
      assert.equal(await card(id).locator(".trip-association-flag").textContent(), flag);
    }
    assert.equal(await card(5).locator(".trip-route-art").count(), 1);
    assert.ok(!queries.includes("Australia") && !queries.includes("Buenos Aires"));

    // A slow city response cannot overwrite the cover after a rename.
    await card(6).locator('[data-action="trip-detail"]').click();
    await page.locator('dialog [data-action="edit-trip"]').click();
    await page.locator('dialog [name="name"]').fill("Paris");
    await page.locator('dialog button[type="submit"]').click();
    await page.locator('dialog [data-action="edit-trip"]').waitFor();
    const response = page.waitForResponse((res) => new URL(res.url()).searchParams.get("q") === "Oslo");
    releaseOslo();
    await response;
    await page.locator("#close-modal").click();
    assert.equal(await card(6).locator(".trip-association-flag").textContent(), "🇫🇷");
    await page.locator('[data-trip-filter="planned"]').click();
    await card(4).locator(".trip-association-flag").waitFor();
    assert.equal(queries.filter((q) => q === "Bergen").length, 1);
    assert.deepEqual(errors, []);
    console.log("PASS: country names, capitals, city lookup, unrelated results, caching and rename races.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

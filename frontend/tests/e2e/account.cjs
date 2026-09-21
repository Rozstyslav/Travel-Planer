const { chromium } = require("playwright");
const assert = require("node:assert/strict");

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome", headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    const calls = [];
    let failLogout = false;
    let failEmail = true;
    let delayRefresh = true;
    let releaseRefresh;
    const refreshPending = new Promise((resolve) => { releaseRefresh = resolve; });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const data = request.method() === "POST" ? request.postDataJSON() : {};
      calls.push({ path: url.pathname, data });
      const reply = (status, json) => route.fulfill({ status, json });
      if (url.pathname === "/api/auth/register/") {
        assert.equal(data.email, "test@example.com");
        assert.equal(data.username, "new-traveller");
        if (failEmail) return reply(503, { detail: "Email delivery failed.", code: "email_delivery_failed" });
        return reply(201, { detail: "Check your email for a verification link." });
      }
      if (url.pathname === "/api/auth/verify-email/") {
        assert.equal(data.token, "verification-token");
        return reply(200, { detail: "Email verified. You can now sign in." });
      }
      if (url.pathname === "/api/auth/login/") {
        if (data.password === "wrong-password") return reply(401, { detail: "Incorrect username/email or password." });
        return reply(200, { access: delayRefresh ? "expired" : "fresh", refresh: "refresh-old" });
      }
      if (url.pathname === "/api/auth/token/refresh/") {
        await refreshPending;
        return reply(200, { access: "fresh", refresh: "refresh-new" });
      }
      if (url.pathname === "/api/auth/logout/") {
        if (failLogout) return route.abort();
        assert.equal(data.refresh, "refresh-new");
        return reply(200, {});
      }
      if (url.pathname === "/api/projects/" && request.headers().authorization === "Bearer expired")
        return reply(401, {});
      if (["/api/auth/password-reset/", "/api/auth/resend-verification/"].includes(url.pathname))
        return reply(200, { detail: "Check your email for instructions." });
      if (url.pathname === "/api/auth/password-reset/confirm/") {
        assert.equal(data.uid, "MQ");
        assert.equal(data.token, "reset-token");
        return reply(200, { detail: "Password changed successfully." });
      }
      return reply(200, { results: [] });
    });
    const base = process.env.BASE_URL || "http://127.0.0.1:8000";
    await page.goto(base);
    await page.locator("#account-button").click();
    await page.locator('[data-action="register"]').click();
    await page.locator('dialog [name="username"]').fill("new-traveller");
    await page.locator('dialog [name="email"]').fill("test@example.com");
    await page.locator('dialog [name="password"]').fill("Strong-password!23");
    await page.setViewportSize({ width: 320, height: 900 });
    assert.ok(await page.locator("dialog").evaluate((element) => element.scrollWidth <= element.clientWidth));
    await page.locator('dialog button[type="submit"]').click();
    await page.locator(".form-error").waitFor();
    assert.match(await page.locator(".form-error").textContent(), /couldn’t send the email/);
    assert.equal(await page.getByRole("heading", { name: "Check your email." }).count(), 0);
    failEmail = false;
    await page.locator('dialog button[type="submit"]').click();
    await page.getByRole("heading", { name: "Check your email." }).waitFor();
    await page.goto(`${base}/#verify-email?token=verification-token`);
    await page.getByRole("heading", { name: "Email verified." }).waitFor();
    assert.ok(!page.url().includes("verification-token"));
    await page.locator('dialog [data-action="login"]').click();
    await page.locator('dialog [name="username"]').fill("test@example.com");
    await page.locator('dialog [name="password"]').fill("wrong-password");
    await page.locator('dialog button[type="submit"]').click();
    await page.locator(".form-error").waitFor();
    assert.match(await page.locator(".form-error").textContent(), /Incorrect/);
    await page.locator('dialog [name="password"]').fill("Strong-password!23");
    const refreshing = page.waitForRequest("**/api/auth/token/refresh/");
    await page.locator('dialog button[type="submit"]').click();
    await refreshing;
    await page.locator("#account-button").click();
    await page.locator('dialog button[type="submit"]').click();
    const loggedOut = page.waitForResponse("**/api/auth/logout/");
    releaseRefresh();
    await loggedOut;
    await page.waitForFunction(() => document.querySelector("#account-label").textContent === "Sign in");
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem("tp-session-v1"))), null);

    // A failed logout request must not trap the user in the signed-in workspace.
    delayRefresh = false;
    failLogout = true;
    await page.locator("#account-button").click();
    await page.locator('dialog [name="username"]').fill("test@example.com");
    await page.locator('dialog [name="password"]').fill("Strong-password!23");
    await page.locator('dialog button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector("#account-label").textContent === "Account");
    await page.locator("#account-button").click();
    await page.locator('dialog button[type="submit"]').click();
    await page.waitForFunction(() => !document.querySelector("dialog").open);
    assert.equal(await page.locator("#account-label").textContent(), "Sign in");

    await page.locator("#account-button").click();
    await page.locator('[data-action="forgot-password"]').click();
    await page.locator('dialog [name="email"]').fill("test@example.com");
    await page.locator('dialog button[type="submit"]').click();
    await page.getByRole("heading", { name: "Check your email." }).waitFor();
    await page.goto(`${base}/#reset-password?uid=MQ&token=reset-token`);
    await page.locator('dialog [name="password"]').fill("New-Strong!72854");
    await page.locator('dialog [name="confirm_password"]').fill("Different-Strong!23");
    await page.locator('dialog button[type="submit"]').click();
    await page.locator(".form-error").waitFor();
    assert.match(await page.locator(".form-error").textContent(), /do not match/);
    await page.locator('dialog [name="confirm_password"]').fill("New-Strong!72854");
    await page.locator('dialog button[type="submit"]').click();
    await page.getByRole("heading", { name: "Welcome back." }).waitFor();
    assert.equal(calls.filter((call) => call.path === "/api/auth/password-reset/confirm/").length, 1);
    assert.deepEqual(errors, []);
    console.log("PASS: signup, verification, login errors, refresh/logout race, offline logout, password reset and mobile forms.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

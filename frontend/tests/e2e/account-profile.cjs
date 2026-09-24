const { chromium } = require("playwright");
const assert = require("node:assert/strict");

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome", headless: true });
  try {
    const page = await browser.newPage();
    const user = { id: 7, username: "weekend-traveller", email: "weekend.traveller@example.com" };
    const errors = [];
    const resetEmails = [];
    let failProfile = true;
    let failEmail = true;
    let refreshes = 0;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const reply = (status, json) => route.fulfill({ status, json });
      if (path === "/api/auth/me/") {
        if (request.headers().authorization === "Bearer expired") return reply(401, {});
        return failProfile ? reply(503, {}) : reply(200, user);
      }
      if (path === "/api/auth/token/refresh/") {
        refreshes++;
        return reply(200, { access: "fresh", refresh: "rotated" });
      }
      if (path === "/api/auth/password-reset/") {
        resetEmails.push(request.postDataJSON().email);
        return failEmail
          ? reply(503, { code: "email_delivery_failed" })
          : reply(200, { detail: "If the email exists, you will receive reset instructions." });
      }
      if (path === "/api/auth/logout/") {
        assert.equal(request.postDataJSON().refresh, "rotated");
        return reply(200, {});
      }
      return reply(200, { results: [] });
    });
    await page.goto(process.env.BASE_URL || "http://127.0.0.1:8000");
    // Existing sessions may have tokens without cached profile data.
    await page.evaluate(() => sessionStorage.setItem("tp-session-v1", JSON.stringify({ access: "expired", refresh: "old" })));
    await page.reload();
    await page.locator('#account-button').click();
    await page.locator('dialog [data-action="account"]').waitFor();
    assert.match(await page.locator('#account-status').innerText(), /temporarily unavailable/);
    assert.ok(await page.getByRole('button', { name: 'Change password', exact: true }).isDisabled());
    failProfile = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.waitForFunction(() => document.querySelector('#account-username')?.textContent === 'weekend-traveller');
    assert.equal(await page.locator('#account-email').innerText(), user.email);
    assert.equal(refreshes, 1);
    assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tp-session-v1')).user), user);
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.locator('dialog').evaluate(el => el.scrollWidth <= el.clientWidth));
    }
    await page.getByRole('button', { name: 'Change password', exact: true }).click();
    assert.match(await page.locator('dialog .modal-description').innerText(), /weekend.traveller@example.com/);
    assert.equal(resetEmails.length, 0);
    await page.getByRole('button', { name: 'Back to account' }).click();
    await page.getByRole('button', { name: 'Change password', exact: true }).click();
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await page.locator('dialog .form-error').waitFor();
    assert.match(await page.locator('dialog .form-error').innerText(), /couldn’t send the email/);
    failEmail = false;
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await page.getByRole('heading', { name: 'Check your email.' }).waitFor();
    assert.deepEqual(resetEmails, [user.email, user.email]);
    assert.equal(await page.locator('#account-label').innerText(), 'Account');
    assert.ok(await page.locator('dialog').evaluate(el => el.scrollWidth <= el.clientWidth));
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.reload();
    await page.locator('#account-button').click();
    assert.equal(await page.locator('#account-username').innerText(), user.username);
    assert.equal(await page.locator('#account-email').innerText(), user.email);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForFunction(() => document.querySelector('#account-label').textContent === 'Sign in');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('tp-session-v1')), 'null');
    assert.deepEqual(errors, []);
    console.log('PASS: account identity, legacy session, refresh, retry, password email, mobile layout, persistence and sign-out.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

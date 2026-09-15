# Frontend

English travel-planning interface built with Django templates, CSS and vanilla JavaScript.

## Layout

- `templates/travel/index.html`: page markup.
- `static/travel/app.js`: interaction, API requests and browser storage.
- `static/travel/app.css`: responsive styles.
- `static/travel/images/`, `fonts/`, `*.svg`: visual assets.
- `tests/e2e/browser-smoke.cjs`: browser scenarios, including discovery, trips, authentication and responsive layout.

## Run

Start Django from `backend/` with `python manage.py runserver`, then open http://127.0.0.1:8000/.
No frontend build is required. Assets keep their `/static/travel/` URLs and requests use the same-origin `/api/` endpoints.

## Test

With Node.js, Google Chrome and the backend running, execute from `frontend/`:

```powershell
npm ci
npm run check
npm test
```

Playwright uses an isolated browser context and mocked API responses. It does not create real server records.
Screenshots are written to `docs/previews/` at the repository root.
Set `BASE_URL` to test another local server, or `BROWSER_CHANNEL` to use another installed Playwright-compatible browser channel.
Browser tests belong here; Django template/static delivery checks belong in `backend/tests/integration/`.

# Frontend

English travel-planning interface built with Django templates, CSS and vanilla JavaScript.

## Layout

- `templates/travel/index.html`: page markup.
- `static/travel/app.js`: interaction, API requests and browser storage.
- `static/travel/app.css`: responsive styles.
- `static/travel/images/`, `fonts/`, `*.svg`: visual assets.
- `tests/e2e/browser-smoke.cjs`: browser scenarios, including discovery, trips, authentication and responsive layout.

Place cards use compact category illustrations when a photo is missing or fails to load.
Sights start with Highlights, which prioritise mapped landmarks within the selected
radius. The Show menu also offers Nearest first; other categories use distance.
Place dialogs omit missing photos and descriptions, collapse long stories behind
“Read more”, and keep attribution under “Sources & credits”. Descriptions prefer
linked English Wikipedia articles, resolving foreign-language links through
Wikidata; verified English Wikidata descriptions provide a shorter fallback.
Temporary description failures can be retried from the dialog.
Country flags use the Countries API's `emoji` field with the locally hosted
`fonts/country-flags.woff2` font, so flags also render in Chromium on Windows.
This unmodified font is from [country-flag-emoji-polyfill 0.1.8](https://github.com/talkjs/country-flag-emoji-polyfill),
with [Twemoji](https://twitter.github.io/twemoji/) artwork licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
See `static/travel/fonts/COUNTRY-FLAGS-LICENSE.md` for attribution and licence details.

## Run

Start Django from `backend/` with `python manage.py runserver`, then open http://127.0.0.1:8000/.
No frontend build is required. Assets keep their `/static/travel/` URLs and requests use the same-origin `/api/` endpoints.
The page adds a content-based `?v=…` revision to CSS and JavaScript URLs and is
served with `Cache-Control: no-store`. Reloading the page picks up design changes
even when the browser has cached an earlier version of the assets.

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

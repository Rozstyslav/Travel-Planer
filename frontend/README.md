# Frontend

English travel-planning interface built with Django templates, CSS and vanilla JavaScript.

## Layout

- `templates/travel/index.html`: entry template; assembles the three views.
- `templates/travel/base.html`: shared document, metadata, assets and layout.
- `templates/travel/pages/discover.html`: Discover view, search and place results.
- `templates/travel/pages/trips.html`: Trips heading, filters, empty/loading/error states and workspace messages.
- `templates/travel/pages/saved.html`: Saved view and its empty state.
- `templates/travel/trips/`: trip cards, forms, itinerary, stops and trip selection for adding a place.
- `templates/travel/discover/results.html`: country information, city results, stories and search empty states.
- `templates/travel/places/`: shared place cards, details, descriptions and source credits.
- `templates/travel/account/dialogs.html`: sign-in and account dialogs.
- `templates/travel/components/`: shared header/navigation, footer, modal shell and feedback.
- `static/travel/app.js`: module entry point only.
- `static/travel/js/main.js`: initializes the app and shared actions.
- `static/travel/js/pages/`: `discover.js`, `trips.js`, `saved.js`; behavior and event handlers for each view.
- `static/travel/js/account.js`: sign-in and sign-out behavior.
- `static/travel/js/router.js`: hash navigation and view registration.
- `static/travel/js/core/`: API requests, storage, state, place data, delegated actions and change events.
- `static/travel/js/ui/`: template rendering, dialogs, feedback and workspace status.
- `static/travel/js/components/places.js`: shared place-card rendering, photos and detail dialogs.
- `static/travel/app.css`: responsive styles.
- `static/travel/images/`, `fonts/`, `*.svg`: visual assets.
- `tests/e2e/browser-smoke.cjs`: browser scenarios, including discovery, trips, authentication and responsive layout.
- `tests/e2e/account.cjs`: signup/verification forms, login errors, concurrent token refresh and logout, offline logout, and password reset.

### Where to edit

| What you want to change | HTML/content | JavaScript behavior |
| --- | --- | --- |
| “It starts with curiosity” and Create trip | `templates/travel/pages/trips.html`, template `trips-empty` | `static/travel/js/pages/trips.js`, `renderTrips()` |
| Trip cards | `templates/travel/trips/card.html` | `static/travel/js/pages/trips.js`, `renderTrips()` |
| Create/edit trip, notes, delete confirmation | `templates/travel/trips/forms.html` | `static/travel/js/pages/trips.js` |
| Itinerary and Add place search link | `templates/travel/trips/detail.html` | `static/travel/js/pages/trips.js`, `showTrip()`; `static/travel/js/main.js`, `explore` |
| Add a place to a trip | `templates/travel/trips/add-place.html` | `static/travel/js/pages/trips.js`, `showAddPlace()` |
| Search results and country information | `templates/travel/discover/results.html` | `static/travel/js/pages/discover.js` |
| Saved empty state / bookmarks | `templates/travel/pages/saved.html` | `static/travel/js/pages/saved.js` |
| Shared place cards and details | `templates/travel/places/` | `static/travel/js/components/places.js` |
| Sign-in / account dialogs | `templates/travel/account/dialogs.html` | `static/travel/js/account.js` |

The account dialog supports registration, email verification/resending and password
reset. Email links open the matching dialog via `#verify-email?token=...` or
`#reset-password?uid=...&token=...`; the fragment is cleared after it is read.
Login accepts a username or email. Tokens live in `sessionStorage`. Logout waits
for any ongoing refresh, revokes the current refresh token and clears local
credentials even if the network fails. Backend email setup is documented in
`backend/README.md`.

Edit `components/header.html` for navigation or `base.html` for shared assets
and metadata. `index.html` connects the page templates.

Django renders all three views into one document. The links `/#discover`,
`/#trips` and `/#saved` select a view; `route()` in `static/travel/js/router.js`
shows it and hides the others. The files in `pages/` are included templates,
not separate Django URL endpoints. This keeps search state when switching tabs.
Cards and dialogs use native HTML `<template>` elements. They stay invisible
until the matching page module renders them. Search for a template ID, such as
`trip-card`, to find both its HTML and the JavaScript that supplies its data.

`ui/templates.js` clones these templates: `data-text` inserts plain text,
`data-value` fills inputs and textareas, and `data-bind-*` sets attributes.
`data-if` / `data-unless` conditionally include elements. `data-html` fills a
container and `data-fragment` inserts markup without a wrapper; both accept
only HTML from our own renderers, never raw API or user input. Keep visible
markup and static copy in HTML; keep state, requests and event handlers in JS.

Page modules register their actions and routes during initialization. Services
announce saved-data/session changes through `core/events.js`; they do not import
page modules. This keeps module dependencies free of circular imports.

Trip covers use `static/travel/js/core/trip-cover.js`: local associations,
country names localized with `Intl.DisplayNames`, capitals from the countries
catalog, and the trip's places. Countries without a custom emoji use a compass
and flag. Themes such as mountains or coffee have their own icons.
Unresolved titles use the existing city search API through `trip-cover-lookup.js`;
only matching city names/aliases with an unambiguous country are accepted.
Lookups are cached for the page lifetime (up to 24 hours; failures for a minute),
with at most two requests running at once. Failed or unrelated results keep the
route illustration. Multiple destinations show a globe. Renaming a trip updates
its cover and ignores stale results. No image search requests are made.

To format the HTML templates, run from the repository root:

```powershell
npx prettier --write "frontend/templates/travel/**/*.html" "frontend/static/travel/**/*.js"
```

The root `.prettierignore` excludes the small Django-only `index.html`:
Prettier's HTML parser can wrap its template tags across lines, which Django
cannot render. Keep each `{% ... %}` tag in that file on one line.

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
The page adds a content-based `?v=…` revision to CSS and every JavaScript module
and is served with `Cache-Control: no-store`. Django generates an import map for
the `travel/…` module names. Changing any JS module changes the shared revision,
so reloading cannot mix old cached modules with new code. No bundler is needed.

## Test

With Node.js, Google Chrome and the backend running, execute from `frontend/`:

```powershell
npm ci
npm run check
npm test
```

Playwright uses an isolated browser context and mocked API responses. It does not create real server records.
`npm run check` checks every JavaScript file. The browser suite covers module
cache invalidation, template text/form escaping, empty states, direct navigation,
discovery, guest/server trips and authentication.
Screenshots are written to `docs/previews/` at the repository root; set
`SCREENSHOT_DIR` to put test captures elsewhere.
Set `BASE_URL` to test another local server, or `BROWSER_CHANNEL` to use another installed Playwright-compatible browser channel.
Browser tests belong here; Django template/static delivery checks belong in `backend/tests/integration/`.

# Backend

Django REST Framework, JWT, PostgreSQL and external API clients.

## Layout

- `config/`: Django settings, root URLs, ASGI and WSGI entry points.
- `travel/api/`: HTTP views, serializers and routes.
- `travel/users/`: signup, email verification, login/logout, password reset and authentication tests.
- `travel/clients/`: external API integrations.
- `travel/models.py`, `services.py`, `place_identity.py`: data and business rules.
- `travel/migrations/`: database migrations; keep the existing history.
- `tests/unit/`: clients and place identity.
- `tests/api/`: authentication and endpoint contracts.
- `tests/integration/`: services using the database, migration safety and frontend delivery.
- `tests/fixtures.py`: shared test data.

## Run

Run these commands from `backend/` with the project’s Python environment activated:

```powershell
python -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
python manage.py migrate
python manage.py runserver
```

Set `SECRET_KEY`, `GEOAPIFY_API_KEY` and the `POSTGRES_*` connection settings in
`backend/.env` before running these commands. Keep your existing `SECRET_KEY`;
changing it invalidates signed links and tokens. `.env` is ignored by Git.
The database is PostgreSQL 14 or newer, accessed through Django and psycopg 3.
Create the database named by `POSTGRES_DATABASE` before running `migrate`.
Set `POSTGRES_PASSWORD` if your PostgreSQL server requires a password; for hosted
databases, also set `POSTGRES_SSLMODE` as required by the provider.
The old `backend/db.sqlite3` file is no longer used by the application.
The website is at http://127.0.0.1:8000/ and the API is under `/api/`.
Django loads HTML and static assets from the sibling `frontend/` directory.

## Test

```powershell
python manage.py test tests travel.users
python manage.py test tests.unit
python manage.py test tests.api
python manage.py test tests.integration
python manage.py makemigrations --check --dry-run
```

Provider calls are mocked in the automated suite. Tests use a separate database.
The PostgreSQL role must be allowed to create test databases (`CREATEDB`). Django
creates `test_<POSTGRES_DATABASE>` for the suite; never use the application
database as the test database. Migrations create the schema but do not copy data
from SQLite.

## Accounts

Discovery is public. Project and saved-place endpoints require JWT and are
scoped to the current user, including nested project-place requests. The
`travel.0005_personal_workspace` migration keeps legacy projects with no owner;
they are hidden from the API until an administrator assigns an owner in Admin.
Bookmarks are stored on the server via `GET/POST /api/saved/` and
`DELETE /api/saved/{place_id}/`. Saving verifies place metadata with the provider.

Open **Sign in → Create account** to register with username, email and password.
New accounts must verify their email before signing in. Existing Django users
continue to work with their username; a unique email also works, case-insensitively.
The `users.0001_initial` migration adds verification metadata and reset audit logs;
it does not replace `auth.User` or modify existing trips.

| POST endpoint | Body |
| --- | --- |
| `/api/auth/register/` | `username`, `email`, `password` |
| `/api/auth/login/` | `username` or `email`, plus `password` |
| `/api/auth/verify-email/` | `token` |
| `/api/auth/resend-verification/` | `email` |
| `/api/auth/password-reset/` | `email` |
| `/api/auth/password-reset/confirm/` | `uid`, `token`, `password` |
| `/api/auth/logout/` | `refresh` |

The existing `/api/auth/token/`, `/token/refresh/` and `/token/verify/` routes remain
available. Refresh tokens rotate and are blacklisted on logout. Password changes
invalidate both access and refresh tokens. Logout clears browser credentials;
already-issued access tokens expire within 15 minutes. Public auth routes do not
require a valid access token. Login, registration and email/reset requests are
rate-limited by IP.

To delete a test account, use Django Admin or the Django ORM so related profiles
are deleted and token/audit references are cleared. Deleting only rows from
`auth_user` in a SQL console can leave orphaned records if foreign-key checks
are disabled; an old profile can then reserve an email after its user is gone.
From `python manage.py shell`, delete the intended test account with
`get_user_model().objects.get(username="YOUR_TEST_USERNAME").delete()` after
importing `get_user_model` from `django.contrib.auth`.
Registration cooldowns live in the running server's cache, independently of the
database; wait for them to expire or restart the local development server after
resetting test data.

Verification and password-reset emails use **Resend**, through
`travel/users/resend.py`. There is no console/SMTP fallback, hardcoded recipient,
fixed confirmation code, or email sent at module import time.
Set `RESEND_API_KEY`, `RESEND_FROM_EMAIL` and `APP_BASE_URL` in `backend/.env`,
then restart Django. See `.env.example`.

`onboarding@resend.dev` is a test sender restricted to the email address associated
with your Resend account. To deliver to other users, verify a domain in Resend and
set `RESEND_FROM_EMAIL` to an address on that domain, for example
`Travel Planner <verify@your-domain.com>`.
See [Resend's domain restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

Signup/resend waits for Resend to accept the email. A missing key, provider error
or response without a message ID returns HTTP 503 (`email_delivery_failed`);
the account stays inactive and can retry. A failed resend preserves the previous
verification link. Acceptance by Resend does not guarantee inbox delivery;
delivery/bounce details are available in the Resend dashboard. Tests use an
in-memory outbox or a mocked Resend SDK and never send to real mailboxes.
Verification links expire after 24 hours; reset links after one hour. Both become
unusable after successful use. Resending verification replaces the previous link.
For browser tests, see [frontend/README.md](../frontend/README.md).
Build Docker from the repository root with `docker build -f backend/Dockerfile -t travel-planner .`.

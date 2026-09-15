# Backend

Django REST Framework, JWT, SQLite and external API clients.

## Layout

- `config/`: Django settings, root URLs, ASGI and WSGI entry points.
- `travel/api/`: HTTP views, serializers and routes.
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

Set `GEOAPIFY_API_KEY` in `backend/.env`. The existing database is `backend/db.sqlite3`.
The website is at http://127.0.0.1:8000/ and the API is under `/api/`.
Django loads HTML and static assets from the sibling `frontend/` directory.

## Test

```powershell
python manage.py test tests
python manage.py test tests.unit
python manage.py test tests.api
python manage.py test tests.integration
python manage.py makemigrations --check --dry-run
```

Provider calls are mocked in the automated suite. Tests use a separate database.
For browser tests, see [frontend/README.md](../frontend/README.md).
Build Docker from the repository root with `docker build -f backend/Dockerfile -t travel-planner .`.

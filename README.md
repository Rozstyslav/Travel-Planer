# Travel Planner API

A REST API for creating and managing travel projects and their places.

Places are imported and validated using the external [Art Institute of Chicago API](https://api.artic.edu/docs/). Each place is identified by its external artwork ID.

## Features

### Travel projects

* Create a travel project.
* Create a project together with places in a single request.
* List all projects.
* Retrieve a single project.
* Update project name, description, and start date.
* Delete a project.
* Prevent deleting a project if at least one place is marked as visited.

### Project places

* Add a place to an existing project.
* Validate the place through the Art Institute of Chicago API.
* List all places belonging to a project.
* Retrieve a single place within a project.
* Update place notes.
* Mark a place as visited or not visited.
* Prevent adding the same external place to one project more than once.
* Limit each project to a maximum of 10 places.

### Authentication

* JWT access and refresh tokens.
* Token refresh.
* Token verification.
* Refresh token blacklisting on logout.

## Technology stack

* Python 3.13
* Django
* Django REST Framework
* Simple JWT
* SQLite
* Requests
* Gunicorn
* Docker
* Art Institute of Chicago API

## Project structure

```text
TravelPlanner/
├── TravelPlanner/
│   ├── settings.py
│   ├── urls.py
│   ├── asgi.py
│   └── wsgi.py
│
├── travel/
│   ├── api/
│   │   ├── serializers.py
│   │   ├── urls.py
│   │   └── views.py
│   │
│   ├── clients/
│   │   └── art_institute.py
│   │
│   ├── migrations/
│   ├── tests/
│   ├── admin.py
│   ├── apps.py
│   ├── exceptions.py
│   ├── models.py
│   └── services.py
│
├── postman/
│   ├── TravelPlanner.postman_collection.json
│   └── TravelPlanner.local.postman_environment.json
│
├── Dockerfile
├── manage.py
├── requirements.txt
├── .dockerignore
├── .gitignore
└── README.md
```

## Data models

### TravelProject

| Field         | Type     | Required                |
| ------------- | -------- | ----------------------- |
| `name`        | String   | Yes                     |
| `description` | Text     | No                      |
| `start_date`  | Date     | No                      |
| `created_at`  | DateTime | Automatically generated |
| `updated_at`  | DateTime | Automatically generated |

### ProjectPlace

| Field            | Type        | Description                                        |
| ---------------- | ----------- | -------------------------------------------------- |
| `project`        | Foreign key | Parent travel project                              |
| `external_id`    | Integer     | Artwork ID from the external API                   |
| `title`          | String      | Artwork title retrieved from the external API      |
| `artist_display` | Text        | Artist information retrieved from the external API |
| `image_id`       | String      | External image identifier                          |
| `notes`          | Text        | User notes                                         |
| `visited`        | Boolean     | Whether the place was visited                      |
| `created_at`     | DateTime    | Automatically generated                            |
| `updated_at`     | DateTime    | Automatically generated                            |

The combination of `project` and `external_id` is unique.

## Local installation

### 1. Clone the repository

```bash
git clone <repository-url>
cd TravelPlanner
```

### 2. Create a virtual environment

Windows:

```powershell
python -m venv .venv
.venv\Scripts\activate
```

Linux or macOS:

```bash
python -m venv .venv
source .venv/bin/activate
```

### 3. Install dependencies

```bash
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

### 4. Apply migrations

```bash
python manage.py migrate
```

### 5. Create a user

JWT authentication uses standard Django users.

```bash
python manage.py createsuperuser
```

### 6. Start the development server

```bash
python manage.py runserver
```

The API will be available at:

```text
http://127.0.0.1:8000/api/
```

## Running with Docker

Build the Docker image:

```bash
docker build -t travel-planner .
```

Run the container:

```bash
docker run --rm -p 8000:8000 travel-planner
```

The API will be available at:

```text
http://127.0.0.1:8000/api/
```

### Persisting the SQLite database

To keep the database between container restarts:

```powershell
docker run --rm `
  -p 8000:8000 `
  -e SQLITE_PATH=/data/db.sqlite3 `
  -v travel_data:/data `
  travel-planner
```

Linux or macOS:

```bash
docker run --rm \
  -p 8000:8000 \
  -e SQLITE_PATH=/data/db.sqlite3 \
  -v travel_data:/data \
  travel-planner
```

The Django database configuration must support the optional `SQLITE_PATH` environment variable:

```python
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.getenv(
            "SQLITE_PATH",
            BASE_DIR / "db.sqlite3",
        ),
    }
}
```

### Create a superuser inside Docker

Start a temporary container:

```bash
docker run --rm -it travel-planner python manage.py createsuperuser
```

When using a persistent database volume:

```powershell
docker run --rm -it `
  -e SQLITE_PATH=/data/db.sqlite3 `
  -v travel_data:/data `
  travel-planner `
  python manage.py createsuperuser
```

## JWT authentication

### Obtain access and refresh tokens

```http
POST /api/auth/token/
Content-Type: application/json
```

Request body:

```json
{
  "username": "admin",
  "password": "your-password"
}
```

Example response:

```json
{
  "refresh": "eyJ...",
  "access": "eyJ..."
}
```

Use the access token in protected requests:

```http
Authorization: Bearer <access-token>
```

### Refresh tokens

```http
POST /api/auth/token/refresh/
Content-Type: application/json
```

```json
{
  "refresh": "eyJ..."
}
```

### Verify a token

```http
POST /api/auth/token/verify/
Content-Type: application/json
```

```json
{
  "token": "eyJ..."
}
```

### Logout

```http
POST /api/auth/logout/
Content-Type: application/json
```

```json
{
  "refresh": "eyJ..."
}
```

Logout blacklists the supplied refresh token. An existing access token remains valid until its expiration time.

## API endpoints

All project and place endpoints require:

```http
Authorization: Bearer <access-token>
```

### Authentication endpoints

| Method | Endpoint                   | Description                      |
| ------ | -------------------------- | -------------------------------- |
| `POST` | `/api/auth/token/`         | Obtain access and refresh tokens |
| `POST` | `/api/auth/token/refresh/` | Refresh JWT tokens               |
| `POST` | `/api/auth/token/verify/`  | Verify a token                   |
| `POST` | `/api/auth/logout/`        | Blacklist a refresh token        |

### Project endpoints

| Method   | Endpoint                      | Description                |
| -------- | ----------------------------- | -------------------------- |
| `POST`   | `/api/projects/`              | Create a project           |
| `GET`    | `/api/projects/`              | List projects              |
| `GET`    | `/api/projects/{project_id}/` | Retrieve a project         |
| `PUT`    | `/api/projects/{project_id}/` | Fully update a project     |
| `PATCH`  | `/api/projects/{project_id}/` | Partially update a project |
| `DELETE` | `/api/projects/{project_id}/` | Delete a project           |

### Place endpoints

| Method  | Endpoint                                        | Description              |
| ------- | ----------------------------------------------- | ------------------------ |
| `POST`  | `/api/projects/{project_id}/places/`            | Add a place              |
| `GET`   | `/api/projects/{project_id}/places/`            | List project places      |
| `GET`   | `/api/projects/{project_id}/places/{place_id}/` | Retrieve a place         |
| `PUT`   | `/api/projects/{project_id}/places/{place_id}/` | Update a place           |
| `PATCH` | `/api/projects/{project_id}/places/{place_id}/` | Partially update a place |

Deleting a single place is not included because it is not required by the project specification.

## Request examples

### Create an empty project

```http
POST /api/projects/
Authorization: Bearer <access-token>
Content-Type: application/json
```

```json
{
  "name": "Chicago Trip",
  "description": "Visit artworks in Chicago",
  "start_date": "2026-08-15",
  "places": []
}
```

### Create a project with places

```http
POST /api/projects/
Authorization: Bearer <access-token>
Content-Type: application/json
```

```json
{
  "name": "Chicago Art Trip",
  "description": "Project created with imported places",
  "start_date": "2026-09-01",
  "places": [
    {
      "external_id": 27992,
      "notes": "Visit this artwork first"
    },
    {
      "external_id": 16568,
      "notes": "Visit this artwork second"
    }
  ]
}
```

Every external ID is validated through the Art Institute API before the project is stored.

If any external place does not exist, the project and its places are not created.

### Add a place to a project

```http
POST /api/projects/1/places/
Authorization: Bearer <access-token>
Content-Type: application/json
```

```json
{
  "external_id": 27992,
  "notes": "Added after project creation"
}
```

### Update a project

```http
PATCH /api/projects/1/
Authorization: Bearer <access-token>
Content-Type: application/json
```

```json
{
  "name": "Updated Chicago Trip",
  "start_date": "2026-10-01"
}
```

### Update place notes

```http
PATCH /api/projects/1/places/1/
Authorization: Bearer <access-token>
Content-Type: application/json
```

```json
{
  "notes": "Updated notes"
}
```

### Mark a place as visited

```http
PATCH /api/projects/1/places/1/
Authorization: Bearer <access-token>
Content-Type: application/json
```

```json
{
  "visited": true
}
```

### Update notes and visited status

```http
PATCH /api/projects/1/places/1/
Authorization: Bearer <access-token>
Content-Type: application/json
```

```json
{
  "notes": "Already viewed",
  "visited": true
}
```

## Business rules

### Maximum number of places

A project can contain no more than 10 places.

Attempting to create or add an eleventh place returns an error.

### Duplicate places

The same external place cannot be added to the same project more than once.

The uniqueness rule is enforced both in the service layer and through a database constraint.

### External API validation

Before a place is stored, the application requests the corresponding artwork from:

```text
https://api.artic.edu/api/v1/artworks/{external_id}
```

The following fields are cached locally:

* `external_id`
* `title`
* `artist_display`
* `image_id`

### Project deletion

A project cannot be deleted if any of its places has:

```json
{
  "visited": true
}
```

In that case, the API returns:

```text
409 Conflict
```

## HTTP status codes

| Status                    | Meaning                                        |
| ------------------------- | ---------------------------------------------- |
| `200 OK`                  | Successful retrieval or update                 |
| `201 Created`             | Project or place created                       |
| `204 No Content`          | Project deleted                                |
| `400 Bad Request`         | Invalid request body or invalid external place |
| `401 Unauthorized`        | Missing or invalid JWT access token            |
| `404 Not Found`           | Project or place does not exist                |
| `409 Conflict`            | Business rule violation                        |
| `503 Service Unavailable` | Art Institute API is unavailable               |

## Tests

Run all tests:

```bash
python manage.py test
```

Run only application tests:

```bash
python manage.py test travel.tests
```

Run tests using Docker:

```bash
docker run --rm travel-planner python manage.py test travel.tests
```

The test suite covers:

* Project creation.
* Project creation with places.
* Project listing and retrieval.
* Project updates.
* Project deletion.
* Deletion protection for projects with visited places.
* Adding places.
* External place validation.
* Duplicate place protection.
* Maximum place limit.
* Updating notes and visited status.
* JWT authentication.
* Token refresh and verification.
* Refresh token blacklisting.
* External API error handling.
* Transactional project creation.

External Art Institute API requests are mocked during automated tests.

## Postman collection

The repository includes a Postman collection and a local environment:

```text
postman/
├── TravelPlanner.postman_collection.json
└── TravelPlanner.local.postman_environment.json
```

Import both files into Postman.

Set the following environment variables:

| Variable        | Example                   |
| --------------- | ------------------------- |
| `base_url`      | `http://127.0.0.1:8000`   |
| `username`      | `admin`                   |
| `password`      | Your Django user password |
| `access_token`  | Automatically populated   |
| `refresh_token` | Automatically populated   |
| `project_id`    | Automatically populated   |
| `place_id`      | Automatically populated   |

Run the `Obtain JWT Tokens` request first.

Post-response scripts automatically save:

* Access token.
* Refresh token.
* Created project ID.
* Created place ID.

The collection contains:

* All authentication endpoints.
* All project endpoints.
* All place endpoints.
* Successful use cases.
* Common validation and error cases.

## Main design decisions

### Service layer

Business logic is kept in `travel/services.py` instead of views or serializers.

This includes:

* Creating projects with places.
* Adding places.
* Enforcing the 10-place limit.
* Preventing duplicate places.
* Updating project places.
* Protecting projects with visited places from deletion.

### External API client

Communication with the Art Institute API is isolated in:

```text
travel/clients/art_institute.py
```

This keeps external HTTP logic separate from database and API endpoint logic.

### Transactions

Project creation with places is transactional.

If validation of any place fails, no project or place records are stored.

### Two-model approach

The project uses two domain models:

```text
TravelProject
ProjectPlace
```

A separate global `Place` model is unnecessary because the specification treats places as resources belonging to individual projects.

## License

This project is provided as a technical assignment and educational example.

# Travel Planner

Планувальник подорожей з англійським інтерфейсом: **країна → місто → цікаві місця → опис і фото → маршрут**.
Інтерфейс працює на Django templates, CSS і JavaScript без збірки. Сервер — Django REST Framework, JWT, PostgreSQL.

## Структура проєкту

```text
./                         # Корінь репозиторію (локально: tp/)
├── backend/
│   ├── config/              # settings, URLs, ASGI, WSGI
│   ├── travel/
│   │   ├── api/             # HTTP endpoints і серіалізатори
│   │   ├── clients/         # Countries, Geoapify, Wikipedia
│   │   ├── migrations/      # Історія схеми бази
│   │   ├── models.py
│   │   ├── services.py      # Правила роботи з маршрутами
│   │   └── place_identity.py
│   ├── tests/
│   │   ├── unit/            # Клієнти й ідентичність місць
│   │   ├── api/             # HTTP-контракти й авторизація
│   │   ├── integration/     # Сервіси з ORM, міграції, доставка фронтенду
│   │   └── fixtures.py
│   ├── manage.py
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── frontend/
│   ├── templates/travel/    # base.html — спільний layout; index.html — включення views
│   │   ├── pages/          # discover.html, trips.html, saved.html
│   │   ├── trips/          # Картки, форми, маршрут і вибір місць
│   │   ├── discover/       # Країни, результати пошуку та описи міст
│   │   ├── places/         # Спільні картки, деталі та джерела місць
│   │   ├── account/        # Вхід і вихід
│   │   └── components/     # header.html, footer.html, modal.html, feedback.html
│   ├── static/travel/       # JavaScript, CSS, зображення, шрифти
│   │   └── js/             # pages/, core/, ui/, components/, router.js, main.js
│   ├── tests/e2e/           # Браузерні сценарії Playwright
│   ├── package.json
│   └── package-lock.json
└── docs/
    ├── api/                 # Postman collection
    ├── previews/            # Приклади інтерфейсу
    └── DESIGN.md
```

Фронтенд має власний каталог і залежності для тестів. Django читає його шаблони та статику через `FRONTEND_DIR` у `backend/config/settings.py`; окремий сервер фронтенду чи збірка не потрібні. Адреси `/`, `/api/` та `/static/travel/` збережено.
Докладніше: [backend/README.md](backend/README.md), [frontend/README.md](frontend/README.md).

## Зовнішні API

| Сервіс | Призначення | Клієнт |
| --- | --- | --- |
| [Countries GraphQL](https://github.com/trevorblades/countries) | Назва країни, місцева назва, прапор, столиця, валюта, континент, мови | [countries.py](backend/travel/clients/countries.py) |
| [Geoapify Geocoding](https://apidocs.geoapify.com/docs/geocoding/forward-geocoding/) | Пошук міст із фільтром країни | [geoapify.py](backend/travel/clients/geoapify.py) |
| [Geoapify Places](https://apidocs.geoapify.com/docs/places/) | Пам’ятки, музеї, парки, кав’ярні, ресторани за координатами | той самий клієнт |
| [Geoapify Place Details](https://apidocs.geoapify.com/docs/place-details/) | Перевірка місця перед збереженням, стабільний OSM ID | той самий клієнт |
| [Wikipedia / MediaWiki](https://www.mediawiki.org/wiki/API:Page_info_in_search_results) | Англійські описи, зображення та посилання на джерела | [wikipedia.py](backend/travel/clients/wikipedia.py) |

Art Institute integration removed. The old numeric `external_id` contract is no longer accepted.

## Локальний запуск

### Поточний workspace у PyCharm (`tp`)

Підключення до PostgreSQL задається в `backend/.env`: `POSTGRES_HOST`, `POSTGRES_PORT`,
`POSTGRES_DATABASE`, `POSTGRES_USER`, `POSTGRES_PASSWORD`. Там само зберігається
`SECRET_KEY`. Створіть базу PostgreSQL перед запуском `manage.py migrate`.
Старий файл SQLite більше не використовується; міграції схеми не переносять із нього дані.

Корінь проєкту й Git — `C:\Users\Rostyk\PycharmProjects\tp`. Тут одразу розташовані `backend`, `frontend`, `docs` і налаштований Python у `.venv`. Запустіть із цього каталогу в PowerShell:

```powershell
& .\.venv\Scripts\python.exe .\backend\manage.py runserver
```

Якщо термінал уже в `backend`, еквівалентна команда:

```powershell
& ..\.venv\Scripts\python.exe manage.py runserver
```

Відкрийте **http://127.0.0.1:8000/**. Якщо сервер уже працює на цій адресі, повторний запуск не потрібен. Завершуйте свій сервер через `Ctrl + C` перед перезапуском або використайте інший порт: `manage.py runserver 8001`.

### Перший запуск в іншому середовищі

Корінь репозиторію — каталог, який безпосередньо містить `backend`, `frontend` і цей `README.md`. Назва каталогу після клонування може бути будь-якою. Із цього каталогу, в активованому Python 3.13+ середовищі:

```powershell
cd backend
python -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# Вкажіть GEOAPIFY_API_KEY у .env. Не перезаписуйте наявний налаштований .env.
python manage.py migrate
python manage.py runserver
```

Типові помилки після перенесення:

- `can't open file ... manage.py` або не знайдено `backend`: перевірте поточну папку; файл запуску відносно кореня — `backend/manage.py`.
- `No module named django` або відкривається Microsoft Store: використайте Python налаштованого `.venv`, як у командах вище.
- `No module named TravelPlanner`: застаріла конфігурація запуску; новий модуль налаштувань — `config.settings`, робоча папка — `backend`.
- Порт `8000` зайнятий: перевірте вже запущений сайт або оберіть вільний порт.

Відкрийте **http://127.0.0.1:8000/**. Без входу доступні пошук і перегляд місць.
Для створення колекцій/маршрутів, додавання місць та закладок увійдіть або натисніть **Sign in → Create account**.
Колекції та закладки особисті й зберігаються на сервері. Натискання захищеної дії відкриває вхід;
після успішного входу дія продовжується без втрати поточного пошуку. Скасування входу скасовує цю дію.
Нові акаунти потребують підтвердження email. Листи надсилаються через Resend:
вкажіть `RESEND_API_KEY`, `RESEND_FROM_EMAIL` та `APP_BASE_URL` у `backend/.env`
(див. [backend/README.md](backend/README.md#accounts)).

Ключ завантажується з `GEOAPIFY_API_KEY` середовища або локального `.env`. Змінна середовища має пріоритет.
`.env` підтримує прості рядки `KEY=value`; виконання shell-команд та підстановка змінних не підтримуються.
`.env` виключений із Git і Docker build context. Браузер звертається лише до Django, ключ йому не передається.
Після зміни ключа перезапустіть сервер.

## Нові endpoints для пошуку

Пошук доступний без входу, з обмеженням 60 запитів/хвилину на IP. Записи маршрутів вимагають JWT.

| Метод | Адреса | Параметри |
| --- | --- | --- |
| GET | `/api/countries/` | Список країн у `results` |
| GET | `/api/countries/BR/` | Деталі країни за дволітерним кодом |
| GET | `/api/cities/` | `q=Львів&country=UA&limit=6` |
| GET | `/api/places/` | `latitude=49.8419&longitude=24.0316&categories=tourism.sights&radius=5000&limit=12&offset=0` |
| GET | `/api/places/{place_id}/` | Перевірені геодані, опис, фото, статус Wikipedia |
| GET | `/api/wikipedia/` | Один із параметрів: `title=Львів` або `q=Львівська ратуша` |

`country` у пошуку міст необов’язковий. `limit`: міста 1–10, місця 1–20.
`radius`: 100–50000 метрів, `offset`: 0–500 (0–1000 для Highlights). Координати — скінченні числа в межах широти/довготи.
`sort`: `distance` (типово для API) або `highlights` (для `tourism.sights`, типово в інтерфейсі).
Фільтр Sights охоплює туристичні й архітектурні пам'ятки, культурні заклади (`entertainment.culture`,
зокрема театри, галереї та мистецькі центри), музеї, спадщину й історичні будівлі.
Highlights виконує п'ять паралельних запитів — до 200 об'єктів кожної групи у вибраному радіусі,
щоб численні меморіальні таблички не витісняли інші типи місць. Об'єднує результати, прибирає дублікати та сортує
за ознаками значущості OSM: importance, landmark, UNESCO, посилання на Wikipedia/Wikidata й назви різними мовами.
Це добірка за доступними даними, а не повний рейтинг популярності. Набір кешується на 15 хвилин
і ділиться на сторінки після сортування; інші категорії зберігають порядок за відстанню.
Підтримані категорії: `tourism.sights`, `tourism.attraction`, `entertainment.museum`, `leisure.park`, `catering.cafe`, `catering.restaurant`.

Пошук місць повертає `results`, `offset`, `limit`, `has_more`. Для Highlights `has_more` перевіряє наявність наступного результату;
для пошуку за відстанню означає, що поточна сторінка повна й ліміт пагінації не досягнуто, тому наступна може бути порожньою.
Пошук міст використовує `https://api.geoapify.com/v1/geocode/search`, адже `/v2/places` призначений для POI, а не геокодування назви міста.

### Послідовність запитів

1. Отримайте країну з `/api/countries/UA/`.
2. Знайдіть місто через `/api/cities/?q=Львів&country=UA`.
3. Передайте його `latitude` і `longitude` у `/api/places/`.
4. Відкрийте `/api/places/{place_id}/` для опису та зображення.
5. Додайте `place_id` у маршрут. Назва, координати й інші геодані повторно перевіряються на сервері.

## Маршрути

| Метод | Адреса | Дія |
| --- | --- | --- |
| GET / POST | `/api/projects/` | Список / створення |
| GET / PUT / PATCH / DELETE | `/api/projects/{id}/` | Деталі / зміни / видалення |
| GET / POST | `/api/projects/{id}/places/` | Зупинки / додавання |
| GET / PUT / PATCH | `/api/projects/{id}/places/{place_pk}/` | Деталі зупинки / нотатки та відвідування |

```json
{
  "name": "Вікенд у Львові",
  "description": "Прогулянка старим містом",
  "start_date": "2026-10-20",
  "places": [{"place_id": "PLACE_ID_FROM_SEARCH", "notes": "Почати тут"}]
}
```

Додавання зупинки:

```json
{"place_id": "PLACE_ID_FROM_SEARCH", "notes": "Піднятися на вежу"}
```

Оновлення зупинки:

```json
{"notes": "Чудовий краєвид", "visited": true}
```

`ProjectPlace` містить `place_id`, `source_id`, `name`, `address`, `country_code`, `city`, `latitude`, `longitude`, `categories`, `description`, `image_url`, `wikipedia_url`, `wikipedia_title`, `wikipedia_match`, `notes`, `visited`, часові поля.
`place_id` — зовнішній рядковий ідентифікатор. `id` / `{place_pk}` — локальний числовий ключ запису в маршруті.

У маршруті максимум 10 місць. Створення з місцями атомарне. Повтори перевіряються за `place_id` і стабільним `source_id`: Geoapify може повертати різні координати всередині ID одного об’єкта.
Подорож із відвіданими місцями захищена від видалення. Користувач бачить і змінює лише власні маршрути та їхні місця.
Міграція `travel.0005_personal_workspace` додає власників і серверні закладки. Старі спільні маршрути
збережені з `owner=NULL` і приховані з користувацького API; адміністратор може призначити їм власника в Django Admin.

Закладки: `GET /api/saved/` — особистий список; `POST /api/saved/` з `{"place_id":"..."}` —
збереження перевіреного сервером місця; `DELETE /api/saved/{place_id}/` — видалення власної закладки.
Усі ці запити потребують JWT; повторне збереження того самого місця не створює дубліката.

## JWT

- `POST /api/auth/token/` — `{"username": "...", "password": "..."}`.
- `POST /api/auth/token/refresh/` — `{"refresh": "..."}`.
- `POST /api/auth/token/verify/` — `{"token": "..."}`.
- `POST /api/auth/logout/` — `{"refresh": "..."}`.

Передайте `Authorization: Bearer <access>` до захищених endpoints. Фронтенд зберігає токени в `sessionStorage`, автоматично оновлює їх та виконує blacklist під час виходу.
Старі гостьові дані в localStorage не завантажуються й не приписуються акаунту автоматично.

## Wikipedia і помилки

Дані Wikipedia автоматично завантажуються для карток поблизу видимої частини сторінки (до двох запитів одночасно). Деталі та додавання місця використовують той самий результат без повторного запиту.
Пряме англійське посилання з Geoapify дає `wikipedia_match=linked`. Пошуковий збіг дає `search` і явно позначений в інтерфейсі як пов’язана стаття, відповідність якої слід перевірити. Geoapify отримує `lang=en`, а описи завантажуються з англійської Wikipedia.
Відсутня стаття — нормальний результат `found=false`. Недоступність Wikipedia не блокує збереження географічно перевіреного місця; деталі повертають `wikipedia_status=unavailable`.
Якщо англійська стаття не має фото, використовуються зображення P18 із Wikidata або іншомовна стаття, прямо пов’язана з об’єктом у Geoapify. `image_source_url` зберігає джерело фото окремо від джерела опису. Коли фото не знайдено, картка показує відповідне повідомлення. У деталях місця прибрані окремі блоки про фото, авторів і ліцензії; джерела фото залишаються на картках.

Координати в картках, деталях і маршрутах відкривають OpenStreetMap із маркером вибраного місця.

Пошук міст показує головний результат із назвою області; інші однойменні населені пункти доступні в секції `Other matches`. Геокодування зберігає область у полі `region`.
Для пошуку місць використовується умова Geoapify `named`: безіменні ділянки не витісняють іменовані парки. Назва міста більше не використовується як назва безіменного об’єкта; для таких об’єктів також не виконується пошук описів чи фото міста.

Повторні записи пошуку об’єднуються за стабільною ідентичністю або однаковими варіантами назви в межах 150 метрів. Різні Wikidata-ідентифікатори й віддалені однойменні місця залишаються окремими. Пагінація враховує початкову кількість записів провайдера, а інтерфейс також прибирає повтори між сторінками. Стаття Wikipedia, знайдена для місця, має відповідати його назві: загальна стаття міста не використовується як опис чи фото пам’ятника.

Останній резервний варіант — пошук точної назви (щонайменше два слова) у Wikimedia Commons. Такі фото мають `image_match=search` та явну позначку в інтерфейсі: відповідність місцю слід перевірити за джерелом.

Відповіді Countries і Wikipedia кешуються на 24 години; Geoapify — на 15 хвилин у Django cache.
Мережеві запити мають таймаут 12 секунд. Помилки не містять URL із ключем.

| Код | Значення |
| --- | --- |
| 400 | Невалідні параметри або невідомі поля, включно зі старим `external_id` |
| 401 | Немає дійсної авторизації |
| 404 | Країну, місце або запис не знайдено |
| 409 | Повтор, ліміт зупинок або захищене видалення |
| 429 | Ліміт запитів до пошуку |
| 503 | Сервіс недоступний або не налаштований; див. `provider` і `code` |

## Перехід зі старої версії

Міграція `0002_geographic_places` зберігає старі записи повністю в `TravelProject.archived_places`: ID, дані, нотатки, позначки відвідування й час.
Після цього створюється нова таблиця географічних зупинок. Проєкти, користувачі й JWT залишаються.
Архів доступний адміністратору в Django Admin. API проєкту показує `archived_place_count` та `archived_visited_count`; старі картини не видаються за географічні місця.
Захист від видалення враховує лише відвідані зупинки поточного маршруту. Архівні записи не блокують видалення та видаляються разом із проєктом після підтвердження.

Перед застосуванням до існуючої бази зробіть резервну копію. Для цієї локальної бази копію збережено в кореневому `.test-artifacts/before-geography-*.sqlite3`.
Зворотна міграція відновлює старі записи, але видаляє нові географічні зупинки — для повного повернення використовуйте резервну копію.
Гостьові дані старого інтерфейсу залишаються в localStorage (`tp-trips-v1/v2`, `tp-saved-v1/v2`), але більше не використовуються.

## Перевірки

```powershell
# Із каталогу backend/
python manage.py test tests travel.users
python manage.py test tests.unit
python manage.py test tests.api
python manage.py test tests.integration
python manage.py makemigrations --check --dry-run
```

Тести зовнішніх сервісів імітують відповіді: GraphQL errors, JSON, таймаути, ключ, відсутні дані, координати, кеш, дублі, атомарність, авторизація та перенесення архіву вперед/назад.
Браузерна перевірка в іншому терміналі, при активному Django-сервері:

```powershell
cd frontend
npm ci
npm run check
npm test
```

Потрібні Node.js і встановлений Google Chrome. Версію Playwright зафіксовано в `package-lock.json`. Змінні `BASE_URL` і `BROWSER_CHANNEL` необов’язкові.
Браузерні тести працюють в ізольованому контексті з імітованими відповідями, не створюють реальних серверних записів. Скріншоти в `docs/previews/` містять тестові приклади.

Postman: імпортуйте `docs/api/travel-planner.postman_collection.json`. Ключ Geoapify не потрібен у Postman — лише на Django-сервері.

## Docker та ресурси

```powershell
# Із кореня репозиторію
docker build -f backend/Dockerfile -t travel-planner .
docker run --rm -p 8000:8000 --env-file backend/.env travel-planner
```

Gunicorn обслуговує API та HTML. Для статичних файлів налаштуйте вебсервер або static middleware та виконайте `python manage.py collectstatic` із `backend/`: файли збираються в `backend/staticfiles/`. Django `runserver` обслуговує їх автоматично.
Геодані: Geoapify / © OpenStreetMap contributors, ODbL. Описи: автори Wikipedia, CC BY-SA 4.0; фотографії мають окремі ліцензії на сторінках файлів, посилання на джерело показані в UI.
Візуальний напрям та ресурси: [DESIGN.md](docs/DESIGN.md).

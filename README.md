# Travel Planner

Планувальник подорожей: оберіть країну й місто, знайдіть цікаві місця та додайте їх до власного маршруту. Інтерфейс англійською.

## Можливості

- Пошук країн, міст, пам’яток, музеїв, парків, кав’ярень і ресторанів.
- Перегляд описів, фотографій та розташування місць на OpenStreetMap.
- Особисті маршрути, нотатки, позначки відвідування та закладки.

Пошук доступний без входу. Для маршрутів і закладок потрібен акаунт із підтвердженим email.

## Локальний запуск

Потрібні **Python 3.13+** і **PostgreSQL**. Команди нижче — для PowerShell, із кореня репозиторію (де розташовані `backend/` і `frontend/`).

### 1. Підготуйте середовище

Якщо `.venv` уже налаштовано в PyCharm, пропустіть першу команду.

```powershell
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
if (-not (Test-Path .\backend\.env)) { Copy-Item .\backend\.env.example .\backend\.env }
```

### 2. Налаштуйте базу та ключі

Створіть базу PostgreSQL, наприклад `travel_planner`, і заповніть [backend/.env](backend/.env) за зразком [.env.example](backend/.env.example):

| Змінні | Що вказати |
| --- | --- |
| `SECRET_KEY` | Власний випадковий секретний ключ Django |
| `POSTGRES_HOST`, `POSTGRES_PORT` | Адреса й порт PostgreSQL; локально — `localhost`, `5432` |
| `POSTGRES_DATABASE`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Назва створеної бази та дані користувача PostgreSQL |
| `GEOAPIFY_API_KEY` | Ключ Geoapify для пошуку міст і місць |
| `MAILERSEND_API_KEY`, `MAILERSEND_FROM_EMAIL` | Ключ і відправник MailerSend для підтвердження email та відновлення пароля |
| `APP_BASE_URL` | Адреса сайту; локально — `http://127.0.0.1:8000` |

Для реєстрації налаштуйте MailerSend: адреса відправника має належати підтвердженому або виданому тестовому домену. Деталі — у [налаштуваннях акаунтів](backend/README.md#accounts). Після зміни `.env` перезапустіть сервер.

### 3. Запустіть застосунок

```powershell
& .\.venv\Scripts\python.exe .\backend\manage.py migrate
& .\.venv\Scripts\python.exe .\backend\manage.py runserver
```

Відкрийте **http://127.0.0.1:8000/**. Для наступних запусків достатньо останньої команди.

## Як влаштований проєкт

Сервер — Django REST Framework, JWT і PostgreSQL. Інтерфейс — Django templates, CSS та JavaScript; Django також віддає сторінку й статичні файли.

| Каталог | Вміст |
| --- | --- |
| `backend/` | Налаштування Django, API, моделі, інтеграції та серверні тести |
| `frontend/` | HTML-шаблони, стилі, JavaScript і браузерні тести |
| `docs/` | Postman-колекція, опис дизайну та скріншоти |

Countries API надає дані країн ([countries.py](backend/travel/clients/countries.py)), Geoapify — міста й місця, Wikipedia/Wikimedia — описи та фото.

## Документація та перевірки

- [Backend](backend/README.md) — сервер, авторизація, MailerSend і запуск тестів.
- [Frontend](frontend/README.md) — структура інтерфейсу та тести; Node.js і Chrome потрібні для перевірок, окрема збірка для запуску сайту не потрібна.
- [Postman-колекція](docs/api/travel-planner.postman_collection.json) — приклади запитів до API.
- [Дизайн і ресурси](docs/DESIGN.md) — оформлення та візуальні матеріали.

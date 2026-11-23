# 🍡 PROJECT CARD — M-o-chi.com (mochi-forum)

> **Самодостаточная карточка проекта.** Если вы — ИИ или новый разработчик — этого файла
> хватит для ориентации в кодовой базе. Обновляется вручную при существенных изменениях.
> Последнее обновление: 2026-09-16.

---

## 1. Что это

**M-o-chi.com** — форум, написанный с нуля без фреймворков и без сборки. В одном репозитории
живут **два независимых SPA на общем Express-сервере**:

1. **Основной форум** (`/` → `public/index.html`) — категории, темы, сообщения, посты профиля
   с rich-редактором, лента, ЛС 1-на-1, уведомления, жалобы, баны, админка, конструктор тем.
2. **Mochi chats** (`/chats.html` → отдельное SPA) — групповые чаты («чатсы») с персонами,
   кастомными ролями, подчатсами, заявками на вход, упоминаниями @ник.

Весь интерфейс и комментарии в коде — на **русском** языке.

---

## 2. Quick facts

| Факт | Значение |
|---|---|
| Корень репозитория | `mochi-forum/` |
| Runtime | Node.js ≥ 18 (CommonJS, `require`, **без** сборщиков/бандлеров) |
| Backend | Express 4 + pg (PostgreSQL), 13 роутеров, ~120+ эндпоинтов |
| БД | PostgreSQL 16 (Docker, хост-порт **5433** → 5432), SQL-миграции |
| Фронтенд | Vanilla JS, hash-роутинг, `<script>`-подключение в строгом порядке |
| Аутентификация | JWT (7 дней, `Authorization: Bearer`), токен в `localStorage` (`mochi_token`) |
| Реалтайм | **HTTP-поллинг** (уведомления 30 с, бейдж чатсов 20 с). WebSocket/SSE нет |
| Загрузки | multer → диск (`server/uploads/` + `uploads/fonts/`), статика `/uploads` |
| Порты | приложение **3000**, БД **5433** (не 5432!) |
| Тесты | интеграционные скрипты; требуют **запущенного сервера и сида** |

---

## 3. Команды

```bash
docker compose up -d db        # поднять Postgres на localhost:5433
docker compose up -d --build   # всё в Docker (порт 3000; авто-миграции + сид при старте)

cd server
npm install
npm run migrate                # SQL-миграции из db/migrations (идемпотентно)
npm run seed                   # демо-данные (флаг --force — пересев, TRUNCATE)
npm start                      # node src/index.js → http://localhost:3000
npm run dev                    # node --watch src/index.js (без nodemon)

node scripts/test-api.js       # 65 проверок (сервер должен быть запущен)
node scripts/test-features.js  # 46 проверок: посты, подписки, dm_policy, шрифты
node scripts/test-gchats.js    # 83 проверки чатсов
```

Демо-аккаунты после сида: `admin/admin123`, `moderator/mod12345`, `sakura/sakura123`,
`tech_guy/tech12345`, `newbie_kate/kate12345`.

## 4. Карта репозитория

```
mochi-forum/
├── PROJECT_CARD.md          ← этот файл
├── README.md                ← документация (возможности, API, архитектура)
├── docker-compose.yml       ← db (postgres:16-alpine, 5433:5432) + app (порт 3000)
├── Dockerfile               ← node:20-alpine; CMD: migrate && seed && node src/index.js
├── .env.example             ← шаблон переменных окружения
├── .gitignore               ← node_modules, .env, server/uploads/*, *.log
│
├── public/                  ← ФРОНТЕНД (отдаётся Express как статика)
│   ├── index.html           ← оболочка форума (шапка, SVG-логотип, поиск, роутер)
│   ├── chats.html           ← оболочка Mochi chats (отдельное SPA)
│   ├── assets/              ← favicon.svg, logo.svg
│   ├── css/
│   │   ├── style.css        ← дизайн-система на CSS-переменных (темы)
│   │   └── chats.css        ← стили чатсов
│   └── js/
│       ├── api.js           ← fetch-клиент: API.get/post/put/patch/del/upload, JWT
│       ├── theme.js         ← движок тем, 6 пресетов, шеринг ?theme=<base64>
│       ├── ui.js            ← esc(), тосты, модалки, пагинация, avatar()
│       ├── app.js           ← роутер форума, шапка, состояние юзера, поллинг
│       ├── pages/           ← core.js (главная/категория/тема/поиск), user.js (профиль/настройки),
│       │                      posts.js (лента/редактор/пост), social.js (чат ЛС/админка)
│       └── chats/           ← core.js (роутер чатсов), feed.js (каталог),
│                              chat.js (86КБ — вся логика чатса), core-boot.js (загрузчик)
│
└── server/
    ├── package.json         ← mochi-forum-server@1.0.0, 8 зависимостей, 0 dev
    ├── .env                 ← локальный конфиг (НЕ коммитится)
    ├── db/migrations/       ← 001…007 SQL-миграций (см. §7)
    ├── scripts/             ← migrate.js, seed.js, test-api.js, test-features.js, test-gchats.js
    ├── uploads/             ← фото юзеров + fonts/; в .gitignore
    └── src/
        ├── index.js         ← точка входа: helmet, cors, статика, 13 роутеров, ошибки, SPA-fallback
        ├── config/db.js     ← pg.Pool (DATABASE_URL) + query() + withTransaction()
        ├── middleware/
        │   ├── auth.js      ← JWT, requireAuth/optionalAuth/requireRole, баны, touchLastSeen
        │   ├── validate.js  ← валидаторы v.* + in-memory rateLimit
        │   └── upload.js    ← multer: фото ≤5МБ (jpeg/png/gif/webp), шрифты ≤10МБ (ttf/otf/woff/woff2)
        ├── routes/          ← auth, users, categories, topics, posts, chat(ЛС), gchats(72КБ),
        │                      user-posts, feed, notifications, reports, search, admin, upload
        └── utils/
            ├── helpers.js   ← ApiError, bad/notFound/forbidden/unauthorized, asyncH, paginate, slugify, notify
            ├── post-utils.js ← allowlist-санитайзер rich-HTML
            └── gchat-utils.js ← хелперы чатсов (права, системные фразы)
```

---

## 5. Стек

### Backend-зависимости (server/package.json)
| Пакет | Роль |
|---|---|
| `express ^4.19.2` | HTTP-сервер, роутинг, статика |
| `pg ^8.12.0` | пул PostgreSQL, параметризованные запросы |
| `bcryptjs ^2.4.3` | пароли (10 раундов) |
| `jsonwebtoken ^9.0.2` | JWT-сессии (7 дней) |
| `multer ^1.4.5-lts.1` | multipart-загрузки на диск |
| `helmet ^7.1.0` | security-заголовки (CSP отключён) |
| `cors ^2.8.5` | CORS (открыт для всех origin) |
| `dotenv ^16.4.5` | конфиг из .env |

### Frontend
Vanilla JS без фреймворков и сборки. Глобальные неймспейсы подключаются в строгом порядке:

- Форум: `api.js` → `theme.js` → `ui.js` → `pages/core.js` → `pages/user.js` → `pages/posts.js` → `pages/social.js` → `app.js`
- Чатсы: `api.js` → `ui.js` → `chats/core.js` → `chats/feed.js` → `chats/chat.js` → `chats/core-boot.js`

### Инфраструктура
docker-compose (сервисы `db` + `app`, volumes `pgdata`, `uploads`), Dockerfile с авто-миграцией и сидом при старте.

## 6. Конфигурация (.env)

| Переменная | По умолчанию | Описание |
|---|---|---|
| `PORT` | 3000 | порт HTTP |
| `DATABASE_URL` | `postgres://mochi:mochi_secret@localhost:5432/mochi` | строка подключения; локально в dev — порт **5433** |
| `JWT_SECRET` | fallback `dev-secret-change-me` | секрет JWT — **сменить в продакшене** |
| `UPLOAD_DIR` | `uploads` | каталог загрузок (относительно server/) |
| `MAX_UPLOAD_MB` | 5 | лимит фото |
| `MAX_FONT_MB` | 10 | лимит шрифта |

В docker-compose: `DATABASE_URL=postgres://mochi:mochi_secret@db:5432/mochi`.

---

## 7. База данных

Мигратор `scripts/migrate.js` применяет SQL-файлы из `db/migrations/` по алфавиту;
журнал применённых — таблица `schema_migrations`.

| Миграция | Содержимое |
|---|---|
| `001_init.sql` | users, categories, topics, posts, likes, conversations, messages, notifications, reports, bans, schema_migrations |
| `002_add_message_updated_at.sql` | messages.updated_at (редактирование) |
| `003_add_chat_archive_ignore.sql` | флаги архив/игнор диалогов (по обеим сторонам) |
| `004_user_posts_follows_dm.sql` | users.dm_policy (all/followers/following), follows, user_posts |
| `005_group_chats.sql` | users.last_seen_at; gchats, gchat_roles, gchat_members, gchat_bans, gchat_join_requests, gchat_invites, gchat_personas, gchat_subchats, gchat_ignores, gchat_messages, gchat_pins |
| `006_chat_announcement.sql` | gchats.announcement |
| `007_head_bg.sql` | gchats.head_bg (JSONB) |

Особенности схемы:
- `user_posts.content` и `gchats.description` — **JSONB** `{"html":"...","fonts":[...]}` (rich-контент);
- теги — `TEXT[]` + GIN-индекс (`user_posts.tags`, `gchats.tags`);
- ответы на ответы — `posts.parent_post_id`; мягкое удаление — флаг `deleted`;
- упоминания в чатсах — `gchat_messages.mentioned_ids INT[]`;
- роли — `users.role IN ('user','moderator','admin')`; кастомные роли чатсов — `gchat_roles.permissions TEXT[]`, лимит 5/чат;
- видимость чатсов — `gchats.kind IN ('public','request','private')` (request = вход по заявке, слот раз в сутки);
- все `*_at` — `TIMESTAMPTZ`; каскадные FK `ON DELETE CASCADE`.

---

## 8. API-карта

Пути монтируются в `server/src/index.js` под `/api/*`; каждый обработчик задокументирован
комментарием `/** GET /api/... */`.

| Маунт | Содержимое | Доступ |
|---|---|---|
| `/api/auth` | register, login (rate-limit 40/15 мин), me | публично / токен |
| `/api/users` | профиль+статистика, topics/posts юзера, PUT me (профиль+тема+dm_policy), аватар, follow/unfollow, followers/following | mixed |
| `/api/categories` | список (публично), CRUD (admin) | mixed |
| `/api/topics` | лента тем (фильтры/сортировки/пагинация), тема, посты темы, ответ, pin/lock | mixed |
| `/api/posts` | PATCH/DELETE (правка / мягкое удаление), like-toggle | requireAuth |
| `/api/user-posts` | CRUD постов профиля, `/:id/topic` (тема обсуждения — 1 раз) | mixed |
| `/api/feed` | `?tab=recent\|popular\|following` | mixed |
| `/api/chat` | ЛС 1-на-1 с учётом dm_policy, архив/игнор, фото, непрочитанные | requireAuth |
| `/api/gchats` | ~45 эндпоинтов: чатсы, заявки/инвайты, участники, роли, мьют/бан, сообщения (ответы, @упоминания, пины), персоны с ревью, подчатсы, typing, поиск, notif-badge | mixed |
| `/api/notifications` | список, unread-count | requireAuth |
| `/api/reports` | жалобы + очередь (mod/admin) | mixed |
| `/api/search` | единый поиск (темы/сообщения/юзеры/посты; `#тег` → посты) | публично |
| `/api/admin` | stats, юзеры, роль/бан/разбан, история банов | admin |
| `/api/upload` | `/` фото, `/font` шрифт | requireAuth |
| `/api/health` | ping + проверка БД | публично |
| `/*` (не /api) | SPA-fallback → `public/index.html` | — |

Ошибки всегда `{"error": "..."}`; для бана — 403 с `{banned: true}`.

## 9. Фронтенд-архитектура

- **Hash-роутинг.** Форум (`app.js`, `ROUTES`): `#/`, `#/feed`, `#/category/:slug`, `#/topic/:id`,
  `#/post/:id`, `#/post-editor`, `#/u/:username`, `#/login`, `#/register`, `#/settings`,
  `#/notifications`, `#/chat(/:id)`, `#/search?q=`, `#/admin`.
  Чатсы (`chats/core.js`) — свой независимый набор маршрутов.
- **Рендер** — шаблонные строки в `innerHTML`; всё пользовательское содержимое через `UI.esc()` (XSS).
- **Темы** — `Theme`: light/dark/кастом (accent, accent2, radius, fontScale, gradient), 6 пресетов;
  хранение в профиле юзера (JSONB `users.theme`) + локально; шеринг `?theme=<base64>` или base64-код.
- **Поллинг**: форум — `/api/notifications/unread-count` каждые 30 с; чатсы — бейдж 20 с;
  typing — POST `/api/gchats/:id/typing` + чтение при поллинге сообщений.

---

## 10. Конвенции кода (как добавлять что-то)

**Новый эндпоинт:**
```js
// server/src/routes/xxx.js
const express = require('express');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { asyncH, bad, paginate } = require('../utils/helpers');
const router = express.Router();

/** GET /api/xxx — описание */
router.get('/', requireAuth, asyncH(async (req, res) => { /* ... */ }));
module.exports = router;
```
…и подключить в `src/index.js`. Транзакции — `withTransaction(async (client) => {...})` из `config/db.js`.

**Валидация входа** — только через `v.*` из `middleware/validate.js`
(`v.str`, `v.email`, `v.int`, `v.oneOf`, `v.bool`); ошибки — `bad('сообщение')` (400).

**Ошибки** — класс `ApiError` из `utils/helpers.js` (`bad`, `notFound`, `forbidden`, `unauthorized`);
роуты оборачиваются в `asyncH`; общий обработчик в `src/index.js` (учитывает и ошибки multer).

**Уведомления** — только через `notify(pool, { userId, type, actorId, entityType, entityId, payload })`
из `utils/helpers.js` (не бросает ошибок).

**Rich-HTML** (посты, описания чатсов) — HTML от contenteditable-редактора проходит строгий
allowlist-санитайзер `utils/post-utils.js`. Не сохранять сырой HTML.

**Миграция**: создать `db/migrations/00N_название.sql` (везде IF NOT EXISTS / IF EXISTS),
прогнать `npm run migrate`. Журнал — `schema_migrations`.

**Slug** — `slugify()` (транслитерация RU→EN). **Пагинация** — `paginate(req.query, defLimit)` → `{page, limit, offset}`, лимит ≤ 50.

---

## 11. Безопасность

Есть: bcrypt(10), JWT 7д, параметризованный SQL, экранирование на фронте, allowlist-санитайзер,
rate-limit логина, лимиты файлов (фото ≤5МБ, шрифты ≤10МБ), helmet, скрытие x-powered-by,
проверка ролей на каждом защищённом эндпоинте, троттлинг last_seen (1 мин/юзер).

Слабые места (осознанно, для будущего): `cors()` открыт всем, CSP выключен, JWT в localStorage,
rate-limit и lastSeen in-memory (не переживают рестарт, не масштабируются), fallback-секрет JWT,
файлы не верифицируются по magic bytes.

## 12. Грабли (важно знать)

1. **Два SPA**: `index.html` и `chats.html` — независимые роутеры, общий `api.js`/`ui.js`.
2. Порядок `app.use` в `index.js` важен: `/uploads` → статика → `/api/*` → 404-обработчик `/api` → обработчик ошибок → SPA-fallback `app.get('*')`.
3. БД в dev — порт **5433**, не 5432 (чтобы не конфликтовать с системным PostgreSQL).
4. Тесты `scripts/test-*.js` — **интеграционные**: нужен запущенный сервер + сид; мутируют данные.
5. `npm run seed -- --force` делает TRUNCATE основных таблиц — демо-данные будут пересозданы.
6. `server/src/routes/gchats.js` — самый большой файл (~72КБ, ~45 эндпоинтов); править точечно.
7. Сборки нет — после правки JS/CSS просто перезагрузить страницу; бэкенд — рестарт `npm start` (или `npm run dev` с --watch).
8. Зависимости: 8 production-пакетов, **0 dev-зависимостей**; CI/linter/prettier отсутствуют.
9. Загрузки живут на диске (`server/uploads/`), в Docker — volume `uploads`; при смене хостинга файлы переносятся отдельно.
10. Миграции обязаны быть идемпотентными (IF NOT EXISTS / частичные индексы), т.к. каждый файл применяется один раз, но повторный запуск должен быть безопасным.

---

## 13. Точки расширения (кандидаты)

- WebSocket/SSE для живых сообщений и онлайн-статусов (сейчас поллинг);
- Redis (rate-limit, кэш, pub/sub), pg_trgm/tsvector для полнотекстового поиска;
- S3/MinIO для uploads, sharp для превью/WebP;
- OAuth-вход, email-верификация и восстановление пароля (Nodemailer) — их нет;
- ESLint/Prettier, Jest+Supertest, GitHub Actions, Swagger/OpenAPI;
- pino/winston для логов, PM2, nginx + HTTPS для продакшена.





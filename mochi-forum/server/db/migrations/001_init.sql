-- ============================================================
-- M-o-chi.com — начальная схема БД
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(32) UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          VARCHAR(16) NOT NULL DEFAULT 'user'
                CHECK (role IN ('user','moderator','admin')),
  avatar_url    TEXT,
  bio           TEXT NOT NULL DEFAULT '',
  signature     TEXT NOT NULL DEFAULT '',
  theme         JSONB NOT NULL DEFAULT '{"mode":"dark"}'::jsonb,
  banned_until  TIMESTAMPTZ,
  ban_reason    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (lower(username));

CREATE TABLE IF NOT EXISTS categories (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  slug        VARCHAR(120) UNIQUE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon        VARCHAR(16) NOT NULL DEFAULT '🍡',
  color       VARCHAR(7),
  position    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS topics (
  id               SERIAL PRIMARY KEY,
  category_id      INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  author_id        INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            VARCHAR(200) NOT NULL,
  slug             VARCHAR(220) NOT NULL,
  content          TEXT NOT NULL,
  image_url        TEXT,
  pinned           BOOLEAN NOT NULL DEFAULT false,
  locked           BOOLEAN NOT NULL DEFAULT false,
  views            INT NOT NULL DEFAULT 0,
  post_count       INT NOT NULL DEFAULT 0,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_topics_category ON topics (category_id, pinned DESC, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_topics_author ON topics (author_id);

CREATE TABLE IF NOT EXISTS posts (
  id             SERIAL PRIMARY KEY,
  topic_id       INT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  author_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_post_id INT REFERENCES posts(id) ON DELETE SET NULL,
  content        TEXT NOT NULL DEFAULT '',
  image_url      TEXT,
  like_count     INT NOT NULL DEFAULT 0,
  edited         BOOLEAN NOT NULL DEFAULT false,
  deleted        BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_posts_topic ON posts (topic_id, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts (author_id);

CREATE TABLE IF NOT EXISTS likes (
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    INT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id              SERIAL PRIMARY KEY,
  user1_id        INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user2_id        INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user1_id, user2_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              SERIAL PRIMARY KEY,
  conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content         TEXT NOT NULL DEFAULT '',
  image_url       TEXT,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(32) NOT NULL,
  actor_id    INT REFERENCES users(id) ON DELETE SET NULL,
  entity_type VARCHAR(32),
  entity_id   INT,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  read        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, read, created_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id               SERIAL PRIMARY KEY,
  reporter_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type      VARCHAR(16) NOT NULL CHECK (target_type IN ('post','topic','message','user')),
  target_id        INT NOT NULL,
  reason           VARCHAR(500) NOT NULL,
  status           VARCHAR(16) NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','resolved','dismissed')),
  resolved_by      INT REFERENCES users(id) ON DELETE SET NULL,
  resolution_note  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status, created_at DESC);

CREATE TABLE IF NOT EXISTS bans (
  id           SERIAL PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  moderator_id INT REFERENCES users(id) ON DELETE SET NULL,
  reason       TEXT NOT NULL,
  until        TIMESTAMPTZ,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bans_user ON bans (user_id, active);

-- Журнал применённых миграций
CREATE TABLE IF NOT EXISTS schema_migrations (
  id         SERIAL PRIMARY KEY,
  filename   VARCHAR(255) UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
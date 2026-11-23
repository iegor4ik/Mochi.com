-- ============================================================
-- 005: групповые чаты (чатсы), персоны, роли, подчатсы
-- ============================================================

-- Онлайн-статус
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- ---------- Групповые чаты ----------
CREATE TABLE IF NOT EXISTS gchats (
  id               SERIAL PRIMARY KEY,
  kind             VARCHAR(16) NOT NULL DEFAULT 'public'
                   CHECK (kind IN ('public','request','private')),
  name             VARCHAR(80) NOT NULL,
  photo            TEXT,
  description      JSONB NOT NULL DEFAULT '{"html":"","fonts":[]}'::jsonb,
  desc_bg          JSONB NOT NULL DEFAULT '{"type":"color","color":"#f4f6fc","color2":"#dfe8ff","url":null}'::jsonb,
  theme            JSONB NOT NULL DEFAULT '{}'::jsonb,
  msg_visibility   VARCHAR(16) NOT NULL DEFAULT 'members'
                   CHECK (msg_visibility IN ('members','everyone')),
  owner_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  personas_enabled BOOLEAN NOT NULL DEFAULT false,
  personas_approval BOOLEAN NOT NULL DEFAULT false,
  personas_only    BOOLEAN NOT NULL DEFAULT false,
  private_open     BOOLEAN NOT NULL DEFAULT false,
  tags             TEXT[] NOT NULL DEFAULT '{}',
  topic_id         INT REFERENCES topics(id) ON DELETE SET NULL,
  member_count     INT NOT NULL DEFAULT 0,
  messages_count   INT NOT NULL DEFAULT 0,
  last_message_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gchats_kind ON gchats (kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gchats_owner ON gchats (owner_id);
CREATE INDEX IF NOT EXISTS idx_gchats_tags ON gchats USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_gchats_members_count ON gchats (member_count DESC);

-- ---------- Роли (макс. 5 на чат) ----------
CREATE TABLE IF NOT EXISTS gchat_roles (
  id          SERIAL PRIMARY KEY,
  chat_id     INT NOT NULL REFERENCES gchats(id) ON DELETE CASCADE,
  name        VARCHAR(40) NOT NULL,
  color       VARCHAR(7),
  permissions TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gchat_roles_chat ON gchat_roles (chat_id);

-- ---------- Участники ----------
CREATE TABLE IF NOT EXISTS gchat_members (
  chat_id      INT NOT NULL REFERENCES gchats(id) ON DELETE CASCADE,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         VARCHAR(16) NOT NULL DEFAULT 'member'
               CHECK (role IN ('member','curator')),
  role_id      INT REFERENCES gchat_roles(id) ON DELETE SET NULL,
  muted_until  TIMESTAMPTZ,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_gchat_members_user ON gchat_members (user_id);

-- ---------- Баны и запрет заявок ----------
CREATE TABLE IF NOT EXISTS gchat_bans (
  id         SERIAL PRIMARY KEY,
  chat_id    INT NOT NULL REFERENCES gchats(id) ON DELETE CASCADE,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       VARCHAR(16) NOT NULL DEFAULT 'ban'
             CHECK (kind IN ('ban','requests_block')),
  until      TIMESTAMPTZ,
  reason     TEXT NOT NULL DEFAULT '',
  active     BOOLEAN NOT NULL DEFAULT true,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gchat_bans ON gchat_bans (chat_id, user_id, active);

-- ---------- Заявки на вступление (раз в сутки) ----------
CREATE TABLE IF NOT EXISTS gchat_join_requests (
  id           SERIAL PRIMARY KEY,
  chat_id      INT NOT NULL REFERENCES gchats(id) ON DELETE CASCADE,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       VARCHAR(16) NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','approved','declined')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_by INT REFERENCES users(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_gchat_join_req ON gchat_join_requests (chat_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_gchat_join_req_user ON gchat_join_requests (user_id, status);

-- ---------- Приглашения ----------
CREATE TABLE IF NOT EXISTS gchat_invites (
  id         SERIAL PRIMARY KEY,
  chat_id    INT NOT NULL REFERENCES gchats(id) ON DELETE CASCADE,
  inviter_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     VARCHAR(16) NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending','accepted','declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gchat_invites ON gchat_invites (invitee_id, status);

-- ---------- Персоны ----------
CREATE TABLE IF NOT EXISTS gchat_personas (
  id         SERIAL PRIMARY KEY,
  chat_id    INT NOT NULL REFERENCES gchats(id) ON DELETE CASCADE,
  owner_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       VARCHAR(48) NOT NULL,
  avatar_url TEXT,
  bio        TEXT NOT NULL DEFAULT '',
  visibility VARCHAR(16) NOT NULL DEFAULT 'public'
             CHECK (visibility IN ('public','anonymous')),
  status     VARCHAR(16) NOT NULL DEFAULT 'approved'
             CHECK (status IN ('pending','approved','declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gchat_personas ON gchat_personas (chat_id, owner_id);

-- ---------- Подчатсы (многоуровневые, макс. 5 на чат) ----------
CREATE TABLE IF NOT EXISTS gchat_subchats (
  id         SERIAL PRIMARY KEY,
  chat_id    INT NOT NULL REFERENCES gchats(id) ON DELETE CASCADE,
  name       VARCHAR(80) NOT NULL,
  icon       TEXT,
  position   INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gchat_subchats ON gchat_subchats (chat_id, position);

-- ---------- Игнор пользователей в чатсах ----------
CREATE TABLE IF NOT EXISTS gchat_ignores (
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ignored_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ignored_id)
);

-- ---------- Сообщения ----------
CREATE TABLE IF NOT EXISTS gchat_messages (
  id            SERIAL PRIMARY KEY,
  chat_id       INT NOT NULL REFERENCES gchats(id) ON DELETE CASCADE,
  sender_id     INT REFERENCES users(id) ON DELETE SET NULL,
  persona_id    INT REFERENCES gchat_personas(id) ON DELETE SET NULL,
  subchat_id    INT REFERENCES gchat_subchats(id) ON DELETE CASCADE,
  kind          VARCHAR(10) NOT NULL DEFAULT 'user' CHECK (kind IN ('user','system')),
  content       TEXT NOT NULL DEFAULT '',
  image_url     TEXT,
  reply_to_id   INT REFERENCES gchat_messages(id) ON DELETE SET NULL,
  mentioned_ids INT[] NOT NULL DEFAULT '{}',
  deleted       BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gchat_messages ON gchat_messages (chat_id, created_at);

-- ---------- Закреплённые сообщения ----------
CREATE TABLE IF NOT EXISTS gchat_pins (
  id         SERIAL PRIMARY KEY,
  chat_id    INT NOT NULL REFERENCES gchats(id) ON DELETE CASCADE,
  message_id INT NOT NULL REFERENCES gchat_messages(id) ON DELETE CASCADE,
  pinned     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chat_id, message_id)
);

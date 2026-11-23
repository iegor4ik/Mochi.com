-- ============================================================
-- 004: посты профиля, подписки, приватность личных сообщений
-- ============================================================

-- Политика личных сообщений: все / подписчики / те, на кого подписан
ALTER TABLE users ADD COLUMN IF NOT EXISTS dm_policy VARCHAR(16) NOT NULL DEFAULT 'all'
  CHECK (dm_policy IN ('all','followers','following'));

-- Подписки (фоловеры)
CREATE TABLE IF NOT EXISTS follows (
  follower_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows (follower_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows (following_id);

-- Посты профиля (статьи)
CREATE TABLE IF NOT EXISTS user_posts (
  id          SERIAL PRIMARY KEY,
  author_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL,
  content     JSONB NOT NULL DEFAULT '{"html":"","fonts":[]}'::jsonb,
  cover_image TEXT,
  visibility  VARCHAR(16) NOT NULL DEFAULT 'public'
              CHECK (visibility IN ('public','personal','private')),
  tags        TEXT[] NOT NULL DEFAULT '{}',
  topic_id    INT REFERENCES topics(id) ON DELETE SET NULL,
  views       INT NOT NULL DEFAULT 0,
  deleted     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_posts_author ON user_posts (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_posts_public ON user_posts (created_at DESC)
  WHERE deleted = false AND visibility = 'public';
CREATE INDEX IF NOT EXISTS idx_user_posts_tags ON user_posts USING gin (tags);
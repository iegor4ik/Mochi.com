-- ============================================================
-- M-o-chi game — начальная схема БД ИГРЫ (отдельный Postgres!)
-- Никаких форумных таблиц здесь нет; user_id — логическая ссылка без FK.
-- ============================================================

-- Локации (комнаты-«сервера»): карта хранится во встроенном JSON-формате
CREATE TABLE IF NOT EXISTS locations (
  id         SERIAL PRIMARY KEY,
  slug       VARCHAR(64) UNIQUE NOT NULL,
  name       VARCHAR(100) NOT NULL,
  map        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Объекты мира (ball/box/stone). taken_by — user_id форума БЕЗ FK (базы разные)
CREATE TABLE IF NOT EXISTS world_objects (
  id          SERIAL PRIMARY KEY,
  location_id INT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  def_key     VARCHAR(32) NOT NULL,
  x           REAL NOT NULL DEFAULT 0,
  y           REAL NOT NULL DEFAULT 0,
  vx          REAL NOT NULL DEFAULT 0,
  vy          REAL NOT NULL DEFAULT 0,
  taken_by    INTEGER NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_world_objects_location ON world_objects (location_id);
CREATE INDEX IF NOT EXISTS idx_world_objects_taken ON world_objects (taken_by) WHERE taken_by IS NOT NULL;

-- История игрового чата по локациям
CREATE TABLE IF NOT EXISTS chat_messages (
  id          SERIAL PRIMARY KEY,
  location_id INT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  user_id     INT NOT NULL,
  username    VARCHAR(32) NOT NULL,
  text        VARCHAR(300) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_location ON chat_messages (location_id, created_at DESC);

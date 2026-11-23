-- ============================================================
-- M-o-chi.com — добавить архивирование и игнорирование чатов
-- ============================================================

-- Добавить колонны для архивирования и игнорирования чатов
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS archived_by_user1 BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS archived_by_user2 BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ignored_by_user1 BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ignored_by_user2 BOOLEAN NOT NULL DEFAULT false;

-- Создать индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_conversations_archived_user1 ON conversations (user1_id) WHERE archived_by_user1 = false;
CREATE INDEX IF NOT EXISTS idx_conversations_archived_user2 ON conversations (user2_id) WHERE archived_by_user2 = false;
CREATE INDEX IF NOT EXISTS idx_conversations_ignored_user1 ON conversations (user1_id) WHERE ignored_by_user1 = true;
CREATE INDEX IF NOT EXISTS idx_conversations_ignored_user2 ON conversations (user2_id) WHERE ignored_by_user2 = true;

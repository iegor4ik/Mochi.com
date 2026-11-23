-- ============================================================
-- M-o-chi.com — добавить поддержку редактирования сообщений
-- ============================================================

-- Добавить колонну updated_at для отслеживания последнего редактирования
ALTER TABLE messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Создать индекс для быстрого поиска по времени обновления
CREATE INDEX IF NOT EXISTS idx_messages_updated ON messages (updated_at);

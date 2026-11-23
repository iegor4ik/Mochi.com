-- 002: перетаскиваемые предметы — кто тащит объект (без FK, базы разные)
ALTER TABLE world_objects ADD COLUMN IF NOT EXISTS pulled_by INTEGER NULL;

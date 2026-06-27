-- ============================================================
-- 034_add_block_today_timestamp.sql
--
-- Adds block_today_timestamp to restaurant_config so that 
-- today-blocking can expire on the next day automatically.
-- ============================================================

ALTER TABLE restaurant_config
  ADD COLUMN IF NOT EXISTS block_today_timestamp TIMESTAMPTZ;

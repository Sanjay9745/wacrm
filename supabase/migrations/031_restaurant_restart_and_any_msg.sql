-- ============================================================
-- 031_restaurant_restart_and_any_msg.sql
--
-- Adds start_on_any_message, restart_message, and restart_button_label
-- columns to restaurant_config table.
-- ============================================================

ALTER TABLE restaurant_config
  ADD COLUMN IF NOT EXISTS start_on_any_message BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS restart_message TEXT NOT NULL DEFAULT 'Thank you! Your booking is received. Click below to start over.',
  ADD COLUMN IF NOT EXISTS restart_button_label TEXT NOT NULL DEFAULT 'Restart Session';

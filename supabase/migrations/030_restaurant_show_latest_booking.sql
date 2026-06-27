-- ============================================================
-- 030_restaurant_show_latest_booking.sql
--
-- Adds show_latest_booking column to restaurant_config table.
-- ============================================================

ALTER TABLE restaurant_config
  ADD COLUMN IF NOT EXISTS show_latest_booking BOOLEAN NOT NULL DEFAULT true;

-- ============================================================
-- 033_restaurant_booking_restrictions.sql
--
-- Adds time-window, date-range, buffer, and today-block
-- columns to restaurant_config so admins can restrict when
-- customers can book.
-- ============================================================

ALTER TABLE restaurant_config
  ADD COLUMN IF NOT EXISTS booking_time_from TEXT NOT NULL DEFAULT '11:00 AM',
  ADD COLUMN IF NOT EXISTS booking_time_to TEXT NOT NULL DEFAULT '9:00 PM',
  ADD COLUMN IF NOT EXISTS booking_date_range_days INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS booking_time_buffer_minutes INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS block_today_booking BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS block_today_message TEXT NOT NULL DEFAULT 'Sorry, we are not accepting bookings for today.';

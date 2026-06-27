-- ============================================================
-- 032_restaurant_defaults.sql
--
-- Updates the default confirmation template in restaurant_config
-- and cleans up any existing rows with the old default template.
-- ============================================================

ALTER TABLE restaurant_config
  ALTER COLUMN confirmation_template SET DEFAULT 'Thank you! 🎉

Your booking request has been received.

📅 Date: {{date}}
🕐 Time: {{time}}
👥 Guests: {{guests}}';

UPDATE restaurant_config
SET confirmation_template = 'Thank you! 🎉

Your booking request has been received.

📅 Date: {{date}}
🕐 Time: {{time}}
👥 Guests: {{guests}}'
WHERE confirmation_template = 'Thank you! 🎉

Your booking request has been received.

📅 Date: {{date}}
🕐 Time: {{time}}
👥 Guests: {{guests}}

Our team will contact you shortly.';

-- ============================================================
-- 029_add_buttons_field_type.sql
--
-- Drops the check constraint on field_type column of
-- restaurant_booking_fields and adds the new 'buttons' type.
-- ============================================================

ALTER TABLE restaurant_booking_fields
  DROP CONSTRAINT IF EXISTS restaurant_booking_fields_field_type_check;

ALTER TABLE restaurant_booking_fields
  ADD CONSTRAINT restaurant_booking_fields_field_type_check CHECK (field_type IN (
    'text', 'textarea', 'dropdown', 'single_select',
    'multi_select', 'number', 'phone', 'email',
    'date', 'time', 'checkbox', 'radio', 'buttons'
  ));

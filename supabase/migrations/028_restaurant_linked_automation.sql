-- ============================================================
-- 028_restaurant_linked_automation.sql
--
-- Adds a linked_automation_id column to restaurant_config so the
-- Restaurant module can track which automation it created in the
-- standard automations table. ON DELETE SET NULL ensures the
-- config row survives if the automation is manually deleted.
-- ============================================================

ALTER TABLE restaurant_config
  ADD COLUMN IF NOT EXISTS linked_automation_id UUID
  REFERENCES automations(id) ON DELETE SET NULL;

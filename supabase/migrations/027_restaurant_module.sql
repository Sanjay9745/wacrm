-- ============================================================
-- Restaurant WhatsApp Interactive Booking Module
--
-- Adds 9 tables for a fully dynamic, admin-configurable
-- restaurant booking system via WhatsApp interactive messages.
--
-- All tables use `account_id` tenancy (matching the post-017
-- pattern). RLS policies gate client-side reads; the Flows
-- engine writes via service_role (supabaseAdmin).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. restaurant_config — account-level settings (singleton)
-- ============================================================
CREATE TABLE IF NOT EXISTS restaurant_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  welcome_header TEXT NOT NULL DEFAULT 'Welcome 🍽️',
  welcome_body TEXT NOT NULL DEFAULT 'Welcome to Our Restaurant.\nPlease choose an option.',
  welcome_footer TEXT DEFAULT '',
  welcome_button_label TEXT NOT NULL DEFAULT 'View Options',
  confirmation_template TEXT NOT NULL DEFAULT 'Thank you! 🎉\n\nYour booking request has been received.\n\n📅 Date: {{date}}\n🕐 Time: {{time}}\n👥 Guests: {{guests}}\n\nOur team will contact you shortly.',
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  trigger_keywords JSONB NOT NULL DEFAULT '["book", "reserve", "restaurant", "table"]'::jsonb,
  session_timeout_minutes INTEGER NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_config_account
  ON restaurant_config(account_id);

ALTER TABLE restaurant_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own restaurant config" ON restaurant_config;
CREATE POLICY "Users manage own restaurant config" ON restaurant_config FOR ALL
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.account_id = restaurant_config.account_id
      AND p.user_id = auth.uid()
  ));

-- ============================================================
-- 2. restaurant_menu_items — main interactive menu options
-- ============================================================
CREATE TABLE IF NOT EXISTS restaurant_menu_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  action_type TEXT NOT NULL CHECK (action_type IN (
    'book_table', 'order_online', 'menu', 'faq'
  )),
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_menu_items_account
  ON restaurant_menu_items(account_id, position);

ALTER TABLE restaurant_menu_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own restaurant menu items" ON restaurant_menu_items;
CREATE POLICY "Users manage own restaurant menu items" ON restaurant_menu_items FOR ALL
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.account_id = restaurant_menu_items.account_id
      AND p.user_id = auth.uid()
  ));

-- ============================================================
-- 3. restaurant_booking_fields — dynamic form builder fields
-- ============================================================
CREATE TABLE IF NOT EXISTS restaurant_booking_fields (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_label TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN (
    'text', 'textarea', 'dropdown', 'single_select',
    'multi_select', 'number', 'phone', 'email',
    'date', 'time', 'checkbox', 'radio'
  )),
  options JSONB DEFAULT '[]'::jsonb,
  is_required BOOLEAN NOT NULL DEFAULT false,
  placeholder TEXT DEFAULT '',
  validation_regex TEXT DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_booking_fields_account
  ON restaurant_booking_fields(account_id, position);

ALTER TABLE restaurant_booking_fields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own restaurant booking fields" ON restaurant_booking_fields;
CREATE POLICY "Users manage own restaurant booking fields" ON restaurant_booking_fields FOR ALL
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.account_id = restaurant_booking_fields.account_id
      AND p.user_id = auth.uid()
  ));

-- ============================================================
-- 4. restaurant_bookings — flexible booking storage (JSONB)
-- ============================================================
CREATE TABLE IF NOT EXISTS restaurant_bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'confirmed', 'completed', 'cancelled', 'no_show'
  )),
  booking_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  internal_notes TEXT DEFAULT '',
  assigned_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_bookings_account
  ON restaurant_bookings(account_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_bookings_status
  ON restaurant_bookings(account_id, status);
CREATE INDEX IF NOT EXISTS idx_restaurant_bookings_created
  ON restaurant_bookings(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_restaurant_bookings_contact
  ON restaurant_bookings(contact_id);

ALTER TABLE restaurant_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own restaurant bookings" ON restaurant_bookings;
CREATE POLICY "Users manage own restaurant bookings" ON restaurant_bookings FOR ALL
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.account_id = restaurant_bookings.account_id
      AND p.user_id = auth.uid()
  ));

-- ============================================================
-- 5. restaurant_booking_status_log — audit trail
-- ============================================================
CREATE TABLE IF NOT EXISTS restaurant_booking_status_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES restaurant_bookings(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_booking_status_log_booking
  ON restaurant_booking_status_log(booking_id, created_at DESC);

ALTER TABLE restaurant_booking_status_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own booking status logs" ON restaurant_booking_status_log;
CREATE POLICY "Users view own booking status logs" ON restaurant_booking_status_log FOR ALL
  USING (EXISTS (
    SELECT 1 FROM restaurant_bookings b
    JOIN profiles p ON p.account_id = b.account_id
    WHERE b.id = restaurant_booking_status_log.booking_id
      AND p.user_id = auth.uid()
  ));

-- ============================================================
-- 6. restaurant_delivery_platforms — delivery platform CRUD
-- ============================================================
CREATE TABLE IF NOT EXISTS restaurant_delivery_platforms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  logo_url TEXT DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_delivery_platforms_account
  ON restaurant_delivery_platforms(account_id, position);

ALTER TABLE restaurant_delivery_platforms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own delivery platforms" ON restaurant_delivery_platforms;
CREATE POLICY "Users manage own delivery platforms" ON restaurant_delivery_platforms FOR ALL
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.account_id = restaurant_delivery_platforms.account_id
      AND p.user_id = auth.uid()
  ));

-- ============================================================
-- 7. restaurant_faqs — FAQ CRUD
-- ============================================================
CREATE TABLE IF NOT EXISTS restaurant_faqs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_faqs_account
  ON restaurant_faqs(account_id, position);

ALTER TABLE restaurant_faqs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own restaurant faqs" ON restaurant_faqs;
CREATE POLICY "Users manage own restaurant faqs" ON restaurant_faqs FOR ALL
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.account_id = restaurant_faqs.account_id
      AND p.user_id = auth.uid()
  ));

-- ============================================================
-- 8. restaurant_menu_config — menu display configuration
-- ============================================================
CREATE TABLE IF NOT EXISTS restaurant_menu_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  menu_type TEXT NOT NULL DEFAULT 'website_url' CHECK (menu_type IN (
    'website_url', 'pdf', 'image', 'whatsapp_catalog'
  )),
  menu_value TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id)
);

ALTER TABLE restaurant_menu_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own menu config" ON restaurant_menu_config;
CREATE POLICY "Users manage own menu config" ON restaurant_menu_config FOR ALL
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.account_id = restaurant_menu_config.account_id
      AND p.user_id = auth.uid()
  ));

-- ============================================================
-- 9. restaurant_conversation_state — per-contact flow state
-- ============================================================
CREATE TABLE IF NOT EXISTS restaurant_conversation_state (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  current_step TEXT NOT NULL DEFAULT 'welcome',
  collected_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_field_index INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- At most one active restaurant session per contact per account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_one_active_per_contact
  ON restaurant_conversation_state(account_id, contact_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_restaurant_conv_state_active
  ON restaurant_conversation_state(account_id, is_active)
  WHERE is_active = true;

ALTER TABLE restaurant_conversation_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own restaurant conv state" ON restaurant_conversation_state;
CREATE POLICY "Users view own restaurant conv state" ON restaurant_conversation_state FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.account_id = restaurant_conversation_state.account_id
      AND p.user_id = auth.uid()
  ));

-- ============================================================
-- 10. updated_at triggers
-- ============================================================
-- Reuses update_updated_at_column() from migration 001.
DROP TRIGGER IF EXISTS set_updated_at ON restaurant_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON restaurant_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON restaurant_menu_items;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON restaurant_menu_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON restaurant_booking_fields;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON restaurant_booking_fields
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON restaurant_bookings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON restaurant_bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON restaurant_delivery_platforms;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON restaurant_delivery_platforms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON restaurant_faqs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON restaurant_faqs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON restaurant_menu_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON restaurant_menu_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

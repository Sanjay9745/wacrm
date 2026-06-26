// ============================================================
// Restaurant Module — TypeScript type definitions
//
// Mirrors the Supabase schema in migration 027_restaurant_module.sql.
// Every table maps 1:1 to an interface here so components and API
// routes get full type safety on the DB shapes.
// ============================================================

// ---- Status / field-type unions ----

export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show'

export type BookingFieldType =
  | 'text'
  | 'textarea'
  | 'dropdown'
  | 'single_select'
  | 'multi_select'
  | 'number'
  | 'phone'
  | 'email'
  | 'date'
  | 'time'
  | 'checkbox'
  | 'radio'

export type MenuActionType =
  | 'book_table'
  | 'order_online'
  | 'menu'
  | 'faq'

export type MenuConfigType =
  | 'website_url'
  | 'pdf'
  | 'image'
  | 'whatsapp_catalog'

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No Show',
}

export const BOOKING_STATUS_COLORS: Record<BookingStatus, string> = {
  pending: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  confirmed: 'bg-primary/10 text-primary border-primary/30',
  completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  cancelled: 'bg-red-500/10 text-red-400 border-red-500/30',
  no_show: 'bg-muted text-muted-foreground border-border',
}

export const FIELD_TYPE_LABELS: Record<BookingFieldType, string> = {
  text: 'Text',
  textarea: 'Textarea',
  dropdown: 'Dropdown',
  single_select: 'Single Select',
  multi_select: 'Multi Select',
  number: 'Number',
  phone: 'Phone',
  email: 'Email',
  date: 'Date',
  time: 'Time',
  checkbox: 'Checkbox',
  radio: 'Radio',
}

/**
 * Field types that show WhatsApp interactive list messages with
 * selectable options. Everything else captures free-text replies.
 */
export const INTERACTIVE_FIELD_TYPES: ReadonlySet<BookingFieldType> = new Set([
  'dropdown',
  'single_select',
  'radio',
])

// ---- DB row shapes ----

export interface RestaurantConfig {
  id: string
  account_id: string
  user_id: string
  welcome_header: string
  welcome_body: string
  welcome_footer: string
  welcome_button_label: string
  confirmation_template: string
  is_enabled: boolean
  trigger_keywords: string[]
  session_timeout_minutes: number
  created_at: string
  updated_at: string
}

export interface RestaurantMenuItem {
  id: string
  account_id: string
  title: string
  description: string
  action_type: MenuActionType
  is_enabled: boolean
  position: number
  created_at: string
  updated_at: string
}

export interface RestaurantBookingField {
  id: string
  account_id: string
  field_name: string
  field_label: string
  field_type: BookingFieldType
  options: string[]
  is_required: boolean
  placeholder: string
  validation_regex: string
  position: number
  is_enabled: boolean
  created_at: string
  updated_at: string
}

export interface RestaurantBooking {
  id: string
  account_id: string
  user_id: string
  contact_id: string | null
  phone: string | null
  status: BookingStatus
  booking_json: Record<string, unknown>
  internal_notes: string
  assigned_user_id: string | null
  created_at: string
  updated_at: string
  /** Joined at query time — not always present. */
  contact?: {
    id: string
    name?: string
    phone: string
  }
}

export interface RestaurantBookingStatusLog {
  id: string
  booking_id: string
  old_status: string | null
  new_status: string
  changed_by: string | null
  note: string
  created_at: string
}

export interface RestaurantDeliveryPlatform {
  id: string
  account_id: string
  name: string
  logo_url: string
  url: string
  is_enabled: boolean
  position: number
  created_at: string
  updated_at: string
}

export interface RestaurantFaq {
  id: string
  account_id: string
  question: string
  answer: string
  is_enabled: boolean
  position: number
  created_at: string
  updated_at: string
}

export interface RestaurantMenuConfig {
  id: string
  account_id: string
  menu_type: MenuConfigType
  menu_value: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface RestaurantConversationState {
  id: string
  account_id: string
  contact_id: string
  conversation_id: string | null
  current_step: string
  collected_data: Record<string, unknown>
  current_field_index: number
  created_at: string
  updated_at: string
  is_active: boolean
}

// ---- Dashboard stats ----

export interface RestaurantDashboardStats {
  total: number
  today: number
  tomorrow: number
  cancelled: number
  completed: number
  pending: number
  confirmed: number
  no_show: number
}

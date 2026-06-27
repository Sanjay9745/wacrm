/**
 * Restaurant WhatsApp Interactive Booking Flow Engine.
 *
 * Self-contained state machine that handles the restaurant booking
 * conversation. Invoked by the webhook BEFORE the general-purpose
 * Flows engine — if it consumes the message, the general engine
 * is skipped.
 *
 * State is stored per-contact in `restaurant_conversation_state`.
 * Each inbound message reads the current state, processes it, and
 * writes the next state.
 *
 * Reuses the same Meta send helpers from `@/lib/flows/meta-send`:
 *   - engineSendInteractiveList (for menus, fields, FAQs, platforms)
 *   - engineSendInteractiveButtons (for welcome button)
 *   - engineSendText (for prompts, confirmations)
 */

import { supabaseAdmin } from '@/lib/flows/admin-client'
import {
  engineSendInteractiveButtons,
  engineSendInteractiveList,
  engineSendMedia,
  engineSendText,
} from '@/lib/flows/meta-send'
import type { ParsedInbound } from '@/lib/flows/types'
import type {
  RestaurantBookingField,
  RestaurantConfig,
  RestaurantConversationState,
  RestaurantDeliveryPlatform,
  RestaurantFaq,
  RestaurantMenuConfig,
  RestaurantMenuItem,
} from '@/types/restaurant'
import { INTERACTIVE_FIELD_TYPES } from '@/types/restaurant'

// ============================================================
// Public entry point — webhook calls this on every inbound.
// ============================================================

export interface RestaurantDispatchInput {
  accountId: string
  userId: string
  contactId: string
  conversationId: string
  message: ParsedInbound
}

export interface RestaurantDispatchResult {
  consumed: boolean
}

export async function dispatchInboundToRestaurant(
  input: RestaurantDispatchInput,
): Promise<RestaurantDispatchResult> {
  const db = supabaseAdmin()

  try {
    // 1. Check if the restaurant module is enabled for this account.
    const config = await loadConfig(db, input.accountId)
    if (!config?.is_enabled) {
      return { consumed: false }
    }

    // 2. Check for an active session for this contact.
    const session = await loadActiveSession(db, input.accountId, input.contactId)

    if (session) {
      // Check session timeout
      const timeoutMs = (config.session_timeout_minutes ?? 30) * 60 * 1000
      const lastActivity = new Date(session.last_activity_at).getTime()
      if (Date.now() - lastActivity > timeoutMs) {
        // Session expired — deactivate it
        await deactivateSession(db, session.id)
        // Fall through to trigger check below
      } else {
        // Active session — process the reply
        await handleReply(db, config, session, input)
        return { consumed: true }
      }
    }

    // Check if the message is a restaurant button click.
    if (input.message.kind === 'interactive_reply' && input.message.reply_id.startsWith('restaurant_')) {
      const replyId = input.message.reply_id
      const newSession = await createSession(db, input)

      if (replyId === 'restaurant_welcome_book_table' || replyId === 'restaurant_menu_book_table') {
        await startBookingFlow(db, input, newSession)
      } else if (replyId === 'restaurant_welcome_view_options' || replyId === 'restaurant_view_options') {
        await sendMainMenu(db, input, newSession)
      } else if (replyId === 'restaurant_restart_session') {
        await sendWelcome(db, config, input, newSession)
      } else {
        // Old or expired button click from a past flow
        await engineSendText({
          accountId: input.accountId,
          userId: input.userId,
          conversationId: input.conversationId,
          contactId: input.contactId,
          text: '🔄 Your previous session has expired. Starting a new session for you...',
        })
        await sendWelcome(db, config, input, newSession)
      }
      return { consumed: true }
    }

    // 3. No active session — check if message matches a trigger keyword.
    if (input.message.kind !== 'text') {
      return { consumed: false }
    }

    const keywords: string[] = Array.isArray(config.trigger_keywords)
      ? config.trigger_keywords
      : []

    const text = cleanWhatsAppFormatting(input.message.text).toLowerCase()

    // Check if we should match any incoming message
    const matchAny = config.start_on_any_message || keywords.length === 0 || keywords.includes('*')

    let matches = false
    if (matchAny) {
      matches = true
    } else {
      matches = keywords.some((kw) => {
        let cleanedKw = kw.toLowerCase().trim()
        let isExact = false
        if (cleanedKw.startsWith('=')) {
          isExact = true
          cleanedKw = cleanedKw.slice(1).trim()
        }
        cleanedKw = cleanWhatsAppFormatting(cleanedKw)
        if (isExact) {
          return text === cleanedKw
        }
        return text.includes(cleanedKw)
      })
    }

    if (!matches) {
      return { consumed: false }
    }

    // 4. Start a new session and send the welcome message.
    const newSession = await createSession(db, input)
    await sendWelcome(db, config, input, newSession)
    return { consumed: true }
  } catch (err) {
    console.error(
      '[restaurant] dispatchInboundToRestaurant error:',
      err instanceof Error ? err.message : err,
    )
    return { consumed: false }
  }
}

// ============================================================
// DB helpers
// ============================================================

type AdminClient = ReturnType<typeof supabaseAdmin>

async function loadConfig(
  db: AdminClient,
  accountId: string,
): Promise<RestaurantConfig | null> {
  const { data, error } = await db
    .from('restaurant_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) {
    console.error('[restaurant] loadConfig error:', error.message)
    return null
  }
  return data as RestaurantConfig | null
}

async function loadActiveSession(
  db: AdminClient,
  accountId: string,
  contactId: string,
): Promise<RestaurantConversationState | null> {
  const { data, error } = await db
    .from('restaurant_conversation_state')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('is_active', true)
    .limit(1)
  if (error) {
    console.error('[restaurant] loadActiveSession error:', error.message)
    return null
  }
  const rows = (data ?? []) as RestaurantConversationState[]
  return rows[0] ?? null
}

async function deactivateSession(
  db: AdminClient,
  sessionId: string,
): Promise<void> {
  await db
    .from('restaurant_conversation_state')
    .update({ is_active: false })
    .eq('id', sessionId)
}

async function createSession(
  db: AdminClient,
  input: RestaurantDispatchInput,
): Promise<RestaurantConversationState> {
  const { data, error } = await db
    .from('restaurant_conversation_state')
    .insert({
      account_id: input.accountId,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      current_step: 'welcome',
      collected_data: {},
      current_field_index: 0,
      is_active: true,
    })
    .select()
    .single()
  if (error) {
    // Might be a unique constraint violation — another session active
    if (error.code === '23505') {
      // Load and return the existing one
      const existing = await loadActiveSession(db, input.accountId, input.contactId)
      if (existing) return existing
    }
    throw new Error(`createSession failed: ${error.message}`)
  }
  return data as RestaurantConversationState
}

async function updateSession(
  db: AdminClient,
  sessionId: string,
  updates: Partial<Pick<
    RestaurantConversationState,
    'current_step' | 'collected_data' | 'current_field_index' | 'is_active'
  >>,
): Promise<void> {
  await db
    .from('restaurant_conversation_state')
    .update({
      ...updates,
      last_activity_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
}

async function loadMenuItems(
  db: AdminClient,
  accountId: string,
): Promise<RestaurantMenuItem[]> {
  const { data } = await db
    .from('restaurant_menu_items')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_enabled', true)
    .order('position', { ascending: true })
  return (data ?? []) as RestaurantMenuItem[]
}

async function loadBookingFields(
  db: AdminClient,
  accountId: string,
): Promise<RestaurantBookingField[]> {
  const { data } = await db
    .from('restaurant_booking_fields')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_enabled', true)
    .order('position', { ascending: true })
  return (data ?? []) as RestaurantBookingField[]
}

async function loadDeliveryPlatforms(
  db: AdminClient,
  accountId: string,
): Promise<RestaurantDeliveryPlatform[]> {
  const { data } = await db
    .from('restaurant_delivery_platforms')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_enabled', true)
    .order('position', { ascending: true })
  return (data ?? []) as RestaurantDeliveryPlatform[]
}

async function loadFaqs(
  db: AdminClient,
  accountId: string,
): Promise<RestaurantFaq[]> {
  const { data } = await db
    .from('restaurant_faqs')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_enabled', true)
    .order('position', { ascending: true })
  return (data ?? []) as RestaurantFaq[]
}

async function loadMenuConfig(
  db: AdminClient,
  accountId: string,
): Promise<RestaurantMenuConfig | null> {
  const { data } = await db
    .from('restaurant_menu_config')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .maybeSingle()
  return data as RestaurantMenuConfig | null
}

// ============================================================
// Message sending helpers
// ============================================================

async function sendWelcome(
  db: AdminClient,
  config: RestaurantConfig,
  input: RestaurantDispatchInput,
  session: RestaurantConversationState,
): Promise<void> {
  const menuItems = await loadMenuItems(db, input.accountId)
  const isBookTableEnabled = menuItems.some(item => item.action_type === 'book_table')

  const buttons = []
  if (isBookTableEnabled) {
    buttons.push({
      id: 'restaurant_welcome_book_table',
      title: 'Book A Table',
    })
  }

  if (config.show_latest_booking !== false) {
    buttons.push({
      id: 'restaurant_welcome_latest_booking',
      title: 'Latest Booking',
    })
  }

  buttons.push({
    id: 'restaurant_welcome_view_options',
    title: (config.welcome_button_label || 'View Options').slice(0, 20),
  })

  await engineSendInteractiveButtons({
    accountId: input.accountId,
    userId: input.userId,
    conversationId: input.conversationId,
    contactId: input.contactId,
    bodyText: `*${config.welcome_header}*\n\n${config.welcome_body}`,
    footerText: config.welcome_footer || undefined,
    buttons,
  })
  await updateSession(db, session.id, { current_step: 'awaiting_welcome_tap' })
}

async function startBookingFlow(
  db: AdminClient,
  input: RestaurantDispatchInput,
  session: RestaurantConversationState,
): Promise<void> {
  const menuItems = await loadMenuItems(db, input.accountId)
  const isBookTableEnabled = menuItems.some(item => item.action_type === 'book_table')

  if (!isBookTableEnabled) {
    await engineSendText({
      accountId: input.accountId,
      userId: input.userId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      text: 'Sorry, table booking is currently unavailable. Please choose another option.',
    })
    await sendMainMenu(db, input, session)
    return
  }

  const fields = await loadBookingFields(db, input.accountId)
  if (fields.length === 0) {
    await engineSendText({
      accountId: input.accountId,
      userId: input.userId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      text: 'Table booking is not configured yet. Please try again later.',
    })
    await deactivateSession(db, session.id)
    return
  }

  // Check if dates are completely blocked (e.g., today is blocked and no future dates are bookable)
  const dateField = fields.find(f => f.field_type === 'date')
  if (dateField) {
    const bookingConfig = await loadConfig(db, input.accountId)
    const rangeDays = bookingConfig?.booking_date_range_days ?? 30
    const blockToday = bookingConfig ? isBlockTodayActive(bookingConfig) : false

    // Generate dates to see if any are available
    const dates: string[] = []
    const limitDays = Math.min(rangeDays, 2)
    const istParts = getISTDateParts(new Date())
    for (let i = 0; i < limitDays; i++) {
      const d = new Date(istParts.year, istParts.month, istParts.day)
      d.setDate(d.getDate() + i)
      if (i === 0) {
        if (!blockToday) {
          const timeFrom = bookingConfig?.booking_time_from || '11:00 AM'
          const timeTo = bookingConfig?.booking_time_to || '9:00 PM'
          const bufferMinutes = bookingConfig?.booking_time_buffer_minutes ?? 60
          const slots = generateTimeSlots(timeFrom, timeTo, 30)
          const cutoff = getISTCurrentTimeInMinutes() + bufferMinutes
          const availableSlots = slots.filter(s => {
            const mins = parseTimeToMinutes(s)
            return mins !== null && mins >= cutoff
          })
          if (availableSlots.length > 0) {
            dates.push('Today')
          }
        }
      } else if (i === 1) dates.push('Tomorrow')
    }

    if (dates.length === 0) {
      await engineSendText({
        accountId: input.accountId,
        userId: input.userId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        text: bookingConfig?.block_today_message || 'Sorry, we are not accepting bookings for today.',
      })
      await deactivateSession(db, session.id)
      return
    }
  }

  await sendBookingField(db, input, session, fields, 0)
}

async function sendMainMenu(
  db: AdminClient,
  input: RestaurantDispatchInput,
  session: RestaurantConversationState,
): Promise<void> {
  const items = await loadMenuItems(db, input.accountId)
  if (items.length === 0) {
    await engineSendText({
      accountId: input.accountId,
      userId: input.userId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      text: 'Sorry, no options are currently available. Please try again later.',
    })
    await deactivateSession(db, session.id)
    return
  }

  const rows = items.map((item) => ({
    id: `restaurant_menu_${item.action_type}`,
    title: item.title.slice(0, 24),
    description: item.description ? item.description.slice(0, 72) : undefined,
  }))

  const config = await loadConfig(db, input.accountId)
  if (!config || config.show_latest_booking !== false) {
    rows.push({
      id: 'restaurant_menu_latest_booking',
      title: 'Latest Booking',
      description: 'View your latest booking details',
    })
  }

  await engineSendInteractiveList({
    accountId: input.accountId,
    userId: input.userId,
    conversationId: input.conversationId,
    contactId: input.contactId,
    bodyText: 'Please choose an option from the menu below:',
    buttonLabel: 'Our Services',
    sections: [
      {
        title: 'Choose an option',
        rows,
      },
    ],
  })
  await updateSession(db, session.id, { current_step: 'awaiting_menu_selection' })
}

async function sendBookingField(
  db: AdminClient,
  input: RestaurantDispatchInput,
  session: RestaurantConversationState,
  fields: RestaurantBookingField[],
  fieldIndex: number,
): Promise<void> {
  if (fieldIndex >= fields.length) {
    // All fields collected — send confirmation
    await sendConfirmation(db, input, session)
    return
  }

  const field = fields[fieldIndex]

  if (field.field_type === 'date') {
    // Load config for date range and today-block settings
    const bookingConfig = await loadConfig(db, input.accountId)
    const rangeDays = bookingConfig?.booking_date_range_days ?? 30
    const blockToday = bookingConfig ? isBlockTodayActive(bookingConfig) : false

    // Generate dates within the configured range (only today and tomorrow)
    const dates: string[] = []
    const limitDays = Math.min(rangeDays, 2)
    const istParts = getISTDateParts(new Date())
    for (let i = 0; i < limitDays; i++) {
      const d = new Date(istParts.year, istParts.month, istParts.day)
      d.setDate(d.getDate() + i)
      if (i === 0) {
        if (!blockToday) {
          const timeFrom = bookingConfig?.booking_time_from || '11:00 AM'
          const timeTo = bookingConfig?.booking_time_to || '9:00 PM'
          const bufferMinutes = bookingConfig?.booking_time_buffer_minutes ?? 60
          const slots = generateTimeSlots(timeFrom, timeTo, 30)
          const cutoff = getISTCurrentTimeInMinutes() + bufferMinutes
          const availableSlots = slots.filter(s => {
            const mins = parseTimeToMinutes(s)
            return mins !== null && mins >= cutoff
          })
          if (availableSlots.length > 0) {
            dates.push('Today')
          }
        }
      } else if (i === 1) dates.push('Tomorrow')
    }

    // If today is blocked and no dates remain, show the block message
    if (dates.length === 0) {
      await engineSendText({
        accountId: input.accountId,
        userId: input.userId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        text: bookingConfig?.block_today_message || 'Sorry, we are not accepting bookings for today.',
      })
      await deactivateSession(db, session.id)
      return
    }

    const rows = [
      {
        id: `restaurant_field_${field.field_name}_custom`,
        title: 'Type custom date',
      },
      // WhatsApp allows max 10 rows total — cap dates at 9 so custom fits
      ...dates.slice(0, 9).map((opt, i) => ({
        id: `restaurant_field_${field.field_name}_${i}`,
        title: opt.slice(0, 24),
      })),
    ]

    await engineSendInteractiveList({
      accountId: input.accountId,
      userId: input.userId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      bodyText: `Please select your ${field.field_label}:`,
      buttonLabel: 'Choose Date',
      sections: [{ title: 'Available Dates', rows }],
    })
  } else if (field.field_type === 'time') {
    // Load config for time window, buffer, and today-block
    const bookingConfig = await loadConfig(db, input.accountId)
    const timeFrom = bookingConfig?.booking_time_from || '11:00 AM'
    const timeTo = bookingConfig?.booking_time_to || '9:00 PM'
    const bufferMinutes = bookingConfig?.booking_time_buffer_minutes ?? 60
    const blockToday = bookingConfig ? isBlockTodayActive(bookingConfig) : false

    // Generate all time slots in the configured window
    let slots = generateTimeSlots(timeFrom, timeTo, 30)

    // If the selected date is today, filter out slots before now + buffer
    const selectedDate = getCollectedDate(session.collected_data as Record<string, unknown>, fields)
    if (selectedDate && isSelectedToday(selectedDate) && !blockToday) {
      const cutoff = getISTCurrentTimeInMinutes() + bufferMinutes
      slots = slots.filter(s => {
        const mins = parseTimeToMinutes(s)
        return mins !== null && mins >= cutoff
      })

      if (slots.length === 0) {
        await engineSendText({
          accountId: input.accountId,
          userId: input.userId,
          conversationId: input.conversationId,
          contactId: input.contactId,
          text: 'Today\'s booking time is over. Please try tomorrow.',
        })

        // Go back to date selection
        const dateFieldIndex = fields.findIndex(f => f.field_type === 'date')
        if (dateFieldIndex !== -1) {
          const dateField = fields[dateFieldIndex]
          const updatedData = { ...(session.collected_data as Record<string, unknown>) }
          delete updatedData[dateField.field_name]

          const updatedSession = {
            ...session,
            collected_data: updatedData,
            current_field_index: dateFieldIndex,
          }
          await updateSession(db, session.id, {
            collected_data: updatedData,
            current_field_index: dateFieldIndex,
          })
          await sendBookingField(db, input, updatedSession, fields, dateFieldIndex)
        } else {
          await deactivateSession(db, session.id)
        }
        return
      }
    }

    // Build rows from available slots (max 9 so custom option fits within WhatsApp's 10-row limit)
    const allRows = slots.slice(0, 9).map((opt, i) => ({
      id: `restaurant_field_${field.field_name}_${i}`,
      title: opt.slice(0, 24),
    }))

    // Always offer a custom option
    allRows.push({
      id: `restaurant_field_${field.field_name}_custom`,
      title: 'Type custom time',
    })

    await engineSendInteractiveList({
      accountId: input.accountId,
      userId: input.userId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      bodyText: `Please select your ${field.field_label}:`,
      buttonLabel: 'Choose Time',
      sections: [{ title: 'Available Times', rows: allRows }],
    })
  } else if (field.field_type === 'buttons') {
    const options: string[] = Array.isArray(field.options) ? field.options : []
    if (options.length === 0) {
      await engineSendText({
        accountId: input.accountId,
        userId: input.userId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        text: `Please enter your ${field.field_label}:`,
      })
    } else {
      const buttons = options.slice(0, 3).map((opt, i) => ({
        id: `restaurant_field_${field.field_name}_${i}`,
        title: (typeof opt === 'string' ? opt : String(opt)).slice(0, 20),
      }))

      await engineSendInteractiveButtons({
        accountId: input.accountId,
        userId: input.userId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        bodyText: `Please select your ${field.field_label}:`,
        buttons,
      })
    }
  } else if (INTERACTIVE_FIELD_TYPES.has(field.field_type)) {
    const options: string[] = Array.isArray(field.options) ? field.options : []
    if (options.length === 0) {
      await engineSendText({
        accountId: input.accountId,
        userId: input.userId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        text: `Please enter your ${field.field_label}:`,
      })
    } else if (options.length <= 3) {
      // Send as buttons
      const buttons = options.slice(0, 3).map((opt, i) => ({
        id: `restaurant_field_${field.field_name}_${i}`,
        title: (typeof opt === 'string' ? opt : String(opt)).slice(0, 20),
      }))

      await engineSendInteractiveButtons({
        accountId: input.accountId,
        userId: input.userId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        bodyText: `Please select your ${field.field_label}:`,
        buttons,
      })
    } else {
      const rows = options.slice(0, 10).map((opt, i) => ({
        id: `restaurant_field_${field.field_name}_${i}`,
        title: typeof opt === 'string' ? opt.slice(0, 24) : String(opt).slice(0, 24),
      }))

      await engineSendInteractiveList({
        accountId: input.accountId,
        userId: input.userId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        bodyText: `Please select your ${field.field_label}:`,
        buttonLabel: `Choose ${field.field_label}`.slice(0, 20),
        sections: [{ title: field.field_label.slice(0, 24), rows }],
      })
    }
  } else {
    // Free-text prompt
    const placeholder = field.placeholder ? ` (${field.placeholder})` : ''
    const required = field.is_required ? ' *' : ''
    await engineSendText({
      accountId: input.accountId,
      userId: input.userId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      text: `Please enter your ${field.field_label}${required}${placeholder}:`,
    })
  }

  await updateSession(db, session.id, {
    current_step: `booking_field_${fieldIndex}`,
    current_field_index: fieldIndex,
  })
}

async function sendConfirmation(
  db: AdminClient,
  input: RestaurantDispatchInput,
  session: RestaurantConversationState,
): Promise<void> {
  const config = await loadConfig(db, input.accountId)
  if (!config) return

  // Upgrade template to WhatsApp markdown formatting dynamically
  let template = config.confirmation_template || 'Your booking has been received.'
  template = template
    .replace('Thank you! 🎉', '*Thank you!* 🎉')
    .replace('📅 Date:', '📅 *Date:*')
    .replace('🕐 Time:', '🕐 *Time:*')
    .replace('👥 Guests:', '👥 *Guests:*')

  // Interpolate collected data into the confirmation template
  const data = session.collected_data as Record<string, string>
  const text = template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const k = key.toLowerCase().trim()
    if (k === 'date' || k === 'booking_date') {
      return data['booking_date'] ?? data['date'] ?? ''
    }
    if (k === 'time' || k === 'booking_time') {
      return data['booking_time'] ?? data['time'] ?? ''
    }
    if (k === 'guests' || k === 'guests_count' || k === 'guest_count') {
      return data['guests_count'] ?? data['guests'] ?? data['guest_count'] ?? ''
    }
    return data[key] ?? ''
  })

  // Get contact phone
  const { data: contact } = await db
    .from('contacts')
    .select('phone')
    .eq('id', input.contactId)
    .maybeSingle()

  // Create the booking
  await db.from('restaurant_bookings').insert({
    account_id: input.accountId,
    user_id: input.userId,
    contact_id: input.contactId,
    phone: (contact as { phone?: string } | null)?.phone ?? null,
    status: 'pending',
    booking_json: session.collected_data,
  })

  await engineSendText({
    accountId: input.accountId,
    userId: input.userId,
    conversationId: input.conversationId,
    contactId: input.contactId,
    text,
  })

  // Send restart session option buttons
  await engineSendInteractiveButtons({
    accountId: input.accountId,
    userId: input.userId,
    conversationId: input.conversationId,
    contactId: input.contactId,
    bodyText: config.restart_message || 'Thank you! Your booking is received. Click below to start over.',
    buttons: [
      {
        id: 'restaurant_restart_session',
        title: (config.restart_button_label || 'Restart Session').slice(0, 20),
      },
    ],
  })


  await deactivateSession(db, session.id)
}

async function sendDeliveryPlatforms(
  db: AdminClient,
  input: RestaurantDispatchInput,
  session: RestaurantConversationState,
): Promise<void> {
  const platforms = await loadDeliveryPlatforms(db, input.accountId)
  if (platforms.length === 0) {
    await engineSendText({
      accountId: input.accountId,
      userId: input.userId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      text: 'Sorry, online ordering is not available at the moment.',
    })
    // Go back to main menu
    await sendMainMenu(db, input, session)
    return
  }

  await engineSendInteractiveList({
    accountId: input.accountId,
    userId: input.userId,
    conversationId: input.conversationId,
    contactId: input.contactId,
    bodyText: 'Choose your preferred delivery platform to order online:',
    buttonLabel: 'Order Platforms',
    sections: [
      {
        title: 'Delivery Platforms',
        rows: platforms.map((p) => ({
          id: `restaurant_delivery_${p.id}`,
          title: p.name.slice(0, 24),
          description: p.url ? 'Tap to get link'.slice(0, 72) : undefined,
        })),
      },
    ],
  })
  await updateSession(db, session.id, { current_step: 'awaiting_delivery_selection' })
}

async function sendFaqList(
  db: AdminClient,
  input: RestaurantDispatchInput,
  session: RestaurantConversationState,
): Promise<void> {
  const faqs = await loadFaqs(db, input.accountId)
  if (faqs.length === 0) {
    await engineSendText({
      accountId: input.accountId,
      userId: input.userId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      text: 'No FAQs are available at the moment.',
    })
    await sendMainMenu(db, input, session)
    return
  }

  await engineSendInteractiveList({
    accountId: input.accountId,
    userId: input.userId,
    conversationId: input.conversationId,
    contactId: input.contactId,
    bodyText: 'What would you like to know?',
    buttonLabel: 'View Questions',
    sections: [
      {
        title: 'Common Questions',
        rows: faqs.slice(0, 10).map((faq) => ({
          id: `restaurant_faq_${faq.id}`,
          title: faq.question.slice(0, 24),
          description: faq.question.length > 24 ? faq.question.slice(0, 72) : undefined,
        })),
      },
    ],
  })
  await updateSession(db, session.id, { current_step: 'awaiting_faq_selection' })
}

async function sendMenu(
  db: AdminClient,
  input: RestaurantDispatchInput,
  session: RestaurantConversationState,
): Promise<void> {
  const menuConfig = await loadMenuConfig(db, input.accountId)
  if (!menuConfig || !menuConfig.menu_value) {
    await engineSendText({
      accountId: input.accountId,
      userId: input.userId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      text: 'Our menu is not available online at the moment. Please visit us to see our full menu!',
    })
  } else if (menuConfig.menu_type === 'image') {
    await engineSendMedia({
      accountId: input.accountId,
      userId: input.userId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      kind: 'image',
      link: menuConfig.menu_value,
      caption: 'Our Menu',
    })
  } else if (menuConfig.menu_type === 'pdf') {
    await engineSendMedia({
      accountId: input.accountId,
      userId: input.userId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      kind: 'document',
      link: menuConfig.menu_value,
      filename: 'Menu.pdf',
      caption: 'Our Menu',
    })
  } else {
    const typeLabels: Record<string, string> = {
      website_url: '🔗 View our menu here',
      whatsapp_catalog: '📋 Browse our catalog',
    }
    const label = typeLabels[menuConfig.menu_type] ?? 'View our menu'
    await engineSendText({
      accountId: input.accountId,
      userId: input.userId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      text: `${label}:\n${menuConfig.menu_value}`,
    })
  }

  // Go back to main menu
  await sendMainMenu(db, input, session)
}

// ============================================================
// Reply handler — dispatches based on current_step
// ============================================================

async function handleReply(
  db: AdminClient,
  config: RestaurantConfig,
  session: RestaurantConversationState,
  input: RestaurantDispatchInput,
): Promise<void> {
  const { message } = input
  const step = session.current_step

  // Update activity timestamp
  await db
    .from('restaurant_conversation_state')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', session.id)

  // If it's an interactive reply, validate that it belongs to the current step
  if (message.kind === 'interactive_reply') {
    const replyId = message.reply_id || ''
    let isValid = false

    if (step === 'awaiting_welcome_tap') {
      isValid = [
        'restaurant_welcome_book_table',
        'restaurant_welcome_view_options',
        'restaurant_view_options',
        'restaurant_welcome_latest_booking'
      ].includes(replyId)
    } else if (step === 'awaiting_menu_selection') {
      isValid = [
        'restaurant_menu_book_table',
        'restaurant_menu_order_online',
        'restaurant_menu_menu',
        'restaurant_menu_faq',
        'restaurant_menu_latest_booking'
      ].includes(replyId)
    } else if (step.startsWith('booking_field_')) {
      const fields = await loadBookingFields(db, input.accountId)
      const fieldIndex = session.current_field_index
      const field = fields[fieldIndex]
      if (field) {
        isValid = replyId.startsWith(`restaurant_field_${field.field_name}_`)
      }
    } else if (step === 'awaiting_delivery_selection') {
      isValid = replyId.startsWith('restaurant_delivery_')
    } else if (step === 'awaiting_faq_selection') {
      isValid = replyId.startsWith('restaurant_faq_')
    }

    if (!isValid) {
      // It's a click on a previous/old button!
      await engineSendText({
        accountId: input.accountId,
        userId: input.userId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        text: '⚠️ This option is no longer active. Please respond to the current step.',
      })
      // Re-prompt the user for the current step to help them get back on track
      if (step === 'awaiting_welcome_tap') {
        await sendWelcome(db, config, input, session)
      } else if (step === 'awaiting_menu_selection') {
        await sendMainMenu(db, input, session)
      } else if (step.startsWith('booking_field_')) {
        const fields = await loadBookingFields(db, input.accountId)
        const fieldIndex = session.current_field_index
        await sendBookingField(db, input, session, fields, fieldIndex)
      } else if (step === 'awaiting_delivery_selection') {
        await sendDeliveryPlatforms(db, input, session)
      } else if (step === 'awaiting_faq_selection') {
        await sendFaqList(db, input, session)
      }
      return
    }
  }

  // ---- Welcome tap ----
  if (step === 'awaiting_welcome_tap') {
    if (message.kind === 'interactive_reply') {
      if (message.reply_id === 'restaurant_welcome_book_table') {
        await startBookingFlow(db, input, session)
        return
      }
      if (
        message.reply_id === 'restaurant_welcome_view_options' ||
        message.reply_id === 'restaurant_view_options'
      ) {
        await sendMainMenu(db, input, session)
        return
      }
      if (message.reply_id === 'restaurant_welcome_latest_booking') {
        await sendLatestBooking(db, input, session)
        return
      }
    }
    // Invalid reply — re-send welcome
    await sendWelcome(db, config, input, session)
    return
  }

  // ---- Main menu selection ----
  if (step === 'awaiting_menu_selection') {
    if (message.kind !== 'interactive_reply') {
      // Re-send menu
      await sendMainMenu(db, input, session)
      return
    }

    const replyId = message.reply_id
    if (replyId === 'restaurant_menu_book_table') {
      await startBookingFlow(db, input, session)
      return
    }
    if (replyId === 'restaurant_menu_order_online') {
      await sendDeliveryPlatforms(db, input, session)
      return
    }
    if (replyId === 'restaurant_menu_menu') {
      await sendMenu(db, input, session)
      return
    }
    if (replyId === 'restaurant_menu_faq') {
      await sendFaqList(db, input, session)
      return
    }
    if (replyId === 'restaurant_menu_latest_booking') {
      await sendLatestBooking(db, input, session)
      return
    }

    // Unknown menu selection — re-send
    await sendMainMenu(db, input, session)
    return
  }

  // ---- Booking field collection ----
  if (step.startsWith('booking_field_')) {
    const fields = await loadBookingFields(db, input.accountId)
    const fieldIndex = session.current_field_index
    const field = fields[fieldIndex]

    if (!field) {
      // Field no longer exists — send confirmation with what we have
      await sendConfirmation(db, input, session)
      return
    }

    // Extract the answer
    let answer: string | null = null

    if (field.field_type === 'date') {
      if (message.kind === 'interactive_reply') {
        const replyId = message.reply_id
        if (replyId === `restaurant_field_${field.field_name}_custom`) {
          await engineSendText({
            accountId: input.accountId,
            userId: input.userId,
            conversationId: input.conversationId,
            contactId: input.contactId,
            text: `Please type your booking date:`,
          })
          await engineSendText({
            accountId: input.accountId,
            userId: input.userId,
            conversationId: input.conversationId,
            contactId: input.contactId,
            text: `Format: *DD/MM/YYYY* (e.g. *26/06/2026* or *"tomorrow"*)`,
          })
          return
        }

        const prefix = `restaurant_field_${field.field_name}_`
        if (replyId.startsWith(prefix)) {
          const idx = parseInt(replyId.slice(prefix.length), 10)
          // Must match the exact date list generated by sendBookingField
          const rangeDays = config.booking_date_range_days || 30
          const blockToday = isBlockTodayActive(config)
          const options: string[] = []
          const limitDays = Math.min(rangeDays, 2)
          const istParts = getISTDateParts(new Date())
          for (let i = 0; i < limitDays; i++) {
            const d = new Date(istParts.year, istParts.month, istParts.day)
            d.setDate(d.getDate() + i)
            if (i === 0) {
              if (!blockToday) {
                const timeFrom = config.booking_time_from || '11:00 AM'
                const timeTo = config.booking_time_to || '9:00 PM'
                const bufferMinutes = config.booking_time_buffer_minutes ?? 60
                const slots = generateTimeSlots(timeFrom, timeTo, 30)
                const cutoff = getISTCurrentTimeInMinutes() + bufferMinutes
                const availableSlots = slots.filter(s => {
                  const mins = parseTimeToMinutes(s)
                  return mins !== null && mins >= cutoff
                })
                if (availableSlots.length > 0) {
                  options.push('Today')
                }
              }
            } else if (i === 1) options.push('Tomorrow')
          }
          answer = options[idx] ?? message.reply_title
        } else {
          answer = message.reply_title
        }
      } else if (message.kind === 'text') {
        answer = cleanWhatsAppFormatting(message.text)
        if (!isValidDate(answer)) {
          await engineSendText({
            accountId: input.accountId,
            userId: input.userId,
            conversationId: input.conversationId,
            contactId: input.contactId,
            text: `❌ Invalid date format. Please enter a valid date (e.g. *26/06/2026* or *"tomorrow"*):`,
          })
          return
        }
      }

      // Validate booking restrictions for the selected date
      if (answer) {
        const dateStr = answer.trim()

        // Check if today is blocked
        if (isBlockTodayActive(config) && isSelectedToday(dateStr)) {
          await engineSendText({
            accountId: input.accountId,
            userId: input.userId,
            conversationId: input.conversationId,
            contactId: input.contactId,
            text: config.block_today_message || 'Sorry, we are not accepting bookings for today.',
          })
          // Blocked today — deactivate session so they start fresh
          await deactivateSession(db, session.id)
          return
        }

        // Check if the date is within the configured range
        const parsedDate = parseDateString(dateStr)
        if (parsedDate) {
          const now = new Date()
          const maxDays = config.booking_date_range_days ?? 30
          const maxDate = new Date(now)
          maxDate.setDate(maxDate.getDate() + maxDays)

          // Normalize to start of day for comparison
          const normDate = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate())
          const normNow = new Date(now.getFullYear(), now.getMonth(), now.getDate())
          const normMax = new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate())

          if (normDate < normNow) {
            await engineSendText({
              accountId: input.accountId,
              userId: input.userId,
              conversationId: input.conversationId,
              contactId: input.contactId,
              text: `❌ This date has already passed. Please select a future date:`,
            })
            return
          }

          if (normDate > normMax) {
            await engineSendText({
              accountId: input.accountId,
              userId: input.userId,
              conversationId: input.conversationId,
              contactId: input.contactId,
              text: `❌ We only accept bookings up to ${maxDays} days ahead. Please select an earlier date:`,
            })
            return
          }
        }
      }
    } else if (field.field_type === 'time') {
      if (message.kind === 'interactive_reply') {
        const replyId = message.reply_id
        if (replyId === `restaurant_field_${field.field_name}_custom`) {
          await engineSendText({
            accountId: input.accountId,
            userId: input.userId,
            conversationId: input.conversationId,
            contactId: input.contactId,
            text: `Please type your booking time (e.g., *7:30 PM* or *19:30*):`,
          })
          return
        }

        const prefix = `restaurant_field_${field.field_name}_`
        if (replyId.startsWith(prefix)) {
          const idx = parseInt(replyId.slice(prefix.length), 10)
          const timeFrom = config.booking_time_from || '11:00 AM'
          const timeTo = config.booking_time_to || '9:00 PM'
          const slots = generateTimeSlots(timeFrom, timeTo, 30)

          // Apply today's buffer filter to match what was shown
          const selectedDate = getCollectedDate(session.collected_data as Record<string, unknown>, fields)
          let availableSlots = [...slots]
          const blockToday = isBlockTodayActive(config)
          if (selectedDate && isSelectedToday(selectedDate) && !blockToday) {
            const cutoff = getISTCurrentTimeInMinutes() + (config.booking_time_buffer_minutes ?? 60)
            availableSlots = slots.filter(s => {
              const mins = parseTimeToMinutes(s)
              return mins !== null && mins >= cutoff
            })
          }

          answer = availableSlots[idx] ?? message.reply_title
        } else {
          answer = message.reply_title
        }
      } else if (message.kind === 'text') {
        answer = cleanWhatsAppFormatting(message.text)
        if (!isValidTime(answer)) {
          await engineSendText({
            accountId: input.accountId,
            userId: input.userId,
            conversationId: input.conversationId,
            contactId: input.contactId,
            text: `❌ Invalid time format. Please enter a valid time (e.g. *7:30 PM* or *19:30*):`,
          })
          return
        }
      }

      // Validate time restrictions
      if (answer) {
        let timeStr = answer.trim()
        let timeMins = parseTimeToMinutes(timeStr)

        // Check if the selected date is today to customize start time range
        const selectedDate = getCollectedDate(session.collected_data as Record<string, unknown>, fields)
        const isToday = selectedDate && isSelectedToday(selectedDate)
        const blockToday = isBlockTodayActive(config)

        let effectiveFrom = config.booking_time_from || '11:00 AM'
        if (isToday && !blockToday) {
          const bufferMinutes = config.booking_time_buffer_minutes ?? 60
          const cutoff = getISTCurrentTimeInMinutes() + bufferMinutes
          const slots = generateTimeSlots(effectiveFrom, config.booking_time_to || '9:00 PM', 30)
          const availableSlots = slots.filter(s => {
            const mins = parseTimeToMinutes(s)
            return mins !== null && mins >= cutoff
          })

          if (availableSlots.length === 0) {
            await engineSendText({
              accountId: input.accountId,
              userId: input.userId,
              conversationId: input.conversationId,
              contactId: input.contactId,
              text: 'Today\'s booking time is over. Please try tomorrow.',
            })

            // Go back to date selection
            const dateFieldIndex = fields.findIndex(f => f.field_type === 'date')
            if (dateFieldIndex !== -1) {
              const dateField = fields[dateFieldIndex]
              const updatedData = { ...(session.collected_data as Record<string, unknown>) }
              delete updatedData[dateField.field_name]

              const updatedSession = {
                ...session,
                collected_data: updatedData,
                current_field_index: dateFieldIndex,
              }
              await updateSession(db, session.id, {
                collected_data: updatedData,
                current_field_index: dateFieldIndex,
              })
              await sendBookingField(db, input, updatedSession, fields, dateFieldIndex)
            } else {
              await deactivateSession(db, session.id)
            }
            return
          }

          effectiveFrom = availableSlots[0]
        }

        const effectiveFromMins = parseTimeToMinutes(effectiveFrom)
        const toMins = parseTimeToMinutes(config.booking_time_to || '9:00 PM')

        // If timeMins is parsed successfully but is less than the start range,
        // check if adding 12 hours (720 minutes) makes it a valid time within the range.
        // E.g. user typed "2:30" (2:30 AM), but the range is PM-only.
        if (timeMins !== null && effectiveFromMins !== null && toMins !== null) {
          if (timeMins < effectiveFromMins && !timeStr.toLowerCase().includes('am') && !timeStr.toLowerCase().includes('pm')) {
            const adjustedMins = timeMins + 720
            if (adjustedMins >= effectiveFromMins && adjustedMins <= toMins) {
              timeMins = adjustedMins
              timeStr = minutesToTimeString(timeMins)
              answer = timeStr
            }
          }
        }

        // Check time is within the configured window
        if (timeMins === null || (effectiveFromMins !== null && timeMins < effectiveFromMins) || (toMins !== null && timeMins > toMins)) {
          await engineSendText({
            accountId: input.accountId,
            userId: input.userId,
            conversationId: input.conversationId,
            contactId: input.contactId,
            text: `❌ Please select a time between *${effectiveFrom}* and *${config.booking_time_to || '9:00 PM'}*:`,
          })
          return
        }

        // Normalize answer to standard "HH:MM AM/PM" format
        answer = minutesToTimeString(timeMins)
      }
    } else if (field.field_type === 'number') {
      if (message.kind === 'text') {
        answer = cleanWhatsAppFormatting(message.text)
        if (!isValidNumber(answer)) {
          await engineSendText({
            accountId: input.accountId,
            userId: input.userId,
            conversationId: input.conversationId,
            contactId: input.contactId,
            text: `❌ Invalid number. Please enter a valid number for ${field.field_label} (e.g., *4*):`,
          })
          return
        }
      }
    } else if (INTERACTIVE_FIELD_TYPES.has(field.field_type) && message.kind === 'interactive_reply') {
      // Interactive reply — extract the title as the answer
      const replyId = message.reply_id
      const prefix = `restaurant_field_${field.field_name}_`
      if (replyId.startsWith(prefix)) {
        const idx = parseInt(replyId.slice(prefix.length), 10)
        const options: string[] = Array.isArray(field.options) ? field.options : []
        answer = options[idx] ?? message.reply_title
      } else {
        answer = message.reply_title
      }
    } else if (message.kind === 'text') {
      answer = cleanWhatsAppFormatting(message.text)
    } else if (message.kind === 'interactive_reply') {
      // Got interactive reply for a text field — use the title
      answer = message.reply_title
    }

    // Validate required fields
    if (field.is_required && (!answer || answer.length === 0)) {
      await engineSendText({
        accountId: input.accountId,
        userId: input.userId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        text: `This field is required. Please enter your ${field.field_label}:`,
      })
      return
    }

    // Validate regex if configured
    if (answer && field.validation_regex) {
      try {
        const regex = new RegExp(field.validation_regex)
        if (!regex.test(answer)) {
          await engineSendText({
            accountId: input.accountId,
            userId: input.userId,
            conversationId: input.conversationId,
            contactId: input.contactId,
            text: `Invalid format. Please enter a valid ${field.field_label}:`,
          })
          return
        }
      } catch {
        // Invalid regex in config — skip validation
      }
    }

    // Store the answer
    const updatedData = {
      ...(session.collected_data as Record<string, unknown>),
      [field.field_name]: answer ?? '',
    }

    // Refresh session with new data before advancing
    const updatedSession: RestaurantConversationState = {
      ...session,
      collected_data: updatedData,
      current_field_index: fieldIndex + 1,
    }

    await updateSession(db, session.id, {
      collected_data: updatedData,
      current_field_index: fieldIndex + 1,
    })

    // Advance to next field or confirmation
    await sendBookingField(db, input, updatedSession, fields, fieldIndex + 1)
    return
  }

  // ---- Delivery platform selection ----
  if (step === 'awaiting_delivery_selection') {
    if (message.kind === 'interactive_reply') {
      const replyId = message.reply_id
      const prefix = 'restaurant_delivery_'
      if (replyId.startsWith(prefix)) {
        const platformId = replyId.slice(prefix.length)
        const { data: platform } = await db
          .from('restaurant_delivery_platforms')
          .select('name, url')
          .eq('id', platformId)
          .maybeSingle()

        if (platform) {
          const p = platform as { name: string; url: string }
          await engineSendText({
            accountId: input.accountId,
            userId: input.userId,
            conversationId: input.conversationId,
            contactId: input.contactId,
            text: `🛵 Order from *${p.name}*:\n${p.url}`,
          })
        }
      }
    }
    // Return to main menu after delivery platform
    await sendMainMenu(db, input, session)
    return
  }

  // ---- FAQ selection ----
  if (step === 'awaiting_faq_selection') {
    if (message.kind === 'interactive_reply') {
      const replyId = message.reply_id
      const prefix = 'restaurant_faq_'
      if (replyId.startsWith(prefix)) {
        const faqId = replyId.slice(prefix.length)
        const { data: faq } = await db
          .from('restaurant_faqs')
          .select('question, answer')
          .eq('id', faqId)
          .maybeSingle()

        if (faq) {
          const f = faq as { question: string; answer: string }
          await engineSendText({
            accountId: input.accountId,
            userId: input.userId,
            conversationId: input.conversationId,
            contactId: input.contactId,
            text: `❓ *${f.question}*\n\n${f.answer}`,
          })
        }
      }
    }
    // Return to main menu after FAQ
    await sendMainMenu(db, input, session)
    return
  }

  // ---- Unknown step — deactivate and ignore ----
  console.warn('[restaurant] unknown step:', step)
  await deactivateSession(db, session.id)
}

function isValidDate(str: string): boolean {
  const s = cleanWhatsAppFormatting(str).toLowerCase()
  if (s === 'today' || s === 'tomorrow' || s === 'day after tomorrow') return true

  const regex1 = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/
  const regex2 = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/

  if (regex1.test(s)) {
    const match = s.match(regex1)
    if (match) {
      const day = parseInt(match[1], 10)
      const month = parseInt(match[2], 10)
      const year = parseInt(match[3], 10)
      const date = new Date(year, month - 1, day)
      return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    }
  }

  if (regex2.test(s)) {
    const match = s.match(regex2)
    if (match) {
      const year = parseInt(match[1], 10)
      const month = parseInt(match[2], 10)
      const day = parseInt(match[3], 10)
      const date = new Date(year, month - 1, day)
      return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    }
  }

  const timestamp = Date.parse(cleanWhatsAppFormatting(str))
  return !isNaN(timestamp)
}

function isValidTime(str: string): boolean {
  const s = cleanWhatsAppFormatting(str).toLowerCase()
  const regex12 = /^(0?[1-9]|1[0-2]):[0-5][0-9]\s*(am|pm)$/
  const regex24 = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/

  return regex12.test(s) || regex24.test(s)
}

function isValidNumber(str: string): boolean {
  const s = cleanWhatsAppFormatting(str)
  const num = Number(s)
  return !isNaN(num) && Number.isInteger(num) && num > 0
}

function cleanWhatsAppFormatting(str: string): string {
  return str.replace(/^[\*_~`\s]+|[\*_~`\s]+$/g, '').trim()
}

// ============================================================
// Booking time/date restriction helpers
// ============================================================

/** Parse "HH:MM AM/PM" or "HH:MM" (24h) into minutes since midnight. */
function parseTimeToMinutes(str: string): number | null {
  const s = cleanWhatsAppFormatting(str).toLowerCase()
  // Try 12-hour format
  const match12 = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/)
  if (match12) {
    let h = parseInt(match12[1], 10)
    const m = parseInt(match12[2], 10)
    if (match12[3] === 'pm' && h !== 12) h += 12
    if (match12[3] === 'am' && h === 12) h = 0
    return h * 60 + m
  }
  // Try 24-hour format
  const match24 = s.match(/^(\d{1,2}):(\d{2})$/)
  if (match24) {
    const h = parseInt(match24[1], 10)
    const m = parseInt(match24[2], 10)
    if (h < 0 || h > 23 || m < 0 || m > 59) return null
    return h * 60 + m
  }
  return null
}

/** Format minutes since midnight back to "HH:MM AM/PM" (12-hour). */
function minutesToTimeString(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const period = h >= 12 ? 'PM' : 'AM'
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${displayH}:${m.toString().padStart(2, '0')} ${period}`
}

/** Generate time slots between from and to at the given interval (default 30 min). */
function generateTimeSlots(from: string, to: string, intervalMinutes = 30): string[] {
  const fromMin = parseTimeToMinutes(from)
  const toMin = parseTimeToMinutes(to)
  if (fromMin === null || toMin === null || fromMin >= toMin) return []

  const slots: string[] = []
  for (let m = fromMin; m <= toMin; m += intervalMinutes) {
    slots.push(minutesToTimeString(m))
  }
  return slots
}

/** Check if a date string (as stored in collected_data) refers to today. */
function isSelectedToday(dateStr: string): boolean {
  const s = cleanWhatsAppFormatting(dateStr).toLowerCase()
  if (s === 'today') return true

  // Get current date in IST timezone
  const now = new Date()
  const todayFormatted = now.toLocaleDateString('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long', month: 'short', day: 'numeric',
  }).toLowerCase()
  if (s === todayFormatted) return true

  // Check DD/MM/YYYY or YYYY-MM-DD
  const d = parseDateString(s)
  if (d) {
    const todayParts = getISTDateParts(now)
    return d.getFullYear() === todayParts.year &&
           d.getMonth() === todayParts.month &&
           d.getDate() === todayParts.day
  }
  return false
}

/** Parse a date string into a Date object. Returns null on failure. */
function parseDateString(str: string): Date | null {
  const s = cleanWhatsAppFormatting(str).toLowerCase()
  const now = new Date()
  const istParts = getISTDateParts(now)

  if (s === 'today') {
    return new Date(istParts.year, istParts.month, istParts.day)
  }
  if (s === 'tomorrow') {
    const d = new Date(istParts.year, istParts.month, istParts.day)
    d.setDate(d.getDate() + 1)
    return d
  }

  const regex1 = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/
  const regex2 = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/

  let match = s.match(regex1)
  if (match) {
    const day = parseInt(match[1], 10)
    const month = parseInt(match[2], 10)
    const year = parseInt(match[3], 10)
    return new Date(year, month - 1, day)
  }

  match = s.match(regex2)
  if (match) {
    const year = parseInt(match[1], 10)
    const month = parseInt(match[2], 10)
    const day = parseInt(match[3], 10)
    return new Date(year, month - 1, day)
  }

  const timestamp = Date.parse(s)
  if (!isNaN(timestamp)) return new Date(timestamp)
  return null
}

/** Find the date value from collected_data by looking for the date-type field. */
function getCollectedDate(
  collectedData: Record<string, unknown>,
  fields: RestaurantBookingField[],
): string {
  const dateField = fields.find(f => f.field_type === 'date')
  if (!dateField) return ''
  const val = collectedData[dateField.field_name]
  return typeof val === 'string' ? val : ''
}

/** Calculate how many minutes from now a time slot is — used for buffer check. */
function getMinutesUntil(slotMinutes: number): number {
  const nowMinutes = getISTCurrentTimeInMinutes()
  return slotMinutes - nowMinutes
}

async function sendLatestBooking(
  db: AdminClient,
  input: RestaurantDispatchInput,
  session: RestaurantConversationState,
): Promise<void> {
  const { data: bookings, error } = await db
    .from('restaurant_bookings')
    .select('*')
    .eq('contact_id', input.contactId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) {
    console.error('[restaurant] error fetching latest booking:', error.message)
  }

  const booking = bookings?.[0]
  if (!booking) {
    await engineSendText({
      accountId: input.accountId,
      userId: input.userId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      text: `You don't have any bookings yet. Click *New Booking* below to make one!`,
    })
    const config = await loadConfig(db, input.accountId)
    if (config) {
      await sendWelcome(db, config, input, session)
    }
    return
  }

  const data = (booking.booking_json || {}) as Record<string, string>

  const statusLabels: Record<string, string> = {
    pending: 'Pending ⏳',
    confirmed: 'Confirmed ✅',
    cancelled: 'Cancelled ❌',
    no_show: 'No Show 🚫',
  }
  const statusStr = statusLabels[booking.status] ?? booking.status

  const bookingDate = data['booking_date'] ?? data['date'] ?? 'N/A'
  const bookingTime = data['booking_time'] ?? data['time'] ?? 'N/A'
  const guests = data['guests_count'] ?? data['guests'] ?? data['guest_count'] ?? 'N/A'

  const mainKeys = new Set(['date', 'booking_date', 'time', 'booking_time', 'guests', 'guests_count', 'guest_count'])
  let extraFieldsStr = ''
  for (const [key, value] of Object.entries(data)) {
    if (!mainKeys.has(key.toLowerCase()) && value) {
      const label = key
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
      extraFieldsStr += `\n*${label}:* ${value}`
    }
  }

  const text = `*Your Latest Booking Details:*\n\n📅 *Date:* ${bookingDate}\n🕐 *Time:* ${bookingTime}\n👥 *Guests:* ${guests}${extraFieldsStr}\n\n*Status:* ${statusStr}`

  await engineSendText({
    accountId: input.accountId,
    userId: input.userId,
    conversationId: input.conversationId,
    contactId: input.contactId,
    text,
  })

  const config = await loadConfig(db, input.accountId)
  if (config) {
    await sendWelcome(db, config, input, session)
  }
}

export function isBlockTodayActive(config: { block_today_booking: boolean; block_today_timestamp: string | null }): boolean {
  if (!config.block_today_booking || !config.block_today_timestamp) {
    return false
  }

  try {
    const timestampDate = new Date(config.block_today_timestamp)
    
    // Get IST date string for the timestamp
    const tsFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const tsParts = tsFormatter.formatToParts(timestampDate)
    const tsYear = tsParts.find(p => p.type === 'year')?.value
    const tsMonth = tsParts.find(p => p.type === 'month')?.value
    const tsDay = tsParts.find(p => p.type === 'day')?.value
    const tsIST = `${tsYear}-${tsMonth}-${tsDay}`

    // Get IST date string for now
    const nowFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const nowParts = nowFormatter.formatToParts(new Date())
    const nowYear = nowParts.find(p => p.type === 'year')?.value
    const nowMonth = nowParts.find(p => p.type === 'month')?.value
    const nowDay = nowParts.find(p => p.type === 'day')?.value
    const nowIST = `${nowYear}-${nowMonth}-${nowDay}`

    return tsIST === nowIST
  } catch (err) {
    console.error('Error parsing block_today_timestamp:', err)
    return config.block_today_booking
  }
}

function getISTCurrentTimeInMinutes(): number {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  })
  const parts = formatter.formatToParts(now)
  let hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10)
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10)
  hour = hour % 24
  return hour * 60 + minute
}

export function getISTDateParts(date: Date = new Date()): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
  const parts = formatter.formatToParts(date)
  return {
    year: parseInt(parts.find(p => p.type === 'year')?.value || '0', 10),
    month: parseInt(parts.find(p => p.type === 'month')?.value || '0', 10) - 1, // 0-indexed month
    day: parseInt(parts.find(p => p.type === 'day')?.value || '0', 10),
  }
}

function getISTMinutesUntil(slotMinutes: number): number {
  const nowMinutes = getISTCurrentTimeInMinutes()
  return slotMinutes - nowMinutes
}

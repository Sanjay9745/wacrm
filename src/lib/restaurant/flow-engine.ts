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

    // Check if the message is a "Restart Session" button click.
    const isRestartClick = input.message.kind === 'interactive_reply' && input.message.reply_id === 'restaurant_restart_session'

    if (isRestartClick) {
      const newSession = await createSession(db, input)
      await sendWelcome(db, config, input, newSession)
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
  const buttons = [
    {
      id: 'restaurant_welcome_book_table',
      title: 'Book A Table',
    },
    {
      id: 'restaurant_welcome_latest_booking',
      title: 'Latest Booking',
    },
    {
      id: 'restaurant_welcome_view_options',
      title: (config.welcome_button_label || 'View Options').slice(0, 20),
    },
  ]

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
    // Generate next 7 days for the interactive list
    const dates: string[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date()
      d.setDate(d.getDate() + i)
      if (i === 0) dates.push('Today')
      else if (i === 1) dates.push('Tomorrow')
      else {
        const formatted = d.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
        })
        dates.push(formatted)
      }
    }

    const rows = [
      {
        id: `restaurant_field_${field.field_name}_custom`,
        title: 'Type custom date',
      },
      ...dates.map((opt, i) => ({
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
    const options = [
      '12:00 PM', '1:00 PM', '2:00 PM',
      '7:00 PM', '8:00 PM', '9:00 PM',
      'Type custom time'
    ]
    const rows = options.map((opt, i) => ({
      id: i === 6 ? `restaurant_field_${field.field_name}_custom` : `restaurant_field_${field.field_name}_${i}`,
      title: opt,
    }))

    await engineSendInteractiveList({
      accountId: input.accountId,
      userId: input.userId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      bodyText: `Please select your ${field.field_label}:`,
      buttonLabel: 'Choose Time',
      sections: [{ title: 'Common Times', rows }],
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
  } else {
    const typeLabels: Record<string, string> = {
      website_url: '🔗 View our menu here',
      pdf: '📄 Download our menu',
      image: '🖼️ View our menu',
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
          const options: string[] = []
          for (let i = 0; i < 7; i++) {
            const d = new Date()
            d.setDate(d.getDate() + i)
            if (i === 0) options.push('Today')
            else if (i === 1) options.push('Tomorrow')
            else {
              options.push(d.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
              }))
            }
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
          const options = [
            '12:00 PM', '1:00 PM', '2:00 PM',
            '7:00 PM', '8:00 PM', '9:00 PM'
          ]
          answer = options[idx] ?? message.reply_title
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

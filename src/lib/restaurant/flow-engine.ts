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
      const lastActivity = new Date(session.updated_at).getTime()
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

    // 3. No active session — check if message matches a trigger keyword.
    if (input.message.kind !== 'text') {
      return { consumed: false }
    }

    const keywords: string[] = Array.isArray(config.trigger_keywords)
      ? config.trigger_keywords
      : []
    if (keywords.length === 0) {
      return { consumed: false }
    }

    const text = input.message.text.toLowerCase().trim()
    const matches = keywords.some((kw) => text.includes(kw.toLowerCase()))
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
      user_id: input.userId,
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
      updated_at: new Date().toISOString(),
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
  await engineSendInteractiveButtons({
    accountId: input.accountId,
    userId: input.userId,
    conversationId: input.conversationId,
    contactId: input.contactId,
    bodyText: `*${config.welcome_header}*\n\n${config.welcome_body}`,
    footerText: config.welcome_footer || undefined,
    buttons: [
      {
        id: 'restaurant_view_options',
        title: config.welcome_button_label || 'View Options',
      },
    ],
  })
  await updateSession(db, session.id, { current_step: 'awaiting_welcome_tap' })
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

  await engineSendInteractiveList({
    accountId: input.accountId,
    userId: input.userId,
    conversationId: input.conversationId,
    contactId: input.contactId,
    bodyText: 'Please choose an option from the menu below:',
    buttonLabel: 'Our Services',
    sections: [
      {
        title: 'What would you like to do?',
        rows: items.map((item) => ({
          id: `restaurant_menu_${item.action_type}`,
          title: item.title,
          description: item.description || undefined,
        })),
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

  if (INTERACTIVE_FIELD_TYPES.has(field.field_type)) {
    // Send as interactive list
    const options: string[] = Array.isArray(field.options) ? field.options : []
    if (options.length === 0) {
      // No options configured — skip and ask as text
      await engineSendText({
        accountId: input.accountId,
        userId: input.userId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        text: `Please enter your ${field.field_label}:`,
      })
    } else {
      // WhatsApp list messages support max 10 rows. If more, chunk.
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
        buttonLabel: `Choose ${field.field_label}`,
        sections: [{ title: field.field_label, rows }],
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

  // Interpolate collected data into the confirmation template
  const template = config.confirmation_template || 'Your booking has been received.'
  const data = session.collected_data as Record<string, string>
  const text = template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
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
          title: p.name,
          description: p.url ? 'Tap to get link' : undefined,
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
        title: 'Frequently Asked Questions',
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
    if (
      message.kind === 'interactive_reply' &&
      message.reply_id === 'restaurant_view_options'
    ) {
      await sendMainMenu(db, input, session)
      return
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
      // Start booking flow
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

    if (INTERACTIVE_FIELD_TYPES.has(field.field_type) && message.kind === 'interactive_reply') {
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
      answer = message.text.trim()
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

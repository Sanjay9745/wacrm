import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { isBlockTodayActive } from '@/lib/restaurant/flow-engine'

/**
 * GET /api/restaurant/config — fetch restaurant config for the caller's account.
 * PUT /api/restaurant/config — update restaurant config.
 */

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, status: 401, body: { error: 'Unauthorized' } }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .single()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) {
    return { ok: false as const, status: 403, body: { error: 'No account linked' } }
  }
  return { ok: true as const, userId: user.id, accountId, supabase }
}

export async function GET() {
  const guard = await requireUser()
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const { data, error } = await guard.supabase
    .from('restaurant_config')
    .select('*')
    .eq('account_id', guard.accountId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // If no config exists, create a default one
  if (!data) {
    const admin = supabaseAdmin()
    const { data: created, error: createErr } = await admin
      .from('restaurant_config')
      .insert({
        account_id: guard.accountId,
        user_id: guard.userId,
      })
      .select()
      .single()
    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 })
    return NextResponse.json({ config: created })
  }

  // Check if today-blocking has expired
  if (data.block_today_booking && !isBlockTodayActive(data)) {
    const admin = supabaseAdmin()
    const { data: updated } = await admin
      .from('restaurant_config')
      .update({
        block_today_booking: false,
        block_today_timestamp: null,
      })
      .eq('id', data.id)
      .select()
      .single()
    if (updated) {
      return NextResponse.json({ config: updated })
    }
  }

  return NextResponse.json({ config: data })
}

export async function PUT(request: Request) {
  const guard = await requireUser()
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const admin = supabaseAdmin()

  // Upsert — update if exists, insert if not
  const { data: existing } = await admin
    .from('restaurant_config')
    .select('id')
    .eq('account_id', guard.accountId)
    .maybeSingle()

  const updateFields: Record<string, unknown> = {}
  const allowedFields = [
    'welcome_header', 'welcome_body', 'welcome_footer',
    'welcome_button_label', 'confirmation_template',
    'is_enabled', 'trigger_keywords', 'session_timeout_minutes',
    'linked_automation_id', 'show_latest_booking',
    'start_on_any_message', 'restart_message', 'restart_button_label',
    'booking_time_from', 'booking_time_to',
    'booking_date_range_days', 'booking_time_buffer_minutes',
    'block_today_booking', 'block_today_timestamp', 'block_today_message',
  ]
  for (const key of allowedFields) {
    if (key in body) updateFields[key] = body[key]
  }

  if (existing) {
    const { data, error } = await admin
      .from('restaurant_config')
      .update(updateFields)
      .eq('id', existing.id)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ config: data })
  } else {
    const { data, error } = await admin
      .from('restaurant_config')
      .insert({
        account_id: guard.accountId,
        user_id: guard.userId,
        ...updateFields,
      })
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ config: data }, { status: 201 })
  }
}

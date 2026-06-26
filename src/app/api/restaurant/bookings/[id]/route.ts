import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, status: 401, body: { error: 'Unauthorized' } }
  const { data: profile } = await supabase
    .from('profiles').select('account_id').eq('user_id', user.id).single()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) return { ok: false as const, status: 403, body: { error: 'No account linked' } }
  return { ok: true as const, userId: user.id, accountId, supabase }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireUser()
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const { id } = await params

  const { data: booking, error } = await guard.supabase
    .from('restaurant_bookings')
    .select('*, contact:contacts(id, name, phone, email)')
    .eq('id', id)
    .eq('account_id', guard.accountId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Load status log
  const { data: statusLog } = await guard.supabase
    .from('restaurant_booking_status_log')
    .select('*, changed_by_profile:profiles!restaurant_booking_status_log_changed_by_fkey(full_name)')
    .eq('booking_id', id)
    .order('created_at', { ascending: false })

  return NextResponse.json({
    booking,
    status_log: statusLog ?? [],
  })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireUser()
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const { id } = await params
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const admin = supabaseAdmin()

  // Load current booking
  const { data: current } = await admin
    .from('restaurant_bookings')
    .select('status')
    .eq('id', id)
    .eq('account_id', guard.accountId)
    .maybeSingle()
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const update: Record<string, unknown> = {}
  if ('status' in body) update.status = body.status
  if ('internal_notes' in body) update.internal_notes = body.internal_notes
  if ('assigned_user_id' in body) update.assigned_user_id = body.assigned_user_id

  const { data, error } = await admin
    .from('restaurant_bookings')
    .update(update)
    .eq('id', id)
    .eq('account_id', guard.accountId)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Log status change
  if ('status' in body && body.status !== current.status) {
    await admin.from('restaurant_booking_status_log').insert({
      booking_id: id,
      old_status: current.status,
      new_status: body.status,
      changed_by: guard.userId,
      note: body.status_note ?? '',
    })
  }

  return NextResponse.json({ booking: data })
}

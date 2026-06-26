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

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100)
  const status = searchParams.get('status')
  const search = searchParams.get('search')
  const dateFrom = searchParams.get('date_from')
  const dateTo = searchParams.get('date_to')
  const sortBy = searchParams.get('sort_by') ?? 'created_at'
  const sortDir = searchParams.get('sort_dir') === 'asc' ? true : false

  const offset = (page - 1) * limit

  let query = guard.supabase
    .from('restaurant_bookings')
    .select('*, contact:contacts(id, name, phone)', { count: 'exact' })
    .eq('account_id', guard.accountId)

  if (status) query = query.eq('status', status)
  if (search) query = query.or(`phone.ilike.%${search}%,booking_json->>name.ilike.%${search}%`)
  if (dateFrom) query = query.gte('created_at', dateFrom)
  if (dateTo) query = query.lte('created_at', dateTo)

  query = query
    .order(sortBy, { ascending: sortDir })
    .range(offset, offset + limit - 1)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    bookings: data ?? [],
    total: count ?? 0,
    page,
    limit,
    total_pages: Math.ceil((count ?? 0) / limit),
  })
}

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('restaurant_bookings')
    .insert({
      account_id: guard.accountId,
      user_id: guard.userId,
      contact_id: body.contact_id ?? null,
      phone: body.phone ?? null,
      status: body.status ?? 'pending',
      booking_json: body.booking_json ?? {},
      internal_notes: body.internal_notes ?? '',
      assigned_user_id: body.assigned_user_id ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Log initial status
  await admin.from('restaurant_booking_status_log').insert({
    booking_id: data.id,
    old_status: null,
    new_status: body.status ?? 'pending',
    changed_by: guard.userId,
    note: 'Booking created',
  })

  return NextResponse.json({ booking: data }, { status: 201 })
}

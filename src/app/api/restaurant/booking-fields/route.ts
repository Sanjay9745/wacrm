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

export async function GET() {
  const guard = await requireUser()
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const { data, error } = await guard.supabase
    .from('restaurant_booking_fields')
    .select('*')
    .eq('account_id', guard.accountId)
    .order('position', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Seed defaults if empty
  if (!data || data.length === 0) {
    const admin = supabaseAdmin()
    const defaults = [
      { field_name: 'date', field_label: 'Date', field_type: 'single_select', options: ['Today', 'Tomorrow'], is_required: true, position: 0 },
      { field_name: 'time', field_label: 'Time', field_type: 'single_select', options: ['11:00 AM', '11:30 AM', '12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM', '7:00 PM', '7:30 PM', '8:00 PM', '8:30 PM'], is_required: true, position: 1 },
      { field_name: 'guests', field_label: 'Guests', field_type: 'single_select', options: ['1', '2', '3', '4', '5', '6+'], is_required: true, position: 2 },
    ]
    const { data: created, error: seedErr } = await admin
      .from('restaurant_booking_fields')
      .insert(defaults.map(d => ({ ...d, account_id: guard.accountId })))
      .select()
    if (seedErr) return NextResponse.json({ error: seedErr.message }, { status: 500 })
    return NextResponse.json({ fields: created })
  }

  return NextResponse.json({ fields: data })
}

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  if (!body.field_name?.trim() || !body.field_label?.trim() || !body.field_type) {
    return NextResponse.json({ error: 'field_name, field_label, field_type required' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('restaurant_booking_fields')
    .insert({
      account_id: guard.accountId,
      field_name: body.field_name.trim(),
      field_label: body.field_label.trim(),
      field_type: body.field_type,
      options: body.options ?? [],
      is_required: body.is_required ?? false,
      placeholder: body.placeholder ?? '',
      validation_regex: body.validation_regex ?? '',
      position: body.position ?? 999,
      is_enabled: body.is_enabled ?? true,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ field: data }, { status: 201 })
}

export async function PUT(request: Request) {
  const guard = await requireUser()
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const body = await request.json().catch(() => null)
  if (!body?.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = supabaseAdmin()
  const update: Record<string, unknown> = {}
  const allowed = ['field_name', 'field_label', 'field_type', 'options', 'is_required', 'placeholder', 'validation_regex', 'position', 'is_enabled']
  for (const key of allowed) {
    if (key in body) update[key] = body[key]
  }

  const { data, error } = await admin
    .from('restaurant_booking_fields')
    .update(update)
    .eq('id', body.id)
    .eq('account_id', guard.accountId)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ field: data })
}

export async function DELETE(request: Request) {
  const guard = await requireUser()
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = supabaseAdmin()
  const { error } = await admin
    .from('restaurant_booking_fields')
    .delete()
    .eq('id', id)
    .eq('account_id', guard.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

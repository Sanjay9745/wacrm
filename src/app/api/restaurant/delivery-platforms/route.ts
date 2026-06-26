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
    .from('restaurant_delivery_platforms')
    .select('*')
    .eq('account_id', guard.accountId)
    .order('position', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Seed defaults if empty
  if (!data || data.length === 0) {
    const admin = supabaseAdmin()
    const defaults = [
      { name: 'Swiggy', logo_url: '', url: 'https://www.swiggy.com', position: 0 },
      { name: 'Zomato', logo_url: '', url: 'https://www.zomato.com', position: 1 },
    ]
    const { data: created, error: seedErr } = await admin
      .from('restaurant_delivery_platforms')
      .insert(defaults.map(d => ({ ...d, account_id: guard.accountId })))
      .select()
    if (seedErr) return NextResponse.json({ error: seedErr.message }, { status: 500 })
    return NextResponse.json({ platforms: created })
  }

  return NextResponse.json({ platforms: data })
}

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const body = await request.json().catch(() => null)
  if (!body?.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('restaurant_delivery_platforms')
    .insert({
      account_id: guard.accountId,
      name: body.name.trim(),
      logo_url: body.logo_url ?? '',
      url: body.url ?? '',
      is_enabled: body.is_enabled ?? true,
      position: body.position ?? 999,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ platform: data }, { status: 201 })
}

export async function PUT(request: Request) {
  const guard = await requireUser()
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const body = await request.json().catch(() => null)
  if (!body?.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = supabaseAdmin()
  const update: Record<string, unknown> = {}
  for (const key of ['name', 'logo_url', 'url', 'is_enabled', 'position']) {
    if (key in body) update[key] = body[key]
  }

  const { data, error } = await admin
    .from('restaurant_delivery_platforms')
    .update(update)
    .eq('id', body.id)
    .eq('account_id', guard.accountId)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ platform: data })
}

export async function DELETE(request: Request) {
  const guard = await requireUser()
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = supabaseAdmin()
  const { error } = await admin
    .from('restaurant_delivery_platforms')
    .delete()
    .eq('id', id)
    .eq('account_id', guard.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

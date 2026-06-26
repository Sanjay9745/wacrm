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
    .from('restaurant_menu_config')
    .select('*')
    .eq('account_id', guard.accountId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ config: data })
}

export async function PUT(request: Request) {
  const guard = await requireUser()
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const admin = supabaseAdmin()

  const { data: existing } = await admin
    .from('restaurant_menu_config')
    .select('id')
    .eq('account_id', guard.accountId)
    .maybeSingle()

  const update: Record<string, unknown> = {}
  for (const key of ['menu_type', 'menu_value', 'is_active']) {
    if (key in body) update[key] = body[key]
  }

  if (existing) {
    const { data, error } = await admin
      .from('restaurant_menu_config')
      .update(update)
      .eq('id', existing.id)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ config: data })
  } else {
    const { data, error } = await admin
      .from('restaurant_menu_config')
      .insert({ account_id: guard.accountId, ...update })
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ config: data }, { status: 201 })
  }
}

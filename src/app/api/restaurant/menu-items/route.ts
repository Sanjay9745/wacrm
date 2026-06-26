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
    .from('restaurant_menu_items')
    .select('*')
    .eq('account_id', guard.accountId)
    .order('position', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Seed defaults if empty
  if (!data || data.length === 0) {
    const admin = supabaseAdmin()
    const defaults = [
      { title: 'Book a Table', description: 'Reserve your table', action_type: 'book_table', position: 0 },
      { title: 'Order Online', description: 'Order from your favorite platform', action_type: 'order_online', position: 1 },
      { title: 'Our Menu', description: 'View our full menu', action_type: 'menu', position: 2 },
      { title: 'FAQ', description: 'Frequently asked questions', action_type: 'faq', position: 3 },
    ]
    const { data: created, error: seedErr } = await admin
      .from('restaurant_menu_items')
      .insert(defaults.map(d => ({ ...d, account_id: guard.accountId })))
      .select()
    if (seedErr) return NextResponse.json({ error: seedErr.message }, { status: 500 })
    return NextResponse.json({ items: created })
  }

  return NextResponse.json({ items: data })
}

export async function PUT(request: Request) {
  const guard = await requireUser()
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const body = await request.json().catch(() => null)
  if (!body?.items || !Array.isArray(body.items)) {
    return NextResponse.json({ error: 'items array required' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const errors: string[] = []

  for (const item of body.items) {
    if (!item.id) continue
    const update: Record<string, unknown> = {}
    if ('title' in item) update.title = item.title
    if ('description' in item) update.description = item.description
    if ('is_enabled' in item) update.is_enabled = item.is_enabled
    if ('position' in item) update.position = item.position

    const { error } = await admin
      .from('restaurant_menu_items')
      .update(update)
      .eq('id', item.id)
      .eq('account_id', guard.accountId)
    if (error) errors.push(error.message)
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join('; ') }, { status: 500 })
  }

  // Return updated list
  const { data } = await guard.supabase
    .from('restaurant_menu_items')
    .select('*')
    .eq('account_id', guard.accountId)
    .order('position', { ascending: true })
  return NextResponse.json({ items: data ?? [] })
}

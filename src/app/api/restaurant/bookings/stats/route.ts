import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString()
  const endOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).toISOString()

  const db = guard.supabase

  // Total bookings
  const { count: total } = await db
    .from('restaurant_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', guard.accountId)

  // Today's bookings
  const { count: today } = await db
    .from('restaurant_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', guard.accountId)
    .gte('created_at', startOfToday)
    .lt('created_at', startOfTomorrow)

  // Tomorrow's bookings
  const { count: tomorrow } = await db
    .from('restaurant_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', guard.accountId)
    .gte('created_at', startOfTomorrow)
    .lt('created_at', endOfTomorrow)

  // By status
  const statusCounts: Record<string, number> = {}
  for (const status of ['pending', 'confirmed', 'completed', 'cancelled', 'no_show']) {
    const { count } = await db
      .from('restaurant_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', guard.accountId)
      .eq('status', status)
    statusCounts[status] = count ?? 0
  }

  return NextResponse.json({
    stats: {
      total: total ?? 0,
      today: today ?? 0,
      tomorrow: tomorrow ?? 0,
      cancelled: statusCounts.cancelled ?? 0,
      completed: statusCounts.completed ?? 0,
      pending: statusCounts.pending ?? 0,
      confirmed: statusCounts.confirmed ?? 0,
      no_show: statusCounts.no_show ?? 0,
    },
  })
}

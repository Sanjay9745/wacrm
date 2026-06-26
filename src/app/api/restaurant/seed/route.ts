import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { seedRestaurantBookings } from '@/lib/restaurant/seeder'

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Data seeding is not allowed in production.' }, { status: 403 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('account_id').eq('user_id', user.id).single()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) return NextResponse.json({ error: 'No account linked' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const count = Math.min(body.count ?? 500, 2000)

  const result = await seedRestaurantBookings(accountId, user.id, count)

  return NextResponse.json({
    message: `Seeded ${result.count} bookings`,
    ...result,
  })
}

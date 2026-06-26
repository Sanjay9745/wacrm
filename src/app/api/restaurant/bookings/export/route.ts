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

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const { searchParams } = new URL(request.url)
  const format = searchParams.get('format') ?? 'csv'
  const status = searchParams.get('status')
  const dateFrom = searchParams.get('date_from')
  const dateTo = searchParams.get('date_to')

  let query = guard.supabase
    .from('restaurant_bookings')
    .select('*, contact:contacts(name, phone)')
    .eq('account_id', guard.accountId)
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)
  if (dateFrom) query = query.gte('created_at', dateFrom)
  if (dateTo) query = query.lte('created_at', dateTo)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const bookings = (data ?? []) as Array<{
    id: string
    phone: string | null
    status: string
    booking_json: Record<string, unknown>
    internal_notes: string
    created_at: string
    contact: { name: string | null; phone: string } | null
  }>

  // Collect all dynamic keys from booking_json
  const dynamicKeys = new Set<string>()
  for (const b of bookings) {
    if (b.booking_json && typeof b.booking_json === 'object') {
      for (const key of Object.keys(b.booking_json)) {
        dynamicKeys.add(key)
      }
    }
  }
  const sortedKeys = Array.from(dynamicKeys).sort()

  // Build CSV
  const headers = ['Booking ID', 'Customer Name', 'Phone', 'Status', ...sortedKeys, 'Notes', 'Created At']
  const rows = bookings.map(b => {
    const contactName = b.contact?.name ?? ''
    const phone = b.phone ?? b.contact?.phone ?? ''
    const dynamicVals = sortedKeys.map(k => {
      const v = b.booking_json?.[k]
      return typeof v === 'string' ? v : JSON.stringify(v ?? '')
    })
    return [
      b.id,
      contactName,
      phone,
      b.status,
      ...dynamicVals,
      b.internal_notes ?? '',
      b.created_at,
    ]
  })

  const csvContent = [
    headers.map(h => `"${h}"`).join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
  ].join('\n')

  const filename = `bookings_export_${new Date().toISOString().slice(0, 10)}.csv`

  return new Response(csvContent, {
    status: 200,
    headers: {
      'Content-Type': format === 'csv' ? 'text/csv' : 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

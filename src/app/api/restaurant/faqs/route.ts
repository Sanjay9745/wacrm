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
    .from('restaurant_faqs')
    .select('*')
    .eq('account_id', guard.accountId)
    .order('position', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Seed defaults if empty
  if (!data || data.length === 0) {
    const admin = supabaseAdmin()
    const defaults = [
      { question: 'What are your opening hours?', answer: 'We are open Monday to Sunday, 11:00 AM to 11:00 PM.', position: 0 },
      { question: 'Do you have any special events?', answer: 'Yes! We have live music every Friday and Saturday night. Follow us for updates.', position: 1 },
      { question: 'What offers are currently available?', answer: 'We offer 20% off on weekday lunches and happy hour discounts from 4-7 PM daily.', position: 2 },
      { question: 'Is there parking available?', answer: 'Yes, we have free valet parking and a dedicated parking lot for our guests.', position: 3 },
      { question: 'How can I contact you?', answer: 'You can reach us at +91 9999999999 or email us at info@restaurant.com', position: 4 },
      { question: 'What is your cancellation policy?', answer: 'Cancellations are free up to 2 hours before your reservation time.', position: 5 },
    ]
    const { data: created, error: seedErr } = await admin
      .from('restaurant_faqs')
      .insert(defaults.map(d => ({ ...d, account_id: guard.accountId })))
      .select()
    if (seedErr) return NextResponse.json({ error: seedErr.message }, { status: 500 })
    return NextResponse.json({ faqs: created })
  }

  return NextResponse.json({ faqs: data })
}

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const body = await request.json().catch(() => null)
  if (!body?.question?.trim() || !body?.answer?.trim()) {
    return NextResponse.json({ error: 'question and answer required' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('restaurant_faqs')
    .insert({
      account_id: guard.accountId,
      question: body.question.trim(),
      answer: body.answer.trim(),
      is_enabled: body.is_enabled ?? true,
      position: body.position ?? 999,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ faq: data }, { status: 201 })
}

export async function PUT(request: Request) {
  const guard = await requireUser()
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const body = await request.json().catch(() => null)
  if (!body?.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = supabaseAdmin()
  const update: Record<string, unknown> = {}
  for (const key of ['question', 'answer', 'is_enabled', 'position']) {
    if (key in body) update[key] = body[key]
  }

  const { data, error } = await admin
    .from('restaurant_faqs')
    .update(update)
    .eq('id', body.id)
    .eq('account_id', guard.accountId)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ faq: data })
}

export async function DELETE(request: Request) {
  const guard = await requireUser()
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = supabaseAdmin()
  const { error } = await admin
    .from('restaurant_faqs')
    .delete()
    .eq('id', id)
    .eq('account_id', guard.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

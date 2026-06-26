import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .single()
    
  const accountId = profile?.account_id as string | undefined
  if (!accountId) {
    return NextResponse.json({ error: 'No account linked' }, { status: 403 })
  }

  const admin = supabaseAdmin()

  try {
    // 1. Delete existing configuration to reset
    await admin.from('restaurant_menu_items').delete().eq('account_id', accountId)
    await admin.from('restaurant_booking_fields').delete().eq('account_id', accountId)
    await admin.from('restaurant_faqs').delete().eq('account_id', accountId)
    await admin.from('restaurant_delivery_platforms').delete().eq('account_id', accountId)

    // 2. Insert Menu Items
    const { error: menuErr } = await admin.from('restaurant_menu_items').insert([
      { account_id: accountId, title: 'Book a Table', description: 'Reserve a table at our restaurant', action_type: 'book_table', position: 0, is_enabled: true },
      { account_id: accountId, title: 'Order Online', description: 'Get food delivered to your door', action_type: 'order_online', position: 1, is_enabled: true },
      { account_id: accountId, title: 'View Menu', description: 'See our delicious offerings', action_type: 'menu', position: 2, is_enabled: true },
      { account_id: accountId, title: 'FAQ & Info', description: 'Common questions and answers', action_type: 'faq', position: 3, is_enabled: true },
    ])
    if (menuErr) throw new Error(`Menu items error: ${menuErr.message}`)

    // 3. Insert Booking Fields
    const { error: fieldsErr } = await admin.from('restaurant_booking_fields').insert([
      { account_id: accountId, field_name: 'guest_name', field_label: 'Full Name', field_type: 'text', is_required: true, position: 0, is_enabled: true },
      { account_id: accountId, field_name: 'booking_date', field_label: 'Date', field_type: 'date', is_required: true, position: 1, is_enabled: true },
      { account_id: accountId, field_name: 'booking_time', field_label: 'Time', field_type: 'time', is_required: true, position: 2, is_enabled: true },
      { account_id: accountId, field_name: 'guests_count', field_label: 'Number of Guests', field_type: 'number', is_required: true, position: 3, is_enabled: true },
      { account_id: accountId, field_name: 'special_requests', field_label: 'Special Requests', field_type: 'textarea', is_required: false, position: 4, is_enabled: true },
    ])
    if (fieldsErr) throw new Error(`Booking fields error: ${fieldsErr.message}`)

    // 4. Insert FAQs
    const { error: faqsErr } = await admin.from('restaurant_faqs').insert([
      { account_id: accountId, question: 'What are your opening hours?', answer: 'We are open Monday to Sunday from 11:00 AM to 10:00 PM.', position: 0, is_enabled: true },
      { account_id: accountId, question: 'Do you offer vegan/vegetarian options?', answer: 'Yes, we have a variety of vegan and vegetarian dishes clearly marked on our menu.', position: 1, is_enabled: true },
      { account_id: accountId, question: 'Where are you located?', answer: 'We are located at 123 Main Street in the city center.', position: 2, is_enabled: true },
      { account_id: accountId, question: 'Do you have parking?', answer: 'Yes, we offer free valet parking for all our guests.', position: 3, is_enabled: true },
    ])
    if (faqsErr) throw new Error(`FAQs error: ${faqsErr.message}`)

    // 5. Insert Delivery Platforms
    const { error: deliveryErr } = await admin.from('restaurant_delivery_platforms').insert([
      { account_id: accountId, name: 'UberEats', logo_url: 'https://img.icons8.com/color/48/000000/uber-eats-app.png', url: 'https://ubereats.com', position: 0, is_enabled: true },
      { account_id: accountId, name: 'DoorDash', logo_url: 'https://img.icons8.com/color/48/000000/doordash.png', url: 'https://doordash.com', position: 1, is_enabled: true },
    ])
    if (deliveryErr) throw new Error(`Delivery platforms error: ${deliveryErr.message}`)

    // 6. Ensure restaurant_config is enabled and has standard welcome message
    const { data: existingConfig } = await admin.from('restaurant_config').select('id').eq('account_id', accountId).maybeSingle()
    if (existingConfig) {
      await admin.from('restaurant_config').update({
        is_enabled: true,
        welcome_header: 'Welcome 🍽️',
        welcome_body: 'Welcome to our restaurant! How can we help you today?',
        welcome_button_label: 'View Options',
      }).eq('id', existingConfig.id)
    } else {
      await admin.from('restaurant_config').insert({
        account_id: accountId,
        user_id: user.id,
        is_enabled: true,
        welcome_header: 'Welcome 🍽️',
        welcome_body: 'Welcome to our restaurant! How can we help you today?',
        welcome_button_label: 'View Options',
      })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('Seed config error:', err)
    return NextResponse.json({ error: err.message || 'Failed to seed configuration' }, { status: 500 })
  }
}

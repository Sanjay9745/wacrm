/**
 * Restaurant bookings seeder — generates 500+ realistic bookings.
 *
 * Called from the seed API route (dev/staging only) or from tests.
 * Each booking has randomized dates, times, guest counts, statuses,
 * names, phone numbers, and special notes.
 */

import { supabaseAdmin } from '@/lib/flows/admin-client'

const NAMES = [
  'Aarav Patel', 'Aditi Sharma', 'Arjun Mehta', 'Ananya Gupta', 'Rohan Kapoor',
  'Priya Singh', 'Vikram Reddy', 'Neha Joshi', 'Karan Kumar', 'Divya Nair',
  'Sanjay Verma', 'Meera Das', 'Amit Chauhan', 'Pooja Yadav', 'Rajesh Iyer',
  'Sneha Bhat', 'Manish Aggarwal', 'Ritu Malhotra', 'Deepak Srivastava', 'Kavita Rao',
  'Suresh Khanna', 'Anita Deshpande', 'Vijay Thakur', 'Lakshmi Pillai', 'Rahul Saxena',
  'Swati Choudhury', 'Arun Mishra', 'Nisha Bansal', 'Gaurav Tiwari', 'Pallavi Hegde',
  'Manoj Dubey', 'Simran Kaur', 'Ashok Pandey', 'Rekha Bose', 'Nikhil Shetty',
  'Tanvi Kulkarni', 'Prakash Menon', 'Shweta Ahuja', 'Harsh Goel', 'Bhavna Agrawal',
  'Sachin Rastogi', 'Isha Chatterjee', 'Pankaj Dixit', 'Aparna Rajan', 'Tushar Bhatt',
  'Varsha Jain', 'Yogesh Shukla', 'Madhuri Patil', 'Kunal Wagh', 'Radha Krishnan',
]

const TIMES = [
  '11:00 AM', '11:30 AM', '12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM',
  '2:00 PM', '7:00 PM', '7:30 PM', '8:00 PM', '8:30 PM', '9:00 PM', '9:30 PM',
]

const DATES_RELATIVE = ['Today', 'Tomorrow']

const NOTES = [
  'Window seat preferred', 'Birthday celebration 🎂', 'Anniversary dinner ❤️',
  'Allergic to nuts', 'Need a high chair for baby', 'Vegetarian only',
  'Outdoor seating if available', 'Near the live music stage',
  'Surprise party — please arrange cake', 'Business dinner — quiet area',
  'Wheelchair accessible seating', 'Gluten-free options needed',
  '', '', '', '', // Empty notes to increase probability of no notes
]

const STATUSES: { value: string; weight: number }[] = [
  { value: 'completed', weight: 40 },
  { value: 'confirmed', weight: 25 },
  { value: 'pending', weight: 15 },
  { value: 'cancelled', weight: 10 },
  { value: 'no_show', weight: 10 },
]

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomPhone(): string {
  const prefix = ['98', '97', '96', '95', '94', '93', '91', '90', '88', '87', '86', '85', '84', '83', '82', '81', '80', '79', '78', '77', '76', '75', '74', '73', '72', '71', '70']
  return randomItem(prefix) + String(Math.floor(10000000 + Math.random() * 90000000))
}

function weightedRandomStatus(): string {
  const totalWeight = STATUSES.reduce((acc, s) => acc + s.weight, 0)
  let rand = Math.random() * totalWeight
  for (const s of STATUSES) {
    rand -= s.weight
    if (rand <= 0) return s.value
  }
  return 'pending'
}

function randomDate(daysBack: number, daysForward: number): Date {
  const now = new Date()
  const offset = Math.floor(Math.random() * (daysBack + daysForward)) - daysBack
  const d = new Date(now)
  d.setDate(d.getDate() + offset)
  d.setHours(Math.floor(Math.random() * 14) + 8, Math.floor(Math.random() * 60), 0, 0)
  return d
}

export interface SeedResult {
  count: number
  errors: string[]
}

export async function seedRestaurantBookings(
  accountId: string,
  userId: string,
  count: number = 500,
): Promise<SeedResult> {
  const db = supabaseAdmin()
  const errors: string[] = []

  // Generate bookings in batches of 50
  const batchSize = 50
  let totalInserted = 0

  for (let i = 0; i < count; i += batchSize) {
    const batch = []
    const batchCount = Math.min(batchSize, count - i)

    for (let j = 0; j < batchCount; j++) {
      const name = randomItem(NAMES)
      const phone = randomPhone()
      const date = randomItem(DATES_RELATIVE)
      const time = randomItem(TIMES)
      const guests = String(Math.floor(Math.random() * 6) + 1)
      const note = randomItem(NOTES)
      const status = weightedRandomStatus()
      const createdAt = randomDate(30, 7)

      batch.push({
        account_id: accountId,
        user_id: userId,
        phone,
        status,
        booking_json: {
          name,
          date,
          time,
          guests,
          phone,
          special_note: note,
        },
        internal_notes: '',
        created_at: createdAt.toISOString(),
      })
    }

    const { error } = await db.from('restaurant_bookings').insert(batch)
    if (error) {
      errors.push(`Batch ${i / batchSize}: ${error.message}`)
    } else {
      totalInserted += batchCount
    }
  }

  return { count: totalInserted, errors }
}

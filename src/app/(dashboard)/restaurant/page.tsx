'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  CalendarCheck,
  CalendarPlus,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Users,
  BarChart3,
  ArrowRight,
} from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard, Skeleton } from '@/components/dashboard/skeleton'
import { BookingStatusBadge } from '@/components/restaurant/booking-status-badge'
import type { RestaurantDashboardStats, RestaurantBooking, BookingStatus } from '@/types/restaurant'

export default function RestaurantDashboard() {
  const [stats, setStats] = useState<RestaurantDashboardStats | null>(null)
  const [recentBookings, setRecentBookings] = useState<RestaurantBooking[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const [statsRes, bookingsRes] = await Promise.all([
        fetch('/api/restaurant/bookings/stats'),
        fetch('/api/restaurant/bookings?limit=8&sort_by=created_at&sort_dir=desc'),
      ])
      const statsData = await statsRes.json()
      const bookingsData = await bookingsRes.json()
      setStats(statsData.stats ?? null)
      setRecentBookings(bookingsData.bookings ?? [])
    } catch (err) {
      console.error('Failed to load dashboard:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Restaurant Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Overview of your restaurant bookings and performance.
        </p>
      </div>

      {/* Summary cards */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : stats ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            title="Total Bookings"
            value={String(stats.total)}
            icon={CalendarCheck}
            subtitle="All time"
          />
          <MetricCard
            title="Today"
            value={String(stats.today)}
            icon={Clock}
            subtitle="Bookings today"
          />
          <MetricCard
            title="Tomorrow"
            value={String(stats.tomorrow)}
            icon={CalendarPlus}
            subtitle="Upcoming"
          />
          <MetricCard
            title="Pending"
            value={String(stats.pending)}
            icon={AlertTriangle}
            subtitle="Awaiting confirmation"
          />
          <MetricCard
            title="Confirmed"
            value={String(stats.confirmed)}
            icon={CheckCircle2}
            subtitle="Ready to serve"
          />
          <MetricCard
            title="Cancelled"
            value={String(stats.cancelled)}
            icon={XCircle}
            subtitle="Cancellations"
          />
        </div>
      ) : null}

      {/* Recent bookings */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Recent Bookings</h2>
            <p className="text-xs text-muted-foreground">Latest booking activity</p>
          </div>
          <Link
            href="/restaurant/bookings"
            className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            View All
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {loading ? (
          <div className="p-5 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : recentBookings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted">
              <BarChart3 className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="mt-4 text-sm font-medium text-foreground">No bookings yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Bookings will appear here once customers start using the WhatsApp flow.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-5 py-3 text-left font-medium">Customer</th>
                  <th className="px-5 py-3 text-left font-medium">Phone</th>
                  <th className="px-5 py-3 text-left font-medium">Date</th>
                  <th className="px-5 py-3 text-left font-medium">Time</th>
                  <th className="px-5 py-3 text-left font-medium">Guests</th>
                  <th className="px-5 py-3 text-left font-medium">Status</th>
                  <th className="px-5 py-3 text-left font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentBookings.map((b) => {
                  const json = b.booking_json as Record<string, string>
                  return (
                    <tr
                      key={b.id}
                      className="cursor-pointer transition-colors hover:bg-muted/50"
                      onClick={() => window.location.href = `/restaurant/bookings/${b.id}`}
                    >
                      <td className="px-5 py-3 text-sm font-medium text-foreground">
                        {json.name || json.guest_name || b.contact?.name || '—'}
                      </td>
                      <td className="px-5 py-3 text-sm text-muted-foreground">
                        {b.phone || b.contact?.phone || '—'}
                      </td>
                      <td className="px-5 py-3 text-sm text-muted-foreground">
                        {json.date || json.booking_date || '—'}
                      </td>
                      <td className="px-5 py-3 text-sm text-muted-foreground">
                        {json.time || json.booking_time || '—'}
                      </td>
                      <td className="px-5 py-3 text-sm text-muted-foreground">
                        {json.guests || json.guests_count || json.guest_count || '—'}
                      </td>
                      <td className="px-5 py-3">
                        <BookingStatusBadge status={b.status} />
                      </td>
                      <td className="px-5 py-3 text-sm text-muted-foreground">
                        {new Date(b.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

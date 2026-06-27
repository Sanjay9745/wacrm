'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { BookingStatusBadge } from '@/components/restaurant/booking-status-badge'
import { Skeleton } from '@/components/dashboard/skeleton'
import type { RestaurantBooking, BookingStatus } from '@/types/restaurant'

const STATUSES: { value: string; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'no_show', label: 'No Show' },
]

export default function BookingsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [bookings, setBookings] = useState<RestaurantBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  // Filters
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [status, setStatus] = useState(searchParams.get('status') ?? '')
  const [dateFrom, setDateFrom] = useState(searchParams.get('date_from') ?? '')
  const [dateTo, setDateTo] = useState(searchParams.get('date_to') ?? '')

  const LIMIT = 20

  const fetchBookings = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', String(LIMIT))
      if (search) params.set('search', search)
      if (status) params.set('status', status)
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)

      const res = await fetch(`/api/restaurant/bookings?${params}`)
      const data = await res.json()
      setBookings(data.bookings ?? [])
      setTotal(data.total ?? 0)
      setTotalPages(data.total_pages ?? 1)
    } catch (err) {
      console.error('Failed to fetch bookings:', err)
    } finally {
      setLoading(false)
    }
  }, [page, search, status, dateFrom, dateTo])

  useEffect(() => { fetchBookings() }, [fetchBookings])

  const handleExport = useCallback(async () => {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (dateFrom) params.set('date_from', dateFrom)
    if (dateTo) params.set('date_to', dateTo)
    params.set('format', 'csv')

    const res = await fetch(`/api/restaurant/bookings/export?${params}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bookings_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [status, dateFrom, dateTo])

  const clearFilters = () => {
    setSearch('')
    setStatus('')
    setDateFrom('')
    setDateTo('')
    setPage(1)
  }

  const hasFilters = search || status || dateFrom || dateTo

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Bookings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} total booking{total !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          {/* Search */}
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder="Search by name or phone..."
                className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Status filter */}
          <div className="w-full sm:w-40">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1) }}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          {/* Date from */}
          <div className="w-full sm:w-40">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Date to */}
          <div className="w-full sm:w-40">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {hasFilters && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : bookings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted">
              <CalendarCheck className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="mt-4 text-sm font-medium text-foreground">No bookings found</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {hasFilters ? 'Try adjusting your filters.' : 'Bookings will appear here once created.'}
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
                {bookings.map((b) => {
                  const json = b.booking_json as Record<string, string>
                  return (
                    <tr
                      key={b.id}
                      className="cursor-pointer transition-colors hover:bg-muted/50"
                      onClick={() => router.push(`/restaurant/bookings/${b.id}`)}
                    >
                      <td className="px-5 py-3 text-sm font-medium text-foreground">
                        {json.name || json.guest_name || (b.contact as { name?: string })?.name || '—'}
                      </td>
                      <td className="px-5 py-3 text-sm text-muted-foreground">
                        {b.phone || (b.contact as { phone?: string })?.phone || '—'}
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-5 py-3">
            <p className="text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="inline-flex items-center rounded-lg border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="inline-flex items-center rounded-lg border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

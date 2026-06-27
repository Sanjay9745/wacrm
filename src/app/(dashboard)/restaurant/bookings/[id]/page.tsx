'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Calendar,
  Clock,
  MapPin,
  Phone,
  User,
  Users,
  MessageSquare,
  StickyNote,
  History,
} from 'lucide-react'
import { BookingStatusBadge } from '@/components/restaurant/booking-status-badge'
import { Skeleton } from '@/components/dashboard/skeleton'
import type { RestaurantBooking, RestaurantBookingStatusLog, BookingStatus } from '@/types/restaurant'
import { BOOKING_STATUS_LABELS } from '@/types/restaurant'

const STATUS_OPTIONS: BookingStatus[] = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show']

export default function BookingDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [booking, setBooking] = useState<RestaurantBooking | null>(null)
  const [statusLog, setStatusLog] = useState<(RestaurantBookingStatusLog & { changed_by_profile?: { full_name: string } | null })[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [notes, setNotes] = useState('')
  const [statusNote, setStatusNote] = useState('')

  const fetchBooking = useCallback(async () => {
    try {
      const res = await fetch(`/api/restaurant/bookings/${id}`)
      const data = await res.json()
      if (data.booking) {
        setBooking(data.booking)
        setNotes(data.booking.internal_notes ?? '')
      }
      setStatusLog(data.status_log ?? [])
    } catch (err) {
      console.error('Failed to fetch booking:', err)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetchBooking() }, [fetchBooking])

  const updateStatus = useCallback(async (newStatus: BookingStatus) => {
    if (!booking || booking.status === newStatus) return
    setUpdating(true)
    try {
      await fetch(`/api/restaurant/bookings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, status_note: statusNote }),
      })
      setStatusNote('')
      await fetchBooking()
    } catch (err) {
      console.error('Failed to update status:', err)
    } finally {
      setUpdating(false)
    }
  }, [booking, id, statusNote, fetchBooking])

  const saveNotes = useCallback(async () => {
    try {
      await fetch(`/api/restaurant/bookings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ internal_notes: notes }),
      })
    } catch (err) {
      console.error('Failed to save notes:', err)
    }
  }, [id, notes])

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    )
  }

  if (!booking) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Booking not found</p>
        <button
          onClick={() => router.push('/restaurant/bookings')}
          className="mt-4 text-sm text-primary hover:text-primary/80"
        >
          Back to Bookings
        </button>
      </div>
    )
  }

  const json = booking.booking_json as Record<string, string>
  const contact = booking.contact as { id?: string; name?: string; phone?: string; email?: string } | null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push('/restaurant/bookings')}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Booking Details
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground font-mono">
            {booking.id.slice(0, 8)}…
          </p>
        </div>
        <div className="ml-auto">
          <BookingStatusBadge status={booking.status} className="text-sm px-3 py-1" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left column — Booking info */}
        <div className="space-y-6">
          {/* Customer info */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <User className="h-4 w-4 text-primary" />
              Customer Information
            </h3>
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Name</span>
                <span className="text-sm font-medium text-foreground">
                  {json.name || json.guest_name || contact?.name || '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Phone</span>
                <span className="text-sm font-medium text-foreground">
                  {booking.phone || contact?.phone || '—'}
                </span>
              </div>
              {contact?.email && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Email</span>
                  <span className="text-sm font-medium text-foreground">{contact.email}</span>
                </div>
              )}
            </div>
          </div>

          {/* Booking details */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Calendar className="h-4 w-4 text-primary" />
              Booking Information
            </h3>
            <div className="mt-4 space-y-3">
              {Object.entries(json).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground capitalize">
                    {key.replace(/_/g, ' ')}
                  </span>
                  <span className="text-sm font-medium text-foreground">
                    {String(value)}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Created</span>
                <span className="text-sm font-medium text-foreground">
                  {new Date(booking.created_at).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* Internal notes */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <StickyNote className="h-4 w-4 text-primary" />
              Internal Notes
            </h3>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={saveNotes}
              rows={3}
              placeholder="Add internal notes..."
              className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </div>
        </div>

        {/* Right column — Status management + history */}
        <div className="space-y-6">
          {/* Status changer */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <MessageSquare className="h-4 w-4 text-primary" />
              Update Status
            </h3>
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => updateStatus(s)}
                    disabled={booking.status === s || updating}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      booking.status === s
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40'
                    }`}
                  >
                    {BOOKING_STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={statusNote}
                onChange={(e) => setStatusNote(e.target.value)}
                placeholder="Status change note (optional)..."
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Status history */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <History className="h-4 w-4 text-primary" />
              Status History
            </h3>
            {statusLog.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No status changes yet.</p>
            ) : (
              <div className="mt-4 space-y-4">
                {statusLog.map((log) => (
                  <div key={log.id} className="relative pl-6 before:absolute before:left-2 before:top-2 before:h-2 before:w-2 before:rounded-full before:bg-primary">
                    <div className="flex items-center gap-2 text-sm">
                      {log.old_status && (
                        <>
                          <span className="font-medium capitalize text-muted-foreground">
                            {log.old_status}
                          </span>
                          <span className="text-muted-foreground">→</span>
                        </>
                      )}
                      <span className="font-semibold capitalize text-foreground">
                        {log.new_status}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(log.created_at).toLocaleString()}
                      {log.changed_by_profile?.full_name && ` by ${log.changed_by_profile.full_name}`}
                    </p>
                    {log.note && (
                      <p className="mt-1 text-xs text-muted-foreground italic">"{log.note}"</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

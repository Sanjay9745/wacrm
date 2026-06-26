'use client'

import { cn } from '@/lib/utils'
import type { BookingStatus } from '@/types/restaurant'
import { BOOKING_STATUS_COLORS, BOOKING_STATUS_LABELS } from '@/types/restaurant'

interface BookingStatusBadgeProps {
  status: BookingStatus
  className?: string
}

export function BookingStatusBadge({ status, className }: BookingStatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        BOOKING_STATUS_COLORS[status] ?? 'bg-muted text-muted-foreground border-border',
        className,
      )}
    >
      {BOOKING_STATUS_LABELS[status] ?? status}
    </span>
  )
}

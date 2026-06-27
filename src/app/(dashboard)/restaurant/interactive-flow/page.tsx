'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Edit2, Trash2, Save, Eye, EyeOff, Clock } from 'lucide-react'
import { SortableList } from '@/components/restaurant/sortable-list'
import { FieldFormDialog } from '@/components/restaurant/field-form-dialog'
import { WhatsAppPreview } from '@/components/restaurant/whatsapp-preview'
import { Skeleton } from '@/components/dashboard/skeleton'
import { cn } from '@/lib/utils'
import type {
  RestaurantConfig,
  RestaurantMenuItem,
  RestaurantBookingField,
} from '@/types/restaurant'
import { FIELD_TYPE_LABELS } from '@/types/restaurant'

export default function InteractiveFlowPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState<RestaurantConfig | null>(null)
  const [menuItems, setMenuItems] = useState<RestaurantMenuItem[]>([])
  const [fields, setFields] = useState<RestaurantBookingField[]>([])
  const [keywordsInput, setKeywordsInput] = useState('')

  // Dialog state
  const [fieldDialogOpen, setFieldDialogOpen] = useState(false)
  const [editingField, setEditingField] = useState<Partial<RestaurantBookingField> | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [confRes, menuRes, fieldsRes] = await Promise.all([
        fetch('/api/restaurant/config'),
        fetch('/api/restaurant/menu-items'),
        fetch('/api/restaurant/booking-fields'),
      ])
      const [conf, menu, flds] = await Promise.all([
        confRes.json(),
        menuRes.json(),
        fieldsRes.json(),
      ])
      setConfig(conf.config)
      if (conf.config?.trigger_keywords) {
        setKeywordsInput(conf.config.trigger_keywords.join(', '))
      }
      setMenuItems(menu.items || [])
      setFields(flds.fields || [])
    } catch (err) {
      console.error('Failed to load flow config:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // ===============================
  // Menu Item Actions
  // ===============================
  const toggleMenuItem = async (id: string, current: boolean) => {
    const updated = menuItems.map(i => i.id === id ? { ...i, is_enabled: !current } : i)
    setMenuItems(updated)
    try {
      await fetch('/api/restaurant/menu-items', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: updated }),
      })
    } catch (err) {
      console.error('Failed to toggle menu item', err)
      await fetchData() // Revert on error
    }
  }

  const reorderMenuItems = async (items: RestaurantMenuItem[]) => {
    const updated = items.map((i, idx) => ({ ...i, position: idx }))
    setMenuItems(updated)
    try {
      await fetch('/api/restaurant/menu-items', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: updated }),
      })
    } catch (err) {
      console.error('Failed to reorder menu items', err)
      await fetchData() // Revert
    }
  }

  // ===============================
  // Field Actions
  // ===============================
  const toggleField = async (id: string, current: boolean) => {
    const updated = fields.map(f => f.id === id ? { ...f, is_enabled: !current } : f)
    setFields(updated)
    try {
      await fetch('/api/restaurant/booking-fields', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_enabled: !current }),
      })
    } catch (err) {
      console.error('Failed to toggle field', err)
      await fetchData()
    }
  }

  const deleteField = async (id: string) => {
    if (!confirm('Are you sure you want to delete this field?')) return
    setFields(fields.filter(f => f.id !== id))
    try {
      await fetch(`/api/restaurant/booking-fields?id=${id}`, { method: 'DELETE' })
    } catch (err) {
      console.error('Failed to delete field', err)
      await fetchData()
    }
  }

  const handleSaveField = async (data: Partial<RestaurantBookingField>) => {
    try {
      if (editingField?.id) {
        // Update
        const res = await fetch('/api/restaurant/booking-fields', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...data, id: editingField.id }),
        })
        const updated = await res.json()
        setFields(fields.map(f => f.id === editingField.id ? updated.field : f))
      } else {
        // Create
        const res = await fetch('/api/restaurant/booking-fields', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...data, position: fields.length }),
        })
        const created = await res.json()
        setFields([...fields, created.field])
      }
    } catch (err) {
      console.error('Failed to save field', err)
    }
  }

  const reorderFields = async (items: RestaurantBookingField[]) => {
    const updated = items.map((i, idx) => ({ ...i, position: idx }))
    setFields(updated)
    // Update all positions
    try {
      await Promise.all(
        updated.map(i =>
          fetch('/api/restaurant/booking-fields', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: i.id, position: i.position }),
          })
        )
      )
    } catch (err) {
      console.error('Failed to reorder fields', err)
      await fetchData()
    }
  }

  // ===============================
  // Config Actions
  // ===============================
  const saveConfig = async () => {
    if (!config) return
    setSaving(true)
    try {
      await fetch('/api/restaurant/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      alert('Configuration saved successfully!')
    } catch (err) {
      console.error('Failed to save config', err)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-6rem)] gap-6">
      {/* Left side — Builder */}
      <div className="flex-1 overflow-y-auto pr-2 space-y-8">
        <div>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Interactive Flow Builder
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Design the conversational experience for your customers.
              </p>
            </div>
            <button
              onClick={saveConfig}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>

        {/* Welcome Message Settings */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">Welcome Message</h2>
          <p className="mb-4 text-sm text-muted-foreground">Customize the initial greeting and interactive buttons.</p>
          
          <div className="grid gap-4">
            <div>
              <label className="text-xs font-medium text-foreground">Header</label>
              <input
                type="text"
                value={config?.welcome_header || ''}
                onChange={(e) => setConfig(prev => prev ? { ...prev, welcome_header: e.target.value } : null)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground">Body Text</label>
              <textarea
                value={config?.welcome_body || ''}
                onChange={(e) => setConfig(prev => prev ? { ...prev, welcome_body: e.target.value } : null)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-foreground">Footer</label>
                <input
                  type="text"
                  value={config?.welcome_footer || ''}
                  onChange={(e) => setConfig(prev => prev ? { ...prev, welcome_footer: e.target.value } : null)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground">"View Options" Button Label</label>
                <input
                  type="text"
                  value={config?.welcome_button_label || ''}
                  onChange={(e) => setConfig(prev => prev ? { ...prev, welcome_button_label: e.target.value } : null)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
            
            {/* Welcome Buttons Configuration */}
            <div className="border-t border-border pt-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">Welcome Buttons</h3>
              <p className="text-xs text-muted-foreground mb-3">
                These buttons appear on the welcome message. Customers tap one to start their journey.
              </p>
              
              <div className="space-y-2">
                {/* Book A Table button (always shown) */}
                <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10">
                    <span className="text-xs font-bold text-primary">1</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">Book A Table</p>
                    <p className="text-xs text-muted-foreground">Starts the booking flow</p>
                  </div>
                  <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Always visible</span>
                </div>

                {/* Latest Booking button (togglable) */}
                <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10">
                    <span className="text-xs font-bold text-primary">2</span>
                  </div>
                  <div className="flex-1">
                    <p className={cn("text-sm font-medium", (config?.show_latest_booking ?? true) ? "text-foreground" : "text-muted-foreground line-through")}>
                      Latest Booking
                    </p>
                    <p className="text-xs text-muted-foreground">Shows the customer's most recent booking</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={config?.show_latest_booking ?? true}
                    onChange={(e) => setConfig(prev => prev ? { ...prev, show_latest_booking: e.target.checked } : null)}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary bg-background cursor-pointer"
                  />
                </div>

                {/* View Options button (always shown) */}
                <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10">
                    <span className="text-xs font-bold text-primary">3</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {config?.welcome_button_label || 'View Options'}
                    </p>
                    <p className="text-xs text-muted-foreground">Opens the main menu</p>
                  </div>
                  <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Always visible</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Menu Options */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">Main Menu Options</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Control which services are available in the WhatsApp list menu. Drag to reorder.
          </p>
          
          <SortableList
            items={menuItems}
            onReorder={reorderMenuItems}
            renderItem={(item) => (
              <>
                <div className="flex-1">
                  <p className={cn("text-sm font-medium", !item.is_enabled && "text-muted-foreground line-through")}>
                    {item.title}
                  </p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
                <button
                  onClick={() => toggleMenuItem(item.id, item.is_enabled)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                    item.is_enabled
                      ? "bg-primary/10 text-primary hover:bg-primary/20"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  {item.is_enabled ? 'Enabled' : 'Disabled'}
                </button>
              </>
            )}
          />
        </div>

        {/* Booking Fields Configurator */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground">Booking Flow Fields</h2>
              <p className="text-sm text-muted-foreground">
                Define the questions asked when a customer books a table. Drag to reorder.
              </p>
            </div>
            <button
              onClick={() => {
                setEditingField(null)
                setFieldDialogOpen(true)
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/20"
            >
              <Plus className="h-4 w-4" />
              Add Field
            </button>
          </div>
          
          {fields.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-8 text-center">
              <p className="text-sm text-muted-foreground">No booking fields defined.</p>
            </div>
          ) : (
            <SortableList
              items={fields}
              onReorder={reorderFields}
              renderItem={(field) => (
                <>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className={cn("text-sm font-medium", !field.is_enabled && "text-muted-foreground line-through")}>
                        {field.field_label}
                      </p>
                      {field.is_required && (
                        <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                          Required
                        </span>
                      )}
                      <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground capitalize">
                        {FIELD_TYPE_LABELS[field.field_type]}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">Key: {field.field_name}</p>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleField(field.id, field.is_enabled)}
                      className="p-1.5 text-muted-foreground hover:text-foreground"
                      title={field.is_enabled ? 'Disable' : 'Enable'}
                    >
                      {field.is_enabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => {
                        setEditingField(field)
                        setFieldDialogOpen(true)
                      }}
                      className="p-1.5 text-muted-foreground hover:text-primary"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => deleteField(field.id)}
                      className="p-1.5 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </>
              )}
            />
          )}
        </div>

        {/* Booking Date & Time Restrictions */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-foreground">Booking Date & Time Restrictions</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Control when customers can book — time windows, date ranges, and today-booking rules.
            </p>
          </div>

          {/* Time Window */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-foreground">Booking From</label>
              <div className="relative mt-1">
                <Clock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={config?.booking_time_from || '11:00 AM'}
                  onChange={(e) => setConfig(prev => prev ? { ...prev, booking_time_from: e.target.value } : null)}
                  placeholder="11:00 AM"
                  className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Earliest bookable time (e.g. 11:00 AM)</p>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground">Booking To</label>
              <div className="relative mt-1">
                <Clock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={config?.booking_time_to || '9:00 PM'}
                  onChange={(e) => setConfig(prev => prev ? { ...prev, booking_time_to: e.target.value } : null)}
                  placeholder="9:00 PM"
                  className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Latest bookable time (e.g. 9:00 PM)</p>
            </div>
          </div>

          {/* Buffer + Date Range */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-foreground">Buffer Time (minutes)</label>
              <input
                type="number"
                min={0}
                max={1440}
                value={config?.booking_time_buffer_minutes ?? 60}
                onChange={(e) => setConfig(prev => prev ? { ...prev, booking_time_buffer_minutes: parseInt(e.target.value) || 0 } : null)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-muted-foreground">Minimum minutes from now for today's bookings</p>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground">Date Range (days)</label>
              <input
                type="number"
                min={1}
                max={365}
                value={config?.booking_date_range_days ?? 30}
                onChange={(e) => setConfig(prev => prev ? { ...prev, booking_date_range_days: parseInt(e.target.value) || 1 } : null)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-muted-foreground">How many days ahead customers can book</p>
            </div>
          </div>

          {/* Block Today Booking */}
          <div className="border-t border-border pt-4 space-y-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="block_today_booking"
                checked={config?.block_today_booking ?? false}
                onChange={(e) => setConfig(prev => {
                  if (!prev) return null
                  return {
                    ...prev,
                    block_today_booking: e.target.checked,
                    block_today_timestamp: e.target.checked ? new Date().toISOString() : null
                  }
                })}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary bg-background cursor-pointer"
              />
              <label htmlFor="block_today_booking" className="text-sm font-medium text-foreground cursor-pointer">
                Block bookings for today
              </label>
            </div>

            {(config?.block_today_booking) && (
              <div>
                <label className="text-xs font-medium text-foreground">Block Today Message</label>
                <textarea
                  value={config?.block_today_message || ''}
                  onChange={(e) => setConfig(prev => prev ? { ...prev, block_today_message: e.target.value } : null)}
                  rows={2}
                  placeholder="Sorry, we are not accepting bookings for today."
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                />
                <p className="mt-1 text-xs text-muted-foreground">Message shown when customers try to book for today</p>
              </div>
            )}
          </div>
        </div>

        {/* Confirmation Message */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Confirmation Message</h2>
            <p className="mb-2 text-sm text-muted-foreground">Sent after customer completes the flow.</p>
            <textarea
              value={config?.confirmation_template || ''}
              onChange={(e) => setConfig(prev => prev ? { ...prev, confirmation_template: e.target.value } : null)}
              rows={3}
              placeholder="Thank you for booking..."
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </div>

          <div className="border-t border-border pt-4 grid gap-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Restart Session Option</h3>
              <p className="mb-2 text-xs text-muted-foreground">Interactive prompt sent after booking completes to allow restarting the conversation.</p>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground">Restart Prompt Message</label>
              <textarea
                value={config?.restart_message || ''}
                onChange={(e) => setConfig(prev => prev ? { ...prev, restart_message: e.target.value } : null)}
                rows={2}
                placeholder="Click below to start over."
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground">Restart Button Label</label>
              <input
                type="text"
                value={config?.restart_button_label || ''}
                onChange={(e) => setConfig(prev => prev ? { ...prev, restart_button_label: e.target.value } : null)}
                placeholder="Restart Session"
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
        </div>

        {/* Trigger Keywords */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Trigger Keywords</h2>
            <p className="mb-2 text-sm text-muted-foreground">Keywords that start this flow when a customer sends a message.</p>
            <input
              type="text"
              value={keywordsInput}
              onChange={(e) => {
                const val = e.target.value
                setKeywordsInput(val)
                const kw = val.split(',').map(s => s.trim()).filter(Boolean)
                setConfig(prev => prev ? { ...prev, trigger_keywords: kw } : null)
              }}
              placeholder="e.g. book, table, reservation, menu"
              disabled={config?.start_on_any_message ?? false}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
            <p className="mt-1 text-xs text-muted-foreground">Comma-separated list.</p>
          </div>

          <div className="flex items-center gap-2 border-t border-border pt-4">
            <input
              type="checkbox"
              id="start_on_any_message"
              checked={config?.start_on_any_message ?? false}
              onChange={(e) => setConfig(prev => prev ? { ...prev, start_on_any_message: e.target.checked } : null)}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary bg-background cursor-pointer"
            />
            <label htmlFor="start_on_any_message" className="text-sm font-medium text-foreground cursor-pointer">
              Start conversation when any message comes (ignores keywords)
            </label>
          </div>
        </div>
      </div>

      {/* Right side — Preview */}
      <div className="hidden w-[340px] shrink-0 lg:block xl:w-[400px]">
        <div className="sticky top-6 h-full pb-6">
          <WhatsAppPreview
            config={config}
            menuItems={menuItems}
            fields={fields}
          />
        </div>
      </div>

      <FieldFormDialog
        open={fieldDialogOpen}
        onOpenChange={setFieldDialogOpen}
        initialData={editingField}
        onSave={handleSaveField}
      />
    </div>
  )
}

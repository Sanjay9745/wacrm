'use client'

import { useCallback, useEffect, useState } from 'react'
import { Save, Link as LinkIcon, Image as ImageIcon, FileText, Smartphone } from 'lucide-react'
import { Skeleton } from '@/components/dashboard/skeleton'
import type { RestaurantMenuConfig } from '@/types/restaurant'
import { cn } from '@/lib/utils'

const MENU_TYPES = [
  { value: 'website_url', label: 'Website Link', icon: LinkIcon, placeholder: 'https://your-restaurant.com/menu' },
  { value: 'pdf', label: 'PDF Link', icon: FileText, placeholder: 'https://example.com/menu.pdf' },
  { value: 'image', label: 'Image Link', icon: ImageIcon, placeholder: 'https://example.com/menu.jpg' },
  { value: 'whatsapp_catalog', label: 'WhatsApp Catalog', icon: Smartphone, placeholder: 'WhatsApp Catalog ID (Optional)' },
]

export default function MenuConfigPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState<Partial<RestaurantMenuConfig>>({
    menu_type: 'website_url',
    menu_value: '',
    is_active: true,
  })

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/restaurant/menu-config')
      const data = await res.json()
      if (data.config) {
        setConfig(data.config)
      }
    } catch (err) {
      console.error('Failed to fetch menu config', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchConfig() }, [fetchConfig])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/restaurant/menu-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const data = await res.json()
      if (data.config) setConfig(data.config)
      alert('Menu configuration saved successfully!')
    } catch (err) {
      console.error('Failed to save config', err)
    } finally {
      setSaving(false)
    }
  }

  const selectedType = MENU_TYPES.find(t => t.value === config.menu_type) || MENU_TYPES[0]

  if (loading) {
    return (
      <div className="max-w-2xl space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Menu Configuration</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure how customers view your menu through WhatsApp.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? 'Saving...' : 'Save Config'}
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_active"
              checked={config.is_active}
              onChange={(e) => setConfig({ ...config, is_active: e.target.checked })}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
            <label htmlFor="is_active" className="text-sm font-medium text-foreground">
              Enable "Our Menu" option in WhatsApp flow
            </label>
          </div>

          <div className="space-y-4">
            <label className="block text-sm font-medium text-foreground">Menu Format</label>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {MENU_TYPES.map((type) => {
                const isSelected = config.menu_type === type.value
                return (
                  <button
                    key={type.value}
                    onClick={() => setConfig({ ...config, menu_type: type.value as any })}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors",
                      isSelected
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border bg-card text-muted-foreground hover:bg-muted"
                    )}
                  >
                    <type.icon className="h-6 w-6" />
                    <span className="text-xs font-medium">{type.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {selectedType.label} Value
            </label>
            <input
              type="text"
              value={config.menu_value || ''}
              onChange={(e) => setConfig({ ...config, menu_value: e.target.value })}
              placeholder={selectedType.placeholder}
              className="w-full rounded-lg border border-border bg-background px-4 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="text-xs text-muted-foreground">
              {config.menu_type === 'whatsapp_catalog'
                ? "If left blank, it will automatically link to your business account's default catalog."
                : "Enter the full URL including https://"}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

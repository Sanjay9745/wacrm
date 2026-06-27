'use client'

import { useEffect, useState } from 'react'
import { Database, AlertTriangle, Smartphone, RefreshCw } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/dashboard/skeleton'

export default function RestaurantSettingsPage() {
  const [loading, setLoading] = useState(true)
  const [isEnabled, setIsEnabled] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [seedingConfig, setSeedingConfig] = useState(false)
  const [linkedAutomationId, setLinkedAutomationId] = useState<string | null>(null)
  const [seedCount, setSeedCount] = useState(500)
  const [seedResult, setSeedResult] = useState<{ count?: number, errors?: string[] } | null>(null)

  useEffect(() => {
    async function loadConfig() {
      try {
        const res = await fetch('/api/restaurant/config')
        const data = await res.json()
        if (data.config) {
          setIsEnabled(data.config.is_enabled)
          setLinkedAutomationId(data.config.linked_automation_id ?? null)
        }
      } catch (err) {
        console.error('Failed to load restaurant config:', err)
      } finally {
        setLoading(false)
      }
    }
    loadConfig()
  }, [])

  const handleToggleFlow = async (checked: boolean) => {
    setToggling(true)
    setIsEnabled(checked)
    try {
      // If toggling OFF and there's a linked automation, ask to disable it
      if (!checked && linkedAutomationId) {
        const disableAuto = confirm(
          'Do you also want to disable the linked Restaurant Booking automation?'
        )
        if (disableAuto) {
          await fetch(`/api/automations/${linkedAutomationId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: false }),
          })
        }
      }

      // If toggling ON and there's a linked automation, re-enable it
      if (checked && linkedAutomationId) {
        await fetch(`/api/automations/${linkedAutomationId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_active: true }),
        })
      }

      const res = await fetch('/api/restaurant/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_enabled: checked }),
      })
      const data = await res.json()
      if (data.error) {
        setIsEnabled(!checked)
        alert(`Failed to update status: ${data.error}`)
      }
    } catch (err) {
      console.error('Failed to update restaurant flow status:', err)
      setIsEnabled(!checked)
      alert('Failed to update status. Please try again.')
    } finally {
      setToggling(false)
    }
  }

  const handleSeedConfig = async () => {
    if (!confirm('This will delete and replace your existing restaurant menu items, booking fields, FAQs, and delivery platforms with default values. Are you sure you want to continue?')) {
      return
    }

    setSeedingConfig(true)
    try {
      const res = await fetch('/api/restaurant/seed-config', {
        method: 'POST',
      })
      const data = await res.json()
      if (data.success) {
        alert('Successfully set up the default restaurant flow configuration. The module is now ON and ready to use.')
        setIsEnabled(true)
        if (data.automationId) setLinkedAutomationId(data.automationId)
      } else {
        alert(`Failed to set up configuration: ${data.error}`)
      }
    } catch (err) {
      console.error('Failed to seed config', err)
      alert('Network error occurred while setting up configuration.')
    } finally {
      setSeedingConfig(false)
    }
  }

  const handleSeed = async () => {
    if (!confirm(`Are you sure you want to generate ${seedCount} dummy bookings? This is for testing purposes only.`)) {
      return
    }

    setSeeding(true)
    setSeedResult(null)
    try {
      const res = await fetch('/api/restaurant/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: seedCount }),
      })
      const data = await res.json()
      setSeedResult(data)
      if (data.count) {
        alert(`Successfully generated ${data.count} bookings.`)
      }
    } catch (err) {
      console.error('Failed to seed bookings', err)
      setSeedResult({ errors: ['Network error occurred while seeding.'] })
    } finally {
      setSeeding(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Restaurant Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Advanced configuration and data management.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    )
  }

  const isProduction = process.env.NODE_ENV === 'production'

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Restaurant Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Advanced configuration and data management.
        </p>
      </div>

      {/* WhatsApp Chatbot Status Toggle */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Smartphone className="h-5 w-5 text-primary" />
              WhatsApp Interactive Flow
            </h2>
            <p className="text-sm text-muted-foreground">
              Turn the WhatsApp restaurant welcome menu, reservation chatbot, and interactive flows on or off.
            </p>
          </div>
          <Switch
            checked={isEnabled}
            onCheckedChange={handleToggleFlow}
            disabled={toggling}
          />
        </div>
      </div>


      {!isProduction && (
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            Data Generation (Development & Testing)
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Generate realistic sample bookings to test the dashboard, pagination, and exports. 
            The data will include randomized names, phone numbers, and booking times.
          </p>

          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="w-full sm:w-48">
              <label className="mb-1 block text-sm font-medium text-foreground">Number of Bookings</label>
              <input
                type="number"
                min={10}
                max={2000}
                value={seedCount}
                onChange={(e) => setSeedCount(parseInt(e.target.value) || 500)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Database className="h-4 w-4" />
              {seeding ? 'Generating...' : `Seed ${seedCount} Bookings`}
            </button>
          </div>

          {seedResult?.errors && seedResult.errors.length > 0 && (
            <div className="mt-4 rounded-lg bg-destructive/10 p-4">
              <h3 className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" />
                Errors occurred during seeding
              </h3>
              <ul className="mt-2 list-inside list-disc text-xs text-destructive/80">
                {seedResult.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

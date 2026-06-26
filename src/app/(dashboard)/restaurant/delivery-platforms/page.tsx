'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Edit2, Trash2, Link as LinkIcon, Eye, EyeOff } from 'lucide-react'
import { SortableList } from '@/components/restaurant/sortable-list'
import { Skeleton } from '@/components/dashboard/skeleton'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import type { RestaurantDeliveryPlatform } from '@/types/restaurant'

export default function DeliveryPlatformsPage() {
  const [loading, setLoading] = useState(true)
  const [platforms, setPlatforms] = useState<RestaurantDeliveryPlatform[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingPlatform, setEditingPlatform] = useState<Partial<RestaurantDeliveryPlatform> | null>(null)
  const [formData, setFormData] = useState({ name: '', url: '', is_enabled: true })

  const fetchPlatforms = useCallback(async () => {
    try {
      const res = await fetch('/api/restaurant/delivery-platforms')
      const data = await res.json()
      setPlatforms(data.platforms || [])
    } catch (err) {
      console.error('Failed to load platforms:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchPlatforms() }, [fetchPlatforms])

  const handleOpenDialog = (platform?: RestaurantDeliveryPlatform) => {
    if (platform) {
      setEditingPlatform(platform)
      setFormData({ name: platform.name, url: platform.url || '', is_enabled: platform.is_enabled })
    } else {
      setEditingPlatform(null)
      setFormData({ name: '', url: '', is_enabled: true })
    }
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!formData.name) return
    try {
      if (editingPlatform?.id) {
        const res = await fetch('/api/restaurant/delivery-platforms', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingPlatform.id, ...formData }),
        })
        const data = await res.json()
        setPlatforms(platforms.map(p => p.id === editingPlatform.id ? data.platform : p))
      } else {
        const res = await fetch('/api/restaurant/delivery-platforms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...formData, position: platforms.length }),
        })
        const data = await res.json()
        setPlatforms([...platforms, data.platform])
      }
      setDialogOpen(false)
    } catch (err) {
      console.error('Failed to save platform', err)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this delivery platform?')) return
    try {
      await fetch(`/api/restaurant/delivery-platforms?id=${id}`, { method: 'DELETE' })
      setPlatforms(platforms.filter(p => p.id !== id))
    } catch (err) {
      console.error('Failed to delete platform', err)
    }
  }

  const handleToggle = async (id: string, current: boolean) => {
    const updated = platforms.map(p => p.id === id ? { ...p, is_enabled: !current } : p)
    setPlatforms(updated)
    try {
      await fetch('/api/restaurant/delivery-platforms', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_enabled: !current }),
      })
    } catch (err) {
      console.error('Failed to toggle', err)
      await fetchPlatforms()
    }
  }

  const handleReorder = async (items: RestaurantDeliveryPlatform[]) => {
    const updated = items.map((i, idx) => ({ ...i, position: idx }))
    setPlatforms(updated)
    try {
      await Promise.all(
        updated.map(i =>
          fetch('/api/restaurant/delivery-platforms', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: i.id, position: i.position }),
          })
        )
      )
    } catch (err) {
      console.error('Failed to reorder', err)
      await fetchPlatforms()
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Delivery Platforms</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your external food delivery links (Swiggy, Zomato, etc.)
          </p>
        </div>
        <button
          onClick={() => handleOpenDialog()}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Platform
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : platforms.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No delivery platforms added yet.
          </div>
        ) : (
          <SortableList
            items={platforms}
            onReorder={handleReorder}
            renderItem={(platform) => (
              <>
                <div className="flex-1">
                  <p className={cn("text-sm font-medium", !platform.is_enabled && "text-muted-foreground line-through")}>
                    {platform.name}
                  </p>
                  {platform.url && (
                    <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                      <LinkIcon className="h-3 w-3" />
                      <a href={platform.url} target="_blank" rel="noreferrer" className="hover:underline hover:text-primary">
                        {platform.url}
                      </a>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggle(platform.id, platform.is_enabled)}
                    className="p-1.5 text-muted-foreground hover:text-foreground"
                  >
                    {platform.is_enabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => handleOpenDialog(platform)}
                    className="p-1.5 text-muted-foreground hover:text-primary"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(platform.id)}
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPlatform ? 'Edit Platform' : 'Add Platform'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Platform Name *</label>
              <input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Swiggy"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">URL</label>
              <input
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                placeholder="https://..."
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_enabled"
                checked={formData.is_enabled}
                onChange={(e) => setFormData({ ...formData, is_enabled: e.target.checked })}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              />
              <label htmlFor="is_enabled" className="text-sm text-foreground">Enabled</label>
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={() => setDialogOpen(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!formData.name}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Edit2, Trash2, Eye, EyeOff } from 'lucide-react'
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
import type { RestaurantFaq } from '@/types/restaurant'

export default function FAQsPage() {
  const [loading, setLoading] = useState(true)
  const [faqs, setFaqs] = useState<RestaurantFaq[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingFaq, setEditingFaq] = useState<Partial<RestaurantFaq> | null>(null)
  const [formData, setFormData] = useState({ question: '', answer: '', is_enabled: true })

  const fetchFaqs = useCallback(async () => {
    try {
      const res = await fetch('/api/restaurant/faqs')
      const data = await res.json()
      setFaqs(data.faqs || [])
    } catch (err) {
      console.error('Failed to load faqs:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchFaqs() }, [fetchFaqs])

  const handleOpenDialog = (faq?: RestaurantFaq) => {
    if (faq) {
      setEditingFaq(faq)
      setFormData({ question: faq.question, answer: faq.answer, is_enabled: faq.is_enabled })
    } else {
      setEditingFaq(null)
      setFormData({ question: '', answer: '', is_enabled: true })
    }
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!formData.question || !formData.answer) return
    try {
      if (editingFaq?.id) {
        const res = await fetch('/api/restaurant/faqs', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingFaq.id, ...formData }),
        })
        const data = await res.json()
        setFaqs(faqs.map(f => f.id === editingFaq.id ? data.faq : f))
      } else {
        const res = await fetch('/api/restaurant/faqs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...formData, position: faqs.length }),
        })
        const data = await res.json()
        setFaqs([...faqs, data.faq])
      }
      setDialogOpen(false)
    } catch (err) {
      console.error('Failed to save faq', err)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this FAQ?')) return
    try {
      await fetch(`/api/restaurant/faqs?id=${id}`, { method: 'DELETE' })
      setFaqs(faqs.filter(f => f.id !== id))
    } catch (err) {
      console.error('Failed to delete faq', err)
    }
  }

  const handleToggle = async (id: string, current: boolean) => {
    const updated = faqs.map(f => f.id === id ? { ...f, is_enabled: !current } : f)
    setFaqs(updated)
    try {
      await fetch('/api/restaurant/faqs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_enabled: !current }),
      })
    } catch (err) {
      console.error('Failed to toggle', err)
      await fetchFaqs()
    }
  }

  const handleReorder = async (items: RestaurantFaq[]) => {
    const updated = items.map((i, idx) => ({ ...i, position: idx }))
    setFaqs(updated)
    try {
      await Promise.all(
        updated.map(i =>
          fetch('/api/restaurant/faqs', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: i.id, position: i.position }),
          })
        )
      )
    } catch (err) {
      console.error('Failed to reorder', err)
      await fetchFaqs()
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Frequently Asked Questions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage the automated answers for your WhatsApp FAQ menu.
          </p>
        </div>
        <button
          onClick={() => handleOpenDialog()}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add FAQ
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : faqs.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No FAQs added yet.
          </div>
        ) : (
          <SortableList
            items={faqs}
            onReorder={handleReorder}
            renderItem={(faq) => (
              <>
                <div className="flex-1">
                  <p className={cn("text-sm font-medium", !faq.is_enabled && "text-muted-foreground line-through")}>
                    {faq.question}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">
                    {faq.answer}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggle(faq.id, faq.is_enabled)}
                    className="p-1.5 text-muted-foreground hover:text-foreground"
                  >
                    {faq.is_enabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => handleOpenDialog(faq)}
                    className="p-1.5 text-muted-foreground hover:text-primary"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(faq.id)}
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
            <DialogTitle>{editingFaq ? 'Edit FAQ' : 'Add FAQ'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Question *</label>
              <input
                value={formData.question}
                onChange={(e) => setFormData({ ...formData, question: e.target.value })}
                placeholder="e.g. What are your hours?"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Answer *</label>
              <textarea
                value={formData.answer}
                onChange={(e) => setFormData({ ...formData, answer: e.target.value })}
                rows={4}
                placeholder="e.g. We are open from 11 AM to 11 PM every day."
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none resize-none"
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
              disabled={!formData.question || !formData.answer}
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

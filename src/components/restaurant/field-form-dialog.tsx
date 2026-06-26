'use client'

import { useState, useEffect } from 'react'
import { Plus, X, Trash2, GripVertical } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'
import type { BookingFieldType, RestaurantBookingField } from '@/types/restaurant'
import { FIELD_TYPE_LABELS, INTERACTIVE_FIELD_TYPES } from '@/types/restaurant'

interface FieldFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialData?: Partial<RestaurantBookingField> | null
  onSave: (data: Partial<RestaurantBookingField>) => Promise<void>
}

export function FieldFormDialog({
  open,
  onOpenChange,
  initialData,
  onSave,
}: FieldFormDialogProps) {
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState<Partial<RestaurantBookingField>>({
    field_name: '',
    field_label: '',
    field_type: 'text',
    options: [],
    is_required: false,
    placeholder: '',
    validation_regex: '',
    is_enabled: true,
  })

  useEffect(() => {
    if (open) {
      if (initialData) {
        setFormData({
          ...initialData,
          options: Array.isArray(initialData.options) ? [...initialData.options] : [],
        })
      } else {
        setFormData({
          field_name: '',
          field_label: '',
          field_type: 'text',
          options: [],
          is_required: false,
          placeholder: '',
          validation_regex: '',
          is_enabled: true,
        })
      }
    }
  }, [open, initialData])

  const isInteractive = INTERACTIVE_FIELD_TYPES.has(formData.field_type as BookingFieldType)

  const handleSave = async () => {
    if (!formData.field_name || !formData.field_label || !formData.field_type) return
    setLoading(true)
    try {
      await onSave({
        ...formData,
        // Auto-format field name: lowercase, replace spaces with underscores
        field_name: formData.field_name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
      })
      onOpenChange(false)
    } finally {
      setLoading(false)
    }
  }

  const addOption = () => {
    setFormData((prev) => ({
      ...prev,
      options: [...(prev.options || []), `Option ${(prev.options?.length || 0) + 1}`],
    }))
  }

  const updateOption = (index: number, value: string) => {
    setFormData((prev) => {
      const opts = [...(prev.options || [])]
      opts[index] = value
      return { ...prev, options: opts }
    })
  }

  const removeOption = (index: number) => {
    setFormData((prev) => {
      const opts = [...(prev.options || [])]
      opts.splice(index, 1)
      return { ...prev, options: opts }
    })
  }

  // Drag and drop for options
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (event: any) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setFormData((prev) => {
        const opts = [...(prev.options || [])]
        const oldIndex = opts.findIndex((_, i) => `opt-${i}` === active.id)
        const newIndex = opts.findIndex((_, i) => `opt-${i}` === over.id)
        return { ...prev, options: arrayMove(opts, oldIndex, newIndex) }
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialData ? 'Edit Field' : 'Add Booking Field'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Field Label *</label>
              <input
                value={formData.field_label}
                onChange={(e) => {
                  const label = e.target.value
                  setFormData((prev) => ({
                    ...prev,
                    field_label: label,
                    // Auto-generate key if creating new
                    ...(!initialData && {
                      field_name: label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
                    }),
                  }))
                }}
                placeholder="e.g. Number of Guests"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Data Key *</label>
              <input
                value={formData.field_name}
                onChange={(e) => setFormData({ ...formData, field_name: e.target.value })}
                placeholder="e.g. guests"
                className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground focus:outline-none font-mono"
              />
              <p className="text-[10px] text-muted-foreground">Used internally in booking JSON</p>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-foreground">Field Type *</label>
            <select
              value={formData.field_type}
              onChange={(e) => setFormData({ ...formData, field_type: e.target.value as BookingFieldType })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {Object.entries(FIELD_TYPE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Required Field</p>
              <p className="text-xs text-muted-foreground">Customer must provide an answer</p>
            </div>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, is_required: !formData.is_required })}
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
                formData.is_required ? 'bg-primary' : 'bg-muted'
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                  formData.is_required ? 'translate-x-2' : '-translate-x-2'
                )}
              />
            </button>
          </div>

          {isInteractive ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-foreground">Options (max 10 for WhatsApp List)</label>
                <button
                  onClick={addOption}
                  type="button"
                  className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
                >
                  <Plus className="h-3 w-3" /> Add Option
                </button>
              </div>

              {(!formData.options || formData.options.length === 0) ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  No options added yet.
                </div>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={formData.options.map((_, i) => `opt-${i}`)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2">
                      {formData.options.map((opt, i) => (
                        <SortableOptionItem
                          key={`opt-${i}`}
                          id={`opt-${i}`}
                          value={opt}
                          index={i}
                          onChange={updateOption}
                          onRemove={removeOption}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Placeholder Message</label>
                <input
                  value={formData.placeholder || ''}
                  onChange={(e) => setFormData({ ...formData, placeholder: e.target.value })}
                  placeholder="e.g. Please enter your name"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Validation Regex (Optional)</label>
                <input
                  value={formData.validation_regex || ''}
                  onChange={(e) => setFormData({ ...formData, validation_regex: e.target.value })}
                  placeholder="e.g. ^\d{10}$ for 10-digit phone"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading || !formData.field_name || !formData.field_label}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Save Field'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SortableOptionItem({
  id,
  value,
  index,
  onChange,
  onRemove,
}: {
  id: string
  value: string
  index: number
  onChange: (i: number, val: string) => void
  onRemove: (i: number) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2",
        isDragging && "z-10 opacity-50"
      )}
    >
      <button
        type="button"
        className="cursor-grab p-1 text-muted-foreground hover:text-foreground touch-none"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <input
        value={value}
        onChange={(e) => onChange(index, e.target.value)}
        className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
      />
      <button
        type="button"
        onClick={() => onRemove(index)}
        className="p-1.5 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Save, Link as LinkIcon, Image as ImageIcon, FileText, Smartphone, Upload, X, CheckCircle2 } from 'lucide-react'
import { Skeleton } from '@/components/dashboard/skeleton'
import type { RestaurantMenuConfig } from '@/types/restaurant'
import { cn } from '@/lib/utils'
import { uploadAccountMedia, MEDIA_MAX_BYTES_BY_KIND } from '@/lib/storage/upload-media'

const MENU_TYPES = [
  { value: 'website_url', label: 'Website Link', icon: LinkIcon, placeholder: 'https://your-restaurant.com/menu' },
  { value: 'pdf', label: 'PDF', icon: FileText, placeholder: 'Upload a PDF file' },
  { value: 'image', label: 'Image', icon: ImageIcon, placeholder: 'Upload an image file' },
  { value: 'whatsapp_catalog', label: 'WhatsApp Catalog', icon: Smartphone, placeholder: 'WhatsApp Catalog ID (Optional)' },
]

const MEDIA_TYPE_MAP: Record<string, 'image' | 'document'> = {
  image: 'image',
  pdf: 'document',
}

export default function MenuConfigPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [config, setConfig] = useState<Partial<RestaurantMenuConfig>>({
    menu_type: 'website_url',
    menu_value: '',
    is_active: true,
  })
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const handleFileUpload = async (file: File) => {
    setUploadError('')
    setUploading(true)

    try {
      const kind = config.menu_type === 'image' ? 'image' : 'document'
      const maxBytes = MEDIA_MAX_BYTES_BY_KIND[kind === 'image' ? 'image' : 'document']
      if (file.size > maxBytes) {
        const maxMB = maxBytes / (1024 * 1024)
        throw new Error(`File is too large. Maximum size is ${maxMB} MB.`)
      }

      const { publicUrl } = await uploadAccountMedia('flow-media', file)
      setConfig(prev => ({ ...prev, menu_value: publicUrl }))
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFileUpload(file)
    }
    // Reset input so same file can be re-uploaded
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleClearFile = () => {
    setConfig(prev => ({ ...prev, menu_value: '' }))
  }

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
  const isFileType = config.menu_type === 'image' || config.menu_type === 'pdf'
  const acceptedMime = config.menu_type === 'image' ? 'image/*' : '.pdf'
  const maxFileSize = config.menu_type === 'image'
    ? MEDIA_MAX_BYTES_BY_KIND.image
    : MEDIA_MAX_BYTES_BY_KIND.document

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
            Choose how customers view your menu through WhatsApp.
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
                    onClick={() => setConfig({ ...config, menu_type: type.value as any, menu_value: '' })}
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
              {isFileType ? `Upload ${selectedType.label}` : `${selectedType.label} Value`}
            </label>

            {isFileType ? (
              <div className="space-y-3">
                {/* File upload area */}
                {!config.menu_value ? (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault()
                      const file = e.dataTransfer.files[0]
                      if (file) handleFileUpload(file)
                    }}
                    className={cn(
                      "flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
                      uploading ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/50"
                    )}
                  >
                    <Upload className={cn("h-8 w-8", uploading ? "text-primary animate-pulse" : "text-muted-foreground")} />
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {uploading ? 'Uploading...' : `Click to upload ${selectedType.label.toLowerCase()}`}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {config.menu_type === 'image' ? 'PNG, JPEG, WebP' : 'PDF'} — max {Math.round(maxFileSize / (1024 * 1024))} MB
                      </p>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={acceptedMime}
                      onChange={handleFileChange}
                      className="hidden"
                      disabled={uploading}
                    />
                  </div>
                ) : (
                  /* Uploaded file card */
                  <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      {config.menu_type === 'image' ? (
                        // Show a small thumbnail for images
                        <img
                          src={config.menu_value}
                          alt="Menu"
                          className="h-10 w-10 rounded-lg object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none'
                            ;(e.target as HTMLImageElement).parentElement!.innerHTML = '<svg class="h-5 w-5 text-primary" ...>'
                          }}
                        />
                      ) : (
                        <FileText className="h-5 w-5 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                        <p className="text-sm font-medium text-foreground truncate">
                          {config.menu_type === 'image' ? 'Menu Image' : 'Menu PDF'}
                        </p>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground truncate">{config.menu_value}</p>
                    </div>
                    <button
                      onClick={handleClearFile}
                      className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                      title="Remove file"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}

                {uploadError && (
                  <p className="text-xs font-medium text-red-500">{uploadError}</p>
                )}

                <p className="text-xs text-muted-foreground">
                  {config.menu_type === 'image'
                    ? 'The image will be sent inline in the WhatsApp chat when a customer taps "Our Menu".'
                    : 'The PDF will be sent as a downloadable document in WhatsApp when a customer taps "Our Menu".'}
                </p>
              </div>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

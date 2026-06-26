'use client'

import { MessageSquare, List, GripHorizontal } from 'lucide-react'
import type {
  RestaurantBookingField,
  RestaurantConfig,
  RestaurantMenuItem,
} from '@/types/restaurant'
import { INTERACTIVE_FIELD_TYPES } from '@/types/restaurant'

interface WhatsAppPreviewProps {
  config: RestaurantConfig | null
  menuItems: RestaurantMenuItem[]
  fields: RestaurantBookingField[]
}

export function WhatsAppPreview({ config, menuItems, fields }: WhatsAppPreviewProps) {
  // Generates a preview of the conversational flow
  const enabledMenuItems = menuItems.filter((i) => i.is_enabled)
  const enabledFields = fields.filter((f) => f.is_enabled)

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[2rem] border-4 border-border bg-[#efeae2]">
      {/* Phone Header */}
      <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
          <MessageSquare className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-medium leading-none">Restaurant Bot</h3>
          <p className="mt-1 text-[10px] text-white/80">Active</p>
        </div>
      </div>

      {/* Chat History */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Customer Trigger */}
        <div className="flex justify-end">
          <div className="rounded-lg rounded-tr-none bg-[#dcf8c6] p-2 px-3 text-[13px] shadow-sm text-[#111]">
            {config?.trigger_keywords?.[0] || 'book table'}
          </div>
        </div>

        {/* Welcome Message (Interactive Buttons) */}
        <div className="flex justify-start">
          <div className="max-w-[85%] rounded-lg rounded-tl-none bg-white shadow-sm overflow-hidden text-[#111]">
            <div className="p-2 px-3 text-[13px]">
              <span className="font-bold text-[14px]">
                {config?.welcome_header || 'Welcome'}
              </span>
              <br />
              <div className="mt-1 whitespace-pre-wrap">
                {config?.welcome_body || 'Please choose an option'}
              </div>
              {config?.welcome_footer && (
                <div className="mt-2 text-[11px] text-gray-500">
                  {config.welcome_footer}
                </div>
              )}
            </div>
            <div className="border-t border-gray-100 p-2 text-center text-[13px] font-medium text-[#00a884] active:bg-gray-50">
              {config?.welcome_button_label || 'View Options'}
            </div>
          </div>
        </div>

        {/* Customer Taps View Options */}
        <div className="flex justify-end">
          <div className="rounded-lg rounded-tr-none bg-[#dcf8c6] p-2 px-3 text-[13px] shadow-sm text-[#111]">
            {config?.welcome_button_label || 'View Options'}
          </div>
        </div>

        {/* Main Menu (Interactive List) */}
        <div className="flex justify-start">
          <div className="max-w-[85%] rounded-lg rounded-tl-none bg-white shadow-sm text-[#111] overflow-hidden">
            <div className="p-2 px-3 text-[13px]">
              Please choose an option from the menu below:
            </div>
            <div className="border-t border-gray-100 p-2 flex items-center justify-center gap-2 text-[13px] font-medium text-[#00a884]">
              <List className="h-4 w-4" />
              Our Services
            </div>
            {/* Simulated list popup */}
            <div className="bg-gray-50 p-2 border-t border-gray-100">
              <p className="text-[11px] font-medium text-gray-500 mb-1 px-1">What would you like to do?</p>
              {enabledMenuItems.length > 0 ? (
                enabledMenuItems.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 hover:bg-gray-200 rounded border-b border-gray-200/50 last:border-0">
                    <div>
                      <p className="text-[13px] font-medium">{item.title}</p>
                      {item.description && <p className="text-[11px] text-gray-500">{item.description}</p>}
                    </div>
                    <div className="h-3 w-3 rounded-full border border-gray-300" />
                  </div>
                ))
              ) : (
                <div className="p-2 text-[11px] text-gray-400">No items configured</div>
              )}
            </div>
          </div>
        </div>

        {/* Customer Selects Book Table */}
        {enabledMenuItems.some(i => i.action_type === 'book_table') && (
          <>
            <div className="flex justify-end">
              <div className="rounded-lg rounded-tr-none bg-[#dcf8c6] p-2 px-3 text-[13px] shadow-sm text-[#111]">
                Book a Table
              </div>
            </div>

            {/* Field Prompts */}
            {enabledFields.slice(0, 2).map((field, idx) => (
              <div key={idx} className="flex justify-start">
                <div className="max-w-[85%] rounded-lg rounded-tl-none bg-white shadow-sm text-[#111]">
                  {INTERACTIVE_FIELD_TYPES.has(field.field_type) ? (
                    <div className="overflow-hidden">
                      <div className="p-2 px-3 text-[13px]">
                        Please select your {field.field_label}:
                      </div>
                      <div className="border-t border-gray-100 p-2 flex items-center justify-center gap-2 text-[13px] font-medium text-[#00a884]">
                        <List className="h-4 w-4" /> Choose {field.field_label}
                      </div>
                    </div>
                  ) : (
                    <div className="p-2 px-3 text-[13px]">
                      Please enter your {field.field_label}{field.is_required ? ' *' : ''}:
                    </div>
                  )}
                </div>
              </div>
            ))}

            {enabledFields.length > 2 && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-lg rounded-tl-none bg-white/60 p-2 px-3 text-[11px] text-gray-500 italic">
                  ... {enabledFields.length - 2} more fields ...
                </div>
              </div>
            )}

            {/* Confirmation */}
            {enabledFields.length > 0 && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-lg rounded-tl-none bg-white p-2 px-3 text-[13px] shadow-sm whitespace-pre-wrap text-[#111]">
                  {config?.confirmation_template || 'Thank you for your booking!'}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      
      {/* Phone Footer (Input area fake) */}
      <div className="bg-[#f0f0f0] p-2 px-3 flex items-center gap-2">
        <div className="flex-1 bg-white rounded-full h-9 border border-gray-300 flex items-center px-4">
          <span className="text-[13px] text-gray-400">Message</span>
        </div>
        <div className="h-9 w-9 bg-[#00a884] rounded-full flex items-center justify-center text-white">
          <GripHorizontal className="h-4 w-4 transform rotate-90" />
        </div>
      </div>
    </div>
  )
}

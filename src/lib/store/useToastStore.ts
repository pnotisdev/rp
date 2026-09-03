import { create } from 'zustand'
import { playNotificationChime } from '@/lib/audio/sfx'
import { useSettingsStore } from '@/lib/store/useSettingsStore'

export type ToastVariant = 'error' | 'success' | 'info'

export interface ToastItem {
  id: string
  message: string
  variant: ToastVariant
}

interface ToastState {
  toasts: ToastItem[]
  push: (message: string, variant?: ToastVariant) => string
  dismiss: (id: string) => void
}

let counter = 0

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, variant = 'error') => {
    const id = `toast-${Date.now()}-${counter++}`
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }] }))
    return id
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Extracts a human-readable message from a caught error/rejection. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function toastError(message: string): string {
  return useToastStore.getState().push(message, 'error')
}

/** `chime: true` is reserved for genuine reward moments (a stage-up, an unlock, a "yes") — most
 *  success toasts (coins earned, a fork made) stay silent so the chime doesn't turn into noise. */
export function toastSuccess(message: string, opts?: { chime?: boolean }): string {
  if (opts?.chime && !useSettingsStore.getState().reducedAudio) playNotificationChime()
  return useToastStore.getState().push(message, 'success')
}

export function toastInfo(message: string): string {
  return useToastStore.getState().push(message, 'info')
}

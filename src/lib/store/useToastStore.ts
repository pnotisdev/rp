import { create } from 'zustand'

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

export function toastSuccess(message: string): string {
  return useToastStore.getState().push(message, 'success')
}

export function toastInfo(message: string): string {
  return useToastStore.getState().push(message, 'info')
}

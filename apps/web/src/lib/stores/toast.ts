import { writable } from 'svelte/store';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

type Toast = {
  id: string;
  message: string;
  type: ToastType;
};

export const toasts = writable<Toast[]>([]);

export function toast(message: string, type: ToastType = 'info', duration = 4000) {
  const id = crypto.randomUUID();
  toasts.update((t) => [...t, { id, message, type }]);
  setTimeout(() => removeToast(id), duration);
}

export function removeToast(id: string) {
  toasts.update((t) => t.filter((x) => x.id !== id));
}

export const toastSuccess = (msg: string) => toast(msg, 'success');
export const toastError = (msg: string) => toast(msg, 'error', 6000);

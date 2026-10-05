import { writable } from 'svelte/store';

export type ToastType = 'success' | 'error' | 'info' | 'warning' | 'trash';

type ToastAction = { label: string; run: () => void };

type Toast = {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
  action?: ToastAction;
};

export const toasts = writable<Toast[]>([]);

export function toast(message: string, type: ToastType = 'info', duration = 4000, action?: ToastAction) {
  const id = crypto.randomUUID();
  toasts.update((t) => [...t, { id, message, type, duration, action }]);
  setTimeout(() => removeToast(id), duration);
}

export function removeToast(id: string) {
  toasts.update((t) => t.filter((x) => x.id !== id));
}

export const toastSuccess = (msg: string) => toast(msg, 'success');
export const toastError = (msg: string) => toast(msg, 'error', 6000);
// Something went to the trash; for eight seconds it can be undone right here
export const toastTrash = (msg: string, undo: () => void) => toast(msg, 'trash', 8000, { label: 'Rückgängig', run: undo });

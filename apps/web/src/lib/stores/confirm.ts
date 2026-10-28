import { writable } from 'svelte/store';

// A question in our own dialog instead of the browser's confirm(); ConfirmDialog in the root layout shows it
export type Question = { message: string; confirmLabel: string | undefined; answer: (yes: boolean) => void };

export const question = writable<Question | null>(null);

export function ask(message: string, confirmLabel?: string): Promise<boolean> {
  return new Promise((resolve) => {
    question.update((open) => {
      open?.answer(false);
      return { message, confirmLabel, answer: resolve };
    });
  });
}

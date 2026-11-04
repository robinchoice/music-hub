import { writable } from 'svelte/store';

// Files dropped outside a project page, on their way to the project they belong to.
// The project page takes them over and uploads them as if they had been dropped there.
export const pendingDrop = writable<{ projectId: string; trackId?: string | undefined; files: File[] } | null>(null);

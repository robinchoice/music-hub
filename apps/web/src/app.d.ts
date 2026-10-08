// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		interface PageData {
			// Link preview of a public page, see +layout.svelte. image is an absolute URL.
			meta?: { title?: string; description?: string; image?: string } | null;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};

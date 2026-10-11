import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// Vite finds these only when the first page runs hooks.client.ts and then reloads
	// every open page, which breaks browser tests on a cold dev server.
	optimizeDeps: { include: ['@sentry/browser'] },
	server: {
		proxy: {
			'/api': {
				target: 'http://localhost:3000',
				changeOrigin: true,
			},
		},
	},
});

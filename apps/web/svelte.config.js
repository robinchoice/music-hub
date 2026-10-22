import adapter from '@sveltejs/adapter-node';
import { relative, sep } from 'node:path';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// defaults to rune mode for the project, except for `node_modules`. Can be removed in svelte 6.
		runes: ({ filename }) => {
			const relativePath = relative(import.meta.dirname, filename);
			const pathSegments = relativePath.toLowerCase().split(sep);
			const isExternalLibrary = pathSegments.includes('node_modules');

			return isExternalLibrary ? undefined : true;
		}
	},
	kit: {
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter: adapter({ out: 'build' }),
		// SvelteKit adds nonces for its inline scripts. Audio, waveforms and covers come signed from the
		// bucket (https, in dev and tests MinIO on localhost), offline copies play from blob URLs, the
		// landing page embeds the app in an iframe of its own origin. wavesurfer.js writes a <style>
		// into its shadow DOM, so styles stay inline. Browser errors go to GlitchTip.
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:', 'blob:', 'https:', 'http://localhost:*', 'http://127.0.0.1:*'],
				'media-src': ['self', 'blob:', 'https:', 'http://localhost:*', 'http://127.0.0.1:*'],
				'connect-src': ['self', 'https:', 'http://localhost:*', 'http://127.0.0.1:*'],
				'frame-src': ['self'],
				'frame-ancestors': ['self'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'object-src': ['none']
			}
		}
	}
};

export default config;

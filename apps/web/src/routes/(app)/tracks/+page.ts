import { redirect } from '@sveltejs/kit';

// The track list moved to the project pages
export const load = () => redirect(307, '/dashboard');

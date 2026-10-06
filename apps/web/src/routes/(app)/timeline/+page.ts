import { redirect } from '@sveltejs/kit';

// The timeline moved to the project pages
export const load = () => redirect(307, '/dashboard');

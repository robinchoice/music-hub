import { redirect } from '@sveltejs/kit';

// The trash is the user's, across projects
export const load = ({ params }) => redirect(307, `/trash?project=${params.projectId}`);

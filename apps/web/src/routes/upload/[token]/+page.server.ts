import { messages } from '$lib/i18n/messages.js';
import type { PageServerLoad } from './$types';

// Link previews don't run JavaScript, so the project name has to be in the server-rendered HTML
export const load: PageServerLoad = async ({ fetch, params, locals }) => {
  const res = await fetch(`/api/v1/upload-links/public/${params.token}`).catch(() => null);
  if (!res?.ok) return { meta: null };
  const link: { project: { name: string } } = await res.json();
  const m = messages[locals.locale].guest.meta;
  return {
    meta: {
      title: m.uploadTitle(link.project.name),
      description: m.uploadDescription,
    },
  };
};

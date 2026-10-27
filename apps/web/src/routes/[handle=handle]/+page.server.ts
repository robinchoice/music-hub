import { messages } from '$lib/i18n/messages.js';
import type { PageServerLoad } from './$types';

// Link previews run no JavaScript, so name and bio have to be in the server-rendered HTML
export const load: PageServerLoad = async ({ fetch, params, locals }) => {
  const res = await fetch(`/api/v1/profiles/${params.handle.slice(1)}`).catch(() => null);
  if (!res?.ok) return { meta: null };
  const { profile }: { profile: { name: string; bio: string | null } } = await res.json();
  const m = messages[locals.locale].guest.meta;
  return {
    meta: {
      title: m.profileTitle(profile.name),
      description: profile.bio || m.profileDescription(profile.name),
    },
  };
};

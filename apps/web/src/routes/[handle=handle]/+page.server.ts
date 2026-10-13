import type { PageServerLoad } from './$types';

// Link previews run no JavaScript, so name and bio have to be in the server-rendered HTML
export const load: PageServerLoad = async ({ fetch, params }) => {
  const res = await fetch(`/api/v1/profiles/${params.handle.slice(1)}`).catch(() => null);
  if (!res?.ok) return { meta: null };
  const { profile }: { profile: { name: string; bio: string | null } } = await res.json();
  return {
    meta: {
      title: `${profile.name} — Offene Musik`,
      description: profile.bio || `Offene Tracks von ${profile.name} zum Remixen`,
    },
  };
};

import type { PageServerLoad } from './$types';

// Link previews don't run JavaScript, so the project name has to be in the server-rendered HTML.
// Password-protected or unavailable links fall back to the generic preview.
export const load: PageServerLoad = async ({ fetch, params }) => {
  const res = await fetch(`/api/v1/share/project/public/${params.token}?meta=1`).catch(() => null);
  if (!res?.ok) return { meta: null };
  const share: { project: { name: string; artist: string | null } } = await res.json();
  return {
    meta: {
      title: share.project.artist ? `${share.project.name} — ${share.project.artist}` : share.project.name,
      description: 'Zum Anhören geteilt über Music Hub',
    },
  };
};

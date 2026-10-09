import type { PageServerLoad } from './$types';

// Link previews (WhatsApp, Signal, iMessage) don't run JavaScript, so the
// track title has to be in the server-rendered HTML. Password-protected or
// unavailable links fall back to the generic preview.
export const load: PageServerLoad = async ({ fetch, params }) => {
  const res = await fetch(`/api/v1/share/public/${params.token}?meta=1`).catch(() => null);
  if (!res?.ok) return { meta: null };
  const share: { project: { name: string }; track: { name: string } } = await res.json();
  return {
    meta: {
      title: `${share.track.name} — ${share.project.name}`,
      description: 'Zum Anhören geteilt über Music Hub',
    },
  };
};

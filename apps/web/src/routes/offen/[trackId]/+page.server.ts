import { OPEN_LICENSE_INFO, type OpenLicense } from '@music-hub/shared';
import type { PageServerLoad } from './$types';

// Link previews run no JavaScript, so title and license have to be in the server-rendered HTML
export const load: PageServerLoad = async ({ fetch, params }) => {
  const res = await fetch(`/api/v1/open/${params.trackId}?meta=1`).catch(() => null);
  if (!res?.ok) return { meta: null };
  const open: { track: { name: string }; artist: string; license: OpenLicense } = await res.json();
  return {
    meta: {
      title: `${open.track.name} — ${open.artist}`,
      description: `Mix und Spuren zum Remixen, frei unter ${OPEN_LICENSE_INFO[open.license].label}`,
    },
  };
};

import { OPEN_LICENSE_INFO, type OpenLicense } from '@music-hub/shared';
import { OPEN_EXAMPLE_ID } from '$lib/demo/mode.js';
import { messages } from '$lib/i18n/messages.js';
import type { PageServerLoad } from './$types';

// Link previews run no JavaScript, so title and license have to be in the server-rendered HTML
export const load: PageServerLoad = async ({ fetch, params, locals }) => {
  if (params.trackId === OPEN_EXAMPLE_ID) return { meta: null };
  const res = await fetch(`/api/v1/open/${params.trackId}?meta=1`).catch(() => null);
  if (!res?.ok) return { meta: null };
  const open: { track: { name: string }; artist: string; license: OpenLicense } = await res.json();
  return {
    meta: {
      title: `${open.track.name} — ${open.artist}`,
      description: messages[locals.locale].guest.meta.openDescription(OPEN_LICENSE_INFO[locals.locale][open.license].label),
    },
  };
};

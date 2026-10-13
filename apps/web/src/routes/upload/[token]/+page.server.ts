import type { PageServerLoad } from './$types';

// Link previews don't run JavaScript, so the project name has to be in the server-rendered HTML
export const load: PageServerLoad = async ({ fetch, params }) => {
  const res = await fetch(`/api/v1/upload-links/public/${params.token}`).catch(() => null);
  if (!res?.ok) return { meta: null };
  const link: { project: { name: string } } = await res.json();
  return {
    meta: {
      title: `Spuren schicken — ${link.project.name}`,
      description: 'Lade deine Dateien über Music Hub hoch, ohne Konto',
    },
  };
};

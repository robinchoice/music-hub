import type { OpenLicense } from '@music-hub/shared';

export type OpenContributor = { id: string; name: string; avatarUrl: string | null; stemCount: number; consented: boolean };

// GET /tracks/:id/open
export type OpenState = {
  license: OpenLicense | null;
  openedAt: string | null;
  requestedById: string | null;
  versionId: string | null;
  allowedLicenses: OpenLicense[];
  contributors: OpenContributor[];
};

export const openPath = (trackId: string) => `/offen/${trackId}`;

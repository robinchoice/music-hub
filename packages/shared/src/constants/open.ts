// Free licenses only: NC and ND would keep remixes from being open in the open source sense
export const OPEN_LICENSES = ['cc-by-sa', 'cc-by', 'cc0'] as const;
export type OpenLicense = (typeof OPEN_LICENSES)[number];

export const OPEN_LICENSE_INFO: Record<OpenLicense, { label: string; url: string; summary: string }> = {
  'cc-by-sa': {
    label: 'CC BY-SA 4.0',
    url: 'https://creativecommons.org/licenses/by-sa/4.0/deed.de',
    summary: 'Alle dürfen remixen und veröffentlichen, auch kommerziell. Sie müssen euch nennen, und ihr Remix muss wieder offen sein.',
  },
  'cc-by': {
    label: 'CC BY 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/deed.de',
    summary: 'Alle dürfen remixen und veröffentlichen, auch kommerziell. Sie müssen euch nennen.',
  },
  cc0: {
    label: 'CC0',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/deed.de',
    summary: 'Gemeinfrei. Alle dürfen alles, auch ohne euch zu nennen.',
  },
};

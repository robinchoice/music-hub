import type { Locale } from '../i18n.js';

export const PROJECT_ROLES = [
  'owner',
  'producer',
  'recording_engineer',
  'mixing_engineer',
  'mastering_engineer',
  'artist',
  'label',
  'management',
  'viewer',
] as const;

export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const ROLE_LABELS: Record<Locale, Record<ProjectRole, string>> = {
  de: {
    owner: 'Besitzer',
    producer: 'Produktion',
    recording_engineer: 'Aufnahme',
    mixing_engineer: 'Mixing',
    mastering_engineer: 'Mastering',
    artist: 'Artist',
    label: 'Label',
    management: 'Management',
    viewer: 'Nur Zuhören',
  },
  en: {
    owner: 'Owner',
    producer: 'Production',
    recording_engineer: 'Recording',
    mixing_engineer: 'Mixing',
    mastering_engineer: 'Mastering',
    artist: 'Artist',
    label: 'Label',
    management: 'Management',
    viewer: 'Listen only',
  },
};

export const ENGINEER_ROLES: ProjectRole[] = [
  'recording_engineer',
  'mixing_engineer',
  'mastering_engineer',
];

export const PROJECT_ROLES = [
  'owner',
  'recording_engineer',
  'mixing_engineer',
  'mastering_engineer',
  'artist',
  'label',
  'management',
  'viewer',
] as const;

export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const ROLE_LABELS: Record<ProjectRole, string> = {
  owner: 'Besitzer',
  recording_engineer: 'Aufnahme',
  mixing_engineer: 'Mixing',
  mastering_engineer: 'Mastering',
  artist: 'Artist',
  label: 'Label',
  management: 'Management',
  viewer: 'Nur Zuhören',
};

export const ENGINEER_ROLES: ProjectRole[] = [
  'recording_engineer',
  'mixing_engineer',
  'mastering_engineer',
];

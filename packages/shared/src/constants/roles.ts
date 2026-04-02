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
  owner: 'Owner',
  recording_engineer: 'Recording Engineer',
  mixing_engineer: 'Mixing Engineer',
  mastering_engineer: 'Mastering Engineer',
  artist: 'Artist',
  label: 'Label',
  management: 'Management',
  viewer: 'Viewer',
};

export const ENGINEER_ROLES: ProjectRole[] = [
  'recording_engineer',
  'mixing_engineer',
  'mastering_engineer',
];

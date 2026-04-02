import type { ProjectRole } from './roles.js';

export type Permission =
  | 'project.edit'
  | 'project.invite'
  | 'track.upload'
  | 'track.listen'
  | 'track.download'
  | 'version.comment'
  | 'version.approve';

const PERMISSIONS: Record<ProjectRole, Permission[]> = {
  owner: [
    'project.edit',
    'project.invite',
    'track.upload',
    'track.listen',
    'track.download',
    'version.comment',
    'version.approve',
  ],
  recording_engineer: [
    'track.upload',
    'track.listen',
    'track.download',
    'version.comment',
  ],
  mixing_engineer: [
    'track.upload',
    'track.listen',
    'track.download',
    'version.comment',
  ],
  mastering_engineer: [
    'track.upload',
    'track.listen',
    'track.download',
    'version.comment',
  ],
  artist: [
    'track.listen',
    'track.download',
    'version.comment',
    'version.approve',
  ],
  label: [
    'track.listen',
    'version.comment',
    'version.approve',
  ],
  management: [
    'project.invite',
    'track.listen',
    'track.download',
    'version.comment',
    'version.approve',
  ],
  viewer: [
    'track.listen',
  ],
};

export function hasPermission(role: ProjectRole, permission: Permission): boolean {
  return PERMISSIONS[role].includes(permission);
}

export function getPermissions(role: ProjectRole): Permission[] {
  return PERMISSIONS[role];
}

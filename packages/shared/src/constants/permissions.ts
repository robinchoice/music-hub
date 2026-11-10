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
  producer: [
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

// The rights a membership holds as switches. The roles preset them, the owner may change them per person;
// listening stays open to every member and editing the project to the owner.
export const MEMBER_RIGHTS = ['canUpload', 'canDownload', 'canComment', 'canApprove', 'canInvite'] as const;
export type MemberRight = (typeof MEMBER_RIGHTS)[number];
export type MemberRights = Record<MemberRight, boolean>;

const RIGHT_PERMISSIONS: Record<MemberRight, Permission> = {
  canUpload: 'track.upload',
  canDownload: 'track.download',
  canComment: 'version.comment',
  canApprove: 'version.approve',
  canInvite: 'project.invite',
};

/** The rights several roles add up to: the preset of the switches */
export function rightsOfRoles(roles: ProjectRole[]): MemberRights {
  const may = (right: MemberRight) => roles.some((r) => hasPermission(r, RIGHT_PERMISSIONS[right]));
  return {
    canUpload: may('canUpload'),
    canDownload: may('canDownload'),
    canComment: may('canComment'),
    canApprove: may('canApprove'),
    canInvite: may('canInvite'),
  };
}

/** Just the switches of a membership row or API answer */
export const pickRights = (m: MemberRights): MemberRights => ({
  canUpload: m.canUpload,
  canDownload: m.canDownload,
  canComment: m.canComment,
  canApprove: m.canApprove,
  canInvite: m.canInvite,
});

/** All roles of a member: the first one plus any extra ones */
export function memberRoles(m: { role: ProjectRole; extraRoles?: ProjectRole[] | null }): ProjectRole[] {
  return [m.role, ...(m.extraRoles ?? [])];
}

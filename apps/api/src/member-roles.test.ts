import { expect, test } from 'bun:test';
import { inviteMemberSchema, updateMemberSchema } from '@music-hub/shared';
import { roleColumns } from './routes/projects.js';

test('a member holds several roles and gets the rights of all of them', () => {
  expect(roleColumns({ roles: ['artist', 'mixing_engineer', 'artist'] })).toEqual({
    role: 'artist',
    extraRoles: ['mixing_engineer'],
    canUpload: true,
    canComment: true,
    canApprove: true,
  });
});

test('older clients still send a single role', () => {
  expect(roleColumns(inviteMemberSchema.parse({ email: 'a@example.com', role: 'viewer' }))).toMatchObject({
    role: 'viewer',
    extraRoles: [],
    canUpload: false,
  });
});

test('roles may not be empty or include owner', () => {
  expect(updateMemberSchema.safeParse({}).success).toBe(false);
  expect(updateMemberSchema.safeParse({ roles: [] }).success).toBe(false);
  expect(updateMemberSchema.safeParse({ roles: ['artist', 'owner'] }).success).toBe(false);
});

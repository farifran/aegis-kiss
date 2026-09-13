import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import { assertSchema } from './schema_validator.mjs';

export const roleAssignmentRelativePath = '.harness/config/roles.json';

export function roleAssignmentPath(repositoryRoot) {
  return resolve(repositoryRoot, roleAssignmentRelativePath);
}

export function assertRoleAssignment(document) {
  assertSchema('aegis.role_assignment.v1', document);
  return document;
}

export async function loadRoleAssignment(repositoryRoot) {
  const path = roleAssignmentPath(repositoryRoot);
  if (!existsSync(path)) return null;
  return assertRoleAssignment(JSON.parse(await readFile(path, 'utf8')));
}

export function publicRoleSummary(role) {
  return {
    channel: role.channel,
    adapter: role.adapter,
    ...(role.model === null ? {} : { model: role.model }),
    ...(role.credentialEnv === null ? {} : {
      credentialEnv: role.credentialEnv,
      credentialAvailable: Boolean(process.env[role.credentialEnv]),
    }),
  };
}

export function publicRoleAssignmentSummary(document) {
  assertRoleAssignment(document);
  return {
    schema: document.schema,
    roles: {
      contractSupervisor: publicRoleSummary(document.roles.contractSupervisor),
      codingAgent: publicRoleSummary(document.roles.codingAgent),
    },
    executionBoundary: 'EXTERNAL_HUMAN_AUTHORIZATION_REQUIRED',
  };
}

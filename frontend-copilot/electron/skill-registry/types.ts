export const SKILL_REGISTRY_DOCUMENT_VERSION = 1 as const
export const SKILL_REGISTRY_DOCUMENT_KIND = 'skill-registry' as const
export const SKILL_SNAPSHOT_VERSION = 1 as const
export const SKILL_DEFAULT_ENTRY_FILE_NAME = 'SKILL.md' as const
export const SKILL_CAPABILITY_SNAPSHOT_FILE_NAME = 'skill-capability-snapshot.json' as const
export const SKILL_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID = '__runtime.skill.catalog__' as const
export const SKILL_CAPABILITY_SNAPSHOT_BRIDGE_KEY = 'snapshot' as const

export const SKILL_ENTRY_MAX_BYTES = 256 * 1024
export const SKILL_PACKAGE_MAX_BYTES = 5 * 1024 * 1024

export type SkillValidationStatus = 'valid' | 'invalid'

export interface SkillRevisionState {
  registryRevision: number
  snapshotRevision: number
}

export interface SkillValidationIssue {
  fieldPath: string
  message: string
  code: string
}

export interface SkillValidationSummary {
  status: SkillValidationStatus
  errors: SkillValidationIssue[]
  warnings: SkillValidationIssue[]
}

export interface SkillCapabilityFlags {
  readOnlyResources: boolean
  scripts: false
}

export interface SkillMetadata {
  schemaVersion: 1
  skillId: string
  displayName: string
  description: string
  version?: string | null
  tags?: string[]
  entry: string
  capabilities?: SkillCapabilityFlags
}

export interface SkillResourceSummary {
  path: string
  description?: string | null
}

export interface SkillRecord {
  skillId: string
  displayName: string
  description: string
  version?: string | null
  source: 'builtin' | 'imported'
  enabled: boolean
  trusted: true
  managedDirectoryName: string
  entryPath: string
  tags: string[]
  capabilities: SkillCapabilityFlags
  validation: SkillValidationSummary
  entrySummary: string | null
  resourceSummaries: SkillResourceSummary[]
  importedAt: string
  updatedAt: string
}

export interface SkillRegistryLoadSuccess extends SkillRevisionState {
  ok: true
  skills: SkillRecord[]
}

export interface SkillImportSuccess extends SkillRevisionState {
  ok: true
  skill: SkillRecord
  validationErrors: SkillValidationIssue[]
}

export interface SkillDeleteSuccess extends SkillRevisionState {
  ok: true
  skillId: string
  deleted: true
}

export interface SkillSetEnabledSuccess extends SkillRevisionState {
  ok: true
  skill: SkillRecord
}

export interface SkillRefreshEntryResult {
  skillId: string
  status: SkillValidationStatus
  errors: SkillValidationIssue[]
  warnings: SkillValidationIssue[]
}

export interface SkillRefreshSuccess extends SkillRevisionState {
  ok: true
  refreshedSkillIds: string[]
  results: SkillRefreshEntryResult[]
}

export interface SkillRegistrySnapshotEvent extends SkillRevisionState {
  kind: 'snapshot'
  skills: SkillRecord[]
}

export interface SkillRegistrySkillUpdatedEvent extends SkillRevisionState {
  kind: 'skill-updated'
  skillId: string
  skill: SkillRecord
}

export interface SkillRegistrySkillDeletedEvent extends SkillRevisionState {
  kind: 'skill-deleted'
  skillId: string
}

export type SkillRegistrySubscriptionEvent =
  | SkillRegistrySnapshotEvent
  | SkillRegistrySkillUpdatedEvent
  | SkillRegistrySkillDeletedEvent

export interface SkillSnapshotResourceSummary {
  path: string
  description?: string | null
}

export interface SkillSnapshotSkillSummary {
  skillId: string
  displayName: string
  description: string
  version?: string | null
  tags: string[]
  entrySummary: string | null
  resourceSummaries: SkillSnapshotResourceSummary[]
}

export interface SkillCapabilitySnapshot extends SkillRevisionState {
  version: typeof SKILL_SNAPSHOT_VERSION
  generatedAt: string
  skills: SkillSnapshotSkillSummary[]
}

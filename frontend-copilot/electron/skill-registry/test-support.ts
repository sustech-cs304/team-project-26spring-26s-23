import type {
  SkillCapabilitySnapshot,
  SkillRecord,
  SkillResourceSummary,
  SkillValidationSummary,
} from './types'

export const SKILL_REGISTRY_TEST_FIXTURE_SKILL_IDS = {
  docs: 'writing-clear-docs',
  review: 'code-review-helper',
} as const

export function createSkillValidationSummaryFixture(
  overrides: Partial<SkillValidationSummary> = {},
): SkillValidationSummary {
  return {
    status: 'valid',
    errors: [],
    warnings: [],
    ...overrides,
  }
}

export function createSkillResourceSummaryFixture(
  overrides: Partial<SkillResourceSummary> = {},
): SkillResourceSummary {
  return {
    path: 'resources/checklist.md',
    description: null,
    ...overrides,
  }
}

export function createSkillRecordFixture(
  overrides: Partial<SkillRecord> = {},
): SkillRecord {
  return {
    skillId: SKILL_REGISTRY_TEST_FIXTURE_SKILL_IDS.docs,
    displayName: '清晰文档写作',
    description: '帮助模型编写结构清晰、面向开发者的技术文档。',
    version: '1.0.0',
    source: 'imported',
    sourceDirectory: null,
    enabled: true,
    trusted: true,
    managedDirectoryName: SKILL_REGISTRY_TEST_FIXTURE_SKILL_IDS.docs,
    entryPath: 'SKILL.md',
    tags: ['documentation', 'writing'],
    capabilities: {
      readOnlyResources: true,
      scripts: false,
    },
    validation: createSkillValidationSummaryFixture(),
    entrySummary: '用于编写结构清晰的开发者文档。',
    resourceSummaries: [createSkillResourceSummaryFixture()],
    importedAt: '2026-04-24T00:00:00.000Z',
    updatedAt: '2026-04-24T00:00:00.000Z',
    ...overrides,
  }
}

export function createSkillCapabilitySnapshotFixture(
  overrides: Partial<SkillCapabilitySnapshot> = {},
): SkillCapabilitySnapshot {
  const skill = createSkillRecordFixture()
  return {
    version: 1,
    registryRevision: 3,
    snapshotRevision: 5,
    generatedAt: '2026-04-24T00:00:00.000Z',
    skills: [{
      skillId: skill.skillId,
      displayName: skill.displayName,
      description: skill.description,
      version: skill.version,
      tags: [...skill.tags],
      entrySummary: skill.entrySummary,
      resourceSummaries: skill.resourceSummaries.map((resource) => ({ ...resource })),
    }],
    ...overrides,
  }
}

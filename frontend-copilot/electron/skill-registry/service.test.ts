import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createHostedRuntimePaths, ensureHostedRuntimeDirectories } from '../runtime/runtime-paths'
import type { BuiltinSkillSource } from './builtin-skill-loader'
import { createSkillRegistryService } from './service'
import { createSkillRegistryPaths, createSkillRegistryStore } from './store'
import type { SkillCapabilitySnapshot } from './types'

const activeTempRoots: string[] = []

afterEach(async () => {
  await Promise.all(activeTempRoots.splice(0).map(async (tempRoot) => {
    await rm(tempRoot, { recursive: true, force: true })
  }))
})

async function createRegistryServiceFixture(
  testName: string,
  options: { builtinSkillSources?: readonly BuiltinSkillSource[] } = {},
) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), `candue-skill-registry-service-${testName}-`))
  activeTempRoots.push(tempRoot)

  const hostedPaths = createHostedRuntimePaths(tempRoot)
  await ensureHostedRuntimeDirectories(hostedPaths)

  const paths = createSkillRegistryPaths(hostedPaths)
  const store = createSkillRegistryStore({ paths })
  const publishEvent = vi.fn()
  const snapshotWrites: SkillCapabilitySnapshot[] = []
  const snapshotSink = {
    write: vi.fn(async (snapshot: SkillCapabilitySnapshot) => {
      snapshotWrites.push(snapshot)
    }),
  }
  const service = createSkillRegistryService({
    store,
    paths,
    snapshotSink,
    builtinSkillSources: options.builtinSkillSources,
    publishEvent,
    now: () => '2026-04-24T12:00:00.000Z',
  })

  return {
    tempRoot,
    hostedPaths,
    paths,
    store,
    publishEvent,
    snapshotSink,
    snapshotWrites,
    service,
  }
}

async function createSkillPackage(root: string, overrides: {
  skillId?: string
  description?: string
  body?: string
  frontmatter?: string
  skipEntry?: boolean
  resources?: Record<string, string | Buffer>
} = {}): Promise<string> {
  await mkdir(root, { recursive: true })
  const skillId = overrides.skillId ?? 'writing-clear-docs'
  const description = overrides.description ?? '帮助模型编写结构清晰、面向开发者的技术文档。'
  const frontmatter = overrides.frontmatter ?? `---\nname: ${skillId}\ndescription: ${description}\n---\n`
  const body = overrides.body ?? '# 清晰文档写作\n\n用于编写结构清晰的开发者文档。\n\n- 参考资源：`resources/checklist.md`\n'

  if (overrides.skipEntry !== true) {
    await writeFile(path.join(root, 'SKILL.md'), `${frontmatter}${body}`, 'utf8')
  }

  const resources = overrides.resources ?? {
    'resources/checklist.md': '文档检查清单。\n',
  }
  for (const [relativePath, content] of Object.entries(resources)) {
    const resourcePath = path.join(root, relativePath)
    await mkdir(path.dirname(resourcePath), { recursive: true })
    await writeFile(resourcePath, content)
  }

  return root
}

describe('createSkillRegistryService', () => {
  it('loads an initialized empty registry and writes an empty snapshot', async () => {
    const fixture = await createRegistryServiceFixture('load-empty')

    await expect(fixture.service.loadRegistry({ includeDisabled: true })).resolves.toEqual({
      ok: true,
      registryRevision: 0,
      snapshotRevision: 0,
      skills: [],
    })
    expect(fixture.snapshotWrites).toEqual([{ 
      version: 1,
      registryRevision: 0,
      snapshotRevision: 0,
      generatedAt: '2026-04-24T12:00:00.000Z',
      skills: [],
    }])
  })

  it('imports a standard Skill package and indexes sibling files from the Skill directory', async () => {
    const fixture = await createRegistryServiceFixture('import-valid')
    const sourceDirectory = await createSkillPackage(path.join(fixture.tempRoot, 'source-skill'))

    const result = await fixture.service.importSkill({ sourceDirectory })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('Expected importResult.ok=true')
    }
    expect(result.registryRevision).toBe(1)
    expect(result.snapshotRevision).toBe(1)
    expect(result.skill).toMatchObject({
      skillId: 'writing-clear-docs',
      displayName: 'writing-clear-docs',
      description: '帮助模型编写结构清晰、面向开发者的技术文档。',
      source: 'imported',
      enabled: true,
      trusted: true,
      managedDirectoryName: 'writing-clear-docs',
      entryPath: 'SKILL.md',
      validation: {
        status: 'valid',
        errors: [],
        warnings: [],
      },
    })
    expect(result.skill.entrySummary).toContain('清晰文档写作')
    expect(result.skill.resourceSummaries).toEqual([{
      path: 'resources/checklist.md',
      description: null,
    }])
    await expect(stat(path.join(fixture.paths.managedSkillsDir, 'writing-clear-docs', 'SKILL.md'))).resolves.toBeDefined()
    const latestSnapshot = fixture.snapshotWrites[fixture.snapshotWrites.length - 1]
    expect(latestSnapshot?.skills.map((skill) => skill.skillId)).toEqual(['writing-clear-docs'])
  })

  it('rejects an import with a missing entry file without mutating the registry', async () => {
    const fixture = await createRegistryServiceFixture('missing-entry')
    const sourceDirectory = await createSkillPackage(path.join(fixture.tempRoot, 'source-skill'), { skipEntry: true })

    const result = await fixture.service.importSkill({ sourceDirectory })
    const loaded = await fixture.service.loadRegistry({ includeDisabled: true })

    expect(result).toMatchObject({
      ok: false,
      code: 'validation_failed',
      validationErrors: [expect.objectContaining({ code: 'entry_missing' })],
    })
    expect(loaded.ok && loaded.registryRevision).toBe(0)
    expect(loaded.ok && loaded.skills).toEqual([])
  })

  it('does not require skill.json when importing a standard Skill', async () => {
    const fixture = await createRegistryServiceFixture('no-skill-json')
    const sourceDirectory = await createSkillPackage(path.join(fixture.tempRoot, 'source-skill'))

    await expect(fixture.service.importSkill({ sourceDirectory })).resolves.toMatchObject({
      ok: true,
      skill: {
        skillId: 'writing-clear-docs',
        entryPath: 'SKILL.md',
      },
    })
  })

  it('rejects invalid SKILL.md frontmatter name without mutating the registry', async () => {
    const fixture = await createRegistryServiceFixture('invalid-frontmatter-name')
    const sourceDirectory = await createSkillPackage(path.join(fixture.tempRoot, 'source-skill'), {
      frontmatter: '---\nname: Invalid Skill Id\ndescription: 帮助模型编写结构清晰、面向开发者的技术文档。\n---\n',
    })

    const result = await fixture.service.importSkill({ sourceDirectory })

    expect(result).toMatchObject({
      ok: false,
      code: 'validation_failed',
      validationErrors: [expect.objectContaining({
        fieldPath: 'SKILL.md.frontmatter.name',
        code: 'invalid_skill_id',
      })],
    })
    await expect(fixture.store.load()).resolves.toMatchObject({ registryRevision: 0, skills: [] })
  })

  it('rejects missing SKILL.md frontmatter description and points to SKILL.md', async () => {
    const fixture = await createRegistryServiceFixture('missing-frontmatter-description')
    const sourceDirectory = await createSkillPackage(path.join(fixture.tempRoot, 'source-skill'), {
      frontmatter: '---\nname: writing-clear-docs\n---\n',
    })

    const result = await fixture.service.importSkill({ sourceDirectory })

    expect(result).toMatchObject({
      ok: false,
      code: 'validation_failed',
      validationErrors: [expect.objectContaining({
        fieldPath: 'SKILL.md.frontmatter.description',
        code: 'invalid_description',
      })],
    })
  })

  it('rejects duplicate skill ids', async () => {
    const fixture = await createRegistryServiceFixture('duplicate-skill')
    const firstSourceDirectory = await createSkillPackage(path.join(fixture.tempRoot, 'source-skill-1'))
    const secondSourceDirectory = await createSkillPackage(path.join(fixture.tempRoot, 'source-skill-2'))

    await expect(fixture.service.importSkill({ sourceDirectory: firstSourceDirectory })).resolves.toMatchObject({ ok: true })
    const duplicateResult = await fixture.service.importSkill({ sourceDirectory: secondSourceDirectory })

    expect(duplicateResult).toMatchObject({
      ok: false,
      code: 'validation_failed',
      validationErrors: [expect.objectContaining({ code: 'duplicate_skill_id' })],
    })
    const loaded = await fixture.service.loadRegistry({ includeDisabled: true })
    expect(loaded.ok && loaded.skills).toHaveLength(1)
  })

  it('indexes all files under the Skill directory except SKILL.md', async () => {
    const fixture = await createRegistryServiceFixture('directory-resource-index')
    const sourceDirectory = await createSkillPackage(path.join(fixture.tempRoot, 'source-skill'), {
      body: '# 清晰文档写作\n\n- Core rules: `references/design-principles.md`\n- Also read templates/output.md when useful.\n',
      resources: {
        'references/design-principles.md': '设计原则。\n',
        'templates/output.md': '输出模板。\n',
        'references/not-mentioned.md': '未显式引用。\n',
      },
    })

    const result = await fixture.service.importSkill({ sourceDirectory })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) {
      throw new Error('Expected importResult.ok=true')
    }
    expect(result.skill.resourceSummaries).toEqual([
      { path: 'references/design-principles.md', description: null },
      { path: 'references/not-mentioned.md', description: null },
      { path: 'templates/output.md', description: null },
    ])
    const latestSnapshot = fixture.snapshotWrites[fixture.snapshotWrites.length - 1]
    expect(latestSnapshot?.skills[0]?.resourceSummaries).toEqual(result.skill.resourceSummaries)
  })

  it('allows a Skill with no sibling resource files', async () => {
    const fixture = await createRegistryServiceFixture('no-directory-resources')
    const sourceDirectory = await createSkillPackage(path.join(fixture.tempRoot, 'source-skill'), {
      body: '# 清晰文档写作\n\n用于编写结构清晰的开发者文档。\n',
      resources: {},
    })

    const result = await fixture.service.importSkill({ sourceDirectory })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) {
      throw new Error('Expected importResult.ok=true')
    }
    expect(result.skill.resourceSummaries).toEqual([])
  })

  it('does not let unrelated SKILL.md text affect the resource index', async () => {
    const fixture = await createRegistryServiceFixture('directory-resource-ignore-text')
    const sourceDirectory = await createSkillPackage(path.join(fixture.tempRoot, 'source-skill'), {
      body: '# 清晰文档写作\n\nIgnore `../secret.md`, `/etc/passwd`, `C:/Users/example/secret.md`, `https://example.com/a.md`, and keep `references/safe.md`.\n',
      resources: {
        'references/safe.md': '安全相对资源。\n',
      },
    })

    const result = await fixture.service.importSkill({ sourceDirectory })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) {
      throw new Error('Expected importResult.ok=true')
    }
    expect(result.skill.resourceSummaries).toEqual([{ path: 'references/safe.md', description: null }])
  })

  it('toggles enabled state and bumps registry and snapshot revisions', async () => {
    const fixture = await createRegistryServiceFixture('toggle-enabled')
    const sourceDirectory = await createSkillPackage(path.join(fixture.tempRoot, 'source-skill'))
    const importResult = await fixture.service.importSkill({ sourceDirectory })
    expect(importResult.ok).toBe(true)

    const disabledResult = await fixture.service.setSkillEnabled({ skillId: 'writing-clear-docs', enabled: false })
    const enabledResult = await fixture.service.setSkillEnabled({ skillId: 'writing-clear-docs', enabled: true })

    expect(disabledResult).toMatchObject({
      ok: true,
      registryRevision: 2,
      snapshotRevision: 2,
      skill: { enabled: false },
    })
    expect(enabledResult).toMatchObject({
      ok: true,
      registryRevision: 3,
      snapshotRevision: 3,
      skill: { enabled: true },
    })
  })

  it('deletes a skill and removes the managed directory', async () => {
    const fixture = await createRegistryServiceFixture('delete-skill')
    const sourceDirectory = await createSkillPackage(path.join(fixture.tempRoot, 'source-skill'))
    await fixture.service.importSkill({ sourceDirectory })

    const result = await fixture.service.deleteSkill('writing-clear-docs')

    expect(result).toEqual({
      ok: true,
      registryRevision: 2,
      snapshotRevision: 2,
      skillId: 'writing-clear-docs',
      deleted: true,
    })
    await expect(stat(path.join(fixture.paths.managedSkillsDir, 'writing-clear-docs'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fixture.service.loadRegistry({ includeDisabled: true })).resolves.toMatchObject({
      ok: true,
      skills: [],
    })
  })

  it('loads builtin skills from source directories and prevents deleting them', async () => {
    const fixture = await createRegistryServiceFixture('builtin-skill', {
      builtinSkillSources: [{
        skillId: 'builtin-placeholder-skill',
        sourceDirectory: path.resolve('builtin-skills/builtin-placeholder-skill'),
        enabledByDefault: true,
      }],
    })

    const loaded = await fixture.service.loadRegistry({ includeDisabled: true })
    const deleteResult = await fixture.service.deleteSkill('builtin-placeholder-skill')

    expect(loaded).toMatchObject({
      ok: true,
      skills: [expect.objectContaining({
        skillId: 'builtin-placeholder-skill',
        source: 'builtin',
        enabled: true,
        managedDirectoryName: 'builtin-placeholder-skill',
      })],
    })
    expect(deleteResult).toMatchObject({
      ok: false,
      code: 'invalid_request',
      error: 'Builtin Skill "builtin-placeholder-skill" cannot be deleted.',
    })
  })

  it('refreshes builtin skills from their source directories instead of the managed runtime directory', async () => {
    const fixture = await createRegistryServiceFixture('builtin-refresh', {
      builtinSkillSources: [{
        skillId: 'builtin-placeholder-skill',
        sourceDirectory: path.resolve('builtin-skills/builtin-placeholder-skill'),
        enabledByDefault: true,
      }],
    })

    await fixture.service.loadRegistry({ includeDisabled: true })
    const result = await fixture.service.refreshSkills({ skillId: 'builtin-placeholder-skill' })

    expect(result).toMatchObject({
      ok: true,
      refreshedSkillIds: ['builtin-placeholder-skill'],
      results: [expect.objectContaining({
        skillId: 'builtin-placeholder-skill',
        status: 'valid',
      })],
    })
  })

  it('refreshes validation state and excludes invalid enabled skills from snapshots', async () => {
    const fixture = await createRegistryServiceFixture('refresh-invalid')
    const sourceDirectory = await createSkillPackage(path.join(fixture.tempRoot, 'source-skill'))
    await fixture.service.importSkill({ sourceDirectory })
    await rm(path.join(fixture.paths.managedSkillsDir, 'writing-clear-docs', 'SKILL.md'), { force: true })

    const result = await fixture.service.refreshSkills({ skillId: 'writing-clear-docs' })

    expect(result).toMatchObject({
      ok: true,
      registryRevision: 2,
      snapshotRevision: 2,
      refreshedSkillIds: ['writing-clear-docs'],
      results: [{
        skillId: 'writing-clear-docs',
        status: 'invalid',
        errors: [expect.objectContaining({ code: 'entry_missing' })],
        warnings: [],
      }],
    })
    const latestSnapshot = fixture.snapshotWrites[fixture.snapshotWrites.length - 1]
    expect(latestSnapshot?.skills).toEqual([])
  })

  it('does not expose local absolute paths or disabled skills in generated snapshots', async () => {
    const fixture = await createRegistryServiceFixture('snapshot-redaction')
    const sourceDirectory = await createSkillPackage(path.join(fixture.tempRoot, 'source-skill'))
    await fixture.service.importSkill({ sourceDirectory })
    await fixture.service.setSkillEnabled({ skillId: 'writing-clear-docs', enabled: false })

    const snapshot = fixture.snapshotWrites[fixture.snapshotWrites.length - 1]

    expect(snapshot).toBeDefined()
    expect(snapshot?.skills).toEqual([])
    expect(JSON.stringify(snapshot)).not.toContain(fixture.tempRoot)
    expect(JSON.stringify(snapshot)).not.toContain('managedDirectoryName')
  })
})

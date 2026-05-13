import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createHostedRuntimePaths, ensureHostedRuntimeDirectories } from '../runtime/runtime-paths'
import {
  collectSkillSnapshotRedactionViolations,
  createSkillCapabilitySnapshot,
  createSkillCapabilitySnapshotFilePath,
  createSkillCapabilitySnapshotSink,
  isSkillCapabilitySnapshotRedacted,
} from './snapshot'
import { createSkillCapabilitySnapshotFixture, createSkillRecordFixture } from './test-support'
import {
  SKILL_CAPABILITY_SNAPSHOT_BRIDGE_KEY,
  SKILL_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID,
} from './types'

const activeTempRoots: string[] = []

afterEach(async () => {
  await Promise.all(activeTempRoots.splice(0).map(async (tempRoot) => {
    await rm(tempRoot, { recursive: true, force: true })
  }))
})

describe('skill snapshot contracts - capability snapshots', () => {
  it('creates a redacted enabled-skill capability snapshot without local managed paths', () => {
    const enabledSkill = createSkillRecordFixture()
    const disabledSkill = createSkillRecordFixture({
      skillId: 'disabled-skill',
      displayName: 'Disabled Skill',
      enabled: false,
      managedDirectoryName: 'disabled-skill',
    })
    const invalidSkill = createSkillRecordFixture({
      skillId: 'invalid-skill',
      displayName: 'Invalid Skill',
      managedDirectoryName: 'invalid-skill',
      validation: {
        status: 'invalid',
        errors: [{ fieldPath: 'SKILL.md.frontmatter.name', message: 'invalid', code: 'invalid' }],
        warnings: [],
      },
    })

    const snapshot = createSkillCapabilitySnapshot({
      registryRevision: 3,
      snapshotRevision: 8,
      generatedAt: '2026-04-24T08:15:00Z',
      skills: [disabledSkill, enabledSkill, invalidSkill],
    })

    expect(snapshot).toEqual({
      version: 1,
      registryRevision: 3,
      snapshotRevision: 8,
      generatedAt: '2026-04-24T08:15:00Z',
      skills: [{
        skillId: 'writing-clear-docs',
        displayName: '清晰文档写作',
        description: '帮助模型编写结构清晰、面向开发者的技术文档。',
        version: '1.0.0',
        tags: ['documentation', 'writing'],
        entrySummary: '用于编写结构清晰的开发者文档。',
        resourceSummaries: [{
          path: 'resources/checklist.md',
          description: null,
        }],
      }],
    })
    expect(collectSkillSnapshotRedactionViolations(snapshot)).toEqual([])
    expect(isSkillCapabilitySnapshotRedacted(snapshot)).toBe(true)
  })

})

describe('skill snapshot contracts - persistence', () => {
  it('persists snapshots to both the snapshot file and existing capability bridge state document', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-skill-snapshot-sink-'))
    activeTempRoots.push(tempRoot)
    const runtimePaths = createHostedRuntimePaths(tempRoot)
    await ensureHostedRuntimeDirectories(runtimePaths)
    const snapshot = createSkillCapabilitySnapshotFixture()

    await createSkillCapabilitySnapshotSink({ runtimePaths }).write(snapshot)

    const snapshotFilePayload = JSON.parse(
      await readFile(createSkillCapabilitySnapshotFilePath(runtimePaths), 'utf8'),
    ) as unknown
    const bridgeStatePayload = JSON.parse(
      await readFile(path.join(runtimePaths.stateDir, 'capability-bridge-state.json'), 'utf8'),
    ) as {
      values: { tool: Record<string, Record<string, unknown>> }
    }

    expect(snapshotFilePayload).toEqual(snapshot)
    expect(
      bridgeStatePayload.values.tool[SKILL_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID]?.[SKILL_CAPABILITY_SNAPSHOT_BRIDGE_KEY],
    ).toEqual(snapshot)
  })

  it('preserves existing capability bridge state buckets while writing the skill snapshot', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-skill-snapshot-existing-'))
    activeTempRoots.push(tempRoot)
    const runtimePaths = createHostedRuntimePaths(tempRoot)
    await ensureHostedRuntimeDirectories(runtimePaths)
    const stateFile = path.join(runtimePaths.stateDir, 'capability-bridge-state.json')
    await writeFile(stateFile, `${JSON.stringify({
      version: 1,
      values: {
        tool: { 'tool.fs.read': { cursor: { value: 1 } } },
        run: {},
      },
    })}\n`, 'utf8')

    await createSkillCapabilitySnapshotSink({ runtimePaths }).write(createSkillCapabilitySnapshotFixture())

    const bridgeStatePayload = JSON.parse(await readFile(stateFile, 'utf8')) as {
      values: { tool: Record<string, Record<string, unknown>> }
    }
    expect(bridgeStatePayload.values.tool['tool.fs.read']).toEqual({ cursor: { value: 1 } })
    expect(bridgeStatePayload.values.tool[SKILL_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID]).toBeDefined()
  })

  it('flags snapshots that leak local paths or sensitive fields', () => {
    const snapshot = createSkillCapabilitySnapshotFixture()
    const leakedSnapshot = {
      ...snapshot,
      localToken: 'desktop-local-token',
      skills: [
        {
          ...snapshot.skills[0],
          managedDirectoryName: 'writing-clear-docs',
          headers: {
            Authorization: 'Bearer super-secret',
          },
        },
      ],
    }

    expect(collectSkillSnapshotRedactionViolations(snapshot)).toEqual([])
    expect(isSkillCapabilitySnapshotRedacted(snapshot)).toBe(true)
    expect([...collectSkillSnapshotRedactionViolations(leakedSnapshot)].sort()).toEqual([
      'localToken',
      'skills[0].headers',
      'skills[0].managedDirectoryName',
    ])
    expect(isSkillCapabilitySnapshotRedacted(leakedSnapshot as never)).toBe(false)
  })
})

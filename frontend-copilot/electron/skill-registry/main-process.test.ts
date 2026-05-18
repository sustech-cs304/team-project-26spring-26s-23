import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
}))

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: electronMocks.showOpenDialog,
  },
}))

import { createHostedRuntimePaths } from '../runtime/runtime-paths'
import { createElectronSkillRegistryService } from './main-process'

describe('createElectronSkillRegistryService', () => {
  it('opens a directory picker and imports the selected Skill folder', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-skill-main-process-import-'))
    const appendLog = vi.fn()
    const hostedPaths = createHostedRuntimePaths(tempRoot)
    const sourceDirectory = path.join(tempRoot, 'source-skill')
    await createSkillPackage(sourceDirectory)
    electronMocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [sourceDirectory],
    })

    const service = createElectronSkillRegistryService({
      prepareRuntimePaths: vi.fn(async () => hostedPaths),
      appendLog,
      now: () => '2026-04-24T12:00:00.000Z',
    })

    try {
      const result = await service.selectAndImportSkill()

      expect(electronMocks.showOpenDialog).toHaveBeenCalledWith({
        title: '选择 Skill 文件夹',
        properties: ['openDirectory'],
      })
      expect(result).toMatchObject({
        ok: true,
        skill: {
          skillId: 'writing-clear-docs',
          enabled: true,
        },
      })
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('returns a cancelled result when the Skill folder picker is dismissed', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-skill-main-process-cancel-'))
    electronMocks.showOpenDialog.mockResolvedValue({
      canceled: true,
      filePaths: [],
    })
    const service = createElectronSkillRegistryService({
      prepareRuntimePaths: vi.fn(async () => createHostedRuntimePaths(tempRoot)),
      now: () => '2026-04-24T12:00:00.000Z',
    })

    try {
      await expect(service.selectAndImportSkill()).resolves.toEqual({ ok: true, cancelled: true })
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('retries runtime path initialization after a failed first attempt and caches the recovered service', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-skill-main-process-'))
    const appendLog = vi.fn()
    const hostedPaths = createHostedRuntimePaths(tempRoot)
    const prepareRuntimePaths = vi.fn(async () => hostedPaths)
    prepareRuntimePaths.mockRejectedValueOnce(new Error('runtime path bootstrap failed.'))

    const service = createElectronSkillRegistryService({
      prepareRuntimePaths,
      appendLog,
      now: () => '2026-04-24T12:00:00.000Z',
    })

    try {
      await expect(service.loadRegistry({ includeDisabled: true })).resolves.toEqual({
        ok: false,
        error: 'Failed to load the skill registry: runtime path bootstrap failed.',
        code: 'internal_error',
      })

      const expectedLoadResult = {
        ok: true as const,
        registryRevision: 1,
        snapshotRevision: 1,
        skills: [expect.objectContaining({
          skillId: 'builtin-placeholder-skill',
          source: 'builtin',
          enabled: true,
        })],
      }

      await expect(service.loadRegistry({ includeDisabled: true })).resolves.toEqual(expectedLoadResult)
      await expect(service.loadRegistry({ includeDisabled: true })).resolves.toEqual(expectedLoadResult)

      expect(prepareRuntimePaths).toHaveBeenCalledTimes(2)
      expect(appendLog).toHaveBeenCalledWith(
        'error',
        '[skill-registry] Failed to load the skill registry.',
        { detail: 'runtime path bootstrap failed.' },
      )
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})

async function createSkillPackage(root: string): Promise<void> {
  await mkdir(root, { recursive: true })
  await writeFile(
    path.join(root, 'SKILL.md'),
    '---\nname: writing-clear-docs\ndescription: 帮助模型编写结构清晰、面向开发者的技术文档。\n---\n# 清晰文档写作\n\n用于编写结构清晰的开发者文档。\n\n- 参考资源：`resources/checklist.md`\n',
    'utf8',
  )
  await mkdir(path.join(root, 'resources'), { recursive: true })
  await writeFile(path.join(root, 'resources', 'checklist.md'), '文档检查清单。\n', 'utf8')
}

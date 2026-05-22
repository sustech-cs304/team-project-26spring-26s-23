import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildBuiltinSkillRootCandidates,
  discoverBuiltinSkillSources,
  resolveBuiltinSkillsSourceRoot,
} from './builtin-skill-loader'

describe('builtin skill loader', () => {
  it('includes electron-builder extraResources builtin-skills directory as the first packaged candidate', () => {
    const resourcesPath = path.join('D:', 'Programs', 'CanDue', 'resources')
    const candidates = buildBuiltinSkillRootCandidates({
      moduleDir: path.join(resourcesPath, 'app.asar', 'dist-electron'),
      cwd: path.join('D:', 'Programs', 'CanDue'),
    })

    expect(candidates[0]).toBe(path.resolve(resourcesPath, 'builtin-skills'))
  })

  it('resolves and discovers builtin skills from the packaged resources directory', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-packaged-builtin-skills-'))
    const resourcesPath = path.join(tempRoot, 'resources')
    const builtinSkillsRoot = path.join(resourcesPath, 'builtin-skills')

    try {
      await createSkillPackage(path.join(builtinSkillsRoot, 'course-materials-qa'))
      await writeFile(path.join(builtinSkillsRoot, 'README.md'), 'not a skill directory\n', 'utf8')

      await expect(resolveBuiltinSkillsSourceRoot({
        candidateContext: {
          moduleDir: path.join(resourcesPath, 'app.asar', 'dist-electron'),
          cwd: tempRoot,
        },
      })).resolves.toBe(path.resolve(builtinSkillsRoot))

      await expect(discoverBuiltinSkillSources({
        candidateContext: {
          moduleDir: path.join(resourcesPath, 'app.asar', 'dist-electron'),
          cwd: tempRoot,
        },
      })).resolves.toEqual([
        {
          skillId: 'course-materials-qa',
          sourceDirectory: path.join(builtinSkillsRoot, 'course-materials-qa'),
          enabledByDefault: true,
        },
      ])
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})

async function createSkillPackage(root: string): Promise<void> {
  await mkdir(root, { recursive: true })
  await writeFile(
    path.join(root, 'SKILL.md'),
    '---\nname: course-materials-qa\ndescription: 基于课程资料回答问题。\n---\n# 课程资料问答\n',
    'utf8',
  )
}

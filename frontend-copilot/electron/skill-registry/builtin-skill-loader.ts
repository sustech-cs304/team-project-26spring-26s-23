import { access, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const BUILTIN_SKILLS_DIR_NAME = 'builtin-skills'

export interface BuiltinSkillSource {
  skillId: string
  sourceDirectory: string
  enabledByDefault: boolean
}

export async function resolveBuiltinSkillsSourceRoot(): Promise<string> {
  const candidates = [
    path.join(path.resolve(MODULE_DIR, '..', '..'), BUILTIN_SKILLS_DIR_NAME),
    path.join(path.resolve(MODULE_DIR, '..', '..', '..'), 'frontend-copilot', BUILTIN_SKILLS_DIR_NAME),
    path.join(path.resolve(MODULE_DIR, '..', '..', '..'), BUILTIN_SKILLS_DIR_NAME),
    path.join(process.cwd(), 'frontend-copilot', BUILTIN_SKILLS_DIR_NAME),
    path.join(process.cwd(), BUILTIN_SKILLS_DIR_NAME),
  ]

  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // try next candidate
    }
  }

  throw new Error(`Builtin skills source directory was not found. Checked: ${candidates.join(', ')}`)
}

export async function discoverBuiltinSkillSources(): Promise<BuiltinSkillSource[]> {
  const rootDirectory = await resolveBuiltinSkillsSourceRoot()
  const entries = await readdir(rootDirectory, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      skillId: entry.name,
      sourceDirectory: path.join(rootDirectory, entry.name),
      enabledByDefault: true,
    }))
    .sort((left, right) => left.skillId.localeCompare(right.skillId, 'en'))
}

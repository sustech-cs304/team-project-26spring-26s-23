import { access, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const BUILTIN_SKILLS_DIR_NAME = 'builtin-skills'

interface BuiltinSkillRootCandidateContext {
  moduleDir: string
  cwd: string
}

interface ResolveBuiltinSkillsSourceRootOptions {
  candidates?: readonly string[]
  candidateContext?: Partial<BuiltinSkillRootCandidateContext>
}

export function buildBuiltinSkillRootCandidates(
  context: Partial<BuiltinSkillRootCandidateContext> = {},
): string[] {
  const moduleDir = context.moduleDir ?? MODULE_DIR
  const cwd = context.cwd ?? process.cwd()
  const rawCandidates = [
    path.join(path.resolve(moduleDir, '..', '..'), BUILTIN_SKILLS_DIR_NAME),
    path.join(path.resolve(moduleDir, '..', '..', '..'), 'frontend-copilot', BUILTIN_SKILLS_DIR_NAME),
    path.join(path.resolve(moduleDir, '..', '..', '..'), BUILTIN_SKILLS_DIR_NAME),
    path.join(cwd, BUILTIN_SKILLS_DIR_NAME),
    path.join(cwd, 'frontend-copilot', BUILTIN_SKILLS_DIR_NAME),
  ]

  return [...new Set(rawCandidates.map((candidate) => path.resolve(candidate)))]
}

export interface BuiltinSkillSource {
  skillId: string
  sourceDirectory: string
  enabledByDefault: boolean
}

export async function resolveBuiltinSkillsSourceRoot(
  options: ResolveBuiltinSkillsSourceRootOptions = {},
): Promise<string> {
  const candidates = options.candidates ?? buildBuiltinSkillRootCandidates(options.candidateContext)

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

export async function discoverBuiltinSkillSources(
  options: ResolveBuiltinSkillsSourceRootOptions = {},
): Promise<BuiltinSkillSource[]> {
  const rootDirectory = await resolveBuiltinSkillsSourceRoot(options)
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

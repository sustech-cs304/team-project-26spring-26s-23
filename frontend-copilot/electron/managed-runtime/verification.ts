import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { promisify } from 'node:util'
import { resolveWindowsCommandChain } from './command-resolution'

const execFileAsync = promisify(execFile)
const SEMVER_OUTPUT_PATTERN = /\b\d+\.\d+\.\d+\b/u

export interface ManagedRuntimeCommandRunner {
  run: (command: string, args: readonly string[]) => Promise<string>
}

export interface ManagedRuntimeVerificationPlan {
  launcher: string
  executablePath: string
  args: readonly string[]
  requiredPaths?: readonly string[]
  expectIncludes?: string
  expectPattern?: RegExp
  expectVersion?: string
}

export interface ManagedRuntimeVerificationResult {
  summary: string
  launchers: Record<string, string>
}

export class ManagedRuntimeVerificationFailure extends Error {
  constructor(readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'ManagedRuntimeVerificationFailure'
  }
}

export function createManagedRuntimeCommandRunner(): ManagedRuntimeCommandRunner {
  return {
    async run(command, args) {
      const windowsCommandChain = resolveWindowsCommandChain(command)
      const invocation = windowsCommandChain === null
        ? { command, args: [...args] }
        : {
            command: windowsCommandChain.command,
            args: [...windowsCommandChain.argsPrefix, ...args],
          }
      const result = await execFileAsync(invocation.command, invocation.args, { windowsHide: true })
      return `${result.stdout}${result.stderr}`.trim()
    },
  }
}

export async function verifyManagedRuntimeLaunchers(
  plans: readonly ManagedRuntimeVerificationPlan[],
  runner?: ManagedRuntimeCommandRunner,
): Promise<ManagedRuntimeVerificationResult> {
  const activeRunner = runner ?? createManagedRuntimeCommandRunner()
  const executableAccessMode = process.platform === 'win32' ? fsConstants.F_OK : fsConstants.F_OK | fsConstants.X_OK
  const launchers: Record<string, string> = {}
  const fragments: string[] = []

  for (const plan of plans) {
    await verifyManagedRuntimePlanAccess(plan, executableAccessMode)
    const output = await activeRunner.run(plan.executablePath, plan.args)
    verifyManagedRuntimePlanOutput(plan, output)
    launchers[plan.launcher] = plan.executablePath
    fragments.push(`${plan.launcher}: ${output}`)
  }

  return {
    summary: fragments.join(' | '),
    launchers,
  }
}

async function verifyManagedRuntimePlanAccess(
  plan: ManagedRuntimeVerificationPlan,
  executableAccessMode: number,
): Promise<void> {
  await access(plan.executablePath, executableAccessMode)
  if (plan.requiredPaths) {
    await Promise.all(plan.requiredPaths.map(async (requiredPath) => await access(requiredPath, fsConstants.F_OK)))
  }
}

function verifyManagedRuntimePlanOutput(plan: ManagedRuntimeVerificationPlan, output: string): void {
  if (plan.expectIncludes && !output.includes(plan.expectIncludes)) {
    throw new Error(`Launcher ${plan.launcher} returned unexpected output: ${output}`)
  }
  if (plan.expectPattern && !plan.expectPattern.test(output)) {
    throw new Error(`Launcher ${plan.launcher} returned malformed version output: ${output}`)
  }
  if (plan.expectVersion) {
    verifyManagedRuntimePlanVersion(plan.launcher, plan.expectVersion, output)
  }
}

function verifyManagedRuntimePlanVersion(launcher: string, expectVersion: string, output: string): void {
  const version = extractSemver(output)
  if (version === null) {
    throw new Error(`Launcher ${launcher} returned malformed version output: ${output}`)
  }
  if (version !== expectVersion) {
    throw new Error(`Launcher ${launcher} returned unexpected version ${version}: ${output}`)
  }
}

function extractSemver(output: string): string | null {
  return output.match(SEMVER_OUTPUT_PATTERN)?.[0] ?? null
}

import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface ManagedRuntimeCommandRunner {
  run: (command: string, args: readonly string[]) => Promise<string>
}

export interface ManagedRuntimeVerificationPlan {
  launcher: string
  executablePath: string
  args: readonly string[]
  expectIncludes?: string
  expectPattern?: RegExp
}

export interface ManagedRuntimeVerificationResult {
  summary: string
  launchers: Record<string, string>
}

export function createManagedRuntimeCommandRunner(): ManagedRuntimeCommandRunner {
  return {
    async run(command, args) {
      const result = await execFileAsync(command, [...args], { windowsHide: true })
      return `${result.stdout}${result.stderr}`.trim()
    },
  }
}

export async function verifyManagedRuntimeLaunchers(
  plans: readonly ManagedRuntimeVerificationPlan[],
  runner?: ManagedRuntimeCommandRunner,
): Promise<ManagedRuntimeVerificationResult> {
  const activeRunner = runner ?? createManagedRuntimeCommandRunner()
  const launchers: Record<string, string> = {}
  const fragments: string[] = []

  for (const plan of plans) {
    await access(plan.executablePath, fsConstants.F_OK)
    const output = await activeRunner.run(plan.executablePath, plan.args)
    if (plan.expectIncludes && !output.includes(plan.expectIncludes)) {
      throw new Error(`Launcher ${plan.launcher} returned unexpected output: ${output}`)
    }
    if (plan.expectPattern && !plan.expectPattern.test(output)) {
      throw new Error(`Launcher ${plan.launcher} returned malformed version output: ${output}`)
    }

    launchers[plan.launcher] = plan.executablePath
    fragments.push(`${plan.launcher}: ${output}`)
  }

  return {
    summary: fragments.join(' | '),
    launchers,
  }
}

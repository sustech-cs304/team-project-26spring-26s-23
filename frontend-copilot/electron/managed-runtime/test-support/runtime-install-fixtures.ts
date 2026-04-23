import { chmod, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function createRuntimeLauncherFiles(
  destinationDir: string,
  launchers: Record<string, string>,
): Promise<void> {
  await Promise.all(
    Object.values(launchers).map(async (relativePath) => {
      const filePath = path.join(destinationDir, relativePath)
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, 'fixture')
      await chmod(filePath, 0o755)
    }),
  )
}

export async function createNodeRuntimeFixture(
  destinationDir: string,
  launchers: Record<string, string>,
): Promise<void> {
  await createRuntimeLauncherFiles(destinationDir, launchers)
  const usesPosixLayout = Object.values(launchers).some((relativePath) => relativePath.startsWith('bin/'))
  const npmScriptsRoot = usesPosixLayout
    ? path.join(destinationDir, 'lib', 'node_modules', 'npm', 'bin')
    : path.join(destinationDir, 'node_modules', 'npm', 'bin')
  await mkdir(npmScriptsRoot, { recursive: true })
  await Promise.all([
    writeFile(path.join(npmScriptsRoot, 'npm-cli.js'), 'console.log("fixture")\n'),
    writeFile(path.join(npmScriptsRoot, 'npx-cli.js'), 'console.log("fixture")\n'),
  ])
}

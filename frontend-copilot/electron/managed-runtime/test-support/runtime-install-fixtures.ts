import { mkdir, writeFile } from 'node:fs/promises'
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
    }),
  )
}

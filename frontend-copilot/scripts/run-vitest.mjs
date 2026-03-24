import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

process.chdir(normalizeWindowsDriveLetter(projectRoot))

const vitestCliPath = path.join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs')
const result = spawnSync(process.execPath, [vitestCliPath, 'run'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env,
})

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)

function normalizeWindowsDriveLetter(filePath) {
  if (process.platform !== 'win32') {
    return filePath
  }

  return filePath.replace(/^[a-z]:/, (drivePrefix) => drivePrefix.toUpperCase())
}

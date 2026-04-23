import { execFile } from 'node:child_process'
import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { promisify } from 'node:util'
import path from 'node:path'
import extractZip from 'extract-zip'
import type { ManagedRuntimeArchiveFormat } from './types'

const execFileAsync = promisify(execFile)

export interface ManagedRuntimeArchiveExtractor {
  extract: (archiveFile: string, destinationDir: string, archiveFormat: ManagedRuntimeArchiveFormat) => Promise<void>
}

export function createManagedRuntimeArchiveExtractor(): ManagedRuntimeArchiveExtractor {
  return {
    async extract(archiveFile, destinationDir, archiveFormat) {
      await extractManagedRuntimeArchive(archiveFile, destinationDir, archiveFormat)
    },
  }
}

export async function extractManagedRuntimeArchive(
  archiveFile: string,
  destinationDir: string,
  archiveFormat: ManagedRuntimeArchiveFormat,
): Promise<void> {
  await rm(destinationDir, { recursive: true, force: true })
  await mkdir(destinationDir, { recursive: true })

  if (archiveFormat === 'pkg' || archiveFormat === 'source-tar.xz') {
    throw new Error(`Archive format ${archiveFormat} is not supported by the managed runtime installer.`)
  }

  if (archiveFormat === 'zip') {
    if (process.platform === 'win32') {
      await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${escapePowerShell(archiveFile)}' -DestinationPath '${escapePowerShell(destinationDir)}' -Force`,
      ])
    } else {
      await extractZip(archiveFile, { dir: destinationDir })
    }
  } else if (archiveFormat === 'tar.gz') {
    await execFileAsync('tar', ['-xzf', archiveFile, '-C', destinationDir])
  } else if (archiveFormat === 'tar.xz') {
    await execFileAsync('tar', ['-xJf', archiveFile, '-C', destinationDir])
  } else if (archiveFormat === 'tar.zst') {
    await execFileAsync('tar', ['--use-compress-program', 'zstd', '-xf', archiveFile, '-C', destinationDir])
  }

  await normalizeSingleRootDirectory(destinationDir)
}

async function normalizeSingleRootDirectory(destinationDir: string): Promise<void> {
  const entries = await readdir(destinationDir, { withFileTypes: true })
  const directories = entries.filter((entry) => entry.isDirectory())
  const files = entries.filter((entry) => entry.isFile())

  if (directories.length !== 1 || files.length > 0) {
    return
  }

  const nestedRoot = path.join(destinationDir, directories[0]!.name)
  const nestedEntries = await readdir(nestedRoot)
  await Promise.all(
    nestedEntries.map(async (entry) => rename(path.join(nestedRoot, entry), path.join(destinationDir, entry))),
  )
  await rm(nestedRoot, { recursive: true, force: true })
}

function escapePowerShell(input: string): string {
  return input.replace(/'/g, "''")
}

import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ManagedRuntimeResolvedDownloadSource } from './download-source'

export interface ManagedRuntimeDownloadClient {
  downloadToFile: (url: string, destinationFile: string) => Promise<void>
  downloadText: (url: string) => Promise<string>
}

export interface ManagedRuntimeDownloadArtifactOptions {
  source: ManagedRuntimeResolvedDownloadSource
  cacheDir: string
  client?: ManagedRuntimeDownloadClient
}

export interface ManagedRuntimeDownloadedArtifact {
  artifactFile: string
  downloaded: boolean
}

export function createManagedRuntimeDownloadClient(): ManagedRuntimeDownloadClient {
  return {
    async downloadToFile(url, destinationFile) {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status} for ${url}`)
      }

      const arrayBuffer = await response.arrayBuffer()
      await mkdir(path.dirname(destinationFile), { recursive: true })
      await writeFile(destinationFile, Buffer.from(arrayBuffer))
    },
    async downloadText(url) {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Checksum download failed with status ${response.status} for ${url}`)
      }

      return await response.text()
    },
  }
}

export async function downloadManagedRuntimeArtifact(
  options: ManagedRuntimeDownloadArtifactOptions,
): Promise<ManagedRuntimeDownloadedArtifact> {
  if (options.source.url === null) {
    throw new Error(`Managed runtime component ${options.source.component} does not provide a downloadable URL.`)
  }

  const client = options.client ?? createManagedRuntimeDownloadClient()
  const artifactFile = path.join(options.cacheDir, options.source.fileName)

  await mkdir(options.cacheDir, { recursive: true })

  try {
    const existing = await stat(artifactFile)
    if (existing.isFile() && existing.size > 0) {
      return { artifactFile, downloaded: false }
    }
  } catch {
    // cache miss
  }

  await client.downloadToFile(options.source.url, artifactFile)
  return { artifactFile, downloaded: true }
}

export async function verifyManagedRuntimeArtifactChecksum(
  source: ManagedRuntimeResolvedDownloadSource,
  artifactFile: string,
  client?: ManagedRuntimeDownloadClient,
): Promise<void> {
  if (source.checksumUrl === null) {
    return
  }

  const activeClient = client ?? createManagedRuntimeDownloadClient()
  const checksumContents = await activeClient.downloadText(source.checksumUrl)
  const expectedChecksum = extractExpectedChecksum(checksumContents, source.fileName)

  if (expectedChecksum === null) {
    throw new Error(`Could not find checksum entry for ${source.fileName}`)
  }

  const actualChecksum = createHash('sha256').update(await readFile(artifactFile)).digest('hex')
  if (actualChecksum.toLowerCase() !== expectedChecksum.toLowerCase()) {
    throw new Error(`Checksum mismatch for ${source.fileName}`)
  }
}

function extractExpectedChecksum(checksumContents: string, fileName: string): string | null {
  for (const line of checksumContents.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      continue
    }

    const sha256Match = trimmed.match(/^([a-fA-F0-9]{64})\s+(?:\*?)(.+)$/)
    if (sha256Match && sha256Match[2]?.trim().endsWith(fileName)) {
      return sha256Match[1] ?? null
    }
  }

  return checksumContents.trim().match(/^[a-fA-F0-9]{64}$/)?.[0] ?? null
}

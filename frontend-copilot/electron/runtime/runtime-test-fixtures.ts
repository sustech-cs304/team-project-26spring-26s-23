import { chmod, mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  BUNDLED_RUNTIME_MANIFEST_FILE_NAME,
  DESKTOP_RUNTIME_ENTRY_MODULE,
} from './python-runtime-resolver'

export interface BundledRuntimeFixture {
  tempRoot: string
  resourcesPath: string
  bundledRuntimeRoot: string
  manifestPath: string
  backendDir: string
  pythonExecutablePath: string
  pythonPackagesDir: string
}

export async function createBundledRuntimeFixture(): Promise<BundledRuntimeFixture> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-bundled-runtime-'))
  const resourcesPath = path.join(tempRoot, 'resources')
  const bundledRuntimeRoot = path.join(resourcesPath, 'python-runtime')
  const backendDir = path.join(bundledRuntimeRoot, 'backend')
  const pythonPackagesDir = path.join(bundledRuntimeRoot, 'python-packages')
  const pythonExecutableRelativePath = process.platform === 'win32'
    ? path.join('python', 'python.exe')
    : path.join('python', 'bin', 'python3')
  const pythonExecutablePath = path.join(bundledRuntimeRoot, pythonExecutableRelativePath)
  const desktopRuntimeEntryPath = path.join(backendDir, 'app', 'desktop_runtime', '__main__.py')
  const metadataDir = path.join(bundledRuntimeRoot, 'metadata')
  const requirementsPath = path.join(metadataDir, 'backend-requirements.txt')
  const manifestPath = path.join(bundledRuntimeRoot, BUNDLED_RUNTIME_MANIFEST_FILE_NAME)

  await Promise.all([
    mkdir(path.dirname(pythonExecutablePath), { recursive: true }),
    mkdir(path.dirname(desktopRuntimeEntryPath), { recursive: true }),
    mkdir(pythonPackagesDir, { recursive: true }),
    mkdir(metadataDir, { recursive: true }),
  ])

  await Promise.all([
    writeFile(pythonExecutablePath, ''),
    writeFile(desktopRuntimeEntryPath, 'raise SystemExit(0)\n'),
    writeFile(requirementsPath, 'fastapi==0.115.14\n'),
    writeFile(manifestPath, `${JSON.stringify({
      manifestVersion: 1,
      resourceLayoutVersion: 1,
      runtimeMode: 'bundled',
      generatedAt: '2026-03-23T00:00:00.000Z',
      platform: process.platform,
      arch: process.arch,
      python: {
        runtimeRootRelativePath: 'python',
        executableRelativePath: toPosixPath(pythonExecutableRelativePath),
        version: 'Python 3.12.9',
      },
      backend: {
        workingDirectoryRelativePath: 'backend',
        entryModule: DESKTOP_RUNTIME_ENTRY_MODULE,
        pythonPathRelativePaths: ['backend', 'python-packages'],
        sitePackagesRelativePaths: ['python-packages'],
      },
      metadata: {
        frontendVersion: '0.0.0',
        backendVersion: '0.1.0',
        requirementsRelativePath: 'metadata/backend-requirements.txt',
        stagingTool: 'frontend-copilot/scripts/prepare-bundled-runtime.mjs',
      },
    }, null, 2)}\n`, 'utf8'),
  ])

  return {
    tempRoot,
    resourcesPath,
    bundledRuntimeRoot,
    manifestPath,
    backendDir,
    pythonExecutablePath,
    pythonPackagesDir,
  }
}

export interface DevelopmentRuntimeFixture {
  tempRoot: string
  appRoot: string
  backendDir: string
  pythonExecutablePath: string
}

export async function createDevelopmentRuntimeFixture(): Promise<DevelopmentRuntimeFixture> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-development-runtime-'))
  const appRoot = path.join(tempRoot, 'frontend-copilot')
  const backendDir = path.join(tempRoot, 'backend')
  const pythonExecutablePath = process.platform === 'win32'
    ? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
    : path.join(backendDir, '.venv', 'bin', 'python')
  const desktopRuntimeEntryPath = path.join(backendDir, 'app', 'desktop_runtime', '__main__.py')

  await Promise.all([
    mkdir(appRoot, { recursive: true }),
    mkdir(path.dirname(pythonExecutablePath), { recursive: true }),
    mkdir(path.dirname(desktopRuntimeEntryPath), { recursive: true }),
  ])

  await Promise.all([
    writeFile(path.join(backendDir, 'pyproject.toml'), '[project]\nname = "backend"\nversion = "0.0.0"\n', 'utf8'),
    writeFile(pythonExecutablePath, '', 'utf8'),
    writeFile(desktopRuntimeEntryPath, 'raise SystemExit(0)\n', 'utf8'),
  ])

  return {
    tempRoot,
    appRoot,
    backendDir,
    pythonExecutablePath,
  }
}

export async function writeSuccessfulCommandProbe(directory: string, commandName: string): Promise<void> {
  const commandPath = process.platform === 'win32'
    ? path.join(directory, `${commandName}.cmd`)
    : path.join(directory, commandName)
  const scriptContent = process.platform === 'win32'
    ? '@echo off\r\nexit /b 0\r\n'
    : '#!/bin/sh\nexit 0\n'

  await mkdir(directory, { recursive: true })
  await writeFile(commandPath, scriptContent, 'utf8')

  if (process.platform !== 'win32') {
    await chmod(commandPath, 0o755)
  }
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/')
}

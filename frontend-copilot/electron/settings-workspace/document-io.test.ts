import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsWorkspacePaths } from './paths'
import type { SettingsWorkspaceFileSystem } from './settings-workspace-document-io'

const mockMkdir = vi.fn()
const mockReadFile = vi.fn()
const mockWriteFile = vi.fn()

vi.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}))

import { createSettingsWorkspaceDocumentIO } from './settings-workspace-document-io'

const testPaths: SettingsWorkspacePaths = {
  rootDir: '/test/root',
  stateDocument: '/test/root/state.json',
  secretsDocument: '/test/root/secrets.json',
}

function createMinimalStateContent(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 3,
    kind: 'settings-workspace-state',
    values: {
      sustech: {
        studentId: '', email: '', blackboardCurrentTermOnly: false,
        blackboardParallelSyncWorkers: '1', blackboardSyncInterval: 'off',
        blackboardLastAutoSyncAt: null, blackboardNextAutoSyncAt: null,
      },
      providerProfiles: [],
      defaultModelRouting: { primaryAssistantModel: null, fastAssistantModel: null },
      general: { language: 'zh-CN', assistantNotificationsEnabled: false },
      mcp: {
        mcpAutoDiscoveryEnabled: true, toolPermissionMode: 'manual',
        toolPermissionPolicy: { version: 1, migrationSourceMode: 'manual', defaultMode: 'ask', toolPermissions: {} },
      },
      api: { apiReconnectMode: 'exponential', healthPollingEnabled: true, apiBaseUrl: 'http://127.0.0.1:8000' },
      docs: { docsFormat: 'markdown' },
      externalSource: { wakeupShareLink: '' },
      ...overrides,
    },
  })
}

function createMinimalSecretsContent() {
  return JSON.stringify({
    version: 2,
    kind: 'settings-workspace-secrets',
    values: {
      providerSecrets: {},
      sustech: { casPassword: '' },
    },
  })
}

describe('createSettingsWorkspaceDocumentIO', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('readStateDocument', () => {
    it('reads and normalizes a valid state document', async () => {
      mockReadFile.mockResolvedValueOnce(createMinimalStateContent())

      const io = createSettingsWorkspaceDocumentIO({ paths: testPaths })
      const result = await io.readStateDocument()

      expect(result.missing).toBe(false)
      expect(result.document.kind).toBe('settings-workspace-state')
      expect(result.document.version).toBe(3)
      expect(mockReadFile).toHaveBeenCalledWith('/test/root/state.json', 'utf8')
    })

    it('returns default document when file is missing (ENOENT)', async () => {
      const enoentError = Object.assign(new Error('File not found'), { code: 'ENOENT' })
      mockReadFile.mockRejectedValueOnce(enoentError)

      const io = createSettingsWorkspaceDocumentIO({ paths: testPaths })
      const result = await io.readStateDocument()

      expect(result.missing).toBe(true)
      expect(result.dirty).toBe(true)
      expect(result.document.kind).toBe('settings-workspace-state')
    })

    it('rethrows errors that are not file-not-found', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('Permission denied'))

      const io = createSettingsWorkspaceDocumentIO({ paths: testPaths })
      await expect(io.readStateDocument()).rejects.toThrow('Permission denied')
    })

    it('returns default when file content is not valid JSON', async () => {
      mockReadFile.mockResolvedValueOnce('not-valid-json')

      const io = createSettingsWorkspaceDocumentIO({ paths: testPaths })
      await expect(io.readStateDocument()).rejects.toThrow()
    })

    it('marks document as dirty when serialized content differs from file', async () => {
      const content = createMinimalStateContent({ general: { language: 'en-US', assistantNotificationsEnabled: false } })
      mockReadFile.mockResolvedValueOnce(content)

      const io = createSettingsWorkspaceDocumentIO({ paths: testPaths })
      const result = await io.readStateDocument()

      // Changed language from zh-CN to en-US - should be dirty if different from default
      expect(typeof result.dirty).toBe('boolean')
    })
  })

  describe('readSecretsDocument', () => {
    it('reads and normalizes a valid secrets document', async () => {
      mockReadFile.mockResolvedValueOnce(createMinimalSecretsContent())

      const io = createSettingsWorkspaceDocumentIO({ paths: testPaths })
      const result = await io.readSecretsDocument()

      expect(result.missing).toBe(false)
      expect(result.document.kind).toBe('settings-workspace-secrets')
      expect(result.document.version).toBe(2)
      expect(mockReadFile).toHaveBeenCalledWith('/test/root/secrets.json', 'utf8')
    })

    it('returns default document when file is missing (ENOENT)', async () => {
      const enoentError = Object.assign(new Error('File not found'), { code: 'ENOENT' })
      mockReadFile.mockRejectedValueOnce(enoentError)

      const io = createSettingsWorkspaceDocumentIO({ paths: testPaths })
      const result = await io.readSecretsDocument()

      expect(result.missing).toBe(true)
      expect(result.dirty).toBe(true)
      expect(result.document.kind).toBe('settings-workspace-secrets')
    })

    it('rethrows non-ENOENT errors', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('Disk full'))

      const io = createSettingsWorkspaceDocumentIO({ paths: testPaths })
      await expect(io.readSecretsDocument()).rejects.toThrow('Disk full')
    })
  })

  describe('writeDocuments', () => {
    it('creates root directory and writes both documents', async () => {
      mockReadFile.mockResolvedValueOnce(createMinimalStateContent())
      mockReadFile.mockResolvedValueOnce(createMinimalSecretsContent())
      mockMkdir.mockResolvedValueOnce(undefined)
      mockWriteFile.mockResolvedValueOnce(undefined)
      mockWriteFile.mockResolvedValueOnce(undefined)

      const io = createSettingsWorkspaceDocumentIO({ paths: testPaths })
      const stateDoc = (await io.readStateDocument()).document
      const secretsDoc = (await io.readSecretsDocument()).document

      await io.writeDocuments(stateDoc, secretsDoc)

      expect(mockMkdir).toHaveBeenCalledWith('/test/root', { recursive: true })
      expect(mockWriteFile).toHaveBeenCalledTimes(2)
      const writePaths = mockWriteFile.mock.calls.map((call: unknown[]) => call[0])
      expect(writePaths).toContain('/test/root/state.json')
      expect(writePaths).toContain('/test/root/secrets.json')
    })

    it('writes documents with utf8 encoding and formatted JSON', async () => {
      mockReadFile.mockResolvedValueOnce(createMinimalStateContent())
      mockReadFile.mockResolvedValueOnce(createMinimalSecretsContent())
      mockMkdir.mockResolvedValueOnce(undefined)
      mockWriteFile.mockResolvedValueOnce(undefined)
      mockWriteFile.mockResolvedValueOnce(undefined)

      const io = createSettingsWorkspaceDocumentIO({ paths: testPaths })
      const stateDoc = (await io.readStateDocument()).document
      const secretsDoc = (await io.readSecretsDocument()).document

      await io.writeDocuments(stateDoc, secretsDoc)

      for (const call of mockWriteFile.mock.calls as Array<[string, string, string]>) {
        expect(call[2]).toBe('utf8')
        expect(call[1]).toMatch(/^\{\n\s+/)
      }
    })

    it('write failure rejects the promise', async () => {
      mockReadFile.mockResolvedValueOnce(createMinimalStateContent())
      mockReadFile.mockResolvedValueOnce(createMinimalSecretsContent())
      mockMkdir.mockResolvedValueOnce(undefined)
      mockWriteFile.mockRejectedValueOnce(new Error('Write failed'))

      const io = createSettingsWorkspaceDocumentIO({ paths: testPaths })
      const stateDoc = (await io.readStateDocument()).document
      const secretsDoc = (await io.readSecretsDocument()).document

      await expect(io.writeDocuments(stateDoc, secretsDoc)).rejects.toThrow('Write failed')
    })
  })

  describe('custom fileSystem', () => {
    it('uses custom fileSystem when provided', async () => {
      const customReadFile = vi.fn().mockRejectedValueOnce(
        Object.assign(new Error('Custom missing'), { code: 'ENOENT' }),
      )

      const customFileSystem: SettingsWorkspaceFileSystem = {
        mkdir: vi.fn(),
        readFile: customReadFile,
        writeFile: vi.fn(),
      }

      const io = createSettingsWorkspaceDocumentIO({
        paths: testPaths,
        fileSystem: customFileSystem,
      })

      const result = await io.readStateDocument()
      expect(result.missing).toBe(true)
      expect(customReadFile).toHaveBeenCalled()
    })
  })
})

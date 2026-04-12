import {
  createSettingsWorkspaceSecretsDocument,
  type SettingsWorkspaceSecretsDocument,
} from './secret-schema'
import type { SettingsWorkspaceStateDocument } from './state-schema'

export function serializeSettingsWorkspaceDocument(
  document: SettingsWorkspaceStateDocument | SettingsWorkspaceSecretsDocument,
): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

export function pruneSettingsWorkspaceSecretsDocument(
  document: SettingsWorkspaceSecretsDocument,
  validProviderIds: ReadonlySet<string>,
): SettingsWorkspaceSecretsDocument {
  return createSettingsWorkspaceSecretsDocument({
    providerSecrets: Object.fromEntries(
      Object.entries(document.values.providerSecrets).filter(([providerId]) => validProviderIds.has(providerId)),
    ),
    sustech: document.values.sustech,
  })
}

export function normalizeSettingsWorkspaceIdentifier(value: string, name: string): string {
  const normalized = value.trim()

  if (normalized === '') {
    throw new Error(`Missing required ${name}.`)
  }

  return normalized
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`
}

export function isSettingsWorkspaceDocumentDirty(
  document: SettingsWorkspaceStateDocument | SettingsWorkspaceSecretsDocument,
  fileContent: string,
): boolean {
  return serializeSettingsWorkspaceDocument(document) !== ensureTrailingNewline(fileContent)
}

import { ProviderModelEditorDialog } from './ProviderModelEditorDialog'
import type { ProviderModelEditorMountDomain } from './ProviderProfilesSectionDomain'

interface ProviderModelEditorMountProps {
  modelEditor: ProviderModelEditorMountDomain
  language: string
}

export function ProviderModelEditorMount({ modelEditor, language }: ProviderModelEditorMountProps) {
  return (
    <ProviderModelEditorDialog
      language={language}
      modelEditorState={modelEditor.modelEditorState}
      providerProfile={modelEditor.activeProvider}
      modelEditorError={modelEditor.modelEditorError}
      onClose={modelEditor.onCloseModelEditor}
      onSave={modelEditor.onModelEditorSave}
      onStateChange={modelEditor.onModelEditorStateChange}
      onToggleCapability={modelEditor.onToggleModelCapability}
      onClearError={modelEditor.onClearModelEditorError}
    />
  )
}

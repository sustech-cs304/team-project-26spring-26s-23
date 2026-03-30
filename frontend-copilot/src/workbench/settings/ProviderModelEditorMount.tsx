import { ProviderModelEditorDialog } from './ProviderModelEditorDialog'
import type { ProviderModelEditorMountDomain } from './ProviderProfilesSectionDomain'

interface ProviderModelEditorMountProps {
  modelEditor: ProviderModelEditorMountDomain
}

export function ProviderModelEditorMount({ modelEditor }: ProviderModelEditorMountProps) {
  return (
    <ProviderModelEditorDialog
      modelEditorState={modelEditor.modelEditorState}
      modelEditorError={modelEditor.modelEditorError}
      onClose={modelEditor.onCloseModelEditor}
      onSave={modelEditor.onModelEditorSave}
      onStateChange={modelEditor.onModelEditorStateChange}
      onToggleCapability={modelEditor.onToggleModelCapability}
      onClearError={modelEditor.onClearModelEditorError}
    />
  )
}

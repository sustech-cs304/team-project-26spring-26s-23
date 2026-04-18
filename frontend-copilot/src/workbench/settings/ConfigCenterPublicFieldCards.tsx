/* eslint-disable react-refresh/only-export-components */

import { getConfigCenterPublicFieldCopy } from '../locale'
import { ConfigCenterPublicTextFieldCard } from './ConfigCenterPublicFieldCard'
import { createHostConfigRuntimeUrlField } from './config-center-public-field-definitions'

export { hostConfigRuntimeUrlField } from './config-center-public-field-definitions'
export type {
  ConfigCenterPublicTextFieldDefinition,
} from './config-center-public-field-definitions'
export {
  applyConfigCenterPublicTextFieldFailure,
  applyConfigCenterPublicTextFieldSaveSuccess,
  applyDraftValueToConfigCenterPublicTextField,
  applyExternalSnapshotToConfigCenterPublicTextField,
  createConfigCenterPublicTextFieldState,
  createLoadingConfigCenterPublicTextFieldState,
  getConfigCenterPublicTextFieldStatusView,
  normalizeConfigCenterPublicTextFieldValue,
  shouldCommitConfigCenterPublicTextField,
  startSavingConfigCenterPublicTextField,
  syncEquivalentDraftToConfigCenterPublicTextField,
} from './config-center-public-field-state'
export type {
  ConfigCenterPublicTextFieldState,
  ConfigCenterPublicTextFieldStatus,
  ConfigCenterPublicTextFieldStatusView,
} from './config-center-public-field-state'
export { ConfigCenterPublicTextFieldCard } from './ConfigCenterPublicFieldCard'
export { handleConfigCenterPublicTextFieldKeyDown } from './config-center-public-field-card-keydown'
export { useConfigCenterPublicTextField } from './useConfigCenterPublicField'

export function HostConfigRuntimeOverrideCard({ language = 'zh-CN' }: { language?: string }) {
  const copy = getConfigCenterPublicFieldCopy(language)
  const definition = createHostConfigRuntimeUrlField({
    cardTitle: copy.hostConfigRuntimeUrlCardTitle,
    label: copy.hostConfigRuntimeUrlLabel,
  })

  return <ConfigCenterPublicTextFieldCard definition={definition} language={language} />
}

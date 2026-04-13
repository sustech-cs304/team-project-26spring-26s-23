import type { ConfigCenterPublicPatch } from '../../../../../electron/config-center/public-patch'
import type { ConfigCenterPublicSnapshot } from '../../../../../electron/config-center/public-snapshot'

export interface ConfigCenterPublicTextFieldDefinition {
  fieldId: string
  cardTitle: string
  label: string
  placeholder: string
  inputType?: 'text' | 'url'
  readFromSnapshot: (snapshot: ConfigCenterPublicSnapshot) => string | null
  createPatch: (value: string | null) => ConfigCenterPublicPatch
}

export function createHostConfigRuntimeUrlField(input: {
  cardTitle: string
  label: string
}): ConfigCenterPublicTextFieldDefinition {
  return {
    fieldId: 'hostConfig-runtimeUrl',
    cardTitle: input.cardTitle,
    label: input.label,
    placeholder: 'http://127.0.0.1:8765',
    inputType: 'url',
    readFromSnapshot: (snapshot) => snapshot.domains.hostConfig.runtimeUrl,
    createPatch: (value) => ({
      domains: {
        hostConfig: {
          runtimeUrl: value,
        },
      },
    }),
  }
}

export const hostConfigRuntimeUrlField: ConfigCenterPublicTextFieldDefinition = createHostConfigRuntimeUrlField({
  cardTitle: '宿主配置（开发态）',
  label: '开发态运行时覆盖地址',
})

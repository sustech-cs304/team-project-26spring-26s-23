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

export const hostConfigRuntimeUrlField: ConfigCenterPublicTextFieldDefinition = {
  fieldId: 'hostConfig-runtimeUrl',
  cardTitle: '宿主配置（开发态）',
  label: '开发态运行时覆盖地址',
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

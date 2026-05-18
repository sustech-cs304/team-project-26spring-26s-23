export const SUSTECH_BLACKBOARD_GET_STATUS_CHANNEL = 'sustech-blackboard:getStatus'
export const SUSTECH_BLACKBOARD_TRIGGER_SYNC_CHANNEL = 'sustech-blackboard:triggerSync'
export const SUSTECH_BLACKBOARD_UPDATE_SETTINGS_CHANNEL = 'sustech-blackboard:updateSettings'
export const SUSTECH_BLACKBOARD_SYNC_STATE_CHANGED_CHANNEL = 'sustech-blackboard:onSyncStateChanged'

import type {
  BlackboardSyncSettingsUpdateResult,
  BlackboardSyncStatusResult,
  BlackboardSyncTriggerResult,
} from './types'

export interface SustechBlackboardApi {
  getStatus: () => Promise<BlackboardSyncStatusResult>
  triggerSync: () => Promise<BlackboardSyncTriggerResult>
  updateSettings: (interval: string) => Promise<BlackboardSyncSettingsUpdateResult>
}

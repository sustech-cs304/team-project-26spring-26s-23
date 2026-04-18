import type { SelectOption } from '../../../types'
import type { DefaultModelRoutesSectionDomain } from '../../DefaultModelRoutesSection'

interface CreateDefaultModelRoutesSectionDomainArgs {
  primaryAssistantModel: string
  fastAssistantModel: string
  allModelOptions: SelectOption[]
  onPrimaryAssistantModelChange: (value: string) => void
  onFastAssistantModelChange: (value: string) => void
}

export function createDefaultModelRoutesSectionDomain(
  args: CreateDefaultModelRoutesSectionDomainArgs,
): DefaultModelRoutesSectionDomain {
  return {
    primaryAssistantModel: args.primaryAssistantModel,
    fastAssistantModel: args.fastAssistantModel,
    allModelOptions: [...args.allModelOptions],
    onPrimaryAssistantModelChange: args.onPrimaryAssistantModelChange,
    onFastAssistantModelChange: args.onFastAssistantModelChange,
  }
}

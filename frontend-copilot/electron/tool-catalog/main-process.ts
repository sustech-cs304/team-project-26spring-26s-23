import type { ToolCatalogLoadResult } from './ipc'
import type { ElectronToolCatalogService } from './service'

export interface ElectronToolCatalogMainProcessApi {
  loadToolCatalog: () => Promise<ToolCatalogLoadResult>
}

export interface CreateElectronToolCatalogMainProcessOptions {
  service: ElectronToolCatalogService
}

export function createElectronToolCatalogMainProcess(
  options: CreateElectronToolCatalogMainProcessOptions,
): ElectronToolCatalogMainProcessApi {
  const { service } = options

  return {
    async loadToolCatalog() {
      return await service.load()
    },
  }
}

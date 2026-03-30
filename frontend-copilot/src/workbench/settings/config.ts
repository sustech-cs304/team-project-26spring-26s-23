import type { ModelCapability, ProviderProfile, SelectOption } from '../types'

let nextModelProfileSequence = 0

export function createModelProfileId(providerId: string, modelId: string) {
  const sanitizedModelId = modelId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  nextModelProfileSequence += 1

  return `${providerId}-${sanitizedModelId || 'model'}-${nextModelProfileSequence}`
}

export const protocolOptions: SelectOption[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'openai-response', label: 'OpenAI-Response' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'ollama', label: 'Ollama' },
]

export const languageOptions: SelectOption[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' },
]

export const proxyModeOptions: SelectOption[] = [
  { value: 'system', label: '系统代理' },
  { value: 'direct', label: '直连' },
  { value: 'manual', label: '手动配置' },
]

export const themeOptions: SelectOption[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

export const backupCycleOptions: SelectOption[] = [
  { value: 'every-launch', label: '每次启动' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
]

export const toolPermissionOptions: SelectOption[] = [
  { value: 'manual', label: '逐次确认' },
  { value: 'trusted', label: '受信能力自动允许' },
  { value: 'strict', label: '严格手动' },
]

export const searchEngineOptions: SelectOption[] = [
  { value: 'google', label: 'Google' },
  { value: 'bing', label: 'Bing' },
  { value: 'baidu', label: 'Baidu' },
]

export const resultCountOptions: SelectOption[] = [
  { value: '5', label: '5 条' },
  { value: '8', label: '8 条' },
  { value: '12', label: '12 条' },
]

export const compressionOptions: SelectOption[] = [
  { value: 'summary', label: '摘要压缩' },
  { value: 'balanced', label: '平衡模式' },
  { value: 'none', label: '不压缩' },
]

export const memoryStrategyOptions: SelectOption[] = [
  { value: 'session-only', label: '仅会话内' },
  { value: 'session-longterm', label: '会话 + 长期记忆' },
  { value: 'project-centric', label: '项目优先' },
]

export const apiReconnectOptions: SelectOption[] = [
  { value: 'exponential', label: '指数退避' },
  { value: 'fixed', label: '固定间隔' },
  { value: 'manual', label: '手动重连' },
]

export const docsFormatOptions: SelectOption[] = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'html', label: 'HTML' },
  { value: 'pdf', label: 'PDF' },
]

export const modelCapabilityOptions: Array<{ value: ModelCapability; label: string }> = [
  { value: 'vision', label: '视觉' },
  { value: 'search', label: '联网' },
  { value: 'reasoning', label: '推理' },
  { value: 'tools', label: '工具' },
  { value: 'rerank', label: '重排' },
  { value: 'embedding', label: '向量' },
]

export const currencyOptions: SelectOption[] = [
  { value: 'usd', label: '美元（USD）' },
  { value: 'cny', label: '人民币（CNY）' },
]

export const initialProviderProfiles: ProviderProfile[] = []

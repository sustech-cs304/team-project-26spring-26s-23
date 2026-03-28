import type { ModelCapability, ProviderModelProfile, ProviderProfile, SelectOption } from '../types'

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

function createInitialModel(
  providerId: string,
  modelId: string,
  displayName: string,
  groupName: string,
  capabilities: ModelCapability[],
): ProviderModelProfile {
  return {
    id: createModelProfileId(providerId, modelId),
    modelId,
    displayName,
    groupName,
    capabilities,
    supportsStreaming: true,
    currency: 'usd',
    inputPrice: '0.50',
    outputPrice: '3.00',
  }
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

export const initialProviderProfiles: ProviderProfile[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    protocol: 'openai',
    endpoint: 'https://openrouter.ai/api/v1',
    apiKey: '',
    defaultModel: 'openai/gpt-4.1',
    fastModel: 'openai/gpt-4.1-mini',
    fallbackModel: 'anthropic/claude-3.7-sonnet',
    organization: 'team-project-26spring',
    region: 'Global',
    notes: '适合统一接入多家模型，后续可按成本切换路由。',
    availableModels: [
      createInitialModel('openrouter', 'openai/gpt-4.1', 'GPT-4.1', 'OpenAI', ['vision', 'reasoning', 'tools']),
      createInitialModel(
        'openrouter',
        'openai/gpt-4.1-mini',
        'GPT-4.1 Mini',
        'OpenAI',
        ['vision', 'reasoning', 'tools'],
      ),
      createInitialModel(
        'openrouter',
        'anthropic/claude-3.7-sonnet',
        'Claude 3.7 Sonnet',
        'Anthropic',
        ['vision', 'reasoning', 'tools'],
      ),
    ],
  },
  {
    id: 'baill-openai',
    name: 'BaiLiOpenAI',
    protocol: 'openai-response',
    endpoint: 'https://api.baili.example.com/v1',
    apiKey: '',
    defaultModel: 'baili-chat-pro',
    fastModel: 'baili-chat-lite',
    fallbackModel: 'baili-reasoner',
    organization: 'school-lab',
    region: 'CN-North',
    notes: '面向校园网络环境的占位服务商配置。',
    availableModels: [
      createInitialModel('baill-openai', 'baili-chat-pro', 'Baili Chat Pro', 'BaiLi', ['reasoning', 'tools']),
      createInitialModel('baill-openai', 'baili-chat-lite', 'Baili Chat Lite', 'BaiLi', ['reasoning']),
      createInitialModel('baill-openai', 'baili-reasoner', 'Baili Reasoner', 'BaiLi', ['reasoning']),
    ],
  },
  {
    id: 'ollama-local',
    name: 'Ollama Local',
    protocol: 'ollama',
    endpoint: 'http://127.0.0.1:11434/v1',
    apiKey: '',
    defaultModel: 'llama3.2:latest',
    fastModel: 'qwen2.5:7b',
    fallbackModel: 'mistral:latest',
    organization: 'local-dev',
    region: 'Local',
    notes: '本地 Ollama 运行时示例，用于离线或局域网模型服务。',
    availableModels: [
      createInitialModel(
        'ollama-local',
        'llama3.2:latest',
        'Llama 3.2',
        'Ollama',
        ['reasoning', 'tools'],
      ),
      createInitialModel('ollama-local', 'qwen2.5:7b', 'Qwen 2.5 7B', 'Ollama', ['reasoning', 'tools']),
      createInitialModel(
        'ollama-local',
        'mistral:latest',
        'Mistral',
        'Ollama',
        ['reasoning', 'tools'],
      ),
    ],
  },
]

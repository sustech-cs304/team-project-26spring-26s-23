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
  { value: 'openai-compatible', label: 'OpenAI Compatible', hint: '兼容 Chat Completions / Responses 风格' },
  { value: 'anthropic', label: 'Anthropic', hint: 'Claude 风格消息协议' },
  { value: 'gemini', label: 'Gemini', hint: 'Google Gemini API 风格' },
  { value: 'custom-rest', label: 'Custom REST', hint: '自定义后端代理或网关' },
]

export const languageOptions: SelectOption[] = [
  { value: 'zh-CN', label: '简体中文', hint: '界面与默认文案' },
  { value: 'en-US', label: 'English', hint: '英文界面' },
]

export const proxyModeOptions: SelectOption[] = [
  { value: 'system', label: '系统代理', hint: '跟随操作系统网络配置' },
  { value: 'direct', label: '直连', hint: '不经过代理' },
  { value: 'manual', label: '手动配置', hint: '指定代理地址与端口' },
]

export const themeOptions: SelectOption[] = [
  { value: 'light', label: '浅色', hint: '推荐办公环境使用' },
  { value: 'dark', label: '深色', hint: '夜间使用' },
]

export const fontSizeOptions: SelectOption[] = [
  { value: 'small', label: '小', hint: '更高信息密度' },
  { value: 'medium', label: '中', hint: '默认阅读尺寸' },
  { value: 'large', label: '大', hint: '增强可读性' },
]

export const densityOptions: SelectOption[] = [
  { value: 'compact', label: '紧凑', hint: '更专业克制的间距' },
  { value: 'comfortable', label: '舒适', hint: '默认显示密度' },
]

export const backupCycleOptions: SelectOption[] = [
  { value: 'every-launch', label: '每次启动', hint: '启动即备份' },
  { value: 'daily', label: '每天', hint: '适合常规使用' },
  { value: 'weekly', label: '每周', hint: '减少磁盘占用' },
]

export const toolPermissionOptions: SelectOption[] = [
  { value: 'manual', label: '逐次确认', hint: '每次调用前询问' },
  { value: 'trusted', label: '受信能力自动允许', hint: '对已信任服务自动放行' },
  { value: 'strict', label: '严格手动', hint: '任何外部调用都需确认' },
]

export const searchEngineOptions: SelectOption[] = [
  { value: 'google', label: 'Google', hint: '通用搜索体验' },
  { value: 'bing', label: 'Bing', hint: '适合综合网页搜索' },
  { value: 'baidu', label: 'Baidu', hint: '偏中文内容' },
]

export const resultCountOptions: SelectOption[] = [
  { value: '5', label: '5 条', hint: '更聚焦' },
  { value: '8', label: '8 条', hint: '默认推荐' },
  { value: '12', label: '12 条', hint: '覆盖更多来源' },
]

export const compressionOptions: SelectOption[] = [
  { value: 'summary', label: '摘要压缩', hint: '优先提炼关键结论' },
  { value: 'balanced', label: '平衡模式', hint: '保留适量原文细节' },
  { value: 'none', label: '不压缩', hint: '返回更多原始内容' },
]

export const memoryStrategyOptions: SelectOption[] = [
  { value: 'session-only', label: '仅会话内', hint: '不保留长期记忆' },
  { value: 'session-longterm', label: '会话 + 长期记忆', hint: '推荐通用模式' },
  { value: 'project-centric', label: '项目优先', hint: '按项目沉淀上下文' },
]

export const apiReconnectOptions: SelectOption[] = [
  { value: 'exponential', label: '指数退避', hint: '稳定优先' },
  { value: 'fixed', label: '固定间隔', hint: '节奏可预期' },
  { value: 'manual', label: '仅手动重连', hint: '避免后台自动请求' },
]

export const docsFormatOptions: SelectOption[] = [
  { value: 'markdown', label: 'Markdown', hint: '推荐默认格式' },
  { value: 'html', label: 'HTML', hint: '便于直接展示' },
  { value: 'pdf', label: 'PDF', hint: '适合归档分享' },
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
  { value: 'usd', label: '美元（USD）', hint: '适合海外服务商' },
  { value: 'cny', label: '人民币（CNY）', hint: '适合本地或代理服务' },
  { value: 'credits', label: '积分（Credits）', hint: '用于平台积分制计费' },
]

export const initialProviderProfiles: ProviderProfile[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    protocol: 'openai-compatible',
    endpoint: 'https://openrouter.ai/api/v1',
    apiKey: '',
    defaultModel: 'openai/gpt-4.1',
    fastModel: 'openai/gpt-4.1-mini',
    fallbackModel: 'anthropic/claude-3.7-sonnet',
    organization: 'team-project-26spring',
    region: 'Global',
    notes: '适合统一接入多家模型，后续可按成本切换路由。',
    enabled: true,
    isDefault: true,
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
    protocol: 'openai-compatible',
    endpoint: 'https://api.baili.example.com/v1',
    apiKey: '',
    defaultModel: 'baili-chat-pro',
    fastModel: 'baili-chat-lite',
    fallbackModel: 'baili-reasoner',
    organization: 'school-lab',
    region: 'CN-North',
    notes: '面向校园网络环境的占位服务商配置。',
    enabled: true,
    isDefault: false,
    availableModels: [
      createInitialModel('baill-openai', 'baili-chat-pro', 'Baili Chat Pro', 'BaiLi', ['reasoning', 'tools']),
      createInitialModel('baill-openai', 'baili-chat-lite', 'Baili Chat Lite', 'BaiLi', ['reasoning']),
      createInitialModel('baill-openai', 'baili-reasoner', 'Baili Reasoner', 'BaiLi', ['reasoning']),
    ],
  },
  {
    id: 'custom-gateway',
    name: 'Campus Gateway',
    protocol: 'custom-rest',
    endpoint: 'http://127.0.0.1:8080/api/copilot',
    apiKey: '',
    defaultModel: 'campus-general-agent',
    fastModel: 'campus-fast-agent',
    fallbackModel: 'campus-summary-agent',
    organization: 'local-dev',
    region: 'Local',
    notes: '用于未来直连自建后端或本地代理网关。',
    enabled: false,
    isDefault: false,
    availableModels: [
      createInitialModel(
        'custom-gateway',
        'campus-general-agent',
        'Campus General Agent',
        'Campus',
        ['reasoning', 'tools'],
      ),
      createInitialModel('custom-gateway', 'campus-fast-agent', 'Campus Fast Agent', 'Campus', ['reasoning', 'tools']),
      createInitialModel(
        'custom-gateway',
        'campus-summary-agent',
        'Campus Summary Agent',
        'Campus',
        ['reasoning', 'tools'],
      ),
    ],
  },
]

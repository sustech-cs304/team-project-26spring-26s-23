import { Server, Shield, type LucideIcon } from 'lucide-react'

export type CapabilitiesSection = 'tool-permissions' | 'mcp-servers'
export type ToolPermissionMode = 'allow' | 'deny' | 'ask' | 'delay'
export type ToolPermissionDelayAction = 'approve' | 'deny'
export type ToolPermissionGroupId = 'workspace' | 'remote'
export type McpServerStatus = 'connected' | 'local' | 'draft'
export type McpServerEditorMode = 'edit' | 'add'

export interface CapabilitiesNavItem {
  id: CapabilitiesSection
  label: string
  description: string
  icon: LucideIcon
}

export interface ToolPermissionGroup {
  id: ToolPermissionGroupId
  label: string
}

export interface ToolPermissionRecord {
  id: string
  groupId: ToolPermissionGroupId
  name: string
  description: string
  toolId: string
  mode: ToolPermissionMode
  delayAction: ToolPermissionDelayAction
  delaySeconds: number
}

export interface McpServerRecord {
  id: string
  name: string
  description: string
  transport: string
  endpoint: string
  status: McpServerStatus
  enabled: boolean
}

// UI-only 占位数据：后续由 Code 模式接入真实运行时配置与持久化来源。
export const capabilitiesNavItems: readonly CapabilitiesNavItem[] = [
  {
    id: 'tool-permissions',
    label: '工具权限',
    description: '按工具逐项配置审批策略与延迟处理规则。',
    icon: Shield,
  },
  {
    id: 'mcp-servers',
    label: 'MCP 服务器',
    description: '查看本地占位服务器配置，并通过 JSON 编辑器模拟编辑。',
    icon: Server,
  },
]

export const toolPermissionGroups: readonly ToolPermissionGroup[] = [
  {
    id: 'workspace',
    label: '项目内工具',
  },
  {
    id: 'remote',
    label: '外部访问',
  },
]

export const toolPermissionModes: ReadonlyArray<{ value: ToolPermissionMode, label: string }> = [
  { value: 'allow', label: '自动批准' },
  { value: 'deny', label: '总是关闭' },
  { value: 'ask', label: '手动批准' },
  { value: 'delay', label: '延迟处理' },
]

export const initialToolPermissions: ToolPermissionRecord[] = [
  {
    id: 'tool-read-file',
    groupId: 'workspace',
    name: '读取文件',
    description: '允许模型读取项目内文件内容，用于理解上下文与定位实现细节。',
    toolId: 'read_file',
    mode: 'allow',
    delayAction: 'approve',
    delaySeconds: 12,
  },
  {
    id: 'tool-execute-command',
    groupId: 'workspace',
    name: '执行命令',
    description: '允许运行本地终端命令；适合构建、检查与前端资源处理等操作。',
    toolId: 'execute_command',
    mode: 'ask',
    delayAction: 'deny',
    delaySeconds: 15,
  },
  {
    id: 'tool-write-file',
    groupId: 'workspace',
    name: '写入文件',
    description: '允许创建或重写前端文件，适用于页面搭建、样式输出与占位数据维护。',
    toolId: 'write_to_file',
    mode: 'delay',
    delayAction: 'approve',
    delaySeconds: 18,
  },
  {
    id: 'tool-fetch-url',
    groupId: 'remote',
    name: '联网抓取',
    description: '在有需要时抓取网页内容，用于界面占位信息或外部说明上下文。',
    toolId: 'mcp.fetch',
    mode: 'deny',
    delayAction: 'deny',
    delaySeconds: 20,
  },
  {
    id: 'tool-browser-automation',
    groupId: 'remote',
    name: '浏览器自动化',
    description: '驱动浏览器执行界面级操作，用于录制流程或验证可见交互。',
    toolId: 'mcp.puppeteer',
    mode: 'delay',
    delayAction: 'deny',
    delaySeconds: 24,
  },
]

export const mockMcpServers: readonly McpServerRecord[] = [
  {
    id: 'filesystem',
    name: 'filesystem-server',
    description: '本地文件系统桥接，占位展示 stdio 方式的 MCP 服务接入。',
    transport: 'stdio',
    endpoint: 'uvx mcp-server-filesystem ./workspace',
    status: 'connected',
    enabled: true,
  },
  {
    id: 'browser',
    name: 'puppeteer-server',
    description: '浏览器自动化服务，占位展示可视化抓取与页面操作能力。',
    transport: 'stdio',
    endpoint: 'npx @modelcontextprotocol/server-puppeteer',
    status: 'local',
    enabled: true,
  },
  {
    id: 'fetch',
    name: 'fetch-server',
    description: '联网抓取服务，占位展示基于 HTTP 的远程抓取配置。',
    transport: 'http',
    endpoint: 'http://127.0.0.1:8788/mcp',
    status: 'draft',
    enabled: false,
  },
]

export const mockMcpConfig = {
  mcpServers: {
    'filesystem-server': {
      transport: 'stdio',
      command: 'uvx',
      args: ['mcp-server-filesystem', './workspace'],
    },
    'puppeteer-server': {
      transport: 'stdio',
      command: 'npx',
      args: ['@modelcontextprotocol/server-puppeteer'],
    },
    'fetch-server': {
      transport: 'http',
      url: 'http://127.0.0.1:8788/mcp',
    },
  },
} as const

const addServerTemplate = `{
  "mcpServers": {
    "new-server": {
      "transport": "stdio",
      "command": "uvx",
      "args": ["example-mcp-server"],
      "env": {}
    }
  }
}`

export function resolveMcpEditorSeed(mode: McpServerEditorMode) {
  if (mode === 'edit') {
    return JSON.stringify(mockMcpConfig, null, 2)
  }

  return addServerTemplate
}

export function resolveMcpStatusLabel(status: McpServerStatus) {
  switch (status) {
    case 'connected':
      return '已连接'
    case 'local':
      return '本地草案'
    case 'draft':
      return '待补配置'
  }
}

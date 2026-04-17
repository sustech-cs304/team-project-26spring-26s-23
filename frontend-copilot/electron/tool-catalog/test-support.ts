import type { RuntimeToolDirectoryEntry } from '../../src/features/copilot/chat-contract'

export function createToolCatalogFixture(): RuntimeToolDirectoryEntry[] {
  return [
    {
      toolId: 'functions.read_file',
      kind: 'builtin',
      availability: 'available',
      displayName: '读取文件',
      description: '读取项目内文件内容，用于理解上下文与定位实现细节。',
    },
    {
      toolId: 'functions.execute_command',
      kind: 'builtin',
      availability: 'available',
      displayName: '执行命令',
      description: '运行本地终端命令，适合构建、检查与资源处理。',
    },
    {
      toolId: 'functions.write_to_file',
      kind: 'builtin',
      availability: 'available',
      displayName: '写入文件',
      description: '创建或重写文件，适用于页面搭建、样式输出与配置修改。',
    },
    {
      toolId: 'mcp--fetch--fetch',
      kind: 'external',
      availability: 'available',
      displayName: '联网抓取',
      description: '抓取网页内容，用于补充外部说明与页面上下文。',
    },
    {
      toolId: 'mcp--puppeteer--puppeteer_navigate',
      kind: 'external',
      availability: 'available',
      displayName: '浏览器自动化',
      description: '驱动浏览器执行界面级操作，用于录制流程或验证可见交互。',
    },
  ]
}

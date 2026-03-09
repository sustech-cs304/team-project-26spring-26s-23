import { CopilotChatPanel } from './features/copilot/CopilotChatPanel'
import './App.css'

const navigationItems = [
  { label: '工作台', meta: '当前壳层', isActive: true },
  { label: '课程总览', meta: '后续页面', isActive: false },
  { label: '日程任务', meta: '后续页面', isActive: false },
  { label: '设置与联调', meta: '后续页面', isActive: false },
]

const workspaceModules = [
  {
    title: '业务主内容区',
    description: '这里保留给课程、任务、同步结果等核心业务页面。当前仅用静态内容呈现未来主工作区的组织方式。',
  },
  {
    title: 'Agent 能力挂载位',
    description: '智能体聊天作为应用中的一个辅助能力，被挂载在独立面板中，而不是直接等同于整个首页。',
  },
  {
    title: '后续扩展边界',
    description: '当前壳层已预留侧边导航、顶部信息区与主内容区，便于后续继续接入更多功能页面。',
  },
]

function App() {
  return (
    <div className="app-shell">
      <aside className="app-shell__sidebar" aria-label="应用导航预留区">
        <div className="app-shell__brand-block">
          <p className="app-shell__eyebrow">Frontend Copilot</p>
          <h1 className="app-shell__brand-title">桌面应用壳层</h1>
          <p className="app-shell__brand-description">
            当前页面用于承载未来多个功能模块；Agent 聊天仅是其中一个面板，而不是整个应用的唯一页面。
          </p>
        </div>

        <nav className="app-shell__nav" aria-label="功能区导航预留">
          {navigationItems.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`app-shell__nav-item${item.isActive ? ' app-shell__nav-item--active' : ''}`}
            >
              <span className="app-shell__nav-label">{item.label}</span>
              <span className="app-shell__nav-meta">{item.meta}</span>
            </button>
          ))}
        </nav>

        <div className="app-shell__sidebar-note">
          <p className="app-shell__sidebar-note-title">当前阶段说明</p>
          <p className="app-shell__sidebar-note-text">
            本次只完成壳层整合与聊天面板挂载，不引入路由系统，也不实现真实导航切换逻辑。
          </p>
        </div>
      </aside>

      <div className="app-shell__main">
        <header className="app-shell__topbar">
          <div>
            <p className="app-shell__eyebrow">Workspace</p>
            <h2 className="app-shell__topbar-title">主工作台</h2>
          </div>
          <span className="app-shell__topbar-badge">应用壳层已接管首页</span>
        </header>

        <main className="app-shell__content">
          <section className="app-shell__workspace" aria-label="主内容区">
            <section className="app-shell__hero">
              <p className="app-shell__eyebrow">Overview</p>
              <h3 className="app-shell__section-title">业务页面与 Agent 面板并列存在</h3>
              <p className="app-shell__section-description">
                当前主内容区代表未来的业务工作台，右侧独立区域挂载 Agent 助手面板。这样可以明确表达：聊天能力是桌面应用的一部分，而不是全部。
              </p>
            </section>

            <section className="app-shell__module-grid" aria-label="未来模块预留区">
              {workspaceModules.map((module) => (
                <article key={module.title} className="app-shell__module-card">
                  <h4 className="app-shell__module-title">{module.title}</h4>
                  <p className="app-shell__module-description">{module.description}</p>
                </article>
              ))}
            </section>
          </section>

          <section className="app-shell__panel-shell" aria-label="Agent 助手区域">
            <header className="app-shell__panel-header">
              <div>
                <p className="app-shell__eyebrow">Assistant</p>
                <h3 className="app-shell__section-title">Agent 助手面板</h3>
              </div>
              <p className="app-shell__panel-caption">当前默认会优先暴露未连接后端智能体的提示路径</p>
            </header>

            <div className="app-shell__panel-body">
              <CopilotChatPanel />
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

export default App

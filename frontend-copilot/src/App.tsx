import { useState } from 'react'

import { CopilotChatPanel } from './features/copilot/CopilotChatPanel'
import './App.css'

type WorkspaceView = 'chat' | 'tools' | 'settings'

const topicItems = [
  'Skills 编写注意事项',
  '贪心算法核心复习笔记',
  '什么是 Java 类型擦除',
  'A 星算法最优路径条件',
  '限制 Python 程序单核运行',
  'Git 中 fix 无效的补充提交',
]

const featureItems = [
  { name: 'Agent 聊天', description: '对话式助理主入口' },
  { name: '单独功能', description: '后续扩展的工具界面' },
  { name: '设置配置', description: 'Runtime 与联调参数管理' },
]

function App() {
  const [activeView, setActiveView] = useState<WorkspaceView>('chat')

  return (
    <div className="studio-shell">
      <aside className="studio-rail" aria-label="主功能图标栏">
        <button type="button" className="studio-rail__icon studio-rail__icon--active" title="助手">
          💬
        </button>
        <button type="button" className="studio-rail__icon" title="功能">
          ✳
        </button>
        <button type="button" className="studio-rail__icon" title="文件">
          📁
        </button>
        <button type="button" className="studio-rail__icon" title="开发">
          {'</>'}
        </button>

        <div className="studio-rail__spacer" />

        <button type="button" className="studio-rail__icon" title="深色模式">
          ☾
        </button>
        <button type="button" className="studio-rail__icon" title="设置">
          ⚙
        </button>
      </aside>

      <aside className="studio-sidebar" aria-label="功能与会话选择区">
        <header className="studio-sidebar__tabs">
          <button type="button" className="studio-sidebar__tab">助手</button>
          <button type="button" className="studio-sidebar__tab studio-sidebar__tab--active">
            话题
          </button>
        </header>

        <button type="button" className="studio-sidebar__new-topic">
          <span className="studio-sidebar__new-icon">＋</span>
          <span>新建话题</span>
        </button>

        <section className="studio-sidebar__block" aria-label="会话列表">
          <p className="studio-sidebar__block-title">默认话题</p>
          <ul className="studio-topic-list">
            {topicItems.map((topic, index) => (
              <li key={topic}>
                <button
                  type="button"
                  className={`studio-topic-item${index === 2 ? ' studio-topic-item--active' : ''}`}
                  title={topic}
                >
                  <span className="studio-topic-item__text">{topic}</span>
                  {index === 2 ? <span className="studio-topic-item__close">×</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="studio-sidebar__block" aria-label="功能区预留">
          <p className="studio-sidebar__block-title">功能区</p>
          <ul className="studio-feature-list">
            {featureItems.map((feature) => (
              <li key={feature.name} className="studio-feature-item">
                <p className="studio-feature-item__name">{feature.name}</p>
                <p className="studio-feature-item__description">{feature.description}</p>
              </li>
            ))}
          </ul>
        </section>
      </aside>

      <main className="studio-main" aria-label="右侧内容区">
        <header className="studio-main__header">
          <div>
            <p className="studio-main__eyebrow">当前页面</p>
            <h1 className="studio-main__title">什么是 Java 类型擦除</h1>
          </div>

          <div className="studio-view-switch" role="tablist" aria-label="内容视图切换">
            <button
              type="button"
              role="tab"
              aria-selected={activeView === 'chat'}
              className={`studio-view-switch__item${activeView === 'chat' ? ' studio-view-switch__item--active' : ''}`}
              onClick={() => setActiveView('chat')}
            >
              Copilot UI
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeView === 'tools'}
              className={`studio-view-switch__item${activeView === 'tools' ? ' studio-view-switch__item--active' : ''}`}
              onClick={() => setActiveView('tools')}
            >
              单独功能
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeView === 'settings'}
              className={`studio-view-switch__item${activeView === 'settings' ? ' studio-view-switch__item--active' : ''}`}
              onClick={() => setActiveView('settings')}
            >
              设置配置
            </button>
          </div>
        </header>

        <section className="studio-main__content">
          {activeView === 'chat' ? (
            <CopilotChatPanel />
          ) : (
            <article className="studio-placeholder-card" aria-live="polite">
              <p className="studio-main__eyebrow">占位内容</p>
              <h2 className="studio-placeholder-card__title">
                {activeView === 'tools' ? '单独功能页即将接入' : '设置配置页即将接入'}
              </h2>
              <p className="studio-placeholder-card__description">
                当前已完成「左侧会话/功能选择 + 右侧内容区」框架。你可以继续在这个壳层上逐步接入具体业务页面。
              </p>
            </article>
          )}
        </section>
      </main>
    </div>
  )
}

export default App

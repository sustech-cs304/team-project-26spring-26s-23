# 赶渡 CanDue 系统架构设计

当前系统采用“Electron 桌面宿主 + React 前端工作台 + Python 本地运行时”的混合桌面应用架构。整个系统并非传统的“B/S 架构网页客户端”，而是以本地优先原则构建的独立桌面数字生命助手。

## 1. 核心架构图

以下架构图展示了系统的四大核心层级及其关键交互：

```mermaid
flowchart TD
    %% 定义样式
    classDef frontend fill:#e1f5fe,stroke:#cc0000,stroke-width:2px,color:#000
    classDef electron fill:#fff9c4,stroke:#fbc02d,stroke-width:2px,color:#000
    classDef backend fill:#e8f5e9,stroke:#388e3c,stroke-width:2px,color:#000
    classDef data fill:#ede7f6,stroke:#1b5e20,stroke-width:2px,color:#000
    
    subgraph Client["React 工作台 (Renderer)"]
        %% 优化点1：按连接方向调整节点顺序。向左连接的放前面，向右连接的放后面
        UI_Chat[助手聊天面板]
        UI_Hub[领域工作区 Hub]
        UI_Settings[设置工作区]
        StateManager[装配与状态机]
    end
    class Client frontend

    subgraph Host["Electron 宿主 (Main Process)"]
        %% 优化点1：向左连接 Runtime 的节点排在前面
        Lifecycle[进程与窗口管理]
        Bridges[宿主私桥\nRoute/Capability]
        ConfigCenter[公开配置快照]
        SettingsWS[Settings Workspace\n Provider/Secrets 真源]
    end
    class Host electron

    subgraph Runtime["Python 本地运行时 (Local Backend)"]
        Server[desktop_runtime\nHTTP/控制面]
        Copilot[copilot_runtime\nThread/Run 主链]
        Tools[本地与网络工具]
        Domain[领域能力模块\nBlackboard/TIS]
    end
    class Runtime backend

    subgraph Persistence["本地持久化层"]
        SQLite[(SQLite 聊天历史)]
        ConfigDB[(宿主配置与凭据文件)]
    end
    class Persistence data

    %% ================= 连线区 (优化点3：先内后外，区分主次) =================

    %% [内部主干链路] 使用标准长度 -->
    Server --> Copilot
    Copilot -->|执行编排、工具调用| Tools
    Copilot -->|部分领域工具| Domain
    Bridges -->|访问受控真源| SettingsWS

    %% [跨层/跨界链路] 优化点2：增加连线长度(如 --->)，强制拉开子图间距，避免线条穿透节点
    UI_Chat <--->|请求 run/stream、消费事件| Server
    Lifecycle --->|分配端口、挂载环境变量、拉起进程| Server
    
    Copilot --->|执行前: 请求路由解析与密钥| Bridges
    
    UI_Settings <--->|IPC: 存取配置与密钥| SettingsWS
    StateManager <--->|IPC: 订阅公开配置| ConfigCenter
    
    %% [持久化层链路] 延长连线，让数据库安稳呆在最底部
    Copilot <--->|落盘、回放历史| SQLite
    SettingsWS <--->|读写| ConfigDB
    ConfigCenter <--->|读写| ConfigDB
```

## 2. 架构设计详解

系统由三个主要运行环境构成，这三部分各司其职，保证了本地数据安全、良好的桌面交互体验以及强大的后端执行能力。

### 2.1 Electron 宿主（主进程）：安全边界与生命周期管理

Electron 主进程是整个系统的“大管家”与安全沙箱。它不直接渲染界面，也不负责 AI 的对话生成，而是牢牢掌握着用户最敏感的数据，并提供底层系统级能力。

```mermaid
flowchart TD
    classDef electron fill:#fff9c4,stroke:#fbc02d,stroke-width:2px,color:#000

    subgraph MainProcess["Electron 主进程"]
        MainWindow[窗口创建与管理]
        RuntimeManager[Python Runtime Manager]
        Bridge[宿主私桥 Host Bridges]
        ConfigCenter[配置中心 Config Center]
        SettingsWS[设置工作区 Settings Workspace]
    end
    class MainProcess electron

    MainWindow -->|渲染指令| UI
    RuntimeManager -->|分配端口/拉起/监控| PyBackend
    Bridge -->|受控的凭据解析| PyBackend
    ConfigCenter -->|公开配置，例如主题、代理地址| State
    SettingsWS -->|普通设置与 Secrets| State
```

主进程承担了多项核心职责：

- **进程管理**：负责寻找 Python 可执行文件，分配 Loopback 端口，作为子进程启动 Python 本地运行时，并在应用退出时回收进程。
- **配置真源**：分为两层。一层是 `Config Center`，负责存储可以公开给前端的配置（如主题、运行时地址）；另一层是 `Settings Workspace`，负责存储用户配置的模型服务、API Key 以及校园网 CAS 密码等敏感数据（Secrets）。
- **安全隔离（宿主私桥）**：这是架构中最关键的安全设计。前端请求模型时只发送公开的“路由指纹”，真实的 API Key 仅保存在 Electron 中。Python 运行时在实际请求外部 LLM 之前，必须通过私有桥接通道向主进程发起请求，换取真实的鉴权信息。这就保证了敏感密钥既不在前端内存中暴露，也不会轻易随运行时的日志流出。

### 2.2 React 渲染进程：前端工作台与状态机

渲染进程专注于桌面应用的用户交互与视图呈现。它的核心是驱动界面的多个“状态机”，而不是单纯处理点击事件。

```mermaid
flowchart TD
    classDef frontend fill:#e1f5fe,stroke:#cc0000,stroke-width:2px,color:#000

    subgraph Renderer["React 渲染进程"]
        Bootstrap[根装配层 CopilotAppRoot]
        Assistant[助手工作区 Assistant Workspace]
        Settings[设置工作区 Settings Workspace]
        Hub[能力集线器 Hub Workspace]
    end
    class Renderer frontend

    Bootstrap -->|根据公开快照判断状态| UI[启动页 / 错误页 / 工作台]
    Assistant -->|聊天面板| ChatPanel[Chat Panel]
    Assistant -->|输入区| Composer[Composer]
    Settings -->|提供模型与密钥编辑UI| ProfileList
```

前端的设计重点在于：
- **启动态管理**：前端通过读取 Electron 暴露的公开配置快照以及 Python 运行时的就绪状态，决定当前应用是停留在启动屏、降级模式（仅有前端）还是正常进入主工作台。
- **聊天流消费**：在进入聊天面板后，前端将作为 `run/stream` 流式事件的消费者。当后端返回诸如 `run_started`、`tool_event`、`text_delta`、`run_completed` 时，前端依据这些事件实时更新界面。这种基于状态机的事件消费机制，取代了传统的一问一答阻塞请求。

### 2.3 Python 本地运行时：执行引擎与业务网关

后端以独立子进程运行，是执行模型调用、工具编排和持久化本地历史的中枢。

```mermaid
flowchart TD
    classDef backend fill:#e8f5e9,stroke:#388e3c,stroke-width:2px,color:#000

    subgraph PyBackend["Python 本地运行时"]
        DesktopRuntime[Desktop Runtime\n端点/HTTP服务]
        CopilotRuntime[Copilot Runtime\n聊天主契约]
        SessionStore[Session Store\n会话存储]
        Integrations[Integrations\n领域集成模块]
    end
    class PyBackend backend

    DesktopRuntime -->|/health, /history| App
    DesktopRuntime -->|POST / 聊天接口| CopilotRuntime
    CopilotRuntime -->|消息流/工具回调| Executor[Agent Executor]
    Executor --> Integrations
    CopilotRuntime --> SessionStore
```

Python 层包含四个层次的划分：
- **`desktop_runtime`**：作为服务外壳，提供生命周期端点、健康检查，以及处理本地请求的基础 HTTP 接口。
- **`copilot_runtime`**：承载聊天的实际契约（Thread/Run）。它包含模型路由解析、流式事件编码、工具调用和会话状态管理，将单次的对话抽象为一个 `Run` 的执行流。
- **持久化层**：负责利用 SQLite 记录每次对话的 Thread、Run 和具体事件（Event）。应用重启后的历史会话恢复功能，依赖于这里的单机数据库读取，而非云端。
- **领域模块与工具**：集成层包括文件处理、Blackboard（南科大黑板系统）和 TIS（教务系统）等工具能力，为模型提供了强大的本地和网络执行手臂。

### 2.4 核心交互链路：对话处理流程

整个系统最典型的交互场景是发送一条消息。这里的时序图展示了前端发起聊天到收到流式响应的全过程。

```mermaid
sequenceDiagram
    participant U as 用户
    participant FE as React 前端
    participant EL as Electron 宿主
    participant PY as Python 运行时
    participant MP as 上游模型 Provider

    U->>FE: 输入文本，点击发送
    FE->>PY: 1. run/start (携带模型路由引用、启用工具)
    
    rect rgb(230, 240, 255)
    Note over PY, EL: 执行前受控解析
    PY->>EL: 2. 依据 providerProfileId 请求解析真实密钥
    EL-->>PY: 3. 返回包含 API Key 的路由快照
    end
    
    FE->>PY: 4. run/stream (开启长连接监听)
    
    PY->>MP: 5. 携带真实 API Key 请求外部大模型
    PY-->>FE: 6. run_started (事件开始)
    PY-->>FE: 7. text_delta (文本流式增量输出)
    
    rect rgb(255, 245, 230)
    Note over PY, FE: 工具调用阶段
    MP-->>PY: 8. 请求调用天气或本地 Blackboard 工具
    PY->>PY: 9. 执行工具代码
    PY-->>FE: 10. tool_event (started/completed)
    PY->>MP: 11. 携带工具结果再次请求模型
    end
    
    PY-->>FE: 12. text_delta (工具结果后的最终文本)
    
    PY->>PY: 13. 落盘: 将历史写入本地 SQLite
    PY-->>FE: 14. run_completed (执行结束)
```

这条链路体现了系统设计的三层分工：前端仅负责呈现流式数据与交互意图；Electron 宿主负责下放执行权限并提供鉴权保护；Python 后端负责协调模型网络请求、工具执行步骤和最终状态存档。

## 3. 架构选择的考量与隐藏假设

### 3.1 为什么选择这种架构？

1. **本地数据主权优先**：
   相较于传统的云端 SaaS 产品，当前架构将聊天历史（SQLite）、用户配置、各种凭证（Secrets）全部沉淀在用户本地物理设备上。Python 运行时仅作为本地服务工作，不存在集中的云端数据库收集用户聊天隐私。
2. **敏感信息的安全隔离**：
   如果将密钥下放到前端或直接写在后端的明文配置中，容易造成内存泄露或跨进程污染。现在的“凭证托管在 Electron 主进程、执行时 Python 按需向主进程请求解析”模式，建立了一道坚固的安全隔离墙，确保 Python 运行时在“不知道密码库全貌”的情况下，仅能拿到当前请求合法授权的单次凭据。
3. **语言生态的优势互补**：
   前端采用 React/TypeScript 能够提供丰富、极具响应性的桌面 UI 体验；而后端业务（尤其是 LLM 编排、数据处理、校园系统爬虫等）若用 Node.js 编写则缺乏成熟的生态。Python 拥有 `PydanticAI`、`pdfplumber` 等强大的 AI 和数据清洗库，双引擎架构完美结合了两者的长处。

### 3.2 图中未完全展示的隐藏假设

- **不依赖持续的云端同步**：当前架构预设历史记录恢复（Replay）仅在“单机本地 SQLite”语境下生效。应用重启时依赖本地数据库重建会话树，暂不提供跨设备的实时状态同步通道。
- **状态不一致容忍机制（Drift）**：架构假设用户的本地配置（如某个模型 Provider）可能随时被删除。当历史会话试图继续，却发现绑定的模型路由已经失效时，系统不会阻断运行，而是由 Python 后端抛出明确的诊断事件（Diagnostic Event），前端配合展示配置漂移（Drift）界面，要求用户重新绑定有效路由再继续执行。
- **无感知的端口分配**：尽管 Python 运行时是个 HTTP 服务，但它的端口在每次 Electron 启动时是动态寻找可用空闲端口分配的，并由 Electron 静态注入前端视图，从而规避了本地端口冲突的风险。
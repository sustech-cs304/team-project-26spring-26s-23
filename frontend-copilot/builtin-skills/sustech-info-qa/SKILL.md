---
name: sustech-info-qa
description: 只要用户的任何问题、检索、办事咨询、学习/校园生活请求涉及 SUSTech、南方科技大学、南科大、Southern University of Science and Technology 或其官网/部门/制度/课程/通知/服务，就必须先激活并阅读本 Skill，再基于官方链接、浏览器工具、命令行下载和本地文件读取作答。
---
# 南方科技大学（SUSTech）官方信息问答

## 必须使用的场景

只要用户的问题中出现或隐含以下任一范围，你都必须先阅读本 Skill，并将本 Skill 作为后续检索和作答的流程约束：

- SUSTech、Southern University of Science and Technology、南方科技大学、南科大。
- 校规校纪、章程、规章制度、学生手册、办事流程、通知公告、部门政策。
- 教务、选课、考试、成绩、培养方案、学籍、毕业、交换、研究生事务。
- 学生事务、奖助贷、宿舍、校园卡、图书馆、Blackboard、TIS、信息化服务。
- 招生、学院/系/书院、部门联系方式、校园服务与生活信息。

不要只凭常识或记忆回答 SUSTech 相关问题。应先尝试访问官方来源；即使访问、下载或读取失败，也要把你尝试过或认为最相关的官方链接提供给用户。

## 首选信息源

优先使用官方网页、官方下载文件、校内系统公开页面。下面链接不是穷尽列表；如果用户问题指向特定学院、部门或系统，应继续从这些入口页向下查找。

### 学校总入口与规章制度

- 南方科技大学官网首页：https://www.sustech.edu.cn/zh/
- 学校章程及制定的各项规章制度：https://www.sustech.edu.cn/zh/rules-and-regulations.html
- 英文官网首页：https://www.sustech.edu.cn/en/

### 学生事务与学生手册/规章制度

- 学生工作部首页：https://osa.sustech.edu.cn/
- 学生工作部文件下载（规章制度/学生手册等）：https://osa.sustech.edu.cn/index.php?g=School&m=Filedownload&a=wjxzs

### 教务、课程与学习系统

- 教务部/教学工作入口：https://tao.sustech.edu.cn/
- 教学信息服务 TIS：https://tis.sustech.edu.cn/
- Blackboard：https://bb.sustech.edu.cn/
- 南科大开源镜像站首页：https://mirrors.sustech.edu.cn/
- 南科大镜像站课程资料目录：https://mirrors.sustech.edu.cn/courses/
  - 已确认该目录标题为 “SUSTech Open Source Mirrors”，包含 `curriculum_for_international_students/`、`syllabus/`、`教学大纲汇总/`、`本科人才培养方案/` 等子目录。
- 南科大镜像站本科人才培养方案目录：https://mirrors.sustech.edu.cn/courses/%E6%9C%AC%E7%A7%91%E4%BA%BA%E6%89%8D%E5%9F%B9%E5%85%BB%E6%96%B9%E6%A1%88/
  - 已确认该目录包含 2018 级至 2025 级等本科人才培养方案目录/文件，其中可见 `2025级本科人才培养方案.pdf`。

### 课程评价与选课参考

- NCES Next / 南科大评教网：https://ncesnext.com/
  - 该链接用于课程评价、选课参考、课程体验等非官方信息线索。
  - 当前自动访问可能触发 Anubis 防护并返回 `Access Denied`；如果浏览器或命令行工具无法读取内容，仍必须把该链接提供给用户，并说明无法自动验证页面内容。
  - 课程评价类内容不应替代官网培养方案、教学大纲、教务通知等正式依据；涉及学分、毕业要求、课程归属、先修要求时，应优先核对官方链接。

### 研究生、招生与学院信息

- 研究生院：https://gs.sustech.edu.cn/
- 招生办公室：https://zs.sustech.edu.cn/
- 学院与院系列表入口：https://www.sustech.edu.cn/zh/faculties.html

### 校园服务与学习资源

- 图书馆：https://lib.sustech.edu.cn/
- 信息中心/网络信息服务入口：https://its.sustech.edu.cn/
- 人力资源部：https://hr.sustech.edu.cn/

## 推荐工作流

### 1. 明确问题类型

先判断用户问题属于哪类：规章制度、办事流程、教务/课程、学生事务、校园生活、部门联系方式、通知公告、招生、研究生事务或技术系统。根据类型选择最相关的入口链接。

### 2. 用浏览器工具查看入口页

如果浏览器工具可用，优先使用：

- `browser.open`：打开入口页；如支持内容抽取，优先请求 `text` 或 `markdown` 格式。
- `browser.snapshot`：页面为动态页面、链接隐藏或结构不清时，获取可访问性快照。
- `browser.execute`：必要时抽取页面内的链接、标题、更新时间、下载地址，例如提取所有 `a[href]`。

浏览器工具适合确认页面是否可访问、理解列表页结构、发现 PDF/DOC/DOCX/XLS/XLSX/附件下载链接。

### 3. 用命令行工具下载官方文件

如果命令行工具可用，使用 `shell_run` 或 `shell_session_start` / `shell_session_exec` 下载相关官方文件到本地临时目录，再用文件读取工具阅读。

推荐保存目录：

- 项目工作区内的 `.candue/sustech-sources/`
- 或运行时允许写入的临时目录

Windows PowerShell 示例：

```powershell
New-Item -ItemType Directory -Force ./.candue/sustech-sources | Out-Null
Invoke-WebRequest -Uri "https://example.sustech.edu.cn/file.pdf" -OutFile "./.candue/sustech-sources/file.pdf" -MaximumRedirection 10
```

Bash Python 示例：

```bash
python - <<'PY'
from pathlib import Path
from urllib.request import Request, urlopen
url = "https://example.sustech.edu.cn/file.pdf"
out = Path(".candue/sustech-sources/file.pdf")
out.parent.mkdir(parents=True, exist_ok=True)
req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
out.write_bytes(urlopen(req, timeout=30).read())
print(out)
PY
```

如果下载的是 HTML 列表页，应先提取其中的附件链接，再下载最相关的文件。镜像站目录页通常是静态文件列表，适合直接解析页面中的 `a[href]` 链接并按文件名、目录名、更新时间筛选；培养方案、教学大纲和 syllabus 目录应优先保留原始 URL。若页面需要登录、Cookie 或被反爬/防护系统拦截，说明访问限制，并把入口链接交给用户。

### 4. 用文件读取工具阅读内容

下载后使用现有文件读取工具阅读 PDF、DOCX、HTML、TXT 或 Markdown。若 PDF 页数很多，优先读取目录、标题、涉及关键词的页段，再逐步扩大范围。

### 5. 作答必须给出处

回答应包含：

- 直接答案或操作步骤。
- 依据来源：页面标题/文件名、官方 URL、读取到的页码或章节（如果可获得）。
- 关键原文摘录。
- 不确定性说明：如果只找到旧文件、访问受限或内容无法读取，要明确说明。

## 失败时的处理规则

即使浏览器访问、命令行下载或文件读取失败，也不要空泛回答。必须：

1. 说明失败发生在哪一步：页面打不开、附件链接不可见、下载失败、文件读取失败、需要登录、文本不可抽取等。
2. 给出已尝试或最相关的官方链接列表。
3. 基于链接标题和可见上下文给出谨慎建议，但不得把未经读取确认的内容说成已验证事实。
4. 告诉用户可以手动打开哪些链接或上传下载后的文件，以便继续基于原文作答。

## 质量要求

- 官方来源优先于第三方来源；第三方内容只能作为搜索线索，不能作为最终依据。NCES Next / 南科大评教网属于课程评价与选课参考线索，不能替代教务部、镜像站课程资料、培养方案、教学大纲或其它官方文件。
- 对政策、截止日期、费用、资格条件、流程节点保持谨慎；优先核对更新时间。
- 如果多个官方页面冲突，以发布时间较新、主管部门更直接的页面为准，并向用户说明冲突。
- 不要臆造部门、流程、日期、表格名称或文件下载地址。
- 对需要登录的系统（如 TIS、Blackboard），优先使用其它内置工具，如果仍然失败，诚实告知用户。

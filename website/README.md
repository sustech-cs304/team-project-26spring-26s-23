# GanDue 文档站

基于 Docusaurus 构建，用于发布 [`docs/`](../docs/) 下的项目文档。

## 安装依赖

```bash
npm install
```

## 本地开发

```bash
npm start
```

启动本地开发服务器后，文档与配置修改会自动热更新。

## 类型检查

```bash
npm run typecheck
```

## 生产构建

```bash
npm run build
```

构建产物会输出到 `build/` 目录，可直接用于静态托管。

## 其他常用命令

```bash
npm run clear
npm run serve
```

## 文档来源

- 站点配置：[`website/docusaurus.config.ts`](docusaurus.config.ts)
- 侧边栏配置：[`website/sidebars.ts`](sidebars.ts)
- 实际文档内容：[`docs/`](../docs/)

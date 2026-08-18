# 拾页 · 桌面阅读与笔记

当前仓库包含 React/Vite 产品原型，以及面向下一阶段重构的产品与工程规范。

## 运行原型

```bash
npm install
npm run dev
```

生产检查：

```bash
npm run check
```

GitHub Pages 项目页路径检查：

```bash
npm run test:pages
```

## 公网发布（GitHub Pages）

项目可作为公开静态站点发布；每位访问者的数据只保存在自己浏览器的 IndexedDB 中，不会上传到 GitHub，也不提供账号或跨设备同步。

无需命令行 Git 的发布步骤见 [`docs/DEPLOY_GITHUB_PAGES.md`](./docs/DEPLOY_GITHUB_PAGES.md)。

## 产品与工程基线

请按以下顺序阅读：

1. [`docs/PRD.md`](./docs/PRD.md) — 产品定位、流程、优先级和交互规则；
2. [`docs/TECHNICAL_SPEC.md`](./docs/TECHNICAL_SPEC.md) — 架构、数据、导入、阅读器和安全规范；
3. [`docs/QUALITY_SPEC.md`](./docs/QUALITY_SPEC.md) — 测试、性能、无障碍和发布门禁；
4. [`docs/README.md`](./docs/README.md) — 文档索引、研究依据和当前实现审计。

> 当前页面是 Pre-Alpha 原型；文档描述的是目标 v1 基线。原型中尚未实现的能力不得仅依据文档视为已交付。

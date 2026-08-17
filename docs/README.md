# 拾页产品与工程文档

本目录是后续产品设计、实现和验收的唯一需求基线。

## 阅读顺序

1. [PRD](./PRD.md)：产品定位、用户流程、功能优先级、页面与交互规则；
2. [技术规范](./TECHNICAL_SPEC.md)：目标架构、数据模型、导入/阅读器接口、迁移和安全；
3. [质量规范](./QUALITY_SPEC.md)：完成定义、测试矩阵、性能/无障碍门禁和发布检查。

## 本轮需求优化结论

- 产品不是微信读书的视觉复制品，而是借鉴其公开 Web 阅读器的核心心智：书架进入阅读、章节目录、阅读设置、进度、想法/划线/书签聚合；
- v1 定位为“PWA-first、本地优先的桌面阅读器”；离线资源就绪后无需预热即可断网冷启动并完成核心流程。Chrome/Edge/Safari 使用可用的系统安装入口，Firefox 桌面使用同源书签/URL 冷启动；
- 数据可靠性优先级高于新增装饰性功能；
- 电子书格式必须按能力分级，不允许把“识别文件”表述为“支持阅读”；
- 首页、统计和进度必须来自真实行为，不继续混用演示数字；
- Web 版使用 IndexedDB 保存文件和业务数据，localStorage 只保存小型偏好；
- EPUB 内容按不可信主动内容隔离；PDF 保留 canvas/text/annotation/accessibility layers；
- 目标质量为 WCAG 2.2 AA，并以真实浏览器 E2E 验证核心闭环。

## 当前实现审计摘要

当前代码可作为视觉和交互原型，但仍属于 Pre-Alpha：

- `src/main.jsx` 集中了页面、状态和业务逻辑；
- 书籍/笔记使用 localStorage，写入失败被静默忽略；
- EPUB/PDF/TXT/MD 当前只保存最多 24,000 字预览，不是完整持久化阅读；
- MOBI/AZW3 只能识别入库；
- 首页在读书、时长、连续天数和图表存在硬编码；
- 缺少书籍/笔记完整 CRUD、带位置划线、目录和进度恢复；
- 测试目前以 Node 工具函数为主，缺少组件、E2E、无障碍和真实文件矩阵。

## 实施约束

- 任何需求变更先更新 PRD，再同步技术和质量规范；
- 每个实施里程碑必须从 PRD 功能 ID 派生验收用例；
- 未达到质量门禁的功能不可标记为完成；
- 若技术实现与 PRD 冲突，以用户目标和 PRD 为准，并记录产品决策；
- 不上传、内置或分发来源不明的受版权保护电子书；
- 不实现 DRM 绕过。

## 研究依据

采用的主要一手或权威来源：

- 微信读书公开 Web 阅读器：https://weread.qq.com/web/
- 微信读书公开阅读器示例：https://weread.qq.com/web/reader/714327705d07ed714a233c7
- EPUB Reading Systems 3.3：https://www.w3.org/TR/epub-rs-33/
- WCAG 2.2：https://www.w3.org/TR/WCAG22/
- MDN IndexedDB：https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- MDN 存储配额与清理：https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- PDF.js：https://mozilla.github.io/pdf.js/

公开微信读书页面只能证明可见的 Web 交互与信息结构；未登录流程、桌面客户端快捷键、同步冲突和离线策略没有被当作已验证事实。

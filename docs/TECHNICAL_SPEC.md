# 拾页桌面阅读器技术规范

> 文档版本：v1.0  
> 状态：架构基线  
> 对应 PRD：[PRD.md](./PRD.md)  
> 更新日期：2026-08-17

## 1. 目标与约束

本规范定义把当前单文件 React Demo 演进为可靠桌面阅读器所需的架构、数据模型、模块边界、状态机和工程约束。

### 1.1 技术目标

- 完整电子书、解析结果、进度、划线和笔记可在浏览器本地可靠持久化；
- EPUB、PDF 与纯文本阅读器共享统一的书籍、位置和注释接口；
- 解析大文件不阻塞 UI；
- 所有写入有明确事务边界，界面成功状态与真实持久化结果一致；
- 支持数据版本迁移、备份和恢复；
- 关键业务逻辑可单元测试，关键用户路径可端到端测试；
- 桌面优先，核心功能在离线状态可用。

### 1.2 现有技术栈

- React + ReactDOM；
- Vite；
- Lucide React；
- JSZip（EPUB 解包）；
- PDF.js（PDF 解析）；
- localStorage（当前书籍、笔记和设置）；
- JavaScript/JSX（当前尚未 TypeScript 化）。

### 1.3 已知结构问题

- `src/main.jsx` 同时承担数据、业务逻辑、页面、弹窗和路由职责；
- CSS 为单个高密度文件，主题和组件样式耦合；
- localStorage 保存正文和 data URL 封面，存在容量与一致性风险；
- 首页和统计混合真实数据与硬编码数据；
- EPUB/PDF 解析与 UI 缺少稳定中间模型；
- 没有错误边界、路由、集成测试和数据库迁移。

## 2. 目标架构

```text
UI / Routes
  ├─ Home / Library / Notes / Review / Statistics / Settings
  └─ Reader Workspace
        ├─ EPUB Renderer
        ├─ PDF Renderer
        └─ Text/Markdown Renderer
             │
Application Services
  ├─ ImportService
  ├─ LibraryService
  ├─ ReaderService
  ├─ AnnotationService
  ├─ SearchService
  ├─ ReviewService
  └─ BackupService
             │
Domain
  ├─ Book / BookFile / Publication
  ├─ Locator / ReadingProgress / ReadingSession
  ├─ Highlight / Note / Tag
  └─ UserSettings / ReviewSchedule
             │
Infrastructure
  ├─ IndexedDB repositories
  ├─ Web Workers
  ├─ OpenLibrary adapter
  ├─ Blob/Object URL manager
  └─ localStorage preferences
```

### 2.1 推荐目录

```text
src/
  app/
    App.tsx
    router.tsx
    providers/
  pages/
    home/
    library/
    notes/
    review/
    statistics/
    settings/
    reader/
  components/
    dialog/
    feedback/
    book/
    note/
  domain/
    book.ts
    locator.ts
    annotation.ts
    settings.ts
  services/
    import-service.ts
    reader-service.ts
    annotation-service.ts
    backup-service.ts
    search-service.ts
  storage/
    db.ts
    migrations.ts
    repositories/
  parsers/
    epub/
    pdf/
    text/
    workers/
  hooks/
  styles/
    tokens.css
    themes.css
    global.css
  test/
    fixtures/
```

### 2.2 迁移到 TypeScript

- 新模块必须使用 TypeScript；
- 旧组件按里程碑迁移，不要求一次性重写；
- `strict: true`；禁止在领域对象和数据库边界使用隐式 `any`；
- 外部 API、备份文件和数据库记录必须经过运行时 schema 校验；
- 推荐使用 Zod 或等价轻量校验库。

## 3. 路由规范

建议引入 React Router，URL 是用户可恢复状态的一部分。

| 路由 | 页面 |
|---|---|
| `/` | 今日阅读 |
| `/library` | 书架 |
| `/library/:bookId` | 书籍详情 |
| `/reader/:bookId` | 阅读器 |
| `/notes` | 全部笔记 |
| `/notes/:noteId` | 笔记详情 |
| `/highlights` | 划线 |
| `/review` | 回顾 |
| `/statistics` | 统计 |
| `/settings/:section?` | 设置 |

规则：

- 阅读位置不放在 URL 查询参数中，避免每次滚动制造历史记录；
- `bookId`、`noteId` 必须是内部稳定 ID，不使用可变书名；
- 对不存在、已删除或损坏对象提供可恢复 404 页面；
- 返回阅读器时优先恢复内存位置，其次数据库位置。

## 4. 存储设计

### 4.1 存储分工

| 存储 | 内容 | 原因 |
|---|---|---|
| IndexedDB | 原文件 Blob、章节、书目、进度、划线、笔记、会话、索引 | 大容量、异步、索引、事务 |
| localStorage | 主题、语言、最近视图等小型偏好；数据库版本迁移标志 | 启动读取简单 |
| 内存 | 当前章节 DOM、临时选区、弹窗草稿、Object URL | 生命周期短 |
| Cache Storage（PWA） | 应用静态资源 | 离线启动，不保存用户业务数据 |

禁止：

- 在 localStorage 保存电子书正文、Blob 或大尺寸 base64 封面；
- 把 Object URL 持久化；
- 在数据库事务成功前显示“已保存”；
- 静默吞掉配额或迁移错误。

应用首次稳定写入后应调用 `navigator.storage.persist()` 请求持久存储，并通过 `navigator.storage.estimate()` 显示使用量/配额；必须如实展示是否获批。浏览器存储仍可能被清理，因此持久化状态不能替代备份。

### 4.2 IndexedDB schema

数据库名：`shiyue-reader`  
初始目标版本：`v1`

所有可编辑记录包含 `revision`；所有软删除记录实现 `TrashableRecord`。30 天清理任务只删除过期对象，级联规则见 §4.5。

```ts
interface TrashableRecord {
  deletedAt?: string;
  trashGenerationId?: string;
}
```

#### `books`

```ts
interface BookRecord extends TrashableRecord {
  id: string;
  activeSourceId: string;
  activeFileId?: string;
  fingerprint?: string;        // 当前活动文件 SHA-256；普通索引，非唯一
  duplicateGroupId?: string;
  title: string;
  author: string;
  description?: string;
  language?: string;
  publisher?: string;
  publishedAt?: string;
  isbn?: string;
  coverId?: string;
  format: 'EPUB' | 'PDF' | 'TXT' | 'MD' | 'MOBI' | 'AZW3' | 'METADATA_ONLY';
  capability: 'FULL' | 'TEXT_ONLY' | 'VIEW_ONLY' | 'FILE_ONLY' | 'METADATA_ONLY';
  status: 'WANT_TO_READ' | 'READING' | 'FINISHED' | 'PAUSED';
  categoryIds: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  deletedAt?: string;
}
```

索引：`fingerprint`（non-unique）、`isbn`、`duplicateGroupId`、`status`、`updatedAt`、`lastOpenedAt`、`deletedAt`。是否重复由 ImportService 决策；“保留副本”共享 duplicateGroupId 但拥有独立 bookId。

#### `bookFiles`

```ts
interface BookFileRecord extends TrashableRecord {
  id: string;
  bookId: string;
  sourceId: string;
  generationId: string;
  name: string;
  mimeType: string;
  size: number;
  chunkCount: number;
  checksum: string;
  parserVersion: string;
  renditionVersion: string;
  parseStatus: 'PENDING' | 'PARSING' | 'READY' | 'PARTIAL' | 'FAILED' | 'REPLACED';
  parseErrorCode?: string;
  createdAt: string;
  updatedAt: string;
  replacedAt?: string;
  deletedAt?: string;
}
```

`books.activeFileId` 是唯一活动文件；替换前的文件保留至用户确认重定位或回收站到期。

#### `bookFileChunks` 与 `publicationSources`

```ts
interface BookFileChunkRecord {
  id: string;                 // `${bookFileId}:${index}`
  bookFileId: string;
  generationId: string;
  index: number;
  size: number;
  checksum: string;
  data: ArrayBuffer;
}

interface PublicationSourceRecord {
  id: string;
  bookId: string;
  kind: 'FILE' | 'LEGACY_PREVIEW' | 'METADATA_ONLY';
  bookFileId?: string;
  fingerprint: string;        // 文件 checksum 或 legacy 内容确定性 hash
  provenance?: 'IMPORTED' | 'LEGACY_PREVIEW' | 'ONLINE_METADATA';
  parserVersion?: string;
  renditionVersion?: string;
  generationId: string;
  legacyDisplayProgress?: number;
  createdAt: string;
}
```

原文件按固定最大 4MiB chunk 写入；chunk `[bookFileId+index]` 唯一。组装时校验连续 index、总 size、逐块和整文件 checksum；取消/TTL 清理按 generation 删除。`LEGACY_PREVIEW` 可拥有 Section 但没有 BookFile；`METADATA_ONLY` 没有 Section/Locator。

#### `covers`

```ts
interface CoverRecord {
  id: string;
  sourceId?: string;
  generationId: string;
  blob?: Blob;
  remoteSourceUrl?: string;
  mimeType?: string;
  checksum?: string;
  createdAt: string;
}
```

远程 URL 只作为元数据保存；用户允许后由 adapter 下载、验证为图片 Blob，再通过 Object URL 展示。

#### `sections`

```ts
interface SectionRecord {
  id: string;
  bookId: string;
  sourceId: string;
  bookFileId?: string;
  generationId: string;
  order: number;
  canonicalPath?: string;
  spineIdRef?: string;
  linear?: boolean;
  title: string;
  mediaType: string;
  manifestProperties?: string[];
  renditionLayout?: 'REFLOWABLE' | 'PRE_PAGINATED';
  renditionFlow?: string;
  pageSpread?: string;
  viewport?: string;
  text?: string;
  sanitizedHtml?: string;
  wordCount: number;
  renditionVersion: string;
}
```

索引：`[sourceId+order]`、`[bookId+generationId]`。只有 generation `COMMITTED` 且属于 activeSourceId 的 section 对读取层可见。LEGACY_PREVIEW 的 EPUB 专用字段允许空值，schema 通过 `source.kind` 判别联合类型。

#### `tocItems`

```ts
interface TocItemRecord {
  id: string;
  bookId: string;
  sourceId: string;
  bookFileId?: string;
  generationId: string;
  parentId?: string;
  order: number;
  label: string;
  canonicalHref: string;
  fragment?: string;
  sectionId?: string;
  source: 'EPUB_NAV' | 'EPUB_NCX' | 'PDF_OUTLINE' | 'GENERATED';
}
```

EPUB 3 使用 navigation document；EPUB 2 必须提供 NCX fallback。

#### `publicationResources`

```ts
interface PublicationResourceRecord {
  id: string;
  bookId: string;
  sourceId: string;
  bookFileId?: string;
  generationId: string;
  canonicalPath: string;
  mediaType: string;
  blob: Blob;                  // 已验证/净化后的资源
  checksum: string;
  kind: 'STYLE' | 'IMAGE' | 'FONT' | 'SVG' | 'MEDIA' | 'OTHER';
}
```

索引 `[sourceId+canonicalPath]` 唯一（同 source 内），`[bookId+generationId]` 用于清理。所有 HTML/CSS/SVG 引用在版本化 canonical rendition 中重写为受控资源；不得直接保留可发网请求的 author URL。

#### `progress`

```ts
interface ReadingProgressRecord {
  bookId: string;
  locator: Locator;
  percentage: number;          // [0, 1]
  revision: number;
  updatedAt: string;
  deviceId: string;
}
```

#### `highlights`、`notes`、`bookmarks`

```ts
interface HighlightRecord extends TrashableRecord {
  id: string;
  bookId: string;
  locator?: Locator;
  locatorStatus: 'RESOLVED' | 'UNRESOLVED' | 'SOURCE_UNAVAILABLE';
  quote: string;
  prefix?: string;
  suffix?: string;
  color: 'YELLOW' | 'GREEN' | 'BLUE' | 'PURPLE';
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

interface NoteRecord extends TrashableRecord {
  id: string;
  bookId?: string;
  highlightId?: string;
  locator?: Locator;
  locatorStatus?: 'RESOLVED' | 'UNRESOLVED' | 'SOURCE_UNAVAILABLE';
  type: 'THOUGHT' | 'QUOTE' | 'QUESTION' | 'ACTION';
  content: string;
  originalContent?: string;
  tagIds: string[];
  categoryIds: string[];
  legacyDateLabel?: string;
  dateProvenance?: 'EXACT' | 'UNKNOWN';
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

interface BookmarkRecord extends TrashableRecord {
  id: string;
  bookId: string;
  locator?: Locator;
  locatorStatus: 'RESOLVED' | 'UNRESOLVED' | 'SOURCE_UNAVAILABLE';
  label?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}
```

#### 分类、设置与流程 store

- `tags`：`id/name/revision/deletedAt`，活动标签名唯一；
- `categories`：`id/name/order/revision/deletedAt`，书籍和笔记均可引用；
- `readingSessions`：开始、结束、活跃时间区间、书籍；多标签页区间按并集统计；
- `activityLeases`：跨标签页统计 leader 的 tabId/fencingToken/expiresAt，防止同一时刻重复累计；
- `reviewSchedules`（P1）：对象、下次日期、阶段、结果；
- `settings`：`scope = GLOBAL | BOOK`、可选 `bookId`、分组、schema 化 value、revision；单本阅读设置覆盖全局默认；
- `noteRevisions`：保存冲突或用户主动采用润色前后的有限历史；
- `editLeases`：`noteId/tabId/fencingToken/expiresAt`；在一个读写事务中原子 acquire/renew/takeover，每次写入校验 fencingToken，过期 owner 不能覆盖；
- `importJobs` / `restoreJobs`：使用下述显式 generation schema；
- `backupSnapshots` / `backupSnapshotChunks`：短期不可变 JSON 快照及 immutable Blob 引用，完成/失败后清理；
- `trashGenerations` / `trashEntries`：使用下述统一回收站级联 schema；
- `searchIndex`：派生数据，可删除重建，不进入权威备份；
- `migrationLog`：权威迁移版本、确定性 ID 映射、时间、结果、隔离记录和错误；
- `quarantine`：保存无法迁移记录的原始 JSON、来源 key、错误码和导出状态。

#### generation 与 staging schema

```ts
interface JobRecord {
  id: string;                  // generationId
  kind: 'IMPORT' | 'RESTORE';
  state: 'STAGING' | 'WAITING_CONFIRMATION' | 'COMMITTING' | 'COMMITTED' | 'FAILED' | 'CANCELLED';
  createdAt: string;
  expiresAt: string;
  errorCode?: string;
}

interface RestoreStagingRecord {
  id: string;
  generationId: string;
  targetStore: AuthoritativeStoreName;
  targetId: string;
  operation: 'INSERT' | 'REPLACE' | 'SKIP';
  payload: unknown;            // 已通过目标 store schema 校验
  checksum: string;
}
```

可见性规则：import 产生的 source/file/chunk/section/resource/toc/cover 只有其 JobRecord.state=`COMMITTED` 且 sourceId=`book.activeSourceId` 时可见；restore staging 永不被普通 repository 查询。restore 的最终短事务覆盖所有受影响的权威 JSON store、校验 immutable Blob/chunk 引用、应用确定性 ID remap，最后把 job 标记 COMMITTED。事务失败会整体回滚；原文件 chunks/covers 可先以 generation staging 写入，未被 committed 业务记录引用前不可见并由 TTL 清理。

#### trash generation schema

```ts
interface TrashGenerationRecord {
  id: string;
  rootType: 'BOOK' | 'NOTE' | 'HIGHLIGHT' | 'BOOKMARK' | 'CATEGORY' | 'TAG';
  rootId: string;
  state: 'TRASHED' | 'RESTORED' | 'PURGED';
  createdAt: string;
  expiresAt: string;
}

interface TrashEntryRecord {
  id: string;
  trashGenerationId: string;
  storeName: AuthoritativeStoreName;
  recordId: string;
  action: 'SOFT_DELETE' | 'DETACH_SOURCE' | 'PURGE_DERIVED';
  previousRevision?: number;
}
```

删除在一个短事务中：创建 TrashGeneration/entries；给支持软删除的 root/user records 写 `deletedAt + trashGenerationId`；progress/section/resource/file chunks 等派生记录不必修改自身 schema，但通过 entry 明确纳入同一 generation，且因 root book deleted/activeSource 不可见。恢复按 entries 清除软删除/恢复引用；彻底清理按 entries 删除派生数据和 Blob chunks，并最后把 generation 标为 PURGED。任何部分失败由事务整体回滚。

### 4.3 Locator 统一位置模型

```ts
interface LocatorBase {
  schemaVersion: 1;
  sourceId: string;
  bookFileId?: string;
  sourceFingerprint: string;
  renditionVersion: string;
}

type Locator =
  | (LocatorBase & {
      kind: 'EPUB_CFI';
      sectionId: string;
      startCfi: string;
      endCfi?: string;          // 无 endCfi 为点位置
      progression?: number;    // [0, 1]
      textQuote?: string;
      prefix?: string;
      suffix?: string;
    })
  | (LocatorBase & {
      kind: 'EPUB_TEXT_ANCHOR';
      sectionId: string;
      startOffset?: number;
      endOffset?: number;
      progression?: number;
      textQuote: string;
      prefix?: string;
      suffix?: string;
    })
  | (LocatorBase & {
      kind: 'PDF';
      documentFingerprint: string;
      pageNumber: number;       // 1-based
      pageProgression?: number; // [0, 1]
      rects?: Array<{ x: number; y: number; width: number; height: number }>;
      rotation: 0 | 90 | 180 | 270;
      coordinateSpace: 'PDF_USER_SPACE_CROP_BOX';
      textQuote?: string;
      prefix?: string;
      suffix?: string;
    })
  | (LocatorBase & {
      kind: 'TEXT';
      sectionId: string;
      startOffset: number;
      endOffset?: number;
      textQuote?: string;
      prefix?: string;
      suffix?: string;
    });
```

要求：

- Locator 可序列化、可比较、可迁移，数值 progression/percentage 范围均为 `[0,1]`；
- v1 选区限制在单章节（EPUB/TXT/MD）或单页（PDF）；跨边界选择提示拆分，不静默截断；
- PDF rect 使用与缩放无关的 CropBox 用户空间，解析时统一处理旋转；
- 精确版本优先解析；CFI 无法生成时使用 EPUB_TEXT_ANCHOR；文件替换/重解析后使用 quote/prefix/suffix 尽力迁移；失败显式标记 `LOCATOR_UNRESOLVED`，不跳到错误位置；
- 进度百分比只是展示数据，不能作为唯一恢复位置；
- 每种渲染器实现 `resolveLocator`、`createPointLocator` 和 `createRangeLocator`。

### 4.4 数据迁移

首次升级时：

1. 在调用现有 normalize 函数前读取原始 `shiyue-books`、`shiyue-notes`、`shiyue-theme` JSON，避免 100 本/50 条上限造成二次丢失；
2. 运行 schema 校验，用 `legacy source key → new id` 确定性映射保证幂等；
3. 只有预览文本、没有 Blob 的记录迁为 provenance=`LEGACY_PREVIEW` 的 Section，capability=`TEXT_ONLY`，不得伪造 BookFile；无预览迁为 `METADATA_ONLY`；
4. 有效 data-image 封面解码进入 covers；远程 URL 只迁元数据，不在未同意时请求；
5. 旧进度只有百分比时保存为 `legacyDisplayProgress`，不得伪造稳定 Locator；
6. `刚刚/今天/昨天` 等无法还原的日期保留原始值和 `dateProvenance=UNKNOWN`，不冒充迁移时刻；
7. 非法/损坏记录进入 quarantine 并允许导出，不静默丢弃；
8. 写入 migrationLog；它是权威迁移状态，localStorage 只可作为启动优化提示；
9. 处理跨标签页升级：旧连接收到 `versionchange` 后安全关闭，新版本遇到 `blocked` 时明确提示用户关闭其他页面；
10. 验证记录数、引用和关键字段后才提交完成 generation；旧数据保留至少一个版本，用户确认后可清理。

迁移必须幂等；在每个步骤中断后重试不产生重复记录。当前版本已经丢失或因配额失败未写入的数据无法恢复，迁移 UI 必须如实说明。

### 4.5 删除、替换与回收站

- books、bookFiles、notes、highlights、bookmarks、categories、tags 软删除后保留 30 天；每次级联使用 TrashGeneration/TrashEntry 表示；清理器按 expiresAt 批次执行并记录日志；
- 删除书籍默认把活动文件/派生章节/进度/书签置入同一 trash generation；用户选择保留笔记/划线时，它们保留 quote/context 快照并解除可用 locator，标记 `SOURCE_UNAVAILABLE`；
- 恢复书籍必须恢复同一 generation 的原文件和引用；彻底删除前重新计算影响计数；
- 文件替换创建新 BookFile/generation，不覆盖旧 Blob。发布新 activeFileId 后运行 locator migration；成功、失败和未解析对象都可审阅，旧文件在用户确认或 30 天后才清理；
- 相同 checksum 可保留副本；每本副本有独立 bookId/progress/notes，可选在存储层引用同一不可变 Blob；
- note 编辑使用 `revision` CAS。活动编辑租约存储 `noteId/tabId/expiresAt`，BroadcastChannel 续租/接管；冲突双方写入 noteRevisions。

书籍状态机：导入/仅书目创建 → `WANT_TO_READ`；首次成功打开 → `READING`；用户可在 WANT_TO_READ/READING/PAUSED/FINISHED 间手动转换；达到 98% 只发出确认事件。进度以 revision+updatedAt 合并，跨标签页通过 BroadcastChannel 失效缓存；任何百分比都不能覆盖更新的稳定 Locator。

恢复容差：EPUB/TEXT 优先同 Locator，同 quote fallback 时命中同一段且目标前后 ≤120 字符；PDF 同 pageNumber 且 pageProgression 误差 ≤0.05。超出容差视为 unresolved 并要求用户选择，不算成功恢复。

## 5. 导入管线

```text
选择文件
  → 扩展名 + MIME + 魔数校验
  → 存储配额预检
  → 流式 SHA-256 指纹
  → 重复检测
  → 创建 importJob/generation
  → 分批 staging 原文件/资源
  → Worker 解析并分批持久化
  → 用户确认元数据（事务外）
  → 短事务校验引用并切换 COMMITTED + activeSourceId/activeFileId
  → 异步建立可重建搜索索引
  → 成功页
```

### 5.1 状态机

```ts
type ImportState =
  | 'IDLE'
  | 'VALIDATING'
  | 'CHECKING_DUPLICATE'
  | 'PERSISTING_FILE'
  | 'PARSING'
  | 'WAITING_CONFIRMATION'
  | 'COMMITTING'
  | 'SUCCESS'
  | 'CANCELLED'
  | 'FAILED';
```

状态转移与副作用：

| 当前状态 | 事件 | 下一状态 | 持久化/清理 |
|---|---|---|---|
| IDLE | SELECT | VALIDATING | 创建内存任务 |
| VALIDATING | VALID | CHECKING_DUPLICATE | 无可见业务记录 |
| CHECKING_DUPLICATE | CONFIRM | PERSISTING_FILE | 创建 importJob/generation |
| PERSISTING_FILE | STORED | PARSING | 分块 staging Blob |
| PARSING | PARSED | WAITING_CONFIRMATION | 分批 staging sections/resources；对用户不可见 |
| WAITING_CONFIRMATION | COMMIT | COMMITTING | 事务外等待用户，不保持 IDB transaction |
| COMMITTING | TRANSACTION_COMPLETE | SUCCESS | 短事务校验引用、标记 COMMITTED、切 activeSourceId/activeFileId |
| 任意非终态 | CANCEL | CANCELLED | 中止 Worker，标记任务待 TTL 清理 |
| 任意非终态 | ERROR | FAILED | 回滚/隐藏 generation，保留可诊断错误 |

启动时清理超过 24 小时且非 COMMITTED 的 job/generation；清理不得触碰已提交 generation。任何等待 Worker 或用户输入的阶段都不保持 IndexedDB transaction。并发编辑记录采用 `revision` 乐观锁；`BroadcastChannel` 通知其他标签页失效，冲突保留 noteRevision/草稿而非静默覆盖。

### 5.2 文件校验

- 不能只依赖扩展名；校验 MIME 和文件头；
- EPUB 必须是 ZIP 且包含 `META-INF/container.xml`；
- PDF 必须以 `%PDF-` 开头；
- TXT/MD 做 BOM 和 UTF-8/GB18030 检测；
- 产品默认软限制 100MiB；根据存储配额风险确认后可继续，v1 硬上限 500MiB；
- EPUB 安全上限：条目数 10,000、单条解压 50MiB、总解压 500MiB、压缩比 100:1；任一超限拒绝并返回 `IMPORT_ZIP_LIMIT`；
- 解析加密/DRM 时返回明确错误码，不尝试绕过。

### 5.3 Worker

- JSZip、EPUB AST 解析/净化、PDF 文本提取和正文索引在 Web Worker 中运行；必须采用 Worker 可用的 XML/HTML parser，不能假设 Dedicated Worker 存在 DOMParser；
- Worker 通过 `MANIFEST`、`TOC_BATCH`、`SECTION_BATCH`、`RESOURCE_BATCH`、`WARNING_BATCH`、`PROGRESS`、`COMPLETE` 消息分批输出，并接受 ACK/backpressure；每批 ≤100 项且序列化后 ≤1MiB，超大单资源走 Transferable/Blob staging 引用；禁止一次返回任何无界集合；
- SHA-256 使用经审计且锁定版本的增量实现，在 Worker 中按块计算；Web Crypto `digest()` 不被描述为流式实现；
- 大二进制通过 Transferable ArrayBuffer 或 staging Blob 引用传递，避免复制；
- 支持 AbortSignal/取消消息；
- 主线程只处理 UI、数据库事务和当前阅读章节渲染；
- PDF.js worker 版本必须与主库一致。

### 5.4 Publication 中间模型

所有解析器先输出小型 manifest，再分批输出内容：

```ts
interface ParsedPublicationManifest {
  metadata: ParsedMetadata;
  tocCount: number;
  coverMeta?: { mediaType: string; size: number };
  capability: BookRecord['capability'];
  sectionCount: number;
  resourceCount: number;
  warningCount: number;
}
```

Section/resource batch 有最大条目数和最大字节数，并在 staging 事务成功后向 Worker 回 ACK。禁止页面组件直接理解 OPF、PDF 内部对象或 ZIP entry。

## 6. 阅读器接口

```ts
interface ReaderAdapter {
  open(bookId: string, initial?: Locator): Promise<void>;
  close(): Promise<void>;
  goTo(locator: Locator): Promise<void>;
  getCurrentLocator(): Locator | null;
  next(): Promise<void>;
  previous(): Promise<void>;
  search(query: string): Promise<SearchHit[]>;
  getSelection(): ReaderSelection | null;
  applySettings(settings: ReadingSettings): void;
}
```

### 6.1 EPUB

- 解析 package metadata、spine 阅读顺序和 navigation document；
- v1 只渲染流式 EPUB；检测到 `PRE_PAGINATED` 时保留原文件并以 FILE_ONLY/VIEW_ONLY 能力提示，固定版式渲染属于 P1；
- publication XHTML 必须在 sandboxed iframe 中渲染，不允许以 shadow root 作为安全边界；
- importer 删除出版物脚本、表单、事件属性、embed/object、meta refresh 和主动 SVG；解析并重写 CSS `url()`/`@import`、HTML/SVG 引用，未映射网络资源默认阻断；
- iframe 使用 `sandbox="allow-scripts"` 且不含 `allow-same-origin`、导航、表单、弹窗权限；唯一可执行脚本是带 nonce/hash 的应用自有 bridge。frame CSP 默认拒绝，仅允许受控 blob/data 图片、字体、样式和 bridge；`connect-src 'none'`；
- bridge 使用随机 channel token + 校验过的 postMessage 协议向父层提供 selection/locator；不得暴露数据库或任意 URL fetch；
- 所有链接由父层接管，只允许 http(s)/mailto 等白名单协议，外部跳转需用户同意；
- 优先采用 EPUB CFI；无法生成时使用章节+文本锚点降级；CFI 针对版本化 canonical rendition DOM 生成；
- 支持章节内滚动，v1 不要求仿真翻页动画；
- 阅读系统样式保留作者样式与用户覆盖之间清晰的 CSS cascade 优先级，不破坏原始文档；
- 净化阶段把资源引用规范化为 `shiyue-resource://<sourceId>/<canonicalPath>` 占位符；打开章节时 ResourceMaterializer 递归解析 HTML/CSS/SVG 依赖，从 `[sourceId+canonicalPath]` 建立 session-scoped Blob URL 映射，重写后再送入 iframe；字体只从映射 Blob 加载；
- 每个 reader session 维护 URL registry 和引用计数；章节离开/阅读器关闭时 revoke。缺失、循环 `@import` 或 CSP 不允许的资源形成可见 warning，不回退到网络请求。

### 6.2 PDF

- PDF.js、worker、CMaps、standard fonts、WASM/image decoders 均随 PWA 本地打包；离线不依赖 CDN；
- PDF.js 页面使用 canvas、text、annotation 和 accessibility/structure layers（源 PDF 提供时）；不能只渲染位图；
- 链接动作仅允许安全 URI 白名单并由应用确认；禁用 JavaScript、Launch、附件执行和不受控表单提交；
- 自有划线/笔记存入本项目 annotation domain，不能误用 PDF.js `annotationStorage` 充当笔记数据库；
- 虚拟化渲染当前页附近页面，取消过期 render task，释放离屏页面资源，禁止一次渲染整本书；
- 进度按页码和页内偏移；
- 搜索结果映射页码和文本片段；
- 扫描 PDF 没有文本层时显示能力提示，不返回空白“搜索成功”；
- 阅读器关闭时取消 render task，调用 document/page cleanup/destroy 并释放 canvas、Object URL 和事件监听。

### 6.3 TXT/Markdown

- 编码检测失败时允许用户选择编码并重新解析；
- TXT 按标题启发式或固定字数建立虚拟章节；
- Markdown 使用白名单渲染，禁止原始危险 HTML；
- 标题生成目录锚点；位置使用 sectionId + charOffset + textQuote。

## 7. 注释与笔记

### 7.1 自动保存

- 笔记输入 500ms 防抖保存草稿；
- 显示“保存中 / 已保存 / 保存失败”；
- 关闭编辑器前强制 flush；
- 失败保留内存草稿并允许复制；
- 冲突策略以 editLease fencing token + revision CAS 为准；无有效租约/旧 fencing token 的写入拒绝并保留为冲突草稿，不采用静默“最后写入优先”。

### 7.2 润色接口

```ts
interface PolishProvider {
  polish(input: {
    content: string;
    level: 'LIGHT' | 'PROFESSIONAL' | 'DEEP';
    type: NoteRecord['type'];
  }): Promise<{ content: string; changes?: TextChange[] }>;
}
```

约束：

- `QUOTE` 默认禁用；
- 本地规则 provider 必须明确标记“基础优化”；
- 未来远程 provider 必须获得用户明确同意，不上传书籍正文上下文；
- 永远保留 `originalContent`，采用结果是用户操作而非自动覆盖。

## 8. 状态管理

- 服务端/数据库异步状态使用查询缓存层或自定义 repository hooks；
- 短期 UI 状态保留在组件；跨页面状态使用小型 store；
- 不把完整 Blob、章节 HTML、大列表副本放进全局 React state；
- 派生统计通过 selector 计算或写入缓存表；
- 每个复杂流程使用显式 reducer/state machine，禁止大量互斥布尔值。

推荐：

- 路由：React Router；
- IndexedDB：Dexie 或等价封装；
- schema：Zod；
- 全局 UI 状态：Zustand 或 Context + reducer；
- 测试：Vitest + React Testing Library + Playwright；
- 可访问性：axe-core。

推荐不等于强制新增所有依赖；引入前必须评估包体积和维护状态。

## 9. 搜索

### 9.1 索引范围

- 书名、作者、ISBN；
- 笔记与标签；
- EPUB/TXT/MD 正文；
- PDF 文本层。

### 9.2 v1 实现

- 全局搜索 P0 只索引书目、笔记和标签；
- 当前书正文搜索 P0：已解析 EPUB/TXT/MD 使用该书 section token 索引，PDF 使用流式 text content 索引；扫描 PDF 明确不可搜索；
- 跨全部书籍正文的统一索引属于 P1；
- 中文至少支持连续子串和双字切分；
- 搜索结果统一返回 `type/bookId/locator/title/snippet/matchedRanges`；
- 索引构建放入 Worker，索引为派生数据，可删除重建；
- 导入成功不必等待索引完成，但必须显示索引状态；打开当前书时可按需补建。

## 10. 统计

阅读器产生事件，统计服务消费事件；UI 不直接硬编码。

```ts
interface ReadingActivity {
  id: string;
  bookId: string;
  tabId: string;
  startedAt: string;
  endedAt: string;
  activeIntervals: Array<{ start: string; end: string }>;
  activeSeconds: number;       // intervals union 后派生/校验
  startLocator?: Locator;
  endLocator?: Locator;
}
```

- 活动事件更新 lastActiveAt；自最后活动起最多继续累计 60 秒，第 61 秒起暂停；
- 5 分钟无活动结束并落盘会话，但不补计第 61 秒后的空闲区间；
- `visibilitychange`、章节切换和 5 秒节流保存是主要 flush；`pagehide` 仅作补充；
- activity leader lease 保证实时累计单写；异常情况下产生的重复/重叠会话在查询时按时间区间并集去重；
- 基础图表固定计算近 7 个本地自然日的 active interval 分钟数，空日补 0；
- 阅读进度百分比按 PRD §10 的各格式公式计算并 clamp 到 `[0,1]`；
- 日期口径统一使用用户本地时区。

## 11. 外部服务

### 11.1 OpenLibrary adapter（P1，可选能力）

```ts
interface MetadataProvider {
  search(query: string, signal: AbortSignal): Promise<MetadataResult[]>;
  lookupIsbn(isbn: string, signal: AbortSignal): Promise<MetadataResult | null>;
}
```

- 超时 8 秒；
- 限制并发和重试次数；
- 缓存查询结果；
- provider 不可用不影响本地文件导入；
- 封面失败使用本地占位封面；
- UI 明确区分元数据与正文。

### 11.2 网络与隐私

- 默认不上传电子书正文和笔记；默认不自动请求外部书目或封面；
- 用户主动执行在线搜索即同意本次发送查询词/ISBN，界面说明服务方可看到 IP；
- 远程封面开关默认关闭；开启后经 adapter 下载、验证、缓存为 Blob，组件不得直接把远程 URL 赋给 img；关闭后已缓存 Blob 是否保留由用户设置决定；
- 所有远程服务经 adapter，组件不得直接 fetch；
- 生产环境配置 Content Security Policy；PWA 离线测试必须确认核心流程无意外网络请求。

### 11.3 PWA 离线与更新

- 安装阶段 precache 应用 shell、字体、图标、路由 fallback，以及全部 P0 importer/reader runtime：JSZip/EPUB parser、PDF.js/worker/CMaps/standard fonts/WASM decoders、TXT/MD parser；不得依赖首次使用预热；
- Cache Storage 只保存可重建应用资源，不保存权威书籍/笔记；
- install 只有在全部 P0 离线资源通过 checksum 后才完成；UI 仅在 active Service Worker 确认清单完整后显示“离线资源已就绪”；
- Service Worker 更新下载完成后提示用户“新版本可用”，仅在没有未保存草稿/进行中导入时激活；
- 数据库迁移由应用启动流程控制，不由 Service Worker 直接修改；
- manifest 声明桌面 display/图标/文件关联能力；Chrome/Edge/Safari 使用可用的安装入口；Firefox 桌面不承诺系统安装入口，但 Service Worker/cache 必须支持从同源书签/URL 断网冷启动；v1 不依赖 OS 文件关联作为核心路径；
- 离线冷启动若发现静态资源版本与数据库 schema 不兼容，保留旧 shell 或进入只读恢复页，不破坏数据。

## 12. 备份格式

建议容器：ZIP。

```text
shiyue-backup-YYYY-MM-DD.zip
  manifest.json
  data/books.json
  data/book-files.json
  data/publication-sources.json
  data/committed-generations.json
  data/sections.json
  data/toc-items.json
  data/publication-resources.json
  data/covers.json
  data/notes.json
  data/note-revisions.json
  data/highlights.json
  data/bookmarks.json
  data/tags.json
  data/categories.json
  data/progress.json
  data/reading-sessions.json
  data/review-schedules.json
  data/settings.json
  data/trash-generations.json
  data/trash-entries.json
  files/<bookFileId>/original.bin
  resources/<sourceId>/<resourceId>.bin
  covers/<coverId>.bin
```

`manifest.json` 包含：schemaVersion、appVersion、backupMode（FULL/THIN）、createdAt、每个权威 store 的 count、关系、JSON/binary 每项 path+size+SHA-256 和不含原文件时的能力降级。FULL 必须序列化 publicationSources、COMMITTED generation 元数据、活动及仍在保留期内版本的原文件、sections、tocItems、publicationResources binary 与 renditionVersion，保证 CFI/locator 可按原 canonical rendition 恢复；THIN 不含这些正文资源并明确降级。bookFileChunks 在 ZIP 中重组为 original.bin，恢复时重新分块并验证整文件/块 checksum；CoverRecord 元数据在 JSON，Blob 在 covers 路径。searchIndex/cache 明确排除并重建。

备份一致性协议：

1. 通过 BroadcastChannel 请求所有标签页 flush 草稿并进入最长 2 秒写屏障；任一标签页未确认则不开始快照；
2. 在一个只含同步 IDB request 链的读写事务中，用 cursor 读取全部权威 JSON 记录，并分块写入不可变 `backupSnapshotChunks`；同时记录 immutable Blob/chunk/cover ID+checksum 引用；
3. transaction `complete` 后释放写屏障；后续编辑不影响该 snapshot；
4. 从 snapshot chunks 与 immutable Blob 引用流式生成 ZIP，完成或取消后清理 snapshot；
5. 若 JSON 快照预检超过 100MiB 或屏障/事务失败，终止并给出分库/清理建议，不生成不一致备份。

ZIP 优先流式写入文件；不支持流式时预检总大小并允许分卷或改为 THIN，禁止把整个书库一次装入内存。

恢复协议：校验 manifest/schema/checksum → 预览统计 → 用户按书/笔记选择跳过、覆盖、保留副本或按 updatedAt 合并 → 写入 restoreJob 隐藏 generation → 为每个备份 source/import generation 创建新的本地 generationId，并确定性重映射 book/source/file/section/resource/locator/trash 的全部 ID/引用 → 校验引用和计数 → 短事务发布并把新 generation 标为 COMMITTED。禁止直接复用可能冲突的备份 generationId。失败/取消清理 staging，不改变 committed 数据。

## 13. 错误模型

```ts
interface AppError {
  code: string;
  userMessage: string;
  cause?: unknown;
  recoverable: boolean;
  action?: 'RETRY' | 'CHOOSE_FILE' | 'FREE_SPACE' | 'OPEN_EXISTING' | 'EXPORT_DRAFT';
  context?: Record<string, string | number | boolean>;
}
```

基础错误码：

- `IMPORT_UNSUPPORTED_FORMAT`
- `IMPORT_DRM_OR_ENCRYPTED`
- `IMPORT_CORRUPTED`
- `IMPORT_DUPLICATE`
- `IMPORT_ZIP_LIMIT`
- `STORAGE_QUOTA_EXCEEDED`
- `STORAGE_TRANSACTION_FAILED`
- `PARSER_WORKER_FAILED`
- `BOOK_NOT_FOUND`
- `LOCATOR_UNRESOLVED`
- `NOTE_SAVE_FAILED`
- `BACKUP_INVALID`
- `METADATA_PROVIDER_TIMEOUT`

错误边界：应用级、页面级、阅读器级。阅读器崩溃不能导致笔记草稿丢失。

## 14. 样式与桌面布局技术规则

- 使用 design tokens，不在组件中散落颜色和尺寸；
- 基准正文字号不得小于 14px，主要正文默认 17px；
- 应用内容最大宽度 1560px；书架使用 CSS Grid `repeat(auto-fill, minmax(...))`；
- 阅读器正文与应用侧边栏解耦；
- 断点由内容决定，至少覆盖 768、1024、1280、1600；
- 支持 200% 缩放时主要功能不丢失；
- 主题由 `data-theme` + CSS variables 驱动；
- 支持 `prefers-color-scheme` 和 `prefers-reduced-motion`。

## 15. 性能设计

- 路由级代码分割；PDF.js、JSZip、解析器只在需要时加载；
- PDF worker 不进入首屏主 bundle；
- 长书架和笔记列表虚拟化或分页；
- 封面生成缩略图，不在列表加载原始大图；
- Object URL 用后及时 revoke；
- 搜索、进度、草稿写入节流；
- Worker 消息避免反复传递大字符串，优先 Transferable/分块。

具体预算见 [质量规范](./QUALITY_SPEC.md)。

## 16. 安全规范

- EPUB/Markdown HTML 必须净化；禁用脚本、事件属性、危险 URL；
- iframe 使用 sandbox，按最小权限开放；
- ZIP 解压限制总大小、单文件大小、条目数量和压缩比；
- 文件类型使用魔数复核；
- 不解析或绕过 DRM；
- 备份恢复校验 schema、路径穿越和 checksum；
- 外部数据全部视为不可信；React 文本渲染不使用未经净化的 `dangerouslySetInnerHTML`；
- 日志不得记录正文、笔记全文、文件 Blob 或敏感路径。

## 17. 实施顺序

### Phase 0：基线

- 增加 TypeScript、路由、测试框架和错误边界；
- 固化当前行为测试；
- 拆分 `main.jsx` 与 CSS tokens。

### Phase 1：数据底座

- IndexedDB schema、repositories、迁移、配额检查、完整/轻量备份与恢复；
- PWA 离线 shell、Service Worker 更新策略；
- 书籍 CRUD、去重、状态和真实首页。

### Phase 2：解析与阅读

- Worker 导入管线；
- EPUB/TXT/MD reader adapter；
- PDF reader adapter；
- Locator 和进度恢复。

### Phase 3：注释闭环

- 选区、划线、带位置笔记、草稿、回收站；
- 统一搜索和导出。

### Phase 4：收口

- 真实统计、性能、无障碍、跨浏览器、备份恢复和离线完整验证；
- 回顾、热力图、固定版式 EPUB 和全库正文索引属于 P1，不纳入 v1 阻断路径。

每个 Phase 使用质量规范定义的阶段门禁；未到实施阶段的 E2E 标记 not-applicable，而不是伪通过或永久跳过。无障碍、安全和数据可靠性从 Phase 0 起持续执行，不留到 Phase 4 补做。

## 18. 外部标准与实现参考

- EPUB Reading Systems 3.3：https://www.w3.org/TR/epub-rs-33/
- EPUB 3.3：https://www.w3.org/TR/epub-33/
- WCAG 2.2：https://www.w3.org/TR/WCAG22/
- IndexedDB API：https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- StorageManager：https://developer.mozilla.org/en-US/docs/Web/API/StorageManager
- PDF.js：https://mozilla.github.io/pdf.js/
- Web Workers：https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API

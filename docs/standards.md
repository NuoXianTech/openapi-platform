# 前端工程标准

本文档整合项目的 Nuxt 4 与 Nuxt UI 4 基线；通用 API 以官方文档为准。

## Nuxt 应用标准

本标准适用于 `app/`、`server/`、`shared/` 与 `scripts/` 下的 Nuxt 4 代码。目标是在保持开发速度的同时，让 SSR、类型、运行时配置和生产发布保持可预测。

### 目录边界

| 目录 | 职责 | 约束 |
| --- | --- | --- |
| `app/pages/` | 文件路由页面 | 页面保持薄，业务状态下沉到 composable 或组件 |
| `app/components/` | Vue 组件 | PascalCase 文件名，按 `admin/`、`user/`、`dashboard/`、`common/` 分域 |
| `app/composables/` | 前端组合式函数 | 使用 `use` 前缀，返回稳定的状态、动作和派生值 |
| `app/utils/` | 前端纯工具 | 使用具名导出，不读取运行时全局状态 |
| `server/api/` | 内部 API | 使用 Nuxt/Nitro event handler，私有接口走鉴权守卫 |
| `server/middleware/` | Gateway 与安全入口 | 只做通用路由、Header 和安全处理，不加入具体公共接口分支 |
| `server/services/` | 服务层 | 保持路由、Service 控制面、事务、权限、审计和跨表规则集中 |
| `server/db/schema/` | Drizzle Schema | 数据库结构的唯一源码，约束名等数据库细节也在这里定义 |
| `server/db/migrations/` | Drizzle 迁移产物 | 只能通过 `pnpm db:generate` 生成，禁止手工编辑 SQL、snapshot 和 journal |
| `shared/` | 前后端共享契约 | 类型、schema、静态配置必须可在客户端安全导入 |

不要把服务端密钥、数据库连接或 Node-only 依赖放入 `app/` 或客户端可导入的 `shared/` 文件。

### 应用主题

`app/constants/app-ui.ts` 集中主题选择和 Nuxt UI 适配。`app/app.vue` 根据路由元信息选择主题，
通过 `useHead` 在 HTML 根节点设置 `data-app-theme`；认证页显式声明 `appTheme: 'auth'`，
后台沿用 dashboard layout，其他页面使用 public。`app/assets/css/theme.css` 保存共享明暗色值及场景差异。

Nuxt UI 的必要样式标记放在 `app.config.ts` 的 `slots` 中，局部 `ui` 只提供布局等差异；
调用方不需要手工补齐浮层主题类名。`UTheme` 保持位于 `UApp` 外部，使程序化浮层与页面使用同一主题。
新增或调整主题时运行 `test/unit/app/app-theme.test.ts`，覆盖局部插槽覆盖与页面切换后的实际渲染。

### TypeScript 约定

- Vue 组件统一使用 `<script setup lang="ts">`。
- 结构化数据优先使用 `interface`，需要联合、映射或工具类型时再使用 `type`。
- 导出函数使用具名导出；纯函数使用 `function` 关键字。
- 避免 `enum`，使用对象映射和字面量联合。
- 布尔状态使用 `isLoading`、`hasError`、`canSubmit`、`shouldRefresh` 等可读命名。

```ts
export const apiVisibility = {
  public: 'public',
  private: 'private'
} as const

export interface ApiVisibilityOption {
  label: string
  value: keyof typeof apiVisibility
}

export function isPublicApi(value: string): value is ApiVisibilityOption['value'] {
  return value in apiVisibility
}
```

### 数据获取

| 场景 | 推荐方式 |
| --- | --- |
| SSR 首屏必须展示的数据 | `useFetch` 或 `useAsyncData` |
| 首屏可先渲染壳，再补充的数据 | `useLazyFetch` 或 `useLazyAsyncData` |
| 用户动作触发的请求 | `$fetch` |
| 私有分页列表 | 项目内 `usePrivatePagedList` |
| 可分享筛选状态 | 项目内 `useDashboardListState` 同步 URL |

数据获取必须有默认值或空态，避免模板在 `undefined` 上分支过深。客户端临时状态使用 `ref`，复杂表单或筛选组使用 `reactive`。

私有身份与用户数据是例外：项目 `useAuth()` 不把用户身份序列化进 Nuxt payload，私有页面响应也由 `routeRules` 设置 `Cache-Control: private, no-store`。不要为了首屏便利改用会把身份数据注入 SSR payload 的全局状态；应复用现有私有数据 composable，并保持未登录、加载和失效状态可预测。

### SSR 与水合

Nuxt 官方性能文档强调：水合不一致会影响用户体验和性能指标。项目中遵循：

- 不在 `setup` 顶层直接读取 `window`、`document`、`localStorage`、当前时间、随机数或浏览器尺寸。
- 浏览器专属逻辑放入 `onMounted`、`.client.vue`、`import.meta.client` 分支，或包在 `<ClientOnly>` 中并提供 fallback。
- SSR 首屏文本必须可预测；动态时间优先使用后端时间戳或在客户端挂载后更新。
- 第三方库如果有 DOM 副作用，使用动态导入并延后初始化。

```vue
<script setup lang="ts">
interface BrowserState {
  width: number
}

const browserState = reactive<BrowserState>({ width: 0 })

onMounted(() => {
  browserState.width = window.innerWidth
})
</script>
```

### 运行时配置

生产密钥必须通过 `runtimeConfig` 和 `NUXT_*` 环境变量在运行时注入。不要在 `nuxt.config.ts` 默认值里读取异名 `process.env`，否则会把构建机的值烤进产物。完整变量见 [运行时配置](./operations/runtime-config.md)。

### 性能标准

| 目标 | 做法 |
| --- | --- |
| 首屏轻 | 非关键图表、详情弹窗和大表单使用 `Lazy*` 组件或动态导入 |
| LCP 稳定 | 首屏主内容 SSR 输出，图片使用 WebP 或已压缩格式并声明 `width` / `height` |
| CLS 低 | 卡片、表格、统计块、图片和图表容器提供稳定尺寸 |
| INP 低 | 长列表分页，重计算使用 `computed`、`shallowRef` 或服务端聚合 |
| bundle 可控 | 保留 Nuxt/Vite 默认分包；只有 bundle 分析证明收益时，才用 `vite.build.rollupOptions.output.manualChunks` 固化第三方大依赖分块 |

VueUse 组合式函数优先选择 SSR 友好的用法；涉及浏览器 API 的组合式函数必须确认服务端 fallback 或放入客户端分支。

异步组件需要可见加载状态：

```vue
<template>
  <Suspense>
    <LazyAdminAnalyticsHourlyTrend />
    <template #fallback>
      <USkeleton class="h-64 w-full" />
    </template>
  </Suspense>
</template>
```

### 质量门禁

ESLint 保留 JS/TS/Vue 正确性检查，不强制缩进、逗号和每行属性数量等格式规则。`pnpm lint` 要求零 error、零 warning，开发环境和 CI 使用同一配置。

需要自动修复时运行 `pnpm lint --fix`。`pnpm test` 单次执行单元测试；开发时需要监听可运行 `pnpm exec vitest`。`pnpm test:integration` 只验证已有构建产物，应先显式运行 `pnpm build`；`pnpm test:api-service` 单独验证 Platform 与 Service 的真实调用链路。

测试通过调用方使用的完整入口验证行为；已有 HTTP 或配置流程覆盖时，合并重复的模拟调用链和内部辅助函数测试。
删除测试前确认独有断言的归属，保留故障、回滚、鉴权与并发场景。测试文件按所验证的契约组织，
无需与实现文件一一对应，也不为测试单独导出内部函数。

迁移历史校验使用真实内存 PGlite 和实际迁移 SQL，每个用例重置 Schema；磁盘持久化、重新打开与锁保护
由磁盘生命周期和发布产物测试验证。模拟网络的超时使用虚拟时钟，异步重叠用显式 Promise 完成点控制；
实际 HTTP、跨进程和磁盘锁场景保留真实传输及进程。不要通过关闭测试隔离或共享生产数据来缩短运行时间。

`server/**/*.ts` 和 `shared/**/*.ts` 额外启用基于类型信息的异步检查：禁止遗漏 Promise 或 Drizzle thenable 查询的处理、向同步回调传入异步函数，以及等待非 thenable 值。需要脱离当前请求执行的任务必须明确处理失败；`void` 只表示主动忽略返回值，不会捕获异常。

常规变更运行：

```bash
pnpm typecheck
pnpm lint
pnpm test
```

发布前额外运行：

```bash
pnpm build
pnpm test:integration
pnpm preview
```

涉及数据库、公开 API、鉴权、计费或后台统计时，至少补充单元测试或在 PR/变更说明里写清楚人工验证路径。

## Nuxt UI 标准

本标准适用于 OpenAPI 的公开页面、管理后台、用户后台和可复用组件。项目使用 Nuxt UI 4、Reka UI、Tailwind CSS 4、Tailwind Variants 与 `i-mdi-*` 图标体系。

### 组件选择

| 场景 | 优先组件 |
| --- | --- |
| 页面骨架 | `UApp`、`UMain`、项目内 dashboard layout |
| 导航 | `UNavigationMenu`、`UBreadcrumb`、`UTabs` |
| 表单 | `UForm`、`UFormField`、`UInput`、`UTextarea`、`USelect`、`USwitch` |
| 反馈 | `UAlert`、`UToast`、`UModal`、`USlideover`、`UEmpty`、`USkeleton` |
| 数据展示 | `UTable`、项目内 `DashboardDataTable`、`UBadge`、`UTooltip` |
| 覆盖层 | Nuxt UI `useOverlay()`，确认场景用项目内 `useConfirmDialog()` |
| 文档型页面 | `UPage`、`UPageHeader`、`UPageBody`、`UContentToc`、`UContentSurround` |

业务页不要重新实现 Nuxt UI 已经覆盖的可访问交互，例如菜单、弹窗、Tooltip、Tabs、Switch、Slider 和表单错误状态。

### 主题与样式

- 颜色优先使用 Nuxt UI 语义 token：`text-muted`、`text-toned`、`text-highlighted`、`bg-elevated`、`border-default`、`color="primary"`。
- 图标统一使用 `i-mdi-*`，按钮有明确动作时优先图标加 tooltip 或图标加短文本。
- 组件变体优先通过 `app.config.ts` 的 Nuxt UI 主题配置、组件 `ui` prop 或 Tailwind Variants 扩展。
- 页面级布局使用 Tailwind 工具类；复杂重复样式抽成组件或配置，不在多个页面复制。
- 移动端优先，先写默认布局，再用 `sm:`、`md:`、`lg:` 扩展。

### 后台页面

后台页面以安静、高密度、可扫描为原则。`app/pages/admin/**` 与
`app/pages/user/**` 共用 `dashboard` layout；导航、路径和二级分组统一维护在
`app/constants/dashboard-config.ts`。

页面分为两类：

| 类型 | 约定 |
| --- | --- |
| 分组父级页 | 使用 `DashboardSectionShell`，只组合标题、二级导航和 `<NuxtPage />` |
| 业务叶子页 | 使用 `UDashboardPanel`、`DashboardPageNavbar` 和 `dashboard-section-page` |

页面级头部动作交给 `DashboardHeaderActions`，不要在页面里复制刷新、通知、主题或账号菜单。
`DashboardPageNavbar` 已经组合侧边栏开关和头部动作，普通叶子页优先直接使用它。

可能增长的列表使用 `usePrivatePagedList` 和服务端 `limit/offset`；确定为小型列表时才使用
`useClientPagination`。只有排查型筛选或明确需要分享链接时，才使用
`useDashboardListState` 把状态写入 URL。弹窗开关、行选择、未提交输入和任何明文密钥都不得写入 URL。

表格统一使用 `DashboardDataTable`：

```vue
<DashboardDataTable
  v-model:page="page"
  v-model:page-size="pageSize"
  :data="items"
  :columns="columns"
  :loading="loading"
  :total="total"
  :page-size-options="PAGE_SIZE_OPTIONS"
  empty-title="暂无数据"
/>
```

- 行操作直接使用 `UDropdownMenu`；只有出现第三处完全相同的业务交互时才提取组件。
- 列显隐使用 `useDashboardColumnVisibility`，无需为它增加包装组件。
- 数字字段使用 `tabular-nums`；宽表格传 `:fixed="false"`。
- 空状态优先使用 `DashboardDataTable` 内置空态，非表格场景使用 `UEmpty`。

独立详情、重置等弹窗优先用 `useOverlay()` 创建 `Lazy*Modal`；和父页面表单状态紧密耦合时，
保留 `v-model:open` 更直接。删除、停用和批量操作统一使用 `useConfirmDialog()`。确认回调失败时必须
在展示 toast 后重新抛出错误，使弹窗保持打开供用户重试。Overlay 位于页面组件树之外，不得依赖页面级
`provide()`，所需数据通过 props 显式传入。

目录按领域组织：`components/dashboard` 保存后台骨架和通用展示，`components/admin`、
`components/user` 保存业务组件，`composables/dashboard` 保存列表和布局状态。新增抽象前先确认至少有三处
稳定重复；单个页面内部的创建/编辑模式优先用一个明确的状态机解决。

### 表单与验证

表单 schema 放在 `shared/schemas/**`，前端和服务端复用。组件只处理展示和交互，提交逻辑放在 composable 或页面函数中。

```vue
<script setup lang="ts">
interface ApiKeyFormState {
  name: string
  canReadStats: boolean
}

const formState = reactive<ApiKeyFormState>({
  name: '',
  canReadStats: false
})

function resetForm(): void {
  formState.name = ''
  formState.canReadStats = false
}
</script>

<template>
  <UForm :state="formState" class="space-y-4">
    <UFormField label="名称" name="name">
      <UInput v-model="formState.name" />
    </UFormField>
    <UFormField label="允许查看统计" name="canReadStats">
      <USwitch v-model="formState.canReadStats" />
    </UFormField>
    <UButton type="button" variant="ghost" @click="resetForm">
      重置
    </UButton>
  </UForm>
</template>
```

### 可访问性

- 图标按钮提供 `aria-label` 或 `UTooltip` 文本。
- 弹窗标题、描述和危险动作文案必须明确。
- 表单错误由 `UFormField` 承载，不在输入框旁散落自定义文本。
- 状态颜色必须配合文本或图标，不能只依赖颜色表达。
- 表格中的金额、次数、状态码使用 `tabular-nums` 提高可读性。

### 性能

- 图表、富文本编辑器、复杂筛选器和详情弹窗默认懒加载。
- `Lazy*` 组件放在 `Suspense` 中时提供 `USkeleton` 或 `UProgress` fallback。
- 列表超过单页展示能力时分页；可增长选择器优先 `UInputMenu`、`USelectMenu` 或服务端搜索。
- 图片资源使用 WebP 或已压缩 PNG，并声明尺寸，非首屏图片懒加载。
- 不在循环内创建大对象或匿名复杂配置；表格列配置放到 `computed`、常量或 composable。

### 禁止事项

- 不在业务页硬编码大面积颜色、阴影和圆角来覆盖主题。
- 不复制 Nuxt UI 组件内部可访问逻辑。
- 不把页面说明文字当作 UI 说明书塞进应用界面。
- 不为了局部样式创建全局 CSS，除非它属于主题或跨页面布局基础。


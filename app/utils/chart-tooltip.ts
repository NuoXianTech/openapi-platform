/**
 * unovis Crosshair tooltip 的统一卡片渲染器。
 *
 * unovis 的 tooltip 模板渲染成游离于 Vue 作用域外的 HTML 字符串，无法用 scoped class，
 * 故走内联样式 + 语义色变量（--ui-*，自动适配暗色）。全站图表 tooltip 的唯一来源，
 * 保证 stats 公开统计页与 admin 管理概览的悬浮卡片完全同款。
 *
 * 配合 main.css 全局 `--vis-tooltip-padding: 0`：内边距由本卡片自身提供。
 */

interface ChartTooltipRow {
  /** 行首小圆点颜色（语义色变量），单系列可省略 */
  color?: string
  label: string
  value: string
}

interface ChartTooltipFooterItem {
  label: string
  value: string
}

interface ChartTooltipOptions {
  title: string
  /** 副标题，常用于接口路径等次要信息（等宽字体展示） */
  subtitle?: string
  rows: ChartTooltipRow[]
  /** 底部分隔区，常用于合计 / 比率 */
  footer?: ChartTooltipFooterItem[]
}

/** tooltip 文本可能含接口名 / 路径等用户可控内容，渲染前必须转义 */
function escapeChartHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function renderRow(row: ChartTooltipRow): string {
  const dot = row.color
    ? `<span style="width:8px;height:8px;border-radius:999px;flex:0 0 auto;background:${row.color}"></span>`
    : ''
  return `
    <div style="display:flex;align-items:center;gap:8px;font-size:12px;line-height:16px">
      ${dot}
      <span style="color:var(--ui-text-muted)">${escapeChartHtml(row.label)}</span>
      <span style="margin-left:auto;font-weight:500;color:var(--ui-text-highlighted)">${escapeChartHtml(row.value)}</span>
    </div>`
}

function renderFooter(footer: ChartTooltipFooterItem[]): string {
  const items = footer
    .map(item => `<span>${escapeChartHtml(item.label)} <strong style="color:var(--ui-text-highlighted);font-weight:500">${escapeChartHtml(item.value)}</strong></span>`)
    .join('')
  return `
    <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--ui-border);display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;font-size:12px;line-height:16px;color:var(--ui-text-muted)">
      ${items}
    </div>`
}

export function renderChartTooltip(options: ChartTooltipOptions): string {
  const subtitle = options.subtitle
    ? `<div style="margin-top:4px;font:400 14px/20px var(--font-code);color:var(--ui-text-muted);overflow-wrap:anywhere">${escapeChartHtml(options.subtitle)}</div>`
    : ''
  const rows = options.rows.map(renderRow).join('')
  const footer = options.footer?.length ? renderFooter(options.footer) : ''
  return `
    <div style="min-width:168px;max-width:min(320px,calc(100vw - 32px));padding:12px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere">
      <div style="font-size:12px;line-height:16px;font-weight:600;color:var(--ui-text-highlighted)">${escapeChartHtml(options.title)}</div>
      ${subtitle}
      <div style="margin-top:8px;display:flex;flex-direction:column;gap:8px">${rows}</div>
      ${footer}
    </div>`
}

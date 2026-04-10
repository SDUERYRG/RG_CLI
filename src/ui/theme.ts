/**
 * 文件信息
 * 时间：2026-04-03 23:50:53 +08:00
 * 作用：集中定义当前 CLI 界面的颜色主题。
 * 说明：统一从这里取色，能降低样式散落在各组件中的维护成本。
 */
export const theme = {
  primary: "cyan",
  secondary: "gray",
  accent: "green",
  warning: "yellow",
  debug: "magenta",
  thinking: "blue",
} as const;

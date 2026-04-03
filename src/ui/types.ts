/**
 * 文件信息
 * 时间：2026-04-03 23:50:53 +08:00
 * 作用：定义 UI 层共享的数据类型。
 * 说明：把类型独立出来后，组件和工具函数可以复用同一套结构约束。
 */
export type MessageRole = "assistant" | "user";

export type ChatMessage = {
  id: number;
  role: MessageRole;
  content: string;
};

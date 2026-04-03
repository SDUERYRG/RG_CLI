/**
 * 文件信息
 * 时间：2026-04-03 23:50:53 +08:00
 * 作用：封装 Ink 渲染启动逻辑，负责真正挂载 CLI 界面。
 * 说明：将渲染行为单独抽离，便于入口层按需动态加载 UI。
 */
import React from "react";
import { render } from "ink";
import { ensureLeadingBlankLines } from "../shared/terminal.ts";
import { App } from "./App.tsx";

export async function runApp(): Promise<void> {
  ensureLeadingBlankLines();
  render(<App />);
}

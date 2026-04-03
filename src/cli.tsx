/**
 * 文件信息
 * 时间：2026-04-03 23:50:53 +08:00
 * 作用：保留一个轻量开发入口，用于在开发场景下直接启动 CLI。
 * 说明：逻辑尽量少，实际启动流程统一交给 src/index.ts 管理。
 */
import { startCli } from "./index.ts";

if (import.meta.main) {
  await startCli();
}

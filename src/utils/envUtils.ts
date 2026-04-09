/**
 * 文件信息
 * 时间：2026-04-09 00:00:00 +08:00
 * 作用：提供配置目录与环境变量读取工具。
 * 说明：当前主要服务于 userSettings 读取链，后续可继续扩展。
 */
import { homedir } from "node:os";
import { join } from "node:path";

export function getRgCliConfigHomeDir(): string {
  return (process.env.RG_CLI_CONFIG_DIR ?? join(homedir(), ".rg-cli"))
    .normalize("NFC");
}

export function getUserSettingsFilePath(): string {
  return join(getRgCliConfigHomeDir(), "settings.json");
}

export function isEnvTruthy(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase().trim());
}

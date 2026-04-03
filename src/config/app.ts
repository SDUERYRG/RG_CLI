/**
 * 文件信息
 * 时间：2026-04-03 23:50:53 +08:00
 * 作用：统一管理应用基础信息，如名称、版本和描述。
 * 说明：版本号直接读取 package.json，避免出现多处手动维护的不一致。
 */
import packageJson from "../../package.json";

export const APP_NAME = "RG CLI";
export const APP_PACKAGE_NAME = packageJson.name;
export const APP_VERSION = packageJson.version;
export const APP_DESCRIPTION = "一个基于 Bun 和 Ink 构建的简单终端 UI";

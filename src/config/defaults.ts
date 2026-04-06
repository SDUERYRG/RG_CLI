/**
 * 文件信息
 * 时间：2026-04-06 00:00:00 +08:00
 * 作用：定义 CLI 启动阶段使用的默认配置。
 * 说明：当前只保留板块一需要的最小字段，后续板块二再扩展。
 */
export type AppConfig = {
  cwd: string;
  model: string;
  debug: boolean;
  color: boolean;
};

export const defaultConfig: AppConfig = {
  cwd: process.cwd(),
  model: "default",
  debug: false,
  color: true,
};

/**
 * 文件信息
 * 时间：2026-04-06 00:35:00 +08:00
 * 作用：统一管理当前 CLI 会话使用的工作目录。
 * 说明：该模块负责校验路径、维护内部 cwd 状态，并在需要时同步到 process.chdir。
 */
import { realpathSync, statSync } from "fs";
import { isAbsolute, resolve } from "path";

let currentCwd = process.cwd();

function resolveCwdPath(path: string): string {
  const resolvedPath = isAbsolute(path) ? path : resolve(currentCwd, path);
  let physicalPath: string;

  try {
    physicalPath = realpathSync(resolvedPath);
  } catch {
    throw new Error(`Path "${resolvedPath}" does not exist.`);
  }

  const stats = statSync(physicalPath);

  if (!stats.isDirectory()) {
    throw new Error(`Path "${physicalPath}" is not a directory.`);
  }

  return physicalPath;
}

export function getCwd(): string {
  return currentCwd;
}

export function setCwd(path: string): string {
  const nextCwd = resolveCwdPath(path);
  currentCwd = nextCwd;
  process.chdir(nextCwd);
  return nextCwd;
}

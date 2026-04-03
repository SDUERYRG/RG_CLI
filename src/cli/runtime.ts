/**
 * 文件信息
 * 时间：2026-04-03 23:50:53 +08:00
 * 作用：封装 CLI 运行时环境判断逻辑。
 * 说明：目前只判断是否为交互终端，后续可继续扩展为更多环境探测能力。
 */
export function isInteractiveSession(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

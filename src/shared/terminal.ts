/**
 * 文件信息
 * 时间：2026-04-03 23:58:00 +08:00
 * 作用：统一管理终端输出行为，例如启动前的留白和文本块打印。
 * 说明：所有终端输出都尽量经过这里，保证展示规则一致且便于后续扩展。
 */

const LEADING_BLANK_LINES = 2;

let hasPrintedLeadingBlankLines = false;

export function ensureLeadingBlankLines(
  stream: NodeJS.WriteStream = process.stdout,
): void {
  if (hasPrintedLeadingBlankLines) {
    return;
  }

  stream.write("\n".repeat(LEADING_BLANK_LINES));
  hasPrintedLeadingBlankLines = true;
}

export function writeTerminalBlock(
  lines: string[],
  stream: NodeJS.WriteStream = process.stdout,
): void {
  ensureLeadingBlankLines(stream);
  stream.write(`${lines.join("\n")}\n`);
}

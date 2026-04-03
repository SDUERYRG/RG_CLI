/**
 * 文件信息
 * 时间：2026-04-03 23:50:53 +08:00
 * 作用：渲染底部快捷键提示区域。
 * 说明：独立组件便于后续增加状态栏、模式提示或快捷帮助。
 */
import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.ts";

export function Footer() {
  return (
    <Box
      marginTop={1}
      borderStyle="round"
      borderColor={theme.secondary}
      paddingX={1}
    >
      <Text color={theme.secondary}>
        按 <Text color={theme.primary} bold>Q</Text> 退出，或按{" "}
        <Text color={theme.primary} bold>Ctrl+C</Text> 强制退出
      </Text>
    </Box>
  );
}

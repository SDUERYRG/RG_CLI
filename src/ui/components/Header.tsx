/**
 * 文件信息
 * 时间：2026-04-03 23:50:53 +08:00
 * 作用：渲染 CLI 顶部标题区域，包括 ASCII Logo 和产品名称。
 * 说明：头部展示逻辑单独维护，后续扩展副标题或状态信息会更清晰。
 */
import React from "react";
import { Box, Text } from "ink";
import { APP_NAME } from "../../config/app.ts";
import { APP_LOGO } from "../logo.ts";
import { theme } from "../theme.ts";

export function Header() {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={theme.accent}>{APP_LOGO}</Text>
      <Box marginTop={1}>
        <Text color={theme.primary} bold>
          {APP_NAME}
        </Text>
        <Text color={theme.secondary}> | Intelligent Terminal</Text>
      </Box>
    </Box>
  );
}

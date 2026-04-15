import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.ts";

type FooterProps = {
  isLoading?: boolean;
};

const LOADING_BADGE_FRAMES = ["[AI]", "[AI]", "[AI]", "[AI]"] as const;
const LOADING_SPINNER_FRAMES = ["-", "\\", "|", "/"] as const;
const LOADING_DOT_FRAMES = ["", ".", "..", "..."] as const;
const LOADING_FRAME_INTERVAL_MS = 120;

export function getLoadingIndicatorFrame(frame: number) {
  const normalizedFrame = Math.max(0, frame);

  return {
    badge: LOADING_BADGE_FRAMES[normalizedFrame % LOADING_BADGE_FRAMES.length]!,
    spinner: LOADING_SPINNER_FRAMES[normalizedFrame % LOADING_SPINNER_FRAMES.length]!,
    dots: LOADING_DOT_FRAMES[normalizedFrame % LOADING_DOT_FRAMES.length]!,
  };
}

export function Footer({ isLoading = false }: FooterProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isLoading) {
      setFrame(0);
      return;
    }

    const timer = setInterval(() => {
      setFrame((currentFrame) => currentFrame + 1);
    }, LOADING_FRAME_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [isLoading]);

  if (!isLoading) {
    return null;
  }

  const indicator = getLoadingIndicatorFrame(frame);

  return (
    <Box
      marginTop={1}
      borderStyle="round"
      borderColor={theme.thinking}
      paddingX={1}
      flexDirection="column"
    >
      <Box>
        <Text color={theme.accent} bold>
          {indicator.badge}
        </Text>
        <Text> </Text>
        <Text color={theme.thinking} bold>
          {indicator.spinner} 思考中{indicator.dots}
        </Text>
      </Box>
      <Text dimColor>正在分析上下文并生成回答</Text>
    </Box>
  );
}

/**
 * 文件信息
 * 时间：2026-04-06 00:00:00 +08:00
 * 作用：处理交互会话中的 slash 命令。
 * 说明：命令层只返回结果，不直接操作 UI 状态，避免 session 层依赖界面层。
 */
import { createMessage } from "./messages.ts";
import {
  listPersistedSessions,
  resolveSession,
  type PersistedChatSession,
} from "./storage.ts";
import type { ChatMessage } from "./types.ts";
import { getToolSummaries } from "../tools/registry.ts";

export type SlashCommandResult =
  | { type: "not-a-command" }
  | { type: "append-messages"; messages: ChatMessage[] }
  | { type: "replace-messages"; messages: ChatMessage[] }
  | { type: "start-new-session" }
  | { type: "load-session"; session: PersistedChatSession }
  | { type: "rename-session"; title: string; messages: ChatMessage[] }
  | { type: "exit" };

export type SlashCommandContext = {
  cwd: string;
  activeSessionId: string;
};

function createLocalAssistantMessage(content: string): ChatMessage {
  return createMessage("assistant", content, { includeInContext: false });
}

function formatSessionSummaryLine(
  sessionId: string,
  activeSessionId: string,
  updatedAt: string,
  title: string,
  summary: string,
): string {
  const activeMark = sessionId === activeSessionId ? "*" : " ";
  const shortId = sessionId.slice(0, 8);
  const updatedLabel = new Date(updatedAt).toLocaleString("zh-CN", {
    hour12: false,
  });
  return [
    `${activeMark} ${shortId}  ${updatedLabel}  ${title}`,
    `  摘要: ${summary}`,
  ].join("\n");
}

export function executeSlashCommand(
  input: string,
  context: SlashCommandContext,
): SlashCommandResult {
  const trimmed = input.trim();

  if (!trimmed.startsWith("/")) {
    return { type: "not-a-command" };
  }

  const [command, ...restArgs] = trimmed.split(/\s+/);

  switch (command) {
    case "/help":
      return {
        type: "append-messages",
        messages: [
          createLocalAssistantMessage(
            "可用命令：/help、/clear、/new、/sessions、/resume <id>、/rename <title>、/tools、/exit",
          ),
        ],
      };

    case "/clear":
    case "/new":
      return {
        type: "start-new-session",
      };

    case "/sessions": {
      const sessions = listPersistedSessions(context.cwd, 10);

      if (sessions.length === 0) {
        return {
          type: "append-messages",
          messages: [
            createLocalAssistantMessage("当前项目还没有已保存会话。"),
          ],
        };
      }

      const lines = [
        "最近会话（* 表示当前会话）：",
        ...sessions.map((session) =>
          formatSessionSummaryLine(
            session.id,
            context.activeSessionId,
            session.updatedAt,
            session.title,
            session.summary,
          )
        ),
      ];

      return {
        type: "append-messages",
        messages: [
          createLocalAssistantMessage(lines.join("\n")),
        ],
      };
    }

    case "/resume": {
      const resumeTarget = restArgs.join(" ").trim();

      if (!resumeTarget) {
        return {
          type: "append-messages",
          messages: [
            createLocalAssistantMessage("用法：/resume <session-id 前缀>"),
          ],
        };
      }

      const result = resolveSession(context.cwd, resumeTarget);

      if (result.status === "not-found") {
        return {
          type: "append-messages",
          messages: [
            createLocalAssistantMessage(`未找到会话：${resumeTarget}`),
          ],
        };
      }

      if (result.status === "ambiguous") {
        const lines = [
          `匹配到多个会话，请输入更长的 id 前缀：${resumeTarget}`,
          ...result.matches.map((session) =>
            formatSessionSummaryLine(
              session.id,
              context.activeSessionId,
              session.updatedAt,
              session.title,
              session.summary,
            )
          ),
        ];

        return {
          type: "append-messages",
          messages: [createLocalAssistantMessage(lines.join("\n"))],
        };
      }

      return {
        type: "load-session",
        session: result.session,
      };
    }

    case "/rename": {
      const nextTitle = restArgs.join(" ").trim();

      if (!nextTitle) {
        return {
          type: "append-messages",
          messages: [
            createLocalAssistantMessage("用法：/rename <新的会话标题>"),
          ],
        };
      }

      return {
        type: "rename-session",
        title: nextTitle,
        messages: [
          createLocalAssistantMessage(`已将当前会话重命名为：${nextTitle}`),
        ],
      };
    }

    case "/tools": {
      const lines = [
        "当前已注册工具：",
        ...getToolSummaries().map((tool) => `- ${tool.name}: ${tool.description}`),
      ];

      return {
        type: "append-messages",
        messages: [createLocalAssistantMessage(lines.join("\n"))],
      };
    }

    case "/exit":
      return {
        type: "exit",
      };

    default:
      return {
        type: "append-messages",
        messages: [
          createLocalAssistantMessage(`未知命令：${command}`),
        ],
      };
  }
}

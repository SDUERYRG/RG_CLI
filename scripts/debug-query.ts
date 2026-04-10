import { loadConfig } from "../src/config/loadConfig.ts";
import {
  QueryEngine,
  createChatSession,
  getWelcomeMessage,
} from "../src/session/index.ts";

const DEFAULT_PROMPT =
  "请先列出判断标准，再比较 Bun 和 Node 在 CLI 项目里的优缺点，最后给出明确结论";

function getPromptFromArgv(argv: string[]): string {
  const prompt = argv.join(" ").trim();
  return prompt || DEFAULT_PROMPT;
}

const prompt = getPromptFromArgv(process.argv.slice(2));
const config = loadConfig();
config.debug = true;

const engine = new QueryEngine({ config });
const session = createChatSession(process.cwd(), [getWelcomeMessage()]);

const stepSummaries: Array<{
  persist: boolean;
  lastKind: string;
  lastRole: string | null;
  lastPreview: string | null;
  liveThinkingLength: number;
}> = [];
let finalSession = session;
let lastLiveThinking = "";

for await (const step of engine.submitMessage(session, prompt)) {
  const messages = step.session.messages;
  const lastMessage = messages.at(-1);

  if (step.liveThinkingText) {
    lastLiveThinking = step.liveThinkingText;
  }

  stepSummaries.push({
    persist: step.persist,
    lastKind: lastMessage?.kind ?? "regular",
    lastRole: lastMessage?.role ?? null,
    lastPreview: typeof lastMessage?.content === "string"
      ? lastMessage.content.slice(0, 160)
      : null,
    liveThinkingLength: step.liveThinkingText?.length ?? 0,
  });
  finalSession = step.session;
}

const debugEntries = finalSession.messages
  .filter((message) => message.kind === "debug")
  .map((message) => message.content);
const toolCalls = finalSession.messages
  .filter((message) => message.kind === "tool_call")
  .map((message) => message.content);
const toolResults = finalSession.messages
  .filter((message) => message.kind === "tool_result")
  .map((message) => message.content);
const thinkingMessages = finalSession.messages
  .filter((message) => message.kind === "thinking")
  .map((message) => message.content);
const assistantRegularMessages = finalSession.messages
  .filter((message) =>
    (message.kind ?? "regular") === "regular" && message.role === "assistant"
  )
  .map((message) => message.content);

const uniqueAssistantTurnMeta = [
  ...new Set(debugEntries.filter((entry) => entry.includes("query.assistantTurnMeta"))),
];
const queryResult = debugEntries.find((entry) => entry.includes("queryResult")) ?? null;

const output = {
  prompt,
  config: {
    provider: config.llmProvider,
    wireApi: config.llmWireApi,
    model: config.model,
    reasoningEffort: config.llmReasoningEffort,
    reasoningSummary: config.llmReasoningSummary,
  },
  totalSteps: stepSummaries.length,
  nonPersistSteps: stepSummaries.filter((step) => !step.persist).length,
  toolCallCount: toolCalls.length,
  toolResultCount: toolResults.length,
  liveThinkingObserved: lastLiveThinking.length > 0,
  maxLiveThinkingLength: Math.max(
    0,
    ...stepSummaries.map((step) => step.liveThinkingLength),
  ),
  uniqueAssistantTurnMeta,
  queryResult,
  finalThinkingCount: thinkingMessages.length,
  finalThinkingMessages: thinkingMessages,
  finalAssistantRegularMessages: assistantRegularMessages,
  finalToolCalls: toolCalls,
  finalToolResults: toolResults,
};

console.log(JSON.stringify(output, null, 2));

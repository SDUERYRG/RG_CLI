/**
 * 文件信息
 * 时间：2026-04-09 00:00:00 +08:00
 * 作用：定义大模型调用层的共享类型。
 * 说明：先抽出统一接口，后续扩展更多 provider 时可以保持 UI 层稳定。
 */

export type GenerateTextParams = {
  model: string;
  prompt: string;
};

export type GenerateTextResult = {
  text: string;
  raw?: unknown;
};

export interface LlmClient {
  generateText(params: GenerateTextParams): Promise<GenerateTextResult>;
}

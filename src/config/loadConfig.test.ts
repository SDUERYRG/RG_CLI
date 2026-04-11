import { afterEach, expect, test } from "bun:test";
import { loadConfigResult, parseConfigOverrides } from "./loadConfig.ts";

const originalProvider = process.env.RG_CLI_PROVIDER;

afterEach(() => {
  if (originalProvider === undefined) {
    delete process.env.RG_CLI_PROVIDER;
    return;
  }

  process.env.RG_CLI_PROVIDER = originalProvider;
});

test("parseConfigOverrides rejects another flag as a flag value", () => {
  expect(() => parseConfigOverrides(["--cwd", "--debug"])).toThrow(
    "Flag --cwd requires a value.",
  );
});

test("parseConfigOverrides rejects invalid provider values", () => {
  expect(() => parseConfigOverrides(["--provider", "not-a-provider"])).toThrow(
    "Flag --provider must be one of: anthropic-compatible, openai-compatible. Received: not-a-provider",
  );
});

test("loadConfigResult rejects invalid provider values from environment variables", () => {
  process.env.RG_CLI_PROVIDER = "not-a-provider";

  expect(() => loadConfigResult([])).toThrow(
    "Environment variable RG_CLI_PROVIDER must be one of: anthropic-compatible, openai-compatible. Received: not-a-provider",
  );
});

import { expect, test } from "bun:test";
import { builtinTools } from "./builtinTools.ts";

test("get_current_time returns a local timestamp with an explicit offset", async () => {
  const tool = builtinTools.find((entry) => entry.name === "get_current_time");

  expect(tool).toBeDefined();

  const result = await tool!.execute({}, { cwd: process.cwd() });
  expect(result.isError).toBeUndefined();
  expect(result.content).toMatch(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/,
  );
});

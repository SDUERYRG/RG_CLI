import { afterEach, expect, test } from "bun:test";
import { loadConfigResult } from "../config/loadConfig.ts";
import { runTopLevelCommand } from "./commands.ts";

const originalStdoutWrite = process.stdout.write.bind(process.stdout);

afterEach(() => {
  process.stdout.write = originalStdoutWrite;
});

test("runTopLevelCommand still recognizes commands when options come first", async () => {
  process.stdout.write = (() => true) as typeof process.stdout.write;

  const argv = ["--debug", "config"];
  await expect(runTopLevelCommand(argv, loadConfigResult(argv))).resolves.toBe(
    true,
  );
});

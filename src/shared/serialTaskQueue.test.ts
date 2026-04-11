import { expect, test } from "bun:test";
import { createSerialTaskQueue } from "./serialTaskQueue.ts";

test("serial task queue runs tasks in enqueue order", async () => {
  const queue = createSerialTaskQueue();
  const events: string[] = [];

  const firstTask = queue.enqueue(async () => {
    events.push("start:first");
    await Bun.sleep(20);
    events.push("end:first");
    return "first";
  });

  const secondTask = queue.enqueue(async () => {
    events.push("start:second");
    events.push("end:second");
    return "second";
  });

  await expect(Promise.all([firstTask, secondTask])).resolves.toEqual([
    "first",
    "second",
  ]);
  expect(events).toEqual([
    "start:first",
    "end:first",
    "start:second",
    "end:second",
  ]);
});

test("serial task queue keeps running after a rejected task", async () => {
  const queue = createSerialTaskQueue();
  const events: string[] = [];

  await expect(queue.enqueue(async () => {
    events.push("start:failed");
    throw new Error("boom");
  })).rejects.toThrow("boom");

  await expect(queue.enqueue(async () => {
    events.push("start:recovery");
    events.push("end:recovery");
    return "ok";
  })).resolves.toBe("ok");

  expect(events).toEqual([
    "start:failed",
    "start:recovery",
    "end:recovery",
  ]);
});

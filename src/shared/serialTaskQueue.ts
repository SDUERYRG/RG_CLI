export type SerialTaskQueue = {
  enqueue<T>(task: () => Promise<T> | T): Promise<T>;
  whenIdle(): Promise<void>;
};

export function createSerialTaskQueue(): SerialTaskQueue {
  let tail = Promise.resolve();

  return {
    enqueue<T>(task: () => Promise<T> | T): Promise<T> {
      const result = tail.catch(() => undefined).then(task);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
    whenIdle(): Promise<void> {
      return tail;
    },
  };
}

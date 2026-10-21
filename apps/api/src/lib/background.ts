const pending = new Set<Promise<unknown>>();

export function runInBackground(task: Promise<unknown>) {
  pending.add(task);
  void task.then(() => pending.delete(task), () => pending.delete(task));
}

export async function drainBackground() {
  while (pending.size) await Promise.all(pending);
}

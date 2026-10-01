/** Supervise workers independently of the renderer library, including runtime failures. */
export function superviseWorker(worker: Worker, fail: () => void, deadline = 15_000): Worker {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const post = worker.postMessage, terminate = worker.terminate;
  worker.postMessage = ((message: { id?: string }, options?: Transferable[] | StructuredSerializeOptions) => {
    if (message.id) { clearTimeout(timers.get(message.id)); timers.set(message.id, setTimeout(fail, deadline)); }
    try { Reflect.apply(post, worker, options === undefined ? [message] : [message, options]); } catch (error) { fail(); throw error; }
  }) as Worker["postMessage"];
  worker.addEventListener("message", event => { const id = (event as MessageEvent<{ id?: string }>).data.id; if (id) { clearTimeout(timers.get(id)); timers.delete(id); } });
  worker.addEventListener("error", fail); worker.addEventListener("messageerror", fail);
  worker.terminate = () => { for (const timer of timers.values()) clearTimeout(timer); timers.clear(); worker.removeEventListener("error", fail); worker.removeEventListener("messageerror", fail); terminate.call(worker); };
  return worker;
}

// Semáforo simple: como máximo `max` tareas pesadas a la vez (Ghostscript usa mucha CPU).
export function createLimit(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= max) return;
    const start = queue.shift();
    if (start) start();
  };
  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        active++;
        fn().then(resolve, reject).finally(() => {
          active--;
          next();
        });
      });
      next();
    });
  };
}

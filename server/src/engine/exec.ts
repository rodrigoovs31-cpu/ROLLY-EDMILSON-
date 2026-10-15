import { spawn } from 'node:child_process';

export interface ExecResult {
  code: number;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

// Ejecuta un programa (qpdf, gs) sin shell, con tiempo máximo y salida acotada.
// `input` se envía por stdin: así las contraseñas nunca aparecen en la lista de procesos.
export function run(bin: string, args: string[], opts: { timeoutMs: number; input?: string }): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8' },
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const cap = (acc: string, chunk: Buffer) => (acc.length < 8192 ? acc + chunk.toString('utf8') : acc);
    child.stdout.on('data', (c: Buffer) => { stdout = cap(stdout, c); });
    child.stderr.on('data', (c: Buffer) => { stderr = cap(stderr, c); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code ?? (signal ? 137 : 1), stdout, stderr, timedOut });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(opts.input ?? '');
  });
}

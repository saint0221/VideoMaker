import { spawn } from 'child_process';

const CLAUDE_BIN = process.env.CLAUDE_BIN || '/Users/hongss/.local/bin/claude';
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export async function runClaude(
  prompt: string,
  options?: { timeoutMs?: number }
): Promise<string> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS } = options ?? {};

  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;

    const child = spawn(CLAUDE_BIN, ['--print', '--dangerously-skip-permissions'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill('SIGTERM');
        reject(new Error(`claude 실행 시간 초과 (${timeoutMs / 1000}초)`));
      }
    }, timeoutMs);

    child.stdin.write(prompt, 'utf8');
    child.stdin.end();

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (resolved) return;
      resolved = true;
      if (code !== 0) {
        reject(new Error(`claude 실패 (exit ${code}): ${stderr.slice(0, 500)}`));
      } else {
        resolve(stdout.trim());
      }
    });

    child.on('error', (err: Error) => {
      clearTimeout(timer);
      if (resolved) return;
      resolved = true;
      reject(new Error(`claude 실행 오류: ${err.message}`));
    });
  });
}

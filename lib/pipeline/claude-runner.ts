import { spawn } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';

const CLAUDE_BIN = process.env.CLAUDE_BIN || '/Users/hongss/.local/bin/claude';
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export const MODEL = {
  OPUS: 'claude-opus-4-7',
  SONNET: 'claude-sonnet-4-6',
  HAIKU: 'claude-haiku-4-5-20251001',
} as const;

async function runClaudeSDK(prompt: string, timeoutMs: number, model: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.');

  const client = new Anthropic({ apiKey });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const message = await client.messages.create(
      {
        model,
        max_tokens: 16000,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal }
    );

    const block = message.content[0];
    if (block.type !== 'text') throw new Error('예상치 못한 응답 타입');
    return block.text.trim();
  } finally {
    clearTimeout(timer);
  }
}

async function runCLI(prompt: string, timeoutMs: number, model: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;

    const child = spawn(CLAUDE_BIN, ['--print', '--dangerously-skip-permissions', '--model', model], {
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

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });

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

export async function runClaude(
  prompt: string,
  options?: { timeoutMs?: number; model?: string }
): Promise<string> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, model = MODEL.OPUS } = options ?? {};

  if (process.env.ANTHROPIC_API_KEY) {
    return runClaudeSDK(prompt, timeoutMs, model);
  }
  return runCLI(prompt, timeoutMs, model);
}

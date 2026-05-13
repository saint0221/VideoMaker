import { NextResponse } from 'next/server';
import { execSync } from 'child_process';

export async function POST() {
  try {
    const result = execSync(
      `osascript -e 'POSIX path of (choose folder with prompt "CapCut 프로젝트 저장 경로를 선택하세요")'`,
      { timeout: 60000 }
    )
      .toString()
      .trim()
      .replace(/\/$/, '');

    return NextResponse.json({ path: result });
  } catch (err) {
    // 사용자가 취소하면 osascript가 exit 1로 종료됨
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('User canceled')) {
      return NextResponse.json({ path: null });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

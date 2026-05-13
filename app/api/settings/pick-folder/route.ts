import { NextResponse } from 'next/server';
import { execSync } from 'child_process';

function pickFolderMac(): string | null {
  try {
    return execSync(
      `osascript -e 'POSIX path of (choose folder with prompt "CapCut 프로젝트 저장 경로를 선택하세요")'`,
      { timeout: 60000 }
    )
      .toString()
      .trim()
      .replace(/\/$/, '');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('User canceled') || msg.includes('(-128)')) return null;
    throw err;
  }
}

function pickFolderWindows(): string | null {
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'CapCut 프로젝트 저장 경로를 선택하세요'
$d.UseDescriptionForTitle = $true
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.SelectedPath }
`.trim();
  try {
    const result = execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, {
      timeout: 60000,
    })
      .toString()
      .trim();
    return result || null;
  } catch {
    return null;
  }
}

export async function POST() {
  try {
    let picked: string | null = null;

    if (process.platform === 'darwin') {
      picked = pickFolderMac();
    } else if (process.platform === 'win32') {
      picked = pickFolderWindows();
    } else {
      return NextResponse.json({ error: '이 플랫폼에서는 폴더 선택 다이얼로그를 지원하지 않습니다.' }, { status: 400 });
    }

    return NextResponse.json({ path: picked });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

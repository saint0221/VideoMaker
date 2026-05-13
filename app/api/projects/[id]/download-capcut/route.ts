import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { loadProject, projectDir } from '@/lib/project';

const PLACEHOLDER = '__CAPCUT_ROOT__';

function copyDirRecursive(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function replaceInJsonFiles(dir: string, oldStr: string) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      replaceInJsonFiles(fullPath, oldStr);
    } else if (entry.name.endsWith('.json')) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      if (content.includes(oldStr)) {
        fs.writeFileSync(fullPath, content.split(oldStr).join(PLACEHOLDER));
      }
    }
  }
}

const SETUP_SCRIPT = [
  '#!/bin/bash',
  'DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
  `find "$DIR" -name "*.json" | while read f; do`,
  `  sed -i '' "s|${PLACEHOLDER}|$DIR|g" "$f"`,
  'done',
  'echo "✅ 완료. 이 폴더를 CapCut에 임포트하세요."',
  'open "$DIR"',
  '',
].join('\n');

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const project = loadProject(id);
  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  const srcDir = project.capcutPath ?? path.join(projectDir(id), 'capcut-project');
  if (!fs.existsSync(srcDir)) {
    return NextResponse.json({ error: 'CapCut 프로젝트가 아직 생성되지 않았습니다.' }, { status: 400 });
  }

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'capcut-dl-'));
  const folderName = id.slice(0, 40);
  const tmpDir = path.join(tmpBase, folderName);

  try {
    copyDirRecursive(srcDir, tmpDir);
    replaceInJsonFiles(tmpDir, srcDir);

    fs.writeFileSync(path.join(tmpDir, 'setup.command'), SETUP_SCRIPT, { mode: 0o755 });

    const zipPath = path.join(tmpBase, `${folderName}.zip`);
    execSync(`/usr/bin/zip -r "${zipPath}" "${folderName}"`, { cwd: tmpBase, stdio: 'pipe' });

    const zipBuffer = fs.readFileSync(zipPath);

    const encodedName = encodeURIComponent(`${folderName}.zip`);
    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="capcut-project.zip"; filename*=UTF-8''${encodedName}`,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
}

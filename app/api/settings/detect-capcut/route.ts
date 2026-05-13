import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

function candidates(): string[] {
  const home = os.homedir();

  if (process.platform === 'darwin') {
    return [
      path.join(home, 'Movies', 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft'),
      path.join(home, 'Library', 'Application Support', 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft'),
    ];
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    return [
      path.join(localAppData, 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft'),
      path.join(home, 'Documents', 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft'),
      path.join(home, 'AppData', 'Local', 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft'),
    ];
  }

  return [];
}

export async function GET() {
  const found = candidates().find(p => fs.existsSync(p));
  return NextResponse.json({ path: found ?? null, candidates: candidates() });
}

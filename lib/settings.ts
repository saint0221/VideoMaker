import fs from 'fs';
import path from 'path';
import os from 'os';

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'settings.json');

export interface Settings {
  capcutRoot: string;
}

function defaults(): Settings {
  const home = os.homedir();
  const capcutRoot =
    process.platform === 'win32'
      ? path.join(home, 'AppData', 'Local', 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft')
      : path.join(home, 'Movies', 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft');
  return { capcutRoot };
}

export function loadSettings(): Settings {
  if (!fs.existsSync(SETTINGS_PATH)) return defaults();
  try {
    return { ...defaults(), ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) };
  } catch {
    return defaults();
  }
}

export function saveSettings(settings: Settings): void {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

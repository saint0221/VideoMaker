import fs from 'fs';
import path from 'path';
import { runTTS } from './lib/pipeline/tts';

for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

async function main() {
  const projectId = '15초-향수-광고-제작,-20대-여성-타겟,-모델-이미지는-에스파의-카리나-같은-긴-생머리에-몸에-붙는-검은-색-드레스-착용';
  const scriptPath = `data/projects/${projectId}/script-final.md`;
  const scriptMd = fs.readFileSync(scriptPath, 'utf-8');
  console.log(`📄 스크립트 로드: ${scriptPath}`);
  await runTTS(projectId, scriptMd);
  console.log('✅ TTS 완료');
}

main().catch((e) => { console.error('❌', e); process.exit(1); });

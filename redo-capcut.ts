import fs from 'fs';
import path from 'path';
import { runCapcutEditor } from './lib/pipeline/capcut-editor';

for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

async function main() {
  const projectId = '15초-향수-광고-제작,-20대-여성-타겟,-모델-이미지는-에스파의-카리나-같은-긴-생머리에-몸에-붙는-검은-색-드레스-착용';
  console.log('🎬 캡컷 프로젝트 재생성 중...');
  await runCapcutEditor(projectId);
  console.log('✅ 완료');
}

main().catch((e) => { console.error('❌', e); process.exit(1); });

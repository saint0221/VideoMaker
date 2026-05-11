import fs from 'fs';
import path from 'path';
import { runImageGenerator } from './lib/pipeline/image-generator';
import { runVideoGenerator } from './lib/pipeline/video-generator';
import { runCapcutEditor } from './lib/pipeline/capcut-editor';

// Load .env.local
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

async function main() {
  const projectId = '15초-향수-광고-제작,-20대-여성-타겟,-모델-이미지는-에스파의-카리나-같은-긴-생머리에-몸에-붙는-검은-색-드레스-착용';
  const pDir = `data/projects/${projectId}`;

  // Delete old images & videos
  for (const f of fs.readdirSync(`${pDir}/images`)) {
    fs.unlinkSync(path.join(`${pDir}/images`, f));
  }
  for (const f of fs.readdirSync(`${pDir}/videos`)) {
    fs.unlinkSync(path.join(`${pDir}/videos`, f));
  }
  console.log('🗑️  기존 이미지/비디오 삭제 완료');

  const promptsMd = fs.readFileSync(`${pDir}/image-prompts.md`, 'utf-8');

  console.log('\n▶ [9단계] 이미지 생성 중...');
  await runImageGenerator(projectId, promptsMd);

  console.log('\n▶ [10단계] 영상 생성 중...');
  await runVideoGenerator(projectId);

  console.log('\n▶ [11단계] CapCut 프로젝트 생성 중...');
  await runCapcutEditor(projectId);

  console.log('\n✅ 전체 완료');
}

main().catch((e) => { console.error('❌', e); process.exit(1); });

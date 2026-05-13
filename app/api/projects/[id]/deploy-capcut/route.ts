import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { loadProject, projectDir } from '@/lib/project';
import { loadSettings } from '@/lib/settings';

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

function replacePathsInDir(dir: string, oldStr: string, newStr: string) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      replacePathsInDir(fullPath, oldStr, newStr);
    } else if (entry.name.endsWith('.json')) {
      const raw = fs.readFileSync(fullPath, 'utf-8');
      if (raw.includes(oldStr)) {
        fs.writeFileSync(fullPath, raw.split(oldStr).join(newStr));
      }
    }
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { capcutRoot: CAPCUT_ROOT } = loadSettings();
  const CAPCUT_ROOT_META = path.join(CAPCUT_ROOT, 'root_meta_info.json');

  const project = loadProject(id);
  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 });
  }

  const srcDir = path.join(projectDir(id), 'capcut-project');
  if (!fs.existsSync(srcDir)) {
    return NextResponse.json({ error: 'CapCut 프로젝트가 아직 생성되지 않았습니다. 먼저 파이프라인을 완료하세요.' }, { status: 400 });
  }

  const metaSrc = path.join(srcDir, 'draft_meta_info.json');
  if (!fs.existsSync(metaSrc)) {
    return NextResponse.json({ error: 'draft_meta_info.json을 찾을 수 없습니다.' }, { status: 400 });
  }

  const meta = JSON.parse(fs.readFileSync(metaSrc, 'utf-8'));
  const draftName: string = meta.draft_name ?? `VideoMaker_${id.slice(0, 20)}`;
  const draftId: string = meta.draft_id;
  const tmCreate: number = meta.tm_draft_create;
  const tmModified: number = meta.tm_draft_modified;
  const tmDuration: number = meta.tm_duration;

  const destDir = path.join(CAPCUT_ROOT, draftName);

  // Copy the portable capcut-project into CapCut's directory
  copyDirRecursive(srcDir, destDir);

  // Patch all JSON files: rewrite bundled media paths from srcDir to destDir
  // This covers both root draft_info.json and Timelines/{id}/draft_info.json
  replacePathsInDir(destDir, srcDir, destDir);

  // Patch draft_meta_info.json in the destination with machine-local absolute paths
  const patchedMeta = {
    ...meta,
    draft_fold_path: destDir,
    draft_root_path: CAPCUT_ROOT,
  };
  fs.writeFileSync(path.join(destDir, 'draft_meta_info.json'), JSON.stringify(patchedMeta, null, 2));

  // Register in root_meta_info.json
  let rootMeta: { all_draft_store: unknown[]; draft_ids: number; root_path: string } = {
    all_draft_store: [],
    draft_ids: 1,
    root_path: CAPCUT_ROOT,
  };
  if (fs.existsSync(CAPCUT_ROOT_META)) {
    rootMeta = JSON.parse(fs.readFileSync(CAPCUT_ROOT_META, 'utf-8'));
  }

  const entries = rootMeta.all_draft_store as Record<string, unknown>[];
  const existingIdx = entries.findIndex((e) => e.draft_id === draftId);
  const entry: Record<string, unknown> = {
    draft_cloud_capcut_purchase_info: '',
    draft_cloud_last_action_download: false,
    draft_cloud_package_type: '',
    draft_cloud_purchase_info: '',
    draft_cloud_template_id: '',
    draft_cloud_tutorial_info: '',
    draft_cloud_videocut_purchase_info: '',
    draft_cover: 'draft_cover.jpg',
    draft_fold_path: destDir,
    draft_id: draftId,
    draft_is_ai_shorts: false,
    draft_is_invisible: false,
    draft_json_file: path.join(destDir, 'draft_info.json'),
    draft_name: draftName,
    draft_new_version: '',
    draft_removable_storage_device: '',
    draft_root_path: CAPCUT_ROOT,
    draft_timeline_materials_size: 0,
    draft_type: '',
    streaming_edit_draft_ready: false,
    tm_draft_cloud_completed: '',
    tm_draft_cloud_entry_id: -1,
    tm_draft_cloud_modified: 0,
    tm_draft_cloud_parent_entry_id: -1,
    tm_draft_cloud_space_id: -1,
    tm_draft_cloud_user_id: -1,
    tm_draft_create: tmCreate,
    tm_draft_modified: tmModified,
    tm_draft_removed: 0,
    tm_duration: tmDuration,
  };

  if (existingIdx >= 0) {
    entries[existingIdx] = entry;
  } else {
    entries.unshift(entry);
    rootMeta.draft_ids = (rootMeta.draft_ids as number) + 1;
  }

  fs.writeFileSync(CAPCUT_ROOT_META, JSON.stringify(rootMeta, null, 2));

  return NextResponse.json({ success: true, destDir });
}

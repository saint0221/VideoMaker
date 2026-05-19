import { NextResponse } from 'next/server';
import { readCostLog } from '@/lib/project';
import type { CostLogEntry } from '@/lib/types';

export async function GET() {
  const log = readCostLog();

  const totalImage = log.filter((e) => e.stage === 'image').reduce((s, e) => s + e.totalCost, 0);
  const totalVideo = log.filter((e) => e.stage === 'video').reduce((s, e) => s + e.totalCost, 0);

  const byProject: Record<string, { image: number; video: number; entries: CostLogEntry[] }> = {};
  for (const entry of log) {
    if (!byProject[entry.projectId]) byProject[entry.projectId] = { image: 0, video: 0, entries: [] };
    byProject[entry.projectId][entry.stage] += entry.totalCost;
    byProject[entry.projectId].entries.push(entry);
  }

  return NextResponse.json({
    total: +(totalImage + totalVideo).toFixed(4),
    totalImage: +totalImage.toFixed(4),
    totalVideo: +totalVideo.toFixed(4),
    byProject,
    log,
  });
}

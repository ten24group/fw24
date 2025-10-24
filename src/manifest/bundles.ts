import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface BundleReportOptions {
  rootDir?: string;
  reportsDir?: string;
  metafilePath?: string; // esbuild metafile path
}

export function writeBundleReport(options: BundleReportOptions = {}) {
  const root = options.rootDir || process.cwd();
  const reportsDir = options.reportsDir || join(root, '.fw24', 'reports');
  const metafilePath = options.metafilePath || join(root, 'dist', 'metafile.json');

  const outPath = join(reportsDir, 'bundles.json');

  if (!existsSync(metafilePath)) {
    writeFileSync(outPath, JSON.stringify({ ok: false, reason: 'metafile not found', metafilePath }, null, 2));
    return { ok: false as const, outPath };
  }

  try {
    const raw = JSON.parse(readFileSync(metafilePath, 'utf-8'));
    const report = summarizeEsbuildMetafile(raw);
    writeFileSync(outPath, JSON.stringify({ ok: true, ...report }, null, 2));
    return { ok: true as const, outPath };
  } catch (e: any) {
    writeFileSync(outPath, JSON.stringify({ ok: false, error: String(e) }, null, 2));
    return { ok: false as const, outPath };
  }
}

function summarizeEsbuildMetafile(metafile: any) {
  // Very basic summary: total bytes and outputs
  const outputs = metafile.outputs || {};
  const summary: Array<{ file: string; bytes: number }> = [];
  let total = 0;
  for (const [file, info] of Object.entries<any>(outputs)) {
    const bytes = info.bytes || 0;
    total += bytes;
    summary.push({ file, bytes });
  }
  summary.sort((a, b) => b.bytes - a.bytes);
  return { totalBytes: total, outputs: summary };
}



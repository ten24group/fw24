import { writeFileSync } from 'fs';
import { join } from 'path';
import { Manifest } from './types';

export function writeAuthorizerPolicyReport(manifest: Manifest, reportsDir: string) {
  const lines: string[] = [];
  lines.push(`# Authorizer → Policy Mapping (AWS_IAM focus)`);
  manifest.capabilities.filter(c => c.kind === 'controller').forEach(c => {
    const base = c.routing?.basePath || '';
    (c.routing?.routes || []).forEach(r => {
      const auth = typeof r.authorizer === 'string' ? r.authorizer : r.authorizer?.type;
      if (auth === 'AWS_IAM') {
        const groups = typeof r.authorizer === 'string' ? [] : (r.authorizer?.groups || []);
        const requireCfg = typeof r.authorizer === 'string' ? false : (r.authorizer?.requireRouteInGroupConfig || false);
        lines.push(`- ${c.id} ${r.method} ${base}${r.path} groups=[${groups.join(',')}] requireInGroupCfg=${requireCfg}`);
      }
    });
  });
  writeFileSync(join(reportsDir, 'authorizer-policy.md'), lines.join('\n'));
}



export function ensurePrefix(key: string, prefix: string = '') {
  if (prefix.length > 0) {
    prefix = prefix.endsWith('_') ? prefix : `${prefix}_`;
  }

  if (!key.startsWith(prefix)) {
    key = `${prefix}${key}`;
  }

  return key;
}

export function ensureSuffix(key: string, suffix: string = '') {
  if (suffix.length > 0) {
    suffix = suffix.startsWith('_') ? suffix : `_${suffix}`;
  }

  if (!key.startsWith(suffix)) {
    key = `${key}${suffix}`;
  }

  return key;
}

export function ensureValidEnvKey(key: string, prefix = '', suffix = '', forExport = false) {
  key = ensurePrefix(key, prefix);
  key = ensureSuffix(key, suffix);

  // For CloudFormation exports, convert underscores to hyphens
  if (forExport) {
    return ensureNoSpecialChars(key, true).toUpperCase();
  }

  // For Lambda env vars, keep underscores (default behavior)
  return ensureNoSpecialChars(key).toUpperCase();
}

export function ensureNoSpecialChars(val: string, forExport = false) {
  if (forExport) {
    // For CloudFormation exports: replace underscores and special chars with hyphens
    return val.replace(/[^a-zA-Z0-9-]/g, '-');
  }
  // For Lambda env vars: replace special chars (except underscores) with underscores
  return val.replace(/[^a-zA-Z0-9_]/g, '_');
}

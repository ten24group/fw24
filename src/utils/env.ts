import { ensureValidEnvKey } from './keys';

export function resolveEnvValueFor(options: { key: string; prefix?: string; suffix?: string }) {
  const { key, prefix = '', suffix = '' } = options;

  const validKey = ensureValidEnvKey(key, prefix, suffix);

  return process.env[validKey];
}

import { ensureValidEnvKey } from "./keys";

export function resolveEnvValueFor<T = any>(options: { key: string, prefix?: string, suffix?: string, defaultValue?: T }) {
    const { key, prefix = '', suffix = '', } = options;

    const validKey = ensureValidEnvKey(key, prefix, suffix);

    return (process.env[ validKey ] ?? options.defaultValue) as T;
}
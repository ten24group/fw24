import { ensureValidEnvKey } from "./keys";

export function resolveEnvValueFor<T = any>(options: { key: string, prefix?: string, suffix?: string, defaultValue?: T }) {
    const { key, prefix = '', suffix = '', } = options;

    const validKey = ensureValidEnvKey(key, prefix, suffix);

    const envValue = process.env[validKey];
    
    // If environment variable is not set or is an empty string, use defaultValue
    if (envValue === undefined || envValue === null || envValue === '') {
        return options.defaultValue as T;
    }
    
    // Convert string 'true'/'false' to boolean if the defaultValue is boolean
    if (typeof options.defaultValue === 'boolean' && typeof envValue === 'string') {
        return (envValue.toLowerCase() === 'true') as T;
    }
    
    // Convert string numbers to actual numbers if the defaultValue is a number
    if (typeof options.defaultValue === 'number' && typeof envValue === 'string') {
        const numValue = Number(envValue);
        return (isNaN(numValue) ? options.defaultValue : numValue) as T;
    }
    
    return envValue as T;
}
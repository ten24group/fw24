export function ensurePrefix(key: string, prefix: string = '') {
    if(prefix.length > 0) {
        prefix = prefix.endsWith('_') ? prefix : `${prefix}_`;
    }

    if(!key.startsWith(prefix)) {
        key = `${prefix}${key}`;
    }

    return key;
}

export function ensureSuffix(key: string, suffix: string = '') {
    if(suffix.length > 0) {
        suffix = suffix.startsWith('_') ? suffix : `_${suffix}`;
    }

    if(!key.startsWith(suffix)) {
        key = `${key}${suffix}`;
    }

    return key;
}

export function ensureValidEnvKey(key: string, prefix = '', suffix = ''){
        
    key = ensurePrefix(key, prefix);
    
    key = ensureSuffix(key, suffix);

    return ensureNoSpecialChars(key).toUpperCase();
}

export function ensureNoSpecialChars(val: string){
    // * encode/special characters in key to make them friendly for aws Lambda env
    // replace all non-alphanumeric characters with underscore
    return val.replace(/[^a-zA-Z0-9_]/g, '_');
}
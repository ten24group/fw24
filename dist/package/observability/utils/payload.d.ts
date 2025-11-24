export declare const safeStringify: (value: any, visited?: WeakSet<object>) => any;
export declare const truncatePayload: <T>(payload: T, maxBytes?: number) => T | Record<string, any>;

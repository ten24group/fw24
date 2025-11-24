import { ObservabilityBackend, ObservabilityConfig, ObservabilityEvent } from './types';
export declare class ObservabilityManager {
    private static config;
    private static backends;
    static initialize(config: ObservabilityConfig, backends: ObservabilityBackend[]): void;
    private static validateConfig;
    static getConfig(): ObservabilityConfig;
    static registerBackend(backend: ObservabilityBackend): void;
    static initializeInvocation(): void;
    static capture(event: ObservabilityEvent): void;
    private static getBackendsForType;
    private static getTypeCategory;
    static flush(): Promise<void>;
    private static shouldCapture;
    private static getLevelValue;
    private static ensureInitialized;
}
export declare const withObservability: <T extends (...args: any[]) => Promise<any>>(handler: T) => T;

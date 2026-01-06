import { ObservabilityLevel } from '../types';
/**
 * Convert ObservabilityLevel enum to string representation
 */
export declare function levelToString(level: ObservabilityLevel): 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'critical';
/**
 * Convert string level to ObservabilityLevel enum value
 */
export declare function stringToLevel(level: string | 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'critical'): ObservabilityLevel;
/**
 * Map ObservabilityLevel to AWS Powertools Logger level
 */
export declare function levelToPowertoolsLogLevel(level?: ObservabilityLevel): 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

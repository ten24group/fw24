import { ObservabilityLevel } from '../types';

/**
 * Convert ObservabilityLevel enum to string representation
 */
export function levelToString(level: ObservabilityLevel): 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'critical' {
  switch (level) {
    case ObservabilityLevel.TRACE:
      return 'trace';
    case ObservabilityLevel.DEBUG:
      return 'debug';
    case ObservabilityLevel.INFO:
      return 'info';
    case ObservabilityLevel.WARN:
      return 'warn';
    case ObservabilityLevel.ERROR:
      return 'error';
    case ObservabilityLevel.CRITICAL:
      return 'critical';
    default:
      return 'info';
  }
}

/**
 * Convert string level to ObservabilityLevel enum value
 */
export function stringToLevel(
  level: string | 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'critical',
): ObservabilityLevel {
  const normalized = level.toLowerCase();
  switch (normalized) {
    case 'trace':
      return ObservabilityLevel.TRACE;
    case 'debug':
      return ObservabilityLevel.DEBUG;
    case 'info':
      return ObservabilityLevel.INFO;
    case 'warn':
      return ObservabilityLevel.WARN;
    case 'error':
      return ObservabilityLevel.ERROR;
    case 'critical':
      return ObservabilityLevel.CRITICAL;
    default:
      return (ObservabilityLevel as any)[level] ?? ObservabilityLevel.INFO;
  }
}

/**
 * Map ObservabilityLevel to AWS Powertools Logger level
 */
export function levelToPowertoolsLogLevel(level?: ObservabilityLevel): 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' {
  if (level === undefined) return 'INFO';
  
  if (level <= ObservabilityLevel.DEBUG) {
    return 'DEBUG';
  } else if (level === ObservabilityLevel.INFO) {
    return 'INFO';
  } else if (level === ObservabilityLevel.WARN) {
    return 'WARN';
  } else if (level >= ObservabilityLevel.ERROR) {
    return 'ERROR';
  }
  
  return 'INFO';
}


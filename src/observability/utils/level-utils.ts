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
 * String to enum level mapping for type safety
 */
const stringToLevelMap: Record<string, ObservabilityLevel> = {
  trace: ObservabilityLevel.TRACE,
  debug: ObservabilityLevel.DEBUG,
  info: ObservabilityLevel.INFO,
  warn: ObservabilityLevel.WARN,
  error: ObservabilityLevel.ERROR,
  critical: ObservabilityLevel.CRITICAL,
  // Also support enum name versions
  TRACE: ObservabilityLevel.TRACE,
  DEBUG: ObservabilityLevel.DEBUG,
  INFO: ObservabilityLevel.INFO,
  WARN: ObservabilityLevel.WARN,
  ERROR: ObservabilityLevel.ERROR,
  CRITICAL: ObservabilityLevel.CRITICAL,
};

/**
 * Convert string level to ObservabilityLevel enum value
 */
export function stringToLevel(
  level: string | 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'critical',
): ObservabilityLevel {
  const normalized = level.toLowerCase();
  return stringToLevelMap[normalized] ?? stringToLevelMap[level] ?? ObservabilityLevel.INFO;
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


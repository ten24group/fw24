/**
 * Audit interfaces - ONLY for DynamoDB stream entity auditing.
 * 
 * Controllers and other components should use the observability system directly.
 */

/**
 * Environment variable keys for entity audit filtering.
 */
export const AUDIT_ENV_KEYS = {
    /** Entity names to audit (comma-separated) */
    ALLOWED_ENTITY_NAMES: 'AUDIT_ALLOWED_ENTITY_NAMES',
    /** Entity names to exclude from audit (comma-separated) */
    EXCLUDED_ENTITY_NAMES: 'AUDIT_EXCLUDED_ENTITY_NAMES'
} as const;
 
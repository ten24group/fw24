"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRelationFallback = generateRelationFallback;
exports.resolveRelationOptionConfig = resolveRelationOptionConfig;
exports.generateFilterConfig = generateFilterConfig;
exports.generateSegments = generateSegments;
exports.formatEntityAttributeForFormOrDetail = formatEntityAttributeForFormOrDetail;
exports.formatEntityAttributesForFormOrDetail = formatEntityAttributesForFormOrDetail;
exports.formatEntityAttributesForCreate = formatEntityAttributesForCreate;
exports.formatEntityAttributesForUpdate = formatEntityAttributesForUpdate;
exports.formatEntityAttributesForDetail = formatEntityAttributesForDetail;
exports.formatEntityAttributesForList = formatEntityAttributesForList;
exports.mergeButtons = mergeButtons;
exports.mergeActions = mergeActions;
exports.mergeFieldVisibility = mergeFieldVisibility;
exports.mergeColumnVisibility = mergeColumnVisibility;
const entity_1 = require("../../entity");
const errors_1 = require("../../errors");
const logging_1 = require("../../logging");
const utils_1 = require("../../utils");
/**
 * Smart default configuration
 */
/**
 * Framework-level default detection config.
 * Contains ONLY domain-agnostic patterns that work across any application.
 *
 * Applications should provide domain-specific prefixes via uiConfigOptions.
 *
 * @example Application-specific config (in backend index.ts):
 * ```typescript
 * const uiConfigOptions = {
 *   duplicatedFieldDetection: {
 *     prefixes: [
 *       // Domain-specific prefixes for your app
 *       'player', 'team', 'league', 'season', 'venue', 'sport',  // Sports app
 *       // OR: 'customer', 'order', 'product', 'invoice'  // E-commerce app
 *       // OR: 'author', 'book', 'publisher', 'genre'  // Library app
 *     ]
 *   }
 * };
 * ```
 */
const DEFAULT_DETECTION_CONFIG = {
    enabled: true,
    suffixes: {
        // Generic display text patterns (universal)
        display: ['Name', 'Title', 'Label', 'DisplayName'],
        // Generic visual asset patterns (universal)
        visual: ['Logo', 'Image', 'Icon', 'Avatar', 'Picture'],
        // Generic metadata patterns (universal)
        meta: ['Code', 'Slug', 'Key', 'Identifier', 'RemoteId']
    },
    prefixes: [
        // Generic relational patterns (universal)
        'parent', 'child',
        'source', 'target', 'destination',
        'primary', 'secondary', 'tertiary',
        'main', 'alternate', 'fallback',
        'owner', 'creator', 'modifier',
        'first', 'second', 'third', 'last',
        'previous', 'next', 'current',
        'old', 'new',
        'original', 'copy', 'draft',
        // Generic directional patterns (universal)
        'home', 'away',
        'left', 'right',
        'top', 'bottom',
        'inner', 'outer',
        // Generic competitive patterns (universal)
        'winner', 'loser',
        'competitor', 'opponent'
        // NOTE: Domain-specific prefixes (player, team, customer, order, etc.)
        // should be provided via uiConfigOptions in your application's backend
    ],
    templateStyle: 'simple',
    confidenceThreshold: 'medium',
    debug: false
};
/**
 * Merge configurations with priority: hints > entity > global > defaults
 */
function mergeDetectionConfigs(globalConfig, entityConfig, relationHints) {
    // Start with defaults
    let merged = { ...DEFAULT_DETECTION_CONFIG };
    // Apply global config
    if (globalConfig) {
        merged = {
            ...merged,
            ...globalConfig,
            suffixes: { ...merged.suffixes, ...globalConfig.suffixes },
            prefixes: globalConfig.prefixes || merged.prefixes
        };
    }
    // Apply entity config (higher priority)
    if (entityConfig) {
        merged = {
            ...merged,
            ...entityConfig,
            suffixes: { ...merged.suffixes, ...entityConfig.suffixes },
            prefixes: entityConfig.prefixes || merged.prefixes
        };
    }
    // Apply relation hints (highest priority)
    const result = { ...merged };
    if (relationHints) {
        if (relationHints.templateStyle) {
            result.templateStyle = relationHints.templateStyle;
        }
        if (relationHints.preferredFields) {
            result.preferredFields = relationHints.preferredFields;
        }
        if (relationHints.excludeFields) {
            result.excludeFields = relationHints.excludeFields;
        }
    }
    return result;
}
/**
 * Parse relation field to extract prefix and base name.
 *
 * Examples:
 * - 'teamId' → { baseName: 'Team', hasIdSuffix: true }
 * - 'homeTeamId' → { prefix: 'home', baseName: 'Team', hasIdSuffix: true }
 * - 'competitor1TeamId' → { prefix: 'competitor1', baseName: 'Team', hasIdSuffix: true }
 * - 'sport' → { baseName: 'sport', hasIdSuffix: false }
 */
function parseRelationField(fieldId, prefixes) {
    // Build regex for prefix detection: ^(prefix1|prefix2|...)(\\d*)(.+)$
    // Use case-insensitive matching
    const prefixPattern = new RegExp(`^(${prefixes.join('|')})(\\d*)(.+)$`, 'i');
    const match = fieldId.match(prefixPattern);
    if (match) {
        const [, prefix, num, rest] = match;
        const hasIdSuffix = rest.toLowerCase().endsWith('id');
        const baseName = hasIdSuffix
            ? rest.substring(0, rest.length - 2)
            : rest;
        return {
            prefix: prefix + num, // 'home' or 'competitor1'
            baseName,
            hasIdSuffix,
            originalField: fieldId
        };
    }
    // No prefix detected
    const hasIdSuffix = fieldId.toLowerCase().endsWith('id');
    const baseName = hasIdSuffix
        ? fieldId.substring(0, fieldId.length - 2)
        : fieldId;
    return {
        baseName,
        hasIdSuffix,
        originalField: fieldId
    };
}
/**
 * Generate search patterns for candidate field names.
 *
 * Priority:
 * 1. Preferred fields (from hints)
 * 2. Exact prefix match: {prefix}{baseName}{suffix}
 * 3. Entity name match: {entityName}{suffix}
 * 4. Base name match: {baseName}{suffix}
 */
function generateSearchPatterns(parsed, entityName, suffixes, preferredFields) {
    const patterns = [];
    const entityNameLower = entityName.toLowerCase();
    const baseNameLower = parsed.baseName.toLowerCase();
    // Priority 1: Preferred fields (exact match)
    if (preferredFields && preferredFields.length > 0) {
        patterns.push(...preferredFields);
    }
    // Priority 2: With prefix (e.g., homeTeamName, awayTeamName)
    if (parsed.prefix) {
        const prefixLower = parsed.prefix.toLowerCase();
        for (const suffix of suffixes) {
            patterns.push(`${prefixLower}${baseNameLower}${suffix.toLowerCase()}`);
            patterns.push(`${prefixLower}${entityNameLower}${suffix.toLowerCase()}`);
        }
    }
    // Priority 3: Entity name (e.g., teamName for relation to 'team')
    for (const suffix of suffixes) {
        patterns.push(`${entityNameLower}${suffix.toLowerCase()}`);
    }
    // Priority 4: Base name (e.g., teamName for 'teamId')
    for (const suffix of suffixes) {
        patterns.push(`${baseNameLower}${suffix.toLowerCase()}`);
    }
    return patterns;
}
/**
 * Search for fields matching patterns, excluding specified fields.
 */
function searchFieldsByPatterns(allProperties, patterns, excludeFields) {
    const excludeSet = new Set(excludeFields?.map(f => f.toLowerCase()) || []);
    const found = [];
    const seenLower = new Set();
    for (const pattern of patterns) {
        const patternLower = pattern.toLowerCase();
        // Skip if already found or excluded
        if (seenLower.has(patternLower) || excludeSet.has(patternLower)) {
            continue;
        }
        // Find matching field (case-insensitive)
        const match = allProperties.find(p => p.id?.toLowerCase() === patternLower &&
            !excludeSet.has(p.id.toLowerCase()));
        if (match) {
            found.push(match.id);
            seenLower.add(match.id.toLowerCase());
        }
    }
    return found;
}
/**
 * Calculate confidence based on detection method and pattern
 */
function calculateConfidence(detectedField, parsed, entityName, method) {
    // Preferred fields = high confidence (developer explicitly specified)
    if (method === 'preferred')
        return 'high';
    const fieldLower = detectedField.toLowerCase();
    const entityLower = entityName.toLowerCase();
    const baseLower = parsed.baseName.toLowerCase();
    // Exact prefix + entity/base match = high
    if (method === 'prefix') {
        if (fieldLower.includes(entityLower) || fieldLower.includes(baseLower)) {
            return 'high';
        }
        return 'medium';
    }
    // Entity name match = high
    if (method === 'entity')
        return 'high';
    // Base name match = medium (could be coincidental)
    if (method === 'base')
        return 'medium';
    return 'low';
}
/**
 * Generate template string from detected fields.
 */
function generateTemplate(primaryField, allDetectedFields, templateStyle) {
    if (templateStyle === 'simple') {
        return `{${primaryField}}`;
    }
    // Composite: try to include meta field (code/slug) if available
    if (templateStyle === 'composite' && allDetectedFields.meta && allDetectedFields.meta.length > 0) {
        const metaField = allDetectedFields.meta[0];
        return `{${primaryField}} ({${metaField}})`;
    }
    // Fallback to simple if no meta field
    return `{${primaryField}}`;
}
/**
 * Enhanced smart duplicated field detection.
 *
 * Detects fields like 'teamName' for 'teamId' relations with support for:
 * - Prefixes (home, away, competitor1, etc.)
 * - Multiple suffixes (Name, Title, Label, Logo, Code, etc.)
 * - Preferred fields and exclusions
 * - Confidence scoring
 * - Composite templates
 *
 * @param allProperties - All properties in the parent entity
 * @param relationFieldId - The relation field name (e.g., 'teamId', 'homeTeamId')
 * @param relatedEntityName - Related entity name (e.g., 'team')
 * @param globalConfig - Global detection configuration
 * @param entityConfig - Entity-level detection configuration
 * @param relationHints - Relation-specific hints
 * @returns Detection result with template and metadata
 */
function detectDuplicatedRelationFields(allProperties, relationFieldId, relatedEntityName, globalConfig, entityConfig, relationHints) {
    // Merge configurations
    const config = mergeDetectionConfigs(globalConfig, entityConfig, relationHints);
    // Check if detection is enabled
    if (!config.enabled) {
        return undefined;
    }
    // Parse relation field
    const parsed = parseRelationField(relationFieldId, config.prefixes);
    // Search for display fields (Name, Title, Label)
    const displayPatterns = generateSearchPatterns(parsed, relatedEntityName, config.suffixes?.display || [], config.preferredFields);
    const displayFields = searchFieldsByPatterns(allProperties, displayPatterns, config.excludeFields);
    // Search for visual fields (Logo, Image, Icon)
    const visualPatterns = generateSearchPatterns(parsed, relatedEntityName, config.suffixes?.visual || []);
    const visualFields = searchFieldsByPatterns(allProperties, visualPatterns, config.excludeFields);
    // Search for meta fields (Code, Slug, Key)
    const metaPatterns = generateSearchPatterns(parsed, relatedEntityName, config.suffixes?.meta || []);
    const metaFields = searchFieldsByPatterns(allProperties, metaPatterns, config.excludeFields);
    // No fields detected
    if (displayFields.length === 0) {
        return undefined;
    }
    // Determine detection method
    const primaryField = displayFields[0];
    let method = 'base';
    let pattern = 'unknown';
    if (config.preferredFields && config.preferredFields.includes(primaryField)) {
        method = 'preferred';
        pattern = 'preferred_field';
    }
    else if (parsed.prefix && primaryField.toLowerCase().startsWith(parsed.prefix.toLowerCase())) {
        method = 'prefix';
        pattern = `${parsed.prefix}{entity}{suffix}`;
    }
    else if (primaryField.toLowerCase().startsWith(relatedEntityName.toLowerCase())) {
        method = 'entity';
        pattern = `{entity}{suffix}`;
    }
    else {
        method = 'base';
        pattern = `{base}{suffix}`;
    }
    // Calculate confidence
    const confidence = calculateConfidence(primaryField, parsed, relatedEntityName, method);
    // Check confidence threshold
    const thresholdOrder = { low: 0, medium: 1, high: 2 };
    if (thresholdOrder[confidence] < thresholdOrder[config.confidenceThreshold]) {
        // Confidence too low
        if (config.debug) {
            logging_1.DefaultLogger.info(`[DuplicatedFieldDetection] Skipping ${relationFieldId}: confidence ${confidence} < threshold ${config.confidenceThreshold}`);
        }
        return undefined;
    }
    // Generate template
    const template = generateTemplate(primaryField, { display: displayFields, visual: visualFields, meta: metaFields }, config.templateStyle);
    // Debug logging
    if (config.debug) {
        logging_1.DefaultLogger.info(`[DuplicatedFieldDetection] ${relationFieldId} → ${template} (confidence: ${confidence}, method: ${method})`);
    }
    return {
        primaryField,
        template,
        detectedFields: {
            display: displayFields,
            visual: visualFields.length > 0 ? visualFields : undefined,
            meta: metaFields.length > 0 ? metaFields : undefined
        },
        confidence,
        method,
        pattern
    };
}
/**
 * Legacy wrapper function for backward compatibility.
 *
 * @deprecated Use detectDuplicatedRelationFields() for richer results
 */
function detectDuplicatedRelationFieldTemplate(allProperties, relationFieldId, relatedEntityName) {
    const result = detectDuplicatedRelationFields(allProperties, relationFieldId, relatedEntityName);
    return result?.template;
}
/**
 * Generate smart fallback configuration for relation display when only ID is available.
 * Uses entity metadata (icon, entityNamePlural) to create user-friendly fallback text.
 *
 * @param entityName - Related entity name (e.g., 'team')
 * @param idField - ID field name (e.g., 'teamId')
 * @param entityService - Entity service to get metadata from
 * @returns Fallback configuration with template, linkText, and modalButtonText
 *
 * @example
 * // For a team relation
 * generateRelationFallback('team', 'teamId', teamService)
 * // Returns: {
 * //   template: 'Team: {teamId}',
 * //   linkText: 'View Team',
 * //   modalButtonText: 'Team Details'
 * // }
 */
/**
 * Generates fallback display configuration for relation fields.
 *
 * Creates user-friendly fallback text to display when only the ID of a related entity is available.
 * Uses the entity's plural display name (from metadata) or generates it from the entity name.
 *
 * @param entityName - Name of the related entity (e.g., 'team', 'user')
 * @param idField - ID field name (e.g., 'teamId', 'userId')
 * @param entityService - Optional entity service to fetch metadata for better naming
 * @returns Fallback configuration with template, link text, and modal button text
 *
 * @example
 * ```typescript
 * const fallback = generateRelationFallback('team', 'teamId');
 * // Returns: {
 * //   template: "Teams: {teamId}",
 * //   linkText: "View Teams",
 * //   modalButtonText: "Teams Details"
 * // }
 * ```
 */
function generateRelationFallback(entityName, idField, entityService) {
    // Try to get entity metadata for better fallback text
    const entityMetadata = entityService?.getEntitySchema?.().model;
    const displayName = entityMetadata?.entityNamePlural || (0, utils_1.pascalCase)(entityName);
    return {
        // Backend pre-generates fallback template (intentionally string-only, not Template type)
        // Frontend will use this when only ID is available
        template: `${displayName}: {${idField}}`, // e.g., "Team: {teamId}"
        linkText: `View ${displayName}`, // e.g., "View Team"
        modalButtonText: `${displayName} Details` // e.g., "Team Details"
    };
}
/**
 * Smart label field detection for entity options.
 * Uses generic patterns to find display fields that are actual identifiers/names.
 *
 * **HIGHLY CONSERVATIVE**: Only returns fields that are clearly meant for display.
 * Returns undefined if no proper name field is found - better to show ID than confuse users.
 *
 * Detection order (all HIGH or MEDIUM confidence):
 * 1. Entity metadata (entityNameAttribute) - HIGH confidence
 * 2. Common display field patterns (name, title, label, displayName) - HIGH confidence
 * 3. Entity-specific patterns ({entityName}Name, {entityName}Title) - HIGH confidence
 * 4. Fields ending with name-like suffixes (Name, Title, Label, Code) - MEDIUM confidence
 *
 * **NO FALLBACK**: If none of the above match, returns undefined.
 * We do NOT pick generic fields like 'status', 'type', or random enums/strings.
 *
 * Why no fallback?
 * - Showing "active"/"cancelled" for subscriptions is confusing (which subscription?)
 * - Showing "credit_card"/"paypal" for payment methods is not an identifier
 * - Better to show subscriptionId than misleading fields
 *
 * For entities without name fields, use one of:
 * - Set entityNameAttribute in schema metadata
 * - Use optionMapping in relation config
 * - Let it fall back to ID (clearest option)
 *
 * @example
 * // Entities with clear name fields - DETECTED ✅
 * Team → teamName (Priority 3, HIGH confidence)
 * User → name (Priority 2, HIGH confidence)
 * Post → postTitle (Priority 4, MEDIUM confidence)
 *
 * @example
 * // Entities without name fields - RETURNS undefined ✅
 * Subscription → undefined (falls back to subscriptionId - clear!)
 * PaymentMethod → undefined (falls back to paymentMethodId - clear!)
 * AuditLog → undefined (falls back to auditLogId - clear!)
 *
 * @param schema - Entity schema
 * @param entityName - Entity name (e.g., 'team', 'user')
 * @param options - Detection options
 * @returns Best label field name or undefined (will fall back to ID field)
 */
function findLabelField(schema, entityName, options) {
    const minConfidence = options?.minConfidence || 'medium';
    const debug = options?.debug || false;
    let result;
    // Get all attributes from schema
    const attributes = schema.attributes;
    const attributeNames = Object.keys(attributes);
    // Priority 1: Entity metadata - HIGH confidence
    const entityNameAttribute = schema.model.entityNameAttribute;
    if (entityNameAttribute && attributes[entityNameAttribute]) {
        result = {
            field: entityNameAttribute,
            confidence: 'high',
            method: 'metadata'
        };
        if (debug) {
            logging_1.DefaultLogger.info(`[findLabelField] ${entityName}: Found via metadata - ${entityNameAttribute} (HIGH confidence)`);
        }
    }
    // Priority 2: Common display patterns - HIGH confidence
    if (!result) {
        const commonPatterns = ['name', 'title', 'label', 'displayName', 'displayname'];
        for (const pattern of commonPatterns) {
            const match = attributeNames.find(attr => attr.toLowerCase() === pattern);
            if (match) {
                result = {
                    field: match,
                    confidence: 'high',
                    method: 'common-pattern'
                };
                if (debug) {
                    logging_1.DefaultLogger.info(`[findLabelField] ${entityName}: Found via common pattern '${pattern}' - ${match} (HIGH confidence)`);
                }
                break;
            }
        }
    }
    // Priority 3: Entity-specific patterns - HIGH confidence
    if (!result) {
        const entityLower = entityName.toLowerCase();
        const entitySpecificSuffixes = ['Name', 'Title', 'Label'];
        for (const suffix of entitySpecificSuffixes) {
            // Try exact match: e.g., 'teamName' for entity 'team'
            const exactMatch = attributeNames.find(attr => attr.toLowerCase() === `${entityLower}${suffix.toLowerCase()}`);
            if (exactMatch) {
                result = {
                    field: exactMatch,
                    confidence: 'high',
                    method: 'entity-pattern'
                };
                if (debug) {
                    logging_1.DefaultLogger.info(`[findLabelField] ${entityName}: Found via entity-specific pattern - ${exactMatch} (HIGH confidence)`);
                }
                break;
            }
        }
    }
    // Priority 4: Fields ending with name-like suffixes - MEDIUM confidence
    // Look for any field ending with 'Name', 'Title', 'Label' (e.g., 'displayName', 'fullName', 'userName',)
    if (!result) {
        const displayNameSuffixPattern = /DisplayName$/;
        const nameSuffixPattern = /Name$/;
        const titleSuffixPattern = /Title$/;
        const labelSuffixPattern = /Label$/;
        const codeSuffixPattern = /Code$/;
        for (const pattern of [displayNameSuffixPattern, labelSuffixPattern, titleSuffixPattern, nameSuffixPattern, codeSuffixPattern]) {
            const match = attributeNames.find(attr => pattern.test(attr));
            if (match) {
                result = {
                    field: match,
                    confidence: 'medium',
                    method: 'suffix-pattern'
                };
                if (debug) {
                    logging_1.DefaultLogger.info(`[findLabelField] ${entityName}: Found via suffix pattern - ${match} (MEDIUM confidence)`);
                }
                break;
            }
        }
    }
    // Priority 5: NO FALLBACK - If we can't find a proper name field, return undefined
    // Better to show ID than to show confusing fields like 'status', 'type', etc.
    // 
    // Entities like Subscription, PaymentMethod don't have traditional name fields.
    // Showing "active" or "credit_card" in a dropdown is confusing - users can't distinguish items.
    // It's clearer to show the ID (subscriptionId, paymentMethodId) in such cases.
    //
    // If you need custom labels for these entities, explicitly set entityNameAttribute in the schema
    // or use optionMapping in the relation config.
    // Check confidence threshold
    if (result) {
        // Only return if confidence meets minimum requirement
        // minConfidence: 'high' → only return HIGH confidence results
        // minConfidence: 'medium' → return HIGH or MEDIUM confidence results (default)
        if (minConfidence === 'high' && result.confidence === 'medium') {
            if (debug) {
                logging_1.DefaultLogger.warn(`[findLabelField] ${entityName}: Field '${result.field}' found with MEDIUM confidence, but HIGH confidence required. Returning undefined.`);
            }
            return undefined;
        }
        return result.field;
    }
    // No suitable field found
    if (debug) {
        logging_1.DefaultLogger.warn(`[findLabelField] ${entityName}: No suitable label field found with sufficient confidence.`);
    }
    return undefined;
}
// =======================================================================================
// RELATION OPTION CONFIG RESOLUTION
// =======================================================================================
/**
 * Resolves RelationEntityOptionConfig into FieldOptionsAPIConfig by auto-detecting:
 * - CRUD API path from entity schema
 * - Label field from entityNameAttribute metadata or smart detection
 * - Value field from relation identifiers
 *
 * @param relationConfig - Minimal relation option config
 * @param relationAttribute - The relation attribute (to get identifiers)
 * @param entityService - Entity service for schema lookup
 * @param globalUIConfigOptions - Global UI config options (for label field detection)
 * @returns Fully resolved FieldOptionsAPIConfig or undefined if entity not found
 */
function resolveRelationOptionConfig(relationConfig, relationAttribute, entityService, globalUIConfigOptions) {
    const { entityName, customApiUrl, optionMapping, ...rest } = relationConfig;
    const relation = relationAttribute.relation;
    // Get related entity service
    if (!entityService.hasEntityServiceByEntityName(entityName)) {
        logging_1.DefaultLogger.warn(`[resolveRelationOptionConfig] Entity service not found for: ${entityName}`);
        return undefined;
    }
    const relatedService = entityService.getEntityServiceByEntityName(entityName);
    const relatedSchema = relatedService?.getEntitySchema?.();
    if (!relatedSchema) {
        logging_1.DefaultLogger.warn(`[resolveRelationOptionConfig] Schema not found for entity: ${entityName}`);
        return undefined;
    }
    // 1. Resolve API URL
    const entityNameLower = entityName.toLowerCase();
    const crudPath = relatedSchema.model.CRUDApiPath || '';
    const apiUrl = customApiUrl || `${crudPath}/${entityNameLower}`;
    // 2. Resolve value field from relation identifiers
    const resolvedIdentifiers = typeof relation.identifiers === 'function' ? relation.identifiers() : relation.identifiers;
    const identifierMappings = Array.isArray(resolvedIdentifiers) ? resolvedIdentifiers : [resolvedIdentifiers];
    const primaryIdentifier = identifierMappings[0];
    const valueField = String(primaryIdentifier.target);
    // 3. Resolve label field from entity metadata or custom mapping
    let labelField = valueField; // Default fallback to value field
    if (optionMapping?.label) {
        // Custom label provided - use it
        labelField = optionMapping.label;
    }
    else {
        // Auto-detect using smart pattern matching with global config
        const labelFieldConfig = globalUIConfigOptions?.labelFieldDetection;
        labelField = findLabelField(relatedSchema, entityName, {
            minConfidence: labelFieldConfig?.minConfidence || 'medium',
            debug: labelFieldConfig?.debug || false
        }) || valueField;
    }
    // 4. Build complete FieldOptionsAPIConfig
    return {
        apiMethod: 'GET',
        apiUrl,
        responseKey: 'items',
        optionMapping: optionMapping || {
            label: labelField,
            value: optionMapping?.value || valueField
        },
        ...rest // Pass through filters, count, disableSearch, etc.
    };
}
// =======================================================================================
// FILTER AUTO-GENERATION
// =======================================================================================
/**
 * Auto-generates filterConfig for entity attributes based on field type.
 *
 * Algorithm:
 * 1. Check if explicit filterConfig already exists → use it
 * 2. Check if field is explicitly non-filterable → skip
 * 3. Detect field type and generate appropriate config
 * 4. Merge with global and entity-level overrides
 *
 * @param attribute - The attribute to generate filter config for
 * @param entityService - Entity service for accessing entity metadata
 * @param globalUIConfigOptions - Global UI configuration options
 * @returns Generated filter configuration or undefined
 */
function generateFilterConfig(attribute, entityService, globalUIConfigOptions) {
    // 1. If explicit filterConfig exists, use it (highest priority)
    if (attribute.filterConfig) {
        return attribute.filterConfig;
    }
    // 2. If field has explicit options config, use it
    if ('options' in attribute) {
        const options = attribute.options;
        // RelationEntityOptionConfig (has entityName) → resolve to FieldOptionsAPIConfig
        const isRelationConfig = typeof options === 'object' && !Array.isArray(options) && 'entityName' in options;
        let resolvedConfig;
        // Inline array → use as is
        if (Array.isArray(options) && options.length > 0) {
            resolvedConfig = options;
        }
        // FieldOptionsAPIConfig (has apiMethod, apiUrl, responseKey) → pass through
        const isApiConfig = typeof options === 'object' && !Array.isArray(options) && 'apiMethod' in options;
        if (isApiConfig) {
            resolvedConfig = options;
        }
        if (isRelationConfig && attribute.relation && entityService) {
            resolvedConfig = resolveRelationOptionConfig(options, attribute, entityService, globalUIConfigOptions);
        }
        if (resolvedConfig) {
            return {
                filterType: 'select',
                defaultOperator: 'eq',
                availableOperators: ['eq', 'neq', 'inList', 'notInList', 'isEmpty', 'isNull'],
                predefinedOptions: resolvedConfig
            };
        }
        // else log error
        throw new errors_1.FrameworkError(`[generateFilterConfig] No resolved config found for attribute: ${attribute.id}`, {
            attribute: attribute,
            options: options,
        });
    }
    // 3. If field is explicitly non-filterable, skip
    if (attribute.isFilterable === false) {
        return undefined;
    }
    // 3. Get global and entity-level config
    const globalFilterConfig = globalUIConfigOptions?.tableUI?.filterAutoGeneration;
    const entityMetadata = entityService?.getEntitySchema?.().model?.metadata;
    const entityFilterConfig = entityMetadata?.tableUI?.filterAutoGeneration;
    // Merge configs (entity > global > defaults)
    const mergedConfig = {
        enabled: entityFilterConfig?.enabled ?? globalFilterConfig?.enabled ?? true,
        dateFields: {
            ...globalFilterConfig?.dateFields,
            ...entityFilterConfig?.dateFields
        },
        enumFields: {
            ...globalFilterConfig?.enumFields,
            ...entityFilterConfig?.enumFields
        },
        booleanFields: {
            ...globalFilterConfig?.booleanFields,
            ...entityFilterConfig?.booleanFields
        },
        relationFields: {
            ...globalFilterConfig?.relationFields,
            ...entityFilterConfig?.relationFields
        },
        numberFields: {
            ...globalFilterConfig?.numberFields,
            ...entityFilterConfig?.numberFields
        },
        textFields: {
            ...globalFilterConfig?.textFields,
            ...entityFilterConfig?.textFields
        },
        debug: entityFilterConfig?.debug ?? globalFilterConfig?.debug ?? false
    };
    // If globally disabled, skip
    if (!mergedConfig.enabled) {
        return undefined;
    }
    const attrType = attribute.type;
    const fieldType = attribute.fieldType;
    // **1. Boolean fields**
    if (attrType === 'boolean' && mergedConfig.booleanFields?.enabled !== false) {
        return {
            filterType: 'boolean',
            defaultOperator: 'eq',
            availableOperators: ['eq', 'neq', 'isEmpty', 'isNull'],
            predefinedOptions: [
                { label: 'Yes', value: "true" },
                { label: 'No', value: "false" }
            ]
        };
    }
    // **2. Enum fields (array of strings/numbers)**
    if (Array.isArray(attrType) && mergedConfig.enumFields?.enabled !== false) {
        const defaultEnumOps = ['eq', 'neq', 'inList', 'notInList', 'isEmpty', 'isNull'];
        const defaultOp = mergedConfig.enumFields?.defaultOperator || ('eq');
        const availableOps = mergedConfig.enumFields?.availableOperators || defaultEnumOps;
        return {
            filterType: 'select',
            defaultOperator: defaultOp,
            availableOperators: availableOps,
            predefinedOptions: attrType.map(val => ({
                label: String(val),
                value: String(val) // Always convert to string for consistency
            }))
        };
    }
    // **3. Date/Datetime fields**
    if ((fieldType === 'date' || fieldType === 'datetime' || (attrType === 'string' && (attribute.id.toLowerCase().includes('date') || attribute.id.toLowerCase().includes('time'))))
        && mergedConfig.dateFields?.enabled !== false) {
        const defaultDateOps = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'isNull'];
        const operators = mergedConfig.dateFields?.defaultOperators || defaultDateOps;
        const filterConfig = {
            filterType: 'datetime',
            defaultOperator: operators[0] || ('gte'),
            availableOperators: operators
        };
        // Add quick date filters if enabled
        if (mergedConfig.dateFields?.quickFilters !== false) {
            filterConfig.predefinedOptions = [
                { label: 'Today', value: ':startOfToday' },
                { label: 'Yesterday', value: ':startOfYesterday' },
                { label: 'This Week', value: ':startOfWeek' },
                { label: 'Last Week', value: ':startOfLastWeek' },
                { label: 'This Month', value: ':startOfMonth' },
                { label: 'Last Month', value: ':startOfLastMonth' },
                { label: 'This Quarter', value: ':startOfQuarter' },
                { label: 'Last Quarter', value: ':startOfLastQuarter' },
                { label: 'This Year', value: ':startOfYear' },
                { label: 'Last Year', value: ':startOfLastYear' },
                { label: 'Last 7 Days', value: ':nowMinus7Days' },
                { label: 'Last 30 Days', value: ':nowMinus30Days' },
                { label: 'Last 90 Days', value: ':nowMinus90Days' },
                { label: 'Custom Date', value: null } // Triggers datetime-local input
            ];
        }
        return filterConfig;
    }
    // **5. Number fields**
    if (attrType === 'number' && mergedConfig.numberFields?.enabled !== false) {
        const defaultNumberOps = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'isNull'];
        const operators = mergedConfig.numberFields?.defaultOperators || defaultNumberOps;
        return {
            filterType: 'number',
            defaultOperator: operators[0] || ('eq'),
            availableOperators: operators
        };
    }
    // **4. Relation fields (without explicit options) - auto-generate from relation metadata**
    if (attribute.relation && mergedConfig.relationFields?.enabled !== false && entityService) {
        const relationConfig = { entityName: attribute.relation.entityName };
        const resolved = resolveRelationOptionConfig(relationConfig, attribute, entityService, globalUIConfigOptions);
        if (resolved) {
            return {
                filterType: 'relation',
                defaultOperator: 'eq',
                availableOperators: ['eq', 'neq', 'inList', 'notInList', 'isEmpty', 'isNull'],
                predefinedOptions: resolved
            };
        }
    }
    // **6. Text fields (default fallback)**
    if (attrType === 'string' && mergedConfig.textFields?.enabled !== false) {
        const defaultTextOps = ['contains', 'notContains', 'eq', 'neq', 'startsWith', 'endsWith', 'like', 'isEmpty', 'isNull'];
        const operators = mergedConfig.textFields?.defaultOperators || defaultTextOps;
        return {
            filterType: 'text',
            defaultOperator: operators[0] || ('contains'),
            availableOperators: operators
        };
    }
    // Debug logging
    if (mergedConfig.debug) {
        logging_1.DefaultLogger.info(`[FilterAutoGen] ${attribute.id}: No filter config generated (type: ${attrType})`);
    }
    return undefined;
}
// =======================================================================================
// SEGMENT AUTO-GENERATION
// =======================================================================================
/**
 * Smart icon mapping for segment values.
 * Provides sensible defaults for common status/state patterns.
 * Icons match ui24/src/core/common/Icons/Icons.tsx naming conventions.
 */
const DEFAULT_ICON_MAPPING = {
    // Active/Inactive patterns
    'active': 'CheckCircleOutlined',
    'inactive': 'CloseCircleOutlined',
    'enabled': 'CheckCircleOutlined',
    'disabled': 'CloseCircleOutlined',
    // Status patterns
    'pending': 'ClockCircleOutlined',
    'in-progress': 'SyncOutlined',
    'inprogress': 'SyncOutlined',
    'completed': 'CheckCircleOutlined',
    'done': 'CheckOutlined',
    'finished': 'CheckCircleOutlined',
    'cancelled': 'CloseCircleOutlined',
    'canceled': 'CloseCircleOutlined',
    'failed': 'CloseCircleOutlined',
    'error': 'ExclamationCircleOutlined',
    'paused': 'PauseCircleOutlined',
    // Scheduling patterns
    'scheduled': 'CalendarOutlined',
    'upcoming': 'CalendarOutlined',
    'live': 'PlayCircleOutlined',
    'draft': 'FileOutlined',
    'published': 'CheckCircleOutlined',
    'archived': 'FolderOutlined',
    // Priority patterns
    'low': 'DownOutlined',
    'medium': 'MinusOutlined',
    'high': 'UpOutlined',
    'critical': 'WarningOutlined',
    'urgent': 'FireOutlined',
    // Approval patterns
    'approved': 'CheckCircleOutlined',
    'rejected': 'CloseCircleOutlined',
    'review': 'EyeOutlined',
    // Boolean True/False
    'true': 'CheckCircleOutlined',
    'false': 'CloseCircleOutlined'
};
/**
 * Intelligently extract boolean labels from field name patterns.
 * Supports common boolean prefixes like is/has/can/should/will/etc.
 *
 * @example
 * - isActive → "Active" / "Inactive"
 * - hasPermission → "Has Permission" / "No Permission"
 * - canEdit → "Can Edit" / "Cannot Edit"
 * - isLive → "Live" / "Not Live"
 * - shouldNotify → "Should Notify" / "Should Not Notify"
 */
function extractBooleanLabelsFromFieldName(fieldName) {
    // Common boolean prefixes with their negative forms
    const patterns = [
        // Pattern: is + XXX
        {
            regex: /^is([A-Z][a-zA-Z0-9]*)/,
            getTrueLabel: (match) => (0, utils_1.toHumanReadableName)(match[1]),
            getFalseLabel: (match) => {
                const base = (0, utils_1.toHumanReadableName)(match[1]);
                // Special cases for better negation
                if (base.toLowerCase() === 'active')
                    return 'Inactive';
                if (base.toLowerCase() === 'enabled')
                    return 'Disabled';
                if (base.toLowerCase() === 'visible')
                    return 'Hidden';
                if (base.toLowerCase() === 'public')
                    return 'Private';
                if (base.toLowerCase() === 'available')
                    return 'Unavailable';
                return `Not ${base}`;
            }
        },
        // Pattern: has + XXX
        {
            regex: /^has([A-Z][a-zA-Z0-9]*)/,
            getTrueLabel: (match) => `Has ${(0, utils_1.toHumanReadableName)(match[1])}`,
            getFalseLabel: (match) => `No ${(0, utils_1.toHumanReadableName)(match[1])}`
        },
        // Pattern: can + XXX
        {
            regex: /^can([A-Z][a-zA-Z0-9]*)/,
            getTrueLabel: (match) => `Can ${(0, utils_1.toHumanReadableName)(match[1])}`,
            getFalseLabel: (match) => `Cannot ${(0, utils_1.toHumanReadableName)(match[1])}`
        },
        // Pattern: should + XXX
        {
            regex: /^should([A-Z][a-zA-Z0-9]*)/,
            getTrueLabel: (match) => `Should ${(0, utils_1.toHumanReadableName)(match[1])}`,
            getFalseLabel: (match) => `Should Not ${(0, utils_1.toHumanReadableName)(match[1])}`
        },
        // Pattern: will + XXX
        {
            regex: /^will([A-Z][a-zA-Z0-9]*)/,
            getTrueLabel: (match) => `Will ${(0, utils_1.toHumanReadableName)(match[1])}`,
            getFalseLabel: (match) => `Will Not ${(0, utils_1.toHumanReadableName)(match[1])}`
        },
        // Pattern: allows + XXX
        {
            regex: /^allows([A-Z][a-zA-Z0-9]*)/,
            getTrueLabel: (match) => `Allows ${(0, utils_1.toHumanReadableName)(match[1])}`,
            getFalseLabel: (match) => `Does Not Allow ${(0, utils_1.toHumanReadableName)(match[1])}`
        },
        // Pattern: needs + XXX
        {
            regex: /^needs([A-Z][a-zA-Z0-9]*)/,
            getTrueLabel: (match) => `Needs ${(0, utils_1.toHumanReadableName)(match[1])}`,
            getFalseLabel: (match) => `Does Not Need ${(0, utils_1.toHumanReadableName)(match[1])}`
        },
        // Pattern: requires + XXX
        {
            regex: /^requires([A-Z][a-zA-Z0-9]*)/,
            getTrueLabel: (match) => `Requires ${(0, utils_1.toHumanReadableName)(match[1])}`,
            getFalseLabel: (match) => `Does Not Require ${(0, utils_1.toHumanReadableName)(match[1])}`
        }
    ];
    for (const pattern of patterns) {
        const match = fieldName.match(pattern.regex);
        if (match) {
            return {
                trueLabel: pattern.getTrueLabel(match),
                falseLabel: pattern.getFalseLabel(match)
            };
        }
    }
    return null;
}
/**
 * Get the number of options for a field.
 */
function getFieldOptionCount(field) {
    // 1. Enum type array
    if (Array.isArray(field.type)) {
        return field.type.length;
    }
    // 2. Boolean field
    if (field.type === 'boolean') {
        return 2;
    }
    // 3. Select/radio/checkbox field with inline options
    const fieldType = field.fieldType;
    if (fieldType === 'select' || fieldType === 'radio' || fieldType === 'checkbox' || fieldType === 'multi-select') {
        const options = field.options;
        if (Array.isArray(options)) {
            return options.length;
        }
    }
    return 0;
}
/**
 * Check if a field is viable for segment generation.
 * Supports:
 * - Enum types: type: ['value1', 'value2']
 * - Boolean types: type: 'boolean'
 * - Select/radio/checkbox fields with options: fieldType: 'select' + options: [...]
 *
 * STRICTLY enforces: minValues <= optionCount <= maxSegmentsPerGroup
 */
function isViableSegmentField(field, config) {
    const maxValues = config.maxSegmentsPerGroup || 10;
    const optionCount = getFieldOptionCount(field);
    // Must have options AND be within bounds
    if (optionCount === 0) {
        return false;
    }
    // STRICT: Reject if outside bounds
    return optionCount >= config.minValues && optionCount <= maxValues;
}
/**
 * Intelligently detect the best field(s) for generating segments.
 * Returns multiple fields if maxSegmentGroups > 1.
 *
 * Priority:
 * 1. Explicit segmentFields (entity config) → Use those fields
 * 2. includeFields filter (entity config) → Only consider these
 * 3. excludeFields filter (entity config) → Skip these
 * 4. preferredFields (global/entity config) → Try these first
 * 5. Scoring algorithm → Score all candidates and pick top N
 */
function detectSegmentFields(properties, globalConfig, entityConfig) {
    const segmentConfig = entityConfig?.segmentAutoGeneration;
    // Merge configs (entity > global > defaults)
    const mergedConfig = {
        enabled: segmentConfig?.enabled ?? globalConfig?.enabled ?? true,
        preferredFields: segmentConfig?.preferredFields || globalConfig?.preferredFields || ['status', 'state', 'type', 'category', 'priority'],
        maxSegmentGroups: segmentConfig?.maxSegmentGroups ?? globalConfig?.maxSegmentGroups ?? 2,
        maxSegmentsPerGroup: segmentConfig?.maxSegmentsPerGroup ?? globalConfig?.maxSegmentsPerGroup ?? 10,
        minValues: segmentConfig?.minValues ?? globalConfig?.minValues ?? 2,
        iconMapping: { ...DEFAULT_ICON_MAPPING, ...globalConfig?.iconMapping, ...segmentConfig?.iconMapping },
        booleanLabelPatterns: segmentConfig?.booleanLabelPatterns || globalConfig?.booleanLabelPatterns || [],
        defaultBooleanLabels: segmentConfig?.defaultBooleanLabels || globalConfig?.defaultBooleanLabels || { true: 'Yes', false: 'No' },
        includeAllSegment: segmentConfig?.includeAllSegment ?? globalConfig?.includeAllSegment ?? true,
        debug: segmentConfig?.debug ?? globalConfig?.debug ?? false
    };
    if (!mergedConfig.enabled) {
        return [];
    }
    // === PRIORITY 1: Explicit segment fields ===
    const explicitFields = segmentConfig?.segmentFields || segmentConfig?.segmentField;
    if (explicitFields) {
        const fieldNames = typeof explicitFields === 'string' ? [explicitFields] : explicitFields;
        const results = [];
        for (const fieldName of fieldNames) {
            const field = Array.from(properties.values()).find(p => p.id === fieldName);
            if (field) {
                results.push({ field, score: 1000, reason: 'explicit configuration' });
            }
        }
        if (results.length > 0) {
            return results.slice(0, mergedConfig.maxSegmentGroups);
        }
    }
    // === Filter properties based on include/exclude ===
    let candidateProperties = Array.from(properties.values());
    // Apply includeFields filter (if provided, ONLY consider these)
    if (segmentConfig?.includeFields && segmentConfig.includeFields.length > 0) {
        candidateProperties = candidateProperties.filter(p => segmentConfig.includeFields.includes(p.id));
    }
    // Apply excludeFields filter
    if (segmentConfig?.excludeFields && segmentConfig.excludeFields.length > 0) {
        candidateProperties = candidateProperties.filter(p => !segmentConfig.excludeFields.includes(p.id));
    }
    // === PRIORITY 2: Preferred fields ===
    const preferredFields = mergedConfig.preferredFields;
    const preferredMatches = [];
    for (const preferredName of preferredFields) {
        const field = candidateProperties.find(p => p.id === preferredName);
        if (field && isViableSegmentField(field, mergedConfig)) {
            preferredMatches.push({ field, score: 900, reason: `preferred field: ${preferredName}` });
        }
    }
    // If we have enough preferred matches, return them
    if (preferredMatches.length >= mergedConfig.maxSegmentGroups) {
        return preferredMatches.slice(0, mergedConfig.maxSegmentGroups);
    }
    // === PRIORITY 3: Scoring algorithm ===
    const candidates = [];
    // Add preferredMatches with their option counts
    for (const pm of preferredMatches) {
        const optionCount = getFieldOptionCount(pm.field);
        candidates.push({ ...pm, optionCount });
    }
    for (const prop of candidateProperties) {
        // Skip if already in preferredMatches
        if (preferredMatches.some(pm => pm.field.id === prop.id)) {
            continue;
        }
        // Skip if not viable (this filters out fields with too many options)
        if (!isViableSegmentField(prop, mergedConfig)) {
            continue;
        }
        let score = 0;
        const reasons = [];
        const optionCount = getFieldOptionCount(prop);
        // **Score 1: Field name match** (partial match with preferred names)
        for (const preferred of preferredFields) {
            if (prop.id.toLowerCase().includes(preferred.toLowerCase())) {
                score += 50;
                reasons.push(`name contains "${preferred}"`);
                break;
            }
        }
        // **Score 2: Prefer fewer options (inverse scoring)**
        // Fields with fewer options get higher scores
        const minValues = mergedConfig.minValues;
        const maxValues = mergedConfig.maxSegmentsPerGroup;
        if (optionCount >= minValues && optionCount <= maxValues) {
            // Score inversely proportional to option count
            // 2 options = +40, 5 options = +25, 10 options = +10
            const optionScore = Math.max(10, 40 - (optionCount - minValues) * 3);
            score += optionScore;
            reasons.push(`${optionCount} options`);
        }
        // **Score 3: Boolean field gets high priority (only 2 options)**
        if (prop.type === 'boolean') {
            score += 5; // Small bonus since option count already factors in
            reasons.push('boolean field');
        }
        // **Score 4: Name position (earlier = slightly higher priority)**
        const fieldIndex = candidateProperties.indexOf(prop);
        score -= Math.min(fieldIndex, 5); // Cap penalty at 5
        candidates.push({
            field: prop,
            score,
            reason: reasons.join(', '),
            optionCount
        });
    }
    // Sort by: 1) score (highest first), 2) option count (lowest first)
    candidates.sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }
        return a.optionCount - b.optionCount; // Prefer fewer options
    });
    const topNResults = candidates.slice(0, mergedConfig.maxSegmentGroups);
    if (topNResults.length > 0 && mergedConfig.debug) {
        logging_1.DefaultLogger.info(`[SegmentDetection] Selected ${topNResults.length} field(s):`, topNResults.map(c => ({
            field: c.field.id,
            score: c.score,
            optionCount: c.optionCount,
            reason: c.reason
        })));
    }
    return topNResults;
}
/**
 * Auto-generate filter segments based on entity attributes using smart detection.
 *
 * Algorithm:
 * 1. If custom segments provided → use them (highest priority)
 * 2. If entity requires manual segments → skip auto-generation
 * 3. Detect best field using scoring algorithm
 * 4. Generate segments from detected field with smart icons
 */
function generateSegments(properties, entityService, globalUIConfigOptions, customSegments) {
    // 1. If custom segments provided, use those (highest priority)
    if (customSegments && customSegments.length > 0) {
        return customSegments;
    }
    // Get configuration
    const globalSegmentConfig = globalUIConfigOptions?.tableUI?.segmentAutoGeneration;
    const entityMetadata = entityService?.getEntitySchema?.().model?.metadata;
    const entitySegmentConfig = entityMetadata?.tableUI;
    // 2. If entity requires manual segments, skip auto-generation
    if (entitySegmentConfig?.segmentAutoGeneration?.requireManual) {
        return undefined;
    }
    // 3. Detect best segment fields (returns array now)
    const detectedFields = detectSegmentFields(properties, globalSegmentConfig, entitySegmentConfig);
    if (detectedFields.length === 0) {
        // No suitable fields found
        if (globalSegmentConfig?.debug || entitySegmentConfig?.segmentAutoGeneration?.debug) {
            logging_1.DefaultLogger.info(`[SegmentGeneration] No suitable fields detected for segments`);
        }
        return undefined;
    }
    // Get merged config for this entity
    const mergedConfig = {
        enabled: entitySegmentConfig?.segmentAutoGeneration?.enabled ?? globalSegmentConfig?.enabled ?? true,
        preferredFields: entitySegmentConfig?.segmentAutoGeneration?.preferredFields || globalSegmentConfig?.preferredFields || ['status', 'state', 'type', 'category', 'priority'],
        maxSegmentGroups: entitySegmentConfig?.segmentAutoGeneration?.maxSegmentGroups ?? globalSegmentConfig?.maxSegmentGroups ?? 2,
        maxSegmentsPerGroup: entitySegmentConfig?.segmentAutoGeneration?.maxSegmentsPerGroup ?? globalSegmentConfig?.maxSegmentsPerGroup ?? 10,
        minValues: entitySegmentConfig?.segmentAutoGeneration?.minValues ?? globalSegmentConfig?.minValues ?? 2,
        iconMapping: {
            ...DEFAULT_ICON_MAPPING,
            ...globalSegmentConfig?.iconMapping,
            ...entitySegmentConfig?.segmentAutoGeneration?.iconMapping
        },
        booleanLabelPatterns: entitySegmentConfig?.segmentAutoGeneration?.booleanLabelPatterns || globalSegmentConfig?.booleanLabelPatterns || [],
        defaultBooleanLabels: entitySegmentConfig?.segmentAutoGeneration?.defaultBooleanLabels || globalSegmentConfig?.defaultBooleanLabels || { true: 'Yes', false: 'No' },
        includeAllSegment: entitySegmentConfig?.segmentAutoGeneration?.includeAllSegment ?? globalSegmentConfig?.includeAllSegment ?? true,
        debug: entitySegmentConfig?.segmentAutoGeneration?.debug ?? globalSegmentConfig?.debug ?? false
    };
    if (mergedConfig.debug) {
        logging_1.DefaultLogger.info(`[SegmentGeneration] Generating segments for ${detectedFields.length} field(s):`, detectedFields.map(d => d.field.id));
    }
    // 4. Generate segment groups (one per detected field)
    const segmentGroups = [];
    for (const detection of detectedFields) {
        const { field } = detection;
        // Generate segments for this field
        const segments = [];
        // Add "All" segment if enabled
        if (mergedConfig.includeAllSegment) {
            segments.push({
                id: `all-${field.id}`,
                label: 'All',
                filters: {},
                default: true
            });
        }
        // Get values from field
        let values = [];
        let valueLabels = {}; // For custom boolean labels
        if (Array.isArray(field.type)) {
            // Enum type array
            values = field.type;
        }
        else if (field.type === 'boolean') {
            // Boolean field with optional custom labels
            values = [true, false];
            // 1. Check for explicit field-level booleanLabels
            const fieldBooleanLabels = 'booleanLabels' in field ? field.booleanLabels : undefined;
            if (fieldBooleanLabels && typeof fieldBooleanLabels === 'object') {
                valueLabels['true'] = fieldBooleanLabels.true || 'Yes';
                valueLabels['false'] = fieldBooleanLabels.false || 'No';
            }
            else {
                // 2. Try intelligent extraction from field name
                const fieldName = field.id;
                const extracted = extractBooleanLabelsFromFieldName(fieldName);
                if (extracted) {
                    valueLabels['true'] = extracted.trueLabel;
                    valueLabels['false'] = extracted.falseLabel;
                }
                else {
                    // 3. Try to match against configured patterns
                    const patterns = mergedConfig.booleanLabelPatterns;
                    let matched = false;
                    if (patterns && patterns.length > 0) {
                        for (const pattern of patterns) {
                            const regex = pattern.pattern instanceof RegExp
                                ? pattern.pattern
                                : new RegExp(pattern.pattern, 'i');
                            if (regex.test(fieldName)) {
                                valueLabels['true'] = pattern.trueLabel;
                                valueLabels['false'] = pattern.falseLabel;
                                matched = true;
                                break;
                            }
                        }
                    }
                    // 4. Use default fallback if no pattern matched
                    if (!matched) {
                        const defaults = mergedConfig.defaultBooleanLabels || { true: 'Yes', false: 'No' };
                        valueLabels['true'] = defaults.true;
                        valueLabels['false'] = defaults.false;
                    }
                }
            }
        }
        else if ((field.fieldType === 'select' || field.fieldType === 'radio' || field.fieldType === 'checkbox' || field.fieldType === 'multi-select') && Array.isArray(field.options)) {
            // Select/radio/checkbox field with inline options
            const options = field.options;
            values = options.map(opt => opt.value);
            // Store labels for later use
            options.forEach(opt => {
                valueLabels[String(opt.value)] = opt.label;
            });
        }
        // Apply field-specific value filters first, then global
        const includeValuesByField = entitySegmentConfig?.segmentAutoGeneration?.includeValuesByField;
        const includeValues = includeValuesByField?.[field.id] || entitySegmentConfig?.segmentAutoGeneration?.includeValues;
        if (includeValues) {
            values = values.filter(v => includeValues.includes(String(v)));
        }
        const excludeValuesByField = entitySegmentConfig?.segmentAutoGeneration?.excludeValuesByField;
        const excludeValues = excludeValuesByField?.[field.id] || entitySegmentConfig?.segmentAutoGeneration?.excludeValues;
        if (excludeValues) {
            values = values.filter(v => !excludeValues.includes(String(v)));
        }
        // Apply field-specific sort order first, then global
        const sortOrderByField = entitySegmentConfig?.segmentAutoGeneration?.sortOrderByField;
        const sortOrder = sortOrderByField?.[field.id] || entitySegmentConfig?.segmentAutoGeneration?.sortOrder;
        if (sortOrder) {
            values.sort((a, b) => {
                const aIndex = sortOrder.indexOf(String(a));
                const bIndex = sortOrder.indexOf(String(b));
                // If both in sortOrder, use that order
                if (aIndex >= 0 && bIndex >= 0) {
                    return aIndex - bIndex;
                }
                // If only one in sortOrder, it comes first
                if (aIndex >= 0)
                    return -1;
                if (bIndex >= 0)
                    return 1;
                // Neither in sortOrder, maintain original order
                return 0;
            });
        }
        // Generate segment for each value
        for (const value of values) {
            const valueStr = String(value);
            const valueLower = valueStr.toLowerCase();
            // Use custom label if available, otherwise format the value
            const segmentLabel = valueLabels[valueStr] || (0, utils_1.pascalCase)(valueStr);
            segments.push({
                id: `${field.id}-${valueLower.replace(/[^a-z0-9]+/g, '-')}`, // Unique ID
                label: segmentLabel, // Custom or formatted label
                icon: mergedConfig.iconMapping[valueLower], // Smart icon lookup
                filters: {
                    [field.id]: { eq: value }
                }
            });
        }
        // Only add group if we have segments
        const minSegments = mergedConfig.includeAllSegment ? 1 : 0;
        if (segments.length > minSegments) {
            // Auto-generate label or use explicit groupLabels
            const customGroupLabels = entitySegmentConfig?.segmentAutoGeneration?.groupLabels;
            const label = customGroupLabels?.[field.id] || `By ${(0, utils_1.pascalCase)(field.id)}`;
            segmentGroups.push({
                id: `${field.id}-group`,
                label,
                segments,
                defaultSegmentId: segments.find(s => s.default)?.id,
                maxVisible: mergedConfig.maxSegmentsPerGroup
            });
        }
    }
    // Return segment groups (or undefined if none generated)
    if (segmentGroups.length === 0) {
        return undefined;
    }
    // If only 1 group with simple config, return flat segments for backwards compatibility
    // This maintains legacy behavior when maxSegmentGroups = 1
    if (segmentGroups.length === 1 && mergedConfig.maxSegmentGroups === 1) {
        return segmentGroups[0].segments;
    }
    return segmentGroups;
}
// =======================================================================================
// ENTITY ATTRIBUTE FORMATTING
// =======================================================================================
/**
 * Formats a single entity attribute for form or detail page display.
 *
 * Transforms schema attributes into UI-ready field configurations with proper field types,
 * relation configs, options, visibility, and validation rules. Auto-generates relation
 * display configurations and filter configs when not explicitly provided.
 *
 * @param thisProp - The entity attribute to format
 * @param type - Page type: 'create', 'update', or 'detail'
 * @param entityService - Entity service for accessing related schemas
 * @param allProperties - Optional array of all properties for detecting duplicated relation fields
 * @param globalUIConfigOptions - Optional global UI configuration options
 * @returns Formatted field metadata ready for UI rendering
 *
 * @example
 * ```typescript
 * const formattedField = formatEntityAttributeForFormOrDetail(
 *   {
 *     id: 'teamId',
 *     name: 'teamId',
 *     type: 'string',
 *     relation: { type: 'one', entity: 'team' }
 *   },
 *   'create',
 *   entityService
 * );
 * // Returns field with relationConfig, filterConfig, and proper field type
 * ```
 */
function formatEntityAttributeForFormOrDetail(thisProp, type, entityService, allProperties, // Optional: for detecting duplicated relation fields
globalUIConfigOptions // Optional: global UI config options
) {
    const formatted = {
        ...thisProp,
        label: thisProp.name, // Respect custom label from entity attribute
        column: thisProp.id,
        fieldType: thisProp.fieldType || 'text', // fieldType should already be inferred in base-service
        hidden: thisProp.hasOwnProperty('isVisible') && !thisProp.isVisible
    };
    // Handle addNewOption (OLD - deprecated, generates embedded config) or addNewOptionConfig (NEW - just pass through reference)
    if ((0, entity_1.isSelectFieldMetadata)(thisProp) && ['create', 'update'].includes(type)) {
        const selectField = thisProp;
        if (selectField.addNewOptionConfig) {
            // NEW WAY: User provided addNewOptionConfig reference - just pass it through
            formatted['addNewOptionConfig'] = selectField.addNewOptionConfig;
        }
        else if (selectField.addNewOption) {
            // OLD WAY (DEPRECATED): Transform addNewOption to addNewOptionConfig for backward compatibility
            const { entityName, overrideConfig } = selectField.addNewOption;
            if (entityName && entityService.hasEntityServiceByEntityName(entityName)) {
                formatted['addNewOptionConfig'] = {
                    entityName: entityName,
                    pageType: 'create',
                    overrideConfig: overrideConfig || {
                        submitSuccessRedirect: undefined, // Stay in modal after creation
                        formButtons: [
                            { text: "Add", action: "submit" },
                            { text: "Cancel", action: "cancel" }
                        ]
                    }
                };
            }
            else {
                logging_1.DefaultLogger.warn(`formatEntityAttributeForFormOrDetail: Could not find related-entity-service for entity [${entityName}] in ${entityService.constructor.name}`);
            }
        }
    }
    // Handle relation fields (DATA LAYER + UI LAYER)
    if (thisProp.relation && type === 'detail') {
        const relation = thisProp.relation;
        const { entityName, type: relationType, identifiers } = relation;
        const entityNameLower = entityName.toLowerCase();
        if (!entityService.hasEntityServiceByEntityName(entityName)) {
            logging_1.DefaultLogger.warn(`formatEntityAttributeForFormOrDetail: Could not find related-entity-service for entity [${entityName}] in ${entityService.constructor.name}`);
            return formatted;
        }
        // Resolve identifiers (could be direct value or lazy function)
        const resolvedIdentifiers = typeof identifiers === 'function' ? identifiers() : identifiers;
        // Safety check for array identifiers
        if (Array.isArray(resolvedIdentifiers)) {
            if (resolvedIdentifiers.length === 0) {
                logging_1.DefaultLogger.warn(`formatEntityAttributeForFormOrDetail: Empty identifiers array for relation [${entityName}]`);
                return formatted;
            }
        }
        // Handle both single and multiple identifiers for composite keys
        const identifierMappings = Array.isArray(resolvedIdentifiers)
            ? resolvedIdentifiers.map(id => ({
                source: String(id.source),
                target: String(id.target)
            }))
            : [{
                    source: String(resolvedIdentifiers.source),
                    target: String(resolvedIdentifiers.target)
                }];
        // For route pattern and default filters, use the first identifier
        // (most entities have single identifier; composite keys need explicit routePattern)
        const primaryIdentifier = identifierMappings[0];
        // Check if user provided custom UI config in relationConfig (optional override)
        const userRelationConfig = thisProp.relationConfig;
        // Get related entity service for metadata (icon, etc.)
        const relatedEntityService = entityService.hasEntityServiceByEntityName(entityName)
            ? entityService.getEntityServiceByEntityName(entityName)
            : undefined;
        // Get entity metadata for icon and fallback generation
        const relatedEntityMetadata = relatedEntityService?.getEntitySchema?.().model;
        const defaultIcon = relatedEntityMetadata?.metadata?.icon;
        if (relationType.endsWith('to-one')) {
            // TO-ONE: Show value as link + modal icon
            // Route pattern: Use custom (from relationConfig) or default to /view-{entity}/:targetId
            const routePattern = userRelationConfig?.routePattern
                || `/view-${entityNameLower}/:${primaryIdentifier.target}`;
            // Generate fallback configuration for when only ID is available
            const fallbackConfig = generateRelationFallback(entityName, primaryIdentifier.source, relatedEntityService);
            // Auto-detect duplicated relation field (e.g., teamName for teamId)
            // NEW: Use enhanced detection with config support
            let autoTemplate = undefined;
            let detectionMetadata = undefined;
            // Check if auto-detection is enabled (default: true)
            const autoDetectEnabled = userRelationConfig?.displayConfig?.autoDetect !== false;
            if (autoDetectEnabled && allProperties) {
                // Get global config (passed from fw24 initialization)
                const globalConfig = globalUIConfigOptions?.duplicatedFieldDetection;
                // Get entity-level config from entity metadata
                const entityConfig = relatedEntityMetadata?.metadata?.duplicatedFieldDetection;
                // Get relation-level hints
                const relationHints = userRelationConfig?.displayConfig?.autoDetectHints;
                // Run enhanced detection
                const detectionResult = detectDuplicatedRelationFields(allProperties, thisProp.id, entityName, globalConfig, entityConfig, relationHints);
                if (detectionResult) {
                    autoTemplate = detectionResult.template;
                    // Store metadata for debugging and future features
                    detectionMetadata = {
                        detectedFields: {
                            primary: detectionResult.primaryField,
                            alternatives: detectionResult.detectedFields.display?.slice(1),
                            visual: detectionResult.detectedFields.visual,
                            meta: detectionResult.detectedFields.meta
                        },
                        confidence: detectionResult.confidence,
                        method: detectionResult.method,
                        pattern: detectionResult.pattern
                    };
                }
            }
            const generatedRelationConfig = {
                routePattern: routePattern,
                // Pass ALL identifier mappings (supports composite keys)
                identifierMapping: identifierMappings.length === 1
                    ? identifierMappings[0] // Single: return object
                    : identifierMappings, // Multiple: return array
                modalConfigRef: userRelationConfig?.modalConfigRef || {
                    entityName: entityName,
                    pageType: 'view',
                    overrideConfig: {}
                },
                modalWidth: userRelationConfig?.modalWidth,
                modalTitle: userRelationConfig?.modalTitle,
                displayConfig: {
                    // Priority: User custom template > Auto-detected duplicated field > undefined (use fallback)
                    template: userRelationConfig?.displayConfig?.template || autoTemplate,
                    // Smart fallback pre-generated from entity metadata
                    fallback: userRelationConfig?.displayConfig?.fallback || fallbackConfig,
                    // Icon from entity metadata or user override
                    icon: userRelationConfig?.displayConfig?.icon || defaultIcon || 'EyeOutlined',
                    showModalIcon: userRelationConfig?.displayConfig?.showModalIcon !== false,
                    showLink: userRelationConfig?.displayConfig?.showLink !== false,
                    // Pass through autoDetect and autoDetectHints
                    autoDetect: userRelationConfig?.displayConfig?.autoDetect,
                    autoDetectHints: userRelationConfig?.displayConfig?.autoDetectHints,
                    // Pass through any custom actions
                    actions: userRelationConfig?.displayConfig?.actions
                }
            };
            if (globalUIConfigOptions?.duplicatedFieldDetection?.debug) {
                generatedRelationConfig.displayConfig['_detectionMetadata'] = detectionMetadata;
            }
            formatted['relationConfig'] = generatedRelationConfig;
            // Backward compatibility: Keep isLink and linkConfig
            formatted['isLink'] = true;
            formatted['linkConfig'] = {
                routePattern: routePattern
            };
        }
        else if (relationType.endsWith('to-many')) {
            // TO-MANY: Show count + modal icon (opens filtered list)
            // Route pattern: Use custom (from relationConfig) or default to /list-{entity}
            const routePattern = userRelationConfig?.routePattern
                || `/list-${entityNameLower}`;
            // Build default filters to show only related items
            // For example, if we're viewing a Team and this field shows Games,
            // we want to filter games where teamId = current team's ID
            // For composite keys, add all identifiers as filters
            const defaultFilters = {};
            identifierMappings.forEach(mapping => {
                defaultFilters[mapping.target] = `:${mapping.source}`;
            });
            // Generate fallback configuration for to-many (shows count)
            const fallbackConfig = generateRelationFallback(entityName, primaryIdentifier.source, relatedEntityService);
            const generatedRelationConfig = {
                routePattern: routePattern,
                // Pass ALL identifier mappings (supports composite keys)
                identifierMapping: identifierMappings.length === 1
                    ? identifierMappings[0] // Single: return object
                    : identifierMappings, // Multiple: return array
                modalConfigRef: userRelationConfig?.modalConfigRef || {
                    entityName: entityName,
                    pageType: 'list',
                    overrideConfig: {
                        defaultFilters: defaultFilters
                    }
                },
                modalWidth: userRelationConfig?.modalWidth,
                modalTitle: userRelationConfig?.modalTitle,
                displayConfig: {
                    // User can override with custom template
                    template: userRelationConfig?.displayConfig?.template,
                    // Smart fallback pre-generated from entity metadata
                    fallback: userRelationConfig?.displayConfig?.fallback || fallbackConfig,
                    // Icon from entity metadata or user override
                    icon: userRelationConfig?.displayConfig?.icon || defaultIcon || 'UnorderedListOutlined',
                    showModalIcon: userRelationConfig?.displayConfig?.showModalIcon !== false,
                    showLink: userRelationConfig?.displayConfig?.showLink !== true, // Default false for to-many
                    // Pass through any custom actions
                    actions: userRelationConfig?.displayConfig?.actions
                }
            };
            // If user provided custom modalConfigRef, merge default filters with their overrides
            if (userRelationConfig?.modalConfigRef?.overrideConfig) {
                generatedRelationConfig.modalConfigRef.overrideConfig = {
                    ...userRelationConfig.modalConfigRef.overrideConfig,
                    defaultFilters: {
                        ...defaultFilters,
                        ...(userRelationConfig.modalConfigRef.overrideConfig.defaultFilters || {})
                    }
                };
            }
            formatted['relationConfig'] = generatedRelationConfig;
        }
    }
    // Handle nested structures (map and list types)
    if (thisProp.type === 'map' && thisProp.properties) {
        formatted['properties'] = formatEntityAttributesForFormOrDetail(thisProp.properties, type, entityService);
    }
    else if (thisProp.type === 'list') {
        // For list types, check if items are maps (nested structures)
        // Note: items property exists on list-type attributes but not in base EntityAttribute type
        const extendedProp = thisProp;
        if (extendedProp.items?.type === 'map' && extendedProp.items.properties) {
            formatted['items'] = {
                ...formatted['items'],
                properties: formatEntityAttributesForFormOrDetail(extendedProp.items.properties, type, entityService)
            };
        }
    }
    // TODO: add support for set, enum, and custom-types
    return formatted;
}
/**
 * Routes attribute formatting to the appropriate type-specific formatter.
 *
 * Convenience function that delegates to formatEntityAttributesForCreate,
 * formatEntityAttributesForUpdate, or formatEntityAttributesForDetail based on type.
 *
 * @param properties - Array of entity attributes to format
 * @param type - Page type: 'create', 'update', or 'detail'
 * @param entityService - Entity service for accessing schemas
 * @returns Array of formatted field metadata
 * @throws Error if invalid type is provided
 */
function formatEntityAttributesForFormOrDetail(properties, type, entityService) {
    if (type === 'create') {
        return formatEntityAttributesForCreate(properties, entityService);
    }
    if (type === 'update') {
        return formatEntityAttributesForUpdate(properties, entityService);
    }
    if (type === 'detail') {
        return formatEntityAttributesForDetail(properties, entityService);
    }
    throw (`Invalid type [${type}] provided to formatEntityAttributesForFormOrDetail`);
}
/**
 * Formats entity attributes for create form pages.
 *
 * Filters attributes to include only creatable fields (respects isCreatable flag)
 * and formats each for create form display.
 *
 * @param properties - Array of entity attributes from schema
 * @param entityService - Entity service for accessing related schemas
 * @param globalUIConfigOptions - Optional global UI configuration options
 * @returns Array of formatted field metadata for create forms
 */
function formatEntityAttributesForCreate(properties, entityService, globalUIConfigOptions) {
    return properties
        .filter(prop => prop && (!prop.hasOwnProperty('isCreatable') || prop.isCreatable))
        .map((att) => formatEntityAttributeForFormOrDetail(att, 'create', entityService, properties, globalUIConfigOptions));
}
/**
 * Formats entity attributes for update/edit form pages.
 *
 * Filters attributes to include only editable fields (respects isEditable flag)
 * and formats each for update form display.
 *
 * @param properties - Array of entity attributes from schema
 * @param entityService - Entity service for accessing related schemas
 * @param globalUIConfigOptions - Optional global UI configuration options
 * @returns Array of formatted field metadata for update forms
 */
function formatEntityAttributesForUpdate(properties, entityService, globalUIConfigOptions) {
    return properties
        .filter(prop => prop && (!prop.hasOwnProperty('isEditable') || prop.isEditable))
        .map((att) => formatEntityAttributeForFormOrDetail(att, 'update', entityService, properties, globalUIConfigOptions));
}
/**
 * Formats entity attributes for detail/view pages.
 *
 * Filters attributes to include only visible fields (respects isVisible flag)
 * and formats each for detail page display.
 *
 * @param properties - Array of entity attributes from schema
 * @param entityService - Entity service for accessing related schemas
 * @param globalUIConfigOptions - Optional global UI configuration options
 * @returns Array of formatted field metadata for detail views
 */
function formatEntityAttributesForDetail(properties, entityService, globalUIConfigOptions) {
    return properties
        .filter(prop => prop && (!prop.hasOwnProperty('isVisible') || prop.isVisible))
        .map((att) => formatEntityAttributeForFormOrDetail(att, 'detail', entityService, properties, globalUIConfigOptions));
}
/**
 * Formats entity attributes for list/table display.
 *
 * Transforms schema attributes into table column configurations with:
 * - Auto-generated filter configurations for filterable columns
 * - Relation display configurations with links and modal support
 * - Template-based rendering for duplicated relation fields
 * - Proper field types and visibility handling
 *
 * This is the main entry point for generating table column configurations from entity schemas.
 *
 * @param entityName - Name of the entity (for generating route patterns)
 * @param properties - Array of entity attributes from schema
 * @param entityService - Entity service for accessing related schemas
 * @param globalUIConfigOptions - Optional global UI configuration options
 * @returns Array of formatted column configurations for table display
 *
 * @example
 * ```typescript
 * const columns = formatEntityAttributesForList(
 *   'game',
 *   gameSchema.attributes,
 *   gameService,
 *   globalConfig
 * );
 * // Returns array of column configs with filters, relations, and templates
 * ```
 */
function formatEntityAttributesForList(entityName, properties, entityService, { CRUDApiPath, excludeFromAdminUpdate, excludeFromAdminDelete, excludeFromAdminDetail, customRowActions, globalUIConfigOptions }) {
    const entityNameLower = entityName.toLowerCase();
    const entityNamePascalCase = (0, utils_1.pascalCase)(entityName);
    return properties
        .filter(prop => prop && prop.isListable)
        .map(prop => {
        // Use same formatting logic as details/forms (includes relationConfig generation)
        // Pass all properties so it can detect duplicated relation fields (e.g., teamName for teamId)
        const formatted = formatEntityAttributeForFormOrDetail(prop, 'detail', entityService, properties, globalUIConfigOptions);
        // Auto-generate filterConfig if not already present and field is filterable
        const autoGeneratedFilterConfig = !formatted.filterConfig && prop.isFilterable !== false
            ? generateFilterConfig(prop, entityService, globalUIConfigOptions)
            : undefined;
        // Override/add list-specific properties
        const propConfig = {
            ...formatted,
            name: formatted.label || formatted.name, // Ensure name is set for table column header
            dataIndex: `${prop.id}`,
            fieldType: formatted.fieldType || 'text',
            filterConfig: formatted.filterConfig || autoGeneratedFilterConfig, // Use explicit or auto-generated
            hidden: prop.hasOwnProperty('isVisible') && !prop.isVisible
        };
        if (prop.isIdentifier) {
            // Build default row actions with IDs
            const defaultActions = [];
            if (!excludeFromAdminDetail) {
                defaultActions.push({
                    id: 'view',
                    icon: 'view',
                    label: 'View',
                    template: `View {${prop.id}}`,
                    url: `/view-${entityNameLower}`
                });
            }
            if (!excludeFromAdminUpdate) {
                defaultActions.push({
                    id: 'edit',
                    icon: 'edit',
                    label: 'Edit',
                    template: `Edit {${prop.id}}`,
                    url: `/edit-${entityNameLower}`
                });
            }
            if (!excludeFromAdminDelete) {
                defaultActions.push({
                    id: 'delete',
                    icon: 'delete',
                    label: 'Delete',
                    template: `Delete {${prop.id}}`,
                    openInModal: true,
                    modalConfig: {
                        modalType: 'confirm',
                        modalPageConfig: {
                            title: `Delete ${entityNamePascalCase}?`,
                            content: `Are you sure you want to delete this ${entityNamePascalCase}? This action cannot be undone.`
                        },
                        apiConfig: {
                            apiMethod: `DELETE`,
                            responseKey: entityNameLower,
                            apiUrl: `${CRUDApiPath ? CRUDApiPath : ''}/${entityNameLower}`,
                        },
                        successMessage: `${entityNamePascalCase} deleted successfully`,
                        errorMessage: `Failed to delete ${entityNamePascalCase}`,
                        submitSuccessRedirect: `/list-${entityNameLower}`
                    }
                });
            }
            // Merge custom row actions using identifier-based override
            propConfig.actions = customRowActions
                ? mergeActions(defaultActions, customRowActions)
                : defaultActions;
        }
        return propConfig;
    });
}
/**
 * MERGE UTILITY FUNCTIONS
 *
 * These functions implement the identifier-based override pattern:
 * - Defaults have standard identifiers (e.g., 'view', 'edit', 'delete')
 * - Custom configs with same identifier override the default
 * - New identifiers get added to the result
 */
/**
 * Merge default buttons with custom buttons using identifier-based override.
 *
 * @param defaults - Default buttons (from generator)
 * @param customs - Custom buttons (from entity schema)
 * @returns Merged button array
 */
/**
 * Merges default buttons with custom buttons using ID-based override logic.
 *
 * Custom buttons with matching IDs override defaults, and new custom buttons are appended.
 * Buttons without IDs are always included (no deduplication).
 *
 * @template T - Button type with optional id property
 * @param defaults - Default button configurations
 * @param customs - Custom button configurations to merge
 * @returns Merged array with custom overrides applied
 *
 * @example
 * ```typescript
 * const defaults = [
 *   { id: 'save', label: 'Save', action: 'submit' },
 *   { id: 'cancel', label: 'Cancel', action: 'cancel' }
 * ];
 * const customs = [
 *   { id: 'save', label: 'Save Changes', action: 'submit' }, // Override
 *   { id: 'delete', label: 'Delete', action: 'delete' }      // New
 * ];
 * const merged = mergeButtons(defaults, customs);
 * // Returns: [
 * //   { id: 'save', label: 'Save Changes', action: 'submit' },
 * //   { id: 'cancel', label: 'Cancel', action: 'cancel' },
 * //   { id: 'delete', label: 'Delete', action: 'delete' }
 * // ]
 * ```
 */
function mergeButtons(defaults, customs = []) {
    const customsArray = [...customs]; // Convert to mutable array
    const customMap = new Map(customsArray.filter(c => c.id).map(c => [c.id, c]));
    // Start with defaults, replace if custom has same id
    const merged = defaults.map(defaultBtn => defaultBtn.id && customMap.has(defaultBtn.id)
        ? customMap.get(defaultBtn.id) // Override
        : defaultBtn);
    // Add custom buttons that don't override defaults
    customsArray.forEach(customBtn => {
        if (!customBtn.id || !defaults.some(d => d.id === customBtn.id)) {
            merged.push(customBtn); // Add new
        }
    });
    return merged;
}
/**
 * Merges default actions with custom actions using ID-based override logic.
 *
 * Delegates to mergeButtons with the same behavior: custom actions with matching IDs
 * override defaults, and new custom actions are appended. Semantically named for row/table actions.
 *
 * @template T - Action type with optional id property
 * @param defaults - Default action configurations
 * @param customs - Custom action configurations to merge
 * @returns Merged array with custom overrides applied
 *
 * @example
 * ```typescript
 * const defaults = [
 *   { id: 'edit', label: 'Edit', action: 'edit' },
 *   { id: 'delete', label: 'Delete', action: 'delete' }
 * ];
 * const customs = [
 *   { id: 'delete', label: 'Remove', action: 'delete', confirm: true } // Override
 * ];
 * const merged = mergeActions(defaults, customs);
 * // Returns: [
 * //   { id: 'edit', label: 'Edit', action: 'edit' },
 * //   { id: 'delete', label: 'Remove', action: 'delete', confirm: true }
 * // ]
 * ```
 */
function mergeActions(defaults, customs = []) {
    return mergeButtons(defaults, [...customs]); // Spread to handle both readonly and mutable
}
/**
 * Merges field-level visibility, enablement, help text, and placeholder overrides into base properties.
 *
 * Applies custom field configurations from form/detail config to base schema properties.
 * Only merges overrides for fields that exist in base properties (warns about non-existent fields).
 *
 * @template T - Property type with required name field
 * @param baseProperties - Base field properties from entity schema
 * @param fieldOverrides - Custom field overrides from form/detail configuration
 * @returns Base properties with overrides merged in
 *
 * @example
 * ```typescript
 * const baseProps = [
 *   { name: 'email', type: 'string', required: true },
 *   { name: 'bio', type: 'string', required: false }
 * ];
 * const overrides = [
 *   { name: 'email', helpText: 'Enter a valid email address' },
 *   { name: 'bio', visibility: { create: false } }
 * ];
 * const merged = mergeFieldVisibility(baseProps, overrides);
 * // Returns baseProps with helpText and visibility merged
 * ```
 */
function mergeFieldVisibility(baseProperties, fieldOverrides = []) {
    const overrideMap = new Map([...fieldOverrides].map(f => [f.name, f]));
    // Validation: Warn if field override references non-existent field
    fieldOverrides.forEach(override => {
        if (!baseProperties.some(p => p.name === override.name)) {
            logging_1.DefaultLogger.warn(`Field override "${override.name}" not found in schema properties. This override will be ignored.`);
        }
    });
    return baseProperties.map(prop => {
        const override = overrideMap.get(prop.name);
        if (!override)
            return prop;
        return {
            ...prop,
            ...(override.visibility !== undefined && { visibility: override.visibility }),
            ...(override.enablement !== undefined && { enablement: override.enablement }),
            ...(override.helpText !== undefined && { helpText: override.helpText }),
            ...(override.placeholder !== undefined && { placeholder: override.placeholder })
        };
    });
}
/**
 * Merges column-level visibility, width, fixed position, and grouping overrides into base properties.
 *
 * Applies custom column configurations from table config to base schema properties.
 * Only merges overrides for columns that exist in base properties (warns about non-existent columns).
 *
 * @template T - Property type with required name field
 * @param baseProperties - Base column properties from entity schema
 * @param columnOverrides - Custom column overrides from table configuration
 * @returns Base properties with overrides merged in
 *
 * @example
 * ```typescript
 * const baseProps = [
 *   { name: 'name', type: 'string' },
 *   { name: 'email', type: 'string' },
 *   { name: 'status', type: 'string' }
 * ];
 * const overrides = [
 *   { field: 'name', width: 200, fixed: 'left' },
 *   { field: 'email', visibility: { list: false } },
 *   { field: 'status', groupTitle: 'Account Status' }
 * ];
 * const merged = mergeColumnVisibility(baseProps, overrides);
 * // Returns baseProps with width, fixed, visibility, and groupTitle merged
 * ```
 */
function mergeColumnVisibility(baseProperties, columnOverrides = []) {
    const overrideMap = new Map([...columnOverrides].map(c => [c.field, c]));
    // Validation: Warn if column override references non-existent column
    columnOverrides.forEach(override => {
        if (!baseProperties.some(p => p.name === override.field)) {
            logging_1.DefaultLogger.warn(`Column override "${override.field}" not found in schema properties. This override will be ignored.`);
        }
    });
    return baseProperties.map(prop => {
        const override = overrideMap.get(prop.name);
        if (!override)
            return prop;
        return {
            ...prop,
            ...(override.visibility !== undefined && { visibility: override.visibility }),
            ...(override.width !== undefined && { width: override.width }),
            ...(override.fixed !== undefined && { fixed: override.fixed }),
            ...(override.groupTitle !== undefined && { groupTitle: override.groupTitle })
        };
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy91aS1jb25maWctZ2VuL3RlbXBsYXRlcy91dGlsLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBMGlCQSw0REFnQkM7QUEwTUQsa0VBNERDO0FBb0JELG9EQXlOQztBQXVYRCw0Q0F1TkM7QUFtQ0Qsb0ZBc1JDO0FBY0Qsc0ZBa0JDO0FBYUQsMEVBSUM7QUFhRCwwRUFJQztBQWFELDBFQUlDO0FBZ0RELHNFQXVHQztBQStDRCxvQ0F3QkM7QUE2QkQsb0NBS0M7QUEyQkQsb0RBd0NDO0FBNkJELHNEQXdDQztBQS80RUQseUNBWXNCO0FBRXRCLHlDQUE4QztBQUU5QywyQ0FBOEM7QUFDOUMsdUNBQThEO0FBa0Q5RDs7R0FFRztBQUNIOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBbUJHO0FBQ0gsTUFBTSx3QkFBd0IsR0FBOEM7SUFDeEUsT0FBTyxFQUFFLElBQUk7SUFDYixRQUFRLEVBQUU7UUFDTiw0Q0FBNEM7UUFDNUMsT0FBTyxFQUFFLENBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsYUFBYSxDQUFFO1FBQ3BELDRDQUE0QztRQUM1QyxNQUFNLEVBQUUsQ0FBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsU0FBUyxDQUFFO1FBQ3hELHdDQUF3QztRQUN4QyxJQUFJLEVBQUUsQ0FBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxZQUFZLEVBQUUsVUFBVSxDQUFFO0tBQzVEO0lBQ0QsUUFBUSxFQUFFO1FBQ04sMENBQTBDO1FBQzFDLFFBQVEsRUFBRSxPQUFPO1FBQ2pCLFFBQVEsRUFBRSxRQUFRLEVBQUUsYUFBYTtRQUNqQyxTQUFTLEVBQUUsV0FBVyxFQUFFLFVBQVU7UUFDbEMsTUFBTSxFQUFFLFdBQVcsRUFBRSxVQUFVO1FBQy9CLE9BQU8sRUFBRSxTQUFTLEVBQUUsVUFBVTtRQUM5QixPQUFPLEVBQUUsUUFB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QUUsUUFBUSxDQUFDLEtBQUssRUFBRSxDQUFDO1lBQzlELEdBQUcsQ0FBQyxRQUFRLENBQUMsS0FBSyxLQUFLLFNBQVMsSUFBSSxFQUFFLEtBQUssRUFBRSxRQUFRLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDOUQsR0FBRyxDQUFDLFFBQVEsQ0FBQyxVQUFVLEtBQUssU0FBUyxJQUFJLEVBQUUsVUFBVSxFQUFFLFFBQVEsQ0FBQyxVQUFVLEVBQUUsQ0FBQztTQUNoRixDQUFDO0lBQ04sQ0FBQyxDQUFDLENBQUM7QUFDUCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtcbiAgICBCYXNlRW50aXR5U2VydmljZSxcbiAgICBGaWVsZE1ldGFkYXRhLFxuICAgIFRJT1NjaGVtYUF0dHJpYnV0ZSxcbiAgICBpc1NlbGVjdEZpZWxkTWV0YWRhdGEsXG4gICAgU2VsZWN0RmllbGRNZXRhZGF0YSxcbiAgICBFbnRpdHlBdHRyaWJ1dGUsXG4gICAgSVJlbGF0aW9uRmllbGRDb25maWcsXG4gICAgVElPU2NoZW1hQXR0cmlidXRlc01hcCxcbiAgICBFbnRpdHlTY2hlbWEsXG4gICAgSUZpbHRlclNlZ21lbnQsXG4gICAgY3JlYXRlRmllbGRPcHRpb25zXG59IGZyb20gXCIuLi8uLi9lbnRpdHlcIjtcbmltcG9ydCB0eXBlIHsgUmVsYXRpb25FbnRpdHlPcHRpb25Db25maWcsIEZpZWxkT3B0aW9uc0FQSUNvbmZpZywgSUVudGl0eVBhZ2VBY3Rpb24sIFRlbXBsYXRlLCBGaWVsZE9wdGlvbiwgSUZpbHRlclNlZ21lbnRHcm91cCB9IGZyb20gJy4uLy4uL2VudGl0eS9iYXNlLWVudGl0eSc7XG5pbXBvcnQgeyBGcmFtZXdvcmtFcnJvciB9IGZyb20gXCIuLi8uLi9lcnJvcnNcIjtcbmltcG9ydCB0eXBlIHsgSUFwcGxpY2F0aW9uQ29uZmlnLCBJRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uQ29uZmlnLCBJU2VnbWVudEF1dG9HZW5lcmF0aW9uQ29uZmlnIH0gZnJvbSAnLi4vLi4vaW50ZXJmYWNlcy9jb25maWcnO1xuaW1wb3J0IHsgRGVmYXVsdExvZ2dlciB9IGZyb20gXCIuLi8uLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBwYXNjYWxDYXNlLCB0b0h1bWFuUmVhZGFibGVOYW1lIH0gZnJvbSBcIi4uLy4uL3V0aWxzXCI7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU01BUlQgRFVQTElDQVRFRCBGSUVMRCBERVRFQ1RJT04gLSBFTkhBTkNFRCBBTEdPUklUSE1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIERldGVjdGlvbiByZXN1bHQgd2l0aCByaWNoIG1ldGFkYXRhXG4gKi9cbmludGVyZmFjZSBEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25SZXN1bHQge1xuICAgIC8qKiBQcmltYXJ5IGRpc3BsYXkgZmllbGQgZGV0ZWN0ZWQgKGUuZy4sICd0ZWFtTmFtZScpICovXG4gICAgcHJpbWFyeUZpZWxkPzogc3RyaW5nO1xuXG4gICAgLyoqIEdlbmVyYXRlZCB0ZW1wbGF0ZSBzdHJpbmcgKGUuZy4sICd7dGVhbU5hbWV9JyBvciAne3RlYW1OYW1lfSAoe3RlYW1Db2RlfSknKSAqL1xuICAgIHRlbXBsYXRlPzogc3RyaW5nO1xuXG4gICAgLyoqIEFsbCBkZXRlY3RlZCBmaWVsZHMgYnkgY2F0ZWdvcnkgKi9cbiAgICBkZXRlY3RlZEZpZWxkczoge1xuICAgICAgICAvKiogRGlzcGxheSBmaWVsZHM6IE5hbWUsIFRpdGxlLCBMYWJlbCAqL1xuICAgICAgICBkaXNwbGF5Pzogc3RyaW5nW107XG4gICAgICAgIC8qKiBWaXN1YWwgZmllbGRzOiBMb2dvLCBJbWFnZSwgSWNvbiAqL1xuICAgICAgICB2aXN1YWw/OiBzdHJpbmdbXTtcbiAgICAgICAgLyoqIE1ldGEgZmllbGRzOiBDb2RlLCBTbHVnLCBLZXkgKi9cbiAgICAgICAgbWV0YT86IHN0cmluZ1tdO1xuICAgIH07XG5cbiAgICAvKiogQ29uZmlkZW5jZSBsZXZlbCAqL1xuICAgIGNvbmZpZGVuY2U6ICdoaWdoJyB8ICdtZWRpdW0nIHwgJ2xvdyc7XG5cbiAgICAvKiogRGV0ZWN0aW9uIG1ldGhvZCB1c2VkICovXG4gICAgbWV0aG9kOiBzdHJpbmc7XG5cbiAgICAvKiogUGF0dGVybiB0aGF0IG1hdGNoZWQgKi9cbiAgICBwYXR0ZXJuOiBzdHJpbmc7XG59XG5cbi8qKlxuICogUGFyc2VkIGNvbXBvbmVudHMgZnJvbSByZWxhdGlvbiBmaWVsZCBuYW1lXG4gKi9cbmludGVyZmFjZSBQYXJzZWRSZWxhdGlvbkZpZWxkIHtcbiAgICAvKiogUHJlZml4IChlLmcuLCAnaG9tZScsICdhd2F5JywgJ2NvbXBldGl0b3IxJykgKi9cbiAgICBwcmVmaXg/OiBzdHJpbmc7XG4gICAgLyoqIEJhc2UgbmFtZSB3aXRob3V0IHByZWZpeCBhbmQgJ0lkJyBzdWZmaXggKGUuZy4sICdUZWFtJykgKi9cbiAgICBiYXNlTmFtZTogc3RyaW5nO1xuICAgIC8qKiBXaGV0aGVyIGZpZWxkIGVuZHMgd2l0aCAnSWQnICovXG4gICAgaGFzSWRTdWZmaXg6IGJvb2xlYW47XG4gICAgLyoqIE9yaWdpbmFsIGZpZWxkIG5hbWUgKi9cbiAgICBvcmlnaW5hbEZpZWxkOiBzdHJpbmc7XG59XG5cbi8qKlxuICogU21hcnQgZGVmYXVsdCBjb25maWd1cmF0aW9uXG4gKi9cbi8qKlxuICogRnJhbWV3b3JrLWxldmVsIGRlZmF1bHQgZGV0ZWN0aW9uIGNvbmZpZy5cbiAqIENvbnRhaW5zIE9OTFkgZG9tYWluLWFnbm9zdGljIHBhdHRlcm5zIHRoYXQgd29yayBhY3Jvc3MgYW55IGFwcGxpY2F0aW9uLlxuICogXG4gKiBBcHBsaWNhdGlvbnMgc2hvdWxkIHByb3ZpZGUgZG9tYWluLXNwZWNpZmljIHByZWZpeGVzIHZpYSB1aUNvbmZpZ09wdGlvbnMuXG4gKiBcbiAqIEBleGFtcGxlIEFwcGxpY2F0aW9uLXNwZWNpZmljIGNvbmZpZyAoaW4gYmFja2VuZCBpbmRleC50cyk6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCB1aUNvbmZpZ09wdGlvbnMgPSB7XG4gKiAgIGR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbjoge1xuICogICAgIHByZWZpeGVzOiBbXG4gKiAgICAgICAvLyBEb21haW4tc3BlY2lmaWMgcHJlZml4ZXMgZm9yIHlvdXIgYXBwXG4gKiAgICAgICAncGxheWVyJywgJ3RlYW0nLCAnbGVhZ3VlJywgJ3NlYXNvbicsICd2ZW51ZScsICdzcG9ydCcsICAvLyBTcG9ydHMgYXBwXG4gKiAgICAgICAvLyBPUjogJ2N1c3RvbWVyJywgJ29yZGVyJywgJ3Byb2R1Y3QnLCAnaW52b2ljZScgIC8vIEUtY29tbWVyY2UgYXBwXG4gKiAgICAgICAvLyBPUjogJ2F1dGhvcicsICdib29rJywgJ3B1Ymxpc2hlcicsICdnZW5yZScgIC8vIExpYnJhcnkgYXBwXG4gKiAgICAgXVxuICogICB9XG4gKiB9O1xuICogYGBgXG4gKi9cbmNvbnN0IERFRkFVTFRfREVURUNUSU9OX0NPTkZJRzogUmVxdWlyZWQ8SUR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbkNvbmZpZz4gPSB7XG4gICAgZW5hYmxlZDogdHJ1ZSxcbiAgICBzdWZmaXhlczoge1xuICAgICAgICAvLyBHZW5lcmljIGRpc3BsYXkgdGV4dCBwYXR0ZXJucyAodW5pdmVyc2FsKVxuICAgICAgICBkaXNwbGF5OiBbICdOYW1lJywgJ1RpdGxlJywgJ0xhYmVsJywgJ0Rpc3BsYXlOYW1lJyBdLFxuICAgICAgICAvLyBHZW5lcmljIHZpc3VhbCBhc3NldCBwYXR0ZXJucyAodW5pdmVyc2FsKVxuICAgICAgICB2aXN1YWw6IFsgJ0xvZ28nLCAnSW1hZ2UnLCAnSWNvbicsICdBdmF0YXInLCAnUGljdHVyZScgXSxcbiAgICAgICAgLy8gR2VuZXJpYyBtZXRhZGF0YSBwYXR0ZXJucyAodW5pdmVyc2FsKVxuICAgICAgICBtZXRhOiBbICdDb2RlJywgJ1NsdWcnLCAnS2V5JywgJ0lkZW50aWZpZXInLCAnUmVtb3RlSWQnIF1cbiAgICB9LFxuICAgIHByZWZpeGVzOiBbXG4gICAgICAgIC8vIEdlbmVyaWMgcmVsYXRpb25hbCBwYXR0ZXJucyAodW5pdmVyc2FsKVxuICAgICAgICAncGFyZW50JywgJ2NoaWxkJyxcbiAgICAgICAgJ3NvdXJjZScsICd0YXJnZXQnLCAnZGVzdGluYXRpb24nLFxuICAgICAgICAncHJpbWFyeScsICdzZWNvbmRhcnknLCAndGVydGlhcnknLFxuICAgICAgICAnbWFpbicsICdhbHRlcm5hdGUnLCAnZmFsbGJhY2snLFxuICAgICAgICAnb3duZXInLCAnY3JlYXRvcicsICdtb2RpZmllcicsXG4gICAgICAgICdmaXJzdCcsICdzZWNvbmQnLCAndGhpcmQnLCAnbGFzdCcsXG4gICAgICAgICdwcmV2aW91cycsICduZXh0JywgJ2N1cnJlbnQnLFxuICAgICAgICAnb2xkJywgJ25ldycsXG4gICAgICAgICdvcmlnaW5hbCcsICdjb3B5JywgJ2RyYWZ0JyxcblxuICAgICAgICAvLyBHZW5lcmljIGRpcmVjdGlvbmFsIHBhdHRlcm5zICh1bml2ZXJzYWwpXG4gICAgICAgICdob21lJywgJ2F3YXknLFxuICAgICAgICAnbGVmdCcsICdyaWdodCcsXG4gICAgICAgICd0b3AnLCAnYm90dG9tJyxcbiAgICAgICAgJ2lubmVyJywgJ291dGVyJyxcblxuICAgICAgICAvLyBHZW5lcmljIGNvbXBldGl0aXZlIHBhdHRlcm5zICh1bml2ZXJzYWwpXG4gICAgICAgICd3aW5uZXInLCAnbG9zZXInLFxuICAgICAgICAnY29tcGV0aXRvcicsICdvcHBvbmVudCdcblxuICAgICAgICAvLyBOT1RFOiBEb21haW4tc3BlY2lmaWMgcHJlZml4ZXMgKHBsYXllciwgdGVhbSwgY3VzdG9tZXIsIG9yZGVyLCBldGMuKVxuICAgICAgICAvLyBzaG91bGQgYmUgcHJvdmlkZWQgdmlhIHVpQ29uZmlnT3B0aW9ucyBpbiB5b3VyIGFwcGxpY2F0aW9uJ3MgYmFja2VuZFxuICAgIF0sXG4gICAgdGVtcGxhdGVTdHlsZTogJ3NpbXBsZScsXG4gICAgY29uZmlkZW5jZVRocmVzaG9sZDogJ21lZGl1bScsXG4gICAgZGVidWc6IGZhbHNlXG59O1xuXG4vKipcbiAqIE1lcmdlIGNvbmZpZ3VyYXRpb25zIHdpdGggcHJpb3JpdHk6IGhpbnRzID4gZW50aXR5ID4gZ2xvYmFsID4gZGVmYXVsdHNcbiAqL1xuZnVuY3Rpb24gbWVyZ2VEZXRlY3Rpb25Db25maWdzKFxuICAgIGdsb2JhbENvbmZpZz86IElEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25Db25maWcsXG4gICAgZW50aXR5Q29uZmlnPzogSUR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbkNvbmZpZyxcbiAgICByZWxhdGlvbkhpbnRzPzoge1xuICAgICAgICBwcmVmZXJyZWRGaWVsZHM/OiBzdHJpbmdbXTtcbiAgICAgICAgZXhjbHVkZUZpZWxkcz86IHN0cmluZ1tdO1xuICAgICAgICB0ZW1wbGF0ZVN0eWxlPzogJ3NpbXBsZScgfCAnY29tcG9zaXRlJztcbiAgICB9XG4pOiBSZXF1aXJlZDxJRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uQ29uZmlnPiAmIHsgcHJlZmVycmVkRmllbGRzPzogc3RyaW5nW107IGV4Y2x1ZGVGaWVsZHM/OiBzdHJpbmdbXSB9IHtcbiAgICAvLyBTdGFydCB3aXRoIGRlZmF1bHRzXG4gICAgbGV0IG1lcmdlZCA9IHsgLi4uREVGQVVMVF9ERVRFQ1RJT05fQ09ORklHIH07XG5cbiAgICAvLyBBcHBseSBnbG9iYWwgY29uZmlnXG4gICAgaWYgKGdsb2JhbENvbmZpZykge1xuICAgICAgICBtZXJnZWQgPSB7XG4gICAgICAgICAgICAuLi5tZXJnZWQsXG4gICAgICAgICAgICAuLi5nbG9iYWxDb25maWcsXG4gICAgICAgICAgICBzdWZmaXhlczogeyAuLi5tZXJnZWQuc3VmZml4ZXMsIC4uLmdsb2JhbENvbmZpZy5zdWZmaXhlcyB9LFxuICAgICAgICAgICAgcHJlZml4ZXM6IGdsb2JhbENvbmZpZy5wcmVmaXhlcyB8fCBtZXJnZWQucHJlZml4ZXNcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBBcHBseSBlbnRpdHkgY29uZmlnIChoaWdoZXIgcHJpb3JpdHkpXG4gICAgaWYgKGVudGl0eUNvbmZpZykge1xuICAgICAgICBtZXJnZWQgPSB7XG4gICAgICAgICAgICAuLi5tZXJnZWQsXG4gICAgICAgICAgICAuLi5lbnRpdHlDb25maWcsXG4gICAgICAgICAgICBzdWZmaXhlczogeyAuLi5tZXJnZWQuc3VmZml4ZXMsIC4uLmVudGl0eUNvbmZpZy5zdWZmaXhlcyB9LFxuICAgICAgICAgICAgcHJlZml4ZXM6IGVudGl0eUNvbmZpZy5wcmVmaXhlcyB8fCBtZXJnZWQucHJlZml4ZXNcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBBcHBseSByZWxhdGlvbiBoaW50cyAoaGlnaGVzdCBwcmlvcml0eSlcbiAgICBjb25zdCByZXN1bHQ6IGFueSA9IHsgLi4ubWVyZ2VkIH07XG4gICAgaWYgKHJlbGF0aW9uSGludHMpIHtcbiAgICAgICAgaWYgKHJlbGF0aW9uSGludHMudGVtcGxhdGVTdHlsZSkge1xuICAgICAgICAgICAgcmVzdWx0LnRlbXBsYXRlU3R5bGUgPSByZWxhdGlvbkhpbnRzLnRlbXBsYXRlU3R5bGU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlbGF0aW9uSGludHMucHJlZmVycmVkRmllbGRzKSB7XG4gICAgICAgICAgICByZXN1bHQucHJlZmVycmVkRmllbGRzID0gcmVsYXRpb25IaW50cy5wcmVmZXJyZWRGaWVsZHM7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlbGF0aW9uSGludHMuZXhjbHVkZUZpZWxkcykge1xuICAgICAgICAgICAgcmVzdWx0LmV4Y2x1ZGVGaWVsZHMgPSByZWxhdGlvbkhpbnRzLmV4Y2x1ZGVGaWVsZHM7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG4vKipcbiAqIFBhcnNlIHJlbGF0aW9uIGZpZWxkIHRvIGV4dHJhY3QgcHJlZml4IGFuZCBiYXNlIG5hbWUuXG4gKiBcbiAqIEV4YW1wbGVzOlxuICogLSAndGVhbUlkJyDihpIgeyBiYXNlTmFtZTogJ1RlYW0nLCBoYXNJZFN1ZmZpeDogdHJ1ZSB9XG4gKiAtICdob21lVGVhbUlkJyDihpIgeyBwcmVmaXg6ICdob21lJywgYmFzZU5hbWU6ICdUZWFtJywgaGFzSWRTdWZmaXg6IHRydWUgfVxuICogLSAnY29tcGV0aXRvcjFUZWFtSWQnIOKGkiB7IHByZWZpeDogJ2NvbXBldGl0b3IxJywgYmFzZU5hbWU6ICdUZWFtJywgaGFzSWRTdWZmaXg6IHRydWUgfVxuICogLSAnc3BvcnQnIOKGkiB7IGJhc2VOYW1lOiAnc3BvcnQnLCBoYXNJZFN1ZmZpeDogZmFsc2UgfVxuICovXG5mdW5jdGlvbiBwYXJzZVJlbGF0aW9uRmllbGQoXG4gICAgZmllbGRJZDogc3RyaW5nLFxuICAgIHByZWZpeGVzOiBzdHJpbmdbXVxuKTogUGFyc2VkUmVsYXRpb25GaWVsZCB7XG4gICAgLy8gQnVpbGQgcmVnZXggZm9yIHByZWZpeCBkZXRlY3Rpb246IF4ocHJlZml4MXxwcmVmaXgyfC4uLikoXFxcXGQqKSguKykkXG4gICAgLy8gVXNlIGNhc2UtaW5zZW5zaXRpdmUgbWF0Y2hpbmdcbiAgICBjb25zdCBwcmVmaXhQYXR0ZXJuID0gbmV3IFJlZ0V4cChcbiAgICAgICAgYF4oJHtwcmVmaXhlcy5qb2luKCd8Jyl9KShcXFxcZCopKC4rKSRgLFxuICAgICAgICAnaSdcbiAgICApO1xuXG4gICAgY29uc3QgbWF0Y2ggPSBmaWVsZElkLm1hdGNoKHByZWZpeFBhdHRlcm4pO1xuXG4gICAgaWYgKG1hdGNoKSB7XG4gICAgICAgIGNvbnN0IFsgLCBwcmVmaXgsIG51bSwgcmVzdCBdID0gbWF0Y2g7XG4gICAgICAgIGNvbnN0IGhhc0lkU3VmZml4ID0gcmVzdC50b0xvd2VyQ2FzZSgpLmVuZHNXaXRoKCdpZCcpO1xuICAgICAgICBjb25zdCBiYXNlTmFtZSA9IGhhc0lkU3VmZml4XG4gICAgICAgICAgICA/IHJlc3Quc3Vic3RyaW5nKDAsIHJlc3QubGVuZ3RoIC0gMilcbiAgICAgICAgICAgIDogcmVzdDtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgcHJlZml4OiBwcmVmaXggKyBudW0sICAvLyAnaG9tZScgb3IgJ2NvbXBldGl0b3IxJ1xuICAgICAgICAgICAgYmFzZU5hbWUsXG4gICAgICAgICAgICBoYXNJZFN1ZmZpeCxcbiAgICAgICAgICAgIG9yaWdpbmFsRmllbGQ6IGZpZWxkSWRcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBObyBwcmVmaXggZGV0ZWN0ZWRcbiAgICBjb25zdCBoYXNJZFN1ZmZpeCA9IGZpZWxkSWQudG9Mb3dlckNhc2UoKS5lbmRzV2l0aCgnaWQnKTtcbiAgICBjb25zdCBiYXNlTmFtZSA9IGhhc0lkU3VmZml4XG4gICAgICAgID8gZmllbGRJZC5zdWJzdHJpbmcoMCwgZmllbGRJZC5sZW5ndGggLSAyKVxuICAgICAgICA6IGZpZWxkSWQ7XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBiYXNlTmFtZSxcbiAgICAgICAgaGFzSWRTdWZmaXgsXG4gICAgICAgIG9yaWdpbmFsRmllbGQ6IGZpZWxkSWRcbiAgICB9O1xufVxuXG4vKipcbiAqIEdlbmVyYXRlIHNlYXJjaCBwYXR0ZXJucyBmb3IgY2FuZGlkYXRlIGZpZWxkIG5hbWVzLlxuICogXG4gKiBQcmlvcml0eTpcbiAqIDEuIFByZWZlcnJlZCBmaWVsZHMgKGZyb20gaGludHMpXG4gKiAyLiBFeGFjdCBwcmVmaXggbWF0Y2g6IHtwcmVmaXh9e2Jhc2VOYW1lfXtzdWZmaXh9XG4gKiAzLiBFbnRpdHkgbmFtZSBtYXRjaDoge2VudGl0eU5hbWV9e3N1ZmZpeH1cbiAqIDQuIEJhc2UgbmFtZSBtYXRjaDoge2Jhc2VOYW1lfXtzdWZmaXh9XG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlU2VhcmNoUGF0dGVybnMoXG4gICAgcGFyc2VkOiBQYXJzZWRSZWxhdGlvbkZpZWxkLFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBzdWZmaXhlczogc3RyaW5nW10sXG4gICAgcHJlZmVycmVkRmllbGRzPzogc3RyaW5nW11cbik6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBwYXR0ZXJuczogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCBlbnRpdHlOYW1lTG93ZXIgPSBlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgYmFzZU5hbWVMb3dlciA9IHBhcnNlZC5iYXNlTmFtZS50b0xvd2VyQ2FzZSgpO1xuXG4gICAgLy8gUHJpb3JpdHkgMTogUHJlZmVycmVkIGZpZWxkcyAoZXhhY3QgbWF0Y2gpXG4gICAgaWYgKHByZWZlcnJlZEZpZWxkcyAmJiBwcmVmZXJyZWRGaWVsZHMubGVuZ3RoID4gMCkge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKC4uLnByZWZlcnJlZEZpZWxkcyk7XG4gICAgfVxuXG4gICAgLy8gUHJpb3JpdHkgMjogV2l0aCBwcmVmaXggKGUuZy4sIGhvbWVUZWFtTmFtZSwgYXdheVRlYW1OYW1lKVxuICAgIGlmIChwYXJzZWQucHJlZml4KSB7XG4gICAgICAgIGNvbnN0IHByZWZpeExvd2VyID0gcGFyc2VkLnByZWZpeC50b0xvd2VyQ2FzZSgpO1xuICAgICAgICBmb3IgKGNvbnN0IHN1ZmZpeCBvZiBzdWZmaXhlcykge1xuICAgICAgICAgICAgcGF0dGVybnMucHVzaChgJHtwcmVmaXhMb3dlcn0ke2Jhc2VOYW1lTG93ZXJ9JHtzdWZmaXgudG9Mb3dlckNhc2UoKX1gKTtcbiAgICAgICAgICAgIHBhdHRlcm5zLnB1c2goYCR7cHJlZml4TG93ZXJ9JHtlbnRpdHlOYW1lTG93ZXJ9JHtzdWZmaXgudG9Mb3dlckNhc2UoKX1gKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFByaW9yaXR5IDM6IEVudGl0eSBuYW1lIChlLmcuLCB0ZWFtTmFtZSBmb3IgcmVsYXRpb24gdG8gJ3RlYW0nKVxuICAgIGZvciAoY29uc3Qgc3VmZml4IG9mIHN1ZmZpeGVzKSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYCR7ZW50aXR5TmFtZUxvd2VyfSR7c3VmZml4LnRvTG93ZXJDYXNlKCl9YCk7XG4gICAgfVxuXG4gICAgLy8gUHJpb3JpdHkgNDogQmFzZSBuYW1lIChlLmcuLCB0ZWFtTmFtZSBmb3IgJ3RlYW1JZCcpXG4gICAgZm9yIChjb25zdCBzdWZmaXggb2Ygc3VmZml4ZXMpIHtcbiAgICAgICAgcGF0dGVybnMucHVzaChgJHtiYXNlTmFtZUxvd2VyfSR7c3VmZml4LnRvTG93ZXJDYXNlKCl9YCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHBhdHRlcm5zO1xufVxuXG4vKipcbiAqIFNlYXJjaCBmb3IgZmllbGRzIG1hdGNoaW5nIHBhdHRlcm5zLCBleGNsdWRpbmcgc3BlY2lmaWVkIGZpZWxkcy5cbiAqL1xuZnVuY3Rpb24gc2VhcmNoRmllbGRzQnlQYXR0ZXJucyhcbiAgICBhbGxQcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSxcbiAgICBwYXR0ZXJuczogc3RyaW5nW10sXG4gICAgZXhjbHVkZUZpZWxkcz86IHN0cmluZ1tdXG4pOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgZXhjbHVkZVNldCA9IG5ldyBTZXQoZXhjbHVkZUZpZWxkcz8ubWFwKGYgPT4gZi50b0xvd2VyQ2FzZSgpKSB8fCBbXSk7XG4gICAgY29uc3QgZm91bmQ6IHN0cmluZ1tdID0gW107XG4gICAgY29uc3Qgc2Vlbkxvd2VyID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICBmb3IgKGNvbnN0IHBhdHRlcm4gb2YgcGF0dGVybnMpIHtcbiAgICAgICAgY29uc3QgcGF0dGVybkxvd2VyID0gcGF0dGVybi50b0xvd2VyQ2FzZSgpO1xuXG4gICAgICAgIC8vIFNraXAgaWYgYWxyZWFkeSBmb3VuZCBvciBleGNsdWRlZFxuICAgICAgICBpZiAoc2Vlbkxvd2VyLmhhcyhwYXR0ZXJuTG93ZXIpIHx8IGV4Y2x1ZGVTZXQuaGFzKHBhdHRlcm5Mb3dlcikpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRmluZCBtYXRjaGluZyBmaWVsZCAoY2FzZS1pbnNlbnNpdGl2ZSlcbiAgICAgICAgY29uc3QgbWF0Y2ggPSBhbGxQcm9wZXJ0aWVzLmZpbmQocCA9PlxuICAgICAgICAgICAgcC5pZD8udG9Mb3dlckNhc2UoKSA9PT0gcGF0dGVybkxvd2VyICYmXG4gICAgICAgICAgICAhZXhjbHVkZVNldC5oYXMocC5pZC50b0xvd2VyQ2FzZSgpKVxuICAgICAgICApO1xuXG4gICAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICAgICAgZm91bmQucHVzaChtYXRjaC5pZCk7XG4gICAgICAgICAgICBzZWVuTG93ZXIuYWRkKG1hdGNoLmlkLnRvTG93ZXJDYXNlKCkpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZvdW5kO1xufVxuXG4vKipcbiAqIENhbGN1bGF0ZSBjb25maWRlbmNlIGJhc2VkIG9uIGRldGVjdGlvbiBtZXRob2QgYW5kIHBhdHRlcm5cbiAqL1xuZnVuY3Rpb24gY2FsY3VsYXRlQ29uZmlkZW5jZShcbiAgICBkZXRlY3RlZEZpZWxkOiBzdHJpbmcsXG4gICAgcGFyc2VkOiBQYXJzZWRSZWxhdGlvbkZpZWxkLFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBtZXRob2Q6ICdwcmVmZXJyZWQnIHwgJ3ByZWZpeCcgfCAnZW50aXR5JyB8ICdiYXNlJ1xuKTogJ2hpZ2gnIHwgJ21lZGl1bScgfCAnbG93JyB7XG4gICAgLy8gUHJlZmVycmVkIGZpZWxkcyA9IGhpZ2ggY29uZmlkZW5jZSAoZGV2ZWxvcGVyIGV4cGxpY2l0bHkgc3BlY2lmaWVkKVxuICAgIGlmIChtZXRob2QgPT09ICdwcmVmZXJyZWQnKSByZXR1cm4gJ2hpZ2gnO1xuXG4gICAgY29uc3QgZmllbGRMb3dlciA9IGRldGVjdGVkRmllbGQudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBlbnRpdHlMb3dlciA9IGVudGl0eU5hbWUudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBiYXNlTG93ZXIgPSBwYXJzZWQuYmFzZU5hbWUudG9Mb3dlckNhc2UoKTtcblxuICAgIC8vIEV4YWN0IHByZWZpeCArIGVudGl0eS9iYXNlIG1hdGNoID0gaGlnaFxuICAgIGlmIChtZXRob2QgPT09ICdwcmVmaXgnKSB7XG4gICAgICAgIGlmIChmaWVsZExvd2VyLmluY2x1ZGVzKGVudGl0eUxvd2VyKSB8fCBmaWVsZExvd2VyLmluY2x1ZGVzKGJhc2VMb3dlcikpIHtcbiAgICAgICAgICAgIHJldHVybiAnaGlnaCc7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICdtZWRpdW0nO1xuICAgIH1cblxuICAgIC8vIEVudGl0eSBuYW1lIG1hdGNoID0gaGlnaFxuICAgIGlmIChtZXRob2QgPT09ICdlbnRpdHknKSByZXR1cm4gJ2hpZ2gnO1xuXG4gICAgLy8gQmFzZSBuYW1lIG1hdGNoID0gbWVkaXVtIChjb3VsZCBiZSBjb2luY2lkZW50YWwpXG4gICAgaWYgKG1ldGhvZCA9PT0gJ2Jhc2UnKSByZXR1cm4gJ21lZGl1bSc7XG5cbiAgICByZXR1cm4gJ2xvdyc7XG59XG5cbi8qKlxuICogR2VuZXJhdGUgdGVtcGxhdGUgc3RyaW5nIGZyb20gZGV0ZWN0ZWQgZmllbGRzLlxuICovXG5mdW5jdGlvbiBnZW5lcmF0ZVRlbXBsYXRlKFxuICAgIHByaW1hcnlGaWVsZDogc3RyaW5nLFxuICAgIGFsbERldGVjdGVkRmllbGRzOiBEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25SZXN1bHRbICdkZXRlY3RlZEZpZWxkcycgXSxcbiAgICB0ZW1wbGF0ZVN0eWxlOiAnc2ltcGxlJyB8ICdjb21wb3NpdGUnXG4pOiBzdHJpbmcge1xuICAgIGlmICh0ZW1wbGF0ZVN0eWxlID09PSAnc2ltcGxlJykge1xuICAgICAgICByZXR1cm4gYHske3ByaW1hcnlGaWVsZH19YDtcbiAgICB9XG5cbiAgICAvLyBDb21wb3NpdGU6IHRyeSB0byBpbmNsdWRlIG1ldGEgZmllbGQgKGNvZGUvc2x1ZykgaWYgYXZhaWxhYmxlXG4gICAgaWYgKHRlbXBsYXRlU3R5bGUgPT09ICdjb21wb3NpdGUnICYmIGFsbERldGVjdGVkRmllbGRzLm1ldGEgJiYgYWxsRGV0ZWN0ZWRGaWVsZHMubWV0YS5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IG1ldGFGaWVsZCA9IGFsbERldGVjdGVkRmllbGRzLm1ldGFbIDAgXTtcbiAgICAgICAgcmV0dXJuIGB7JHtwcmltYXJ5RmllbGR9fSAoeyR7bWV0YUZpZWxkfX0pYDtcbiAgICB9XG5cbiAgICAvLyBGYWxsYmFjayB0byBzaW1wbGUgaWYgbm8gbWV0YSBmaWVsZFxuICAgIHJldHVybiBgeyR7cHJpbWFyeUZpZWxkfX1gO1xufVxuXG4vKipcbiAqIEVuaGFuY2VkIHNtYXJ0IGR1cGxpY2F0ZWQgZmllbGQgZGV0ZWN0aW9uLlxuICogXG4gKiBEZXRlY3RzIGZpZWxkcyBsaWtlICd0ZWFtTmFtZScgZm9yICd0ZWFtSWQnIHJlbGF0aW9ucyB3aXRoIHN1cHBvcnQgZm9yOlxuICogLSBQcmVmaXhlcyAoaG9tZSwgYXdheSwgY29tcGV0aXRvcjEsIGV0Yy4pXG4gKiAtIE11bHRpcGxlIHN1ZmZpeGVzIChOYW1lLCBUaXRsZSwgTGFiZWwsIExvZ28sIENvZGUsIGV0Yy4pXG4gKiAtIFByZWZlcnJlZCBmaWVsZHMgYW5kIGV4Y2x1c2lvbnNcbiAqIC0gQ29uZmlkZW5jZSBzY29yaW5nXG4gKiAtIENvbXBvc2l0ZSB0ZW1wbGF0ZXNcbiAqIFxuICogQHBhcmFtIGFsbFByb3BlcnRpZXMgLSBBbGwgcHJvcGVydGllcyBpbiB0aGUgcGFyZW50IGVudGl0eVxuICogQHBhcmFtIHJlbGF0aW9uRmllbGRJZCAtIFRoZSByZWxhdGlvbiBmaWVsZCBuYW1lIChlLmcuLCAndGVhbUlkJywgJ2hvbWVUZWFtSWQnKVxuICogQHBhcmFtIHJlbGF0ZWRFbnRpdHlOYW1lIC0gUmVsYXRlZCBlbnRpdHkgbmFtZSAoZS5nLiwgJ3RlYW0nKVxuICogQHBhcmFtIGdsb2JhbENvbmZpZyAtIEdsb2JhbCBkZXRlY3Rpb24gY29uZmlndXJhdGlvblxuICogQHBhcmFtIGVudGl0eUNvbmZpZyAtIEVudGl0eS1sZXZlbCBkZXRlY3Rpb24gY29uZmlndXJhdGlvblxuICogQHBhcmFtIHJlbGF0aW9uSGludHMgLSBSZWxhdGlvbi1zcGVjaWZpYyBoaW50c1xuICogQHJldHVybnMgRGV0ZWN0aW9uIHJlc3VsdCB3aXRoIHRlbXBsYXRlIGFuZCBtZXRhZGF0YVxuICovXG5mdW5jdGlvbiBkZXRlY3REdXBsaWNhdGVkUmVsYXRpb25GaWVsZHMoXG4gICAgYWxsUHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sXG4gICAgcmVsYXRpb25GaWVsZElkOiBzdHJpbmcsXG4gICAgcmVsYXRlZEVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBnbG9iYWxDb25maWc/OiBJRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uQ29uZmlnLFxuICAgIGVudGl0eUNvbmZpZz86IElEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25Db25maWcsXG4gICAgcmVsYXRpb25IaW50cz86IHtcbiAgICAgICAgcHJlZmVycmVkRmllbGRzPzogc3RyaW5nW107XG4gICAgICAgIGV4Y2x1ZGVGaWVsZHM/OiBzdHJpbmdbXTtcbiAgICAgICAgdGVtcGxhdGVTdHlsZT86ICdzaW1wbGUnIHwgJ2NvbXBvc2l0ZSc7XG4gICAgfVxuKTogRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uUmVzdWx0IHwgdW5kZWZpbmVkIHtcbiAgICAvLyBNZXJnZSBjb25maWd1cmF0aW9uc1xuICAgIGNvbnN0IGNvbmZpZyA9IG1lcmdlRGV0ZWN0aW9uQ29uZmlncyhnbG9iYWxDb25maWcsIGVudGl0eUNvbmZpZywgcmVsYXRpb25IaW50cyk7XG5cbiAgICAvLyBDaGVjayBpZiBkZXRlY3Rpb24gaXMgZW5hYmxlZFxuICAgIGlmICghY29uZmlnLmVuYWJsZWQpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyBQYXJzZSByZWxhdGlvbiBmaWVsZFxuICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlUmVsYXRpb25GaWVsZChyZWxhdGlvbkZpZWxkSWQsIGNvbmZpZy5wcmVmaXhlcyk7XG5cbiAgICAvLyBTZWFyY2ggZm9yIGRpc3BsYXkgZmllbGRzIChOYW1lLCBUaXRsZSwgTGFiZWwpXG4gICAgY29uc3QgZGlzcGxheVBhdHRlcm5zID0gZ2VuZXJhdGVTZWFyY2hQYXR0ZXJucyhcbiAgICAgICAgcGFyc2VkLFxuICAgICAgICByZWxhdGVkRW50aXR5TmFtZSxcbiAgICAgICAgY29uZmlnLnN1ZmZpeGVzPy5kaXNwbGF5IHx8IFtdLFxuICAgICAgICBjb25maWcucHJlZmVycmVkRmllbGRzXG4gICAgKTtcbiAgICBjb25zdCBkaXNwbGF5RmllbGRzID0gc2VhcmNoRmllbGRzQnlQYXR0ZXJucyhhbGxQcm9wZXJ0aWVzLCBkaXNwbGF5UGF0dGVybnMsIGNvbmZpZy5leGNsdWRlRmllbGRzKTtcblxuICAgIC8vIFNlYXJjaCBmb3IgdmlzdWFsIGZpZWxkcyAoTG9nbywgSW1hZ2UsIEljb24pXG4gICAgY29uc3QgdmlzdWFsUGF0dGVybnMgPSBnZW5lcmF0ZVNlYXJjaFBhdHRlcm5zKFxuICAgICAgICBwYXJzZWQsXG4gICAgICAgIHJlbGF0ZWRFbnRpdHlOYW1lLFxuICAgICAgICBjb25maWcuc3VmZml4ZXM/LnZpc3VhbCB8fCBbXVxuICAgICk7XG4gICAgY29uc3QgdmlzdWFsRmllbGRzID0gc2VhcmNoRmllbGRzQnlQYXR0ZXJucyhhbGxQcm9wZXJ0aWVzLCB2aXN1YWxQYXR0ZXJucywgY29uZmlnLmV4Y2x1ZGVGaWVsZHMpO1xuXG4gICAgLy8gU2VhcmNoIGZvciBtZXRhIGZpZWxkcyAoQ29kZSwgU2x1ZywgS2V5KVxuICAgIGNvbnN0IG1ldGFQYXR0ZXJucyA9IGdlbmVyYXRlU2VhcmNoUGF0dGVybnMoXG4gICAgICAgIHBhcnNlZCxcbiAgICAgICAgcmVsYXRlZEVudGl0eU5hbWUsXG4gICAgICAgIGNvbmZpZy5zdWZmaXhlcz8ubWV0YSB8fCBbXVxuICAgICk7XG4gICAgY29uc3QgbWV0YUZpZWxkcyA9IHNlYXJjaEZpZWxkc0J5UGF0dGVybnMoYWxsUHJvcGVydGllcywgbWV0YVBhdHRlcm5zLCBjb25maWcuZXhjbHVkZUZpZWxkcyk7XG5cbiAgICAvLyBObyBmaWVsZHMgZGV0ZWN0ZWRcbiAgICBpZiAoZGlzcGxheUZpZWxkcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyBEZXRlcm1pbmUgZGV0ZWN0aW9uIG1ldGhvZFxuICAgIGNvbnN0IHByaW1hcnlGaWVsZCA9IGRpc3BsYXlGaWVsZHNbIDAgXTtcbiAgICBsZXQgbWV0aG9kOiAncHJlZmVycmVkJyB8ICdwcmVmaXgnIHwgJ2VudGl0eScgfCAnYmFzZScgPSAnYmFzZSc7XG4gICAgbGV0IHBhdHRlcm4gPSAndW5rbm93bic7XG5cbiAgICBpZiAoY29uZmlnLnByZWZlcnJlZEZpZWxkcyAmJiBjb25maWcucHJlZmVycmVkRmllbGRzLmluY2x1ZGVzKHByaW1hcnlGaWVsZCkpIHtcbiAgICAgICAgbWV0aG9kID0gJ3ByZWZlcnJlZCc7XG4gICAgICAgIHBhdHRlcm4gPSAncHJlZmVycmVkX2ZpZWxkJztcbiAgICB9IGVsc2UgaWYgKHBhcnNlZC5wcmVmaXggJiYgcHJpbWFyeUZpZWxkLnRvTG93ZXJDYXNlKCkuc3RhcnRzV2l0aChwYXJzZWQucHJlZml4LnRvTG93ZXJDYXNlKCkpKSB7XG4gICAgICAgIG1ldGhvZCA9ICdwcmVmaXgnO1xuICAgICAgICBwYXR0ZXJuID0gYCR7cGFyc2VkLnByZWZpeH17ZW50aXR5fXtzdWZmaXh9YDtcbiAgICB9IGVsc2UgaWYgKHByaW1hcnlGaWVsZC50b0xvd2VyQ2FzZSgpLnN0YXJ0c1dpdGgocmVsYXRlZEVudGl0eU5hbWUudG9Mb3dlckNhc2UoKSkpIHtcbiAgICAgICAgbWV0aG9kID0gJ2VudGl0eSc7XG4gICAgICAgIHBhdHRlcm4gPSBge2VudGl0eX17c3VmZml4fWA7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgbWV0aG9kID0gJ2Jhc2UnO1xuICAgICAgICBwYXR0ZXJuID0gYHtiYXNlfXtzdWZmaXh9YDtcbiAgICB9XG5cbiAgICAvLyBDYWxjdWxhdGUgY29uZmlkZW5jZVxuICAgIGNvbnN0IGNvbmZpZGVuY2UgPSBjYWxjdWxhdGVDb25maWRlbmNlKHByaW1hcnlGaWVsZCwgcGFyc2VkLCByZWxhdGVkRW50aXR5TmFtZSwgbWV0aG9kKTtcblxuICAgIC8vIENoZWNrIGNvbmZpZGVuY2UgdGhyZXNob2xkXG4gICAgY29uc3QgdGhyZXNob2xkT3JkZXIgPSB7IGxvdzogMCwgbWVkaXVtOiAxLCBoaWdoOiAyIH07XG4gICAgaWYgKHRocmVzaG9sZE9yZGVyWyBjb25maWRlbmNlIF0gPCB0aHJlc2hvbGRPcmRlclsgY29uZmlnLmNvbmZpZGVuY2VUaHJlc2hvbGQgXSkge1xuICAgICAgICAvLyBDb25maWRlbmNlIHRvbyBsb3dcbiAgICAgICAgaWYgKGNvbmZpZy5kZWJ1Zykge1xuICAgICAgICAgICAgRGVmYXVsdExvZ2dlci5pbmZvKGBbRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uXSBTa2lwcGluZyAke3JlbGF0aW9uRmllbGRJZH06IGNvbmZpZGVuY2UgJHtjb25maWRlbmNlfSA8IHRocmVzaG9sZCAke2NvbmZpZy5jb25maWRlbmNlVGhyZXNob2xkfWApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgLy8gR2VuZXJhdGUgdGVtcGxhdGVcbiAgICBjb25zdCB0ZW1wbGF0ZSA9IGdlbmVyYXRlVGVtcGxhdGUoXG4gICAgICAgIHByaW1hcnlGaWVsZCxcbiAgICAgICAgeyBkaXNwbGF5OiBkaXNwbGF5RmllbGRzLCB2aXN1YWw6IHZpc3VhbEZpZWxkcywgbWV0YTogbWV0YUZpZWxkcyB9LFxuICAgICAgICBjb25maWcudGVtcGxhdGVTdHlsZVxuICAgICk7XG5cbiAgICAvLyBEZWJ1ZyBsb2dnaW5nXG4gICAgaWYgKGNvbmZpZy5kZWJ1Zykge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25dICR7cmVsYXRpb25GaWVsZElkfSDihpIgJHt0ZW1wbGF0ZX0gKGNvbmZpZGVuY2U6ICR7Y29uZmlkZW5jZX0sIG1ldGhvZDogJHttZXRob2R9KWApO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIHByaW1hcnlGaWVsZCxcbiAgICAgICAgdGVtcGxhdGUsXG4gICAgICAgIGRldGVjdGVkRmllbGRzOiB7XG4gICAgICAgICAgICBkaXNwbGF5OiBkaXNwbGF5RmllbGRzLFxuICAgICAgICAgICAgdmlzdWFsOiB2aXN1YWxGaWVsZHMubGVuZ3RoID4gMCA/IHZpc3VhbEZpZWxkcyA6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgIG1ldGE6IG1ldGFGaWVsZHMubGVuZ3RoID4gMCA/IG1ldGFGaWVsZHMgOiB1bmRlZmluZWRcbiAgICAgICAgfSxcbiAgICAgICAgY29uZmlkZW5jZSxcbiAgICAgICAgbWV0aG9kLFxuICAgICAgICBwYXR0ZXJuXG4gICAgfTtcbn1cblxuLyoqXG4gKiBMZWdhY3kgd3JhcHBlciBmdW5jdGlvbiBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eS5cbiAqIFxuICogQGRlcHJlY2F0ZWQgVXNlIGRldGVjdER1cGxpY2F0ZWRSZWxhdGlvbkZpZWxkcygpIGZvciByaWNoZXIgcmVzdWx0c1xuICovXG5mdW5jdGlvbiBkZXRlY3REdXBsaWNhdGVkUmVsYXRpb25GaWVsZFRlbXBsYXRlKFxuICAgIGFsbFByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLFxuICAgIHJlbGF0aW9uRmllbGRJZDogc3RyaW5nLFxuICAgIHJlbGF0ZWRFbnRpdHlOYW1lOiBzdHJpbmdcbik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgcmVzdWx0ID0gZGV0ZWN0RHVwbGljYXRlZFJlbGF0aW9uRmllbGRzKFxuICAgICAgICBhbGxQcm9wZXJ0aWVzLFxuICAgICAgICByZWxhdGlvbkZpZWxkSWQsXG4gICAgICAgIHJlbGF0ZWRFbnRpdHlOYW1lXG4gICAgKTtcbiAgICByZXR1cm4gcmVzdWx0Py50ZW1wbGF0ZTtcbn1cblxuLyoqXG4gKiBHZW5lcmF0ZSBzbWFydCBmYWxsYmFjayBjb25maWd1cmF0aW9uIGZvciByZWxhdGlvbiBkaXNwbGF5IHdoZW4gb25seSBJRCBpcyBhdmFpbGFibGUuXG4gKiBVc2VzIGVudGl0eSBtZXRhZGF0YSAoaWNvbiwgZW50aXR5TmFtZVBsdXJhbCkgdG8gY3JlYXRlIHVzZXItZnJpZW5kbHkgZmFsbGJhY2sgdGV4dC5cbiAqIFxuICogQHBhcmFtIGVudGl0eU5hbWUgLSBSZWxhdGVkIGVudGl0eSBuYW1lIChlLmcuLCAndGVhbScpXG4gKiBAcGFyYW0gaWRGaWVsZCAtIElEIGZpZWxkIG5hbWUgKGUuZy4sICd0ZWFtSWQnKVxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSB0byBnZXQgbWV0YWRhdGEgZnJvbVxuICogQHJldHVybnMgRmFsbGJhY2sgY29uZmlndXJhdGlvbiB3aXRoIHRlbXBsYXRlLCBsaW5rVGV4dCwgYW5kIG1vZGFsQnV0dG9uVGV4dFxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gRm9yIGEgdGVhbSByZWxhdGlvblxuICogZ2VuZXJhdGVSZWxhdGlvbkZhbGxiYWNrKCd0ZWFtJywgJ3RlYW1JZCcsIHRlYW1TZXJ2aWNlKVxuICogLy8gUmV0dXJuczoge1xuICogLy8gICB0ZW1wbGF0ZTogJ1RlYW06IHt0ZWFtSWR9JyxcbiAqIC8vICAgbGlua1RleHQ6ICdWaWV3IFRlYW0nLFxuICogLy8gICBtb2RhbEJ1dHRvblRleHQ6ICdUZWFtIERldGFpbHMnXG4gKiAvLyB9XG4gKi9cbi8qKlxuICogR2VuZXJhdGVzIGZhbGxiYWNrIGRpc3BsYXkgY29uZmlndXJhdGlvbiBmb3IgcmVsYXRpb24gZmllbGRzLlxuICogXG4gKiBDcmVhdGVzIHVzZXItZnJpZW5kbHkgZmFsbGJhY2sgdGV4dCB0byBkaXNwbGF5IHdoZW4gb25seSB0aGUgSUQgb2YgYSByZWxhdGVkIGVudGl0eSBpcyBhdmFpbGFibGUuXG4gKiBVc2VzIHRoZSBlbnRpdHkncyBwbHVyYWwgZGlzcGxheSBuYW1lIChmcm9tIG1ldGFkYXRhKSBvciBnZW5lcmF0ZXMgaXQgZnJvbSB0aGUgZW50aXR5IG5hbWUuXG4gKiBcbiAqIEBwYXJhbSBlbnRpdHlOYW1lIC0gTmFtZSBvZiB0aGUgcmVsYXRlZCBlbnRpdHkgKGUuZy4sICd0ZWFtJywgJ3VzZXInKVxuICogQHBhcmFtIGlkRmllbGQgLSBJRCBmaWVsZCBuYW1lIChlLmcuLCAndGVhbUlkJywgJ3VzZXJJZCcpXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIE9wdGlvbmFsIGVudGl0eSBzZXJ2aWNlIHRvIGZldGNoIG1ldGFkYXRhIGZvciBiZXR0ZXIgbmFtaW5nXG4gKiBAcmV0dXJucyBGYWxsYmFjayBjb25maWd1cmF0aW9uIHdpdGggdGVtcGxhdGUsIGxpbmsgdGV4dCwgYW5kIG1vZGFsIGJ1dHRvbiB0ZXh0XG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBmYWxsYmFjayA9IGdlbmVyYXRlUmVsYXRpb25GYWxsYmFjaygndGVhbScsICd0ZWFtSWQnKTtcbiAqIC8vIFJldHVybnM6IHtcbiAqIC8vICAgdGVtcGxhdGU6IFwiVGVhbXM6IHt0ZWFtSWR9XCIsXG4gKiAvLyAgIGxpbmtUZXh0OiBcIlZpZXcgVGVhbXNcIixcbiAqIC8vICAgbW9kYWxCdXR0b25UZXh0OiBcIlRlYW1zIERldGFpbHNcIlxuICogLy8gfVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZW5lcmF0ZVJlbGF0aW9uRmFsbGJhY2soXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGlkRmllbGQ6IHN0cmluZyxcbiAgICBlbnRpdHlTZXJ2aWNlPzogQmFzZUVudGl0eVNlcnZpY2U8YW55PlxuKTogTm9uTnVsbGFibGU8SVJlbGF0aW9uRmllbGRDb25maWdbICdkaXNwbGF5Q29uZmlnJyBdPlsgJ2ZhbGxiYWNrJyBdIHtcbiAgICAvLyBUcnkgdG8gZ2V0IGVudGl0eSBtZXRhZGF0YSBmb3IgYmV0dGVyIGZhbGxiYWNrIHRleHRcbiAgICBjb25zdCBlbnRpdHlNZXRhZGF0YSA9IGVudGl0eVNlcnZpY2U/LmdldEVudGl0eVNjaGVtYT8uKCkubW9kZWw7XG4gICAgY29uc3QgZGlzcGxheU5hbWUgPSBlbnRpdHlNZXRhZGF0YT8uZW50aXR5TmFtZVBsdXJhbCB8fCBwYXNjYWxDYXNlKGVudGl0eU5hbWUpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgLy8gQmFja2VuZCBwcmUtZ2VuZXJhdGVzIGZhbGxiYWNrIHRlbXBsYXRlIChpbnRlbnRpb25hbGx5IHN0cmluZy1vbmx5LCBub3QgVGVtcGxhdGUgdHlwZSlcbiAgICAgICAgLy8gRnJvbnRlbmQgd2lsbCB1c2UgdGhpcyB3aGVuIG9ubHkgSUQgaXMgYXZhaWxhYmxlXG4gICAgICAgIHRlbXBsYXRlOiBgJHtkaXNwbGF5TmFtZX06IHske2lkRmllbGR9fWAsICAvLyBlLmcuLCBcIlRlYW06IHt0ZWFtSWR9XCJcbiAgICAgICAgbGlua1RleHQ6IGBWaWV3ICR7ZGlzcGxheU5hbWV9YCwgICAgICAgICAgIC8vIGUuZy4sIFwiVmlldyBUZWFtXCJcbiAgICAgICAgbW9kYWxCdXR0b25UZXh0OiBgJHtkaXNwbGF5TmFtZX0gRGV0YWlsc2AgIC8vIGUuZy4sIFwiVGVhbSBEZXRhaWxzXCJcbiAgICB9O1xufVxuXG4vKipcbiAqIExhYmVsIGZpZWxkIGRldGVjdGlvbiByZXN1bHQgd2l0aCBjb25maWRlbmNlIHNjb3JpbmdcbiAqL1xuaW50ZXJmYWNlIExhYmVsRmllbGREZXRlY3Rpb25SZXN1bHQge1xuICAgIGZpZWxkOiBzdHJpbmc7XG4gICAgY29uZmlkZW5jZTogJ2hpZ2gnIHwgJ21lZGl1bSc7ICAvLyBPbmx5IGhpZ2ggb3IgbWVkaXVtIC0gbm8gbG93IGNvbmZpZGVuY2UgcmVzdWx0cyByZXR1cm5lZFxuICAgIG1ldGhvZDogJ21ldGFkYXRhJyB8ICdjb21tb24tcGF0dGVybicgfCAnZW50aXR5LXBhdHRlcm4nIHwgJ3N1ZmZpeC1wYXR0ZXJuJztcbn1cblxuLyoqXG4gKiBTbWFydCBsYWJlbCBmaWVsZCBkZXRlY3Rpb24gZm9yIGVudGl0eSBvcHRpb25zLlxuICogVXNlcyBnZW5lcmljIHBhdHRlcm5zIHRvIGZpbmQgZGlzcGxheSBmaWVsZHMgdGhhdCBhcmUgYWN0dWFsIGlkZW50aWZpZXJzL25hbWVzLlxuICogXG4gKiAqKkhJR0hMWSBDT05TRVJWQVRJVkUqKjogT25seSByZXR1cm5zIGZpZWxkcyB0aGF0IGFyZSBjbGVhcmx5IG1lYW50IGZvciBkaXNwbGF5LlxuICogUmV0dXJucyB1bmRlZmluZWQgaWYgbm8gcHJvcGVyIG5hbWUgZmllbGQgaXMgZm91bmQgLSBiZXR0ZXIgdG8gc2hvdyBJRCB0aGFuIGNvbmZ1c2UgdXNlcnMuXG4gKiBcbiAqIERldGVjdGlvbiBvcmRlciAoYWxsIEhJR0ggb3IgTUVESVVNIGNvbmZpZGVuY2UpOlxuICogMS4gRW50aXR5IG1ldGFkYXRhIChlbnRpdHlOYW1lQXR0cmlidXRlKSAtIEhJR0ggY29uZmlkZW5jZVxuICogMi4gQ29tbW9uIGRpc3BsYXkgZmllbGQgcGF0dGVybnMgKG5hbWUsIHRpdGxlLCBsYWJlbCwgZGlzcGxheU5hbWUpIC0gSElHSCBjb25maWRlbmNlICBcbiAqIDMuIEVudGl0eS1zcGVjaWZpYyBwYXR0ZXJucyAoe2VudGl0eU5hbWV9TmFtZSwge2VudGl0eU5hbWV9VGl0bGUpIC0gSElHSCBjb25maWRlbmNlXG4gKiA0LiBGaWVsZHMgZW5kaW5nIHdpdGggbmFtZS1saWtlIHN1ZmZpeGVzIChOYW1lLCBUaXRsZSwgTGFiZWwsIENvZGUpIC0gTUVESVVNIGNvbmZpZGVuY2VcbiAqIFxuICogKipOTyBGQUxMQkFDSyoqOiBJZiBub25lIG9mIHRoZSBhYm92ZSBtYXRjaCwgcmV0dXJucyB1bmRlZmluZWQuXG4gKiBXZSBkbyBOT1QgcGljayBnZW5lcmljIGZpZWxkcyBsaWtlICdzdGF0dXMnLCAndHlwZScsIG9yIHJhbmRvbSBlbnVtcy9zdHJpbmdzLlxuICogXG4gKiBXaHkgbm8gZmFsbGJhY2s/XG4gKiAtIFNob3dpbmcgXCJhY3RpdmVcIi9cImNhbmNlbGxlZFwiIGZvciBzdWJzY3JpcHRpb25zIGlzIGNvbmZ1c2luZyAod2hpY2ggc3Vic2NyaXB0aW9uPylcbiAqIC0gU2hvd2luZyBcImNyZWRpdF9jYXJkXCIvXCJwYXlwYWxcIiBmb3IgcGF5bWVudCBtZXRob2RzIGlzIG5vdCBhbiBpZGVudGlmaWVyXG4gKiAtIEJldHRlciB0byBzaG93IHN1YnNjcmlwdGlvbklkIHRoYW4gbWlzbGVhZGluZyBmaWVsZHNcbiAqIFxuICogRm9yIGVudGl0aWVzIHdpdGhvdXQgbmFtZSBmaWVsZHMsIHVzZSBvbmUgb2Y6XG4gKiAtIFNldCBlbnRpdHlOYW1lQXR0cmlidXRlIGluIHNjaGVtYSBtZXRhZGF0YVxuICogLSBVc2Ugb3B0aW9uTWFwcGluZyBpbiByZWxhdGlvbiBjb25maWdcbiAqIC0gTGV0IGl0IGZhbGwgYmFjayB0byBJRCAoY2xlYXJlc3Qgb3B0aW9uKVxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gRW50aXRpZXMgd2l0aCBjbGVhciBuYW1lIGZpZWxkcyAtIERFVEVDVEVEIOKchVxuICogVGVhbSDihpIgdGVhbU5hbWUgKFByaW9yaXR5IDMsIEhJR0ggY29uZmlkZW5jZSlcbiAqIFVzZXIg4oaSIG5hbWUgKFByaW9yaXR5IDIsIEhJR0ggY29uZmlkZW5jZSlcbiAqIFBvc3Qg4oaSIHBvc3RUaXRsZSAoUHJpb3JpdHkgNCwgTUVESVVNIGNvbmZpZGVuY2UpXG4gKiBcbiAqIEBleGFtcGxlICBcbiAqIC8vIEVudGl0aWVzIHdpdGhvdXQgbmFtZSBmaWVsZHMgLSBSRVRVUk5TIHVuZGVmaW5lZCDinIVcbiAqIFN1YnNjcmlwdGlvbiDihpIgdW5kZWZpbmVkIChmYWxscyBiYWNrIHRvIHN1YnNjcmlwdGlvbklkIC0gY2xlYXIhKVxuICogUGF5bWVudE1ldGhvZCDihpIgdW5kZWZpbmVkIChmYWxscyBiYWNrIHRvIHBheW1lbnRNZXRob2RJZCAtIGNsZWFyISlcbiAqIEF1ZGl0TG9nIOKGkiB1bmRlZmluZWQgKGZhbGxzIGJhY2sgdG8gYXVkaXRMb2dJZCAtIGNsZWFyISlcbiAqIFxuICogQHBhcmFtIHNjaGVtYSAtIEVudGl0eSBzY2hlbWFcbiAqIEBwYXJhbSBlbnRpdHlOYW1lIC0gRW50aXR5IG5hbWUgKGUuZy4sICd0ZWFtJywgJ3VzZXInKVxuICogQHBhcmFtIG9wdGlvbnMgLSBEZXRlY3Rpb24gb3B0aW9uc1xuICogQHJldHVybnMgQmVzdCBsYWJlbCBmaWVsZCBuYW1lIG9yIHVuZGVmaW5lZCAod2lsbCBmYWxsIGJhY2sgdG8gSUQgZmllbGQpXG4gKi9cbmZ1bmN0aW9uIGZpbmRMYWJlbEZpZWxkKFxuICAgIHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBvcHRpb25zPzoge1xuICAgICAgICAvKiogTWluaW11bSBjb25maWRlbmNlIGxldmVsIHJlcXVpcmVkIChkZWZhdWx0OiAnbWVkaXVtJykgKi9cbiAgICAgICAgbWluQ29uZmlkZW5jZT86ICdoaWdoJyB8ICdtZWRpdW0nO1xuICAgICAgICAvKiogRW5hYmxlIGRlYnVnIGxvZ2dpbmcgKGRlZmF1bHQ6IGZhbHNlKSAqL1xuICAgICAgICBkZWJ1Zz86IGJvb2xlYW47XG4gICAgfVxuKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBtaW5Db25maWRlbmNlID0gb3B0aW9ucz8ubWluQ29uZmlkZW5jZSB8fCAnbWVkaXVtJztcbiAgICBjb25zdCBkZWJ1ZyA9IG9wdGlvbnM/LmRlYnVnIHx8IGZhbHNlO1xuXG4gICAgbGV0IHJlc3VsdDogTGFiZWxGaWVsZERldGVjdGlvblJlc3VsdCB8IHVuZGVmaW5lZDtcblxuICAgIC8vIEdldCBhbGwgYXR0cmlidXRlcyBmcm9tIHNjaGVtYVxuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSBzY2hlbWEuYXR0cmlidXRlcztcbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lcyA9IE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpO1xuXG4gICAgLy8gUHJpb3JpdHkgMTogRW50aXR5IG1ldGFkYXRhIC0gSElHSCBjb25maWRlbmNlXG4gICAgY29uc3QgZW50aXR5TmFtZUF0dHJpYnV0ZSA9IHNjaGVtYS5tb2RlbC5lbnRpdHlOYW1lQXR0cmlidXRlO1xuICAgIGlmIChlbnRpdHlOYW1lQXR0cmlidXRlICYmIGF0dHJpYnV0ZXNbIGVudGl0eU5hbWVBdHRyaWJ1dGUgXSkge1xuICAgICAgICByZXN1bHQgPSB7XG4gICAgICAgICAgICBmaWVsZDogZW50aXR5TmFtZUF0dHJpYnV0ZSxcbiAgICAgICAgICAgIGNvbmZpZGVuY2U6ICdoaWdoJyxcbiAgICAgICAgICAgIG1ldGhvZDogJ21ldGFkYXRhJ1xuICAgICAgICB9O1xuICAgICAgICBpZiAoZGVidWcpIHtcbiAgICAgICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW2ZpbmRMYWJlbEZpZWxkXSAke2VudGl0eU5hbWV9OiBGb3VuZCB2aWEgbWV0YWRhdGEgLSAke2VudGl0eU5hbWVBdHRyaWJ1dGV9IChISUdIIGNvbmZpZGVuY2UpYCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBQcmlvcml0eSAyOiBDb21tb24gZGlzcGxheSBwYXR0ZXJucyAtIEhJR0ggY29uZmlkZW5jZVxuICAgIGlmICghcmVzdWx0KSB7XG4gICAgICAgIGNvbnN0IGNvbW1vblBhdHRlcm5zID0gWyAnbmFtZScsICd0aXRsZScsICdsYWJlbCcsICdkaXNwbGF5TmFtZScsICdkaXNwbGF5bmFtZScgXTtcbiAgICAgICAgZm9yIChjb25zdCBwYXR0ZXJuIG9mIGNvbW1vblBhdHRlcm5zKSB7XG4gICAgICAgICAgICBjb25zdCBtYXRjaCA9IGF0dHJpYnV0ZU5hbWVzLmZpbmQoYXR0ciA9PiBhdHRyLnRvTG93ZXJDYXNlKCkgPT09IHBhdHRlcm4pO1xuICAgICAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0ID0ge1xuICAgICAgICAgICAgICAgICAgICBmaWVsZDogbWF0Y2gsXG4gICAgICAgICAgICAgICAgICAgIGNvbmZpZGVuY2U6ICdoaWdoJyxcbiAgICAgICAgICAgICAgICAgICAgbWV0aG9kOiAnY29tbW9uLXBhdHRlcm4nXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBpZiAoZGVidWcpIHtcbiAgICAgICAgICAgICAgICAgICAgRGVmYXVsdExvZ2dlci5pbmZvKGBbZmluZExhYmVsRmllbGRdICR7ZW50aXR5TmFtZX06IEZvdW5kIHZpYSBjb21tb24gcGF0dGVybiAnJHtwYXR0ZXJufScgLSAke21hdGNofSAoSElHSCBjb25maWRlbmNlKWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFByaW9yaXR5IDM6IEVudGl0eS1zcGVjaWZpYyBwYXR0ZXJucyAtIEhJR0ggY29uZmlkZW5jZVxuICAgIGlmICghcmVzdWx0KSB7XG4gICAgICAgIGNvbnN0IGVudGl0eUxvd2VyID0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICBjb25zdCBlbnRpdHlTcGVjaWZpY1N1ZmZpeGVzID0gWyAnTmFtZScsICdUaXRsZScsICdMYWJlbCcgXTtcblxuICAgICAgICBmb3IgKGNvbnN0IHN1ZmZpeCBvZiBlbnRpdHlTcGVjaWZpY1N1ZmZpeGVzKSB7XG4gICAgICAgICAgICAvLyBUcnkgZXhhY3QgbWF0Y2g6IGUuZy4sICd0ZWFtTmFtZScgZm9yIGVudGl0eSAndGVhbSdcbiAgICAgICAgICAgIGNvbnN0IGV4YWN0TWF0Y2ggPSBhdHRyaWJ1dGVOYW1lcy5maW5kKGF0dHIgPT5cbiAgICAgICAgICAgICAgICBhdHRyLnRvTG93ZXJDYXNlKCkgPT09IGAke2VudGl0eUxvd2VyfSR7c3VmZml4LnRvTG93ZXJDYXNlKCl9YFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGlmIChleGFjdE1hdGNoKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0ID0ge1xuICAgICAgICAgICAgICAgICAgICBmaWVsZDogZXhhY3RNYXRjaCxcbiAgICAgICAgICAgICAgICAgICAgY29uZmlkZW5jZTogJ2hpZ2gnLFxuICAgICAgICAgICAgICAgICAgICBtZXRob2Q6ICdlbnRpdHktcGF0dGVybidcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIGlmIChkZWJ1Zykge1xuICAgICAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtmaW5kTGFiZWxGaWVsZF0gJHtlbnRpdHlOYW1lfTogRm91bmQgdmlhIGVudGl0eS1zcGVjaWZpYyBwYXR0ZXJuIC0gJHtleGFjdE1hdGNofSAoSElHSCBjb25maWRlbmNlKWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFByaW9yaXR5IDQ6IEZpZWxkcyBlbmRpbmcgd2l0aCBuYW1lLWxpa2Ugc3VmZml4ZXMgLSBNRURJVU0gY29uZmlkZW5jZVxuICAgIC8vIExvb2sgZm9yIGFueSBmaWVsZCBlbmRpbmcgd2l0aCAnTmFtZScsICdUaXRsZScsICdMYWJlbCcgKGUuZy4sICdkaXNwbGF5TmFtZScsICdmdWxsTmFtZScsICd1c2VyTmFtZScsKVxuICAgIGlmICghcmVzdWx0KSB7XG4gICAgICAgIGNvbnN0IGRpc3BsYXlOYW1lU3VmZml4UGF0dGVybiA9IC9EaXNwbGF5TmFtZSQvO1xuICAgICAgICBjb25zdCBuYW1lU3VmZml4UGF0dGVybiA9IC9OYW1lJC87XG4gICAgICAgIGNvbnN0IHRpdGxlU3VmZml4UGF0dGVybiA9IC9UaXRsZSQvO1xuICAgICAgICBjb25zdCBsYWJlbFN1ZmZpeFBhdHRlcm4gPSAvTGFiZWwkLztcbiAgICAgICAgY29uc3QgY29kZVN1ZmZpeFBhdHRlcm4gPSAvQ29kZSQvO1xuXG4gICAgICAgIGZvciAoY29uc3QgcGF0dGVybiBvZiBbIGRpc3BsYXlOYW1lU3VmZml4UGF0dGVybiwgbGFiZWxTdWZmaXhQYXR0ZXJuLCB0aXRsZVN1ZmZpeFBhdHRlcm4sIG5hbWVTdWZmaXhQYXR0ZXJuLCBjb2RlU3VmZml4UGF0dGVybiBdKSB7XG4gICAgICAgICAgICBjb25zdCBtYXRjaCA9IGF0dHJpYnV0ZU5hbWVzLmZpbmQoYXR0ciA9PiBwYXR0ZXJuLnRlc3QoYXR0cikpO1xuICAgICAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0ID0ge1xuICAgICAgICAgICAgICAgICAgICBmaWVsZDogbWF0Y2gsXG4gICAgICAgICAgICAgICAgICAgIGNvbmZpZGVuY2U6ICdtZWRpdW0nLFxuICAgICAgICAgICAgICAgICAgICBtZXRob2Q6ICdzdWZmaXgtcGF0dGVybidcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIGlmIChkZWJ1Zykge1xuICAgICAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtmaW5kTGFiZWxGaWVsZF0gJHtlbnRpdHlOYW1lfTogRm91bmQgdmlhIHN1ZmZpeCBwYXR0ZXJuIC0gJHttYXRjaH0gKE1FRElVTSBjb25maWRlbmNlKWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFByaW9yaXR5IDU6IE5PIEZBTExCQUNLIC0gSWYgd2UgY2FuJ3QgZmluZCBhIHByb3BlciBuYW1lIGZpZWxkLCByZXR1cm4gdW5kZWZpbmVkXG4gICAgLy8gQmV0dGVyIHRvIHNob3cgSUQgdGhhbiB0byBzaG93IGNvbmZ1c2luZyBmaWVsZHMgbGlrZSAnc3RhdHVzJywgJ3R5cGUnLCBldGMuXG4gICAgLy8gXG4gICAgLy8gRW50aXRpZXMgbGlrZSBTdWJzY3JpcHRpb24sIFBheW1lbnRNZXRob2QgZG9uJ3QgaGF2ZSB0cmFkaXRpb25hbCBuYW1lIGZpZWxkcy5cbiAgICAvLyBTaG93aW5nIFwiYWN0aXZlXCIgb3IgXCJjcmVkaXRfY2FyZFwiIGluIGEgZHJvcGRvd24gaXMgY29uZnVzaW5nIC0gdXNlcnMgY2FuJ3QgZGlzdGluZ3Vpc2ggaXRlbXMuXG4gICAgLy8gSXQncyBjbGVhcmVyIHRvIHNob3cgdGhlIElEIChzdWJzY3JpcHRpb25JZCwgcGF5bWVudE1ldGhvZElkKSBpbiBzdWNoIGNhc2VzLlxuICAgIC8vXG4gICAgLy8gSWYgeW91IG5lZWQgY3VzdG9tIGxhYmVscyBmb3IgdGhlc2UgZW50aXRpZXMsIGV4cGxpY2l0bHkgc2V0IGVudGl0eU5hbWVBdHRyaWJ1dGUgaW4gdGhlIHNjaGVtYVxuICAgIC8vIG9yIHVzZSBvcHRpb25NYXBwaW5nIGluIHRoZSByZWxhdGlvbiBjb25maWcuXG5cbiAgICAvLyBDaGVjayBjb25maWRlbmNlIHRocmVzaG9sZFxuICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgLy8gT25seSByZXR1cm4gaWYgY29uZmlkZW5jZSBtZWV0cyBtaW5pbXVtIHJlcXVpcmVtZW50XG4gICAgICAgIC8vIG1pbkNvbmZpZGVuY2U6ICdoaWdoJyDihpIgb25seSByZXR1cm4gSElHSCBjb25maWRlbmNlIHJlc3VsdHNcbiAgICAgICAgLy8gbWluQ29uZmlkZW5jZTogJ21lZGl1bScg4oaSIHJldHVybiBISUdIIG9yIE1FRElVTSBjb25maWRlbmNlIHJlc3VsdHMgKGRlZmF1bHQpXG4gICAgICAgIGlmIChtaW5Db25maWRlbmNlID09PSAnaGlnaCcgJiYgcmVzdWx0LmNvbmZpZGVuY2UgPT09ICdtZWRpdW0nKSB7XG4gICAgICAgICAgICBpZiAoZGVidWcpIHtcbiAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYFtmaW5kTGFiZWxGaWVsZF0gJHtlbnRpdHlOYW1lfTogRmllbGQgJyR7cmVzdWx0LmZpZWxkfScgZm91bmQgd2l0aCBNRURJVU0gY29uZmlkZW5jZSwgYnV0IEhJR0ggY29uZmlkZW5jZSByZXF1aXJlZC4gUmV0dXJuaW5nIHVuZGVmaW5lZC5gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzdWx0LmZpZWxkO1xuICAgIH1cblxuICAgIC8vIE5vIHN1aXRhYmxlIGZpZWxkIGZvdW5kXG4gICAgaWYgKGRlYnVnKSB7XG4gICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgW2ZpbmRMYWJlbEZpZWxkXSAke2VudGl0eU5hbWV9OiBObyBzdWl0YWJsZSBsYWJlbCBmaWVsZCBmb3VuZCB3aXRoIHN1ZmZpY2llbnQgY29uZmlkZW5jZS5gKTtcbiAgICB9XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBSRUxBVElPTiBPUFRJT04gQ09ORklHIFJFU09MVVRJT05cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIFJlc29sdmVzIFJlbGF0aW9uRW50aXR5T3B0aW9uQ29uZmlnIGludG8gRmllbGRPcHRpb25zQVBJQ29uZmlnIGJ5IGF1dG8tZGV0ZWN0aW5nOlxuICogLSBDUlVEIEFQSSBwYXRoIGZyb20gZW50aXR5IHNjaGVtYVxuICogLSBMYWJlbCBmaWVsZCBmcm9tIGVudGl0eU5hbWVBdHRyaWJ1dGUgbWV0YWRhdGEgb3Igc21hcnQgZGV0ZWN0aW9uXG4gKiAtIFZhbHVlIGZpZWxkIGZyb20gcmVsYXRpb24gaWRlbnRpZmllcnNcbiAqIFxuICogQHBhcmFtIHJlbGF0aW9uQ29uZmlnIC0gTWluaW1hbCByZWxhdGlvbiBvcHRpb24gY29uZmlnXG4gKiBAcGFyYW0gcmVsYXRpb25BdHRyaWJ1dGUgLSBUaGUgcmVsYXRpb24gYXR0cmlidXRlICh0byBnZXQgaWRlbnRpZmllcnMpXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIGZvciBzY2hlbWEgbG9va3VwXG4gKiBAcGFyYW0gZ2xvYmFsVUlDb25maWdPcHRpb25zIC0gR2xvYmFsIFVJIGNvbmZpZyBvcHRpb25zIChmb3IgbGFiZWwgZmllbGQgZGV0ZWN0aW9uKVxuICogQHJldHVybnMgRnVsbHkgcmVzb2x2ZWQgRmllbGRPcHRpb25zQVBJQ29uZmlnIG9yIHVuZGVmaW5lZCBpZiBlbnRpdHkgbm90IGZvdW5kXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUmVsYXRpb25PcHRpb25Db25maWcoXG4gICAgcmVsYXRpb25Db25maWc6IFJlbGF0aW9uRW50aXR5T3B0aW9uQ29uZmlnLFxuICAgIHJlbGF0aW9uQXR0cmlidXRlOiBUSU9TY2hlbWFBdHRyaWJ1dGUgJiB7IHJlbGF0aW9uOiBOb25OdWxsYWJsZTxUSU9TY2hlbWFBdHRyaWJ1dGVbICdyZWxhdGlvbicgXT4gfSxcbiAgICBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+LFxuICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sgJ3VpQ29uZmlnR2VuT3B0aW9ucycgXVxuKTogRmllbGRPcHRpb25zQVBJQ29uZmlnPGFueT4gfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSwgY3VzdG9tQXBpVXJsLCBvcHRpb25NYXBwaW5nLCAuLi5yZXN0IH0gPSByZWxhdGlvbkNvbmZpZztcbiAgICBjb25zdCByZWxhdGlvbiA9IHJlbGF0aW9uQXR0cmlidXRlLnJlbGF0aW9uO1xuXG4gICAgLy8gR2V0IHJlbGF0ZWQgZW50aXR5IHNlcnZpY2VcbiAgICBpZiAoIWVudGl0eVNlcnZpY2UuaGFzRW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShlbnRpdHlOYW1lKSkge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYFtyZXNvbHZlUmVsYXRpb25PcHRpb25Db25maWddIEVudGl0eSBzZXJ2aWNlIG5vdCBmb3VuZCBmb3I6ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCByZWxhdGVkU2VydmljZSA9IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShlbnRpdHlOYW1lKTtcbiAgICBjb25zdCByZWxhdGVkU2NoZW1hID0gcmVsYXRlZFNlcnZpY2U/LmdldEVudGl0eVNjaGVtYT8uKCk7XG5cbiAgICBpZiAoIXJlbGF0ZWRTY2hlbWEpIHtcbiAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBbcmVzb2x2ZVJlbGF0aW9uT3B0aW9uQ29uZmlnXSBTY2hlbWEgbm90IGZvdW5kIGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyAxLiBSZXNvbHZlIEFQSSBVUkxcbiAgICBjb25zdCBlbnRpdHlOYW1lTG93ZXIgPSBlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgY3J1ZFBhdGggPSByZWxhdGVkU2NoZW1hLm1vZGVsLkNSVURBcGlQYXRoIHx8ICcnO1xuICAgIGNvbnN0IGFwaVVybCA9IGN1c3RvbUFwaVVybCB8fCBgJHtjcnVkUGF0aH0vJHtlbnRpdHlOYW1lTG93ZXJ9YDtcblxuICAgIC8vIDIuIFJlc29sdmUgdmFsdWUgZmllbGQgZnJvbSByZWxhdGlvbiBpZGVudGlmaWVyc1xuICAgIGNvbnN0IHJlc29sdmVkSWRlbnRpZmllcnMgPSB0eXBlb2YgcmVsYXRpb24uaWRlbnRpZmllcnMgPT09ICdmdW5jdGlvbicgPyByZWxhdGlvbi5pZGVudGlmaWVycygpIDogcmVsYXRpb24uaWRlbnRpZmllcnM7XG4gICAgY29uc3QgaWRlbnRpZmllck1hcHBpbmdzID0gQXJyYXkuaXNBcnJheShyZXNvbHZlZElkZW50aWZpZXJzKSA/IHJlc29sdmVkSWRlbnRpZmllcnMgOiBbIHJlc29sdmVkSWRlbnRpZmllcnMgXTtcbiAgICBjb25zdCBwcmltYXJ5SWRlbnRpZmllciA9IGlkZW50aWZpZXJNYXBwaW5nc1sgMCBdO1xuICAgIGNvbnN0IHZhbHVlRmllbGQgPSBTdHJpbmcocHJpbWFyeUlkZW50aWZpZXIudGFyZ2V0KTtcblxuICAgIC8vIDMuIFJlc29sdmUgbGFiZWwgZmllbGQgZnJvbSBlbnRpdHkgbWV0YWRhdGEgb3IgY3VzdG9tIG1hcHBpbmdcbiAgICBsZXQgbGFiZWxGaWVsZCA9IHZhbHVlRmllbGQ7IC8vIERlZmF1bHQgZmFsbGJhY2sgdG8gdmFsdWUgZmllbGRcblxuICAgIGlmIChvcHRpb25NYXBwaW5nPy5sYWJlbCkge1xuICAgICAgICAvLyBDdXN0b20gbGFiZWwgcHJvdmlkZWQgLSB1c2UgaXRcbiAgICAgICAgbGFiZWxGaWVsZCA9IG9wdGlvbk1hcHBpbmcubGFiZWwgYXMgc3RyaW5nO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEF1dG8tZGV0ZWN0IHVzaW5nIHNtYXJ0IHBhdHRlcm4gbWF0Y2hpbmcgd2l0aCBnbG9iYWwgY29uZmlnXG4gICAgICAgIGNvbnN0IGxhYmVsRmllbGRDb25maWcgPSBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/LmxhYmVsRmllbGREZXRlY3Rpb247XG4gICAgICAgIGxhYmVsRmllbGQgPSBmaW5kTGFiZWxGaWVsZChyZWxhdGVkU2NoZW1hLCBlbnRpdHlOYW1lLCB7XG4gICAgICAgICAgICBtaW5Db25maWRlbmNlOiBsYWJlbEZpZWxkQ29uZmlnPy5taW5Db25maWRlbmNlIHx8ICdtZWRpdW0nLFxuICAgICAgICAgICAgZGVidWc6IGxhYmVsRmllbGRDb25maWc/LmRlYnVnIHx8IGZhbHNlXG4gICAgICAgIH0pIHx8IHZhbHVlRmllbGQ7XG4gICAgfVxuXG4gICAgLy8gNC4gQnVpbGQgY29tcGxldGUgRmllbGRPcHRpb25zQVBJQ29uZmlnXG4gICAgcmV0dXJuIHtcbiAgICAgICAgYXBpTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgYXBpVXJsLFxuICAgICAgICByZXNwb25zZUtleTogJ2l0ZW1zJyxcbiAgICAgICAgb3B0aW9uTWFwcGluZzogb3B0aW9uTWFwcGluZyB8fCB7XG4gICAgICAgICAgICBsYWJlbDogbGFiZWxGaWVsZCxcbiAgICAgICAgICAgIHZhbHVlOiAob3B0aW9uTWFwcGluZyBhcyBhbnkpPy52YWx1ZSB8fCB2YWx1ZUZpZWxkXG4gICAgICAgIH0sXG4gICAgICAgIC4uLnJlc3QgLy8gUGFzcyB0aHJvdWdoIGZpbHRlcnMsIGNvdW50LCBkaXNhYmxlU2VhcmNoLCBldGMuXG4gICAgfTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBGSUxURVIgQVVUTy1HRU5FUkFUSU9OXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBBdXRvLWdlbmVyYXRlcyBmaWx0ZXJDb25maWcgZm9yIGVudGl0eSBhdHRyaWJ1dGVzIGJhc2VkIG9uIGZpZWxkIHR5cGUuXG4gKiBcbiAqIEFsZ29yaXRobTpcbiAqIDEuIENoZWNrIGlmIGV4cGxpY2l0IGZpbHRlckNvbmZpZyBhbHJlYWR5IGV4aXN0cyDihpIgdXNlIGl0XG4gKiAyLiBDaGVjayBpZiBmaWVsZCBpcyBleHBsaWNpdGx5IG5vbi1maWx0ZXJhYmxlIOKGkiBza2lwXG4gKiAzLiBEZXRlY3QgZmllbGQgdHlwZSBhbmQgZ2VuZXJhdGUgYXBwcm9wcmlhdGUgY29uZmlnXG4gKiA0LiBNZXJnZSB3aXRoIGdsb2JhbCBhbmQgZW50aXR5LWxldmVsIG92ZXJyaWRlc1xuICogXG4gKiBAcGFyYW0gYXR0cmlidXRlIC0gVGhlIGF0dHJpYnV0ZSB0byBnZW5lcmF0ZSBmaWx0ZXIgY29uZmlnIGZvclxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSBmb3IgYWNjZXNzaW5nIGVudGl0eSBtZXRhZGF0YVxuICogQHBhcmFtIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyAtIEdsb2JhbCBVSSBjb25maWd1cmF0aW9uIG9wdGlvbnNcbiAqIEByZXR1cm5zIEdlbmVyYXRlZCBmaWx0ZXIgY29uZmlndXJhdGlvbiBvciB1bmRlZmluZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdlbmVyYXRlRmlsdGVyQ29uZmlnKFxuICAgIGF0dHJpYnV0ZTogVElPU2NoZW1hQXR0cmlidXRlLFxuICAgIGVudGl0eVNlcnZpY2U/OiBCYXNlRW50aXR5U2VydmljZTxhbnk+LFxuICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sgJ3VpQ29uZmlnR2VuT3B0aW9ucycgXVxuKTogRmllbGRNZXRhZGF0YVsgJ2ZpbHRlckNvbmZpZycgXSB8IHVuZGVmaW5lZCB7XG4gICAgLy8gMS4gSWYgZXhwbGljaXQgZmlsdGVyQ29uZmlnIGV4aXN0cywgdXNlIGl0IChoaWdoZXN0IHByaW9yaXR5KVxuICAgIGlmIChhdHRyaWJ1dGUuZmlsdGVyQ29uZmlnKSB7XG4gICAgICAgIHJldHVybiBhdHRyaWJ1dGUuZmlsdGVyQ29uZmlnO1xuICAgIH1cblxuICAgIC8vIDIuIElmIGZpZWxkIGhhcyBleHBsaWNpdCBvcHRpb25zIGNvbmZpZywgdXNlIGl0XG4gICAgaWYgKCdvcHRpb25zJyBpbiBhdHRyaWJ1dGUpIHtcbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IChhdHRyaWJ1dGUgYXMgU2VsZWN0RmllbGRNZXRhZGF0YSkub3B0aW9ucztcblxuICAgICAgICAvLyBSZWxhdGlvbkVudGl0eU9wdGlvbkNvbmZpZyAoaGFzIGVudGl0eU5hbWUpIOKGkiByZXNvbHZlIHRvIEZpZWxkT3B0aW9uc0FQSUNvbmZpZ1xuICAgICAgICBjb25zdCBpc1JlbGF0aW9uQ29uZmlnID0gdHlwZW9mIG9wdGlvbnMgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KG9wdGlvbnMpICYmICdlbnRpdHlOYW1lJyBpbiBvcHRpb25zO1xuXG4gICAgICAgIGxldCByZXNvbHZlZENvbmZpZzogRmllbGRPcHRpb25zQVBJQ29uZmlnPGFueT4gfCBGaWVsZE9wdGlvbltdIHwgdW5kZWZpbmVkO1xuXG4gICAgICAgIC8vIElubGluZSBhcnJheSDihpIgdXNlIGFzIGlzXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KG9wdGlvbnMpICYmIG9wdGlvbnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgcmVzb2x2ZWRDb25maWcgPSBvcHRpb25zIGFzIEZpZWxkT3B0aW9uW107XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGaWVsZE9wdGlvbnNBUElDb25maWcgKGhhcyBhcGlNZXRob2QsIGFwaVVybCwgcmVzcG9uc2VLZXkpIOKGkiBwYXNzIHRocm91Z2hcbiAgICAgICAgY29uc3QgaXNBcGlDb25maWcgPSB0eXBlb2Ygb3B0aW9ucyA9PT0gJ29iamVjdCcgJiYgIUFycmF5LmlzQXJyYXkob3B0aW9ucykgJiYgJ2FwaU1ldGhvZCcgaW4gb3B0aW9ucztcbiAgICAgICAgaWYgKGlzQXBpQ29uZmlnKSB7XG4gICAgICAgICAgICByZXNvbHZlZENvbmZpZyA9IG9wdGlvbnMgYXMgRmllbGRPcHRpb25zQVBJQ29uZmlnPGFueT47XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaXNSZWxhdGlvbkNvbmZpZyAmJiBhdHRyaWJ1dGUucmVsYXRpb24gJiYgZW50aXR5U2VydmljZSkge1xuICAgICAgICAgICAgcmVzb2x2ZWRDb25maWcgPSByZXNvbHZlUmVsYXRpb25PcHRpb25Db25maWcoXG4gICAgICAgICAgICAgICAgb3B0aW9ucyBhcyBSZWxhdGlvbkVudGl0eU9wdGlvbkNvbmZpZyxcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGUgYXMgVElPU2NoZW1hQXR0cmlidXRlICYgeyByZWxhdGlvbjogTm9uTnVsbGFibGU8VElPU2NoZW1hQXR0cmlidXRlWyAncmVsYXRpb24nIF0+IH0sXG4gICAgICAgICAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgICAgICAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnNcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocmVzb2x2ZWRDb25maWcpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgZmlsdGVyVHlwZTogJ3NlbGVjdCcsXG4gICAgICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiAnZXEnIGFzIGNvbnN0LFxuICAgICAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogWyAnZXEnLCAnbmVxJywgJ2luTGlzdCcsICdub3RJbkxpc3QnLCAnaXNFbXB0eScsICdpc051bGwnIF0sXG4gICAgICAgICAgICAgICAgcHJlZGVmaW5lZE9wdGlvbnM6IHJlc29sdmVkQ29uZmlnXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gZWxzZSBsb2cgZXJyb3JcbiAgICAgICAgdGhyb3cgbmV3IEZyYW1ld29ya0Vycm9yKGBbZ2VuZXJhdGVGaWx0ZXJDb25maWddIE5vIHJlc29sdmVkIGNvbmZpZyBmb3VuZCBmb3IgYXR0cmlidXRlOiAke2F0dHJpYnV0ZS5pZH1gLCB7XG4gICAgICAgICAgICBhdHRyaWJ1dGU6IGF0dHJpYnV0ZSxcbiAgICAgICAgICAgIG9wdGlvbnM6IG9wdGlvbnMsXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIDMuIElmIGZpZWxkIGlzIGV4cGxpY2l0bHkgbm9uLWZpbHRlcmFibGUsIHNraXBcbiAgICBpZiAoYXR0cmlidXRlLmlzRmlsdGVyYWJsZSA9PT0gZmFsc2UpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyAzLiBHZXQgZ2xvYmFsIGFuZCBlbnRpdHktbGV2ZWwgY29uZmlnXG4gICAgY29uc3QgZ2xvYmFsRmlsdGVyQ29uZmlnID0gZ2xvYmFsVUlDb25maWdPcHRpb25zPy50YWJsZVVJPy5maWx0ZXJBdXRvR2VuZXJhdGlvbjtcbiAgICBjb25zdCBlbnRpdHlNZXRhZGF0YSA9IGVudGl0eVNlcnZpY2U/LmdldEVudGl0eVNjaGVtYT8uKCkubW9kZWw/Lm1ldGFkYXRhIGFzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PlsgJ21vZGVsJyBdWyAnbWV0YWRhdGEnIF07XG4gICAgY29uc3QgZW50aXR5RmlsdGVyQ29uZmlnID0gZW50aXR5TWV0YWRhdGE/LnRhYmxlVUk/LmZpbHRlckF1dG9HZW5lcmF0aW9uO1xuXG4gICAgLy8gTWVyZ2UgY29uZmlncyAoZW50aXR5ID4gZ2xvYmFsID4gZGVmYXVsdHMpXG4gICAgY29uc3QgbWVyZ2VkQ29uZmlnID0ge1xuICAgICAgICBlbmFibGVkOiBlbnRpdHlGaWx0ZXJDb25maWc/LmVuYWJsZWQgPz8gZ2xvYmFsRmlsdGVyQ29uZmlnPy5lbmFibGVkID8/IHRydWUsXG4gICAgICAgIGRhdGVGaWVsZHM6IHtcbiAgICAgICAgICAgIC4uLmdsb2JhbEZpbHRlckNvbmZpZz8uZGF0ZUZpZWxkcyxcbiAgICAgICAgICAgIC4uLmVudGl0eUZpbHRlckNvbmZpZz8uZGF0ZUZpZWxkc1xuICAgICAgICB9LFxuICAgICAgICBlbnVtRmllbGRzOiB7XG4gICAgICAgICAgICAuLi5nbG9iYWxGaWx0ZXJDb25maWc/LmVudW1GaWVsZHMsXG4gICAgICAgICAgICAuLi5lbnRpdHlGaWx0ZXJDb25maWc/LmVudW1GaWVsZHNcbiAgICAgICAgfSxcbiAgICAgICAgYm9vbGVhbkZpZWxkczoge1xuICAgICAgICAgICAgLi4uZ2xvYmFsRmlsdGVyQ29uZmlnPy5ib29sZWFuRmllbGRzLFxuICAgICAgICAgICAgLi4uZW50aXR5RmlsdGVyQ29uZmlnPy5ib29sZWFuRmllbGRzXG4gICAgICAgIH0sXG4gICAgICAgIHJlbGF0aW9uRmllbGRzOiB7XG4gICAgICAgICAgICAuLi5nbG9iYWxGaWx0ZXJDb25maWc/LnJlbGF0aW9uRmllbGRzLFxuICAgICAgICAgICAgLi4uZW50aXR5RmlsdGVyQ29uZmlnPy5yZWxhdGlvbkZpZWxkc1xuICAgICAgICB9LFxuICAgICAgICBudW1iZXJGaWVsZHM6IHtcbiAgICAgICAgICAgIC4uLmdsb2JhbEZpbHRlckNvbmZpZz8ubnVtYmVyRmllbGRzLFxuICAgICAgICAgICAgLi4uZW50aXR5RmlsdGVyQ29uZmlnPy5udW1iZXJGaWVsZHNcbiAgICAgICAgfSxcbiAgICAgICAgdGV4dEZpZWxkczoge1xuICAgICAgICAgICAgLi4uZ2xvYmFsRmlsdGVyQ29uZmlnPy50ZXh0RmllbGRzLFxuICAgICAgICAgICAgLi4uZW50aXR5RmlsdGVyQ29uZmlnPy50ZXh0RmllbGRzXG4gICAgICAgIH0sXG4gICAgICAgIGRlYnVnOiBlbnRpdHlGaWx0ZXJDb25maWc/LmRlYnVnID8/IGdsb2JhbEZpbHRlckNvbmZpZz8uZGVidWcgPz8gZmFsc2VcbiAgICB9O1xuXG4gICAgLy8gSWYgZ2xvYmFsbHkgZGlzYWJsZWQsIHNraXBcbiAgICBpZiAoIW1lcmdlZENvbmZpZy5lbmFibGVkKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgY29uc3QgYXR0clR5cGUgPSBhdHRyaWJ1dGUudHlwZTtcbiAgICBjb25zdCBmaWVsZFR5cGUgPSBhdHRyaWJ1dGUuZmllbGRUeXBlO1xuXG4gICAgLy8gKioxLiBCb29sZWFuIGZpZWxkcyoqXG4gICAgaWYgKGF0dHJUeXBlID09PSAnYm9vbGVhbicgJiYgbWVyZ2VkQ29uZmlnLmJvb2xlYW5GaWVsZHM/LmVuYWJsZWQgIT09IGZhbHNlKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBmaWx0ZXJUeXBlOiAnYm9vbGVhbicsXG4gICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6ICdlcScsXG4gICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IFsgJ2VxJywgJ25lcScsICdpc0VtcHR5JywgJ2lzTnVsbCcgXSxcbiAgICAgICAgICAgIHByZWRlZmluZWRPcHRpb25zOiBbXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ1llcycsIHZhbHVlOiBcInRydWVcIiB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdObycsIHZhbHVlOiBcImZhbHNlXCIgfVxuICAgICAgICAgICAgXVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vICoqMi4gRW51bSBmaWVsZHMgKGFycmF5IG9mIHN0cmluZ3MvbnVtYmVycykqKlxuICAgIGlmIChBcnJheS5pc0FycmF5KGF0dHJUeXBlKSAmJiBtZXJnZWRDb25maWcuZW51bUZpZWxkcz8uZW5hYmxlZCAhPT0gZmFsc2UpIHtcbiAgICAgICAgY29uc3QgZGVmYXVsdEVudW1PcHMgPSBbICdlcScsICduZXEnLCAnaW5MaXN0JywgJ25vdEluTGlzdCcsICdpc0VtcHR5JywgJ2lzTnVsbCcgXSBhcyBjb25zdDtcbiAgICAgICAgY29uc3QgZGVmYXVsdE9wID0gbWVyZ2VkQ29uZmlnLmVudW1GaWVsZHM/LmRlZmF1bHRPcGVyYXRvciB8fCAoJ2VxJyk7XG4gICAgICAgIGNvbnN0IGF2YWlsYWJsZU9wcyA9IG1lcmdlZENvbmZpZy5lbnVtRmllbGRzPy5hdmFpbGFibGVPcGVyYXRvcnMgfHwgZGVmYXVsdEVudW1PcHM7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGZpbHRlclR5cGU6ICdzZWxlY3QnLFxuICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBkZWZhdWx0T3AsXG4gICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IGF2YWlsYWJsZU9wcyxcbiAgICAgICAgICAgIHByZWRlZmluZWRPcHRpb25zOiBhdHRyVHlwZS5tYXAodmFsID0+ICh7XG4gICAgICAgICAgICAgICAgbGFiZWw6IFN0cmluZyh2YWwpLFxuICAgICAgICAgICAgICAgIHZhbHVlOiBTdHJpbmcodmFsKSAgLy8gQWx3YXlzIGNvbnZlcnQgdG8gc3RyaW5nIGZvciBjb25zaXN0ZW5jeVxuICAgICAgICAgICAgfSkpXG4gICAgICAgIH07XG4gICAgfVxuXG5cbiAgICAvLyAqKjMuIERhdGUvRGF0ZXRpbWUgZmllbGRzKipcbiAgICBpZiAoKGZpZWxkVHlwZSA9PT0gJ2RhdGUnIHx8IGZpZWxkVHlwZSA9PT0gJ2RhdGV0aW1lJyB8fCAoYXR0clR5cGUgPT09ICdzdHJpbmcnICYmIChhdHRyaWJ1dGUuaWQudG9Mb3dlckNhc2UoKS5pbmNsdWRlcygnZGF0ZScpIHx8IGF0dHJpYnV0ZS5pZC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKCd0aW1lJykpKSlcbiAgICAgICAgJiYgbWVyZ2VkQ29uZmlnLmRhdGVGaWVsZHM/LmVuYWJsZWQgIT09IGZhbHNlKSB7XG4gICAgICAgIGNvbnN0IGRlZmF1bHREYXRlT3BzID0gWyAnZXEnLCAnbmVxJywgJ2d0JywgJ2d0ZScsICdsdCcsICdsdGUnLCAnYmV0d2VlbicsICdpc0VtcHR5JywgJ2lzTnVsbCcgXSBhcyBjb25zdDtcbiAgICAgICAgY29uc3Qgb3BlcmF0b3JzID0gbWVyZ2VkQ29uZmlnLmRhdGVGaWVsZHM/LmRlZmF1bHRPcGVyYXRvcnMgfHwgZGVmYXVsdERhdGVPcHM7XG5cbiAgICAgICAgY29uc3QgZmlsdGVyQ29uZmlnOiBhbnkgPSB7XG4gICAgICAgICAgICBmaWx0ZXJUeXBlOiAnZGF0ZXRpbWUnLFxuICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBvcGVyYXRvcnNbIDAgXSB8fCAoJ2d0ZScpLFxuICAgICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBvcGVyYXRvcnNcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBBZGQgcXVpY2sgZGF0ZSBmaWx0ZXJzIGlmIGVuYWJsZWRcbiAgICAgICAgaWYgKG1lcmdlZENvbmZpZy5kYXRlRmllbGRzPy5xdWlja0ZpbHRlcnMgIT09IGZhbHNlKSB7XG4gICAgICAgICAgICBmaWx0ZXJDb25maWcucHJlZGVmaW5lZE9wdGlvbnMgPSBbXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ1RvZGF5JywgdmFsdWU6ICc6c3RhcnRPZlRvZGF5JyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdZZXN0ZXJkYXknLCB2YWx1ZTogJzpzdGFydE9mWWVzdGVyZGF5JyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdUaGlzIFdlZWsnLCB2YWx1ZTogJzpzdGFydE9mV2VlaycgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnTGFzdCBXZWVrJywgdmFsdWU6ICc6c3RhcnRPZkxhc3RXZWVrJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdUaGlzIE1vbnRoJywgdmFsdWU6ICc6c3RhcnRPZk1vbnRoJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdMYXN0IE1vbnRoJywgdmFsdWU6ICc6c3RhcnRPZkxhc3RNb250aCcgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnVGhpcyBRdWFydGVyJywgdmFsdWU6ICc6c3RhcnRPZlF1YXJ0ZXInIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ0xhc3QgUXVhcnRlcicsIHZhbHVlOiAnOnN0YXJ0T2ZMYXN0UXVhcnRlcicgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnVGhpcyBZZWFyJywgdmFsdWU6ICc6c3RhcnRPZlllYXInIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ0xhc3QgWWVhcicsIHZhbHVlOiAnOnN0YXJ0T2ZMYXN0WWVhcicgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnTGFzdCA3IERheXMnLCB2YWx1ZTogJzpub3dNaW51czdEYXlzJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdMYXN0IDMwIERheXMnLCB2YWx1ZTogJzpub3dNaW51czMwRGF5cycgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnTGFzdCA5MCBEYXlzJywgdmFsdWU6ICc6bm93TWludXM5MERheXMnIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ0N1c3RvbSBEYXRlJywgdmFsdWU6IG51bGwgfSAgLy8gVHJpZ2dlcnMgZGF0ZXRpbWUtbG9jYWwgaW5wdXRcbiAgICAgICAgICAgIF07XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZmlsdGVyQ29uZmlnO1xuICAgIH1cblxuICAgIC8vICoqNS4gTnVtYmVyIGZpZWxkcyoqXG4gICAgaWYgKGF0dHJUeXBlID09PSAnbnVtYmVyJyAmJiBtZXJnZWRDb25maWcubnVtYmVyRmllbGRzPy5lbmFibGVkICE9PSBmYWxzZSkge1xuICAgICAgICBjb25zdCBkZWZhdWx0TnVtYmVyT3BzID0gWyAnZXEnLCAnbmVxJywgJ2d0JywgJ2d0ZScsICdsdCcsICdsdGUnLCAnYmV0d2VlbicsICdpc0VtcHR5JywgJ2lzTnVsbCcgXSBhcyBjb25zdDtcbiAgICAgICAgY29uc3Qgb3BlcmF0b3JzID0gbWVyZ2VkQ29uZmlnLm51bWJlckZpZWxkcz8uZGVmYXVsdE9wZXJhdG9ycyB8fCBkZWZhdWx0TnVtYmVyT3BzO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZmlsdGVyVHlwZTogJ251bWJlcicsXG4gICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IG9wZXJhdG9yc1sgMCBdIHx8ICgnZXEnKSxcbiAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogb3BlcmF0b3JzXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gKio0LiBSZWxhdGlvbiBmaWVsZHMgKHdpdGhvdXQgZXhwbGljaXQgb3B0aW9ucykgLSBhdXRvLWdlbmVyYXRlIGZyb20gcmVsYXRpb24gbWV0YWRhdGEqKlxuICAgIGlmIChhdHRyaWJ1dGUucmVsYXRpb24gJiYgbWVyZ2VkQ29uZmlnLnJlbGF0aW9uRmllbGRzPy5lbmFibGVkICE9PSBmYWxzZSAmJiBlbnRpdHlTZXJ2aWNlKSB7XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uQ29uZmlnOiBSZWxhdGlvbkVudGl0eU9wdGlvbkNvbmZpZyA9IHsgZW50aXR5TmFtZTogYXR0cmlidXRlLnJlbGF0aW9uLmVudGl0eU5hbWUgfTtcbiAgICAgICAgY29uc3QgcmVzb2x2ZWQgPSByZXNvbHZlUmVsYXRpb25PcHRpb25Db25maWcoXG4gICAgICAgICAgICByZWxhdGlvbkNvbmZpZyxcbiAgICAgICAgICAgIGF0dHJpYnV0ZSBhcyBUSU9TY2hlbWFBdHRyaWJ1dGUgJiB7IHJlbGF0aW9uOiBOb25OdWxsYWJsZTxUSU9TY2hlbWFBdHRyaWJ1dGVbICdyZWxhdGlvbicgXT4gfSxcbiAgICAgICAgICAgIGVudGl0eVNlcnZpY2UsXG4gICAgICAgICAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnNcbiAgICAgICAgKTtcblxuICAgICAgICBpZiAocmVzb2x2ZWQpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgZmlsdGVyVHlwZTogJ3JlbGF0aW9uJyxcbiAgICAgICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6ICdlcScgYXMgY29uc3QsXG4gICAgICAgICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBbICdlcScsICduZXEnLCAnaW5MaXN0JywgJ25vdEluTGlzdCcsICdpc0VtcHR5JywgJ2lzTnVsbCcgXSxcbiAgICAgICAgICAgICAgICBwcmVkZWZpbmVkT3B0aW9uczogcmVzb2x2ZWRcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyAqKjYuIFRleHQgZmllbGRzIChkZWZhdWx0IGZhbGxiYWNrKSoqXG4gICAgaWYgKGF0dHJUeXBlID09PSAnc3RyaW5nJyAmJiBtZXJnZWRDb25maWcudGV4dEZpZWxkcz8uZW5hYmxlZCAhPT0gZmFsc2UpIHtcbiAgICAgICAgY29uc3QgZGVmYXVsdFRleHRPcHMgPSBbICdjb250YWlucycsICdub3RDb250YWlucycsICdlcScsICduZXEnLCAnc3RhcnRzV2l0aCcsICdlbmRzV2l0aCcsICdsaWtlJywgJ2lzRW1wdHknLCAnaXNOdWxsJyBdO1xuICAgICAgICBjb25zdCBvcGVyYXRvcnMgPSBtZXJnZWRDb25maWcudGV4dEZpZWxkcz8uZGVmYXVsdE9wZXJhdG9ycyB8fCBkZWZhdWx0VGV4dE9wcztcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGZpbHRlclR5cGU6ICd0ZXh0JyxcbiAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogb3BlcmF0b3JzWyAwIF0gfHwgKCdjb250YWlucycpLFxuICAgICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBvcGVyYXRvcnNcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBEZWJ1ZyBsb2dnaW5nXG4gICAgaWYgKG1lcmdlZENvbmZpZy5kZWJ1Zykge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtGaWx0ZXJBdXRvR2VuXSAke2F0dHJpYnV0ZS5pZH06IE5vIGZpbHRlciBjb25maWcgZ2VuZXJhdGVkICh0eXBlOiAke2F0dHJUeXBlfSlgKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNFR01FTlQgQVVUTy1HRU5FUkFUSU9OXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBTbWFydCBpY29uIG1hcHBpbmcgZm9yIHNlZ21lbnQgdmFsdWVzLlxuICogUHJvdmlkZXMgc2Vuc2libGUgZGVmYXVsdHMgZm9yIGNvbW1vbiBzdGF0dXMvc3RhdGUgcGF0dGVybnMuXG4gKiBJY29ucyBtYXRjaCB1aTI0L3NyYy9jb3JlL2NvbW1vbi9JY29ucy9JY29ucy50c3ggbmFtaW5nIGNvbnZlbnRpb25zLlxuICovXG5jb25zdCBERUZBVUxUX0lDT05fTUFQUElORzogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgICAvLyBBY3RpdmUvSW5hY3RpdmUgcGF0dGVybnNcbiAgICAnYWN0aXZlJzogJ0NoZWNrQ2lyY2xlT3V0bGluZWQnLFxuICAgICdpbmFjdGl2ZSc6ICdDbG9zZUNpcmNsZU91dGxpbmVkJyxcbiAgICAnZW5hYmxlZCc6ICdDaGVja0NpcmNsZU91dGxpbmVkJyxcbiAgICAnZGlzYWJsZWQnOiAnQ2xvc2VDaXJjbGVPdXRsaW5lZCcsXG5cbiAgICAvLyBTdGF0dXMgcGF0dGVybnNcbiAgICAncGVuZGluZyc6ICdDbG9ja0NpcmNsZU91dGxpbmVkJyxcbiAgICAnaW4tcHJvZ3Jlc3MnOiAnU3luY091dGxpbmVkJyxcbiAgICAnaW5wcm9ncmVzcyc6ICdTeW5jT3V0bGluZWQnLFxuICAgICdjb21wbGV0ZWQnOiAnQ2hlY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2RvbmUnOiAnQ2hlY2tPdXRsaW5lZCcsXG4gICAgJ2ZpbmlzaGVkJzogJ0NoZWNrQ2lyY2xlT3V0bGluZWQnLFxuICAgICdjYW5jZWxsZWQnOiAnQ2xvc2VDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2NhbmNlbGVkJzogJ0Nsb3NlQ2lyY2xlT3V0bGluZWQnLFxuICAgICdmYWlsZWQnOiAnQ2xvc2VDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2Vycm9yJzogJ0V4Y2xhbWF0aW9uQ2lyY2xlT3V0bGluZWQnLFxuICAgICdwYXVzZWQnOiAnUGF1c2VDaXJjbGVPdXRsaW5lZCcsXG5cbiAgICAvLyBTY2hlZHVsaW5nIHBhdHRlcm5zXG4gICAgJ3NjaGVkdWxlZCc6ICdDYWxlbmRhck91dGxpbmVkJyxcbiAgICAndXBjb21pbmcnOiAnQ2FsZW5kYXJPdXRsaW5lZCcsXG4gICAgJ2xpdmUnOiAnUGxheUNpcmNsZU91dGxpbmVkJyxcbiAgICAnZHJhZnQnOiAnRmlsZU91dGxpbmVkJyxcbiAgICAncHVibGlzaGVkJzogJ0NoZWNrQ2lyY2xlT3V0bGluZWQnLFxuICAgICdhcmNoaXZlZCc6ICdGb2xkZXJPdXRsaW5lZCcsXG5cbiAgICAvLyBQcmlvcml0eSBwYXR0ZXJuc1xuICAgICdsb3cnOiAnRG93bk91dGxpbmVkJyxcbiAgICAnbWVkaXVtJzogJ01pbnVzT3V0bGluZWQnLFxuICAgICdoaWdoJzogJ1VwT3V0bGluZWQnLFxuICAgICdjcml0aWNhbCc6ICdXYXJuaW5nT3V0bGluZWQnLFxuICAgICd1cmdlbnQnOiAnRmlyZU91dGxpbmVkJyxcblxuICAgIC8vIEFwcHJvdmFsIHBhdHRlcm5zXG4gICAgJ2FwcHJvdmVkJzogJ0NoZWNrQ2lyY2xlT3V0bGluZWQnLFxuICAgICdyZWplY3RlZCc6ICdDbG9zZUNpcmNsZU91dGxpbmVkJyxcbiAgICAncmV2aWV3JzogJ0V5ZU91dGxpbmVkJyxcblxuICAgIC8vIEJvb2xlYW4gVHJ1ZS9GYWxzZVxuICAgICd0cnVlJzogJ0NoZWNrQ2lyY2xlT3V0bGluZWQnLFxuICAgICdmYWxzZSc6ICdDbG9zZUNpcmNsZU91dGxpbmVkJ1xufTtcblxuLyoqXG4gKiBJbnRlbGxpZ2VudGx5IGV4dHJhY3QgYm9vbGVhbiBsYWJlbHMgZnJvbSBmaWVsZCBuYW1lIHBhdHRlcm5zLlxuICogU3VwcG9ydHMgY29tbW9uIGJvb2xlYW4gcHJlZml4ZXMgbGlrZSBpcy9oYXMvY2FuL3Nob3VsZC93aWxsL2V0Yy5cbiAqIFxuICogQGV4YW1wbGVcbiAqIC0gaXNBY3RpdmUg4oaSIFwiQWN0aXZlXCIgLyBcIkluYWN0aXZlXCJcbiAqIC0gaGFzUGVybWlzc2lvbiDihpIgXCJIYXMgUGVybWlzc2lvblwiIC8gXCJObyBQZXJtaXNzaW9uXCJcbiAqIC0gY2FuRWRpdCDihpIgXCJDYW4gRWRpdFwiIC8gXCJDYW5ub3QgRWRpdFwiXG4gKiAtIGlzTGl2ZSDihpIgXCJMaXZlXCIgLyBcIk5vdCBMaXZlXCJcbiAqIC0gc2hvdWxkTm90aWZ5IOKGkiBcIlNob3VsZCBOb3RpZnlcIiAvIFwiU2hvdWxkIE5vdCBOb3RpZnlcIlxuICovXG5mdW5jdGlvbiBleHRyYWN0Qm9vbGVhbkxhYmVsc0Zyb21GaWVsZE5hbWUoZmllbGROYW1lOiBzdHJpbmcpOiB7IHRydWVMYWJlbDogc3RyaW5nOyBmYWxzZUxhYmVsOiBzdHJpbmcgfSB8IG51bGwge1xuICAgIC8vIENvbW1vbiBib29sZWFuIHByZWZpeGVzIHdpdGggdGhlaXIgbmVnYXRpdmUgZm9ybXNcbiAgICBjb25zdCBwYXR0ZXJucyA9IFtcbiAgICAgICAgLy8gUGF0dGVybjogaXMgKyBYWFhcbiAgICAgICAge1xuICAgICAgICAgICAgcmVnZXg6IC9eaXMoW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiB0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pLFxuICAgICAgICAgICAgZ2V0RmFsc2VMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgYmFzZSA9IHRvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSk7XG4gICAgICAgICAgICAgICAgLy8gU3BlY2lhbCBjYXNlcyBmb3IgYmV0dGVyIG5lZ2F0aW9uXG4gICAgICAgICAgICAgICAgaWYgKGJhc2UudG9Mb3dlckNhc2UoKSA9PT0gJ2FjdGl2ZScpIHJldHVybiAnSW5hY3RpdmUnO1xuICAgICAgICAgICAgICAgIGlmIChiYXNlLnRvTG93ZXJDYXNlKCkgPT09ICdlbmFibGVkJykgcmV0dXJuICdEaXNhYmxlZCc7XG4gICAgICAgICAgICAgICAgaWYgKGJhc2UudG9Mb3dlckNhc2UoKSA9PT0gJ3Zpc2libGUnKSByZXR1cm4gJ0hpZGRlbic7XG4gICAgICAgICAgICAgICAgaWYgKGJhc2UudG9Mb3dlckNhc2UoKSA9PT0gJ3B1YmxpYycpIHJldHVybiAnUHJpdmF0ZSc7XG4gICAgICAgICAgICAgICAgaWYgKGJhc2UudG9Mb3dlckNhc2UoKSA9PT0gJ2F2YWlsYWJsZScpIHJldHVybiAnVW5hdmFpbGFibGUnO1xuICAgICAgICAgICAgICAgIHJldHVybiBgTm90ICR7YmFzZX1gO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICAvLyBQYXR0ZXJuOiBoYXMgKyBYWFhcbiAgICAgICAge1xuICAgICAgICAgICAgcmVnZXg6IC9eaGFzKFtBLVpdW2EtekEtWjAtOV0qKS8sXG4gICAgICAgICAgICBnZXRUcnVlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYEhhcyAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSl9YCxcbiAgICAgICAgICAgIGdldEZhbHNlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYE5vICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBhdHRlcm46IGNhbiArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL15jYW4oW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgQ2FuICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gLFxuICAgICAgICAgICAgZ2V0RmFsc2VMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgQ2Fubm90ICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBhdHRlcm46IHNob3VsZCArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL15zaG91bGQoW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgU2hvdWxkICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gLFxuICAgICAgICAgICAgZ2V0RmFsc2VMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgU2hvdWxkIE5vdCAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSl9YFxuICAgICAgICB9LFxuICAgICAgICAvLyBQYXR0ZXJuOiB3aWxsICsgWFhYXG4gICAgICAgIHtcbiAgICAgICAgICAgIHJlZ2V4OiAvXndpbGwoW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgV2lsbCAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSl9YCxcbiAgICAgICAgICAgIGdldEZhbHNlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYFdpbGwgTm90ICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBhdHRlcm46IGFsbG93cyArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL15hbGxvd3MoW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgQWxsb3dzICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gLFxuICAgICAgICAgICAgZ2V0RmFsc2VMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgRG9lcyBOb3QgQWxsb3cgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWBcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGF0dGVybjogbmVlZHMgKyBYWFhcbiAgICAgICAge1xuICAgICAgICAgICAgcmVnZXg6IC9ebmVlZHMoW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgTmVlZHMgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWAsXG4gICAgICAgICAgICBnZXRGYWxzZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBEb2VzIE5vdCBOZWVkICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBhdHRlcm46IHJlcXVpcmVzICsgWFhYXG4gICAgICAgIHtcbiAgICAgICAgICAgIHJlZ2V4OiAvXnJlcXVpcmVzKFtBLVpdW2EtekEtWjAtOV0qKS8sXG4gICAgICAgICAgICBnZXRUcnVlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYFJlcXVpcmVzICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gLFxuICAgICAgICAgICAgZ2V0RmFsc2VMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgRG9lcyBOb3QgUmVxdWlyZSAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSl9YFxuICAgICAgICB9XG4gICAgXTtcblxuICAgIGZvciAoY29uc3QgcGF0dGVybiBvZiBwYXR0ZXJucykge1xuICAgICAgICBjb25zdCBtYXRjaCA9IGZpZWxkTmFtZS5tYXRjaChwYXR0ZXJuLnJlZ2V4KTtcbiAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIHRydWVMYWJlbDogcGF0dGVybi5nZXRUcnVlTGFiZWwobWF0Y2gpLFxuICAgICAgICAgICAgICAgIGZhbHNlTGFiZWw6IHBhdHRlcm4uZ2V0RmFsc2VMYWJlbChtYXRjaClcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBHZXQgdGhlIG51bWJlciBvZiBvcHRpb25zIGZvciBhIGZpZWxkLlxuICovXG5mdW5jdGlvbiBnZXRGaWVsZE9wdGlvbkNvdW50KGZpZWxkOiBUSU9TY2hlbWFBdHRyaWJ1dGUpOiBudW1iZXIge1xuICAgIC8vIDEuIEVudW0gdHlwZSBhcnJheVxuICAgIGlmIChBcnJheS5pc0FycmF5KGZpZWxkLnR5cGUpKSB7XG4gICAgICAgIHJldHVybiBmaWVsZC50eXBlLmxlbmd0aDtcbiAgICB9XG5cbiAgICAvLyAyLiBCb29sZWFuIGZpZWxkXG4gICAgaWYgKGZpZWxkLnR5cGUgPT09ICdib29sZWFuJykge1xuICAgICAgICByZXR1cm4gMjtcbiAgICB9XG5cbiAgICAvLyAzLiBTZWxlY3QvcmFkaW8vY2hlY2tib3ggZmllbGQgd2l0aCBpbmxpbmUgb3B0aW9uc1xuICAgIGNvbnN0IGZpZWxkVHlwZSA9IGZpZWxkLmZpZWxkVHlwZTtcbiAgICBpZiAoZmllbGRUeXBlID09PSAnc2VsZWN0JyB8fCBmaWVsZFR5cGUgPT09ICdyYWRpbycgfHwgZmllbGRUeXBlID09PSAnY2hlY2tib3gnIHx8IGZpZWxkVHlwZSA9PT0gJ211bHRpLXNlbGVjdCcpIHtcbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IChmaWVsZCBhcyBhbnkpLm9wdGlvbnM7XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KG9wdGlvbnMpKSB7XG4gICAgICAgICAgICByZXR1cm4gb3B0aW9ucy5sZW5ndGg7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gMDtcbn1cblxuLyoqXG4gKiBDaGVjayBpZiBhIGZpZWxkIGlzIHZpYWJsZSBmb3Igc2VnbWVudCBnZW5lcmF0aW9uLlxuICogU3VwcG9ydHM6XG4gKiAtIEVudW0gdHlwZXM6IHR5cGU6IFsndmFsdWUxJywgJ3ZhbHVlMiddXG4gKiAtIEJvb2xlYW4gdHlwZXM6IHR5cGU6ICdib29sZWFuJ1xuICogLSBTZWxlY3QvcmFkaW8vY2hlY2tib3ggZmllbGRzIHdpdGggb3B0aW9uczogZmllbGRUeXBlOiAnc2VsZWN0JyArIG9wdGlvbnM6IFsuLi5dXG4gKiBcbiAqIFNUUklDVExZIGVuZm9yY2VzOiBtaW5WYWx1ZXMgPD0gb3B0aW9uQ291bnQgPD0gbWF4U2VnbWVudHNQZXJHcm91cFxuICovXG5mdW5jdGlvbiBpc1ZpYWJsZVNlZ21lbnRGaWVsZChcbiAgICBmaWVsZDogVElPU2NoZW1hQXR0cmlidXRlLFxuICAgIGNvbmZpZzogUmVxdWlyZWQ8SVNlZ21lbnRBdXRvR2VuZXJhdGlvbkNvbmZpZz4gJiB7IG1heFNlZ21lbnRzUGVyR3JvdXA/OiBudW1iZXIgfVxuKTogYm9vbGVhbiB7XG4gICAgY29uc3QgbWF4VmFsdWVzID0gY29uZmlnLm1heFNlZ21lbnRzUGVyR3JvdXAgfHwgMTA7XG4gICAgY29uc3Qgb3B0aW9uQ291bnQgPSBnZXRGaWVsZE9wdGlvbkNvdW50KGZpZWxkKTtcblxuICAgIC8vIE11c3QgaGF2ZSBvcHRpb25zIEFORCBiZSB3aXRoaW4gYm91bmRzXG4gICAgaWYgKG9wdGlvbkNvdW50ID09PSAwKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICAvLyBTVFJJQ1Q6IFJlamVjdCBpZiBvdXRzaWRlIGJvdW5kc1xuICAgIHJldHVybiBvcHRpb25Db3VudCA+PSBjb25maWcubWluVmFsdWVzICYmIG9wdGlvbkNvdW50IDw9IG1heFZhbHVlcztcbn1cblxuLyoqXG4gKiBJbnRlbGxpZ2VudGx5IGRldGVjdCB0aGUgYmVzdCBmaWVsZChzKSBmb3IgZ2VuZXJhdGluZyBzZWdtZW50cy5cbiAqIFJldHVybnMgbXVsdGlwbGUgZmllbGRzIGlmIG1heFNlZ21lbnRHcm91cHMgPiAxLlxuICogXG4gKiBQcmlvcml0eTpcbiAqIDEuIEV4cGxpY2l0IHNlZ21lbnRGaWVsZHMgKGVudGl0eSBjb25maWcpIOKGkiBVc2UgdGhvc2UgZmllbGRzXG4gKiAyLiBpbmNsdWRlRmllbGRzIGZpbHRlciAoZW50aXR5IGNvbmZpZykg4oaSIE9ubHkgY29uc2lkZXIgdGhlc2VcbiAqIDMuIGV4Y2x1ZGVGaWVsZHMgZmlsdGVyIChlbnRpdHkgY29uZmlnKSDihpIgU2tpcCB0aGVzZVxuICogNC4gcHJlZmVycmVkRmllbGRzIChnbG9iYWwvZW50aXR5IGNvbmZpZykg4oaSIFRyeSB0aGVzZSBmaXJzdFxuICogNS4gU2NvcmluZyBhbGdvcml0aG0g4oaSIFNjb3JlIGFsbCBjYW5kaWRhdGVzIGFuZCBwaWNrIHRvcCBOXG4gKi9cbmZ1bmN0aW9uIGRldGVjdFNlZ21lbnRGaWVsZHM8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxzdHJpbmcsIHN0cmluZywgc3RyaW5nPj4oXG4gICAgcHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlc01hcDxTPixcbiAgICBnbG9iYWxDb25maWc/OiBJU2VnbWVudEF1dG9HZW5lcmF0aW9uQ29uZmlnLFxuICAgIGVudGl0eUNvbmZpZz86IE5vbk51bGxhYmxlPFJldHVyblR5cGU8dHlwZW9mIEJhc2VFbnRpdHlTZXJ2aWNlLnByb3RvdHlwZS5nZXRFbnRpdHlTY2hlbWE+WyAnbW9kZWwnIF1bICdtZXRhZGF0YScgXT5bICd0YWJsZVVJJyBdXG4pOiBBcnJheTx7IGZpZWxkOiBUSU9TY2hlbWFBdHRyaWJ1dGU7IHNjb3JlOiBudW1iZXI7IHJlYXNvbjogc3RyaW5nIH0+IHtcbiAgICBjb25zdCBzZWdtZW50Q29uZmlnID0gZW50aXR5Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb247XG5cbiAgICAvLyBNZXJnZSBjb25maWdzIChlbnRpdHkgPiBnbG9iYWwgPiBkZWZhdWx0cylcbiAgICBjb25zdCBtZXJnZWRDb25maWc6IFJlcXVpcmVkPElTZWdtZW50QXV0b0dlbmVyYXRpb25Db25maWc+ICYgeyBtYXhTZWdtZW50R3JvdXBzOiBudW1iZXI7IG1heFNlZ21lbnRzUGVyR3JvdXA6IG51bWJlciB9ID0ge1xuICAgICAgICBlbmFibGVkOiBzZWdtZW50Q29uZmlnPy5lbmFibGVkID8/IGdsb2JhbENvbmZpZz8uZW5hYmxlZCA/PyB0cnVlLFxuICAgICAgICBwcmVmZXJyZWRGaWVsZHM6IHNlZ21lbnRDb25maWc/LnByZWZlcnJlZEZpZWxkcyB8fCBnbG9iYWxDb25maWc/LnByZWZlcnJlZEZpZWxkcyB8fCBbICdzdGF0dXMnLCAnc3RhdGUnLCAndHlwZScsICdjYXRlZ29yeScsICdwcmlvcml0eScgXSxcbiAgICAgICAgbWF4U2VnbWVudEdyb3Vwczogc2VnbWVudENvbmZpZz8ubWF4U2VnbWVudEdyb3VwcyA/PyBnbG9iYWxDb25maWc/Lm1heFNlZ21lbnRHcm91cHMgPz8gMixcbiAgICAgICAgbWF4U2VnbWVudHNQZXJHcm91cDogc2VnbWVudENvbmZpZz8ubWF4U2VnbWVudHNQZXJHcm91cCA/PyBnbG9iYWxDb25maWc/Lm1heFNlZ21lbnRzUGVyR3JvdXAgPz8gMTAsXG4gICAgICAgIG1pblZhbHVlczogc2VnbWVudENvbmZpZz8ubWluVmFsdWVzID8/IGdsb2JhbENvbmZpZz8ubWluVmFsdWVzID8/IDIsXG4gICAgICAgIGljb25NYXBwaW5nOiB7IC4uLkRFRkFVTFRfSUNPTl9NQVBQSU5HLCAuLi5nbG9iYWxDb25maWc/Lmljb25NYXBwaW5nLCAuLi5zZWdtZW50Q29uZmlnPy5pY29uTWFwcGluZyB9LFxuICAgICAgICBib29sZWFuTGFiZWxQYXR0ZXJuczogc2VnbWVudENvbmZpZz8uYm9vbGVhbkxhYmVsUGF0dGVybnMgfHwgZ2xvYmFsQ29uZmlnPy5ib29sZWFuTGFiZWxQYXR0ZXJucyB8fCBbXSxcbiAgICAgICAgZGVmYXVsdEJvb2xlYW5MYWJlbHM6IHNlZ21lbnRDb25maWc/LmRlZmF1bHRCb29sZWFuTGFiZWxzIHx8IGdsb2JhbENvbmZpZz8uZGVmYXVsdEJvb2xlYW5MYWJlbHMgfHwgeyB0cnVlOiAnWWVzJywgZmFsc2U6ICdObycgfSxcbiAgICAgICAgaW5jbHVkZUFsbFNlZ21lbnQ6IHNlZ21lbnRDb25maWc/LmluY2x1ZGVBbGxTZWdtZW50ID8/IGdsb2JhbENvbmZpZz8uaW5jbHVkZUFsbFNlZ21lbnQgPz8gdHJ1ZSxcbiAgICAgICAgZGVidWc6IHNlZ21lbnRDb25maWc/LmRlYnVnID8/IGdsb2JhbENvbmZpZz8uZGVidWcgPz8gZmFsc2VcbiAgICB9O1xuXG4gICAgaWYgKCFtZXJnZWRDb25maWcuZW5hYmxlZCkge1xuICAgICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgLy8gPT09IFBSSU9SSVRZIDE6IEV4cGxpY2l0IHNlZ21lbnQgZmllbGRzID09PVxuICAgIGNvbnN0IGV4cGxpY2l0RmllbGRzID0gc2VnbWVudENvbmZpZz8uc2VnbWVudEZpZWxkcyB8fCBzZWdtZW50Q29uZmlnPy5zZWdtZW50RmllbGQ7XG4gICAgaWYgKGV4cGxpY2l0RmllbGRzKSB7XG4gICAgICAgIGNvbnN0IGZpZWxkTmFtZXMgPSB0eXBlb2YgZXhwbGljaXRGaWVsZHMgPT09ICdzdHJpbmcnID8gWyBleHBsaWNpdEZpZWxkcyBdIDogZXhwbGljaXRGaWVsZHM7XG4gICAgICAgIGNvbnN0IHJlc3VsdHM6IEFycmF5PHsgZmllbGQ6IFRJT1NjaGVtYUF0dHJpYnV0ZTsgc2NvcmU6IG51bWJlcjsgcmVhc29uOiBzdHJpbmcgfT4gPSBbXTtcblxuICAgICAgICBmb3IgKGNvbnN0IGZpZWxkTmFtZSBvZiBmaWVsZE5hbWVzKSB7XG4gICAgICAgICAgICBjb25zdCBmaWVsZCA9IEFycmF5LmZyb20ocHJvcGVydGllcy52YWx1ZXMoKSkuZmluZChwID0+IHAuaWQgPT09IGZpZWxkTmFtZSk7XG4gICAgICAgICAgICBpZiAoZmllbGQpIHtcbiAgICAgICAgICAgICAgICByZXN1bHRzLnB1c2goeyBmaWVsZCwgc2NvcmU6IDEwMDAsIHJlYXNvbjogJ2V4cGxpY2l0IGNvbmZpZ3VyYXRpb24nIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHJlc3VsdHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdHMuc2xpY2UoMCwgbWVyZ2VkQ29uZmlnLm1heFNlZ21lbnRHcm91cHMpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gPT09IEZpbHRlciBwcm9wZXJ0aWVzIGJhc2VkIG9uIGluY2x1ZGUvZXhjbHVkZSA9PT1cbiAgICBsZXQgY2FuZGlkYXRlUHJvcGVydGllcyA9IEFycmF5LmZyb20ocHJvcGVydGllcy52YWx1ZXMoKSk7XG5cbiAgICAvLyBBcHBseSBpbmNsdWRlRmllbGRzIGZpbHRlciAoaWYgcHJvdmlkZWQsIE9OTFkgY29uc2lkZXIgdGhlc2UpXG4gICAgaWYgKHNlZ21lbnRDb25maWc/LmluY2x1ZGVGaWVsZHMgJiYgc2VnbWVudENvbmZpZy5pbmNsdWRlRmllbGRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY2FuZGlkYXRlUHJvcGVydGllcyA9IGNhbmRpZGF0ZVByb3BlcnRpZXMuZmlsdGVyKHAgPT5cbiAgICAgICAgICAgIHNlZ21lbnRDb25maWcuaW5jbHVkZUZpZWxkcyEuaW5jbHVkZXMocC5pZClcbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBBcHBseSBleGNsdWRlRmllbGRzIGZpbHRlclxuICAgIGlmIChzZWdtZW50Q29uZmlnPy5leGNsdWRlRmllbGRzICYmIHNlZ21lbnRDb25maWcuZXhjbHVkZUZpZWxkcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNhbmRpZGF0ZVByb3BlcnRpZXMgPSBjYW5kaWRhdGVQcm9wZXJ0aWVzLmZpbHRlcihwID0+XG4gICAgICAgICAgICAhc2VnbWVudENvbmZpZy5leGNsdWRlRmllbGRzIS5pbmNsdWRlcyhwLmlkKVxuICAgICAgICApO1xuICAgIH1cblxuICAgIC8vID09PSBQUklPUklUWSAyOiBQcmVmZXJyZWQgZmllbGRzID09PVxuICAgIGNvbnN0IHByZWZlcnJlZEZpZWxkcyA9IG1lcmdlZENvbmZpZy5wcmVmZXJyZWRGaWVsZHM7XG4gICAgY29uc3QgcHJlZmVycmVkTWF0Y2hlczogQXJyYXk8eyBmaWVsZDogVElPU2NoZW1hQXR0cmlidXRlOyBzY29yZTogbnVtYmVyOyByZWFzb246IHN0cmluZyB9PiA9IFtdO1xuXG4gICAgZm9yIChjb25zdCBwcmVmZXJyZWROYW1lIG9mIHByZWZlcnJlZEZpZWxkcykge1xuICAgICAgICBjb25zdCBmaWVsZCA9IGNhbmRpZGF0ZVByb3BlcnRpZXMuZmluZChwID0+IHAuaWQgPT09IHByZWZlcnJlZE5hbWUpO1xuICAgICAgICBpZiAoZmllbGQgJiYgaXNWaWFibGVTZWdtZW50RmllbGQoZmllbGQsIG1lcmdlZENvbmZpZykpIHtcbiAgICAgICAgICAgIHByZWZlcnJlZE1hdGNoZXMucHVzaCh7IGZpZWxkLCBzY29yZTogOTAwLCByZWFzb246IGBwcmVmZXJyZWQgZmllbGQ6ICR7cHJlZmVycmVkTmFtZX1gIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gSWYgd2UgaGF2ZSBlbm91Z2ggcHJlZmVycmVkIG1hdGNoZXMsIHJldHVybiB0aGVtXG4gICAgaWYgKHByZWZlcnJlZE1hdGNoZXMubGVuZ3RoID49IG1lcmdlZENvbmZpZy5tYXhTZWdtZW50R3JvdXBzKSB7XG4gICAgICAgIHJldHVybiBwcmVmZXJyZWRNYXRjaGVzLnNsaWNlKDAsIG1lcmdlZENvbmZpZy5tYXhTZWdtZW50R3JvdXBzKTtcbiAgICB9XG5cbiAgICAvLyA9PT0gUFJJT1JJVFkgMzogU2NvcmluZyBhbGdvcml0aG0gPT09XG4gICAgY29uc3QgY2FuZGlkYXRlczogQXJyYXk8eyBmaWVsZDogVElPU2NoZW1hQXR0cmlidXRlOyBzY29yZTogbnVtYmVyOyByZWFzb246IHN0cmluZzsgb3B0aW9uQ291bnQ6IG51bWJlciB9PiA9IFtdO1xuXG4gICAgLy8gQWRkIHByZWZlcnJlZE1hdGNoZXMgd2l0aCB0aGVpciBvcHRpb24gY291bnRzXG4gICAgZm9yIChjb25zdCBwbSBvZiBwcmVmZXJyZWRNYXRjaGVzKSB7XG4gICAgICAgIGNvbnN0IG9wdGlvbkNvdW50ID0gZ2V0RmllbGRPcHRpb25Db3VudChwbS5maWVsZCk7XG4gICAgICAgIGNhbmRpZGF0ZXMucHVzaCh7IC4uLnBtLCBvcHRpb25Db3VudCB9KTtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHByb3Agb2YgY2FuZGlkYXRlUHJvcGVydGllcykge1xuICAgICAgICAvLyBTa2lwIGlmIGFscmVhZHkgaW4gcHJlZmVycmVkTWF0Y2hlc1xuICAgICAgICBpZiAocHJlZmVycmVkTWF0Y2hlcy5zb21lKHBtID0+IHBtLmZpZWxkLmlkID09PSBwcm9wLmlkKSkge1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBTa2lwIGlmIG5vdCB2aWFibGUgKHRoaXMgZmlsdGVycyBvdXQgZmllbGRzIHdpdGggdG9vIG1hbnkgb3B0aW9ucylcbiAgICAgICAgaWYgKCFpc1ZpYWJsZVNlZ21lbnRGaWVsZChwcm9wLCBtZXJnZWRDb25maWcpKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBzY29yZSA9IDA7XG4gICAgICAgIGNvbnN0IHJlYXNvbnM6IHN0cmluZ1tdID0gW107XG4gICAgICAgIGNvbnN0IG9wdGlvbkNvdW50ID0gZ2V0RmllbGRPcHRpb25Db3VudChwcm9wKTtcblxuICAgICAgICAvLyAqKlNjb3JlIDE6IEZpZWxkIG5hbWUgbWF0Y2gqKiAocGFydGlhbCBtYXRjaCB3aXRoIHByZWZlcnJlZCBuYW1lcylcbiAgICAgICAgZm9yIChjb25zdCBwcmVmZXJyZWQgb2YgcHJlZmVycmVkRmllbGRzKSB7XG4gICAgICAgICAgICBpZiAocHJvcC5pZC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHByZWZlcnJlZC50b0xvd2VyQ2FzZSgpKSkge1xuICAgICAgICAgICAgICAgIHNjb3JlICs9IDUwO1xuICAgICAgICAgICAgICAgIHJlYXNvbnMucHVzaChgbmFtZSBjb250YWlucyBcIiR7cHJlZmVycmVkfVwiYCk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyAqKlNjb3JlIDI6IFByZWZlciBmZXdlciBvcHRpb25zIChpbnZlcnNlIHNjb3JpbmcpKipcbiAgICAgICAgLy8gRmllbGRzIHdpdGggZmV3ZXIgb3B0aW9ucyBnZXQgaGlnaGVyIHNjb3Jlc1xuICAgICAgICBjb25zdCBtaW5WYWx1ZXMgPSBtZXJnZWRDb25maWcubWluVmFsdWVzO1xuICAgICAgICBjb25zdCBtYXhWYWx1ZXMgPSBtZXJnZWRDb25maWcubWF4U2VnbWVudHNQZXJHcm91cDtcblxuICAgICAgICBpZiAob3B0aW9uQ291bnQgPj0gbWluVmFsdWVzICYmIG9wdGlvbkNvdW50IDw9IG1heFZhbHVlcykge1xuICAgICAgICAgICAgLy8gU2NvcmUgaW52ZXJzZWx5IHByb3BvcnRpb25hbCB0byBvcHRpb24gY291bnRcbiAgICAgICAgICAgIC8vIDIgb3B0aW9ucyA9ICs0MCwgNSBvcHRpb25zID0gKzI1LCAxMCBvcHRpb25zID0gKzEwXG4gICAgICAgICAgICBjb25zdCBvcHRpb25TY29yZSA9IE1hdGgubWF4KDEwLCA0MCAtIChvcHRpb25Db3VudCAtIG1pblZhbHVlcykgKiAzKTtcbiAgICAgICAgICAgIHNjb3JlICs9IG9wdGlvblNjb3JlO1xuICAgICAgICAgICAgcmVhc29ucy5wdXNoKGAke29wdGlvbkNvdW50fSBvcHRpb25zYCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyAqKlNjb3JlIDM6IEJvb2xlYW4gZmllbGQgZ2V0cyBoaWdoIHByaW9yaXR5IChvbmx5IDIgb3B0aW9ucykqKlxuICAgICAgICBpZiAocHJvcC50eXBlID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgICAgIHNjb3JlICs9IDU7ICAvLyBTbWFsbCBib251cyBzaW5jZSBvcHRpb24gY291bnQgYWxyZWFkeSBmYWN0b3JzIGluXG4gICAgICAgICAgICByZWFzb25zLnB1c2goJ2Jvb2xlYW4gZmllbGQnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vICoqU2NvcmUgNDogTmFtZSBwb3NpdGlvbiAoZWFybGllciA9IHNsaWdodGx5IGhpZ2hlciBwcmlvcml0eSkqKlxuICAgICAgICBjb25zdCBmaWVsZEluZGV4ID0gY2FuZGlkYXRlUHJvcGVydGllcy5pbmRleE9mKHByb3ApO1xuICAgICAgICBzY29yZSAtPSBNYXRoLm1pbihmaWVsZEluZGV4LCA1KTsgIC8vIENhcCBwZW5hbHR5IGF0IDVcblxuICAgICAgICBjYW5kaWRhdGVzLnB1c2goe1xuICAgICAgICAgICAgZmllbGQ6IHByb3AsXG4gICAgICAgICAgICBzY29yZSxcbiAgICAgICAgICAgIHJlYXNvbjogcmVhc29ucy5qb2luKCcsICcpLFxuICAgICAgICAgICAgb3B0aW9uQ291bnRcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gU29ydCBieTogMSkgc2NvcmUgKGhpZ2hlc3QgZmlyc3QpLCAyKSBvcHRpb24gY291bnQgKGxvd2VzdCBmaXJzdClcbiAgICBjYW5kaWRhdGVzLnNvcnQoKGEsIGIpID0+IHtcbiAgICAgICAgaWYgKGIuc2NvcmUgIT09IGEuc2NvcmUpIHtcbiAgICAgICAgICAgIHJldHVybiBiLnNjb3JlIC0gYS5zY29yZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gYS5vcHRpb25Db3VudCAtIGIub3B0aW9uQ291bnQ7ICAvLyBQcmVmZXIgZmV3ZXIgb3B0aW9uc1xuICAgIH0pO1xuXG4gICAgY29uc3QgdG9wTlJlc3VsdHMgPSBjYW5kaWRhdGVzLnNsaWNlKDAsIG1lcmdlZENvbmZpZy5tYXhTZWdtZW50R3JvdXBzKTtcblxuICAgIGlmICh0b3BOUmVzdWx0cy5sZW5ndGggPiAwICYmIG1lcmdlZENvbmZpZy5kZWJ1Zykge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtTZWdtZW50RGV0ZWN0aW9uXSBTZWxlY3RlZCAke3RvcE5SZXN1bHRzLmxlbmd0aH0gZmllbGQocyk6YCwgdG9wTlJlc3VsdHMubWFwKGMgPT4gKHtcbiAgICAgICAgICAgIGZpZWxkOiBjLmZpZWxkLmlkLFxuICAgICAgICAgICAgc2NvcmU6IGMuc2NvcmUsXG4gICAgICAgICAgICBvcHRpb25Db3VudDogYy5vcHRpb25Db3VudCxcbiAgICAgICAgICAgIHJlYXNvbjogYy5yZWFzb25cbiAgICAgICAgfSkpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdG9wTlJlc3VsdHM7XG59XG5cbi8qKlxuICogQXV0by1nZW5lcmF0ZSBmaWx0ZXIgc2VnbWVudHMgYmFzZWQgb24gZW50aXR5IGF0dHJpYnV0ZXMgdXNpbmcgc21hcnQgZGV0ZWN0aW9uLlxuICogXG4gKiBBbGdvcml0aG06XG4gKiAxLiBJZiBjdXN0b20gc2VnbWVudHMgcHJvdmlkZWQg4oaSIHVzZSB0aGVtIChoaWdoZXN0IHByaW9yaXR5KVxuICogMi4gSWYgZW50aXR5IHJlcXVpcmVzIG1hbnVhbCBzZWdtZW50cyDihpIgc2tpcCBhdXRvLWdlbmVyYXRpb25cbiAqIDMuIERldGVjdCBiZXN0IGZpZWxkIHVzaW5nIHNjb3JpbmcgYWxnb3JpdGhtXG4gKiA0LiBHZW5lcmF0ZSBzZWdtZW50cyBmcm9tIGRldGVjdGVkIGZpZWxkIHdpdGggc21hcnQgaWNvbnNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdlbmVyYXRlU2VnbWVudHM8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxzdHJpbmcsIHN0cmluZywgc3RyaW5nPj4oXG4gICAgcHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlc01hcDxTPixcbiAgICBlbnRpdHlTZXJ2aWNlPzogQmFzZUVudGl0eVNlcnZpY2U8Uz4sXG4gICAgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyAndWlDb25maWdHZW5PcHRpb25zJyBdLFxuICAgIGN1c3RvbVNlZ21lbnRzPzogUmVhZG9ubHlBcnJheTxJRmlsdGVyU2VnbWVudCB8IElGaWx0ZXJTZWdtZW50R3JvdXA+IHwgQXJyYXk8SUZpbHRlclNlZ21lbnQgfCBJRmlsdGVyU2VnbWVudEdyb3VwPlxuKTogUmVhZG9ubHlBcnJheTxJRmlsdGVyU2VnbWVudCB8IElGaWx0ZXJTZWdtZW50R3JvdXA+IHwgQXJyYXk8SUZpbHRlclNlZ21lbnQgfCBJRmlsdGVyU2VnbWVudEdyb3VwPiB8IHVuZGVmaW5lZCB7XG4gICAgLy8gMS4gSWYgY3VzdG9tIHNlZ21lbnRzIHByb3ZpZGVkLCB1c2UgdGhvc2UgKGhpZ2hlc3QgcHJpb3JpdHkpXG4gICAgaWYgKGN1c3RvbVNlZ21lbnRzICYmIGN1c3RvbVNlZ21lbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmV0dXJuIGN1c3RvbVNlZ21lbnRzO1xuICAgIH1cblxuICAgIC8vIEdldCBjb25maWd1cmF0aW9uXG4gICAgY29uc3QgZ2xvYmFsU2VnbWVudENvbmZpZyA9IGdsb2JhbFVJQ29uZmlnT3B0aW9ucz8udGFibGVVST8uc2VnbWVudEF1dG9HZW5lcmF0aW9uO1xuICAgIGNvbnN0IGVudGl0eU1ldGFkYXRhID0gZW50aXR5U2VydmljZT8uZ2V0RW50aXR5U2NoZW1hPy4oKS5tb2RlbD8ubWV0YWRhdGE7XG4gICAgY29uc3QgZW50aXR5U2VnbWVudENvbmZpZyA9IGVudGl0eU1ldGFkYXRhPy50YWJsZVVJO1xuXG4gICAgLy8gMi4gSWYgZW50aXR5IHJlcXVpcmVzIG1hbnVhbCBzZWdtZW50cywgc2tpcCBhdXRvLWdlbmVyYXRpb25cbiAgICBpZiAoZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5yZXF1aXJlTWFudWFsKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgLy8gMy4gRGV0ZWN0IGJlc3Qgc2VnbWVudCBmaWVsZHMgKHJldHVybnMgYXJyYXkgbm93KVxuICAgIGNvbnN0IGRldGVjdGVkRmllbGRzID0gZGV0ZWN0U2VnbWVudEZpZWxkcyhwcm9wZXJ0aWVzLCBnbG9iYWxTZWdtZW50Q29uZmlnLCBlbnRpdHlTZWdtZW50Q29uZmlnKTtcblxuICAgIGlmIChkZXRlY3RlZEZpZWxkcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgLy8gTm8gc3VpdGFibGUgZmllbGRzIGZvdW5kXG4gICAgICAgIGlmIChnbG9iYWxTZWdtZW50Q29uZmlnPy5kZWJ1ZyB8fCBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmRlYnVnKSB7XG4gICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtTZWdtZW50R2VuZXJhdGlvbl0gTm8gc3VpdGFibGUgZmllbGRzIGRldGVjdGVkIGZvciBzZWdtZW50c2ApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgLy8gR2V0IG1lcmdlZCBjb25maWcgZm9yIHRoaXMgZW50aXR5XG4gICAgY29uc3QgbWVyZ2VkQ29uZmlnOiBSZXF1aXJlZDxJU2VnbWVudEF1dG9HZW5lcmF0aW9uQ29uZmlnPiAmIHsgbWF4U2VnbWVudEdyb3VwczogbnVtYmVyOyBtYXhTZWdtZW50c1Blckdyb3VwOiBudW1iZXIgfSA9IHtcbiAgICAgICAgZW5hYmxlZDogZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5lbmFibGVkID8/IGdsb2JhbFNlZ21lbnRDb25maWc/LmVuYWJsZWQgPz8gdHJ1ZSxcbiAgICAgICAgcHJlZmVycmVkRmllbGRzOiBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LnByZWZlcnJlZEZpZWxkcyB8fCBnbG9iYWxTZWdtZW50Q29uZmlnPy5wcmVmZXJyZWRGaWVsZHMgfHwgWyAnc3RhdHVzJywgJ3N0YXRlJywgJ3R5cGUnLCAnY2F0ZWdvcnknLCAncHJpb3JpdHknIF0sXG4gICAgICAgIG1heFNlZ21lbnRHcm91cHM6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8ubWF4U2VnbWVudEdyb3VwcyA/PyBnbG9iYWxTZWdtZW50Q29uZmlnPy5tYXhTZWdtZW50R3JvdXBzID8/IDIsXG4gICAgICAgIG1heFNlZ21lbnRzUGVyR3JvdXA6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8ubWF4U2VnbWVudHNQZXJHcm91cCA/PyBnbG9iYWxTZWdtZW50Q29uZmlnPy5tYXhTZWdtZW50c1Blckdyb3VwID8/IDEwLFxuICAgICAgICBtaW5WYWx1ZXM6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8ubWluVmFsdWVzID8/IGdsb2JhbFNlZ21lbnRDb25maWc/Lm1pblZhbHVlcyA/PyAyLFxuICAgICAgICBpY29uTWFwcGluZzoge1xuICAgICAgICAgICAgLi4uREVGQVVMVF9JQ09OX01BUFBJTkcsXG4gICAgICAgICAgICAuLi5nbG9iYWxTZWdtZW50Q29uZmlnPy5pY29uTWFwcGluZyxcbiAgICAgICAgICAgIC4uLmVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uaWNvbk1hcHBpbmdcbiAgICAgICAgfSxcbiAgICAgICAgYm9vbGVhbkxhYmVsUGF0dGVybnM6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uYm9vbGVhbkxhYmVsUGF0dGVybnMgfHwgZ2xvYmFsU2VnbWVudENvbmZpZz8uYm9vbGVhbkxhYmVsUGF0dGVybnMgfHwgW10sXG4gICAgICAgIGRlZmF1bHRCb29sZWFuTGFiZWxzOiBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmRlZmF1bHRCb29sZWFuTGFiZWxzIHx8IGdsb2JhbFNlZ21lbnRDb25maWc/LmRlZmF1bHRCb29sZWFuTGFiZWxzIHx8IHsgdHJ1ZTogJ1llcycsIGZhbHNlOiAnTm8nIH0sXG4gICAgICAgIGluY2x1ZGVBbGxTZWdtZW50OiBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmluY2x1ZGVBbGxTZWdtZW50ID8/IGdsb2JhbFNlZ21lbnRDb25maWc/LmluY2x1ZGVBbGxTZWdtZW50ID8/IHRydWUsXG4gICAgICAgIGRlYnVnOiBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmRlYnVnID8/IGdsb2JhbFNlZ21lbnRDb25maWc/LmRlYnVnID8/IGZhbHNlXG4gICAgfTtcblxuICAgIGlmIChtZXJnZWRDb25maWcuZGVidWcpIHtcbiAgICAgICAgRGVmYXVsdExvZ2dlci5pbmZvKGBbU2VnbWVudEdlbmVyYXRpb25dIEdlbmVyYXRpbmcgc2VnbWVudHMgZm9yICR7ZGV0ZWN0ZWRGaWVsZHMubGVuZ3RofSBmaWVsZChzKTpgLCBkZXRlY3RlZEZpZWxkcy5tYXAoZCA9PiBkLmZpZWxkLmlkKSk7XG4gICAgfVxuXG4gICAgLy8gNC4gR2VuZXJhdGUgc2VnbWVudCBncm91cHMgKG9uZSBwZXIgZGV0ZWN0ZWQgZmllbGQpXG4gICAgY29uc3Qgc2VnbWVudEdyb3VwczogQXJyYXk8SUZpbHRlclNlZ21lbnRHcm91cD4gPSBbXTtcblxuICAgIGZvciAoY29uc3QgZGV0ZWN0aW9uIG9mIGRldGVjdGVkRmllbGRzKSB7XG4gICAgICAgIGNvbnN0IHsgZmllbGQgfSA9IGRldGVjdGlvbjtcblxuICAgICAgICAvLyBHZW5lcmF0ZSBzZWdtZW50cyBmb3IgdGhpcyBmaWVsZFxuICAgICAgICBjb25zdCBzZWdtZW50czogQXJyYXk8SUZpbHRlclNlZ21lbnQ+ID0gW107XG5cbiAgICAgICAgLy8gQWRkIFwiQWxsXCIgc2VnbWVudCBpZiBlbmFibGVkXG4gICAgICAgIGlmIChtZXJnZWRDb25maWcuaW5jbHVkZUFsbFNlZ21lbnQpIHtcbiAgICAgICAgICAgIHNlZ21lbnRzLnB1c2goe1xuICAgICAgICAgICAgICAgIGlkOiBgYWxsLSR7ZmllbGQuaWR9YCxcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0FsbCcsXG4gICAgICAgICAgICAgICAgZmlsdGVyczoge30sXG4gICAgICAgICAgICAgICAgZGVmYXVsdDogdHJ1ZVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBHZXQgdmFsdWVzIGZyb20gZmllbGRcbiAgICAgICAgbGV0IHZhbHVlczogKHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4pW10gPSBbXTtcbiAgICAgICAgbGV0IHZhbHVlTGFiZWxzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307ICAvLyBGb3IgY3VzdG9tIGJvb2xlYW4gbGFiZWxzXG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZmllbGQudHlwZSkpIHtcbiAgICAgICAgICAgIC8vIEVudW0gdHlwZSBhcnJheVxuICAgICAgICAgICAgdmFsdWVzID0gZmllbGQudHlwZTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZC50eXBlID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgICAgIC8vIEJvb2xlYW4gZmllbGQgd2l0aCBvcHRpb25hbCBjdXN0b20gbGFiZWxzXG4gICAgICAgICAgICB2YWx1ZXMgPSBbIHRydWUsIGZhbHNlIF07XG5cbiAgICAgICAgICAgIC8vIDEuIENoZWNrIGZvciBleHBsaWNpdCBmaWVsZC1sZXZlbCBib29sZWFuTGFiZWxzXG4gICAgICAgICAgICBjb25zdCBmaWVsZEJvb2xlYW5MYWJlbHMgPSAnYm9vbGVhbkxhYmVscycgaW4gZmllbGQgPyBmaWVsZC5ib29sZWFuTGFiZWxzIDogdW5kZWZpbmVkO1xuICAgICAgICAgICAgaWYgKGZpZWxkQm9vbGVhbkxhYmVscyAmJiB0eXBlb2YgZmllbGRCb29sZWFuTGFiZWxzID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgICAgIHZhbHVlTGFiZWxzWyAndHJ1ZScgXSA9IGZpZWxkQm9vbGVhbkxhYmVscy50cnVlIHx8ICdZZXMnO1xuICAgICAgICAgICAgICAgIHZhbHVlTGFiZWxzWyAnZmFsc2UnIF0gPSBmaWVsZEJvb2xlYW5MYWJlbHMuZmFsc2UgfHwgJ05vJztcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gMi4gVHJ5IGludGVsbGlnZW50IGV4dHJhY3Rpb24gZnJvbSBmaWVsZCBuYW1lXG4gICAgICAgICAgICAgICAgY29uc3QgZmllbGROYW1lID0gZmllbGQuaWQ7XG4gICAgICAgICAgICAgICAgY29uc3QgZXh0cmFjdGVkID0gZXh0cmFjdEJvb2xlYW5MYWJlbHNGcm9tRmllbGROYW1lKGZpZWxkTmFtZSk7XG5cbiAgICAgICAgICAgICAgICBpZiAoZXh0cmFjdGVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlTGFiZWxzWyAndHJ1ZScgXSA9IGV4dHJhY3RlZC50cnVlTGFiZWw7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlTGFiZWxzWyAnZmFsc2UnIF0gPSBleHRyYWN0ZWQuZmFsc2VMYWJlbDtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAvLyAzLiBUcnkgdG8gbWF0Y2ggYWdhaW5zdCBjb25maWd1cmVkIHBhdHRlcm5zXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhdHRlcm5zID0gbWVyZ2VkQ29uZmlnLmJvb2xlYW5MYWJlbFBhdHRlcm5zO1xuICAgICAgICAgICAgICAgICAgICBsZXQgbWF0Y2hlZCA9IGZhbHNlO1xuXG4gICAgICAgICAgICAgICAgICAgIGlmIChwYXR0ZXJucyAmJiBwYXR0ZXJucy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHBhdHRlcm4gb2YgcGF0dGVybnMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCByZWdleCA9IHBhdHRlcm4ucGF0dGVybiBpbnN0YW5jZW9mIFJlZ0V4cFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IHBhdHRlcm4ucGF0dGVyblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IG5ldyBSZWdFeHAocGF0dGVybi5wYXR0ZXJuLCAnaScpO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHJlZ2V4LnRlc3QoZmllbGROYW1lKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZUxhYmVsc1sgJ3RydWUnIF0gPSBwYXR0ZXJuLnRydWVMYWJlbDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbICdmYWxzZScgXSA9IHBhdHRlcm4uZmFsc2VMYWJlbDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWF0Y2hlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIC8vIDQuIFVzZSBkZWZhdWx0IGZhbGxiYWNrIGlmIG5vIHBhdHRlcm4gbWF0Y2hlZFxuICAgICAgICAgICAgICAgICAgICBpZiAoIW1hdGNoZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRzID0gbWVyZ2VkQ29uZmlnLmRlZmF1bHRCb29sZWFuTGFiZWxzIHx8IHsgdHJ1ZTogJ1llcycsIGZhbHNlOiAnTm8nIH07XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZUxhYmVsc1sgJ3RydWUnIF0gPSBkZWZhdWx0cy50cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbICdmYWxzZScgXSA9IGRlZmF1bHRzLmZhbHNlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKChmaWVsZC5maWVsZFR5cGUgPT09ICdzZWxlY3QnIHx8IGZpZWxkLmZpZWxkVHlwZSA9PT0gJ3JhZGlvJyB8fCBmaWVsZC5maWVsZFR5cGUgPT09ICdjaGVja2JveCcgfHwgZmllbGQuZmllbGRUeXBlID09PSAnbXVsdGktc2VsZWN0JykgJiYgQXJyYXkuaXNBcnJheSgoZmllbGQgYXMgYW55KS5vcHRpb25zKSkge1xuICAgICAgICAgICAgLy8gU2VsZWN0L3JhZGlvL2NoZWNrYm94IGZpZWxkIHdpdGggaW5saW5lIG9wdGlvbnNcbiAgICAgICAgICAgIGNvbnN0IG9wdGlvbnMgPSAoZmllbGQgYXMgYW55KS5vcHRpb25zIGFzIEFycmF5PHsgbGFiZWw6IHN0cmluZzsgdmFsdWU6IHN0cmluZyB9PjtcbiAgICAgICAgICAgIHZhbHVlcyA9IG9wdGlvbnMubWFwKG9wdCA9PiBvcHQudmFsdWUpO1xuICAgICAgICAgICAgLy8gU3RvcmUgbGFiZWxzIGZvciBsYXRlciB1c2VcbiAgICAgICAgICAgIG9wdGlvbnMuZm9yRWFjaChvcHQgPT4ge1xuICAgICAgICAgICAgICAgIHZhbHVlTGFiZWxzWyBTdHJpbmcob3B0LnZhbHVlKSBdID0gb3B0LmxhYmVsO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBcHBseSBmaWVsZC1zcGVjaWZpYyB2YWx1ZSBmaWx0ZXJzIGZpcnN0LCB0aGVuIGdsb2JhbFxuICAgICAgICBjb25zdCBpbmNsdWRlVmFsdWVzQnlGaWVsZCA9IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uaW5jbHVkZVZhbHVlc0J5RmllbGQ7XG4gICAgICAgIGNvbnN0IGluY2x1ZGVWYWx1ZXMgPSBpbmNsdWRlVmFsdWVzQnlGaWVsZD8uWyBmaWVsZC5pZCBdIHx8IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uaW5jbHVkZVZhbHVlcztcbiAgICAgICAgaWYgKGluY2x1ZGVWYWx1ZXMpIHtcbiAgICAgICAgICAgIHZhbHVlcyA9IHZhbHVlcy5maWx0ZXIodiA9PiBpbmNsdWRlVmFsdWVzLmluY2x1ZGVzKFN0cmluZyh2KSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZXhjbHVkZVZhbHVlc0J5RmllbGQgPSBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmV4Y2x1ZGVWYWx1ZXNCeUZpZWxkO1xuICAgICAgICBjb25zdCBleGNsdWRlVmFsdWVzID0gZXhjbHVkZVZhbHVlc0J5RmllbGQ/LlsgZmllbGQuaWQgXSB8fCBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmV4Y2x1ZGVWYWx1ZXM7XG4gICAgICAgIGlmIChleGNsdWRlVmFsdWVzKSB7XG4gICAgICAgICAgICB2YWx1ZXMgPSB2YWx1ZXMuZmlsdGVyKHYgPT4gIWV4Y2x1ZGVWYWx1ZXMuaW5jbHVkZXMoU3RyaW5nKHYpKSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBcHBseSBmaWVsZC1zcGVjaWZpYyBzb3J0IG9yZGVyIGZpcnN0LCB0aGVuIGdsb2JhbFxuICAgICAgICBjb25zdCBzb3J0T3JkZXJCeUZpZWxkID0gZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5zb3J0T3JkZXJCeUZpZWxkO1xuICAgICAgICBjb25zdCBzb3J0T3JkZXIgPSBzb3J0T3JkZXJCeUZpZWxkPy5bIGZpZWxkLmlkIF0gfHwgZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5zb3J0T3JkZXI7XG4gICAgICAgIGlmIChzb3J0T3JkZXIpIHtcbiAgICAgICAgICAgIHZhbHVlcy5zb3J0KChhLCBiKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgYUluZGV4ID0gc29ydE9yZGVyLmluZGV4T2YoU3RyaW5nKGEpKTtcbiAgICAgICAgICAgICAgICBjb25zdCBiSW5kZXggPSBzb3J0T3JkZXIuaW5kZXhPZihTdHJpbmcoYikpO1xuXG4gICAgICAgICAgICAgICAgLy8gSWYgYm90aCBpbiBzb3J0T3JkZXIsIHVzZSB0aGF0IG9yZGVyXG4gICAgICAgICAgICAgICAgaWYgKGFJbmRleCA+PSAwICYmIGJJbmRleCA+PSAwKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBhSW5kZXggLSBiSW5kZXg7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIC8vIElmIG9ubHkgb25lIGluIHNvcnRPcmRlciwgaXQgY29tZXMgZmlyc3RcbiAgICAgICAgICAgICAgICBpZiAoYUluZGV4ID49IDApIHJldHVybiAtMTtcbiAgICAgICAgICAgICAgICBpZiAoYkluZGV4ID49IDApIHJldHVybiAxO1xuICAgICAgICAgICAgICAgIC8vIE5laXRoZXIgaW4gc29ydE9yZGVyLCBtYWludGFpbiBvcmlnaW5hbCBvcmRlclxuICAgICAgICAgICAgICAgIHJldHVybiAwO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBHZW5lcmF0ZSBzZWdtZW50IGZvciBlYWNoIHZhbHVlXG4gICAgICAgIGZvciAoY29uc3QgdmFsdWUgb2YgdmFsdWVzKSB7XG4gICAgICAgICAgICBjb25zdCB2YWx1ZVN0ciA9IFN0cmluZyh2YWx1ZSk7XG4gICAgICAgICAgICBjb25zdCB2YWx1ZUxvd2VyID0gdmFsdWVTdHIudG9Mb3dlckNhc2UoKTtcblxuICAgICAgICAgICAgLy8gVXNlIGN1c3RvbSBsYWJlbCBpZiBhdmFpbGFibGUsIG90aGVyd2lzZSBmb3JtYXQgdGhlIHZhbHVlXG4gICAgICAgICAgICBjb25zdCBzZWdtZW50TGFiZWwgPSB2YWx1ZUxhYmVsc1sgdmFsdWVTdHIgXSB8fCBwYXNjYWxDYXNlKHZhbHVlU3RyKTtcblxuICAgICAgICAgICAgc2VnbWVudHMucHVzaCh7XG4gICAgICAgICAgICAgICAgaWQ6IGAke2ZpZWxkLmlkfS0ke3ZhbHVlTG93ZXIucmVwbGFjZSgvW15hLXowLTldKy9nLCAnLScpfWAsICAvLyBVbmlxdWUgSURcbiAgICAgICAgICAgICAgICBsYWJlbDogc2VnbWVudExhYmVsLCAgLy8gQ3VzdG9tIG9yIGZvcm1hdHRlZCBsYWJlbFxuICAgICAgICAgICAgICAgIGljb246IG1lcmdlZENvbmZpZy5pY29uTWFwcGluZ1sgdmFsdWVMb3dlciBdLCAgLy8gU21hcnQgaWNvbiBsb29rdXBcbiAgICAgICAgICAgICAgICBmaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgIFsgZmllbGQuaWQgXTogeyBlcTogdmFsdWUgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gT25seSBhZGQgZ3JvdXAgaWYgd2UgaGF2ZSBzZWdtZW50c1xuICAgICAgICBjb25zdCBtaW5TZWdtZW50cyA9IG1lcmdlZENvbmZpZy5pbmNsdWRlQWxsU2VnbWVudCA/IDEgOiAwO1xuICAgICAgICBpZiAoc2VnbWVudHMubGVuZ3RoID4gbWluU2VnbWVudHMpIHtcbiAgICAgICAgICAgIC8vIEF1dG8tZ2VuZXJhdGUgbGFiZWwgb3IgdXNlIGV4cGxpY2l0IGdyb3VwTGFiZWxzXG4gICAgICAgICAgICBjb25zdCBjdXN0b21Hcm91cExhYmVscyA9IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uZ3JvdXBMYWJlbHM7XG4gICAgICAgICAgICBjb25zdCBsYWJlbCA9IGN1c3RvbUdyb3VwTGFiZWxzPy5bIGZpZWxkLmlkIF0gfHwgYEJ5ICR7cGFzY2FsQ2FzZShmaWVsZC5pZCl9YDtcblxuICAgICAgICAgICAgc2VnbWVudEdyb3Vwcy5wdXNoKHtcbiAgICAgICAgICAgICAgICBpZDogYCR7ZmllbGQuaWR9LWdyb3VwYCxcbiAgICAgICAgICAgICAgICBsYWJlbCxcbiAgICAgICAgICAgICAgICBzZWdtZW50cyxcbiAgICAgICAgICAgICAgICBkZWZhdWx0U2VnbWVudElkOiBzZWdtZW50cy5maW5kKHMgPT4gcy5kZWZhdWx0KT8uaWQsXG4gICAgICAgICAgICAgICAgbWF4VmlzaWJsZTogbWVyZ2VkQ29uZmlnLm1heFNlZ21lbnRzUGVyR3JvdXBcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gUmV0dXJuIHNlZ21lbnQgZ3JvdXBzIChvciB1bmRlZmluZWQgaWYgbm9uZSBnZW5lcmF0ZWQpXG4gICAgaWYgKHNlZ21lbnRHcm91cHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgLy8gSWYgb25seSAxIGdyb3VwIHdpdGggc2ltcGxlIGNvbmZpZywgcmV0dXJuIGZsYXQgc2VnbWVudHMgZm9yIGJhY2t3YXJkcyBjb21wYXRpYmlsaXR5XG4gICAgLy8gVGhpcyBtYWludGFpbnMgbGVnYWN5IGJlaGF2aW9yIHdoZW4gbWF4U2VnbWVudEdyb3VwcyA9IDFcbiAgICBpZiAoc2VnbWVudEdyb3Vwcy5sZW5ndGggPT09IDEgJiYgbWVyZ2VkQ29uZmlnLm1heFNlZ21lbnRHcm91cHMgPT09IDEpIHtcbiAgICAgICAgcmV0dXJuIHNlZ21lbnRHcm91cHNbIDAgXS5zZWdtZW50cztcbiAgICB9XG5cbiAgICByZXR1cm4gc2VnbWVudEdyb3Vwcztcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFTlRJVFkgQVRUUklCVVRFIEZPUk1BVFRJTkdcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIEZvcm1hdHMgYSBzaW5nbGUgZW50aXR5IGF0dHJpYnV0ZSBmb3IgZm9ybSBvciBkZXRhaWwgcGFnZSBkaXNwbGF5LlxuICogXG4gKiBUcmFuc2Zvcm1zIHNjaGVtYSBhdHRyaWJ1dGVzIGludG8gVUktcmVhZHkgZmllbGQgY29uZmlndXJhdGlvbnMgd2l0aCBwcm9wZXIgZmllbGQgdHlwZXMsXG4gKiByZWxhdGlvbiBjb25maWdzLCBvcHRpb25zLCB2aXNpYmlsaXR5LCBhbmQgdmFsaWRhdGlvbiBydWxlcy4gQXV0by1nZW5lcmF0ZXMgcmVsYXRpb25cbiAqIGRpc3BsYXkgY29uZmlndXJhdGlvbnMgYW5kIGZpbHRlciBjb25maWdzIHdoZW4gbm90IGV4cGxpY2l0bHkgcHJvdmlkZWQuXG4gKiBcbiAqIEBwYXJhbSB0aGlzUHJvcCAtIFRoZSBlbnRpdHkgYXR0cmlidXRlIHRvIGZvcm1hdFxuICogQHBhcmFtIHR5cGUgLSBQYWdlIHR5cGU6ICdjcmVhdGUnLCAndXBkYXRlJywgb3IgJ2RldGFpbCdcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gRW50aXR5IHNlcnZpY2UgZm9yIGFjY2Vzc2luZyByZWxhdGVkIHNjaGVtYXNcbiAqIEBwYXJhbSBhbGxQcm9wZXJ0aWVzIC0gT3B0aW9uYWwgYXJyYXkgb2YgYWxsIHByb3BlcnRpZXMgZm9yIGRldGVjdGluZyBkdXBsaWNhdGVkIHJlbGF0aW9uIGZpZWxkc1xuICogQHBhcmFtIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyAtIE9wdGlvbmFsIGdsb2JhbCBVSSBjb25maWd1cmF0aW9uIG9wdGlvbnNcbiAqIEByZXR1cm5zIEZvcm1hdHRlZCBmaWVsZCBtZXRhZGF0YSByZWFkeSBmb3IgVUkgcmVuZGVyaW5nXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBmb3JtYXR0ZWRGaWVsZCA9IGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbChcbiAqICAge1xuICogICAgIGlkOiAndGVhbUlkJyxcbiAqICAgICBuYW1lOiAndGVhbUlkJyxcbiAqICAgICB0eXBlOiAnc3RyaW5nJyxcbiAqICAgICByZWxhdGlvbjogeyB0eXBlOiAnb25lJywgZW50aXR5OiAndGVhbScgfVxuICogICB9LFxuICogICAnY3JlYXRlJyxcbiAqICAgZW50aXR5U2VydmljZVxuICogKTtcbiAqIC8vIFJldHVybnMgZmllbGQgd2l0aCByZWxhdGlvbkNvbmZpZywgZmlsdGVyQ29uZmlnLCBhbmQgcHJvcGVyIGZpZWxkIHR5cGVcbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKFxuICAgIHRoaXNQcm9wOiBUSU9TY2hlbWFBdHRyaWJ1dGUsXG4gICAgdHlwZTogJ2NyZWF0ZScgfCAndXBkYXRlJyB8ICdkZXRhaWwnLFxuICAgIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sXG4gICAgYWxsUHJvcGVydGllcz86IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLCAgLy8gT3B0aW9uYWw6IGZvciBkZXRlY3RpbmcgZHVwbGljYXRlZCByZWxhdGlvbiBmaWVsZHNcbiAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbICd1aUNvbmZpZ0dlbk9wdGlvbnMnIF0gIC8vIE9wdGlvbmFsOiBnbG9iYWwgVUkgY29uZmlnIG9wdGlvbnNcbikge1xuICAgIGNvbnN0IGZvcm1hdHRlZDogYW55ID0ge1xuICAgICAgICAuLi50aGlzUHJvcCxcbiAgICAgICAgbGFiZWw6IHRoaXNQcm9wLm5hbWUsICAvLyBSZXNwZWN0IGN1c3RvbSBsYWJlbCBmcm9tIGVudGl0eSBhdHRyaWJ1dGVcbiAgICAgICAgY29sdW1uOiB0aGlzUHJvcC5pZCxcbiAgICAgICAgZmllbGRUeXBlOiB0aGlzUHJvcC5maWVsZFR5cGUgfHwgJ3RleHQnLCAgLy8gZmllbGRUeXBlIHNob3VsZCBhbHJlYWR5IGJlIGluZmVycmVkIGluIGJhc2Utc2VydmljZVxuICAgICAgICBoaWRkZW46IHRoaXNQcm9wLmhhc093blByb3BlcnR5KCdpc1Zpc2libGUnKSAmJiAhdGhpc1Byb3AuaXNWaXNpYmxlXG4gICAgfTtcblxuICAgIC8vIEhhbmRsZSBhZGROZXdPcHRpb24gKE9MRCAtIGRlcHJlY2F0ZWQsIGdlbmVyYXRlcyBlbWJlZGRlZCBjb25maWcpIG9yIGFkZE5ld09wdGlvbkNvbmZpZyAoTkVXIC0ganVzdCBwYXNzIHRocm91Z2ggcmVmZXJlbmNlKVxuICAgIGlmIChpc1NlbGVjdEZpZWxkTWV0YWRhdGEodGhpc1Byb3ApICYmIFsgJ2NyZWF0ZScsICd1cGRhdGUnIF0uaW5jbHVkZXModHlwZSkpIHtcbiAgICAgICAgY29uc3Qgc2VsZWN0RmllbGQgPSB0aGlzUHJvcCBhcyBTZWxlY3RGaWVsZE1ldGFkYXRhO1xuXG4gICAgICAgIGlmIChzZWxlY3RGaWVsZC5hZGROZXdPcHRpb25Db25maWcpIHtcbiAgICAgICAgICAgIC8vIE5FVyBXQVk6IFVzZXIgcHJvdmlkZWQgYWRkTmV3T3B0aW9uQ29uZmlnIHJlZmVyZW5jZSAtIGp1c3QgcGFzcyBpdCB0aHJvdWdoXG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdhZGROZXdPcHRpb25Db25maWcnIF0gPSBzZWxlY3RGaWVsZC5hZGROZXdPcHRpb25Db25maWc7XG5cbiAgICAgICAgfSBlbHNlIGlmIChzZWxlY3RGaWVsZC5hZGROZXdPcHRpb24pIHtcbiAgICAgICAgICAgIC8vIE9MRCBXQVkgKERFUFJFQ0FURUQpOiBUcmFuc2Zvcm0gYWRkTmV3T3B0aW9uIHRvIGFkZE5ld09wdGlvbkNvbmZpZyBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxuICAgICAgICAgICAgY29uc3QgeyBlbnRpdHlOYW1lLCBvdmVycmlkZUNvbmZpZyB9ID0gc2VsZWN0RmllbGQuYWRkTmV3T3B0aW9uO1xuXG4gICAgICAgICAgICBpZiAoZW50aXR5TmFtZSAmJiBlbnRpdHlTZXJ2aWNlLmhhc0VudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUoZW50aXR5TmFtZSkpIHtcbiAgICAgICAgICAgICAgICBmb3JtYXR0ZWRbICdhZGROZXdPcHRpb25Db25maWcnIF0gPSB7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnY3JlYXRlJyxcbiAgICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IG92ZXJyaWRlQ29uZmlnIHx8IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN1Ym1pdFN1Y2Nlc3NSZWRpcmVjdDogdW5kZWZpbmVkLCAgLy8gU3RheSBpbiBtb2RhbCBhZnRlciBjcmVhdGlvblxuICAgICAgICAgICAgICAgICAgICAgICAgZm9ybUJ1dHRvbnM6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7IHRleHQ6IFwiQWRkXCIsIGFjdGlvbjogXCJzdWJtaXRcIiB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsgdGV4dDogXCJDYW5jZWxcIiwgYWN0aW9uOiBcImNhbmNlbFwiIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsOiBDb3VsZCBub3QgZmluZCByZWxhdGVkLWVudGl0eS1zZXJ2aWNlIGZvciBlbnRpdHkgWyR7ZW50aXR5TmFtZX1dIGluICR7ZW50aXR5U2VydmljZS5jb25zdHJ1Y3Rvci5uYW1lfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gSGFuZGxlIHJlbGF0aW9uIGZpZWxkcyAoREFUQSBMQVlFUiArIFVJIExBWUVSKVxuICAgIGlmICh0aGlzUHJvcC5yZWxhdGlvbiAmJiB0eXBlID09PSAnZGV0YWlsJykge1xuICAgICAgICBjb25zdCByZWxhdGlvbiA9IHRoaXNQcm9wLnJlbGF0aW9uO1xuICAgICAgICBjb25zdCB7IGVudGl0eU5hbWUsIHR5cGU6IHJlbGF0aW9uVHlwZSwgaWRlbnRpZmllcnMgfSA9IHJlbGF0aW9uO1xuICAgICAgICBjb25zdCBlbnRpdHlOYW1lTG93ZXIgPSBlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCk7XG5cbiAgICAgICAgaWYgKCFlbnRpdHlTZXJ2aWNlLmhhc0VudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUoZW50aXR5TmFtZSkpIHtcbiAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsOiBDb3VsZCBub3QgZmluZCByZWxhdGVkLWVudGl0eS1zZXJ2aWNlIGZvciBlbnRpdHkgWyR7ZW50aXR5TmFtZX1dIGluICR7ZW50aXR5U2VydmljZS5jb25zdHJ1Y3Rvci5uYW1lfWApO1xuICAgICAgICAgICAgcmV0dXJuIGZvcm1hdHRlZDtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFJlc29sdmUgaWRlbnRpZmllcnMgKGNvdWxkIGJlIGRpcmVjdCB2YWx1ZSBvciBsYXp5IGZ1bmN0aW9uKVxuICAgICAgICBjb25zdCByZXNvbHZlZElkZW50aWZpZXJzID0gdHlwZW9mIGlkZW50aWZpZXJzID09PSAnZnVuY3Rpb24nID8gaWRlbnRpZmllcnMoKSA6IGlkZW50aWZpZXJzO1xuXG4gICAgICAgIC8vIFNhZmV0eSBjaGVjayBmb3IgYXJyYXkgaWRlbnRpZmllcnNcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkocmVzb2x2ZWRJZGVudGlmaWVycykpIHtcbiAgICAgICAgICAgIGlmIChyZXNvbHZlZElkZW50aWZpZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsOiBFbXB0eSBpZGVudGlmaWVycyBhcnJheSBmb3IgcmVsYXRpb24gWyR7ZW50aXR5TmFtZX1dYCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZvcm1hdHRlZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEhhbmRsZSBib3RoIHNpbmdsZSBhbmQgbXVsdGlwbGUgaWRlbnRpZmllcnMgZm9yIGNvbXBvc2l0ZSBrZXlzXG4gICAgICAgIGNvbnN0IGlkZW50aWZpZXJNYXBwaW5ncyA9IEFycmF5LmlzQXJyYXkocmVzb2x2ZWRJZGVudGlmaWVycylcbiAgICAgICAgICAgID8gcmVzb2x2ZWRJZGVudGlmaWVycy5tYXAoaWQgPT4gKHtcbiAgICAgICAgICAgICAgICBzb3VyY2U6IFN0cmluZyhpZC5zb3VyY2UpLFxuICAgICAgICAgICAgICAgIHRhcmdldDogU3RyaW5nKGlkLnRhcmdldClcbiAgICAgICAgICAgIH0pKVxuICAgICAgICAgICAgOiBbIHtcbiAgICAgICAgICAgICAgICBzb3VyY2U6IFN0cmluZyhyZXNvbHZlZElkZW50aWZpZXJzLnNvdXJjZSksXG4gICAgICAgICAgICAgICAgdGFyZ2V0OiBTdHJpbmcocmVzb2x2ZWRJZGVudGlmaWVycy50YXJnZXQpXG4gICAgICAgICAgICB9IF07XG5cbiAgICAgICAgLy8gRm9yIHJvdXRlIHBhdHRlcm4gYW5kIGRlZmF1bHQgZmlsdGVycywgdXNlIHRoZSBmaXJzdCBpZGVudGlmaWVyXG4gICAgICAgIC8vIChtb3N0IGVudGl0aWVzIGhhdmUgc2luZ2xlIGlkZW50aWZpZXI7IGNvbXBvc2l0ZSBrZXlzIG5lZWQgZXhwbGljaXQgcm91dGVQYXR0ZXJuKVxuICAgICAgICBjb25zdCBwcmltYXJ5SWRlbnRpZmllciA9IGlkZW50aWZpZXJNYXBwaW5nc1sgMCBdO1xuXG4gICAgICAgIC8vIENoZWNrIGlmIHVzZXIgcHJvdmlkZWQgY3VzdG9tIFVJIGNvbmZpZyBpbiByZWxhdGlvbkNvbmZpZyAob3B0aW9uYWwgb3ZlcnJpZGUpXG4gICAgICAgIGNvbnN0IHVzZXJSZWxhdGlvbkNvbmZpZyA9IHRoaXNQcm9wLnJlbGF0aW9uQ29uZmlnIGFzIElSZWxhdGlvbkZpZWxkQ29uZmlnIHwgdW5kZWZpbmVkO1xuXG4gICAgICAgIC8vIEdldCByZWxhdGVkIGVudGl0eSBzZXJ2aWNlIGZvciBtZXRhZGF0YSAoaWNvbiwgZXRjLilcbiAgICAgICAgY29uc3QgcmVsYXRlZEVudGl0eVNlcnZpY2UgPSBlbnRpdHlTZXJ2aWNlLmhhc0VudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUoZW50aXR5TmFtZSlcbiAgICAgICAgICAgID8gZW50aXR5U2VydmljZS5nZXRFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKGVudGl0eU5hbWUpXG4gICAgICAgICAgICA6IHVuZGVmaW5lZDtcblxuICAgICAgICAvLyBHZXQgZW50aXR5IG1ldGFkYXRhIGZvciBpY29uIGFuZCBmYWxsYmFjayBnZW5lcmF0aW9uXG4gICAgICAgIGNvbnN0IHJlbGF0ZWRFbnRpdHlNZXRhZGF0YSA9IHJlbGF0ZWRFbnRpdHlTZXJ2aWNlPy5nZXRFbnRpdHlTY2hlbWE/LigpLm1vZGVsO1xuICAgICAgICBjb25zdCBkZWZhdWx0SWNvbiA9IHJlbGF0ZWRFbnRpdHlNZXRhZGF0YT8ubWV0YWRhdGE/Lmljb247XG5cbiAgICAgICAgaWYgKHJlbGF0aW9uVHlwZS5lbmRzV2l0aCgndG8tb25lJykpIHtcbiAgICAgICAgICAgIC8vIFRPLU9ORTogU2hvdyB2YWx1ZSBhcyBsaW5rICsgbW9kYWwgaWNvblxuICAgICAgICAgICAgLy8gUm91dGUgcGF0dGVybjogVXNlIGN1c3RvbSAoZnJvbSByZWxhdGlvbkNvbmZpZykgb3IgZGVmYXVsdCB0byAvdmlldy17ZW50aXR5fS86dGFyZ2V0SWRcbiAgICAgICAgICAgIGNvbnN0IHJvdXRlUGF0dGVybiA9IHVzZXJSZWxhdGlvbkNvbmZpZz8ucm91dGVQYXR0ZXJuXG4gICAgICAgICAgICAgICAgfHwgYC92aWV3LSR7ZW50aXR5TmFtZUxvd2VyfS86JHtwcmltYXJ5SWRlbnRpZmllci50YXJnZXR9YDtcblxuICAgICAgICAgICAgLy8gR2VuZXJhdGUgZmFsbGJhY2sgY29uZmlndXJhdGlvbiBmb3Igd2hlbiBvbmx5IElEIGlzIGF2YWlsYWJsZVxuICAgICAgICAgICAgY29uc3QgZmFsbGJhY2tDb25maWcgPSBnZW5lcmF0ZVJlbGF0aW9uRmFsbGJhY2soXG4gICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICBwcmltYXJ5SWRlbnRpZmllci5zb3VyY2UsXG4gICAgICAgICAgICAgICAgcmVsYXRlZEVudGl0eVNlcnZpY2VcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIC8vIEF1dG8tZGV0ZWN0IGR1cGxpY2F0ZWQgcmVsYXRpb24gZmllbGQgKGUuZy4sIHRlYW1OYW1lIGZvciB0ZWFtSWQpXG4gICAgICAgICAgICAvLyBORVc6IFVzZSBlbmhhbmNlZCBkZXRlY3Rpb24gd2l0aCBjb25maWcgc3VwcG9ydFxuICAgICAgICAgICAgbGV0IGF1dG9UZW1wbGF0ZTogc3RyaW5nIHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgbGV0IGRldGVjdGlvbk1ldGFkYXRhOiBhbnkgPSB1bmRlZmluZWQ7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIGlmIGF1dG8tZGV0ZWN0aW9uIGlzIGVuYWJsZWQgKGRlZmF1bHQ6IHRydWUpXG4gICAgICAgICAgICBjb25zdCBhdXRvRGV0ZWN0RW5hYmxlZCA9IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uYXV0b0RldGVjdCAhPT0gZmFsc2U7XG5cbiAgICAgICAgICAgIGlmIChhdXRvRGV0ZWN0RW5hYmxlZCAmJiBhbGxQcm9wZXJ0aWVzKSB7XG4gICAgICAgICAgICAgICAgLy8gR2V0IGdsb2JhbCBjb25maWcgKHBhc3NlZCBmcm9tIGZ3MjQgaW5pdGlhbGl6YXRpb24pXG4gICAgICAgICAgICAgICAgY29uc3QgZ2xvYmFsQ29uZmlnID0gZ2xvYmFsVUlDb25maWdPcHRpb25zPy5kdXBsaWNhdGVkRmllbGREZXRlY3Rpb247XG5cbiAgICAgICAgICAgICAgICAvLyBHZXQgZW50aXR5LWxldmVsIGNvbmZpZyBmcm9tIGVudGl0eSBtZXRhZGF0YVxuICAgICAgICAgICAgICAgIGNvbnN0IGVudGl0eUNvbmZpZyA9IHJlbGF0ZWRFbnRpdHlNZXRhZGF0YT8ubWV0YWRhdGE/LmR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbjtcblxuICAgICAgICAgICAgICAgIC8vIEdldCByZWxhdGlvbi1sZXZlbCBoaW50c1xuICAgICAgICAgICAgICAgIGNvbnN0IHJlbGF0aW9uSGludHMgPSB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmF1dG9EZXRlY3RIaW50cztcblxuICAgICAgICAgICAgICAgIC8vIFJ1biBlbmhhbmNlZCBkZXRlY3Rpb25cbiAgICAgICAgICAgICAgICBjb25zdCBkZXRlY3Rpb25SZXN1bHQgPSBkZXRlY3REdXBsaWNhdGVkUmVsYXRpb25GaWVsZHMoXG4gICAgICAgICAgICAgICAgICAgIGFsbFByb3BlcnRpZXMsXG4gICAgICAgICAgICAgICAgICAgIHRoaXNQcm9wLmlkLFxuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBnbG9iYWxDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZyxcbiAgICAgICAgICAgICAgICAgICAgcmVsYXRpb25IaW50c1xuICAgICAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgICAgICBpZiAoZGV0ZWN0aW9uUmVzdWx0KSB7XG4gICAgICAgICAgICAgICAgICAgIGF1dG9UZW1wbGF0ZSA9IGRldGVjdGlvblJlc3VsdC50ZW1wbGF0ZTtcblxuICAgICAgICAgICAgICAgICAgICAvLyBTdG9yZSBtZXRhZGF0YSBmb3IgZGVidWdnaW5nIGFuZCBmdXR1cmUgZmVhdHVyZXNcbiAgICAgICAgICAgICAgICAgICAgZGV0ZWN0aW9uTWV0YWRhdGEgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZXRlY3RlZEZpZWxkczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByaW1hcnk6IGRldGVjdGlvblJlc3VsdC5wcmltYXJ5RmllbGQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWx0ZXJuYXRpdmVzOiBkZXRlY3Rpb25SZXN1bHQuZGV0ZWN0ZWRGaWVsZHMuZGlzcGxheT8uc2xpY2UoMSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlzdWFsOiBkZXRlY3Rpb25SZXN1bHQuZGV0ZWN0ZWRGaWVsZHMudmlzdWFsLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1ldGE6IGRldGVjdGlvblJlc3VsdC5kZXRlY3RlZEZpZWxkcy5tZXRhXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgY29uZmlkZW5jZTogZGV0ZWN0aW9uUmVzdWx0LmNvbmZpZGVuY2UsXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXRob2Q6IGRldGVjdGlvblJlc3VsdC5tZXRob2QsXG4gICAgICAgICAgICAgICAgICAgICAgICBwYXR0ZXJuOiBkZXRlY3Rpb25SZXN1bHQucGF0dGVyblxuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgZ2VuZXJhdGVkUmVsYXRpb25Db25maWc6IElSZWxhdGlvbkZpZWxkQ29uZmlnID0ge1xuICAgICAgICAgICAgICAgIHJvdXRlUGF0dGVybjogcm91dGVQYXR0ZXJuLFxuICAgICAgICAgICAgICAgIC8vIFBhc3MgQUxMIGlkZW50aWZpZXIgbWFwcGluZ3MgKHN1cHBvcnRzIGNvbXBvc2l0ZSBrZXlzKVxuICAgICAgICAgICAgICAgIGlkZW50aWZpZXJNYXBwaW5nOiBpZGVudGlmaWVyTWFwcGluZ3MubGVuZ3RoID09PSAxXG4gICAgICAgICAgICAgICAgICAgID8gaWRlbnRpZmllck1hcHBpbmdzWyAwIF0gIC8vIFNpbmdsZTogcmV0dXJuIG9iamVjdFxuICAgICAgICAgICAgICAgICAgICA6IGlkZW50aWZpZXJNYXBwaW5ncywgICAgIC8vIE11bHRpcGxlOiByZXR1cm4gYXJyYXlcbiAgICAgICAgICAgICAgICBtb2RhbENvbmZpZ1JlZjogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbENvbmZpZ1JlZiB8fCB7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAndmlldycsXG4gICAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7fVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgbW9kYWxXaWR0aDogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbFdpZHRoLFxuICAgICAgICAgICAgICAgIG1vZGFsVGl0bGU6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxUaXRsZSxcbiAgICAgICAgICAgICAgICBkaXNwbGF5Q29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIC8vIFByaW9yaXR5OiBVc2VyIGN1c3RvbSB0ZW1wbGF0ZSA+IEF1dG8tZGV0ZWN0ZWQgZHVwbGljYXRlZCBmaWVsZCA+IHVuZGVmaW5lZCAodXNlIGZhbGxiYWNrKVxuICAgICAgICAgICAgICAgICAgICB0ZW1wbGF0ZTogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy50ZW1wbGF0ZSB8fCBhdXRvVGVtcGxhdGUsXG4gICAgICAgICAgICAgICAgICAgIC8vIFNtYXJ0IGZhbGxiYWNrIHByZS1nZW5lcmF0ZWQgZnJvbSBlbnRpdHkgbWV0YWRhdGFcbiAgICAgICAgICAgICAgICAgICAgZmFsbGJhY2s6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uZmFsbGJhY2sgfHwgZmFsbGJhY2tDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIC8vIEljb24gZnJvbSBlbnRpdHkgbWV0YWRhdGEgb3IgdXNlciBvdmVycmlkZVxuICAgICAgICAgICAgICAgICAgICBpY29uOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/Lmljb24gfHwgZGVmYXVsdEljb24gfHwgJ0V5ZU91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICAgICAgc2hvd01vZGFsSWNvbjogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5zaG93TW9kYWxJY29uICE9PSBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgc2hvd0xpbms6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uc2hvd0xpbmsgIT09IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAvLyBQYXNzIHRocm91Z2ggYXV0b0RldGVjdCBhbmQgYXV0b0RldGVjdEhpbnRzXG4gICAgICAgICAgICAgICAgICAgIGF1dG9EZXRlY3Q6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uYXV0b0RldGVjdCxcbiAgICAgICAgICAgICAgICAgICAgYXV0b0RldGVjdEhpbnRzOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmF1dG9EZXRlY3RIaW50cyxcbiAgICAgICAgICAgICAgICAgICAgLy8gUGFzcyB0aHJvdWdoIGFueSBjdXN0b20gYWN0aW9uc1xuICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmFjdGlvbnNcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgaWYgKGdsb2JhbFVJQ29uZmlnT3B0aW9ucz8uZHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uPy5kZWJ1Zykge1xuICAgICAgICAgICAgICAgIGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnLmRpc3BsYXlDb25maWchWyAnX2RldGVjdGlvbk1ldGFkYXRhJyBdID0gZGV0ZWN0aW9uTWV0YWRhdGE7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ3JlbGF0aW9uQ29uZmlnJyBdID0gZ2VuZXJhdGVkUmVsYXRpb25Db25maWc7XG5cbiAgICAgICAgICAgIC8vIEJhY2t3YXJkIGNvbXBhdGliaWxpdHk6IEtlZXAgaXNMaW5rIGFuZCBsaW5rQ29uZmlnXG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdpc0xpbmsnIF0gPSB0cnVlO1xuICAgICAgICAgICAgZm9ybWF0dGVkWyAnbGlua0NvbmZpZycgXSA9IHtcbiAgICAgICAgICAgICAgICByb3V0ZVBhdHRlcm46IHJvdXRlUGF0dGVyblxuICAgICAgICAgICAgfTtcblxuICAgICAgICB9IGVsc2UgaWYgKHJlbGF0aW9uVHlwZS5lbmRzV2l0aCgndG8tbWFueScpKSB7XG4gICAgICAgICAgICAvLyBUTy1NQU5ZOiBTaG93IGNvdW50ICsgbW9kYWwgaWNvbiAob3BlbnMgZmlsdGVyZWQgbGlzdClcbiAgICAgICAgICAgIC8vIFJvdXRlIHBhdHRlcm46IFVzZSBjdXN0b20gKGZyb20gcmVsYXRpb25Db25maWcpIG9yIGRlZmF1bHQgdG8gL2xpc3Qte2VudGl0eX1cbiAgICAgICAgICAgIGNvbnN0IHJvdXRlUGF0dGVybiA9IHVzZXJSZWxhdGlvbkNvbmZpZz8ucm91dGVQYXR0ZXJuXG4gICAgICAgICAgICAgICAgfHwgYC9saXN0LSR7ZW50aXR5TmFtZUxvd2VyfWA7XG5cbiAgICAgICAgICAgIC8vIEJ1aWxkIGRlZmF1bHQgZmlsdGVycyB0byBzaG93IG9ubHkgcmVsYXRlZCBpdGVtc1xuICAgICAgICAgICAgLy8gRm9yIGV4YW1wbGUsIGlmIHdlJ3JlIHZpZXdpbmcgYSBUZWFtIGFuZCB0aGlzIGZpZWxkIHNob3dzIEdhbWVzLFxuICAgICAgICAgICAgLy8gd2Ugd2FudCB0byBmaWx0ZXIgZ2FtZXMgd2hlcmUgdGVhbUlkID0gY3VycmVudCB0ZWFtJ3MgSURcbiAgICAgICAgICAgIC8vIEZvciBjb21wb3NpdGUga2V5cywgYWRkIGFsbCBpZGVudGlmaWVycyBhcyBmaWx0ZXJzXG4gICAgICAgICAgICBjb25zdCBkZWZhdWx0RmlsdGVyczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgICAgICAgICAgaWRlbnRpZmllck1hcHBpbmdzLmZvckVhY2gobWFwcGluZyA9PiB7XG4gICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnNbIG1hcHBpbmcudGFyZ2V0IF0gPSBgOiR7bWFwcGluZy5zb3VyY2V9YDtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBHZW5lcmF0ZSBmYWxsYmFjayBjb25maWd1cmF0aW9uIGZvciB0by1tYW55IChzaG93cyBjb3VudClcbiAgICAgICAgICAgIGNvbnN0IGZhbGxiYWNrQ29uZmlnID0gZ2VuZXJhdGVSZWxhdGlvbkZhbGxiYWNrKFxuICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgcHJpbWFyeUlkZW50aWZpZXIuc291cmNlLFxuICAgICAgICAgICAgICAgIHJlbGF0ZWRFbnRpdHlTZXJ2aWNlXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICBjb25zdCBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZzogSVJlbGF0aW9uRmllbGRDb25maWcgPSB7XG4gICAgICAgICAgICAgICAgcm91dGVQYXR0ZXJuOiByb3V0ZVBhdHRlcm4sXG4gICAgICAgICAgICAgICAgLy8gUGFzcyBBTEwgaWRlbnRpZmllciBtYXBwaW5ncyAoc3VwcG9ydHMgY29tcG9zaXRlIGtleXMpXG4gICAgICAgICAgICAgICAgaWRlbnRpZmllck1hcHBpbmc6IGlkZW50aWZpZXJNYXBwaW5ncy5sZW5ndGggPT09IDFcbiAgICAgICAgICAgICAgICAgICAgPyBpZGVudGlmaWVyTWFwcGluZ3NbIDAgXSAgLy8gU2luZ2xlOiByZXR1cm4gb2JqZWN0XG4gICAgICAgICAgICAgICAgICAgIDogaWRlbnRpZmllck1hcHBpbmdzLCAgICAgLy8gTXVsdGlwbGU6IHJldHVybiBhcnJheVxuICAgICAgICAgICAgICAgIG1vZGFsQ29uZmlnUmVmOiB1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsQ29uZmlnUmVmIHx8IHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiBkZWZhdWx0RmlsdGVyc1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBtb2RhbFdpZHRoOiB1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsV2lkdGgsXG4gICAgICAgICAgICAgICAgbW9kYWxUaXRsZTogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbFRpdGxlLFxuICAgICAgICAgICAgICAgIGRpc3BsYXlDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgLy8gVXNlciBjYW4gb3ZlcnJpZGUgd2l0aCBjdXN0b20gdGVtcGxhdGVcbiAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGU6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8udGVtcGxhdGUsXG4gICAgICAgICAgICAgICAgICAgIC8vIFNtYXJ0IGZhbGxiYWNrIHByZS1nZW5lcmF0ZWQgZnJvbSBlbnRpdHkgbWV0YWRhdGFcbiAgICAgICAgICAgICAgICAgICAgZmFsbGJhY2s6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uZmFsbGJhY2sgfHwgZmFsbGJhY2tDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIC8vIEljb24gZnJvbSBlbnRpdHkgbWV0YWRhdGEgb3IgdXNlciBvdmVycmlkZVxuICAgICAgICAgICAgICAgICAgICBpY29uOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/Lmljb24gfHwgZGVmYXVsdEljb24gfHwgJ1Vub3JkZXJlZExpc3RPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgICAgIHNob3dNb2RhbEljb246IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uc2hvd01vZGFsSWNvbiAhPT0gZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgIHNob3dMaW5rOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnNob3dMaW5rICE9PSB0cnVlLCAvLyBEZWZhdWx0IGZhbHNlIGZvciB0by1tYW55XG4gICAgICAgICAgICAgICAgICAgIC8vIFBhc3MgdGhyb3VnaCBhbnkgY3VzdG9tIGFjdGlvbnNcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5hY3Rpb25zXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgLy8gSWYgdXNlciBwcm92aWRlZCBjdXN0b20gbW9kYWxDb25maWdSZWYsIG1lcmdlIGRlZmF1bHQgZmlsdGVycyB3aXRoIHRoZWlyIG92ZXJyaWRlc1xuICAgICAgICAgICAgaWYgKHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxDb25maWdSZWY/Lm92ZXJyaWRlQ29uZmlnKSB7XG4gICAgICAgICAgICAgICAgZ2VuZXJhdGVkUmVsYXRpb25Db25maWcubW9kYWxDb25maWdSZWYhLm92ZXJyaWRlQ29uZmlnID0ge1xuICAgICAgICAgICAgICAgICAgICAuLi51c2VyUmVsYXRpb25Db25maWcubW9kYWxDb25maWdSZWYub3ZlcnJpZGVDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAuLi5kZWZhdWx0RmlsdGVycyxcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLih1c2VyUmVsYXRpb25Db25maWcubW9kYWxDb25maWdSZWYub3ZlcnJpZGVDb25maWcuZGVmYXVsdEZpbHRlcnMgfHwge30pXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdyZWxhdGlvbkNvbmZpZycgXSA9IGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gSGFuZGxlIG5lc3RlZCBzdHJ1Y3R1cmVzIChtYXAgYW5kIGxpc3QgdHlwZXMpXG4gICAgaWYgKHRoaXNQcm9wLnR5cGUgPT09ICdtYXAnICYmIHRoaXNQcm9wLnByb3BlcnRpZXMpIHtcbiAgICAgICAgZm9ybWF0dGVkWyAncHJvcGVydGllcycgXSA9IGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JGb3JtT3JEZXRhaWwodGhpc1Byb3AucHJvcGVydGllcywgdHlwZSwgZW50aXR5U2VydmljZSk7XG4gICAgfSBlbHNlIGlmICh0aGlzUHJvcC50eXBlID09PSAnbGlzdCcpIHtcbiAgICAgICAgLy8gRm9yIGxpc3QgdHlwZXMsIGNoZWNrIGlmIGl0ZW1zIGFyZSBtYXBzIChuZXN0ZWQgc3RydWN0dXJlcylcbiAgICAgICAgLy8gTm90ZTogaXRlbXMgcHJvcGVydHkgZXhpc3RzIG9uIGxpc3QtdHlwZSBhdHRyaWJ1dGVzIGJ1dCBub3QgaW4gYmFzZSBFbnRpdHlBdHRyaWJ1dGUgdHlwZVxuICAgICAgICBjb25zdCBleHRlbmRlZFByb3AgPSB0aGlzUHJvcCBhcyBUSU9TY2hlbWFBdHRyaWJ1dGUgJiB7IGl0ZW1zPzogeyB0eXBlOiBzdHJpbmc7IHByb3BlcnRpZXM/OiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSB9IH07XG4gICAgICAgIGlmIChleHRlbmRlZFByb3AuaXRlbXM/LnR5cGUgPT09ICdtYXAnICYmIGV4dGVuZGVkUHJvcC5pdGVtcy5wcm9wZXJ0aWVzKSB7XG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdpdGVtcycgXSA9IHtcbiAgICAgICAgICAgICAgICAuLi5mb3JtYXR0ZWRbICdpdGVtcycgXSxcbiAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRm9ybU9yRGV0YWlsKGV4dGVuZGVkUHJvcC5pdGVtcy5wcm9wZXJ0aWVzLCB0eXBlLCBlbnRpdHlTZXJ2aWNlKVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFRPRE86IGFkZCBzdXBwb3J0IGZvciBzZXQsIGVudW0sIGFuZCBjdXN0b20tdHlwZXNcblxuICAgIHJldHVybiBmb3JtYXR0ZWQ7XG59XG5cbi8qKlxuICogUm91dGVzIGF0dHJpYnV0ZSBmb3JtYXR0aW5nIHRvIHRoZSBhcHByb3ByaWF0ZSB0eXBlLXNwZWNpZmljIGZvcm1hdHRlci5cbiAqIFxuICogQ29udmVuaWVuY2UgZnVuY3Rpb24gdGhhdCBkZWxlZ2F0ZXMgdG8gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckNyZWF0ZSxcbiAqIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JVcGRhdGUsIG9yIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JEZXRhaWwgYmFzZWQgb24gdHlwZS5cbiAqIFxuICogQHBhcmFtIHByb3BlcnRpZXMgLSBBcnJheSBvZiBlbnRpdHkgYXR0cmlidXRlcyB0byBmb3JtYXRcbiAqIEBwYXJhbSB0eXBlIC0gUGFnZSB0eXBlOiAnY3JlYXRlJywgJ3VwZGF0ZScsIG9yICdkZXRhaWwnXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIGZvciBhY2Nlc3Npbmcgc2NoZW1hc1xuICogQHJldHVybnMgQXJyYXkgb2YgZm9ybWF0dGVkIGZpZWxkIG1ldGFkYXRhXG4gKiBAdGhyb3dzIEVycm9yIGlmIGludmFsaWQgdHlwZSBpcyBwcm92aWRlZFxuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckZvcm1PckRldGFpbChcbiAgICBwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSxcbiAgICB0eXBlOiAnY3JlYXRlJyB8ICd1cGRhdGUnIHwgJ2RldGFpbCcsXG4gICAgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PlxuKSB7XG5cbiAgICBpZiAodHlwZSA9PT0gJ2NyZWF0ZScpIHtcbiAgICAgICAgcmV0dXJuIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JDcmVhdGUocHJvcGVydGllcywgZW50aXR5U2VydmljZSk7XG4gICAgfVxuXG4gICAgaWYgKHR5cGUgPT09ICd1cGRhdGUnKSB7XG4gICAgICAgIHJldHVybiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yVXBkYXRlKHByb3BlcnRpZXMsIGVudGl0eVNlcnZpY2UpO1xuICAgIH1cblxuICAgIGlmICh0eXBlID09PSAnZGV0YWlsJykge1xuICAgICAgICByZXR1cm4gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckRldGFpbChwcm9wZXJ0aWVzLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICB9XG4gICAgdGhyb3cgKGBJbnZhbGlkIHR5cGUgWyR7dHlwZX1dIHByb3ZpZGVkIHRvIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JGb3JtT3JEZXRhaWxgKTtcbn1cblxuLyoqXG4gKiBGb3JtYXRzIGVudGl0eSBhdHRyaWJ1dGVzIGZvciBjcmVhdGUgZm9ybSBwYWdlcy5cbiAqIFxuICogRmlsdGVycyBhdHRyaWJ1dGVzIHRvIGluY2x1ZGUgb25seSBjcmVhdGFibGUgZmllbGRzIChyZXNwZWN0cyBpc0NyZWF0YWJsZSBmbGFnKVxuICogYW5kIGZvcm1hdHMgZWFjaCBmb3IgY3JlYXRlIGZvcm0gZGlzcGxheS5cbiAqIFxuICogQHBhcmFtIHByb3BlcnRpZXMgLSBBcnJheSBvZiBlbnRpdHkgYXR0cmlidXRlcyBmcm9tIHNjaGVtYVxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSBmb3IgYWNjZXNzaW5nIHJlbGF0ZWQgc2NoZW1hc1xuICogQHBhcmFtIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyAtIE9wdGlvbmFsIGdsb2JhbCBVSSBjb25maWd1cmF0aW9uIG9wdGlvbnNcbiAqIEByZXR1cm5zIEFycmF5IG9mIGZvcm1hdHRlZCBmaWVsZCBtZXRhZGF0YSBmb3IgY3JlYXRlIGZvcm1zXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yQ3JlYXRlKHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLCBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+LCBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbICd1aUNvbmZpZ0dlbk9wdGlvbnMnIF0pIHtcbiAgICByZXR1cm4gcHJvcGVydGllc1xuICAgICAgICAuZmlsdGVyKHByb3AgPT4gcHJvcCAmJiAoIXByb3AuaGFzT3duUHJvcGVydHkoJ2lzQ3JlYXRhYmxlJykgfHwgcHJvcC5pc0NyZWF0YWJsZSkpXG4gICAgICAgIC5tYXAoKGF0dCkgPT4gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKGF0dCwgJ2NyZWF0ZScsIGVudGl0eVNlcnZpY2UsIHByb3BlcnRpZXMsIGdsb2JhbFVJQ29uZmlnT3B0aW9ucykpO1xufVxuXG4vKipcbiAqIEZvcm1hdHMgZW50aXR5IGF0dHJpYnV0ZXMgZm9yIHVwZGF0ZS9lZGl0IGZvcm0gcGFnZXMuXG4gKiBcbiAqIEZpbHRlcnMgYXR0cmlidXRlcyB0byBpbmNsdWRlIG9ubHkgZWRpdGFibGUgZmllbGRzIChyZXNwZWN0cyBpc0VkaXRhYmxlIGZsYWcpXG4gKiBhbmQgZm9ybWF0cyBlYWNoIGZvciB1cGRhdGUgZm9ybSBkaXNwbGF5LlxuICogXG4gKiBAcGFyYW0gcHJvcGVydGllcyAtIEFycmF5IG9mIGVudGl0eSBhdHRyaWJ1dGVzIGZyb20gc2NoZW1hXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIGZvciBhY2Nlc3NpbmcgcmVsYXRlZCBzY2hlbWFzXG4gKiBAcGFyYW0gZ2xvYmFsVUlDb25maWdPcHRpb25zIC0gT3B0aW9uYWwgZ2xvYmFsIFVJIGNvbmZpZ3VyYXRpb24gb3B0aW9uc1xuICogQHJldHVybnMgQXJyYXkgb2YgZm9ybWF0dGVkIGZpZWxkIG1ldGFkYXRhIGZvciB1cGRhdGUgZm9ybXNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JVcGRhdGUocHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sgJ3VpQ29uZmlnR2VuT3B0aW9ucycgXSkge1xuICAgIHJldHVybiBwcm9wZXJ0aWVzXG4gICAgICAgIC5maWx0ZXIocHJvcCA9PiBwcm9wICYmICghcHJvcC5oYXNPd25Qcm9wZXJ0eSgnaXNFZGl0YWJsZScpIHx8IHByb3AuaXNFZGl0YWJsZSkpXG4gICAgICAgIC5tYXAoKGF0dCkgPT4gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKGF0dCwgJ3VwZGF0ZScsIGVudGl0eVNlcnZpY2UsIHByb3BlcnRpZXMsIGdsb2JhbFVJQ29uZmlnT3B0aW9ucykpO1xufVxuXG4vKipcbiAqIEZvcm1hdHMgZW50aXR5IGF0dHJpYnV0ZXMgZm9yIGRldGFpbC92aWV3IHBhZ2VzLlxuICogXG4gKiBGaWx0ZXJzIGF0dHJpYnV0ZXMgdG8gaW5jbHVkZSBvbmx5IHZpc2libGUgZmllbGRzIChyZXNwZWN0cyBpc1Zpc2libGUgZmxhZylcbiAqIGFuZCBmb3JtYXRzIGVhY2ggZm9yIGRldGFpbCBwYWdlIGRpc3BsYXkuXG4gKiBcbiAqIEBwYXJhbSBwcm9wZXJ0aWVzIC0gQXJyYXkgb2YgZW50aXR5IGF0dHJpYnV0ZXMgZnJvbSBzY2hlbWFcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gRW50aXR5IHNlcnZpY2UgZm9yIGFjY2Vzc2luZyByZWxhdGVkIHNjaGVtYXNcbiAqIEBwYXJhbSBnbG9iYWxVSUNvbmZpZ09wdGlvbnMgLSBPcHRpb25hbCBnbG9iYWwgVUkgY29uZmlndXJhdGlvbiBvcHRpb25zXG4gKiBAcmV0dXJucyBBcnJheSBvZiBmb3JtYXR0ZWQgZmllbGQgbWV0YWRhdGEgZm9yIGRldGFpbCB2aWV3c1xuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckRldGFpbChwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSwgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PiwgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyAndWlDb25maWdHZW5PcHRpb25zJyBdKSB7XG4gICAgcmV0dXJuIHByb3BlcnRpZXNcbiAgICAgICAgLmZpbHRlcihwcm9wID0+IHByb3AgJiYgKCFwcm9wLmhhc093blByb3BlcnR5KCdpc1Zpc2libGUnKSB8fCBwcm9wLmlzVmlzaWJsZSkpXG4gICAgICAgIC5tYXAoKGF0dCkgPT4gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKGF0dCwgJ2RldGFpbCcsIGVudGl0eVNlcnZpY2UsIHByb3BlcnRpZXMsIGdsb2JhbFVJQ29uZmlnT3B0aW9ucykpO1xufVxuXG4vKipcbiAqIFR5cGUgZGVmaW5pdGlvbiBmb3IgbGlzdC90YWJsZSBjb2x1bW4gY29uZmlndXJhdGlvbi5cbiAqIFxuICogRXh0ZW5kcyBGaWVsZE1ldGFkYXRhIHdpdGggbGlzdC1zcGVjaWZpYyBwcm9wZXJ0aWVzIGxpa2UgYWN0aW9ucywgdGVtcGxhdGVzLFxuICogYW5kIHJlbGF0aW9uIHJlbmRlcmluZyBjb25maWd1cmF0aW9ucy5cbiAqL1xuZXhwb3J0IHR5cGUgTGlzdGluZ1Byb3BDb25maWcgPSBQaWNrPEZpZWxkTWV0YWRhdGEsICdmaWVsZFR5cGUnIHwgJ3BsYWNlaG9sZGVyJyB8ICdoZWxwVGV4dCcgfCAnZmlsdGVyQ29uZmlnJz4gJiB7XG4gICAgbmFtZTogc3RyaW5nLFxuICAgIGRhdGFJbmRleDogc3RyaW5nLFxuICAgIGhpZGRlbj86IGJvb2xlYW4sXG4gICAgYWN0aW9ucz86IEFycmF5PElFbnRpdHlQYWdlQWN0aW9uPixcbiAgICByZWxhdGlvbkNvbmZpZz86IElSZWxhdGlvbkZpZWxkQ29uZmlnLCAgLy8gRm9yIHJlbmRlcmluZyByZWxhdGlvbnMgd2l0aCBsaW5rcy9tb2RhbHNcbiAgICB0ZW1wbGF0ZT86IFRlbXBsYXRlLCAgLy8gRm9yIHRlbXBsYXRlLWJhc2VkIHJlbmRlcmluZ1xuICAgIGlzSWRlbnRpZmllcj86IGJvb2xlYW4sICAvLyBGb3IgaWRlbnRpZmllciBmaWVsZHNcbiAgICBpc0xpbms/OiBib29sZWFuLCAgLy8gRm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICBsaW5rQ29uZmlnPzogeyByb3V0ZVBhdHRlcm46IHN0cmluZzsgZGlzcGxheVRleHQ/OiBzdHJpbmcgfSwgIC8vIEZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG59O1xuXG4vKipcbiAqIEZvcm1hdHMgZW50aXR5IGF0dHJpYnV0ZXMgZm9yIGxpc3QvdGFibGUgZGlzcGxheS5cbiAqIFxuICogVHJhbnNmb3JtcyBzY2hlbWEgYXR0cmlidXRlcyBpbnRvIHRhYmxlIGNvbHVtbiBjb25maWd1cmF0aW9ucyB3aXRoOlxuICogLSBBdXRvLWdlbmVyYXRlZCBmaWx0ZXIgY29uZmlndXJhdGlvbnMgZm9yIGZpbHRlcmFibGUgY29sdW1uc1xuICogLSBSZWxhdGlvbiBkaXNwbGF5IGNvbmZpZ3VyYXRpb25zIHdpdGggbGlua3MgYW5kIG1vZGFsIHN1cHBvcnRcbiAqIC0gVGVtcGxhdGUtYmFzZWQgcmVuZGVyaW5nIGZvciBkdXBsaWNhdGVkIHJlbGF0aW9uIGZpZWxkc1xuICogLSBQcm9wZXIgZmllbGQgdHlwZXMgYW5kIHZpc2liaWxpdHkgaGFuZGxpbmdcbiAqIFxuICogVGhpcyBpcyB0aGUgbWFpbiBlbnRyeSBwb2ludCBmb3IgZ2VuZXJhdGluZyB0YWJsZSBjb2x1bW4gY29uZmlndXJhdGlvbnMgZnJvbSBlbnRpdHkgc2NoZW1hcy5cbiAqIFxuICogQHBhcmFtIGVudGl0eU5hbWUgLSBOYW1lIG9mIHRoZSBlbnRpdHkgKGZvciBnZW5lcmF0aW5nIHJvdXRlIHBhdHRlcm5zKVxuICogQHBhcmFtIHByb3BlcnRpZXMgLSBBcnJheSBvZiBlbnRpdHkgYXR0cmlidXRlcyBmcm9tIHNjaGVtYVxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSBmb3IgYWNjZXNzaW5nIHJlbGF0ZWQgc2NoZW1hc1xuICogQHBhcmFtIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyAtIE9wdGlvbmFsIGdsb2JhbCBVSSBjb25maWd1cmF0aW9uIG9wdGlvbnNcbiAqIEByZXR1cm5zIEFycmF5IG9mIGZvcm1hdHRlZCBjb2x1bW4gY29uZmlndXJhdGlvbnMgZm9yIHRhYmxlIGRpc3BsYXlcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IGNvbHVtbnMgPSBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yTGlzdChcbiAqICAgJ2dhbWUnLFxuICogICBnYW1lU2NoZW1hLmF0dHJpYnV0ZXMsXG4gKiAgIGdhbWVTZXJ2aWNlLFxuICogICBnbG9iYWxDb25maWdcbiAqICk7XG4gKiAvLyBSZXR1cm5zIGFycmF5IG9mIGNvbHVtbiBjb25maWdzIHdpdGggZmlsdGVycywgcmVsYXRpb25zLCBhbmQgdGVtcGxhdGVzXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JMaXN0KFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSxcbiAgICBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+LFxuICAgIHtcbiAgICAgICAgQ1JVREFwaVBhdGgsXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGUsXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZWxldGUsXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZXRhaWwsXG4gICAgICAgIGN1c3RvbVJvd0FjdGlvbnMsXG4gICAgICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9uc1xuICAgIH06IHtcbiAgICAgICAgQ1JVREFwaVBhdGg/OiBzdHJpbmcsXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGU/OiBib29sZWFuLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluRGVsZXRlPzogYm9vbGVhbixcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pbkRldGFpbD86IGJvb2xlYW4sXG4gICAgICAgIGN1c3RvbVJvd0FjdGlvbnM/OiBSZWFkb25seUFycmF5PElFbnRpdHlQYWdlQWN0aW9uPiB8IEFycmF5PElFbnRpdHlQYWdlQWN0aW9uPixcbiAgICAgICAgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyAndWlDb25maWdHZW5PcHRpb25zJyBdICAvLyBORVc6IEdsb2JhbCBjb25maWcgb3B0aW9uc1xuICAgIH1cbikge1xuXG4gICAgY29uc3QgZW50aXR5TmFtZUxvd2VyID0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IGVudGl0eU5hbWVQYXNjYWxDYXNlID0gcGFzY2FsQ2FzZShlbnRpdHlOYW1lKTtcblxuICAgIHJldHVybiBwcm9wZXJ0aWVzXG4gICAgICAgIC5maWx0ZXIocHJvcCA9PiBwcm9wICYmIHByb3AuaXNMaXN0YWJsZSlcbiAgICAgICAgLm1hcChwcm9wID0+IHtcbiAgICAgICAgICAgIC8vIFVzZSBzYW1lIGZvcm1hdHRpbmcgbG9naWMgYXMgZGV0YWlscy9mb3JtcyAoaW5jbHVkZXMgcmVsYXRpb25Db25maWcgZ2VuZXJhdGlvbilcbiAgICAgICAgICAgIC8vIFBhc3MgYWxsIHByb3BlcnRpZXMgc28gaXQgY2FuIGRldGVjdCBkdXBsaWNhdGVkIHJlbGF0aW9uIGZpZWxkcyAoZS5nLiwgdGVhbU5hbWUgZm9yIHRlYW1JZClcbiAgICAgICAgICAgIGNvbnN0IGZvcm1hdHRlZCA9IGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbChwcm9wLCAnZGV0YWlsJywgZW50aXR5U2VydmljZSwgcHJvcGVydGllcywgZ2xvYmFsVUlDb25maWdPcHRpb25zKTtcblxuICAgICAgICAgICAgLy8gQXV0by1nZW5lcmF0ZSBmaWx0ZXJDb25maWcgaWYgbm90IGFscmVhZHkgcHJlc2VudCBhbmQgZmllbGQgaXMgZmlsdGVyYWJsZVxuICAgICAgICAgICAgY29uc3QgYXV0b0dlbmVyYXRlZEZpbHRlckNvbmZpZyA9ICFmb3JtYXR0ZWQuZmlsdGVyQ29uZmlnICYmIHByb3AuaXNGaWx0ZXJhYmxlICE9PSBmYWxzZVxuICAgICAgICAgICAgICAgID8gZ2VuZXJhdGVGaWx0ZXJDb25maWcocHJvcCwgZW50aXR5U2VydmljZSwgZ2xvYmFsVUlDb25maWdPcHRpb25zKVxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkO1xuXG4gICAgICAgICAgICAvLyBPdmVycmlkZS9hZGQgbGlzdC1zcGVjaWZpYyBwcm9wZXJ0aWVzXG4gICAgICAgICAgICBjb25zdCBwcm9wQ29uZmlnOiBMaXN0aW5nUHJvcENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICAuLi5mb3JtYXR0ZWQsXG4gICAgICAgICAgICAgICAgbmFtZTogZm9ybWF0dGVkLmxhYmVsIHx8IGZvcm1hdHRlZC5uYW1lLCAgLy8gRW5zdXJlIG5hbWUgaXMgc2V0IGZvciB0YWJsZSBjb2x1bW4gaGVhZGVyXG4gICAgICAgICAgICAgICAgZGF0YUluZGV4OiBgJHtwcm9wLmlkfWAsXG4gICAgICAgICAgICAgICAgZmllbGRUeXBlOiBmb3JtYXR0ZWQuZmllbGRUeXBlIHx8ICd0ZXh0JyxcbiAgICAgICAgICAgICAgICBmaWx0ZXJDb25maWc6IGZvcm1hdHRlZC5maWx0ZXJDb25maWcgfHwgYXV0b0dlbmVyYXRlZEZpbHRlckNvbmZpZywgIC8vIFVzZSBleHBsaWNpdCBvciBhdXRvLWdlbmVyYXRlZFxuICAgICAgICAgICAgICAgIGhpZGRlbjogcHJvcC5oYXNPd25Qcm9wZXJ0eSgnaXNWaXNpYmxlJykgJiYgIXByb3AuaXNWaXNpYmxlXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBpZiAocHJvcC5pc0lkZW50aWZpZXIpIHtcbiAgICAgICAgICAgICAgICAvLyBCdWlsZCBkZWZhdWx0IHJvdyBhY3Rpb25zIHdpdGggSURzXG4gICAgICAgICAgICAgICAgY29uc3QgZGVmYXVsdEFjdGlvbnM6IEFycmF5PElFbnRpdHlQYWdlQWN0aW9uPiA9IFtdO1xuXG4gICAgICAgICAgICAgICAgaWYgKCFleGNsdWRlRnJvbUFkbWluRGV0YWlsKSB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRBY3Rpb25zLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgaWQ6ICd2aWV3JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb246ICd2aWV3JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnVmlldycsXG4gICAgICAgICAgICAgICAgICAgICAgICB0ZW1wbGF0ZTogYFZpZXcgeyR7cHJvcC5pZH19YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybDogYC92aWV3LSR7ZW50aXR5TmFtZUxvd2VyfWBcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKCFleGNsdWRlRnJvbUFkbWluVXBkYXRlKSB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRBY3Rpb25zLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgaWQ6ICdlZGl0JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb246ICdlZGl0JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnRWRpdCcsXG4gICAgICAgICAgICAgICAgICAgICAgICB0ZW1wbGF0ZTogYEVkaXQgeyR7cHJvcC5pZH19YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybDogYC9lZGl0LSR7ZW50aXR5TmFtZUxvd2VyfWBcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKCFleGNsdWRlRnJvbUFkbWluRGVsZXRlKSB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRBY3Rpb25zLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgaWQ6ICdkZWxldGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbjogJ2RlbGV0ZScsXG4gICAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0RlbGV0ZScsXG4gICAgICAgICAgICAgICAgICAgICAgICB0ZW1wbGF0ZTogYERlbGV0ZSB7JHtwcm9wLmlkfX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgb3BlbkluTW9kYWw6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBtb2RhbENvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGFsVHlwZTogJ2NvbmZpcm0nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGFsUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aXRsZTogYERlbGV0ZSAke2VudGl0eU5hbWVQYXNjYWxDYXNlfT9gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50OiBgQXJlIHlvdSBzdXJlIHlvdSB3YW50IHRvIGRlbGV0ZSB0aGlzICR7ZW50aXR5TmFtZVBhc2NhbENhc2V9PyBUaGlzIGFjdGlvbiBjYW5ub3QgYmUgdW5kb25lLmBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFwaUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhcGlNZXRob2Q6IGBERUxFVEVgLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXNwb25zZUtleTogZW50aXR5TmFtZUxvd2VyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhcGlVcmw6IGAke0NSVURBcGlQYXRoID8gQ1JVREFwaVBhdGggOiAnJ30vJHtlbnRpdHlOYW1lTG93ZXJ9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3NNZXNzYWdlOiBgJHtlbnRpdHlOYW1lUGFzY2FsQ2FzZX0gZGVsZXRlZCBzdWNjZXNzZnVsbHlgLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yTWVzc2FnZTogYEZhaWxlZCB0byBkZWxldGUgJHtlbnRpdHlOYW1lUGFzY2FsQ2FzZX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1Ym1pdFN1Y2Nlc3NSZWRpcmVjdDogYC9saXN0LSR7ZW50aXR5TmFtZUxvd2VyfWBcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gTWVyZ2UgY3VzdG9tIHJvdyBhY3Rpb25zIHVzaW5nIGlkZW50aWZpZXItYmFzZWQgb3ZlcnJpZGVcbiAgICAgICAgICAgICAgICBwcm9wQ29uZmlnLmFjdGlvbnMgPSBjdXN0b21Sb3dBY3Rpb25zXG4gICAgICAgICAgICAgICAgICAgID8gbWVyZ2VBY3Rpb25zKGRlZmF1bHRBY3Rpb25zLCBjdXN0b21Sb3dBY3Rpb25zKVxuICAgICAgICAgICAgICAgICAgICA6IGRlZmF1bHRBY3Rpb25zO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gcHJvcENvbmZpZztcbiAgICAgICAgfSk7XG59XG5cbi8qKlxuICogTUVSR0UgVVRJTElUWSBGVU5DVElPTlNcbiAqIFxuICogVGhlc2UgZnVuY3Rpb25zIGltcGxlbWVudCB0aGUgaWRlbnRpZmllci1iYXNlZCBvdmVycmlkZSBwYXR0ZXJuOlxuICogLSBEZWZhdWx0cyBoYXZlIHN0YW5kYXJkIGlkZW50aWZpZXJzIChlLmcuLCAndmlldycsICdlZGl0JywgJ2RlbGV0ZScpXG4gKiAtIEN1c3RvbSBjb25maWdzIHdpdGggc2FtZSBpZGVudGlmaWVyIG92ZXJyaWRlIHRoZSBkZWZhdWx0XG4gKiAtIE5ldyBpZGVudGlmaWVycyBnZXQgYWRkZWQgdG8gdGhlIHJlc3VsdFxuICovXG5cbi8qKlxuICogTWVyZ2UgZGVmYXVsdCBidXR0b25zIHdpdGggY3VzdG9tIGJ1dHRvbnMgdXNpbmcgaWRlbnRpZmllci1iYXNlZCBvdmVycmlkZS5cbiAqIFxuICogQHBhcmFtIGRlZmF1bHRzIC0gRGVmYXVsdCBidXR0b25zIChmcm9tIGdlbmVyYXRvcilcbiAqIEBwYXJhbSBjdXN0b21zIC0gQ3VzdG9tIGJ1dHRvbnMgKGZyb20gZW50aXR5IHNjaGVtYSlcbiAqIEByZXR1cm5zIE1lcmdlZCBidXR0b24gYXJyYXlcbiAqL1xuLyoqXG4gKiBNZXJnZXMgZGVmYXVsdCBidXR0b25zIHdpdGggY3VzdG9tIGJ1dHRvbnMgdXNpbmcgSUQtYmFzZWQgb3ZlcnJpZGUgbG9naWMuXG4gKiBcbiAqIEN1c3RvbSBidXR0b25zIHdpdGggbWF0Y2hpbmcgSURzIG92ZXJyaWRlIGRlZmF1bHRzLCBhbmQgbmV3IGN1c3RvbSBidXR0b25zIGFyZSBhcHBlbmRlZC5cbiAqIEJ1dHRvbnMgd2l0aG91dCBJRHMgYXJlIGFsd2F5cyBpbmNsdWRlZCAobm8gZGVkdXBsaWNhdGlvbikuXG4gKiBcbiAqIEB0ZW1wbGF0ZSBUIC0gQnV0dG9uIHR5cGUgd2l0aCBvcHRpb25hbCBpZCBwcm9wZXJ0eVxuICogQHBhcmFtIGRlZmF1bHRzIC0gRGVmYXVsdCBidXR0b24gY29uZmlndXJhdGlvbnNcbiAqIEBwYXJhbSBjdXN0b21zIC0gQ3VzdG9tIGJ1dHRvbiBjb25maWd1cmF0aW9ucyB0byBtZXJnZVxuICogQHJldHVybnMgTWVyZ2VkIGFycmF5IHdpdGggY3VzdG9tIG92ZXJyaWRlcyBhcHBsaWVkXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBkZWZhdWx0cyA9IFtcbiAqICAgeyBpZDogJ3NhdmUnLCBsYWJlbDogJ1NhdmUnLCBhY3Rpb246ICdzdWJtaXQnIH0sXG4gKiAgIHsgaWQ6ICdjYW5jZWwnLCBsYWJlbDogJ0NhbmNlbCcsIGFjdGlvbjogJ2NhbmNlbCcgfVxuICogXTtcbiAqIGNvbnN0IGN1c3RvbXMgPSBbXG4gKiAgIHsgaWQ6ICdzYXZlJywgbGFiZWw6ICdTYXZlIENoYW5nZXMnLCBhY3Rpb246ICdzdWJtaXQnIH0sIC8vIE92ZXJyaWRlXG4gKiAgIHsgaWQ6ICdkZWxldGUnLCBsYWJlbDogJ0RlbGV0ZScsIGFjdGlvbjogJ2RlbGV0ZScgfSAgICAgIC8vIE5ld1xuICogXTtcbiAqIGNvbnN0IG1lcmdlZCA9IG1lcmdlQnV0dG9ucyhkZWZhdWx0cywgY3VzdG9tcyk7XG4gKiAvLyBSZXR1cm5zOiBbXG4gKiAvLyAgIHsgaWQ6ICdzYXZlJywgbGFiZWw6ICdTYXZlIENoYW5nZXMnLCBhY3Rpb246ICdzdWJtaXQnIH0sXG4gKiAvLyAgIHsgaWQ6ICdjYW5jZWwnLCBsYWJlbDogJ0NhbmNlbCcsIGFjdGlvbjogJ2NhbmNlbCcgfSxcbiAqIC8vICAgeyBpZDogJ2RlbGV0ZScsIGxhYmVsOiAnRGVsZXRlJywgYWN0aW9uOiAnZGVsZXRlJyB9XG4gKiAvLyBdXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlQnV0dG9uczxUIGV4dGVuZHMgeyBpZD86IHN0cmluZyB9PihcbiAgICBkZWZhdWx0czogQXJyYXk8VD4sXG4gICAgY3VzdG9tczogUmVhZG9ubHlBcnJheTxUPiB8IEFycmF5PFQ+ID0gW11cbik6IEFycmF5PFQ+IHtcbiAgICBjb25zdCBjdXN0b21zQXJyYXkgPSBbIC4uLmN1c3RvbXMgXTsgIC8vIENvbnZlcnQgdG8gbXV0YWJsZSBhcnJheVxuICAgIGNvbnN0IGN1c3RvbU1hcCA9IG5ldyBNYXAoXG4gICAgICAgIGN1c3RvbXNBcnJheS5maWx0ZXIoYyA9PiBjLmlkKS5tYXAoYyA9PiBbIGMuaWQsIGMgXSlcbiAgICApO1xuXG4gICAgLy8gU3RhcnQgd2l0aCBkZWZhdWx0cywgcmVwbGFjZSBpZiBjdXN0b20gaGFzIHNhbWUgaWRcbiAgICBjb25zdCBtZXJnZWQgPSBkZWZhdWx0cy5tYXAoZGVmYXVsdEJ0biA9PlxuICAgICAgICBkZWZhdWx0QnRuLmlkICYmIGN1c3RvbU1hcC5oYXMoZGVmYXVsdEJ0bi5pZClcbiAgICAgICAgICAgID8gY3VzdG9tTWFwLmdldChkZWZhdWx0QnRuLmlkKSEgIC8vIE92ZXJyaWRlXG4gICAgICAgICAgICA6IGRlZmF1bHRCdG5cbiAgICApO1xuXG4gICAgLy8gQWRkIGN1c3RvbSBidXR0b25zIHRoYXQgZG9uJ3Qgb3ZlcnJpZGUgZGVmYXVsdHNcbiAgICBjdXN0b21zQXJyYXkuZm9yRWFjaChjdXN0b21CdG4gPT4ge1xuICAgICAgICBpZiAoIWN1c3RvbUJ0bi5pZCB8fCAhZGVmYXVsdHMuc29tZShkID0+IGQuaWQgPT09IGN1c3RvbUJ0bi5pZCkpIHtcbiAgICAgICAgICAgIG1lcmdlZC5wdXNoKGN1c3RvbUJ0bik7ICAvLyBBZGQgbmV3XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiBtZXJnZWQ7XG59XG5cbi8qKlxuICogTWVyZ2VzIGRlZmF1bHQgYWN0aW9ucyB3aXRoIGN1c3RvbSBhY3Rpb25zIHVzaW5nIElELWJhc2VkIG92ZXJyaWRlIGxvZ2ljLlxuICogXG4gKiBEZWxlZ2F0ZXMgdG8gbWVyZ2VCdXR0b25zIHdpdGggdGhlIHNhbWUgYmVoYXZpb3I6IGN1c3RvbSBhY3Rpb25zIHdpdGggbWF0Y2hpbmcgSURzXG4gKiBvdmVycmlkZSBkZWZhdWx0cywgYW5kIG5ldyBjdXN0b20gYWN0aW9ucyBhcmUgYXBwZW5kZWQuIFNlbWFudGljYWxseSBuYW1lZCBmb3Igcm93L3RhYmxlIGFjdGlvbnMuXG4gKiBcbiAqIEB0ZW1wbGF0ZSBUIC0gQWN0aW9uIHR5cGUgd2l0aCBvcHRpb25hbCBpZCBwcm9wZXJ0eVxuICogQHBhcmFtIGRlZmF1bHRzIC0gRGVmYXVsdCBhY3Rpb24gY29uZmlndXJhdGlvbnNcbiAqIEBwYXJhbSBjdXN0b21zIC0gQ3VzdG9tIGFjdGlvbiBjb25maWd1cmF0aW9ucyB0byBtZXJnZVxuICogQHJldHVybnMgTWVyZ2VkIGFycmF5IHdpdGggY3VzdG9tIG92ZXJyaWRlcyBhcHBsaWVkXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBkZWZhdWx0cyA9IFtcbiAqICAgeyBpZDogJ2VkaXQnLCBsYWJlbDogJ0VkaXQnLCBhY3Rpb246ICdlZGl0JyB9LFxuICogICB7IGlkOiAnZGVsZXRlJywgbGFiZWw6ICdEZWxldGUnLCBhY3Rpb246ICdkZWxldGUnIH1cbiAqIF07XG4gKiBjb25zdCBjdXN0b21zID0gW1xuICogICB7IGlkOiAnZGVsZXRlJywgbGFiZWw6ICdSZW1vdmUnLCBhY3Rpb246ICdkZWxldGUnLCBjb25maXJtOiB0cnVlIH0gLy8gT3ZlcnJpZGVcbiAqIF07XG4gKiBjb25zdCBtZXJnZWQgPSBtZXJnZUFjdGlvbnMoZGVmYXVsdHMsIGN1c3RvbXMpO1xuICogLy8gUmV0dXJuczogW1xuICogLy8gICB7IGlkOiAnZWRpdCcsIGxhYmVsOiAnRWRpdCcsIGFjdGlvbjogJ2VkaXQnIH0sXG4gKiAvLyAgIHsgaWQ6ICdkZWxldGUnLCBsYWJlbDogJ1JlbW92ZScsIGFjdGlvbjogJ2RlbGV0ZScsIGNvbmZpcm06IHRydWUgfVxuICogLy8gXVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZUFjdGlvbnM8VCBleHRlbmRzIHsgaWQ/OiBzdHJpbmcgfT4oXG4gICAgZGVmYXVsdHM6IEFycmF5PFQ+LFxuICAgIGN1c3RvbXM6IFJlYWRvbmx5QXJyYXk8VD4gfCBBcnJheTxUPiA9IFtdXG4pOiBBcnJheTxUPiB7XG4gICAgcmV0dXJuIG1lcmdlQnV0dG9ucyhkZWZhdWx0cywgWyAuLi5jdXN0b21zIF0pOyAgLy8gU3ByZWFkIHRvIGhhbmRsZSBib3RoIHJlYWRvbmx5IGFuZCBtdXRhYmxlXG59XG5cbi8qKlxuICogTWVyZ2VzIGZpZWxkLWxldmVsIHZpc2liaWxpdHksIGVuYWJsZW1lbnQsIGhlbHAgdGV4dCwgYW5kIHBsYWNlaG9sZGVyIG92ZXJyaWRlcyBpbnRvIGJhc2UgcHJvcGVydGllcy5cbiAqIFxuICogQXBwbGllcyBjdXN0b20gZmllbGQgY29uZmlndXJhdGlvbnMgZnJvbSBmb3JtL2RldGFpbCBjb25maWcgdG8gYmFzZSBzY2hlbWEgcHJvcGVydGllcy5cbiAqIE9ubHkgbWVyZ2VzIG92ZXJyaWRlcyBmb3IgZmllbGRzIHRoYXQgZXhpc3QgaW4gYmFzZSBwcm9wZXJ0aWVzICh3YXJucyBhYm91dCBub24tZXhpc3RlbnQgZmllbGRzKS5cbiAqIFxuICogQHRlbXBsYXRlIFQgLSBQcm9wZXJ0eSB0eXBlIHdpdGggcmVxdWlyZWQgbmFtZSBmaWVsZFxuICogQHBhcmFtIGJhc2VQcm9wZXJ0aWVzIC0gQmFzZSBmaWVsZCBwcm9wZXJ0aWVzIGZyb20gZW50aXR5IHNjaGVtYVxuICogQHBhcmFtIGZpZWxkT3ZlcnJpZGVzIC0gQ3VzdG9tIGZpZWxkIG92ZXJyaWRlcyBmcm9tIGZvcm0vZGV0YWlsIGNvbmZpZ3VyYXRpb25cbiAqIEByZXR1cm5zIEJhc2UgcHJvcGVydGllcyB3aXRoIG92ZXJyaWRlcyBtZXJnZWQgaW5cbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IGJhc2VQcm9wcyA9IFtcbiAqICAgeyBuYW1lOiAnZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUgfSxcbiAqICAgeyBuYW1lOiAnYmlvJywgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiBmYWxzZSB9XG4gKiBdO1xuICogY29uc3Qgb3ZlcnJpZGVzID0gW1xuICogICB7IG5hbWU6ICdlbWFpbCcsIGhlbHBUZXh0OiAnRW50ZXIgYSB2YWxpZCBlbWFpbCBhZGRyZXNzJyB9LFxuICogICB7IG5hbWU6ICdiaW8nLCB2aXNpYmlsaXR5OiB7IGNyZWF0ZTogZmFsc2UgfSB9XG4gKiBdO1xuICogY29uc3QgbWVyZ2VkID0gbWVyZ2VGaWVsZFZpc2liaWxpdHkoYmFzZVByb3BzLCBvdmVycmlkZXMpO1xuICogLy8gUmV0dXJucyBiYXNlUHJvcHMgd2l0aCBoZWxwVGV4dCBhbmQgdmlzaWJpbGl0eSBtZXJnZWRcbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VGaWVsZFZpc2liaWxpdHk8VCBleHRlbmRzIHsgbmFtZTogc3RyaW5nIH0+KFxuICAgIGJhc2VQcm9wZXJ0aWVzOiBBcnJheTxUPixcbiAgICBmaWVsZE92ZXJyaWRlczogUmVhZG9ubHlBcnJheTx7XG4gICAgICAgIHJlYWRvbmx5IG5hbWU6IHN0cmluZztcbiAgICAgICAgcmVhZG9ubHkgdmlzaWJpbGl0eT86IGFueTtcbiAgICAgICAgcmVhZG9ubHkgZW5hYmxlbWVudD86IGFueTtcbiAgICAgICAgcmVhZG9ubHkgaGVscFRleHQ/OiBzdHJpbmc7XG4gICAgICAgIHJlYWRvbmx5IHBsYWNlaG9sZGVyPzogc3RyaW5nO1xuICAgIH0+IHwgQXJyYXk8e1xuICAgICAgICBuYW1lOiBzdHJpbmc7XG4gICAgICAgIHZpc2liaWxpdHk/OiBhbnk7XG4gICAgICAgIGVuYWJsZW1lbnQ/OiBhbnk7XG4gICAgICAgIGhlbHBUZXh0Pzogc3RyaW5nO1xuICAgICAgICBwbGFjZWhvbGRlcj86IHN0cmluZztcbiAgICB9PiA9IFtdXG4pOiBBcnJheTxUPiB7XG4gICAgY29uc3Qgb3ZlcnJpZGVNYXAgPSBuZXcgTWFwKFxuICAgICAgICBbIC4uLmZpZWxkT3ZlcnJpZGVzIF0ubWFwKGYgPT4gWyBmLm5hbWUsIGYgXSlcbiAgICApO1xuXG4gICAgLy8gVmFsaWRhdGlvbjogV2FybiBpZiBmaWVsZCBvdmVycmlkZSByZWZlcmVuY2VzIG5vbi1leGlzdGVudCBmaWVsZFxuICAgIGZpZWxkT3ZlcnJpZGVzLmZvckVhY2gob3ZlcnJpZGUgPT4ge1xuICAgICAgICBpZiAoIWJhc2VQcm9wZXJ0aWVzLnNvbWUocCA9PiBwLm5hbWUgPT09IG92ZXJyaWRlLm5hbWUpKSB7XG4gICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYEZpZWxkIG92ZXJyaWRlIFwiJHtvdmVycmlkZS5uYW1lfVwiIG5vdCBmb3VuZCBpbiBzY2hlbWEgcHJvcGVydGllcy4gVGhpcyBvdmVycmlkZSB3aWxsIGJlIGlnbm9yZWQuYCk7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiBiYXNlUHJvcGVydGllcy5tYXAocHJvcCA9PiB7XG4gICAgICAgIGNvbnN0IG92ZXJyaWRlID0gb3ZlcnJpZGVNYXAuZ2V0KHByb3AubmFtZSk7XG5cbiAgICAgICAgaWYgKCFvdmVycmlkZSkgcmV0dXJuIHByb3A7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIC4uLnByb3AsXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUudmlzaWJpbGl0eSAhPT0gdW5kZWZpbmVkICYmIHsgdmlzaWJpbGl0eTogb3ZlcnJpZGUudmlzaWJpbGl0eSB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS5lbmFibGVtZW50ICE9PSB1bmRlZmluZWQgJiYgeyBlbmFibGVtZW50OiBvdmVycmlkZS5lbmFibGVtZW50IH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmhlbHBUZXh0ICE9PSB1bmRlZmluZWQgJiYgeyBoZWxwVGV4dDogb3ZlcnJpZGUuaGVscFRleHQgfSksXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUucGxhY2Vob2xkZXIgIT09IHVuZGVmaW5lZCAmJiB7IHBsYWNlaG9sZGVyOiBvdmVycmlkZS5wbGFjZWhvbGRlciB9KVxuICAgICAgICB9O1xuICAgIH0pO1xufVxuXG4vKipcbiAqIE1lcmdlcyBjb2x1bW4tbGV2ZWwgdmlzaWJpbGl0eSwgd2lkdGgsIGZpeGVkIHBvc2l0aW9uLCBhbmQgZ3JvdXBpbmcgb3ZlcnJpZGVzIGludG8gYmFzZSBwcm9wZXJ0aWVzLlxuICogXG4gKiBBcHBsaWVzIGN1c3RvbSBjb2x1bW4gY29uZmlndXJhdGlvbnMgZnJvbSB0YWJsZSBjb25maWcgdG8gYmFzZSBzY2hlbWEgcHJvcGVydGllcy5cbiAqIE9ubHkgbWVyZ2VzIG92ZXJyaWRlcyBmb3IgY29sdW1ucyB0aGF0IGV4aXN0IGluIGJhc2UgcHJvcGVydGllcyAod2FybnMgYWJvdXQgbm9uLWV4aXN0ZW50IGNvbHVtbnMpLlxuICogXG4gKiBAdGVtcGxhdGUgVCAtIFByb3BlcnR5IHR5cGUgd2l0aCByZXF1aXJlZCBuYW1lIGZpZWxkXG4gKiBAcGFyYW0gYmFzZVByb3BlcnRpZXMgLSBCYXNlIGNvbHVtbiBwcm9wZXJ0aWVzIGZyb20gZW50aXR5IHNjaGVtYVxuICogQHBhcmFtIGNvbHVtbk92ZXJyaWRlcyAtIEN1c3RvbSBjb2x1bW4gb3ZlcnJpZGVzIGZyb20gdGFibGUgY29uZmlndXJhdGlvblxuICogQHJldHVybnMgQmFzZSBwcm9wZXJ0aWVzIHdpdGggb3ZlcnJpZGVzIG1lcmdlZCBpblxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY29uc3QgYmFzZVByb3BzID0gW1xuICogICB7IG5hbWU6ICduYW1lJywgdHlwZTogJ3N0cmluZycgfSxcbiAqICAgeyBuYW1lOiAnZW1haWwnLCB0eXBlOiAnc3RyaW5nJyB9LFxuICogICB7IG5hbWU6ICdzdGF0dXMnLCB0eXBlOiAnc3RyaW5nJyB9XG4gKiBdO1xuICogY29uc3Qgb3ZlcnJpZGVzID0gW1xuICogICB7IGZpZWxkOiAnbmFtZScsIHdpZHRoOiAyMDAsIGZpeGVkOiAnbGVmdCcgfSxcbiAqICAgeyBmaWVsZDogJ2VtYWlsJywgdmlzaWJpbGl0eTogeyBsaXN0OiBmYWxzZSB9IH0sXG4gKiAgIHsgZmllbGQ6ICdzdGF0dXMnLCBncm91cFRpdGxlOiAnQWNjb3VudCBTdGF0dXMnIH1cbiAqIF07XG4gKiBjb25zdCBtZXJnZWQgPSBtZXJnZUNvbHVtblZpc2liaWxpdHkoYmFzZVByb3BzLCBvdmVycmlkZXMpO1xuICogLy8gUmV0dXJucyBiYXNlUHJvcHMgd2l0aCB3aWR0aCwgZml4ZWQsIHZpc2liaWxpdHksIGFuZCBncm91cFRpdGxlIG1lcmdlZFxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZUNvbHVtblZpc2liaWxpdHk8VCBleHRlbmRzIHsgbmFtZTogc3RyaW5nIH0+KFxuICAgIGJhc2VQcm9wZXJ0aWVzOiBBcnJheTxUPixcbiAgICBjb2x1bW5PdmVycmlkZXM6IFJlYWRvbmx5QXJyYXk8e1xuICAgICAgICByZWFkb25seSBmaWVsZDogc3RyaW5nO1xuICAgICAgICByZWFkb25seSB2aXNpYmlsaXR5PzogYW55O1xuICAgICAgICByZWFkb25seSB3aWR0aD86IHN0cmluZyB8IG51bWJlcjtcbiAgICAgICAgcmVhZG9ubHkgZml4ZWQ/OiAnbGVmdCcgfCAncmlnaHQnO1xuICAgICAgICByZWFkb25seSBncm91cFRpdGxlPzogc3RyaW5nO1xuICAgIH0+IHwgQXJyYXk8e1xuICAgICAgICBmaWVsZDogc3RyaW5nO1xuICAgICAgICB2aXNpYmlsaXR5PzogYW55O1xuICAgICAgICB3aWR0aD86IHN0cmluZyB8IG51bWJlcjtcbiAgICAgICAgZml4ZWQ/OiAnbGVmdCcgfCAncmlnaHQnO1xuICAgICAgICBncm91cFRpdGxlPzogc3RyaW5nO1xuICAgIH0+ID0gW11cbik6IEFycmF5PFQ+IHtcbiAgICBjb25zdCBvdmVycmlkZU1hcCA9IG5ldyBNYXAoXG4gICAgICAgIFsgLi4uY29sdW1uT3ZlcnJpZGVzIF0ubWFwKGMgPT4gWyBjLmZpZWxkLCBjIF0pXG4gICAgKTtcblxuICAgIC8vIFZhbGlkYXRpb246IFdhcm4gaWYgY29sdW1uIG92ZXJyaWRlIHJlZmVyZW5jZXMgbm9uLWV4aXN0ZW50IGNvbHVtblxuICAgIGNvbHVtbk92ZXJyaWRlcy5mb3JFYWNoKG92ZXJyaWRlID0+IHtcbiAgICAgICAgaWYgKCFiYXNlUHJvcGVydGllcy5zb21lKHAgPT4gcC5uYW1lID09PSBvdmVycmlkZS5maWVsZCkpIHtcbiAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgQ29sdW1uIG92ZXJyaWRlIFwiJHtvdmVycmlkZS5maWVsZH1cIiBub3QgZm91bmQgaW4gc2NoZW1hIHByb3BlcnRpZXMuIFRoaXMgb3ZlcnJpZGUgd2lsbCBiZSBpZ25vcmVkLmApO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gYmFzZVByb3BlcnRpZXMubWFwKHByb3AgPT4ge1xuICAgICAgICBjb25zdCBvdmVycmlkZSA9IG92ZXJyaWRlTWFwLmdldChwcm9wLm5hbWUpO1xuXG4gICAgICAgIGlmICghb3ZlcnJpZGUpIHJldHVybiBwcm9wO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAuLi5wcm9wLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLnZpc2liaWxpdHkgIT09IHVuZGVmaW5lZCAmJiB7IHZpc2liaWxpdHk6IG92ZXJyaWRlLnZpc2liaWxpdHkgfSksXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUud2lkdGggIT09IHVuZGVmaW5lZCAmJiB7IHdpZHRoOiBvdmVycmlkZS53aWR0aCB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS5maXhlZCAhPT0gdW5kZWZpbmVkICYmIHsgZml4ZWQ6IG92ZXJyaWRlLmZpeGVkIH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmdyb3VwVGl0bGUgIT09IHVuZGVmaW5lZCAmJiB7IGdyb3VwVGl0bGU6IG92ZXJyaWRlLmdyb3VwVGl0bGUgfSlcbiAgICAgICAgfTtcbiAgICB9KTtcbn1cbiJdfQ==
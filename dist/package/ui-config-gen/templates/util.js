"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRelationFallback = generateRelationFallback;
exports.resolveRelationOptionConfig = resolveRelationOptionConfig;
exports.generateFilterConfig = generateFilterConfig;
exports.generateSegments = generateSegments;
exports.formatEntityAttributeForFormOrDetail = formatEntityAttributeForFormOrDetail;
exports.formatEntityAttributesForFormOrDetail = formatEntityAttributesForFormOrDetail;
exports.expandPropertyReferences = expandPropertyReferences;
exports.processSectionsConfig = processSectionsConfig;
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
        // Use custom label if provided in schema (thisProp.label), otherwise format the name to human-readable
        label: thisProp.label || (0, utils_1.toHumanReadableName)(thisProp.name),
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
 * Expands shorthand field references into full PropertyConfig objects.
 *
 * **Enterprise-Grade Pattern Supporting:**
 *
 * 1. **String shorthand (schema fields only):** `'fieldName'` → looks up in schema, expands to full config
 * 2. **Object with schema field:** `{ name: 'status', fieldType: 'badge' }` → merges overrides with schema defaults
 * 3. **JSON path (nested data):** `{ name: 'userEmail', column: 'user.email', label: 'Email', fieldType: 'text' }`
 * 4. **Multiple renderings:** `{ name: 'statusBadge', column: 'status', fieldType: 'badge' }` + `{ name: 'statusText', column: 'status', fieldType: 'text' }`
 * 5. **Custom/computed fields:** `{ name: 'confirmPassword', label: 'Confirm', column: 'confirmPassword', fieldType: 'password' }`
 * 6. **Visibility control:** All configs support `visibility: VisibilityConfig` for role-based/conditional display
 *
 * **Key Concepts:**
 * - `name`: Unique UI identifier (must be unique within a single propertiesConfig)
 * - `column`: Data path - can be direct field, JSON path (`user.email`), or custom field
 * - Frontend uses `getNestedValue(record, column)` for data access (supports JSON paths)
 *
 * This is the property equivalent of `normalizeColumnOverrides()`.
 *
 * @param fieldReferences - Array containing strings (field names) or PropertyConfig objects
 * @param allProperties - All entity attributes from schema for field lookup
 * @param type - Page type: 'create', 'update', or 'detail' (determines formatting)
 * @param entityService - Entity service for accessing related schemas
 * @param globalUIConfigOptions - Optional global UI configuration options
 * @returns Array of full PropertyConfig objects
 *
 * @example
 * // 1. String shorthand (schema fields only)
 * propertiesConfig: ['teamName', 'city', 'status']
 *
 * @example
 * // 2. Override schema field display
 * propertiesConfig: [
 *   'teamName',
 *   { name: 'status', fieldType: 'badge' },  // Same field, different rendering
 *   'total'
 * ]
 *
 * @example
 * // 3. Multiple renderings of same field
 * propertiesConfig: [
 *   { name: 'progressBar', column: 'progress', label: 'Progress', fieldType: 'progress' },
 *   { name: 'progressValue', column: 'progress', label: 'Value', fieldType: 'number' }
 * ]
 *
 * @example
 * // 4. JSON paths (nested data)
 * propertiesConfig: [
 *   'teamName',
 *   { name: 'userEmail', column: 'user.email', label: 'Email', fieldType: 'text' },
 *   { name: 'settingsTheme', column: 'metadata.settings.theme', label: 'Theme', fieldType: 'text' }
 * ]
 *
 * @example
 * // 5. Custom/computed fields (not in schema, API provides them)
 * propertiesConfig: [
 *   'password',
 *   {
 *     name: 'confirmPassword',
 *     label: 'Confirm Password',
 *     column: 'confirmPassword',
 *     fieldType: 'password',
 *     required: true
 *   }
 * ]
 *
 * @example
 * // 6. With visibility config
 * propertiesConfig: [
 *   'teamName',
 *   {
 *     name: 'adminNotes',
 *     label: 'Admin Notes',
 *     column: 'adminNotes',
 *     fieldType: 'textarea',
 *     visibility: { requiredRoles: ['admin'] }
 *   }
 * ]
 */
function expandPropertyReferences(fieldReferences, allProperties, type, entityService, globalUIConfigOptions) {
    const propertyMap = new Map();
    allProperties.forEach(prop => {
        if (prop.id) { // Use prop.id (field identifier) not prop.name (human-readable label)
            propertyMap.set(prop.id, prop);
        }
    });
    return fieldReferences.map(propRef => {
        // Case 1: String shorthand → MUST be a direct schema field (convenience shortcut)
        if (typeof propRef === 'string') {
            const fieldAttribute = propertyMap.get(propRef);
            if (!fieldAttribute) {
                throw new Error(`Field '${propRef}' not found in entity schema. ` +
                    `Available field IDs: ${Array.from(propertyMap.keys()).join(', ')}. ` +
                    `\nFor non-schema fields (JSON paths, custom fields, multiple renderings), use object syntax:\n` +
                    `  { name: 'uniqueName', column: '${propRef}', label: '...', fieldType: '...' }`);
            }
            return formatEntityAttributeForFormOrDetail(fieldAttribute, type, entityService, allProperties, globalUIConfigOptions);
        }
        // Case 2-5: Object syntax (permissive - supports everything)
        if (typeof propRef === 'object' && propRef !== null) {
            // Validate minimum required properties
            if (!propRef.name) {
                logging_1.DefaultLogger.warn(`Property config missing 'name' field (required for UI identification). Skipping:`, propRef);
                return propRef; // Return as-is, let frontend handle
            }
            // Determine the data path (column can be: direct field, JSON path, or custom field)
            const column = propRef.column || propRef.name;
            // Extract just the root field name for schema lookup (handles JSON paths like "user.email" → "user")
            const rootFieldName = column.split('.')[0];
            const fieldAttribute = propertyMap.get(rootFieldName);
            // If root field exists in schema AND column is the exact field (not a path), merge with schema
            if (fieldAttribute && column === rootFieldName) {
                // Schema field with overrides - merge defaults + overrides
                const schemaDefaults = formatEntityAttributeForFormOrDetail(fieldAttribute, type, entityService, allProperties, globalUIConfigOptions);
                return {
                    ...schemaDefaults,
                    ...propRef, // User overrides take precedence
                    column // Ensure column is set
                };
            }
            // Otherwise: JSON path, custom field, or multiple rendering of same field
            // Auto-generate missing properties with proper formatting
            const label = propRef.label || (0, utils_1.toHumanReadableName)(propRef.name);
            const fieldType = propRef.fieldType || 'text';
            // Warn if label was auto-generated
            if (!propRef.label) {
                logging_1.DefaultLogger.debug(`Property '${propRef.name}' missing 'label'. Auto-generated: '${label}'. ` +
                    `For custom fields, explicitly provide: name, label, column, fieldType.`);
            }
            if (!propRef.fieldType) {
                logging_1.DefaultLogger.debug(`Property '${propRef.name}' missing 'fieldType'. Defaulted to 'text'. ` +
                    `Recommended field types: text, number, select, badge, progress, etc.`);
            }
            // Return with proper formatting
            return {
                ...propRef,
                column,
                label,
                fieldType
            };
        }
        // Fallback: unknown type, return as-is with warning
        logging_1.DefaultLogger.warn(`Unknown property reference type:`, propRef);
        return propRef;
    });
}
/**
 * Processes sectionsConfig and expands any shorthand propertiesConfig arrays.
 *
 * **Unified with column processing:**
 * - Uses `expandPropertyReferences()` (same pattern as `normalizeColumnOverrides()`)
 * - String shorthand `'fieldName'` → expands from schema
 * - Object syntax → merges with schema defaults
 *
 * Recursively walks through section groups and sections.
 *
 * @param sectionsConfig - Sections configuration from entity schema
 * @param allProperties - All entity attributes from schema for field lookup
 * @param entityService - Entity service for accessing related schemas
 * @param globalUIConfigOptions - Optional global UI configuration options
 * @returns Processed sections config with expanded properties
 */
function processSectionsConfig(sectionsConfig, allProperties, entityService, globalUIConfigOptions) {
    if (!sectionsConfig)
        return sectionsConfig;
    const processed = { ...sectionsConfig };
    // Process sections in single group format (backward compatible)
    if (processed.sections) {
        processed.sections = Object.entries(processed.sections).reduce((acc, [key, section]) => {
            acc[key] = processSectionConfig(section, allProperties, entityService, globalUIConfigOptions);
            return acc;
        }, {});
    }
    // Process section groups (new format)
    if (processed.sectionGroups) {
        processed.sectionGroups = processed.sectionGroups.map((group) => {
            if (!group.sections)
                return group;
            return {
                ...group,
                sections: Object.entries(group.sections).reduce((acc, [key, section]) => {
                    acc[key] = processSectionConfig(section, allProperties, entityService, globalUIConfigOptions);
                    return acc;
                }, {})
            };
        });
    }
    return processed;
}
/**
 * Processes a single section config and expands shorthand propertiesConfig.
 *
 * Uses unified `expandPropertyReferences()` function.
 *
 * @param section - Section configuration
 * @param allProperties - All entity attributes from schema
 * @param entityService - Entity service
 * @param globalUIConfigOptions - Optional global UI configuration options
 * @returns Processed section with expanded properties
 */
function processSectionConfig(section, allProperties, entityService, globalUIConfigOptions) {
    const processed = { ...section };
    // Process detailsPageConfig with propertiesConfig
    if (processed.pageType === 'details' && processed.detailsPageConfig?.propertiesConfig) {
        const config = processed.detailsPageConfig;
        processed.detailsPageConfig = {
            ...config,
            propertiesConfig: expandPropertyReferences(config.propertiesConfig, allProperties, 'detail', entityService, globalUIConfigOptions)
        };
    }
    // Process formPageConfig
    if (processed.pageType === 'form' && processed.formPageConfig?.propertiesConfig) {
        const config = processed.formPageConfig;
        // Forms in sections are typically 'create' forms
        processed.formPageConfig = {
            ...config,
            propertiesConfig: expandPropertyReferences(config.propertiesConfig, allProperties, 'create', entityService, globalUIConfigOptions)
        };
    }
    return processed;
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
 * Normalizes column overrides to a consistent format.
 * Supports both string shorthand ('fieldName') and object syntax ({ field: 'fieldName', ... })
 *
 * @param columnOverrides - Column configurations (string or object format)
 * @returns Normalized array of column config objects
 */
function normalizeColumnOverrides(columnOverrides) {
    return columnOverrides.map(col => {
        // String shorthand: 'fieldName' → { field: 'fieldName', defaultVisible: true }
        if (typeof col === 'string') {
            return {
                field: col,
                defaultVisible: true
            };
        }
        // Object syntax: already normalized, just ensure defaultVisible defaults to true
        return {
            field: col.field,
            visibility: col.visibility,
            width: col.width,
            fixed: col.fixed,
            groupTitle: col.groupTitle,
            defaultVisible: col.defaultVisible !== false // Defaults to true
        };
    });
}
/**
 * Merges column visibility configuration with base properties.
 * Controls which columns are visible by default and their display order.
 *
 * **Supports:**
 * - Schema fields (from base properties)
 * - JSON paths (e.g., 'user.email', 'metadata.score')
 * - Custom/computed columns (not in schema, provided by API or frontend)
 *
 * @template T - Base property type with name and dataIndex
 * @param baseProperties - Base properties from entity schema
 * @param columnOverrides - Column configuration overrides (string or object format)
 * @returns Merged properties with visibility and order applied, including custom columns
 */
function mergeColumnVisibility(baseProperties, columnOverrides = []) {
    // If no columnOverrides provided, return properties as-is (backward compatible)
    if (!columnOverrides || columnOverrides.length === 0) {
        return baseProperties;
    }
    // Normalize column overrides (handle string shorthand)
    const normalizedOverrides = normalizeColumnOverrides(columnOverrides);
    const overrideMap = new Map(normalizedOverrides.map((c, index) => [c.field, { ...c, _order: index }]));
    // Track which overrides match existing schema columns
    const matchedOverrides = new Set();
    // Merge overrides into existing schema properties
    const mergedProperties = baseProperties.map(prop => {
        // Use dataIndex (actual field name) if available, otherwise fall back to name
        const fieldName = prop.dataIndex || prop.name;
        const override = overrideMap.get(fieldName);
        if (!override) {
            // Field not in tableConfig.columns - hide by default but keep available
            return {
                ...prop,
                defaultVisible: false,
                _order: Number.MAX_SAFE_INTEGER // Put at the end
            };
        }
        // Field is in tableConfig.columns - apply overrides
        matchedOverrides.add(override.field);
        return {
            ...prop,
            ...(override.visibility !== undefined && { visibility: override.visibility }),
            ...(override.width !== undefined && { width: override.width }),
            ...(override.fixed !== undefined && { fixed: override.fixed }),
            ...(override.groupTitle !== undefined && { groupTitle: override.groupTitle }),
            defaultVisible: override.defaultVisible !== false, // Defaults to true
            _order: override._order
        };
    });
    // Add custom columns (JSON paths, computed fields)
    normalizedOverrides.forEach(override => {
        if (!matchedOverrides.has(override.field)) {
            // This is a custom column (JSON path or computed field)
            const isJsonPath = override.field.includes('.');
            // Log info about custom column
            if (isJsonPath) {
                logging_1.DefaultLogger.debug(`Adding JSON path column: "${override.field}"`);
            }
            else {
                logging_1.DefaultLogger.debug(`Adding custom column: "${override.field}" (not in schema, assumes API provides it)`);
            }
            // Add as new custom column
            mergedProperties.push({
                name: override.field, // Use field as name
                dataIndex: override.field, // Frontend will use getNestedValue()
                defaultVisible: override.defaultVisible,
                fieldType: 'text', // Default to text for custom columns
                ...(override.visibility !== undefined && { visibility: override.visibility }),
                ...(override.width !== undefined && { width: override.width }),
                ...(override.fixed !== undefined && { fixed: override.fixed }),
                ...(override.groupTitle !== undefined && { groupTitle: override.groupTitle }),
                _order: override._order
            });
        }
    });
    // Sort by order from columnOverrides (columns not in overrides go to end)
    mergedProperties.sort((a, b) => (a._order ?? Number.MAX_SAFE_INTEGER) - (b._order ?? Number.MAX_SAFE_INTEGER));
    // Remove temporary _order property
    return mergedProperties.map(({ _order, ...rest }) => rest);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy91aS1jb25maWctZ2VuL3RlbXBsYXRlcy91dGlsLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBMGlCQSw0REFnQkM7QUEwTUQsa0VBNERDO0FBb0JELG9EQXlOQztBQXVYRCw0Q0F1TkM7QUFtQ0Qsb0ZBcVJDO0FBY0Qsc0ZBa0JDO0FBaUZELDREQXVGQztBQWtCRCxzREFrQ0M7QUFrRUQsMEVBSUM7QUFhRCwwRUFJQztBQWFELDBFQUlDO0FBZ0RELHNFQXVHQztBQStDRCxvQ0F3QkM7QUE2QkQsb0NBS0M7QUEyQkQsb0RBd0NDO0FBb0dELHNEQWdGQztBQTl3RkQseUNBWXNCO0FBRXRCLHlDQUE4QztBQUU5QywyQ0FBOEM7QUFDOUMsdUNBQThEO0FBa0Q5RDs7R0FFRztBQUNIOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBbUJHO0FBQ0gsTUFBTSx3QkFBd0IsR0FBOEM7SUFDeEUsT0FBTyxFQUFFLElBQUk7SUFDYixRQUFRLEVBQUU7UUFDTiw0Q0FBNEM7UUFDNUMsT0FBTyxFQUFFLENBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsYUFBYSxDQUFFO1FBQ3BELDRDQUE0QztRQUM1QyxNQUFNLEVBQUUsQ0FBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsU0FBUyxDQUFFO1FBQ3hELHdDQUF3QztRQUN4QyxJQUFJLEVBQUUsQ0FBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxZQUFZLEVBQUUsVUFBVSxDQUFFO0tBQzVEO0lBQ0QsUUFBUSxFQUFFO1FBQ04sMENBQTBDO1FBQzFDLFFBQVEsRUFBRSxPQUFPO1FBQ2pCLFFBQVEsRUFBRSxRQUFRLEVBQUUsYUFBYTtRQUNqQyxTQUFTLEVBQUUsV0FBVyxFQUFFLFVBQVU7UUFDbEMsTUFBTSxFQUFFLFdBQVcsRUFBRSxVQUFVO1FBQy9CLE9BQU8sRUFBRSxTQUFTLEVB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LEdBQUcsQ0FBQyxDQUFDLENBQUMsTUFBTSxJQUFJLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUM7SUFFekgsbUNBQW1DO0lBQ25DLE9BQU8sZ0JBQWdCLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxNQUFNLEVBQUUsR0FBRyxJQUFJLEVBQU8sRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDcEUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7XG4gICAgQmFzZUVudGl0eVNlcnZpY2UsXG4gICAgRmllbGRNZXRhZGF0YSxcbiAgICBUSU9TY2hlbWFBdHRyaWJ1dGUsXG4gICAgaXNTZWxlY3RGaWVsZE1ldGFkYXRhLFxuICAgIFNlbGVjdEZpZWxkTWV0YWRhdGEsXG4gICAgRW50aXR5QXR0cmlidXRlLFxuICAgIElSZWxhdGlvbkZpZWxkQ29uZmlnLFxuICAgIFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXAsXG4gICAgRW50aXR5U2NoZW1hLFxuICAgIElGaWx0ZXJTZWdtZW50LFxuICAgIGNyZWF0ZUZpZWxkT3B0aW9uc1xufSBmcm9tIFwiLi4vLi4vZW50aXR5XCI7XG5pbXBvcnQgdHlwZSB7IFJlbGF0aW9uRW50aXR5T3B0aW9uQ29uZmlnLCBGaWVsZE9wdGlvbnNBUElDb25maWcsIElFbnRpdHlQYWdlQWN0aW9uLCBUZW1wbGF0ZSwgRmllbGRPcHRpb24sIElGaWx0ZXJTZWdtZW50R3JvdXAsIElUYWJsZUNvbHVtbnMsIElUYWJsZUNvbHVtbiwgSVRhYmxlQ29sdW1uQ29uZmlnIH0gZnJvbSAnLi4vLi4vZW50aXR5L2Jhc2UtZW50aXR5JztcbmltcG9ydCB7IEZyYW1ld29ya0Vycm9yIH0gZnJvbSBcIi4uLy4uL2Vycm9yc1wiO1xuaW1wb3J0IHR5cGUgeyBJQXBwbGljYXRpb25Db25maWcsIElEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25Db25maWcsIElTZWdtZW50QXV0b0dlbmVyYXRpb25Db25maWcgfSBmcm9tICcuLi8uLi9pbnRlcmZhY2VzL2NvbmZpZyc7XG5pbXBvcnQgeyBEZWZhdWx0TG9nZ2VyIH0gZnJvbSBcIi4uLy4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IHBhc2NhbENhc2UsIHRvSHVtYW5SZWFkYWJsZU5hbWUgfSBmcm9tIFwiLi4vLi4vdXRpbHNcIjtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTTUFSVCBEVVBMSUNBVEVEIEZJRUxEIERFVEVDVElPTiAtIEVOSEFOQ0VEIEFMR09SSVRITVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogRGV0ZWN0aW9uIHJlc3VsdCB3aXRoIHJpY2ggbWV0YWRhdGFcbiAqL1xuaW50ZXJmYWNlIER1cGxpY2F0ZWRGaWVsZERldGVjdGlvblJlc3VsdCB7XG4gICAgLyoqIFByaW1hcnkgZGlzcGxheSBmaWVsZCBkZXRlY3RlZCAoZS5nLiwgJ3RlYW1OYW1lJykgKi9cbiAgICBwcmltYXJ5RmllbGQ/OiBzdHJpbmc7XG5cbiAgICAvKiogR2VuZXJhdGVkIHRlbXBsYXRlIHN0cmluZyAoZS5nLiwgJ3t0ZWFtTmFtZX0nIG9yICd7dGVhbU5hbWV9ICh7dGVhbUNvZGV9KScpICovXG4gICAgdGVtcGxhdGU/OiBzdHJpbmc7XG5cbiAgICAvKiogQWxsIGRldGVjdGVkIGZpZWxkcyBieSBjYXRlZ29yeSAqL1xuICAgIGRldGVjdGVkRmllbGRzOiB7XG4gICAgICAgIC8qKiBEaXNwbGF5IGZpZWxkczogTmFtZSwgVGl0bGUsIExhYmVsICovXG4gICAgICAgIGRpc3BsYXk/OiBzdHJpbmdbXTtcbiAgICAgICAgLyoqIFZpc3VhbCBmaWVsZHM6IExvZ28sIEltYWdlLCBJY29uICovXG4gICAgICAgIHZpc3VhbD86IHN0cmluZ1tdO1xuICAgICAgICAvKiogTWV0YSBmaWVsZHM6IENvZGUsIFNsdWcsIEtleSAqL1xuICAgICAgICBtZXRhPzogc3RyaW5nW107XG4gICAgfTtcblxuICAgIC8qKiBDb25maWRlbmNlIGxldmVsICovXG4gICAgY29uZmlkZW5jZTogJ2hpZ2gnIHwgJ21lZGl1bScgfCAnbG93JztcblxuICAgIC8qKiBEZXRlY3Rpb24gbWV0aG9kIHVzZWQgKi9cbiAgICBtZXRob2Q6IHN0cmluZztcblxuICAgIC8qKiBQYXR0ZXJuIHRoYXQgbWF0Y2hlZCAqL1xuICAgIHBhdHRlcm46IHN0cmluZztcbn1cblxuLyoqXG4gKiBQYXJzZWQgY29tcG9uZW50cyBmcm9tIHJlbGF0aW9uIGZpZWxkIG5hbWVcbiAqL1xuaW50ZXJmYWNlIFBhcnNlZFJlbGF0aW9uRmllbGQge1xuICAgIC8qKiBQcmVmaXggKGUuZy4sICdob21lJywgJ2F3YXknLCAnY29tcGV0aXRvcjEnKSAqL1xuICAgIHByZWZpeD86IHN0cmluZztcbiAgICAvKiogQmFzZSBuYW1lIHdpdGhvdXQgcHJlZml4IGFuZCAnSWQnIHN1ZmZpeCAoZS5nLiwgJ1RlYW0nKSAqL1xuICAgIGJhc2VOYW1lOiBzdHJpbmc7XG4gICAgLyoqIFdoZXRoZXIgZmllbGQgZW5kcyB3aXRoICdJZCcgKi9cbiAgICBoYXNJZFN1ZmZpeDogYm9vbGVhbjtcbiAgICAvKiogT3JpZ2luYWwgZmllbGQgbmFtZSAqL1xuICAgIG9yaWdpbmFsRmllbGQ6IHN0cmluZztcbn1cblxuLyoqXG4gKiBTbWFydCBkZWZhdWx0IGNvbmZpZ3VyYXRpb25cbiAqL1xuLyoqXG4gKiBGcmFtZXdvcmstbGV2ZWwgZGVmYXVsdCBkZXRlY3Rpb24gY29uZmlnLlxuICogQ29udGFpbnMgT05MWSBkb21haW4tYWdub3N0aWMgcGF0dGVybnMgdGhhdCB3b3JrIGFjcm9zcyBhbnkgYXBwbGljYXRpb24uXG4gKiBcbiAqIEFwcGxpY2F0aW9ucyBzaG91bGQgcHJvdmlkZSBkb21haW4tc3BlY2lmaWMgcHJlZml4ZXMgdmlhIHVpQ29uZmlnT3B0aW9ucy5cbiAqIFxuICogQGV4YW1wbGUgQXBwbGljYXRpb24tc3BlY2lmaWMgY29uZmlnIChpbiBiYWNrZW5kIGluZGV4LnRzKTpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IHVpQ29uZmlnT3B0aW9ucyA9IHtcbiAqICAgZHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uOiB7XG4gKiAgICAgcHJlZml4ZXM6IFtcbiAqICAgICAgIC8vIERvbWFpbi1zcGVjaWZpYyBwcmVmaXhlcyBmb3IgeW91ciBhcHBcbiAqICAgICAgICdwbGF5ZXInLCAndGVhbScsICdsZWFndWUnLCAnc2Vhc29uJywgJ3ZlbnVlJywgJ3Nwb3J0JywgIC8vIFNwb3J0cyBhcHBcbiAqICAgICAgIC8vIE9SOiAnY3VzdG9tZXInLCAnb3JkZXInLCAncHJvZHVjdCcsICdpbnZvaWNlJyAgLy8gRS1jb21tZXJjZSBhcHBcbiAqICAgICAgIC8vIE9SOiAnYXV0aG9yJywgJ2Jvb2snLCAncHVibGlzaGVyJywgJ2dlbnJlJyAgLy8gTGlicmFyeSBhcHBcbiAqICAgICBdXG4gKiAgIH1cbiAqIH07XG4gKiBgYGBcbiAqL1xuY29uc3QgREVGQVVMVF9ERVRFQ1RJT05fQ09ORklHOiBSZXF1aXJlZDxJRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uQ29uZmlnPiA9IHtcbiAgICBlbmFibGVkOiB0cnVlLFxuICAgIHN1ZmZpeGVzOiB7XG4gICAgICAgIC8vIEdlbmVyaWMgZGlzcGxheSB0ZXh0IHBhdHRlcm5zICh1bml2ZXJzYWwpXG4gICAgICAgIGRpc3BsYXk6IFsgJ05hbWUnLCAnVGl0bGUnLCAnTGFiZWwnLCAnRGlzcGxheU5hbWUnIF0sXG4gICAgICAgIC8vIEdlbmVyaWMgdmlzdWFsIGFzc2V0IHBhdHRlcm5zICh1bml2ZXJzYWwpXG4gICAgICAgIHZpc3VhbDogWyAnTG9nbycsICdJbWFnZScsICdJY29uJywgJ0F2YXRhcicsICdQaWN0dXJlJyBdLFxuICAgICAgICAvLyBHZW5lcmljIG1ldGFkYXRhIHBhdHRlcm5zICh1bml2ZXJzYWwpXG4gICAgICAgIG1ldGE6IFsgJ0NvZGUnLCAnU2x1ZycsICdLZXknLCAnSWRlbnRpZmllcicsICdSZW1vdGVJZCcgXVxuICAgIH0sXG4gICAgcHJlZml4ZXM6IFtcbiAgICAgICAgLy8gR2VuZXJpYyByZWxhdGlvbmFsIHBhdHRlcm5zICh1bml2ZXJzYWwpXG4gICAgICAgICdwYXJlbnQnLCAnY2hpbGQnLFxuICAgICAgICAnc291cmNlJywgJ3RhcmdldCcsICdkZXN0aW5hdGlvbicsXG4gICAgICAgICdwcmltYXJ5JywgJ3NlY29uZGFyeScsICd0ZXJ0aWFyeScsXG4gICAgICAgICdtYWluJywgJ2FsdGVybmF0ZScsICdmYWxsYmFjaycsXG4gICAgICAgICdvd25lcicsICdjcmVhdG9yJywgJ21vZGlmaWVyJyxcbiAgICAgICAgJ2ZpcnN0JywgJ3NlY29uZCcsICd0aGlyZCcsICdsYXN0JyxcbiAgICAgICAgJ3ByZXZpb3VzJywgJ25leHQnLCAnY3VycmVudCcsXG4gICAgICAgICdvbGQnLCAnbmV3JyxcbiAgICAgICAgJ29yaWdpbmFsJywgJ2NvcHknLCAnZHJhZnQnLFxuXG4gICAgICAgIC8vIEdlbmVyaWMgZGlyZWN0aW9uYWwgcGF0dGVybnMgKHVuaXZlcnNhbClcbiAgICAgICAgJ2hvbWUnLCAnYXdheScsXG4gICAgICAgICdsZWZ0JywgJ3JpZ2h0JyxcbiAgICAgICAgJ3RvcCcsICdib3R0b20nLFxuICAgICAgICAnaW5uZXInLCAnb3V0ZXInLFxuXG4gICAgICAgIC8vIEdlbmVyaWMgY29tcGV0aXRpdmUgcGF0dGVybnMgKHVuaXZlcnNhbClcbiAgICAgICAgJ3dpbm5lcicsICdsb3NlcicsXG4gICAgICAgICdjb21wZXRpdG9yJywgJ29wcG9uZW50J1xuXG4gICAgICAgIC8vIE5PVEU6IERvbWFpbi1zcGVjaWZpYyBwcmVmaXhlcyAocGxheWVyLCB0ZWFtLCBjdXN0b21lciwgb3JkZXIsIGV0Yy4pXG4gICAgICAgIC8vIHNob3VsZCBiZSBwcm92aWRlZCB2aWEgdWlDb25maWdPcHRpb25zIGluIHlvdXIgYXBwbGljYXRpb24ncyBiYWNrZW5kXG4gICAgXSxcbiAgICB0ZW1wbGF0ZVN0eWxlOiAnc2ltcGxlJyxcbiAgICBjb25maWRlbmNlVGhyZXNob2xkOiAnbWVkaXVtJyxcbiAgICBkZWJ1ZzogZmFsc2Vcbn07XG5cbi8qKlxuICogTWVyZ2UgY29uZmlndXJhdGlvbnMgd2l0aCBwcmlvcml0eTogaGludHMgPiBlbnRpdHkgPiBnbG9iYWwgPiBkZWZhdWx0c1xuICovXG5mdW5jdGlvbiBtZXJnZURldGVjdGlvbkNvbmZpZ3MoXG4gICAgZ2xvYmFsQ29uZmlnPzogSUR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbkNvbmZpZyxcbiAgICBlbnRpdHlDb25maWc/OiBJRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uQ29uZmlnLFxuICAgIHJlbGF0aW9uSGludHM/OiB7XG4gICAgICAgIHByZWZlcnJlZEZpZWxkcz86IHN0cmluZ1tdO1xuICAgICAgICBleGNsdWRlRmllbGRzPzogc3RyaW5nW107XG4gICAgICAgIHRlbXBsYXRlU3R5bGU/OiAnc2ltcGxlJyB8ICdjb21wb3NpdGUnO1xuICAgIH1cbik6IFJlcXVpcmVkPElEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25Db25maWc+ICYgeyBwcmVmZXJyZWRGaWVsZHM/OiBzdHJpbmdbXTsgZXhjbHVkZUZpZWxkcz86IHN0cmluZ1tdIH0ge1xuICAgIC8vIFN0YXJ0IHdpdGggZGVmYXVsdHNcbiAgICBsZXQgbWVyZ2VkID0geyAuLi5ERUZBVUxUX0RFVEVDVElPTl9DT05GSUcgfTtcblxuICAgIC8vIEFwcGx5IGdsb2JhbCBjb25maWdcbiAgICBpZiAoZ2xvYmFsQ29uZmlnKSB7XG4gICAgICAgIG1lcmdlZCA9IHtcbiAgICAgICAgICAgIC4uLm1lcmdlZCxcbiAgICAgICAgICAgIC4uLmdsb2JhbENvbmZpZyxcbiAgICAgICAgICAgIHN1ZmZpeGVzOiB7IC4uLm1lcmdlZC5zdWZmaXhlcywgLi4uZ2xvYmFsQ29uZmlnLnN1ZmZpeGVzIH0sXG4gICAgICAgICAgICBwcmVmaXhlczogZ2xvYmFsQ29uZmlnLnByZWZpeGVzIHx8IG1lcmdlZC5wcmVmaXhlc1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vIEFwcGx5IGVudGl0eSBjb25maWcgKGhpZ2hlciBwcmlvcml0eSlcbiAgICBpZiAoZW50aXR5Q29uZmlnKSB7XG4gICAgICAgIG1lcmdlZCA9IHtcbiAgICAgICAgICAgIC4uLm1lcmdlZCxcbiAgICAgICAgICAgIC4uLmVudGl0eUNvbmZpZyxcbiAgICAgICAgICAgIHN1ZmZpeGVzOiB7IC4uLm1lcmdlZC5zdWZmaXhlcywgLi4uZW50aXR5Q29uZmlnLnN1ZmZpeGVzIH0sXG4gICAgICAgICAgICBwcmVmaXhlczogZW50aXR5Q29uZmlnLnByZWZpeGVzIHx8IG1lcmdlZC5wcmVmaXhlc1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vIEFwcGx5IHJlbGF0aW9uIGhpbnRzIChoaWdoZXN0IHByaW9yaXR5KVxuICAgIGNvbnN0IHJlc3VsdDogYW55ID0geyAuLi5tZXJnZWQgfTtcbiAgICBpZiAocmVsYXRpb25IaW50cykge1xuICAgICAgICBpZiAocmVsYXRpb25IaW50cy50ZW1wbGF0ZVN0eWxlKSB7XG4gICAgICAgICAgICByZXN1bHQudGVtcGxhdGVTdHlsZSA9IHJlbGF0aW9uSGludHMudGVtcGxhdGVTdHlsZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocmVsYXRpb25IaW50cy5wcmVmZXJyZWRGaWVsZHMpIHtcbiAgICAgICAgICAgIHJlc3VsdC5wcmVmZXJyZWRGaWVsZHMgPSByZWxhdGlvbkhpbnRzLnByZWZlcnJlZEZpZWxkcztcbiAgICAgICAgfVxuICAgICAgICBpZiAocmVsYXRpb25IaW50cy5leGNsdWRlRmllbGRzKSB7XG4gICAgICAgICAgICByZXN1bHQuZXhjbHVkZUZpZWxkcyA9IHJlbGF0aW9uSGludHMuZXhjbHVkZUZpZWxkcztcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbi8qKlxuICogUGFyc2UgcmVsYXRpb24gZmllbGQgdG8gZXh0cmFjdCBwcmVmaXggYW5kIGJhc2UgbmFtZS5cbiAqIFxuICogRXhhbXBsZXM6XG4gKiAtICd0ZWFtSWQnIOKGkiB7IGJhc2VOYW1lOiAnVGVhbScsIGhhc0lkU3VmZml4OiB0cnVlIH1cbiAqIC0gJ2hvbWVUZWFtSWQnIOKGkiB7IHByZWZpeDogJ2hvbWUnLCBiYXNlTmFtZTogJ1RlYW0nLCBoYXNJZFN1ZmZpeDogdHJ1ZSB9XG4gKiAtICdjb21wZXRpdG9yMVRlYW1JZCcg4oaSIHsgcHJlZml4OiAnY29tcGV0aXRvcjEnLCBiYXNlTmFtZTogJ1RlYW0nLCBoYXNJZFN1ZmZpeDogdHJ1ZSB9XG4gKiAtICdzcG9ydCcg4oaSIHsgYmFzZU5hbWU6ICdzcG9ydCcsIGhhc0lkU3VmZml4OiBmYWxzZSB9XG4gKi9cbmZ1bmN0aW9uIHBhcnNlUmVsYXRpb25GaWVsZChcbiAgICBmaWVsZElkOiBzdHJpbmcsXG4gICAgcHJlZml4ZXM6IHN0cmluZ1tdXG4pOiBQYXJzZWRSZWxhdGlvbkZpZWxkIHtcbiAgICAvLyBCdWlsZCByZWdleCBmb3IgcHJlZml4IGRldGVjdGlvbjogXihwcmVmaXgxfHByZWZpeDJ8Li4uKShcXFxcZCopKC4rKSRcbiAgICAvLyBVc2UgY2FzZS1pbnNlbnNpdGl2ZSBtYXRjaGluZ1xuICAgIGNvbnN0IHByZWZpeFBhdHRlcm4gPSBuZXcgUmVnRXhwKFxuICAgICAgICBgXigke3ByZWZpeGVzLmpvaW4oJ3wnKX0pKFxcXFxkKikoLispJGAsXG4gICAgICAgICdpJ1xuICAgICk7XG5cbiAgICBjb25zdCBtYXRjaCA9IGZpZWxkSWQubWF0Y2gocHJlZml4UGF0dGVybik7XG5cbiAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgY29uc3QgWyAsIHByZWZpeCwgbnVtLCByZXN0IF0gPSBtYXRjaDtcbiAgICAgICAgY29uc3QgaGFzSWRTdWZmaXggPSByZXN0LnRvTG93ZXJDYXNlKCkuZW5kc1dpdGgoJ2lkJyk7XG4gICAgICAgIGNvbnN0IGJhc2VOYW1lID0gaGFzSWRTdWZmaXhcbiAgICAgICAgICAgID8gcmVzdC5zdWJzdHJpbmcoMCwgcmVzdC5sZW5ndGggLSAyKVxuICAgICAgICAgICAgOiByZXN0O1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBwcmVmaXg6IHByZWZpeCArIG51bSwgIC8vICdob21lJyBvciAnY29tcGV0aXRvcjEnXG4gICAgICAgICAgICBiYXNlTmFtZSxcbiAgICAgICAgICAgIGhhc0lkU3VmZml4LFxuICAgICAgICAgICAgb3JpZ2luYWxGaWVsZDogZmllbGRJZFxuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vIE5vIHByZWZpeCBkZXRlY3RlZFxuICAgIGNvbnN0IGhhc0lkU3VmZml4ID0gZmllbGRJZC50b0xvd2VyQ2FzZSgpLmVuZHNXaXRoKCdpZCcpO1xuICAgIGNvbnN0IGJhc2VOYW1lID0gaGFzSWRTdWZmaXhcbiAgICAgICAgPyBmaWVsZElkLnN1YnN0cmluZygwLCBmaWVsZElkLmxlbmd0aCAtIDIpXG4gICAgICAgIDogZmllbGRJZDtcblxuICAgIHJldHVybiB7XG4gICAgICAgIGJhc2VOYW1lLFxuICAgICAgICBoYXNJZFN1ZmZpeCxcbiAgICAgICAgb3JpZ2luYWxGaWVsZDogZmllbGRJZFxuICAgIH07XG59XG5cbi8qKlxuICogR2VuZXJhdGUgc2VhcmNoIHBhdHRlcm5zIGZvciBjYW5kaWRhdGUgZmllbGQgbmFtZXMuXG4gKiBcbiAqIFByaW9yaXR5OlxuICogMS4gUHJlZmVycmVkIGZpZWxkcyAoZnJvbSBoaW50cylcbiAqIDIuIEV4YWN0IHByZWZpeCBtYXRjaDoge3ByZWZpeH17YmFzZU5hbWV9e3N1ZmZpeH1cbiAqIDMuIEVudGl0eSBuYW1lIG1hdGNoOiB7ZW50aXR5TmFtZX17c3VmZml4fVxuICogNC4gQmFzZSBuYW1lIG1hdGNoOiB7YmFzZU5hbWV9e3N1ZmZpeH1cbiAqL1xuZnVuY3Rpb24gZ2VuZXJhdGVTZWFyY2hQYXR0ZXJucyhcbiAgICBwYXJzZWQ6IFBhcnNlZFJlbGF0aW9uRmllbGQsXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIHN1ZmZpeGVzOiBzdHJpbmdbXSxcbiAgICBwcmVmZXJyZWRGaWVsZHM/OiBzdHJpbmdbXVxuKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IHBhdHRlcm5zOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IGVudGl0eU5hbWVMb3dlciA9IGVudGl0eU5hbWUudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBiYXNlTmFtZUxvd2VyID0gcGFyc2VkLmJhc2VOYW1lLnRvTG93ZXJDYXNlKCk7XG5cbiAgICAvLyBQcmlvcml0eSAxOiBQcmVmZXJyZWQgZmllbGRzIChleGFjdCBtYXRjaClcbiAgICBpZiAocHJlZmVycmVkRmllbGRzICYmIHByZWZlcnJlZEZpZWxkcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goLi4ucHJlZmVycmVkRmllbGRzKTtcbiAgICB9XG5cbiAgICAvLyBQcmlvcml0eSAyOiBXaXRoIHByZWZpeCAoZS5nLiwgaG9tZVRlYW1OYW1lLCBhd2F5VGVhbU5hbWUpXG4gICAgaWYgKHBhcnNlZC5wcmVmaXgpIHtcbiAgICAgICAgY29uc3QgcHJlZml4TG93ZXIgPSBwYXJzZWQucHJlZml4LnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIGZvciAoY29uc3Qgc3VmZml4IG9mIHN1ZmZpeGVzKSB7XG4gICAgICAgICAgICBwYXR0ZXJucy5wdXNoKGAke3ByZWZpeExvd2VyfSR7YmFzZU5hbWVMb3dlcn0ke3N1ZmZpeC50b0xvd2VyQ2FzZSgpfWApO1xuICAgICAgICAgICAgcGF0dGVybnMucHVzaChgJHtwcmVmaXhMb3dlcn0ke2VudGl0eU5hbWVMb3dlcn0ke3N1ZmZpeC50b0xvd2VyQ2FzZSgpfWApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gUHJpb3JpdHkgMzogRW50aXR5IG5hbWUgKGUuZy4sIHRlYW1OYW1lIGZvciByZWxhdGlvbiB0byAndGVhbScpXG4gICAgZm9yIChjb25zdCBzdWZmaXggb2Ygc3VmZml4ZXMpIHtcbiAgICAgICAgcGF0dGVybnMucHVzaChgJHtlbnRpdHlOYW1lTG93ZXJ9JHtzdWZmaXgudG9Mb3dlckNhc2UoKX1gKTtcbiAgICB9XG5cbiAgICAvLyBQcmlvcml0eSA0OiBCYXNlIG5hbWUgKGUuZy4sIHRlYW1OYW1lIGZvciAndGVhbUlkJylcbiAgICBmb3IgKGNvbnN0IHN1ZmZpeCBvZiBzdWZmaXhlcykge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGAke2Jhc2VOYW1lTG93ZXJ9JHtzdWZmaXgudG9Mb3dlckNhc2UoKX1gKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcGF0dGVybnM7XG59XG5cbi8qKlxuICogU2VhcmNoIGZvciBmaWVsZHMgbWF0Y2hpbmcgcGF0dGVybnMsIGV4Y2x1ZGluZyBzcGVjaWZpZWQgZmllbGRzLlxuICovXG5mdW5jdGlvbiBzZWFyY2hGaWVsZHNCeVBhdHRlcm5zKFxuICAgIGFsbFByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLFxuICAgIHBhdHRlcm5zOiBzdHJpbmdbXSxcbiAgICBleGNsdWRlRmllbGRzPzogc3RyaW5nW11cbik6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBleGNsdWRlU2V0ID0gbmV3IFNldChleGNsdWRlRmllbGRzPy5tYXAoZiA9PiBmLnRvTG93ZXJDYXNlKCkpIHx8IFtdKTtcbiAgICBjb25zdCBmb3VuZDogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCBzZWVuTG93ZXIgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICAgIGZvciAoY29uc3QgcGF0dGVybiBvZiBwYXR0ZXJucykge1xuICAgICAgICBjb25zdCBwYXR0ZXJuTG93ZXIgPSBwYXR0ZXJuLnRvTG93ZXJDYXNlKCk7XG5cbiAgICAgICAgLy8gU2tpcCBpZiBhbHJlYWR5IGZvdW5kIG9yIGV4Y2x1ZGVkXG4gICAgICAgIGlmIChzZWVuTG93ZXIuaGFzKHBhdHRlcm5Mb3dlcikgfHwgZXhjbHVkZVNldC5oYXMocGF0dGVybkxvd2VyKSkge1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGaW5kIG1hdGNoaW5nIGZpZWxkIChjYXNlLWluc2Vuc2l0aXZlKVxuICAgICAgICBjb25zdCBtYXRjaCA9IGFsbFByb3BlcnRpZXMuZmluZChwID0+XG4gICAgICAgICAgICBwLmlkPy50b0xvd2VyQ2FzZSgpID09PSBwYXR0ZXJuTG93ZXIgJiZcbiAgICAgICAgICAgICFleGNsdWRlU2V0LmhhcyhwLmlkLnRvTG93ZXJDYXNlKCkpXG4gICAgICAgICk7XG5cbiAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgICBmb3VuZC5wdXNoKG1hdGNoLmlkKTtcbiAgICAgICAgICAgIHNlZW5Mb3dlci5hZGQobWF0Y2guaWQudG9Mb3dlckNhc2UoKSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZm91bmQ7XG59XG5cbi8qKlxuICogQ2FsY3VsYXRlIGNvbmZpZGVuY2UgYmFzZWQgb24gZGV0ZWN0aW9uIG1ldGhvZCBhbmQgcGF0dGVyblxuICovXG5mdW5jdGlvbiBjYWxjdWxhdGVDb25maWRlbmNlKFxuICAgIGRldGVjdGVkRmllbGQ6IHN0cmluZyxcbiAgICBwYXJzZWQ6IFBhcnNlZFJlbGF0aW9uRmllbGQsXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIG1ldGhvZDogJ3ByZWZlcnJlZCcgfCAncHJlZml4JyB8ICdlbnRpdHknIHwgJ2Jhc2UnXG4pOiAnaGlnaCcgfCAnbWVkaXVtJyB8ICdsb3cnIHtcbiAgICAvLyBQcmVmZXJyZWQgZmllbGRzID0gaGlnaCBjb25maWRlbmNlIChkZXZlbG9wZXIgZXhwbGljaXRseSBzcGVjaWZpZWQpXG4gICAgaWYgKG1ldGhvZCA9PT0gJ3ByZWZlcnJlZCcpIHJldHVybiAnaGlnaCc7XG5cbiAgICBjb25zdCBmaWVsZExvd2VyID0gZGV0ZWN0ZWRGaWVsZC50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IGVudGl0eUxvd2VyID0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IGJhc2VMb3dlciA9IHBhcnNlZC5iYXNlTmFtZS50b0xvd2VyQ2FzZSgpO1xuXG4gICAgLy8gRXhhY3QgcHJlZml4ICsgZW50aXR5L2Jhc2UgbWF0Y2ggPSBoaWdoXG4gICAgaWYgKG1ldGhvZCA9PT0gJ3ByZWZpeCcpIHtcbiAgICAgICAgaWYgKGZpZWxkTG93ZXIuaW5jbHVkZXMoZW50aXR5TG93ZXIpIHx8IGZpZWxkTG93ZXIuaW5jbHVkZXMoYmFzZUxvd2VyKSkge1xuICAgICAgICAgICAgcmV0dXJuICdoaWdoJztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gJ21lZGl1bSc7XG4gICAgfVxuXG4gICAgLy8gRW50aXR5IG5hbWUgbWF0Y2ggPSBoaWdoXG4gICAgaWYgKG1ldGhvZCA9PT0gJ2VudGl0eScpIHJldHVybiAnaGlnaCc7XG5cbiAgICAvLyBCYXNlIG5hbWUgbWF0Y2ggPSBtZWRpdW0gKGNvdWxkIGJlIGNvaW5jaWRlbnRhbClcbiAgICBpZiAobWV0aG9kID09PSAnYmFzZScpIHJldHVybiAnbWVkaXVtJztcblxuICAgIHJldHVybiAnbG93Jztcbn1cblxuLyoqXG4gKiBHZW5lcmF0ZSB0ZW1wbGF0ZSBzdHJpbmcgZnJvbSBkZXRlY3RlZCBmaWVsZHMuXG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlVGVtcGxhdGUoXG4gICAgcHJpbWFyeUZpZWxkOiBzdHJpbmcsXG4gICAgYWxsRGV0ZWN0ZWRGaWVsZHM6IER1cGxpY2F0ZWRGaWVsZERldGVjdGlvblJlc3VsdFsgJ2RldGVjdGVkRmllbGRzJyBdLFxuICAgIHRlbXBsYXRlU3R5bGU6ICdzaW1wbGUnIHwgJ2NvbXBvc2l0ZSdcbik6IHN0cmluZyB7XG4gICAgaWYgKHRlbXBsYXRlU3R5bGUgPT09ICdzaW1wbGUnKSB7XG4gICAgICAgIHJldHVybiBgeyR7cHJpbWFyeUZpZWxkfX1gO1xuICAgIH1cblxuICAgIC8vIENvbXBvc2l0ZTogdHJ5IHRvIGluY2x1ZGUgbWV0YSBmaWVsZCAoY29kZS9zbHVnKSBpZiBhdmFpbGFibGVcbiAgICBpZiAodGVtcGxhdGVTdHlsZSA9PT0gJ2NvbXBvc2l0ZScgJiYgYWxsRGV0ZWN0ZWRGaWVsZHMubWV0YSAmJiBhbGxEZXRlY3RlZEZpZWxkcy5tZXRhLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgbWV0YUZpZWxkID0gYWxsRGV0ZWN0ZWRGaWVsZHMubWV0YVsgMCBdO1xuICAgICAgICByZXR1cm4gYHske3ByaW1hcnlGaWVsZH19ICh7JHttZXRhRmllbGR9fSlgO1xuICAgIH1cblxuICAgIC8vIEZhbGxiYWNrIHRvIHNpbXBsZSBpZiBubyBtZXRhIGZpZWxkXG4gICAgcmV0dXJuIGB7JHtwcmltYXJ5RmllbGR9fWA7XG59XG5cbi8qKlxuICogRW5oYW5jZWQgc21hcnQgZHVwbGljYXRlZCBmaWVsZCBkZXRlY3Rpb24uXG4gKiBcbiAqIERldGVjdHMgZmllbGRzIGxpa2UgJ3RlYW1OYW1lJyBmb3IgJ3RlYW1JZCcgcmVsYXRpb25zIHdpdGggc3VwcG9ydCBmb3I6XG4gKiAtIFByZWZpeGVzIChob21lLCBhd2F5LCBjb21wZXRpdG9yMSwgZXRjLilcbiAqIC0gTXVsdGlwbGUgc3VmZml4ZXMgKE5hbWUsIFRpdGxlLCBMYWJlbCwgTG9nbywgQ29kZSwgZXRjLilcbiAqIC0gUHJlZmVycmVkIGZpZWxkcyBhbmQgZXhjbHVzaW9uc1xuICogLSBDb25maWRlbmNlIHNjb3JpbmdcbiAqIC0gQ29tcG9zaXRlIHRlbXBsYXRlc1xuICogXG4gKiBAcGFyYW0gYWxsUHJvcGVydGllcyAtIEFsbCBwcm9wZXJ0aWVzIGluIHRoZSBwYXJlbnQgZW50aXR5XG4gKiBAcGFyYW0gcmVsYXRpb25GaWVsZElkIC0gVGhlIHJlbGF0aW9uIGZpZWxkIG5hbWUgKGUuZy4sICd0ZWFtSWQnLCAnaG9tZVRlYW1JZCcpXG4gKiBAcGFyYW0gcmVsYXRlZEVudGl0eU5hbWUgLSBSZWxhdGVkIGVudGl0eSBuYW1lIChlLmcuLCAndGVhbScpXG4gKiBAcGFyYW0gZ2xvYmFsQ29uZmlnIC0gR2xvYmFsIGRldGVjdGlvbiBjb25maWd1cmF0aW9uXG4gKiBAcGFyYW0gZW50aXR5Q29uZmlnIC0gRW50aXR5LWxldmVsIGRldGVjdGlvbiBjb25maWd1cmF0aW9uXG4gKiBAcGFyYW0gcmVsYXRpb25IaW50cyAtIFJlbGF0aW9uLXNwZWNpZmljIGhpbnRzXG4gKiBAcmV0dXJucyBEZXRlY3Rpb24gcmVzdWx0IHdpdGggdGVtcGxhdGUgYW5kIG1ldGFkYXRhXG4gKi9cbmZ1bmN0aW9uIGRldGVjdER1cGxpY2F0ZWRSZWxhdGlvbkZpZWxkcyhcbiAgICBhbGxQcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSxcbiAgICByZWxhdGlvbkZpZWxkSWQ6IHN0cmluZyxcbiAgICByZWxhdGVkRW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGdsb2JhbENvbmZpZz86IElEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25Db25maWcsXG4gICAgZW50aXR5Q29uZmlnPzogSUR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbkNvbmZpZyxcbiAgICByZWxhdGlvbkhpbnRzPzoge1xuICAgICAgICBwcmVmZXJyZWRGaWVsZHM/OiBzdHJpbmdbXTtcbiAgICAgICAgZXhjbHVkZUZpZWxkcz86IHN0cmluZ1tdO1xuICAgICAgICB0ZW1wbGF0ZVN0eWxlPzogJ3NpbXBsZScgfCAnY29tcG9zaXRlJztcbiAgICB9XG4pOiBEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25SZXN1bHQgfCB1bmRlZmluZWQge1xuICAgIC8vIE1lcmdlIGNvbmZpZ3VyYXRpb25zXG4gICAgY29uc3QgY29uZmlnID0gbWVyZ2VEZXRlY3Rpb25Db25maWdzKGdsb2JhbENvbmZpZywgZW50aXR5Q29uZmlnLCByZWxhdGlvbkhpbnRzKTtcblxuICAgIC8vIENoZWNrIGlmIGRldGVjdGlvbiBpcyBlbmFibGVkXG4gICAgaWYgKCFjb25maWcuZW5hYmxlZCkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8vIFBhcnNlIHJlbGF0aW9uIGZpZWxkXG4gICAgY29uc3QgcGFyc2VkID0gcGFyc2VSZWxhdGlvbkZpZWxkKHJlbGF0aW9uRmllbGRJZCwgY29uZmlnLnByZWZpeGVzKTtcblxuICAgIC8vIFNlYXJjaCBmb3IgZGlzcGxheSBmaWVsZHMgKE5hbWUsIFRpdGxlLCBMYWJlbClcbiAgICBjb25zdCBkaXNwbGF5UGF0dGVybnMgPSBnZW5lcmF0ZVNlYXJjaFBhdHRlcm5zKFxuICAgICAgICBwYXJzZWQsXG4gICAgICAgIHJlbGF0ZWRFbnRpdHlOYW1lLFxuICAgICAgICBjb25maWcuc3VmZml4ZXM/LmRpc3BsYXkgfHwgW10sXG4gICAgICAgIGNvbmZpZy5wcmVmZXJyZWRGaWVsZHNcbiAgICApO1xuICAgIGNvbnN0IGRpc3BsYXlGaWVsZHMgPSBzZWFyY2hGaWVsZHNCeVBhdHRlcm5zKGFsbFByb3BlcnRpZXMsIGRpc3BsYXlQYXR0ZXJucywgY29uZmlnLmV4Y2x1ZGVGaWVsZHMpO1xuXG4gICAgLy8gU2VhcmNoIGZvciB2aXN1YWwgZmllbGRzIChMb2dvLCBJbWFnZSwgSWNvbilcbiAgICBjb25zdCB2aXN1YWxQYXR0ZXJucyA9IGdlbmVyYXRlU2VhcmNoUGF0dGVybnMoXG4gICAgICAgIHBhcnNlZCxcbiAgICAgICAgcmVsYXRlZEVudGl0eU5hbWUsXG4gICAgICAgIGNvbmZpZy5zdWZmaXhlcz8udmlzdWFsIHx8IFtdXG4gICAgKTtcbiAgICBjb25zdCB2aXN1YWxGaWVsZHMgPSBzZWFyY2hGaWVsZHNCeVBhdHRlcm5zKGFsbFByb3BlcnRpZXMsIHZpc3VhbFBhdHRlcm5zLCBjb25maWcuZXhjbHVkZUZpZWxkcyk7XG5cbiAgICAvLyBTZWFyY2ggZm9yIG1ldGEgZmllbGRzIChDb2RlLCBTbHVnLCBLZXkpXG4gICAgY29uc3QgbWV0YVBhdHRlcm5zID0gZ2VuZXJhdGVTZWFyY2hQYXR0ZXJucyhcbiAgICAgICAgcGFyc2VkLFxuICAgICAgICByZWxhdGVkRW50aXR5TmFtZSxcbiAgICAgICAgY29uZmlnLnN1ZmZpeGVzPy5tZXRhIHx8IFtdXG4gICAgKTtcbiAgICBjb25zdCBtZXRhRmllbGRzID0gc2VhcmNoRmllbGRzQnlQYXR0ZXJucyhhbGxQcm9wZXJ0aWVzLCBtZXRhUGF0dGVybnMsIGNvbmZpZy5leGNsdWRlRmllbGRzKTtcblxuICAgIC8vIE5vIGZpZWxkcyBkZXRlY3RlZFxuICAgIGlmIChkaXNwbGF5RmllbGRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8vIERldGVybWluZSBkZXRlY3Rpb24gbWV0aG9kXG4gICAgY29uc3QgcHJpbWFyeUZpZWxkID0gZGlzcGxheUZpZWxkc1sgMCBdO1xuICAgIGxldCBtZXRob2Q6ICdwcmVmZXJyZWQnIHwgJ3ByZWZpeCcgfCAnZW50aXR5JyB8ICdiYXNlJyA9ICdiYXNlJztcbiAgICBsZXQgcGF0dGVybiA9ICd1bmtub3duJztcblxuICAgIGlmIChjb25maWcucHJlZmVycmVkRmllbGRzICYmIGNvbmZpZy5wcmVmZXJyZWRGaWVsZHMuaW5jbHVkZXMocHJpbWFyeUZpZWxkKSkge1xuICAgICAgICBtZXRob2QgPSAncHJlZmVycmVkJztcbiAgICAgICAgcGF0dGVybiA9ICdwcmVmZXJyZWRfZmllbGQnO1xuICAgIH0gZWxzZSBpZiAocGFyc2VkLnByZWZpeCAmJiBwcmltYXJ5RmllbGQudG9Mb3dlckNhc2UoKS5zdGFydHNXaXRoKHBhcnNlZC5wcmVmaXgudG9Mb3dlckNhc2UoKSkpIHtcbiAgICAgICAgbWV0aG9kID0gJ3ByZWZpeCc7XG4gICAgICAgIHBhdHRlcm4gPSBgJHtwYXJzZWQucHJlZml4fXtlbnRpdHl9e3N1ZmZpeH1gO1xuICAgIH0gZWxzZSBpZiAocHJpbWFyeUZpZWxkLnRvTG93ZXJDYXNlKCkuc3RhcnRzV2l0aChyZWxhdGVkRW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpKSkge1xuICAgICAgICBtZXRob2QgPSAnZW50aXR5JztcbiAgICAgICAgcGF0dGVybiA9IGB7ZW50aXR5fXtzdWZmaXh9YDtcbiAgICB9IGVsc2Uge1xuICAgICAgICBtZXRob2QgPSAnYmFzZSc7XG4gICAgICAgIHBhdHRlcm4gPSBge2Jhc2V9e3N1ZmZpeH1gO1xuICAgIH1cblxuICAgIC8vIENhbGN1bGF0ZSBjb25maWRlbmNlXG4gICAgY29uc3QgY29uZmlkZW5jZSA9IGNhbGN1bGF0ZUNvbmZpZGVuY2UocHJpbWFyeUZpZWxkLCBwYXJzZWQsIHJlbGF0ZWRFbnRpdHlOYW1lLCBtZXRob2QpO1xuXG4gICAgLy8gQ2hlY2sgY29uZmlkZW5jZSB0aHJlc2hvbGRcbiAgICBjb25zdCB0aHJlc2hvbGRPcmRlciA9IHsgbG93OiAwLCBtZWRpdW06IDEsIGhpZ2g6IDIgfTtcbiAgICBpZiAodGhyZXNob2xkT3JkZXJbIGNvbmZpZGVuY2UgXSA8IHRocmVzaG9sZE9yZGVyWyBjb25maWcuY29uZmlkZW5jZVRocmVzaG9sZCBdKSB7XG4gICAgICAgIC8vIENvbmZpZGVuY2UgdG9vIGxvd1xuICAgICAgICBpZiAoY29uZmlnLmRlYnVnKSB7XG4gICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25dIFNraXBwaW5nICR7cmVsYXRpb25GaWVsZElkfTogY29uZmlkZW5jZSAke2NvbmZpZGVuY2V9IDwgdGhyZXNob2xkICR7Y29uZmlnLmNvbmZpZGVuY2VUaHJlc2hvbGR9YCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyBHZW5lcmF0ZSB0ZW1wbGF0ZVxuICAgIGNvbnN0IHRlbXBsYXRlID0gZ2VuZXJhdGVUZW1wbGF0ZShcbiAgICAgICAgcHJpbWFyeUZpZWxkLFxuICAgICAgICB7IGRpc3BsYXk6IGRpc3BsYXlGaWVsZHMsIHZpc3VhbDogdmlzdWFsRmllbGRzLCBtZXRhOiBtZXRhRmllbGRzIH0sXG4gICAgICAgIGNvbmZpZy50ZW1wbGF0ZVN0eWxlXG4gICAgKTtcblxuICAgIC8vIERlYnVnIGxvZ2dpbmdcbiAgICBpZiAoY29uZmlnLmRlYnVnKSB7XG4gICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW0R1cGxpY2F0ZWRGaWVsZERldGVjdGlvbl0gJHtyZWxhdGlvbkZpZWxkSWR9IOKGkiAke3RlbXBsYXRlfSAoY29uZmlkZW5jZTogJHtjb25maWRlbmNlfSwgbWV0aG9kOiAke21ldGhvZH0pYCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgcHJpbWFyeUZpZWxkLFxuICAgICAgICB0ZW1wbGF0ZSxcbiAgICAgICAgZGV0ZWN0ZWRGaWVsZHM6IHtcbiAgICAgICAgICAgIGRpc3BsYXk6IGRpc3BsYXlGaWVsZHMsXG4gICAgICAgICAgICB2aXN1YWw6IHZpc3VhbEZpZWxkcy5sZW5ndGggPiAwID8gdmlzdWFsRmllbGRzIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgbWV0YTogbWV0YUZpZWxkcy5sZW5ndGggPiAwID8gbWV0YUZpZWxkcyA6IHVuZGVmaW5lZFxuICAgICAgICB9LFxuICAgICAgICBjb25maWRlbmNlLFxuICAgICAgICBtZXRob2QsXG4gICAgICAgIHBhdHRlcm5cbiAgICB9O1xufVxuXG4vKipcbiAqIExlZ2FjeSB3cmFwcGVyIGZ1bmN0aW9uIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5LlxuICogXG4gKiBAZGVwcmVjYXRlZCBVc2UgZGV0ZWN0RHVwbGljYXRlZFJlbGF0aW9uRmllbGRzKCkgZm9yIHJpY2hlciByZXN1bHRzXG4gKi9cbmZ1bmN0aW9uIGRldGVjdER1cGxpY2F0ZWRSZWxhdGlvbkZpZWxkVGVtcGxhdGUoXG4gICAgYWxsUHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sXG4gICAgcmVsYXRpb25GaWVsZElkOiBzdHJpbmcsXG4gICAgcmVsYXRlZEVudGl0eU5hbWU6IHN0cmluZ1xuKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCByZXN1bHQgPSBkZXRlY3REdXBsaWNhdGVkUmVsYXRpb25GaWVsZHMoXG4gICAgICAgIGFsbFByb3BlcnRpZXMsXG4gICAgICAgIHJlbGF0aW9uRmllbGRJZCxcbiAgICAgICAgcmVsYXRlZEVudGl0eU5hbWVcbiAgICApO1xuICAgIHJldHVybiByZXN1bHQ/LnRlbXBsYXRlO1xufVxuXG4vKipcbiAqIEdlbmVyYXRlIHNtYXJ0IGZhbGxiYWNrIGNvbmZpZ3VyYXRpb24gZm9yIHJlbGF0aW9uIGRpc3BsYXkgd2hlbiBvbmx5IElEIGlzIGF2YWlsYWJsZS5cbiAqIFVzZXMgZW50aXR5IG1ldGFkYXRhIChpY29uLCBlbnRpdHlOYW1lUGx1cmFsKSB0byBjcmVhdGUgdXNlci1mcmllbmRseSBmYWxsYmFjayB0ZXh0LlxuICogXG4gKiBAcGFyYW0gZW50aXR5TmFtZSAtIFJlbGF0ZWQgZW50aXR5IG5hbWUgKGUuZy4sICd0ZWFtJylcbiAqIEBwYXJhbSBpZEZpZWxkIC0gSUQgZmllbGQgbmFtZSAoZS5nLiwgJ3RlYW1JZCcpXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIHRvIGdldCBtZXRhZGF0YSBmcm9tXG4gKiBAcmV0dXJucyBGYWxsYmFjayBjb25maWd1cmF0aW9uIHdpdGggdGVtcGxhdGUsIGxpbmtUZXh0LCBhbmQgbW9kYWxCdXR0b25UZXh0XG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyBGb3IgYSB0ZWFtIHJlbGF0aW9uXG4gKiBnZW5lcmF0ZVJlbGF0aW9uRmFsbGJhY2soJ3RlYW0nLCAndGVhbUlkJywgdGVhbVNlcnZpY2UpXG4gKiAvLyBSZXR1cm5zOiB7XG4gKiAvLyAgIHRlbXBsYXRlOiAnVGVhbToge3RlYW1JZH0nLFxuICogLy8gICBsaW5rVGV4dDogJ1ZpZXcgVGVhbScsXG4gKiAvLyAgIG1vZGFsQnV0dG9uVGV4dDogJ1RlYW0gRGV0YWlscydcbiAqIC8vIH1cbiAqL1xuLyoqXG4gKiBHZW5lcmF0ZXMgZmFsbGJhY2sgZGlzcGxheSBjb25maWd1cmF0aW9uIGZvciByZWxhdGlvbiBmaWVsZHMuXG4gKiBcbiAqIENyZWF0ZXMgdXNlci1mcmllbmRseSBmYWxsYmFjayB0ZXh0IHRvIGRpc3BsYXkgd2hlbiBvbmx5IHRoZSBJRCBvZiBhIHJlbGF0ZWQgZW50aXR5IGlzIGF2YWlsYWJsZS5cbiAqIFVzZXMgdGhlIGVudGl0eSdzIHBsdXJhbCBkaXNwbGF5IG5hbWUgKGZyb20gbWV0YWRhdGEpIG9yIGdlbmVyYXRlcyBpdCBmcm9tIHRoZSBlbnRpdHkgbmFtZS5cbiAqIFxuICogQHBhcmFtIGVudGl0eU5hbWUgLSBOYW1lIG9mIHRoZSByZWxhdGVkIGVudGl0eSAoZS5nLiwgJ3RlYW0nLCAndXNlcicpXG4gKiBAcGFyYW0gaWRGaWVsZCAtIElEIGZpZWxkIG5hbWUgKGUuZy4sICd0ZWFtSWQnLCAndXNlcklkJylcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gT3B0aW9uYWwgZW50aXR5IHNlcnZpY2UgdG8gZmV0Y2ggbWV0YWRhdGEgZm9yIGJldHRlciBuYW1pbmdcbiAqIEByZXR1cm5zIEZhbGxiYWNrIGNvbmZpZ3VyYXRpb24gd2l0aCB0ZW1wbGF0ZSwgbGluayB0ZXh0LCBhbmQgbW9kYWwgYnV0dG9uIHRleHRcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IGZhbGxiYWNrID0gZ2VuZXJhdGVSZWxhdGlvbkZhbGxiYWNrKCd0ZWFtJywgJ3RlYW1JZCcpO1xuICogLy8gUmV0dXJuczoge1xuICogLy8gICB0ZW1wbGF0ZTogXCJUZWFtczoge3RlYW1JZH1cIixcbiAqIC8vICAgbGlua1RleHQ6IFwiVmlldyBUZWFtc1wiLFxuICogLy8gICBtb2RhbEJ1dHRvblRleHQ6IFwiVGVhbXMgRGV0YWlsc1wiXG4gKiAvLyB9XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdlbmVyYXRlUmVsYXRpb25GYWxsYmFjayhcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgaWRGaWVsZDogc3RyaW5nLFxuICAgIGVudGl0eVNlcnZpY2U/OiBCYXNlRW50aXR5U2VydmljZTxhbnk+XG4pOiBOb25OdWxsYWJsZTxJUmVsYXRpb25GaWVsZENvbmZpZ1sgJ2Rpc3BsYXlDb25maWcnIF0+WyAnZmFsbGJhY2snIF0ge1xuICAgIC8vIFRyeSB0byBnZXQgZW50aXR5IG1ldGFkYXRhIGZvciBiZXR0ZXIgZmFsbGJhY2sgdGV4dFxuICAgIGNvbnN0IGVudGl0eU1ldGFkYXRhID0gZW50aXR5U2VydmljZT8uZ2V0RW50aXR5U2NoZW1hPy4oKS5tb2RlbDtcbiAgICBjb25zdCBkaXNwbGF5TmFtZSA9IGVudGl0eU1ldGFkYXRhPy5lbnRpdHlOYW1lUGx1cmFsIHx8IHBhc2NhbENhc2UoZW50aXR5TmFtZSk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgICAvLyBCYWNrZW5kIHByZS1nZW5lcmF0ZXMgZmFsbGJhY2sgdGVtcGxhdGUgKGludGVudGlvbmFsbHkgc3RyaW5nLW9ubHksIG5vdCBUZW1wbGF0ZSB0eXBlKVxuICAgICAgICAvLyBGcm9udGVuZCB3aWxsIHVzZSB0aGlzIHdoZW4gb25seSBJRCBpcyBhdmFpbGFibGVcbiAgICAgICAgdGVtcGxhdGU6IGAke2Rpc3BsYXlOYW1lfTogeyR7aWRGaWVsZH19YCwgIC8vIGUuZy4sIFwiVGVhbToge3RlYW1JZH1cIlxuICAgICAgICBsaW5rVGV4dDogYFZpZXcgJHtkaXNwbGF5TmFtZX1gLCAgICAgICAgICAgLy8gZS5nLiwgXCJWaWV3IFRlYW1cIlxuICAgICAgICBtb2RhbEJ1dHRvblRleHQ6IGAke2Rpc3BsYXlOYW1lfSBEZXRhaWxzYCAgLy8gZS5nLiwgXCJUZWFtIERldGFpbHNcIlxuICAgIH07XG59XG5cbi8qKlxuICogTGFiZWwgZmllbGQgZGV0ZWN0aW9uIHJlc3VsdCB3aXRoIGNvbmZpZGVuY2Ugc2NvcmluZ1xuICovXG5pbnRlcmZhY2UgTGFiZWxGaWVsZERldGVjdGlvblJlc3VsdCB7XG4gICAgZmllbGQ6IHN0cmluZztcbiAgICBjb25maWRlbmNlOiAnaGlnaCcgfCAnbWVkaXVtJzsgIC8vIE9ubHkgaGlnaCBvciBtZWRpdW0gLSBubyBsb3cgY29uZmlkZW5jZSByZXN1bHRzIHJldHVybmVkXG4gICAgbWV0aG9kOiAnbWV0YWRhdGEnIHwgJ2NvbW1vbi1wYXR0ZXJuJyB8ICdlbnRpdHktcGF0dGVybicgfCAnc3VmZml4LXBhdHRlcm4nO1xufVxuXG4vKipcbiAqIFNtYXJ0IGxhYmVsIGZpZWxkIGRldGVjdGlvbiBmb3IgZW50aXR5IG9wdGlvbnMuXG4gKiBVc2VzIGdlbmVyaWMgcGF0dGVybnMgdG8gZmluZCBkaXNwbGF5IGZpZWxkcyB0aGF0IGFyZSBhY3R1YWwgaWRlbnRpZmllcnMvbmFtZXMuXG4gKiBcbiAqICoqSElHSExZIENPTlNFUlZBVElWRSoqOiBPbmx5IHJldHVybnMgZmllbGRzIHRoYXQgYXJlIGNsZWFybHkgbWVhbnQgZm9yIGRpc3BsYXkuXG4gKiBSZXR1cm5zIHVuZGVmaW5lZCBpZiBubyBwcm9wZXIgbmFtZSBmaWVsZCBpcyBmb3VuZCAtIGJldHRlciB0byBzaG93IElEIHRoYW4gY29uZnVzZSB1c2Vycy5cbiAqIFxuICogRGV0ZWN0aW9uIG9yZGVyIChhbGwgSElHSCBvciBNRURJVU0gY29uZmlkZW5jZSk6XG4gKiAxLiBFbnRpdHkgbWV0YWRhdGEgKGVudGl0eU5hbWVBdHRyaWJ1dGUpIC0gSElHSCBjb25maWRlbmNlXG4gKiAyLiBDb21tb24gZGlzcGxheSBmaWVsZCBwYXR0ZXJucyAobmFtZSwgdGl0bGUsIGxhYmVsLCBkaXNwbGF5TmFtZSkgLSBISUdIIGNvbmZpZGVuY2UgIFxuICogMy4gRW50aXR5LXNwZWNpZmljIHBhdHRlcm5zICh7ZW50aXR5TmFtZX1OYW1lLCB7ZW50aXR5TmFtZX1UaXRsZSkgLSBISUdIIGNvbmZpZGVuY2VcbiAqIDQuIEZpZWxkcyBlbmRpbmcgd2l0aCBuYW1lLWxpa2Ugc3VmZml4ZXMgKE5hbWUsIFRpdGxlLCBMYWJlbCwgQ29kZSkgLSBNRURJVU0gY29uZmlkZW5jZVxuICogXG4gKiAqKk5PIEZBTExCQUNLKio6IElmIG5vbmUgb2YgdGhlIGFib3ZlIG1hdGNoLCByZXR1cm5zIHVuZGVmaW5lZC5cbiAqIFdlIGRvIE5PVCBwaWNrIGdlbmVyaWMgZmllbGRzIGxpa2UgJ3N0YXR1cycsICd0eXBlJywgb3IgcmFuZG9tIGVudW1zL3N0cmluZ3MuXG4gKiBcbiAqIFdoeSBubyBmYWxsYmFjaz9cbiAqIC0gU2hvd2luZyBcImFjdGl2ZVwiL1wiY2FuY2VsbGVkXCIgZm9yIHN1YnNjcmlwdGlvbnMgaXMgY29uZnVzaW5nICh3aGljaCBzdWJzY3JpcHRpb24/KVxuICogLSBTaG93aW5nIFwiY3JlZGl0X2NhcmRcIi9cInBheXBhbFwiIGZvciBwYXltZW50IG1ldGhvZHMgaXMgbm90IGFuIGlkZW50aWZpZXJcbiAqIC0gQmV0dGVyIHRvIHNob3cgc3Vic2NyaXB0aW9uSWQgdGhhbiBtaXNsZWFkaW5nIGZpZWxkc1xuICogXG4gKiBGb3IgZW50aXRpZXMgd2l0aG91dCBuYW1lIGZpZWxkcywgdXNlIG9uZSBvZjpcbiAqIC0gU2V0IGVudGl0eU5hbWVBdHRyaWJ1dGUgaW4gc2NoZW1hIG1ldGFkYXRhXG4gKiAtIFVzZSBvcHRpb25NYXBwaW5nIGluIHJlbGF0aW9uIGNvbmZpZ1xuICogLSBMZXQgaXQgZmFsbCBiYWNrIHRvIElEIChjbGVhcmVzdCBvcHRpb24pXG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyBFbnRpdGllcyB3aXRoIGNsZWFyIG5hbWUgZmllbGRzIC0gREVURUNURUQg4pyFXG4gKiBUZWFtIOKGkiB0ZWFtTmFtZSAoUHJpb3JpdHkgMywgSElHSCBjb25maWRlbmNlKVxuICogVXNlciDihpIgbmFtZSAoUHJpb3JpdHkgMiwgSElHSCBjb25maWRlbmNlKVxuICogUG9zdCDihpIgcG9zdFRpdGxlIChQcmlvcml0eSA0LCBNRURJVU0gY29uZmlkZW5jZSlcbiAqIFxuICogQGV4YW1wbGUgIFxuICogLy8gRW50aXRpZXMgd2l0aG91dCBuYW1lIGZpZWxkcyAtIFJFVFVSTlMgdW5kZWZpbmVkIOKchVxuICogU3Vic2NyaXB0aW9uIOKGkiB1bmRlZmluZWQgKGZhbGxzIGJhY2sgdG8gc3Vic2NyaXB0aW9uSWQgLSBjbGVhciEpXG4gKiBQYXltZW50TWV0aG9kIOKGkiB1bmRlZmluZWQgKGZhbGxzIGJhY2sgdG8gcGF5bWVudE1ldGhvZElkIC0gY2xlYXIhKVxuICogQXVkaXRMb2cg4oaSIHVuZGVmaW5lZCAoZmFsbHMgYmFjayB0byBhdWRpdExvZ0lkIC0gY2xlYXIhKVxuICogXG4gKiBAcGFyYW0gc2NoZW1hIC0gRW50aXR5IHNjaGVtYVxuICogQHBhcmFtIGVudGl0eU5hbWUgLSBFbnRpdHkgbmFtZSAoZS5nLiwgJ3RlYW0nLCAndXNlcicpXG4gKiBAcGFyYW0gb3B0aW9ucyAtIERldGVjdGlvbiBvcHRpb25zXG4gKiBAcmV0dXJucyBCZXN0IGxhYmVsIGZpZWxkIG5hbWUgb3IgdW5kZWZpbmVkICh3aWxsIGZhbGwgYmFjayB0byBJRCBmaWVsZClcbiAqL1xuZnVuY3Rpb24gZmluZExhYmVsRmllbGQoXG4gICAgc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIG9wdGlvbnM/OiB7XG4gICAgICAgIC8qKiBNaW5pbXVtIGNvbmZpZGVuY2UgbGV2ZWwgcmVxdWlyZWQgKGRlZmF1bHQ6ICdtZWRpdW0nKSAqL1xuICAgICAgICBtaW5Db25maWRlbmNlPzogJ2hpZ2gnIHwgJ21lZGl1bSc7XG4gICAgICAgIC8qKiBFbmFibGUgZGVidWcgbG9nZ2luZyAoZGVmYXVsdDogZmFsc2UpICovXG4gICAgICAgIGRlYnVnPzogYm9vbGVhbjtcbiAgICB9XG4pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IG1pbkNvbmZpZGVuY2UgPSBvcHRpb25zPy5taW5Db25maWRlbmNlIHx8ICdtZWRpdW0nO1xuICAgIGNvbnN0IGRlYnVnID0gb3B0aW9ucz8uZGVidWcgfHwgZmFsc2U7XG5cbiAgICBsZXQgcmVzdWx0OiBMYWJlbEZpZWxkRGV0ZWN0aW9uUmVzdWx0IHwgdW5kZWZpbmVkO1xuXG4gICAgLy8gR2V0IGFsbCBhdHRyaWJ1dGVzIGZyb20gc2NoZW1hXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IHNjaGVtYS5hdHRyaWJ1dGVzO1xuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVzID0gT2JqZWN0LmtleXMoYXR0cmlidXRlcyk7XG5cbiAgICAvLyBQcmlvcml0eSAxOiBFbnRpdHkgbWV0YWRhdGEgLSBISUdIIGNvbmZpZGVuY2VcbiAgICBjb25zdCBlbnRpdHlOYW1lQXR0cmlidXRlID0gc2NoZW1hLm1vZGVsLmVudGl0eU5hbWVBdHRyaWJ1dGU7XG4gICAgaWYgKGVudGl0eU5hbWVBdHRyaWJ1dGUgJiYgYXR0cmlidXRlc1sgZW50aXR5TmFtZUF0dHJpYnV0ZSBdKSB7XG4gICAgICAgIHJlc3VsdCA9IHtcbiAgICAgICAgICAgIGZpZWxkOiBlbnRpdHlOYW1lQXR0cmlidXRlLFxuICAgICAgICAgICAgY29uZmlkZW5jZTogJ2hpZ2gnLFxuICAgICAgICAgICAgbWV0aG9kOiAnbWV0YWRhdGEnXG4gICAgICAgIH07XG4gICAgICAgIGlmIChkZWJ1Zykge1xuICAgICAgICAgICAgRGVmYXVsdExvZ2dlci5pbmZvKGBbZmluZExhYmVsRmllbGRdICR7ZW50aXR5TmFtZX06IEZvdW5kIHZpYSBtZXRhZGF0YSAtICR7ZW50aXR5TmFtZUF0dHJpYnV0ZX0gKEhJR0ggY29uZmlkZW5jZSlgKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFByaW9yaXR5IDI6IENvbW1vbiBkaXNwbGF5IHBhdHRlcm5zIC0gSElHSCBjb25maWRlbmNlXG4gICAgaWYgKCFyZXN1bHQpIHtcbiAgICAgICAgY29uc3QgY29tbW9uUGF0dGVybnMgPSBbICduYW1lJywgJ3RpdGxlJywgJ2xhYmVsJywgJ2Rpc3BsYXlOYW1lJywgJ2Rpc3BsYXluYW1lJyBdO1xuICAgICAgICBmb3IgKGNvbnN0IHBhdHRlcm4gb2YgY29tbW9uUGF0dGVybnMpIHtcbiAgICAgICAgICAgIGNvbnN0IG1hdGNoID0gYXR0cmlidXRlTmFtZXMuZmluZChhdHRyID0+IGF0dHIudG9Mb3dlckNhc2UoKSA9PT0gcGF0dGVybik7XG4gICAgICAgICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgICAgICAgICByZXN1bHQgPSB7XG4gICAgICAgICAgICAgICAgICAgIGZpZWxkOiBtYXRjaCxcbiAgICAgICAgICAgICAgICAgICAgY29uZmlkZW5jZTogJ2hpZ2gnLFxuICAgICAgICAgICAgICAgICAgICBtZXRob2Q6ICdjb21tb24tcGF0dGVybidcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIGlmIChkZWJ1Zykge1xuICAgICAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtmaW5kTGFiZWxGaWVsZF0gJHtlbnRpdHlOYW1lfTogRm91bmQgdmlhIGNvbW1vbiBwYXR0ZXJuICcke3BhdHRlcm59JyAtICR7bWF0Y2h9IChISUdIIGNvbmZpZGVuY2UpYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gUHJpb3JpdHkgMzogRW50aXR5LXNwZWNpZmljIHBhdHRlcm5zIC0gSElHSCBjb25maWRlbmNlXG4gICAgaWYgKCFyZXN1bHQpIHtcbiAgICAgICAgY29uc3QgZW50aXR5TG93ZXIgPSBlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIGNvbnN0IGVudGl0eVNwZWNpZmljU3VmZml4ZXMgPSBbICdOYW1lJywgJ1RpdGxlJywgJ0xhYmVsJyBdO1xuXG4gICAgICAgIGZvciAoY29uc3Qgc3VmZml4IG9mIGVudGl0eVNwZWNpZmljU3VmZml4ZXMpIHtcbiAgICAgICAgICAgIC8vIFRyeSBleGFjdCBtYXRjaDogZS5nLiwgJ3RlYW1OYW1lJyBmb3IgZW50aXR5ICd0ZWFtJ1xuICAgICAgICAgICAgY29uc3QgZXhhY3RNYXRjaCA9IGF0dHJpYnV0ZU5hbWVzLmZpbmQoYXR0ciA9PlxuICAgICAgICAgICAgICAgIGF0dHIudG9Mb3dlckNhc2UoKSA9PT0gYCR7ZW50aXR5TG93ZXJ9JHtzdWZmaXgudG9Mb3dlckNhc2UoKX1gXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgaWYgKGV4YWN0TWF0Y2gpIHtcbiAgICAgICAgICAgICAgICByZXN1bHQgPSB7XG4gICAgICAgICAgICAgICAgICAgIGZpZWxkOiBleGFjdE1hdGNoLFxuICAgICAgICAgICAgICAgICAgICBjb25maWRlbmNlOiAnaGlnaCcsXG4gICAgICAgICAgICAgICAgICAgIG1ldGhvZDogJ2VudGl0eS1wYXR0ZXJuJ1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgaWYgKGRlYnVnKSB7XG4gICAgICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW2ZpbmRMYWJlbEZpZWxkXSAke2VudGl0eU5hbWV9OiBGb3VuZCB2aWEgZW50aXR5LXNwZWNpZmljIHBhdHRlcm4gLSAke2V4YWN0TWF0Y2h9IChISUdIIGNvbmZpZGVuY2UpYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gUHJpb3JpdHkgNDogRmllbGRzIGVuZGluZyB3aXRoIG5hbWUtbGlrZSBzdWZmaXhlcyAtIE1FRElVTSBjb25maWRlbmNlXG4gICAgLy8gTG9vayBmb3IgYW55IGZpZWxkIGVuZGluZyB3aXRoICdOYW1lJywgJ1RpdGxlJywgJ0xhYmVsJyAoZS5nLiwgJ2Rpc3BsYXlOYW1lJywgJ2Z1bGxOYW1lJywgJ3VzZXJOYW1lJywpXG4gICAgaWYgKCFyZXN1bHQpIHtcbiAgICAgICAgY29uc3QgZGlzcGxheU5hbWVTdWZmaXhQYXR0ZXJuID0gL0Rpc3BsYXlOYW1lJC87XG4gICAgICAgIGNvbnN0IG5hbWVTdWZmaXhQYXR0ZXJuID0gL05hbWUkLztcbiAgICAgICAgY29uc3QgdGl0bGVTdWZmaXhQYXR0ZXJuID0gL1RpdGxlJC87XG4gICAgICAgIGNvbnN0IGxhYmVsU3VmZml4UGF0dGVybiA9IC9MYWJlbCQvO1xuICAgICAgICBjb25zdCBjb2RlU3VmZml4UGF0dGVybiA9IC9Db2RlJC87XG5cbiAgICAgICAgZm9yIChjb25zdCBwYXR0ZXJuIG9mIFsgZGlzcGxheU5hbWVTdWZmaXhQYXR0ZXJuLCBsYWJlbFN1ZmZpeFBhdHRlcm4sIHRpdGxlU3VmZml4UGF0dGVybiwgbmFtZVN1ZmZpeFBhdHRlcm4sIGNvZGVTdWZmaXhQYXR0ZXJuIF0pIHtcbiAgICAgICAgICAgIGNvbnN0IG1hdGNoID0gYXR0cmlidXRlTmFtZXMuZmluZChhdHRyID0+IHBhdHRlcm4udGVzdChhdHRyKSk7XG4gICAgICAgICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgICAgICAgICByZXN1bHQgPSB7XG4gICAgICAgICAgICAgICAgICAgIGZpZWxkOiBtYXRjaCxcbiAgICAgICAgICAgICAgICAgICAgY29uZmlkZW5jZTogJ21lZGl1bScsXG4gICAgICAgICAgICAgICAgICAgIG1ldGhvZDogJ3N1ZmZpeC1wYXR0ZXJuJ1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgaWYgKGRlYnVnKSB7XG4gICAgICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW2ZpbmRMYWJlbEZpZWxkXSAke2VudGl0eU5hbWV9OiBGb3VuZCB2aWEgc3VmZml4IHBhdHRlcm4gLSAke21hdGNofSAoTUVESVVNIGNvbmZpZGVuY2UpYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gUHJpb3JpdHkgNTogTk8gRkFMTEJBQ0sgLSBJZiB3ZSBjYW4ndCBmaW5kIGEgcHJvcGVyIG5hbWUgZmllbGQsIHJldHVybiB1bmRlZmluZWRcbiAgICAvLyBCZXR0ZXIgdG8gc2hvdyBJRCB0aGFuIHRvIHNob3cgY29uZnVzaW5nIGZpZWxkcyBsaWtlICdzdGF0dXMnLCAndHlwZScsIGV0Yy5cbiAgICAvLyBcbiAgICAvLyBFbnRpdGllcyBsaWtlIFN1YnNjcmlwdGlvbiwgUGF5bWVudE1ldGhvZCBkb24ndCBoYXZlIHRyYWRpdGlvbmFsIG5hbWUgZmllbGRzLlxuICAgIC8vIFNob3dpbmcgXCJhY3RpdmVcIiBvciBcImNyZWRpdF9jYXJkXCIgaW4gYSBkcm9wZG93biBpcyBjb25mdXNpbmcgLSB1c2VycyBjYW4ndCBkaXN0aW5ndWlzaCBpdGVtcy5cbiAgICAvLyBJdCdzIGNsZWFyZXIgdG8gc2hvdyB0aGUgSUQgKHN1YnNjcmlwdGlvbklkLCBwYXltZW50TWV0aG9kSWQpIGluIHN1Y2ggY2FzZXMuXG4gICAgLy9cbiAgICAvLyBJZiB5b3UgbmVlZCBjdXN0b20gbGFiZWxzIGZvciB0aGVzZSBlbnRpdGllcywgZXhwbGljaXRseSBzZXQgZW50aXR5TmFtZUF0dHJpYnV0ZSBpbiB0aGUgc2NoZW1hXG4gICAgLy8gb3IgdXNlIG9wdGlvbk1hcHBpbmcgaW4gdGhlIHJlbGF0aW9uIGNvbmZpZy5cblxuICAgIC8vIENoZWNrIGNvbmZpZGVuY2UgdGhyZXNob2xkXG4gICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAvLyBPbmx5IHJldHVybiBpZiBjb25maWRlbmNlIG1lZXRzIG1pbmltdW0gcmVxdWlyZW1lbnRcbiAgICAgICAgLy8gbWluQ29uZmlkZW5jZTogJ2hpZ2gnIOKGkiBvbmx5IHJldHVybiBISUdIIGNvbmZpZGVuY2UgcmVzdWx0c1xuICAgICAgICAvLyBtaW5Db25maWRlbmNlOiAnbWVkaXVtJyDihpIgcmV0dXJuIEhJR0ggb3IgTUVESVVNIGNvbmZpZGVuY2UgcmVzdWx0cyAoZGVmYXVsdClcbiAgICAgICAgaWYgKG1pbkNvbmZpZGVuY2UgPT09ICdoaWdoJyAmJiByZXN1bHQuY29uZmlkZW5jZSA9PT0gJ21lZGl1bScpIHtcbiAgICAgICAgICAgIGlmIChkZWJ1Zykge1xuICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgW2ZpbmRMYWJlbEZpZWxkXSAke2VudGl0eU5hbWV9OiBGaWVsZCAnJHtyZXN1bHQuZmllbGR9JyBmb3VuZCB3aXRoIE1FRElVTSBjb25maWRlbmNlLCBidXQgSElHSCBjb25maWRlbmNlIHJlcXVpcmVkLiBSZXR1cm5pbmcgdW5kZWZpbmVkLmApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiByZXN1bHQuZmllbGQ7XG4gICAgfVxuXG4gICAgLy8gTm8gc3VpdGFibGUgZmllbGQgZm91bmRcbiAgICBpZiAoZGVidWcpIHtcbiAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBbZmluZExhYmVsRmllbGRdICR7ZW50aXR5TmFtZX06IE5vIHN1aXRhYmxlIGxhYmVsIGZpZWxkIGZvdW5kIHdpdGggc3VmZmljaWVudCBjb25maWRlbmNlLmApO1xuICAgIH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFJFTEFUSU9OIE9QVElPTiBDT05GSUcgUkVTT0xVVElPTlxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogUmVzb2x2ZXMgUmVsYXRpb25FbnRpdHlPcHRpb25Db25maWcgaW50byBGaWVsZE9wdGlvbnNBUElDb25maWcgYnkgYXV0by1kZXRlY3Rpbmc6XG4gKiAtIENSVUQgQVBJIHBhdGggZnJvbSBlbnRpdHkgc2NoZW1hXG4gKiAtIExhYmVsIGZpZWxkIGZyb20gZW50aXR5TmFtZUF0dHJpYnV0ZSBtZXRhZGF0YSBvciBzbWFydCBkZXRlY3Rpb25cbiAqIC0gVmFsdWUgZmllbGQgZnJvbSByZWxhdGlvbiBpZGVudGlmaWVyc1xuICogXG4gKiBAcGFyYW0gcmVsYXRpb25Db25maWcgLSBNaW5pbWFsIHJlbGF0aW9uIG9wdGlvbiBjb25maWdcbiAqIEBwYXJhbSByZWxhdGlvbkF0dHJpYnV0ZSAtIFRoZSByZWxhdGlvbiBhdHRyaWJ1dGUgKHRvIGdldCBpZGVudGlmaWVycylcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gRW50aXR5IHNlcnZpY2UgZm9yIHNjaGVtYSBsb29rdXBcbiAqIEBwYXJhbSBnbG9iYWxVSUNvbmZpZ09wdGlvbnMgLSBHbG9iYWwgVUkgY29uZmlnIG9wdGlvbnMgKGZvciBsYWJlbCBmaWVsZCBkZXRlY3Rpb24pXG4gKiBAcmV0dXJucyBGdWxseSByZXNvbHZlZCBGaWVsZE9wdGlvbnNBUElDb25maWcgb3IgdW5kZWZpbmVkIGlmIGVudGl0eSBub3QgZm91bmRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVSZWxhdGlvbk9wdGlvbkNvbmZpZyhcbiAgICByZWxhdGlvbkNvbmZpZzogUmVsYXRpb25FbnRpdHlPcHRpb25Db25maWcsXG4gICAgcmVsYXRpb25BdHRyaWJ1dGU6IFRJT1NjaGVtYUF0dHJpYnV0ZSAmIHsgcmVsYXRpb246IE5vbk51bGxhYmxlPFRJT1NjaGVtYUF0dHJpYnV0ZVsgJ3JlbGF0aW9uJyBdPiB9LFxuICAgIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sXG4gICAgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyAndWlDb25maWdHZW5PcHRpb25zJyBdXG4pOiBGaWVsZE9wdGlvbnNBUElDb25maWc8YW55PiB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lLCBjdXN0b21BcGlVcmwsIG9wdGlvbk1hcHBpbmcsIC4uLnJlc3QgfSA9IHJlbGF0aW9uQ29uZmlnO1xuICAgIGNvbnN0IHJlbGF0aW9uID0gcmVsYXRpb25BdHRyaWJ1dGUucmVsYXRpb247XG5cbiAgICAvLyBHZXQgcmVsYXRlZCBlbnRpdHkgc2VydmljZVxuICAgIGlmICghZW50aXR5U2VydmljZS5oYXNFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKGVudGl0eU5hbWUpKSB7XG4gICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgW3Jlc29sdmVSZWxhdGlvbk9wdGlvbkNvbmZpZ10gRW50aXR5IHNlcnZpY2Ugbm90IGZvdW5kIGZvcjogJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIGNvbnN0IHJlbGF0ZWRTZXJ2aWNlID0gZW50aXR5U2VydmljZS5nZXRFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKGVudGl0eU5hbWUpO1xuICAgIGNvbnN0IHJlbGF0ZWRTY2hlbWEgPSByZWxhdGVkU2VydmljZT8uZ2V0RW50aXR5U2NoZW1hPy4oKTtcblxuICAgIGlmICghcmVsYXRlZFNjaGVtYSkge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYFtyZXNvbHZlUmVsYXRpb25PcHRpb25Db25maWddIFNjaGVtYSBub3QgZm91bmQgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8vIDEuIFJlc29sdmUgQVBJIFVSTFxuICAgIGNvbnN0IGVudGl0eU5hbWVMb3dlciA9IGVudGl0eU5hbWUudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBjcnVkUGF0aCA9IHJlbGF0ZWRTY2hlbWEubW9kZWwuQ1JVREFwaVBhdGggfHwgJyc7XG4gICAgY29uc3QgYXBpVXJsID0gY3VzdG9tQXBpVXJsIHx8IGAke2NydWRQYXRofS8ke2VudGl0eU5hbWVMb3dlcn1gO1xuXG4gICAgLy8gMi4gUmVzb2x2ZSB2YWx1ZSBmaWVsZCBmcm9tIHJlbGF0aW9uIGlkZW50aWZpZXJzXG4gICAgY29uc3QgcmVzb2x2ZWRJZGVudGlmaWVycyA9IHR5cGVvZiByZWxhdGlvbi5pZGVudGlmaWVycyA9PT0gJ2Z1bmN0aW9uJyA/IHJlbGF0aW9uLmlkZW50aWZpZXJzKCkgOiByZWxhdGlvbi5pZGVudGlmaWVycztcbiAgICBjb25zdCBpZGVudGlmaWVyTWFwcGluZ3MgPSBBcnJheS5pc0FycmF5KHJlc29sdmVkSWRlbnRpZmllcnMpID8gcmVzb2x2ZWRJZGVudGlmaWVycyA6IFsgcmVzb2x2ZWRJZGVudGlmaWVycyBdO1xuICAgIGNvbnN0IHByaW1hcnlJZGVudGlmaWVyID0gaWRlbnRpZmllck1hcHBpbmdzWyAwIF07XG4gICAgY29uc3QgdmFsdWVGaWVsZCA9IFN0cmluZyhwcmltYXJ5SWRlbnRpZmllci50YXJnZXQpO1xuXG4gICAgLy8gMy4gUmVzb2x2ZSBsYWJlbCBmaWVsZCBmcm9tIGVudGl0eSBtZXRhZGF0YSBvciBjdXN0b20gbWFwcGluZ1xuICAgIGxldCBsYWJlbEZpZWxkID0gdmFsdWVGaWVsZDsgLy8gRGVmYXVsdCBmYWxsYmFjayB0byB2YWx1ZSBmaWVsZFxuXG4gICAgaWYgKG9wdGlvbk1hcHBpbmc/LmxhYmVsKSB7XG4gICAgICAgIC8vIEN1c3RvbSBsYWJlbCBwcm92aWRlZCAtIHVzZSBpdFxuICAgICAgICBsYWJlbEZpZWxkID0gb3B0aW9uTWFwcGluZy5sYWJlbCBhcyBzdHJpbmc7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQXV0by1kZXRlY3QgdXNpbmcgc21hcnQgcGF0dGVybiBtYXRjaGluZyB3aXRoIGdsb2JhbCBjb25maWdcbiAgICAgICAgY29uc3QgbGFiZWxGaWVsZENvbmZpZyA9IGdsb2JhbFVJQ29uZmlnT3B0aW9ucz8ubGFiZWxGaWVsZERldGVjdGlvbjtcbiAgICAgICAgbGFiZWxGaWVsZCA9IGZpbmRMYWJlbEZpZWxkKHJlbGF0ZWRTY2hlbWEsIGVudGl0eU5hbWUsIHtcbiAgICAgICAgICAgIG1pbkNvbmZpZGVuY2U6IGxhYmVsRmllbGRDb25maWc/Lm1pbkNvbmZpZGVuY2UgfHwgJ21lZGl1bScsXG4gICAgICAgICAgICBkZWJ1ZzogbGFiZWxGaWVsZENvbmZpZz8uZGVidWcgfHwgZmFsc2VcbiAgICAgICAgfSkgfHwgdmFsdWVGaWVsZDtcbiAgICB9XG5cbiAgICAvLyA0LiBCdWlsZCBjb21wbGV0ZSBGaWVsZE9wdGlvbnNBUElDb25maWdcbiAgICByZXR1cm4ge1xuICAgICAgICBhcGlNZXRob2Q6ICdHRVQnLFxuICAgICAgICBhcGlVcmwsXG4gICAgICAgIHJlc3BvbnNlS2V5OiAnaXRlbXMnLFxuICAgICAgICBvcHRpb25NYXBwaW5nOiBvcHRpb25NYXBwaW5nIHx8IHtcbiAgICAgICAgICAgIGxhYmVsOiBsYWJlbEZpZWxkLFxuICAgICAgICAgICAgdmFsdWU6IChvcHRpb25NYXBwaW5nIGFzIGFueSk/LnZhbHVlIHx8IHZhbHVlRmllbGRcbiAgICAgICAgfSxcbiAgICAgICAgLi4ucmVzdCAvLyBQYXNzIHRocm91Z2ggZmlsdGVycywgY291bnQsIGRpc2FibGVTZWFyY2gsIGV0Yy5cbiAgICB9O1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEZJTFRFUiBBVVRPLUdFTkVSQVRJT05cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIEF1dG8tZ2VuZXJhdGVzIGZpbHRlckNvbmZpZyBmb3IgZW50aXR5IGF0dHJpYnV0ZXMgYmFzZWQgb24gZmllbGQgdHlwZS5cbiAqIFxuICogQWxnb3JpdGhtOlxuICogMS4gQ2hlY2sgaWYgZXhwbGljaXQgZmlsdGVyQ29uZmlnIGFscmVhZHkgZXhpc3RzIOKGkiB1c2UgaXRcbiAqIDIuIENoZWNrIGlmIGZpZWxkIGlzIGV4cGxpY2l0bHkgbm9uLWZpbHRlcmFibGUg4oaSIHNraXBcbiAqIDMuIERldGVjdCBmaWVsZCB0eXBlIGFuZCBnZW5lcmF0ZSBhcHByb3ByaWF0ZSBjb25maWdcbiAqIDQuIE1lcmdlIHdpdGggZ2xvYmFsIGFuZCBlbnRpdHktbGV2ZWwgb3ZlcnJpZGVzXG4gKiBcbiAqIEBwYXJhbSBhdHRyaWJ1dGUgLSBUaGUgYXR0cmlidXRlIHRvIGdlbmVyYXRlIGZpbHRlciBjb25maWcgZm9yXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIGZvciBhY2Nlc3NpbmcgZW50aXR5IG1ldGFkYXRhXG4gKiBAcGFyYW0gZ2xvYmFsVUlDb25maWdPcHRpb25zIC0gR2xvYmFsIFVJIGNvbmZpZ3VyYXRpb24gb3B0aW9uc1xuICogQHJldHVybnMgR2VuZXJhdGVkIGZpbHRlciBjb25maWd1cmF0aW9uIG9yIHVuZGVmaW5lZFxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVGaWx0ZXJDb25maWcoXG4gICAgYXR0cmlidXRlOiBUSU9TY2hlbWFBdHRyaWJ1dGUsXG4gICAgZW50aXR5U2VydmljZT86IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sXG4gICAgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyAndWlDb25maWdHZW5PcHRpb25zJyBdXG4pOiBGaWVsZE1ldGFkYXRhWyAnZmlsdGVyQ29uZmlnJyBdIHwgdW5kZWZpbmVkIHtcbiAgICAvLyAxLiBJZiBleHBsaWNpdCBmaWx0ZXJDb25maWcgZXhpc3RzLCB1c2UgaXQgKGhpZ2hlc3QgcHJpb3JpdHkpXG4gICAgaWYgKGF0dHJpYnV0ZS5maWx0ZXJDb25maWcpIHtcbiAgICAgICAgcmV0dXJuIGF0dHJpYnV0ZS5maWx0ZXJDb25maWc7XG4gICAgfVxuXG4gICAgLy8gMi4gSWYgZmllbGQgaGFzIGV4cGxpY2l0IG9wdGlvbnMgY29uZmlnLCB1c2UgaXRcbiAgICBpZiAoJ29wdGlvbnMnIGluIGF0dHJpYnV0ZSkge1xuICAgICAgICBjb25zdCBvcHRpb25zID0gKGF0dHJpYnV0ZSBhcyBTZWxlY3RGaWVsZE1ldGFkYXRhKS5vcHRpb25zO1xuXG4gICAgICAgIC8vIFJlbGF0aW9uRW50aXR5T3B0aW9uQ29uZmlnIChoYXMgZW50aXR5TmFtZSkg4oaSIHJlc29sdmUgdG8gRmllbGRPcHRpb25zQVBJQ29uZmlnXG4gICAgICAgIGNvbnN0IGlzUmVsYXRpb25Db25maWcgPSB0eXBlb2Ygb3B0aW9ucyA9PT0gJ29iamVjdCcgJiYgIUFycmF5LmlzQXJyYXkob3B0aW9ucykgJiYgJ2VudGl0eU5hbWUnIGluIG9wdGlvbnM7XG5cbiAgICAgICAgbGV0IHJlc29sdmVkQ29uZmlnOiBGaWVsZE9wdGlvbnNBUElDb25maWc8YW55PiB8IEZpZWxkT3B0aW9uW10gfCB1bmRlZmluZWQ7XG5cbiAgICAgICAgLy8gSW5saW5lIGFycmF5IOKGkiB1c2UgYXMgaXNcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkob3B0aW9ucykgJiYgb3B0aW9ucy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICByZXNvbHZlZENvbmZpZyA9IG9wdGlvbnMgYXMgRmllbGRPcHRpb25bXTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEZpZWxkT3B0aW9uc0FQSUNvbmZpZyAoaGFzIGFwaU1ldGhvZCwgYXBpVXJsLCByZXNwb25zZUtleSkg4oaSIHBhc3MgdGhyb3VnaFxuICAgICAgICBjb25zdCBpc0FwaUNvbmZpZyA9IHR5cGVvZiBvcHRpb25zID09PSAnb2JqZWN0JyAmJiAhQXJyYXkuaXNBcnJheShvcHRpb25zKSAmJiAnYXBpTWV0aG9kJyBpbiBvcHRpb25zO1xuICAgICAgICBpZiAoaXNBcGlDb25maWcpIHtcbiAgICAgICAgICAgIHJlc29sdmVkQ29uZmlnID0gb3B0aW9ucyBhcyBGaWVsZE9wdGlvbnNBUElDb25maWc8YW55PjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChpc1JlbGF0aW9uQ29uZmlnICYmIGF0dHJpYnV0ZS5yZWxhdGlvbiAmJiBlbnRpdHlTZXJ2aWNlKSB7XG4gICAgICAgICAgICByZXNvbHZlZENvbmZpZyA9IHJlc29sdmVSZWxhdGlvbk9wdGlvbkNvbmZpZyhcbiAgICAgICAgICAgICAgICBvcHRpb25zIGFzIFJlbGF0aW9uRW50aXR5T3B0aW9uQ29uZmlnLFxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZSBhcyBUSU9TY2hlbWFBdHRyaWJ1dGUgJiB7IHJlbGF0aW9uOiBOb25OdWxsYWJsZTxUSU9TY2hlbWFBdHRyaWJ1dGVbICdyZWxhdGlvbicgXT4gfSxcbiAgICAgICAgICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuICAgICAgICAgICAgICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9uc1xuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChyZXNvbHZlZENvbmZpZykge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBmaWx0ZXJUeXBlOiAnc2VsZWN0JyxcbiAgICAgICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6ICdlcScgYXMgY29uc3QsXG4gICAgICAgICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBbICdlcScsICduZXEnLCAnaW5MaXN0JywgJ25vdEluTGlzdCcsICdpc0VtcHR5JywgJ2lzTnVsbCcgXSxcbiAgICAgICAgICAgICAgICBwcmVkZWZpbmVkT3B0aW9uczogcmVzb2x2ZWRDb25maWdcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBlbHNlIGxvZyBlcnJvclxuICAgICAgICB0aHJvdyBuZXcgRnJhbWV3b3JrRXJyb3IoYFtnZW5lcmF0ZUZpbHRlckNvbmZpZ10gTm8gcmVzb2x2ZWQgY29uZmlnIGZvdW5kIGZvciBhdHRyaWJ1dGU6ICR7YXR0cmlidXRlLmlkfWAsIHtcbiAgICAgICAgICAgIGF0dHJpYnV0ZTogYXR0cmlidXRlLFxuICAgICAgICAgICAgb3B0aW9uczogb3B0aW9ucyxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gMy4gSWYgZmllbGQgaXMgZXhwbGljaXRseSBub24tZmlsdGVyYWJsZSwgc2tpcFxuICAgIGlmIChhdHRyaWJ1dGUuaXNGaWx0ZXJhYmxlID09PSBmYWxzZSkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8vIDMuIEdldCBnbG9iYWwgYW5kIGVudGl0eS1sZXZlbCBjb25maWdcbiAgICBjb25zdCBnbG9iYWxGaWx0ZXJDb25maWcgPSBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/LnRhYmxlVUk/LmZpbHRlckF1dG9HZW5lcmF0aW9uO1xuICAgIGNvbnN0IGVudGl0eU1ldGFkYXRhID0gZW50aXR5U2VydmljZT8uZ2V0RW50aXR5U2NoZW1hPy4oKS5tb2RlbD8ubWV0YWRhdGEgYXMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+WyAnbW9kZWwnIF1bICdtZXRhZGF0YScgXTtcbiAgICBjb25zdCBlbnRpdHlGaWx0ZXJDb25maWcgPSBlbnRpdHlNZXRhZGF0YT8udGFibGVVST8uZmlsdGVyQXV0b0dlbmVyYXRpb247XG5cbiAgICAvLyBNZXJnZSBjb25maWdzIChlbnRpdHkgPiBnbG9iYWwgPiBkZWZhdWx0cylcbiAgICBjb25zdCBtZXJnZWRDb25maWcgPSB7XG4gICAgICAgIGVuYWJsZWQ6IGVudGl0eUZpbHRlckNvbmZpZz8uZW5hYmxlZCA/PyBnbG9iYWxGaWx0ZXJDb25maWc/LmVuYWJsZWQgPz8gdHJ1ZSxcbiAgICAgICAgZGF0ZUZpZWxkczoge1xuICAgICAgICAgICAgLi4uZ2xvYmFsRmlsdGVyQ29uZmlnPy5kYXRlRmllbGRzLFxuICAgICAgICAgICAgLi4uZW50aXR5RmlsdGVyQ29uZmlnPy5kYXRlRmllbGRzXG4gICAgICAgIH0sXG4gICAgICAgIGVudW1GaWVsZHM6IHtcbiAgICAgICAgICAgIC4uLmdsb2JhbEZpbHRlckNvbmZpZz8uZW51bUZpZWxkcyxcbiAgICAgICAgICAgIC4uLmVudGl0eUZpbHRlckNvbmZpZz8uZW51bUZpZWxkc1xuICAgICAgICB9LFxuICAgICAgICBib29sZWFuRmllbGRzOiB7XG4gICAgICAgICAgICAuLi5nbG9iYWxGaWx0ZXJDb25maWc/LmJvb2xlYW5GaWVsZHMsXG4gICAgICAgICAgICAuLi5lbnRpdHlGaWx0ZXJDb25maWc/LmJvb2xlYW5GaWVsZHNcbiAgICAgICAgfSxcbiAgICAgICAgcmVsYXRpb25GaWVsZHM6IHtcbiAgICAgICAgICAgIC4uLmdsb2JhbEZpbHRlckNvbmZpZz8ucmVsYXRpb25GaWVsZHMsXG4gICAgICAgICAgICAuLi5lbnRpdHlGaWx0ZXJDb25maWc/LnJlbGF0aW9uRmllbGRzXG4gICAgICAgIH0sXG4gICAgICAgIG51bWJlckZpZWxkczoge1xuICAgICAgICAgICAgLi4uZ2xvYmFsRmlsdGVyQ29uZmlnPy5udW1iZXJGaWVsZHMsXG4gICAgICAgICAgICAuLi5lbnRpdHlGaWx0ZXJDb25maWc/Lm51bWJlckZpZWxkc1xuICAgICAgICB9LFxuICAgICAgICB0ZXh0RmllbGRzOiB7XG4gICAgICAgICAgICAuLi5nbG9iYWxGaWx0ZXJDb25maWc/LnRleHRGaWVsZHMsXG4gICAgICAgICAgICAuLi5lbnRpdHlGaWx0ZXJDb25maWc/LnRleHRGaWVsZHNcbiAgICAgICAgfSxcbiAgICAgICAgZGVidWc6IGVudGl0eUZpbHRlckNvbmZpZz8uZGVidWcgPz8gZ2xvYmFsRmlsdGVyQ29uZmlnPy5kZWJ1ZyA/PyBmYWxzZVxuICAgIH07XG5cbiAgICAvLyBJZiBnbG9iYWxseSBkaXNhYmxlZCwgc2tpcFxuICAgIGlmICghbWVyZ2VkQ29uZmlnLmVuYWJsZWQpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCBhdHRyVHlwZSA9IGF0dHJpYnV0ZS50eXBlO1xuICAgIGNvbnN0IGZpZWxkVHlwZSA9IGF0dHJpYnV0ZS5maWVsZFR5cGU7XG5cbiAgICAvLyAqKjEuIEJvb2xlYW4gZmllbGRzKipcbiAgICBpZiAoYXR0clR5cGUgPT09ICdib29sZWFuJyAmJiBtZXJnZWRDb25maWcuYm9vbGVhbkZpZWxkcz8uZW5hYmxlZCAhPT0gZmFsc2UpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGZpbHRlclR5cGU6ICdib29sZWFuJyxcbiAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogJ2VxJyxcbiAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogWyAnZXEnLCAnbmVxJywgJ2lzRW1wdHknLCAnaXNOdWxsJyBdLFxuICAgICAgICAgICAgcHJlZGVmaW5lZE9wdGlvbnM6IFtcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnWWVzJywgdmFsdWU6IFwidHJ1ZVwiIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ05vJywgdmFsdWU6IFwiZmFsc2VcIiB9XG4gICAgICAgICAgICBdXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gKioyLiBFbnVtIGZpZWxkcyAoYXJyYXkgb2Ygc3RyaW5ncy9udW1iZXJzKSoqXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoYXR0clR5cGUpICYmIG1lcmdlZENvbmZpZy5lbnVtRmllbGRzPy5lbmFibGVkICE9PSBmYWxzZSkge1xuICAgICAgICBjb25zdCBkZWZhdWx0RW51bU9wcyA9IFsgJ2VxJywgJ25lcScsICdpbkxpc3QnLCAnbm90SW5MaXN0JywgJ2lzRW1wdHknLCAnaXNOdWxsJyBdIGFzIGNvbnN0O1xuICAgICAgICBjb25zdCBkZWZhdWx0T3AgPSBtZXJnZWRDb25maWcuZW51bUZpZWxkcz8uZGVmYXVsdE9wZXJhdG9yIHx8ICgnZXEnKTtcbiAgICAgICAgY29uc3QgYXZhaWxhYmxlT3BzID0gbWVyZ2VkQ29uZmlnLmVudW1GaWVsZHM/LmF2YWlsYWJsZU9wZXJhdG9ycyB8fCBkZWZhdWx0RW51bU9wcztcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZmlsdGVyVHlwZTogJ3NlbGVjdCcsXG4gICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IGRlZmF1bHRPcCxcbiAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogYXZhaWxhYmxlT3BzLFxuICAgICAgICAgICAgcHJlZGVmaW5lZE9wdGlvbnM6IGF0dHJUeXBlLm1hcCh2YWwgPT4gKHtcbiAgICAgICAgICAgICAgICBsYWJlbDogU3RyaW5nKHZhbCksXG4gICAgICAgICAgICAgICAgdmFsdWU6IFN0cmluZyh2YWwpICAvLyBBbHdheXMgY29udmVydCB0byBzdHJpbmcgZm9yIGNvbnNpc3RlbmN5XG4gICAgICAgICAgICB9KSlcbiAgICAgICAgfTtcbiAgICB9XG5cblxuICAgIC8vICoqMy4gRGF0ZS9EYXRldGltZSBmaWVsZHMqKlxuICAgIGlmICgoZmllbGRUeXBlID09PSAnZGF0ZScgfHwgZmllbGRUeXBlID09PSAnZGF0ZXRpbWUnIHx8IChhdHRyVHlwZSA9PT0gJ3N0cmluZycgJiYgKGF0dHJpYnV0ZS5pZC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKCdkYXRlJykgfHwgYXR0cmlidXRlLmlkLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoJ3RpbWUnKSkpKVxuICAgICAgICAmJiBtZXJnZWRDb25maWcuZGF0ZUZpZWxkcz8uZW5hYmxlZCAhPT0gZmFsc2UpIHtcbiAgICAgICAgY29uc3QgZGVmYXVsdERhdGVPcHMgPSBbICdlcScsICduZXEnLCAnZ3QnLCAnZ3RlJywgJ2x0JywgJ2x0ZScsICdiZXR3ZWVuJywgJ2lzRW1wdHknLCAnaXNOdWxsJyBdIGFzIGNvbnN0O1xuICAgICAgICBjb25zdCBvcGVyYXRvcnMgPSBtZXJnZWRDb25maWcuZGF0ZUZpZWxkcz8uZGVmYXVsdE9wZXJhdG9ycyB8fCBkZWZhdWx0RGF0ZU9wcztcblxuICAgICAgICBjb25zdCBmaWx0ZXJDb25maWc6IGFueSA9IHtcbiAgICAgICAgICAgIGZpbHRlclR5cGU6ICdkYXRldGltZScsXG4gICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IG9wZXJhdG9yc1sgMCBdIHx8ICgnZ3RlJyksXG4gICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IG9wZXJhdG9yc1xuICAgICAgICB9O1xuXG4gICAgICAgIC8vIEFkZCBxdWljayBkYXRlIGZpbHRlcnMgaWYgZW5hYmxlZFxuICAgICAgICBpZiAobWVyZ2VkQ29uZmlnLmRhdGVGaWVsZHM/LnF1aWNrRmlsdGVycyAhPT0gZmFsc2UpIHtcbiAgICAgICAgICAgIGZpbHRlckNvbmZpZy5wcmVkZWZpbmVkT3B0aW9ucyA9IFtcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnVG9kYXknLCB2YWx1ZTogJzpzdGFydE9mVG9kYXknIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ1llc3RlcmRheScsIHZhbHVlOiAnOnN0YXJ0T2ZZZXN0ZXJkYXknIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ1RoaXMgV2VlaycsIHZhbHVlOiAnOnN0YXJ0T2ZXZWVrJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdMYXN0IFdlZWsnLCB2YWx1ZTogJzpzdGFydE9mTGFzdFdlZWsnIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ1RoaXMgTW9udGgnLCB2YWx1ZTogJzpzdGFydE9mTW9udGgnIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ0xhc3QgTW9udGgnLCB2YWx1ZTogJzpzdGFydE9mTGFzdE1vbnRoJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdUaGlzIFF1YXJ0ZXInLCB2YWx1ZTogJzpzdGFydE9mUXVhcnRlcicgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnTGFzdCBRdWFydGVyJywgdmFsdWU6ICc6c3RhcnRPZkxhc3RRdWFydGVyJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdUaGlzIFllYXInLCB2YWx1ZTogJzpzdGFydE9mWWVhcicgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnTGFzdCBZZWFyJywgdmFsdWU6ICc6c3RhcnRPZkxhc3RZZWFyJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdMYXN0IDcgRGF5cycsIHZhbHVlOiAnOm5vd01pbnVzN0RheXMnIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ0xhc3QgMzAgRGF5cycsIHZhbHVlOiAnOm5vd01pbnVzMzBEYXlzJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdMYXN0IDkwIERheXMnLCB2YWx1ZTogJzpub3dNaW51czkwRGF5cycgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnQ3VzdG9tIERhdGUnLCB2YWx1ZTogbnVsbCB9ICAvLyBUcmlnZ2VycyBkYXRldGltZS1sb2NhbCBpbnB1dFxuICAgICAgICAgICAgXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBmaWx0ZXJDb25maWc7XG4gICAgfVxuXG4gICAgLy8gKio1LiBOdW1iZXIgZmllbGRzKipcbiAgICBpZiAoYXR0clR5cGUgPT09ICdudW1iZXInICYmIG1lcmdlZENvbmZpZy5udW1iZXJGaWVsZHM/LmVuYWJsZWQgIT09IGZhbHNlKSB7XG4gICAgICAgIGNvbnN0IGRlZmF1bHROdW1iZXJPcHMgPSBbICdlcScsICduZXEnLCAnZ3QnLCAnZ3RlJywgJ2x0JywgJ2x0ZScsICdiZXR3ZWVuJywgJ2lzRW1wdHknLCAnaXNOdWxsJyBdIGFzIGNvbnN0O1xuICAgICAgICBjb25zdCBvcGVyYXRvcnMgPSBtZXJnZWRDb25maWcubnVtYmVyRmllbGRzPy5kZWZhdWx0T3BlcmF0b3JzIHx8IGRlZmF1bHROdW1iZXJPcHM7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBmaWx0ZXJUeXBlOiAnbnVtYmVyJyxcbiAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogb3BlcmF0b3JzWyAwIF0gfHwgKCdlcScpLFxuICAgICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBvcGVyYXRvcnNcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyAqKjQuIFJlbGF0aW9uIGZpZWxkcyAod2l0aG91dCBleHBsaWNpdCBvcHRpb25zKSAtIGF1dG8tZ2VuZXJhdGUgZnJvbSByZWxhdGlvbiBtZXRhZGF0YSoqXG4gICAgaWYgKGF0dHJpYnV0ZS5yZWxhdGlvbiAmJiBtZXJnZWRDb25maWcucmVsYXRpb25GaWVsZHM/LmVuYWJsZWQgIT09IGZhbHNlICYmIGVudGl0eVNlcnZpY2UpIHtcbiAgICAgICAgY29uc3QgcmVsYXRpb25Db25maWc6IFJlbGF0aW9uRW50aXR5T3B0aW9uQ29uZmlnID0geyBlbnRpdHlOYW1lOiBhdHRyaWJ1dGUucmVsYXRpb24uZW50aXR5TmFtZSB9O1xuICAgICAgICBjb25zdCByZXNvbHZlZCA9IHJlc29sdmVSZWxhdGlvbk9wdGlvbkNvbmZpZyhcbiAgICAgICAgICAgIHJlbGF0aW9uQ29uZmlnLFxuICAgICAgICAgICAgYXR0cmlidXRlIGFzIFRJT1NjaGVtYUF0dHJpYnV0ZSAmIHsgcmVsYXRpb246IE5vbk51bGxhYmxlPFRJT1NjaGVtYUF0dHJpYnV0ZVsgJ3JlbGF0aW9uJyBdPiB9LFxuICAgICAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9uc1xuICAgICAgICApO1xuXG4gICAgICAgIGlmIChyZXNvbHZlZCkge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBmaWx0ZXJUeXBlOiAncmVsYXRpb24nLFxuICAgICAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogJ2VxJyBhcyBjb25zdCxcbiAgICAgICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IFsgJ2VxJywgJ25lcScsICdpbkxpc3QnLCAnbm90SW5MaXN0JywgJ2lzRW1wdHknLCAnaXNOdWxsJyBdLFxuICAgICAgICAgICAgICAgIHByZWRlZmluZWRPcHRpb25zOiByZXNvbHZlZFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vICoqNi4gVGV4dCBmaWVsZHMgKGRlZmF1bHQgZmFsbGJhY2spKipcbiAgICBpZiAoYXR0clR5cGUgPT09ICdzdHJpbmcnICYmIG1lcmdlZENvbmZpZy50ZXh0RmllbGRzPy5lbmFibGVkICE9PSBmYWxzZSkge1xuICAgICAgICBjb25zdCBkZWZhdWx0VGV4dE9wcyA9IFsgJ2NvbnRhaW5zJywgJ25vdENvbnRhaW5zJywgJ2VxJywgJ25lcScsICdzdGFydHNXaXRoJywgJ2VuZHNXaXRoJywgJ2xpa2UnLCAnaXNFbXB0eScsICdpc051bGwnIF07XG4gICAgICAgIGNvbnN0IG9wZXJhdG9ycyA9IG1lcmdlZENvbmZpZy50ZXh0RmllbGRzPy5kZWZhdWx0T3BlcmF0b3JzIHx8IGRlZmF1bHRUZXh0T3BzO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZmlsdGVyVHlwZTogJ3RleHQnLFxuICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBvcGVyYXRvcnNbIDAgXSB8fCAoJ2NvbnRhaW5zJyksXG4gICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IG9wZXJhdG9yc1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vIERlYnVnIGxvZ2dpbmdcbiAgICBpZiAobWVyZ2VkQ29uZmlnLmRlYnVnKSB7XG4gICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW0ZpbHRlckF1dG9HZW5dICR7YXR0cmlidXRlLmlkfTogTm8gZmlsdGVyIGNvbmZpZyBnZW5lcmF0ZWQgKHR5cGU6ICR7YXR0clR5cGV9KWApO1xuICAgIH1cblxuICAgIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU0VHTUVOVCBBVVRPLUdFTkVSQVRJT05cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIFNtYXJ0IGljb24gbWFwcGluZyBmb3Igc2VnbWVudCB2YWx1ZXMuXG4gKiBQcm92aWRlcyBzZW5zaWJsZSBkZWZhdWx0cyBmb3IgY29tbW9uIHN0YXR1cy9zdGF0ZSBwYXR0ZXJucy5cbiAqIEljb25zIG1hdGNoIHVpMjQvc3JjL2NvcmUvY29tbW9uL0ljb25zL0ljb25zLnRzeCBuYW1pbmcgY29udmVudGlvbnMuXG4gKi9cbmNvbnN0IERFRkFVTFRfSUNPTl9NQVBQSU5HOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgIC8vIEFjdGl2ZS9JbmFjdGl2ZSBwYXR0ZXJuc1xuICAgICdhY3RpdmUnOiAnQ2hlY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2luYWN0aXZlJzogJ0Nsb3NlQ2lyY2xlT3V0bGluZWQnLFxuICAgICdlbmFibGVkJzogJ0NoZWNrQ2lyY2xlT3V0bGluZWQnLFxuICAgICdkaXNhYmxlZCc6ICdDbG9zZUNpcmNsZU91dGxpbmVkJyxcblxuICAgIC8vIFN0YXR1cyBwYXR0ZXJuc1xuICAgICdwZW5kaW5nJzogJ0Nsb2NrQ2lyY2xlT3V0bGluZWQnLFxuICAgICdpbi1wcm9ncmVzcyc6ICdTeW5jT3V0bGluZWQnLFxuICAgICdpbnByb2dyZXNzJzogJ1N5bmNPdXRsaW5lZCcsXG4gICAgJ2NvbXBsZXRlZCc6ICdDaGVja0NpcmNsZU91dGxpbmVkJyxcbiAgICAnZG9uZSc6ICdDaGVja091dGxpbmVkJyxcbiAgICAnZmluaXNoZWQnOiAnQ2hlY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2NhbmNlbGxlZCc6ICdDbG9zZUNpcmNsZU91dGxpbmVkJyxcbiAgICAnY2FuY2VsZWQnOiAnQ2xvc2VDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2ZhaWxlZCc6ICdDbG9zZUNpcmNsZU91dGxpbmVkJyxcbiAgICAnZXJyb3InOiAnRXhjbGFtYXRpb25DaXJjbGVPdXRsaW5lZCcsXG4gICAgJ3BhdXNlZCc6ICdQYXVzZUNpcmNsZU91dGxpbmVkJyxcblxuICAgIC8vIFNjaGVkdWxpbmcgcGF0dGVybnNcbiAgICAnc2NoZWR1bGVkJzogJ0NhbGVuZGFyT3V0bGluZWQnLFxuICAgICd1cGNvbWluZyc6ICdDYWxlbmRhck91dGxpbmVkJyxcbiAgICAnbGl2ZSc6ICdQbGF5Q2lyY2xlT3V0bGluZWQnLFxuICAgICdkcmFmdCc6ICdGaWxlT3V0bGluZWQnLFxuICAgICdwdWJsaXNoZWQnOiAnQ2hlY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2FyY2hpdmVkJzogJ0ZvbGRlck91dGxpbmVkJyxcblxuICAgIC8vIFByaW9yaXR5IHBhdHRlcm5zXG4gICAgJ2xvdyc6ICdEb3duT3V0bGluZWQnLFxuICAgICdtZWRpdW0nOiAnTWludXNPdXRsaW5lZCcsXG4gICAgJ2hpZ2gnOiAnVXBPdXRsaW5lZCcsXG4gICAgJ2NyaXRpY2FsJzogJ1dhcm5pbmdPdXRsaW5lZCcsXG4gICAgJ3VyZ2VudCc6ICdGaXJlT3V0bGluZWQnLFxuXG4gICAgLy8gQXBwcm92YWwgcGF0dGVybnNcbiAgICAnYXBwcm92ZWQnOiAnQ2hlY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ3JlamVjdGVkJzogJ0Nsb3NlQ2lyY2xlT3V0bGluZWQnLFxuICAgICdyZXZpZXcnOiAnRXllT3V0bGluZWQnLFxuXG4gICAgLy8gQm9vbGVhbiBUcnVlL0ZhbHNlXG4gICAgJ3RydWUnOiAnQ2hlY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2ZhbHNlJzogJ0Nsb3NlQ2lyY2xlT3V0bGluZWQnXG59O1xuXG4vKipcbiAqIEludGVsbGlnZW50bHkgZXh0cmFjdCBib29sZWFuIGxhYmVscyBmcm9tIGZpZWxkIG5hbWUgcGF0dGVybnMuXG4gKiBTdXBwb3J0cyBjb21tb24gYm9vbGVhbiBwcmVmaXhlcyBsaWtlIGlzL2hhcy9jYW4vc2hvdWxkL3dpbGwvZXRjLlxuICogXG4gKiBAZXhhbXBsZVxuICogLSBpc0FjdGl2ZSDihpIgXCJBY3RpdmVcIiAvIFwiSW5hY3RpdmVcIlxuICogLSBoYXNQZXJtaXNzaW9uIOKGkiBcIkhhcyBQZXJtaXNzaW9uXCIgLyBcIk5vIFBlcm1pc3Npb25cIlxuICogLSBjYW5FZGl0IOKGkiBcIkNhbiBFZGl0XCIgLyBcIkNhbm5vdCBFZGl0XCJcbiAqIC0gaXNMaXZlIOKGkiBcIkxpdmVcIiAvIFwiTm90IExpdmVcIlxuICogLSBzaG91bGROb3RpZnkg4oaSIFwiU2hvdWxkIE5vdGlmeVwiIC8gXCJTaG91bGQgTm90IE5vdGlmeVwiXG4gKi9cbmZ1bmN0aW9uIGV4dHJhY3RCb29sZWFuTGFiZWxzRnJvbUZpZWxkTmFtZShmaWVsZE5hbWU6IHN0cmluZyk6IHsgdHJ1ZUxhYmVsOiBzdHJpbmc7IGZhbHNlTGFiZWw6IHN0cmluZyB9IHwgbnVsbCB7XG4gICAgLy8gQ29tbW9uIGJvb2xlYW4gcHJlZml4ZXMgd2l0aCB0aGVpciBuZWdhdGl2ZSBmb3Jtc1xuICAgIGNvbnN0IHBhdHRlcm5zID0gW1xuICAgICAgICAvLyBQYXR0ZXJuOiBpcyArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL15pcyhbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IHRvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSksXG4gICAgICAgICAgICBnZXRGYWxzZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBiYXNlID0gdG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKTtcbiAgICAgICAgICAgICAgICAvLyBTcGVjaWFsIGNhc2VzIGZvciBiZXR0ZXIgbmVnYXRpb25cbiAgICAgICAgICAgICAgICBpZiAoYmFzZS50b0xvd2VyQ2FzZSgpID09PSAnYWN0aXZlJykgcmV0dXJuICdJbmFjdGl2ZSc7XG4gICAgICAgICAgICAgICAgaWYgKGJhc2UudG9Mb3dlckNhc2UoKSA9PT0gJ2VuYWJsZWQnKSByZXR1cm4gJ0Rpc2FibGVkJztcbiAgICAgICAgICAgICAgICBpZiAoYmFzZS50b0xvd2VyQ2FzZSgpID09PSAndmlzaWJsZScpIHJldHVybiAnSGlkZGVuJztcbiAgICAgICAgICAgICAgICBpZiAoYmFzZS50b0xvd2VyQ2FzZSgpID09PSAncHVibGljJykgcmV0dXJuICdQcml2YXRlJztcbiAgICAgICAgICAgICAgICBpZiAoYmFzZS50b0xvd2VyQ2FzZSgpID09PSAnYXZhaWxhYmxlJykgcmV0dXJuICdVbmF2YWlsYWJsZSc7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGBOb3QgJHtiYXNlfWA7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBhdHRlcm46IGhhcyArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL15oYXMoW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgSGFzICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gLFxuICAgICAgICAgICAgZ2V0RmFsc2VMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgTm8gJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWBcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGF0dGVybjogY2FuICsgWFhYXG4gICAgICAgIHtcbiAgICAgICAgICAgIHJlZ2V4OiAvXmNhbihbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBDYW4gJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWAsXG4gICAgICAgICAgICBnZXRGYWxzZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBDYW5ub3QgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWBcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGF0dGVybjogc2hvdWxkICsgWFhYXG4gICAgICAgIHtcbiAgICAgICAgICAgIHJlZ2V4OiAvXnNob3VsZChbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBTaG91bGQgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWAsXG4gICAgICAgICAgICBnZXRGYWxzZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBTaG91bGQgTm90ICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBhdHRlcm46IHdpbGwgKyBYWFhcbiAgICAgICAge1xuICAgICAgICAgICAgcmVnZXg6IC9ed2lsbChbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBXaWxsICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gLFxuICAgICAgICAgICAgZ2V0RmFsc2VMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgV2lsbCBOb3QgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWBcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGF0dGVybjogYWxsb3dzICsgWFhYXG4gICAgICAgIHtcbiAgICAgICAgICAgIHJlZ2V4OiAvXmFsbG93cyhbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBBbGxvd3MgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWAsXG4gICAgICAgICAgICBnZXRGYWxzZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBEb2VzIE5vdCBBbGxvdyAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSl9YFxuICAgICAgICB9LFxuICAgICAgICAvLyBQYXR0ZXJuOiBuZWVkcyArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL15uZWVkcyhbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBOZWVkcyAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSl9YCxcbiAgICAgICAgICAgIGdldEZhbHNlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYERvZXMgTm90IE5lZWQgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWBcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGF0dGVybjogcmVxdWlyZXMgKyBYWFhcbiAgICAgICAge1xuICAgICAgICAgICAgcmVnZXg6IC9ecmVxdWlyZXMoW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgUmVxdWlyZXMgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWAsXG4gICAgICAgICAgICBnZXRGYWxzZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBEb2VzIE5vdCBSZXF1aXJlICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gXG4gICAgICAgIH1cbiAgICBdO1xuXG4gICAgZm9yIChjb25zdCBwYXR0ZXJuIG9mIHBhdHRlcm5zKSB7XG4gICAgICAgIGNvbnN0IG1hdGNoID0gZmllbGROYW1lLm1hdGNoKHBhdHRlcm4ucmVnZXgpO1xuICAgICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdHJ1ZUxhYmVsOiBwYXR0ZXJuLmdldFRydWVMYWJlbChtYXRjaCksXG4gICAgICAgICAgICAgICAgZmFsc2VMYWJlbDogcGF0dGVybi5nZXRGYWxzZUxhYmVsKG1hdGNoKVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIEdldCB0aGUgbnVtYmVyIG9mIG9wdGlvbnMgZm9yIGEgZmllbGQuXG4gKi9cbmZ1bmN0aW9uIGdldEZpZWxkT3B0aW9uQ291bnQoZmllbGQ6IFRJT1NjaGVtYUF0dHJpYnV0ZSk6IG51bWJlciB7XG4gICAgLy8gMS4gRW51bSB0eXBlIGFycmF5XG4gICAgaWYgKEFycmF5LmlzQXJyYXkoZmllbGQudHlwZSkpIHtcbiAgICAgICAgcmV0dXJuIGZpZWxkLnR5cGUubGVuZ3RoO1xuICAgIH1cblxuICAgIC8vIDIuIEJvb2xlYW4gZmllbGRcbiAgICBpZiAoZmllbGQudHlwZSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgIHJldHVybiAyO1xuICAgIH1cblxuICAgIC8vIDMuIFNlbGVjdC9yYWRpby9jaGVja2JveCBmaWVsZCB3aXRoIGlubGluZSBvcHRpb25zXG4gICAgY29uc3QgZmllbGRUeXBlID0gZmllbGQuZmllbGRUeXBlO1xuICAgIGlmIChmaWVsZFR5cGUgPT09ICdzZWxlY3QnIHx8IGZpZWxkVHlwZSA9PT0gJ3JhZGlvJyB8fCBmaWVsZFR5cGUgPT09ICdjaGVja2JveCcgfHwgZmllbGRUeXBlID09PSAnbXVsdGktc2VsZWN0Jykge1xuICAgICAgICBjb25zdCBvcHRpb25zID0gKGZpZWxkIGFzIGFueSkub3B0aW9ucztcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkob3B0aW9ucykpIHtcbiAgICAgICAgICAgIHJldHVybiBvcHRpb25zLmxlbmd0aDtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiAwO1xufVxuXG4vKipcbiAqIENoZWNrIGlmIGEgZmllbGQgaXMgdmlhYmxlIGZvciBzZWdtZW50IGdlbmVyYXRpb24uXG4gKiBTdXBwb3J0czpcbiAqIC0gRW51bSB0eXBlczogdHlwZTogWyd2YWx1ZTEnLCAndmFsdWUyJ11cbiAqIC0gQm9vbGVhbiB0eXBlczogdHlwZTogJ2Jvb2xlYW4nXG4gKiAtIFNlbGVjdC9yYWRpby9jaGVja2JveCBmaWVsZHMgd2l0aCBvcHRpb25zOiBmaWVsZFR5cGU6ICdzZWxlY3QnICsgb3B0aW9uczogWy4uLl1cbiAqIFxuICogU1RSSUNUTFkgZW5mb3JjZXM6IG1pblZhbHVlcyA8PSBvcHRpb25Db3VudCA8PSBtYXhTZWdtZW50c1Blckdyb3VwXG4gKi9cbmZ1bmN0aW9uIGlzVmlhYmxlU2VnbWVudEZpZWxkKFxuICAgIGZpZWxkOiBUSU9TY2hlbWFBdHRyaWJ1dGUsXG4gICAgY29uZmlnOiBSZXF1aXJlZDxJU2VnbWVudEF1dG9HZW5lcmF0aW9uQ29uZmlnPiAmIHsgbWF4U2VnbWVudHNQZXJHcm91cD86IG51bWJlciB9XG4pOiBib29sZWFuIHtcbiAgICBjb25zdCBtYXhWYWx1ZXMgPSBjb25maWcubWF4U2VnbWVudHNQZXJHcm91cCB8fCAxMDtcbiAgICBjb25zdCBvcHRpb25Db3VudCA9IGdldEZpZWxkT3B0aW9uQ291bnQoZmllbGQpO1xuXG4gICAgLy8gTXVzdCBoYXZlIG9wdGlvbnMgQU5EIGJlIHdpdGhpbiBib3VuZHNcbiAgICBpZiAob3B0aW9uQ291bnQgPT09IDApIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIC8vIFNUUklDVDogUmVqZWN0IGlmIG91dHNpZGUgYm91bmRzXG4gICAgcmV0dXJuIG9wdGlvbkNvdW50ID49IGNvbmZpZy5taW5WYWx1ZXMgJiYgb3B0aW9uQ291bnQgPD0gbWF4VmFsdWVzO1xufVxuXG4vKipcbiAqIEludGVsbGlnZW50bHkgZGV0ZWN0IHRoZSBiZXN0IGZpZWxkKHMpIGZvciBnZW5lcmF0aW5nIHNlZ21lbnRzLlxuICogUmV0dXJucyBtdWx0aXBsZSBmaWVsZHMgaWYgbWF4U2VnbWVudEdyb3VwcyA+IDEuXG4gKiBcbiAqIFByaW9yaXR5OlxuICogMS4gRXhwbGljaXQgc2VnbWVudEZpZWxkcyAoZW50aXR5IGNvbmZpZykg4oaSIFVzZSB0aG9zZSBmaWVsZHNcbiAqIDIuIGluY2x1ZGVGaWVsZHMgZmlsdGVyIChlbnRpdHkgY29uZmlnKSDihpIgT25seSBjb25zaWRlciB0aGVzZVxuICogMy4gZXhjbHVkZUZpZWxkcyBmaWx0ZXIgKGVudGl0eSBjb25maWcpIOKGkiBTa2lwIHRoZXNlXG4gKiA0LiBwcmVmZXJyZWRGaWVsZHMgKGdsb2JhbC9lbnRpdHkgY29uZmlnKSDihpIgVHJ5IHRoZXNlIGZpcnN0XG4gKiA1LiBTY29yaW5nIGFsZ29yaXRobSDihpIgU2NvcmUgYWxsIGNhbmRpZGF0ZXMgYW5kIHBpY2sgdG9wIE5cbiAqL1xuZnVuY3Rpb24gZGV0ZWN0U2VnbWVudEZpZWxkczxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPHN0cmluZywgc3RyaW5nLCBzdHJpbmc+PihcbiAgICBwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+LFxuICAgIGdsb2JhbENvbmZpZz86IElTZWdtZW50QXV0b0dlbmVyYXRpb25Db25maWcsXG4gICAgZW50aXR5Q29uZmlnPzogTm9uTnVsbGFibGU8UmV0dXJuVHlwZTx0eXBlb2YgQmFzZUVudGl0eVNlcnZpY2UucHJvdG90eXBlLmdldEVudGl0eVNjaGVtYT5bICdtb2RlbCcgXVsgJ21ldGFkYXRhJyBdPlsgJ3RhYmxlVUknIF1cbik6IEFycmF5PHsgZmllbGQ6IFRJT1NjaGVtYUF0dHJpYnV0ZTsgc2NvcmU6IG51bWJlcjsgcmVhc29uOiBzdHJpbmcgfT4ge1xuICAgIGNvbnN0IHNlZ21lbnRDb25maWcgPSBlbnRpdHlDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbjtcblxuICAgIC8vIE1lcmdlIGNvbmZpZ3MgKGVudGl0eSA+IGdsb2JhbCA+IGRlZmF1bHRzKVxuICAgIGNvbnN0IG1lcmdlZENvbmZpZzogUmVxdWlyZWQ8SVNlZ21lbnRBdXRvR2VuZXJhdGlvbkNvbmZpZz4gJiB7IG1heFNlZ21lbnRHcm91cHM6IG51bWJlcjsgbWF4U2VnbWVudHNQZXJHcm91cDogbnVtYmVyIH0gPSB7XG4gICAgICAgIGVuYWJsZWQ6IHNlZ21lbnRDb25maWc/LmVuYWJsZWQgPz8gZ2xvYmFsQ29uZmlnPy5lbmFibGVkID8/IHRydWUsXG4gICAgICAgIHByZWZlcnJlZEZpZWxkczogc2VnbWVudENvbmZpZz8ucHJlZmVycmVkRmllbGRzIHx8IGdsb2JhbENvbmZpZz8ucHJlZmVycmVkRmllbGRzIHx8IFsgJ3N0YXR1cycsICdzdGF0ZScsICd0eXBlJywgJ2NhdGVnb3J5JywgJ3ByaW9yaXR5JyBdLFxuICAgICAgICBtYXhTZWdtZW50R3JvdXBzOiBzZWdtZW50Q29uZmlnPy5tYXhTZWdtZW50R3JvdXBzID8/IGdsb2JhbENvbmZpZz8ubWF4U2VnbWVudEdyb3VwcyA/PyAyLFxuICAgICAgICBtYXhTZWdtZW50c1Blckdyb3VwOiBzZWdtZW50Q29uZmlnPy5tYXhTZWdtZW50c1Blckdyb3VwID8/IGdsb2JhbENvbmZpZz8ubWF4U2VnbWVudHNQZXJHcm91cCA/PyAxMCxcbiAgICAgICAgbWluVmFsdWVzOiBzZWdtZW50Q29uZmlnPy5taW5WYWx1ZXMgPz8gZ2xvYmFsQ29uZmlnPy5taW5WYWx1ZXMgPz8gMixcbiAgICAgICAgaWNvbk1hcHBpbmc6IHsgLi4uREVGQVVMVF9JQ09OX01BUFBJTkcsIC4uLmdsb2JhbENvbmZpZz8uaWNvbk1hcHBpbmcsIC4uLnNlZ21lbnRDb25maWc/Lmljb25NYXBwaW5nIH0sXG4gICAgICAgIGJvb2xlYW5MYWJlbFBhdHRlcm5zOiBzZWdtZW50Q29uZmlnPy5ib29sZWFuTGFiZWxQYXR0ZXJucyB8fCBnbG9iYWxDb25maWc/LmJvb2xlYW5MYWJlbFBhdHRlcm5zIHx8IFtdLFxuICAgICAgICBkZWZhdWx0Qm9vbGVhbkxhYmVsczogc2VnbWVudENvbmZpZz8uZGVmYXVsdEJvb2xlYW5MYWJlbHMgfHwgZ2xvYmFsQ29uZmlnPy5kZWZhdWx0Qm9vbGVhbkxhYmVscyB8fCB7IHRydWU6ICdZZXMnLCBmYWxzZTogJ05vJyB9LFxuICAgICAgICBpbmNsdWRlQWxsU2VnbWVudDogc2VnbWVudENvbmZpZz8uaW5jbHVkZUFsbFNlZ21lbnQgPz8gZ2xvYmFsQ29uZmlnPy5pbmNsdWRlQWxsU2VnbWVudCA/PyB0cnVlLFxuICAgICAgICBkZWJ1Zzogc2VnbWVudENvbmZpZz8uZGVidWcgPz8gZ2xvYmFsQ29uZmlnPy5kZWJ1ZyA/PyBmYWxzZVxuICAgIH07XG5cbiAgICBpZiAoIW1lcmdlZENvbmZpZy5lbmFibGVkKSB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICAvLyA9PT0gUFJJT1JJVFkgMTogRXhwbGljaXQgc2VnbWVudCBmaWVsZHMgPT09XG4gICAgY29uc3QgZXhwbGljaXRGaWVsZHMgPSBzZWdtZW50Q29uZmlnPy5zZWdtZW50RmllbGRzIHx8IHNlZ21lbnRDb25maWc/LnNlZ21lbnRGaWVsZDtcbiAgICBpZiAoZXhwbGljaXRGaWVsZHMpIHtcbiAgICAgICAgY29uc3QgZmllbGROYW1lcyA9IHR5cGVvZiBleHBsaWNpdEZpZWxkcyA9PT0gJ3N0cmluZycgPyBbIGV4cGxpY2l0RmllbGRzIF0gOiBleHBsaWNpdEZpZWxkcztcbiAgICAgICAgY29uc3QgcmVzdWx0czogQXJyYXk8eyBmaWVsZDogVElPU2NoZW1hQXR0cmlidXRlOyBzY29yZTogbnVtYmVyOyByZWFzb246IHN0cmluZyB9PiA9IFtdO1xuXG4gICAgICAgIGZvciAoY29uc3QgZmllbGROYW1lIG9mIGZpZWxkTmFtZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGZpZWxkID0gQXJyYXkuZnJvbShwcm9wZXJ0aWVzLnZhbHVlcygpKS5maW5kKHAgPT4gcC5pZCA9PT0gZmllbGROYW1lKTtcbiAgICAgICAgICAgIGlmIChmaWVsZCkge1xuICAgICAgICAgICAgICAgIHJlc3VsdHMucHVzaCh7IGZpZWxkLCBzY29yZTogMTAwMCwgcmVhc29uOiAnZXhwbGljaXQgY29uZmlndXJhdGlvbicgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocmVzdWx0cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0cy5zbGljZSgwLCBtZXJnZWRDb25maWcubWF4U2VnbWVudEdyb3Vwcyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyA9PT0gRmlsdGVyIHByb3BlcnRpZXMgYmFzZWQgb24gaW5jbHVkZS9leGNsdWRlID09PVxuICAgIGxldCBjYW5kaWRhdGVQcm9wZXJ0aWVzID0gQXJyYXkuZnJvbShwcm9wZXJ0aWVzLnZhbHVlcygpKTtcblxuICAgIC8vIEFwcGx5IGluY2x1ZGVGaWVsZHMgZmlsdGVyIChpZiBwcm92aWRlZCwgT05MWSBjb25zaWRlciB0aGVzZSlcbiAgICBpZiAoc2VnbWVudENvbmZpZz8uaW5jbHVkZUZpZWxkcyAmJiBzZWdtZW50Q29uZmlnLmluY2x1ZGVGaWVsZHMubGVuZ3RoID4gMCkge1xuICAgICAgICBjYW5kaWRhdGVQcm9wZXJ0aWVzID0gY2FuZGlkYXRlUHJvcGVydGllcy5maWx0ZXIocCA9PlxuICAgICAgICAgICAgc2VnbWVudENvbmZpZy5pbmNsdWRlRmllbGRzIS5pbmNsdWRlcyhwLmlkKVxuICAgICAgICApO1xuICAgIH1cblxuICAgIC8vIEFwcGx5IGV4Y2x1ZGVGaWVsZHMgZmlsdGVyXG4gICAgaWYgKHNlZ21lbnRDb25maWc/LmV4Y2x1ZGVGaWVsZHMgJiYgc2VnbWVudENvbmZpZy5leGNsdWRlRmllbGRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY2FuZGlkYXRlUHJvcGVydGllcyA9IGNhbmRpZGF0ZVByb3BlcnRpZXMuZmlsdGVyKHAgPT5cbiAgICAgICAgICAgICFzZWdtZW50Q29uZmlnLmV4Y2x1ZGVGaWVsZHMhLmluY2x1ZGVzKHAuaWQpXG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gPT09IFBSSU9SSVRZIDI6IFByZWZlcnJlZCBmaWVsZHMgPT09XG4gICAgY29uc3QgcHJlZmVycmVkRmllbGRzID0gbWVyZ2VkQ29uZmlnLnByZWZlcnJlZEZpZWxkcztcbiAgICBjb25zdCBwcmVmZXJyZWRNYXRjaGVzOiBBcnJheTx7IGZpZWxkOiBUSU9TY2hlbWFBdHRyaWJ1dGU7IHNjb3JlOiBudW1iZXI7IHJlYXNvbjogc3RyaW5nIH0+ID0gW107XG5cbiAgICBmb3IgKGNvbnN0IHByZWZlcnJlZE5hbWUgb2YgcHJlZmVycmVkRmllbGRzKSB7XG4gICAgICAgIGNvbnN0IGZpZWxkID0gY2FuZGlkYXRlUHJvcGVydGllcy5maW5kKHAgPT4gcC5pZCA9PT0gcHJlZmVycmVkTmFtZSk7XG4gICAgICAgIGlmIChmaWVsZCAmJiBpc1ZpYWJsZVNlZ21lbnRGaWVsZChmaWVsZCwgbWVyZ2VkQ29uZmlnKSkge1xuICAgICAgICAgICAgcHJlZmVycmVkTWF0Y2hlcy5wdXNoKHsgZmllbGQsIHNjb3JlOiA5MDAsIHJlYXNvbjogYHByZWZlcnJlZCBmaWVsZDogJHtwcmVmZXJyZWROYW1lfWAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBJZiB3ZSBoYXZlIGVub3VnaCBwcmVmZXJyZWQgbWF0Y2hlcywgcmV0dXJuIHRoZW1cbiAgICBpZiAocHJlZmVycmVkTWF0Y2hlcy5sZW5ndGggPj0gbWVyZ2VkQ29uZmlnLm1heFNlZ21lbnRHcm91cHMpIHtcbiAgICAgICAgcmV0dXJuIHByZWZlcnJlZE1hdGNoZXMuc2xpY2UoMCwgbWVyZ2VkQ29uZmlnLm1heFNlZ21lbnRHcm91cHMpO1xuICAgIH1cblxuICAgIC8vID09PSBQUklPUklUWSAzOiBTY29yaW5nIGFsZ29yaXRobSA9PT1cbiAgICBjb25zdCBjYW5kaWRhdGVzOiBBcnJheTx7IGZpZWxkOiBUSU9TY2hlbWFBdHRyaWJ1dGU7IHNjb3JlOiBudW1iZXI7IHJlYXNvbjogc3RyaW5nOyBvcHRpb25Db3VudDogbnVtYmVyIH0+ID0gW107XG5cbiAgICAvLyBBZGQgcHJlZmVycmVkTWF0Y2hlcyB3aXRoIHRoZWlyIG9wdGlvbiBjb3VudHNcbiAgICBmb3IgKGNvbnN0IHBtIG9mIHByZWZlcnJlZE1hdGNoZXMpIHtcbiAgICAgICAgY29uc3Qgb3B0aW9uQ291bnQgPSBnZXRGaWVsZE9wdGlvbkNvdW50KHBtLmZpZWxkKTtcbiAgICAgICAgY2FuZGlkYXRlcy5wdXNoKHsgLi4ucG0sIG9wdGlvbkNvdW50IH0pO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgcHJvcCBvZiBjYW5kaWRhdGVQcm9wZXJ0aWVzKSB7XG4gICAgICAgIC8vIFNraXAgaWYgYWxyZWFkeSBpbiBwcmVmZXJyZWRNYXRjaGVzXG4gICAgICAgIGlmIChwcmVmZXJyZWRNYXRjaGVzLnNvbWUocG0gPT4gcG0uZmllbGQuaWQgPT09IHByb3AuaWQpKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNraXAgaWYgbm90IHZpYWJsZSAodGhpcyBmaWx0ZXJzIG91dCBmaWVsZHMgd2l0aCB0b28gbWFueSBvcHRpb25zKVxuICAgICAgICBpZiAoIWlzVmlhYmxlU2VnbWVudEZpZWxkKHByb3AsIG1lcmdlZENvbmZpZykpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IHNjb3JlID0gMDtcbiAgICAgICAgY29uc3QgcmVhc29uczogc3RyaW5nW10gPSBbXTtcbiAgICAgICAgY29uc3Qgb3B0aW9uQ291bnQgPSBnZXRGaWVsZE9wdGlvbkNvdW50KHByb3ApO1xuXG4gICAgICAgIC8vICoqU2NvcmUgMTogRmllbGQgbmFtZSBtYXRjaCoqIChwYXJ0aWFsIG1hdGNoIHdpdGggcHJlZmVycmVkIG5hbWVzKVxuICAgICAgICBmb3IgKGNvbnN0IHByZWZlcnJlZCBvZiBwcmVmZXJyZWRGaWVsZHMpIHtcbiAgICAgICAgICAgIGlmIChwcm9wLmlkLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocHJlZmVycmVkLnRvTG93ZXJDYXNlKCkpKSB7XG4gICAgICAgICAgICAgICAgc2NvcmUgKz0gNTA7XG4gICAgICAgICAgICAgICAgcmVhc29ucy5wdXNoKGBuYW1lIGNvbnRhaW5zIFwiJHtwcmVmZXJyZWR9XCJgKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vICoqU2NvcmUgMjogUHJlZmVyIGZld2VyIG9wdGlvbnMgKGludmVyc2Ugc2NvcmluZykqKlxuICAgICAgICAvLyBGaWVsZHMgd2l0aCBmZXdlciBvcHRpb25zIGdldCBoaWdoZXIgc2NvcmVzXG4gICAgICAgIGNvbnN0IG1pblZhbHVlcyA9IG1lcmdlZENvbmZpZy5taW5WYWx1ZXM7XG4gICAgICAgIGNvbnN0IG1heFZhbHVlcyA9IG1lcmdlZENvbmZpZy5tYXhTZWdtZW50c1Blckdyb3VwO1xuXG4gICAgICAgIGlmIChvcHRpb25Db3VudCA+PSBtaW5WYWx1ZXMgJiYgb3B0aW9uQ291bnQgPD0gbWF4VmFsdWVzKSB7XG4gICAgICAgICAgICAvLyBTY29yZSBpbnZlcnNlbHkgcHJvcG9ydGlvbmFsIHRvIG9wdGlvbiBjb3VudFxuICAgICAgICAgICAgLy8gMiBvcHRpb25zID0gKzQwLCA1IG9wdGlvbnMgPSArMjUsIDEwIG9wdGlvbnMgPSArMTBcbiAgICAgICAgICAgIGNvbnN0IG9wdGlvblNjb3JlID0gTWF0aC5tYXgoMTAsIDQwIC0gKG9wdGlvbkNvdW50IC0gbWluVmFsdWVzKSAqIDMpO1xuICAgICAgICAgICAgc2NvcmUgKz0gb3B0aW9uU2NvcmU7XG4gICAgICAgICAgICByZWFzb25zLnB1c2goYCR7b3B0aW9uQ291bnR9IG9wdGlvbnNgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vICoqU2NvcmUgMzogQm9vbGVhbiBmaWVsZCBnZXRzIGhpZ2ggcHJpb3JpdHkgKG9ubHkgMiBvcHRpb25zKSoqXG4gICAgICAgIGlmIChwcm9wLnR5cGUgPT09ICdib29sZWFuJykge1xuICAgICAgICAgICAgc2NvcmUgKz0gNTsgIC8vIFNtYWxsIGJvbnVzIHNpbmNlIG9wdGlvbiBjb3VudCBhbHJlYWR5IGZhY3RvcnMgaW5cbiAgICAgICAgICAgIHJlYXNvbnMucHVzaCgnYm9vbGVhbiBmaWVsZCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gKipTY29yZSA0OiBOYW1lIHBvc2l0aW9uIChlYXJsaWVyID0gc2xpZ2h0bHkgaGlnaGVyIHByaW9yaXR5KSoqXG4gICAgICAgIGNvbnN0IGZpZWxkSW5kZXggPSBjYW5kaWRhdGVQcm9wZXJ0aWVzLmluZGV4T2YocHJvcCk7XG4gICAgICAgIHNjb3JlIC09IE1hdGgubWluKGZpZWxkSW5kZXgsIDUpOyAgLy8gQ2FwIHBlbmFsdHkgYXQgNVxuXG4gICAgICAgIGNhbmRpZGF0ZXMucHVzaCh7XG4gICAgICAgICAgICBmaWVsZDogcHJvcCxcbiAgICAgICAgICAgIHNjb3JlLFxuICAgICAgICAgICAgcmVhc29uOiByZWFzb25zLmpvaW4oJywgJyksXG4gICAgICAgICAgICBvcHRpb25Db3VudFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBTb3J0IGJ5OiAxKSBzY29yZSAoaGlnaGVzdCBmaXJzdCksIDIpIG9wdGlvbiBjb3VudCAobG93ZXN0IGZpcnN0KVxuICAgIGNhbmRpZGF0ZXMuc29ydCgoYSwgYikgPT4ge1xuICAgICAgICBpZiAoYi5zY29yZSAhPT0gYS5zY29yZSkge1xuICAgICAgICAgICAgcmV0dXJuIGIuc2NvcmUgLSBhLnNjb3JlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBhLm9wdGlvbkNvdW50IC0gYi5vcHRpb25Db3VudDsgIC8vIFByZWZlciBmZXdlciBvcHRpb25zXG4gICAgfSk7XG5cbiAgICBjb25zdCB0b3BOUmVzdWx0cyA9IGNhbmRpZGF0ZXMuc2xpY2UoMCwgbWVyZ2VkQ29uZmlnLm1heFNlZ21lbnRHcm91cHMpO1xuXG4gICAgaWYgKHRvcE5SZXN1bHRzLmxlbmd0aCA+IDAgJiYgbWVyZ2VkQ29uZmlnLmRlYnVnKSB7XG4gICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW1NlZ21lbnREZXRlY3Rpb25dIFNlbGVjdGVkICR7dG9wTlJlc3VsdHMubGVuZ3RofSBmaWVsZChzKTpgLCB0b3BOUmVzdWx0cy5tYXAoYyA9PiAoe1xuICAgICAgICAgICAgZmllbGQ6IGMuZmllbGQuaWQsXG4gICAgICAgICAgICBzY29yZTogYy5zY29yZSxcbiAgICAgICAgICAgIG9wdGlvbkNvdW50OiBjLm9wdGlvbkNvdW50LFxuICAgICAgICAgICAgcmVhc29uOiBjLnJlYXNvblxuICAgICAgICB9KSkpO1xuICAgIH1cblxuICAgIHJldHVybiB0b3BOUmVzdWx0cztcbn1cblxuLyoqXG4gKiBBdXRvLWdlbmVyYXRlIGZpbHRlciBzZWdtZW50cyBiYXNlZCBvbiBlbnRpdHkgYXR0cmlidXRlcyB1c2luZyBzbWFydCBkZXRlY3Rpb24uXG4gKiBcbiAqIEFsZ29yaXRobTpcbiAqIDEuIElmIGN1c3RvbSBzZWdtZW50cyBwcm92aWRlZCDihpIgdXNlIHRoZW0gKGhpZ2hlc3QgcHJpb3JpdHkpXG4gKiAyLiBJZiBlbnRpdHkgcmVxdWlyZXMgbWFudWFsIHNlZ21lbnRzIOKGkiBza2lwIGF1dG8tZ2VuZXJhdGlvblxuICogMy4gRGV0ZWN0IGJlc3QgZmllbGQgdXNpbmcgc2NvcmluZyBhbGdvcml0aG1cbiAqIDQuIEdlbmVyYXRlIHNlZ21lbnRzIGZyb20gZGV0ZWN0ZWQgZmllbGQgd2l0aCBzbWFydCBpY29uc1xuICovXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVTZWdtZW50czxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPHN0cmluZywgc3RyaW5nLCBzdHJpbmc+PihcbiAgICBwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+LFxuICAgIGVudGl0eVNlcnZpY2U/OiBCYXNlRW50aXR5U2VydmljZTxTPixcbiAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbICd1aUNvbmZpZ0dlbk9wdGlvbnMnIF0sXG4gICAgY3VzdG9tU2VnbWVudHM/OiBSZWFkb25seUFycmF5PElGaWx0ZXJTZWdtZW50IHwgSUZpbHRlclNlZ21lbnRHcm91cD4gfCBBcnJheTxJRmlsdGVyU2VnbWVudCB8IElGaWx0ZXJTZWdtZW50R3JvdXA+XG4pOiBSZWFkb25seUFycmF5PElGaWx0ZXJTZWdtZW50IHwgSUZpbHRlclNlZ21lbnRHcm91cD4gfCBBcnJheTxJRmlsdGVyU2VnbWVudCB8IElGaWx0ZXJTZWdtZW50R3JvdXA+IHwgdW5kZWZpbmVkIHtcbiAgICAvLyAxLiBJZiBjdXN0b20gc2VnbWVudHMgcHJvdmlkZWQsIHVzZSB0aG9zZSAoaGlnaGVzdCBwcmlvcml0eSlcbiAgICBpZiAoY3VzdG9tU2VnbWVudHMgJiYgY3VzdG9tU2VnbWVudHMubGVuZ3RoID4gMCkge1xuICAgICAgICByZXR1cm4gY3VzdG9tU2VnbWVudHM7XG4gICAgfVxuXG4gICAgLy8gR2V0IGNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCBnbG9iYWxTZWdtZW50Q29uZmlnID0gZ2xvYmFsVUlDb25maWdPcHRpb25zPy50YWJsZVVJPy5zZWdtZW50QXV0b0dlbmVyYXRpb247XG4gICAgY29uc3QgZW50aXR5TWV0YWRhdGEgPSBlbnRpdHlTZXJ2aWNlPy5nZXRFbnRpdHlTY2hlbWE/LigpLm1vZGVsPy5tZXRhZGF0YTtcbiAgICBjb25zdCBlbnRpdHlTZWdtZW50Q29uZmlnID0gZW50aXR5TWV0YWRhdGE/LnRhYmxlVUk7XG5cbiAgICAvLyAyLiBJZiBlbnRpdHkgcmVxdWlyZXMgbWFudWFsIHNlZ21lbnRzLCBza2lwIGF1dG8tZ2VuZXJhdGlvblxuICAgIGlmIChlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LnJlcXVpcmVNYW51YWwpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyAzLiBEZXRlY3QgYmVzdCBzZWdtZW50IGZpZWxkcyAocmV0dXJucyBhcnJheSBub3cpXG4gICAgY29uc3QgZGV0ZWN0ZWRGaWVsZHMgPSBkZXRlY3RTZWdtZW50RmllbGRzKHByb3BlcnRpZXMsIGdsb2JhbFNlZ21lbnRDb25maWcsIGVudGl0eVNlZ21lbnRDb25maWcpO1xuXG4gICAgaWYgKGRldGVjdGVkRmllbGRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAvLyBObyBzdWl0YWJsZSBmaWVsZHMgZm91bmRcbiAgICAgICAgaWYgKGdsb2JhbFNlZ21lbnRDb25maWc/LmRlYnVnIHx8IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uZGVidWcpIHtcbiAgICAgICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW1NlZ21lbnRHZW5lcmF0aW9uXSBObyBzdWl0YWJsZSBmaWVsZHMgZGV0ZWN0ZWQgZm9yIHNlZ21lbnRzYCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyBHZXQgbWVyZ2VkIGNvbmZpZyBmb3IgdGhpcyBlbnRpdHlcbiAgICBjb25zdCBtZXJnZWRDb25maWc6IFJlcXVpcmVkPElTZWdtZW50QXV0b0dlbmVyYXRpb25Db25maWc+ICYgeyBtYXhTZWdtZW50R3JvdXBzOiBudW1iZXI7IG1heFNlZ21lbnRzUGVyR3JvdXA6IG51bWJlciB9ID0ge1xuICAgICAgICBlbmFibGVkOiBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmVuYWJsZWQgPz8gZ2xvYmFsU2VnbWVudENvbmZpZz8uZW5hYmxlZCA/PyB0cnVlLFxuICAgICAgICBwcmVmZXJyZWRGaWVsZHM6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8ucHJlZmVycmVkRmllbGRzIHx8IGdsb2JhbFNlZ21lbnRDb25maWc/LnByZWZlcnJlZEZpZWxkcyB8fCBbICdzdGF0dXMnLCAnc3RhdGUnLCAndHlwZScsICdjYXRlZ29yeScsICdwcmlvcml0eScgXSxcbiAgICAgICAgbWF4U2VnbWVudEdyb3VwczogZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5tYXhTZWdtZW50R3JvdXBzID8/IGdsb2JhbFNlZ21lbnRDb25maWc/Lm1heFNlZ21lbnRHcm91cHMgPz8gMixcbiAgICAgICAgbWF4U2VnbWVudHNQZXJHcm91cDogZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5tYXhTZWdtZW50c1Blckdyb3VwID8/IGdsb2JhbFNlZ21lbnRDb25maWc/Lm1heFNlZ21lbnRzUGVyR3JvdXAgPz8gMTAsXG4gICAgICAgIG1pblZhbHVlczogZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5taW5WYWx1ZXMgPz8gZ2xvYmFsU2VnbWVudENvbmZpZz8ubWluVmFsdWVzID8/IDIsXG4gICAgICAgIGljb25NYXBwaW5nOiB7XG4gICAgICAgICAgICAuLi5ERUZBVUxUX0lDT05fTUFQUElORyxcbiAgICAgICAgICAgIC4uLmdsb2JhbFNlZ21lbnRDb25maWc/Lmljb25NYXBwaW5nLFxuICAgICAgICAgICAgLi4uZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5pY29uTWFwcGluZ1xuICAgICAgICB9LFxuICAgICAgICBib29sZWFuTGFiZWxQYXR0ZXJuczogZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5ib29sZWFuTGFiZWxQYXR0ZXJucyB8fCBnbG9iYWxTZWdtZW50Q29uZmlnPy5ib29sZWFuTGFiZWxQYXR0ZXJucyB8fCBbXSxcbiAgICAgICAgZGVmYXVsdEJvb2xlYW5MYWJlbHM6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uZGVmYXVsdEJvb2xlYW5MYWJlbHMgfHwgZ2xvYmFsU2VnbWVudENvbmZpZz8uZGVmYXVsdEJvb2xlYW5MYWJlbHMgfHwgeyB0cnVlOiAnWWVzJywgZmFsc2U6ICdObycgfSxcbiAgICAgICAgaW5jbHVkZUFsbFNlZ21lbnQ6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uaW5jbHVkZUFsbFNlZ21lbnQgPz8gZ2xvYmFsU2VnbWVudENvbmZpZz8uaW5jbHVkZUFsbFNlZ21lbnQgPz8gdHJ1ZSxcbiAgICAgICAgZGVidWc6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uZGVidWcgPz8gZ2xvYmFsU2VnbWVudENvbmZpZz8uZGVidWcgPz8gZmFsc2VcbiAgICB9O1xuXG4gICAgaWYgKG1lcmdlZENvbmZpZy5kZWJ1Zykge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtTZWdtZW50R2VuZXJhdGlvbl0gR2VuZXJhdGluZyBzZWdtZW50cyBmb3IgJHtkZXRlY3RlZEZpZWxkcy5sZW5ndGh9IGZpZWxkKHMpOmAsIGRldGVjdGVkRmllbGRzLm1hcChkID0+IGQuZmllbGQuaWQpKTtcbiAgICB9XG5cbiAgICAvLyA0LiBHZW5lcmF0ZSBzZWdtZW50IGdyb3VwcyAob25lIHBlciBkZXRlY3RlZCBmaWVsZClcbiAgICBjb25zdCBzZWdtZW50R3JvdXBzOiBBcnJheTxJRmlsdGVyU2VnbWVudEdyb3VwPiA9IFtdO1xuXG4gICAgZm9yIChjb25zdCBkZXRlY3Rpb24gb2YgZGV0ZWN0ZWRGaWVsZHMpIHtcbiAgICAgICAgY29uc3QgeyBmaWVsZCB9ID0gZGV0ZWN0aW9uO1xuXG4gICAgICAgIC8vIEdlbmVyYXRlIHNlZ21lbnRzIGZvciB0aGlzIGZpZWxkXG4gICAgICAgIGNvbnN0IHNlZ21lbnRzOiBBcnJheTxJRmlsdGVyU2VnbWVudD4gPSBbXTtcblxuICAgICAgICAvLyBBZGQgXCJBbGxcIiBzZWdtZW50IGlmIGVuYWJsZWRcbiAgICAgICAgaWYgKG1lcmdlZENvbmZpZy5pbmNsdWRlQWxsU2VnbWVudCkge1xuICAgICAgICAgICAgc2VnbWVudHMucHVzaCh7XG4gICAgICAgICAgICAgICAgaWQ6IGBhbGwtJHtmaWVsZC5pZH1gLFxuICAgICAgICAgICAgICAgIGxhYmVsOiAnQWxsJyxcbiAgICAgICAgICAgICAgICBmaWx0ZXJzOiB7fSxcbiAgICAgICAgICAgICAgICBkZWZhdWx0OiB0cnVlXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEdldCB2YWx1ZXMgZnJvbSBmaWVsZFxuICAgICAgICBsZXQgdmFsdWVzOiAoc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbilbXSA9IFtdO1xuICAgICAgICBsZXQgdmFsdWVMYWJlbHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTsgIC8vIEZvciBjdXN0b20gYm9vbGVhbiBsYWJlbHNcblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShmaWVsZC50eXBlKSkge1xuICAgICAgICAgICAgLy8gRW51bSB0eXBlIGFycmF5XG4gICAgICAgICAgICB2YWx1ZXMgPSBmaWVsZC50eXBlO1xuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkLnR5cGUgPT09ICdib29sZWFuJykge1xuICAgICAgICAgICAgLy8gQm9vbGVhbiBmaWVsZCB3aXRoIG9wdGlvbmFsIGN1c3RvbSBsYWJlbHNcbiAgICAgICAgICAgIHZhbHVlcyA9IFsgdHJ1ZSwgZmFsc2UgXTtcblxuICAgICAgICAgICAgLy8gMS4gQ2hlY2sgZm9yIGV4cGxpY2l0IGZpZWxkLWxldmVsIGJvb2xlYW5MYWJlbHNcbiAgICAgICAgICAgIGNvbnN0IGZpZWxkQm9vbGVhbkxhYmVscyA9ICdib29sZWFuTGFiZWxzJyBpbiBmaWVsZCA/IGZpZWxkLmJvb2xlYW5MYWJlbHMgOiB1bmRlZmluZWQ7XG4gICAgICAgICAgICBpZiAoZmllbGRCb29sZWFuTGFiZWxzICYmIHR5cGVvZiBmaWVsZEJvb2xlYW5MYWJlbHMgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbICd0cnVlJyBdID0gZmllbGRCb29sZWFuTGFiZWxzLnRydWUgfHwgJ1llcyc7XG4gICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbICdmYWxzZScgXSA9IGZpZWxkQm9vbGVhbkxhYmVscy5mYWxzZSB8fCAnTm8nO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAvLyAyLiBUcnkgaW50ZWxsaWdlbnQgZXh0cmFjdGlvbiBmcm9tIGZpZWxkIG5hbWVcbiAgICAgICAgICAgICAgICBjb25zdCBmaWVsZE5hbWUgPSBmaWVsZC5pZDtcbiAgICAgICAgICAgICAgICBjb25zdCBleHRyYWN0ZWQgPSBleHRyYWN0Qm9vbGVhbkxhYmVsc0Zyb21GaWVsZE5hbWUoZmllbGROYW1lKTtcblxuICAgICAgICAgICAgICAgIGlmIChleHRyYWN0ZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbICd0cnVlJyBdID0gZXh0cmFjdGVkLnRydWVMYWJlbDtcbiAgICAgICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbICdmYWxzZScgXSA9IGV4dHJhY3RlZC5mYWxzZUxhYmVsO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIDMuIFRyeSB0byBtYXRjaCBhZ2FpbnN0IGNvbmZpZ3VyZWQgcGF0dGVybnNcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGF0dGVybnMgPSBtZXJnZWRDb25maWcuYm9vbGVhbkxhYmVsUGF0dGVybnM7XG4gICAgICAgICAgICAgICAgICAgIGxldCBtYXRjaGVkID0gZmFsc2U7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKHBhdHRlcm5zICYmIHBhdHRlcm5zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgcGF0dGVybiBvZiBwYXR0ZXJucykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlZ2V4ID0gcGF0dGVybi5wYXR0ZXJuIGluc3RhbmNlb2YgUmVnRXhwXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gcGF0dGVybi5wYXR0ZXJuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogbmV3IFJlZ0V4cChwYXR0ZXJuLnBhdHRlcm4sICdpJyk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAocmVnZXgudGVzdChmaWVsZE5hbWUpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlTGFiZWxzWyAndHJ1ZScgXSA9IHBhdHRlcm4udHJ1ZUxhYmVsO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZUxhYmVsc1sgJ2ZhbHNlJyBdID0gcGF0dGVybi5mYWxzZUxhYmVsO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXRjaGVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gNC4gVXNlIGRlZmF1bHQgZmFsbGJhY2sgaWYgbm8gcGF0dGVybiBtYXRjaGVkXG4gICAgICAgICAgICAgICAgICAgIGlmICghbWF0Y2hlZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGVmYXVsdHMgPSBtZXJnZWRDb25maWcuZGVmYXVsdEJvb2xlYW5MYWJlbHMgfHwgeyB0cnVlOiAnWWVzJywgZmFsc2U6ICdObycgfTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlTGFiZWxzWyAndHJ1ZScgXSA9IGRlZmF1bHRzLnRydWU7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZUxhYmVsc1sgJ2ZhbHNlJyBdID0gZGVmYXVsdHMuZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoKGZpZWxkLmZpZWxkVHlwZSA9PT0gJ3NlbGVjdCcgfHwgZmllbGQuZmllbGRUeXBlID09PSAncmFkaW8nIHx8IGZpZWxkLmZpZWxkVHlwZSA9PT0gJ2NoZWNrYm94JyB8fCBmaWVsZC5maWVsZFR5cGUgPT09ICdtdWx0aS1zZWxlY3QnKSAmJiBBcnJheS5pc0FycmF5KChmaWVsZCBhcyBhbnkpLm9wdGlvbnMpKSB7XG4gICAgICAgICAgICAvLyBTZWxlY3QvcmFkaW8vY2hlY2tib3ggZmllbGQgd2l0aCBpbmxpbmUgb3B0aW9uc1xuICAgICAgICAgICAgY29uc3Qgb3B0aW9ucyA9IChmaWVsZCBhcyBhbnkpLm9wdGlvbnMgYXMgQXJyYXk8eyBsYWJlbDogc3RyaW5nOyB2YWx1ZTogc3RyaW5nIH0+O1xuICAgICAgICAgICAgdmFsdWVzID0gb3B0aW9ucy5tYXAob3B0ID0+IG9wdC52YWx1ZSk7XG4gICAgICAgICAgICAvLyBTdG9yZSBsYWJlbHMgZm9yIGxhdGVyIHVzZVxuICAgICAgICAgICAgb3B0aW9ucy5mb3JFYWNoKG9wdCA9PiB7XG4gICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbIFN0cmluZyhvcHQudmFsdWUpIF0gPSBvcHQubGFiZWw7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFwcGx5IGZpZWxkLXNwZWNpZmljIHZhbHVlIGZpbHRlcnMgZmlyc3QsIHRoZW4gZ2xvYmFsXG4gICAgICAgIGNvbnN0IGluY2x1ZGVWYWx1ZXNCeUZpZWxkID0gZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5pbmNsdWRlVmFsdWVzQnlGaWVsZDtcbiAgICAgICAgY29uc3QgaW5jbHVkZVZhbHVlcyA9IGluY2x1ZGVWYWx1ZXNCeUZpZWxkPy5bIGZpZWxkLmlkIF0gfHwgZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5pbmNsdWRlVmFsdWVzO1xuICAgICAgICBpZiAoaW5jbHVkZVZhbHVlcykge1xuICAgICAgICAgICAgdmFsdWVzID0gdmFsdWVzLmZpbHRlcih2ID0+IGluY2x1ZGVWYWx1ZXMuaW5jbHVkZXMoU3RyaW5nKHYpKSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBleGNsdWRlVmFsdWVzQnlGaWVsZCA9IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uZXhjbHVkZVZhbHVlc0J5RmllbGQ7XG4gICAgICAgIGNvbnN0IGV4Y2x1ZGVWYWx1ZXMgPSBleGNsdWRlVmFsdWVzQnlGaWVsZD8uWyBmaWVsZC5pZCBdIHx8IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uZXhjbHVkZVZhbHVlcztcbiAgICAgICAgaWYgKGV4Y2x1ZGVWYWx1ZXMpIHtcbiAgICAgICAgICAgIHZhbHVlcyA9IHZhbHVlcy5maWx0ZXIodiA9PiAhZXhjbHVkZVZhbHVlcy5pbmNsdWRlcyhTdHJpbmcodikpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFwcGx5IGZpZWxkLXNwZWNpZmljIHNvcnQgb3JkZXIgZmlyc3QsIHRoZW4gZ2xvYmFsXG4gICAgICAgIGNvbnN0IHNvcnRPcmRlckJ5RmllbGQgPSBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LnNvcnRPcmRlckJ5RmllbGQ7XG4gICAgICAgIGNvbnN0IHNvcnRPcmRlciA9IHNvcnRPcmRlckJ5RmllbGQ/LlsgZmllbGQuaWQgXSB8fCBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LnNvcnRPcmRlcjtcbiAgICAgICAgaWYgKHNvcnRPcmRlcikge1xuICAgICAgICAgICAgdmFsdWVzLnNvcnQoKGEsIGIpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBhSW5kZXggPSBzb3J0T3JkZXIuaW5kZXhPZihTdHJpbmcoYSkpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGJJbmRleCA9IHNvcnRPcmRlci5pbmRleE9mKFN0cmluZyhiKSk7XG5cbiAgICAgICAgICAgICAgICAvLyBJZiBib3RoIGluIHNvcnRPcmRlciwgdXNlIHRoYXQgb3JkZXJcbiAgICAgICAgICAgICAgICBpZiAoYUluZGV4ID49IDAgJiYgYkluZGV4ID49IDApIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGFJbmRleCAtIGJJbmRleDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgLy8gSWYgb25seSBvbmUgaW4gc29ydE9yZGVyLCBpdCBjb21lcyBmaXJzdFxuICAgICAgICAgICAgICAgIGlmIChhSW5kZXggPj0gMCkgcmV0dXJuIC0xO1xuICAgICAgICAgICAgICAgIGlmIChiSW5kZXggPj0gMCkgcmV0dXJuIDE7XG4gICAgICAgICAgICAgICAgLy8gTmVpdGhlciBpbiBzb3J0T3JkZXIsIG1haW50YWluIG9yaWdpbmFsIG9yZGVyXG4gICAgICAgICAgICAgICAgcmV0dXJuIDA7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEdlbmVyYXRlIHNlZ21lbnQgZm9yIGVhY2ggdmFsdWVcbiAgICAgICAgZm9yIChjb25zdCB2YWx1ZSBvZiB2YWx1ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IHZhbHVlU3RyID0gU3RyaW5nKHZhbHVlKTtcbiAgICAgICAgICAgIGNvbnN0IHZhbHVlTG93ZXIgPSB2YWx1ZVN0ci50b0xvd2VyQ2FzZSgpO1xuXG4gICAgICAgICAgICAvLyBVc2UgY3VzdG9tIGxhYmVsIGlmIGF2YWlsYWJsZSwgb3RoZXJ3aXNlIGZvcm1hdCB0aGUgdmFsdWVcbiAgICAgICAgICAgIGNvbnN0IHNlZ21lbnRMYWJlbCA9IHZhbHVlTGFiZWxzWyB2YWx1ZVN0ciBdIHx8IHBhc2NhbENhc2UodmFsdWVTdHIpO1xuXG4gICAgICAgICAgICBzZWdtZW50cy5wdXNoKHtcbiAgICAgICAgICAgICAgICBpZDogYCR7ZmllbGQuaWR9LSR7dmFsdWVMb3dlci5yZXBsYWNlKC9bXmEtejAtOV0rL2csICctJyl9YCwgIC8vIFVuaXF1ZSBJRFxuICAgICAgICAgICAgICAgIGxhYmVsOiBzZWdtZW50TGFiZWwsICAvLyBDdXN0b20gb3IgZm9ybWF0dGVkIGxhYmVsXG4gICAgICAgICAgICAgICAgaWNvbjogbWVyZ2VkQ29uZmlnLmljb25NYXBwaW5nWyB2YWx1ZUxvd2VyIF0sICAvLyBTbWFydCBpY29uIGxvb2t1cFxuICAgICAgICAgICAgICAgIGZpbHRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgWyBmaWVsZC5pZCBdOiB7IGVxOiB2YWx1ZSB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBPbmx5IGFkZCBncm91cCBpZiB3ZSBoYXZlIHNlZ21lbnRzXG4gICAgICAgIGNvbnN0IG1pblNlZ21lbnRzID0gbWVyZ2VkQ29uZmlnLmluY2x1ZGVBbGxTZWdtZW50ID8gMSA6IDA7XG4gICAgICAgIGlmIChzZWdtZW50cy5sZW5ndGggPiBtaW5TZWdtZW50cykge1xuICAgICAgICAgICAgLy8gQXV0by1nZW5lcmF0ZSBsYWJlbCBvciB1c2UgZXhwbGljaXQgZ3JvdXBMYWJlbHNcbiAgICAgICAgICAgIGNvbnN0IGN1c3RvbUdyb3VwTGFiZWxzID0gZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5ncm91cExhYmVscztcbiAgICAgICAgICAgIGNvbnN0IGxhYmVsID0gY3VzdG9tR3JvdXBMYWJlbHM/LlsgZmllbGQuaWQgXSB8fCBgQnkgJHtwYXNjYWxDYXNlKGZpZWxkLmlkKX1gO1xuXG4gICAgICAgICAgICBzZWdtZW50R3JvdXBzLnB1c2goe1xuICAgICAgICAgICAgICAgIGlkOiBgJHtmaWVsZC5pZH0tZ3JvdXBgLFxuICAgICAgICAgICAgICAgIGxhYmVsLFxuICAgICAgICAgICAgICAgIHNlZ21lbnRzLFxuICAgICAgICAgICAgICAgIGRlZmF1bHRTZWdtZW50SWQ6IHNlZ21lbnRzLmZpbmQocyA9PiBzLmRlZmF1bHQpPy5pZCxcbiAgICAgICAgICAgICAgICBtYXhWaXNpYmxlOiBtZXJnZWRDb25maWcubWF4U2VnbWVudHNQZXJHcm91cFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBSZXR1cm4gc2VnbWVudCBncm91cHMgKG9yIHVuZGVmaW5lZCBpZiBub25lIGdlbmVyYXRlZClcbiAgICBpZiAoc2VnbWVudEdyb3Vwcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyBJZiBvbmx5IDEgZ3JvdXAgd2l0aCBzaW1wbGUgY29uZmlnLCByZXR1cm4gZmxhdCBzZWdtZW50cyBmb3IgYmFja3dhcmRzIGNvbXBhdGliaWxpdHlcbiAgICAvLyBUaGlzIG1haW50YWlucyBsZWdhY3kgYmVoYXZpb3Igd2hlbiBtYXhTZWdtZW50R3JvdXBzID0gMVxuICAgIGlmIChzZWdtZW50R3JvdXBzLmxlbmd0aCA9PT0gMSAmJiBtZXJnZWRDb25maWcubWF4U2VnbWVudEdyb3VwcyA9PT0gMSkge1xuICAgICAgICByZXR1cm4gc2VnbWVudEdyb3Vwc1sgMCBdLnNlZ21lbnRzO1xuICAgIH1cblxuICAgIHJldHVybiBzZWdtZW50R3JvdXBzO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEVOVElUWSBBVFRSSUJVVEUgRk9STUFUVElOR1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogRm9ybWF0cyBhIHNpbmdsZSBlbnRpdHkgYXR0cmlidXRlIGZvciBmb3JtIG9yIGRldGFpbCBwYWdlIGRpc3BsYXkuXG4gKiBcbiAqIFRyYW5zZm9ybXMgc2NoZW1hIGF0dHJpYnV0ZXMgaW50byBVSS1yZWFkeSBmaWVsZCBjb25maWd1cmF0aW9ucyB3aXRoIHByb3BlciBmaWVsZCB0eXBlcyxcbiAqIHJlbGF0aW9uIGNvbmZpZ3MsIG9wdGlvbnMsIHZpc2liaWxpdHksIGFuZCB2YWxpZGF0aW9uIHJ1bGVzLiBBdXRvLWdlbmVyYXRlcyByZWxhdGlvblxuICogZGlzcGxheSBjb25maWd1cmF0aW9ucyBhbmQgZmlsdGVyIGNvbmZpZ3Mgd2hlbiBub3QgZXhwbGljaXRseSBwcm92aWRlZC5cbiAqIFxuICogQHBhcmFtIHRoaXNQcm9wIC0gVGhlIGVudGl0eSBhdHRyaWJ1dGUgdG8gZm9ybWF0XG4gKiBAcGFyYW0gdHlwZSAtIFBhZ2UgdHlwZTogJ2NyZWF0ZScsICd1cGRhdGUnLCBvciAnZGV0YWlsJ1xuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSBmb3IgYWNjZXNzaW5nIHJlbGF0ZWQgc2NoZW1hc1xuICogQHBhcmFtIGFsbFByb3BlcnRpZXMgLSBPcHRpb25hbCBhcnJheSBvZiBhbGwgcHJvcGVydGllcyBmb3IgZGV0ZWN0aW5nIGR1cGxpY2F0ZWQgcmVsYXRpb24gZmllbGRzXG4gKiBAcGFyYW0gZ2xvYmFsVUlDb25maWdPcHRpb25zIC0gT3B0aW9uYWwgZ2xvYmFsIFVJIGNvbmZpZ3VyYXRpb24gb3B0aW9uc1xuICogQHJldHVybnMgRm9ybWF0dGVkIGZpZWxkIG1ldGFkYXRhIHJlYWR5IGZvciBVSSByZW5kZXJpbmdcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IGZvcm1hdHRlZEZpZWxkID0gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKFxuICogICB7XG4gKiAgICAgaWQ6ICd0ZWFtSWQnLFxuICogICAgIG5hbWU6ICd0ZWFtSWQnLFxuICogICAgIHR5cGU6ICdzdHJpbmcnLFxuICogICAgIHJlbGF0aW9uOiB7IHR5cGU6ICdvbmUnLCBlbnRpdHk6ICd0ZWFtJyB9XG4gKiAgIH0sXG4gKiAgICdjcmVhdGUnLFxuICogICBlbnRpdHlTZXJ2aWNlXG4gKiApO1xuICogLy8gUmV0dXJucyBmaWVsZCB3aXRoIHJlbGF0aW9uQ29uZmlnLCBmaWx0ZXJDb25maWcsIGFuZCBwcm9wZXIgZmllbGQgdHlwZVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoXG4gICAgdGhpc1Byb3A6IFRJT1NjaGVtYUF0dHJpYnV0ZSxcbiAgICB0eXBlOiAnY3JlYXRlJyB8ICd1cGRhdGUnIHwgJ2RldGFpbCcsXG4gICAgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PixcbiAgICBhbGxQcm9wZXJ0aWVzPzogVElPU2NoZW1hQXR0cmlidXRlW10sICAvLyBPcHRpb25hbDogZm9yIGRldGVjdGluZyBkdXBsaWNhdGVkIHJlbGF0aW9uIGZpZWxkc1xuICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sgJ3VpQ29uZmlnR2VuT3B0aW9ucycgXSAgLy8gT3B0aW9uYWw6IGdsb2JhbCBVSSBjb25maWcgb3B0aW9uc1xuKSB7XG4gICAgY29uc3QgZm9ybWF0dGVkOiBhbnkgPSB7XG4gICAgICAgIC4uLnRoaXNQcm9wLFxuICAgICAgICAvLyBVc2UgY3VzdG9tIGxhYmVsIGlmIHByb3ZpZGVkIGluIHNjaGVtYSAodGhpc1Byb3AubGFiZWwpLCBvdGhlcndpc2UgZm9ybWF0IHRoZSBuYW1lIHRvIGh1bWFuLXJlYWRhYmxlXG4gICAgICAgIGxhYmVsOiAodGhpc1Byb3AgYXMgYW55KS5sYWJlbCB8fCB0b0h1bWFuUmVhZGFibGVOYW1lKHRoaXNQcm9wLm5hbWUpLFxuICAgICAgICBjb2x1bW46IHRoaXNQcm9wLmlkLFxuICAgICAgICBmaWVsZFR5cGU6IHRoaXNQcm9wLmZpZWxkVHlwZSB8fCAndGV4dCcsICAvLyBmaWVsZFR5cGUgc2hvdWxkIGFscmVhZHkgYmUgaW5mZXJyZWQgaW4gYmFzZS1zZXJ2aWNlXG4gICAgICAgIGhpZGRlbjogdGhpc1Byb3AuaGFzT3duUHJvcGVydHkoJ2lzVmlzaWJsZScpICYmICF0aGlzUHJvcC5pc1Zpc2libGVcbiAgICB9O1xuXG4gICAgLy8gSGFuZGxlIGFkZE5ld09wdGlvbiAoT0xEIC0gZGVwcmVjYXRlZCwgZ2VuZXJhdGVzIGVtYmVkZGVkIGNvbmZpZykgb3IgYWRkTmV3T3B0aW9uQ29uZmlnIChORVcgLSBqdXN0IHBhc3MgdGhyb3VnaCByZWZlcmVuY2UpXG4gICAgaWYgKGlzU2VsZWN0RmllbGRNZXRhZGF0YSh0aGlzUHJvcCkgJiYgWyAnY3JlYXRlJywgJ3VwZGF0ZScgXS5pbmNsdWRlcyh0eXBlKSkge1xuICAgICAgICBjb25zdCBzZWxlY3RGaWVsZCA9IHRoaXNQcm9wIGFzIFNlbGVjdEZpZWxkTWV0YWRhdGE7XG5cbiAgICAgICAgaWYgKHNlbGVjdEZpZWxkLmFkZE5ld09wdGlvbkNvbmZpZykge1xuICAgICAgICAgICAgLy8gTkVXIFdBWTogVXNlciBwcm92aWRlZCBhZGROZXdPcHRpb25Db25maWcgcmVmZXJlbmNlIC0ganVzdCBwYXNzIGl0IHRocm91Z2hcbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ2FkZE5ld09wdGlvbkNvbmZpZycgXSA9IHNlbGVjdEZpZWxkLmFkZE5ld09wdGlvbkNvbmZpZztcblxuICAgICAgICB9IGVsc2UgaWYgKHNlbGVjdEZpZWxkLmFkZE5ld09wdGlvbikge1xuICAgICAgICAgICAgLy8gT0xEIFdBWSAoREVQUkVDQVRFRCk6IFRyYW5zZm9ybSBhZGROZXdPcHRpb24gdG8gYWRkTmV3T3B0aW9uQ29uZmlnIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG4gICAgICAgICAgICBjb25zdCB7IGVudGl0eU5hbWUsIG92ZXJyaWRlQ29uZmlnIH0gPSBzZWxlY3RGaWVsZC5hZGROZXdPcHRpb247XG5cbiAgICAgICAgICAgIGlmIChlbnRpdHlOYW1lICYmIGVudGl0eVNlcnZpY2UuaGFzRW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShlbnRpdHlOYW1lKSkge1xuICAgICAgICAgICAgICAgIGZvcm1hdHRlZFsgJ2FkZE5ld09wdGlvbkNvbmZpZycgXSA9IHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdjcmVhdGUnLFxuICAgICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzogb3ZlcnJpZGVDb25maWcgfHwge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3VibWl0U3VjY2Vzc1JlZGlyZWN0OiB1bmRlZmluZWQsICAvLyBTdGF5IGluIG1vZGFsIGFmdGVyIGNyZWF0aW9uXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3JtQnV0dG9uczogW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsgdGV4dDogXCJBZGRcIiwgYWN0aW9uOiBcInN1Ym1pdFwiIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgeyB0ZXh0OiBcIkNhbmNlbFwiLCBhY3Rpb246IFwiY2FuY2VsXCIgfVxuICAgICAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWw6IENvdWxkIG5vdCBmaW5kIHJlbGF0ZWQtZW50aXR5LXNlcnZpY2UgZm9yIGVudGl0eSBbJHtlbnRpdHlOYW1lfV0gaW4gJHtlbnRpdHlTZXJ2aWNlLmNvbnN0cnVjdG9yLm5hbWV9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgcmVsYXRpb24gZmllbGRzIChEQVRBIExBWUVSICsgVUkgTEFZRVIpXG4gICAgaWYgKHRoaXNQcm9wLnJlbGF0aW9uICYmIHR5cGUgPT09ICdkZXRhaWwnKSB7XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uID0gdGhpc1Byb3AucmVsYXRpb247XG4gICAgICAgIGNvbnN0IHsgZW50aXR5TmFtZSwgdHlwZTogcmVsYXRpb25UeXBlLCBpZGVudGlmaWVycyB9ID0gcmVsYXRpb247XG4gICAgICAgIGNvbnN0IGVudGl0eU5hbWVMb3dlciA9IGVudGl0eU5hbWUudG9Mb3dlckNhc2UoKTtcblxuICAgICAgICBpZiAoIWVudGl0eVNlcnZpY2UuaGFzRW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShlbnRpdHlOYW1lKSkge1xuICAgICAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWw6IENvdWxkIG5vdCBmaW5kIHJlbGF0ZWQtZW50aXR5LXNlcnZpY2UgZm9yIGVudGl0eSBbJHtlbnRpdHlOYW1lfV0gaW4gJHtlbnRpdHlTZXJ2aWNlLmNvbnN0cnVjdG9yLm5hbWV9YCk7XG4gICAgICAgICAgICByZXR1cm4gZm9ybWF0dGVkO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUmVzb2x2ZSBpZGVudGlmaWVycyAoY291bGQgYmUgZGlyZWN0IHZhbHVlIG9yIGxhenkgZnVuY3Rpb24pXG4gICAgICAgIGNvbnN0IHJlc29sdmVkSWRlbnRpZmllcnMgPSB0eXBlb2YgaWRlbnRpZmllcnMgPT09ICdmdW5jdGlvbicgPyBpZGVudGlmaWVycygpIDogaWRlbnRpZmllcnM7XG5cbiAgICAgICAgLy8gU2FmZXR5IGNoZWNrIGZvciBhcnJheSBpZGVudGlmaWVyc1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShyZXNvbHZlZElkZW50aWZpZXJzKSkge1xuICAgICAgICAgICAgaWYgKHJlc29sdmVkSWRlbnRpZmllcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWw6IEVtcHR5IGlkZW50aWZpZXJzIGFycmF5IGZvciByZWxhdGlvbiBbJHtlbnRpdHlOYW1lfV1gKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gZm9ybWF0dGVkO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gSGFuZGxlIGJvdGggc2luZ2xlIGFuZCBtdWx0aXBsZSBpZGVudGlmaWVycyBmb3IgY29tcG9zaXRlIGtleXNcbiAgICAgICAgY29uc3QgaWRlbnRpZmllck1hcHBpbmdzID0gQXJyYXkuaXNBcnJheShyZXNvbHZlZElkZW50aWZpZXJzKVxuICAgICAgICAgICAgPyByZXNvbHZlZElkZW50aWZpZXJzLm1hcChpZCA9PiAoe1xuICAgICAgICAgICAgICAgIHNvdXJjZTogU3RyaW5nKGlkLnNvdXJjZSksXG4gICAgICAgICAgICAgICAgdGFyZ2V0OiBTdHJpbmcoaWQudGFyZ2V0KVxuICAgICAgICAgICAgfSkpXG4gICAgICAgICAgICA6IFsge1xuICAgICAgICAgICAgICAgIHNvdXJjZTogU3RyaW5nKHJlc29sdmVkSWRlbnRpZmllcnMuc291cmNlKSxcbiAgICAgICAgICAgICAgICB0YXJnZXQ6IFN0cmluZyhyZXNvbHZlZElkZW50aWZpZXJzLnRhcmdldClcbiAgICAgICAgICAgIH0gXTtcblxuICAgICAgICAvLyBGb3Igcm91dGUgcGF0dGVybiBhbmQgZGVmYXVsdCBmaWx0ZXJzLCB1c2UgdGhlIGZpcnN0IGlkZW50aWZpZXJcbiAgICAgICAgLy8gKG1vc3QgZW50aXRpZXMgaGF2ZSBzaW5nbGUgaWRlbnRpZmllcjsgY29tcG9zaXRlIGtleXMgbmVlZCBleHBsaWNpdCByb3V0ZVBhdHRlcm4pXG4gICAgICAgIGNvbnN0IHByaW1hcnlJZGVudGlmaWVyID0gaWRlbnRpZmllck1hcHBpbmdzWyAwIF07XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgdXNlciBwcm92aWRlZCBjdXN0b20gVUkgY29uZmlnIGluIHJlbGF0aW9uQ29uZmlnIChvcHRpb25hbCBvdmVycmlkZSlcbiAgICAgICAgY29uc3QgdXNlclJlbGF0aW9uQ29uZmlnID0gdGhpc1Byb3AucmVsYXRpb25Db25maWcgYXMgSVJlbGF0aW9uRmllbGRDb25maWcgfCB1bmRlZmluZWQ7XG5cbiAgICAgICAgLy8gR2V0IHJlbGF0ZWQgZW50aXR5IHNlcnZpY2UgZm9yIG1ldGFkYXRhIChpY29uLCBldGMuKVxuICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5U2VydmljZSA9IGVudGl0eVNlcnZpY2UuaGFzRW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShlbnRpdHlOYW1lKVxuICAgICAgICAgICAgPyBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUoZW50aXR5TmFtZSlcbiAgICAgICAgICAgIDogdW5kZWZpbmVkO1xuXG4gICAgICAgIC8vIEdldCBlbnRpdHkgbWV0YWRhdGEgZm9yIGljb24gYW5kIGZhbGxiYWNrIGdlbmVyYXRpb25cbiAgICAgICAgY29uc3QgcmVsYXRlZEVudGl0eU1ldGFkYXRhID0gcmVsYXRlZEVudGl0eVNlcnZpY2U/LmdldEVudGl0eVNjaGVtYT8uKCkubW9kZWw7XG4gICAgICAgIGNvbnN0IGRlZmF1bHRJY29uID0gcmVsYXRlZEVudGl0eU1ldGFkYXRhPy5tZXRhZGF0YT8uaWNvbjtcblxuICAgICAgICBpZiAocmVsYXRpb25UeXBlLmVuZHNXaXRoKCd0by1vbmUnKSkge1xuICAgICAgICAgICAgLy8gVE8tT05FOiBTaG93IHZhbHVlIGFzIGxpbmsgKyBtb2RhbCBpY29uXG4gICAgICAgICAgICAvLyBSb3V0ZSBwYXR0ZXJuOiBVc2UgY3VzdG9tIChmcm9tIHJlbGF0aW9uQ29uZmlnKSBvciBkZWZhdWx0IHRvIC92aWV3LXtlbnRpdHl9Lzp0YXJnZXRJZFxuICAgICAgICAgICAgY29uc3Qgcm91dGVQYXR0ZXJuID0gdXNlclJlbGF0aW9uQ29uZmlnPy5yb3V0ZVBhdHRlcm5cbiAgICAgICAgICAgICAgICB8fCBgL3ZpZXctJHtlbnRpdHlOYW1lTG93ZXJ9Lzoke3ByaW1hcnlJZGVudGlmaWVyLnRhcmdldH1gO1xuXG4gICAgICAgICAgICAvLyBHZW5lcmF0ZSBmYWxsYmFjayBjb25maWd1cmF0aW9uIGZvciB3aGVuIG9ubHkgSUQgaXMgYXZhaWxhYmxlXG4gICAgICAgICAgICBjb25zdCBmYWxsYmFja0NvbmZpZyA9IGdlbmVyYXRlUmVsYXRpb25GYWxsYmFjayhcbiAgICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgIHByaW1hcnlJZGVudGlmaWVyLnNvdXJjZSxcbiAgICAgICAgICAgICAgICByZWxhdGVkRW50aXR5U2VydmljZVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgLy8gQXV0by1kZXRlY3QgZHVwbGljYXRlZCByZWxhdGlvbiBmaWVsZCAoZS5nLiwgdGVhbU5hbWUgZm9yIHRlYW1JZClcbiAgICAgICAgICAgIC8vIE5FVzogVXNlIGVuaGFuY2VkIGRldGVjdGlvbiB3aXRoIGNvbmZpZyBzdXBwb3J0XG4gICAgICAgICAgICBsZXQgYXV0b1RlbXBsYXRlOiBzdHJpbmcgfCB1bmRlZmluZWQgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICBsZXQgZGV0ZWN0aW9uTWV0YWRhdGE6IGFueSA9IHVuZGVmaW5lZDtcblxuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgYXV0by1kZXRlY3Rpb24gaXMgZW5hYmxlZCAoZGVmYXVsdDogdHJ1ZSlcbiAgICAgICAgICAgIGNvbnN0IGF1dG9EZXRlY3RFbmFibGVkID0gdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5hdXRvRGV0ZWN0ICE9PSBmYWxzZTtcblxuICAgICAgICAgICAgaWYgKGF1dG9EZXRlY3RFbmFibGVkICYmIGFsbFByb3BlcnRpZXMpIHtcbiAgICAgICAgICAgICAgICAvLyBHZXQgZ2xvYmFsIGNvbmZpZyAocGFzc2VkIGZyb20gZncyNCBpbml0aWFsaXphdGlvbilcbiAgICAgICAgICAgICAgICBjb25zdCBnbG9iYWxDb25maWcgPSBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/LmR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbjtcblxuICAgICAgICAgICAgICAgIC8vIEdldCBlbnRpdHktbGV2ZWwgY29uZmlnIGZyb20gZW50aXR5IG1ldGFkYXRhXG4gICAgICAgICAgICAgICAgY29uc3QgZW50aXR5Q29uZmlnID0gcmVsYXRlZEVudGl0eU1ldGFkYXRhPy5tZXRhZGF0YT8uZHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uO1xuXG4gICAgICAgICAgICAgICAgLy8gR2V0IHJlbGF0aW9uLWxldmVsIGhpbnRzXG4gICAgICAgICAgICAgICAgY29uc3QgcmVsYXRpb25IaW50cyA9IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uYXV0b0RldGVjdEhpbnRzO1xuXG4gICAgICAgICAgICAgICAgLy8gUnVuIGVuaGFuY2VkIGRldGVjdGlvblxuICAgICAgICAgICAgICAgIGNvbnN0IGRldGVjdGlvblJlc3VsdCA9IGRldGVjdER1cGxpY2F0ZWRSZWxhdGlvbkZpZWxkcyhcbiAgICAgICAgICAgICAgICAgICAgYWxsUHJvcGVydGllcyxcbiAgICAgICAgICAgICAgICAgICAgdGhpc1Byb3AuaWQsXG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGdsb2JhbENvbmZpZyxcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnLFxuICAgICAgICAgICAgICAgICAgICByZWxhdGlvbkhpbnRzXG4gICAgICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgICAgIGlmIChkZXRlY3Rpb25SZXN1bHQpIHtcbiAgICAgICAgICAgICAgICAgICAgYXV0b1RlbXBsYXRlID0gZGV0ZWN0aW9uUmVzdWx0LnRlbXBsYXRlO1xuXG4gICAgICAgICAgICAgICAgICAgIC8vIFN0b3JlIG1ldGFkYXRhIGZvciBkZWJ1Z2dpbmcgYW5kIGZ1dHVyZSBmZWF0dXJlc1xuICAgICAgICAgICAgICAgICAgICBkZXRlY3Rpb25NZXRhZGF0YSA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRldGVjdGVkRmllbGRzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJpbWFyeTogZGV0ZWN0aW9uUmVzdWx0LnByaW1hcnlGaWVsZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhbHRlcm5hdGl2ZXM6IGRldGVjdGlvblJlc3VsdC5kZXRlY3RlZEZpZWxkcy5kaXNwbGF5Py5zbGljZSgxKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aXN1YWw6IGRldGVjdGlvblJlc3VsdC5kZXRlY3RlZEZpZWxkcy52aXN1YWwsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWV0YTogZGV0ZWN0aW9uUmVzdWx0LmRldGVjdGVkRmllbGRzLm1ldGFcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25maWRlbmNlOiBkZXRlY3Rpb25SZXN1bHQuY29uZmlkZW5jZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1ldGhvZDogZGV0ZWN0aW9uUmVzdWx0Lm1ldGhvZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhdHRlcm46IGRldGVjdGlvblJlc3VsdC5wYXR0ZXJuXG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZzogSVJlbGF0aW9uRmllbGRDb25maWcgPSB7XG4gICAgICAgICAgICAgICAgcm91dGVQYXR0ZXJuOiByb3V0ZVBhdHRlcm4sXG4gICAgICAgICAgICAgICAgLy8gUGFzcyBBTEwgaWRlbnRpZmllciBtYXBwaW5ncyAoc3VwcG9ydHMgY29tcG9zaXRlIGtleXMpXG4gICAgICAgICAgICAgICAgaWRlbnRpZmllck1hcHBpbmc6IGlkZW50aWZpZXJNYXBwaW5ncy5sZW5ndGggPT09IDFcbiAgICAgICAgICAgICAgICAgICAgPyBpZGVudGlmaWVyTWFwcGluZ3NbIDAgXSAgLy8gU2luZ2xlOiByZXR1cm4gb2JqZWN0XG4gICAgICAgICAgICAgICAgICAgIDogaWRlbnRpZmllck1hcHBpbmdzLCAgICAgLy8gTXVsdGlwbGU6IHJldHVybiBhcnJheVxuICAgICAgICAgICAgICAgIG1vZGFsQ29uZmlnUmVmOiB1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsQ29uZmlnUmVmIHx8IHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICd2aWV3JyxcbiAgICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHt9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBtb2RhbFdpZHRoOiB1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsV2lkdGgsXG4gICAgICAgICAgICAgICAgbW9kYWxUaXRsZTogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbFRpdGxlLFxuICAgICAgICAgICAgICAgIGRpc3BsYXlDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgLy8gUHJpb3JpdHk6IFVzZXIgY3VzdG9tIHRlbXBsYXRlID4gQXV0by1kZXRlY3RlZCBkdXBsaWNhdGVkIGZpZWxkID4gdW5kZWZpbmVkICh1c2UgZmFsbGJhY2spXG4gICAgICAgICAgICAgICAgICAgIHRlbXBsYXRlOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnRlbXBsYXRlIHx8IGF1dG9UZW1wbGF0ZSxcbiAgICAgICAgICAgICAgICAgICAgLy8gU21hcnQgZmFsbGJhY2sgcHJlLWdlbmVyYXRlZCBmcm9tIGVudGl0eSBtZXRhZGF0YVxuICAgICAgICAgICAgICAgICAgICBmYWxsYmFjazogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5mYWxsYmFjayB8fCBmYWxsYmFja0NvbmZpZyxcbiAgICAgICAgICAgICAgICAgICAgLy8gSWNvbiBmcm9tIGVudGl0eSBtZXRhZGF0YSBvciB1c2VyIG92ZXJyaWRlXG4gICAgICAgICAgICAgICAgICAgIGljb246IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uaWNvbiB8fCBkZWZhdWx0SWNvbiB8fCAnRXllT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgICAgICBzaG93TW9kYWxJY29uOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnNob3dNb2RhbEljb24gIT09IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICBzaG93TGluazogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5zaG93TGluayAhPT0gZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgIC8vIFBhc3MgdGhyb3VnaCBhdXRvRGV0ZWN0IGFuZCBhdXRvRGV0ZWN0SGludHNcbiAgICAgICAgICAgICAgICAgICAgYXV0b0RldGVjdDogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5hdXRvRGV0ZWN0LFxuICAgICAgICAgICAgICAgICAgICBhdXRvRGV0ZWN0SGludHM6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uYXV0b0RldGVjdEhpbnRzLFxuICAgICAgICAgICAgICAgICAgICAvLyBQYXNzIHRocm91Z2ggYW55IGN1c3RvbSBhY3Rpb25zXG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uYWN0aW9uc1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBpZiAoZ2xvYmFsVUlDb25maWdPcHRpb25zPy5kdXBsaWNhdGVkRmllbGREZXRlY3Rpb24/LmRlYnVnKSB7XG4gICAgICAgICAgICAgICAgZ2VuZXJhdGVkUmVsYXRpb25Db25maWcuZGlzcGxheUNvbmZpZyFbICdfZGV0ZWN0aW9uTWV0YWRhdGEnIF0gPSBkZXRlY3Rpb25NZXRhZGF0YTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZm9ybWF0dGVkWyAncmVsYXRpb25Db25maWcnIF0gPSBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZztcblxuICAgICAgICAgICAgLy8gQmFja3dhcmQgY29tcGF0aWJpbGl0eTogS2VlcCBpc0xpbmsgYW5kIGxpbmtDb25maWdcbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ2lzTGluaycgXSA9IHRydWU7XG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdsaW5rQ29uZmlnJyBdID0ge1xuICAgICAgICAgICAgICAgIHJvdXRlUGF0dGVybjogcm91dGVQYXR0ZXJuXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgIH0gZWxzZSBpZiAocmVsYXRpb25UeXBlLmVuZHNXaXRoKCd0by1tYW55JykpIHtcbiAgICAgICAgICAgIC8vIFRPLU1BTlk6IFNob3cgY291bnQgKyBtb2RhbCBpY29uIChvcGVucyBmaWx0ZXJlZCBsaXN0KVxuICAgICAgICAgICAgLy8gUm91dGUgcGF0dGVybjogVXNlIGN1c3RvbSAoZnJvbSByZWxhdGlvbkNvbmZpZykgb3IgZGVmYXVsdCB0byAvbGlzdC17ZW50aXR5fVxuICAgICAgICAgICAgY29uc3Qgcm91dGVQYXR0ZXJuID0gdXNlclJlbGF0aW9uQ29uZmlnPy5yb3V0ZVBhdHRlcm5cbiAgICAgICAgICAgICAgICB8fCBgL2xpc3QtJHtlbnRpdHlOYW1lTG93ZXJ9YDtcblxuICAgICAgICAgICAgLy8gQnVpbGQgZGVmYXVsdCBmaWx0ZXJzIHRvIHNob3cgb25seSByZWxhdGVkIGl0ZW1zXG4gICAgICAgICAgICAvLyBGb3IgZXhhbXBsZSwgaWYgd2UncmUgdmlld2luZyBhIFRlYW0gYW5kIHRoaXMgZmllbGQgc2hvd3MgR2FtZXMsXG4gICAgICAgICAgICAvLyB3ZSB3YW50IHRvIGZpbHRlciBnYW1lcyB3aGVyZSB0ZWFtSWQgPSBjdXJyZW50IHRlYW0ncyBJRFxuICAgICAgICAgICAgLy8gRm9yIGNvbXBvc2l0ZSBrZXlzLCBhZGQgYWxsIGlkZW50aWZpZXJzIGFzIGZpbHRlcnNcbiAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRGaWx0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgICAgICAgICBpZGVudGlmaWVyTWFwcGluZ3MuZm9yRWFjaChtYXBwaW5nID0+IHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyc1sgbWFwcGluZy50YXJnZXQgXSA9IGA6JHttYXBwaW5nLnNvdXJjZX1gO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIEdlbmVyYXRlIGZhbGxiYWNrIGNvbmZpZ3VyYXRpb24gZm9yIHRvLW1hbnkgKHNob3dzIGNvdW50KVxuICAgICAgICAgICAgY29uc3QgZmFsbGJhY2tDb25maWcgPSBnZW5lcmF0ZVJlbGF0aW9uRmFsbGJhY2soXG4gICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICBwcmltYXJ5SWRlbnRpZmllci5zb3VyY2UsXG4gICAgICAgICAgICAgICAgcmVsYXRlZEVudGl0eVNlcnZpY2VcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIGNvbnN0IGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnOiBJUmVsYXRpb25GaWVsZENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICByb3V0ZVBhdHRlcm46IHJvdXRlUGF0dGVybixcbiAgICAgICAgICAgICAgICAvLyBQYXNzIEFMTCBpZGVudGlmaWVyIG1hcHBpbmdzIChzdXBwb3J0cyBjb21wb3NpdGUga2V5cylcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyTWFwcGluZzogaWRlbnRpZmllck1hcHBpbmdzLmxlbmd0aCA9PT0gMVxuICAgICAgICAgICAgICAgICAgICA/IGlkZW50aWZpZXJNYXBwaW5nc1sgMCBdICAvLyBTaW5nbGU6IHJldHVybiBvYmplY3RcbiAgICAgICAgICAgICAgICAgICAgOiBpZGVudGlmaWVyTWFwcGluZ3MsICAgICAvLyBNdWx0aXBsZTogcmV0dXJuIGFycmF5XG4gICAgICAgICAgICAgICAgbW9kYWxDb25maWdSZWY6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxDb25maWdSZWYgfHwge1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IGRlZmF1bHRGaWx0ZXJzXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIG1vZGFsV2lkdGg6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxXaWR0aCxcbiAgICAgICAgICAgICAgICBtb2RhbFRpdGxlOiB1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsVGl0bGUsXG4gICAgICAgICAgICAgICAgZGlzcGxheUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAvLyBVc2VyIGNhbiBvdmVycmlkZSB3aXRoIGN1c3RvbSB0ZW1wbGF0ZVxuICAgICAgICAgICAgICAgICAgICB0ZW1wbGF0ZTogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy50ZW1wbGF0ZSxcbiAgICAgICAgICAgICAgICAgICAgLy8gU21hcnQgZmFsbGJhY2sgcHJlLWdlbmVyYXRlZCBmcm9tIGVudGl0eSBtZXRhZGF0YVxuICAgICAgICAgICAgICAgICAgICBmYWxsYmFjazogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5mYWxsYmFjayB8fCBmYWxsYmFja0NvbmZpZyxcbiAgICAgICAgICAgICAgICAgICAgLy8gSWNvbiBmcm9tIGVudGl0eSBtZXRhZGF0YSBvciB1c2VyIG92ZXJyaWRlXG4gICAgICAgICAgICAgICAgICAgIGljb246IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uaWNvbiB8fCBkZWZhdWx0SWNvbiB8fCAnVW5vcmRlcmVkTGlzdE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICAgICAgc2hvd01vZGFsSWNvbjogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5zaG93TW9kYWxJY29uICE9PSBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgc2hvd0xpbms6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uc2hvd0xpbmsgIT09IHRydWUsIC8vIERlZmF1bHQgZmFsc2UgZm9yIHRvLW1hbnlcbiAgICAgICAgICAgICAgICAgICAgLy8gUGFzcyB0aHJvdWdoIGFueSBjdXN0b20gYWN0aW9uc1xuICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmFjdGlvbnNcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAvLyBJZiB1c2VyIHByb3ZpZGVkIGN1c3RvbSBtb2RhbENvbmZpZ1JlZiwgbWVyZ2UgZGVmYXVsdCBmaWx0ZXJzIHdpdGggdGhlaXIgb3ZlcnJpZGVzXG4gICAgICAgICAgICBpZiAodXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbENvbmZpZ1JlZj8ub3ZlcnJpZGVDb25maWcpIHtcbiAgICAgICAgICAgICAgICBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZy5tb2RhbENvbmZpZ1JlZiEub3ZlcnJpZGVDb25maWcgPSB7XG4gICAgICAgICAgICAgICAgICAgIC4uLnVzZXJSZWxhdGlvbkNvbmZpZy5tb2RhbENvbmZpZ1JlZi5vdmVycmlkZUNvbmZpZyxcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLmRlZmF1bHRGaWx0ZXJzLFxuICAgICAgICAgICAgICAgICAgICAgICAgLi4uKHVzZXJSZWxhdGlvbkNvbmZpZy5tb2RhbENvbmZpZ1JlZi5vdmVycmlkZUNvbmZpZy5kZWZhdWx0RmlsdGVycyB8fCB7fSlcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ3JlbGF0aW9uQ29uZmlnJyBdID0gZ2VuZXJhdGVkUmVsYXRpb25Db25maWc7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgbmVzdGVkIHN0cnVjdHVyZXMgKG1hcCBhbmQgbGlzdCB0eXBlcylcbiAgICBpZiAodGhpc1Byb3AudHlwZSA9PT0gJ21hcCcgJiYgdGhpc1Byb3AucHJvcGVydGllcykge1xuICAgICAgICBmb3JtYXR0ZWRbICdwcm9wZXJ0aWVzJyBdID0gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckZvcm1PckRldGFpbCh0aGlzUHJvcC5wcm9wZXJ0aWVzLCB0eXBlLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICB9IGVsc2UgaWYgKHRoaXNQcm9wLnR5cGUgPT09ICdsaXN0Jykge1xuICAgICAgICAvLyBGb3IgbGlzdCB0eXBlcywgY2hlY2sgaWYgaXRlbXMgYXJlIG1hcHMgKG5lc3RlZCBzdHJ1Y3R1cmVzKVxuICAgICAgICAvLyBOb3RlOiBpdGVtcyBwcm9wZXJ0eSBleGlzdHMgb24gbGlzdC10eXBlIGF0dHJpYnV0ZXMgYnV0IG5vdCBpbiBiYXNlIEVudGl0eUF0dHJpYnV0ZSB0eXBlXG4gICAgICAgIGNvbnN0IGV4dGVuZGVkUHJvcCA9IHRoaXNQcm9wIGFzIFRJT1NjaGVtYUF0dHJpYnV0ZSAmIHsgaXRlbXM/OiB7IHR5cGU6IHN0cmluZzsgcHJvcGVydGllcz86IFRJT1NjaGVtYUF0dHJpYnV0ZVtdIH0gfTtcbiAgICAgICAgaWYgKGV4dGVuZGVkUHJvcC5pdGVtcz8udHlwZSA9PT0gJ21hcCcgJiYgZXh0ZW5kZWRQcm9wLml0ZW1zLnByb3BlcnRpZXMpIHtcbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ2l0ZW1zJyBdID0ge1xuICAgICAgICAgICAgICAgIC4uLmZvcm1hdHRlZFsgJ2l0ZW1zJyBdLFxuICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JGb3JtT3JEZXRhaWwoZXh0ZW5kZWRQcm9wLml0ZW1zLnByb3BlcnRpZXMsIHR5cGUsIGVudGl0eVNlcnZpY2UpXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZvcm1hdHRlZDtcbn1cblxuLyoqXG4gKiBSb3V0ZXMgYXR0cmlidXRlIGZvcm1hdHRpbmcgdG8gdGhlIGFwcHJvcHJpYXRlIHR5cGUtc3BlY2lmaWMgZm9ybWF0dGVyLlxuICogXG4gKiBDb252ZW5pZW5jZSBmdW5jdGlvbiB0aGF0IGRlbGVnYXRlcyB0byBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yQ3JlYXRlLFxuICogZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvclVwZGF0ZSwgb3IgZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckRldGFpbCBiYXNlZCBvbiB0eXBlLlxuICogXG4gKiBAcGFyYW0gcHJvcGVydGllcyAtIEFycmF5IG9mIGVudGl0eSBhdHRyaWJ1dGVzIHRvIGZvcm1hdFxuICogQHBhcmFtIHR5cGUgLSBQYWdlIHR5cGU6ICdjcmVhdGUnLCAndXBkYXRlJywgb3IgJ2RldGFpbCdcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gRW50aXR5IHNlcnZpY2UgZm9yIGFjY2Vzc2luZyBzY2hlbWFzXG4gKiBAcmV0dXJucyBBcnJheSBvZiBmb3JtYXR0ZWQgZmllbGQgbWV0YWRhdGFcbiAqIEB0aHJvd3MgRXJyb3IgaWYgaW52YWxpZCB0eXBlIGlzIHByb3ZpZGVkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRm9ybU9yRGV0YWlsKFxuICAgIHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLFxuICAgIHR5cGU6ICdjcmVhdGUnIHwgJ3VwZGF0ZScgfCAnZGV0YWlsJyxcbiAgICBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+XG4pIHtcblxuICAgIGlmICh0eXBlID09PSAnY3JlYXRlJykge1xuICAgICAgICByZXR1cm4gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckNyZWF0ZShwcm9wZXJ0aWVzLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICB9XG5cbiAgICBpZiAodHlwZSA9PT0gJ3VwZGF0ZScpIHtcbiAgICAgICAgcmV0dXJuIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JVcGRhdGUocHJvcGVydGllcywgZW50aXR5U2VydmljZSk7XG4gICAgfVxuXG4gICAgaWYgKHR5cGUgPT09ICdkZXRhaWwnKSB7XG4gICAgICAgIHJldHVybiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRGV0YWlsKHByb3BlcnRpZXMsIGVudGl0eVNlcnZpY2UpO1xuICAgIH1cbiAgICB0aHJvdyAoYEludmFsaWQgdHlwZSBbJHt0eXBlfV0gcHJvdmlkZWQgdG8gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckZvcm1PckRldGFpbGApO1xufVxuXG4vKipcbiAqIEV4cGFuZHMgc2hvcnRoYW5kIGZpZWxkIHJlZmVyZW5jZXMgaW50byBmdWxsIFByb3BlcnR5Q29uZmlnIG9iamVjdHMuXG4gKiBcbiAqICoqRW50ZXJwcmlzZS1HcmFkZSBQYXR0ZXJuIFN1cHBvcnRpbmc6KipcbiAqIFxuICogMS4gKipTdHJpbmcgc2hvcnRoYW5kIChzY2hlbWEgZmllbGRzIG9ubHkpOioqIGAnZmllbGROYW1lJ2Ag4oaSIGxvb2tzIHVwIGluIHNjaGVtYSwgZXhwYW5kcyB0byBmdWxsIGNvbmZpZ1xuICogMi4gKipPYmplY3Qgd2l0aCBzY2hlbWEgZmllbGQ6KiogYHsgbmFtZTogJ3N0YXR1cycsIGZpZWxkVHlwZTogJ2JhZGdlJyB9YCDihpIgbWVyZ2VzIG92ZXJyaWRlcyB3aXRoIHNjaGVtYSBkZWZhdWx0c1xuICogMy4gKipKU09OIHBhdGggKG5lc3RlZCBkYXRhKToqKiBgeyBuYW1lOiAndXNlckVtYWlsJywgY29sdW1uOiAndXNlci5lbWFpbCcsIGxhYmVsOiAnRW1haWwnLCBmaWVsZFR5cGU6ICd0ZXh0JyB9YFxuICogNC4gKipNdWx0aXBsZSByZW5kZXJpbmdzOioqIGB7IG5hbWU6ICdzdGF0dXNCYWRnZScsIGNvbHVtbjogJ3N0YXR1cycsIGZpZWxkVHlwZTogJ2JhZGdlJyB9YCArIGB7IG5hbWU6ICdzdGF0dXNUZXh0JywgY29sdW1uOiAnc3RhdHVzJywgZmllbGRUeXBlOiAndGV4dCcgfWBcbiAqIDUuICoqQ3VzdG9tL2NvbXB1dGVkIGZpZWxkczoqKiBgeyBuYW1lOiAnY29uZmlybVBhc3N3b3JkJywgbGFiZWw6ICdDb25maXJtJywgY29sdW1uOiAnY29uZmlybVBhc3N3b3JkJywgZmllbGRUeXBlOiAncGFzc3dvcmQnIH1gXG4gKiA2LiAqKlZpc2liaWxpdHkgY29udHJvbDoqKiBBbGwgY29uZmlncyBzdXBwb3J0IGB2aXNpYmlsaXR5OiBWaXNpYmlsaXR5Q29uZmlnYCBmb3Igcm9sZS1iYXNlZC9jb25kaXRpb25hbCBkaXNwbGF5XG4gKiBcbiAqICoqS2V5IENvbmNlcHRzOioqXG4gKiAtIGBuYW1lYDogVW5pcXVlIFVJIGlkZW50aWZpZXIgKG11c3QgYmUgdW5pcXVlIHdpdGhpbiBhIHNpbmdsZSBwcm9wZXJ0aWVzQ29uZmlnKVxuICogLSBgY29sdW1uYDogRGF0YSBwYXRoIC0gY2FuIGJlIGRpcmVjdCBmaWVsZCwgSlNPTiBwYXRoIChgdXNlci5lbWFpbGApLCBvciBjdXN0b20gZmllbGRcbiAqIC0gRnJvbnRlbmQgdXNlcyBgZ2V0TmVzdGVkVmFsdWUocmVjb3JkLCBjb2x1bW4pYCBmb3IgZGF0YSBhY2Nlc3MgKHN1cHBvcnRzIEpTT04gcGF0aHMpXG4gKiBcbiAqIFRoaXMgaXMgdGhlIHByb3BlcnR5IGVxdWl2YWxlbnQgb2YgYG5vcm1hbGl6ZUNvbHVtbk92ZXJyaWRlcygpYC5cbiAqIFxuICogQHBhcmFtIGZpZWxkUmVmZXJlbmNlcyAtIEFycmF5IGNvbnRhaW5pbmcgc3RyaW5ncyAoZmllbGQgbmFtZXMpIG9yIFByb3BlcnR5Q29uZmlnIG9iamVjdHNcbiAqIEBwYXJhbSBhbGxQcm9wZXJ0aWVzIC0gQWxsIGVudGl0eSBhdHRyaWJ1dGVzIGZyb20gc2NoZW1hIGZvciBmaWVsZCBsb29rdXBcbiAqIEBwYXJhbSB0eXBlIC0gUGFnZSB0eXBlOiAnY3JlYXRlJywgJ3VwZGF0ZScsIG9yICdkZXRhaWwnIChkZXRlcm1pbmVzIGZvcm1hdHRpbmcpXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIGZvciBhY2Nlc3NpbmcgcmVsYXRlZCBzY2hlbWFzXG4gKiBAcGFyYW0gZ2xvYmFsVUlDb25maWdPcHRpb25zIC0gT3B0aW9uYWwgZ2xvYmFsIFVJIGNvbmZpZ3VyYXRpb24gb3B0aW9uc1xuICogQHJldHVybnMgQXJyYXkgb2YgZnVsbCBQcm9wZXJ0eUNvbmZpZyBvYmplY3RzXG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyAxLiBTdHJpbmcgc2hvcnRoYW5kIChzY2hlbWEgZmllbGRzIG9ubHkpXG4gKiBwcm9wZXJ0aWVzQ29uZmlnOiBbJ3RlYW1OYW1lJywgJ2NpdHknLCAnc3RhdHVzJ11cbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIDIuIE92ZXJyaWRlIHNjaGVtYSBmaWVsZCBkaXNwbGF5XG4gKiBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gKiAgICd0ZWFtTmFtZScsXG4gKiAgIHsgbmFtZTogJ3N0YXR1cycsIGZpZWxkVHlwZTogJ2JhZGdlJyB9LCAgLy8gU2FtZSBmaWVsZCwgZGlmZmVyZW50IHJlbmRlcmluZ1xuICogICAndG90YWwnXG4gKiBdXG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyAzLiBNdWx0aXBsZSByZW5kZXJpbmdzIG9mIHNhbWUgZmllbGRcbiAqIHByb3BlcnRpZXNDb25maWc6IFtcbiAqICAgeyBuYW1lOiAncHJvZ3Jlc3NCYXInLCBjb2x1bW46ICdwcm9ncmVzcycsIGxhYmVsOiAnUHJvZ3Jlc3MnLCBmaWVsZFR5cGU6ICdwcm9ncmVzcycgfSxcbiAqICAgeyBuYW1lOiAncHJvZ3Jlc3NWYWx1ZScsIGNvbHVtbjogJ3Byb2dyZXNzJywgbGFiZWw6ICdWYWx1ZScsIGZpZWxkVHlwZTogJ251bWJlcicgfVxuICogXVxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gNC4gSlNPTiBwYXRocyAobmVzdGVkIGRhdGEpXG4gKiBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gKiAgICd0ZWFtTmFtZScsXG4gKiAgIHsgbmFtZTogJ3VzZXJFbWFpbCcsIGNvbHVtbjogJ3VzZXIuZW1haWwnLCBsYWJlbDogJ0VtYWlsJywgZmllbGRUeXBlOiAndGV4dCcgfSxcbiAqICAgeyBuYW1lOiAnc2V0dGluZ3NUaGVtZScsIGNvbHVtbjogJ21ldGFkYXRhLnNldHRpbmdzLnRoZW1lJywgbGFiZWw6ICdUaGVtZScsIGZpZWxkVHlwZTogJ3RleHQnIH1cbiAqIF1cbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIDUuIEN1c3RvbS9jb21wdXRlZCBmaWVsZHMgKG5vdCBpbiBzY2hlbWEsIEFQSSBwcm92aWRlcyB0aGVtKVxuICogcHJvcGVydGllc0NvbmZpZzogW1xuICogICAncGFzc3dvcmQnLFxuICogICB7XG4gKiAgICAgbmFtZTogJ2NvbmZpcm1QYXNzd29yZCcsXG4gKiAgICAgbGFiZWw6ICdDb25maXJtIFBhc3N3b3JkJyxcbiAqICAgICBjb2x1bW46ICdjb25maXJtUGFzc3dvcmQnLFxuICogICAgIGZpZWxkVHlwZTogJ3Bhc3N3b3JkJyxcbiAqICAgICByZXF1aXJlZDogdHJ1ZVxuICogICB9XG4gKiBdXG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyA2LiBXaXRoIHZpc2liaWxpdHkgY29uZmlnXG4gKiBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gKiAgICd0ZWFtTmFtZScsXG4gKiAgIHtcbiAqICAgICBuYW1lOiAnYWRtaW5Ob3RlcycsXG4gKiAgICAgbGFiZWw6ICdBZG1pbiBOb3RlcycsXG4gKiAgICAgY29sdW1uOiAnYWRtaW5Ob3RlcycsXG4gKiAgICAgZmllbGRUeXBlOiAndGV4dGFyZWEnLFxuICogICAgIHZpc2liaWxpdHk6IHsgcmVxdWlyZWRSb2xlczogWydhZG1pbiddIH1cbiAqICAgfVxuICogXVxuICovXG5leHBvcnQgZnVuY3Rpb24gZXhwYW5kUHJvcGVydHlSZWZlcmVuY2VzKFxuICAgIGZpZWxkUmVmZXJlbmNlczogUmVhZG9ubHlBcnJheTxzdHJpbmcgfCBhbnk+IHwgQXJyYXk8c3RyaW5nIHwgYW55PixcbiAgICBhbGxQcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSxcbiAgICB0eXBlOiAnY3JlYXRlJyB8ICd1cGRhdGUnIHwgJ2RldGFpbCcsXG4gICAgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PixcbiAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbJ3VpQ29uZmlnR2VuT3B0aW9ucyddXG4pOiBhbnlbXSB7XG4gICAgY29uc3QgcHJvcGVydHlNYXAgPSBuZXcgTWFwPHN0cmluZywgVElPU2NoZW1hQXR0cmlidXRlPigpO1xuICAgIGFsbFByb3BlcnRpZXMuZm9yRWFjaChwcm9wID0+IHtcbiAgICAgICAgaWYgKHByb3AuaWQpIHsgLy8gVXNlIHByb3AuaWQgKGZpZWxkIGlkZW50aWZpZXIpIG5vdCBwcm9wLm5hbWUgKGh1bWFuLXJlYWRhYmxlIGxhYmVsKVxuICAgICAgICAgICAgcHJvcGVydHlNYXAuc2V0KHByb3AuaWQsIHByb3ApO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgcmV0dXJuIGZpZWxkUmVmZXJlbmNlcy5tYXAocHJvcFJlZiA9PiB7XG4gICAgICAgIC8vIENhc2UgMTogU3RyaW5nIHNob3J0aGFuZCDihpIgTVVTVCBiZSBhIGRpcmVjdCBzY2hlbWEgZmllbGQgKGNvbnZlbmllbmNlIHNob3J0Y3V0KVxuICAgICAgICBpZiAodHlwZW9mIHByb3BSZWYgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICBjb25zdCBmaWVsZEF0dHJpYnV0ZSA9IHByb3BlcnR5TWFwLmdldChwcm9wUmVmKTtcbiAgICAgICAgICAgIGlmICghZmllbGRBdHRyaWJ1dGUpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgICAgICAgIGBGaWVsZCAnJHtwcm9wUmVmfScgbm90IGZvdW5kIGluIGVudGl0eSBzY2hlbWEuIGAgK1xuICAgICAgICAgICAgICAgICAgICBgQXZhaWxhYmxlIGZpZWxkIElEczogJHtBcnJheS5mcm9tKHByb3BlcnR5TWFwLmtleXMoKSkuam9pbignLCAnKX0uIGAgK1xuICAgICAgICAgICAgICAgICAgICBgXFxuRm9yIG5vbi1zY2hlbWEgZmllbGRzIChKU09OIHBhdGhzLCBjdXN0b20gZmllbGRzLCBtdWx0aXBsZSByZW5kZXJpbmdzKSwgdXNlIG9iamVjdCBzeW50YXg6XFxuYCArXG4gICAgICAgICAgICAgICAgICAgIGAgIHsgbmFtZTogJ3VuaXF1ZU5hbWUnLCBjb2x1bW46ICcke3Byb3BSZWZ9JywgbGFiZWw6ICcuLi4nLCBmaWVsZFR5cGU6ICcuLi4nIH1gXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoZmllbGRBdHRyaWJ1dGUsIHR5cGUsIGVudGl0eVNlcnZpY2UsIGFsbFByb3BlcnRpZXMsIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIENhc2UgMi01OiBPYmplY3Qgc3ludGF4IChwZXJtaXNzaXZlIC0gc3VwcG9ydHMgZXZlcnl0aGluZylcbiAgICAgICAgaWYgKHR5cGVvZiBwcm9wUmVmID09PSAnb2JqZWN0JyAmJiBwcm9wUmVmICE9PSBudWxsKSB7XG4gICAgICAgICAgICAvLyBWYWxpZGF0ZSBtaW5pbXVtIHJlcXVpcmVkIHByb3BlcnRpZXNcbiAgICAgICAgICAgIGlmICghcHJvcFJlZi5uYW1lKSB7XG4gICAgICAgICAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBQcm9wZXJ0eSBjb25maWcgbWlzc2luZyAnbmFtZScgZmllbGQgKHJlcXVpcmVkIGZvciBVSSBpZGVudGlmaWNhdGlvbikuIFNraXBwaW5nOmAsIHByb3BSZWYpO1xuICAgICAgICAgICAgICAgIHJldHVybiBwcm9wUmVmOyAvLyBSZXR1cm4gYXMtaXMsIGxldCBmcm9udGVuZCBoYW5kbGVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gRGV0ZXJtaW5lIHRoZSBkYXRhIHBhdGggKGNvbHVtbiBjYW4gYmU6IGRpcmVjdCBmaWVsZCwgSlNPTiBwYXRoLCBvciBjdXN0b20gZmllbGQpXG4gICAgICAgICAgICBjb25zdCBjb2x1bW4gPSBwcm9wUmVmLmNvbHVtbiB8fCBwcm9wUmVmLm5hbWU7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIEV4dHJhY3QganVzdCB0aGUgcm9vdCBmaWVsZCBuYW1lIGZvciBzY2hlbWEgbG9va3VwIChoYW5kbGVzIEpTT04gcGF0aHMgbGlrZSBcInVzZXIuZW1haWxcIiDihpIgXCJ1c2VyXCIpXG4gICAgICAgICAgICBjb25zdCByb290RmllbGROYW1lID0gY29sdW1uLnNwbGl0KCcuJylbMF07XG4gICAgICAgICAgICBjb25zdCBmaWVsZEF0dHJpYnV0ZSA9IHByb3BlcnR5TWFwLmdldChyb290RmllbGROYW1lKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gSWYgcm9vdCBmaWVsZCBleGlzdHMgaW4gc2NoZW1hIEFORCBjb2x1bW4gaXMgdGhlIGV4YWN0IGZpZWxkIChub3QgYSBwYXRoKSwgbWVyZ2Ugd2l0aCBzY2hlbWFcbiAgICAgICAgICAgIGlmIChmaWVsZEF0dHJpYnV0ZSAmJiBjb2x1bW4gPT09IHJvb3RGaWVsZE5hbWUpIHtcbiAgICAgICAgICAgICAgICAvLyBTY2hlbWEgZmllbGQgd2l0aCBvdmVycmlkZXMgLSBtZXJnZSBkZWZhdWx0cyArIG92ZXJyaWRlc1xuICAgICAgICAgICAgICAgIGNvbnN0IHNjaGVtYURlZmF1bHRzID0gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKGZpZWxkQXR0cmlidXRlLCB0eXBlLCBlbnRpdHlTZXJ2aWNlLCBhbGxQcm9wZXJ0aWVzLCBnbG9iYWxVSUNvbmZpZ09wdGlvbnMpO1xuICAgICAgICAgICAgICAgIHJldHVybiB7IFxuICAgICAgICAgICAgICAgICAgICAuLi5zY2hlbWFEZWZhdWx0cyxcbiAgICAgICAgICAgICAgICAgICAgLi4ucHJvcFJlZiwgIC8vIFVzZXIgb3ZlcnJpZGVzIHRha2UgcHJlY2VkZW5jZVxuICAgICAgICAgICAgICAgICAgICBjb2x1bW4gIC8vIEVuc3VyZSBjb2x1bW4gaXMgc2V0XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gT3RoZXJ3aXNlOiBKU09OIHBhdGgsIGN1c3RvbSBmaWVsZCwgb3IgbXVsdGlwbGUgcmVuZGVyaW5nIG9mIHNhbWUgZmllbGRcbiAgICAgICAgICAgIC8vIEF1dG8tZ2VuZXJhdGUgbWlzc2luZyBwcm9wZXJ0aWVzIHdpdGggcHJvcGVyIGZvcm1hdHRpbmdcbiAgICAgICAgICAgIGNvbnN0IGxhYmVsID0gcHJvcFJlZi5sYWJlbCB8fCB0b0h1bWFuUmVhZGFibGVOYW1lKHByb3BSZWYubmFtZSk7XG4gICAgICAgICAgICBjb25zdCBmaWVsZFR5cGUgPSBwcm9wUmVmLmZpZWxkVHlwZSB8fCAndGV4dCc7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFdhcm4gaWYgbGFiZWwgd2FzIGF1dG8tZ2VuZXJhdGVkXG4gICAgICAgICAgICBpZiAoIXByb3BSZWYubGFiZWwpIHtcbiAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLmRlYnVnKFxuICAgICAgICAgICAgICAgICAgICBgUHJvcGVydHkgJyR7cHJvcFJlZi5uYW1lfScgbWlzc2luZyAnbGFiZWwnLiBBdXRvLWdlbmVyYXRlZDogJyR7bGFiZWx9Jy4gYCArXG4gICAgICAgICAgICAgICAgICAgIGBGb3IgY3VzdG9tIGZpZWxkcywgZXhwbGljaXRseSBwcm92aWRlOiBuYW1lLCBsYWJlbCwgY29sdW1uLCBmaWVsZFR5cGUuYFxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIXByb3BSZWYuZmllbGRUeXBlKSB7XG4gICAgICAgICAgICAgICAgRGVmYXVsdExvZ2dlci5kZWJ1ZyhcbiAgICAgICAgICAgICAgICAgICAgYFByb3BlcnR5ICcke3Byb3BSZWYubmFtZX0nIG1pc3NpbmcgJ2ZpZWxkVHlwZScuIERlZmF1bHRlZCB0byAndGV4dCcuIGAgK1xuICAgICAgICAgICAgICAgICAgICBgUmVjb21tZW5kZWQgZmllbGQgdHlwZXM6IHRleHQsIG51bWJlciwgc2VsZWN0LCBiYWRnZSwgcHJvZ3Jlc3MsIGV0Yy5gXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gUmV0dXJuIHdpdGggcHJvcGVyIGZvcm1hdHRpbmdcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgLi4ucHJvcFJlZixcbiAgICAgICAgICAgICAgICBjb2x1bW4sXG4gICAgICAgICAgICAgICAgbGFiZWwsXG4gICAgICAgICAgICAgICAgZmllbGRUeXBlXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBGYWxsYmFjazogdW5rbm93biB0eXBlLCByZXR1cm4gYXMtaXMgd2l0aCB3YXJuaW5nXG4gICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgVW5rbm93biBwcm9wZXJ0eSByZWZlcmVuY2UgdHlwZTpgLCBwcm9wUmVmKTtcbiAgICAgICAgcmV0dXJuIHByb3BSZWY7XG4gICAgfSk7XG59XG5cbi8qKlxuICogUHJvY2Vzc2VzIHNlY3Rpb25zQ29uZmlnIGFuZCBleHBhbmRzIGFueSBzaG9ydGhhbmQgcHJvcGVydGllc0NvbmZpZyBhcnJheXMuXG4gKiBcbiAqICoqVW5pZmllZCB3aXRoIGNvbHVtbiBwcm9jZXNzaW5nOioqXG4gKiAtIFVzZXMgYGV4cGFuZFByb3BlcnR5UmVmZXJlbmNlcygpYCAoc2FtZSBwYXR0ZXJuIGFzIGBub3JtYWxpemVDb2x1bW5PdmVycmlkZXMoKWApXG4gKiAtIFN0cmluZyBzaG9ydGhhbmQgYCdmaWVsZE5hbWUnYCDihpIgZXhwYW5kcyBmcm9tIHNjaGVtYVxuICogLSBPYmplY3Qgc3ludGF4IOKGkiBtZXJnZXMgd2l0aCBzY2hlbWEgZGVmYXVsdHNcbiAqIFxuICogUmVjdXJzaXZlbHkgd2Fsa3MgdGhyb3VnaCBzZWN0aW9uIGdyb3VwcyBhbmQgc2VjdGlvbnMuXG4gKiBcbiAqIEBwYXJhbSBzZWN0aW9uc0NvbmZpZyAtIFNlY3Rpb25zIGNvbmZpZ3VyYXRpb24gZnJvbSBlbnRpdHkgc2NoZW1hXG4gKiBAcGFyYW0gYWxsUHJvcGVydGllcyAtIEFsbCBlbnRpdHkgYXR0cmlidXRlcyBmcm9tIHNjaGVtYSBmb3IgZmllbGQgbG9va3VwXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIGZvciBhY2Nlc3NpbmcgcmVsYXRlZCBzY2hlbWFzXG4gKiBAcGFyYW0gZ2xvYmFsVUlDb25maWdPcHRpb25zIC0gT3B0aW9uYWwgZ2xvYmFsIFVJIGNvbmZpZ3VyYXRpb24gb3B0aW9uc1xuICogQHJldHVybnMgUHJvY2Vzc2VkIHNlY3Rpb25zIGNvbmZpZyB3aXRoIGV4cGFuZGVkIHByb3BlcnRpZXNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHByb2Nlc3NTZWN0aW9uc0NvbmZpZyhcbiAgICBzZWN0aW9uc0NvbmZpZzogYW55LFxuICAgIGFsbFByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLFxuICAgIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sXG4gICAgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyd1aUNvbmZpZ0dlbk9wdGlvbnMnXVxuKTogYW55IHtcbiAgICBpZiAoIXNlY3Rpb25zQ29uZmlnKSByZXR1cm4gc2VjdGlvbnNDb25maWc7XG4gICAgXG4gICAgY29uc3QgcHJvY2Vzc2VkID0geyAuLi5zZWN0aW9uc0NvbmZpZyB9O1xuICAgIFxuICAgIC8vIFByb2Nlc3Mgc2VjdGlvbnMgaW4gc2luZ2xlIGdyb3VwIGZvcm1hdCAoYmFja3dhcmQgY29tcGF0aWJsZSlcbiAgICBpZiAocHJvY2Vzc2VkLnNlY3Rpb25zKSB7XG4gICAgICAgIHByb2Nlc3NlZC5zZWN0aW9ucyA9IE9iamVjdC5lbnRyaWVzKHByb2Nlc3NlZC5zZWN0aW9ucykucmVkdWNlKChhY2MsIFtrZXksIHNlY3Rpb25dOiBbc3RyaW5nLCBhbnldKSA9PiB7XG4gICAgICAgICAgICBhY2Nba2V5XSA9IHByb2Nlc3NTZWN0aW9uQ29uZmlnKHNlY3Rpb24sIGFsbFByb3BlcnRpZXMsIGVudGl0eVNlcnZpY2UsIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyk7XG4gICAgICAgICAgICByZXR1cm4gYWNjO1xuICAgICAgICB9LCB7fSBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+KTtcbiAgICB9XG4gICAgXG4gICAgLy8gUHJvY2VzcyBzZWN0aW9uIGdyb3VwcyAobmV3IGZvcm1hdClcbiAgICBpZiAocHJvY2Vzc2VkLnNlY3Rpb25Hcm91cHMpIHtcbiAgICAgICAgcHJvY2Vzc2VkLnNlY3Rpb25Hcm91cHMgPSBwcm9jZXNzZWQuc2VjdGlvbkdyb3Vwcy5tYXAoKGdyb3VwOiBhbnkpID0+IHtcbiAgICAgICAgICAgIGlmICghZ3JvdXAuc2VjdGlvbnMpIHJldHVybiBncm91cDtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAuLi5ncm91cCxcbiAgICAgICAgICAgICAgICBzZWN0aW9uczogT2JqZWN0LmVudHJpZXMoZ3JvdXAuc2VjdGlvbnMpLnJlZHVjZSgoYWNjLCBba2V5LCBzZWN0aW9uXTogW3N0cmluZywgYW55XSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBhY2Nba2V5XSA9IHByb2Nlc3NTZWN0aW9uQ29uZmlnKHNlY3Rpb24sIGFsbFByb3BlcnRpZXMsIGVudGl0eVNlcnZpY2UsIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBhY2M7XG4gICAgICAgICAgICAgICAgfSwge30gYXMgUmVjb3JkPHN0cmluZywgYW55PilcbiAgICAgICAgICAgIH07XG4gICAgICAgIH0pO1xuICAgIH1cbiAgICBcbiAgICByZXR1cm4gcHJvY2Vzc2VkO1xufVxuXG4vKipcbiAqIFByb2Nlc3NlcyBhIHNpbmdsZSBzZWN0aW9uIGNvbmZpZyBhbmQgZXhwYW5kcyBzaG9ydGhhbmQgcHJvcGVydGllc0NvbmZpZy5cbiAqIFxuICogVXNlcyB1bmlmaWVkIGBleHBhbmRQcm9wZXJ0eVJlZmVyZW5jZXMoKWAgZnVuY3Rpb24uXG4gKiBcbiAqIEBwYXJhbSBzZWN0aW9uIC0gU2VjdGlvbiBjb25maWd1cmF0aW9uXG4gKiBAcGFyYW0gYWxsUHJvcGVydGllcyAtIEFsbCBlbnRpdHkgYXR0cmlidXRlcyBmcm9tIHNjaGVtYVxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZVxuICogQHBhcmFtIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyAtIE9wdGlvbmFsIGdsb2JhbCBVSSBjb25maWd1cmF0aW9uIG9wdGlvbnNcbiAqIEByZXR1cm5zIFByb2Nlc3NlZCBzZWN0aW9uIHdpdGggZXhwYW5kZWQgcHJvcGVydGllc1xuICovXG5mdW5jdGlvbiBwcm9jZXNzU2VjdGlvbkNvbmZpZyhcbiAgICBzZWN0aW9uOiBhbnksXG4gICAgYWxsUHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sXG4gICAgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PixcbiAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbJ3VpQ29uZmlnR2VuT3B0aW9ucyddXG4pOiBhbnkge1xuICAgIGNvbnN0IHByb2Nlc3NlZCA9IHsgLi4uc2VjdGlvbiB9O1xuICAgIFxuICAgIC8vIFByb2Nlc3MgZGV0YWlsc1BhZ2VDb25maWcgd2l0aCBwcm9wZXJ0aWVzQ29uZmlnXG4gICAgaWYgKHByb2Nlc3NlZC5wYWdlVHlwZSA9PT0gJ2RldGFpbHMnICYmIHByb2Nlc3NlZC5kZXRhaWxzUGFnZUNvbmZpZz8ucHJvcGVydGllc0NvbmZpZykge1xuICAgICAgICBjb25zdCBjb25maWcgPSBwcm9jZXNzZWQuZGV0YWlsc1BhZ2VDb25maWc7XG4gICAgICAgIHByb2Nlc3NlZC5kZXRhaWxzUGFnZUNvbmZpZyA9IHtcbiAgICAgICAgICAgIC4uLmNvbmZpZyxcbiAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IGV4cGFuZFByb3BlcnR5UmVmZXJlbmNlcyhcbiAgICAgICAgICAgICAgICBjb25maWcucHJvcGVydGllc0NvbmZpZyxcbiAgICAgICAgICAgICAgICBhbGxQcm9wZXJ0aWVzLFxuICAgICAgICAgICAgICAgICdkZXRhaWwnLFxuICAgICAgICAgICAgICAgIGVudGl0eVNlcnZpY2UsXG4gICAgICAgICAgICAgICAgZ2xvYmFsVUlDb25maWdPcHRpb25zXG4gICAgICAgICAgICApXG4gICAgICAgIH07XG4gICAgfVxuICAgIFxuICAgIC8vIFByb2Nlc3MgZm9ybVBhZ2VDb25maWdcbiAgICBpZiAocHJvY2Vzc2VkLnBhZ2VUeXBlID09PSAnZm9ybScgJiYgcHJvY2Vzc2VkLmZvcm1QYWdlQ29uZmlnPy5wcm9wZXJ0aWVzQ29uZmlnKSB7XG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IHByb2Nlc3NlZC5mb3JtUGFnZUNvbmZpZztcbiAgICAgICAgLy8gRm9ybXMgaW4gc2VjdGlvbnMgYXJlIHR5cGljYWxseSAnY3JlYXRlJyBmb3Jtc1xuICAgICAgICBwcm9jZXNzZWQuZm9ybVBhZ2VDb25maWcgPSB7XG4gICAgICAgICAgICAuLi5jb25maWcsXG4gICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnOiBleHBhbmRQcm9wZXJ0eVJlZmVyZW5jZXMoXG4gICAgICAgICAgICAgICAgY29uZmlnLnByb3BlcnRpZXNDb25maWcsXG4gICAgICAgICAgICAgICAgYWxsUHJvcGVydGllcyxcbiAgICAgICAgICAgICAgICAnY3JlYXRlJyxcbiAgICAgICAgICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuICAgICAgICAgICAgICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9uc1xuICAgICAgICAgICAgKVxuICAgICAgICB9O1xuICAgIH1cbiAgICBcbiAgICByZXR1cm4gcHJvY2Vzc2VkO1xufVxuXG4vKipcbiAqIEZvcm1hdHMgZW50aXR5IGF0dHJpYnV0ZXMgZm9yIGNyZWF0ZSBmb3JtIHBhZ2VzLlxuICogXG4gKiBGaWx0ZXJzIGF0dHJpYnV0ZXMgdG8gaW5jbHVkZSBvbmx5IGNyZWF0YWJsZSBmaWVsZHMgKHJlc3BlY3RzIGlzQ3JlYXRhYmxlIGZsYWcpXG4gKiBhbmQgZm9ybWF0cyBlYWNoIGZvciBjcmVhdGUgZm9ybSBkaXNwbGF5LlxuICogXG4gKiBAcGFyYW0gcHJvcGVydGllcyAtIEFycmF5IG9mIGVudGl0eSBhdHRyaWJ1dGVzIGZyb20gc2NoZW1hXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIGZvciBhY2Nlc3NpbmcgcmVsYXRlZCBzY2hlbWFzXG4gKiBAcGFyYW0gZ2xvYmFsVUlDb25maWdPcHRpb25zIC0gT3B0aW9uYWwgZ2xvYmFsIFVJIGNvbmZpZ3VyYXRpb24gb3B0aW9uc1xuICogQHJldHVybnMgQXJyYXkgb2YgZm9ybWF0dGVkIGZpZWxkIG1ldGFkYXRhIGZvciBjcmVhdGUgZm9ybXNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JDcmVhdGUocHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sgJ3VpQ29uZmlnR2VuT3B0aW9ucycgXSkge1xuICAgIHJldHVybiBwcm9wZXJ0aWVzXG4gICAgICAgIC5maWx0ZXIocHJvcCA9PiBwcm9wICYmICghcHJvcC5oYXNPd25Qcm9wZXJ0eSgnaXNDcmVhdGFibGUnKSB8fCBwcm9wLmlzQ3JlYXRhYmxlKSlcbiAgICAgICAgLm1hcCgoYXR0KSA9PiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoYXR0LCAnY3JlYXRlJywgZW50aXR5U2VydmljZSwgcHJvcGVydGllcywgZ2xvYmFsVUlDb25maWdPcHRpb25zKSk7XG59XG5cbi8qKlxuICogRm9ybWF0cyBlbnRpdHkgYXR0cmlidXRlcyBmb3IgdXBkYXRlL2VkaXQgZm9ybSBwYWdlcy5cbiAqIFxuICogRmlsdGVycyBhdHRyaWJ1dGVzIHRvIGluY2x1ZGUgb25seSBlZGl0YWJsZSBmaWVsZHMgKHJlc3BlY3RzIGlzRWRpdGFibGUgZmxhZylcbiAqIGFuZCBmb3JtYXRzIGVhY2ggZm9yIHVwZGF0ZSBmb3JtIGRpc3BsYXkuXG4gKiBcbiAqIEBwYXJhbSBwcm9wZXJ0aWVzIC0gQXJyYXkgb2YgZW50aXR5IGF0dHJpYnV0ZXMgZnJvbSBzY2hlbWFcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gRW50aXR5IHNlcnZpY2UgZm9yIGFjY2Vzc2luZyByZWxhdGVkIHNjaGVtYXNcbiAqIEBwYXJhbSBnbG9iYWxVSUNvbmZpZ09wdGlvbnMgLSBPcHRpb25hbCBnbG9iYWwgVUkgY29uZmlndXJhdGlvbiBvcHRpb25zXG4gKiBAcmV0dXJucyBBcnJheSBvZiBmb3JtYXR0ZWQgZmllbGQgbWV0YWRhdGEgZm9yIHVwZGF0ZSBmb3Jtc1xuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvclVwZGF0ZShwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSwgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PiwgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyAndWlDb25maWdHZW5PcHRpb25zJyBdKSB7XG4gICAgcmV0dXJuIHByb3BlcnRpZXNcbiAgICAgICAgLmZpbHRlcihwcm9wID0+IHByb3AgJiYgKCFwcm9wLmhhc093blByb3BlcnR5KCdpc0VkaXRhYmxlJykgfHwgcHJvcC5pc0VkaXRhYmxlKSlcbiAgICAgICAgLm1hcCgoYXR0KSA9PiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoYXR0LCAndXBkYXRlJywgZW50aXR5U2VydmljZSwgcHJvcGVydGllcywgZ2xvYmFsVUlDb25maWdPcHRpb25zKSk7XG59XG5cbi8qKlxuICogRm9ybWF0cyBlbnRpdHkgYXR0cmlidXRlcyBmb3IgZGV0YWlsL3ZpZXcgcGFnZXMuXG4gKiBcbiAqIEZpbHRlcnMgYXR0cmlidXRlcyB0byBpbmNsdWRlIG9ubHkgdmlzaWJsZSBmaWVsZHMgKHJlc3BlY3RzIGlzVmlzaWJsZSBmbGFnKVxuICogYW5kIGZvcm1hdHMgZWFjaCBmb3IgZGV0YWlsIHBhZ2UgZGlzcGxheS5cbiAqIFxuICogQHBhcmFtIHByb3BlcnRpZXMgLSBBcnJheSBvZiBlbnRpdHkgYXR0cmlidXRlcyBmcm9tIHNjaGVtYVxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSBmb3IgYWNjZXNzaW5nIHJlbGF0ZWQgc2NoZW1hc1xuICogQHBhcmFtIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyAtIE9wdGlvbmFsIGdsb2JhbCBVSSBjb25maWd1cmF0aW9uIG9wdGlvbnNcbiAqIEByZXR1cm5zIEFycmF5IG9mIGZvcm1hdHRlZCBmaWVsZCBtZXRhZGF0YSBmb3IgZGV0YWlsIHZpZXdzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRGV0YWlsKHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLCBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+LCBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbICd1aUNvbmZpZ0dlbk9wdGlvbnMnIF0pIHtcbiAgICByZXR1cm4gcHJvcGVydGllc1xuICAgICAgICAuZmlsdGVyKHByb3AgPT4gcHJvcCAmJiAoIXByb3AuaGFzT3duUHJvcGVydHkoJ2lzVmlzaWJsZScpIHx8IHByb3AuaXNWaXNpYmxlKSlcbiAgICAgICAgLm1hcCgoYXR0KSA9PiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoYXR0LCAnZGV0YWlsJywgZW50aXR5U2VydmljZSwgcHJvcGVydGllcywgZ2xvYmFsVUlDb25maWdPcHRpb25zKSk7XG59XG5cbi8qKlxuICogVHlwZSBkZWZpbml0aW9uIGZvciBsaXN0L3RhYmxlIGNvbHVtbiBjb25maWd1cmF0aW9uLlxuICogXG4gKiBFeHRlbmRzIEZpZWxkTWV0YWRhdGEgd2l0aCBsaXN0LXNwZWNpZmljIHByb3BlcnRpZXMgbGlrZSBhY3Rpb25zLCB0ZW1wbGF0ZXMsXG4gKiBhbmQgcmVsYXRpb24gcmVuZGVyaW5nIGNvbmZpZ3VyYXRpb25zLlxuICovXG5leHBvcnQgdHlwZSBMaXN0aW5nUHJvcENvbmZpZyA9IFBpY2s8RmllbGRNZXRhZGF0YSwgJ2ZpZWxkVHlwZScgfCAncGxhY2Vob2xkZXInIHwgJ2hlbHBUZXh0JyB8ICdmaWx0ZXJDb25maWcnPiAmIHtcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgZGF0YUluZGV4OiBzdHJpbmcsXG4gICAgaGlkZGVuPzogYm9vbGVhbixcbiAgICBhY3Rpb25zPzogQXJyYXk8SUVudGl0eVBhZ2VBY3Rpb24+LFxuICAgIHJlbGF0aW9uQ29uZmlnPzogSVJlbGF0aW9uRmllbGRDb25maWcsICAvLyBGb3IgcmVuZGVyaW5nIHJlbGF0aW9ucyB3aXRoIGxpbmtzL21vZGFsc1xuICAgIHRlbXBsYXRlPzogVGVtcGxhdGUsICAvLyBGb3IgdGVtcGxhdGUtYmFzZWQgcmVuZGVyaW5nXG4gICAgaXNJZGVudGlmaWVyPzogYm9vbGVhbiwgIC8vIEZvciBpZGVudGlmaWVyIGZpZWxkc1xuICAgIGlzTGluaz86IGJvb2xlYW4sICAvLyBGb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxuICAgIGxpbmtDb25maWc/OiB7IHJvdXRlUGF0dGVybjogc3RyaW5nOyBkaXNwbGF5VGV4dD86IHN0cmluZyB9LCAgLy8gRm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbn07XG5cbi8qKlxuICogRm9ybWF0cyBlbnRpdHkgYXR0cmlidXRlcyBmb3IgbGlzdC90YWJsZSBkaXNwbGF5LlxuICogXG4gKiBUcmFuc2Zvcm1zIHNjaGVtYSBhdHRyaWJ1dGVzIGludG8gdGFibGUgY29sdW1uIGNvbmZpZ3VyYXRpb25zIHdpdGg6XG4gKiAtIEF1dG8tZ2VuZXJhdGVkIGZpbHRlciBjb25maWd1cmF0aW9ucyBmb3IgZmlsdGVyYWJsZSBjb2x1bW5zXG4gKiAtIFJlbGF0aW9uIGRpc3BsYXkgY29uZmlndXJhdGlvbnMgd2l0aCBsaW5rcyBhbmQgbW9kYWwgc3VwcG9ydFxuICogLSBUZW1wbGF0ZS1iYXNlZCByZW5kZXJpbmcgZm9yIGR1cGxpY2F0ZWQgcmVsYXRpb24gZmllbGRzXG4gKiAtIFByb3BlciBmaWVsZCB0eXBlcyBhbmQgdmlzaWJpbGl0eSBoYW5kbGluZ1xuICogXG4gKiBUaGlzIGlzIHRoZSBtYWluIGVudHJ5IHBvaW50IGZvciBnZW5lcmF0aW5nIHRhYmxlIGNvbHVtbiBjb25maWd1cmF0aW9ucyBmcm9tIGVudGl0eSBzY2hlbWFzLlxuICogXG4gKiBAcGFyYW0gZW50aXR5TmFtZSAtIE5hbWUgb2YgdGhlIGVudGl0eSAoZm9yIGdlbmVyYXRpbmcgcm91dGUgcGF0dGVybnMpXG4gKiBAcGFyYW0gcHJvcGVydGllcyAtIEFycmF5IG9mIGVudGl0eSBhdHRyaWJ1dGVzIGZyb20gc2NoZW1hXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIGZvciBhY2Nlc3NpbmcgcmVsYXRlZCBzY2hlbWFzXG4gKiBAcGFyYW0gZ2xvYmFsVUlDb25maWdPcHRpb25zIC0gT3B0aW9uYWwgZ2xvYmFsIFVJIGNvbmZpZ3VyYXRpb24gb3B0aW9uc1xuICogQHJldHVybnMgQXJyYXkgb2YgZm9ybWF0dGVkIGNvbHVtbiBjb25maWd1cmF0aW9ucyBmb3IgdGFibGUgZGlzcGxheVxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY29uc3QgY29sdW1ucyA9IGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JMaXN0KFxuICogICAnZ2FtZScsXG4gKiAgIGdhbWVTY2hlbWEuYXR0cmlidXRlcyxcbiAqICAgZ2FtZVNlcnZpY2UsXG4gKiAgIGdsb2JhbENvbmZpZ1xuICogKTtcbiAqIC8vIFJldHVybnMgYXJyYXkgb2YgY29sdW1uIGNvbmZpZ3Mgd2l0aCBmaWx0ZXJzLCByZWxhdGlvbnMsIGFuZCB0ZW1wbGF0ZXNcbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlc0Zvckxpc3QoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLFxuICAgIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sXG4gICAge1xuICAgICAgICBDUlVEQXBpUGF0aCxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pblVwZGF0ZSxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pbkRlbGV0ZSxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pbkRldGFpbCxcbiAgICAgICAgY3VzdG9tUm93QWN0aW9ucyxcbiAgICAgICAgZ2xvYmFsVUlDb25maWdPcHRpb25zXG4gICAgfToge1xuICAgICAgICBDUlVEQXBpUGF0aD86IHN0cmluZyxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pblVwZGF0ZT86IGJvb2xlYW4sXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZWxldGU/OiBib29sZWFuLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluRGV0YWlsPzogYm9vbGVhbixcbiAgICAgICAgY3VzdG9tUm93QWN0aW9ucz86IFJlYWRvbmx5QXJyYXk8SUVudGl0eVBhZ2VBY3Rpb24+IHwgQXJyYXk8SUVudGl0eVBhZ2VBY3Rpb24+LFxuICAgICAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbICd1aUNvbmZpZ0dlbk9wdGlvbnMnIF0gIC8vIE5FVzogR2xvYmFsIGNvbmZpZyBvcHRpb25zXG4gICAgfVxuKSB7XG5cbiAgICBjb25zdCBlbnRpdHlOYW1lTG93ZXIgPSBlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgZW50aXR5TmFtZVBhc2NhbENhc2UgPSBwYXNjYWxDYXNlKGVudGl0eU5hbWUpO1xuXG4gICAgcmV0dXJuIHByb3BlcnRpZXNcbiAgICAgICAgLmZpbHRlcihwcm9wID0+IHByb3AgJiYgcHJvcC5pc0xpc3RhYmxlKVxuICAgICAgICAubWFwKHByb3AgPT4ge1xuICAgICAgICAgICAgLy8gVXNlIHNhbWUgZm9ybWF0dGluZyBsb2dpYyBhcyBkZXRhaWxzL2Zvcm1zIChpbmNsdWRlcyByZWxhdGlvbkNvbmZpZyBnZW5lcmF0aW9uKVxuICAgICAgICAgICAgLy8gUGFzcyBhbGwgcHJvcGVydGllcyBzbyBpdCBjYW4gZGV0ZWN0IGR1cGxpY2F0ZWQgcmVsYXRpb24gZmllbGRzIChlLmcuLCB0ZWFtTmFtZSBmb3IgdGVhbUlkKVxuICAgICAgICAgICAgY29uc3QgZm9ybWF0dGVkID0gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKHByb3AsICdkZXRhaWwnLCBlbnRpdHlTZXJ2aWNlLCBwcm9wZXJ0aWVzLCBnbG9iYWxVSUNvbmZpZ09wdGlvbnMpO1xuXG4gICAgICAgICAgICAvLyBBdXRvLWdlbmVyYXRlIGZpbHRlckNvbmZpZyBpZiBub3QgYWxyZWFkeSBwcmVzZW50IGFuZCBmaWVsZCBpcyBmaWx0ZXJhYmxlXG4gICAgICAgICAgICBjb25zdCBhdXRvR2VuZXJhdGVkRmlsdGVyQ29uZmlnID0gIWZvcm1hdHRlZC5maWx0ZXJDb25maWcgJiYgcHJvcC5pc0ZpbHRlcmFibGUgIT09IGZhbHNlXG4gICAgICAgICAgICAgICAgPyBnZW5lcmF0ZUZpbHRlckNvbmZpZyhwcm9wLCBlbnRpdHlTZXJ2aWNlLCBnbG9iYWxVSUNvbmZpZ09wdGlvbnMpXG4gICAgICAgICAgICAgICAgOiB1bmRlZmluZWQ7XG5cbiAgICAgICAgICAgIC8vIE92ZXJyaWRlL2FkZCBsaXN0LXNwZWNpZmljIHByb3BlcnRpZXNcbiAgICAgICAgICAgIGNvbnN0IHByb3BDb25maWc6IExpc3RpbmdQcm9wQ29uZmlnID0ge1xuICAgICAgICAgICAgICAgIC4uLmZvcm1hdHRlZCxcbiAgICAgICAgICAgICAgICBuYW1lOiBmb3JtYXR0ZWQubGFiZWwgfHwgZm9ybWF0dGVkLm5hbWUsICAvLyBFbnN1cmUgbmFtZSBpcyBzZXQgZm9yIHRhYmxlIGNvbHVtbiBoZWFkZXJcbiAgICAgICAgICAgICAgICBkYXRhSW5kZXg6IGAke3Byb3AuaWR9YCxcbiAgICAgICAgICAgICAgICBmaWVsZFR5cGU6IGZvcm1hdHRlZC5maWVsZFR5cGUgfHwgJ3RleHQnLFxuICAgICAgICAgICAgICAgIGZpbHRlckNvbmZpZzogZm9ybWF0dGVkLmZpbHRlckNvbmZpZyB8fCBhdXRvR2VuZXJhdGVkRmlsdGVyQ29uZmlnLCAgLy8gVXNlIGV4cGxpY2l0IG9yIGF1dG8tZ2VuZXJhdGVkXG4gICAgICAgICAgICAgICAgaGlkZGVuOiBwcm9wLmhhc093blByb3BlcnR5KCdpc1Zpc2libGUnKSAmJiAhcHJvcC5pc1Zpc2libGVcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGlmIChwcm9wLmlzSWRlbnRpZmllcikge1xuICAgICAgICAgICAgICAgIC8vIEJ1aWxkIGRlZmF1bHQgcm93IGFjdGlvbnMgd2l0aCBJRHNcbiAgICAgICAgICAgICAgICBjb25zdCBkZWZhdWx0QWN0aW9uczogQXJyYXk8SUVudGl0eVBhZ2VBY3Rpb24+ID0gW107XG5cbiAgICAgICAgICAgICAgICBpZiAoIWV4Y2x1ZGVGcm9tQWRtaW5EZXRhaWwpIHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEFjdGlvbnMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZDogJ3ZpZXcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbjogJ3ZpZXcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdWaWV3JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRlbXBsYXRlOiBgVmlldyB7JHtwcm9wLmlkfX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiBgL3ZpZXctJHtlbnRpdHlOYW1lTG93ZXJ9YFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoIWV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGUpIHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEFjdGlvbnMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZDogJ2VkaXQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbjogJ2VkaXQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdFZGl0JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRlbXBsYXRlOiBgRWRpdCB7JHtwcm9wLmlkfX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiBgL2VkaXQtJHtlbnRpdHlOYW1lTG93ZXJ9YFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoIWV4Y2x1ZGVGcm9tQWRtaW5EZWxldGUpIHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEFjdGlvbnMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZDogJ2RlbGV0ZScsXG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uOiAnZGVsZXRlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnRGVsZXRlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRlbXBsYXRlOiBgRGVsZXRlIHske3Byb3AuaWR9fWAsXG4gICAgICAgICAgICAgICAgICAgICAgICBvcGVuSW5Nb2RhbDogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1vZGFsQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kYWxUeXBlOiAnY29uZmlybScsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kYWxQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpdGxlOiBgRGVsZXRlICR7ZW50aXR5TmFtZVBhc2NhbENhc2V9P2AsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6IGBBcmUgeW91IHN1cmUgeW91IHdhbnQgdG8gZGVsZXRlIHRoaXMgJHtlbnRpdHlOYW1lUGFzY2FsQ2FzZX0/IFRoaXMgYWN0aW9uIGNhbm5vdCBiZSB1bmRvbmUuYFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXBpQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFwaU1ldGhvZDogYERFTEVURWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc3BvbnNlS2V5OiBlbnRpdHlOYW1lTG93ZXIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFwaVVybDogYCR7Q1JVREFwaVBhdGggPyBDUlVEQXBpUGF0aCA6ICcnfS8ke2VudGl0eU5hbWVMb3dlcn1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VjY2Vzc01lc3NhZ2U6IGAke2VudGl0eU5hbWVQYXNjYWxDYXNlfSBkZWxldGVkIHN1Y2Nlc3NmdWxseWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3JNZXNzYWdlOiBgRmFpbGVkIHRvIGRlbGV0ZSAke2VudGl0eU5hbWVQYXNjYWxDYXNlfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VibWl0U3VjY2Vzc1JlZGlyZWN0OiBgL2xpc3QtJHtlbnRpdHlOYW1lTG93ZXJ9YFxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAvLyBNZXJnZSBjdXN0b20gcm93IGFjdGlvbnMgdXNpbmcgaWRlbnRpZmllci1iYXNlZCBvdmVycmlkZVxuICAgICAgICAgICAgICAgIHByb3BDb25maWcuYWN0aW9ucyA9IGN1c3RvbVJvd0FjdGlvbnNcbiAgICAgICAgICAgICAgICAgICAgPyBtZXJnZUFjdGlvbnMoZGVmYXVsdEFjdGlvbnMsIGN1c3RvbVJvd0FjdGlvbnMpXG4gICAgICAgICAgICAgICAgICAgIDogZGVmYXVsdEFjdGlvbnM7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBwcm9wQ29uZmlnO1xuICAgICAgICB9KTtcbn1cblxuLyoqXG4gKiBNRVJHRSBVVElMSVRZIEZVTkNUSU9OU1xuICogXG4gKiBUaGVzZSBmdW5jdGlvbnMgaW1wbGVtZW50IHRoZSBpZGVudGlmaWVyLWJhc2VkIG92ZXJyaWRlIHBhdHRlcm46XG4gKiAtIERlZmF1bHRzIGhhdmUgc3RhbmRhcmQgaWRlbnRpZmllcnMgKGUuZy4sICd2aWV3JywgJ2VkaXQnLCAnZGVsZXRlJylcbiAqIC0gQ3VzdG9tIGNvbmZpZ3Mgd2l0aCBzYW1lIGlkZW50aWZpZXIgb3ZlcnJpZGUgdGhlIGRlZmF1bHRcbiAqIC0gTmV3IGlkZW50aWZpZXJzIGdldCBhZGRlZCB0byB0aGUgcmVzdWx0XG4gKi9cblxuLyoqXG4gKiBNZXJnZSBkZWZhdWx0IGJ1dHRvbnMgd2l0aCBjdXN0b20gYnV0dG9ucyB1c2luZyBpZGVudGlmaWVyLWJhc2VkIG92ZXJyaWRlLlxuICogXG4gKiBAcGFyYW0gZGVmYXVsdHMgLSBEZWZhdWx0IGJ1dHRvbnMgKGZyb20gZ2VuZXJhdG9yKVxuICogQHBhcmFtIGN1c3RvbXMgLSBDdXN0b20gYnV0dG9ucyAoZnJvbSBlbnRpdHkgc2NoZW1hKVxuICogQHJldHVybnMgTWVyZ2VkIGJ1dHRvbiBhcnJheVxuICovXG4vKipcbiAqIE1lcmdlcyBkZWZhdWx0IGJ1dHRvbnMgd2l0aCBjdXN0b20gYnV0dG9ucyB1c2luZyBJRC1iYXNlZCBvdmVycmlkZSBsb2dpYy5cbiAqIFxuICogQ3VzdG9tIGJ1dHRvbnMgd2l0aCBtYXRjaGluZyBJRHMgb3ZlcnJpZGUgZGVmYXVsdHMsIGFuZCBuZXcgY3VzdG9tIGJ1dHRvbnMgYXJlIGFwcGVuZGVkLlxuICogQnV0dG9ucyB3aXRob3V0IElEcyBhcmUgYWx3YXlzIGluY2x1ZGVkIChubyBkZWR1cGxpY2F0aW9uKS5cbiAqIFxuICogQHRlbXBsYXRlIFQgLSBCdXR0b24gdHlwZSB3aXRoIG9wdGlvbmFsIGlkIHByb3BlcnR5XG4gKiBAcGFyYW0gZGVmYXVsdHMgLSBEZWZhdWx0IGJ1dHRvbiBjb25maWd1cmF0aW9uc1xuICogQHBhcmFtIGN1c3RvbXMgLSBDdXN0b20gYnV0dG9uIGNvbmZpZ3VyYXRpb25zIHRvIG1lcmdlXG4gKiBAcmV0dXJucyBNZXJnZWQgYXJyYXkgd2l0aCBjdXN0b20gb3ZlcnJpZGVzIGFwcGxpZWRcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IGRlZmF1bHRzID0gW1xuICogICB7IGlkOiAnc2F2ZScsIGxhYmVsOiAnU2F2ZScsIGFjdGlvbjogJ3N1Ym1pdCcgfSxcbiAqICAgeyBpZDogJ2NhbmNlbCcsIGxhYmVsOiAnQ2FuY2VsJywgYWN0aW9uOiAnY2FuY2VsJyB9XG4gKiBdO1xuICogY29uc3QgY3VzdG9tcyA9IFtcbiAqICAgeyBpZDogJ3NhdmUnLCBsYWJlbDogJ1NhdmUgQ2hhbmdlcycsIGFjdGlvbjogJ3N1Ym1pdCcgfSwgLy8gT3ZlcnJpZGVcbiAqICAgeyBpZDogJ2RlbGV0ZScsIGxhYmVsOiAnRGVsZXRlJywgYWN0aW9uOiAnZGVsZXRlJyB9ICAgICAgLy8gTmV3XG4gKiBdO1xuICogY29uc3QgbWVyZ2VkID0gbWVyZ2VCdXR0b25zKGRlZmF1bHRzLCBjdXN0b21zKTtcbiAqIC8vIFJldHVybnM6IFtcbiAqIC8vICAgeyBpZDogJ3NhdmUnLCBsYWJlbDogJ1NhdmUgQ2hhbmdlcycsIGFjdGlvbjogJ3N1Ym1pdCcgfSxcbiAqIC8vICAgeyBpZDogJ2NhbmNlbCcsIGxhYmVsOiAnQ2FuY2VsJywgYWN0aW9uOiAnY2FuY2VsJyB9LFxuICogLy8gICB7IGlkOiAnZGVsZXRlJywgbGFiZWw6ICdEZWxldGUnLCBhY3Rpb246ICdkZWxldGUnIH1cbiAqIC8vIF1cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VCdXR0b25zPFQgZXh0ZW5kcyB7IGlkPzogc3RyaW5nIH0+KFxuICAgIGRlZmF1bHRzOiBBcnJheTxUPixcbiAgICBjdXN0b21zOiBSZWFkb25seUFycmF5PFQ+IHwgQXJyYXk8VD4gPSBbXVxuKTogQXJyYXk8VD4ge1xuICAgIGNvbnN0IGN1c3RvbXNBcnJheSA9IFsgLi4uY3VzdG9tcyBdOyAgLy8gQ29udmVydCB0byBtdXRhYmxlIGFycmF5XG4gICAgY29uc3QgY3VzdG9tTWFwID0gbmV3IE1hcChcbiAgICAgICAgY3VzdG9tc0FycmF5LmZpbHRlcihjID0+IGMuaWQpLm1hcChjID0+IFsgYy5pZCwgYyBdKVxuICAgICk7XG5cbiAgICAvLyBTdGFydCB3aXRoIGRlZmF1bHRzLCByZXBsYWNlIGlmIGN1c3RvbSBoYXMgc2FtZSBpZFxuICAgIGNvbnN0IG1lcmdlZCA9IGRlZmF1bHRzLm1hcChkZWZhdWx0QnRuID0+XG4gICAgICAgIGRlZmF1bHRCdG4uaWQgJiYgY3VzdG9tTWFwLmhhcyhkZWZhdWx0QnRuLmlkKVxuICAgICAgICAgICAgPyBjdXN0b21NYXAuZ2V0KGRlZmF1bHRCdG4uaWQpISAgLy8gT3ZlcnJpZGVcbiAgICAgICAgICAgIDogZGVmYXVsdEJ0blxuICAgICk7XG5cbiAgICAvLyBBZGQgY3VzdG9tIGJ1dHRvbnMgdGhhdCBkb24ndCBvdmVycmlkZSBkZWZhdWx0c1xuICAgIGN1c3RvbXNBcnJheS5mb3JFYWNoKGN1c3RvbUJ0biA9PiB7XG4gICAgICAgIGlmICghY3VzdG9tQnRuLmlkIHx8ICFkZWZhdWx0cy5zb21lKGQgPT4gZC5pZCA9PT0gY3VzdG9tQnRuLmlkKSkge1xuICAgICAgICAgICAgbWVyZ2VkLnB1c2goY3VzdG9tQnRuKTsgIC8vIEFkZCBuZXdcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIG1lcmdlZDtcbn1cblxuLyoqXG4gKiBNZXJnZXMgZGVmYXVsdCBhY3Rpb25zIHdpdGggY3VzdG9tIGFjdGlvbnMgdXNpbmcgSUQtYmFzZWQgb3ZlcnJpZGUgbG9naWMuXG4gKiBcbiAqIERlbGVnYXRlcyB0byBtZXJnZUJ1dHRvbnMgd2l0aCB0aGUgc2FtZSBiZWhhdmlvcjogY3VzdG9tIGFjdGlvbnMgd2l0aCBtYXRjaGluZyBJRHNcbiAqIG92ZXJyaWRlIGRlZmF1bHRzLCBhbmQgbmV3IGN1c3RvbSBhY3Rpb25zIGFyZSBhcHBlbmRlZC4gU2VtYW50aWNhbGx5IG5hbWVkIGZvciByb3cvdGFibGUgYWN0aW9ucy5cbiAqIFxuICogQHRlbXBsYXRlIFQgLSBBY3Rpb24gdHlwZSB3aXRoIG9wdGlvbmFsIGlkIHByb3BlcnR5XG4gKiBAcGFyYW0gZGVmYXVsdHMgLSBEZWZhdWx0IGFjdGlvbiBjb25maWd1cmF0aW9uc1xuICogQHBhcmFtIGN1c3RvbXMgLSBDdXN0b20gYWN0aW9uIGNvbmZpZ3VyYXRpb25zIHRvIG1lcmdlXG4gKiBAcmV0dXJucyBNZXJnZWQgYXJyYXkgd2l0aCBjdXN0b20gb3ZlcnJpZGVzIGFwcGxpZWRcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IGRlZmF1bHRzID0gW1xuICogICB7IGlkOiAnZWRpdCcsIGxhYmVsOiAnRWRpdCcsIGFjdGlvbjogJ2VkaXQnIH0sXG4gKiAgIHsgaWQ6ICdkZWxldGUnLCBsYWJlbDogJ0RlbGV0ZScsIGFjdGlvbjogJ2RlbGV0ZScgfVxuICogXTtcbiAqIGNvbnN0IGN1c3RvbXMgPSBbXG4gKiAgIHsgaWQ6ICdkZWxldGUnLCBsYWJlbDogJ1JlbW92ZScsIGFjdGlvbjogJ2RlbGV0ZScsIGNvbmZpcm06IHRydWUgfSAvLyBPdmVycmlkZVxuICogXTtcbiAqIGNvbnN0IG1lcmdlZCA9IG1lcmdlQWN0aW9ucyhkZWZhdWx0cywgY3VzdG9tcyk7XG4gKiAvLyBSZXR1cm5zOiBbXG4gKiAvLyAgIHsgaWQ6ICdlZGl0JywgbGFiZWw6ICdFZGl0JywgYWN0aW9uOiAnZWRpdCcgfSxcbiAqIC8vICAgeyBpZDogJ2RlbGV0ZScsIGxhYmVsOiAnUmVtb3ZlJywgYWN0aW9uOiAnZGVsZXRlJywgY29uZmlybTogdHJ1ZSB9XG4gKiAvLyBdXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlQWN0aW9uczxUIGV4dGVuZHMgeyBpZD86IHN0cmluZyB9PihcbiAgICBkZWZhdWx0czogQXJyYXk8VD4sXG4gICAgY3VzdG9tczogUmVhZG9ubHlBcnJheTxUPiB8IEFycmF5PFQ+ID0gW11cbik6IEFycmF5PFQ+IHtcbiAgICByZXR1cm4gbWVyZ2VCdXR0b25zKGRlZmF1bHRzLCBbIC4uLmN1c3RvbXMgXSk7ICAvLyBTcHJlYWQgdG8gaGFuZGxlIGJvdGggcmVhZG9ubHkgYW5kIG11dGFibGVcbn1cblxuLyoqXG4gKiBNZXJnZXMgZmllbGQtbGV2ZWwgdmlzaWJpbGl0eSwgZW5hYmxlbWVudCwgaGVscCB0ZXh0LCBhbmQgcGxhY2Vob2xkZXIgb3ZlcnJpZGVzIGludG8gYmFzZSBwcm9wZXJ0aWVzLlxuICogXG4gKiBBcHBsaWVzIGN1c3RvbSBmaWVsZCBjb25maWd1cmF0aW9ucyBmcm9tIGZvcm0vZGV0YWlsIGNvbmZpZyB0byBiYXNlIHNjaGVtYSBwcm9wZXJ0aWVzLlxuICogT25seSBtZXJnZXMgb3ZlcnJpZGVzIGZvciBmaWVsZHMgdGhhdCBleGlzdCBpbiBiYXNlIHByb3BlcnRpZXMgKHdhcm5zIGFib3V0IG5vbi1leGlzdGVudCBmaWVsZHMpLlxuICogXG4gKiBAdGVtcGxhdGUgVCAtIFByb3BlcnR5IHR5cGUgd2l0aCByZXF1aXJlZCBuYW1lIGZpZWxkXG4gKiBAcGFyYW0gYmFzZVByb3BlcnRpZXMgLSBCYXNlIGZpZWxkIHByb3BlcnRpZXMgZnJvbSBlbnRpdHkgc2NoZW1hXG4gKiBAcGFyYW0gZmllbGRPdmVycmlkZXMgLSBDdXN0b20gZmllbGQgb3ZlcnJpZGVzIGZyb20gZm9ybS9kZXRhaWwgY29uZmlndXJhdGlvblxuICogQHJldHVybnMgQmFzZSBwcm9wZXJ0aWVzIHdpdGggb3ZlcnJpZGVzIG1lcmdlZCBpblxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY29uc3QgYmFzZVByb3BzID0gW1xuICogICB7IG5hbWU6ICdlbWFpbCcsIHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSB9LFxuICogICB7IG5hbWU6ICdiaW8nLCB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IGZhbHNlIH1cbiAqIF07XG4gKiBjb25zdCBvdmVycmlkZXMgPSBbXG4gKiAgIHsgbmFtZTogJ2VtYWlsJywgaGVscFRleHQ6ICdFbnRlciBhIHZhbGlkIGVtYWlsIGFkZHJlc3MnIH0sXG4gKiAgIHsgbmFtZTogJ2JpbycsIHZpc2liaWxpdHk6IHsgY3JlYXRlOiBmYWxzZSB9IH1cbiAqIF07XG4gKiBjb25zdCBtZXJnZWQgPSBtZXJnZUZpZWxkVmlzaWJpbGl0eShiYXNlUHJvcHMsIG92ZXJyaWRlcyk7XG4gKiAvLyBSZXR1cm5zIGJhc2VQcm9wcyB3aXRoIGhlbHBUZXh0IGFuZCB2aXNpYmlsaXR5IG1lcmdlZFxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZUZpZWxkVmlzaWJpbGl0eTxUIGV4dGVuZHMgeyBuYW1lOiBzdHJpbmcgfT4oXG4gICAgYmFzZVByb3BlcnRpZXM6IEFycmF5PFQ+LFxuICAgIGZpZWxkT3ZlcnJpZGVzOiBSZWFkb25seUFycmF5PHtcbiAgICAgICAgcmVhZG9ubHkgbmFtZTogc3RyaW5nO1xuICAgICAgICByZWFkb25seSB2aXNpYmlsaXR5PzogYW55O1xuICAgICAgICByZWFkb25seSBlbmFibGVtZW50PzogYW55O1xuICAgICAgICByZWFkb25seSBoZWxwVGV4dD86IHN0cmluZztcbiAgICAgICAgcmVhZG9ubHkgcGxhY2Vob2xkZXI/OiBzdHJpbmc7XG4gICAgfT4gfCBBcnJheTx7XG4gICAgICAgIG5hbWU6IHN0cmluZztcbiAgICAgICAgdmlzaWJpbGl0eT86IGFueTtcbiAgICAgICAgZW5hYmxlbWVudD86IGFueTtcbiAgICAgICAgaGVscFRleHQ/OiBzdHJpbmc7XG4gICAgICAgIHBsYWNlaG9sZGVyPzogc3RyaW5nO1xuICAgIH0+ID0gW11cbik6IEFycmF5PFQ+IHtcbiAgICBjb25zdCBvdmVycmlkZU1hcCA9IG5ldyBNYXAoXG4gICAgICAgIFsgLi4uZmllbGRPdmVycmlkZXMgXS5tYXAoZiA9PiBbIGYubmFtZSwgZiBdKVxuICAgICk7XG5cbiAgICAvLyBWYWxpZGF0aW9uOiBXYXJuIGlmIGZpZWxkIG92ZXJyaWRlIHJlZmVyZW5jZXMgbm9uLWV4aXN0ZW50IGZpZWxkXG4gICAgZmllbGRPdmVycmlkZXMuZm9yRWFjaChvdmVycmlkZSA9PiB7XG4gICAgICAgIGlmICghYmFzZVByb3BlcnRpZXMuc29tZShwID0+IHAubmFtZSA9PT0gb3ZlcnJpZGUubmFtZSkpIHtcbiAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgRmllbGQgb3ZlcnJpZGUgXCIke292ZXJyaWRlLm5hbWV9XCIgbm90IGZvdW5kIGluIHNjaGVtYSBwcm9wZXJ0aWVzLiBUaGlzIG92ZXJyaWRlIHdpbGwgYmUgaWdub3JlZC5gKTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGJhc2VQcm9wZXJ0aWVzLm1hcChwcm9wID0+IHtcbiAgICAgICAgY29uc3Qgb3ZlcnJpZGUgPSBvdmVycmlkZU1hcC5nZXQocHJvcC5uYW1lKTtcblxuICAgICAgICBpZiAoIW92ZXJyaWRlKSByZXR1cm4gcHJvcDtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgLi4ucHJvcCxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS52aXNpYmlsaXR5ICE9PSB1bmRlZmluZWQgJiYgeyB2aXNpYmlsaXR5OiBvdmVycmlkZS52aXNpYmlsaXR5IH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmVuYWJsZW1lbnQgIT09IHVuZGVmaW5lZCAmJiB7IGVuYWJsZW1lbnQ6IG92ZXJyaWRlLmVuYWJsZW1lbnQgfSksXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUuaGVscFRleHQgIT09IHVuZGVmaW5lZCAmJiB7IGhlbHBUZXh0OiBvdmVycmlkZS5oZWxwVGV4dCB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS5wbGFjZWhvbGRlciAhPT0gdW5kZWZpbmVkICYmIHsgcGxhY2Vob2xkZXI6IG92ZXJyaWRlLnBsYWNlaG9sZGVyIH0pXG4gICAgICAgIH07XG4gICAgfSk7XG59XG5cbi8qKlxuICogTWVyZ2VzIGNvbHVtbi1sZXZlbCB2aXNpYmlsaXR5LCB3aWR0aCwgZml4ZWQgcG9zaXRpb24sIGdyb3VwaW5nIG92ZXJyaWRlcywgYW5kIG9yZGVyaW5nIGludG8gYmFzZSBwcm9wZXJ0aWVzLlxuICogXG4gKiBBcHBsaWVzIGN1c3RvbSBjb2x1bW4gY29uZmlndXJhdGlvbnMgZnJvbSB0YWJsZSBjb25maWcgdG8gYmFzZSBzY2hlbWEgcHJvcGVydGllcy5cbiAqIE9ubHkgbWVyZ2VzIG92ZXJyaWRlcyBmb3IgY29sdW1ucyB0aGF0IGV4aXN0IGluIGJhc2UgcHJvcGVydGllcyAod2FybnMgYWJvdXQgbm9uLWV4aXN0ZW50IGNvbHVtbnMpLlxuICogXG4gKiAqKlZpc2liaWxpdHkgTG9naWM6KipcbiAqIC0gV2hlbiBjb2x1bW5PdmVycmlkZXMgaXMgcHJvdmlkZWQ6XG4gKiAgIC0gRmllbGRzIElOIHRoZSBhcnJheTogVXNlIGBkZWZhdWx0VmlzaWJsZWAgKGRlZmF1bHRzIHRvIHRydWUgaWYgbm90IHNwZWNpZmllZClcbiAqICAgLSBGaWVsZHMgTk9UIElOIHRoZSBhcnJheTogU2V0IGBkZWZhdWx0VmlzaWJsZTogZmFsc2VgIChhdmFpbGFibGUgaW4gQ29sdW1uIFNldHRpbmdzIGJ1dCBub3Qgc2hvd24gYnkgZGVmYXVsdClcbiAqIC0gV2hlbiBjb2x1bW5PdmVycmlkZXMgaXMgZW1wdHkvdW5kZWZpbmVkOiBBbGwgZmllbGRzIHZpc2libGUgKGJhY2t3YXJkIGNvbXBhdGlibGUpXG4gKiBcbiAqICoqT3JkZXJpbmcgTG9naWM6KipcbiAqIC0gV2hlbiBjb2x1bW5PdmVycmlkZXMgaXMgcHJvdmlkZWQ6XG4gKiAgIC0gQ29sdW1ucyBhcmUgb3JkZXJlZCBhY2NvcmRpbmcgdG8gdGhlaXIgcG9zaXRpb24gaW4gdGhlIGNvbHVtbk92ZXJyaWRlcyBhcnJheVxuICogICAtIENvbHVtbnMgbm90IGluIHRoZSBhcnJheSBhcHBlYXIgYXQgdGhlIGVuZCBpbiB0aGVpciBvcmlnaW5hbCBvcmRlclxuICogLSBXaGVuIGNvbHVtbk92ZXJyaWRlcyBpcyBlbXB0eS91bmRlZmluZWQ6IE9yaWdpbmFsIG9yZGVyIGlzIHByZXNlcnZlZFxuICogXG4gKiBAdGVtcGxhdGUgVCAtIFByb3BlcnR5IHR5cGUgd2l0aCByZXF1aXJlZCBuYW1lIGZpZWxkXG4gKiBAcGFyYW0gYmFzZVByb3BlcnRpZXMgLSBCYXNlIGNvbHVtbiBwcm9wZXJ0aWVzIGZyb20gZW50aXR5IHNjaGVtYVxuICogQHBhcmFtIGNvbHVtbk92ZXJyaWRlcyAtIEN1c3RvbSBjb2x1bW4gb3ZlcnJpZGVzIGZyb20gdGFibGUgY29uZmlndXJhdGlvblxuICogQHJldHVybnMgQmFzZSBwcm9wZXJ0aWVzIHdpdGggb3ZlcnJpZGVzIG1lcmdlZCBpbiBhbmQgcmVvcmRlcmVkXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBiYXNlUHJvcHMgPSBbXG4gKiAgIHsgbmFtZTogJ29yZGVySWQnLCBkYXRhSW5kZXg6ICdvcmRlcklkJywgdHlwZTogJ3N0cmluZycgfSxcbiAqICAgeyBuYW1lOiAnc3RhdHVzJywgZGF0YUluZGV4OiAnc3RhdHVzJywgdHlwZTogJ3N0cmluZycgfSxcbiAqICAgeyBuYW1lOiAndXNlcklkJywgZGF0YUluZGV4OiAndXNlcklkJywgdHlwZTogJ3N0cmluZycgfSxcbiAqICAgeyBuYW1lOiAnbWV0YWRhdGEnLCBkYXRhSW5kZXg6ICdtZXRhZGF0YScsIHR5cGU6ICdzdHJpbmcnIH1cbiAqIF07XG4gKiBjb25zdCBvdmVycmlkZXMgPSBbXG4gKiAgIHsgZmllbGQ6ICdzdGF0dXMnLCBkZWZhdWx0VmlzaWJsZTogdHJ1ZSB9LCAgICAgICAgIC8vIDFzdCBwb3NpdGlvblxuICogICB7IGZpZWxkOiAnb3JkZXJJZCcsIHdpZHRoOiAyMDAsIGRlZmF1bHRWaXNpYmxlOiB0cnVlIH0sIC8vIDJuZCBwb3NpdGlvblxuICogICB7IGZpZWxkOiAnbWV0YWRhdGEnLCBkZWZhdWx0VmlzaWJsZTogZmFsc2UgfSAgICAgICAvLyAzcmQgcG9zaXRpb24gKGhpZGRlbilcbiAqICAgLy8gdXNlcklkIG5vdCBsaXN0ZWQgLSB3aWxsIGJlIGF0IHRoZSBlbmQgYW5kIGhpZGRlbiBieSBkZWZhdWx0XG4gKiBdO1xuICogY29uc3QgbWVyZ2VkID0gbWVyZ2VDb2x1bW5WaXNpYmlsaXR5KGJhc2VQcm9wcywgb3ZlcnJpZGVzKTtcbiAqIC8vIFJlc3VsdCAoaW4gb3JkZXIpOlxuICogLy8gMS4gc3RhdHVzOiBkZWZhdWx0VmlzaWJsZTogdHJ1ZVxuICogLy8gMi4gb3JkZXJJZDogZGVmYXVsdFZpc2libGU6IHRydWUsIHdpZHRoOiAyMDBcbiAqIC8vIDMuIG1ldGFkYXRhOiBkZWZhdWx0VmlzaWJsZTogZmFsc2VcbiAqIC8vIDQuIHVzZXJJZDogZGVmYXVsdFZpc2libGU6IGZhbHNlIChub3QgaW4gb3ZlcnJpZGVzLCBhdCB0aGUgZW5kKVxuICogYGBgXG4gKi9cbi8qKlxuICogTm9ybWFsaXplZCBjb2x1bW4gY29uZmlndXJhdGlvbiB3aXRoIGRlZmF1bHRWaXNpYmxlIGFsd2F5cyBkZWZpbmVkLlxuICogSW50ZXJuYWwgdHlwZSBmb3IgcHJvY2Vzc2luZyBjb2x1bW4gb3ZlcnJpZGVzLlxuICovXG50eXBlIE5vcm1hbGl6ZWRDb2x1bW5Db25maWcgPSBPbWl0PElUYWJsZUNvbHVtbkNvbmZpZywgJ2RlZmF1bHRWaXNpYmxlJz4gJiB7IFxuICAgIGRlZmF1bHRWaXNpYmxlOiBib29sZWFuO1xuICAgIF9vcmRlcj86IG51bWJlcjtcbn07XG5cbi8qKlxuICogTm9ybWFsaXplcyBjb2x1bW4gb3ZlcnJpZGVzIHRvIGEgY29uc2lzdGVudCBmb3JtYXQuXG4gKiBTdXBwb3J0cyBib3RoIHN0cmluZyBzaG9ydGhhbmQgKCdmaWVsZE5hbWUnKSBhbmQgb2JqZWN0IHN5bnRheCAoeyBmaWVsZDogJ2ZpZWxkTmFtZScsIC4uLiB9KVxuICogXG4gKiBAcGFyYW0gY29sdW1uT3ZlcnJpZGVzIC0gQ29sdW1uIGNvbmZpZ3VyYXRpb25zIChzdHJpbmcgb3Igb2JqZWN0IGZvcm1hdClcbiAqIEByZXR1cm5zIE5vcm1hbGl6ZWQgYXJyYXkgb2YgY29sdW1uIGNvbmZpZyBvYmplY3RzXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUNvbHVtbk92ZXJyaWRlcyhcbiAgICBjb2x1bW5PdmVycmlkZXM6IElUYWJsZUNvbHVtbnNcbik6IEFycmF5PE5vcm1hbGl6ZWRDb2x1bW5Db25maWc+IHtcbiAgICByZXR1cm4gKGNvbHVtbk92ZXJyaWRlcyBhcyBBcnJheTxJVGFibGVDb2x1bW4+KS5tYXAoY29sID0+IHtcbiAgICAgICAgLy8gU3RyaW5nIHNob3J0aGFuZDogJ2ZpZWxkTmFtZScg4oaSIHsgZmllbGQ6ICdmaWVsZE5hbWUnLCBkZWZhdWx0VmlzaWJsZTogdHJ1ZSB9XG4gICAgICAgIGlmICh0eXBlb2YgY29sID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgcmV0dXJuIHsgXG4gICAgICAgICAgICAgICAgZmllbGQ6IGNvbCwgXG4gICAgICAgICAgICAgICAgZGVmYXVsdFZpc2libGU6IHRydWVcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgLy8gT2JqZWN0IHN5bnRheDogYWxyZWFkeSBub3JtYWxpemVkLCBqdXN0IGVuc3VyZSBkZWZhdWx0VmlzaWJsZSBkZWZhdWx0cyB0byB0cnVlXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBmaWVsZDogY29sLmZpZWxkLFxuICAgICAgICAgICAgdmlzaWJpbGl0eTogY29sLnZpc2liaWxpdHksXG4gICAgICAgICAgICB3aWR0aDogY29sLndpZHRoLFxuICAgICAgICAgICAgZml4ZWQ6IGNvbC5maXhlZCxcbiAgICAgICAgICAgIGdyb3VwVGl0bGU6IGNvbC5ncm91cFRpdGxlLFxuICAgICAgICAgICAgZGVmYXVsdFZpc2libGU6IGNvbC5kZWZhdWx0VmlzaWJsZSAhPT0gZmFsc2UgLy8gRGVmYXVsdHMgdG8gdHJ1ZVxuICAgICAgICB9O1xuICAgIH0pO1xufVxuXG4vKipcbiAqIE1lcmdlcyBjb2x1bW4gdmlzaWJpbGl0eSBjb25maWd1cmF0aW9uIHdpdGggYmFzZSBwcm9wZXJ0aWVzLlxuICogQ29udHJvbHMgd2hpY2ggY29sdW1ucyBhcmUgdmlzaWJsZSBieSBkZWZhdWx0IGFuZCB0aGVpciBkaXNwbGF5IG9yZGVyLlxuICogXG4gKiAqKlN1cHBvcnRzOioqXG4gKiAtIFNjaGVtYSBmaWVsZHMgKGZyb20gYmFzZSBwcm9wZXJ0aWVzKVxuICogLSBKU09OIHBhdGhzIChlLmcuLCAndXNlci5lbWFpbCcsICdtZXRhZGF0YS5zY29yZScpXG4gKiAtIEN1c3RvbS9jb21wdXRlZCBjb2x1bW5zIChub3QgaW4gc2NoZW1hLCBwcm92aWRlZCBieSBBUEkgb3IgZnJvbnRlbmQpXG4gKiBcbiAqIEB0ZW1wbGF0ZSBUIC0gQmFzZSBwcm9wZXJ0eSB0eXBlIHdpdGggbmFtZSBhbmQgZGF0YUluZGV4XG4gKiBAcGFyYW0gYmFzZVByb3BlcnRpZXMgLSBCYXNlIHByb3BlcnRpZXMgZnJvbSBlbnRpdHkgc2NoZW1hXG4gKiBAcGFyYW0gY29sdW1uT3ZlcnJpZGVzIC0gQ29sdW1uIGNvbmZpZ3VyYXRpb24gb3ZlcnJpZGVzIChzdHJpbmcgb3Igb2JqZWN0IGZvcm1hdClcbiAqIEByZXR1cm5zIE1lcmdlZCBwcm9wZXJ0aWVzIHdpdGggdmlzaWJpbGl0eSBhbmQgb3JkZXIgYXBwbGllZCwgaW5jbHVkaW5nIGN1c3RvbSBjb2x1bW5zXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZUNvbHVtblZpc2liaWxpdHk8VCBleHRlbmRzIHsgbmFtZTogc3RyaW5nOyBkYXRhSW5kZXg/OiBzdHJpbmcgfT4oXG4gICAgYmFzZVByb3BlcnRpZXM6IEFycmF5PFQ+LFxuICAgIGNvbHVtbk92ZXJyaWRlczogSVRhYmxlQ29sdW1ucyA9IFtdXG4pOiBBcnJheTxUPiB7XG4gICAgLy8gSWYgbm8gY29sdW1uT3ZlcnJpZGVzIHByb3ZpZGVkLCByZXR1cm4gcHJvcGVydGllcyBhcy1pcyAoYmFja3dhcmQgY29tcGF0aWJsZSlcbiAgICBpZiAoIWNvbHVtbk92ZXJyaWRlcyB8fCBjb2x1bW5PdmVycmlkZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHJldHVybiBiYXNlUHJvcGVydGllcztcbiAgICB9XG5cbiAgICAvLyBOb3JtYWxpemUgY29sdW1uIG92ZXJyaWRlcyAoaGFuZGxlIHN0cmluZyBzaG9ydGhhbmQpXG4gICAgY29uc3Qgbm9ybWFsaXplZE92ZXJyaWRlcyA9IG5vcm1hbGl6ZUNvbHVtbk92ZXJyaWRlcyhjb2x1bW5PdmVycmlkZXMpO1xuXG4gICAgY29uc3Qgb3ZlcnJpZGVNYXAgPSBuZXcgTWFwKFxuICAgICAgICBub3JtYWxpemVkT3ZlcnJpZGVzLm1hcCgoYywgaW5kZXgpID0+IFsgYy5maWVsZCwgeyAuLi5jLCBfb3JkZXI6IGluZGV4IH0gXSlcbiAgICApO1xuXG4gICAgLy8gVHJhY2sgd2hpY2ggb3ZlcnJpZGVzIG1hdGNoIGV4aXN0aW5nIHNjaGVtYSBjb2x1bW5zXG4gICAgY29uc3QgbWF0Y2hlZE92ZXJyaWRlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gICAgLy8gTWVyZ2Ugb3ZlcnJpZGVzIGludG8gZXhpc3Rpbmcgc2NoZW1hIHByb3BlcnRpZXNcbiAgICBjb25zdCBtZXJnZWRQcm9wZXJ0aWVzID0gYmFzZVByb3BlcnRpZXMubWFwKHByb3AgPT4ge1xuICAgICAgICAvLyBVc2UgZGF0YUluZGV4IChhY3R1YWwgZmllbGQgbmFtZSkgaWYgYXZhaWxhYmxlLCBvdGhlcndpc2UgZmFsbCBiYWNrIHRvIG5hbWVcbiAgICAgICAgY29uc3QgZmllbGROYW1lID0gcHJvcC5kYXRhSW5kZXggfHwgcHJvcC5uYW1lO1xuICAgICAgICBjb25zdCBvdmVycmlkZSA9IG92ZXJyaWRlTWFwLmdldChmaWVsZE5hbWUpO1xuXG4gICAgICAgIGlmICghb3ZlcnJpZGUpIHtcbiAgICAgICAgICAgIC8vIEZpZWxkIG5vdCBpbiB0YWJsZUNvbmZpZy5jb2x1bW5zIC0gaGlkZSBieSBkZWZhdWx0IGJ1dCBrZWVwIGF2YWlsYWJsZVxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAuLi5wcm9wLFxuICAgICAgICAgICAgICAgIGRlZmF1bHRWaXNpYmxlOiBmYWxzZSxcbiAgICAgICAgICAgICAgICBfb3JkZXI6IE51bWJlci5NQVhfU0FGRV9JTlRFR0VSIC8vIFB1dCBhdCB0aGUgZW5kXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRmllbGQgaXMgaW4gdGFibGVDb25maWcuY29sdW1ucyAtIGFwcGx5IG92ZXJyaWRlc1xuICAgICAgICBtYXRjaGVkT3ZlcnJpZGVzLmFkZChvdmVycmlkZS5maWVsZCk7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAuLi5wcm9wLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLnZpc2liaWxpdHkgIT09IHVuZGVmaW5lZCAmJiB7IHZpc2liaWxpdHk6IG92ZXJyaWRlLnZpc2liaWxpdHkgfSksXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUud2lkdGggIT09IHVuZGVmaW5lZCAmJiB7IHdpZHRoOiBvdmVycmlkZS53aWR0aCB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS5maXhlZCAhPT0gdW5kZWZpbmVkICYmIHsgZml4ZWQ6IG92ZXJyaWRlLmZpeGVkIH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmdyb3VwVGl0bGUgIT09IHVuZGVmaW5lZCAmJiB7IGdyb3VwVGl0bGU6IG92ZXJyaWRlLmdyb3VwVGl0bGUgfSksXG4gICAgICAgICAgICBkZWZhdWx0VmlzaWJsZTogb3ZlcnJpZGUuZGVmYXVsdFZpc2libGUgIT09IGZhbHNlLCAgLy8gRGVmYXVsdHMgdG8gdHJ1ZVxuICAgICAgICAgICAgX29yZGVyOiBvdmVycmlkZS5fb3JkZXJcbiAgICAgICAgfTtcbiAgICB9KTtcblxuICAgIC8vIEFkZCBjdXN0b20gY29sdW1ucyAoSlNPTiBwYXRocywgY29tcHV0ZWQgZmllbGRzKVxuICAgIG5vcm1hbGl6ZWRPdmVycmlkZXMuZm9yRWFjaChvdmVycmlkZSA9PiB7XG4gICAgICAgIGlmICghbWF0Y2hlZE92ZXJyaWRlcy5oYXMob3ZlcnJpZGUuZmllbGQpKSB7XG4gICAgICAgICAgICAvLyBUaGlzIGlzIGEgY3VzdG9tIGNvbHVtbiAoSlNPTiBwYXRoIG9yIGNvbXB1dGVkIGZpZWxkKVxuICAgICAgICAgICAgY29uc3QgaXNKc29uUGF0aCA9IG92ZXJyaWRlLmZpZWxkLmluY2x1ZGVzKCcuJyk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIExvZyBpbmZvIGFib3V0IGN1c3RvbSBjb2x1bW5cbiAgICAgICAgICAgIGlmIChpc0pzb25QYXRoKSB7XG4gICAgICAgICAgICAgICAgRGVmYXVsdExvZ2dlci5kZWJ1ZyhgQWRkaW5nIEpTT04gcGF0aCBjb2x1bW46IFwiJHtvdmVycmlkZS5maWVsZH1cImApO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLmRlYnVnKGBBZGRpbmcgY3VzdG9tIGNvbHVtbjogXCIke292ZXJyaWRlLmZpZWxkfVwiIChub3QgaW4gc2NoZW1hLCBhc3N1bWVzIEFQSSBwcm92aWRlcyBpdClgKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQWRkIGFzIG5ldyBjdXN0b20gY29sdW1uXG4gICAgICAgICAgICBtZXJnZWRQcm9wZXJ0aWVzLnB1c2goe1xuICAgICAgICAgICAgICAgIG5hbWU6IG92ZXJyaWRlLmZpZWxkLCAgLy8gVXNlIGZpZWxkIGFzIG5hbWVcbiAgICAgICAgICAgICAgICBkYXRhSW5kZXg6IG92ZXJyaWRlLmZpZWxkLCAgLy8gRnJvbnRlbmQgd2lsbCB1c2UgZ2V0TmVzdGVkVmFsdWUoKVxuICAgICAgICAgICAgICAgIGRlZmF1bHRWaXNpYmxlOiBvdmVycmlkZS5kZWZhdWx0VmlzaWJsZSxcbiAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICd0ZXh0JywgIC8vIERlZmF1bHQgdG8gdGV4dCBmb3IgY3VzdG9tIGNvbHVtbnNcbiAgICAgICAgICAgICAgICAuLi4ob3ZlcnJpZGUudmlzaWJpbGl0eSAhPT0gdW5kZWZpbmVkICYmIHsgdmlzaWJpbGl0eTogb3ZlcnJpZGUudmlzaWJpbGl0eSB9KSxcbiAgICAgICAgICAgICAgICAuLi4ob3ZlcnJpZGUud2lkdGggIT09IHVuZGVmaW5lZCAmJiB7IHdpZHRoOiBvdmVycmlkZS53aWR0aCB9KSxcbiAgICAgICAgICAgICAgICAuLi4ob3ZlcnJpZGUuZml4ZWQgIT09IHVuZGVmaW5lZCAmJiB7IGZpeGVkOiBvdmVycmlkZS5maXhlZCB9KSxcbiAgICAgICAgICAgICAgICAuLi4ob3ZlcnJpZGUuZ3JvdXBUaXRsZSAhPT0gdW5kZWZpbmVkICYmIHsgZ3JvdXBUaXRsZTogb3ZlcnJpZGUuZ3JvdXBUaXRsZSB9KSxcbiAgICAgICAgICAgICAgICBfb3JkZXI6IG92ZXJyaWRlLl9vcmRlclxuICAgICAgICAgICAgfSBhcyBhbnkpO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBTb3J0IGJ5IG9yZGVyIGZyb20gY29sdW1uT3ZlcnJpZGVzIChjb2x1bW5zIG5vdCBpbiBvdmVycmlkZXMgZ28gdG8gZW5kKVxuICAgIG1lcmdlZFByb3BlcnRpZXMuc29ydCgoYTogYW55LCBiOiBhbnkpID0+IChhLl9vcmRlciA/PyBOdW1iZXIuTUFYX1NBRkVfSU5URUdFUikgLSAoYi5fb3JkZXIgPz8gTnVtYmVyLk1BWF9TQUZFX0lOVEVHRVIpKTtcblxuICAgIC8vIFJlbW92ZSB0ZW1wb3JhcnkgX29yZGVyIHByb3BlcnR5XG4gICAgcmV0dXJuIG1lcmdlZFByb3BlcnRpZXMubWFwKCh7IF9vcmRlciwgLi4ucmVzdCB9OiBhbnkpID0+IHJlc3QpO1xufVxuIl19
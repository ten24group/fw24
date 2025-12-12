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
exports.mergeSegments = mergeSegments;
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
                availableOperators: ['eq', 'neq', 'inList', 'notInList', 'exists', 'notExists'],
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
            availableOperators: ['eq', 'neq', 'exists', 'notExists'],
            predefinedOptions: [
                { label: 'Yes', value: "true" },
                { label: 'No', value: "false" }
            ]
        };
    }
    // **2. Enum fields (array of strings/numbers)**
    if (Array.isArray(attrType) && mergedConfig.enumFields?.enabled !== false) {
        const defaultEnumOps = ['eq', 'neq', 'inList', 'notInList', 'exists', 'notExists'];
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
        const defaultDateOps = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'exists', 'notExists'];
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
        const defaultNumberOps = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'exists', 'notExists'];
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
                availableOperators: ['eq', 'neq', 'inList', 'notInList', 'exists', 'notExists'],
                predefinedOptions: resolved
            };
        }
    }
    // **6. Text fields (default fallback)**
    if (attrType === 'string' && mergedConfig.textFields?.enabled !== false) {
        const defaultTextOps = ['contains', 'notContains', 'eq', 'neq', 'startsWith', 'endsWith', 'like', 'exists', 'notExists'];
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
 * Merges default filter segments with custom segments using ID-based override logic.
 *
 * Follows the same pattern as mergeButtons/mergeActions: custom segments with matching IDs
 * override defaults, and new custom segments are appended.
 *
 * @param defaults - Default segment configurations
 * @param customs - Custom segment configurations to merge
 * @returns Merged array with custom overrides applied
 *
 * @example
 * ```typescript
 * const defaults = [
 *   { id: 'active', label: 'Active', filters: { status: { eq: 'active' } } },
 *   { id: 'inactive', label: 'Inactive', filters: { status: { eq: 'inactive' } } }
 * ];
 * const customs = [
 *   { id: 'archived', label: 'Archived', filters: { archived: { eq: true } } }
 * ];
 * const result = mergeSegments(defaults, customs);
 * // Returns: [active, inactive, archived]
 * ```
 */
function mergeSegments(defaults, customs = []) {
    return mergeButtons(defaults, [...customs]); // Reuse mergeButtons logic with id-based override
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy91aS1jb25maWctZ2VuL3RlbXBsYXRlcy91dGlsLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBMGlCQSw0REFnQkM7QUEwTUQsa0VBNERDO0FBb0JELG9EQXlOQztBQXVYRCw0Q0F1TkM7QUFtQ0Qsb0ZBdVJDO0FBY0Qsc0ZBa0JDO0FBaUZELDREQXVGQztBQWtCRCxzREFrQ0M7QUFrRUQsMEVBSUM7QUFhRCwwRUFJQztBQWFELDBFQUlDO0FBZ0RELHNFQXVHQztBQStDRCxvQ0F3QkM7QUE2QkQsb0NBS0M7QUF5QkQsc0NBS0M7QUEyQkQsb0RBd0NDO0FBb0dELHNEQWdGQztBQTl5RkQseUNBWXNCO0FBRXRCLHlDQUE4QztBQUU5QywyQ0FBOEM7QUFDOUMsdUNBQThEO0FBa0Q5RDs7R0FFRztBQUNIOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBbUJHO0FBQ0gsTUFBTSx3QkFBd0IsR0FBOEM7SUFDeEUsT0FBTyxFQUFFLElBQUk7SUFDYixRQUFRLEVBQUU7UUFDTiw0Q0FBNEM7UUFDNUMsT0FBTyxFQUFFLENBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsYUFBYSxDQUFFO1FBQ3BELDRDQUE0QztRQUM1QyxNQUFNLEVBQUUsQ0FBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsU0FBUyxDQUFFO1FBQ3hELHdDQUF3QztRQUN4QyxJQUFJLEVBQUUsQ0FBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxZQUFZLEVBQUUsVUFBVSxDQUFFO0tBQzVEO0lBQ0QsUUFBUSxFQUFFO1FBQ04sMENBQTBDO1FBQzFDLFFBQVEsRUFBRSxPQUFPO1FBQ2pCLFFBQVEsRUFBRSxRQUFRLEVBQUUsYUFBYTtRQUNqQyxTQUFTLEVBQUUsV0FBVyxFQUFFLFVBQVU7UUFDbEMsTUFBTSxFQUFFLFdBQVcsRUFBRSxVQUFVO1FBQy9CLE9BQU8s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QUFFLFFBQVEsQ0FBQyxNQUFNO2FBQ25CLENBQUMsQ0FBQztRQUNkLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztJQUVILDBFQUEwRTtJQUMxRSxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFNLEVBQUUsQ0FBTSxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLElBQUksTUFBTSxDQUFDLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsTUFBTSxJQUFJLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUM7SUFFekgsbUNBQW1DO0lBQ25DLE9BQU8sZ0JBQWdCLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxNQUFNLEVBQUUsR0FBRyxJQUFJLEVBQU8sRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDcEUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7XG4gICAgQmFzZUVudGl0eVNlcnZpY2UsXG4gICAgRmllbGRNZXRhZGF0YSxcbiAgICBUSU9TY2hlbWFBdHRyaWJ1dGUsXG4gICAgaXNTZWxlY3RGaWVsZE1ldGFkYXRhLFxuICAgIFNlbGVjdEZpZWxkTWV0YWRhdGEsXG4gICAgRW50aXR5QXR0cmlidXRlLFxuICAgIElSZWxhdGlvbkZpZWxkQ29uZmlnLFxuICAgIFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXAsXG4gICAgRW50aXR5U2NoZW1hLFxuICAgIElGaWx0ZXJTZWdtZW50LFxuICAgIGNyZWF0ZUZpZWxkT3B0aW9uc1xufSBmcm9tIFwiLi4vLi4vZW50aXR5XCI7XG5pbXBvcnQgdHlwZSB7IFJlbGF0aW9uRW50aXR5T3B0aW9uQ29uZmlnLCBGaWVsZE9wdGlvbnNBUElDb25maWcsIElFbnRpdHlQYWdlQWN0aW9uLCBUZW1wbGF0ZSwgRmllbGRPcHRpb24sIElGaWx0ZXJTZWdtZW50R3JvdXAsIElUYWJsZUNvbHVtbnMsIElUYWJsZUNvbHVtbiwgSVRhYmxlQ29sdW1uQ29uZmlnIH0gZnJvbSAnLi4vLi4vZW50aXR5L2Jhc2UtZW50aXR5JztcbmltcG9ydCB7IEZyYW1ld29ya0Vycm9yIH0gZnJvbSBcIi4uLy4uL2Vycm9yc1wiO1xuaW1wb3J0IHR5cGUgeyBJQXBwbGljYXRpb25Db25maWcsIElEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25Db25maWcsIElTZWdtZW50QXV0b0dlbmVyYXRpb25Db25maWcgfSBmcm9tICcuLi8uLi9pbnRlcmZhY2VzL2NvbmZpZyc7XG5pbXBvcnQgeyBEZWZhdWx0TG9nZ2VyIH0gZnJvbSBcIi4uLy4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IHBhc2NhbENhc2UsIHRvSHVtYW5SZWFkYWJsZU5hbWUgfSBmcm9tIFwiLi4vLi4vdXRpbHNcIjtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTTUFSVCBEVVBMSUNBVEVEIEZJRUxEIERFVEVDVElPTiAtIEVOSEFOQ0VEIEFMR09SSVRITVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogRGV0ZWN0aW9uIHJlc3VsdCB3aXRoIHJpY2ggbWV0YWRhdGFcbiAqL1xuaW50ZXJmYWNlIER1cGxpY2F0ZWRGaWVsZERldGVjdGlvblJlc3VsdCB7XG4gICAgLyoqIFByaW1hcnkgZGlzcGxheSBmaWVsZCBkZXRlY3RlZCAoZS5nLiwgJ3RlYW1OYW1lJykgKi9cbiAgICBwcmltYXJ5RmllbGQ/OiBzdHJpbmc7XG5cbiAgICAvKiogR2VuZXJhdGVkIHRlbXBsYXRlIHN0cmluZyAoZS5nLiwgJ3t0ZWFtTmFtZX0nIG9yICd7dGVhbU5hbWV9ICh7dGVhbUNvZGV9KScpICovXG4gICAgdGVtcGxhdGU/OiBzdHJpbmc7XG5cbiAgICAvKiogQWxsIGRldGVjdGVkIGZpZWxkcyBieSBjYXRlZ29yeSAqL1xuICAgIGRldGVjdGVkRmllbGRzOiB7XG4gICAgICAgIC8qKiBEaXNwbGF5IGZpZWxkczogTmFtZSwgVGl0bGUsIExhYmVsICovXG4gICAgICAgIGRpc3BsYXk/OiBzdHJpbmdbXTtcbiAgICAgICAgLyoqIFZpc3VhbCBmaWVsZHM6IExvZ28sIEltYWdlLCBJY29uICovXG4gICAgICAgIHZpc3VhbD86IHN0cmluZ1tdO1xuICAgICAgICAvKiogTWV0YSBmaWVsZHM6IENvZGUsIFNsdWcsIEtleSAqL1xuICAgICAgICBtZXRhPzogc3RyaW5nW107XG4gICAgfTtcblxuICAgIC8qKiBDb25maWRlbmNlIGxldmVsICovXG4gICAgY29uZmlkZW5jZTogJ2hpZ2gnIHwgJ21lZGl1bScgfCAnbG93JztcblxuICAgIC8qKiBEZXRlY3Rpb24gbWV0aG9kIHVzZWQgKi9cbiAgICBtZXRob2Q6IHN0cmluZztcblxuICAgIC8qKiBQYXR0ZXJuIHRoYXQgbWF0Y2hlZCAqL1xuICAgIHBhdHRlcm46IHN0cmluZztcbn1cblxuLyoqXG4gKiBQYXJzZWQgY29tcG9uZW50cyBmcm9tIHJlbGF0aW9uIGZpZWxkIG5hbWVcbiAqL1xuaW50ZXJmYWNlIFBhcnNlZFJlbGF0aW9uRmllbGQge1xuICAgIC8qKiBQcmVmaXggKGUuZy4sICdob21lJywgJ2F3YXknLCAnY29tcGV0aXRvcjEnKSAqL1xuICAgIHByZWZpeD86IHN0cmluZztcbiAgICAvKiogQmFzZSBuYW1lIHdpdGhvdXQgcHJlZml4IGFuZCAnSWQnIHN1ZmZpeCAoZS5nLiwgJ1RlYW0nKSAqL1xuICAgIGJhc2VOYW1lOiBzdHJpbmc7XG4gICAgLyoqIFdoZXRoZXIgZmllbGQgZW5kcyB3aXRoICdJZCcgKi9cbiAgICBoYXNJZFN1ZmZpeDogYm9vbGVhbjtcbiAgICAvKiogT3JpZ2luYWwgZmllbGQgbmFtZSAqL1xuICAgIG9yaWdpbmFsRmllbGQ6IHN0cmluZztcbn1cblxuLyoqXG4gKiBTbWFydCBkZWZhdWx0IGNvbmZpZ3VyYXRpb25cbiAqL1xuLyoqXG4gKiBGcmFtZXdvcmstbGV2ZWwgZGVmYXVsdCBkZXRlY3Rpb24gY29uZmlnLlxuICogQ29udGFpbnMgT05MWSBkb21haW4tYWdub3N0aWMgcGF0dGVybnMgdGhhdCB3b3JrIGFjcm9zcyBhbnkgYXBwbGljYXRpb24uXG4gKiBcbiAqIEFwcGxpY2F0aW9ucyBzaG91bGQgcHJvdmlkZSBkb21haW4tc3BlY2lmaWMgcHJlZml4ZXMgdmlhIHVpQ29uZmlnT3B0aW9ucy5cbiAqIFxuICogQGV4YW1wbGUgQXBwbGljYXRpb24tc3BlY2lmaWMgY29uZmlnIChpbiBiYWNrZW5kIGluZGV4LnRzKTpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IHVpQ29uZmlnT3B0aW9ucyA9IHtcbiAqICAgZHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uOiB7XG4gKiAgICAgcHJlZml4ZXM6IFtcbiAqICAgICAgIC8vIERvbWFpbi1zcGVjaWZpYyBwcmVmaXhlcyBmb3IgeW91ciBhcHBcbiAqICAgICAgICdwbGF5ZXInLCAndGVhbScsICdsZWFndWUnLCAnc2Vhc29uJywgJ3ZlbnVlJywgJ3Nwb3J0JywgIC8vIFNwb3J0cyBhcHBcbiAqICAgICAgIC8vIE9SOiAnY3VzdG9tZXInLCAnb3JkZXInLCAncHJvZHVjdCcsICdpbnZvaWNlJyAgLy8gRS1jb21tZXJjZSBhcHBcbiAqICAgICAgIC8vIE9SOiAnYXV0aG9yJywgJ2Jvb2snLCAncHVibGlzaGVyJywgJ2dlbnJlJyAgLy8gTGlicmFyeSBhcHBcbiAqICAgICBdXG4gKiAgIH1cbiAqIH07XG4gKiBgYGBcbiAqL1xuY29uc3QgREVGQVVMVF9ERVRFQ1RJT05fQ09ORklHOiBSZXF1aXJlZDxJRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uQ29uZmlnPiA9IHtcbiAgICBlbmFibGVkOiB0cnVlLFxuICAgIHN1ZmZpeGVzOiB7XG4gICAgICAgIC8vIEdlbmVyaWMgZGlzcGxheSB0ZXh0IHBhdHRlcm5zICh1bml2ZXJzYWwpXG4gICAgICAgIGRpc3BsYXk6IFsgJ05hbWUnLCAnVGl0bGUnLCAnTGFiZWwnLCAnRGlzcGxheU5hbWUnIF0sXG4gICAgICAgIC8vIEdlbmVyaWMgdmlzdWFsIGFzc2V0IHBhdHRlcm5zICh1bml2ZXJzYWwpXG4gICAgICAgIHZpc3VhbDogWyAnTG9nbycsICdJbWFnZScsICdJY29uJywgJ0F2YXRhcicsICdQaWN0dXJlJyBdLFxuICAgICAgICAvLyBHZW5lcmljIG1ldGFkYXRhIHBhdHRlcm5zICh1bml2ZXJzYWwpXG4gICAgICAgIG1ldGE6IFsgJ0NvZGUnLCAnU2x1ZycsICdLZXknLCAnSWRlbnRpZmllcicsICdSZW1vdGVJZCcgXVxuICAgIH0sXG4gICAgcHJlZml4ZXM6IFtcbiAgICAgICAgLy8gR2VuZXJpYyByZWxhdGlvbmFsIHBhdHRlcm5zICh1bml2ZXJzYWwpXG4gICAgICAgICdwYXJlbnQnLCAnY2hpbGQnLFxuICAgICAgICAnc291cmNlJywgJ3RhcmdldCcsICdkZXN0aW5hdGlvbicsXG4gICAgICAgICdwcmltYXJ5JywgJ3NlY29uZGFyeScsICd0ZXJ0aWFyeScsXG4gICAgICAgICdtYWluJywgJ2FsdGVybmF0ZScsICdmYWxsYmFjaycsXG4gICAgICAgICdvd25lcicsICdjcmVhdG9yJywgJ21vZGlmaWVyJyxcbiAgICAgICAgJ2ZpcnN0JywgJ3NlY29uZCcsICd0aGlyZCcsICdsYXN0JyxcbiAgICAgICAgJ3ByZXZpb3VzJywgJ25leHQnLCAnY3VycmVudCcsXG4gICAgICAgICdvbGQnLCAnbmV3JyxcbiAgICAgICAgJ29yaWdpbmFsJywgJ2NvcHknLCAnZHJhZnQnLFxuXG4gICAgICAgIC8vIEdlbmVyaWMgZGlyZWN0aW9uYWwgcGF0dGVybnMgKHVuaXZlcnNhbClcbiAgICAgICAgJ2hvbWUnLCAnYXdheScsXG4gICAgICAgICdsZWZ0JywgJ3JpZ2h0JyxcbiAgICAgICAgJ3RvcCcsICdib3R0b20nLFxuICAgICAgICAnaW5uZXInLCAnb3V0ZXInLFxuXG4gICAgICAgIC8vIEdlbmVyaWMgY29tcGV0aXRpdmUgcGF0dGVybnMgKHVuaXZlcnNhbClcbiAgICAgICAgJ3dpbm5lcicsICdsb3NlcicsXG4gICAgICAgICdjb21wZXRpdG9yJywgJ29wcG9uZW50J1xuXG4gICAgICAgIC8vIE5PVEU6IERvbWFpbi1zcGVjaWZpYyBwcmVmaXhlcyAocGxheWVyLCB0ZWFtLCBjdXN0b21lciwgb3JkZXIsIGV0Yy4pXG4gICAgICAgIC8vIHNob3VsZCBiZSBwcm92aWRlZCB2aWEgdWlDb25maWdPcHRpb25zIGluIHlvdXIgYXBwbGljYXRpb24ncyBiYWNrZW5kXG4gICAgXSxcbiAgICB0ZW1wbGF0ZVN0eWxlOiAnc2ltcGxlJyxcbiAgICBjb25maWRlbmNlVGhyZXNob2xkOiAnbWVkaXVtJyxcbiAgICBkZWJ1ZzogZmFsc2Vcbn07XG5cbi8qKlxuICogTWVyZ2UgY29uZmlndXJhdGlvbnMgd2l0aCBwcmlvcml0eTogaGludHMgPiBlbnRpdHkgPiBnbG9iYWwgPiBkZWZhdWx0c1xuICovXG5mdW5jdGlvbiBtZXJnZURldGVjdGlvbkNvbmZpZ3MoXG4gICAgZ2xvYmFsQ29uZmlnPzogSUR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbkNvbmZpZyxcbiAgICBlbnRpdHlDb25maWc/OiBJRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uQ29uZmlnLFxuICAgIHJlbGF0aW9uSGludHM/OiB7XG4gICAgICAgIHByZWZlcnJlZEZpZWxkcz86IHN0cmluZ1tdO1xuICAgICAgICBleGNsdWRlRmllbGRzPzogc3RyaW5nW107XG4gICAgICAgIHRlbXBsYXRlU3R5bGU/OiAnc2ltcGxlJyB8ICdjb21wb3NpdGUnO1xuICAgIH1cbik6IFJlcXVpcmVkPElEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25Db25maWc+ICYgeyBwcmVmZXJyZWRGaWVsZHM/OiBzdHJpbmdbXTsgZXhjbHVkZUZpZWxkcz86IHN0cmluZ1tdIH0ge1xuICAgIC8vIFN0YXJ0IHdpdGggZGVmYXVsdHNcbiAgICBsZXQgbWVyZ2VkID0geyAuLi5ERUZBVUxUX0RFVEVDVElPTl9DT05GSUcgfTtcblxuICAgIC8vIEFwcGx5IGdsb2JhbCBjb25maWdcbiAgICBpZiAoZ2xvYmFsQ29uZmlnKSB7XG4gICAgICAgIG1lcmdlZCA9IHtcbiAgICAgICAgICAgIC4uLm1lcmdlZCxcbiAgICAgICAgICAgIC4uLmdsb2JhbENvbmZpZyxcbiAgICAgICAgICAgIHN1ZmZpeGVzOiB7IC4uLm1lcmdlZC5zdWZmaXhlcywgLi4uZ2xvYmFsQ29uZmlnLnN1ZmZpeGVzIH0sXG4gICAgICAgICAgICBwcmVmaXhlczogZ2xvYmFsQ29uZmlnLnByZWZpeGVzIHx8IG1lcmdlZC5wcmVmaXhlc1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vIEFwcGx5IGVudGl0eSBjb25maWcgKGhpZ2hlciBwcmlvcml0eSlcbiAgICBpZiAoZW50aXR5Q29uZmlnKSB7XG4gICAgICAgIG1lcmdlZCA9IHtcbiAgICAgICAgICAgIC4uLm1lcmdlZCxcbiAgICAgICAgICAgIC4uLmVudGl0eUNvbmZpZyxcbiAgICAgICAgICAgIHN1ZmZpeGVzOiB7IC4uLm1lcmdlZC5zdWZmaXhlcywgLi4uZW50aXR5Q29uZmlnLnN1ZmZpeGVzIH0sXG4gICAgICAgICAgICBwcmVmaXhlczogZW50aXR5Q29uZmlnLnByZWZpeGVzIHx8IG1lcmdlZC5wcmVmaXhlc1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vIEFwcGx5IHJlbGF0aW9uIGhpbnRzIChoaWdoZXN0IHByaW9yaXR5KVxuICAgIGNvbnN0IHJlc3VsdDogYW55ID0geyAuLi5tZXJnZWQgfTtcbiAgICBpZiAocmVsYXRpb25IaW50cykge1xuICAgICAgICBpZiAocmVsYXRpb25IaW50cy50ZW1wbGF0ZVN0eWxlKSB7XG4gICAgICAgICAgICByZXN1bHQudGVtcGxhdGVTdHlsZSA9IHJlbGF0aW9uSGludHMudGVtcGxhdGVTdHlsZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocmVsYXRpb25IaW50cy5wcmVmZXJyZWRGaWVsZHMpIHtcbiAgICAgICAgICAgIHJlc3VsdC5wcmVmZXJyZWRGaWVsZHMgPSByZWxhdGlvbkhpbnRzLnByZWZlcnJlZEZpZWxkcztcbiAgICAgICAgfVxuICAgICAgICBpZiAocmVsYXRpb25IaW50cy5leGNsdWRlRmllbGRzKSB7XG4gICAgICAgICAgICByZXN1bHQuZXhjbHVkZUZpZWxkcyA9IHJlbGF0aW9uSGludHMuZXhjbHVkZUZpZWxkcztcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbi8qKlxuICogUGFyc2UgcmVsYXRpb24gZmllbGQgdG8gZXh0cmFjdCBwcmVmaXggYW5kIGJhc2UgbmFtZS5cbiAqIFxuICogRXhhbXBsZXM6XG4gKiAtICd0ZWFtSWQnIOKGkiB7IGJhc2VOYW1lOiAnVGVhbScsIGhhc0lkU3VmZml4OiB0cnVlIH1cbiAqIC0gJ2hvbWVUZWFtSWQnIOKGkiB7IHByZWZpeDogJ2hvbWUnLCBiYXNlTmFtZTogJ1RlYW0nLCBoYXNJZFN1ZmZpeDogdHJ1ZSB9XG4gKiAtICdjb21wZXRpdG9yMVRlYW1JZCcg4oaSIHsgcHJlZml4OiAnY29tcGV0aXRvcjEnLCBiYXNlTmFtZTogJ1RlYW0nLCBoYXNJZFN1ZmZpeDogdHJ1ZSB9XG4gKiAtICdzcG9ydCcg4oaSIHsgYmFzZU5hbWU6ICdzcG9ydCcsIGhhc0lkU3VmZml4OiBmYWxzZSB9XG4gKi9cbmZ1bmN0aW9uIHBhcnNlUmVsYXRpb25GaWVsZChcbiAgICBmaWVsZElkOiBzdHJpbmcsXG4gICAgcHJlZml4ZXM6IHN0cmluZ1tdXG4pOiBQYXJzZWRSZWxhdGlvbkZpZWxkIHtcbiAgICAvLyBCdWlsZCByZWdleCBmb3IgcHJlZml4IGRldGVjdGlvbjogXihwcmVmaXgxfHByZWZpeDJ8Li4uKShcXFxcZCopKC4rKSRcbiAgICAvLyBVc2UgY2FzZS1pbnNlbnNpdGl2ZSBtYXRjaGluZ1xuICAgIGNvbnN0IHByZWZpeFBhdHRlcm4gPSBuZXcgUmVnRXhwKFxuICAgICAgICBgXigke3ByZWZpeGVzLmpvaW4oJ3wnKX0pKFxcXFxkKikoLispJGAsXG4gICAgICAgICdpJ1xuICAgICk7XG5cbiAgICBjb25zdCBtYXRjaCA9IGZpZWxkSWQubWF0Y2gocHJlZml4UGF0dGVybik7XG5cbiAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgY29uc3QgWyAsIHByZWZpeCwgbnVtLCByZXN0IF0gPSBtYXRjaDtcbiAgICAgICAgY29uc3QgaGFzSWRTdWZmaXggPSByZXN0LnRvTG93ZXJDYXNlKCkuZW5kc1dpdGgoJ2lkJyk7XG4gICAgICAgIGNvbnN0IGJhc2VOYW1lID0gaGFzSWRTdWZmaXhcbiAgICAgICAgICAgID8gcmVzdC5zdWJzdHJpbmcoMCwgcmVzdC5sZW5ndGggLSAyKVxuICAgICAgICAgICAgOiByZXN0O1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBwcmVmaXg6IHByZWZpeCArIG51bSwgIC8vICdob21lJyBvciAnY29tcGV0aXRvcjEnXG4gICAgICAgICAgICBiYXNlTmFtZSxcbiAgICAgICAgICAgIGhhc0lkU3VmZml4LFxuICAgICAgICAgICAgb3JpZ2luYWxGaWVsZDogZmllbGRJZFxuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vIE5vIHByZWZpeCBkZXRlY3RlZFxuICAgIGNvbnN0IGhhc0lkU3VmZml4ID0gZmllbGRJZC50b0xvd2VyQ2FzZSgpLmVuZHNXaXRoKCdpZCcpO1xuICAgIGNvbnN0IGJhc2VOYW1lID0gaGFzSWRTdWZmaXhcbiAgICAgICAgPyBmaWVsZElkLnN1YnN0cmluZygwLCBmaWVsZElkLmxlbmd0aCAtIDIpXG4gICAgICAgIDogZmllbGRJZDtcblxuICAgIHJldHVybiB7XG4gICAgICAgIGJhc2VOYW1lLFxuICAgICAgICBoYXNJZFN1ZmZpeCxcbiAgICAgICAgb3JpZ2luYWxGaWVsZDogZmllbGRJZFxuICAgIH07XG59XG5cbi8qKlxuICogR2VuZXJhdGUgc2VhcmNoIHBhdHRlcm5zIGZvciBjYW5kaWRhdGUgZmllbGQgbmFtZXMuXG4gKiBcbiAqIFByaW9yaXR5OlxuICogMS4gUHJlZmVycmVkIGZpZWxkcyAoZnJvbSBoaW50cylcbiAqIDIuIEV4YWN0IHByZWZpeCBtYXRjaDoge3ByZWZpeH17YmFzZU5hbWV9e3N1ZmZpeH1cbiAqIDMuIEVudGl0eSBuYW1lIG1hdGNoOiB7ZW50aXR5TmFtZX17c3VmZml4fVxuICogNC4gQmFzZSBuYW1lIG1hdGNoOiB7YmFzZU5hbWV9e3N1ZmZpeH1cbiAqL1xuZnVuY3Rpb24gZ2VuZXJhdGVTZWFyY2hQYXR0ZXJucyhcbiAgICBwYXJzZWQ6IFBhcnNlZFJlbGF0aW9uRmllbGQsXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIHN1ZmZpeGVzOiBzdHJpbmdbXSxcbiAgICBwcmVmZXJyZWRGaWVsZHM/OiBzdHJpbmdbXVxuKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IHBhdHRlcm5zOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IGVudGl0eU5hbWVMb3dlciA9IGVudGl0eU5hbWUudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBiYXNlTmFtZUxvd2VyID0gcGFyc2VkLmJhc2VOYW1lLnRvTG93ZXJDYXNlKCk7XG5cbiAgICAvLyBQcmlvcml0eSAxOiBQcmVmZXJyZWQgZmllbGRzIChleGFjdCBtYXRjaClcbiAgICBpZiAocHJlZmVycmVkRmllbGRzICYmIHByZWZlcnJlZEZpZWxkcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goLi4ucHJlZmVycmVkRmllbGRzKTtcbiAgICB9XG5cbiAgICAvLyBQcmlvcml0eSAyOiBXaXRoIHByZWZpeCAoZS5nLiwgaG9tZVRlYW1OYW1lLCBhd2F5VGVhbU5hbWUpXG4gICAgaWYgKHBhcnNlZC5wcmVmaXgpIHtcbiAgICAgICAgY29uc3QgcHJlZml4TG93ZXIgPSBwYXJzZWQucHJlZml4LnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIGZvciAoY29uc3Qgc3VmZml4IG9mIHN1ZmZpeGVzKSB7XG4gICAgICAgICAgICBwYXR0ZXJucy5wdXNoKGAke3ByZWZpeExvd2VyfSR7YmFzZU5hbWVMb3dlcn0ke3N1ZmZpeC50b0xvd2VyQ2FzZSgpfWApO1xuICAgICAgICAgICAgcGF0dGVybnMucHVzaChgJHtwcmVmaXhMb3dlcn0ke2VudGl0eU5hbWVMb3dlcn0ke3N1ZmZpeC50b0xvd2VyQ2FzZSgpfWApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gUHJpb3JpdHkgMzogRW50aXR5IG5hbWUgKGUuZy4sIHRlYW1OYW1lIGZvciByZWxhdGlvbiB0byAndGVhbScpXG4gICAgZm9yIChjb25zdCBzdWZmaXggb2Ygc3VmZml4ZXMpIHtcbiAgICAgICAgcGF0dGVybnMucHVzaChgJHtlbnRpdHlOYW1lTG93ZXJ9JHtzdWZmaXgudG9Mb3dlckNhc2UoKX1gKTtcbiAgICB9XG5cbiAgICAvLyBQcmlvcml0eSA0OiBCYXNlIG5hbWUgKGUuZy4sIHRlYW1OYW1lIGZvciAndGVhbUlkJylcbiAgICBmb3IgKGNvbnN0IHN1ZmZpeCBvZiBzdWZmaXhlcykge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGAke2Jhc2VOYW1lTG93ZXJ9JHtzdWZmaXgudG9Mb3dlckNhc2UoKX1gKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcGF0dGVybnM7XG59XG5cbi8qKlxuICogU2VhcmNoIGZvciBmaWVsZHMgbWF0Y2hpbmcgcGF0dGVybnMsIGV4Y2x1ZGluZyBzcGVjaWZpZWQgZmllbGRzLlxuICovXG5mdW5jdGlvbiBzZWFyY2hGaWVsZHNCeVBhdHRlcm5zKFxuICAgIGFsbFByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLFxuICAgIHBhdHRlcm5zOiBzdHJpbmdbXSxcbiAgICBleGNsdWRlRmllbGRzPzogc3RyaW5nW11cbik6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBleGNsdWRlU2V0ID0gbmV3IFNldChleGNsdWRlRmllbGRzPy5tYXAoZiA9PiBmLnRvTG93ZXJDYXNlKCkpIHx8IFtdKTtcbiAgICBjb25zdCBmb3VuZDogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCBzZWVuTG93ZXIgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICAgIGZvciAoY29uc3QgcGF0dGVybiBvZiBwYXR0ZXJucykge1xuICAgICAgICBjb25zdCBwYXR0ZXJuTG93ZXIgPSBwYXR0ZXJuLnRvTG93ZXJDYXNlKCk7XG5cbiAgICAgICAgLy8gU2tpcCBpZiBhbHJlYWR5IGZvdW5kIG9yIGV4Y2x1ZGVkXG4gICAgICAgIGlmIChzZWVuTG93ZXIuaGFzKHBhdHRlcm5Mb3dlcikgfHwgZXhjbHVkZVNldC5oYXMocGF0dGVybkxvd2VyKSkge1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGaW5kIG1hdGNoaW5nIGZpZWxkIChjYXNlLWluc2Vuc2l0aXZlKVxuICAgICAgICBjb25zdCBtYXRjaCA9IGFsbFByb3BlcnRpZXMuZmluZChwID0+XG4gICAgICAgICAgICBwLmlkPy50b0xvd2VyQ2FzZSgpID09PSBwYXR0ZXJuTG93ZXIgJiZcbiAgICAgICAgICAgICFleGNsdWRlU2V0LmhhcyhwLmlkLnRvTG93ZXJDYXNlKCkpXG4gICAgICAgICk7XG5cbiAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgICBmb3VuZC5wdXNoKG1hdGNoLmlkKTtcbiAgICAgICAgICAgIHNlZW5Mb3dlci5hZGQobWF0Y2guaWQudG9Mb3dlckNhc2UoKSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZm91bmQ7XG59XG5cbi8qKlxuICogQ2FsY3VsYXRlIGNvbmZpZGVuY2UgYmFzZWQgb24gZGV0ZWN0aW9uIG1ldGhvZCBhbmQgcGF0dGVyblxuICovXG5mdW5jdGlvbiBjYWxjdWxhdGVDb25maWRlbmNlKFxuICAgIGRldGVjdGVkRmllbGQ6IHN0cmluZyxcbiAgICBwYXJzZWQ6IFBhcnNlZFJlbGF0aW9uRmllbGQsXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIG1ldGhvZDogJ3ByZWZlcnJlZCcgfCAncHJlZml4JyB8ICdlbnRpdHknIHwgJ2Jhc2UnXG4pOiAnaGlnaCcgfCAnbWVkaXVtJyB8ICdsb3cnIHtcbiAgICAvLyBQcmVmZXJyZWQgZmllbGRzID0gaGlnaCBjb25maWRlbmNlIChkZXZlbG9wZXIgZXhwbGljaXRseSBzcGVjaWZpZWQpXG4gICAgaWYgKG1ldGhvZCA9PT0gJ3ByZWZlcnJlZCcpIHJldHVybiAnaGlnaCc7XG5cbiAgICBjb25zdCBmaWVsZExvd2VyID0gZGV0ZWN0ZWRGaWVsZC50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IGVudGl0eUxvd2VyID0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IGJhc2VMb3dlciA9IHBhcnNlZC5iYXNlTmFtZS50b0xvd2VyQ2FzZSgpO1xuXG4gICAgLy8gRXhhY3QgcHJlZml4ICsgZW50aXR5L2Jhc2UgbWF0Y2ggPSBoaWdoXG4gICAgaWYgKG1ldGhvZCA9PT0gJ3ByZWZpeCcpIHtcbiAgICAgICAgaWYgKGZpZWxkTG93ZXIuaW5jbHVkZXMoZW50aXR5TG93ZXIpIHx8IGZpZWxkTG93ZXIuaW5jbHVkZXMoYmFzZUxvd2VyKSkge1xuICAgICAgICAgICAgcmV0dXJuICdoaWdoJztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gJ21lZGl1bSc7XG4gICAgfVxuXG4gICAgLy8gRW50aXR5IG5hbWUgbWF0Y2ggPSBoaWdoXG4gICAgaWYgKG1ldGhvZCA9PT0gJ2VudGl0eScpIHJldHVybiAnaGlnaCc7XG5cbiAgICAvLyBCYXNlIG5hbWUgbWF0Y2ggPSBtZWRpdW0gKGNvdWxkIGJlIGNvaW5jaWRlbnRhbClcbiAgICBpZiAobWV0aG9kID09PSAnYmFzZScpIHJldHVybiAnbWVkaXVtJztcblxuICAgIHJldHVybiAnbG93Jztcbn1cblxuLyoqXG4gKiBHZW5lcmF0ZSB0ZW1wbGF0ZSBzdHJpbmcgZnJvbSBkZXRlY3RlZCBmaWVsZHMuXG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlVGVtcGxhdGUoXG4gICAgcHJpbWFyeUZpZWxkOiBzdHJpbmcsXG4gICAgYWxsRGV0ZWN0ZWRGaWVsZHM6IER1cGxpY2F0ZWRGaWVsZERldGVjdGlvblJlc3VsdFsgJ2RldGVjdGVkRmllbGRzJyBdLFxuICAgIHRlbXBsYXRlU3R5bGU6ICdzaW1wbGUnIHwgJ2NvbXBvc2l0ZSdcbik6IHN0cmluZyB7XG4gICAgaWYgKHRlbXBsYXRlU3R5bGUgPT09ICdzaW1wbGUnKSB7XG4gICAgICAgIHJldHVybiBgeyR7cHJpbWFyeUZpZWxkfX1gO1xuICAgIH1cblxuICAgIC8vIENvbXBvc2l0ZTogdHJ5IHRvIGluY2x1ZGUgbWV0YSBmaWVsZCAoY29kZS9zbHVnKSBpZiBhdmFpbGFibGVcbiAgICBpZiAodGVtcGxhdGVTdHlsZSA9PT0gJ2NvbXBvc2l0ZScgJiYgYWxsRGV0ZWN0ZWRGaWVsZHMubWV0YSAmJiBhbGxEZXRlY3RlZEZpZWxkcy5tZXRhLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgbWV0YUZpZWxkID0gYWxsRGV0ZWN0ZWRGaWVsZHMubWV0YVsgMCBdO1xuICAgICAgICByZXR1cm4gYHske3ByaW1hcnlGaWVsZH19ICh7JHttZXRhRmllbGR9fSlgO1xuICAgIH1cblxuICAgIC8vIEZhbGxiYWNrIHRvIHNpbXBsZSBpZiBubyBtZXRhIGZpZWxkXG4gICAgcmV0dXJuIGB7JHtwcmltYXJ5RmllbGR9fWA7XG59XG5cbi8qKlxuICogRW5oYW5jZWQgc21hcnQgZHVwbGljYXRlZCBmaWVsZCBkZXRlY3Rpb24uXG4gKiBcbiAqIERldGVjdHMgZmllbGRzIGxpa2UgJ3RlYW1OYW1lJyBmb3IgJ3RlYW1JZCcgcmVsYXRpb25zIHdpdGggc3VwcG9ydCBmb3I6XG4gKiAtIFByZWZpeGVzIChob21lLCBhd2F5LCBjb21wZXRpdG9yMSwgZXRjLilcbiAqIC0gTXVsdGlwbGUgc3VmZml4ZXMgKE5hbWUsIFRpdGxlLCBMYWJlbCwgTG9nbywgQ29kZSwgZXRjLilcbiAqIC0gUHJlZmVycmVkIGZpZWxkcyBhbmQgZXhjbHVzaW9uc1xuICogLSBDb25maWRlbmNlIHNjb3JpbmdcbiAqIC0gQ29tcG9zaXRlIHRlbXBsYXRlc1xuICogXG4gKiBAcGFyYW0gYWxsUHJvcGVydGllcyAtIEFsbCBwcm9wZXJ0aWVzIGluIHRoZSBwYXJlbnQgZW50aXR5XG4gKiBAcGFyYW0gcmVsYXRpb25GaWVsZElkIC0gVGhlIHJlbGF0aW9uIGZpZWxkIG5hbWUgKGUuZy4sICd0ZWFtSWQnLCAnaG9tZVRlYW1JZCcpXG4gKiBAcGFyYW0gcmVsYXRlZEVudGl0eU5hbWUgLSBSZWxhdGVkIGVudGl0eSBuYW1lIChlLmcuLCAndGVhbScpXG4gKiBAcGFyYW0gZ2xvYmFsQ29uZmlnIC0gR2xvYmFsIGRldGVjdGlvbiBjb25maWd1cmF0aW9uXG4gKiBAcGFyYW0gZW50aXR5Q29uZmlnIC0gRW50aXR5LWxldmVsIGRldGVjdGlvbiBjb25maWd1cmF0aW9uXG4gKiBAcGFyYW0gcmVsYXRpb25IaW50cyAtIFJlbGF0aW9uLXNwZWNpZmljIGhpbnRzXG4gKiBAcmV0dXJucyBEZXRlY3Rpb24gcmVzdWx0IHdpdGggdGVtcGxhdGUgYW5kIG1ldGFkYXRhXG4gKi9cbmZ1bmN0aW9uIGRldGVjdER1cGxpY2F0ZWRSZWxhdGlvbkZpZWxkcyhcbiAgICBhbGxQcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSxcbiAgICByZWxhdGlvbkZpZWxkSWQ6IHN0cmluZyxcbiAgICByZWxhdGVkRW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGdsb2JhbENvbmZpZz86IElEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25Db25maWcsXG4gICAgZW50aXR5Q29uZmlnPzogSUR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbkNvbmZpZyxcbiAgICByZWxhdGlvbkhpbnRzPzoge1xuICAgICAgICBwcmVmZXJyZWRGaWVsZHM/OiBzdHJpbmdbXTtcbiAgICAgICAgZXhjbHVkZUZpZWxkcz86IHN0cmluZ1tdO1xuICAgICAgICB0ZW1wbGF0ZVN0eWxlPzogJ3NpbXBsZScgfCAnY29tcG9zaXRlJztcbiAgICB9XG4pOiBEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25SZXN1bHQgfCB1bmRlZmluZWQge1xuICAgIC8vIE1lcmdlIGNvbmZpZ3VyYXRpb25zXG4gICAgY29uc3QgY29uZmlnID0gbWVyZ2VEZXRlY3Rpb25Db25maWdzKGdsb2JhbENvbmZpZywgZW50aXR5Q29uZmlnLCByZWxhdGlvbkhpbnRzKTtcblxuICAgIC8vIENoZWNrIGlmIGRldGVjdGlvbiBpcyBlbmFibGVkXG4gICAgaWYgKCFjb25maWcuZW5hYmxlZCkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8vIFBhcnNlIHJlbGF0aW9uIGZpZWxkXG4gICAgY29uc3QgcGFyc2VkID0gcGFyc2VSZWxhdGlvbkZpZWxkKHJlbGF0aW9uRmllbGRJZCwgY29uZmlnLnByZWZpeGVzKTtcblxuICAgIC8vIFNlYXJjaCBmb3IgZGlzcGxheSBmaWVsZHMgKE5hbWUsIFRpdGxlLCBMYWJlbClcbiAgICBjb25zdCBkaXNwbGF5UGF0dGVybnMgPSBnZW5lcmF0ZVNlYXJjaFBhdHRlcm5zKFxuICAgICAgICBwYXJzZWQsXG4gICAgICAgIHJlbGF0ZWRFbnRpdHlOYW1lLFxuICAgICAgICBjb25maWcuc3VmZml4ZXM/LmRpc3BsYXkgfHwgW10sXG4gICAgICAgIGNvbmZpZy5wcmVmZXJyZWRGaWVsZHNcbiAgICApO1xuICAgIGNvbnN0IGRpc3BsYXlGaWVsZHMgPSBzZWFyY2hGaWVsZHNCeVBhdHRlcm5zKGFsbFByb3BlcnRpZXMsIGRpc3BsYXlQYXR0ZXJucywgY29uZmlnLmV4Y2x1ZGVGaWVsZHMpO1xuXG4gICAgLy8gU2VhcmNoIGZvciB2aXN1YWwgZmllbGRzIChMb2dvLCBJbWFnZSwgSWNvbilcbiAgICBjb25zdCB2aXN1YWxQYXR0ZXJucyA9IGdlbmVyYXRlU2VhcmNoUGF0dGVybnMoXG4gICAgICAgIHBhcnNlZCxcbiAgICAgICAgcmVsYXRlZEVudGl0eU5hbWUsXG4gICAgICAgIGNvbmZpZy5zdWZmaXhlcz8udmlzdWFsIHx8IFtdXG4gICAgKTtcbiAgICBjb25zdCB2aXN1YWxGaWVsZHMgPSBzZWFyY2hGaWVsZHNCeVBhdHRlcm5zKGFsbFByb3BlcnRpZXMsIHZpc3VhbFBhdHRlcm5zLCBjb25maWcuZXhjbHVkZUZpZWxkcyk7XG5cbiAgICAvLyBTZWFyY2ggZm9yIG1ldGEgZmllbGRzIChDb2RlLCBTbHVnLCBLZXkpXG4gICAgY29uc3QgbWV0YVBhdHRlcm5zID0gZ2VuZXJhdGVTZWFyY2hQYXR0ZXJucyhcbiAgICAgICAgcGFyc2VkLFxuICAgICAgICByZWxhdGVkRW50aXR5TmFtZSxcbiAgICAgICAgY29uZmlnLnN1ZmZpeGVzPy5tZXRhIHx8IFtdXG4gICAgKTtcbiAgICBjb25zdCBtZXRhRmllbGRzID0gc2VhcmNoRmllbGRzQnlQYXR0ZXJucyhhbGxQcm9wZXJ0aWVzLCBtZXRhUGF0dGVybnMsIGNvbmZpZy5leGNsdWRlRmllbGRzKTtcblxuICAgIC8vIE5vIGZpZWxkcyBkZXRlY3RlZFxuICAgIGlmIChkaXNwbGF5RmllbGRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8vIERldGVybWluZSBkZXRlY3Rpb24gbWV0aG9kXG4gICAgY29uc3QgcHJpbWFyeUZpZWxkID0gZGlzcGxheUZpZWxkc1sgMCBdO1xuICAgIGxldCBtZXRob2Q6ICdwcmVmZXJyZWQnIHwgJ3ByZWZpeCcgfCAnZW50aXR5JyB8ICdiYXNlJyA9ICdiYXNlJztcbiAgICBsZXQgcGF0dGVybiA9ICd1bmtub3duJztcblxuICAgIGlmIChjb25maWcucHJlZmVycmVkRmllbGRzICYmIGNvbmZpZy5wcmVmZXJyZWRGaWVsZHMuaW5jbHVkZXMocHJpbWFyeUZpZWxkKSkge1xuICAgICAgICBtZXRob2QgPSAncHJlZmVycmVkJztcbiAgICAgICAgcGF0dGVybiA9ICdwcmVmZXJyZWRfZmllbGQnO1xuICAgIH0gZWxzZSBpZiAocGFyc2VkLnByZWZpeCAmJiBwcmltYXJ5RmllbGQudG9Mb3dlckNhc2UoKS5zdGFydHNXaXRoKHBhcnNlZC5wcmVmaXgudG9Mb3dlckNhc2UoKSkpIHtcbiAgICAgICAgbWV0aG9kID0gJ3ByZWZpeCc7XG4gICAgICAgIHBhdHRlcm4gPSBgJHtwYXJzZWQucHJlZml4fXtlbnRpdHl9e3N1ZmZpeH1gO1xuICAgIH0gZWxzZSBpZiAocHJpbWFyeUZpZWxkLnRvTG93ZXJDYXNlKCkuc3RhcnRzV2l0aChyZWxhdGVkRW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpKSkge1xuICAgICAgICBtZXRob2QgPSAnZW50aXR5JztcbiAgICAgICAgcGF0dGVybiA9IGB7ZW50aXR5fXtzdWZmaXh9YDtcbiAgICB9IGVsc2Uge1xuICAgICAgICBtZXRob2QgPSAnYmFzZSc7XG4gICAgICAgIHBhdHRlcm4gPSBge2Jhc2V9e3N1ZmZpeH1gO1xuICAgIH1cblxuICAgIC8vIENhbGN1bGF0ZSBjb25maWRlbmNlXG4gICAgY29uc3QgY29uZmlkZW5jZSA9IGNhbGN1bGF0ZUNvbmZpZGVuY2UocHJpbWFyeUZpZWxkLCBwYXJzZWQsIHJlbGF0ZWRFbnRpdHlOYW1lLCBtZXRob2QpO1xuXG4gICAgLy8gQ2hlY2sgY29uZmlkZW5jZSB0aHJlc2hvbGRcbiAgICBjb25zdCB0aHJlc2hvbGRPcmRlciA9IHsgbG93OiAwLCBtZWRpdW06IDEsIGhpZ2g6IDIgfTtcbiAgICBpZiAodGhyZXNob2xkT3JkZXJbIGNvbmZpZGVuY2UgXSA8IHRocmVzaG9sZE9yZGVyWyBjb25maWcuY29uZmlkZW5jZVRocmVzaG9sZCBdKSB7XG4gICAgICAgIC8vIENvbmZpZGVuY2UgdG9vIGxvd1xuICAgICAgICBpZiAoY29uZmlnLmRlYnVnKSB7XG4gICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25dIFNraXBwaW5nICR7cmVsYXRpb25GaWVsZElkfTogY29uZmlkZW5jZSAke2NvbmZpZGVuY2V9IDwgdGhyZXNob2xkICR7Y29uZmlnLmNvbmZpZGVuY2VUaHJlc2hvbGR9YCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyBHZW5lcmF0ZSB0ZW1wbGF0ZVxuICAgIGNvbnN0IHRlbXBsYXRlID0gZ2VuZXJhdGVUZW1wbGF0ZShcbiAgICAgICAgcHJpbWFyeUZpZWxkLFxuICAgICAgICB7IGRpc3BsYXk6IGRpc3BsYXlGaWVsZHMsIHZpc3VhbDogdmlzdWFsRmllbGRzLCBtZXRhOiBtZXRhRmllbGRzIH0sXG4gICAgICAgIGNvbmZpZy50ZW1wbGF0ZVN0eWxlXG4gICAgKTtcblxuICAgIC8vIERlYnVnIGxvZ2dpbmdcbiAgICBpZiAoY29uZmlnLmRlYnVnKSB7XG4gICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW0R1cGxpY2F0ZWRGaWVsZERldGVjdGlvbl0gJHtyZWxhdGlvbkZpZWxkSWR9IOKGkiAke3RlbXBsYXRlfSAoY29uZmlkZW5jZTogJHtjb25maWRlbmNlfSwgbWV0aG9kOiAke21ldGhvZH0pYCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgcHJpbWFyeUZpZWxkLFxuICAgICAgICB0ZW1wbGF0ZSxcbiAgICAgICAgZGV0ZWN0ZWRGaWVsZHM6IHtcbiAgICAgICAgICAgIGRpc3BsYXk6IGRpc3BsYXlGaWVsZHMsXG4gICAgICAgICAgICB2aXN1YWw6IHZpc3VhbEZpZWxkcy5sZW5ndGggPiAwID8gdmlzdWFsRmllbGRzIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgbWV0YTogbWV0YUZpZWxkcy5sZW5ndGggPiAwID8gbWV0YUZpZWxkcyA6IHVuZGVmaW5lZFxuICAgICAgICB9LFxuICAgICAgICBjb25maWRlbmNlLFxuICAgICAgICBtZXRob2QsXG4gICAgICAgIHBhdHRlcm5cbiAgICB9O1xufVxuXG4vKipcbiAqIExlZ2FjeSB3cmFwcGVyIGZ1bmN0aW9uIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5LlxuICogXG4gKiBAZGVwcmVjYXRlZCBVc2UgZGV0ZWN0RHVwbGljYXRlZFJlbGF0aW9uRmllbGRzKCkgZm9yIHJpY2hlciByZXN1bHRzXG4gKi9cbmZ1bmN0aW9uIGRldGVjdER1cGxpY2F0ZWRSZWxhdGlvbkZpZWxkVGVtcGxhdGUoXG4gICAgYWxsUHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sXG4gICAgcmVsYXRpb25GaWVsZElkOiBzdHJpbmcsXG4gICAgcmVsYXRlZEVudGl0eU5hbWU6IHN0cmluZ1xuKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCByZXN1bHQgPSBkZXRlY3REdXBsaWNhdGVkUmVsYXRpb25GaWVsZHMoXG4gICAgICAgIGFsbFByb3BlcnRpZXMsXG4gICAgICAgIHJlbGF0aW9uRmllbGRJZCxcbiAgICAgICAgcmVsYXRlZEVudGl0eU5hbWVcbiAgICApO1xuICAgIHJldHVybiByZXN1bHQ/LnRlbXBsYXRlO1xufVxuXG4vKipcbiAqIEdlbmVyYXRlIHNtYXJ0IGZhbGxiYWNrIGNvbmZpZ3VyYXRpb24gZm9yIHJlbGF0aW9uIGRpc3BsYXkgd2hlbiBvbmx5IElEIGlzIGF2YWlsYWJsZS5cbiAqIFVzZXMgZW50aXR5IG1ldGFkYXRhIChpY29uLCBlbnRpdHlOYW1lUGx1cmFsKSB0byBjcmVhdGUgdXNlci1mcmllbmRseSBmYWxsYmFjayB0ZXh0LlxuICogXG4gKiBAcGFyYW0gZW50aXR5TmFtZSAtIFJlbGF0ZWQgZW50aXR5IG5hbWUgKGUuZy4sICd0ZWFtJylcbiAqIEBwYXJhbSBpZEZpZWxkIC0gSUQgZmllbGQgbmFtZSAoZS5nLiwgJ3RlYW1JZCcpXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIHRvIGdldCBtZXRhZGF0YSBmcm9tXG4gKiBAcmV0dXJucyBGYWxsYmFjayBjb25maWd1cmF0aW9uIHdpdGggdGVtcGxhdGUsIGxpbmtUZXh0LCBhbmQgbW9kYWxCdXR0b25UZXh0XG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyBGb3IgYSB0ZWFtIHJlbGF0aW9uXG4gKiBnZW5lcmF0ZVJlbGF0aW9uRmFsbGJhY2soJ3RlYW0nLCAndGVhbUlkJywgdGVhbVNlcnZpY2UpXG4gKiAvLyBSZXR1cm5zOiB7XG4gKiAvLyAgIHRlbXBsYXRlOiAnVGVhbToge3RlYW1JZH0nLFxuICogLy8gICBsaW5rVGV4dDogJ1ZpZXcgVGVhbScsXG4gKiAvLyAgIG1vZGFsQnV0dG9uVGV4dDogJ1RlYW0gRGV0YWlscydcbiAqIC8vIH1cbiAqL1xuLyoqXG4gKiBHZW5lcmF0ZXMgZmFsbGJhY2sgZGlzcGxheSBjb25maWd1cmF0aW9uIGZvciByZWxhdGlvbiBmaWVsZHMuXG4gKiBcbiAqIENyZWF0ZXMgdXNlci1mcmllbmRseSBmYWxsYmFjayB0ZXh0IHRvIGRpc3BsYXkgd2hlbiBvbmx5IHRoZSBJRCBvZiBhIHJlbGF0ZWQgZW50aXR5IGlzIGF2YWlsYWJsZS5cbiAqIFVzZXMgdGhlIGVudGl0eSdzIHBsdXJhbCBkaXNwbGF5IG5hbWUgKGZyb20gbWV0YWRhdGEpIG9yIGdlbmVyYXRlcyBpdCBmcm9tIHRoZSBlbnRpdHkgbmFtZS5cbiAqIFxuICogQHBhcmFtIGVudGl0eU5hbWUgLSBOYW1lIG9mIHRoZSByZWxhdGVkIGVudGl0eSAoZS5nLiwgJ3RlYW0nLCAndXNlcicpXG4gKiBAcGFyYW0gaWRGaWVsZCAtIElEIGZpZWxkIG5hbWUgKGUuZy4sICd0ZWFtSWQnLCAndXNlcklkJylcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gT3B0aW9uYWwgZW50aXR5IHNlcnZpY2UgdG8gZmV0Y2ggbWV0YWRhdGEgZm9yIGJldHRlciBuYW1pbmdcbiAqIEByZXR1cm5zIEZhbGxiYWNrIGNvbmZpZ3VyYXRpb24gd2l0aCB0ZW1wbGF0ZSwgbGluayB0ZXh0LCBhbmQgbW9kYWwgYnV0dG9uIHRleHRcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IGZhbGxiYWNrID0gZ2VuZXJhdGVSZWxhdGlvbkZhbGxiYWNrKCd0ZWFtJywgJ3RlYW1JZCcpO1xuICogLy8gUmV0dXJuczoge1xuICogLy8gICB0ZW1wbGF0ZTogXCJUZWFtczoge3RlYW1JZH1cIixcbiAqIC8vICAgbGlua1RleHQ6IFwiVmlldyBUZWFtc1wiLFxuICogLy8gICBtb2RhbEJ1dHRvblRleHQ6IFwiVGVhbXMgRGV0YWlsc1wiXG4gKiAvLyB9XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdlbmVyYXRlUmVsYXRpb25GYWxsYmFjayhcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgaWRGaWVsZDogc3RyaW5nLFxuICAgIGVudGl0eVNlcnZpY2U/OiBCYXNlRW50aXR5U2VydmljZTxhbnk+XG4pOiBOb25OdWxsYWJsZTxJUmVsYXRpb25GaWVsZENvbmZpZ1sgJ2Rpc3BsYXlDb25maWcnIF0+WyAnZmFsbGJhY2snIF0ge1xuICAgIC8vIFRyeSB0byBnZXQgZW50aXR5IG1ldGFkYXRhIGZvciBiZXR0ZXIgZmFsbGJhY2sgdGV4dFxuICAgIGNvbnN0IGVudGl0eU1ldGFkYXRhID0gZW50aXR5U2VydmljZT8uZ2V0RW50aXR5U2NoZW1hPy4oKS5tb2RlbDtcbiAgICBjb25zdCBkaXNwbGF5TmFtZSA9IGVudGl0eU1ldGFkYXRhPy5lbnRpdHlOYW1lUGx1cmFsIHx8IHBhc2NhbENhc2UoZW50aXR5TmFtZSk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgICAvLyBCYWNrZW5kIHByZS1nZW5lcmF0ZXMgZmFsbGJhY2sgdGVtcGxhdGUgKGludGVudGlvbmFsbHkgc3RyaW5nLW9ubHksIG5vdCBUZW1wbGF0ZSB0eXBlKVxuICAgICAgICAvLyBGcm9udGVuZCB3aWxsIHVzZSB0aGlzIHdoZW4gb25seSBJRCBpcyBhdmFpbGFibGVcbiAgICAgICAgdGVtcGxhdGU6IGAke2Rpc3BsYXlOYW1lfTogeyR7aWRGaWVsZH19YCwgIC8vIGUuZy4sIFwiVGVhbToge3RlYW1JZH1cIlxuICAgICAgICBsaW5rVGV4dDogYFZpZXcgJHtkaXNwbGF5TmFtZX1gLCAgICAgICAgICAgLy8gZS5nLiwgXCJWaWV3IFRlYW1cIlxuICAgICAgICBtb2RhbEJ1dHRvblRleHQ6IGAke2Rpc3BsYXlOYW1lfSBEZXRhaWxzYCAgLy8gZS5nLiwgXCJUZWFtIERldGFpbHNcIlxuICAgIH07XG59XG5cbi8qKlxuICogTGFiZWwgZmllbGQgZGV0ZWN0aW9uIHJlc3VsdCB3aXRoIGNvbmZpZGVuY2Ugc2NvcmluZ1xuICovXG5pbnRlcmZhY2UgTGFiZWxGaWVsZERldGVjdGlvblJlc3VsdCB7XG4gICAgZmllbGQ6IHN0cmluZztcbiAgICBjb25maWRlbmNlOiAnaGlnaCcgfCAnbWVkaXVtJzsgIC8vIE9ubHkgaGlnaCBvciBtZWRpdW0gLSBubyBsb3cgY29uZmlkZW5jZSByZXN1bHRzIHJldHVybmVkXG4gICAgbWV0aG9kOiAnbWV0YWRhdGEnIHwgJ2NvbW1vbi1wYXR0ZXJuJyB8ICdlbnRpdHktcGF0dGVybicgfCAnc3VmZml4LXBhdHRlcm4nO1xufVxuXG4vKipcbiAqIFNtYXJ0IGxhYmVsIGZpZWxkIGRldGVjdGlvbiBmb3IgZW50aXR5IG9wdGlvbnMuXG4gKiBVc2VzIGdlbmVyaWMgcGF0dGVybnMgdG8gZmluZCBkaXNwbGF5IGZpZWxkcyB0aGF0IGFyZSBhY3R1YWwgaWRlbnRpZmllcnMvbmFtZXMuXG4gKiBcbiAqICoqSElHSExZIENPTlNFUlZBVElWRSoqOiBPbmx5IHJldHVybnMgZmllbGRzIHRoYXQgYXJlIGNsZWFybHkgbWVhbnQgZm9yIGRpc3BsYXkuXG4gKiBSZXR1cm5zIHVuZGVmaW5lZCBpZiBubyBwcm9wZXIgbmFtZSBmaWVsZCBpcyBmb3VuZCAtIGJldHRlciB0byBzaG93IElEIHRoYW4gY29uZnVzZSB1c2Vycy5cbiAqIFxuICogRGV0ZWN0aW9uIG9yZGVyIChhbGwgSElHSCBvciBNRURJVU0gY29uZmlkZW5jZSk6XG4gKiAxLiBFbnRpdHkgbWV0YWRhdGEgKGVudGl0eU5hbWVBdHRyaWJ1dGUpIC0gSElHSCBjb25maWRlbmNlXG4gKiAyLiBDb21tb24gZGlzcGxheSBmaWVsZCBwYXR0ZXJucyAobmFtZSwgdGl0bGUsIGxhYmVsLCBkaXNwbGF5TmFtZSkgLSBISUdIIGNvbmZpZGVuY2UgIFxuICogMy4gRW50aXR5LXNwZWNpZmljIHBhdHRlcm5zICh7ZW50aXR5TmFtZX1OYW1lLCB7ZW50aXR5TmFtZX1UaXRsZSkgLSBISUdIIGNvbmZpZGVuY2VcbiAqIDQuIEZpZWxkcyBlbmRpbmcgd2l0aCBuYW1lLWxpa2Ugc3VmZml4ZXMgKE5hbWUsIFRpdGxlLCBMYWJlbCwgQ29kZSkgLSBNRURJVU0gY29uZmlkZW5jZVxuICogXG4gKiAqKk5PIEZBTExCQUNLKio6IElmIG5vbmUgb2YgdGhlIGFib3ZlIG1hdGNoLCByZXR1cm5zIHVuZGVmaW5lZC5cbiAqIFdlIGRvIE5PVCBwaWNrIGdlbmVyaWMgZmllbGRzIGxpa2UgJ3N0YXR1cycsICd0eXBlJywgb3IgcmFuZG9tIGVudW1zL3N0cmluZ3MuXG4gKiBcbiAqIFdoeSBubyBmYWxsYmFjaz9cbiAqIC0gU2hvd2luZyBcImFjdGl2ZVwiL1wiY2FuY2VsbGVkXCIgZm9yIHN1YnNjcmlwdGlvbnMgaXMgY29uZnVzaW5nICh3aGljaCBzdWJzY3JpcHRpb24/KVxuICogLSBTaG93aW5nIFwiY3JlZGl0X2NhcmRcIi9cInBheXBhbFwiIGZvciBwYXltZW50IG1ldGhvZHMgaXMgbm90IGFuIGlkZW50aWZpZXJcbiAqIC0gQmV0dGVyIHRvIHNob3cgc3Vic2NyaXB0aW9uSWQgdGhhbiBtaXNsZWFkaW5nIGZpZWxkc1xuICogXG4gKiBGb3IgZW50aXRpZXMgd2l0aG91dCBuYW1lIGZpZWxkcywgdXNlIG9uZSBvZjpcbiAqIC0gU2V0IGVudGl0eU5hbWVBdHRyaWJ1dGUgaW4gc2NoZW1hIG1ldGFkYXRhXG4gKiAtIFVzZSBvcHRpb25NYXBwaW5nIGluIHJlbGF0aW9uIGNvbmZpZ1xuICogLSBMZXQgaXQgZmFsbCBiYWNrIHRvIElEIChjbGVhcmVzdCBvcHRpb24pXG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyBFbnRpdGllcyB3aXRoIGNsZWFyIG5hbWUgZmllbGRzIC0gREVURUNURUQg4pyFXG4gKiBUZWFtIOKGkiB0ZWFtTmFtZSAoUHJpb3JpdHkgMywgSElHSCBjb25maWRlbmNlKVxuICogVXNlciDihpIgbmFtZSAoUHJpb3JpdHkgMiwgSElHSCBjb25maWRlbmNlKVxuICogUG9zdCDihpIgcG9zdFRpdGxlIChQcmlvcml0eSA0LCBNRURJVU0gY29uZmlkZW5jZSlcbiAqIFxuICogQGV4YW1wbGUgIFxuICogLy8gRW50aXRpZXMgd2l0aG91dCBuYW1lIGZpZWxkcyAtIFJFVFVSTlMgdW5kZWZpbmVkIOKchVxuICogU3Vic2NyaXB0aW9uIOKGkiB1bmRlZmluZWQgKGZhbGxzIGJhY2sgdG8gc3Vic2NyaXB0aW9uSWQgLSBjbGVhciEpXG4gKiBQYXltZW50TWV0aG9kIOKGkiB1bmRlZmluZWQgKGZhbGxzIGJhY2sgdG8gcGF5bWVudE1ldGhvZElkIC0gY2xlYXIhKVxuICogQXVkaXRMb2cg4oaSIHVuZGVmaW5lZCAoZmFsbHMgYmFjayB0byBhdWRpdExvZ0lkIC0gY2xlYXIhKVxuICogXG4gKiBAcGFyYW0gc2NoZW1hIC0gRW50aXR5IHNjaGVtYVxuICogQHBhcmFtIGVudGl0eU5hbWUgLSBFbnRpdHkgbmFtZSAoZS5nLiwgJ3RlYW0nLCAndXNlcicpXG4gKiBAcGFyYW0gb3B0aW9ucyAtIERldGVjdGlvbiBvcHRpb25zXG4gKiBAcmV0dXJucyBCZXN0IGxhYmVsIGZpZWxkIG5hbWUgb3IgdW5kZWZpbmVkICh3aWxsIGZhbGwgYmFjayB0byBJRCBmaWVsZClcbiAqL1xuZnVuY3Rpb24gZmluZExhYmVsRmllbGQoXG4gICAgc2NoZW1hOiBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT4sXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIG9wdGlvbnM/OiB7XG4gICAgICAgIC8qKiBNaW5pbXVtIGNvbmZpZGVuY2UgbGV2ZWwgcmVxdWlyZWQgKGRlZmF1bHQ6ICdtZWRpdW0nKSAqL1xuICAgICAgICBtaW5Db25maWRlbmNlPzogJ2hpZ2gnIHwgJ21lZGl1bSc7XG4gICAgICAgIC8qKiBFbmFibGUgZGVidWcgbG9nZ2luZyAoZGVmYXVsdDogZmFsc2UpICovXG4gICAgICAgIGRlYnVnPzogYm9vbGVhbjtcbiAgICB9XG4pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IG1pbkNvbmZpZGVuY2UgPSBvcHRpb25zPy5taW5Db25maWRlbmNlIHx8ICdtZWRpdW0nO1xuICAgIGNvbnN0IGRlYnVnID0gb3B0aW9ucz8uZGVidWcgfHwgZmFsc2U7XG5cbiAgICBsZXQgcmVzdWx0OiBMYWJlbEZpZWxkRGV0ZWN0aW9uUmVzdWx0IHwgdW5kZWZpbmVkO1xuXG4gICAgLy8gR2V0IGFsbCBhdHRyaWJ1dGVzIGZyb20gc2NoZW1hXG4gICAgY29uc3QgYXR0cmlidXRlcyA9IHNjaGVtYS5hdHRyaWJ1dGVzO1xuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWVzID0gT2JqZWN0LmtleXMoYXR0cmlidXRlcyk7XG5cbiAgICAvLyBQcmlvcml0eSAxOiBFbnRpdHkgbWV0YWRhdGEgLSBISUdIIGNvbmZpZGVuY2VcbiAgICBjb25zdCBlbnRpdHlOYW1lQXR0cmlidXRlID0gc2NoZW1hLm1vZGVsLmVudGl0eU5hbWVBdHRyaWJ1dGU7XG4gICAgaWYgKGVudGl0eU5hbWVBdHRyaWJ1dGUgJiYgYXR0cmlidXRlc1sgZW50aXR5TmFtZUF0dHJpYnV0ZSBdKSB7XG4gICAgICAgIHJlc3VsdCA9IHtcbiAgICAgICAgICAgIGZpZWxkOiBlbnRpdHlOYW1lQXR0cmlidXRlLFxuICAgICAgICAgICAgY29uZmlkZW5jZTogJ2hpZ2gnLFxuICAgICAgICAgICAgbWV0aG9kOiAnbWV0YWRhdGEnXG4gICAgICAgIH07XG4gICAgICAgIGlmIChkZWJ1Zykge1xuICAgICAgICAgICAgRGVmYXVsdExvZ2dlci5pbmZvKGBbZmluZExhYmVsRmllbGRdICR7ZW50aXR5TmFtZX06IEZvdW5kIHZpYSBtZXRhZGF0YSAtICR7ZW50aXR5TmFtZUF0dHJpYnV0ZX0gKEhJR0ggY29uZmlkZW5jZSlgKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFByaW9yaXR5IDI6IENvbW1vbiBkaXNwbGF5IHBhdHRlcm5zIC0gSElHSCBjb25maWRlbmNlXG4gICAgaWYgKCFyZXN1bHQpIHtcbiAgICAgICAgY29uc3QgY29tbW9uUGF0dGVybnMgPSBbICduYW1lJywgJ3RpdGxlJywgJ2xhYmVsJywgJ2Rpc3BsYXlOYW1lJywgJ2Rpc3BsYXluYW1lJyBdO1xuICAgICAgICBmb3IgKGNvbnN0IHBhdHRlcm4gb2YgY29tbW9uUGF0dGVybnMpIHtcbiAgICAgICAgICAgIGNvbnN0IG1hdGNoID0gYXR0cmlidXRlTmFtZXMuZmluZChhdHRyID0+IGF0dHIudG9Mb3dlckNhc2UoKSA9PT0gcGF0dGVybik7XG4gICAgICAgICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgICAgICAgICByZXN1bHQgPSB7XG4gICAgICAgICAgICAgICAgICAgIGZpZWxkOiBtYXRjaCxcbiAgICAgICAgICAgICAgICAgICAgY29uZmlkZW5jZTogJ2hpZ2gnLFxuICAgICAgICAgICAgICAgICAgICBtZXRob2Q6ICdjb21tb24tcGF0dGVybidcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIGlmIChkZWJ1Zykge1xuICAgICAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtmaW5kTGFiZWxGaWVsZF0gJHtlbnRpdHlOYW1lfTogRm91bmQgdmlhIGNvbW1vbiBwYXR0ZXJuICcke3BhdHRlcm59JyAtICR7bWF0Y2h9IChISUdIIGNvbmZpZGVuY2UpYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gUHJpb3JpdHkgMzogRW50aXR5LXNwZWNpZmljIHBhdHRlcm5zIC0gSElHSCBjb25maWRlbmNlXG4gICAgaWYgKCFyZXN1bHQpIHtcbiAgICAgICAgY29uc3QgZW50aXR5TG93ZXIgPSBlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIGNvbnN0IGVudGl0eVNwZWNpZmljU3VmZml4ZXMgPSBbICdOYW1lJywgJ1RpdGxlJywgJ0xhYmVsJyBdO1xuXG4gICAgICAgIGZvciAoY29uc3Qgc3VmZml4IG9mIGVudGl0eVNwZWNpZmljU3VmZml4ZXMpIHtcbiAgICAgICAgICAgIC8vIFRyeSBleGFjdCBtYXRjaDogZS5nLiwgJ3RlYW1OYW1lJyBmb3IgZW50aXR5ICd0ZWFtJ1xuICAgICAgICAgICAgY29uc3QgZXhhY3RNYXRjaCA9IGF0dHJpYnV0ZU5hbWVzLmZpbmQoYXR0ciA9PlxuICAgICAgICAgICAgICAgIGF0dHIudG9Mb3dlckNhc2UoKSA9PT0gYCR7ZW50aXR5TG93ZXJ9JHtzdWZmaXgudG9Mb3dlckNhc2UoKX1gXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgaWYgKGV4YWN0TWF0Y2gpIHtcbiAgICAgICAgICAgICAgICByZXN1bHQgPSB7XG4gICAgICAgICAgICAgICAgICAgIGZpZWxkOiBleGFjdE1hdGNoLFxuICAgICAgICAgICAgICAgICAgICBjb25maWRlbmNlOiAnaGlnaCcsXG4gICAgICAgICAgICAgICAgICAgIG1ldGhvZDogJ2VudGl0eS1wYXR0ZXJuJ1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgaWYgKGRlYnVnKSB7XG4gICAgICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW2ZpbmRMYWJlbEZpZWxkXSAke2VudGl0eU5hbWV9OiBGb3VuZCB2aWEgZW50aXR5LXNwZWNpZmljIHBhdHRlcm4gLSAke2V4YWN0TWF0Y2h9IChISUdIIGNvbmZpZGVuY2UpYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gUHJpb3JpdHkgNDogRmllbGRzIGVuZGluZyB3aXRoIG5hbWUtbGlrZSBzdWZmaXhlcyAtIE1FRElVTSBjb25maWRlbmNlXG4gICAgLy8gTG9vayBmb3IgYW55IGZpZWxkIGVuZGluZyB3aXRoICdOYW1lJywgJ1RpdGxlJywgJ0xhYmVsJyAoZS5nLiwgJ2Rpc3BsYXlOYW1lJywgJ2Z1bGxOYW1lJywgJ3VzZXJOYW1lJywpXG4gICAgaWYgKCFyZXN1bHQpIHtcbiAgICAgICAgY29uc3QgZGlzcGxheU5hbWVTdWZmaXhQYXR0ZXJuID0gL0Rpc3BsYXlOYW1lJC87XG4gICAgICAgIGNvbnN0IG5hbWVTdWZmaXhQYXR0ZXJuID0gL05hbWUkLztcbiAgICAgICAgY29uc3QgdGl0bGVTdWZmaXhQYXR0ZXJuID0gL1RpdGxlJC87XG4gICAgICAgIGNvbnN0IGxhYmVsU3VmZml4UGF0dGVybiA9IC9MYWJlbCQvO1xuICAgICAgICBjb25zdCBjb2RlU3VmZml4UGF0dGVybiA9IC9Db2RlJC87XG5cbiAgICAgICAgZm9yIChjb25zdCBwYXR0ZXJuIG9mIFsgZGlzcGxheU5hbWVTdWZmaXhQYXR0ZXJuLCBsYWJlbFN1ZmZpeFBhdHRlcm4sIHRpdGxlU3VmZml4UGF0dGVybiwgbmFtZVN1ZmZpeFBhdHRlcm4sIGNvZGVTdWZmaXhQYXR0ZXJuIF0pIHtcbiAgICAgICAgICAgIGNvbnN0IG1hdGNoID0gYXR0cmlidXRlTmFtZXMuZmluZChhdHRyID0+IHBhdHRlcm4udGVzdChhdHRyKSk7XG4gICAgICAgICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgICAgICAgICByZXN1bHQgPSB7XG4gICAgICAgICAgICAgICAgICAgIGZpZWxkOiBtYXRjaCxcbiAgICAgICAgICAgICAgICAgICAgY29uZmlkZW5jZTogJ21lZGl1bScsXG4gICAgICAgICAgICAgICAgICAgIG1ldGhvZDogJ3N1ZmZpeC1wYXR0ZXJuJ1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgaWYgKGRlYnVnKSB7XG4gICAgICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW2ZpbmRMYWJlbEZpZWxkXSAke2VudGl0eU5hbWV9OiBGb3VuZCB2aWEgc3VmZml4IHBhdHRlcm4gLSAke21hdGNofSAoTUVESVVNIGNvbmZpZGVuY2UpYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gUHJpb3JpdHkgNTogTk8gRkFMTEJBQ0sgLSBJZiB3ZSBjYW4ndCBmaW5kIGEgcHJvcGVyIG5hbWUgZmllbGQsIHJldHVybiB1bmRlZmluZWRcbiAgICAvLyBCZXR0ZXIgdG8gc2hvdyBJRCB0aGFuIHRvIHNob3cgY29uZnVzaW5nIGZpZWxkcyBsaWtlICdzdGF0dXMnLCAndHlwZScsIGV0Yy5cbiAgICAvLyBcbiAgICAvLyBFbnRpdGllcyBsaWtlIFN1YnNjcmlwdGlvbiwgUGF5bWVudE1ldGhvZCBkb24ndCBoYXZlIHRyYWRpdGlvbmFsIG5hbWUgZmllbGRzLlxuICAgIC8vIFNob3dpbmcgXCJhY3RpdmVcIiBvciBcImNyZWRpdF9jYXJkXCIgaW4gYSBkcm9wZG93biBpcyBjb25mdXNpbmcgLSB1c2VycyBjYW4ndCBkaXN0aW5ndWlzaCBpdGVtcy5cbiAgICAvLyBJdCdzIGNsZWFyZXIgdG8gc2hvdyB0aGUgSUQgKHN1YnNjcmlwdGlvbklkLCBwYXltZW50TWV0aG9kSWQpIGluIHN1Y2ggY2FzZXMuXG4gICAgLy9cbiAgICAvLyBJZiB5b3UgbmVlZCBjdXN0b20gbGFiZWxzIGZvciB0aGVzZSBlbnRpdGllcywgZXhwbGljaXRseSBzZXQgZW50aXR5TmFtZUF0dHJpYnV0ZSBpbiB0aGUgc2NoZW1hXG4gICAgLy8gb3IgdXNlIG9wdGlvbk1hcHBpbmcgaW4gdGhlIHJlbGF0aW9uIGNvbmZpZy5cblxuICAgIC8vIENoZWNrIGNvbmZpZGVuY2UgdGhyZXNob2xkXG4gICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAvLyBPbmx5IHJldHVybiBpZiBjb25maWRlbmNlIG1lZXRzIG1pbmltdW0gcmVxdWlyZW1lbnRcbiAgICAgICAgLy8gbWluQ29uZmlkZW5jZTogJ2hpZ2gnIOKGkiBvbmx5IHJldHVybiBISUdIIGNvbmZpZGVuY2UgcmVzdWx0c1xuICAgICAgICAvLyBtaW5Db25maWRlbmNlOiAnbWVkaXVtJyDihpIgcmV0dXJuIEhJR0ggb3IgTUVESVVNIGNvbmZpZGVuY2UgcmVzdWx0cyAoZGVmYXVsdClcbiAgICAgICAgaWYgKG1pbkNvbmZpZGVuY2UgPT09ICdoaWdoJyAmJiByZXN1bHQuY29uZmlkZW5jZSA9PT0gJ21lZGl1bScpIHtcbiAgICAgICAgICAgIGlmIChkZWJ1Zykge1xuICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgW2ZpbmRMYWJlbEZpZWxkXSAke2VudGl0eU5hbWV9OiBGaWVsZCAnJHtyZXN1bHQuZmllbGR9JyBmb3VuZCB3aXRoIE1FRElVTSBjb25maWRlbmNlLCBidXQgSElHSCBjb25maWRlbmNlIHJlcXVpcmVkLiBSZXR1cm5pbmcgdW5kZWZpbmVkLmApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiByZXN1bHQuZmllbGQ7XG4gICAgfVxuXG4gICAgLy8gTm8gc3VpdGFibGUgZmllbGQgZm91bmRcbiAgICBpZiAoZGVidWcpIHtcbiAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBbZmluZExhYmVsRmllbGRdICR7ZW50aXR5TmFtZX06IE5vIHN1aXRhYmxlIGxhYmVsIGZpZWxkIGZvdW5kIHdpdGggc3VmZmljaWVudCBjb25maWRlbmNlLmApO1xuICAgIH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFJFTEFUSU9OIE9QVElPTiBDT05GSUcgUkVTT0xVVElPTlxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogUmVzb2x2ZXMgUmVsYXRpb25FbnRpdHlPcHRpb25Db25maWcgaW50byBGaWVsZE9wdGlvbnNBUElDb25maWcgYnkgYXV0by1kZXRlY3Rpbmc6XG4gKiAtIENSVUQgQVBJIHBhdGggZnJvbSBlbnRpdHkgc2NoZW1hXG4gKiAtIExhYmVsIGZpZWxkIGZyb20gZW50aXR5TmFtZUF0dHJpYnV0ZSBtZXRhZGF0YSBvciBzbWFydCBkZXRlY3Rpb25cbiAqIC0gVmFsdWUgZmllbGQgZnJvbSByZWxhdGlvbiBpZGVudGlmaWVyc1xuICogXG4gKiBAcGFyYW0gcmVsYXRpb25Db25maWcgLSBNaW5pbWFsIHJlbGF0aW9uIG9wdGlvbiBjb25maWdcbiAqIEBwYXJhbSByZWxhdGlvbkF0dHJpYnV0ZSAtIFRoZSByZWxhdGlvbiBhdHRyaWJ1dGUgKHRvIGdldCBpZGVudGlmaWVycylcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gRW50aXR5IHNlcnZpY2UgZm9yIHNjaGVtYSBsb29rdXBcbiAqIEBwYXJhbSBnbG9iYWxVSUNvbmZpZ09wdGlvbnMgLSBHbG9iYWwgVUkgY29uZmlnIG9wdGlvbnMgKGZvciBsYWJlbCBmaWVsZCBkZXRlY3Rpb24pXG4gKiBAcmV0dXJucyBGdWxseSByZXNvbHZlZCBGaWVsZE9wdGlvbnNBUElDb25maWcgb3IgdW5kZWZpbmVkIGlmIGVudGl0eSBub3QgZm91bmRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVSZWxhdGlvbk9wdGlvbkNvbmZpZyhcbiAgICByZWxhdGlvbkNvbmZpZzogUmVsYXRpb25FbnRpdHlPcHRpb25Db25maWcsXG4gICAgcmVsYXRpb25BdHRyaWJ1dGU6IFRJT1NjaGVtYUF0dHJpYnV0ZSAmIHsgcmVsYXRpb246IE5vbk51bGxhYmxlPFRJT1NjaGVtYUF0dHJpYnV0ZVsgJ3JlbGF0aW9uJyBdPiB9LFxuICAgIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sXG4gICAgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyAndWlDb25maWdHZW5PcHRpb25zJyBdXG4pOiBGaWVsZE9wdGlvbnNBUElDb25maWc8YW55PiB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lLCBjdXN0b21BcGlVcmwsIG9wdGlvbk1hcHBpbmcsIC4uLnJlc3QgfSA9IHJlbGF0aW9uQ29uZmlnO1xuICAgIGNvbnN0IHJlbGF0aW9uID0gcmVsYXRpb25BdHRyaWJ1dGUucmVsYXRpb247XG5cbiAgICAvLyBHZXQgcmVsYXRlZCBlbnRpdHkgc2VydmljZVxuICAgIGlmICghZW50aXR5U2VydmljZS5oYXNFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKGVudGl0eU5hbWUpKSB7XG4gICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgW3Jlc29sdmVSZWxhdGlvbk9wdGlvbkNvbmZpZ10gRW50aXR5IHNlcnZpY2Ugbm90IGZvdW5kIGZvcjogJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIGNvbnN0IHJlbGF0ZWRTZXJ2aWNlID0gZW50aXR5U2VydmljZS5nZXRFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKGVudGl0eU5hbWUpO1xuICAgIGNvbnN0IHJlbGF0ZWRTY2hlbWEgPSByZWxhdGVkU2VydmljZT8uZ2V0RW50aXR5U2NoZW1hPy4oKTtcblxuICAgIGlmICghcmVsYXRlZFNjaGVtYSkge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYFtyZXNvbHZlUmVsYXRpb25PcHRpb25Db25maWddIFNjaGVtYSBub3QgZm91bmQgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8vIDEuIFJlc29sdmUgQVBJIFVSTFxuICAgIGNvbnN0IGVudGl0eU5hbWVMb3dlciA9IGVudGl0eU5hbWUudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBjcnVkUGF0aCA9IHJlbGF0ZWRTY2hlbWEubW9kZWwuQ1JVREFwaVBhdGggfHwgJyc7XG4gICAgY29uc3QgYXBpVXJsID0gY3VzdG9tQXBpVXJsIHx8IGAke2NydWRQYXRofS8ke2VudGl0eU5hbWVMb3dlcn1gO1xuXG4gICAgLy8gMi4gUmVzb2x2ZSB2YWx1ZSBmaWVsZCBmcm9tIHJlbGF0aW9uIGlkZW50aWZpZXJzXG4gICAgY29uc3QgcmVzb2x2ZWRJZGVudGlmaWVycyA9IHR5cGVvZiByZWxhdGlvbi5pZGVudGlmaWVycyA9PT0gJ2Z1bmN0aW9uJyA/IHJlbGF0aW9uLmlkZW50aWZpZXJzKCkgOiByZWxhdGlvbi5pZGVudGlmaWVycztcbiAgICBjb25zdCBpZGVudGlmaWVyTWFwcGluZ3MgPSBBcnJheS5pc0FycmF5KHJlc29sdmVkSWRlbnRpZmllcnMpID8gcmVzb2x2ZWRJZGVudGlmaWVycyA6IFsgcmVzb2x2ZWRJZGVudGlmaWVycyBdO1xuICAgIGNvbnN0IHByaW1hcnlJZGVudGlmaWVyID0gaWRlbnRpZmllck1hcHBpbmdzWyAwIF07XG4gICAgY29uc3QgdmFsdWVGaWVsZCA9IFN0cmluZyhwcmltYXJ5SWRlbnRpZmllci50YXJnZXQpO1xuXG4gICAgLy8gMy4gUmVzb2x2ZSBsYWJlbCBmaWVsZCBmcm9tIGVudGl0eSBtZXRhZGF0YSBvciBjdXN0b20gbWFwcGluZ1xuICAgIGxldCBsYWJlbEZpZWxkID0gdmFsdWVGaWVsZDsgLy8gRGVmYXVsdCBmYWxsYmFjayB0byB2YWx1ZSBmaWVsZFxuXG4gICAgaWYgKG9wdGlvbk1hcHBpbmc/LmxhYmVsKSB7XG4gICAgICAgIC8vIEN1c3RvbSBsYWJlbCBwcm92aWRlZCAtIHVzZSBpdFxuICAgICAgICBsYWJlbEZpZWxkID0gb3B0aW9uTWFwcGluZy5sYWJlbCBhcyBzdHJpbmc7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQXV0by1kZXRlY3QgdXNpbmcgc21hcnQgcGF0dGVybiBtYXRjaGluZyB3aXRoIGdsb2JhbCBjb25maWdcbiAgICAgICAgY29uc3QgbGFiZWxGaWVsZENvbmZpZyA9IGdsb2JhbFVJQ29uZmlnT3B0aW9ucz8ubGFiZWxGaWVsZERldGVjdGlvbjtcbiAgICAgICAgbGFiZWxGaWVsZCA9IGZpbmRMYWJlbEZpZWxkKHJlbGF0ZWRTY2hlbWEsIGVudGl0eU5hbWUsIHtcbiAgICAgICAgICAgIG1pbkNvbmZpZGVuY2U6IGxhYmVsRmllbGRDb25maWc/Lm1pbkNvbmZpZGVuY2UgfHwgJ21lZGl1bScsXG4gICAgICAgICAgICBkZWJ1ZzogbGFiZWxGaWVsZENvbmZpZz8uZGVidWcgfHwgZmFsc2VcbiAgICAgICAgfSkgfHwgdmFsdWVGaWVsZDtcbiAgICB9XG5cbiAgICAvLyA0LiBCdWlsZCBjb21wbGV0ZSBGaWVsZE9wdGlvbnNBUElDb25maWdcbiAgICByZXR1cm4ge1xuICAgICAgICBhcGlNZXRob2Q6ICdHRVQnLFxuICAgICAgICBhcGlVcmwsXG4gICAgICAgIHJlc3BvbnNlS2V5OiAnaXRlbXMnLFxuICAgICAgICBvcHRpb25NYXBwaW5nOiBvcHRpb25NYXBwaW5nIHx8IHtcbiAgICAgICAgICAgIGxhYmVsOiBsYWJlbEZpZWxkLFxuICAgICAgICAgICAgdmFsdWU6IChvcHRpb25NYXBwaW5nIGFzIGFueSk/LnZhbHVlIHx8IHZhbHVlRmllbGRcbiAgICAgICAgfSxcbiAgICAgICAgLi4ucmVzdCAvLyBQYXNzIHRocm91Z2ggZmlsdGVycywgY291bnQsIGRpc2FibGVTZWFyY2gsIGV0Yy5cbiAgICB9O1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEZJTFRFUiBBVVRPLUdFTkVSQVRJT05cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIEF1dG8tZ2VuZXJhdGVzIGZpbHRlckNvbmZpZyBmb3IgZW50aXR5IGF0dHJpYnV0ZXMgYmFzZWQgb24gZmllbGQgdHlwZS5cbiAqIFxuICogQWxnb3JpdGhtOlxuICogMS4gQ2hlY2sgaWYgZXhwbGljaXQgZmlsdGVyQ29uZmlnIGFscmVhZHkgZXhpc3RzIOKGkiB1c2UgaXRcbiAqIDIuIENoZWNrIGlmIGZpZWxkIGlzIGV4cGxpY2l0bHkgbm9uLWZpbHRlcmFibGUg4oaSIHNraXBcbiAqIDMuIERldGVjdCBmaWVsZCB0eXBlIGFuZCBnZW5lcmF0ZSBhcHByb3ByaWF0ZSBjb25maWdcbiAqIDQuIE1lcmdlIHdpdGggZ2xvYmFsIGFuZCBlbnRpdHktbGV2ZWwgb3ZlcnJpZGVzXG4gKiBcbiAqIEBwYXJhbSBhdHRyaWJ1dGUgLSBUaGUgYXR0cmlidXRlIHRvIGdlbmVyYXRlIGZpbHRlciBjb25maWcgZm9yXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIGZvciBhY2Nlc3NpbmcgZW50aXR5IG1ldGFkYXRhXG4gKiBAcGFyYW0gZ2xvYmFsVUlDb25maWdPcHRpb25zIC0gR2xvYmFsIFVJIGNvbmZpZ3VyYXRpb24gb3B0aW9uc1xuICogQHJldHVybnMgR2VuZXJhdGVkIGZpbHRlciBjb25maWd1cmF0aW9uIG9yIHVuZGVmaW5lZFxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVGaWx0ZXJDb25maWcoXG4gICAgYXR0cmlidXRlOiBUSU9TY2hlbWFBdHRyaWJ1dGUsXG4gICAgZW50aXR5U2VydmljZT86IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sXG4gICAgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyAndWlDb25maWdHZW5PcHRpb25zJyBdXG4pOiBGaWVsZE1ldGFkYXRhWyAnZmlsdGVyQ29uZmlnJyBdIHwgdW5kZWZpbmVkIHtcbiAgICAvLyAxLiBJZiBleHBsaWNpdCBmaWx0ZXJDb25maWcgZXhpc3RzLCB1c2UgaXQgKGhpZ2hlc3QgcHJpb3JpdHkpXG4gICAgaWYgKGF0dHJpYnV0ZS5maWx0ZXJDb25maWcpIHtcbiAgICAgICAgcmV0dXJuIGF0dHJpYnV0ZS5maWx0ZXJDb25maWc7XG4gICAgfVxuXG4gICAgLy8gMi4gSWYgZmllbGQgaGFzIGV4cGxpY2l0IG9wdGlvbnMgY29uZmlnLCB1c2UgaXRcbiAgICBpZiAoJ29wdGlvbnMnIGluIGF0dHJpYnV0ZSkge1xuICAgICAgICBjb25zdCBvcHRpb25zID0gKGF0dHJpYnV0ZSBhcyBTZWxlY3RGaWVsZE1ldGFkYXRhKS5vcHRpb25zO1xuXG4gICAgICAgIC8vIFJlbGF0aW9uRW50aXR5T3B0aW9uQ29uZmlnIChoYXMgZW50aXR5TmFtZSkg4oaSIHJlc29sdmUgdG8gRmllbGRPcHRpb25zQVBJQ29uZmlnXG4gICAgICAgIGNvbnN0IGlzUmVsYXRpb25Db25maWcgPSB0eXBlb2Ygb3B0aW9ucyA9PT0gJ29iamVjdCcgJiYgIUFycmF5LmlzQXJyYXkob3B0aW9ucykgJiYgJ2VudGl0eU5hbWUnIGluIG9wdGlvbnM7XG5cbiAgICAgICAgbGV0IHJlc29sdmVkQ29uZmlnOiBGaWVsZE9wdGlvbnNBUElDb25maWc8YW55PiB8IEZpZWxkT3B0aW9uW10gfCB1bmRlZmluZWQ7XG5cbiAgICAgICAgLy8gSW5saW5lIGFycmF5IOKGkiB1c2UgYXMgaXNcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkob3B0aW9ucykgJiYgb3B0aW9ucy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICByZXNvbHZlZENvbmZpZyA9IG9wdGlvbnMgYXMgRmllbGRPcHRpb25bXTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEZpZWxkT3B0aW9uc0FQSUNvbmZpZyAoaGFzIGFwaU1ldGhvZCwgYXBpVXJsLCByZXNwb25zZUtleSkg4oaSIHBhc3MgdGhyb3VnaFxuICAgICAgICBjb25zdCBpc0FwaUNvbmZpZyA9IHR5cGVvZiBvcHRpb25zID09PSAnb2JqZWN0JyAmJiAhQXJyYXkuaXNBcnJheShvcHRpb25zKSAmJiAnYXBpTWV0aG9kJyBpbiBvcHRpb25zO1xuICAgICAgICBpZiAoaXNBcGlDb25maWcpIHtcbiAgICAgICAgICAgIHJlc29sdmVkQ29uZmlnID0gb3B0aW9ucyBhcyBGaWVsZE9wdGlvbnNBUElDb25maWc8YW55PjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChpc1JlbGF0aW9uQ29uZmlnICYmIGF0dHJpYnV0ZS5yZWxhdGlvbiAmJiBlbnRpdHlTZXJ2aWNlKSB7XG4gICAgICAgICAgICByZXNvbHZlZENvbmZpZyA9IHJlc29sdmVSZWxhdGlvbk9wdGlvbkNvbmZpZyhcbiAgICAgICAgICAgICAgICBvcHRpb25zIGFzIFJlbGF0aW9uRW50aXR5T3B0aW9uQ29uZmlnLFxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZSBhcyBUSU9TY2hlbWFBdHRyaWJ1dGUgJiB7IHJlbGF0aW9uOiBOb25OdWxsYWJsZTxUSU9TY2hlbWFBdHRyaWJ1dGVbICdyZWxhdGlvbicgXT4gfSxcbiAgICAgICAgICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuICAgICAgICAgICAgICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9uc1xuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChyZXNvbHZlZENvbmZpZykge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBmaWx0ZXJUeXBlOiAnc2VsZWN0JyxcbiAgICAgICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6ICdlcScgYXMgY29uc3QsXG4gICAgICAgICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBbICdlcScsICduZXEnLCAnaW5MaXN0JywgJ25vdEluTGlzdCcsICdleGlzdHMnLCAnbm90RXhpc3RzJyBdLFxuICAgICAgICAgICAgICAgIHByZWRlZmluZWRPcHRpb25zOiByZXNvbHZlZENvbmZpZ1xuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGVsc2UgbG9nIGVycm9yXG4gICAgICAgIHRocm93IG5ldyBGcmFtZXdvcmtFcnJvcihgW2dlbmVyYXRlRmlsdGVyQ29uZmlnXSBObyByZXNvbHZlZCBjb25maWcgZm91bmQgZm9yIGF0dHJpYnV0ZTogJHthdHRyaWJ1dGUuaWR9YCwge1xuICAgICAgICAgICAgYXR0cmlidXRlOiBhdHRyaWJ1dGUsXG4gICAgICAgICAgICBvcHRpb25zOiBvcHRpb25zLFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyAzLiBJZiBmaWVsZCBpcyBleHBsaWNpdGx5IG5vbi1maWx0ZXJhYmxlLCBza2lwXG4gICAgaWYgKGF0dHJpYnV0ZS5pc0ZpbHRlcmFibGUgPT09IGZhbHNlKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgLy8gMy4gR2V0IGdsb2JhbCBhbmQgZW50aXR5LWxldmVsIGNvbmZpZ1xuICAgIGNvbnN0IGdsb2JhbEZpbHRlckNvbmZpZyA9IGdsb2JhbFVJQ29uZmlnT3B0aW9ucz8udGFibGVVST8uZmlsdGVyQXV0b0dlbmVyYXRpb247XG4gICAgY29uc3QgZW50aXR5TWV0YWRhdGEgPSBlbnRpdHlTZXJ2aWNlPy5nZXRFbnRpdHlTY2hlbWE/LigpLm1vZGVsPy5tZXRhZGF0YSBhcyBFbnRpdHlTY2hlbWE8YW55LCBhbnksIGFueT5bICdtb2RlbCcgXVsgJ21ldGFkYXRhJyBdO1xuICAgIGNvbnN0IGVudGl0eUZpbHRlckNvbmZpZyA9IGVudGl0eU1ldGFkYXRhPy50YWJsZVVJPy5maWx0ZXJBdXRvR2VuZXJhdGlvbjtcblxuICAgIC8vIE1lcmdlIGNvbmZpZ3MgKGVudGl0eSA+IGdsb2JhbCA+IGRlZmF1bHRzKVxuICAgIGNvbnN0IG1lcmdlZENvbmZpZyA9IHtcbiAgICAgICAgZW5hYmxlZDogZW50aXR5RmlsdGVyQ29uZmlnPy5lbmFibGVkID8/IGdsb2JhbEZpbHRlckNvbmZpZz8uZW5hYmxlZCA/PyB0cnVlLFxuICAgICAgICBkYXRlRmllbGRzOiB7XG4gICAgICAgICAgICAuLi5nbG9iYWxGaWx0ZXJDb25maWc/LmRhdGVGaWVsZHMsXG4gICAgICAgICAgICAuLi5lbnRpdHlGaWx0ZXJDb25maWc/LmRhdGVGaWVsZHNcbiAgICAgICAgfSxcbiAgICAgICAgZW51bUZpZWxkczoge1xuICAgICAgICAgICAgLi4uZ2xvYmFsRmlsdGVyQ29uZmlnPy5lbnVtRmllbGRzLFxuICAgICAgICAgICAgLi4uZW50aXR5RmlsdGVyQ29uZmlnPy5lbnVtRmllbGRzXG4gICAgICAgIH0sXG4gICAgICAgIGJvb2xlYW5GaWVsZHM6IHtcbiAgICAgICAgICAgIC4uLmdsb2JhbEZpbHRlckNvbmZpZz8uYm9vbGVhbkZpZWxkcyxcbiAgICAgICAgICAgIC4uLmVudGl0eUZpbHRlckNvbmZpZz8uYm9vbGVhbkZpZWxkc1xuICAgICAgICB9LFxuICAgICAgICByZWxhdGlvbkZpZWxkczoge1xuICAgICAgICAgICAgLi4uZ2xvYmFsRmlsdGVyQ29uZmlnPy5yZWxhdGlvbkZpZWxkcyxcbiAgICAgICAgICAgIC4uLmVudGl0eUZpbHRlckNvbmZpZz8ucmVsYXRpb25GaWVsZHNcbiAgICAgICAgfSxcbiAgICAgICAgbnVtYmVyRmllbGRzOiB7XG4gICAgICAgICAgICAuLi5nbG9iYWxGaWx0ZXJDb25maWc/Lm51bWJlckZpZWxkcyxcbiAgICAgICAgICAgIC4uLmVudGl0eUZpbHRlckNvbmZpZz8ubnVtYmVyRmllbGRzXG4gICAgICAgIH0sXG4gICAgICAgIHRleHRGaWVsZHM6IHtcbiAgICAgICAgICAgIC4uLmdsb2JhbEZpbHRlckNvbmZpZz8udGV4dEZpZWxkcyxcbiAgICAgICAgICAgIC4uLmVudGl0eUZpbHRlckNvbmZpZz8udGV4dEZpZWxkc1xuICAgICAgICB9LFxuICAgICAgICBkZWJ1ZzogZW50aXR5RmlsdGVyQ29uZmlnPy5kZWJ1ZyA/PyBnbG9iYWxGaWx0ZXJDb25maWc/LmRlYnVnID8/IGZhbHNlXG4gICAgfTtcblxuICAgIC8vIElmIGdsb2JhbGx5IGRpc2FibGVkLCBza2lwXG4gICAgaWYgKCFtZXJnZWRDb25maWcuZW5hYmxlZCkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIGNvbnN0IGF0dHJUeXBlID0gYXR0cmlidXRlLnR5cGU7XG4gICAgY29uc3QgZmllbGRUeXBlID0gYXR0cmlidXRlLmZpZWxkVHlwZTtcblxuICAgIC8vICoqMS4gQm9vbGVhbiBmaWVsZHMqKlxuICAgIGlmIChhdHRyVHlwZSA9PT0gJ2Jvb2xlYW4nICYmIG1lcmdlZENvbmZpZy5ib29sZWFuRmllbGRzPy5lbmFibGVkICE9PSBmYWxzZSkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZmlsdGVyVHlwZTogJ2Jvb2xlYW4nLFxuICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiAnZXEnLFxuICAgICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBbICdlcScsICduZXEnLCAnZXhpc3RzJywgJ25vdEV4aXN0cycgXSxcbiAgICAgICAgICAgIHByZWRlZmluZWRPcHRpb25zOiBbXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ1llcycsIHZhbHVlOiBcInRydWVcIiB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdObycsIHZhbHVlOiBcImZhbHNlXCIgfVxuICAgICAgICAgICAgXVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vICoqMi4gRW51bSBmaWVsZHMgKGFycmF5IG9mIHN0cmluZ3MvbnVtYmVycykqKlxuICAgIGlmIChBcnJheS5pc0FycmF5KGF0dHJUeXBlKSAmJiBtZXJnZWRDb25maWcuZW51bUZpZWxkcz8uZW5hYmxlZCAhPT0gZmFsc2UpIHtcbiAgICAgICAgY29uc3QgZGVmYXVsdEVudW1PcHMgPSBbICdlcScsICduZXEnLCAnaW5MaXN0JywgJ25vdEluTGlzdCcsICdleGlzdHMnLCAnbm90RXhpc3RzJyBdIGFzIGNvbnN0O1xuICAgICAgICBjb25zdCBkZWZhdWx0T3AgPSBtZXJnZWRDb25maWcuZW51bUZpZWxkcz8uZGVmYXVsdE9wZXJhdG9yIHx8ICgnZXEnKTtcbiAgICAgICAgY29uc3QgYXZhaWxhYmxlT3BzID0gbWVyZ2VkQ29uZmlnLmVudW1GaWVsZHM/LmF2YWlsYWJsZU9wZXJhdG9ycyB8fCBkZWZhdWx0RW51bU9wcztcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZmlsdGVyVHlwZTogJ3NlbGVjdCcsXG4gICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IGRlZmF1bHRPcCxcbiAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogYXZhaWxhYmxlT3BzLFxuICAgICAgICAgICAgcHJlZGVmaW5lZE9wdGlvbnM6IGF0dHJUeXBlLm1hcCh2YWwgPT4gKHtcbiAgICAgICAgICAgICAgICBsYWJlbDogU3RyaW5nKHZhbCksXG4gICAgICAgICAgICAgICAgdmFsdWU6IFN0cmluZyh2YWwpICAvLyBBbHdheXMgY29udmVydCB0byBzdHJpbmcgZm9yIGNvbnNpc3RlbmN5XG4gICAgICAgICAgICB9KSlcbiAgICAgICAgfTtcbiAgICB9XG5cblxuICAgIC8vICoqMy4gRGF0ZS9EYXRldGltZSBmaWVsZHMqKlxuICAgIGlmICgoZmllbGRUeXBlID09PSAnZGF0ZScgfHwgZmllbGRUeXBlID09PSAnZGF0ZXRpbWUnIHx8IChhdHRyVHlwZSA9PT0gJ3N0cmluZycgJiYgKGF0dHJpYnV0ZS5pZC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKCdkYXRlJykgfHwgYXR0cmlidXRlLmlkLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoJ3RpbWUnKSkpKVxuICAgICAgICAmJiBtZXJnZWRDb25maWcuZGF0ZUZpZWxkcz8uZW5hYmxlZCAhPT0gZmFsc2UpIHtcbiAgICAgICAgY29uc3QgZGVmYXVsdERhdGVPcHMgPSBbICdlcScsICduZXEnLCAnZ3QnLCAnZ3RlJywgJ2x0JywgJ2x0ZScsICdiZXR3ZWVuJywgJ2V4aXN0cycsICdub3RFeGlzdHMnIF0gYXMgY29uc3Q7XG4gICAgICAgIGNvbnN0IG9wZXJhdG9ycyA9IG1lcmdlZENvbmZpZy5kYXRlRmllbGRzPy5kZWZhdWx0T3BlcmF0b3JzIHx8IGRlZmF1bHREYXRlT3BzO1xuXG4gICAgICAgIGNvbnN0IGZpbHRlckNvbmZpZzogYW55ID0ge1xuICAgICAgICAgICAgZmlsdGVyVHlwZTogJ2RhdGV0aW1lJyxcbiAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogb3BlcmF0b3JzWyAwIF0gfHwgKCdndGUnKSxcbiAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogb3BlcmF0b3JzXG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gQWRkIHF1aWNrIGRhdGUgZmlsdGVycyBpZiBlbmFibGVkXG4gICAgICAgIGlmIChtZXJnZWRDb25maWcuZGF0ZUZpZWxkcz8ucXVpY2tGaWx0ZXJzICE9PSBmYWxzZSkge1xuICAgICAgICAgICAgZmlsdGVyQ29uZmlnLnByZWRlZmluZWRPcHRpb25zID0gW1xuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdUb2RheScsIHZhbHVlOiAnOnN0YXJ0T2ZUb2RheScgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnWWVzdGVyZGF5JywgdmFsdWU6ICc6c3RhcnRPZlllc3RlcmRheScgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnVGhpcyBXZWVrJywgdmFsdWU6ICc6c3RhcnRPZldlZWsnIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ0xhc3QgV2VlaycsIHZhbHVlOiAnOnN0YXJ0T2ZMYXN0V2VlaycgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnVGhpcyBNb250aCcsIHZhbHVlOiAnOnN0YXJ0T2ZNb250aCcgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnTGFzdCBNb250aCcsIHZhbHVlOiAnOnN0YXJ0T2ZMYXN0TW9udGgnIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ1RoaXMgUXVhcnRlcicsIHZhbHVlOiAnOnN0YXJ0T2ZRdWFydGVyJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdMYXN0IFF1YXJ0ZXInLCB2YWx1ZTogJzpzdGFydE9mTGFzdFF1YXJ0ZXInIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ1RoaXMgWWVhcicsIHZhbHVlOiAnOnN0YXJ0T2ZZZWFyJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdMYXN0IFllYXInLCB2YWx1ZTogJzpzdGFydE9mTGFzdFllYXInIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ0xhc3QgNyBEYXlzJywgdmFsdWU6ICc6bm93TWludXM3RGF5cycgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnTGFzdCAzMCBEYXlzJywgdmFsdWU6ICc6bm93TWludXMzMERheXMnIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ0xhc3QgOTAgRGF5cycsIHZhbHVlOiAnOm5vd01pbnVzOTBEYXlzJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdDdXN0b20gRGF0ZScsIHZhbHVlOiBudWxsIH0gIC8vIFRyaWdnZXJzIGRhdGV0aW1lLWxvY2FsIGlucHV0XG4gICAgICAgICAgICBdO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGZpbHRlckNvbmZpZztcbiAgICB9XG5cbiAgICAvLyAqKjUuIE51bWJlciBmaWVsZHMqKlxuICAgIGlmIChhdHRyVHlwZSA9PT0gJ251bWJlcicgJiYgbWVyZ2VkQ29uZmlnLm51bWJlckZpZWxkcz8uZW5hYmxlZCAhPT0gZmFsc2UpIHtcbiAgICAgICAgY29uc3QgZGVmYXVsdE51bWJlck9wcyA9IFsgJ2VxJywgJ25lcScsICdndCcsICdndGUnLCAnbHQnLCAnbHRlJywgJ2JldHdlZW4nLCAnZXhpc3RzJywgJ25vdEV4aXN0cycgXSBhcyBjb25zdDtcbiAgICAgICAgY29uc3Qgb3BlcmF0b3JzID0gbWVyZ2VkQ29uZmlnLm51bWJlckZpZWxkcz8uZGVmYXVsdE9wZXJhdG9ycyB8fCBkZWZhdWx0TnVtYmVyT3BzO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZmlsdGVyVHlwZTogJ251bWJlcicsXG4gICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IG9wZXJhdG9yc1sgMCBdIHx8ICgnZXEnKSxcbiAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogb3BlcmF0b3JzXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gKio0LiBSZWxhdGlvbiBmaWVsZHMgKHdpdGhvdXQgZXhwbGljaXQgb3B0aW9ucykgLSBhdXRvLWdlbmVyYXRlIGZyb20gcmVsYXRpb24gbWV0YWRhdGEqKlxuICAgIGlmIChhdHRyaWJ1dGUucmVsYXRpb24gJiYgbWVyZ2VkQ29uZmlnLnJlbGF0aW9uRmllbGRzPy5lbmFibGVkICE9PSBmYWxzZSAmJiBlbnRpdHlTZXJ2aWNlKSB7XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uQ29uZmlnOiBSZWxhdGlvbkVudGl0eU9wdGlvbkNvbmZpZyA9IHsgZW50aXR5TmFtZTogYXR0cmlidXRlLnJlbGF0aW9uLmVudGl0eU5hbWUgfTtcbiAgICAgICAgY29uc3QgcmVzb2x2ZWQgPSByZXNvbHZlUmVsYXRpb25PcHRpb25Db25maWcoXG4gICAgICAgICAgICByZWxhdGlvbkNvbmZpZyxcbiAgICAgICAgICAgIGF0dHJpYnV0ZSBhcyBUSU9TY2hlbWFBdHRyaWJ1dGUgJiB7IHJlbGF0aW9uOiBOb25OdWxsYWJsZTxUSU9TY2hlbWFBdHRyaWJ1dGVbICdyZWxhdGlvbicgXT4gfSxcbiAgICAgICAgICAgIGVudGl0eVNlcnZpY2UsXG4gICAgICAgICAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnNcbiAgICAgICAgKTtcblxuICAgICAgICBpZiAocmVzb2x2ZWQpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgZmlsdGVyVHlwZTogJ3JlbGF0aW9uJyxcbiAgICAgICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6ICdlcScgYXMgY29uc3QsXG4gICAgICAgICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBbICdlcScsICduZXEnLCAnaW5MaXN0JywgJ25vdEluTGlzdCcsICdleGlzdHMnLCAnbm90RXhpc3RzJyBdLFxuICAgICAgICAgICAgICAgIHByZWRlZmluZWRPcHRpb25zOiByZXNvbHZlZFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vICoqNi4gVGV4dCBmaWVsZHMgKGRlZmF1bHQgZmFsbGJhY2spKipcbiAgICBpZiAoYXR0clR5cGUgPT09ICdzdHJpbmcnICYmIG1lcmdlZENvbmZpZy50ZXh0RmllbGRzPy5lbmFibGVkICE9PSBmYWxzZSkge1xuICAgICAgICBjb25zdCBkZWZhdWx0VGV4dE9wcyA9IFsgJ2NvbnRhaW5zJywgJ25vdENvbnRhaW5zJywgJ2VxJywgJ25lcScsICdzdGFydHNXaXRoJywgJ2VuZHNXaXRoJywgJ2xpa2UnLCAnZXhpc3RzJywgJ25vdEV4aXN0cycgXTtcbiAgICAgICAgY29uc3Qgb3BlcmF0b3JzID0gbWVyZ2VkQ29uZmlnLnRleHRGaWVsZHM/LmRlZmF1bHRPcGVyYXRvcnMgfHwgZGVmYXVsdFRleHRPcHM7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBmaWx0ZXJUeXBlOiAndGV4dCcsXG4gICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IG9wZXJhdG9yc1sgMCBdIHx8ICgnY29udGFpbnMnKSxcbiAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogb3BlcmF0b3JzXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gRGVidWcgbG9nZ2luZ1xuICAgIGlmIChtZXJnZWRDb25maWcuZGVidWcpIHtcbiAgICAgICAgRGVmYXVsdExvZ2dlci5pbmZvKGBbRmlsdGVyQXV0b0dlbl0gJHthdHRyaWJ1dGUuaWR9OiBObyBmaWx0ZXIgY29uZmlnIGdlbmVyYXRlZCAodHlwZTogJHthdHRyVHlwZX0pYCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTRUdNRU5UIEFVVE8tR0VORVJBVElPTlxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogU21hcnQgaWNvbiBtYXBwaW5nIGZvciBzZWdtZW50IHZhbHVlcy5cbiAqIFByb3ZpZGVzIHNlbnNpYmxlIGRlZmF1bHRzIGZvciBjb21tb24gc3RhdHVzL3N0YXRlIHBhdHRlcm5zLlxuICogSWNvbnMgbWF0Y2ggdWkyNC9zcmMvY29yZS9jb21tb24vSWNvbnMvSWNvbnMudHN4IG5hbWluZyBjb252ZW50aW9ucy5cbiAqL1xuY29uc3QgREVGQVVMVF9JQ09OX01BUFBJTkc6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgLy8gQWN0aXZlL0luYWN0aXZlIHBhdHRlcm5zXG4gICAgJ2FjdGl2ZSc6ICdDaGVja0NpcmNsZU91dGxpbmVkJyxcbiAgICAnaW5hY3RpdmUnOiAnQ2xvc2VDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2VuYWJsZWQnOiAnQ2hlY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2Rpc2FibGVkJzogJ0Nsb3NlQ2lyY2xlT3V0bGluZWQnLFxuXG4gICAgLy8gU3RhdHVzIHBhdHRlcm5zXG4gICAgJ3BlbmRpbmcnOiAnQ2xvY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2luLXByb2dyZXNzJzogJ1N5bmNPdXRsaW5lZCcsXG4gICAgJ2lucHJvZ3Jlc3MnOiAnU3luY091dGxpbmVkJyxcbiAgICAnY29tcGxldGVkJzogJ0NoZWNrQ2lyY2xlT3V0bGluZWQnLFxuICAgICdkb25lJzogJ0NoZWNrT3V0bGluZWQnLFxuICAgICdmaW5pc2hlZCc6ICdDaGVja0NpcmNsZU91dGxpbmVkJyxcbiAgICAnY2FuY2VsbGVkJzogJ0Nsb3NlQ2lyY2xlT3V0bGluZWQnLFxuICAgICdjYW5jZWxlZCc6ICdDbG9zZUNpcmNsZU91dGxpbmVkJyxcbiAgICAnZmFpbGVkJzogJ0Nsb3NlQ2lyY2xlT3V0bGluZWQnLFxuICAgICdlcnJvcic6ICdFeGNsYW1hdGlvbkNpcmNsZU91dGxpbmVkJyxcbiAgICAncGF1c2VkJzogJ1BhdXNlQ2lyY2xlT3V0bGluZWQnLFxuXG4gICAgLy8gU2NoZWR1bGluZyBwYXR0ZXJuc1xuICAgICdzY2hlZHVsZWQnOiAnQ2FsZW5kYXJPdXRsaW5lZCcsXG4gICAgJ3VwY29taW5nJzogJ0NhbGVuZGFyT3V0bGluZWQnLFxuICAgICdsaXZlJzogJ1BsYXlDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2RyYWZ0JzogJ0ZpbGVPdXRsaW5lZCcsXG4gICAgJ3B1Ymxpc2hlZCc6ICdDaGVja0NpcmNsZU91dGxpbmVkJyxcbiAgICAnYXJjaGl2ZWQnOiAnRm9sZGVyT3V0bGluZWQnLFxuXG4gICAgLy8gUHJpb3JpdHkgcGF0dGVybnNcbiAgICAnbG93JzogJ0Rvd25PdXRsaW5lZCcsXG4gICAgJ21lZGl1bSc6ICdNaW51c091dGxpbmVkJyxcbiAgICAnaGlnaCc6ICdVcE91dGxpbmVkJyxcbiAgICAnY3JpdGljYWwnOiAnV2FybmluZ091dGxpbmVkJyxcbiAgICAndXJnZW50JzogJ0ZpcmVPdXRsaW5lZCcsXG5cbiAgICAvLyBBcHByb3ZhbCBwYXR0ZXJuc1xuICAgICdhcHByb3ZlZCc6ICdDaGVja0NpcmNsZU91dGxpbmVkJyxcbiAgICAncmVqZWN0ZWQnOiAnQ2xvc2VDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ3Jldmlldyc6ICdFeWVPdXRsaW5lZCcsXG5cbiAgICAvLyBCb29sZWFuIFRydWUvRmFsc2VcbiAgICAndHJ1ZSc6ICdDaGVja0NpcmNsZU91dGxpbmVkJyxcbiAgICAnZmFsc2UnOiAnQ2xvc2VDaXJjbGVPdXRsaW5lZCdcbn07XG5cbi8qKlxuICogSW50ZWxsaWdlbnRseSBleHRyYWN0IGJvb2xlYW4gbGFiZWxzIGZyb20gZmllbGQgbmFtZSBwYXR0ZXJucy5cbiAqIFN1cHBvcnRzIGNvbW1vbiBib29sZWFuIHByZWZpeGVzIGxpa2UgaXMvaGFzL2Nhbi9zaG91bGQvd2lsbC9ldGMuXG4gKiBcbiAqIEBleGFtcGxlXG4gKiAtIGlzQWN0aXZlIOKGkiBcIkFjdGl2ZVwiIC8gXCJJbmFjdGl2ZVwiXG4gKiAtIGhhc1Blcm1pc3Npb24g4oaSIFwiSGFzIFBlcm1pc3Npb25cIiAvIFwiTm8gUGVybWlzc2lvblwiXG4gKiAtIGNhbkVkaXQg4oaSIFwiQ2FuIEVkaXRcIiAvIFwiQ2Fubm90IEVkaXRcIlxuICogLSBpc0xpdmUg4oaSIFwiTGl2ZVwiIC8gXCJOb3QgTGl2ZVwiXG4gKiAtIHNob3VsZE5vdGlmeSDihpIgXCJTaG91bGQgTm90aWZ5XCIgLyBcIlNob3VsZCBOb3QgTm90aWZ5XCJcbiAqL1xuZnVuY3Rpb24gZXh0cmFjdEJvb2xlYW5MYWJlbHNGcm9tRmllbGROYW1lKGZpZWxkTmFtZTogc3RyaW5nKTogeyB0cnVlTGFiZWw6IHN0cmluZzsgZmFsc2VMYWJlbDogc3RyaW5nIH0gfCBudWxsIHtcbiAgICAvLyBDb21tb24gYm9vbGVhbiBwcmVmaXhlcyB3aXRoIHRoZWlyIG5lZ2F0aXZlIGZvcm1zXG4gICAgY29uc3QgcGF0dGVybnMgPSBbXG4gICAgICAgIC8vIFBhdHRlcm46IGlzICsgWFhYXG4gICAgICAgIHtcbiAgICAgICAgICAgIHJlZ2V4OiAvXmlzKFtBLVpdW2EtekEtWjAtOV0qKS8sXG4gICAgICAgICAgICBnZXRUcnVlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gdG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKSxcbiAgICAgICAgICAgIGdldEZhbHNlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGJhc2UgPSB0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pO1xuICAgICAgICAgICAgICAgIC8vIFNwZWNpYWwgY2FzZXMgZm9yIGJldHRlciBuZWdhdGlvblxuICAgICAgICAgICAgICAgIGlmIChiYXNlLnRvTG93ZXJDYXNlKCkgPT09ICdhY3RpdmUnKSByZXR1cm4gJ0luYWN0aXZlJztcbiAgICAgICAgICAgICAgICBpZiAoYmFzZS50b0xvd2VyQ2FzZSgpID09PSAnZW5hYmxlZCcpIHJldHVybiAnRGlzYWJsZWQnO1xuICAgICAgICAgICAgICAgIGlmIChiYXNlLnRvTG93ZXJDYXNlKCkgPT09ICd2aXNpYmxlJykgcmV0dXJuICdIaWRkZW4nO1xuICAgICAgICAgICAgICAgIGlmIChiYXNlLnRvTG93ZXJDYXNlKCkgPT09ICdwdWJsaWMnKSByZXR1cm4gJ1ByaXZhdGUnO1xuICAgICAgICAgICAgICAgIGlmIChiYXNlLnRvTG93ZXJDYXNlKCkgPT09ICdhdmFpbGFibGUnKSByZXR1cm4gJ1VuYXZhaWxhYmxlJztcbiAgICAgICAgICAgICAgICByZXR1cm4gYE5vdCAke2Jhc2V9YDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGF0dGVybjogaGFzICsgWFhYXG4gICAgICAgIHtcbiAgICAgICAgICAgIHJlZ2V4OiAvXmhhcyhbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBIYXMgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWAsXG4gICAgICAgICAgICBnZXRGYWxzZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBObyAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSl9YFxuICAgICAgICB9LFxuICAgICAgICAvLyBQYXR0ZXJuOiBjYW4gKyBYWFhcbiAgICAgICAge1xuICAgICAgICAgICAgcmVnZXg6IC9eY2FuKFtBLVpdW2EtekEtWjAtOV0qKS8sXG4gICAgICAgICAgICBnZXRUcnVlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYENhbiAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSl9YCxcbiAgICAgICAgICAgIGdldEZhbHNlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYENhbm5vdCAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSl9YFxuICAgICAgICB9LFxuICAgICAgICAvLyBQYXR0ZXJuOiBzaG91bGQgKyBYWFhcbiAgICAgICAge1xuICAgICAgICAgICAgcmVnZXg6IC9ec2hvdWxkKFtBLVpdW2EtekEtWjAtOV0qKS8sXG4gICAgICAgICAgICBnZXRUcnVlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYFNob3VsZCAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSl9YCxcbiAgICAgICAgICAgIGdldEZhbHNlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYFNob3VsZCBOb3QgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWBcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGF0dGVybjogd2lsbCArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL153aWxsKFtBLVpdW2EtekEtWjAtOV0qKS8sXG4gICAgICAgICAgICBnZXRUcnVlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYFdpbGwgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWAsXG4gICAgICAgICAgICBnZXRGYWxzZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBXaWxsIE5vdCAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSl9YFxuICAgICAgICB9LFxuICAgICAgICAvLyBQYXR0ZXJuOiBhbGxvd3MgKyBYWFhcbiAgICAgICAge1xuICAgICAgICAgICAgcmVnZXg6IC9eYWxsb3dzKFtBLVpdW2EtekEtWjAtOV0qKS8sXG4gICAgICAgICAgICBnZXRUcnVlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYEFsbG93cyAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSl9YCxcbiAgICAgICAgICAgIGdldEZhbHNlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYERvZXMgTm90IEFsbG93ICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBhdHRlcm46IG5lZWRzICsgWFhYXG4gICAgICAgIHtcbiAgICAgICAgICAgIHJlZ2V4OiAvXm5lZWRzKFtBLVpdW2EtekEtWjAtOV0qKS8sXG4gICAgICAgICAgICBnZXRUcnVlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYE5lZWRzICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gLFxuICAgICAgICAgICAgZ2V0RmFsc2VMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgRG9lcyBOb3QgTmVlZCAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSl9YFxuICAgICAgICB9LFxuICAgICAgICAvLyBQYXR0ZXJuOiByZXF1aXJlcyArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL15yZXF1aXJlcyhbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBSZXF1aXJlcyAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSl9YCxcbiAgICAgICAgICAgIGdldEZhbHNlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYERvZXMgTm90IFJlcXVpcmUgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWBcbiAgICAgICAgfVxuICAgIF07XG5cbiAgICBmb3IgKGNvbnN0IHBhdHRlcm4gb2YgcGF0dGVybnMpIHtcbiAgICAgICAgY29uc3QgbWF0Y2ggPSBmaWVsZE5hbWUubWF0Y2gocGF0dGVybi5yZWdleCk7XG4gICAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICB0cnVlTGFiZWw6IHBhdHRlcm4uZ2V0VHJ1ZUxhYmVsKG1hdGNoKSxcbiAgICAgICAgICAgICAgICBmYWxzZUxhYmVsOiBwYXR0ZXJuLmdldEZhbHNlTGFiZWwobWF0Y2gpXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG59XG5cbi8qKlxuICogR2V0IHRoZSBudW1iZXIgb2Ygb3B0aW9ucyBmb3IgYSBmaWVsZC5cbiAqL1xuZnVuY3Rpb24gZ2V0RmllbGRPcHRpb25Db3VudChmaWVsZDogVElPU2NoZW1hQXR0cmlidXRlKTogbnVtYmVyIHtcbiAgICAvLyAxLiBFbnVtIHR5cGUgYXJyYXlcbiAgICBpZiAoQXJyYXkuaXNBcnJheShmaWVsZC50eXBlKSkge1xuICAgICAgICByZXR1cm4gZmllbGQudHlwZS5sZW5ndGg7XG4gICAgfVxuXG4gICAgLy8gMi4gQm9vbGVhbiBmaWVsZFxuICAgIGlmIChmaWVsZC50eXBlID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgcmV0dXJuIDI7XG4gICAgfVxuXG4gICAgLy8gMy4gU2VsZWN0L3JhZGlvL2NoZWNrYm94IGZpZWxkIHdpdGggaW5saW5lIG9wdGlvbnNcbiAgICBjb25zdCBmaWVsZFR5cGUgPSBmaWVsZC5maWVsZFR5cGU7XG4gICAgaWYgKGZpZWxkVHlwZSA9PT0gJ3NlbGVjdCcgfHwgZmllbGRUeXBlID09PSAncmFkaW8nIHx8IGZpZWxkVHlwZSA9PT0gJ2NoZWNrYm94JyB8fCBmaWVsZFR5cGUgPT09ICdtdWx0aS1zZWxlY3QnKSB7XG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSAoZmllbGQgYXMgYW55KS5vcHRpb25zO1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShvcHRpb25zKSkge1xuICAgICAgICAgICAgcmV0dXJuIG9wdGlvbnMubGVuZ3RoO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIDA7XG59XG5cbi8qKlxuICogQ2hlY2sgaWYgYSBmaWVsZCBpcyB2aWFibGUgZm9yIHNlZ21lbnQgZ2VuZXJhdGlvbi5cbiAqIFN1cHBvcnRzOlxuICogLSBFbnVtIHR5cGVzOiB0eXBlOiBbJ3ZhbHVlMScsICd2YWx1ZTInXVxuICogLSBCb29sZWFuIHR5cGVzOiB0eXBlOiAnYm9vbGVhbidcbiAqIC0gU2VsZWN0L3JhZGlvL2NoZWNrYm94IGZpZWxkcyB3aXRoIG9wdGlvbnM6IGZpZWxkVHlwZTogJ3NlbGVjdCcgKyBvcHRpb25zOiBbLi4uXVxuICogXG4gKiBTVFJJQ1RMWSBlbmZvcmNlczogbWluVmFsdWVzIDw9IG9wdGlvbkNvdW50IDw9IG1heFNlZ21lbnRzUGVyR3JvdXBcbiAqL1xuZnVuY3Rpb24gaXNWaWFibGVTZWdtZW50RmllbGQoXG4gICAgZmllbGQ6IFRJT1NjaGVtYUF0dHJpYnV0ZSxcbiAgICBjb25maWc6IFJlcXVpcmVkPElTZWdtZW50QXV0b0dlbmVyYXRpb25Db25maWc+ICYgeyBtYXhTZWdtZW50c1Blckdyb3VwPzogbnVtYmVyIH1cbik6IGJvb2xlYW4ge1xuICAgIGNvbnN0IG1heFZhbHVlcyA9IGNvbmZpZy5tYXhTZWdtZW50c1Blckdyb3VwIHx8IDEwO1xuICAgIGNvbnN0IG9wdGlvbkNvdW50ID0gZ2V0RmllbGRPcHRpb25Db3VudChmaWVsZCk7XG5cbiAgICAvLyBNdXN0IGhhdmUgb3B0aW9ucyBBTkQgYmUgd2l0aGluIGJvdW5kc1xuICAgIGlmIChvcHRpb25Db3VudCA9PT0gMCkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgLy8gU1RSSUNUOiBSZWplY3QgaWYgb3V0c2lkZSBib3VuZHNcbiAgICByZXR1cm4gb3B0aW9uQ291bnQgPj0gY29uZmlnLm1pblZhbHVlcyAmJiBvcHRpb25Db3VudCA8PSBtYXhWYWx1ZXM7XG59XG5cbi8qKlxuICogSW50ZWxsaWdlbnRseSBkZXRlY3QgdGhlIGJlc3QgZmllbGQocykgZm9yIGdlbmVyYXRpbmcgc2VnbWVudHMuXG4gKiBSZXR1cm5zIG11bHRpcGxlIGZpZWxkcyBpZiBtYXhTZWdtZW50R3JvdXBzID4gMS5cbiAqIFxuICogUHJpb3JpdHk6XG4gKiAxLiBFeHBsaWNpdCBzZWdtZW50RmllbGRzIChlbnRpdHkgY29uZmlnKSDihpIgVXNlIHRob3NlIGZpZWxkc1xuICogMi4gaW5jbHVkZUZpZWxkcyBmaWx0ZXIgKGVudGl0eSBjb25maWcpIOKGkiBPbmx5IGNvbnNpZGVyIHRoZXNlXG4gKiAzLiBleGNsdWRlRmllbGRzIGZpbHRlciAoZW50aXR5IGNvbmZpZykg4oaSIFNraXAgdGhlc2VcbiAqIDQuIHByZWZlcnJlZEZpZWxkcyAoZ2xvYmFsL2VudGl0eSBjb25maWcpIOKGkiBUcnkgdGhlc2UgZmlyc3RcbiAqIDUuIFNjb3JpbmcgYWxnb3JpdGhtIOKGkiBTY29yZSBhbGwgY2FuZGlkYXRlcyBhbmQgcGljayB0b3AgTlxuICovXG5mdW5jdGlvbiBkZXRlY3RTZWdtZW50RmllbGRzPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8c3RyaW5nLCBzdHJpbmcsIHN0cmluZz4+KFxuICAgIHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXA8Uz4sXG4gICAgZ2xvYmFsQ29uZmlnPzogSVNlZ21lbnRBdXRvR2VuZXJhdGlvbkNvbmZpZyxcbiAgICBlbnRpdHlDb25maWc/OiBOb25OdWxsYWJsZTxSZXR1cm5UeXBlPHR5cGVvZiBCYXNlRW50aXR5U2VydmljZS5wcm90b3R5cGUuZ2V0RW50aXR5U2NoZW1hPlsgJ21vZGVsJyBdWyAnbWV0YWRhdGEnIF0+WyAndGFibGVVSScgXVxuKTogQXJyYXk8eyBmaWVsZDogVElPU2NoZW1hQXR0cmlidXRlOyBzY29yZTogbnVtYmVyOyByZWFzb246IHN0cmluZyB9PiB7XG4gICAgY29uc3Qgc2VnbWVudENvbmZpZyA9IGVudGl0eUNvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uO1xuXG4gICAgLy8gTWVyZ2UgY29uZmlncyAoZW50aXR5ID4gZ2xvYmFsID4gZGVmYXVsdHMpXG4gICAgY29uc3QgbWVyZ2VkQ29uZmlnOiBSZXF1aXJlZDxJU2VnbWVudEF1dG9HZW5lcmF0aW9uQ29uZmlnPiAmIHsgbWF4U2VnbWVudEdyb3VwczogbnVtYmVyOyBtYXhTZWdtZW50c1Blckdyb3VwOiBudW1iZXIgfSA9IHtcbiAgICAgICAgZW5hYmxlZDogc2VnbWVudENvbmZpZz8uZW5hYmxlZCA/PyBnbG9iYWxDb25maWc/LmVuYWJsZWQgPz8gdHJ1ZSxcbiAgICAgICAgcHJlZmVycmVkRmllbGRzOiBzZWdtZW50Q29uZmlnPy5wcmVmZXJyZWRGaWVsZHMgfHwgZ2xvYmFsQ29uZmlnPy5wcmVmZXJyZWRGaWVsZHMgfHwgWyAnc3RhdHVzJywgJ3N0YXRlJywgJ3R5cGUnLCAnY2F0ZWdvcnknLCAncHJpb3JpdHknIF0sXG4gICAgICAgIG1heFNlZ21lbnRHcm91cHM6IHNlZ21lbnRDb25maWc/Lm1heFNlZ21lbnRHcm91cHMgPz8gZ2xvYmFsQ29uZmlnPy5tYXhTZWdtZW50R3JvdXBzID8/IDIsXG4gICAgICAgIG1heFNlZ21lbnRzUGVyR3JvdXA6IHNlZ21lbnRDb25maWc/Lm1heFNlZ21lbnRzUGVyR3JvdXAgPz8gZ2xvYmFsQ29uZmlnPy5tYXhTZWdtZW50c1Blckdyb3VwID8/IDEwLFxuICAgICAgICBtaW5WYWx1ZXM6IHNlZ21lbnRDb25maWc/Lm1pblZhbHVlcyA/PyBnbG9iYWxDb25maWc/Lm1pblZhbHVlcyA/PyAyLFxuICAgICAgICBpY29uTWFwcGluZzogeyAuLi5ERUZBVUxUX0lDT05fTUFQUElORywgLi4uZ2xvYmFsQ29uZmlnPy5pY29uTWFwcGluZywgLi4uc2VnbWVudENvbmZpZz8uaWNvbk1hcHBpbmcgfSxcbiAgICAgICAgYm9vbGVhbkxhYmVsUGF0dGVybnM6IHNlZ21lbnRDb25maWc/LmJvb2xlYW5MYWJlbFBhdHRlcm5zIHx8IGdsb2JhbENvbmZpZz8uYm9vbGVhbkxhYmVsUGF0dGVybnMgfHwgW10sXG4gICAgICAgIGRlZmF1bHRCb29sZWFuTGFiZWxzOiBzZWdtZW50Q29uZmlnPy5kZWZhdWx0Qm9vbGVhbkxhYmVscyB8fCBnbG9iYWxDb25maWc/LmRlZmF1bHRCb29sZWFuTGFiZWxzIHx8IHsgdHJ1ZTogJ1llcycsIGZhbHNlOiAnTm8nIH0sXG4gICAgICAgIGluY2x1ZGVBbGxTZWdtZW50OiBzZWdtZW50Q29uZmlnPy5pbmNsdWRlQWxsU2VnbWVudCA/PyBnbG9iYWxDb25maWc/LmluY2x1ZGVBbGxTZWdtZW50ID8/IHRydWUsXG4gICAgICAgIGRlYnVnOiBzZWdtZW50Q29uZmlnPy5kZWJ1ZyA/PyBnbG9iYWxDb25maWc/LmRlYnVnID8/IGZhbHNlXG4gICAgfTtcblxuICAgIGlmICghbWVyZ2VkQ29uZmlnLmVuYWJsZWQpIHtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgIH1cblxuICAgIC8vID09PSBQUklPUklUWSAxOiBFeHBsaWNpdCBzZWdtZW50IGZpZWxkcyA9PT1cbiAgICBjb25zdCBleHBsaWNpdEZpZWxkcyA9IHNlZ21lbnRDb25maWc/LnNlZ21lbnRGaWVsZHMgfHwgc2VnbWVudENvbmZpZz8uc2VnbWVudEZpZWxkO1xuICAgIGlmIChleHBsaWNpdEZpZWxkcykge1xuICAgICAgICBjb25zdCBmaWVsZE5hbWVzID0gdHlwZW9mIGV4cGxpY2l0RmllbGRzID09PSAnc3RyaW5nJyA/IFsgZXhwbGljaXRGaWVsZHMgXSA6IGV4cGxpY2l0RmllbGRzO1xuICAgICAgICBjb25zdCByZXN1bHRzOiBBcnJheTx7IGZpZWxkOiBUSU9TY2hlbWFBdHRyaWJ1dGU7IHNjb3JlOiBudW1iZXI7IHJlYXNvbjogc3RyaW5nIH0+ID0gW107XG5cbiAgICAgICAgZm9yIChjb25zdCBmaWVsZE5hbWUgb2YgZmllbGROYW1lcykge1xuICAgICAgICAgICAgY29uc3QgZmllbGQgPSBBcnJheS5mcm9tKHByb3BlcnRpZXMudmFsdWVzKCkpLmZpbmQocCA9PiBwLmlkID09PSBmaWVsZE5hbWUpO1xuICAgICAgICAgICAgaWYgKGZpZWxkKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0cy5wdXNoKHsgZmllbGQsIHNjb3JlOiAxMDAwLCByZWFzb246ICdleHBsaWNpdCBjb25maWd1cmF0aW9uJyB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChyZXN1bHRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHJldHVybiByZXN1bHRzLnNsaWNlKDAsIG1lcmdlZENvbmZpZy5tYXhTZWdtZW50R3JvdXBzKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vID09PSBGaWx0ZXIgcHJvcGVydGllcyBiYXNlZCBvbiBpbmNsdWRlL2V4Y2x1ZGUgPT09XG4gICAgbGV0IGNhbmRpZGF0ZVByb3BlcnRpZXMgPSBBcnJheS5mcm9tKHByb3BlcnRpZXMudmFsdWVzKCkpO1xuXG4gICAgLy8gQXBwbHkgaW5jbHVkZUZpZWxkcyBmaWx0ZXIgKGlmIHByb3ZpZGVkLCBPTkxZIGNvbnNpZGVyIHRoZXNlKVxuICAgIGlmIChzZWdtZW50Q29uZmlnPy5pbmNsdWRlRmllbGRzICYmIHNlZ21lbnRDb25maWcuaW5jbHVkZUZpZWxkcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNhbmRpZGF0ZVByb3BlcnRpZXMgPSBjYW5kaWRhdGVQcm9wZXJ0aWVzLmZpbHRlcihwID0+XG4gICAgICAgICAgICBzZWdtZW50Q29uZmlnLmluY2x1ZGVGaWVsZHMhLmluY2x1ZGVzKHAuaWQpXG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gQXBwbHkgZXhjbHVkZUZpZWxkcyBmaWx0ZXJcbiAgICBpZiAoc2VnbWVudENvbmZpZz8uZXhjbHVkZUZpZWxkcyAmJiBzZWdtZW50Q29uZmlnLmV4Y2x1ZGVGaWVsZHMubGVuZ3RoID4gMCkge1xuICAgICAgICBjYW5kaWRhdGVQcm9wZXJ0aWVzID0gY2FuZGlkYXRlUHJvcGVydGllcy5maWx0ZXIocCA9PlxuICAgICAgICAgICAgIXNlZ21lbnRDb25maWcuZXhjbHVkZUZpZWxkcyEuaW5jbHVkZXMocC5pZClcbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyA9PT0gUFJJT1JJVFkgMjogUHJlZmVycmVkIGZpZWxkcyA9PT1cbiAgICBjb25zdCBwcmVmZXJyZWRGaWVsZHMgPSBtZXJnZWRDb25maWcucHJlZmVycmVkRmllbGRzO1xuICAgIGNvbnN0IHByZWZlcnJlZE1hdGNoZXM6IEFycmF5PHsgZmllbGQ6IFRJT1NjaGVtYUF0dHJpYnV0ZTsgc2NvcmU6IG51bWJlcjsgcmVhc29uOiBzdHJpbmcgfT4gPSBbXTtcblxuICAgIGZvciAoY29uc3QgcHJlZmVycmVkTmFtZSBvZiBwcmVmZXJyZWRGaWVsZHMpIHtcbiAgICAgICAgY29uc3QgZmllbGQgPSBjYW5kaWRhdGVQcm9wZXJ0aWVzLmZpbmQocCA9PiBwLmlkID09PSBwcmVmZXJyZWROYW1lKTtcbiAgICAgICAgaWYgKGZpZWxkICYmIGlzVmlhYmxlU2VnbWVudEZpZWxkKGZpZWxkLCBtZXJnZWRDb25maWcpKSB7XG4gICAgICAgICAgICBwcmVmZXJyZWRNYXRjaGVzLnB1c2goeyBmaWVsZCwgc2NvcmU6IDkwMCwgcmVhc29uOiBgcHJlZmVycmVkIGZpZWxkOiAke3ByZWZlcnJlZE5hbWV9YCB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIElmIHdlIGhhdmUgZW5vdWdoIHByZWZlcnJlZCBtYXRjaGVzLCByZXR1cm4gdGhlbVxuICAgIGlmIChwcmVmZXJyZWRNYXRjaGVzLmxlbmd0aCA+PSBtZXJnZWRDb25maWcubWF4U2VnbWVudEdyb3Vwcykge1xuICAgICAgICByZXR1cm4gcHJlZmVycmVkTWF0Y2hlcy5zbGljZSgwLCBtZXJnZWRDb25maWcubWF4U2VnbWVudEdyb3Vwcyk7XG4gICAgfVxuXG4gICAgLy8gPT09IFBSSU9SSVRZIDM6IFNjb3JpbmcgYWxnb3JpdGhtID09PVxuICAgIGNvbnN0IGNhbmRpZGF0ZXM6IEFycmF5PHsgZmllbGQ6IFRJT1NjaGVtYUF0dHJpYnV0ZTsgc2NvcmU6IG51bWJlcjsgcmVhc29uOiBzdHJpbmc7IG9wdGlvbkNvdW50OiBudW1iZXIgfT4gPSBbXTtcblxuICAgIC8vIEFkZCBwcmVmZXJyZWRNYXRjaGVzIHdpdGggdGhlaXIgb3B0aW9uIGNvdW50c1xuICAgIGZvciAoY29uc3QgcG0gb2YgcHJlZmVycmVkTWF0Y2hlcykge1xuICAgICAgICBjb25zdCBvcHRpb25Db3VudCA9IGdldEZpZWxkT3B0aW9uQ291bnQocG0uZmllbGQpO1xuICAgICAgICBjYW5kaWRhdGVzLnB1c2goeyAuLi5wbSwgb3B0aW9uQ291bnQgfSk7XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBwcm9wIG9mIGNhbmRpZGF0ZVByb3BlcnRpZXMpIHtcbiAgICAgICAgLy8gU2tpcCBpZiBhbHJlYWR5IGluIHByZWZlcnJlZE1hdGNoZXNcbiAgICAgICAgaWYgKHByZWZlcnJlZE1hdGNoZXMuc29tZShwbSA9PiBwbS5maWVsZC5pZCA9PT0gcHJvcC5pZCkpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gU2tpcCBpZiBub3QgdmlhYmxlICh0aGlzIGZpbHRlcnMgb3V0IGZpZWxkcyB3aXRoIHRvbyBtYW55IG9wdGlvbnMpXG4gICAgICAgIGlmICghaXNWaWFibGVTZWdtZW50RmllbGQocHJvcCwgbWVyZ2VkQ29uZmlnKSkge1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgc2NvcmUgPSAwO1xuICAgICAgICBjb25zdCByZWFzb25zOiBzdHJpbmdbXSA9IFtdO1xuICAgICAgICBjb25zdCBvcHRpb25Db3VudCA9IGdldEZpZWxkT3B0aW9uQ291bnQocHJvcCk7XG5cbiAgICAgICAgLy8gKipTY29yZSAxOiBGaWVsZCBuYW1lIG1hdGNoKiogKHBhcnRpYWwgbWF0Y2ggd2l0aCBwcmVmZXJyZWQgbmFtZXMpXG4gICAgICAgIGZvciAoY29uc3QgcHJlZmVycmVkIG9mIHByZWZlcnJlZEZpZWxkcykge1xuICAgICAgICAgICAgaWYgKHByb3AuaWQudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhwcmVmZXJyZWQudG9Mb3dlckNhc2UoKSkpIHtcbiAgICAgICAgICAgICAgICBzY29yZSArPSA1MDtcbiAgICAgICAgICAgICAgICByZWFzb25zLnB1c2goYG5hbWUgY29udGFpbnMgXCIke3ByZWZlcnJlZH1cImApO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gKipTY29yZSAyOiBQcmVmZXIgZmV3ZXIgb3B0aW9ucyAoaW52ZXJzZSBzY29yaW5nKSoqXG4gICAgICAgIC8vIEZpZWxkcyB3aXRoIGZld2VyIG9wdGlvbnMgZ2V0IGhpZ2hlciBzY29yZXNcbiAgICAgICAgY29uc3QgbWluVmFsdWVzID0gbWVyZ2VkQ29uZmlnLm1pblZhbHVlcztcbiAgICAgICAgY29uc3QgbWF4VmFsdWVzID0gbWVyZ2VkQ29uZmlnLm1heFNlZ21lbnRzUGVyR3JvdXA7XG5cbiAgICAgICAgaWYgKG9wdGlvbkNvdW50ID49IG1pblZhbHVlcyAmJiBvcHRpb25Db3VudCA8PSBtYXhWYWx1ZXMpIHtcbiAgICAgICAgICAgIC8vIFNjb3JlIGludmVyc2VseSBwcm9wb3J0aW9uYWwgdG8gb3B0aW9uIGNvdW50XG4gICAgICAgICAgICAvLyAyIG9wdGlvbnMgPSArNDAsIDUgb3B0aW9ucyA9ICsyNSwgMTAgb3B0aW9ucyA9ICsxMFxuICAgICAgICAgICAgY29uc3Qgb3B0aW9uU2NvcmUgPSBNYXRoLm1heCgxMCwgNDAgLSAob3B0aW9uQ291bnQgLSBtaW5WYWx1ZXMpICogMyk7XG4gICAgICAgICAgICBzY29yZSArPSBvcHRpb25TY29yZTtcbiAgICAgICAgICAgIHJlYXNvbnMucHVzaChgJHtvcHRpb25Db3VudH0gb3B0aW9uc2ApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gKipTY29yZSAzOiBCb29sZWFuIGZpZWxkIGdldHMgaGlnaCBwcmlvcml0eSAob25seSAyIG9wdGlvbnMpKipcbiAgICAgICAgaWYgKHByb3AudHlwZSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgICAgICBzY29yZSArPSA1OyAgLy8gU21hbGwgYm9udXMgc2luY2Ugb3B0aW9uIGNvdW50IGFscmVhZHkgZmFjdG9ycyBpblxuICAgICAgICAgICAgcmVhc29ucy5wdXNoKCdib29sZWFuIGZpZWxkJyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyAqKlNjb3JlIDQ6IE5hbWUgcG9zaXRpb24gKGVhcmxpZXIgPSBzbGlnaHRseSBoaWdoZXIgcHJpb3JpdHkpKipcbiAgICAgICAgY29uc3QgZmllbGRJbmRleCA9IGNhbmRpZGF0ZVByb3BlcnRpZXMuaW5kZXhPZihwcm9wKTtcbiAgICAgICAgc2NvcmUgLT0gTWF0aC5taW4oZmllbGRJbmRleCwgNSk7ICAvLyBDYXAgcGVuYWx0eSBhdCA1XG5cbiAgICAgICAgY2FuZGlkYXRlcy5wdXNoKHtcbiAgICAgICAgICAgIGZpZWxkOiBwcm9wLFxuICAgICAgICAgICAgc2NvcmUsXG4gICAgICAgICAgICByZWFzb246IHJlYXNvbnMuam9pbignLCAnKSxcbiAgICAgICAgICAgIG9wdGlvbkNvdW50XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIFNvcnQgYnk6IDEpIHNjb3JlIChoaWdoZXN0IGZpcnN0KSwgMikgb3B0aW9uIGNvdW50IChsb3dlc3QgZmlyc3QpXG4gICAgY2FuZGlkYXRlcy5zb3J0KChhLCBiKSA9PiB7XG4gICAgICAgIGlmIChiLnNjb3JlICE9PSBhLnNjb3JlKSB7XG4gICAgICAgICAgICByZXR1cm4gYi5zY29yZSAtIGEuc2NvcmU7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGEub3B0aW9uQ291bnQgLSBiLm9wdGlvbkNvdW50OyAgLy8gUHJlZmVyIGZld2VyIG9wdGlvbnNcbiAgICB9KTtcblxuICAgIGNvbnN0IHRvcE5SZXN1bHRzID0gY2FuZGlkYXRlcy5zbGljZSgwLCBtZXJnZWRDb25maWcubWF4U2VnbWVudEdyb3Vwcyk7XG5cbiAgICBpZiAodG9wTlJlc3VsdHMubGVuZ3RoID4gMCAmJiBtZXJnZWRDb25maWcuZGVidWcpIHtcbiAgICAgICAgRGVmYXVsdExvZ2dlci5pbmZvKGBbU2VnbWVudERldGVjdGlvbl0gU2VsZWN0ZWQgJHt0b3BOUmVzdWx0cy5sZW5ndGh9IGZpZWxkKHMpOmAsIHRvcE5SZXN1bHRzLm1hcChjID0+ICh7XG4gICAgICAgICAgICBmaWVsZDogYy5maWVsZC5pZCxcbiAgICAgICAgICAgIHNjb3JlOiBjLnNjb3JlLFxuICAgICAgICAgICAgb3B0aW9uQ291bnQ6IGMub3B0aW9uQ291bnQsXG4gICAgICAgICAgICByZWFzb246IGMucmVhc29uXG4gICAgICAgIH0pKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRvcE5SZXN1bHRzO1xufVxuXG4vKipcbiAqIEF1dG8tZ2VuZXJhdGUgZmlsdGVyIHNlZ21lbnRzIGJhc2VkIG9uIGVudGl0eSBhdHRyaWJ1dGVzIHVzaW5nIHNtYXJ0IGRldGVjdGlvbi5cbiAqIFxuICogQWxnb3JpdGhtOlxuICogMS4gSWYgY3VzdG9tIHNlZ21lbnRzIHByb3ZpZGVkIOKGkiB1c2UgdGhlbSAoaGlnaGVzdCBwcmlvcml0eSlcbiAqIDIuIElmIGVudGl0eSByZXF1aXJlcyBtYW51YWwgc2VnbWVudHMg4oaSIHNraXAgYXV0by1nZW5lcmF0aW9uXG4gKiAzLiBEZXRlY3QgYmVzdCBmaWVsZCB1c2luZyBzY29yaW5nIGFsZ29yaXRobVxuICogNC4gR2VuZXJhdGUgc2VnbWVudHMgZnJvbSBkZXRlY3RlZCBmaWVsZCB3aXRoIHNtYXJ0IGljb25zXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZW5lcmF0ZVNlZ21lbnRzPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8c3RyaW5nLCBzdHJpbmcsIHN0cmluZz4+KFxuICAgIHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXA8Uz4sXG4gICAgZW50aXR5U2VydmljZT86IEJhc2VFbnRpdHlTZXJ2aWNlPFM+LFxuICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sgJ3VpQ29uZmlnR2VuT3B0aW9ucycgXSxcbiAgICBjdXN0b21TZWdtZW50cz86IFJlYWRvbmx5QXJyYXk8SUZpbHRlclNlZ21lbnQgfCBJRmlsdGVyU2VnbWVudEdyb3VwPiB8IEFycmF5PElGaWx0ZXJTZWdtZW50IHwgSUZpbHRlclNlZ21lbnRHcm91cD5cbik6IFJlYWRvbmx5QXJyYXk8SUZpbHRlclNlZ21lbnQgfCBJRmlsdGVyU2VnbWVudEdyb3VwPiB8IEFycmF5PElGaWx0ZXJTZWdtZW50IHwgSUZpbHRlclNlZ21lbnRHcm91cD4gfCB1bmRlZmluZWQge1xuICAgIC8vIDEuIElmIGN1c3RvbSBzZWdtZW50cyBwcm92aWRlZCwgdXNlIHRob3NlIChoaWdoZXN0IHByaW9yaXR5KVxuICAgIGlmIChjdXN0b21TZWdtZW50cyAmJiBjdXN0b21TZWdtZW50cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHJldHVybiBjdXN0b21TZWdtZW50cztcbiAgICB9XG5cbiAgICAvLyBHZXQgY29uZmlndXJhdGlvblxuICAgIGNvbnN0IGdsb2JhbFNlZ21lbnRDb25maWcgPSBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/LnRhYmxlVUk/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbjtcbiAgICBjb25zdCBlbnRpdHlNZXRhZGF0YSA9IGVudGl0eVNlcnZpY2U/LmdldEVudGl0eVNjaGVtYT8uKCkubW9kZWw/Lm1ldGFkYXRhO1xuICAgIGNvbnN0IGVudGl0eVNlZ21lbnRDb25maWcgPSBlbnRpdHlNZXRhZGF0YT8udGFibGVVSTtcblxuICAgIC8vIDIuIElmIGVudGl0eSByZXF1aXJlcyBtYW51YWwgc2VnbWVudHMsIHNraXAgYXV0by1nZW5lcmF0aW9uXG4gICAgaWYgKGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8ucmVxdWlyZU1hbnVhbCkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8vIDMuIERldGVjdCBiZXN0IHNlZ21lbnQgZmllbGRzIChyZXR1cm5zIGFycmF5IG5vdylcbiAgICBjb25zdCBkZXRlY3RlZEZpZWxkcyA9IGRldGVjdFNlZ21lbnRGaWVsZHMocHJvcGVydGllcywgZ2xvYmFsU2VnbWVudENvbmZpZywgZW50aXR5U2VnbWVudENvbmZpZyk7XG5cbiAgICBpZiAoZGV0ZWN0ZWRGaWVsZHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIC8vIE5vIHN1aXRhYmxlIGZpZWxkcyBmb3VuZFxuICAgICAgICBpZiAoZ2xvYmFsU2VnbWVudENvbmZpZz8uZGVidWcgfHwgZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5kZWJ1Zykge1xuICAgICAgICAgICAgRGVmYXVsdExvZ2dlci5pbmZvKGBbU2VnbWVudEdlbmVyYXRpb25dIE5vIHN1aXRhYmxlIGZpZWxkcyBkZXRlY3RlZCBmb3Igc2VnbWVudHNgKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8vIEdldCBtZXJnZWQgY29uZmlnIGZvciB0aGlzIGVudGl0eVxuICAgIGNvbnN0IG1lcmdlZENvbmZpZzogUmVxdWlyZWQ8SVNlZ21lbnRBdXRvR2VuZXJhdGlvbkNvbmZpZz4gJiB7IG1heFNlZ21lbnRHcm91cHM6IG51bWJlcjsgbWF4U2VnbWVudHNQZXJHcm91cDogbnVtYmVyIH0gPSB7XG4gICAgICAgIGVuYWJsZWQ6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uZW5hYmxlZCA/PyBnbG9iYWxTZWdtZW50Q29uZmlnPy5lbmFibGVkID8/IHRydWUsXG4gICAgICAgIHByZWZlcnJlZEZpZWxkczogZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5wcmVmZXJyZWRGaWVsZHMgfHwgZ2xvYmFsU2VnbWVudENvbmZpZz8ucHJlZmVycmVkRmllbGRzIHx8IFsgJ3N0YXR1cycsICdzdGF0ZScsICd0eXBlJywgJ2NhdGVnb3J5JywgJ3ByaW9yaXR5JyBdLFxuICAgICAgICBtYXhTZWdtZW50R3JvdXBzOiBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/Lm1heFNlZ21lbnRHcm91cHMgPz8gZ2xvYmFsU2VnbWVudENvbmZpZz8ubWF4U2VnbWVudEdyb3VwcyA/PyAyLFxuICAgICAgICBtYXhTZWdtZW50c1Blckdyb3VwOiBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/Lm1heFNlZ21lbnRzUGVyR3JvdXAgPz8gZ2xvYmFsU2VnbWVudENvbmZpZz8ubWF4U2VnbWVudHNQZXJHcm91cCA/PyAxMCxcbiAgICAgICAgbWluVmFsdWVzOiBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/Lm1pblZhbHVlcyA/PyBnbG9iYWxTZWdtZW50Q29uZmlnPy5taW5WYWx1ZXMgPz8gMixcbiAgICAgICAgaWNvbk1hcHBpbmc6IHtcbiAgICAgICAgICAgIC4uLkRFRkFVTFRfSUNPTl9NQVBQSU5HLFxuICAgICAgICAgICAgLi4uZ2xvYmFsU2VnbWVudENvbmZpZz8uaWNvbk1hcHBpbmcsXG4gICAgICAgICAgICAuLi5lbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/Lmljb25NYXBwaW5nXG4gICAgICAgIH0sXG4gICAgICAgIGJvb2xlYW5MYWJlbFBhdHRlcm5zOiBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmJvb2xlYW5MYWJlbFBhdHRlcm5zIHx8IGdsb2JhbFNlZ21lbnRDb25maWc/LmJvb2xlYW5MYWJlbFBhdHRlcm5zIHx8IFtdLFxuICAgICAgICBkZWZhdWx0Qm9vbGVhbkxhYmVsczogZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5kZWZhdWx0Qm9vbGVhbkxhYmVscyB8fCBnbG9iYWxTZWdtZW50Q29uZmlnPy5kZWZhdWx0Qm9vbGVhbkxhYmVscyB8fCB7IHRydWU6ICdZZXMnLCBmYWxzZTogJ05vJyB9LFxuICAgICAgICBpbmNsdWRlQWxsU2VnbWVudDogZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5pbmNsdWRlQWxsU2VnbWVudCA/PyBnbG9iYWxTZWdtZW50Q29uZmlnPy5pbmNsdWRlQWxsU2VnbWVudCA/PyB0cnVlLFxuICAgICAgICBkZWJ1ZzogZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5kZWJ1ZyA/PyBnbG9iYWxTZWdtZW50Q29uZmlnPy5kZWJ1ZyA/PyBmYWxzZVxuICAgIH07XG5cbiAgICBpZiAobWVyZ2VkQ29uZmlnLmRlYnVnKSB7XG4gICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW1NlZ21lbnRHZW5lcmF0aW9uXSBHZW5lcmF0aW5nIHNlZ21lbnRzIGZvciAke2RldGVjdGVkRmllbGRzLmxlbmd0aH0gZmllbGQocyk6YCwgZGV0ZWN0ZWRGaWVsZHMubWFwKGQgPT4gZC5maWVsZC5pZCkpO1xuICAgIH1cblxuICAgIC8vIDQuIEdlbmVyYXRlIHNlZ21lbnQgZ3JvdXBzIChvbmUgcGVyIGRldGVjdGVkIGZpZWxkKVxuICAgIGNvbnN0IHNlZ21lbnRHcm91cHM6IEFycmF5PElGaWx0ZXJTZWdtZW50R3JvdXA+ID0gW107XG5cbiAgICBmb3IgKGNvbnN0IGRldGVjdGlvbiBvZiBkZXRlY3RlZEZpZWxkcykge1xuICAgICAgICBjb25zdCB7IGZpZWxkIH0gPSBkZXRlY3Rpb247XG5cbiAgICAgICAgLy8gR2VuZXJhdGUgc2VnbWVudHMgZm9yIHRoaXMgZmllbGRcbiAgICAgICAgY29uc3Qgc2VnbWVudHM6IEFycmF5PElGaWx0ZXJTZWdtZW50PiA9IFtdO1xuXG4gICAgICAgIC8vIEFkZCBcIkFsbFwiIHNlZ21lbnQgaWYgZW5hYmxlZFxuICAgICAgICBpZiAobWVyZ2VkQ29uZmlnLmluY2x1ZGVBbGxTZWdtZW50KSB7XG4gICAgICAgICAgICBzZWdtZW50cy5wdXNoKHtcbiAgICAgICAgICAgICAgICBpZDogYGFsbC0ke2ZpZWxkLmlkfWAsXG4gICAgICAgICAgICAgICAgbGFiZWw6ICdBbGwnLFxuICAgICAgICAgICAgICAgIGZpbHRlcnM6IHt9LFxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6IHRydWVcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gR2V0IHZhbHVlcyBmcm9tIGZpZWxkXG4gICAgICAgIGxldCB2YWx1ZXM6IChzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuKVtdID0gW107XG4gICAgICAgIGxldCB2YWx1ZUxhYmVsczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9OyAgLy8gRm9yIGN1c3RvbSBib29sZWFuIGxhYmVsc1xuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGZpZWxkLnR5cGUpKSB7XG4gICAgICAgICAgICAvLyBFbnVtIHR5cGUgYXJyYXlcbiAgICAgICAgICAgIHZhbHVlcyA9IGZpZWxkLnR5cGU7XG4gICAgICAgIH0gZWxzZSBpZiAoZmllbGQudHlwZSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgICAgICAvLyBCb29sZWFuIGZpZWxkIHdpdGggb3B0aW9uYWwgY3VzdG9tIGxhYmVsc1xuICAgICAgICAgICAgdmFsdWVzID0gWyB0cnVlLCBmYWxzZSBdO1xuXG4gICAgICAgICAgICAvLyAxLiBDaGVjayBmb3IgZXhwbGljaXQgZmllbGQtbGV2ZWwgYm9vbGVhbkxhYmVsc1xuICAgICAgICAgICAgY29uc3QgZmllbGRCb29sZWFuTGFiZWxzID0gJ2Jvb2xlYW5MYWJlbHMnIGluIGZpZWxkID8gZmllbGQuYm9vbGVhbkxhYmVscyA6IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIGlmIChmaWVsZEJvb2xlYW5MYWJlbHMgJiYgdHlwZW9mIGZpZWxkQm9vbGVhbkxhYmVscyA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgICAgICB2YWx1ZUxhYmVsc1sgJ3RydWUnIF0gPSBmaWVsZEJvb2xlYW5MYWJlbHMudHJ1ZSB8fCAnWWVzJztcbiAgICAgICAgICAgICAgICB2YWx1ZUxhYmVsc1sgJ2ZhbHNlJyBdID0gZmllbGRCb29sZWFuTGFiZWxzLmZhbHNlIHx8ICdObyc7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIDIuIFRyeSBpbnRlbGxpZ2VudCBleHRyYWN0aW9uIGZyb20gZmllbGQgbmFtZVxuICAgICAgICAgICAgICAgIGNvbnN0IGZpZWxkTmFtZSA9IGZpZWxkLmlkO1xuICAgICAgICAgICAgICAgIGNvbnN0IGV4dHJhY3RlZCA9IGV4dHJhY3RCb29sZWFuTGFiZWxzRnJvbUZpZWxkTmFtZShmaWVsZE5hbWUpO1xuXG4gICAgICAgICAgICAgICAgaWYgKGV4dHJhY3RlZCkge1xuICAgICAgICAgICAgICAgICAgICB2YWx1ZUxhYmVsc1sgJ3RydWUnIF0gPSBleHRyYWN0ZWQudHJ1ZUxhYmVsO1xuICAgICAgICAgICAgICAgICAgICB2YWx1ZUxhYmVsc1sgJ2ZhbHNlJyBdID0gZXh0cmFjdGVkLmZhbHNlTGFiZWw7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gMy4gVHJ5IHRvIG1hdGNoIGFnYWluc3QgY29uZmlndXJlZCBwYXR0ZXJuc1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBwYXR0ZXJucyA9IG1lcmdlZENvbmZpZy5ib29sZWFuTGFiZWxQYXR0ZXJucztcbiAgICAgICAgICAgICAgICAgICAgbGV0IG1hdGNoZWQgPSBmYWxzZTtcblxuICAgICAgICAgICAgICAgICAgICBpZiAocGF0dGVybnMgJiYgcGF0dGVybnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBwYXR0ZXJuIG9mIHBhdHRlcm5zKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVnZXggPSBwYXR0ZXJuLnBhdHRlcm4gaW5zdGFuY2VvZiBSZWdFeHBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBwYXR0ZXJuLnBhdHRlcm5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgOiBuZXcgUmVnRXhwKHBhdHRlcm4ucGF0dGVybiwgJ2knKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChyZWdleC50ZXN0KGZpZWxkTmFtZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbICd0cnVlJyBdID0gcGF0dGVybi50cnVlTGFiZWw7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlTGFiZWxzWyAnZmFsc2UnIF0gPSBwYXR0ZXJuLmZhbHNlTGFiZWw7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hdGNoZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAvLyA0LiBVc2UgZGVmYXVsdCBmYWxsYmFjayBpZiBubyBwYXR0ZXJuIG1hdGNoZWRcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFtYXRjaGVkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBkZWZhdWx0cyA9IG1lcmdlZENvbmZpZy5kZWZhdWx0Qm9vbGVhbkxhYmVscyB8fCB7IHRydWU6ICdZZXMnLCBmYWxzZTogJ05vJyB9O1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbICd0cnVlJyBdID0gZGVmYXVsdHMudHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlTGFiZWxzWyAnZmFsc2UnIF0gPSBkZWZhdWx0cy5mYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmICgoZmllbGQuZmllbGRUeXBlID09PSAnc2VsZWN0JyB8fCBmaWVsZC5maWVsZFR5cGUgPT09ICdyYWRpbycgfHwgZmllbGQuZmllbGRUeXBlID09PSAnY2hlY2tib3gnIHx8IGZpZWxkLmZpZWxkVHlwZSA9PT0gJ211bHRpLXNlbGVjdCcpICYmIEFycmF5LmlzQXJyYXkoKGZpZWxkIGFzIGFueSkub3B0aW9ucykpIHtcbiAgICAgICAgICAgIC8vIFNlbGVjdC9yYWRpby9jaGVja2JveCBmaWVsZCB3aXRoIGlubGluZSBvcHRpb25zXG4gICAgICAgICAgICBjb25zdCBvcHRpb25zID0gKGZpZWxkIGFzIGFueSkub3B0aW9ucyBhcyBBcnJheTx7IGxhYmVsOiBzdHJpbmc7IHZhbHVlOiBzdHJpbmcgfT47XG4gICAgICAgICAgICB2YWx1ZXMgPSBvcHRpb25zLm1hcChvcHQgPT4gb3B0LnZhbHVlKTtcbiAgICAgICAgICAgIC8vIFN0b3JlIGxhYmVscyBmb3IgbGF0ZXIgdXNlXG4gICAgICAgICAgICBvcHRpb25zLmZvckVhY2gob3B0ID0+IHtcbiAgICAgICAgICAgICAgICB2YWx1ZUxhYmVsc1sgU3RyaW5nKG9wdC52YWx1ZSkgXSA9IG9wdC5sYWJlbDtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQXBwbHkgZmllbGQtc3BlY2lmaWMgdmFsdWUgZmlsdGVycyBmaXJzdCwgdGhlbiBnbG9iYWxcbiAgICAgICAgY29uc3QgaW5jbHVkZVZhbHVlc0J5RmllbGQgPSBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmluY2x1ZGVWYWx1ZXNCeUZpZWxkO1xuICAgICAgICBjb25zdCBpbmNsdWRlVmFsdWVzID0gaW5jbHVkZVZhbHVlc0J5RmllbGQ/LlsgZmllbGQuaWQgXSB8fCBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmluY2x1ZGVWYWx1ZXM7XG4gICAgICAgIGlmIChpbmNsdWRlVmFsdWVzKSB7XG4gICAgICAgICAgICB2YWx1ZXMgPSB2YWx1ZXMuZmlsdGVyKHYgPT4gaW5jbHVkZVZhbHVlcy5pbmNsdWRlcyhTdHJpbmcodikpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGV4Y2x1ZGVWYWx1ZXNCeUZpZWxkID0gZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5leGNsdWRlVmFsdWVzQnlGaWVsZDtcbiAgICAgICAgY29uc3QgZXhjbHVkZVZhbHVlcyA9IGV4Y2x1ZGVWYWx1ZXNCeUZpZWxkPy5bIGZpZWxkLmlkIF0gfHwgZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5leGNsdWRlVmFsdWVzO1xuICAgICAgICBpZiAoZXhjbHVkZVZhbHVlcykge1xuICAgICAgICAgICAgdmFsdWVzID0gdmFsdWVzLmZpbHRlcih2ID0+ICFleGNsdWRlVmFsdWVzLmluY2x1ZGVzKFN0cmluZyh2KSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQXBwbHkgZmllbGQtc3BlY2lmaWMgc29ydCBvcmRlciBmaXJzdCwgdGhlbiBnbG9iYWxcbiAgICAgICAgY29uc3Qgc29ydE9yZGVyQnlGaWVsZCA9IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uc29ydE9yZGVyQnlGaWVsZDtcbiAgICAgICAgY29uc3Qgc29ydE9yZGVyID0gc29ydE9yZGVyQnlGaWVsZD8uWyBmaWVsZC5pZCBdIHx8IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uc29ydE9yZGVyO1xuICAgICAgICBpZiAoc29ydE9yZGVyKSB7XG4gICAgICAgICAgICB2YWx1ZXMuc29ydCgoYSwgYikgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGFJbmRleCA9IHNvcnRPcmRlci5pbmRleE9mKFN0cmluZyhhKSk7XG4gICAgICAgICAgICAgICAgY29uc3QgYkluZGV4ID0gc29ydE9yZGVyLmluZGV4T2YoU3RyaW5nKGIpKTtcblxuICAgICAgICAgICAgICAgIC8vIElmIGJvdGggaW4gc29ydE9yZGVyLCB1c2UgdGhhdCBvcmRlclxuICAgICAgICAgICAgICAgIGlmIChhSW5kZXggPj0gMCAmJiBiSW5kZXggPj0gMCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gYUluZGV4IC0gYkluZGV4O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAvLyBJZiBvbmx5IG9uZSBpbiBzb3J0T3JkZXIsIGl0IGNvbWVzIGZpcnN0XG4gICAgICAgICAgICAgICAgaWYgKGFJbmRleCA+PSAwKSByZXR1cm4gLTE7XG4gICAgICAgICAgICAgICAgaWYgKGJJbmRleCA+PSAwKSByZXR1cm4gMTtcbiAgICAgICAgICAgICAgICAvLyBOZWl0aGVyIGluIHNvcnRPcmRlciwgbWFpbnRhaW4gb3JpZ2luYWwgb3JkZXJcbiAgICAgICAgICAgICAgICByZXR1cm4gMDtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gR2VuZXJhdGUgc2VnbWVudCBmb3IgZWFjaCB2YWx1ZVxuICAgICAgICBmb3IgKGNvbnN0IHZhbHVlIG9mIHZhbHVlcykge1xuICAgICAgICAgICAgY29uc3QgdmFsdWVTdHIgPSBTdHJpbmcodmFsdWUpO1xuICAgICAgICAgICAgY29uc3QgdmFsdWVMb3dlciA9IHZhbHVlU3RyLnRvTG93ZXJDYXNlKCk7XG5cbiAgICAgICAgICAgIC8vIFVzZSBjdXN0b20gbGFiZWwgaWYgYXZhaWxhYmxlLCBvdGhlcndpc2UgZm9ybWF0IHRoZSB2YWx1ZVxuICAgICAgICAgICAgY29uc3Qgc2VnbWVudExhYmVsID0gdmFsdWVMYWJlbHNbIHZhbHVlU3RyIF0gfHwgcGFzY2FsQ2FzZSh2YWx1ZVN0cik7XG5cbiAgICAgICAgICAgIHNlZ21lbnRzLnB1c2goe1xuICAgICAgICAgICAgICAgIGlkOiBgJHtmaWVsZC5pZH0tJHt2YWx1ZUxvd2VyLnJlcGxhY2UoL1teYS16MC05XSsvZywgJy0nKX1gLCAgLy8gVW5pcXVlIElEXG4gICAgICAgICAgICAgICAgbGFiZWw6IHNlZ21lbnRMYWJlbCwgIC8vIEN1c3RvbSBvciBmb3JtYXR0ZWQgbGFiZWxcbiAgICAgICAgICAgICAgICBpY29uOiBtZXJnZWRDb25maWcuaWNvbk1hcHBpbmdbIHZhbHVlTG93ZXIgXSwgIC8vIFNtYXJ0IGljb24gbG9va3VwXG4gICAgICAgICAgICAgICAgZmlsdGVyczoge1xuICAgICAgICAgICAgICAgICAgICBbIGZpZWxkLmlkIF06IHsgZXE6IHZhbHVlIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIE9ubHkgYWRkIGdyb3VwIGlmIHdlIGhhdmUgc2VnbWVudHNcbiAgICAgICAgY29uc3QgbWluU2VnbWVudHMgPSBtZXJnZWRDb25maWcuaW5jbHVkZUFsbFNlZ21lbnQgPyAxIDogMDtcbiAgICAgICAgaWYgKHNlZ21lbnRzLmxlbmd0aCA+IG1pblNlZ21lbnRzKSB7XG4gICAgICAgICAgICAvLyBBdXRvLWdlbmVyYXRlIGxhYmVsIG9yIHVzZSBleHBsaWNpdCBncm91cExhYmVsc1xuICAgICAgICAgICAgY29uc3QgY3VzdG9tR3JvdXBMYWJlbHMgPSBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/Lmdyb3VwTGFiZWxzO1xuICAgICAgICAgICAgY29uc3QgbGFiZWwgPSBjdXN0b21Hcm91cExhYmVscz8uWyBmaWVsZC5pZCBdIHx8IGBCeSAke3Bhc2NhbENhc2UoZmllbGQuaWQpfWA7XG5cbiAgICAgICAgICAgIHNlZ21lbnRHcm91cHMucHVzaCh7XG4gICAgICAgICAgICAgICAgaWQ6IGAke2ZpZWxkLmlkfS1ncm91cGAsXG4gICAgICAgICAgICAgICAgbGFiZWwsXG4gICAgICAgICAgICAgICAgc2VnbWVudHMsXG4gICAgICAgICAgICAgICAgZGVmYXVsdFNlZ21lbnRJZDogc2VnbWVudHMuZmluZChzID0+IHMuZGVmYXVsdCk/LmlkLFxuICAgICAgICAgICAgICAgIG1heFZpc2libGU6IG1lcmdlZENvbmZpZy5tYXhTZWdtZW50c1Blckdyb3VwXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFJldHVybiBzZWdtZW50IGdyb3VwcyAob3IgdW5kZWZpbmVkIGlmIG5vbmUgZ2VuZXJhdGVkKVxuICAgIGlmIChzZWdtZW50R3JvdXBzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8vIElmIG9ubHkgMSBncm91cCB3aXRoIHNpbXBsZSBjb25maWcsIHJldHVybiBmbGF0IHNlZ21lbnRzIGZvciBiYWNrd2FyZHMgY29tcGF0aWJpbGl0eVxuICAgIC8vIFRoaXMgbWFpbnRhaW5zIGxlZ2FjeSBiZWhhdmlvciB3aGVuIG1heFNlZ21lbnRHcm91cHMgPSAxXG4gICAgaWYgKHNlZ21lbnRHcm91cHMubGVuZ3RoID09PSAxICYmIG1lcmdlZENvbmZpZy5tYXhTZWdtZW50R3JvdXBzID09PSAxKSB7XG4gICAgICAgIHJldHVybiBzZWdtZW50R3JvdXBzWyAwIF0uc2VnbWVudHM7XG4gICAgfVxuXG4gICAgcmV0dXJuIHNlZ21lbnRHcm91cHM7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRU5USVRZIEFUVFJJQlVURSBGT1JNQVRUSU5HXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBGb3JtYXRzIGEgc2luZ2xlIGVudGl0eSBhdHRyaWJ1dGUgZm9yIGZvcm0gb3IgZGV0YWlsIHBhZ2UgZGlzcGxheS5cbiAqIFxuICogVHJhbnNmb3JtcyBzY2hlbWEgYXR0cmlidXRlcyBpbnRvIFVJLXJlYWR5IGZpZWxkIGNvbmZpZ3VyYXRpb25zIHdpdGggcHJvcGVyIGZpZWxkIHR5cGVzLFxuICogcmVsYXRpb24gY29uZmlncywgb3B0aW9ucywgdmlzaWJpbGl0eSwgYW5kIHZhbGlkYXRpb24gcnVsZXMuIEF1dG8tZ2VuZXJhdGVzIHJlbGF0aW9uXG4gKiBkaXNwbGF5IGNvbmZpZ3VyYXRpb25zIGFuZCBmaWx0ZXIgY29uZmlncyB3aGVuIG5vdCBleHBsaWNpdGx5IHByb3ZpZGVkLlxuICogXG4gKiBAcGFyYW0gdGhpc1Byb3AgLSBUaGUgZW50aXR5IGF0dHJpYnV0ZSB0byBmb3JtYXRcbiAqIEBwYXJhbSB0eXBlIC0gUGFnZSB0eXBlOiAnY3JlYXRlJywgJ3VwZGF0ZScsIG9yICdkZXRhaWwnXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIGZvciBhY2Nlc3NpbmcgcmVsYXRlZCBzY2hlbWFzXG4gKiBAcGFyYW0gYWxsUHJvcGVydGllcyAtIE9wdGlvbmFsIGFycmF5IG9mIGFsbCBwcm9wZXJ0aWVzIGZvciBkZXRlY3RpbmcgZHVwbGljYXRlZCByZWxhdGlvbiBmaWVsZHNcbiAqIEBwYXJhbSBnbG9iYWxVSUNvbmZpZ09wdGlvbnMgLSBPcHRpb25hbCBnbG9iYWwgVUkgY29uZmlndXJhdGlvbiBvcHRpb25zXG4gKiBAcmV0dXJucyBGb3JtYXR0ZWQgZmllbGQgbWV0YWRhdGEgcmVhZHkgZm9yIFVJIHJlbmRlcmluZ1xuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY29uc3QgZm9ybWF0dGVkRmllbGQgPSBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoXG4gKiAgIHtcbiAqICAgICBpZDogJ3RlYW1JZCcsXG4gKiAgICAgbmFtZTogJ3RlYW1JZCcsXG4gKiAgICAgdHlwZTogJ3N0cmluZycsXG4gKiAgICAgcmVsYXRpb246IHsgdHlwZTogJ29uZScsIGVudGl0eTogJ3RlYW0nIH1cbiAqICAgfSxcbiAqICAgJ2NyZWF0ZScsXG4gKiAgIGVudGl0eVNlcnZpY2VcbiAqICk7XG4gKiAvLyBSZXR1cm5zIGZpZWxkIHdpdGggcmVsYXRpb25Db25maWcsIGZpbHRlckNvbmZpZywgYW5kIHByb3BlciBmaWVsZCB0eXBlXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbChcbiAgICB0aGlzUHJvcDogVElPU2NoZW1hQXR0cmlidXRlLFxuICAgIHR5cGU6ICdjcmVhdGUnIHwgJ3VwZGF0ZScgfCAnZGV0YWlsJyxcbiAgICBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+LFxuICAgIGFsbFByb3BlcnRpZXM/OiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSwgIC8vIE9wdGlvbmFsOiBmb3IgZGV0ZWN0aW5nIGR1cGxpY2F0ZWQgcmVsYXRpb24gZmllbGRzXG4gICAgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyAndWlDb25maWdHZW5PcHRpb25zJyBdICAvLyBPcHRpb25hbDogZ2xvYmFsIFVJIGNvbmZpZyBvcHRpb25zXG4pIHtcbiAgICBjb25zdCBmb3JtYXR0ZWQ6IGFueSA9IHtcbiAgICAgICAgLi4udGhpc1Byb3AsXG4gICAgICAgIC8vIFVzZSBjdXN0b20gbGFiZWwgaWYgcHJvdmlkZWQgaW4gc2NoZW1hICh0aGlzUHJvcC5sYWJlbCksIG90aGVyd2lzZSBmb3JtYXQgdGhlIG5hbWUgdG8gaHVtYW4tcmVhZGFibGVcbiAgICAgICAgbGFiZWw6ICh0aGlzUHJvcCBhcyBhbnkpLmxhYmVsIHx8IHRvSHVtYW5SZWFkYWJsZU5hbWUodGhpc1Byb3AubmFtZSksXG4gICAgICAgIGNvbHVtbjogdGhpc1Byb3AuaWQsXG4gICAgICAgIGZpZWxkVHlwZTogdGhpc1Byb3AuZmllbGRUeXBlIHx8ICd0ZXh0JywgIC8vIGZpZWxkVHlwZSBzaG91bGQgYWxyZWFkeSBiZSBpbmZlcnJlZCBpbiBiYXNlLXNlcnZpY2VcbiAgICAgICAgaGlkZGVuOiB0aGlzUHJvcC5oYXNPd25Qcm9wZXJ0eSgnaXNWaXNpYmxlJykgJiYgIXRoaXNQcm9wLmlzVmlzaWJsZVxuICAgIH07XG5cbiAgICAvLyBIYW5kbGUgYWRkTmV3T3B0aW9uIChPTEQgLSBkZXByZWNhdGVkLCBnZW5lcmF0ZXMgZW1iZWRkZWQgY29uZmlnKSBvciBhZGROZXdPcHRpb25Db25maWcgKE5FVyAtIGp1c3QgcGFzcyB0aHJvdWdoIHJlZmVyZW5jZSlcbiAgICBpZiAoaXNTZWxlY3RGaWVsZE1ldGFkYXRhKHRoaXNQcm9wKSAmJiBbICdjcmVhdGUnLCAndXBkYXRlJyBdLmluY2x1ZGVzKHR5cGUpKSB7XG4gICAgICAgIGNvbnN0IHNlbGVjdEZpZWxkID0gdGhpc1Byb3AgYXMgU2VsZWN0RmllbGRNZXRhZGF0YTtcblxuICAgICAgICBpZiAoc2VsZWN0RmllbGQuYWRkTmV3T3B0aW9uQ29uZmlnKSB7XG4gICAgICAgICAgICAvLyBORVcgV0FZOiBVc2VyIHByb3ZpZGVkIGFkZE5ld09wdGlvbkNvbmZpZyByZWZlcmVuY2UgLSBqdXN0IHBhc3MgaXQgdGhyb3VnaFxuICAgICAgICAgICAgZm9ybWF0dGVkWyAnYWRkTmV3T3B0aW9uQ29uZmlnJyBdID0gc2VsZWN0RmllbGQuYWRkTmV3T3B0aW9uQ29uZmlnO1xuXG4gICAgICAgIH0gZWxzZSBpZiAoc2VsZWN0RmllbGQuYWRkTmV3T3B0aW9uKSB7XG4gICAgICAgICAgICAvLyBPTEQgV0FZIChERVBSRUNBVEVEKTogVHJhbnNmb3JtIGFkZE5ld09wdGlvbiB0byBhZGROZXdPcHRpb25Db25maWcgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICAgICAgICAgIGNvbnN0IHsgZW50aXR5TmFtZSwgb3ZlcnJpZGVDb25maWcgfSA9IHNlbGVjdEZpZWxkLmFkZE5ld09wdGlvbjtcblxuICAgICAgICAgICAgaWYgKGVudGl0eU5hbWUgJiYgZW50aXR5U2VydmljZS5oYXNFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKGVudGl0eU5hbWUpKSB7XG4gICAgICAgICAgICAgICAgZm9ybWF0dGVkWyAnYWRkTmV3T3B0aW9uQ29uZmlnJyBdID0ge1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2NyZWF0ZScsXG4gICAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiBvdmVycmlkZUNvbmZpZyB8fCB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdWJtaXRTdWNjZXNzUmVkaXJlY3Q6IHVuZGVmaW5lZCwgIC8vIFN0YXkgaW4gbW9kYWwgYWZ0ZXIgY3JlYXRpb25cbiAgICAgICAgICAgICAgICAgICAgICAgIGZvcm1CdXR0b25zOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgeyB0ZXh0OiBcIkFkZFwiLCBhY3Rpb246IFwic3VibWl0XCIgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7IHRleHQ6IFwiQ2FuY2VsXCIsIGFjdGlvbjogXCJjYW5jZWxcIiB9XG4gICAgICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbDogQ291bGQgbm90IGZpbmQgcmVsYXRlZC1lbnRpdHktc2VydmljZSBmb3IgZW50aXR5IFske2VudGl0eU5hbWV9XSBpbiAke2VudGl0eVNlcnZpY2UuY29uc3RydWN0b3IubmFtZX1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIEhhbmRsZSByZWxhdGlvbiBmaWVsZHMgKERBVEEgTEFZRVIgKyBVSSBMQVlFUilcbiAgICBpZiAodGhpc1Byb3AucmVsYXRpb24gJiYgdHlwZSA9PT0gJ2RldGFpbCcpIHtcbiAgICAgICAgY29uc3QgcmVsYXRpb24gPSB0aGlzUHJvcC5yZWxhdGlvbjtcbiAgICAgICAgY29uc3QgeyBlbnRpdHlOYW1lLCB0eXBlOiByZWxhdGlvblR5cGUsIGlkZW50aWZpZXJzIH0gPSByZWxhdGlvbjtcbiAgICAgICAgY29uc3QgZW50aXR5TmFtZUxvd2VyID0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpO1xuXG4gICAgICAgIGlmICghZW50aXR5U2VydmljZS5oYXNFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKGVudGl0eU5hbWUpKSB7XG4gICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbDogQ291bGQgbm90IGZpbmQgcmVsYXRlZC1lbnRpdHktc2VydmljZSBmb3IgZW50aXR5IFske2VudGl0eU5hbWV9XSBpbiAke2VudGl0eVNlcnZpY2UuY29uc3RydWN0b3IubmFtZX1gKTtcbiAgICAgICAgICAgIHJldHVybiBmb3JtYXR0ZWQ7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZXNvbHZlIGlkZW50aWZpZXJzIChjb3VsZCBiZSBkaXJlY3QgdmFsdWUgb3IgbGF6eSBmdW5jdGlvbilcbiAgICAgICAgY29uc3QgcmVzb2x2ZWRJZGVudGlmaWVycyA9IHR5cGVvZiBpZGVudGlmaWVycyA9PT0gJ2Z1bmN0aW9uJyA/IGlkZW50aWZpZXJzKCkgOiBpZGVudGlmaWVycztcblxuICAgICAgICAvLyBTYWZldHkgY2hlY2sgZm9yIGFycmF5IGlkZW50aWZpZXJzXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHJlc29sdmVkSWRlbnRpZmllcnMpKSB7XG4gICAgICAgICAgICBpZiAocmVzb2x2ZWRJZGVudGlmaWVycy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbDogRW1wdHkgaWRlbnRpZmllcnMgYXJyYXkgZm9yIHJlbGF0aW9uIFske2VudGl0eU5hbWV9XWApO1xuICAgICAgICAgICAgICAgIHJldHVybiBmb3JtYXR0ZWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBIYW5kbGUgYm90aCBzaW5nbGUgYW5kIG11bHRpcGxlIGlkZW50aWZpZXJzIGZvciBjb21wb3NpdGUga2V5c1xuICAgICAgICBjb25zdCBpZGVudGlmaWVyTWFwcGluZ3MgPSBBcnJheS5pc0FycmF5KHJlc29sdmVkSWRlbnRpZmllcnMpXG4gICAgICAgICAgICA/IHJlc29sdmVkSWRlbnRpZmllcnMubWFwKGlkID0+ICh7XG4gICAgICAgICAgICAgICAgc291cmNlOiBTdHJpbmcoaWQuc291cmNlKSxcbiAgICAgICAgICAgICAgICB0YXJnZXQ6IFN0cmluZyhpZC50YXJnZXQpXG4gICAgICAgICAgICB9KSlcbiAgICAgICAgICAgIDogWyB7XG4gICAgICAgICAgICAgICAgc291cmNlOiBTdHJpbmcocmVzb2x2ZWRJZGVudGlmaWVycy5zb3VyY2UpLFxuICAgICAgICAgICAgICAgIHRhcmdldDogU3RyaW5nKHJlc29sdmVkSWRlbnRpZmllcnMudGFyZ2V0KVxuICAgICAgICAgICAgfSBdO1xuXG4gICAgICAgIC8vIEZvciByb3V0ZSBwYXR0ZXJuIGFuZCBkZWZhdWx0IGZpbHRlcnMsIHVzZSB0aGUgZmlyc3QgaWRlbnRpZmllclxuICAgICAgICAvLyAobW9zdCBlbnRpdGllcyBoYXZlIHNpbmdsZSBpZGVudGlmaWVyOyBjb21wb3NpdGUga2V5cyBuZWVkIGV4cGxpY2l0IHJvdXRlUGF0dGVybilcbiAgICAgICAgY29uc3QgcHJpbWFyeUlkZW50aWZpZXIgPSBpZGVudGlmaWVyTWFwcGluZ3NbIDAgXTtcblxuICAgICAgICAvLyBDaGVjayBpZiB1c2VyIHByb3ZpZGVkIGN1c3RvbSBVSSBjb25maWcgaW4gcmVsYXRpb25Db25maWcgKG9wdGlvbmFsIG92ZXJyaWRlKVxuICAgICAgICBjb25zdCB1c2VyUmVsYXRpb25Db25maWcgPSB0aGlzUHJvcC5yZWxhdGlvbkNvbmZpZyBhcyBJUmVsYXRpb25GaWVsZENvbmZpZyB8IHVuZGVmaW5lZDtcblxuICAgICAgICAvLyBHZXQgcmVsYXRlZCBlbnRpdHkgc2VydmljZSBmb3IgbWV0YWRhdGEgKGljb24sIGV0Yy4pXG4gICAgICAgIGNvbnN0IHJlbGF0ZWRFbnRpdHlTZXJ2aWNlID0gZW50aXR5U2VydmljZS5oYXNFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKGVudGl0eU5hbWUpXG4gICAgICAgICAgICA/IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShlbnRpdHlOYW1lKVxuICAgICAgICAgICAgOiB1bmRlZmluZWQ7XG5cbiAgICAgICAgLy8gR2V0IGVudGl0eSBtZXRhZGF0YSBmb3IgaWNvbiBhbmQgZmFsbGJhY2sgZ2VuZXJhdGlvblxuICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5TWV0YWRhdGEgPSByZWxhdGVkRW50aXR5U2VydmljZT8uZ2V0RW50aXR5U2NoZW1hPy4oKS5tb2RlbDtcbiAgICAgICAgY29uc3QgZGVmYXVsdEljb24gPSByZWxhdGVkRW50aXR5TWV0YWRhdGE/Lm1ldGFkYXRhPy5pY29uO1xuXG4gICAgICAgIGlmIChyZWxhdGlvblR5cGUuZW5kc1dpdGgoJ3RvLW9uZScpKSB7XG4gICAgICAgICAgICAvLyBUTy1PTkU6IFNob3cgdmFsdWUgYXMgbGluayArIG1vZGFsIGljb25cbiAgICAgICAgICAgIC8vIFJvdXRlIHBhdHRlcm46IFVzZSBjdXN0b20gKGZyb20gcmVsYXRpb25Db25maWcpIG9yIGRlZmF1bHQgdG8gL3ZpZXcte2VudGl0eX0vOnRhcmdldElkXG4gICAgICAgICAgICBjb25zdCByb3V0ZVBhdHRlcm4gPSB1c2VyUmVsYXRpb25Db25maWc/LnJvdXRlUGF0dGVyblxuICAgICAgICAgICAgICAgIHx8IGAvdmlldy0ke2VudGl0eU5hbWVMb3dlcn0vOiR7cHJpbWFyeUlkZW50aWZpZXIudGFyZ2V0fWA7XG5cbiAgICAgICAgICAgIC8vIEdlbmVyYXRlIGZhbGxiYWNrIGNvbmZpZ3VyYXRpb24gZm9yIHdoZW4gb25seSBJRCBpcyBhdmFpbGFibGVcbiAgICAgICAgICAgIGNvbnN0IGZhbGxiYWNrQ29uZmlnID0gZ2VuZXJhdGVSZWxhdGlvbkZhbGxiYWNrKFxuICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgcHJpbWFyeUlkZW50aWZpZXIuc291cmNlLFxuICAgICAgICAgICAgICAgIHJlbGF0ZWRFbnRpdHlTZXJ2aWNlXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICAvLyBBdXRvLWRldGVjdCBkdXBsaWNhdGVkIHJlbGF0aW9uIGZpZWxkIChlLmcuLCB0ZWFtTmFtZSBmb3IgdGVhbUlkKVxuICAgICAgICAgICAgLy8gTkVXOiBVc2UgZW5oYW5jZWQgZGV0ZWN0aW9uIHdpdGggY29uZmlnIHN1cHBvcnRcbiAgICAgICAgICAgIGxldCBhdXRvVGVtcGxhdGU6IHN0cmluZyB8IHVuZGVmaW5lZCA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIGxldCBkZXRlY3Rpb25NZXRhZGF0YTogYW55ID0gdW5kZWZpbmVkO1xuXG4gICAgICAgICAgICAvLyBDaGVjayBpZiBhdXRvLWRldGVjdGlvbiBpcyBlbmFibGVkIChkZWZhdWx0OiB0cnVlKVxuICAgICAgICAgICAgY29uc3QgYXV0b0RldGVjdEVuYWJsZWQgPSB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmF1dG9EZXRlY3QgIT09IGZhbHNlO1xuXG4gICAgICAgICAgICBpZiAoYXV0b0RldGVjdEVuYWJsZWQgJiYgYWxsUHJvcGVydGllcykge1xuICAgICAgICAgICAgICAgIC8vIEdldCBnbG9iYWwgY29uZmlnIChwYXNzZWQgZnJvbSBmdzI0IGluaXRpYWxpemF0aW9uKVxuICAgICAgICAgICAgICAgIGNvbnN0IGdsb2JhbENvbmZpZyA9IGdsb2JhbFVJQ29uZmlnT3B0aW9ucz8uZHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uO1xuXG4gICAgICAgICAgICAgICAgLy8gR2V0IGVudGl0eS1sZXZlbCBjb25maWcgZnJvbSBlbnRpdHkgbWV0YWRhdGFcbiAgICAgICAgICAgICAgICBjb25zdCBlbnRpdHlDb25maWcgPSByZWxhdGVkRW50aXR5TWV0YWRhdGE/Lm1ldGFkYXRhPy5kdXBsaWNhdGVkRmllbGREZXRlY3Rpb247XG5cbiAgICAgICAgICAgICAgICAvLyBHZXQgcmVsYXRpb24tbGV2ZWwgaGludHNcbiAgICAgICAgICAgICAgICBjb25zdCByZWxhdGlvbkhpbnRzID0gdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5hdXRvRGV0ZWN0SGludHM7XG5cbiAgICAgICAgICAgICAgICAvLyBSdW4gZW5oYW5jZWQgZGV0ZWN0aW9uXG4gICAgICAgICAgICAgICAgY29uc3QgZGV0ZWN0aW9uUmVzdWx0ID0gZGV0ZWN0RHVwbGljYXRlZFJlbGF0aW9uRmllbGRzKFxuICAgICAgICAgICAgICAgICAgICBhbGxQcm9wZXJ0aWVzLFxuICAgICAgICAgICAgICAgICAgICB0aGlzUHJvcC5pZCxcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgZ2xvYmFsQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICBlbnRpdHlDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIHJlbGF0aW9uSGludHNcbiAgICAgICAgICAgICAgICApO1xuXG4gICAgICAgICAgICAgICAgaWYgKGRldGVjdGlvblJlc3VsdCkge1xuICAgICAgICAgICAgICAgICAgICBhdXRvVGVtcGxhdGUgPSBkZXRlY3Rpb25SZXN1bHQudGVtcGxhdGU7XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gU3RvcmUgbWV0YWRhdGEgZm9yIGRlYnVnZ2luZyBhbmQgZnV0dXJlIGZlYXR1cmVzXG4gICAgICAgICAgICAgICAgICAgIGRldGVjdGlvbk1ldGFkYXRhID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgZGV0ZWN0ZWRGaWVsZHM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcmltYXJ5OiBkZXRlY3Rpb25SZXN1bHQucHJpbWFyeUZpZWxkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFsdGVybmF0aXZlczogZGV0ZWN0aW9uUmVzdWx0LmRldGVjdGVkRmllbGRzLmRpc3BsYXk/LnNsaWNlKDEpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZpc3VhbDogZGV0ZWN0aW9uUmVzdWx0LmRldGVjdGVkRmllbGRzLnZpc3VhbCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZXRhOiBkZXRlY3Rpb25SZXN1bHQuZGV0ZWN0ZWRGaWVsZHMubWV0YVxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbmZpZGVuY2U6IGRldGVjdGlvblJlc3VsdC5jb25maWRlbmNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWV0aG9kOiBkZXRlY3Rpb25SZXN1bHQubWV0aG9kLFxuICAgICAgICAgICAgICAgICAgICAgICAgcGF0dGVybjogZGV0ZWN0aW9uUmVzdWx0LnBhdHRlcm5cbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnOiBJUmVsYXRpb25GaWVsZENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICByb3V0ZVBhdHRlcm46IHJvdXRlUGF0dGVybixcbiAgICAgICAgICAgICAgICAvLyBQYXNzIEFMTCBpZGVudGlmaWVyIG1hcHBpbmdzIChzdXBwb3J0cyBjb21wb3NpdGUga2V5cylcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyTWFwcGluZzogaWRlbnRpZmllck1hcHBpbmdzLmxlbmd0aCA9PT0gMVxuICAgICAgICAgICAgICAgICAgICA/IGlkZW50aWZpZXJNYXBwaW5nc1sgMCBdICAvLyBTaW5nbGU6IHJldHVybiBvYmplY3RcbiAgICAgICAgICAgICAgICAgICAgOiBpZGVudGlmaWVyTWFwcGluZ3MsICAgICAvLyBNdWx0aXBsZTogcmV0dXJuIGFycmF5XG4gICAgICAgICAgICAgICAgbW9kYWxDb25maWdSZWY6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxDb25maWdSZWYgfHwge1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ3ZpZXcnLFxuICAgICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge31cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIG1vZGFsV2lkdGg6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxXaWR0aCxcbiAgICAgICAgICAgICAgICBtb2RhbFRpdGxlOiB1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsVGl0bGUsXG4gICAgICAgICAgICAgICAgZGlzcGxheUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAvLyBQcmlvcml0eTogVXNlciBjdXN0b20gdGVtcGxhdGUgPiBBdXRvLWRldGVjdGVkIGR1cGxpY2F0ZWQgZmllbGQgPiB1bmRlZmluZWQgKHVzZSBmYWxsYmFjaylcbiAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGU6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8udGVtcGxhdGUgfHwgYXV0b1RlbXBsYXRlLFxuICAgICAgICAgICAgICAgICAgICAvLyBTbWFydCBmYWxsYmFjayBwcmUtZ2VuZXJhdGVkIGZyb20gZW50aXR5IG1ldGFkYXRhXG4gICAgICAgICAgICAgICAgICAgIGZhbGxiYWNrOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmZhbGxiYWNrIHx8IGZhbGxiYWNrQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICAvLyBJY29uIGZyb20gZW50aXR5IG1ldGFkYXRhIG9yIHVzZXIgb3ZlcnJpZGVcbiAgICAgICAgICAgICAgICAgICAgaWNvbjogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5pY29uIHx8IGRlZmF1bHRJY29uIHx8ICdFeWVPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgICAgIHNob3dNb2RhbEljb246IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uc2hvd01vZGFsSWNvbiAhPT0gZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgIHNob3dMaW5rOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnNob3dMaW5rICE9PSBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgLy8gUGFzcyB0aHJvdWdoIGF1dG9EZXRlY3QgYW5kIGF1dG9EZXRlY3RIaW50c1xuICAgICAgICAgICAgICAgICAgICBhdXRvRGV0ZWN0OiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmF1dG9EZXRlY3QsXG4gICAgICAgICAgICAgICAgICAgIGF1dG9EZXRlY3RIaW50czogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5hdXRvRGV0ZWN0SGludHMsXG4gICAgICAgICAgICAgICAgICAgIC8vIFBhc3MgdGhyb3VnaCBhbnkgY3VzdG9tIGFjdGlvbnNcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5hY3Rpb25zXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGlmIChnbG9iYWxVSUNvbmZpZ09wdGlvbnM/LmR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbj8uZGVidWcpIHtcbiAgICAgICAgICAgICAgICBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZy5kaXNwbGF5Q29uZmlnIVsgJ19kZXRlY3Rpb25NZXRhZGF0YScgXSA9IGRldGVjdGlvbk1ldGFkYXRhO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdyZWxhdGlvbkNvbmZpZycgXSA9IGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnO1xuXG4gICAgICAgICAgICAvLyBCYWNrd2FyZCBjb21wYXRpYmlsaXR5OiBLZWVwIGlzTGluayBhbmQgbGlua0NvbmZpZ1xuICAgICAgICAgICAgZm9ybWF0dGVkWyAnaXNMaW5rJyBdID0gdHJ1ZTtcbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ2xpbmtDb25maWcnIF0gPSB7XG4gICAgICAgICAgICAgICAgcm91dGVQYXR0ZXJuOiByb3V0ZVBhdHRlcm5cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgfSBlbHNlIGlmIChyZWxhdGlvblR5cGUuZW5kc1dpdGgoJ3RvLW1hbnknKSkge1xuICAgICAgICAgICAgLy8gVE8tTUFOWTogU2hvdyBjb3VudCArIG1vZGFsIGljb24gKG9wZW5zIGZpbHRlcmVkIGxpc3QpXG4gICAgICAgICAgICAvLyBSb3V0ZSBwYXR0ZXJuOiBVc2UgY3VzdG9tIChmcm9tIHJlbGF0aW9uQ29uZmlnKSBvciBkZWZhdWx0IHRvIC9saXN0LXtlbnRpdHl9XG4gICAgICAgICAgICBjb25zdCByb3V0ZVBhdHRlcm4gPSB1c2VyUmVsYXRpb25Db25maWc/LnJvdXRlUGF0dGVyblxuICAgICAgICAgICAgICAgIHx8IGAvbGlzdC0ke2VudGl0eU5hbWVMb3dlcn1gO1xuXG4gICAgICAgICAgICAvLyBCdWlsZCBkZWZhdWx0IGZpbHRlcnMgdG8gc2hvdyBvbmx5IHJlbGF0ZWQgaXRlbXNcbiAgICAgICAgICAgIC8vIEZvciBleGFtcGxlLCBpZiB3ZSdyZSB2aWV3aW5nIGEgVGVhbSBhbmQgdGhpcyBmaWVsZCBzaG93cyBHYW1lcyxcbiAgICAgICAgICAgIC8vIHdlIHdhbnQgdG8gZmlsdGVyIGdhbWVzIHdoZXJlIHRlYW1JZCA9IGN1cnJlbnQgdGVhbSdzIElEXG4gICAgICAgICAgICAvLyBGb3IgY29tcG9zaXRlIGtleXMsIGFkZCBhbGwgaWRlbnRpZmllcnMgYXMgZmlsdGVyc1xuICAgICAgICAgICAgY29uc3QgZGVmYXVsdEZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICAgICAgICAgIGlkZW50aWZpZXJNYXBwaW5ncy5mb3JFYWNoKG1hcHBpbmcgPT4ge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzWyBtYXBwaW5nLnRhcmdldCBdID0gYDoke21hcHBpbmcuc291cmNlfWA7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gR2VuZXJhdGUgZmFsbGJhY2sgY29uZmlndXJhdGlvbiBmb3IgdG8tbWFueSAoc2hvd3MgY291bnQpXG4gICAgICAgICAgICBjb25zdCBmYWxsYmFja0NvbmZpZyA9IGdlbmVyYXRlUmVsYXRpb25GYWxsYmFjayhcbiAgICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgIHByaW1hcnlJZGVudGlmaWVyLnNvdXJjZSxcbiAgICAgICAgICAgICAgICByZWxhdGVkRW50aXR5U2VydmljZVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgY29uc3QgZ2VuZXJhdGVkUmVsYXRpb25Db25maWc6IElSZWxhdGlvbkZpZWxkQ29uZmlnID0ge1xuICAgICAgICAgICAgICAgIHJvdXRlUGF0dGVybjogcm91dGVQYXR0ZXJuLFxuICAgICAgICAgICAgICAgIC8vIFBhc3MgQUxMIGlkZW50aWZpZXIgbWFwcGluZ3MgKHN1cHBvcnRzIGNvbXBvc2l0ZSBrZXlzKVxuICAgICAgICAgICAgICAgIGlkZW50aWZpZXJNYXBwaW5nOiBpZGVudGlmaWVyTWFwcGluZ3MubGVuZ3RoID09PSAxXG4gICAgICAgICAgICAgICAgICAgID8gaWRlbnRpZmllck1hcHBpbmdzWyAwIF0gIC8vIFNpbmdsZTogcmV0dXJuIG9iamVjdFxuICAgICAgICAgICAgICAgICAgICA6IGlkZW50aWZpZXJNYXBwaW5ncywgICAgIC8vIE11bHRpcGxlOiByZXR1cm4gYXJyYXlcbiAgICAgICAgICAgICAgICBtb2RhbENvbmZpZ1JlZjogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbENvbmZpZ1JlZiB8fCB7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogZGVmYXVsdEZpbHRlcnNcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgbW9kYWxXaWR0aDogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbFdpZHRoLFxuICAgICAgICAgICAgICAgIG1vZGFsVGl0bGU6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxUaXRsZSxcbiAgICAgICAgICAgICAgICBkaXNwbGF5Q29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZXIgY2FuIG92ZXJyaWRlIHdpdGggY3VzdG9tIHRlbXBsYXRlXG4gICAgICAgICAgICAgICAgICAgIHRlbXBsYXRlOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnRlbXBsYXRlLFxuICAgICAgICAgICAgICAgICAgICAvLyBTbWFydCBmYWxsYmFjayBwcmUtZ2VuZXJhdGVkIGZyb20gZW50aXR5IG1ldGFkYXRhXG4gICAgICAgICAgICAgICAgICAgIGZhbGxiYWNrOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmZhbGxiYWNrIHx8IGZhbGxiYWNrQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICAvLyBJY29uIGZyb20gZW50aXR5IG1ldGFkYXRhIG9yIHVzZXIgb3ZlcnJpZGVcbiAgICAgICAgICAgICAgICAgICAgaWNvbjogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5pY29uIHx8IGRlZmF1bHRJY29uIHx8ICdVbm9yZGVyZWRMaXN0T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgICAgICBzaG93TW9kYWxJY29uOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnNob3dNb2RhbEljb24gIT09IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICBzaG93TGluazogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5zaG93TGluayAhPT0gdHJ1ZSwgLy8gRGVmYXVsdCBmYWxzZSBmb3IgdG8tbWFueVxuICAgICAgICAgICAgICAgICAgICAvLyBQYXNzIHRocm91Z2ggYW55IGN1c3RvbSBhY3Rpb25zXG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uYWN0aW9uc1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIC8vIElmIHVzZXIgcHJvdmlkZWQgY3VzdG9tIG1vZGFsQ29uZmlnUmVmLCBtZXJnZSBkZWZhdWx0IGZpbHRlcnMgd2l0aCB0aGVpciBvdmVycmlkZXNcbiAgICAgICAgICAgIGlmICh1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsQ29uZmlnUmVmPy5vdmVycmlkZUNvbmZpZykge1xuICAgICAgICAgICAgICAgIGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnLm1vZGFsQ29uZmlnUmVmIS5vdmVycmlkZUNvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICAgICAgLi4udXNlclJlbGF0aW9uQ29uZmlnLm1vZGFsQ29uZmlnUmVmLm92ZXJyaWRlQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgLi4uZGVmYXVsdEZpbHRlcnMsXG4gICAgICAgICAgICAgICAgICAgICAgICAuLi4odXNlclJlbGF0aW9uQ29uZmlnLm1vZGFsQ29uZmlnUmVmLm92ZXJyaWRlQ29uZmlnLmRlZmF1bHRGaWx0ZXJzIHx8IHt9KVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZm9ybWF0dGVkWyAncmVsYXRpb25Db25maWcnIF0gPSBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZztcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIEhhbmRsZSBuZXN0ZWQgc3RydWN0dXJlcyAobWFwIGFuZCBsaXN0IHR5cGVzKVxuICAgIGlmICh0aGlzUHJvcC50eXBlID09PSAnbWFwJyAmJiB0aGlzUHJvcC5wcm9wZXJ0aWVzKSB7XG4gICAgICAgIGZvcm1hdHRlZFsgJ3Byb3BlcnRpZXMnIF0gPSBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRm9ybU9yRGV0YWlsKHRoaXNQcm9wLnByb3BlcnRpZXMsIHR5cGUsIGVudGl0eVNlcnZpY2UpO1xuICAgIH0gZWxzZSBpZiAodGhpc1Byb3AudHlwZSA9PT0gJ2xpc3QnKSB7XG4gICAgICAgIC8vIEZvciBsaXN0IHR5cGVzLCBjaGVjayBpZiBpdGVtcyBhcmUgbWFwcyAobmVzdGVkIHN0cnVjdHVyZXMpXG4gICAgICAgIC8vIE5vdGU6IGl0ZW1zIHByb3BlcnR5IGV4aXN0cyBvbiBsaXN0LXR5cGUgYXR0cmlidXRlcyBidXQgbm90IGluIGJhc2UgRW50aXR5QXR0cmlidXRlIHR5cGVcbiAgICAgICAgY29uc3QgZXh0ZW5kZWRQcm9wID0gdGhpc1Byb3AgYXMgVElPU2NoZW1hQXR0cmlidXRlICYgeyBpdGVtcz86IHsgdHlwZTogc3RyaW5nOyBwcm9wZXJ0aWVzPzogVElPU2NoZW1hQXR0cmlidXRlW10gfSB9O1xuICAgICAgICBpZiAoZXh0ZW5kZWRQcm9wLml0ZW1zPy50eXBlID09PSAnbWFwJyAmJiBleHRlbmRlZFByb3AuaXRlbXMucHJvcGVydGllcykge1xuICAgICAgICAgICAgZm9ybWF0dGVkWyAnaXRlbXMnIF0gPSB7XG4gICAgICAgICAgICAgICAgLi4uZm9ybWF0dGVkWyAnaXRlbXMnIF0sXG4gICAgICAgICAgICAgICAgcHJvcGVydGllczogZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckZvcm1PckRldGFpbChleHRlbmRlZFByb3AuaXRlbXMucHJvcGVydGllcywgdHlwZSwgZW50aXR5U2VydmljZSlcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBUT0RPOiBhZGQgc3VwcG9ydCBmb3Igc2V0LCBlbnVtLCBhbmQgY3VzdG9tLXR5cGVzXG5cbiAgICByZXR1cm4gZm9ybWF0dGVkO1xufVxuXG4vKipcbiAqIFJvdXRlcyBhdHRyaWJ1dGUgZm9ybWF0dGluZyB0byB0aGUgYXBwcm9wcmlhdGUgdHlwZS1zcGVjaWZpYyBmb3JtYXR0ZXIuXG4gKiBcbiAqIENvbnZlbmllbmNlIGZ1bmN0aW9uIHRoYXQgZGVsZWdhdGVzIHRvIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JDcmVhdGUsXG4gKiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yVXBkYXRlLCBvciBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRGV0YWlsIGJhc2VkIG9uIHR5cGUuXG4gKiBcbiAqIEBwYXJhbSBwcm9wZXJ0aWVzIC0gQXJyYXkgb2YgZW50aXR5IGF0dHJpYnV0ZXMgdG8gZm9ybWF0XG4gKiBAcGFyYW0gdHlwZSAtIFBhZ2UgdHlwZTogJ2NyZWF0ZScsICd1cGRhdGUnLCBvciAnZGV0YWlsJ1xuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSBmb3IgYWNjZXNzaW5nIHNjaGVtYXNcbiAqIEByZXR1cm5zIEFycmF5IG9mIGZvcm1hdHRlZCBmaWVsZCBtZXRhZGF0YVxuICogQHRocm93cyBFcnJvciBpZiBpbnZhbGlkIHR5cGUgaXMgcHJvdmlkZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JGb3JtT3JEZXRhaWwoXG4gICAgcHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sXG4gICAgdHlwZTogJ2NyZWF0ZScgfCAndXBkYXRlJyB8ICdkZXRhaWwnLFxuICAgIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT5cbikge1xuXG4gICAgaWYgKHR5cGUgPT09ICdjcmVhdGUnKSB7XG4gICAgICAgIHJldHVybiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yQ3JlYXRlKHByb3BlcnRpZXMsIGVudGl0eVNlcnZpY2UpO1xuICAgIH1cblxuICAgIGlmICh0eXBlID09PSAndXBkYXRlJykge1xuICAgICAgICByZXR1cm4gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvclVwZGF0ZShwcm9wZXJ0aWVzLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICB9XG5cbiAgICBpZiAodHlwZSA9PT0gJ2RldGFpbCcpIHtcbiAgICAgICAgcmV0dXJuIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JEZXRhaWwocHJvcGVydGllcywgZW50aXR5U2VydmljZSk7XG4gICAgfVxuICAgIHRocm93IChgSW52YWxpZCB0eXBlIFske3R5cGV9XSBwcm92aWRlZCB0byBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRm9ybU9yRGV0YWlsYCk7XG59XG5cbi8qKlxuICogRXhwYW5kcyBzaG9ydGhhbmQgZmllbGQgcmVmZXJlbmNlcyBpbnRvIGZ1bGwgUHJvcGVydHlDb25maWcgb2JqZWN0cy5cbiAqIFxuICogKipFbnRlcnByaXNlLUdyYWRlIFBhdHRlcm4gU3VwcG9ydGluZzoqKlxuICogXG4gKiAxLiAqKlN0cmluZyBzaG9ydGhhbmQgKHNjaGVtYSBmaWVsZHMgb25seSk6KiogYCdmaWVsZE5hbWUnYCDihpIgbG9va3MgdXAgaW4gc2NoZW1hLCBleHBhbmRzIHRvIGZ1bGwgY29uZmlnXG4gKiAyLiAqKk9iamVjdCB3aXRoIHNjaGVtYSBmaWVsZDoqKiBgeyBuYW1lOiAnc3RhdHVzJywgZmllbGRUeXBlOiAnYmFkZ2UnIH1gIOKGkiBtZXJnZXMgb3ZlcnJpZGVzIHdpdGggc2NoZW1hIGRlZmF1bHRzXG4gKiAzLiAqKkpTT04gcGF0aCAobmVzdGVkIGRhdGEpOioqIGB7IG5hbWU6ICd1c2VyRW1haWwnLCBjb2x1bW46ICd1c2VyLmVtYWlsJywgbGFiZWw6ICdFbWFpbCcsIGZpZWxkVHlwZTogJ3RleHQnIH1gXG4gKiA0LiAqKk11bHRpcGxlIHJlbmRlcmluZ3M6KiogYHsgbmFtZTogJ3N0YXR1c0JhZGdlJywgY29sdW1uOiAnc3RhdHVzJywgZmllbGRUeXBlOiAnYmFkZ2UnIH1gICsgYHsgbmFtZTogJ3N0YXR1c1RleHQnLCBjb2x1bW46ICdzdGF0dXMnLCBmaWVsZFR5cGU6ICd0ZXh0JyB9YFxuICogNS4gKipDdXN0b20vY29tcHV0ZWQgZmllbGRzOioqIGB7IG5hbWU6ICdjb25maXJtUGFzc3dvcmQnLCBsYWJlbDogJ0NvbmZpcm0nLCBjb2x1bW46ICdjb25maXJtUGFzc3dvcmQnLCBmaWVsZFR5cGU6ICdwYXNzd29yZCcgfWBcbiAqIDYuICoqVmlzaWJpbGl0eSBjb250cm9sOioqIEFsbCBjb25maWdzIHN1cHBvcnQgYHZpc2liaWxpdHk6IFZpc2liaWxpdHlDb25maWdgIGZvciByb2xlLWJhc2VkL2NvbmRpdGlvbmFsIGRpc3BsYXlcbiAqIFxuICogKipLZXkgQ29uY2VwdHM6KipcbiAqIC0gYG5hbWVgOiBVbmlxdWUgVUkgaWRlbnRpZmllciAobXVzdCBiZSB1bmlxdWUgd2l0aGluIGEgc2luZ2xlIHByb3BlcnRpZXNDb25maWcpXG4gKiAtIGBjb2x1bW5gOiBEYXRhIHBhdGggLSBjYW4gYmUgZGlyZWN0IGZpZWxkLCBKU09OIHBhdGggKGB1c2VyLmVtYWlsYCksIG9yIGN1c3RvbSBmaWVsZFxuICogLSBGcm9udGVuZCB1c2VzIGBnZXROZXN0ZWRWYWx1ZShyZWNvcmQsIGNvbHVtbilgIGZvciBkYXRhIGFjY2VzcyAoc3VwcG9ydHMgSlNPTiBwYXRocylcbiAqIFxuICogVGhpcyBpcyB0aGUgcHJvcGVydHkgZXF1aXZhbGVudCBvZiBgbm9ybWFsaXplQ29sdW1uT3ZlcnJpZGVzKClgLlxuICogXG4gKiBAcGFyYW0gZmllbGRSZWZlcmVuY2VzIC0gQXJyYXkgY29udGFpbmluZyBzdHJpbmdzIChmaWVsZCBuYW1lcykgb3IgUHJvcGVydHlDb25maWcgb2JqZWN0c1xuICogQHBhcmFtIGFsbFByb3BlcnRpZXMgLSBBbGwgZW50aXR5IGF0dHJpYnV0ZXMgZnJvbSBzY2hlbWEgZm9yIGZpZWxkIGxvb2t1cFxuICogQHBhcmFtIHR5cGUgLSBQYWdlIHR5cGU6ICdjcmVhdGUnLCAndXBkYXRlJywgb3IgJ2RldGFpbCcgKGRldGVybWluZXMgZm9ybWF0dGluZylcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gRW50aXR5IHNlcnZpY2UgZm9yIGFjY2Vzc2luZyByZWxhdGVkIHNjaGVtYXNcbiAqIEBwYXJhbSBnbG9iYWxVSUNvbmZpZ09wdGlvbnMgLSBPcHRpb25hbCBnbG9iYWwgVUkgY29uZmlndXJhdGlvbiBvcHRpb25zXG4gKiBAcmV0dXJucyBBcnJheSBvZiBmdWxsIFByb3BlcnR5Q29uZmlnIG9iamVjdHNcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIDEuIFN0cmluZyBzaG9ydGhhbmQgKHNjaGVtYSBmaWVsZHMgb25seSlcbiAqIHByb3BlcnRpZXNDb25maWc6IFsndGVhbU5hbWUnLCAnY2l0eScsICdzdGF0dXMnXVxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gMi4gT3ZlcnJpZGUgc2NoZW1hIGZpZWxkIGRpc3BsYXlcbiAqIHByb3BlcnRpZXNDb25maWc6IFtcbiAqICAgJ3RlYW1OYW1lJyxcbiAqICAgeyBuYW1lOiAnc3RhdHVzJywgZmllbGRUeXBlOiAnYmFkZ2UnIH0sICAvLyBTYW1lIGZpZWxkLCBkaWZmZXJlbnQgcmVuZGVyaW5nXG4gKiAgICd0b3RhbCdcbiAqIF1cbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIDMuIE11bHRpcGxlIHJlbmRlcmluZ3Mgb2Ygc2FtZSBmaWVsZFxuICogcHJvcGVydGllc0NvbmZpZzogW1xuICogICB7IG5hbWU6ICdwcm9ncmVzc0JhcicsIGNvbHVtbjogJ3Byb2dyZXNzJywgbGFiZWw6ICdQcm9ncmVzcycsIGZpZWxkVHlwZTogJ3Byb2dyZXNzJyB9LFxuICogICB7IG5hbWU6ICdwcm9ncmVzc1ZhbHVlJywgY29sdW1uOiAncHJvZ3Jlc3MnLCBsYWJlbDogJ1ZhbHVlJywgZmllbGRUeXBlOiAnbnVtYmVyJyB9XG4gKiBdXG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyA0LiBKU09OIHBhdGhzIChuZXN0ZWQgZGF0YSlcbiAqIHByb3BlcnRpZXNDb25maWc6IFtcbiAqICAgJ3RlYW1OYW1lJyxcbiAqICAgeyBuYW1lOiAndXNlckVtYWlsJywgY29sdW1uOiAndXNlci5lbWFpbCcsIGxhYmVsOiAnRW1haWwnLCBmaWVsZFR5cGU6ICd0ZXh0JyB9LFxuICogICB7IG5hbWU6ICdzZXR0aW5nc1RoZW1lJywgY29sdW1uOiAnbWV0YWRhdGEuc2V0dGluZ3MudGhlbWUnLCBsYWJlbDogJ1RoZW1lJywgZmllbGRUeXBlOiAndGV4dCcgfVxuICogXVxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gNS4gQ3VzdG9tL2NvbXB1dGVkIGZpZWxkcyAobm90IGluIHNjaGVtYSwgQVBJIHByb3ZpZGVzIHRoZW0pXG4gKiBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gKiAgICdwYXNzd29yZCcsXG4gKiAgIHtcbiAqICAgICBuYW1lOiAnY29uZmlybVBhc3N3b3JkJyxcbiAqICAgICBsYWJlbDogJ0NvbmZpcm0gUGFzc3dvcmQnLFxuICogICAgIGNvbHVtbjogJ2NvbmZpcm1QYXNzd29yZCcsXG4gKiAgICAgZmllbGRUeXBlOiAncGFzc3dvcmQnLFxuICogICAgIHJlcXVpcmVkOiB0cnVlXG4gKiAgIH1cbiAqIF1cbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIDYuIFdpdGggdmlzaWJpbGl0eSBjb25maWdcbiAqIHByb3BlcnRpZXNDb25maWc6IFtcbiAqICAgJ3RlYW1OYW1lJyxcbiAqICAge1xuICogICAgIG5hbWU6ICdhZG1pbk5vdGVzJyxcbiAqICAgICBsYWJlbDogJ0FkbWluIE5vdGVzJyxcbiAqICAgICBjb2x1bW46ICdhZG1pbk5vdGVzJyxcbiAqICAgICBmaWVsZFR5cGU6ICd0ZXh0YXJlYScsXG4gKiAgICAgdmlzaWJpbGl0eTogeyByZXF1aXJlZFJvbGVzOiBbJ2FkbWluJ10gfVxuICogICB9XG4gKiBdXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHBhbmRQcm9wZXJ0eVJlZmVyZW5jZXMoXG4gICAgZmllbGRSZWZlcmVuY2VzOiBSZWFkb25seUFycmF5PHN0cmluZyB8IGFueT4gfCBBcnJheTxzdHJpbmcgfCBhbnk+LFxuICAgIGFsbFByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLFxuICAgIHR5cGU6ICdjcmVhdGUnIHwgJ3VwZGF0ZScgfCAnZGV0YWlsJyxcbiAgICBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+LFxuICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sgJ3VpQ29uZmlnR2VuT3B0aW9ucycgXVxuKTogYW55W10ge1xuICAgIGNvbnN0IHByb3BlcnR5TWFwID0gbmV3IE1hcDxzdHJpbmcsIFRJT1NjaGVtYUF0dHJpYnV0ZT4oKTtcbiAgICBhbGxQcm9wZXJ0aWVzLmZvckVhY2gocHJvcCA9PiB7XG4gICAgICAgIGlmIChwcm9wLmlkKSB7IC8vIFVzZSBwcm9wLmlkIChmaWVsZCBpZGVudGlmaWVyKSBub3QgcHJvcC5uYW1lIChodW1hbi1yZWFkYWJsZSBsYWJlbClcbiAgICAgICAgICAgIHByb3BlcnR5TWFwLnNldChwcm9wLmlkLCBwcm9wKTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGZpZWxkUmVmZXJlbmNlcy5tYXAocHJvcFJlZiA9PiB7XG4gICAgICAgIC8vIENhc2UgMTogU3RyaW5nIHNob3J0aGFuZCDihpIgTVVTVCBiZSBhIGRpcmVjdCBzY2hlbWEgZmllbGQgKGNvbnZlbmllbmNlIHNob3J0Y3V0KVxuICAgICAgICBpZiAodHlwZW9mIHByb3BSZWYgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICBjb25zdCBmaWVsZEF0dHJpYnV0ZSA9IHByb3BlcnR5TWFwLmdldChwcm9wUmVmKTtcbiAgICAgICAgICAgIGlmICghZmllbGRBdHRyaWJ1dGUpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgICAgICAgIGBGaWVsZCAnJHtwcm9wUmVmfScgbm90IGZvdW5kIGluIGVudGl0eSBzY2hlbWEuIGAgK1xuICAgICAgICAgICAgICAgICAgICBgQXZhaWxhYmxlIGZpZWxkIElEczogJHtBcnJheS5mcm9tKHByb3BlcnR5TWFwLmtleXMoKSkuam9pbignLCAnKX0uIGAgK1xuICAgICAgICAgICAgICAgICAgICBgXFxuRm9yIG5vbi1zY2hlbWEgZmllbGRzIChKU09OIHBhdGhzLCBjdXN0b20gZmllbGRzLCBtdWx0aXBsZSByZW5kZXJpbmdzKSwgdXNlIG9iamVjdCBzeW50YXg6XFxuYCArXG4gICAgICAgICAgICAgICAgICAgIGAgIHsgbmFtZTogJ3VuaXF1ZU5hbWUnLCBjb2x1bW46ICcke3Byb3BSZWZ9JywgbGFiZWw6ICcuLi4nLCBmaWVsZFR5cGU6ICcuLi4nIH1gXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoZmllbGRBdHRyaWJ1dGUsIHR5cGUsIGVudGl0eVNlcnZpY2UsIGFsbFByb3BlcnRpZXMsIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDYXNlIDItNTogT2JqZWN0IHN5bnRheCAocGVybWlzc2l2ZSAtIHN1cHBvcnRzIGV2ZXJ5dGhpbmcpXG4gICAgICAgIGlmICh0eXBlb2YgcHJvcFJlZiA9PT0gJ29iamVjdCcgJiYgcHJvcFJlZiAhPT0gbnVsbCkge1xuICAgICAgICAgICAgLy8gVmFsaWRhdGUgbWluaW11bSByZXF1aXJlZCBwcm9wZXJ0aWVzXG4gICAgICAgICAgICBpZiAoIXByb3BSZWYubmFtZSkge1xuICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgUHJvcGVydHkgY29uZmlnIG1pc3NpbmcgJ25hbWUnIGZpZWxkIChyZXF1aXJlZCBmb3IgVUkgaWRlbnRpZmljYXRpb24pLiBTa2lwcGluZzpgLCBwcm9wUmVmKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gcHJvcFJlZjsgLy8gUmV0dXJuIGFzLWlzLCBsZXQgZnJvbnRlbmQgaGFuZGxlXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIERldGVybWluZSB0aGUgZGF0YSBwYXRoIChjb2x1bW4gY2FuIGJlOiBkaXJlY3QgZmllbGQsIEpTT04gcGF0aCwgb3IgY3VzdG9tIGZpZWxkKVxuICAgICAgICAgICAgY29uc3QgY29sdW1uID0gcHJvcFJlZi5jb2x1bW4gfHwgcHJvcFJlZi5uYW1lO1xuXG4gICAgICAgICAgICAvLyBFeHRyYWN0IGp1c3QgdGhlIHJvb3QgZmllbGQgbmFtZSBmb3Igc2NoZW1hIGxvb2t1cCAoaGFuZGxlcyBKU09OIHBhdGhzIGxpa2UgXCJ1c2VyLmVtYWlsXCIg4oaSIFwidXNlclwiKVxuICAgICAgICAgICAgY29uc3Qgcm9vdEZpZWxkTmFtZSA9IGNvbHVtbi5zcGxpdCgnLicpWyAwIF07XG4gICAgICAgICAgICBjb25zdCBmaWVsZEF0dHJpYnV0ZSA9IHByb3BlcnR5TWFwLmdldChyb290RmllbGROYW1lKTtcblxuICAgICAgICAgICAgLy8gSWYgcm9vdCBmaWVsZCBleGlzdHMgaW4gc2NoZW1hIEFORCBjb2x1bW4gaXMgdGhlIGV4YWN0IGZpZWxkIChub3QgYSBwYXRoKSwgbWVyZ2Ugd2l0aCBzY2hlbWFcbiAgICAgICAgICAgIGlmIChmaWVsZEF0dHJpYnV0ZSAmJiBjb2x1bW4gPT09IHJvb3RGaWVsZE5hbWUpIHtcbiAgICAgICAgICAgICAgICAvLyBTY2hlbWEgZmllbGQgd2l0aCBvdmVycmlkZXMgLSBtZXJnZSBkZWZhdWx0cyArIG92ZXJyaWRlc1xuICAgICAgICAgICAgICAgIGNvbnN0IHNjaGVtYURlZmF1bHRzID0gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKGZpZWxkQXR0cmlidXRlLCB0eXBlLCBlbnRpdHlTZXJ2aWNlLCBhbGxQcm9wZXJ0aWVzLCBnbG9iYWxVSUNvbmZpZ09wdGlvbnMpO1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIC4uLnNjaGVtYURlZmF1bHRzLFxuICAgICAgICAgICAgICAgICAgICAuLi5wcm9wUmVmLCAgLy8gVXNlciBvdmVycmlkZXMgdGFrZSBwcmVjZWRlbmNlXG4gICAgICAgICAgICAgICAgICAgIGNvbHVtbiAgLy8gRW5zdXJlIGNvbHVtbiBpcyBzZXRcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBPdGhlcndpc2U6IEpTT04gcGF0aCwgY3VzdG9tIGZpZWxkLCBvciBtdWx0aXBsZSByZW5kZXJpbmcgb2Ygc2FtZSBmaWVsZFxuICAgICAgICAgICAgLy8gQXV0by1nZW5lcmF0ZSBtaXNzaW5nIHByb3BlcnRpZXMgd2l0aCBwcm9wZXIgZm9ybWF0dGluZ1xuICAgICAgICAgICAgY29uc3QgbGFiZWwgPSBwcm9wUmVmLmxhYmVsIHx8IHRvSHVtYW5SZWFkYWJsZU5hbWUocHJvcFJlZi5uYW1lKTtcbiAgICAgICAgICAgIGNvbnN0IGZpZWxkVHlwZSA9IHByb3BSZWYuZmllbGRUeXBlIHx8ICd0ZXh0JztcblxuICAgICAgICAgICAgLy8gV2FybiBpZiBsYWJlbCB3YXMgYXV0by1nZW5lcmF0ZWRcbiAgICAgICAgICAgIGlmICghcHJvcFJlZi5sYWJlbCkge1xuICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIuZGVidWcoXG4gICAgICAgICAgICAgICAgICAgIGBQcm9wZXJ0eSAnJHtwcm9wUmVmLm5hbWV9JyBtaXNzaW5nICdsYWJlbCcuIEF1dG8tZ2VuZXJhdGVkOiAnJHtsYWJlbH0nLiBgICtcbiAgICAgICAgICAgICAgICAgICAgYEZvciBjdXN0b20gZmllbGRzLCBleHBsaWNpdGx5IHByb3ZpZGU6IG5hbWUsIGxhYmVsLCBjb2x1bW4sIGZpZWxkVHlwZS5gXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghcHJvcFJlZi5maWVsZFR5cGUpIHtcbiAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLmRlYnVnKFxuICAgICAgICAgICAgICAgICAgICBgUHJvcGVydHkgJyR7cHJvcFJlZi5uYW1lfScgbWlzc2luZyAnZmllbGRUeXBlJy4gRGVmYXVsdGVkIHRvICd0ZXh0Jy4gYCArXG4gICAgICAgICAgICAgICAgICAgIGBSZWNvbW1lbmRlZCBmaWVsZCB0eXBlczogdGV4dCwgbnVtYmVyLCBzZWxlY3QsIGJhZGdlLCBwcm9ncmVzcywgZXRjLmBcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBSZXR1cm4gd2l0aCBwcm9wZXIgZm9ybWF0dGluZ1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAuLi5wcm9wUmVmLFxuICAgICAgICAgICAgICAgIGNvbHVtbixcbiAgICAgICAgICAgICAgICBsYWJlbCxcbiAgICAgICAgICAgICAgICBmaWVsZFR5cGVcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGYWxsYmFjazogdW5rbm93biB0eXBlLCByZXR1cm4gYXMtaXMgd2l0aCB3YXJuaW5nXG4gICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgVW5rbm93biBwcm9wZXJ0eSByZWZlcmVuY2UgdHlwZTpgLCBwcm9wUmVmKTtcbiAgICAgICAgcmV0dXJuIHByb3BSZWY7XG4gICAgfSk7XG59XG5cbi8qKlxuICogUHJvY2Vzc2VzIHNlY3Rpb25zQ29uZmlnIGFuZCBleHBhbmRzIGFueSBzaG9ydGhhbmQgcHJvcGVydGllc0NvbmZpZyBhcnJheXMuXG4gKiBcbiAqICoqVW5pZmllZCB3aXRoIGNvbHVtbiBwcm9jZXNzaW5nOioqXG4gKiAtIFVzZXMgYGV4cGFuZFByb3BlcnR5UmVmZXJlbmNlcygpYCAoc2FtZSBwYXR0ZXJuIGFzIGBub3JtYWxpemVDb2x1bW5PdmVycmlkZXMoKWApXG4gKiAtIFN0cmluZyBzaG9ydGhhbmQgYCdmaWVsZE5hbWUnYCDihpIgZXhwYW5kcyBmcm9tIHNjaGVtYVxuICogLSBPYmplY3Qgc3ludGF4IOKGkiBtZXJnZXMgd2l0aCBzY2hlbWEgZGVmYXVsdHNcbiAqIFxuICogUmVjdXJzaXZlbHkgd2Fsa3MgdGhyb3VnaCBzZWN0aW9uIGdyb3VwcyBhbmQgc2VjdGlvbnMuXG4gKiBcbiAqIEBwYXJhbSBzZWN0aW9uc0NvbmZpZyAtIFNlY3Rpb25zIGNvbmZpZ3VyYXRpb24gZnJvbSBlbnRpdHkgc2NoZW1hXG4gKiBAcGFyYW0gYWxsUHJvcGVydGllcyAtIEFsbCBlbnRpdHkgYXR0cmlidXRlcyBmcm9tIHNjaGVtYSBmb3IgZmllbGQgbG9va3VwXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIGZvciBhY2Nlc3NpbmcgcmVsYXRlZCBzY2hlbWFzXG4gKiBAcGFyYW0gZ2xvYmFsVUlDb25maWdPcHRpb25zIC0gT3B0aW9uYWwgZ2xvYmFsIFVJIGNvbmZpZ3VyYXRpb24gb3B0aW9uc1xuICogQHJldHVybnMgUHJvY2Vzc2VkIHNlY3Rpb25zIGNvbmZpZyB3aXRoIGV4cGFuZGVkIHByb3BlcnRpZXNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHByb2Nlc3NTZWN0aW9uc0NvbmZpZyhcbiAgICBzZWN0aW9uc0NvbmZpZzogYW55LFxuICAgIGFsbFByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLFxuICAgIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sXG4gICAgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyAndWlDb25maWdHZW5PcHRpb25zJyBdXG4pOiBhbnkge1xuICAgIGlmICghc2VjdGlvbnNDb25maWcpIHJldHVybiBzZWN0aW9uc0NvbmZpZztcblxuICAgIGNvbnN0IHByb2Nlc3NlZCA9IHsgLi4uc2VjdGlvbnNDb25maWcgfTtcblxuICAgIC8vIFByb2Nlc3Mgc2VjdGlvbnMgaW4gc2luZ2xlIGdyb3VwIGZvcm1hdCAoYmFja3dhcmQgY29tcGF0aWJsZSlcbiAgICBpZiAocHJvY2Vzc2VkLnNlY3Rpb25zKSB7XG4gICAgICAgIHByb2Nlc3NlZC5zZWN0aW9ucyA9IE9iamVjdC5lbnRyaWVzKHByb2Nlc3NlZC5zZWN0aW9ucykucmVkdWNlKChhY2MsIFsga2V5LCBzZWN0aW9uIF06IFsgc3RyaW5nLCBhbnkgXSkgPT4ge1xuICAgICAgICAgICAgYWNjWyBrZXkgXSA9IHByb2Nlc3NTZWN0aW9uQ29uZmlnKHNlY3Rpb24sIGFsbFByb3BlcnRpZXMsIGVudGl0eVNlcnZpY2UsIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyk7XG4gICAgICAgICAgICByZXR1cm4gYWNjO1xuICAgICAgICB9LCB7fSBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+KTtcbiAgICB9XG5cbiAgICAvLyBQcm9jZXNzIHNlY3Rpb24gZ3JvdXBzIChuZXcgZm9ybWF0KVxuICAgIGlmIChwcm9jZXNzZWQuc2VjdGlvbkdyb3Vwcykge1xuICAgICAgICBwcm9jZXNzZWQuc2VjdGlvbkdyb3VwcyA9IHByb2Nlc3NlZC5zZWN0aW9uR3JvdXBzLm1hcCgoZ3JvdXA6IGFueSkgPT4ge1xuICAgICAgICAgICAgaWYgKCFncm91cC5zZWN0aW9ucykgcmV0dXJuIGdyb3VwO1xuXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIC4uLmdyb3VwLFxuICAgICAgICAgICAgICAgIHNlY3Rpb25zOiBPYmplY3QuZW50cmllcyhncm91cC5zZWN0aW9ucykucmVkdWNlKChhY2MsIFsga2V5LCBzZWN0aW9uIF06IFsgc3RyaW5nLCBhbnkgXSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBhY2NbIGtleSBdID0gcHJvY2Vzc1NlY3Rpb25Db25maWcoc2VjdGlvbiwgYWxsUHJvcGVydGllcywgZW50aXR5U2VydmljZSwgZ2xvYmFsVUlDb25maWdPcHRpb25zKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGFjYztcbiAgICAgICAgICAgICAgICB9LCB7fSBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+KVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHByb2Nlc3NlZDtcbn1cblxuLyoqXG4gKiBQcm9jZXNzZXMgYSBzaW5nbGUgc2VjdGlvbiBjb25maWcgYW5kIGV4cGFuZHMgc2hvcnRoYW5kIHByb3BlcnRpZXNDb25maWcuXG4gKiBcbiAqIFVzZXMgdW5pZmllZCBgZXhwYW5kUHJvcGVydHlSZWZlcmVuY2VzKClgIGZ1bmN0aW9uLlxuICogXG4gKiBAcGFyYW0gc2VjdGlvbiAtIFNlY3Rpb24gY29uZmlndXJhdGlvblxuICogQHBhcmFtIGFsbFByb3BlcnRpZXMgLSBBbGwgZW50aXR5IGF0dHJpYnV0ZXMgZnJvbSBzY2hlbWFcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gRW50aXR5IHNlcnZpY2VcbiAqIEBwYXJhbSBnbG9iYWxVSUNvbmZpZ09wdGlvbnMgLSBPcHRpb25hbCBnbG9iYWwgVUkgY29uZmlndXJhdGlvbiBvcHRpb25zXG4gKiBAcmV0dXJucyBQcm9jZXNzZWQgc2VjdGlvbiB3aXRoIGV4cGFuZGVkIHByb3BlcnRpZXNcbiAqL1xuZnVuY3Rpb24gcHJvY2Vzc1NlY3Rpb25Db25maWcoXG4gICAgc2VjdGlvbjogYW55LFxuICAgIGFsbFByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLFxuICAgIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sXG4gICAgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyAndWlDb25maWdHZW5PcHRpb25zJyBdXG4pOiBhbnkge1xuICAgIGNvbnN0IHByb2Nlc3NlZCA9IHsgLi4uc2VjdGlvbiB9O1xuXG4gICAgLy8gUHJvY2VzcyBkZXRhaWxzUGFnZUNvbmZpZyB3aXRoIHByb3BlcnRpZXNDb25maWdcbiAgICBpZiAocHJvY2Vzc2VkLnBhZ2VUeXBlID09PSAnZGV0YWlscycgJiYgcHJvY2Vzc2VkLmRldGFpbHNQYWdlQ29uZmlnPy5wcm9wZXJ0aWVzQ29uZmlnKSB7XG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IHByb2Nlc3NlZC5kZXRhaWxzUGFnZUNvbmZpZztcbiAgICAgICAgcHJvY2Vzc2VkLmRldGFpbHNQYWdlQ29uZmlnID0ge1xuICAgICAgICAgICAgLi4uY29uZmlnLFxuICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogZXhwYW5kUHJvcGVydHlSZWZlcmVuY2VzKFxuICAgICAgICAgICAgICAgIGNvbmZpZy5wcm9wZXJ0aWVzQ29uZmlnLFxuICAgICAgICAgICAgICAgIGFsbFByb3BlcnRpZXMsXG4gICAgICAgICAgICAgICAgJ2RldGFpbCcsXG4gICAgICAgICAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgICAgICAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnNcbiAgICAgICAgICAgIClcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBQcm9jZXNzIGZvcm1QYWdlQ29uZmlnXG4gICAgaWYgKHByb2Nlc3NlZC5wYWdlVHlwZSA9PT0gJ2Zvcm0nICYmIHByb2Nlc3NlZC5mb3JtUGFnZUNvbmZpZz8ucHJvcGVydGllc0NvbmZpZykge1xuICAgICAgICBjb25zdCBjb25maWcgPSBwcm9jZXNzZWQuZm9ybVBhZ2VDb25maWc7XG4gICAgICAgIC8vIEZvcm1zIGluIHNlY3Rpb25zIGFyZSB0eXBpY2FsbHkgJ2NyZWF0ZScgZm9ybXNcbiAgICAgICAgcHJvY2Vzc2VkLmZvcm1QYWdlQ29uZmlnID0ge1xuICAgICAgICAgICAgLi4uY29uZmlnLFxuICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogZXhwYW5kUHJvcGVydHlSZWZlcmVuY2VzKFxuICAgICAgICAgICAgICAgIGNvbmZpZy5wcm9wZXJ0aWVzQ29uZmlnLFxuICAgICAgICAgICAgICAgIGFsbFByb3BlcnRpZXMsXG4gICAgICAgICAgICAgICAgJ2NyZWF0ZScsXG4gICAgICAgICAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgICAgICAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnNcbiAgICAgICAgICAgIClcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICByZXR1cm4gcHJvY2Vzc2VkO1xufVxuXG4vKipcbiAqIEZvcm1hdHMgZW50aXR5IGF0dHJpYnV0ZXMgZm9yIGNyZWF0ZSBmb3JtIHBhZ2VzLlxuICogXG4gKiBGaWx0ZXJzIGF0dHJpYnV0ZXMgdG8gaW5jbHVkZSBvbmx5IGNyZWF0YWJsZSBmaWVsZHMgKHJlc3BlY3RzIGlzQ3JlYXRhYmxlIGZsYWcpXG4gKiBhbmQgZm9ybWF0cyBlYWNoIGZvciBjcmVhdGUgZm9ybSBkaXNwbGF5LlxuICogXG4gKiBAcGFyYW0gcHJvcGVydGllcyAtIEFycmF5IG9mIGVudGl0eSBhdHRyaWJ1dGVzIGZyb20gc2NoZW1hXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIGZvciBhY2Nlc3NpbmcgcmVsYXRlZCBzY2hlbWFzXG4gKiBAcGFyYW0gZ2xvYmFsVUlDb25maWdPcHRpb25zIC0gT3B0aW9uYWwgZ2xvYmFsIFVJIGNvbmZpZ3VyYXRpb24gb3B0aW9uc1xuICogQHJldHVybnMgQXJyYXkgb2YgZm9ybWF0dGVkIGZpZWxkIG1ldGFkYXRhIGZvciBjcmVhdGUgZm9ybXNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JDcmVhdGUocHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sgJ3VpQ29uZmlnR2VuT3B0aW9ucycgXSkge1xuICAgIHJldHVybiBwcm9wZXJ0aWVzXG4gICAgICAgIC5maWx0ZXIocHJvcCA9PiBwcm9wICYmICghcHJvcC5oYXNPd25Qcm9wZXJ0eSgnaXNDcmVhdGFibGUnKSB8fCBwcm9wLmlzQ3JlYXRhYmxlKSlcbiAgICAgICAgLm1hcCgoYXR0KSA9PiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoYXR0LCAnY3JlYXRlJywgZW50aXR5U2VydmljZSwgcHJvcGVydGllcywgZ2xvYmFsVUlDb25maWdPcHRpb25zKSk7XG59XG5cbi8qKlxuICogRm9ybWF0cyBlbnRpdHkgYXR0cmlidXRlcyBmb3IgdXBkYXRlL2VkaXQgZm9ybSBwYWdlcy5cbiAqIFxuICogRmlsdGVycyBhdHRyaWJ1dGVzIHRvIGluY2x1ZGUgb25seSBlZGl0YWJsZSBmaWVsZHMgKHJlc3BlY3RzIGlzRWRpdGFibGUgZmxhZylcbiAqIGFuZCBmb3JtYXRzIGVhY2ggZm9yIHVwZGF0ZSBmb3JtIGRpc3BsYXkuXG4gKiBcbiAqIEBwYXJhbSBwcm9wZXJ0aWVzIC0gQXJyYXkgb2YgZW50aXR5IGF0dHJpYnV0ZXMgZnJvbSBzY2hlbWFcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gRW50aXR5IHNlcnZpY2UgZm9yIGFjY2Vzc2luZyByZWxhdGVkIHNjaGVtYXNcbiAqIEBwYXJhbSBnbG9iYWxVSUNvbmZpZ09wdGlvbnMgLSBPcHRpb25hbCBnbG9iYWwgVUkgY29uZmlndXJhdGlvbiBvcHRpb25zXG4gKiBAcmV0dXJucyBBcnJheSBvZiBmb3JtYXR0ZWQgZmllbGQgbWV0YWRhdGEgZm9yIHVwZGF0ZSBmb3Jtc1xuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvclVwZGF0ZShwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSwgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PiwgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyAndWlDb25maWdHZW5PcHRpb25zJyBdKSB7XG4gICAgcmV0dXJuIHByb3BlcnRpZXNcbiAgICAgICAgLmZpbHRlcihwcm9wID0+IHByb3AgJiYgKCFwcm9wLmhhc093blByb3BlcnR5KCdpc0VkaXRhYmxlJykgfHwgcHJvcC5pc0VkaXRhYmxlKSlcbiAgICAgICAgLm1hcCgoYXR0KSA9PiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoYXR0LCAndXBkYXRlJywgZW50aXR5U2VydmljZSwgcHJvcGVydGllcywgZ2xvYmFsVUlDb25maWdPcHRpb25zKSk7XG59XG5cbi8qKlxuICogRm9ybWF0cyBlbnRpdHkgYXR0cmlidXRlcyBmb3IgZGV0YWlsL3ZpZXcgcGFnZXMuXG4gKiBcbiAqIEZpbHRlcnMgYXR0cmlidXRlcyB0byBpbmNsdWRlIG9ubHkgdmlzaWJsZSBmaWVsZHMgKHJlc3BlY3RzIGlzVmlzaWJsZSBmbGFnKVxuICogYW5kIGZvcm1hdHMgZWFjaCBmb3IgZGV0YWlsIHBhZ2UgZGlzcGxheS5cbiAqIFxuICogQHBhcmFtIHByb3BlcnRpZXMgLSBBcnJheSBvZiBlbnRpdHkgYXR0cmlidXRlcyBmcm9tIHNjaGVtYVxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSBmb3IgYWNjZXNzaW5nIHJlbGF0ZWQgc2NoZW1hc1xuICogQHBhcmFtIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyAtIE9wdGlvbmFsIGdsb2JhbCBVSSBjb25maWd1cmF0aW9uIG9wdGlvbnNcbiAqIEByZXR1cm5zIEFycmF5IG9mIGZvcm1hdHRlZCBmaWVsZCBtZXRhZGF0YSBmb3IgZGV0YWlsIHZpZXdzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRGV0YWlsKHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLCBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+LCBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbICd1aUNvbmZpZ0dlbk9wdGlvbnMnIF0pIHtcbiAgICByZXR1cm4gcHJvcGVydGllc1xuICAgICAgICAuZmlsdGVyKHByb3AgPT4gcHJvcCAmJiAoIXByb3AuaGFzT3duUHJvcGVydHkoJ2lzVmlzaWJsZScpIHx8IHByb3AuaXNWaXNpYmxlKSlcbiAgICAgICAgLm1hcCgoYXR0KSA9PiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoYXR0LCAnZGV0YWlsJywgZW50aXR5U2VydmljZSwgcHJvcGVydGllcywgZ2xvYmFsVUlDb25maWdPcHRpb25zKSk7XG59XG5cbi8qKlxuICogVHlwZSBkZWZpbml0aW9uIGZvciBsaXN0L3RhYmxlIGNvbHVtbiBjb25maWd1cmF0aW9uLlxuICogXG4gKiBFeHRlbmRzIEZpZWxkTWV0YWRhdGEgd2l0aCBsaXN0LXNwZWNpZmljIHByb3BlcnRpZXMgbGlrZSBhY3Rpb25zLCB0ZW1wbGF0ZXMsXG4gKiBhbmQgcmVsYXRpb24gcmVuZGVyaW5nIGNvbmZpZ3VyYXRpb25zLlxuICovXG5leHBvcnQgdHlwZSBMaXN0aW5nUHJvcENvbmZpZyA9IFBpY2s8RmllbGRNZXRhZGF0YSwgJ2ZpZWxkVHlwZScgfCAncGxhY2Vob2xkZXInIHwgJ2hlbHBUZXh0JyB8ICdmaWx0ZXJDb25maWcnPiAmIHtcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgZGF0YUluZGV4OiBzdHJpbmcsXG4gICAgaGlkZGVuPzogYm9vbGVhbixcbiAgICBhY3Rpb25zPzogQXJyYXk8SUVudGl0eVBhZ2VBY3Rpb24+LFxuICAgIHJlbGF0aW9uQ29uZmlnPzogSVJlbGF0aW9uRmllbGRDb25maWcsICAvLyBGb3IgcmVuZGVyaW5nIHJlbGF0aW9ucyB3aXRoIGxpbmtzL21vZGFsc1xuICAgIHRlbXBsYXRlPzogVGVtcGxhdGUsICAvLyBGb3IgdGVtcGxhdGUtYmFzZWQgcmVuZGVyaW5nXG4gICAgaXNJZGVudGlmaWVyPzogYm9vbGVhbiwgIC8vIEZvciBpZGVudGlmaWVyIGZpZWxkc1xuICAgIGlzTGluaz86IGJvb2xlYW4sICAvLyBGb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxuICAgIGxpbmtDb25maWc/OiB7IHJvdXRlUGF0dGVybjogc3RyaW5nOyBkaXNwbGF5VGV4dD86IHN0cmluZyB9LCAgLy8gRm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbn07XG5cbi8qKlxuICogRm9ybWF0cyBlbnRpdHkgYXR0cmlidXRlcyBmb3IgbGlzdC90YWJsZSBkaXNwbGF5LlxuICogXG4gKiBUcmFuc2Zvcm1zIHNjaGVtYSBhdHRyaWJ1dGVzIGludG8gdGFibGUgY29sdW1uIGNvbmZpZ3VyYXRpb25zIHdpdGg6XG4gKiAtIEF1dG8tZ2VuZXJhdGVkIGZpbHRlciBjb25maWd1cmF0aW9ucyBmb3IgZmlsdGVyYWJsZSBjb2x1bW5zXG4gKiAtIFJlbGF0aW9uIGRpc3BsYXkgY29uZmlndXJhdGlvbnMgd2l0aCBsaW5rcyBhbmQgbW9kYWwgc3VwcG9ydFxuICogLSBUZW1wbGF0ZS1iYXNlZCByZW5kZXJpbmcgZm9yIGR1cGxpY2F0ZWQgcmVsYXRpb24gZmllbGRzXG4gKiAtIFByb3BlciBmaWVsZCB0eXBlcyBhbmQgdmlzaWJpbGl0eSBoYW5kbGluZ1xuICogXG4gKiBUaGlzIGlzIHRoZSBtYWluIGVudHJ5IHBvaW50IGZvciBnZW5lcmF0aW5nIHRhYmxlIGNvbHVtbiBjb25maWd1cmF0aW9ucyBmcm9tIGVudGl0eSBzY2hlbWFzLlxuICogXG4gKiBAcGFyYW0gZW50aXR5TmFtZSAtIE5hbWUgb2YgdGhlIGVudGl0eSAoZm9yIGdlbmVyYXRpbmcgcm91dGUgcGF0dGVybnMpXG4gKiBAcGFyYW0gcHJvcGVydGllcyAtIEFycmF5IG9mIGVudGl0eSBhdHRyaWJ1dGVzIGZyb20gc2NoZW1hXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIGZvciBhY2Nlc3NpbmcgcmVsYXRlZCBzY2hlbWFzXG4gKiBAcGFyYW0gZ2xvYmFsVUlDb25maWdPcHRpb25zIC0gT3B0aW9uYWwgZ2xvYmFsIFVJIGNvbmZpZ3VyYXRpb24gb3B0aW9uc1xuICogQHJldHVybnMgQXJyYXkgb2YgZm9ybWF0dGVkIGNvbHVtbiBjb25maWd1cmF0aW9ucyBmb3IgdGFibGUgZGlzcGxheVxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY29uc3QgY29sdW1ucyA9IGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JMaXN0KFxuICogICAnZ2FtZScsXG4gKiAgIGdhbWVTY2hlbWEuYXR0cmlidXRlcyxcbiAqICAgZ2FtZVNlcnZpY2UsXG4gKiAgIGdsb2JhbENvbmZpZ1xuICogKTtcbiAqIC8vIFJldHVybnMgYXJyYXkgb2YgY29sdW1uIGNvbmZpZ3Mgd2l0aCBmaWx0ZXJzLCByZWxhdGlvbnMsIGFuZCB0ZW1wbGF0ZXNcbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlc0Zvckxpc3QoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLFxuICAgIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sXG4gICAge1xuICAgICAgICBDUlVEQXBpUGF0aCxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pblVwZGF0ZSxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pbkRlbGV0ZSxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pbkRldGFpbCxcbiAgICAgICAgY3VzdG9tUm93QWN0aW9ucyxcbiAgICAgICAgZ2xvYmFsVUlDb25maWdPcHRpb25zXG4gICAgfToge1xuICAgICAgICBDUlVEQXBpUGF0aD86IHN0cmluZyxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pblVwZGF0ZT86IGJvb2xlYW4sXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZWxldGU/OiBib29sZWFuLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluRGV0YWlsPzogYm9vbGVhbixcbiAgICAgICAgY3VzdG9tUm93QWN0aW9ucz86IFJlYWRvbmx5QXJyYXk8SUVudGl0eVBhZ2VBY3Rpb24+IHwgQXJyYXk8SUVudGl0eVBhZ2VBY3Rpb24+LFxuICAgICAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbICd1aUNvbmZpZ0dlbk9wdGlvbnMnIF0gIC8vIE5FVzogR2xvYmFsIGNvbmZpZyBvcHRpb25zXG4gICAgfVxuKSB7XG5cbiAgICBjb25zdCBlbnRpdHlOYW1lTG93ZXIgPSBlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgZW50aXR5TmFtZVBhc2NhbENhc2UgPSBwYXNjYWxDYXNlKGVudGl0eU5hbWUpO1xuXG4gICAgcmV0dXJuIHByb3BlcnRpZXNcbiAgICAgICAgLmZpbHRlcihwcm9wID0+IHByb3AgJiYgcHJvcC5pc0xpc3RhYmxlKVxuICAgICAgICAubWFwKHByb3AgPT4ge1xuICAgICAgICAgICAgLy8gVXNlIHNhbWUgZm9ybWF0dGluZyBsb2dpYyBhcyBkZXRhaWxzL2Zvcm1zIChpbmNsdWRlcyByZWxhdGlvbkNvbmZpZyBnZW5lcmF0aW9uKVxuICAgICAgICAgICAgLy8gUGFzcyBhbGwgcHJvcGVydGllcyBzbyBpdCBjYW4gZGV0ZWN0IGR1cGxpY2F0ZWQgcmVsYXRpb24gZmllbGRzIChlLmcuLCB0ZWFtTmFtZSBmb3IgdGVhbUlkKVxuICAgICAgICAgICAgY29uc3QgZm9ybWF0dGVkID0gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKHByb3AsICdkZXRhaWwnLCBlbnRpdHlTZXJ2aWNlLCBwcm9wZXJ0aWVzLCBnbG9iYWxVSUNvbmZpZ09wdGlvbnMpO1xuXG4gICAgICAgICAgICAvLyBBdXRvLWdlbmVyYXRlIGZpbHRlckNvbmZpZyBpZiBub3QgYWxyZWFkeSBwcmVzZW50IGFuZCBmaWVsZCBpcyBmaWx0ZXJhYmxlXG4gICAgICAgICAgICBjb25zdCBhdXRvR2VuZXJhdGVkRmlsdGVyQ29uZmlnID0gIWZvcm1hdHRlZC5maWx0ZXJDb25maWcgJiYgcHJvcC5pc0ZpbHRlcmFibGUgIT09IGZhbHNlXG4gICAgICAgICAgICAgICAgPyBnZW5lcmF0ZUZpbHRlckNvbmZpZyhwcm9wLCBlbnRpdHlTZXJ2aWNlLCBnbG9iYWxVSUNvbmZpZ09wdGlvbnMpXG4gICAgICAgICAgICAgICAgOiB1bmRlZmluZWQ7XG5cbiAgICAgICAgICAgIC8vIE92ZXJyaWRlL2FkZCBsaXN0LXNwZWNpZmljIHByb3BlcnRpZXNcbiAgICAgICAgICAgIGNvbnN0IHByb3BDb25maWc6IExpc3RpbmdQcm9wQ29uZmlnID0ge1xuICAgICAgICAgICAgICAgIC4uLmZvcm1hdHRlZCxcbiAgICAgICAgICAgICAgICBuYW1lOiBmb3JtYXR0ZWQubGFiZWwgfHwgZm9ybWF0dGVkLm5hbWUsICAvLyBFbnN1cmUgbmFtZSBpcyBzZXQgZm9yIHRhYmxlIGNvbHVtbiBoZWFkZXJcbiAgICAgICAgICAgICAgICBkYXRhSW5kZXg6IGAke3Byb3AuaWR9YCxcbiAgICAgICAgICAgICAgICBmaWVsZFR5cGU6IGZvcm1hdHRlZC5maWVsZFR5cGUgfHwgJ3RleHQnLFxuICAgICAgICAgICAgICAgIGZpbHRlckNvbmZpZzogZm9ybWF0dGVkLmZpbHRlckNvbmZpZyB8fCBhdXRvR2VuZXJhdGVkRmlsdGVyQ29uZmlnLCAgLy8gVXNlIGV4cGxpY2l0IG9yIGF1dG8tZ2VuZXJhdGVkXG4gICAgICAgICAgICAgICAgaGlkZGVuOiBwcm9wLmhhc093blByb3BlcnR5KCdpc1Zpc2libGUnKSAmJiAhcHJvcC5pc1Zpc2libGVcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGlmIChwcm9wLmlzSWRlbnRpZmllcikge1xuICAgICAgICAgICAgICAgIC8vIEJ1aWxkIGRlZmF1bHQgcm93IGFjdGlvbnMgd2l0aCBJRHNcbiAgICAgICAgICAgICAgICBjb25zdCBkZWZhdWx0QWN0aW9uczogQXJyYXk8SUVudGl0eVBhZ2VBY3Rpb24+ID0gW107XG5cbiAgICAgICAgICAgICAgICBpZiAoIWV4Y2x1ZGVGcm9tQWRtaW5EZXRhaWwpIHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEFjdGlvbnMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZDogJ3ZpZXcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbjogJ3ZpZXcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdWaWV3JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRlbXBsYXRlOiBgVmlldyB7JHtwcm9wLmlkfX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiBgL3ZpZXctJHtlbnRpdHlOYW1lTG93ZXJ9YFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoIWV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGUpIHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEFjdGlvbnMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZDogJ2VkaXQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbjogJ2VkaXQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdFZGl0JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRlbXBsYXRlOiBgRWRpdCB7JHtwcm9wLmlkfX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiBgL2VkaXQtJHtlbnRpdHlOYW1lTG93ZXJ9YFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoIWV4Y2x1ZGVGcm9tQWRtaW5EZWxldGUpIHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEFjdGlvbnMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZDogJ2RlbGV0ZScsXG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uOiAnZGVsZXRlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnRGVsZXRlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRlbXBsYXRlOiBgRGVsZXRlIHske3Byb3AuaWR9fWAsXG4gICAgICAgICAgICAgICAgICAgICAgICBvcGVuSW5Nb2RhbDogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1vZGFsQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kYWxUeXBlOiAnY29uZmlybScsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kYWxQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpdGxlOiBgRGVsZXRlICR7ZW50aXR5TmFtZVBhc2NhbENhc2V9P2AsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6IGBBcmUgeW91IHN1cmUgeW91IHdhbnQgdG8gZGVsZXRlIHRoaXMgJHtlbnRpdHlOYW1lUGFzY2FsQ2FzZX0/IFRoaXMgYWN0aW9uIGNhbm5vdCBiZSB1bmRvbmUuYFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXBpQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFwaU1ldGhvZDogYERFTEVURWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc3BvbnNlS2V5OiBlbnRpdHlOYW1lTG93ZXIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFwaVVybDogYCR7Q1JVREFwaVBhdGggPyBDUlVEQXBpUGF0aCA6ICcnfS8ke2VudGl0eU5hbWVMb3dlcn1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VjY2Vzc01lc3NhZ2U6IGAke2VudGl0eU5hbWVQYXNjYWxDYXNlfSBkZWxldGVkIHN1Y2Nlc3NmdWxseWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3JNZXNzYWdlOiBgRmFpbGVkIHRvIGRlbGV0ZSAke2VudGl0eU5hbWVQYXNjYWxDYXNlfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VibWl0U3VjY2Vzc1JlZGlyZWN0OiBgL2xpc3QtJHtlbnRpdHlOYW1lTG93ZXJ9YFxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAvLyBNZXJnZSBjdXN0b20gcm93IGFjdGlvbnMgdXNpbmcgaWRlbnRpZmllci1iYXNlZCBvdmVycmlkZVxuICAgICAgICAgICAgICAgIHByb3BDb25maWcuYWN0aW9ucyA9IGN1c3RvbVJvd0FjdGlvbnNcbiAgICAgICAgICAgICAgICAgICAgPyBtZXJnZUFjdGlvbnMoZGVmYXVsdEFjdGlvbnMsIGN1c3RvbVJvd0FjdGlvbnMpXG4gICAgICAgICAgICAgICAgICAgIDogZGVmYXVsdEFjdGlvbnM7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBwcm9wQ29uZmlnO1xuICAgICAgICB9KTtcbn1cblxuLyoqXG4gKiBNRVJHRSBVVElMSVRZIEZVTkNUSU9OU1xuICogXG4gKiBUaGVzZSBmdW5jdGlvbnMgaW1wbGVtZW50IHRoZSBpZGVudGlmaWVyLWJhc2VkIG92ZXJyaWRlIHBhdHRlcm46XG4gKiAtIERlZmF1bHRzIGhhdmUgc3RhbmRhcmQgaWRlbnRpZmllcnMgKGUuZy4sICd2aWV3JywgJ2VkaXQnLCAnZGVsZXRlJylcbiAqIC0gQ3VzdG9tIGNvbmZpZ3Mgd2l0aCBzYW1lIGlkZW50aWZpZXIgb3ZlcnJpZGUgdGhlIGRlZmF1bHRcbiAqIC0gTmV3IGlkZW50aWZpZXJzIGdldCBhZGRlZCB0byB0aGUgcmVzdWx0XG4gKi9cblxuLyoqXG4gKiBNZXJnZSBkZWZhdWx0IGJ1dHRvbnMgd2l0aCBjdXN0b20gYnV0dG9ucyB1c2luZyBpZGVudGlmaWVyLWJhc2VkIG92ZXJyaWRlLlxuICogXG4gKiBAcGFyYW0gZGVmYXVsdHMgLSBEZWZhdWx0IGJ1dHRvbnMgKGZyb20gZ2VuZXJhdG9yKVxuICogQHBhcmFtIGN1c3RvbXMgLSBDdXN0b20gYnV0dG9ucyAoZnJvbSBlbnRpdHkgc2NoZW1hKVxuICogQHJldHVybnMgTWVyZ2VkIGJ1dHRvbiBhcnJheVxuICovXG4vKipcbiAqIE1lcmdlcyBkZWZhdWx0IGJ1dHRvbnMgd2l0aCBjdXN0b20gYnV0dG9ucyB1c2luZyBJRC1iYXNlZCBvdmVycmlkZSBsb2dpYy5cbiAqIFxuICogQ3VzdG9tIGJ1dHRvbnMgd2l0aCBtYXRjaGluZyBJRHMgb3ZlcnJpZGUgZGVmYXVsdHMsIGFuZCBuZXcgY3VzdG9tIGJ1dHRvbnMgYXJlIGFwcGVuZGVkLlxuICogQnV0dG9ucyB3aXRob3V0IElEcyBhcmUgYWx3YXlzIGluY2x1ZGVkIChubyBkZWR1cGxpY2F0aW9uKS5cbiAqIFxuICogQHRlbXBsYXRlIFQgLSBCdXR0b24gdHlwZSB3aXRoIG9wdGlvbmFsIGlkIHByb3BlcnR5XG4gKiBAcGFyYW0gZGVmYXVsdHMgLSBEZWZhdWx0IGJ1dHRvbiBjb25maWd1cmF0aW9uc1xuICogQHBhcmFtIGN1c3RvbXMgLSBDdXN0b20gYnV0dG9uIGNvbmZpZ3VyYXRpb25zIHRvIG1lcmdlXG4gKiBAcmV0dXJucyBNZXJnZWQgYXJyYXkgd2l0aCBjdXN0b20gb3ZlcnJpZGVzIGFwcGxpZWRcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IGRlZmF1bHRzID0gW1xuICogICB7IGlkOiAnc2F2ZScsIGxhYmVsOiAnU2F2ZScsIGFjdGlvbjogJ3N1Ym1pdCcgfSxcbiAqICAgeyBpZDogJ2NhbmNlbCcsIGxhYmVsOiAnQ2FuY2VsJywgYWN0aW9uOiAnY2FuY2VsJyB9XG4gKiBdO1xuICogY29uc3QgY3VzdG9tcyA9IFtcbiAqICAgeyBpZDogJ3NhdmUnLCBsYWJlbDogJ1NhdmUgQ2hhbmdlcycsIGFjdGlvbjogJ3N1Ym1pdCcgfSwgLy8gT3ZlcnJpZGVcbiAqICAgeyBpZDogJ2RlbGV0ZScsIGxhYmVsOiAnRGVsZXRlJywgYWN0aW9uOiAnZGVsZXRlJyB9ICAgICAgLy8gTmV3XG4gKiBdO1xuICogY29uc3QgbWVyZ2VkID0gbWVyZ2VCdXR0b25zKGRlZmF1bHRzLCBjdXN0b21zKTtcbiAqIC8vIFJldHVybnM6IFtcbiAqIC8vICAgeyBpZDogJ3NhdmUnLCBsYWJlbDogJ1NhdmUgQ2hhbmdlcycsIGFjdGlvbjogJ3N1Ym1pdCcgfSxcbiAqIC8vICAgeyBpZDogJ2NhbmNlbCcsIGxhYmVsOiAnQ2FuY2VsJywgYWN0aW9uOiAnY2FuY2VsJyB9LFxuICogLy8gICB7IGlkOiAnZGVsZXRlJywgbGFiZWw6ICdEZWxldGUnLCBhY3Rpb246ICdkZWxldGUnIH1cbiAqIC8vIF1cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VCdXR0b25zPFQgZXh0ZW5kcyB7IGlkPzogc3RyaW5nIH0+KFxuICAgIGRlZmF1bHRzOiBBcnJheTxUPixcbiAgICBjdXN0b21zOiBSZWFkb25seUFycmF5PFQ+IHwgQXJyYXk8VD4gPSBbXVxuKTogQXJyYXk8VD4ge1xuICAgIGNvbnN0IGN1c3RvbXNBcnJheSA9IFsgLi4uY3VzdG9tcyBdOyAgLy8gQ29udmVydCB0byBtdXRhYmxlIGFycmF5XG4gICAgY29uc3QgY3VzdG9tTWFwID0gbmV3IE1hcChcbiAgICAgICAgY3VzdG9tc0FycmF5LmZpbHRlcihjID0+IGMuaWQpLm1hcChjID0+IFsgYy5pZCwgYyBdKVxuICAgICk7XG5cbiAgICAvLyBTdGFydCB3aXRoIGRlZmF1bHRzLCByZXBsYWNlIGlmIGN1c3RvbSBoYXMgc2FtZSBpZFxuICAgIGNvbnN0IG1lcmdlZCA9IGRlZmF1bHRzLm1hcChkZWZhdWx0QnRuID0+XG4gICAgICAgIGRlZmF1bHRCdG4uaWQgJiYgY3VzdG9tTWFwLmhhcyhkZWZhdWx0QnRuLmlkKVxuICAgICAgICAgICAgPyBjdXN0b21NYXAuZ2V0KGRlZmF1bHRCdG4uaWQpISAgLy8gT3ZlcnJpZGVcbiAgICAgICAgICAgIDogZGVmYXVsdEJ0blxuICAgICk7XG5cbiAgICAvLyBBZGQgY3VzdG9tIGJ1dHRvbnMgdGhhdCBkb24ndCBvdmVycmlkZSBkZWZhdWx0c1xuICAgIGN1c3RvbXNBcnJheS5mb3JFYWNoKGN1c3RvbUJ0biA9PiB7XG4gICAgICAgIGlmICghY3VzdG9tQnRuLmlkIHx8ICFkZWZhdWx0cy5zb21lKGQgPT4gZC5pZCA9PT0gY3VzdG9tQnRuLmlkKSkge1xuICAgICAgICAgICAgbWVyZ2VkLnB1c2goY3VzdG9tQnRuKTsgIC8vIEFkZCBuZXdcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIG1lcmdlZDtcbn1cblxuLyoqXG4gKiBNZXJnZXMgZGVmYXVsdCBhY3Rpb25zIHdpdGggY3VzdG9tIGFjdGlvbnMgdXNpbmcgSUQtYmFzZWQgb3ZlcnJpZGUgbG9naWMuXG4gKiBcbiAqIERlbGVnYXRlcyB0byBtZXJnZUJ1dHRvbnMgd2l0aCB0aGUgc2FtZSBiZWhhdmlvcjogY3VzdG9tIGFjdGlvbnMgd2l0aCBtYXRjaGluZyBJRHNcbiAqIG92ZXJyaWRlIGRlZmF1bHRzLCBhbmQgbmV3IGN1c3RvbSBhY3Rpb25zIGFyZSBhcHBlbmRlZC4gU2VtYW50aWNhbGx5IG5hbWVkIGZvciByb3cvdGFibGUgYWN0aW9ucy5cbiAqIFxuICogQHRlbXBsYXRlIFQgLSBBY3Rpb24gdHlwZSB3aXRoIG9wdGlvbmFsIGlkIHByb3BlcnR5XG4gKiBAcGFyYW0gZGVmYXVsdHMgLSBEZWZhdWx0IGFjdGlvbiBjb25maWd1cmF0aW9uc1xuICogQHBhcmFtIGN1c3RvbXMgLSBDdXN0b20gYWN0aW9uIGNvbmZpZ3VyYXRpb25zIHRvIG1lcmdlXG4gKiBAcmV0dXJucyBNZXJnZWQgYXJyYXkgd2l0aCBjdXN0b20gb3ZlcnJpZGVzIGFwcGxpZWRcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IGRlZmF1bHRzID0gW1xuICogICB7IGlkOiAnZWRpdCcsIGxhYmVsOiAnRWRpdCcsIGFjdGlvbjogJ2VkaXQnIH0sXG4gKiAgIHsgaWQ6ICdkZWxldGUnLCBsYWJlbDogJ0RlbGV0ZScsIGFjdGlvbjogJ2RlbGV0ZScgfVxuICogXTtcbiAqIGNvbnN0IGN1c3RvbXMgPSBbXG4gKiAgIHsgaWQ6ICdkZWxldGUnLCBsYWJlbDogJ1JlbW92ZScsIGFjdGlvbjogJ2RlbGV0ZScsIGNvbmZpcm06IHRydWUgfSAvLyBPdmVycmlkZVxuICogXTtcbiAqIGNvbnN0IG1lcmdlZCA9IG1lcmdlQWN0aW9ucyhkZWZhdWx0cywgY3VzdG9tcyk7XG4gKiAvLyBSZXR1cm5zOiBbXG4gKiAvLyAgIHsgaWQ6ICdlZGl0JywgbGFiZWw6ICdFZGl0JywgYWN0aW9uOiAnZWRpdCcgfSxcbiAqIC8vICAgeyBpZDogJ2RlbGV0ZScsIGxhYmVsOiAnUmVtb3ZlJywgYWN0aW9uOiAnZGVsZXRlJywgY29uZmlybTogdHJ1ZSB9XG4gKiAvLyBdXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlQWN0aW9uczxUIGV4dGVuZHMgeyBpZD86IHN0cmluZyB9PihcbiAgICBkZWZhdWx0czogQXJyYXk8VD4sXG4gICAgY3VzdG9tczogUmVhZG9ubHlBcnJheTxUPiB8IEFycmF5PFQ+ID0gW11cbik6IEFycmF5PFQ+IHtcbiAgICByZXR1cm4gbWVyZ2VCdXR0b25zKGRlZmF1bHRzLCBbIC4uLmN1c3RvbXMgXSk7ICAvLyBTcHJlYWQgdG8gaGFuZGxlIGJvdGggcmVhZG9ubHkgYW5kIG11dGFibGVcbn1cblxuLyoqXG4gKiBNZXJnZXMgZGVmYXVsdCBmaWx0ZXIgc2VnbWVudHMgd2l0aCBjdXN0b20gc2VnbWVudHMgdXNpbmcgSUQtYmFzZWQgb3ZlcnJpZGUgbG9naWMuXG4gKiBcbiAqIEZvbGxvd3MgdGhlIHNhbWUgcGF0dGVybiBhcyBtZXJnZUJ1dHRvbnMvbWVyZ2VBY3Rpb25zOiBjdXN0b20gc2VnbWVudHMgd2l0aCBtYXRjaGluZyBJRHNcbiAqIG92ZXJyaWRlIGRlZmF1bHRzLCBhbmQgbmV3IGN1c3RvbSBzZWdtZW50cyBhcmUgYXBwZW5kZWQuXG4gKiBcbiAqIEBwYXJhbSBkZWZhdWx0cyAtIERlZmF1bHQgc2VnbWVudCBjb25maWd1cmF0aW9uc1xuICogQHBhcmFtIGN1c3RvbXMgLSBDdXN0b20gc2VnbWVudCBjb25maWd1cmF0aW9ucyB0byBtZXJnZVxuICogQHJldHVybnMgTWVyZ2VkIGFycmF5IHdpdGggY3VzdG9tIG92ZXJyaWRlcyBhcHBsaWVkXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBkZWZhdWx0cyA9IFtcbiAqICAgeyBpZDogJ2FjdGl2ZScsIGxhYmVsOiAnQWN0aXZlJywgZmlsdGVyczogeyBzdGF0dXM6IHsgZXE6ICdhY3RpdmUnIH0gfSB9LFxuICogICB7IGlkOiAnaW5hY3RpdmUnLCBsYWJlbDogJ0luYWN0aXZlJywgZmlsdGVyczogeyBzdGF0dXM6IHsgZXE6ICdpbmFjdGl2ZScgfSB9IH1cbiAqIF07XG4gKiBjb25zdCBjdXN0b21zID0gW1xuICogICB7IGlkOiAnYXJjaGl2ZWQnLCBsYWJlbDogJ0FyY2hpdmVkJywgZmlsdGVyczogeyBhcmNoaXZlZDogeyBlcTogdHJ1ZSB9IH0gfVxuICogXTtcbiAqIGNvbnN0IHJlc3VsdCA9IG1lcmdlU2VnbWVudHMoZGVmYXVsdHMsIGN1c3RvbXMpO1xuICogLy8gUmV0dXJuczogW2FjdGl2ZSwgaW5hY3RpdmUsIGFyY2hpdmVkXVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZVNlZ21lbnRzPFQgZXh0ZW5kcyB7IGlkOiBzdHJpbmcgfT4oXG4gICAgZGVmYXVsdHM6IEFycmF5PFQ+LFxuICAgIGN1c3RvbXM6IFJlYWRvbmx5QXJyYXk8VD4gfCBBcnJheTxUPiA9IFtdXG4pOiBBcnJheTxUPiB7XG4gICAgcmV0dXJuIG1lcmdlQnV0dG9ucyhkZWZhdWx0cywgWyAuLi5jdXN0b21zIF0pOyAgLy8gUmV1c2UgbWVyZ2VCdXR0b25zIGxvZ2ljIHdpdGggaWQtYmFzZWQgb3ZlcnJpZGVcbn1cblxuLyoqXG4gKiBNZXJnZXMgZmllbGQtbGV2ZWwgdmlzaWJpbGl0eSwgZW5hYmxlbWVudCwgaGVscCB0ZXh0LCBhbmQgcGxhY2Vob2xkZXIgb3ZlcnJpZGVzIGludG8gYmFzZSBwcm9wZXJ0aWVzLlxuICogXG4gKiBBcHBsaWVzIGN1c3RvbSBmaWVsZCBjb25maWd1cmF0aW9ucyBmcm9tIGZvcm0vZGV0YWlsIGNvbmZpZyB0byBiYXNlIHNjaGVtYSBwcm9wZXJ0aWVzLlxuICogT25seSBtZXJnZXMgb3ZlcnJpZGVzIGZvciBmaWVsZHMgdGhhdCBleGlzdCBpbiBiYXNlIHByb3BlcnRpZXMgKHdhcm5zIGFib3V0IG5vbi1leGlzdGVudCBmaWVsZHMpLlxuICogXG4gKiBAdGVtcGxhdGUgVCAtIFByb3BlcnR5IHR5cGUgd2l0aCByZXF1aXJlZCBuYW1lIGZpZWxkXG4gKiBAcGFyYW0gYmFzZVByb3BlcnRpZXMgLSBCYXNlIGZpZWxkIHByb3BlcnRpZXMgZnJvbSBlbnRpdHkgc2NoZW1hXG4gKiBAcGFyYW0gZmllbGRPdmVycmlkZXMgLSBDdXN0b20gZmllbGQgb3ZlcnJpZGVzIGZyb20gZm9ybS9kZXRhaWwgY29uZmlndXJhdGlvblxuICogQHJldHVybnMgQmFzZSBwcm9wZXJ0aWVzIHdpdGggb3ZlcnJpZGVzIG1lcmdlZCBpblxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY29uc3QgYmFzZVByb3BzID0gW1xuICogICB7IG5hbWU6ICdlbWFpbCcsIHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogdHJ1ZSB9LFxuICogICB7IG5hbWU6ICdiaW8nLCB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IGZhbHNlIH1cbiAqIF07XG4gKiBjb25zdCBvdmVycmlkZXMgPSBbXG4gKiAgIHsgbmFtZTogJ2VtYWlsJywgaGVscFRleHQ6ICdFbnRlciBhIHZhbGlkIGVtYWlsIGFkZHJlc3MnIH0sXG4gKiAgIHsgbmFtZTogJ2JpbycsIHZpc2liaWxpdHk6IHsgY3JlYXRlOiBmYWxzZSB9IH1cbiAqIF07XG4gKiBjb25zdCBtZXJnZWQgPSBtZXJnZUZpZWxkVmlzaWJpbGl0eShiYXNlUHJvcHMsIG92ZXJyaWRlcyk7XG4gKiAvLyBSZXR1cm5zIGJhc2VQcm9wcyB3aXRoIGhlbHBUZXh0IGFuZCB2aXNpYmlsaXR5IG1lcmdlZFxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZUZpZWxkVmlzaWJpbGl0eTxUIGV4dGVuZHMgeyBuYW1lOiBzdHJpbmcgfT4oXG4gICAgYmFzZVByb3BlcnRpZXM6IEFycmF5PFQ+LFxuICAgIGZpZWxkT3ZlcnJpZGVzOiBSZWFkb25seUFycmF5PHtcbiAgICAgICAgcmVhZG9ubHkgbmFtZTogc3RyaW5nO1xuICAgICAgICByZWFkb25seSB2aXNpYmlsaXR5PzogYW55O1xuICAgICAgICByZWFkb25seSBlbmFibGVtZW50PzogYW55O1xuICAgICAgICByZWFkb25seSBoZWxwVGV4dD86IHN0cmluZztcbiAgICAgICAgcmVhZG9ubHkgcGxhY2Vob2xkZXI/OiBzdHJpbmc7XG4gICAgfT4gfCBBcnJheTx7XG4gICAgICAgIG5hbWU6IHN0cmluZztcbiAgICAgICAgdmlzaWJpbGl0eT86IGFueTtcbiAgICAgICAgZW5hYmxlbWVudD86IGFueTtcbiAgICAgICAgaGVscFRleHQ/OiBzdHJpbmc7XG4gICAgICAgIHBsYWNlaG9sZGVyPzogc3RyaW5nO1xuICAgIH0+ID0gW11cbik6IEFycmF5PFQ+IHtcbiAgICBjb25zdCBvdmVycmlkZU1hcCA9IG5ldyBNYXAoXG4gICAgICAgIFsgLi4uZmllbGRPdmVycmlkZXMgXS5tYXAoZiA9PiBbIGYubmFtZSwgZiBdKVxuICAgICk7XG5cbiAgICAvLyBWYWxpZGF0aW9uOiBXYXJuIGlmIGZpZWxkIG92ZXJyaWRlIHJlZmVyZW5jZXMgbm9uLWV4aXN0ZW50IGZpZWxkXG4gICAgZmllbGRPdmVycmlkZXMuZm9yRWFjaChvdmVycmlkZSA9PiB7XG4gICAgICAgIGlmICghYmFzZVByb3BlcnRpZXMuc29tZShwID0+IHAubmFtZSA9PT0gb3ZlcnJpZGUubmFtZSkpIHtcbiAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgRmllbGQgb3ZlcnJpZGUgXCIke292ZXJyaWRlLm5hbWV9XCIgbm90IGZvdW5kIGluIHNjaGVtYSBwcm9wZXJ0aWVzLiBUaGlzIG92ZXJyaWRlIHdpbGwgYmUgaWdub3JlZC5gKTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGJhc2VQcm9wZXJ0aWVzLm1hcChwcm9wID0+IHtcbiAgICAgICAgY29uc3Qgb3ZlcnJpZGUgPSBvdmVycmlkZU1hcC5nZXQocHJvcC5uYW1lKTtcblxuICAgICAgICBpZiAoIW92ZXJyaWRlKSByZXR1cm4gcHJvcDtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgLi4ucHJvcCxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS52aXNpYmlsaXR5ICE9PSB1bmRlZmluZWQgJiYgeyB2aXNpYmlsaXR5OiBvdmVycmlkZS52aXNpYmlsaXR5IH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmVuYWJsZW1lbnQgIT09IHVuZGVmaW5lZCAmJiB7IGVuYWJsZW1lbnQ6IG92ZXJyaWRlLmVuYWJsZW1lbnQgfSksXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUuaGVscFRleHQgIT09IHVuZGVmaW5lZCAmJiB7IGhlbHBUZXh0OiBvdmVycmlkZS5oZWxwVGV4dCB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS5wbGFjZWhvbGRlciAhPT0gdW5kZWZpbmVkICYmIHsgcGxhY2Vob2xkZXI6IG92ZXJyaWRlLnBsYWNlaG9sZGVyIH0pXG4gICAgICAgIH07XG4gICAgfSk7XG59XG5cbi8qKlxuICogTWVyZ2VzIGNvbHVtbi1sZXZlbCB2aXNpYmlsaXR5LCB3aWR0aCwgZml4ZWQgcG9zaXRpb24sIGdyb3VwaW5nIG92ZXJyaWRlcywgYW5kIG9yZGVyaW5nIGludG8gYmFzZSBwcm9wZXJ0aWVzLlxuICogXG4gKiBBcHBsaWVzIGN1c3RvbSBjb2x1bW4gY29uZmlndXJhdGlvbnMgZnJvbSB0YWJsZSBjb25maWcgdG8gYmFzZSBzY2hlbWEgcHJvcGVydGllcy5cbiAqIE9ubHkgbWVyZ2VzIG92ZXJyaWRlcyBmb3IgY29sdW1ucyB0aGF0IGV4aXN0IGluIGJhc2UgcHJvcGVydGllcyAod2FybnMgYWJvdXQgbm9uLWV4aXN0ZW50IGNvbHVtbnMpLlxuICogXG4gKiAqKlZpc2liaWxpdHkgTG9naWM6KipcbiAqIC0gV2hlbiBjb2x1bW5PdmVycmlkZXMgaXMgcHJvdmlkZWQ6XG4gKiAgIC0gRmllbGRzIElOIHRoZSBhcnJheTogVXNlIGBkZWZhdWx0VmlzaWJsZWAgKGRlZmF1bHRzIHRvIHRydWUgaWYgbm90IHNwZWNpZmllZClcbiAqICAgLSBGaWVsZHMgTk9UIElOIHRoZSBhcnJheTogU2V0IGBkZWZhdWx0VmlzaWJsZTogZmFsc2VgIChhdmFpbGFibGUgaW4gQ29sdW1uIFNldHRpbmdzIGJ1dCBub3Qgc2hvd24gYnkgZGVmYXVsdClcbiAqIC0gV2hlbiBjb2x1bW5PdmVycmlkZXMgaXMgZW1wdHkvdW5kZWZpbmVkOiBBbGwgZmllbGRzIHZpc2libGUgKGJhY2t3YXJkIGNvbXBhdGlibGUpXG4gKiBcbiAqICoqT3JkZXJpbmcgTG9naWM6KipcbiAqIC0gV2hlbiBjb2x1bW5PdmVycmlkZXMgaXMgcHJvdmlkZWQ6XG4gKiAgIC0gQ29sdW1ucyBhcmUgb3JkZXJlZCBhY2NvcmRpbmcgdG8gdGhlaXIgcG9zaXRpb24gaW4gdGhlIGNvbHVtbk92ZXJyaWRlcyBhcnJheVxuICogICAtIENvbHVtbnMgbm90IGluIHRoZSBhcnJheSBhcHBlYXIgYXQgdGhlIGVuZCBpbiB0aGVpciBvcmlnaW5hbCBvcmRlclxuICogLSBXaGVuIGNvbHVtbk92ZXJyaWRlcyBpcyBlbXB0eS91bmRlZmluZWQ6IE9yaWdpbmFsIG9yZGVyIGlzIHByZXNlcnZlZFxuICogXG4gKiBAdGVtcGxhdGUgVCAtIFByb3BlcnR5IHR5cGUgd2l0aCByZXF1aXJlZCBuYW1lIGZpZWxkXG4gKiBAcGFyYW0gYmFzZVByb3BlcnRpZXMgLSBCYXNlIGNvbHVtbiBwcm9wZXJ0aWVzIGZyb20gZW50aXR5IHNjaGVtYVxuICogQHBhcmFtIGNvbHVtbk92ZXJyaWRlcyAtIEN1c3RvbSBjb2x1bW4gb3ZlcnJpZGVzIGZyb20gdGFibGUgY29uZmlndXJhdGlvblxuICogQHJldHVybnMgQmFzZSBwcm9wZXJ0aWVzIHdpdGggb3ZlcnJpZGVzIG1lcmdlZCBpbiBhbmQgcmVvcmRlcmVkXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBiYXNlUHJvcHMgPSBbXG4gKiAgIHsgbmFtZTogJ29yZGVySWQnLCBkYXRhSW5kZXg6ICdvcmRlcklkJywgdHlwZTogJ3N0cmluZycgfSxcbiAqICAgeyBuYW1lOiAnc3RhdHVzJywgZGF0YUluZGV4OiAnc3RhdHVzJywgdHlwZTogJ3N0cmluZycgfSxcbiAqICAgeyBuYW1lOiAndXNlcklkJywgZGF0YUluZGV4OiAndXNlcklkJywgdHlwZTogJ3N0cmluZycgfSxcbiAqICAgeyBuYW1lOiAnbWV0YWRhdGEnLCBkYXRhSW5kZXg6ICdtZXRhZGF0YScsIHR5cGU6ICdzdHJpbmcnIH1cbiAqIF07XG4gKiBjb25zdCBvdmVycmlkZXMgPSBbXG4gKiAgIHsgZmllbGQ6ICdzdGF0dXMnLCBkZWZhdWx0VmlzaWJsZTogdHJ1ZSB9LCAgICAgICAgIC8vIDFzdCBwb3NpdGlvblxuICogICB7IGZpZWxkOiAnb3JkZXJJZCcsIHdpZHRoOiAyMDAsIGRlZmF1bHRWaXNpYmxlOiB0cnVlIH0sIC8vIDJuZCBwb3NpdGlvblxuICogICB7IGZpZWxkOiAnbWV0YWRhdGEnLCBkZWZhdWx0VmlzaWJsZTogZmFsc2UgfSAgICAgICAvLyAzcmQgcG9zaXRpb24gKGhpZGRlbilcbiAqICAgLy8gdXNlcklkIG5vdCBsaXN0ZWQgLSB3aWxsIGJlIGF0IHRoZSBlbmQgYW5kIGhpZGRlbiBieSBkZWZhdWx0XG4gKiBdO1xuICogY29uc3QgbWVyZ2VkID0gbWVyZ2VDb2x1bW5WaXNpYmlsaXR5KGJhc2VQcm9wcywgb3ZlcnJpZGVzKTtcbiAqIC8vIFJlc3VsdCAoaW4gb3JkZXIpOlxuICogLy8gMS4gc3RhdHVzOiBkZWZhdWx0VmlzaWJsZTogdHJ1ZVxuICogLy8gMi4gb3JkZXJJZDogZGVmYXVsdFZpc2libGU6IHRydWUsIHdpZHRoOiAyMDBcbiAqIC8vIDMuIG1ldGFkYXRhOiBkZWZhdWx0VmlzaWJsZTogZmFsc2VcbiAqIC8vIDQuIHVzZXJJZDogZGVmYXVsdFZpc2libGU6IGZhbHNlIChub3QgaW4gb3ZlcnJpZGVzLCBhdCB0aGUgZW5kKVxuICogYGBgXG4gKi9cbi8qKlxuICogTm9ybWFsaXplZCBjb2x1bW4gY29uZmlndXJhdGlvbiB3aXRoIGRlZmF1bHRWaXNpYmxlIGFsd2F5cyBkZWZpbmVkLlxuICogSW50ZXJuYWwgdHlwZSBmb3IgcHJvY2Vzc2luZyBjb2x1bW4gb3ZlcnJpZGVzLlxuICovXG50eXBlIE5vcm1hbGl6ZWRDb2x1bW5Db25maWcgPSBPbWl0PElUYWJsZUNvbHVtbkNvbmZpZywgJ2RlZmF1bHRWaXNpYmxlJz4gJiB7XG4gICAgZGVmYXVsdFZpc2libGU6IGJvb2xlYW47XG4gICAgX29yZGVyPzogbnVtYmVyO1xufTtcblxuLyoqXG4gKiBOb3JtYWxpemVzIGNvbHVtbiBvdmVycmlkZXMgdG8gYSBjb25zaXN0ZW50IGZvcm1hdC5cbiAqIFN1cHBvcnRzIGJvdGggc3RyaW5nIHNob3J0aGFuZCAoJ2ZpZWxkTmFtZScpIGFuZCBvYmplY3Qgc3ludGF4ICh7IGZpZWxkOiAnZmllbGROYW1lJywgLi4uIH0pXG4gKiBcbiAqIEBwYXJhbSBjb2x1bW5PdmVycmlkZXMgLSBDb2x1bW4gY29uZmlndXJhdGlvbnMgKHN0cmluZyBvciBvYmplY3QgZm9ybWF0KVxuICogQHJldHVybnMgTm9ybWFsaXplZCBhcnJheSBvZiBjb2x1bW4gY29uZmlnIG9iamVjdHNcbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplQ29sdW1uT3ZlcnJpZGVzKFxuICAgIGNvbHVtbk92ZXJyaWRlczogSVRhYmxlQ29sdW1uc1xuKTogQXJyYXk8Tm9ybWFsaXplZENvbHVtbkNvbmZpZz4ge1xuICAgIHJldHVybiAoY29sdW1uT3ZlcnJpZGVzIGFzIEFycmF5PElUYWJsZUNvbHVtbj4pLm1hcChjb2wgPT4ge1xuICAgICAgICAvLyBTdHJpbmcgc2hvcnRoYW5kOiAnZmllbGROYW1lJyDihpIgeyBmaWVsZDogJ2ZpZWxkTmFtZScsIGRlZmF1bHRWaXNpYmxlOiB0cnVlIH1cbiAgICAgICAgaWYgKHR5cGVvZiBjb2wgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIGZpZWxkOiBjb2wsXG4gICAgICAgICAgICAgICAgZGVmYXVsdFZpc2libGU6IHRydWVcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgLy8gT2JqZWN0IHN5bnRheDogYWxyZWFkeSBub3JtYWxpemVkLCBqdXN0IGVuc3VyZSBkZWZhdWx0VmlzaWJsZSBkZWZhdWx0cyB0byB0cnVlXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBmaWVsZDogY29sLmZpZWxkLFxuICAgICAgICAgICAgdmlzaWJpbGl0eTogY29sLnZpc2liaWxpdHksXG4gICAgICAgICAgICB3aWR0aDogY29sLndpZHRoLFxuICAgICAgICAgICAgZml4ZWQ6IGNvbC5maXhlZCxcbiAgICAgICAgICAgIGdyb3VwVGl0bGU6IGNvbC5ncm91cFRpdGxlLFxuICAgICAgICAgICAgZGVmYXVsdFZpc2libGU6IGNvbC5kZWZhdWx0VmlzaWJsZSAhPT0gZmFsc2UgLy8gRGVmYXVsdHMgdG8gdHJ1ZVxuICAgICAgICB9O1xuICAgIH0pO1xufVxuXG4vKipcbiAqIE1lcmdlcyBjb2x1bW4gdmlzaWJpbGl0eSBjb25maWd1cmF0aW9uIHdpdGggYmFzZSBwcm9wZXJ0aWVzLlxuICogQ29udHJvbHMgd2hpY2ggY29sdW1ucyBhcmUgdmlzaWJsZSBieSBkZWZhdWx0IGFuZCB0aGVpciBkaXNwbGF5IG9yZGVyLlxuICogXG4gKiAqKlN1cHBvcnRzOioqXG4gKiAtIFNjaGVtYSBmaWVsZHMgKGZyb20gYmFzZSBwcm9wZXJ0aWVzKVxuICogLSBKU09OIHBhdGhzIChlLmcuLCAndXNlci5lbWFpbCcsICdtZXRhZGF0YS5zY29yZScpXG4gKiAtIEN1c3RvbS9jb21wdXRlZCBjb2x1bW5zIChub3QgaW4gc2NoZW1hLCBwcm92aWRlZCBieSBBUEkgb3IgZnJvbnRlbmQpXG4gKiBcbiAqIEB0ZW1wbGF0ZSBUIC0gQmFzZSBwcm9wZXJ0eSB0eXBlIHdpdGggbmFtZSBhbmQgZGF0YUluZGV4XG4gKiBAcGFyYW0gYmFzZVByb3BlcnRpZXMgLSBCYXNlIHByb3BlcnRpZXMgZnJvbSBlbnRpdHkgc2NoZW1hXG4gKiBAcGFyYW0gY29sdW1uT3ZlcnJpZGVzIC0gQ29sdW1uIGNvbmZpZ3VyYXRpb24gb3ZlcnJpZGVzIChzdHJpbmcgb3Igb2JqZWN0IGZvcm1hdClcbiAqIEByZXR1cm5zIE1lcmdlZCBwcm9wZXJ0aWVzIHdpdGggdmlzaWJpbGl0eSBhbmQgb3JkZXIgYXBwbGllZCwgaW5jbHVkaW5nIGN1c3RvbSBjb2x1bW5zXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZUNvbHVtblZpc2liaWxpdHk8VCBleHRlbmRzIHsgbmFtZTogc3RyaW5nOyBkYXRhSW5kZXg/OiBzdHJpbmcgfT4oXG4gICAgYmFzZVByb3BlcnRpZXM6IEFycmF5PFQ+LFxuICAgIGNvbHVtbk92ZXJyaWRlczogSVRhYmxlQ29sdW1ucyA9IFtdXG4pOiBBcnJheTxUPiB7XG4gICAgLy8gSWYgbm8gY29sdW1uT3ZlcnJpZGVzIHByb3ZpZGVkLCByZXR1cm4gcHJvcGVydGllcyBhcy1pcyAoYmFja3dhcmQgY29tcGF0aWJsZSlcbiAgICBpZiAoIWNvbHVtbk92ZXJyaWRlcyB8fCBjb2x1bW5PdmVycmlkZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHJldHVybiBiYXNlUHJvcGVydGllcztcbiAgICB9XG5cbiAgICAvLyBOb3JtYWxpemUgY29sdW1uIG92ZXJyaWRlcyAoaGFuZGxlIHN0cmluZyBzaG9ydGhhbmQpXG4gICAgY29uc3Qgbm9ybWFsaXplZE92ZXJyaWRlcyA9IG5vcm1hbGl6ZUNvbHVtbk92ZXJyaWRlcyhjb2x1bW5PdmVycmlkZXMpO1xuXG4gICAgY29uc3Qgb3ZlcnJpZGVNYXAgPSBuZXcgTWFwKFxuICAgICAgICBub3JtYWxpemVkT3ZlcnJpZGVzLm1hcCgoYywgaW5kZXgpID0+IFsgYy5maWVsZCwgeyAuLi5jLCBfb3JkZXI6IGluZGV4IH0gXSlcbiAgICApO1xuXG4gICAgLy8gVHJhY2sgd2hpY2ggb3ZlcnJpZGVzIG1hdGNoIGV4aXN0aW5nIHNjaGVtYSBjb2x1bW5zXG4gICAgY29uc3QgbWF0Y2hlZE92ZXJyaWRlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gICAgLy8gTWVyZ2Ugb3ZlcnJpZGVzIGludG8gZXhpc3Rpbmcgc2NoZW1hIHByb3BlcnRpZXNcbiAgICBjb25zdCBtZXJnZWRQcm9wZXJ0aWVzID0gYmFzZVByb3BlcnRpZXMubWFwKHByb3AgPT4ge1xuICAgICAgICAvLyBVc2UgZGF0YUluZGV4IChhY3R1YWwgZmllbGQgbmFtZSkgaWYgYXZhaWxhYmxlLCBvdGhlcndpc2UgZmFsbCBiYWNrIHRvIG5hbWVcbiAgICAgICAgY29uc3QgZmllbGROYW1lID0gcHJvcC5kYXRhSW5kZXggfHwgcHJvcC5uYW1lO1xuICAgICAgICBjb25zdCBvdmVycmlkZSA9IG92ZXJyaWRlTWFwLmdldChmaWVsZE5hbWUpO1xuXG4gICAgICAgIGlmICghb3ZlcnJpZGUpIHtcbiAgICAgICAgICAgIC8vIEZpZWxkIG5vdCBpbiB0YWJsZUNvbmZpZy5jb2x1bW5zIC0gaGlkZSBieSBkZWZhdWx0IGJ1dCBrZWVwIGF2YWlsYWJsZVxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAuLi5wcm9wLFxuICAgICAgICAgICAgICAgIGRlZmF1bHRWaXNpYmxlOiBmYWxzZSxcbiAgICAgICAgICAgICAgICBfb3JkZXI6IE51bWJlci5NQVhfU0FGRV9JTlRFR0VSIC8vIFB1dCBhdCB0aGUgZW5kXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRmllbGQgaXMgaW4gdGFibGVDb25maWcuY29sdW1ucyAtIGFwcGx5IG92ZXJyaWRlc1xuICAgICAgICBtYXRjaGVkT3ZlcnJpZGVzLmFkZChvdmVycmlkZS5maWVsZCk7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAuLi5wcm9wLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLnZpc2liaWxpdHkgIT09IHVuZGVmaW5lZCAmJiB7IHZpc2liaWxpdHk6IG92ZXJyaWRlLnZpc2liaWxpdHkgfSksXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUud2lkdGggIT09IHVuZGVmaW5lZCAmJiB7IHdpZHRoOiBvdmVycmlkZS53aWR0aCB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS5maXhlZCAhPT0gdW5kZWZpbmVkICYmIHsgZml4ZWQ6IG92ZXJyaWRlLmZpeGVkIH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmdyb3VwVGl0bGUgIT09IHVuZGVmaW5lZCAmJiB7IGdyb3VwVGl0bGU6IG92ZXJyaWRlLmdyb3VwVGl0bGUgfSksXG4gICAgICAgICAgICBkZWZhdWx0VmlzaWJsZTogb3ZlcnJpZGUuZGVmYXVsdFZpc2libGUgIT09IGZhbHNlLCAgLy8gRGVmYXVsdHMgdG8gdHJ1ZVxuICAgICAgICAgICAgX29yZGVyOiBvdmVycmlkZS5fb3JkZXJcbiAgICAgICAgfTtcbiAgICB9KTtcblxuICAgIC8vIEFkZCBjdXN0b20gY29sdW1ucyAoSlNPTiBwYXRocywgY29tcHV0ZWQgZmllbGRzKVxuICAgIG5vcm1hbGl6ZWRPdmVycmlkZXMuZm9yRWFjaChvdmVycmlkZSA9PiB7XG4gICAgICAgIGlmICghbWF0Y2hlZE92ZXJyaWRlcy5oYXMob3ZlcnJpZGUuZmllbGQpKSB7XG4gICAgICAgICAgICAvLyBUaGlzIGlzIGEgY3VzdG9tIGNvbHVtbiAoSlNPTiBwYXRoIG9yIGNvbXB1dGVkIGZpZWxkKVxuICAgICAgICAgICAgY29uc3QgaXNKc29uUGF0aCA9IG92ZXJyaWRlLmZpZWxkLmluY2x1ZGVzKCcuJyk7XG5cbiAgICAgICAgICAgIC8vIExvZyBpbmZvIGFib3V0IGN1c3RvbSBjb2x1bW5cbiAgICAgICAgICAgIGlmIChpc0pzb25QYXRoKSB7XG4gICAgICAgICAgICAgICAgRGVmYXVsdExvZ2dlci5kZWJ1ZyhgQWRkaW5nIEpTT04gcGF0aCBjb2x1bW46IFwiJHtvdmVycmlkZS5maWVsZH1cImApO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLmRlYnVnKGBBZGRpbmcgY3VzdG9tIGNvbHVtbjogXCIke292ZXJyaWRlLmZpZWxkfVwiIChub3QgaW4gc2NoZW1hLCBhc3N1bWVzIEFQSSBwcm92aWRlcyBpdClgKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQWRkIGFzIG5ldyBjdXN0b20gY29sdW1uXG4gICAgICAgICAgICBtZXJnZWRQcm9wZXJ0aWVzLnB1c2goe1xuICAgICAgICAgICAgICAgIG5hbWU6IG92ZXJyaWRlLmZpZWxkLCAgLy8gVXNlIGZpZWxkIGFzIG5hbWVcbiAgICAgICAgICAgICAgICBkYXRhSW5kZXg6IG92ZXJyaWRlLmZpZWxkLCAgLy8gRnJvbnRlbmQgd2lsbCB1c2UgZ2V0TmVzdGVkVmFsdWUoKVxuICAgICAgICAgICAgICAgIGRlZmF1bHRWaXNpYmxlOiBvdmVycmlkZS5kZWZhdWx0VmlzaWJsZSxcbiAgICAgICAgICAgICAgICBmaWVsZFR5cGU6ICd0ZXh0JywgIC8vIERlZmF1bHQgdG8gdGV4dCBmb3IgY3VzdG9tIGNvbHVtbnNcbiAgICAgICAgICAgICAgICAuLi4ob3ZlcnJpZGUudmlzaWJpbGl0eSAhPT0gdW5kZWZpbmVkICYmIHsgdmlzaWJpbGl0eTogb3ZlcnJpZGUudmlzaWJpbGl0eSB9KSxcbiAgICAgICAgICAgICAgICAuLi4ob3ZlcnJpZGUud2lkdGggIT09IHVuZGVmaW5lZCAmJiB7IHdpZHRoOiBvdmVycmlkZS53aWR0aCB9KSxcbiAgICAgICAgICAgICAgICAuLi4ob3ZlcnJpZGUuZml4ZWQgIT09IHVuZGVmaW5lZCAmJiB7IGZpeGVkOiBvdmVycmlkZS5maXhlZCB9KSxcbiAgICAgICAgICAgICAgICAuLi4ob3ZlcnJpZGUuZ3JvdXBUaXRsZSAhPT0gdW5kZWZpbmVkICYmIHsgZ3JvdXBUaXRsZTogb3ZlcnJpZGUuZ3JvdXBUaXRsZSB9KSxcbiAgICAgICAgICAgICAgICBfb3JkZXI6IG92ZXJyaWRlLl9vcmRlclxuICAgICAgICAgICAgfSBhcyBhbnkpO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBTb3J0IGJ5IG9yZGVyIGZyb20gY29sdW1uT3ZlcnJpZGVzIChjb2x1bW5zIG5vdCBpbiBvdmVycmlkZXMgZ28gdG8gZW5kKVxuICAgIG1lcmdlZFByb3BlcnRpZXMuc29ydCgoYTogYW55LCBiOiBhbnkpID0+IChhLl9vcmRlciA/PyBOdW1iZXIuTUFYX1NBRkVfSU5URUdFUikgLSAoYi5fb3JkZXIgPz8gTnVtYmVyLk1BWF9TQUZFX0lOVEVHRVIpKTtcblxuICAgIC8vIFJlbW92ZSB0ZW1wb3JhcnkgX29yZGVyIHByb3BlcnR5XG4gICAgcmV0dXJuIG1lcmdlZFByb3BlcnRpZXMubWFwKCh7IF9vcmRlciwgLi4ucmVzdCB9OiBhbnkpID0+IHJlc3QpO1xufVxuIl19
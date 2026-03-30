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
exports.groupPageHeaderActions = groupPageHeaderActions;
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
        // Pass quickCreate UX config through verbatim (#44).
        // ui24 uses it to surface a contextual "+ Create '[term]'" button in the
        // dropdown when the search returns no results.  The entity create form is
        // resolved from addNewOptionConfig — nothing is duplicated here.
        if (selectField.quickCreate) {
            formatted['quickCreate'] = selectField.quickCreate;
        }
    }
    // Resolve RelationEntityOptionConfig → FieldOptionsAPIConfig for select fields on form pages
    if ((0, entity_1.isSelectFieldMetadata)(thisProp) && thisProp.options
        && typeof thisProp.options === 'object' && !Array.isArray(thisProp.options)
        && 'entityName' in thisProp.options && thisProp.relation) {
        const resolved = resolveRelationOptionConfig(thisProp.options, thisProp, entityService, globalUIConfigOptions);
        if (resolved) {
            formatted['options'] = resolved;
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
                    actions: userRelationConfig?.displayConfig?.actions,
                    // Pass through preview config for Related Record Peek (#103)
                    ...(userRelationConfig?.displayConfig?.preview && { preview: userRelationConfig.displayConfig.preview })
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
 * 6. **Visibility control:** All configs support `visibility: Condition` for role-based/conditional display
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
 *     visibility: { actor: { groups: { inList: ['admin'] } } }
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
 * Groups page header actions into primary (top-level buttons) and secondary (inside a "More" dropdown).
 * When autoGroup is false, returns all actions as a flat array (no grouping).
 *
 * Guarantees at least one visible top-level action: if primaryActions is empty,
 * the first secondary action is promoted to top-level instead of being buried in "More".
 */
function groupPageHeaderActions(primaryActions, secondaryActions, autoGroup) {
    if (!autoGroup || secondaryActions.length === 0) {
        return [...primaryActions, ...secondaryActions];
    }
    const topLevel = [...primaryActions];
    let remaining = secondaryActions;
    // Promote first secondary action if nothing is visible at top level
    if (topLevel.length === 0 && remaining.length > 0) {
        topLevel.push(remaining[0]);
        remaining = remaining.slice(1);
    }
    if (remaining.length === 0) {
        return topLevel;
    }
    const moreDropdown = {
        id: 'more-actions',
        label: 'More',
        type: 'dropdown',
        items: remaining,
    };
    return [...topLevel, moreDropdown];
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
    fieldOverrides.forEach(override => {
        if (!baseProperties.some(p => p.name === override.name)) {
            logging_1.DefaultLogger.warn(`Field override "${override.name}" not found in schema properties. This override will be ignored.`);
        }
    });
    return baseProperties.map(prop => {
        const override = overrideMap.get(prop.name);
        if (!override)
            return prop;
        const { name: _name, ...overrideProps } = override;
        const definedOverrides = {};
        for (const [key, value] of Object.entries(overrideProps)) {
            if (value !== undefined) {
                definedOverrides[key] = value;
            }
        }
        return {
            ...prop,
            ...definedOverrides,
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
            renderer: col.renderer,
            width: col.width,
            fixed: col.fixed,
            groupTitle: col.groupTitle,
            defaultVisible: col.defaultVisible !== false, // Defaults to true
            ...(col.formatting && { formatting: col.formatting }),
            ...(col.composite && { composite: col.composite }),
            ...(col.masking && { masking: col.masking }),
            ...(col.derived && { derived: col.derived }),
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
            ...(override.renderer !== undefined && { renderer: override.renderer }),
            ...(override.width !== undefined && { width: override.width }),
            ...(override.fixed !== undefined && { fixed: override.fixed }),
            ...(override.groupTitle !== undefined && { groupTitle: override.groupTitle }),
            ...(override.formatting && { formatting: override.formatting }),
            ...(override.composite && { composite: override.composite }),
            ...(override.masking && { masking: override.masking }),
            ...(override.derived && { derived: override.derived }),
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
                ...(override.renderer !== undefined && { renderer: override.renderer }),
                ...(override.width !== undefined && { width: override.width }),
                ...(override.fixed !== undefined && { fixed: override.fixed }),
                ...(override.groupTitle !== undefined && { groupTitle: override.groupTitle }),
                ...(override.formatting && { formatting: override.formatting }),
                ...(override.composite && { composite: override.composite }),
                ...(override.masking && { masking: override.masking }),
                ...(override.derived && { derived: override.derived }),
                _order: override._order
            });
        }
    });
    // Sort by order from columnOverrides (columns not in overrides go to end)
    mergedProperties.sort((a, b) => (a._order ?? Number.MAX_SAFE_INTEGER) - (b._order ?? Number.MAX_SAFE_INTEGER));
    // Remove temporary _order property
    return mergedProperties.map(({ _order, ...rest }) => rest);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy91aS1jb25maWctZ2VuL3RlbXBsYXRlcy91dGlsLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBMGlCQSw0REFnQkM7QUEwTUQsa0VBNERDO0FBb0JELG9EQXlOQztBQXVYRCw0Q0F1TkM7QUFtQ0Qsb0ZBK1NDO0FBY0Qsc0ZBa0JDO0FBaUZELDREQXVGQztBQWtCRCxzREFrQ0M7QUFrRUQsMEVBSUM7QUFhRCwwRUFJQztBQWFELDBFQUlDO0FBaURELHNFQXVHQztBQStDRCxvQ0F3QkM7QUE2QkQsb0NBS0M7QUFTRCx3REE4QkM7QUF5QkQsc0NBS0M7QUEyQkQsb0RBc0NDO0FBeUdELHNEQTBGQztBQTMzRkQseUNBWXNCO0FBRXRCLHlDQUE4QztBQUU5QywyQ0FBOEM7QUFDOUMsdUNBQThEO0FBa0Q5RDs7R0FFRztBQUNIOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBbUJHO0FBQ0gsTUFBTSx3QkFBd0IsR0FBOEM7SUFDeEUsT0FBTyxFQUFFLElBQUk7SUFDYixRQUFRLEVBQUU7UUFDTiw0Q0FBNEM7UUFDNUMsT0FBTyxFQUFFLENBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsYUFBYSxDQUFFO1FBQ3BELDRDQUE0QztRQUM1QyxNQUFNLEVBQUUsQ0FBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsU0FBUyxDQUFFO1FBQ3hELHdDQUF3QztRQUN4QyxJQUFJLEVBQUUsQ0FBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxZQUFZLEVBQUUsVUFBVSxDQUFFO0tBQzVEO0lBQ0QsUUFBUSxFQUFFO1FBQ04sMENBQTBDO1FBQzFDLFFBQVEsRUFBRSxPQUFPO1FBQ2pCLFFBQVEsRUFBRSxRQUFRLEVBQUUsYUFBYTtRQUNqQyxTQUFTLEVBQUUsV0FBVyxFQUFFLFVBQVU7UUFDbEMsTUFBTSxFQUFFLFdBQVcsRUFBRSxVQUFV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QUMsQ0FBQztJQUV6SCxtQ0FBbUM7SUFDbkMsT0FBTyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxHQUFHLElBQUksRUFBTyxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUNwRSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtcbiAgICBCYXNlRW50aXR5U2VydmljZSxcbiAgICBGaWVsZE1ldGFkYXRhLFxuICAgIFRJT1NjaGVtYUF0dHJpYnV0ZSxcbiAgICBpc1NlbGVjdEZpZWxkTWV0YWRhdGEsXG4gICAgU2VsZWN0RmllbGRNZXRhZGF0YSxcbiAgICBFbnRpdHlBdHRyaWJ1dGUsXG4gICAgSVJlbGF0aW9uRmllbGRDb25maWcsXG4gICAgVElPU2NoZW1hQXR0cmlidXRlc01hcCxcbiAgICBFbnRpdHlTY2hlbWEsXG4gICAgSUZpbHRlclNlZ21lbnQsXG4gICAgY3JlYXRlRmllbGRPcHRpb25zXG59IGZyb20gXCIuLi8uLi9lbnRpdHlcIjtcbmltcG9ydCB0eXBlIHsgUmVsYXRpb25FbnRpdHlPcHRpb25Db25maWcsIEZpZWxkT3B0aW9uc0FQSUNvbmZpZywgSUVudGl0eVBhZ2VBY3Rpb24sIFRlbXBsYXRlLCBGaWVsZE9wdGlvbiwgSUZpbHRlclNlZ21lbnRHcm91cCwgSVRhYmxlQ29sdW1ucywgSVRhYmxlQ29sdW1uLCBJVGFibGVDb2x1bW5Db25maWcgfSBmcm9tICcuLi8uLi9lbnRpdHkvYmFzZS1lbnRpdHknO1xuaW1wb3J0IHsgRnJhbWV3b3JrRXJyb3IgfSBmcm9tIFwiLi4vLi4vZXJyb3JzXCI7XG5pbXBvcnQgdHlwZSB7IElBcHBsaWNhdGlvbkNvbmZpZywgSUR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbkNvbmZpZywgSVNlZ21lbnRBdXRvR2VuZXJhdGlvbkNvbmZpZyB9IGZyb20gJy4uLy4uL2ludGVyZmFjZXMvY29uZmlnJztcbmltcG9ydCB7IERlZmF1bHRMb2dnZXIgfSBmcm9tIFwiLi4vLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgcGFzY2FsQ2FzZSwgdG9IdW1hblJlYWRhYmxlTmFtZSB9IGZyb20gXCIuLi8uLi91dGlsc1wiO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNNQVJUIERVUExJQ0FURUQgRklFTEQgREVURUNUSU9OIC0gRU5IQU5DRUQgQUxHT1JJVEhNXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBEZXRlY3Rpb24gcmVzdWx0IHdpdGggcmljaCBtZXRhZGF0YVxuICovXG5pbnRlcmZhY2UgRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uUmVzdWx0IHtcbiAgICAvKiogUHJpbWFyeSBkaXNwbGF5IGZpZWxkIGRldGVjdGVkIChlLmcuLCAndGVhbU5hbWUnKSAqL1xuICAgIHByaW1hcnlGaWVsZD86IHN0cmluZztcblxuICAgIC8qKiBHZW5lcmF0ZWQgdGVtcGxhdGUgc3RyaW5nIChlLmcuLCAne3RlYW1OYW1lfScgb3IgJ3t0ZWFtTmFtZX0gKHt0ZWFtQ29kZX0pJykgKi9cbiAgICB0ZW1wbGF0ZT86IHN0cmluZztcblxuICAgIC8qKiBBbGwgZGV0ZWN0ZWQgZmllbGRzIGJ5IGNhdGVnb3J5ICovXG4gICAgZGV0ZWN0ZWRGaWVsZHM6IHtcbiAgICAgICAgLyoqIERpc3BsYXkgZmllbGRzOiBOYW1lLCBUaXRsZSwgTGFiZWwgKi9cbiAgICAgICAgZGlzcGxheT86IHN0cmluZ1tdO1xuICAgICAgICAvKiogVmlzdWFsIGZpZWxkczogTG9nbywgSW1hZ2UsIEljb24gKi9cbiAgICAgICAgdmlzdWFsPzogc3RyaW5nW107XG4gICAgICAgIC8qKiBNZXRhIGZpZWxkczogQ29kZSwgU2x1ZywgS2V5ICovXG4gICAgICAgIG1ldGE/OiBzdHJpbmdbXTtcbiAgICB9O1xuXG4gICAgLyoqIENvbmZpZGVuY2UgbGV2ZWwgKi9cbiAgICBjb25maWRlbmNlOiAnaGlnaCcgfCAnbWVkaXVtJyB8ICdsb3cnO1xuXG4gICAgLyoqIERldGVjdGlvbiBtZXRob2QgdXNlZCAqL1xuICAgIG1ldGhvZDogc3RyaW5nO1xuXG4gICAgLyoqIFBhdHRlcm4gdGhhdCBtYXRjaGVkICovXG4gICAgcGF0dGVybjogc3RyaW5nO1xufVxuXG4vKipcbiAqIFBhcnNlZCBjb21wb25lbnRzIGZyb20gcmVsYXRpb24gZmllbGQgbmFtZVxuICovXG5pbnRlcmZhY2UgUGFyc2VkUmVsYXRpb25GaWVsZCB7XG4gICAgLyoqIFByZWZpeCAoZS5nLiwgJ2hvbWUnLCAnYXdheScsICdjb21wZXRpdG9yMScpICovXG4gICAgcHJlZml4Pzogc3RyaW5nO1xuICAgIC8qKiBCYXNlIG5hbWUgd2l0aG91dCBwcmVmaXggYW5kICdJZCcgc3VmZml4IChlLmcuLCAnVGVhbScpICovXG4gICAgYmFzZU5hbWU6IHN0cmluZztcbiAgICAvKiogV2hldGhlciBmaWVsZCBlbmRzIHdpdGggJ0lkJyAqL1xuICAgIGhhc0lkU3VmZml4OiBib29sZWFuO1xuICAgIC8qKiBPcmlnaW5hbCBmaWVsZCBuYW1lICovXG4gICAgb3JpZ2luYWxGaWVsZDogc3RyaW5nO1xufVxuXG4vKipcbiAqIFNtYXJ0IGRlZmF1bHQgY29uZmlndXJhdGlvblxuICovXG4vKipcbiAqIEZyYW1ld29yay1sZXZlbCBkZWZhdWx0IGRldGVjdGlvbiBjb25maWcuXG4gKiBDb250YWlucyBPTkxZIGRvbWFpbi1hZ25vc3RpYyBwYXR0ZXJucyB0aGF0IHdvcmsgYWNyb3NzIGFueSBhcHBsaWNhdGlvbi5cbiAqIFxuICogQXBwbGljYXRpb25zIHNob3VsZCBwcm92aWRlIGRvbWFpbi1zcGVjaWZpYyBwcmVmaXhlcyB2aWEgdWlDb25maWdPcHRpb25zLlxuICogXG4gKiBAZXhhbXBsZSBBcHBsaWNhdGlvbi1zcGVjaWZpYyBjb25maWcgKGluIGJhY2tlbmQgaW5kZXgudHMpOlxuICogYGBgdHlwZXNjcmlwdFxuICogY29uc3QgdWlDb25maWdPcHRpb25zID0ge1xuICogICBkdXBsaWNhdGVkRmllbGREZXRlY3Rpb246IHtcbiAqICAgICBwcmVmaXhlczogW1xuICogICAgICAgLy8gRG9tYWluLXNwZWNpZmljIHByZWZpeGVzIGZvciB5b3VyIGFwcFxuICogICAgICAgJ3BsYXllcicsICd0ZWFtJywgJ2xlYWd1ZScsICdzZWFzb24nLCAndmVudWUnLCAnc3BvcnQnLCAgLy8gU3BvcnRzIGFwcFxuICogICAgICAgLy8gT1I6ICdjdXN0b21lcicsICdvcmRlcicsICdwcm9kdWN0JywgJ2ludm9pY2UnICAvLyBFLWNvbW1lcmNlIGFwcFxuICogICAgICAgLy8gT1I6ICdhdXRob3InLCAnYm9vaycsICdwdWJsaXNoZXInLCAnZ2VucmUnICAvLyBMaWJyYXJ5IGFwcFxuICogICAgIF1cbiAqICAgfVxuICogfTtcbiAqIGBgYFxuICovXG5jb25zdCBERUZBVUxUX0RFVEVDVElPTl9DT05GSUc6IFJlcXVpcmVkPElEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25Db25maWc+ID0ge1xuICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgc3VmZml4ZXM6IHtcbiAgICAgICAgLy8gR2VuZXJpYyBkaXNwbGF5IHRleHQgcGF0dGVybnMgKHVuaXZlcnNhbClcbiAgICAgICAgZGlzcGxheTogWyAnTmFtZScsICdUaXRsZScsICdMYWJlbCcsICdEaXNwbGF5TmFtZScgXSxcbiAgICAgICAgLy8gR2VuZXJpYyB2aXN1YWwgYXNzZXQgcGF0dGVybnMgKHVuaXZlcnNhbClcbiAgICAgICAgdmlzdWFsOiBbICdMb2dvJywgJ0ltYWdlJywgJ0ljb24nLCAnQXZhdGFyJywgJ1BpY3R1cmUnIF0sXG4gICAgICAgIC8vIEdlbmVyaWMgbWV0YWRhdGEgcGF0dGVybnMgKHVuaXZlcnNhbClcbiAgICAgICAgbWV0YTogWyAnQ29kZScsICdTbHVnJywgJ0tleScsICdJZGVudGlmaWVyJywgJ1JlbW90ZUlkJyBdXG4gICAgfSxcbiAgICBwcmVmaXhlczogW1xuICAgICAgICAvLyBHZW5lcmljIHJlbGF0aW9uYWwgcGF0dGVybnMgKHVuaXZlcnNhbClcbiAgICAgICAgJ3BhcmVudCcsICdjaGlsZCcsXG4gICAgICAgICdzb3VyY2UnLCAndGFyZ2V0JywgJ2Rlc3RpbmF0aW9uJyxcbiAgICAgICAgJ3ByaW1hcnknLCAnc2Vjb25kYXJ5JywgJ3RlcnRpYXJ5JyxcbiAgICAgICAgJ21haW4nLCAnYWx0ZXJuYXRlJywgJ2ZhbGxiYWNrJyxcbiAgICAgICAgJ293bmVyJywgJ2NyZWF0b3InLCAnbW9kaWZpZXInLFxuICAgICAgICAnZmlyc3QnLCAnc2Vjb25kJywgJ3RoaXJkJywgJ2xhc3QnLFxuICAgICAgICAncHJldmlvdXMnLCAnbmV4dCcsICdjdXJyZW50JyxcbiAgICAgICAgJ29sZCcsICduZXcnLFxuICAgICAgICAnb3JpZ2luYWwnLCAnY29weScsICdkcmFmdCcsXG5cbiAgICAgICAgLy8gR2VuZXJpYyBkaXJlY3Rpb25hbCBwYXR0ZXJucyAodW5pdmVyc2FsKVxuICAgICAgICAnaG9tZScsICdhd2F5JyxcbiAgICAgICAgJ2xlZnQnLCAncmlnaHQnLFxuICAgICAgICAndG9wJywgJ2JvdHRvbScsXG4gICAgICAgICdpbm5lcicsICdvdXRlcicsXG5cbiAgICAgICAgLy8gR2VuZXJpYyBjb21wZXRpdGl2ZSBwYXR0ZXJucyAodW5pdmVyc2FsKVxuICAgICAgICAnd2lubmVyJywgJ2xvc2VyJyxcbiAgICAgICAgJ2NvbXBldGl0b3InLCAnb3Bwb25lbnQnXG5cbiAgICAgICAgLy8gTk9URTogRG9tYWluLXNwZWNpZmljIHByZWZpeGVzIChwbGF5ZXIsIHRlYW0sIGN1c3RvbWVyLCBvcmRlciwgZXRjLilcbiAgICAgICAgLy8gc2hvdWxkIGJlIHByb3ZpZGVkIHZpYSB1aUNvbmZpZ09wdGlvbnMgaW4geW91ciBhcHBsaWNhdGlvbidzIGJhY2tlbmRcbiAgICBdLFxuICAgIHRlbXBsYXRlU3R5bGU6ICdzaW1wbGUnLFxuICAgIGNvbmZpZGVuY2VUaHJlc2hvbGQ6ICdtZWRpdW0nLFxuICAgIGRlYnVnOiBmYWxzZVxufTtcblxuLyoqXG4gKiBNZXJnZSBjb25maWd1cmF0aW9ucyB3aXRoIHByaW9yaXR5OiBoaW50cyA+IGVudGl0eSA+IGdsb2JhbCA+IGRlZmF1bHRzXG4gKi9cbmZ1bmN0aW9uIG1lcmdlRGV0ZWN0aW9uQ29uZmlncyhcbiAgICBnbG9iYWxDb25maWc/OiBJRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uQ29uZmlnLFxuICAgIGVudGl0eUNvbmZpZz86IElEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25Db25maWcsXG4gICAgcmVsYXRpb25IaW50cz86IHtcbiAgICAgICAgcHJlZmVycmVkRmllbGRzPzogc3RyaW5nW107XG4gICAgICAgIGV4Y2x1ZGVGaWVsZHM/OiBzdHJpbmdbXTtcbiAgICAgICAgdGVtcGxhdGVTdHlsZT86ICdzaW1wbGUnIHwgJ2NvbXBvc2l0ZSc7XG4gICAgfVxuKTogUmVxdWlyZWQ8SUR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbkNvbmZpZz4gJiB7IHByZWZlcnJlZEZpZWxkcz86IHN0cmluZ1tdOyBleGNsdWRlRmllbGRzPzogc3RyaW5nW10gfSB7XG4gICAgLy8gU3RhcnQgd2l0aCBkZWZhdWx0c1xuICAgIGxldCBtZXJnZWQgPSB7IC4uLkRFRkFVTFRfREVURUNUSU9OX0NPTkZJRyB9O1xuXG4gICAgLy8gQXBwbHkgZ2xvYmFsIGNvbmZpZ1xuICAgIGlmIChnbG9iYWxDb25maWcpIHtcbiAgICAgICAgbWVyZ2VkID0ge1xuICAgICAgICAgICAgLi4ubWVyZ2VkLFxuICAgICAgICAgICAgLi4uZ2xvYmFsQ29uZmlnLFxuICAgICAgICAgICAgc3VmZml4ZXM6IHsgLi4ubWVyZ2VkLnN1ZmZpeGVzLCAuLi5nbG9iYWxDb25maWcuc3VmZml4ZXMgfSxcbiAgICAgICAgICAgIHByZWZpeGVzOiBnbG9iYWxDb25maWcucHJlZml4ZXMgfHwgbWVyZ2VkLnByZWZpeGVzXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gQXBwbHkgZW50aXR5IGNvbmZpZyAoaGlnaGVyIHByaW9yaXR5KVxuICAgIGlmIChlbnRpdHlDb25maWcpIHtcbiAgICAgICAgbWVyZ2VkID0ge1xuICAgICAgICAgICAgLi4ubWVyZ2VkLFxuICAgICAgICAgICAgLi4uZW50aXR5Q29uZmlnLFxuICAgICAgICAgICAgc3VmZml4ZXM6IHsgLi4ubWVyZ2VkLnN1ZmZpeGVzLCAuLi5lbnRpdHlDb25maWcuc3VmZml4ZXMgfSxcbiAgICAgICAgICAgIHByZWZpeGVzOiBlbnRpdHlDb25maWcucHJlZml4ZXMgfHwgbWVyZ2VkLnByZWZpeGVzXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gQXBwbHkgcmVsYXRpb24gaGludHMgKGhpZ2hlc3QgcHJpb3JpdHkpXG4gICAgY29uc3QgcmVzdWx0OiBhbnkgPSB7IC4uLm1lcmdlZCB9O1xuICAgIGlmIChyZWxhdGlvbkhpbnRzKSB7XG4gICAgICAgIGlmIChyZWxhdGlvbkhpbnRzLnRlbXBsYXRlU3R5bGUpIHtcbiAgICAgICAgICAgIHJlc3VsdC50ZW1wbGF0ZVN0eWxlID0gcmVsYXRpb25IaW50cy50ZW1wbGF0ZVN0eWxlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChyZWxhdGlvbkhpbnRzLnByZWZlcnJlZEZpZWxkcykge1xuICAgICAgICAgICAgcmVzdWx0LnByZWZlcnJlZEZpZWxkcyA9IHJlbGF0aW9uSGludHMucHJlZmVycmVkRmllbGRzO1xuICAgICAgICB9XG4gICAgICAgIGlmIChyZWxhdGlvbkhpbnRzLmV4Y2x1ZGVGaWVsZHMpIHtcbiAgICAgICAgICAgIHJlc3VsdC5leGNsdWRlRmllbGRzID0gcmVsYXRpb25IaW50cy5leGNsdWRlRmllbGRzO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLyoqXG4gKiBQYXJzZSByZWxhdGlvbiBmaWVsZCB0byBleHRyYWN0IHByZWZpeCBhbmQgYmFzZSBuYW1lLlxuICogXG4gKiBFeGFtcGxlczpcbiAqIC0gJ3RlYW1JZCcg4oaSIHsgYmFzZU5hbWU6ICdUZWFtJywgaGFzSWRTdWZmaXg6IHRydWUgfVxuICogLSAnaG9tZVRlYW1JZCcg4oaSIHsgcHJlZml4OiAnaG9tZScsIGJhc2VOYW1lOiAnVGVhbScsIGhhc0lkU3VmZml4OiB0cnVlIH1cbiAqIC0gJ2NvbXBldGl0b3IxVGVhbUlkJyDihpIgeyBwcmVmaXg6ICdjb21wZXRpdG9yMScsIGJhc2VOYW1lOiAnVGVhbScsIGhhc0lkU3VmZml4OiB0cnVlIH1cbiAqIC0gJ3Nwb3J0JyDihpIgeyBiYXNlTmFtZTogJ3Nwb3J0JywgaGFzSWRTdWZmaXg6IGZhbHNlIH1cbiAqL1xuZnVuY3Rpb24gcGFyc2VSZWxhdGlvbkZpZWxkKFxuICAgIGZpZWxkSWQ6IHN0cmluZyxcbiAgICBwcmVmaXhlczogc3RyaW5nW11cbik6IFBhcnNlZFJlbGF0aW9uRmllbGQge1xuICAgIC8vIEJ1aWxkIHJlZ2V4IGZvciBwcmVmaXggZGV0ZWN0aW9uOiBeKHByZWZpeDF8cHJlZml4MnwuLi4pKFxcXFxkKikoLispJFxuICAgIC8vIFVzZSBjYXNlLWluc2Vuc2l0aXZlIG1hdGNoaW5nXG4gICAgY29uc3QgcHJlZml4UGF0dGVybiA9IG5ldyBSZWdFeHAoXG4gICAgICAgIGBeKCR7cHJlZml4ZXMuam9pbignfCcpfSkoXFxcXGQqKSguKykkYCxcbiAgICAgICAgJ2knXG4gICAgKTtcblxuICAgIGNvbnN0IG1hdGNoID0gZmllbGRJZC5tYXRjaChwcmVmaXhQYXR0ZXJuKTtcblxuICAgIGlmIChtYXRjaCkge1xuICAgICAgICBjb25zdCBbICwgcHJlZml4LCBudW0sIHJlc3QgXSA9IG1hdGNoO1xuICAgICAgICBjb25zdCBoYXNJZFN1ZmZpeCA9IHJlc3QudG9Mb3dlckNhc2UoKS5lbmRzV2l0aCgnaWQnKTtcbiAgICAgICAgY29uc3QgYmFzZU5hbWUgPSBoYXNJZFN1ZmZpeFxuICAgICAgICAgICAgPyByZXN0LnN1YnN0cmluZygwLCByZXN0Lmxlbmd0aCAtIDIpXG4gICAgICAgICAgICA6IHJlc3Q7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHByZWZpeDogcHJlZml4ICsgbnVtLCAgLy8gJ2hvbWUnIG9yICdjb21wZXRpdG9yMSdcbiAgICAgICAgICAgIGJhc2VOYW1lLFxuICAgICAgICAgICAgaGFzSWRTdWZmaXgsXG4gICAgICAgICAgICBvcmlnaW5hbEZpZWxkOiBmaWVsZElkXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gTm8gcHJlZml4IGRldGVjdGVkXG4gICAgY29uc3QgaGFzSWRTdWZmaXggPSBmaWVsZElkLnRvTG93ZXJDYXNlKCkuZW5kc1dpdGgoJ2lkJyk7XG4gICAgY29uc3QgYmFzZU5hbWUgPSBoYXNJZFN1ZmZpeFxuICAgICAgICA/IGZpZWxkSWQuc3Vic3RyaW5nKDAsIGZpZWxkSWQubGVuZ3RoIC0gMilcbiAgICAgICAgOiBmaWVsZElkO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgYmFzZU5hbWUsXG4gICAgICAgIGhhc0lkU3VmZml4LFxuICAgICAgICBvcmlnaW5hbEZpZWxkOiBmaWVsZElkXG4gICAgfTtcbn1cblxuLyoqXG4gKiBHZW5lcmF0ZSBzZWFyY2ggcGF0dGVybnMgZm9yIGNhbmRpZGF0ZSBmaWVsZCBuYW1lcy5cbiAqIFxuICogUHJpb3JpdHk6XG4gKiAxLiBQcmVmZXJyZWQgZmllbGRzIChmcm9tIGhpbnRzKVxuICogMi4gRXhhY3QgcHJlZml4IG1hdGNoOiB7cHJlZml4fXtiYXNlTmFtZX17c3VmZml4fVxuICogMy4gRW50aXR5IG5hbWUgbWF0Y2g6IHtlbnRpdHlOYW1lfXtzdWZmaXh9XG4gKiA0LiBCYXNlIG5hbWUgbWF0Y2g6IHtiYXNlTmFtZX17c3VmZml4fVxuICovXG5mdW5jdGlvbiBnZW5lcmF0ZVNlYXJjaFBhdHRlcm5zKFxuICAgIHBhcnNlZDogUGFyc2VkUmVsYXRpb25GaWVsZCxcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgc3VmZml4ZXM6IHN0cmluZ1tdLFxuICAgIHByZWZlcnJlZEZpZWxkcz86IHN0cmluZ1tdXG4pOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgcGF0dGVybnM6IHN0cmluZ1tdID0gW107XG4gICAgY29uc3QgZW50aXR5TmFtZUxvd2VyID0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IGJhc2VOYW1lTG93ZXIgPSBwYXJzZWQuYmFzZU5hbWUudG9Mb3dlckNhc2UoKTtcblxuICAgIC8vIFByaW9yaXR5IDE6IFByZWZlcnJlZCBmaWVsZHMgKGV4YWN0IG1hdGNoKVxuICAgIGlmIChwcmVmZXJyZWRGaWVsZHMgJiYgcHJlZmVycmVkRmllbGRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcGF0dGVybnMucHVzaCguLi5wcmVmZXJyZWRGaWVsZHMpO1xuICAgIH1cblxuICAgIC8vIFByaW9yaXR5IDI6IFdpdGggcHJlZml4IChlLmcuLCBob21lVGVhbU5hbWUsIGF3YXlUZWFtTmFtZSlcbiAgICBpZiAocGFyc2VkLnByZWZpeCkge1xuICAgICAgICBjb25zdCBwcmVmaXhMb3dlciA9IHBhcnNlZC5wcmVmaXgudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgZm9yIChjb25zdCBzdWZmaXggb2Ygc3VmZml4ZXMpIHtcbiAgICAgICAgICAgIHBhdHRlcm5zLnB1c2goYCR7cHJlZml4TG93ZXJ9JHtiYXNlTmFtZUxvd2VyfSR7c3VmZml4LnRvTG93ZXJDYXNlKCl9YCk7XG4gICAgICAgICAgICBwYXR0ZXJucy5wdXNoKGAke3ByZWZpeExvd2VyfSR7ZW50aXR5TmFtZUxvd2VyfSR7c3VmZml4LnRvTG93ZXJDYXNlKCl9YCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBQcmlvcml0eSAzOiBFbnRpdHkgbmFtZSAoZS5nLiwgdGVhbU5hbWUgZm9yIHJlbGF0aW9uIHRvICd0ZWFtJylcbiAgICBmb3IgKGNvbnN0IHN1ZmZpeCBvZiBzdWZmaXhlcykge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGAke2VudGl0eU5hbWVMb3dlcn0ke3N1ZmZpeC50b0xvd2VyQ2FzZSgpfWApO1xuICAgIH1cblxuICAgIC8vIFByaW9yaXR5IDQ6IEJhc2UgbmFtZSAoZS5nLiwgdGVhbU5hbWUgZm9yICd0ZWFtSWQnKVxuICAgIGZvciAoY29uc3Qgc3VmZml4IG9mIHN1ZmZpeGVzKSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYCR7YmFzZU5hbWVMb3dlcn0ke3N1ZmZpeC50b0xvd2VyQ2FzZSgpfWApO1xuICAgIH1cblxuICAgIHJldHVybiBwYXR0ZXJucztcbn1cblxuLyoqXG4gKiBTZWFyY2ggZm9yIGZpZWxkcyBtYXRjaGluZyBwYXR0ZXJucywgZXhjbHVkaW5nIHNwZWNpZmllZCBmaWVsZHMuXG4gKi9cbmZ1bmN0aW9uIHNlYXJjaEZpZWxkc0J5UGF0dGVybnMoXG4gICAgYWxsUHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sXG4gICAgcGF0dGVybnM6IHN0cmluZ1tdLFxuICAgIGV4Y2x1ZGVGaWVsZHM/OiBzdHJpbmdbXVxuKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IGV4Y2x1ZGVTZXQgPSBuZXcgU2V0KGV4Y2x1ZGVGaWVsZHM/Lm1hcChmID0+IGYudG9Mb3dlckNhc2UoKSkgfHwgW10pO1xuICAgIGNvbnN0IGZvdW5kOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IHNlZW5Mb3dlciA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gICAgZm9yIChjb25zdCBwYXR0ZXJuIG9mIHBhdHRlcm5zKSB7XG4gICAgICAgIGNvbnN0IHBhdHRlcm5Mb3dlciA9IHBhdHRlcm4udG9Mb3dlckNhc2UoKTtcblxuICAgICAgICAvLyBTa2lwIGlmIGFscmVhZHkgZm91bmQgb3IgZXhjbHVkZWRcbiAgICAgICAgaWYgKHNlZW5Mb3dlci5oYXMocGF0dGVybkxvd2VyKSB8fCBleGNsdWRlU2V0LmhhcyhwYXR0ZXJuTG93ZXIpKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEZpbmQgbWF0Y2hpbmcgZmllbGQgKGNhc2UtaW5zZW5zaXRpdmUpXG4gICAgICAgIGNvbnN0IG1hdGNoID0gYWxsUHJvcGVydGllcy5maW5kKHAgPT5cbiAgICAgICAgICAgIHAuaWQ/LnRvTG93ZXJDYXNlKCkgPT09IHBhdHRlcm5Mb3dlciAmJlxuICAgICAgICAgICAgIWV4Y2x1ZGVTZXQuaGFzKHAuaWQudG9Mb3dlckNhc2UoKSlcbiAgICAgICAgKTtcblxuICAgICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgICAgIGZvdW5kLnB1c2gobWF0Y2guaWQpO1xuICAgICAgICAgICAgc2Vlbkxvd2VyLmFkZChtYXRjaC5pZC50b0xvd2VyQ2FzZSgpKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmb3VuZDtcbn1cblxuLyoqXG4gKiBDYWxjdWxhdGUgY29uZmlkZW5jZSBiYXNlZCBvbiBkZXRlY3Rpb24gbWV0aG9kIGFuZCBwYXR0ZXJuXG4gKi9cbmZ1bmN0aW9uIGNhbGN1bGF0ZUNvbmZpZGVuY2UoXG4gICAgZGV0ZWN0ZWRGaWVsZDogc3RyaW5nLFxuICAgIHBhcnNlZDogUGFyc2VkUmVsYXRpb25GaWVsZCxcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgbWV0aG9kOiAncHJlZmVycmVkJyB8ICdwcmVmaXgnIHwgJ2VudGl0eScgfCAnYmFzZSdcbik6ICdoaWdoJyB8ICdtZWRpdW0nIHwgJ2xvdycge1xuICAgIC8vIFByZWZlcnJlZCBmaWVsZHMgPSBoaWdoIGNvbmZpZGVuY2UgKGRldmVsb3BlciBleHBsaWNpdGx5IHNwZWNpZmllZClcbiAgICBpZiAobWV0aG9kID09PSAncHJlZmVycmVkJykgcmV0dXJuICdoaWdoJztcblxuICAgIGNvbnN0IGZpZWxkTG93ZXIgPSBkZXRlY3RlZEZpZWxkLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgZW50aXR5TG93ZXIgPSBlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgYmFzZUxvd2VyID0gcGFyc2VkLmJhc2VOYW1lLnRvTG93ZXJDYXNlKCk7XG5cbiAgICAvLyBFeGFjdCBwcmVmaXggKyBlbnRpdHkvYmFzZSBtYXRjaCA9IGhpZ2hcbiAgICBpZiAobWV0aG9kID09PSAncHJlZml4Jykge1xuICAgICAgICBpZiAoZmllbGRMb3dlci5pbmNsdWRlcyhlbnRpdHlMb3dlcikgfHwgZmllbGRMb3dlci5pbmNsdWRlcyhiYXNlTG93ZXIpKSB7XG4gICAgICAgICAgICByZXR1cm4gJ2hpZ2gnO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnbWVkaXVtJztcbiAgICB9XG5cbiAgICAvLyBFbnRpdHkgbmFtZSBtYXRjaCA9IGhpZ2hcbiAgICBpZiAobWV0aG9kID09PSAnZW50aXR5JykgcmV0dXJuICdoaWdoJztcblxuICAgIC8vIEJhc2UgbmFtZSBtYXRjaCA9IG1lZGl1bSAoY291bGQgYmUgY29pbmNpZGVudGFsKVxuICAgIGlmIChtZXRob2QgPT09ICdiYXNlJykgcmV0dXJuICdtZWRpdW0nO1xuXG4gICAgcmV0dXJuICdsb3cnO1xufVxuXG4vKipcbiAqIEdlbmVyYXRlIHRlbXBsYXRlIHN0cmluZyBmcm9tIGRldGVjdGVkIGZpZWxkcy5cbiAqL1xuZnVuY3Rpb24gZ2VuZXJhdGVUZW1wbGF0ZShcbiAgICBwcmltYXJ5RmllbGQ6IHN0cmluZyxcbiAgICBhbGxEZXRlY3RlZEZpZWxkczogRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uUmVzdWx0WyAnZGV0ZWN0ZWRGaWVsZHMnIF0sXG4gICAgdGVtcGxhdGVTdHlsZTogJ3NpbXBsZScgfCAnY29tcG9zaXRlJ1xuKTogc3RyaW5nIHtcbiAgICBpZiAodGVtcGxhdGVTdHlsZSA9PT0gJ3NpbXBsZScpIHtcbiAgICAgICAgcmV0dXJuIGB7JHtwcmltYXJ5RmllbGR9fWA7XG4gICAgfVxuXG4gICAgLy8gQ29tcG9zaXRlOiB0cnkgdG8gaW5jbHVkZSBtZXRhIGZpZWxkIChjb2RlL3NsdWcpIGlmIGF2YWlsYWJsZVxuICAgIGlmICh0ZW1wbGF0ZVN0eWxlID09PSAnY29tcG9zaXRlJyAmJiBhbGxEZXRlY3RlZEZpZWxkcy5tZXRhICYmIGFsbERldGVjdGVkRmllbGRzLm1ldGEubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBtZXRhRmllbGQgPSBhbGxEZXRlY3RlZEZpZWxkcy5tZXRhWyAwIF07XG4gICAgICAgIHJldHVybiBgeyR7cHJpbWFyeUZpZWxkfX0gKHske21ldGFGaWVsZH19KWA7XG4gICAgfVxuXG4gICAgLy8gRmFsbGJhY2sgdG8gc2ltcGxlIGlmIG5vIG1ldGEgZmllbGRcbiAgICByZXR1cm4gYHske3ByaW1hcnlGaWVsZH19YDtcbn1cblxuLyoqXG4gKiBFbmhhbmNlZCBzbWFydCBkdXBsaWNhdGVkIGZpZWxkIGRldGVjdGlvbi5cbiAqIFxuICogRGV0ZWN0cyBmaWVsZHMgbGlrZSAndGVhbU5hbWUnIGZvciAndGVhbUlkJyByZWxhdGlvbnMgd2l0aCBzdXBwb3J0IGZvcjpcbiAqIC0gUHJlZml4ZXMgKGhvbWUsIGF3YXksIGNvbXBldGl0b3IxLCBldGMuKVxuICogLSBNdWx0aXBsZSBzdWZmaXhlcyAoTmFtZSwgVGl0bGUsIExhYmVsLCBMb2dvLCBDb2RlLCBldGMuKVxuICogLSBQcmVmZXJyZWQgZmllbGRzIGFuZCBleGNsdXNpb25zXG4gKiAtIENvbmZpZGVuY2Ugc2NvcmluZ1xuICogLSBDb21wb3NpdGUgdGVtcGxhdGVzXG4gKiBcbiAqIEBwYXJhbSBhbGxQcm9wZXJ0aWVzIC0gQWxsIHByb3BlcnRpZXMgaW4gdGhlIHBhcmVudCBlbnRpdHlcbiAqIEBwYXJhbSByZWxhdGlvbkZpZWxkSWQgLSBUaGUgcmVsYXRpb24gZmllbGQgbmFtZSAoZS5nLiwgJ3RlYW1JZCcsICdob21lVGVhbUlkJylcbiAqIEBwYXJhbSByZWxhdGVkRW50aXR5TmFtZSAtIFJlbGF0ZWQgZW50aXR5IG5hbWUgKGUuZy4sICd0ZWFtJylcbiAqIEBwYXJhbSBnbG9iYWxDb25maWcgLSBHbG9iYWwgZGV0ZWN0aW9uIGNvbmZpZ3VyYXRpb25cbiAqIEBwYXJhbSBlbnRpdHlDb25maWcgLSBFbnRpdHktbGV2ZWwgZGV0ZWN0aW9uIGNvbmZpZ3VyYXRpb25cbiAqIEBwYXJhbSByZWxhdGlvbkhpbnRzIC0gUmVsYXRpb24tc3BlY2lmaWMgaGludHNcbiAqIEByZXR1cm5zIERldGVjdGlvbiByZXN1bHQgd2l0aCB0ZW1wbGF0ZSBhbmQgbWV0YWRhdGFcbiAqL1xuZnVuY3Rpb24gZGV0ZWN0RHVwbGljYXRlZFJlbGF0aW9uRmllbGRzKFxuICAgIGFsbFByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLFxuICAgIHJlbGF0aW9uRmllbGRJZDogc3RyaW5nLFxuICAgIHJlbGF0ZWRFbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgZ2xvYmFsQ29uZmlnPzogSUR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbkNvbmZpZyxcbiAgICBlbnRpdHlDb25maWc/OiBJRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uQ29uZmlnLFxuICAgIHJlbGF0aW9uSGludHM/OiB7XG4gICAgICAgIHByZWZlcnJlZEZpZWxkcz86IHN0cmluZ1tdO1xuICAgICAgICBleGNsdWRlRmllbGRzPzogc3RyaW5nW107XG4gICAgICAgIHRlbXBsYXRlU3R5bGU/OiAnc2ltcGxlJyB8ICdjb21wb3NpdGUnO1xuICAgIH1cbik6IER1cGxpY2F0ZWRGaWVsZERldGVjdGlvblJlc3VsdCB8IHVuZGVmaW5lZCB7XG4gICAgLy8gTWVyZ2UgY29uZmlndXJhdGlvbnNcbiAgICBjb25zdCBjb25maWcgPSBtZXJnZURldGVjdGlvbkNvbmZpZ3MoZ2xvYmFsQ29uZmlnLCBlbnRpdHlDb25maWcsIHJlbGF0aW9uSGludHMpO1xuXG4gICAgLy8gQ2hlY2sgaWYgZGV0ZWN0aW9uIGlzIGVuYWJsZWRcbiAgICBpZiAoIWNvbmZpZy5lbmFibGVkKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgLy8gUGFyc2UgcmVsYXRpb24gZmllbGRcbiAgICBjb25zdCBwYXJzZWQgPSBwYXJzZVJlbGF0aW9uRmllbGQocmVsYXRpb25GaWVsZElkLCBjb25maWcucHJlZml4ZXMpO1xuXG4gICAgLy8gU2VhcmNoIGZvciBkaXNwbGF5IGZpZWxkcyAoTmFtZSwgVGl0bGUsIExhYmVsKVxuICAgIGNvbnN0IGRpc3BsYXlQYXR0ZXJucyA9IGdlbmVyYXRlU2VhcmNoUGF0dGVybnMoXG4gICAgICAgIHBhcnNlZCxcbiAgICAgICAgcmVsYXRlZEVudGl0eU5hbWUsXG4gICAgICAgIGNvbmZpZy5zdWZmaXhlcz8uZGlzcGxheSB8fCBbXSxcbiAgICAgICAgY29uZmlnLnByZWZlcnJlZEZpZWxkc1xuICAgICk7XG4gICAgY29uc3QgZGlzcGxheUZpZWxkcyA9IHNlYXJjaEZpZWxkc0J5UGF0dGVybnMoYWxsUHJvcGVydGllcywgZGlzcGxheVBhdHRlcm5zLCBjb25maWcuZXhjbHVkZUZpZWxkcyk7XG5cbiAgICAvLyBTZWFyY2ggZm9yIHZpc3VhbCBmaWVsZHMgKExvZ28sIEltYWdlLCBJY29uKVxuICAgIGNvbnN0IHZpc3VhbFBhdHRlcm5zID0gZ2VuZXJhdGVTZWFyY2hQYXR0ZXJucyhcbiAgICAgICAgcGFyc2VkLFxuICAgICAgICByZWxhdGVkRW50aXR5TmFtZSxcbiAgICAgICAgY29uZmlnLnN1ZmZpeGVzPy52aXN1YWwgfHwgW11cbiAgICApO1xuICAgIGNvbnN0IHZpc3VhbEZpZWxkcyA9IHNlYXJjaEZpZWxkc0J5UGF0dGVybnMoYWxsUHJvcGVydGllcywgdmlzdWFsUGF0dGVybnMsIGNvbmZpZy5leGNsdWRlRmllbGRzKTtcblxuICAgIC8vIFNlYXJjaCBmb3IgbWV0YSBmaWVsZHMgKENvZGUsIFNsdWcsIEtleSlcbiAgICBjb25zdCBtZXRhUGF0dGVybnMgPSBnZW5lcmF0ZVNlYXJjaFBhdHRlcm5zKFxuICAgICAgICBwYXJzZWQsXG4gICAgICAgIHJlbGF0ZWRFbnRpdHlOYW1lLFxuICAgICAgICBjb25maWcuc3VmZml4ZXM/Lm1ldGEgfHwgW11cbiAgICApO1xuICAgIGNvbnN0IG1ldGFGaWVsZHMgPSBzZWFyY2hGaWVsZHNCeVBhdHRlcm5zKGFsbFByb3BlcnRpZXMsIG1ldGFQYXR0ZXJucywgY29uZmlnLmV4Y2x1ZGVGaWVsZHMpO1xuXG4gICAgLy8gTm8gZmllbGRzIGRldGVjdGVkXG4gICAgaWYgKGRpc3BsYXlGaWVsZHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgLy8gRGV0ZXJtaW5lIGRldGVjdGlvbiBtZXRob2RcbiAgICBjb25zdCBwcmltYXJ5RmllbGQgPSBkaXNwbGF5RmllbGRzWyAwIF07XG4gICAgbGV0IG1ldGhvZDogJ3ByZWZlcnJlZCcgfCAncHJlZml4JyB8ICdlbnRpdHknIHwgJ2Jhc2UnID0gJ2Jhc2UnO1xuICAgIGxldCBwYXR0ZXJuID0gJ3Vua25vd24nO1xuXG4gICAgaWYgKGNvbmZpZy5wcmVmZXJyZWRGaWVsZHMgJiYgY29uZmlnLnByZWZlcnJlZEZpZWxkcy5pbmNsdWRlcyhwcmltYXJ5RmllbGQpKSB7XG4gICAgICAgIG1ldGhvZCA9ICdwcmVmZXJyZWQnO1xuICAgICAgICBwYXR0ZXJuID0gJ3ByZWZlcnJlZF9maWVsZCc7XG4gICAgfSBlbHNlIGlmIChwYXJzZWQucHJlZml4ICYmIHByaW1hcnlGaWVsZC50b0xvd2VyQ2FzZSgpLnN0YXJ0c1dpdGgocGFyc2VkLnByZWZpeC50b0xvd2VyQ2FzZSgpKSkge1xuICAgICAgICBtZXRob2QgPSAncHJlZml4JztcbiAgICAgICAgcGF0dGVybiA9IGAke3BhcnNlZC5wcmVmaXh9e2VudGl0eX17c3VmZml4fWA7XG4gICAgfSBlbHNlIGlmIChwcmltYXJ5RmllbGQudG9Mb3dlckNhc2UoKS5zdGFydHNXaXRoKHJlbGF0ZWRFbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCkpKSB7XG4gICAgICAgIG1ldGhvZCA9ICdlbnRpdHknO1xuICAgICAgICBwYXR0ZXJuID0gYHtlbnRpdHl9e3N1ZmZpeH1gO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIG1ldGhvZCA9ICdiYXNlJztcbiAgICAgICAgcGF0dGVybiA9IGB7YmFzZX17c3VmZml4fWA7XG4gICAgfVxuXG4gICAgLy8gQ2FsY3VsYXRlIGNvbmZpZGVuY2VcbiAgICBjb25zdCBjb25maWRlbmNlID0gY2FsY3VsYXRlQ29uZmlkZW5jZShwcmltYXJ5RmllbGQsIHBhcnNlZCwgcmVsYXRlZEVudGl0eU5hbWUsIG1ldGhvZCk7XG5cbiAgICAvLyBDaGVjayBjb25maWRlbmNlIHRocmVzaG9sZFxuICAgIGNvbnN0IHRocmVzaG9sZE9yZGVyID0geyBsb3c6IDAsIG1lZGl1bTogMSwgaGlnaDogMiB9O1xuICAgIGlmICh0aHJlc2hvbGRPcmRlclsgY29uZmlkZW5jZSBdIDwgdGhyZXNob2xkT3JkZXJbIGNvbmZpZy5jb25maWRlbmNlVGhyZXNob2xkIF0pIHtcbiAgICAgICAgLy8gQ29uZmlkZW5jZSB0b28gbG93XG4gICAgICAgIGlmIChjb25maWcuZGVidWcpIHtcbiAgICAgICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW0R1cGxpY2F0ZWRGaWVsZERldGVjdGlvbl0gU2tpcHBpbmcgJHtyZWxhdGlvbkZpZWxkSWR9OiBjb25maWRlbmNlICR7Y29uZmlkZW5jZX0gPCB0aHJlc2hvbGQgJHtjb25maWcuY29uZmlkZW5jZVRocmVzaG9sZH1gKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8vIEdlbmVyYXRlIHRlbXBsYXRlXG4gICAgY29uc3QgdGVtcGxhdGUgPSBnZW5lcmF0ZVRlbXBsYXRlKFxuICAgICAgICBwcmltYXJ5RmllbGQsXG4gICAgICAgIHsgZGlzcGxheTogZGlzcGxheUZpZWxkcywgdmlzdWFsOiB2aXN1YWxGaWVsZHMsIG1ldGE6IG1ldGFGaWVsZHMgfSxcbiAgICAgICAgY29uZmlnLnRlbXBsYXRlU3R5bGVcbiAgICApO1xuXG4gICAgLy8gRGVidWcgbG9nZ2luZ1xuICAgIGlmIChjb25maWcuZGVidWcpIHtcbiAgICAgICAgRGVmYXVsdExvZ2dlci5pbmZvKGBbRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uXSAke3JlbGF0aW9uRmllbGRJZH0g4oaSICR7dGVtcGxhdGV9IChjb25maWRlbmNlOiAke2NvbmZpZGVuY2V9LCBtZXRob2Q6ICR7bWV0aG9kfSlgKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBwcmltYXJ5RmllbGQsXG4gICAgICAgIHRlbXBsYXRlLFxuICAgICAgICBkZXRlY3RlZEZpZWxkczoge1xuICAgICAgICAgICAgZGlzcGxheTogZGlzcGxheUZpZWxkcyxcbiAgICAgICAgICAgIHZpc3VhbDogdmlzdWFsRmllbGRzLmxlbmd0aCA+IDAgPyB2aXN1YWxGaWVsZHMgOiB1bmRlZmluZWQsXG4gICAgICAgICAgICBtZXRhOiBtZXRhRmllbGRzLmxlbmd0aCA+IDAgPyBtZXRhRmllbGRzIDogdW5kZWZpbmVkXG4gICAgICAgIH0sXG4gICAgICAgIGNvbmZpZGVuY2UsXG4gICAgICAgIG1ldGhvZCxcbiAgICAgICAgcGF0dGVyblxuICAgIH07XG59XG5cbi8qKlxuICogTGVnYWN5IHdyYXBwZXIgZnVuY3Rpb24gZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHkuXG4gKiBcbiAqIEBkZXByZWNhdGVkIFVzZSBkZXRlY3REdXBsaWNhdGVkUmVsYXRpb25GaWVsZHMoKSBmb3IgcmljaGVyIHJlc3VsdHNcbiAqL1xuZnVuY3Rpb24gZGV0ZWN0RHVwbGljYXRlZFJlbGF0aW9uRmllbGRUZW1wbGF0ZShcbiAgICBhbGxQcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSxcbiAgICByZWxhdGlvbkZpZWxkSWQ6IHN0cmluZyxcbiAgICByZWxhdGVkRW50aXR5TmFtZTogc3RyaW5nXG4pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IHJlc3VsdCA9IGRldGVjdER1cGxpY2F0ZWRSZWxhdGlvbkZpZWxkcyhcbiAgICAgICAgYWxsUHJvcGVydGllcyxcbiAgICAgICAgcmVsYXRpb25GaWVsZElkLFxuICAgICAgICByZWxhdGVkRW50aXR5TmFtZVxuICAgICk7XG4gICAgcmV0dXJuIHJlc3VsdD8udGVtcGxhdGU7XG59XG5cbi8qKlxuICogR2VuZXJhdGUgc21hcnQgZmFsbGJhY2sgY29uZmlndXJhdGlvbiBmb3IgcmVsYXRpb24gZGlzcGxheSB3aGVuIG9ubHkgSUQgaXMgYXZhaWxhYmxlLlxuICogVXNlcyBlbnRpdHkgbWV0YWRhdGEgKGljb24sIGVudGl0eU5hbWVQbHVyYWwpIHRvIGNyZWF0ZSB1c2VyLWZyaWVuZGx5IGZhbGxiYWNrIHRleHQuXG4gKiBcbiAqIEBwYXJhbSBlbnRpdHlOYW1lIC0gUmVsYXRlZCBlbnRpdHkgbmFtZSAoZS5nLiwgJ3RlYW0nKVxuICogQHBhcmFtIGlkRmllbGQgLSBJRCBmaWVsZCBuYW1lIChlLmcuLCAndGVhbUlkJylcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gRW50aXR5IHNlcnZpY2UgdG8gZ2V0IG1ldGFkYXRhIGZyb21cbiAqIEByZXR1cm5zIEZhbGxiYWNrIGNvbmZpZ3VyYXRpb24gd2l0aCB0ZW1wbGF0ZSwgbGlua1RleHQsIGFuZCBtb2RhbEJ1dHRvblRleHRcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIEZvciBhIHRlYW0gcmVsYXRpb25cbiAqIGdlbmVyYXRlUmVsYXRpb25GYWxsYmFjaygndGVhbScsICd0ZWFtSWQnLCB0ZWFtU2VydmljZSlcbiAqIC8vIFJldHVybnM6IHtcbiAqIC8vICAgdGVtcGxhdGU6ICdUZWFtOiB7dGVhbUlkfScsXG4gKiAvLyAgIGxpbmtUZXh0OiAnVmlldyBUZWFtJyxcbiAqIC8vICAgbW9kYWxCdXR0b25UZXh0OiAnVGVhbSBEZXRhaWxzJ1xuICogLy8gfVxuICovXG4vKipcbiAqIEdlbmVyYXRlcyBmYWxsYmFjayBkaXNwbGF5IGNvbmZpZ3VyYXRpb24gZm9yIHJlbGF0aW9uIGZpZWxkcy5cbiAqIFxuICogQ3JlYXRlcyB1c2VyLWZyaWVuZGx5IGZhbGxiYWNrIHRleHQgdG8gZGlzcGxheSB3aGVuIG9ubHkgdGhlIElEIG9mIGEgcmVsYXRlZCBlbnRpdHkgaXMgYXZhaWxhYmxlLlxuICogVXNlcyB0aGUgZW50aXR5J3MgcGx1cmFsIGRpc3BsYXkgbmFtZSAoZnJvbSBtZXRhZGF0YSkgb3IgZ2VuZXJhdGVzIGl0IGZyb20gdGhlIGVudGl0eSBuYW1lLlxuICogXG4gKiBAcGFyYW0gZW50aXR5TmFtZSAtIE5hbWUgb2YgdGhlIHJlbGF0ZWQgZW50aXR5IChlLmcuLCAndGVhbScsICd1c2VyJylcbiAqIEBwYXJhbSBpZEZpZWxkIC0gSUQgZmllbGQgbmFtZSAoZS5nLiwgJ3RlYW1JZCcsICd1c2VySWQnKVxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBPcHRpb25hbCBlbnRpdHkgc2VydmljZSB0byBmZXRjaCBtZXRhZGF0YSBmb3IgYmV0dGVyIG5hbWluZ1xuICogQHJldHVybnMgRmFsbGJhY2sgY29uZmlndXJhdGlvbiB3aXRoIHRlbXBsYXRlLCBsaW5rIHRleHQsIGFuZCBtb2RhbCBidXR0b24gdGV4dFxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY29uc3QgZmFsbGJhY2sgPSBnZW5lcmF0ZVJlbGF0aW9uRmFsbGJhY2soJ3RlYW0nLCAndGVhbUlkJyk7XG4gKiAvLyBSZXR1cm5zOiB7XG4gKiAvLyAgIHRlbXBsYXRlOiBcIlRlYW1zOiB7dGVhbUlkfVwiLFxuICogLy8gICBsaW5rVGV4dDogXCJWaWV3IFRlYW1zXCIsXG4gKiAvLyAgIG1vZGFsQnV0dG9uVGV4dDogXCJUZWFtcyBEZXRhaWxzXCJcbiAqIC8vIH1cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVSZWxhdGlvbkZhbGxiYWNrKFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBpZEZpZWxkOiBzdHJpbmcsXG4gICAgZW50aXR5U2VydmljZT86IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT5cbik6IE5vbk51bGxhYmxlPElSZWxhdGlvbkZpZWxkQ29uZmlnWyAnZGlzcGxheUNvbmZpZycgXT5bICdmYWxsYmFjaycgXSB7XG4gICAgLy8gVHJ5IHRvIGdldCBlbnRpdHkgbWV0YWRhdGEgZm9yIGJldHRlciBmYWxsYmFjayB0ZXh0XG4gICAgY29uc3QgZW50aXR5TWV0YWRhdGEgPSBlbnRpdHlTZXJ2aWNlPy5nZXRFbnRpdHlTY2hlbWE/LigpLm1vZGVsO1xuICAgIGNvbnN0IGRpc3BsYXlOYW1lID0gZW50aXR5TWV0YWRhdGE/LmVudGl0eU5hbWVQbHVyYWwgfHwgcGFzY2FsQ2FzZShlbnRpdHlOYW1lKTtcblxuICAgIHJldHVybiB7XG4gICAgICAgIC8vIEJhY2tlbmQgcHJlLWdlbmVyYXRlcyBmYWxsYmFjayB0ZW1wbGF0ZSAoaW50ZW50aW9uYWxseSBzdHJpbmctb25seSwgbm90IFRlbXBsYXRlIHR5cGUpXG4gICAgICAgIC8vIEZyb250ZW5kIHdpbGwgdXNlIHRoaXMgd2hlbiBvbmx5IElEIGlzIGF2YWlsYWJsZVxuICAgICAgICB0ZW1wbGF0ZTogYCR7ZGlzcGxheU5hbWV9OiB7JHtpZEZpZWxkfX1gLCAgLy8gZS5nLiwgXCJUZWFtOiB7dGVhbUlkfVwiXG4gICAgICAgIGxpbmtUZXh0OiBgVmlldyAke2Rpc3BsYXlOYW1lfWAsICAgICAgICAgICAvLyBlLmcuLCBcIlZpZXcgVGVhbVwiXG4gICAgICAgIG1vZGFsQnV0dG9uVGV4dDogYCR7ZGlzcGxheU5hbWV9IERldGFpbHNgICAvLyBlLmcuLCBcIlRlYW0gRGV0YWlsc1wiXG4gICAgfTtcbn1cblxuLyoqXG4gKiBMYWJlbCBmaWVsZCBkZXRlY3Rpb24gcmVzdWx0IHdpdGggY29uZmlkZW5jZSBzY29yaW5nXG4gKi9cbmludGVyZmFjZSBMYWJlbEZpZWxkRGV0ZWN0aW9uUmVzdWx0IHtcbiAgICBmaWVsZDogc3RyaW5nO1xuICAgIGNvbmZpZGVuY2U6ICdoaWdoJyB8ICdtZWRpdW0nOyAgLy8gT25seSBoaWdoIG9yIG1lZGl1bSAtIG5vIGxvdyBjb25maWRlbmNlIHJlc3VsdHMgcmV0dXJuZWRcbiAgICBtZXRob2Q6ICdtZXRhZGF0YScgfCAnY29tbW9uLXBhdHRlcm4nIHwgJ2VudGl0eS1wYXR0ZXJuJyB8ICdzdWZmaXgtcGF0dGVybic7XG59XG5cbi8qKlxuICogU21hcnQgbGFiZWwgZmllbGQgZGV0ZWN0aW9uIGZvciBlbnRpdHkgb3B0aW9ucy5cbiAqIFVzZXMgZ2VuZXJpYyBwYXR0ZXJucyB0byBmaW5kIGRpc3BsYXkgZmllbGRzIHRoYXQgYXJlIGFjdHVhbCBpZGVudGlmaWVycy9uYW1lcy5cbiAqIFxuICogKipISUdITFkgQ09OU0VSVkFUSVZFKio6IE9ubHkgcmV0dXJucyBmaWVsZHMgdGhhdCBhcmUgY2xlYXJseSBtZWFudCBmb3IgZGlzcGxheS5cbiAqIFJldHVybnMgdW5kZWZpbmVkIGlmIG5vIHByb3BlciBuYW1lIGZpZWxkIGlzIGZvdW5kIC0gYmV0dGVyIHRvIHNob3cgSUQgdGhhbiBjb25mdXNlIHVzZXJzLlxuICogXG4gKiBEZXRlY3Rpb24gb3JkZXIgKGFsbCBISUdIIG9yIE1FRElVTSBjb25maWRlbmNlKTpcbiAqIDEuIEVudGl0eSBtZXRhZGF0YSAoZW50aXR5TmFtZUF0dHJpYnV0ZSkgLSBISUdIIGNvbmZpZGVuY2VcbiAqIDIuIENvbW1vbiBkaXNwbGF5IGZpZWxkIHBhdHRlcm5zIChuYW1lLCB0aXRsZSwgbGFiZWwsIGRpc3BsYXlOYW1lKSAtIEhJR0ggY29uZmlkZW5jZSAgXG4gKiAzLiBFbnRpdHktc3BlY2lmaWMgcGF0dGVybnMgKHtlbnRpdHlOYW1lfU5hbWUsIHtlbnRpdHlOYW1lfVRpdGxlKSAtIEhJR0ggY29uZmlkZW5jZVxuICogNC4gRmllbGRzIGVuZGluZyB3aXRoIG5hbWUtbGlrZSBzdWZmaXhlcyAoTmFtZSwgVGl0bGUsIExhYmVsLCBDb2RlKSAtIE1FRElVTSBjb25maWRlbmNlXG4gKiBcbiAqICoqTk8gRkFMTEJBQ0sqKjogSWYgbm9uZSBvZiB0aGUgYWJvdmUgbWF0Y2gsIHJldHVybnMgdW5kZWZpbmVkLlxuICogV2UgZG8gTk9UIHBpY2sgZ2VuZXJpYyBmaWVsZHMgbGlrZSAnc3RhdHVzJywgJ3R5cGUnLCBvciByYW5kb20gZW51bXMvc3RyaW5ncy5cbiAqIFxuICogV2h5IG5vIGZhbGxiYWNrP1xuICogLSBTaG93aW5nIFwiYWN0aXZlXCIvXCJjYW5jZWxsZWRcIiBmb3Igc3Vic2NyaXB0aW9ucyBpcyBjb25mdXNpbmcgKHdoaWNoIHN1YnNjcmlwdGlvbj8pXG4gKiAtIFNob3dpbmcgXCJjcmVkaXRfY2FyZFwiL1wicGF5cGFsXCIgZm9yIHBheW1lbnQgbWV0aG9kcyBpcyBub3QgYW4gaWRlbnRpZmllclxuICogLSBCZXR0ZXIgdG8gc2hvdyBzdWJzY3JpcHRpb25JZCB0aGFuIG1pc2xlYWRpbmcgZmllbGRzXG4gKiBcbiAqIEZvciBlbnRpdGllcyB3aXRob3V0IG5hbWUgZmllbGRzLCB1c2Ugb25lIG9mOlxuICogLSBTZXQgZW50aXR5TmFtZUF0dHJpYnV0ZSBpbiBzY2hlbWEgbWV0YWRhdGFcbiAqIC0gVXNlIG9wdGlvbk1hcHBpbmcgaW4gcmVsYXRpb24gY29uZmlnXG4gKiAtIExldCBpdCBmYWxsIGJhY2sgdG8gSUQgKGNsZWFyZXN0IG9wdGlvbilcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIEVudGl0aWVzIHdpdGggY2xlYXIgbmFtZSBmaWVsZHMgLSBERVRFQ1RFRCDinIVcbiAqIFRlYW0g4oaSIHRlYW1OYW1lIChQcmlvcml0eSAzLCBISUdIIGNvbmZpZGVuY2UpXG4gKiBVc2VyIOKGkiBuYW1lIChQcmlvcml0eSAyLCBISUdIIGNvbmZpZGVuY2UpXG4gKiBQb3N0IOKGkiBwb3N0VGl0bGUgKFByaW9yaXR5IDQsIE1FRElVTSBjb25maWRlbmNlKVxuICogXG4gKiBAZXhhbXBsZSAgXG4gKiAvLyBFbnRpdGllcyB3aXRob3V0IG5hbWUgZmllbGRzIC0gUkVUVVJOUyB1bmRlZmluZWQg4pyFXG4gKiBTdWJzY3JpcHRpb24g4oaSIHVuZGVmaW5lZCAoZmFsbHMgYmFjayB0byBzdWJzY3JpcHRpb25JZCAtIGNsZWFyISlcbiAqIFBheW1lbnRNZXRob2Qg4oaSIHVuZGVmaW5lZCAoZmFsbHMgYmFjayB0byBwYXltZW50TWV0aG9kSWQgLSBjbGVhciEpXG4gKiBBdWRpdExvZyDihpIgdW5kZWZpbmVkIChmYWxscyBiYWNrIHRvIGF1ZGl0TG9nSWQgLSBjbGVhciEpXG4gKiBcbiAqIEBwYXJhbSBzY2hlbWEgLSBFbnRpdHkgc2NoZW1hXG4gKiBAcGFyYW0gZW50aXR5TmFtZSAtIEVudGl0eSBuYW1lIChlLmcuLCAndGVhbScsICd1c2VyJylcbiAqIEBwYXJhbSBvcHRpb25zIC0gRGV0ZWN0aW9uIG9wdGlvbnNcbiAqIEByZXR1cm5zIEJlc3QgbGFiZWwgZmllbGQgbmFtZSBvciB1bmRlZmluZWQgKHdpbGwgZmFsbCBiYWNrIHRvIElEIGZpZWxkKVxuICovXG5mdW5jdGlvbiBmaW5kTGFiZWxGaWVsZChcbiAgICBzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PixcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgb3B0aW9ucz86IHtcbiAgICAgICAgLyoqIE1pbmltdW0gY29uZmlkZW5jZSBsZXZlbCByZXF1aXJlZCAoZGVmYXVsdDogJ21lZGl1bScpICovXG4gICAgICAgIG1pbkNvbmZpZGVuY2U/OiAnaGlnaCcgfCAnbWVkaXVtJztcbiAgICAgICAgLyoqIEVuYWJsZSBkZWJ1ZyBsb2dnaW5nIChkZWZhdWx0OiBmYWxzZSkgKi9cbiAgICAgICAgZGVidWc/OiBib29sZWFuO1xuICAgIH1cbik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgbWluQ29uZmlkZW5jZSA9IG9wdGlvbnM/Lm1pbkNvbmZpZGVuY2UgfHwgJ21lZGl1bSc7XG4gICAgY29uc3QgZGVidWcgPSBvcHRpb25zPy5kZWJ1ZyB8fCBmYWxzZTtcblxuICAgIGxldCByZXN1bHQ6IExhYmVsRmllbGREZXRlY3Rpb25SZXN1bHQgfCB1bmRlZmluZWQ7XG5cbiAgICAvLyBHZXQgYWxsIGF0dHJpYnV0ZXMgZnJvbSBzY2hlbWFcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gc2NoZW1hLmF0dHJpYnV0ZXM7XG4gICAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSBPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKTtcblxuICAgIC8vIFByaW9yaXR5IDE6IEVudGl0eSBtZXRhZGF0YSAtIEhJR0ggY29uZmlkZW5jZVxuICAgIGNvbnN0IGVudGl0eU5hbWVBdHRyaWJ1dGUgPSBzY2hlbWEubW9kZWwuZW50aXR5TmFtZUF0dHJpYnV0ZTtcbiAgICBpZiAoZW50aXR5TmFtZUF0dHJpYnV0ZSAmJiBhdHRyaWJ1dGVzWyBlbnRpdHlOYW1lQXR0cmlidXRlIF0pIHtcbiAgICAgICAgcmVzdWx0ID0ge1xuICAgICAgICAgICAgZmllbGQ6IGVudGl0eU5hbWVBdHRyaWJ1dGUsXG4gICAgICAgICAgICBjb25maWRlbmNlOiAnaGlnaCcsXG4gICAgICAgICAgICBtZXRob2Q6ICdtZXRhZGF0YSdcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKGRlYnVnKSB7XG4gICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtmaW5kTGFiZWxGaWVsZF0gJHtlbnRpdHlOYW1lfTogRm91bmQgdmlhIG1ldGFkYXRhIC0gJHtlbnRpdHlOYW1lQXR0cmlidXRlfSAoSElHSCBjb25maWRlbmNlKWApO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gUHJpb3JpdHkgMjogQ29tbW9uIGRpc3BsYXkgcGF0dGVybnMgLSBISUdIIGNvbmZpZGVuY2VcbiAgICBpZiAoIXJlc3VsdCkge1xuICAgICAgICBjb25zdCBjb21tb25QYXR0ZXJucyA9IFsgJ25hbWUnLCAndGl0bGUnLCAnbGFiZWwnLCAnZGlzcGxheU5hbWUnLCAnZGlzcGxheW5hbWUnIF07XG4gICAgICAgIGZvciAoY29uc3QgcGF0dGVybiBvZiBjb21tb25QYXR0ZXJucykge1xuICAgICAgICAgICAgY29uc3QgbWF0Y2ggPSBhdHRyaWJ1dGVOYW1lcy5maW5kKGF0dHIgPT4gYXR0ci50b0xvd2VyQ2FzZSgpID09PSBwYXR0ZXJuKTtcbiAgICAgICAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICAgICAgICAgIHJlc3VsdCA9IHtcbiAgICAgICAgICAgICAgICAgICAgZmllbGQ6IG1hdGNoLFxuICAgICAgICAgICAgICAgICAgICBjb25maWRlbmNlOiAnaGlnaCcsXG4gICAgICAgICAgICAgICAgICAgIG1ldGhvZDogJ2NvbW1vbi1wYXR0ZXJuJ1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgaWYgKGRlYnVnKSB7XG4gICAgICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW2ZpbmRMYWJlbEZpZWxkXSAke2VudGl0eU5hbWV9OiBGb3VuZCB2aWEgY29tbW9uIHBhdHRlcm4gJyR7cGF0dGVybn0nIC0gJHttYXRjaH0gKEhJR0ggY29uZmlkZW5jZSlgKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBQcmlvcml0eSAzOiBFbnRpdHktc3BlY2lmaWMgcGF0dGVybnMgLSBISUdIIGNvbmZpZGVuY2VcbiAgICBpZiAoIXJlc3VsdCkge1xuICAgICAgICBjb25zdCBlbnRpdHlMb3dlciA9IGVudGl0eU5hbWUudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgY29uc3QgZW50aXR5U3BlY2lmaWNTdWZmaXhlcyA9IFsgJ05hbWUnLCAnVGl0bGUnLCAnTGFiZWwnIF07XG5cbiAgICAgICAgZm9yIChjb25zdCBzdWZmaXggb2YgZW50aXR5U3BlY2lmaWNTdWZmaXhlcykge1xuICAgICAgICAgICAgLy8gVHJ5IGV4YWN0IG1hdGNoOiBlLmcuLCAndGVhbU5hbWUnIGZvciBlbnRpdHkgJ3RlYW0nXG4gICAgICAgICAgICBjb25zdCBleGFjdE1hdGNoID0gYXR0cmlidXRlTmFtZXMuZmluZChhdHRyID0+XG4gICAgICAgICAgICAgICAgYXR0ci50b0xvd2VyQ2FzZSgpID09PSBgJHtlbnRpdHlMb3dlcn0ke3N1ZmZpeC50b0xvd2VyQ2FzZSgpfWBcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBpZiAoZXhhY3RNYXRjaCkge1xuICAgICAgICAgICAgICAgIHJlc3VsdCA9IHtcbiAgICAgICAgICAgICAgICAgICAgZmllbGQ6IGV4YWN0TWF0Y2gsXG4gICAgICAgICAgICAgICAgICAgIGNvbmZpZGVuY2U6ICdoaWdoJyxcbiAgICAgICAgICAgICAgICAgICAgbWV0aG9kOiAnZW50aXR5LXBhdHRlcm4nXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBpZiAoZGVidWcpIHtcbiAgICAgICAgICAgICAgICAgICAgRGVmYXVsdExvZ2dlci5pbmZvKGBbZmluZExhYmVsRmllbGRdICR7ZW50aXR5TmFtZX06IEZvdW5kIHZpYSBlbnRpdHktc3BlY2lmaWMgcGF0dGVybiAtICR7ZXhhY3RNYXRjaH0gKEhJR0ggY29uZmlkZW5jZSlgKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBQcmlvcml0eSA0OiBGaWVsZHMgZW5kaW5nIHdpdGggbmFtZS1saWtlIHN1ZmZpeGVzIC0gTUVESVVNIGNvbmZpZGVuY2VcbiAgICAvLyBMb29rIGZvciBhbnkgZmllbGQgZW5kaW5nIHdpdGggJ05hbWUnLCAnVGl0bGUnLCAnTGFiZWwnIChlLmcuLCAnZGlzcGxheU5hbWUnLCAnZnVsbE5hbWUnLCAndXNlck5hbWUnLClcbiAgICBpZiAoIXJlc3VsdCkge1xuICAgICAgICBjb25zdCBkaXNwbGF5TmFtZVN1ZmZpeFBhdHRlcm4gPSAvRGlzcGxheU5hbWUkLztcbiAgICAgICAgY29uc3QgbmFtZVN1ZmZpeFBhdHRlcm4gPSAvTmFtZSQvO1xuICAgICAgICBjb25zdCB0aXRsZVN1ZmZpeFBhdHRlcm4gPSAvVGl0bGUkLztcbiAgICAgICAgY29uc3QgbGFiZWxTdWZmaXhQYXR0ZXJuID0gL0xhYmVsJC87XG4gICAgICAgIGNvbnN0IGNvZGVTdWZmaXhQYXR0ZXJuID0gL0NvZGUkLztcblxuICAgICAgICBmb3IgKGNvbnN0IHBhdHRlcm4gb2YgWyBkaXNwbGF5TmFtZVN1ZmZpeFBhdHRlcm4sIGxhYmVsU3VmZml4UGF0dGVybiwgdGl0bGVTdWZmaXhQYXR0ZXJuLCBuYW1lU3VmZml4UGF0dGVybiwgY29kZVN1ZmZpeFBhdHRlcm4gXSkge1xuICAgICAgICAgICAgY29uc3QgbWF0Y2ggPSBhdHRyaWJ1dGVOYW1lcy5maW5kKGF0dHIgPT4gcGF0dGVybi50ZXN0KGF0dHIpKTtcbiAgICAgICAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICAgICAgICAgIHJlc3VsdCA9IHtcbiAgICAgICAgICAgICAgICAgICAgZmllbGQ6IG1hdGNoLFxuICAgICAgICAgICAgICAgICAgICBjb25maWRlbmNlOiAnbWVkaXVtJyxcbiAgICAgICAgICAgICAgICAgICAgbWV0aG9kOiAnc3VmZml4LXBhdHRlcm4nXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBpZiAoZGVidWcpIHtcbiAgICAgICAgICAgICAgICAgICAgRGVmYXVsdExvZ2dlci5pbmZvKGBbZmluZExhYmVsRmllbGRdICR7ZW50aXR5TmFtZX06IEZvdW5kIHZpYSBzdWZmaXggcGF0dGVybiAtICR7bWF0Y2h9IChNRURJVU0gY29uZmlkZW5jZSlgKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBQcmlvcml0eSA1OiBOTyBGQUxMQkFDSyAtIElmIHdlIGNhbid0IGZpbmQgYSBwcm9wZXIgbmFtZSBmaWVsZCwgcmV0dXJuIHVuZGVmaW5lZFxuICAgIC8vIEJldHRlciB0byBzaG93IElEIHRoYW4gdG8gc2hvdyBjb25mdXNpbmcgZmllbGRzIGxpa2UgJ3N0YXR1cycsICd0eXBlJywgZXRjLlxuICAgIC8vIFxuICAgIC8vIEVudGl0aWVzIGxpa2UgU3Vic2NyaXB0aW9uLCBQYXltZW50TWV0aG9kIGRvbid0IGhhdmUgdHJhZGl0aW9uYWwgbmFtZSBmaWVsZHMuXG4gICAgLy8gU2hvd2luZyBcImFjdGl2ZVwiIG9yIFwiY3JlZGl0X2NhcmRcIiBpbiBhIGRyb3Bkb3duIGlzIGNvbmZ1c2luZyAtIHVzZXJzIGNhbid0IGRpc3Rpbmd1aXNoIGl0ZW1zLlxuICAgIC8vIEl0J3MgY2xlYXJlciB0byBzaG93IHRoZSBJRCAoc3Vic2NyaXB0aW9uSWQsIHBheW1lbnRNZXRob2RJZCkgaW4gc3VjaCBjYXNlcy5cbiAgICAvL1xuICAgIC8vIElmIHlvdSBuZWVkIGN1c3RvbSBsYWJlbHMgZm9yIHRoZXNlIGVudGl0aWVzLCBleHBsaWNpdGx5IHNldCBlbnRpdHlOYW1lQXR0cmlidXRlIGluIHRoZSBzY2hlbWFcbiAgICAvLyBvciB1c2Ugb3B0aW9uTWFwcGluZyBpbiB0aGUgcmVsYXRpb24gY29uZmlnLlxuXG4gICAgLy8gQ2hlY2sgY29uZmlkZW5jZSB0aHJlc2hvbGRcbiAgICBpZiAocmVzdWx0KSB7XG4gICAgICAgIC8vIE9ubHkgcmV0dXJuIGlmIGNvbmZpZGVuY2UgbWVldHMgbWluaW11bSByZXF1aXJlbWVudFxuICAgICAgICAvLyBtaW5Db25maWRlbmNlOiAnaGlnaCcg4oaSIG9ubHkgcmV0dXJuIEhJR0ggY29uZmlkZW5jZSByZXN1bHRzXG4gICAgICAgIC8vIG1pbkNvbmZpZGVuY2U6ICdtZWRpdW0nIOKGkiByZXR1cm4gSElHSCBvciBNRURJVU0gY29uZmlkZW5jZSByZXN1bHRzIChkZWZhdWx0KVxuICAgICAgICBpZiAobWluQ29uZmlkZW5jZSA9PT0gJ2hpZ2gnICYmIHJlc3VsdC5jb25maWRlbmNlID09PSAnbWVkaXVtJykge1xuICAgICAgICAgICAgaWYgKGRlYnVnKSB7XG4gICAgICAgICAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBbZmluZExhYmVsRmllbGRdICR7ZW50aXR5TmFtZX06IEZpZWxkICcke3Jlc3VsdC5maWVsZH0nIGZvdW5kIHdpdGggTUVESVVNIGNvbmZpZGVuY2UsIGJ1dCBISUdIIGNvbmZpZGVuY2UgcmVxdWlyZWQuIFJldHVybmluZyB1bmRlZmluZWQuYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdC5maWVsZDtcbiAgICB9XG5cbiAgICAvLyBObyBzdWl0YWJsZSBmaWVsZCBmb3VuZFxuICAgIGlmIChkZWJ1Zykge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYFtmaW5kTGFiZWxGaWVsZF0gJHtlbnRpdHlOYW1lfTogTm8gc3VpdGFibGUgbGFiZWwgZmllbGQgZm91bmQgd2l0aCBzdWZmaWNpZW50IGNvbmZpZGVuY2UuYCk7XG4gICAgfVxuICAgIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUkVMQVRJT04gT1BUSU9OIENPTkZJRyBSRVNPTFVUSU9OXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBSZXNvbHZlcyBSZWxhdGlvbkVudGl0eU9wdGlvbkNvbmZpZyBpbnRvIEZpZWxkT3B0aW9uc0FQSUNvbmZpZyBieSBhdXRvLWRldGVjdGluZzpcbiAqIC0gQ1JVRCBBUEkgcGF0aCBmcm9tIGVudGl0eSBzY2hlbWFcbiAqIC0gTGFiZWwgZmllbGQgZnJvbSBlbnRpdHlOYW1lQXR0cmlidXRlIG1ldGFkYXRhIG9yIHNtYXJ0IGRldGVjdGlvblxuICogLSBWYWx1ZSBmaWVsZCBmcm9tIHJlbGF0aW9uIGlkZW50aWZpZXJzXG4gKiBcbiAqIEBwYXJhbSByZWxhdGlvbkNvbmZpZyAtIE1pbmltYWwgcmVsYXRpb24gb3B0aW9uIGNvbmZpZ1xuICogQHBhcmFtIHJlbGF0aW9uQXR0cmlidXRlIC0gVGhlIHJlbGF0aW9uIGF0dHJpYnV0ZSAodG8gZ2V0IGlkZW50aWZpZXJzKVxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSBmb3Igc2NoZW1hIGxvb2t1cFxuICogQHBhcmFtIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyAtIEdsb2JhbCBVSSBjb25maWcgb3B0aW9ucyAoZm9yIGxhYmVsIGZpZWxkIGRldGVjdGlvbilcbiAqIEByZXR1cm5zIEZ1bGx5IHJlc29sdmVkIEZpZWxkT3B0aW9uc0FQSUNvbmZpZyBvciB1bmRlZmluZWQgaWYgZW50aXR5IG5vdCBmb3VuZFxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVJlbGF0aW9uT3B0aW9uQ29uZmlnKFxuICAgIHJlbGF0aW9uQ29uZmlnOiBSZWxhdGlvbkVudGl0eU9wdGlvbkNvbmZpZyxcbiAgICByZWxhdGlvbkF0dHJpYnV0ZTogVElPU2NoZW1hQXR0cmlidXRlICYgeyByZWxhdGlvbjogTm9uTnVsbGFibGU8VElPU2NoZW1hQXR0cmlidXRlWyAncmVsYXRpb24nIF0+IH0sXG4gICAgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PixcbiAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbICd1aUNvbmZpZ0dlbk9wdGlvbnMnIF1cbik6IEZpZWxkT3B0aW9uc0FQSUNvbmZpZzxhbnk+IHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCB7IGVudGl0eU5hbWUsIGN1c3RvbUFwaVVybCwgb3B0aW9uTWFwcGluZywgLi4ucmVzdCB9ID0gcmVsYXRpb25Db25maWc7XG4gICAgY29uc3QgcmVsYXRpb24gPSByZWxhdGlvbkF0dHJpYnV0ZS5yZWxhdGlvbjtcblxuICAgIC8vIEdldCByZWxhdGVkIGVudGl0eSBzZXJ2aWNlXG4gICAgaWYgKCFlbnRpdHlTZXJ2aWNlLmhhc0VudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUoZW50aXR5TmFtZSkpIHtcbiAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBbcmVzb2x2ZVJlbGF0aW9uT3B0aW9uQ29uZmlnXSBFbnRpdHkgc2VydmljZSBub3QgZm91bmQgZm9yOiAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgY29uc3QgcmVsYXRlZFNlcnZpY2UgPSBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUoZW50aXR5TmFtZSk7XG4gICAgY29uc3QgcmVsYXRlZFNjaGVtYSA9IHJlbGF0ZWRTZXJ2aWNlPy5nZXRFbnRpdHlTY2hlbWE/LigpO1xuXG4gICAgaWYgKCFyZWxhdGVkU2NoZW1hKSB7XG4gICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgW3Jlc29sdmVSZWxhdGlvbk9wdGlvbkNvbmZpZ10gU2NoZW1hIG5vdCBmb3VuZCBmb3IgZW50aXR5OiAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgLy8gMS4gUmVzb2x2ZSBBUEkgVVJMXG4gICAgY29uc3QgZW50aXR5TmFtZUxvd2VyID0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IGNydWRQYXRoID0gcmVsYXRlZFNjaGVtYS5tb2RlbC5DUlVEQXBpUGF0aCB8fCAnJztcbiAgICBjb25zdCBhcGlVcmwgPSBjdXN0b21BcGlVcmwgfHwgYCR7Y3J1ZFBhdGh9LyR7ZW50aXR5TmFtZUxvd2VyfWA7XG5cbiAgICAvLyAyLiBSZXNvbHZlIHZhbHVlIGZpZWxkIGZyb20gcmVsYXRpb24gaWRlbnRpZmllcnNcbiAgICBjb25zdCByZXNvbHZlZElkZW50aWZpZXJzID0gdHlwZW9mIHJlbGF0aW9uLmlkZW50aWZpZXJzID09PSAnZnVuY3Rpb24nID8gcmVsYXRpb24uaWRlbnRpZmllcnMoKSA6IHJlbGF0aW9uLmlkZW50aWZpZXJzO1xuICAgIGNvbnN0IGlkZW50aWZpZXJNYXBwaW5ncyA9IEFycmF5LmlzQXJyYXkocmVzb2x2ZWRJZGVudGlmaWVycykgPyByZXNvbHZlZElkZW50aWZpZXJzIDogWyByZXNvbHZlZElkZW50aWZpZXJzIF07XG4gICAgY29uc3QgcHJpbWFyeUlkZW50aWZpZXIgPSBpZGVudGlmaWVyTWFwcGluZ3NbIDAgXTtcbiAgICBjb25zdCB2YWx1ZUZpZWxkID0gU3RyaW5nKHByaW1hcnlJZGVudGlmaWVyLnRhcmdldCk7XG5cbiAgICAvLyAzLiBSZXNvbHZlIGxhYmVsIGZpZWxkIGZyb20gZW50aXR5IG1ldGFkYXRhIG9yIGN1c3RvbSBtYXBwaW5nXG4gICAgbGV0IGxhYmVsRmllbGQgPSB2YWx1ZUZpZWxkOyAvLyBEZWZhdWx0IGZhbGxiYWNrIHRvIHZhbHVlIGZpZWxkXG5cbiAgICBpZiAob3B0aW9uTWFwcGluZz8ubGFiZWwpIHtcbiAgICAgICAgLy8gQ3VzdG9tIGxhYmVsIHByb3ZpZGVkIC0gdXNlIGl0XG4gICAgICAgIGxhYmVsRmllbGQgPSBvcHRpb25NYXBwaW5nLmxhYmVsIGFzIHN0cmluZztcbiAgICB9IGVsc2Uge1xuICAgICAgICAvLyBBdXRvLWRldGVjdCB1c2luZyBzbWFydCBwYXR0ZXJuIG1hdGNoaW5nIHdpdGggZ2xvYmFsIGNvbmZpZ1xuICAgICAgICBjb25zdCBsYWJlbEZpZWxkQ29uZmlnID0gZ2xvYmFsVUlDb25maWdPcHRpb25zPy5sYWJlbEZpZWxkRGV0ZWN0aW9uO1xuICAgICAgICBsYWJlbEZpZWxkID0gZmluZExhYmVsRmllbGQocmVsYXRlZFNjaGVtYSwgZW50aXR5TmFtZSwge1xuICAgICAgICAgICAgbWluQ29uZmlkZW5jZTogbGFiZWxGaWVsZENvbmZpZz8ubWluQ29uZmlkZW5jZSB8fCAnbWVkaXVtJyxcbiAgICAgICAgICAgIGRlYnVnOiBsYWJlbEZpZWxkQ29uZmlnPy5kZWJ1ZyB8fCBmYWxzZVxuICAgICAgICB9KSB8fCB2YWx1ZUZpZWxkO1xuICAgIH1cblxuICAgIC8vIDQuIEJ1aWxkIGNvbXBsZXRlIEZpZWxkT3B0aW9uc0FQSUNvbmZpZ1xuICAgIHJldHVybiB7XG4gICAgICAgIGFwaU1ldGhvZDogJ0dFVCcsXG4gICAgICAgIGFwaVVybCxcbiAgICAgICAgcmVzcG9uc2VLZXk6ICdpdGVtcycsXG4gICAgICAgIG9wdGlvbk1hcHBpbmc6IG9wdGlvbk1hcHBpbmcgfHwge1xuICAgICAgICAgICAgbGFiZWw6IGxhYmVsRmllbGQsXG4gICAgICAgICAgICB2YWx1ZTogKG9wdGlvbk1hcHBpbmcgYXMgYW55KT8udmFsdWUgfHwgdmFsdWVGaWVsZFxuICAgICAgICB9LFxuICAgICAgICAuLi5yZXN0IC8vIFBhc3MgdGhyb3VnaCBmaWx0ZXJzLCBjb3VudCwgZGlzYWJsZVNlYXJjaCwgZXRjLlxuICAgIH07XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRklMVEVSIEFVVE8tR0VORVJBVElPTlxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogQXV0by1nZW5lcmF0ZXMgZmlsdGVyQ29uZmlnIGZvciBlbnRpdHkgYXR0cmlidXRlcyBiYXNlZCBvbiBmaWVsZCB0eXBlLlxuICogXG4gKiBBbGdvcml0aG06XG4gKiAxLiBDaGVjayBpZiBleHBsaWNpdCBmaWx0ZXJDb25maWcgYWxyZWFkeSBleGlzdHMg4oaSIHVzZSBpdFxuICogMi4gQ2hlY2sgaWYgZmllbGQgaXMgZXhwbGljaXRseSBub24tZmlsdGVyYWJsZSDihpIgc2tpcFxuICogMy4gRGV0ZWN0IGZpZWxkIHR5cGUgYW5kIGdlbmVyYXRlIGFwcHJvcHJpYXRlIGNvbmZpZ1xuICogNC4gTWVyZ2Ugd2l0aCBnbG9iYWwgYW5kIGVudGl0eS1sZXZlbCBvdmVycmlkZXNcbiAqIFxuICogQHBhcmFtIGF0dHJpYnV0ZSAtIFRoZSBhdHRyaWJ1dGUgdG8gZ2VuZXJhdGUgZmlsdGVyIGNvbmZpZyBmb3JcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gRW50aXR5IHNlcnZpY2UgZm9yIGFjY2Vzc2luZyBlbnRpdHkgbWV0YWRhdGFcbiAqIEBwYXJhbSBnbG9iYWxVSUNvbmZpZ09wdGlvbnMgLSBHbG9iYWwgVUkgY29uZmlndXJhdGlvbiBvcHRpb25zXG4gKiBAcmV0dXJucyBHZW5lcmF0ZWQgZmlsdGVyIGNvbmZpZ3VyYXRpb24gb3IgdW5kZWZpbmVkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZW5lcmF0ZUZpbHRlckNvbmZpZyhcbiAgICBhdHRyaWJ1dGU6IFRJT1NjaGVtYUF0dHJpYnV0ZSxcbiAgICBlbnRpdHlTZXJ2aWNlPzogQmFzZUVudGl0eVNlcnZpY2U8YW55PixcbiAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbICd1aUNvbmZpZ0dlbk9wdGlvbnMnIF1cbik6IEZpZWxkTWV0YWRhdGFbICdmaWx0ZXJDb25maWcnIF0gfCB1bmRlZmluZWQge1xuICAgIC8vIDEuIElmIGV4cGxpY2l0IGZpbHRlckNvbmZpZyBleGlzdHMsIHVzZSBpdCAoaGlnaGVzdCBwcmlvcml0eSlcbiAgICBpZiAoYXR0cmlidXRlLmZpbHRlckNvbmZpZykge1xuICAgICAgICByZXR1cm4gYXR0cmlidXRlLmZpbHRlckNvbmZpZztcbiAgICB9XG5cbiAgICAvLyAyLiBJZiBmaWVsZCBoYXMgZXhwbGljaXQgb3B0aW9ucyBjb25maWcsIHVzZSBpdFxuICAgIGlmICgnb3B0aW9ucycgaW4gYXR0cmlidXRlKSB7XG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSAoYXR0cmlidXRlIGFzIFNlbGVjdEZpZWxkTWV0YWRhdGEpLm9wdGlvbnM7XG5cbiAgICAgICAgLy8gUmVsYXRpb25FbnRpdHlPcHRpb25Db25maWcgKGhhcyBlbnRpdHlOYW1lKSDihpIgcmVzb2x2ZSB0byBGaWVsZE9wdGlvbnNBUElDb25maWdcbiAgICAgICAgY29uc3QgaXNSZWxhdGlvbkNvbmZpZyA9IHR5cGVvZiBvcHRpb25zID09PSAnb2JqZWN0JyAmJiAhQXJyYXkuaXNBcnJheShvcHRpb25zKSAmJiAnZW50aXR5TmFtZScgaW4gb3B0aW9ucztcblxuICAgICAgICBsZXQgcmVzb2x2ZWRDb25maWc6IEZpZWxkT3B0aW9uc0FQSUNvbmZpZzxhbnk+IHwgRmllbGRPcHRpb25bXSB8IHVuZGVmaW5lZDtcblxuICAgICAgICAvLyBJbmxpbmUgYXJyYXkg4oaSIHVzZSBhcyBpc1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShvcHRpb25zKSAmJiBvcHRpb25zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHJlc29sdmVkQ29uZmlnID0gb3B0aW9ucyBhcyBGaWVsZE9wdGlvbltdO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRmllbGRPcHRpb25zQVBJQ29uZmlnIChoYXMgYXBpTWV0aG9kLCBhcGlVcmwsIHJlc3BvbnNlS2V5KSDihpIgcGFzcyB0aHJvdWdoXG4gICAgICAgIGNvbnN0IGlzQXBpQ29uZmlnID0gdHlwZW9mIG9wdGlvbnMgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KG9wdGlvbnMpICYmICdhcGlNZXRob2QnIGluIG9wdGlvbnM7XG4gICAgICAgIGlmIChpc0FwaUNvbmZpZykge1xuICAgICAgICAgICAgcmVzb2x2ZWRDb25maWcgPSBvcHRpb25zIGFzIEZpZWxkT3B0aW9uc0FQSUNvbmZpZzxhbnk+O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGlzUmVsYXRpb25Db25maWcgJiYgYXR0cmlidXRlLnJlbGF0aW9uICYmIGVudGl0eVNlcnZpY2UpIHtcbiAgICAgICAgICAgIHJlc29sdmVkQ29uZmlnID0gcmVzb2x2ZVJlbGF0aW9uT3B0aW9uQ29uZmlnKFxuICAgICAgICAgICAgICAgIG9wdGlvbnMgYXMgUmVsYXRpb25FbnRpdHlPcHRpb25Db25maWcsXG4gICAgICAgICAgICAgICAgYXR0cmlidXRlIGFzIFRJT1NjaGVtYUF0dHJpYnV0ZSAmIHsgcmVsYXRpb246IE5vbk51bGxhYmxlPFRJT1NjaGVtYUF0dHJpYnV0ZVsgJ3JlbGF0aW9uJyBdPiB9LFxuICAgICAgICAgICAgICAgIGVudGl0eVNlcnZpY2UsXG4gICAgICAgICAgICAgICAgZ2xvYmFsVUlDb25maWdPcHRpb25zXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHJlc29sdmVkQ29uZmlnKSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIGZpbHRlclR5cGU6ICdzZWxlY3QnLFxuICAgICAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogJ2VxJyBhcyBjb25zdCxcbiAgICAgICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IFsgJ2VxJywgJ25lcScsICdpbkxpc3QnLCAnbm90SW5MaXN0JywgJ2V4aXN0cycsICdub3RFeGlzdHMnIF0sXG4gICAgICAgICAgICAgICAgcHJlZGVmaW5lZE9wdGlvbnM6IHJlc29sdmVkQ29uZmlnXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gZWxzZSBsb2cgZXJyb3JcbiAgICAgICAgdGhyb3cgbmV3IEZyYW1ld29ya0Vycm9yKGBbZ2VuZXJhdGVGaWx0ZXJDb25maWddIE5vIHJlc29sdmVkIGNvbmZpZyBmb3VuZCBmb3IgYXR0cmlidXRlOiAke2F0dHJpYnV0ZS5pZH1gLCB7XG4gICAgICAgICAgICBhdHRyaWJ1dGU6IGF0dHJpYnV0ZSxcbiAgICAgICAgICAgIG9wdGlvbnM6IG9wdGlvbnMsXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIDMuIElmIGZpZWxkIGlzIGV4cGxpY2l0bHkgbm9uLWZpbHRlcmFibGUsIHNraXBcbiAgICBpZiAoYXR0cmlidXRlLmlzRmlsdGVyYWJsZSA9PT0gZmFsc2UpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyAzLiBHZXQgZ2xvYmFsIGFuZCBlbnRpdHktbGV2ZWwgY29uZmlnXG4gICAgY29uc3QgZ2xvYmFsRmlsdGVyQ29uZmlnID0gZ2xvYmFsVUlDb25maWdPcHRpb25zPy50YWJsZVVJPy5maWx0ZXJBdXRvR2VuZXJhdGlvbjtcbiAgICBjb25zdCBlbnRpdHlNZXRhZGF0YSA9IGVudGl0eVNlcnZpY2U/LmdldEVudGl0eVNjaGVtYT8uKCkubW9kZWw/Lm1ldGFkYXRhIGFzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PlsgJ21vZGVsJyBdWyAnbWV0YWRhdGEnIF07XG4gICAgY29uc3QgZW50aXR5RmlsdGVyQ29uZmlnID0gZW50aXR5TWV0YWRhdGE/LnRhYmxlVUk/LmZpbHRlckF1dG9HZW5lcmF0aW9uO1xuXG4gICAgLy8gTWVyZ2UgY29uZmlncyAoZW50aXR5ID4gZ2xvYmFsID4gZGVmYXVsdHMpXG4gICAgY29uc3QgbWVyZ2VkQ29uZmlnID0ge1xuICAgICAgICBlbmFibGVkOiBlbnRpdHlGaWx0ZXJDb25maWc/LmVuYWJsZWQgPz8gZ2xvYmFsRmlsdGVyQ29uZmlnPy5lbmFibGVkID8/IHRydWUsXG4gICAgICAgIGRhdGVGaWVsZHM6IHtcbiAgICAgICAgICAgIC4uLmdsb2JhbEZpbHRlckNvbmZpZz8uZGF0ZUZpZWxkcyxcbiAgICAgICAgICAgIC4uLmVudGl0eUZpbHRlckNvbmZpZz8uZGF0ZUZpZWxkc1xuICAgICAgICB9LFxuICAgICAgICBlbnVtRmllbGRzOiB7XG4gICAgICAgICAgICAuLi5nbG9iYWxGaWx0ZXJDb25maWc/LmVudW1GaWVsZHMsXG4gICAgICAgICAgICAuLi5lbnRpdHlGaWx0ZXJDb25maWc/LmVudW1GaWVsZHNcbiAgICAgICAgfSxcbiAgICAgICAgYm9vbGVhbkZpZWxkczoge1xuICAgICAgICAgICAgLi4uZ2xvYmFsRmlsdGVyQ29uZmlnPy5ib29sZWFuRmllbGRzLFxuICAgICAgICAgICAgLi4uZW50aXR5RmlsdGVyQ29uZmlnPy5ib29sZWFuRmllbGRzXG4gICAgICAgIH0sXG4gICAgICAgIHJlbGF0aW9uRmllbGRzOiB7XG4gICAgICAgICAgICAuLi5nbG9iYWxGaWx0ZXJDb25maWc/LnJlbGF0aW9uRmllbGRzLFxuICAgICAgICAgICAgLi4uZW50aXR5RmlsdGVyQ29uZmlnPy5yZWxhdGlvbkZpZWxkc1xuICAgICAgICB9LFxuICAgICAgICBudW1iZXJGaWVsZHM6IHtcbiAgICAgICAgICAgIC4uLmdsb2JhbEZpbHRlckNvbmZpZz8ubnVtYmVyRmllbGRzLFxuICAgICAgICAgICAgLi4uZW50aXR5RmlsdGVyQ29uZmlnPy5udW1iZXJGaWVsZHNcbiAgICAgICAgfSxcbiAgICAgICAgdGV4dEZpZWxkczoge1xuICAgICAgICAgICAgLi4uZ2xvYmFsRmlsdGVyQ29uZmlnPy50ZXh0RmllbGRzLFxuICAgICAgICAgICAgLi4uZW50aXR5RmlsdGVyQ29uZmlnPy50ZXh0RmllbGRzXG4gICAgICAgIH0sXG4gICAgICAgIGRlYnVnOiBlbnRpdHlGaWx0ZXJDb25maWc/LmRlYnVnID8/IGdsb2JhbEZpbHRlckNvbmZpZz8uZGVidWcgPz8gZmFsc2VcbiAgICB9O1xuXG4gICAgLy8gSWYgZ2xvYmFsbHkgZGlzYWJsZWQsIHNraXBcbiAgICBpZiAoIW1lcmdlZENvbmZpZy5lbmFibGVkKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgY29uc3QgYXR0clR5cGUgPSBhdHRyaWJ1dGUudHlwZTtcbiAgICBjb25zdCBmaWVsZFR5cGUgPSBhdHRyaWJ1dGUuZmllbGRUeXBlO1xuXG4gICAgLy8gKioxLiBCb29sZWFuIGZpZWxkcyoqXG4gICAgaWYgKGF0dHJUeXBlID09PSAnYm9vbGVhbicgJiYgbWVyZ2VkQ29uZmlnLmJvb2xlYW5GaWVsZHM/LmVuYWJsZWQgIT09IGZhbHNlKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBmaWx0ZXJUeXBlOiAnYm9vbGVhbicsXG4gICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6ICdlcScsXG4gICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IFsgJ2VxJywgJ25lcScsICdleGlzdHMnLCAnbm90RXhpc3RzJyBdLFxuICAgICAgICAgICAgcHJlZGVmaW5lZE9wdGlvbnM6IFtcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnWWVzJywgdmFsdWU6IFwidHJ1ZVwiIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ05vJywgdmFsdWU6IFwiZmFsc2VcIiB9XG4gICAgICAgICAgICBdXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gKioyLiBFbnVtIGZpZWxkcyAoYXJyYXkgb2Ygc3RyaW5ncy9udW1iZXJzKSoqXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoYXR0clR5cGUpICYmIG1lcmdlZENvbmZpZy5lbnVtRmllbGRzPy5lbmFibGVkICE9PSBmYWxzZSkge1xuICAgICAgICBjb25zdCBkZWZhdWx0RW51bU9wcyA9IFsgJ2VxJywgJ25lcScsICdpbkxpc3QnLCAnbm90SW5MaXN0JywgJ2V4aXN0cycsICdub3RFeGlzdHMnIF0gYXMgY29uc3Q7XG4gICAgICAgIGNvbnN0IGRlZmF1bHRPcCA9IG1lcmdlZENvbmZpZy5lbnVtRmllbGRzPy5kZWZhdWx0T3BlcmF0b3IgfHwgKCdlcScpO1xuICAgICAgICBjb25zdCBhdmFpbGFibGVPcHMgPSBtZXJnZWRDb25maWcuZW51bUZpZWxkcz8uYXZhaWxhYmxlT3BlcmF0b3JzIHx8IGRlZmF1bHRFbnVtT3BzO1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBmaWx0ZXJUeXBlOiAnc2VsZWN0JyxcbiAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogZGVmYXVsdE9wLFxuICAgICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBhdmFpbGFibGVPcHMsXG4gICAgICAgICAgICBwcmVkZWZpbmVkT3B0aW9uczogYXR0clR5cGUubWFwKHZhbCA9PiAoe1xuICAgICAgICAgICAgICAgIGxhYmVsOiBTdHJpbmcodmFsKSxcbiAgICAgICAgICAgICAgICB2YWx1ZTogU3RyaW5nKHZhbCkgIC8vIEFsd2F5cyBjb252ZXJ0IHRvIHN0cmluZyBmb3IgY29uc2lzdGVuY3lcbiAgICAgICAgICAgIH0pKVxuICAgICAgICB9O1xuICAgIH1cblxuXG4gICAgLy8gKiozLiBEYXRlL0RhdGV0aW1lIGZpZWxkcyoqXG4gICAgaWYgKChmaWVsZFR5cGUgPT09ICdkYXRlJyB8fCBmaWVsZFR5cGUgPT09ICdkYXRldGltZScgfHwgKGF0dHJUeXBlID09PSAnc3RyaW5nJyAmJiAoYXR0cmlidXRlLmlkLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoJ2RhdGUnKSB8fCBhdHRyaWJ1dGUuaWQudG9Mb3dlckNhc2UoKS5pbmNsdWRlcygndGltZScpKSkpXG4gICAgICAgICYmIG1lcmdlZENvbmZpZy5kYXRlRmllbGRzPy5lbmFibGVkICE9PSBmYWxzZSkge1xuICAgICAgICBjb25zdCBkZWZhdWx0RGF0ZU9wcyA9IFsgJ2VxJywgJ25lcScsICdndCcsICdndGUnLCAnbHQnLCAnbHRlJywgJ2JldHdlZW4nLCAnZXhpc3RzJywgJ25vdEV4aXN0cycgXSBhcyBjb25zdDtcbiAgICAgICAgY29uc3Qgb3BlcmF0b3JzID0gbWVyZ2VkQ29uZmlnLmRhdGVGaWVsZHM/LmRlZmF1bHRPcGVyYXRvcnMgfHwgZGVmYXVsdERhdGVPcHM7XG5cbiAgICAgICAgY29uc3QgZmlsdGVyQ29uZmlnOiBhbnkgPSB7XG4gICAgICAgICAgICBmaWx0ZXJUeXBlOiAnZGF0ZXRpbWUnLFxuICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBvcGVyYXRvcnNbIDAgXSB8fCAoJ2d0ZScpLFxuICAgICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBvcGVyYXRvcnNcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBBZGQgcXVpY2sgZGF0ZSBmaWx0ZXJzIGlmIGVuYWJsZWRcbiAgICAgICAgaWYgKG1lcmdlZENvbmZpZy5kYXRlRmllbGRzPy5xdWlja0ZpbHRlcnMgIT09IGZhbHNlKSB7XG4gICAgICAgICAgICBmaWx0ZXJDb25maWcucHJlZGVmaW5lZE9wdGlvbnMgPSBbXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ1RvZGF5JywgdmFsdWU6ICc6c3RhcnRPZlRvZGF5JyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdZZXN0ZXJkYXknLCB2YWx1ZTogJzpzdGFydE9mWWVzdGVyZGF5JyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdUaGlzIFdlZWsnLCB2YWx1ZTogJzpzdGFydE9mV2VlaycgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnTGFzdCBXZWVrJywgdmFsdWU6ICc6c3RhcnRPZkxhc3RXZWVrJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdUaGlzIE1vbnRoJywgdmFsdWU6ICc6c3RhcnRPZk1vbnRoJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdMYXN0IE1vbnRoJywgdmFsdWU6ICc6c3RhcnRPZkxhc3RNb250aCcgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnVGhpcyBRdWFydGVyJywgdmFsdWU6ICc6c3RhcnRPZlF1YXJ0ZXInIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ0xhc3QgUXVhcnRlcicsIHZhbHVlOiAnOnN0YXJ0T2ZMYXN0UXVhcnRlcicgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnVGhpcyBZZWFyJywgdmFsdWU6ICc6c3RhcnRPZlllYXInIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ0xhc3QgWWVhcicsIHZhbHVlOiAnOnN0YXJ0T2ZMYXN0WWVhcicgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnTGFzdCA3IERheXMnLCB2YWx1ZTogJzpub3dNaW51czdEYXlzJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdMYXN0IDMwIERheXMnLCB2YWx1ZTogJzpub3dNaW51czMwRGF5cycgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnTGFzdCA5MCBEYXlzJywgdmFsdWU6ICc6bm93TWludXM5MERheXMnIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ0N1c3RvbSBEYXRlJywgdmFsdWU6IG51bGwgfSAgLy8gVHJpZ2dlcnMgZGF0ZXRpbWUtbG9jYWwgaW5wdXRcbiAgICAgICAgICAgIF07XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZmlsdGVyQ29uZmlnO1xuICAgIH1cblxuICAgIC8vICoqNS4gTnVtYmVyIGZpZWxkcyoqXG4gICAgaWYgKGF0dHJUeXBlID09PSAnbnVtYmVyJyAmJiBtZXJnZWRDb25maWcubnVtYmVyRmllbGRzPy5lbmFibGVkICE9PSBmYWxzZSkge1xuICAgICAgICBjb25zdCBkZWZhdWx0TnVtYmVyT3BzID0gWyAnZXEnLCAnbmVxJywgJ2d0JywgJ2d0ZScsICdsdCcsICdsdGUnLCAnYmV0d2VlbicsICdleGlzdHMnLCAnbm90RXhpc3RzJyBdIGFzIGNvbnN0O1xuICAgICAgICBjb25zdCBvcGVyYXRvcnMgPSBtZXJnZWRDb25maWcubnVtYmVyRmllbGRzPy5kZWZhdWx0T3BlcmF0b3JzIHx8IGRlZmF1bHROdW1iZXJPcHM7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBmaWx0ZXJUeXBlOiAnbnVtYmVyJyxcbiAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogb3BlcmF0b3JzWyAwIF0gfHwgKCdlcScpLFxuICAgICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBvcGVyYXRvcnNcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyAqKjQuIFJlbGF0aW9uIGZpZWxkcyAod2l0aG91dCBleHBsaWNpdCBvcHRpb25zKSAtIGF1dG8tZ2VuZXJhdGUgZnJvbSByZWxhdGlvbiBtZXRhZGF0YSoqXG4gICAgaWYgKGF0dHJpYnV0ZS5yZWxhdGlvbiAmJiBtZXJnZWRDb25maWcucmVsYXRpb25GaWVsZHM/LmVuYWJsZWQgIT09IGZhbHNlICYmIGVudGl0eVNlcnZpY2UpIHtcbiAgICAgICAgY29uc3QgcmVsYXRpb25Db25maWc6IFJlbGF0aW9uRW50aXR5T3B0aW9uQ29uZmlnID0geyBlbnRpdHlOYW1lOiBhdHRyaWJ1dGUucmVsYXRpb24uZW50aXR5TmFtZSB9O1xuICAgICAgICBjb25zdCByZXNvbHZlZCA9IHJlc29sdmVSZWxhdGlvbk9wdGlvbkNvbmZpZyhcbiAgICAgICAgICAgIHJlbGF0aW9uQ29uZmlnLFxuICAgICAgICAgICAgYXR0cmlidXRlIGFzIFRJT1NjaGVtYUF0dHJpYnV0ZSAmIHsgcmVsYXRpb246IE5vbk51bGxhYmxlPFRJT1NjaGVtYUF0dHJpYnV0ZVsgJ3JlbGF0aW9uJyBdPiB9LFxuICAgICAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9uc1xuICAgICAgICApO1xuXG4gICAgICAgIGlmIChyZXNvbHZlZCkge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBmaWx0ZXJUeXBlOiAncmVsYXRpb24nLFxuICAgICAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogJ2VxJyBhcyBjb25zdCxcbiAgICAgICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IFsgJ2VxJywgJ25lcScsICdpbkxpc3QnLCAnbm90SW5MaXN0JywgJ2V4aXN0cycsICdub3RFeGlzdHMnIF0sXG4gICAgICAgICAgICAgICAgcHJlZGVmaW5lZE9wdGlvbnM6IHJlc29sdmVkXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gKio2LiBUZXh0IGZpZWxkcyAoZGVmYXVsdCBmYWxsYmFjaykqKlxuICAgIGlmIChhdHRyVHlwZSA9PT0gJ3N0cmluZycgJiYgbWVyZ2VkQ29uZmlnLnRleHRGaWVsZHM/LmVuYWJsZWQgIT09IGZhbHNlKSB7XG4gICAgICAgIGNvbnN0IGRlZmF1bHRUZXh0T3BzID0gWyAnY29udGFpbnMnLCAnbm90Q29udGFpbnMnLCAnZXEnLCAnbmVxJywgJ3N0YXJ0c1dpdGgnLCAnZW5kc1dpdGgnLCAnbGlrZScsICdleGlzdHMnLCAnbm90RXhpc3RzJyBdO1xuICAgICAgICBjb25zdCBvcGVyYXRvcnMgPSBtZXJnZWRDb25maWcudGV4dEZpZWxkcz8uZGVmYXVsdE9wZXJhdG9ycyB8fCBkZWZhdWx0VGV4dE9wcztcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGZpbHRlclR5cGU6ICd0ZXh0JyxcbiAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogb3BlcmF0b3JzWyAwIF0gfHwgKCdjb250YWlucycpLFxuICAgICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBvcGVyYXRvcnNcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBEZWJ1ZyBsb2dnaW5nXG4gICAgaWYgKG1lcmdlZENvbmZpZy5kZWJ1Zykge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtGaWx0ZXJBdXRvR2VuXSAke2F0dHJpYnV0ZS5pZH06IE5vIGZpbHRlciBjb25maWcgZ2VuZXJhdGVkICh0eXBlOiAke2F0dHJUeXBlfSlgKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNFR01FTlQgQVVUTy1HRU5FUkFUSU9OXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBTbWFydCBpY29uIG1hcHBpbmcgZm9yIHNlZ21lbnQgdmFsdWVzLlxuICogUHJvdmlkZXMgc2Vuc2libGUgZGVmYXVsdHMgZm9yIGNvbW1vbiBzdGF0dXMvc3RhdGUgcGF0dGVybnMuXG4gKiBJY29ucyBtYXRjaCB1aTI0L3NyYy9jb3JlL2NvbW1vbi9JY29ucy9JY29ucy50c3ggbmFtaW5nIGNvbnZlbnRpb25zLlxuICovXG5jb25zdCBERUZBVUxUX0lDT05fTUFQUElORzogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgICAvLyBBY3RpdmUvSW5hY3RpdmUgcGF0dGVybnNcbiAgICAnYWN0aXZlJzogJ0NoZWNrQ2lyY2xlT3V0bGluZWQnLFxuICAgICdpbmFjdGl2ZSc6ICdDbG9zZUNpcmNsZU91dGxpbmVkJyxcbiAgICAnZW5hYmxlZCc6ICdDaGVja0NpcmNsZU91dGxpbmVkJyxcbiAgICAnZGlzYWJsZWQnOiAnQ2xvc2VDaXJjbGVPdXRsaW5lZCcsXG5cbiAgICAvLyBTdGF0dXMgcGF0dGVybnNcbiAgICAncGVuZGluZyc6ICdDbG9ja0NpcmNsZU91dGxpbmVkJyxcbiAgICAnaW4tcHJvZ3Jlc3MnOiAnU3luY091dGxpbmVkJyxcbiAgICAnaW5wcm9ncmVzcyc6ICdTeW5jT3V0bGluZWQnLFxuICAgICdjb21wbGV0ZWQnOiAnQ2hlY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2RvbmUnOiAnQ2hlY2tPdXRsaW5lZCcsXG4gICAgJ2ZpbmlzaGVkJzogJ0NoZWNrQ2lyY2xlT3V0bGluZWQnLFxuICAgICdjYW5jZWxsZWQnOiAnQ2xvc2VDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2NhbmNlbGVkJzogJ0Nsb3NlQ2lyY2xlT3V0bGluZWQnLFxuICAgICdmYWlsZWQnOiAnQ2xvc2VDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2Vycm9yJzogJ0V4Y2xhbWF0aW9uQ2lyY2xlT3V0bGluZWQnLFxuICAgICdwYXVzZWQnOiAnUGF1c2VDaXJjbGVPdXRsaW5lZCcsXG5cbiAgICAvLyBTY2hlZHVsaW5nIHBhdHRlcm5zXG4gICAgJ3NjaGVkdWxlZCc6ICdDYWxlbmRhck91dGxpbmVkJyxcbiAgICAndXBjb21pbmcnOiAnQ2FsZW5kYXJPdXRsaW5lZCcsXG4gICAgJ2xpdmUnOiAnUGxheUNpcmNsZU91dGxpbmVkJyxcbiAgICAnZHJhZnQnOiAnRmlsZU91dGxpbmVkJyxcbiAgICAncHVibGlzaGVkJzogJ0NoZWNrQ2lyY2xlT3V0bGluZWQnLFxuICAgICdhcmNoaXZlZCc6ICdGb2xkZXJPdXRsaW5lZCcsXG5cbiAgICAvLyBQcmlvcml0eSBwYXR0ZXJuc1xuICAgICdsb3cnOiAnRG93bk91dGxpbmVkJyxcbiAgICAnbWVkaXVtJzogJ01pbnVzT3V0bGluZWQnLFxuICAgICdoaWdoJzogJ1VwT3V0bGluZWQnLFxuICAgICdjcml0aWNhbCc6ICdXYXJuaW5nT3V0bGluZWQnLFxuICAgICd1cmdlbnQnOiAnRmlyZU91dGxpbmVkJyxcblxuICAgIC8vIEFwcHJvdmFsIHBhdHRlcm5zXG4gICAgJ2FwcHJvdmVkJzogJ0NoZWNrQ2lyY2xlT3V0bGluZWQnLFxuICAgICdyZWplY3RlZCc6ICdDbG9zZUNpcmNsZU91dGxpbmVkJyxcbiAgICAncmV2aWV3JzogJ0V5ZU91dGxpbmVkJyxcblxuICAgIC8vIEJvb2xlYW4gVHJ1ZS9GYWxzZVxuICAgICd0cnVlJzogJ0NoZWNrQ2lyY2xlT3V0bGluZWQnLFxuICAgICdmYWxzZSc6ICdDbG9zZUNpcmNsZU91dGxpbmVkJ1xufTtcblxuLyoqXG4gKiBJbnRlbGxpZ2VudGx5IGV4dHJhY3QgYm9vbGVhbiBsYWJlbHMgZnJvbSBmaWVsZCBuYW1lIHBhdHRlcm5zLlxuICogU3VwcG9ydHMgY29tbW9uIGJvb2xlYW4gcHJlZml4ZXMgbGlrZSBpcy9oYXMvY2FuL3Nob3VsZC93aWxsL2V0Yy5cbiAqIFxuICogQGV4YW1wbGVcbiAqIC0gaXNBY3RpdmUg4oaSIFwiQWN0aXZlXCIgLyBcIkluYWN0aXZlXCJcbiAqIC0gaGFzUGVybWlzc2lvbiDihpIgXCJIYXMgUGVybWlzc2lvblwiIC8gXCJObyBQZXJtaXNzaW9uXCJcbiAqIC0gY2FuRWRpdCDihpIgXCJDYW4gRWRpdFwiIC8gXCJDYW5ub3QgRWRpdFwiXG4gKiAtIGlzTGl2ZSDihpIgXCJMaXZlXCIgLyBcIk5vdCBMaXZlXCJcbiAqIC0gc2hvdWxkTm90aWZ5IOKGkiBcIlNob3VsZCBOb3RpZnlcIiAvIFwiU2hvdWxkIE5vdCBOb3RpZnlcIlxuICovXG5mdW5jdGlvbiBleHRyYWN0Qm9vbGVhbkxhYmVsc0Zyb21GaWVsZE5hbWUoZmllbGROYW1lOiBzdHJpbmcpOiB7IHRydWVMYWJlbDogc3RyaW5nOyBmYWxzZUxhYmVsOiBzdHJpbmcgfSB8IG51bGwge1xuICAgIC8vIENvbW1vbiBib29sZWFuIHByZWZpeGVzIHdpdGggdGhlaXIgbmVnYXRpdmUgZm9ybXNcbiAgICBjb25zdCBwYXR0ZXJucyA9IFtcbiAgICAgICAgLy8gUGF0dGVybjogaXMgKyBYWFhcbiAgICAgICAge1xuICAgICAgICAgICAgcmVnZXg6IC9eaXMoW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiB0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pLFxuICAgICAgICAgICAgZ2V0RmFsc2VMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgYmFzZSA9IHRvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSk7XG4gICAgICAgICAgICAgICAgLy8gU3BlY2lhbCBjYXNlcyBmb3IgYmV0dGVyIG5lZ2F0aW9uXG4gICAgICAgICAgICAgICAgaWYgKGJhc2UudG9Mb3dlckNhc2UoKSA9PT0gJ2FjdGl2ZScpIHJldHVybiAnSW5hY3RpdmUnO1xuICAgICAgICAgICAgICAgIGlmIChiYXNlLnRvTG93ZXJDYXNlKCkgPT09ICdlbmFibGVkJykgcmV0dXJuICdEaXNhYmxlZCc7XG4gICAgICAgICAgICAgICAgaWYgKGJhc2UudG9Mb3dlckNhc2UoKSA9PT0gJ3Zpc2libGUnKSByZXR1cm4gJ0hpZGRlbic7XG4gICAgICAgICAgICAgICAgaWYgKGJhc2UudG9Mb3dlckNhc2UoKSA9PT0gJ3B1YmxpYycpIHJldHVybiAnUHJpdmF0ZSc7XG4gICAgICAgICAgICAgICAgaWYgKGJhc2UudG9Mb3dlckNhc2UoKSA9PT0gJ2F2YWlsYWJsZScpIHJldHVybiAnVW5hdmFpbGFibGUnO1xuICAgICAgICAgICAgICAgIHJldHVybiBgTm90ICR7YmFzZX1gO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICAvLyBQYXR0ZXJuOiBoYXMgKyBYWFhcbiAgICAgICAge1xuICAgICAgICAgICAgcmVnZXg6IC9eaGFzKFtBLVpdW2EtekEtWjAtOV0qKS8sXG4gICAgICAgICAgICBnZXRUcnVlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYEhhcyAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSl9YCxcbiAgICAgICAgICAgIGdldEZhbHNlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYE5vICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBhdHRlcm46IGNhbiArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL15jYW4oW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgQ2FuICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gLFxuICAgICAgICAgICAgZ2V0RmFsc2VMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgQ2Fubm90ICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBhdHRlcm46IHNob3VsZCArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL15zaG91bGQoW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgU2hvdWxkICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gLFxuICAgICAgICAgICAgZ2V0RmFsc2VMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgU2hvdWxkIE5vdCAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSl9YFxuICAgICAgICB9LFxuICAgICAgICAvLyBQYXR0ZXJuOiB3aWxsICsgWFhYXG4gICAgICAgIHtcbiAgICAgICAgICAgIHJlZ2V4OiAvXndpbGwoW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgV2lsbCAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSl9YCxcbiAgICAgICAgICAgIGdldEZhbHNlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYFdpbGwgTm90ICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBhdHRlcm46IGFsbG93cyArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL15hbGxvd3MoW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgQWxsb3dzICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gLFxuICAgICAgICAgICAgZ2V0RmFsc2VMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgRG9lcyBOb3QgQWxsb3cgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWBcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGF0dGVybjogbmVlZHMgKyBYWFhcbiAgICAgICAge1xuICAgICAgICAgICAgcmVnZXg6IC9ebmVlZHMoW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgTmVlZHMgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWAsXG4gICAgICAgICAgICBnZXRGYWxzZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBEb2VzIE5vdCBOZWVkICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBhdHRlcm46IHJlcXVpcmVzICsgWFhYXG4gICAgICAgIHtcbiAgICAgICAgICAgIHJlZ2V4OiAvXnJlcXVpcmVzKFtBLVpdW2EtekEtWjAtOV0qKS8sXG4gICAgICAgICAgICBnZXRUcnVlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYFJlcXVpcmVzICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gLFxuICAgICAgICAgICAgZ2V0RmFsc2VMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgRG9lcyBOb3QgUmVxdWlyZSAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSl9YFxuICAgICAgICB9XG4gICAgXTtcblxuICAgIGZvciAoY29uc3QgcGF0dGVybiBvZiBwYXR0ZXJucykge1xuICAgICAgICBjb25zdCBtYXRjaCA9IGZpZWxkTmFtZS5tYXRjaChwYXR0ZXJuLnJlZ2V4KTtcbiAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIHRydWVMYWJlbDogcGF0dGVybi5nZXRUcnVlTGFiZWwobWF0Y2gpLFxuICAgICAgICAgICAgICAgIGZhbHNlTGFiZWw6IHBhdHRlcm4uZ2V0RmFsc2VMYWJlbChtYXRjaClcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBHZXQgdGhlIG51bWJlciBvZiBvcHRpb25zIGZvciBhIGZpZWxkLlxuICovXG5mdW5jdGlvbiBnZXRGaWVsZE9wdGlvbkNvdW50KGZpZWxkOiBUSU9TY2hlbWFBdHRyaWJ1dGUpOiBudW1iZXIge1xuICAgIC8vIDEuIEVudW0gdHlwZSBhcnJheVxuICAgIGlmIChBcnJheS5pc0FycmF5KGZpZWxkLnR5cGUpKSB7XG4gICAgICAgIHJldHVybiBmaWVsZC50eXBlLmxlbmd0aDtcbiAgICB9XG5cbiAgICAvLyAyLiBCb29sZWFuIGZpZWxkXG4gICAgaWYgKGZpZWxkLnR5cGUgPT09ICdib29sZWFuJykge1xuICAgICAgICByZXR1cm4gMjtcbiAgICB9XG5cbiAgICAvLyAzLiBTZWxlY3QvcmFkaW8vY2hlY2tib3ggZmllbGQgd2l0aCBpbmxpbmUgb3B0aW9uc1xuICAgIGNvbnN0IGZpZWxkVHlwZSA9IGZpZWxkLmZpZWxkVHlwZTtcbiAgICBpZiAoZmllbGRUeXBlID09PSAnc2VsZWN0JyB8fCBmaWVsZFR5cGUgPT09ICdyYWRpbycgfHwgZmllbGRUeXBlID09PSAnY2hlY2tib3gnIHx8IGZpZWxkVHlwZSA9PT0gJ211bHRpLXNlbGVjdCcpIHtcbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IChmaWVsZCBhcyBhbnkpLm9wdGlvbnM7XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KG9wdGlvbnMpKSB7XG4gICAgICAgICAgICByZXR1cm4gb3B0aW9ucy5sZW5ndGg7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gMDtcbn1cblxuLyoqXG4gKiBDaGVjayBpZiBhIGZpZWxkIGlzIHZpYWJsZSBmb3Igc2VnbWVudCBnZW5lcmF0aW9uLlxuICogU3VwcG9ydHM6XG4gKiAtIEVudW0gdHlwZXM6IHR5cGU6IFsndmFsdWUxJywgJ3ZhbHVlMiddXG4gKiAtIEJvb2xlYW4gdHlwZXM6IHR5cGU6ICdib29sZWFuJ1xuICogLSBTZWxlY3QvcmFkaW8vY2hlY2tib3ggZmllbGRzIHdpdGggb3B0aW9uczogZmllbGRUeXBlOiAnc2VsZWN0JyArIG9wdGlvbnM6IFsuLi5dXG4gKiBcbiAqIFNUUklDVExZIGVuZm9yY2VzOiBtaW5WYWx1ZXMgPD0gb3B0aW9uQ291bnQgPD0gbWF4U2VnbWVudHNQZXJHcm91cFxuICovXG5mdW5jdGlvbiBpc1ZpYWJsZVNlZ21lbnRGaWVsZChcbiAgICBmaWVsZDogVElPU2NoZW1hQXR0cmlidXRlLFxuICAgIGNvbmZpZzogUmVxdWlyZWQ8SVNlZ21lbnRBdXRvR2VuZXJhdGlvbkNvbmZpZz4gJiB7IG1heFNlZ21lbnRzUGVyR3JvdXA/OiBudW1iZXIgfVxuKTogYm9vbGVhbiB7XG4gICAgY29uc3QgbWF4VmFsdWVzID0gY29uZmlnLm1heFNlZ21lbnRzUGVyR3JvdXAgfHwgMTA7XG4gICAgY29uc3Qgb3B0aW9uQ291bnQgPSBnZXRGaWVsZE9wdGlvbkNvdW50KGZpZWxkKTtcblxuICAgIC8vIE11c3QgaGF2ZSBvcHRpb25zIEFORCBiZSB3aXRoaW4gYm91bmRzXG4gICAgaWYgKG9wdGlvbkNvdW50ID09PSAwKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICAvLyBTVFJJQ1Q6IFJlamVjdCBpZiBvdXRzaWRlIGJvdW5kc1xuICAgIHJldHVybiBvcHRpb25Db3VudCA+PSBjb25maWcubWluVmFsdWVzICYmIG9wdGlvbkNvdW50IDw9IG1heFZhbHVlcztcbn1cblxuLyoqXG4gKiBJbnRlbGxpZ2VudGx5IGRldGVjdCB0aGUgYmVzdCBmaWVsZChzKSBmb3IgZ2VuZXJhdGluZyBzZWdtZW50cy5cbiAqIFJldHVybnMgbXVsdGlwbGUgZmllbGRzIGlmIG1heFNlZ21lbnRHcm91cHMgPiAxLlxuICogXG4gKiBQcmlvcml0eTpcbiAqIDEuIEV4cGxpY2l0IHNlZ21lbnRGaWVsZHMgKGVudGl0eSBjb25maWcpIOKGkiBVc2UgdGhvc2UgZmllbGRzXG4gKiAyLiBpbmNsdWRlRmllbGRzIGZpbHRlciAoZW50aXR5IGNvbmZpZykg4oaSIE9ubHkgY29uc2lkZXIgdGhlc2VcbiAqIDMuIGV4Y2x1ZGVGaWVsZHMgZmlsdGVyIChlbnRpdHkgY29uZmlnKSDihpIgU2tpcCB0aGVzZVxuICogNC4gcHJlZmVycmVkRmllbGRzIChnbG9iYWwvZW50aXR5IGNvbmZpZykg4oaSIFRyeSB0aGVzZSBmaXJzdFxuICogNS4gU2NvcmluZyBhbGdvcml0aG0g4oaSIFNjb3JlIGFsbCBjYW5kaWRhdGVzIGFuZCBwaWNrIHRvcCBOXG4gKi9cbmZ1bmN0aW9uIGRldGVjdFNlZ21lbnRGaWVsZHM8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxzdHJpbmcsIHN0cmluZywgc3RyaW5nPj4oXG4gICAgcHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlc01hcDxTPixcbiAgICBnbG9iYWxDb25maWc/OiBJU2VnbWVudEF1dG9HZW5lcmF0aW9uQ29uZmlnLFxuICAgIGVudGl0eUNvbmZpZz86IE5vbk51bGxhYmxlPFJldHVyblR5cGU8dHlwZW9mIEJhc2VFbnRpdHlTZXJ2aWNlLnByb3RvdHlwZS5nZXRFbnRpdHlTY2hlbWE+WyAnbW9kZWwnIF1bICdtZXRhZGF0YScgXT5bICd0YWJsZVVJJyBdXG4pOiBBcnJheTx7IGZpZWxkOiBUSU9TY2hlbWFBdHRyaWJ1dGU7IHNjb3JlOiBudW1iZXI7IHJlYXNvbjogc3RyaW5nIH0+IHtcbiAgICBjb25zdCBzZWdtZW50Q29uZmlnID0gZW50aXR5Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb247XG5cbiAgICAvLyBNZXJnZSBjb25maWdzIChlbnRpdHkgPiBnbG9iYWwgPiBkZWZhdWx0cylcbiAgICBjb25zdCBtZXJnZWRDb25maWc6IFJlcXVpcmVkPElTZWdtZW50QXV0b0dlbmVyYXRpb25Db25maWc+ICYgeyBtYXhTZWdtZW50R3JvdXBzOiBudW1iZXI7IG1heFNlZ21lbnRzUGVyR3JvdXA6IG51bWJlciB9ID0ge1xuICAgICAgICBlbmFibGVkOiBzZWdtZW50Q29uZmlnPy5lbmFibGVkID8/IGdsb2JhbENvbmZpZz8uZW5hYmxlZCA/PyB0cnVlLFxuICAgICAgICBwcmVmZXJyZWRGaWVsZHM6IHNlZ21lbnRDb25maWc/LnByZWZlcnJlZEZpZWxkcyB8fCBnbG9iYWxDb25maWc/LnByZWZlcnJlZEZpZWxkcyB8fCBbICdzdGF0dXMnLCAnc3RhdGUnLCAndHlwZScsICdjYXRlZ29yeScsICdwcmlvcml0eScgXSxcbiAgICAgICAgbWF4U2VnbWVudEdyb3Vwczogc2VnbWVudENvbmZpZz8ubWF4U2VnbWVudEdyb3VwcyA/PyBnbG9iYWxDb25maWc/Lm1heFNlZ21lbnRHcm91cHMgPz8gMixcbiAgICAgICAgbWF4U2VnbWVudHNQZXJHcm91cDogc2VnbWVudENvbmZpZz8ubWF4U2VnbWVudHNQZXJHcm91cCA/PyBnbG9iYWxDb25maWc/Lm1heFNlZ21lbnRzUGVyR3JvdXAgPz8gMTAsXG4gICAgICAgIG1pblZhbHVlczogc2VnbWVudENvbmZpZz8ubWluVmFsdWVzID8/IGdsb2JhbENvbmZpZz8ubWluVmFsdWVzID8/IDIsXG4gICAgICAgIGljb25NYXBwaW5nOiB7IC4uLkRFRkFVTFRfSUNPTl9NQVBQSU5HLCAuLi5nbG9iYWxDb25maWc/Lmljb25NYXBwaW5nLCAuLi5zZWdtZW50Q29uZmlnPy5pY29uTWFwcGluZyB9LFxuICAgICAgICBib29sZWFuTGFiZWxQYXR0ZXJuczogc2VnbWVudENvbmZpZz8uYm9vbGVhbkxhYmVsUGF0dGVybnMgfHwgZ2xvYmFsQ29uZmlnPy5ib29sZWFuTGFiZWxQYXR0ZXJucyB8fCBbXSxcbiAgICAgICAgZGVmYXVsdEJvb2xlYW5MYWJlbHM6IHNlZ21lbnRDb25maWc/LmRlZmF1bHRCb29sZWFuTGFiZWxzIHx8IGdsb2JhbENvbmZpZz8uZGVmYXVsdEJvb2xlYW5MYWJlbHMgfHwgeyB0cnVlOiAnWWVzJywgZmFsc2U6ICdObycgfSxcbiAgICAgICAgaW5jbHVkZUFsbFNlZ21lbnQ6IHNlZ21lbnRDb25maWc/LmluY2x1ZGVBbGxTZWdtZW50ID8/IGdsb2JhbENvbmZpZz8uaW5jbHVkZUFsbFNlZ21lbnQgPz8gdHJ1ZSxcbiAgICAgICAgZGVidWc6IHNlZ21lbnRDb25maWc/LmRlYnVnID8/IGdsb2JhbENvbmZpZz8uZGVidWcgPz8gZmFsc2VcbiAgICB9O1xuXG4gICAgaWYgKCFtZXJnZWRDb25maWcuZW5hYmxlZCkge1xuICAgICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgLy8gPT09IFBSSU9SSVRZIDE6IEV4cGxpY2l0IHNlZ21lbnQgZmllbGRzID09PVxuICAgIGNvbnN0IGV4cGxpY2l0RmllbGRzID0gc2VnbWVudENvbmZpZz8uc2VnbWVudEZpZWxkcyB8fCBzZWdtZW50Q29uZmlnPy5zZWdtZW50RmllbGQ7XG4gICAgaWYgKGV4cGxpY2l0RmllbGRzKSB7XG4gICAgICAgIGNvbnN0IGZpZWxkTmFtZXMgPSB0eXBlb2YgZXhwbGljaXRGaWVsZHMgPT09ICdzdHJpbmcnID8gWyBleHBsaWNpdEZpZWxkcyBdIDogZXhwbGljaXRGaWVsZHM7XG4gICAgICAgIGNvbnN0IHJlc3VsdHM6IEFycmF5PHsgZmllbGQ6IFRJT1NjaGVtYUF0dHJpYnV0ZTsgc2NvcmU6IG51bWJlcjsgcmVhc29uOiBzdHJpbmcgfT4gPSBbXTtcblxuICAgICAgICBmb3IgKGNvbnN0IGZpZWxkTmFtZSBvZiBmaWVsZE5hbWVzKSB7XG4gICAgICAgICAgICBjb25zdCBmaWVsZCA9IEFycmF5LmZyb20ocHJvcGVydGllcy52YWx1ZXMoKSkuZmluZChwID0+IHAuaWQgPT09IGZpZWxkTmFtZSk7XG4gICAgICAgICAgICBpZiAoZmllbGQpIHtcbiAgICAgICAgICAgICAgICByZXN1bHRzLnB1c2goeyBmaWVsZCwgc2NvcmU6IDEwMDAsIHJlYXNvbjogJ2V4cGxpY2l0IGNvbmZpZ3VyYXRpb24nIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHJlc3VsdHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdHMuc2xpY2UoMCwgbWVyZ2VkQ29uZmlnLm1heFNlZ21lbnRHcm91cHMpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gPT09IEZpbHRlciBwcm9wZXJ0aWVzIGJhc2VkIG9uIGluY2x1ZGUvZXhjbHVkZSA9PT1cbiAgICBsZXQgY2FuZGlkYXRlUHJvcGVydGllcyA9IEFycmF5LmZyb20ocHJvcGVydGllcy52YWx1ZXMoKSk7XG5cbiAgICAvLyBBcHBseSBpbmNsdWRlRmllbGRzIGZpbHRlciAoaWYgcHJvdmlkZWQsIE9OTFkgY29uc2lkZXIgdGhlc2UpXG4gICAgaWYgKHNlZ21lbnRDb25maWc/LmluY2x1ZGVGaWVsZHMgJiYgc2VnbWVudENvbmZpZy5pbmNsdWRlRmllbGRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY2FuZGlkYXRlUHJvcGVydGllcyA9IGNhbmRpZGF0ZVByb3BlcnRpZXMuZmlsdGVyKHAgPT5cbiAgICAgICAgICAgIHNlZ21lbnRDb25maWcuaW5jbHVkZUZpZWxkcyEuaW5jbHVkZXMocC5pZClcbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBBcHBseSBleGNsdWRlRmllbGRzIGZpbHRlclxuICAgIGlmIChzZWdtZW50Q29uZmlnPy5leGNsdWRlRmllbGRzICYmIHNlZ21lbnRDb25maWcuZXhjbHVkZUZpZWxkcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNhbmRpZGF0ZVByb3BlcnRpZXMgPSBjYW5kaWRhdGVQcm9wZXJ0aWVzLmZpbHRlcihwID0+XG4gICAgICAgICAgICAhc2VnbWVudENvbmZpZy5leGNsdWRlRmllbGRzIS5pbmNsdWRlcyhwLmlkKVxuICAgICAgICApO1xuICAgIH1cblxuICAgIC8vID09PSBQUklPUklUWSAyOiBQcmVmZXJyZWQgZmllbGRzID09PVxuICAgIGNvbnN0IHByZWZlcnJlZEZpZWxkcyA9IG1lcmdlZENvbmZpZy5wcmVmZXJyZWRGaWVsZHM7XG4gICAgY29uc3QgcHJlZmVycmVkTWF0Y2hlczogQXJyYXk8eyBmaWVsZDogVElPU2NoZW1hQXR0cmlidXRlOyBzY29yZTogbnVtYmVyOyByZWFzb246IHN0cmluZyB9PiA9IFtdO1xuXG4gICAgZm9yIChjb25zdCBwcmVmZXJyZWROYW1lIG9mIHByZWZlcnJlZEZpZWxkcykge1xuICAgICAgICBjb25zdCBmaWVsZCA9IGNhbmRpZGF0ZVByb3BlcnRpZXMuZmluZChwID0+IHAuaWQgPT09IHByZWZlcnJlZE5hbWUpO1xuICAgICAgICBpZiAoZmllbGQgJiYgaXNWaWFibGVTZWdtZW50RmllbGQoZmllbGQsIG1lcmdlZENvbmZpZykpIHtcbiAgICAgICAgICAgIHByZWZlcnJlZE1hdGNoZXMucHVzaCh7IGZpZWxkLCBzY29yZTogOTAwLCByZWFzb246IGBwcmVmZXJyZWQgZmllbGQ6ICR7cHJlZmVycmVkTmFtZX1gIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gSWYgd2UgaGF2ZSBlbm91Z2ggcHJlZmVycmVkIG1hdGNoZXMsIHJldHVybiB0aGVtXG4gICAgaWYgKHByZWZlcnJlZE1hdGNoZXMubGVuZ3RoID49IG1lcmdlZENvbmZpZy5tYXhTZWdtZW50R3JvdXBzKSB7XG4gICAgICAgIHJldHVybiBwcmVmZXJyZWRNYXRjaGVzLnNsaWNlKDAsIG1lcmdlZENvbmZpZy5tYXhTZWdtZW50R3JvdXBzKTtcbiAgICB9XG5cbiAgICAvLyA9PT0gUFJJT1JJVFkgMzogU2NvcmluZyBhbGdvcml0aG0gPT09XG4gICAgY29uc3QgY2FuZGlkYXRlczogQXJyYXk8eyBmaWVsZDogVElPU2NoZW1hQXR0cmlidXRlOyBzY29yZTogbnVtYmVyOyByZWFzb246IHN0cmluZzsgb3B0aW9uQ291bnQ6IG51bWJlciB9PiA9IFtdO1xuXG4gICAgLy8gQWRkIHByZWZlcnJlZE1hdGNoZXMgd2l0aCB0aGVpciBvcHRpb24gY291bnRzXG4gICAgZm9yIChjb25zdCBwbSBvZiBwcmVmZXJyZWRNYXRjaGVzKSB7XG4gICAgICAgIGNvbnN0IG9wdGlvbkNvdW50ID0gZ2V0RmllbGRPcHRpb25Db3VudChwbS5maWVsZCk7XG4gICAgICAgIGNhbmRpZGF0ZXMucHVzaCh7IC4uLnBtLCBvcHRpb25Db3VudCB9KTtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHByb3Agb2YgY2FuZGlkYXRlUHJvcGVydGllcykge1xuICAgICAgICAvLyBTa2lwIGlmIGFscmVhZHkgaW4gcHJlZmVycmVkTWF0Y2hlc1xuICAgICAgICBpZiAocHJlZmVycmVkTWF0Y2hlcy5zb21lKHBtID0+IHBtLmZpZWxkLmlkID09PSBwcm9wLmlkKSkge1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBTa2lwIGlmIG5vdCB2aWFibGUgKHRoaXMgZmlsdGVycyBvdXQgZmllbGRzIHdpdGggdG9vIG1hbnkgb3B0aW9ucylcbiAgICAgICAgaWYgKCFpc1ZpYWJsZVNlZ21lbnRGaWVsZChwcm9wLCBtZXJnZWRDb25maWcpKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBzY29yZSA9IDA7XG4gICAgICAgIGNvbnN0IHJlYXNvbnM6IHN0cmluZ1tdID0gW107XG4gICAgICAgIGNvbnN0IG9wdGlvbkNvdW50ID0gZ2V0RmllbGRPcHRpb25Db3VudChwcm9wKTtcblxuICAgICAgICAvLyAqKlNjb3JlIDE6IEZpZWxkIG5hbWUgbWF0Y2gqKiAocGFydGlhbCBtYXRjaCB3aXRoIHByZWZlcnJlZCBuYW1lcylcbiAgICAgICAgZm9yIChjb25zdCBwcmVmZXJyZWQgb2YgcHJlZmVycmVkRmllbGRzKSB7XG4gICAgICAgICAgICBpZiAocHJvcC5pZC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHByZWZlcnJlZC50b0xvd2VyQ2FzZSgpKSkge1xuICAgICAgICAgICAgICAgIHNjb3JlICs9IDUwO1xuICAgICAgICAgICAgICAgIHJlYXNvbnMucHVzaChgbmFtZSBjb250YWlucyBcIiR7cHJlZmVycmVkfVwiYCk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyAqKlNjb3JlIDI6IFByZWZlciBmZXdlciBvcHRpb25zIChpbnZlcnNlIHNjb3JpbmcpKipcbiAgICAgICAgLy8gRmllbGRzIHdpdGggZmV3ZXIgb3B0aW9ucyBnZXQgaGlnaGVyIHNjb3Jlc1xuICAgICAgICBjb25zdCBtaW5WYWx1ZXMgPSBtZXJnZWRDb25maWcubWluVmFsdWVzO1xuICAgICAgICBjb25zdCBtYXhWYWx1ZXMgPSBtZXJnZWRDb25maWcubWF4U2VnbWVudHNQZXJHcm91cDtcblxuICAgICAgICBpZiAob3B0aW9uQ291bnQgPj0gbWluVmFsdWVzICYmIG9wdGlvbkNvdW50IDw9IG1heFZhbHVlcykge1xuICAgICAgICAgICAgLy8gU2NvcmUgaW52ZXJzZWx5IHByb3BvcnRpb25hbCB0byBvcHRpb24gY291bnRcbiAgICAgICAgICAgIC8vIDIgb3B0aW9ucyA9ICs0MCwgNSBvcHRpb25zID0gKzI1LCAxMCBvcHRpb25zID0gKzEwXG4gICAgICAgICAgICBjb25zdCBvcHRpb25TY29yZSA9IE1hdGgubWF4KDEwLCA0MCAtIChvcHRpb25Db3VudCAtIG1pblZhbHVlcykgKiAzKTtcbiAgICAgICAgICAgIHNjb3JlICs9IG9wdGlvblNjb3JlO1xuICAgICAgICAgICAgcmVhc29ucy5wdXNoKGAke29wdGlvbkNvdW50fSBvcHRpb25zYCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyAqKlNjb3JlIDM6IEJvb2xlYW4gZmllbGQgZ2V0cyBoaWdoIHByaW9yaXR5IChvbmx5IDIgb3B0aW9ucykqKlxuICAgICAgICBpZiAocHJvcC50eXBlID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgICAgIHNjb3JlICs9IDU7ICAvLyBTbWFsbCBib251cyBzaW5jZSBvcHRpb24gY291bnQgYWxyZWFkeSBmYWN0b3JzIGluXG4gICAgICAgICAgICByZWFzb25zLnB1c2goJ2Jvb2xlYW4gZmllbGQnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vICoqU2NvcmUgNDogTmFtZSBwb3NpdGlvbiAoZWFybGllciA9IHNsaWdodGx5IGhpZ2hlciBwcmlvcml0eSkqKlxuICAgICAgICBjb25zdCBmaWVsZEluZGV4ID0gY2FuZGlkYXRlUHJvcGVydGllcy5pbmRleE9mKHByb3ApO1xuICAgICAgICBzY29yZSAtPSBNYXRoLm1pbihmaWVsZEluZGV4LCA1KTsgIC8vIENhcCBwZW5hbHR5IGF0IDVcblxuICAgICAgICBjYW5kaWRhdGVzLnB1c2goe1xuICAgICAgICAgICAgZmllbGQ6IHByb3AsXG4gICAgICAgICAgICBzY29yZSxcbiAgICAgICAgICAgIHJlYXNvbjogcmVhc29ucy5qb2luKCcsICcpLFxuICAgICAgICAgICAgb3B0aW9uQ291bnRcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gU29ydCBieTogMSkgc2NvcmUgKGhpZ2hlc3QgZmlyc3QpLCAyKSBvcHRpb24gY291bnQgKGxvd2VzdCBmaXJzdClcbiAgICBjYW5kaWRhdGVzLnNvcnQoKGEsIGIpID0+IHtcbiAgICAgICAgaWYgKGIuc2NvcmUgIT09IGEuc2NvcmUpIHtcbiAgICAgICAgICAgIHJldHVybiBiLnNjb3JlIC0gYS5zY29yZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gYS5vcHRpb25Db3VudCAtIGIub3B0aW9uQ291bnQ7ICAvLyBQcmVmZXIgZmV3ZXIgb3B0aW9uc1xuICAgIH0pO1xuXG4gICAgY29uc3QgdG9wTlJlc3VsdHMgPSBjYW5kaWRhdGVzLnNsaWNlKDAsIG1lcmdlZENvbmZpZy5tYXhTZWdtZW50R3JvdXBzKTtcblxuICAgIGlmICh0b3BOUmVzdWx0cy5sZW5ndGggPiAwICYmIG1lcmdlZENvbmZpZy5kZWJ1Zykge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtTZWdtZW50RGV0ZWN0aW9uXSBTZWxlY3RlZCAke3RvcE5SZXN1bHRzLmxlbmd0aH0gZmllbGQocyk6YCwgdG9wTlJlc3VsdHMubWFwKGMgPT4gKHtcbiAgICAgICAgICAgIGZpZWxkOiBjLmZpZWxkLmlkLFxuICAgICAgICAgICAgc2NvcmU6IGMuc2NvcmUsXG4gICAgICAgICAgICBvcHRpb25Db3VudDogYy5vcHRpb25Db3VudCxcbiAgICAgICAgICAgIHJlYXNvbjogYy5yZWFzb25cbiAgICAgICAgfSkpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdG9wTlJlc3VsdHM7XG59XG5cbi8qKlxuICogQXV0by1nZW5lcmF0ZSBmaWx0ZXIgc2VnbWVudHMgYmFzZWQgb24gZW50aXR5IGF0dHJpYnV0ZXMgdXNpbmcgc21hcnQgZGV0ZWN0aW9uLlxuICogXG4gKiBBbGdvcml0aG06XG4gKiAxLiBJZiBjdXN0b20gc2VnbWVudHMgcHJvdmlkZWQg4oaSIHVzZSB0aGVtIChoaWdoZXN0IHByaW9yaXR5KVxuICogMi4gSWYgZW50aXR5IHJlcXVpcmVzIG1hbnVhbCBzZWdtZW50cyDihpIgc2tpcCBhdXRvLWdlbmVyYXRpb25cbiAqIDMuIERldGVjdCBiZXN0IGZpZWxkIHVzaW5nIHNjb3JpbmcgYWxnb3JpdGhtXG4gKiA0LiBHZW5lcmF0ZSBzZWdtZW50cyBmcm9tIGRldGVjdGVkIGZpZWxkIHdpdGggc21hcnQgaWNvbnNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdlbmVyYXRlU2VnbWVudHM8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxzdHJpbmcsIHN0cmluZywgc3RyaW5nPj4oXG4gICAgcHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlc01hcDxTPixcbiAgICBlbnRpdHlTZXJ2aWNlPzogQmFzZUVudGl0eVNlcnZpY2U8Uz4sXG4gICAgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyAndWlDb25maWdHZW5PcHRpb25zJyBdLFxuICAgIGN1c3RvbVNlZ21lbnRzPzogUmVhZG9ubHlBcnJheTxJRmlsdGVyU2VnbWVudCB8IElGaWx0ZXJTZWdtZW50R3JvdXA+IHwgQXJyYXk8SUZpbHRlclNlZ21lbnQgfCBJRmlsdGVyU2VnbWVudEdyb3VwPlxuKTogUmVhZG9ubHlBcnJheTxJRmlsdGVyU2VnbWVudCB8IElGaWx0ZXJTZWdtZW50R3JvdXA+IHwgQXJyYXk8SUZpbHRlclNlZ21lbnQgfCBJRmlsdGVyU2VnbWVudEdyb3VwPiB8IHVuZGVmaW5lZCB7XG4gICAgLy8gMS4gSWYgY3VzdG9tIHNlZ21lbnRzIHByb3ZpZGVkLCB1c2UgdGhvc2UgKGhpZ2hlc3QgcHJpb3JpdHkpXG4gICAgaWYgKGN1c3RvbVNlZ21lbnRzICYmIGN1c3RvbVNlZ21lbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmV0dXJuIGN1c3RvbVNlZ21lbnRzO1xuICAgIH1cblxuICAgIC8vIEdldCBjb25maWd1cmF0aW9uXG4gICAgY29uc3QgZ2xvYmFsU2VnbWVudENvbmZpZyA9IGdsb2JhbFVJQ29uZmlnT3B0aW9ucz8udGFibGVVST8uc2VnbWVudEF1dG9HZW5lcmF0aW9uO1xuICAgIGNvbnN0IGVudGl0eU1ldGFkYXRhID0gZW50aXR5U2VydmljZT8uZ2V0RW50aXR5U2NoZW1hPy4oKS5tb2RlbD8ubWV0YWRhdGE7XG4gICAgY29uc3QgZW50aXR5U2VnbWVudENvbmZpZyA9IGVudGl0eU1ldGFkYXRhPy50YWJsZVVJO1xuXG4gICAgLy8gMi4gSWYgZW50aXR5IHJlcXVpcmVzIG1hbnVhbCBzZWdtZW50cywgc2tpcCBhdXRvLWdlbmVyYXRpb25cbiAgICBpZiAoZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5yZXF1aXJlTWFudWFsKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgLy8gMy4gRGV0ZWN0IGJlc3Qgc2VnbWVudCBmaWVsZHMgKHJldHVybnMgYXJyYXkgbm93KVxuICAgIGNvbnN0IGRldGVjdGVkRmllbGRzID0gZGV0ZWN0U2VnbWVudEZpZWxkcyhwcm9wZXJ0aWVzLCBnbG9iYWxTZWdtZW50Q29uZmlnLCBlbnRpdHlTZWdtZW50Q29uZmlnKTtcblxuICAgIGlmIChkZXRlY3RlZEZpZWxkcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgLy8gTm8gc3VpdGFibGUgZmllbGRzIGZvdW5kXG4gICAgICAgIGlmIChnbG9iYWxTZWdtZW50Q29uZmlnPy5kZWJ1ZyB8fCBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmRlYnVnKSB7XG4gICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtTZWdtZW50R2VuZXJhdGlvbl0gTm8gc3VpdGFibGUgZmllbGRzIGRldGVjdGVkIGZvciBzZWdtZW50c2ApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgLy8gR2V0IG1lcmdlZCBjb25maWcgZm9yIHRoaXMgZW50aXR5XG4gICAgY29uc3QgbWVyZ2VkQ29uZmlnOiBSZXF1aXJlZDxJU2VnbWVudEF1dG9HZW5lcmF0aW9uQ29uZmlnPiAmIHsgbWF4U2VnbWVudEdyb3VwczogbnVtYmVyOyBtYXhTZWdtZW50c1Blckdyb3VwOiBudW1iZXIgfSA9IHtcbiAgICAgICAgZW5hYmxlZDogZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5lbmFibGVkID8/IGdsb2JhbFNlZ21lbnRDb25maWc/LmVuYWJsZWQgPz8gdHJ1ZSxcbiAgICAgICAgcHJlZmVycmVkRmllbGRzOiBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LnByZWZlcnJlZEZpZWxkcyB8fCBnbG9iYWxTZWdtZW50Q29uZmlnPy5wcmVmZXJyZWRGaWVsZHMgfHwgWyAnc3RhdHVzJywgJ3N0YXRlJywgJ3R5cGUnLCAnY2F0ZWdvcnknLCAncHJpb3JpdHknIF0sXG4gICAgICAgIG1heFNlZ21lbnRHcm91cHM6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8ubWF4U2VnbWVudEdyb3VwcyA/PyBnbG9iYWxTZWdtZW50Q29uZmlnPy5tYXhTZWdtZW50R3JvdXBzID8/IDIsXG4gICAgICAgIG1heFNlZ21lbnRzUGVyR3JvdXA6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8ubWF4U2VnbWVudHNQZXJHcm91cCA/PyBnbG9iYWxTZWdtZW50Q29uZmlnPy5tYXhTZWdtZW50c1Blckdyb3VwID8/IDEwLFxuICAgICAgICBtaW5WYWx1ZXM6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8ubWluVmFsdWVzID8/IGdsb2JhbFNlZ21lbnRDb25maWc/Lm1pblZhbHVlcyA/PyAyLFxuICAgICAgICBpY29uTWFwcGluZzoge1xuICAgICAgICAgICAgLi4uREVGQVVMVF9JQ09OX01BUFBJTkcsXG4gICAgICAgICAgICAuLi5nbG9iYWxTZWdtZW50Q29uZmlnPy5pY29uTWFwcGluZyxcbiAgICAgICAgICAgIC4uLmVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uaWNvbk1hcHBpbmdcbiAgICAgICAgfSxcbiAgICAgICAgYm9vbGVhbkxhYmVsUGF0dGVybnM6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uYm9vbGVhbkxhYmVsUGF0dGVybnMgfHwgZ2xvYmFsU2VnbWVudENvbmZpZz8uYm9vbGVhbkxhYmVsUGF0dGVybnMgfHwgW10sXG4gICAgICAgIGRlZmF1bHRCb29sZWFuTGFiZWxzOiBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmRlZmF1bHRCb29sZWFuTGFiZWxzIHx8IGdsb2JhbFNlZ21lbnRDb25maWc/LmRlZmF1bHRCb29sZWFuTGFiZWxzIHx8IHsgdHJ1ZTogJ1llcycsIGZhbHNlOiAnTm8nIH0sXG4gICAgICAgIGluY2x1ZGVBbGxTZWdtZW50OiBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmluY2x1ZGVBbGxTZWdtZW50ID8/IGdsb2JhbFNlZ21lbnRDb25maWc/LmluY2x1ZGVBbGxTZWdtZW50ID8/IHRydWUsXG4gICAgICAgIGRlYnVnOiBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmRlYnVnID8/IGdsb2JhbFNlZ21lbnRDb25maWc/LmRlYnVnID8/IGZhbHNlXG4gICAgfTtcblxuICAgIGlmIChtZXJnZWRDb25maWcuZGVidWcpIHtcbiAgICAgICAgRGVmYXVsdExvZ2dlci5pbmZvKGBbU2VnbWVudEdlbmVyYXRpb25dIEdlbmVyYXRpbmcgc2VnbWVudHMgZm9yICR7ZGV0ZWN0ZWRGaWVsZHMubGVuZ3RofSBmaWVsZChzKTpgLCBkZXRlY3RlZEZpZWxkcy5tYXAoZCA9PiBkLmZpZWxkLmlkKSk7XG4gICAgfVxuXG4gICAgLy8gNC4gR2VuZXJhdGUgc2VnbWVudCBncm91cHMgKG9uZSBwZXIgZGV0ZWN0ZWQgZmllbGQpXG4gICAgY29uc3Qgc2VnbWVudEdyb3VwczogQXJyYXk8SUZpbHRlclNlZ21lbnRHcm91cD4gPSBbXTtcblxuICAgIGZvciAoY29uc3QgZGV0ZWN0aW9uIG9mIGRldGVjdGVkRmllbGRzKSB7XG4gICAgICAgIGNvbnN0IHsgZmllbGQgfSA9IGRldGVjdGlvbjtcblxuICAgICAgICAvLyBHZW5lcmF0ZSBzZWdtZW50cyBmb3IgdGhpcyBmaWVsZFxuICAgICAgICBjb25zdCBzZWdtZW50czogQXJyYXk8SUZpbHRlclNlZ21lbnQ+ID0gW107XG5cbiAgICAgICAgLy8gQWRkIFwiQWxsXCIgc2VnbWVudCBpZiBlbmFibGVkXG4gICAgICAgIGlmIChtZXJnZWRDb25maWcuaW5jbHVkZUFsbFNlZ21lbnQpIHtcbiAgICAgICAgICAgIHNlZ21lbnRzLnB1c2goe1xuICAgICAgICAgICAgICAgIGlkOiBgYWxsLSR7ZmllbGQuaWR9YCxcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0FsbCcsXG4gICAgICAgICAgICAgICAgZmlsdGVyczoge30sXG4gICAgICAgICAgICAgICAgZGVmYXVsdDogdHJ1ZVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBHZXQgdmFsdWVzIGZyb20gZmllbGRcbiAgICAgICAgbGV0IHZhbHVlczogKHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4pW10gPSBbXTtcbiAgICAgICAgbGV0IHZhbHVlTGFiZWxzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307ICAvLyBGb3IgY3VzdG9tIGJvb2xlYW4gbGFiZWxzXG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZmllbGQudHlwZSkpIHtcbiAgICAgICAgICAgIC8vIEVudW0gdHlwZSBhcnJheVxuICAgICAgICAgICAgdmFsdWVzID0gZmllbGQudHlwZTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZC50eXBlID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgICAgIC8vIEJvb2xlYW4gZmllbGQgd2l0aCBvcHRpb25hbCBjdXN0b20gbGFiZWxzXG4gICAgICAgICAgICB2YWx1ZXMgPSBbIHRydWUsIGZhbHNlIF07XG5cbiAgICAgICAgICAgIC8vIDEuIENoZWNrIGZvciBleHBsaWNpdCBmaWVsZC1sZXZlbCBib29sZWFuTGFiZWxzXG4gICAgICAgICAgICBjb25zdCBmaWVsZEJvb2xlYW5MYWJlbHMgPSAnYm9vbGVhbkxhYmVscycgaW4gZmllbGQgPyBmaWVsZC5ib29sZWFuTGFiZWxzIDogdW5kZWZpbmVkO1xuICAgICAgICAgICAgaWYgKGZpZWxkQm9vbGVhbkxhYmVscyAmJiB0eXBlb2YgZmllbGRCb29sZWFuTGFiZWxzID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgICAgIHZhbHVlTGFiZWxzWyAndHJ1ZScgXSA9IGZpZWxkQm9vbGVhbkxhYmVscy50cnVlIHx8ICdZZXMnO1xuICAgICAgICAgICAgICAgIHZhbHVlTGFiZWxzWyAnZmFsc2UnIF0gPSBmaWVsZEJvb2xlYW5MYWJlbHMuZmFsc2UgfHwgJ05vJztcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gMi4gVHJ5IGludGVsbGlnZW50IGV4dHJhY3Rpb24gZnJvbSBmaWVsZCBuYW1lXG4gICAgICAgICAgICAgICAgY29uc3QgZmllbGROYW1lID0gZmllbGQuaWQ7XG4gICAgICAgICAgICAgICAgY29uc3QgZXh0cmFjdGVkID0gZXh0cmFjdEJvb2xlYW5MYWJlbHNGcm9tRmllbGROYW1lKGZpZWxkTmFtZSk7XG5cbiAgICAgICAgICAgICAgICBpZiAoZXh0cmFjdGVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlTGFiZWxzWyAndHJ1ZScgXSA9IGV4dHJhY3RlZC50cnVlTGFiZWw7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlTGFiZWxzWyAnZmFsc2UnIF0gPSBleHRyYWN0ZWQuZmFsc2VMYWJlbDtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAvLyAzLiBUcnkgdG8gbWF0Y2ggYWdhaW5zdCBjb25maWd1cmVkIHBhdHRlcm5zXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhdHRlcm5zID0gbWVyZ2VkQ29uZmlnLmJvb2xlYW5MYWJlbFBhdHRlcm5zO1xuICAgICAgICAgICAgICAgICAgICBsZXQgbWF0Y2hlZCA9IGZhbHNlO1xuXG4gICAgICAgICAgICAgICAgICAgIGlmIChwYXR0ZXJucyAmJiBwYXR0ZXJucy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHBhdHRlcm4gb2YgcGF0dGVybnMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCByZWdleCA9IHBhdHRlcm4ucGF0dGVybiBpbnN0YW5jZW9mIFJlZ0V4cFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IHBhdHRlcm4ucGF0dGVyblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IG5ldyBSZWdFeHAocGF0dGVybi5wYXR0ZXJuLCAnaScpO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHJlZ2V4LnRlc3QoZmllbGROYW1lKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZUxhYmVsc1sgJ3RydWUnIF0gPSBwYXR0ZXJuLnRydWVMYWJlbDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbICdmYWxzZScgXSA9IHBhdHRlcm4uZmFsc2VMYWJlbDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWF0Y2hlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIC8vIDQuIFVzZSBkZWZhdWx0IGZhbGxiYWNrIGlmIG5vIHBhdHRlcm4gbWF0Y2hlZFxuICAgICAgICAgICAgICAgICAgICBpZiAoIW1hdGNoZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRzID0gbWVyZ2VkQ29uZmlnLmRlZmF1bHRCb29sZWFuTGFiZWxzIHx8IHsgdHJ1ZTogJ1llcycsIGZhbHNlOiAnTm8nIH07XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZUxhYmVsc1sgJ3RydWUnIF0gPSBkZWZhdWx0cy50cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbICdmYWxzZScgXSA9IGRlZmF1bHRzLmZhbHNlO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKChmaWVsZC5maWVsZFR5cGUgPT09ICdzZWxlY3QnIHx8IGZpZWxkLmZpZWxkVHlwZSA9PT0gJ3JhZGlvJyB8fCBmaWVsZC5maWVsZFR5cGUgPT09ICdjaGVja2JveCcgfHwgZmllbGQuZmllbGRUeXBlID09PSAnbXVsdGktc2VsZWN0JykgJiYgQXJyYXkuaXNBcnJheSgoZmllbGQgYXMgYW55KS5vcHRpb25zKSkge1xuICAgICAgICAgICAgLy8gU2VsZWN0L3JhZGlvL2NoZWNrYm94IGZpZWxkIHdpdGggaW5saW5lIG9wdGlvbnNcbiAgICAgICAgICAgIGNvbnN0IG9wdGlvbnMgPSAoZmllbGQgYXMgYW55KS5vcHRpb25zIGFzIEFycmF5PHsgbGFiZWw6IHN0cmluZzsgdmFsdWU6IHN0cmluZyB9PjtcbiAgICAgICAgICAgIHZhbHVlcyA9IG9wdGlvbnMubWFwKG9wdCA9PiBvcHQudmFsdWUpO1xuICAgICAgICAgICAgLy8gU3RvcmUgbGFiZWxzIGZvciBsYXRlciB1c2VcbiAgICAgICAgICAgIG9wdGlvbnMuZm9yRWFjaChvcHQgPT4ge1xuICAgICAgICAgICAgICAgIHZhbHVlTGFiZWxzWyBTdHJpbmcob3B0LnZhbHVlKSBdID0gb3B0LmxhYmVsO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBcHBseSBmaWVsZC1zcGVjaWZpYyB2YWx1ZSBmaWx0ZXJzIGZpcnN0LCB0aGVuIGdsb2JhbFxuICAgICAgICBjb25zdCBpbmNsdWRlVmFsdWVzQnlGaWVsZCA9IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uaW5jbHVkZVZhbHVlc0J5RmllbGQ7XG4gICAgICAgIGNvbnN0IGluY2x1ZGVWYWx1ZXMgPSBpbmNsdWRlVmFsdWVzQnlGaWVsZD8uWyBmaWVsZC5pZCBdIHx8IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uaW5jbHVkZVZhbHVlcztcbiAgICAgICAgaWYgKGluY2x1ZGVWYWx1ZXMpIHtcbiAgICAgICAgICAgIHZhbHVlcyA9IHZhbHVlcy5maWx0ZXIodiA9PiBpbmNsdWRlVmFsdWVzLmluY2x1ZGVzKFN0cmluZyh2KSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZXhjbHVkZVZhbHVlc0J5RmllbGQgPSBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmV4Y2x1ZGVWYWx1ZXNCeUZpZWxkO1xuICAgICAgICBjb25zdCBleGNsdWRlVmFsdWVzID0gZXhjbHVkZVZhbHVlc0J5RmllbGQ/LlsgZmllbGQuaWQgXSB8fCBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmV4Y2x1ZGVWYWx1ZXM7XG4gICAgICAgIGlmIChleGNsdWRlVmFsdWVzKSB7XG4gICAgICAgICAgICB2YWx1ZXMgPSB2YWx1ZXMuZmlsdGVyKHYgPT4gIWV4Y2x1ZGVWYWx1ZXMuaW5jbHVkZXMoU3RyaW5nKHYpKSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBcHBseSBmaWVsZC1zcGVjaWZpYyBzb3J0IG9yZGVyIGZpcnN0LCB0aGVuIGdsb2JhbFxuICAgICAgICBjb25zdCBzb3J0T3JkZXJCeUZpZWxkID0gZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5zb3J0T3JkZXJCeUZpZWxkO1xuICAgICAgICBjb25zdCBzb3J0T3JkZXIgPSBzb3J0T3JkZXJCeUZpZWxkPy5bIGZpZWxkLmlkIF0gfHwgZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5zb3J0T3JkZXI7XG4gICAgICAgIGlmIChzb3J0T3JkZXIpIHtcbiAgICAgICAgICAgIHZhbHVlcy5zb3J0KChhLCBiKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgYUluZGV4ID0gc29ydE9yZGVyLmluZGV4T2YoU3RyaW5nKGEpKTtcbiAgICAgICAgICAgICAgICBjb25zdCBiSW5kZXggPSBzb3J0T3JkZXIuaW5kZXhPZihTdHJpbmcoYikpO1xuXG4gICAgICAgICAgICAgICAgLy8gSWYgYm90aCBpbiBzb3J0T3JkZXIsIHVzZSB0aGF0IG9yZGVyXG4gICAgICAgICAgICAgICAgaWYgKGFJbmRleCA+PSAwICYmIGJJbmRleCA+PSAwKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBhSW5kZXggLSBiSW5kZXg7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIC8vIElmIG9ubHkgb25lIGluIHNvcnRPcmRlciwgaXQgY29tZXMgZmlyc3RcbiAgICAgICAgICAgICAgICBpZiAoYUluZGV4ID49IDApIHJldHVybiAtMTtcbiAgICAgICAgICAgICAgICBpZiAoYkluZGV4ID49IDApIHJldHVybiAxO1xuICAgICAgICAgICAgICAgIC8vIE5laXRoZXIgaW4gc29ydE9yZGVyLCBtYWludGFpbiBvcmlnaW5hbCBvcmRlclxuICAgICAgICAgICAgICAgIHJldHVybiAwO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBHZW5lcmF0ZSBzZWdtZW50IGZvciBlYWNoIHZhbHVlXG4gICAgICAgIGZvciAoY29uc3QgdmFsdWUgb2YgdmFsdWVzKSB7XG4gICAgICAgICAgICBjb25zdCB2YWx1ZVN0ciA9IFN0cmluZyh2YWx1ZSk7XG4gICAgICAgICAgICBjb25zdCB2YWx1ZUxvd2VyID0gdmFsdWVTdHIudG9Mb3dlckNhc2UoKTtcblxuICAgICAgICAgICAgLy8gVXNlIGN1c3RvbSBsYWJlbCBpZiBhdmFpbGFibGUsIG90aGVyd2lzZSBmb3JtYXQgdGhlIHZhbHVlXG4gICAgICAgICAgICBjb25zdCBzZWdtZW50TGFiZWwgPSB2YWx1ZUxhYmVsc1sgdmFsdWVTdHIgXSB8fCBwYXNjYWxDYXNlKHZhbHVlU3RyKTtcblxuICAgICAgICAgICAgc2VnbWVudHMucHVzaCh7XG4gICAgICAgICAgICAgICAgaWQ6IGAke2ZpZWxkLmlkfS0ke3ZhbHVlTG93ZXIucmVwbGFjZSgvW15hLXowLTldKy9nLCAnLScpfWAsICAvLyBVbmlxdWUgSURcbiAgICAgICAgICAgICAgICBsYWJlbDogc2VnbWVudExhYmVsLCAgLy8gQ3VzdG9tIG9yIGZvcm1hdHRlZCBsYWJlbFxuICAgICAgICAgICAgICAgIGljb246IG1lcmdlZENvbmZpZy5pY29uTWFwcGluZ1sgdmFsdWVMb3dlciBdLCAgLy8gU21hcnQgaWNvbiBsb29rdXBcbiAgICAgICAgICAgICAgICBmaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgIFsgZmllbGQuaWQgXTogeyBlcTogdmFsdWUgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gT25seSBhZGQgZ3JvdXAgaWYgd2UgaGF2ZSBzZWdtZW50c1xuICAgICAgICBjb25zdCBtaW5TZWdtZW50cyA9IG1lcmdlZENvbmZpZy5pbmNsdWRlQWxsU2VnbWVudCA/IDEgOiAwO1xuICAgICAgICBpZiAoc2VnbWVudHMubGVuZ3RoID4gbWluU2VnbWVudHMpIHtcbiAgICAgICAgICAgIC8vIEF1dG8tZ2VuZXJhdGUgbGFiZWwgb3IgdXNlIGV4cGxpY2l0IGdyb3VwTGFiZWxzXG4gICAgICAgICAgICBjb25zdCBjdXN0b21Hcm91cExhYmVscyA9IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uZ3JvdXBMYWJlbHM7XG4gICAgICAgICAgICBjb25zdCBsYWJlbCA9IGN1c3RvbUdyb3VwTGFiZWxzPy5bIGZpZWxkLmlkIF0gfHwgYEJ5ICR7cGFzY2FsQ2FzZShmaWVsZC5pZCl9YDtcblxuICAgICAgICAgICAgc2VnbWVudEdyb3Vwcy5wdXNoKHtcbiAgICAgICAgICAgICAgICBpZDogYCR7ZmllbGQuaWR9LWdyb3VwYCxcbiAgICAgICAgICAgICAgICBsYWJlbCxcbiAgICAgICAgICAgICAgICBzZWdtZW50cyxcbiAgICAgICAgICAgICAgICBkZWZhdWx0U2VnbWVudElkOiBzZWdtZW50cy5maW5kKHMgPT4gcy5kZWZhdWx0KT8uaWQsXG4gICAgICAgICAgICAgICAgbWF4VmlzaWJsZTogbWVyZ2VkQ29uZmlnLm1heFNlZ21lbnRzUGVyR3JvdXBcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gUmV0dXJuIHNlZ21lbnQgZ3JvdXBzIChvciB1bmRlZmluZWQgaWYgbm9uZSBnZW5lcmF0ZWQpXG4gICAgaWYgKHNlZ21lbnRHcm91cHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgLy8gSWYgb25seSAxIGdyb3VwIHdpdGggc2ltcGxlIGNvbmZpZywgcmV0dXJuIGZsYXQgc2VnbWVudHMgZm9yIGJhY2t3YXJkcyBjb21wYXRpYmlsaXR5XG4gICAgLy8gVGhpcyBtYWludGFpbnMgbGVnYWN5IGJlaGF2aW9yIHdoZW4gbWF4U2VnbWVudEdyb3VwcyA9IDFcbiAgICBpZiAoc2VnbWVudEdyb3Vwcy5sZW5ndGggPT09IDEgJiYgbWVyZ2VkQ29uZmlnLm1heFNlZ21lbnRHcm91cHMgPT09IDEpIHtcbiAgICAgICAgcmV0dXJuIHNlZ21lbnRHcm91cHNbIDAgXS5zZWdtZW50cztcbiAgICB9XG5cbiAgICByZXR1cm4gc2VnbWVudEdyb3Vwcztcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFTlRJVFkgQVRUUklCVVRFIEZPUk1BVFRJTkdcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIEZvcm1hdHMgYSBzaW5nbGUgZW50aXR5IGF0dHJpYnV0ZSBmb3IgZm9ybSBvciBkZXRhaWwgcGFnZSBkaXNwbGF5LlxuICogXG4gKiBUcmFuc2Zvcm1zIHNjaGVtYSBhdHRyaWJ1dGVzIGludG8gVUktcmVhZHkgZmllbGQgY29uZmlndXJhdGlvbnMgd2l0aCBwcm9wZXIgZmllbGQgdHlwZXMsXG4gKiByZWxhdGlvbiBjb25maWdzLCBvcHRpb25zLCB2aXNpYmlsaXR5LCBhbmQgdmFsaWRhdGlvbiBydWxlcy4gQXV0by1nZW5lcmF0ZXMgcmVsYXRpb25cbiAqIGRpc3BsYXkgY29uZmlndXJhdGlvbnMgYW5kIGZpbHRlciBjb25maWdzIHdoZW4gbm90IGV4cGxpY2l0bHkgcHJvdmlkZWQuXG4gKiBcbiAqIEBwYXJhbSB0aGlzUHJvcCAtIFRoZSBlbnRpdHkgYXR0cmlidXRlIHRvIGZvcm1hdFxuICogQHBhcmFtIHR5cGUgLSBQYWdlIHR5cGU6ICdjcmVhdGUnLCAndXBkYXRlJywgb3IgJ2RldGFpbCdcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gRW50aXR5IHNlcnZpY2UgZm9yIGFjY2Vzc2luZyByZWxhdGVkIHNjaGVtYXNcbiAqIEBwYXJhbSBhbGxQcm9wZXJ0aWVzIC0gT3B0aW9uYWwgYXJyYXkgb2YgYWxsIHByb3BlcnRpZXMgZm9yIGRldGVjdGluZyBkdXBsaWNhdGVkIHJlbGF0aW9uIGZpZWxkc1xuICogQHBhcmFtIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyAtIE9wdGlvbmFsIGdsb2JhbCBVSSBjb25maWd1cmF0aW9uIG9wdGlvbnNcbiAqIEByZXR1cm5zIEZvcm1hdHRlZCBmaWVsZCBtZXRhZGF0YSByZWFkeSBmb3IgVUkgcmVuZGVyaW5nXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBmb3JtYXR0ZWRGaWVsZCA9IGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbChcbiAqICAge1xuICogICAgIGlkOiAndGVhbUlkJyxcbiAqICAgICBuYW1lOiAndGVhbUlkJyxcbiAqICAgICB0eXBlOiAnc3RyaW5nJyxcbiAqICAgICByZWxhdGlvbjogeyB0eXBlOiAnb25lJywgZW50aXR5OiAndGVhbScgfVxuICogICB9LFxuICogICAnY3JlYXRlJyxcbiAqICAgZW50aXR5U2VydmljZVxuICogKTtcbiAqIC8vIFJldHVybnMgZmllbGQgd2l0aCByZWxhdGlvbkNvbmZpZywgZmlsdGVyQ29uZmlnLCBhbmQgcHJvcGVyIGZpZWxkIHR5cGVcbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKFxuICAgIHRoaXNQcm9wOiBUSU9TY2hlbWFBdHRyaWJ1dGUsXG4gICAgdHlwZTogJ2NyZWF0ZScgfCAndXBkYXRlJyB8ICdkZXRhaWwnLFxuICAgIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sXG4gICAgYWxsUHJvcGVydGllcz86IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLCAgLy8gT3B0aW9uYWw6IGZvciBkZXRlY3RpbmcgZHVwbGljYXRlZCByZWxhdGlvbiBmaWVsZHNcbiAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbICd1aUNvbmZpZ0dlbk9wdGlvbnMnIF0gIC8vIE9wdGlvbmFsOiBnbG9iYWwgVUkgY29uZmlnIG9wdGlvbnNcbikge1xuICAgIGNvbnN0IGZvcm1hdHRlZDogYW55ID0ge1xuICAgICAgICAuLi50aGlzUHJvcCxcbiAgICAgICAgLy8gVXNlIGN1c3RvbSBsYWJlbCBpZiBwcm92aWRlZCBpbiBzY2hlbWEgKHRoaXNQcm9wLmxhYmVsKSwgb3RoZXJ3aXNlIGZvcm1hdCB0aGUgbmFtZSB0byBodW1hbi1yZWFkYWJsZVxuICAgICAgICBsYWJlbDogKHRoaXNQcm9wIGFzIGFueSkubGFiZWwgfHwgdG9IdW1hblJlYWRhYmxlTmFtZSh0aGlzUHJvcC5uYW1lKSxcbiAgICAgICAgY29sdW1uOiB0aGlzUHJvcC5pZCxcbiAgICAgICAgZmllbGRUeXBlOiB0aGlzUHJvcC5maWVsZFR5cGUgfHwgJ3RleHQnLCAgLy8gZmllbGRUeXBlIHNob3VsZCBhbHJlYWR5IGJlIGluZmVycmVkIGluIGJhc2Utc2VydmljZVxuICAgICAgICBoaWRkZW46IHRoaXNQcm9wLmhhc093blByb3BlcnR5KCdpc1Zpc2libGUnKSAmJiAhdGhpc1Byb3AuaXNWaXNpYmxlXG4gICAgfTtcblxuICAgIC8vIEhhbmRsZSBhZGROZXdPcHRpb24gKE9MRCAtIGRlcHJlY2F0ZWQsIGdlbmVyYXRlcyBlbWJlZGRlZCBjb25maWcpIG9yIGFkZE5ld09wdGlvbkNvbmZpZyAoTkVXIC0ganVzdCBwYXNzIHRocm91Z2ggcmVmZXJlbmNlKVxuICAgIGlmIChpc1NlbGVjdEZpZWxkTWV0YWRhdGEodGhpc1Byb3ApICYmIFsgJ2NyZWF0ZScsICd1cGRhdGUnIF0uaW5jbHVkZXModHlwZSkpIHtcbiAgICAgICAgY29uc3Qgc2VsZWN0RmllbGQgPSB0aGlzUHJvcCBhcyBTZWxlY3RGaWVsZE1ldGFkYXRhO1xuXG4gICAgICAgIGlmIChzZWxlY3RGaWVsZC5hZGROZXdPcHRpb25Db25maWcpIHtcbiAgICAgICAgICAgIC8vIE5FVyBXQVk6IFVzZXIgcHJvdmlkZWQgYWRkTmV3T3B0aW9uQ29uZmlnIHJlZmVyZW5jZSAtIGp1c3QgcGFzcyBpdCB0aHJvdWdoXG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdhZGROZXdPcHRpb25Db25maWcnIF0gPSBzZWxlY3RGaWVsZC5hZGROZXdPcHRpb25Db25maWc7XG5cbiAgICAgICAgfSBlbHNlIGlmIChzZWxlY3RGaWVsZC5hZGROZXdPcHRpb24pIHtcbiAgICAgICAgICAgIC8vIE9MRCBXQVkgKERFUFJFQ0FURUQpOiBUcmFuc2Zvcm0gYWRkTmV3T3B0aW9uIHRvIGFkZE5ld09wdGlvbkNvbmZpZyBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxuICAgICAgICAgICAgY29uc3QgeyBlbnRpdHlOYW1lLCBvdmVycmlkZUNvbmZpZyB9ID0gc2VsZWN0RmllbGQuYWRkTmV3T3B0aW9uO1xuXG4gICAgICAgICAgICBpZiAoZW50aXR5TmFtZSAmJiBlbnRpdHlTZXJ2aWNlLmhhc0VudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUoZW50aXR5TmFtZSkpIHtcbiAgICAgICAgICAgICAgICBmb3JtYXR0ZWRbICdhZGROZXdPcHRpb25Db25maWcnIF0gPSB7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnY3JlYXRlJyxcbiAgICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IG92ZXJyaWRlQ29uZmlnIHx8IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN1Ym1pdFN1Y2Nlc3NSZWRpcmVjdDogdW5kZWZpbmVkLCAgLy8gU3RheSBpbiBtb2RhbCBhZnRlciBjcmVhdGlvblxuICAgICAgICAgICAgICAgICAgICAgICAgZm9ybUJ1dHRvbnM6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7IHRleHQ6IFwiQWRkXCIsIGFjdGlvbjogXCJzdWJtaXRcIiB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsgdGV4dDogXCJDYW5jZWxcIiwgYWN0aW9uOiBcImNhbmNlbFwiIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsOiBDb3VsZCBub3QgZmluZCByZWxhdGVkLWVudGl0eS1zZXJ2aWNlIGZvciBlbnRpdHkgWyR7ZW50aXR5TmFtZX1dIGluICR7ZW50aXR5U2VydmljZS5jb25zdHJ1Y3Rvci5uYW1lfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gUGFzcyBxdWlja0NyZWF0ZSBVWCBjb25maWcgdGhyb3VnaCB2ZXJiYXRpbSAoIzQ0KS5cbiAgICAgICAgLy8gdWkyNCB1c2VzIGl0IHRvIHN1cmZhY2UgYSBjb250ZXh0dWFsIFwiKyBDcmVhdGUgJ1t0ZXJtXSdcIiBidXR0b24gaW4gdGhlXG4gICAgICAgIC8vIGRyb3Bkb3duIHdoZW4gdGhlIHNlYXJjaCByZXR1cm5zIG5vIHJlc3VsdHMuICBUaGUgZW50aXR5IGNyZWF0ZSBmb3JtIGlzXG4gICAgICAgIC8vIHJlc29sdmVkIGZyb20gYWRkTmV3T3B0aW9uQ29uZmlnIOKAlCBub3RoaW5nIGlzIGR1cGxpY2F0ZWQgaGVyZS5cbiAgICAgICAgaWYgKHNlbGVjdEZpZWxkLnF1aWNrQ3JlYXRlKSB7XG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdxdWlja0NyZWF0ZScgXSA9IHNlbGVjdEZpZWxkLnF1aWNrQ3JlYXRlO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gUmVzb2x2ZSBSZWxhdGlvbkVudGl0eU9wdGlvbkNvbmZpZyDihpIgRmllbGRPcHRpb25zQVBJQ29uZmlnIGZvciBzZWxlY3QgZmllbGRzIG9uIGZvcm0gcGFnZXNcbiAgICBpZiAoaXNTZWxlY3RGaWVsZE1ldGFkYXRhKHRoaXNQcm9wKSAmJiB0aGlzUHJvcC5vcHRpb25zXG4gICAgICAgICYmIHR5cGVvZiB0aGlzUHJvcC5vcHRpb25zID09PSAnb2JqZWN0JyAmJiAhQXJyYXkuaXNBcnJheSh0aGlzUHJvcC5vcHRpb25zKVxuICAgICAgICAmJiAnZW50aXR5TmFtZScgaW4gdGhpc1Byb3Aub3B0aW9ucyAmJiB0aGlzUHJvcC5yZWxhdGlvblxuICAgICkge1xuICAgICAgICBjb25zdCByZXNvbHZlZCA9IHJlc29sdmVSZWxhdGlvbk9wdGlvbkNvbmZpZyhcbiAgICAgICAgICAgIHRoaXNQcm9wLm9wdGlvbnMgYXMgUmVsYXRpb25FbnRpdHlPcHRpb25Db25maWcsXG4gICAgICAgICAgICB0aGlzUHJvcCBhcyBUSU9TY2hlbWFBdHRyaWJ1dGUgJiB7IHJlbGF0aW9uOiBOb25OdWxsYWJsZTxUSU9TY2hlbWFBdHRyaWJ1dGVbICdyZWxhdGlvbicgXT4gfSxcbiAgICAgICAgICAgIGVudGl0eVNlcnZpY2UsXG4gICAgICAgICAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnNcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKHJlc29sdmVkKSB7XG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdvcHRpb25zJyBdID0gcmVzb2x2ZWQ7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgcmVsYXRpb24gZmllbGRzIChEQVRBIExBWUVSICsgVUkgTEFZRVIpXG4gICAgaWYgKHRoaXNQcm9wLnJlbGF0aW9uICYmIHR5cGUgPT09ICdkZXRhaWwnKSB7XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uID0gdGhpc1Byb3AucmVsYXRpb247XG4gICAgICAgIGNvbnN0IHsgZW50aXR5TmFtZSwgdHlwZTogcmVsYXRpb25UeXBlLCBpZGVudGlmaWVycyB9ID0gcmVsYXRpb247XG4gICAgICAgIGNvbnN0IGVudGl0eU5hbWVMb3dlciA9IGVudGl0eU5hbWUudG9Mb3dlckNhc2UoKTtcblxuICAgICAgICBpZiAoIWVudGl0eVNlcnZpY2UuaGFzRW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShlbnRpdHlOYW1lKSkge1xuICAgICAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWw6IENvdWxkIG5vdCBmaW5kIHJlbGF0ZWQtZW50aXR5LXNlcnZpY2UgZm9yIGVudGl0eSBbJHtlbnRpdHlOYW1lfV0gaW4gJHtlbnRpdHlTZXJ2aWNlLmNvbnN0cnVjdG9yLm5hbWV9YCk7XG4gICAgICAgICAgICByZXR1cm4gZm9ybWF0dGVkO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUmVzb2x2ZSBpZGVudGlmaWVycyAoY291bGQgYmUgZGlyZWN0IHZhbHVlIG9yIGxhenkgZnVuY3Rpb24pXG4gICAgICAgIGNvbnN0IHJlc29sdmVkSWRlbnRpZmllcnMgPSB0eXBlb2YgaWRlbnRpZmllcnMgPT09ICdmdW5jdGlvbicgPyBpZGVudGlmaWVycygpIDogaWRlbnRpZmllcnM7XG5cbiAgICAgICAgLy8gU2FmZXR5IGNoZWNrIGZvciBhcnJheSBpZGVudGlmaWVyc1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShyZXNvbHZlZElkZW50aWZpZXJzKSkge1xuICAgICAgICAgICAgaWYgKHJlc29sdmVkSWRlbnRpZmllcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWw6IEVtcHR5IGlkZW50aWZpZXJzIGFycmF5IGZvciByZWxhdGlvbiBbJHtlbnRpdHlOYW1lfV1gKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gZm9ybWF0dGVkO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gSGFuZGxlIGJvdGggc2luZ2xlIGFuZCBtdWx0aXBsZSBpZGVudGlmaWVycyBmb3IgY29tcG9zaXRlIGtleXNcbiAgICAgICAgY29uc3QgaWRlbnRpZmllck1hcHBpbmdzID0gQXJyYXkuaXNBcnJheShyZXNvbHZlZElkZW50aWZpZXJzKVxuICAgICAgICAgICAgPyByZXNvbHZlZElkZW50aWZpZXJzLm1hcChpZCA9PiAoe1xuICAgICAgICAgICAgICAgIHNvdXJjZTogU3RyaW5nKGlkLnNvdXJjZSksXG4gICAgICAgICAgICAgICAgdGFyZ2V0OiBTdHJpbmcoaWQudGFyZ2V0KVxuICAgICAgICAgICAgfSkpXG4gICAgICAgICAgICA6IFsge1xuICAgICAgICAgICAgICAgIHNvdXJjZTogU3RyaW5nKHJlc29sdmVkSWRlbnRpZmllcnMuc291cmNlKSxcbiAgICAgICAgICAgICAgICB0YXJnZXQ6IFN0cmluZyhyZXNvbHZlZElkZW50aWZpZXJzLnRhcmdldClcbiAgICAgICAgICAgIH0gXTtcblxuICAgICAgICAvLyBGb3Igcm91dGUgcGF0dGVybiBhbmQgZGVmYXVsdCBmaWx0ZXJzLCB1c2UgdGhlIGZpcnN0IGlkZW50aWZpZXJcbiAgICAgICAgLy8gKG1vc3QgZW50aXRpZXMgaGF2ZSBzaW5nbGUgaWRlbnRpZmllcjsgY29tcG9zaXRlIGtleXMgbmVlZCBleHBsaWNpdCByb3V0ZVBhdHRlcm4pXG4gICAgICAgIGNvbnN0IHByaW1hcnlJZGVudGlmaWVyID0gaWRlbnRpZmllck1hcHBpbmdzWyAwIF07XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgdXNlciBwcm92aWRlZCBjdXN0b20gVUkgY29uZmlnIGluIHJlbGF0aW9uQ29uZmlnIChvcHRpb25hbCBvdmVycmlkZSlcbiAgICAgICAgY29uc3QgdXNlclJlbGF0aW9uQ29uZmlnID0gdGhpc1Byb3AucmVsYXRpb25Db25maWcgYXMgSVJlbGF0aW9uRmllbGRDb25maWcgfCB1bmRlZmluZWQ7XG5cbiAgICAgICAgLy8gR2V0IHJlbGF0ZWQgZW50aXR5IHNlcnZpY2UgZm9yIG1ldGFkYXRhIChpY29uLCBldGMuKVxuICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5U2VydmljZSA9IGVudGl0eVNlcnZpY2UuaGFzRW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShlbnRpdHlOYW1lKVxuICAgICAgICAgICAgPyBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUoZW50aXR5TmFtZSlcbiAgICAgICAgICAgIDogdW5kZWZpbmVkO1xuXG4gICAgICAgIC8vIEdldCBlbnRpdHkgbWV0YWRhdGEgZm9yIGljb24gYW5kIGZhbGxiYWNrIGdlbmVyYXRpb25cbiAgICAgICAgY29uc3QgcmVsYXRlZEVudGl0eU1ldGFkYXRhID0gcmVsYXRlZEVudGl0eVNlcnZpY2U/LmdldEVudGl0eVNjaGVtYT8uKCkubW9kZWw7XG4gICAgICAgIGNvbnN0IGRlZmF1bHRJY29uID0gcmVsYXRlZEVudGl0eU1ldGFkYXRhPy5tZXRhZGF0YT8uaWNvbjtcblxuICAgICAgICBpZiAocmVsYXRpb25UeXBlLmVuZHNXaXRoKCd0by1vbmUnKSkge1xuICAgICAgICAgICAgLy8gVE8tT05FOiBTaG93IHZhbHVlIGFzIGxpbmsgKyBtb2RhbCBpY29uXG4gICAgICAgICAgICAvLyBSb3V0ZSBwYXR0ZXJuOiBVc2UgY3VzdG9tIChmcm9tIHJlbGF0aW9uQ29uZmlnKSBvciBkZWZhdWx0IHRvIC92aWV3LXtlbnRpdHl9Lzp0YXJnZXRJZFxuICAgICAgICAgICAgY29uc3Qgcm91dGVQYXR0ZXJuID0gdXNlclJlbGF0aW9uQ29uZmlnPy5yb3V0ZVBhdHRlcm5cbiAgICAgICAgICAgICAgICB8fCBgL3ZpZXctJHtlbnRpdHlOYW1lTG93ZXJ9Lzoke3ByaW1hcnlJZGVudGlmaWVyLnRhcmdldH1gO1xuXG4gICAgICAgICAgICAvLyBHZW5lcmF0ZSBmYWxsYmFjayBjb25maWd1cmF0aW9uIGZvciB3aGVuIG9ubHkgSUQgaXMgYXZhaWxhYmxlXG4gICAgICAgICAgICBjb25zdCBmYWxsYmFja0NvbmZpZyA9IGdlbmVyYXRlUmVsYXRpb25GYWxsYmFjayhcbiAgICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgIHByaW1hcnlJZGVudGlmaWVyLnNvdXJjZSxcbiAgICAgICAgICAgICAgICByZWxhdGVkRW50aXR5U2VydmljZVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgLy8gQXV0by1kZXRlY3QgZHVwbGljYXRlZCByZWxhdGlvbiBmaWVsZCAoZS5nLiwgdGVhbU5hbWUgZm9yIHRlYW1JZClcbiAgICAgICAgICAgIC8vIE5FVzogVXNlIGVuaGFuY2VkIGRldGVjdGlvbiB3aXRoIGNvbmZpZyBzdXBwb3J0XG4gICAgICAgICAgICBsZXQgYXV0b1RlbXBsYXRlOiBzdHJpbmcgfCB1bmRlZmluZWQgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICBsZXQgZGV0ZWN0aW9uTWV0YWRhdGE6IGFueSA9IHVuZGVmaW5lZDtcblxuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgYXV0by1kZXRlY3Rpb24gaXMgZW5hYmxlZCAoZGVmYXVsdDogdHJ1ZSlcbiAgICAgICAgICAgIGNvbnN0IGF1dG9EZXRlY3RFbmFibGVkID0gdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5hdXRvRGV0ZWN0ICE9PSBmYWxzZTtcblxuICAgICAgICAgICAgaWYgKGF1dG9EZXRlY3RFbmFibGVkICYmIGFsbFByb3BlcnRpZXMpIHtcbiAgICAgICAgICAgICAgICAvLyBHZXQgZ2xvYmFsIGNvbmZpZyAocGFzc2VkIGZyb20gZncyNCBpbml0aWFsaXphdGlvbilcbiAgICAgICAgICAgICAgICBjb25zdCBnbG9iYWxDb25maWcgPSBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/LmR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbjtcblxuICAgICAgICAgICAgICAgIC8vIEdldCBlbnRpdHktbGV2ZWwgY29uZmlnIGZyb20gZW50aXR5IG1ldGFkYXRhXG4gICAgICAgICAgICAgICAgY29uc3QgZW50aXR5Q29uZmlnID0gcmVsYXRlZEVudGl0eU1ldGFkYXRhPy5tZXRhZGF0YT8uZHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uO1xuXG4gICAgICAgICAgICAgICAgLy8gR2V0IHJlbGF0aW9uLWxldmVsIGhpbnRzXG4gICAgICAgICAgICAgICAgY29uc3QgcmVsYXRpb25IaW50cyA9IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uYXV0b0RldGVjdEhpbnRzO1xuXG4gICAgICAgICAgICAgICAgLy8gUnVuIGVuaGFuY2VkIGRldGVjdGlvblxuICAgICAgICAgICAgICAgIGNvbnN0IGRldGVjdGlvblJlc3VsdCA9IGRldGVjdER1cGxpY2F0ZWRSZWxhdGlvbkZpZWxkcyhcbiAgICAgICAgICAgICAgICAgICAgYWxsUHJvcGVydGllcyxcbiAgICAgICAgICAgICAgICAgICAgdGhpc1Byb3AuaWQsXG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGdsb2JhbENvbmZpZyxcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnLFxuICAgICAgICAgICAgICAgICAgICByZWxhdGlvbkhpbnRzXG4gICAgICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgICAgIGlmIChkZXRlY3Rpb25SZXN1bHQpIHtcbiAgICAgICAgICAgICAgICAgICAgYXV0b1RlbXBsYXRlID0gZGV0ZWN0aW9uUmVzdWx0LnRlbXBsYXRlO1xuXG4gICAgICAgICAgICAgICAgICAgIC8vIFN0b3JlIG1ldGFkYXRhIGZvciBkZWJ1Z2dpbmcgYW5kIGZ1dHVyZSBmZWF0dXJlc1xuICAgICAgICAgICAgICAgICAgICBkZXRlY3Rpb25NZXRhZGF0YSA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRldGVjdGVkRmllbGRzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJpbWFyeTogZGV0ZWN0aW9uUmVzdWx0LnByaW1hcnlGaWVsZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhbHRlcm5hdGl2ZXM6IGRldGVjdGlvblJlc3VsdC5kZXRlY3RlZEZpZWxkcy5kaXNwbGF5Py5zbGljZSgxKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aXN1YWw6IGRldGVjdGlvblJlc3VsdC5kZXRlY3RlZEZpZWxkcy52aXN1YWwsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWV0YTogZGV0ZWN0aW9uUmVzdWx0LmRldGVjdGVkRmllbGRzLm1ldGFcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25maWRlbmNlOiBkZXRlY3Rpb25SZXN1bHQuY29uZmlkZW5jZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1ldGhvZDogZGV0ZWN0aW9uUmVzdWx0Lm1ldGhvZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhdHRlcm46IGRldGVjdGlvblJlc3VsdC5wYXR0ZXJuXG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZzogSVJlbGF0aW9uRmllbGRDb25maWcgPSB7XG4gICAgICAgICAgICAgICAgcm91dGVQYXR0ZXJuOiByb3V0ZVBhdHRlcm4sXG4gICAgICAgICAgICAgICAgLy8gUGFzcyBBTEwgaWRlbnRpZmllciBtYXBwaW5ncyAoc3VwcG9ydHMgY29tcG9zaXRlIGtleXMpXG4gICAgICAgICAgICAgICAgaWRlbnRpZmllck1hcHBpbmc6IGlkZW50aWZpZXJNYXBwaW5ncy5sZW5ndGggPT09IDFcbiAgICAgICAgICAgICAgICAgICAgPyBpZGVudGlmaWVyTWFwcGluZ3NbIDAgXSAgLy8gU2luZ2xlOiByZXR1cm4gb2JqZWN0XG4gICAgICAgICAgICAgICAgICAgIDogaWRlbnRpZmllck1hcHBpbmdzLCAgICAgLy8gTXVsdGlwbGU6IHJldHVybiBhcnJheVxuICAgICAgICAgICAgICAgIG1vZGFsQ29uZmlnUmVmOiB1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsQ29uZmlnUmVmIHx8IHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICd2aWV3JyxcbiAgICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHt9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBtb2RhbFdpZHRoOiB1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsV2lkdGgsXG4gICAgICAgICAgICAgICAgbW9kYWxUaXRsZTogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbFRpdGxlLFxuICAgICAgICAgICAgICAgIGRpc3BsYXlDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgLy8gUHJpb3JpdHk6IFVzZXIgY3VzdG9tIHRlbXBsYXRlID4gQXV0by1kZXRlY3RlZCBkdXBsaWNhdGVkIGZpZWxkID4gdW5kZWZpbmVkICh1c2UgZmFsbGJhY2spXG4gICAgICAgICAgICAgICAgICAgIHRlbXBsYXRlOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnRlbXBsYXRlIHx8IGF1dG9UZW1wbGF0ZSxcbiAgICAgICAgICAgICAgICAgICAgLy8gU21hcnQgZmFsbGJhY2sgcHJlLWdlbmVyYXRlZCBmcm9tIGVudGl0eSBtZXRhZGF0YVxuICAgICAgICAgICAgICAgICAgICBmYWxsYmFjazogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5mYWxsYmFjayB8fCBmYWxsYmFja0NvbmZpZyxcbiAgICAgICAgICAgICAgICAgICAgLy8gSWNvbiBmcm9tIGVudGl0eSBtZXRhZGF0YSBvciB1c2VyIG92ZXJyaWRlXG4gICAgICAgICAgICAgICAgICAgIGljb246IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uaWNvbiB8fCBkZWZhdWx0SWNvbiB8fCAnRXllT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgICAgICBzaG93TW9kYWxJY29uOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnNob3dNb2RhbEljb24gIT09IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICBzaG93TGluazogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5zaG93TGluayAhPT0gZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgIC8vIFBhc3MgdGhyb3VnaCBhdXRvRGV0ZWN0IGFuZCBhdXRvRGV0ZWN0SGludHNcbiAgICAgICAgICAgICAgICAgICAgYXV0b0RldGVjdDogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5hdXRvRGV0ZWN0LFxuICAgICAgICAgICAgICAgICAgICBhdXRvRGV0ZWN0SGludHM6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uYXV0b0RldGVjdEhpbnRzLFxuICAgICAgICAgICAgICAgICAgICAvLyBQYXNzIHRocm91Z2ggYW55IGN1c3RvbSBhY3Rpb25zXG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uYWN0aW9ucyxcbiAgICAgICAgICAgICAgICAgICAgLy8gUGFzcyB0aHJvdWdoIHByZXZpZXcgY29uZmlnIGZvciBSZWxhdGVkIFJlY29yZCBQZWVrICgjMTAzKVxuICAgICAgICAgICAgICAgICAgICAuLi4odXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5wcmV2aWV3ICYmIHsgcHJldmlldzogdXNlclJlbGF0aW9uQ29uZmlnLmRpc3BsYXlDb25maWcucHJldmlldyB9KVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBpZiAoZ2xvYmFsVUlDb25maWdPcHRpb25zPy5kdXBsaWNhdGVkRmllbGREZXRlY3Rpb24/LmRlYnVnKSB7XG4gICAgICAgICAgICAgICAgZ2VuZXJhdGVkUmVsYXRpb25Db25maWcuZGlzcGxheUNvbmZpZyFbICdfZGV0ZWN0aW9uTWV0YWRhdGEnIF0gPSBkZXRlY3Rpb25NZXRhZGF0YTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZm9ybWF0dGVkWyAncmVsYXRpb25Db25maWcnIF0gPSBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZztcblxuICAgICAgICAgICAgLy8gQmFja3dhcmQgY29tcGF0aWJpbGl0eTogS2VlcCBpc0xpbmsgYW5kIGxpbmtDb25maWdcbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ2lzTGluaycgXSA9IHRydWU7XG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdsaW5rQ29uZmlnJyBdID0ge1xuICAgICAgICAgICAgICAgIHJvdXRlUGF0dGVybjogcm91dGVQYXR0ZXJuXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgIH0gZWxzZSBpZiAocmVsYXRpb25UeXBlLmVuZHNXaXRoKCd0by1tYW55JykpIHtcbiAgICAgICAgICAgIC8vIFRPLU1BTlk6IFNob3cgY291bnQgKyBtb2RhbCBpY29uIChvcGVucyBmaWx0ZXJlZCBsaXN0KVxuICAgICAgICAgICAgLy8gUm91dGUgcGF0dGVybjogVXNlIGN1c3RvbSAoZnJvbSByZWxhdGlvbkNvbmZpZykgb3IgZGVmYXVsdCB0byAvbGlzdC17ZW50aXR5fVxuICAgICAgICAgICAgY29uc3Qgcm91dGVQYXR0ZXJuID0gdXNlclJlbGF0aW9uQ29uZmlnPy5yb3V0ZVBhdHRlcm5cbiAgICAgICAgICAgICAgICB8fCBgL2xpc3QtJHtlbnRpdHlOYW1lTG93ZXJ9YDtcblxuICAgICAgICAgICAgLy8gQnVpbGQgZGVmYXVsdCBmaWx0ZXJzIHRvIHNob3cgb25seSByZWxhdGVkIGl0ZW1zXG4gICAgICAgICAgICAvLyBGb3IgZXhhbXBsZSwgaWYgd2UncmUgdmlld2luZyBhIFRlYW0gYW5kIHRoaXMgZmllbGQgc2hvd3MgR2FtZXMsXG4gICAgICAgICAgICAvLyB3ZSB3YW50IHRvIGZpbHRlciBnYW1lcyB3aGVyZSB0ZWFtSWQgPSBjdXJyZW50IHRlYW0ncyBJRFxuICAgICAgICAgICAgLy8gRm9yIGNvbXBvc2l0ZSBrZXlzLCBhZGQgYWxsIGlkZW50aWZpZXJzIGFzIGZpbHRlcnNcbiAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRGaWx0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgICAgICAgICBpZGVudGlmaWVyTWFwcGluZ3MuZm9yRWFjaChtYXBwaW5nID0+IHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyc1sgbWFwcGluZy50YXJnZXQgXSA9IGA6JHttYXBwaW5nLnNvdXJjZX1gO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIEdlbmVyYXRlIGZhbGxiYWNrIGNvbmZpZ3VyYXRpb24gZm9yIHRvLW1hbnkgKHNob3dzIGNvdW50KVxuICAgICAgICAgICAgY29uc3QgZmFsbGJhY2tDb25maWcgPSBnZW5lcmF0ZVJlbGF0aW9uRmFsbGJhY2soXG4gICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICBwcmltYXJ5SWRlbnRpZmllci5zb3VyY2UsXG4gICAgICAgICAgICAgICAgcmVsYXRlZEVudGl0eVNlcnZpY2VcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIGNvbnN0IGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnOiBJUmVsYXRpb25GaWVsZENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICByb3V0ZVBhdHRlcm46IHJvdXRlUGF0dGVybixcbiAgICAgICAgICAgICAgICAvLyBQYXNzIEFMTCBpZGVudGlmaWVyIG1hcHBpbmdzIChzdXBwb3J0cyBjb21wb3NpdGUga2V5cylcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyTWFwcGluZzogaWRlbnRpZmllck1hcHBpbmdzLmxlbmd0aCA9PT0gMVxuICAgICAgICAgICAgICAgICAgICA/IGlkZW50aWZpZXJNYXBwaW5nc1sgMCBdICAvLyBTaW5nbGU6IHJldHVybiBvYmplY3RcbiAgICAgICAgICAgICAgICAgICAgOiBpZGVudGlmaWVyTWFwcGluZ3MsICAgICAvLyBNdWx0aXBsZTogcmV0dXJuIGFycmF5XG4gICAgICAgICAgICAgICAgbW9kYWxDb25maWdSZWY6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxDb25maWdSZWYgfHwge1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IGRlZmF1bHRGaWx0ZXJzXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIG1vZGFsV2lkdGg6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxXaWR0aCxcbiAgICAgICAgICAgICAgICBtb2RhbFRpdGxlOiB1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsVGl0bGUsXG4gICAgICAgICAgICAgICAgZGlzcGxheUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAvLyBVc2VyIGNhbiBvdmVycmlkZSB3aXRoIGN1c3RvbSB0ZW1wbGF0ZVxuICAgICAgICAgICAgICAgICAgICB0ZW1wbGF0ZTogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy50ZW1wbGF0ZSxcbiAgICAgICAgICAgICAgICAgICAgLy8gU21hcnQgZmFsbGJhY2sgcHJlLWdlbmVyYXRlZCBmcm9tIGVudGl0eSBtZXRhZGF0YVxuICAgICAgICAgICAgICAgICAgICBmYWxsYmFjazogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5mYWxsYmFjayB8fCBmYWxsYmFja0NvbmZpZyxcbiAgICAgICAgICAgICAgICAgICAgLy8gSWNvbiBmcm9tIGVudGl0eSBtZXRhZGF0YSBvciB1c2VyIG92ZXJyaWRlXG4gICAgICAgICAgICAgICAgICAgIGljb246IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uaWNvbiB8fCBkZWZhdWx0SWNvbiB8fCAnVW5vcmRlcmVkTGlzdE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICAgICAgc2hvd01vZGFsSWNvbjogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5zaG93TW9kYWxJY29uICE9PSBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgc2hvd0xpbms6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uc2hvd0xpbmsgIT09IHRydWUsIC8vIERlZmF1bHQgZmFsc2UgZm9yIHRvLW1hbnlcbiAgICAgICAgICAgICAgICAgICAgLy8gUGFzcyB0aHJvdWdoIGFueSBjdXN0b20gYWN0aW9uc1xuICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmFjdGlvbnNcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAvLyBJZiB1c2VyIHByb3ZpZGVkIGN1c3RvbSBtb2RhbENvbmZpZ1JlZiwgbWVyZ2UgZGVmYXVsdCBmaWx0ZXJzIHdpdGggdGhlaXIgb3ZlcnJpZGVzXG4gICAgICAgICAgICBpZiAodXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbENvbmZpZ1JlZj8ub3ZlcnJpZGVDb25maWcpIHtcbiAgICAgICAgICAgICAgICBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZy5tb2RhbENvbmZpZ1JlZiEub3ZlcnJpZGVDb25maWcgPSB7XG4gICAgICAgICAgICAgICAgICAgIC4uLnVzZXJSZWxhdGlvbkNvbmZpZy5tb2RhbENvbmZpZ1JlZi5vdmVycmlkZUNvbmZpZyxcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLmRlZmF1bHRGaWx0ZXJzLFxuICAgICAgICAgICAgICAgICAgICAgICAgLi4uKHVzZXJSZWxhdGlvbkNvbmZpZy5tb2RhbENvbmZpZ1JlZi5vdmVycmlkZUNvbmZpZy5kZWZhdWx0RmlsdGVycyB8fCB7fSlcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ3JlbGF0aW9uQ29uZmlnJyBdID0gZ2VuZXJhdGVkUmVsYXRpb25Db25maWc7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgbmVzdGVkIHN0cnVjdHVyZXMgKG1hcCBhbmQgbGlzdCB0eXBlcylcbiAgICBpZiAodGhpc1Byb3AudHlwZSA9PT0gJ21hcCcgJiYgdGhpc1Byb3AucHJvcGVydGllcykge1xuICAgICAgICBmb3JtYXR0ZWRbICdwcm9wZXJ0aWVzJyBdID0gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckZvcm1PckRldGFpbCh0aGlzUHJvcC5wcm9wZXJ0aWVzLCB0eXBlLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICB9IGVsc2UgaWYgKHRoaXNQcm9wLnR5cGUgPT09ICdsaXN0Jykge1xuICAgICAgICAvLyBGb3IgbGlzdCB0eXBlcywgY2hlY2sgaWYgaXRlbXMgYXJlIG1hcHMgKG5lc3RlZCBzdHJ1Y3R1cmVzKVxuICAgICAgICAvLyBOb3RlOiBpdGVtcyBwcm9wZXJ0eSBleGlzdHMgb24gbGlzdC10eXBlIGF0dHJpYnV0ZXMgYnV0IG5vdCBpbiBiYXNlIEVudGl0eUF0dHJpYnV0ZSB0eXBlXG4gICAgICAgIGNvbnN0IGV4dGVuZGVkUHJvcCA9IHRoaXNQcm9wIGFzIFRJT1NjaGVtYUF0dHJpYnV0ZSAmIHsgaXRlbXM/OiB7IHR5cGU6IHN0cmluZzsgcHJvcGVydGllcz86IFRJT1NjaGVtYUF0dHJpYnV0ZVtdIH0gfTtcbiAgICAgICAgaWYgKGV4dGVuZGVkUHJvcC5pdGVtcz8udHlwZSA9PT0gJ21hcCcgJiYgZXh0ZW5kZWRQcm9wLml0ZW1zLnByb3BlcnRpZXMpIHtcbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ2l0ZW1zJyBdID0ge1xuICAgICAgICAgICAgICAgIC4uLmZvcm1hdHRlZFsgJ2l0ZW1zJyBdLFxuICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JGb3JtT3JEZXRhaWwoZXh0ZW5kZWRQcm9wLml0ZW1zLnByb3BlcnRpZXMsIHR5cGUsIGVudGl0eVNlcnZpY2UpXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZvcm1hdHRlZDtcbn1cblxuLyoqXG4gKiBSb3V0ZXMgYXR0cmlidXRlIGZvcm1hdHRpbmcgdG8gdGhlIGFwcHJvcHJpYXRlIHR5cGUtc3BlY2lmaWMgZm9ybWF0dGVyLlxuICogXG4gKiBDb252ZW5pZW5jZSBmdW5jdGlvbiB0aGF0IGRlbGVnYXRlcyB0byBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yQ3JlYXRlLFxuICogZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvclVwZGF0ZSwgb3IgZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckRldGFpbCBiYXNlZCBvbiB0eXBlLlxuICogXG4gKiBAcGFyYW0gcHJvcGVydGllcyAtIEFycmF5IG9mIGVudGl0eSBhdHRyaWJ1dGVzIHRvIGZvcm1hdFxuICogQHBhcmFtIHR5cGUgLSBQYWdlIHR5cGU6ICdjcmVhdGUnLCAndXBkYXRlJywgb3IgJ2RldGFpbCdcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gRW50aXR5IHNlcnZpY2UgZm9yIGFjY2Vzc2luZyBzY2hlbWFzXG4gKiBAcmV0dXJucyBBcnJheSBvZiBmb3JtYXR0ZWQgZmllbGQgbWV0YWRhdGFcbiAqIEB0aHJvd3MgRXJyb3IgaWYgaW52YWxpZCB0eXBlIGlzIHByb3ZpZGVkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRm9ybU9yRGV0YWlsKFxuICAgIHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLFxuICAgIHR5cGU6ICdjcmVhdGUnIHwgJ3VwZGF0ZScgfCAnZGV0YWlsJyxcbiAgICBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+XG4pIHtcblxuICAgIGlmICh0eXBlID09PSAnY3JlYXRlJykge1xuICAgICAgICByZXR1cm4gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckNyZWF0ZShwcm9wZXJ0aWVzLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICB9XG5cbiAgICBpZiAodHlwZSA9PT0gJ3VwZGF0ZScpIHtcbiAgICAgICAgcmV0dXJuIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JVcGRhdGUocHJvcGVydGllcywgZW50aXR5U2VydmljZSk7XG4gICAgfVxuXG4gICAgaWYgKHR5cGUgPT09ICdkZXRhaWwnKSB7XG4gICAgICAgIHJldHVybiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRGV0YWlsKHByb3BlcnRpZXMsIGVudGl0eVNlcnZpY2UpO1xuICAgIH1cbiAgICB0aHJvdyAoYEludmFsaWQgdHlwZSBbJHt0eXBlfV0gcHJvdmlkZWQgdG8gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckZvcm1PckRldGFpbGApO1xufVxuXG4vKipcbiAqIEV4cGFuZHMgc2hvcnRoYW5kIGZpZWxkIHJlZmVyZW5jZXMgaW50byBmdWxsIFByb3BlcnR5Q29uZmlnIG9iamVjdHMuXG4gKiBcbiAqICoqRW50ZXJwcmlzZS1HcmFkZSBQYXR0ZXJuIFN1cHBvcnRpbmc6KipcbiAqIFxuICogMS4gKipTdHJpbmcgc2hvcnRoYW5kIChzY2hlbWEgZmllbGRzIG9ubHkpOioqIGAnZmllbGROYW1lJ2Ag4oaSIGxvb2tzIHVwIGluIHNjaGVtYSwgZXhwYW5kcyB0byBmdWxsIGNvbmZpZ1xuICogMi4gKipPYmplY3Qgd2l0aCBzY2hlbWEgZmllbGQ6KiogYHsgbmFtZTogJ3N0YXR1cycsIGZpZWxkVHlwZTogJ2JhZGdlJyB9YCDihpIgbWVyZ2VzIG92ZXJyaWRlcyB3aXRoIHNjaGVtYSBkZWZhdWx0c1xuICogMy4gKipKU09OIHBhdGggKG5lc3RlZCBkYXRhKToqKiBgeyBuYW1lOiAndXNlckVtYWlsJywgY29sdW1uOiAndXNlci5lbWFpbCcsIGxhYmVsOiAnRW1haWwnLCBmaWVsZFR5cGU6ICd0ZXh0JyB9YFxuICogNC4gKipNdWx0aXBsZSByZW5kZXJpbmdzOioqIGB7IG5hbWU6ICdzdGF0dXNCYWRnZScsIGNvbHVtbjogJ3N0YXR1cycsIGZpZWxkVHlwZTogJ2JhZGdlJyB9YCArIGB7IG5hbWU6ICdzdGF0dXNUZXh0JywgY29sdW1uOiAnc3RhdHVzJywgZmllbGRUeXBlOiAndGV4dCcgfWBcbiAqIDUuICoqQ3VzdG9tL2NvbXB1dGVkIGZpZWxkczoqKiBgeyBuYW1lOiAnY29uZmlybVBhc3N3b3JkJywgbGFiZWw6ICdDb25maXJtJywgY29sdW1uOiAnY29uZmlybVBhc3N3b3JkJywgZmllbGRUeXBlOiAncGFzc3dvcmQnIH1gXG4gKiA2LiAqKlZpc2liaWxpdHkgY29udHJvbDoqKiBBbGwgY29uZmlncyBzdXBwb3J0IGB2aXNpYmlsaXR5OiBDb25kaXRpb25gIGZvciByb2xlLWJhc2VkL2NvbmRpdGlvbmFsIGRpc3BsYXlcbiAqIFxuICogKipLZXkgQ29uY2VwdHM6KipcbiAqIC0gYG5hbWVgOiBVbmlxdWUgVUkgaWRlbnRpZmllciAobXVzdCBiZSB1bmlxdWUgd2l0aGluIGEgc2luZ2xlIHByb3BlcnRpZXNDb25maWcpXG4gKiAtIGBjb2x1bW5gOiBEYXRhIHBhdGggLSBjYW4gYmUgZGlyZWN0IGZpZWxkLCBKU09OIHBhdGggKGB1c2VyLmVtYWlsYCksIG9yIGN1c3RvbSBmaWVsZFxuICogLSBGcm9udGVuZCB1c2VzIGBnZXROZXN0ZWRWYWx1ZShyZWNvcmQsIGNvbHVtbilgIGZvciBkYXRhIGFjY2VzcyAoc3VwcG9ydHMgSlNPTiBwYXRocylcbiAqIFxuICogVGhpcyBpcyB0aGUgcHJvcGVydHkgZXF1aXZhbGVudCBvZiBgbm9ybWFsaXplQ29sdW1uT3ZlcnJpZGVzKClgLlxuICogXG4gKiBAcGFyYW0gZmllbGRSZWZlcmVuY2VzIC0gQXJyYXkgY29udGFpbmluZyBzdHJpbmdzIChmaWVsZCBuYW1lcykgb3IgUHJvcGVydHlDb25maWcgb2JqZWN0c1xuICogQHBhcmFtIGFsbFByb3BlcnRpZXMgLSBBbGwgZW50aXR5IGF0dHJpYnV0ZXMgZnJvbSBzY2hlbWEgZm9yIGZpZWxkIGxvb2t1cFxuICogQHBhcmFtIHR5cGUgLSBQYWdlIHR5cGU6ICdjcmVhdGUnLCAndXBkYXRlJywgb3IgJ2RldGFpbCcgKGRldGVybWluZXMgZm9ybWF0dGluZylcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gRW50aXR5IHNlcnZpY2UgZm9yIGFjY2Vzc2luZyByZWxhdGVkIHNjaGVtYXNcbiAqIEBwYXJhbSBnbG9iYWxVSUNvbmZpZ09wdGlvbnMgLSBPcHRpb25hbCBnbG9iYWwgVUkgY29uZmlndXJhdGlvbiBvcHRpb25zXG4gKiBAcmV0dXJucyBBcnJheSBvZiBmdWxsIFByb3BlcnR5Q29uZmlnIG9iamVjdHNcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIDEuIFN0cmluZyBzaG9ydGhhbmQgKHNjaGVtYSBmaWVsZHMgb25seSlcbiAqIHByb3BlcnRpZXNDb25maWc6IFsndGVhbU5hbWUnLCAnY2l0eScsICdzdGF0dXMnXVxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gMi4gT3ZlcnJpZGUgc2NoZW1hIGZpZWxkIGRpc3BsYXlcbiAqIHByb3BlcnRpZXNDb25maWc6IFtcbiAqICAgJ3RlYW1OYW1lJyxcbiAqICAgeyBuYW1lOiAnc3RhdHVzJywgZmllbGRUeXBlOiAnYmFkZ2UnIH0sICAvLyBTYW1lIGZpZWxkLCBkaWZmZXJlbnQgcmVuZGVyaW5nXG4gKiAgICd0b3RhbCdcbiAqIF1cbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIDMuIE11bHRpcGxlIHJlbmRlcmluZ3Mgb2Ygc2FtZSBmaWVsZFxuICogcHJvcGVydGllc0NvbmZpZzogW1xuICogICB7IG5hbWU6ICdwcm9ncmVzc0JhcicsIGNvbHVtbjogJ3Byb2dyZXNzJywgbGFiZWw6ICdQcm9ncmVzcycsIGZpZWxkVHlwZTogJ3Byb2dyZXNzJyB9LFxuICogICB7IG5hbWU6ICdwcm9ncmVzc1ZhbHVlJywgY29sdW1uOiAncHJvZ3Jlc3MnLCBsYWJlbDogJ1ZhbHVlJywgZmllbGRUeXBlOiAnbnVtYmVyJyB9XG4gKiBdXG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyA0LiBKU09OIHBhdGhzIChuZXN0ZWQgZGF0YSlcbiAqIHByb3BlcnRpZXNDb25maWc6IFtcbiAqICAgJ3RlYW1OYW1lJyxcbiAqICAgeyBuYW1lOiAndXNlckVtYWlsJywgY29sdW1uOiAndXNlci5lbWFpbCcsIGxhYmVsOiAnRW1haWwnLCBmaWVsZFR5cGU6ICd0ZXh0JyB9LFxuICogICB7IG5hbWU6ICdzZXR0aW5nc1RoZW1lJywgY29sdW1uOiAnbWV0YWRhdGEuc2V0dGluZ3MudGhlbWUnLCBsYWJlbDogJ1RoZW1lJywgZmllbGRUeXBlOiAndGV4dCcgfVxuICogXVxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gNS4gQ3VzdG9tL2NvbXB1dGVkIGZpZWxkcyAobm90IGluIHNjaGVtYSwgQVBJIHByb3ZpZGVzIHRoZW0pXG4gKiBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gKiAgICdwYXNzd29yZCcsXG4gKiAgIHtcbiAqICAgICBuYW1lOiAnY29uZmlybVBhc3N3b3JkJyxcbiAqICAgICBsYWJlbDogJ0NvbmZpcm0gUGFzc3dvcmQnLFxuICogICAgIGNvbHVtbjogJ2NvbmZpcm1QYXNzd29yZCcsXG4gKiAgICAgZmllbGRUeXBlOiAncGFzc3dvcmQnLFxuICogICAgIHJlcXVpcmVkOiB0cnVlXG4gKiAgIH1cbiAqIF1cbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIDYuIFdpdGggdmlzaWJpbGl0eSBjb25maWdcbiAqIHByb3BlcnRpZXNDb25maWc6IFtcbiAqICAgJ3RlYW1OYW1lJyxcbiAqICAge1xuICogICAgIG5hbWU6ICdhZG1pbk5vdGVzJyxcbiAqICAgICBsYWJlbDogJ0FkbWluIE5vdGVzJyxcbiAqICAgICBjb2x1bW46ICdhZG1pbk5vdGVzJyxcbiAqICAgICBmaWVsZFR5cGU6ICd0ZXh0YXJlYScsXG4gKiAgICAgdmlzaWJpbGl0eTogeyBhY3RvcjogeyBncm91cHM6IHsgaW5MaXN0OiBbJ2FkbWluJ10gfSB9IH1cbiAqICAgfVxuICogXVxuICovXG5leHBvcnQgZnVuY3Rpb24gZXhwYW5kUHJvcGVydHlSZWZlcmVuY2VzKFxuICAgIGZpZWxkUmVmZXJlbmNlczogUmVhZG9ubHlBcnJheTxzdHJpbmcgfCBhbnk+IHwgQXJyYXk8c3RyaW5nIHwgYW55PixcbiAgICBhbGxQcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSxcbiAgICB0eXBlOiAnY3JlYXRlJyB8ICd1cGRhdGUnIHwgJ2RldGFpbCcsXG4gICAgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PixcbiAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbICd1aUNvbmZpZ0dlbk9wdGlvbnMnIF1cbik6IGFueVtdIHtcbiAgICBjb25zdCBwcm9wZXJ0eU1hcCA9IG5ldyBNYXA8c3RyaW5nLCBUSU9TY2hlbWFBdHRyaWJ1dGU+KCk7XG4gICAgYWxsUHJvcGVydGllcy5mb3JFYWNoKHByb3AgPT4ge1xuICAgICAgICBpZiAocHJvcC5pZCkgeyAvLyBVc2UgcHJvcC5pZCAoZmllbGQgaWRlbnRpZmllcikgbm90IHByb3AubmFtZSAoaHVtYW4tcmVhZGFibGUgbGFiZWwpXG4gICAgICAgICAgICBwcm9wZXJ0eU1hcC5zZXQocHJvcC5pZCwgcHJvcCk7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiBmaWVsZFJlZmVyZW5jZXMubWFwKHByb3BSZWYgPT4ge1xuICAgICAgICAvLyBDYXNlIDE6IFN0cmluZyBzaG9ydGhhbmQg4oaSIE1VU1QgYmUgYSBkaXJlY3Qgc2NoZW1hIGZpZWxkIChjb252ZW5pZW5jZSBzaG9ydGN1dClcbiAgICAgICAgaWYgKHR5cGVvZiBwcm9wUmVmID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgY29uc3QgZmllbGRBdHRyaWJ1dGUgPSBwcm9wZXJ0eU1hcC5nZXQocHJvcFJlZik7XG4gICAgICAgICAgICBpZiAoIWZpZWxkQXR0cmlidXRlKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgICAgICAgICAgICBgRmllbGQgJyR7cHJvcFJlZn0nIG5vdCBmb3VuZCBpbiBlbnRpdHkgc2NoZW1hLiBgICtcbiAgICAgICAgICAgICAgICAgICAgYEF2YWlsYWJsZSBmaWVsZCBJRHM6ICR7QXJyYXkuZnJvbShwcm9wZXJ0eU1hcC5rZXlzKCkpLmpvaW4oJywgJyl9LiBgICtcbiAgICAgICAgICAgICAgICAgICAgYFxcbkZvciBub24tc2NoZW1hIGZpZWxkcyAoSlNPTiBwYXRocywgY3VzdG9tIGZpZWxkcywgbXVsdGlwbGUgcmVuZGVyaW5ncyksIHVzZSBvYmplY3Qgc3ludGF4OlxcbmAgK1xuICAgICAgICAgICAgICAgICAgICBgICB7IG5hbWU6ICd1bmlxdWVOYW1lJywgY29sdW1uOiAnJHtwcm9wUmVmfScsIGxhYmVsOiAnLi4uJywgZmllbGRUeXBlOiAnLi4uJyB9YFxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKGZpZWxkQXR0cmlidXRlLCB0eXBlLCBlbnRpdHlTZXJ2aWNlLCBhbGxQcm9wZXJ0aWVzLCBnbG9iYWxVSUNvbmZpZ09wdGlvbnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2FzZSAyLTU6IE9iamVjdCBzeW50YXggKHBlcm1pc3NpdmUgLSBzdXBwb3J0cyBldmVyeXRoaW5nKVxuICAgICAgICBpZiAodHlwZW9mIHByb3BSZWYgPT09ICdvYmplY3QnICYmIHByb3BSZWYgIT09IG51bGwpIHtcbiAgICAgICAgICAgIC8vIFZhbGlkYXRlIG1pbmltdW0gcmVxdWlyZWQgcHJvcGVydGllc1xuICAgICAgICAgICAgaWYgKCFwcm9wUmVmLm5hbWUpIHtcbiAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYFByb3BlcnR5IGNvbmZpZyBtaXNzaW5nICduYW1lJyBmaWVsZCAocmVxdWlyZWQgZm9yIFVJIGlkZW50aWZpY2F0aW9uKS4gU2tpcHBpbmc6YCwgcHJvcFJlZik7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHByb3BSZWY7IC8vIFJldHVybiBhcy1pcywgbGV0IGZyb250ZW5kIGhhbmRsZVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBEZXRlcm1pbmUgdGhlIGRhdGEgcGF0aCAoY29sdW1uIGNhbiBiZTogZGlyZWN0IGZpZWxkLCBKU09OIHBhdGgsIG9yIGN1c3RvbSBmaWVsZClcbiAgICAgICAgICAgIGNvbnN0IGNvbHVtbiA9IHByb3BSZWYuY29sdW1uIHx8IHByb3BSZWYubmFtZTtcblxuICAgICAgICAgICAgLy8gRXh0cmFjdCBqdXN0IHRoZSByb290IGZpZWxkIG5hbWUgZm9yIHNjaGVtYSBsb29rdXAgKGhhbmRsZXMgSlNPTiBwYXRocyBsaWtlIFwidXNlci5lbWFpbFwiIOKGkiBcInVzZXJcIilcbiAgICAgICAgICAgIGNvbnN0IHJvb3RGaWVsZE5hbWUgPSBjb2x1bW4uc3BsaXQoJy4nKVsgMCBdO1xuICAgICAgICAgICAgY29uc3QgZmllbGRBdHRyaWJ1dGUgPSBwcm9wZXJ0eU1hcC5nZXQocm9vdEZpZWxkTmFtZSk7XG5cbiAgICAgICAgICAgIC8vIElmIHJvb3QgZmllbGQgZXhpc3RzIGluIHNjaGVtYSBBTkQgY29sdW1uIGlzIHRoZSBleGFjdCBmaWVsZCAobm90IGEgcGF0aCksIG1lcmdlIHdpdGggc2NoZW1hXG4gICAgICAgICAgICBpZiAoZmllbGRBdHRyaWJ1dGUgJiYgY29sdW1uID09PSByb290RmllbGROYW1lKSB7XG4gICAgICAgICAgICAgICAgLy8gU2NoZW1hIGZpZWxkIHdpdGggb3ZlcnJpZGVzIC0gbWVyZ2UgZGVmYXVsdHMgKyBvdmVycmlkZXNcbiAgICAgICAgICAgICAgICBjb25zdCBzY2hlbWFEZWZhdWx0cyA9IGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbChmaWVsZEF0dHJpYnV0ZSwgdHlwZSwgZW50aXR5U2VydmljZSwgYWxsUHJvcGVydGllcywgZ2xvYmFsVUlDb25maWdPcHRpb25zKTtcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICAuLi5zY2hlbWFEZWZhdWx0cyxcbiAgICAgICAgICAgICAgICAgICAgLi4ucHJvcFJlZiwgIC8vIFVzZXIgb3ZlcnJpZGVzIHRha2UgcHJlY2VkZW5jZVxuICAgICAgICAgICAgICAgICAgICBjb2x1bW4gIC8vIEVuc3VyZSBjb2x1bW4gaXMgc2V0XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gT3RoZXJ3aXNlOiBKU09OIHBhdGgsIGN1c3RvbSBmaWVsZCwgb3IgbXVsdGlwbGUgcmVuZGVyaW5nIG9mIHNhbWUgZmllbGRcbiAgICAgICAgICAgIC8vIEF1dG8tZ2VuZXJhdGUgbWlzc2luZyBwcm9wZXJ0aWVzIHdpdGggcHJvcGVyIGZvcm1hdHRpbmdcbiAgICAgICAgICAgIGNvbnN0IGxhYmVsID0gcHJvcFJlZi5sYWJlbCB8fCB0b0h1bWFuUmVhZGFibGVOYW1lKHByb3BSZWYubmFtZSk7XG4gICAgICAgICAgICBjb25zdCBmaWVsZFR5cGUgPSBwcm9wUmVmLmZpZWxkVHlwZSB8fCAndGV4dCc7XG5cbiAgICAgICAgICAgIC8vIFdhcm4gaWYgbGFiZWwgd2FzIGF1dG8tZ2VuZXJhdGVkXG4gICAgICAgICAgICBpZiAoIXByb3BSZWYubGFiZWwpIHtcbiAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLmRlYnVnKFxuICAgICAgICAgICAgICAgICAgICBgUHJvcGVydHkgJyR7cHJvcFJlZi5uYW1lfScgbWlzc2luZyAnbGFiZWwnLiBBdXRvLWdlbmVyYXRlZDogJyR7bGFiZWx9Jy4gYCArXG4gICAgICAgICAgICAgICAgICAgIGBGb3IgY3VzdG9tIGZpZWxkcywgZXhwbGljaXRseSBwcm92aWRlOiBuYW1lLCBsYWJlbCwgY29sdW1uLCBmaWVsZFR5cGUuYFxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIXByb3BSZWYuZmllbGRUeXBlKSB7XG4gICAgICAgICAgICAgICAgRGVmYXVsdExvZ2dlci5kZWJ1ZyhcbiAgICAgICAgICAgICAgICAgICAgYFByb3BlcnR5ICcke3Byb3BSZWYubmFtZX0nIG1pc3NpbmcgJ2ZpZWxkVHlwZScuIERlZmF1bHRlZCB0byAndGV4dCcuIGAgK1xuICAgICAgICAgICAgICAgICAgICBgUmVjb21tZW5kZWQgZmllbGQgdHlwZXM6IHRleHQsIG51bWJlciwgc2VsZWN0LCBiYWRnZSwgcHJvZ3Jlc3MsIGV0Yy5gXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gUmV0dXJuIHdpdGggcHJvcGVyIGZvcm1hdHRpbmdcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgLi4ucHJvcFJlZixcbiAgICAgICAgICAgICAgICBjb2x1bW4sXG4gICAgICAgICAgICAgICAgbGFiZWwsXG4gICAgICAgICAgICAgICAgZmllbGRUeXBlXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRmFsbGJhY2s6IHVua25vd24gdHlwZSwgcmV0dXJuIGFzLWlzIHdpdGggd2FybmluZ1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYFVua25vd24gcHJvcGVydHkgcmVmZXJlbmNlIHR5cGU6YCwgcHJvcFJlZik7XG4gICAgICAgIHJldHVybiBwcm9wUmVmO1xuICAgIH0pO1xufVxuXG4vKipcbiAqIFByb2Nlc3NlcyBzZWN0aW9uc0NvbmZpZyBhbmQgZXhwYW5kcyBhbnkgc2hvcnRoYW5kIHByb3BlcnRpZXNDb25maWcgYXJyYXlzLlxuICogXG4gKiAqKlVuaWZpZWQgd2l0aCBjb2x1bW4gcHJvY2Vzc2luZzoqKlxuICogLSBVc2VzIGBleHBhbmRQcm9wZXJ0eVJlZmVyZW5jZXMoKWAgKHNhbWUgcGF0dGVybiBhcyBgbm9ybWFsaXplQ29sdW1uT3ZlcnJpZGVzKClgKVxuICogLSBTdHJpbmcgc2hvcnRoYW5kIGAnZmllbGROYW1lJ2Ag4oaSIGV4cGFuZHMgZnJvbSBzY2hlbWFcbiAqIC0gT2JqZWN0IHN5bnRheCDihpIgbWVyZ2VzIHdpdGggc2NoZW1hIGRlZmF1bHRzXG4gKiBcbiAqIFJlY3Vyc2l2ZWx5IHdhbGtzIHRocm91Z2ggc2VjdGlvbiBncm91cHMgYW5kIHNlY3Rpb25zLlxuICogXG4gKiBAcGFyYW0gc2VjdGlvbnNDb25maWcgLSBTZWN0aW9ucyBjb25maWd1cmF0aW9uIGZyb20gZW50aXR5IHNjaGVtYVxuICogQHBhcmFtIGFsbFByb3BlcnRpZXMgLSBBbGwgZW50aXR5IGF0dHJpYnV0ZXMgZnJvbSBzY2hlbWEgZm9yIGZpZWxkIGxvb2t1cFxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSBmb3IgYWNjZXNzaW5nIHJlbGF0ZWQgc2NoZW1hc1xuICogQHBhcmFtIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyAtIE9wdGlvbmFsIGdsb2JhbCBVSSBjb25maWd1cmF0aW9uIG9wdGlvbnNcbiAqIEByZXR1cm5zIFByb2Nlc3NlZCBzZWN0aW9ucyBjb25maWcgd2l0aCBleHBhbmRlZCBwcm9wZXJ0aWVzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcm9jZXNzU2VjdGlvbnNDb25maWcoXG4gICAgc2VjdGlvbnNDb25maWc6IGFueSxcbiAgICBhbGxQcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSxcbiAgICBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+LFxuICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sgJ3VpQ29uZmlnR2VuT3B0aW9ucycgXVxuKTogYW55IHtcbiAgICBpZiAoIXNlY3Rpb25zQ29uZmlnKSByZXR1cm4gc2VjdGlvbnNDb25maWc7XG5cbiAgICBjb25zdCBwcm9jZXNzZWQgPSB7IC4uLnNlY3Rpb25zQ29uZmlnIH07XG5cbiAgICAvLyBQcm9jZXNzIHNlY3Rpb25zIGluIHNpbmdsZSBncm91cCBmb3JtYXQgKGJhY2t3YXJkIGNvbXBhdGlibGUpXG4gICAgaWYgKHByb2Nlc3NlZC5zZWN0aW9ucykge1xuICAgICAgICBwcm9jZXNzZWQuc2VjdGlvbnMgPSBPYmplY3QuZW50cmllcyhwcm9jZXNzZWQuc2VjdGlvbnMpLnJlZHVjZSgoYWNjLCBbIGtleSwgc2VjdGlvbiBdOiBbIHN0cmluZywgYW55IF0pID0+IHtcbiAgICAgICAgICAgIGFjY1sga2V5IF0gPSBwcm9jZXNzU2VjdGlvbkNvbmZpZyhzZWN0aW9uLCBhbGxQcm9wZXJ0aWVzLCBlbnRpdHlTZXJ2aWNlLCBnbG9iYWxVSUNvbmZpZ09wdGlvbnMpO1xuICAgICAgICAgICAgcmV0dXJuIGFjYztcbiAgICAgICAgfSwge30gYXMgUmVjb3JkPHN0cmluZywgYW55Pik7XG4gICAgfVxuXG4gICAgLy8gUHJvY2VzcyBzZWN0aW9uIGdyb3VwcyAobmV3IGZvcm1hdClcbiAgICBpZiAocHJvY2Vzc2VkLnNlY3Rpb25Hcm91cHMpIHtcbiAgICAgICAgcHJvY2Vzc2VkLnNlY3Rpb25Hcm91cHMgPSBwcm9jZXNzZWQuc2VjdGlvbkdyb3Vwcy5tYXAoKGdyb3VwOiBhbnkpID0+IHtcbiAgICAgICAgICAgIGlmICghZ3JvdXAuc2VjdGlvbnMpIHJldHVybiBncm91cDtcblxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAuLi5ncm91cCxcbiAgICAgICAgICAgICAgICBzZWN0aW9uczogT2JqZWN0LmVudHJpZXMoZ3JvdXAuc2VjdGlvbnMpLnJlZHVjZSgoYWNjLCBbIGtleSwgc2VjdGlvbiBdOiBbIHN0cmluZywgYW55IF0pID0+IHtcbiAgICAgICAgICAgICAgICAgICAgYWNjWyBrZXkgXSA9IHByb2Nlc3NTZWN0aW9uQ29uZmlnKHNlY3Rpb24sIGFsbFByb3BlcnRpZXMsIGVudGl0eVNlcnZpY2UsIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBhY2M7XG4gICAgICAgICAgICAgICAgfSwge30gYXMgUmVjb3JkPHN0cmluZywgYW55PilcbiAgICAgICAgICAgIH07XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBwcm9jZXNzZWQ7XG59XG5cbi8qKlxuICogUHJvY2Vzc2VzIGEgc2luZ2xlIHNlY3Rpb24gY29uZmlnIGFuZCBleHBhbmRzIHNob3J0aGFuZCBwcm9wZXJ0aWVzQ29uZmlnLlxuICogXG4gKiBVc2VzIHVuaWZpZWQgYGV4cGFuZFByb3BlcnR5UmVmZXJlbmNlcygpYCBmdW5jdGlvbi5cbiAqIFxuICogQHBhcmFtIHNlY3Rpb24gLSBTZWN0aW9uIGNvbmZpZ3VyYXRpb25cbiAqIEBwYXJhbSBhbGxQcm9wZXJ0aWVzIC0gQWxsIGVudGl0eSBhdHRyaWJ1dGVzIGZyb20gc2NoZW1hXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlXG4gKiBAcGFyYW0gZ2xvYmFsVUlDb25maWdPcHRpb25zIC0gT3B0aW9uYWwgZ2xvYmFsIFVJIGNvbmZpZ3VyYXRpb24gb3B0aW9uc1xuICogQHJldHVybnMgUHJvY2Vzc2VkIHNlY3Rpb24gd2l0aCBleHBhbmRlZCBwcm9wZXJ0aWVzXG4gKi9cbmZ1bmN0aW9uIHByb2Nlc3NTZWN0aW9uQ29uZmlnKFxuICAgIHNlY3Rpb246IGFueSxcbiAgICBhbGxQcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSxcbiAgICBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+LFxuICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sgJ3VpQ29uZmlnR2VuT3B0aW9ucycgXVxuKTogYW55IHtcbiAgICBjb25zdCBwcm9jZXNzZWQgPSB7IC4uLnNlY3Rpb24gfTtcblxuICAgIC8vIFByb2Nlc3MgZGV0YWlsc1BhZ2VDb25maWcgd2l0aCBwcm9wZXJ0aWVzQ29uZmlnXG4gICAgaWYgKHByb2Nlc3NlZC5wYWdlVHlwZSA9PT0gJ2RldGFpbHMnICYmIHByb2Nlc3NlZC5kZXRhaWxzUGFnZUNvbmZpZz8ucHJvcGVydGllc0NvbmZpZykge1xuICAgICAgICBjb25zdCBjb25maWcgPSBwcm9jZXNzZWQuZGV0YWlsc1BhZ2VDb25maWc7XG4gICAgICAgIHByb2Nlc3NlZC5kZXRhaWxzUGFnZUNvbmZpZyA9IHtcbiAgICAgICAgICAgIC4uLmNvbmZpZyxcbiAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IGV4cGFuZFByb3BlcnR5UmVmZXJlbmNlcyhcbiAgICAgICAgICAgICAgICBjb25maWcucHJvcGVydGllc0NvbmZpZyxcbiAgICAgICAgICAgICAgICBhbGxQcm9wZXJ0aWVzLFxuICAgICAgICAgICAgICAgICdkZXRhaWwnLFxuICAgICAgICAgICAgICAgIGVudGl0eVNlcnZpY2UsXG4gICAgICAgICAgICAgICAgZ2xvYmFsVUlDb25maWdPcHRpb25zXG4gICAgICAgICAgICApXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gUHJvY2VzcyBmb3JtUGFnZUNvbmZpZ1xuICAgIGlmIChwcm9jZXNzZWQucGFnZVR5cGUgPT09ICdmb3JtJyAmJiBwcm9jZXNzZWQuZm9ybVBhZ2VDb25maWc/LnByb3BlcnRpZXNDb25maWcpIHtcbiAgICAgICAgY29uc3QgY29uZmlnID0gcHJvY2Vzc2VkLmZvcm1QYWdlQ29uZmlnO1xuICAgICAgICAvLyBGb3JtcyBpbiBzZWN0aW9ucyBhcmUgdHlwaWNhbGx5ICdjcmVhdGUnIGZvcm1zXG4gICAgICAgIHByb2Nlc3NlZC5mb3JtUGFnZUNvbmZpZyA9IHtcbiAgICAgICAgICAgIC4uLmNvbmZpZyxcbiAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IGV4cGFuZFByb3BlcnR5UmVmZXJlbmNlcyhcbiAgICAgICAgICAgICAgICBjb25maWcucHJvcGVydGllc0NvbmZpZyxcbiAgICAgICAgICAgICAgICBhbGxQcm9wZXJ0aWVzLFxuICAgICAgICAgICAgICAgICdjcmVhdGUnLFxuICAgICAgICAgICAgICAgIGVudGl0eVNlcnZpY2UsXG4gICAgICAgICAgICAgICAgZ2xvYmFsVUlDb25maWdPcHRpb25zXG4gICAgICAgICAgICApXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcmV0dXJuIHByb2Nlc3NlZDtcbn1cblxuLyoqXG4gKiBGb3JtYXRzIGVudGl0eSBhdHRyaWJ1dGVzIGZvciBjcmVhdGUgZm9ybSBwYWdlcy5cbiAqIFxuICogRmlsdGVycyBhdHRyaWJ1dGVzIHRvIGluY2x1ZGUgb25seSBjcmVhdGFibGUgZmllbGRzIChyZXNwZWN0cyBpc0NyZWF0YWJsZSBmbGFnKVxuICogYW5kIGZvcm1hdHMgZWFjaCBmb3IgY3JlYXRlIGZvcm0gZGlzcGxheS5cbiAqIFxuICogQHBhcmFtIHByb3BlcnRpZXMgLSBBcnJheSBvZiBlbnRpdHkgYXR0cmlidXRlcyBmcm9tIHNjaGVtYVxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSBmb3IgYWNjZXNzaW5nIHJlbGF0ZWQgc2NoZW1hc1xuICogQHBhcmFtIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyAtIE9wdGlvbmFsIGdsb2JhbCBVSSBjb25maWd1cmF0aW9uIG9wdGlvbnNcbiAqIEByZXR1cm5zIEFycmF5IG9mIGZvcm1hdHRlZCBmaWVsZCBtZXRhZGF0YSBmb3IgY3JlYXRlIGZvcm1zXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yQ3JlYXRlKHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLCBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+LCBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbICd1aUNvbmZpZ0dlbk9wdGlvbnMnIF0pIHtcbiAgICByZXR1cm4gcHJvcGVydGllc1xuICAgICAgICAuZmlsdGVyKHByb3AgPT4gcHJvcCAmJiAoIXByb3AuaGFzT3duUHJvcGVydHkoJ2lzQ3JlYXRhYmxlJykgfHwgcHJvcC5pc0NyZWF0YWJsZSkpXG4gICAgICAgIC5tYXAoKGF0dCkgPT4gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKGF0dCwgJ2NyZWF0ZScsIGVudGl0eVNlcnZpY2UsIHByb3BlcnRpZXMsIGdsb2JhbFVJQ29uZmlnT3B0aW9ucykpO1xufVxuXG4vKipcbiAqIEZvcm1hdHMgZW50aXR5IGF0dHJpYnV0ZXMgZm9yIHVwZGF0ZS9lZGl0IGZvcm0gcGFnZXMuXG4gKiBcbiAqIEZpbHRlcnMgYXR0cmlidXRlcyB0byBpbmNsdWRlIG9ubHkgZWRpdGFibGUgZmllbGRzIChyZXNwZWN0cyBpc0VkaXRhYmxlIGZsYWcpXG4gKiBhbmQgZm9ybWF0cyBlYWNoIGZvciB1cGRhdGUgZm9ybSBkaXNwbGF5LlxuICogXG4gKiBAcGFyYW0gcHJvcGVydGllcyAtIEFycmF5IG9mIGVudGl0eSBhdHRyaWJ1dGVzIGZyb20gc2NoZW1hXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIGZvciBhY2Nlc3NpbmcgcmVsYXRlZCBzY2hlbWFzXG4gKiBAcGFyYW0gZ2xvYmFsVUlDb25maWdPcHRpb25zIC0gT3B0aW9uYWwgZ2xvYmFsIFVJIGNvbmZpZ3VyYXRpb24gb3B0aW9uc1xuICogQHJldHVybnMgQXJyYXkgb2YgZm9ybWF0dGVkIGZpZWxkIG1ldGFkYXRhIGZvciB1cGRhdGUgZm9ybXNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JVcGRhdGUocHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sgJ3VpQ29uZmlnR2VuT3B0aW9ucycgXSkge1xuICAgIHJldHVybiBwcm9wZXJ0aWVzXG4gICAgICAgIC5maWx0ZXIocHJvcCA9PiBwcm9wICYmICghcHJvcC5oYXNPd25Qcm9wZXJ0eSgnaXNFZGl0YWJsZScpIHx8IHByb3AuaXNFZGl0YWJsZSkpXG4gICAgICAgIC5tYXAoKGF0dCkgPT4gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKGF0dCwgJ3VwZGF0ZScsIGVudGl0eVNlcnZpY2UsIHByb3BlcnRpZXMsIGdsb2JhbFVJQ29uZmlnT3B0aW9ucykpO1xufVxuXG4vKipcbiAqIEZvcm1hdHMgZW50aXR5IGF0dHJpYnV0ZXMgZm9yIGRldGFpbC92aWV3IHBhZ2VzLlxuICogXG4gKiBGaWx0ZXJzIGF0dHJpYnV0ZXMgdG8gaW5jbHVkZSBvbmx5IHZpc2libGUgZmllbGRzIChyZXNwZWN0cyBpc1Zpc2libGUgZmxhZylcbiAqIGFuZCBmb3JtYXRzIGVhY2ggZm9yIGRldGFpbCBwYWdlIGRpc3BsYXkuXG4gKiBcbiAqIEBwYXJhbSBwcm9wZXJ0aWVzIC0gQXJyYXkgb2YgZW50aXR5IGF0dHJpYnV0ZXMgZnJvbSBzY2hlbWFcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gRW50aXR5IHNlcnZpY2UgZm9yIGFjY2Vzc2luZyByZWxhdGVkIHNjaGVtYXNcbiAqIEBwYXJhbSBnbG9iYWxVSUNvbmZpZ09wdGlvbnMgLSBPcHRpb25hbCBnbG9iYWwgVUkgY29uZmlndXJhdGlvbiBvcHRpb25zXG4gKiBAcmV0dXJucyBBcnJheSBvZiBmb3JtYXR0ZWQgZmllbGQgbWV0YWRhdGEgZm9yIGRldGFpbCB2aWV3c1xuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckRldGFpbChwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSwgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PiwgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyAndWlDb25maWdHZW5PcHRpb25zJyBdKSB7XG4gICAgcmV0dXJuIHByb3BlcnRpZXNcbiAgICAgICAgLmZpbHRlcihwcm9wID0+IHByb3AgJiYgKCFwcm9wLmhhc093blByb3BlcnR5KCdpc1Zpc2libGUnKSB8fCBwcm9wLmlzVmlzaWJsZSkpXG4gICAgICAgIC5tYXAoKGF0dCkgPT4gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKGF0dCwgJ2RldGFpbCcsIGVudGl0eVNlcnZpY2UsIHByb3BlcnRpZXMsIGdsb2JhbFVJQ29uZmlnT3B0aW9ucykpO1xufVxuXG4vKipcbiAqIFR5cGUgZGVmaW5pdGlvbiBmb3IgbGlzdC90YWJsZSBjb2x1bW4gY29uZmlndXJhdGlvbi5cbiAqIFxuICogRXh0ZW5kcyBGaWVsZE1ldGFkYXRhIHdpdGggbGlzdC1zcGVjaWZpYyBwcm9wZXJ0aWVzIGxpa2UgYWN0aW9ucywgdGVtcGxhdGVzLFxuICogYW5kIHJlbGF0aW9uIHJlbmRlcmluZyBjb25maWd1cmF0aW9ucy5cbiAqL1xuZXhwb3J0IHR5cGUgTGlzdGluZ1Byb3BDb25maWcgPSBQaWNrPEZpZWxkTWV0YWRhdGEsICdmaWVsZFR5cGUnIHwgJ3BsYWNlaG9sZGVyJyB8ICdoZWxwVGV4dCcgfCAnZmlsdGVyQ29uZmlnJz4gJiB7XG4gICAgbmFtZTogc3RyaW5nLFxuICAgIGRhdGFJbmRleDogc3RyaW5nLFxuICAgIGhpZGRlbj86IGJvb2xlYW4sXG4gICAgYWN0aW9ucz86IEFycmF5PElFbnRpdHlQYWdlQWN0aW9uPixcbiAgICByZWxhdGlvbkNvbmZpZz86IElSZWxhdGlvbkZpZWxkQ29uZmlnLCAgLy8gRm9yIHJlbmRlcmluZyByZWxhdGlvbnMgd2l0aCBsaW5rcy9tb2RhbHNcbiAgICB0ZW1wbGF0ZT86IFRlbXBsYXRlLCAgLy8gRm9yIHRlbXBsYXRlLWJhc2VkIHJlbmRlcmluZ1xuICAgIGlzSWRlbnRpZmllcj86IGJvb2xlYW4sICAvLyBGb3IgaWRlbnRpZmllciBmaWVsZHNcbiAgICAvKiogQGRlcHJlY2F0ZWQgT3B0aW9uYWwgLSBwcmVzZW5jZSBvZiBsaW5rQ29uZmlnIGlzIHN1ZmZpY2llbnQgKi9cbiAgICBpc0xpbms/OiBib29sZWFuLCAgLy8gRm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICBsaW5rQ29uZmlnPzogeyByb3V0ZVBhdHRlcm46IHN0cmluZzsgZGlzcGxheVRleHQ/OiBUZW1wbGF0ZSB9LCAgLy8gRm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHkgLSBzdXBwb3J0cyB0ZW1wbGF0ZXNcbn07XG5cbi8qKlxuICogRm9ybWF0cyBlbnRpdHkgYXR0cmlidXRlcyBmb3IgbGlzdC90YWJsZSBkaXNwbGF5LlxuICogXG4gKiBUcmFuc2Zvcm1zIHNjaGVtYSBhdHRyaWJ1dGVzIGludG8gdGFibGUgY29sdW1uIGNvbmZpZ3VyYXRpb25zIHdpdGg6XG4gKiAtIEF1dG8tZ2VuZXJhdGVkIGZpbHRlciBjb25maWd1cmF0aW9ucyBmb3IgZmlsdGVyYWJsZSBjb2x1bW5zXG4gKiAtIFJlbGF0aW9uIGRpc3BsYXkgY29uZmlndXJhdGlvbnMgd2l0aCBsaW5rcyBhbmQgbW9kYWwgc3VwcG9ydFxuICogLSBUZW1wbGF0ZS1iYXNlZCByZW5kZXJpbmcgZm9yIGR1cGxpY2F0ZWQgcmVsYXRpb24gZmllbGRzXG4gKiAtIFByb3BlciBmaWVsZCB0eXBlcyBhbmQgdmlzaWJpbGl0eSBoYW5kbGluZ1xuICogXG4gKiBUaGlzIGlzIHRoZSBtYWluIGVudHJ5IHBvaW50IGZvciBnZW5lcmF0aW5nIHRhYmxlIGNvbHVtbiBjb25maWd1cmF0aW9ucyBmcm9tIGVudGl0eSBzY2hlbWFzLlxuICogXG4gKiBAcGFyYW0gZW50aXR5TmFtZSAtIE5hbWUgb2YgdGhlIGVudGl0eSAoZm9yIGdlbmVyYXRpbmcgcm91dGUgcGF0dGVybnMpXG4gKiBAcGFyYW0gcHJvcGVydGllcyAtIEFycmF5IG9mIGVudGl0eSBhdHRyaWJ1dGVzIGZyb20gc2NoZW1hXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIGZvciBhY2Nlc3NpbmcgcmVsYXRlZCBzY2hlbWFzXG4gKiBAcGFyYW0gZ2xvYmFsVUlDb25maWdPcHRpb25zIC0gT3B0aW9uYWwgZ2xvYmFsIFVJIGNvbmZpZ3VyYXRpb24gb3B0aW9uc1xuICogQHJldHVybnMgQXJyYXkgb2YgZm9ybWF0dGVkIGNvbHVtbiBjb25maWd1cmF0aW9ucyBmb3IgdGFibGUgZGlzcGxheVxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY29uc3QgY29sdW1ucyA9IGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JMaXN0KFxuICogICAnZ2FtZScsXG4gKiAgIGdhbWVTY2hlbWEuYXR0cmlidXRlcyxcbiAqICAgZ2FtZVNlcnZpY2UsXG4gKiAgIGdsb2JhbENvbmZpZ1xuICogKTtcbiAqIC8vIFJldHVybnMgYXJyYXkgb2YgY29sdW1uIGNvbmZpZ3Mgd2l0aCBmaWx0ZXJzLCByZWxhdGlvbnMsIGFuZCB0ZW1wbGF0ZXNcbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlc0Zvckxpc3QoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLFxuICAgIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sXG4gICAge1xuICAgICAgICBDUlVEQXBpUGF0aCxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pblVwZGF0ZSxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pbkRlbGV0ZSxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pbkRldGFpbCxcbiAgICAgICAgY3VzdG9tUm93QWN0aW9ucyxcbiAgICAgICAgZ2xvYmFsVUlDb25maWdPcHRpb25zXG4gICAgfToge1xuICAgICAgICBDUlVEQXBpUGF0aD86IHN0cmluZyxcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pblVwZGF0ZT86IGJvb2xlYW4sXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZWxldGU/OiBib29sZWFuLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluRGV0YWlsPzogYm9vbGVhbixcbiAgICAgICAgY3VzdG9tUm93QWN0aW9ucz86IFJlYWRvbmx5QXJyYXk8SUVudGl0eVBhZ2VBY3Rpb24+IHwgQXJyYXk8SUVudGl0eVBhZ2VBY3Rpb24+LFxuICAgICAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbICd1aUNvbmZpZ0dlbk9wdGlvbnMnIF0gIC8vIE5FVzogR2xvYmFsIGNvbmZpZyBvcHRpb25zXG4gICAgfVxuKSB7XG5cbiAgICBjb25zdCBlbnRpdHlOYW1lTG93ZXIgPSBlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgZW50aXR5TmFtZVBhc2NhbENhc2UgPSBwYXNjYWxDYXNlKGVudGl0eU5hbWUpO1xuXG4gICAgcmV0dXJuIHByb3BlcnRpZXNcbiAgICAgICAgLmZpbHRlcihwcm9wID0+IHByb3AgJiYgcHJvcC5pc0xpc3RhYmxlKVxuICAgICAgICAubWFwKHByb3AgPT4ge1xuICAgICAgICAgICAgLy8gVXNlIHNhbWUgZm9ybWF0dGluZyBsb2dpYyBhcyBkZXRhaWxzL2Zvcm1zIChpbmNsdWRlcyByZWxhdGlvbkNvbmZpZyBnZW5lcmF0aW9uKVxuICAgICAgICAgICAgLy8gUGFzcyBhbGwgcHJvcGVydGllcyBzbyBpdCBjYW4gZGV0ZWN0IGR1cGxpY2F0ZWQgcmVsYXRpb24gZmllbGRzIChlLmcuLCB0ZWFtTmFtZSBmb3IgdGVhbUlkKVxuICAgICAgICAgICAgY29uc3QgZm9ybWF0dGVkID0gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKHByb3AsICdkZXRhaWwnLCBlbnRpdHlTZXJ2aWNlLCBwcm9wZXJ0aWVzLCBnbG9iYWxVSUNvbmZpZ09wdGlvbnMpO1xuXG4gICAgICAgICAgICAvLyBBdXRvLWdlbmVyYXRlIGZpbHRlckNvbmZpZyBpZiBub3QgYWxyZWFkeSBwcmVzZW50IGFuZCBmaWVsZCBpcyBmaWx0ZXJhYmxlXG4gICAgICAgICAgICBjb25zdCBhdXRvR2VuZXJhdGVkRmlsdGVyQ29uZmlnID0gIWZvcm1hdHRlZC5maWx0ZXJDb25maWcgJiYgcHJvcC5pc0ZpbHRlcmFibGUgIT09IGZhbHNlXG4gICAgICAgICAgICAgICAgPyBnZW5lcmF0ZUZpbHRlckNvbmZpZyhwcm9wLCBlbnRpdHlTZXJ2aWNlLCBnbG9iYWxVSUNvbmZpZ09wdGlvbnMpXG4gICAgICAgICAgICAgICAgOiB1bmRlZmluZWQ7XG5cbiAgICAgICAgICAgIC8vIE92ZXJyaWRlL2FkZCBsaXN0LXNwZWNpZmljIHByb3BlcnRpZXNcbiAgICAgICAgICAgIGNvbnN0IHByb3BDb25maWc6IExpc3RpbmdQcm9wQ29uZmlnID0ge1xuICAgICAgICAgICAgICAgIC4uLmZvcm1hdHRlZCxcbiAgICAgICAgICAgICAgICBuYW1lOiBmb3JtYXR0ZWQubGFiZWwgfHwgZm9ybWF0dGVkLm5hbWUsICAvLyBFbnN1cmUgbmFtZSBpcyBzZXQgZm9yIHRhYmxlIGNvbHVtbiBoZWFkZXJcbiAgICAgICAgICAgICAgICBkYXRhSW5kZXg6IGAke3Byb3AuaWR9YCxcbiAgICAgICAgICAgICAgICBmaWVsZFR5cGU6IGZvcm1hdHRlZC5maWVsZFR5cGUgfHwgJ3RleHQnLFxuICAgICAgICAgICAgICAgIGZpbHRlckNvbmZpZzogZm9ybWF0dGVkLmZpbHRlckNvbmZpZyB8fCBhdXRvR2VuZXJhdGVkRmlsdGVyQ29uZmlnLCAgLy8gVXNlIGV4cGxpY2l0IG9yIGF1dG8tZ2VuZXJhdGVkXG4gICAgICAgICAgICAgICAgaGlkZGVuOiBwcm9wLmhhc093blByb3BlcnR5KCdpc1Zpc2libGUnKSAmJiAhcHJvcC5pc1Zpc2libGVcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGlmIChwcm9wLmlzSWRlbnRpZmllcikge1xuICAgICAgICAgICAgICAgIC8vIEJ1aWxkIGRlZmF1bHQgcm93IGFjdGlvbnMgd2l0aCBJRHNcbiAgICAgICAgICAgICAgICBjb25zdCBkZWZhdWx0QWN0aW9uczogQXJyYXk8SUVudGl0eVBhZ2VBY3Rpb24+ID0gW107XG5cbiAgICAgICAgICAgICAgICBpZiAoIWV4Y2x1ZGVGcm9tQWRtaW5EZXRhaWwpIHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEFjdGlvbnMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZDogJ3ZpZXcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbjogJ3ZpZXcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdWaWV3JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRlbXBsYXRlOiBgVmlldyB7JHtwcm9wLmlkfX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiBgL3ZpZXctJHtlbnRpdHlOYW1lTG93ZXJ9YFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoIWV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGUpIHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEFjdGlvbnMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZDogJ2VkaXQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbjogJ2VkaXQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdFZGl0JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRlbXBsYXRlOiBgRWRpdCB7JHtwcm9wLmlkfX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiBgL2VkaXQtJHtlbnRpdHlOYW1lTG93ZXJ9YFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoIWV4Y2x1ZGVGcm9tQWRtaW5EZWxldGUpIHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEFjdGlvbnMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZDogJ2RlbGV0ZScsXG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uOiAnZGVsZXRlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnRGVsZXRlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRlbXBsYXRlOiBgRGVsZXRlIHske3Byb3AuaWR9fWAsXG4gICAgICAgICAgICAgICAgICAgICAgICBvcGVuSW5Nb2RhbDogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1vZGFsQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kYWxUeXBlOiAnY29uZmlybScsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kYWxQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpdGxlOiBgRGVsZXRlICR7ZW50aXR5TmFtZVBhc2NhbENhc2V9P2AsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6IGBBcmUgeW91IHN1cmUgeW91IHdhbnQgdG8gZGVsZXRlIHRoaXMgJHtlbnRpdHlOYW1lUGFzY2FsQ2FzZX0/IFRoaXMgYWN0aW9uIGNhbm5vdCBiZSB1bmRvbmUuYFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXBpQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFwaU1ldGhvZDogYERFTEVURWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc3BvbnNlS2V5OiBlbnRpdHlOYW1lTG93ZXIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFwaVVybDogYCR7Q1JVREFwaVBhdGggPyBDUlVEQXBpUGF0aCA6ICcnfS8ke2VudGl0eU5hbWVMb3dlcn1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VjY2Vzc01lc3NhZ2U6IGAke2VudGl0eU5hbWVQYXNjYWxDYXNlfSBkZWxldGVkIHN1Y2Nlc3NmdWxseWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3JNZXNzYWdlOiBgRmFpbGVkIHRvIGRlbGV0ZSAke2VudGl0eU5hbWVQYXNjYWxDYXNlfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VibWl0U3VjY2Vzc1JlZGlyZWN0OiBgL2xpc3QtJHtlbnRpdHlOYW1lTG93ZXJ9YFxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAvLyBNZXJnZSBjdXN0b20gcm93IGFjdGlvbnMgdXNpbmcgaWRlbnRpZmllci1iYXNlZCBvdmVycmlkZVxuICAgICAgICAgICAgICAgIHByb3BDb25maWcuYWN0aW9ucyA9IGN1c3RvbVJvd0FjdGlvbnNcbiAgICAgICAgICAgICAgICAgICAgPyBtZXJnZUFjdGlvbnMoZGVmYXVsdEFjdGlvbnMsIGN1c3RvbVJvd0FjdGlvbnMpXG4gICAgICAgICAgICAgICAgICAgIDogZGVmYXVsdEFjdGlvbnM7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBwcm9wQ29uZmlnO1xuICAgICAgICB9KTtcbn1cblxuLyoqXG4gKiBNRVJHRSBVVElMSVRZIEZVTkNUSU9OU1xuICogXG4gKiBUaGVzZSBmdW5jdGlvbnMgaW1wbGVtZW50IHRoZSBpZGVudGlmaWVyLWJhc2VkIG92ZXJyaWRlIHBhdHRlcm46XG4gKiAtIERlZmF1bHRzIGhhdmUgc3RhbmRhcmQgaWRlbnRpZmllcnMgKGUuZy4sICd2aWV3JywgJ2VkaXQnLCAnZGVsZXRlJylcbiAqIC0gQ3VzdG9tIGNvbmZpZ3Mgd2l0aCBzYW1lIGlkZW50aWZpZXIgb3ZlcnJpZGUgdGhlIGRlZmF1bHRcbiAqIC0gTmV3IGlkZW50aWZpZXJzIGdldCBhZGRlZCB0byB0aGUgcmVzdWx0XG4gKi9cblxuLyoqXG4gKiBNZXJnZSBkZWZhdWx0IGJ1dHRvbnMgd2l0aCBjdXN0b20gYnV0dG9ucyB1c2luZyBpZGVudGlmaWVyLWJhc2VkIG92ZXJyaWRlLlxuICogXG4gKiBAcGFyYW0gZGVmYXVsdHMgLSBEZWZhdWx0IGJ1dHRvbnMgKGZyb20gZ2VuZXJhdG9yKVxuICogQHBhcmFtIGN1c3RvbXMgLSBDdXN0b20gYnV0dG9ucyAoZnJvbSBlbnRpdHkgc2NoZW1hKVxuICogQHJldHVybnMgTWVyZ2VkIGJ1dHRvbiBhcnJheVxuICovXG4vKipcbiAqIE1lcmdlcyBkZWZhdWx0IGJ1dHRvbnMgd2l0aCBjdXN0b20gYnV0dG9ucyB1c2luZyBJRC1iYXNlZCBvdmVycmlkZSBsb2dpYy5cbiAqIFxuICogQ3VzdG9tIGJ1dHRvbnMgd2l0aCBtYXRjaGluZyBJRHMgb3ZlcnJpZGUgZGVmYXVsdHMsIGFuZCBuZXcgY3VzdG9tIGJ1dHRvbnMgYXJlIGFwcGVuZGVkLlxuICogQnV0dG9ucyB3aXRob3V0IElEcyBhcmUgYWx3YXlzIGluY2x1ZGVkIChubyBkZWR1cGxpY2F0aW9uKS5cbiAqIFxuICogQHRlbXBsYXRlIFQgLSBCdXR0b24gdHlwZSB3aXRoIG9wdGlvbmFsIGlkIHByb3BlcnR5XG4gKiBAcGFyYW0gZGVmYXVsdHMgLSBEZWZhdWx0IGJ1dHRvbiBjb25maWd1cmF0aW9uc1xuICogQHBhcmFtIGN1c3RvbXMgLSBDdXN0b20gYnV0dG9uIGNvbmZpZ3VyYXRpb25zIHRvIG1lcmdlXG4gKiBAcmV0dXJucyBNZXJnZWQgYXJyYXkgd2l0aCBjdXN0b20gb3ZlcnJpZGVzIGFwcGxpZWRcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IGRlZmF1bHRzID0gW1xuICogICB7IGlkOiAnc2F2ZScsIGxhYmVsOiAnU2F2ZScsIGFjdGlvbjogJ3N1Ym1pdCcgfSxcbiAqICAgeyBpZDogJ2NhbmNlbCcsIGxhYmVsOiAnQ2FuY2VsJywgYWN0aW9uOiAnY2FuY2VsJyB9XG4gKiBdO1xuICogY29uc3QgY3VzdG9tcyA9IFtcbiAqICAgeyBpZDogJ3NhdmUnLCBsYWJlbDogJ1NhdmUgQ2hhbmdlcycsIGFjdGlvbjogJ3N1Ym1pdCcgfSwgLy8gT3ZlcnJpZGVcbiAqICAgeyBpZDogJ2RlbGV0ZScsIGxhYmVsOiAnRGVsZXRlJywgYWN0aW9uOiAnZGVsZXRlJyB9ICAgICAgLy8gTmV3XG4gKiBdO1xuICogY29uc3QgbWVyZ2VkID0gbWVyZ2VCdXR0b25zKGRlZmF1bHRzLCBjdXN0b21zKTtcbiAqIC8vIFJldHVybnM6IFtcbiAqIC8vICAgeyBpZDogJ3NhdmUnLCBsYWJlbDogJ1NhdmUgQ2hhbmdlcycsIGFjdGlvbjogJ3N1Ym1pdCcgfSxcbiAqIC8vICAgeyBpZDogJ2NhbmNlbCcsIGxhYmVsOiAnQ2FuY2VsJywgYWN0aW9uOiAnY2FuY2VsJyB9LFxuICogLy8gICB7IGlkOiAnZGVsZXRlJywgbGFiZWw6ICdEZWxldGUnLCBhY3Rpb246ICdkZWxldGUnIH1cbiAqIC8vIF1cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VCdXR0b25zPFQgZXh0ZW5kcyB7IGlkPzogc3RyaW5nIH0+KFxuICAgIGRlZmF1bHRzOiBBcnJheTxUPixcbiAgICBjdXN0b21zOiBSZWFkb25seUFycmF5PFQ+IHwgQXJyYXk8VD4gPSBbXVxuKTogQXJyYXk8VD4ge1xuICAgIGNvbnN0IGN1c3RvbXNBcnJheSA9IFsgLi4uY3VzdG9tcyBdOyAgLy8gQ29udmVydCB0byBtdXRhYmxlIGFycmF5XG4gICAgY29uc3QgY3VzdG9tTWFwID0gbmV3IE1hcChcbiAgICAgICAgY3VzdG9tc0FycmF5LmZpbHRlcihjID0+IGMuaWQpLm1hcChjID0+IFsgYy5pZCwgYyBdKVxuICAgICk7XG5cbiAgICAvLyBTdGFydCB3aXRoIGRlZmF1bHRzLCByZXBsYWNlIGlmIGN1c3RvbSBoYXMgc2FtZSBpZFxuICAgIGNvbnN0IG1lcmdlZCA9IGRlZmF1bHRzLm1hcChkZWZhdWx0QnRuID0+XG4gICAgICAgIGRlZmF1bHRCdG4uaWQgJiYgY3VzdG9tTWFwLmhhcyhkZWZhdWx0QnRuLmlkKVxuICAgICAgICAgICAgPyBjdXN0b21NYXAuZ2V0KGRlZmF1bHRCdG4uaWQpISAgLy8gT3ZlcnJpZGVcbiAgICAgICAgICAgIDogZGVmYXVsdEJ0blxuICAgICk7XG5cbiAgICAvLyBBZGQgY3VzdG9tIGJ1dHRvbnMgdGhhdCBkb24ndCBvdmVycmlkZSBkZWZhdWx0c1xuICAgIGN1c3RvbXNBcnJheS5mb3JFYWNoKGN1c3RvbUJ0biA9PiB7XG4gICAgICAgIGlmICghY3VzdG9tQnRuLmlkIHx8ICFkZWZhdWx0cy5zb21lKGQgPT4gZC5pZCA9PT0gY3VzdG9tQnRuLmlkKSkge1xuICAgICAgICAgICAgbWVyZ2VkLnB1c2goY3VzdG9tQnRuKTsgIC8vIEFkZCBuZXdcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIG1lcmdlZDtcbn1cblxuLyoqXG4gKiBNZXJnZXMgZGVmYXVsdCBhY3Rpb25zIHdpdGggY3VzdG9tIGFjdGlvbnMgdXNpbmcgSUQtYmFzZWQgb3ZlcnJpZGUgbG9naWMuXG4gKiBcbiAqIERlbGVnYXRlcyB0byBtZXJnZUJ1dHRvbnMgd2l0aCB0aGUgc2FtZSBiZWhhdmlvcjogY3VzdG9tIGFjdGlvbnMgd2l0aCBtYXRjaGluZyBJRHNcbiAqIG92ZXJyaWRlIGRlZmF1bHRzLCBhbmQgbmV3IGN1c3RvbSBhY3Rpb25zIGFyZSBhcHBlbmRlZC4gU2VtYW50aWNhbGx5IG5hbWVkIGZvciByb3cvdGFibGUgYWN0aW9ucy5cbiAqIFxuICogQHRlbXBsYXRlIFQgLSBBY3Rpb24gdHlwZSB3aXRoIG9wdGlvbmFsIGlkIHByb3BlcnR5XG4gKiBAcGFyYW0gZGVmYXVsdHMgLSBEZWZhdWx0IGFjdGlvbiBjb25maWd1cmF0aW9uc1xuICogQHBhcmFtIGN1c3RvbXMgLSBDdXN0b20gYWN0aW9uIGNvbmZpZ3VyYXRpb25zIHRvIG1lcmdlXG4gKiBAcmV0dXJucyBNZXJnZWQgYXJyYXkgd2l0aCBjdXN0b20gb3ZlcnJpZGVzIGFwcGxpZWRcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IGRlZmF1bHRzID0gW1xuICogICB7IGlkOiAnZWRpdCcsIGxhYmVsOiAnRWRpdCcsIGFjdGlvbjogJ2VkaXQnIH0sXG4gKiAgIHsgaWQ6ICdkZWxldGUnLCBsYWJlbDogJ0RlbGV0ZScsIGFjdGlvbjogJ2RlbGV0ZScgfVxuICogXTtcbiAqIGNvbnN0IGN1c3RvbXMgPSBbXG4gKiAgIHsgaWQ6ICdkZWxldGUnLCBsYWJlbDogJ1JlbW92ZScsIGFjdGlvbjogJ2RlbGV0ZScsIGNvbmZpcm06IHRydWUgfSAvLyBPdmVycmlkZVxuICogXTtcbiAqIGNvbnN0IG1lcmdlZCA9IG1lcmdlQWN0aW9ucyhkZWZhdWx0cywgY3VzdG9tcyk7XG4gKiAvLyBSZXR1cm5zOiBbXG4gKiAvLyAgIHsgaWQ6ICdlZGl0JywgbGFiZWw6ICdFZGl0JywgYWN0aW9uOiAnZWRpdCcgfSxcbiAqIC8vICAgeyBpZDogJ2RlbGV0ZScsIGxhYmVsOiAnUmVtb3ZlJywgYWN0aW9uOiAnZGVsZXRlJywgY29uZmlybTogdHJ1ZSB9XG4gKiAvLyBdXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlQWN0aW9uczxUIGV4dGVuZHMgeyBpZD86IHN0cmluZyB9PihcbiAgICBkZWZhdWx0czogQXJyYXk8VD4sXG4gICAgY3VzdG9tczogUmVhZG9ubHlBcnJheTxUPiB8IEFycmF5PFQ+ID0gW11cbik6IEFycmF5PFQ+IHtcbiAgICByZXR1cm4gbWVyZ2VCdXR0b25zKGRlZmF1bHRzLCBbIC4uLmN1c3RvbXMgXSk7ICAvLyBTcHJlYWQgdG8gaGFuZGxlIGJvdGggcmVhZG9ubHkgYW5kIG11dGFibGVcbn1cblxuLyoqXG4gKiBHcm91cHMgcGFnZSBoZWFkZXIgYWN0aW9ucyBpbnRvIHByaW1hcnkgKHRvcC1sZXZlbCBidXR0b25zKSBhbmQgc2Vjb25kYXJ5IChpbnNpZGUgYSBcIk1vcmVcIiBkcm9wZG93bikuXG4gKiBXaGVuIGF1dG9Hcm91cCBpcyBmYWxzZSwgcmV0dXJucyBhbGwgYWN0aW9ucyBhcyBhIGZsYXQgYXJyYXkgKG5vIGdyb3VwaW5nKS5cbiAqIFxuICogR3VhcmFudGVlcyBhdCBsZWFzdCBvbmUgdmlzaWJsZSB0b3AtbGV2ZWwgYWN0aW9uOiBpZiBwcmltYXJ5QWN0aW9ucyBpcyBlbXB0eSxcbiAqIHRoZSBmaXJzdCBzZWNvbmRhcnkgYWN0aW9uIGlzIHByb21vdGVkIHRvIHRvcC1sZXZlbCBpbnN0ZWFkIG9mIGJlaW5nIGJ1cmllZCBpbiBcIk1vcmVcIi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdyb3VwUGFnZUhlYWRlckFjdGlvbnMoXG4gICAgcHJpbWFyeUFjdGlvbnM6IEFycmF5PElFbnRpdHlQYWdlQWN0aW9uPixcbiAgICBzZWNvbmRhcnlBY3Rpb25zOiBBcnJheTxJRW50aXR5UGFnZUFjdGlvbj4sXG4gICAgYXV0b0dyb3VwOiBib29sZWFuXG4pOiBBcnJheTxJRW50aXR5UGFnZUFjdGlvbj4ge1xuICAgIGlmICghYXV0b0dyb3VwIHx8IHNlY29uZGFyeUFjdGlvbnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHJldHVybiBbIC4uLnByaW1hcnlBY3Rpb25zLCAuLi5zZWNvbmRhcnlBY3Rpb25zIF07XG4gICAgfVxuXG4gICAgY29uc3QgdG9wTGV2ZWwgPSBbIC4uLnByaW1hcnlBY3Rpb25zIF07XG4gICAgbGV0IHJlbWFpbmluZyA9IHNlY29uZGFyeUFjdGlvbnM7XG5cbiAgICAvLyBQcm9tb3RlIGZpcnN0IHNlY29uZGFyeSBhY3Rpb24gaWYgbm90aGluZyBpcyB2aXNpYmxlIGF0IHRvcCBsZXZlbFxuICAgIGlmICh0b3BMZXZlbC5sZW5ndGggPT09IDAgJiYgcmVtYWluaW5nLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdG9wTGV2ZWwucHVzaChyZW1haW5pbmdbMF0pO1xuICAgICAgICByZW1haW5pbmcgPSByZW1haW5pbmcuc2xpY2UoMSk7XG4gICAgfVxuXG4gICAgaWYgKHJlbWFpbmluZy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIHRvcExldmVsO1xuICAgIH1cblxuICAgIGNvbnN0IG1vcmVEcm9wZG93bjogSUVudGl0eVBhZ2VBY3Rpb24gPSB7XG4gICAgICAgIGlkOiAnbW9yZS1hY3Rpb25zJyxcbiAgICAgICAgbGFiZWw6ICdNb3JlJyxcbiAgICAgICAgdHlwZTogJ2Ryb3Bkb3duJyxcbiAgICAgICAgaXRlbXM6IHJlbWFpbmluZyxcbiAgICB9O1xuXG4gICAgcmV0dXJuIFsgLi4udG9wTGV2ZWwsIG1vcmVEcm9wZG93biBdO1xufVxuXG4vKipcbiAqIE1lcmdlcyBkZWZhdWx0IGZpbHRlciBzZWdtZW50cyB3aXRoIGN1c3RvbSBzZWdtZW50cyB1c2luZyBJRC1iYXNlZCBvdmVycmlkZSBsb2dpYy5cbiAqIFxuICogRm9sbG93cyB0aGUgc2FtZSBwYXR0ZXJuIGFzIG1lcmdlQnV0dG9ucy9tZXJnZUFjdGlvbnM6IGN1c3RvbSBzZWdtZW50cyB3aXRoIG1hdGNoaW5nIElEc1xuICogb3ZlcnJpZGUgZGVmYXVsdHMsIGFuZCBuZXcgY3VzdG9tIHNlZ21lbnRzIGFyZSBhcHBlbmRlZC5cbiAqIFxuICogQHBhcmFtIGRlZmF1bHRzIC0gRGVmYXVsdCBzZWdtZW50IGNvbmZpZ3VyYXRpb25zXG4gKiBAcGFyYW0gY3VzdG9tcyAtIEN1c3RvbSBzZWdtZW50IGNvbmZpZ3VyYXRpb25zIHRvIG1lcmdlXG4gKiBAcmV0dXJucyBNZXJnZWQgYXJyYXkgd2l0aCBjdXN0b20gb3ZlcnJpZGVzIGFwcGxpZWRcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IGRlZmF1bHRzID0gW1xuICogICB7IGlkOiAnYWN0aXZlJywgbGFiZWw6ICdBY3RpdmUnLCBmaWx0ZXJzOiB7IHN0YXR1czogeyBlcTogJ2FjdGl2ZScgfSB9IH0sXG4gKiAgIHsgaWQ6ICdpbmFjdGl2ZScsIGxhYmVsOiAnSW5hY3RpdmUnLCBmaWx0ZXJzOiB7IHN0YXR1czogeyBlcTogJ2luYWN0aXZlJyB9IH0gfVxuICogXTtcbiAqIGNvbnN0IGN1c3RvbXMgPSBbXG4gKiAgIHsgaWQ6ICdhcmNoaXZlZCcsIGxhYmVsOiAnQXJjaGl2ZWQnLCBmaWx0ZXJzOiB7IGFyY2hpdmVkOiB7IGVxOiB0cnVlIH0gfSB9XG4gKiBdO1xuICogY29uc3QgcmVzdWx0ID0gbWVyZ2VTZWdtZW50cyhkZWZhdWx0cywgY3VzdG9tcyk7XG4gKiAvLyBSZXR1cm5zOiBbYWN0aXZlLCBpbmFjdGl2ZSwgYXJjaGl2ZWRdXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlU2VnbWVudHM8VCBleHRlbmRzIHsgaWQ6IHN0cmluZyB9PihcbiAgICBkZWZhdWx0czogQXJyYXk8VD4sXG4gICAgY3VzdG9tczogUmVhZG9ubHlBcnJheTxUPiB8IEFycmF5PFQ+ID0gW11cbik6IEFycmF5PFQ+IHtcbiAgICByZXR1cm4gbWVyZ2VCdXR0b25zKGRlZmF1bHRzLCBbIC4uLmN1c3RvbXMgXSk7ICAvLyBSZXVzZSBtZXJnZUJ1dHRvbnMgbG9naWMgd2l0aCBpZC1iYXNlZCBvdmVycmlkZVxufVxuXG4vKipcbiAqIE1lcmdlcyBmaWVsZC1sZXZlbCB2aXNpYmlsaXR5LCBlbmFibGVtZW50LCBoZWxwIHRleHQsIGFuZCBwbGFjZWhvbGRlciBvdmVycmlkZXMgaW50byBiYXNlIHByb3BlcnRpZXMuXG4gKiBcbiAqIEFwcGxpZXMgY3VzdG9tIGZpZWxkIGNvbmZpZ3VyYXRpb25zIGZyb20gZm9ybS9kZXRhaWwgY29uZmlnIHRvIGJhc2Ugc2NoZW1hIHByb3BlcnRpZXMuXG4gKiBPbmx5IG1lcmdlcyBvdmVycmlkZXMgZm9yIGZpZWxkcyB0aGF0IGV4aXN0IGluIGJhc2UgcHJvcGVydGllcyAod2FybnMgYWJvdXQgbm9uLWV4aXN0ZW50IGZpZWxkcykuXG4gKiBcbiAqIEB0ZW1wbGF0ZSBUIC0gUHJvcGVydHkgdHlwZSB3aXRoIHJlcXVpcmVkIG5hbWUgZmllbGRcbiAqIEBwYXJhbSBiYXNlUHJvcGVydGllcyAtIEJhc2UgZmllbGQgcHJvcGVydGllcyBmcm9tIGVudGl0eSBzY2hlbWFcbiAqIEBwYXJhbSBmaWVsZE92ZXJyaWRlcyAtIEN1c3RvbSBmaWVsZCBvdmVycmlkZXMgZnJvbSBmb3JtL2RldGFpbCBjb25maWd1cmF0aW9uXG4gKiBAcmV0dXJucyBCYXNlIHByb3BlcnRpZXMgd2l0aCBvdmVycmlkZXMgbWVyZ2VkIGluXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBiYXNlUHJvcHMgPSBbXG4gKiAgIHsgbmFtZTogJ2VtYWlsJywgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlIH0sXG4gKiAgIHsgbmFtZTogJ2JpbycsIHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogZmFsc2UgfVxuICogXTtcbiAqIGNvbnN0IG92ZXJyaWRlcyA9IFtcbiAqICAgeyBuYW1lOiAnZW1haWwnLCBoZWxwVGV4dDogJ0VudGVyIGEgdmFsaWQgZW1haWwgYWRkcmVzcycgfSxcbiAqICAgeyBuYW1lOiAnYmlvJywgdmlzaWJpbGl0eTogeyBjcmVhdGU6IGZhbHNlIH0gfVxuICogXTtcbiAqIGNvbnN0IG1lcmdlZCA9IG1lcmdlRmllbGRWaXNpYmlsaXR5KGJhc2VQcm9wcywgb3ZlcnJpZGVzKTtcbiAqIC8vIFJldHVybnMgYmFzZVByb3BzIHdpdGggaGVscFRleHQgYW5kIHZpc2liaWxpdHkgbWVyZ2VkXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlRmllbGRWaXNpYmlsaXR5PFQgZXh0ZW5kcyB7IG5hbWU6IHN0cmluZyB9PihcbiAgICBiYXNlUHJvcGVydGllczogQXJyYXk8VD4sXG4gICAgZmllbGRPdmVycmlkZXM6IFJlYWRvbmx5QXJyYXk8e1xuICAgICAgICByZWFkb25seSBuYW1lOiBzdHJpbmc7XG4gICAgICAgIHJlYWRvbmx5IFtrZXk6IHN0cmluZ106IHVua25vd247XG4gICAgfT4gfCBBcnJheTx7XG4gICAgICAgIG5hbWU6IHN0cmluZztcbiAgICAgICAgW2tleTogc3RyaW5nXTogdW5rbm93bjtcbiAgICB9PiA9IFtdXG4pOiBBcnJheTxUPiB7XG4gICAgY29uc3Qgb3ZlcnJpZGVNYXAgPSBuZXcgTWFwKFxuICAgICAgICBbIC4uLmZpZWxkT3ZlcnJpZGVzIF0ubWFwKGYgPT4gWyBmLm5hbWUsIGYgXSlcbiAgICApO1xuXG4gICAgZmllbGRPdmVycmlkZXMuZm9yRWFjaChvdmVycmlkZSA9PiB7XG4gICAgICAgIGlmICghYmFzZVByb3BlcnRpZXMuc29tZShwID0+IHAubmFtZSA9PT0gb3ZlcnJpZGUubmFtZSkpIHtcbiAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgRmllbGQgb3ZlcnJpZGUgXCIke292ZXJyaWRlLm5hbWV9XCIgbm90IGZvdW5kIGluIHNjaGVtYSBwcm9wZXJ0aWVzLiBUaGlzIG92ZXJyaWRlIHdpbGwgYmUgaWdub3JlZC5gKTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGJhc2VQcm9wZXJ0aWVzLm1hcChwcm9wID0+IHtcbiAgICAgICAgY29uc3Qgb3ZlcnJpZGUgPSBvdmVycmlkZU1hcC5nZXQocHJvcC5uYW1lKTtcblxuICAgICAgICBpZiAoIW92ZXJyaWRlKSByZXR1cm4gcHJvcDtcblxuICAgICAgICBjb25zdCB7IG5hbWU6IF9uYW1lLCAuLi5vdmVycmlkZVByb3BzIH0gPSBvdmVycmlkZTtcbiAgICAgICAgY29uc3QgZGVmaW5lZE92ZXJyaWRlczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgICAgICAgZm9yIChjb25zdCBbIGtleSwgdmFsdWUgXSBvZiBPYmplY3QuZW50cmllcyhvdmVycmlkZVByb3BzKSkge1xuICAgICAgICAgICAgaWYgKHZhbHVlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICBkZWZpbmVkT3ZlcnJpZGVzWyBrZXkgXSA9IHZhbHVlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIC4uLnByb3AsXG4gICAgICAgICAgICAuLi5kZWZpbmVkT3ZlcnJpZGVzLFxuICAgICAgICB9O1xuICAgIH0pO1xufVxuXG4vKipcbiAqIE1lcmdlcyBjb2x1bW4tbGV2ZWwgdmlzaWJpbGl0eSwgd2lkdGgsIGZpeGVkIHBvc2l0aW9uLCBncm91cGluZyBvdmVycmlkZXMsIGFuZCBvcmRlcmluZyBpbnRvIGJhc2UgcHJvcGVydGllcy5cbiAqIFxuICogQXBwbGllcyBjdXN0b20gY29sdW1uIGNvbmZpZ3VyYXRpb25zIGZyb20gdGFibGUgY29uZmlnIHRvIGJhc2Ugc2NoZW1hIHByb3BlcnRpZXMuXG4gKiBPbmx5IG1lcmdlcyBvdmVycmlkZXMgZm9yIGNvbHVtbnMgdGhhdCBleGlzdCBpbiBiYXNlIHByb3BlcnRpZXMgKHdhcm5zIGFib3V0IG5vbi1leGlzdGVudCBjb2x1bW5zKS5cbiAqIFxuICogKipWaXNpYmlsaXR5IExvZ2ljOioqXG4gKiAtIFdoZW4gY29sdW1uT3ZlcnJpZGVzIGlzIHByb3ZpZGVkOlxuICogICAtIEZpZWxkcyBJTiB0aGUgYXJyYXk6IFVzZSBgZGVmYXVsdFZpc2libGVgIChkZWZhdWx0cyB0byB0cnVlIGlmIG5vdCBzcGVjaWZpZWQpXG4gKiAgIC0gRmllbGRzIE5PVCBJTiB0aGUgYXJyYXk6IFNldCBgZGVmYXVsdFZpc2libGU6IGZhbHNlYCAoYXZhaWxhYmxlIGluIENvbHVtbiBTZXR0aW5ncyBidXQgbm90IHNob3duIGJ5IGRlZmF1bHQpXG4gKiAtIFdoZW4gY29sdW1uT3ZlcnJpZGVzIGlzIGVtcHR5L3VuZGVmaW5lZDogQWxsIGZpZWxkcyB2aXNpYmxlIChiYWNrd2FyZCBjb21wYXRpYmxlKVxuICogXG4gKiAqKk9yZGVyaW5nIExvZ2ljOioqXG4gKiAtIFdoZW4gY29sdW1uT3ZlcnJpZGVzIGlzIHByb3ZpZGVkOlxuICogICAtIENvbHVtbnMgYXJlIG9yZGVyZWQgYWNjb3JkaW5nIHRvIHRoZWlyIHBvc2l0aW9uIGluIHRoZSBjb2x1bW5PdmVycmlkZXMgYXJyYXlcbiAqICAgLSBDb2x1bW5zIG5vdCBpbiB0aGUgYXJyYXkgYXBwZWFyIGF0IHRoZSBlbmQgaW4gdGhlaXIgb3JpZ2luYWwgb3JkZXJcbiAqIC0gV2hlbiBjb2x1bW5PdmVycmlkZXMgaXMgZW1wdHkvdW5kZWZpbmVkOiBPcmlnaW5hbCBvcmRlciBpcyBwcmVzZXJ2ZWRcbiAqIFxuICogQHRlbXBsYXRlIFQgLSBQcm9wZXJ0eSB0eXBlIHdpdGggcmVxdWlyZWQgbmFtZSBmaWVsZFxuICogQHBhcmFtIGJhc2VQcm9wZXJ0aWVzIC0gQmFzZSBjb2x1bW4gcHJvcGVydGllcyBmcm9tIGVudGl0eSBzY2hlbWFcbiAqIEBwYXJhbSBjb2x1bW5PdmVycmlkZXMgLSBDdXN0b20gY29sdW1uIG92ZXJyaWRlcyBmcm9tIHRhYmxlIGNvbmZpZ3VyYXRpb25cbiAqIEByZXR1cm5zIEJhc2UgcHJvcGVydGllcyB3aXRoIG92ZXJyaWRlcyBtZXJnZWQgaW4gYW5kIHJlb3JkZXJlZFxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY29uc3QgYmFzZVByb3BzID0gW1xuICogICB7IG5hbWU6ICdvcmRlcklkJywgZGF0YUluZGV4OiAnb3JkZXJJZCcsIHR5cGU6ICdzdHJpbmcnIH0sXG4gKiAgIHsgbmFtZTogJ3N0YXR1cycsIGRhdGFJbmRleDogJ3N0YXR1cycsIHR5cGU6ICdzdHJpbmcnIH0sXG4gKiAgIHsgbmFtZTogJ3VzZXJJZCcsIGRhdGFJbmRleDogJ3VzZXJJZCcsIHR5cGU6ICdzdHJpbmcnIH0sXG4gKiAgIHsgbmFtZTogJ21ldGFkYXRhJywgZGF0YUluZGV4OiAnbWV0YWRhdGEnLCB0eXBlOiAnc3RyaW5nJyB9XG4gKiBdO1xuICogY29uc3Qgb3ZlcnJpZGVzID0gW1xuICogICB7IGZpZWxkOiAnc3RhdHVzJywgZGVmYXVsdFZpc2libGU6IHRydWUgfSwgICAgICAgICAvLyAxc3QgcG9zaXRpb25cbiAqICAgeyBmaWVsZDogJ29yZGVySWQnLCB3aWR0aDogMjAwLCBkZWZhdWx0VmlzaWJsZTogdHJ1ZSB9LCAvLyAybmQgcG9zaXRpb25cbiAqICAgeyBmaWVsZDogJ21ldGFkYXRhJywgZGVmYXVsdFZpc2libGU6IGZhbHNlIH0gICAgICAgLy8gM3JkIHBvc2l0aW9uIChoaWRkZW4pXG4gKiAgIC8vIHVzZXJJZCBub3QgbGlzdGVkIC0gd2lsbCBiZSBhdCB0aGUgZW5kIGFuZCBoaWRkZW4gYnkgZGVmYXVsdFxuICogXTtcbiAqIGNvbnN0IG1lcmdlZCA9IG1lcmdlQ29sdW1uVmlzaWJpbGl0eShiYXNlUHJvcHMsIG92ZXJyaWRlcyk7XG4gKiAvLyBSZXN1bHQgKGluIG9yZGVyKTpcbiAqIC8vIDEuIHN0YXR1czogZGVmYXVsdFZpc2libGU6IHRydWVcbiAqIC8vIDIuIG9yZGVySWQ6IGRlZmF1bHRWaXNpYmxlOiB0cnVlLCB3aWR0aDogMjAwXG4gKiAvLyAzLiBtZXRhZGF0YTogZGVmYXVsdFZpc2libGU6IGZhbHNlXG4gKiAvLyA0LiB1c2VySWQ6IGRlZmF1bHRWaXNpYmxlOiBmYWxzZSAobm90IGluIG92ZXJyaWRlcywgYXQgdGhlIGVuZClcbiAqIGBgYFxuICovXG4vKipcbiAqIE5vcm1hbGl6ZWQgY29sdW1uIGNvbmZpZ3VyYXRpb24gd2l0aCBkZWZhdWx0VmlzaWJsZSBhbHdheXMgZGVmaW5lZC5cbiAqIEludGVybmFsIHR5cGUgZm9yIHByb2Nlc3NpbmcgY29sdW1uIG92ZXJyaWRlcy5cbiAqL1xudHlwZSBOb3JtYWxpemVkQ29sdW1uQ29uZmlnID0gT21pdDxJVGFibGVDb2x1bW5Db25maWcsICdkZWZhdWx0VmlzaWJsZSc+ICYge1xuICAgIGRlZmF1bHRWaXNpYmxlOiBib29sZWFuO1xuICAgIF9vcmRlcj86IG51bWJlcjtcbn07XG5cbi8qKlxuICogTm9ybWFsaXplcyBjb2x1bW4gb3ZlcnJpZGVzIHRvIGEgY29uc2lzdGVudCBmb3JtYXQuXG4gKiBTdXBwb3J0cyBib3RoIHN0cmluZyBzaG9ydGhhbmQgKCdmaWVsZE5hbWUnKSBhbmQgb2JqZWN0IHN5bnRheCAoeyBmaWVsZDogJ2ZpZWxkTmFtZScsIC4uLiB9KVxuICogXG4gKiBAcGFyYW0gY29sdW1uT3ZlcnJpZGVzIC0gQ29sdW1uIGNvbmZpZ3VyYXRpb25zIChzdHJpbmcgb3Igb2JqZWN0IGZvcm1hdClcbiAqIEByZXR1cm5zIE5vcm1hbGl6ZWQgYXJyYXkgb2YgY29sdW1uIGNvbmZpZyBvYmplY3RzXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUNvbHVtbk92ZXJyaWRlcyhcbiAgICBjb2x1bW5PdmVycmlkZXM6IElUYWJsZUNvbHVtbnNcbik6IEFycmF5PE5vcm1hbGl6ZWRDb2x1bW5Db25maWc+IHtcbiAgICByZXR1cm4gKGNvbHVtbk92ZXJyaWRlcyBhcyBBcnJheTxJVGFibGVDb2x1bW4+KS5tYXAoY29sID0+IHtcbiAgICAgICAgLy8gU3RyaW5nIHNob3J0aGFuZDogJ2ZpZWxkTmFtZScg4oaSIHsgZmllbGQ6ICdmaWVsZE5hbWUnLCBkZWZhdWx0VmlzaWJsZTogdHJ1ZSB9XG4gICAgICAgIGlmICh0eXBlb2YgY29sID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBmaWVsZDogY29sLFxuICAgICAgICAgICAgICAgIGRlZmF1bHRWaXNpYmxlOiB0cnVlXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIC8vIE9iamVjdCBzeW50YXg6IGFscmVhZHkgbm9ybWFsaXplZCwganVzdCBlbnN1cmUgZGVmYXVsdFZpc2libGUgZGVmYXVsdHMgdG8gdHJ1ZVxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZmllbGQ6IGNvbC5maWVsZCxcbiAgICAgICAgICAgIHZpc2liaWxpdHk6IGNvbC52aXNpYmlsaXR5LFxuICAgICAgICAgICAgcmVuZGVyZXI6IGNvbC5yZW5kZXJlcixcbiAgICAgICAgICAgIHdpZHRoOiBjb2wud2lkdGgsXG4gICAgICAgICAgICBmaXhlZDogY29sLmZpeGVkLFxuICAgICAgICAgICAgZ3JvdXBUaXRsZTogY29sLmdyb3VwVGl0bGUsXG4gICAgICAgICAgICBkZWZhdWx0VmlzaWJsZTogY29sLmRlZmF1bHRWaXNpYmxlICE9PSBmYWxzZSwgLy8gRGVmYXVsdHMgdG8gdHJ1ZVxuICAgICAgICAgICAgLi4uKGNvbC5mb3JtYXR0aW5nICYmIHsgZm9ybWF0dGluZzogY29sLmZvcm1hdHRpbmcgfSksXG4gICAgICAgICAgICAuLi4oY29sLmNvbXBvc2l0ZSAmJiB7IGNvbXBvc2l0ZTogY29sLmNvbXBvc2l0ZSB9KSxcbiAgICAgICAgICAgIC4uLihjb2wubWFza2luZyAmJiB7IG1hc2tpbmc6IGNvbC5tYXNraW5nIH0pLFxuICAgICAgICAgICAgLi4uKGNvbC5kZXJpdmVkICYmIHsgZGVyaXZlZDogY29sLmRlcml2ZWQgfSksXG4gICAgICAgIH07XG4gICAgfSk7XG59XG5cbi8qKlxuICogTWVyZ2VzIGNvbHVtbiB2aXNpYmlsaXR5IGNvbmZpZ3VyYXRpb24gd2l0aCBiYXNlIHByb3BlcnRpZXMuXG4gKiBDb250cm9scyB3aGljaCBjb2x1bW5zIGFyZSB2aXNpYmxlIGJ5IGRlZmF1bHQgYW5kIHRoZWlyIGRpc3BsYXkgb3JkZXIuXG4gKiBcbiAqICoqU3VwcG9ydHM6KipcbiAqIC0gU2NoZW1hIGZpZWxkcyAoZnJvbSBiYXNlIHByb3BlcnRpZXMpXG4gKiAtIEpTT04gcGF0aHMgKGUuZy4sICd1c2VyLmVtYWlsJywgJ21ldGFkYXRhLnNjb3JlJylcbiAqIC0gQ3VzdG9tL2NvbXB1dGVkIGNvbHVtbnMgKG5vdCBpbiBzY2hlbWEsIHByb3ZpZGVkIGJ5IEFQSSBvciBmcm9udGVuZClcbiAqIFxuICogQHRlbXBsYXRlIFQgLSBCYXNlIHByb3BlcnR5IHR5cGUgd2l0aCBuYW1lIGFuZCBkYXRhSW5kZXhcbiAqIEBwYXJhbSBiYXNlUHJvcGVydGllcyAtIEJhc2UgcHJvcGVydGllcyBmcm9tIGVudGl0eSBzY2hlbWFcbiAqIEBwYXJhbSBjb2x1bW5PdmVycmlkZXMgLSBDb2x1bW4gY29uZmlndXJhdGlvbiBvdmVycmlkZXMgKHN0cmluZyBvciBvYmplY3QgZm9ybWF0KVxuICogQHJldHVybnMgTWVyZ2VkIHByb3BlcnRpZXMgd2l0aCB2aXNpYmlsaXR5IGFuZCBvcmRlciBhcHBsaWVkLCBpbmNsdWRpbmcgY3VzdG9tIGNvbHVtbnNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlQ29sdW1uVmlzaWJpbGl0eTxUIGV4dGVuZHMgeyBuYW1lOiBzdHJpbmc7IGRhdGFJbmRleD86IHN0cmluZyB9PihcbiAgICBiYXNlUHJvcGVydGllczogQXJyYXk8VD4sXG4gICAgY29sdW1uT3ZlcnJpZGVzOiBJVGFibGVDb2x1bW5zID0gW11cbik6IEFycmF5PFQ+IHtcbiAgICAvLyBJZiBubyBjb2x1bW5PdmVycmlkZXMgcHJvdmlkZWQsIHJldHVybiBwcm9wZXJ0aWVzIGFzLWlzIChiYWNrd2FyZCBjb21wYXRpYmxlKVxuICAgIGlmICghY29sdW1uT3ZlcnJpZGVzIHx8IGNvbHVtbk92ZXJyaWRlcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIGJhc2VQcm9wZXJ0aWVzO1xuICAgIH1cblxuICAgIC8vIE5vcm1hbGl6ZSBjb2x1bW4gb3ZlcnJpZGVzIChoYW5kbGUgc3RyaW5nIHNob3J0aGFuZClcbiAgICBjb25zdCBub3JtYWxpemVkT3ZlcnJpZGVzID0gbm9ybWFsaXplQ29sdW1uT3ZlcnJpZGVzKGNvbHVtbk92ZXJyaWRlcyk7XG5cbiAgICBjb25zdCBvdmVycmlkZU1hcCA9IG5ldyBNYXAoXG4gICAgICAgIG5vcm1hbGl6ZWRPdmVycmlkZXMubWFwKChjLCBpbmRleCkgPT4gWyBjLmZpZWxkLCB7IC4uLmMsIF9vcmRlcjogaW5kZXggfSBdKVxuICAgICk7XG5cbiAgICAvLyBUcmFjayB3aGljaCBvdmVycmlkZXMgbWF0Y2ggZXhpc3Rpbmcgc2NoZW1hIGNvbHVtbnNcbiAgICBjb25zdCBtYXRjaGVkT3ZlcnJpZGVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICAvLyBNZXJnZSBvdmVycmlkZXMgaW50byBleGlzdGluZyBzY2hlbWEgcHJvcGVydGllc1xuICAgIGNvbnN0IG1lcmdlZFByb3BlcnRpZXMgPSBiYXNlUHJvcGVydGllcy5tYXAocHJvcCA9PiB7XG4gICAgICAgIC8vIFVzZSBkYXRhSW5kZXggKGFjdHVhbCBmaWVsZCBuYW1lKSBpZiBhdmFpbGFibGUsIG90aGVyd2lzZSBmYWxsIGJhY2sgdG8gbmFtZVxuICAgICAgICBjb25zdCBmaWVsZE5hbWUgPSBwcm9wLmRhdGFJbmRleCB8fCBwcm9wLm5hbWU7XG4gICAgICAgIGNvbnN0IG92ZXJyaWRlID0gb3ZlcnJpZGVNYXAuZ2V0KGZpZWxkTmFtZSk7XG5cbiAgICAgICAgaWYgKCFvdmVycmlkZSkge1xuICAgICAgICAgICAgLy8gRmllbGQgbm90IGluIHRhYmxlQ29uZmlnLmNvbHVtbnMgLSBoaWRlIGJ5IGRlZmF1bHQgYnV0IGtlZXAgYXZhaWxhYmxlXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIC4uLnByb3AsXG4gICAgICAgICAgICAgICAgZGVmYXVsdFZpc2libGU6IGZhbHNlLFxuICAgICAgICAgICAgICAgIF9vcmRlcjogTnVtYmVyLk1BWF9TQUZFX0lOVEVHRVIgLy8gUHV0IGF0IHRoZSBlbmRcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGaWVsZCBpcyBpbiB0YWJsZUNvbmZpZy5jb2x1bW5zIC0gYXBwbHkgb3ZlcnJpZGVzXG4gICAgICAgIG1hdGNoZWRPdmVycmlkZXMuYWRkKG92ZXJyaWRlLmZpZWxkKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIC4uLnByb3AsXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUudmlzaWJpbGl0eSAhPT0gdW5kZWZpbmVkICYmIHsgdmlzaWJpbGl0eTogb3ZlcnJpZGUudmlzaWJpbGl0eSB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS5yZW5kZXJlciAhPT0gdW5kZWZpbmVkICYmIHsgcmVuZGVyZXI6IG92ZXJyaWRlLnJlbmRlcmVyIH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLndpZHRoICE9PSB1bmRlZmluZWQgJiYgeyB3aWR0aDogb3ZlcnJpZGUud2lkdGggfSksXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUuZml4ZWQgIT09IHVuZGVmaW5lZCAmJiB7IGZpeGVkOiBvdmVycmlkZS5maXhlZCB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS5ncm91cFRpdGxlICE9PSB1bmRlZmluZWQgJiYgeyBncm91cFRpdGxlOiBvdmVycmlkZS5ncm91cFRpdGxlIH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmZvcm1hdHRpbmcgJiYgeyBmb3JtYXR0aW5nOiBvdmVycmlkZS5mb3JtYXR0aW5nIH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmNvbXBvc2l0ZSAmJiB7IGNvbXBvc2l0ZTogb3ZlcnJpZGUuY29tcG9zaXRlIH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLm1hc2tpbmcgJiYgeyBtYXNraW5nOiBvdmVycmlkZS5tYXNraW5nIH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmRlcml2ZWQgJiYgeyBkZXJpdmVkOiBvdmVycmlkZS5kZXJpdmVkIH0pLFxuICAgICAgICAgICAgZGVmYXVsdFZpc2libGU6IG92ZXJyaWRlLmRlZmF1bHRWaXNpYmxlICE9PSBmYWxzZSwgIC8vIERlZmF1bHRzIHRvIHRydWVcbiAgICAgICAgICAgIF9vcmRlcjogb3ZlcnJpZGUuX29yZGVyXG4gICAgICAgIH07XG4gICAgfSk7XG5cbiAgICAvLyBBZGQgY3VzdG9tIGNvbHVtbnMgKEpTT04gcGF0aHMsIGNvbXB1dGVkIGZpZWxkcylcbiAgICBub3JtYWxpemVkT3ZlcnJpZGVzLmZvckVhY2gob3ZlcnJpZGUgPT4ge1xuICAgICAgICBpZiAoIW1hdGNoZWRPdmVycmlkZXMuaGFzKG92ZXJyaWRlLmZpZWxkKSkge1xuICAgICAgICAgICAgLy8gVGhpcyBpcyBhIGN1c3RvbSBjb2x1bW4gKEpTT04gcGF0aCBvciBjb21wdXRlZCBmaWVsZClcbiAgICAgICAgICAgIGNvbnN0IGlzSnNvblBhdGggPSBvdmVycmlkZS5maWVsZC5pbmNsdWRlcygnLicpO1xuXG4gICAgICAgICAgICAvLyBMb2cgaW5mbyBhYm91dCBjdXN0b20gY29sdW1uXG4gICAgICAgICAgICBpZiAoaXNKc29uUGF0aCkge1xuICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIuZGVidWcoYEFkZGluZyBKU09OIHBhdGggY29sdW1uOiBcIiR7b3ZlcnJpZGUuZmllbGR9XCJgKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgRGVmYXVsdExvZ2dlci5kZWJ1ZyhgQWRkaW5nIGN1c3RvbSBjb2x1bW46IFwiJHtvdmVycmlkZS5maWVsZH1cIiAobm90IGluIHNjaGVtYSwgYXNzdW1lcyBBUEkgcHJvdmlkZXMgaXQpYCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEFkZCBhcyBuZXcgY3VzdG9tIGNvbHVtblxuICAgICAgICAgICAgbWVyZ2VkUHJvcGVydGllcy5wdXNoKHtcbiAgICAgICAgICAgICAgICBuYW1lOiBvdmVycmlkZS5maWVsZCwgIC8vIFVzZSBmaWVsZCBhcyBuYW1lXG4gICAgICAgICAgICAgICAgZGF0YUluZGV4OiBvdmVycmlkZS5maWVsZCwgIC8vIEZyb250ZW5kIHdpbGwgdXNlIGdldE5lc3RlZFZhbHVlKClcbiAgICAgICAgICAgICAgICBkZWZhdWx0VmlzaWJsZTogb3ZlcnJpZGUuZGVmYXVsdFZpc2libGUsXG4gICAgICAgICAgICAgICAgZmllbGRUeXBlOiAndGV4dCcsICAvLyBEZWZhdWx0IHRvIHRleHQgZm9yIGN1c3RvbSBjb2x1bW5zXG4gICAgICAgICAgICAgICAgLi4uKG92ZXJyaWRlLnZpc2liaWxpdHkgIT09IHVuZGVmaW5lZCAmJiB7IHZpc2liaWxpdHk6IG92ZXJyaWRlLnZpc2liaWxpdHkgfSksXG4gICAgICAgICAgICAgICAgLi4uKG92ZXJyaWRlLnJlbmRlcmVyICE9PSB1bmRlZmluZWQgJiYgeyByZW5kZXJlcjogb3ZlcnJpZGUucmVuZGVyZXIgfSksXG4gICAgICAgICAgICAgICAgLi4uKG92ZXJyaWRlLndpZHRoICE9PSB1bmRlZmluZWQgJiYgeyB3aWR0aDogb3ZlcnJpZGUud2lkdGggfSksXG4gICAgICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmZpeGVkICE9PSB1bmRlZmluZWQgJiYgeyBmaXhlZDogb3ZlcnJpZGUuZml4ZWQgfSksXG4gICAgICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmdyb3VwVGl0bGUgIT09IHVuZGVmaW5lZCAmJiB7IGdyb3VwVGl0bGU6IG92ZXJyaWRlLmdyb3VwVGl0bGUgfSksXG4gICAgICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmZvcm1hdHRpbmcgJiYgeyBmb3JtYXR0aW5nOiBvdmVycmlkZS5mb3JtYXR0aW5nIH0pLFxuICAgICAgICAgICAgICAgIC4uLihvdmVycmlkZS5jb21wb3NpdGUgJiYgeyBjb21wb3NpdGU6IG92ZXJyaWRlLmNvbXBvc2l0ZSB9KSxcbiAgICAgICAgICAgICAgICAuLi4ob3ZlcnJpZGUubWFza2luZyAmJiB7IG1hc2tpbmc6IG92ZXJyaWRlLm1hc2tpbmcgfSksXG4gICAgICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmRlcml2ZWQgJiYgeyBkZXJpdmVkOiBvdmVycmlkZS5kZXJpdmVkIH0pLFxuICAgICAgICAgICAgICAgIF9vcmRlcjogb3ZlcnJpZGUuX29yZGVyXG4gICAgICAgICAgICB9IGFzIGFueSk7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIFNvcnQgYnkgb3JkZXIgZnJvbSBjb2x1bW5PdmVycmlkZXMgKGNvbHVtbnMgbm90IGluIG92ZXJyaWRlcyBnbyB0byBlbmQpXG4gICAgbWVyZ2VkUHJvcGVydGllcy5zb3J0KChhOiBhbnksIGI6IGFueSkgPT4gKGEuX29yZGVyID8/IE51bWJlci5NQVhfU0FGRV9JTlRFR0VSKSAtIChiLl9vcmRlciA/PyBOdW1iZXIuTUFYX1NBRkVfSU5URUdFUikpO1xuXG4gICAgLy8gUmVtb3ZlIHRlbXBvcmFyeSBfb3JkZXIgcHJvcGVydHlcbiAgICByZXR1cm4gbWVyZ2VkUHJvcGVydGllcy5tYXAoKHsgX29yZGVyLCAuLi5yZXN0IH06IGFueSkgPT4gcmVzdCk7XG59XG4iXX0=
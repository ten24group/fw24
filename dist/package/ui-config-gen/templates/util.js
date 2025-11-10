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
function formatEntityAttributesForCreate(properties, entityService, globalUIConfigOptions) {
    return properties
        .filter(prop => prop && (!prop.hasOwnProperty('isCreatable') || prop.isCreatable))
        .map((att) => formatEntityAttributeForFormOrDetail(att, 'create', entityService, properties, globalUIConfigOptions));
}
function formatEntityAttributesForUpdate(properties, entityService, globalUIConfigOptions) {
    return properties
        .filter(prop => prop && (!prop.hasOwnProperty('isEditable') || prop.isEditable))
        .map((att) => formatEntityAttributeForFormOrDetail(att, 'update', entityService, properties, globalUIConfigOptions));
}
function formatEntityAttributesForDetail(properties, entityService, globalUIConfigOptions) {
    return properties
        .filter(prop => prop && (!prop.hasOwnProperty('isVisible') || prop.isVisible))
        .map((att) => formatEntityAttributeForFormOrDetail(att, 'detail', entityService, properties, globalUIConfigOptions));
}
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
 * Merge default actions with custom actions using identifier-based override.
 * Same logic as mergeButtons but semantically named for actions.
 *
 * @param defaults - Default actions (from generator)
 * @param customs - Custom actions (from entity schema)
 * @returns Merged action array
 */
function mergeActions(defaults, customs = []) {
    return mergeButtons(defaults, [...customs]); // Spread to handle both readonly and mutable
}
/**
 * Merge field-level visibility/enablement/helpText/placeholder into base properties.
 *
 * @param baseProperties - Base properties from schema
 * @param fieldOverrides - Field overrides from formConfig.fields
 * @returns Properties with overrides merged
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
 * Merge column-level visibility/width/fixed into base properties.
 *
 * @param baseProperties - Base properties from schema
 * @param columnOverrides - Column overrides from tableConfig.columns
 * @returns Properties with column overrides merged
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy91aS1jb25maWctZ2VuL3RlbXBsYXRlcy91dGlsLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBcWhCQSw0REFnQkM7QUEwTUQsa0VBNERDO0FBb0JELG9EQXlOQztBQXVYRCw0Q0F1TkM7QUFNRCxvRkFzUkM7QUFFRCxzRkFrQkM7QUFFRCwwRUFJQztBQUVELDBFQUlDO0FBRUQsMEVBSUM7QUFjRCxzRUF1R0M7QUFrQkQsb0NBd0JDO0FBVUQsb0NBS0M7QUFTRCxvREF3Q0M7QUFTRCxzREF3Q0M7QUF4ckVELHlDQVlzQjtBQUV0Qix5Q0FBOEM7QUFFOUMsMkNBQThDO0FBQzlDLHVDQUE4RDtBQWtEOUQ7O0dBRUc7QUFDSDs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW1CRztBQUNILE1BQU0sd0JBQXdCLEdBQThDO0lBQ3hFLE9BQU8sRUFBRSxJQUFJO0lBQ2IsUUFBUSxFQUFFO1FBQ04sNENBQTRDO1FBQzVDLE9BQU8sRUFBRSxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLGFBQWEsQ0FBQztRQUNsRCw0Q0FBNEM7UUFDNUMsTUFBTSxFQUFFLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFLFNBQVMsQ0FBQztRQUN0RCx3Q0FBd0M7UUFDeEMsSUFBSSxFQUFFLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsWUFBWSxFQUFFLFVBQVUsQ0FBQztLQUMxRDtJQUNELFFBQVEsRUFBRTtRQUNOLDBDQUEwQztRQUMxQyxRQUFRLEVBQUUsT0FBTztRQUNqQixRQUFRLEVBQUUsUUFBUSxFQUFFLGFBQWE7UUFDakMsU0FBUyxFQUFFLFdBQVcsRUFBRSxVQUFVO1FBQ2xDLE1BQU0sRUFBRSxXQUFXLEVBQUUsVUFBVTtRQUMvQixPQUFPLEVBQUUsU0FBUyxFQUFFLFVBQVU7UUFDOUIsT0FBTyxFQUFFLFFBQVEsRUFB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Y2UsIFxuICAgIEZpZWxkTWV0YWRhdGEsIFxuICAgIFRJT1NjaGVtYUF0dHJpYnV0ZSwgXG4gICAgaXNTZWxlY3RGaWVsZE1ldGFkYXRhLFxuICAgIFNlbGVjdEZpZWxkTWV0YWRhdGEsXG4gICAgRW50aXR5QXR0cmlidXRlLFxuICAgIElSZWxhdGlvbkZpZWxkQ29uZmlnLFxuICAgIFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXAsXG4gICAgRW50aXR5U2NoZW1hLFxuICAgIElGaWx0ZXJTZWdtZW50LFxuICAgIGNyZWF0ZUZpZWxkT3B0aW9uc1xufSBmcm9tIFwiLi4vLi4vZW50aXR5XCI7XG5pbXBvcnQgdHlwZSB7IFJlbGF0aW9uRW50aXR5T3B0aW9uQ29uZmlnLCBGaWVsZE9wdGlvbnNBUElDb25maWcsIElFbnRpdHlQYWdlQWN0aW9uLCBUZW1wbGF0ZSwgRmllbGRPcHRpb24sIElGaWx0ZXJTZWdtZW50R3JvdXAgfSBmcm9tICcuLi8uLi9lbnRpdHkvYmFzZS1lbnRpdHknO1xuaW1wb3J0IHsgRnJhbWV3b3JrRXJyb3IgfSBmcm9tIFwiLi4vLi4vZXJyb3JzXCI7XG5pbXBvcnQgdHlwZSB7IElBcHBsaWNhdGlvbkNvbmZpZywgSUR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbkNvbmZpZywgSVNlZ21lbnRBdXRvR2VuZXJhdGlvbkNvbmZpZyB9IGZyb20gJy4uLy4uL2ludGVyZmFjZXMvY29uZmlnJztcbmltcG9ydCB7IERlZmF1bHRMb2dnZXIgfSBmcm9tIFwiLi4vLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgcGFzY2FsQ2FzZSwgdG9IdW1hblJlYWRhYmxlTmFtZSB9IGZyb20gXCIuLi8uLi91dGlsc1wiO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNNQVJUIERVUExJQ0FURUQgRklFTEQgREVURUNUSU9OIC0gRU5IQU5DRUQgQUxHT1JJVEhNXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBEZXRlY3Rpb24gcmVzdWx0IHdpdGggcmljaCBtZXRhZGF0YVxuICovXG5pbnRlcmZhY2UgRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uUmVzdWx0IHtcbiAgICAvKiogUHJpbWFyeSBkaXNwbGF5IGZpZWxkIGRldGVjdGVkIChlLmcuLCAndGVhbU5hbWUnKSAqL1xuICAgIHByaW1hcnlGaWVsZD86IHN0cmluZztcbiAgICBcbiAgICAvKiogR2VuZXJhdGVkIHRlbXBsYXRlIHN0cmluZyAoZS5nLiwgJ3t0ZWFtTmFtZX0nIG9yICd7dGVhbU5hbWV9ICh7dGVhbUNvZGV9KScpICovXG4gICAgdGVtcGxhdGU/OiBzdHJpbmc7XG4gICAgXG4gICAgLyoqIEFsbCBkZXRlY3RlZCBmaWVsZHMgYnkgY2F0ZWdvcnkgKi9cbiAgICBkZXRlY3RlZEZpZWxkczoge1xuICAgICAgICAvKiogRGlzcGxheSBmaWVsZHM6IE5hbWUsIFRpdGxlLCBMYWJlbCAqL1xuICAgICAgICBkaXNwbGF5Pzogc3RyaW5nW107XG4gICAgICAgIC8qKiBWaXN1YWwgZmllbGRzOiBMb2dvLCBJbWFnZSwgSWNvbiAqL1xuICAgICAgICB2aXN1YWw/OiBzdHJpbmdbXTtcbiAgICAgICAgLyoqIE1ldGEgZmllbGRzOiBDb2RlLCBTbHVnLCBLZXkgKi9cbiAgICAgICAgbWV0YT86IHN0cmluZ1tdO1xuICAgIH07XG4gICAgXG4gICAgLyoqIENvbmZpZGVuY2UgbGV2ZWwgKi9cbiAgICBjb25maWRlbmNlOiAnaGlnaCcgfCAnbWVkaXVtJyB8ICdsb3cnO1xuICAgIFxuICAgIC8qKiBEZXRlY3Rpb24gbWV0aG9kIHVzZWQgKi9cbiAgICBtZXRob2Q6IHN0cmluZztcbiAgICBcbiAgICAvKiogUGF0dGVybiB0aGF0IG1hdGNoZWQgKi9cbiAgICBwYXR0ZXJuOiBzdHJpbmc7XG59XG5cbi8qKlxuICogUGFyc2VkIGNvbXBvbmVudHMgZnJvbSByZWxhdGlvbiBmaWVsZCBuYW1lXG4gKi9cbmludGVyZmFjZSBQYXJzZWRSZWxhdGlvbkZpZWxkIHtcbiAgICAvKiogUHJlZml4IChlLmcuLCAnaG9tZScsICdhd2F5JywgJ2NvbXBldGl0b3IxJykgKi9cbiAgICBwcmVmaXg/OiBzdHJpbmc7XG4gICAgLyoqIEJhc2UgbmFtZSB3aXRob3V0IHByZWZpeCBhbmQgJ0lkJyBzdWZmaXggKGUuZy4sICdUZWFtJykgKi9cbiAgICBiYXNlTmFtZTogc3RyaW5nO1xuICAgIC8qKiBXaGV0aGVyIGZpZWxkIGVuZHMgd2l0aCAnSWQnICovXG4gICAgaGFzSWRTdWZmaXg6IGJvb2xlYW47XG4gICAgLyoqIE9yaWdpbmFsIGZpZWxkIG5hbWUgKi9cbiAgICBvcmlnaW5hbEZpZWxkOiBzdHJpbmc7XG59XG5cbi8qKlxuICogU21hcnQgZGVmYXVsdCBjb25maWd1cmF0aW9uXG4gKi9cbi8qKlxuICogRnJhbWV3b3JrLWxldmVsIGRlZmF1bHQgZGV0ZWN0aW9uIGNvbmZpZy5cbiAqIENvbnRhaW5zIE9OTFkgZG9tYWluLWFnbm9zdGljIHBhdHRlcm5zIHRoYXQgd29yayBhY3Jvc3MgYW55IGFwcGxpY2F0aW9uLlxuICogXG4gKiBBcHBsaWNhdGlvbnMgc2hvdWxkIHByb3ZpZGUgZG9tYWluLXNwZWNpZmljIHByZWZpeGVzIHZpYSB1aUNvbmZpZ09wdGlvbnMuXG4gKiBcbiAqIEBleGFtcGxlIEFwcGxpY2F0aW9uLXNwZWNpZmljIGNvbmZpZyAoaW4gYmFja2VuZCBpbmRleC50cyk6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCB1aUNvbmZpZ09wdGlvbnMgPSB7XG4gKiAgIGR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbjoge1xuICogICAgIHByZWZpeGVzOiBbXG4gKiAgICAgICAvLyBEb21haW4tc3BlY2lmaWMgcHJlZml4ZXMgZm9yIHlvdXIgYXBwXG4gKiAgICAgICAncGxheWVyJywgJ3RlYW0nLCAnbGVhZ3VlJywgJ3NlYXNvbicsICd2ZW51ZScsICdzcG9ydCcsICAvLyBTcG9ydHMgYXBwXG4gKiAgICAgICAvLyBPUjogJ2N1c3RvbWVyJywgJ29yZGVyJywgJ3Byb2R1Y3QnLCAnaW52b2ljZScgIC8vIEUtY29tbWVyY2UgYXBwXG4gKiAgICAgICAvLyBPUjogJ2F1dGhvcicsICdib29rJywgJ3B1Ymxpc2hlcicsICdnZW5yZScgIC8vIExpYnJhcnkgYXBwXG4gKiAgICAgXVxuICogICB9XG4gKiB9O1xuICogYGBgXG4gKi9cbmNvbnN0IERFRkFVTFRfREVURUNUSU9OX0NPTkZJRzogUmVxdWlyZWQ8SUR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbkNvbmZpZz4gPSB7XG4gICAgZW5hYmxlZDogdHJ1ZSxcbiAgICBzdWZmaXhlczoge1xuICAgICAgICAvLyBHZW5lcmljIGRpc3BsYXkgdGV4dCBwYXR0ZXJucyAodW5pdmVyc2FsKVxuICAgICAgICBkaXNwbGF5OiBbJ05hbWUnLCAnVGl0bGUnLCAnTGFiZWwnLCAnRGlzcGxheU5hbWUnXSxcbiAgICAgICAgLy8gR2VuZXJpYyB2aXN1YWwgYXNzZXQgcGF0dGVybnMgKHVuaXZlcnNhbClcbiAgICAgICAgdmlzdWFsOiBbJ0xvZ28nLCAnSW1hZ2UnLCAnSWNvbicsICdBdmF0YXInLCAnUGljdHVyZSddLFxuICAgICAgICAvLyBHZW5lcmljIG1ldGFkYXRhIHBhdHRlcm5zICh1bml2ZXJzYWwpXG4gICAgICAgIG1ldGE6IFsnQ29kZScsICdTbHVnJywgJ0tleScsICdJZGVudGlmaWVyJywgJ1JlbW90ZUlkJ11cbiAgICB9LFxuICAgIHByZWZpeGVzOiBbXG4gICAgICAgIC8vIEdlbmVyaWMgcmVsYXRpb25hbCBwYXR0ZXJucyAodW5pdmVyc2FsKVxuICAgICAgICAncGFyZW50JywgJ2NoaWxkJyxcbiAgICAgICAgJ3NvdXJjZScsICd0YXJnZXQnLCAnZGVzdGluYXRpb24nLFxuICAgICAgICAncHJpbWFyeScsICdzZWNvbmRhcnknLCAndGVydGlhcnknLFxuICAgICAgICAnbWFpbicsICdhbHRlcm5hdGUnLCAnZmFsbGJhY2snLFxuICAgICAgICAnb3duZXInLCAnY3JlYXRvcicsICdtb2RpZmllcicsXG4gICAgICAgICdmaXJzdCcsICdzZWNvbmQnLCAndGhpcmQnLCAnbGFzdCcsXG4gICAgICAgICdwcmV2aW91cycsICduZXh0JywgJ2N1cnJlbnQnLFxuICAgICAgICAnb2xkJywgJ25ldycsXG4gICAgICAgICdvcmlnaW5hbCcsICdjb3B5JywgJ2RyYWZ0JyxcbiAgICAgICAgXG4gICAgICAgIC8vIEdlbmVyaWMgZGlyZWN0aW9uYWwgcGF0dGVybnMgKHVuaXZlcnNhbClcbiAgICAgICAgJ2hvbWUnLCAnYXdheScsXG4gICAgICAgICdsZWZ0JywgJ3JpZ2h0JyxcbiAgICAgICAgJ3RvcCcsICdib3R0b20nLFxuICAgICAgICAnaW5uZXInLCAnb3V0ZXInLFxuICAgICAgICBcbiAgICAgICAgLy8gR2VuZXJpYyBjb21wZXRpdGl2ZSBwYXR0ZXJucyAodW5pdmVyc2FsKVxuICAgICAgICAnd2lubmVyJywgJ2xvc2VyJyxcbiAgICAgICAgJ2NvbXBldGl0b3InLCAnb3Bwb25lbnQnXG4gICAgICAgIFxuICAgICAgICAvLyBOT1RFOiBEb21haW4tc3BlY2lmaWMgcHJlZml4ZXMgKHBsYXllciwgdGVhbSwgY3VzdG9tZXIsIG9yZGVyLCBldGMuKVxuICAgICAgICAvLyBzaG91bGQgYmUgcHJvdmlkZWQgdmlhIHVpQ29uZmlnT3B0aW9ucyBpbiB5b3VyIGFwcGxpY2F0aW9uJ3MgYmFja2VuZFxuICAgIF0sXG4gICAgdGVtcGxhdGVTdHlsZTogJ3NpbXBsZScsXG4gICAgY29uZmlkZW5jZVRocmVzaG9sZDogJ21lZGl1bScsXG4gICAgZGVidWc6IGZhbHNlXG59O1xuXG4vKipcbiAqIE1lcmdlIGNvbmZpZ3VyYXRpb25zIHdpdGggcHJpb3JpdHk6IGhpbnRzID4gZW50aXR5ID4gZ2xvYmFsID4gZGVmYXVsdHNcbiAqL1xuZnVuY3Rpb24gbWVyZ2VEZXRlY3Rpb25Db25maWdzKFxuICAgIGdsb2JhbENvbmZpZz86IElEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25Db25maWcsXG4gICAgZW50aXR5Q29uZmlnPzogSUR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbkNvbmZpZyxcbiAgICByZWxhdGlvbkhpbnRzPzoge1xuICAgICAgICBwcmVmZXJyZWRGaWVsZHM/OiBzdHJpbmdbXTtcbiAgICAgICAgZXhjbHVkZUZpZWxkcz86IHN0cmluZ1tdO1xuICAgICAgICB0ZW1wbGF0ZVN0eWxlPzogJ3NpbXBsZScgfCAnY29tcG9zaXRlJztcbiAgICB9XG4pOiBSZXF1aXJlZDxJRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uQ29uZmlnPiAmIHsgcHJlZmVycmVkRmllbGRzPzogc3RyaW5nW107IGV4Y2x1ZGVGaWVsZHM/OiBzdHJpbmdbXSB9IHtcbiAgICAvLyBTdGFydCB3aXRoIGRlZmF1bHRzXG4gICAgbGV0IG1lcmdlZCA9IHsgLi4uREVGQVVMVF9ERVRFQ1RJT05fQ09ORklHIH07XG4gICAgXG4gICAgLy8gQXBwbHkgZ2xvYmFsIGNvbmZpZ1xuICAgIGlmIChnbG9iYWxDb25maWcpIHtcbiAgICAgICAgbWVyZ2VkID0ge1xuICAgICAgICAgICAgLi4ubWVyZ2VkLFxuICAgICAgICAgICAgLi4uZ2xvYmFsQ29uZmlnLFxuICAgICAgICAgICAgc3VmZml4ZXM6IHsgLi4ubWVyZ2VkLnN1ZmZpeGVzLCAuLi5nbG9iYWxDb25maWcuc3VmZml4ZXMgfSxcbiAgICAgICAgICAgIHByZWZpeGVzOiBnbG9iYWxDb25maWcucHJlZml4ZXMgfHwgbWVyZ2VkLnByZWZpeGVzXG4gICAgICAgIH07XG4gICAgfVxuICAgIFxuICAgIC8vIEFwcGx5IGVudGl0eSBjb25maWcgKGhpZ2hlciBwcmlvcml0eSlcbiAgICBpZiAoZW50aXR5Q29uZmlnKSB7XG4gICAgICAgIG1lcmdlZCA9IHtcbiAgICAgICAgICAgIC4uLm1lcmdlZCxcbiAgICAgICAgICAgIC4uLmVudGl0eUNvbmZpZyxcbiAgICAgICAgICAgIHN1ZmZpeGVzOiB7IC4uLm1lcmdlZC5zdWZmaXhlcywgLi4uZW50aXR5Q29uZmlnLnN1ZmZpeGVzIH0sXG4gICAgICAgICAgICBwcmVmaXhlczogZW50aXR5Q29uZmlnLnByZWZpeGVzIHx8IG1lcmdlZC5wcmVmaXhlc1xuICAgICAgICB9O1xuICAgIH1cbiAgICBcbiAgICAvLyBBcHBseSByZWxhdGlvbiBoaW50cyAoaGlnaGVzdCBwcmlvcml0eSlcbiAgICBjb25zdCByZXN1bHQ6IGFueSA9IHsgLi4ubWVyZ2VkIH07XG4gICAgaWYgKHJlbGF0aW9uSGludHMpIHtcbiAgICAgICAgaWYgKHJlbGF0aW9uSGludHMudGVtcGxhdGVTdHlsZSkge1xuICAgICAgICAgICAgcmVzdWx0LnRlbXBsYXRlU3R5bGUgPSByZWxhdGlvbkhpbnRzLnRlbXBsYXRlU3R5bGU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlbGF0aW9uSGludHMucHJlZmVycmVkRmllbGRzKSB7XG4gICAgICAgICAgICByZXN1bHQucHJlZmVycmVkRmllbGRzID0gcmVsYXRpb25IaW50cy5wcmVmZXJyZWRGaWVsZHM7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlbGF0aW9uSGludHMuZXhjbHVkZUZpZWxkcykge1xuICAgICAgICAgICAgcmVzdWx0LmV4Y2x1ZGVGaWVsZHMgPSByZWxhdGlvbkhpbnRzLmV4Y2x1ZGVGaWVsZHM7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLyoqXG4gKiBQYXJzZSByZWxhdGlvbiBmaWVsZCB0byBleHRyYWN0IHByZWZpeCBhbmQgYmFzZSBuYW1lLlxuICogXG4gKiBFeGFtcGxlczpcbiAqIC0gJ3RlYW1JZCcg4oaSIHsgYmFzZU5hbWU6ICdUZWFtJywgaGFzSWRTdWZmaXg6IHRydWUgfVxuICogLSAnaG9tZVRlYW1JZCcg4oaSIHsgcHJlZml4OiAnaG9tZScsIGJhc2VOYW1lOiAnVGVhbScsIGhhc0lkU3VmZml4OiB0cnVlIH1cbiAqIC0gJ2NvbXBldGl0b3IxVGVhbUlkJyDihpIgeyBwcmVmaXg6ICdjb21wZXRpdG9yMScsIGJhc2VOYW1lOiAnVGVhbScsIGhhc0lkU3VmZml4OiB0cnVlIH1cbiAqIC0gJ3Nwb3J0JyDihpIgeyBiYXNlTmFtZTogJ3Nwb3J0JywgaGFzSWRTdWZmaXg6IGZhbHNlIH1cbiAqL1xuZnVuY3Rpb24gcGFyc2VSZWxhdGlvbkZpZWxkKFxuICAgIGZpZWxkSWQ6IHN0cmluZyxcbiAgICBwcmVmaXhlczogc3RyaW5nW11cbik6IFBhcnNlZFJlbGF0aW9uRmllbGQge1xuICAgIC8vIEJ1aWxkIHJlZ2V4IGZvciBwcmVmaXggZGV0ZWN0aW9uOiBeKHByZWZpeDF8cHJlZml4MnwuLi4pKFxcXFxkKikoLispJFxuICAgIC8vIFVzZSBjYXNlLWluc2Vuc2l0aXZlIG1hdGNoaW5nXG4gICAgY29uc3QgcHJlZml4UGF0dGVybiA9IG5ldyBSZWdFeHAoXG4gICAgICAgIGBeKCR7cHJlZml4ZXMuam9pbignfCcpfSkoXFxcXGQqKSguKykkYCxcbiAgICAgICAgJ2knXG4gICAgKTtcbiAgICBcbiAgICBjb25zdCBtYXRjaCA9IGZpZWxkSWQubWF0Y2gocHJlZml4UGF0dGVybik7XG4gICAgXG4gICAgaWYgKG1hdGNoKSB7XG4gICAgICAgIGNvbnN0IFssIHByZWZpeCwgbnVtLCByZXN0XSA9IG1hdGNoO1xuICAgICAgICBjb25zdCBoYXNJZFN1ZmZpeCA9IHJlc3QudG9Mb3dlckNhc2UoKS5lbmRzV2l0aCgnaWQnKTtcbiAgICAgICAgY29uc3QgYmFzZU5hbWUgPSBoYXNJZFN1ZmZpeCBcbiAgICAgICAgICAgID8gcmVzdC5zdWJzdHJpbmcoMCwgcmVzdC5sZW5ndGggLSAyKVxuICAgICAgICAgICAgOiByZXN0O1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHByZWZpeDogcHJlZml4ICsgbnVtLCAgLy8gJ2hvbWUnIG9yICdjb21wZXRpdG9yMSdcbiAgICAgICAgICAgIGJhc2VOYW1lLFxuICAgICAgICAgICAgaGFzSWRTdWZmaXgsXG4gICAgICAgICAgICBvcmlnaW5hbEZpZWxkOiBmaWVsZElkXG4gICAgICAgIH07XG4gICAgfVxuICAgIFxuICAgIC8vIE5vIHByZWZpeCBkZXRlY3RlZFxuICAgIGNvbnN0IGhhc0lkU3VmZml4ID0gZmllbGRJZC50b0xvd2VyQ2FzZSgpLmVuZHNXaXRoKCdpZCcpO1xuICAgIGNvbnN0IGJhc2VOYW1lID0gaGFzSWRTdWZmaXggXG4gICAgICAgID8gZmllbGRJZC5zdWJzdHJpbmcoMCwgZmllbGRJZC5sZW5ndGggLSAyKVxuICAgICAgICA6IGZpZWxkSWQ7XG4gICAgXG4gICAgcmV0dXJuIHtcbiAgICAgICAgYmFzZU5hbWUsXG4gICAgICAgIGhhc0lkU3VmZml4LFxuICAgICAgICBvcmlnaW5hbEZpZWxkOiBmaWVsZElkXG4gICAgfTtcbn1cblxuLyoqXG4gKiBHZW5lcmF0ZSBzZWFyY2ggcGF0dGVybnMgZm9yIGNhbmRpZGF0ZSBmaWVsZCBuYW1lcy5cbiAqIFxuICogUHJpb3JpdHk6XG4gKiAxLiBQcmVmZXJyZWQgZmllbGRzIChmcm9tIGhpbnRzKVxuICogMi4gRXhhY3QgcHJlZml4IG1hdGNoOiB7cHJlZml4fXtiYXNlTmFtZX17c3VmZml4fVxuICogMy4gRW50aXR5IG5hbWUgbWF0Y2g6IHtlbnRpdHlOYW1lfXtzdWZmaXh9XG4gKiA0LiBCYXNlIG5hbWUgbWF0Y2g6IHtiYXNlTmFtZX17c3VmZml4fVxuICovXG5mdW5jdGlvbiBnZW5lcmF0ZVNlYXJjaFBhdHRlcm5zKFxuICAgIHBhcnNlZDogUGFyc2VkUmVsYXRpb25GaWVsZCxcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgc3VmZml4ZXM6IHN0cmluZ1tdLFxuICAgIHByZWZlcnJlZEZpZWxkcz86IHN0cmluZ1tdXG4pOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgcGF0dGVybnM6IHN0cmluZ1tdID0gW107XG4gICAgY29uc3QgZW50aXR5TmFtZUxvd2VyID0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IGJhc2VOYW1lTG93ZXIgPSBwYXJzZWQuYmFzZU5hbWUudG9Mb3dlckNhc2UoKTtcbiAgICBcbiAgICAvLyBQcmlvcml0eSAxOiBQcmVmZXJyZWQgZmllbGRzIChleGFjdCBtYXRjaClcbiAgICBpZiAocHJlZmVycmVkRmllbGRzICYmIHByZWZlcnJlZEZpZWxkcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goLi4ucHJlZmVycmVkRmllbGRzKTtcbiAgICB9XG4gICAgXG4gICAgLy8gUHJpb3JpdHkgMjogV2l0aCBwcmVmaXggKGUuZy4sIGhvbWVUZWFtTmFtZSwgYXdheVRlYW1OYW1lKVxuICAgIGlmIChwYXJzZWQucHJlZml4KSB7XG4gICAgICAgIGNvbnN0IHByZWZpeExvd2VyID0gcGFyc2VkLnByZWZpeC50b0xvd2VyQ2FzZSgpO1xuICAgICAgICBmb3IgKGNvbnN0IHN1ZmZpeCBvZiBzdWZmaXhlcykge1xuICAgICAgICAgICAgcGF0dGVybnMucHVzaChgJHtwcmVmaXhMb3dlcn0ke2Jhc2VOYW1lTG93ZXJ9JHtzdWZmaXgudG9Mb3dlckNhc2UoKX1gKTtcbiAgICAgICAgICAgIHBhdHRlcm5zLnB1c2goYCR7cHJlZml4TG93ZXJ9JHtlbnRpdHlOYW1lTG93ZXJ9JHtzdWZmaXgudG9Mb3dlckNhc2UoKX1gKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICAvLyBQcmlvcml0eSAzOiBFbnRpdHkgbmFtZSAoZS5nLiwgdGVhbU5hbWUgZm9yIHJlbGF0aW9uIHRvICd0ZWFtJylcbiAgICBmb3IgKGNvbnN0IHN1ZmZpeCBvZiBzdWZmaXhlcykge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGAke2VudGl0eU5hbWVMb3dlcn0ke3N1ZmZpeC50b0xvd2VyQ2FzZSgpfWApO1xuICAgIH1cbiAgICBcbiAgICAvLyBQcmlvcml0eSA0OiBCYXNlIG5hbWUgKGUuZy4sIHRlYW1OYW1lIGZvciAndGVhbUlkJylcbiAgICBmb3IgKGNvbnN0IHN1ZmZpeCBvZiBzdWZmaXhlcykge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGAke2Jhc2VOYW1lTG93ZXJ9JHtzdWZmaXgudG9Mb3dlckNhc2UoKX1gKTtcbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIHBhdHRlcm5zO1xufVxuXG4vKipcbiAqIFNlYXJjaCBmb3IgZmllbGRzIG1hdGNoaW5nIHBhdHRlcm5zLCBleGNsdWRpbmcgc3BlY2lmaWVkIGZpZWxkcy5cbiAqL1xuZnVuY3Rpb24gc2VhcmNoRmllbGRzQnlQYXR0ZXJucyhcbiAgICBhbGxQcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSxcbiAgICBwYXR0ZXJuczogc3RyaW5nW10sXG4gICAgZXhjbHVkZUZpZWxkcz86IHN0cmluZ1tdXG4pOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgZXhjbHVkZVNldCA9IG5ldyBTZXQoZXhjbHVkZUZpZWxkcz8ubWFwKGYgPT4gZi50b0xvd2VyQ2FzZSgpKSB8fCBbXSk7XG4gICAgY29uc3QgZm91bmQ6IHN0cmluZ1tdID0gW107XG4gICAgY29uc3Qgc2Vlbkxvd2VyID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgXG4gICAgZm9yIChjb25zdCBwYXR0ZXJuIG9mIHBhdHRlcm5zKSB7XG4gICAgICAgIGNvbnN0IHBhdHRlcm5Mb3dlciA9IHBhdHRlcm4udG9Mb3dlckNhc2UoKTtcbiAgICAgICAgXG4gICAgICAgIC8vIFNraXAgaWYgYWxyZWFkeSBmb3VuZCBvciBleGNsdWRlZFxuICAgICAgICBpZiAoc2Vlbkxvd2VyLmhhcyhwYXR0ZXJuTG93ZXIpIHx8IGV4Y2x1ZGVTZXQuaGFzKHBhdHRlcm5Mb3dlcikpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBGaW5kIG1hdGNoaW5nIGZpZWxkIChjYXNlLWluc2Vuc2l0aXZlKVxuICAgICAgICBjb25zdCBtYXRjaCA9IGFsbFByb3BlcnRpZXMuZmluZChwID0+IFxuICAgICAgICAgICAgcC5pZD8udG9Mb3dlckNhc2UoKSA9PT0gcGF0dGVybkxvd2VyICYmXG4gICAgICAgICAgICAhZXhjbHVkZVNldC5oYXMocC5pZC50b0xvd2VyQ2FzZSgpKVxuICAgICAgICApO1xuICAgICAgICBcbiAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgICBmb3VuZC5wdXNoKG1hdGNoLmlkKTtcbiAgICAgICAgICAgIHNlZW5Mb3dlci5hZGQobWF0Y2guaWQudG9Mb3dlckNhc2UoKSk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIGZvdW5kO1xufVxuXG4vKipcbiAqIENhbGN1bGF0ZSBjb25maWRlbmNlIGJhc2VkIG9uIGRldGVjdGlvbiBtZXRob2QgYW5kIHBhdHRlcm5cbiAqL1xuZnVuY3Rpb24gY2FsY3VsYXRlQ29uZmlkZW5jZShcbiAgICBkZXRlY3RlZEZpZWxkOiBzdHJpbmcsXG4gICAgcGFyc2VkOiBQYXJzZWRSZWxhdGlvbkZpZWxkLFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBtZXRob2Q6ICdwcmVmZXJyZWQnIHwgJ3ByZWZpeCcgfCAnZW50aXR5JyB8ICdiYXNlJ1xuKTogJ2hpZ2gnIHwgJ21lZGl1bScgfCAnbG93JyB7XG4gICAgLy8gUHJlZmVycmVkIGZpZWxkcyA9IGhpZ2ggY29uZmlkZW5jZSAoZGV2ZWxvcGVyIGV4cGxpY2l0bHkgc3BlY2lmaWVkKVxuICAgIGlmIChtZXRob2QgPT09ICdwcmVmZXJyZWQnKSByZXR1cm4gJ2hpZ2gnO1xuICAgIFxuICAgIGNvbnN0IGZpZWxkTG93ZXIgPSBkZXRlY3RlZEZpZWxkLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgZW50aXR5TG93ZXIgPSBlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgYmFzZUxvd2VyID0gcGFyc2VkLmJhc2VOYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgXG4gICAgLy8gRXhhY3QgcHJlZml4ICsgZW50aXR5L2Jhc2UgbWF0Y2ggPSBoaWdoXG4gICAgaWYgKG1ldGhvZCA9PT0gJ3ByZWZpeCcpIHtcbiAgICAgICAgaWYgKGZpZWxkTG93ZXIuaW5jbHVkZXMoZW50aXR5TG93ZXIpIHx8IGZpZWxkTG93ZXIuaW5jbHVkZXMoYmFzZUxvd2VyKSkge1xuICAgICAgICAgICAgcmV0dXJuICdoaWdoJztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gJ21lZGl1bSc7XG4gICAgfVxuICAgIFxuICAgIC8vIEVudGl0eSBuYW1lIG1hdGNoID0gaGlnaFxuICAgIGlmIChtZXRob2QgPT09ICdlbnRpdHknKSByZXR1cm4gJ2hpZ2gnO1xuICAgIFxuICAgIC8vIEJhc2UgbmFtZSBtYXRjaCA9IG1lZGl1bSAoY291bGQgYmUgY29pbmNpZGVudGFsKVxuICAgIGlmIChtZXRob2QgPT09ICdiYXNlJykgcmV0dXJuICdtZWRpdW0nO1xuICAgIFxuICAgIHJldHVybiAnbG93Jztcbn1cblxuLyoqXG4gKiBHZW5lcmF0ZSB0ZW1wbGF0ZSBzdHJpbmcgZnJvbSBkZXRlY3RlZCBmaWVsZHMuXG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlVGVtcGxhdGUoXG4gICAgcHJpbWFyeUZpZWxkOiBzdHJpbmcsXG4gICAgYWxsRGV0ZWN0ZWRGaWVsZHM6IER1cGxpY2F0ZWRGaWVsZERldGVjdGlvblJlc3VsdFsnZGV0ZWN0ZWRGaWVsZHMnXSxcbiAgICB0ZW1wbGF0ZVN0eWxlOiAnc2ltcGxlJyB8ICdjb21wb3NpdGUnXG4pOiBzdHJpbmcge1xuICAgIGlmICh0ZW1wbGF0ZVN0eWxlID09PSAnc2ltcGxlJykge1xuICAgICAgICByZXR1cm4gYHske3ByaW1hcnlGaWVsZH19YDtcbiAgICB9XG4gICAgXG4gICAgLy8gQ29tcG9zaXRlOiB0cnkgdG8gaW5jbHVkZSBtZXRhIGZpZWxkIChjb2RlL3NsdWcpIGlmIGF2YWlsYWJsZVxuICAgIGlmICh0ZW1wbGF0ZVN0eWxlID09PSAnY29tcG9zaXRlJyAmJiBhbGxEZXRlY3RlZEZpZWxkcy5tZXRhICYmIGFsbERldGVjdGVkRmllbGRzLm1ldGEubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBtZXRhRmllbGQgPSBhbGxEZXRlY3RlZEZpZWxkcy5tZXRhWzBdO1xuICAgICAgICByZXR1cm4gYHske3ByaW1hcnlGaWVsZH19ICh7JHttZXRhRmllbGR9fSlgO1xuICAgIH1cbiAgICBcbiAgICAvLyBGYWxsYmFjayB0byBzaW1wbGUgaWYgbm8gbWV0YSBmaWVsZFxuICAgIHJldHVybiBgeyR7cHJpbWFyeUZpZWxkfX1gO1xufVxuXG4vKipcbiAqIEVuaGFuY2VkIHNtYXJ0IGR1cGxpY2F0ZWQgZmllbGQgZGV0ZWN0aW9uLlxuICogXG4gKiBEZXRlY3RzIGZpZWxkcyBsaWtlICd0ZWFtTmFtZScgZm9yICd0ZWFtSWQnIHJlbGF0aW9ucyB3aXRoIHN1cHBvcnQgZm9yOlxuICogLSBQcmVmaXhlcyAoaG9tZSwgYXdheSwgY29tcGV0aXRvcjEsIGV0Yy4pXG4gKiAtIE11bHRpcGxlIHN1ZmZpeGVzIChOYW1lLCBUaXRsZSwgTGFiZWwsIExvZ28sIENvZGUsIGV0Yy4pXG4gKiAtIFByZWZlcnJlZCBmaWVsZHMgYW5kIGV4Y2x1c2lvbnNcbiAqIC0gQ29uZmlkZW5jZSBzY29yaW5nXG4gKiAtIENvbXBvc2l0ZSB0ZW1wbGF0ZXNcbiAqIFxuICogQHBhcmFtIGFsbFByb3BlcnRpZXMgLSBBbGwgcHJvcGVydGllcyBpbiB0aGUgcGFyZW50IGVudGl0eVxuICogQHBhcmFtIHJlbGF0aW9uRmllbGRJZCAtIFRoZSByZWxhdGlvbiBmaWVsZCBuYW1lIChlLmcuLCAndGVhbUlkJywgJ2hvbWVUZWFtSWQnKVxuICogQHBhcmFtIHJlbGF0ZWRFbnRpdHlOYW1lIC0gUmVsYXRlZCBlbnRpdHkgbmFtZSAoZS5nLiwgJ3RlYW0nKVxuICogQHBhcmFtIGdsb2JhbENvbmZpZyAtIEdsb2JhbCBkZXRlY3Rpb24gY29uZmlndXJhdGlvblxuICogQHBhcmFtIGVudGl0eUNvbmZpZyAtIEVudGl0eS1sZXZlbCBkZXRlY3Rpb24gY29uZmlndXJhdGlvblxuICogQHBhcmFtIHJlbGF0aW9uSGludHMgLSBSZWxhdGlvbi1zcGVjaWZpYyBoaW50c1xuICogQHJldHVybnMgRGV0ZWN0aW9uIHJlc3VsdCB3aXRoIHRlbXBsYXRlIGFuZCBtZXRhZGF0YVxuICovXG5mdW5jdGlvbiBkZXRlY3REdXBsaWNhdGVkUmVsYXRpb25GaWVsZHMoXG4gICAgYWxsUHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sXG4gICAgcmVsYXRpb25GaWVsZElkOiBzdHJpbmcsXG4gICAgcmVsYXRlZEVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBnbG9iYWxDb25maWc/OiBJRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uQ29uZmlnLFxuICAgIGVudGl0eUNvbmZpZz86IElEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25Db25maWcsXG4gICAgcmVsYXRpb25IaW50cz86IHtcbiAgICAgICAgcHJlZmVycmVkRmllbGRzPzogc3RyaW5nW107XG4gICAgICAgIGV4Y2x1ZGVGaWVsZHM/OiBzdHJpbmdbXTtcbiAgICAgICAgdGVtcGxhdGVTdHlsZT86ICdzaW1wbGUnIHwgJ2NvbXBvc2l0ZSc7XG4gICAgfVxuKTogRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uUmVzdWx0IHwgdW5kZWZpbmVkIHtcbiAgICAvLyBNZXJnZSBjb25maWd1cmF0aW9uc1xuICAgIGNvbnN0IGNvbmZpZyA9IG1lcmdlRGV0ZWN0aW9uQ29uZmlncyhnbG9iYWxDb25maWcsIGVudGl0eUNvbmZpZywgcmVsYXRpb25IaW50cyk7XG4gICAgXG4gICAgLy8gQ2hlY2sgaWYgZGV0ZWN0aW9uIGlzIGVuYWJsZWRcbiAgICBpZiAoIWNvbmZpZy5lbmFibGVkKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIFxuICAgIC8vIFBhcnNlIHJlbGF0aW9uIGZpZWxkXG4gICAgY29uc3QgcGFyc2VkID0gcGFyc2VSZWxhdGlvbkZpZWxkKHJlbGF0aW9uRmllbGRJZCwgY29uZmlnLnByZWZpeGVzKTtcbiAgICBcbiAgICAvLyBTZWFyY2ggZm9yIGRpc3BsYXkgZmllbGRzIChOYW1lLCBUaXRsZSwgTGFiZWwpXG4gICAgY29uc3QgZGlzcGxheVBhdHRlcm5zID0gZ2VuZXJhdGVTZWFyY2hQYXR0ZXJucyhcbiAgICAgICAgcGFyc2VkLFxuICAgICAgICByZWxhdGVkRW50aXR5TmFtZSxcbiAgICAgICAgY29uZmlnLnN1ZmZpeGVzPy5kaXNwbGF5IHx8IFtdLFxuICAgICAgICBjb25maWcucHJlZmVycmVkRmllbGRzXG4gICAgKTtcbiAgICBjb25zdCBkaXNwbGF5RmllbGRzID0gc2VhcmNoRmllbGRzQnlQYXR0ZXJucyhhbGxQcm9wZXJ0aWVzLCBkaXNwbGF5UGF0dGVybnMsIGNvbmZpZy5leGNsdWRlRmllbGRzKTtcbiAgICBcbiAgICAvLyBTZWFyY2ggZm9yIHZpc3VhbCBmaWVsZHMgKExvZ28sIEltYWdlLCBJY29uKVxuICAgIGNvbnN0IHZpc3VhbFBhdHRlcm5zID0gZ2VuZXJhdGVTZWFyY2hQYXR0ZXJucyhcbiAgICAgICAgcGFyc2VkLFxuICAgICAgICByZWxhdGVkRW50aXR5TmFtZSxcbiAgICAgICAgY29uZmlnLnN1ZmZpeGVzPy52aXN1YWwgfHwgW11cbiAgICApO1xuICAgIGNvbnN0IHZpc3VhbEZpZWxkcyA9IHNlYXJjaEZpZWxkc0J5UGF0dGVybnMoYWxsUHJvcGVydGllcywgdmlzdWFsUGF0dGVybnMsIGNvbmZpZy5leGNsdWRlRmllbGRzKTtcbiAgICBcbiAgICAvLyBTZWFyY2ggZm9yIG1ldGEgZmllbGRzIChDb2RlLCBTbHVnLCBLZXkpXG4gICAgY29uc3QgbWV0YVBhdHRlcm5zID0gZ2VuZXJhdGVTZWFyY2hQYXR0ZXJucyhcbiAgICAgICAgcGFyc2VkLFxuICAgICAgICByZWxhdGVkRW50aXR5TmFtZSxcbiAgICAgICAgY29uZmlnLnN1ZmZpeGVzPy5tZXRhIHx8IFtdXG4gICAgKTtcbiAgICBjb25zdCBtZXRhRmllbGRzID0gc2VhcmNoRmllbGRzQnlQYXR0ZXJucyhhbGxQcm9wZXJ0aWVzLCBtZXRhUGF0dGVybnMsIGNvbmZpZy5leGNsdWRlRmllbGRzKTtcbiAgICBcbiAgICAvLyBObyBmaWVsZHMgZGV0ZWN0ZWRcbiAgICBpZiAoZGlzcGxheUZpZWxkcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgXG4gICAgLy8gRGV0ZXJtaW5lIGRldGVjdGlvbiBtZXRob2RcbiAgICBjb25zdCBwcmltYXJ5RmllbGQgPSBkaXNwbGF5RmllbGRzWzBdO1xuICAgIGxldCBtZXRob2Q6ICdwcmVmZXJyZWQnIHwgJ3ByZWZpeCcgfCAnZW50aXR5JyB8ICdiYXNlJyA9ICdiYXNlJztcbiAgICBsZXQgcGF0dGVybiA9ICd1bmtub3duJztcbiAgICBcbiAgICBpZiAoY29uZmlnLnByZWZlcnJlZEZpZWxkcyAmJiBjb25maWcucHJlZmVycmVkRmllbGRzLmluY2x1ZGVzKHByaW1hcnlGaWVsZCkpIHtcbiAgICAgICAgbWV0aG9kID0gJ3ByZWZlcnJlZCc7XG4gICAgICAgIHBhdHRlcm4gPSAncHJlZmVycmVkX2ZpZWxkJztcbiAgICB9IGVsc2UgaWYgKHBhcnNlZC5wcmVmaXggJiYgcHJpbWFyeUZpZWxkLnRvTG93ZXJDYXNlKCkuc3RhcnRzV2l0aChwYXJzZWQucHJlZml4LnRvTG93ZXJDYXNlKCkpKSB7XG4gICAgICAgIG1ldGhvZCA9ICdwcmVmaXgnO1xuICAgICAgICBwYXR0ZXJuID0gYCR7cGFyc2VkLnByZWZpeH17ZW50aXR5fXtzdWZmaXh9YDtcbiAgICB9IGVsc2UgaWYgKHByaW1hcnlGaWVsZC50b0xvd2VyQ2FzZSgpLnN0YXJ0c1dpdGgocmVsYXRlZEVudGl0eU5hbWUudG9Mb3dlckNhc2UoKSkpIHtcbiAgICAgICAgbWV0aG9kID0gJ2VudGl0eSc7XG4gICAgICAgIHBhdHRlcm4gPSBge2VudGl0eX17c3VmZml4fWA7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgbWV0aG9kID0gJ2Jhc2UnO1xuICAgICAgICBwYXR0ZXJuID0gYHtiYXNlfXtzdWZmaXh9YDtcbiAgICB9XG4gICAgXG4gICAgLy8gQ2FsY3VsYXRlIGNvbmZpZGVuY2VcbiAgICBjb25zdCBjb25maWRlbmNlID0gY2FsY3VsYXRlQ29uZmlkZW5jZShwcmltYXJ5RmllbGQsIHBhcnNlZCwgcmVsYXRlZEVudGl0eU5hbWUsIG1ldGhvZCk7XG4gICAgXG4gICAgLy8gQ2hlY2sgY29uZmlkZW5jZSB0aHJlc2hvbGRcbiAgICBjb25zdCB0aHJlc2hvbGRPcmRlciA9IHsgbG93OiAwLCBtZWRpdW06IDEsIGhpZ2g6IDIgfTtcbiAgICBpZiAodGhyZXNob2xkT3JkZXJbY29uZmlkZW5jZV0gPCB0aHJlc2hvbGRPcmRlcltjb25maWcuY29uZmlkZW5jZVRocmVzaG9sZF0pIHtcbiAgICAgICAgLy8gQ29uZmlkZW5jZSB0b28gbG93XG4gICAgICAgIGlmIChjb25maWcuZGVidWcpIHtcbiAgICAgICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW0R1cGxpY2F0ZWRGaWVsZERldGVjdGlvbl0gU2tpcHBpbmcgJHtyZWxhdGlvbkZpZWxkSWR9OiBjb25maWRlbmNlICR7Y29uZmlkZW5jZX0gPCB0aHJlc2hvbGQgJHtjb25maWcuY29uZmlkZW5jZVRocmVzaG9sZH1gKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBcbiAgICAvLyBHZW5lcmF0ZSB0ZW1wbGF0ZVxuICAgIGNvbnN0IHRlbXBsYXRlID0gZ2VuZXJhdGVUZW1wbGF0ZShcbiAgICAgICAgcHJpbWFyeUZpZWxkLFxuICAgICAgICB7IGRpc3BsYXk6IGRpc3BsYXlGaWVsZHMsIHZpc3VhbDogdmlzdWFsRmllbGRzLCBtZXRhOiBtZXRhRmllbGRzIH0sXG4gICAgICAgIGNvbmZpZy50ZW1wbGF0ZVN0eWxlXG4gICAgKTtcbiAgICBcbiAgICAvLyBEZWJ1ZyBsb2dnaW5nXG4gICAgaWYgKGNvbmZpZy5kZWJ1Zykge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25dICR7cmVsYXRpb25GaWVsZElkfSDihpIgJHt0ZW1wbGF0ZX0gKGNvbmZpZGVuY2U6ICR7Y29uZmlkZW5jZX0sIG1ldGhvZDogJHttZXRob2R9KWApO1xuICAgIH1cbiAgICBcbiAgICByZXR1cm4ge1xuICAgICAgICBwcmltYXJ5RmllbGQsXG4gICAgICAgIHRlbXBsYXRlLFxuICAgICAgICBkZXRlY3RlZEZpZWxkczoge1xuICAgICAgICAgICAgZGlzcGxheTogZGlzcGxheUZpZWxkcyxcbiAgICAgICAgICAgIHZpc3VhbDogdmlzdWFsRmllbGRzLmxlbmd0aCA+IDAgPyB2aXN1YWxGaWVsZHMgOiB1bmRlZmluZWQsXG4gICAgICAgICAgICBtZXRhOiBtZXRhRmllbGRzLmxlbmd0aCA+IDAgPyBtZXRhRmllbGRzIDogdW5kZWZpbmVkXG4gICAgICAgIH0sXG4gICAgICAgIGNvbmZpZGVuY2UsXG4gICAgICAgIG1ldGhvZCxcbiAgICAgICAgcGF0dGVyblxuICAgIH07XG59XG5cbi8qKlxuICogTGVnYWN5IHdyYXBwZXIgZnVuY3Rpb24gZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHkuXG4gKiBcbiAqIEBkZXByZWNhdGVkIFVzZSBkZXRlY3REdXBsaWNhdGVkUmVsYXRpb25GaWVsZHMoKSBmb3IgcmljaGVyIHJlc3VsdHNcbiAqL1xuZnVuY3Rpb24gZGV0ZWN0RHVwbGljYXRlZFJlbGF0aW9uRmllbGRUZW1wbGF0ZShcbiAgICBhbGxQcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSxcbiAgICByZWxhdGlvbkZpZWxkSWQ6IHN0cmluZyxcbiAgICByZWxhdGVkRW50aXR5TmFtZTogc3RyaW5nXG4pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IHJlc3VsdCA9IGRldGVjdER1cGxpY2F0ZWRSZWxhdGlvbkZpZWxkcyhcbiAgICAgICAgYWxsUHJvcGVydGllcyxcbiAgICAgICAgcmVsYXRpb25GaWVsZElkLFxuICAgICAgICByZWxhdGVkRW50aXR5TmFtZVxuICAgICk7XG4gICAgcmV0dXJuIHJlc3VsdD8udGVtcGxhdGU7XG59XG5cbi8qKlxuICogR2VuZXJhdGUgc21hcnQgZmFsbGJhY2sgY29uZmlndXJhdGlvbiBmb3IgcmVsYXRpb24gZGlzcGxheSB3aGVuIG9ubHkgSUQgaXMgYXZhaWxhYmxlLlxuICogVXNlcyBlbnRpdHkgbWV0YWRhdGEgKGljb24sIGVudGl0eU5hbWVQbHVyYWwpIHRvIGNyZWF0ZSB1c2VyLWZyaWVuZGx5IGZhbGxiYWNrIHRleHQuXG4gKiBcbiAqIEBwYXJhbSBlbnRpdHlOYW1lIC0gUmVsYXRlZCBlbnRpdHkgbmFtZSAoZS5nLiwgJ3RlYW0nKVxuICogQHBhcmFtIGlkRmllbGQgLSBJRCBmaWVsZCBuYW1lIChlLmcuLCAndGVhbUlkJylcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gRW50aXR5IHNlcnZpY2UgdG8gZ2V0IG1ldGFkYXRhIGZyb21cbiAqIEByZXR1cm5zIEZhbGxiYWNrIGNvbmZpZ3VyYXRpb24gd2l0aCB0ZW1wbGF0ZSwgbGlua1RleHQsIGFuZCBtb2RhbEJ1dHRvblRleHRcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIEZvciBhIHRlYW0gcmVsYXRpb25cbiAqIGdlbmVyYXRlUmVsYXRpb25GYWxsYmFjaygndGVhbScsICd0ZWFtSWQnLCB0ZWFtU2VydmljZSlcbiAqIC8vIFJldHVybnM6IHtcbiAqIC8vICAgdGVtcGxhdGU6ICdUZWFtOiB7dGVhbUlkfScsXG4gKiAvLyAgIGxpbmtUZXh0OiAnVmlldyBUZWFtJyxcbiAqIC8vICAgbW9kYWxCdXR0b25UZXh0OiAnVGVhbSBEZXRhaWxzJ1xuICogLy8gfVxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVSZWxhdGlvbkZhbGxiYWNrKFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBpZEZpZWxkOiBzdHJpbmcsXG4gICAgZW50aXR5U2VydmljZT86IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT5cbik6IE5vbk51bGxhYmxlPElSZWxhdGlvbkZpZWxkQ29uZmlnWydkaXNwbGF5Q29uZmlnJ10+WydmYWxsYmFjayddIHtcbiAgICAvLyBUcnkgdG8gZ2V0IGVudGl0eSBtZXRhZGF0YSBmb3IgYmV0dGVyIGZhbGxiYWNrIHRleHRcbiAgICBjb25zdCBlbnRpdHlNZXRhZGF0YSA9IGVudGl0eVNlcnZpY2U/LmdldEVudGl0eVNjaGVtYT8uKCkubW9kZWw7XG4gICAgY29uc3QgZGlzcGxheU5hbWUgPSBlbnRpdHlNZXRhZGF0YT8uZW50aXR5TmFtZVBsdXJhbCB8fCBwYXNjYWxDYXNlKGVudGl0eU5hbWUpO1xuICAgIFxuICAgIHJldHVybiB7XG4gICAgICAgIC8vIEJhY2tlbmQgcHJlLWdlbmVyYXRlcyBmYWxsYmFjayB0ZW1wbGF0ZSAoaW50ZW50aW9uYWxseSBzdHJpbmctb25seSwgbm90IFRlbXBsYXRlIHR5cGUpXG4gICAgICAgIC8vIEZyb250ZW5kIHdpbGwgdXNlIHRoaXMgd2hlbiBvbmx5IElEIGlzIGF2YWlsYWJsZVxuICAgICAgICB0ZW1wbGF0ZTogYCR7ZGlzcGxheU5hbWV9OiB7JHtpZEZpZWxkfX1gLCAgLy8gZS5nLiwgXCJUZWFtOiB7dGVhbUlkfVwiXG4gICAgICAgIGxpbmtUZXh0OiBgVmlldyAke2Rpc3BsYXlOYW1lfWAsICAgICAgICAgICAvLyBlLmcuLCBcIlZpZXcgVGVhbVwiXG4gICAgICAgIG1vZGFsQnV0dG9uVGV4dDogYCR7ZGlzcGxheU5hbWV9IERldGFpbHNgICAvLyBlLmcuLCBcIlRlYW0gRGV0YWlsc1wiXG4gICAgfTtcbn1cblxuLyoqXG4gKiBMYWJlbCBmaWVsZCBkZXRlY3Rpb24gcmVzdWx0IHdpdGggY29uZmlkZW5jZSBzY29yaW5nXG4gKi9cbmludGVyZmFjZSBMYWJlbEZpZWxkRGV0ZWN0aW9uUmVzdWx0IHtcbiAgICBmaWVsZDogc3RyaW5nO1xuICAgIGNvbmZpZGVuY2U6ICdoaWdoJyB8ICdtZWRpdW0nOyAgLy8gT25seSBoaWdoIG9yIG1lZGl1bSAtIG5vIGxvdyBjb25maWRlbmNlIHJlc3VsdHMgcmV0dXJuZWRcbiAgICBtZXRob2Q6ICdtZXRhZGF0YScgfCAnY29tbW9uLXBhdHRlcm4nIHwgJ2VudGl0eS1wYXR0ZXJuJyB8ICdzdWZmaXgtcGF0dGVybic7XG59XG5cbi8qKlxuICogU21hcnQgbGFiZWwgZmllbGQgZGV0ZWN0aW9uIGZvciBlbnRpdHkgb3B0aW9ucy5cbiAqIFVzZXMgZ2VuZXJpYyBwYXR0ZXJucyB0byBmaW5kIGRpc3BsYXkgZmllbGRzIHRoYXQgYXJlIGFjdHVhbCBpZGVudGlmaWVycy9uYW1lcy5cbiAqIFxuICogKipISUdITFkgQ09OU0VSVkFUSVZFKio6IE9ubHkgcmV0dXJucyBmaWVsZHMgdGhhdCBhcmUgY2xlYXJseSBtZWFudCBmb3IgZGlzcGxheS5cbiAqIFJldHVybnMgdW5kZWZpbmVkIGlmIG5vIHByb3BlciBuYW1lIGZpZWxkIGlzIGZvdW5kIC0gYmV0dGVyIHRvIHNob3cgSUQgdGhhbiBjb25mdXNlIHVzZXJzLlxuICogXG4gKiBEZXRlY3Rpb24gb3JkZXIgKGFsbCBISUdIIG9yIE1FRElVTSBjb25maWRlbmNlKTpcbiAqIDEuIEVudGl0eSBtZXRhZGF0YSAoZW50aXR5TmFtZUF0dHJpYnV0ZSkgLSBISUdIIGNvbmZpZGVuY2VcbiAqIDIuIENvbW1vbiBkaXNwbGF5IGZpZWxkIHBhdHRlcm5zIChuYW1lLCB0aXRsZSwgbGFiZWwsIGRpc3BsYXlOYW1lKSAtIEhJR0ggY29uZmlkZW5jZSAgXG4gKiAzLiBFbnRpdHktc3BlY2lmaWMgcGF0dGVybnMgKHtlbnRpdHlOYW1lfU5hbWUsIHtlbnRpdHlOYW1lfVRpdGxlKSAtIEhJR0ggY29uZmlkZW5jZVxuICogNC4gRmllbGRzIGVuZGluZyB3aXRoIG5hbWUtbGlrZSBzdWZmaXhlcyAoTmFtZSwgVGl0bGUsIExhYmVsLCBDb2RlKSAtIE1FRElVTSBjb25maWRlbmNlXG4gKiBcbiAqICoqTk8gRkFMTEJBQ0sqKjogSWYgbm9uZSBvZiB0aGUgYWJvdmUgbWF0Y2gsIHJldHVybnMgdW5kZWZpbmVkLlxuICogV2UgZG8gTk9UIHBpY2sgZ2VuZXJpYyBmaWVsZHMgbGlrZSAnc3RhdHVzJywgJ3R5cGUnLCBvciByYW5kb20gZW51bXMvc3RyaW5ncy5cbiAqIFxuICogV2h5IG5vIGZhbGxiYWNrP1xuICogLSBTaG93aW5nIFwiYWN0aXZlXCIvXCJjYW5jZWxsZWRcIiBmb3Igc3Vic2NyaXB0aW9ucyBpcyBjb25mdXNpbmcgKHdoaWNoIHN1YnNjcmlwdGlvbj8pXG4gKiAtIFNob3dpbmcgXCJjcmVkaXRfY2FyZFwiL1wicGF5cGFsXCIgZm9yIHBheW1lbnQgbWV0aG9kcyBpcyBub3QgYW4gaWRlbnRpZmllclxuICogLSBCZXR0ZXIgdG8gc2hvdyBzdWJzY3JpcHRpb25JZCB0aGFuIG1pc2xlYWRpbmcgZmllbGRzXG4gKiBcbiAqIEZvciBlbnRpdGllcyB3aXRob3V0IG5hbWUgZmllbGRzLCB1c2Ugb25lIG9mOlxuICogLSBTZXQgZW50aXR5TmFtZUF0dHJpYnV0ZSBpbiBzY2hlbWEgbWV0YWRhdGFcbiAqIC0gVXNlIG9wdGlvbk1hcHBpbmcgaW4gcmVsYXRpb24gY29uZmlnXG4gKiAtIExldCBpdCBmYWxsIGJhY2sgdG8gSUQgKGNsZWFyZXN0IG9wdGlvbilcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIEVudGl0aWVzIHdpdGggY2xlYXIgbmFtZSBmaWVsZHMgLSBERVRFQ1RFRCDinIVcbiAqIFRlYW0g4oaSIHRlYW1OYW1lIChQcmlvcml0eSAzLCBISUdIIGNvbmZpZGVuY2UpXG4gKiBVc2VyIOKGkiBuYW1lIChQcmlvcml0eSAyLCBISUdIIGNvbmZpZGVuY2UpXG4gKiBQb3N0IOKGkiBwb3N0VGl0bGUgKFByaW9yaXR5IDQsIE1FRElVTSBjb25maWRlbmNlKVxuICogXG4gKiBAZXhhbXBsZSAgXG4gKiAvLyBFbnRpdGllcyB3aXRob3V0IG5hbWUgZmllbGRzIC0gUkVUVVJOUyB1bmRlZmluZWQg4pyFXG4gKiBTdWJzY3JpcHRpb24g4oaSIHVuZGVmaW5lZCAoZmFsbHMgYmFjayB0byBzdWJzY3JpcHRpb25JZCAtIGNsZWFyISlcbiAqIFBheW1lbnRNZXRob2Qg4oaSIHVuZGVmaW5lZCAoZmFsbHMgYmFjayB0byBwYXltZW50TWV0aG9kSWQgLSBjbGVhciEpXG4gKiBBdWRpdExvZyDihpIgdW5kZWZpbmVkIChmYWxscyBiYWNrIHRvIGF1ZGl0TG9nSWQgLSBjbGVhciEpXG4gKiBcbiAqIEBwYXJhbSBzY2hlbWEgLSBFbnRpdHkgc2NoZW1hXG4gKiBAcGFyYW0gZW50aXR5TmFtZSAtIEVudGl0eSBuYW1lIChlLmcuLCAndGVhbScsICd1c2VyJylcbiAqIEBwYXJhbSBvcHRpb25zIC0gRGV0ZWN0aW9uIG9wdGlvbnNcbiAqIEByZXR1cm5zIEJlc3QgbGFiZWwgZmllbGQgbmFtZSBvciB1bmRlZmluZWQgKHdpbGwgZmFsbCBiYWNrIHRvIElEIGZpZWxkKVxuICovXG5mdW5jdGlvbiBmaW5kTGFiZWxGaWVsZChcbiAgICBzY2hlbWE6IEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PiwgXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIG9wdGlvbnM/OiB7XG4gICAgICAgIC8qKiBNaW5pbXVtIGNvbmZpZGVuY2UgbGV2ZWwgcmVxdWlyZWQgKGRlZmF1bHQ6ICdtZWRpdW0nKSAqL1xuICAgICAgICBtaW5Db25maWRlbmNlPzogJ2hpZ2gnIHwgJ21lZGl1bSc7XG4gICAgICAgIC8qKiBFbmFibGUgZGVidWcgbG9nZ2luZyAoZGVmYXVsdDogZmFsc2UpICovXG4gICAgICAgIGRlYnVnPzogYm9vbGVhbjtcbiAgICB9XG4pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IG1pbkNvbmZpZGVuY2UgPSBvcHRpb25zPy5taW5Db25maWRlbmNlIHx8ICdtZWRpdW0nO1xuICAgIGNvbnN0IGRlYnVnID0gb3B0aW9ucz8uZGVidWcgfHwgZmFsc2U7XG4gICAgXG4gICAgbGV0IHJlc3VsdDogTGFiZWxGaWVsZERldGVjdGlvblJlc3VsdCB8IHVuZGVmaW5lZDtcbiAgICBcbiAgICAvLyBHZXQgYWxsIGF0dHJpYnV0ZXMgZnJvbSBzY2hlbWFcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gc2NoZW1hLmF0dHJpYnV0ZXM7XG4gICAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSBPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKTtcbiAgICBcbiAgICAvLyBQcmlvcml0eSAxOiBFbnRpdHkgbWV0YWRhdGEgLSBISUdIIGNvbmZpZGVuY2VcbiAgICBjb25zdCBlbnRpdHlOYW1lQXR0cmlidXRlID0gc2NoZW1hLm1vZGVsLmVudGl0eU5hbWVBdHRyaWJ1dGU7XG4gICAgaWYgKGVudGl0eU5hbWVBdHRyaWJ1dGUgJiYgYXR0cmlidXRlc1tlbnRpdHlOYW1lQXR0cmlidXRlXSkge1xuICAgICAgICByZXN1bHQgPSB7XG4gICAgICAgICAgICBmaWVsZDogZW50aXR5TmFtZUF0dHJpYnV0ZSxcbiAgICAgICAgICAgIGNvbmZpZGVuY2U6ICdoaWdoJyxcbiAgICAgICAgICAgIG1ldGhvZDogJ21ldGFkYXRhJ1xuICAgICAgICB9O1xuICAgICAgICBpZiAoZGVidWcpIHtcbiAgICAgICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW2ZpbmRMYWJlbEZpZWxkXSAke2VudGl0eU5hbWV9OiBGb3VuZCB2aWEgbWV0YWRhdGEgLSAke2VudGl0eU5hbWVBdHRyaWJ1dGV9IChISUdIIGNvbmZpZGVuY2UpYCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLy8gUHJpb3JpdHkgMjogQ29tbW9uIGRpc3BsYXkgcGF0dGVybnMgLSBISUdIIGNvbmZpZGVuY2VcbiAgICBpZiAoIXJlc3VsdCkge1xuICAgICAgICBjb25zdCBjb21tb25QYXR0ZXJucyA9IFsnbmFtZScsICd0aXRsZScsICdsYWJlbCcsICdkaXNwbGF5TmFtZScsICdkaXNwbGF5bmFtZSddO1xuICAgICAgICBmb3IgKGNvbnN0IHBhdHRlcm4gb2YgY29tbW9uUGF0dGVybnMpIHtcbiAgICAgICAgICAgIGNvbnN0IG1hdGNoID0gYXR0cmlidXRlTmFtZXMuZmluZChhdHRyID0+IGF0dHIudG9Mb3dlckNhc2UoKSA9PT0gcGF0dGVybik7XG4gICAgICAgICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgICAgICAgICByZXN1bHQgPSB7XG4gICAgICAgICAgICAgICAgICAgIGZpZWxkOiBtYXRjaCxcbiAgICAgICAgICAgICAgICAgICAgY29uZmlkZW5jZTogJ2hpZ2gnLFxuICAgICAgICAgICAgICAgICAgICBtZXRob2Q6ICdjb21tb24tcGF0dGVybidcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIGlmIChkZWJ1Zykge1xuICAgICAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtmaW5kTGFiZWxGaWVsZF0gJHtlbnRpdHlOYW1lfTogRm91bmQgdmlhIGNvbW1vbiBwYXR0ZXJuICcke3BhdHRlcm59JyAtICR7bWF0Y2h9IChISUdIIGNvbmZpZGVuY2UpYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8vIFByaW9yaXR5IDM6IEVudGl0eS1zcGVjaWZpYyBwYXR0ZXJucyAtIEhJR0ggY29uZmlkZW5jZVxuICAgIGlmICghcmVzdWx0KSB7XG4gICAgICAgIGNvbnN0IGVudGl0eUxvd2VyID0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICBjb25zdCBlbnRpdHlTcGVjaWZpY1N1ZmZpeGVzID0gWydOYW1lJywgJ1RpdGxlJywgJ0xhYmVsJ107XG4gICAgICAgIFxuICAgICAgICBmb3IgKGNvbnN0IHN1ZmZpeCBvZiBlbnRpdHlTcGVjaWZpY1N1ZmZpeGVzKSB7XG4gICAgICAgICAgICAvLyBUcnkgZXhhY3QgbWF0Y2g6IGUuZy4sICd0ZWFtTmFtZScgZm9yIGVudGl0eSAndGVhbSdcbiAgICAgICAgICAgIGNvbnN0IGV4YWN0TWF0Y2ggPSBhdHRyaWJ1dGVOYW1lcy5maW5kKGF0dHIgPT4gXG4gICAgICAgICAgICAgICAgYXR0ci50b0xvd2VyQ2FzZSgpID09PSBgJHtlbnRpdHlMb3dlcn0ke3N1ZmZpeC50b0xvd2VyQ2FzZSgpfWBcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBpZiAoZXhhY3RNYXRjaCkge1xuICAgICAgICAgICAgICAgIHJlc3VsdCA9IHtcbiAgICAgICAgICAgICAgICAgICAgZmllbGQ6IGV4YWN0TWF0Y2gsXG4gICAgICAgICAgICAgICAgICAgIGNvbmZpZGVuY2U6ICdoaWdoJyxcbiAgICAgICAgICAgICAgICAgICAgbWV0aG9kOiAnZW50aXR5LXBhdHRlcm4nXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBpZiAoZGVidWcpIHtcbiAgICAgICAgICAgICAgICAgICAgRGVmYXVsdExvZ2dlci5pbmZvKGBbZmluZExhYmVsRmllbGRdICR7ZW50aXR5TmFtZX06IEZvdW5kIHZpYSBlbnRpdHktc3BlY2lmaWMgcGF0dGVybiAtICR7ZXhhY3RNYXRjaH0gKEhJR0ggY29uZmlkZW5jZSlgKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLy8gUHJpb3JpdHkgNDogRmllbGRzIGVuZGluZyB3aXRoIG5hbWUtbGlrZSBzdWZmaXhlcyAtIE1FRElVTSBjb25maWRlbmNlXG4gICAgLy8gTG9vayBmb3IgYW55IGZpZWxkIGVuZGluZyB3aXRoICdOYW1lJywgJ1RpdGxlJywgJ0xhYmVsJyAoZS5nLiwgJ2Rpc3BsYXlOYW1lJywgJ2Z1bGxOYW1lJywgJ3VzZXJOYW1lJywpXG4gICAgaWYgKCFyZXN1bHQpIHtcbiAgICAgICAgY29uc3QgZGlzcGxheU5hbWVTdWZmaXhQYXR0ZXJuID0gL0Rpc3BsYXlOYW1lJC87XG4gICAgICAgIGNvbnN0IG5hbWVTdWZmaXhQYXR0ZXJuID0gL05hbWUkLztcbiAgICAgICAgY29uc3QgdGl0bGVTdWZmaXhQYXR0ZXJuID0gL1RpdGxlJC87XG4gICAgICAgIGNvbnN0IGxhYmVsU3VmZml4UGF0dGVybiA9IC9MYWJlbCQvO1xuICAgICAgICBjb25zdCBjb2RlU3VmZml4UGF0dGVybiA9IC9Db2RlJC87XG4gICAgICAgIFxuICAgICAgICBmb3IgKGNvbnN0IHBhdHRlcm4gb2YgW2Rpc3BsYXlOYW1lU3VmZml4UGF0dGVybiwgbGFiZWxTdWZmaXhQYXR0ZXJuLCB0aXRsZVN1ZmZpeFBhdHRlcm4sIG5hbWVTdWZmaXhQYXR0ZXJuLCBjb2RlU3VmZml4UGF0dGVybl0pIHtcbiAgICAgICAgICAgIGNvbnN0IG1hdGNoID0gYXR0cmlidXRlTmFtZXMuZmluZChhdHRyID0+IHBhdHRlcm4udGVzdChhdHRyKSk7XG4gICAgICAgICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgICAgICAgICByZXN1bHQgPSB7XG4gICAgICAgICAgICAgICAgICAgIGZpZWxkOiBtYXRjaCxcbiAgICAgICAgICAgICAgICAgICAgY29uZmlkZW5jZTogJ21lZGl1bScsXG4gICAgICAgICAgICAgICAgICAgIG1ldGhvZDogJ3N1ZmZpeC1wYXR0ZXJuJ1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgaWYgKGRlYnVnKSB7XG4gICAgICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW2ZpbmRMYWJlbEZpZWxkXSAke2VudGl0eU5hbWV9OiBGb3VuZCB2aWEgc3VmZml4IHBhdHRlcm4gLSAke21hdGNofSAoTUVESVVNIGNvbmZpZGVuY2UpYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8vIFByaW9yaXR5IDU6IE5PIEZBTExCQUNLIC0gSWYgd2UgY2FuJ3QgZmluZCBhIHByb3BlciBuYW1lIGZpZWxkLCByZXR1cm4gdW5kZWZpbmVkXG4gICAgLy8gQmV0dGVyIHRvIHNob3cgSUQgdGhhbiB0byBzaG93IGNvbmZ1c2luZyBmaWVsZHMgbGlrZSAnc3RhdHVzJywgJ3R5cGUnLCBldGMuXG4gICAgLy8gXG4gICAgLy8gRW50aXRpZXMgbGlrZSBTdWJzY3JpcHRpb24sIFBheW1lbnRNZXRob2QgZG9uJ3QgaGF2ZSB0cmFkaXRpb25hbCBuYW1lIGZpZWxkcy5cbiAgICAvLyBTaG93aW5nIFwiYWN0aXZlXCIgb3IgXCJjcmVkaXRfY2FyZFwiIGluIGEgZHJvcGRvd24gaXMgY29uZnVzaW5nIC0gdXNlcnMgY2FuJ3QgZGlzdGluZ3Vpc2ggaXRlbXMuXG4gICAgLy8gSXQncyBjbGVhcmVyIHRvIHNob3cgdGhlIElEIChzdWJzY3JpcHRpb25JZCwgcGF5bWVudE1ldGhvZElkKSBpbiBzdWNoIGNhc2VzLlxuICAgIC8vXG4gICAgLy8gSWYgeW91IG5lZWQgY3VzdG9tIGxhYmVscyBmb3IgdGhlc2UgZW50aXRpZXMsIGV4cGxpY2l0bHkgc2V0IGVudGl0eU5hbWVBdHRyaWJ1dGUgaW4gdGhlIHNjaGVtYVxuICAgIC8vIG9yIHVzZSBvcHRpb25NYXBwaW5nIGluIHRoZSByZWxhdGlvbiBjb25maWcuXG4gICAgXG4gICAgLy8gQ2hlY2sgY29uZmlkZW5jZSB0aHJlc2hvbGRcbiAgICBpZiAocmVzdWx0KSB7XG4gICAgICAgIC8vIE9ubHkgcmV0dXJuIGlmIGNvbmZpZGVuY2UgbWVldHMgbWluaW11bSByZXF1aXJlbWVudFxuICAgICAgICAvLyBtaW5Db25maWRlbmNlOiAnaGlnaCcg4oaSIG9ubHkgcmV0dXJuIEhJR0ggY29uZmlkZW5jZSByZXN1bHRzXG4gICAgICAgIC8vIG1pbkNvbmZpZGVuY2U6ICdtZWRpdW0nIOKGkiByZXR1cm4gSElHSCBvciBNRURJVU0gY29uZmlkZW5jZSByZXN1bHRzIChkZWZhdWx0KVxuICAgICAgICBpZiAobWluQ29uZmlkZW5jZSA9PT0gJ2hpZ2gnICYmIHJlc3VsdC5jb25maWRlbmNlID09PSAnbWVkaXVtJykge1xuICAgICAgICAgICAgaWYgKGRlYnVnKSB7XG4gICAgICAgICAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBbZmluZExhYmVsRmllbGRdICR7ZW50aXR5TmFtZX06IEZpZWxkICcke3Jlc3VsdC5maWVsZH0nIGZvdW5kIHdpdGggTUVESVVNIGNvbmZpZGVuY2UsIGJ1dCBISUdIIGNvbmZpZGVuY2UgcmVxdWlyZWQuIFJldHVybmluZyB1bmRlZmluZWQuYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICByZXR1cm4gcmVzdWx0LmZpZWxkO1xuICAgIH1cbiAgICBcbiAgICAvLyBObyBzdWl0YWJsZSBmaWVsZCBmb3VuZFxuICAgIGlmIChkZWJ1Zykge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYFtmaW5kTGFiZWxGaWVsZF0gJHtlbnRpdHlOYW1lfTogTm8gc3VpdGFibGUgbGFiZWwgZmllbGQgZm91bmQgd2l0aCBzdWZmaWNpZW50IGNvbmZpZGVuY2UuYCk7XG4gICAgfVxuICAgIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUkVMQVRJT04gT1BUSU9OIENPTkZJRyBSRVNPTFVUSU9OXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBSZXNvbHZlcyBSZWxhdGlvbkVudGl0eU9wdGlvbkNvbmZpZyBpbnRvIEZpZWxkT3B0aW9uc0FQSUNvbmZpZyBieSBhdXRvLWRldGVjdGluZzpcbiAqIC0gQ1JVRCBBUEkgcGF0aCBmcm9tIGVudGl0eSBzY2hlbWFcbiAqIC0gTGFiZWwgZmllbGQgZnJvbSBlbnRpdHlOYW1lQXR0cmlidXRlIG1ldGFkYXRhIG9yIHNtYXJ0IGRldGVjdGlvblxuICogLSBWYWx1ZSBmaWVsZCBmcm9tIHJlbGF0aW9uIGlkZW50aWZpZXJzXG4gKiBcbiAqIEBwYXJhbSByZWxhdGlvbkNvbmZpZyAtIE1pbmltYWwgcmVsYXRpb24gb3B0aW9uIGNvbmZpZ1xuICogQHBhcmFtIHJlbGF0aW9uQXR0cmlidXRlIC0gVGhlIHJlbGF0aW9uIGF0dHJpYnV0ZSAodG8gZ2V0IGlkZW50aWZpZXJzKVxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSBmb3Igc2NoZW1hIGxvb2t1cFxuICogQHBhcmFtIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyAtIEdsb2JhbCBVSSBjb25maWcgb3B0aW9ucyAoZm9yIGxhYmVsIGZpZWxkIGRldGVjdGlvbilcbiAqIEByZXR1cm5zIEZ1bGx5IHJlc29sdmVkIEZpZWxkT3B0aW9uc0FQSUNvbmZpZyBvciB1bmRlZmluZWQgaWYgZW50aXR5IG5vdCBmb3VuZFxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVJlbGF0aW9uT3B0aW9uQ29uZmlnKFxuICAgIHJlbGF0aW9uQ29uZmlnOiBSZWxhdGlvbkVudGl0eU9wdGlvbkNvbmZpZyxcbiAgICByZWxhdGlvbkF0dHJpYnV0ZTogVElPU2NoZW1hQXR0cmlidXRlICYgeyByZWxhdGlvbjogTm9uTnVsbGFibGU8VElPU2NoZW1hQXR0cmlidXRlWydyZWxhdGlvbiddPiB9LFxuICAgIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sXG4gICAgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyd1aUNvbmZpZ0dlbk9wdGlvbnMnXVxuKTogRmllbGRPcHRpb25zQVBJQ29uZmlnPGFueT4gfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSwgY3VzdG9tQXBpVXJsLCBvcHRpb25NYXBwaW5nLCAuLi5yZXN0IH0gPSByZWxhdGlvbkNvbmZpZztcbiAgICBjb25zdCByZWxhdGlvbiA9IHJlbGF0aW9uQXR0cmlidXRlLnJlbGF0aW9uO1xuICAgIFxuICAgIC8vIEdldCByZWxhdGVkIGVudGl0eSBzZXJ2aWNlXG4gICAgaWYgKCFlbnRpdHlTZXJ2aWNlLmhhc0VudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUoZW50aXR5TmFtZSkpIHtcbiAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBbcmVzb2x2ZVJlbGF0aW9uT3B0aW9uQ29uZmlnXSBFbnRpdHkgc2VydmljZSBub3QgZm91bmQgZm9yOiAke2VudGl0eU5hbWV9YCk7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIFxuICAgIGNvbnN0IHJlbGF0ZWRTZXJ2aWNlID0gZW50aXR5U2VydmljZS5nZXRFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKGVudGl0eU5hbWUpO1xuICAgIGNvbnN0IHJlbGF0ZWRTY2hlbWEgPSByZWxhdGVkU2VydmljZT8uZ2V0RW50aXR5U2NoZW1hPy4oKTtcbiAgICBcbiAgICBpZiAoIXJlbGF0ZWRTY2hlbWEpIHtcbiAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBbcmVzb2x2ZVJlbGF0aW9uT3B0aW9uQ29uZmlnXSBTY2hlbWEgbm90IGZvdW5kIGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgXG4gICAgLy8gMS4gUmVzb2x2ZSBBUEkgVVJMXG4gICAgY29uc3QgZW50aXR5TmFtZUxvd2VyID0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IGNydWRQYXRoID0gcmVsYXRlZFNjaGVtYS5tb2RlbC5DUlVEQXBpUGF0aCB8fCAnJztcbiAgICBjb25zdCBhcGlVcmwgPSBjdXN0b21BcGlVcmwgfHwgYCR7Y3J1ZFBhdGh9LyR7ZW50aXR5TmFtZUxvd2VyfWA7XG4gICAgXG4gICAgLy8gMi4gUmVzb2x2ZSB2YWx1ZSBmaWVsZCBmcm9tIHJlbGF0aW9uIGlkZW50aWZpZXJzXG4gICAgY29uc3QgcmVzb2x2ZWRJZGVudGlmaWVycyA9IHR5cGVvZiByZWxhdGlvbi5pZGVudGlmaWVycyA9PT0gJ2Z1bmN0aW9uJyA/IHJlbGF0aW9uLmlkZW50aWZpZXJzKCkgOiByZWxhdGlvbi5pZGVudGlmaWVycztcbiAgICBjb25zdCBpZGVudGlmaWVyTWFwcGluZ3MgPSBBcnJheS5pc0FycmF5KHJlc29sdmVkSWRlbnRpZmllcnMpID8gcmVzb2x2ZWRJZGVudGlmaWVycyA6IFtyZXNvbHZlZElkZW50aWZpZXJzXTtcbiAgICBjb25zdCBwcmltYXJ5SWRlbnRpZmllciA9IGlkZW50aWZpZXJNYXBwaW5nc1swXTtcbiAgICBjb25zdCB2YWx1ZUZpZWxkID0gU3RyaW5nKHByaW1hcnlJZGVudGlmaWVyLnRhcmdldCk7XG4gICAgXG4gICAgLy8gMy4gUmVzb2x2ZSBsYWJlbCBmaWVsZCBmcm9tIGVudGl0eSBtZXRhZGF0YSBvciBjdXN0b20gbWFwcGluZ1xuICAgIGxldCBsYWJlbEZpZWxkID0gdmFsdWVGaWVsZDsgLy8gRGVmYXVsdCBmYWxsYmFjayB0byB2YWx1ZSBmaWVsZFxuICAgIFxuICAgIGlmIChvcHRpb25NYXBwaW5nPy5sYWJlbCkge1xuICAgICAgICAvLyBDdXN0b20gbGFiZWwgcHJvdmlkZWQgLSB1c2UgaXRcbiAgICAgICAgbGFiZWxGaWVsZCA9IG9wdGlvbk1hcHBpbmcubGFiZWwgYXMgc3RyaW5nO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEF1dG8tZGV0ZWN0IHVzaW5nIHNtYXJ0IHBhdHRlcm4gbWF0Y2hpbmcgd2l0aCBnbG9iYWwgY29uZmlnXG4gICAgICAgIGNvbnN0IGxhYmVsRmllbGRDb25maWcgPSBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/LmxhYmVsRmllbGREZXRlY3Rpb247XG4gICAgICAgIGxhYmVsRmllbGQgPSBmaW5kTGFiZWxGaWVsZChyZWxhdGVkU2NoZW1hLCBlbnRpdHlOYW1lLCB7XG4gICAgICAgICAgICBtaW5Db25maWRlbmNlOiBsYWJlbEZpZWxkQ29uZmlnPy5taW5Db25maWRlbmNlIHx8ICdtZWRpdW0nLFxuICAgICAgICAgICAgZGVidWc6IGxhYmVsRmllbGRDb25maWc/LmRlYnVnIHx8IGZhbHNlXG4gICAgICAgIH0pIHx8IHZhbHVlRmllbGQ7XG4gICAgfVxuICAgIFxuICAgIC8vIDQuIEJ1aWxkIGNvbXBsZXRlIEZpZWxkT3B0aW9uc0FQSUNvbmZpZ1xuICAgIHJldHVybiB7XG4gICAgICAgIGFwaU1ldGhvZDogJ0dFVCcsXG4gICAgICAgIGFwaVVybCxcbiAgICAgICAgcmVzcG9uc2VLZXk6ICdpdGVtcycsXG4gICAgICAgIG9wdGlvbk1hcHBpbmc6IG9wdGlvbk1hcHBpbmcgfHwge1xuICAgICAgICAgICAgbGFiZWw6IGxhYmVsRmllbGQsXG4gICAgICAgICAgICB2YWx1ZTogKG9wdGlvbk1hcHBpbmcgYXMgYW55KT8udmFsdWUgfHwgdmFsdWVGaWVsZFxuICAgICAgICB9LFxuICAgICAgICAuLi5yZXN0IC8vIFBhc3MgdGhyb3VnaCBmaWx0ZXJzLCBjb3VudCwgZGlzYWJsZVNlYXJjaCwgZXRjLlxuICAgIH07XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRklMVEVSIEFVVE8tR0VORVJBVElPTlxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogQXV0by1nZW5lcmF0ZXMgZmlsdGVyQ29uZmlnIGZvciBlbnRpdHkgYXR0cmlidXRlcyBiYXNlZCBvbiBmaWVsZCB0eXBlLlxuICogXG4gKiBBbGdvcml0aG06XG4gKiAxLiBDaGVjayBpZiBleHBsaWNpdCBmaWx0ZXJDb25maWcgYWxyZWFkeSBleGlzdHMg4oaSIHVzZSBpdFxuICogMi4gQ2hlY2sgaWYgZmllbGQgaXMgZXhwbGljaXRseSBub24tZmlsdGVyYWJsZSDihpIgc2tpcFxuICogMy4gRGV0ZWN0IGZpZWxkIHR5cGUgYW5kIGdlbmVyYXRlIGFwcHJvcHJpYXRlIGNvbmZpZ1xuICogNC4gTWVyZ2Ugd2l0aCBnbG9iYWwgYW5kIGVudGl0eS1sZXZlbCBvdmVycmlkZXNcbiAqIFxuICogQHBhcmFtIGF0dHJpYnV0ZSAtIFRoZSBhdHRyaWJ1dGUgdG8gZ2VuZXJhdGUgZmlsdGVyIGNvbmZpZyBmb3JcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gRW50aXR5IHNlcnZpY2UgZm9yIGFjY2Vzc2luZyBlbnRpdHkgbWV0YWRhdGFcbiAqIEBwYXJhbSBnbG9iYWxVSUNvbmZpZ09wdGlvbnMgLSBHbG9iYWwgVUkgY29uZmlndXJhdGlvbiBvcHRpb25zXG4gKiBAcmV0dXJucyBHZW5lcmF0ZWQgZmlsdGVyIGNvbmZpZ3VyYXRpb24gb3IgdW5kZWZpbmVkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZW5lcmF0ZUZpbHRlckNvbmZpZyhcbiAgICBhdHRyaWJ1dGU6IFRJT1NjaGVtYUF0dHJpYnV0ZSxcbiAgICBlbnRpdHlTZXJ2aWNlPzogQmFzZUVudGl0eVNlcnZpY2U8YW55PixcbiAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbJ3VpQ29uZmlnR2VuT3B0aW9ucyddXG4pOiBGaWVsZE1ldGFkYXRhWydmaWx0ZXJDb25maWcnXSB8IHVuZGVmaW5lZCB7XG4gICAgLy8gMS4gSWYgZXhwbGljaXQgZmlsdGVyQ29uZmlnIGV4aXN0cywgdXNlIGl0IChoaWdoZXN0IHByaW9yaXR5KVxuICAgIGlmIChhdHRyaWJ1dGUuZmlsdGVyQ29uZmlnKSB7XG4gICAgICAgIHJldHVybiBhdHRyaWJ1dGUuZmlsdGVyQ29uZmlnO1xuICAgIH1cbiAgICBcbiAgICAvLyAyLiBJZiBmaWVsZCBoYXMgZXhwbGljaXQgb3B0aW9ucyBjb25maWcsIHVzZSBpdFxuICAgIGlmICgnb3B0aW9ucycgaW4gYXR0cmlidXRlKSB7XG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSAoYXR0cmlidXRlIGFzIFNlbGVjdEZpZWxkTWV0YWRhdGEpLm9wdGlvbnM7XG4gICAgICAgIFxuICAgICAgICAvLyBSZWxhdGlvbkVudGl0eU9wdGlvbkNvbmZpZyAoaGFzIGVudGl0eU5hbWUpIOKGkiByZXNvbHZlIHRvIEZpZWxkT3B0aW9uc0FQSUNvbmZpZ1xuICAgICAgICBjb25zdCBpc1JlbGF0aW9uQ29uZmlnID0gdHlwZW9mIG9wdGlvbnMgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KG9wdGlvbnMpICYmICdlbnRpdHlOYW1lJyBpbiBvcHRpb25zO1xuXG4gICAgICAgIGxldCByZXNvbHZlZENvbmZpZzogRmllbGRPcHRpb25zQVBJQ29uZmlnPGFueT4gfCBGaWVsZE9wdGlvbltdIHwgdW5kZWZpbmVkO1xuXG4gICAgICAgIC8vIElubGluZSBhcnJheSDihpIgdXNlIGFzIGlzXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KG9wdGlvbnMpICYmIG9wdGlvbnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgcmVzb2x2ZWRDb25maWcgPSBvcHRpb25zIGFzIEZpZWxkT3B0aW9uW107XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGaWVsZE9wdGlvbnNBUElDb25maWcgKGhhcyBhcGlNZXRob2QsIGFwaVVybCwgcmVzcG9uc2VLZXkpIOKGkiBwYXNzIHRocm91Z2hcbiAgICAgICAgY29uc3QgaXNBcGlDb25maWcgPSB0eXBlb2Ygb3B0aW9ucyA9PT0gJ29iamVjdCcgJiYgIUFycmF5LmlzQXJyYXkob3B0aW9ucykgJiYgJ2FwaU1ldGhvZCcgaW4gb3B0aW9ucztcbiAgICAgICAgaWYgKGlzQXBpQ29uZmlnKSB7XG4gICAgICAgICAgICByZXNvbHZlZENvbmZpZyA9IG9wdGlvbnMgYXMgRmllbGRPcHRpb25zQVBJQ29uZmlnPGFueT47XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaXNSZWxhdGlvbkNvbmZpZyAmJiBhdHRyaWJ1dGUucmVsYXRpb24gJiYgZW50aXR5U2VydmljZSkge1xuICAgICAgICAgICAgcmVzb2x2ZWRDb25maWcgPSByZXNvbHZlUmVsYXRpb25PcHRpb25Db25maWcoXG4gICAgICAgICAgICAgICAgb3B0aW9ucyBhcyBSZWxhdGlvbkVudGl0eU9wdGlvbkNvbmZpZyxcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGUgYXMgVElPU2NoZW1hQXR0cmlidXRlICYgeyByZWxhdGlvbjogTm9uTnVsbGFibGU8VElPU2NoZW1hQXR0cmlidXRlWydyZWxhdGlvbiddPiB9LFxuICAgICAgICAgICAgICAgIGVudGl0eVNlcnZpY2UsXG4gICAgICAgICAgICAgICAgZ2xvYmFsVUlDb25maWdPcHRpb25zXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYocmVzb2x2ZWRDb25maWcpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgZmlsdGVyVHlwZTogJ3NlbGVjdCcsXG4gICAgICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiAnZXEnIGFzIGNvbnN0LFxuICAgICAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogWydlcScsICduZXEnLCAnaW5MaXN0JywgJ25vdEluTGlzdCcsICdpc0VtcHR5JywgJ2lzTnVsbCddLFxuICAgICAgICAgICAgICAgIHByZWRlZmluZWRPcHRpb25zOiByZXNvbHZlZENvbmZpZ1xuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gZWxzZSBsb2cgZXJyb3JcbiAgICAgICAgdGhyb3cgbmV3IEZyYW1ld29ya0Vycm9yKGBbZ2VuZXJhdGVGaWx0ZXJDb25maWddIE5vIHJlc29sdmVkIGNvbmZpZyBmb3VuZCBmb3IgYXR0cmlidXRlOiAke2F0dHJpYnV0ZS5pZH1gLCB7XG4gICAgICAgICAgICBhdHRyaWJ1dGU6IGF0dHJpYnV0ZSxcbiAgICAgICAgICAgIG9wdGlvbnM6IG9wdGlvbnMsXG4gICAgICAgIH0pO1xuICAgIH1cbiAgICBcbiAgICAvLyAzLiBJZiBmaWVsZCBpcyBleHBsaWNpdGx5IG5vbi1maWx0ZXJhYmxlLCBza2lwXG4gICAgaWYgKGF0dHJpYnV0ZS5pc0ZpbHRlcmFibGUgPT09IGZhbHNlKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIFxuICAgIC8vIDMuIEdldCBnbG9iYWwgYW5kIGVudGl0eS1sZXZlbCBjb25maWdcbiAgICBjb25zdCBnbG9iYWxGaWx0ZXJDb25maWcgPSBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/LnRhYmxlVUk/LmZpbHRlckF1dG9HZW5lcmF0aW9uO1xuICAgIGNvbnN0IGVudGl0eU1ldGFkYXRhID0gZW50aXR5U2VydmljZT8uZ2V0RW50aXR5U2NoZW1hPy4oKS5tb2RlbD8ubWV0YWRhdGEgYXMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+Wydtb2RlbCddWydtZXRhZGF0YSddO1xuICAgIGNvbnN0IGVudGl0eUZpbHRlckNvbmZpZyA9IGVudGl0eU1ldGFkYXRhPy50YWJsZVVJPy5maWx0ZXJBdXRvR2VuZXJhdGlvbjtcbiAgICBcbiAgICAvLyBNZXJnZSBjb25maWdzIChlbnRpdHkgPiBnbG9iYWwgPiBkZWZhdWx0cylcbiAgICBjb25zdCBtZXJnZWRDb25maWcgPSB7XG4gICAgICAgIGVuYWJsZWQ6IGVudGl0eUZpbHRlckNvbmZpZz8uZW5hYmxlZCA/PyBnbG9iYWxGaWx0ZXJDb25maWc/LmVuYWJsZWQgPz8gdHJ1ZSxcbiAgICAgICAgZGF0ZUZpZWxkczoge1xuICAgICAgICAgICAgLi4uZ2xvYmFsRmlsdGVyQ29uZmlnPy5kYXRlRmllbGRzLFxuICAgICAgICAgICAgLi4uZW50aXR5RmlsdGVyQ29uZmlnPy5kYXRlRmllbGRzXG4gICAgICAgIH0sXG4gICAgICAgIGVudW1GaWVsZHM6IHtcbiAgICAgICAgICAgIC4uLmdsb2JhbEZpbHRlckNvbmZpZz8uZW51bUZpZWxkcyxcbiAgICAgICAgICAgIC4uLmVudGl0eUZpbHRlckNvbmZpZz8uZW51bUZpZWxkc1xuICAgICAgICB9LFxuICAgICAgICBib29sZWFuRmllbGRzOiB7XG4gICAgICAgICAgICAuLi5nbG9iYWxGaWx0ZXJDb25maWc/LmJvb2xlYW5GaWVsZHMsXG4gICAgICAgICAgICAuLi5lbnRpdHlGaWx0ZXJDb25maWc/LmJvb2xlYW5GaWVsZHNcbiAgICAgICAgfSxcbiAgICAgICAgcmVsYXRpb25GaWVsZHM6IHtcbiAgICAgICAgICAgIC4uLmdsb2JhbEZpbHRlckNvbmZpZz8ucmVsYXRpb25GaWVsZHMsXG4gICAgICAgICAgICAuLi5lbnRpdHlGaWx0ZXJDb25maWc/LnJlbGF0aW9uRmllbGRzXG4gICAgICAgIH0sXG4gICAgICAgIG51bWJlckZpZWxkczoge1xuICAgICAgICAgICAgLi4uZ2xvYmFsRmlsdGVyQ29uZmlnPy5udW1iZXJGaWVsZHMsXG4gICAgICAgICAgICAuLi5lbnRpdHlGaWx0ZXJDb25maWc/Lm51bWJlckZpZWxkc1xuICAgICAgICB9LFxuICAgICAgICB0ZXh0RmllbGRzOiB7XG4gICAgICAgICAgICAuLi5nbG9iYWxGaWx0ZXJDb25maWc/LnRleHRGaWVsZHMsXG4gICAgICAgICAgICAuLi5lbnRpdHlGaWx0ZXJDb25maWc/LnRleHRGaWVsZHNcbiAgICAgICAgfSxcbiAgICAgICAgZGVidWc6IGVudGl0eUZpbHRlckNvbmZpZz8uZGVidWcgPz8gZ2xvYmFsRmlsdGVyQ29uZmlnPy5kZWJ1ZyA/PyBmYWxzZVxuICAgIH07XG4gICAgXG4gICAgLy8gSWYgZ2xvYmFsbHkgZGlzYWJsZWQsIHNraXBcbiAgICBpZiAoIW1lcmdlZENvbmZpZy5lbmFibGVkKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIFxuICAgIGNvbnN0IGF0dHJUeXBlID0gYXR0cmlidXRlLnR5cGU7XG4gICAgY29uc3QgZmllbGRUeXBlID0gYXR0cmlidXRlLmZpZWxkVHlwZTtcbiAgICBcbiAgICAvLyAqKjEuIEJvb2xlYW4gZmllbGRzKipcbiAgICBpZiAoYXR0clR5cGUgPT09ICdib29sZWFuJyAmJiBtZXJnZWRDb25maWcuYm9vbGVhbkZpZWxkcz8uZW5hYmxlZCAhPT0gZmFsc2UpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGZpbHRlclR5cGU6ICdib29sZWFuJyxcbiAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogJ2VxJyxcbiAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogWydlcScsICduZXEnLCAnaXNFbXB0eScsICdpc051bGwnXSxcbiAgICAgICAgICAgIHByZWRlZmluZWRPcHRpb25zOiBbXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ1llcycsIHZhbHVlOiBcInRydWVcIiB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdObycsIHZhbHVlOiBcImZhbHNlXCIgfVxuICAgICAgICAgICAgXVxuICAgICAgICB9O1xuICAgIH1cbiAgICBcbiAgICAvLyAqKjIuIEVudW0gZmllbGRzIChhcnJheSBvZiBzdHJpbmdzL251bWJlcnMpKipcbiAgICBpZiAoQXJyYXkuaXNBcnJheShhdHRyVHlwZSkgJiYgbWVyZ2VkQ29uZmlnLmVudW1GaWVsZHM/LmVuYWJsZWQgIT09IGZhbHNlKSB7XG4gICAgICAgIGNvbnN0IGRlZmF1bHRFbnVtT3BzID0gWydlcScsICduZXEnLCAnaW5MaXN0JywgJ25vdEluTGlzdCcsICdpc0VtcHR5JywgJ2lzTnVsbCddIGFzIGNvbnN0O1xuICAgICAgICBjb25zdCBkZWZhdWx0T3AgPSBtZXJnZWRDb25maWcuZW51bUZpZWxkcz8uZGVmYXVsdE9wZXJhdG9yIHx8ICgnZXEnKTtcbiAgICAgICAgY29uc3QgYXZhaWxhYmxlT3BzID0gbWVyZ2VkQ29uZmlnLmVudW1GaWVsZHM/LmF2YWlsYWJsZU9wZXJhdG9ycyB8fCBkZWZhdWx0RW51bU9wcztcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBmaWx0ZXJUeXBlOiAnc2VsZWN0JyxcbiAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogZGVmYXVsdE9wLFxuICAgICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBhdmFpbGFibGVPcHMsXG4gICAgICAgICAgICBwcmVkZWZpbmVkT3B0aW9uczogYXR0clR5cGUubWFwKHZhbCA9PiAoe1xuICAgICAgICAgICAgICAgIGxhYmVsOiBTdHJpbmcodmFsKSxcbiAgICAgICAgICAgICAgICB2YWx1ZTogU3RyaW5nKHZhbCkgIC8vIEFsd2F5cyBjb252ZXJ0IHRvIHN0cmluZyBmb3IgY29uc2lzdGVuY3lcbiAgICAgICAgICAgIH0pKVxuICAgICAgICB9O1xuICAgIH1cbiAgICBcbiAgICBcbiAgICAvLyAqKjMuIERhdGUvRGF0ZXRpbWUgZmllbGRzKipcbiAgICBpZiAoKGZpZWxkVHlwZSA9PT0gJ2RhdGUnIHx8IGZpZWxkVHlwZSA9PT0gJ2RhdGV0aW1lJyB8fCAoYXR0clR5cGUgPT09ICdzdHJpbmcnICYmIChhdHRyaWJ1dGUuaWQudG9Mb3dlckNhc2UoKS5pbmNsdWRlcygnZGF0ZScpIHx8IGF0dHJpYnV0ZS5pZC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKCd0aW1lJykpKSlcbiAgICAgICAgJiYgbWVyZ2VkQ29uZmlnLmRhdGVGaWVsZHM/LmVuYWJsZWQgIT09IGZhbHNlKSB7XG4gICAgICAgIGNvbnN0IGRlZmF1bHREYXRlT3BzID0gWydlcScsICduZXEnLCAnZ3QnLCAnZ3RlJywgJ2x0JywgJ2x0ZScsICdiZXR3ZWVuJywgJ2lzRW1wdHknLCAnaXNOdWxsJ10gYXMgY29uc3Q7XG4gICAgICAgIGNvbnN0IG9wZXJhdG9ycyA9IG1lcmdlZENvbmZpZy5kYXRlRmllbGRzPy5kZWZhdWx0T3BlcmF0b3JzIHx8IGRlZmF1bHREYXRlT3BzO1xuICAgICAgICBcbiAgICAgICAgY29uc3QgZmlsdGVyQ29uZmlnOiBhbnkgPSB7XG4gICAgICAgICAgICBmaWx0ZXJUeXBlOiAnZGF0ZXRpbWUnLFxuICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBvcGVyYXRvcnNbMF0gfHwgKCdndGUnKSxcbiAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogb3BlcmF0b3JzXG4gICAgICAgIH07XG4gICAgICAgIFxuICAgICAgICAvLyBBZGQgcXVpY2sgZGF0ZSBmaWx0ZXJzIGlmIGVuYWJsZWRcbiAgICAgICAgaWYgKG1lcmdlZENvbmZpZy5kYXRlRmllbGRzPy5xdWlja0ZpbHRlcnMgIT09IGZhbHNlKSB7XG4gICAgICAgICAgICBmaWx0ZXJDb25maWcucHJlZGVmaW5lZE9wdGlvbnMgPSBbXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ1RvZGF5JywgdmFsdWU6ICc6c3RhcnRPZlRvZGF5JyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdZZXN0ZXJkYXknLCB2YWx1ZTogJzpzdGFydE9mWWVzdGVyZGF5JyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdUaGlzIFdlZWsnLCB2YWx1ZTogJzpzdGFydE9mV2VlaycgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnTGFzdCBXZWVrJywgdmFsdWU6ICc6c3RhcnRPZkxhc3RXZWVrJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdUaGlzIE1vbnRoJywgdmFsdWU6ICc6c3RhcnRPZk1vbnRoJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdMYXN0IE1vbnRoJywgdmFsdWU6ICc6c3RhcnRPZkxhc3RNb250aCcgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnVGhpcyBRdWFydGVyJywgdmFsdWU6ICc6c3RhcnRPZlF1YXJ0ZXInIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ0xhc3QgUXVhcnRlcicsIHZhbHVlOiAnOnN0YXJ0T2ZMYXN0UXVhcnRlcicgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnVGhpcyBZZWFyJywgdmFsdWU6ICc6c3RhcnRPZlllYXInIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ0xhc3QgWWVhcicsIHZhbHVlOiAnOnN0YXJ0T2ZMYXN0WWVhcicgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnTGFzdCA3IERheXMnLCB2YWx1ZTogJzpub3dNaW51czdEYXlzJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdMYXN0IDMwIERheXMnLCB2YWx1ZTogJzpub3dNaW51czMwRGF5cycgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnTGFzdCA5MCBEYXlzJywgdmFsdWU6ICc6bm93TWludXM5MERheXMnIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ0N1c3RvbSBEYXRlJywgdmFsdWU6IG51bGwgfSAgLy8gVHJpZ2dlcnMgZGF0ZXRpbWUtbG9jYWwgaW5wdXRcbiAgICAgICAgICAgIF07XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIHJldHVybiBmaWx0ZXJDb25maWc7XG4gICAgfVxuICAgIFxuICAgIC8vICoqNS4gTnVtYmVyIGZpZWxkcyoqXG4gICAgaWYgKGF0dHJUeXBlID09PSAnbnVtYmVyJyAmJiBtZXJnZWRDb25maWcubnVtYmVyRmllbGRzPy5lbmFibGVkICE9PSBmYWxzZSkge1xuICAgICAgICBjb25zdCBkZWZhdWx0TnVtYmVyT3BzID0gWydlcScsICduZXEnLCAnZ3QnLCAnZ3RlJywgJ2x0JywgJ2x0ZScsICdiZXR3ZWVuJywgJ2lzRW1wdHknLCAnaXNOdWxsJ10gYXMgY29uc3Q7XG4gICAgICAgIGNvbnN0IG9wZXJhdG9ycyA9IG1lcmdlZENvbmZpZy5udW1iZXJGaWVsZHM/LmRlZmF1bHRPcGVyYXRvcnMgfHwgZGVmYXVsdE51bWJlck9wcztcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGZpbHRlclR5cGU6ICdudW1iZXInLFxuICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBvcGVyYXRvcnNbMF0gfHwgKCdlcScpLFxuICAgICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBvcGVyYXRvcnNcbiAgICAgICAgfTtcbiAgICB9XG4gICAgXG4gICAgLy8gKio0LiBSZWxhdGlvbiBmaWVsZHMgKHdpdGhvdXQgZXhwbGljaXQgb3B0aW9ucykgLSBhdXRvLWdlbmVyYXRlIGZyb20gcmVsYXRpb24gbWV0YWRhdGEqKlxuICAgIGlmIChhdHRyaWJ1dGUucmVsYXRpb24gJiYgbWVyZ2VkQ29uZmlnLnJlbGF0aW9uRmllbGRzPy5lbmFibGVkICE9PSBmYWxzZSAmJiBlbnRpdHlTZXJ2aWNlKSB7XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uQ29uZmlnOiBSZWxhdGlvbkVudGl0eU9wdGlvbkNvbmZpZyA9IHsgZW50aXR5TmFtZTogYXR0cmlidXRlLnJlbGF0aW9uLmVudGl0eU5hbWUgfTtcbiAgICAgICAgY29uc3QgcmVzb2x2ZWQgPSByZXNvbHZlUmVsYXRpb25PcHRpb25Db25maWcoXG4gICAgICAgICAgICByZWxhdGlvbkNvbmZpZyxcbiAgICAgICAgICAgIGF0dHJpYnV0ZSBhcyBUSU9TY2hlbWFBdHRyaWJ1dGUgJiB7IHJlbGF0aW9uOiBOb25OdWxsYWJsZTxUSU9TY2hlbWFBdHRyaWJ1dGVbJ3JlbGF0aW9uJ10+IH0sXG4gICAgICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuICAgICAgICAgICAgZ2xvYmFsVUlDb25maWdPcHRpb25zXG4gICAgICAgICk7XG4gICAgICAgIFxuICAgICAgICBpZiAocmVzb2x2ZWQpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgZmlsdGVyVHlwZTogJ3JlbGF0aW9uJyxcbiAgICAgICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6ICdlcScgYXMgY29uc3QsXG4gICAgICAgICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBbJ2VxJywgJ25lcScsICdpbkxpc3QnLCAnbm90SW5MaXN0JywgJ2lzRW1wdHknLCAnaXNOdWxsJ10sXG4gICAgICAgICAgICAgICAgcHJlZGVmaW5lZE9wdGlvbnM6IHJlc29sdmVkXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8vICoqNi4gVGV4dCBmaWVsZHMgKGRlZmF1bHQgZmFsbGJhY2spKipcbiAgICBpZiAoYXR0clR5cGUgPT09ICdzdHJpbmcnICYmIG1lcmdlZENvbmZpZy50ZXh0RmllbGRzPy5lbmFibGVkICE9PSBmYWxzZSkge1xuICAgICAgICBjb25zdCBkZWZhdWx0VGV4dE9wcyA9IFsnY29udGFpbnMnLCAnbm90Q29udGFpbnMnLCAnZXEnLCAnbmVxJywgJ3N0YXJ0c1dpdGgnLCAnZW5kc1dpdGgnLCAnbGlrZScsICdpc0VtcHR5JywgJ2lzTnVsbCddO1xuICAgICAgICBjb25zdCBvcGVyYXRvcnMgPSBtZXJnZWRDb25maWcudGV4dEZpZWxkcz8uZGVmYXVsdE9wZXJhdG9ycyB8fCBkZWZhdWx0VGV4dE9wcztcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGZpbHRlclR5cGU6ICd0ZXh0JyxcbiAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogb3BlcmF0b3JzWzBdIHx8ICgnY29udGFpbnMnKSxcbiAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogb3BlcmF0b3JzXG4gICAgICAgIH07XG4gICAgfVxuICAgIFxuICAgIC8vIERlYnVnIGxvZ2dpbmdcbiAgICBpZiAobWVyZ2VkQ29uZmlnLmRlYnVnKSB7XG4gICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW0ZpbHRlckF1dG9HZW5dICR7YXR0cmlidXRlLmlkfTogTm8gZmlsdGVyIGNvbmZpZyBnZW5lcmF0ZWQgKHR5cGU6ICR7YXR0clR5cGV9KWApO1xuICAgIH1cbiAgICBcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNFR01FTlQgQVVUTy1HRU5FUkFUSU9OXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBTbWFydCBpY29uIG1hcHBpbmcgZm9yIHNlZ21lbnQgdmFsdWVzLlxuICogUHJvdmlkZXMgc2Vuc2libGUgZGVmYXVsdHMgZm9yIGNvbW1vbiBzdGF0dXMvc3RhdGUgcGF0dGVybnMuXG4gKiBJY29ucyBtYXRjaCB1aTI0L3NyYy9jb3JlL2NvbW1vbi9JY29ucy9JY29ucy50c3ggbmFtaW5nIGNvbnZlbnRpb25zLlxuICovXG5jb25zdCBERUZBVUxUX0lDT05fTUFQUElORzogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgICAvLyBBY3RpdmUvSW5hY3RpdmUgcGF0dGVybnNcbiAgICAnYWN0aXZlJzogJ0NoZWNrQ2lyY2xlT3V0bGluZWQnLFxuICAgICdpbmFjdGl2ZSc6ICdDbG9zZUNpcmNsZU91dGxpbmVkJyxcbiAgICAnZW5hYmxlZCc6ICdDaGVja0NpcmNsZU91dGxpbmVkJyxcbiAgICAnZGlzYWJsZWQnOiAnQ2xvc2VDaXJjbGVPdXRsaW5lZCcsXG4gICAgXG4gICAgLy8gU3RhdHVzIHBhdHRlcm5zXG4gICAgJ3BlbmRpbmcnOiAnQ2xvY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2luLXByb2dyZXNzJzogJ1N5bmNPdXRsaW5lZCcsXG4gICAgJ2lucHJvZ3Jlc3MnOiAnU3luY091dGxpbmVkJyxcbiAgICAnY29tcGxldGVkJzogJ0NoZWNrQ2lyY2xlT3V0bGluZWQnLFxuICAgICdkb25lJzogJ0NoZWNrT3V0bGluZWQnLFxuICAgICdmaW5pc2hlZCc6ICdDaGVja0NpcmNsZU91dGxpbmVkJyxcbiAgICAnY2FuY2VsbGVkJzogJ0Nsb3NlQ2lyY2xlT3V0bGluZWQnLFxuICAgICdjYW5jZWxlZCc6ICdDbG9zZUNpcmNsZU91dGxpbmVkJyxcbiAgICAnZmFpbGVkJzogJ0Nsb3NlQ2lyY2xlT3V0bGluZWQnLFxuICAgICdlcnJvcic6ICdFeGNsYW1hdGlvbkNpcmNsZU91dGxpbmVkJyxcbiAgICAncGF1c2VkJzogJ1BhdXNlQ2lyY2xlT3V0bGluZWQnLFxuICAgIFxuICAgIC8vIFNjaGVkdWxpbmcgcGF0dGVybnNcbiAgICAnc2NoZWR1bGVkJzogJ0NhbGVuZGFyT3V0bGluZWQnLFxuICAgICd1cGNvbWluZyc6ICdDYWxlbmRhck91dGxpbmVkJyxcbiAgICAnbGl2ZSc6ICdQbGF5Q2lyY2xlT3V0bGluZWQnLFxuICAgICdkcmFmdCc6ICdGaWxlT3V0bGluZWQnLFxuICAgICdwdWJsaXNoZWQnOiAnQ2hlY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2FyY2hpdmVkJzogJ0ZvbGRlck91dGxpbmVkJyxcbiAgICBcbiAgICAvLyBQcmlvcml0eSBwYXR0ZXJuc1xuICAgICdsb3cnOiAnRG93bk91dGxpbmVkJyxcbiAgICAnbWVkaXVtJzogJ01pbnVzT3V0bGluZWQnLFxuICAgICdoaWdoJzogJ1VwT3V0bGluZWQnLFxuICAgICdjcml0aWNhbCc6ICdXYXJuaW5nT3V0bGluZWQnLFxuICAgICd1cmdlbnQnOiAnRmlyZU91dGxpbmVkJyxcbiAgICBcbiAgICAvLyBBcHByb3ZhbCBwYXR0ZXJuc1xuICAgICdhcHByb3ZlZCc6ICdDaGVja0NpcmNsZU91dGxpbmVkJyxcbiAgICAncmVqZWN0ZWQnOiAnQ2xvc2VDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ3Jldmlldyc6ICdFeWVPdXRsaW5lZCcsXG4gICAgXG4gICAgLy8gQm9vbGVhbiBUcnVlL0ZhbHNlXG4gICAgJ3RydWUnOiAnQ2hlY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2ZhbHNlJzogJ0Nsb3NlQ2lyY2xlT3V0bGluZWQnXG59O1xuXG4vKipcbiAqIEludGVsbGlnZW50bHkgZXh0cmFjdCBib29sZWFuIGxhYmVscyBmcm9tIGZpZWxkIG5hbWUgcGF0dGVybnMuXG4gKiBTdXBwb3J0cyBjb21tb24gYm9vbGVhbiBwcmVmaXhlcyBsaWtlIGlzL2hhcy9jYW4vc2hvdWxkL3dpbGwvZXRjLlxuICogXG4gKiBAZXhhbXBsZVxuICogLSBpc0FjdGl2ZSDihpIgXCJBY3RpdmVcIiAvIFwiSW5hY3RpdmVcIlxuICogLSBoYXNQZXJtaXNzaW9uIOKGkiBcIkhhcyBQZXJtaXNzaW9uXCIgLyBcIk5vIFBlcm1pc3Npb25cIlxuICogLSBjYW5FZGl0IOKGkiBcIkNhbiBFZGl0XCIgLyBcIkNhbm5vdCBFZGl0XCJcbiAqIC0gaXNMaXZlIOKGkiBcIkxpdmVcIiAvIFwiTm90IExpdmVcIlxuICogLSBzaG91bGROb3RpZnkg4oaSIFwiU2hvdWxkIE5vdGlmeVwiIC8gXCJTaG91bGQgTm90IE5vdGlmeVwiXG4gKi9cbmZ1bmN0aW9uIGV4dHJhY3RCb29sZWFuTGFiZWxzRnJvbUZpZWxkTmFtZShmaWVsZE5hbWU6IHN0cmluZyk6IHsgdHJ1ZUxhYmVsOiBzdHJpbmc7IGZhbHNlTGFiZWw6IHN0cmluZyB9IHwgbnVsbCB7XG4gICAgLy8gQ29tbW9uIGJvb2xlYW4gcHJlZml4ZXMgd2l0aCB0aGVpciBuZWdhdGl2ZSBmb3Jtc1xuICAgIGNvbnN0IHBhdHRlcm5zID0gW1xuICAgICAgICAvLyBQYXR0ZXJuOiBpcyArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL15pcyhbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IHRvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbMV0pLFxuICAgICAgICAgICAgZ2V0RmFsc2VMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgYmFzZSA9IHRvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbMV0pO1xuICAgICAgICAgICAgICAgIC8vIFNwZWNpYWwgY2FzZXMgZm9yIGJldHRlciBuZWdhdGlvblxuICAgICAgICAgICAgICAgIGlmIChiYXNlLnRvTG93ZXJDYXNlKCkgPT09ICdhY3RpdmUnKSByZXR1cm4gJ0luYWN0aXZlJztcbiAgICAgICAgICAgICAgICBpZiAoYmFzZS50b0xvd2VyQ2FzZSgpID09PSAnZW5hYmxlZCcpIHJldHVybiAnRGlzYWJsZWQnO1xuICAgICAgICAgICAgICAgIGlmIChiYXNlLnRvTG93ZXJDYXNlKCkgPT09ICd2aXNpYmxlJykgcmV0dXJuICdIaWRkZW4nO1xuICAgICAgICAgICAgICAgIGlmIChiYXNlLnRvTG93ZXJDYXNlKCkgPT09ICdwdWJsaWMnKSByZXR1cm4gJ1ByaXZhdGUnO1xuICAgICAgICAgICAgICAgIGlmIChiYXNlLnRvTG93ZXJDYXNlKCkgPT09ICdhdmFpbGFibGUnKSByZXR1cm4gJ1VuYXZhaWxhYmxlJztcbiAgICAgICAgICAgICAgICByZXR1cm4gYE5vdCAke2Jhc2V9YDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGF0dGVybjogaGFzICsgWFhYXG4gICAgICAgIHtcbiAgICAgICAgICAgIHJlZ2V4OiAvXmhhcyhbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBIYXMgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWzFdKX1gLFxuICAgICAgICAgICAgZ2V0RmFsc2VMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgTm8gJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWzFdKX1gXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBhdHRlcm46IGNhbiArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL15jYW4oW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgQ2FuICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsxXSl9YCxcbiAgICAgICAgICAgIGdldEZhbHNlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYENhbm5vdCAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbMV0pfWBcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGF0dGVybjogc2hvdWxkICsgWFhYXG4gICAgICAgIHtcbiAgICAgICAgICAgIHJlZ2V4OiAvXnNob3VsZChbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBTaG91bGQgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWzFdKX1gLFxuICAgICAgICAgICAgZ2V0RmFsc2VMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgU2hvdWxkIE5vdCAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbMV0pfWBcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGF0dGVybjogd2lsbCArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL153aWxsKFtBLVpdW2EtekEtWjAtOV0qKS8sXG4gICAgICAgICAgICBnZXRUcnVlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYFdpbGwgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWzFdKX1gLFxuICAgICAgICAgICAgZ2V0RmFsc2VMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgV2lsbCBOb3QgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWzFdKX1gXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBhdHRlcm46IGFsbG93cyArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL15hbGxvd3MoW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgQWxsb3dzICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsxXSl9YCxcbiAgICAgICAgICAgIGdldEZhbHNlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYERvZXMgTm90IEFsbG93ICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsxXSl9YFxuICAgICAgICB9LFxuICAgICAgICAvLyBQYXR0ZXJuOiBuZWVkcyArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL15uZWVkcyhbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBOZWVkcyAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbMV0pfWAsXG4gICAgICAgICAgICBnZXRGYWxzZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBEb2VzIE5vdCBOZWVkICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsxXSl9YFxuICAgICAgICB9LFxuICAgICAgICAvLyBQYXR0ZXJuOiByZXF1aXJlcyArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL15yZXF1aXJlcyhbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBSZXF1aXJlcyAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbMV0pfWAsXG4gICAgICAgICAgICBnZXRGYWxzZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBEb2VzIE5vdCBSZXF1aXJlICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsxXSl9YFxuICAgICAgICB9XG4gICAgXTtcbiAgICBcbiAgICBmb3IgKGNvbnN0IHBhdHRlcm4gb2YgcGF0dGVybnMpIHtcbiAgICAgICAgY29uc3QgbWF0Y2ggPSBmaWVsZE5hbWUubWF0Y2gocGF0dGVybi5yZWdleCk7XG4gICAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICB0cnVlTGFiZWw6IHBhdHRlcm4uZ2V0VHJ1ZUxhYmVsKG1hdGNoKSxcbiAgICAgICAgICAgICAgICBmYWxzZUxhYmVsOiBwYXR0ZXJuLmdldEZhbHNlTGFiZWwobWF0Y2gpXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIEdldCB0aGUgbnVtYmVyIG9mIG9wdGlvbnMgZm9yIGEgZmllbGQuXG4gKi9cbmZ1bmN0aW9uIGdldEZpZWxkT3B0aW9uQ291bnQoZmllbGQ6IFRJT1NjaGVtYUF0dHJpYnV0ZSk6IG51bWJlciB7XG4gICAgLy8gMS4gRW51bSB0eXBlIGFycmF5XG4gICAgaWYgKEFycmF5LmlzQXJyYXkoZmllbGQudHlwZSkpIHtcbiAgICAgICAgcmV0dXJuIGZpZWxkLnR5cGUubGVuZ3RoO1xuICAgIH1cbiAgICBcbiAgICAvLyAyLiBCb29sZWFuIGZpZWxkXG4gICAgaWYgKGZpZWxkLnR5cGUgPT09ICdib29sZWFuJykge1xuICAgICAgICByZXR1cm4gMjtcbiAgICB9XG4gICAgXG4gICAgLy8gMy4gU2VsZWN0L3JhZGlvL2NoZWNrYm94IGZpZWxkIHdpdGggaW5saW5lIG9wdGlvbnNcbiAgICBjb25zdCBmaWVsZFR5cGUgPSBmaWVsZC5maWVsZFR5cGU7XG4gICAgaWYgKGZpZWxkVHlwZSA9PT0gJ3NlbGVjdCcgfHwgZmllbGRUeXBlID09PSAncmFkaW8nIHx8IGZpZWxkVHlwZSA9PT0gJ2NoZWNrYm94JyB8fCBmaWVsZFR5cGUgPT09ICdtdWx0aS1zZWxlY3QnKSB7XG4gICAgICAgIGNvbnN0IG9wdGlvbnMgPSAoZmllbGQgYXMgYW55KS5vcHRpb25zO1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShvcHRpb25zKSkge1xuICAgICAgICAgICAgcmV0dXJuIG9wdGlvbnMubGVuZ3RoO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIHJldHVybiAwO1xufVxuXG4vKipcbiAqIENoZWNrIGlmIGEgZmllbGQgaXMgdmlhYmxlIGZvciBzZWdtZW50IGdlbmVyYXRpb24uXG4gKiBTdXBwb3J0czpcbiAqIC0gRW51bSB0eXBlczogdHlwZTogWyd2YWx1ZTEnLCAndmFsdWUyJ11cbiAqIC0gQm9vbGVhbiB0eXBlczogdHlwZTogJ2Jvb2xlYW4nXG4gKiAtIFNlbGVjdC9yYWRpby9jaGVja2JveCBmaWVsZHMgd2l0aCBvcHRpb25zOiBmaWVsZFR5cGU6ICdzZWxlY3QnICsgb3B0aW9uczogWy4uLl1cbiAqIFxuICogU1RSSUNUTFkgZW5mb3JjZXM6IG1pblZhbHVlcyA8PSBvcHRpb25Db3VudCA8PSBtYXhTZWdtZW50c1Blckdyb3VwXG4gKi9cbmZ1bmN0aW9uIGlzVmlhYmxlU2VnbWVudEZpZWxkKFxuICAgIGZpZWxkOiBUSU9TY2hlbWFBdHRyaWJ1dGUsXG4gICAgY29uZmlnOiBSZXF1aXJlZDxJU2VnbWVudEF1dG9HZW5lcmF0aW9uQ29uZmlnPiAmIHsgbWF4U2VnbWVudHNQZXJHcm91cD86IG51bWJlciB9XG4pOiBib29sZWFuIHtcbiAgICBjb25zdCBtYXhWYWx1ZXMgPSBjb25maWcubWF4U2VnbWVudHNQZXJHcm91cCB8fCAxMDtcbiAgICBjb25zdCBvcHRpb25Db3VudCA9IGdldEZpZWxkT3B0aW9uQ291bnQoZmllbGQpO1xuICAgIFxuICAgIC8vIE11c3QgaGF2ZSBvcHRpb25zIEFORCBiZSB3aXRoaW4gYm91bmRzXG4gICAgaWYgKG9wdGlvbkNvdW50ID09PSAwKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgXG4gICAgLy8gU1RSSUNUOiBSZWplY3QgaWYgb3V0c2lkZSBib3VuZHNcbiAgICByZXR1cm4gb3B0aW9uQ291bnQgPj0gY29uZmlnLm1pblZhbHVlcyAmJiBvcHRpb25Db3VudCA8PSBtYXhWYWx1ZXM7XG59XG5cbi8qKlxuICogSW50ZWxsaWdlbnRseSBkZXRlY3QgdGhlIGJlc3QgZmllbGQocykgZm9yIGdlbmVyYXRpbmcgc2VnbWVudHMuXG4gKiBSZXR1cm5zIG11bHRpcGxlIGZpZWxkcyBpZiBtYXhTZWdtZW50R3JvdXBzID4gMS5cbiAqIFxuICogUHJpb3JpdHk6XG4gKiAxLiBFeHBsaWNpdCBzZWdtZW50RmllbGRzIChlbnRpdHkgY29uZmlnKSDihpIgVXNlIHRob3NlIGZpZWxkc1xuICogMi4gaW5jbHVkZUZpZWxkcyBmaWx0ZXIgKGVudGl0eSBjb25maWcpIOKGkiBPbmx5IGNvbnNpZGVyIHRoZXNlXG4gKiAzLiBleGNsdWRlRmllbGRzIGZpbHRlciAoZW50aXR5IGNvbmZpZykg4oaSIFNraXAgdGhlc2VcbiAqIDQuIHByZWZlcnJlZEZpZWxkcyAoZ2xvYmFsL2VudGl0eSBjb25maWcpIOKGkiBUcnkgdGhlc2UgZmlyc3RcbiAqIDUuIFNjb3JpbmcgYWxnb3JpdGhtIOKGkiBTY29yZSBhbGwgY2FuZGlkYXRlcyBhbmQgcGljayB0b3AgTlxuICovXG5mdW5jdGlvbiBkZXRlY3RTZWdtZW50RmllbGRzPFMgZXh0ZW5kcyBFbnRpdHlTY2hlbWE8c3RyaW5nLCBzdHJpbmcsIHN0cmluZz4+KFxuICAgIHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXA8Uz4sXG4gICAgZ2xvYmFsQ29uZmlnPzogSVNlZ21lbnRBdXRvR2VuZXJhdGlvbkNvbmZpZyxcbiAgICBlbnRpdHlDb25maWc/OiBOb25OdWxsYWJsZTxSZXR1cm5UeXBlPHR5cGVvZiBCYXNlRW50aXR5U2VydmljZS5wcm90b3R5cGUuZ2V0RW50aXR5U2NoZW1hPlsnbW9kZWwnXVsnbWV0YWRhdGEnXT5bJ3RhYmxlVUknXVxuKTogQXJyYXk8eyBmaWVsZDogVElPU2NoZW1hQXR0cmlidXRlOyBzY29yZTogbnVtYmVyOyByZWFzb246IHN0cmluZyB9PiB7XG4gICAgY29uc3Qgc2VnbWVudENvbmZpZyA9IGVudGl0eUNvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uO1xuICAgIFxuICAgIC8vIE1lcmdlIGNvbmZpZ3MgKGVudGl0eSA+IGdsb2JhbCA+IGRlZmF1bHRzKVxuICAgIGNvbnN0IG1lcmdlZENvbmZpZzogUmVxdWlyZWQ8SVNlZ21lbnRBdXRvR2VuZXJhdGlvbkNvbmZpZz4gJiB7IG1heFNlZ21lbnRHcm91cHM6IG51bWJlcjsgbWF4U2VnbWVudHNQZXJHcm91cDogbnVtYmVyIH0gPSB7XG4gICAgICAgIGVuYWJsZWQ6IHNlZ21lbnRDb25maWc/LmVuYWJsZWQgPz8gZ2xvYmFsQ29uZmlnPy5lbmFibGVkID8/IHRydWUsXG4gICAgICAgIHByZWZlcnJlZEZpZWxkczogc2VnbWVudENvbmZpZz8ucHJlZmVycmVkRmllbGRzIHx8IGdsb2JhbENvbmZpZz8ucHJlZmVycmVkRmllbGRzIHx8IFsnc3RhdHVzJywgJ3N0YXRlJywgJ3R5cGUnLCAnY2F0ZWdvcnknLCAncHJpb3JpdHknXSxcbiAgICAgICAgbWF4U2VnbWVudEdyb3Vwczogc2VnbWVudENvbmZpZz8ubWF4U2VnbWVudEdyb3VwcyA/PyBnbG9iYWxDb25maWc/Lm1heFNlZ21lbnRHcm91cHMgPz8gMixcbiAgICAgICAgbWF4U2VnbWVudHNQZXJHcm91cDogc2VnbWVudENvbmZpZz8ubWF4U2VnbWVudHNQZXJHcm91cCA/PyBnbG9iYWxDb25maWc/Lm1heFNlZ21lbnRzUGVyR3JvdXAgPz8gMTAsXG4gICAgICAgIG1pblZhbHVlczogc2VnbWVudENvbmZpZz8ubWluVmFsdWVzID8/IGdsb2JhbENvbmZpZz8ubWluVmFsdWVzID8/IDIsXG4gICAgICAgIGljb25NYXBwaW5nOiB7IC4uLkRFRkFVTFRfSUNPTl9NQVBQSU5HLCAuLi5nbG9iYWxDb25maWc/Lmljb25NYXBwaW5nLCAuLi5zZWdtZW50Q29uZmlnPy5pY29uTWFwcGluZyB9LFxuICAgICAgICBib29sZWFuTGFiZWxQYXR0ZXJuczogc2VnbWVudENvbmZpZz8uYm9vbGVhbkxhYmVsUGF0dGVybnMgfHwgZ2xvYmFsQ29uZmlnPy5ib29sZWFuTGFiZWxQYXR0ZXJucyB8fCBbXSxcbiAgICAgICAgZGVmYXVsdEJvb2xlYW5MYWJlbHM6IHNlZ21lbnRDb25maWc/LmRlZmF1bHRCb29sZWFuTGFiZWxzIHx8IGdsb2JhbENvbmZpZz8uZGVmYXVsdEJvb2xlYW5MYWJlbHMgfHwgeyB0cnVlOiAnWWVzJywgZmFsc2U6ICdObycgfSxcbiAgICAgICAgaW5jbHVkZUFsbFNlZ21lbnQ6IHNlZ21lbnRDb25maWc/LmluY2x1ZGVBbGxTZWdtZW50ID8/IGdsb2JhbENvbmZpZz8uaW5jbHVkZUFsbFNlZ21lbnQgPz8gdHJ1ZSxcbiAgICAgICAgZGVidWc6IHNlZ21lbnRDb25maWc/LmRlYnVnID8/IGdsb2JhbENvbmZpZz8uZGVidWcgPz8gZmFsc2VcbiAgICB9O1xuICAgIFxuICAgIGlmICghbWVyZ2VkQ29uZmlnLmVuYWJsZWQpIHtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgIH1cbiAgICBcbiAgICAvLyA9PT0gUFJJT1JJVFkgMTogRXhwbGljaXQgc2VnbWVudCBmaWVsZHMgPT09XG4gICAgY29uc3QgZXhwbGljaXRGaWVsZHMgPSBzZWdtZW50Q29uZmlnPy5zZWdtZW50RmllbGRzIHx8IHNlZ21lbnRDb25maWc/LnNlZ21lbnRGaWVsZDtcbiAgICBpZiAoZXhwbGljaXRGaWVsZHMpIHtcbiAgICAgICAgY29uc3QgZmllbGROYW1lcyA9IHR5cGVvZiBleHBsaWNpdEZpZWxkcyA9PT0gJ3N0cmluZycgPyBbZXhwbGljaXRGaWVsZHNdIDogZXhwbGljaXRGaWVsZHM7XG4gICAgICAgIGNvbnN0IHJlc3VsdHM6IEFycmF5PHsgZmllbGQ6IFRJT1NjaGVtYUF0dHJpYnV0ZTsgc2NvcmU6IG51bWJlcjsgcmVhc29uOiBzdHJpbmcgfT4gPSBbXTtcbiAgICAgICAgXG4gICAgICAgIGZvciAoY29uc3QgZmllbGROYW1lIG9mIGZpZWxkTmFtZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGZpZWxkID0gQXJyYXkuZnJvbShwcm9wZXJ0aWVzLnZhbHVlcygpKS5maW5kKHAgPT4gcC5pZCA9PT0gZmllbGROYW1lKTtcbiAgICAgICAgICAgIGlmIChmaWVsZCkge1xuICAgICAgICAgICAgICAgIHJlc3VsdHMucHVzaCh7IGZpZWxkLCBzY29yZTogMTAwMCwgcmVhc29uOiAnZXhwbGljaXQgY29uZmlndXJhdGlvbicgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGlmIChyZXN1bHRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHJldHVybiByZXN1bHRzLnNsaWNlKDAsIG1lcmdlZENvbmZpZy5tYXhTZWdtZW50R3JvdXBzKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICAvLyA9PT0gRmlsdGVyIHByb3BlcnRpZXMgYmFzZWQgb24gaW5jbHVkZS9leGNsdWRlID09PVxuICAgIGxldCBjYW5kaWRhdGVQcm9wZXJ0aWVzID0gQXJyYXkuZnJvbShwcm9wZXJ0aWVzLnZhbHVlcygpKTtcbiAgICBcbiAgICAvLyBBcHBseSBpbmNsdWRlRmllbGRzIGZpbHRlciAoaWYgcHJvdmlkZWQsIE9OTFkgY29uc2lkZXIgdGhlc2UpXG4gICAgaWYgKHNlZ21lbnRDb25maWc/LmluY2x1ZGVGaWVsZHMgJiYgc2VnbWVudENvbmZpZy5pbmNsdWRlRmllbGRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY2FuZGlkYXRlUHJvcGVydGllcyA9IGNhbmRpZGF0ZVByb3BlcnRpZXMuZmlsdGVyKHAgPT4gXG4gICAgICAgICAgICBzZWdtZW50Q29uZmlnLmluY2x1ZGVGaWVsZHMhLmluY2x1ZGVzKHAuaWQpXG4gICAgICAgICk7XG4gICAgfVxuICAgIFxuICAgIC8vIEFwcGx5IGV4Y2x1ZGVGaWVsZHMgZmlsdGVyXG4gICAgaWYgKHNlZ21lbnRDb25maWc/LmV4Y2x1ZGVGaWVsZHMgJiYgc2VnbWVudENvbmZpZy5leGNsdWRlRmllbGRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY2FuZGlkYXRlUHJvcGVydGllcyA9IGNhbmRpZGF0ZVByb3BlcnRpZXMuZmlsdGVyKHAgPT4gXG4gICAgICAgICAgICAhc2VnbWVudENvbmZpZy5leGNsdWRlRmllbGRzIS5pbmNsdWRlcyhwLmlkKVxuICAgICAgICApO1xuICAgIH1cbiAgICBcbiAgICAvLyA9PT0gUFJJT1JJVFkgMjogUHJlZmVycmVkIGZpZWxkcyA9PT1cbiAgICBjb25zdCBwcmVmZXJyZWRGaWVsZHMgPSBtZXJnZWRDb25maWcucHJlZmVycmVkRmllbGRzO1xuICAgIGNvbnN0IHByZWZlcnJlZE1hdGNoZXM6IEFycmF5PHsgZmllbGQ6IFRJT1NjaGVtYUF0dHJpYnV0ZTsgc2NvcmU6IG51bWJlcjsgcmVhc29uOiBzdHJpbmcgfT4gPSBbXTtcbiAgICBcbiAgICBmb3IgKGNvbnN0IHByZWZlcnJlZE5hbWUgb2YgcHJlZmVycmVkRmllbGRzKSB7XG4gICAgICAgIGNvbnN0IGZpZWxkID0gY2FuZGlkYXRlUHJvcGVydGllcy5maW5kKHAgPT4gcC5pZCA9PT0gcHJlZmVycmVkTmFtZSk7XG4gICAgICAgIGlmIChmaWVsZCAmJiBpc1ZpYWJsZVNlZ21lbnRGaWVsZChmaWVsZCwgbWVyZ2VkQ29uZmlnKSkge1xuICAgICAgICAgICAgcHJlZmVycmVkTWF0Y2hlcy5wdXNoKHsgZmllbGQsIHNjb3JlOiA5MDAsIHJlYXNvbjogYHByZWZlcnJlZCBmaWVsZDogJHtwcmVmZXJyZWROYW1lfWAgfSk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLy8gSWYgd2UgaGF2ZSBlbm91Z2ggcHJlZmVycmVkIG1hdGNoZXMsIHJldHVybiB0aGVtXG4gICAgaWYgKHByZWZlcnJlZE1hdGNoZXMubGVuZ3RoID49IG1lcmdlZENvbmZpZy5tYXhTZWdtZW50R3JvdXBzKSB7XG4gICAgICAgIHJldHVybiBwcmVmZXJyZWRNYXRjaGVzLnNsaWNlKDAsIG1lcmdlZENvbmZpZy5tYXhTZWdtZW50R3JvdXBzKTtcbiAgICB9XG4gICAgXG4gICAgLy8gPT09IFBSSU9SSVRZIDM6IFNjb3JpbmcgYWxnb3JpdGhtID09PVxuICAgIGNvbnN0IGNhbmRpZGF0ZXM6IEFycmF5PHsgZmllbGQ6IFRJT1NjaGVtYUF0dHJpYnV0ZTsgc2NvcmU6IG51bWJlcjsgcmVhc29uOiBzdHJpbmc7IG9wdGlvbkNvdW50OiBudW1iZXIgfT4gPSBbXTtcbiAgICBcbiAgICAvLyBBZGQgcHJlZmVycmVkTWF0Y2hlcyB3aXRoIHRoZWlyIG9wdGlvbiBjb3VudHNcbiAgICBmb3IgKGNvbnN0IHBtIG9mIHByZWZlcnJlZE1hdGNoZXMpIHtcbiAgICAgICAgY29uc3Qgb3B0aW9uQ291bnQgPSBnZXRGaWVsZE9wdGlvbkNvdW50KHBtLmZpZWxkKTtcbiAgICAgICAgY2FuZGlkYXRlcy5wdXNoKHsgLi4ucG0sIG9wdGlvbkNvdW50IH0pO1xuICAgIH1cbiAgICBcbiAgICBmb3IgKGNvbnN0IHByb3Agb2YgY2FuZGlkYXRlUHJvcGVydGllcykge1xuICAgICAgICAvLyBTa2lwIGlmIGFscmVhZHkgaW4gcHJlZmVycmVkTWF0Y2hlc1xuICAgICAgICBpZiAocHJlZmVycmVkTWF0Y2hlcy5zb21lKHBtID0+IHBtLmZpZWxkLmlkID09PSBwcm9wLmlkKSkge1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIFNraXAgaWYgbm90IHZpYWJsZSAodGhpcyBmaWx0ZXJzIG91dCBmaWVsZHMgd2l0aCB0b28gbWFueSBvcHRpb25zKVxuICAgICAgICBpZiAoIWlzVmlhYmxlU2VnbWVudEZpZWxkKHByb3AsIG1lcmdlZENvbmZpZykpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBsZXQgc2NvcmUgPSAwO1xuICAgICAgICBjb25zdCByZWFzb25zOiBzdHJpbmdbXSA9IFtdO1xuICAgICAgICBjb25zdCBvcHRpb25Db3VudCA9IGdldEZpZWxkT3B0aW9uQ291bnQocHJvcCk7XG4gICAgICAgIFxuICAgICAgICAvLyAqKlNjb3JlIDE6IEZpZWxkIG5hbWUgbWF0Y2gqKiAocGFydGlhbCBtYXRjaCB3aXRoIHByZWZlcnJlZCBuYW1lcylcbiAgICAgICAgZm9yIChjb25zdCBwcmVmZXJyZWQgb2YgcHJlZmVycmVkRmllbGRzKSB7XG4gICAgICAgICAgICBpZiAocHJvcC5pZC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHByZWZlcnJlZC50b0xvd2VyQ2FzZSgpKSkge1xuICAgICAgICAgICAgICAgIHNjb3JlICs9IDUwO1xuICAgICAgICAgICAgICAgIHJlYXNvbnMucHVzaChgbmFtZSBjb250YWlucyBcIiR7cHJlZmVycmVkfVwiYCk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vICoqU2NvcmUgMjogUHJlZmVyIGZld2VyIG9wdGlvbnMgKGludmVyc2Ugc2NvcmluZykqKlxuICAgICAgICAvLyBGaWVsZHMgd2l0aCBmZXdlciBvcHRpb25zIGdldCBoaWdoZXIgc2NvcmVzXG4gICAgICAgIGNvbnN0IG1pblZhbHVlcyA9IG1lcmdlZENvbmZpZy5taW5WYWx1ZXM7XG4gICAgICAgIGNvbnN0IG1heFZhbHVlcyA9IG1lcmdlZENvbmZpZy5tYXhTZWdtZW50c1Blckdyb3VwO1xuICAgICAgICBcbiAgICAgICAgaWYgKG9wdGlvbkNvdW50ID49IG1pblZhbHVlcyAmJiBvcHRpb25Db3VudCA8PSBtYXhWYWx1ZXMpIHtcbiAgICAgICAgICAgIC8vIFNjb3JlIGludmVyc2VseSBwcm9wb3J0aW9uYWwgdG8gb3B0aW9uIGNvdW50XG4gICAgICAgICAgICAvLyAyIG9wdGlvbnMgPSArNDAsIDUgb3B0aW9ucyA9ICsyNSwgMTAgb3B0aW9ucyA9ICsxMFxuICAgICAgICAgICAgY29uc3Qgb3B0aW9uU2NvcmUgPSBNYXRoLm1heCgxMCwgNDAgLSAob3B0aW9uQ291bnQgLSBtaW5WYWx1ZXMpICogMyk7XG4gICAgICAgICAgICBzY29yZSArPSBvcHRpb25TY29yZTtcbiAgICAgICAgICAgIHJlYXNvbnMucHVzaChgJHtvcHRpb25Db3VudH0gb3B0aW9uc2ApO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyAqKlNjb3JlIDM6IEJvb2xlYW4gZmllbGQgZ2V0cyBoaWdoIHByaW9yaXR5IChvbmx5IDIgb3B0aW9ucykqKlxuICAgICAgICBpZiAocHJvcC50eXBlID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgICAgIHNjb3JlICs9IDU7ICAvLyBTbWFsbCBib251cyBzaW5jZSBvcHRpb24gY291bnQgYWxyZWFkeSBmYWN0b3JzIGluXG4gICAgICAgICAgICByZWFzb25zLnB1c2goJ2Jvb2xlYW4gZmllbGQnKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gKipTY29yZSA0OiBOYW1lIHBvc2l0aW9uIChlYXJsaWVyID0gc2xpZ2h0bHkgaGlnaGVyIHByaW9yaXR5KSoqXG4gICAgICAgIGNvbnN0IGZpZWxkSW5kZXggPSBjYW5kaWRhdGVQcm9wZXJ0aWVzLmluZGV4T2YocHJvcCk7XG4gICAgICAgIHNjb3JlIC09IE1hdGgubWluKGZpZWxkSW5kZXgsIDUpOyAgLy8gQ2FwIHBlbmFsdHkgYXQgNVxuICAgICAgICBcbiAgICAgICAgY2FuZGlkYXRlcy5wdXNoKHsgXG4gICAgICAgICAgICBmaWVsZDogcHJvcCwgXG4gICAgICAgICAgICBzY29yZSwgXG4gICAgICAgICAgICByZWFzb246IHJlYXNvbnMuam9pbignLCAnKSxcbiAgICAgICAgICAgIG9wdGlvbkNvdW50XG4gICAgICAgIH0pO1xuICAgIH1cbiAgICBcbiAgICAvLyBTb3J0IGJ5OiAxKSBzY29yZSAoaGlnaGVzdCBmaXJzdCksIDIpIG9wdGlvbiBjb3VudCAobG93ZXN0IGZpcnN0KVxuICAgIGNhbmRpZGF0ZXMuc29ydCgoYSwgYikgPT4ge1xuICAgICAgICBpZiAoYi5zY29yZSAhPT0gYS5zY29yZSkge1xuICAgICAgICAgICAgcmV0dXJuIGIuc2NvcmUgLSBhLnNjb3JlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBhLm9wdGlvbkNvdW50IC0gYi5vcHRpb25Db3VudDsgIC8vIFByZWZlciBmZXdlciBvcHRpb25zXG4gICAgfSk7XG4gICAgXG4gICAgY29uc3QgdG9wTlJlc3VsdHMgPSBjYW5kaWRhdGVzLnNsaWNlKDAsIG1lcmdlZENvbmZpZy5tYXhTZWdtZW50R3JvdXBzKTtcbiAgICBcbiAgICBpZiAodG9wTlJlc3VsdHMubGVuZ3RoID4gMCAmJiBtZXJnZWRDb25maWcuZGVidWcpIHtcbiAgICAgICAgRGVmYXVsdExvZ2dlci5pbmZvKGBbU2VnbWVudERldGVjdGlvbl0gU2VsZWN0ZWQgJHt0b3BOUmVzdWx0cy5sZW5ndGh9IGZpZWxkKHMpOmAsIHRvcE5SZXN1bHRzLm1hcChjID0+ICh7XG4gICAgICAgICAgICBmaWVsZDogYy5maWVsZC5pZCxcbiAgICAgICAgICAgIHNjb3JlOiBjLnNjb3JlLFxuICAgICAgICAgICAgb3B0aW9uQ291bnQ6IGMub3B0aW9uQ291bnQsXG4gICAgICAgICAgICByZWFzb246IGMucmVhc29uXG4gICAgICAgIH0pKSk7XG4gICAgfVxuICAgIFxuICAgIHJldHVybiB0b3BOUmVzdWx0cztcbn1cblxuLyoqXG4gKiBBdXRvLWdlbmVyYXRlIGZpbHRlciBzZWdtZW50cyBiYXNlZCBvbiBlbnRpdHkgYXR0cmlidXRlcyB1c2luZyBzbWFydCBkZXRlY3Rpb24uXG4gKiBcbiAqIEFsZ29yaXRobTpcbiAqIDEuIElmIGN1c3RvbSBzZWdtZW50cyBwcm92aWRlZCDihpIgdXNlIHRoZW0gKGhpZ2hlc3QgcHJpb3JpdHkpXG4gKiAyLiBJZiBlbnRpdHkgcmVxdWlyZXMgbWFudWFsIHNlZ21lbnRzIOKGkiBza2lwIGF1dG8tZ2VuZXJhdGlvblxuICogMy4gRGV0ZWN0IGJlc3QgZmllbGQgdXNpbmcgc2NvcmluZyBhbGdvcml0aG1cbiAqIDQuIEdlbmVyYXRlIHNlZ21lbnRzIGZyb20gZGV0ZWN0ZWQgZmllbGQgd2l0aCBzbWFydCBpY29uc1xuICovXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVTZWdtZW50czxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPHN0cmluZywgc3RyaW5nLCBzdHJpbmc+PihcbiAgICBwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+LFxuICAgIGVudGl0eVNlcnZpY2U/OiBCYXNlRW50aXR5U2VydmljZTxTPixcbiAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbJ3VpQ29uZmlnR2VuT3B0aW9ucyddLFxuICAgIGN1c3RvbVNlZ21lbnRzPzogUmVhZG9ubHlBcnJheTxJRmlsdGVyU2VnbWVudCB8IElGaWx0ZXJTZWdtZW50R3JvdXA+IHwgQXJyYXk8SUZpbHRlclNlZ21lbnQgfCBJRmlsdGVyU2VnbWVudEdyb3VwPlxuKTogUmVhZG9ubHlBcnJheTxJRmlsdGVyU2VnbWVudCB8IElGaWx0ZXJTZWdtZW50R3JvdXA+IHwgQXJyYXk8SUZpbHRlclNlZ21lbnQgfCBJRmlsdGVyU2VnbWVudEdyb3VwPiB8IHVuZGVmaW5lZCB7XG4gICAgLy8gMS4gSWYgY3VzdG9tIHNlZ21lbnRzIHByb3ZpZGVkLCB1c2UgdGhvc2UgKGhpZ2hlc3QgcHJpb3JpdHkpXG4gICAgaWYgKGN1c3RvbVNlZ21lbnRzICYmIGN1c3RvbVNlZ21lbnRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmV0dXJuIGN1c3RvbVNlZ21lbnRzO1xuICAgIH1cbiAgICBcbiAgICAvLyBHZXQgY29uZmlndXJhdGlvblxuICAgIGNvbnN0IGdsb2JhbFNlZ21lbnRDb25maWcgPSBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/LnRhYmxlVUk/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbjtcbiAgICBjb25zdCBlbnRpdHlNZXRhZGF0YSA9IGVudGl0eVNlcnZpY2U/LmdldEVudGl0eVNjaGVtYT8uKCkubW9kZWw/Lm1ldGFkYXRhO1xuICAgIGNvbnN0IGVudGl0eVNlZ21lbnRDb25maWcgPSBlbnRpdHlNZXRhZGF0YT8udGFibGVVSTtcbiAgICBcbiAgICAvLyAyLiBJZiBlbnRpdHkgcmVxdWlyZXMgbWFudWFsIHNlZ21lbnRzLCBza2lwIGF1dG8tZ2VuZXJhdGlvblxuICAgIGlmIChlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LnJlcXVpcmVNYW51YWwpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgXG4gICAgLy8gMy4gRGV0ZWN0IGJlc3Qgc2VnbWVudCBmaWVsZHMgKHJldHVybnMgYXJyYXkgbm93KVxuICAgIGNvbnN0IGRldGVjdGVkRmllbGRzID0gZGV0ZWN0U2VnbWVudEZpZWxkcyhwcm9wZXJ0aWVzLCBnbG9iYWxTZWdtZW50Q29uZmlnLCBlbnRpdHlTZWdtZW50Q29uZmlnKTtcbiAgICBcbiAgICBpZiAoZGV0ZWN0ZWRGaWVsZHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIC8vIE5vIHN1aXRhYmxlIGZpZWxkcyBmb3VuZFxuICAgICAgICBpZiAoZ2xvYmFsU2VnbWVudENvbmZpZz8uZGVidWcgfHwgZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5kZWJ1Zykge1xuICAgICAgICAgICAgRGVmYXVsdExvZ2dlci5pbmZvKGBbU2VnbWVudEdlbmVyYXRpb25dIE5vIHN1aXRhYmxlIGZpZWxkcyBkZXRlY3RlZCBmb3Igc2VnbWVudHNgKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBcbiAgICAvLyBHZXQgbWVyZ2VkIGNvbmZpZyBmb3IgdGhpcyBlbnRpdHlcbiAgICBjb25zdCBtZXJnZWRDb25maWc6IFJlcXVpcmVkPElTZWdtZW50QXV0b0dlbmVyYXRpb25Db25maWc+ICYgeyBtYXhTZWdtZW50R3JvdXBzOiBudW1iZXI7IG1heFNlZ21lbnRzUGVyR3JvdXA6IG51bWJlciB9ID0ge1xuICAgICAgICBlbmFibGVkOiBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmVuYWJsZWQgPz8gZ2xvYmFsU2VnbWVudENvbmZpZz8uZW5hYmxlZCA/PyB0cnVlLFxuICAgICAgICBwcmVmZXJyZWRGaWVsZHM6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8ucHJlZmVycmVkRmllbGRzIHx8IGdsb2JhbFNlZ21lbnRDb25maWc/LnByZWZlcnJlZEZpZWxkcyB8fCBbJ3N0YXR1cycsICdzdGF0ZScsICd0eXBlJywgJ2NhdGVnb3J5JywgJ3ByaW9yaXR5J10sXG4gICAgICAgIG1heFNlZ21lbnRHcm91cHM6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8ubWF4U2VnbWVudEdyb3VwcyA/PyBnbG9iYWxTZWdtZW50Q29uZmlnPy5tYXhTZWdtZW50R3JvdXBzID8/IDIsXG4gICAgICAgIG1heFNlZ21lbnRzUGVyR3JvdXA6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8ubWF4U2VnbWVudHNQZXJHcm91cCA/PyBnbG9iYWxTZWdtZW50Q29uZmlnPy5tYXhTZWdtZW50c1Blckdyb3VwID8/IDEwLFxuICAgICAgICBtaW5WYWx1ZXM6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8ubWluVmFsdWVzID8/IGdsb2JhbFNlZ21lbnRDb25maWc/Lm1pblZhbHVlcyA/PyAyLFxuICAgICAgICBpY29uTWFwcGluZzoge1xuICAgICAgICAgICAgLi4uREVGQVVMVF9JQ09OX01BUFBJTkcsXG4gICAgICAgICAgICAuLi5nbG9iYWxTZWdtZW50Q29uZmlnPy5pY29uTWFwcGluZyxcbiAgICAgICAgICAgIC4uLmVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uaWNvbk1hcHBpbmdcbiAgICAgICAgfSxcbiAgICAgICAgYm9vbGVhbkxhYmVsUGF0dGVybnM6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uYm9vbGVhbkxhYmVsUGF0dGVybnMgfHwgZ2xvYmFsU2VnbWVudENvbmZpZz8uYm9vbGVhbkxhYmVsUGF0dGVybnMgfHwgW10sXG4gICAgICAgIGRlZmF1bHRCb29sZWFuTGFiZWxzOiBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmRlZmF1bHRCb29sZWFuTGFiZWxzIHx8IGdsb2JhbFNlZ21lbnRDb25maWc/LmRlZmF1bHRCb29sZWFuTGFiZWxzIHx8IHsgdHJ1ZTogJ1llcycsIGZhbHNlOiAnTm8nIH0sXG4gICAgICAgIGluY2x1ZGVBbGxTZWdtZW50OiBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmluY2x1ZGVBbGxTZWdtZW50ID8/IGdsb2JhbFNlZ21lbnRDb25maWc/LmluY2x1ZGVBbGxTZWdtZW50ID8/IHRydWUsXG4gICAgICAgIGRlYnVnOiBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmRlYnVnID8/IGdsb2JhbFNlZ21lbnRDb25maWc/LmRlYnVnID8/IGZhbHNlXG4gICAgfTtcbiAgICBcbiAgICBpZiAobWVyZ2VkQ29uZmlnLmRlYnVnKSB7XG4gICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW1NlZ21lbnRHZW5lcmF0aW9uXSBHZW5lcmF0aW5nIHNlZ21lbnRzIGZvciAke2RldGVjdGVkRmllbGRzLmxlbmd0aH0gZmllbGQocyk6YCwgZGV0ZWN0ZWRGaWVsZHMubWFwKGQgPT4gZC5maWVsZC5pZCkpO1xuICAgIH1cbiAgICBcbiAgICAvLyA0LiBHZW5lcmF0ZSBzZWdtZW50IGdyb3VwcyAob25lIHBlciBkZXRlY3RlZCBmaWVsZClcbiAgICBjb25zdCBzZWdtZW50R3JvdXBzOiBBcnJheTxJRmlsdGVyU2VnbWVudEdyb3VwPiA9IFtdO1xuICAgIFxuICAgIGZvciAoY29uc3QgZGV0ZWN0aW9uIG9mIGRldGVjdGVkRmllbGRzKSB7XG4gICAgICAgIGNvbnN0IHsgZmllbGQgfSA9IGRldGVjdGlvbjtcbiAgICAgICAgXG4gICAgICAgIC8vIEdlbmVyYXRlIHNlZ21lbnRzIGZvciB0aGlzIGZpZWxkXG4gICAgICAgIGNvbnN0IHNlZ21lbnRzOiBBcnJheTxJRmlsdGVyU2VnbWVudD4gPSBbXTtcbiAgICAgICAgXG4gICAgICAgIC8vIEFkZCBcIkFsbFwiIHNlZ21lbnQgaWYgZW5hYmxlZFxuICAgICAgICBpZiAobWVyZ2VkQ29uZmlnLmluY2x1ZGVBbGxTZWdtZW50KSB7XG4gICAgICAgICAgICBzZWdtZW50cy5wdXNoKHtcbiAgICAgICAgICAgICAgICBpZDogYGFsbC0ke2ZpZWxkLmlkfWAsXG4gICAgICAgICAgICAgICAgbGFiZWw6ICdBbGwnLFxuICAgICAgICAgICAgICAgIGZpbHRlcnM6IHt9LFxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6IHRydWVcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBHZXQgdmFsdWVzIGZyb20gZmllbGRcbiAgICAgICAgbGV0IHZhbHVlczogKHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4pW10gPSBbXTtcbiAgICAgICAgbGV0IHZhbHVlTGFiZWxzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307ICAvLyBGb3IgY3VzdG9tIGJvb2xlYW4gbGFiZWxzXG4gICAgICAgIFxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShmaWVsZC50eXBlKSkge1xuICAgICAgICAgICAgLy8gRW51bSB0eXBlIGFycmF5XG4gICAgICAgICAgICB2YWx1ZXMgPSBmaWVsZC50eXBlO1xuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkLnR5cGUgPT09ICdib29sZWFuJykge1xuICAgICAgICAgICAgLy8gQm9vbGVhbiBmaWVsZCB3aXRoIG9wdGlvbmFsIGN1c3RvbSBsYWJlbHNcbiAgICAgICAgICAgIHZhbHVlcyA9IFt0cnVlLCBmYWxzZV07XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIDEuIENoZWNrIGZvciBleHBsaWNpdCBmaWVsZC1sZXZlbCBib29sZWFuTGFiZWxzXG4gICAgICAgICAgICBjb25zdCBmaWVsZEJvb2xlYW5MYWJlbHMgPSAnYm9vbGVhbkxhYmVscycgaW4gZmllbGQgPyBmaWVsZC5ib29sZWFuTGFiZWxzIDogdW5kZWZpbmVkO1xuICAgICAgICAgICAgaWYgKGZpZWxkQm9vbGVhbkxhYmVscyAmJiB0eXBlb2YgZmllbGRCb29sZWFuTGFiZWxzID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgICAgIHZhbHVlTGFiZWxzWyd0cnVlJ10gPSBmaWVsZEJvb2xlYW5MYWJlbHMudHJ1ZSB8fCAnWWVzJztcbiAgICAgICAgICAgICAgICB2YWx1ZUxhYmVsc1snZmFsc2UnXSA9IGZpZWxkQm9vbGVhbkxhYmVscy5mYWxzZSB8fCAnTm8nO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAvLyAyLiBUcnkgaW50ZWxsaWdlbnQgZXh0cmFjdGlvbiBmcm9tIGZpZWxkIG5hbWVcbiAgICAgICAgICAgICAgICBjb25zdCBmaWVsZE5hbWUgPSBmaWVsZC5pZDtcbiAgICAgICAgICAgICAgICBjb25zdCBleHRyYWN0ZWQgPSBleHRyYWN0Qm9vbGVhbkxhYmVsc0Zyb21GaWVsZE5hbWUoZmllbGROYW1lKTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoZXh0cmFjdGVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhbHVlTGFiZWxzWyd0cnVlJ10gPSBleHRyYWN0ZWQudHJ1ZUxhYmVsO1xuICAgICAgICAgICAgICAgICAgICB2YWx1ZUxhYmVsc1snZmFsc2UnXSA9IGV4dHJhY3RlZC5mYWxzZUxhYmVsO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIDMuIFRyeSB0byBtYXRjaCBhZ2FpbnN0IGNvbmZpZ3VyZWQgcGF0dGVybnNcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGF0dGVybnMgPSBtZXJnZWRDb25maWcuYm9vbGVhbkxhYmVsUGF0dGVybnM7XG4gICAgICAgICAgICAgICAgICAgIGxldCBtYXRjaGVkID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICBpZiAocGF0dGVybnMgJiYgcGF0dGVybnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBwYXR0ZXJuIG9mIHBhdHRlcm5zKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVnZXggPSBwYXR0ZXJuLnBhdHRlcm4gaW5zdGFuY2VvZiBSZWdFeHAgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gcGF0dGVybi5wYXR0ZXJuIFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IG5ldyBSZWdFeHAocGF0dGVybi5wYXR0ZXJuLCAnaScpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChyZWdleC50ZXN0KGZpZWxkTmFtZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbJ3RydWUnXSA9IHBhdHRlcm4udHJ1ZUxhYmVsO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZUxhYmVsc1snZmFsc2UnXSA9IHBhdHRlcm4uZmFsc2VMYWJlbDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWF0Y2hlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgLy8gNC4gVXNlIGRlZmF1bHQgZmFsbGJhY2sgaWYgbm8gcGF0dGVybiBtYXRjaGVkXG4gICAgICAgICAgICAgICAgICAgIGlmICghbWF0Y2hlZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGVmYXVsdHMgPSBtZXJnZWRDb25maWcuZGVmYXVsdEJvb2xlYW5MYWJlbHMgfHwgeyB0cnVlOiAnWWVzJywgZmFsc2U6ICdObycgfTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlTGFiZWxzWyd0cnVlJ10gPSBkZWZhdWx0cy50cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbJ2ZhbHNlJ10gPSBkZWZhdWx0cy5mYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmICgoZmllbGQuZmllbGRUeXBlID09PSAnc2VsZWN0JyB8fCBmaWVsZC5maWVsZFR5cGUgPT09ICdyYWRpbycgfHwgZmllbGQuZmllbGRUeXBlID09PSAnY2hlY2tib3gnIHx8IGZpZWxkLmZpZWxkVHlwZSA9PT0gJ211bHRpLXNlbGVjdCcpICYmIEFycmF5LmlzQXJyYXkoKGZpZWxkIGFzIGFueSkub3B0aW9ucykpIHtcbiAgICAgICAgICAgIC8vIFNlbGVjdC9yYWRpby9jaGVja2JveCBmaWVsZCB3aXRoIGlubGluZSBvcHRpb25zXG4gICAgICAgICAgICBjb25zdCBvcHRpb25zID0gKGZpZWxkIGFzIGFueSkub3B0aW9ucyBhcyBBcnJheTx7IGxhYmVsOiBzdHJpbmc7IHZhbHVlOiBzdHJpbmcgfT47XG4gICAgICAgICAgICB2YWx1ZXMgPSBvcHRpb25zLm1hcChvcHQgPT4gb3B0LnZhbHVlKTtcbiAgICAgICAgICAgIC8vIFN0b3JlIGxhYmVscyBmb3IgbGF0ZXIgdXNlXG4gICAgICAgICAgICBvcHRpb25zLmZvckVhY2gob3B0ID0+IHtcbiAgICAgICAgICAgICAgICB2YWx1ZUxhYmVsc1tTdHJpbmcob3B0LnZhbHVlKV0gPSBvcHQubGFiZWw7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gQXBwbHkgZmllbGQtc3BlY2lmaWMgdmFsdWUgZmlsdGVycyBmaXJzdCwgdGhlbiBnbG9iYWxcbiAgICAgICAgY29uc3QgaW5jbHVkZVZhbHVlc0J5RmllbGQgPSBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmluY2x1ZGVWYWx1ZXNCeUZpZWxkO1xuICAgICAgICBjb25zdCBpbmNsdWRlVmFsdWVzID0gaW5jbHVkZVZhbHVlc0J5RmllbGQ/LltmaWVsZC5pZF0gfHwgZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5pbmNsdWRlVmFsdWVzO1xuICAgICAgICBpZiAoaW5jbHVkZVZhbHVlcykge1xuICAgICAgICAgICAgdmFsdWVzID0gdmFsdWVzLmZpbHRlcih2ID0+IGluY2x1ZGVWYWx1ZXMuaW5jbHVkZXMoU3RyaW5nKHYpKSk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGNvbnN0IGV4Y2x1ZGVWYWx1ZXNCeUZpZWxkID0gZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5leGNsdWRlVmFsdWVzQnlGaWVsZDtcbiAgICAgICAgY29uc3QgZXhjbHVkZVZhbHVlcyA9IGV4Y2x1ZGVWYWx1ZXNCeUZpZWxkPy5bZmllbGQuaWRdIHx8IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uZXhjbHVkZVZhbHVlcztcbiAgICAgICAgaWYgKGV4Y2x1ZGVWYWx1ZXMpIHtcbiAgICAgICAgICAgIHZhbHVlcyA9IHZhbHVlcy5maWx0ZXIodiA9PiAhZXhjbHVkZVZhbHVlcy5pbmNsdWRlcyhTdHJpbmcodikpKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gQXBwbHkgZmllbGQtc3BlY2lmaWMgc29ydCBvcmRlciBmaXJzdCwgdGhlbiBnbG9iYWxcbiAgICAgICAgY29uc3Qgc29ydE9yZGVyQnlGaWVsZCA9IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uc29ydE9yZGVyQnlGaWVsZDtcbiAgICAgICAgY29uc3Qgc29ydE9yZGVyID0gc29ydE9yZGVyQnlGaWVsZD8uW2ZpZWxkLmlkXSB8fCBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LnNvcnRPcmRlcjtcbiAgICAgICAgaWYgKHNvcnRPcmRlcikge1xuICAgICAgICAgICAgdmFsdWVzLnNvcnQoKGEsIGIpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBhSW5kZXggPSBzb3J0T3JkZXIuaW5kZXhPZihTdHJpbmcoYSkpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGJJbmRleCA9IHNvcnRPcmRlci5pbmRleE9mKFN0cmluZyhiKSk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gSWYgYm90aCBpbiBzb3J0T3JkZXIsIHVzZSB0aGF0IG9yZGVyXG4gICAgICAgICAgICAgICAgaWYgKGFJbmRleCA+PSAwICYmIGJJbmRleCA+PSAwKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBhSW5kZXggLSBiSW5kZXg7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIC8vIElmIG9ubHkgb25lIGluIHNvcnRPcmRlciwgaXQgY29tZXMgZmlyc3RcbiAgICAgICAgICAgICAgICBpZiAoYUluZGV4ID49IDApIHJldHVybiAtMTtcbiAgICAgICAgICAgICAgICBpZiAoYkluZGV4ID49IDApIHJldHVybiAxO1xuICAgICAgICAgICAgICAgIC8vIE5laXRoZXIgaW4gc29ydE9yZGVyLCBtYWludGFpbiBvcmlnaW5hbCBvcmRlclxuICAgICAgICAgICAgICAgIHJldHVybiAwO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIEdlbmVyYXRlIHNlZ21lbnQgZm9yIGVhY2ggdmFsdWVcbiAgICAgICAgZm9yIChjb25zdCB2YWx1ZSBvZiB2YWx1ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IHZhbHVlU3RyID0gU3RyaW5nKHZhbHVlKTtcbiAgICAgICAgICAgIGNvbnN0IHZhbHVlTG93ZXIgPSB2YWx1ZVN0ci50b0xvd2VyQ2FzZSgpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBVc2UgY3VzdG9tIGxhYmVsIGlmIGF2YWlsYWJsZSwgb3RoZXJ3aXNlIGZvcm1hdCB0aGUgdmFsdWVcbiAgICAgICAgICAgIGNvbnN0IHNlZ21lbnRMYWJlbCA9IHZhbHVlTGFiZWxzW3ZhbHVlU3RyXSB8fCBwYXNjYWxDYXNlKHZhbHVlU3RyKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgc2VnbWVudHMucHVzaCh7XG4gICAgICAgICAgICAgICAgaWQ6IGAke2ZpZWxkLmlkfS0ke3ZhbHVlTG93ZXIucmVwbGFjZSgvW15hLXowLTldKy9nLCAnLScpfWAsICAvLyBVbmlxdWUgSURcbiAgICAgICAgICAgICAgICBsYWJlbDogc2VnbWVudExhYmVsLCAgLy8gQ3VzdG9tIG9yIGZvcm1hdHRlZCBsYWJlbFxuICAgICAgICAgICAgICAgIGljb246IG1lcmdlZENvbmZpZy5pY29uTWFwcGluZ1t2YWx1ZUxvd2VyXSwgIC8vIFNtYXJ0IGljb24gbG9va3VwXG4gICAgICAgICAgICAgICAgZmlsdGVyczoge1xuICAgICAgICAgICAgICAgICAgICBbZmllbGQuaWRdOiB7IGVxOiB2YWx1ZSB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIE9ubHkgYWRkIGdyb3VwIGlmIHdlIGhhdmUgc2VnbWVudHNcbiAgICAgICAgY29uc3QgbWluU2VnbWVudHMgPSBtZXJnZWRDb25maWcuaW5jbHVkZUFsbFNlZ21lbnQgPyAxIDogMDtcbiAgICAgICAgaWYgKHNlZ21lbnRzLmxlbmd0aCA+IG1pblNlZ21lbnRzKSB7XG4gICAgICAgICAgICAvLyBBdXRvLWdlbmVyYXRlIGxhYmVsIG9yIHVzZSBleHBsaWNpdCBncm91cExhYmVsc1xuICAgICAgICAgICAgY29uc3QgY3VzdG9tR3JvdXBMYWJlbHMgPSBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/Lmdyb3VwTGFiZWxzO1xuICAgICAgICAgICAgY29uc3QgbGFiZWwgPSBjdXN0b21Hcm91cExhYmVscz8uW2ZpZWxkLmlkXSB8fCBgQnkgJHtwYXNjYWxDYXNlKGZpZWxkLmlkKX1gO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBzZWdtZW50R3JvdXBzLnB1c2goe1xuICAgICAgICAgICAgICAgIGlkOiBgJHtmaWVsZC5pZH0tZ3JvdXBgLFxuICAgICAgICAgICAgICAgIGxhYmVsLFxuICAgICAgICAgICAgICAgIHNlZ21lbnRzLFxuICAgICAgICAgICAgICAgIGRlZmF1bHRTZWdtZW50SWQ6IHNlZ21lbnRzLmZpbmQocyA9PiBzLmRlZmF1bHQpPy5pZCxcbiAgICAgICAgICAgICAgICBtYXhWaXNpYmxlOiBtZXJnZWRDb25maWcubWF4U2VnbWVudHNQZXJHcm91cFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLy8gUmV0dXJuIHNlZ21lbnQgZ3JvdXBzIChvciB1bmRlZmluZWQgaWYgbm9uZSBnZW5lcmF0ZWQpXG4gICAgaWYgKHNlZ21lbnRHcm91cHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIFxuICAgIC8vIElmIG9ubHkgMSBncm91cCB3aXRoIHNpbXBsZSBjb25maWcsIHJldHVybiBmbGF0IHNlZ21lbnRzIGZvciBiYWNrd2FyZHMgY29tcGF0aWJpbGl0eVxuICAgIC8vIFRoaXMgbWFpbnRhaW5zIGxlZ2FjeSBiZWhhdmlvciB3aGVuIG1heFNlZ21lbnRHcm91cHMgPSAxXG4gICAgaWYgKHNlZ21lbnRHcm91cHMubGVuZ3RoID09PSAxICYmIG1lcmdlZENvbmZpZy5tYXhTZWdtZW50R3JvdXBzID09PSAxKSB7XG4gICAgICAgIHJldHVybiBzZWdtZW50R3JvdXBzWzBdLnNlZ21lbnRzO1xuICAgIH1cbiAgICBcbiAgICByZXR1cm4gc2VnbWVudEdyb3Vwcztcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFTlRJVFkgQVRUUklCVVRFIEZPUk1BVFRJTkdcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKFxuICAgIHRoaXNQcm9wOiBUSU9TY2hlbWFBdHRyaWJ1dGUsXG4gICAgdHlwZTogJ2NyZWF0ZScgfCAndXBkYXRlJyB8ICdkZXRhaWwnLFxuICAgIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sXG4gICAgYWxsUHJvcGVydGllcz86IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLCAgLy8gT3B0aW9uYWw6IGZvciBkZXRlY3RpbmcgZHVwbGljYXRlZCByZWxhdGlvbiBmaWVsZHNcbiAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbJ3VpQ29uZmlnR2VuT3B0aW9ucyddICAvLyBPcHRpb25hbDogZ2xvYmFsIFVJIGNvbmZpZyBvcHRpb25zXG4pIHtcbiAgICBjb25zdCBmb3JtYXR0ZWQ6IGFueSA9IHtcbiAgICAgICAgLi4udGhpc1Byb3AsXG4gICAgICAgIGxhYmVsOiB0aGlzUHJvcC5uYW1lLCAgLy8gUmVzcGVjdCBjdXN0b20gbGFiZWwgZnJvbSBlbnRpdHkgYXR0cmlidXRlXG4gICAgICAgIGNvbHVtbjogdGhpc1Byb3AuaWQsXG4gICAgICAgIGZpZWxkVHlwZTogdGhpc1Byb3AuZmllbGRUeXBlIHx8ICd0ZXh0JywgIC8vIGZpZWxkVHlwZSBzaG91bGQgYWxyZWFkeSBiZSBpbmZlcnJlZCBpbiBiYXNlLXNlcnZpY2VcbiAgICAgICAgaGlkZGVuOiB0aGlzUHJvcC5oYXNPd25Qcm9wZXJ0eSgnaXNWaXNpYmxlJykgJiYgIXRoaXNQcm9wLmlzVmlzaWJsZVxuICAgIH07XG5cbiAgICAvLyBIYW5kbGUgYWRkTmV3T3B0aW9uIChPTEQgLSBkZXByZWNhdGVkLCBnZW5lcmF0ZXMgZW1iZWRkZWQgY29uZmlnKSBvciBhZGROZXdPcHRpb25Db25maWcgKE5FVyAtIGp1c3QgcGFzcyB0aHJvdWdoIHJlZmVyZW5jZSlcbiAgICBpZiAoaXNTZWxlY3RGaWVsZE1ldGFkYXRhKHRoaXNQcm9wKSAmJiBbICdjcmVhdGUnLCAndXBkYXRlJyBdLmluY2x1ZGVzKHR5cGUpKSB7XG4gICAgICAgIGNvbnN0IHNlbGVjdEZpZWxkID0gdGhpc1Byb3AgYXMgU2VsZWN0RmllbGRNZXRhZGF0YTtcbiAgICAgICAgXG4gICAgICAgIGlmIChzZWxlY3RGaWVsZC5hZGROZXdPcHRpb25Db25maWcpIHtcbiAgICAgICAgICAgIC8vIE5FVyBXQVk6IFVzZXIgcHJvdmlkZWQgYWRkTmV3T3B0aW9uQ29uZmlnIHJlZmVyZW5jZSAtIGp1c3QgcGFzcyBpdCB0aHJvdWdoXG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdhZGROZXdPcHRpb25Db25maWcnIF0gPSBzZWxlY3RGaWVsZC5hZGROZXdPcHRpb25Db25maWc7XG4gICAgICAgICAgICBcbiAgICAgICAgfSBlbHNlIGlmIChzZWxlY3RGaWVsZC5hZGROZXdPcHRpb24pIHtcbiAgICAgICAgICAgIC8vIE9MRCBXQVkgKERFUFJFQ0FURUQpOiBUcmFuc2Zvcm0gYWRkTmV3T3B0aW9uIHRvIGFkZE5ld09wdGlvbkNvbmZpZyBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxuICAgICAgICAgICAgY29uc3QgeyBlbnRpdHlOYW1lLCBvdmVycmlkZUNvbmZpZyB9ID0gc2VsZWN0RmllbGQuYWRkTmV3T3B0aW9uO1xuXG4gICAgICAgICAgICBpZiAoZW50aXR5TmFtZSAmJiBlbnRpdHlTZXJ2aWNlLmhhc0VudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUoZW50aXR5TmFtZSkpIHtcbiAgICAgICAgICAgICAgICBmb3JtYXR0ZWRbICdhZGROZXdPcHRpb25Db25maWcnIF0gPSB7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnY3JlYXRlJyxcbiAgICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IG92ZXJyaWRlQ29uZmlnIHx8IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN1Ym1pdFN1Y2Nlc3NSZWRpcmVjdDogdW5kZWZpbmVkLCAgLy8gU3RheSBpbiBtb2RhbCBhZnRlciBjcmVhdGlvblxuICAgICAgICAgICAgICAgICAgICAgICAgZm9ybUJ1dHRvbnM6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7IHRleHQ6IFwiQWRkXCIsIGFjdGlvbjogXCJzdWJtaXRcIiB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsgdGV4dDogXCJDYW5jZWxcIiwgYWN0aW9uOiBcImNhbmNlbFwiIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsOiBDb3VsZCBub3QgZmluZCByZWxhdGVkLWVudGl0eS1zZXJ2aWNlIGZvciBlbnRpdHkgWyR7ZW50aXR5TmFtZX1dIGluICR7ZW50aXR5U2VydmljZS5jb25zdHJ1Y3Rvci5uYW1lfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gSGFuZGxlIHJlbGF0aW9uIGZpZWxkcyAoREFUQSBMQVlFUiArIFVJIExBWUVSKVxuICAgIGlmICh0aGlzUHJvcC5yZWxhdGlvbiAmJiB0eXBlID09PSAnZGV0YWlsJykge1xuICAgICAgICBjb25zdCByZWxhdGlvbiA9IHRoaXNQcm9wLnJlbGF0aW9uO1xuICAgICAgICBjb25zdCB7IGVudGl0eU5hbWUsIHR5cGU6IHJlbGF0aW9uVHlwZSwgaWRlbnRpZmllcnMgfSA9IHJlbGF0aW9uO1xuICAgICAgICBjb25zdCBlbnRpdHlOYW1lTG93ZXIgPSBlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCk7XG5cbiAgICAgICAgaWYgKCFlbnRpdHlTZXJ2aWNlLmhhc0VudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUoZW50aXR5TmFtZSkpIHtcbiAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsOiBDb3VsZCBub3QgZmluZCByZWxhdGVkLWVudGl0eS1zZXJ2aWNlIGZvciBlbnRpdHkgWyR7ZW50aXR5TmFtZX1dIGluICR7ZW50aXR5U2VydmljZS5jb25zdHJ1Y3Rvci5uYW1lfWApO1xuICAgICAgICAgICAgcmV0dXJuIGZvcm1hdHRlZDtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFJlc29sdmUgaWRlbnRpZmllcnMgKGNvdWxkIGJlIGRpcmVjdCB2YWx1ZSBvciBsYXp5IGZ1bmN0aW9uKVxuICAgICAgICBjb25zdCByZXNvbHZlZElkZW50aWZpZXJzID0gdHlwZW9mIGlkZW50aWZpZXJzID09PSAnZnVuY3Rpb24nID8gaWRlbnRpZmllcnMoKSA6IGlkZW50aWZpZXJzO1xuXG4gICAgICAgIC8vIFNhZmV0eSBjaGVjayBmb3IgYXJyYXkgaWRlbnRpZmllcnNcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkocmVzb2x2ZWRJZGVudGlmaWVycykpIHtcbiAgICAgICAgICAgIGlmIChyZXNvbHZlZElkZW50aWZpZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsOiBFbXB0eSBpZGVudGlmaWVycyBhcnJheSBmb3IgcmVsYXRpb24gWyR7ZW50aXR5TmFtZX1dYCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZvcm1hdHRlZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEhhbmRsZSBib3RoIHNpbmdsZSBhbmQgbXVsdGlwbGUgaWRlbnRpZmllcnMgZm9yIGNvbXBvc2l0ZSBrZXlzXG4gICAgICAgIGNvbnN0IGlkZW50aWZpZXJNYXBwaW5ncyA9IEFycmF5LmlzQXJyYXkocmVzb2x2ZWRJZGVudGlmaWVycykgXG4gICAgICAgICAgICA/IHJlc29sdmVkSWRlbnRpZmllcnMubWFwKGlkID0+ICh7XG4gICAgICAgICAgICAgICAgc291cmNlOiBTdHJpbmcoaWQuc291cmNlKSxcbiAgICAgICAgICAgICAgICB0YXJnZXQ6IFN0cmluZyhpZC50YXJnZXQpXG4gICAgICAgICAgICAgIH0pKVxuICAgICAgICAgICAgOiBbe1xuICAgICAgICAgICAgICAgIHNvdXJjZTogU3RyaW5nKHJlc29sdmVkSWRlbnRpZmllcnMuc291cmNlKSxcbiAgICAgICAgICAgICAgICB0YXJnZXQ6IFN0cmluZyhyZXNvbHZlZElkZW50aWZpZXJzLnRhcmdldClcbiAgICAgICAgICAgICAgfV07XG5cbiAgICAgICAgLy8gRm9yIHJvdXRlIHBhdHRlcm4gYW5kIGRlZmF1bHQgZmlsdGVycywgdXNlIHRoZSBmaXJzdCBpZGVudGlmaWVyXG4gICAgICAgIC8vIChtb3N0IGVudGl0aWVzIGhhdmUgc2luZ2xlIGlkZW50aWZpZXI7IGNvbXBvc2l0ZSBrZXlzIG5lZWQgZXhwbGljaXQgcm91dGVQYXR0ZXJuKVxuICAgICAgICBjb25zdCBwcmltYXJ5SWRlbnRpZmllciA9IGlkZW50aWZpZXJNYXBwaW5nc1swXTtcblxuICAgICAgICAvLyBDaGVjayBpZiB1c2VyIHByb3ZpZGVkIGN1c3RvbSBVSSBjb25maWcgaW4gcmVsYXRpb25Db25maWcgKG9wdGlvbmFsIG92ZXJyaWRlKVxuICAgICAgICBjb25zdCB1c2VyUmVsYXRpb25Db25maWcgPSB0aGlzUHJvcC5yZWxhdGlvbkNvbmZpZyBhcyBJUmVsYXRpb25GaWVsZENvbmZpZyB8IHVuZGVmaW5lZDtcblxuICAgICAgICAvLyBHZXQgcmVsYXRlZCBlbnRpdHkgc2VydmljZSBmb3IgbWV0YWRhdGEgKGljb24sIGV0Yy4pXG4gICAgICAgIGNvbnN0IHJlbGF0ZWRFbnRpdHlTZXJ2aWNlID0gZW50aXR5U2VydmljZS5oYXNFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKGVudGl0eU5hbWUpIFxuICAgICAgICAgICAgPyBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUoZW50aXR5TmFtZSlcbiAgICAgICAgICAgIDogdW5kZWZpbmVkO1xuICAgICAgICBcbiAgICAgICAgLy8gR2V0IGVudGl0eSBtZXRhZGF0YSBmb3IgaWNvbiBhbmQgZmFsbGJhY2sgZ2VuZXJhdGlvblxuICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5TWV0YWRhdGEgPSByZWxhdGVkRW50aXR5U2VydmljZT8uZ2V0RW50aXR5U2NoZW1hPy4oKS5tb2RlbDtcbiAgICAgICAgY29uc3QgZGVmYXVsdEljb24gPSByZWxhdGVkRW50aXR5TWV0YWRhdGE/Lm1ldGFkYXRhPy5pY29uO1xuXG4gICAgICAgIGlmIChyZWxhdGlvblR5cGUuZW5kc1dpdGgoJ3RvLW9uZScpKSB7XG4gICAgICAgICAgICAvLyBUTy1PTkU6IFNob3cgdmFsdWUgYXMgbGluayArIG1vZGFsIGljb25cbiAgICAgICAgICAgIC8vIFJvdXRlIHBhdHRlcm46IFVzZSBjdXN0b20gKGZyb20gcmVsYXRpb25Db25maWcpIG9yIGRlZmF1bHQgdG8gL3ZpZXcte2VudGl0eX0vOnRhcmdldElkXG4gICAgICAgICAgICBjb25zdCByb3V0ZVBhdHRlcm4gPSB1c2VyUmVsYXRpb25Db25maWc/LnJvdXRlUGF0dGVybiBcbiAgICAgICAgICAgICAgICB8fCBgL3ZpZXctJHtlbnRpdHlOYW1lTG93ZXJ9Lzoke3ByaW1hcnlJZGVudGlmaWVyLnRhcmdldH1gO1xuXG4gICAgICAgICAgICAvLyBHZW5lcmF0ZSBmYWxsYmFjayBjb25maWd1cmF0aW9uIGZvciB3aGVuIG9ubHkgSUQgaXMgYXZhaWxhYmxlXG4gICAgICAgICAgICBjb25zdCBmYWxsYmFja0NvbmZpZyA9IGdlbmVyYXRlUmVsYXRpb25GYWxsYmFjayhcbiAgICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgIHByaW1hcnlJZGVudGlmaWVyLnNvdXJjZSxcbiAgICAgICAgICAgICAgICByZWxhdGVkRW50aXR5U2VydmljZVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgLy8gQXV0by1kZXRlY3QgZHVwbGljYXRlZCByZWxhdGlvbiBmaWVsZCAoZS5nLiwgdGVhbU5hbWUgZm9yIHRlYW1JZClcbiAgICAgICAgICAgIC8vIE5FVzogVXNlIGVuaGFuY2VkIGRldGVjdGlvbiB3aXRoIGNvbmZpZyBzdXBwb3J0XG4gICAgICAgICAgICBsZXQgYXV0b1RlbXBsYXRlOiBzdHJpbmcgfCB1bmRlZmluZWQgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICBsZXQgZGV0ZWN0aW9uTWV0YWRhdGE6IGFueSA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgYXV0by1kZXRlY3Rpb24gaXMgZW5hYmxlZCAoZGVmYXVsdDogdHJ1ZSlcbiAgICAgICAgICAgIGNvbnN0IGF1dG9EZXRlY3RFbmFibGVkID0gdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5hdXRvRGV0ZWN0ICE9PSBmYWxzZTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGF1dG9EZXRlY3RFbmFibGVkICYmIGFsbFByb3BlcnRpZXMpIHtcbiAgICAgICAgICAgICAgICAvLyBHZXQgZ2xvYmFsIGNvbmZpZyAocGFzc2VkIGZyb20gZncyNCBpbml0aWFsaXphdGlvbilcbiAgICAgICAgICAgICAgICBjb25zdCBnbG9iYWxDb25maWcgPSBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/LmR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbjtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBHZXQgZW50aXR5LWxldmVsIGNvbmZpZyBmcm9tIGVudGl0eSBtZXRhZGF0YVxuICAgICAgICAgICAgICAgIGNvbnN0IGVudGl0eUNvbmZpZyA9IHJlbGF0ZWRFbnRpdHlNZXRhZGF0YT8ubWV0YWRhdGE/LmR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbjtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBHZXQgcmVsYXRpb24tbGV2ZWwgaGludHNcbiAgICAgICAgICAgICAgICBjb25zdCByZWxhdGlvbkhpbnRzID0gdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5hdXRvRGV0ZWN0SGludHM7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gUnVuIGVuaGFuY2VkIGRldGVjdGlvblxuICAgICAgICAgICAgICAgIGNvbnN0IGRldGVjdGlvblJlc3VsdCA9IGRldGVjdER1cGxpY2F0ZWRSZWxhdGlvbkZpZWxkcyhcbiAgICAgICAgICAgICAgICAgICAgYWxsUHJvcGVydGllcyxcbiAgICAgICAgICAgICAgICAgICAgdGhpc1Byb3AuaWQsXG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGdsb2JhbENvbmZpZyxcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5Q29uZmlnLFxuICAgICAgICAgICAgICAgICAgICByZWxhdGlvbkhpbnRzXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBpZiAoZGV0ZWN0aW9uUmVzdWx0KSB7XG4gICAgICAgICAgICAgICAgICAgIGF1dG9UZW1wbGF0ZSA9IGRldGVjdGlvblJlc3VsdC50ZW1wbGF0ZTtcbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIC8vIFN0b3JlIG1ldGFkYXRhIGZvciBkZWJ1Z2dpbmcgYW5kIGZ1dHVyZSBmZWF0dXJlc1xuICAgICAgICAgICAgICAgICAgICBkZXRlY3Rpb25NZXRhZGF0YSA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRldGVjdGVkRmllbGRzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJpbWFyeTogZGV0ZWN0aW9uUmVzdWx0LnByaW1hcnlGaWVsZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhbHRlcm5hdGl2ZXM6IGRldGVjdGlvblJlc3VsdC5kZXRlY3RlZEZpZWxkcy5kaXNwbGF5Py5zbGljZSgxKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aXN1YWw6IGRldGVjdGlvblJlc3VsdC5kZXRlY3RlZEZpZWxkcy52aXN1YWwsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWV0YTogZGV0ZWN0aW9uUmVzdWx0LmRldGVjdGVkRmllbGRzLm1ldGFcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25maWRlbmNlOiBkZXRlY3Rpb25SZXN1bHQuY29uZmlkZW5jZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1ldGhvZDogZGV0ZWN0aW9uUmVzdWx0Lm1ldGhvZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhdHRlcm46IGRldGVjdGlvblJlc3VsdC5wYXR0ZXJuXG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZzogSVJlbGF0aW9uRmllbGRDb25maWcgPSB7XG4gICAgICAgICAgICAgICAgcm91dGVQYXR0ZXJuOiByb3V0ZVBhdHRlcm4sXG4gICAgICAgICAgICAgICAgLy8gUGFzcyBBTEwgaWRlbnRpZmllciBtYXBwaW5ncyAoc3VwcG9ydHMgY29tcG9zaXRlIGtleXMpXG4gICAgICAgICAgICAgICAgaWRlbnRpZmllck1hcHBpbmc6IGlkZW50aWZpZXJNYXBwaW5ncy5sZW5ndGggPT09IDEgXG4gICAgICAgICAgICAgICAgICAgID8gaWRlbnRpZmllck1hcHBpbmdzWzBdICAvLyBTaW5nbGU6IHJldHVybiBvYmplY3RcbiAgICAgICAgICAgICAgICAgICAgOiBpZGVudGlmaWVyTWFwcGluZ3MsICAgICAvLyBNdWx0aXBsZTogcmV0dXJuIGFycmF5XG4gICAgICAgICAgICAgICAgbW9kYWxDb25maWdSZWY6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxDb25maWdSZWYgfHwge1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ3ZpZXcnLFxuICAgICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge31cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIG1vZGFsV2lkdGg6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxXaWR0aCxcbiAgICAgICAgICAgICAgICBtb2RhbFRpdGxlOiB1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsVGl0bGUsXG4gICAgICAgICAgICAgICAgZGlzcGxheUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAvLyBQcmlvcml0eTogVXNlciBjdXN0b20gdGVtcGxhdGUgPiBBdXRvLWRldGVjdGVkIGR1cGxpY2F0ZWQgZmllbGQgPiB1bmRlZmluZWQgKHVzZSBmYWxsYmFjaylcbiAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGU6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8udGVtcGxhdGUgfHwgYXV0b1RlbXBsYXRlLFxuICAgICAgICAgICAgICAgICAgICAvLyBTbWFydCBmYWxsYmFjayBwcmUtZ2VuZXJhdGVkIGZyb20gZW50aXR5IG1ldGFkYXRhXG4gICAgICAgICAgICAgICAgICAgIGZhbGxiYWNrOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmZhbGxiYWNrIHx8IGZhbGxiYWNrQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICAvLyBJY29uIGZyb20gZW50aXR5IG1ldGFkYXRhIG9yIHVzZXIgb3ZlcnJpZGVcbiAgICAgICAgICAgICAgICAgICAgaWNvbjogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5pY29uIHx8IGRlZmF1bHRJY29uIHx8ICdFeWVPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgICAgIHNob3dNb2RhbEljb246IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uc2hvd01vZGFsSWNvbiAhPT0gZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgIHNob3dMaW5rOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnNob3dMaW5rICE9PSBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgLy8gUGFzcyB0aHJvdWdoIGF1dG9EZXRlY3QgYW5kIGF1dG9EZXRlY3RIaW50c1xuICAgICAgICAgICAgICAgICAgICBhdXRvRGV0ZWN0OiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmF1dG9EZXRlY3QsXG4gICAgICAgICAgICAgICAgICAgIGF1dG9EZXRlY3RIaW50czogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5hdXRvRGV0ZWN0SGludHMsXG4gICAgICAgICAgICAgICAgICAgIC8vIFBhc3MgdGhyb3VnaCBhbnkgY3VzdG9tIGFjdGlvbnNcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5hY3Rpb25zXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGlmKGdsb2JhbFVJQ29uZmlnT3B0aW9ucz8uZHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uPy5kZWJ1Zykge1xuICAgICAgICAgICAgICAgIGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnLmRpc3BsYXlDb25maWchWydfZGV0ZWN0aW9uTWV0YWRhdGEnXSA9IGRldGVjdGlvbk1ldGFkYXRhO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdyZWxhdGlvbkNvbmZpZycgXSA9IGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnO1xuXG4gICAgICAgICAgICAvLyBCYWNrd2FyZCBjb21wYXRpYmlsaXR5OiBLZWVwIGlzTGluayBhbmQgbGlua0NvbmZpZ1xuICAgICAgICAgICAgZm9ybWF0dGVkWyAnaXNMaW5rJyBdID0gdHJ1ZTtcbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ2xpbmtDb25maWcnIF0gPSB7XG4gICAgICAgICAgICAgICAgcm91dGVQYXR0ZXJuOiByb3V0ZVBhdHRlcm5cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgfSBlbHNlIGlmIChyZWxhdGlvblR5cGUuZW5kc1dpdGgoJ3RvLW1hbnknKSkge1xuICAgICAgICAgICAgLy8gVE8tTUFOWTogU2hvdyBjb3VudCArIG1vZGFsIGljb24gKG9wZW5zIGZpbHRlcmVkIGxpc3QpXG4gICAgICAgICAgICAvLyBSb3V0ZSBwYXR0ZXJuOiBVc2UgY3VzdG9tIChmcm9tIHJlbGF0aW9uQ29uZmlnKSBvciBkZWZhdWx0IHRvIC9saXN0LXtlbnRpdHl9XG4gICAgICAgICAgICBjb25zdCByb3V0ZVBhdHRlcm4gPSB1c2VyUmVsYXRpb25Db25maWc/LnJvdXRlUGF0dGVyblxuICAgICAgICAgICAgICAgIHx8IGAvbGlzdC0ke2VudGl0eU5hbWVMb3dlcn1gO1xuXG4gICAgICAgICAgICAvLyBCdWlsZCBkZWZhdWx0IGZpbHRlcnMgdG8gc2hvdyBvbmx5IHJlbGF0ZWQgaXRlbXNcbiAgICAgICAgICAgIC8vIEZvciBleGFtcGxlLCBpZiB3ZSdyZSB2aWV3aW5nIGEgVGVhbSBhbmQgdGhpcyBmaWVsZCBzaG93cyBHYW1lcyxcbiAgICAgICAgICAgIC8vIHdlIHdhbnQgdG8gZmlsdGVyIGdhbWVzIHdoZXJlIHRlYW1JZCA9IGN1cnJlbnQgdGVhbSdzIElEXG4gICAgICAgICAgICAvLyBGb3IgY29tcG9zaXRlIGtleXMsIGFkZCBhbGwgaWRlbnRpZmllcnMgYXMgZmlsdGVyc1xuICAgICAgICAgICAgY29uc3QgZGVmYXVsdEZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICAgICAgICAgIGlkZW50aWZpZXJNYXBwaW5ncy5mb3JFYWNoKG1hcHBpbmcgPT4ge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzW21hcHBpbmcudGFyZ2V0XSA9IGA6JHttYXBwaW5nLnNvdXJjZX1gO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIEdlbmVyYXRlIGZhbGxiYWNrIGNvbmZpZ3VyYXRpb24gZm9yIHRvLW1hbnkgKHNob3dzIGNvdW50KVxuICAgICAgICAgICAgY29uc3QgZmFsbGJhY2tDb25maWcgPSBnZW5lcmF0ZVJlbGF0aW9uRmFsbGJhY2soXG4gICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICBwcmltYXJ5SWRlbnRpZmllci5zb3VyY2UsXG4gICAgICAgICAgICAgICAgcmVsYXRlZEVudGl0eVNlcnZpY2VcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIGNvbnN0IGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnOiBJUmVsYXRpb25GaWVsZENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICByb3V0ZVBhdHRlcm46IHJvdXRlUGF0dGVybixcbiAgICAgICAgICAgICAgICAvLyBQYXNzIEFMTCBpZGVudGlmaWVyIG1hcHBpbmdzIChzdXBwb3J0cyBjb21wb3NpdGUga2V5cylcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyTWFwcGluZzogaWRlbnRpZmllck1hcHBpbmdzLmxlbmd0aCA9PT0gMSBcbiAgICAgICAgICAgICAgICAgICAgPyBpZGVudGlmaWVyTWFwcGluZ3NbMF0gIC8vIFNpbmdsZTogcmV0dXJuIG9iamVjdFxuICAgICAgICAgICAgICAgICAgICA6IGlkZW50aWZpZXJNYXBwaW5ncywgICAgIC8vIE11bHRpcGxlOiByZXR1cm4gYXJyYXlcbiAgICAgICAgICAgICAgICBtb2RhbENvbmZpZ1JlZjogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbENvbmZpZ1JlZiB8fCB7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogZGVmYXVsdEZpbHRlcnNcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgbW9kYWxXaWR0aDogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbFdpZHRoLFxuICAgICAgICAgICAgICAgIG1vZGFsVGl0bGU6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxUaXRsZSxcbiAgICAgICAgICAgICAgICBkaXNwbGF5Q29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZXIgY2FuIG92ZXJyaWRlIHdpdGggY3VzdG9tIHRlbXBsYXRlXG4gICAgICAgICAgICAgICAgICAgIHRlbXBsYXRlOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnRlbXBsYXRlLFxuICAgICAgICAgICAgICAgICAgICAvLyBTbWFydCBmYWxsYmFjayBwcmUtZ2VuZXJhdGVkIGZyb20gZW50aXR5IG1ldGFkYXRhXG4gICAgICAgICAgICAgICAgICAgIGZhbGxiYWNrOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmZhbGxiYWNrIHx8IGZhbGxiYWNrQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICAvLyBJY29uIGZyb20gZW50aXR5IG1ldGFkYXRhIG9yIHVzZXIgb3ZlcnJpZGVcbiAgICAgICAgICAgICAgICAgICAgaWNvbjogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5pY29uIHx8IGRlZmF1bHRJY29uIHx8ICdVbm9yZGVyZWRMaXN0T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgICAgICBzaG93TW9kYWxJY29uOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnNob3dNb2RhbEljb24gIT09IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICBzaG93TGluazogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5zaG93TGluayAhPT0gdHJ1ZSwgLy8gRGVmYXVsdCBmYWxzZSBmb3IgdG8tbWFueVxuICAgICAgICAgICAgICAgICAgICAvLyBQYXNzIHRocm91Z2ggYW55IGN1c3RvbSBhY3Rpb25zXG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uYWN0aW9uc1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIC8vIElmIHVzZXIgcHJvdmlkZWQgY3VzdG9tIG1vZGFsQ29uZmlnUmVmLCBtZXJnZSBkZWZhdWx0IGZpbHRlcnMgd2l0aCB0aGVpciBvdmVycmlkZXNcbiAgICAgICAgICAgIGlmICh1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsQ29uZmlnUmVmPy5vdmVycmlkZUNvbmZpZykge1xuICAgICAgICAgICAgICAgIGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnLm1vZGFsQ29uZmlnUmVmIS5vdmVycmlkZUNvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICAgICAgLi4udXNlclJlbGF0aW9uQ29uZmlnLm1vZGFsQ29uZmlnUmVmLm92ZXJyaWRlQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgLi4uZGVmYXVsdEZpbHRlcnMsXG4gICAgICAgICAgICAgICAgICAgICAgICAuLi4odXNlclJlbGF0aW9uQ29uZmlnLm1vZGFsQ29uZmlnUmVmLm92ZXJyaWRlQ29uZmlnLmRlZmF1bHRGaWx0ZXJzIHx8IHt9KVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZm9ybWF0dGVkWyAncmVsYXRpb25Db25maWcnIF0gPSBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZztcbiAgICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgbmVzdGVkIHN0cnVjdHVyZXMgKG1hcCBhbmQgbGlzdCB0eXBlcylcbiAgICBpZiAodGhpc1Byb3AudHlwZSA9PT0gJ21hcCcgJiYgdGhpc1Byb3AucHJvcGVydGllcykge1xuICAgICAgICBmb3JtYXR0ZWRbICdwcm9wZXJ0aWVzJyBdID0gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckZvcm1PckRldGFpbCh0aGlzUHJvcC5wcm9wZXJ0aWVzLCB0eXBlLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICB9IGVsc2UgaWYgKHRoaXNQcm9wLnR5cGUgPT09ICdsaXN0Jykge1xuICAgICAgICAvLyBGb3IgbGlzdCB0eXBlcywgY2hlY2sgaWYgaXRlbXMgYXJlIG1hcHMgKG5lc3RlZCBzdHJ1Y3R1cmVzKVxuICAgICAgICAvLyBOb3RlOiBpdGVtcyBwcm9wZXJ0eSBleGlzdHMgb24gbGlzdC10eXBlIGF0dHJpYnV0ZXMgYnV0IG5vdCBpbiBiYXNlIEVudGl0eUF0dHJpYnV0ZSB0eXBlXG4gICAgICAgIGNvbnN0IGV4dGVuZGVkUHJvcCA9IHRoaXNQcm9wIGFzIFRJT1NjaGVtYUF0dHJpYnV0ZSAmIHsgaXRlbXM/OiB7IHR5cGU6IHN0cmluZzsgcHJvcGVydGllcz86IFRJT1NjaGVtYUF0dHJpYnV0ZVtdIH0gfTtcbiAgICAgICAgaWYgKGV4dGVuZGVkUHJvcC5pdGVtcz8udHlwZSA9PT0gJ21hcCcgJiYgZXh0ZW5kZWRQcm9wLml0ZW1zLnByb3BlcnRpZXMpIHtcbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ2l0ZW1zJyBdID0ge1xuICAgICAgICAgICAgICAgIC4uLmZvcm1hdHRlZFsgJ2l0ZW1zJyBdLFxuICAgICAgICAgICAgICAgIHByb3BlcnRpZXM6IGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JGb3JtT3JEZXRhaWwoZXh0ZW5kZWRQcm9wLml0ZW1zLnByb3BlcnRpZXMsIHR5cGUsIGVudGl0eVNlcnZpY2UpXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gVE9ETzogYWRkIHN1cHBvcnQgZm9yIHNldCwgZW51bSwgYW5kIGN1c3RvbS10eXBlc1xuXG4gICAgcmV0dXJuIGZvcm1hdHRlZDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JGb3JtT3JEZXRhaWwoXG4gICAgcHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sXG4gICAgdHlwZTogJ2NyZWF0ZScgfCAndXBkYXRlJyB8ICdkZXRhaWwnLFxuICAgIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT5cbikge1xuXG4gICAgaWYgKHR5cGUgPT09ICdjcmVhdGUnKSB7XG4gICAgICAgIHJldHVybiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yQ3JlYXRlKHByb3BlcnRpZXMsIGVudGl0eVNlcnZpY2UpO1xuICAgIH1cblxuICAgIGlmICh0eXBlID09PSAndXBkYXRlJykge1xuICAgICAgICByZXR1cm4gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvclVwZGF0ZShwcm9wZXJ0aWVzLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICB9XG5cbiAgICBpZiAodHlwZSA9PT0gJ2RldGFpbCcpIHtcbiAgICAgICAgcmV0dXJuIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JEZXRhaWwocHJvcGVydGllcywgZW50aXR5U2VydmljZSk7XG4gICAgfVxuICAgIHRocm93IChgSW52YWxpZCB0eXBlIFske3R5cGV9XSBwcm92aWRlZCB0byBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRm9ybU9yRGV0YWlsYCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yQ3JlYXRlKHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLCBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+LCBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbJ3VpQ29uZmlnR2VuT3B0aW9ucyddKSB7XG4gICAgcmV0dXJuIHByb3BlcnRpZXNcbiAgICAgICAgLmZpbHRlcihwcm9wID0+IHByb3AgJiYgKCFwcm9wLmhhc093blByb3BlcnR5KCdpc0NyZWF0YWJsZScpIHx8IHByb3AuaXNDcmVhdGFibGUpKVxuICAgICAgICAubWFwKChhdHQpID0+IGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbChhdHQsICdjcmVhdGUnLCBlbnRpdHlTZXJ2aWNlLCBwcm9wZXJ0aWVzLCBnbG9iYWxVSUNvbmZpZ09wdGlvbnMpKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JVcGRhdGUocHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sndWlDb25maWdHZW5PcHRpb25zJ10pIHtcbiAgICByZXR1cm4gcHJvcGVydGllc1xuICAgICAgICAuZmlsdGVyKHByb3AgPT4gcHJvcCAmJiAoIXByb3AuaGFzT3duUHJvcGVydHkoJ2lzRWRpdGFibGUnKSB8fCBwcm9wLmlzRWRpdGFibGUpKVxuICAgICAgICAubWFwKChhdHQpID0+IGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbChhdHQsICd1cGRhdGUnLCBlbnRpdHlTZXJ2aWNlLCBwcm9wZXJ0aWVzLCBnbG9iYWxVSUNvbmZpZ09wdGlvbnMpKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JEZXRhaWwocHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sndWlDb25maWdHZW5PcHRpb25zJ10pIHtcbiAgICByZXR1cm4gcHJvcGVydGllc1xuICAgICAgICAuZmlsdGVyKHByb3AgPT4gcHJvcCAmJiAoIXByb3AuaGFzT3duUHJvcGVydHkoJ2lzVmlzaWJsZScpIHx8IHByb3AuaXNWaXNpYmxlKSlcbiAgICAgICAgLm1hcCgoYXR0KSA9PiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoYXR0LCAnZGV0YWlsJywgZW50aXR5U2VydmljZSwgcHJvcGVydGllcywgZ2xvYmFsVUlDb25maWdPcHRpb25zKSk7XG59XG5cbmV4cG9ydCB0eXBlIExpc3RpbmdQcm9wQ29uZmlnID0gUGljazxGaWVsZE1ldGFkYXRhLCAnZmllbGRUeXBlJyB8ICdwbGFjZWhvbGRlcicgfCAnaGVscFRleHQnIHwgJ2ZpbHRlckNvbmZpZyc+ICYge1xuICAgIG5hbWU6IHN0cmluZyxcbiAgICBkYXRhSW5kZXg6IHN0cmluZyxcbiAgICBoaWRkZW4/OiBib29sZWFuLFxuICAgIGFjdGlvbnM/OiBBcnJheTxJRW50aXR5UGFnZUFjdGlvbj4sXG4gICAgcmVsYXRpb25Db25maWc/OiBJUmVsYXRpb25GaWVsZENvbmZpZywgIC8vIEZvciByZW5kZXJpbmcgcmVsYXRpb25zIHdpdGggbGlua3MvbW9kYWxzXG4gICAgdGVtcGxhdGU/OiBUZW1wbGF0ZSwgIC8vIEZvciB0ZW1wbGF0ZS1iYXNlZCByZW5kZXJpbmdcbiAgICBpc0lkZW50aWZpZXI/OiBib29sZWFuLCAgLy8gRm9yIGlkZW50aWZpZXIgZmllbGRzXG4gICAgaXNMaW5rPzogYm9vbGVhbiwgIC8vIEZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG4gICAgbGlua0NvbmZpZz86IHsgcm91dGVQYXR0ZXJuOiBzdHJpbmc7IGRpc3BsYXlUZXh0Pzogc3RyaW5nIH0sICAvLyBGb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxufTtcblxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JMaXN0KFxuICAgIGVudGl0eU5hbWU6IHN0cmluZywgXG4gICAgcHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sIFxuICAgIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sXG4gICAge1xuICAgIENSVURBcGlQYXRoLFxuICAgIGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGUsXG4gICAgZXhjbHVkZUZyb21BZG1pbkRlbGV0ZSxcbiAgICBleGNsdWRlRnJvbUFkbWluRGV0YWlsLFxuICAgICAgICBjdXN0b21Sb3dBY3Rpb25zLFxuICAgICAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnNcbn06IHtcbiAgICBDUlVEQXBpUGF0aD86IHN0cmluZyxcbiAgICBleGNsdWRlRnJvbUFkbWluVXBkYXRlPzogYm9vbGVhbixcbiAgICBleGNsdWRlRnJvbUFkbWluRGVsZXRlPzogYm9vbGVhbixcbiAgICBleGNsdWRlRnJvbUFkbWluRGV0YWlsPzogYm9vbGVhbixcbiAgICBjdXN0b21Sb3dBY3Rpb25zPzogUmVhZG9ubHlBcnJheTxJRW50aXR5UGFnZUFjdGlvbj4gfCBBcnJheTxJRW50aXR5UGFnZUFjdGlvbj4sXG4gICAgICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sndWlDb25maWdHZW5PcHRpb25zJ10gIC8vIE5FVzogR2xvYmFsIGNvbmZpZyBvcHRpb25zXG4gICAgfVxuKSB7XG5cbiAgICBjb25zdCBlbnRpdHlOYW1lTG93ZXIgPSBlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgZW50aXR5TmFtZVBhc2NhbENhc2UgPSBwYXNjYWxDYXNlKGVudGl0eU5hbWUpO1xuXG4gICAgcmV0dXJuIHByb3BlcnRpZXNcbiAgICAgICAgLmZpbHRlcihwcm9wID0+IHByb3AgJiYgcHJvcC5pc0xpc3RhYmxlKVxuICAgICAgICAubWFwKHByb3AgPT4ge1xuICAgICAgICAgICAgLy8gVXNlIHNhbWUgZm9ybWF0dGluZyBsb2dpYyBhcyBkZXRhaWxzL2Zvcm1zIChpbmNsdWRlcyByZWxhdGlvbkNvbmZpZyBnZW5lcmF0aW9uKVxuICAgICAgICAgICAgLy8gUGFzcyBhbGwgcHJvcGVydGllcyBzbyBpdCBjYW4gZGV0ZWN0IGR1cGxpY2F0ZWQgcmVsYXRpb24gZmllbGRzIChlLmcuLCB0ZWFtTmFtZSBmb3IgdGVhbUlkKVxuICAgICAgICAgICAgY29uc3QgZm9ybWF0dGVkID0gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKHByb3AsICdkZXRhaWwnLCBlbnRpdHlTZXJ2aWNlLCBwcm9wZXJ0aWVzLCBnbG9iYWxVSUNvbmZpZ09wdGlvbnMpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBBdXRvLWdlbmVyYXRlIGZpbHRlckNvbmZpZyBpZiBub3QgYWxyZWFkeSBwcmVzZW50IGFuZCBmaWVsZCBpcyBmaWx0ZXJhYmxlXG4gICAgICAgICAgICBjb25zdCBhdXRvR2VuZXJhdGVkRmlsdGVyQ29uZmlnID0gIWZvcm1hdHRlZC5maWx0ZXJDb25maWcgJiYgcHJvcC5pc0ZpbHRlcmFibGUgIT09IGZhbHNlXG4gICAgICAgICAgICAgICAgPyBnZW5lcmF0ZUZpbHRlckNvbmZpZyhwcm9wLCBlbnRpdHlTZXJ2aWNlLCBnbG9iYWxVSUNvbmZpZ09wdGlvbnMpXG4gICAgICAgICAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIE92ZXJyaWRlL2FkZCBsaXN0LXNwZWNpZmljIHByb3BlcnRpZXNcbiAgICAgICAgICAgIGNvbnN0IHByb3BDb25maWc6IExpc3RpbmdQcm9wQ29uZmlnID0ge1xuICAgICAgICAgICAgICAgIC4uLmZvcm1hdHRlZCxcbiAgICAgICAgICAgICAgICBuYW1lOiBmb3JtYXR0ZWQubGFiZWwgfHwgZm9ybWF0dGVkLm5hbWUsICAvLyBFbnN1cmUgbmFtZSBpcyBzZXQgZm9yIHRhYmxlIGNvbHVtbiBoZWFkZXJcbiAgICAgICAgICAgICAgICBkYXRhSW5kZXg6IGAke3Byb3AuaWR9YCxcbiAgICAgICAgICAgICAgICBmaWVsZFR5cGU6IGZvcm1hdHRlZC5maWVsZFR5cGUgfHwgJ3RleHQnLFxuICAgICAgICAgICAgICAgIGZpbHRlckNvbmZpZzogZm9ybWF0dGVkLmZpbHRlckNvbmZpZyB8fCBhdXRvR2VuZXJhdGVkRmlsdGVyQ29uZmlnLCAgLy8gVXNlIGV4cGxpY2l0IG9yIGF1dG8tZ2VuZXJhdGVkXG4gICAgICAgICAgICAgICAgaGlkZGVuOiBwcm9wLmhhc093blByb3BlcnR5KCdpc1Zpc2libGUnKSAmJiAhcHJvcC5pc1Zpc2libGVcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGlmIChwcm9wLmlzSWRlbnRpZmllcikge1xuICAgICAgICAgICAgICAgIC8vIEJ1aWxkIGRlZmF1bHQgcm93IGFjdGlvbnMgd2l0aCBJRHNcbiAgICAgICAgICAgICAgICBjb25zdCBkZWZhdWx0QWN0aW9uczogQXJyYXk8SUVudGl0eVBhZ2VBY3Rpb24+ID0gW107XG5cbiAgICAgICAgICAgICAgICBpZiAoIWV4Y2x1ZGVGcm9tQWRtaW5EZXRhaWwpIHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEFjdGlvbnMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZDogJ3ZpZXcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbjogJ3ZpZXcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdWaWV3JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRlbXBsYXRlOiBgVmlldyB7JHtwcm9wLmlkfX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiBgL3ZpZXctJHtlbnRpdHlOYW1lTG93ZXJ9YFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoIWV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGUpIHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEFjdGlvbnMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZDogJ2VkaXQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbjogJ2VkaXQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdFZGl0JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRlbXBsYXRlOiBgRWRpdCB7JHtwcm9wLmlkfX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiBgL2VkaXQtJHtlbnRpdHlOYW1lTG93ZXJ9YFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoIWV4Y2x1ZGVGcm9tQWRtaW5EZWxldGUpIHtcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEFjdGlvbnMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZDogJ2RlbGV0ZScsXG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uOiAnZGVsZXRlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnRGVsZXRlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHRlbXBsYXRlOiBgRGVsZXRlIHske3Byb3AuaWR9fWAsXG4gICAgICAgICAgICAgICAgICAgICAgICBvcGVuSW5Nb2RhbDogdHJ1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1vZGFsQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kYWxUeXBlOiAnY29uZmlybScsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9kYWxQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpdGxlOiBgRGVsZXRlICR7ZW50aXR5TmFtZVBhc2NhbENhc2V9P2AsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6IGBBcmUgeW91IHN1cmUgeW91IHdhbnQgdG8gZGVsZXRlIHRoaXMgJHtlbnRpdHlOYW1lUGFzY2FsQ2FzZX0/IFRoaXMgYWN0aW9uIGNhbm5vdCBiZSB1bmRvbmUuYFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXBpQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFwaU1ldGhvZDogYERFTEVURWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlc3BvbnNlS2V5OiBlbnRpdHlOYW1lTG93ZXIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFwaVVybDogYCR7Q1JVREFwaVBhdGggPyBDUlVEQXBpUGF0aCA6ICcnfS8ke2VudGl0eU5hbWVMb3dlcn1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VjY2Vzc01lc3NhZ2U6IGAke2VudGl0eU5hbWVQYXNjYWxDYXNlfSBkZWxldGVkIHN1Y2Nlc3NmdWxseWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3JNZXNzYWdlOiBgRmFpbGVkIHRvIGRlbGV0ZSAke2VudGl0eU5hbWVQYXNjYWxDYXNlfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VibWl0U3VjY2Vzc1JlZGlyZWN0OiBgL2xpc3QtJHtlbnRpdHlOYW1lTG93ZXJ9YFxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAvLyBNZXJnZSBjdXN0b20gcm93IGFjdGlvbnMgdXNpbmcgaWRlbnRpZmllci1iYXNlZCBvdmVycmlkZVxuICAgICAgICAgICAgICAgIHByb3BDb25maWcuYWN0aW9ucyA9IGN1c3RvbVJvd0FjdGlvbnMgXG4gICAgICAgICAgICAgICAgICAgID8gbWVyZ2VBY3Rpb25zKGRlZmF1bHRBY3Rpb25zLCBjdXN0b21Sb3dBY3Rpb25zKVxuICAgICAgICAgICAgICAgICAgICA6IGRlZmF1bHRBY3Rpb25zO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gcHJvcENvbmZpZztcbiAgICAgICAgfSk7XG59XG5cbi8qKlxuICogTUVSR0UgVVRJTElUWSBGVU5DVElPTlNcbiAqIFxuICogVGhlc2UgZnVuY3Rpb25zIGltcGxlbWVudCB0aGUgaWRlbnRpZmllci1iYXNlZCBvdmVycmlkZSBwYXR0ZXJuOlxuICogLSBEZWZhdWx0cyBoYXZlIHN0YW5kYXJkIGlkZW50aWZpZXJzIChlLmcuLCAndmlldycsICdlZGl0JywgJ2RlbGV0ZScpXG4gKiAtIEN1c3RvbSBjb25maWdzIHdpdGggc2FtZSBpZGVudGlmaWVyIG92ZXJyaWRlIHRoZSBkZWZhdWx0XG4gKiAtIE5ldyBpZGVudGlmaWVycyBnZXQgYWRkZWQgdG8gdGhlIHJlc3VsdFxuICovXG5cbi8qKlxuICogTWVyZ2UgZGVmYXVsdCBidXR0b25zIHdpdGggY3VzdG9tIGJ1dHRvbnMgdXNpbmcgaWRlbnRpZmllci1iYXNlZCBvdmVycmlkZS5cbiAqIFxuICogQHBhcmFtIGRlZmF1bHRzIC0gRGVmYXVsdCBidXR0b25zIChmcm9tIGdlbmVyYXRvcilcbiAqIEBwYXJhbSBjdXN0b21zIC0gQ3VzdG9tIGJ1dHRvbnMgKGZyb20gZW50aXR5IHNjaGVtYSlcbiAqIEByZXR1cm5zIE1lcmdlZCBidXR0b24gYXJyYXlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlQnV0dG9uczxUIGV4dGVuZHMgeyBpZD86IHN0cmluZyB9PihcbiAgICBkZWZhdWx0czogQXJyYXk8VD4sXG4gICAgY3VzdG9tczogUmVhZG9ubHlBcnJheTxUPiB8IEFycmF5PFQ+ID0gW11cbik6IEFycmF5PFQ+IHtcbiAgICBjb25zdCBjdXN0b21zQXJyYXkgPSBbLi4uY3VzdG9tc107ICAvLyBDb252ZXJ0IHRvIG11dGFibGUgYXJyYXlcbiAgICBjb25zdCBjdXN0b21NYXAgPSBuZXcgTWFwKFxuICAgICAgICBjdXN0b21zQXJyYXkuZmlsdGVyKGMgPT4gYy5pZCkubWFwKGMgPT4gW2MuaWQsIGNdKVxuICAgICk7XG4gICAgXG4gICAgLy8gU3RhcnQgd2l0aCBkZWZhdWx0cywgcmVwbGFjZSBpZiBjdXN0b20gaGFzIHNhbWUgaWRcbiAgICBjb25zdCBtZXJnZWQgPSBkZWZhdWx0cy5tYXAoZGVmYXVsdEJ0biA9PiBcbiAgICAgICAgZGVmYXVsdEJ0bi5pZCAmJiBjdXN0b21NYXAuaGFzKGRlZmF1bHRCdG4uaWQpXG4gICAgICAgICAgICA/IGN1c3RvbU1hcC5nZXQoZGVmYXVsdEJ0bi5pZCkhICAvLyBPdmVycmlkZVxuICAgICAgICAgICAgOiBkZWZhdWx0QnRuXG4gICAgKTtcbiAgICBcbiAgICAvLyBBZGQgY3VzdG9tIGJ1dHRvbnMgdGhhdCBkb24ndCBvdmVycmlkZSBkZWZhdWx0c1xuICAgIGN1c3RvbXNBcnJheS5mb3JFYWNoKGN1c3RvbUJ0biA9PiB7XG4gICAgICAgIGlmICghY3VzdG9tQnRuLmlkIHx8ICFkZWZhdWx0cy5zb21lKGQgPT4gZC5pZCA9PT0gY3VzdG9tQnRuLmlkKSkge1xuICAgICAgICAgICAgbWVyZ2VkLnB1c2goY3VzdG9tQnRuKTsgIC8vIEFkZCBuZXdcbiAgICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIHJldHVybiBtZXJnZWQ7XG59XG5cbi8qKlxuICogTWVyZ2UgZGVmYXVsdCBhY3Rpb25zIHdpdGggY3VzdG9tIGFjdGlvbnMgdXNpbmcgaWRlbnRpZmllci1iYXNlZCBvdmVycmlkZS5cbiAqIFNhbWUgbG9naWMgYXMgbWVyZ2VCdXR0b25zIGJ1dCBzZW1hbnRpY2FsbHkgbmFtZWQgZm9yIGFjdGlvbnMuXG4gKiBcbiAqIEBwYXJhbSBkZWZhdWx0cyAtIERlZmF1bHQgYWN0aW9ucyAoZnJvbSBnZW5lcmF0b3IpXG4gKiBAcGFyYW0gY3VzdG9tcyAtIEN1c3RvbSBhY3Rpb25zIChmcm9tIGVudGl0eSBzY2hlbWEpXG4gKiBAcmV0dXJucyBNZXJnZWQgYWN0aW9uIGFycmF5XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZUFjdGlvbnM8VCBleHRlbmRzIHsgaWQ/OiBzdHJpbmcgfT4oXG4gICAgZGVmYXVsdHM6IEFycmF5PFQ+LFxuICAgIGN1c3RvbXM6IFJlYWRvbmx5QXJyYXk8VD4gfCBBcnJheTxUPiA9IFtdXG4pOiBBcnJheTxUPiB7XG4gICAgcmV0dXJuIG1lcmdlQnV0dG9ucyhkZWZhdWx0cywgWy4uLmN1c3RvbXNdKTsgIC8vIFNwcmVhZCB0byBoYW5kbGUgYm90aCByZWFkb25seSBhbmQgbXV0YWJsZVxufVxuXG4vKipcbiAqIE1lcmdlIGZpZWxkLWxldmVsIHZpc2liaWxpdHkvZW5hYmxlbWVudC9oZWxwVGV4dC9wbGFjZWhvbGRlciBpbnRvIGJhc2UgcHJvcGVydGllcy5cbiAqIFxuICogQHBhcmFtIGJhc2VQcm9wZXJ0aWVzIC0gQmFzZSBwcm9wZXJ0aWVzIGZyb20gc2NoZW1hXG4gKiBAcGFyYW0gZmllbGRPdmVycmlkZXMgLSBGaWVsZCBvdmVycmlkZXMgZnJvbSBmb3JtQ29uZmlnLmZpZWxkc1xuICogQHJldHVybnMgUHJvcGVydGllcyB3aXRoIG92ZXJyaWRlcyBtZXJnZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlRmllbGRWaXNpYmlsaXR5PFQgZXh0ZW5kcyB7IG5hbWU6IHN0cmluZyB9PihcbiAgICBiYXNlUHJvcGVydGllczogQXJyYXk8VD4sXG4gICAgZmllbGRPdmVycmlkZXM6IFJlYWRvbmx5QXJyYXk8e1xuICAgICAgICByZWFkb25seSBuYW1lOiBzdHJpbmc7XG4gICAgICAgIHJlYWRvbmx5IHZpc2liaWxpdHk/OiBhbnk7XG4gICAgICAgIHJlYWRvbmx5IGVuYWJsZW1lbnQ/OiBhbnk7XG4gICAgICAgIHJlYWRvbmx5IGhlbHBUZXh0Pzogc3RyaW5nO1xuICAgICAgICByZWFkb25seSBwbGFjZWhvbGRlcj86IHN0cmluZztcbiAgICB9PiB8IEFycmF5PHtcbiAgICAgICAgbmFtZTogc3RyaW5nO1xuICAgICAgICB2aXNpYmlsaXR5PzogYW55O1xuICAgICAgICBlbmFibGVtZW50PzogYW55O1xuICAgICAgICBoZWxwVGV4dD86IHN0cmluZztcbiAgICAgICAgcGxhY2Vob2xkZXI/OiBzdHJpbmc7XG4gICAgfT4gPSBbXVxuKTogQXJyYXk8VD4ge1xuICAgIGNvbnN0IG92ZXJyaWRlTWFwID0gbmV3IE1hcChcbiAgICAgICAgWy4uLmZpZWxkT3ZlcnJpZGVzXS5tYXAoZiA9PiBbZi5uYW1lLCBmXSlcbiAgICApO1xuICAgIFxuICAgIC8vIFZhbGlkYXRpb246IFdhcm4gaWYgZmllbGQgb3ZlcnJpZGUgcmVmZXJlbmNlcyBub24tZXhpc3RlbnQgZmllbGRcbiAgICBmaWVsZE92ZXJyaWRlcy5mb3JFYWNoKG92ZXJyaWRlID0+IHtcbiAgICAgICAgaWYgKCFiYXNlUHJvcGVydGllcy5zb21lKHAgPT4gcC5uYW1lID09PSBvdmVycmlkZS5uYW1lKSkge1xuICAgICAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBGaWVsZCBvdmVycmlkZSBcIiR7b3ZlcnJpZGUubmFtZX1cIiBub3QgZm91bmQgaW4gc2NoZW1hIHByb3BlcnRpZXMuIFRoaXMgb3ZlcnJpZGUgd2lsbCBiZSBpZ25vcmVkLmApO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgcmV0dXJuIGJhc2VQcm9wZXJ0aWVzLm1hcChwcm9wID0+IHtcbiAgICAgICAgY29uc3Qgb3ZlcnJpZGUgPSBvdmVycmlkZU1hcC5nZXQocHJvcC5uYW1lKTtcbiAgICAgICAgXG4gICAgICAgIGlmICghb3ZlcnJpZGUpIHJldHVybiBwcm9wO1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIC4uLnByb3AsXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUudmlzaWJpbGl0eSAhPT0gdW5kZWZpbmVkICYmIHsgdmlzaWJpbGl0eTogb3ZlcnJpZGUudmlzaWJpbGl0eSB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS5lbmFibGVtZW50ICE9PSB1bmRlZmluZWQgJiYgeyBlbmFibGVtZW50OiBvdmVycmlkZS5lbmFibGVtZW50IH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmhlbHBUZXh0ICE9PSB1bmRlZmluZWQgJiYgeyBoZWxwVGV4dDogb3ZlcnJpZGUuaGVscFRleHQgfSksXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUucGxhY2Vob2xkZXIgIT09IHVuZGVmaW5lZCAmJiB7IHBsYWNlaG9sZGVyOiBvdmVycmlkZS5wbGFjZWhvbGRlciB9KVxuICAgICAgICB9O1xuICAgIH0pO1xufVxuXG4vKipcbiAqIE1lcmdlIGNvbHVtbi1sZXZlbCB2aXNpYmlsaXR5L3dpZHRoL2ZpeGVkIGludG8gYmFzZSBwcm9wZXJ0aWVzLlxuICogXG4gKiBAcGFyYW0gYmFzZVByb3BlcnRpZXMgLSBCYXNlIHByb3BlcnRpZXMgZnJvbSBzY2hlbWFcbiAqIEBwYXJhbSBjb2x1bW5PdmVycmlkZXMgLSBDb2x1bW4gb3ZlcnJpZGVzIGZyb20gdGFibGVDb25maWcuY29sdW1uc1xuICogQHJldHVybnMgUHJvcGVydGllcyB3aXRoIGNvbHVtbiBvdmVycmlkZXMgbWVyZ2VkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZUNvbHVtblZpc2liaWxpdHk8VCBleHRlbmRzIHsgbmFtZTogc3RyaW5nIH0+KFxuICAgIGJhc2VQcm9wZXJ0aWVzOiBBcnJheTxUPixcbiAgICBjb2x1bW5PdmVycmlkZXM6IFJlYWRvbmx5QXJyYXk8e1xuICAgICAgICByZWFkb25seSBmaWVsZDogc3RyaW5nO1xuICAgICAgICByZWFkb25seSB2aXNpYmlsaXR5PzogYW55O1xuICAgICAgICByZWFkb25seSB3aWR0aD86IHN0cmluZyB8IG51bWJlcjtcbiAgICAgICAgcmVhZG9ubHkgZml4ZWQ/OiAnbGVmdCcgfCAncmlnaHQnO1xuICAgICAgICByZWFkb25seSBncm91cFRpdGxlPzogc3RyaW5nO1xuICAgIH0+IHwgQXJyYXk8e1xuICAgICAgICBmaWVsZDogc3RyaW5nO1xuICAgICAgICB2aXNpYmlsaXR5PzogYW55O1xuICAgICAgICB3aWR0aD86IHN0cmluZyB8IG51bWJlcjtcbiAgICAgICAgZml4ZWQ/OiAnbGVmdCcgfCAncmlnaHQnO1xuICAgICAgICBncm91cFRpdGxlPzogc3RyaW5nO1xuICAgIH0+ID0gW11cbik6IEFycmF5PFQ+IHtcbiAgICBjb25zdCBvdmVycmlkZU1hcCA9IG5ldyBNYXAoXG4gICAgICAgIFsuLi5jb2x1bW5PdmVycmlkZXNdLm1hcChjID0+IFtjLmZpZWxkLCBjXSlcbiAgICApO1xuICAgIFxuICAgIC8vIFZhbGlkYXRpb246IFdhcm4gaWYgY29sdW1uIG92ZXJyaWRlIHJlZmVyZW5jZXMgbm9uLWV4aXN0ZW50IGNvbHVtblxuICAgIGNvbHVtbk92ZXJyaWRlcy5mb3JFYWNoKG92ZXJyaWRlID0+IHtcbiAgICAgICAgaWYgKCFiYXNlUHJvcGVydGllcy5zb21lKHAgPT4gcC5uYW1lID09PSBvdmVycmlkZS5maWVsZCkpIHtcbiAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgQ29sdW1uIG92ZXJyaWRlIFwiJHtvdmVycmlkZS5maWVsZH1cIiBub3QgZm91bmQgaW4gc2NoZW1hIHByb3BlcnRpZXMuIFRoaXMgb3ZlcnJpZGUgd2lsbCBiZSBpZ25vcmVkLmApO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgcmV0dXJuIGJhc2VQcm9wZXJ0aWVzLm1hcChwcm9wID0+IHtcbiAgICAgICAgY29uc3Qgb3ZlcnJpZGUgPSBvdmVycmlkZU1hcC5nZXQocHJvcC5uYW1lKTtcbiAgICAgICAgXG4gICAgICAgIGlmICghb3ZlcnJpZGUpIHJldHVybiBwcm9wO1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIC4uLnByb3AsXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUudmlzaWJpbGl0eSAhPT0gdW5kZWZpbmVkICYmIHsgdmlzaWJpbGl0eTogb3ZlcnJpZGUudmlzaWJpbGl0eSB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS53aWR0aCAhPT0gdW5kZWZpbmVkICYmIHsgd2lkdGg6IG92ZXJyaWRlLndpZHRoIH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmZpeGVkICE9PSB1bmRlZmluZWQgJiYgeyBmaXhlZDogb3ZlcnJpZGUuZml4ZWQgfSksXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUuZ3JvdXBUaXRsZSAhPT0gdW5kZWZpbmVkICYmIHsgZ3JvdXBUaXRsZTogb3ZlcnJpZGUuZ3JvdXBUaXRsZSB9KVxuICAgICAgICB9O1xuICAgIH0pO1xufVxuIl19
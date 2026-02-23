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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy91aS1jb25maWctZ2VuL3RlbXBsYXRlcy91dGlsLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBMGlCQSw0REFnQkM7QUEwTUQsa0VBNERDO0FBb0JELG9EQXlOQztBQXVYRCw0Q0F1TkM7QUFtQ0Qsb0ZBK1NDO0FBY0Qsc0ZBa0JDO0FBaUZELDREQXVGQztBQWtCRCxzREFrQ0M7QUFrRUQsMEVBSUM7QUFhRCwwRUFJQztBQWFELDBFQUlDO0FBaURELHNFQXVHQztBQStDRCxvQ0F3QkM7QUE2QkQsb0NBS0M7QUFTRCx3REE4QkM7QUF5QkQsc0NBS0M7QUEyQkQsb0RBd0NDO0FBeUdELHNEQTBGQztBQTczRkQseUNBWXNCO0FBRXRCLHlDQUE4QztBQUU5QywyQ0FBOEM7QUFDOUMsdUNBQThEO0FBa0Q5RDs7R0FFRztBQUNIOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBbUJHO0FBQ0gsTUFBTSx3QkFBd0IsR0FBOEM7SUFDeEUsT0FBTyxFQUFFLElBQUk7SUFDYixRQUFRLEVBQUU7UUFDTiw0Q0FBNEM7UUFDNUMsT0FBTyxFQUFFLENBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsYUFBYSxDQUFFO1FBQ3BELDRDQUE0QztRQUM1QyxNQUFNLEVBQUUsQ0FBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsU0FBUyxDQUFFO1FBQ3hELHdDQUF3QztRQUN4QyxJQUFJLEVBQUUsQ0FBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxZQUFZLEVBQUUsVUFBVSxDQUFFO0tBQzVEO0lBQ0QsUUFBUSxFQUFFO1FBQ04sMENBQTBDO1FBQzFDLFFBQVEsRUFBRSxPQUFPO1FBQ2pCLFFBQVEsRUFBRSxRQUFRLEVBQUUsYUFBYTtRQUNqQyxTQUFTLEVBQUUsV0FBVyxFQUFFLFVBQVU7UUFDbEMsTUFBTSxFQUFFLFdBQVcsRUFBRSxVQUFVO1FBQy9CLE9BQU8sRUFBRSxTQUFTLEVBQUUsVUFBVTtRQUM5QixPQUFPLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxNQUFNO1FBQ2xDLFVBQVUsRUFBRSxNQUFNLEVBQUUsU0FBUztRQUM3QixLQUFLLEVBQUUsS0FBSztRQUNaLFVBQVUsRUFBRSxNQUFNLEVBQUUsT0FBTztRQUUzQiwyQ0FBMkM7UUFDM0MsTUFBTSxFQUFFLE1BQU07UUFDZCxNQUFNLEVBQUUsT0FBTztRQUNmLEtBQUssRUFBRSxRQUFRO1FBQ2YsT0FBTyxFQUFFLE9BQU87UUFFaEIsMkNBQTJDO1FBQzNDLFFBQVEsRUFBRSxPQUFPO1FBQ2pCLFlBQVksRUFBRSxVQUFVO1FBRXhCLHVFQUF1RTtRQUN2RSx1RUFBdUU7S0FDMUU7SUFDRCxhQUFhLEVBQUUsUUFBUTtJQUN2QixtQkFBbUIsRUFBRSxRQUFRO0lBQzdCLEtBQUssRUFBRSxLQUFLO0NBQ2YsQ0FBQztBQUVGOztHQUVHO0FBQ0gsU0FBUyxxQkFBcUIsQ0FDMUIsWUFBOEMsRUFDOUMsWUFBOEMsRUFDOUMsYUFJQztJQUVELHNCQUFzQjtJQUN0QixJQUFJLE1BQU0sR0FBRyxFQUFFLEdBQUcsd0JBQXdCLEVBQUUsQ0FBQztJQUU3QyxzQkFBc0I7SUFDdEIsSUFBSSxZQUFZLEVBQUUsQ0FBQztRQUNmLE1BQU0sR0FBRztZQUNMLEdBQUcsTUFBTTtZQUNULEdBQUcsWUFBWTtZQUNmLFFBQVEsRUFBRSxFQUFFLEdBQUcsTUFBTSxDQUFDLFFBQVEsRUFBRSxHQUFHLFlBQVksQ0FBQyxRQUFRLEVBQUU7WUFDMUQsUUFBUSxFQUFFLFlBQVksQ0FBQyxRQUFRLElBQUksTUFBTSxDQUFDLFFBQVE7U0FDckQsQ0FBQztJQUNOLENBQUM7SUFFRCx3Q0FBd0M7SUFDeEMsSUFBSSxZQUFZLEVBQUUsQ0FBQztRQUNmLE1BQU0sR0FBRztZQUNMLEdBQUcsTUFBTTtZQUNULEdBQUcsWUFBWTtZQUNmLFFBQVEsRUFBRSxFQUFFLEdBQUcsTUFBTSxDQUFDLFFBQVEsRUFBRSxHQUFHLFlBQVksQ0FBQyxRQUFRLEVBQUU7WUFDMUQsUUFBUSxFQUFFLFlBQVksQ0FBQyxRQUFRLElBQUksTUFBTSxDQUFDLFFBQVE7U0FDckQsQ0FBQztJQUNOLENBQUM7SUFFRCwwQ0FBMEM7SUFDMUMsTUFBTSxNQUFNLEdBQVEsRUFBRSxHQUFHLE1BQU0sRUFBRSxDQUFDO0lBQ2xDLElBQUksYUFBYSxFQUFFLENBQUM7UUFDaEIsSUFBSSxhQUFhLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDOUIsTUFBTSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUMsYUFBYSxDQUFDO1FBQ3ZELENBQUM7UUFDRCxJQUFJLGFBQWEsQ0FBQyxlQUFlLEVBQUUsQ0FBQztZQUNoQyxNQUFNLENBQUMsZUFBZSxHQUFHLGFBQWEsQ0FBQyxlQUFlLENBQUM7UUFDM0QsQ0FBQztRQUNELElBQUksYUFBYSxDQUFDLGFBQWEsRUFBRSxDQUFDO1lBQzlCLE1BQU0sQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFDLGFBQWEsQ0FBQztRQUN2RCxDQUFDO0lBQ0wsQ0FBQztJQUVELE9BQU8sTUFBTSxDQUFDO0FBQ2xCLENBQUM7QUFFRDs7Ozs7Ozs7R0FRRztBQUNILFNBQVMsa0JBQWtCLENBQ3ZCLE9BQWUsRUFDZixRQUFrQjtJQUVsQixzRUFBc0U7SUFDdEUsZ0NBQWdDO0lBQ2hDLE1BQU0sYUFBYSxHQUFHLElBQUksTUFBTSxDQUM1QixLQUFLLFFBQVEsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLGNBQWMsRUFDckMsR0FBRyxDQUNOLENBQUM7SUFFRixNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDLGFBQWEsQ0FBQyxDQUFDO0lBRTNDLElBQUksS0FBSyxFQUFFLENBQUM7UUFDUixNQUFNLENBQUUsQUFBRCxFQUFHLE1BQU0sRUFBRSxHQUFHLEVBQUUsSUFBSSxDQUFFLEdBQUcsS0FBSyxDQUFDO1FBQ3RDLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDdEQsTUFBTSxRQUFRLEdBQUcsV0FBVztZQUN4QixDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUM7WUFDcEMsQ0FBQyxDQUFDLElBQUksQ0FBQztRQUVYLE9BQU87WUFDSCxNQUFNLEVBQUUsTUFBTSxHQUFHLEdBQUcsRUFBRywwQkFBMEI7WUFDakQsUUFBUTtZQUNSLFdBQVc7WUFDWCxhQUFhLEVBQUUsT0FBTztTQUN6QixDQUFDO0lBQ04sQ0FBQztJQUVELHFCQUFxQjtJQUNyQixNQUFNLFdBQVcsR0FBRyxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3pELE1BQU0sUUFBUSxHQUFHLFdBQVc7UUFDeEIsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQyxFQUFFLE9BQU8sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO1FBQzFDLENBQUMsQ0FBQyxPQUFPLENBQUM7SUFFZCxPQUFPO1FBQ0gsUUFBUTtRQUNSLFdBQVc7UUFDWCxhQUFhLEVBQUUsT0FBTztLQUN6QixDQUFDO0FBQ04sQ0FBQztBQUVEOzs7Ozs7OztHQVFHO0FBQ0gsU0FBUyxzQkFBc0IsQ0FDM0IsTUFBMkIsRUFDM0IsVUFBa0IsRUFDbEIsUUFBa0IsRUFDbEIsZUFBMEI7SUFFMUIsTUFBTSxRQUFRLEdBQWEsRUFBRSxDQUFDO0lBQzlCLE1BQU0sZUFBZSxHQUFHLFVBQVUsQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUNqRCxNQUFNLGFBQWEsR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBRXBELDZDQUE2QztJQUM3QyxJQUFJLGVBQWUsSUFBSSxlQUFlLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQ2hELFFBQVEsQ0FBQyxJQUFJLENBQUMsR0FBRyxlQUFlLENBQUMsQ0FBQztJQUN0QyxDQUFDO0lBRUQsNkRBQTZEO0lBQzdELElBQUksTUFBTSxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBQ2hCLE1BQU0sV0FBVyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsV0FBVyxFQUFFLENBQUM7UUFDaEQsS0FBSyxNQUFNLE1BQU0sSUFBSSxRQUFRLEVBQUUsQ0FBQztZQUM1QixRQUFRLENBQUMsSUFBSSxDQUFDLEdBQUcsV0FBVyxHQUFHLGFBQWEsR0FBRyxNQUFNLENBQUMsV0FBVyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1lBQ3ZFLFFBQVEsQ0FBQyxJQUFJLENBQUMsR0FBRyxXQUFXLEdBQUcsZUFBZSxHQUFHLE1BQU0sQ0FBQyxXQUFXLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFDN0UsQ0FBQztJQUNMLENBQUM7SUFFRCxrRUFBa0U7SUFDbEUsS0FBSyxNQUFNLE1BQU0sSUFBSSxRQUFRLEVBQUUsQ0FBQztRQUM1QixRQUFRLENBQUMsSUFBSSxDQUFDLEdBQUcsZUFBZSxHQUFHLE1BQU0sQ0FBQyxXQUFXLEVBQUUsRUFBRSxDQUFDLENBQUM7SUFDL0QsQ0FBQztJQUVELHNEQUFzRDtJQUN0RCxLQUFLLE1BQU0sTUFBTSxJQUFJLFFBQVEsRUFBRSxDQUFDO1FBQzVCLFFBQVEsQ0FBQyxJQUFJLENBQUMsR0FBRyxhQUFhLEdBQUcsTUFBTSxDQUFDLFdBQVcsRUFBRSxFQUFFLENBQUMsQ0FBQztJQUM3RCxDQUFDO0lBRUQsT0FBTyxRQUFRLENBQUM7QUFDcEIsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBUyxzQkFBc0IsQ0FDM0IsYUFBbUMsRUFDbkMsUUFBa0IsRUFDbEIsYUFBd0I7SUFFeEIsTUFBTSxVQUFVLEdBQUcsSUFBSSxHQUFHLENBQUMsYUFBYSxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDO0lBQzNFLE1BQU0sS0FBSyxHQUFhLEVBQUUsQ0FBQztJQUMzQixNQUFNLFNBQVMsR0FBRyxJQUFJLEdBQUcsRUFBVSxDQUFDO0lBRXBDLEtBQUssTUFBTSxPQUFPLElBQUksUUFBUSxFQUFFLENBQUM7UUFDN0IsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBRTNDLG9DQUFvQztRQUNwQyxJQUFJLFNBQVMsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLElBQUksVUFBVSxDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDO1lBQzlELFNBQVM7UUFDYixDQUFDO1FBRUQseUNBQXlDO1FBQ3pDLE1BQU0sS0FBSyxHQUFHLGFBQWEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FDakMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxXQUFXLEVBQUUsS0FBSyxZQUFZO1lBQ3BDLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLFdBQVcsRUFBRSxDQUFDLENBQ3RDLENBQUM7UUFFRixJQUFJLEtBQUssRUFBRSxDQUFDO1lBQ1IsS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUM7WUFDckIsU0FBUyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLFdBQVcsRUFBRSxDQUFDLENBQUM7UUFDMUMsQ0FBQztJQUNMLENBQUM7SUFFRCxPQUFPLEtBQUssQ0FBQztBQUNqQixDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFTLG1CQUFtQixDQUN4QixhQUFxQixFQUNyQixNQUEyQixFQUMzQixVQUFrQixFQUNsQixNQUFrRDtJQUVsRCxzRUFBc0U7SUFDdEUsSUFBSSxNQUFNLEtBQUssV0FBVztRQUFFLE9BQU8sTUFBTSxDQUFDO0lBRTFDLE1BQU0sVUFBVSxHQUFHLGFBQWEsQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUMvQyxNQUFNLFdBQVcsR0FBRyxVQUFVLENBQUMsV0FBVyxFQUFFLENBQUM7SUFDN0MsTUFBTSxTQUFTLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUVoRCwwQ0FBMEM7SUFDMUMsSUFBSSxNQUFNLEtBQUssUUFBUSxFQUFFLENBQUM7UUFDdEIsSUFBSSxVQUFVLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxJQUFJLFVBQVUsQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztZQUNyRSxPQUFPLE1BQU0sQ0FBQztRQUNsQixDQUFDO1FBQ0QsT0FBTyxRQUFRLENBQUM7SUFDcEIsQ0FBQztJQUVELDJCQUEyQjtJQUMzQixJQUFJLE1BQU0sS0FBSyxRQUFRO1FBQUUsT0FBTyxNQUFNLENBQUM7SUFFdkMsbURBQW1EO0lBQ25ELElBQUksTUFBTSxLQUFLLE1BQU07UUFBRSxPQUFPLFFBQVEsQ0FBQztJQUV2QyxPQUFPLEtBQUssQ0FBQztBQUNqQixDQUFDO0FBRUQ7O0dBRUc7QUFDSCxTQUFTLGdCQUFnQixDQUNyQixZQUFvQixFQUNwQixpQkFBcUUsRUFDckUsYUFBcUM7SUFFckMsSUFBSSxhQUFhLEtBQUssUUFBUSxFQUFFLENBQUM7UUFDN0IsT0FBTyxJQUFJLFlBQVksR0FBRyxDQUFDO0lBQy9CLENBQUM7SUFFRCxnRUFBZ0U7SUFDaEUsSUFBSSxhQUFhLEtBQUssV0FBVyxJQUFJLGlCQUFpQixDQUFDLElBQUksSUFBSSxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQy9GLE1BQU0sU0FBUyxHQUFHLGlCQUFpQixDQUFDLElBQUksQ0FBRSxDQUFDLENBQUUsQ0FBQztRQUM5QyxPQUFPLElBQUksWUFBWSxPQUFPLFNBQVMsSUFBSSxDQUFDO0lBQ2hELENBQUM7SUFFRCxzQ0FBc0M7SUFDdEMsT0FBTyxJQUFJLFlBQVksR0FBRyxDQUFDO0FBQy9CLENBQUM7QUFFRDs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FpQkc7QUFDSCxTQUFTLDhCQUE4QixDQUNuQyxhQUFtQyxFQUNuQyxlQUF1QixFQUN2QixpQkFBeUIsRUFDekIsWUFBOEMsRUFDOUMsWUFBOEMsRUFDOUMsYUFJQztJQUVELHVCQUF1QjtJQUN2QixNQUFNLE1BQU0sR0FBRyxxQkFBcUIsQ0FBQyxZQUFZLEVBQUUsWUFBWSxFQUFFLGFBQWEsQ0FBQyxDQUFDO0lBRWhGLGdDQUFnQztJQUNoQyxJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQ2xCLE9BQU8sU0FBUyxDQUFDO0lBQ3JCLENBQUM7SUFFRCx1QkFBdUI7SUFDdkIsTUFBTSxNQUFNLEdBQUcsa0JBQWtCLENBQUMsZUFBZSxFQUFFLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQztJQUVwRSxpREFBaUQ7SUFDakQsTUFBTSxlQUFlLEdBQUcsc0JBQXNCLENBQzFDLE1BQU0sRUFDTixpQkFBaUIsRUFDakIsTUFBTSxDQUFDLFFBQVEsRUFBRSxPQUFPLElBQUksRUFBRSxFQUM5QixNQUFNLENBQUMsZUFBZSxDQUN6QixDQUFDO0lBQ0YsTUFBTSxhQUFhLEdBQUcsc0JBQXNCLENBQUMsYUFBYSxFQUFFLGVBQWUsRUFBRSxNQUFNLENBQUMsYUFBYSxDQUFDLENBQUM7SUFFbkcsK0NBQStDO0lBQy9DLE1BQU0sY0FBYyxHQUFHLHNCQUFzQixDQUN6QyxNQUFNLEVBQ04saUJBQWlCLEVBQ2pCLE1BQU0sQ0FBQyxRQUFRLEVBQUUsTUFBTSxJQUFJLEVBQUUsQ0FDaEMsQ0FBQztJQUNGLE1BQU0sWUFBWSxHQUFHLHNCQUFzQixDQUFDLGFBQWEsRUFBRSxjQUFjLEVBQUUsTUFBTSxDQUFDLGFBQWEsQ0FBQyxDQUFDO0lBRWpHLDJDQUEyQztJQUMzQyxNQUFNLFlBQVksR0FBRyxzQkFBc0IsQ0FDdkMsTUFBTSxFQUNOLGlCQUFpQixFQUNqQixNQUFNLENBQUMsUUFBUSxFQUFFLElBQUksSUFBSSxFQUFFLENBQzlCLENBQUM7SUFDRixNQUFNLFVBQVUsR0FBRyxzQkFBc0IsQ0FBQyxhQUFhLEVBQUUsWUFBWSxFQUFFLE1BQU0sQ0FBQyxhQUFhLENBQUMsQ0FBQztJQUU3RixxQkFBcUI7SUFDckIsSUFBSSxhQUFhLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQzdCLE9BQU8sU0FBUyxDQUFDO0lBQ3JCLENBQUM7SUFFRCw2QkFBNkI7SUFDN0IsTUFBTSxZQUFZLEdBQUcsYUFBYSxDQUFFLENBQUMsQ0FBRSxDQUFDO0lBQ3hDLElBQUksTUFBTSxHQUErQyxNQUFNLENBQUM7SUFDaEUsSUFBSSxPQUFPLEdBQUcsU0FBUyxDQUFDO0lBRXhCLElBQUksTUFBTSxDQUFDLGVBQWUsSUFBSSxNQUFNLENBQUMsZUFBZSxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDO1FBQzFFLE1BQU0sR0FBRyxXQUFXLENBQUM7UUFDckIsT0FBTyxHQUFHLGlCQUFpQixDQUFDO0lBQ2hDLENBQUM7U0FBTSxJQUFJLE1BQU0sQ0FBQyxNQUFNLElBQUksWUFBWSxDQUFDLFdBQVcsRUFBRSxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLFdBQVcsRUFBRSxDQUFDLEVBQUUsQ0FBQztRQUM3RixNQUFNLEdBQUcsUUFBUSxDQUFDO1FBQ2xCLE9BQU8sR0FBRyxHQUFHLE1BQU0sQ0FBQyxNQUFNLGtCQUFrQixDQUFDO0lBQ2pELENBQUM7U0FBTSxJQUFJLFlBQVksQ0FBQyxXQUFXLEVBQUUsQ0FBQyxVQUFVLENBQUMsaUJBQWlCLENBQUMsV0FBVyxFQUFFLENBQUMsRUFBRSxDQUFDO1FBQ2hGLE1BQU0sR0FBRyxRQUFRLENBQUM7UUFDbEIsT0FBTyxHQUFHLGtCQUFrQixDQUFDO0lBQ2pDLENBQUM7U0FBTSxDQUFDO1FBQ0osTUFBTSxHQUFHLE1BQU0sQ0FBQztRQUNoQixPQUFPLEdBQUcsZ0JBQWdCLENBQUM7SUFDL0IsQ0FBQztJQUVELHVCQUF1QjtJQUN2QixNQUFNLFVBQVUsR0FBRyxtQkFBbUIsQ0FBQyxZQUFZLEVBQUUsTUFBTSxFQUFFLGlCQUFpQixFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBRXhGLDZCQUE2QjtJQUM3QixNQUFNLGNBQWMsR0FBRyxFQUFFLEdBQUcsRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUMsRUFBRSxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUM7SUFDdEQsSUFBSSxjQUFjLENBQUUsVUFBVSxDQUFFLEdBQUcsY0FBYyxDQUFFLE1BQU0sQ0FBQyxtQkFBbUIsQ0FBRSxFQUFFLENBQUM7UUFDOUUscUJBQXFCO1FBQ3JCLElBQUksTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDO1lBQ2YsdUJBQWEsQ0FBQyxJQUFJLENBQUMsdUNBQXVDLGVBQWUsZ0JBQWdCLFVBQVUsZ0JBQWdCLE1BQU0sQ0FBQyxtQkFBbUIsRUFBRSxDQUFDLENBQUM7UUFDckosQ0FBQztRQUNELE9BQU8sU0FBUyxDQUFDO0lBQ3JCLENBQUM7SUFFRCxvQkFBb0I7SUFDcEIsTUFBTSxRQUFRLEdBQUcsZ0JBQWdCLENBQzdCLFlBQVksRUFDWixFQUFFLE9BQU8sRUFBRSxhQUFhLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBRSxJQUFJLEVBQUUsVUFBVSxFQUFFLEVBQ2xFLE1BQU0sQ0FBQyxhQUFhLENBQ3ZCLENBQUM7SUFFRixnQkFBZ0I7SUFDaEIsSUFBSSxNQUFNLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDZix1QkFBYSxDQUFDLElBQUksQ0FBQyw4QkFBOEIsZUFBZSxNQUFNLFFBQVEsaUJBQWlCLFVBQVUsYUFBYSxNQUFNLEdBQUcsQ0FBQyxDQUFDO0lBQ3JJLENBQUM7SUFFRCxPQUFPO1FBQ0gsWUFBWTtRQUNaLFFBQVE7UUFDUixjQUFjLEVBQUU7WUFDWixPQUFPLEVBQUUsYUFBYTtZQUN0QixNQUFNLEVBQUUsWUFBWSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsU0FBUztZQUMxRCxJQUFJLEVBQUUsVUFBVSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsU0FBUztTQUN2RDtRQUNELFVBQVU7UUFDVixNQUFNO1FBQ04sT0FBTztLQUNWLENBQUM7QUFDTixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMscUNBQXFDLENBQzFDLGFBQW1DLEVBQ25DLGVBQXVCLEVBQ3ZCLGlCQUF5QjtJQUV6QixNQUFNLE1BQU0sR0FBRyw4QkFBOEIsQ0FDekMsYUFBYSxFQUNiLGVBQWUsRUFDZixpQkFBaUIsQ0FDcEIsQ0FBQztJQUNGLE9BQU8sTUFBTSxFQUFFLFFBQVEsQ0FBQztBQUM1QixDQUFDO0FBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBaUJHO0FBQ0g7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBb0JHO0FBQ0gsU0FBZ0Isd0JBQXdCLENBQ3BDLFVBQWtCLEVBQ2xCLE9BQWUsRUFDZixhQUFzQztJQUV0QyxzREFBc0Q7SUFDdEQsTUFBTSxjQUFjLEdBQUcsYUFBYSxFQUFFLGVBQWUsRUFBRSxFQUFFLENBQUMsS0FBSyxDQUFDO0lBQ2hFLE1BQU0sV0FBVyxHQUFHLGNBQWMsRUFBRSxnQkFBZ0IsSUFBSSxJQUFBLGtCQUFVLEVBQUMsVUFBVSxDQUFDLENBQUM7SUFFL0UsT0FBTztRQUNILHlGQUF5RjtRQUN6RixtREFBbUQ7UUFDbkQsUUFBUSxFQUFFLEdBQUcsV0FBVyxNQUFNLE9BQU8sR0FBRyxFQUFHLHlCQUF5QjtRQUNwRSxRQUFRLEVBQUUsUUFBUSxXQUFXLEVBQUUsRUFBWSxvQkFBb0I7UUFDL0QsZUFBZSxFQUFFLEdBQUcsV0FBVyxVQUFVLENBQUUsdUJBQXVCO0tBQ3JFLENBQUM7QUFDTixDQUFDO0FBV0Q7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQTBDRztBQUNILFNBQVMsY0FBYyxDQUNuQixNQUFtQyxFQUNuQyxVQUFrQixFQUNsQixPQUtDO0lBRUQsTUFBTSxhQUFhLEdBQUcsT0FBTyxFQUFFLGFBQWEsSUFBSSxRQUFRLENBQUM7SUFDekQsTUFBTSxLQUFLLEdBQUcsT0FBTyxFQUFFLEtBQUssSUFBSSxLQUFLLENBQUM7SUFFdEMsSUFBSSxNQUE2QyxDQUFDO0lBRWxELGlDQUFpQztJQUNqQyxNQUFNLFVBQVUsR0FBRyxNQUFNLENBQUMsVUFBVSxDQUFDO0lBQ3JDLE1BQU0sY0FBYyxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUM7SUFFL0MsZ0RBQWdEO0lBQ2hELE1BQU0sbUJBQW1CLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxtQkFBbUIsQ0FBQztJQUM3RCxJQUFJLG1CQUFtQixJQUFJLFVBQVUsQ0FBRSxtQkFBbUIsQ0FBRSxFQUFFLENBQUM7UUFDM0QsTUFBTSxHQUFHO1lBQ0wsS0FBSyxFQUFFLG1CQUFtQjtZQUMxQixVQUFVLEVBQUUsTUFBTTtZQUNsQixNQUFNLEVBQUUsVUFBVTtTQUNyQixDQUFDO1FBQ0YsSUFBSSxLQUFLLEVBQUUsQ0FBQztZQUNSLHVCQUFhLENBQUMsSUFBSSxDQUFDLG9CQUFvQixVQUFVLDBCQUEwQixtQkFBbUIsb0JBQW9CLENBQUMsQ0FBQztRQUN4SCxDQUFDO0lBQ0wsQ0FBQztJQUVELHdEQUF3RDtJQUN4RCxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7UUFDVixNQUFNLGNBQWMsR0FBRyxDQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLGFBQWEsRUFBRSxhQUFhLENBQUUsQ0FBQztRQUNsRixLQUFLLE1BQU0sT0FBTyxJQUFJLGNBQWMsRUFBRSxDQUFDO1lBQ25DLE1BQU0sS0FBSyxHQUFHLGNBQWMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLEtBQUssT0FBTyxDQUFDLENBQUM7WUFDMUUsSUFBSSxLQUFLLEVBQUUsQ0FBQztnQkFDUixNQUFNLEdBQUc7b0JBQ0wsS0FBSyxFQUFFLEtBQUs7b0JBQ1osVUFBVSxFQUFFLE1BQU07b0JBQ2xCLE1BQU0sRUFBRSxnQkFBZ0I7aUJBQzNCLENBQUM7Z0JBQ0YsSUFBSSxLQUFLLEVBQUUsQ0FBQztvQkFDUix1QkFBYSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsVUFBVSwrQkFBK0IsT0FBTyxPQUFPLEtBQUssb0JBQW9CLENBQUMsQ0FBQztnQkFDN0gsQ0FBQztnQkFDRCxNQUFNO1lBQ1YsQ0FBQztRQUNMLENBQUM7SUFDTCxDQUFDO0lBRUQseURBQXlEO0lBQ3pELElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztRQUNWLE1BQU0sV0FBVyxHQUFHLFVBQVUsQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUM3QyxNQUFNLHNCQUFzQixHQUFHLENBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxPQUFPLENBQUUsQ0FBQztRQUU1RCxLQUFLLE1BQU0sTUFBTSxJQUFJLHNCQUFzQixFQUFFLENBQUM7WUFDMUMsc0RBQXNEO1lBQ3RELE1BQU0sVUFBVSxHQUFHLGNBQWMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FDMUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxLQUFLLEdBQUcsV0FBVyxHQUFHLE1BQU0sQ0FBQyxXQUFXLEVBQUUsRUFBRSxDQUNqRSxDQUFDO1lBQ0YsSUFBSSxVQUFVLEVBQUUsQ0FBQztnQkFDYixNQUFNLEdBQUc7b0JBQ0wsS0FBSyxFQUFFLFVBQVU7b0JBQ2pCLFVBQVUsRUFBRSxNQUFNO29CQUNsQixNQUFNLEVBQUUsZ0JBQWdCO2lCQUMzQixDQUFDO2dCQUNGLElBQUksS0FBSyxFQUFFLENBQUM7b0JBQ1IsdUJBQWEsQ0FBQyxJQUFJLENBQUMsb0JBQW9CLFVBQVUseUNBQXlDLFVBQVUsb0JBQW9CLENBQUMsQ0FBQztnQkFDOUgsQ0FBQztnQkFDRCxNQUFNO1lBQ1YsQ0FBQztRQUNMLENBQUM7SUFDTCxDQUFDO0lBRUQsd0VBQXdFO0lBQ3hFLHlHQUF5RztJQUN6RyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7UUFDVixNQUFNLHdCQUF3QixHQUFHLGNBQWMsQ0FBQztRQUNoRCxNQUFNLGlCQUFpQixHQUFHLE9BQU8sQ0FBQztRQUNsQyxNQUFNLGtCQUFrQixHQUFHLFFBQVEsQ0FBQztRQUNwQyxNQUFNLGtCQUFrQixHQUFHLFFBQVEsQ0FBQztRQUNwQyxNQUFNLGlCQUFpQixHQUFHLE9BQU8sQ0FBQztRQUVsQyxLQUFLLE1BQU0sT0FBTyxJQUFJLENBQUUsd0JBQXdCLEVBQUUsa0JBQWtCLEVBQUUsa0JBQWtCLEVBQUUsaUJBQWlCLEVBQUUsaUJBQWlCLENBQUUsRUFBRSxDQUFDO1lBQy9ILE1BQU0sS0FBSyxHQUFHLGNBQWMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7WUFDOUQsSUFBSSxLQUFLLEVBQUUsQ0FBQztnQkFDUixNQUFNLEdBQUc7b0JBQ0wsS0FBSyxFQUFFLEtBQUs7b0JBQ1osVUFBVSxFQUFFLFFBQVE7b0JBQ3BCLE1BQU0sRUFBRSxnQkFBZ0I7aUJBQzNCLENBQUM7Z0JBQ0YsSUFBSSxLQUFLLEVBQUUsQ0FBQztvQkFDUix1QkFBYSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsVUFBVSxnQ0FBZ0MsS0FBSyxzQkFBc0IsQ0FBQyxDQUFDO2dCQUNsSCxDQUFDO2dCQUNELE1BQU07WUFDVixDQUFDO1FBQ0wsQ0FBQztJQUNMLENBQUM7SUFFRCxtRkFBbUY7SUFDbkYsOEVBQThFO0lBQzlFLEdBQUc7SUFDSCxnRkFBZ0Y7SUFDaEYsZ0dBQWdHO0lBQ2hHLCtFQUErRTtJQUMvRSxFQUFFO0lBQ0YsaUdBQWlHO0lBQ2pHLCtDQUErQztJQUUvQyw2QkFBNkI7SUFDN0IsSUFBSSxNQUFNLEVBQUUsQ0FBQztRQUNULHNEQUFzRDtRQUN0RCw4REFBOEQ7UUFDOUQsK0VBQStFO1FBQy9FLElBQUksYUFBYSxLQUFLLE1BQU0sSUFBSSxNQUFNLENBQUMsVUFBVSxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQzdELElBQUksS0FBSyxFQUFFLENBQUM7Z0JBQ1IsdUJBQWEsQ0FBQyxJQUFJLENBQUMsb0JBQW9CLFVBQVUsWUFBWSxNQUFNLENBQUMsS0FBSyxvRkFBb0YsQ0FBQyxDQUFDO1lBQ25LLENBQUM7WUFDRCxPQUFPLFNBQVMsQ0FBQztRQUNyQixDQUFDO1FBRUQsT0FBTyxNQUFNLENBQUMsS0FBSyxDQUFDO0lBQ3hCLENBQUM7SUFFRCwwQkFBMEI7SUFDMUIsSUFBSSxLQUFLLEVBQUUsQ0FBQztRQUNSLHVCQUFhLENBQUMsSUFBSSxDQUFDLG9CQUFvQixVQUFVLDZEQUE2RCxDQUFDLENBQUM7SUFDcEgsQ0FBQztJQUNELE9BQU8sU0FBUyxDQUFDO0FBQ3JCLENBQUM7QUFFRCwwRkFBMEY7QUFDMUYsb0NBQW9DO0FBQ3BDLDBGQUEwRjtBQUUxRjs7Ozs7Ozs7Ozs7R0FXRztBQUNILFNBQWdCLDJCQUEyQixDQUN2QyxjQUEwQyxFQUMxQyxpQkFBbUcsRUFDbkcsYUFBcUMsRUFDckMscUJBQWtFO0lBRWxFLE1BQU0sRUFBRSxVQUFVLEVBQUUsWUFBWSxFQUFFLGFBQWEsRUFBRSxHQUFHLElBQUksRUFBRSxHQUFHLGNBQWMsQ0FBQztJQUM1RSxNQUFNLFFBQVEsR0FBRyxpQkFBaUIsQ0FBQyxRQUFRLENBQUM7SUFFNUMsNkJBQTZCO0lBQzdCLElBQUksQ0FBQyxhQUFhLENBQUMsNEJBQTRCLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztRQUMxRCx1QkFBYSxDQUFDLElBQUksQ0FBQywrREFBK0QsVUFBVSxFQUFFLENBQUMsQ0FBQztRQUNoRyxPQUFPLFNBQVMsQ0FBQztJQUNyQixDQUFDO0lBRUQsTUFBTSxjQUFjLEdBQUcsYUFBYSxDQUFDLDRCQUE0QixDQUFDLFVBQVUsQ0FBQyxDQUFDO0lBQzlFLE1BQU0sYUFBYSxHQUFHLGNBQWMsRUFBRSxlQUFlLEVBQUUsRUFBRSxDQUFDO0lBRTFELElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUNqQix1QkFBYSxDQUFDLElBQUksQ0FBQyw4REFBOEQsVUFBVSxFQUFFLENBQUMsQ0FBQztRQUMvRixPQUFPLFNBQVMsQ0FBQztJQUNyQixDQUFDO0lBRUQscUJBQXFCO0lBQ3JCLE1BQU0sZUFBZSxHQUFHLFVBQVUsQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUNqRCxNQUFNLFFBQVEsR0FBRyxhQUFhLENBQUMsS0FBSyxDQUFDLFdBQVcsSUFBSSxFQUFFLENBQUM7SUFDdkQsTUFBTSxNQUFNLEdBQUcsWUFBWSxJQUFJLEdBQUcsUUFBUSxJQUFJLGVBQWUsRUFBRSxDQUFDO0lBRWhFLG1EQUFtRDtJQUNuRCxNQUFNLG1CQUFtQixHQUFHLE9BQU8sUUFBUSxDQUFDLFdBQVcsS0FBSyxVQUFVLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQztJQUN2SCxNQUFNLGtCQUFrQixHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxDQUFDLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxDQUFDLENBQUUsbUJBQW1CLENBQUUsQ0FBQztJQUM5RyxNQUFNLGlCQUFpQixHQUFHLGtCQUFrQixDQUFFLENBQUMsQ0FBRSxDQUFDO0lBQ2xELE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxpQkFBaUIsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUVwRCxnRUFBZ0U7SUFDaEUsSUFBSSxVQUFVLEdBQUcsVUFBVSxDQUFDLENBQUMsa0NBQWtDO0lBRS9ELElBQUksYUFBYSxFQUFFLEtBQUssRUFBRSxDQUFDO1FBQ3ZCLGlDQUFpQztRQUNqQyxVQUFVLEdBQUcsYUFBYSxDQUFDLEtBQWUsQ0FBQztJQUMvQyxDQUFDO1NBQU0sQ0FBQztRQUNKLDhEQUE4RDtRQUM5RCxNQUFNLGdCQUFnQixHQUFHLHFCQUFxQixFQUFFLG1CQUFtQixDQUFDO1FBQ3BFLFVBQVUsR0FBRyxjQUFjLENBQUMsYUFBYSxFQUFFLFVBQVUsRUFBRTtZQUNuRCxhQUFhLEVBQUUsZ0JBQWdCLEVBQUUsYUFBYSxJQUFJLFFBQVE7WUFDMUQsS0FBSyxFQUFFLGdCQUFnQixFQUFFLEtBQUssSUFBSSxLQUFLO1NBQzFDLENBQUMsSUFBSSxVQUFVLENBQUM7SUFDckIsQ0FBQztJQUVELDBDQUEwQztJQUMxQyxPQUFPO1FBQ0gsU0FBUyxFQUFFLEtBQUs7UUFDaEIsTUFBTTtRQUNOLFdBQVcsRUFBRSxPQUFPO1FBQ3BCLGFBQWEsRUFBRSxhQUFhLElBQUk7WUFDNUIsS0FBSyxFQUFFLFVBQVU7WUFDakIsS0FBSyxFQUFHLGFBQXFCLEVBQUUsS0FBSyxJQUFJLFVBQVU7U0FDckQ7UUFDRCxHQUFHLElBQUksQ0FBQyxtREFBbUQ7S0FDOUQsQ0FBQztBQUNOLENBQUM7QUFFRCwwRkFBMEY7QUFDMUYseUJBQXlCO0FBQ3pCLDBGQUEwRjtBQUUxRjs7Ozs7Ozs7Ozs7OztHQWFHO0FBQ0gsU0FBZ0Isb0JBQW9CLENBQ2hDLFNBQTZCLEVBQzdCLGFBQXNDLEVBQ3RDLHFCQUFrRTtJQUVsRSxnRUFBZ0U7SUFDaEUsSUFBSSxTQUFTLENBQUMsWUFBWSxFQUFFLENBQUM7UUFDekIsT0FBTyxTQUFTLENBQUMsWUFBWSxDQUFDO0lBQ2xDLENBQUM7SUFFRCxrREFBa0Q7SUFDbEQsSUFBSSxTQUFTLElBQUksU0FBUyxFQUFFLENBQUM7UUFDekIsTUFBTSxPQUFPLEdBQUksU0FBaUMsQ0FBQyxPQUFPLENBQUM7UUFFM0QsaUZBQWlGO1FBQ2pGLE1BQU0sZ0JBQWdCLEdBQUcsT0FBTyxPQUFPLEtBQUssUUFBUSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsSUFBSSxZQUFZLElBQUksT0FBTyxDQUFDO1FBRTNHLElBQUksY0FBc0UsQ0FBQztRQUUzRSwyQkFBMkI7UUFDM0IsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxJQUFJLE9BQU8sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDL0MsY0FBYyxHQUFHLE9BQXdCLENBQUM7UUFDOUMsQ0FBQztRQUVELDRFQUE0RTtRQUM1RSxNQUFNLFdBQVcsR0FBRyxPQUFPLE9BQU8sS0FBSyxRQUFRLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxJQUFJLFdBQVcsSUFBSSxPQUFPLENBQUM7UUFDckcsSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUNkLGNBQWMsR0FBRyxPQUFxQyxDQUFDO1FBQzNELENBQUM7UUFFRCxJQUFJLGdCQUFnQixJQUFJLFNBQVMsQ0FBQyxRQUFRLElBQUksYUFBYSxFQUFFLENBQUM7WUFDMUQsY0FBYyxHQUFHLDJCQUEyQixDQUN4QyxPQUFxQyxFQUNyQyxTQUE2RixFQUM3RixhQUFhLEVBQ2IscUJBQXFCLENBQ3hCLENBQUM7UUFDTixDQUFDO1FBRUQsSUFBSSxjQUFjLEVBQUUsQ0FBQztZQUNqQixPQUFPO2dCQUNILFVBQVUsRUFBRSxRQUFRO2dCQUNwQixlQUFlLEVBQUUsSUFBYTtnQkFDOUIsa0JBQWtCLEVBQUUsQ0FBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxXQUFXLEVBQUUsUUFBUSxFQUFFLFdBQVcsQ0FBRTtnQkFDakYsaUJBQWlCLEVBQUUsY0FBYzthQUNwQyxDQUFDO1FBQ04sQ0FBQztRQUVELGlCQUFpQjtRQUNqQixNQUFNLElBQUksdUJBQWMsQ0FBQyxrRUFBa0UsU0FBUyxDQUFDLEVBQUUsRUFBRSxFQUFFO1lBQ3ZHLFNBQVMsRUFBRSxTQUFTO1lBQ3BCLE9BQU8sRUFBRSxPQUFPO1NBQ25CLENBQUMsQ0FBQztJQUNQLENBQUM7SUFFRCxpREFBaUQ7SUFDakQsSUFBSSxTQUFTLENBQUMsWUFBWSxLQUFLLEtBQUssRUFBRSxDQUFDO1FBQ25DLE9BQU8sU0FBUyxDQUFDO0lBQ3JCLENBQUM7SUFFRCx3Q0FBd0M7SUFDeEMsTUFBTSxrQkFBa0IsR0FBRyxxQkFBcUIsRUFBRSxPQUFPLEVBQUUsb0JBQW9CLENBQUM7SUFDaEYsTUFBTSxjQUFjLEdBQUcsYUFBYSxFQUFFLGVBQWUsRUFBRSxFQUFFLENBQUMsS0FBSyxFQUFFLFFBQWdFLENBQUM7SUFDbEksTUFBTSxrQkFBa0IsR0FBRyxjQUFjLEVBQUUsT0FBTyxFQUFFLG9CQUFvQixDQUFDO0lBRXpFLDZDQUE2QztJQUM3QyxNQUFNLFlBQVksR0FBRztRQUNqQixPQUFPLEVBQUUsa0JBQWtCLEVBQUUsT0FBTyxJQUFJLGtCQUFrQixFQUFFLE9BQU8sSUFBSSxJQUFJO1FBQzNFLFVBQVUsRUFBRTtZQUNSLEdBQUcsa0JBQWtCLEVBQUUsVUFBVTtZQUNqQyxHQUFHLGtCQUFrQixFQUFFLFVBQVU7U0FDcEM7UUFDRCxVQUFVLEVBQUU7WUFDUixHQUFHLGtCQUFrQixFQUFFLFVBQVU7WUFDakMsR0FBRyxrQkFBa0IsRUFBRSxVQUFVO1NBQ3BDO1FBQ0QsYUFBYSxFQUFFO1lBQ1gsR0FBRyxrQkFBa0IsRUFBRSxhQUFhO1lBQ3BDLEdBQUcsa0JBQWtCLEVBQUUsYUFBYTtTQUN2QztRQUNELGNBQWMsRUFBRTtZQUNaLEdBQUcsa0JBQWtCLEVBQUUsY0FBYztZQUNyQyxHQUFHLGtCQUFrQixFQUFFLGNBQWM7U0FDeEM7UUFDRCxZQUFZLEVBQUU7WUFDVixHQUFHLGtCQUFrQixFQUFFLFlBQVk7WUFDbkMsR0FBRyxrQkFBa0IsRUFBRSxZQUFZO1NBQ3RDO1FBQ0QsVUFBVSxFQUFFO1lBQ1IsR0FBRyxrQkFBa0IsRUFBRSxVQUFVO1lBQ2pDLEdBQUcsa0JBQWtCLEVBQUUsVUFBVTtTQUNwQztRQUNELEtBQUssRUFBRSxrQkFBa0IsRUFBRSxLQUFLLElBQUksa0JBQWtCLEVBQUUsS0FBSyxJQUFJLEtBQUs7S0FDekUsQ0FBQztJQUVGLDZCQUE2QjtJQUM3QixJQUFJLENBQUMsWUFBWSxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQ3hCLE9BQU8sU0FBUyxDQUFDO0lBQ3JCLENBQUM7SUFFRCxNQUFNLFFBQVEsR0FBRyxTQUFTLENBQUMsSUFBSSxDQUFDO0lBQ2hDLE1BQU0sU0FBUyxHQUFHLFNBQVMsQ0FBQyxTQUFTLENBQUM7SUFFdEMsd0JBQXdCO0lBQ3hCLElBQUksUUFBUSxLQUFLLFNBQVMsSUFBSSxZQUFZLENBQUMsYUFBYSxFQUFFLE9BQU8sS0FBSyxLQUFLLEVBQUUsQ0FBQztRQUMxRSxPQUFPO1lBQ0gsVUFBVSxFQUFFLFNBQVM7WUFDckIsZUFBZSxFQUFFLElBQUk7WUFDckIsa0JBQWtCLEVBQUUsQ0FBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxXQUFXLENBQUU7WUFDMUQsaUJBQWlCLEVBQUU7Z0JBQ2YsRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUU7Z0JBQy9CLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsT0FBTyxFQUFFO2FBQ2xDO1NBQ0osQ0FBQztJQUNOLENBQUM7SUFFRCxnREFBZ0Q7SUFDaEQsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxJQUFJLFlBQVksQ0FBQyxVQUFVLEVBQUUsT0FBTyxLQUFLLEtBQUssRUFBRSxDQUFDO1FBQ3hFLE1BQU0sY0FBYyxHQUFHLENBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsV0FBVyxFQUFFLFFBQVEsRUFBRSxXQUFXLENBQVcsQ0FBQztRQUM5RixNQUFNLFNBQVMsR0FBRyxZQUFZLENBQUMsVUFBVSxFQUFFLGVBQWUsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3JFLE1BQU0sWUFBWSxHQUFHLFlBQVksQ0FBQyxVQUFVLEVBQUUsa0JBQWtCLElBQUksY0FBYyxDQUFDO1FBRW5GLE9BQU87WUFDSCxVQUFVLEVBQUUsUUFBUTtZQUNwQixlQUFlLEVBQUUsU0FBUztZQUMxQixrQkFBa0IsRUFBRSxZQUFZO1lBQ2hDLGlCQUFpQixFQUFFLFFBQVEsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxDQUFDO2dCQUNwQyxLQUFLLEVBQUUsTUFBTSxDQUFDLEdBQUcsQ0FBQztnQkFDbEIsS0FBSyxFQUFFLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBRSwyQ0FBMkM7YUFDbEUsQ0FBQyxDQUFDO1NBQ04sQ0FBQztJQUNOLENBQUM7SUFHRCw4QkFBOEI7SUFDOUIsSUFBSSxDQUFDLFNBQVMsS0FBSyxNQUFNLElBQUksU0FBUyxLQUFLLFVBQVUsSUFBSSxDQUFDLFFBQVEsS0FBSyxRQUFRLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDLFdBQVcsRUFBRSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsSUFBSSxTQUFTLENBQUMsRUFBRSxDQUFDLFdBQVcsRUFBRSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUM7V0FDMUssWUFBWSxDQUFDLFVBQVUsRUFBRSxPQUFPLEtBQUssS0FBSyxFQUFFLENBQUM7UUFDaEQsTUFBTSxjQUFjLEdBQUcsQ0FBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsUUFBUSxFQUFFLFdBQVcsQ0FBVyxDQUFDO1FBQzVHLE1BQU0sU0FBUyxHQUFHLFlBQVksQ0FBQyxVQUFVLEVBQUUsZ0JBQWdCLElBQUksY0FBYyxDQUFDO1FBRTlFLE1BQU0sWUFBWSxHQUFRO1lBQ3RCLFVBQVUsRUFBRSxVQUFVO1lBQ3RCLGVBQWUsRUFBRSxTQUFTLENBQUUsQ0FBQyxDQUFFLElBQUksQ0FBQyxLQUFLLENBQUM7WUFDMUMsa0JBQWtCLEVBQUUsU0FBUztTQUNoQyxDQUFDO1FBRUYsb0NBQW9DO1FBQ3BDLElBQUksWUFBWSxDQUFDLFVBQVUsRUFBRSxZQUFZLEtBQUssS0FBSyxFQUFFLENBQUM7WUFDbEQsWUFBWSxDQUFDLGlCQUFpQixHQUFHO2dCQUM3QixFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLGVBQWUsRUFBRTtnQkFDMUMsRUFBRSxLQUFLLEVBQUUsV0FBVyxFQUFFLEtBQUssRUFBRSxtQkFBbUIsRUFBRTtnQkFDbEQsRUFBRSxLQUFLLEVBQUUsV0FBVyxFQUFFLEtBQUssRUFBRSxjQUFjLEVBQUU7Z0JBQzdDLEVBQUUsS0FBSyxFQUFFLFdBQVcsRUFBRSxLQUFLLEVBQUUsa0JBQWtCLEVBQUU7Z0JBQ2pELEVBQUUsS0FBSyxFQUFFLFlBQVksRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFO2dCQUMvQyxFQUFFLEtBQUssRUFBRSxZQUFZLEVBQUUsS0FBSyxFQUFFLG1CQUFtQixFQUFFO2dCQUNuRCxFQUFFLEtBQUssRUFBRSxjQUFjLEVBQUUsS0FBSyxFQUFFLGlCQUFpQixFQUFFO2dCQUNuRCxFQUFFLEtBQUssRUFBRSxjQUFjLEVBQUUsS0FBSyxFQUFFLHFCQUFxQixFQUFFO2dCQUN2RCxFQUFFLEtBQUssRUFBRSxXQUFXLEVBQUUsS0FBSyxFQUFFLGNBQWMsRUFBRTtnQkFDN0MsRUFBRSxLQUFLLEVBQUUsV0FBVyxFQUFFLEtBQUssRUFBRSxrQkFBa0IsRUFBRTtnQkFDakQsRUFBRSxLQUFLLEVBQUUsYUFBYSxFQUFFLEtBQUssRUFBRSxnQkFBZ0IsRUFBRTtnQkFDakQsRUFBRSxLQUFLLEVBQUUsY0FBYyxFQUFFLEtBQUssRUFBRSxpQkFBaUIsRUFBRTtnQkFDbkQsRUFBRSxLQUFLLEVBQUUsY0FBYyxFQUFFLEtBQUssRUFBRSxpQkFBaUIsRUFBRTtnQkFDbkQsRUFBRSxLQUFLLEVBQUUsYUFBYSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBRSxnQ0FBZ0M7YUFDMUUsQ0FBQztRQUNOLENBQUM7UUFFRCxPQUFPLFlBQVksQ0FBQztJQUN4QixDQUFDO0lBRUQsdUJBQXVCO0lBQ3ZCLElBQUksUUFBUSxLQUFLLFFBQVEsSUFBSSxZQUFZLENBQUMsWUFBWSxFQUFFLE9BQU8sS0FBSyxLQUFLLEVBQUUsQ0FBQztRQUN4RSxNQUFNLGdCQUFnQixHQUFHLENBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLFFBQVEsRUFBRSxXQUFXLENBQVcsQ0FBQztRQUM5RyxNQUFNLFNBQVMsR0FBRyxZQUFZLENBQUMsWUFBWSxFQUFFLGdCQUFnQixJQUFJLGdCQUFnQixDQUFDO1FBQ2xGLE9BQU87WUFDSCxVQUFVLEVBQUUsUUFBUTtZQUNwQixlQUFlLEVBQUUsU0FBUyxDQUFFLENBQUMsQ0FBRSxJQUFJLENBQUMsSUFBSSxDQUFDO1lBQ3pDLGtCQUFrQixFQUFFLFNBQVM7U0FDaEMsQ0FBQztJQUNOLENBQUM7SUFFRCwyRkFBMkY7SUFDM0YsSUFBSSxTQUFTLENBQUMsUUFBUSxJQUFJLFlBQVksQ0FBQyxjQUFjLEVBQUUsT0FBTyxLQUFLLEtBQUssSUFBSSxhQUFhLEVBQUUsQ0FBQztRQUN4RixNQUFNLGNBQWMsR0FBK0IsRUFBRSxVQUFVLEVBQUUsU0FBUyxDQUFDLFFBQVEsQ0FBQyxVQUFVLEVBQUUsQ0FBQztRQUNqRyxNQUFNLFFBQVEsR0FBRywyQkFBMkIsQ0FDeEMsY0FBYyxFQUNkLFNBQTZGLEVBQzdGLGFBQWEsRUFDYixxQkFBcUIsQ0FDeEIsQ0FBQztRQUVGLElBQUksUUFBUSxFQUFFLENBQUM7WUFDWCxPQUFPO2dCQUNILFVBQVUsRUFBRSxVQUFVO2dCQUN0QixlQUFlLEVBQUUsSUFBYTtnQkFDOUIsa0JBQWtCLEVBQUUsQ0FBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxXQUFXLEVBQUUsUUFBUSxFQUFFLFdBQVcsQ0FBRTtnQkFDakYsaUJBQWlCLEVBQUUsUUFBUTthQUM5QixDQUFDO1FBQ04sQ0FBQztJQUNMLENBQUM7SUFFRCx3Q0FBd0M7SUFDeEMsSUFBSSxRQUFRLEtBQUssUUFBUSxJQUFJLFlBQVksQ0FBQyxVQUFVLEVBQUUsT0FBTyxLQUFLLEtBQUssRUFBRSxDQUFDO1FBQ3RFLE1BQU0sY0FBYyxHQUFHLENBQUUsVUFBVSxFQUFFLGFBQWEsRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLFlBQVksRUFBRSxVQUFVLEVBQUUsTUFBTSxFQUFFLFFBQVEsRUFBRSxXQUFXLENBQUUsQ0FBQztRQUMzSCxNQUFNLFNBQVMsR0FBRyxZQUFZLENBQUMsVUFBVSxFQUFFLGdCQUFnQixJQUFJLGNBQWMsQ0FBQztRQUM5RSxPQUFPO1lBQ0gsVUFBVSxFQUFFLE1BQU07WUFDbEIsZUFBZSxFQUFFLFNBQVMsQ0FBRSxDQUFDLENBQUUsSUFBSSxDQUFDLFVBQVUsQ0FBQztZQUMvQyxrQkFBa0IsRUFBRSxTQUFTO1NBQ2hDLENBQUM7SUFDTixDQUFDO0lBRUQsZ0JBQWdCO0lBQ2hCLElBQUksWUFBWSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ3JCLHVCQUFhLENBQUMsSUFBSSxDQUFDLG1CQUFtQixTQUFTLENBQUMsRUFBRSx1Q0FBdUMsUUFBUSxHQUFHLENBQUMsQ0FBQztJQUMxRyxDQUFDO0lBRUQsT0FBTyxTQUFTLENBQUM7QUFDckIsQ0FBQztBQUVELDBGQUEwRjtBQUMxRiwwQkFBMEI7QUFDMUIsMEZBQTBGO0FBRTFGOzs7O0dBSUc7QUFDSCxNQUFNLG9CQUFvQixHQUEyQjtJQUNqRCwyQkFBMkI7SUFDM0IsUUFBUSxFQUFFLHFCQUFxQjtJQUMvQixVQUFVLEVBQUUscUJBQXFCO0lBQ2pDLFNBQVMsRUFBRSxxQkFBcUI7SUFDaEMsVUFBVSxFQUFFLHFCQUFxQjtJQUVqQyxrQkFBa0I7SUFDbEIsU0FBUyxFQUFFLHFCQUFxQjtJQUNoQyxhQUFhLEVBQUUsY0FBYztJQUM3QixZQUFZLEVBQUUsY0FBYztJQUM1QixXQUFXLEVBQUUscUJBQXFCO0lBQ2xDLE1BQU0sRUFBRSxlQUFlO0lBQ3ZCLFVBQVUsRUFBRSxxQkFBcUI7SUFDakMsV0FBVyxFQUFFLHFCQUFxQjtJQUNsQyxVQUFVLEVBQUUscUJBQXFCO0lBQ2pDLFFBQVEsRUFBRSxxQkFBcUI7SUFDL0IsT0FBTyxFQUFFLDJCQUEyQjtJQUNwQyxRQUFRLEVBQUUscUJBQXFCO0lBRS9CLHNCQUFzQjtJQUN0QixXQUFXLEVBQUUsa0JBQWtCO0lBQy9CLFVBQVUsRUFBRSxrQkFBa0I7SUFDOUIsTUFBTSxFQUFFLG9CQUFvQjtJQUM1QixPQUFPLEVBQUUsY0FBYztJQUN2QixXQUFXLEVBQUUscUJBQXFCO0lBQ2xDLFVBQVUsRUFBRSxnQkFBZ0I7SUFFNUIsb0JBQW9CO0lBQ3BCLEtBQUssRUFBRSxjQUFjO0lBQ3JCLFFBQVEsRUFBRSxlQUFlO0lBQ3pCLE1BQU0sRUFBRSxZQUFZO0lBQ3BCLFVBQVUsRUFBRSxpQkFBaUI7SUFDN0IsUUFBUSxFQUFFLGNBQWM7SUFFeEIsb0JBQW9CO0lBQ3BCLFVBQVUsRUFBRSxxQkFBcUI7SUFDakMsVUFBVSxFQUFFLHFCQUFxQjtJQUNqQyxRQUFRLEVBQUUsYUFBYTtJQUV2QixxQkFBcUI7SUFDckIsTUFBTSxFQUFFLHFCQUFxQjtJQUM3QixPQUFPLEVBQUUscUJBQXFCO0NBQ2pDLENBQUM7QUFFRjs7Ozs7Ozs7OztHQVVHO0FBQ0gsU0FBUyxpQ0FBaUMsQ0FBQyxTQUFpQjtJQUN4RCxvREFBb0Q7SUFDcEQsTUFBTSxRQUFRLEdBQUc7UUFDYixvQkFBb0I7UUFDcEI7WUFDSSxLQUFLLEVBQUUsd0JBQXdCO1lBQy9CLFlBQVksRUFBRSxDQUFDLEtBQXVCLEVBQUUsRUFBRSxDQUFDLElBQUEsMkJBQW1CLEVBQUMsS0FBSyxDQUFFLENBQUMsQ0FBRSxDQUFDO1lBQzFFLGFBQWEsRUFBRSxDQUFDLEtBQXVCLEVBQUUsRUFBRTtnQkFDdkMsTUFBTSxJQUFJLEdBQUcsSUFBQSwyQkFBbUIsRUFBQyxLQUFLLENBQUUsQ0FBQyxDQUFFLENBQUMsQ0FBQztnQkFDN0Msb0NBQW9DO2dCQUNwQyxJQUFJLElBQUksQ0FBQyxXQUFXLEVBQUUsS0FBSyxRQUFRO29CQUFFLE9BQU8sVUFBVSxDQUFDO2dCQUN2RCxJQUFJLElBQUksQ0FBQyxXQUFXLEVBQUUsS0FBSyxTQUFTO29CQUFFLE9BQU8sVUFBVSxDQUFDO2dCQUN4RCxJQUFJLElBQUksQ0FBQyxXQUFXLEVBQUUsS0FBSyxTQUFTO29CQUFFLE9BQU8sUUFBUSxDQUFDO2dCQUN0RCxJQUFJLElBQUksQ0FBQyxXQUFXLEVBQUUsS0FBSyxRQUFRO29CQUFFLE9BQU8sU0FBUyxDQUFDO2dCQUN0RCxJQUFJLElBQUksQ0FBQyxXQUFXLEVBQUUsS0FBSyxXQUFXO29CQUFFLE9BQU8sYUFBYSxDQUFDO2dCQUM3RCxPQUFPLE9BQU8sSUFBSSxFQUFFLENBQUM7WUFDekIsQ0FBQztTQUNKO1FBQ0QscUJBQXFCO1FBQ3JCO1lBQ0ksS0FBSyxFQUFFLHlCQUF5QjtZQUNoQyxZQUFZLEVBQUUsQ0FBQyxLQUF1QixFQUFFLEVBQUUsQ0FBQyxPQUFPLElBQUEsMkJBQW1CLEVBQUMsS0FBSyxDQUFFLENBQUMsQ0FBRSxDQUFDLEVBQUU7WUFDbkYsYUFBYSxFQUFFLENBQUMsS0FBdUIsRUFBRSxFQUFFLENBQUMsTUFBTSxJQUFBLDJCQUFtQixFQUFDLEtBQUssQ0FBRSxDQUFDLENBQUUsQ0FBQyxFQUFFO1NBQ3RGO1FBQ0QscUJBQXFCO1FBQ3JCO1lBQ0ksS0FBSyxFQUFFLHlCQUF5QjtZQUNoQyxZQUFZLEVBQUUsQ0FBQyxLQUF1QixFQUFFLEVBQUUsQ0FBQyxPQUFPLElBQUEsMkJBQW1CLEVBQUMsS0FBSyxDQUFFLENBQUMsQ0FBRSxDQUFDLEVBQUU7WUFDbkYsYUFBYSxFQUFFLENBQUMsS0FBdUIsRUFBRSxFQUFFLENBQUMsVUFBVSxJQUFBLDJCQUFtQixFQUFDLEtBQUssQ0FBRSxDQUFDLENBQUUsQ0FBQyxFQUFFO1NBQzFGO1FBQ0Qsd0JBQXdCO1FBQ3hCO1lBQ0ksS0FBSyxFQUFFLDRCQUE0QjtZQUNuQyxZQUFZLEVBQUUsQ0FBQyxLQUF1QixFQUFFLEVBQUUsQ0FBQyxVQUFVLElBQUEsMkJBQW1CLEVBQUMsS0FBSyxDQUFFLENBQUMsQ0FBRSxDQUFDLEVBQUU7WUFDdEYsYUFBYSxFQUFFLENBQUMsS0FBdUIsRUFBRSxFQUFFLENBQUMsY0FBYyxJQUFBLDJCQUFtQixFQUFDLEtBQUssQ0FBRSxDQUFDLENBQUUsQ0FBQyxFQUFFO1NBQzlGO1FBQ0Qsc0JBQXNCO1FBQ3RCO1lBQ0ksS0FBSyxFQUFFLDBCQUEwQjtZQUNqQyxZQUFZLEVBQUUsQ0FBQyxLQUF1QixFQUFFLEVBQUUsQ0FBQyxRQUFRLElBQUEsMkJBQW1CLEVBQUMsS0FBSyxDQUFFLENBQUMsQ0FBRSxDQUFDLEVBQUU7WUFDcEYsYUFBYSxFQUFFLENBQUMsS0FBdUIsRUFBRSxFQUFFLENBQUMsWUFBWSxJQUFBLDJCQUFtQixFQUFDLEtBQUssQ0FBRSxDQUFDLENBQUUsQ0FBQyxFQUFFO1NBQzVGO1FBQ0Qsd0JBQXdCO1FBQ3hCO1lBQ0ksS0FBSyxFQUFFLDRCQUE0QjtZQUNuQyxZQUFZLEVBQUUsQ0FBQyxLQUF1QixFQUFFLEVBQUUsQ0FBQyxVQUFVLElBQUEsMkJBQW1CLEVBQUMsS0FBSyxDQUFFLENBQUMsQ0FBRSxDQUFDLEVBQUU7WUFDdEYsYUFBYSxFQUFFLENBQUMsS0FBdUIsRUFBRSxFQUFFLENBQUMsa0JBQWtCLElBQUEsMkJBQW1CLEVBQUMsS0FBSyxDQUFFLENBQUMsQ0FBRSxDQUFDLEVBQUU7U0FDbEc7UUFDRCx1QkFBdUI7UUFDdkI7WUFDSSxLQUFLLEVBQUUsMkJBQTJCO1lBQ2xDLFlBQVksRUFBRSxDQUFDLEtBQXVCLEVBQUUsRUFBRSxDQUFDLFNBQVMsSUFBQSwyQkFBbUIsRUFBQyxLQUFLLENBQUUsQ0FBQyxDQUFFLENBQUMsRUFBRTtZQUNyRixhQUFhLEVBQUUsQ0FBQyxLQUF1QixFQUFFLEVBQUUsQ0FBQyxpQkFBaUIsSUFBQSwyQkFBbUIsRUFBQyxLQUFLLENBQUUsQ0FBQyxDQUFFLENBQUMsRUFBRTtTQUNqRztRQUNELDBCQUEwQjtRQUMxQjtZQUNJLEtBQUssRUFBRSw4QkFBOEI7WUFDckMsWUFBWSxFQUFFLENBQUMsS0FBdUIsRUFBRSxFQUFFLENBQUMsWUFBWSxJQUFBLDJCQUFtQixFQUFDLEtBQUssQ0FBRSxDQUFDLENBQUUsQ0FBQyxFQUFFO1lBQ3hGLGFBQWEsRUFBRSxDQUFDLEtBQXVCLEVBQUUsRUFBRSxDQUFDLG9CQUFvQixJQUFBLDJCQUFtQixFQUFDLEtBQUssQ0FBRSxDQUFDLENBQUUsQ0FBQyxFQUFFO1NBQ3BHO0tBQ0osQ0FBQztJQUVGLEtBQUssTUFBTSxPQUFPLElBQUksUUFBUSxFQUFFLENBQUM7UUFDN0IsTUFBTSxLQUFLLEdBQUcsU0FBUyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDN0MsSUFBSSxLQUFLLEVBQUUsQ0FBQztZQUNSLE9BQU87Z0JBQ0gsU0FBUyxFQUFFLE9BQU8sQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDO2dCQUN0QyxVQUFVLEVBQUUsT0FBTyxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUM7YUFDM0MsQ0FBQztRQUNOLENBQUM7SUFDTCxDQUFDO0lBRUQsT0FBTyxJQUFJLENBQUM7QUFDaEIsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBUyxtQkFBbUIsQ0FBQyxLQUF5QjtJQUNsRCxxQkFBcUI7SUFDckIsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1FBQzVCLE9BQU8sS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUM7SUFDN0IsQ0FBQztJQUVELG1CQUFtQjtJQUNuQixJQUFJLEtBQUssQ0FBQyxJQUFJLEtBQUssU0FBUyxFQUFFLENBQUM7UUFDM0IsT0FBTyxDQUFDLENBQUM7SUFDYixDQUFDO0lBRUQscURBQXFEO0lBQ3JELE1BQU0sU0FBUyxHQUFHLEtBQUssQ0FBQyxTQUFTLENBQUM7SUFDbEMsSUFBSSxTQUFTLEtBQUssUUFBUSxJQUFJLFNBQVMsS0FBSyxPQUFPLElBQUksU0FBUyxLQUFLLFVBQVUsSUFBSSxTQUFTLEtBQUssY0FBYyxFQUFFLENBQUM7UUFDOUcsTUFBTSxPQUFPLEdBQUksS0FBYSxDQUFDLE9BQU8sQ0FBQztRQUN2QyxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUN6QixPQUFPLE9BQU8sQ0FBQyxNQUFNLENBQUM7UUFDMUIsQ0FBQztJQUNMLENBQUM7SUFFRCxPQUFPLENBQUMsQ0FBQztBQUNiLENBQUM7QUFFRDs7Ozs7Ozs7R0FRRztBQUNILFNBQVMsb0JBQW9CLENBQ3pCLEtBQXlCLEVBQ3pCLE1BQWlGO0lBRWpGLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxtQkFBbUIsSUFBSSxFQUFFLENBQUM7SUFDbkQsTUFBTSxXQUFXLEdBQUcsbUJBQW1CLENBQUMsS0FBSyxDQUFDLENBQUM7SUFFL0MseUNBQXlDO0lBQ3pDLElBQUksV0FBVyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQ3BCLE9BQU8sS0FBSyxDQUFDO0lBQ2pCLENBQUM7SUFFRCxtQ0FBbUM7SUFDbkMsT0FBTyxXQUFXLElBQUksTUFBTSxDQUFDLFNBQVMsSUFBSSxXQUFXLElBQUksU0FBUyxDQUFDO0FBQ3ZFLENBQUM7QUFFRDs7Ozs7Ozs7OztHQVVHO0FBQ0gsU0FBUyxtQkFBbUIsQ0FDeEIsVUFBcUMsRUFDckMsWUFBMkMsRUFDM0MsWUFBZ0k7SUFFaEksTUFBTSxhQUFhLEdBQUcsWUFBWSxFQUFFLHFCQUFxQixDQUFDO0lBRTFELDZDQUE2QztJQUM3QyxNQUFNLFlBQVksR0FBdUc7UUFDckgsT0FBTyxFQUFFLGFBQWEsRUFBRSxPQUFPLElBQUksWUFBWSxFQUFFLE9BQU8sSUFBSSxJQUFJO1FBQ2hFLGVBQWUsRUFBRSxhQUFhLEVBQUUsZUFBZSxJQUFJLFlBQVksRUFBRSxlQUFlLElBQUksQ0FBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxVQUFVLEVBQUUsVUFBVSxDQUFFO1FBQ3pJLGdCQUFnQixFQUFFLGFBQWEsRUFBRSxnQkFBZ0IsSUFBSSxZQUFZLEVBQUUsZ0JBQWdCLElBQUksQ0FBQztRQUN4RixtQkFBbUIsRUFBRSxhQUFhLEVBQUUsbUJBQW1CLElBQUksWUFBWSxFQUFFLG1CQUFtQixJQUFJLEVBQUU7UUFDbEcsU0FBUyxFQUFFLGFBQWEsRUFBRSxTQUFTLElBQUksWUFBWSxFQUFFLFNBQVMsSUFBSSxDQUFDO1FBQ25FLFdBQVcsRUFBRSxFQUFFLEdBQUcsb0JBQW9CLEVBQUUsR0FBRyxZQUFZLEVBQUUsV0FBVyxFQUFFLEdBQUcsYUFBYSxFQUFFLFdBQVcsRUFBRTtRQUNyRyxvQkFBb0IsRUFBRSxhQUFhLEVBQUUsb0JBQW9CLElBQUksWUFBWSxFQUFFLG9CQUFvQixJQUFJLEVBQUU7UUFDckcsb0JBQW9CLEVBQUUsYUFBYSxFQUFFLG9CQUFvQixJQUFJLFlBQVksRUFBRSxvQkFBb0IsSUFBSSxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRTtRQUMvSCxpQkFBaUIsRUFBRSxhQUFhLEVBQUUsaUJBQWlCLElBQUksWUFBWSxFQUFFLGlCQUFpQixJQUFJLElBQUk7UUFDOUYsS0FBSyxFQUFFLGFBQWEsRUFBRSxLQUFLLElBQUksWUFBWSxFQUFFLEtBQUssSUFBSSxLQUFLO0tBQzlELENBQUM7SUFFRixJQUFJLENBQUMsWUFBWSxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQ3hCLE9BQU8sRUFBRSxDQUFDO0lBQ2QsQ0FBQztJQUVELDhDQUE4QztJQUM5QyxNQUFNLGNBQWMsR0FBRyxhQUFhLEVBQUUsYUFBYSxJQUFJLGFBQWEsRUFBRSxZQUFZLENBQUM7SUFDbkYsSUFBSSxjQUFjLEVBQUUsQ0FBQztRQUNqQixNQUFNLFVBQVUsR0FBRyxPQUFPLGNBQWMsS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUUsY0FBYyxDQUFFLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQztRQUM1RixNQUFNLE9BQU8sR0FBd0UsRUFBRSxDQUFDO1FBRXhGLEtBQUssTUFBTSxTQUFTLElBQUksVUFBVSxFQUFFLENBQUM7WUFDakMsTUFBTSxLQUFLLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxLQUFLLFNBQVMsQ0FBQyxDQUFDO1lBQzVFLElBQUksS0FBSyxFQUFFLENBQUM7Z0JBQ1IsT0FBTyxDQUFDLElBQUksQ0FBQyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSx3QkFBd0IsRUFBRSxDQUFDLENBQUM7WUFDM0UsQ0FBQztRQUNMLENBQUM7UUFFRCxJQUFJLE9BQU8sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDckIsT0FBTyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxZQUFZLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztRQUMzRCxDQUFDO0lBQ0wsQ0FBQztJQUVELHFEQUFxRDtJQUNyRCxJQUFJLG1CQUFtQixHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUM7SUFFMUQsZ0VBQWdFO0lBQ2hFLElBQUksYUFBYSxFQUFFLGFBQWEsSUFBSSxhQUFhLENBQUMsYUFBYSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUN6RSxtQkFBbUIsR0FBRyxtQkFBbUIsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FDakQsYUFBYSxDQUFDLGFBQWMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUM5QyxDQUFDO0lBQ04sQ0FBQztJQUVELDZCQUE2QjtJQUM3QixJQUFJLGFBQWEsRUFBRSxhQUFhLElBQUksYUFBYSxDQUFDLGFBQWEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDekUsbUJBQW1CLEdBQUcsbUJBQW1CLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQ2pELENBQUMsYUFBYSxDQUFDLGFBQWMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUMvQyxDQUFDO0lBQ04sQ0FBQztJQUVELHVDQUF1QztJQUN2QyxNQUFNLGVBQWUsR0FBRyxZQUFZLENBQUMsZUFBZSxDQUFDO0lBQ3JELE1BQU0sZ0JBQWdCLEdBQXdFLEVBQUUsQ0FBQztJQUVqRyxLQUFLLE1BQU0sYUFBYSxJQUFJLGVBQWUsRUFBRSxDQUFDO1FBQzFDLE1BQU0sS0FBSyxHQUFHLG1CQUFtQixDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLEtBQUssYUFBYSxDQUFDLENBQUM7UUFDcEUsSUFBSSxLQUFLLElBQUksb0JBQW9CLENBQUMsS0FBSyxFQUFFLFlBQVksQ0FBQyxFQUFFLENBQUM7WUFDckQsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxHQUFHLEVBQUUsTUFBTSxFQUFFLG9CQUFvQixhQUFhLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFDOUYsQ0FBQztJQUNMLENBQUM7SUFFRCxtREFBbUQ7SUFDbkQsSUFBSSxnQkFBZ0IsQ0FBQyxNQUFNLElBQUksWUFBWSxDQUFDLGdCQUFnQixFQUFFLENBQUM7UUFDM0QsT0FBTyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLFlBQVksQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO0lBQ3BFLENBQUM7SUFFRCx3Q0FBd0M7SUFDeEMsTUFBTSxVQUFVLEdBQTZGLEVBQUUsQ0FBQztJQUVoSCxnREFBZ0Q7SUFDaEQsS0FBSyxNQUFNLEVBQUUsSUFBSSxnQkFBZ0IsRUFBRSxDQUFDO1FBQ2hDLE1BQU0sV0FBVyxHQUFHLG1CQUFtQixDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUNsRCxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUUsR0FBRyxFQUFFLEVBQUUsV0FBVyxFQUFFLENBQUMsQ0FBQztJQUM1QyxDQUFDO0lBRUQsS0FBSyxNQUFNLElBQUksSUFBSSxtQkFBbUIsRUFBRSxDQUFDO1FBQ3JDLHNDQUFzQztRQUN0QyxJQUFJLGdCQUFnQixDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsRUFBRSxLQUFLLElBQUksQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDO1lBQ3ZELFNBQVM7UUFDYixDQUFDO1FBRUQscUVBQXFFO1FBQ3JFLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLEVBQUUsWUFBWSxDQUFDLEVBQUUsQ0FBQztZQUM1QyxTQUFTO1FBQ2IsQ0FBQztRQUVELElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQztRQUNkLE1BQU0sT0FBTyxHQUFhLEVBQUUsQ0FBQztRQUM3QixNQUFNLFdBQVcsR0FBRyxtQkFBbUIsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUU5QyxxRUFBcUU7UUFDckUsS0FBSyxNQUFNLFNBQVMsSUFBSSxlQUFlLEVBQUUsQ0FBQztZQUN0QyxJQUFJLElBQUksQ0FBQyxFQUFFLENBQUMsV0FBVyxFQUFFLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxFQUFFLENBQUM7Z0JBQzFELEtBQUssSUFBSSxFQUFFLENBQUM7Z0JBQ1osT0FBTyxDQUFDLElBQUksQ0FBQyxrQkFBa0IsU0FBUyxHQUFHLENBQUMsQ0FBQztnQkFDN0MsTUFBTTtZQUNWLENBQUM7UUFDTCxDQUFDO1FBRUQsc0RBQXNEO1FBQ3RELDhDQUE4QztRQUM5QyxNQUFNLFNBQVMsR0FBRyxZQUFZLENBQUMsU0FBUyxDQUFDO1FBQ3pDLE1BQU0sU0FBUyxHQUFHLFlBQVksQ0FBQyxtQkFBbUIsQ0FBQztRQUVuRCxJQUFJLFdBQVcsSUFBSSxTQUFTLElBQUksV0FBVyxJQUFJLFNBQVMsRUFBRSxDQUFDO1lBQ3ZELCtDQUErQztZQUMvQyxxREFBcUQ7WUFDckQsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEVBQUUsRUFBRSxHQUFHLENBQUMsV0FBVyxHQUFHLFNBQVMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO1lBQ3JFLEtBQUssSUFBSSxXQUFXLENBQUM7WUFDckIsT0FBTyxDQUFDLElBQUksQ0FBQyxHQUFHLFdBQVcsVUFBVSxDQUFDLENBQUM7UUFDM0MsQ0FBQztRQUVELGlFQUFpRTtRQUNqRSxJQUFJLElBQUksQ0FBQyxJQUFJLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDMUIsS0FBSyxJQUFJLENBQUMsQ0FBQyxDQUFFLG9EQUFvRDtZQUNqRSxPQUFPLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxDQUFDO1FBQ2xDLENBQUM7UUFFRCxrRUFBa0U7UUFDbEUsTUFBTSxVQUFVLEdBQUcsbUJBQW1CLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3JELEtBQUssSUFBSSxJQUFJLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFFLG1CQUFtQjtRQUV0RCxVQUFVLENBQUMsSUFBSSxDQUFDO1lBQ1osS0FBSyxFQUFFLElBQUk7WUFDWCxLQUFLO1lBQ0wsTUFBTSxFQUFFLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO1lBQzFCLFdBQVc7U0FDZCxDQUFDLENBQUM7SUFDUCxDQUFDO0lBRUQsb0VBQW9FO0lBQ3BFLFVBQVUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUU7UUFDckIsSUFBSSxDQUFDLENBQUMsS0FBSyxLQUFLLENBQUMsQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUN0QixPQUFPLENBQUMsQ0FBQyxLQUFLLEdBQUcsQ0FBQyxDQUFDLEtBQUssQ0FBQztRQUM3QixDQUFDO1FBQ0QsT0FBTyxDQUFDLENBQUMsV0FBVyxHQUFHLENBQUMsQ0FBQyxXQUFXLENBQUMsQ0FBRSx1QkFBdUI7SUFDbEUsQ0FBQyxDQUFDLENBQUM7SUFFSCxNQUFNLFdBQVcsR0FBRyxVQUFVLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxZQUFZLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztJQUV2RSxJQUFJLFdBQVcsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxJQUFJLFlBQVksQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUMvQyx1QkFBYSxDQUFDLElBQUksQ0FBQywrQkFBK0IsV0FBVyxDQUFDLE1BQU0sWUFBWSxFQUFFLFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQ3BHLEtBQUssRUFBRSxDQUFDLENBQUMsS0FBSyxDQUFDLEVBQUU7WUFDakIsS0FBSyxFQUFFLENBQUMsQ0FBQyxLQUFLO1lBQ2QsV0FBVyxFQUFFLENBQUMsQ0FBQyxXQUFXO1lBQzFCLE1BQU0sRUFBRSxDQUFDLENBQUMsTUFBTTtTQUNuQixDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ1QsQ0FBQztJQUVELE9BQU8sV0FBVyxDQUFDO0FBQ3ZCLENBQUM7QUFFRDs7Ozs7Ozs7R0FRRztBQUNILFNBQWdCLGdCQUFnQixDQUM1QixVQUFxQyxFQUNyQyxhQUFvQyxFQUNwQyxxQkFBa0UsRUFDbEUsY0FBa0g7SUFFbEgsK0RBQStEO0lBQy9ELElBQUksY0FBYyxJQUFJLGNBQWMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDOUMsT0FBTyxjQUFjLENBQUM7SUFDMUIsQ0FBQztJQUVELG9CQUFvQjtJQUNwQixNQUFNLG1CQUFtQixHQUFHLHFCQUFxQixFQUFFLE9BQU8sRUFBRSxxQkFBcUIsQ0FBQztJQUNsRixNQUFNLGNBQWMsR0FBRyxhQUFhLEVBQUUsZUFBZSxFQUFFLEVBQUUsQ0FBQyxLQUFLLEVBQUUsUUFBUSxDQUFDO0lBQzFFLE1BQU0sbUJBQW1CLEdBQUcsY0FBYyxFQUFFLE9BQU8sQ0FBQztJQUVwRCw4REFBOEQ7SUFDOUQsSUFBSSxtQkFBbUIsRUFBRSxxQkFBcUIsRUFBRSxhQUFhLEVBQUUsQ0FBQztRQUM1RCxPQUFPLFNBQVMsQ0FBQztJQUNyQixDQUFDO0lBRUQsb0RBQW9EO0lBQ3BELE1BQU0sY0FBYyxHQUFHLG1CQUFtQixDQUFDLFVBQVUsRUFBRSxtQkFBbUIsRUFBRSxtQkFBbUIsQ0FBQyxDQUFDO0lBRWpHLElBQUksY0FBYyxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUM5QiwyQkFBMkI7UUFDM0IsSUFBSSxtQkFBbUIsRUFBRSxLQUFLLElBQUksbUJBQW1CLEVBQUUscUJBQXFCLEVBQUUsS0FBSyxFQUFFLENBQUM7WUFDbEYsdUJBQWEsQ0FBQyxJQUFJLENBQUMsOERBQThELENBQUMsQ0FBQztRQUN2RixDQUFDO1FBQ0QsT0FBTyxTQUFTLENBQUM7SUFDckIsQ0FBQztJQUVELG9DQUFvQztJQUNwQyxNQUFNLFlBQVksR0FBdUc7UUFDckgsT0FBTyxFQUFFLG1CQUFtQixFQUFFLHFCQUFxQixFQUFFLE9BQU8sSUFBSSxtQkFBbUIsRUFBRSxPQUFPLElBQUksSUFBSTtRQUNwRyxlQUFlLEVBQUUsbUJBQW1CLEVBQUUscUJBQXFCLEVBQUUsZUFBZSxJQUFJLG1CQUFtQixFQUFFLGVBQWUsSUFBSSxDQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFLFVBQVUsRUFBRSxVQUFVLENBQUU7UUFDN0ssZ0JBQWdCLEVBQUUsbUJBQW1CLEVBQUUscUJBQXFCLEVBQUUsZ0JBQWdCLElBQUksbUJBQW1CLEVBQUUsZ0JBQWdCLElBQUksQ0FBQztRQUM1SCxtQkFBbUIsRUFBRSxtQkFBbUIsRUFBRSxxQkFBcUIsRUFBRSxtQkFBbUIsSUFBSSxtQkFBbUIsRUFBRSxtQkFBbUIsSUFBSSxFQUFFO1FBQ3RJLFNBQVMsRUFBRSxtQkFBbUIsRUFBRSxxQkFBcUIsRUFBRSxTQUFTLElBQUksbUJBQW1CLEVBQUUsU0FBUyxJQUFJLENBQUM7UUFDdkcsV0FBVyxFQUFFO1lBQ1QsR0FBRyxvQkFBb0I7WUFDdkIsR0FBRyxtQkFBbUIsRUFBRSxXQUFXO1lBQ25DLEdBQUcsbUJBQW1CLEVBQUUscUJBQXFCLEVBQUUsV0FBVztTQUM3RDtRQUNELG9CQUFvQixFQUFFLG1CQUFtQixFQUFFLHFCQUFxQixFQUFFLG9CQUFvQixJQUFJLG1CQUFtQixFQUFFLG9CQUFvQixJQUFJLEVBQUU7UUFDekksb0JBQW9CLEVBQUUsbUJBQW1CLEVBQUUscUJBQXFCLEVBQUUsb0JBQW9CLElBQUksbUJBQW1CLEVBQUUsb0JBQW9CLElBQUksRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUU7UUFDbkssaUJBQWlCLEVBQUUsbUJBQW1CLEVBQUUscUJBQXFCLEVBQUUsaUJBQWlCLElBQUksbUJBQW1CLEVBQUUsaUJBQWlCLElBQUksSUFBSTtRQUNsSSxLQUFLLEVBQUUsbUJBQW1CLEVBQUUscUJBQXFCLEVBQUUsS0FBSyxJQUFJLG1CQUFtQixFQUFFLEtBQUssSUFBSSxLQUFLO0tBQ2xHLENBQUM7SUFFRixJQUFJLFlBQVksQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUNyQix1QkFBYSxDQUFDLElBQUksQ0FBQywrQ0FBK0MsY0FBYyxDQUFDLE1BQU0sWUFBWSxFQUFFLGNBQWMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFDOUksQ0FBQztJQUVELHNEQUFzRDtJQUN0RCxNQUFNLGFBQWEsR0FBK0IsRUFBRSxDQUFDO0lBRXJELEtBQUssTUFBTSxTQUFTLElBQUksY0FBYyxFQUFFLENBQUM7UUFDckMsTUFBTSxFQUFFLEtBQUssRUFBRSxHQUFHLFNBQVMsQ0FBQztRQUU1QixtQ0FBbUM7UUFDbkMsTUFBTSxRQUFRLEdBQTBCLEVBQUUsQ0FBQztRQUUzQywrQkFBK0I7UUFDL0IsSUFBSSxZQUFZLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztZQUNqQyxRQUFRLENBQUMsSUFBSSxDQUFDO2dCQUNWLEVBQUUsRUFBRSxPQUFPLEtBQUssQ0FBQyxFQUFFLEVBQUU7Z0JBQ3JCLEtBQUssRUFBRSxLQUFLO2dCQUNaLE9BQU8sRUFBRSxFQUFFO2dCQUNYLE9BQU8sRUFBRSxJQUFJO2FBQ2hCLENBQUMsQ0FBQztRQUNQLENBQUM7UUFFRCx3QkFBd0I7UUFDeEIsSUFBSSxNQUFNLEdBQWtDLEVBQUUsQ0FBQztRQUMvQyxJQUFJLFdBQVcsR0FBMkIsRUFBRSxDQUFDLENBQUUsNEJBQTRCO1FBRTNFLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUM1QixrQkFBa0I7WUFDbEIsTUFBTSxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUM7UUFDeEIsQ0FBQzthQUFNLElBQUksS0FBSyxDQUFDLElBQUksS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUNsQyw0Q0FBNEM7WUFDNUMsTUFBTSxHQUFHLENBQUUsSUFBSSxFQUFFLEtBQUssQ0FBRSxDQUFDO1lBRXpCLGtEQUFrRDtZQUNsRCxNQUFNLGtCQUFrQixHQUFHLGVBQWUsSUFBSSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztZQUN0RixJQUFJLGtCQUFrQixJQUFJLE9BQU8sa0JBQWtCLEtBQUssUUFBUSxFQUFFLENBQUM7Z0JBQy9ELFdBQVcsQ0FBRSxNQUFNLENBQUUsR0FBRyxrQkFBa0IsQ0FBQyxJQUFJLElBQUksS0FBSyxDQUFDO2dCQUN6RCxXQUFXLENBQUUsT0FBTyxDQUFFLEdBQUcsa0JBQWtCLENBQUMsS0FBSyxJQUFJLElBQUksQ0FBQztZQUM5RCxDQUFDO2lCQUFNLENBQUM7Z0JBQ0osZ0RBQWdEO2dCQUNoRCxNQUFNLFNBQVMsR0FBRyxLQUFLLENBQUMsRUFBRSxDQUFDO2dCQUMzQixNQUFNLFNBQVMsR0FBRyxpQ0FBaUMsQ0FBQyxTQUFTLENBQUMsQ0FBQztnQkFFL0QsSUFBSSxTQUFTLEVBQUUsQ0FBQztvQkFDWixXQUFXLENBQUUsTUFBTSxDQUFFLEdBQUcsU0FBUyxDQUFDLFNBQVMsQ0FBQztvQkFDNUMsV0FBVyxDQUFFLE9BQU8sQ0FBRSxHQUFHLFNBQVMsQ0FBQyxVQUFVLENBQUM7Z0JBQ2xELENBQUM7cUJBQU0sQ0FBQztvQkFDSiw4Q0FBOEM7b0JBQzlDLE1BQU0sUUFBUSxHQUFHLFlBQVksQ0FBQyxvQkFBb0IsQ0FBQztvQkFDbkQsSUFBSSxPQUFPLEdBQUcsS0FBSyxDQUFDO29CQUVwQixJQUFJLFFBQVEsSUFBSSxRQUFRLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO3dCQUNsQyxLQUFLLE1BQU0sT0FBTyxJQUFJLFFBQVEsRUFBRSxDQUFDOzRCQUM3QixNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsT0FBTyxZQUFZLE1BQU07Z0NBQzNDLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTztnQ0FDakIsQ0FBQyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsR0FBRyxDQUFDLENBQUM7NEJBRXZDLElBQUksS0FBSyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO2dDQUN4QixXQUFXLENBQUUsTUFBTSxDQUFFLEdBQUcsT0FBTyxDQUFDLFNBQVMsQ0FBQztnQ0FDMUMsV0FBVyxDQUFFLE9BQU8sQ0FBRSxHQUFHLE9BQU8sQ0FBQyxVQUFVLENBQUM7Z0NBQzVDLE9BQU8sR0FBRyxJQUFJLENBQUM7Z0NBQ2YsTUFBTTs0QkFDVixDQUFDO3dCQUNMLENBQUM7b0JBQ0wsQ0FBQztvQkFFRCxnREFBZ0Q7b0JBQ2hELElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQzt3QkFDWCxNQUFNLFFBQVEsR0FBRyxZQUFZLENBQUMsb0JBQW9CLElBQUksRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQzt3QkFDbkYsV0FBVyxDQUFFLE1BQU0sQ0FBRSxHQUFHLFFBQVEsQ0FBQyxJQUFJLENBQUM7d0JBQ3RDLFdBQVcsQ0FBRSxPQUFPLENBQUUsR0FBRyxRQUFRLENBQUMsS0FBSyxDQUFDO29CQUM1QyxDQUFDO2dCQUNMLENBQUM7WUFDTCxDQUFDO1FBQ0wsQ0FBQzthQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUyxLQUFLLFFBQVEsSUFBSSxLQUFLLENBQUMsU0FBUyxLQUFLLE9BQU8sSUFBSSxLQUFLLENBQUMsU0FBUyxLQUFLLFVBQVUsSUFBSSxLQUFLLENBQUMsU0FBUyxLQUFLLGNBQWMsQ0FBQyxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUUsS0FBYSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDeEwsa0RBQWtEO1lBQ2xELE1BQU0sT0FBTyxHQUFJLEtBQWEsQ0FBQyxPQUFrRCxDQUFDO1lBQ2xGLE1BQU0sR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ3ZDLDZCQUE2QjtZQUM3QixPQUFPLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxFQUFFO2dCQUNsQixXQUFXLENBQUUsTUFBTSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBRSxHQUFHLEdBQUcsQ0FBQyxLQUFLLENBQUM7WUFDakQsQ0FBQyxDQUFDLENBQUM7UUFDUCxDQUFDO1FBRUQsd0RBQXdEO1FBQ3hELE1BQU0sb0JBQW9CLEdBQUcsbUJBQW1CLEVBQUUscUJBQXFCLEVBQUUsb0JBQW9CLENBQUM7UUFDOUYsTUFBTSxhQUFhLEdBQUcsb0JBQW9CLEVBQUUsQ0FBRSxLQUFLLENBQUMsRUFBRSxDQUFFLElBQUksbUJBQW1CLEVBQUUscUJBQXFCLEVBQUUsYUFBYSxDQUFDO1FBQ3RILElBQUksYUFBYSxFQUFFLENBQUM7WUFDaEIsTUFBTSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDbkUsQ0FBQztRQUVELE1BQU0sb0JBQW9CLEdBQUcsbUJBQW1CLEVBQUUscUJBQXFCLEVBQUUsb0JBQW9CLENBQUM7UUFDOUYsTUFBTSxhQUFhLEdBQUcsb0JBQW9CLEVBQUUsQ0FBRSxLQUFLLENBQUMsRUFBRSxDQUFFLElBQUksbUJBQW1CLEVBQUUscUJBQXFCLEVBQUUsYUFBYSxDQUFDO1FBQ3RILElBQUksYUFBYSxFQUFFLENBQUM7WUFDaEIsTUFBTSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNwRSxDQUFDO1FBRUQscURBQXFEO1FBQ3JELE1BQU0sZ0JBQWdCLEdBQUcsbUJBQW1CLEVBQUUscUJBQXFCLEVBQUUsZ0JBQWdCLENBQUM7UUFDdEYsTUFBTSxTQUFTLEdBQUcsZ0JBQWdCLEVBQUUsQ0FBRSxLQUFLLENBQUMsRUFBRSxDQUFFLElBQUksbUJBQW1CLEVBQUUscUJBQXFCLEVBQUUsU0FBUyxDQUFDO1FBQzFHLElBQUksU0FBUyxFQUFFLENBQUM7WUFDWixNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFO2dCQUNqQixNQUFNLE1BQU0sR0FBRyxTQUFTLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUM1QyxNQUFNLE1BQU0sR0FBRyxTQUFTLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUU1Qyx1Q0FBdUM7Z0JBQ3ZDLElBQUksTUFBTSxJQUFJLENBQUMsSUFBSSxNQUFNLElBQUksQ0FBQyxFQUFFLENBQUM7b0JBQzdCLE9BQU8sTUFBTSxHQUFHLE1BQU0sQ0FBQztnQkFDM0IsQ0FBQztnQkFDRCwyQ0FBMkM7Z0JBQzNDLElBQUksTUFBTSxJQUFJLENBQUM7b0JBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQztnQkFDM0IsSUFBSSxNQUFNLElBQUksQ0FBQztvQkFBRSxPQUFPLENBQUMsQ0FBQztnQkFDMUIsZ0RBQWdEO2dCQUNoRCxPQUFPLENBQUMsQ0FBQztZQUNiLENBQUMsQ0FBQyxDQUFDO1FBQ1AsQ0FBQztRQUVELGtDQUFrQztRQUNsQyxLQUFLLE1BQU0sS0FBSyxJQUFJLE1BQU0sRUFBRSxDQUFDO1lBQ3pCLE1BQU0sUUFBUSxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUMvQixNQUFNLFVBQVUsR0FBRyxRQUFRLENBQUMsV0FBVyxFQUFFLENBQUM7WUFFMUMsNERBQTREO1lBQzVELE1BQU0sWUFBWSxHQUFHLFdBQVcsQ0FBRSxRQUFRLENBQUUsSUFBSSxJQUFBLGtCQUFVLEVBQUMsUUFBUSxDQUFDLENBQUM7WUFFckUsUUFBUSxDQUFDLElBQUksQ0FBQztnQkFDVixFQUFFLEVBQUUsR0FBRyxLQUFLLENBQUMsRUFBRSxJQUFJLFVBQVUsQ0FBQyxPQUFPLENBQUMsYUFBYSxFQUFFLEdBQUcsQ0FBQyxFQUFFLEVBQUcsWUFBWTtnQkFDMUUsS0FBSyxFQUFFLFlBQVksRUFBRyw0QkFBNEI7Z0JBQ2xELElBQUksRUFBRSxZQUFZLENBQUMsV0FBVyxDQUFFLFVBQVUsQ0FBRSxFQUFHLG9CQUFvQjtnQkFDbkUsT0FBTyxFQUFFO29CQUNMLENBQUUsS0FBSyxDQUFDLEVBQUUsQ0FBRSxFQUFFLEVBQUUsRUFBRSxFQUFFLEtBQUssRUFBRTtpQkFDOUI7YUFDSixDQUFDLENBQUM7UUFDUCxDQUFDO1FBRUQscUNBQXFDO1FBQ3JDLE1BQU0sV0FBVyxHQUFHLFlBQVksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDM0QsSUFBSSxRQUFRLENBQUMsTUFBTSxHQUFHLFdBQVcsRUFBRSxDQUFDO1lBQ2hDLGtEQUFrRDtZQUNsRCxNQUFNLGlCQUFpQixHQUFHLG1CQUFtQixFQUFFLHFCQUFxQixFQUFFLFdBQVcsQ0FBQztZQUNsRixNQUFNLEtBQUssR0FBRyxpQkFBaUIsRUFBRSxDQUFFLEtBQUssQ0FBQyxFQUFFLENBQUUsSUFBSSxNQUFNLElBQUEsa0JBQVUsRUFBQyxLQUFLLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQztZQUU5RSxhQUFhLENBQUMsSUFBSSxDQUFDO2dCQUNmLEVBQUUsRUFBRSxHQUFHLEtBQUssQ0FBQyxFQUFFLFFBQVE7Z0JBQ3ZCLEtBQUs7Z0JBQ0wsUUFBUTtnQkFDUixnQkFBZ0IsRUFBRSxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxFQUFFLEVBQUU7Z0JBQ25ELFVBQVUsRUFBRSxZQUFZLENBQUMsbUJBQW1CO2FBQy9DLENBQUMsQ0FBQztRQUNQLENBQUM7SUFDTCxDQUFDO0lBRUQseURBQXlEO0lBQ3pELElBQUksYUFBYSxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUM3QixPQUFPLFNBQVMsQ0FBQztJQUNyQixDQUFDO0lBRUQsdUZBQXVGO0lBQ3ZGLDJEQUEyRDtJQUMzRCxJQUFJLGFBQWEsQ0FBQyxNQUFNLEtBQUssQ0FBQyxJQUFJLFlBQVksQ0FBQyxnQkFBZ0IsS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUNwRSxPQUFPLGFBQWEsQ0FBRSxDQUFDLENBQUUsQ0FBQyxRQUFRLENBQUM7SUFDdkMsQ0FBQztJQUVELE9BQU8sYUFBYSxDQUFDO0FBQ3pCLENBQUM7QUFFRCwwRkFBMEY7QUFDMUYsOEJBQThCO0FBQzlCLDBGQUEwRjtBQUUxRjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQTRCRztBQUNILFNBQWdCLG9DQUFvQyxDQUNoRCxRQUE0QixFQUM1QixJQUFvQyxFQUNwQyxhQUFxQyxFQUNyQyxhQUFvQyxFQUFHLHFEQUFxRDtBQUM1RixxQkFBa0UsQ0FBRSxxQ0FBcUM7O0lBRXpHLE1BQU0sU0FBUyxHQUFRO1FBQ25CLEdBQUcsUUFBUTtRQUNYLHVHQUF1RztRQUN2RyxLQUFLLEVBQUcsUUFBZ0IsQ0FBQyxLQUFLLElBQUksSUFBQSwyQkFBbUIsRUFBQyxRQUFRLENBQUMsSUFBSSxDQUFDO1FBQ3BFLE1BQU0sRUFBRSxRQUFRLENBQUMsRUFBRTtRQUNuQixTQUFTLEVBQUUsUUFBUSxDQUFDLFNBQVMsSUFBSSxNQUFNLEVBQUcsdURBQXVEO1FBQ2pHLE1BQU0sRUFBRSxRQUFRLENBQUMsY0FBYyxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLFNBQVM7S0FDdEUsQ0FBQztJQUVGLDhIQUE4SDtJQUM5SCxJQUFJLElBQUEsOEJBQXFCLEVBQUMsUUFBUSxDQUFDLElBQUksQ0FBRSxRQUFRLEVBQUUsUUFBUSxDQUFFLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7UUFDM0UsTUFBTSxXQUFXLEdBQUcsUUFBK0IsQ0FBQztRQUVwRCxJQUFJLFdBQVcsQ0FBQyxrQkFBa0IsRUFBRSxDQUFDO1lBQ2pDLDZFQUE2RTtZQUM3RSxTQUFTLENBQUUsb0JBQW9CLENBQUUsR0FBRyxXQUFXLENBQUMsa0JBQWtCLENBQUM7UUFFdkUsQ0FBQzthQUFNLElBQUksV0FBVyxDQUFDLFlBQVksRUFBRSxDQUFDO1lBQ2xDLGdHQUFnRztZQUNoRyxNQUFNLEVBQUUsVUFBVSxFQUFFLGNBQWMsRUFBRSxHQUFHLFdBQVcsQ0FBQyxZQUFZLENBQUM7WUFFaEUsSUFBSSxVQUFVLElBQUksYUFBYSxDQUFDLDRCQUE0QixDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7Z0JBQ3ZFLFNBQVMsQ0FBRSxvQkFBb0IsQ0FBRSxHQUFHO29CQUNoQyxVQUFVLEVBQUUsVUFBVTtvQkFDdEIsUUFBUSxFQUFFLFFBQVE7b0JBQ2xCLGNBQWMsRUFBRSxjQUFjLElBQUk7d0JBQzlCLHFCQUFxQixFQUFFLFNBQVMsRUFBRywrQkFBK0I7d0JBQ2xFLFdBQVcsRUFBRTs0QkFDVCxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLFFBQVEsRUFBRTs0QkFDakMsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUU7eUJBQ3ZDO3FCQUNKO2lCQUNKLENBQUM7WUFDTixDQUFDO2lCQUFNLENBQUM7Z0JBQ0osdUJBQWEsQ0FBQyxJQUFJLENBQUMsMkZBQTJGLFVBQVUsUUFBUSxhQUFhLENBQUMsV0FBVyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUM7WUFDdEssQ0FBQztRQUNMLENBQUM7UUFFRCxxREFBcUQ7UUFDckQseUVBQXlFO1FBQ3pFLDBFQUEwRTtRQUMxRSxpRUFBaUU7UUFDakUsSUFBSSxXQUFXLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDMUIsU0FBUyxDQUFFLGFBQWEsQ0FBRSxHQUFHLFdBQVcsQ0FBQyxXQUFXLENBQUM7UUFDekQsQ0FBQztJQUNMLENBQUM7SUFFRCw2RkFBNkY7SUFDN0YsSUFBSSxJQUFBLDhCQUFxQixFQUFDLFFBQVEsQ0FBQyxJQUFJLFFBQVEsQ0FBQyxPQUFPO1dBQ2hELE9BQU8sUUFBUSxDQUFDLE9BQU8sS0FBSyxRQUFRLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUM7V0FDeEUsWUFBWSxJQUFJLFFBQVEsQ0FBQyxPQUFPLElBQUksUUFBUSxDQUFDLFFBQVEsRUFDMUQsQ0FBQztRQUNDLE1BQU0sUUFBUSxHQUFHLDJCQUEyQixDQUN4QyxRQUFRLENBQUMsT0FBcUMsRUFDOUMsUUFBNEYsRUFDNUYsYUFBYSxFQUNiLHFCQUFxQixDQUN4QixDQUFDO1FBQ0YsSUFBSSxRQUFRLEVBQUUsQ0FBQztZQUNYLFNBQVMsQ0FBRSxTQUFTLENBQUUsR0FBRyxRQUFRLENBQUM7UUFDdEMsQ0FBQztJQUNMLENBQUM7SUFFRCxpREFBaUQ7SUFDakQsSUFBSSxRQUFRLENBQUMsUUFBUSxJQUFJLElBQUksS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUN6QyxNQUFNLFFBQVEsR0FBRyxRQUFRLENBQUMsUUFBUSxDQUFDO1FBQ25DLE1BQU0sRUFBRSxVQUFVLEVBQUUsSUFBSSxFQUFFLFlBQVksRUFBRSxXQUFXLEVBQUUsR0FBRyxRQUFRLENBQUM7UUFDakUsTUFBTSxlQUFlLEdBQUcsVUFBVSxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBRWpELElBQUksQ0FBQyxhQUFhLENBQUMsNEJBQTRCLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztZQUMxRCx1QkFBYSxDQUFDLElBQUksQ0FBQywyRkFBMkYsVUFBVSxRQUFRLGFBQWEsQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQztZQUNsSyxPQUFPLFNBQVMsQ0FBQztRQUNyQixDQUFDO1FBRUQsK0RBQStEO1FBQy9ELE1BQU0sbUJBQW1CLEdBQUcsT0FBTyxXQUFXLEtBQUssVUFBVSxDQUFDLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDO1FBRTVGLHFDQUFxQztRQUNyQyxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsbUJBQW1CLENBQUMsRUFBRSxDQUFDO1lBQ3JDLElBQUksbUJBQW1CLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO2dCQUNuQyx1QkFBYSxDQUFDLElBQUksQ0FBQywrRUFBK0UsVUFBVSxHQUFHLENBQUMsQ0FBQztnQkFDakgsT0FBTyxTQUFTLENBQUM7WUFDckIsQ0FBQztRQUNMLENBQUM7UUFFRCxpRUFBaUU7UUFDakUsTUFBTSxrQkFBa0IsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLG1CQUFtQixDQUFDO1lBQ3pELENBQUMsQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFDO2dCQUM3QixNQUFNLEVBQUUsTUFBTSxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUM7Z0JBQ3pCLE1BQU0sRUFBRSxNQUFNLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQzthQUM1QixDQUFDLENBQUM7WUFDSCxDQUFDLENBQUMsQ0FBRTtvQkFDQSxNQUFNLEVBQUUsTUFBTSxDQUFDLG1CQUFtQixDQUFDLE1BQU0sQ0FBQztvQkFDMUMsTUFBTSxFQUFFLE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQyxNQUFNLENBQUM7aUJBQzdDLENBQUUsQ0FBQztRQUVSLGtFQUFrRTtRQUNsRSxvRkFBb0Y7UUFDcEYsTUFBTSxpQkFBaUIsR0FBRyxrQkFBa0IsQ0FBRSxDQUFDLENBQUUsQ0FBQztRQUVsRCxnRkFBZ0Y7UUFDaEYsTUFBTSxrQkFBa0IsR0FBRyxRQUFRLENBQUMsY0FBa0QsQ0FBQztRQUV2Rix1REFBdUQ7UUFDdkQsTUFBTSxvQkFBb0IsR0FBRyxhQUFhLENBQUMsNEJBQTRCLENBQUMsVUFBVSxDQUFDO1lBQy9FLENBQUMsQ0FBQyxhQUFhLENBQUMsNEJBQTRCLENBQUMsVUFBVSxDQUFDO1lBQ3hELENBQUMsQ0FBQyxTQUFTLENBQUM7UUFFaEIsdURBQXVEO1FBQ3ZELE1BQU0scUJBQXFCLEdBQUcsb0JBQW9CLEVBQUUsZUFBZSxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUM7UUFDOUUsTUFBTSxXQUFXLEdBQUcscUJBQXFCLEVBQUUsUUFBUSxFQUFFLElBQUksQ0FBQztRQUUxRCxJQUFJLFlBQVksQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQztZQUNsQywwQ0FBMEM7WUFDMUMseUZBQXlGO1lBQ3pGLE1BQU0sWUFBWSxHQUFHLGtCQUFrQixFQUFFLFlBQVk7bUJBQzlDLFNBQVMsZUFBZSxLQUFLLGlCQUFpQixDQUFDLE1BQU0sRUFBRSxDQUFDO1lBRS9ELGdFQUFnRTtZQUNoRSxNQUFNLGNBQWMsR0FBRyx3QkFBd0IsQ0FDM0MsVUFBVSxFQUNWLGlCQUFpQixDQUFDLE1BQU0sRUFDeEIsb0JBQW9CLENBQ3ZCLENBQUM7WUFFRixvRUFBb0U7WUFDcEUsa0RBQWtEO1lBQ2xELElBQUksWUFBWSxHQUF1QixTQUFTLENBQUM7WUFDakQsSUFBSSxpQkFBaUIsR0FBUSxTQUFTLENBQUM7WUFFdkMscURBQXFEO1lBQ3JELE1BQU0saUJBQWlCLEdBQUcsa0JBQWtCLEVBQUUsYUFBYSxFQUFFLFVBQVUsS0FBSyxLQUFLLENBQUM7WUFFbEYsSUFBSSxpQkFBaUIsSUFBSSxhQUFhLEVBQUUsQ0FBQztnQkFDckMsc0RBQXNEO2dCQUN0RCxNQUFNLFlBQVksR0FBRyxxQkFBcUIsRUFBRSx3QkFBd0IsQ0FBQztnQkFFckUsK0NBQStDO2dCQUMvQyxNQUFNLFlBQVksR0FBRyxxQkFBcUIsRUFBRSxRQUFRLEVBQUUsd0JBQXdCLENBQUM7Z0JBRS9FLDJCQUEyQjtnQkFDM0IsTUFBTSxhQUFhLEdBQUcsa0JBQWtCLEVBQUUsYUFBYSxFQUFFLGVBQWUsQ0FBQztnQkFFekUseUJBQXlCO2dCQUN6QixNQUFNLGVBQWUsR0FBRyw4QkFBOEIsQ0FDbEQsYUFBYSxFQUNiLFFBQVEsQ0FBQyxFQUFFLEVBQ1gsVUFBVSxFQUNWLFlBQVksRUFDWixZQUFZLEVBQ1osYUFBYSxDQUNoQixDQUFDO2dCQUVGLElBQUksZUFBZSxFQUFFLENBQUM7b0JBQ2xCLFlBQVksR0FBRyxlQUFlLENBQUMsUUFBUSxDQUFDO29CQUV4QyxtREFBbUQ7b0JBQ25ELGlCQUFpQixHQUFHO3dCQUNoQixjQUFjLEVBQUU7NEJBQ1osT0FBTyxFQUFFLGVBQWUsQ0FBQyxZQUFZOzRCQUNyQyxZQUFZLEVBQUUsZUFBZSxDQUFDLGNBQWMsQ0FBQyxPQUFPLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQzs0QkFDOUQsTUFBTSxFQUFFLGVBQWUsQ0FBQyxjQUFjLENBQUMsTUFBTTs0QkFDN0MsSUFBSSxFQUFFLGVBQWUsQ0FBQyxjQUFjLENBQUMsSUFBSTt5QkFDNUM7d0JBQ0QsVUFBVSxFQUFFLGVBQWUsQ0FBQyxVQUFVO3dCQUN0QyxNQUFNLEVBQUUsZUFBZSxDQUFDLE1BQU07d0JBQzlCLE9BQU8sRUFBRSxlQUFlLENBQUMsT0FBTztxQkFDbkMsQ0FBQztnQkFDTixDQUFDO1lBQ0wsQ0FBQztZQUVELE1BQU0sdUJBQXVCLEdBQXlCO2dCQUNsRCxZQUFZLEVBQUUsWUFBWTtnQkFDMUIseURBQXlEO2dCQUN6RCxpQkFBaUIsRUFBRSxrQkFBa0IsQ0FBQyxNQUFNLEtBQUssQ0FBQztvQkFDOUMsQ0FBQyxDQUFDLGtCQUFrQixDQUFFLENBQUMsQ0FBRSxDQUFFLHdCQUF3QjtvQkFDbkQsQ0FBQyxDQUFDLGtCQUFrQixFQUFNLHlCQUF5QjtnQkFDdkQsY0FBYyxFQUFFLGtCQUFrQixFQUFFLGNBQWMsSUFBSTtvQkFDbEQsVUFBVSxFQUFFLFVBQVU7b0JBQ3RCLFFBQVEsRUFBRSxNQUFNO29CQUNoQixjQUFjLEVBQUUsRUFBRTtpQkFDckI7Z0JBQ0QsVUFBVSxFQUFFLGtCQUFrQixFQUFFLFVBQVU7Z0JBQzFDLFVBQVUsRUFBRSxrQkFBa0IsRUFBRSxVQUFVO2dCQUMxQyxhQUFhLEVBQUU7b0JBQ1gsNkZBQTZGO29CQUM3RixRQUFRLEVBQUUsa0JBQWtCLEVBQUUsYUFBYSxFQUFFLFFBQVEsSUFBSSxZQUFZO29CQUNyRSxvREFBb0Q7b0JBQ3BELFFBQVEsRUFBRSxrQkFBa0IsRUFBRSxhQUFhLEVBQUUsUUFBUSxJQUFJLGNBQWM7b0JBQ3ZFLDZDQUE2QztvQkFDN0MsSUFBSSxFQUFFLGtCQUFrQixFQUFFLGFBQWEsRUFBRSxJQUFJLElBQUksV0FBVyxJQUFJLGFBQWE7b0JBQzdFLGFBQWEsRUFBRSxrQkFBa0IsRUFBRSxhQUFhLEVBQUUsYUFBYSxLQUFLLEtBQUs7b0JBQ3pFLFFBQVEsRUFBRSxrQkFBa0IsRUFBRSxhQUFhLEVBQUUsUUFBUSxLQUFLLEtBQUs7b0JBQy9ELDhDQUE4QztvQkFDOUMsVUFBVSxFQUFFLGtCQUFrQixFQUFFLGFBQWEsRUFBRSxVQUFVO29CQUN6RCxlQUFlLEVBQUUsa0JBQWtCLEVBQUUsYUFBYSxFQUFFLGVBQWU7b0JBQ25FLGtDQUFrQztvQkFDbEMsT0FBTyxFQUFFLGtCQUFrQixFQUFFLGFBQWEsRUFBRSxPQUFPO29CQUNuRCw2REFBNkQ7b0JBQzdELEdBQUcsQ0FBQyxrQkFBa0IsRUFBRSxhQUFhLEVBQUUsT0FBTyxJQUFJLEVBQUUsT0FBTyxFQUFFLGtCQUFrQixDQUFDLGFBQWEsQ0FBQyxPQUFPLEVBQUUsQ0FBQztpQkFDM0c7YUFDSixDQUFDO1lBQ0YsSUFBSSxxQkFBcUIsRUFBRSx3QkFBd0IsRUFBRSxLQUFLLEVBQUUsQ0FBQztnQkFDekQsdUJBQXVCLENBQUMsYUFBYyxDQUFFLG9CQUFvQixDQUFFLEdBQUcsaUJBQWlCLENBQUM7WUFDdkYsQ0FBQztZQUVELFNBQVMsQ0FBRSxnQkFBZ0IsQ0FBRSxHQUFHLHVCQUF1QixDQUFDO1lBRXhELHFEQUFxRDtZQUNyRCxTQUFTLENBQUUsUUFBUSxDQUFFLEdBQUcsSUFBSSxDQUFDO1lBQzdCLFNBQVMsQ0FBRSxZQUFZLENBQUUsR0FBRztnQkFDeEIsWUFBWSxFQUFFLFlBQVk7YUFDN0IsQ0FBQztRQUVOLENBQUM7YUFBTSxJQUFJLFlBQVksQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztZQUMxQyx5REFBeUQ7WUFDekQsK0VBQStFO1lBQy9FLE1BQU0sWUFBWSxHQUFHLGtCQUFrQixFQUFFLFlBQVk7bUJBQzlDLFNBQVMsZUFBZSxFQUFFLENBQUM7WUFFbEMsbURBQW1EO1lBQ25ELG1FQUFtRTtZQUNuRSwyREFBMkQ7WUFDM0QscURBQXFEO1lBQ3JELE1BQU0sY0FBYyxHQUF3QixFQUFFLENBQUM7WUFDL0Msa0JBQWtCLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFO2dCQUNqQyxjQUFjLENBQUUsT0FBTyxDQUFDLE1BQU0sQ0FBRSxHQUFHLElBQUksT0FBTyxDQUFDLE1BQU0sRUFBRSxDQUFDO1lBQzVELENBQUMsQ0FBQyxDQUFDO1lBRUgsNERBQTREO1lBQzVELE1BQU0sY0FBYyxHQUFHLHdCQUF3QixDQUMzQyxVQUFVLEVBQ1YsaUJBQWlCLENBQUMsTUFBTSxFQUN4QixvQkFBb0IsQ0FDdkIsQ0FBQztZQUVGLE1BQU0sdUJBQXVCLEdBQXlCO2dCQUNsRCxZQUFZLEVBQUUsWUFBWTtnQkFDMUIseURBQXlEO2dCQUN6RCxpQkFBaUIsRUFBRSxrQkFBa0IsQ0FBQyxNQUFNLEtBQUssQ0FBQztvQkFDOUMsQ0FBQyxDQUFDLGtCQUFrQixDQUFFLENBQUMsQ0FBRSxDQUFFLHdCQUF3QjtvQkFDbkQsQ0FBQyxDQUFDLGtCQUFrQixFQUFNLHlCQUF5QjtnQkFDdkQsY0FBYyxFQUFFLGtCQUFrQixFQUFFLGNBQWMsSUFBSTtvQkFDbEQsVUFBVSxFQUFFLFVBQVU7b0JBQ3RCLFFBQVEsRUFBRSxNQUFNO29CQUNoQixjQUFjLEVBQUU7d0JBQ1osY0FBYyxFQUFFLGNBQWM7cUJBQ2pDO2lCQUNKO2dCQUNELFVBQVUsRUFBRSxrQkFBa0IsRUFBRSxVQUFVO2dCQUMxQyxVQUFVLEVBQUUsa0JBQWtCLEVBQUUsVUFBVTtnQkFDMUMsYUFBYSxFQUFFO29CQUNYLHlDQUF5QztvQkFDekMsUUFBUSxFQUFFLGtCQUFrQixFQUFFLGFBQWEsRUFBRSxRQUFRO29CQUNyRCxvREFBb0Q7b0JBQ3BELFFBQVEsRUFBRSxrQkFBa0IsRUFBRSxhQUFhLEVBQUUsUUFBUSxJQUFJLGNBQWM7b0JBQ3ZFLDZDQUE2QztvQkFDN0MsSUFBSSxFQUFFLGtCQUFrQixFQUFFLGFBQWEsRUFBRSxJQUFJLElBQUksV0FBVyxJQUFJLHVCQUF1QjtvQkFDdkYsYUFBYSxFQUFFLGtCQUFrQixFQUFFLGFBQWEsRUFBRSxhQUFhLEtBQUssS0FBSztvQkFDekUsUUFBUSxFQUFFLGtCQUFrQixFQUFFLGFBQWEsRUFBRSxRQUFRLEtBQUssSUFBSSxFQUFFLDRCQUE0QjtvQkFDNUYsa0NBQWtDO29CQUNsQyxPQUFPLEVBQUUsa0JBQWtCLEVBQUUsYUFBYSxFQUFFLE9BQU87aUJBQ3REO2FBQ0osQ0FBQztZQUVGLHFGQUFxRjtZQUNyRixJQUFJLGtCQUFrQixFQUFFLGNBQWMsRUFBRSxjQUFjLEVBQUUsQ0FBQztnQkFDckQsdUJBQXVCLENBQUMsY0FBZSxDQUFDLGNBQWMsR0FBRztvQkFDckQsR0FBRyxrQkFBa0IsQ0FBQyxjQUFjLENBQUMsY0FBYztvQkFDbkQsY0FBYyxFQUFFO3dCQUNaLEdBQUcsY0FBYzt3QkFDakIsR0FBRyxDQUFDLGtCQUFrQixDQUFDLGNBQWMsQ0FBQyxjQUFjLENBQUMsY0FBYyxJQUFJLEVBQUUsQ0FBQztxQkFDN0U7aUJBQ0osQ0FBQztZQUNOLENBQUM7WUFFRCxTQUFTLENBQUUsZ0JBQWdCLENBQUUsR0FBRyx1QkFBdUIsQ0FBQztRQUM1RCxDQUFDO0lBQ0wsQ0FBQztJQUVELGdEQUFnRDtJQUNoRCxJQUFJLFFBQVEsQ0FBQyxJQUFJLEtBQUssS0FBSyxJQUFJLFFBQVEsQ0FBQyxVQUFVLEVBQUUsQ0FBQztRQUNqRCxTQUFTLENBQUUsWUFBWSxDQUFFLEdBQUcscUNBQXFDLENBQUMsUUFBUSxDQUFDLFVBQVUsRUFBRSxJQUFJLEVBQUUsYUFBYSxDQUFDLENBQUM7SUFDaEgsQ0FBQztTQUFNLElBQUksUUFBUSxDQUFDLElBQUksS0FBSyxNQUFNLEVBQUUsQ0FBQztRQUNsQyw4REFBOEQ7UUFDOUQsMkZBQTJGO1FBQzNGLE1BQU0sWUFBWSxHQUFHLFFBQWdHLENBQUM7UUFDdEgsSUFBSSxZQUFZLENBQUMsS0FBSyxFQUFFLElBQUksS0FBSyxLQUFLLElBQUksWUFBWSxDQUFDLEtBQUssQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUN0RSxTQUFTLENBQUUsT0FBTyxDQUFFLEdBQUc7Z0JBQ25CLEdBQUcsU0FBUyxDQUFFLE9BQU8sQ0FBRTtnQkFDdkIsVUFBVSxFQUFFLHFDQUFxQyxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsVUFBVSxFQUFFLElBQUksRUFBRSxhQUFhLENBQUM7YUFDeEcsQ0FBQztRQUNOLENBQUM7SUFDTCxDQUFDO0lBRUQsT0FBTyxTQUFTLENBQUM7QUFDckIsQ0FBQztBQUVEOzs7Ozs7Ozs7OztHQVdHO0FBQ0gsU0FBZ0IscUNBQXFDLENBQ2pELFVBQWdDLEVBQ2hDLElBQW9DLEVBQ3BDLGFBQXFDO0lBR3JDLElBQUksSUFBSSxLQUFLLFFBQVEsRUFBRSxDQUFDO1FBQ3BCLE9BQU8sK0JBQStCLENBQUMsVUFBVSxFQUFFLGFBQWEsQ0FBQyxDQUFDO0lBQ3RFLENBQUM7SUFFRCxJQUFJLElBQUksS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUNwQixPQUFPLCtCQUErQixDQUFDLFVBQVUsRUFBRSxhQUFhLENBQUMsQ0FBQztJQUN0RSxDQUFDO0lBRUQsSUFBSSxJQUFJLEtBQUssUUFBUSxFQUFFLENBQUM7UUFDcEIsT0FBTywrQkFBK0IsQ0FBQyxVQUFVLEVBQUUsYUFBYSxDQUFDLENBQUM7SUFDdEUsQ0FBQztJQUNELE1BQU0sQ0FBQyxpQkFBaUIsSUFBSSxxREFBcUQsQ0FBQyxDQUFDO0FBQ3ZGLENBQUM7QUFFRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBOEVHO0FBQ0gsU0FBZ0Isd0JBQXdCLENBQ3BDLGVBQWtFLEVBQ2xFLGFBQW1DLEVBQ25DLElBQW9DLEVBQ3BDLGFBQXFDLEVBQ3JDLHFCQUFrRTtJQUVsRSxNQUFNLFdBQVcsR0FBRyxJQUFJLEdBQUcsRUFBOEIsQ0FBQztJQUMxRCxhQUFhLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxFQUFFO1FBQ3pCLElBQUksSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsc0VBQXNFO1lBQ2pGLFdBQVcsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBRSxJQUFJLENBQUMsQ0FBQztRQUNuQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxPQUFPLGVBQWUsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLEVBQUU7UUFDakMsa0ZBQWtGO1FBQ2xGLElBQUksT0FBTyxPQUFPLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDOUIsTUFBTSxjQUFjLEdBQUcsV0FBVyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUNoRCxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUM7Z0JBQ2xCLE1BQU0sSUFBSSxLQUFLLENBQ1gsVUFBVSxPQUFPLGdDQUFnQztvQkFDakQsd0JBQXdCLEtBQUssQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJO29CQUNyRSxnR0FBZ0c7b0JBQ2hHLG9DQUFvQyxPQUFPLHFDQUFxQyxDQUNuRixDQUFDO1lBQ04sQ0FBQztZQUNELE9BQU8sb0NBQW9DLENBQUMsY0FBYyxFQUFFLElBQUksRUFBRSxhQUFhLEVBQUUsYUFBYSxFQUFFLHFCQUFxQixDQUFDLENBQUM7UUFDM0gsQ0FBQztRQUVELDZEQUE2RDtRQUM3RCxJQUFJLE9BQU8sT0FBTyxLQUFLLFFBQVEsSUFBSSxPQUFPLEtBQUssSUFBSSxFQUFFLENBQUM7WUFDbEQsdUNBQXVDO1lBQ3ZDLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLENBQUM7Z0JBQ2hCLHVCQUFhLENBQUMsSUFBSSxDQUFDLGtGQUFrRixFQUFFLE9BQU8sQ0FBQyxDQUFDO2dCQUNoSCxPQUFPLE9BQU8sQ0FBQyxDQUFDLG9DQUFvQztZQUN4RCxDQUFDO1lBRUQsb0ZBQW9GO1lBQ3BGLE1BQU0sTUFBTSxHQUFHLE9BQU8sQ0FBQyxNQUFNLElBQUksT0FBTyxDQUFDLElBQUksQ0FBQztZQUU5QyxxR0FBcUc7WUFDckcsTUFBTSxhQUFhLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBRSxDQUFDLENBQUUsQ0FBQztZQUM3QyxNQUFNLGNBQWMsR0FBRyxXQUFXLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxDQUFDO1lBRXRELCtGQUErRjtZQUMvRixJQUFJLGNBQWMsSUFBSSxNQUFNLEtBQUssYUFBYSxFQUFFLENBQUM7Z0JBQzdDLDJEQUEyRDtnQkFDM0QsTUFBTSxjQUFjLEdBQUcsb0NBQW9DLENBQUMsY0FBYyxFQUFFLElBQUksRUFBRSxhQUFhLEVBQUUsYUFBYSxFQUFFLHFCQUFxQixDQUFDLENBQUM7Z0JBQ3ZJLE9BQU87b0JBQ0gsR0FBRyxjQUFjO29CQUNqQixHQUFHLE9BQU8sRUFBRyxpQ0FBaUM7b0JBQzlDLE1BQU0sQ0FBRSx1QkFBdUI7aUJBQ2xDLENBQUM7WUFDTixDQUFDO1lBRUQsMEVBQTBFO1lBQzFFLDBEQUEwRDtZQUMxRCxNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsS0FBSyxJQUFJLElBQUEsMkJBQW1CLEVBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQ2pFLE1BQU0sU0FBUyxHQUFHLE9BQU8sQ0FBQyxTQUFTLElBQUksTUFBTSxDQUFDO1lBRTlDLG1DQUFtQztZQUNuQyxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxDQUFDO2dCQUNqQix1QkFBYSxDQUFDLEtBQUssQ0FDZixhQUFhLE9BQU8sQ0FBQyxJQUFJLHVDQUF1QyxLQUFLLEtBQUs7b0JBQzFFLHdFQUF3RSxDQUMzRSxDQUFDO1lBQ04sQ0FBQztZQUNELElBQUksQ0FBQyxPQUFPLENBQUMsU0FBUyxFQUFFLENBQUM7Z0JBQ3JCLHVCQUFhLENBQUMsS0FBSyxDQUNmLGFBQWEsT0FBTyxDQUFDLElBQUksOENBQThDO29CQUN2RSxzRUFBc0UsQ0FDekUsQ0FBQztZQUNOLENBQUM7WUFFRCxnQ0FBZ0M7WUFDaEMsT0FBTztnQkFDSCxHQUFHLE9BQU87Z0JBQ1YsTUFBTTtnQkFDTixLQUFLO2dCQUNMLFNBQVM7YUFDWixDQUFDO1FBQ04sQ0FBQztRQUVELG9EQUFvRDtRQUNwRCx1QkFBYSxDQUFDLElBQUksQ0FBQyxrQ0FBa0MsRUFBRSxPQUFPLENBQUMsQ0FBQztRQUNoRSxPQUFPLE9BQU8sQ0FBQztJQUNuQixDQUFDLENBQUMsQ0FBQztBQUNQLENBQUM7QUFFRDs7Ozs7Ozs7Ozs7Ozs7O0dBZUc7QUFDSCxTQUFnQixxQkFBcUIsQ0FDakMsY0FBbUIsRUFDbkIsYUFBbUMsRUFDbkMsYUFBcUMsRUFDckMscUJBQWtFO0lBRWxFLElBQUksQ0FBQyxjQUFjO1FBQUUsT0FBTyxjQUFjLENBQUM7SUFFM0MsTUFBTSxTQUFTLEdBQUcsRUFBRSxHQUFHLGNBQWMsRUFBRSxDQUFDO0lBRXhDLGdFQUFnRTtJQUNoRSxJQUFJLFNBQVMsQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUNyQixTQUFTLENBQUMsUUFBUSxHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFFLEdBQUcsRUFBRSxPQUFPLENBQW1CLEVBQUUsRUFBRTtZQUN0RyxHQUFHLENBQUUsR0FBRyxDQUFFLEdBQUcsb0JBQW9CLENBQUMsT0FBTyxFQUFFLGFBQWEsRUFBRSxhQUFhLEVBQUUscUJBQXFCLENBQUMsQ0FBQztZQUNoRyxPQUFPLEdBQUcsQ0FBQztRQUNmLENBQUMsRUFBRSxFQUF5QixDQUFDLENBQUM7SUFDbEMsQ0FBQztJQUVELHNDQUFzQztJQUN0QyxJQUFJLFNBQVMsQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUMxQixTQUFTLENBQUMsYUFBYSxHQUFHLFNBQVMsQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBVSxFQUFFLEVBQUU7WUFDakUsSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRO2dCQUFFLE9BQU8sS0FBSyxDQUFDO1lBRWxDLE9BQU87Z0JBQ0gsR0FBRyxLQUFLO2dCQUNSLFFBQVEsRUFBRSxNQUFNLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBRSxHQUFHLEVBQUUsT0FBTyxDQUFtQixFQUFFLEVBQUU7b0JBQ3ZGLEdBQUcsQ0FBRSxHQUFHLENBQUUsR0FBRyxvQkFBb0IsQ0FBQyxPQUFPLEVBQUUsYUFBYSxFQUFFLGFBQWEsRUFBRSxxQkFBcUIsQ0FBQyxDQUFDO29CQUNoRyxPQUFPLEdBQUcsQ0FBQztnQkFDZixDQUFDLEVBQUUsRUFBeUIsQ0FBQzthQUNoQyxDQUFDO1FBQ04sQ0FBQyxDQUFDLENBQUM7SUFDUCxDQUFDO0lBRUQsT0FBTyxTQUFTLENBQUM7QUFDckIsQ0FBQztBQUVEOzs7Ozs7Ozs7O0dBVUc7QUFDSCxTQUFTLG9CQUFvQixDQUN6QixPQUFZLEVBQ1osYUFBbUMsRUFDbkMsYUFBcUMsRUFDckMscUJBQWtFO0lBRWxFLE1BQU0sU0FBUyxHQUFHLEVBQUUsR0FBRyxPQUFPLEVBQUUsQ0FBQztJQUVqQyxrREFBa0Q7SUFDbEQsSUFBSSxTQUFTLENBQUMsUUFBUSxLQUFLLFNBQVMsSUFBSSxTQUFTLENBQUMsaUJBQWlCLEVBQUUsZ0JBQWdCLEVBQUUsQ0FBQztRQUNwRixNQUFNLE1BQU0sR0FBRyxTQUFTLENBQUMsaUJBQWlCLENBQUM7UUFDM0MsU0FBUyxDQUFDLGlCQUFpQixHQUFHO1lBQzFCLEdBQUcsTUFBTTtZQUNULGdCQUFnQixFQUFFLHdCQUF3QixDQUN0QyxNQUFNLENBQUMsZ0JBQWdCLEVBQ3ZCLGFBQWEsRUFDYixRQUFRLEVBQ1IsYUFBYSxFQUNiLHFCQUFxQixDQUN4QjtTQUNKLENBQUM7SUFDTixDQUFDO0lBRUQseUJBQXlCO0lBQ3pCLElBQUksU0FBUyxDQUFDLFFBQVEsS0FBSyxNQUFNLElBQUksU0FBUyxDQUFDLGNBQWMsRUFBRSxnQkFBZ0IsRUFBRSxDQUFDO1FBQzlFLE1BQU0sTUFBTSxHQUFHLFNBQVMsQ0FBQyxjQUFjLENBQUM7UUFDeEMsaURBQWlEO1FBQ2pELFNBQVMsQ0FBQyxjQUFjLEdBQUc7WUFDdkIsR0FBRyxNQUFNO1lBQ1QsZ0JBQWdCLEVBQUUsd0JBQXdCLENBQ3RDLE1BQU0sQ0FBQyxnQkFBZ0IsRUFDdkIsYUFBYSxFQUNiLFFBQVEsRUFDUixhQUFhLEVBQ2IscUJBQXFCLENBQ3hCO1NBQ0osQ0FBQztJQUNOLENBQUM7SUFFRCxPQUFPLFNBQVMsQ0FBQztBQUNyQixDQUFDO0FBRUQ7Ozs7Ozs7Ozs7R0FVRztBQUNILFNBQWdCLCtCQUErQixDQUFDLFVBQWdDLEVBQUUsYUFBcUMsRUFBRSxxQkFBa0U7SUFDdkwsT0FBTyxVQUFVO1NBQ1osTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLGFBQWEsQ0FBQyxJQUFJLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQztTQUNqRixHQUFHLENBQUMsQ0FBQyxHQUFHLEVBQUUsRUFBRSxDQUFDLG9DQUFvQyxDQUFDLEdBQUcsRUFBRSxRQUFRLEVBQUUsYUFBYSxFQUFFLFVBQVUsRUFBRSxxQkFBcUIsQ0FBQyxDQUFDLENBQUM7QUFDN0gsQ0FBQztBQUVEOzs7Ozs7Ozs7O0dBVUc7QUFDSCxTQUFnQiwrQkFBK0IsQ0FBQyxVQUFnQyxFQUFFLGFBQXFDLEVBQUUscUJBQWtFO0lBQ3ZMLE9BQU8sVUFBVTtTQUNaLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxZQUFZLENBQUMsSUFBSSxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUM7U0FDL0UsR0FBRyxDQUFDLENBQUMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxvQ0FBb0MsQ0FBQyxHQUFHLEVBQUUsUUFBUSxFQUFFLGFBQWEsRUFBRSxVQUFVLEVBQUUscUJBQXFCLENBQUMsQ0FBQyxDQUFDO0FBQzdILENBQUM7QUFFRDs7Ozs7Ozs7OztHQVVHO0FBQ0gsU0FBZ0IsK0JBQStCLENBQUMsVUFBZ0MsRUFBRSxhQUFxQyxFQUFFLHFCQUFrRTtJQUN2TCxPQUFPLFVBQVU7U0FDWixNQUFNLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsV0FBVyxDQUFDLElBQUksSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1NBQzdFLEdBQUcsQ0FBQyxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUMsb0NBQW9DLENBQUMsR0FBRyxFQUFFLFFBQVEsRUFBRSxhQUFhLEVBQUUsVUFBVSxFQUFFLHFCQUFxQixDQUFDLENBQUMsQ0FBQztBQUM3SCxDQUFDO0FBcUJEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0EyQkc7QUFDSCxTQUFnQiw2QkFBNkIsQ0FDekMsVUFBa0IsRUFDbEIsVUFBZ0MsRUFDaEMsYUFBcUMsRUFDckMsRUFDSSxXQUFXLEVBQ1gsc0JBQXNCLEVBQ3RCLHNCQUFzQixFQUN0QixzQkFBc0IsRUFDdEIsZ0JBQWdCLEVBQ2hCLHFCQUFxQixFQVF4QjtJQUdELE1BQU0sZUFBZSxHQUFHLFVBQVUsQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUNqRCxNQUFNLG9CQUFvQixHQUFHLElBQUEsa0JBQVUsRUFBQyxVQUFVLENBQUMsQ0FBQztJQUVwRCxPQUFPLFVBQVU7U0FDWixNQUFNLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLFVBQVUsQ0FBQztTQUN2QyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUU7UUFDUixrRkFBa0Y7UUFDbEYsOEZBQThGO1FBQzlGLE1BQU0sU0FBUyxHQUFHLG9DQUFvQyxDQUFDLElBQUksRUFBRSxRQUFRLEVBQUUsYUFBYSxFQUFFLFVBQVUsRUFBRSxxQkFBcUIsQ0FBQyxDQUFDO1FBRXpILDRFQUE0RTtRQUM1RSxNQUFNLHlCQUF5QixHQUFHLENBQUMsU0FBUyxDQUFDLFlBQVksSUFBSSxJQUFJLENBQUMsWUFBWSxLQUFLLEtBQUs7WUFDcEYsQ0FBQyxDQUFDLG9CQUFvQixDQUFDLElBQUksRUFBRSxhQUFhLEVBQUUscUJBQXFCLENBQUM7WUFDbEUsQ0FBQyxDQUFDLFNBQVMsQ0FBQztRQUVoQix3Q0FBd0M7UUFDeEMsTUFBTSxVQUFVLEdBQXNCO1lBQ2xDLEdBQUcsU0FBUztZQUNaLElBQUksRUFBRSxTQUFTLENBQUMsS0FBSyxJQUFJLFNBQVMsQ0FBQyxJQUFJLEVBQUcsNkNBQTZDO1lBQ3ZGLFNBQVMsRUFBRSxHQUFHLElBQUksQ0FBQyxFQUFFLEVBQUU7WUFDdkIsU0FBUyxFQUFFLFNBQVMsQ0FBQyxTQUFTLElBQUksTUFBTTtZQUN4QyxZQUFZLEVBQUUsU0FBUyxDQUFDLFlBQVksSUFBSSx5QkFBeUIsRUFBRyxpQ0FBaUM7WUFDckcsTUFBTSxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUztTQUM5RCxDQUFDO1FBRUYsSUFBSSxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDcEIscUNBQXFDO1lBQ3JDLE1BQU0sY0FBYyxHQUE2QixFQUFFLENBQUM7WUFFcEQsSUFBSSxDQUFDLHNCQUFzQixFQUFFLENBQUM7Z0JBQzFCLGNBQWMsQ0FBQyxJQUFJLENBQUM7b0JBQ2hCLEVBQUUsRUFBRSxNQUFNO29CQUNWLElBQUksRUFBRSxNQUFNO29CQUNaLEtBQUssRUFBRSxNQUFNO29CQUNiLFFBQVEsRUFBRSxTQUFTLElBQUksQ0FBQyxFQUFFLEdBQUc7b0JBQzdCLEdBQUcsRUFBRSxTQUFTLGVBQWUsRUFBRTtpQkFDbEMsQ0FBQyxDQUFDO1lBQ1AsQ0FBQztZQUVELElBQUksQ0FBQyxzQkFBc0IsRUFBRSxDQUFDO2dCQUMxQixjQUFjLENBQUMsSUFBSSxDQUFDO29CQUNoQixFQUFFLEVBQUUsTUFBTTtvQkFDVixJQUFJLEVBQUUsTUFBTTtvQkFDWixLQUFLLEVBQUUsTUFBTTtvQkFDYixRQUFRLEVBQUUsU0FBUyxJQUFJLENBQUMsRUFBRSxHQUFHO29CQUM3QixHQUFHLEVBQUUsU0FBUyxlQUFlLEVBQUU7aUJBQ2xDLENBQUMsQ0FBQztZQUNQLENBQUM7WUFFRCxJQUFJLENBQUMsc0JBQXNCLEVBQUUsQ0FBQztnQkFDMUIsY0FBYyxDQUFDLElBQUksQ0FBQztvQkFDaEIsRUFBRSxFQUFFLFFBQVE7b0JBQ1osSUFBSSxFQUFFLFFBQVE7b0JBQ2QsS0FBSyxFQUFFLFFBQVE7b0JBQ2YsUUFBUSxFQUFFLFdBQVcsSUFBSSxDQUFDLEVBQUUsR0FBRztvQkFDL0IsV0FBVyxFQUFFLElBQUk7b0JBQ2pCLFdBQVcsRUFBRTt3QkFDVCxTQUFTLEVBQUUsU0FBUzt3QkFDcEIsZUFBZSxFQUFFOzRCQUNiLEtBQUssRUFBRSxVQUFVLG9CQUFvQixHQUFHOzRCQUN4QyxPQUFPLEVBQUUsd0NBQXdDLG9CQUFvQixpQ0FBaUM7eUJBQ3pHO3dCQUNELFNBQVMsRUFBRTs0QkFDUCxTQUFTLEVBQUUsUUFBUTs0QkFDbkIsV0FBVyxFQUFFLGVBQWU7NEJBQzVCLE1BQU0sRUFBRSxHQUFHLFdBQVcsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxFQUFFLElBQUksZUFBZSxFQUFFO3lCQUNqRTt3QkFDRCxjQUFjLEVBQUUsR0FBRyxvQkFBb0IsdUJBQXVCO3dCQUM5RCxZQUFZLEVBQUUsb0JBQW9CLG9CQUFvQixFQUFFO3dCQUN4RCxxQkFBcUIsRUFBRSxTQUFTLGVBQWUsRUFBRTtxQkFDcEQ7aUJBQ0osQ0FBQyxDQUFDO1lBQ1AsQ0FBQztZQUVELDJEQUEyRDtZQUMzRCxVQUFVLENBQUMsT0FBTyxHQUFHLGdCQUFnQjtnQkFDakMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxjQUFjLEVBQUUsZ0JBQWdCLENBQUM7Z0JBQ2hELENBQUMsQ0FBQyxjQUFjLENBQUM7UUFDekIsQ0FBQztRQUVELE9BQU8sVUFBVSxDQUFDO0lBQ3RCLENBQUMsQ0FBQyxDQUFDO0FBQ1gsQ0FBQztBQUVEOzs7Ozs7O0dBT0c7QUFFSDs7Ozs7O0dBTUc7QUFDSDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQTRCRztBQUNILFNBQWdCLFlBQVksQ0FDeEIsUUFBa0IsRUFDbEIsVUFBdUMsRUFBRTtJQUV6QyxNQUFNLFlBQVksR0FBRyxDQUFFLEdBQUcsT0FBTyxDQUFFLENBQUMsQ0FBRSwyQkFBMkI7SUFDakUsTUFBTSxTQUFTLEdBQUcsSUFBSSxHQUFHLENBQ3JCLFlBQVksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBRSxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBRSxDQUFDLENBQ3ZELENBQUM7SUFFRixxREFBcUQ7SUFDckQsTUFBTSxNQUFNLEdBQUcsUUFBUSxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUNyQyxVQUFVLENBQUMsRUFBRSxJQUFJLFNBQVMsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztRQUN6QyxDQUFDLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFFLENBQUUsV0FBVztRQUM1QyxDQUFDLENBQUMsVUFBVSxDQUNuQixDQUFDO0lBRUYsa0RBQWtEO0lBQ2xELFlBQVksQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLEVBQUU7UUFDN0IsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsS0FBSyxTQUFTLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQztZQUM5RCxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUUsVUFBVTtRQUN2QyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxPQUFPLE1BQU0sQ0FBQztBQUNsQixDQUFDO0FBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBMEJHO0FBQ0gsU0FBZ0IsWUFBWSxDQUN4QixRQUFrQixFQUNsQixVQUF1QyxFQUFFO0lBRXpDLE9BQU8sWUFBWSxDQUFDLFFBQVEsRUFBRSxDQUFFLEdBQUcsT0FBTyxDQUFFLENBQUMsQ0FBQyxDQUFFLDZDQUE2QztBQUNqRyxDQUFDO0FBRUQ7Ozs7OztHQU1HO0FBQ0gsU0FBZ0Isc0JBQXNCLENBQ2xDLGNBQXdDLEVBQ3hDLGdCQUEwQyxFQUMxQyxTQUFrQjtJQUVsQixJQUFJLENBQUMsU0FBUyxJQUFJLGdCQUFnQixDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUM5QyxPQUFPLENBQUUsR0FBRyxjQUFjLEVBQUUsR0FBRyxnQkFBZ0IsQ0FBRSxDQUFDO0lBQ3RELENBQUM7SUFFRCxNQUFNLFFBQVEsR0FBRyxDQUFFLEdBQUcsY0FBYyxDQUFFLENBQUM7SUFDdkMsSUFBSSxTQUFTLEdBQUcsZ0JBQWdCLENBQUM7SUFFakMsb0VBQW9FO0lBQ3BFLElBQUksUUFBUSxDQUFDLE1BQU0sS0FBSyxDQUFDLElBQUksU0FBUyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUNoRCxRQUFRLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQzVCLFNBQVMsR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ25DLENBQUM7SUFFRCxJQUFJLFNBQVMsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDekIsT0FBTyxRQUFRLENBQUM7SUFDcEIsQ0FBQztJQUVELE1BQU0sWUFBWSxHQUFzQjtRQUNwQyxFQUFFLEVBQUUsY0FBYztRQUNsQixLQUFLLEVBQUUsTUFBTTtRQUNiLElBQUksRUFBRSxVQUFVO1FBQ2hCLEtBQUssRUFBRSxTQUFTO0tBQ25CLENBQUM7SUFFRixPQUFPLENBQUUsR0FBRyxRQUFRLEVBQUUsWUFBWSxDQUFFLENBQUM7QUFDekMsQ0FBQztBQUVEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBc0JHO0FBQ0gsU0FBZ0IsYUFBYSxDQUN6QixRQUFrQixFQUNsQixVQUF1QyxFQUFFO0lBRXpDLE9BQU8sWUFBWSxDQUFDLFFBQVEsRUFBRSxDQUFFLEdBQUcsT0FBTyxDQUFFLENBQUMsQ0FBQyxDQUFFLGtEQUFrRDtBQUN0RyxDQUFDO0FBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXdCRztBQUNILFNBQWdCLG9CQUFvQixDQUNoQyxjQUF3QixFQUN4QixpQkFZSyxFQUFFO0lBRVAsTUFBTSxXQUFXLEdBQUcsSUFBSSxHQUFHLENBQ3ZCLENBQUUsR0FBRyxjQUFjLENBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFFLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFFLENBQUMsQ0FDaEQsQ0FBQztJQUVGLG1FQUFtRTtJQUNuRSxjQUFjLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxFQUFFO1FBQzlCLElBQUksQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxRQUFRLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUN0RCx1QkFBYSxDQUFDLElBQUksQ0FBQyxtQkFBbUIsUUFBUSxDQUFDLElBQUksa0VBQWtFLENBQUMsQ0FBQztRQUMzSCxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCxPQUFPLGNBQWMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUU7UUFDN0IsTUFBTSxRQUFRLEdBQUcsV0FBVyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFFNUMsSUFBSSxDQUFDLFFBQVE7WUFBRSxPQUFPLElBQUksQ0FBQztRQUUzQixPQUFPO1lBQ0gsR0FBRyxJQUFJO1lBQ1AsR0FBRyxDQUFDLFFBQVEsQ0FBQyxVQUFVLEtBQUssU0FBUyxJQUFJLEVBQUUsVUFBVSxFQUFFLFFBQVEsQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUM3RSxHQUFHLENBQUMsUUFBUSxDQUFDLFVBQVUsS0FBSyxTQUFTLElBQUksRUFBRSxVQUFVLEVBQUUsUUFBUSxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQzdFLEdBQUcsQ0FBQyxRQUFRLENBQUMsUUFBUSxLQUFLLFNBQVMsSUFBSSxFQUFFLFFBQVEsRUFBRSxRQUFRLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDdkUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxXQUFXLEtBQUssU0FBUyxJQUFJLEVBQUUsV0FBVyxFQUFFLFFBQVEsQ0FBQyxXQUFXLEVBQUUsQ0FBQztTQUNuRixDQUFDO0lBQ04sQ0FBQyxDQUFDLENBQUM7QUFDUCxDQUFDO0FBd0REOzs7Ozs7R0FNRztBQUNILFNBQVMsd0JBQXdCLENBQzdCLGVBQThCO0lBRTlCLE9BQVEsZUFBdUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLEVBQUU7UUFDdEQsK0VBQStFO1FBQy9FLElBQUksT0FBTyxHQUFHLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDMUIsT0FBTztnQkFDSCxLQUFLLEVBQUUsR0FBRztnQkFDVixjQUFjLEVBQUUsSUFBSTthQUN2QixDQUFDO1FBQ04sQ0FBQztRQUNELGlGQUFpRjtRQUNqRixPQUFPO1lBQ0gsS0FBSyxFQUFFLEdBQUcsQ0FBQyxLQUFLO1lBQ2hCLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVTtZQUMxQixRQUFRLEVBQUUsR0FBRyxDQUFDLFFBQVE7WUFDdEIsS0FBSyxFQUFFLEdBQUcsQ0FBQyxLQUFLO1lBQ2hCLEtBQUssRUFBRSxHQUFHLENBQUMsS0FBSztZQUNoQixVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVU7WUFDMUIsY0FBYyxFQUFFLEdBQUcsQ0FBQyxjQUFjLEtBQUssS0FBSyxFQUFFLG1CQUFtQjtZQUNqRSxHQUFHLENBQUMsR0FBRyxDQUFDLFVBQVUsSUFBSSxFQUFFLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDckQsR0FBRyxDQUFDLEdBQUcsQ0FBQyxTQUFTLElBQUksRUFBRSxTQUFTLEVBQUUsR0FBRyxDQUFDLFNBQVMsRUFBRSxDQUFDO1lBQ2xELEdBQUcsQ0FBQyxHQUFHLENBQUMsT0FBTyxJQUFJLEVBQUUsT0FBTyxFQUFFLEdBQUcsQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUM1QyxHQUFHLENBQUMsR0FBRyxDQUFDLE9BQU8sSUFBSSxFQUFFLE9BQU8sRUFBRSxHQUFHLENBQUMsT0FBTyxFQUFFLENBQUM7U0FDL0MsQ0FBQztJQUNOLENBQUMsQ0FBQyxDQUFDO0FBQ1AsQ0FBQztBQUVEOzs7Ozs7Ozs7Ozs7O0dBYUc7QUFDSCxTQUFnQixxQkFBcUIsQ0FDakMsY0FBd0IsRUFDeEIsa0JBQWlDLEVBQUU7SUFFbkMsZ0ZBQWdGO0lBQ2hGLElBQUksQ0FBQyxlQUFlLElBQUksZUFBZSxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztRQUNuRCxPQUFPLGNBQWMsQ0FBQztJQUMxQixDQUFDO0lBRUQsdURBQXVEO0lBQ3ZELE1BQU0sbUJBQW1CLEdBQUcsd0JBQXdCLENBQUMsZUFBZSxDQUFDLENBQUM7SUFFdEUsTUFBTSxXQUFXLEdBQUcsSUFBSSxHQUFHLENBQ3ZCLG1CQUFtQixDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUUsQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLEdBQUcsQ0FBQyxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsQ0FBRSxDQUFDLENBQzlFLENBQUM7SUFFRixzREFBc0Q7SUFDdEQsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLEdBQUcsRUFBVSxDQUFDO0lBRTNDLGtEQUFrRDtJQUNsRCxNQUFNLGdCQUFnQixHQUFHLGNBQWMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUU7UUFDL0MsOEVBQThFO1FBQzlFLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxTQUFTLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQztRQUM5QyxNQUFNLFFBQVEsR0FBRyxXQUFXLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBRTVDLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNaLHdFQUF3RTtZQUN4RSxPQUFPO2dCQUNILEdBQUcsSUFBSTtnQkFDUCxjQUFjLEVBQUUsS0FBSztnQkFDckIsTUFBTSxFQUFFLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxpQkFBaUI7YUFDcEQsQ0FBQztRQUNOLENBQUM7UUFFRCxvREFBb0Q7UUFDcEQsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUNyQyxPQUFPO1lBQ0gsR0FBRyxJQUFJO1lBQ1AsR0FBRyxDQUFDLFFBQVEsQ0FBQyxVQUFVLEtBQUssU0FBUyxJQUFJLEVBQUUsVUFBVSxFQUFFLFFBQVEsQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUM3RSxHQUFHLENBQUMsUUFBUSxDQUFDLFFBQVEsS0FBSyxTQUFTLElBQUksRUFBRSxRQUFRLEVBQUUsUUFBUSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ3ZFLEdBQUcsQ0FBQyxRQUFRLENBQUMsS0FBSyxLQUFLLFNBQVMsSUFBSSxFQUFFLEtBQUssRUFBRSxRQUFRLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDOUQsR0FBRyxDQUFDLFFBQVEsQ0FBQyxLQUFLLEtBQUssU0FBUyxJQUFJLEVBQUUsS0FBSyxFQUFFLFFBQVEsQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUM5RCxHQUFHLENBQUMsUUFBUSxDQUFDLFVBQVUsS0FBSyxTQUFTLElBQUksRUFBRSxVQUFVLEVBQUUsUUFBUSxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQzdFLEdBQUcsQ0FBQyxRQUFRLENBQUMsVUFBVSxJQUFJLEVBQUUsVUFBVSxFQUFFLFFBQVEsQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUMvRCxHQUFHLENBQUMsUUFBUSxDQUFDLFNBQVMsSUFBSSxFQUFFLFNBQVMsRUFBRSxRQUFRLENBQUMsU0FBUyxFQUFFLENBQUM7WUFDNUQsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLElBQUksRUFBRSxPQUFPLEVBQUUsUUFBUSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ3RELEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxJQUFJLEVBQUUsT0FBTyxFQUFFLFFBQVEsQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUN0RCxjQUFjLEVBQUUsUUFBUSxDQUFDLGNBQWMsS0FBSyxLQUFLLEVBQUcsbUJBQW1CO1lBQ3ZFLE1BQU0sRUFBRSxRQUFRLENBQUMsTUFBTTtTQUMxQixDQUFDO0lBQ04sQ0FBQyxDQUFDLENBQUM7SUFFSCxtREFBbUQ7SUFDbkQsbUJBQW1CLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxFQUFFO1FBQ25DLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDeEMsd0RBQXdEO1lBQ3hELE1BQU0sVUFBVSxHQUFHLFFBQVEsQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBRWhELCtCQUErQjtZQUMvQixJQUFJLFVBQVUsRUFBRSxDQUFDO2dCQUNiLHVCQUFhLENBQUMsS0FBSyxDQUFDLDZCQUE2QixRQUFRLENBQUMsS0FBSyxHQUFHLENBQUMsQ0FBQztZQUN4RSxDQUFDO2lCQUFNLENBQUM7Z0JBQ0osdUJBQWEsQ0FBQyxLQUFLLENBQUMsMEJBQTBCLFFBQVEsQ0FBQyxLQUFLLDRDQUE0QyxDQUFDLENBQUM7WUFDOUcsQ0FBQztZQUVELDJCQUEyQjtZQUMzQixnQkFBZ0IsQ0FBQyxJQUFJLENBQUM7Z0JBQ2xCLElBQUksRUFBRSxRQUFRLENBQUMsS0FBSyxFQUFHLG9CQUFvQjtnQkFDM0MsU0FBUyxFQUFFLFFBQVEsQ0FBQyxLQUFLLEVBQUcscUNBQXFDO2dCQUNqRSxjQUFjLEVBQUUsUUFBUSxDQUFDLGNBQWM7Z0JBQ3ZDLFNBQVMsRUFBRSxNQUFNLEVBQUcscUNBQXFDO2dCQUN6RCxHQUFHLENBQUMsUUFBUSxDQUFDLFVBQVUsS0FBSyxTQUFTLElBQUksRUFBRSxVQUFVLEVBQUUsUUFBUSxDQUFDLFVBQVUsRUFBRSxDQUFDO2dCQUM3RSxHQUFHLENBQUMsUUFBUSxDQUFDLFFBQVEsS0FBSyxTQUFTLElBQUksRUFBRSxRQUFRLEVBQUUsUUFBUSxDQUFDLFFBQVEsRUFBRSxDQUFDO2dCQUN2RSxHQUFHLENBQUMsUUFBUSxDQUFDLEtBQUssS0FBSyxTQUFTLElBQUksRUFBRSxLQUFLLEVBQUUsUUFBUSxDQUFDLEtBQUssRUFBRSxDQUFDO2dCQUM5RCxHQUFHLENBQUMsUUFBUSxDQUFDLEtBQUssS0FBSyxTQUFTLElBQUksRUFBRSxLQUFLLEVBQUUsUUFBUSxDQUFDLEtBQUssRUFBRSxDQUFDO2dCQUM5RCxHQUFHLENBQUMsUUFBUSxDQUFDLFVBQVUsS0FBSyxTQUFTLElBQUksRUFBRSxVQUFVLEVBQUUsUUFBUSxDQUFDLFVBQVUsRUFBRSxDQUFDO2dCQUM3RSxHQUFHLENBQUMsUUFBUSxDQUFDLFVBQVUsSUFBSSxFQUFFLFVBQVUsRUFBRSxRQUFRLENBQUMsVUFBVSxFQUFFLENBQUM7Z0JBQy9ELEdBQUcsQ0FBQyxRQUFRLENBQUMsU0FBUyxJQUFJLEVBQUUsU0FBUyxFQUFFLFFBQVEsQ0FBQyxTQUFTLEVBQUUsQ0FBQztnQkFDNUQsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLElBQUksRUFBRSxPQUFPLEVBQUUsUUFBUSxDQUFDLE9BQU8sRUFBRSxDQUFDO2dCQUN0RCxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sSUFBSSxFQUFFLE9BQU8sRUFBRSxRQUFRLENBQUMsT0FBTyxFQUFFLENBQUM7Z0JBQ3RELE1BQU0sRUFBRSxRQUFRLENBQUMsTUFBTTthQUNuQixDQUFDLENBQUM7UUFDZCxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7SUFFSCwwRUFBMEU7SUFDMUUsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBTSxFQUFFLENBQU0sRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxJQUFJLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLE1BQU0sSUFBSSxNQUFNLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDO0lBRXpILG1DQUFtQztJQUNuQyxPQUFPLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsTUFBTSxFQUFFLEdBQUcsSUFBSSxFQUFPLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQ3BFLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQge1xuICAgIEJhc2VFbnRpdHlTZXJ2aWNlLFxuICAgIEZpZWxkTWV0YWRhdGEsXG4gICAgVElPU2NoZW1hQXR0cmlidXRlLFxuICAgIGlzU2VsZWN0RmllbGRNZXRhZGF0YSxcbiAgICBTZWxlY3RGaWVsZE1ldGFkYXRhLFxuICAgIEVudGl0eUF0dHJpYnV0ZSxcbiAgICBJUmVsYXRpb25GaWVsZENvbmZpZyxcbiAgICBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwLFxuICAgIEVudGl0eVNjaGVtYSxcbiAgICBJRmlsdGVyU2VnbWVudCxcbiAgICBjcmVhdGVGaWVsZE9wdGlvbnNcbn0gZnJvbSBcIi4uLy4uL2VudGl0eVwiO1xuaW1wb3J0IHR5cGUgeyBSZWxhdGlvbkVudGl0eU9wdGlvbkNvbmZpZywgRmllbGRPcHRpb25zQVBJQ29uZmlnLCBJRW50aXR5UGFnZUFjdGlvbiwgVGVtcGxhdGUsIEZpZWxkT3B0aW9uLCBJRmlsdGVyU2VnbWVudEdyb3VwLCBJVGFibGVDb2x1bW5zLCBJVGFibGVDb2x1bW4sIElUYWJsZUNvbHVtbkNvbmZpZyB9IGZyb20gJy4uLy4uL2VudGl0eS9iYXNlLWVudGl0eSc7XG5pbXBvcnQgeyBGcmFtZXdvcmtFcnJvciB9IGZyb20gXCIuLi8uLi9lcnJvcnNcIjtcbmltcG9ydCB0eXBlIHsgSUFwcGxpY2F0aW9uQ29uZmlnLCBJRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uQ29uZmlnLCBJU2VnbWVudEF1dG9HZW5lcmF0aW9uQ29uZmlnIH0gZnJvbSAnLi4vLi4vaW50ZXJmYWNlcy9jb25maWcnO1xuaW1wb3J0IHsgRGVmYXVsdExvZ2dlciB9IGZyb20gXCIuLi8uLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBwYXNjYWxDYXNlLCB0b0h1bWFuUmVhZGFibGVOYW1lIH0gZnJvbSBcIi4uLy4uL3V0aWxzXCI7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU01BUlQgRFVQTElDQVRFRCBGSUVMRCBERVRFQ1RJT04gLSBFTkhBTkNFRCBBTEdPUklUSE1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIERldGVjdGlvbiByZXN1bHQgd2l0aCByaWNoIG1ldGFkYXRhXG4gKi9cbmludGVyZmFjZSBEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25SZXN1bHQge1xuICAgIC8qKiBQcmltYXJ5IGRpc3BsYXkgZmllbGQgZGV0ZWN0ZWQgKGUuZy4sICd0ZWFtTmFtZScpICovXG4gICAgcHJpbWFyeUZpZWxkPzogc3RyaW5nO1xuXG4gICAgLyoqIEdlbmVyYXRlZCB0ZW1wbGF0ZSBzdHJpbmcgKGUuZy4sICd7dGVhbU5hbWV9JyBvciAne3RlYW1OYW1lfSAoe3RlYW1Db2RlfSknKSAqL1xuICAgIHRlbXBsYXRlPzogc3RyaW5nO1xuXG4gICAgLyoqIEFsbCBkZXRlY3RlZCBmaWVsZHMgYnkgY2F0ZWdvcnkgKi9cbiAgICBkZXRlY3RlZEZpZWxkczoge1xuICAgICAgICAvKiogRGlzcGxheSBmaWVsZHM6IE5hbWUsIFRpdGxlLCBMYWJlbCAqL1xuICAgICAgICBkaXNwbGF5Pzogc3RyaW5nW107XG4gICAgICAgIC8qKiBWaXN1YWwgZmllbGRzOiBMb2dvLCBJbWFnZSwgSWNvbiAqL1xuICAgICAgICB2aXN1YWw/OiBzdHJpbmdbXTtcbiAgICAgICAgLyoqIE1ldGEgZmllbGRzOiBDb2RlLCBTbHVnLCBLZXkgKi9cbiAgICAgICAgbWV0YT86IHN0cmluZ1tdO1xuICAgIH07XG5cbiAgICAvKiogQ29uZmlkZW5jZSBsZXZlbCAqL1xuICAgIGNvbmZpZGVuY2U6ICdoaWdoJyB8ICdtZWRpdW0nIHwgJ2xvdyc7XG5cbiAgICAvKiogRGV0ZWN0aW9uIG1ldGhvZCB1c2VkICovXG4gICAgbWV0aG9kOiBzdHJpbmc7XG5cbiAgICAvKiogUGF0dGVybiB0aGF0IG1hdGNoZWQgKi9cbiAgICBwYXR0ZXJuOiBzdHJpbmc7XG59XG5cbi8qKlxuICogUGFyc2VkIGNvbXBvbmVudHMgZnJvbSByZWxhdGlvbiBmaWVsZCBuYW1lXG4gKi9cbmludGVyZmFjZSBQYXJzZWRSZWxhdGlvbkZpZWxkIHtcbiAgICAvKiogUHJlZml4IChlLmcuLCAnaG9tZScsICdhd2F5JywgJ2NvbXBldGl0b3IxJykgKi9cbiAgICBwcmVmaXg/OiBzdHJpbmc7XG4gICAgLyoqIEJhc2UgbmFtZSB3aXRob3V0IHByZWZpeCBhbmQgJ0lkJyBzdWZmaXggKGUuZy4sICdUZWFtJykgKi9cbiAgICBiYXNlTmFtZTogc3RyaW5nO1xuICAgIC8qKiBXaGV0aGVyIGZpZWxkIGVuZHMgd2l0aCAnSWQnICovXG4gICAgaGFzSWRTdWZmaXg6IGJvb2xlYW47XG4gICAgLyoqIE9yaWdpbmFsIGZpZWxkIG5hbWUgKi9cbiAgICBvcmlnaW5hbEZpZWxkOiBzdHJpbmc7XG59XG5cbi8qKlxuICogU21hcnQgZGVmYXVsdCBjb25maWd1cmF0aW9uXG4gKi9cbi8qKlxuICogRnJhbWV3b3JrLWxldmVsIGRlZmF1bHQgZGV0ZWN0aW9uIGNvbmZpZy5cbiAqIENvbnRhaW5zIE9OTFkgZG9tYWluLWFnbm9zdGljIHBhdHRlcm5zIHRoYXQgd29yayBhY3Jvc3MgYW55IGFwcGxpY2F0aW9uLlxuICogXG4gKiBBcHBsaWNhdGlvbnMgc2hvdWxkIHByb3ZpZGUgZG9tYWluLXNwZWNpZmljIHByZWZpeGVzIHZpYSB1aUNvbmZpZ09wdGlvbnMuXG4gKiBcbiAqIEBleGFtcGxlIEFwcGxpY2F0aW9uLXNwZWNpZmljIGNvbmZpZyAoaW4gYmFja2VuZCBpbmRleC50cyk6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCB1aUNvbmZpZ09wdGlvbnMgPSB7XG4gKiAgIGR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbjoge1xuICogICAgIHByZWZpeGVzOiBbXG4gKiAgICAgICAvLyBEb21haW4tc3BlY2lmaWMgcHJlZml4ZXMgZm9yIHlvdXIgYXBwXG4gKiAgICAgICAncGxheWVyJywgJ3RlYW0nLCAnbGVhZ3VlJywgJ3NlYXNvbicsICd2ZW51ZScsICdzcG9ydCcsICAvLyBTcG9ydHMgYXBwXG4gKiAgICAgICAvLyBPUjogJ2N1c3RvbWVyJywgJ29yZGVyJywgJ3Byb2R1Y3QnLCAnaW52b2ljZScgIC8vIEUtY29tbWVyY2UgYXBwXG4gKiAgICAgICAvLyBPUjogJ2F1dGhvcicsICdib29rJywgJ3B1Ymxpc2hlcicsICdnZW5yZScgIC8vIExpYnJhcnkgYXBwXG4gKiAgICAgXVxuICogICB9XG4gKiB9O1xuICogYGBgXG4gKi9cbmNvbnN0IERFRkFVTFRfREVURUNUSU9OX0NPTkZJRzogUmVxdWlyZWQ8SUR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbkNvbmZpZz4gPSB7XG4gICAgZW5hYmxlZDogdHJ1ZSxcbiAgICBzdWZmaXhlczoge1xuICAgICAgICAvLyBHZW5lcmljIGRpc3BsYXkgdGV4dCBwYXR0ZXJucyAodW5pdmVyc2FsKVxuICAgICAgICBkaXNwbGF5OiBbICdOYW1lJywgJ1RpdGxlJywgJ0xhYmVsJywgJ0Rpc3BsYXlOYW1lJyBdLFxuICAgICAgICAvLyBHZW5lcmljIHZpc3VhbCBhc3NldCBwYXR0ZXJucyAodW5pdmVyc2FsKVxuICAgICAgICB2aXN1YWw6IFsgJ0xvZ28nLCAnSW1hZ2UnLCAnSWNvbicsICdBdmF0YXInLCAnUGljdHVyZScgXSxcbiAgICAgICAgLy8gR2VuZXJpYyBtZXRhZGF0YSBwYXR0ZXJucyAodW5pdmVyc2FsKVxuICAgICAgICBtZXRhOiBbICdDb2RlJywgJ1NsdWcnLCAnS2V5JywgJ0lkZW50aWZpZXInLCAnUmVtb3RlSWQnIF1cbiAgICB9LFxuICAgIHByZWZpeGVzOiBbXG4gICAgICAgIC8vIEdlbmVyaWMgcmVsYXRpb25hbCBwYXR0ZXJucyAodW5pdmVyc2FsKVxuICAgICAgICAncGFyZW50JywgJ2NoaWxkJyxcbiAgICAgICAgJ3NvdXJjZScsICd0YXJnZXQnLCAnZGVzdGluYXRpb24nLFxuICAgICAgICAncHJpbWFyeScsICdzZWNvbmRhcnknLCAndGVydGlhcnknLFxuICAgICAgICAnbWFpbicsICdhbHRlcm5hdGUnLCAnZmFsbGJhY2snLFxuICAgICAgICAnb3duZXInLCAnY3JlYXRvcicsICdtb2RpZmllcicsXG4gICAgICAgICdmaXJzdCcsICdzZWNvbmQnLCAndGhpcmQnLCAnbGFzdCcsXG4gICAgICAgICdwcmV2aW91cycsICduZXh0JywgJ2N1cnJlbnQnLFxuICAgICAgICAnb2xkJywgJ25ldycsXG4gICAgICAgICdvcmlnaW5hbCcsICdjb3B5JywgJ2RyYWZ0JyxcblxuICAgICAgICAvLyBHZW5lcmljIGRpcmVjdGlvbmFsIHBhdHRlcm5zICh1bml2ZXJzYWwpXG4gICAgICAgICdob21lJywgJ2F3YXknLFxuICAgICAgICAnbGVmdCcsICdyaWdodCcsXG4gICAgICAgICd0b3AnLCAnYm90dG9tJyxcbiAgICAgICAgJ2lubmVyJywgJ291dGVyJyxcblxuICAgICAgICAvLyBHZW5lcmljIGNvbXBldGl0aXZlIHBhdHRlcm5zICh1bml2ZXJzYWwpXG4gICAgICAgICd3aW5uZXInLCAnbG9zZXInLFxuICAgICAgICAnY29tcGV0aXRvcicsICdvcHBvbmVudCdcblxuICAgICAgICAvLyBOT1RFOiBEb21haW4tc3BlY2lmaWMgcHJlZml4ZXMgKHBsYXllciwgdGVhbSwgY3VzdG9tZXIsIG9yZGVyLCBldGMuKVxuICAgICAgICAvLyBzaG91bGQgYmUgcHJvdmlkZWQgdmlhIHVpQ29uZmlnT3B0aW9ucyBpbiB5b3VyIGFwcGxpY2F0aW9uJ3MgYmFja2VuZFxuICAgIF0sXG4gICAgdGVtcGxhdGVTdHlsZTogJ3NpbXBsZScsXG4gICAgY29uZmlkZW5jZVRocmVzaG9sZDogJ21lZGl1bScsXG4gICAgZGVidWc6IGZhbHNlXG59O1xuXG4vKipcbiAqIE1lcmdlIGNvbmZpZ3VyYXRpb25zIHdpdGggcHJpb3JpdHk6IGhpbnRzID4gZW50aXR5ID4gZ2xvYmFsID4gZGVmYXVsdHNcbiAqL1xuZnVuY3Rpb24gbWVyZ2VEZXRlY3Rpb25Db25maWdzKFxuICAgIGdsb2JhbENvbmZpZz86IElEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25Db25maWcsXG4gICAgZW50aXR5Q29uZmlnPzogSUR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbkNvbmZpZyxcbiAgICByZWxhdGlvbkhpbnRzPzoge1xuICAgICAgICBwcmVmZXJyZWRGaWVsZHM/OiBzdHJpbmdbXTtcbiAgICAgICAgZXhjbHVkZUZpZWxkcz86IHN0cmluZ1tdO1xuICAgICAgICB0ZW1wbGF0ZVN0eWxlPzogJ3NpbXBsZScgfCAnY29tcG9zaXRlJztcbiAgICB9XG4pOiBSZXF1aXJlZDxJRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uQ29uZmlnPiAmIHsgcHJlZmVycmVkRmllbGRzPzogc3RyaW5nW107IGV4Y2x1ZGVGaWVsZHM/OiBzdHJpbmdbXSB9IHtcbiAgICAvLyBTdGFydCB3aXRoIGRlZmF1bHRzXG4gICAgbGV0IG1lcmdlZCA9IHsgLi4uREVGQVVMVF9ERVRFQ1RJT05fQ09ORklHIH07XG5cbiAgICAvLyBBcHBseSBnbG9iYWwgY29uZmlnXG4gICAgaWYgKGdsb2JhbENvbmZpZykge1xuICAgICAgICBtZXJnZWQgPSB7XG4gICAgICAgICAgICAuLi5tZXJnZWQsXG4gICAgICAgICAgICAuLi5nbG9iYWxDb25maWcsXG4gICAgICAgICAgICBzdWZmaXhlczogeyAuLi5tZXJnZWQuc3VmZml4ZXMsIC4uLmdsb2JhbENvbmZpZy5zdWZmaXhlcyB9LFxuICAgICAgICAgICAgcHJlZml4ZXM6IGdsb2JhbENvbmZpZy5wcmVmaXhlcyB8fCBtZXJnZWQucHJlZml4ZXNcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBBcHBseSBlbnRpdHkgY29uZmlnIChoaWdoZXIgcHJpb3JpdHkpXG4gICAgaWYgKGVudGl0eUNvbmZpZykge1xuICAgICAgICBtZXJnZWQgPSB7XG4gICAgICAgICAgICAuLi5tZXJnZWQsXG4gICAgICAgICAgICAuLi5lbnRpdHlDb25maWcsXG4gICAgICAgICAgICBzdWZmaXhlczogeyAuLi5tZXJnZWQuc3VmZml4ZXMsIC4uLmVudGl0eUNvbmZpZy5zdWZmaXhlcyB9LFxuICAgICAgICAgICAgcHJlZml4ZXM6IGVudGl0eUNvbmZpZy5wcmVmaXhlcyB8fCBtZXJnZWQucHJlZml4ZXNcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBBcHBseSByZWxhdGlvbiBoaW50cyAoaGlnaGVzdCBwcmlvcml0eSlcbiAgICBjb25zdCByZXN1bHQ6IGFueSA9IHsgLi4ubWVyZ2VkIH07XG4gICAgaWYgKHJlbGF0aW9uSGludHMpIHtcbiAgICAgICAgaWYgKHJlbGF0aW9uSGludHMudGVtcGxhdGVTdHlsZSkge1xuICAgICAgICAgICAgcmVzdWx0LnRlbXBsYXRlU3R5bGUgPSByZWxhdGlvbkhpbnRzLnRlbXBsYXRlU3R5bGU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlbGF0aW9uSGludHMucHJlZmVycmVkRmllbGRzKSB7XG4gICAgICAgICAgICByZXN1bHQucHJlZmVycmVkRmllbGRzID0gcmVsYXRpb25IaW50cy5wcmVmZXJyZWRGaWVsZHM7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlbGF0aW9uSGludHMuZXhjbHVkZUZpZWxkcykge1xuICAgICAgICAgICAgcmVzdWx0LmV4Y2x1ZGVGaWVsZHMgPSByZWxhdGlvbkhpbnRzLmV4Y2x1ZGVGaWVsZHM7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG4vKipcbiAqIFBhcnNlIHJlbGF0aW9uIGZpZWxkIHRvIGV4dHJhY3QgcHJlZml4IGFuZCBiYXNlIG5hbWUuXG4gKiBcbiAqIEV4YW1wbGVzOlxuICogLSAndGVhbUlkJyDihpIgeyBiYXNlTmFtZTogJ1RlYW0nLCBoYXNJZFN1ZmZpeDogdHJ1ZSB9XG4gKiAtICdob21lVGVhbUlkJyDihpIgeyBwcmVmaXg6ICdob21lJywgYmFzZU5hbWU6ICdUZWFtJywgaGFzSWRTdWZmaXg6IHRydWUgfVxuICogLSAnY29tcGV0aXRvcjFUZWFtSWQnIOKGkiB7IHByZWZpeDogJ2NvbXBldGl0b3IxJywgYmFzZU5hbWU6ICdUZWFtJywgaGFzSWRTdWZmaXg6IHRydWUgfVxuICogLSAnc3BvcnQnIOKGkiB7IGJhc2VOYW1lOiAnc3BvcnQnLCBoYXNJZFN1ZmZpeDogZmFsc2UgfVxuICovXG5mdW5jdGlvbiBwYXJzZVJlbGF0aW9uRmllbGQoXG4gICAgZmllbGRJZDogc3RyaW5nLFxuICAgIHByZWZpeGVzOiBzdHJpbmdbXVxuKTogUGFyc2VkUmVsYXRpb25GaWVsZCB7XG4gICAgLy8gQnVpbGQgcmVnZXggZm9yIHByZWZpeCBkZXRlY3Rpb246IF4ocHJlZml4MXxwcmVmaXgyfC4uLikoXFxcXGQqKSguKykkXG4gICAgLy8gVXNlIGNhc2UtaW5zZW5zaXRpdmUgbWF0Y2hpbmdcbiAgICBjb25zdCBwcmVmaXhQYXR0ZXJuID0gbmV3IFJlZ0V4cChcbiAgICAgICAgYF4oJHtwcmVmaXhlcy5qb2luKCd8Jyl9KShcXFxcZCopKC4rKSRgLFxuICAgICAgICAnaSdcbiAgICApO1xuXG4gICAgY29uc3QgbWF0Y2ggPSBmaWVsZElkLm1hdGNoKHByZWZpeFBhdHRlcm4pO1xuXG4gICAgaWYgKG1hdGNoKSB7XG4gICAgICAgIGNvbnN0IFsgLCBwcmVmaXgsIG51bSwgcmVzdCBdID0gbWF0Y2g7XG4gICAgICAgIGNvbnN0IGhhc0lkU3VmZml4ID0gcmVzdC50b0xvd2VyQ2FzZSgpLmVuZHNXaXRoKCdpZCcpO1xuICAgICAgICBjb25zdCBiYXNlTmFtZSA9IGhhc0lkU3VmZml4XG4gICAgICAgICAgICA/IHJlc3Quc3Vic3RyaW5nKDAsIHJlc3QubGVuZ3RoIC0gMilcbiAgICAgICAgICAgIDogcmVzdDtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgcHJlZml4OiBwcmVmaXggKyBudW0sICAvLyAnaG9tZScgb3IgJ2NvbXBldGl0b3IxJ1xuICAgICAgICAgICAgYmFzZU5hbWUsXG4gICAgICAgICAgICBoYXNJZFN1ZmZpeCxcbiAgICAgICAgICAgIG9yaWdpbmFsRmllbGQ6IGZpZWxkSWRcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBObyBwcmVmaXggZGV0ZWN0ZWRcbiAgICBjb25zdCBoYXNJZFN1ZmZpeCA9IGZpZWxkSWQudG9Mb3dlckNhc2UoKS5lbmRzV2l0aCgnaWQnKTtcbiAgICBjb25zdCBiYXNlTmFtZSA9IGhhc0lkU3VmZml4XG4gICAgICAgID8gZmllbGRJZC5zdWJzdHJpbmcoMCwgZmllbGRJZC5sZW5ndGggLSAyKVxuICAgICAgICA6IGZpZWxkSWQ7XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBiYXNlTmFtZSxcbiAgICAgICAgaGFzSWRTdWZmaXgsXG4gICAgICAgIG9yaWdpbmFsRmllbGQ6IGZpZWxkSWRcbiAgICB9O1xufVxuXG4vKipcbiAqIEdlbmVyYXRlIHNlYXJjaCBwYXR0ZXJucyBmb3IgY2FuZGlkYXRlIGZpZWxkIG5hbWVzLlxuICogXG4gKiBQcmlvcml0eTpcbiAqIDEuIFByZWZlcnJlZCBmaWVsZHMgKGZyb20gaGludHMpXG4gKiAyLiBFeGFjdCBwcmVmaXggbWF0Y2g6IHtwcmVmaXh9e2Jhc2VOYW1lfXtzdWZmaXh9XG4gKiAzLiBFbnRpdHkgbmFtZSBtYXRjaDoge2VudGl0eU5hbWV9e3N1ZmZpeH1cbiAqIDQuIEJhc2UgbmFtZSBtYXRjaDoge2Jhc2VOYW1lfXtzdWZmaXh9XG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlU2VhcmNoUGF0dGVybnMoXG4gICAgcGFyc2VkOiBQYXJzZWRSZWxhdGlvbkZpZWxkLFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBzdWZmaXhlczogc3RyaW5nW10sXG4gICAgcHJlZmVycmVkRmllbGRzPzogc3RyaW5nW11cbik6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBwYXR0ZXJuczogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCBlbnRpdHlOYW1lTG93ZXIgPSBlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgYmFzZU5hbWVMb3dlciA9IHBhcnNlZC5iYXNlTmFtZS50b0xvd2VyQ2FzZSgpO1xuXG4gICAgLy8gUHJpb3JpdHkgMTogUHJlZmVycmVkIGZpZWxkcyAoZXhhY3QgbWF0Y2gpXG4gICAgaWYgKHByZWZlcnJlZEZpZWxkcyAmJiBwcmVmZXJyZWRGaWVsZHMubGVuZ3RoID4gMCkge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKC4uLnByZWZlcnJlZEZpZWxkcyk7XG4gICAgfVxuXG4gICAgLy8gUHJpb3JpdHkgMjogV2l0aCBwcmVmaXggKGUuZy4sIGhvbWVUZWFtTmFtZSwgYXdheVRlYW1OYW1lKVxuICAgIGlmIChwYXJzZWQucHJlZml4KSB7XG4gICAgICAgIGNvbnN0IHByZWZpeExvd2VyID0gcGFyc2VkLnByZWZpeC50b0xvd2VyQ2FzZSgpO1xuICAgICAgICBmb3IgKGNvbnN0IHN1ZmZpeCBvZiBzdWZmaXhlcykge1xuICAgICAgICAgICAgcGF0dGVybnMucHVzaChgJHtwcmVmaXhMb3dlcn0ke2Jhc2VOYW1lTG93ZXJ9JHtzdWZmaXgudG9Mb3dlckNhc2UoKX1gKTtcbiAgICAgICAgICAgIHBhdHRlcm5zLnB1c2goYCR7cHJlZml4TG93ZXJ9JHtlbnRpdHlOYW1lTG93ZXJ9JHtzdWZmaXgudG9Mb3dlckNhc2UoKX1gKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFByaW9yaXR5IDM6IEVudGl0eSBuYW1lIChlLmcuLCB0ZWFtTmFtZSBmb3IgcmVsYXRpb24gdG8gJ3RlYW0nKVxuICAgIGZvciAoY29uc3Qgc3VmZml4IG9mIHN1ZmZpeGVzKSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYCR7ZW50aXR5TmFtZUxvd2VyfSR7c3VmZml4LnRvTG93ZXJDYXNlKCl9YCk7XG4gICAgfVxuXG4gICAgLy8gUHJpb3JpdHkgNDogQmFzZSBuYW1lIChlLmcuLCB0ZWFtTmFtZSBmb3IgJ3RlYW1JZCcpXG4gICAgZm9yIChjb25zdCBzdWZmaXggb2Ygc3VmZml4ZXMpIHtcbiAgICAgICAgcGF0dGVybnMucHVzaChgJHtiYXNlTmFtZUxvd2VyfSR7c3VmZml4LnRvTG93ZXJDYXNlKCl9YCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHBhdHRlcm5zO1xufVxuXG4vKipcbiAqIFNlYXJjaCBmb3IgZmllbGRzIG1hdGNoaW5nIHBhdHRlcm5zLCBleGNsdWRpbmcgc3BlY2lmaWVkIGZpZWxkcy5cbiAqL1xuZnVuY3Rpb24gc2VhcmNoRmllbGRzQnlQYXR0ZXJucyhcbiAgICBhbGxQcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSxcbiAgICBwYXR0ZXJuczogc3RyaW5nW10sXG4gICAgZXhjbHVkZUZpZWxkcz86IHN0cmluZ1tdXG4pOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgZXhjbHVkZVNldCA9IG5ldyBTZXQoZXhjbHVkZUZpZWxkcz8ubWFwKGYgPT4gZi50b0xvd2VyQ2FzZSgpKSB8fCBbXSk7XG4gICAgY29uc3QgZm91bmQ6IHN0cmluZ1tdID0gW107XG4gICAgY29uc3Qgc2Vlbkxvd2VyID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICBmb3IgKGNvbnN0IHBhdHRlcm4gb2YgcGF0dGVybnMpIHtcbiAgICAgICAgY29uc3QgcGF0dGVybkxvd2VyID0gcGF0dGVybi50b0xvd2VyQ2FzZSgpO1xuXG4gICAgICAgIC8vIFNraXAgaWYgYWxyZWFkeSBmb3VuZCBvciBleGNsdWRlZFxuICAgICAgICBpZiAoc2Vlbkxvd2VyLmhhcyhwYXR0ZXJuTG93ZXIpIHx8IGV4Y2x1ZGVTZXQuaGFzKHBhdHRlcm5Mb3dlcikpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRmluZCBtYXRjaGluZyBmaWVsZCAoY2FzZS1pbnNlbnNpdGl2ZSlcbiAgICAgICAgY29uc3QgbWF0Y2ggPSBhbGxQcm9wZXJ0aWVzLmZpbmQocCA9PlxuICAgICAgICAgICAgcC5pZD8udG9Mb3dlckNhc2UoKSA9PT0gcGF0dGVybkxvd2VyICYmXG4gICAgICAgICAgICAhZXhjbHVkZVNldC5oYXMocC5pZC50b0xvd2VyQ2FzZSgpKVxuICAgICAgICApO1xuXG4gICAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICAgICAgZm91bmQucHVzaChtYXRjaC5pZCk7XG4gICAgICAgICAgICBzZWVuTG93ZXIuYWRkKG1hdGNoLmlkLnRvTG93ZXJDYXNlKCkpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZvdW5kO1xufVxuXG4vKipcbiAqIENhbGN1bGF0ZSBjb25maWRlbmNlIGJhc2VkIG9uIGRldGVjdGlvbiBtZXRob2QgYW5kIHBhdHRlcm5cbiAqL1xuZnVuY3Rpb24gY2FsY3VsYXRlQ29uZmlkZW5jZShcbiAgICBkZXRlY3RlZEZpZWxkOiBzdHJpbmcsXG4gICAgcGFyc2VkOiBQYXJzZWRSZWxhdGlvbkZpZWxkLFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBtZXRob2Q6ICdwcmVmZXJyZWQnIHwgJ3ByZWZpeCcgfCAnZW50aXR5JyB8ICdiYXNlJ1xuKTogJ2hpZ2gnIHwgJ21lZGl1bScgfCAnbG93JyB7XG4gICAgLy8gUHJlZmVycmVkIGZpZWxkcyA9IGhpZ2ggY29uZmlkZW5jZSAoZGV2ZWxvcGVyIGV4cGxpY2l0bHkgc3BlY2lmaWVkKVxuICAgIGlmIChtZXRob2QgPT09ICdwcmVmZXJyZWQnKSByZXR1cm4gJ2hpZ2gnO1xuXG4gICAgY29uc3QgZmllbGRMb3dlciA9IGRldGVjdGVkRmllbGQudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBlbnRpdHlMb3dlciA9IGVudGl0eU5hbWUudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBiYXNlTG93ZXIgPSBwYXJzZWQuYmFzZU5hbWUudG9Mb3dlckNhc2UoKTtcblxuICAgIC8vIEV4YWN0IHByZWZpeCArIGVudGl0eS9iYXNlIG1hdGNoID0gaGlnaFxuICAgIGlmIChtZXRob2QgPT09ICdwcmVmaXgnKSB7XG4gICAgICAgIGlmIChmaWVsZExvd2VyLmluY2x1ZGVzKGVudGl0eUxvd2VyKSB8fCBmaWVsZExvd2VyLmluY2x1ZGVzKGJhc2VMb3dlcikpIHtcbiAgICAgICAgICAgIHJldHVybiAnaGlnaCc7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICdtZWRpdW0nO1xuICAgIH1cblxuICAgIC8vIEVudGl0eSBuYW1lIG1hdGNoID0gaGlnaFxuICAgIGlmIChtZXRob2QgPT09ICdlbnRpdHknKSByZXR1cm4gJ2hpZ2gnO1xuXG4gICAgLy8gQmFzZSBuYW1lIG1hdGNoID0gbWVkaXVtIChjb3VsZCBiZSBjb2luY2lkZW50YWwpXG4gICAgaWYgKG1ldGhvZCA9PT0gJ2Jhc2UnKSByZXR1cm4gJ21lZGl1bSc7XG5cbiAgICByZXR1cm4gJ2xvdyc7XG59XG5cbi8qKlxuICogR2VuZXJhdGUgdGVtcGxhdGUgc3RyaW5nIGZyb20gZGV0ZWN0ZWQgZmllbGRzLlxuICovXG5mdW5jdGlvbiBnZW5lcmF0ZVRlbXBsYXRlKFxuICAgIHByaW1hcnlGaWVsZDogc3RyaW5nLFxuICAgIGFsbERldGVjdGVkRmllbGRzOiBEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25SZXN1bHRbICdkZXRlY3RlZEZpZWxkcycgXSxcbiAgICB0ZW1wbGF0ZVN0eWxlOiAnc2ltcGxlJyB8ICdjb21wb3NpdGUnXG4pOiBzdHJpbmcge1xuICAgIGlmICh0ZW1wbGF0ZVN0eWxlID09PSAnc2ltcGxlJykge1xuICAgICAgICByZXR1cm4gYHske3ByaW1hcnlGaWVsZH19YDtcbiAgICB9XG5cbiAgICAvLyBDb21wb3NpdGU6IHRyeSB0byBpbmNsdWRlIG1ldGEgZmllbGQgKGNvZGUvc2x1ZykgaWYgYXZhaWxhYmxlXG4gICAgaWYgKHRlbXBsYXRlU3R5bGUgPT09ICdjb21wb3NpdGUnICYmIGFsbERldGVjdGVkRmllbGRzLm1ldGEgJiYgYWxsRGV0ZWN0ZWRGaWVsZHMubWV0YS5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IG1ldGFGaWVsZCA9IGFsbERldGVjdGVkRmllbGRzLm1ldGFbIDAgXTtcbiAgICAgICAgcmV0dXJuIGB7JHtwcmltYXJ5RmllbGR9fSAoeyR7bWV0YUZpZWxkfX0pYDtcbiAgICB9XG5cbiAgICAvLyBGYWxsYmFjayB0byBzaW1wbGUgaWYgbm8gbWV0YSBmaWVsZFxuICAgIHJldHVybiBgeyR7cHJpbWFyeUZpZWxkfX1gO1xufVxuXG4vKipcbiAqIEVuaGFuY2VkIHNtYXJ0IGR1cGxpY2F0ZWQgZmllbGQgZGV0ZWN0aW9uLlxuICogXG4gKiBEZXRlY3RzIGZpZWxkcyBsaWtlICd0ZWFtTmFtZScgZm9yICd0ZWFtSWQnIHJlbGF0aW9ucyB3aXRoIHN1cHBvcnQgZm9yOlxuICogLSBQcmVmaXhlcyAoaG9tZSwgYXdheSwgY29tcGV0aXRvcjEsIGV0Yy4pXG4gKiAtIE11bHRpcGxlIHN1ZmZpeGVzIChOYW1lLCBUaXRsZSwgTGFiZWwsIExvZ28sIENvZGUsIGV0Yy4pXG4gKiAtIFByZWZlcnJlZCBmaWVsZHMgYW5kIGV4Y2x1c2lvbnNcbiAqIC0gQ29uZmlkZW5jZSBzY29yaW5nXG4gKiAtIENvbXBvc2l0ZSB0ZW1wbGF0ZXNcbiAqIFxuICogQHBhcmFtIGFsbFByb3BlcnRpZXMgLSBBbGwgcHJvcGVydGllcyBpbiB0aGUgcGFyZW50IGVudGl0eVxuICogQHBhcmFtIHJlbGF0aW9uRmllbGRJZCAtIFRoZSByZWxhdGlvbiBmaWVsZCBuYW1lIChlLmcuLCAndGVhbUlkJywgJ2hvbWVUZWFtSWQnKVxuICogQHBhcmFtIHJlbGF0ZWRFbnRpdHlOYW1lIC0gUmVsYXRlZCBlbnRpdHkgbmFtZSAoZS5nLiwgJ3RlYW0nKVxuICogQHBhcmFtIGdsb2JhbENvbmZpZyAtIEdsb2JhbCBkZXRlY3Rpb24gY29uZmlndXJhdGlvblxuICogQHBhcmFtIGVudGl0eUNvbmZpZyAtIEVudGl0eS1sZXZlbCBkZXRlY3Rpb24gY29uZmlndXJhdGlvblxuICogQHBhcmFtIHJlbGF0aW9uSGludHMgLSBSZWxhdGlvbi1zcGVjaWZpYyBoaW50c1xuICogQHJldHVybnMgRGV0ZWN0aW9uIHJlc3VsdCB3aXRoIHRlbXBsYXRlIGFuZCBtZXRhZGF0YVxuICovXG5mdW5jdGlvbiBkZXRlY3REdXBsaWNhdGVkUmVsYXRpb25GaWVsZHMoXG4gICAgYWxsUHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sXG4gICAgcmVsYXRpb25GaWVsZElkOiBzdHJpbmcsXG4gICAgcmVsYXRlZEVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBnbG9iYWxDb25maWc/OiBJRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uQ29uZmlnLFxuICAgIGVudGl0eUNvbmZpZz86IElEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25Db25maWcsXG4gICAgcmVsYXRpb25IaW50cz86IHtcbiAgICAgICAgcHJlZmVycmVkRmllbGRzPzogc3RyaW5nW107XG4gICAgICAgIGV4Y2x1ZGVGaWVsZHM/OiBzdHJpbmdbXTtcbiAgICAgICAgdGVtcGxhdGVTdHlsZT86ICdzaW1wbGUnIHwgJ2NvbXBvc2l0ZSc7XG4gICAgfVxuKTogRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uUmVzdWx0IHwgdW5kZWZpbmVkIHtcbiAgICAvLyBNZXJnZSBjb25maWd1cmF0aW9uc1xuICAgIGNvbnN0IGNvbmZpZyA9IG1lcmdlRGV0ZWN0aW9uQ29uZmlncyhnbG9iYWxDb25maWcsIGVudGl0eUNvbmZpZywgcmVsYXRpb25IaW50cyk7XG5cbiAgICAvLyBDaGVjayBpZiBkZXRlY3Rpb24gaXMgZW5hYmxlZFxuICAgIGlmICghY29uZmlnLmVuYWJsZWQpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyBQYXJzZSByZWxhdGlvbiBmaWVsZFxuICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlUmVsYXRpb25GaWVsZChyZWxhdGlvbkZpZWxkSWQsIGNvbmZpZy5wcmVmaXhlcyk7XG5cbiAgICAvLyBTZWFyY2ggZm9yIGRpc3BsYXkgZmllbGRzIChOYW1lLCBUaXRsZSwgTGFiZWwpXG4gICAgY29uc3QgZGlzcGxheVBhdHRlcm5zID0gZ2VuZXJhdGVTZWFyY2hQYXR0ZXJucyhcbiAgICAgICAgcGFyc2VkLFxuICAgICAgICByZWxhdGVkRW50aXR5TmFtZSxcbiAgICAgICAgY29uZmlnLnN1ZmZpeGVzPy5kaXNwbGF5IHx8IFtdLFxuICAgICAgICBjb25maWcucHJlZmVycmVkRmllbGRzXG4gICAgKTtcbiAgICBjb25zdCBkaXNwbGF5RmllbGRzID0gc2VhcmNoRmllbGRzQnlQYXR0ZXJucyhhbGxQcm9wZXJ0aWVzLCBkaXNwbGF5UGF0dGVybnMsIGNvbmZpZy5leGNsdWRlRmllbGRzKTtcblxuICAgIC8vIFNlYXJjaCBmb3IgdmlzdWFsIGZpZWxkcyAoTG9nbywgSW1hZ2UsIEljb24pXG4gICAgY29uc3QgdmlzdWFsUGF0dGVybnMgPSBnZW5lcmF0ZVNlYXJjaFBhdHRlcm5zKFxuICAgICAgICBwYXJzZWQsXG4gICAgICAgIHJlbGF0ZWRFbnRpdHlOYW1lLFxuICAgICAgICBjb25maWcuc3VmZml4ZXM/LnZpc3VhbCB8fCBbXVxuICAgICk7XG4gICAgY29uc3QgdmlzdWFsRmllbGRzID0gc2VhcmNoRmllbGRzQnlQYXR0ZXJucyhhbGxQcm9wZXJ0aWVzLCB2aXN1YWxQYXR0ZXJucywgY29uZmlnLmV4Y2x1ZGVGaWVsZHMpO1xuXG4gICAgLy8gU2VhcmNoIGZvciBtZXRhIGZpZWxkcyAoQ29kZSwgU2x1ZywgS2V5KVxuICAgIGNvbnN0IG1ldGFQYXR0ZXJucyA9IGdlbmVyYXRlU2VhcmNoUGF0dGVybnMoXG4gICAgICAgIHBhcnNlZCxcbiAgICAgICAgcmVsYXRlZEVudGl0eU5hbWUsXG4gICAgICAgIGNvbmZpZy5zdWZmaXhlcz8ubWV0YSB8fCBbXVxuICAgICk7XG4gICAgY29uc3QgbWV0YUZpZWxkcyA9IHNlYXJjaEZpZWxkc0J5UGF0dGVybnMoYWxsUHJvcGVydGllcywgbWV0YVBhdHRlcm5zLCBjb25maWcuZXhjbHVkZUZpZWxkcyk7XG5cbiAgICAvLyBObyBmaWVsZHMgZGV0ZWN0ZWRcbiAgICBpZiAoZGlzcGxheUZpZWxkcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyBEZXRlcm1pbmUgZGV0ZWN0aW9uIG1ldGhvZFxuICAgIGNvbnN0IHByaW1hcnlGaWVsZCA9IGRpc3BsYXlGaWVsZHNbIDAgXTtcbiAgICBsZXQgbWV0aG9kOiAncHJlZmVycmVkJyB8ICdwcmVmaXgnIHwgJ2VudGl0eScgfCAnYmFzZScgPSAnYmFzZSc7XG4gICAgbGV0IHBhdHRlcm4gPSAndW5rbm93bic7XG5cbiAgICBpZiAoY29uZmlnLnByZWZlcnJlZEZpZWxkcyAmJiBjb25maWcucHJlZmVycmVkRmllbGRzLmluY2x1ZGVzKHByaW1hcnlGaWVsZCkpIHtcbiAgICAgICAgbWV0aG9kID0gJ3ByZWZlcnJlZCc7XG4gICAgICAgIHBhdHRlcm4gPSAncHJlZmVycmVkX2ZpZWxkJztcbiAgICB9IGVsc2UgaWYgKHBhcnNlZC5wcmVmaXggJiYgcHJpbWFyeUZpZWxkLnRvTG93ZXJDYXNlKCkuc3RhcnRzV2l0aChwYXJzZWQucHJlZml4LnRvTG93ZXJDYXNlKCkpKSB7XG4gICAgICAgIG1ldGhvZCA9ICdwcmVmaXgnO1xuICAgICAgICBwYXR0ZXJuID0gYCR7cGFyc2VkLnByZWZpeH17ZW50aXR5fXtzdWZmaXh9YDtcbiAgICB9IGVsc2UgaWYgKHByaW1hcnlGaWVsZC50b0xvd2VyQ2FzZSgpLnN0YXJ0c1dpdGgocmVsYXRlZEVudGl0eU5hbWUudG9Mb3dlckNhc2UoKSkpIHtcbiAgICAgICAgbWV0aG9kID0gJ2VudGl0eSc7XG4gICAgICAgIHBhdHRlcm4gPSBge2VudGl0eX17c3VmZml4fWA7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgbWV0aG9kID0gJ2Jhc2UnO1xuICAgICAgICBwYXR0ZXJuID0gYHtiYXNlfXtzdWZmaXh9YDtcbiAgICB9XG5cbiAgICAvLyBDYWxjdWxhdGUgY29uZmlkZW5jZVxuICAgIGNvbnN0IGNvbmZpZGVuY2UgPSBjYWxjdWxhdGVDb25maWRlbmNlKHByaW1hcnlGaWVsZCwgcGFyc2VkLCByZWxhdGVkRW50aXR5TmFtZSwgbWV0aG9kKTtcblxuICAgIC8vIENoZWNrIGNvbmZpZGVuY2UgdGhyZXNob2xkXG4gICAgY29uc3QgdGhyZXNob2xkT3JkZXIgPSB7IGxvdzogMCwgbWVkaXVtOiAxLCBoaWdoOiAyIH07XG4gICAgaWYgKHRocmVzaG9sZE9yZGVyWyBjb25maWRlbmNlIF0gPCB0aHJlc2hvbGRPcmRlclsgY29uZmlnLmNvbmZpZGVuY2VUaHJlc2hvbGQgXSkge1xuICAgICAgICAvLyBDb25maWRlbmNlIHRvbyBsb3dcbiAgICAgICAgaWYgKGNvbmZpZy5kZWJ1Zykge1xuICAgICAgICAgICAgRGVmYXVsdExvZ2dlci5pbmZvKGBbRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uXSBTa2lwcGluZyAke3JlbGF0aW9uRmllbGRJZH06IGNvbmZpZGVuY2UgJHtjb25maWRlbmNlfSA8IHRocmVzaG9sZCAke2NvbmZpZy5jb25maWRlbmNlVGhyZXNob2xkfWApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgLy8gR2VuZXJhdGUgdGVtcGxhdGVcbiAgICBjb25zdCB0ZW1wbGF0ZSA9IGdlbmVyYXRlVGVtcGxhdGUoXG4gICAgICAgIHByaW1hcnlGaWVsZCxcbiAgICAgICAgeyBkaXNwbGF5OiBkaXNwbGF5RmllbGRzLCB2aXN1YWw6IHZpc3VhbEZpZWxkcywgbWV0YTogbWV0YUZpZWxkcyB9LFxuICAgICAgICBjb25maWcudGVtcGxhdGVTdHlsZVxuICAgICk7XG5cbiAgICAvLyBEZWJ1ZyBsb2dnaW5nXG4gICAgaWYgKGNvbmZpZy5kZWJ1Zykge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25dICR7cmVsYXRpb25GaWVsZElkfSDihpIgJHt0ZW1wbGF0ZX0gKGNvbmZpZGVuY2U6ICR7Y29uZmlkZW5jZX0sIG1ldGhvZDogJHttZXRob2R9KWApO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIHByaW1hcnlGaWVsZCxcbiAgICAgICAgdGVtcGxhdGUsXG4gICAgICAgIGRldGVjdGVkRmllbGRzOiB7XG4gICAgICAgICAgICBkaXNwbGF5OiBkaXNwbGF5RmllbGRzLFxuICAgICAgICAgICAgdmlzdWFsOiB2aXN1YWxGaWVsZHMubGVuZ3RoID4gMCA/IHZpc3VhbEZpZWxkcyA6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgIG1ldGE6IG1ldGFGaWVsZHMubGVuZ3RoID4gMCA/IG1ldGFGaWVsZHMgOiB1bmRlZmluZWRcbiAgICAgICAgfSxcbiAgICAgICAgY29uZmlkZW5jZSxcbiAgICAgICAgbWV0aG9kLFxuICAgICAgICBwYXR0ZXJuXG4gICAgfTtcbn1cblxuLyoqXG4gKiBMZWdhY3kgd3JhcHBlciBmdW5jdGlvbiBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eS5cbiAqIFxuICogQGRlcHJlY2F0ZWQgVXNlIGRldGVjdER1cGxpY2F0ZWRSZWxhdGlvbkZpZWxkcygpIGZvciByaWNoZXIgcmVzdWx0c1xuICovXG5mdW5jdGlvbiBkZXRlY3REdXBsaWNhdGVkUmVsYXRpb25GaWVsZFRlbXBsYXRlKFxuICAgIGFsbFByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLFxuICAgIHJlbGF0aW9uRmllbGRJZDogc3RyaW5nLFxuICAgIHJlbGF0ZWRFbnRpdHlOYW1lOiBzdHJpbmdcbik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgcmVzdWx0ID0gZGV0ZWN0RHVwbGljYXRlZFJlbGF0aW9uRmllbGRzKFxuICAgICAgICBhbGxQcm9wZXJ0aWVzLFxuICAgICAgICByZWxhdGlvbkZpZWxkSWQsXG4gICAgICAgIHJlbGF0ZWRFbnRpdHlOYW1lXG4gICAgKTtcbiAgICByZXR1cm4gcmVzdWx0Py50ZW1wbGF0ZTtcbn1cblxuLyoqXG4gKiBHZW5lcmF0ZSBzbWFydCBmYWxsYmFjayBjb25maWd1cmF0aW9uIGZvciByZWxhdGlvbiBkaXNwbGF5IHdoZW4gb25seSBJRCBpcyBhdmFpbGFibGUuXG4gKiBVc2VzIGVudGl0eSBtZXRhZGF0YSAoaWNvbiwgZW50aXR5TmFtZVBsdXJhbCkgdG8gY3JlYXRlIHVzZXItZnJpZW5kbHkgZmFsbGJhY2sgdGV4dC5cbiAqIFxuICogQHBhcmFtIGVudGl0eU5hbWUgLSBSZWxhdGVkIGVudGl0eSBuYW1lIChlLmcuLCAndGVhbScpXG4gKiBAcGFyYW0gaWRGaWVsZCAtIElEIGZpZWxkIG5hbWUgKGUuZy4sICd0ZWFtSWQnKVxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSB0byBnZXQgbWV0YWRhdGEgZnJvbVxuICogQHJldHVybnMgRmFsbGJhY2sgY29uZmlndXJhdGlvbiB3aXRoIHRlbXBsYXRlLCBsaW5rVGV4dCwgYW5kIG1vZGFsQnV0dG9uVGV4dFxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gRm9yIGEgdGVhbSByZWxhdGlvblxuICogZ2VuZXJhdGVSZWxhdGlvbkZhbGxiYWNrKCd0ZWFtJywgJ3RlYW1JZCcsIHRlYW1TZXJ2aWNlKVxuICogLy8gUmV0dXJuczoge1xuICogLy8gICB0ZW1wbGF0ZTogJ1RlYW06IHt0ZWFtSWR9JyxcbiAqIC8vICAgbGlua1RleHQ6ICdWaWV3IFRlYW0nLFxuICogLy8gICBtb2RhbEJ1dHRvblRleHQ6ICdUZWFtIERldGFpbHMnXG4gKiAvLyB9XG4gKi9cbi8qKlxuICogR2VuZXJhdGVzIGZhbGxiYWNrIGRpc3BsYXkgY29uZmlndXJhdGlvbiBmb3IgcmVsYXRpb24gZmllbGRzLlxuICogXG4gKiBDcmVhdGVzIHVzZXItZnJpZW5kbHkgZmFsbGJhY2sgdGV4dCB0byBkaXNwbGF5IHdoZW4gb25seSB0aGUgSUQgb2YgYSByZWxhdGVkIGVudGl0eSBpcyBhdmFpbGFibGUuXG4gKiBVc2VzIHRoZSBlbnRpdHkncyBwbHVyYWwgZGlzcGxheSBuYW1lIChmcm9tIG1ldGFkYXRhKSBvciBnZW5lcmF0ZXMgaXQgZnJvbSB0aGUgZW50aXR5IG5hbWUuXG4gKiBcbiAqIEBwYXJhbSBlbnRpdHlOYW1lIC0gTmFtZSBvZiB0aGUgcmVsYXRlZCBlbnRpdHkgKGUuZy4sICd0ZWFtJywgJ3VzZXInKVxuICogQHBhcmFtIGlkRmllbGQgLSBJRCBmaWVsZCBuYW1lIChlLmcuLCAndGVhbUlkJywgJ3VzZXJJZCcpXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIE9wdGlvbmFsIGVudGl0eSBzZXJ2aWNlIHRvIGZldGNoIG1ldGFkYXRhIGZvciBiZXR0ZXIgbmFtaW5nXG4gKiBAcmV0dXJucyBGYWxsYmFjayBjb25maWd1cmF0aW9uIHdpdGggdGVtcGxhdGUsIGxpbmsgdGV4dCwgYW5kIG1vZGFsIGJ1dHRvbiB0ZXh0XG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBmYWxsYmFjayA9IGdlbmVyYXRlUmVsYXRpb25GYWxsYmFjaygndGVhbScsICd0ZWFtSWQnKTtcbiAqIC8vIFJldHVybnM6IHtcbiAqIC8vICAgdGVtcGxhdGU6IFwiVGVhbXM6IHt0ZWFtSWR9XCIsXG4gKiAvLyAgIGxpbmtUZXh0OiBcIlZpZXcgVGVhbXNcIixcbiAqIC8vICAgbW9kYWxCdXR0b25UZXh0OiBcIlRlYW1zIERldGFpbHNcIlxuICogLy8gfVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZW5lcmF0ZVJlbGF0aW9uRmFsbGJhY2soXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGlkRmllbGQ6IHN0cmluZyxcbiAgICBlbnRpdHlTZXJ2aWNlPzogQmFzZUVudGl0eVNlcnZpY2U8YW55PlxuKTogTm9uTnVsbGFibGU8SVJlbGF0aW9uRmllbGRDb25maWdbICdkaXNwbGF5Q29uZmlnJyBdPlsgJ2ZhbGxiYWNrJyBdIHtcbiAgICAvLyBUcnkgdG8gZ2V0IGVudGl0eSBtZXRhZGF0YSBmb3IgYmV0dGVyIGZhbGxiYWNrIHRleHRcbiAgICBjb25zdCBlbnRpdHlNZXRhZGF0YSA9IGVudGl0eVNlcnZpY2U/LmdldEVudGl0eVNjaGVtYT8uKCkubW9kZWw7XG4gICAgY29uc3QgZGlzcGxheU5hbWUgPSBlbnRpdHlNZXRhZGF0YT8uZW50aXR5TmFtZVBsdXJhbCB8fCBwYXNjYWxDYXNlKGVudGl0eU5hbWUpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgLy8gQmFja2VuZCBwcmUtZ2VuZXJhdGVzIGZhbGxiYWNrIHRlbXBsYXRlIChpbnRlbnRpb25hbGx5IHN0cmluZy1vbmx5LCBub3QgVGVtcGxhdGUgdHlwZSlcbiAgICAgICAgLy8gRnJvbnRlbmQgd2lsbCB1c2UgdGhpcyB3aGVuIG9ubHkgSUQgaXMgYXZhaWxhYmxlXG4gICAgICAgIHRlbXBsYXRlOiBgJHtkaXNwbGF5TmFtZX06IHske2lkRmllbGR9fWAsICAvLyBlLmcuLCBcIlRlYW06IHt0ZWFtSWR9XCJcbiAgICAgICAgbGlua1RleHQ6IGBWaWV3ICR7ZGlzcGxheU5hbWV9YCwgICAgICAgICAgIC8vIGUuZy4sIFwiVmlldyBUZWFtXCJcbiAgICAgICAgbW9kYWxCdXR0b25UZXh0OiBgJHtkaXNwbGF5TmFtZX0gRGV0YWlsc2AgIC8vIGUuZy4sIFwiVGVhbSBEZXRhaWxzXCJcbiAgICB9O1xufVxuXG4vKipcbiAqIExhYmVsIGZpZWxkIGRldGVjdGlvbiByZXN1bHQgd2l0aCBjb25maWRlbmNlIHNjb3JpbmdcbiAqL1xuaW50ZXJmYWNlIExhYmVsRmllbGREZXRlY3Rpb25SZXN1bHQge1xuICAgIGZpZWxkOiBzdHJpbmc7XG4gICAgY29uZmlkZW5jZTogJ2hpZ2gnIHwgJ21lZGl1bSc7ICAvLyBPbmx5IGhpZ2ggb3IgbWVkaXVtIC0gbm8gbG93IGNvbmZpZGVuY2UgcmVzdWx0cyByZXR1cm5lZFxuICAgIG1ldGhvZDogJ21ldGFkYXRhJyB8ICdjb21tb24tcGF0dGVybicgfCAnZW50aXR5LXBhdHRlcm4nIHwgJ3N1ZmZpeC1wYXR0ZXJuJztcbn1cblxuLyoqXG4gKiBTbWFydCBsYWJlbCBmaWVsZCBkZXRlY3Rpb24gZm9yIGVudGl0eSBvcHRpb25zLlxuICogVXNlcyBnZW5lcmljIHBhdHRlcm5zIHRvIGZpbmQgZGlzcGxheSBmaWVsZHMgdGhhdCBhcmUgYWN0dWFsIGlkZW50aWZpZXJzL25hbWVzLlxuICogXG4gKiAqKkhJR0hMWSBDT05TRVJWQVRJVkUqKjogT25seSByZXR1cm5zIGZpZWxkcyB0aGF0IGFyZSBjbGVhcmx5IG1lYW50IGZvciBkaXNwbGF5LlxuICogUmV0dXJucyB1bmRlZmluZWQgaWYgbm8gcHJvcGVyIG5hbWUgZmllbGQgaXMgZm91bmQgLSBiZXR0ZXIgdG8gc2hvdyBJRCB0aGFuIGNvbmZ1c2UgdXNlcnMuXG4gKiBcbiAqIERldGVjdGlvbiBvcmRlciAoYWxsIEhJR0ggb3IgTUVESVVNIGNvbmZpZGVuY2UpOlxuICogMS4gRW50aXR5IG1ldGFkYXRhIChlbnRpdHlOYW1lQXR0cmlidXRlKSAtIEhJR0ggY29uZmlkZW5jZVxuICogMi4gQ29tbW9uIGRpc3BsYXkgZmllbGQgcGF0dGVybnMgKG5hbWUsIHRpdGxlLCBsYWJlbCwgZGlzcGxheU5hbWUpIC0gSElHSCBjb25maWRlbmNlICBcbiAqIDMuIEVudGl0eS1zcGVjaWZpYyBwYXR0ZXJucyAoe2VudGl0eU5hbWV9TmFtZSwge2VudGl0eU5hbWV9VGl0bGUpIC0gSElHSCBjb25maWRlbmNlXG4gKiA0LiBGaWVsZHMgZW5kaW5nIHdpdGggbmFtZS1saWtlIHN1ZmZpeGVzIChOYW1lLCBUaXRsZSwgTGFiZWwsIENvZGUpIC0gTUVESVVNIGNvbmZpZGVuY2VcbiAqIFxuICogKipOTyBGQUxMQkFDSyoqOiBJZiBub25lIG9mIHRoZSBhYm92ZSBtYXRjaCwgcmV0dXJucyB1bmRlZmluZWQuXG4gKiBXZSBkbyBOT1QgcGljayBnZW5lcmljIGZpZWxkcyBsaWtlICdzdGF0dXMnLCAndHlwZScsIG9yIHJhbmRvbSBlbnVtcy9zdHJpbmdzLlxuICogXG4gKiBXaHkgbm8gZmFsbGJhY2s/XG4gKiAtIFNob3dpbmcgXCJhY3RpdmVcIi9cImNhbmNlbGxlZFwiIGZvciBzdWJzY3JpcHRpb25zIGlzIGNvbmZ1c2luZyAod2hpY2ggc3Vic2NyaXB0aW9uPylcbiAqIC0gU2hvd2luZyBcImNyZWRpdF9jYXJkXCIvXCJwYXlwYWxcIiBmb3IgcGF5bWVudCBtZXRob2RzIGlzIG5vdCBhbiBpZGVudGlmaWVyXG4gKiAtIEJldHRlciB0byBzaG93IHN1YnNjcmlwdGlvbklkIHRoYW4gbWlzbGVhZGluZyBmaWVsZHNcbiAqIFxuICogRm9yIGVudGl0aWVzIHdpdGhvdXQgbmFtZSBmaWVsZHMsIHVzZSBvbmUgb2Y6XG4gKiAtIFNldCBlbnRpdHlOYW1lQXR0cmlidXRlIGluIHNjaGVtYSBtZXRhZGF0YVxuICogLSBVc2Ugb3B0aW9uTWFwcGluZyBpbiByZWxhdGlvbiBjb25maWdcbiAqIC0gTGV0IGl0IGZhbGwgYmFjayB0byBJRCAoY2xlYXJlc3Qgb3B0aW9uKVxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gRW50aXRpZXMgd2l0aCBjbGVhciBuYW1lIGZpZWxkcyAtIERFVEVDVEVEIOKchVxuICogVGVhbSDihpIgdGVhbU5hbWUgKFByaW9yaXR5IDMsIEhJR0ggY29uZmlkZW5jZSlcbiAqIFVzZXIg4oaSIG5hbWUgKFByaW9yaXR5IDIsIEhJR0ggY29uZmlkZW5jZSlcbiAqIFBvc3Qg4oaSIHBvc3RUaXRsZSAoUHJpb3JpdHkgNCwgTUVESVVNIGNvbmZpZGVuY2UpXG4gKiBcbiAqIEBleGFtcGxlICBcbiAqIC8vIEVudGl0aWVzIHdpdGhvdXQgbmFtZSBmaWVsZHMgLSBSRVRVUk5TIHVuZGVmaW5lZCDinIVcbiAqIFN1YnNjcmlwdGlvbiDihpIgdW5kZWZpbmVkIChmYWxscyBiYWNrIHRvIHN1YnNjcmlwdGlvbklkIC0gY2xlYXIhKVxuICogUGF5bWVudE1ldGhvZCDihpIgdW5kZWZpbmVkIChmYWxscyBiYWNrIHRvIHBheW1lbnRNZXRob2RJZCAtIGNsZWFyISlcbiAqIEF1ZGl0TG9nIOKGkiB1bmRlZmluZWQgKGZhbGxzIGJhY2sgdG8gYXVkaXRMb2dJZCAtIGNsZWFyISlcbiAqIFxuICogQHBhcmFtIHNjaGVtYSAtIEVudGl0eSBzY2hlbWFcbiAqIEBwYXJhbSBlbnRpdHlOYW1lIC0gRW50aXR5IG5hbWUgKGUuZy4sICd0ZWFtJywgJ3VzZXInKVxuICogQHBhcmFtIG9wdGlvbnMgLSBEZXRlY3Rpb24gb3B0aW9uc1xuICogQHJldHVybnMgQmVzdCBsYWJlbCBmaWVsZCBuYW1lIG9yIHVuZGVmaW5lZCAod2lsbCBmYWxsIGJhY2sgdG8gSUQgZmllbGQpXG4gKi9cbmZ1bmN0aW9uIGZpbmRMYWJlbEZpZWxkKFxuICAgIHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBvcHRpb25zPzoge1xuICAgICAgICAvKiogTWluaW11bSBjb25maWRlbmNlIGxldmVsIHJlcXVpcmVkIChkZWZhdWx0OiAnbWVkaXVtJykgKi9cbiAgICAgICAgbWluQ29uZmlkZW5jZT86ICdoaWdoJyB8ICdtZWRpdW0nO1xuICAgICAgICAvKiogRW5hYmxlIGRlYnVnIGxvZ2dpbmcgKGRlZmF1bHQ6IGZhbHNlKSAqL1xuICAgICAgICBkZWJ1Zz86IGJvb2xlYW47XG4gICAgfVxuKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBtaW5Db25maWRlbmNlID0gb3B0aW9ucz8ubWluQ29uZmlkZW5jZSB8fCAnbWVkaXVtJztcbiAgICBjb25zdCBkZWJ1ZyA9IG9wdGlvbnM/LmRlYnVnIHx8IGZhbHNlO1xuXG4gICAgbGV0IHJlc3VsdDogTGFiZWxGaWVsZERldGVjdGlvblJlc3VsdCB8IHVuZGVmaW5lZDtcblxuICAgIC8vIEdldCBhbGwgYXR0cmlidXRlcyBmcm9tIHNjaGVtYVxuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSBzY2hlbWEuYXR0cmlidXRlcztcbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lcyA9IE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpO1xuXG4gICAgLy8gUHJpb3JpdHkgMTogRW50aXR5IG1ldGFkYXRhIC0gSElHSCBjb25maWRlbmNlXG4gICAgY29uc3QgZW50aXR5TmFtZUF0dHJpYnV0ZSA9IHNjaGVtYS5tb2RlbC5lbnRpdHlOYW1lQXR0cmlidXRlO1xuICAgIGlmIChlbnRpdHlOYW1lQXR0cmlidXRlICYmIGF0dHJpYnV0ZXNbIGVudGl0eU5hbWVBdHRyaWJ1dGUgXSkge1xuICAgICAgICByZXN1bHQgPSB7XG4gICAgICAgICAgICBmaWVsZDogZW50aXR5TmFtZUF0dHJpYnV0ZSxcbiAgICAgICAgICAgIGNvbmZpZGVuY2U6ICdoaWdoJyxcbiAgICAgICAgICAgIG1ldGhvZDogJ21ldGFkYXRhJ1xuICAgICAgICB9O1xuICAgICAgICBpZiAoZGVidWcpIHtcbiAgICAgICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW2ZpbmRMYWJlbEZpZWxkXSAke2VudGl0eU5hbWV9OiBGb3VuZCB2aWEgbWV0YWRhdGEgLSAke2VudGl0eU5hbWVBdHRyaWJ1dGV9IChISUdIIGNvbmZpZGVuY2UpYCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBQcmlvcml0eSAyOiBDb21tb24gZGlzcGxheSBwYXR0ZXJucyAtIEhJR0ggY29uZmlkZW5jZVxuICAgIGlmICghcmVzdWx0KSB7XG4gICAgICAgIGNvbnN0IGNvbW1vblBhdHRlcm5zID0gWyAnbmFtZScsICd0aXRsZScsICdsYWJlbCcsICdkaXNwbGF5TmFtZScsICdkaXNwbGF5bmFtZScgXTtcbiAgICAgICAgZm9yIChjb25zdCBwYXR0ZXJuIG9mIGNvbW1vblBhdHRlcm5zKSB7XG4gICAgICAgICAgICBjb25zdCBtYXRjaCA9IGF0dHJpYnV0ZU5hbWVzLmZpbmQoYXR0ciA9PiBhdHRyLnRvTG93ZXJDYXNlKCkgPT09IHBhdHRlcm4pO1xuICAgICAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0ID0ge1xuICAgICAgICAgICAgICAgICAgICBmaWVsZDogbWF0Y2gsXG4gICAgICAgICAgICAgICAgICAgIGNvbmZpZGVuY2U6ICdoaWdoJyxcbiAgICAgICAgICAgICAgICAgICAgbWV0aG9kOiAnY29tbW9uLXBhdHRlcm4nXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBpZiAoZGVidWcpIHtcbiAgICAgICAgICAgICAgICAgICAgRGVmYXVsdExvZ2dlci5pbmZvKGBbZmluZExhYmVsRmllbGRdICR7ZW50aXR5TmFtZX06IEZvdW5kIHZpYSBjb21tb24gcGF0dGVybiAnJHtwYXR0ZXJufScgLSAke21hdGNofSAoSElHSCBjb25maWRlbmNlKWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFByaW9yaXR5IDM6IEVudGl0eS1zcGVjaWZpYyBwYXR0ZXJucyAtIEhJR0ggY29uZmlkZW5jZVxuICAgIGlmICghcmVzdWx0KSB7XG4gICAgICAgIGNvbnN0IGVudGl0eUxvd2VyID0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICBjb25zdCBlbnRpdHlTcGVjaWZpY1N1ZmZpeGVzID0gWyAnTmFtZScsICdUaXRsZScsICdMYWJlbCcgXTtcblxuICAgICAgICBmb3IgKGNvbnN0IHN1ZmZpeCBvZiBlbnRpdHlTcGVjaWZpY1N1ZmZpeGVzKSB7XG4gICAgICAgICAgICAvLyBUcnkgZXhhY3QgbWF0Y2g6IGUuZy4sICd0ZWFtTmFtZScgZm9yIGVudGl0eSAndGVhbSdcbiAgICAgICAgICAgIGNvbnN0IGV4YWN0TWF0Y2ggPSBhdHRyaWJ1dGVOYW1lcy5maW5kKGF0dHIgPT5cbiAgICAgICAgICAgICAgICBhdHRyLnRvTG93ZXJDYXNlKCkgPT09IGAke2VudGl0eUxvd2VyfSR7c3VmZml4LnRvTG93ZXJDYXNlKCl9YFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGlmIChleGFjdE1hdGNoKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0ID0ge1xuICAgICAgICAgICAgICAgICAgICBmaWVsZDogZXhhY3RNYXRjaCxcbiAgICAgICAgICAgICAgICAgICAgY29uZmlkZW5jZTogJ2hpZ2gnLFxuICAgICAgICAgICAgICAgICAgICBtZXRob2Q6ICdlbnRpdHktcGF0dGVybidcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIGlmIChkZWJ1Zykge1xuICAgICAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtmaW5kTGFiZWxGaWVsZF0gJHtlbnRpdHlOYW1lfTogRm91bmQgdmlhIGVudGl0eS1zcGVjaWZpYyBwYXR0ZXJuIC0gJHtleGFjdE1hdGNofSAoSElHSCBjb25maWRlbmNlKWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFByaW9yaXR5IDQ6IEZpZWxkcyBlbmRpbmcgd2l0aCBuYW1lLWxpa2Ugc3VmZml4ZXMgLSBNRURJVU0gY29uZmlkZW5jZVxuICAgIC8vIExvb2sgZm9yIGFueSBmaWVsZCBlbmRpbmcgd2l0aCAnTmFtZScsICdUaXRsZScsICdMYWJlbCcgKGUuZy4sICdkaXNwbGF5TmFtZScsICdmdWxsTmFtZScsICd1c2VyTmFtZScsKVxuICAgIGlmICghcmVzdWx0KSB7XG4gICAgICAgIGNvbnN0IGRpc3BsYXlOYW1lU3VmZml4UGF0dGVybiA9IC9EaXNwbGF5TmFtZSQvO1xuICAgICAgICBjb25zdCBuYW1lU3VmZml4UGF0dGVybiA9IC9OYW1lJC87XG4gICAgICAgIGNvbnN0IHRpdGxlU3VmZml4UGF0dGVybiA9IC9UaXRsZSQvO1xuICAgICAgICBjb25zdCBsYWJlbFN1ZmZpeFBhdHRlcm4gPSAvTGFiZWwkLztcbiAgICAgICAgY29uc3QgY29kZVN1ZmZpeFBhdHRlcm4gPSAvQ29kZSQvO1xuXG4gICAgICAgIGZvciAoY29uc3QgcGF0dGVybiBvZiBbIGRpc3BsYXlOYW1lU3VmZml4UGF0dGVybiwgbGFiZWxTdWZmaXhQYXR0ZXJuLCB0aXRsZVN1ZmZpeFBhdHRlcm4sIG5hbWVTdWZmaXhQYXR0ZXJuLCBjb2RlU3VmZml4UGF0dGVybiBdKSB7XG4gICAgICAgICAgICBjb25zdCBtYXRjaCA9IGF0dHJpYnV0ZU5hbWVzLmZpbmQoYXR0ciA9PiBwYXR0ZXJuLnRlc3QoYXR0cikpO1xuICAgICAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0ID0ge1xuICAgICAgICAgICAgICAgICAgICBmaWVsZDogbWF0Y2gsXG4gICAgICAgICAgICAgICAgICAgIGNvbmZpZGVuY2U6ICdtZWRpdW0nLFxuICAgICAgICAgICAgICAgICAgICBtZXRob2Q6ICdzdWZmaXgtcGF0dGVybidcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIGlmIChkZWJ1Zykge1xuICAgICAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtmaW5kTGFiZWxGaWVsZF0gJHtlbnRpdHlOYW1lfTogRm91bmQgdmlhIHN1ZmZpeCBwYXR0ZXJuIC0gJHttYXRjaH0gKE1FRElVTSBjb25maWRlbmNlKWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFByaW9yaXR5IDU6IE5PIEZBTExCQUNLIC0gSWYgd2UgY2FuJ3QgZmluZCBhIHByb3BlciBuYW1lIGZpZWxkLCByZXR1cm4gdW5kZWZpbmVkXG4gICAgLy8gQmV0dGVyIHRvIHNob3cgSUQgdGhhbiB0byBzaG93IGNvbmZ1c2luZyBmaWVsZHMgbGlrZSAnc3RhdHVzJywgJ3R5cGUnLCBldGMuXG4gICAgLy8gXG4gICAgLy8gRW50aXRpZXMgbGlrZSBTdWJzY3JpcHRpb24sIFBheW1lbnRNZXRob2QgZG9uJ3QgaGF2ZSB0cmFkaXRpb25hbCBuYW1lIGZpZWxkcy5cbiAgICAvLyBTaG93aW5nIFwiYWN0aXZlXCIgb3IgXCJjcmVkaXRfY2FyZFwiIGluIGEgZHJvcGRvd24gaXMgY29uZnVzaW5nIC0gdXNlcnMgY2FuJ3QgZGlzdGluZ3Vpc2ggaXRlbXMuXG4gICAgLy8gSXQncyBjbGVhcmVyIHRvIHNob3cgdGhlIElEIChzdWJzY3JpcHRpb25JZCwgcGF5bWVudE1ldGhvZElkKSBpbiBzdWNoIGNhc2VzLlxuICAgIC8vXG4gICAgLy8gSWYgeW91IG5lZWQgY3VzdG9tIGxhYmVscyBmb3IgdGhlc2UgZW50aXRpZXMsIGV4cGxpY2l0bHkgc2V0IGVudGl0eU5hbWVBdHRyaWJ1dGUgaW4gdGhlIHNjaGVtYVxuICAgIC8vIG9yIHVzZSBvcHRpb25NYXBwaW5nIGluIHRoZSByZWxhdGlvbiBjb25maWcuXG5cbiAgICAvLyBDaGVjayBjb25maWRlbmNlIHRocmVzaG9sZFxuICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgLy8gT25seSByZXR1cm4gaWYgY29uZmlkZW5jZSBtZWV0cyBtaW5pbXVtIHJlcXVpcmVtZW50XG4gICAgICAgIC8vIG1pbkNvbmZpZGVuY2U6ICdoaWdoJyDihpIgb25seSByZXR1cm4gSElHSCBjb25maWRlbmNlIHJlc3VsdHNcbiAgICAgICAgLy8gbWluQ29uZmlkZW5jZTogJ21lZGl1bScg4oaSIHJldHVybiBISUdIIG9yIE1FRElVTSBjb25maWRlbmNlIHJlc3VsdHMgKGRlZmF1bHQpXG4gICAgICAgIGlmIChtaW5Db25maWRlbmNlID09PSAnaGlnaCcgJiYgcmVzdWx0LmNvbmZpZGVuY2UgPT09ICdtZWRpdW0nKSB7XG4gICAgICAgICAgICBpZiAoZGVidWcpIHtcbiAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYFtmaW5kTGFiZWxGaWVsZF0gJHtlbnRpdHlOYW1lfTogRmllbGQgJyR7cmVzdWx0LmZpZWxkfScgZm91bmQgd2l0aCBNRURJVU0gY29uZmlkZW5jZSwgYnV0IEhJR0ggY29uZmlkZW5jZSByZXF1aXJlZC4gUmV0dXJuaW5nIHVuZGVmaW5lZC5gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzdWx0LmZpZWxkO1xuICAgIH1cblxuICAgIC8vIE5vIHN1aXRhYmxlIGZpZWxkIGZvdW5kXG4gICAgaWYgKGRlYnVnKSB7XG4gICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgW2ZpbmRMYWJlbEZpZWxkXSAke2VudGl0eU5hbWV9OiBObyBzdWl0YWJsZSBsYWJlbCBmaWVsZCBmb3VuZCB3aXRoIHN1ZmZpY2llbnQgY29uZmlkZW5jZS5gKTtcbiAgICB9XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBSRUxBVElPTiBPUFRJT04gQ09ORklHIFJFU09MVVRJT05cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIFJlc29sdmVzIFJlbGF0aW9uRW50aXR5T3B0aW9uQ29uZmlnIGludG8gRmllbGRPcHRpb25zQVBJQ29uZmlnIGJ5IGF1dG8tZGV0ZWN0aW5nOlxuICogLSBDUlVEIEFQSSBwYXRoIGZyb20gZW50aXR5IHNjaGVtYVxuICogLSBMYWJlbCBmaWVsZCBmcm9tIGVudGl0eU5hbWVBdHRyaWJ1dGUgbWV0YWRhdGEgb3Igc21hcnQgZGV0ZWN0aW9uXG4gKiAtIFZhbHVlIGZpZWxkIGZyb20gcmVsYXRpb24gaWRlbnRpZmllcnNcbiAqIFxuICogQHBhcmFtIHJlbGF0aW9uQ29uZmlnIC0gTWluaW1hbCByZWxhdGlvbiBvcHRpb24gY29uZmlnXG4gKiBAcGFyYW0gcmVsYXRpb25BdHRyaWJ1dGUgLSBUaGUgcmVsYXRpb24gYXR0cmlidXRlICh0byBnZXQgaWRlbnRpZmllcnMpXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIGZvciBzY2hlbWEgbG9va3VwXG4gKiBAcGFyYW0gZ2xvYmFsVUlDb25maWdPcHRpb25zIC0gR2xvYmFsIFVJIGNvbmZpZyBvcHRpb25zIChmb3IgbGFiZWwgZmllbGQgZGV0ZWN0aW9uKVxuICogQHJldHVybnMgRnVsbHkgcmVzb2x2ZWQgRmllbGRPcHRpb25zQVBJQ29uZmlnIG9yIHVuZGVmaW5lZCBpZiBlbnRpdHkgbm90IGZvdW5kXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUmVsYXRpb25PcHRpb25Db25maWcoXG4gICAgcmVsYXRpb25Db25maWc6IFJlbGF0aW9uRW50aXR5T3B0aW9uQ29uZmlnLFxuICAgIHJlbGF0aW9uQXR0cmlidXRlOiBUSU9TY2hlbWFBdHRyaWJ1dGUgJiB7IHJlbGF0aW9uOiBOb25OdWxsYWJsZTxUSU9TY2hlbWFBdHRyaWJ1dGVbICdyZWxhdGlvbicgXT4gfSxcbiAgICBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+LFxuICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sgJ3VpQ29uZmlnR2VuT3B0aW9ucycgXVxuKTogRmllbGRPcHRpb25zQVBJQ29uZmlnPGFueT4gfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSwgY3VzdG9tQXBpVXJsLCBvcHRpb25NYXBwaW5nLCAuLi5yZXN0IH0gPSByZWxhdGlvbkNvbmZpZztcbiAgICBjb25zdCByZWxhdGlvbiA9IHJlbGF0aW9uQXR0cmlidXRlLnJlbGF0aW9uO1xuXG4gICAgLy8gR2V0IHJlbGF0ZWQgZW50aXR5IHNlcnZpY2VcbiAgICBpZiAoIWVudGl0eVNlcnZpY2UuaGFzRW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShlbnRpdHlOYW1lKSkge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYFtyZXNvbHZlUmVsYXRpb25PcHRpb25Db25maWddIEVudGl0eSBzZXJ2aWNlIG5vdCBmb3VuZCBmb3I6ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCByZWxhdGVkU2VydmljZSA9IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShlbnRpdHlOYW1lKTtcbiAgICBjb25zdCByZWxhdGVkU2NoZW1hID0gcmVsYXRlZFNlcnZpY2U/LmdldEVudGl0eVNjaGVtYT8uKCk7XG5cbiAgICBpZiAoIXJlbGF0ZWRTY2hlbWEpIHtcbiAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBbcmVzb2x2ZVJlbGF0aW9uT3B0aW9uQ29uZmlnXSBTY2hlbWEgbm90IGZvdW5kIGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyAxLiBSZXNvbHZlIEFQSSBVUkxcbiAgICBjb25zdCBlbnRpdHlOYW1lTG93ZXIgPSBlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgY3J1ZFBhdGggPSByZWxhdGVkU2NoZW1hLm1vZGVsLkNSVURBcGlQYXRoIHx8ICcnO1xuICAgIGNvbnN0IGFwaVVybCA9IGN1c3RvbUFwaVVybCB8fCBgJHtjcnVkUGF0aH0vJHtlbnRpdHlOYW1lTG93ZXJ9YDtcblxuICAgIC8vIDIuIFJlc29sdmUgdmFsdWUgZmllbGQgZnJvbSByZWxhdGlvbiBpZGVudGlmaWVyc1xuICAgIGNvbnN0IHJlc29sdmVkSWRlbnRpZmllcnMgPSB0eXBlb2YgcmVsYXRpb24uaWRlbnRpZmllcnMgPT09ICdmdW5jdGlvbicgPyByZWxhdGlvbi5pZGVudGlmaWVycygpIDogcmVsYXRpb24uaWRlbnRpZmllcnM7XG4gICAgY29uc3QgaWRlbnRpZmllck1hcHBpbmdzID0gQXJyYXkuaXNBcnJheShyZXNvbHZlZElkZW50aWZpZXJzKSA/IHJlc29sdmVkSWRlbnRpZmllcnMgOiBbIHJlc29sdmVkSWRlbnRpZmllcnMgXTtcbiAgICBjb25zdCBwcmltYXJ5SWRlbnRpZmllciA9IGlkZW50aWZpZXJNYXBwaW5nc1sgMCBdO1xuICAgIGNvbnN0IHZhbHVlRmllbGQgPSBTdHJpbmcocHJpbWFyeUlkZW50aWZpZXIudGFyZ2V0KTtcblxuICAgIC8vIDMuIFJlc29sdmUgbGFiZWwgZmllbGQgZnJvbSBlbnRpdHkgbWV0YWRhdGEgb3IgY3VzdG9tIG1hcHBpbmdcbiAgICBsZXQgbGFiZWxGaWVsZCA9IHZhbHVlRmllbGQ7IC8vIERlZmF1bHQgZmFsbGJhY2sgdG8gdmFsdWUgZmllbGRcblxuICAgIGlmIChvcHRpb25NYXBwaW5nPy5sYWJlbCkge1xuICAgICAgICAvLyBDdXN0b20gbGFiZWwgcHJvdmlkZWQgLSB1c2UgaXRcbiAgICAgICAgbGFiZWxGaWVsZCA9IG9wdGlvbk1hcHBpbmcubGFiZWwgYXMgc3RyaW5nO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEF1dG8tZGV0ZWN0IHVzaW5nIHNtYXJ0IHBhdHRlcm4gbWF0Y2hpbmcgd2l0aCBnbG9iYWwgY29uZmlnXG4gICAgICAgIGNvbnN0IGxhYmVsRmllbGRDb25maWcgPSBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/LmxhYmVsRmllbGREZXRlY3Rpb247XG4gICAgICAgIGxhYmVsRmllbGQgPSBmaW5kTGFiZWxGaWVsZChyZWxhdGVkU2NoZW1hLCBlbnRpdHlOYW1lLCB7XG4gICAgICAgICAgICBtaW5Db25maWRlbmNlOiBsYWJlbEZpZWxkQ29uZmlnPy5taW5Db25maWRlbmNlIHx8ICdtZWRpdW0nLFxuICAgICAgICAgICAgZGVidWc6IGxhYmVsRmllbGRDb25maWc/LmRlYnVnIHx8IGZhbHNlXG4gICAgICAgIH0pIHx8IHZhbHVlRmllbGQ7XG4gICAgfVxuXG4gICAgLy8gNC4gQnVpbGQgY29tcGxldGUgRmllbGRPcHRpb25zQVBJQ29uZmlnXG4gICAgcmV0dXJuIHtcbiAgICAgICAgYXBpTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgYXBpVXJsLFxuICAgICAgICByZXNwb25zZUtleTogJ2l0ZW1zJyxcbiAgICAgICAgb3B0aW9uTWFwcGluZzogb3B0aW9uTWFwcGluZyB8fCB7XG4gICAgICAgICAgICBsYWJlbDogbGFiZWxGaWVsZCxcbiAgICAgICAgICAgIHZhbHVlOiAob3B0aW9uTWFwcGluZyBhcyBhbnkpPy52YWx1ZSB8fCB2YWx1ZUZpZWxkXG4gICAgICAgIH0sXG4gICAgICAgIC4uLnJlc3QgLy8gUGFzcyB0aHJvdWdoIGZpbHRlcnMsIGNvdW50LCBkaXNhYmxlU2VhcmNoLCBldGMuXG4gICAgfTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBGSUxURVIgQVVUTy1HRU5FUkFUSU9OXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBBdXRvLWdlbmVyYXRlcyBmaWx0ZXJDb25maWcgZm9yIGVudGl0eSBhdHRyaWJ1dGVzIGJhc2VkIG9uIGZpZWxkIHR5cGUuXG4gKiBcbiAqIEFsZ29yaXRobTpcbiAqIDEuIENoZWNrIGlmIGV4cGxpY2l0IGZpbHRlckNvbmZpZyBhbHJlYWR5IGV4aXN0cyDihpIgdXNlIGl0XG4gKiAyLiBDaGVjayBpZiBmaWVsZCBpcyBleHBsaWNpdGx5IG5vbi1maWx0ZXJhYmxlIOKGkiBza2lwXG4gKiAzLiBEZXRlY3QgZmllbGQgdHlwZSBhbmQgZ2VuZXJhdGUgYXBwcm9wcmlhdGUgY29uZmlnXG4gKiA0LiBNZXJnZSB3aXRoIGdsb2JhbCBhbmQgZW50aXR5LWxldmVsIG92ZXJyaWRlc1xuICogXG4gKiBAcGFyYW0gYXR0cmlidXRlIC0gVGhlIGF0dHJpYnV0ZSB0byBnZW5lcmF0ZSBmaWx0ZXIgY29uZmlnIGZvclxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSBmb3IgYWNjZXNzaW5nIGVudGl0eSBtZXRhZGF0YVxuICogQHBhcmFtIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyAtIEdsb2JhbCBVSSBjb25maWd1cmF0aW9uIG9wdGlvbnNcbiAqIEByZXR1cm5zIEdlbmVyYXRlZCBmaWx0ZXIgY29uZmlndXJhdGlvbiBvciB1bmRlZmluZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdlbmVyYXRlRmlsdGVyQ29uZmlnKFxuICAgIGF0dHJpYnV0ZTogVElPU2NoZW1hQXR0cmlidXRlLFxuICAgIGVudGl0eVNlcnZpY2U/OiBCYXNlRW50aXR5U2VydmljZTxhbnk+LFxuICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sgJ3VpQ29uZmlnR2VuT3B0aW9ucycgXVxuKTogRmllbGRNZXRhZGF0YVsgJ2ZpbHRlckNvbmZpZycgXSB8IHVuZGVmaW5lZCB7XG4gICAgLy8gMS4gSWYgZXhwbGljaXQgZmlsdGVyQ29uZmlnIGV4aXN0cywgdXNlIGl0IChoaWdoZXN0IHByaW9yaXR5KVxuICAgIGlmIChhdHRyaWJ1dGUuZmlsdGVyQ29uZmlnKSB7XG4gICAgICAgIHJldHVybiBhdHRyaWJ1dGUuZmlsdGVyQ29uZmlnO1xuICAgIH1cblxuICAgIC8vIDIuIElmIGZpZWxkIGhhcyBleHBsaWNpdCBvcHRpb25zIGNvbmZpZywgdXNlIGl0XG4gICAgaWYgKCdvcHRpb25zJyBpbiBhdHRyaWJ1dGUpIHtcbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IChhdHRyaWJ1dGUgYXMgU2VsZWN0RmllbGRNZXRhZGF0YSkub3B0aW9ucztcblxuICAgICAgICAvLyBSZWxhdGlvbkVudGl0eU9wdGlvbkNvbmZpZyAoaGFzIGVudGl0eU5hbWUpIOKGkiByZXNvbHZlIHRvIEZpZWxkT3B0aW9uc0FQSUNvbmZpZ1xuICAgICAgICBjb25zdCBpc1JlbGF0aW9uQ29uZmlnID0gdHlwZW9mIG9wdGlvbnMgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KG9wdGlvbnMpICYmICdlbnRpdHlOYW1lJyBpbiBvcHRpb25zO1xuXG4gICAgICAgIGxldCByZXNvbHZlZENvbmZpZzogRmllbGRPcHRpb25zQVBJQ29uZmlnPGFueT4gfCBGaWVsZE9wdGlvbltdIHwgdW5kZWZpbmVkO1xuXG4gICAgICAgIC8vIElubGluZSBhcnJheSDihpIgdXNlIGFzIGlzXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KG9wdGlvbnMpICYmIG9wdGlvbnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgcmVzb2x2ZWRDb25maWcgPSBvcHRpb25zIGFzIEZpZWxkT3B0aW9uW107XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGaWVsZE9wdGlvbnNBUElDb25maWcgKGhhcyBhcGlNZXRob2QsIGFwaVVybCwgcmVzcG9uc2VLZXkpIOKGkiBwYXNzIHRocm91Z2hcbiAgICAgICAgY29uc3QgaXNBcGlDb25maWcgPSB0eXBlb2Ygb3B0aW9ucyA9PT0gJ29iamVjdCcgJiYgIUFycmF5LmlzQXJyYXkob3B0aW9ucykgJiYgJ2FwaU1ldGhvZCcgaW4gb3B0aW9ucztcbiAgICAgICAgaWYgKGlzQXBpQ29uZmlnKSB7XG4gICAgICAgICAgICByZXNvbHZlZENvbmZpZyA9IG9wdGlvbnMgYXMgRmllbGRPcHRpb25zQVBJQ29uZmlnPGFueT47XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaXNSZWxhdGlvbkNvbmZpZyAmJiBhdHRyaWJ1dGUucmVsYXRpb24gJiYgZW50aXR5U2VydmljZSkge1xuICAgICAgICAgICAgcmVzb2x2ZWRDb25maWcgPSByZXNvbHZlUmVsYXRpb25PcHRpb25Db25maWcoXG4gICAgICAgICAgICAgICAgb3B0aW9ucyBhcyBSZWxhdGlvbkVudGl0eU9wdGlvbkNvbmZpZyxcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGUgYXMgVElPU2NoZW1hQXR0cmlidXRlICYgeyByZWxhdGlvbjogTm9uTnVsbGFibGU8VElPU2NoZW1hQXR0cmlidXRlWyAncmVsYXRpb24nIF0+IH0sXG4gICAgICAgICAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgICAgICAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnNcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocmVzb2x2ZWRDb25maWcpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgZmlsdGVyVHlwZTogJ3NlbGVjdCcsXG4gICAgICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiAnZXEnIGFzIGNvbnN0LFxuICAgICAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogWyAnZXEnLCAnbmVxJywgJ2luTGlzdCcsICdub3RJbkxpc3QnLCAnZXhpc3RzJywgJ25vdEV4aXN0cycgXSxcbiAgICAgICAgICAgICAgICBwcmVkZWZpbmVkT3B0aW9uczogcmVzb2x2ZWRDb25maWdcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBlbHNlIGxvZyBlcnJvclxuICAgICAgICB0aHJvdyBuZXcgRnJhbWV3b3JrRXJyb3IoYFtnZW5lcmF0ZUZpbHRlckNvbmZpZ10gTm8gcmVzb2x2ZWQgY29uZmlnIGZvdW5kIGZvciBhdHRyaWJ1dGU6ICR7YXR0cmlidXRlLmlkfWAsIHtcbiAgICAgICAgICAgIGF0dHJpYnV0ZTogYXR0cmlidXRlLFxuICAgICAgICAgICAgb3B0aW9uczogb3B0aW9ucyxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gMy4gSWYgZmllbGQgaXMgZXhwbGljaXRseSBub24tZmlsdGVyYWJsZSwgc2tpcFxuICAgIGlmIChhdHRyaWJ1dGUuaXNGaWx0ZXJhYmxlID09PSBmYWxzZSkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8vIDMuIEdldCBnbG9iYWwgYW5kIGVudGl0eS1sZXZlbCBjb25maWdcbiAgICBjb25zdCBnbG9iYWxGaWx0ZXJDb25maWcgPSBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/LnRhYmxlVUk/LmZpbHRlckF1dG9HZW5lcmF0aW9uO1xuICAgIGNvbnN0IGVudGl0eU1ldGFkYXRhID0gZW50aXR5U2VydmljZT8uZ2V0RW50aXR5U2NoZW1hPy4oKS5tb2RlbD8ubWV0YWRhdGEgYXMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+WyAnbW9kZWwnIF1bICdtZXRhZGF0YScgXTtcbiAgICBjb25zdCBlbnRpdHlGaWx0ZXJDb25maWcgPSBlbnRpdHlNZXRhZGF0YT8udGFibGVVST8uZmlsdGVyQXV0b0dlbmVyYXRpb247XG5cbiAgICAvLyBNZXJnZSBjb25maWdzIChlbnRpdHkgPiBnbG9iYWwgPiBkZWZhdWx0cylcbiAgICBjb25zdCBtZXJnZWRDb25maWcgPSB7XG4gICAgICAgIGVuYWJsZWQ6IGVudGl0eUZpbHRlckNvbmZpZz8uZW5hYmxlZCA/PyBnbG9iYWxGaWx0ZXJDb25maWc/LmVuYWJsZWQgPz8gdHJ1ZSxcbiAgICAgICAgZGF0ZUZpZWxkczoge1xuICAgICAgICAgICAgLi4uZ2xvYmFsRmlsdGVyQ29uZmlnPy5kYXRlRmllbGRzLFxuICAgICAgICAgICAgLi4uZW50aXR5RmlsdGVyQ29uZmlnPy5kYXRlRmllbGRzXG4gICAgICAgIH0sXG4gICAgICAgIGVudW1GaWVsZHM6IHtcbiAgICAgICAgICAgIC4uLmdsb2JhbEZpbHRlckNvbmZpZz8uZW51bUZpZWxkcyxcbiAgICAgICAgICAgIC4uLmVudGl0eUZpbHRlckNvbmZpZz8uZW51bUZpZWxkc1xuICAgICAgICB9LFxuICAgICAgICBib29sZWFuRmllbGRzOiB7XG4gICAgICAgICAgICAuLi5nbG9iYWxGaWx0ZXJDb25maWc/LmJvb2xlYW5GaWVsZHMsXG4gICAgICAgICAgICAuLi5lbnRpdHlGaWx0ZXJDb25maWc/LmJvb2xlYW5GaWVsZHNcbiAgICAgICAgfSxcbiAgICAgICAgcmVsYXRpb25GaWVsZHM6IHtcbiAgICAgICAgICAgIC4uLmdsb2JhbEZpbHRlckNvbmZpZz8ucmVsYXRpb25GaWVsZHMsXG4gICAgICAgICAgICAuLi5lbnRpdHlGaWx0ZXJDb25maWc/LnJlbGF0aW9uRmllbGRzXG4gICAgICAgIH0sXG4gICAgICAgIG51bWJlckZpZWxkczoge1xuICAgICAgICAgICAgLi4uZ2xvYmFsRmlsdGVyQ29uZmlnPy5udW1iZXJGaWVsZHMsXG4gICAgICAgICAgICAuLi5lbnRpdHlGaWx0ZXJDb25maWc/Lm51bWJlckZpZWxkc1xuICAgICAgICB9LFxuICAgICAgICB0ZXh0RmllbGRzOiB7XG4gICAgICAgICAgICAuLi5nbG9iYWxGaWx0ZXJDb25maWc/LnRleHRGaWVsZHMsXG4gICAgICAgICAgICAuLi5lbnRpdHlGaWx0ZXJDb25maWc/LnRleHRGaWVsZHNcbiAgICAgICAgfSxcbiAgICAgICAgZGVidWc6IGVudGl0eUZpbHRlckNvbmZpZz8uZGVidWcgPz8gZ2xvYmFsRmlsdGVyQ29uZmlnPy5kZWJ1ZyA/PyBmYWxzZVxuICAgIH07XG5cbiAgICAvLyBJZiBnbG9iYWxseSBkaXNhYmxlZCwgc2tpcFxuICAgIGlmICghbWVyZ2VkQ29uZmlnLmVuYWJsZWQpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCBhdHRyVHlwZSA9IGF0dHJpYnV0ZS50eXBlO1xuICAgIGNvbnN0IGZpZWxkVHlwZSA9IGF0dHJpYnV0ZS5maWVsZFR5cGU7XG5cbiAgICAvLyAqKjEuIEJvb2xlYW4gZmllbGRzKipcbiAgICBpZiAoYXR0clR5cGUgPT09ICdib29sZWFuJyAmJiBtZXJnZWRDb25maWcuYm9vbGVhbkZpZWxkcz8uZW5hYmxlZCAhPT0gZmFsc2UpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGZpbHRlclR5cGU6ICdib29sZWFuJyxcbiAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogJ2VxJyxcbiAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogWyAnZXEnLCAnbmVxJywgJ2V4aXN0cycsICdub3RFeGlzdHMnIF0sXG4gICAgICAgICAgICBwcmVkZWZpbmVkT3B0aW9uczogW1xuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdZZXMnLCB2YWx1ZTogXCJ0cnVlXCIgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnTm8nLCB2YWx1ZTogXCJmYWxzZVwiIH1cbiAgICAgICAgICAgIF1cbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyAqKjIuIEVudW0gZmllbGRzIChhcnJheSBvZiBzdHJpbmdzL251bWJlcnMpKipcbiAgICBpZiAoQXJyYXkuaXNBcnJheShhdHRyVHlwZSkgJiYgbWVyZ2VkQ29uZmlnLmVudW1GaWVsZHM/LmVuYWJsZWQgIT09IGZhbHNlKSB7XG4gICAgICAgIGNvbnN0IGRlZmF1bHRFbnVtT3BzID0gWyAnZXEnLCAnbmVxJywgJ2luTGlzdCcsICdub3RJbkxpc3QnLCAnZXhpc3RzJywgJ25vdEV4aXN0cycgXSBhcyBjb25zdDtcbiAgICAgICAgY29uc3QgZGVmYXVsdE9wID0gbWVyZ2VkQ29uZmlnLmVudW1GaWVsZHM/LmRlZmF1bHRPcGVyYXRvciB8fCAoJ2VxJyk7XG4gICAgICAgIGNvbnN0IGF2YWlsYWJsZU9wcyA9IG1lcmdlZENvbmZpZy5lbnVtRmllbGRzPy5hdmFpbGFibGVPcGVyYXRvcnMgfHwgZGVmYXVsdEVudW1PcHM7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGZpbHRlclR5cGU6ICdzZWxlY3QnLFxuICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBkZWZhdWx0T3AsXG4gICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IGF2YWlsYWJsZU9wcyxcbiAgICAgICAgICAgIHByZWRlZmluZWRPcHRpb25zOiBhdHRyVHlwZS5tYXAodmFsID0+ICh7XG4gICAgICAgICAgICAgICAgbGFiZWw6IFN0cmluZyh2YWwpLFxuICAgICAgICAgICAgICAgIHZhbHVlOiBTdHJpbmcodmFsKSAgLy8gQWx3YXlzIGNvbnZlcnQgdG8gc3RyaW5nIGZvciBjb25zaXN0ZW5jeVxuICAgICAgICAgICAgfSkpXG4gICAgICAgIH07XG4gICAgfVxuXG5cbiAgICAvLyAqKjMuIERhdGUvRGF0ZXRpbWUgZmllbGRzKipcbiAgICBpZiAoKGZpZWxkVHlwZSA9PT0gJ2RhdGUnIHx8IGZpZWxkVHlwZSA9PT0gJ2RhdGV0aW1lJyB8fCAoYXR0clR5cGUgPT09ICdzdHJpbmcnICYmIChhdHRyaWJ1dGUuaWQudG9Mb3dlckNhc2UoKS5pbmNsdWRlcygnZGF0ZScpIHx8IGF0dHJpYnV0ZS5pZC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKCd0aW1lJykpKSlcbiAgICAgICAgJiYgbWVyZ2VkQ29uZmlnLmRhdGVGaWVsZHM/LmVuYWJsZWQgIT09IGZhbHNlKSB7XG4gICAgICAgIGNvbnN0IGRlZmF1bHREYXRlT3BzID0gWyAnZXEnLCAnbmVxJywgJ2d0JywgJ2d0ZScsICdsdCcsICdsdGUnLCAnYmV0d2VlbicsICdleGlzdHMnLCAnbm90RXhpc3RzJyBdIGFzIGNvbnN0O1xuICAgICAgICBjb25zdCBvcGVyYXRvcnMgPSBtZXJnZWRDb25maWcuZGF0ZUZpZWxkcz8uZGVmYXVsdE9wZXJhdG9ycyB8fCBkZWZhdWx0RGF0ZU9wcztcblxuICAgICAgICBjb25zdCBmaWx0ZXJDb25maWc6IGFueSA9IHtcbiAgICAgICAgICAgIGZpbHRlclR5cGU6ICdkYXRldGltZScsXG4gICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IG9wZXJhdG9yc1sgMCBdIHx8ICgnZ3RlJyksXG4gICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IG9wZXJhdG9yc1xuICAgICAgICB9O1xuXG4gICAgICAgIC8vIEFkZCBxdWljayBkYXRlIGZpbHRlcnMgaWYgZW5hYmxlZFxuICAgICAgICBpZiAobWVyZ2VkQ29uZmlnLmRhdGVGaWVsZHM/LnF1aWNrRmlsdGVycyAhPT0gZmFsc2UpIHtcbiAgICAgICAgICAgIGZpbHRlckNvbmZpZy5wcmVkZWZpbmVkT3B0aW9ucyA9IFtcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnVG9kYXknLCB2YWx1ZTogJzpzdGFydE9mVG9kYXknIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ1llc3RlcmRheScsIHZhbHVlOiAnOnN0YXJ0T2ZZZXN0ZXJkYXknIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ1RoaXMgV2VlaycsIHZhbHVlOiAnOnN0YXJ0T2ZXZWVrJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdMYXN0IFdlZWsnLCB2YWx1ZTogJzpzdGFydE9mTGFzdFdlZWsnIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ1RoaXMgTW9udGgnLCB2YWx1ZTogJzpzdGFydE9mTW9udGgnIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ0xhc3QgTW9udGgnLCB2YWx1ZTogJzpzdGFydE9mTGFzdE1vbnRoJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdUaGlzIFF1YXJ0ZXInLCB2YWx1ZTogJzpzdGFydE9mUXVhcnRlcicgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnTGFzdCBRdWFydGVyJywgdmFsdWU6ICc6c3RhcnRPZkxhc3RRdWFydGVyJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdUaGlzIFllYXInLCB2YWx1ZTogJzpzdGFydE9mWWVhcicgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnTGFzdCBZZWFyJywgdmFsdWU6ICc6c3RhcnRPZkxhc3RZZWFyJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdMYXN0IDcgRGF5cycsIHZhbHVlOiAnOm5vd01pbnVzN0RheXMnIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ0xhc3QgMzAgRGF5cycsIHZhbHVlOiAnOm5vd01pbnVzMzBEYXlzJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdMYXN0IDkwIERheXMnLCB2YWx1ZTogJzpub3dNaW51czkwRGF5cycgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnQ3VzdG9tIERhdGUnLCB2YWx1ZTogbnVsbCB9ICAvLyBUcmlnZ2VycyBkYXRldGltZS1sb2NhbCBpbnB1dFxuICAgICAgICAgICAgXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBmaWx0ZXJDb25maWc7XG4gICAgfVxuXG4gICAgLy8gKio1LiBOdW1iZXIgZmllbGRzKipcbiAgICBpZiAoYXR0clR5cGUgPT09ICdudW1iZXInICYmIG1lcmdlZENvbmZpZy5udW1iZXJGaWVsZHM/LmVuYWJsZWQgIT09IGZhbHNlKSB7XG4gICAgICAgIGNvbnN0IGRlZmF1bHROdW1iZXJPcHMgPSBbICdlcScsICduZXEnLCAnZ3QnLCAnZ3RlJywgJ2x0JywgJ2x0ZScsICdiZXR3ZWVuJywgJ2V4aXN0cycsICdub3RFeGlzdHMnIF0gYXMgY29uc3Q7XG4gICAgICAgIGNvbnN0IG9wZXJhdG9ycyA9IG1lcmdlZENvbmZpZy5udW1iZXJGaWVsZHM/LmRlZmF1bHRPcGVyYXRvcnMgfHwgZGVmYXVsdE51bWJlck9wcztcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGZpbHRlclR5cGU6ICdudW1iZXInLFxuICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBvcGVyYXRvcnNbIDAgXSB8fCAoJ2VxJyksXG4gICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IG9wZXJhdG9yc1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vICoqNC4gUmVsYXRpb24gZmllbGRzICh3aXRob3V0IGV4cGxpY2l0IG9wdGlvbnMpIC0gYXV0by1nZW5lcmF0ZSBmcm9tIHJlbGF0aW9uIG1ldGFkYXRhKipcbiAgICBpZiAoYXR0cmlidXRlLnJlbGF0aW9uICYmIG1lcmdlZENvbmZpZy5yZWxhdGlvbkZpZWxkcz8uZW5hYmxlZCAhPT0gZmFsc2UgJiYgZW50aXR5U2VydmljZSkge1xuICAgICAgICBjb25zdCByZWxhdGlvbkNvbmZpZzogUmVsYXRpb25FbnRpdHlPcHRpb25Db25maWcgPSB7IGVudGl0eU5hbWU6IGF0dHJpYnV0ZS5yZWxhdGlvbi5lbnRpdHlOYW1lIH07XG4gICAgICAgIGNvbnN0IHJlc29sdmVkID0gcmVzb2x2ZVJlbGF0aW9uT3B0aW9uQ29uZmlnKFxuICAgICAgICAgICAgcmVsYXRpb25Db25maWcsXG4gICAgICAgICAgICBhdHRyaWJ1dGUgYXMgVElPU2NoZW1hQXR0cmlidXRlICYgeyByZWxhdGlvbjogTm9uTnVsbGFibGU8VElPU2NoZW1hQXR0cmlidXRlWyAncmVsYXRpb24nIF0+IH0sXG4gICAgICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuICAgICAgICAgICAgZ2xvYmFsVUlDb25maWdPcHRpb25zXG4gICAgICAgICk7XG5cbiAgICAgICAgaWYgKHJlc29sdmVkKSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIGZpbHRlclR5cGU6ICdyZWxhdGlvbicsXG4gICAgICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiAnZXEnIGFzIGNvbnN0LFxuICAgICAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogWyAnZXEnLCAnbmVxJywgJ2luTGlzdCcsICdub3RJbkxpc3QnLCAnZXhpc3RzJywgJ25vdEV4aXN0cycgXSxcbiAgICAgICAgICAgICAgICBwcmVkZWZpbmVkT3B0aW9uczogcmVzb2x2ZWRcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyAqKjYuIFRleHQgZmllbGRzIChkZWZhdWx0IGZhbGxiYWNrKSoqXG4gICAgaWYgKGF0dHJUeXBlID09PSAnc3RyaW5nJyAmJiBtZXJnZWRDb25maWcudGV4dEZpZWxkcz8uZW5hYmxlZCAhPT0gZmFsc2UpIHtcbiAgICAgICAgY29uc3QgZGVmYXVsdFRleHRPcHMgPSBbICdjb250YWlucycsICdub3RDb250YWlucycsICdlcScsICduZXEnLCAnc3RhcnRzV2l0aCcsICdlbmRzV2l0aCcsICdsaWtlJywgJ2V4aXN0cycsICdub3RFeGlzdHMnIF07XG4gICAgICAgIGNvbnN0IG9wZXJhdG9ycyA9IG1lcmdlZENvbmZpZy50ZXh0RmllbGRzPy5kZWZhdWx0T3BlcmF0b3JzIHx8IGRlZmF1bHRUZXh0T3BzO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZmlsdGVyVHlwZTogJ3RleHQnLFxuICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBvcGVyYXRvcnNbIDAgXSB8fCAoJ2NvbnRhaW5zJyksXG4gICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IG9wZXJhdG9yc1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vIERlYnVnIGxvZ2dpbmdcbiAgICBpZiAobWVyZ2VkQ29uZmlnLmRlYnVnKSB7XG4gICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW0ZpbHRlckF1dG9HZW5dICR7YXR0cmlidXRlLmlkfTogTm8gZmlsdGVyIGNvbmZpZyBnZW5lcmF0ZWQgKHR5cGU6ICR7YXR0clR5cGV9KWApO1xuICAgIH1cblxuICAgIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU0VHTUVOVCBBVVRPLUdFTkVSQVRJT05cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIFNtYXJ0IGljb24gbWFwcGluZyBmb3Igc2VnbWVudCB2YWx1ZXMuXG4gKiBQcm92aWRlcyBzZW5zaWJsZSBkZWZhdWx0cyBmb3IgY29tbW9uIHN0YXR1cy9zdGF0ZSBwYXR0ZXJucy5cbiAqIEljb25zIG1hdGNoIHVpMjQvc3JjL2NvcmUvY29tbW9uL0ljb25zL0ljb25zLnRzeCBuYW1pbmcgY29udmVudGlvbnMuXG4gKi9cbmNvbnN0IERFRkFVTFRfSUNPTl9NQVBQSU5HOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgIC8vIEFjdGl2ZS9JbmFjdGl2ZSBwYXR0ZXJuc1xuICAgICdhY3RpdmUnOiAnQ2hlY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2luYWN0aXZlJzogJ0Nsb3NlQ2lyY2xlT3V0bGluZWQnLFxuICAgICdlbmFibGVkJzogJ0NoZWNrQ2lyY2xlT3V0bGluZWQnLFxuICAgICdkaXNhYmxlZCc6ICdDbG9zZUNpcmNsZU91dGxpbmVkJyxcblxuICAgIC8vIFN0YXR1cyBwYXR0ZXJuc1xuICAgICdwZW5kaW5nJzogJ0Nsb2NrQ2lyY2xlT3V0bGluZWQnLFxuICAgICdpbi1wcm9ncmVzcyc6ICdTeW5jT3V0bGluZWQnLFxuICAgICdpbnByb2dyZXNzJzogJ1N5bmNPdXRsaW5lZCcsXG4gICAgJ2NvbXBsZXRlZCc6ICdDaGVja0NpcmNsZU91dGxpbmVkJyxcbiAgICAnZG9uZSc6ICdDaGVja091dGxpbmVkJyxcbiAgICAnZmluaXNoZWQnOiAnQ2hlY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2NhbmNlbGxlZCc6ICdDbG9zZUNpcmNsZU91dGxpbmVkJyxcbiAgICAnY2FuY2VsZWQnOiAnQ2xvc2VDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2ZhaWxlZCc6ICdDbG9zZUNpcmNsZU91dGxpbmVkJyxcbiAgICAnZXJyb3InOiAnRXhjbGFtYXRpb25DaXJjbGVPdXRsaW5lZCcsXG4gICAgJ3BhdXNlZCc6ICdQYXVzZUNpcmNsZU91dGxpbmVkJyxcblxuICAgIC8vIFNjaGVkdWxpbmcgcGF0dGVybnNcbiAgICAnc2NoZWR1bGVkJzogJ0NhbGVuZGFyT3V0bGluZWQnLFxuICAgICd1cGNvbWluZyc6ICdDYWxlbmRhck91dGxpbmVkJyxcbiAgICAnbGl2ZSc6ICdQbGF5Q2lyY2xlT3V0bGluZWQnLFxuICAgICdkcmFmdCc6ICdGaWxlT3V0bGluZWQnLFxuICAgICdwdWJsaXNoZWQnOiAnQ2hlY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2FyY2hpdmVkJzogJ0ZvbGRlck91dGxpbmVkJyxcblxuICAgIC8vIFByaW9yaXR5IHBhdHRlcm5zXG4gICAgJ2xvdyc6ICdEb3duT3V0bGluZWQnLFxuICAgICdtZWRpdW0nOiAnTWludXNPdXRsaW5lZCcsXG4gICAgJ2hpZ2gnOiAnVXBPdXRsaW5lZCcsXG4gICAgJ2NyaXRpY2FsJzogJ1dhcm5pbmdPdXRsaW5lZCcsXG4gICAgJ3VyZ2VudCc6ICdGaXJlT3V0bGluZWQnLFxuXG4gICAgLy8gQXBwcm92YWwgcGF0dGVybnNcbiAgICAnYXBwcm92ZWQnOiAnQ2hlY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ3JlamVjdGVkJzogJ0Nsb3NlQ2lyY2xlT3V0bGluZWQnLFxuICAgICdyZXZpZXcnOiAnRXllT3V0bGluZWQnLFxuXG4gICAgLy8gQm9vbGVhbiBUcnVlL0ZhbHNlXG4gICAgJ3RydWUnOiAnQ2hlY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2ZhbHNlJzogJ0Nsb3NlQ2lyY2xlT3V0bGluZWQnXG59O1xuXG4vKipcbiAqIEludGVsbGlnZW50bHkgZXh0cmFjdCBib29sZWFuIGxhYmVscyBmcm9tIGZpZWxkIG5hbWUgcGF0dGVybnMuXG4gKiBTdXBwb3J0cyBjb21tb24gYm9vbGVhbiBwcmVmaXhlcyBsaWtlIGlzL2hhcy9jYW4vc2hvdWxkL3dpbGwvZXRjLlxuICogXG4gKiBAZXhhbXBsZVxuICogLSBpc0FjdGl2ZSDihpIgXCJBY3RpdmVcIiAvIFwiSW5hY3RpdmVcIlxuICogLSBoYXNQZXJtaXNzaW9uIOKGkiBcIkhhcyBQZXJtaXNzaW9uXCIgLyBcIk5vIFBlcm1pc3Npb25cIlxuICogLSBjYW5FZGl0IOKGkiBcIkNhbiBFZGl0XCIgLyBcIkNhbm5vdCBFZGl0XCJcbiAqIC0gaXNMaXZlIOKGkiBcIkxpdmVcIiAvIFwiTm90IExpdmVcIlxuICogLSBzaG91bGROb3RpZnkg4oaSIFwiU2hvdWxkIE5vdGlmeVwiIC8gXCJTaG91bGQgTm90IE5vdGlmeVwiXG4gKi9cbmZ1bmN0aW9uIGV4dHJhY3RCb29sZWFuTGFiZWxzRnJvbUZpZWxkTmFtZShmaWVsZE5hbWU6IHN0cmluZyk6IHsgdHJ1ZUxhYmVsOiBzdHJpbmc7IGZhbHNlTGFiZWw6IHN0cmluZyB9IHwgbnVsbCB7XG4gICAgLy8gQ29tbW9uIGJvb2xlYW4gcHJlZml4ZXMgd2l0aCB0aGVpciBuZWdhdGl2ZSBmb3Jtc1xuICAgIGNvbnN0IHBhdHRlcm5zID0gW1xuICAgICAgICAvLyBQYXR0ZXJuOiBpcyArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL15pcyhbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IHRvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSksXG4gICAgICAgICAgICBnZXRGYWxzZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBiYXNlID0gdG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKTtcbiAgICAgICAgICAgICAgICAvLyBTcGVjaWFsIGNhc2VzIGZvciBiZXR0ZXIgbmVnYXRpb25cbiAgICAgICAgICAgICAgICBpZiAoYmFzZS50b0xvd2VyQ2FzZSgpID09PSAnYWN0aXZlJykgcmV0dXJuICdJbmFjdGl2ZSc7XG4gICAgICAgICAgICAgICAgaWYgKGJhc2UudG9Mb3dlckNhc2UoKSA9PT0gJ2VuYWJsZWQnKSByZXR1cm4gJ0Rpc2FibGVkJztcbiAgICAgICAgICAgICAgICBpZiAoYmFzZS50b0xvd2VyQ2FzZSgpID09PSAndmlzaWJsZScpIHJldHVybiAnSGlkZGVuJztcbiAgICAgICAgICAgICAgICBpZiAoYmFzZS50b0xvd2VyQ2FzZSgpID09PSAncHVibGljJykgcmV0dXJuICdQcml2YXRlJztcbiAgICAgICAgICAgICAgICBpZiAoYmFzZS50b0xvd2VyQ2FzZSgpID09PSAnYXZhaWxhYmxlJykgcmV0dXJuICdVbmF2YWlsYWJsZSc7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGBOb3QgJHtiYXNlfWA7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBhdHRlcm46IGhhcyArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL15oYXMoW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgSGFzICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gLFxuICAgICAgICAgICAgZ2V0RmFsc2VMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgTm8gJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWBcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGF0dGVybjogY2FuICsgWFhYXG4gICAgICAgIHtcbiAgICAgICAgICAgIHJlZ2V4OiAvXmNhbihbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBDYW4gJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWAsXG4gICAgICAgICAgICBnZXRGYWxzZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBDYW5ub3QgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWBcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGF0dGVybjogc2hvdWxkICsgWFhYXG4gICAgICAgIHtcbiAgICAgICAgICAgIHJlZ2V4OiAvXnNob3VsZChbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBTaG91bGQgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWAsXG4gICAgICAgICAgICBnZXRGYWxzZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBTaG91bGQgTm90ICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBhdHRlcm46IHdpbGwgKyBYWFhcbiAgICAgICAge1xuICAgICAgICAgICAgcmVnZXg6IC9ed2lsbChbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBXaWxsICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gLFxuICAgICAgICAgICAgZ2V0RmFsc2VMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgV2lsbCBOb3QgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWBcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGF0dGVybjogYWxsb3dzICsgWFhYXG4gICAgICAgIHtcbiAgICAgICAgICAgIHJlZ2V4OiAvXmFsbG93cyhbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBBbGxvd3MgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWAsXG4gICAgICAgICAgICBnZXRGYWxzZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBEb2VzIE5vdCBBbGxvdyAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSl9YFxuICAgICAgICB9LFxuICAgICAgICAvLyBQYXR0ZXJuOiBuZWVkcyArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL15uZWVkcyhbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBOZWVkcyAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSl9YCxcbiAgICAgICAgICAgIGdldEZhbHNlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYERvZXMgTm90IE5lZWQgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWBcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGF0dGVybjogcmVxdWlyZXMgKyBYWFhcbiAgICAgICAge1xuICAgICAgICAgICAgcmVnZXg6IC9ecmVxdWlyZXMoW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgUmVxdWlyZXMgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWAsXG4gICAgICAgICAgICBnZXRGYWxzZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBEb2VzIE5vdCBSZXF1aXJlICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gXG4gICAgICAgIH1cbiAgICBdO1xuXG4gICAgZm9yIChjb25zdCBwYXR0ZXJuIG9mIHBhdHRlcm5zKSB7XG4gICAgICAgIGNvbnN0IG1hdGNoID0gZmllbGROYW1lLm1hdGNoKHBhdHRlcm4ucmVnZXgpO1xuICAgICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdHJ1ZUxhYmVsOiBwYXR0ZXJuLmdldFRydWVMYWJlbChtYXRjaCksXG4gICAgICAgICAgICAgICAgZmFsc2VMYWJlbDogcGF0dGVybi5nZXRGYWxzZUxhYmVsKG1hdGNoKVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIEdldCB0aGUgbnVtYmVyIG9mIG9wdGlvbnMgZm9yIGEgZmllbGQuXG4gKi9cbmZ1bmN0aW9uIGdldEZpZWxkT3B0aW9uQ291bnQoZmllbGQ6IFRJT1NjaGVtYUF0dHJpYnV0ZSk6IG51bWJlciB7XG4gICAgLy8gMS4gRW51bSB0eXBlIGFycmF5XG4gICAgaWYgKEFycmF5LmlzQXJyYXkoZmllbGQudHlwZSkpIHtcbiAgICAgICAgcmV0dXJuIGZpZWxkLnR5cGUubGVuZ3RoO1xuICAgIH1cblxuICAgIC8vIDIuIEJvb2xlYW4gZmllbGRcbiAgICBpZiAoZmllbGQudHlwZSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgIHJldHVybiAyO1xuICAgIH1cblxuICAgIC8vIDMuIFNlbGVjdC9yYWRpby9jaGVja2JveCBmaWVsZCB3aXRoIGlubGluZSBvcHRpb25zXG4gICAgY29uc3QgZmllbGRUeXBlID0gZmllbGQuZmllbGRUeXBlO1xuICAgIGlmIChmaWVsZFR5cGUgPT09ICdzZWxlY3QnIHx8IGZpZWxkVHlwZSA9PT0gJ3JhZGlvJyB8fCBmaWVsZFR5cGUgPT09ICdjaGVja2JveCcgfHwgZmllbGRUeXBlID09PSAnbXVsdGktc2VsZWN0Jykge1xuICAgICAgICBjb25zdCBvcHRpb25zID0gKGZpZWxkIGFzIGFueSkub3B0aW9ucztcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkob3B0aW9ucykpIHtcbiAgICAgICAgICAgIHJldHVybiBvcHRpb25zLmxlbmd0aDtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiAwO1xufVxuXG4vKipcbiAqIENoZWNrIGlmIGEgZmllbGQgaXMgdmlhYmxlIGZvciBzZWdtZW50IGdlbmVyYXRpb24uXG4gKiBTdXBwb3J0czpcbiAqIC0gRW51bSB0eXBlczogdHlwZTogWyd2YWx1ZTEnLCAndmFsdWUyJ11cbiAqIC0gQm9vbGVhbiB0eXBlczogdHlwZTogJ2Jvb2xlYW4nXG4gKiAtIFNlbGVjdC9yYWRpby9jaGVja2JveCBmaWVsZHMgd2l0aCBvcHRpb25zOiBmaWVsZFR5cGU6ICdzZWxlY3QnICsgb3B0aW9uczogWy4uLl1cbiAqIFxuICogU1RSSUNUTFkgZW5mb3JjZXM6IG1pblZhbHVlcyA8PSBvcHRpb25Db3VudCA8PSBtYXhTZWdtZW50c1Blckdyb3VwXG4gKi9cbmZ1bmN0aW9uIGlzVmlhYmxlU2VnbWVudEZpZWxkKFxuICAgIGZpZWxkOiBUSU9TY2hlbWFBdHRyaWJ1dGUsXG4gICAgY29uZmlnOiBSZXF1aXJlZDxJU2VnbWVudEF1dG9HZW5lcmF0aW9uQ29uZmlnPiAmIHsgbWF4U2VnbWVudHNQZXJHcm91cD86IG51bWJlciB9XG4pOiBib29sZWFuIHtcbiAgICBjb25zdCBtYXhWYWx1ZXMgPSBjb25maWcubWF4U2VnbWVudHNQZXJHcm91cCB8fCAxMDtcbiAgICBjb25zdCBvcHRpb25Db3VudCA9IGdldEZpZWxkT3B0aW9uQ291bnQoZmllbGQpO1xuXG4gICAgLy8gTXVzdCBoYXZlIG9wdGlvbnMgQU5EIGJlIHdpdGhpbiBib3VuZHNcbiAgICBpZiAob3B0aW9uQ291bnQgPT09IDApIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIC8vIFNUUklDVDogUmVqZWN0IGlmIG91dHNpZGUgYm91bmRzXG4gICAgcmV0dXJuIG9wdGlvbkNvdW50ID49IGNvbmZpZy5taW5WYWx1ZXMgJiYgb3B0aW9uQ291bnQgPD0gbWF4VmFsdWVzO1xufVxuXG4vKipcbiAqIEludGVsbGlnZW50bHkgZGV0ZWN0IHRoZSBiZXN0IGZpZWxkKHMpIGZvciBnZW5lcmF0aW5nIHNlZ21lbnRzLlxuICogUmV0dXJucyBtdWx0aXBsZSBmaWVsZHMgaWYgbWF4U2VnbWVudEdyb3VwcyA+IDEuXG4gKiBcbiAqIFByaW9yaXR5OlxuICogMS4gRXhwbGljaXQgc2VnbWVudEZpZWxkcyAoZW50aXR5IGNvbmZpZykg4oaSIFVzZSB0aG9zZSBmaWVsZHNcbiAqIDIuIGluY2x1ZGVGaWVsZHMgZmlsdGVyIChlbnRpdHkgY29uZmlnKSDihpIgT25seSBjb25zaWRlciB0aGVzZVxuICogMy4gZXhjbHVkZUZpZWxkcyBmaWx0ZXIgKGVudGl0eSBjb25maWcpIOKGkiBTa2lwIHRoZXNlXG4gKiA0LiBwcmVmZXJyZWRGaWVsZHMgKGdsb2JhbC9lbnRpdHkgY29uZmlnKSDihpIgVHJ5IHRoZXNlIGZpcnN0XG4gKiA1LiBTY29yaW5nIGFsZ29yaXRobSDihpIgU2NvcmUgYWxsIGNhbmRpZGF0ZXMgYW5kIHBpY2sgdG9wIE5cbiAqL1xuZnVuY3Rpb24gZGV0ZWN0U2VnbWVudEZpZWxkczxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPHN0cmluZywgc3RyaW5nLCBzdHJpbmc+PihcbiAgICBwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+LFxuICAgIGdsb2JhbENvbmZpZz86IElTZWdtZW50QXV0b0dlbmVyYXRpb25Db25maWcsXG4gICAgZW50aXR5Q29uZmlnPzogTm9uTnVsbGFibGU8UmV0dXJuVHlwZTx0eXBlb2YgQmFzZUVudGl0eVNlcnZpY2UucHJvdG90eXBlLmdldEVudGl0eVNjaGVtYT5bICdtb2RlbCcgXVsgJ21ldGFkYXRhJyBdPlsgJ3RhYmxlVUknIF1cbik6IEFycmF5PHsgZmllbGQ6IFRJT1NjaGVtYUF0dHJpYnV0ZTsgc2NvcmU6IG51bWJlcjsgcmVhc29uOiBzdHJpbmcgfT4ge1xuICAgIGNvbnN0IHNlZ21lbnRDb25maWcgPSBlbnRpdHlDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbjtcblxuICAgIC8vIE1lcmdlIGNvbmZpZ3MgKGVudGl0eSA+IGdsb2JhbCA+IGRlZmF1bHRzKVxuICAgIGNvbnN0IG1lcmdlZENvbmZpZzogUmVxdWlyZWQ8SVNlZ21lbnRBdXRvR2VuZXJhdGlvbkNvbmZpZz4gJiB7IG1heFNlZ21lbnRHcm91cHM6IG51bWJlcjsgbWF4U2VnbWVudHNQZXJHcm91cDogbnVtYmVyIH0gPSB7XG4gICAgICAgIGVuYWJsZWQ6IHNlZ21lbnRDb25maWc/LmVuYWJsZWQgPz8gZ2xvYmFsQ29uZmlnPy5lbmFibGVkID8/IHRydWUsXG4gICAgICAgIHByZWZlcnJlZEZpZWxkczogc2VnbWVudENvbmZpZz8ucHJlZmVycmVkRmllbGRzIHx8IGdsb2JhbENvbmZpZz8ucHJlZmVycmVkRmllbGRzIHx8IFsgJ3N0YXR1cycsICdzdGF0ZScsICd0eXBlJywgJ2NhdGVnb3J5JywgJ3ByaW9yaXR5JyBdLFxuICAgICAgICBtYXhTZWdtZW50R3JvdXBzOiBzZWdtZW50Q29uZmlnPy5tYXhTZWdtZW50R3JvdXBzID8/IGdsb2JhbENvbmZpZz8ubWF4U2VnbWVudEdyb3VwcyA/PyAyLFxuICAgICAgICBtYXhTZWdtZW50c1Blckdyb3VwOiBzZWdtZW50Q29uZmlnPy5tYXhTZWdtZW50c1Blckdyb3VwID8/IGdsb2JhbENvbmZpZz8ubWF4U2VnbWVudHNQZXJHcm91cCA/PyAxMCxcbiAgICAgICAgbWluVmFsdWVzOiBzZWdtZW50Q29uZmlnPy5taW5WYWx1ZXMgPz8gZ2xvYmFsQ29uZmlnPy5taW5WYWx1ZXMgPz8gMixcbiAgICAgICAgaWNvbk1hcHBpbmc6IHsgLi4uREVGQVVMVF9JQ09OX01BUFBJTkcsIC4uLmdsb2JhbENvbmZpZz8uaWNvbk1hcHBpbmcsIC4uLnNlZ21lbnRDb25maWc/Lmljb25NYXBwaW5nIH0sXG4gICAgICAgIGJvb2xlYW5MYWJlbFBhdHRlcm5zOiBzZWdtZW50Q29uZmlnPy5ib29sZWFuTGFiZWxQYXR0ZXJucyB8fCBnbG9iYWxDb25maWc/LmJvb2xlYW5MYWJlbFBhdHRlcm5zIHx8IFtdLFxuICAgICAgICBkZWZhdWx0Qm9vbGVhbkxhYmVsczogc2VnbWVudENvbmZpZz8uZGVmYXVsdEJvb2xlYW5MYWJlbHMgfHwgZ2xvYmFsQ29uZmlnPy5kZWZhdWx0Qm9vbGVhbkxhYmVscyB8fCB7IHRydWU6ICdZZXMnLCBmYWxzZTogJ05vJyB9LFxuICAgICAgICBpbmNsdWRlQWxsU2VnbWVudDogc2VnbWVudENvbmZpZz8uaW5jbHVkZUFsbFNlZ21lbnQgPz8gZ2xvYmFsQ29uZmlnPy5pbmNsdWRlQWxsU2VnbWVudCA/PyB0cnVlLFxuICAgICAgICBkZWJ1Zzogc2VnbWVudENvbmZpZz8uZGVidWcgPz8gZ2xvYmFsQ29uZmlnPy5kZWJ1ZyA/PyBmYWxzZVxuICAgIH07XG5cbiAgICBpZiAoIW1lcmdlZENvbmZpZy5lbmFibGVkKSB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICAvLyA9PT0gUFJJT1JJVFkgMTogRXhwbGljaXQgc2VnbWVudCBmaWVsZHMgPT09XG4gICAgY29uc3QgZXhwbGljaXRGaWVsZHMgPSBzZWdtZW50Q29uZmlnPy5zZWdtZW50RmllbGRzIHx8IHNlZ21lbnRDb25maWc/LnNlZ21lbnRGaWVsZDtcbiAgICBpZiAoZXhwbGljaXRGaWVsZHMpIHtcbiAgICAgICAgY29uc3QgZmllbGROYW1lcyA9IHR5cGVvZiBleHBsaWNpdEZpZWxkcyA9PT0gJ3N0cmluZycgPyBbIGV4cGxpY2l0RmllbGRzIF0gOiBleHBsaWNpdEZpZWxkcztcbiAgICAgICAgY29uc3QgcmVzdWx0czogQXJyYXk8eyBmaWVsZDogVElPU2NoZW1hQXR0cmlidXRlOyBzY29yZTogbnVtYmVyOyByZWFzb246IHN0cmluZyB9PiA9IFtdO1xuXG4gICAgICAgIGZvciAoY29uc3QgZmllbGROYW1lIG9mIGZpZWxkTmFtZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGZpZWxkID0gQXJyYXkuZnJvbShwcm9wZXJ0aWVzLnZhbHVlcygpKS5maW5kKHAgPT4gcC5pZCA9PT0gZmllbGROYW1lKTtcbiAgICAgICAgICAgIGlmIChmaWVsZCkge1xuICAgICAgICAgICAgICAgIHJlc3VsdHMucHVzaCh7IGZpZWxkLCBzY29yZTogMTAwMCwgcmVhc29uOiAnZXhwbGljaXQgY29uZmlndXJhdGlvbicgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocmVzdWx0cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0cy5zbGljZSgwLCBtZXJnZWRDb25maWcubWF4U2VnbWVudEdyb3Vwcyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyA9PT0gRmlsdGVyIHByb3BlcnRpZXMgYmFzZWQgb24gaW5jbHVkZS9leGNsdWRlID09PVxuICAgIGxldCBjYW5kaWRhdGVQcm9wZXJ0aWVzID0gQXJyYXkuZnJvbShwcm9wZXJ0aWVzLnZhbHVlcygpKTtcblxuICAgIC8vIEFwcGx5IGluY2x1ZGVGaWVsZHMgZmlsdGVyIChpZiBwcm92aWRlZCwgT05MWSBjb25zaWRlciB0aGVzZSlcbiAgICBpZiAoc2VnbWVudENvbmZpZz8uaW5jbHVkZUZpZWxkcyAmJiBzZWdtZW50Q29uZmlnLmluY2x1ZGVGaWVsZHMubGVuZ3RoID4gMCkge1xuICAgICAgICBjYW5kaWRhdGVQcm9wZXJ0aWVzID0gY2FuZGlkYXRlUHJvcGVydGllcy5maWx0ZXIocCA9PlxuICAgICAgICAgICAgc2VnbWVudENvbmZpZy5pbmNsdWRlRmllbGRzIS5pbmNsdWRlcyhwLmlkKVxuICAgICAgICApO1xuICAgIH1cblxuICAgIC8vIEFwcGx5IGV4Y2x1ZGVGaWVsZHMgZmlsdGVyXG4gICAgaWYgKHNlZ21lbnRDb25maWc/LmV4Y2x1ZGVGaWVsZHMgJiYgc2VnbWVudENvbmZpZy5leGNsdWRlRmllbGRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY2FuZGlkYXRlUHJvcGVydGllcyA9IGNhbmRpZGF0ZVByb3BlcnRpZXMuZmlsdGVyKHAgPT5cbiAgICAgICAgICAgICFzZWdtZW50Q29uZmlnLmV4Y2x1ZGVGaWVsZHMhLmluY2x1ZGVzKHAuaWQpXG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gPT09IFBSSU9SSVRZIDI6IFByZWZlcnJlZCBmaWVsZHMgPT09XG4gICAgY29uc3QgcHJlZmVycmVkRmllbGRzID0gbWVyZ2VkQ29uZmlnLnByZWZlcnJlZEZpZWxkcztcbiAgICBjb25zdCBwcmVmZXJyZWRNYXRjaGVzOiBBcnJheTx7IGZpZWxkOiBUSU9TY2hlbWFBdHRyaWJ1dGU7IHNjb3JlOiBudW1iZXI7IHJlYXNvbjogc3RyaW5nIH0+ID0gW107XG5cbiAgICBmb3IgKGNvbnN0IHByZWZlcnJlZE5hbWUgb2YgcHJlZmVycmVkRmllbGRzKSB7XG4gICAgICAgIGNvbnN0IGZpZWxkID0gY2FuZGlkYXRlUHJvcGVydGllcy5maW5kKHAgPT4gcC5pZCA9PT0gcHJlZmVycmVkTmFtZSk7XG4gICAgICAgIGlmIChmaWVsZCAmJiBpc1ZpYWJsZVNlZ21lbnRGaWVsZChmaWVsZCwgbWVyZ2VkQ29uZmlnKSkge1xuICAgICAgICAgICAgcHJlZmVycmVkTWF0Y2hlcy5wdXNoKHsgZmllbGQsIHNjb3JlOiA5MDAsIHJlYXNvbjogYHByZWZlcnJlZCBmaWVsZDogJHtwcmVmZXJyZWROYW1lfWAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBJZiB3ZSBoYXZlIGVub3VnaCBwcmVmZXJyZWQgbWF0Y2hlcywgcmV0dXJuIHRoZW1cbiAgICBpZiAocHJlZmVycmVkTWF0Y2hlcy5sZW5ndGggPj0gbWVyZ2VkQ29uZmlnLm1heFNlZ21lbnRHcm91cHMpIHtcbiAgICAgICAgcmV0dXJuIHByZWZlcnJlZE1hdGNoZXMuc2xpY2UoMCwgbWVyZ2VkQ29uZmlnLm1heFNlZ21lbnRHcm91cHMpO1xuICAgIH1cblxuICAgIC8vID09PSBQUklPUklUWSAzOiBTY29yaW5nIGFsZ29yaXRobSA9PT1cbiAgICBjb25zdCBjYW5kaWRhdGVzOiBBcnJheTx7IGZpZWxkOiBUSU9TY2hlbWFBdHRyaWJ1dGU7IHNjb3JlOiBudW1iZXI7IHJlYXNvbjogc3RyaW5nOyBvcHRpb25Db3VudDogbnVtYmVyIH0+ID0gW107XG5cbiAgICAvLyBBZGQgcHJlZmVycmVkTWF0Y2hlcyB3aXRoIHRoZWlyIG9wdGlvbiBjb3VudHNcbiAgICBmb3IgKGNvbnN0IHBtIG9mIHByZWZlcnJlZE1hdGNoZXMpIHtcbiAgICAgICAgY29uc3Qgb3B0aW9uQ291bnQgPSBnZXRGaWVsZE9wdGlvbkNvdW50KHBtLmZpZWxkKTtcbiAgICAgICAgY2FuZGlkYXRlcy5wdXNoKHsgLi4ucG0sIG9wdGlvbkNvdW50IH0pO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgcHJvcCBvZiBjYW5kaWRhdGVQcm9wZXJ0aWVzKSB7XG4gICAgICAgIC8vIFNraXAgaWYgYWxyZWFkeSBpbiBwcmVmZXJyZWRNYXRjaGVzXG4gICAgICAgIGlmIChwcmVmZXJyZWRNYXRjaGVzLnNvbWUocG0gPT4gcG0uZmllbGQuaWQgPT09IHByb3AuaWQpKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNraXAgaWYgbm90IHZpYWJsZSAodGhpcyBmaWx0ZXJzIG91dCBmaWVsZHMgd2l0aCB0b28gbWFueSBvcHRpb25zKVxuICAgICAgICBpZiAoIWlzVmlhYmxlU2VnbWVudEZpZWxkKHByb3AsIG1lcmdlZENvbmZpZykpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IHNjb3JlID0gMDtcbiAgICAgICAgY29uc3QgcmVhc29uczogc3RyaW5nW10gPSBbXTtcbiAgICAgICAgY29uc3Qgb3B0aW9uQ291bnQgPSBnZXRGaWVsZE9wdGlvbkNvdW50KHByb3ApO1xuXG4gICAgICAgIC8vICoqU2NvcmUgMTogRmllbGQgbmFtZSBtYXRjaCoqIChwYXJ0aWFsIG1hdGNoIHdpdGggcHJlZmVycmVkIG5hbWVzKVxuICAgICAgICBmb3IgKGNvbnN0IHByZWZlcnJlZCBvZiBwcmVmZXJyZWRGaWVsZHMpIHtcbiAgICAgICAgICAgIGlmIChwcm9wLmlkLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocHJlZmVycmVkLnRvTG93ZXJDYXNlKCkpKSB7XG4gICAgICAgICAgICAgICAgc2NvcmUgKz0gNTA7XG4gICAgICAgICAgICAgICAgcmVhc29ucy5wdXNoKGBuYW1lIGNvbnRhaW5zIFwiJHtwcmVmZXJyZWR9XCJgKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vICoqU2NvcmUgMjogUHJlZmVyIGZld2VyIG9wdGlvbnMgKGludmVyc2Ugc2NvcmluZykqKlxuICAgICAgICAvLyBGaWVsZHMgd2l0aCBmZXdlciBvcHRpb25zIGdldCBoaWdoZXIgc2NvcmVzXG4gICAgICAgIGNvbnN0IG1pblZhbHVlcyA9IG1lcmdlZENvbmZpZy5taW5WYWx1ZXM7XG4gICAgICAgIGNvbnN0IG1heFZhbHVlcyA9IG1lcmdlZENvbmZpZy5tYXhTZWdtZW50c1Blckdyb3VwO1xuXG4gICAgICAgIGlmIChvcHRpb25Db3VudCA+PSBtaW5WYWx1ZXMgJiYgb3B0aW9uQ291bnQgPD0gbWF4VmFsdWVzKSB7XG4gICAgICAgICAgICAvLyBTY29yZSBpbnZlcnNlbHkgcHJvcG9ydGlvbmFsIHRvIG9wdGlvbiBjb3VudFxuICAgICAgICAgICAgLy8gMiBvcHRpb25zID0gKzQwLCA1IG9wdGlvbnMgPSArMjUsIDEwIG9wdGlvbnMgPSArMTBcbiAgICAgICAgICAgIGNvbnN0IG9wdGlvblNjb3JlID0gTWF0aC5tYXgoMTAsIDQwIC0gKG9wdGlvbkNvdW50IC0gbWluVmFsdWVzKSAqIDMpO1xuICAgICAgICAgICAgc2NvcmUgKz0gb3B0aW9uU2NvcmU7XG4gICAgICAgICAgICByZWFzb25zLnB1c2goYCR7b3B0aW9uQ291bnR9IG9wdGlvbnNgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vICoqU2NvcmUgMzogQm9vbGVhbiBmaWVsZCBnZXRzIGhpZ2ggcHJpb3JpdHkgKG9ubHkgMiBvcHRpb25zKSoqXG4gICAgICAgIGlmIChwcm9wLnR5cGUgPT09ICdib29sZWFuJykge1xuICAgICAgICAgICAgc2NvcmUgKz0gNTsgIC8vIFNtYWxsIGJvbnVzIHNpbmNlIG9wdGlvbiBjb3VudCBhbHJlYWR5IGZhY3RvcnMgaW5cbiAgICAgICAgICAgIHJlYXNvbnMucHVzaCgnYm9vbGVhbiBmaWVsZCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gKipTY29yZSA0OiBOYW1lIHBvc2l0aW9uIChlYXJsaWVyID0gc2xpZ2h0bHkgaGlnaGVyIHByaW9yaXR5KSoqXG4gICAgICAgIGNvbnN0IGZpZWxkSW5kZXggPSBjYW5kaWRhdGVQcm9wZXJ0aWVzLmluZGV4T2YocHJvcCk7XG4gICAgICAgIHNjb3JlIC09IE1hdGgubWluKGZpZWxkSW5kZXgsIDUpOyAgLy8gQ2FwIHBlbmFsdHkgYXQgNVxuXG4gICAgICAgIGNhbmRpZGF0ZXMucHVzaCh7XG4gICAgICAgICAgICBmaWVsZDogcHJvcCxcbiAgICAgICAgICAgIHNjb3JlLFxuICAgICAgICAgICAgcmVhc29uOiByZWFzb25zLmpvaW4oJywgJyksXG4gICAgICAgICAgICBvcHRpb25Db3VudFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBTb3J0IGJ5OiAxKSBzY29yZSAoaGlnaGVzdCBmaXJzdCksIDIpIG9wdGlvbiBjb3VudCAobG93ZXN0IGZpcnN0KVxuICAgIGNhbmRpZGF0ZXMuc29ydCgoYSwgYikgPT4ge1xuICAgICAgICBpZiAoYi5zY29yZSAhPT0gYS5zY29yZSkge1xuICAgICAgICAgICAgcmV0dXJuIGIuc2NvcmUgLSBhLnNjb3JlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBhLm9wdGlvbkNvdW50IC0gYi5vcHRpb25Db3VudDsgIC8vIFByZWZlciBmZXdlciBvcHRpb25zXG4gICAgfSk7XG5cbiAgICBjb25zdCB0b3BOUmVzdWx0cyA9IGNhbmRpZGF0ZXMuc2xpY2UoMCwgbWVyZ2VkQ29uZmlnLm1heFNlZ21lbnRHcm91cHMpO1xuXG4gICAgaWYgKHRvcE5SZXN1bHRzLmxlbmd0aCA+IDAgJiYgbWVyZ2VkQ29uZmlnLmRlYnVnKSB7XG4gICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW1NlZ21lbnREZXRlY3Rpb25dIFNlbGVjdGVkICR7dG9wTlJlc3VsdHMubGVuZ3RofSBmaWVsZChzKTpgLCB0b3BOUmVzdWx0cy5tYXAoYyA9PiAoe1xuICAgICAgICAgICAgZmllbGQ6IGMuZmllbGQuaWQsXG4gICAgICAgICAgICBzY29yZTogYy5zY29yZSxcbiAgICAgICAgICAgIG9wdGlvbkNvdW50OiBjLm9wdGlvbkNvdW50LFxuICAgICAgICAgICAgcmVhc29uOiBjLnJlYXNvblxuICAgICAgICB9KSkpO1xuICAgIH1cblxuICAgIHJldHVybiB0b3BOUmVzdWx0cztcbn1cblxuLyoqXG4gKiBBdXRvLWdlbmVyYXRlIGZpbHRlciBzZWdtZW50cyBiYXNlZCBvbiBlbnRpdHkgYXR0cmlidXRlcyB1c2luZyBzbWFydCBkZXRlY3Rpb24uXG4gKiBcbiAqIEFsZ29yaXRobTpcbiAqIDEuIElmIGN1c3RvbSBzZWdtZW50cyBwcm92aWRlZCDihpIgdXNlIHRoZW0gKGhpZ2hlc3QgcHJpb3JpdHkpXG4gKiAyLiBJZiBlbnRpdHkgcmVxdWlyZXMgbWFudWFsIHNlZ21lbnRzIOKGkiBza2lwIGF1dG8tZ2VuZXJhdGlvblxuICogMy4gRGV0ZWN0IGJlc3QgZmllbGQgdXNpbmcgc2NvcmluZyBhbGdvcml0aG1cbiAqIDQuIEdlbmVyYXRlIHNlZ21lbnRzIGZyb20gZGV0ZWN0ZWQgZmllbGQgd2l0aCBzbWFydCBpY29uc1xuICovXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVTZWdtZW50czxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPHN0cmluZywgc3RyaW5nLCBzdHJpbmc+PihcbiAgICBwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+LFxuICAgIGVudGl0eVNlcnZpY2U/OiBCYXNlRW50aXR5U2VydmljZTxTPixcbiAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbICd1aUNvbmZpZ0dlbk9wdGlvbnMnIF0sXG4gICAgY3VzdG9tU2VnbWVudHM/OiBSZWFkb25seUFycmF5PElGaWx0ZXJTZWdtZW50IHwgSUZpbHRlclNlZ21lbnRHcm91cD4gfCBBcnJheTxJRmlsdGVyU2VnbWVudCB8IElGaWx0ZXJTZWdtZW50R3JvdXA+XG4pOiBSZWFkb25seUFycmF5PElGaWx0ZXJTZWdtZW50IHwgSUZpbHRlclNlZ21lbnRHcm91cD4gfCBBcnJheTxJRmlsdGVyU2VnbWVudCB8IElGaWx0ZXJTZWdtZW50R3JvdXA+IHwgdW5kZWZpbmVkIHtcbiAgICAvLyAxLiBJZiBjdXN0b20gc2VnbWVudHMgcHJvdmlkZWQsIHVzZSB0aG9zZSAoaGlnaGVzdCBwcmlvcml0eSlcbiAgICBpZiAoY3VzdG9tU2VnbWVudHMgJiYgY3VzdG9tU2VnbWVudHMubGVuZ3RoID4gMCkge1xuICAgICAgICByZXR1cm4gY3VzdG9tU2VnbWVudHM7XG4gICAgfVxuXG4gICAgLy8gR2V0IGNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCBnbG9iYWxTZWdtZW50Q29uZmlnID0gZ2xvYmFsVUlDb25maWdPcHRpb25zPy50YWJsZVVJPy5zZWdtZW50QXV0b0dlbmVyYXRpb247XG4gICAgY29uc3QgZW50aXR5TWV0YWRhdGEgPSBlbnRpdHlTZXJ2aWNlPy5nZXRFbnRpdHlTY2hlbWE/LigpLm1vZGVsPy5tZXRhZGF0YTtcbiAgICBjb25zdCBlbnRpdHlTZWdtZW50Q29uZmlnID0gZW50aXR5TWV0YWRhdGE/LnRhYmxlVUk7XG5cbiAgICAvLyAyLiBJZiBlbnRpdHkgcmVxdWlyZXMgbWFudWFsIHNlZ21lbnRzLCBza2lwIGF1dG8tZ2VuZXJhdGlvblxuICAgIGlmIChlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LnJlcXVpcmVNYW51YWwpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyAzLiBEZXRlY3QgYmVzdCBzZWdtZW50IGZpZWxkcyAocmV0dXJucyBhcnJheSBub3cpXG4gICAgY29uc3QgZGV0ZWN0ZWRGaWVsZHMgPSBkZXRlY3RTZWdtZW50RmllbGRzKHByb3BlcnRpZXMsIGdsb2JhbFNlZ21lbnRDb25maWcsIGVudGl0eVNlZ21lbnRDb25maWcpO1xuXG4gICAgaWYgKGRldGVjdGVkRmllbGRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAvLyBObyBzdWl0YWJsZSBmaWVsZHMgZm91bmRcbiAgICAgICAgaWYgKGdsb2JhbFNlZ21lbnRDb25maWc/LmRlYnVnIHx8IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uZGVidWcpIHtcbiAgICAgICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW1NlZ21lbnRHZW5lcmF0aW9uXSBObyBzdWl0YWJsZSBmaWVsZHMgZGV0ZWN0ZWQgZm9yIHNlZ21lbnRzYCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyBHZXQgbWVyZ2VkIGNvbmZpZyBmb3IgdGhpcyBlbnRpdHlcbiAgICBjb25zdCBtZXJnZWRDb25maWc6IFJlcXVpcmVkPElTZWdtZW50QXV0b0dlbmVyYXRpb25Db25maWc+ICYgeyBtYXhTZWdtZW50R3JvdXBzOiBudW1iZXI7IG1heFNlZ21lbnRzUGVyR3JvdXA6IG51bWJlciB9ID0ge1xuICAgICAgICBlbmFibGVkOiBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmVuYWJsZWQgPz8gZ2xvYmFsU2VnbWVudENvbmZpZz8uZW5hYmxlZCA/PyB0cnVlLFxuICAgICAgICBwcmVmZXJyZWRGaWVsZHM6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8ucHJlZmVycmVkRmllbGRzIHx8IGdsb2JhbFNlZ21lbnRDb25maWc/LnByZWZlcnJlZEZpZWxkcyB8fCBbICdzdGF0dXMnLCAnc3RhdGUnLCAndHlwZScsICdjYXRlZ29yeScsICdwcmlvcml0eScgXSxcbiAgICAgICAgbWF4U2VnbWVudEdyb3VwczogZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5tYXhTZWdtZW50R3JvdXBzID8/IGdsb2JhbFNlZ21lbnRDb25maWc/Lm1heFNlZ21lbnRHcm91cHMgPz8gMixcbiAgICAgICAgbWF4U2VnbWVudHNQZXJHcm91cDogZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5tYXhTZWdtZW50c1Blckdyb3VwID8/IGdsb2JhbFNlZ21lbnRDb25maWc/Lm1heFNlZ21lbnRzUGVyR3JvdXAgPz8gMTAsXG4gICAgICAgIG1pblZhbHVlczogZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5taW5WYWx1ZXMgPz8gZ2xvYmFsU2VnbWVudENvbmZpZz8ubWluVmFsdWVzID8/IDIsXG4gICAgICAgIGljb25NYXBwaW5nOiB7XG4gICAgICAgICAgICAuLi5ERUZBVUxUX0lDT05fTUFQUElORyxcbiAgICAgICAgICAgIC4uLmdsb2JhbFNlZ21lbnRDb25maWc/Lmljb25NYXBwaW5nLFxuICAgICAgICAgICAgLi4uZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5pY29uTWFwcGluZ1xuICAgICAgICB9LFxuICAgICAgICBib29sZWFuTGFiZWxQYXR0ZXJuczogZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5ib29sZWFuTGFiZWxQYXR0ZXJucyB8fCBnbG9iYWxTZWdtZW50Q29uZmlnPy5ib29sZWFuTGFiZWxQYXR0ZXJucyB8fCBbXSxcbiAgICAgICAgZGVmYXVsdEJvb2xlYW5MYWJlbHM6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uZGVmYXVsdEJvb2xlYW5MYWJlbHMgfHwgZ2xvYmFsU2VnbWVudENvbmZpZz8uZGVmYXVsdEJvb2xlYW5MYWJlbHMgfHwgeyB0cnVlOiAnWWVzJywgZmFsc2U6ICdObycgfSxcbiAgICAgICAgaW5jbHVkZUFsbFNlZ21lbnQ6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uaW5jbHVkZUFsbFNlZ21lbnQgPz8gZ2xvYmFsU2VnbWVudENvbmZpZz8uaW5jbHVkZUFsbFNlZ21lbnQgPz8gdHJ1ZSxcbiAgICAgICAgZGVidWc6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uZGVidWcgPz8gZ2xvYmFsU2VnbWVudENvbmZpZz8uZGVidWcgPz8gZmFsc2VcbiAgICB9O1xuXG4gICAgaWYgKG1lcmdlZENvbmZpZy5kZWJ1Zykge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtTZWdtZW50R2VuZXJhdGlvbl0gR2VuZXJhdGluZyBzZWdtZW50cyBmb3IgJHtkZXRlY3RlZEZpZWxkcy5sZW5ndGh9IGZpZWxkKHMpOmAsIGRldGVjdGVkRmllbGRzLm1hcChkID0+IGQuZmllbGQuaWQpKTtcbiAgICB9XG5cbiAgICAvLyA0LiBHZW5lcmF0ZSBzZWdtZW50IGdyb3VwcyAob25lIHBlciBkZXRlY3RlZCBmaWVsZClcbiAgICBjb25zdCBzZWdtZW50R3JvdXBzOiBBcnJheTxJRmlsdGVyU2VnbWVudEdyb3VwPiA9IFtdO1xuXG4gICAgZm9yIChjb25zdCBkZXRlY3Rpb24gb2YgZGV0ZWN0ZWRGaWVsZHMpIHtcbiAgICAgICAgY29uc3QgeyBmaWVsZCB9ID0gZGV0ZWN0aW9uO1xuXG4gICAgICAgIC8vIEdlbmVyYXRlIHNlZ21lbnRzIGZvciB0aGlzIGZpZWxkXG4gICAgICAgIGNvbnN0IHNlZ21lbnRzOiBBcnJheTxJRmlsdGVyU2VnbWVudD4gPSBbXTtcblxuICAgICAgICAvLyBBZGQgXCJBbGxcIiBzZWdtZW50IGlmIGVuYWJsZWRcbiAgICAgICAgaWYgKG1lcmdlZENvbmZpZy5pbmNsdWRlQWxsU2VnbWVudCkge1xuICAgICAgICAgICAgc2VnbWVudHMucHVzaCh7XG4gICAgICAgICAgICAgICAgaWQ6IGBhbGwtJHtmaWVsZC5pZH1gLFxuICAgICAgICAgICAgICAgIGxhYmVsOiAnQWxsJyxcbiAgICAgICAgICAgICAgICBmaWx0ZXJzOiB7fSxcbiAgICAgICAgICAgICAgICBkZWZhdWx0OiB0cnVlXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEdldCB2YWx1ZXMgZnJvbSBmaWVsZFxuICAgICAgICBsZXQgdmFsdWVzOiAoc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbilbXSA9IFtdO1xuICAgICAgICBsZXQgdmFsdWVMYWJlbHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTsgIC8vIEZvciBjdXN0b20gYm9vbGVhbiBsYWJlbHNcblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShmaWVsZC50eXBlKSkge1xuICAgICAgICAgICAgLy8gRW51bSB0eXBlIGFycmF5XG4gICAgICAgICAgICB2YWx1ZXMgPSBmaWVsZC50eXBlO1xuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkLnR5cGUgPT09ICdib29sZWFuJykge1xuICAgICAgICAgICAgLy8gQm9vbGVhbiBmaWVsZCB3aXRoIG9wdGlvbmFsIGN1c3RvbSBsYWJlbHNcbiAgICAgICAgICAgIHZhbHVlcyA9IFsgdHJ1ZSwgZmFsc2UgXTtcblxuICAgICAgICAgICAgLy8gMS4gQ2hlY2sgZm9yIGV4cGxpY2l0IGZpZWxkLWxldmVsIGJvb2xlYW5MYWJlbHNcbiAgICAgICAgICAgIGNvbnN0IGZpZWxkQm9vbGVhbkxhYmVscyA9ICdib29sZWFuTGFiZWxzJyBpbiBmaWVsZCA/IGZpZWxkLmJvb2xlYW5MYWJlbHMgOiB1bmRlZmluZWQ7XG4gICAgICAgICAgICBpZiAoZmllbGRCb29sZWFuTGFiZWxzICYmIHR5cGVvZiBmaWVsZEJvb2xlYW5MYWJlbHMgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbICd0cnVlJyBdID0gZmllbGRCb29sZWFuTGFiZWxzLnRydWUgfHwgJ1llcyc7XG4gICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbICdmYWxzZScgXSA9IGZpZWxkQm9vbGVhbkxhYmVscy5mYWxzZSB8fCAnTm8nO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAvLyAyLiBUcnkgaW50ZWxsaWdlbnQgZXh0cmFjdGlvbiBmcm9tIGZpZWxkIG5hbWVcbiAgICAgICAgICAgICAgICBjb25zdCBmaWVsZE5hbWUgPSBmaWVsZC5pZDtcbiAgICAgICAgICAgICAgICBjb25zdCBleHRyYWN0ZWQgPSBleHRyYWN0Qm9vbGVhbkxhYmVsc0Zyb21GaWVsZE5hbWUoZmllbGROYW1lKTtcblxuICAgICAgICAgICAgICAgIGlmIChleHRyYWN0ZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbICd0cnVlJyBdID0gZXh0cmFjdGVkLnRydWVMYWJlbDtcbiAgICAgICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbICdmYWxzZScgXSA9IGV4dHJhY3RlZC5mYWxzZUxhYmVsO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIDMuIFRyeSB0byBtYXRjaCBhZ2FpbnN0IGNvbmZpZ3VyZWQgcGF0dGVybnNcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGF0dGVybnMgPSBtZXJnZWRDb25maWcuYm9vbGVhbkxhYmVsUGF0dGVybnM7XG4gICAgICAgICAgICAgICAgICAgIGxldCBtYXRjaGVkID0gZmFsc2U7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKHBhdHRlcm5zICYmIHBhdHRlcm5zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgcGF0dGVybiBvZiBwYXR0ZXJucykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlZ2V4ID0gcGF0dGVybi5wYXR0ZXJuIGluc3RhbmNlb2YgUmVnRXhwXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gcGF0dGVybi5wYXR0ZXJuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogbmV3IFJlZ0V4cChwYXR0ZXJuLnBhdHRlcm4sICdpJyk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAocmVnZXgudGVzdChmaWVsZE5hbWUpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlTGFiZWxzWyAndHJ1ZScgXSA9IHBhdHRlcm4udHJ1ZUxhYmVsO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZUxhYmVsc1sgJ2ZhbHNlJyBdID0gcGF0dGVybi5mYWxzZUxhYmVsO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXRjaGVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gNC4gVXNlIGRlZmF1bHQgZmFsbGJhY2sgaWYgbm8gcGF0dGVybiBtYXRjaGVkXG4gICAgICAgICAgICAgICAgICAgIGlmICghbWF0Y2hlZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGVmYXVsdHMgPSBtZXJnZWRDb25maWcuZGVmYXVsdEJvb2xlYW5MYWJlbHMgfHwgeyB0cnVlOiAnWWVzJywgZmFsc2U6ICdObycgfTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlTGFiZWxzWyAndHJ1ZScgXSA9IGRlZmF1bHRzLnRydWU7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZUxhYmVsc1sgJ2ZhbHNlJyBdID0gZGVmYXVsdHMuZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoKGZpZWxkLmZpZWxkVHlwZSA9PT0gJ3NlbGVjdCcgfHwgZmllbGQuZmllbGRUeXBlID09PSAncmFkaW8nIHx8IGZpZWxkLmZpZWxkVHlwZSA9PT0gJ2NoZWNrYm94JyB8fCBmaWVsZC5maWVsZFR5cGUgPT09ICdtdWx0aS1zZWxlY3QnKSAmJiBBcnJheS5pc0FycmF5KChmaWVsZCBhcyBhbnkpLm9wdGlvbnMpKSB7XG4gICAgICAgICAgICAvLyBTZWxlY3QvcmFkaW8vY2hlY2tib3ggZmllbGQgd2l0aCBpbmxpbmUgb3B0aW9uc1xuICAgICAgICAgICAgY29uc3Qgb3B0aW9ucyA9IChmaWVsZCBhcyBhbnkpLm9wdGlvbnMgYXMgQXJyYXk8eyBsYWJlbDogc3RyaW5nOyB2YWx1ZTogc3RyaW5nIH0+O1xuICAgICAgICAgICAgdmFsdWVzID0gb3B0aW9ucy5tYXAob3B0ID0+IG9wdC52YWx1ZSk7XG4gICAgICAgICAgICAvLyBTdG9yZSBsYWJlbHMgZm9yIGxhdGVyIHVzZVxuICAgICAgICAgICAgb3B0aW9ucy5mb3JFYWNoKG9wdCA9PiB7XG4gICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbIFN0cmluZyhvcHQudmFsdWUpIF0gPSBvcHQubGFiZWw7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFwcGx5IGZpZWxkLXNwZWNpZmljIHZhbHVlIGZpbHRlcnMgZmlyc3QsIHRoZW4gZ2xvYmFsXG4gICAgICAgIGNvbnN0IGluY2x1ZGVWYWx1ZXNCeUZpZWxkID0gZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5pbmNsdWRlVmFsdWVzQnlGaWVsZDtcbiAgICAgICAgY29uc3QgaW5jbHVkZVZhbHVlcyA9IGluY2x1ZGVWYWx1ZXNCeUZpZWxkPy5bIGZpZWxkLmlkIF0gfHwgZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5pbmNsdWRlVmFsdWVzO1xuICAgICAgICBpZiAoaW5jbHVkZVZhbHVlcykge1xuICAgICAgICAgICAgdmFsdWVzID0gdmFsdWVzLmZpbHRlcih2ID0+IGluY2x1ZGVWYWx1ZXMuaW5jbHVkZXMoU3RyaW5nKHYpKSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBleGNsdWRlVmFsdWVzQnlGaWVsZCA9IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uZXhjbHVkZVZhbHVlc0J5RmllbGQ7XG4gICAgICAgIGNvbnN0IGV4Y2x1ZGVWYWx1ZXMgPSBleGNsdWRlVmFsdWVzQnlGaWVsZD8uWyBmaWVsZC5pZCBdIHx8IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uZXhjbHVkZVZhbHVlcztcbiAgICAgICAgaWYgKGV4Y2x1ZGVWYWx1ZXMpIHtcbiAgICAgICAgICAgIHZhbHVlcyA9IHZhbHVlcy5maWx0ZXIodiA9PiAhZXhjbHVkZVZhbHVlcy5pbmNsdWRlcyhTdHJpbmcodikpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFwcGx5IGZpZWxkLXNwZWNpZmljIHNvcnQgb3JkZXIgZmlyc3QsIHRoZW4gZ2xvYmFsXG4gICAgICAgIGNvbnN0IHNvcnRPcmRlckJ5RmllbGQgPSBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LnNvcnRPcmRlckJ5RmllbGQ7XG4gICAgICAgIGNvbnN0IHNvcnRPcmRlciA9IHNvcnRPcmRlckJ5RmllbGQ/LlsgZmllbGQuaWQgXSB8fCBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LnNvcnRPcmRlcjtcbiAgICAgICAgaWYgKHNvcnRPcmRlcikge1xuICAgICAgICAgICAgdmFsdWVzLnNvcnQoKGEsIGIpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBhSW5kZXggPSBzb3J0T3JkZXIuaW5kZXhPZihTdHJpbmcoYSkpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGJJbmRleCA9IHNvcnRPcmRlci5pbmRleE9mKFN0cmluZyhiKSk7XG5cbiAgICAgICAgICAgICAgICAvLyBJZiBib3RoIGluIHNvcnRPcmRlciwgdXNlIHRoYXQgb3JkZXJcbiAgICAgICAgICAgICAgICBpZiAoYUluZGV4ID49IDAgJiYgYkluZGV4ID49IDApIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGFJbmRleCAtIGJJbmRleDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgLy8gSWYgb25seSBvbmUgaW4gc29ydE9yZGVyLCBpdCBjb21lcyBmaXJzdFxuICAgICAgICAgICAgICAgIGlmIChhSW5kZXggPj0gMCkgcmV0dXJuIC0xO1xuICAgICAgICAgICAgICAgIGlmIChiSW5kZXggPj0gMCkgcmV0dXJuIDE7XG4gICAgICAgICAgICAgICAgLy8gTmVpdGhlciBpbiBzb3J0T3JkZXIsIG1haW50YWluIG9yaWdpbmFsIG9yZGVyXG4gICAgICAgICAgICAgICAgcmV0dXJuIDA7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEdlbmVyYXRlIHNlZ21lbnQgZm9yIGVhY2ggdmFsdWVcbiAgICAgICAgZm9yIChjb25zdCB2YWx1ZSBvZiB2YWx1ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IHZhbHVlU3RyID0gU3RyaW5nKHZhbHVlKTtcbiAgICAgICAgICAgIGNvbnN0IHZhbHVlTG93ZXIgPSB2YWx1ZVN0ci50b0xvd2VyQ2FzZSgpO1xuXG4gICAgICAgICAgICAvLyBVc2UgY3VzdG9tIGxhYmVsIGlmIGF2YWlsYWJsZSwgb3RoZXJ3aXNlIGZvcm1hdCB0aGUgdmFsdWVcbiAgICAgICAgICAgIGNvbnN0IHNlZ21lbnRMYWJlbCA9IHZhbHVlTGFiZWxzWyB2YWx1ZVN0ciBdIHx8IHBhc2NhbENhc2UodmFsdWVTdHIpO1xuXG4gICAgICAgICAgICBzZWdtZW50cy5wdXNoKHtcbiAgICAgICAgICAgICAgICBpZDogYCR7ZmllbGQuaWR9LSR7dmFsdWVMb3dlci5yZXBsYWNlKC9bXmEtejAtOV0rL2csICctJyl9YCwgIC8vIFVuaXF1ZSBJRFxuICAgICAgICAgICAgICAgIGxhYmVsOiBzZWdtZW50TGFiZWwsICAvLyBDdXN0b20gb3IgZm9ybWF0dGVkIGxhYmVsXG4gICAgICAgICAgICAgICAgaWNvbjogbWVyZ2VkQ29uZmlnLmljb25NYXBwaW5nWyB2YWx1ZUxvd2VyIF0sICAvLyBTbWFydCBpY29uIGxvb2t1cFxuICAgICAgICAgICAgICAgIGZpbHRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgWyBmaWVsZC5pZCBdOiB7IGVxOiB2YWx1ZSB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBPbmx5IGFkZCBncm91cCBpZiB3ZSBoYXZlIHNlZ21lbnRzXG4gICAgICAgIGNvbnN0IG1pblNlZ21lbnRzID0gbWVyZ2VkQ29uZmlnLmluY2x1ZGVBbGxTZWdtZW50ID8gMSA6IDA7XG4gICAgICAgIGlmIChzZWdtZW50cy5sZW5ndGggPiBtaW5TZWdtZW50cykge1xuICAgICAgICAgICAgLy8gQXV0by1nZW5lcmF0ZSBsYWJlbCBvciB1c2UgZXhwbGljaXQgZ3JvdXBMYWJlbHNcbiAgICAgICAgICAgIGNvbnN0IGN1c3RvbUdyb3VwTGFiZWxzID0gZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5ncm91cExhYmVscztcbiAgICAgICAgICAgIGNvbnN0IGxhYmVsID0gY3VzdG9tR3JvdXBMYWJlbHM/LlsgZmllbGQuaWQgXSB8fCBgQnkgJHtwYXNjYWxDYXNlKGZpZWxkLmlkKX1gO1xuXG4gICAgICAgICAgICBzZWdtZW50R3JvdXBzLnB1c2goe1xuICAgICAgICAgICAgICAgIGlkOiBgJHtmaWVsZC5pZH0tZ3JvdXBgLFxuICAgICAgICAgICAgICAgIGxhYmVsLFxuICAgICAgICAgICAgICAgIHNlZ21lbnRzLFxuICAgICAgICAgICAgICAgIGRlZmF1bHRTZWdtZW50SWQ6IHNlZ21lbnRzLmZpbmQocyA9PiBzLmRlZmF1bHQpPy5pZCxcbiAgICAgICAgICAgICAgICBtYXhWaXNpYmxlOiBtZXJnZWRDb25maWcubWF4U2VnbWVudHNQZXJHcm91cFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBSZXR1cm4gc2VnbWVudCBncm91cHMgKG9yIHVuZGVmaW5lZCBpZiBub25lIGdlbmVyYXRlZClcbiAgICBpZiAoc2VnbWVudEdyb3Vwcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyBJZiBvbmx5IDEgZ3JvdXAgd2l0aCBzaW1wbGUgY29uZmlnLCByZXR1cm4gZmxhdCBzZWdtZW50cyBmb3IgYmFja3dhcmRzIGNvbXBhdGliaWxpdHlcbiAgICAvLyBUaGlzIG1haW50YWlucyBsZWdhY3kgYmVoYXZpb3Igd2hlbiBtYXhTZWdtZW50R3JvdXBzID0gMVxuICAgIGlmIChzZWdtZW50R3JvdXBzLmxlbmd0aCA9PT0gMSAmJiBtZXJnZWRDb25maWcubWF4U2VnbWVudEdyb3VwcyA9PT0gMSkge1xuICAgICAgICByZXR1cm4gc2VnbWVudEdyb3Vwc1sgMCBdLnNlZ21lbnRzO1xuICAgIH1cblxuICAgIHJldHVybiBzZWdtZW50R3JvdXBzO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEVOVElUWSBBVFRSSUJVVEUgRk9STUFUVElOR1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogRm9ybWF0cyBhIHNpbmdsZSBlbnRpdHkgYXR0cmlidXRlIGZvciBmb3JtIG9yIGRldGFpbCBwYWdlIGRpc3BsYXkuXG4gKiBcbiAqIFRyYW5zZm9ybXMgc2NoZW1hIGF0dHJpYnV0ZXMgaW50byBVSS1yZWFkeSBmaWVsZCBjb25maWd1cmF0aW9ucyB3aXRoIHByb3BlciBmaWVsZCB0eXBlcyxcbiAqIHJlbGF0aW9uIGNvbmZpZ3MsIG9wdGlvbnMsIHZpc2liaWxpdHksIGFuZCB2YWxpZGF0aW9uIHJ1bGVzLiBBdXRvLWdlbmVyYXRlcyByZWxhdGlvblxuICogZGlzcGxheSBjb25maWd1cmF0aW9ucyBhbmQgZmlsdGVyIGNvbmZpZ3Mgd2hlbiBub3QgZXhwbGljaXRseSBwcm92aWRlZC5cbiAqIFxuICogQHBhcmFtIHRoaXNQcm9wIC0gVGhlIGVudGl0eSBhdHRyaWJ1dGUgdG8gZm9ybWF0XG4gKiBAcGFyYW0gdHlwZSAtIFBhZ2UgdHlwZTogJ2NyZWF0ZScsICd1cGRhdGUnLCBvciAnZGV0YWlsJ1xuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSBmb3IgYWNjZXNzaW5nIHJlbGF0ZWQgc2NoZW1hc1xuICogQHBhcmFtIGFsbFByb3BlcnRpZXMgLSBPcHRpb25hbCBhcnJheSBvZiBhbGwgcHJvcGVydGllcyBmb3IgZGV0ZWN0aW5nIGR1cGxpY2F0ZWQgcmVsYXRpb24gZmllbGRzXG4gKiBAcGFyYW0gZ2xvYmFsVUlDb25maWdPcHRpb25zIC0gT3B0aW9uYWwgZ2xvYmFsIFVJIGNvbmZpZ3VyYXRpb24gb3B0aW9uc1xuICogQHJldHVybnMgRm9ybWF0dGVkIGZpZWxkIG1ldGFkYXRhIHJlYWR5IGZvciBVSSByZW5kZXJpbmdcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IGZvcm1hdHRlZEZpZWxkID0gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKFxuICogICB7XG4gKiAgICAgaWQ6ICd0ZWFtSWQnLFxuICogICAgIG5hbWU6ICd0ZWFtSWQnLFxuICogICAgIHR5cGU6ICdzdHJpbmcnLFxuICogICAgIHJlbGF0aW9uOiB7IHR5cGU6ICdvbmUnLCBlbnRpdHk6ICd0ZWFtJyB9XG4gKiAgIH0sXG4gKiAgICdjcmVhdGUnLFxuICogICBlbnRpdHlTZXJ2aWNlXG4gKiApO1xuICogLy8gUmV0dXJucyBmaWVsZCB3aXRoIHJlbGF0aW9uQ29uZmlnLCBmaWx0ZXJDb25maWcsIGFuZCBwcm9wZXIgZmllbGQgdHlwZVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoXG4gICAgdGhpc1Byb3A6IFRJT1NjaGVtYUF0dHJpYnV0ZSxcbiAgICB0eXBlOiAnY3JlYXRlJyB8ICd1cGRhdGUnIHwgJ2RldGFpbCcsXG4gICAgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PixcbiAgICBhbGxQcm9wZXJ0aWVzPzogVElPU2NoZW1hQXR0cmlidXRlW10sICAvLyBPcHRpb25hbDogZm9yIGRldGVjdGluZyBkdXBsaWNhdGVkIHJlbGF0aW9uIGZpZWxkc1xuICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sgJ3VpQ29uZmlnR2VuT3B0aW9ucycgXSAgLy8gT3B0aW9uYWw6IGdsb2JhbCBVSSBjb25maWcgb3B0aW9uc1xuKSB7XG4gICAgY29uc3QgZm9ybWF0dGVkOiBhbnkgPSB7XG4gICAgICAgIC4uLnRoaXNQcm9wLFxuICAgICAgICAvLyBVc2UgY3VzdG9tIGxhYmVsIGlmIHByb3ZpZGVkIGluIHNjaGVtYSAodGhpc1Byb3AubGFiZWwpLCBvdGhlcndpc2UgZm9ybWF0IHRoZSBuYW1lIHRvIGh1bWFuLXJlYWRhYmxlXG4gICAgICAgIGxhYmVsOiAodGhpc1Byb3AgYXMgYW55KS5sYWJlbCB8fCB0b0h1bWFuUmVhZGFibGVOYW1lKHRoaXNQcm9wLm5hbWUpLFxuICAgICAgICBjb2x1bW46IHRoaXNQcm9wLmlkLFxuICAgICAgICBmaWVsZFR5cGU6IHRoaXNQcm9wLmZpZWxkVHlwZSB8fCAndGV4dCcsICAvLyBmaWVsZFR5cGUgc2hvdWxkIGFscmVhZHkgYmUgaW5mZXJyZWQgaW4gYmFzZS1zZXJ2aWNlXG4gICAgICAgIGhpZGRlbjogdGhpc1Byb3AuaGFzT3duUHJvcGVydHkoJ2lzVmlzaWJsZScpICYmICF0aGlzUHJvcC5pc1Zpc2libGVcbiAgICB9O1xuXG4gICAgLy8gSGFuZGxlIGFkZE5ld09wdGlvbiAoT0xEIC0gZGVwcmVjYXRlZCwgZ2VuZXJhdGVzIGVtYmVkZGVkIGNvbmZpZykgb3IgYWRkTmV3T3B0aW9uQ29uZmlnIChORVcgLSBqdXN0IHBhc3MgdGhyb3VnaCByZWZlcmVuY2UpXG4gICAgaWYgKGlzU2VsZWN0RmllbGRNZXRhZGF0YSh0aGlzUHJvcCkgJiYgWyAnY3JlYXRlJywgJ3VwZGF0ZScgXS5pbmNsdWRlcyh0eXBlKSkge1xuICAgICAgICBjb25zdCBzZWxlY3RGaWVsZCA9IHRoaXNQcm9wIGFzIFNlbGVjdEZpZWxkTWV0YWRhdGE7XG5cbiAgICAgICAgaWYgKHNlbGVjdEZpZWxkLmFkZE5ld09wdGlvbkNvbmZpZykge1xuICAgICAgICAgICAgLy8gTkVXIFdBWTogVXNlciBwcm92aWRlZCBhZGROZXdPcHRpb25Db25maWcgcmVmZXJlbmNlIC0ganVzdCBwYXNzIGl0IHRocm91Z2hcbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ2FkZE5ld09wdGlvbkNvbmZpZycgXSA9IHNlbGVjdEZpZWxkLmFkZE5ld09wdGlvbkNvbmZpZztcblxuICAgICAgICB9IGVsc2UgaWYgKHNlbGVjdEZpZWxkLmFkZE5ld09wdGlvbikge1xuICAgICAgICAgICAgLy8gT0xEIFdBWSAoREVQUkVDQVRFRCk6IFRyYW5zZm9ybSBhZGROZXdPcHRpb24gdG8gYWRkTmV3T3B0aW9uQ29uZmlnIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG4gICAgICAgICAgICBjb25zdCB7IGVudGl0eU5hbWUsIG92ZXJyaWRlQ29uZmlnIH0gPSBzZWxlY3RGaWVsZC5hZGROZXdPcHRpb247XG5cbiAgICAgICAgICAgIGlmIChlbnRpdHlOYW1lICYmIGVudGl0eVNlcnZpY2UuaGFzRW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShlbnRpdHlOYW1lKSkge1xuICAgICAgICAgICAgICAgIGZvcm1hdHRlZFsgJ2FkZE5ld09wdGlvbkNvbmZpZycgXSA9IHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdjcmVhdGUnLFxuICAgICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzogb3ZlcnJpZGVDb25maWcgfHwge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3VibWl0U3VjY2Vzc1JlZGlyZWN0OiB1bmRlZmluZWQsICAvLyBTdGF5IGluIG1vZGFsIGFmdGVyIGNyZWF0aW9uXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3JtQnV0dG9uczogW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsgdGV4dDogXCJBZGRcIiwgYWN0aW9uOiBcInN1Ym1pdFwiIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgeyB0ZXh0OiBcIkNhbmNlbFwiLCBhY3Rpb246IFwiY2FuY2VsXCIgfVxuICAgICAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWw6IENvdWxkIG5vdCBmaW5kIHJlbGF0ZWQtZW50aXR5LXNlcnZpY2UgZm9yIGVudGl0eSBbJHtlbnRpdHlOYW1lfV0gaW4gJHtlbnRpdHlTZXJ2aWNlLmNvbnN0cnVjdG9yLm5hbWV9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBQYXNzIHF1aWNrQ3JlYXRlIFVYIGNvbmZpZyB0aHJvdWdoIHZlcmJhdGltICgjNDQpLlxuICAgICAgICAvLyB1aTI0IHVzZXMgaXQgdG8gc3VyZmFjZSBhIGNvbnRleHR1YWwgXCIrIENyZWF0ZSAnW3Rlcm1dJ1wiIGJ1dHRvbiBpbiB0aGVcbiAgICAgICAgLy8gZHJvcGRvd24gd2hlbiB0aGUgc2VhcmNoIHJldHVybnMgbm8gcmVzdWx0cy4gIFRoZSBlbnRpdHkgY3JlYXRlIGZvcm0gaXNcbiAgICAgICAgLy8gcmVzb2x2ZWQgZnJvbSBhZGROZXdPcHRpb25Db25maWcg4oCUIG5vdGhpbmcgaXMgZHVwbGljYXRlZCBoZXJlLlxuICAgICAgICBpZiAoc2VsZWN0RmllbGQucXVpY2tDcmVhdGUpIHtcbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ3F1aWNrQ3JlYXRlJyBdID0gc2VsZWN0RmllbGQucXVpY2tDcmVhdGU7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBSZXNvbHZlIFJlbGF0aW9uRW50aXR5T3B0aW9uQ29uZmlnIOKGkiBGaWVsZE9wdGlvbnNBUElDb25maWcgZm9yIHNlbGVjdCBmaWVsZHMgb24gZm9ybSBwYWdlc1xuICAgIGlmIChpc1NlbGVjdEZpZWxkTWV0YWRhdGEodGhpc1Byb3ApICYmIHRoaXNQcm9wLm9wdGlvbnNcbiAgICAgICAgJiYgdHlwZW9mIHRoaXNQcm9wLm9wdGlvbnMgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KHRoaXNQcm9wLm9wdGlvbnMpXG4gICAgICAgICYmICdlbnRpdHlOYW1lJyBpbiB0aGlzUHJvcC5vcHRpb25zICYmIHRoaXNQcm9wLnJlbGF0aW9uXG4gICAgKSB7XG4gICAgICAgIGNvbnN0IHJlc29sdmVkID0gcmVzb2x2ZVJlbGF0aW9uT3B0aW9uQ29uZmlnKFxuICAgICAgICAgICAgdGhpc1Byb3Aub3B0aW9ucyBhcyBSZWxhdGlvbkVudGl0eU9wdGlvbkNvbmZpZyxcbiAgICAgICAgICAgIHRoaXNQcm9wIGFzIFRJT1NjaGVtYUF0dHJpYnV0ZSAmIHsgcmVsYXRpb246IE5vbk51bGxhYmxlPFRJT1NjaGVtYUF0dHJpYnV0ZVsgJ3JlbGF0aW9uJyBdPiB9LFxuICAgICAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9uc1xuICAgICAgICApO1xuICAgICAgICBpZiAocmVzb2x2ZWQpIHtcbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ29wdGlvbnMnIF0gPSByZXNvbHZlZDtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIEhhbmRsZSByZWxhdGlvbiBmaWVsZHMgKERBVEEgTEFZRVIgKyBVSSBMQVlFUilcbiAgICBpZiAodGhpc1Byb3AucmVsYXRpb24gJiYgdHlwZSA9PT0gJ2RldGFpbCcpIHtcbiAgICAgICAgY29uc3QgcmVsYXRpb24gPSB0aGlzUHJvcC5yZWxhdGlvbjtcbiAgICAgICAgY29uc3QgeyBlbnRpdHlOYW1lLCB0eXBlOiByZWxhdGlvblR5cGUsIGlkZW50aWZpZXJzIH0gPSByZWxhdGlvbjtcbiAgICAgICAgY29uc3QgZW50aXR5TmFtZUxvd2VyID0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpO1xuXG4gICAgICAgIGlmICghZW50aXR5U2VydmljZS5oYXNFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKGVudGl0eU5hbWUpKSB7XG4gICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbDogQ291bGQgbm90IGZpbmQgcmVsYXRlZC1lbnRpdHktc2VydmljZSBmb3IgZW50aXR5IFske2VudGl0eU5hbWV9XSBpbiAke2VudGl0eVNlcnZpY2UuY29uc3RydWN0b3IubmFtZX1gKTtcbiAgICAgICAgICAgIHJldHVybiBmb3JtYXR0ZWQ7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZXNvbHZlIGlkZW50aWZpZXJzIChjb3VsZCBiZSBkaXJlY3QgdmFsdWUgb3IgbGF6eSBmdW5jdGlvbilcbiAgICAgICAgY29uc3QgcmVzb2x2ZWRJZGVudGlmaWVycyA9IHR5cGVvZiBpZGVudGlmaWVycyA9PT0gJ2Z1bmN0aW9uJyA/IGlkZW50aWZpZXJzKCkgOiBpZGVudGlmaWVycztcblxuICAgICAgICAvLyBTYWZldHkgY2hlY2sgZm9yIGFycmF5IGlkZW50aWZpZXJzXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHJlc29sdmVkSWRlbnRpZmllcnMpKSB7XG4gICAgICAgICAgICBpZiAocmVzb2x2ZWRJZGVudGlmaWVycy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbDogRW1wdHkgaWRlbnRpZmllcnMgYXJyYXkgZm9yIHJlbGF0aW9uIFske2VudGl0eU5hbWV9XWApO1xuICAgICAgICAgICAgICAgIHJldHVybiBmb3JtYXR0ZWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBIYW5kbGUgYm90aCBzaW5nbGUgYW5kIG11bHRpcGxlIGlkZW50aWZpZXJzIGZvciBjb21wb3NpdGUga2V5c1xuICAgICAgICBjb25zdCBpZGVudGlmaWVyTWFwcGluZ3MgPSBBcnJheS5pc0FycmF5KHJlc29sdmVkSWRlbnRpZmllcnMpXG4gICAgICAgICAgICA/IHJlc29sdmVkSWRlbnRpZmllcnMubWFwKGlkID0+ICh7XG4gICAgICAgICAgICAgICAgc291cmNlOiBTdHJpbmcoaWQuc291cmNlKSxcbiAgICAgICAgICAgICAgICB0YXJnZXQ6IFN0cmluZyhpZC50YXJnZXQpXG4gICAgICAgICAgICB9KSlcbiAgICAgICAgICAgIDogWyB7XG4gICAgICAgICAgICAgICAgc291cmNlOiBTdHJpbmcocmVzb2x2ZWRJZGVudGlmaWVycy5zb3VyY2UpLFxuICAgICAgICAgICAgICAgIHRhcmdldDogU3RyaW5nKHJlc29sdmVkSWRlbnRpZmllcnMudGFyZ2V0KVxuICAgICAgICAgICAgfSBdO1xuXG4gICAgICAgIC8vIEZvciByb3V0ZSBwYXR0ZXJuIGFuZCBkZWZhdWx0IGZpbHRlcnMsIHVzZSB0aGUgZmlyc3QgaWRlbnRpZmllclxuICAgICAgICAvLyAobW9zdCBlbnRpdGllcyBoYXZlIHNpbmdsZSBpZGVudGlmaWVyOyBjb21wb3NpdGUga2V5cyBuZWVkIGV4cGxpY2l0IHJvdXRlUGF0dGVybilcbiAgICAgICAgY29uc3QgcHJpbWFyeUlkZW50aWZpZXIgPSBpZGVudGlmaWVyTWFwcGluZ3NbIDAgXTtcblxuICAgICAgICAvLyBDaGVjayBpZiB1c2VyIHByb3ZpZGVkIGN1c3RvbSBVSSBjb25maWcgaW4gcmVsYXRpb25Db25maWcgKG9wdGlvbmFsIG92ZXJyaWRlKVxuICAgICAgICBjb25zdCB1c2VyUmVsYXRpb25Db25maWcgPSB0aGlzUHJvcC5yZWxhdGlvbkNvbmZpZyBhcyBJUmVsYXRpb25GaWVsZENvbmZpZyB8IHVuZGVmaW5lZDtcblxuICAgICAgICAvLyBHZXQgcmVsYXRlZCBlbnRpdHkgc2VydmljZSBmb3IgbWV0YWRhdGEgKGljb24sIGV0Yy4pXG4gICAgICAgIGNvbnN0IHJlbGF0ZWRFbnRpdHlTZXJ2aWNlID0gZW50aXR5U2VydmljZS5oYXNFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKGVudGl0eU5hbWUpXG4gICAgICAgICAgICA/IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShlbnRpdHlOYW1lKVxuICAgICAgICAgICAgOiB1bmRlZmluZWQ7XG5cbiAgICAgICAgLy8gR2V0IGVudGl0eSBtZXRhZGF0YSBmb3IgaWNvbiBhbmQgZmFsbGJhY2sgZ2VuZXJhdGlvblxuICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5TWV0YWRhdGEgPSByZWxhdGVkRW50aXR5U2VydmljZT8uZ2V0RW50aXR5U2NoZW1hPy4oKS5tb2RlbDtcbiAgICAgICAgY29uc3QgZGVmYXVsdEljb24gPSByZWxhdGVkRW50aXR5TWV0YWRhdGE/Lm1ldGFkYXRhPy5pY29uO1xuXG4gICAgICAgIGlmIChyZWxhdGlvblR5cGUuZW5kc1dpdGgoJ3RvLW9uZScpKSB7XG4gICAgICAgICAgICAvLyBUTy1PTkU6IFNob3cgdmFsdWUgYXMgbGluayArIG1vZGFsIGljb25cbiAgICAgICAgICAgIC8vIFJvdXRlIHBhdHRlcm46IFVzZSBjdXN0b20gKGZyb20gcmVsYXRpb25Db25maWcpIG9yIGRlZmF1bHQgdG8gL3ZpZXcte2VudGl0eX0vOnRhcmdldElkXG4gICAgICAgICAgICBjb25zdCByb3V0ZVBhdHRlcm4gPSB1c2VyUmVsYXRpb25Db25maWc/LnJvdXRlUGF0dGVyblxuICAgICAgICAgICAgICAgIHx8IGAvdmlldy0ke2VudGl0eU5hbWVMb3dlcn0vOiR7cHJpbWFyeUlkZW50aWZpZXIudGFyZ2V0fWA7XG5cbiAgICAgICAgICAgIC8vIEdlbmVyYXRlIGZhbGxiYWNrIGNvbmZpZ3VyYXRpb24gZm9yIHdoZW4gb25seSBJRCBpcyBhdmFpbGFibGVcbiAgICAgICAgICAgIGNvbnN0IGZhbGxiYWNrQ29uZmlnID0gZ2VuZXJhdGVSZWxhdGlvbkZhbGxiYWNrKFxuICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgcHJpbWFyeUlkZW50aWZpZXIuc291cmNlLFxuICAgICAgICAgICAgICAgIHJlbGF0ZWRFbnRpdHlTZXJ2aWNlXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICAvLyBBdXRvLWRldGVjdCBkdXBsaWNhdGVkIHJlbGF0aW9uIGZpZWxkIChlLmcuLCB0ZWFtTmFtZSBmb3IgdGVhbUlkKVxuICAgICAgICAgICAgLy8gTkVXOiBVc2UgZW5oYW5jZWQgZGV0ZWN0aW9uIHdpdGggY29uZmlnIHN1cHBvcnRcbiAgICAgICAgICAgIGxldCBhdXRvVGVtcGxhdGU6IHN0cmluZyB8IHVuZGVmaW5lZCA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIGxldCBkZXRlY3Rpb25NZXRhZGF0YTogYW55ID0gdW5kZWZpbmVkO1xuXG4gICAgICAgICAgICAvLyBDaGVjayBpZiBhdXRvLWRldGVjdGlvbiBpcyBlbmFibGVkIChkZWZhdWx0OiB0cnVlKVxuICAgICAgICAgICAgY29uc3QgYXV0b0RldGVjdEVuYWJsZWQgPSB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmF1dG9EZXRlY3QgIT09IGZhbHNlO1xuXG4gICAgICAgICAgICBpZiAoYXV0b0RldGVjdEVuYWJsZWQgJiYgYWxsUHJvcGVydGllcykge1xuICAgICAgICAgICAgICAgIC8vIEdldCBnbG9iYWwgY29uZmlnIChwYXNzZWQgZnJvbSBmdzI0IGluaXRpYWxpemF0aW9uKVxuICAgICAgICAgICAgICAgIGNvbnN0IGdsb2JhbENvbmZpZyA9IGdsb2JhbFVJQ29uZmlnT3B0aW9ucz8uZHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uO1xuXG4gICAgICAgICAgICAgICAgLy8gR2V0IGVudGl0eS1sZXZlbCBjb25maWcgZnJvbSBlbnRpdHkgbWV0YWRhdGFcbiAgICAgICAgICAgICAgICBjb25zdCBlbnRpdHlDb25maWcgPSByZWxhdGVkRW50aXR5TWV0YWRhdGE/Lm1ldGFkYXRhPy5kdXBsaWNhdGVkRmllbGREZXRlY3Rpb247XG5cbiAgICAgICAgICAgICAgICAvLyBHZXQgcmVsYXRpb24tbGV2ZWwgaGludHNcbiAgICAgICAgICAgICAgICBjb25zdCByZWxhdGlvbkhpbnRzID0gdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5hdXRvRGV0ZWN0SGludHM7XG5cbiAgICAgICAgICAgICAgICAvLyBSdW4gZW5oYW5jZWQgZGV0ZWN0aW9uXG4gICAgICAgICAgICAgICAgY29uc3QgZGV0ZWN0aW9uUmVzdWx0ID0gZGV0ZWN0RHVwbGljYXRlZFJlbGF0aW9uRmllbGRzKFxuICAgICAgICAgICAgICAgICAgICBhbGxQcm9wZXJ0aWVzLFxuICAgICAgICAgICAgICAgICAgICB0aGlzUHJvcC5pZCxcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgZ2xvYmFsQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICBlbnRpdHlDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIHJlbGF0aW9uSGludHNcbiAgICAgICAgICAgICAgICApO1xuXG4gICAgICAgICAgICAgICAgaWYgKGRldGVjdGlvblJlc3VsdCkge1xuICAgICAgICAgICAgICAgICAgICBhdXRvVGVtcGxhdGUgPSBkZXRlY3Rpb25SZXN1bHQudGVtcGxhdGU7XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gU3RvcmUgbWV0YWRhdGEgZm9yIGRlYnVnZ2luZyBhbmQgZnV0dXJlIGZlYXR1cmVzXG4gICAgICAgICAgICAgICAgICAgIGRldGVjdGlvbk1ldGFkYXRhID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgZGV0ZWN0ZWRGaWVsZHM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcmltYXJ5OiBkZXRlY3Rpb25SZXN1bHQucHJpbWFyeUZpZWxkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFsdGVybmF0aXZlczogZGV0ZWN0aW9uUmVzdWx0LmRldGVjdGVkRmllbGRzLmRpc3BsYXk/LnNsaWNlKDEpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZpc3VhbDogZGV0ZWN0aW9uUmVzdWx0LmRldGVjdGVkRmllbGRzLnZpc3VhbCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZXRhOiBkZXRlY3Rpb25SZXN1bHQuZGV0ZWN0ZWRGaWVsZHMubWV0YVxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbmZpZGVuY2U6IGRldGVjdGlvblJlc3VsdC5jb25maWRlbmNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWV0aG9kOiBkZXRlY3Rpb25SZXN1bHQubWV0aG9kLFxuICAgICAgICAgICAgICAgICAgICAgICAgcGF0dGVybjogZGV0ZWN0aW9uUmVzdWx0LnBhdHRlcm5cbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnOiBJUmVsYXRpb25GaWVsZENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICByb3V0ZVBhdHRlcm46IHJvdXRlUGF0dGVybixcbiAgICAgICAgICAgICAgICAvLyBQYXNzIEFMTCBpZGVudGlmaWVyIG1hcHBpbmdzIChzdXBwb3J0cyBjb21wb3NpdGUga2V5cylcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyTWFwcGluZzogaWRlbnRpZmllck1hcHBpbmdzLmxlbmd0aCA9PT0gMVxuICAgICAgICAgICAgICAgICAgICA/IGlkZW50aWZpZXJNYXBwaW5nc1sgMCBdICAvLyBTaW5nbGU6IHJldHVybiBvYmplY3RcbiAgICAgICAgICAgICAgICAgICAgOiBpZGVudGlmaWVyTWFwcGluZ3MsICAgICAvLyBNdWx0aXBsZTogcmV0dXJuIGFycmF5XG4gICAgICAgICAgICAgICAgbW9kYWxDb25maWdSZWY6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxDb25maWdSZWYgfHwge1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ3ZpZXcnLFxuICAgICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge31cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIG1vZGFsV2lkdGg6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxXaWR0aCxcbiAgICAgICAgICAgICAgICBtb2RhbFRpdGxlOiB1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsVGl0bGUsXG4gICAgICAgICAgICAgICAgZGlzcGxheUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAvLyBQcmlvcml0eTogVXNlciBjdXN0b20gdGVtcGxhdGUgPiBBdXRvLWRldGVjdGVkIGR1cGxpY2F0ZWQgZmllbGQgPiB1bmRlZmluZWQgKHVzZSBmYWxsYmFjaylcbiAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGU6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8udGVtcGxhdGUgfHwgYXV0b1RlbXBsYXRlLFxuICAgICAgICAgICAgICAgICAgICAvLyBTbWFydCBmYWxsYmFjayBwcmUtZ2VuZXJhdGVkIGZyb20gZW50aXR5IG1ldGFkYXRhXG4gICAgICAgICAgICAgICAgICAgIGZhbGxiYWNrOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmZhbGxiYWNrIHx8IGZhbGxiYWNrQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICAvLyBJY29uIGZyb20gZW50aXR5IG1ldGFkYXRhIG9yIHVzZXIgb3ZlcnJpZGVcbiAgICAgICAgICAgICAgICAgICAgaWNvbjogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5pY29uIHx8IGRlZmF1bHRJY29uIHx8ICdFeWVPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgICAgIHNob3dNb2RhbEljb246IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uc2hvd01vZGFsSWNvbiAhPT0gZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgIHNob3dMaW5rOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnNob3dMaW5rICE9PSBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgLy8gUGFzcyB0aHJvdWdoIGF1dG9EZXRlY3QgYW5kIGF1dG9EZXRlY3RIaW50c1xuICAgICAgICAgICAgICAgICAgICBhdXRvRGV0ZWN0OiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmF1dG9EZXRlY3QsXG4gICAgICAgICAgICAgICAgICAgIGF1dG9EZXRlY3RIaW50czogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5hdXRvRGV0ZWN0SGludHMsXG4gICAgICAgICAgICAgICAgICAgIC8vIFBhc3MgdGhyb3VnaCBhbnkgY3VzdG9tIGFjdGlvbnNcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5hY3Rpb25zLFxuICAgICAgICAgICAgICAgICAgICAvLyBQYXNzIHRocm91Z2ggcHJldmlldyBjb25maWcgZm9yIFJlbGF0ZWQgUmVjb3JkIFBlZWsgKCMxMDMpXG4gICAgICAgICAgICAgICAgICAgIC4uLih1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnByZXZpZXcgJiYgeyBwcmV2aWV3OiB1c2VyUmVsYXRpb25Db25maWcuZGlzcGxheUNvbmZpZy5wcmV2aWV3IH0pXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGlmIChnbG9iYWxVSUNvbmZpZ09wdGlvbnM/LmR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbj8uZGVidWcpIHtcbiAgICAgICAgICAgICAgICBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZy5kaXNwbGF5Q29uZmlnIVsgJ19kZXRlY3Rpb25NZXRhZGF0YScgXSA9IGRldGVjdGlvbk1ldGFkYXRhO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdyZWxhdGlvbkNvbmZpZycgXSA9IGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnO1xuXG4gICAgICAgICAgICAvLyBCYWNrd2FyZCBjb21wYXRpYmlsaXR5OiBLZWVwIGlzTGluayBhbmQgbGlua0NvbmZpZ1xuICAgICAgICAgICAgZm9ybWF0dGVkWyAnaXNMaW5rJyBdID0gdHJ1ZTtcbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ2xpbmtDb25maWcnIF0gPSB7XG4gICAgICAgICAgICAgICAgcm91dGVQYXR0ZXJuOiByb3V0ZVBhdHRlcm5cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgfSBlbHNlIGlmIChyZWxhdGlvblR5cGUuZW5kc1dpdGgoJ3RvLW1hbnknKSkge1xuICAgICAgICAgICAgLy8gVE8tTUFOWTogU2hvdyBjb3VudCArIG1vZGFsIGljb24gKG9wZW5zIGZpbHRlcmVkIGxpc3QpXG4gICAgICAgICAgICAvLyBSb3V0ZSBwYXR0ZXJuOiBVc2UgY3VzdG9tIChmcm9tIHJlbGF0aW9uQ29uZmlnKSBvciBkZWZhdWx0IHRvIC9saXN0LXtlbnRpdHl9XG4gICAgICAgICAgICBjb25zdCByb3V0ZVBhdHRlcm4gPSB1c2VyUmVsYXRpb25Db25maWc/LnJvdXRlUGF0dGVyblxuICAgICAgICAgICAgICAgIHx8IGAvbGlzdC0ke2VudGl0eU5hbWVMb3dlcn1gO1xuXG4gICAgICAgICAgICAvLyBCdWlsZCBkZWZhdWx0IGZpbHRlcnMgdG8gc2hvdyBvbmx5IHJlbGF0ZWQgaXRlbXNcbiAgICAgICAgICAgIC8vIEZvciBleGFtcGxlLCBpZiB3ZSdyZSB2aWV3aW5nIGEgVGVhbSBhbmQgdGhpcyBmaWVsZCBzaG93cyBHYW1lcyxcbiAgICAgICAgICAgIC8vIHdlIHdhbnQgdG8gZmlsdGVyIGdhbWVzIHdoZXJlIHRlYW1JZCA9IGN1cnJlbnQgdGVhbSdzIElEXG4gICAgICAgICAgICAvLyBGb3IgY29tcG9zaXRlIGtleXMsIGFkZCBhbGwgaWRlbnRpZmllcnMgYXMgZmlsdGVyc1xuICAgICAgICAgICAgY29uc3QgZGVmYXVsdEZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICAgICAgICAgIGlkZW50aWZpZXJNYXBwaW5ncy5mb3JFYWNoKG1hcHBpbmcgPT4ge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzWyBtYXBwaW5nLnRhcmdldCBdID0gYDoke21hcHBpbmcuc291cmNlfWA7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gR2VuZXJhdGUgZmFsbGJhY2sgY29uZmlndXJhdGlvbiBmb3IgdG8tbWFueSAoc2hvd3MgY291bnQpXG4gICAgICAgICAgICBjb25zdCBmYWxsYmFja0NvbmZpZyA9IGdlbmVyYXRlUmVsYXRpb25GYWxsYmFjayhcbiAgICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgIHByaW1hcnlJZGVudGlmaWVyLnNvdXJjZSxcbiAgICAgICAgICAgICAgICByZWxhdGVkRW50aXR5U2VydmljZVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgY29uc3QgZ2VuZXJhdGVkUmVsYXRpb25Db25maWc6IElSZWxhdGlvbkZpZWxkQ29uZmlnID0ge1xuICAgICAgICAgICAgICAgIHJvdXRlUGF0dGVybjogcm91dGVQYXR0ZXJuLFxuICAgICAgICAgICAgICAgIC8vIFBhc3MgQUxMIGlkZW50aWZpZXIgbWFwcGluZ3MgKHN1cHBvcnRzIGNvbXBvc2l0ZSBrZXlzKVxuICAgICAgICAgICAgICAgIGlkZW50aWZpZXJNYXBwaW5nOiBpZGVudGlmaWVyTWFwcGluZ3MubGVuZ3RoID09PSAxXG4gICAgICAgICAgICAgICAgICAgID8gaWRlbnRpZmllck1hcHBpbmdzWyAwIF0gIC8vIFNpbmdsZTogcmV0dXJuIG9iamVjdFxuICAgICAgICAgICAgICAgICAgICA6IGlkZW50aWZpZXJNYXBwaW5ncywgICAgIC8vIE11bHRpcGxlOiByZXR1cm4gYXJyYXlcbiAgICAgICAgICAgICAgICBtb2RhbENvbmZpZ1JlZjogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbENvbmZpZ1JlZiB8fCB7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogZGVmYXVsdEZpbHRlcnNcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgbW9kYWxXaWR0aDogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbFdpZHRoLFxuICAgICAgICAgICAgICAgIG1vZGFsVGl0bGU6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxUaXRsZSxcbiAgICAgICAgICAgICAgICBkaXNwbGF5Q29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZXIgY2FuIG92ZXJyaWRlIHdpdGggY3VzdG9tIHRlbXBsYXRlXG4gICAgICAgICAgICAgICAgICAgIHRlbXBsYXRlOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnRlbXBsYXRlLFxuICAgICAgICAgICAgICAgICAgICAvLyBTbWFydCBmYWxsYmFjayBwcmUtZ2VuZXJhdGVkIGZyb20gZW50aXR5IG1ldGFkYXRhXG4gICAgICAgICAgICAgICAgICAgIGZhbGxiYWNrOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmZhbGxiYWNrIHx8IGZhbGxiYWNrQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICAvLyBJY29uIGZyb20gZW50aXR5IG1ldGFkYXRhIG9yIHVzZXIgb3ZlcnJpZGVcbiAgICAgICAgICAgICAgICAgICAgaWNvbjogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5pY29uIHx8IGRlZmF1bHRJY29uIHx8ICdVbm9yZGVyZWRMaXN0T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgICAgICBzaG93TW9kYWxJY29uOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnNob3dNb2RhbEljb24gIT09IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICBzaG93TGluazogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5zaG93TGluayAhPT0gdHJ1ZSwgLy8gRGVmYXVsdCBmYWxzZSBmb3IgdG8tbWFueVxuICAgICAgICAgICAgICAgICAgICAvLyBQYXNzIHRocm91Z2ggYW55IGN1c3RvbSBhY3Rpb25zXG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uYWN0aW9uc1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIC8vIElmIHVzZXIgcHJvdmlkZWQgY3VzdG9tIG1vZGFsQ29uZmlnUmVmLCBtZXJnZSBkZWZhdWx0IGZpbHRlcnMgd2l0aCB0aGVpciBvdmVycmlkZXNcbiAgICAgICAgICAgIGlmICh1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsQ29uZmlnUmVmPy5vdmVycmlkZUNvbmZpZykge1xuICAgICAgICAgICAgICAgIGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnLm1vZGFsQ29uZmlnUmVmIS5vdmVycmlkZUNvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICAgICAgLi4udXNlclJlbGF0aW9uQ29uZmlnLm1vZGFsQ29uZmlnUmVmLm92ZXJyaWRlQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgLi4uZGVmYXVsdEZpbHRlcnMsXG4gICAgICAgICAgICAgICAgICAgICAgICAuLi4odXNlclJlbGF0aW9uQ29uZmlnLm1vZGFsQ29uZmlnUmVmLm92ZXJyaWRlQ29uZmlnLmRlZmF1bHRGaWx0ZXJzIHx8IHt9KVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZm9ybWF0dGVkWyAncmVsYXRpb25Db25maWcnIF0gPSBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZztcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIEhhbmRsZSBuZXN0ZWQgc3RydWN0dXJlcyAobWFwIGFuZCBsaXN0IHR5cGVzKVxuICAgIGlmICh0aGlzUHJvcC50eXBlID09PSAnbWFwJyAmJiB0aGlzUHJvcC5wcm9wZXJ0aWVzKSB7XG4gICAgICAgIGZvcm1hdHRlZFsgJ3Byb3BlcnRpZXMnIF0gPSBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRm9ybU9yRGV0YWlsKHRoaXNQcm9wLnByb3BlcnRpZXMsIHR5cGUsIGVudGl0eVNlcnZpY2UpO1xuICAgIH0gZWxzZSBpZiAodGhpc1Byb3AudHlwZSA9PT0gJ2xpc3QnKSB7XG4gICAgICAgIC8vIEZvciBsaXN0IHR5cGVzLCBjaGVjayBpZiBpdGVtcyBhcmUgbWFwcyAobmVzdGVkIHN0cnVjdHVyZXMpXG4gICAgICAgIC8vIE5vdGU6IGl0ZW1zIHByb3BlcnR5IGV4aXN0cyBvbiBsaXN0LXR5cGUgYXR0cmlidXRlcyBidXQgbm90IGluIGJhc2UgRW50aXR5QXR0cmlidXRlIHR5cGVcbiAgICAgICAgY29uc3QgZXh0ZW5kZWRQcm9wID0gdGhpc1Byb3AgYXMgVElPU2NoZW1hQXR0cmlidXRlICYgeyBpdGVtcz86IHsgdHlwZTogc3RyaW5nOyBwcm9wZXJ0aWVzPzogVElPU2NoZW1hQXR0cmlidXRlW10gfSB9O1xuICAgICAgICBpZiAoZXh0ZW5kZWRQcm9wLml0ZW1zPy50eXBlID09PSAnbWFwJyAmJiBleHRlbmRlZFByb3AuaXRlbXMucHJvcGVydGllcykge1xuICAgICAgICAgICAgZm9ybWF0dGVkWyAnaXRlbXMnIF0gPSB7XG4gICAgICAgICAgICAgICAgLi4uZm9ybWF0dGVkWyAnaXRlbXMnIF0sXG4gICAgICAgICAgICAgICAgcHJvcGVydGllczogZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckZvcm1PckRldGFpbChleHRlbmRlZFByb3AuaXRlbXMucHJvcGVydGllcywgdHlwZSwgZW50aXR5U2VydmljZSlcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZm9ybWF0dGVkO1xufVxuXG4vKipcbiAqIFJvdXRlcyBhdHRyaWJ1dGUgZm9ybWF0dGluZyB0byB0aGUgYXBwcm9wcmlhdGUgdHlwZS1zcGVjaWZpYyBmb3JtYXR0ZXIuXG4gKiBcbiAqIENvbnZlbmllbmNlIGZ1bmN0aW9uIHRoYXQgZGVsZWdhdGVzIHRvIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JDcmVhdGUsXG4gKiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yVXBkYXRlLCBvciBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRGV0YWlsIGJhc2VkIG9uIHR5cGUuXG4gKiBcbiAqIEBwYXJhbSBwcm9wZXJ0aWVzIC0gQXJyYXkgb2YgZW50aXR5IGF0dHJpYnV0ZXMgdG8gZm9ybWF0XG4gKiBAcGFyYW0gdHlwZSAtIFBhZ2UgdHlwZTogJ2NyZWF0ZScsICd1cGRhdGUnLCBvciAnZGV0YWlsJ1xuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSBmb3IgYWNjZXNzaW5nIHNjaGVtYXNcbiAqIEByZXR1cm5zIEFycmF5IG9mIGZvcm1hdHRlZCBmaWVsZCBtZXRhZGF0YVxuICogQHRocm93cyBFcnJvciBpZiBpbnZhbGlkIHR5cGUgaXMgcHJvdmlkZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JGb3JtT3JEZXRhaWwoXG4gICAgcHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sXG4gICAgdHlwZTogJ2NyZWF0ZScgfCAndXBkYXRlJyB8ICdkZXRhaWwnLFxuICAgIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT5cbikge1xuXG4gICAgaWYgKHR5cGUgPT09ICdjcmVhdGUnKSB7XG4gICAgICAgIHJldHVybiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yQ3JlYXRlKHByb3BlcnRpZXMsIGVudGl0eVNlcnZpY2UpO1xuICAgIH1cblxuICAgIGlmICh0eXBlID09PSAndXBkYXRlJykge1xuICAgICAgICByZXR1cm4gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvclVwZGF0ZShwcm9wZXJ0aWVzLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICB9XG5cbiAgICBpZiAodHlwZSA9PT0gJ2RldGFpbCcpIHtcbiAgICAgICAgcmV0dXJuIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JEZXRhaWwocHJvcGVydGllcywgZW50aXR5U2VydmljZSk7XG4gICAgfVxuICAgIHRocm93IChgSW52YWxpZCB0eXBlIFske3R5cGV9XSBwcm92aWRlZCB0byBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRm9ybU9yRGV0YWlsYCk7XG59XG5cbi8qKlxuICogRXhwYW5kcyBzaG9ydGhhbmQgZmllbGQgcmVmZXJlbmNlcyBpbnRvIGZ1bGwgUHJvcGVydHlDb25maWcgb2JqZWN0cy5cbiAqIFxuICogKipFbnRlcnByaXNlLUdyYWRlIFBhdHRlcm4gU3VwcG9ydGluZzoqKlxuICogXG4gKiAxLiAqKlN0cmluZyBzaG9ydGhhbmQgKHNjaGVtYSBmaWVsZHMgb25seSk6KiogYCdmaWVsZE5hbWUnYCDihpIgbG9va3MgdXAgaW4gc2NoZW1hLCBleHBhbmRzIHRvIGZ1bGwgY29uZmlnXG4gKiAyLiAqKk9iamVjdCB3aXRoIHNjaGVtYSBmaWVsZDoqKiBgeyBuYW1lOiAnc3RhdHVzJywgZmllbGRUeXBlOiAnYmFkZ2UnIH1gIOKGkiBtZXJnZXMgb3ZlcnJpZGVzIHdpdGggc2NoZW1hIGRlZmF1bHRzXG4gKiAzLiAqKkpTT04gcGF0aCAobmVzdGVkIGRhdGEpOioqIGB7IG5hbWU6ICd1c2VyRW1haWwnLCBjb2x1bW46ICd1c2VyLmVtYWlsJywgbGFiZWw6ICdFbWFpbCcsIGZpZWxkVHlwZTogJ3RleHQnIH1gXG4gKiA0LiAqKk11bHRpcGxlIHJlbmRlcmluZ3M6KiogYHsgbmFtZTogJ3N0YXR1c0JhZGdlJywgY29sdW1uOiAnc3RhdHVzJywgZmllbGRUeXBlOiAnYmFkZ2UnIH1gICsgYHsgbmFtZTogJ3N0YXR1c1RleHQnLCBjb2x1bW46ICdzdGF0dXMnLCBmaWVsZFR5cGU6ICd0ZXh0JyB9YFxuICogNS4gKipDdXN0b20vY29tcHV0ZWQgZmllbGRzOioqIGB7IG5hbWU6ICdjb25maXJtUGFzc3dvcmQnLCBsYWJlbDogJ0NvbmZpcm0nLCBjb2x1bW46ICdjb25maXJtUGFzc3dvcmQnLCBmaWVsZFR5cGU6ICdwYXNzd29yZCcgfWBcbiAqIDYuICoqVmlzaWJpbGl0eSBjb250cm9sOioqIEFsbCBjb25maWdzIHN1cHBvcnQgYHZpc2liaWxpdHk6IENvbmRpdGlvbmAgZm9yIHJvbGUtYmFzZWQvY29uZGl0aW9uYWwgZGlzcGxheVxuICogXG4gKiAqKktleSBDb25jZXB0czoqKlxuICogLSBgbmFtZWA6IFVuaXF1ZSBVSSBpZGVudGlmaWVyIChtdXN0IGJlIHVuaXF1ZSB3aXRoaW4gYSBzaW5nbGUgcHJvcGVydGllc0NvbmZpZylcbiAqIC0gYGNvbHVtbmA6IERhdGEgcGF0aCAtIGNhbiBiZSBkaXJlY3QgZmllbGQsIEpTT04gcGF0aCAoYHVzZXIuZW1haWxgKSwgb3IgY3VzdG9tIGZpZWxkXG4gKiAtIEZyb250ZW5kIHVzZXMgYGdldE5lc3RlZFZhbHVlKHJlY29yZCwgY29sdW1uKWAgZm9yIGRhdGEgYWNjZXNzIChzdXBwb3J0cyBKU09OIHBhdGhzKVxuICogXG4gKiBUaGlzIGlzIHRoZSBwcm9wZXJ0eSBlcXVpdmFsZW50IG9mIGBub3JtYWxpemVDb2x1bW5PdmVycmlkZXMoKWAuXG4gKiBcbiAqIEBwYXJhbSBmaWVsZFJlZmVyZW5jZXMgLSBBcnJheSBjb250YWluaW5nIHN0cmluZ3MgKGZpZWxkIG5hbWVzKSBvciBQcm9wZXJ0eUNvbmZpZyBvYmplY3RzXG4gKiBAcGFyYW0gYWxsUHJvcGVydGllcyAtIEFsbCBlbnRpdHkgYXR0cmlidXRlcyBmcm9tIHNjaGVtYSBmb3IgZmllbGQgbG9va3VwXG4gKiBAcGFyYW0gdHlwZSAtIFBhZ2UgdHlwZTogJ2NyZWF0ZScsICd1cGRhdGUnLCBvciAnZGV0YWlsJyAoZGV0ZXJtaW5lcyBmb3JtYXR0aW5nKVxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSBmb3IgYWNjZXNzaW5nIHJlbGF0ZWQgc2NoZW1hc1xuICogQHBhcmFtIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyAtIE9wdGlvbmFsIGdsb2JhbCBVSSBjb25maWd1cmF0aW9uIG9wdGlvbnNcbiAqIEByZXR1cm5zIEFycmF5IG9mIGZ1bGwgUHJvcGVydHlDb25maWcgb2JqZWN0c1xuICogXG4gKiBAZXhhbXBsZVxuICogLy8gMS4gU3RyaW5nIHNob3J0aGFuZCAoc2NoZW1hIGZpZWxkcyBvbmx5KVxuICogcHJvcGVydGllc0NvbmZpZzogWyd0ZWFtTmFtZScsICdjaXR5JywgJ3N0YXR1cyddXG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyAyLiBPdmVycmlkZSBzY2hlbWEgZmllbGQgZGlzcGxheVxuICogcHJvcGVydGllc0NvbmZpZzogW1xuICogICAndGVhbU5hbWUnLFxuICogICB7IG5hbWU6ICdzdGF0dXMnLCBmaWVsZFR5cGU6ICdiYWRnZScgfSwgIC8vIFNhbWUgZmllbGQsIGRpZmZlcmVudCByZW5kZXJpbmdcbiAqICAgJ3RvdGFsJ1xuICogXVxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gMy4gTXVsdGlwbGUgcmVuZGVyaW5ncyBvZiBzYW1lIGZpZWxkXG4gKiBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gKiAgIHsgbmFtZTogJ3Byb2dyZXNzQmFyJywgY29sdW1uOiAncHJvZ3Jlc3MnLCBsYWJlbDogJ1Byb2dyZXNzJywgZmllbGRUeXBlOiAncHJvZ3Jlc3MnIH0sXG4gKiAgIHsgbmFtZTogJ3Byb2dyZXNzVmFsdWUnLCBjb2x1bW46ICdwcm9ncmVzcycsIGxhYmVsOiAnVmFsdWUnLCBmaWVsZFR5cGU6ICdudW1iZXInIH1cbiAqIF1cbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIDQuIEpTT04gcGF0aHMgKG5lc3RlZCBkYXRhKVxuICogcHJvcGVydGllc0NvbmZpZzogW1xuICogICAndGVhbU5hbWUnLFxuICogICB7IG5hbWU6ICd1c2VyRW1haWwnLCBjb2x1bW46ICd1c2VyLmVtYWlsJywgbGFiZWw6ICdFbWFpbCcsIGZpZWxkVHlwZTogJ3RleHQnIH0sXG4gKiAgIHsgbmFtZTogJ3NldHRpbmdzVGhlbWUnLCBjb2x1bW46ICdtZXRhZGF0YS5zZXR0aW5ncy50aGVtZScsIGxhYmVsOiAnVGhlbWUnLCBmaWVsZFR5cGU6ICd0ZXh0JyB9XG4gKiBdXG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyA1LiBDdXN0b20vY29tcHV0ZWQgZmllbGRzIChub3QgaW4gc2NoZW1hLCBBUEkgcHJvdmlkZXMgdGhlbSlcbiAqIHByb3BlcnRpZXNDb25maWc6IFtcbiAqICAgJ3Bhc3N3b3JkJyxcbiAqICAge1xuICogICAgIG5hbWU6ICdjb25maXJtUGFzc3dvcmQnLFxuICogICAgIGxhYmVsOiAnQ29uZmlybSBQYXNzd29yZCcsXG4gKiAgICAgY29sdW1uOiAnY29uZmlybVBhc3N3b3JkJyxcbiAqICAgICBmaWVsZFR5cGU6ICdwYXNzd29yZCcsXG4gKiAgICAgcmVxdWlyZWQ6IHRydWVcbiAqICAgfVxuICogXVxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gNi4gV2l0aCB2aXNpYmlsaXR5IGNvbmZpZ1xuICogcHJvcGVydGllc0NvbmZpZzogW1xuICogICAndGVhbU5hbWUnLFxuICogICB7XG4gKiAgICAgbmFtZTogJ2FkbWluTm90ZXMnLFxuICogICAgIGxhYmVsOiAnQWRtaW4gTm90ZXMnLFxuICogICAgIGNvbHVtbjogJ2FkbWluTm90ZXMnLFxuICogICAgIGZpZWxkVHlwZTogJ3RleHRhcmVhJyxcbiAqICAgICB2aXNpYmlsaXR5OiB7IGFjdG9yOiB7IGdyb3VwczogeyBpbkxpc3Q6IFsnYWRtaW4nXSB9IH0gfVxuICogICB9XG4gKiBdXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHBhbmRQcm9wZXJ0eVJlZmVyZW5jZXMoXG4gICAgZmllbGRSZWZlcmVuY2VzOiBSZWFkb25seUFycmF5PHN0cmluZyB8IGFueT4gfCBBcnJheTxzdHJpbmcgfCBhbnk+LFxuICAgIGFsbFByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLFxuICAgIHR5cGU6ICdjcmVhdGUnIHwgJ3VwZGF0ZScgfCAnZGV0YWlsJyxcbiAgICBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+LFxuICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sgJ3VpQ29uZmlnR2VuT3B0aW9ucycgXVxuKTogYW55W10ge1xuICAgIGNvbnN0IHByb3BlcnR5TWFwID0gbmV3IE1hcDxzdHJpbmcsIFRJT1NjaGVtYUF0dHJpYnV0ZT4oKTtcbiAgICBhbGxQcm9wZXJ0aWVzLmZvckVhY2gocHJvcCA9PiB7XG4gICAgICAgIGlmIChwcm9wLmlkKSB7IC8vIFVzZSBwcm9wLmlkIChmaWVsZCBpZGVudGlmaWVyKSBub3QgcHJvcC5uYW1lIChodW1hbi1yZWFkYWJsZSBsYWJlbClcbiAgICAgICAgICAgIHByb3BlcnR5TWFwLnNldChwcm9wLmlkLCBwcm9wKTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGZpZWxkUmVmZXJlbmNlcy5tYXAocHJvcFJlZiA9PiB7XG4gICAgICAgIC8vIENhc2UgMTogU3RyaW5nIHNob3J0aGFuZCDihpIgTVVTVCBiZSBhIGRpcmVjdCBzY2hlbWEgZmllbGQgKGNvbnZlbmllbmNlIHNob3J0Y3V0KVxuICAgICAgICBpZiAodHlwZW9mIHByb3BSZWYgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICBjb25zdCBmaWVsZEF0dHJpYnV0ZSA9IHByb3BlcnR5TWFwLmdldChwcm9wUmVmKTtcbiAgICAgICAgICAgIGlmICghZmllbGRBdHRyaWJ1dGUpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgICAgICAgIGBGaWVsZCAnJHtwcm9wUmVmfScgbm90IGZvdW5kIGluIGVudGl0eSBzY2hlbWEuIGAgK1xuICAgICAgICAgICAgICAgICAgICBgQXZhaWxhYmxlIGZpZWxkIElEczogJHtBcnJheS5mcm9tKHByb3BlcnR5TWFwLmtleXMoKSkuam9pbignLCAnKX0uIGAgK1xuICAgICAgICAgICAgICAgICAgICBgXFxuRm9yIG5vbi1zY2hlbWEgZmllbGRzIChKU09OIHBhdGhzLCBjdXN0b20gZmllbGRzLCBtdWx0aXBsZSByZW5kZXJpbmdzKSwgdXNlIG9iamVjdCBzeW50YXg6XFxuYCArXG4gICAgICAgICAgICAgICAgICAgIGAgIHsgbmFtZTogJ3VuaXF1ZU5hbWUnLCBjb2x1bW46ICcke3Byb3BSZWZ9JywgbGFiZWw6ICcuLi4nLCBmaWVsZFR5cGU6ICcuLi4nIH1gXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoZmllbGRBdHRyaWJ1dGUsIHR5cGUsIGVudGl0eVNlcnZpY2UsIGFsbFByb3BlcnRpZXMsIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDYXNlIDItNTogT2JqZWN0IHN5bnRheCAocGVybWlzc2l2ZSAtIHN1cHBvcnRzIGV2ZXJ5dGhpbmcpXG4gICAgICAgIGlmICh0eXBlb2YgcHJvcFJlZiA9PT0gJ29iamVjdCcgJiYgcHJvcFJlZiAhPT0gbnVsbCkge1xuICAgICAgICAgICAgLy8gVmFsaWRhdGUgbWluaW11bSByZXF1aXJlZCBwcm9wZXJ0aWVzXG4gICAgICAgICAgICBpZiAoIXByb3BSZWYubmFtZSkge1xuICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgUHJvcGVydHkgY29uZmlnIG1pc3NpbmcgJ25hbWUnIGZpZWxkIChyZXF1aXJlZCBmb3IgVUkgaWRlbnRpZmljYXRpb24pLiBTa2lwcGluZzpgLCBwcm9wUmVmKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gcHJvcFJlZjsgLy8gUmV0dXJuIGFzLWlzLCBsZXQgZnJvbnRlbmQgaGFuZGxlXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIERldGVybWluZSB0aGUgZGF0YSBwYXRoIChjb2x1bW4gY2FuIGJlOiBkaXJlY3QgZmllbGQsIEpTT04gcGF0aCwgb3IgY3VzdG9tIGZpZWxkKVxuICAgICAgICAgICAgY29uc3QgY29sdW1uID0gcHJvcFJlZi5jb2x1bW4gfHwgcHJvcFJlZi5uYW1lO1xuXG4gICAgICAgICAgICAvLyBFeHRyYWN0IGp1c3QgdGhlIHJvb3QgZmllbGQgbmFtZSBmb3Igc2NoZW1hIGxvb2t1cCAoaGFuZGxlcyBKU09OIHBhdGhzIGxpa2UgXCJ1c2VyLmVtYWlsXCIg4oaSIFwidXNlclwiKVxuICAgICAgICAgICAgY29uc3Qgcm9vdEZpZWxkTmFtZSA9IGNvbHVtbi5zcGxpdCgnLicpWyAwIF07XG4gICAgICAgICAgICBjb25zdCBmaWVsZEF0dHJpYnV0ZSA9IHByb3BlcnR5TWFwLmdldChyb290RmllbGROYW1lKTtcblxuICAgICAgICAgICAgLy8gSWYgcm9vdCBmaWVsZCBleGlzdHMgaW4gc2NoZW1hIEFORCBjb2x1bW4gaXMgdGhlIGV4YWN0IGZpZWxkIChub3QgYSBwYXRoKSwgbWVyZ2Ugd2l0aCBzY2hlbWFcbiAgICAgICAgICAgIGlmIChmaWVsZEF0dHJpYnV0ZSAmJiBjb2x1bW4gPT09IHJvb3RGaWVsZE5hbWUpIHtcbiAgICAgICAgICAgICAgICAvLyBTY2hlbWEgZmllbGQgd2l0aCBvdmVycmlkZXMgLSBtZXJnZSBkZWZhdWx0cyArIG92ZXJyaWRlc1xuICAgICAgICAgICAgICAgIGNvbnN0IHNjaGVtYURlZmF1bHRzID0gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKGZpZWxkQXR0cmlidXRlLCB0eXBlLCBlbnRpdHlTZXJ2aWNlLCBhbGxQcm9wZXJ0aWVzLCBnbG9iYWxVSUNvbmZpZ09wdGlvbnMpO1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIC4uLnNjaGVtYURlZmF1bHRzLFxuICAgICAgICAgICAgICAgICAgICAuLi5wcm9wUmVmLCAgLy8gVXNlciBvdmVycmlkZXMgdGFrZSBwcmVjZWRlbmNlXG4gICAgICAgICAgICAgICAgICAgIGNvbHVtbiAgLy8gRW5zdXJlIGNvbHVtbiBpcyBzZXRcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBPdGhlcndpc2U6IEpTT04gcGF0aCwgY3VzdG9tIGZpZWxkLCBvciBtdWx0aXBsZSByZW5kZXJpbmcgb2Ygc2FtZSBmaWVsZFxuICAgICAgICAgICAgLy8gQXV0by1nZW5lcmF0ZSBtaXNzaW5nIHByb3BlcnRpZXMgd2l0aCBwcm9wZXIgZm9ybWF0dGluZ1xuICAgICAgICAgICAgY29uc3QgbGFiZWwgPSBwcm9wUmVmLmxhYmVsIHx8IHRvSHVtYW5SZWFkYWJsZU5hbWUocHJvcFJlZi5uYW1lKTtcbiAgICAgICAgICAgIGNvbnN0IGZpZWxkVHlwZSA9IHByb3BSZWYuZmllbGRUeXBlIHx8ICd0ZXh0JztcblxuICAgICAgICAgICAgLy8gV2FybiBpZiBsYWJlbCB3YXMgYXV0by1nZW5lcmF0ZWRcbiAgICAgICAgICAgIGlmICghcHJvcFJlZi5sYWJlbCkge1xuICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIuZGVidWcoXG4gICAgICAgICAgICAgICAgICAgIGBQcm9wZXJ0eSAnJHtwcm9wUmVmLm5hbWV9JyBtaXNzaW5nICdsYWJlbCcuIEF1dG8tZ2VuZXJhdGVkOiAnJHtsYWJlbH0nLiBgICtcbiAgICAgICAgICAgICAgICAgICAgYEZvciBjdXN0b20gZmllbGRzLCBleHBsaWNpdGx5IHByb3ZpZGU6IG5hbWUsIGxhYmVsLCBjb2x1bW4sIGZpZWxkVHlwZS5gXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghcHJvcFJlZi5maWVsZFR5cGUpIHtcbiAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLmRlYnVnKFxuICAgICAgICAgICAgICAgICAgICBgUHJvcGVydHkgJyR7cHJvcFJlZi5uYW1lfScgbWlzc2luZyAnZmllbGRUeXBlJy4gRGVmYXVsdGVkIHRvICd0ZXh0Jy4gYCArXG4gICAgICAgICAgICAgICAgICAgIGBSZWNvbW1lbmRlZCBmaWVsZCB0eXBlczogdGV4dCwgbnVtYmVyLCBzZWxlY3QsIGJhZGdlLCBwcm9ncmVzcywgZXRjLmBcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBSZXR1cm4gd2l0aCBwcm9wZXIgZm9ybWF0dGluZ1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAuLi5wcm9wUmVmLFxuICAgICAgICAgICAgICAgIGNvbHVtbixcbiAgICAgICAgICAgICAgICBsYWJlbCxcbiAgICAgICAgICAgICAgICBmaWVsZFR5cGVcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGYWxsYmFjazogdW5rbm93biB0eXBlLCByZXR1cm4gYXMtaXMgd2l0aCB3YXJuaW5nXG4gICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgVW5rbm93biBwcm9wZXJ0eSByZWZlcmVuY2UgdHlwZTpgLCBwcm9wUmVmKTtcbiAgICAgICAgcmV0dXJuIHByb3BSZWY7XG4gICAgfSk7XG59XG5cbi8qKlxuICogUHJvY2Vzc2VzIHNlY3Rpb25zQ29uZmlnIGFuZCBleHBhbmRzIGFueSBzaG9ydGhhbmQgcHJvcGVydGllc0NvbmZpZyBhcnJheXMuXG4gKiBcbiAqICoqVW5pZmllZCB3aXRoIGNvbHVtbiBwcm9jZXNzaW5nOioqXG4gKiAtIFVzZXMgYGV4cGFuZFByb3BlcnR5UmVmZXJlbmNlcygpYCAoc2FtZSBwYXR0ZXJuIGFzIGBub3JtYWxpemVDb2x1bW5PdmVycmlkZXMoKWApXG4gKiAtIFN0cmluZyBzaG9ydGhhbmQgYCdmaWVsZE5hbWUnYCDihpIgZXhwYW5kcyBmcm9tIHNjaGVtYVxuICogLSBPYmplY3Qgc3ludGF4IOKGkiBtZXJnZXMgd2l0aCBzY2hlbWEgZGVmYXVsdHNcbiAqIFxuICogUmVjdXJzaXZlbHkgd2Fsa3MgdGhyb3VnaCBzZWN0aW9uIGdyb3VwcyBhbmQgc2VjdGlvbnMuXG4gKiBcbiAqIEBwYXJhbSBzZWN0aW9uc0NvbmZpZyAtIFNlY3Rpb25zIGNvbmZpZ3VyYXRpb24gZnJvbSBlbnRpdHkgc2NoZW1hXG4gKiBAcGFyYW0gYWxsUHJvcGVydGllcyAtIEFsbCBlbnRpdHkgYXR0cmlidXRlcyBmcm9tIHNjaGVtYSBmb3IgZmllbGQgbG9va3VwXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIGZvciBhY2Nlc3NpbmcgcmVsYXRlZCBzY2hlbWFzXG4gKiBAcGFyYW0gZ2xvYmFsVUlDb25maWdPcHRpb25zIC0gT3B0aW9uYWwgZ2xvYmFsIFVJIGNvbmZpZ3VyYXRpb24gb3B0aW9uc1xuICogQHJldHVybnMgUHJvY2Vzc2VkIHNlY3Rpb25zIGNvbmZpZyB3aXRoIGV4cGFuZGVkIHByb3BlcnRpZXNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHByb2Nlc3NTZWN0aW9uc0NvbmZpZyhcbiAgICBzZWN0aW9uc0NvbmZpZzogYW55LFxuICAgIGFsbFByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLFxuICAgIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sXG4gICAgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyAndWlDb25maWdHZW5PcHRpb25zJyBdXG4pOiBhbnkge1xuICAgIGlmICghc2VjdGlvbnNDb25maWcpIHJldHVybiBzZWN0aW9uc0NvbmZpZztcblxuICAgIGNvbnN0IHByb2Nlc3NlZCA9IHsgLi4uc2VjdGlvbnNDb25maWcgfTtcblxuICAgIC8vIFByb2Nlc3Mgc2VjdGlvbnMgaW4gc2luZ2xlIGdyb3VwIGZvcm1hdCAoYmFja3dhcmQgY29tcGF0aWJsZSlcbiAgICBpZiAocHJvY2Vzc2VkLnNlY3Rpb25zKSB7XG4gICAgICAgIHByb2Nlc3NlZC5zZWN0aW9ucyA9IE9iamVjdC5lbnRyaWVzKHByb2Nlc3NlZC5zZWN0aW9ucykucmVkdWNlKChhY2MsIFsga2V5LCBzZWN0aW9uIF06IFsgc3RyaW5nLCBhbnkgXSkgPT4ge1xuICAgICAgICAgICAgYWNjWyBrZXkgXSA9IHByb2Nlc3NTZWN0aW9uQ29uZmlnKHNlY3Rpb24sIGFsbFByb3BlcnRpZXMsIGVudGl0eVNlcnZpY2UsIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyk7XG4gICAgICAgICAgICByZXR1cm4gYWNjO1xuICAgICAgICB9LCB7fSBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+KTtcbiAgICB9XG5cbiAgICAvLyBQcm9jZXNzIHNlY3Rpb24gZ3JvdXBzIChuZXcgZm9ybWF0KVxuICAgIGlmIChwcm9jZXNzZWQuc2VjdGlvbkdyb3Vwcykge1xuICAgICAgICBwcm9jZXNzZWQuc2VjdGlvbkdyb3VwcyA9IHByb2Nlc3NlZC5zZWN0aW9uR3JvdXBzLm1hcCgoZ3JvdXA6IGFueSkgPT4ge1xuICAgICAgICAgICAgaWYgKCFncm91cC5zZWN0aW9ucykgcmV0dXJuIGdyb3VwO1xuXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIC4uLmdyb3VwLFxuICAgICAgICAgICAgICAgIHNlY3Rpb25zOiBPYmplY3QuZW50cmllcyhncm91cC5zZWN0aW9ucykucmVkdWNlKChhY2MsIFsga2V5LCBzZWN0aW9uIF06IFsgc3RyaW5nLCBhbnkgXSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBhY2NbIGtleSBdID0gcHJvY2Vzc1NlY3Rpb25Db25maWcoc2VjdGlvbiwgYWxsUHJvcGVydGllcywgZW50aXR5U2VydmljZSwgZ2xvYmFsVUlDb25maWdPcHRpb25zKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGFjYztcbiAgICAgICAgICAgICAgICB9LCB7fSBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+KVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHByb2Nlc3NlZDtcbn1cblxuLyoqXG4gKiBQcm9jZXNzZXMgYSBzaW5nbGUgc2VjdGlvbiBjb25maWcgYW5kIGV4cGFuZHMgc2hvcnRoYW5kIHByb3BlcnRpZXNDb25maWcuXG4gKiBcbiAqIFVzZXMgdW5pZmllZCBgZXhwYW5kUHJvcGVydHlSZWZlcmVuY2VzKClgIGZ1bmN0aW9uLlxuICogXG4gKiBAcGFyYW0gc2VjdGlvbiAtIFNlY3Rpb24gY29uZmlndXJhdGlvblxuICogQHBhcmFtIGFsbFByb3BlcnRpZXMgLSBBbGwgZW50aXR5IGF0dHJpYnV0ZXMgZnJvbSBzY2hlbWFcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gRW50aXR5IHNlcnZpY2VcbiAqIEBwYXJhbSBnbG9iYWxVSUNvbmZpZ09wdGlvbnMgLSBPcHRpb25hbCBnbG9iYWwgVUkgY29uZmlndXJhdGlvbiBvcHRpb25zXG4gKiBAcmV0dXJucyBQcm9jZXNzZWQgc2VjdGlvbiB3aXRoIGV4cGFuZGVkIHByb3BlcnRpZXNcbiAqL1xuZnVuY3Rpb24gcHJvY2Vzc1NlY3Rpb25Db25maWcoXG4gICAgc2VjdGlvbjogYW55LFxuICAgIGFsbFByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLFxuICAgIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sXG4gICAgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyAndWlDb25maWdHZW5PcHRpb25zJyBdXG4pOiBhbnkge1xuICAgIGNvbnN0IHByb2Nlc3NlZCA9IHsgLi4uc2VjdGlvbiB9O1xuXG4gICAgLy8gUHJvY2VzcyBkZXRhaWxzUGFnZUNvbmZpZyB3aXRoIHByb3BlcnRpZXNDb25maWdcbiAgICBpZiAocHJvY2Vzc2VkLnBhZ2VUeXBlID09PSAnZGV0YWlscycgJiYgcHJvY2Vzc2VkLmRldGFpbHNQYWdlQ29uZmlnPy5wcm9wZXJ0aWVzQ29uZmlnKSB7XG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IHByb2Nlc3NlZC5kZXRhaWxzUGFnZUNvbmZpZztcbiAgICAgICAgcHJvY2Vzc2VkLmRldGFpbHNQYWdlQ29uZmlnID0ge1xuICAgICAgICAgICAgLi4uY29uZmlnLFxuICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogZXhwYW5kUHJvcGVydHlSZWZlcmVuY2VzKFxuICAgICAgICAgICAgICAgIGNvbmZpZy5wcm9wZXJ0aWVzQ29uZmlnLFxuICAgICAgICAgICAgICAgIGFsbFByb3BlcnRpZXMsXG4gICAgICAgICAgICAgICAgJ2RldGFpbCcsXG4gICAgICAgICAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgICAgICAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnNcbiAgICAgICAgICAgIClcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBQcm9jZXNzIGZvcm1QYWdlQ29uZmlnXG4gICAgaWYgKHByb2Nlc3NlZC5wYWdlVHlwZSA9PT0gJ2Zvcm0nICYmIHByb2Nlc3NlZC5mb3JtUGFnZUNvbmZpZz8ucHJvcGVydGllc0NvbmZpZykge1xuICAgICAgICBjb25zdCBjb25maWcgPSBwcm9jZXNzZWQuZm9ybVBhZ2VDb25maWc7XG4gICAgICAgIC8vIEZvcm1zIGluIHNlY3Rpb25zIGFyZSB0eXBpY2FsbHkgJ2NyZWF0ZScgZm9ybXNcbiAgICAgICAgcHJvY2Vzc2VkLmZvcm1QYWdlQ29uZmlnID0ge1xuICAgICAgICAgICAgLi4uY29uZmlnLFxuICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogZXhwYW5kUHJvcGVydHlSZWZlcmVuY2VzKFxuICAgICAgICAgICAgICAgIGNvbmZpZy5wcm9wZXJ0aWVzQ29uZmlnLFxuICAgICAgICAgICAgICAgIGFsbFByb3BlcnRpZXMsXG4gICAgICAgICAgICAgICAgJ2NyZWF0ZScsXG4gICAgICAgICAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgICAgICAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnNcbiAgICAgICAgICAgIClcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICByZXR1cm4gcHJvY2Vzc2VkO1xufVxuXG4vKipcbiAqIEZvcm1hdHMgZW50aXR5IGF0dHJpYnV0ZXMgZm9yIGNyZWF0ZSBmb3JtIHBhZ2VzLlxuICogXG4gKiBGaWx0ZXJzIGF0dHJpYnV0ZXMgdG8gaW5jbHVkZSBvbmx5IGNyZWF0YWJsZSBmaWVsZHMgKHJlc3BlY3RzIGlzQ3JlYXRhYmxlIGZsYWcpXG4gKiBhbmQgZm9ybWF0cyBlYWNoIGZvciBjcmVhdGUgZm9ybSBkaXNwbGF5LlxuICogXG4gKiBAcGFyYW0gcHJvcGVydGllcyAtIEFycmF5IG9mIGVudGl0eSBhdHRyaWJ1dGVzIGZyb20gc2NoZW1hXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIGZvciBhY2Nlc3NpbmcgcmVsYXRlZCBzY2hlbWFzXG4gKiBAcGFyYW0gZ2xvYmFsVUlDb25maWdPcHRpb25zIC0gT3B0aW9uYWwgZ2xvYmFsIFVJIGNvbmZpZ3VyYXRpb24gb3B0aW9uc1xuICogQHJldHVybnMgQXJyYXkgb2YgZm9ybWF0dGVkIGZpZWxkIG1ldGFkYXRhIGZvciBjcmVhdGUgZm9ybXNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JDcmVhdGUocHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sgJ3VpQ29uZmlnR2VuT3B0aW9ucycgXSkge1xuICAgIHJldHVybiBwcm9wZXJ0aWVzXG4gICAgICAgIC5maWx0ZXIocHJvcCA9PiBwcm9wICYmICghcHJvcC5oYXNPd25Qcm9wZXJ0eSgnaXNDcmVhdGFibGUnKSB8fCBwcm9wLmlzQ3JlYXRhYmxlKSlcbiAgICAgICAgLm1hcCgoYXR0KSA9PiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoYXR0LCAnY3JlYXRlJywgZW50aXR5U2VydmljZSwgcHJvcGVydGllcywgZ2xvYmFsVUlDb25maWdPcHRpb25zKSk7XG59XG5cbi8qKlxuICogRm9ybWF0cyBlbnRpdHkgYXR0cmlidXRlcyBmb3IgdXBkYXRlL2VkaXQgZm9ybSBwYWdlcy5cbiAqIFxuICogRmlsdGVycyBhdHRyaWJ1dGVzIHRvIGluY2x1ZGUgb25seSBlZGl0YWJsZSBmaWVsZHMgKHJlc3BlY3RzIGlzRWRpdGFibGUgZmxhZylcbiAqIGFuZCBmb3JtYXRzIGVhY2ggZm9yIHVwZGF0ZSBmb3JtIGRpc3BsYXkuXG4gKiBcbiAqIEBwYXJhbSBwcm9wZXJ0aWVzIC0gQXJyYXkgb2YgZW50aXR5IGF0dHJpYnV0ZXMgZnJvbSBzY2hlbWFcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gRW50aXR5IHNlcnZpY2UgZm9yIGFjY2Vzc2luZyByZWxhdGVkIHNjaGVtYXNcbiAqIEBwYXJhbSBnbG9iYWxVSUNvbmZpZ09wdGlvbnMgLSBPcHRpb25hbCBnbG9iYWwgVUkgY29uZmlndXJhdGlvbiBvcHRpb25zXG4gKiBAcmV0dXJucyBBcnJheSBvZiBmb3JtYXR0ZWQgZmllbGQgbWV0YWRhdGEgZm9yIHVwZGF0ZSBmb3Jtc1xuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvclVwZGF0ZShwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSwgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PiwgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyAndWlDb25maWdHZW5PcHRpb25zJyBdKSB7XG4gICAgcmV0dXJuIHByb3BlcnRpZXNcbiAgICAgICAgLmZpbHRlcihwcm9wID0+IHByb3AgJiYgKCFwcm9wLmhhc093blByb3BlcnR5KCdpc0VkaXRhYmxlJykgfHwgcHJvcC5pc0VkaXRhYmxlKSlcbiAgICAgICAgLm1hcCgoYXR0KSA9PiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoYXR0LCAndXBkYXRlJywgZW50aXR5U2VydmljZSwgcHJvcGVydGllcywgZ2xvYmFsVUlDb25maWdPcHRpb25zKSk7XG59XG5cbi8qKlxuICogRm9ybWF0cyBlbnRpdHkgYXR0cmlidXRlcyBmb3IgZGV0YWlsL3ZpZXcgcGFnZXMuXG4gKiBcbiAqIEZpbHRlcnMgYXR0cmlidXRlcyB0byBpbmNsdWRlIG9ubHkgdmlzaWJsZSBmaWVsZHMgKHJlc3BlY3RzIGlzVmlzaWJsZSBmbGFnKVxuICogYW5kIGZvcm1hdHMgZWFjaCBmb3IgZGV0YWlsIHBhZ2UgZGlzcGxheS5cbiAqIFxuICogQHBhcmFtIHByb3BlcnRpZXMgLSBBcnJheSBvZiBlbnRpdHkgYXR0cmlidXRlcyBmcm9tIHNjaGVtYVxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSBmb3IgYWNjZXNzaW5nIHJlbGF0ZWQgc2NoZW1hc1xuICogQHBhcmFtIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyAtIE9wdGlvbmFsIGdsb2JhbCBVSSBjb25maWd1cmF0aW9uIG9wdGlvbnNcbiAqIEByZXR1cm5zIEFycmF5IG9mIGZvcm1hdHRlZCBmaWVsZCBtZXRhZGF0YSBmb3IgZGV0YWlsIHZpZXdzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRGV0YWlsKHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLCBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+LCBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbICd1aUNvbmZpZ0dlbk9wdGlvbnMnIF0pIHtcbiAgICByZXR1cm4gcHJvcGVydGllc1xuICAgICAgICAuZmlsdGVyKHByb3AgPT4gcHJvcCAmJiAoIXByb3AuaGFzT3duUHJvcGVydHkoJ2lzVmlzaWJsZScpIHx8IHByb3AuaXNWaXNpYmxlKSlcbiAgICAgICAgLm1hcCgoYXR0KSA9PiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoYXR0LCAnZGV0YWlsJywgZW50aXR5U2VydmljZSwgcHJvcGVydGllcywgZ2xvYmFsVUlDb25maWdPcHRpb25zKSk7XG59XG5cbi8qKlxuICogVHlwZSBkZWZpbml0aW9uIGZvciBsaXN0L3RhYmxlIGNvbHVtbiBjb25maWd1cmF0aW9uLlxuICogXG4gKiBFeHRlbmRzIEZpZWxkTWV0YWRhdGEgd2l0aCBsaXN0LXNwZWNpZmljIHByb3BlcnRpZXMgbGlrZSBhY3Rpb25zLCB0ZW1wbGF0ZXMsXG4gKiBhbmQgcmVsYXRpb24gcmVuZGVyaW5nIGNvbmZpZ3VyYXRpb25zLlxuICovXG5leHBvcnQgdHlwZSBMaXN0aW5nUHJvcENvbmZpZyA9IFBpY2s8RmllbGRNZXRhZGF0YSwgJ2ZpZWxkVHlwZScgfCAncGxhY2Vob2xkZXInIHwgJ2hlbHBUZXh0JyB8ICdmaWx0ZXJDb25maWcnPiAmIHtcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgZGF0YUluZGV4OiBzdHJpbmcsXG4gICAgaGlkZGVuPzogYm9vbGVhbixcbiAgICBhY3Rpb25zPzogQXJyYXk8SUVudGl0eVBhZ2VBY3Rpb24+LFxuICAgIHJlbGF0aW9uQ29uZmlnPzogSVJlbGF0aW9uRmllbGRDb25maWcsICAvLyBGb3IgcmVuZGVyaW5nIHJlbGF0aW9ucyB3aXRoIGxpbmtzL21vZGFsc1xuICAgIHRlbXBsYXRlPzogVGVtcGxhdGUsICAvLyBGb3IgdGVtcGxhdGUtYmFzZWQgcmVuZGVyaW5nXG4gICAgaXNJZGVudGlmaWVyPzogYm9vbGVhbiwgIC8vIEZvciBpZGVudGlmaWVyIGZpZWxkc1xuICAgIC8qKiBAZGVwcmVjYXRlZCBPcHRpb25hbCAtIHByZXNlbmNlIG9mIGxpbmtDb25maWcgaXMgc3VmZmljaWVudCAqL1xuICAgIGlzTGluaz86IGJvb2xlYW4sICAvLyBGb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxuICAgIGxpbmtDb25maWc/OiB7IHJvdXRlUGF0dGVybjogc3RyaW5nOyBkaXNwbGF5VGV4dD86IFRlbXBsYXRlIH0sICAvLyBGb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eSAtIHN1cHBvcnRzIHRlbXBsYXRlc1xufTtcblxuLyoqXG4gKiBGb3JtYXRzIGVudGl0eSBhdHRyaWJ1dGVzIGZvciBsaXN0L3RhYmxlIGRpc3BsYXkuXG4gKiBcbiAqIFRyYW5zZm9ybXMgc2NoZW1hIGF0dHJpYnV0ZXMgaW50byB0YWJsZSBjb2x1bW4gY29uZmlndXJhdGlvbnMgd2l0aDpcbiAqIC0gQXV0by1nZW5lcmF0ZWQgZmlsdGVyIGNvbmZpZ3VyYXRpb25zIGZvciBmaWx0ZXJhYmxlIGNvbHVtbnNcbiAqIC0gUmVsYXRpb24gZGlzcGxheSBjb25maWd1cmF0aW9ucyB3aXRoIGxpbmtzIGFuZCBtb2RhbCBzdXBwb3J0XG4gKiAtIFRlbXBsYXRlLWJhc2VkIHJlbmRlcmluZyBmb3IgZHVwbGljYXRlZCByZWxhdGlvbiBmaWVsZHNcbiAqIC0gUHJvcGVyIGZpZWxkIHR5cGVzIGFuZCB2aXNpYmlsaXR5IGhhbmRsaW5nXG4gKiBcbiAqIFRoaXMgaXMgdGhlIG1haW4gZW50cnkgcG9pbnQgZm9yIGdlbmVyYXRpbmcgdGFibGUgY29sdW1uIGNvbmZpZ3VyYXRpb25zIGZyb20gZW50aXR5IHNjaGVtYXMuXG4gKiBcbiAqIEBwYXJhbSBlbnRpdHlOYW1lIC0gTmFtZSBvZiB0aGUgZW50aXR5IChmb3IgZ2VuZXJhdGluZyByb3V0ZSBwYXR0ZXJucylcbiAqIEBwYXJhbSBwcm9wZXJ0aWVzIC0gQXJyYXkgb2YgZW50aXR5IGF0dHJpYnV0ZXMgZnJvbSBzY2hlbWFcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gRW50aXR5IHNlcnZpY2UgZm9yIGFjY2Vzc2luZyByZWxhdGVkIHNjaGVtYXNcbiAqIEBwYXJhbSBnbG9iYWxVSUNvbmZpZ09wdGlvbnMgLSBPcHRpb25hbCBnbG9iYWwgVUkgY29uZmlndXJhdGlvbiBvcHRpb25zXG4gKiBAcmV0dXJucyBBcnJheSBvZiBmb3JtYXR0ZWQgY29sdW1uIGNvbmZpZ3VyYXRpb25zIGZvciB0YWJsZSBkaXNwbGF5XG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBjb2x1bW5zID0gZm9ybWF0RW50aXR5QXR0cmlidXRlc0Zvckxpc3QoXG4gKiAgICdnYW1lJyxcbiAqICAgZ2FtZVNjaGVtYS5hdHRyaWJ1dGVzLFxuICogICBnYW1lU2VydmljZSxcbiAqICAgZ2xvYmFsQ29uZmlnXG4gKiApO1xuICogLy8gUmV0dXJucyBhcnJheSBvZiBjb2x1bW4gY29uZmlncyB3aXRoIGZpbHRlcnMsIHJlbGF0aW9ucywgYW5kIHRlbXBsYXRlc1xuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yTGlzdChcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgcHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sXG4gICAgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PixcbiAgICB7XG4gICAgICAgIENSVURBcGlQYXRoLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluVXBkYXRlLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluRGVsZXRlLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluRGV0YWlsLFxuICAgICAgICBjdXN0b21Sb3dBY3Rpb25zLFxuICAgICAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnNcbiAgICB9OiB7XG4gICAgICAgIENSVURBcGlQYXRoPzogc3RyaW5nLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluVXBkYXRlPzogYm9vbGVhbixcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pbkRlbGV0ZT86IGJvb2xlYW4sXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZXRhaWw/OiBib29sZWFuLFxuICAgICAgICBjdXN0b21Sb3dBY3Rpb25zPzogUmVhZG9ubHlBcnJheTxJRW50aXR5UGFnZUFjdGlvbj4gfCBBcnJheTxJRW50aXR5UGFnZUFjdGlvbj4sXG4gICAgICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sgJ3VpQ29uZmlnR2VuT3B0aW9ucycgXSAgLy8gTkVXOiBHbG9iYWwgY29uZmlnIG9wdGlvbnNcbiAgICB9XG4pIHtcblxuICAgIGNvbnN0IGVudGl0eU5hbWVMb3dlciA9IGVudGl0eU5hbWUudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBlbnRpdHlOYW1lUGFzY2FsQ2FzZSA9IHBhc2NhbENhc2UoZW50aXR5TmFtZSk7XG5cbiAgICByZXR1cm4gcHJvcGVydGllc1xuICAgICAgICAuZmlsdGVyKHByb3AgPT4gcHJvcCAmJiBwcm9wLmlzTGlzdGFibGUpXG4gICAgICAgIC5tYXAocHJvcCA9PiB7XG4gICAgICAgICAgICAvLyBVc2Ugc2FtZSBmb3JtYXR0aW5nIGxvZ2ljIGFzIGRldGFpbHMvZm9ybXMgKGluY2x1ZGVzIHJlbGF0aW9uQ29uZmlnIGdlbmVyYXRpb24pXG4gICAgICAgICAgICAvLyBQYXNzIGFsbCBwcm9wZXJ0aWVzIHNvIGl0IGNhbiBkZXRlY3QgZHVwbGljYXRlZCByZWxhdGlvbiBmaWVsZHMgKGUuZy4sIHRlYW1OYW1lIGZvciB0ZWFtSWQpXG4gICAgICAgICAgICBjb25zdCBmb3JtYXR0ZWQgPSBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwocHJvcCwgJ2RldGFpbCcsIGVudGl0eVNlcnZpY2UsIHByb3BlcnRpZXMsIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyk7XG5cbiAgICAgICAgICAgIC8vIEF1dG8tZ2VuZXJhdGUgZmlsdGVyQ29uZmlnIGlmIG5vdCBhbHJlYWR5IHByZXNlbnQgYW5kIGZpZWxkIGlzIGZpbHRlcmFibGVcbiAgICAgICAgICAgIGNvbnN0IGF1dG9HZW5lcmF0ZWRGaWx0ZXJDb25maWcgPSAhZm9ybWF0dGVkLmZpbHRlckNvbmZpZyAmJiBwcm9wLmlzRmlsdGVyYWJsZSAhPT0gZmFsc2VcbiAgICAgICAgICAgICAgICA/IGdlbmVyYXRlRmlsdGVyQ29uZmlnKHByb3AsIGVudGl0eVNlcnZpY2UsIGdsb2JhbFVJQ29uZmlnT3B0aW9ucylcbiAgICAgICAgICAgICAgICA6IHVuZGVmaW5lZDtcblxuICAgICAgICAgICAgLy8gT3ZlcnJpZGUvYWRkIGxpc3Qtc3BlY2lmaWMgcHJvcGVydGllc1xuICAgICAgICAgICAgY29uc3QgcHJvcENvbmZpZzogTGlzdGluZ1Byb3BDb25maWcgPSB7XG4gICAgICAgICAgICAgICAgLi4uZm9ybWF0dGVkLFxuICAgICAgICAgICAgICAgIG5hbWU6IGZvcm1hdHRlZC5sYWJlbCB8fCBmb3JtYXR0ZWQubmFtZSwgIC8vIEVuc3VyZSBuYW1lIGlzIHNldCBmb3IgdGFibGUgY29sdW1uIGhlYWRlclxuICAgICAgICAgICAgICAgIGRhdGFJbmRleDogYCR7cHJvcC5pZH1gLFxuICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogZm9ybWF0dGVkLmZpZWxkVHlwZSB8fCAndGV4dCcsXG4gICAgICAgICAgICAgICAgZmlsdGVyQ29uZmlnOiBmb3JtYXR0ZWQuZmlsdGVyQ29uZmlnIHx8IGF1dG9HZW5lcmF0ZWRGaWx0ZXJDb25maWcsICAvLyBVc2UgZXhwbGljaXQgb3IgYXV0by1nZW5lcmF0ZWRcbiAgICAgICAgICAgICAgICBoaWRkZW46IHByb3AuaGFzT3duUHJvcGVydHkoJ2lzVmlzaWJsZScpICYmICFwcm9wLmlzVmlzaWJsZVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgaWYgKHByb3AuaXNJZGVudGlmaWVyKSB7XG4gICAgICAgICAgICAgICAgLy8gQnVpbGQgZGVmYXVsdCByb3cgYWN0aW9ucyB3aXRoIElEc1xuICAgICAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRBY3Rpb25zOiBBcnJheTxJRW50aXR5UGFnZUFjdGlvbj4gPSBbXTtcblxuICAgICAgICAgICAgICAgIGlmICghZXhjbHVkZUZyb21BZG1pbkRldGFpbCkge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0QWN0aW9ucy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlkOiAndmlldycsXG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uOiAndmlldycsXG4gICAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ1ZpZXcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGU6IGBWaWV3IHske3Byb3AuaWR9fWAsXG4gICAgICAgICAgICAgICAgICAgICAgICB1cmw6IGAvdmlldy0ke2VudGl0eU5hbWVMb3dlcn1gXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmICghZXhjbHVkZUZyb21BZG1pblVwZGF0ZSkge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0QWN0aW9ucy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlkOiAnZWRpdCcsXG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uOiAnZWRpdCcsXG4gICAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0VkaXQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGU6IGBFZGl0IHske3Byb3AuaWR9fWAsXG4gICAgICAgICAgICAgICAgICAgICAgICB1cmw6IGAvZWRpdC0ke2VudGl0eU5hbWVMb3dlcn1gXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmICghZXhjbHVkZUZyb21BZG1pbkRlbGV0ZSkge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0QWN0aW9ucy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlkOiAnZGVsZXRlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb246ICdkZWxldGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdEZWxldGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGU6IGBEZWxldGUgeyR7cHJvcC5pZH19YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIG9wZW5Jbk1vZGFsOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgbW9kYWxDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RhbFR5cGU6ICdjb25maXJtJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RhbFBhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGl0bGU6IGBEZWxldGUgJHtlbnRpdHlOYW1lUGFzY2FsQ2FzZX0/YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudDogYEFyZSB5b3Ugc3VyZSB5b3Ugd2FudCB0byBkZWxldGUgdGhpcyAke2VudGl0eU5hbWVQYXNjYWxDYXNlfT8gVGhpcyBhY3Rpb24gY2Fubm90IGJlIHVuZG9uZS5gXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhcGlDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXBpTWV0aG9kOiBgREVMRVRFYCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzcG9uc2VLZXk6IGVudGl0eU5hbWVMb3dlcixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXBpVXJsOiBgJHtDUlVEQXBpUGF0aCA/IENSVURBcGlQYXRoIDogJyd9LyR7ZW50aXR5TmFtZUxvd2VyfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzTWVzc2FnZTogYCR7ZW50aXR5TmFtZVBhc2NhbENhc2V9IGRlbGV0ZWQgc3VjY2Vzc2Z1bGx5YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlcnJvck1lc3NhZ2U6IGBGYWlsZWQgdG8gZGVsZXRlICR7ZW50aXR5TmFtZVBhc2NhbENhc2V9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdWJtaXRTdWNjZXNzUmVkaXJlY3Q6IGAvbGlzdC0ke2VudGl0eU5hbWVMb3dlcn1gXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIC8vIE1lcmdlIGN1c3RvbSByb3cgYWN0aW9ucyB1c2luZyBpZGVudGlmaWVyLWJhc2VkIG92ZXJyaWRlXG4gICAgICAgICAgICAgICAgcHJvcENvbmZpZy5hY3Rpb25zID0gY3VzdG9tUm93QWN0aW9uc1xuICAgICAgICAgICAgICAgICAgICA/IG1lcmdlQWN0aW9ucyhkZWZhdWx0QWN0aW9ucywgY3VzdG9tUm93QWN0aW9ucylcbiAgICAgICAgICAgICAgICAgICAgOiBkZWZhdWx0QWN0aW9ucztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHByb3BDb25maWc7XG4gICAgICAgIH0pO1xufVxuXG4vKipcbiAqIE1FUkdFIFVUSUxJVFkgRlVOQ1RJT05TXG4gKiBcbiAqIFRoZXNlIGZ1bmN0aW9ucyBpbXBsZW1lbnQgdGhlIGlkZW50aWZpZXItYmFzZWQgb3ZlcnJpZGUgcGF0dGVybjpcbiAqIC0gRGVmYXVsdHMgaGF2ZSBzdGFuZGFyZCBpZGVudGlmaWVycyAoZS5nLiwgJ3ZpZXcnLCAnZWRpdCcsICdkZWxldGUnKVxuICogLSBDdXN0b20gY29uZmlncyB3aXRoIHNhbWUgaWRlbnRpZmllciBvdmVycmlkZSB0aGUgZGVmYXVsdFxuICogLSBOZXcgaWRlbnRpZmllcnMgZ2V0IGFkZGVkIHRvIHRoZSByZXN1bHRcbiAqL1xuXG4vKipcbiAqIE1lcmdlIGRlZmF1bHQgYnV0dG9ucyB3aXRoIGN1c3RvbSBidXR0b25zIHVzaW5nIGlkZW50aWZpZXItYmFzZWQgb3ZlcnJpZGUuXG4gKiBcbiAqIEBwYXJhbSBkZWZhdWx0cyAtIERlZmF1bHQgYnV0dG9ucyAoZnJvbSBnZW5lcmF0b3IpXG4gKiBAcGFyYW0gY3VzdG9tcyAtIEN1c3RvbSBidXR0b25zIChmcm9tIGVudGl0eSBzY2hlbWEpXG4gKiBAcmV0dXJucyBNZXJnZWQgYnV0dG9uIGFycmF5XG4gKi9cbi8qKlxuICogTWVyZ2VzIGRlZmF1bHQgYnV0dG9ucyB3aXRoIGN1c3RvbSBidXR0b25zIHVzaW5nIElELWJhc2VkIG92ZXJyaWRlIGxvZ2ljLlxuICogXG4gKiBDdXN0b20gYnV0dG9ucyB3aXRoIG1hdGNoaW5nIElEcyBvdmVycmlkZSBkZWZhdWx0cywgYW5kIG5ldyBjdXN0b20gYnV0dG9ucyBhcmUgYXBwZW5kZWQuXG4gKiBCdXR0b25zIHdpdGhvdXQgSURzIGFyZSBhbHdheXMgaW5jbHVkZWQgKG5vIGRlZHVwbGljYXRpb24pLlxuICogXG4gKiBAdGVtcGxhdGUgVCAtIEJ1dHRvbiB0eXBlIHdpdGggb3B0aW9uYWwgaWQgcHJvcGVydHlcbiAqIEBwYXJhbSBkZWZhdWx0cyAtIERlZmF1bHQgYnV0dG9uIGNvbmZpZ3VyYXRpb25zXG4gKiBAcGFyYW0gY3VzdG9tcyAtIEN1c3RvbSBidXR0b24gY29uZmlndXJhdGlvbnMgdG8gbWVyZ2VcbiAqIEByZXR1cm5zIE1lcmdlZCBhcnJheSB3aXRoIGN1c3RvbSBvdmVycmlkZXMgYXBwbGllZFxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY29uc3QgZGVmYXVsdHMgPSBbXG4gKiAgIHsgaWQ6ICdzYXZlJywgbGFiZWw6ICdTYXZlJywgYWN0aW9uOiAnc3VibWl0JyB9LFxuICogICB7IGlkOiAnY2FuY2VsJywgbGFiZWw6ICdDYW5jZWwnLCBhY3Rpb246ICdjYW5jZWwnIH1cbiAqIF07XG4gKiBjb25zdCBjdXN0b21zID0gW1xuICogICB7IGlkOiAnc2F2ZScsIGxhYmVsOiAnU2F2ZSBDaGFuZ2VzJywgYWN0aW9uOiAnc3VibWl0JyB9LCAvLyBPdmVycmlkZVxuICogICB7IGlkOiAnZGVsZXRlJywgbGFiZWw6ICdEZWxldGUnLCBhY3Rpb246ICdkZWxldGUnIH0gICAgICAvLyBOZXdcbiAqIF07XG4gKiBjb25zdCBtZXJnZWQgPSBtZXJnZUJ1dHRvbnMoZGVmYXVsdHMsIGN1c3RvbXMpO1xuICogLy8gUmV0dXJuczogW1xuICogLy8gICB7IGlkOiAnc2F2ZScsIGxhYmVsOiAnU2F2ZSBDaGFuZ2VzJywgYWN0aW9uOiAnc3VibWl0JyB9LFxuICogLy8gICB7IGlkOiAnY2FuY2VsJywgbGFiZWw6ICdDYW5jZWwnLCBhY3Rpb246ICdjYW5jZWwnIH0sXG4gKiAvLyAgIHsgaWQ6ICdkZWxldGUnLCBsYWJlbDogJ0RlbGV0ZScsIGFjdGlvbjogJ2RlbGV0ZScgfVxuICogLy8gXVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZUJ1dHRvbnM8VCBleHRlbmRzIHsgaWQ/OiBzdHJpbmcgfT4oXG4gICAgZGVmYXVsdHM6IEFycmF5PFQ+LFxuICAgIGN1c3RvbXM6IFJlYWRvbmx5QXJyYXk8VD4gfCBBcnJheTxUPiA9IFtdXG4pOiBBcnJheTxUPiB7XG4gICAgY29uc3QgY3VzdG9tc0FycmF5ID0gWyAuLi5jdXN0b21zIF07ICAvLyBDb252ZXJ0IHRvIG11dGFibGUgYXJyYXlcbiAgICBjb25zdCBjdXN0b21NYXAgPSBuZXcgTWFwKFxuICAgICAgICBjdXN0b21zQXJyYXkuZmlsdGVyKGMgPT4gYy5pZCkubWFwKGMgPT4gWyBjLmlkLCBjIF0pXG4gICAgKTtcblxuICAgIC8vIFN0YXJ0IHdpdGggZGVmYXVsdHMsIHJlcGxhY2UgaWYgY3VzdG9tIGhhcyBzYW1lIGlkXG4gICAgY29uc3QgbWVyZ2VkID0gZGVmYXVsdHMubWFwKGRlZmF1bHRCdG4gPT5cbiAgICAgICAgZGVmYXVsdEJ0bi5pZCAmJiBjdXN0b21NYXAuaGFzKGRlZmF1bHRCdG4uaWQpXG4gICAgICAgICAgICA/IGN1c3RvbU1hcC5nZXQoZGVmYXVsdEJ0bi5pZCkhICAvLyBPdmVycmlkZVxuICAgICAgICAgICAgOiBkZWZhdWx0QnRuXG4gICAgKTtcblxuICAgIC8vIEFkZCBjdXN0b20gYnV0dG9ucyB0aGF0IGRvbid0IG92ZXJyaWRlIGRlZmF1bHRzXG4gICAgY3VzdG9tc0FycmF5LmZvckVhY2goY3VzdG9tQnRuID0+IHtcbiAgICAgICAgaWYgKCFjdXN0b21CdG4uaWQgfHwgIWRlZmF1bHRzLnNvbWUoZCA9PiBkLmlkID09PSBjdXN0b21CdG4uaWQpKSB7XG4gICAgICAgICAgICBtZXJnZWQucHVzaChjdXN0b21CdG4pOyAgLy8gQWRkIG5ld1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gbWVyZ2VkO1xufVxuXG4vKipcbiAqIE1lcmdlcyBkZWZhdWx0IGFjdGlvbnMgd2l0aCBjdXN0b20gYWN0aW9ucyB1c2luZyBJRC1iYXNlZCBvdmVycmlkZSBsb2dpYy5cbiAqIFxuICogRGVsZWdhdGVzIHRvIG1lcmdlQnV0dG9ucyB3aXRoIHRoZSBzYW1lIGJlaGF2aW9yOiBjdXN0b20gYWN0aW9ucyB3aXRoIG1hdGNoaW5nIElEc1xuICogb3ZlcnJpZGUgZGVmYXVsdHMsIGFuZCBuZXcgY3VzdG9tIGFjdGlvbnMgYXJlIGFwcGVuZGVkLiBTZW1hbnRpY2FsbHkgbmFtZWQgZm9yIHJvdy90YWJsZSBhY3Rpb25zLlxuICogXG4gKiBAdGVtcGxhdGUgVCAtIEFjdGlvbiB0eXBlIHdpdGggb3B0aW9uYWwgaWQgcHJvcGVydHlcbiAqIEBwYXJhbSBkZWZhdWx0cyAtIERlZmF1bHQgYWN0aW9uIGNvbmZpZ3VyYXRpb25zXG4gKiBAcGFyYW0gY3VzdG9tcyAtIEN1c3RvbSBhY3Rpb24gY29uZmlndXJhdGlvbnMgdG8gbWVyZ2VcbiAqIEByZXR1cm5zIE1lcmdlZCBhcnJheSB3aXRoIGN1c3RvbSBvdmVycmlkZXMgYXBwbGllZFxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY29uc3QgZGVmYXVsdHMgPSBbXG4gKiAgIHsgaWQ6ICdlZGl0JywgbGFiZWw6ICdFZGl0JywgYWN0aW9uOiAnZWRpdCcgfSxcbiAqICAgeyBpZDogJ2RlbGV0ZScsIGxhYmVsOiAnRGVsZXRlJywgYWN0aW9uOiAnZGVsZXRlJyB9XG4gKiBdO1xuICogY29uc3QgY3VzdG9tcyA9IFtcbiAqICAgeyBpZDogJ2RlbGV0ZScsIGxhYmVsOiAnUmVtb3ZlJywgYWN0aW9uOiAnZGVsZXRlJywgY29uZmlybTogdHJ1ZSB9IC8vIE92ZXJyaWRlXG4gKiBdO1xuICogY29uc3QgbWVyZ2VkID0gbWVyZ2VBY3Rpb25zKGRlZmF1bHRzLCBjdXN0b21zKTtcbiAqIC8vIFJldHVybnM6IFtcbiAqIC8vICAgeyBpZDogJ2VkaXQnLCBsYWJlbDogJ0VkaXQnLCBhY3Rpb246ICdlZGl0JyB9LFxuICogLy8gICB7IGlkOiAnZGVsZXRlJywgbGFiZWw6ICdSZW1vdmUnLCBhY3Rpb246ICdkZWxldGUnLCBjb25maXJtOiB0cnVlIH1cbiAqIC8vIF1cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VBY3Rpb25zPFQgZXh0ZW5kcyB7IGlkPzogc3RyaW5nIH0+KFxuICAgIGRlZmF1bHRzOiBBcnJheTxUPixcbiAgICBjdXN0b21zOiBSZWFkb25seUFycmF5PFQ+IHwgQXJyYXk8VD4gPSBbXVxuKTogQXJyYXk8VD4ge1xuICAgIHJldHVybiBtZXJnZUJ1dHRvbnMoZGVmYXVsdHMsIFsgLi4uY3VzdG9tcyBdKTsgIC8vIFNwcmVhZCB0byBoYW5kbGUgYm90aCByZWFkb25seSBhbmQgbXV0YWJsZVxufVxuXG4vKipcbiAqIEdyb3VwcyBwYWdlIGhlYWRlciBhY3Rpb25zIGludG8gcHJpbWFyeSAodG9wLWxldmVsIGJ1dHRvbnMpIGFuZCBzZWNvbmRhcnkgKGluc2lkZSBhIFwiTW9yZVwiIGRyb3Bkb3duKS5cbiAqIFdoZW4gYXV0b0dyb3VwIGlzIGZhbHNlLCByZXR1cm5zIGFsbCBhY3Rpb25zIGFzIGEgZmxhdCBhcnJheSAobm8gZ3JvdXBpbmcpLlxuICogXG4gKiBHdWFyYW50ZWVzIGF0IGxlYXN0IG9uZSB2aXNpYmxlIHRvcC1sZXZlbCBhY3Rpb246IGlmIHByaW1hcnlBY3Rpb25zIGlzIGVtcHR5LFxuICogdGhlIGZpcnN0IHNlY29uZGFyeSBhY3Rpb24gaXMgcHJvbW90ZWQgdG8gdG9wLWxldmVsIGluc3RlYWQgb2YgYmVpbmcgYnVyaWVkIGluIFwiTW9yZVwiLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZ3JvdXBQYWdlSGVhZGVyQWN0aW9ucyhcbiAgICBwcmltYXJ5QWN0aW9uczogQXJyYXk8SUVudGl0eVBhZ2VBY3Rpb24+LFxuICAgIHNlY29uZGFyeUFjdGlvbnM6IEFycmF5PElFbnRpdHlQYWdlQWN0aW9uPixcbiAgICBhdXRvR3JvdXA6IGJvb2xlYW5cbik6IEFycmF5PElFbnRpdHlQYWdlQWN0aW9uPiB7XG4gICAgaWYgKCFhdXRvR3JvdXAgfHwgc2Vjb25kYXJ5QWN0aW9ucy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIFsgLi4ucHJpbWFyeUFjdGlvbnMsIC4uLnNlY29uZGFyeUFjdGlvbnMgXTtcbiAgICB9XG5cbiAgICBjb25zdCB0b3BMZXZlbCA9IFsgLi4ucHJpbWFyeUFjdGlvbnMgXTtcbiAgICBsZXQgcmVtYWluaW5nID0gc2Vjb25kYXJ5QWN0aW9ucztcblxuICAgIC8vIFByb21vdGUgZmlyc3Qgc2Vjb25kYXJ5IGFjdGlvbiBpZiBub3RoaW5nIGlzIHZpc2libGUgYXQgdG9wIGxldmVsXG4gICAgaWYgKHRvcExldmVsLmxlbmd0aCA9PT0gMCAmJiByZW1haW5pbmcubGVuZ3RoID4gMCkge1xuICAgICAgICB0b3BMZXZlbC5wdXNoKHJlbWFpbmluZ1swXSk7XG4gICAgICAgIHJlbWFpbmluZyA9IHJlbWFpbmluZy5zbGljZSgxKTtcbiAgICB9XG5cbiAgICBpZiAocmVtYWluaW5nLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICByZXR1cm4gdG9wTGV2ZWw7XG4gICAgfVxuXG4gICAgY29uc3QgbW9yZURyb3Bkb3duOiBJRW50aXR5UGFnZUFjdGlvbiA9IHtcbiAgICAgICAgaWQ6ICdtb3JlLWFjdGlvbnMnLFxuICAgICAgICBsYWJlbDogJ01vcmUnLFxuICAgICAgICB0eXBlOiAnZHJvcGRvd24nLFxuICAgICAgICBpdGVtczogcmVtYWluaW5nLFxuICAgIH07XG5cbiAgICByZXR1cm4gWyAuLi50b3BMZXZlbCwgbW9yZURyb3Bkb3duIF07XG59XG5cbi8qKlxuICogTWVyZ2VzIGRlZmF1bHQgZmlsdGVyIHNlZ21lbnRzIHdpdGggY3VzdG9tIHNlZ21lbnRzIHVzaW5nIElELWJhc2VkIG92ZXJyaWRlIGxvZ2ljLlxuICogXG4gKiBGb2xsb3dzIHRoZSBzYW1lIHBhdHRlcm4gYXMgbWVyZ2VCdXR0b25zL21lcmdlQWN0aW9uczogY3VzdG9tIHNlZ21lbnRzIHdpdGggbWF0Y2hpbmcgSURzXG4gKiBvdmVycmlkZSBkZWZhdWx0cywgYW5kIG5ldyBjdXN0b20gc2VnbWVudHMgYXJlIGFwcGVuZGVkLlxuICogXG4gKiBAcGFyYW0gZGVmYXVsdHMgLSBEZWZhdWx0IHNlZ21lbnQgY29uZmlndXJhdGlvbnNcbiAqIEBwYXJhbSBjdXN0b21zIC0gQ3VzdG9tIHNlZ21lbnQgY29uZmlndXJhdGlvbnMgdG8gbWVyZ2VcbiAqIEByZXR1cm5zIE1lcmdlZCBhcnJheSB3aXRoIGN1c3RvbSBvdmVycmlkZXMgYXBwbGllZFxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY29uc3QgZGVmYXVsdHMgPSBbXG4gKiAgIHsgaWQ6ICdhY3RpdmUnLCBsYWJlbDogJ0FjdGl2ZScsIGZpbHRlcnM6IHsgc3RhdHVzOiB7IGVxOiAnYWN0aXZlJyB9IH0gfSxcbiAqICAgeyBpZDogJ2luYWN0aXZlJywgbGFiZWw6ICdJbmFjdGl2ZScsIGZpbHRlcnM6IHsgc3RhdHVzOiB7IGVxOiAnaW5hY3RpdmUnIH0gfSB9XG4gKiBdO1xuICogY29uc3QgY3VzdG9tcyA9IFtcbiAqICAgeyBpZDogJ2FyY2hpdmVkJywgbGFiZWw6ICdBcmNoaXZlZCcsIGZpbHRlcnM6IHsgYXJjaGl2ZWQ6IHsgZXE6IHRydWUgfSB9IH1cbiAqIF07XG4gKiBjb25zdCByZXN1bHQgPSBtZXJnZVNlZ21lbnRzKGRlZmF1bHRzLCBjdXN0b21zKTtcbiAqIC8vIFJldHVybnM6IFthY3RpdmUsIGluYWN0aXZlLCBhcmNoaXZlZF1cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VTZWdtZW50czxUIGV4dGVuZHMgeyBpZDogc3RyaW5nIH0+KFxuICAgIGRlZmF1bHRzOiBBcnJheTxUPixcbiAgICBjdXN0b21zOiBSZWFkb25seUFycmF5PFQ+IHwgQXJyYXk8VD4gPSBbXVxuKTogQXJyYXk8VD4ge1xuICAgIHJldHVybiBtZXJnZUJ1dHRvbnMoZGVmYXVsdHMsIFsgLi4uY3VzdG9tcyBdKTsgIC8vIFJldXNlIG1lcmdlQnV0dG9ucyBsb2dpYyB3aXRoIGlkLWJhc2VkIG92ZXJyaWRlXG59XG5cbi8qKlxuICogTWVyZ2VzIGZpZWxkLWxldmVsIHZpc2liaWxpdHksIGVuYWJsZW1lbnQsIGhlbHAgdGV4dCwgYW5kIHBsYWNlaG9sZGVyIG92ZXJyaWRlcyBpbnRvIGJhc2UgcHJvcGVydGllcy5cbiAqIFxuICogQXBwbGllcyBjdXN0b20gZmllbGQgY29uZmlndXJhdGlvbnMgZnJvbSBmb3JtL2RldGFpbCBjb25maWcgdG8gYmFzZSBzY2hlbWEgcHJvcGVydGllcy5cbiAqIE9ubHkgbWVyZ2VzIG92ZXJyaWRlcyBmb3IgZmllbGRzIHRoYXQgZXhpc3QgaW4gYmFzZSBwcm9wZXJ0aWVzICh3YXJucyBhYm91dCBub24tZXhpc3RlbnQgZmllbGRzKS5cbiAqIFxuICogQHRlbXBsYXRlIFQgLSBQcm9wZXJ0eSB0eXBlIHdpdGggcmVxdWlyZWQgbmFtZSBmaWVsZFxuICogQHBhcmFtIGJhc2VQcm9wZXJ0aWVzIC0gQmFzZSBmaWVsZCBwcm9wZXJ0aWVzIGZyb20gZW50aXR5IHNjaGVtYVxuICogQHBhcmFtIGZpZWxkT3ZlcnJpZGVzIC0gQ3VzdG9tIGZpZWxkIG92ZXJyaWRlcyBmcm9tIGZvcm0vZGV0YWlsIGNvbmZpZ3VyYXRpb25cbiAqIEByZXR1cm5zIEJhc2UgcHJvcGVydGllcyB3aXRoIG92ZXJyaWRlcyBtZXJnZWQgaW5cbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IGJhc2VQcm9wcyA9IFtcbiAqICAgeyBuYW1lOiAnZW1haWwnLCB0eXBlOiAnc3RyaW5nJywgcmVxdWlyZWQ6IHRydWUgfSxcbiAqICAgeyBuYW1lOiAnYmlvJywgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiBmYWxzZSB9XG4gKiBdO1xuICogY29uc3Qgb3ZlcnJpZGVzID0gW1xuICogICB7IG5hbWU6ICdlbWFpbCcsIGhlbHBUZXh0OiAnRW50ZXIgYSB2YWxpZCBlbWFpbCBhZGRyZXNzJyB9LFxuICogICB7IG5hbWU6ICdiaW8nLCB2aXNpYmlsaXR5OiB7IGNyZWF0ZTogZmFsc2UgfSB9XG4gKiBdO1xuICogY29uc3QgbWVyZ2VkID0gbWVyZ2VGaWVsZFZpc2liaWxpdHkoYmFzZVByb3BzLCBvdmVycmlkZXMpO1xuICogLy8gUmV0dXJucyBiYXNlUHJvcHMgd2l0aCBoZWxwVGV4dCBhbmQgdmlzaWJpbGl0eSBtZXJnZWRcbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VGaWVsZFZpc2liaWxpdHk8VCBleHRlbmRzIHsgbmFtZTogc3RyaW5nIH0+KFxuICAgIGJhc2VQcm9wZXJ0aWVzOiBBcnJheTxUPixcbiAgICBmaWVsZE92ZXJyaWRlczogUmVhZG9ubHlBcnJheTx7XG4gICAgICAgIHJlYWRvbmx5IG5hbWU6IHN0cmluZztcbiAgICAgICAgcmVhZG9ubHkgdmlzaWJpbGl0eT86IGFueTtcbiAgICAgICAgcmVhZG9ubHkgZW5hYmxlbWVudD86IGFueTtcbiAgICAgICAgcmVhZG9ubHkgaGVscFRleHQ/OiBzdHJpbmc7XG4gICAgICAgIHJlYWRvbmx5IHBsYWNlaG9sZGVyPzogc3RyaW5nO1xuICAgIH0+IHwgQXJyYXk8e1xuICAgICAgICBuYW1lOiBzdHJpbmc7XG4gICAgICAgIHZpc2liaWxpdHk/OiBhbnk7XG4gICAgICAgIGVuYWJsZW1lbnQ/OiBhbnk7XG4gICAgICAgIGhlbHBUZXh0Pzogc3RyaW5nO1xuICAgICAgICBwbGFjZWhvbGRlcj86IHN0cmluZztcbiAgICB9PiA9IFtdXG4pOiBBcnJheTxUPiB7XG4gICAgY29uc3Qgb3ZlcnJpZGVNYXAgPSBuZXcgTWFwKFxuICAgICAgICBbIC4uLmZpZWxkT3ZlcnJpZGVzIF0ubWFwKGYgPT4gWyBmLm5hbWUsIGYgXSlcbiAgICApO1xuXG4gICAgLy8gVmFsaWRhdGlvbjogV2FybiBpZiBmaWVsZCBvdmVycmlkZSByZWZlcmVuY2VzIG5vbi1leGlzdGVudCBmaWVsZFxuICAgIGZpZWxkT3ZlcnJpZGVzLmZvckVhY2gob3ZlcnJpZGUgPT4ge1xuICAgICAgICBpZiAoIWJhc2VQcm9wZXJ0aWVzLnNvbWUocCA9PiBwLm5hbWUgPT09IG92ZXJyaWRlLm5hbWUpKSB7XG4gICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYEZpZWxkIG92ZXJyaWRlIFwiJHtvdmVycmlkZS5uYW1lfVwiIG5vdCBmb3VuZCBpbiBzY2hlbWEgcHJvcGVydGllcy4gVGhpcyBvdmVycmlkZSB3aWxsIGJlIGlnbm9yZWQuYCk7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiBiYXNlUHJvcGVydGllcy5tYXAocHJvcCA9PiB7XG4gICAgICAgIGNvbnN0IG92ZXJyaWRlID0gb3ZlcnJpZGVNYXAuZ2V0KHByb3AubmFtZSk7XG5cbiAgICAgICAgaWYgKCFvdmVycmlkZSkgcmV0dXJuIHByb3A7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIC4uLnByb3AsXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUudmlzaWJpbGl0eSAhPT0gdW5kZWZpbmVkICYmIHsgdmlzaWJpbGl0eTogb3ZlcnJpZGUudmlzaWJpbGl0eSB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS5lbmFibGVtZW50ICE9PSB1bmRlZmluZWQgJiYgeyBlbmFibGVtZW50OiBvdmVycmlkZS5lbmFibGVtZW50IH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmhlbHBUZXh0ICE9PSB1bmRlZmluZWQgJiYgeyBoZWxwVGV4dDogb3ZlcnJpZGUuaGVscFRleHQgfSksXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUucGxhY2Vob2xkZXIgIT09IHVuZGVmaW5lZCAmJiB7IHBsYWNlaG9sZGVyOiBvdmVycmlkZS5wbGFjZWhvbGRlciB9KVxuICAgICAgICB9O1xuICAgIH0pO1xufVxuXG4vKipcbiAqIE1lcmdlcyBjb2x1bW4tbGV2ZWwgdmlzaWJpbGl0eSwgd2lkdGgsIGZpeGVkIHBvc2l0aW9uLCBncm91cGluZyBvdmVycmlkZXMsIGFuZCBvcmRlcmluZyBpbnRvIGJhc2UgcHJvcGVydGllcy5cbiAqIFxuICogQXBwbGllcyBjdXN0b20gY29sdW1uIGNvbmZpZ3VyYXRpb25zIGZyb20gdGFibGUgY29uZmlnIHRvIGJhc2Ugc2NoZW1hIHByb3BlcnRpZXMuXG4gKiBPbmx5IG1lcmdlcyBvdmVycmlkZXMgZm9yIGNvbHVtbnMgdGhhdCBleGlzdCBpbiBiYXNlIHByb3BlcnRpZXMgKHdhcm5zIGFib3V0IG5vbi1leGlzdGVudCBjb2x1bW5zKS5cbiAqIFxuICogKipWaXNpYmlsaXR5IExvZ2ljOioqXG4gKiAtIFdoZW4gY29sdW1uT3ZlcnJpZGVzIGlzIHByb3ZpZGVkOlxuICogICAtIEZpZWxkcyBJTiB0aGUgYXJyYXk6IFVzZSBgZGVmYXVsdFZpc2libGVgIChkZWZhdWx0cyB0byB0cnVlIGlmIG5vdCBzcGVjaWZpZWQpXG4gKiAgIC0gRmllbGRzIE5PVCBJTiB0aGUgYXJyYXk6IFNldCBgZGVmYXVsdFZpc2libGU6IGZhbHNlYCAoYXZhaWxhYmxlIGluIENvbHVtbiBTZXR0aW5ncyBidXQgbm90IHNob3duIGJ5IGRlZmF1bHQpXG4gKiAtIFdoZW4gY29sdW1uT3ZlcnJpZGVzIGlzIGVtcHR5L3VuZGVmaW5lZDogQWxsIGZpZWxkcyB2aXNpYmxlIChiYWNrd2FyZCBjb21wYXRpYmxlKVxuICogXG4gKiAqKk9yZGVyaW5nIExvZ2ljOioqXG4gKiAtIFdoZW4gY29sdW1uT3ZlcnJpZGVzIGlzIHByb3ZpZGVkOlxuICogICAtIENvbHVtbnMgYXJlIG9yZGVyZWQgYWNjb3JkaW5nIHRvIHRoZWlyIHBvc2l0aW9uIGluIHRoZSBjb2x1bW5PdmVycmlkZXMgYXJyYXlcbiAqICAgLSBDb2x1bW5zIG5vdCBpbiB0aGUgYXJyYXkgYXBwZWFyIGF0IHRoZSBlbmQgaW4gdGhlaXIgb3JpZ2luYWwgb3JkZXJcbiAqIC0gV2hlbiBjb2x1bW5PdmVycmlkZXMgaXMgZW1wdHkvdW5kZWZpbmVkOiBPcmlnaW5hbCBvcmRlciBpcyBwcmVzZXJ2ZWRcbiAqIFxuICogQHRlbXBsYXRlIFQgLSBQcm9wZXJ0eSB0eXBlIHdpdGggcmVxdWlyZWQgbmFtZSBmaWVsZFxuICogQHBhcmFtIGJhc2VQcm9wZXJ0aWVzIC0gQmFzZSBjb2x1bW4gcHJvcGVydGllcyBmcm9tIGVudGl0eSBzY2hlbWFcbiAqIEBwYXJhbSBjb2x1bW5PdmVycmlkZXMgLSBDdXN0b20gY29sdW1uIG92ZXJyaWRlcyBmcm9tIHRhYmxlIGNvbmZpZ3VyYXRpb25cbiAqIEByZXR1cm5zIEJhc2UgcHJvcGVydGllcyB3aXRoIG92ZXJyaWRlcyBtZXJnZWQgaW4gYW5kIHJlb3JkZXJlZFxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY29uc3QgYmFzZVByb3BzID0gW1xuICogICB7IG5hbWU6ICdvcmRlcklkJywgZGF0YUluZGV4OiAnb3JkZXJJZCcsIHR5cGU6ICdzdHJpbmcnIH0sXG4gKiAgIHsgbmFtZTogJ3N0YXR1cycsIGRhdGFJbmRleDogJ3N0YXR1cycsIHR5cGU6ICdzdHJpbmcnIH0sXG4gKiAgIHsgbmFtZTogJ3VzZXJJZCcsIGRhdGFJbmRleDogJ3VzZXJJZCcsIHR5cGU6ICdzdHJpbmcnIH0sXG4gKiAgIHsgbmFtZTogJ21ldGFkYXRhJywgZGF0YUluZGV4OiAnbWV0YWRhdGEnLCB0eXBlOiAnc3RyaW5nJyB9XG4gKiBdO1xuICogY29uc3Qgb3ZlcnJpZGVzID0gW1xuICogICB7IGZpZWxkOiAnc3RhdHVzJywgZGVmYXVsdFZpc2libGU6IHRydWUgfSwgICAgICAgICAvLyAxc3QgcG9zaXRpb25cbiAqICAgeyBmaWVsZDogJ29yZGVySWQnLCB3aWR0aDogMjAwLCBkZWZhdWx0VmlzaWJsZTogdHJ1ZSB9LCAvLyAybmQgcG9zaXRpb25cbiAqICAgeyBmaWVsZDogJ21ldGFkYXRhJywgZGVmYXVsdFZpc2libGU6IGZhbHNlIH0gICAgICAgLy8gM3JkIHBvc2l0aW9uIChoaWRkZW4pXG4gKiAgIC8vIHVzZXJJZCBub3QgbGlzdGVkIC0gd2lsbCBiZSBhdCB0aGUgZW5kIGFuZCBoaWRkZW4gYnkgZGVmYXVsdFxuICogXTtcbiAqIGNvbnN0IG1lcmdlZCA9IG1lcmdlQ29sdW1uVmlzaWJpbGl0eShiYXNlUHJvcHMsIG92ZXJyaWRlcyk7XG4gKiAvLyBSZXN1bHQgKGluIG9yZGVyKTpcbiAqIC8vIDEuIHN0YXR1czogZGVmYXVsdFZpc2libGU6IHRydWVcbiAqIC8vIDIuIG9yZGVySWQ6IGRlZmF1bHRWaXNpYmxlOiB0cnVlLCB3aWR0aDogMjAwXG4gKiAvLyAzLiBtZXRhZGF0YTogZGVmYXVsdFZpc2libGU6IGZhbHNlXG4gKiAvLyA0LiB1c2VySWQ6IGRlZmF1bHRWaXNpYmxlOiBmYWxzZSAobm90IGluIG92ZXJyaWRlcywgYXQgdGhlIGVuZClcbiAqIGBgYFxuICovXG4vKipcbiAqIE5vcm1hbGl6ZWQgY29sdW1uIGNvbmZpZ3VyYXRpb24gd2l0aCBkZWZhdWx0VmlzaWJsZSBhbHdheXMgZGVmaW5lZC5cbiAqIEludGVybmFsIHR5cGUgZm9yIHByb2Nlc3NpbmcgY29sdW1uIG92ZXJyaWRlcy5cbiAqL1xudHlwZSBOb3JtYWxpemVkQ29sdW1uQ29uZmlnID0gT21pdDxJVGFibGVDb2x1bW5Db25maWcsICdkZWZhdWx0VmlzaWJsZSc+ICYge1xuICAgIGRlZmF1bHRWaXNpYmxlOiBib29sZWFuO1xuICAgIF9vcmRlcj86IG51bWJlcjtcbn07XG5cbi8qKlxuICogTm9ybWFsaXplcyBjb2x1bW4gb3ZlcnJpZGVzIHRvIGEgY29uc2lzdGVudCBmb3JtYXQuXG4gKiBTdXBwb3J0cyBib3RoIHN0cmluZyBzaG9ydGhhbmQgKCdmaWVsZE5hbWUnKSBhbmQgb2JqZWN0IHN5bnRheCAoeyBmaWVsZDogJ2ZpZWxkTmFtZScsIC4uLiB9KVxuICogXG4gKiBAcGFyYW0gY29sdW1uT3ZlcnJpZGVzIC0gQ29sdW1uIGNvbmZpZ3VyYXRpb25zIChzdHJpbmcgb3Igb2JqZWN0IGZvcm1hdClcbiAqIEByZXR1cm5zIE5vcm1hbGl6ZWQgYXJyYXkgb2YgY29sdW1uIGNvbmZpZyBvYmplY3RzXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUNvbHVtbk92ZXJyaWRlcyhcbiAgICBjb2x1bW5PdmVycmlkZXM6IElUYWJsZUNvbHVtbnNcbik6IEFycmF5PE5vcm1hbGl6ZWRDb2x1bW5Db25maWc+IHtcbiAgICByZXR1cm4gKGNvbHVtbk92ZXJyaWRlcyBhcyBBcnJheTxJVGFibGVDb2x1bW4+KS5tYXAoY29sID0+IHtcbiAgICAgICAgLy8gU3RyaW5nIHNob3J0aGFuZDogJ2ZpZWxkTmFtZScg4oaSIHsgZmllbGQ6ICdmaWVsZE5hbWUnLCBkZWZhdWx0VmlzaWJsZTogdHJ1ZSB9XG4gICAgICAgIGlmICh0eXBlb2YgY29sID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBmaWVsZDogY29sLFxuICAgICAgICAgICAgICAgIGRlZmF1bHRWaXNpYmxlOiB0cnVlXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIC8vIE9iamVjdCBzeW50YXg6IGFscmVhZHkgbm9ybWFsaXplZCwganVzdCBlbnN1cmUgZGVmYXVsdFZpc2libGUgZGVmYXVsdHMgdG8gdHJ1ZVxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZmllbGQ6IGNvbC5maWVsZCxcbiAgICAgICAgICAgIHZpc2liaWxpdHk6IGNvbC52aXNpYmlsaXR5LFxuICAgICAgICAgICAgcmVuZGVyZXI6IGNvbC5yZW5kZXJlcixcbiAgICAgICAgICAgIHdpZHRoOiBjb2wud2lkdGgsXG4gICAgICAgICAgICBmaXhlZDogY29sLmZpeGVkLFxuICAgICAgICAgICAgZ3JvdXBUaXRsZTogY29sLmdyb3VwVGl0bGUsXG4gICAgICAgICAgICBkZWZhdWx0VmlzaWJsZTogY29sLmRlZmF1bHRWaXNpYmxlICE9PSBmYWxzZSwgLy8gRGVmYXVsdHMgdG8gdHJ1ZVxuICAgICAgICAgICAgLi4uKGNvbC5mb3JtYXR0aW5nICYmIHsgZm9ybWF0dGluZzogY29sLmZvcm1hdHRpbmcgfSksXG4gICAgICAgICAgICAuLi4oY29sLmNvbXBvc2l0ZSAmJiB7IGNvbXBvc2l0ZTogY29sLmNvbXBvc2l0ZSB9KSxcbiAgICAgICAgICAgIC4uLihjb2wubWFza2luZyAmJiB7IG1hc2tpbmc6IGNvbC5tYXNraW5nIH0pLFxuICAgICAgICAgICAgLi4uKGNvbC5kZXJpdmVkICYmIHsgZGVyaXZlZDogY29sLmRlcml2ZWQgfSksXG4gICAgICAgIH07XG4gICAgfSk7XG59XG5cbi8qKlxuICogTWVyZ2VzIGNvbHVtbiB2aXNpYmlsaXR5IGNvbmZpZ3VyYXRpb24gd2l0aCBiYXNlIHByb3BlcnRpZXMuXG4gKiBDb250cm9scyB3aGljaCBjb2x1bW5zIGFyZSB2aXNpYmxlIGJ5IGRlZmF1bHQgYW5kIHRoZWlyIGRpc3BsYXkgb3JkZXIuXG4gKiBcbiAqICoqU3VwcG9ydHM6KipcbiAqIC0gU2NoZW1hIGZpZWxkcyAoZnJvbSBiYXNlIHByb3BlcnRpZXMpXG4gKiAtIEpTT04gcGF0aHMgKGUuZy4sICd1c2VyLmVtYWlsJywgJ21ldGFkYXRhLnNjb3JlJylcbiAqIC0gQ3VzdG9tL2NvbXB1dGVkIGNvbHVtbnMgKG5vdCBpbiBzY2hlbWEsIHByb3ZpZGVkIGJ5IEFQSSBvciBmcm9udGVuZClcbiAqIFxuICogQHRlbXBsYXRlIFQgLSBCYXNlIHByb3BlcnR5IHR5cGUgd2l0aCBuYW1lIGFuZCBkYXRhSW5kZXhcbiAqIEBwYXJhbSBiYXNlUHJvcGVydGllcyAtIEJhc2UgcHJvcGVydGllcyBmcm9tIGVudGl0eSBzY2hlbWFcbiAqIEBwYXJhbSBjb2x1bW5PdmVycmlkZXMgLSBDb2x1bW4gY29uZmlndXJhdGlvbiBvdmVycmlkZXMgKHN0cmluZyBvciBvYmplY3QgZm9ybWF0KVxuICogQHJldHVybnMgTWVyZ2VkIHByb3BlcnRpZXMgd2l0aCB2aXNpYmlsaXR5IGFuZCBvcmRlciBhcHBsaWVkLCBpbmNsdWRpbmcgY3VzdG9tIGNvbHVtbnNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlQ29sdW1uVmlzaWJpbGl0eTxUIGV4dGVuZHMgeyBuYW1lOiBzdHJpbmc7IGRhdGFJbmRleD86IHN0cmluZyB9PihcbiAgICBiYXNlUHJvcGVydGllczogQXJyYXk8VD4sXG4gICAgY29sdW1uT3ZlcnJpZGVzOiBJVGFibGVDb2x1bW5zID0gW11cbik6IEFycmF5PFQ+IHtcbiAgICAvLyBJZiBubyBjb2x1bW5PdmVycmlkZXMgcHJvdmlkZWQsIHJldHVybiBwcm9wZXJ0aWVzIGFzLWlzIChiYWNrd2FyZCBjb21wYXRpYmxlKVxuICAgIGlmICghY29sdW1uT3ZlcnJpZGVzIHx8IGNvbHVtbk92ZXJyaWRlcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIGJhc2VQcm9wZXJ0aWVzO1xuICAgIH1cblxuICAgIC8vIE5vcm1hbGl6ZSBjb2x1bW4gb3ZlcnJpZGVzIChoYW5kbGUgc3RyaW5nIHNob3J0aGFuZClcbiAgICBjb25zdCBub3JtYWxpemVkT3ZlcnJpZGVzID0gbm9ybWFsaXplQ29sdW1uT3ZlcnJpZGVzKGNvbHVtbk92ZXJyaWRlcyk7XG5cbiAgICBjb25zdCBvdmVycmlkZU1hcCA9IG5ldyBNYXAoXG4gICAgICAgIG5vcm1hbGl6ZWRPdmVycmlkZXMubWFwKChjLCBpbmRleCkgPT4gWyBjLmZpZWxkLCB7IC4uLmMsIF9vcmRlcjogaW5kZXggfSBdKVxuICAgICk7XG5cbiAgICAvLyBUcmFjayB3aGljaCBvdmVycmlkZXMgbWF0Y2ggZXhpc3Rpbmcgc2NoZW1hIGNvbHVtbnNcbiAgICBjb25zdCBtYXRjaGVkT3ZlcnJpZGVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICAvLyBNZXJnZSBvdmVycmlkZXMgaW50byBleGlzdGluZyBzY2hlbWEgcHJvcGVydGllc1xuICAgIGNvbnN0IG1lcmdlZFByb3BlcnRpZXMgPSBiYXNlUHJvcGVydGllcy5tYXAocHJvcCA9PiB7XG4gICAgICAgIC8vIFVzZSBkYXRhSW5kZXggKGFjdHVhbCBmaWVsZCBuYW1lKSBpZiBhdmFpbGFibGUsIG90aGVyd2lzZSBmYWxsIGJhY2sgdG8gbmFtZVxuICAgICAgICBjb25zdCBmaWVsZE5hbWUgPSBwcm9wLmRhdGFJbmRleCB8fCBwcm9wLm5hbWU7XG4gICAgICAgIGNvbnN0IG92ZXJyaWRlID0gb3ZlcnJpZGVNYXAuZ2V0KGZpZWxkTmFtZSk7XG5cbiAgICAgICAgaWYgKCFvdmVycmlkZSkge1xuICAgICAgICAgICAgLy8gRmllbGQgbm90IGluIHRhYmxlQ29uZmlnLmNvbHVtbnMgLSBoaWRlIGJ5IGRlZmF1bHQgYnV0IGtlZXAgYXZhaWxhYmxlXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIC4uLnByb3AsXG4gICAgICAgICAgICAgICAgZGVmYXVsdFZpc2libGU6IGZhbHNlLFxuICAgICAgICAgICAgICAgIF9vcmRlcjogTnVtYmVyLk1BWF9TQUZFX0lOVEVHRVIgLy8gUHV0IGF0IHRoZSBlbmRcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGaWVsZCBpcyBpbiB0YWJsZUNvbmZpZy5jb2x1bW5zIC0gYXBwbHkgb3ZlcnJpZGVzXG4gICAgICAgIG1hdGNoZWRPdmVycmlkZXMuYWRkKG92ZXJyaWRlLmZpZWxkKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIC4uLnByb3AsXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUudmlzaWJpbGl0eSAhPT0gdW5kZWZpbmVkICYmIHsgdmlzaWJpbGl0eTogb3ZlcnJpZGUudmlzaWJpbGl0eSB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS5yZW5kZXJlciAhPT0gdW5kZWZpbmVkICYmIHsgcmVuZGVyZXI6IG92ZXJyaWRlLnJlbmRlcmVyIH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLndpZHRoICE9PSB1bmRlZmluZWQgJiYgeyB3aWR0aDogb3ZlcnJpZGUud2lkdGggfSksXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUuZml4ZWQgIT09IHVuZGVmaW5lZCAmJiB7IGZpeGVkOiBvdmVycmlkZS5maXhlZCB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS5ncm91cFRpdGxlICE9PSB1bmRlZmluZWQgJiYgeyBncm91cFRpdGxlOiBvdmVycmlkZS5ncm91cFRpdGxlIH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmZvcm1hdHRpbmcgJiYgeyBmb3JtYXR0aW5nOiBvdmVycmlkZS5mb3JtYXR0aW5nIH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmNvbXBvc2l0ZSAmJiB7IGNvbXBvc2l0ZTogb3ZlcnJpZGUuY29tcG9zaXRlIH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLm1hc2tpbmcgJiYgeyBtYXNraW5nOiBvdmVycmlkZS5tYXNraW5nIH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmRlcml2ZWQgJiYgeyBkZXJpdmVkOiBvdmVycmlkZS5kZXJpdmVkIH0pLFxuICAgICAgICAgICAgZGVmYXVsdFZpc2libGU6IG92ZXJyaWRlLmRlZmF1bHRWaXNpYmxlICE9PSBmYWxzZSwgIC8vIERlZmF1bHRzIHRvIHRydWVcbiAgICAgICAgICAgIF9vcmRlcjogb3ZlcnJpZGUuX29yZGVyXG4gICAgICAgIH07XG4gICAgfSk7XG5cbiAgICAvLyBBZGQgY3VzdG9tIGNvbHVtbnMgKEpTT04gcGF0aHMsIGNvbXB1dGVkIGZpZWxkcylcbiAgICBub3JtYWxpemVkT3ZlcnJpZGVzLmZvckVhY2gob3ZlcnJpZGUgPT4ge1xuICAgICAgICBpZiAoIW1hdGNoZWRPdmVycmlkZXMuaGFzKG92ZXJyaWRlLmZpZWxkKSkge1xuICAgICAgICAgICAgLy8gVGhpcyBpcyBhIGN1c3RvbSBjb2x1bW4gKEpTT04gcGF0aCBvciBjb21wdXRlZCBmaWVsZClcbiAgICAgICAgICAgIGNvbnN0IGlzSnNvblBhdGggPSBvdmVycmlkZS5maWVsZC5pbmNsdWRlcygnLicpO1xuXG4gICAgICAgICAgICAvLyBMb2cgaW5mbyBhYm91dCBjdXN0b20gY29sdW1uXG4gICAgICAgICAgICBpZiAoaXNKc29uUGF0aCkge1xuICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIuZGVidWcoYEFkZGluZyBKU09OIHBhdGggY29sdW1uOiBcIiR7b3ZlcnJpZGUuZmllbGR9XCJgKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgRGVmYXVsdExvZ2dlci5kZWJ1ZyhgQWRkaW5nIGN1c3RvbSBjb2x1bW46IFwiJHtvdmVycmlkZS5maWVsZH1cIiAobm90IGluIHNjaGVtYSwgYXNzdW1lcyBBUEkgcHJvdmlkZXMgaXQpYCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIEFkZCBhcyBuZXcgY3VzdG9tIGNvbHVtblxuICAgICAgICAgICAgbWVyZ2VkUHJvcGVydGllcy5wdXNoKHtcbiAgICAgICAgICAgICAgICBuYW1lOiBvdmVycmlkZS5maWVsZCwgIC8vIFVzZSBmaWVsZCBhcyBuYW1lXG4gICAgICAgICAgICAgICAgZGF0YUluZGV4OiBvdmVycmlkZS5maWVsZCwgIC8vIEZyb250ZW5kIHdpbGwgdXNlIGdldE5lc3RlZFZhbHVlKClcbiAgICAgICAgICAgICAgICBkZWZhdWx0VmlzaWJsZTogb3ZlcnJpZGUuZGVmYXVsdFZpc2libGUsXG4gICAgICAgICAgICAgICAgZmllbGRUeXBlOiAndGV4dCcsICAvLyBEZWZhdWx0IHRvIHRleHQgZm9yIGN1c3RvbSBjb2x1bW5zXG4gICAgICAgICAgICAgICAgLi4uKG92ZXJyaWRlLnZpc2liaWxpdHkgIT09IHVuZGVmaW5lZCAmJiB7IHZpc2liaWxpdHk6IG92ZXJyaWRlLnZpc2liaWxpdHkgfSksXG4gICAgICAgICAgICAgICAgLi4uKG92ZXJyaWRlLnJlbmRlcmVyICE9PSB1bmRlZmluZWQgJiYgeyByZW5kZXJlcjogb3ZlcnJpZGUucmVuZGVyZXIgfSksXG4gICAgICAgICAgICAgICAgLi4uKG92ZXJyaWRlLndpZHRoICE9PSB1bmRlZmluZWQgJiYgeyB3aWR0aDogb3ZlcnJpZGUud2lkdGggfSksXG4gICAgICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmZpeGVkICE9PSB1bmRlZmluZWQgJiYgeyBmaXhlZDogb3ZlcnJpZGUuZml4ZWQgfSksXG4gICAgICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmdyb3VwVGl0bGUgIT09IHVuZGVmaW5lZCAmJiB7IGdyb3VwVGl0bGU6IG92ZXJyaWRlLmdyb3VwVGl0bGUgfSksXG4gICAgICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmZvcm1hdHRpbmcgJiYgeyBmb3JtYXR0aW5nOiBvdmVycmlkZS5mb3JtYXR0aW5nIH0pLFxuICAgICAgICAgICAgICAgIC4uLihvdmVycmlkZS5jb21wb3NpdGUgJiYgeyBjb21wb3NpdGU6IG92ZXJyaWRlLmNvbXBvc2l0ZSB9KSxcbiAgICAgICAgICAgICAgICAuLi4ob3ZlcnJpZGUubWFza2luZyAmJiB7IG1hc2tpbmc6IG92ZXJyaWRlLm1hc2tpbmcgfSksXG4gICAgICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmRlcml2ZWQgJiYgeyBkZXJpdmVkOiBvdmVycmlkZS5kZXJpdmVkIH0pLFxuICAgICAgICAgICAgICAgIF9vcmRlcjogb3ZlcnJpZGUuX29yZGVyXG4gICAgICAgICAgICB9IGFzIGFueSk7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIFNvcnQgYnkgb3JkZXIgZnJvbSBjb2x1bW5PdmVycmlkZXMgKGNvbHVtbnMgbm90IGluIG92ZXJyaWRlcyBnbyB0byBlbmQpXG4gICAgbWVyZ2VkUHJvcGVydGllcy5zb3J0KChhOiBhbnksIGI6IGFueSkgPT4gKGEuX29yZGVyID8/IE51bWJlci5NQVhfU0FGRV9JTlRFR0VSKSAtIChiLl9vcmRlciA/PyBOdW1iZXIuTUFYX1NBRkVfSU5URUdFUikpO1xuXG4gICAgLy8gUmVtb3ZlIHRlbXBvcmFyeSBfb3JkZXIgcHJvcGVydHlcbiAgICByZXR1cm4gbWVyZ2VkUHJvcGVydGllcy5tYXAoKHsgX29yZGVyLCAuLi5yZXN0IH06IGFueSkgPT4gcmVzdCk7XG59XG4iXX0=
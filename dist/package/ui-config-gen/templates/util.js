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
const merge_display_override_ui_fields_1 = require("./merge-display-override-ui-fields");
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
function processSectionsConfig(sectionsConfig, allProperties, entityService, globalUIConfigOptions, 
/** When set, nested detail/form field rows receive the same displayOverride merge as root pages. */
displayOverrides) {
    if (!sectionsConfig)
        return sectionsConfig;
    const processed = { ...sectionsConfig };
    // Process sections in single group format (backward compatible)
    if (processed.sections) {
        processed.sections = Object.entries(processed.sections).reduce((acc, [key, section]) => {
            acc[key] = processSectionConfig(section, allProperties, entityService, globalUIConfigOptions, displayOverrides);
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
                    acc[key] = processSectionConfig(section, allProperties, entityService, globalUIConfigOptions, displayOverrides);
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
function processSectionConfig(section, allProperties, entityService, globalUIConfigOptions, displayOverrides) {
    const processed = { ...section };
    // Process detailsPageConfig with propertiesConfig
    if (processed.pageType === 'details' && processed.detailsPageConfig?.propertiesConfig) {
        const config = processed.detailsPageConfig;
        let propertiesConfig = expandPropertyReferences(config.propertiesConfig, allProperties, 'detail', entityService, globalUIConfigOptions);
        if (displayOverrides) {
            propertiesConfig = (0, merge_display_override_ui_fields_1.mergeDisplayOverrideFieldConfigIntoProperties)(propertiesConfig, displayOverrides);
        }
        processed.detailsPageConfig = {
            ...config,
            propertiesConfig,
        };
    }
    // Process formPageConfig
    if (processed.pageType === 'form' && processed.formPageConfig?.propertiesConfig) {
        const config = processed.formPageConfig;
        // Forms in sections are typically 'create' forms
        let propertiesConfig = expandPropertyReferences(config.propertiesConfig, allProperties, 'create', entityService, globalUIConfigOptions);
        if (displayOverrides) {
            propertiesConfig = (0, merge_display_override_ui_fields_1.mergeDisplayOverrideFieldConfigIntoProperties)(propertiesConfig, displayOverrides);
            propertiesConfig = (0, merge_display_override_ui_fields_1.applyDisplayOverrideStorageFieldFormDefaults)(propertiesConfig, displayOverrides);
        }
        processed.formPageConfig = {
            ...config,
            propertiesConfig,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy91aS1jb25maWctZ2VuL3RlbXBsYXRlcy91dGlsLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBNGlCQSw0REFnQkM7QUEwTUQsa0VBNERDO0FBb0JELG9EQXlOQztBQXVYRCw0Q0F1TkM7QUFtQ0Qsb0ZBK1NDO0FBY0Qsc0ZBa0JDO0FBaUZELDREQXVGQztBQWtCRCxzREFvQ0M7QUE0RUQsMEVBSUM7QUFhRCwwRUFJQztBQWFELDBFQUlDO0FBaURELHNFQXVHQztBQStDRCxvQ0F3QkM7QUE2QkQsb0NBS0M7QUFTRCx3REE4QkM7QUF5QkQsc0NBS0M7QUEyQkQsb0RBc0NDO0FBeUdELHNEQTBGQztBQXo0RkQseUNBWXNCO0FBRXRCLHlDQUE4QztBQUc5Qyx5RkFBaUo7QUFDakosMkNBQThDO0FBQzlDLHVDQUE4RDtBQWtEOUQ7O0dBRUc7QUFDSDs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW1CRztBQUNILE1BQU0sd0JBQXdCLEdBQThDO0lBQ3hFLE9BQU8sRUFBRSxJQUFJO0lBQ2IsUUFBUSxFQUFFO1FBQ04sNENBQTRDO1FBQzVDLE9BQU8sRUFBRSxDQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLGFBQWEsQ0FBRTtRQUNwRCw0Q0FBNEM7UUFDNUMsTUFBTSxFQUFFLENBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFLFNBQVMsQ0FBRTtRQUN4RCx3Q0FBd0M7UUFDeEMsSUFBSSxFQUFFLENBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsWUFBWSxFQUFFLFVBQVUsQ0FBRTtLQUM1RDtJQUNELFFBQVEsRUFBRTtRQUNOLDBDQUEwQztRQUMxQyxRQUFRLEVBQUUsT0FBTztRQUNqQixRQUFRLEVBQUUsUUFBUSxFQUFFLGFBQWE7UUFDakMsU0FBUyxFQUFFLFdBQVcsRUFBRSxVQUFVO1FBQ2xDLE1BQU0sRUFBRSxX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QUFRLENBQUMsT0FBTyxJQUFJLEVBQUUsT0FBTyxFQUFFLFFBQVEsQ0FBQyxPQUFPLEVBQUUsQ0FBQztnQkFDdEQsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLElBQUksRUFBRSxPQUFPLEVBQUUsUUFBUSxDQUFDLE9BQU8sRUFBRSxDQUFDO2dCQUN0RCxNQUFNLEVBQUUsUUFBUSxDQUFDLE1BQU07YUFDbkIsQ0FBQyxDQUFDO1FBQ2QsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsMEVBQTBFO0lBQzFFLGdCQUFnQixDQUFDLElBQUksQ0FBQyxDQUFDLENBQU0sRUFBRSxDQUFNLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sSUFBSSxNQUFNLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxNQUFNLElBQUksTUFBTSxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQztJQUV6SCxtQ0FBbUM7SUFDbkMsT0FBTyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxHQUFHLElBQUksRUFBTyxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUNwRSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtcbiAgICBCYXNlRW50aXR5U2VydmljZSxcbiAgICBGaWVsZE1ldGFkYXRhLFxuICAgIFRJT1NjaGVtYUF0dHJpYnV0ZSxcbiAgICBpc1NlbGVjdEZpZWxkTWV0YWRhdGEsXG4gICAgU2VsZWN0RmllbGRNZXRhZGF0YSxcbiAgICBFbnRpdHlBdHRyaWJ1dGUsXG4gICAgSVJlbGF0aW9uRmllbGRDb25maWcsXG4gICAgVElPU2NoZW1hQXR0cmlidXRlc01hcCxcbiAgICBFbnRpdHlTY2hlbWEsXG4gICAgSUZpbHRlclNlZ21lbnQsXG4gICAgY3JlYXRlRmllbGRPcHRpb25zXG59IGZyb20gXCIuLi8uLi9lbnRpdHlcIjtcbmltcG9ydCB0eXBlIHsgUmVsYXRpb25FbnRpdHlPcHRpb25Db25maWcsIEZpZWxkT3B0aW9uc0FQSUNvbmZpZywgSUVudGl0eVBhZ2VBY3Rpb24sIFRlbXBsYXRlLCBGaWVsZE9wdGlvbiwgSUZpbHRlclNlZ21lbnRHcm91cCwgSVRhYmxlQ29sdW1ucywgSVRhYmxlQ29sdW1uLCBJVGFibGVDb2x1bW5Db25maWcgfSBmcm9tICcuLi8uLi9lbnRpdHkvYmFzZS1lbnRpdHknO1xuaW1wb3J0IHsgRnJhbWV3b3JrRXJyb3IgfSBmcm9tIFwiLi4vLi4vZXJyb3JzXCI7XG5pbXBvcnQgdHlwZSB7IElBcHBsaWNhdGlvbkNvbmZpZywgSUR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbkNvbmZpZywgSVNlZ21lbnRBdXRvR2VuZXJhdGlvbkNvbmZpZyB9IGZyb20gJy4uLy4uL2ludGVyZmFjZXMvY29uZmlnJztcbmltcG9ydCB0eXBlIHsgRGlzcGxheU92ZXJyaWRlc1VJQ29uZmlnIH0gZnJvbSAnLi4vLi4vZW50aXR5L2Rpc3BsYXktb3ZlcnJpZGUtdHlwZXMnO1xuaW1wb3J0IHsgbWVyZ2VEaXNwbGF5T3ZlcnJpZGVGaWVsZENvbmZpZ0ludG9Qcm9wZXJ0aWVzLCBhcHBseURpc3BsYXlPdmVycmlkZVN0b3JhZ2VGaWVsZEZvcm1EZWZhdWx0cyB9IGZyb20gJy4vbWVyZ2UtZGlzcGxheS1vdmVycmlkZS11aS1maWVsZHMnO1xuaW1wb3J0IHsgRGVmYXVsdExvZ2dlciB9IGZyb20gXCIuLi8uLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBwYXNjYWxDYXNlLCB0b0h1bWFuUmVhZGFibGVOYW1lIH0gZnJvbSBcIi4uLy4uL3V0aWxzXCI7XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU01BUlQgRFVQTElDQVRFRCBGSUVMRCBERVRFQ1RJT04gLSBFTkhBTkNFRCBBTEdPUklUSE1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIERldGVjdGlvbiByZXN1bHQgd2l0aCByaWNoIG1ldGFkYXRhXG4gKi9cbmludGVyZmFjZSBEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25SZXN1bHQge1xuICAgIC8qKiBQcmltYXJ5IGRpc3BsYXkgZmllbGQgZGV0ZWN0ZWQgKGUuZy4sICd0ZWFtTmFtZScpICovXG4gICAgcHJpbWFyeUZpZWxkPzogc3RyaW5nO1xuXG4gICAgLyoqIEdlbmVyYXRlZCB0ZW1wbGF0ZSBzdHJpbmcgKGUuZy4sICd7dGVhbU5hbWV9JyBvciAne3RlYW1OYW1lfSAoe3RlYW1Db2RlfSknKSAqL1xuICAgIHRlbXBsYXRlPzogc3RyaW5nO1xuXG4gICAgLyoqIEFsbCBkZXRlY3RlZCBmaWVsZHMgYnkgY2F0ZWdvcnkgKi9cbiAgICBkZXRlY3RlZEZpZWxkczoge1xuICAgICAgICAvKiogRGlzcGxheSBmaWVsZHM6IE5hbWUsIFRpdGxlLCBMYWJlbCAqL1xuICAgICAgICBkaXNwbGF5Pzogc3RyaW5nW107XG4gICAgICAgIC8qKiBWaXN1YWwgZmllbGRzOiBMb2dvLCBJbWFnZSwgSWNvbiAqL1xuICAgICAgICB2aXN1YWw/OiBzdHJpbmdbXTtcbiAgICAgICAgLyoqIE1ldGEgZmllbGRzOiBDb2RlLCBTbHVnLCBLZXkgKi9cbiAgICAgICAgbWV0YT86IHN0cmluZ1tdO1xuICAgIH07XG5cbiAgICAvKiogQ29uZmlkZW5jZSBsZXZlbCAqL1xuICAgIGNvbmZpZGVuY2U6ICdoaWdoJyB8ICdtZWRpdW0nIHwgJ2xvdyc7XG5cbiAgICAvKiogRGV0ZWN0aW9uIG1ldGhvZCB1c2VkICovXG4gICAgbWV0aG9kOiBzdHJpbmc7XG5cbiAgICAvKiogUGF0dGVybiB0aGF0IG1hdGNoZWQgKi9cbiAgICBwYXR0ZXJuOiBzdHJpbmc7XG59XG5cbi8qKlxuICogUGFyc2VkIGNvbXBvbmVudHMgZnJvbSByZWxhdGlvbiBmaWVsZCBuYW1lXG4gKi9cbmludGVyZmFjZSBQYXJzZWRSZWxhdGlvbkZpZWxkIHtcbiAgICAvKiogUHJlZml4IChlLmcuLCAnaG9tZScsICdhd2F5JywgJ2NvbXBldGl0b3IxJykgKi9cbiAgICBwcmVmaXg/OiBzdHJpbmc7XG4gICAgLyoqIEJhc2UgbmFtZSB3aXRob3V0IHByZWZpeCBhbmQgJ0lkJyBzdWZmaXggKGUuZy4sICdUZWFtJykgKi9cbiAgICBiYXNlTmFtZTogc3RyaW5nO1xuICAgIC8qKiBXaGV0aGVyIGZpZWxkIGVuZHMgd2l0aCAnSWQnICovXG4gICAgaGFzSWRTdWZmaXg6IGJvb2xlYW47XG4gICAgLyoqIE9yaWdpbmFsIGZpZWxkIG5hbWUgKi9cbiAgICBvcmlnaW5hbEZpZWxkOiBzdHJpbmc7XG59XG5cbi8qKlxuICogU21hcnQgZGVmYXVsdCBjb25maWd1cmF0aW9uXG4gKi9cbi8qKlxuICogRnJhbWV3b3JrLWxldmVsIGRlZmF1bHQgZGV0ZWN0aW9uIGNvbmZpZy5cbiAqIENvbnRhaW5zIE9OTFkgZG9tYWluLWFnbm9zdGljIHBhdHRlcm5zIHRoYXQgd29yayBhY3Jvc3MgYW55IGFwcGxpY2F0aW9uLlxuICogXG4gKiBBcHBsaWNhdGlvbnMgc2hvdWxkIHByb3ZpZGUgZG9tYWluLXNwZWNpZmljIHByZWZpeGVzIHZpYSB1aUNvbmZpZ09wdGlvbnMuXG4gKiBcbiAqIEBleGFtcGxlIEFwcGxpY2F0aW9uLXNwZWNpZmljIGNvbmZpZyAoaW4gYmFja2VuZCBpbmRleC50cyk6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCB1aUNvbmZpZ09wdGlvbnMgPSB7XG4gKiAgIGR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbjoge1xuICogICAgIHByZWZpeGVzOiBbXG4gKiAgICAgICAvLyBEb21haW4tc3BlY2lmaWMgcHJlZml4ZXMgZm9yIHlvdXIgYXBwXG4gKiAgICAgICAncGxheWVyJywgJ3RlYW0nLCAnbGVhZ3VlJywgJ3NlYXNvbicsICd2ZW51ZScsICdzcG9ydCcsICAvLyBTcG9ydHMgYXBwXG4gKiAgICAgICAvLyBPUjogJ2N1c3RvbWVyJywgJ29yZGVyJywgJ3Byb2R1Y3QnLCAnaW52b2ljZScgIC8vIEUtY29tbWVyY2UgYXBwXG4gKiAgICAgICAvLyBPUjogJ2F1dGhvcicsICdib29rJywgJ3B1Ymxpc2hlcicsICdnZW5yZScgIC8vIExpYnJhcnkgYXBwXG4gKiAgICAgXVxuICogICB9XG4gKiB9O1xuICogYGBgXG4gKi9cbmNvbnN0IERFRkFVTFRfREVURUNUSU9OX0NPTkZJRzogUmVxdWlyZWQ8SUR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbkNvbmZpZz4gPSB7XG4gICAgZW5hYmxlZDogdHJ1ZSxcbiAgICBzdWZmaXhlczoge1xuICAgICAgICAvLyBHZW5lcmljIGRpc3BsYXkgdGV4dCBwYXR0ZXJucyAodW5pdmVyc2FsKVxuICAgICAgICBkaXNwbGF5OiBbICdOYW1lJywgJ1RpdGxlJywgJ0xhYmVsJywgJ0Rpc3BsYXlOYW1lJyBdLFxuICAgICAgICAvLyBHZW5lcmljIHZpc3VhbCBhc3NldCBwYXR0ZXJucyAodW5pdmVyc2FsKVxuICAgICAgICB2aXN1YWw6IFsgJ0xvZ28nLCAnSW1hZ2UnLCAnSWNvbicsICdBdmF0YXInLCAnUGljdHVyZScgXSxcbiAgICAgICAgLy8gR2VuZXJpYyBtZXRhZGF0YSBwYXR0ZXJucyAodW5pdmVyc2FsKVxuICAgICAgICBtZXRhOiBbICdDb2RlJywgJ1NsdWcnLCAnS2V5JywgJ0lkZW50aWZpZXInLCAnUmVtb3RlSWQnIF1cbiAgICB9LFxuICAgIHByZWZpeGVzOiBbXG4gICAgICAgIC8vIEdlbmVyaWMgcmVsYXRpb25hbCBwYXR0ZXJucyAodW5pdmVyc2FsKVxuICAgICAgICAncGFyZW50JywgJ2NoaWxkJyxcbiAgICAgICAgJ3NvdXJjZScsICd0YXJnZXQnLCAnZGVzdGluYXRpb24nLFxuICAgICAgICAncHJpbWFyeScsICdzZWNvbmRhcnknLCAndGVydGlhcnknLFxuICAgICAgICAnbWFpbicsICdhbHRlcm5hdGUnLCAnZmFsbGJhY2snLFxuICAgICAgICAnb3duZXInLCAnY3JlYXRvcicsICdtb2RpZmllcicsXG4gICAgICAgICdmaXJzdCcsICdzZWNvbmQnLCAndGhpcmQnLCAnbGFzdCcsXG4gICAgICAgICdwcmV2aW91cycsICduZXh0JywgJ2N1cnJlbnQnLFxuICAgICAgICAnb2xkJywgJ25ldycsXG4gICAgICAgICdvcmlnaW5hbCcsICdjb3B5JywgJ2RyYWZ0JyxcblxuICAgICAgICAvLyBHZW5lcmljIGRpcmVjdGlvbmFsIHBhdHRlcm5zICh1bml2ZXJzYWwpXG4gICAgICAgICdob21lJywgJ2F3YXknLFxuICAgICAgICAnbGVmdCcsICdyaWdodCcsXG4gICAgICAgICd0b3AnLCAnYm90dG9tJyxcbiAgICAgICAgJ2lubmVyJywgJ291dGVyJyxcblxuICAgICAgICAvLyBHZW5lcmljIGNvbXBldGl0aXZlIHBhdHRlcm5zICh1bml2ZXJzYWwpXG4gICAgICAgICd3aW5uZXInLCAnbG9zZXInLFxuICAgICAgICAnY29tcGV0aXRvcicsICdvcHBvbmVudCdcblxuICAgICAgICAvLyBOT1RFOiBEb21haW4tc3BlY2lmaWMgcHJlZml4ZXMgKHBsYXllciwgdGVhbSwgY3VzdG9tZXIsIG9yZGVyLCBldGMuKVxuICAgICAgICAvLyBzaG91bGQgYmUgcHJvdmlkZWQgdmlhIHVpQ29uZmlnT3B0aW9ucyBpbiB5b3VyIGFwcGxpY2F0aW9uJ3MgYmFja2VuZFxuICAgIF0sXG4gICAgdGVtcGxhdGVTdHlsZTogJ3NpbXBsZScsXG4gICAgY29uZmlkZW5jZVRocmVzaG9sZDogJ21lZGl1bScsXG4gICAgZGVidWc6IGZhbHNlXG59O1xuXG4vKipcbiAqIE1lcmdlIGNvbmZpZ3VyYXRpb25zIHdpdGggcHJpb3JpdHk6IGhpbnRzID4gZW50aXR5ID4gZ2xvYmFsID4gZGVmYXVsdHNcbiAqL1xuZnVuY3Rpb24gbWVyZ2VEZXRlY3Rpb25Db25maWdzKFxuICAgIGdsb2JhbENvbmZpZz86IElEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25Db25maWcsXG4gICAgZW50aXR5Q29uZmlnPzogSUR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbkNvbmZpZyxcbiAgICByZWxhdGlvbkhpbnRzPzoge1xuICAgICAgICBwcmVmZXJyZWRGaWVsZHM/OiBzdHJpbmdbXTtcbiAgICAgICAgZXhjbHVkZUZpZWxkcz86IHN0cmluZ1tdO1xuICAgICAgICB0ZW1wbGF0ZVN0eWxlPzogJ3NpbXBsZScgfCAnY29tcG9zaXRlJztcbiAgICB9XG4pOiBSZXF1aXJlZDxJRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uQ29uZmlnPiAmIHsgcHJlZmVycmVkRmllbGRzPzogc3RyaW5nW107IGV4Y2x1ZGVGaWVsZHM/OiBzdHJpbmdbXSB9IHtcbiAgICAvLyBTdGFydCB3aXRoIGRlZmF1bHRzXG4gICAgbGV0IG1lcmdlZCA9IHsgLi4uREVGQVVMVF9ERVRFQ1RJT05fQ09ORklHIH07XG5cbiAgICAvLyBBcHBseSBnbG9iYWwgY29uZmlnXG4gICAgaWYgKGdsb2JhbENvbmZpZykge1xuICAgICAgICBtZXJnZWQgPSB7XG4gICAgICAgICAgICAuLi5tZXJnZWQsXG4gICAgICAgICAgICAuLi5nbG9iYWxDb25maWcsXG4gICAgICAgICAgICBzdWZmaXhlczogeyAuLi5tZXJnZWQuc3VmZml4ZXMsIC4uLmdsb2JhbENvbmZpZy5zdWZmaXhlcyB9LFxuICAgICAgICAgICAgcHJlZml4ZXM6IGdsb2JhbENvbmZpZy5wcmVmaXhlcyB8fCBtZXJnZWQucHJlZml4ZXNcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBBcHBseSBlbnRpdHkgY29uZmlnIChoaWdoZXIgcHJpb3JpdHkpXG4gICAgaWYgKGVudGl0eUNvbmZpZykge1xuICAgICAgICBtZXJnZWQgPSB7XG4gICAgICAgICAgICAuLi5tZXJnZWQsXG4gICAgICAgICAgICAuLi5lbnRpdHlDb25maWcsXG4gICAgICAgICAgICBzdWZmaXhlczogeyAuLi5tZXJnZWQuc3VmZml4ZXMsIC4uLmVudGl0eUNvbmZpZy5zdWZmaXhlcyB9LFxuICAgICAgICAgICAgcHJlZml4ZXM6IGVudGl0eUNvbmZpZy5wcmVmaXhlcyB8fCBtZXJnZWQucHJlZml4ZXNcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBBcHBseSByZWxhdGlvbiBoaW50cyAoaGlnaGVzdCBwcmlvcml0eSlcbiAgICBjb25zdCByZXN1bHQ6IGFueSA9IHsgLi4ubWVyZ2VkIH07XG4gICAgaWYgKHJlbGF0aW9uSGludHMpIHtcbiAgICAgICAgaWYgKHJlbGF0aW9uSGludHMudGVtcGxhdGVTdHlsZSkge1xuICAgICAgICAgICAgcmVzdWx0LnRlbXBsYXRlU3R5bGUgPSByZWxhdGlvbkhpbnRzLnRlbXBsYXRlU3R5bGU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlbGF0aW9uSGludHMucHJlZmVycmVkRmllbGRzKSB7XG4gICAgICAgICAgICByZXN1bHQucHJlZmVycmVkRmllbGRzID0gcmVsYXRpb25IaW50cy5wcmVmZXJyZWRGaWVsZHM7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlbGF0aW9uSGludHMuZXhjbHVkZUZpZWxkcykge1xuICAgICAgICAgICAgcmVzdWx0LmV4Y2x1ZGVGaWVsZHMgPSByZWxhdGlvbkhpbnRzLmV4Y2x1ZGVGaWVsZHM7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuXG4vKipcbiAqIFBhcnNlIHJlbGF0aW9uIGZpZWxkIHRvIGV4dHJhY3QgcHJlZml4IGFuZCBiYXNlIG5hbWUuXG4gKiBcbiAqIEV4YW1wbGVzOlxuICogLSAndGVhbUlkJyDihpIgeyBiYXNlTmFtZTogJ1RlYW0nLCBoYXNJZFN1ZmZpeDogdHJ1ZSB9XG4gKiAtICdob21lVGVhbUlkJyDihpIgeyBwcmVmaXg6ICdob21lJywgYmFzZU5hbWU6ICdUZWFtJywgaGFzSWRTdWZmaXg6IHRydWUgfVxuICogLSAnY29tcGV0aXRvcjFUZWFtSWQnIOKGkiB7IHByZWZpeDogJ2NvbXBldGl0b3IxJywgYmFzZU5hbWU6ICdUZWFtJywgaGFzSWRTdWZmaXg6IHRydWUgfVxuICogLSAnc3BvcnQnIOKGkiB7IGJhc2VOYW1lOiAnc3BvcnQnLCBoYXNJZFN1ZmZpeDogZmFsc2UgfVxuICovXG5mdW5jdGlvbiBwYXJzZVJlbGF0aW9uRmllbGQoXG4gICAgZmllbGRJZDogc3RyaW5nLFxuICAgIHByZWZpeGVzOiBzdHJpbmdbXVxuKTogUGFyc2VkUmVsYXRpb25GaWVsZCB7XG4gICAgLy8gQnVpbGQgcmVnZXggZm9yIHByZWZpeCBkZXRlY3Rpb246IF4ocHJlZml4MXxwcmVmaXgyfC4uLikoXFxcXGQqKSguKykkXG4gICAgLy8gVXNlIGNhc2UtaW5zZW5zaXRpdmUgbWF0Y2hpbmdcbiAgICBjb25zdCBwcmVmaXhQYXR0ZXJuID0gbmV3IFJlZ0V4cChcbiAgICAgICAgYF4oJHtwcmVmaXhlcy5qb2luKCd8Jyl9KShcXFxcZCopKC4rKSRgLFxuICAgICAgICAnaSdcbiAgICApO1xuXG4gICAgY29uc3QgbWF0Y2ggPSBmaWVsZElkLm1hdGNoKHByZWZpeFBhdHRlcm4pO1xuXG4gICAgaWYgKG1hdGNoKSB7XG4gICAgICAgIGNvbnN0IFsgLCBwcmVmaXgsIG51bSwgcmVzdCBdID0gbWF0Y2g7XG4gICAgICAgIGNvbnN0IGhhc0lkU3VmZml4ID0gcmVzdC50b0xvd2VyQ2FzZSgpLmVuZHNXaXRoKCdpZCcpO1xuICAgICAgICBjb25zdCBiYXNlTmFtZSA9IGhhc0lkU3VmZml4XG4gICAgICAgICAgICA/IHJlc3Quc3Vic3RyaW5nKDAsIHJlc3QubGVuZ3RoIC0gMilcbiAgICAgICAgICAgIDogcmVzdDtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgcHJlZml4OiBwcmVmaXggKyBudW0sICAvLyAnaG9tZScgb3IgJ2NvbXBldGl0b3IxJ1xuICAgICAgICAgICAgYmFzZU5hbWUsXG4gICAgICAgICAgICBoYXNJZFN1ZmZpeCxcbiAgICAgICAgICAgIG9yaWdpbmFsRmllbGQ6IGZpZWxkSWRcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBObyBwcmVmaXggZGV0ZWN0ZWRcbiAgICBjb25zdCBoYXNJZFN1ZmZpeCA9IGZpZWxkSWQudG9Mb3dlckNhc2UoKS5lbmRzV2l0aCgnaWQnKTtcbiAgICBjb25zdCBiYXNlTmFtZSA9IGhhc0lkU3VmZml4XG4gICAgICAgID8gZmllbGRJZC5zdWJzdHJpbmcoMCwgZmllbGRJZC5sZW5ndGggLSAyKVxuICAgICAgICA6IGZpZWxkSWQ7XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBiYXNlTmFtZSxcbiAgICAgICAgaGFzSWRTdWZmaXgsXG4gICAgICAgIG9yaWdpbmFsRmllbGQ6IGZpZWxkSWRcbiAgICB9O1xufVxuXG4vKipcbiAqIEdlbmVyYXRlIHNlYXJjaCBwYXR0ZXJucyBmb3IgY2FuZGlkYXRlIGZpZWxkIG5hbWVzLlxuICogXG4gKiBQcmlvcml0eTpcbiAqIDEuIFByZWZlcnJlZCBmaWVsZHMgKGZyb20gaGludHMpXG4gKiAyLiBFeGFjdCBwcmVmaXggbWF0Y2g6IHtwcmVmaXh9e2Jhc2VOYW1lfXtzdWZmaXh9XG4gKiAzLiBFbnRpdHkgbmFtZSBtYXRjaDoge2VudGl0eU5hbWV9e3N1ZmZpeH1cbiAqIDQuIEJhc2UgbmFtZSBtYXRjaDoge2Jhc2VOYW1lfXtzdWZmaXh9XG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlU2VhcmNoUGF0dGVybnMoXG4gICAgcGFyc2VkOiBQYXJzZWRSZWxhdGlvbkZpZWxkLFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBzdWZmaXhlczogc3RyaW5nW10sXG4gICAgcHJlZmVycmVkRmllbGRzPzogc3RyaW5nW11cbik6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBwYXR0ZXJuczogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCBlbnRpdHlOYW1lTG93ZXIgPSBlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgYmFzZU5hbWVMb3dlciA9IHBhcnNlZC5iYXNlTmFtZS50b0xvd2VyQ2FzZSgpO1xuXG4gICAgLy8gUHJpb3JpdHkgMTogUHJlZmVycmVkIGZpZWxkcyAoZXhhY3QgbWF0Y2gpXG4gICAgaWYgKHByZWZlcnJlZEZpZWxkcyAmJiBwcmVmZXJyZWRGaWVsZHMubGVuZ3RoID4gMCkge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKC4uLnByZWZlcnJlZEZpZWxkcyk7XG4gICAgfVxuXG4gICAgLy8gUHJpb3JpdHkgMjogV2l0aCBwcmVmaXggKGUuZy4sIGhvbWVUZWFtTmFtZSwgYXdheVRlYW1OYW1lKVxuICAgIGlmIChwYXJzZWQucHJlZml4KSB7XG4gICAgICAgIGNvbnN0IHByZWZpeExvd2VyID0gcGFyc2VkLnByZWZpeC50b0xvd2VyQ2FzZSgpO1xuICAgICAgICBmb3IgKGNvbnN0IHN1ZmZpeCBvZiBzdWZmaXhlcykge1xuICAgICAgICAgICAgcGF0dGVybnMucHVzaChgJHtwcmVmaXhMb3dlcn0ke2Jhc2VOYW1lTG93ZXJ9JHtzdWZmaXgudG9Mb3dlckNhc2UoKX1gKTtcbiAgICAgICAgICAgIHBhdHRlcm5zLnB1c2goYCR7cHJlZml4TG93ZXJ9JHtlbnRpdHlOYW1lTG93ZXJ9JHtzdWZmaXgudG9Mb3dlckNhc2UoKX1gKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFByaW9yaXR5IDM6IEVudGl0eSBuYW1lIChlLmcuLCB0ZWFtTmFtZSBmb3IgcmVsYXRpb24gdG8gJ3RlYW0nKVxuICAgIGZvciAoY29uc3Qgc3VmZml4IG9mIHN1ZmZpeGVzKSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYCR7ZW50aXR5TmFtZUxvd2VyfSR7c3VmZml4LnRvTG93ZXJDYXNlKCl9YCk7XG4gICAgfVxuXG4gICAgLy8gUHJpb3JpdHkgNDogQmFzZSBuYW1lIChlLmcuLCB0ZWFtTmFtZSBmb3IgJ3RlYW1JZCcpXG4gICAgZm9yIChjb25zdCBzdWZmaXggb2Ygc3VmZml4ZXMpIHtcbiAgICAgICAgcGF0dGVybnMucHVzaChgJHtiYXNlTmFtZUxvd2VyfSR7c3VmZml4LnRvTG93ZXJDYXNlKCl9YCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHBhdHRlcm5zO1xufVxuXG4vKipcbiAqIFNlYXJjaCBmb3IgZmllbGRzIG1hdGNoaW5nIHBhdHRlcm5zLCBleGNsdWRpbmcgc3BlY2lmaWVkIGZpZWxkcy5cbiAqL1xuZnVuY3Rpb24gc2VhcmNoRmllbGRzQnlQYXR0ZXJucyhcbiAgICBhbGxQcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSxcbiAgICBwYXR0ZXJuczogc3RyaW5nW10sXG4gICAgZXhjbHVkZUZpZWxkcz86IHN0cmluZ1tdXG4pOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgZXhjbHVkZVNldCA9IG5ldyBTZXQoZXhjbHVkZUZpZWxkcz8ubWFwKGYgPT4gZi50b0xvd2VyQ2FzZSgpKSB8fCBbXSk7XG4gICAgY29uc3QgZm91bmQ6IHN0cmluZ1tdID0gW107XG4gICAgY29uc3Qgc2Vlbkxvd2VyID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICBmb3IgKGNvbnN0IHBhdHRlcm4gb2YgcGF0dGVybnMpIHtcbiAgICAgICAgY29uc3QgcGF0dGVybkxvd2VyID0gcGF0dGVybi50b0xvd2VyQ2FzZSgpO1xuXG4gICAgICAgIC8vIFNraXAgaWYgYWxyZWFkeSBmb3VuZCBvciBleGNsdWRlZFxuICAgICAgICBpZiAoc2Vlbkxvd2VyLmhhcyhwYXR0ZXJuTG93ZXIpIHx8IGV4Y2x1ZGVTZXQuaGFzKHBhdHRlcm5Mb3dlcikpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRmluZCBtYXRjaGluZyBmaWVsZCAoY2FzZS1pbnNlbnNpdGl2ZSlcbiAgICAgICAgY29uc3QgbWF0Y2ggPSBhbGxQcm9wZXJ0aWVzLmZpbmQocCA9PlxuICAgICAgICAgICAgcC5pZD8udG9Mb3dlckNhc2UoKSA9PT0gcGF0dGVybkxvd2VyICYmXG4gICAgICAgICAgICAhZXhjbHVkZVNldC5oYXMocC5pZC50b0xvd2VyQ2FzZSgpKVxuICAgICAgICApO1xuXG4gICAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICAgICAgZm91bmQucHVzaChtYXRjaC5pZCk7XG4gICAgICAgICAgICBzZWVuTG93ZXIuYWRkKG1hdGNoLmlkLnRvTG93ZXJDYXNlKCkpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZvdW5kO1xufVxuXG4vKipcbiAqIENhbGN1bGF0ZSBjb25maWRlbmNlIGJhc2VkIG9uIGRldGVjdGlvbiBtZXRob2QgYW5kIHBhdHRlcm5cbiAqL1xuZnVuY3Rpb24gY2FsY3VsYXRlQ29uZmlkZW5jZShcbiAgICBkZXRlY3RlZEZpZWxkOiBzdHJpbmcsXG4gICAgcGFyc2VkOiBQYXJzZWRSZWxhdGlvbkZpZWxkLFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBtZXRob2Q6ICdwcmVmZXJyZWQnIHwgJ3ByZWZpeCcgfCAnZW50aXR5JyB8ICdiYXNlJ1xuKTogJ2hpZ2gnIHwgJ21lZGl1bScgfCAnbG93JyB7XG4gICAgLy8gUHJlZmVycmVkIGZpZWxkcyA9IGhpZ2ggY29uZmlkZW5jZSAoZGV2ZWxvcGVyIGV4cGxpY2l0bHkgc3BlY2lmaWVkKVxuICAgIGlmIChtZXRob2QgPT09ICdwcmVmZXJyZWQnKSByZXR1cm4gJ2hpZ2gnO1xuXG4gICAgY29uc3QgZmllbGRMb3dlciA9IGRldGVjdGVkRmllbGQudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBlbnRpdHlMb3dlciA9IGVudGl0eU5hbWUudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBiYXNlTG93ZXIgPSBwYXJzZWQuYmFzZU5hbWUudG9Mb3dlckNhc2UoKTtcblxuICAgIC8vIEV4YWN0IHByZWZpeCArIGVudGl0eS9iYXNlIG1hdGNoID0gaGlnaFxuICAgIGlmIChtZXRob2QgPT09ICdwcmVmaXgnKSB7XG4gICAgICAgIGlmIChmaWVsZExvd2VyLmluY2x1ZGVzKGVudGl0eUxvd2VyKSB8fCBmaWVsZExvd2VyLmluY2x1ZGVzKGJhc2VMb3dlcikpIHtcbiAgICAgICAgICAgIHJldHVybiAnaGlnaCc7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICdtZWRpdW0nO1xuICAgIH1cblxuICAgIC8vIEVudGl0eSBuYW1lIG1hdGNoID0gaGlnaFxuICAgIGlmIChtZXRob2QgPT09ICdlbnRpdHknKSByZXR1cm4gJ2hpZ2gnO1xuXG4gICAgLy8gQmFzZSBuYW1lIG1hdGNoID0gbWVkaXVtIChjb3VsZCBiZSBjb2luY2lkZW50YWwpXG4gICAgaWYgKG1ldGhvZCA9PT0gJ2Jhc2UnKSByZXR1cm4gJ21lZGl1bSc7XG5cbiAgICByZXR1cm4gJ2xvdyc7XG59XG5cbi8qKlxuICogR2VuZXJhdGUgdGVtcGxhdGUgc3RyaW5nIGZyb20gZGV0ZWN0ZWQgZmllbGRzLlxuICovXG5mdW5jdGlvbiBnZW5lcmF0ZVRlbXBsYXRlKFxuICAgIHByaW1hcnlGaWVsZDogc3RyaW5nLFxuICAgIGFsbERldGVjdGVkRmllbGRzOiBEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25SZXN1bHRbICdkZXRlY3RlZEZpZWxkcycgXSxcbiAgICB0ZW1wbGF0ZVN0eWxlOiAnc2ltcGxlJyB8ICdjb21wb3NpdGUnXG4pOiBzdHJpbmcge1xuICAgIGlmICh0ZW1wbGF0ZVN0eWxlID09PSAnc2ltcGxlJykge1xuICAgICAgICByZXR1cm4gYHske3ByaW1hcnlGaWVsZH19YDtcbiAgICB9XG5cbiAgICAvLyBDb21wb3NpdGU6IHRyeSB0byBpbmNsdWRlIG1ldGEgZmllbGQgKGNvZGUvc2x1ZykgaWYgYXZhaWxhYmxlXG4gICAgaWYgKHRlbXBsYXRlU3R5bGUgPT09ICdjb21wb3NpdGUnICYmIGFsbERldGVjdGVkRmllbGRzLm1ldGEgJiYgYWxsRGV0ZWN0ZWRGaWVsZHMubWV0YS5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IG1ldGFGaWVsZCA9IGFsbERldGVjdGVkRmllbGRzLm1ldGFbIDAgXTtcbiAgICAgICAgcmV0dXJuIGB7JHtwcmltYXJ5RmllbGR9fSAoeyR7bWV0YUZpZWxkfX0pYDtcbiAgICB9XG5cbiAgICAvLyBGYWxsYmFjayB0byBzaW1wbGUgaWYgbm8gbWV0YSBmaWVsZFxuICAgIHJldHVybiBgeyR7cHJpbWFyeUZpZWxkfX1gO1xufVxuXG4vKipcbiAqIEVuaGFuY2VkIHNtYXJ0IGR1cGxpY2F0ZWQgZmllbGQgZGV0ZWN0aW9uLlxuICogXG4gKiBEZXRlY3RzIGZpZWxkcyBsaWtlICd0ZWFtTmFtZScgZm9yICd0ZWFtSWQnIHJlbGF0aW9ucyB3aXRoIHN1cHBvcnQgZm9yOlxuICogLSBQcmVmaXhlcyAoaG9tZSwgYXdheSwgY29tcGV0aXRvcjEsIGV0Yy4pXG4gKiAtIE11bHRpcGxlIHN1ZmZpeGVzIChOYW1lLCBUaXRsZSwgTGFiZWwsIExvZ28sIENvZGUsIGV0Yy4pXG4gKiAtIFByZWZlcnJlZCBmaWVsZHMgYW5kIGV4Y2x1c2lvbnNcbiAqIC0gQ29uZmlkZW5jZSBzY29yaW5nXG4gKiAtIENvbXBvc2l0ZSB0ZW1wbGF0ZXNcbiAqIFxuICogQHBhcmFtIGFsbFByb3BlcnRpZXMgLSBBbGwgcHJvcGVydGllcyBpbiB0aGUgcGFyZW50IGVudGl0eVxuICogQHBhcmFtIHJlbGF0aW9uRmllbGRJZCAtIFRoZSByZWxhdGlvbiBmaWVsZCBuYW1lIChlLmcuLCAndGVhbUlkJywgJ2hvbWVUZWFtSWQnKVxuICogQHBhcmFtIHJlbGF0ZWRFbnRpdHlOYW1lIC0gUmVsYXRlZCBlbnRpdHkgbmFtZSAoZS5nLiwgJ3RlYW0nKVxuICogQHBhcmFtIGdsb2JhbENvbmZpZyAtIEdsb2JhbCBkZXRlY3Rpb24gY29uZmlndXJhdGlvblxuICogQHBhcmFtIGVudGl0eUNvbmZpZyAtIEVudGl0eS1sZXZlbCBkZXRlY3Rpb24gY29uZmlndXJhdGlvblxuICogQHBhcmFtIHJlbGF0aW9uSGludHMgLSBSZWxhdGlvbi1zcGVjaWZpYyBoaW50c1xuICogQHJldHVybnMgRGV0ZWN0aW9uIHJlc3VsdCB3aXRoIHRlbXBsYXRlIGFuZCBtZXRhZGF0YVxuICovXG5mdW5jdGlvbiBkZXRlY3REdXBsaWNhdGVkUmVsYXRpb25GaWVsZHMoXG4gICAgYWxsUHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sXG4gICAgcmVsYXRpb25GaWVsZElkOiBzdHJpbmcsXG4gICAgcmVsYXRlZEVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBnbG9iYWxDb25maWc/OiBJRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uQ29uZmlnLFxuICAgIGVudGl0eUNvbmZpZz86IElEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25Db25maWcsXG4gICAgcmVsYXRpb25IaW50cz86IHtcbiAgICAgICAgcHJlZmVycmVkRmllbGRzPzogc3RyaW5nW107XG4gICAgICAgIGV4Y2x1ZGVGaWVsZHM/OiBzdHJpbmdbXTtcbiAgICAgICAgdGVtcGxhdGVTdHlsZT86ICdzaW1wbGUnIHwgJ2NvbXBvc2l0ZSc7XG4gICAgfVxuKTogRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uUmVzdWx0IHwgdW5kZWZpbmVkIHtcbiAgICAvLyBNZXJnZSBjb25maWd1cmF0aW9uc1xuICAgIGNvbnN0IGNvbmZpZyA9IG1lcmdlRGV0ZWN0aW9uQ29uZmlncyhnbG9iYWxDb25maWcsIGVudGl0eUNvbmZpZywgcmVsYXRpb25IaW50cyk7XG5cbiAgICAvLyBDaGVjayBpZiBkZXRlY3Rpb24gaXMgZW5hYmxlZFxuICAgIGlmICghY29uZmlnLmVuYWJsZWQpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyBQYXJzZSByZWxhdGlvbiBmaWVsZFxuICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlUmVsYXRpb25GaWVsZChyZWxhdGlvbkZpZWxkSWQsIGNvbmZpZy5wcmVmaXhlcyk7XG5cbiAgICAvLyBTZWFyY2ggZm9yIGRpc3BsYXkgZmllbGRzIChOYW1lLCBUaXRsZSwgTGFiZWwpXG4gICAgY29uc3QgZGlzcGxheVBhdHRlcm5zID0gZ2VuZXJhdGVTZWFyY2hQYXR0ZXJucyhcbiAgICAgICAgcGFyc2VkLFxuICAgICAgICByZWxhdGVkRW50aXR5TmFtZSxcbiAgICAgICAgY29uZmlnLnN1ZmZpeGVzPy5kaXNwbGF5IHx8IFtdLFxuICAgICAgICBjb25maWcucHJlZmVycmVkRmllbGRzXG4gICAgKTtcbiAgICBjb25zdCBkaXNwbGF5RmllbGRzID0gc2VhcmNoRmllbGRzQnlQYXR0ZXJucyhhbGxQcm9wZXJ0aWVzLCBkaXNwbGF5UGF0dGVybnMsIGNvbmZpZy5leGNsdWRlRmllbGRzKTtcblxuICAgIC8vIFNlYXJjaCBmb3IgdmlzdWFsIGZpZWxkcyAoTG9nbywgSW1hZ2UsIEljb24pXG4gICAgY29uc3QgdmlzdWFsUGF0dGVybnMgPSBnZW5lcmF0ZVNlYXJjaFBhdHRlcm5zKFxuICAgICAgICBwYXJzZWQsXG4gICAgICAgIHJlbGF0ZWRFbnRpdHlOYW1lLFxuICAgICAgICBjb25maWcuc3VmZml4ZXM/LnZpc3VhbCB8fCBbXVxuICAgICk7XG4gICAgY29uc3QgdmlzdWFsRmllbGRzID0gc2VhcmNoRmllbGRzQnlQYXR0ZXJucyhhbGxQcm9wZXJ0aWVzLCB2aXN1YWxQYXR0ZXJucywgY29uZmlnLmV4Y2x1ZGVGaWVsZHMpO1xuXG4gICAgLy8gU2VhcmNoIGZvciBtZXRhIGZpZWxkcyAoQ29kZSwgU2x1ZywgS2V5KVxuICAgIGNvbnN0IG1ldGFQYXR0ZXJucyA9IGdlbmVyYXRlU2VhcmNoUGF0dGVybnMoXG4gICAgICAgIHBhcnNlZCxcbiAgICAgICAgcmVsYXRlZEVudGl0eU5hbWUsXG4gICAgICAgIGNvbmZpZy5zdWZmaXhlcz8ubWV0YSB8fCBbXVxuICAgICk7XG4gICAgY29uc3QgbWV0YUZpZWxkcyA9IHNlYXJjaEZpZWxkc0J5UGF0dGVybnMoYWxsUHJvcGVydGllcywgbWV0YVBhdHRlcm5zLCBjb25maWcuZXhjbHVkZUZpZWxkcyk7XG5cbiAgICAvLyBObyBmaWVsZHMgZGV0ZWN0ZWRcbiAgICBpZiAoZGlzcGxheUZpZWxkcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyBEZXRlcm1pbmUgZGV0ZWN0aW9uIG1ldGhvZFxuICAgIGNvbnN0IHByaW1hcnlGaWVsZCA9IGRpc3BsYXlGaWVsZHNbIDAgXTtcbiAgICBsZXQgbWV0aG9kOiAncHJlZmVycmVkJyB8ICdwcmVmaXgnIHwgJ2VudGl0eScgfCAnYmFzZScgPSAnYmFzZSc7XG4gICAgbGV0IHBhdHRlcm4gPSAndW5rbm93bic7XG5cbiAgICBpZiAoY29uZmlnLnByZWZlcnJlZEZpZWxkcyAmJiBjb25maWcucHJlZmVycmVkRmllbGRzLmluY2x1ZGVzKHByaW1hcnlGaWVsZCkpIHtcbiAgICAgICAgbWV0aG9kID0gJ3ByZWZlcnJlZCc7XG4gICAgICAgIHBhdHRlcm4gPSAncHJlZmVycmVkX2ZpZWxkJztcbiAgICB9IGVsc2UgaWYgKHBhcnNlZC5wcmVmaXggJiYgcHJpbWFyeUZpZWxkLnRvTG93ZXJDYXNlKCkuc3RhcnRzV2l0aChwYXJzZWQucHJlZml4LnRvTG93ZXJDYXNlKCkpKSB7XG4gICAgICAgIG1ldGhvZCA9ICdwcmVmaXgnO1xuICAgICAgICBwYXR0ZXJuID0gYCR7cGFyc2VkLnByZWZpeH17ZW50aXR5fXtzdWZmaXh9YDtcbiAgICB9IGVsc2UgaWYgKHByaW1hcnlGaWVsZC50b0xvd2VyQ2FzZSgpLnN0YXJ0c1dpdGgocmVsYXRlZEVudGl0eU5hbWUudG9Mb3dlckNhc2UoKSkpIHtcbiAgICAgICAgbWV0aG9kID0gJ2VudGl0eSc7XG4gICAgICAgIHBhdHRlcm4gPSBge2VudGl0eX17c3VmZml4fWA7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgbWV0aG9kID0gJ2Jhc2UnO1xuICAgICAgICBwYXR0ZXJuID0gYHtiYXNlfXtzdWZmaXh9YDtcbiAgICB9XG5cbiAgICAvLyBDYWxjdWxhdGUgY29uZmlkZW5jZVxuICAgIGNvbnN0IGNvbmZpZGVuY2UgPSBjYWxjdWxhdGVDb25maWRlbmNlKHByaW1hcnlGaWVsZCwgcGFyc2VkLCByZWxhdGVkRW50aXR5TmFtZSwgbWV0aG9kKTtcblxuICAgIC8vIENoZWNrIGNvbmZpZGVuY2UgdGhyZXNob2xkXG4gICAgY29uc3QgdGhyZXNob2xkT3JkZXIgPSB7IGxvdzogMCwgbWVkaXVtOiAxLCBoaWdoOiAyIH07XG4gICAgaWYgKHRocmVzaG9sZE9yZGVyWyBjb25maWRlbmNlIF0gPCB0aHJlc2hvbGRPcmRlclsgY29uZmlnLmNvbmZpZGVuY2VUaHJlc2hvbGQgXSkge1xuICAgICAgICAvLyBDb25maWRlbmNlIHRvbyBsb3dcbiAgICAgICAgaWYgKGNvbmZpZy5kZWJ1Zykge1xuICAgICAgICAgICAgRGVmYXVsdExvZ2dlci5pbmZvKGBbRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uXSBTa2lwcGluZyAke3JlbGF0aW9uRmllbGRJZH06IGNvbmZpZGVuY2UgJHtjb25maWRlbmNlfSA8IHRocmVzaG9sZCAke2NvbmZpZy5jb25maWRlbmNlVGhyZXNob2xkfWApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgLy8gR2VuZXJhdGUgdGVtcGxhdGVcbiAgICBjb25zdCB0ZW1wbGF0ZSA9IGdlbmVyYXRlVGVtcGxhdGUoXG4gICAgICAgIHByaW1hcnlGaWVsZCxcbiAgICAgICAgeyBkaXNwbGF5OiBkaXNwbGF5RmllbGRzLCB2aXN1YWw6IHZpc3VhbEZpZWxkcywgbWV0YTogbWV0YUZpZWxkcyB9LFxuICAgICAgICBjb25maWcudGVtcGxhdGVTdHlsZVxuICAgICk7XG5cbiAgICAvLyBEZWJ1ZyBsb2dnaW5nXG4gICAgaWYgKGNvbmZpZy5kZWJ1Zykge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25dICR7cmVsYXRpb25GaWVsZElkfSDihpIgJHt0ZW1wbGF0ZX0gKGNvbmZpZGVuY2U6ICR7Y29uZmlkZW5jZX0sIG1ldGhvZDogJHttZXRob2R9KWApO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIHByaW1hcnlGaWVsZCxcbiAgICAgICAgdGVtcGxhdGUsXG4gICAgICAgIGRldGVjdGVkRmllbGRzOiB7XG4gICAgICAgICAgICBkaXNwbGF5OiBkaXNwbGF5RmllbGRzLFxuICAgICAgICAgICAgdmlzdWFsOiB2aXN1YWxGaWVsZHMubGVuZ3RoID4gMCA/IHZpc3VhbEZpZWxkcyA6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgIG1ldGE6IG1ldGFGaWVsZHMubGVuZ3RoID4gMCA/IG1ldGFGaWVsZHMgOiB1bmRlZmluZWRcbiAgICAgICAgfSxcbiAgICAgICAgY29uZmlkZW5jZSxcbiAgICAgICAgbWV0aG9kLFxuICAgICAgICBwYXR0ZXJuXG4gICAgfTtcbn1cblxuLyoqXG4gKiBMZWdhY3kgd3JhcHBlciBmdW5jdGlvbiBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eS5cbiAqIFxuICogQGRlcHJlY2F0ZWQgVXNlIGRldGVjdER1cGxpY2F0ZWRSZWxhdGlvbkZpZWxkcygpIGZvciByaWNoZXIgcmVzdWx0c1xuICovXG5mdW5jdGlvbiBkZXRlY3REdXBsaWNhdGVkUmVsYXRpb25GaWVsZFRlbXBsYXRlKFxuICAgIGFsbFByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLFxuICAgIHJlbGF0aW9uRmllbGRJZDogc3RyaW5nLFxuICAgIHJlbGF0ZWRFbnRpdHlOYW1lOiBzdHJpbmdcbik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgcmVzdWx0ID0gZGV0ZWN0RHVwbGljYXRlZFJlbGF0aW9uRmllbGRzKFxuICAgICAgICBhbGxQcm9wZXJ0aWVzLFxuICAgICAgICByZWxhdGlvbkZpZWxkSWQsXG4gICAgICAgIHJlbGF0ZWRFbnRpdHlOYW1lXG4gICAgKTtcbiAgICByZXR1cm4gcmVzdWx0Py50ZW1wbGF0ZTtcbn1cblxuLyoqXG4gKiBHZW5lcmF0ZSBzbWFydCBmYWxsYmFjayBjb25maWd1cmF0aW9uIGZvciByZWxhdGlvbiBkaXNwbGF5IHdoZW4gb25seSBJRCBpcyBhdmFpbGFibGUuXG4gKiBVc2VzIGVudGl0eSBtZXRhZGF0YSAoaWNvbiwgZW50aXR5TmFtZVBsdXJhbCkgdG8gY3JlYXRlIHVzZXItZnJpZW5kbHkgZmFsbGJhY2sgdGV4dC5cbiAqIFxuICogQHBhcmFtIGVudGl0eU5hbWUgLSBSZWxhdGVkIGVudGl0eSBuYW1lIChlLmcuLCAndGVhbScpXG4gKiBAcGFyYW0gaWRGaWVsZCAtIElEIGZpZWxkIG5hbWUgKGUuZy4sICd0ZWFtSWQnKVxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSB0byBnZXQgbWV0YWRhdGEgZnJvbVxuICogQHJldHVybnMgRmFsbGJhY2sgY29uZmlndXJhdGlvbiB3aXRoIHRlbXBsYXRlLCBsaW5rVGV4dCwgYW5kIG1vZGFsQnV0dG9uVGV4dFxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gRm9yIGEgdGVhbSByZWxhdGlvblxuICogZ2VuZXJhdGVSZWxhdGlvbkZhbGxiYWNrKCd0ZWFtJywgJ3RlYW1JZCcsIHRlYW1TZXJ2aWNlKVxuICogLy8gUmV0dXJuczoge1xuICogLy8gICB0ZW1wbGF0ZTogJ1RlYW06IHt0ZWFtSWR9JyxcbiAqIC8vICAgbGlua1RleHQ6ICdWaWV3IFRlYW0nLFxuICogLy8gICBtb2RhbEJ1dHRvblRleHQ6ICdUZWFtIERldGFpbHMnXG4gKiAvLyB9XG4gKi9cbi8qKlxuICogR2VuZXJhdGVzIGZhbGxiYWNrIGRpc3BsYXkgY29uZmlndXJhdGlvbiBmb3IgcmVsYXRpb24gZmllbGRzLlxuICogXG4gKiBDcmVhdGVzIHVzZXItZnJpZW5kbHkgZmFsbGJhY2sgdGV4dCB0byBkaXNwbGF5IHdoZW4gb25seSB0aGUgSUQgb2YgYSByZWxhdGVkIGVudGl0eSBpcyBhdmFpbGFibGUuXG4gKiBVc2VzIHRoZSBlbnRpdHkncyBwbHVyYWwgZGlzcGxheSBuYW1lIChmcm9tIG1ldGFkYXRhKSBvciBnZW5lcmF0ZXMgaXQgZnJvbSB0aGUgZW50aXR5IG5hbWUuXG4gKiBcbiAqIEBwYXJhbSBlbnRpdHlOYW1lIC0gTmFtZSBvZiB0aGUgcmVsYXRlZCBlbnRpdHkgKGUuZy4sICd0ZWFtJywgJ3VzZXInKVxuICogQHBhcmFtIGlkRmllbGQgLSBJRCBmaWVsZCBuYW1lIChlLmcuLCAndGVhbUlkJywgJ3VzZXJJZCcpXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIE9wdGlvbmFsIGVudGl0eSBzZXJ2aWNlIHRvIGZldGNoIG1ldGFkYXRhIGZvciBiZXR0ZXIgbmFtaW5nXG4gKiBAcmV0dXJucyBGYWxsYmFjayBjb25maWd1cmF0aW9uIHdpdGggdGVtcGxhdGUsIGxpbmsgdGV4dCwgYW5kIG1vZGFsIGJ1dHRvbiB0ZXh0XG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBmYWxsYmFjayA9IGdlbmVyYXRlUmVsYXRpb25GYWxsYmFjaygndGVhbScsICd0ZWFtSWQnKTtcbiAqIC8vIFJldHVybnM6IHtcbiAqIC8vICAgdGVtcGxhdGU6IFwiVGVhbXM6IHt0ZWFtSWR9XCIsXG4gKiAvLyAgIGxpbmtUZXh0OiBcIlZpZXcgVGVhbXNcIixcbiAqIC8vICAgbW9kYWxCdXR0b25UZXh0OiBcIlRlYW1zIERldGFpbHNcIlxuICogLy8gfVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZW5lcmF0ZVJlbGF0aW9uRmFsbGJhY2soXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIGlkRmllbGQ6IHN0cmluZyxcbiAgICBlbnRpdHlTZXJ2aWNlPzogQmFzZUVudGl0eVNlcnZpY2U8YW55PlxuKTogTm9uTnVsbGFibGU8SVJlbGF0aW9uRmllbGRDb25maWdbICdkaXNwbGF5Q29uZmlnJyBdPlsgJ2ZhbGxiYWNrJyBdIHtcbiAgICAvLyBUcnkgdG8gZ2V0IGVudGl0eSBtZXRhZGF0YSBmb3IgYmV0dGVyIGZhbGxiYWNrIHRleHRcbiAgICBjb25zdCBlbnRpdHlNZXRhZGF0YSA9IGVudGl0eVNlcnZpY2U/LmdldEVudGl0eVNjaGVtYT8uKCkubW9kZWw7XG4gICAgY29uc3QgZGlzcGxheU5hbWUgPSBlbnRpdHlNZXRhZGF0YT8uZW50aXR5TmFtZVBsdXJhbCB8fCBwYXNjYWxDYXNlKGVudGl0eU5hbWUpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgLy8gQmFja2VuZCBwcmUtZ2VuZXJhdGVzIGZhbGxiYWNrIHRlbXBsYXRlIChpbnRlbnRpb25hbGx5IHN0cmluZy1vbmx5LCBub3QgVGVtcGxhdGUgdHlwZSlcbiAgICAgICAgLy8gRnJvbnRlbmQgd2lsbCB1c2UgdGhpcyB3aGVuIG9ubHkgSUQgaXMgYXZhaWxhYmxlXG4gICAgICAgIHRlbXBsYXRlOiBgJHtkaXNwbGF5TmFtZX06IHske2lkRmllbGR9fWAsICAvLyBlLmcuLCBcIlRlYW06IHt0ZWFtSWR9XCJcbiAgICAgICAgbGlua1RleHQ6IGBWaWV3ICR7ZGlzcGxheU5hbWV9YCwgICAgICAgICAgIC8vIGUuZy4sIFwiVmlldyBUZWFtXCJcbiAgICAgICAgbW9kYWxCdXR0b25UZXh0OiBgJHtkaXNwbGF5TmFtZX0gRGV0YWlsc2AgIC8vIGUuZy4sIFwiVGVhbSBEZXRhaWxzXCJcbiAgICB9O1xufVxuXG4vKipcbiAqIExhYmVsIGZpZWxkIGRldGVjdGlvbiByZXN1bHQgd2l0aCBjb25maWRlbmNlIHNjb3JpbmdcbiAqL1xuaW50ZXJmYWNlIExhYmVsRmllbGREZXRlY3Rpb25SZXN1bHQge1xuICAgIGZpZWxkOiBzdHJpbmc7XG4gICAgY29uZmlkZW5jZTogJ2hpZ2gnIHwgJ21lZGl1bSc7ICAvLyBPbmx5IGhpZ2ggb3IgbWVkaXVtIC0gbm8gbG93IGNvbmZpZGVuY2UgcmVzdWx0cyByZXR1cm5lZFxuICAgIG1ldGhvZDogJ21ldGFkYXRhJyB8ICdjb21tb24tcGF0dGVybicgfCAnZW50aXR5LXBhdHRlcm4nIHwgJ3N1ZmZpeC1wYXR0ZXJuJztcbn1cblxuLyoqXG4gKiBTbWFydCBsYWJlbCBmaWVsZCBkZXRlY3Rpb24gZm9yIGVudGl0eSBvcHRpb25zLlxuICogVXNlcyBnZW5lcmljIHBhdHRlcm5zIHRvIGZpbmQgZGlzcGxheSBmaWVsZHMgdGhhdCBhcmUgYWN0dWFsIGlkZW50aWZpZXJzL25hbWVzLlxuICogXG4gKiAqKkhJR0hMWSBDT05TRVJWQVRJVkUqKjogT25seSByZXR1cm5zIGZpZWxkcyB0aGF0IGFyZSBjbGVhcmx5IG1lYW50IGZvciBkaXNwbGF5LlxuICogUmV0dXJucyB1bmRlZmluZWQgaWYgbm8gcHJvcGVyIG5hbWUgZmllbGQgaXMgZm91bmQgLSBiZXR0ZXIgdG8gc2hvdyBJRCB0aGFuIGNvbmZ1c2UgdXNlcnMuXG4gKiBcbiAqIERldGVjdGlvbiBvcmRlciAoYWxsIEhJR0ggb3IgTUVESVVNIGNvbmZpZGVuY2UpOlxuICogMS4gRW50aXR5IG1ldGFkYXRhIChlbnRpdHlOYW1lQXR0cmlidXRlKSAtIEhJR0ggY29uZmlkZW5jZVxuICogMi4gQ29tbW9uIGRpc3BsYXkgZmllbGQgcGF0dGVybnMgKG5hbWUsIHRpdGxlLCBsYWJlbCwgZGlzcGxheU5hbWUpIC0gSElHSCBjb25maWRlbmNlICBcbiAqIDMuIEVudGl0eS1zcGVjaWZpYyBwYXR0ZXJucyAoe2VudGl0eU5hbWV9TmFtZSwge2VudGl0eU5hbWV9VGl0bGUpIC0gSElHSCBjb25maWRlbmNlXG4gKiA0LiBGaWVsZHMgZW5kaW5nIHdpdGggbmFtZS1saWtlIHN1ZmZpeGVzIChOYW1lLCBUaXRsZSwgTGFiZWwsIENvZGUpIC0gTUVESVVNIGNvbmZpZGVuY2VcbiAqIFxuICogKipOTyBGQUxMQkFDSyoqOiBJZiBub25lIG9mIHRoZSBhYm92ZSBtYXRjaCwgcmV0dXJucyB1bmRlZmluZWQuXG4gKiBXZSBkbyBOT1QgcGljayBnZW5lcmljIGZpZWxkcyBsaWtlICdzdGF0dXMnLCAndHlwZScsIG9yIHJhbmRvbSBlbnVtcy9zdHJpbmdzLlxuICogXG4gKiBXaHkgbm8gZmFsbGJhY2s/XG4gKiAtIFNob3dpbmcgXCJhY3RpdmVcIi9cImNhbmNlbGxlZFwiIGZvciBzdWJzY3JpcHRpb25zIGlzIGNvbmZ1c2luZyAod2hpY2ggc3Vic2NyaXB0aW9uPylcbiAqIC0gU2hvd2luZyBcImNyZWRpdF9jYXJkXCIvXCJwYXlwYWxcIiBmb3IgcGF5bWVudCBtZXRob2RzIGlzIG5vdCBhbiBpZGVudGlmaWVyXG4gKiAtIEJldHRlciB0byBzaG93IHN1YnNjcmlwdGlvbklkIHRoYW4gbWlzbGVhZGluZyBmaWVsZHNcbiAqIFxuICogRm9yIGVudGl0aWVzIHdpdGhvdXQgbmFtZSBmaWVsZHMsIHVzZSBvbmUgb2Y6XG4gKiAtIFNldCBlbnRpdHlOYW1lQXR0cmlidXRlIGluIHNjaGVtYSBtZXRhZGF0YVxuICogLSBVc2Ugb3B0aW9uTWFwcGluZyBpbiByZWxhdGlvbiBjb25maWdcbiAqIC0gTGV0IGl0IGZhbGwgYmFjayB0byBJRCAoY2xlYXJlc3Qgb3B0aW9uKVxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gRW50aXRpZXMgd2l0aCBjbGVhciBuYW1lIGZpZWxkcyAtIERFVEVDVEVEIOKchVxuICogVGVhbSDihpIgdGVhbU5hbWUgKFByaW9yaXR5IDMsIEhJR0ggY29uZmlkZW5jZSlcbiAqIFVzZXIg4oaSIG5hbWUgKFByaW9yaXR5IDIsIEhJR0ggY29uZmlkZW5jZSlcbiAqIFBvc3Qg4oaSIHBvc3RUaXRsZSAoUHJpb3JpdHkgNCwgTUVESVVNIGNvbmZpZGVuY2UpXG4gKiBcbiAqIEBleGFtcGxlICBcbiAqIC8vIEVudGl0aWVzIHdpdGhvdXQgbmFtZSBmaWVsZHMgLSBSRVRVUk5TIHVuZGVmaW5lZCDinIVcbiAqIFN1YnNjcmlwdGlvbiDihpIgdW5kZWZpbmVkIChmYWxscyBiYWNrIHRvIHN1YnNjcmlwdGlvbklkIC0gY2xlYXIhKVxuICogUGF5bWVudE1ldGhvZCDihpIgdW5kZWZpbmVkIChmYWxscyBiYWNrIHRvIHBheW1lbnRNZXRob2RJZCAtIGNsZWFyISlcbiAqIEF1ZGl0TG9nIOKGkiB1bmRlZmluZWQgKGZhbGxzIGJhY2sgdG8gYXVkaXRMb2dJZCAtIGNsZWFyISlcbiAqIFxuICogQHBhcmFtIHNjaGVtYSAtIEVudGl0eSBzY2hlbWFcbiAqIEBwYXJhbSBlbnRpdHlOYW1lIC0gRW50aXR5IG5hbWUgKGUuZy4sICd0ZWFtJywgJ3VzZXInKVxuICogQHBhcmFtIG9wdGlvbnMgLSBEZXRlY3Rpb24gb3B0aW9uc1xuICogQHJldHVybnMgQmVzdCBsYWJlbCBmaWVsZCBuYW1lIG9yIHVuZGVmaW5lZCAod2lsbCBmYWxsIGJhY2sgdG8gSUQgZmllbGQpXG4gKi9cbmZ1bmN0aW9uIGZpbmRMYWJlbEZpZWxkKFxuICAgIHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBvcHRpb25zPzoge1xuICAgICAgICAvKiogTWluaW11bSBjb25maWRlbmNlIGxldmVsIHJlcXVpcmVkIChkZWZhdWx0OiAnbWVkaXVtJykgKi9cbiAgICAgICAgbWluQ29uZmlkZW5jZT86ICdoaWdoJyB8ICdtZWRpdW0nO1xuICAgICAgICAvKiogRW5hYmxlIGRlYnVnIGxvZ2dpbmcgKGRlZmF1bHQ6IGZhbHNlKSAqL1xuICAgICAgICBkZWJ1Zz86IGJvb2xlYW47XG4gICAgfVxuKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBtaW5Db25maWRlbmNlID0gb3B0aW9ucz8ubWluQ29uZmlkZW5jZSB8fCAnbWVkaXVtJztcbiAgICBjb25zdCBkZWJ1ZyA9IG9wdGlvbnM/LmRlYnVnIHx8IGZhbHNlO1xuXG4gICAgbGV0IHJlc3VsdDogTGFiZWxGaWVsZERldGVjdGlvblJlc3VsdCB8IHVuZGVmaW5lZDtcblxuICAgIC8vIEdldCBhbGwgYXR0cmlidXRlcyBmcm9tIHNjaGVtYVxuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSBzY2hlbWEuYXR0cmlidXRlcztcbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lcyA9IE9iamVjdC5rZXlzKGF0dHJpYnV0ZXMpO1xuXG4gICAgLy8gUHJpb3JpdHkgMTogRW50aXR5IG1ldGFkYXRhIC0gSElHSCBjb25maWRlbmNlXG4gICAgY29uc3QgZW50aXR5TmFtZUF0dHJpYnV0ZSA9IHNjaGVtYS5tb2RlbC5lbnRpdHlOYW1lQXR0cmlidXRlO1xuICAgIGlmIChlbnRpdHlOYW1lQXR0cmlidXRlICYmIGF0dHJpYnV0ZXNbIGVudGl0eU5hbWVBdHRyaWJ1dGUgXSkge1xuICAgICAgICByZXN1bHQgPSB7XG4gICAgICAgICAgICBmaWVsZDogZW50aXR5TmFtZUF0dHJpYnV0ZSxcbiAgICAgICAgICAgIGNvbmZpZGVuY2U6ICdoaWdoJyxcbiAgICAgICAgICAgIG1ldGhvZDogJ21ldGFkYXRhJ1xuICAgICAgICB9O1xuICAgICAgICBpZiAoZGVidWcpIHtcbiAgICAgICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW2ZpbmRMYWJlbEZpZWxkXSAke2VudGl0eU5hbWV9OiBGb3VuZCB2aWEgbWV0YWRhdGEgLSAke2VudGl0eU5hbWVBdHRyaWJ1dGV9IChISUdIIGNvbmZpZGVuY2UpYCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBQcmlvcml0eSAyOiBDb21tb24gZGlzcGxheSBwYXR0ZXJucyAtIEhJR0ggY29uZmlkZW5jZVxuICAgIGlmICghcmVzdWx0KSB7XG4gICAgICAgIGNvbnN0IGNvbW1vblBhdHRlcm5zID0gWyAnbmFtZScsICd0aXRsZScsICdsYWJlbCcsICdkaXNwbGF5TmFtZScsICdkaXNwbGF5bmFtZScgXTtcbiAgICAgICAgZm9yIChjb25zdCBwYXR0ZXJuIG9mIGNvbW1vblBhdHRlcm5zKSB7XG4gICAgICAgICAgICBjb25zdCBtYXRjaCA9IGF0dHJpYnV0ZU5hbWVzLmZpbmQoYXR0ciA9PiBhdHRyLnRvTG93ZXJDYXNlKCkgPT09IHBhdHRlcm4pO1xuICAgICAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0ID0ge1xuICAgICAgICAgICAgICAgICAgICBmaWVsZDogbWF0Y2gsXG4gICAgICAgICAgICAgICAgICAgIGNvbmZpZGVuY2U6ICdoaWdoJyxcbiAgICAgICAgICAgICAgICAgICAgbWV0aG9kOiAnY29tbW9uLXBhdHRlcm4nXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBpZiAoZGVidWcpIHtcbiAgICAgICAgICAgICAgICAgICAgRGVmYXVsdExvZ2dlci5pbmZvKGBbZmluZExhYmVsRmllbGRdICR7ZW50aXR5TmFtZX06IEZvdW5kIHZpYSBjb21tb24gcGF0dGVybiAnJHtwYXR0ZXJufScgLSAke21hdGNofSAoSElHSCBjb25maWRlbmNlKWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFByaW9yaXR5IDM6IEVudGl0eS1zcGVjaWZpYyBwYXR0ZXJucyAtIEhJR0ggY29uZmlkZW5jZVxuICAgIGlmICghcmVzdWx0KSB7XG4gICAgICAgIGNvbnN0IGVudGl0eUxvd2VyID0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICBjb25zdCBlbnRpdHlTcGVjaWZpY1N1ZmZpeGVzID0gWyAnTmFtZScsICdUaXRsZScsICdMYWJlbCcgXTtcblxuICAgICAgICBmb3IgKGNvbnN0IHN1ZmZpeCBvZiBlbnRpdHlTcGVjaWZpY1N1ZmZpeGVzKSB7XG4gICAgICAgICAgICAvLyBUcnkgZXhhY3QgbWF0Y2g6IGUuZy4sICd0ZWFtTmFtZScgZm9yIGVudGl0eSAndGVhbSdcbiAgICAgICAgICAgIGNvbnN0IGV4YWN0TWF0Y2ggPSBhdHRyaWJ1dGVOYW1lcy5maW5kKGF0dHIgPT5cbiAgICAgICAgICAgICAgICBhdHRyLnRvTG93ZXJDYXNlKCkgPT09IGAke2VudGl0eUxvd2VyfSR7c3VmZml4LnRvTG93ZXJDYXNlKCl9YFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGlmIChleGFjdE1hdGNoKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0ID0ge1xuICAgICAgICAgICAgICAgICAgICBmaWVsZDogZXhhY3RNYXRjaCxcbiAgICAgICAgICAgICAgICAgICAgY29uZmlkZW5jZTogJ2hpZ2gnLFxuICAgICAgICAgICAgICAgICAgICBtZXRob2Q6ICdlbnRpdHktcGF0dGVybidcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIGlmIChkZWJ1Zykge1xuICAgICAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtmaW5kTGFiZWxGaWVsZF0gJHtlbnRpdHlOYW1lfTogRm91bmQgdmlhIGVudGl0eS1zcGVjaWZpYyBwYXR0ZXJuIC0gJHtleGFjdE1hdGNofSAoSElHSCBjb25maWRlbmNlKWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFByaW9yaXR5IDQ6IEZpZWxkcyBlbmRpbmcgd2l0aCBuYW1lLWxpa2Ugc3VmZml4ZXMgLSBNRURJVU0gY29uZmlkZW5jZVxuICAgIC8vIExvb2sgZm9yIGFueSBmaWVsZCBlbmRpbmcgd2l0aCAnTmFtZScsICdUaXRsZScsICdMYWJlbCcgKGUuZy4sICdkaXNwbGF5TmFtZScsICdmdWxsTmFtZScsICd1c2VyTmFtZScsKVxuICAgIGlmICghcmVzdWx0KSB7XG4gICAgICAgIGNvbnN0IGRpc3BsYXlOYW1lU3VmZml4UGF0dGVybiA9IC9EaXNwbGF5TmFtZSQvO1xuICAgICAgICBjb25zdCBuYW1lU3VmZml4UGF0dGVybiA9IC9OYW1lJC87XG4gICAgICAgIGNvbnN0IHRpdGxlU3VmZml4UGF0dGVybiA9IC9UaXRsZSQvO1xuICAgICAgICBjb25zdCBsYWJlbFN1ZmZpeFBhdHRlcm4gPSAvTGFiZWwkLztcbiAgICAgICAgY29uc3QgY29kZVN1ZmZpeFBhdHRlcm4gPSAvQ29kZSQvO1xuXG4gICAgICAgIGZvciAoY29uc3QgcGF0dGVybiBvZiBbIGRpc3BsYXlOYW1lU3VmZml4UGF0dGVybiwgbGFiZWxTdWZmaXhQYXR0ZXJuLCB0aXRsZVN1ZmZpeFBhdHRlcm4sIG5hbWVTdWZmaXhQYXR0ZXJuLCBjb2RlU3VmZml4UGF0dGVybiBdKSB7XG4gICAgICAgICAgICBjb25zdCBtYXRjaCA9IGF0dHJpYnV0ZU5hbWVzLmZpbmQoYXR0ciA9PiBwYXR0ZXJuLnRlc3QoYXR0cikpO1xuICAgICAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0ID0ge1xuICAgICAgICAgICAgICAgICAgICBmaWVsZDogbWF0Y2gsXG4gICAgICAgICAgICAgICAgICAgIGNvbmZpZGVuY2U6ICdtZWRpdW0nLFxuICAgICAgICAgICAgICAgICAgICBtZXRob2Q6ICdzdWZmaXgtcGF0dGVybidcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIGlmIChkZWJ1Zykge1xuICAgICAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtmaW5kTGFiZWxGaWVsZF0gJHtlbnRpdHlOYW1lfTogRm91bmQgdmlhIHN1ZmZpeCBwYXR0ZXJuIC0gJHttYXRjaH0gKE1FRElVTSBjb25maWRlbmNlKWApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFByaW9yaXR5IDU6IE5PIEZBTExCQUNLIC0gSWYgd2UgY2FuJ3QgZmluZCBhIHByb3BlciBuYW1lIGZpZWxkLCByZXR1cm4gdW5kZWZpbmVkXG4gICAgLy8gQmV0dGVyIHRvIHNob3cgSUQgdGhhbiB0byBzaG93IGNvbmZ1c2luZyBmaWVsZHMgbGlrZSAnc3RhdHVzJywgJ3R5cGUnLCBldGMuXG4gICAgLy8gXG4gICAgLy8gRW50aXRpZXMgbGlrZSBTdWJzY3JpcHRpb24sIFBheW1lbnRNZXRob2QgZG9uJ3QgaGF2ZSB0cmFkaXRpb25hbCBuYW1lIGZpZWxkcy5cbiAgICAvLyBTaG93aW5nIFwiYWN0aXZlXCIgb3IgXCJjcmVkaXRfY2FyZFwiIGluIGEgZHJvcGRvd24gaXMgY29uZnVzaW5nIC0gdXNlcnMgY2FuJ3QgZGlzdGluZ3Vpc2ggaXRlbXMuXG4gICAgLy8gSXQncyBjbGVhcmVyIHRvIHNob3cgdGhlIElEIChzdWJzY3JpcHRpb25JZCwgcGF5bWVudE1ldGhvZElkKSBpbiBzdWNoIGNhc2VzLlxuICAgIC8vXG4gICAgLy8gSWYgeW91IG5lZWQgY3VzdG9tIGxhYmVscyBmb3IgdGhlc2UgZW50aXRpZXMsIGV4cGxpY2l0bHkgc2V0IGVudGl0eU5hbWVBdHRyaWJ1dGUgaW4gdGhlIHNjaGVtYVxuICAgIC8vIG9yIHVzZSBvcHRpb25NYXBwaW5nIGluIHRoZSByZWxhdGlvbiBjb25maWcuXG5cbiAgICAvLyBDaGVjayBjb25maWRlbmNlIHRocmVzaG9sZFxuICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgLy8gT25seSByZXR1cm4gaWYgY29uZmlkZW5jZSBtZWV0cyBtaW5pbXVtIHJlcXVpcmVtZW50XG4gICAgICAgIC8vIG1pbkNvbmZpZGVuY2U6ICdoaWdoJyDihpIgb25seSByZXR1cm4gSElHSCBjb25maWRlbmNlIHJlc3VsdHNcbiAgICAgICAgLy8gbWluQ29uZmlkZW5jZTogJ21lZGl1bScg4oaSIHJldHVybiBISUdIIG9yIE1FRElVTSBjb25maWRlbmNlIHJlc3VsdHMgKGRlZmF1bHQpXG4gICAgICAgIGlmIChtaW5Db25maWRlbmNlID09PSAnaGlnaCcgJiYgcmVzdWx0LmNvbmZpZGVuY2UgPT09ICdtZWRpdW0nKSB7XG4gICAgICAgICAgICBpZiAoZGVidWcpIHtcbiAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYFtmaW5kTGFiZWxGaWVsZF0gJHtlbnRpdHlOYW1lfTogRmllbGQgJyR7cmVzdWx0LmZpZWxkfScgZm91bmQgd2l0aCBNRURJVU0gY29uZmlkZW5jZSwgYnV0IEhJR0ggY29uZmlkZW5jZSByZXF1aXJlZC4gUmV0dXJuaW5nIHVuZGVmaW5lZC5gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzdWx0LmZpZWxkO1xuICAgIH1cblxuICAgIC8vIE5vIHN1aXRhYmxlIGZpZWxkIGZvdW5kXG4gICAgaWYgKGRlYnVnKSB7XG4gICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgW2ZpbmRMYWJlbEZpZWxkXSAke2VudGl0eU5hbWV9OiBObyBzdWl0YWJsZSBsYWJlbCBmaWVsZCBmb3VuZCB3aXRoIHN1ZmZpY2llbnQgY29uZmlkZW5jZS5gKTtcbiAgICB9XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBSRUxBVElPTiBPUFRJT04gQ09ORklHIFJFU09MVVRJT05cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIFJlc29sdmVzIFJlbGF0aW9uRW50aXR5T3B0aW9uQ29uZmlnIGludG8gRmllbGRPcHRpb25zQVBJQ29uZmlnIGJ5IGF1dG8tZGV0ZWN0aW5nOlxuICogLSBDUlVEIEFQSSBwYXRoIGZyb20gZW50aXR5IHNjaGVtYVxuICogLSBMYWJlbCBmaWVsZCBmcm9tIGVudGl0eU5hbWVBdHRyaWJ1dGUgbWV0YWRhdGEgb3Igc21hcnQgZGV0ZWN0aW9uXG4gKiAtIFZhbHVlIGZpZWxkIGZyb20gcmVsYXRpb24gaWRlbnRpZmllcnNcbiAqIFxuICogQHBhcmFtIHJlbGF0aW9uQ29uZmlnIC0gTWluaW1hbCByZWxhdGlvbiBvcHRpb24gY29uZmlnXG4gKiBAcGFyYW0gcmVsYXRpb25BdHRyaWJ1dGUgLSBUaGUgcmVsYXRpb24gYXR0cmlidXRlICh0byBnZXQgaWRlbnRpZmllcnMpXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIGZvciBzY2hlbWEgbG9va3VwXG4gKiBAcGFyYW0gZ2xvYmFsVUlDb25maWdPcHRpb25zIC0gR2xvYmFsIFVJIGNvbmZpZyBvcHRpb25zIChmb3IgbGFiZWwgZmllbGQgZGV0ZWN0aW9uKVxuICogQHJldHVybnMgRnVsbHkgcmVzb2x2ZWQgRmllbGRPcHRpb25zQVBJQ29uZmlnIG9yIHVuZGVmaW5lZCBpZiBlbnRpdHkgbm90IGZvdW5kXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUmVsYXRpb25PcHRpb25Db25maWcoXG4gICAgcmVsYXRpb25Db25maWc6IFJlbGF0aW9uRW50aXR5T3B0aW9uQ29uZmlnLFxuICAgIHJlbGF0aW9uQXR0cmlidXRlOiBUSU9TY2hlbWFBdHRyaWJ1dGUgJiB7IHJlbGF0aW9uOiBOb25OdWxsYWJsZTxUSU9TY2hlbWFBdHRyaWJ1dGVbICdyZWxhdGlvbicgXT4gfSxcbiAgICBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+LFxuICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sgJ3VpQ29uZmlnR2VuT3B0aW9ucycgXVxuKTogRmllbGRPcHRpb25zQVBJQ29uZmlnPGFueT4gfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IHsgZW50aXR5TmFtZSwgY3VzdG9tQXBpVXJsLCBvcHRpb25NYXBwaW5nLCAuLi5yZXN0IH0gPSByZWxhdGlvbkNvbmZpZztcbiAgICBjb25zdCByZWxhdGlvbiA9IHJlbGF0aW9uQXR0cmlidXRlLnJlbGF0aW9uO1xuXG4gICAgLy8gR2V0IHJlbGF0ZWQgZW50aXR5IHNlcnZpY2VcbiAgICBpZiAoIWVudGl0eVNlcnZpY2UuaGFzRW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShlbnRpdHlOYW1lKSkge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYFtyZXNvbHZlUmVsYXRpb25PcHRpb25Db25maWddIEVudGl0eSBzZXJ2aWNlIG5vdCBmb3VuZCBmb3I6ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCByZWxhdGVkU2VydmljZSA9IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShlbnRpdHlOYW1lKTtcbiAgICBjb25zdCByZWxhdGVkU2NoZW1hID0gcmVsYXRlZFNlcnZpY2U/LmdldEVudGl0eVNjaGVtYT8uKCk7XG5cbiAgICBpZiAoIXJlbGF0ZWRTY2hlbWEpIHtcbiAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBbcmVzb2x2ZVJlbGF0aW9uT3B0aW9uQ29uZmlnXSBTY2hlbWEgbm90IGZvdW5kIGZvciBlbnRpdHk6ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyAxLiBSZXNvbHZlIEFQSSBVUkxcbiAgICBjb25zdCBlbnRpdHlOYW1lTG93ZXIgPSBlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgY3J1ZFBhdGggPSByZWxhdGVkU2NoZW1hLm1vZGVsLkNSVURBcGlQYXRoIHx8ICcnO1xuICAgIGNvbnN0IGFwaVVybCA9IGN1c3RvbUFwaVVybCB8fCBgJHtjcnVkUGF0aH0vJHtlbnRpdHlOYW1lTG93ZXJ9YDtcblxuICAgIC8vIDIuIFJlc29sdmUgdmFsdWUgZmllbGQgZnJvbSByZWxhdGlvbiBpZGVudGlmaWVyc1xuICAgIGNvbnN0IHJlc29sdmVkSWRlbnRpZmllcnMgPSB0eXBlb2YgcmVsYXRpb24uaWRlbnRpZmllcnMgPT09ICdmdW5jdGlvbicgPyByZWxhdGlvbi5pZGVudGlmaWVycygpIDogcmVsYXRpb24uaWRlbnRpZmllcnM7XG4gICAgY29uc3QgaWRlbnRpZmllck1hcHBpbmdzID0gQXJyYXkuaXNBcnJheShyZXNvbHZlZElkZW50aWZpZXJzKSA/IHJlc29sdmVkSWRlbnRpZmllcnMgOiBbIHJlc29sdmVkSWRlbnRpZmllcnMgXTtcbiAgICBjb25zdCBwcmltYXJ5SWRlbnRpZmllciA9IGlkZW50aWZpZXJNYXBwaW5nc1sgMCBdO1xuICAgIGNvbnN0IHZhbHVlRmllbGQgPSBTdHJpbmcocHJpbWFyeUlkZW50aWZpZXIudGFyZ2V0KTtcblxuICAgIC8vIDMuIFJlc29sdmUgbGFiZWwgZmllbGQgZnJvbSBlbnRpdHkgbWV0YWRhdGEgb3IgY3VzdG9tIG1hcHBpbmdcbiAgICBsZXQgbGFiZWxGaWVsZCA9IHZhbHVlRmllbGQ7IC8vIERlZmF1bHQgZmFsbGJhY2sgdG8gdmFsdWUgZmllbGRcblxuICAgIGlmIChvcHRpb25NYXBwaW5nPy5sYWJlbCkge1xuICAgICAgICAvLyBDdXN0b20gbGFiZWwgcHJvdmlkZWQgLSB1c2UgaXRcbiAgICAgICAgbGFiZWxGaWVsZCA9IG9wdGlvbk1hcHBpbmcubGFiZWwgYXMgc3RyaW5nO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEF1dG8tZGV0ZWN0IHVzaW5nIHNtYXJ0IHBhdHRlcm4gbWF0Y2hpbmcgd2l0aCBnbG9iYWwgY29uZmlnXG4gICAgICAgIGNvbnN0IGxhYmVsRmllbGRDb25maWcgPSBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/LmxhYmVsRmllbGREZXRlY3Rpb247XG4gICAgICAgIGxhYmVsRmllbGQgPSBmaW5kTGFiZWxGaWVsZChyZWxhdGVkU2NoZW1hLCBlbnRpdHlOYW1lLCB7XG4gICAgICAgICAgICBtaW5Db25maWRlbmNlOiBsYWJlbEZpZWxkQ29uZmlnPy5taW5Db25maWRlbmNlIHx8ICdtZWRpdW0nLFxuICAgICAgICAgICAgZGVidWc6IGxhYmVsRmllbGRDb25maWc/LmRlYnVnIHx8IGZhbHNlXG4gICAgICAgIH0pIHx8IHZhbHVlRmllbGQ7XG4gICAgfVxuXG4gICAgLy8gNC4gQnVpbGQgY29tcGxldGUgRmllbGRPcHRpb25zQVBJQ29uZmlnXG4gICAgcmV0dXJuIHtcbiAgICAgICAgYXBpTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgYXBpVXJsLFxuICAgICAgICByZXNwb25zZUtleTogJ2l0ZW1zJyxcbiAgICAgICAgb3B0aW9uTWFwcGluZzogb3B0aW9uTWFwcGluZyB8fCB7XG4gICAgICAgICAgICBsYWJlbDogbGFiZWxGaWVsZCxcbiAgICAgICAgICAgIHZhbHVlOiAob3B0aW9uTWFwcGluZyBhcyBhbnkpPy52YWx1ZSB8fCB2YWx1ZUZpZWxkXG4gICAgICAgIH0sXG4gICAgICAgIC4uLnJlc3QgLy8gUGFzcyB0aHJvdWdoIGZpbHRlcnMsIGNvdW50LCBkaXNhYmxlU2VhcmNoLCBldGMuXG4gICAgfTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBGSUxURVIgQVVUTy1HRU5FUkFUSU9OXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBBdXRvLWdlbmVyYXRlcyBmaWx0ZXJDb25maWcgZm9yIGVudGl0eSBhdHRyaWJ1dGVzIGJhc2VkIG9uIGZpZWxkIHR5cGUuXG4gKiBcbiAqIEFsZ29yaXRobTpcbiAqIDEuIENoZWNrIGlmIGV4cGxpY2l0IGZpbHRlckNvbmZpZyBhbHJlYWR5IGV4aXN0cyDihpIgdXNlIGl0XG4gKiAyLiBDaGVjayBpZiBmaWVsZCBpcyBleHBsaWNpdGx5IG5vbi1maWx0ZXJhYmxlIOKGkiBza2lwXG4gKiAzLiBEZXRlY3QgZmllbGQgdHlwZSBhbmQgZ2VuZXJhdGUgYXBwcm9wcmlhdGUgY29uZmlnXG4gKiA0LiBNZXJnZSB3aXRoIGdsb2JhbCBhbmQgZW50aXR5LWxldmVsIG92ZXJyaWRlc1xuICogXG4gKiBAcGFyYW0gYXR0cmlidXRlIC0gVGhlIGF0dHJpYnV0ZSB0byBnZW5lcmF0ZSBmaWx0ZXIgY29uZmlnIGZvclxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSBmb3IgYWNjZXNzaW5nIGVudGl0eSBtZXRhZGF0YVxuICogQHBhcmFtIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyAtIEdsb2JhbCBVSSBjb25maWd1cmF0aW9uIG9wdGlvbnNcbiAqIEByZXR1cm5zIEdlbmVyYXRlZCBmaWx0ZXIgY29uZmlndXJhdGlvbiBvciB1bmRlZmluZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdlbmVyYXRlRmlsdGVyQ29uZmlnKFxuICAgIGF0dHJpYnV0ZTogVElPU2NoZW1hQXR0cmlidXRlLFxuICAgIGVudGl0eVNlcnZpY2U/OiBCYXNlRW50aXR5U2VydmljZTxhbnk+LFxuICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sgJ3VpQ29uZmlnR2VuT3B0aW9ucycgXVxuKTogRmllbGRNZXRhZGF0YVsgJ2ZpbHRlckNvbmZpZycgXSB8IHVuZGVmaW5lZCB7XG4gICAgLy8gMS4gSWYgZXhwbGljaXQgZmlsdGVyQ29uZmlnIGV4aXN0cywgdXNlIGl0IChoaWdoZXN0IHByaW9yaXR5KVxuICAgIGlmIChhdHRyaWJ1dGUuZmlsdGVyQ29uZmlnKSB7XG4gICAgICAgIHJldHVybiBhdHRyaWJ1dGUuZmlsdGVyQ29uZmlnO1xuICAgIH1cblxuICAgIC8vIDIuIElmIGZpZWxkIGhhcyBleHBsaWNpdCBvcHRpb25zIGNvbmZpZywgdXNlIGl0XG4gICAgaWYgKCdvcHRpb25zJyBpbiBhdHRyaWJ1dGUpIHtcbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IChhdHRyaWJ1dGUgYXMgU2VsZWN0RmllbGRNZXRhZGF0YSkub3B0aW9ucztcblxuICAgICAgICAvLyBSZWxhdGlvbkVudGl0eU9wdGlvbkNvbmZpZyAoaGFzIGVudGl0eU5hbWUpIOKGkiByZXNvbHZlIHRvIEZpZWxkT3B0aW9uc0FQSUNvbmZpZ1xuICAgICAgICBjb25zdCBpc1JlbGF0aW9uQ29uZmlnID0gdHlwZW9mIG9wdGlvbnMgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KG9wdGlvbnMpICYmICdlbnRpdHlOYW1lJyBpbiBvcHRpb25zO1xuXG4gICAgICAgIGxldCByZXNvbHZlZENvbmZpZzogRmllbGRPcHRpb25zQVBJQ29uZmlnPGFueT4gfCBGaWVsZE9wdGlvbltdIHwgdW5kZWZpbmVkO1xuXG4gICAgICAgIC8vIElubGluZSBhcnJheSDihpIgdXNlIGFzIGlzXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KG9wdGlvbnMpICYmIG9wdGlvbnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgcmVzb2x2ZWRDb25maWcgPSBvcHRpb25zIGFzIEZpZWxkT3B0aW9uW107XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGaWVsZE9wdGlvbnNBUElDb25maWcgKGhhcyBhcGlNZXRob2QsIGFwaVVybCwgcmVzcG9uc2VLZXkpIOKGkiBwYXNzIHRocm91Z2hcbiAgICAgICAgY29uc3QgaXNBcGlDb25maWcgPSB0eXBlb2Ygb3B0aW9ucyA9PT0gJ29iamVjdCcgJiYgIUFycmF5LmlzQXJyYXkob3B0aW9ucykgJiYgJ2FwaU1ldGhvZCcgaW4gb3B0aW9ucztcbiAgICAgICAgaWYgKGlzQXBpQ29uZmlnKSB7XG4gICAgICAgICAgICByZXNvbHZlZENvbmZpZyA9IG9wdGlvbnMgYXMgRmllbGRPcHRpb25zQVBJQ29uZmlnPGFueT47XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoaXNSZWxhdGlvbkNvbmZpZyAmJiBhdHRyaWJ1dGUucmVsYXRpb24gJiYgZW50aXR5U2VydmljZSkge1xuICAgICAgICAgICAgcmVzb2x2ZWRDb25maWcgPSByZXNvbHZlUmVsYXRpb25PcHRpb25Db25maWcoXG4gICAgICAgICAgICAgICAgb3B0aW9ucyBhcyBSZWxhdGlvbkVudGl0eU9wdGlvbkNvbmZpZyxcbiAgICAgICAgICAgICAgICBhdHRyaWJ1dGUgYXMgVElPU2NoZW1hQXR0cmlidXRlICYgeyByZWxhdGlvbjogTm9uTnVsbGFibGU8VElPU2NoZW1hQXR0cmlidXRlWyAncmVsYXRpb24nIF0+IH0sXG4gICAgICAgICAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgICAgICAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnNcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocmVzb2x2ZWRDb25maWcpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgZmlsdGVyVHlwZTogJ3NlbGVjdCcsXG4gICAgICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiAnZXEnIGFzIGNvbnN0LFxuICAgICAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogWyAnZXEnLCAnbmVxJywgJ2luTGlzdCcsICdub3RJbkxpc3QnLCAnZXhpc3RzJywgJ25vdEV4aXN0cycgXSxcbiAgICAgICAgICAgICAgICBwcmVkZWZpbmVkT3B0aW9uczogcmVzb2x2ZWRDb25maWdcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBlbHNlIGxvZyBlcnJvclxuICAgICAgICB0aHJvdyBuZXcgRnJhbWV3b3JrRXJyb3IoYFtnZW5lcmF0ZUZpbHRlckNvbmZpZ10gTm8gcmVzb2x2ZWQgY29uZmlnIGZvdW5kIGZvciBhdHRyaWJ1dGU6ICR7YXR0cmlidXRlLmlkfWAsIHtcbiAgICAgICAgICAgIGF0dHJpYnV0ZTogYXR0cmlidXRlLFxuICAgICAgICAgICAgb3B0aW9uczogb3B0aW9ucyxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gMy4gSWYgZmllbGQgaXMgZXhwbGljaXRseSBub24tZmlsdGVyYWJsZSwgc2tpcFxuICAgIGlmIChhdHRyaWJ1dGUuaXNGaWx0ZXJhYmxlID09PSBmYWxzZSkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8vIDMuIEdldCBnbG9iYWwgYW5kIGVudGl0eS1sZXZlbCBjb25maWdcbiAgICBjb25zdCBnbG9iYWxGaWx0ZXJDb25maWcgPSBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/LnRhYmxlVUk/LmZpbHRlckF1dG9HZW5lcmF0aW9uO1xuICAgIGNvbnN0IGVudGl0eU1ldGFkYXRhID0gZW50aXR5U2VydmljZT8uZ2V0RW50aXR5U2NoZW1hPy4oKS5tb2RlbD8ubWV0YWRhdGEgYXMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+WyAnbW9kZWwnIF1bICdtZXRhZGF0YScgXTtcbiAgICBjb25zdCBlbnRpdHlGaWx0ZXJDb25maWcgPSBlbnRpdHlNZXRhZGF0YT8udGFibGVVST8uZmlsdGVyQXV0b0dlbmVyYXRpb247XG5cbiAgICAvLyBNZXJnZSBjb25maWdzIChlbnRpdHkgPiBnbG9iYWwgPiBkZWZhdWx0cylcbiAgICBjb25zdCBtZXJnZWRDb25maWcgPSB7XG4gICAgICAgIGVuYWJsZWQ6IGVudGl0eUZpbHRlckNvbmZpZz8uZW5hYmxlZCA/PyBnbG9iYWxGaWx0ZXJDb25maWc/LmVuYWJsZWQgPz8gdHJ1ZSxcbiAgICAgICAgZGF0ZUZpZWxkczoge1xuICAgICAgICAgICAgLi4uZ2xvYmFsRmlsdGVyQ29uZmlnPy5kYXRlRmllbGRzLFxuICAgICAgICAgICAgLi4uZW50aXR5RmlsdGVyQ29uZmlnPy5kYXRlRmllbGRzXG4gICAgICAgIH0sXG4gICAgICAgIGVudW1GaWVsZHM6IHtcbiAgICAgICAgICAgIC4uLmdsb2JhbEZpbHRlckNvbmZpZz8uZW51bUZpZWxkcyxcbiAgICAgICAgICAgIC4uLmVudGl0eUZpbHRlckNvbmZpZz8uZW51bUZpZWxkc1xuICAgICAgICB9LFxuICAgICAgICBib29sZWFuRmllbGRzOiB7XG4gICAgICAgICAgICAuLi5nbG9iYWxGaWx0ZXJDb25maWc/LmJvb2xlYW5GaWVsZHMsXG4gICAgICAgICAgICAuLi5lbnRpdHlGaWx0ZXJDb25maWc/LmJvb2xlYW5GaWVsZHNcbiAgICAgICAgfSxcbiAgICAgICAgcmVsYXRpb25GaWVsZHM6IHtcbiAgICAgICAgICAgIC4uLmdsb2JhbEZpbHRlckNvbmZpZz8ucmVsYXRpb25GaWVsZHMsXG4gICAgICAgICAgICAuLi5lbnRpdHlGaWx0ZXJDb25maWc/LnJlbGF0aW9uRmllbGRzXG4gICAgICAgIH0sXG4gICAgICAgIG51bWJlckZpZWxkczoge1xuICAgICAgICAgICAgLi4uZ2xvYmFsRmlsdGVyQ29uZmlnPy5udW1iZXJGaWVsZHMsXG4gICAgICAgICAgICAuLi5lbnRpdHlGaWx0ZXJDb25maWc/Lm51bWJlckZpZWxkc1xuICAgICAgICB9LFxuICAgICAgICB0ZXh0RmllbGRzOiB7XG4gICAgICAgICAgICAuLi5nbG9iYWxGaWx0ZXJDb25maWc/LnRleHRGaWVsZHMsXG4gICAgICAgICAgICAuLi5lbnRpdHlGaWx0ZXJDb25maWc/LnRleHRGaWVsZHNcbiAgICAgICAgfSxcbiAgICAgICAgZGVidWc6IGVudGl0eUZpbHRlckNvbmZpZz8uZGVidWcgPz8gZ2xvYmFsRmlsdGVyQ29uZmlnPy5kZWJ1ZyA/PyBmYWxzZVxuICAgIH07XG5cbiAgICAvLyBJZiBnbG9iYWxseSBkaXNhYmxlZCwgc2tpcFxuICAgIGlmICghbWVyZ2VkQ29uZmlnLmVuYWJsZWQpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBjb25zdCBhdHRyVHlwZSA9IGF0dHJpYnV0ZS50eXBlO1xuICAgIGNvbnN0IGZpZWxkVHlwZSA9IGF0dHJpYnV0ZS5maWVsZFR5cGU7XG5cbiAgICAvLyAqKjEuIEJvb2xlYW4gZmllbGRzKipcbiAgICBpZiAoYXR0clR5cGUgPT09ICdib29sZWFuJyAmJiBtZXJnZWRDb25maWcuYm9vbGVhbkZpZWxkcz8uZW5hYmxlZCAhPT0gZmFsc2UpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGZpbHRlclR5cGU6ICdib29sZWFuJyxcbiAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogJ2VxJyxcbiAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogWyAnZXEnLCAnbmVxJywgJ2V4aXN0cycsICdub3RFeGlzdHMnIF0sXG4gICAgICAgICAgICBwcmVkZWZpbmVkT3B0aW9uczogW1xuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdZZXMnLCB2YWx1ZTogXCJ0cnVlXCIgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnTm8nLCB2YWx1ZTogXCJmYWxzZVwiIH1cbiAgICAgICAgICAgIF1cbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyAqKjIuIEVudW0gZmllbGRzIChhcnJheSBvZiBzdHJpbmdzL251bWJlcnMpKipcbiAgICBpZiAoQXJyYXkuaXNBcnJheShhdHRyVHlwZSkgJiYgbWVyZ2VkQ29uZmlnLmVudW1GaWVsZHM/LmVuYWJsZWQgIT09IGZhbHNlKSB7XG4gICAgICAgIGNvbnN0IGRlZmF1bHRFbnVtT3BzID0gWyAnZXEnLCAnbmVxJywgJ2luTGlzdCcsICdub3RJbkxpc3QnLCAnZXhpc3RzJywgJ25vdEV4aXN0cycgXSBhcyBjb25zdDtcbiAgICAgICAgY29uc3QgZGVmYXVsdE9wID0gbWVyZ2VkQ29uZmlnLmVudW1GaWVsZHM/LmRlZmF1bHRPcGVyYXRvciB8fCAoJ2VxJyk7XG4gICAgICAgIGNvbnN0IGF2YWlsYWJsZU9wcyA9IG1lcmdlZENvbmZpZy5lbnVtRmllbGRzPy5hdmFpbGFibGVPcGVyYXRvcnMgfHwgZGVmYXVsdEVudW1PcHM7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGZpbHRlclR5cGU6ICdzZWxlY3QnLFxuICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBkZWZhdWx0T3AsXG4gICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IGF2YWlsYWJsZU9wcyxcbiAgICAgICAgICAgIHByZWRlZmluZWRPcHRpb25zOiBhdHRyVHlwZS5tYXAodmFsID0+ICh7XG4gICAgICAgICAgICAgICAgbGFiZWw6IFN0cmluZyh2YWwpLFxuICAgICAgICAgICAgICAgIHZhbHVlOiBTdHJpbmcodmFsKSAgLy8gQWx3YXlzIGNvbnZlcnQgdG8gc3RyaW5nIGZvciBjb25zaXN0ZW5jeVxuICAgICAgICAgICAgfSkpXG4gICAgICAgIH07XG4gICAgfVxuXG5cbiAgICAvLyAqKjMuIERhdGUvRGF0ZXRpbWUgZmllbGRzKipcbiAgICBpZiAoKGZpZWxkVHlwZSA9PT0gJ2RhdGUnIHx8IGZpZWxkVHlwZSA9PT0gJ2RhdGV0aW1lJyB8fCAoYXR0clR5cGUgPT09ICdzdHJpbmcnICYmIChhdHRyaWJ1dGUuaWQudG9Mb3dlckNhc2UoKS5pbmNsdWRlcygnZGF0ZScpIHx8IGF0dHJpYnV0ZS5pZC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKCd0aW1lJykpKSlcbiAgICAgICAgJiYgbWVyZ2VkQ29uZmlnLmRhdGVGaWVsZHM/LmVuYWJsZWQgIT09IGZhbHNlKSB7XG4gICAgICAgIGNvbnN0IGRlZmF1bHREYXRlT3BzID0gWyAnZXEnLCAnbmVxJywgJ2d0JywgJ2d0ZScsICdsdCcsICdsdGUnLCAnYmV0d2VlbicsICdleGlzdHMnLCAnbm90RXhpc3RzJyBdIGFzIGNvbnN0O1xuICAgICAgICBjb25zdCBvcGVyYXRvcnMgPSBtZXJnZWRDb25maWcuZGF0ZUZpZWxkcz8uZGVmYXVsdE9wZXJhdG9ycyB8fCBkZWZhdWx0RGF0ZU9wcztcblxuICAgICAgICBjb25zdCBmaWx0ZXJDb25maWc6IGFueSA9IHtcbiAgICAgICAgICAgIGZpbHRlclR5cGU6ICdkYXRldGltZScsXG4gICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IG9wZXJhdG9yc1sgMCBdIHx8ICgnZ3RlJyksXG4gICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IG9wZXJhdG9yc1xuICAgICAgICB9O1xuXG4gICAgICAgIC8vIEFkZCBxdWljayBkYXRlIGZpbHRlcnMgaWYgZW5hYmxlZFxuICAgICAgICBpZiAobWVyZ2VkQ29uZmlnLmRhdGVGaWVsZHM/LnF1aWNrRmlsdGVycyAhPT0gZmFsc2UpIHtcbiAgICAgICAgICAgIGZpbHRlckNvbmZpZy5wcmVkZWZpbmVkT3B0aW9ucyA9IFtcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnVG9kYXknLCB2YWx1ZTogJzpzdGFydE9mVG9kYXknIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ1llc3RlcmRheScsIHZhbHVlOiAnOnN0YXJ0T2ZZZXN0ZXJkYXknIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ1RoaXMgV2VlaycsIHZhbHVlOiAnOnN0YXJ0T2ZXZWVrJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdMYXN0IFdlZWsnLCB2YWx1ZTogJzpzdGFydE9mTGFzdFdlZWsnIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ1RoaXMgTW9udGgnLCB2YWx1ZTogJzpzdGFydE9mTW9udGgnIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ0xhc3QgTW9udGgnLCB2YWx1ZTogJzpzdGFydE9mTGFzdE1vbnRoJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdUaGlzIFF1YXJ0ZXInLCB2YWx1ZTogJzpzdGFydE9mUXVhcnRlcicgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnTGFzdCBRdWFydGVyJywgdmFsdWU6ICc6c3RhcnRPZkxhc3RRdWFydGVyJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdUaGlzIFllYXInLCB2YWx1ZTogJzpzdGFydE9mWWVhcicgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnTGFzdCBZZWFyJywgdmFsdWU6ICc6c3RhcnRPZkxhc3RZZWFyJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdMYXN0IDcgRGF5cycsIHZhbHVlOiAnOm5vd01pbnVzN0RheXMnIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ0xhc3QgMzAgRGF5cycsIHZhbHVlOiAnOm5vd01pbnVzMzBEYXlzJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdMYXN0IDkwIERheXMnLCB2YWx1ZTogJzpub3dNaW51czkwRGF5cycgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnQ3VzdG9tIERhdGUnLCB2YWx1ZTogbnVsbCB9ICAvLyBUcmlnZ2VycyBkYXRldGltZS1sb2NhbCBpbnB1dFxuICAgICAgICAgICAgXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBmaWx0ZXJDb25maWc7XG4gICAgfVxuXG4gICAgLy8gKio1LiBOdW1iZXIgZmllbGRzKipcbiAgICBpZiAoYXR0clR5cGUgPT09ICdudW1iZXInICYmIG1lcmdlZENvbmZpZy5udW1iZXJGaWVsZHM/LmVuYWJsZWQgIT09IGZhbHNlKSB7XG4gICAgICAgIGNvbnN0IGRlZmF1bHROdW1iZXJPcHMgPSBbICdlcScsICduZXEnLCAnZ3QnLCAnZ3RlJywgJ2x0JywgJ2x0ZScsICdiZXR3ZWVuJywgJ2V4aXN0cycsICdub3RFeGlzdHMnIF0gYXMgY29uc3Q7XG4gICAgICAgIGNvbnN0IG9wZXJhdG9ycyA9IG1lcmdlZENvbmZpZy5udW1iZXJGaWVsZHM/LmRlZmF1bHRPcGVyYXRvcnMgfHwgZGVmYXVsdE51bWJlck9wcztcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGZpbHRlclR5cGU6ICdudW1iZXInLFxuICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBvcGVyYXRvcnNbIDAgXSB8fCAoJ2VxJyksXG4gICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IG9wZXJhdG9yc1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vICoqNC4gUmVsYXRpb24gZmllbGRzICh3aXRob3V0IGV4cGxpY2l0IG9wdGlvbnMpIC0gYXV0by1nZW5lcmF0ZSBmcm9tIHJlbGF0aW9uIG1ldGFkYXRhKipcbiAgICBpZiAoYXR0cmlidXRlLnJlbGF0aW9uICYmIG1lcmdlZENvbmZpZy5yZWxhdGlvbkZpZWxkcz8uZW5hYmxlZCAhPT0gZmFsc2UgJiYgZW50aXR5U2VydmljZSkge1xuICAgICAgICBjb25zdCByZWxhdGlvbkNvbmZpZzogUmVsYXRpb25FbnRpdHlPcHRpb25Db25maWcgPSB7IGVudGl0eU5hbWU6IGF0dHJpYnV0ZS5yZWxhdGlvbi5lbnRpdHlOYW1lIH07XG4gICAgICAgIGNvbnN0IHJlc29sdmVkID0gcmVzb2x2ZVJlbGF0aW9uT3B0aW9uQ29uZmlnKFxuICAgICAgICAgICAgcmVsYXRpb25Db25maWcsXG4gICAgICAgICAgICBhdHRyaWJ1dGUgYXMgVElPU2NoZW1hQXR0cmlidXRlICYgeyByZWxhdGlvbjogTm9uTnVsbGFibGU8VElPU2NoZW1hQXR0cmlidXRlWyAncmVsYXRpb24nIF0+IH0sXG4gICAgICAgICAgICBlbnRpdHlTZXJ2aWNlLFxuICAgICAgICAgICAgZ2xvYmFsVUlDb25maWdPcHRpb25zXG4gICAgICAgICk7XG5cbiAgICAgICAgaWYgKHJlc29sdmVkKSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIGZpbHRlclR5cGU6ICdyZWxhdGlvbicsXG4gICAgICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiAnZXEnIGFzIGNvbnN0LFxuICAgICAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogWyAnZXEnLCAnbmVxJywgJ2luTGlzdCcsICdub3RJbkxpc3QnLCAnZXhpc3RzJywgJ25vdEV4aXN0cycgXSxcbiAgICAgICAgICAgICAgICBwcmVkZWZpbmVkT3B0aW9uczogcmVzb2x2ZWRcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyAqKjYuIFRleHQgZmllbGRzIChkZWZhdWx0IGZhbGxiYWNrKSoqXG4gICAgaWYgKGF0dHJUeXBlID09PSAnc3RyaW5nJyAmJiBtZXJnZWRDb25maWcudGV4dEZpZWxkcz8uZW5hYmxlZCAhPT0gZmFsc2UpIHtcbiAgICAgICAgY29uc3QgZGVmYXVsdFRleHRPcHMgPSBbICdjb250YWlucycsICdub3RDb250YWlucycsICdlcScsICduZXEnLCAnc3RhcnRzV2l0aCcsICdlbmRzV2l0aCcsICdsaWtlJywgJ2V4aXN0cycsICdub3RFeGlzdHMnIF07XG4gICAgICAgIGNvbnN0IG9wZXJhdG9ycyA9IG1lcmdlZENvbmZpZy50ZXh0RmllbGRzPy5kZWZhdWx0T3BlcmF0b3JzIHx8IGRlZmF1bHRUZXh0T3BzO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZmlsdGVyVHlwZTogJ3RleHQnLFxuICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBvcGVyYXRvcnNbIDAgXSB8fCAoJ2NvbnRhaW5zJyksXG4gICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IG9wZXJhdG9yc1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vIERlYnVnIGxvZ2dpbmdcbiAgICBpZiAobWVyZ2VkQ29uZmlnLmRlYnVnKSB7XG4gICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW0ZpbHRlckF1dG9HZW5dICR7YXR0cmlidXRlLmlkfTogTm8gZmlsdGVyIGNvbmZpZyBnZW5lcmF0ZWQgKHR5cGU6ICR7YXR0clR5cGV9KWApO1xuICAgIH1cblxuICAgIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU0VHTUVOVCBBVVRPLUdFTkVSQVRJT05cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiAqIFNtYXJ0IGljb24gbWFwcGluZyBmb3Igc2VnbWVudCB2YWx1ZXMuXG4gKiBQcm92aWRlcyBzZW5zaWJsZSBkZWZhdWx0cyBmb3IgY29tbW9uIHN0YXR1cy9zdGF0ZSBwYXR0ZXJucy5cbiAqIEljb25zIG1hdGNoIHVpMjQvc3JjL2NvcmUvY29tbW9uL0ljb25zL0ljb25zLnRzeCBuYW1pbmcgY29udmVudGlvbnMuXG4gKi9cbmNvbnN0IERFRkFVTFRfSUNPTl9NQVBQSU5HOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgIC8vIEFjdGl2ZS9JbmFjdGl2ZSBwYXR0ZXJuc1xuICAgICdhY3RpdmUnOiAnQ2hlY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2luYWN0aXZlJzogJ0Nsb3NlQ2lyY2xlT3V0bGluZWQnLFxuICAgICdlbmFibGVkJzogJ0NoZWNrQ2lyY2xlT3V0bGluZWQnLFxuICAgICdkaXNhYmxlZCc6ICdDbG9zZUNpcmNsZU91dGxpbmVkJyxcblxuICAgIC8vIFN0YXR1cyBwYXR0ZXJuc1xuICAgICdwZW5kaW5nJzogJ0Nsb2NrQ2lyY2xlT3V0bGluZWQnLFxuICAgICdpbi1wcm9ncmVzcyc6ICdTeW5jT3V0bGluZWQnLFxuICAgICdpbnByb2dyZXNzJzogJ1N5bmNPdXRsaW5lZCcsXG4gICAgJ2NvbXBsZXRlZCc6ICdDaGVja0NpcmNsZU91dGxpbmVkJyxcbiAgICAnZG9uZSc6ICdDaGVja091dGxpbmVkJyxcbiAgICAnZmluaXNoZWQnOiAnQ2hlY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2NhbmNlbGxlZCc6ICdDbG9zZUNpcmNsZU91dGxpbmVkJyxcbiAgICAnY2FuY2VsZWQnOiAnQ2xvc2VDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2ZhaWxlZCc6ICdDbG9zZUNpcmNsZU91dGxpbmVkJyxcbiAgICAnZXJyb3InOiAnRXhjbGFtYXRpb25DaXJjbGVPdXRsaW5lZCcsXG4gICAgJ3BhdXNlZCc6ICdQYXVzZUNpcmNsZU91dGxpbmVkJyxcblxuICAgIC8vIFNjaGVkdWxpbmcgcGF0dGVybnNcbiAgICAnc2NoZWR1bGVkJzogJ0NhbGVuZGFyT3V0bGluZWQnLFxuICAgICd1cGNvbWluZyc6ICdDYWxlbmRhck91dGxpbmVkJyxcbiAgICAnbGl2ZSc6ICdQbGF5Q2lyY2xlT3V0bGluZWQnLFxuICAgICdkcmFmdCc6ICdGaWxlT3V0bGluZWQnLFxuICAgICdwdWJsaXNoZWQnOiAnQ2hlY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2FyY2hpdmVkJzogJ0ZvbGRlck91dGxpbmVkJyxcblxuICAgIC8vIFByaW9yaXR5IHBhdHRlcm5zXG4gICAgJ2xvdyc6ICdEb3duT3V0bGluZWQnLFxuICAgICdtZWRpdW0nOiAnTWludXNPdXRsaW5lZCcsXG4gICAgJ2hpZ2gnOiAnVXBPdXRsaW5lZCcsXG4gICAgJ2NyaXRpY2FsJzogJ1dhcm5pbmdPdXRsaW5lZCcsXG4gICAgJ3VyZ2VudCc6ICdGaXJlT3V0bGluZWQnLFxuXG4gICAgLy8gQXBwcm92YWwgcGF0dGVybnNcbiAgICAnYXBwcm92ZWQnOiAnQ2hlY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ3JlamVjdGVkJzogJ0Nsb3NlQ2lyY2xlT3V0bGluZWQnLFxuICAgICdyZXZpZXcnOiAnRXllT3V0bGluZWQnLFxuXG4gICAgLy8gQm9vbGVhbiBUcnVlL0ZhbHNlXG4gICAgJ3RydWUnOiAnQ2hlY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2ZhbHNlJzogJ0Nsb3NlQ2lyY2xlT3V0bGluZWQnXG59O1xuXG4vKipcbiAqIEludGVsbGlnZW50bHkgZXh0cmFjdCBib29sZWFuIGxhYmVscyBmcm9tIGZpZWxkIG5hbWUgcGF0dGVybnMuXG4gKiBTdXBwb3J0cyBjb21tb24gYm9vbGVhbiBwcmVmaXhlcyBsaWtlIGlzL2hhcy9jYW4vc2hvdWxkL3dpbGwvZXRjLlxuICogXG4gKiBAZXhhbXBsZVxuICogLSBpc0FjdGl2ZSDihpIgXCJBY3RpdmVcIiAvIFwiSW5hY3RpdmVcIlxuICogLSBoYXNQZXJtaXNzaW9uIOKGkiBcIkhhcyBQZXJtaXNzaW9uXCIgLyBcIk5vIFBlcm1pc3Npb25cIlxuICogLSBjYW5FZGl0IOKGkiBcIkNhbiBFZGl0XCIgLyBcIkNhbm5vdCBFZGl0XCJcbiAqIC0gaXNMaXZlIOKGkiBcIkxpdmVcIiAvIFwiTm90IExpdmVcIlxuICogLSBzaG91bGROb3RpZnkg4oaSIFwiU2hvdWxkIE5vdGlmeVwiIC8gXCJTaG91bGQgTm90IE5vdGlmeVwiXG4gKi9cbmZ1bmN0aW9uIGV4dHJhY3RCb29sZWFuTGFiZWxzRnJvbUZpZWxkTmFtZShmaWVsZE5hbWU6IHN0cmluZyk6IHsgdHJ1ZUxhYmVsOiBzdHJpbmc7IGZhbHNlTGFiZWw6IHN0cmluZyB9IHwgbnVsbCB7XG4gICAgLy8gQ29tbW9uIGJvb2xlYW4gcHJlZml4ZXMgd2l0aCB0aGVpciBuZWdhdGl2ZSBmb3Jtc1xuICAgIGNvbnN0IHBhdHRlcm5zID0gW1xuICAgICAgICAvLyBQYXR0ZXJuOiBpcyArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL15pcyhbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IHRvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSksXG4gICAgICAgICAgICBnZXRGYWxzZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBiYXNlID0gdG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKTtcbiAgICAgICAgICAgICAgICAvLyBTcGVjaWFsIGNhc2VzIGZvciBiZXR0ZXIgbmVnYXRpb25cbiAgICAgICAgICAgICAgICBpZiAoYmFzZS50b0xvd2VyQ2FzZSgpID09PSAnYWN0aXZlJykgcmV0dXJuICdJbmFjdGl2ZSc7XG4gICAgICAgICAgICAgICAgaWYgKGJhc2UudG9Mb3dlckNhc2UoKSA9PT0gJ2VuYWJsZWQnKSByZXR1cm4gJ0Rpc2FibGVkJztcbiAgICAgICAgICAgICAgICBpZiAoYmFzZS50b0xvd2VyQ2FzZSgpID09PSAndmlzaWJsZScpIHJldHVybiAnSGlkZGVuJztcbiAgICAgICAgICAgICAgICBpZiAoYmFzZS50b0xvd2VyQ2FzZSgpID09PSAncHVibGljJykgcmV0dXJuICdQcml2YXRlJztcbiAgICAgICAgICAgICAgICBpZiAoYmFzZS50b0xvd2VyQ2FzZSgpID09PSAnYXZhaWxhYmxlJykgcmV0dXJuICdVbmF2YWlsYWJsZSc7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGBOb3QgJHtiYXNlfWA7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBhdHRlcm46IGhhcyArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL15oYXMoW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgSGFzICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gLFxuICAgICAgICAgICAgZ2V0RmFsc2VMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgTm8gJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWBcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGF0dGVybjogY2FuICsgWFhYXG4gICAgICAgIHtcbiAgICAgICAgICAgIHJlZ2V4OiAvXmNhbihbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBDYW4gJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWAsXG4gICAgICAgICAgICBnZXRGYWxzZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBDYW5ub3QgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWBcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGF0dGVybjogc2hvdWxkICsgWFhYXG4gICAgICAgIHtcbiAgICAgICAgICAgIHJlZ2V4OiAvXnNob3VsZChbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBTaG91bGQgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWAsXG4gICAgICAgICAgICBnZXRGYWxzZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBTaG91bGQgTm90ICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBhdHRlcm46IHdpbGwgKyBYWFhcbiAgICAgICAge1xuICAgICAgICAgICAgcmVnZXg6IC9ed2lsbChbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBXaWxsICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gLFxuICAgICAgICAgICAgZ2V0RmFsc2VMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgV2lsbCBOb3QgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWBcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGF0dGVybjogYWxsb3dzICsgWFhYXG4gICAgICAgIHtcbiAgICAgICAgICAgIHJlZ2V4OiAvXmFsbG93cyhbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBBbGxvd3MgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWAsXG4gICAgICAgICAgICBnZXRGYWxzZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBEb2VzIE5vdCBBbGxvdyAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSl9YFxuICAgICAgICB9LFxuICAgICAgICAvLyBQYXR0ZXJuOiBuZWVkcyArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL15uZWVkcyhbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBOZWVkcyAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbIDEgXSl9YCxcbiAgICAgICAgICAgIGdldEZhbHNlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYERvZXMgTm90IE5lZWQgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWBcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGF0dGVybjogcmVxdWlyZXMgKyBYWFhcbiAgICAgICAge1xuICAgICAgICAgICAgcmVnZXg6IC9ecmVxdWlyZXMoW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgUmVxdWlyZXMgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWyAxIF0pfWAsXG4gICAgICAgICAgICBnZXRGYWxzZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBEb2VzIE5vdCBSZXF1aXJlICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsgMSBdKX1gXG4gICAgICAgIH1cbiAgICBdO1xuXG4gICAgZm9yIChjb25zdCBwYXR0ZXJuIG9mIHBhdHRlcm5zKSB7XG4gICAgICAgIGNvbnN0IG1hdGNoID0gZmllbGROYW1lLm1hdGNoKHBhdHRlcm4ucmVnZXgpO1xuICAgICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdHJ1ZUxhYmVsOiBwYXR0ZXJuLmdldFRydWVMYWJlbChtYXRjaCksXG4gICAgICAgICAgICAgICAgZmFsc2VMYWJlbDogcGF0dGVybi5nZXRGYWxzZUxhYmVsKG1hdGNoKVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIEdldCB0aGUgbnVtYmVyIG9mIG9wdGlvbnMgZm9yIGEgZmllbGQuXG4gKi9cbmZ1bmN0aW9uIGdldEZpZWxkT3B0aW9uQ291bnQoZmllbGQ6IFRJT1NjaGVtYUF0dHJpYnV0ZSk6IG51bWJlciB7XG4gICAgLy8gMS4gRW51bSB0eXBlIGFycmF5XG4gICAgaWYgKEFycmF5LmlzQXJyYXkoZmllbGQudHlwZSkpIHtcbiAgICAgICAgcmV0dXJuIGZpZWxkLnR5cGUubGVuZ3RoO1xuICAgIH1cblxuICAgIC8vIDIuIEJvb2xlYW4gZmllbGRcbiAgICBpZiAoZmllbGQudHlwZSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgIHJldHVybiAyO1xuICAgIH1cblxuICAgIC8vIDMuIFNlbGVjdC9yYWRpby9jaGVja2JveCBmaWVsZCB3aXRoIGlubGluZSBvcHRpb25zXG4gICAgY29uc3QgZmllbGRUeXBlID0gZmllbGQuZmllbGRUeXBlO1xuICAgIGlmIChmaWVsZFR5cGUgPT09ICdzZWxlY3QnIHx8IGZpZWxkVHlwZSA9PT0gJ3JhZGlvJyB8fCBmaWVsZFR5cGUgPT09ICdjaGVja2JveCcgfHwgZmllbGRUeXBlID09PSAnbXVsdGktc2VsZWN0Jykge1xuICAgICAgICBjb25zdCBvcHRpb25zID0gKGZpZWxkIGFzIGFueSkub3B0aW9ucztcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkob3B0aW9ucykpIHtcbiAgICAgICAgICAgIHJldHVybiBvcHRpb25zLmxlbmd0aDtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiAwO1xufVxuXG4vKipcbiAqIENoZWNrIGlmIGEgZmllbGQgaXMgdmlhYmxlIGZvciBzZWdtZW50IGdlbmVyYXRpb24uXG4gKiBTdXBwb3J0czpcbiAqIC0gRW51bSB0eXBlczogdHlwZTogWyd2YWx1ZTEnLCAndmFsdWUyJ11cbiAqIC0gQm9vbGVhbiB0eXBlczogdHlwZTogJ2Jvb2xlYW4nXG4gKiAtIFNlbGVjdC9yYWRpby9jaGVja2JveCBmaWVsZHMgd2l0aCBvcHRpb25zOiBmaWVsZFR5cGU6ICdzZWxlY3QnICsgb3B0aW9uczogWy4uLl1cbiAqIFxuICogU1RSSUNUTFkgZW5mb3JjZXM6IG1pblZhbHVlcyA8PSBvcHRpb25Db3VudCA8PSBtYXhTZWdtZW50c1Blckdyb3VwXG4gKi9cbmZ1bmN0aW9uIGlzVmlhYmxlU2VnbWVudEZpZWxkKFxuICAgIGZpZWxkOiBUSU9TY2hlbWFBdHRyaWJ1dGUsXG4gICAgY29uZmlnOiBSZXF1aXJlZDxJU2VnbWVudEF1dG9HZW5lcmF0aW9uQ29uZmlnPiAmIHsgbWF4U2VnbWVudHNQZXJHcm91cD86IG51bWJlciB9XG4pOiBib29sZWFuIHtcbiAgICBjb25zdCBtYXhWYWx1ZXMgPSBjb25maWcubWF4U2VnbWVudHNQZXJHcm91cCB8fCAxMDtcbiAgICBjb25zdCBvcHRpb25Db3VudCA9IGdldEZpZWxkT3B0aW9uQ291bnQoZmllbGQpO1xuXG4gICAgLy8gTXVzdCBoYXZlIG9wdGlvbnMgQU5EIGJlIHdpdGhpbiBib3VuZHNcbiAgICBpZiAob3B0aW9uQ291bnQgPT09IDApIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIC8vIFNUUklDVDogUmVqZWN0IGlmIG91dHNpZGUgYm91bmRzXG4gICAgcmV0dXJuIG9wdGlvbkNvdW50ID49IGNvbmZpZy5taW5WYWx1ZXMgJiYgb3B0aW9uQ291bnQgPD0gbWF4VmFsdWVzO1xufVxuXG4vKipcbiAqIEludGVsbGlnZW50bHkgZGV0ZWN0IHRoZSBiZXN0IGZpZWxkKHMpIGZvciBnZW5lcmF0aW5nIHNlZ21lbnRzLlxuICogUmV0dXJucyBtdWx0aXBsZSBmaWVsZHMgaWYgbWF4U2VnbWVudEdyb3VwcyA+IDEuXG4gKiBcbiAqIFByaW9yaXR5OlxuICogMS4gRXhwbGljaXQgc2VnbWVudEZpZWxkcyAoZW50aXR5IGNvbmZpZykg4oaSIFVzZSB0aG9zZSBmaWVsZHNcbiAqIDIuIGluY2x1ZGVGaWVsZHMgZmlsdGVyIChlbnRpdHkgY29uZmlnKSDihpIgT25seSBjb25zaWRlciB0aGVzZVxuICogMy4gZXhjbHVkZUZpZWxkcyBmaWx0ZXIgKGVudGl0eSBjb25maWcpIOKGkiBTa2lwIHRoZXNlXG4gKiA0LiBwcmVmZXJyZWRGaWVsZHMgKGdsb2JhbC9lbnRpdHkgY29uZmlnKSDihpIgVHJ5IHRoZXNlIGZpcnN0XG4gKiA1LiBTY29yaW5nIGFsZ29yaXRobSDihpIgU2NvcmUgYWxsIGNhbmRpZGF0ZXMgYW5kIHBpY2sgdG9wIE5cbiAqL1xuZnVuY3Rpb24gZGV0ZWN0U2VnbWVudEZpZWxkczxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPHN0cmluZywgc3RyaW5nLCBzdHJpbmc+PihcbiAgICBwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+LFxuICAgIGdsb2JhbENvbmZpZz86IElTZWdtZW50QXV0b0dlbmVyYXRpb25Db25maWcsXG4gICAgZW50aXR5Q29uZmlnPzogTm9uTnVsbGFibGU8UmV0dXJuVHlwZTx0eXBlb2YgQmFzZUVudGl0eVNlcnZpY2UucHJvdG90eXBlLmdldEVudGl0eVNjaGVtYT5bICdtb2RlbCcgXVsgJ21ldGFkYXRhJyBdPlsgJ3RhYmxlVUknIF1cbik6IEFycmF5PHsgZmllbGQ6IFRJT1NjaGVtYUF0dHJpYnV0ZTsgc2NvcmU6IG51bWJlcjsgcmVhc29uOiBzdHJpbmcgfT4ge1xuICAgIGNvbnN0IHNlZ21lbnRDb25maWcgPSBlbnRpdHlDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbjtcblxuICAgIC8vIE1lcmdlIGNvbmZpZ3MgKGVudGl0eSA+IGdsb2JhbCA+IGRlZmF1bHRzKVxuICAgIGNvbnN0IG1lcmdlZENvbmZpZzogUmVxdWlyZWQ8SVNlZ21lbnRBdXRvR2VuZXJhdGlvbkNvbmZpZz4gJiB7IG1heFNlZ21lbnRHcm91cHM6IG51bWJlcjsgbWF4U2VnbWVudHNQZXJHcm91cDogbnVtYmVyIH0gPSB7XG4gICAgICAgIGVuYWJsZWQ6IHNlZ21lbnRDb25maWc/LmVuYWJsZWQgPz8gZ2xvYmFsQ29uZmlnPy5lbmFibGVkID8/IHRydWUsXG4gICAgICAgIHByZWZlcnJlZEZpZWxkczogc2VnbWVudENvbmZpZz8ucHJlZmVycmVkRmllbGRzIHx8IGdsb2JhbENvbmZpZz8ucHJlZmVycmVkRmllbGRzIHx8IFsgJ3N0YXR1cycsICdzdGF0ZScsICd0eXBlJywgJ2NhdGVnb3J5JywgJ3ByaW9yaXR5JyBdLFxuICAgICAgICBtYXhTZWdtZW50R3JvdXBzOiBzZWdtZW50Q29uZmlnPy5tYXhTZWdtZW50R3JvdXBzID8/IGdsb2JhbENvbmZpZz8ubWF4U2VnbWVudEdyb3VwcyA/PyAyLFxuICAgICAgICBtYXhTZWdtZW50c1Blckdyb3VwOiBzZWdtZW50Q29uZmlnPy5tYXhTZWdtZW50c1Blckdyb3VwID8/IGdsb2JhbENvbmZpZz8ubWF4U2VnbWVudHNQZXJHcm91cCA/PyAxMCxcbiAgICAgICAgbWluVmFsdWVzOiBzZWdtZW50Q29uZmlnPy5taW5WYWx1ZXMgPz8gZ2xvYmFsQ29uZmlnPy5taW5WYWx1ZXMgPz8gMixcbiAgICAgICAgaWNvbk1hcHBpbmc6IHsgLi4uREVGQVVMVF9JQ09OX01BUFBJTkcsIC4uLmdsb2JhbENvbmZpZz8uaWNvbk1hcHBpbmcsIC4uLnNlZ21lbnRDb25maWc/Lmljb25NYXBwaW5nIH0sXG4gICAgICAgIGJvb2xlYW5MYWJlbFBhdHRlcm5zOiBzZWdtZW50Q29uZmlnPy5ib29sZWFuTGFiZWxQYXR0ZXJucyB8fCBnbG9iYWxDb25maWc/LmJvb2xlYW5MYWJlbFBhdHRlcm5zIHx8IFtdLFxuICAgICAgICBkZWZhdWx0Qm9vbGVhbkxhYmVsczogc2VnbWVudENvbmZpZz8uZGVmYXVsdEJvb2xlYW5MYWJlbHMgfHwgZ2xvYmFsQ29uZmlnPy5kZWZhdWx0Qm9vbGVhbkxhYmVscyB8fCB7IHRydWU6ICdZZXMnLCBmYWxzZTogJ05vJyB9LFxuICAgICAgICBpbmNsdWRlQWxsU2VnbWVudDogc2VnbWVudENvbmZpZz8uaW5jbHVkZUFsbFNlZ21lbnQgPz8gZ2xvYmFsQ29uZmlnPy5pbmNsdWRlQWxsU2VnbWVudCA/PyB0cnVlLFxuICAgICAgICBkZWJ1Zzogc2VnbWVudENvbmZpZz8uZGVidWcgPz8gZ2xvYmFsQ29uZmlnPy5kZWJ1ZyA/PyBmYWxzZVxuICAgIH07XG5cbiAgICBpZiAoIW1lcmdlZENvbmZpZy5lbmFibGVkKSB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICAvLyA9PT0gUFJJT1JJVFkgMTogRXhwbGljaXQgc2VnbWVudCBmaWVsZHMgPT09XG4gICAgY29uc3QgZXhwbGljaXRGaWVsZHMgPSBzZWdtZW50Q29uZmlnPy5zZWdtZW50RmllbGRzIHx8IHNlZ21lbnRDb25maWc/LnNlZ21lbnRGaWVsZDtcbiAgICBpZiAoZXhwbGljaXRGaWVsZHMpIHtcbiAgICAgICAgY29uc3QgZmllbGROYW1lcyA9IHR5cGVvZiBleHBsaWNpdEZpZWxkcyA9PT0gJ3N0cmluZycgPyBbIGV4cGxpY2l0RmllbGRzIF0gOiBleHBsaWNpdEZpZWxkcztcbiAgICAgICAgY29uc3QgcmVzdWx0czogQXJyYXk8eyBmaWVsZDogVElPU2NoZW1hQXR0cmlidXRlOyBzY29yZTogbnVtYmVyOyByZWFzb246IHN0cmluZyB9PiA9IFtdO1xuXG4gICAgICAgIGZvciAoY29uc3QgZmllbGROYW1lIG9mIGZpZWxkTmFtZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IGZpZWxkID0gQXJyYXkuZnJvbShwcm9wZXJ0aWVzLnZhbHVlcygpKS5maW5kKHAgPT4gcC5pZCA9PT0gZmllbGROYW1lKTtcbiAgICAgICAgICAgIGlmIChmaWVsZCkge1xuICAgICAgICAgICAgICAgIHJlc3VsdHMucHVzaCh7IGZpZWxkLCBzY29yZTogMTAwMCwgcmVhc29uOiAnZXhwbGljaXQgY29uZmlndXJhdGlvbicgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocmVzdWx0cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0cy5zbGljZSgwLCBtZXJnZWRDb25maWcubWF4U2VnbWVudEdyb3Vwcyk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyA9PT0gRmlsdGVyIHByb3BlcnRpZXMgYmFzZWQgb24gaW5jbHVkZS9leGNsdWRlID09PVxuICAgIGxldCBjYW5kaWRhdGVQcm9wZXJ0aWVzID0gQXJyYXkuZnJvbShwcm9wZXJ0aWVzLnZhbHVlcygpKTtcblxuICAgIC8vIEFwcGx5IGluY2x1ZGVGaWVsZHMgZmlsdGVyIChpZiBwcm92aWRlZCwgT05MWSBjb25zaWRlciB0aGVzZSlcbiAgICBpZiAoc2VnbWVudENvbmZpZz8uaW5jbHVkZUZpZWxkcyAmJiBzZWdtZW50Q29uZmlnLmluY2x1ZGVGaWVsZHMubGVuZ3RoID4gMCkge1xuICAgICAgICBjYW5kaWRhdGVQcm9wZXJ0aWVzID0gY2FuZGlkYXRlUHJvcGVydGllcy5maWx0ZXIocCA9PlxuICAgICAgICAgICAgc2VnbWVudENvbmZpZy5pbmNsdWRlRmllbGRzIS5pbmNsdWRlcyhwLmlkKVxuICAgICAgICApO1xuICAgIH1cblxuICAgIC8vIEFwcGx5IGV4Y2x1ZGVGaWVsZHMgZmlsdGVyXG4gICAgaWYgKHNlZ21lbnRDb25maWc/LmV4Y2x1ZGVGaWVsZHMgJiYgc2VnbWVudENvbmZpZy5leGNsdWRlRmllbGRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY2FuZGlkYXRlUHJvcGVydGllcyA9IGNhbmRpZGF0ZVByb3BlcnRpZXMuZmlsdGVyKHAgPT5cbiAgICAgICAgICAgICFzZWdtZW50Q29uZmlnLmV4Y2x1ZGVGaWVsZHMhLmluY2x1ZGVzKHAuaWQpXG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gPT09IFBSSU9SSVRZIDI6IFByZWZlcnJlZCBmaWVsZHMgPT09XG4gICAgY29uc3QgcHJlZmVycmVkRmllbGRzID0gbWVyZ2VkQ29uZmlnLnByZWZlcnJlZEZpZWxkcztcbiAgICBjb25zdCBwcmVmZXJyZWRNYXRjaGVzOiBBcnJheTx7IGZpZWxkOiBUSU9TY2hlbWFBdHRyaWJ1dGU7IHNjb3JlOiBudW1iZXI7IHJlYXNvbjogc3RyaW5nIH0+ID0gW107XG5cbiAgICBmb3IgKGNvbnN0IHByZWZlcnJlZE5hbWUgb2YgcHJlZmVycmVkRmllbGRzKSB7XG4gICAgICAgIGNvbnN0IGZpZWxkID0gY2FuZGlkYXRlUHJvcGVydGllcy5maW5kKHAgPT4gcC5pZCA9PT0gcHJlZmVycmVkTmFtZSk7XG4gICAgICAgIGlmIChmaWVsZCAmJiBpc1ZpYWJsZVNlZ21lbnRGaWVsZChmaWVsZCwgbWVyZ2VkQ29uZmlnKSkge1xuICAgICAgICAgICAgcHJlZmVycmVkTWF0Y2hlcy5wdXNoKHsgZmllbGQsIHNjb3JlOiA5MDAsIHJlYXNvbjogYHByZWZlcnJlZCBmaWVsZDogJHtwcmVmZXJyZWROYW1lfWAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBJZiB3ZSBoYXZlIGVub3VnaCBwcmVmZXJyZWQgbWF0Y2hlcywgcmV0dXJuIHRoZW1cbiAgICBpZiAocHJlZmVycmVkTWF0Y2hlcy5sZW5ndGggPj0gbWVyZ2VkQ29uZmlnLm1heFNlZ21lbnRHcm91cHMpIHtcbiAgICAgICAgcmV0dXJuIHByZWZlcnJlZE1hdGNoZXMuc2xpY2UoMCwgbWVyZ2VkQ29uZmlnLm1heFNlZ21lbnRHcm91cHMpO1xuICAgIH1cblxuICAgIC8vID09PSBQUklPUklUWSAzOiBTY29yaW5nIGFsZ29yaXRobSA9PT1cbiAgICBjb25zdCBjYW5kaWRhdGVzOiBBcnJheTx7IGZpZWxkOiBUSU9TY2hlbWFBdHRyaWJ1dGU7IHNjb3JlOiBudW1iZXI7IHJlYXNvbjogc3RyaW5nOyBvcHRpb25Db3VudDogbnVtYmVyIH0+ID0gW107XG5cbiAgICAvLyBBZGQgcHJlZmVycmVkTWF0Y2hlcyB3aXRoIHRoZWlyIG9wdGlvbiBjb3VudHNcbiAgICBmb3IgKGNvbnN0IHBtIG9mIHByZWZlcnJlZE1hdGNoZXMpIHtcbiAgICAgICAgY29uc3Qgb3B0aW9uQ291bnQgPSBnZXRGaWVsZE9wdGlvbkNvdW50KHBtLmZpZWxkKTtcbiAgICAgICAgY2FuZGlkYXRlcy5wdXNoKHsgLi4ucG0sIG9wdGlvbkNvdW50IH0pO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgcHJvcCBvZiBjYW5kaWRhdGVQcm9wZXJ0aWVzKSB7XG4gICAgICAgIC8vIFNraXAgaWYgYWxyZWFkeSBpbiBwcmVmZXJyZWRNYXRjaGVzXG4gICAgICAgIGlmIChwcmVmZXJyZWRNYXRjaGVzLnNvbWUocG0gPT4gcG0uZmllbGQuaWQgPT09IHByb3AuaWQpKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNraXAgaWYgbm90IHZpYWJsZSAodGhpcyBmaWx0ZXJzIG91dCBmaWVsZHMgd2l0aCB0b28gbWFueSBvcHRpb25zKVxuICAgICAgICBpZiAoIWlzVmlhYmxlU2VnbWVudEZpZWxkKHByb3AsIG1lcmdlZENvbmZpZykpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IHNjb3JlID0gMDtcbiAgICAgICAgY29uc3QgcmVhc29uczogc3RyaW5nW10gPSBbXTtcbiAgICAgICAgY29uc3Qgb3B0aW9uQ291bnQgPSBnZXRGaWVsZE9wdGlvbkNvdW50KHByb3ApO1xuXG4gICAgICAgIC8vICoqU2NvcmUgMTogRmllbGQgbmFtZSBtYXRjaCoqIChwYXJ0aWFsIG1hdGNoIHdpdGggcHJlZmVycmVkIG5hbWVzKVxuICAgICAgICBmb3IgKGNvbnN0IHByZWZlcnJlZCBvZiBwcmVmZXJyZWRGaWVsZHMpIHtcbiAgICAgICAgICAgIGlmIChwcm9wLmlkLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocHJlZmVycmVkLnRvTG93ZXJDYXNlKCkpKSB7XG4gICAgICAgICAgICAgICAgc2NvcmUgKz0gNTA7XG4gICAgICAgICAgICAgICAgcmVhc29ucy5wdXNoKGBuYW1lIGNvbnRhaW5zIFwiJHtwcmVmZXJyZWR9XCJgKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vICoqU2NvcmUgMjogUHJlZmVyIGZld2VyIG9wdGlvbnMgKGludmVyc2Ugc2NvcmluZykqKlxuICAgICAgICAvLyBGaWVsZHMgd2l0aCBmZXdlciBvcHRpb25zIGdldCBoaWdoZXIgc2NvcmVzXG4gICAgICAgIGNvbnN0IG1pblZhbHVlcyA9IG1lcmdlZENvbmZpZy5taW5WYWx1ZXM7XG4gICAgICAgIGNvbnN0IG1heFZhbHVlcyA9IG1lcmdlZENvbmZpZy5tYXhTZWdtZW50c1Blckdyb3VwO1xuXG4gICAgICAgIGlmIChvcHRpb25Db3VudCA+PSBtaW5WYWx1ZXMgJiYgb3B0aW9uQ291bnQgPD0gbWF4VmFsdWVzKSB7XG4gICAgICAgICAgICAvLyBTY29yZSBpbnZlcnNlbHkgcHJvcG9ydGlvbmFsIHRvIG9wdGlvbiBjb3VudFxuICAgICAgICAgICAgLy8gMiBvcHRpb25zID0gKzQwLCA1IG9wdGlvbnMgPSArMjUsIDEwIG9wdGlvbnMgPSArMTBcbiAgICAgICAgICAgIGNvbnN0IG9wdGlvblNjb3JlID0gTWF0aC5tYXgoMTAsIDQwIC0gKG9wdGlvbkNvdW50IC0gbWluVmFsdWVzKSAqIDMpO1xuICAgICAgICAgICAgc2NvcmUgKz0gb3B0aW9uU2NvcmU7XG4gICAgICAgICAgICByZWFzb25zLnB1c2goYCR7b3B0aW9uQ291bnR9IG9wdGlvbnNgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vICoqU2NvcmUgMzogQm9vbGVhbiBmaWVsZCBnZXRzIGhpZ2ggcHJpb3JpdHkgKG9ubHkgMiBvcHRpb25zKSoqXG4gICAgICAgIGlmIChwcm9wLnR5cGUgPT09ICdib29sZWFuJykge1xuICAgICAgICAgICAgc2NvcmUgKz0gNTsgIC8vIFNtYWxsIGJvbnVzIHNpbmNlIG9wdGlvbiBjb3VudCBhbHJlYWR5IGZhY3RvcnMgaW5cbiAgICAgICAgICAgIHJlYXNvbnMucHVzaCgnYm9vbGVhbiBmaWVsZCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gKipTY29yZSA0OiBOYW1lIHBvc2l0aW9uIChlYXJsaWVyID0gc2xpZ2h0bHkgaGlnaGVyIHByaW9yaXR5KSoqXG4gICAgICAgIGNvbnN0IGZpZWxkSW5kZXggPSBjYW5kaWRhdGVQcm9wZXJ0aWVzLmluZGV4T2YocHJvcCk7XG4gICAgICAgIHNjb3JlIC09IE1hdGgubWluKGZpZWxkSW5kZXgsIDUpOyAgLy8gQ2FwIHBlbmFsdHkgYXQgNVxuXG4gICAgICAgIGNhbmRpZGF0ZXMucHVzaCh7XG4gICAgICAgICAgICBmaWVsZDogcHJvcCxcbiAgICAgICAgICAgIHNjb3JlLFxuICAgICAgICAgICAgcmVhc29uOiByZWFzb25zLmpvaW4oJywgJyksXG4gICAgICAgICAgICBvcHRpb25Db3VudFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBTb3J0IGJ5OiAxKSBzY29yZSAoaGlnaGVzdCBmaXJzdCksIDIpIG9wdGlvbiBjb3VudCAobG93ZXN0IGZpcnN0KVxuICAgIGNhbmRpZGF0ZXMuc29ydCgoYSwgYikgPT4ge1xuICAgICAgICBpZiAoYi5zY29yZSAhPT0gYS5zY29yZSkge1xuICAgICAgICAgICAgcmV0dXJuIGIuc2NvcmUgLSBhLnNjb3JlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBhLm9wdGlvbkNvdW50IC0gYi5vcHRpb25Db3VudDsgIC8vIFByZWZlciBmZXdlciBvcHRpb25zXG4gICAgfSk7XG5cbiAgICBjb25zdCB0b3BOUmVzdWx0cyA9IGNhbmRpZGF0ZXMuc2xpY2UoMCwgbWVyZ2VkQ29uZmlnLm1heFNlZ21lbnRHcm91cHMpO1xuXG4gICAgaWYgKHRvcE5SZXN1bHRzLmxlbmd0aCA+IDAgJiYgbWVyZ2VkQ29uZmlnLmRlYnVnKSB7XG4gICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW1NlZ21lbnREZXRlY3Rpb25dIFNlbGVjdGVkICR7dG9wTlJlc3VsdHMubGVuZ3RofSBmaWVsZChzKTpgLCB0b3BOUmVzdWx0cy5tYXAoYyA9PiAoe1xuICAgICAgICAgICAgZmllbGQ6IGMuZmllbGQuaWQsXG4gICAgICAgICAgICBzY29yZTogYy5zY29yZSxcbiAgICAgICAgICAgIG9wdGlvbkNvdW50OiBjLm9wdGlvbkNvdW50LFxuICAgICAgICAgICAgcmVhc29uOiBjLnJlYXNvblxuICAgICAgICB9KSkpO1xuICAgIH1cblxuICAgIHJldHVybiB0b3BOUmVzdWx0cztcbn1cblxuLyoqXG4gKiBBdXRvLWdlbmVyYXRlIGZpbHRlciBzZWdtZW50cyBiYXNlZCBvbiBlbnRpdHkgYXR0cmlidXRlcyB1c2luZyBzbWFydCBkZXRlY3Rpb24uXG4gKiBcbiAqIEFsZ29yaXRobTpcbiAqIDEuIElmIGN1c3RvbSBzZWdtZW50cyBwcm92aWRlZCDihpIgdXNlIHRoZW0gKGhpZ2hlc3QgcHJpb3JpdHkpXG4gKiAyLiBJZiBlbnRpdHkgcmVxdWlyZXMgbWFudWFsIHNlZ21lbnRzIOKGkiBza2lwIGF1dG8tZ2VuZXJhdGlvblxuICogMy4gRGV0ZWN0IGJlc3QgZmllbGQgdXNpbmcgc2NvcmluZyBhbGdvcml0aG1cbiAqIDQuIEdlbmVyYXRlIHNlZ21lbnRzIGZyb20gZGV0ZWN0ZWQgZmllbGQgd2l0aCBzbWFydCBpY29uc1xuICovXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVTZWdtZW50czxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPHN0cmluZywgc3RyaW5nLCBzdHJpbmc+PihcbiAgICBwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+LFxuICAgIGVudGl0eVNlcnZpY2U/OiBCYXNlRW50aXR5U2VydmljZTxTPixcbiAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbICd1aUNvbmZpZ0dlbk9wdGlvbnMnIF0sXG4gICAgY3VzdG9tU2VnbWVudHM/OiBSZWFkb25seUFycmF5PElGaWx0ZXJTZWdtZW50IHwgSUZpbHRlclNlZ21lbnRHcm91cD4gfCBBcnJheTxJRmlsdGVyU2VnbWVudCB8IElGaWx0ZXJTZWdtZW50R3JvdXA+XG4pOiBSZWFkb25seUFycmF5PElGaWx0ZXJTZWdtZW50IHwgSUZpbHRlclNlZ21lbnRHcm91cD4gfCBBcnJheTxJRmlsdGVyU2VnbWVudCB8IElGaWx0ZXJTZWdtZW50R3JvdXA+IHwgdW5kZWZpbmVkIHtcbiAgICAvLyAxLiBJZiBjdXN0b20gc2VnbWVudHMgcHJvdmlkZWQsIHVzZSB0aG9zZSAoaGlnaGVzdCBwcmlvcml0eSlcbiAgICBpZiAoY3VzdG9tU2VnbWVudHMgJiYgY3VzdG9tU2VnbWVudHMubGVuZ3RoID4gMCkge1xuICAgICAgICByZXR1cm4gY3VzdG9tU2VnbWVudHM7XG4gICAgfVxuXG4gICAgLy8gR2V0IGNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCBnbG9iYWxTZWdtZW50Q29uZmlnID0gZ2xvYmFsVUlDb25maWdPcHRpb25zPy50YWJsZVVJPy5zZWdtZW50QXV0b0dlbmVyYXRpb247XG4gICAgY29uc3QgZW50aXR5TWV0YWRhdGEgPSBlbnRpdHlTZXJ2aWNlPy5nZXRFbnRpdHlTY2hlbWE/LigpLm1vZGVsPy5tZXRhZGF0YTtcbiAgICBjb25zdCBlbnRpdHlTZWdtZW50Q29uZmlnID0gZW50aXR5TWV0YWRhdGE/LnRhYmxlVUk7XG5cbiAgICAvLyAyLiBJZiBlbnRpdHkgcmVxdWlyZXMgbWFudWFsIHNlZ21lbnRzLCBza2lwIGF1dG8tZ2VuZXJhdGlvblxuICAgIGlmIChlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LnJlcXVpcmVNYW51YWwpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyAzLiBEZXRlY3QgYmVzdCBzZWdtZW50IGZpZWxkcyAocmV0dXJucyBhcnJheSBub3cpXG4gICAgY29uc3QgZGV0ZWN0ZWRGaWVsZHMgPSBkZXRlY3RTZWdtZW50RmllbGRzKHByb3BlcnRpZXMsIGdsb2JhbFNlZ21lbnRDb25maWcsIGVudGl0eVNlZ21lbnRDb25maWcpO1xuXG4gICAgaWYgKGRldGVjdGVkRmllbGRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAvLyBObyBzdWl0YWJsZSBmaWVsZHMgZm91bmRcbiAgICAgICAgaWYgKGdsb2JhbFNlZ21lbnRDb25maWc/LmRlYnVnIHx8IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uZGVidWcpIHtcbiAgICAgICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW1NlZ21lbnRHZW5lcmF0aW9uXSBObyBzdWl0YWJsZSBmaWVsZHMgZGV0ZWN0ZWQgZm9yIHNlZ21lbnRzYCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyBHZXQgbWVyZ2VkIGNvbmZpZyBmb3IgdGhpcyBlbnRpdHlcbiAgICBjb25zdCBtZXJnZWRDb25maWc6IFJlcXVpcmVkPElTZWdtZW50QXV0b0dlbmVyYXRpb25Db25maWc+ICYgeyBtYXhTZWdtZW50R3JvdXBzOiBudW1iZXI7IG1heFNlZ21lbnRzUGVyR3JvdXA6IG51bWJlciB9ID0ge1xuICAgICAgICBlbmFibGVkOiBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmVuYWJsZWQgPz8gZ2xvYmFsU2VnbWVudENvbmZpZz8uZW5hYmxlZCA/PyB0cnVlLFxuICAgICAgICBwcmVmZXJyZWRGaWVsZHM6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8ucHJlZmVycmVkRmllbGRzIHx8IGdsb2JhbFNlZ21lbnRDb25maWc/LnByZWZlcnJlZEZpZWxkcyB8fCBbICdzdGF0dXMnLCAnc3RhdGUnLCAndHlwZScsICdjYXRlZ29yeScsICdwcmlvcml0eScgXSxcbiAgICAgICAgbWF4U2VnbWVudEdyb3VwczogZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5tYXhTZWdtZW50R3JvdXBzID8/IGdsb2JhbFNlZ21lbnRDb25maWc/Lm1heFNlZ21lbnRHcm91cHMgPz8gMixcbiAgICAgICAgbWF4U2VnbWVudHNQZXJHcm91cDogZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5tYXhTZWdtZW50c1Blckdyb3VwID8/IGdsb2JhbFNlZ21lbnRDb25maWc/Lm1heFNlZ21lbnRzUGVyR3JvdXAgPz8gMTAsXG4gICAgICAgIG1pblZhbHVlczogZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5taW5WYWx1ZXMgPz8gZ2xvYmFsU2VnbWVudENvbmZpZz8ubWluVmFsdWVzID8/IDIsXG4gICAgICAgIGljb25NYXBwaW5nOiB7XG4gICAgICAgICAgICAuLi5ERUZBVUxUX0lDT05fTUFQUElORyxcbiAgICAgICAgICAgIC4uLmdsb2JhbFNlZ21lbnRDb25maWc/Lmljb25NYXBwaW5nLFxuICAgICAgICAgICAgLi4uZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5pY29uTWFwcGluZ1xuICAgICAgICB9LFxuICAgICAgICBib29sZWFuTGFiZWxQYXR0ZXJuczogZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5ib29sZWFuTGFiZWxQYXR0ZXJucyB8fCBnbG9iYWxTZWdtZW50Q29uZmlnPy5ib29sZWFuTGFiZWxQYXR0ZXJucyB8fCBbXSxcbiAgICAgICAgZGVmYXVsdEJvb2xlYW5MYWJlbHM6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uZGVmYXVsdEJvb2xlYW5MYWJlbHMgfHwgZ2xvYmFsU2VnbWVudENvbmZpZz8uZGVmYXVsdEJvb2xlYW5MYWJlbHMgfHwgeyB0cnVlOiAnWWVzJywgZmFsc2U6ICdObycgfSxcbiAgICAgICAgaW5jbHVkZUFsbFNlZ21lbnQ6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uaW5jbHVkZUFsbFNlZ21lbnQgPz8gZ2xvYmFsU2VnbWVudENvbmZpZz8uaW5jbHVkZUFsbFNlZ21lbnQgPz8gdHJ1ZSxcbiAgICAgICAgZGVidWc6IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uZGVidWcgPz8gZ2xvYmFsU2VnbWVudENvbmZpZz8uZGVidWcgPz8gZmFsc2VcbiAgICB9O1xuXG4gICAgaWYgKG1lcmdlZENvbmZpZy5kZWJ1Zykge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtTZWdtZW50R2VuZXJhdGlvbl0gR2VuZXJhdGluZyBzZWdtZW50cyBmb3IgJHtkZXRlY3RlZEZpZWxkcy5sZW5ndGh9IGZpZWxkKHMpOmAsIGRldGVjdGVkRmllbGRzLm1hcChkID0+IGQuZmllbGQuaWQpKTtcbiAgICB9XG5cbiAgICAvLyA0LiBHZW5lcmF0ZSBzZWdtZW50IGdyb3VwcyAob25lIHBlciBkZXRlY3RlZCBmaWVsZClcbiAgICBjb25zdCBzZWdtZW50R3JvdXBzOiBBcnJheTxJRmlsdGVyU2VnbWVudEdyb3VwPiA9IFtdO1xuXG4gICAgZm9yIChjb25zdCBkZXRlY3Rpb24gb2YgZGV0ZWN0ZWRGaWVsZHMpIHtcbiAgICAgICAgY29uc3QgeyBmaWVsZCB9ID0gZGV0ZWN0aW9uO1xuXG4gICAgICAgIC8vIEdlbmVyYXRlIHNlZ21lbnRzIGZvciB0aGlzIGZpZWxkXG4gICAgICAgIGNvbnN0IHNlZ21lbnRzOiBBcnJheTxJRmlsdGVyU2VnbWVudD4gPSBbXTtcblxuICAgICAgICAvLyBBZGQgXCJBbGxcIiBzZWdtZW50IGlmIGVuYWJsZWRcbiAgICAgICAgaWYgKG1lcmdlZENvbmZpZy5pbmNsdWRlQWxsU2VnbWVudCkge1xuICAgICAgICAgICAgc2VnbWVudHMucHVzaCh7XG4gICAgICAgICAgICAgICAgaWQ6IGBhbGwtJHtmaWVsZC5pZH1gLFxuICAgICAgICAgICAgICAgIGxhYmVsOiAnQWxsJyxcbiAgICAgICAgICAgICAgICBmaWx0ZXJzOiB7fSxcbiAgICAgICAgICAgICAgICBkZWZhdWx0OiB0cnVlXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEdldCB2YWx1ZXMgZnJvbSBmaWVsZFxuICAgICAgICBsZXQgdmFsdWVzOiAoc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbilbXSA9IFtdO1xuICAgICAgICBsZXQgdmFsdWVMYWJlbHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTsgIC8vIEZvciBjdXN0b20gYm9vbGVhbiBsYWJlbHNcblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShmaWVsZC50eXBlKSkge1xuICAgICAgICAgICAgLy8gRW51bSB0eXBlIGFycmF5XG4gICAgICAgICAgICB2YWx1ZXMgPSBmaWVsZC50eXBlO1xuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkLnR5cGUgPT09ICdib29sZWFuJykge1xuICAgICAgICAgICAgLy8gQm9vbGVhbiBmaWVsZCB3aXRoIG9wdGlvbmFsIGN1c3RvbSBsYWJlbHNcbiAgICAgICAgICAgIHZhbHVlcyA9IFsgdHJ1ZSwgZmFsc2UgXTtcblxuICAgICAgICAgICAgLy8gMS4gQ2hlY2sgZm9yIGV4cGxpY2l0IGZpZWxkLWxldmVsIGJvb2xlYW5MYWJlbHNcbiAgICAgICAgICAgIGNvbnN0IGZpZWxkQm9vbGVhbkxhYmVscyA9ICdib29sZWFuTGFiZWxzJyBpbiBmaWVsZCA/IGZpZWxkLmJvb2xlYW5MYWJlbHMgOiB1bmRlZmluZWQ7XG4gICAgICAgICAgICBpZiAoZmllbGRCb29sZWFuTGFiZWxzICYmIHR5cGVvZiBmaWVsZEJvb2xlYW5MYWJlbHMgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbICd0cnVlJyBdID0gZmllbGRCb29sZWFuTGFiZWxzLnRydWUgfHwgJ1llcyc7XG4gICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbICdmYWxzZScgXSA9IGZpZWxkQm9vbGVhbkxhYmVscy5mYWxzZSB8fCAnTm8nO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAvLyAyLiBUcnkgaW50ZWxsaWdlbnQgZXh0cmFjdGlvbiBmcm9tIGZpZWxkIG5hbWVcbiAgICAgICAgICAgICAgICBjb25zdCBmaWVsZE5hbWUgPSBmaWVsZC5pZDtcbiAgICAgICAgICAgICAgICBjb25zdCBleHRyYWN0ZWQgPSBleHRyYWN0Qm9vbGVhbkxhYmVsc0Zyb21GaWVsZE5hbWUoZmllbGROYW1lKTtcblxuICAgICAgICAgICAgICAgIGlmIChleHRyYWN0ZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbICd0cnVlJyBdID0gZXh0cmFjdGVkLnRydWVMYWJlbDtcbiAgICAgICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbICdmYWxzZScgXSA9IGV4dHJhY3RlZC5mYWxzZUxhYmVsO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIDMuIFRyeSB0byBtYXRjaCBhZ2FpbnN0IGNvbmZpZ3VyZWQgcGF0dGVybnNcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGF0dGVybnMgPSBtZXJnZWRDb25maWcuYm9vbGVhbkxhYmVsUGF0dGVybnM7XG4gICAgICAgICAgICAgICAgICAgIGxldCBtYXRjaGVkID0gZmFsc2U7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKHBhdHRlcm5zICYmIHBhdHRlcm5zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgcGF0dGVybiBvZiBwYXR0ZXJucykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlZ2V4ID0gcGF0dGVybi5wYXR0ZXJuIGluc3RhbmNlb2YgUmVnRXhwXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gcGF0dGVybi5wYXR0ZXJuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogbmV3IFJlZ0V4cChwYXR0ZXJuLnBhdHRlcm4sICdpJyk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAocmVnZXgudGVzdChmaWVsZE5hbWUpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlTGFiZWxzWyAndHJ1ZScgXSA9IHBhdHRlcm4udHJ1ZUxhYmVsO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZUxhYmVsc1sgJ2ZhbHNlJyBdID0gcGF0dGVybi5mYWxzZUxhYmVsO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXRjaGVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gNC4gVXNlIGRlZmF1bHQgZmFsbGJhY2sgaWYgbm8gcGF0dGVybiBtYXRjaGVkXG4gICAgICAgICAgICAgICAgICAgIGlmICghbWF0Y2hlZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZGVmYXVsdHMgPSBtZXJnZWRDb25maWcuZGVmYXVsdEJvb2xlYW5MYWJlbHMgfHwgeyB0cnVlOiAnWWVzJywgZmFsc2U6ICdObycgfTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlTGFiZWxzWyAndHJ1ZScgXSA9IGRlZmF1bHRzLnRydWU7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZUxhYmVsc1sgJ2ZhbHNlJyBdID0gZGVmYXVsdHMuZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoKGZpZWxkLmZpZWxkVHlwZSA9PT0gJ3NlbGVjdCcgfHwgZmllbGQuZmllbGRUeXBlID09PSAncmFkaW8nIHx8IGZpZWxkLmZpZWxkVHlwZSA9PT0gJ2NoZWNrYm94JyB8fCBmaWVsZC5maWVsZFR5cGUgPT09ICdtdWx0aS1zZWxlY3QnKSAmJiBBcnJheS5pc0FycmF5KChmaWVsZCBhcyBhbnkpLm9wdGlvbnMpKSB7XG4gICAgICAgICAgICAvLyBTZWxlY3QvcmFkaW8vY2hlY2tib3ggZmllbGQgd2l0aCBpbmxpbmUgb3B0aW9uc1xuICAgICAgICAgICAgY29uc3Qgb3B0aW9ucyA9IChmaWVsZCBhcyBhbnkpLm9wdGlvbnMgYXMgQXJyYXk8eyBsYWJlbDogc3RyaW5nOyB2YWx1ZTogc3RyaW5nIH0+O1xuICAgICAgICAgICAgdmFsdWVzID0gb3B0aW9ucy5tYXAob3B0ID0+IG9wdC52YWx1ZSk7XG4gICAgICAgICAgICAvLyBTdG9yZSBsYWJlbHMgZm9yIGxhdGVyIHVzZVxuICAgICAgICAgICAgb3B0aW9ucy5mb3JFYWNoKG9wdCA9PiB7XG4gICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbIFN0cmluZyhvcHQudmFsdWUpIF0gPSBvcHQubGFiZWw7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFwcGx5IGZpZWxkLXNwZWNpZmljIHZhbHVlIGZpbHRlcnMgZmlyc3QsIHRoZW4gZ2xvYmFsXG4gICAgICAgIGNvbnN0IGluY2x1ZGVWYWx1ZXNCeUZpZWxkID0gZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5pbmNsdWRlVmFsdWVzQnlGaWVsZDtcbiAgICAgICAgY29uc3QgaW5jbHVkZVZhbHVlcyA9IGluY2x1ZGVWYWx1ZXNCeUZpZWxkPy5bIGZpZWxkLmlkIF0gfHwgZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5pbmNsdWRlVmFsdWVzO1xuICAgICAgICBpZiAoaW5jbHVkZVZhbHVlcykge1xuICAgICAgICAgICAgdmFsdWVzID0gdmFsdWVzLmZpbHRlcih2ID0+IGluY2x1ZGVWYWx1ZXMuaW5jbHVkZXMoU3RyaW5nKHYpKSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBleGNsdWRlVmFsdWVzQnlGaWVsZCA9IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uZXhjbHVkZVZhbHVlc0J5RmllbGQ7XG4gICAgICAgIGNvbnN0IGV4Y2x1ZGVWYWx1ZXMgPSBleGNsdWRlVmFsdWVzQnlGaWVsZD8uWyBmaWVsZC5pZCBdIHx8IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uZXhjbHVkZVZhbHVlcztcbiAgICAgICAgaWYgKGV4Y2x1ZGVWYWx1ZXMpIHtcbiAgICAgICAgICAgIHZhbHVlcyA9IHZhbHVlcy5maWx0ZXIodiA9PiAhZXhjbHVkZVZhbHVlcy5pbmNsdWRlcyhTdHJpbmcodikpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFwcGx5IGZpZWxkLXNwZWNpZmljIHNvcnQgb3JkZXIgZmlyc3QsIHRoZW4gZ2xvYmFsXG4gICAgICAgIGNvbnN0IHNvcnRPcmRlckJ5RmllbGQgPSBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LnNvcnRPcmRlckJ5RmllbGQ7XG4gICAgICAgIGNvbnN0IHNvcnRPcmRlciA9IHNvcnRPcmRlckJ5RmllbGQ/LlsgZmllbGQuaWQgXSB8fCBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LnNvcnRPcmRlcjtcbiAgICAgICAgaWYgKHNvcnRPcmRlcikge1xuICAgICAgICAgICAgdmFsdWVzLnNvcnQoKGEsIGIpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBhSW5kZXggPSBzb3J0T3JkZXIuaW5kZXhPZihTdHJpbmcoYSkpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGJJbmRleCA9IHNvcnRPcmRlci5pbmRleE9mKFN0cmluZyhiKSk7XG5cbiAgICAgICAgICAgICAgICAvLyBJZiBib3RoIGluIHNvcnRPcmRlciwgdXNlIHRoYXQgb3JkZXJcbiAgICAgICAgICAgICAgICBpZiAoYUluZGV4ID49IDAgJiYgYkluZGV4ID49IDApIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGFJbmRleCAtIGJJbmRleDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgLy8gSWYgb25seSBvbmUgaW4gc29ydE9yZGVyLCBpdCBjb21lcyBmaXJzdFxuICAgICAgICAgICAgICAgIGlmIChhSW5kZXggPj0gMCkgcmV0dXJuIC0xO1xuICAgICAgICAgICAgICAgIGlmIChiSW5kZXggPj0gMCkgcmV0dXJuIDE7XG4gICAgICAgICAgICAgICAgLy8gTmVpdGhlciBpbiBzb3J0T3JkZXIsIG1haW50YWluIG9yaWdpbmFsIG9yZGVyXG4gICAgICAgICAgICAgICAgcmV0dXJuIDA7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEdlbmVyYXRlIHNlZ21lbnQgZm9yIGVhY2ggdmFsdWVcbiAgICAgICAgZm9yIChjb25zdCB2YWx1ZSBvZiB2YWx1ZXMpIHtcbiAgICAgICAgICAgIGNvbnN0IHZhbHVlU3RyID0gU3RyaW5nKHZhbHVlKTtcbiAgICAgICAgICAgIGNvbnN0IHZhbHVlTG93ZXIgPSB2YWx1ZVN0ci50b0xvd2VyQ2FzZSgpO1xuXG4gICAgICAgICAgICAvLyBVc2UgY3VzdG9tIGxhYmVsIGlmIGF2YWlsYWJsZSwgb3RoZXJ3aXNlIGZvcm1hdCB0aGUgdmFsdWVcbiAgICAgICAgICAgIGNvbnN0IHNlZ21lbnRMYWJlbCA9IHZhbHVlTGFiZWxzWyB2YWx1ZVN0ciBdIHx8IHBhc2NhbENhc2UodmFsdWVTdHIpO1xuXG4gICAgICAgICAgICBzZWdtZW50cy5wdXNoKHtcbiAgICAgICAgICAgICAgICBpZDogYCR7ZmllbGQuaWR9LSR7dmFsdWVMb3dlci5yZXBsYWNlKC9bXmEtejAtOV0rL2csICctJyl9YCwgIC8vIFVuaXF1ZSBJRFxuICAgICAgICAgICAgICAgIGxhYmVsOiBzZWdtZW50TGFiZWwsICAvLyBDdXN0b20gb3IgZm9ybWF0dGVkIGxhYmVsXG4gICAgICAgICAgICAgICAgaWNvbjogbWVyZ2VkQ29uZmlnLmljb25NYXBwaW5nWyB2YWx1ZUxvd2VyIF0sICAvLyBTbWFydCBpY29uIGxvb2t1cFxuICAgICAgICAgICAgICAgIGZpbHRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgWyBmaWVsZC5pZCBdOiB7IGVxOiB2YWx1ZSB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBPbmx5IGFkZCBncm91cCBpZiB3ZSBoYXZlIHNlZ21lbnRzXG4gICAgICAgIGNvbnN0IG1pblNlZ21lbnRzID0gbWVyZ2VkQ29uZmlnLmluY2x1ZGVBbGxTZWdtZW50ID8gMSA6IDA7XG4gICAgICAgIGlmIChzZWdtZW50cy5sZW5ndGggPiBtaW5TZWdtZW50cykge1xuICAgICAgICAgICAgLy8gQXV0by1nZW5lcmF0ZSBsYWJlbCBvciB1c2UgZXhwbGljaXQgZ3JvdXBMYWJlbHNcbiAgICAgICAgICAgIGNvbnN0IGN1c3RvbUdyb3VwTGFiZWxzID0gZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5ncm91cExhYmVscztcbiAgICAgICAgICAgIGNvbnN0IGxhYmVsID0gY3VzdG9tR3JvdXBMYWJlbHM/LlsgZmllbGQuaWQgXSB8fCBgQnkgJHtwYXNjYWxDYXNlKGZpZWxkLmlkKX1gO1xuXG4gICAgICAgICAgICBzZWdtZW50R3JvdXBzLnB1c2goe1xuICAgICAgICAgICAgICAgIGlkOiBgJHtmaWVsZC5pZH0tZ3JvdXBgLFxuICAgICAgICAgICAgICAgIGxhYmVsLFxuICAgICAgICAgICAgICAgIHNlZ21lbnRzLFxuICAgICAgICAgICAgICAgIGRlZmF1bHRTZWdtZW50SWQ6IHNlZ21lbnRzLmZpbmQocyA9PiBzLmRlZmF1bHQpPy5pZCxcbiAgICAgICAgICAgICAgICBtYXhWaXNpYmxlOiBtZXJnZWRDb25maWcubWF4U2VnbWVudHNQZXJHcm91cFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBSZXR1cm4gc2VnbWVudCBncm91cHMgKG9yIHVuZGVmaW5lZCBpZiBub25lIGdlbmVyYXRlZClcbiAgICBpZiAoc2VnbWVudEdyb3Vwcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyBJZiBvbmx5IDEgZ3JvdXAgd2l0aCBzaW1wbGUgY29uZmlnLCByZXR1cm4gZmxhdCBzZWdtZW50cyBmb3IgYmFja3dhcmRzIGNvbXBhdGliaWxpdHlcbiAgICAvLyBUaGlzIG1haW50YWlucyBsZWdhY3kgYmVoYXZpb3Igd2hlbiBtYXhTZWdtZW50R3JvdXBzID0gMVxuICAgIGlmIChzZWdtZW50R3JvdXBzLmxlbmd0aCA9PT0gMSAmJiBtZXJnZWRDb25maWcubWF4U2VnbWVudEdyb3VwcyA9PT0gMSkge1xuICAgICAgICByZXR1cm4gc2VnbWVudEdyb3Vwc1sgMCBdLnNlZ21lbnRzO1xuICAgIH1cblxuICAgIHJldHVybiBzZWdtZW50R3JvdXBzO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEVOVElUWSBBVFRSSUJVVEUgRk9STUFUVElOR1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogRm9ybWF0cyBhIHNpbmdsZSBlbnRpdHkgYXR0cmlidXRlIGZvciBmb3JtIG9yIGRldGFpbCBwYWdlIGRpc3BsYXkuXG4gKiBcbiAqIFRyYW5zZm9ybXMgc2NoZW1hIGF0dHJpYnV0ZXMgaW50byBVSS1yZWFkeSBmaWVsZCBjb25maWd1cmF0aW9ucyB3aXRoIHByb3BlciBmaWVsZCB0eXBlcyxcbiAqIHJlbGF0aW9uIGNvbmZpZ3MsIG9wdGlvbnMsIHZpc2liaWxpdHksIGFuZCB2YWxpZGF0aW9uIHJ1bGVzLiBBdXRvLWdlbmVyYXRlcyByZWxhdGlvblxuICogZGlzcGxheSBjb25maWd1cmF0aW9ucyBhbmQgZmlsdGVyIGNvbmZpZ3Mgd2hlbiBub3QgZXhwbGljaXRseSBwcm92aWRlZC5cbiAqIFxuICogQHBhcmFtIHRoaXNQcm9wIC0gVGhlIGVudGl0eSBhdHRyaWJ1dGUgdG8gZm9ybWF0XG4gKiBAcGFyYW0gdHlwZSAtIFBhZ2UgdHlwZTogJ2NyZWF0ZScsICd1cGRhdGUnLCBvciAnZGV0YWlsJ1xuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSBmb3IgYWNjZXNzaW5nIHJlbGF0ZWQgc2NoZW1hc1xuICogQHBhcmFtIGFsbFByb3BlcnRpZXMgLSBPcHRpb25hbCBhcnJheSBvZiBhbGwgcHJvcGVydGllcyBmb3IgZGV0ZWN0aW5nIGR1cGxpY2F0ZWQgcmVsYXRpb24gZmllbGRzXG4gKiBAcGFyYW0gZ2xvYmFsVUlDb25maWdPcHRpb25zIC0gT3B0aW9uYWwgZ2xvYmFsIFVJIGNvbmZpZ3VyYXRpb24gb3B0aW9uc1xuICogQHJldHVybnMgRm9ybWF0dGVkIGZpZWxkIG1ldGFkYXRhIHJlYWR5IGZvciBVSSByZW5kZXJpbmdcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IGZvcm1hdHRlZEZpZWxkID0gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKFxuICogICB7XG4gKiAgICAgaWQ6ICd0ZWFtSWQnLFxuICogICAgIG5hbWU6ICd0ZWFtSWQnLFxuICogICAgIHR5cGU6ICdzdHJpbmcnLFxuICogICAgIHJlbGF0aW9uOiB7IHR5cGU6ICdvbmUnLCBlbnRpdHk6ICd0ZWFtJyB9XG4gKiAgIH0sXG4gKiAgICdjcmVhdGUnLFxuICogICBlbnRpdHlTZXJ2aWNlXG4gKiApO1xuICogLy8gUmV0dXJucyBmaWVsZCB3aXRoIHJlbGF0aW9uQ29uZmlnLCBmaWx0ZXJDb25maWcsIGFuZCBwcm9wZXIgZmllbGQgdHlwZVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoXG4gICAgdGhpc1Byb3A6IFRJT1NjaGVtYUF0dHJpYnV0ZSxcbiAgICB0eXBlOiAnY3JlYXRlJyB8ICd1cGRhdGUnIHwgJ2RldGFpbCcsXG4gICAgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PixcbiAgICBhbGxQcm9wZXJ0aWVzPzogVElPU2NoZW1hQXR0cmlidXRlW10sICAvLyBPcHRpb25hbDogZm9yIGRldGVjdGluZyBkdXBsaWNhdGVkIHJlbGF0aW9uIGZpZWxkc1xuICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sgJ3VpQ29uZmlnR2VuT3B0aW9ucycgXSAgLy8gT3B0aW9uYWw6IGdsb2JhbCBVSSBjb25maWcgb3B0aW9uc1xuKSB7XG4gICAgY29uc3QgZm9ybWF0dGVkOiBhbnkgPSB7XG4gICAgICAgIC4uLnRoaXNQcm9wLFxuICAgICAgICAvLyBVc2UgY3VzdG9tIGxhYmVsIGlmIHByb3ZpZGVkIGluIHNjaGVtYSAodGhpc1Byb3AubGFiZWwpLCBvdGhlcndpc2UgZm9ybWF0IHRoZSBuYW1lIHRvIGh1bWFuLXJlYWRhYmxlXG4gICAgICAgIGxhYmVsOiAodGhpc1Byb3AgYXMgYW55KS5sYWJlbCB8fCB0b0h1bWFuUmVhZGFibGVOYW1lKHRoaXNQcm9wLm5hbWUpLFxuICAgICAgICBjb2x1bW46IHRoaXNQcm9wLmlkLFxuICAgICAgICBmaWVsZFR5cGU6IHRoaXNQcm9wLmZpZWxkVHlwZSB8fCAndGV4dCcsICAvLyBmaWVsZFR5cGUgc2hvdWxkIGFscmVhZHkgYmUgaW5mZXJyZWQgaW4gYmFzZS1zZXJ2aWNlXG4gICAgICAgIGhpZGRlbjogdGhpc1Byb3AuaGFzT3duUHJvcGVydHkoJ2lzVmlzaWJsZScpICYmICF0aGlzUHJvcC5pc1Zpc2libGVcbiAgICB9O1xuXG4gICAgLy8gSGFuZGxlIGFkZE5ld09wdGlvbiAoT0xEIC0gZGVwcmVjYXRlZCwgZ2VuZXJhdGVzIGVtYmVkZGVkIGNvbmZpZykgb3IgYWRkTmV3T3B0aW9uQ29uZmlnIChORVcgLSBqdXN0IHBhc3MgdGhyb3VnaCByZWZlcmVuY2UpXG4gICAgaWYgKGlzU2VsZWN0RmllbGRNZXRhZGF0YSh0aGlzUHJvcCkgJiYgWyAnY3JlYXRlJywgJ3VwZGF0ZScgXS5pbmNsdWRlcyh0eXBlKSkge1xuICAgICAgICBjb25zdCBzZWxlY3RGaWVsZCA9IHRoaXNQcm9wIGFzIFNlbGVjdEZpZWxkTWV0YWRhdGE7XG5cbiAgICAgICAgaWYgKHNlbGVjdEZpZWxkLmFkZE5ld09wdGlvbkNvbmZpZykge1xuICAgICAgICAgICAgLy8gTkVXIFdBWTogVXNlciBwcm92aWRlZCBhZGROZXdPcHRpb25Db25maWcgcmVmZXJlbmNlIC0ganVzdCBwYXNzIGl0IHRocm91Z2hcbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ2FkZE5ld09wdGlvbkNvbmZpZycgXSA9IHNlbGVjdEZpZWxkLmFkZE5ld09wdGlvbkNvbmZpZztcblxuICAgICAgICB9IGVsc2UgaWYgKHNlbGVjdEZpZWxkLmFkZE5ld09wdGlvbikge1xuICAgICAgICAgICAgLy8gT0xEIFdBWSAoREVQUkVDQVRFRCk6IFRyYW5zZm9ybSBhZGROZXdPcHRpb24gdG8gYWRkTmV3T3B0aW9uQ29uZmlnIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG4gICAgICAgICAgICBjb25zdCB7IGVudGl0eU5hbWUsIG92ZXJyaWRlQ29uZmlnIH0gPSBzZWxlY3RGaWVsZC5hZGROZXdPcHRpb247XG5cbiAgICAgICAgICAgIGlmIChlbnRpdHlOYW1lICYmIGVudGl0eVNlcnZpY2UuaGFzRW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShlbnRpdHlOYW1lKSkge1xuICAgICAgICAgICAgICAgIGZvcm1hdHRlZFsgJ2FkZE5ld09wdGlvbkNvbmZpZycgXSA9IHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdjcmVhdGUnLFxuICAgICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzogb3ZlcnJpZGVDb25maWcgfHwge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3VibWl0U3VjY2Vzc1JlZGlyZWN0OiB1bmRlZmluZWQsICAvLyBTdGF5IGluIG1vZGFsIGFmdGVyIGNyZWF0aW9uXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3JtQnV0dG9uczogW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsgdGV4dDogXCJBZGRcIiwgYWN0aW9uOiBcInN1Ym1pdFwiIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgeyB0ZXh0OiBcIkNhbmNlbFwiLCBhY3Rpb246IFwiY2FuY2VsXCIgfVxuICAgICAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWw6IENvdWxkIG5vdCBmaW5kIHJlbGF0ZWQtZW50aXR5LXNlcnZpY2UgZm9yIGVudGl0eSBbJHtlbnRpdHlOYW1lfV0gaW4gJHtlbnRpdHlTZXJ2aWNlLmNvbnN0cnVjdG9yLm5hbWV9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBQYXNzIHF1aWNrQ3JlYXRlIFVYIGNvbmZpZyB0aHJvdWdoIHZlcmJhdGltICgjNDQpLlxuICAgICAgICAvLyB1aTI0IHVzZXMgaXQgdG8gc3VyZmFjZSBhIGNvbnRleHR1YWwgXCIrIENyZWF0ZSAnW3Rlcm1dJ1wiIGJ1dHRvbiBpbiB0aGVcbiAgICAgICAgLy8gZHJvcGRvd24gd2hlbiB0aGUgc2VhcmNoIHJldHVybnMgbm8gcmVzdWx0cy4gIFRoZSBlbnRpdHkgY3JlYXRlIGZvcm0gaXNcbiAgICAgICAgLy8gcmVzb2x2ZWQgZnJvbSBhZGROZXdPcHRpb25Db25maWcg4oCUIG5vdGhpbmcgaXMgZHVwbGljYXRlZCBoZXJlLlxuICAgICAgICBpZiAoc2VsZWN0RmllbGQucXVpY2tDcmVhdGUpIHtcbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ3F1aWNrQ3JlYXRlJyBdID0gc2VsZWN0RmllbGQucXVpY2tDcmVhdGU7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBSZXNvbHZlIFJlbGF0aW9uRW50aXR5T3B0aW9uQ29uZmlnIOKGkiBGaWVsZE9wdGlvbnNBUElDb25maWcgZm9yIHNlbGVjdCBmaWVsZHMgb24gZm9ybSBwYWdlc1xuICAgIGlmIChpc1NlbGVjdEZpZWxkTWV0YWRhdGEodGhpc1Byb3ApICYmIHRoaXNQcm9wLm9wdGlvbnNcbiAgICAgICAgJiYgdHlwZW9mIHRoaXNQcm9wLm9wdGlvbnMgPT09ICdvYmplY3QnICYmICFBcnJheS5pc0FycmF5KHRoaXNQcm9wLm9wdGlvbnMpXG4gICAgICAgICYmICdlbnRpdHlOYW1lJyBpbiB0aGlzUHJvcC5vcHRpb25zICYmIHRoaXNQcm9wLnJlbGF0aW9uXG4gICAgKSB7XG4gICAgICAgIGNvbnN0IHJlc29sdmVkID0gcmVzb2x2ZVJlbGF0aW9uT3B0aW9uQ29uZmlnKFxuICAgICAgICAgICAgdGhpc1Byb3Aub3B0aW9ucyBhcyBSZWxhdGlvbkVudGl0eU9wdGlvbkNvbmZpZyxcbiAgICAgICAgICAgIHRoaXNQcm9wIGFzIFRJT1NjaGVtYUF0dHJpYnV0ZSAmIHsgcmVsYXRpb246IE5vbk51bGxhYmxlPFRJT1NjaGVtYUF0dHJpYnV0ZVsgJ3JlbGF0aW9uJyBdPiB9LFxuICAgICAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9uc1xuICAgICAgICApO1xuICAgICAgICBpZiAocmVzb2x2ZWQpIHtcbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ29wdGlvbnMnIF0gPSByZXNvbHZlZDtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIEhhbmRsZSByZWxhdGlvbiBmaWVsZHMgKERBVEEgTEFZRVIgKyBVSSBMQVlFUilcbiAgICBpZiAodGhpc1Byb3AucmVsYXRpb24gJiYgdHlwZSA9PT0gJ2RldGFpbCcpIHtcbiAgICAgICAgY29uc3QgcmVsYXRpb24gPSB0aGlzUHJvcC5yZWxhdGlvbjtcbiAgICAgICAgY29uc3QgeyBlbnRpdHlOYW1lLCB0eXBlOiByZWxhdGlvblR5cGUsIGlkZW50aWZpZXJzIH0gPSByZWxhdGlvbjtcbiAgICAgICAgY29uc3QgZW50aXR5TmFtZUxvd2VyID0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpO1xuXG4gICAgICAgIGlmICghZW50aXR5U2VydmljZS5oYXNFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKGVudGl0eU5hbWUpKSB7XG4gICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbDogQ291bGQgbm90IGZpbmQgcmVsYXRlZC1lbnRpdHktc2VydmljZSBmb3IgZW50aXR5IFske2VudGl0eU5hbWV9XSBpbiAke2VudGl0eVNlcnZpY2UuY29uc3RydWN0b3IubmFtZX1gKTtcbiAgICAgICAgICAgIHJldHVybiBmb3JtYXR0ZWQ7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZXNvbHZlIGlkZW50aWZpZXJzIChjb3VsZCBiZSBkaXJlY3QgdmFsdWUgb3IgbGF6eSBmdW5jdGlvbilcbiAgICAgICAgY29uc3QgcmVzb2x2ZWRJZGVudGlmaWVycyA9IHR5cGVvZiBpZGVudGlmaWVycyA9PT0gJ2Z1bmN0aW9uJyA/IGlkZW50aWZpZXJzKCkgOiBpZGVudGlmaWVycztcblxuICAgICAgICAvLyBTYWZldHkgY2hlY2sgZm9yIGFycmF5IGlkZW50aWZpZXJzXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHJlc29sdmVkSWRlbnRpZmllcnMpKSB7XG4gICAgICAgICAgICBpZiAocmVzb2x2ZWRJZGVudGlmaWVycy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbDogRW1wdHkgaWRlbnRpZmllcnMgYXJyYXkgZm9yIHJlbGF0aW9uIFske2VudGl0eU5hbWV9XWApO1xuICAgICAgICAgICAgICAgIHJldHVybiBmb3JtYXR0ZWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBIYW5kbGUgYm90aCBzaW5nbGUgYW5kIG11bHRpcGxlIGlkZW50aWZpZXJzIGZvciBjb21wb3NpdGUga2V5c1xuICAgICAgICBjb25zdCBpZGVudGlmaWVyTWFwcGluZ3MgPSBBcnJheS5pc0FycmF5KHJlc29sdmVkSWRlbnRpZmllcnMpXG4gICAgICAgICAgICA/IHJlc29sdmVkSWRlbnRpZmllcnMubWFwKGlkID0+ICh7XG4gICAgICAgICAgICAgICAgc291cmNlOiBTdHJpbmcoaWQuc291cmNlKSxcbiAgICAgICAgICAgICAgICB0YXJnZXQ6IFN0cmluZyhpZC50YXJnZXQpXG4gICAgICAgICAgICB9KSlcbiAgICAgICAgICAgIDogWyB7XG4gICAgICAgICAgICAgICAgc291cmNlOiBTdHJpbmcocmVzb2x2ZWRJZGVudGlmaWVycy5zb3VyY2UpLFxuICAgICAgICAgICAgICAgIHRhcmdldDogU3RyaW5nKHJlc29sdmVkSWRlbnRpZmllcnMudGFyZ2V0KVxuICAgICAgICAgICAgfSBdO1xuXG4gICAgICAgIC8vIEZvciByb3V0ZSBwYXR0ZXJuIGFuZCBkZWZhdWx0IGZpbHRlcnMsIHVzZSB0aGUgZmlyc3QgaWRlbnRpZmllclxuICAgICAgICAvLyAobW9zdCBlbnRpdGllcyBoYXZlIHNpbmdsZSBpZGVudGlmaWVyOyBjb21wb3NpdGUga2V5cyBuZWVkIGV4cGxpY2l0IHJvdXRlUGF0dGVybilcbiAgICAgICAgY29uc3QgcHJpbWFyeUlkZW50aWZpZXIgPSBpZGVudGlmaWVyTWFwcGluZ3NbIDAgXTtcblxuICAgICAgICAvLyBDaGVjayBpZiB1c2VyIHByb3ZpZGVkIGN1c3RvbSBVSSBjb25maWcgaW4gcmVsYXRpb25Db25maWcgKG9wdGlvbmFsIG92ZXJyaWRlKVxuICAgICAgICBjb25zdCB1c2VyUmVsYXRpb25Db25maWcgPSB0aGlzUHJvcC5yZWxhdGlvbkNvbmZpZyBhcyBJUmVsYXRpb25GaWVsZENvbmZpZyB8IHVuZGVmaW5lZDtcblxuICAgICAgICAvLyBHZXQgcmVsYXRlZCBlbnRpdHkgc2VydmljZSBmb3IgbWV0YWRhdGEgKGljb24sIGV0Yy4pXG4gICAgICAgIGNvbnN0IHJlbGF0ZWRFbnRpdHlTZXJ2aWNlID0gZW50aXR5U2VydmljZS5oYXNFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKGVudGl0eU5hbWUpXG4gICAgICAgICAgICA/IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShlbnRpdHlOYW1lKVxuICAgICAgICAgICAgOiB1bmRlZmluZWQ7XG5cbiAgICAgICAgLy8gR2V0IGVudGl0eSBtZXRhZGF0YSBmb3IgaWNvbiBhbmQgZmFsbGJhY2sgZ2VuZXJhdGlvblxuICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5TWV0YWRhdGEgPSByZWxhdGVkRW50aXR5U2VydmljZT8uZ2V0RW50aXR5U2NoZW1hPy4oKS5tb2RlbDtcbiAgICAgICAgY29uc3QgZGVmYXVsdEljb24gPSByZWxhdGVkRW50aXR5TWV0YWRhdGE/Lm1ldGFkYXRhPy5pY29uO1xuXG4gICAgICAgIGlmIChyZWxhdGlvblR5cGUuZW5kc1dpdGgoJ3RvLW9uZScpKSB7XG4gICAgICAgICAgICAvLyBUTy1PTkU6IFNob3cgdmFsdWUgYXMgbGluayArIG1vZGFsIGljb25cbiAgICAgICAgICAgIC8vIFJvdXRlIHBhdHRlcm46IFVzZSBjdXN0b20gKGZyb20gcmVsYXRpb25Db25maWcpIG9yIGRlZmF1bHQgdG8gL3ZpZXcte2VudGl0eX0vOnRhcmdldElkXG4gICAgICAgICAgICBjb25zdCByb3V0ZVBhdHRlcm4gPSB1c2VyUmVsYXRpb25Db25maWc/LnJvdXRlUGF0dGVyblxuICAgICAgICAgICAgICAgIHx8IGAvdmlldy0ke2VudGl0eU5hbWVMb3dlcn0vOiR7cHJpbWFyeUlkZW50aWZpZXIudGFyZ2V0fWA7XG5cbiAgICAgICAgICAgIC8vIEdlbmVyYXRlIGZhbGxiYWNrIGNvbmZpZ3VyYXRpb24gZm9yIHdoZW4gb25seSBJRCBpcyBhdmFpbGFibGVcbiAgICAgICAgICAgIGNvbnN0IGZhbGxiYWNrQ29uZmlnID0gZ2VuZXJhdGVSZWxhdGlvbkZhbGxiYWNrKFxuICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgcHJpbWFyeUlkZW50aWZpZXIuc291cmNlLFxuICAgICAgICAgICAgICAgIHJlbGF0ZWRFbnRpdHlTZXJ2aWNlXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICAvLyBBdXRvLWRldGVjdCBkdXBsaWNhdGVkIHJlbGF0aW9uIGZpZWxkIChlLmcuLCB0ZWFtTmFtZSBmb3IgdGVhbUlkKVxuICAgICAgICAgICAgLy8gTkVXOiBVc2UgZW5oYW5jZWQgZGV0ZWN0aW9uIHdpdGggY29uZmlnIHN1cHBvcnRcbiAgICAgICAgICAgIGxldCBhdXRvVGVtcGxhdGU6IHN0cmluZyB8IHVuZGVmaW5lZCA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIGxldCBkZXRlY3Rpb25NZXRhZGF0YTogYW55ID0gdW5kZWZpbmVkO1xuXG4gICAgICAgICAgICAvLyBDaGVjayBpZiBhdXRvLWRldGVjdGlvbiBpcyBlbmFibGVkIChkZWZhdWx0OiB0cnVlKVxuICAgICAgICAgICAgY29uc3QgYXV0b0RldGVjdEVuYWJsZWQgPSB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmF1dG9EZXRlY3QgIT09IGZhbHNlO1xuXG4gICAgICAgICAgICBpZiAoYXV0b0RldGVjdEVuYWJsZWQgJiYgYWxsUHJvcGVydGllcykge1xuICAgICAgICAgICAgICAgIC8vIEdldCBnbG9iYWwgY29uZmlnIChwYXNzZWQgZnJvbSBmdzI0IGluaXRpYWxpemF0aW9uKVxuICAgICAgICAgICAgICAgIGNvbnN0IGdsb2JhbENvbmZpZyA9IGdsb2JhbFVJQ29uZmlnT3B0aW9ucz8uZHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uO1xuXG4gICAgICAgICAgICAgICAgLy8gR2V0IGVudGl0eS1sZXZlbCBjb25maWcgZnJvbSBlbnRpdHkgbWV0YWRhdGFcbiAgICAgICAgICAgICAgICBjb25zdCBlbnRpdHlDb25maWcgPSByZWxhdGVkRW50aXR5TWV0YWRhdGE/Lm1ldGFkYXRhPy5kdXBsaWNhdGVkRmllbGREZXRlY3Rpb247XG5cbiAgICAgICAgICAgICAgICAvLyBHZXQgcmVsYXRpb24tbGV2ZWwgaGludHNcbiAgICAgICAgICAgICAgICBjb25zdCByZWxhdGlvbkhpbnRzID0gdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5hdXRvRGV0ZWN0SGludHM7XG5cbiAgICAgICAgICAgICAgICAvLyBSdW4gZW5oYW5jZWQgZGV0ZWN0aW9uXG4gICAgICAgICAgICAgICAgY29uc3QgZGV0ZWN0aW9uUmVzdWx0ID0gZGV0ZWN0RHVwbGljYXRlZFJlbGF0aW9uRmllbGRzKFxuICAgICAgICAgICAgICAgICAgICBhbGxQcm9wZXJ0aWVzLFxuICAgICAgICAgICAgICAgICAgICB0aGlzUHJvcC5pZCxcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgZ2xvYmFsQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICBlbnRpdHlDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIHJlbGF0aW9uSGludHNcbiAgICAgICAgICAgICAgICApO1xuXG4gICAgICAgICAgICAgICAgaWYgKGRldGVjdGlvblJlc3VsdCkge1xuICAgICAgICAgICAgICAgICAgICBhdXRvVGVtcGxhdGUgPSBkZXRlY3Rpb25SZXN1bHQudGVtcGxhdGU7XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gU3RvcmUgbWV0YWRhdGEgZm9yIGRlYnVnZ2luZyBhbmQgZnV0dXJlIGZlYXR1cmVzXG4gICAgICAgICAgICAgICAgICAgIGRldGVjdGlvbk1ldGFkYXRhID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgZGV0ZWN0ZWRGaWVsZHM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcmltYXJ5OiBkZXRlY3Rpb25SZXN1bHQucHJpbWFyeUZpZWxkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFsdGVybmF0aXZlczogZGV0ZWN0aW9uUmVzdWx0LmRldGVjdGVkRmllbGRzLmRpc3BsYXk/LnNsaWNlKDEpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZpc3VhbDogZGV0ZWN0aW9uUmVzdWx0LmRldGVjdGVkRmllbGRzLnZpc3VhbCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZXRhOiBkZXRlY3Rpb25SZXN1bHQuZGV0ZWN0ZWRGaWVsZHMubWV0YVxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbmZpZGVuY2U6IGRldGVjdGlvblJlc3VsdC5jb25maWRlbmNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWV0aG9kOiBkZXRlY3Rpb25SZXN1bHQubWV0aG9kLFxuICAgICAgICAgICAgICAgICAgICAgICAgcGF0dGVybjogZGV0ZWN0aW9uUmVzdWx0LnBhdHRlcm5cbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnOiBJUmVsYXRpb25GaWVsZENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICByb3V0ZVBhdHRlcm46IHJvdXRlUGF0dGVybixcbiAgICAgICAgICAgICAgICAvLyBQYXNzIEFMTCBpZGVudGlmaWVyIG1hcHBpbmdzIChzdXBwb3J0cyBjb21wb3NpdGUga2V5cylcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyTWFwcGluZzogaWRlbnRpZmllck1hcHBpbmdzLmxlbmd0aCA9PT0gMVxuICAgICAgICAgICAgICAgICAgICA/IGlkZW50aWZpZXJNYXBwaW5nc1sgMCBdICAvLyBTaW5nbGU6IHJldHVybiBvYmplY3RcbiAgICAgICAgICAgICAgICAgICAgOiBpZGVudGlmaWVyTWFwcGluZ3MsICAgICAvLyBNdWx0aXBsZTogcmV0dXJuIGFycmF5XG4gICAgICAgICAgICAgICAgbW9kYWxDb25maWdSZWY6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxDb25maWdSZWYgfHwge1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ3ZpZXcnLFxuICAgICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge31cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIG1vZGFsV2lkdGg6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxXaWR0aCxcbiAgICAgICAgICAgICAgICBtb2RhbFRpdGxlOiB1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsVGl0bGUsXG4gICAgICAgICAgICAgICAgZGlzcGxheUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAvLyBQcmlvcml0eTogVXNlciBjdXN0b20gdGVtcGxhdGUgPiBBdXRvLWRldGVjdGVkIGR1cGxpY2F0ZWQgZmllbGQgPiB1bmRlZmluZWQgKHVzZSBmYWxsYmFjaylcbiAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGU6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8udGVtcGxhdGUgfHwgYXV0b1RlbXBsYXRlLFxuICAgICAgICAgICAgICAgICAgICAvLyBTbWFydCBmYWxsYmFjayBwcmUtZ2VuZXJhdGVkIGZyb20gZW50aXR5IG1ldGFkYXRhXG4gICAgICAgICAgICAgICAgICAgIGZhbGxiYWNrOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmZhbGxiYWNrIHx8IGZhbGxiYWNrQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICAvLyBJY29uIGZyb20gZW50aXR5IG1ldGFkYXRhIG9yIHVzZXIgb3ZlcnJpZGVcbiAgICAgICAgICAgICAgICAgICAgaWNvbjogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5pY29uIHx8IGRlZmF1bHRJY29uIHx8ICdFeWVPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgICAgIHNob3dNb2RhbEljb246IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uc2hvd01vZGFsSWNvbiAhPT0gZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgIHNob3dMaW5rOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnNob3dMaW5rICE9PSBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgLy8gUGFzcyB0aHJvdWdoIGF1dG9EZXRlY3QgYW5kIGF1dG9EZXRlY3RIaW50c1xuICAgICAgICAgICAgICAgICAgICBhdXRvRGV0ZWN0OiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmF1dG9EZXRlY3QsXG4gICAgICAgICAgICAgICAgICAgIGF1dG9EZXRlY3RIaW50czogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5hdXRvRGV0ZWN0SGludHMsXG4gICAgICAgICAgICAgICAgICAgIC8vIFBhc3MgdGhyb3VnaCBhbnkgY3VzdG9tIGFjdGlvbnNcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5hY3Rpb25zLFxuICAgICAgICAgICAgICAgICAgICAvLyBQYXNzIHRocm91Z2ggcHJldmlldyBjb25maWcgZm9yIFJlbGF0ZWQgUmVjb3JkIFBlZWsgKCMxMDMpXG4gICAgICAgICAgICAgICAgICAgIC4uLih1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnByZXZpZXcgJiYgeyBwcmV2aWV3OiB1c2VyUmVsYXRpb25Db25maWcuZGlzcGxheUNvbmZpZy5wcmV2aWV3IH0pXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGlmIChnbG9iYWxVSUNvbmZpZ09wdGlvbnM/LmR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbj8uZGVidWcpIHtcbiAgICAgICAgICAgICAgICBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZy5kaXNwbGF5Q29uZmlnIVsgJ19kZXRlY3Rpb25NZXRhZGF0YScgXSA9IGRldGVjdGlvbk1ldGFkYXRhO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdyZWxhdGlvbkNvbmZpZycgXSA9IGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnO1xuXG4gICAgICAgICAgICAvLyBCYWNrd2FyZCBjb21wYXRpYmlsaXR5OiBLZWVwIGlzTGluayBhbmQgbGlua0NvbmZpZ1xuICAgICAgICAgICAgZm9ybWF0dGVkWyAnaXNMaW5rJyBdID0gdHJ1ZTtcbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ2xpbmtDb25maWcnIF0gPSB7XG4gICAgICAgICAgICAgICAgcm91dGVQYXR0ZXJuOiByb3V0ZVBhdHRlcm5cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgfSBlbHNlIGlmIChyZWxhdGlvblR5cGUuZW5kc1dpdGgoJ3RvLW1hbnknKSkge1xuICAgICAgICAgICAgLy8gVE8tTUFOWTogU2hvdyBjb3VudCArIG1vZGFsIGljb24gKG9wZW5zIGZpbHRlcmVkIGxpc3QpXG4gICAgICAgICAgICAvLyBSb3V0ZSBwYXR0ZXJuOiBVc2UgY3VzdG9tIChmcm9tIHJlbGF0aW9uQ29uZmlnKSBvciBkZWZhdWx0IHRvIC9saXN0LXtlbnRpdHl9XG4gICAgICAgICAgICBjb25zdCByb3V0ZVBhdHRlcm4gPSB1c2VyUmVsYXRpb25Db25maWc/LnJvdXRlUGF0dGVyblxuICAgICAgICAgICAgICAgIHx8IGAvbGlzdC0ke2VudGl0eU5hbWVMb3dlcn1gO1xuXG4gICAgICAgICAgICAvLyBCdWlsZCBkZWZhdWx0IGZpbHRlcnMgdG8gc2hvdyBvbmx5IHJlbGF0ZWQgaXRlbXNcbiAgICAgICAgICAgIC8vIEZvciBleGFtcGxlLCBpZiB3ZSdyZSB2aWV3aW5nIGEgVGVhbSBhbmQgdGhpcyBmaWVsZCBzaG93cyBHYW1lcyxcbiAgICAgICAgICAgIC8vIHdlIHdhbnQgdG8gZmlsdGVyIGdhbWVzIHdoZXJlIHRlYW1JZCA9IGN1cnJlbnQgdGVhbSdzIElEXG4gICAgICAgICAgICAvLyBGb3IgY29tcG9zaXRlIGtleXMsIGFkZCBhbGwgaWRlbnRpZmllcnMgYXMgZmlsdGVyc1xuICAgICAgICAgICAgY29uc3QgZGVmYXVsdEZpbHRlcnM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICAgICAgICAgIGlkZW50aWZpZXJNYXBwaW5ncy5mb3JFYWNoKG1hcHBpbmcgPT4ge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzWyBtYXBwaW5nLnRhcmdldCBdID0gYDoke21hcHBpbmcuc291cmNlfWA7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gR2VuZXJhdGUgZmFsbGJhY2sgY29uZmlndXJhdGlvbiBmb3IgdG8tbWFueSAoc2hvd3MgY291bnQpXG4gICAgICAgICAgICBjb25zdCBmYWxsYmFja0NvbmZpZyA9IGdlbmVyYXRlUmVsYXRpb25GYWxsYmFjayhcbiAgICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgIHByaW1hcnlJZGVudGlmaWVyLnNvdXJjZSxcbiAgICAgICAgICAgICAgICByZWxhdGVkRW50aXR5U2VydmljZVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgY29uc3QgZ2VuZXJhdGVkUmVsYXRpb25Db25maWc6IElSZWxhdGlvbkZpZWxkQ29uZmlnID0ge1xuICAgICAgICAgICAgICAgIHJvdXRlUGF0dGVybjogcm91dGVQYXR0ZXJuLFxuICAgICAgICAgICAgICAgIC8vIFBhc3MgQUxMIGlkZW50aWZpZXIgbWFwcGluZ3MgKHN1cHBvcnRzIGNvbXBvc2l0ZSBrZXlzKVxuICAgICAgICAgICAgICAgIGlkZW50aWZpZXJNYXBwaW5nOiBpZGVudGlmaWVyTWFwcGluZ3MubGVuZ3RoID09PSAxXG4gICAgICAgICAgICAgICAgICAgID8gaWRlbnRpZmllck1hcHBpbmdzWyAwIF0gIC8vIFNpbmdsZTogcmV0dXJuIG9iamVjdFxuICAgICAgICAgICAgICAgICAgICA6IGlkZW50aWZpZXJNYXBwaW5ncywgICAgIC8vIE11bHRpcGxlOiByZXR1cm4gYXJyYXlcbiAgICAgICAgICAgICAgICBtb2RhbENvbmZpZ1JlZjogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbENvbmZpZ1JlZiB8fCB7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAnbGlzdCcsXG4gICAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczogZGVmYXVsdEZpbHRlcnNcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgbW9kYWxXaWR0aDogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbFdpZHRoLFxuICAgICAgICAgICAgICAgIG1vZGFsVGl0bGU6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxUaXRsZSxcbiAgICAgICAgICAgICAgICBkaXNwbGF5Q29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZXIgY2FuIG92ZXJyaWRlIHdpdGggY3VzdG9tIHRlbXBsYXRlXG4gICAgICAgICAgICAgICAgICAgIHRlbXBsYXRlOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnRlbXBsYXRlLFxuICAgICAgICAgICAgICAgICAgICAvLyBTbWFydCBmYWxsYmFjayBwcmUtZ2VuZXJhdGVkIGZyb20gZW50aXR5IG1ldGFkYXRhXG4gICAgICAgICAgICAgICAgICAgIGZhbGxiYWNrOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmZhbGxiYWNrIHx8IGZhbGxiYWNrQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICAvLyBJY29uIGZyb20gZW50aXR5IG1ldGFkYXRhIG9yIHVzZXIgb3ZlcnJpZGVcbiAgICAgICAgICAgICAgICAgICAgaWNvbjogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5pY29uIHx8IGRlZmF1bHRJY29uIHx8ICdVbm9yZGVyZWRMaXN0T3V0bGluZWQnLFxuICAgICAgICAgICAgICAgICAgICBzaG93TW9kYWxJY29uOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnNob3dNb2RhbEljb24gIT09IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICBzaG93TGluazogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5zaG93TGluayAhPT0gdHJ1ZSwgLy8gRGVmYXVsdCBmYWxzZSBmb3IgdG8tbWFueVxuICAgICAgICAgICAgICAgICAgICAvLyBQYXNzIHRocm91Z2ggYW55IGN1c3RvbSBhY3Rpb25zXG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uYWN0aW9uc1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIC8vIElmIHVzZXIgcHJvdmlkZWQgY3VzdG9tIG1vZGFsQ29uZmlnUmVmLCBtZXJnZSBkZWZhdWx0IGZpbHRlcnMgd2l0aCB0aGVpciBvdmVycmlkZXNcbiAgICAgICAgICAgIGlmICh1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsQ29uZmlnUmVmPy5vdmVycmlkZUNvbmZpZykge1xuICAgICAgICAgICAgICAgIGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnLm1vZGFsQ29uZmlnUmVmIS5vdmVycmlkZUNvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICAgICAgLi4udXNlclJlbGF0aW9uQ29uZmlnLm1vZGFsQ29uZmlnUmVmLm92ZXJyaWRlQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgLi4uZGVmYXVsdEZpbHRlcnMsXG4gICAgICAgICAgICAgICAgICAgICAgICAuLi4odXNlclJlbGF0aW9uQ29uZmlnLm1vZGFsQ29uZmlnUmVmLm92ZXJyaWRlQ29uZmlnLmRlZmF1bHRGaWx0ZXJzIHx8IHt9KVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZm9ybWF0dGVkWyAncmVsYXRpb25Db25maWcnIF0gPSBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZztcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIEhhbmRsZSBuZXN0ZWQgc3RydWN0dXJlcyAobWFwIGFuZCBsaXN0IHR5cGVzKVxuICAgIGlmICh0aGlzUHJvcC50eXBlID09PSAnbWFwJyAmJiB0aGlzUHJvcC5wcm9wZXJ0aWVzKSB7XG4gICAgICAgIGZvcm1hdHRlZFsgJ3Byb3BlcnRpZXMnIF0gPSBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRm9ybU9yRGV0YWlsKHRoaXNQcm9wLnByb3BlcnRpZXMsIHR5cGUsIGVudGl0eVNlcnZpY2UpO1xuICAgIH0gZWxzZSBpZiAodGhpc1Byb3AudHlwZSA9PT0gJ2xpc3QnKSB7XG4gICAgICAgIC8vIEZvciBsaXN0IHR5cGVzLCBjaGVjayBpZiBpdGVtcyBhcmUgbWFwcyAobmVzdGVkIHN0cnVjdHVyZXMpXG4gICAgICAgIC8vIE5vdGU6IGl0ZW1zIHByb3BlcnR5IGV4aXN0cyBvbiBsaXN0LXR5cGUgYXR0cmlidXRlcyBidXQgbm90IGluIGJhc2UgRW50aXR5QXR0cmlidXRlIHR5cGVcbiAgICAgICAgY29uc3QgZXh0ZW5kZWRQcm9wID0gdGhpc1Byb3AgYXMgVElPU2NoZW1hQXR0cmlidXRlICYgeyBpdGVtcz86IHsgdHlwZTogc3RyaW5nOyBwcm9wZXJ0aWVzPzogVElPU2NoZW1hQXR0cmlidXRlW10gfSB9O1xuICAgICAgICBpZiAoZXh0ZW5kZWRQcm9wLml0ZW1zPy50eXBlID09PSAnbWFwJyAmJiBleHRlbmRlZFByb3AuaXRlbXMucHJvcGVydGllcykge1xuICAgICAgICAgICAgZm9ybWF0dGVkWyAnaXRlbXMnIF0gPSB7XG4gICAgICAgICAgICAgICAgLi4uZm9ybWF0dGVkWyAnaXRlbXMnIF0sXG4gICAgICAgICAgICAgICAgcHJvcGVydGllczogZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckZvcm1PckRldGFpbChleHRlbmRlZFByb3AuaXRlbXMucHJvcGVydGllcywgdHlwZSwgZW50aXR5U2VydmljZSlcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZm9ybWF0dGVkO1xufVxuXG4vKipcbiAqIFJvdXRlcyBhdHRyaWJ1dGUgZm9ybWF0dGluZyB0byB0aGUgYXBwcm9wcmlhdGUgdHlwZS1zcGVjaWZpYyBmb3JtYXR0ZXIuXG4gKiBcbiAqIENvbnZlbmllbmNlIGZ1bmN0aW9uIHRoYXQgZGVsZWdhdGVzIHRvIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JDcmVhdGUsXG4gKiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yVXBkYXRlLCBvciBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRGV0YWlsIGJhc2VkIG9uIHR5cGUuXG4gKiBcbiAqIEBwYXJhbSBwcm9wZXJ0aWVzIC0gQXJyYXkgb2YgZW50aXR5IGF0dHJpYnV0ZXMgdG8gZm9ybWF0XG4gKiBAcGFyYW0gdHlwZSAtIFBhZ2UgdHlwZTogJ2NyZWF0ZScsICd1cGRhdGUnLCBvciAnZGV0YWlsJ1xuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSBmb3IgYWNjZXNzaW5nIHNjaGVtYXNcbiAqIEByZXR1cm5zIEFycmF5IG9mIGZvcm1hdHRlZCBmaWVsZCBtZXRhZGF0YVxuICogQHRocm93cyBFcnJvciBpZiBpbnZhbGlkIHR5cGUgaXMgcHJvdmlkZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JGb3JtT3JEZXRhaWwoXG4gICAgcHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sXG4gICAgdHlwZTogJ2NyZWF0ZScgfCAndXBkYXRlJyB8ICdkZXRhaWwnLFxuICAgIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT5cbikge1xuXG4gICAgaWYgKHR5cGUgPT09ICdjcmVhdGUnKSB7XG4gICAgICAgIHJldHVybiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yQ3JlYXRlKHByb3BlcnRpZXMsIGVudGl0eVNlcnZpY2UpO1xuICAgIH1cblxuICAgIGlmICh0eXBlID09PSAndXBkYXRlJykge1xuICAgICAgICByZXR1cm4gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvclVwZGF0ZShwcm9wZXJ0aWVzLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICB9XG5cbiAgICBpZiAodHlwZSA9PT0gJ2RldGFpbCcpIHtcbiAgICAgICAgcmV0dXJuIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JEZXRhaWwocHJvcGVydGllcywgZW50aXR5U2VydmljZSk7XG4gICAgfVxuICAgIHRocm93IChgSW52YWxpZCB0eXBlIFske3R5cGV9XSBwcm92aWRlZCB0byBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRm9ybU9yRGV0YWlsYCk7XG59XG5cbi8qKlxuICogRXhwYW5kcyBzaG9ydGhhbmQgZmllbGQgcmVmZXJlbmNlcyBpbnRvIGZ1bGwgUHJvcGVydHlDb25maWcgb2JqZWN0cy5cbiAqIFxuICogKipFbnRlcnByaXNlLUdyYWRlIFBhdHRlcm4gU3VwcG9ydGluZzoqKlxuICogXG4gKiAxLiAqKlN0cmluZyBzaG9ydGhhbmQgKHNjaGVtYSBmaWVsZHMgb25seSk6KiogYCdmaWVsZE5hbWUnYCDihpIgbG9va3MgdXAgaW4gc2NoZW1hLCBleHBhbmRzIHRvIGZ1bGwgY29uZmlnXG4gKiAyLiAqKk9iamVjdCB3aXRoIHNjaGVtYSBmaWVsZDoqKiBgeyBuYW1lOiAnc3RhdHVzJywgZmllbGRUeXBlOiAnYmFkZ2UnIH1gIOKGkiBtZXJnZXMgb3ZlcnJpZGVzIHdpdGggc2NoZW1hIGRlZmF1bHRzXG4gKiAzLiAqKkpTT04gcGF0aCAobmVzdGVkIGRhdGEpOioqIGB7IG5hbWU6ICd1c2VyRW1haWwnLCBjb2x1bW46ICd1c2VyLmVtYWlsJywgbGFiZWw6ICdFbWFpbCcsIGZpZWxkVHlwZTogJ3RleHQnIH1gXG4gKiA0LiAqKk11bHRpcGxlIHJlbmRlcmluZ3M6KiogYHsgbmFtZTogJ3N0YXR1c0JhZGdlJywgY29sdW1uOiAnc3RhdHVzJywgZmllbGRUeXBlOiAnYmFkZ2UnIH1gICsgYHsgbmFtZTogJ3N0YXR1c1RleHQnLCBjb2x1bW46ICdzdGF0dXMnLCBmaWVsZFR5cGU6ICd0ZXh0JyB9YFxuICogNS4gKipDdXN0b20vY29tcHV0ZWQgZmllbGRzOioqIGB7IG5hbWU6ICdjb25maXJtUGFzc3dvcmQnLCBsYWJlbDogJ0NvbmZpcm0nLCBjb2x1bW46ICdjb25maXJtUGFzc3dvcmQnLCBmaWVsZFR5cGU6ICdwYXNzd29yZCcgfWBcbiAqIDYuICoqVmlzaWJpbGl0eSBjb250cm9sOioqIEFsbCBjb25maWdzIHN1cHBvcnQgYHZpc2liaWxpdHk6IENvbmRpdGlvbmAgZm9yIHJvbGUtYmFzZWQvY29uZGl0aW9uYWwgZGlzcGxheVxuICogXG4gKiAqKktleSBDb25jZXB0czoqKlxuICogLSBgbmFtZWA6IFVuaXF1ZSBVSSBpZGVudGlmaWVyIChtdXN0IGJlIHVuaXF1ZSB3aXRoaW4gYSBzaW5nbGUgcHJvcGVydGllc0NvbmZpZylcbiAqIC0gYGNvbHVtbmA6IERhdGEgcGF0aCAtIGNhbiBiZSBkaXJlY3QgZmllbGQsIEpTT04gcGF0aCAoYHVzZXIuZW1haWxgKSwgb3IgY3VzdG9tIGZpZWxkXG4gKiAtIEZyb250ZW5kIHVzZXMgYGdldE5lc3RlZFZhbHVlKHJlY29yZCwgY29sdW1uKWAgZm9yIGRhdGEgYWNjZXNzIChzdXBwb3J0cyBKU09OIHBhdGhzKVxuICogXG4gKiBUaGlzIGlzIHRoZSBwcm9wZXJ0eSBlcXVpdmFsZW50IG9mIGBub3JtYWxpemVDb2x1bW5PdmVycmlkZXMoKWAuXG4gKiBcbiAqIEBwYXJhbSBmaWVsZFJlZmVyZW5jZXMgLSBBcnJheSBjb250YWluaW5nIHN0cmluZ3MgKGZpZWxkIG5hbWVzKSBvciBQcm9wZXJ0eUNvbmZpZyBvYmplY3RzXG4gKiBAcGFyYW0gYWxsUHJvcGVydGllcyAtIEFsbCBlbnRpdHkgYXR0cmlidXRlcyBmcm9tIHNjaGVtYSBmb3IgZmllbGQgbG9va3VwXG4gKiBAcGFyYW0gdHlwZSAtIFBhZ2UgdHlwZTogJ2NyZWF0ZScsICd1cGRhdGUnLCBvciAnZGV0YWlsJyAoZGV0ZXJtaW5lcyBmb3JtYXR0aW5nKVxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSBmb3IgYWNjZXNzaW5nIHJlbGF0ZWQgc2NoZW1hc1xuICogQHBhcmFtIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyAtIE9wdGlvbmFsIGdsb2JhbCBVSSBjb25maWd1cmF0aW9uIG9wdGlvbnNcbiAqIEByZXR1cm5zIEFycmF5IG9mIGZ1bGwgUHJvcGVydHlDb25maWcgb2JqZWN0c1xuICogXG4gKiBAZXhhbXBsZVxuICogLy8gMS4gU3RyaW5nIHNob3J0aGFuZCAoc2NoZW1hIGZpZWxkcyBvbmx5KVxuICogcHJvcGVydGllc0NvbmZpZzogWyd0ZWFtTmFtZScsICdjaXR5JywgJ3N0YXR1cyddXG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyAyLiBPdmVycmlkZSBzY2hlbWEgZmllbGQgZGlzcGxheVxuICogcHJvcGVydGllc0NvbmZpZzogW1xuICogICAndGVhbU5hbWUnLFxuICogICB7IG5hbWU6ICdzdGF0dXMnLCBmaWVsZFR5cGU6ICdiYWRnZScgfSwgIC8vIFNhbWUgZmllbGQsIGRpZmZlcmVudCByZW5kZXJpbmdcbiAqICAgJ3RvdGFsJ1xuICogXVxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gMy4gTXVsdGlwbGUgcmVuZGVyaW5ncyBvZiBzYW1lIGZpZWxkXG4gKiBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gKiAgIHsgbmFtZTogJ3Byb2dyZXNzQmFyJywgY29sdW1uOiAncHJvZ3Jlc3MnLCBsYWJlbDogJ1Byb2dyZXNzJywgZmllbGRUeXBlOiAncHJvZ3Jlc3MnIH0sXG4gKiAgIHsgbmFtZTogJ3Byb2dyZXNzVmFsdWUnLCBjb2x1bW46ICdwcm9ncmVzcycsIGxhYmVsOiAnVmFsdWUnLCBmaWVsZFR5cGU6ICdudW1iZXInIH1cbiAqIF1cbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIDQuIEpTT04gcGF0aHMgKG5lc3RlZCBkYXRhKVxuICogcHJvcGVydGllc0NvbmZpZzogW1xuICogICAndGVhbU5hbWUnLFxuICogICB7IG5hbWU6ICd1c2VyRW1haWwnLCBjb2x1bW46ICd1c2VyLmVtYWlsJywgbGFiZWw6ICdFbWFpbCcsIGZpZWxkVHlwZTogJ3RleHQnIH0sXG4gKiAgIHsgbmFtZTogJ3NldHRpbmdzVGhlbWUnLCBjb2x1bW46ICdtZXRhZGF0YS5zZXR0aW5ncy50aGVtZScsIGxhYmVsOiAnVGhlbWUnLCBmaWVsZFR5cGU6ICd0ZXh0JyB9XG4gKiBdXG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyA1LiBDdXN0b20vY29tcHV0ZWQgZmllbGRzIChub3QgaW4gc2NoZW1hLCBBUEkgcHJvdmlkZXMgdGhlbSlcbiAqIHByb3BlcnRpZXNDb25maWc6IFtcbiAqICAgJ3Bhc3N3b3JkJyxcbiAqICAge1xuICogICAgIG5hbWU6ICdjb25maXJtUGFzc3dvcmQnLFxuICogICAgIGxhYmVsOiAnQ29uZmlybSBQYXNzd29yZCcsXG4gKiAgICAgY29sdW1uOiAnY29uZmlybVBhc3N3b3JkJyxcbiAqICAgICBmaWVsZFR5cGU6ICdwYXNzd29yZCcsXG4gKiAgICAgcmVxdWlyZWQ6IHRydWVcbiAqICAgfVxuICogXVxuICogXG4gKiBAZXhhbXBsZVxuICogLy8gNi4gV2l0aCB2aXNpYmlsaXR5IGNvbmZpZ1xuICogcHJvcGVydGllc0NvbmZpZzogW1xuICogICAndGVhbU5hbWUnLFxuICogICB7XG4gKiAgICAgbmFtZTogJ2FkbWluTm90ZXMnLFxuICogICAgIGxhYmVsOiAnQWRtaW4gTm90ZXMnLFxuICogICAgIGNvbHVtbjogJ2FkbWluTm90ZXMnLFxuICogICAgIGZpZWxkVHlwZTogJ3RleHRhcmVhJyxcbiAqICAgICB2aXNpYmlsaXR5OiB7IGFjdG9yOiB7IGdyb3VwczogeyBpbkxpc3Q6IFsnYWRtaW4nXSB9IH0gfVxuICogICB9XG4gKiBdXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHBhbmRQcm9wZXJ0eVJlZmVyZW5jZXMoXG4gICAgZmllbGRSZWZlcmVuY2VzOiBSZWFkb25seUFycmF5PHN0cmluZyB8IGFueT4gfCBBcnJheTxzdHJpbmcgfCBhbnk+LFxuICAgIGFsbFByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLFxuICAgIHR5cGU6ICdjcmVhdGUnIHwgJ3VwZGF0ZScgfCAnZGV0YWlsJyxcbiAgICBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+LFxuICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sgJ3VpQ29uZmlnR2VuT3B0aW9ucycgXVxuKTogYW55W10ge1xuICAgIGNvbnN0IHByb3BlcnR5TWFwID0gbmV3IE1hcDxzdHJpbmcsIFRJT1NjaGVtYUF0dHJpYnV0ZT4oKTtcbiAgICBhbGxQcm9wZXJ0aWVzLmZvckVhY2gocHJvcCA9PiB7XG4gICAgICAgIGlmIChwcm9wLmlkKSB7IC8vIFVzZSBwcm9wLmlkIChmaWVsZCBpZGVudGlmaWVyKSBub3QgcHJvcC5uYW1lIChodW1hbi1yZWFkYWJsZSBsYWJlbClcbiAgICAgICAgICAgIHByb3BlcnR5TWFwLnNldChwcm9wLmlkLCBwcm9wKTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGZpZWxkUmVmZXJlbmNlcy5tYXAocHJvcFJlZiA9PiB7XG4gICAgICAgIC8vIENhc2UgMTogU3RyaW5nIHNob3J0aGFuZCDihpIgTVVTVCBiZSBhIGRpcmVjdCBzY2hlbWEgZmllbGQgKGNvbnZlbmllbmNlIHNob3J0Y3V0KVxuICAgICAgICBpZiAodHlwZW9mIHByb3BSZWYgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICBjb25zdCBmaWVsZEF0dHJpYnV0ZSA9IHByb3BlcnR5TWFwLmdldChwcm9wUmVmKTtcbiAgICAgICAgICAgIGlmICghZmllbGRBdHRyaWJ1dGUpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgICAgICAgIGBGaWVsZCAnJHtwcm9wUmVmfScgbm90IGZvdW5kIGluIGVudGl0eSBzY2hlbWEuIGAgK1xuICAgICAgICAgICAgICAgICAgICBgQXZhaWxhYmxlIGZpZWxkIElEczogJHtBcnJheS5mcm9tKHByb3BlcnR5TWFwLmtleXMoKSkuam9pbignLCAnKX0uIGAgK1xuICAgICAgICAgICAgICAgICAgICBgXFxuRm9yIG5vbi1zY2hlbWEgZmllbGRzIChKU09OIHBhdGhzLCBjdXN0b20gZmllbGRzLCBtdWx0aXBsZSByZW5kZXJpbmdzKSwgdXNlIG9iamVjdCBzeW50YXg6XFxuYCArXG4gICAgICAgICAgICAgICAgICAgIGAgIHsgbmFtZTogJ3VuaXF1ZU5hbWUnLCBjb2x1bW46ICcke3Byb3BSZWZ9JywgbGFiZWw6ICcuLi4nLCBmaWVsZFR5cGU6ICcuLi4nIH1gXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoZmllbGRBdHRyaWJ1dGUsIHR5cGUsIGVudGl0eVNlcnZpY2UsIGFsbFByb3BlcnRpZXMsIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDYXNlIDItNTogT2JqZWN0IHN5bnRheCAocGVybWlzc2l2ZSAtIHN1cHBvcnRzIGV2ZXJ5dGhpbmcpXG4gICAgICAgIGlmICh0eXBlb2YgcHJvcFJlZiA9PT0gJ29iamVjdCcgJiYgcHJvcFJlZiAhPT0gbnVsbCkge1xuICAgICAgICAgICAgLy8gVmFsaWRhdGUgbWluaW11bSByZXF1aXJlZCBwcm9wZXJ0aWVzXG4gICAgICAgICAgICBpZiAoIXByb3BSZWYubmFtZSkge1xuICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgUHJvcGVydHkgY29uZmlnIG1pc3NpbmcgJ25hbWUnIGZpZWxkIChyZXF1aXJlZCBmb3IgVUkgaWRlbnRpZmljYXRpb24pLiBTa2lwcGluZzpgLCBwcm9wUmVmKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gcHJvcFJlZjsgLy8gUmV0dXJuIGFzLWlzLCBsZXQgZnJvbnRlbmQgaGFuZGxlXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIERldGVybWluZSB0aGUgZGF0YSBwYXRoIChjb2x1bW4gY2FuIGJlOiBkaXJlY3QgZmllbGQsIEpTT04gcGF0aCwgb3IgY3VzdG9tIGZpZWxkKVxuICAgICAgICAgICAgY29uc3QgY29sdW1uID0gcHJvcFJlZi5jb2x1bW4gfHwgcHJvcFJlZi5uYW1lO1xuXG4gICAgICAgICAgICAvLyBFeHRyYWN0IGp1c3QgdGhlIHJvb3QgZmllbGQgbmFtZSBmb3Igc2NoZW1hIGxvb2t1cCAoaGFuZGxlcyBKU09OIHBhdGhzIGxpa2UgXCJ1c2VyLmVtYWlsXCIg4oaSIFwidXNlclwiKVxuICAgICAgICAgICAgY29uc3Qgcm9vdEZpZWxkTmFtZSA9IGNvbHVtbi5zcGxpdCgnLicpWyAwIF07XG4gICAgICAgICAgICBjb25zdCBmaWVsZEF0dHJpYnV0ZSA9IHByb3BlcnR5TWFwLmdldChyb290RmllbGROYW1lKTtcblxuICAgICAgICAgICAgLy8gSWYgcm9vdCBmaWVsZCBleGlzdHMgaW4gc2NoZW1hIEFORCBjb2x1bW4gaXMgdGhlIGV4YWN0IGZpZWxkIChub3QgYSBwYXRoKSwgbWVyZ2Ugd2l0aCBzY2hlbWFcbiAgICAgICAgICAgIGlmIChmaWVsZEF0dHJpYnV0ZSAmJiBjb2x1bW4gPT09IHJvb3RGaWVsZE5hbWUpIHtcbiAgICAgICAgICAgICAgICAvLyBTY2hlbWEgZmllbGQgd2l0aCBvdmVycmlkZXMgLSBtZXJnZSBkZWZhdWx0cyArIG92ZXJyaWRlc1xuICAgICAgICAgICAgICAgIGNvbnN0IHNjaGVtYURlZmF1bHRzID0gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKGZpZWxkQXR0cmlidXRlLCB0eXBlLCBlbnRpdHlTZXJ2aWNlLCBhbGxQcm9wZXJ0aWVzLCBnbG9iYWxVSUNvbmZpZ09wdGlvbnMpO1xuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIC4uLnNjaGVtYURlZmF1bHRzLFxuICAgICAgICAgICAgICAgICAgICAuLi5wcm9wUmVmLCAgLy8gVXNlciBvdmVycmlkZXMgdGFrZSBwcmVjZWRlbmNlXG4gICAgICAgICAgICAgICAgICAgIGNvbHVtbiAgLy8gRW5zdXJlIGNvbHVtbiBpcyBzZXRcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBPdGhlcndpc2U6IEpTT04gcGF0aCwgY3VzdG9tIGZpZWxkLCBvciBtdWx0aXBsZSByZW5kZXJpbmcgb2Ygc2FtZSBmaWVsZFxuICAgICAgICAgICAgLy8gQXV0by1nZW5lcmF0ZSBtaXNzaW5nIHByb3BlcnRpZXMgd2l0aCBwcm9wZXIgZm9ybWF0dGluZ1xuICAgICAgICAgICAgY29uc3QgbGFiZWwgPSBwcm9wUmVmLmxhYmVsIHx8IHRvSHVtYW5SZWFkYWJsZU5hbWUocHJvcFJlZi5uYW1lKTtcbiAgICAgICAgICAgIGNvbnN0IGZpZWxkVHlwZSA9IHByb3BSZWYuZmllbGRUeXBlIHx8ICd0ZXh0JztcblxuICAgICAgICAgICAgLy8gV2FybiBpZiBsYWJlbCB3YXMgYXV0by1nZW5lcmF0ZWRcbiAgICAgICAgICAgIGlmICghcHJvcFJlZi5sYWJlbCkge1xuICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIuZGVidWcoXG4gICAgICAgICAgICAgICAgICAgIGBQcm9wZXJ0eSAnJHtwcm9wUmVmLm5hbWV9JyBtaXNzaW5nICdsYWJlbCcuIEF1dG8tZ2VuZXJhdGVkOiAnJHtsYWJlbH0nLiBgICtcbiAgICAgICAgICAgICAgICAgICAgYEZvciBjdXN0b20gZmllbGRzLCBleHBsaWNpdGx5IHByb3ZpZGU6IG5hbWUsIGxhYmVsLCBjb2x1bW4sIGZpZWxkVHlwZS5gXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghcHJvcFJlZi5maWVsZFR5cGUpIHtcbiAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLmRlYnVnKFxuICAgICAgICAgICAgICAgICAgICBgUHJvcGVydHkgJyR7cHJvcFJlZi5uYW1lfScgbWlzc2luZyAnZmllbGRUeXBlJy4gRGVmYXVsdGVkIHRvICd0ZXh0Jy4gYCArXG4gICAgICAgICAgICAgICAgICAgIGBSZWNvbW1lbmRlZCBmaWVsZCB0eXBlczogdGV4dCwgbnVtYmVyLCBzZWxlY3QsIGJhZGdlLCBwcm9ncmVzcywgZXRjLmBcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBSZXR1cm4gd2l0aCBwcm9wZXIgZm9ybWF0dGluZ1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAuLi5wcm9wUmVmLFxuICAgICAgICAgICAgICAgIGNvbHVtbixcbiAgICAgICAgICAgICAgICBsYWJlbCxcbiAgICAgICAgICAgICAgICBmaWVsZFR5cGVcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGYWxsYmFjazogdW5rbm93biB0eXBlLCByZXR1cm4gYXMtaXMgd2l0aCB3YXJuaW5nXG4gICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgVW5rbm93biBwcm9wZXJ0eSByZWZlcmVuY2UgdHlwZTpgLCBwcm9wUmVmKTtcbiAgICAgICAgcmV0dXJuIHByb3BSZWY7XG4gICAgfSk7XG59XG5cbi8qKlxuICogUHJvY2Vzc2VzIHNlY3Rpb25zQ29uZmlnIGFuZCBleHBhbmRzIGFueSBzaG9ydGhhbmQgcHJvcGVydGllc0NvbmZpZyBhcnJheXMuXG4gKiBcbiAqICoqVW5pZmllZCB3aXRoIGNvbHVtbiBwcm9jZXNzaW5nOioqXG4gKiAtIFVzZXMgYGV4cGFuZFByb3BlcnR5UmVmZXJlbmNlcygpYCAoc2FtZSBwYXR0ZXJuIGFzIGBub3JtYWxpemVDb2x1bW5PdmVycmlkZXMoKWApXG4gKiAtIFN0cmluZyBzaG9ydGhhbmQgYCdmaWVsZE5hbWUnYCDihpIgZXhwYW5kcyBmcm9tIHNjaGVtYVxuICogLSBPYmplY3Qgc3ludGF4IOKGkiBtZXJnZXMgd2l0aCBzY2hlbWEgZGVmYXVsdHNcbiAqIFxuICogUmVjdXJzaXZlbHkgd2Fsa3MgdGhyb3VnaCBzZWN0aW9uIGdyb3VwcyBhbmQgc2VjdGlvbnMuXG4gKiBcbiAqIEBwYXJhbSBzZWN0aW9uc0NvbmZpZyAtIFNlY3Rpb25zIGNvbmZpZ3VyYXRpb24gZnJvbSBlbnRpdHkgc2NoZW1hXG4gKiBAcGFyYW0gYWxsUHJvcGVydGllcyAtIEFsbCBlbnRpdHkgYXR0cmlidXRlcyBmcm9tIHNjaGVtYSBmb3IgZmllbGQgbG9va3VwXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIGZvciBhY2Nlc3NpbmcgcmVsYXRlZCBzY2hlbWFzXG4gKiBAcGFyYW0gZ2xvYmFsVUlDb25maWdPcHRpb25zIC0gT3B0aW9uYWwgZ2xvYmFsIFVJIGNvbmZpZ3VyYXRpb24gb3B0aW9uc1xuICogQHJldHVybnMgUHJvY2Vzc2VkIHNlY3Rpb25zIGNvbmZpZyB3aXRoIGV4cGFuZGVkIHByb3BlcnRpZXNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHByb2Nlc3NTZWN0aW9uc0NvbmZpZyhcbiAgICBzZWN0aW9uc0NvbmZpZzogYW55LFxuICAgIGFsbFByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLFxuICAgIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sXG4gICAgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyAndWlDb25maWdHZW5PcHRpb25zJyBdLFxuICAgIC8qKiBXaGVuIHNldCwgbmVzdGVkIGRldGFpbC9mb3JtIGZpZWxkIHJvd3MgcmVjZWl2ZSB0aGUgc2FtZSBkaXNwbGF5T3ZlcnJpZGUgbWVyZ2UgYXMgcm9vdCBwYWdlcy4gKi9cbiAgICBkaXNwbGF5T3ZlcnJpZGVzPzogRGlzcGxheU92ZXJyaWRlc1VJQ29uZmlnXG4pOiBhbnkge1xuICAgIGlmICghc2VjdGlvbnNDb25maWcpIHJldHVybiBzZWN0aW9uc0NvbmZpZztcblxuICAgIGNvbnN0IHByb2Nlc3NlZCA9IHsgLi4uc2VjdGlvbnNDb25maWcgfTtcblxuICAgIC8vIFByb2Nlc3Mgc2VjdGlvbnMgaW4gc2luZ2xlIGdyb3VwIGZvcm1hdCAoYmFja3dhcmQgY29tcGF0aWJsZSlcbiAgICBpZiAocHJvY2Vzc2VkLnNlY3Rpb25zKSB7XG4gICAgICAgIHByb2Nlc3NlZC5zZWN0aW9ucyA9IE9iamVjdC5lbnRyaWVzKHByb2Nlc3NlZC5zZWN0aW9ucykucmVkdWNlKChhY2MsIFsga2V5LCBzZWN0aW9uIF06IFsgc3RyaW5nLCBhbnkgXSkgPT4ge1xuICAgICAgICAgICAgYWNjWyBrZXkgXSA9IHByb2Nlc3NTZWN0aW9uQ29uZmlnKHNlY3Rpb24sIGFsbFByb3BlcnRpZXMsIGVudGl0eVNlcnZpY2UsIGdsb2JhbFVJQ29uZmlnT3B0aW9ucywgZGlzcGxheU92ZXJyaWRlcyk7XG4gICAgICAgICAgICByZXR1cm4gYWNjO1xuICAgICAgICB9LCB7fSBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+KTtcbiAgICB9XG5cbiAgICAvLyBQcm9jZXNzIHNlY3Rpb24gZ3JvdXBzIChuZXcgZm9ybWF0KVxuICAgIGlmIChwcm9jZXNzZWQuc2VjdGlvbkdyb3Vwcykge1xuICAgICAgICBwcm9jZXNzZWQuc2VjdGlvbkdyb3VwcyA9IHByb2Nlc3NlZC5zZWN0aW9uR3JvdXBzLm1hcCgoZ3JvdXA6IGFueSkgPT4ge1xuICAgICAgICAgICAgaWYgKCFncm91cC5zZWN0aW9ucykgcmV0dXJuIGdyb3VwO1xuXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIC4uLmdyb3VwLFxuICAgICAgICAgICAgICAgIHNlY3Rpb25zOiBPYmplY3QuZW50cmllcyhncm91cC5zZWN0aW9ucykucmVkdWNlKChhY2MsIFsga2V5LCBzZWN0aW9uIF06IFsgc3RyaW5nLCBhbnkgXSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBhY2NbIGtleSBdID0gcHJvY2Vzc1NlY3Rpb25Db25maWcoc2VjdGlvbiwgYWxsUHJvcGVydGllcywgZW50aXR5U2VydmljZSwgZ2xvYmFsVUlDb25maWdPcHRpb25zLCBkaXNwbGF5T3ZlcnJpZGVzKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGFjYztcbiAgICAgICAgICAgICAgICB9LCB7fSBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+KVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHByb2Nlc3NlZDtcbn1cblxuLyoqXG4gKiBQcm9jZXNzZXMgYSBzaW5nbGUgc2VjdGlvbiBjb25maWcgYW5kIGV4cGFuZHMgc2hvcnRoYW5kIHByb3BlcnRpZXNDb25maWcuXG4gKiBcbiAqIFVzZXMgdW5pZmllZCBgZXhwYW5kUHJvcGVydHlSZWZlcmVuY2VzKClgIGZ1bmN0aW9uLlxuICogXG4gKiBAcGFyYW0gc2VjdGlvbiAtIFNlY3Rpb24gY29uZmlndXJhdGlvblxuICogQHBhcmFtIGFsbFByb3BlcnRpZXMgLSBBbGwgZW50aXR5IGF0dHJpYnV0ZXMgZnJvbSBzY2hlbWFcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gRW50aXR5IHNlcnZpY2VcbiAqIEBwYXJhbSBnbG9iYWxVSUNvbmZpZ09wdGlvbnMgLSBPcHRpb25hbCBnbG9iYWwgVUkgY29uZmlndXJhdGlvbiBvcHRpb25zXG4gKiBAcmV0dXJucyBQcm9jZXNzZWQgc2VjdGlvbiB3aXRoIGV4cGFuZGVkIHByb3BlcnRpZXNcbiAqL1xuZnVuY3Rpb24gcHJvY2Vzc1NlY3Rpb25Db25maWcoXG4gICAgc2VjdGlvbjogYW55LFxuICAgIGFsbFByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLFxuICAgIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sXG4gICAgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyAndWlDb25maWdHZW5PcHRpb25zJyBdLFxuICAgIGRpc3BsYXlPdmVycmlkZXM/OiBEaXNwbGF5T3ZlcnJpZGVzVUlDb25maWdcbik6IGFueSB7XG4gICAgY29uc3QgcHJvY2Vzc2VkID0geyAuLi5zZWN0aW9uIH07XG5cbiAgICAvLyBQcm9jZXNzIGRldGFpbHNQYWdlQ29uZmlnIHdpdGggcHJvcGVydGllc0NvbmZpZ1xuICAgIGlmIChwcm9jZXNzZWQucGFnZVR5cGUgPT09ICdkZXRhaWxzJyAmJiBwcm9jZXNzZWQuZGV0YWlsc1BhZ2VDb25maWc/LnByb3BlcnRpZXNDb25maWcpIHtcbiAgICAgICAgY29uc3QgY29uZmlnID0gcHJvY2Vzc2VkLmRldGFpbHNQYWdlQ29uZmlnO1xuICAgICAgICBsZXQgcHJvcGVydGllc0NvbmZpZyA9IGV4cGFuZFByb3BlcnR5UmVmZXJlbmNlcyhcbiAgICAgICAgICAgIGNvbmZpZy5wcm9wZXJ0aWVzQ29uZmlnLFxuICAgICAgICAgICAgYWxsUHJvcGVydGllcyxcbiAgICAgICAgICAgICdkZXRhaWwnLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9uc1xuICAgICAgICApO1xuICAgICAgICBpZiAoZGlzcGxheU92ZXJyaWRlcykge1xuICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZyA9IG1lcmdlRGlzcGxheU92ZXJyaWRlRmllbGRDb25maWdJbnRvUHJvcGVydGllcyhwcm9wZXJ0aWVzQ29uZmlnLCBkaXNwbGF5T3ZlcnJpZGVzKTtcbiAgICAgICAgfVxuICAgICAgICBwcm9jZXNzZWQuZGV0YWlsc1BhZ2VDb25maWcgPSB7XG4gICAgICAgICAgICAuLi5jb25maWcsXG4gICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnLFxuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vIFByb2Nlc3MgZm9ybVBhZ2VDb25maWdcbiAgICBpZiAocHJvY2Vzc2VkLnBhZ2VUeXBlID09PSAnZm9ybScgJiYgcHJvY2Vzc2VkLmZvcm1QYWdlQ29uZmlnPy5wcm9wZXJ0aWVzQ29uZmlnKSB7XG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IHByb2Nlc3NlZC5mb3JtUGFnZUNvbmZpZztcbiAgICAgICAgLy8gRm9ybXMgaW4gc2VjdGlvbnMgYXJlIHR5cGljYWxseSAnY3JlYXRlJyBmb3Jtc1xuICAgICAgICBsZXQgcHJvcGVydGllc0NvbmZpZyA9IGV4cGFuZFByb3BlcnR5UmVmZXJlbmNlcyhcbiAgICAgICAgICAgIGNvbmZpZy5wcm9wZXJ0aWVzQ29uZmlnLFxuICAgICAgICAgICAgYWxsUHJvcGVydGllcyxcbiAgICAgICAgICAgICdjcmVhdGUnLFxuICAgICAgICAgICAgZW50aXR5U2VydmljZSxcbiAgICAgICAgICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9uc1xuICAgICAgICApO1xuICAgICAgICBpZiAoZGlzcGxheU92ZXJyaWRlcykge1xuICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZyA9IG1lcmdlRGlzcGxheU92ZXJyaWRlRmllbGRDb25maWdJbnRvUHJvcGVydGllcyhwcm9wZXJ0aWVzQ29uZmlnLCBkaXNwbGF5T3ZlcnJpZGVzKTtcbiAgICAgICAgICAgIHByb3BlcnRpZXNDb25maWcgPSBhcHBseURpc3BsYXlPdmVycmlkZVN0b3JhZ2VGaWVsZEZvcm1EZWZhdWx0cyhwcm9wZXJ0aWVzQ29uZmlnLCBkaXNwbGF5T3ZlcnJpZGVzKTtcbiAgICAgICAgfVxuICAgICAgICBwcm9jZXNzZWQuZm9ybVBhZ2VDb25maWcgPSB7XG4gICAgICAgICAgICAuLi5jb25maWcsXG4gICAgICAgICAgICBwcm9wZXJ0aWVzQ29uZmlnLFxuICAgICAgICB9O1xuICAgIH1cblxuICAgIHJldHVybiBwcm9jZXNzZWQ7XG59XG5cbi8qKlxuICogRm9ybWF0cyBlbnRpdHkgYXR0cmlidXRlcyBmb3IgY3JlYXRlIGZvcm0gcGFnZXMuXG4gKiBcbiAqIEZpbHRlcnMgYXR0cmlidXRlcyB0byBpbmNsdWRlIG9ubHkgY3JlYXRhYmxlIGZpZWxkcyAocmVzcGVjdHMgaXNDcmVhdGFibGUgZmxhZylcbiAqIGFuZCBmb3JtYXRzIGVhY2ggZm9yIGNyZWF0ZSBmb3JtIGRpc3BsYXkuXG4gKiBcbiAqIEBwYXJhbSBwcm9wZXJ0aWVzIC0gQXJyYXkgb2YgZW50aXR5IGF0dHJpYnV0ZXMgZnJvbSBzY2hlbWFcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gRW50aXR5IHNlcnZpY2UgZm9yIGFjY2Vzc2luZyByZWxhdGVkIHNjaGVtYXNcbiAqIEBwYXJhbSBnbG9iYWxVSUNvbmZpZ09wdGlvbnMgLSBPcHRpb25hbCBnbG9iYWwgVUkgY29uZmlndXJhdGlvbiBvcHRpb25zXG4gKiBAcmV0dXJucyBBcnJheSBvZiBmb3JtYXR0ZWQgZmllbGQgbWV0YWRhdGEgZm9yIGNyZWF0ZSBmb3Jtc1xuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckNyZWF0ZShwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSwgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PiwgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyAndWlDb25maWdHZW5PcHRpb25zJyBdKSB7XG4gICAgcmV0dXJuIHByb3BlcnRpZXNcbiAgICAgICAgLmZpbHRlcihwcm9wID0+IHByb3AgJiYgKCFwcm9wLmhhc093blByb3BlcnR5KCdpc0NyZWF0YWJsZScpIHx8IHByb3AuaXNDcmVhdGFibGUpKVxuICAgICAgICAubWFwKChhdHQpID0+IGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbChhdHQsICdjcmVhdGUnLCBlbnRpdHlTZXJ2aWNlLCBwcm9wZXJ0aWVzLCBnbG9iYWxVSUNvbmZpZ09wdGlvbnMpKTtcbn1cblxuLyoqXG4gKiBGb3JtYXRzIGVudGl0eSBhdHRyaWJ1dGVzIGZvciB1cGRhdGUvZWRpdCBmb3JtIHBhZ2VzLlxuICogXG4gKiBGaWx0ZXJzIGF0dHJpYnV0ZXMgdG8gaW5jbHVkZSBvbmx5IGVkaXRhYmxlIGZpZWxkcyAocmVzcGVjdHMgaXNFZGl0YWJsZSBmbGFnKVxuICogYW5kIGZvcm1hdHMgZWFjaCBmb3IgdXBkYXRlIGZvcm0gZGlzcGxheS5cbiAqIFxuICogQHBhcmFtIHByb3BlcnRpZXMgLSBBcnJheSBvZiBlbnRpdHkgYXR0cmlidXRlcyBmcm9tIHNjaGVtYVxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSBmb3IgYWNjZXNzaW5nIHJlbGF0ZWQgc2NoZW1hc1xuICogQHBhcmFtIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyAtIE9wdGlvbmFsIGdsb2JhbCBVSSBjb25maWd1cmF0aW9uIG9wdGlvbnNcbiAqIEByZXR1cm5zIEFycmF5IG9mIGZvcm1hdHRlZCBmaWVsZCBtZXRhZGF0YSBmb3IgdXBkYXRlIGZvcm1zXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yVXBkYXRlKHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLCBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+LCBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbICd1aUNvbmZpZ0dlbk9wdGlvbnMnIF0pIHtcbiAgICByZXR1cm4gcHJvcGVydGllc1xuICAgICAgICAuZmlsdGVyKHByb3AgPT4gcHJvcCAmJiAoIXByb3AuaGFzT3duUHJvcGVydHkoJ2lzRWRpdGFibGUnKSB8fCBwcm9wLmlzRWRpdGFibGUpKVxuICAgICAgICAubWFwKChhdHQpID0+IGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbChhdHQsICd1cGRhdGUnLCBlbnRpdHlTZXJ2aWNlLCBwcm9wZXJ0aWVzLCBnbG9iYWxVSUNvbmZpZ09wdGlvbnMpKTtcbn1cblxuLyoqXG4gKiBGb3JtYXRzIGVudGl0eSBhdHRyaWJ1dGVzIGZvciBkZXRhaWwvdmlldyBwYWdlcy5cbiAqIFxuICogRmlsdGVycyBhdHRyaWJ1dGVzIHRvIGluY2x1ZGUgb25seSB2aXNpYmxlIGZpZWxkcyAocmVzcGVjdHMgaXNWaXNpYmxlIGZsYWcpXG4gKiBhbmQgZm9ybWF0cyBlYWNoIGZvciBkZXRhaWwgcGFnZSBkaXNwbGF5LlxuICogXG4gKiBAcGFyYW0gcHJvcGVydGllcyAtIEFycmF5IG9mIGVudGl0eSBhdHRyaWJ1dGVzIGZyb20gc2NoZW1hXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIGZvciBhY2Nlc3NpbmcgcmVsYXRlZCBzY2hlbWFzXG4gKiBAcGFyYW0gZ2xvYmFsVUlDb25maWdPcHRpb25zIC0gT3B0aW9uYWwgZ2xvYmFsIFVJIGNvbmZpZ3VyYXRpb24gb3B0aW9uc1xuICogQHJldHVybnMgQXJyYXkgb2YgZm9ybWF0dGVkIGZpZWxkIG1ldGFkYXRhIGZvciBkZXRhaWwgdmlld3NcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JEZXRhaWwocHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sgJ3VpQ29uZmlnR2VuT3B0aW9ucycgXSkge1xuICAgIHJldHVybiBwcm9wZXJ0aWVzXG4gICAgICAgIC5maWx0ZXIocHJvcCA9PiBwcm9wICYmICghcHJvcC5oYXNPd25Qcm9wZXJ0eSgnaXNWaXNpYmxlJykgfHwgcHJvcC5pc1Zpc2libGUpKVxuICAgICAgICAubWFwKChhdHQpID0+IGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbChhdHQsICdkZXRhaWwnLCBlbnRpdHlTZXJ2aWNlLCBwcm9wZXJ0aWVzLCBnbG9iYWxVSUNvbmZpZ09wdGlvbnMpKTtcbn1cblxuLyoqXG4gKiBUeXBlIGRlZmluaXRpb24gZm9yIGxpc3QvdGFibGUgY29sdW1uIGNvbmZpZ3VyYXRpb24uXG4gKiBcbiAqIEV4dGVuZHMgRmllbGRNZXRhZGF0YSB3aXRoIGxpc3Qtc3BlY2lmaWMgcHJvcGVydGllcyBsaWtlIGFjdGlvbnMsIHRlbXBsYXRlcyxcbiAqIGFuZCByZWxhdGlvbiByZW5kZXJpbmcgY29uZmlndXJhdGlvbnMuXG4gKi9cbmV4cG9ydCB0eXBlIExpc3RpbmdQcm9wQ29uZmlnID0gUGljazxGaWVsZE1ldGFkYXRhLCAnZmllbGRUeXBlJyB8ICdwbGFjZWhvbGRlcicgfCAnaGVscFRleHQnIHwgJ2ZpbHRlckNvbmZpZyc+ICYge1xuICAgIG5hbWU6IHN0cmluZyxcbiAgICBkYXRhSW5kZXg6IHN0cmluZyxcbiAgICBoaWRkZW4/OiBib29sZWFuLFxuICAgIGFjdGlvbnM/OiBBcnJheTxJRW50aXR5UGFnZUFjdGlvbj4sXG4gICAgcmVsYXRpb25Db25maWc/OiBJUmVsYXRpb25GaWVsZENvbmZpZywgIC8vIEZvciByZW5kZXJpbmcgcmVsYXRpb25zIHdpdGggbGlua3MvbW9kYWxzXG4gICAgdGVtcGxhdGU/OiBUZW1wbGF0ZSwgIC8vIEZvciB0ZW1wbGF0ZS1iYXNlZCByZW5kZXJpbmdcbiAgICBpc0lkZW50aWZpZXI/OiBib29sZWFuLCAgLy8gRm9yIGlkZW50aWZpZXIgZmllbGRzXG4gICAgLyoqIEBkZXByZWNhdGVkIE9wdGlvbmFsIC0gcHJlc2VuY2Ugb2YgbGlua0NvbmZpZyBpcyBzdWZmaWNpZW50ICovXG4gICAgaXNMaW5rPzogYm9vbGVhbiwgIC8vIEZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG4gICAgbGlua0NvbmZpZz86IHsgcm91dGVQYXR0ZXJuOiBzdHJpbmc7IGRpc3BsYXlUZXh0PzogVGVtcGxhdGUgfSwgIC8vIEZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5IC0gc3VwcG9ydHMgdGVtcGxhdGVzXG59O1xuXG4vKipcbiAqIEZvcm1hdHMgZW50aXR5IGF0dHJpYnV0ZXMgZm9yIGxpc3QvdGFibGUgZGlzcGxheS5cbiAqIFxuICogVHJhbnNmb3JtcyBzY2hlbWEgYXR0cmlidXRlcyBpbnRvIHRhYmxlIGNvbHVtbiBjb25maWd1cmF0aW9ucyB3aXRoOlxuICogLSBBdXRvLWdlbmVyYXRlZCBmaWx0ZXIgY29uZmlndXJhdGlvbnMgZm9yIGZpbHRlcmFibGUgY29sdW1uc1xuICogLSBSZWxhdGlvbiBkaXNwbGF5IGNvbmZpZ3VyYXRpb25zIHdpdGggbGlua3MgYW5kIG1vZGFsIHN1cHBvcnRcbiAqIC0gVGVtcGxhdGUtYmFzZWQgcmVuZGVyaW5nIGZvciBkdXBsaWNhdGVkIHJlbGF0aW9uIGZpZWxkc1xuICogLSBQcm9wZXIgZmllbGQgdHlwZXMgYW5kIHZpc2liaWxpdHkgaGFuZGxpbmdcbiAqIFxuICogVGhpcyBpcyB0aGUgbWFpbiBlbnRyeSBwb2ludCBmb3IgZ2VuZXJhdGluZyB0YWJsZSBjb2x1bW4gY29uZmlndXJhdGlvbnMgZnJvbSBlbnRpdHkgc2NoZW1hcy5cbiAqIFxuICogQHBhcmFtIGVudGl0eU5hbWUgLSBOYW1lIG9mIHRoZSBlbnRpdHkgKGZvciBnZW5lcmF0aW5nIHJvdXRlIHBhdHRlcm5zKVxuICogQHBhcmFtIHByb3BlcnRpZXMgLSBBcnJheSBvZiBlbnRpdHkgYXR0cmlidXRlcyBmcm9tIHNjaGVtYVxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSBmb3IgYWNjZXNzaW5nIHJlbGF0ZWQgc2NoZW1hc1xuICogQHBhcmFtIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyAtIE9wdGlvbmFsIGdsb2JhbCBVSSBjb25maWd1cmF0aW9uIG9wdGlvbnNcbiAqIEByZXR1cm5zIEFycmF5IG9mIGZvcm1hdHRlZCBjb2x1bW4gY29uZmlndXJhdGlvbnMgZm9yIHRhYmxlIGRpc3BsYXlcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IGNvbHVtbnMgPSBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yTGlzdChcbiAqICAgJ2dhbWUnLFxuICogICBnYW1lU2NoZW1hLmF0dHJpYnV0ZXMsXG4gKiAgIGdhbWVTZXJ2aWNlLFxuICogICBnbG9iYWxDb25maWdcbiAqICk7XG4gKiAvLyBSZXR1cm5zIGFycmF5IG9mIGNvbHVtbiBjb25maWdzIHdpdGggZmlsdGVycywgcmVsYXRpb25zLCBhbmQgdGVtcGxhdGVzXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JMaXN0KFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSxcbiAgICBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+LFxuICAgIHtcbiAgICAgICAgQ1JVREFwaVBhdGgsXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGUsXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZWxldGUsXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZXRhaWwsXG4gICAgICAgIGN1c3RvbVJvd0FjdGlvbnMsXG4gICAgICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9uc1xuICAgIH06IHtcbiAgICAgICAgQ1JVREFwaVBhdGg/OiBzdHJpbmcsXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5VcGRhdGU/OiBib29sZWFuLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluRGVsZXRlPzogYm9vbGVhbixcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pbkRldGFpbD86IGJvb2xlYW4sXG4gICAgICAgIGN1c3RvbVJvd0FjdGlvbnM/OiBSZWFkb25seUFycmF5PElFbnRpdHlQYWdlQWN0aW9uPiB8IEFycmF5PElFbnRpdHlQYWdlQWN0aW9uPixcbiAgICAgICAgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyAndWlDb25maWdHZW5PcHRpb25zJyBdICAvLyBORVc6IEdsb2JhbCBjb25maWcgb3B0aW9uc1xuICAgIH1cbikge1xuXG4gICAgY29uc3QgZW50aXR5TmFtZUxvd2VyID0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IGVudGl0eU5hbWVQYXNjYWxDYXNlID0gcGFzY2FsQ2FzZShlbnRpdHlOYW1lKTtcblxuICAgIHJldHVybiBwcm9wZXJ0aWVzXG4gICAgICAgIC5maWx0ZXIocHJvcCA9PiBwcm9wICYmIHByb3AuaXNMaXN0YWJsZSlcbiAgICAgICAgLm1hcChwcm9wID0+IHtcbiAgICAgICAgICAgIC8vIFVzZSBzYW1lIGZvcm1hdHRpbmcgbG9naWMgYXMgZGV0YWlscy9mb3JtcyAoaW5jbHVkZXMgcmVsYXRpb25Db25maWcgZ2VuZXJhdGlvbilcbiAgICAgICAgICAgIC8vIFBhc3MgYWxsIHByb3BlcnRpZXMgc28gaXQgY2FuIGRldGVjdCBkdXBsaWNhdGVkIHJlbGF0aW9uIGZpZWxkcyAoZS5nLiwgdGVhbU5hbWUgZm9yIHRlYW1JZClcbiAgICAgICAgICAgIGNvbnN0IGZvcm1hdHRlZCA9IGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbChwcm9wLCAnZGV0YWlsJywgZW50aXR5U2VydmljZSwgcHJvcGVydGllcywgZ2xvYmFsVUlDb25maWdPcHRpb25zKTtcblxuICAgICAgICAgICAgLy8gQXV0by1nZW5lcmF0ZSBmaWx0ZXJDb25maWcgaWYgbm90IGFscmVhZHkgcHJlc2VudCBhbmQgZmllbGQgaXMgZmlsdGVyYWJsZVxuICAgICAgICAgICAgY29uc3QgYXV0b0dlbmVyYXRlZEZpbHRlckNvbmZpZyA9ICFmb3JtYXR0ZWQuZmlsdGVyQ29uZmlnICYmIHByb3AuaXNGaWx0ZXJhYmxlICE9PSBmYWxzZVxuICAgICAgICAgICAgICAgID8gZ2VuZXJhdGVGaWx0ZXJDb25maWcocHJvcCwgZW50aXR5U2VydmljZSwgZ2xvYmFsVUlDb25maWdPcHRpb25zKVxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkO1xuXG4gICAgICAgICAgICAvLyBPdmVycmlkZS9hZGQgbGlzdC1zcGVjaWZpYyBwcm9wZXJ0aWVzXG4gICAgICAgICAgICBjb25zdCBwcm9wQ29uZmlnOiBMaXN0aW5nUHJvcENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICAuLi5mb3JtYXR0ZWQsXG4gICAgICAgICAgICAgICAgbmFtZTogZm9ybWF0dGVkLmxhYmVsIHx8IGZvcm1hdHRlZC5uYW1lLCAgLy8gRW5zdXJlIG5hbWUgaXMgc2V0IGZvciB0YWJsZSBjb2x1bW4gaGVhZGVyXG4gICAgICAgICAgICAgICAgZGF0YUluZGV4OiBgJHtwcm9wLmlkfWAsXG4gICAgICAgICAgICAgICAgZmllbGRUeXBlOiBmb3JtYXR0ZWQuZmllbGRUeXBlIHx8ICd0ZXh0JyxcbiAgICAgICAgICAgICAgICBmaWx0ZXJDb25maWc6IGZvcm1hdHRlZC5maWx0ZXJDb25maWcgfHwgYXV0b0dlbmVyYXRlZEZpbHRlckNvbmZpZywgIC8vIFVzZSBleHBsaWNpdCBvciBhdXRvLWdlbmVyYXRlZFxuICAgICAgICAgICAgICAgIGhpZGRlbjogcHJvcC5oYXNPd25Qcm9wZXJ0eSgnaXNWaXNpYmxlJykgJiYgIXByb3AuaXNWaXNpYmxlXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBpZiAocHJvcC5pc0lkZW50aWZpZXIpIHtcbiAgICAgICAgICAgICAgICAvLyBCdWlsZCBkZWZhdWx0IHJvdyBhY3Rpb25zIHdpdGggSURzXG4gICAgICAgICAgICAgICAgY29uc3QgZGVmYXVsdEFjdGlvbnM6IEFycmF5PElFbnRpdHlQYWdlQWN0aW9uPiA9IFtdO1xuXG4gICAgICAgICAgICAgICAgaWYgKCFleGNsdWRlRnJvbUFkbWluRGV0YWlsKSB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRBY3Rpb25zLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgaWQ6ICd2aWV3JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb246ICd2aWV3JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnVmlldycsXG4gICAgICAgICAgICAgICAgICAgICAgICB0ZW1wbGF0ZTogYFZpZXcgeyR7cHJvcC5pZH19YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybDogYC92aWV3LSR7ZW50aXR5TmFtZUxvd2VyfWBcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKCFleGNsdWRlRnJvbUFkbWluVXBkYXRlKSB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRBY3Rpb25zLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgaWQ6ICdlZGl0JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb246ICdlZGl0JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnRWRpdCcsXG4gICAgICAgICAgICAgICAgICAgICAgICB0ZW1wbGF0ZTogYEVkaXQgeyR7cHJvcC5pZH19YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybDogYC9lZGl0LSR7ZW50aXR5TmFtZUxvd2VyfWBcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKCFleGNsdWRlRnJvbUFkbWluRGVsZXRlKSB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRBY3Rpb25zLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgaWQ6ICdkZWxldGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbjogJ2RlbGV0ZScsXG4gICAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0RlbGV0ZScsXG4gICAgICAgICAgICAgICAgICAgICAgICB0ZW1wbGF0ZTogYERlbGV0ZSB7JHtwcm9wLmlkfX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgb3BlbkluTW9kYWw6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBtb2RhbENvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGFsVHlwZTogJ2NvbmZpcm0nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGFsUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aXRsZTogYERlbGV0ZSAke2VudGl0eU5hbWVQYXNjYWxDYXNlfT9gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50OiBgQXJlIHlvdSBzdXJlIHlvdSB3YW50IHRvIGRlbGV0ZSB0aGlzICR7ZW50aXR5TmFtZVBhc2NhbENhc2V9PyBUaGlzIGFjdGlvbiBjYW5ub3QgYmUgdW5kb25lLmBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFwaUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhcGlNZXRob2Q6IGBERUxFVEVgLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXNwb25zZUtleTogZW50aXR5TmFtZUxvd2VyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhcGlVcmw6IGAke0NSVURBcGlQYXRoID8gQ1JVREFwaVBhdGggOiAnJ30vJHtlbnRpdHlOYW1lTG93ZXJ9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3NNZXNzYWdlOiBgJHtlbnRpdHlOYW1lUGFzY2FsQ2FzZX0gZGVsZXRlZCBzdWNjZXNzZnVsbHlgLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yTWVzc2FnZTogYEZhaWxlZCB0byBkZWxldGUgJHtlbnRpdHlOYW1lUGFzY2FsQ2FzZX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1Ym1pdFN1Y2Nlc3NSZWRpcmVjdDogYC9saXN0LSR7ZW50aXR5TmFtZUxvd2VyfWBcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gTWVyZ2UgY3VzdG9tIHJvdyBhY3Rpb25zIHVzaW5nIGlkZW50aWZpZXItYmFzZWQgb3ZlcnJpZGVcbiAgICAgICAgICAgICAgICBwcm9wQ29uZmlnLmFjdGlvbnMgPSBjdXN0b21Sb3dBY3Rpb25zXG4gICAgICAgICAgICAgICAgICAgID8gbWVyZ2VBY3Rpb25zKGRlZmF1bHRBY3Rpb25zLCBjdXN0b21Sb3dBY3Rpb25zKVxuICAgICAgICAgICAgICAgICAgICA6IGRlZmF1bHRBY3Rpb25zO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gcHJvcENvbmZpZztcbiAgICAgICAgfSk7XG59XG5cbi8qKlxuICogTUVSR0UgVVRJTElUWSBGVU5DVElPTlNcbiAqIFxuICogVGhlc2UgZnVuY3Rpb25zIGltcGxlbWVudCB0aGUgaWRlbnRpZmllci1iYXNlZCBvdmVycmlkZSBwYXR0ZXJuOlxuICogLSBEZWZhdWx0cyBoYXZlIHN0YW5kYXJkIGlkZW50aWZpZXJzIChlLmcuLCAndmlldycsICdlZGl0JywgJ2RlbGV0ZScpXG4gKiAtIEN1c3RvbSBjb25maWdzIHdpdGggc2FtZSBpZGVudGlmaWVyIG92ZXJyaWRlIHRoZSBkZWZhdWx0XG4gKiAtIE5ldyBpZGVudGlmaWVycyBnZXQgYWRkZWQgdG8gdGhlIHJlc3VsdFxuICovXG5cbi8qKlxuICogTWVyZ2UgZGVmYXVsdCBidXR0b25zIHdpdGggY3VzdG9tIGJ1dHRvbnMgdXNpbmcgaWRlbnRpZmllci1iYXNlZCBvdmVycmlkZS5cbiAqIFxuICogQHBhcmFtIGRlZmF1bHRzIC0gRGVmYXVsdCBidXR0b25zIChmcm9tIGdlbmVyYXRvcilcbiAqIEBwYXJhbSBjdXN0b21zIC0gQ3VzdG9tIGJ1dHRvbnMgKGZyb20gZW50aXR5IHNjaGVtYSlcbiAqIEByZXR1cm5zIE1lcmdlZCBidXR0b24gYXJyYXlcbiAqL1xuLyoqXG4gKiBNZXJnZXMgZGVmYXVsdCBidXR0b25zIHdpdGggY3VzdG9tIGJ1dHRvbnMgdXNpbmcgSUQtYmFzZWQgb3ZlcnJpZGUgbG9naWMuXG4gKiBcbiAqIEN1c3RvbSBidXR0b25zIHdpdGggbWF0Y2hpbmcgSURzIG92ZXJyaWRlIGRlZmF1bHRzLCBhbmQgbmV3IGN1c3RvbSBidXR0b25zIGFyZSBhcHBlbmRlZC5cbiAqIEJ1dHRvbnMgd2l0aG91dCBJRHMgYXJlIGFsd2F5cyBpbmNsdWRlZCAobm8gZGVkdXBsaWNhdGlvbikuXG4gKiBcbiAqIEB0ZW1wbGF0ZSBUIC0gQnV0dG9uIHR5cGUgd2l0aCBvcHRpb25hbCBpZCBwcm9wZXJ0eVxuICogQHBhcmFtIGRlZmF1bHRzIC0gRGVmYXVsdCBidXR0b24gY29uZmlndXJhdGlvbnNcbiAqIEBwYXJhbSBjdXN0b21zIC0gQ3VzdG9tIGJ1dHRvbiBjb25maWd1cmF0aW9ucyB0byBtZXJnZVxuICogQHJldHVybnMgTWVyZ2VkIGFycmF5IHdpdGggY3VzdG9tIG92ZXJyaWRlcyBhcHBsaWVkXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBkZWZhdWx0cyA9IFtcbiAqICAgeyBpZDogJ3NhdmUnLCBsYWJlbDogJ1NhdmUnLCBhY3Rpb246ICdzdWJtaXQnIH0sXG4gKiAgIHsgaWQ6ICdjYW5jZWwnLCBsYWJlbDogJ0NhbmNlbCcsIGFjdGlvbjogJ2NhbmNlbCcgfVxuICogXTtcbiAqIGNvbnN0IGN1c3RvbXMgPSBbXG4gKiAgIHsgaWQ6ICdzYXZlJywgbGFiZWw6ICdTYXZlIENoYW5nZXMnLCBhY3Rpb246ICdzdWJtaXQnIH0sIC8vIE92ZXJyaWRlXG4gKiAgIHsgaWQ6ICdkZWxldGUnLCBsYWJlbDogJ0RlbGV0ZScsIGFjdGlvbjogJ2RlbGV0ZScgfSAgICAgIC8vIE5ld1xuICogXTtcbiAqIGNvbnN0IG1lcmdlZCA9IG1lcmdlQnV0dG9ucyhkZWZhdWx0cywgY3VzdG9tcyk7XG4gKiAvLyBSZXR1cm5zOiBbXG4gKiAvLyAgIHsgaWQ6ICdzYXZlJywgbGFiZWw6ICdTYXZlIENoYW5nZXMnLCBhY3Rpb246ICdzdWJtaXQnIH0sXG4gKiAvLyAgIHsgaWQ6ICdjYW5jZWwnLCBsYWJlbDogJ0NhbmNlbCcsIGFjdGlvbjogJ2NhbmNlbCcgfSxcbiAqIC8vICAgeyBpZDogJ2RlbGV0ZScsIGxhYmVsOiAnRGVsZXRlJywgYWN0aW9uOiAnZGVsZXRlJyB9XG4gKiAvLyBdXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlQnV0dG9uczxUIGV4dGVuZHMgeyBpZD86IHN0cmluZyB9PihcbiAgICBkZWZhdWx0czogQXJyYXk8VD4sXG4gICAgY3VzdG9tczogUmVhZG9ubHlBcnJheTxUPiB8IEFycmF5PFQ+ID0gW11cbik6IEFycmF5PFQ+IHtcbiAgICBjb25zdCBjdXN0b21zQXJyYXkgPSBbIC4uLmN1c3RvbXMgXTsgIC8vIENvbnZlcnQgdG8gbXV0YWJsZSBhcnJheVxuICAgIGNvbnN0IGN1c3RvbU1hcCA9IG5ldyBNYXAoXG4gICAgICAgIGN1c3RvbXNBcnJheS5maWx0ZXIoYyA9PiBjLmlkKS5tYXAoYyA9PiBbIGMuaWQsIGMgXSlcbiAgICApO1xuXG4gICAgLy8gU3RhcnQgd2l0aCBkZWZhdWx0cywgcmVwbGFjZSBpZiBjdXN0b20gaGFzIHNhbWUgaWRcbiAgICBjb25zdCBtZXJnZWQgPSBkZWZhdWx0cy5tYXAoZGVmYXVsdEJ0biA9PlxuICAgICAgICBkZWZhdWx0QnRuLmlkICYmIGN1c3RvbU1hcC5oYXMoZGVmYXVsdEJ0bi5pZClcbiAgICAgICAgICAgID8gY3VzdG9tTWFwLmdldChkZWZhdWx0QnRuLmlkKSEgIC8vIE92ZXJyaWRlXG4gICAgICAgICAgICA6IGRlZmF1bHRCdG5cbiAgICApO1xuXG4gICAgLy8gQWRkIGN1c3RvbSBidXR0b25zIHRoYXQgZG9uJ3Qgb3ZlcnJpZGUgZGVmYXVsdHNcbiAgICBjdXN0b21zQXJyYXkuZm9yRWFjaChjdXN0b21CdG4gPT4ge1xuICAgICAgICBpZiAoIWN1c3RvbUJ0bi5pZCB8fCAhZGVmYXVsdHMuc29tZShkID0+IGQuaWQgPT09IGN1c3RvbUJ0bi5pZCkpIHtcbiAgICAgICAgICAgIG1lcmdlZC5wdXNoKGN1c3RvbUJ0bik7ICAvLyBBZGQgbmV3XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiBtZXJnZWQ7XG59XG5cbi8qKlxuICogTWVyZ2VzIGRlZmF1bHQgYWN0aW9ucyB3aXRoIGN1c3RvbSBhY3Rpb25zIHVzaW5nIElELWJhc2VkIG92ZXJyaWRlIGxvZ2ljLlxuICogXG4gKiBEZWxlZ2F0ZXMgdG8gbWVyZ2VCdXR0b25zIHdpdGggdGhlIHNhbWUgYmVoYXZpb3I6IGN1c3RvbSBhY3Rpb25zIHdpdGggbWF0Y2hpbmcgSURzXG4gKiBvdmVycmlkZSBkZWZhdWx0cywgYW5kIG5ldyBjdXN0b20gYWN0aW9ucyBhcmUgYXBwZW5kZWQuIFNlbWFudGljYWxseSBuYW1lZCBmb3Igcm93L3RhYmxlIGFjdGlvbnMuXG4gKiBcbiAqIEB0ZW1wbGF0ZSBUIC0gQWN0aW9uIHR5cGUgd2l0aCBvcHRpb25hbCBpZCBwcm9wZXJ0eVxuICogQHBhcmFtIGRlZmF1bHRzIC0gRGVmYXVsdCBhY3Rpb24gY29uZmlndXJhdGlvbnNcbiAqIEBwYXJhbSBjdXN0b21zIC0gQ3VzdG9tIGFjdGlvbiBjb25maWd1cmF0aW9ucyB0byBtZXJnZVxuICogQHJldHVybnMgTWVyZ2VkIGFycmF5IHdpdGggY3VzdG9tIG92ZXJyaWRlcyBhcHBsaWVkXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBkZWZhdWx0cyA9IFtcbiAqICAgeyBpZDogJ2VkaXQnLCBsYWJlbDogJ0VkaXQnLCBhY3Rpb246ICdlZGl0JyB9LFxuICogICB7IGlkOiAnZGVsZXRlJywgbGFiZWw6ICdEZWxldGUnLCBhY3Rpb246ICdkZWxldGUnIH1cbiAqIF07XG4gKiBjb25zdCBjdXN0b21zID0gW1xuICogICB7IGlkOiAnZGVsZXRlJywgbGFiZWw6ICdSZW1vdmUnLCBhY3Rpb246ICdkZWxldGUnLCBjb25maXJtOiB0cnVlIH0gLy8gT3ZlcnJpZGVcbiAqIF07XG4gKiBjb25zdCBtZXJnZWQgPSBtZXJnZUFjdGlvbnMoZGVmYXVsdHMsIGN1c3RvbXMpO1xuICogLy8gUmV0dXJuczogW1xuICogLy8gICB7IGlkOiAnZWRpdCcsIGxhYmVsOiAnRWRpdCcsIGFjdGlvbjogJ2VkaXQnIH0sXG4gKiAvLyAgIHsgaWQ6ICdkZWxldGUnLCBsYWJlbDogJ1JlbW92ZScsIGFjdGlvbjogJ2RlbGV0ZScsIGNvbmZpcm06IHRydWUgfVxuICogLy8gXVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZUFjdGlvbnM8VCBleHRlbmRzIHsgaWQ/OiBzdHJpbmcgfT4oXG4gICAgZGVmYXVsdHM6IEFycmF5PFQ+LFxuICAgIGN1c3RvbXM6IFJlYWRvbmx5QXJyYXk8VD4gfCBBcnJheTxUPiA9IFtdXG4pOiBBcnJheTxUPiB7XG4gICAgcmV0dXJuIG1lcmdlQnV0dG9ucyhkZWZhdWx0cywgWyAuLi5jdXN0b21zIF0pOyAgLy8gU3ByZWFkIHRvIGhhbmRsZSBib3RoIHJlYWRvbmx5IGFuZCBtdXRhYmxlXG59XG5cbi8qKlxuICogR3JvdXBzIHBhZ2UgaGVhZGVyIGFjdGlvbnMgaW50byBwcmltYXJ5ICh0b3AtbGV2ZWwgYnV0dG9ucykgYW5kIHNlY29uZGFyeSAoaW5zaWRlIGEgXCJNb3JlXCIgZHJvcGRvd24pLlxuICogV2hlbiBhdXRvR3JvdXAgaXMgZmFsc2UsIHJldHVybnMgYWxsIGFjdGlvbnMgYXMgYSBmbGF0IGFycmF5IChubyBncm91cGluZykuXG4gKiBcbiAqIEd1YXJhbnRlZXMgYXQgbGVhc3Qgb25lIHZpc2libGUgdG9wLWxldmVsIGFjdGlvbjogaWYgcHJpbWFyeUFjdGlvbnMgaXMgZW1wdHksXG4gKiB0aGUgZmlyc3Qgc2Vjb25kYXJ5IGFjdGlvbiBpcyBwcm9tb3RlZCB0byB0b3AtbGV2ZWwgaW5zdGVhZCBvZiBiZWluZyBidXJpZWQgaW4gXCJNb3JlXCIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBncm91cFBhZ2VIZWFkZXJBY3Rpb25zKFxuICAgIHByaW1hcnlBY3Rpb25zOiBBcnJheTxJRW50aXR5UGFnZUFjdGlvbj4sXG4gICAgc2Vjb25kYXJ5QWN0aW9uczogQXJyYXk8SUVudGl0eVBhZ2VBY3Rpb24+LFxuICAgIGF1dG9Hcm91cDogYm9vbGVhblxuKTogQXJyYXk8SUVudGl0eVBhZ2VBY3Rpb24+IHtcbiAgICBpZiAoIWF1dG9Hcm91cCB8fCBzZWNvbmRhcnlBY3Rpb25zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICByZXR1cm4gWyAuLi5wcmltYXJ5QWN0aW9ucywgLi4uc2Vjb25kYXJ5QWN0aW9ucyBdO1xuICAgIH1cblxuICAgIGNvbnN0IHRvcExldmVsID0gWyAuLi5wcmltYXJ5QWN0aW9ucyBdO1xuICAgIGxldCByZW1haW5pbmcgPSBzZWNvbmRhcnlBY3Rpb25zO1xuXG4gICAgLy8gUHJvbW90ZSBmaXJzdCBzZWNvbmRhcnkgYWN0aW9uIGlmIG5vdGhpbmcgaXMgdmlzaWJsZSBhdCB0b3AgbGV2ZWxcbiAgICBpZiAodG9wTGV2ZWwubGVuZ3RoID09PSAwICYmIHJlbWFpbmluZy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHRvcExldmVsLnB1c2gocmVtYWluaW5nWyAwIF0pO1xuICAgICAgICByZW1haW5pbmcgPSByZW1haW5pbmcuc2xpY2UoMSk7XG4gICAgfVxuXG4gICAgaWYgKHJlbWFpbmluZy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIHRvcExldmVsO1xuICAgIH1cblxuICAgIGNvbnN0IG1vcmVEcm9wZG93bjogSUVudGl0eVBhZ2VBY3Rpb24gPSB7XG4gICAgICAgIGlkOiAnbW9yZS1hY3Rpb25zJyxcbiAgICAgICAgbGFiZWw6ICdNb3JlJyxcbiAgICAgICAgdHlwZTogJ2Ryb3Bkb3duJyxcbiAgICAgICAgaXRlbXM6IHJlbWFpbmluZyxcbiAgICB9O1xuXG4gICAgcmV0dXJuIFsgLi4udG9wTGV2ZWwsIG1vcmVEcm9wZG93biBdO1xufVxuXG4vKipcbiAqIE1lcmdlcyBkZWZhdWx0IGZpbHRlciBzZWdtZW50cyB3aXRoIGN1c3RvbSBzZWdtZW50cyB1c2luZyBJRC1iYXNlZCBvdmVycmlkZSBsb2dpYy5cbiAqIFxuICogRm9sbG93cyB0aGUgc2FtZSBwYXR0ZXJuIGFzIG1lcmdlQnV0dG9ucy9tZXJnZUFjdGlvbnM6IGN1c3RvbSBzZWdtZW50cyB3aXRoIG1hdGNoaW5nIElEc1xuICogb3ZlcnJpZGUgZGVmYXVsdHMsIGFuZCBuZXcgY3VzdG9tIHNlZ21lbnRzIGFyZSBhcHBlbmRlZC5cbiAqIFxuICogQHBhcmFtIGRlZmF1bHRzIC0gRGVmYXVsdCBzZWdtZW50IGNvbmZpZ3VyYXRpb25zXG4gKiBAcGFyYW0gY3VzdG9tcyAtIEN1c3RvbSBzZWdtZW50IGNvbmZpZ3VyYXRpb25zIHRvIG1lcmdlXG4gKiBAcmV0dXJucyBNZXJnZWQgYXJyYXkgd2l0aCBjdXN0b20gb3ZlcnJpZGVzIGFwcGxpZWRcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IGRlZmF1bHRzID0gW1xuICogICB7IGlkOiAnYWN0aXZlJywgbGFiZWw6ICdBY3RpdmUnLCBmaWx0ZXJzOiB7IHN0YXR1czogeyBlcTogJ2FjdGl2ZScgfSB9IH0sXG4gKiAgIHsgaWQ6ICdpbmFjdGl2ZScsIGxhYmVsOiAnSW5hY3RpdmUnLCBmaWx0ZXJzOiB7IHN0YXR1czogeyBlcTogJ2luYWN0aXZlJyB9IH0gfVxuICogXTtcbiAqIGNvbnN0IGN1c3RvbXMgPSBbXG4gKiAgIHsgaWQ6ICdhcmNoaXZlZCcsIGxhYmVsOiAnQXJjaGl2ZWQnLCBmaWx0ZXJzOiB7IGFyY2hpdmVkOiB7IGVxOiB0cnVlIH0gfSB9XG4gKiBdO1xuICogY29uc3QgcmVzdWx0ID0gbWVyZ2VTZWdtZW50cyhkZWZhdWx0cywgY3VzdG9tcyk7XG4gKiAvLyBSZXR1cm5zOiBbYWN0aXZlLCBpbmFjdGl2ZSwgYXJjaGl2ZWRdXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlU2VnbWVudHM8VCBleHRlbmRzIHsgaWQ6IHN0cmluZyB9PihcbiAgICBkZWZhdWx0czogQXJyYXk8VD4sXG4gICAgY3VzdG9tczogUmVhZG9ubHlBcnJheTxUPiB8IEFycmF5PFQ+ID0gW11cbik6IEFycmF5PFQ+IHtcbiAgICByZXR1cm4gbWVyZ2VCdXR0b25zKGRlZmF1bHRzLCBbIC4uLmN1c3RvbXMgXSk7ICAvLyBSZXVzZSBtZXJnZUJ1dHRvbnMgbG9naWMgd2l0aCBpZC1iYXNlZCBvdmVycmlkZVxufVxuXG4vKipcbiAqIE1lcmdlcyBmaWVsZC1sZXZlbCB2aXNpYmlsaXR5LCBlbmFibGVtZW50LCBoZWxwIHRleHQsIGFuZCBwbGFjZWhvbGRlciBvdmVycmlkZXMgaW50byBiYXNlIHByb3BlcnRpZXMuXG4gKiBcbiAqIEFwcGxpZXMgY3VzdG9tIGZpZWxkIGNvbmZpZ3VyYXRpb25zIGZyb20gZm9ybS9kZXRhaWwgY29uZmlnIHRvIGJhc2Ugc2NoZW1hIHByb3BlcnRpZXMuXG4gKiBPbmx5IG1lcmdlcyBvdmVycmlkZXMgZm9yIGZpZWxkcyB0aGF0IGV4aXN0IGluIGJhc2UgcHJvcGVydGllcyAod2FybnMgYWJvdXQgbm9uLWV4aXN0ZW50IGZpZWxkcykuXG4gKiBcbiAqIEB0ZW1wbGF0ZSBUIC0gUHJvcGVydHkgdHlwZSB3aXRoIHJlcXVpcmVkIG5hbWUgZmllbGRcbiAqIEBwYXJhbSBiYXNlUHJvcGVydGllcyAtIEJhc2UgZmllbGQgcHJvcGVydGllcyBmcm9tIGVudGl0eSBzY2hlbWFcbiAqIEBwYXJhbSBmaWVsZE92ZXJyaWRlcyAtIEN1c3RvbSBmaWVsZCBvdmVycmlkZXMgZnJvbSBmb3JtL2RldGFpbCBjb25maWd1cmF0aW9uXG4gKiBAcmV0dXJucyBCYXNlIHByb3BlcnRpZXMgd2l0aCBvdmVycmlkZXMgbWVyZ2VkIGluXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBiYXNlUHJvcHMgPSBbXG4gKiAgIHsgbmFtZTogJ2VtYWlsJywgdHlwZTogJ3N0cmluZycsIHJlcXVpcmVkOiB0cnVlIH0sXG4gKiAgIHsgbmFtZTogJ2JpbycsIHR5cGU6ICdzdHJpbmcnLCByZXF1aXJlZDogZmFsc2UgfVxuICogXTtcbiAqIGNvbnN0IG92ZXJyaWRlcyA9IFtcbiAqICAgeyBuYW1lOiAnZW1haWwnLCBoZWxwVGV4dDogJ0VudGVyIGEgdmFsaWQgZW1haWwgYWRkcmVzcycgfSxcbiAqICAgeyBuYW1lOiAnYmlvJywgdmlzaWJpbGl0eTogeyBjcmVhdGU6IGZhbHNlIH0gfVxuICogXTtcbiAqIGNvbnN0IG1lcmdlZCA9IG1lcmdlRmllbGRWaXNpYmlsaXR5KGJhc2VQcm9wcywgb3ZlcnJpZGVzKTtcbiAqIC8vIFJldHVybnMgYmFzZVByb3BzIHdpdGggaGVscFRleHQgYW5kIHZpc2liaWxpdHkgbWVyZ2VkXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlRmllbGRWaXNpYmlsaXR5PFQgZXh0ZW5kcyB7IG5hbWU6IHN0cmluZyB9PihcbiAgICBiYXNlUHJvcGVydGllczogQXJyYXk8VD4sXG4gICAgZmllbGRPdmVycmlkZXM6IFJlYWRvbmx5QXJyYXk8e1xuICAgICAgICByZWFkb25seSBuYW1lOiBzdHJpbmc7XG4gICAgICAgIHJlYWRvbmx5IFsga2V5OiBzdHJpbmcgXTogdW5rbm93bjtcbiAgICB9PiB8IEFycmF5PHtcbiAgICAgICAgbmFtZTogc3RyaW5nO1xuICAgICAgICBbIGtleTogc3RyaW5nIF06IHVua25vd247XG4gICAgfT4gPSBbXVxuKTogQXJyYXk8VD4ge1xuICAgIGNvbnN0IG92ZXJyaWRlTWFwID0gbmV3IE1hcChcbiAgICAgICAgWyAuLi5maWVsZE92ZXJyaWRlcyBdLm1hcChmID0+IFsgZi5uYW1lLCBmIF0pXG4gICAgKTtcblxuICAgIGZpZWxkT3ZlcnJpZGVzLmZvckVhY2gob3ZlcnJpZGUgPT4ge1xuICAgICAgICBpZiAoIWJhc2VQcm9wZXJ0aWVzLnNvbWUocCA9PiBwLm5hbWUgPT09IG92ZXJyaWRlLm5hbWUpKSB7XG4gICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYEZpZWxkIG92ZXJyaWRlIFwiJHtvdmVycmlkZS5uYW1lfVwiIG5vdCBmb3VuZCBpbiBzY2hlbWEgcHJvcGVydGllcy4gVGhpcyBvdmVycmlkZSB3aWxsIGJlIGlnbm9yZWQuYCk7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiBiYXNlUHJvcGVydGllcy5tYXAocHJvcCA9PiB7XG4gICAgICAgIGNvbnN0IG92ZXJyaWRlID0gb3ZlcnJpZGVNYXAuZ2V0KHByb3AubmFtZSk7XG5cbiAgICAgICAgaWYgKCFvdmVycmlkZSkgcmV0dXJuIHByb3A7XG5cbiAgICAgICAgY29uc3QgeyBuYW1lOiBfbmFtZSwgLi4ub3ZlcnJpZGVQcm9wcyB9ID0gb3ZlcnJpZGU7XG4gICAgICAgIGNvbnN0IGRlZmluZWRPdmVycmlkZXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge307XG4gICAgICAgIGZvciAoY29uc3QgWyBrZXksIHZhbHVlIF0gb2YgT2JqZWN0LmVudHJpZXMob3ZlcnJpZGVQcm9wcykpIHtcbiAgICAgICAgICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgZGVmaW5lZE92ZXJyaWRlc1sga2V5IF0gPSB2YWx1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAuLi5wcm9wLFxuICAgICAgICAgICAgLi4uZGVmaW5lZE92ZXJyaWRlcyxcbiAgICAgICAgfTtcbiAgICB9KTtcbn1cblxuLyoqXG4gKiBNZXJnZXMgY29sdW1uLWxldmVsIHZpc2liaWxpdHksIHdpZHRoLCBmaXhlZCBwb3NpdGlvbiwgZ3JvdXBpbmcgb3ZlcnJpZGVzLCBhbmQgb3JkZXJpbmcgaW50byBiYXNlIHByb3BlcnRpZXMuXG4gKiBcbiAqIEFwcGxpZXMgY3VzdG9tIGNvbHVtbiBjb25maWd1cmF0aW9ucyBmcm9tIHRhYmxlIGNvbmZpZyB0byBiYXNlIHNjaGVtYSBwcm9wZXJ0aWVzLlxuICogT25seSBtZXJnZXMgb3ZlcnJpZGVzIGZvciBjb2x1bW5zIHRoYXQgZXhpc3QgaW4gYmFzZSBwcm9wZXJ0aWVzICh3YXJucyBhYm91dCBub24tZXhpc3RlbnQgY29sdW1ucykuXG4gKiBcbiAqICoqVmlzaWJpbGl0eSBMb2dpYzoqKlxuICogLSBXaGVuIGNvbHVtbk92ZXJyaWRlcyBpcyBwcm92aWRlZDpcbiAqICAgLSBGaWVsZHMgSU4gdGhlIGFycmF5OiBVc2UgYGRlZmF1bHRWaXNpYmxlYCAoZGVmYXVsdHMgdG8gdHJ1ZSBpZiBub3Qgc3BlY2lmaWVkKVxuICogICAtIEZpZWxkcyBOT1QgSU4gdGhlIGFycmF5OiBTZXQgYGRlZmF1bHRWaXNpYmxlOiBmYWxzZWAgKGF2YWlsYWJsZSBpbiBDb2x1bW4gU2V0dGluZ3MgYnV0IG5vdCBzaG93biBieSBkZWZhdWx0KVxuICogLSBXaGVuIGNvbHVtbk92ZXJyaWRlcyBpcyBlbXB0eS91bmRlZmluZWQ6IEFsbCBmaWVsZHMgdmlzaWJsZSAoYmFja3dhcmQgY29tcGF0aWJsZSlcbiAqIFxuICogKipPcmRlcmluZyBMb2dpYzoqKlxuICogLSBXaGVuIGNvbHVtbk92ZXJyaWRlcyBpcyBwcm92aWRlZDpcbiAqICAgLSBDb2x1bW5zIGFyZSBvcmRlcmVkIGFjY29yZGluZyB0byB0aGVpciBwb3NpdGlvbiBpbiB0aGUgY29sdW1uT3ZlcnJpZGVzIGFycmF5XG4gKiAgIC0gQ29sdW1ucyBub3QgaW4gdGhlIGFycmF5IGFwcGVhciBhdCB0aGUgZW5kIGluIHRoZWlyIG9yaWdpbmFsIG9yZGVyXG4gKiAtIFdoZW4gY29sdW1uT3ZlcnJpZGVzIGlzIGVtcHR5L3VuZGVmaW5lZDogT3JpZ2luYWwgb3JkZXIgaXMgcHJlc2VydmVkXG4gKiBcbiAqIEB0ZW1wbGF0ZSBUIC0gUHJvcGVydHkgdHlwZSB3aXRoIHJlcXVpcmVkIG5hbWUgZmllbGRcbiAqIEBwYXJhbSBiYXNlUHJvcGVydGllcyAtIEJhc2UgY29sdW1uIHByb3BlcnRpZXMgZnJvbSBlbnRpdHkgc2NoZW1hXG4gKiBAcGFyYW0gY29sdW1uT3ZlcnJpZGVzIC0gQ3VzdG9tIGNvbHVtbiBvdmVycmlkZXMgZnJvbSB0YWJsZSBjb25maWd1cmF0aW9uXG4gKiBAcmV0dXJucyBCYXNlIHByb3BlcnRpZXMgd2l0aCBvdmVycmlkZXMgbWVyZ2VkIGluIGFuZCByZW9yZGVyZWRcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IGJhc2VQcm9wcyA9IFtcbiAqICAgeyBuYW1lOiAnb3JkZXJJZCcsIGRhdGFJbmRleDogJ29yZGVySWQnLCB0eXBlOiAnc3RyaW5nJyB9LFxuICogICB7IG5hbWU6ICdzdGF0dXMnLCBkYXRhSW5kZXg6ICdzdGF0dXMnLCB0eXBlOiAnc3RyaW5nJyB9LFxuICogICB7IG5hbWU6ICd1c2VySWQnLCBkYXRhSW5kZXg6ICd1c2VySWQnLCB0eXBlOiAnc3RyaW5nJyB9LFxuICogICB7IG5hbWU6ICdtZXRhZGF0YScsIGRhdGFJbmRleDogJ21ldGFkYXRhJywgdHlwZTogJ3N0cmluZycgfVxuICogXTtcbiAqIGNvbnN0IG92ZXJyaWRlcyA9IFtcbiAqICAgeyBmaWVsZDogJ3N0YXR1cycsIGRlZmF1bHRWaXNpYmxlOiB0cnVlIH0sICAgICAgICAgLy8gMXN0IHBvc2l0aW9uXG4gKiAgIHsgZmllbGQ6ICdvcmRlcklkJywgd2lkdGg6IDIwMCwgZGVmYXVsdFZpc2libGU6IHRydWUgfSwgLy8gMm5kIHBvc2l0aW9uXG4gKiAgIHsgZmllbGQ6ICdtZXRhZGF0YScsIGRlZmF1bHRWaXNpYmxlOiBmYWxzZSB9ICAgICAgIC8vIDNyZCBwb3NpdGlvbiAoaGlkZGVuKVxuICogICAvLyB1c2VySWQgbm90IGxpc3RlZCAtIHdpbGwgYmUgYXQgdGhlIGVuZCBhbmQgaGlkZGVuIGJ5IGRlZmF1bHRcbiAqIF07XG4gKiBjb25zdCBtZXJnZWQgPSBtZXJnZUNvbHVtblZpc2liaWxpdHkoYmFzZVByb3BzLCBvdmVycmlkZXMpO1xuICogLy8gUmVzdWx0IChpbiBvcmRlcik6XG4gKiAvLyAxLiBzdGF0dXM6IGRlZmF1bHRWaXNpYmxlOiB0cnVlXG4gKiAvLyAyLiBvcmRlcklkOiBkZWZhdWx0VmlzaWJsZTogdHJ1ZSwgd2lkdGg6IDIwMFxuICogLy8gMy4gbWV0YWRhdGE6IGRlZmF1bHRWaXNpYmxlOiBmYWxzZVxuICogLy8gNC4gdXNlcklkOiBkZWZhdWx0VmlzaWJsZTogZmFsc2UgKG5vdCBpbiBvdmVycmlkZXMsIGF0IHRoZSBlbmQpXG4gKiBgYGBcbiAqL1xuLyoqXG4gKiBOb3JtYWxpemVkIGNvbHVtbiBjb25maWd1cmF0aW9uIHdpdGggZGVmYXVsdFZpc2libGUgYWx3YXlzIGRlZmluZWQuXG4gKiBJbnRlcm5hbCB0eXBlIGZvciBwcm9jZXNzaW5nIGNvbHVtbiBvdmVycmlkZXMuXG4gKi9cbnR5cGUgTm9ybWFsaXplZENvbHVtbkNvbmZpZyA9IE9taXQ8SVRhYmxlQ29sdW1uQ29uZmlnLCAnZGVmYXVsdFZpc2libGUnPiAmIHtcbiAgICBkZWZhdWx0VmlzaWJsZTogYm9vbGVhbjtcbiAgICBfb3JkZXI/OiBudW1iZXI7XG59O1xuXG4vKipcbiAqIE5vcm1hbGl6ZXMgY29sdW1uIG92ZXJyaWRlcyB0byBhIGNvbnNpc3RlbnQgZm9ybWF0LlxuICogU3VwcG9ydHMgYm90aCBzdHJpbmcgc2hvcnRoYW5kICgnZmllbGROYW1lJykgYW5kIG9iamVjdCBzeW50YXggKHsgZmllbGQ6ICdmaWVsZE5hbWUnLCAuLi4gfSlcbiAqIFxuICogQHBhcmFtIGNvbHVtbk92ZXJyaWRlcyAtIENvbHVtbiBjb25maWd1cmF0aW9ucyAoc3RyaW5nIG9yIG9iamVjdCBmb3JtYXQpXG4gKiBAcmV0dXJucyBOb3JtYWxpemVkIGFycmF5IG9mIGNvbHVtbiBjb25maWcgb2JqZWN0c1xuICovXG5mdW5jdGlvbiBub3JtYWxpemVDb2x1bW5PdmVycmlkZXMoXG4gICAgY29sdW1uT3ZlcnJpZGVzOiBJVGFibGVDb2x1bW5zXG4pOiBBcnJheTxOb3JtYWxpemVkQ29sdW1uQ29uZmlnPiB7XG4gICAgcmV0dXJuIChjb2x1bW5PdmVycmlkZXMgYXMgQXJyYXk8SVRhYmxlQ29sdW1uPikubWFwKGNvbCA9PiB7XG4gICAgICAgIC8vIFN0cmluZyBzaG9ydGhhbmQ6ICdmaWVsZE5hbWUnIOKGkiB7IGZpZWxkOiAnZmllbGROYW1lJywgZGVmYXVsdFZpc2libGU6IHRydWUgfVxuICAgICAgICBpZiAodHlwZW9mIGNvbCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgZmllbGQ6IGNvbCxcbiAgICAgICAgICAgICAgICBkZWZhdWx0VmlzaWJsZTogdHJ1ZVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICAvLyBPYmplY3Qgc3ludGF4OiBhbHJlYWR5IG5vcm1hbGl6ZWQsIGp1c3QgZW5zdXJlIGRlZmF1bHRWaXNpYmxlIGRlZmF1bHRzIHRvIHRydWVcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGZpZWxkOiBjb2wuZmllbGQsXG4gICAgICAgICAgICB2aXNpYmlsaXR5OiBjb2wudmlzaWJpbGl0eSxcbiAgICAgICAgICAgIHJlbmRlcmVyOiBjb2wucmVuZGVyZXIsXG4gICAgICAgICAgICB3aWR0aDogY29sLndpZHRoLFxuICAgICAgICAgICAgZml4ZWQ6IGNvbC5maXhlZCxcbiAgICAgICAgICAgIGdyb3VwVGl0bGU6IGNvbC5ncm91cFRpdGxlLFxuICAgICAgICAgICAgZGVmYXVsdFZpc2libGU6IGNvbC5kZWZhdWx0VmlzaWJsZSAhPT0gZmFsc2UsIC8vIERlZmF1bHRzIHRvIHRydWVcbiAgICAgICAgICAgIC4uLihjb2wuZm9ybWF0dGluZyAmJiB7IGZvcm1hdHRpbmc6IGNvbC5mb3JtYXR0aW5nIH0pLFxuICAgICAgICAgICAgLi4uKGNvbC5jb21wb3NpdGUgJiYgeyBjb21wb3NpdGU6IGNvbC5jb21wb3NpdGUgfSksXG4gICAgICAgICAgICAuLi4oY29sLm1hc2tpbmcgJiYgeyBtYXNraW5nOiBjb2wubWFza2luZyB9KSxcbiAgICAgICAgICAgIC4uLihjb2wuZGVyaXZlZCAmJiB7IGRlcml2ZWQ6IGNvbC5kZXJpdmVkIH0pLFxuICAgICAgICB9O1xuICAgIH0pO1xufVxuXG4vKipcbiAqIE1lcmdlcyBjb2x1bW4gdmlzaWJpbGl0eSBjb25maWd1cmF0aW9uIHdpdGggYmFzZSBwcm9wZXJ0aWVzLlxuICogQ29udHJvbHMgd2hpY2ggY29sdW1ucyBhcmUgdmlzaWJsZSBieSBkZWZhdWx0IGFuZCB0aGVpciBkaXNwbGF5IG9yZGVyLlxuICogXG4gKiAqKlN1cHBvcnRzOioqXG4gKiAtIFNjaGVtYSBmaWVsZHMgKGZyb20gYmFzZSBwcm9wZXJ0aWVzKVxuICogLSBKU09OIHBhdGhzIChlLmcuLCAndXNlci5lbWFpbCcsICdtZXRhZGF0YS5zY29yZScpXG4gKiAtIEN1c3RvbS9jb21wdXRlZCBjb2x1bW5zIChub3QgaW4gc2NoZW1hLCBwcm92aWRlZCBieSBBUEkgb3IgZnJvbnRlbmQpXG4gKiBcbiAqIEB0ZW1wbGF0ZSBUIC0gQmFzZSBwcm9wZXJ0eSB0eXBlIHdpdGggbmFtZSBhbmQgZGF0YUluZGV4XG4gKiBAcGFyYW0gYmFzZVByb3BlcnRpZXMgLSBCYXNlIHByb3BlcnRpZXMgZnJvbSBlbnRpdHkgc2NoZW1hXG4gKiBAcGFyYW0gY29sdW1uT3ZlcnJpZGVzIC0gQ29sdW1uIGNvbmZpZ3VyYXRpb24gb3ZlcnJpZGVzIChzdHJpbmcgb3Igb2JqZWN0IGZvcm1hdClcbiAqIEByZXR1cm5zIE1lcmdlZCBwcm9wZXJ0aWVzIHdpdGggdmlzaWJpbGl0eSBhbmQgb3JkZXIgYXBwbGllZCwgaW5jbHVkaW5nIGN1c3RvbSBjb2x1bW5zXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZUNvbHVtblZpc2liaWxpdHk8VCBleHRlbmRzIHsgbmFtZTogc3RyaW5nOyBkYXRhSW5kZXg/OiBzdHJpbmcgfT4oXG4gICAgYmFzZVByb3BlcnRpZXM6IEFycmF5PFQ+LFxuICAgIGNvbHVtbk92ZXJyaWRlczogSVRhYmxlQ29sdW1ucyA9IFtdXG4pOiBBcnJheTxUPiB7XG4gICAgLy8gSWYgbm8gY29sdW1uT3ZlcnJpZGVzIHByb3ZpZGVkLCByZXR1cm4gcHJvcGVydGllcyBhcy1pcyAoYmFja3dhcmQgY29tcGF0aWJsZSlcbiAgICBpZiAoIWNvbHVtbk92ZXJyaWRlcyB8fCBjb2x1bW5PdmVycmlkZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHJldHVybiBiYXNlUHJvcGVydGllcztcbiAgICB9XG5cbiAgICAvLyBOb3JtYWxpemUgY29sdW1uIG92ZXJyaWRlcyAoaGFuZGxlIHN0cmluZyBzaG9ydGhhbmQpXG4gICAgY29uc3Qgbm9ybWFsaXplZE92ZXJyaWRlcyA9IG5vcm1hbGl6ZUNvbHVtbk92ZXJyaWRlcyhjb2x1bW5PdmVycmlkZXMpO1xuXG4gICAgY29uc3Qgb3ZlcnJpZGVNYXAgPSBuZXcgTWFwKFxuICAgICAgICBub3JtYWxpemVkT3ZlcnJpZGVzLm1hcCgoYywgaW5kZXgpID0+IFsgYy5maWVsZCwgeyAuLi5jLCBfb3JkZXI6IGluZGV4IH0gXSlcbiAgICApO1xuXG4gICAgLy8gVHJhY2sgd2hpY2ggb3ZlcnJpZGVzIG1hdGNoIGV4aXN0aW5nIHNjaGVtYSBjb2x1bW5zXG4gICAgY29uc3QgbWF0Y2hlZE92ZXJyaWRlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gICAgLy8gTWVyZ2Ugb3ZlcnJpZGVzIGludG8gZXhpc3Rpbmcgc2NoZW1hIHByb3BlcnRpZXNcbiAgICBjb25zdCBtZXJnZWRQcm9wZXJ0aWVzID0gYmFzZVByb3BlcnRpZXMubWFwKHByb3AgPT4ge1xuICAgICAgICAvLyBVc2UgZGF0YUluZGV4IChhY3R1YWwgZmllbGQgbmFtZSkgaWYgYXZhaWxhYmxlLCBvdGhlcndpc2UgZmFsbCBiYWNrIHRvIG5hbWVcbiAgICAgICAgY29uc3QgZmllbGROYW1lID0gcHJvcC5kYXRhSW5kZXggfHwgcHJvcC5uYW1lO1xuICAgICAgICBjb25zdCBvdmVycmlkZSA9IG92ZXJyaWRlTWFwLmdldChmaWVsZE5hbWUpO1xuXG4gICAgICAgIGlmICghb3ZlcnJpZGUpIHtcbiAgICAgICAgICAgIC8vIEZpZWxkIG5vdCBpbiB0YWJsZUNvbmZpZy5jb2x1bW5zIC0gaGlkZSBieSBkZWZhdWx0IGJ1dCBrZWVwIGF2YWlsYWJsZVxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAuLi5wcm9wLFxuICAgICAgICAgICAgICAgIGRlZmF1bHRWaXNpYmxlOiBmYWxzZSxcbiAgICAgICAgICAgICAgICBfb3JkZXI6IE51bWJlci5NQVhfU0FGRV9JTlRFR0VSIC8vIFB1dCBhdCB0aGUgZW5kXG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRmllbGQgaXMgaW4gdGFibGVDb25maWcuY29sdW1ucyAtIGFwcGx5IG92ZXJyaWRlc1xuICAgICAgICBtYXRjaGVkT3ZlcnJpZGVzLmFkZChvdmVycmlkZS5maWVsZCk7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAuLi5wcm9wLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLnZpc2liaWxpdHkgIT09IHVuZGVmaW5lZCAmJiB7IHZpc2liaWxpdHk6IG92ZXJyaWRlLnZpc2liaWxpdHkgfSksXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUucmVuZGVyZXIgIT09IHVuZGVmaW5lZCAmJiB7IHJlbmRlcmVyOiBvdmVycmlkZS5yZW5kZXJlciB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS53aWR0aCAhPT0gdW5kZWZpbmVkICYmIHsgd2lkdGg6IG92ZXJyaWRlLndpZHRoIH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmZpeGVkICE9PSB1bmRlZmluZWQgJiYgeyBmaXhlZDogb3ZlcnJpZGUuZml4ZWQgfSksXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUuZ3JvdXBUaXRsZSAhPT0gdW5kZWZpbmVkICYmIHsgZ3JvdXBUaXRsZTogb3ZlcnJpZGUuZ3JvdXBUaXRsZSB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS5mb3JtYXR0aW5nICYmIHsgZm9ybWF0dGluZzogb3ZlcnJpZGUuZm9ybWF0dGluZyB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS5jb21wb3NpdGUgJiYgeyBjb21wb3NpdGU6IG92ZXJyaWRlLmNvbXBvc2l0ZSB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS5tYXNraW5nICYmIHsgbWFza2luZzogb3ZlcnJpZGUubWFza2luZyB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS5kZXJpdmVkICYmIHsgZGVyaXZlZDogb3ZlcnJpZGUuZGVyaXZlZCB9KSxcbiAgICAgICAgICAgIGRlZmF1bHRWaXNpYmxlOiBvdmVycmlkZS5kZWZhdWx0VmlzaWJsZSAhPT0gZmFsc2UsICAvLyBEZWZhdWx0cyB0byB0cnVlXG4gICAgICAgICAgICBfb3JkZXI6IG92ZXJyaWRlLl9vcmRlclxuICAgICAgICB9O1xuICAgIH0pO1xuXG4gICAgLy8gQWRkIGN1c3RvbSBjb2x1bW5zIChKU09OIHBhdGhzLCBjb21wdXRlZCBmaWVsZHMpXG4gICAgbm9ybWFsaXplZE92ZXJyaWRlcy5mb3JFYWNoKG92ZXJyaWRlID0+IHtcbiAgICAgICAgaWYgKCFtYXRjaGVkT3ZlcnJpZGVzLmhhcyhvdmVycmlkZS5maWVsZCkpIHtcbiAgICAgICAgICAgIC8vIFRoaXMgaXMgYSBjdXN0b20gY29sdW1uIChKU09OIHBhdGggb3IgY29tcHV0ZWQgZmllbGQpXG4gICAgICAgICAgICBjb25zdCBpc0pzb25QYXRoID0gb3ZlcnJpZGUuZmllbGQuaW5jbHVkZXMoJy4nKTtcblxuICAgICAgICAgICAgLy8gTG9nIGluZm8gYWJvdXQgY3VzdG9tIGNvbHVtblxuICAgICAgICAgICAgaWYgKGlzSnNvblBhdGgpIHtcbiAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLmRlYnVnKGBBZGRpbmcgSlNPTiBwYXRoIGNvbHVtbjogXCIke292ZXJyaWRlLmZpZWxkfVwiYCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIERlZmF1bHRMb2dnZXIuZGVidWcoYEFkZGluZyBjdXN0b20gY29sdW1uOiBcIiR7b3ZlcnJpZGUuZmllbGR9XCIgKG5vdCBpbiBzY2hlbWEsIGFzc3VtZXMgQVBJIHByb3ZpZGVzIGl0KWApO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBBZGQgYXMgbmV3IGN1c3RvbSBjb2x1bW5cbiAgICAgICAgICAgIG1lcmdlZFByb3BlcnRpZXMucHVzaCh7XG4gICAgICAgICAgICAgICAgbmFtZTogb3ZlcnJpZGUuZmllbGQsICAvLyBVc2UgZmllbGQgYXMgbmFtZVxuICAgICAgICAgICAgICAgIGRhdGFJbmRleDogb3ZlcnJpZGUuZmllbGQsICAvLyBGcm9udGVuZCB3aWxsIHVzZSBnZXROZXN0ZWRWYWx1ZSgpXG4gICAgICAgICAgICAgICAgZGVmYXVsdFZpc2libGU6IG92ZXJyaWRlLmRlZmF1bHRWaXNpYmxlLFxuICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogJ3RleHQnLCAgLy8gRGVmYXVsdCB0byB0ZXh0IGZvciBjdXN0b20gY29sdW1uc1xuICAgICAgICAgICAgICAgIC4uLihvdmVycmlkZS52aXNpYmlsaXR5ICE9PSB1bmRlZmluZWQgJiYgeyB2aXNpYmlsaXR5OiBvdmVycmlkZS52aXNpYmlsaXR5IH0pLFxuICAgICAgICAgICAgICAgIC4uLihvdmVycmlkZS5yZW5kZXJlciAhPT0gdW5kZWZpbmVkICYmIHsgcmVuZGVyZXI6IG92ZXJyaWRlLnJlbmRlcmVyIH0pLFxuICAgICAgICAgICAgICAgIC4uLihvdmVycmlkZS53aWR0aCAhPT0gdW5kZWZpbmVkICYmIHsgd2lkdGg6IG92ZXJyaWRlLndpZHRoIH0pLFxuICAgICAgICAgICAgICAgIC4uLihvdmVycmlkZS5maXhlZCAhPT0gdW5kZWZpbmVkICYmIHsgZml4ZWQ6IG92ZXJyaWRlLmZpeGVkIH0pLFxuICAgICAgICAgICAgICAgIC4uLihvdmVycmlkZS5ncm91cFRpdGxlICE9PSB1bmRlZmluZWQgJiYgeyBncm91cFRpdGxlOiBvdmVycmlkZS5ncm91cFRpdGxlIH0pLFxuICAgICAgICAgICAgICAgIC4uLihvdmVycmlkZS5mb3JtYXR0aW5nICYmIHsgZm9ybWF0dGluZzogb3ZlcnJpZGUuZm9ybWF0dGluZyB9KSxcbiAgICAgICAgICAgICAgICAuLi4ob3ZlcnJpZGUuY29tcG9zaXRlICYmIHsgY29tcG9zaXRlOiBvdmVycmlkZS5jb21wb3NpdGUgfSksXG4gICAgICAgICAgICAgICAgLi4uKG92ZXJyaWRlLm1hc2tpbmcgJiYgeyBtYXNraW5nOiBvdmVycmlkZS5tYXNraW5nIH0pLFxuICAgICAgICAgICAgICAgIC4uLihvdmVycmlkZS5kZXJpdmVkICYmIHsgZGVyaXZlZDogb3ZlcnJpZGUuZGVyaXZlZCB9KSxcbiAgICAgICAgICAgICAgICBfb3JkZXI6IG92ZXJyaWRlLl9vcmRlclxuICAgICAgICAgICAgfSBhcyBhbnkpO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBTb3J0IGJ5IG9yZGVyIGZyb20gY29sdW1uT3ZlcnJpZGVzIChjb2x1bW5zIG5vdCBpbiBvdmVycmlkZXMgZ28gdG8gZW5kKVxuICAgIG1lcmdlZFByb3BlcnRpZXMuc29ydCgoYTogYW55LCBiOiBhbnkpID0+IChhLl9vcmRlciA/PyBOdW1iZXIuTUFYX1NBRkVfSU5URUdFUikgLSAoYi5fb3JkZXIgPz8gTnVtYmVyLk1BWF9TQUZFX0lOVEVHRVIpKTtcblxuICAgIC8vIFJlbW92ZSB0ZW1wb3JhcnkgX29yZGVyIHByb3BlcnR5XG4gICAgcmV0dXJuIG1lcmdlZFByb3BlcnRpZXMubWFwKCh7IF9vcmRlciwgLi4ucmVzdCB9OiBhbnkpID0+IHJlc3QpO1xufVxuIl19
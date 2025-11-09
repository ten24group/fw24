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
 * Uses generic patterns to find the best display field when entity metadata is missing.
 *
 * Priority order:
 * 1. Entity metadata (entityNameAttribute)
 * 2. Common display field patterns (name, title, label, displayName)
 * 3. Entity-specific patterns ({entityName}Name, {entityName}Title)
 * 4. Fields ending with name-like suffixes (Name, Title, Label, Code)
 * 5. Scored selection of best display field (prefers: strings > enums > booleans > numbers)
 *
 * Automatically excludes:
 * - Technical fields (metadata, currency, gateway, remoteId, etc.)
 * - Sensitive fields (password, token, secret, key, hash)
 * - Timestamp fields (createdAt, updatedAt, deletedAt)
 * - JSON fields (fieldType: 'json')
 * - Relation fields (already ID fields)
 * - Hidden fields (isVisible: false, isListable: false)
 *
 * @example
 * // Entity with clear name field
 * Team: teamName (Priority 3)
 *
 * @example
 * // Entity without name field - uses scoring
 * Subscription: status (enum, score: 130) instead of currency (excluded)
 * PaymentMethod: provider (string, score: 150) instead of metadata (excluded)
 *
 * @param schema - Entity schema
 * @param entityName - Entity name (e.g., 'team', 'user')
 * @returns Best label field name or undefined
 */
function findLabelField(schema, entityName) {
    // Priority 1: Use entity metadata if available
    const entityNameAttribute = schema.model.entityNameAttribute;
    if (entityNameAttribute) {
        return entityNameAttribute;
    }
    // Get all attributes from schema
    const attributes = schema.attributes;
    const attributeNames = Object.keys(attributes);
    // Priority 2: Exact match on common display patterns (case-insensitive)
    const commonPatterns = ['name', 'title', 'label', 'displayName', 'displayname'];
    for (const pattern of commonPatterns) {
        const match = attributeNames.find(attr => attr.toLowerCase() === pattern);
        if (match) {
            return match;
        }
    }
    // Priority 3: Entity-specific patterns ({entityName}Name, {entityName}Title)
    const entityLower = entityName.toLowerCase();
    const entitySpecificSuffixes = ['Name', 'Title', 'Label'];
    for (const suffix of entitySpecificSuffixes) {
        // Try exact match: e.g., 'teamName' for entity 'team'
        const exactMatch = attributeNames.find(attr => attr.toLowerCase() === `${entityLower}${suffix.toLowerCase()}`);
        if (exactMatch) {
            return exactMatch;
        }
    }
    // Priority 4: Fields ending with name-like suffixes
    // Look for any field ending with 'Name', 'Title', 'Label' (e.g., 'displayName', 'fullName', 'userName',)
    const displayNameSuffixPattern = /DisplayName$/;
    const nameSuffixPattern = /Name$/;
    const titleSuffixPattern = /Title$/;
    const labelSuffixPattern = /Label$/;
    const codeSuffixPattern = /Code$/;
    for (const pattern of [displayNameSuffixPattern, labelSuffixPattern, titleSuffixPattern, nameSuffixPattern, codeSuffixPattern]) {
        const match = attributeNames.find(attr => pattern.test(attr));
        if (match) {
            return match;
        }
    }
    // Priority 5: First suitable display field
    // Build list of candidates with scoring
    const candidates = [];
    for (const attrName of attributeNames) {
        const attr = attributes[attrName];
        let score = 0;
        // Skip if explicitly hidden from lists
        if (attr.isListable === false)
            continue;
        // Skip if hidden/not visible
        if (attr.isVisible === false)
            continue;
        // Skip ID fields (unless it's the only option)
        if (attrName.toLowerCase().includes('id'))
            continue;
        // Skip sensitive/technical fields
        const technicalFields = [
            'password', 'token', 'secret', 'key', 'hash',
            'metadata', 'remoteid', 'currency', 'gateway',
            'createdat', 'updatedat', 'deletedat'
        ];
        if (technicalFields.some(tech => attrName.toLowerCase().includes(tech)))
            continue;
        // Skip JSON fields
        if (attr.fieldType === 'json')
            continue;
        // Skip relations (these are IDs)
        if (attr.relation)
            continue;
        // String fields get highest score
        if (attr.type === 'string') {
            score += 100;
            // Prefer required strings
            if (attr.required === true) {
                score += 50;
            }
            // Prioritize fields that sound like identifiers (but not IDs)
            if (attrName.toLowerCase().includes('number'))
                score += 30;
            if (attrName.toLowerCase().includes('code'))
                score += 20;
            if (attrName.toLowerCase().includes('identifier'))
                score += 20;
            if (attrName.toLowerCase().includes('slug'))
                score += 20;
        }
        // Enum fields get good score
        if (Array.isArray(attr.type) && attr.type.length > 0) {
            score += 80;
            // Prefer enums with reasonable counts
            if (attr.type.length <= 10) {
                score += 20;
            }
            // Prefer required enums
            if (attr.required === true) {
                score += 30;
            }
        }
        // Boolean fields get lower score
        if (attr.type === 'boolean') {
            score += 40;
        }
        // Number fields get even lower score
        if (attr.type === 'number') {
            score += 30;
        }
        if (score > 0) {
            candidates.push({ field: attrName, score });
        }
    }
    // Sort by score (highest first)
    candidates.sort((a, b) => b.score - a.score);
    // Return the best candidate
    return candidates.length > 0 ? candidates[0].field : undefined;
}
// =======================================================================================
// RELATION OPTION CONFIG RESOLUTION
// =======================================================================================
/**
 * Resolves RelationEntityOptionConfig into FieldOptionsAPIConfig by auto-detecting:
 * - CRUD API path from entity schema
 * - Label field from entityNameAttribute metadata
 * - Value field from relation identifiers
 *
 * @param relationConfig - Minimal relation option config
 * @param relationAttribute - The relation attribute (to get identifiers)
 * @param entityService - Entity service for schema lookup
 * @returns Fully resolved FieldOptionsAPIConfig or undefined if entity not found
 */
function resolveRelationOptionConfig(relationConfig, relationAttribute, entityService) {
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
        // Auto-detect using smart pattern matching
        labelField = findLabelField(relatedSchema, entityName) || valueField;
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
            resolvedConfig = resolveRelationOptionConfig(options, attribute, entityService);
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
        const resolved = resolveRelationOptionConfig(relationConfig, attribute, entityService);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy91aS1jb25maWctZ2VuL3RlbXBsYXRlcy91dGlsLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBcWhCQSw0REFnQkM7QUFzTEQsa0VBdURDO0FBb0JELG9EQXVOQztBQXVYRCw0Q0F1TkM7QUFNRCxvRkFzUkM7QUFFRCxzRkFrQkM7QUFFRCwwRUFJQztBQUVELDBFQUlDO0FBRUQsMEVBSUM7QUFjRCxzRUF1R0M7QUFrQkQsb0NBd0JDO0FBVUQsb0NBS0M7QUFTRCxvREF3Q0M7QUFTRCxzREF3Q0M7QUE3cEVELHlDQVlzQjtBQUV0Qix5Q0FBOEM7QUFFOUMsMkNBQThDO0FBQzlDLHVDQUE4RDtBQWtEOUQ7O0dBRUc7QUFDSDs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW1CRztBQUNILE1BQU0sd0JBQXdCLEdBQThDO0lBQ3hFLE9BQU8sRUFBRSxJQUFJO0lBQ2IsUUFBUSxFQUFFO1FBQ04sNENBQTRDO1FBQzVDLE9BQU8sRUFBRSxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLGFBQWEsQ0FBQztRQUNsRCw0Q0FBNEM7UUFDNUMsTUFBTSxFQUFFLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFLFNBQVMsQ0FBQztRQUN0RCx3Q0FBd0M7UUFDeEMsSUFBSSxFQUFFLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsWUFBWSxFQUFFLFVBQVUsQ0FBQztLQUMxRDtJQUNELFFBQVEsRUFBRTtRQUNOLDBDQUEwQztRQUMxQyxRQUFRLEVBQUUsT0FBTztRQUNqQixRQUFRLEVBQUUsUUFBUSxFQUFFLGFBQWE7UUFDakMsU0FBUyxFQUFFLFdBQVcsRUFBRSxVQUFVO1FBQ2xDLE1BQU0sRUFBRSxXQUFXLEVBQUUsVUFBVTtRQUMvQixPQUFPLEVBQUUsU0FBUyxFQUFFLFVBQVU7UUFDOUIsT0FBTyxFQUFFLFFBQVEsRUFB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QUssU0FBUyxJQUFJLEVBQUUsVUFBVSxFQUFFLFFBQVEsQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUM3RSxHQUFHLENBQUMsUUFBUSxDQUFDLEtBQUssS0FBSyxTQUFTLElBQUksRUFBRSxLQUFLLEVBQUUsUUFBUSxDQUFDLEtBQUssRUFBRSxDQUFDO1lBQzlELEdBQUcsQ0FBQyxRQUFRLENBQUMsS0FBSyxLQUFLLFNBQVMsSUFBSSxFQUFFLEtBQUssRUFBRSxRQUFRLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDOUQsR0FBRyxDQUFDLFFBQVEsQ0FBQyxVQUFVLEtBQUssU0FBUyxJQUFJLEVBQUUsVUFBVSxFQUFFLFFBQVEsQ0FBQyxVQUFVLEVBQUUsQ0FBQztTQUNoRixDQUFDO0lBQ04sQ0FBQyxDQUFDLENBQUM7QUFDUCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgXG4gICAgQmFzZUVudGl0eVNlcnZpY2UsIFxuICAgIEZpZWxkTWV0YWRhdGEsIFxuICAgIFRJT1NjaGVtYUF0dHJpYnV0ZSwgXG4gICAgaXNTZWxlY3RGaWVsZE1ldGFkYXRhLFxuICAgIFNlbGVjdEZpZWxkTWV0YWRhdGEsXG4gICAgRW50aXR5QXR0cmlidXRlLFxuICAgIElSZWxhdGlvbkZpZWxkQ29uZmlnLFxuICAgIFRJT1NjaGVtYUF0dHJpYnV0ZXNNYXAsXG4gICAgRW50aXR5U2NoZW1hLFxuICAgIElGaWx0ZXJTZWdtZW50LFxuICAgIGNyZWF0ZUZpZWxkT3B0aW9uc1xufSBmcm9tIFwiLi4vLi4vZW50aXR5XCI7XG5pbXBvcnQgdHlwZSB7IFJlbGF0aW9uRW50aXR5T3B0aW9uQ29uZmlnLCBGaWVsZE9wdGlvbnNBUElDb25maWcsIElFbnRpdHlQYWdlQWN0aW9uLCBUZW1wbGF0ZSwgRmllbGRPcHRpb24sIElGaWx0ZXJTZWdtZW50R3JvdXAgfSBmcm9tICcuLi8uLi9lbnRpdHkvYmFzZS1lbnRpdHknO1xuaW1wb3J0IHsgRnJhbWV3b3JrRXJyb3IgfSBmcm9tIFwiLi4vLi4vZXJyb3JzXCI7XG5pbXBvcnQgdHlwZSB7IElBcHBsaWNhdGlvbkNvbmZpZywgSUR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbkNvbmZpZywgSVNlZ21lbnRBdXRvR2VuZXJhdGlvbkNvbmZpZyB9IGZyb20gJy4uLy4uL2ludGVyZmFjZXMvY29uZmlnJztcbmltcG9ydCB7IERlZmF1bHRMb2dnZXIgfSBmcm9tIFwiLi4vLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgcGFzY2FsQ2FzZSwgdG9IdW1hblJlYWRhYmxlTmFtZSB9IGZyb20gXCIuLi8uLi91dGlsc1wiO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNNQVJUIERVUExJQ0FURUQgRklFTEQgREVURUNUSU9OIC0gRU5IQU5DRUQgQUxHT1JJVEhNXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBEZXRlY3Rpb24gcmVzdWx0IHdpdGggcmljaCBtZXRhZGF0YVxuICovXG5pbnRlcmZhY2UgRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uUmVzdWx0IHtcbiAgICAvKiogUHJpbWFyeSBkaXNwbGF5IGZpZWxkIGRldGVjdGVkIChlLmcuLCAndGVhbU5hbWUnKSAqL1xuICAgIHByaW1hcnlGaWVsZD86IHN0cmluZztcbiAgICBcbiAgICAvKiogR2VuZXJhdGVkIHRlbXBsYXRlIHN0cmluZyAoZS5nLiwgJ3t0ZWFtTmFtZX0nIG9yICd7dGVhbU5hbWV9ICh7dGVhbUNvZGV9KScpICovXG4gICAgdGVtcGxhdGU/OiBzdHJpbmc7XG4gICAgXG4gICAgLyoqIEFsbCBkZXRlY3RlZCBmaWVsZHMgYnkgY2F0ZWdvcnkgKi9cbiAgICBkZXRlY3RlZEZpZWxkczoge1xuICAgICAgICAvKiogRGlzcGxheSBmaWVsZHM6IE5hbWUsIFRpdGxlLCBMYWJlbCAqL1xuICAgICAgICBkaXNwbGF5Pzogc3RyaW5nW107XG4gICAgICAgIC8qKiBWaXN1YWwgZmllbGRzOiBMb2dvLCBJbWFnZSwgSWNvbiAqL1xuICAgICAgICB2aXN1YWw/OiBzdHJpbmdbXTtcbiAgICAgICAgLyoqIE1ldGEgZmllbGRzOiBDb2RlLCBTbHVnLCBLZXkgKi9cbiAgICAgICAgbWV0YT86IHN0cmluZ1tdO1xuICAgIH07XG4gICAgXG4gICAgLyoqIENvbmZpZGVuY2UgbGV2ZWwgKi9cbiAgICBjb25maWRlbmNlOiAnaGlnaCcgfCAnbWVkaXVtJyB8ICdsb3cnO1xuICAgIFxuICAgIC8qKiBEZXRlY3Rpb24gbWV0aG9kIHVzZWQgKi9cbiAgICBtZXRob2Q6IHN0cmluZztcbiAgICBcbiAgICAvKiogUGF0dGVybiB0aGF0IG1hdGNoZWQgKi9cbiAgICBwYXR0ZXJuOiBzdHJpbmc7XG59XG5cbi8qKlxuICogUGFyc2VkIGNvbXBvbmVudHMgZnJvbSByZWxhdGlvbiBmaWVsZCBuYW1lXG4gKi9cbmludGVyZmFjZSBQYXJzZWRSZWxhdGlvbkZpZWxkIHtcbiAgICAvKiogUHJlZml4IChlLmcuLCAnaG9tZScsICdhd2F5JywgJ2NvbXBldGl0b3IxJykgKi9cbiAgICBwcmVmaXg/OiBzdHJpbmc7XG4gICAgLyoqIEJhc2UgbmFtZSB3aXRob3V0IHByZWZpeCBhbmQgJ0lkJyBzdWZmaXggKGUuZy4sICdUZWFtJykgKi9cbiAgICBiYXNlTmFtZTogc3RyaW5nO1xuICAgIC8qKiBXaGV0aGVyIGZpZWxkIGVuZHMgd2l0aCAnSWQnICovXG4gICAgaGFzSWRTdWZmaXg6IGJvb2xlYW47XG4gICAgLyoqIE9yaWdpbmFsIGZpZWxkIG5hbWUgKi9cbiAgICBvcmlnaW5hbEZpZWxkOiBzdHJpbmc7XG59XG5cbi8qKlxuICogU21hcnQgZGVmYXVsdCBjb25maWd1cmF0aW9uXG4gKi9cbi8qKlxuICogRnJhbWV3b3JrLWxldmVsIGRlZmF1bHQgZGV0ZWN0aW9uIGNvbmZpZy5cbiAqIENvbnRhaW5zIE9OTFkgZG9tYWluLWFnbm9zdGljIHBhdHRlcm5zIHRoYXQgd29yayBhY3Jvc3MgYW55IGFwcGxpY2F0aW9uLlxuICogXG4gKiBBcHBsaWNhdGlvbnMgc2hvdWxkIHByb3ZpZGUgZG9tYWluLXNwZWNpZmljIHByZWZpeGVzIHZpYSB1aUNvbmZpZ09wdGlvbnMuXG4gKiBcbiAqIEBleGFtcGxlIEFwcGxpY2F0aW9uLXNwZWNpZmljIGNvbmZpZyAoaW4gYmFja2VuZCBpbmRleC50cyk6XG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCB1aUNvbmZpZ09wdGlvbnMgPSB7XG4gKiAgIGR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbjoge1xuICogICAgIHByZWZpeGVzOiBbXG4gKiAgICAgICAvLyBEb21haW4tc3BlY2lmaWMgcHJlZml4ZXMgZm9yIHlvdXIgYXBwXG4gKiAgICAgICAncGxheWVyJywgJ3RlYW0nLCAnbGVhZ3VlJywgJ3NlYXNvbicsICd2ZW51ZScsICdzcG9ydCcsICAvLyBTcG9ydHMgYXBwXG4gKiAgICAgICAvLyBPUjogJ2N1c3RvbWVyJywgJ29yZGVyJywgJ3Byb2R1Y3QnLCAnaW52b2ljZScgIC8vIEUtY29tbWVyY2UgYXBwXG4gKiAgICAgICAvLyBPUjogJ2F1dGhvcicsICdib29rJywgJ3B1Ymxpc2hlcicsICdnZW5yZScgIC8vIExpYnJhcnkgYXBwXG4gKiAgICAgXVxuICogICB9XG4gKiB9O1xuICogYGBgXG4gKi9cbmNvbnN0IERFRkFVTFRfREVURUNUSU9OX0NPTkZJRzogUmVxdWlyZWQ8SUR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbkNvbmZpZz4gPSB7XG4gICAgZW5hYmxlZDogdHJ1ZSxcbiAgICBzdWZmaXhlczoge1xuICAgICAgICAvLyBHZW5lcmljIGRpc3BsYXkgdGV4dCBwYXR0ZXJucyAodW5pdmVyc2FsKVxuICAgICAgICBkaXNwbGF5OiBbJ05hbWUnLCAnVGl0bGUnLCAnTGFiZWwnLCAnRGlzcGxheU5hbWUnXSxcbiAgICAgICAgLy8gR2VuZXJpYyB2aXN1YWwgYXNzZXQgcGF0dGVybnMgKHVuaXZlcnNhbClcbiAgICAgICAgdmlzdWFsOiBbJ0xvZ28nLCAnSW1hZ2UnLCAnSWNvbicsICdBdmF0YXInLCAnUGljdHVyZSddLFxuICAgICAgICAvLyBHZW5lcmljIG1ldGFkYXRhIHBhdHRlcm5zICh1bml2ZXJzYWwpXG4gICAgICAgIG1ldGE6IFsnQ29kZScsICdTbHVnJywgJ0tleScsICdJZGVudGlmaWVyJywgJ1JlbW90ZUlkJ11cbiAgICB9LFxuICAgIHByZWZpeGVzOiBbXG4gICAgICAgIC8vIEdlbmVyaWMgcmVsYXRpb25hbCBwYXR0ZXJucyAodW5pdmVyc2FsKVxuICAgICAgICAncGFyZW50JywgJ2NoaWxkJyxcbiAgICAgICAgJ3NvdXJjZScsICd0YXJnZXQnLCAnZGVzdGluYXRpb24nLFxuICAgICAgICAncHJpbWFyeScsICdzZWNvbmRhcnknLCAndGVydGlhcnknLFxuICAgICAgICAnbWFpbicsICdhbHRlcm5hdGUnLCAnZmFsbGJhY2snLFxuICAgICAgICAnb3duZXInLCAnY3JlYXRvcicsICdtb2RpZmllcicsXG4gICAgICAgICdmaXJzdCcsICdzZWNvbmQnLCAndGhpcmQnLCAnbGFzdCcsXG4gICAgICAgICdwcmV2aW91cycsICduZXh0JywgJ2N1cnJlbnQnLFxuICAgICAgICAnb2xkJywgJ25ldycsXG4gICAgICAgICdvcmlnaW5hbCcsICdjb3B5JywgJ2RyYWZ0JyxcbiAgICAgICAgXG4gICAgICAgIC8vIEdlbmVyaWMgZGlyZWN0aW9uYWwgcGF0dGVybnMgKHVuaXZlcnNhbClcbiAgICAgICAgJ2hvbWUnLCAnYXdheScsXG4gICAgICAgICdsZWZ0JywgJ3JpZ2h0JyxcbiAgICAgICAgJ3RvcCcsICdib3R0b20nLFxuICAgICAgICAnaW5uZXInLCAnb3V0ZXInLFxuICAgICAgICBcbiAgICAgICAgLy8gR2VuZXJpYyBjb21wZXRpdGl2ZSBwYXR0ZXJucyAodW5pdmVyc2FsKVxuICAgICAgICAnd2lubmVyJywgJ2xvc2VyJyxcbiAgICAgICAgJ2NvbXBldGl0b3InLCAnb3Bwb25lbnQnXG4gICAgICAgIFxuICAgICAgICAvLyBOT1RFOiBEb21haW4tc3BlY2lmaWMgcHJlZml4ZXMgKHBsYXllciwgdGVhbSwgY3VzdG9tZXIsIG9yZGVyLCBldGMuKVxuICAgICAgICAvLyBzaG91bGQgYmUgcHJvdmlkZWQgdmlhIHVpQ29uZmlnT3B0aW9ucyBpbiB5b3VyIGFwcGxpY2F0aW9uJ3MgYmFja2VuZFxuICAgIF0sXG4gICAgdGVtcGxhdGVTdHlsZTogJ3NpbXBsZScsXG4gICAgY29uZmlkZW5jZVRocmVzaG9sZDogJ21lZGl1bScsXG4gICAgZGVidWc6IGZhbHNlXG59O1xuXG4vKipcbiAqIE1lcmdlIGNvbmZpZ3VyYXRpb25zIHdpdGggcHJpb3JpdHk6IGhpbnRzID4gZW50aXR5ID4gZ2xvYmFsID4gZGVmYXVsdHNcbiAqL1xuZnVuY3Rpb24gbWVyZ2VEZXRlY3Rpb25Db25maWdzKFxuICAgIGdsb2JhbENvbmZpZz86IElEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25Db25maWcsXG4gICAgZW50aXR5Q29uZmlnPzogSUR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbkNvbmZpZyxcbiAgICByZWxhdGlvbkhpbnRzPzoge1xuICAgICAgICBwcmVmZXJyZWRGaWVsZHM/OiBzdHJpbmdbXTtcbiAgICAgICAgZXhjbHVkZUZpZWxkcz86IHN0cmluZ1tdO1xuICAgICAgICB0ZW1wbGF0ZVN0eWxlPzogJ3NpbXBsZScgfCAnY29tcG9zaXRlJztcbiAgICB9XG4pOiBSZXF1aXJlZDxJRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uQ29uZmlnPiAmIHsgcHJlZmVycmVkRmllbGRzPzogc3RyaW5nW107IGV4Y2x1ZGVGaWVsZHM/OiBzdHJpbmdbXSB9IHtcbiAgICAvLyBTdGFydCB3aXRoIGRlZmF1bHRzXG4gICAgbGV0IG1lcmdlZCA9IHsgLi4uREVGQVVMVF9ERVRFQ1RJT05fQ09ORklHIH07XG4gICAgXG4gICAgLy8gQXBwbHkgZ2xvYmFsIGNvbmZpZ1xuICAgIGlmIChnbG9iYWxDb25maWcpIHtcbiAgICAgICAgbWVyZ2VkID0ge1xuICAgICAgICAgICAgLi4ubWVyZ2VkLFxuICAgICAgICAgICAgLi4uZ2xvYmFsQ29uZmlnLFxuICAgICAgICAgICAgc3VmZml4ZXM6IHsgLi4ubWVyZ2VkLnN1ZmZpeGVzLCAuLi5nbG9iYWxDb25maWcuc3VmZml4ZXMgfSxcbiAgICAgICAgICAgIHByZWZpeGVzOiBnbG9iYWxDb25maWcucHJlZml4ZXMgfHwgbWVyZ2VkLnByZWZpeGVzXG4gICAgICAgIH07XG4gICAgfVxuICAgIFxuICAgIC8vIEFwcGx5IGVudGl0eSBjb25maWcgKGhpZ2hlciBwcmlvcml0eSlcbiAgICBpZiAoZW50aXR5Q29uZmlnKSB7XG4gICAgICAgIG1lcmdlZCA9IHtcbiAgICAgICAgICAgIC4uLm1lcmdlZCxcbiAgICAgICAgICAgIC4uLmVudGl0eUNvbmZpZyxcbiAgICAgICAgICAgIHN1ZmZpeGVzOiB7IC4uLm1lcmdlZC5zdWZmaXhlcywgLi4uZW50aXR5Q29uZmlnLnN1ZmZpeGVzIH0sXG4gICAgICAgICAgICBwcmVmaXhlczogZW50aXR5Q29uZmlnLnByZWZpeGVzIHx8IG1lcmdlZC5wcmVmaXhlc1xuICAgICAgICB9O1xuICAgIH1cbiAgICBcbiAgICAvLyBBcHBseSByZWxhdGlvbiBoaW50cyAoaGlnaGVzdCBwcmlvcml0eSlcbiAgICBjb25zdCByZXN1bHQ6IGFueSA9IHsgLi4ubWVyZ2VkIH07XG4gICAgaWYgKHJlbGF0aW9uSGludHMpIHtcbiAgICAgICAgaWYgKHJlbGF0aW9uSGludHMudGVtcGxhdGVTdHlsZSkge1xuICAgICAgICAgICAgcmVzdWx0LnRlbXBsYXRlU3R5bGUgPSByZWxhdGlvbkhpbnRzLnRlbXBsYXRlU3R5bGU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlbGF0aW9uSGludHMucHJlZmVycmVkRmllbGRzKSB7XG4gICAgICAgICAgICByZXN1bHQucHJlZmVycmVkRmllbGRzID0gcmVsYXRpb25IaW50cy5wcmVmZXJyZWRGaWVsZHM7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlbGF0aW9uSGludHMuZXhjbHVkZUZpZWxkcykge1xuICAgICAgICAgICAgcmVzdWx0LmV4Y2x1ZGVGaWVsZHMgPSByZWxhdGlvbkhpbnRzLmV4Y2x1ZGVGaWVsZHM7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLyoqXG4gKiBQYXJzZSByZWxhdGlvbiBmaWVsZCB0byBleHRyYWN0IHByZWZpeCBhbmQgYmFzZSBuYW1lLlxuICogXG4gKiBFeGFtcGxlczpcbiAqIC0gJ3RlYW1JZCcg4oaSIHsgYmFzZU5hbWU6ICdUZWFtJywgaGFzSWRTdWZmaXg6IHRydWUgfVxuICogLSAnaG9tZVRlYW1JZCcg4oaSIHsgcHJlZml4OiAnaG9tZScsIGJhc2VOYW1lOiAnVGVhbScsIGhhc0lkU3VmZml4OiB0cnVlIH1cbiAqIC0gJ2NvbXBldGl0b3IxVGVhbUlkJyDihpIgeyBwcmVmaXg6ICdjb21wZXRpdG9yMScsIGJhc2VOYW1lOiAnVGVhbScsIGhhc0lkU3VmZml4OiB0cnVlIH1cbiAqIC0gJ3Nwb3J0JyDihpIgeyBiYXNlTmFtZTogJ3Nwb3J0JywgaGFzSWRTdWZmaXg6IGZhbHNlIH1cbiAqL1xuZnVuY3Rpb24gcGFyc2VSZWxhdGlvbkZpZWxkKFxuICAgIGZpZWxkSWQ6IHN0cmluZyxcbiAgICBwcmVmaXhlczogc3RyaW5nW11cbik6IFBhcnNlZFJlbGF0aW9uRmllbGQge1xuICAgIC8vIEJ1aWxkIHJlZ2V4IGZvciBwcmVmaXggZGV0ZWN0aW9uOiBeKHByZWZpeDF8cHJlZml4MnwuLi4pKFxcXFxkKikoLispJFxuICAgIC8vIFVzZSBjYXNlLWluc2Vuc2l0aXZlIG1hdGNoaW5nXG4gICAgY29uc3QgcHJlZml4UGF0dGVybiA9IG5ldyBSZWdFeHAoXG4gICAgICAgIGBeKCR7cHJlZml4ZXMuam9pbignfCcpfSkoXFxcXGQqKSguKykkYCxcbiAgICAgICAgJ2knXG4gICAgKTtcbiAgICBcbiAgICBjb25zdCBtYXRjaCA9IGZpZWxkSWQubWF0Y2gocHJlZml4UGF0dGVybik7XG4gICAgXG4gICAgaWYgKG1hdGNoKSB7XG4gICAgICAgIGNvbnN0IFssIHByZWZpeCwgbnVtLCByZXN0XSA9IG1hdGNoO1xuICAgICAgICBjb25zdCBoYXNJZFN1ZmZpeCA9IHJlc3QudG9Mb3dlckNhc2UoKS5lbmRzV2l0aCgnaWQnKTtcbiAgICAgICAgY29uc3QgYmFzZU5hbWUgPSBoYXNJZFN1ZmZpeCBcbiAgICAgICAgICAgID8gcmVzdC5zdWJzdHJpbmcoMCwgcmVzdC5sZW5ndGggLSAyKVxuICAgICAgICAgICAgOiByZXN0O1xuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHByZWZpeDogcHJlZml4ICsgbnVtLCAgLy8gJ2hvbWUnIG9yICdjb21wZXRpdG9yMSdcbiAgICAgICAgICAgIGJhc2VOYW1lLFxuICAgICAgICAgICAgaGFzSWRTdWZmaXgsXG4gICAgICAgICAgICBvcmlnaW5hbEZpZWxkOiBmaWVsZElkXG4gICAgICAgIH07XG4gICAgfVxuICAgIFxuICAgIC8vIE5vIHByZWZpeCBkZXRlY3RlZFxuICAgIGNvbnN0IGhhc0lkU3VmZml4ID0gZmllbGRJZC50b0xvd2VyQ2FzZSgpLmVuZHNXaXRoKCdpZCcpO1xuICAgIGNvbnN0IGJhc2VOYW1lID0gaGFzSWRTdWZmaXggXG4gICAgICAgID8gZmllbGRJZC5zdWJzdHJpbmcoMCwgZmllbGRJZC5sZW5ndGggLSAyKVxuICAgICAgICA6IGZpZWxkSWQ7XG4gICAgXG4gICAgcmV0dXJuIHtcbiAgICAgICAgYmFzZU5hbWUsXG4gICAgICAgIGhhc0lkU3VmZml4LFxuICAgICAgICBvcmlnaW5hbEZpZWxkOiBmaWVsZElkXG4gICAgfTtcbn1cblxuLyoqXG4gKiBHZW5lcmF0ZSBzZWFyY2ggcGF0dGVybnMgZm9yIGNhbmRpZGF0ZSBmaWVsZCBuYW1lcy5cbiAqIFxuICogUHJpb3JpdHk6XG4gKiAxLiBQcmVmZXJyZWQgZmllbGRzIChmcm9tIGhpbnRzKVxuICogMi4gRXhhY3QgcHJlZml4IG1hdGNoOiB7cHJlZml4fXtiYXNlTmFtZX17c3VmZml4fVxuICogMy4gRW50aXR5IG5hbWUgbWF0Y2g6IHtlbnRpdHlOYW1lfXtzdWZmaXh9XG4gKiA0LiBCYXNlIG5hbWUgbWF0Y2g6IHtiYXNlTmFtZX17c3VmZml4fVxuICovXG5mdW5jdGlvbiBnZW5lcmF0ZVNlYXJjaFBhdHRlcm5zKFxuICAgIHBhcnNlZDogUGFyc2VkUmVsYXRpb25GaWVsZCxcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgc3VmZml4ZXM6IHN0cmluZ1tdLFxuICAgIHByZWZlcnJlZEZpZWxkcz86IHN0cmluZ1tdXG4pOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgcGF0dGVybnM6IHN0cmluZ1tdID0gW107XG4gICAgY29uc3QgZW50aXR5TmFtZUxvd2VyID0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IGJhc2VOYW1lTG93ZXIgPSBwYXJzZWQuYmFzZU5hbWUudG9Mb3dlckNhc2UoKTtcbiAgICBcbiAgICAvLyBQcmlvcml0eSAxOiBQcmVmZXJyZWQgZmllbGRzIChleGFjdCBtYXRjaClcbiAgICBpZiAocHJlZmVycmVkRmllbGRzICYmIHByZWZlcnJlZEZpZWxkcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goLi4ucHJlZmVycmVkRmllbGRzKTtcbiAgICB9XG4gICAgXG4gICAgLy8gUHJpb3JpdHkgMjogV2l0aCBwcmVmaXggKGUuZy4sIGhvbWVUZWFtTmFtZSwgYXdheVRlYW1OYW1lKVxuICAgIGlmIChwYXJzZWQucHJlZml4KSB7XG4gICAgICAgIGNvbnN0IHByZWZpeExvd2VyID0gcGFyc2VkLnByZWZpeC50b0xvd2VyQ2FzZSgpO1xuICAgICAgICBmb3IgKGNvbnN0IHN1ZmZpeCBvZiBzdWZmaXhlcykge1xuICAgICAgICAgICAgcGF0dGVybnMucHVzaChgJHtwcmVmaXhMb3dlcn0ke2Jhc2VOYW1lTG93ZXJ9JHtzdWZmaXgudG9Mb3dlckNhc2UoKX1gKTtcbiAgICAgICAgICAgIHBhdHRlcm5zLnB1c2goYCR7cHJlZml4TG93ZXJ9JHtlbnRpdHlOYW1lTG93ZXJ9JHtzdWZmaXgudG9Mb3dlckNhc2UoKX1gKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICAvLyBQcmlvcml0eSAzOiBFbnRpdHkgbmFtZSAoZS5nLiwgdGVhbU5hbWUgZm9yIHJlbGF0aW9uIHRvICd0ZWFtJylcbiAgICBmb3IgKGNvbnN0IHN1ZmZpeCBvZiBzdWZmaXhlcykge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGAke2VudGl0eU5hbWVMb3dlcn0ke3N1ZmZpeC50b0xvd2VyQ2FzZSgpfWApO1xuICAgIH1cbiAgICBcbiAgICAvLyBQcmlvcml0eSA0OiBCYXNlIG5hbWUgKGUuZy4sIHRlYW1OYW1lIGZvciAndGVhbUlkJylcbiAgICBmb3IgKGNvbnN0IHN1ZmZpeCBvZiBzdWZmaXhlcykge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGAke2Jhc2VOYW1lTG93ZXJ9JHtzdWZmaXgudG9Mb3dlckNhc2UoKX1gKTtcbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIHBhdHRlcm5zO1xufVxuXG4vKipcbiAqIFNlYXJjaCBmb3IgZmllbGRzIG1hdGNoaW5nIHBhdHRlcm5zLCBleGNsdWRpbmcgc3BlY2lmaWVkIGZpZWxkcy5cbiAqL1xuZnVuY3Rpb24gc2VhcmNoRmllbGRzQnlQYXR0ZXJucyhcbiAgICBhbGxQcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSxcbiAgICBwYXR0ZXJuczogc3RyaW5nW10sXG4gICAgZXhjbHVkZUZpZWxkcz86IHN0cmluZ1tdXG4pOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgZXhjbHVkZVNldCA9IG5ldyBTZXQoZXhjbHVkZUZpZWxkcz8ubWFwKGYgPT4gZi50b0xvd2VyQ2FzZSgpKSB8fCBbXSk7XG4gICAgY29uc3QgZm91bmQ6IHN0cmluZ1tdID0gW107XG4gICAgY29uc3Qgc2Vlbkxvd2VyID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgXG4gICAgZm9yIChjb25zdCBwYXR0ZXJuIG9mIHBhdHRlcm5zKSB7XG4gICAgICAgIGNvbnN0IHBhdHRlcm5Mb3dlciA9IHBhdHRlcm4udG9Mb3dlckNhc2UoKTtcbiAgICAgICAgXG4gICAgICAgIC8vIFNraXAgaWYgYWxyZWFkeSBmb3VuZCBvciBleGNsdWRlZFxuICAgICAgICBpZiAoc2Vlbkxvd2VyLmhhcyhwYXR0ZXJuTG93ZXIpIHx8IGV4Y2x1ZGVTZXQuaGFzKHBhdHRlcm5Mb3dlcikpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBGaW5kIG1hdGNoaW5nIGZpZWxkIChjYXNlLWluc2Vuc2l0aXZlKVxuICAgICAgICBjb25zdCBtYXRjaCA9IGFsbFByb3BlcnRpZXMuZmluZChwID0+IFxuICAgICAgICAgICAgcC5pZD8udG9Mb3dlckNhc2UoKSA9PT0gcGF0dGVybkxvd2VyICYmXG4gICAgICAgICAgICAhZXhjbHVkZVNldC5oYXMocC5pZC50b0xvd2VyQ2FzZSgpKVxuICAgICAgICApO1xuICAgICAgICBcbiAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgICBmb3VuZC5wdXNoKG1hdGNoLmlkKTtcbiAgICAgICAgICAgIHNlZW5Mb3dlci5hZGQobWF0Y2guaWQudG9Mb3dlckNhc2UoKSk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIGZvdW5kO1xufVxuXG4vKipcbiAqIENhbGN1bGF0ZSBjb25maWRlbmNlIGJhc2VkIG9uIGRldGVjdGlvbiBtZXRob2QgYW5kIHBhdHRlcm5cbiAqL1xuZnVuY3Rpb24gY2FsY3VsYXRlQ29uZmlkZW5jZShcbiAgICBkZXRlY3RlZEZpZWxkOiBzdHJpbmcsXG4gICAgcGFyc2VkOiBQYXJzZWRSZWxhdGlvbkZpZWxkLFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBtZXRob2Q6ICdwcmVmZXJyZWQnIHwgJ3ByZWZpeCcgfCAnZW50aXR5JyB8ICdiYXNlJ1xuKTogJ2hpZ2gnIHwgJ21lZGl1bScgfCAnbG93JyB7XG4gICAgLy8gUHJlZmVycmVkIGZpZWxkcyA9IGhpZ2ggY29uZmlkZW5jZSAoZGV2ZWxvcGVyIGV4cGxpY2l0bHkgc3BlY2lmaWVkKVxuICAgIGlmIChtZXRob2QgPT09ICdwcmVmZXJyZWQnKSByZXR1cm4gJ2hpZ2gnO1xuICAgIFxuICAgIGNvbnN0IGZpZWxkTG93ZXIgPSBkZXRlY3RlZEZpZWxkLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgZW50aXR5TG93ZXIgPSBlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgYmFzZUxvd2VyID0gcGFyc2VkLmJhc2VOYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgXG4gICAgLy8gRXhhY3QgcHJlZml4ICsgZW50aXR5L2Jhc2UgbWF0Y2ggPSBoaWdoXG4gICAgaWYgKG1ldGhvZCA9PT0gJ3ByZWZpeCcpIHtcbiAgICAgICAgaWYgKGZpZWxkTG93ZXIuaW5jbHVkZXMoZW50aXR5TG93ZXIpIHx8IGZpZWxkTG93ZXIuaW5jbHVkZXMoYmFzZUxvd2VyKSkge1xuICAgICAgICAgICAgcmV0dXJuICdoaWdoJztcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gJ21lZGl1bSc7XG4gICAgfVxuICAgIFxuICAgIC8vIEVudGl0eSBuYW1lIG1hdGNoID0gaGlnaFxuICAgIGlmIChtZXRob2QgPT09ICdlbnRpdHknKSByZXR1cm4gJ2hpZ2gnO1xuICAgIFxuICAgIC8vIEJhc2UgbmFtZSBtYXRjaCA9IG1lZGl1bSAoY291bGQgYmUgY29pbmNpZGVudGFsKVxuICAgIGlmIChtZXRob2QgPT09ICdiYXNlJykgcmV0dXJuICdtZWRpdW0nO1xuICAgIFxuICAgIHJldHVybiAnbG93Jztcbn1cblxuLyoqXG4gKiBHZW5lcmF0ZSB0ZW1wbGF0ZSBzdHJpbmcgZnJvbSBkZXRlY3RlZCBmaWVsZHMuXG4gKi9cbmZ1bmN0aW9uIGdlbmVyYXRlVGVtcGxhdGUoXG4gICAgcHJpbWFyeUZpZWxkOiBzdHJpbmcsXG4gICAgYWxsRGV0ZWN0ZWRGaWVsZHM6IER1cGxpY2F0ZWRGaWVsZERldGVjdGlvblJlc3VsdFsnZGV0ZWN0ZWRGaWVsZHMnXSxcbiAgICB0ZW1wbGF0ZVN0eWxlOiAnc2ltcGxlJyB8ICdjb21wb3NpdGUnXG4pOiBzdHJpbmcge1xuICAgIGlmICh0ZW1wbGF0ZVN0eWxlID09PSAnc2ltcGxlJykge1xuICAgICAgICByZXR1cm4gYHske3ByaW1hcnlGaWVsZH19YDtcbiAgICB9XG4gICAgXG4gICAgLy8gQ29tcG9zaXRlOiB0cnkgdG8gaW5jbHVkZSBtZXRhIGZpZWxkIChjb2RlL3NsdWcpIGlmIGF2YWlsYWJsZVxuICAgIGlmICh0ZW1wbGF0ZVN0eWxlID09PSAnY29tcG9zaXRlJyAmJiBhbGxEZXRlY3RlZEZpZWxkcy5tZXRhICYmIGFsbERldGVjdGVkRmllbGRzLm1ldGEubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBtZXRhRmllbGQgPSBhbGxEZXRlY3RlZEZpZWxkcy5tZXRhWzBdO1xuICAgICAgICByZXR1cm4gYHske3ByaW1hcnlGaWVsZH19ICh7JHttZXRhRmllbGR9fSlgO1xuICAgIH1cbiAgICBcbiAgICAvLyBGYWxsYmFjayB0byBzaW1wbGUgaWYgbm8gbWV0YSBmaWVsZFxuICAgIHJldHVybiBgeyR7cHJpbWFyeUZpZWxkfX1gO1xufVxuXG4vKipcbiAqIEVuaGFuY2VkIHNtYXJ0IGR1cGxpY2F0ZWQgZmllbGQgZGV0ZWN0aW9uLlxuICogXG4gKiBEZXRlY3RzIGZpZWxkcyBsaWtlICd0ZWFtTmFtZScgZm9yICd0ZWFtSWQnIHJlbGF0aW9ucyB3aXRoIHN1cHBvcnQgZm9yOlxuICogLSBQcmVmaXhlcyAoaG9tZSwgYXdheSwgY29tcGV0aXRvcjEsIGV0Yy4pXG4gKiAtIE11bHRpcGxlIHN1ZmZpeGVzIChOYW1lLCBUaXRsZSwgTGFiZWwsIExvZ28sIENvZGUsIGV0Yy4pXG4gKiAtIFByZWZlcnJlZCBmaWVsZHMgYW5kIGV4Y2x1c2lvbnNcbiAqIC0gQ29uZmlkZW5jZSBzY29yaW5nXG4gKiAtIENvbXBvc2l0ZSB0ZW1wbGF0ZXNcbiAqIFxuICogQHBhcmFtIGFsbFByb3BlcnRpZXMgLSBBbGwgcHJvcGVydGllcyBpbiB0aGUgcGFyZW50IGVudGl0eVxuICogQHBhcmFtIHJlbGF0aW9uRmllbGRJZCAtIFRoZSByZWxhdGlvbiBmaWVsZCBuYW1lIChlLmcuLCAndGVhbUlkJywgJ2hvbWVUZWFtSWQnKVxuICogQHBhcmFtIHJlbGF0ZWRFbnRpdHlOYW1lIC0gUmVsYXRlZCBlbnRpdHkgbmFtZSAoZS5nLiwgJ3RlYW0nKVxuICogQHBhcmFtIGdsb2JhbENvbmZpZyAtIEdsb2JhbCBkZXRlY3Rpb24gY29uZmlndXJhdGlvblxuICogQHBhcmFtIGVudGl0eUNvbmZpZyAtIEVudGl0eS1sZXZlbCBkZXRlY3Rpb24gY29uZmlndXJhdGlvblxuICogQHBhcmFtIHJlbGF0aW9uSGludHMgLSBSZWxhdGlvbi1zcGVjaWZpYyBoaW50c1xuICogQHJldHVybnMgRGV0ZWN0aW9uIHJlc3VsdCB3aXRoIHRlbXBsYXRlIGFuZCBtZXRhZGF0YVxuICovXG5mdW5jdGlvbiBkZXRlY3REdXBsaWNhdGVkUmVsYXRpb25GaWVsZHMoXG4gICAgYWxsUHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sXG4gICAgcmVsYXRpb25GaWVsZElkOiBzdHJpbmcsXG4gICAgcmVsYXRlZEVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBnbG9iYWxDb25maWc/OiBJRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uQ29uZmlnLFxuICAgIGVudGl0eUNvbmZpZz86IElEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25Db25maWcsXG4gICAgcmVsYXRpb25IaW50cz86IHtcbiAgICAgICAgcHJlZmVycmVkRmllbGRzPzogc3RyaW5nW107XG4gICAgICAgIGV4Y2x1ZGVGaWVsZHM/OiBzdHJpbmdbXTtcbiAgICAgICAgdGVtcGxhdGVTdHlsZT86ICdzaW1wbGUnIHwgJ2NvbXBvc2l0ZSc7XG4gICAgfVxuKTogRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uUmVzdWx0IHwgdW5kZWZpbmVkIHtcbiAgICAvLyBNZXJnZSBjb25maWd1cmF0aW9uc1xuICAgIGNvbnN0IGNvbmZpZyA9IG1lcmdlRGV0ZWN0aW9uQ29uZmlncyhnbG9iYWxDb25maWcsIGVudGl0eUNvbmZpZywgcmVsYXRpb25IaW50cyk7XG4gICAgXG4gICAgLy8gQ2hlY2sgaWYgZGV0ZWN0aW9uIGlzIGVuYWJsZWRcbiAgICBpZiAoIWNvbmZpZy5lbmFibGVkKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIFxuICAgIC8vIFBhcnNlIHJlbGF0aW9uIGZpZWxkXG4gICAgY29uc3QgcGFyc2VkID0gcGFyc2VSZWxhdGlvbkZpZWxkKHJlbGF0aW9uRmllbGRJZCwgY29uZmlnLnByZWZpeGVzKTtcbiAgICBcbiAgICAvLyBTZWFyY2ggZm9yIGRpc3BsYXkgZmllbGRzIChOYW1lLCBUaXRsZSwgTGFiZWwpXG4gICAgY29uc3QgZGlzcGxheVBhdHRlcm5zID0gZ2VuZXJhdGVTZWFyY2hQYXR0ZXJucyhcbiAgICAgICAgcGFyc2VkLFxuICAgICAgICByZWxhdGVkRW50aXR5TmFtZSxcbiAgICAgICAgY29uZmlnLnN1ZmZpeGVzPy5kaXNwbGF5IHx8IFtdLFxuICAgICAgICBjb25maWcucHJlZmVycmVkRmllbGRzXG4gICAgKTtcbiAgICBjb25zdCBkaXNwbGF5RmllbGRzID0gc2VhcmNoRmllbGRzQnlQYXR0ZXJucyhhbGxQcm9wZXJ0aWVzLCBkaXNwbGF5UGF0dGVybnMsIGNvbmZpZy5leGNsdWRlRmllbGRzKTtcbiAgICBcbiAgICAvLyBTZWFyY2ggZm9yIHZpc3VhbCBmaWVsZHMgKExvZ28sIEltYWdlLCBJY29uKVxuICAgIGNvbnN0IHZpc3VhbFBhdHRlcm5zID0gZ2VuZXJhdGVTZWFyY2hQYXR0ZXJucyhcbiAgICAgICAgcGFyc2VkLFxuICAgICAgICByZWxhdGVkRW50aXR5TmFtZSxcbiAgICAgICAgY29uZmlnLnN1ZmZpeGVzPy52aXN1YWwgfHwgW11cbiAgICApO1xuICAgIGNvbnN0IHZpc3VhbEZpZWxkcyA9IHNlYXJjaEZpZWxkc0J5UGF0dGVybnMoYWxsUHJvcGVydGllcywgdmlzdWFsUGF0dGVybnMsIGNvbmZpZy5leGNsdWRlRmllbGRzKTtcbiAgICBcbiAgICAvLyBTZWFyY2ggZm9yIG1ldGEgZmllbGRzIChDb2RlLCBTbHVnLCBLZXkpXG4gICAgY29uc3QgbWV0YVBhdHRlcm5zID0gZ2VuZXJhdGVTZWFyY2hQYXR0ZXJucyhcbiAgICAgICAgcGFyc2VkLFxuICAgICAgICByZWxhdGVkRW50aXR5TmFtZSxcbiAgICAgICAgY29uZmlnLnN1ZmZpeGVzPy5tZXRhIHx8IFtdXG4gICAgKTtcbiAgICBjb25zdCBtZXRhRmllbGRzID0gc2VhcmNoRmllbGRzQnlQYXR0ZXJucyhhbGxQcm9wZXJ0aWVzLCBtZXRhUGF0dGVybnMsIGNvbmZpZy5leGNsdWRlRmllbGRzKTtcbiAgICBcbiAgICAvLyBObyBmaWVsZHMgZGV0ZWN0ZWRcbiAgICBpZiAoZGlzcGxheUZpZWxkcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgXG4gICAgLy8gRGV0ZXJtaW5lIGRldGVjdGlvbiBtZXRob2RcbiAgICBjb25zdCBwcmltYXJ5RmllbGQgPSBkaXNwbGF5RmllbGRzWzBdO1xuICAgIGxldCBtZXRob2Q6ICdwcmVmZXJyZWQnIHwgJ3ByZWZpeCcgfCAnZW50aXR5JyB8ICdiYXNlJyA9ICdiYXNlJztcbiAgICBsZXQgcGF0dGVybiA9ICd1bmtub3duJztcbiAgICBcbiAgICBpZiAoY29uZmlnLnByZWZlcnJlZEZpZWxkcyAmJiBjb25maWcucHJlZmVycmVkRmllbGRzLmluY2x1ZGVzKHByaW1hcnlGaWVsZCkpIHtcbiAgICAgICAgbWV0aG9kID0gJ3ByZWZlcnJlZCc7XG4gICAgICAgIHBhdHRlcm4gPSAncHJlZmVycmVkX2ZpZWxkJztcbiAgICB9IGVsc2UgaWYgKHBhcnNlZC5wcmVmaXggJiYgcHJpbWFyeUZpZWxkLnRvTG93ZXJDYXNlKCkuc3RhcnRzV2l0aChwYXJzZWQucHJlZml4LnRvTG93ZXJDYXNlKCkpKSB7XG4gICAgICAgIG1ldGhvZCA9ICdwcmVmaXgnO1xuICAgICAgICBwYXR0ZXJuID0gYCR7cGFyc2VkLnByZWZpeH17ZW50aXR5fXtzdWZmaXh9YDtcbiAgICB9IGVsc2UgaWYgKHByaW1hcnlGaWVsZC50b0xvd2VyQ2FzZSgpLnN0YXJ0c1dpdGgocmVsYXRlZEVudGl0eU5hbWUudG9Mb3dlckNhc2UoKSkpIHtcbiAgICAgICAgbWV0aG9kID0gJ2VudGl0eSc7XG4gICAgICAgIHBhdHRlcm4gPSBge2VudGl0eX17c3VmZml4fWA7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgbWV0aG9kID0gJ2Jhc2UnO1xuICAgICAgICBwYXR0ZXJuID0gYHtiYXNlfXtzdWZmaXh9YDtcbiAgICB9XG4gICAgXG4gICAgLy8gQ2FsY3VsYXRlIGNvbmZpZGVuY2VcbiAgICBjb25zdCBjb25maWRlbmNlID0gY2FsY3VsYXRlQ29uZmlkZW5jZShwcmltYXJ5RmllbGQsIHBhcnNlZCwgcmVsYXRlZEVudGl0eU5hbWUsIG1ldGhvZCk7XG4gICAgXG4gICAgLy8gQ2hlY2sgY29uZmlkZW5jZSB0aHJlc2hvbGRcbiAgICBjb25zdCB0aHJlc2hvbGRPcmRlciA9IHsgbG93OiAwLCBtZWRpdW06IDEsIGhpZ2g6IDIgfTtcbiAgICBpZiAodGhyZXNob2xkT3JkZXJbY29uZmlkZW5jZV0gPCB0aHJlc2hvbGRPcmRlcltjb25maWcuY29uZmlkZW5jZVRocmVzaG9sZF0pIHtcbiAgICAgICAgLy8gQ29uZmlkZW5jZSB0b28gbG93XG4gICAgICAgIGlmIChjb25maWcuZGVidWcpIHtcbiAgICAgICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW0R1cGxpY2F0ZWRGaWVsZERldGVjdGlvbl0gU2tpcHBpbmcgJHtyZWxhdGlvbkZpZWxkSWR9OiBjb25maWRlbmNlICR7Y29uZmlkZW5jZX0gPCB0aHJlc2hvbGQgJHtjb25maWcuY29uZmlkZW5jZVRocmVzaG9sZH1gKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBcbiAgICAvLyBHZW5lcmF0ZSB0ZW1wbGF0ZVxuICAgIGNvbnN0IHRlbXBsYXRlID0gZ2VuZXJhdGVUZW1wbGF0ZShcbiAgICAgICAgcHJpbWFyeUZpZWxkLFxuICAgICAgICB7IGRpc3BsYXk6IGRpc3BsYXlGaWVsZHMsIHZpc3VhbDogdmlzdWFsRmllbGRzLCBtZXRhOiBtZXRhRmllbGRzIH0sXG4gICAgICAgIGNvbmZpZy50ZW1wbGF0ZVN0eWxlXG4gICAgKTtcbiAgICBcbiAgICAvLyBEZWJ1ZyBsb2dnaW5nXG4gICAgaWYgKGNvbmZpZy5kZWJ1Zykge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25dICR7cmVsYXRpb25GaWVsZElkfSDihpIgJHt0ZW1wbGF0ZX0gKGNvbmZpZGVuY2U6ICR7Y29uZmlkZW5jZX0sIG1ldGhvZDogJHttZXRob2R9KWApO1xuICAgIH1cbiAgICBcbiAgICByZXR1cm4ge1xuICAgICAgICBwcmltYXJ5RmllbGQsXG4gICAgICAgIHRlbXBsYXRlLFxuICAgICAgICBkZXRlY3RlZEZpZWxkczoge1xuICAgICAgICAgICAgZGlzcGxheTogZGlzcGxheUZpZWxkcyxcbiAgICAgICAgICAgIHZpc3VhbDogdmlzdWFsRmllbGRzLmxlbmd0aCA+IDAgPyB2aXN1YWxGaWVsZHMgOiB1bmRlZmluZWQsXG4gICAgICAgICAgICBtZXRhOiBtZXRhRmllbGRzLmxlbmd0aCA+IDAgPyBtZXRhRmllbGRzIDogdW5kZWZpbmVkXG4gICAgICAgIH0sXG4gICAgICAgIGNvbmZpZGVuY2UsXG4gICAgICAgIG1ldGhvZCxcbiAgICAgICAgcGF0dGVyblxuICAgIH07XG59XG5cbi8qKlxuICogTGVnYWN5IHdyYXBwZXIgZnVuY3Rpb24gZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHkuXG4gKiBcbiAqIEBkZXByZWNhdGVkIFVzZSBkZXRlY3REdXBsaWNhdGVkUmVsYXRpb25GaWVsZHMoKSBmb3IgcmljaGVyIHJlc3VsdHNcbiAqL1xuZnVuY3Rpb24gZGV0ZWN0RHVwbGljYXRlZFJlbGF0aW9uRmllbGRUZW1wbGF0ZShcbiAgICBhbGxQcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSxcbiAgICByZWxhdGlvbkZpZWxkSWQ6IHN0cmluZyxcbiAgICByZWxhdGVkRW50aXR5TmFtZTogc3RyaW5nXG4pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IHJlc3VsdCA9IGRldGVjdER1cGxpY2F0ZWRSZWxhdGlvbkZpZWxkcyhcbiAgICAgICAgYWxsUHJvcGVydGllcyxcbiAgICAgICAgcmVsYXRpb25GaWVsZElkLFxuICAgICAgICByZWxhdGVkRW50aXR5TmFtZVxuICAgICk7XG4gICAgcmV0dXJuIHJlc3VsdD8udGVtcGxhdGU7XG59XG5cbi8qKlxuICogR2VuZXJhdGUgc21hcnQgZmFsbGJhY2sgY29uZmlndXJhdGlvbiBmb3IgcmVsYXRpb24gZGlzcGxheSB3aGVuIG9ubHkgSUQgaXMgYXZhaWxhYmxlLlxuICogVXNlcyBlbnRpdHkgbWV0YWRhdGEgKGljb24sIGVudGl0eU5hbWVQbHVyYWwpIHRvIGNyZWF0ZSB1c2VyLWZyaWVuZGx5IGZhbGxiYWNrIHRleHQuXG4gKiBcbiAqIEBwYXJhbSBlbnRpdHlOYW1lIC0gUmVsYXRlZCBlbnRpdHkgbmFtZSAoZS5nLiwgJ3RlYW0nKVxuICogQHBhcmFtIGlkRmllbGQgLSBJRCBmaWVsZCBuYW1lIChlLmcuLCAndGVhbUlkJylcbiAqIEBwYXJhbSBlbnRpdHlTZXJ2aWNlIC0gRW50aXR5IHNlcnZpY2UgdG8gZ2V0IG1ldGFkYXRhIGZyb21cbiAqIEByZXR1cm5zIEZhbGxiYWNrIGNvbmZpZ3VyYXRpb24gd2l0aCB0ZW1wbGF0ZSwgbGlua1RleHQsIGFuZCBtb2RhbEJ1dHRvblRleHRcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIEZvciBhIHRlYW0gcmVsYXRpb25cbiAqIGdlbmVyYXRlUmVsYXRpb25GYWxsYmFjaygndGVhbScsICd0ZWFtSWQnLCB0ZWFtU2VydmljZSlcbiAqIC8vIFJldHVybnM6IHtcbiAqIC8vICAgdGVtcGxhdGU6ICdUZWFtOiB7dGVhbUlkfScsXG4gKiAvLyAgIGxpbmtUZXh0OiAnVmlldyBUZWFtJyxcbiAqIC8vICAgbW9kYWxCdXR0b25UZXh0OiAnVGVhbSBEZXRhaWxzJ1xuICogLy8gfVxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVSZWxhdGlvbkZhbGxiYWNrKFxuICAgIGVudGl0eU5hbWU6IHN0cmluZyxcbiAgICBpZEZpZWxkOiBzdHJpbmcsXG4gICAgZW50aXR5U2VydmljZT86IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT5cbik6IE5vbk51bGxhYmxlPElSZWxhdGlvbkZpZWxkQ29uZmlnWydkaXNwbGF5Q29uZmlnJ10+WydmYWxsYmFjayddIHtcbiAgICAvLyBUcnkgdG8gZ2V0IGVudGl0eSBtZXRhZGF0YSBmb3IgYmV0dGVyIGZhbGxiYWNrIHRleHRcbiAgICBjb25zdCBlbnRpdHlNZXRhZGF0YSA9IGVudGl0eVNlcnZpY2U/LmdldEVudGl0eVNjaGVtYT8uKCkubW9kZWw7XG4gICAgY29uc3QgZGlzcGxheU5hbWUgPSBlbnRpdHlNZXRhZGF0YT8uZW50aXR5TmFtZVBsdXJhbCB8fCBwYXNjYWxDYXNlKGVudGl0eU5hbWUpO1xuICAgIFxuICAgIHJldHVybiB7XG4gICAgICAgIC8vIEJhY2tlbmQgcHJlLWdlbmVyYXRlcyBmYWxsYmFjayB0ZW1wbGF0ZSAoaW50ZW50aW9uYWxseSBzdHJpbmctb25seSwgbm90IFRlbXBsYXRlIHR5cGUpXG4gICAgICAgIC8vIEZyb250ZW5kIHdpbGwgdXNlIHRoaXMgd2hlbiBvbmx5IElEIGlzIGF2YWlsYWJsZVxuICAgICAgICB0ZW1wbGF0ZTogYCR7ZGlzcGxheU5hbWV9OiB7JHtpZEZpZWxkfX1gLCAgLy8gZS5nLiwgXCJUZWFtOiB7dGVhbUlkfVwiXG4gICAgICAgIGxpbmtUZXh0OiBgVmlldyAke2Rpc3BsYXlOYW1lfWAsICAgICAgICAgICAvLyBlLmcuLCBcIlZpZXcgVGVhbVwiXG4gICAgICAgIG1vZGFsQnV0dG9uVGV4dDogYCR7ZGlzcGxheU5hbWV9IERldGFpbHNgICAvLyBlLmcuLCBcIlRlYW0gRGV0YWlsc1wiXG4gICAgfTtcbn1cblxuLyoqXG4gKiBTbWFydCBsYWJlbCBmaWVsZCBkZXRlY3Rpb24gZm9yIGVudGl0eSBvcHRpb25zLlxuICogVXNlcyBnZW5lcmljIHBhdHRlcm5zIHRvIGZpbmQgdGhlIGJlc3QgZGlzcGxheSBmaWVsZCB3aGVuIGVudGl0eSBtZXRhZGF0YSBpcyBtaXNzaW5nLlxuICogXG4gKiBQcmlvcml0eSBvcmRlcjpcbiAqIDEuIEVudGl0eSBtZXRhZGF0YSAoZW50aXR5TmFtZUF0dHJpYnV0ZSlcbiAqIDIuIENvbW1vbiBkaXNwbGF5IGZpZWxkIHBhdHRlcm5zIChuYW1lLCB0aXRsZSwgbGFiZWwsIGRpc3BsYXlOYW1lKVxuICogMy4gRW50aXR5LXNwZWNpZmljIHBhdHRlcm5zICh7ZW50aXR5TmFtZX1OYW1lLCB7ZW50aXR5TmFtZX1UaXRsZSlcbiAqIDQuIEZpZWxkcyBlbmRpbmcgd2l0aCBuYW1lLWxpa2Ugc3VmZml4ZXMgKE5hbWUsIFRpdGxlLCBMYWJlbCwgQ29kZSlcbiAqIDUuIFNjb3JlZCBzZWxlY3Rpb24gb2YgYmVzdCBkaXNwbGF5IGZpZWxkIChwcmVmZXJzOiBzdHJpbmdzID4gZW51bXMgPiBib29sZWFucyA+IG51bWJlcnMpXG4gKiBcbiAqIEF1dG9tYXRpY2FsbHkgZXhjbHVkZXM6XG4gKiAtIFRlY2huaWNhbCBmaWVsZHMgKG1ldGFkYXRhLCBjdXJyZW5jeSwgZ2F0ZXdheSwgcmVtb3RlSWQsIGV0Yy4pXG4gKiAtIFNlbnNpdGl2ZSBmaWVsZHMgKHBhc3N3b3JkLCB0b2tlbiwgc2VjcmV0LCBrZXksIGhhc2gpXG4gKiAtIFRpbWVzdGFtcCBmaWVsZHMgKGNyZWF0ZWRBdCwgdXBkYXRlZEF0LCBkZWxldGVkQXQpXG4gKiAtIEpTT04gZmllbGRzIChmaWVsZFR5cGU6ICdqc29uJylcbiAqIC0gUmVsYXRpb24gZmllbGRzIChhbHJlYWR5IElEIGZpZWxkcylcbiAqIC0gSGlkZGVuIGZpZWxkcyAoaXNWaXNpYmxlOiBmYWxzZSwgaXNMaXN0YWJsZTogZmFsc2UpXG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyBFbnRpdHkgd2l0aCBjbGVhciBuYW1lIGZpZWxkXG4gKiBUZWFtOiB0ZWFtTmFtZSAoUHJpb3JpdHkgMylcbiAqIFxuICogQGV4YW1wbGVcbiAqIC8vIEVudGl0eSB3aXRob3V0IG5hbWUgZmllbGQgLSB1c2VzIHNjb3JpbmdcbiAqIFN1YnNjcmlwdGlvbjogc3RhdHVzIChlbnVtLCBzY29yZTogMTMwKSBpbnN0ZWFkIG9mIGN1cnJlbmN5IChleGNsdWRlZClcbiAqIFBheW1lbnRNZXRob2Q6IHByb3ZpZGVyIChzdHJpbmcsIHNjb3JlOiAxNTApIGluc3RlYWQgb2YgbWV0YWRhdGEgKGV4Y2x1ZGVkKVxuICogXG4gKiBAcGFyYW0gc2NoZW1hIC0gRW50aXR5IHNjaGVtYVxuICogQHBhcmFtIGVudGl0eU5hbWUgLSBFbnRpdHkgbmFtZSAoZS5nLiwgJ3RlYW0nLCAndXNlcicpXG4gKiBAcmV0dXJucyBCZXN0IGxhYmVsIGZpZWxkIG5hbWUgb3IgdW5kZWZpbmVkXG4gKi9cbmZ1bmN0aW9uIGZpbmRMYWJlbEZpZWxkKHNjaGVtYTogRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+LCBlbnRpdHlOYW1lOiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIC8vIFByaW9yaXR5IDE6IFVzZSBlbnRpdHkgbWV0YWRhdGEgaWYgYXZhaWxhYmxlXG4gICAgY29uc3QgZW50aXR5TmFtZUF0dHJpYnV0ZSA9IHNjaGVtYS5tb2RlbC5lbnRpdHlOYW1lQXR0cmlidXRlO1xuICAgIGlmIChlbnRpdHlOYW1lQXR0cmlidXRlKSB7XG4gICAgICAgIHJldHVybiBlbnRpdHlOYW1lQXR0cmlidXRlO1xuICAgIH1cbiAgICBcbiAgICAvLyBHZXQgYWxsIGF0dHJpYnV0ZXMgZnJvbSBzY2hlbWFcbiAgICBjb25zdCBhdHRyaWJ1dGVzID0gc2NoZW1hLmF0dHJpYnV0ZXM7XG4gICAgY29uc3QgYXR0cmlidXRlTmFtZXMgPSBPYmplY3Qua2V5cyhhdHRyaWJ1dGVzKTtcbiAgICBcbiAgICAvLyBQcmlvcml0eSAyOiBFeGFjdCBtYXRjaCBvbiBjb21tb24gZGlzcGxheSBwYXR0ZXJucyAoY2FzZS1pbnNlbnNpdGl2ZSlcbiAgICBjb25zdCBjb21tb25QYXR0ZXJucyA9IFsnbmFtZScsICd0aXRsZScsICdsYWJlbCcsICdkaXNwbGF5TmFtZScsICdkaXNwbGF5bmFtZSddO1xuICAgIGZvciAoY29uc3QgcGF0dGVybiBvZiBjb21tb25QYXR0ZXJucykge1xuICAgICAgICBjb25zdCBtYXRjaCA9IGF0dHJpYnV0ZU5hbWVzLmZpbmQoYXR0ciA9PiBhdHRyLnRvTG93ZXJDYXNlKCkgPT09IHBhdHRlcm4pO1xuICAgICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgICAgIHJldHVybiBtYXRjaDtcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICAvLyBQcmlvcml0eSAzOiBFbnRpdHktc3BlY2lmaWMgcGF0dGVybnMgKHtlbnRpdHlOYW1lfU5hbWUsIHtlbnRpdHlOYW1lfVRpdGxlKVxuICAgIGNvbnN0IGVudGl0eUxvd2VyID0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IGVudGl0eVNwZWNpZmljU3VmZml4ZXMgPSBbJ05hbWUnLCAnVGl0bGUnLCAnTGFiZWwnXTtcbiAgICBcbiAgICBmb3IgKGNvbnN0IHN1ZmZpeCBvZiBlbnRpdHlTcGVjaWZpY1N1ZmZpeGVzKSB7XG4gICAgICAgIC8vIFRyeSBleGFjdCBtYXRjaDogZS5nLiwgJ3RlYW1OYW1lJyBmb3IgZW50aXR5ICd0ZWFtJ1xuICAgICAgICBjb25zdCBleGFjdE1hdGNoID0gYXR0cmlidXRlTmFtZXMuZmluZChhdHRyID0+IFxuICAgICAgICAgICAgYXR0ci50b0xvd2VyQ2FzZSgpID09PSBgJHtlbnRpdHlMb3dlcn0ke3N1ZmZpeC50b0xvd2VyQ2FzZSgpfWBcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKGV4YWN0TWF0Y2gpIHtcbiAgICAgICAgICAgIHJldHVybiBleGFjdE1hdGNoO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8vIFByaW9yaXR5IDQ6IEZpZWxkcyBlbmRpbmcgd2l0aCBuYW1lLWxpa2Ugc3VmZml4ZXNcbiAgICAvLyBMb29rIGZvciBhbnkgZmllbGQgZW5kaW5nIHdpdGggJ05hbWUnLCAnVGl0bGUnLCAnTGFiZWwnIChlLmcuLCAnZGlzcGxheU5hbWUnLCAnZnVsbE5hbWUnLCAndXNlck5hbWUnLClcbiAgICBjb25zdCBkaXNwbGF5TmFtZVN1ZmZpeFBhdHRlcm4gPSAvRGlzcGxheU5hbWUkLztcbiAgICBjb25zdCBuYW1lU3VmZml4UGF0dGVybiA9IC9OYW1lJC87XG4gICAgY29uc3QgdGl0bGVTdWZmaXhQYXR0ZXJuID0gL1RpdGxlJC87XG4gICAgY29uc3QgbGFiZWxTdWZmaXhQYXR0ZXJuID0gL0xhYmVsJC87XG4gICAgY29uc3QgY29kZVN1ZmZpeFBhdHRlcm4gPSAvQ29kZSQvO1xuICAgIFxuICAgIGZvciAoY29uc3QgcGF0dGVybiBvZiBbZGlzcGxheU5hbWVTdWZmaXhQYXR0ZXJuLCBsYWJlbFN1ZmZpeFBhdHRlcm4sIHRpdGxlU3VmZml4UGF0dGVybiwgbmFtZVN1ZmZpeFBhdHRlcm4sIGNvZGVTdWZmaXhQYXR0ZXJuXSkge1xuICAgICAgICBjb25zdCBtYXRjaCA9IGF0dHJpYnV0ZU5hbWVzLmZpbmQoYXR0ciA9PiBwYXR0ZXJuLnRlc3QoYXR0cikpO1xuICAgICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgICAgIHJldHVybiBtYXRjaDtcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICAvLyBQcmlvcml0eSA1OiBGaXJzdCBzdWl0YWJsZSBkaXNwbGF5IGZpZWxkXG4gICAgLy8gQnVpbGQgbGlzdCBvZiBjYW5kaWRhdGVzIHdpdGggc2NvcmluZ1xuICAgIGNvbnN0IGNhbmRpZGF0ZXM6IEFycmF5PHsgZmllbGQ6IHN0cmluZzsgc2NvcmU6IG51bWJlciB9PiA9IFtdO1xuICAgIFxuICAgIGZvciAoY29uc3QgYXR0ck5hbWUgb2YgYXR0cmlidXRlTmFtZXMpIHtcbiAgICAgICAgY29uc3QgYXR0ciA9IGF0dHJpYnV0ZXNbYXR0ck5hbWVdO1xuICAgICAgICBsZXQgc2NvcmUgPSAwO1xuICAgICAgICBcbiAgICAgICAgLy8gU2tpcCBpZiBleHBsaWNpdGx5IGhpZGRlbiBmcm9tIGxpc3RzXG4gICAgICAgIGlmIChhdHRyLmlzTGlzdGFibGUgPT09IGZhbHNlKSBjb250aW51ZTtcbiAgICAgICAgXG4gICAgICAgIC8vIFNraXAgaWYgaGlkZGVuL25vdCB2aXNpYmxlXG4gICAgICAgIGlmIChhdHRyLmlzVmlzaWJsZSA9PT0gZmFsc2UpIGNvbnRpbnVlO1xuICAgICAgICBcbiAgICAgICAgLy8gU2tpcCBJRCBmaWVsZHMgKHVubGVzcyBpdCdzIHRoZSBvbmx5IG9wdGlvbilcbiAgICAgICAgaWYgKGF0dHJOYW1lLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoJ2lkJykpIGNvbnRpbnVlO1xuICAgICAgICBcbiAgICAgICAgLy8gU2tpcCBzZW5zaXRpdmUvdGVjaG5pY2FsIGZpZWxkc1xuICAgICAgICBjb25zdCB0ZWNobmljYWxGaWVsZHMgPSBbXG4gICAgICAgICAgICAncGFzc3dvcmQnLCAndG9rZW4nLCAnc2VjcmV0JywgJ2tleScsICdoYXNoJyxcbiAgICAgICAgICAgICdtZXRhZGF0YScsICdyZW1vdGVpZCcsICdjdXJyZW5jeScsICdnYXRld2F5JyxcbiAgICAgICAgICAgICdjcmVhdGVkYXQnLCAndXBkYXRlZGF0JywgJ2RlbGV0ZWRhdCdcbiAgICAgICAgXTtcbiAgICAgICAgaWYgKHRlY2huaWNhbEZpZWxkcy5zb21lKHRlY2ggPT4gYXR0ck5hbWUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyh0ZWNoKSkpIGNvbnRpbnVlO1xuICAgICAgICBcbiAgICAgICAgLy8gU2tpcCBKU09OIGZpZWxkc1xuICAgICAgICBpZiAoYXR0ci5maWVsZFR5cGUgPT09ICdqc29uJykgY29udGludWU7XG4gICAgICAgIFxuICAgICAgICAvLyBTa2lwIHJlbGF0aW9ucyAodGhlc2UgYXJlIElEcylcbiAgICAgICAgaWYgKGF0dHIucmVsYXRpb24pIGNvbnRpbnVlO1xuICAgICAgICBcbiAgICAgICAgLy8gU3RyaW5nIGZpZWxkcyBnZXQgaGlnaGVzdCBzY29yZVxuICAgICAgICBpZiAoYXR0ci50eXBlID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgc2NvcmUgKz0gMTAwO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBQcmVmZXIgcmVxdWlyZWQgc3RyaW5nc1xuICAgICAgICAgICAgaWYgKGF0dHIucmVxdWlyZWQgPT09IHRydWUpIHtcbiAgICAgICAgICAgICAgICBzY29yZSArPSA1MDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gUHJpb3JpdGl6ZSBmaWVsZHMgdGhhdCBzb3VuZCBsaWtlIGlkZW50aWZpZXJzIChidXQgbm90IElEcylcbiAgICAgICAgICAgIGlmIChhdHRyTmFtZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKCdudW1iZXInKSkgc2NvcmUgKz0gMzA7XG4gICAgICAgICAgICBpZiAoYXR0ck5hbWUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcygnY29kZScpKSBzY29yZSArPSAyMDtcbiAgICAgICAgICAgIGlmIChhdHRyTmFtZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKCdpZGVudGlmaWVyJykpIHNjb3JlICs9IDIwO1xuICAgICAgICAgICAgaWYgKGF0dHJOYW1lLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoJ3NsdWcnKSkgc2NvcmUgKz0gMjA7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIEVudW0gZmllbGRzIGdldCBnb29kIHNjb3JlXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGF0dHIudHlwZSkgJiYgYXR0ci50eXBlLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHNjb3JlICs9IDgwO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBQcmVmZXIgZW51bXMgd2l0aCByZWFzb25hYmxlIGNvdW50c1xuICAgICAgICAgICAgaWYgKGF0dHIudHlwZS5sZW5ndGggPD0gMTApIHtcbiAgICAgICAgICAgICAgICBzY29yZSArPSAyMDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gUHJlZmVyIHJlcXVpcmVkIGVudW1zXG4gICAgICAgICAgICBpZiAoYXR0ci5yZXF1aXJlZCA9PT0gdHJ1ZSkge1xuICAgICAgICAgICAgICAgIHNjb3JlICs9IDMwO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBCb29sZWFuIGZpZWxkcyBnZXQgbG93ZXIgc2NvcmVcbiAgICAgICAgaWYgKGF0dHIudHlwZSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgICAgICBzY29yZSArPSA0MDtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gTnVtYmVyIGZpZWxkcyBnZXQgZXZlbiBsb3dlciBzY29yZVxuICAgICAgICBpZiAoYXR0ci50eXBlID09PSAnbnVtYmVyJykge1xuICAgICAgICAgICAgc2NvcmUgKz0gMzA7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGlmIChzY29yZSA+IDApIHtcbiAgICAgICAgICAgIGNhbmRpZGF0ZXMucHVzaCh7IGZpZWxkOiBhdHRyTmFtZSwgc2NvcmUgfSk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLy8gU29ydCBieSBzY29yZSAoaGlnaGVzdCBmaXJzdClcbiAgICBjYW5kaWRhdGVzLnNvcnQoKGEsIGIpID0+IGIuc2NvcmUgLSBhLnNjb3JlKTtcbiAgICBcbiAgICAvLyBSZXR1cm4gdGhlIGJlc3QgY2FuZGlkYXRlXG4gICAgcmV0dXJuIGNhbmRpZGF0ZXMubGVuZ3RoID4gMCA/IGNhbmRpZGF0ZXNbMF0uZmllbGQgOiB1bmRlZmluZWQ7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUkVMQVRJT04gT1BUSU9OIENPTkZJRyBSRVNPTFVUSU9OXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBSZXNvbHZlcyBSZWxhdGlvbkVudGl0eU9wdGlvbkNvbmZpZyBpbnRvIEZpZWxkT3B0aW9uc0FQSUNvbmZpZyBieSBhdXRvLWRldGVjdGluZzpcbiAqIC0gQ1JVRCBBUEkgcGF0aCBmcm9tIGVudGl0eSBzY2hlbWFcbiAqIC0gTGFiZWwgZmllbGQgZnJvbSBlbnRpdHlOYW1lQXR0cmlidXRlIG1ldGFkYXRhXG4gKiAtIFZhbHVlIGZpZWxkIGZyb20gcmVsYXRpb24gaWRlbnRpZmllcnNcbiAqIFxuICogQHBhcmFtIHJlbGF0aW9uQ29uZmlnIC0gTWluaW1hbCByZWxhdGlvbiBvcHRpb24gY29uZmlnXG4gKiBAcGFyYW0gcmVsYXRpb25BdHRyaWJ1dGUgLSBUaGUgcmVsYXRpb24gYXR0cmlidXRlICh0byBnZXQgaWRlbnRpZmllcnMpXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIGZvciBzY2hlbWEgbG9va3VwXG4gKiBAcmV0dXJucyBGdWxseSByZXNvbHZlZCBGaWVsZE9wdGlvbnNBUElDb25maWcgb3IgdW5kZWZpbmVkIGlmIGVudGl0eSBub3QgZm91bmRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVSZWxhdGlvbk9wdGlvbkNvbmZpZyhcbiAgICByZWxhdGlvbkNvbmZpZzogUmVsYXRpb25FbnRpdHlPcHRpb25Db25maWcsXG4gICAgcmVsYXRpb25BdHRyaWJ1dGU6IFRJT1NjaGVtYUF0dHJpYnV0ZSAmIHsgcmVsYXRpb246IE5vbk51bGxhYmxlPFRJT1NjaGVtYUF0dHJpYnV0ZVsncmVsYXRpb24nXT4gfSxcbiAgICBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+XG4pOiBGaWVsZE9wdGlvbnNBUElDb25maWc8YW55PiB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgeyBlbnRpdHlOYW1lLCBjdXN0b21BcGlVcmwsIG9wdGlvbk1hcHBpbmcsIC4uLnJlc3QgfSA9IHJlbGF0aW9uQ29uZmlnO1xuICAgIGNvbnN0IHJlbGF0aW9uID0gcmVsYXRpb25BdHRyaWJ1dGUucmVsYXRpb247XG4gICAgXG4gICAgLy8gR2V0IHJlbGF0ZWQgZW50aXR5IHNlcnZpY2VcbiAgICBpZiAoIWVudGl0eVNlcnZpY2UuaGFzRW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShlbnRpdHlOYW1lKSkge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYFtyZXNvbHZlUmVsYXRpb25PcHRpb25Db25maWddIEVudGl0eSBzZXJ2aWNlIG5vdCBmb3VuZCBmb3I6ICR7ZW50aXR5TmFtZX1gKTtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgXG4gICAgY29uc3QgcmVsYXRlZFNlcnZpY2UgPSBlbnRpdHlTZXJ2aWNlLmdldEVudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUoZW50aXR5TmFtZSk7XG4gICAgY29uc3QgcmVsYXRlZFNjaGVtYSA9IHJlbGF0ZWRTZXJ2aWNlPy5nZXRFbnRpdHlTY2hlbWE/LigpO1xuICAgIFxuICAgIGlmICghcmVsYXRlZFNjaGVtYSkge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYFtyZXNvbHZlUmVsYXRpb25PcHRpb25Db25maWddIFNjaGVtYSBub3QgZm91bmQgZm9yIGVudGl0eTogJHtlbnRpdHlOYW1lfWApO1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBcbiAgICAvLyAxLiBSZXNvbHZlIEFQSSBVUkxcbiAgICBjb25zdCBlbnRpdHlOYW1lTG93ZXIgPSBlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgY3J1ZFBhdGggPSByZWxhdGVkU2NoZW1hLm1vZGVsLkNSVURBcGlQYXRoIHx8ICcnO1xuICAgIGNvbnN0IGFwaVVybCA9IGN1c3RvbUFwaVVybCB8fCBgJHtjcnVkUGF0aH0vJHtlbnRpdHlOYW1lTG93ZXJ9YDtcbiAgICBcbiAgICAvLyAyLiBSZXNvbHZlIHZhbHVlIGZpZWxkIGZyb20gcmVsYXRpb24gaWRlbnRpZmllcnNcbiAgICBjb25zdCByZXNvbHZlZElkZW50aWZpZXJzID0gdHlwZW9mIHJlbGF0aW9uLmlkZW50aWZpZXJzID09PSAnZnVuY3Rpb24nID8gcmVsYXRpb24uaWRlbnRpZmllcnMoKSA6IHJlbGF0aW9uLmlkZW50aWZpZXJzO1xuICAgIGNvbnN0IGlkZW50aWZpZXJNYXBwaW5ncyA9IEFycmF5LmlzQXJyYXkocmVzb2x2ZWRJZGVudGlmaWVycykgPyByZXNvbHZlZElkZW50aWZpZXJzIDogW3Jlc29sdmVkSWRlbnRpZmllcnNdO1xuICAgIGNvbnN0IHByaW1hcnlJZGVudGlmaWVyID0gaWRlbnRpZmllck1hcHBpbmdzWzBdO1xuICAgIGNvbnN0IHZhbHVlRmllbGQgPSBTdHJpbmcocHJpbWFyeUlkZW50aWZpZXIudGFyZ2V0KTtcbiAgICBcbiAgICAvLyAzLiBSZXNvbHZlIGxhYmVsIGZpZWxkIGZyb20gZW50aXR5IG1ldGFkYXRhIG9yIGN1c3RvbSBtYXBwaW5nXG4gICAgbGV0IGxhYmVsRmllbGQgPSB2YWx1ZUZpZWxkOyAvLyBEZWZhdWx0IGZhbGxiYWNrIHRvIHZhbHVlIGZpZWxkXG4gICAgXG4gICAgaWYgKG9wdGlvbk1hcHBpbmc/LmxhYmVsKSB7XG4gICAgICAgIC8vIEN1c3RvbSBsYWJlbCBwcm92aWRlZCAtIHVzZSBpdFxuICAgICAgICBsYWJlbEZpZWxkID0gb3B0aW9uTWFwcGluZy5sYWJlbCBhcyBzdHJpbmc7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQXV0by1kZXRlY3QgdXNpbmcgc21hcnQgcGF0dGVybiBtYXRjaGluZ1xuICAgICAgICBsYWJlbEZpZWxkID0gZmluZExhYmVsRmllbGQocmVsYXRlZFNjaGVtYSwgZW50aXR5TmFtZSkgfHwgdmFsdWVGaWVsZDtcbiAgICB9XG4gICAgXG4gICAgLy8gNC4gQnVpbGQgY29tcGxldGUgRmllbGRPcHRpb25zQVBJQ29uZmlnXG4gICAgcmV0dXJuIHtcbiAgICAgICAgYXBpTWV0aG9kOiAnR0VUJyxcbiAgICAgICAgYXBpVXJsLFxuICAgICAgICByZXNwb25zZUtleTogJ2l0ZW1zJyxcbiAgICAgICAgb3B0aW9uTWFwcGluZzogb3B0aW9uTWFwcGluZyB8fCB7XG4gICAgICAgICAgICBsYWJlbDogbGFiZWxGaWVsZCxcbiAgICAgICAgICAgIHZhbHVlOiAob3B0aW9uTWFwcGluZyBhcyBhbnkpPy52YWx1ZSB8fCB2YWx1ZUZpZWxkXG4gICAgICAgIH0sXG4gICAgICAgIC4uLnJlc3QgLy8gUGFzcyB0aHJvdWdoIGZpbHRlcnMsIGNvdW50LCBkaXNhYmxlU2VhcmNoLCBldGMuXG4gICAgfTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBGSUxURVIgQVVUTy1HRU5FUkFUSU9OXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4gKiBBdXRvLWdlbmVyYXRlcyBmaWx0ZXJDb25maWcgZm9yIGVudGl0eSBhdHRyaWJ1dGVzIGJhc2VkIG9uIGZpZWxkIHR5cGUuXG4gKiBcbiAqIEFsZ29yaXRobTpcbiAqIDEuIENoZWNrIGlmIGV4cGxpY2l0IGZpbHRlckNvbmZpZyBhbHJlYWR5IGV4aXN0cyDihpIgdXNlIGl0XG4gKiAyLiBDaGVjayBpZiBmaWVsZCBpcyBleHBsaWNpdGx5IG5vbi1maWx0ZXJhYmxlIOKGkiBza2lwXG4gKiAzLiBEZXRlY3QgZmllbGQgdHlwZSBhbmQgZ2VuZXJhdGUgYXBwcm9wcmlhdGUgY29uZmlnXG4gKiA0LiBNZXJnZSB3aXRoIGdsb2JhbCBhbmQgZW50aXR5LWxldmVsIG92ZXJyaWRlc1xuICogXG4gKiBAcGFyYW0gYXR0cmlidXRlIC0gVGhlIGF0dHJpYnV0ZSB0byBnZW5lcmF0ZSBmaWx0ZXIgY29uZmlnIGZvclxuICogQHBhcmFtIGVudGl0eVNlcnZpY2UgLSBFbnRpdHkgc2VydmljZSBmb3IgYWNjZXNzaW5nIGVudGl0eSBtZXRhZGF0YVxuICogQHBhcmFtIGdsb2JhbFVJQ29uZmlnT3B0aW9ucyAtIEdsb2JhbCBVSSBjb25maWd1cmF0aW9uIG9wdGlvbnNcbiAqIEByZXR1cm5zIEdlbmVyYXRlZCBmaWx0ZXIgY29uZmlndXJhdGlvbiBvciB1bmRlZmluZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdlbmVyYXRlRmlsdGVyQ29uZmlnKFxuICAgIGF0dHJpYnV0ZTogVElPU2NoZW1hQXR0cmlidXRlLFxuICAgIGVudGl0eVNlcnZpY2U/OiBCYXNlRW50aXR5U2VydmljZTxhbnk+LFxuICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sndWlDb25maWdHZW5PcHRpb25zJ11cbik6IEZpZWxkTWV0YWRhdGFbJ2ZpbHRlckNvbmZpZyddIHwgdW5kZWZpbmVkIHtcbiAgICAvLyAxLiBJZiBleHBsaWNpdCBmaWx0ZXJDb25maWcgZXhpc3RzLCB1c2UgaXQgKGhpZ2hlc3QgcHJpb3JpdHkpXG4gICAgaWYgKGF0dHJpYnV0ZS5maWx0ZXJDb25maWcpIHtcbiAgICAgICAgcmV0dXJuIGF0dHJpYnV0ZS5maWx0ZXJDb25maWc7XG4gICAgfVxuICAgIFxuICAgIC8vIDIuIElmIGZpZWxkIGhhcyBleHBsaWNpdCBvcHRpb25zIGNvbmZpZywgdXNlIGl0XG4gICAgaWYgKCdvcHRpb25zJyBpbiBhdHRyaWJ1dGUpIHtcbiAgICAgICAgY29uc3Qgb3B0aW9ucyA9IChhdHRyaWJ1dGUgYXMgU2VsZWN0RmllbGRNZXRhZGF0YSkub3B0aW9ucztcbiAgICAgICAgXG4gICAgICAgIC8vIFJlbGF0aW9uRW50aXR5T3B0aW9uQ29uZmlnIChoYXMgZW50aXR5TmFtZSkg4oaSIHJlc29sdmUgdG8gRmllbGRPcHRpb25zQVBJQ29uZmlnXG4gICAgICAgIGNvbnN0IGlzUmVsYXRpb25Db25maWcgPSB0eXBlb2Ygb3B0aW9ucyA9PT0gJ29iamVjdCcgJiYgIUFycmF5LmlzQXJyYXkob3B0aW9ucykgJiYgJ2VudGl0eU5hbWUnIGluIG9wdGlvbnM7XG5cbiAgICAgICAgbGV0IHJlc29sdmVkQ29uZmlnOiBGaWVsZE9wdGlvbnNBUElDb25maWc8YW55PiB8IEZpZWxkT3B0aW9uW10gfCB1bmRlZmluZWQ7XG5cbiAgICAgICAgLy8gSW5saW5lIGFycmF5IOKGkiB1c2UgYXMgaXNcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkob3B0aW9ucykgJiYgb3B0aW9ucy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICByZXNvbHZlZENvbmZpZyA9IG9wdGlvbnMgYXMgRmllbGRPcHRpb25bXTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEZpZWxkT3B0aW9uc0FQSUNvbmZpZyAoaGFzIGFwaU1ldGhvZCwgYXBpVXJsLCByZXNwb25zZUtleSkg4oaSIHBhc3MgdGhyb3VnaFxuICAgICAgICBjb25zdCBpc0FwaUNvbmZpZyA9IHR5cGVvZiBvcHRpb25zID09PSAnb2JqZWN0JyAmJiAhQXJyYXkuaXNBcnJheShvcHRpb25zKSAmJiAnYXBpTWV0aG9kJyBpbiBvcHRpb25zO1xuICAgICAgICBpZiAoaXNBcGlDb25maWcpIHtcbiAgICAgICAgICAgIHJlc29sdmVkQ29uZmlnID0gb3B0aW9ucyBhcyBGaWVsZE9wdGlvbnNBUElDb25maWc8YW55PjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChpc1JlbGF0aW9uQ29uZmlnICYmIGF0dHJpYnV0ZS5yZWxhdGlvbiAmJiBlbnRpdHlTZXJ2aWNlKSB7XG4gICAgICAgICAgICByZXNvbHZlZENvbmZpZyA9IHJlc29sdmVSZWxhdGlvbk9wdGlvbkNvbmZpZyhcbiAgICAgICAgICAgICAgICBvcHRpb25zIGFzIFJlbGF0aW9uRW50aXR5T3B0aW9uQ29uZmlnLFxuICAgICAgICAgICAgICAgIGF0dHJpYnV0ZSBhcyBUSU9TY2hlbWFBdHRyaWJ1dGUgJiB7IHJlbGF0aW9uOiBOb25OdWxsYWJsZTxUSU9TY2hlbWFBdHRyaWJ1dGVbJ3JlbGF0aW9uJ10+IH0sXG4gICAgICAgICAgICAgICAgZW50aXR5U2VydmljZVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKHJlc29sdmVkQ29uZmlnKSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIGZpbHRlclR5cGU6ICdzZWxlY3QnLFxuICAgICAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogJ2VxJyBhcyBjb25zdCxcbiAgICAgICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IFsnZXEnLCAnbmVxJywgJ2luTGlzdCcsICdub3RJbkxpc3QnLCAnaXNFbXB0eScsICdpc051bGwnXSxcbiAgICAgICAgICAgICAgICBwcmVkZWZpbmVkT3B0aW9uczogcmVzb2x2ZWRDb25maWdcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIGVsc2UgbG9nIGVycm9yXG4gICAgICAgIHRocm93IG5ldyBGcmFtZXdvcmtFcnJvcihgW2dlbmVyYXRlRmlsdGVyQ29uZmlnXSBObyByZXNvbHZlZCBjb25maWcgZm91bmQgZm9yIGF0dHJpYnV0ZTogJHthdHRyaWJ1dGUuaWR9YCwge1xuICAgICAgICAgICAgYXR0cmlidXRlOiBhdHRyaWJ1dGUsXG4gICAgICAgICAgICBvcHRpb25zOiBvcHRpb25zLFxuICAgICAgICB9KTtcbiAgICB9XG4gICAgXG4gICAgLy8gMy4gSWYgZmllbGQgaXMgZXhwbGljaXRseSBub24tZmlsdGVyYWJsZSwgc2tpcFxuICAgIGlmIChhdHRyaWJ1dGUuaXNGaWx0ZXJhYmxlID09PSBmYWxzZSkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBcbiAgICAvLyAzLiBHZXQgZ2xvYmFsIGFuZCBlbnRpdHktbGV2ZWwgY29uZmlnXG4gICAgY29uc3QgZ2xvYmFsRmlsdGVyQ29uZmlnID0gZ2xvYmFsVUlDb25maWdPcHRpb25zPy50YWJsZVVJPy5maWx0ZXJBdXRvR2VuZXJhdGlvbjtcbiAgICBjb25zdCBlbnRpdHlNZXRhZGF0YSA9IGVudGl0eVNlcnZpY2U/LmdldEVudGl0eVNjaGVtYT8uKCkubW9kZWw/Lm1ldGFkYXRhIGFzIEVudGl0eVNjaGVtYTxhbnksIGFueSwgYW55PlsnbW9kZWwnXVsnbWV0YWRhdGEnXTtcbiAgICBjb25zdCBlbnRpdHlGaWx0ZXJDb25maWcgPSBlbnRpdHlNZXRhZGF0YT8udGFibGVVST8uZmlsdGVyQXV0b0dlbmVyYXRpb247XG4gICAgXG4gICAgLy8gTWVyZ2UgY29uZmlncyAoZW50aXR5ID4gZ2xvYmFsID4gZGVmYXVsdHMpXG4gICAgY29uc3QgbWVyZ2VkQ29uZmlnID0ge1xuICAgICAgICBlbmFibGVkOiBlbnRpdHlGaWx0ZXJDb25maWc/LmVuYWJsZWQgPz8gZ2xvYmFsRmlsdGVyQ29uZmlnPy5lbmFibGVkID8/IHRydWUsXG4gICAgICAgIGRhdGVGaWVsZHM6IHtcbiAgICAgICAgICAgIC4uLmdsb2JhbEZpbHRlckNvbmZpZz8uZGF0ZUZpZWxkcyxcbiAgICAgICAgICAgIC4uLmVudGl0eUZpbHRlckNvbmZpZz8uZGF0ZUZpZWxkc1xuICAgICAgICB9LFxuICAgICAgICBlbnVtRmllbGRzOiB7XG4gICAgICAgICAgICAuLi5nbG9iYWxGaWx0ZXJDb25maWc/LmVudW1GaWVsZHMsXG4gICAgICAgICAgICAuLi5lbnRpdHlGaWx0ZXJDb25maWc/LmVudW1GaWVsZHNcbiAgICAgICAgfSxcbiAgICAgICAgYm9vbGVhbkZpZWxkczoge1xuICAgICAgICAgICAgLi4uZ2xvYmFsRmlsdGVyQ29uZmlnPy5ib29sZWFuRmllbGRzLFxuICAgICAgICAgICAgLi4uZW50aXR5RmlsdGVyQ29uZmlnPy5ib29sZWFuRmllbGRzXG4gICAgICAgIH0sXG4gICAgICAgIHJlbGF0aW9uRmllbGRzOiB7XG4gICAgICAgICAgICAuLi5nbG9iYWxGaWx0ZXJDb25maWc/LnJlbGF0aW9uRmllbGRzLFxuICAgICAgICAgICAgLi4uZW50aXR5RmlsdGVyQ29uZmlnPy5yZWxhdGlvbkZpZWxkc1xuICAgICAgICB9LFxuICAgICAgICBudW1iZXJGaWVsZHM6IHtcbiAgICAgICAgICAgIC4uLmdsb2JhbEZpbHRlckNvbmZpZz8ubnVtYmVyRmllbGRzLFxuICAgICAgICAgICAgLi4uZW50aXR5RmlsdGVyQ29uZmlnPy5udW1iZXJGaWVsZHNcbiAgICAgICAgfSxcbiAgICAgICAgdGV4dEZpZWxkczoge1xuICAgICAgICAgICAgLi4uZ2xvYmFsRmlsdGVyQ29uZmlnPy50ZXh0RmllbGRzLFxuICAgICAgICAgICAgLi4uZW50aXR5RmlsdGVyQ29uZmlnPy50ZXh0RmllbGRzXG4gICAgICAgIH0sXG4gICAgICAgIGRlYnVnOiBlbnRpdHlGaWx0ZXJDb25maWc/LmRlYnVnID8/IGdsb2JhbEZpbHRlckNvbmZpZz8uZGVidWcgPz8gZmFsc2VcbiAgICB9O1xuICAgIFxuICAgIC8vIElmIGdsb2JhbGx5IGRpc2FibGVkLCBza2lwXG4gICAgaWYgKCFtZXJnZWRDb25maWcuZW5hYmxlZCkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBcbiAgICBjb25zdCBhdHRyVHlwZSA9IGF0dHJpYnV0ZS50eXBlO1xuICAgIGNvbnN0IGZpZWxkVHlwZSA9IGF0dHJpYnV0ZS5maWVsZFR5cGU7XG4gICAgXG4gICAgLy8gKioxLiBCb29sZWFuIGZpZWxkcyoqXG4gICAgaWYgKGF0dHJUeXBlID09PSAnYm9vbGVhbicgJiYgbWVyZ2VkQ29uZmlnLmJvb2xlYW5GaWVsZHM/LmVuYWJsZWQgIT09IGZhbHNlKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBmaWx0ZXJUeXBlOiAnYm9vbGVhbicsXG4gICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6ICdlcScsXG4gICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IFsnZXEnLCAnbmVxJywgJ2lzRW1wdHknLCAnaXNOdWxsJ10sXG4gICAgICAgICAgICBwcmVkZWZpbmVkT3B0aW9uczogW1xuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdZZXMnLCB2YWx1ZTogXCJ0cnVlXCIgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnTm8nLCB2YWx1ZTogXCJmYWxzZVwiIH1cbiAgICAgICAgICAgIF1cbiAgICAgICAgfTtcbiAgICB9XG4gICAgXG4gICAgLy8gKioyLiBFbnVtIGZpZWxkcyAoYXJyYXkgb2Ygc3RyaW5ncy9udW1iZXJzKSoqXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoYXR0clR5cGUpICYmIG1lcmdlZENvbmZpZy5lbnVtRmllbGRzPy5lbmFibGVkICE9PSBmYWxzZSkge1xuICAgICAgICBjb25zdCBkZWZhdWx0RW51bU9wcyA9IFsnZXEnLCAnbmVxJywgJ2luTGlzdCcsICdub3RJbkxpc3QnLCAnaXNFbXB0eScsICdpc051bGwnXSBhcyBjb25zdDtcbiAgICAgICAgY29uc3QgZGVmYXVsdE9wID0gbWVyZ2VkQ29uZmlnLmVudW1GaWVsZHM/LmRlZmF1bHRPcGVyYXRvciB8fCAoJ2VxJyk7XG4gICAgICAgIGNvbnN0IGF2YWlsYWJsZU9wcyA9IG1lcmdlZENvbmZpZy5lbnVtRmllbGRzPy5hdmFpbGFibGVPcGVyYXRvcnMgfHwgZGVmYXVsdEVudW1PcHM7XG4gICAgICAgIFxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZmlsdGVyVHlwZTogJ3NlbGVjdCcsXG4gICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IGRlZmF1bHRPcCxcbiAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogYXZhaWxhYmxlT3BzLFxuICAgICAgICAgICAgcHJlZGVmaW5lZE9wdGlvbnM6IGF0dHJUeXBlLm1hcCh2YWwgPT4gKHtcbiAgICAgICAgICAgICAgICBsYWJlbDogU3RyaW5nKHZhbCksXG4gICAgICAgICAgICAgICAgdmFsdWU6IFN0cmluZyh2YWwpICAvLyBBbHdheXMgY29udmVydCB0byBzdHJpbmcgZm9yIGNvbnNpc3RlbmN5XG4gICAgICAgICAgICB9KSlcbiAgICAgICAgfTtcbiAgICB9XG4gICAgXG4gICAgXG4gICAgLy8gKiozLiBEYXRlL0RhdGV0aW1lIGZpZWxkcyoqXG4gICAgaWYgKChmaWVsZFR5cGUgPT09ICdkYXRlJyB8fCBmaWVsZFR5cGUgPT09ICdkYXRldGltZScgfHwgKGF0dHJUeXBlID09PSAnc3RyaW5nJyAmJiAoYXR0cmlidXRlLmlkLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoJ2RhdGUnKSB8fCBhdHRyaWJ1dGUuaWQudG9Mb3dlckNhc2UoKS5pbmNsdWRlcygndGltZScpKSkpXG4gICAgICAgICYmIG1lcmdlZENvbmZpZy5kYXRlRmllbGRzPy5lbmFibGVkICE9PSBmYWxzZSkge1xuICAgICAgICBjb25zdCBkZWZhdWx0RGF0ZU9wcyA9IFsnZXEnLCAnbmVxJywgJ2d0JywgJ2d0ZScsICdsdCcsICdsdGUnLCAnYmV0d2VlbicsICdpc0VtcHR5JywgJ2lzTnVsbCddIGFzIGNvbnN0O1xuICAgICAgICBjb25zdCBvcGVyYXRvcnMgPSBtZXJnZWRDb25maWcuZGF0ZUZpZWxkcz8uZGVmYXVsdE9wZXJhdG9ycyB8fCBkZWZhdWx0RGF0ZU9wcztcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IGZpbHRlckNvbmZpZzogYW55ID0ge1xuICAgICAgICAgICAgZmlsdGVyVHlwZTogJ2RhdGV0aW1lJyxcbiAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogb3BlcmF0b3JzWzBdIHx8ICgnZ3RlJyksXG4gICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IG9wZXJhdG9yc1xuICAgICAgICB9O1xuICAgICAgICBcbiAgICAgICAgLy8gQWRkIHF1aWNrIGRhdGUgZmlsdGVycyBpZiBlbmFibGVkXG4gICAgICAgIGlmIChtZXJnZWRDb25maWcuZGF0ZUZpZWxkcz8ucXVpY2tGaWx0ZXJzICE9PSBmYWxzZSkge1xuICAgICAgICAgICAgZmlsdGVyQ29uZmlnLnByZWRlZmluZWRPcHRpb25zID0gW1xuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdUb2RheScsIHZhbHVlOiAnOnN0YXJ0T2ZUb2RheScgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnWWVzdGVyZGF5JywgdmFsdWU6ICc6c3RhcnRPZlllc3RlcmRheScgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnVGhpcyBXZWVrJywgdmFsdWU6ICc6c3RhcnRPZldlZWsnIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ0xhc3QgV2VlaycsIHZhbHVlOiAnOnN0YXJ0T2ZMYXN0V2VlaycgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnVGhpcyBNb250aCcsIHZhbHVlOiAnOnN0YXJ0T2ZNb250aCcgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnTGFzdCBNb250aCcsIHZhbHVlOiAnOnN0YXJ0T2ZMYXN0TW9udGgnIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ1RoaXMgUXVhcnRlcicsIHZhbHVlOiAnOnN0YXJ0T2ZRdWFydGVyJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdMYXN0IFF1YXJ0ZXInLCB2YWx1ZTogJzpzdGFydE9mTGFzdFF1YXJ0ZXInIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ1RoaXMgWWVhcicsIHZhbHVlOiAnOnN0YXJ0T2ZZZWFyJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdMYXN0IFllYXInLCB2YWx1ZTogJzpzdGFydE9mTGFzdFllYXInIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ0xhc3QgNyBEYXlzJywgdmFsdWU6ICc6bm93TWludXM3RGF5cycgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiAnTGFzdCAzMCBEYXlzJywgdmFsdWU6ICc6bm93TWludXMzMERheXMnIH0sXG4gICAgICAgICAgICAgICAgeyBsYWJlbDogJ0xhc3QgOTAgRGF5cycsIHZhbHVlOiAnOm5vd01pbnVzOTBEYXlzJyB9LFxuICAgICAgICAgICAgICAgIHsgbGFiZWw6ICdDdXN0b20gRGF0ZScsIHZhbHVlOiBudWxsIH0gIC8vIFRyaWdnZXJzIGRhdGV0aW1lLWxvY2FsIGlucHV0XG4gICAgICAgICAgICBdO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICByZXR1cm4gZmlsdGVyQ29uZmlnO1xuICAgIH1cbiAgICBcbiAgICAvLyAqKjUuIE51bWJlciBmaWVsZHMqKlxuICAgIGlmIChhdHRyVHlwZSA9PT0gJ251bWJlcicgJiYgbWVyZ2VkQ29uZmlnLm51bWJlckZpZWxkcz8uZW5hYmxlZCAhPT0gZmFsc2UpIHtcbiAgICAgICAgY29uc3QgZGVmYXVsdE51bWJlck9wcyA9IFsnZXEnLCAnbmVxJywgJ2d0JywgJ2d0ZScsICdsdCcsICdsdGUnLCAnYmV0d2VlbicsICdpc0VtcHR5JywgJ2lzTnVsbCddIGFzIGNvbnN0O1xuICAgICAgICBjb25zdCBvcGVyYXRvcnMgPSBtZXJnZWRDb25maWcubnVtYmVyRmllbGRzPy5kZWZhdWx0T3BlcmF0b3JzIHx8IGRlZmF1bHROdW1iZXJPcHM7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBmaWx0ZXJUeXBlOiAnbnVtYmVyJyxcbiAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogb3BlcmF0b3JzWzBdIHx8ICgnZXEnKSxcbiAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogb3BlcmF0b3JzXG4gICAgICAgIH07XG4gICAgfVxuICAgIFxuICAgIC8vICoqNC4gUmVsYXRpb24gZmllbGRzICh3aXRob3V0IGV4cGxpY2l0IG9wdGlvbnMpIC0gYXV0by1nZW5lcmF0ZSBmcm9tIHJlbGF0aW9uIG1ldGFkYXRhKipcbiAgICBpZiAoYXR0cmlidXRlLnJlbGF0aW9uICYmIG1lcmdlZENvbmZpZy5yZWxhdGlvbkZpZWxkcz8uZW5hYmxlZCAhPT0gZmFsc2UgJiYgZW50aXR5U2VydmljZSkge1xuICAgICAgICBjb25zdCByZWxhdGlvbkNvbmZpZzogUmVsYXRpb25FbnRpdHlPcHRpb25Db25maWcgPSB7IGVudGl0eU5hbWU6IGF0dHJpYnV0ZS5yZWxhdGlvbi5lbnRpdHlOYW1lIH07XG4gICAgICAgIGNvbnN0IHJlc29sdmVkID0gcmVzb2x2ZVJlbGF0aW9uT3B0aW9uQ29uZmlnKFxuICAgICAgICAgICAgcmVsYXRpb25Db25maWcsXG4gICAgICAgICAgICBhdHRyaWJ1dGUgYXMgVElPU2NoZW1hQXR0cmlidXRlICYgeyByZWxhdGlvbjogTm9uTnVsbGFibGU8VElPU2NoZW1hQXR0cmlidXRlWydyZWxhdGlvbiddPiB9LFxuICAgICAgICAgICAgZW50aXR5U2VydmljZVxuICAgICAgICApO1xuICAgICAgICBcbiAgICAgICAgaWYgKHJlc29sdmVkKSB7XG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIGZpbHRlclR5cGU6ICdyZWxhdGlvbicsXG4gICAgICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiAnZXEnIGFzIGNvbnN0LFxuICAgICAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogWydlcScsICduZXEnLCAnaW5MaXN0JywgJ25vdEluTGlzdCcsICdpc0VtcHR5JywgJ2lzTnVsbCddLFxuICAgICAgICAgICAgICAgIHByZWRlZmluZWRPcHRpb25zOiByZXNvbHZlZFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICAvLyAqKjYuIFRleHQgZmllbGRzIChkZWZhdWx0IGZhbGxiYWNrKSoqXG4gICAgaWYgKGF0dHJUeXBlID09PSAnc3RyaW5nJyAmJiBtZXJnZWRDb25maWcudGV4dEZpZWxkcz8uZW5hYmxlZCAhPT0gZmFsc2UpIHtcbiAgICAgICAgY29uc3QgZGVmYXVsdFRleHRPcHMgPSBbJ2NvbnRhaW5zJywgJ25vdENvbnRhaW5zJywgJ2VxJywgJ25lcScsICdzdGFydHNXaXRoJywgJ2VuZHNXaXRoJywgJ2xpa2UnLCAnaXNFbXB0eScsICdpc051bGwnXTtcbiAgICAgICAgY29uc3Qgb3BlcmF0b3JzID0gbWVyZ2VkQ29uZmlnLnRleHRGaWVsZHM/LmRlZmF1bHRPcGVyYXRvcnMgfHwgZGVmYXVsdFRleHRPcHM7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBmaWx0ZXJUeXBlOiAndGV4dCcsXG4gICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IG9wZXJhdG9yc1swXSB8fCAoJ2NvbnRhaW5zJyksXG4gICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IG9wZXJhdG9yc1xuICAgICAgICB9O1xuICAgIH1cbiAgICBcbiAgICAvLyBEZWJ1ZyBsb2dnaW5nXG4gICAgaWYgKG1lcmdlZENvbmZpZy5kZWJ1Zykge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtGaWx0ZXJBdXRvR2VuXSAke2F0dHJpYnV0ZS5pZH06IE5vIGZpbHRlciBjb25maWcgZ2VuZXJhdGVkICh0eXBlOiAke2F0dHJUeXBlfSlgKTtcbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTRUdNRU5UIEFVVE8tR0VORVJBVElPTlxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogU21hcnQgaWNvbiBtYXBwaW5nIGZvciBzZWdtZW50IHZhbHVlcy5cbiAqIFByb3ZpZGVzIHNlbnNpYmxlIGRlZmF1bHRzIGZvciBjb21tb24gc3RhdHVzL3N0YXRlIHBhdHRlcm5zLlxuICogSWNvbnMgbWF0Y2ggdWkyNC9zcmMvY29yZS9jb21tb24vSWNvbnMvSWNvbnMudHN4IG5hbWluZyBjb252ZW50aW9ucy5cbiAqL1xuY29uc3QgREVGQVVMVF9JQ09OX01BUFBJTkc6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgLy8gQWN0aXZlL0luYWN0aXZlIHBhdHRlcm5zXG4gICAgJ2FjdGl2ZSc6ICdDaGVja0NpcmNsZU91dGxpbmVkJyxcbiAgICAnaW5hY3RpdmUnOiAnQ2xvc2VDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2VuYWJsZWQnOiAnQ2hlY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2Rpc2FibGVkJzogJ0Nsb3NlQ2lyY2xlT3V0bGluZWQnLFxuICAgIFxuICAgIC8vIFN0YXR1cyBwYXR0ZXJuc1xuICAgICdwZW5kaW5nJzogJ0Nsb2NrQ2lyY2xlT3V0bGluZWQnLFxuICAgICdpbi1wcm9ncmVzcyc6ICdTeW5jT3V0bGluZWQnLFxuICAgICdpbnByb2dyZXNzJzogJ1N5bmNPdXRsaW5lZCcsXG4gICAgJ2NvbXBsZXRlZCc6ICdDaGVja0NpcmNsZU91dGxpbmVkJyxcbiAgICAnZG9uZSc6ICdDaGVja091dGxpbmVkJyxcbiAgICAnZmluaXNoZWQnOiAnQ2hlY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2NhbmNlbGxlZCc6ICdDbG9zZUNpcmNsZU91dGxpbmVkJyxcbiAgICAnY2FuY2VsZWQnOiAnQ2xvc2VDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ2ZhaWxlZCc6ICdDbG9zZUNpcmNsZU91dGxpbmVkJyxcbiAgICAnZXJyb3InOiAnRXhjbGFtYXRpb25DaXJjbGVPdXRsaW5lZCcsXG4gICAgJ3BhdXNlZCc6ICdQYXVzZUNpcmNsZU91dGxpbmVkJyxcbiAgICBcbiAgICAvLyBTY2hlZHVsaW5nIHBhdHRlcm5zXG4gICAgJ3NjaGVkdWxlZCc6ICdDYWxlbmRhck91dGxpbmVkJyxcbiAgICAndXBjb21pbmcnOiAnQ2FsZW5kYXJPdXRsaW5lZCcsXG4gICAgJ2xpdmUnOiAnUGxheUNpcmNsZU91dGxpbmVkJyxcbiAgICAnZHJhZnQnOiAnRmlsZU91dGxpbmVkJyxcbiAgICAncHVibGlzaGVkJzogJ0NoZWNrQ2lyY2xlT3V0bGluZWQnLFxuICAgICdhcmNoaXZlZCc6ICdGb2xkZXJPdXRsaW5lZCcsXG4gICAgXG4gICAgLy8gUHJpb3JpdHkgcGF0dGVybnNcbiAgICAnbG93JzogJ0Rvd25PdXRsaW5lZCcsXG4gICAgJ21lZGl1bSc6ICdNaW51c091dGxpbmVkJyxcbiAgICAnaGlnaCc6ICdVcE91dGxpbmVkJyxcbiAgICAnY3JpdGljYWwnOiAnV2FybmluZ091dGxpbmVkJyxcbiAgICAndXJnZW50JzogJ0ZpcmVPdXRsaW5lZCcsXG4gICAgXG4gICAgLy8gQXBwcm92YWwgcGF0dGVybnNcbiAgICAnYXBwcm92ZWQnOiAnQ2hlY2tDaXJjbGVPdXRsaW5lZCcsXG4gICAgJ3JlamVjdGVkJzogJ0Nsb3NlQ2lyY2xlT3V0bGluZWQnLFxuICAgICdyZXZpZXcnOiAnRXllT3V0bGluZWQnLFxuICAgIFxuICAgIC8vIEJvb2xlYW4gVHJ1ZS9GYWxzZVxuICAgICd0cnVlJzogJ0NoZWNrQ2lyY2xlT3V0bGluZWQnLFxuICAgICdmYWxzZSc6ICdDbG9zZUNpcmNsZU91dGxpbmVkJ1xufTtcblxuLyoqXG4gKiBJbnRlbGxpZ2VudGx5IGV4dHJhY3QgYm9vbGVhbiBsYWJlbHMgZnJvbSBmaWVsZCBuYW1lIHBhdHRlcm5zLlxuICogU3VwcG9ydHMgY29tbW9uIGJvb2xlYW4gcHJlZml4ZXMgbGlrZSBpcy9oYXMvY2FuL3Nob3VsZC93aWxsL2V0Yy5cbiAqIFxuICogQGV4YW1wbGVcbiAqIC0gaXNBY3RpdmUg4oaSIFwiQWN0aXZlXCIgLyBcIkluYWN0aXZlXCJcbiAqIC0gaGFzUGVybWlzc2lvbiDihpIgXCJIYXMgUGVybWlzc2lvblwiIC8gXCJObyBQZXJtaXNzaW9uXCJcbiAqIC0gY2FuRWRpdCDihpIgXCJDYW4gRWRpdFwiIC8gXCJDYW5ub3QgRWRpdFwiXG4gKiAtIGlzTGl2ZSDihpIgXCJMaXZlXCIgLyBcIk5vdCBMaXZlXCJcbiAqIC0gc2hvdWxkTm90aWZ5IOKGkiBcIlNob3VsZCBOb3RpZnlcIiAvIFwiU2hvdWxkIE5vdCBOb3RpZnlcIlxuICovXG5mdW5jdGlvbiBleHRyYWN0Qm9vbGVhbkxhYmVsc0Zyb21GaWVsZE5hbWUoZmllbGROYW1lOiBzdHJpbmcpOiB7IHRydWVMYWJlbDogc3RyaW5nOyBmYWxzZUxhYmVsOiBzdHJpbmcgfSB8IG51bGwge1xuICAgIC8vIENvbW1vbiBib29sZWFuIHByZWZpeGVzIHdpdGggdGhlaXIgbmVnYXRpdmUgZm9ybXNcbiAgICBjb25zdCBwYXR0ZXJucyA9IFtcbiAgICAgICAgLy8gUGF0dGVybjogaXMgKyBYWFhcbiAgICAgICAge1xuICAgICAgICAgICAgcmVnZXg6IC9eaXMoW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiB0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWzFdKSxcbiAgICAgICAgICAgIGdldEZhbHNlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGJhc2UgPSB0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWzFdKTtcbiAgICAgICAgICAgICAgICAvLyBTcGVjaWFsIGNhc2VzIGZvciBiZXR0ZXIgbmVnYXRpb25cbiAgICAgICAgICAgICAgICBpZiAoYmFzZS50b0xvd2VyQ2FzZSgpID09PSAnYWN0aXZlJykgcmV0dXJuICdJbmFjdGl2ZSc7XG4gICAgICAgICAgICAgICAgaWYgKGJhc2UudG9Mb3dlckNhc2UoKSA9PT0gJ2VuYWJsZWQnKSByZXR1cm4gJ0Rpc2FibGVkJztcbiAgICAgICAgICAgICAgICBpZiAoYmFzZS50b0xvd2VyQ2FzZSgpID09PSAndmlzaWJsZScpIHJldHVybiAnSGlkZGVuJztcbiAgICAgICAgICAgICAgICBpZiAoYmFzZS50b0xvd2VyQ2FzZSgpID09PSAncHVibGljJykgcmV0dXJuICdQcml2YXRlJztcbiAgICAgICAgICAgICAgICBpZiAoYmFzZS50b0xvd2VyQ2FzZSgpID09PSAnYXZhaWxhYmxlJykgcmV0dXJuICdVbmF2YWlsYWJsZSc7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGBOb3QgJHtiYXNlfWA7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBhdHRlcm46IGhhcyArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL15oYXMoW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgSGFzICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsxXSl9YCxcbiAgICAgICAgICAgIGdldEZhbHNlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYE5vICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsxXSl9YFxuICAgICAgICB9LFxuICAgICAgICAvLyBQYXR0ZXJuOiBjYW4gKyBYWFhcbiAgICAgICAge1xuICAgICAgICAgICAgcmVnZXg6IC9eY2FuKFtBLVpdW2EtekEtWjAtOV0qKS8sXG4gICAgICAgICAgICBnZXRUcnVlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYENhbiAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbMV0pfWAsXG4gICAgICAgICAgICBnZXRGYWxzZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBDYW5ub3QgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWzFdKX1gXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBhdHRlcm46IHNob3VsZCArIFhYWFxuICAgICAgICB7XG4gICAgICAgICAgICByZWdleDogL15zaG91bGQoW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgU2hvdWxkICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsxXSl9YCxcbiAgICAgICAgICAgIGdldEZhbHNlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYFNob3VsZCBOb3QgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWzFdKX1gXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBhdHRlcm46IHdpbGwgKyBYWFhcbiAgICAgICAge1xuICAgICAgICAgICAgcmVnZXg6IC9ed2lsbChbQS1aXVthLXpBLVowLTldKikvLFxuICAgICAgICAgICAgZ2V0VHJ1ZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBXaWxsICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsxXSl9YCxcbiAgICAgICAgICAgIGdldEZhbHNlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYFdpbGwgTm90ICR7dG9IdW1hblJlYWRhYmxlTmFtZShtYXRjaFsxXSl9YFxuICAgICAgICB9LFxuICAgICAgICAvLyBQYXR0ZXJuOiBhbGxvd3MgKyBYWFhcbiAgICAgICAge1xuICAgICAgICAgICAgcmVnZXg6IC9eYWxsb3dzKFtBLVpdW2EtekEtWjAtOV0qKS8sXG4gICAgICAgICAgICBnZXRUcnVlTGFiZWw6IChtYXRjaDogUmVnRXhwTWF0Y2hBcnJheSkgPT4gYEFsbG93cyAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbMV0pfWAsXG4gICAgICAgICAgICBnZXRGYWxzZUxhYmVsOiAobWF0Y2g6IFJlZ0V4cE1hdGNoQXJyYXkpID0+IGBEb2VzIE5vdCBBbGxvdyAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbMV0pfWBcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGF0dGVybjogbmVlZHMgKyBYWFhcbiAgICAgICAge1xuICAgICAgICAgICAgcmVnZXg6IC9ebmVlZHMoW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgTmVlZHMgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWzFdKX1gLFxuICAgICAgICAgICAgZ2V0RmFsc2VMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgRG9lcyBOb3QgTmVlZCAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbMV0pfWBcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGF0dGVybjogcmVxdWlyZXMgKyBYWFhcbiAgICAgICAge1xuICAgICAgICAgICAgcmVnZXg6IC9ecmVxdWlyZXMoW0EtWl1bYS16QS1aMC05XSopLyxcbiAgICAgICAgICAgIGdldFRydWVMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgUmVxdWlyZXMgJHt0b0h1bWFuUmVhZGFibGVOYW1lKG1hdGNoWzFdKX1gLFxuICAgICAgICAgICAgZ2V0RmFsc2VMYWJlbDogKG1hdGNoOiBSZWdFeHBNYXRjaEFycmF5KSA9PiBgRG9lcyBOb3QgUmVxdWlyZSAke3RvSHVtYW5SZWFkYWJsZU5hbWUobWF0Y2hbMV0pfWBcbiAgICAgICAgfVxuICAgIF07XG4gICAgXG4gICAgZm9yIChjb25zdCBwYXR0ZXJuIG9mIHBhdHRlcm5zKSB7XG4gICAgICAgIGNvbnN0IG1hdGNoID0gZmllbGROYW1lLm1hdGNoKHBhdHRlcm4ucmVnZXgpO1xuICAgICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgdHJ1ZUxhYmVsOiBwYXR0ZXJuLmdldFRydWVMYWJlbChtYXRjaCksXG4gICAgICAgICAgICAgICAgZmFsc2VMYWJlbDogcGF0dGVybi5nZXRGYWxzZUxhYmVsKG1hdGNoKVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBHZXQgdGhlIG51bWJlciBvZiBvcHRpb25zIGZvciBhIGZpZWxkLlxuICovXG5mdW5jdGlvbiBnZXRGaWVsZE9wdGlvbkNvdW50KGZpZWxkOiBUSU9TY2hlbWFBdHRyaWJ1dGUpOiBudW1iZXIge1xuICAgIC8vIDEuIEVudW0gdHlwZSBhcnJheVxuICAgIGlmIChBcnJheS5pc0FycmF5KGZpZWxkLnR5cGUpKSB7XG4gICAgICAgIHJldHVybiBmaWVsZC50eXBlLmxlbmd0aDtcbiAgICB9XG4gICAgXG4gICAgLy8gMi4gQm9vbGVhbiBmaWVsZFxuICAgIGlmIChmaWVsZC50eXBlID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgcmV0dXJuIDI7XG4gICAgfVxuICAgIFxuICAgIC8vIDMuIFNlbGVjdC9yYWRpby9jaGVja2JveCBmaWVsZCB3aXRoIGlubGluZSBvcHRpb25zXG4gICAgY29uc3QgZmllbGRUeXBlID0gZmllbGQuZmllbGRUeXBlO1xuICAgIGlmIChmaWVsZFR5cGUgPT09ICdzZWxlY3QnIHx8IGZpZWxkVHlwZSA9PT0gJ3JhZGlvJyB8fCBmaWVsZFR5cGUgPT09ICdjaGVja2JveCcgfHwgZmllbGRUeXBlID09PSAnbXVsdGktc2VsZWN0Jykge1xuICAgICAgICBjb25zdCBvcHRpb25zID0gKGZpZWxkIGFzIGFueSkub3B0aW9ucztcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkob3B0aW9ucykpIHtcbiAgICAgICAgICAgIHJldHVybiBvcHRpb25zLmxlbmd0aDtcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICByZXR1cm4gMDtcbn1cblxuLyoqXG4gKiBDaGVjayBpZiBhIGZpZWxkIGlzIHZpYWJsZSBmb3Igc2VnbWVudCBnZW5lcmF0aW9uLlxuICogU3VwcG9ydHM6XG4gKiAtIEVudW0gdHlwZXM6IHR5cGU6IFsndmFsdWUxJywgJ3ZhbHVlMiddXG4gKiAtIEJvb2xlYW4gdHlwZXM6IHR5cGU6ICdib29sZWFuJ1xuICogLSBTZWxlY3QvcmFkaW8vY2hlY2tib3ggZmllbGRzIHdpdGggb3B0aW9uczogZmllbGRUeXBlOiAnc2VsZWN0JyArIG9wdGlvbnM6IFsuLi5dXG4gKiBcbiAqIFNUUklDVExZIGVuZm9yY2VzOiBtaW5WYWx1ZXMgPD0gb3B0aW9uQ291bnQgPD0gbWF4U2VnbWVudHNQZXJHcm91cFxuICovXG5mdW5jdGlvbiBpc1ZpYWJsZVNlZ21lbnRGaWVsZChcbiAgICBmaWVsZDogVElPU2NoZW1hQXR0cmlidXRlLFxuICAgIGNvbmZpZzogUmVxdWlyZWQ8SVNlZ21lbnRBdXRvR2VuZXJhdGlvbkNvbmZpZz4gJiB7IG1heFNlZ21lbnRzUGVyR3JvdXA/OiBudW1iZXIgfVxuKTogYm9vbGVhbiB7XG4gICAgY29uc3QgbWF4VmFsdWVzID0gY29uZmlnLm1heFNlZ21lbnRzUGVyR3JvdXAgfHwgMTA7XG4gICAgY29uc3Qgb3B0aW9uQ291bnQgPSBnZXRGaWVsZE9wdGlvbkNvdW50KGZpZWxkKTtcbiAgICBcbiAgICAvLyBNdXN0IGhhdmUgb3B0aW9ucyBBTkQgYmUgd2l0aGluIGJvdW5kc1xuICAgIGlmIChvcHRpb25Db3VudCA9PT0gMCkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIFxuICAgIC8vIFNUUklDVDogUmVqZWN0IGlmIG91dHNpZGUgYm91bmRzXG4gICAgcmV0dXJuIG9wdGlvbkNvdW50ID49IGNvbmZpZy5taW5WYWx1ZXMgJiYgb3B0aW9uQ291bnQgPD0gbWF4VmFsdWVzO1xufVxuXG4vKipcbiAqIEludGVsbGlnZW50bHkgZGV0ZWN0IHRoZSBiZXN0IGZpZWxkKHMpIGZvciBnZW5lcmF0aW5nIHNlZ21lbnRzLlxuICogUmV0dXJucyBtdWx0aXBsZSBmaWVsZHMgaWYgbWF4U2VnbWVudEdyb3VwcyA+IDEuXG4gKiBcbiAqIFByaW9yaXR5OlxuICogMS4gRXhwbGljaXQgc2VnbWVudEZpZWxkcyAoZW50aXR5IGNvbmZpZykg4oaSIFVzZSB0aG9zZSBmaWVsZHNcbiAqIDIuIGluY2x1ZGVGaWVsZHMgZmlsdGVyIChlbnRpdHkgY29uZmlnKSDihpIgT25seSBjb25zaWRlciB0aGVzZVxuICogMy4gZXhjbHVkZUZpZWxkcyBmaWx0ZXIgKGVudGl0eSBjb25maWcpIOKGkiBTa2lwIHRoZXNlXG4gKiA0LiBwcmVmZXJyZWRGaWVsZHMgKGdsb2JhbC9lbnRpdHkgY29uZmlnKSDihpIgVHJ5IHRoZXNlIGZpcnN0XG4gKiA1LiBTY29yaW5nIGFsZ29yaXRobSDihpIgU2NvcmUgYWxsIGNhbmRpZGF0ZXMgYW5kIHBpY2sgdG9wIE5cbiAqL1xuZnVuY3Rpb24gZGV0ZWN0U2VnbWVudEZpZWxkczxTIGV4dGVuZHMgRW50aXR5U2NoZW1hPHN0cmluZywgc3RyaW5nLCBzdHJpbmc+PihcbiAgICBwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVzTWFwPFM+LFxuICAgIGdsb2JhbENvbmZpZz86IElTZWdtZW50QXV0b0dlbmVyYXRpb25Db25maWcsXG4gICAgZW50aXR5Q29uZmlnPzogTm9uTnVsbGFibGU8UmV0dXJuVHlwZTx0eXBlb2YgQmFzZUVudGl0eVNlcnZpY2UucHJvdG90eXBlLmdldEVudGl0eVNjaGVtYT5bJ21vZGVsJ11bJ21ldGFkYXRhJ10+Wyd0YWJsZVVJJ11cbik6IEFycmF5PHsgZmllbGQ6IFRJT1NjaGVtYUF0dHJpYnV0ZTsgc2NvcmU6IG51bWJlcjsgcmVhc29uOiBzdHJpbmcgfT4ge1xuICAgIGNvbnN0IHNlZ21lbnRDb25maWcgPSBlbnRpdHlDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbjtcbiAgICBcbiAgICAvLyBNZXJnZSBjb25maWdzIChlbnRpdHkgPiBnbG9iYWwgPiBkZWZhdWx0cylcbiAgICBjb25zdCBtZXJnZWRDb25maWc6IFJlcXVpcmVkPElTZWdtZW50QXV0b0dlbmVyYXRpb25Db25maWc+ICYgeyBtYXhTZWdtZW50R3JvdXBzOiBudW1iZXI7IG1heFNlZ21lbnRzUGVyR3JvdXA6IG51bWJlciB9ID0ge1xuICAgICAgICBlbmFibGVkOiBzZWdtZW50Q29uZmlnPy5lbmFibGVkID8/IGdsb2JhbENvbmZpZz8uZW5hYmxlZCA/PyB0cnVlLFxuICAgICAgICBwcmVmZXJyZWRGaWVsZHM6IHNlZ21lbnRDb25maWc/LnByZWZlcnJlZEZpZWxkcyB8fCBnbG9iYWxDb25maWc/LnByZWZlcnJlZEZpZWxkcyB8fCBbJ3N0YXR1cycsICdzdGF0ZScsICd0eXBlJywgJ2NhdGVnb3J5JywgJ3ByaW9yaXR5J10sXG4gICAgICAgIG1heFNlZ21lbnRHcm91cHM6IHNlZ21lbnRDb25maWc/Lm1heFNlZ21lbnRHcm91cHMgPz8gZ2xvYmFsQ29uZmlnPy5tYXhTZWdtZW50R3JvdXBzID8/IDIsXG4gICAgICAgIG1heFNlZ21lbnRzUGVyR3JvdXA6IHNlZ21lbnRDb25maWc/Lm1heFNlZ21lbnRzUGVyR3JvdXAgPz8gZ2xvYmFsQ29uZmlnPy5tYXhTZWdtZW50c1Blckdyb3VwID8/IDEwLFxuICAgICAgICBtaW5WYWx1ZXM6IHNlZ21lbnRDb25maWc/Lm1pblZhbHVlcyA/PyBnbG9iYWxDb25maWc/Lm1pblZhbHVlcyA/PyAyLFxuICAgICAgICBpY29uTWFwcGluZzogeyAuLi5ERUZBVUxUX0lDT05fTUFQUElORywgLi4uZ2xvYmFsQ29uZmlnPy5pY29uTWFwcGluZywgLi4uc2VnbWVudENvbmZpZz8uaWNvbk1hcHBpbmcgfSxcbiAgICAgICAgYm9vbGVhbkxhYmVsUGF0dGVybnM6IHNlZ21lbnRDb25maWc/LmJvb2xlYW5MYWJlbFBhdHRlcm5zIHx8IGdsb2JhbENvbmZpZz8uYm9vbGVhbkxhYmVsUGF0dGVybnMgfHwgW10sXG4gICAgICAgIGRlZmF1bHRCb29sZWFuTGFiZWxzOiBzZWdtZW50Q29uZmlnPy5kZWZhdWx0Qm9vbGVhbkxhYmVscyB8fCBnbG9iYWxDb25maWc/LmRlZmF1bHRCb29sZWFuTGFiZWxzIHx8IHsgdHJ1ZTogJ1llcycsIGZhbHNlOiAnTm8nIH0sXG4gICAgICAgIGluY2x1ZGVBbGxTZWdtZW50OiBzZWdtZW50Q29uZmlnPy5pbmNsdWRlQWxsU2VnbWVudCA/PyBnbG9iYWxDb25maWc/LmluY2x1ZGVBbGxTZWdtZW50ID8/IHRydWUsXG4gICAgICAgIGRlYnVnOiBzZWdtZW50Q29uZmlnPy5kZWJ1ZyA/PyBnbG9iYWxDb25maWc/LmRlYnVnID8/IGZhbHNlXG4gICAgfTtcbiAgICBcbiAgICBpZiAoIW1lcmdlZENvbmZpZy5lbmFibGVkKSB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICB9XG4gICAgXG4gICAgLy8gPT09IFBSSU9SSVRZIDE6IEV4cGxpY2l0IHNlZ21lbnQgZmllbGRzID09PVxuICAgIGNvbnN0IGV4cGxpY2l0RmllbGRzID0gc2VnbWVudENvbmZpZz8uc2VnbWVudEZpZWxkcyB8fCBzZWdtZW50Q29uZmlnPy5zZWdtZW50RmllbGQ7XG4gICAgaWYgKGV4cGxpY2l0RmllbGRzKSB7XG4gICAgICAgIGNvbnN0IGZpZWxkTmFtZXMgPSB0eXBlb2YgZXhwbGljaXRGaWVsZHMgPT09ICdzdHJpbmcnID8gW2V4cGxpY2l0RmllbGRzXSA6IGV4cGxpY2l0RmllbGRzO1xuICAgICAgICBjb25zdCByZXN1bHRzOiBBcnJheTx7IGZpZWxkOiBUSU9TY2hlbWFBdHRyaWJ1dGU7IHNjb3JlOiBudW1iZXI7IHJlYXNvbjogc3RyaW5nIH0+ID0gW107XG4gICAgICAgIFxuICAgICAgICBmb3IgKGNvbnN0IGZpZWxkTmFtZSBvZiBmaWVsZE5hbWVzKSB7XG4gICAgICAgICAgICBjb25zdCBmaWVsZCA9IEFycmF5LmZyb20ocHJvcGVydGllcy52YWx1ZXMoKSkuZmluZChwID0+IHAuaWQgPT09IGZpZWxkTmFtZSk7XG4gICAgICAgICAgICBpZiAoZmllbGQpIHtcbiAgICAgICAgICAgICAgICByZXN1bHRzLnB1c2goeyBmaWVsZCwgc2NvcmU6IDEwMDAsIHJlYXNvbjogJ2V4cGxpY2l0IGNvbmZpZ3VyYXRpb24nIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBpZiAocmVzdWx0cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0cy5zbGljZSgwLCBtZXJnZWRDb25maWcubWF4U2VnbWVudEdyb3Vwcyk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLy8gPT09IEZpbHRlciBwcm9wZXJ0aWVzIGJhc2VkIG9uIGluY2x1ZGUvZXhjbHVkZSA9PT1cbiAgICBsZXQgY2FuZGlkYXRlUHJvcGVydGllcyA9IEFycmF5LmZyb20ocHJvcGVydGllcy52YWx1ZXMoKSk7XG4gICAgXG4gICAgLy8gQXBwbHkgaW5jbHVkZUZpZWxkcyBmaWx0ZXIgKGlmIHByb3ZpZGVkLCBPTkxZIGNvbnNpZGVyIHRoZXNlKVxuICAgIGlmIChzZWdtZW50Q29uZmlnPy5pbmNsdWRlRmllbGRzICYmIHNlZ21lbnRDb25maWcuaW5jbHVkZUZpZWxkcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNhbmRpZGF0ZVByb3BlcnRpZXMgPSBjYW5kaWRhdGVQcm9wZXJ0aWVzLmZpbHRlcihwID0+IFxuICAgICAgICAgICAgc2VnbWVudENvbmZpZy5pbmNsdWRlRmllbGRzIS5pbmNsdWRlcyhwLmlkKVxuICAgICAgICApO1xuICAgIH1cbiAgICBcbiAgICAvLyBBcHBseSBleGNsdWRlRmllbGRzIGZpbHRlclxuICAgIGlmIChzZWdtZW50Q29uZmlnPy5leGNsdWRlRmllbGRzICYmIHNlZ21lbnRDb25maWcuZXhjbHVkZUZpZWxkcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNhbmRpZGF0ZVByb3BlcnRpZXMgPSBjYW5kaWRhdGVQcm9wZXJ0aWVzLmZpbHRlcihwID0+IFxuICAgICAgICAgICAgIXNlZ21lbnRDb25maWcuZXhjbHVkZUZpZWxkcyEuaW5jbHVkZXMocC5pZClcbiAgICAgICAgKTtcbiAgICB9XG4gICAgXG4gICAgLy8gPT09IFBSSU9SSVRZIDI6IFByZWZlcnJlZCBmaWVsZHMgPT09XG4gICAgY29uc3QgcHJlZmVycmVkRmllbGRzID0gbWVyZ2VkQ29uZmlnLnByZWZlcnJlZEZpZWxkcztcbiAgICBjb25zdCBwcmVmZXJyZWRNYXRjaGVzOiBBcnJheTx7IGZpZWxkOiBUSU9TY2hlbWFBdHRyaWJ1dGU7IHNjb3JlOiBudW1iZXI7IHJlYXNvbjogc3RyaW5nIH0+ID0gW107XG4gICAgXG4gICAgZm9yIChjb25zdCBwcmVmZXJyZWROYW1lIG9mIHByZWZlcnJlZEZpZWxkcykge1xuICAgICAgICBjb25zdCBmaWVsZCA9IGNhbmRpZGF0ZVByb3BlcnRpZXMuZmluZChwID0+IHAuaWQgPT09IHByZWZlcnJlZE5hbWUpO1xuICAgICAgICBpZiAoZmllbGQgJiYgaXNWaWFibGVTZWdtZW50RmllbGQoZmllbGQsIG1lcmdlZENvbmZpZykpIHtcbiAgICAgICAgICAgIHByZWZlcnJlZE1hdGNoZXMucHVzaCh7IGZpZWxkLCBzY29yZTogOTAwLCByZWFzb246IGBwcmVmZXJyZWQgZmllbGQ6ICR7cHJlZmVycmVkTmFtZX1gIH0pO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8vIElmIHdlIGhhdmUgZW5vdWdoIHByZWZlcnJlZCBtYXRjaGVzLCByZXR1cm4gdGhlbVxuICAgIGlmIChwcmVmZXJyZWRNYXRjaGVzLmxlbmd0aCA+PSBtZXJnZWRDb25maWcubWF4U2VnbWVudEdyb3Vwcykge1xuICAgICAgICByZXR1cm4gcHJlZmVycmVkTWF0Y2hlcy5zbGljZSgwLCBtZXJnZWRDb25maWcubWF4U2VnbWVudEdyb3Vwcyk7XG4gICAgfVxuICAgIFxuICAgIC8vID09PSBQUklPUklUWSAzOiBTY29yaW5nIGFsZ29yaXRobSA9PT1cbiAgICBjb25zdCBjYW5kaWRhdGVzOiBBcnJheTx7IGZpZWxkOiBUSU9TY2hlbWFBdHRyaWJ1dGU7IHNjb3JlOiBudW1iZXI7IHJlYXNvbjogc3RyaW5nOyBvcHRpb25Db3VudDogbnVtYmVyIH0+ID0gW107XG4gICAgXG4gICAgLy8gQWRkIHByZWZlcnJlZE1hdGNoZXMgd2l0aCB0aGVpciBvcHRpb24gY291bnRzXG4gICAgZm9yIChjb25zdCBwbSBvZiBwcmVmZXJyZWRNYXRjaGVzKSB7XG4gICAgICAgIGNvbnN0IG9wdGlvbkNvdW50ID0gZ2V0RmllbGRPcHRpb25Db3VudChwbS5maWVsZCk7XG4gICAgICAgIGNhbmRpZGF0ZXMucHVzaCh7IC4uLnBtLCBvcHRpb25Db3VudCB9KTtcbiAgICB9XG4gICAgXG4gICAgZm9yIChjb25zdCBwcm9wIG9mIGNhbmRpZGF0ZVByb3BlcnRpZXMpIHtcbiAgICAgICAgLy8gU2tpcCBpZiBhbHJlYWR5IGluIHByZWZlcnJlZE1hdGNoZXNcbiAgICAgICAgaWYgKHByZWZlcnJlZE1hdGNoZXMuc29tZShwbSA9PiBwbS5maWVsZC5pZCA9PT0gcHJvcC5pZCkpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBTa2lwIGlmIG5vdCB2aWFibGUgKHRoaXMgZmlsdGVycyBvdXQgZmllbGRzIHdpdGggdG9vIG1hbnkgb3B0aW9ucylcbiAgICAgICAgaWYgKCFpc1ZpYWJsZVNlZ21lbnRGaWVsZChwcm9wLCBtZXJnZWRDb25maWcpKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgbGV0IHNjb3JlID0gMDtcbiAgICAgICAgY29uc3QgcmVhc29uczogc3RyaW5nW10gPSBbXTtcbiAgICAgICAgY29uc3Qgb3B0aW9uQ291bnQgPSBnZXRGaWVsZE9wdGlvbkNvdW50KHByb3ApO1xuICAgICAgICBcbiAgICAgICAgLy8gKipTY29yZSAxOiBGaWVsZCBuYW1lIG1hdGNoKiogKHBhcnRpYWwgbWF0Y2ggd2l0aCBwcmVmZXJyZWQgbmFtZXMpXG4gICAgICAgIGZvciAoY29uc3QgcHJlZmVycmVkIG9mIHByZWZlcnJlZEZpZWxkcykge1xuICAgICAgICAgICAgaWYgKHByb3AuaWQudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhwcmVmZXJyZWQudG9Mb3dlckNhc2UoKSkpIHtcbiAgICAgICAgICAgICAgICBzY29yZSArPSA1MDtcbiAgICAgICAgICAgICAgICByZWFzb25zLnB1c2goYG5hbWUgY29udGFpbnMgXCIke3ByZWZlcnJlZH1cImApO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyAqKlNjb3JlIDI6IFByZWZlciBmZXdlciBvcHRpb25zIChpbnZlcnNlIHNjb3JpbmcpKipcbiAgICAgICAgLy8gRmllbGRzIHdpdGggZmV3ZXIgb3B0aW9ucyBnZXQgaGlnaGVyIHNjb3Jlc1xuICAgICAgICBjb25zdCBtaW5WYWx1ZXMgPSBtZXJnZWRDb25maWcubWluVmFsdWVzO1xuICAgICAgICBjb25zdCBtYXhWYWx1ZXMgPSBtZXJnZWRDb25maWcubWF4U2VnbWVudHNQZXJHcm91cDtcbiAgICAgICAgXG4gICAgICAgIGlmIChvcHRpb25Db3VudCA+PSBtaW5WYWx1ZXMgJiYgb3B0aW9uQ291bnQgPD0gbWF4VmFsdWVzKSB7XG4gICAgICAgICAgICAvLyBTY29yZSBpbnZlcnNlbHkgcHJvcG9ydGlvbmFsIHRvIG9wdGlvbiBjb3VudFxuICAgICAgICAgICAgLy8gMiBvcHRpb25zID0gKzQwLCA1IG9wdGlvbnMgPSArMjUsIDEwIG9wdGlvbnMgPSArMTBcbiAgICAgICAgICAgIGNvbnN0IG9wdGlvblNjb3JlID0gTWF0aC5tYXgoMTAsIDQwIC0gKG9wdGlvbkNvdW50IC0gbWluVmFsdWVzKSAqIDMpO1xuICAgICAgICAgICAgc2NvcmUgKz0gb3B0aW9uU2NvcmU7XG4gICAgICAgICAgICByZWFzb25zLnB1c2goYCR7b3B0aW9uQ291bnR9IG9wdGlvbnNgKTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gKipTY29yZSAzOiBCb29sZWFuIGZpZWxkIGdldHMgaGlnaCBwcmlvcml0eSAob25seSAyIG9wdGlvbnMpKipcbiAgICAgICAgaWYgKHByb3AudHlwZSA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgICAgICBzY29yZSArPSA1OyAgLy8gU21hbGwgYm9udXMgc2luY2Ugb3B0aW9uIGNvdW50IGFscmVhZHkgZmFjdG9ycyBpblxuICAgICAgICAgICAgcmVhc29ucy5wdXNoKCdib29sZWFuIGZpZWxkJyk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vICoqU2NvcmUgNDogTmFtZSBwb3NpdGlvbiAoZWFybGllciA9IHNsaWdodGx5IGhpZ2hlciBwcmlvcml0eSkqKlxuICAgICAgICBjb25zdCBmaWVsZEluZGV4ID0gY2FuZGlkYXRlUHJvcGVydGllcy5pbmRleE9mKHByb3ApO1xuICAgICAgICBzY29yZSAtPSBNYXRoLm1pbihmaWVsZEluZGV4LCA1KTsgIC8vIENhcCBwZW5hbHR5IGF0IDVcbiAgICAgICAgXG4gICAgICAgIGNhbmRpZGF0ZXMucHVzaCh7IFxuICAgICAgICAgICAgZmllbGQ6IHByb3AsIFxuICAgICAgICAgICAgc2NvcmUsIFxuICAgICAgICAgICAgcmVhc29uOiByZWFzb25zLmpvaW4oJywgJyksXG4gICAgICAgICAgICBvcHRpb25Db3VudFxuICAgICAgICB9KTtcbiAgICB9XG4gICAgXG4gICAgLy8gU29ydCBieTogMSkgc2NvcmUgKGhpZ2hlc3QgZmlyc3QpLCAyKSBvcHRpb24gY291bnQgKGxvd2VzdCBmaXJzdClcbiAgICBjYW5kaWRhdGVzLnNvcnQoKGEsIGIpID0+IHtcbiAgICAgICAgaWYgKGIuc2NvcmUgIT09IGEuc2NvcmUpIHtcbiAgICAgICAgICAgIHJldHVybiBiLnNjb3JlIC0gYS5zY29yZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gYS5vcHRpb25Db3VudCAtIGIub3B0aW9uQ291bnQ7ICAvLyBQcmVmZXIgZmV3ZXIgb3B0aW9uc1xuICAgIH0pO1xuICAgIFxuICAgIGNvbnN0IHRvcE5SZXN1bHRzID0gY2FuZGlkYXRlcy5zbGljZSgwLCBtZXJnZWRDb25maWcubWF4U2VnbWVudEdyb3Vwcyk7XG4gICAgXG4gICAgaWYgKHRvcE5SZXN1bHRzLmxlbmd0aCA+IDAgJiYgbWVyZ2VkQ29uZmlnLmRlYnVnKSB7XG4gICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW1NlZ21lbnREZXRlY3Rpb25dIFNlbGVjdGVkICR7dG9wTlJlc3VsdHMubGVuZ3RofSBmaWVsZChzKTpgLCB0b3BOUmVzdWx0cy5tYXAoYyA9PiAoe1xuICAgICAgICAgICAgZmllbGQ6IGMuZmllbGQuaWQsXG4gICAgICAgICAgICBzY29yZTogYy5zY29yZSxcbiAgICAgICAgICAgIG9wdGlvbkNvdW50OiBjLm9wdGlvbkNvdW50LFxuICAgICAgICAgICAgcmVhc29uOiBjLnJlYXNvblxuICAgICAgICB9KSkpO1xuICAgIH1cbiAgICBcbiAgICByZXR1cm4gdG9wTlJlc3VsdHM7XG59XG5cbi8qKlxuICogQXV0by1nZW5lcmF0ZSBmaWx0ZXIgc2VnbWVudHMgYmFzZWQgb24gZW50aXR5IGF0dHJpYnV0ZXMgdXNpbmcgc21hcnQgZGV0ZWN0aW9uLlxuICogXG4gKiBBbGdvcml0aG06XG4gKiAxLiBJZiBjdXN0b20gc2VnbWVudHMgcHJvdmlkZWQg4oaSIHVzZSB0aGVtIChoaWdoZXN0IHByaW9yaXR5KVxuICogMi4gSWYgZW50aXR5IHJlcXVpcmVzIG1hbnVhbCBzZWdtZW50cyDihpIgc2tpcCBhdXRvLWdlbmVyYXRpb25cbiAqIDMuIERldGVjdCBiZXN0IGZpZWxkIHVzaW5nIHNjb3JpbmcgYWxnb3JpdGhtXG4gKiA0LiBHZW5lcmF0ZSBzZWdtZW50cyBmcm9tIGRldGVjdGVkIGZpZWxkIHdpdGggc21hcnQgaWNvbnNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdlbmVyYXRlU2VnbWVudHM8UyBleHRlbmRzIEVudGl0eVNjaGVtYTxzdHJpbmcsIHN0cmluZywgc3RyaW5nPj4oXG4gICAgcHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlc01hcDxTPixcbiAgICBlbnRpdHlTZXJ2aWNlPzogQmFzZUVudGl0eVNlcnZpY2U8Uz4sXG4gICAgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyd1aUNvbmZpZ0dlbk9wdGlvbnMnXSxcbiAgICBjdXN0b21TZWdtZW50cz86IFJlYWRvbmx5QXJyYXk8SUZpbHRlclNlZ21lbnQgfCBJRmlsdGVyU2VnbWVudEdyb3VwPiB8IEFycmF5PElGaWx0ZXJTZWdtZW50IHwgSUZpbHRlclNlZ21lbnRHcm91cD5cbik6IFJlYWRvbmx5QXJyYXk8SUZpbHRlclNlZ21lbnQgfCBJRmlsdGVyU2VnbWVudEdyb3VwPiB8IEFycmF5PElGaWx0ZXJTZWdtZW50IHwgSUZpbHRlclNlZ21lbnRHcm91cD4gfCB1bmRlZmluZWQge1xuICAgIC8vIDEuIElmIGN1c3RvbSBzZWdtZW50cyBwcm92aWRlZCwgdXNlIHRob3NlIChoaWdoZXN0IHByaW9yaXR5KVxuICAgIGlmIChjdXN0b21TZWdtZW50cyAmJiBjdXN0b21TZWdtZW50cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHJldHVybiBjdXN0b21TZWdtZW50cztcbiAgICB9XG4gICAgXG4gICAgLy8gR2V0IGNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCBnbG9iYWxTZWdtZW50Q29uZmlnID0gZ2xvYmFsVUlDb25maWdPcHRpb25zPy50YWJsZVVJPy5zZWdtZW50QXV0b0dlbmVyYXRpb247XG4gICAgY29uc3QgZW50aXR5TWV0YWRhdGEgPSBlbnRpdHlTZXJ2aWNlPy5nZXRFbnRpdHlTY2hlbWE/LigpLm1vZGVsPy5tZXRhZGF0YTtcbiAgICBjb25zdCBlbnRpdHlTZWdtZW50Q29uZmlnID0gZW50aXR5TWV0YWRhdGE/LnRhYmxlVUk7XG4gICAgXG4gICAgLy8gMi4gSWYgZW50aXR5IHJlcXVpcmVzIG1hbnVhbCBzZWdtZW50cywgc2tpcCBhdXRvLWdlbmVyYXRpb25cbiAgICBpZiAoZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5yZXF1aXJlTWFudWFsKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIFxuICAgIC8vIDMuIERldGVjdCBiZXN0IHNlZ21lbnQgZmllbGRzIChyZXR1cm5zIGFycmF5IG5vdylcbiAgICBjb25zdCBkZXRlY3RlZEZpZWxkcyA9IGRldGVjdFNlZ21lbnRGaWVsZHMocHJvcGVydGllcywgZ2xvYmFsU2VnbWVudENvbmZpZywgZW50aXR5U2VnbWVudENvbmZpZyk7XG4gICAgXG4gICAgaWYgKGRldGVjdGVkRmllbGRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAvLyBObyBzdWl0YWJsZSBmaWVsZHMgZm91bmRcbiAgICAgICAgaWYgKGdsb2JhbFNlZ21lbnRDb25maWc/LmRlYnVnIHx8IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uZGVidWcpIHtcbiAgICAgICAgICAgIERlZmF1bHRMb2dnZXIuaW5mbyhgW1NlZ21lbnRHZW5lcmF0aW9uXSBObyBzdWl0YWJsZSBmaWVsZHMgZGV0ZWN0ZWQgZm9yIHNlZ21lbnRzYCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgXG4gICAgLy8gR2V0IG1lcmdlZCBjb25maWcgZm9yIHRoaXMgZW50aXR5XG4gICAgY29uc3QgbWVyZ2VkQ29uZmlnOiBSZXF1aXJlZDxJU2VnbWVudEF1dG9HZW5lcmF0aW9uQ29uZmlnPiAmIHsgbWF4U2VnbWVudEdyb3VwczogbnVtYmVyOyBtYXhTZWdtZW50c1Blckdyb3VwOiBudW1iZXIgfSA9IHtcbiAgICAgICAgZW5hYmxlZDogZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5lbmFibGVkID8/IGdsb2JhbFNlZ21lbnRDb25maWc/LmVuYWJsZWQgPz8gdHJ1ZSxcbiAgICAgICAgcHJlZmVycmVkRmllbGRzOiBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LnByZWZlcnJlZEZpZWxkcyB8fCBnbG9iYWxTZWdtZW50Q29uZmlnPy5wcmVmZXJyZWRGaWVsZHMgfHwgWydzdGF0dXMnLCAnc3RhdGUnLCAndHlwZScsICdjYXRlZ29yeScsICdwcmlvcml0eSddLFxuICAgICAgICBtYXhTZWdtZW50R3JvdXBzOiBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/Lm1heFNlZ21lbnRHcm91cHMgPz8gZ2xvYmFsU2VnbWVudENvbmZpZz8ubWF4U2VnbWVudEdyb3VwcyA/PyAyLFxuICAgICAgICBtYXhTZWdtZW50c1Blckdyb3VwOiBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/Lm1heFNlZ21lbnRzUGVyR3JvdXAgPz8gZ2xvYmFsU2VnbWVudENvbmZpZz8ubWF4U2VnbWVudHNQZXJHcm91cCA/PyAxMCxcbiAgICAgICAgbWluVmFsdWVzOiBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/Lm1pblZhbHVlcyA/PyBnbG9iYWxTZWdtZW50Q29uZmlnPy5taW5WYWx1ZXMgPz8gMixcbiAgICAgICAgaWNvbk1hcHBpbmc6IHtcbiAgICAgICAgICAgIC4uLkRFRkFVTFRfSUNPTl9NQVBQSU5HLFxuICAgICAgICAgICAgLi4uZ2xvYmFsU2VnbWVudENvbmZpZz8uaWNvbk1hcHBpbmcsXG4gICAgICAgICAgICAuLi5lbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/Lmljb25NYXBwaW5nXG4gICAgICAgIH0sXG4gICAgICAgIGJvb2xlYW5MYWJlbFBhdHRlcm5zOiBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmJvb2xlYW5MYWJlbFBhdHRlcm5zIHx8IGdsb2JhbFNlZ21lbnRDb25maWc/LmJvb2xlYW5MYWJlbFBhdHRlcm5zIHx8IFtdLFxuICAgICAgICBkZWZhdWx0Qm9vbGVhbkxhYmVsczogZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5kZWZhdWx0Qm9vbGVhbkxhYmVscyB8fCBnbG9iYWxTZWdtZW50Q29uZmlnPy5kZWZhdWx0Qm9vbGVhbkxhYmVscyB8fCB7IHRydWU6ICdZZXMnLCBmYWxzZTogJ05vJyB9LFxuICAgICAgICBpbmNsdWRlQWxsU2VnbWVudDogZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5pbmNsdWRlQWxsU2VnbWVudCA/PyBnbG9iYWxTZWdtZW50Q29uZmlnPy5pbmNsdWRlQWxsU2VnbWVudCA/PyB0cnVlLFxuICAgICAgICBkZWJ1ZzogZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5kZWJ1ZyA/PyBnbG9iYWxTZWdtZW50Q29uZmlnPy5kZWJ1ZyA/PyBmYWxzZVxuICAgIH07XG4gICAgXG4gICAgaWYgKG1lcmdlZENvbmZpZy5kZWJ1Zykge1xuICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtTZWdtZW50R2VuZXJhdGlvbl0gR2VuZXJhdGluZyBzZWdtZW50cyBmb3IgJHtkZXRlY3RlZEZpZWxkcy5sZW5ndGh9IGZpZWxkKHMpOmAsIGRldGVjdGVkRmllbGRzLm1hcChkID0+IGQuZmllbGQuaWQpKTtcbiAgICB9XG4gICAgXG4gICAgLy8gNC4gR2VuZXJhdGUgc2VnbWVudCBncm91cHMgKG9uZSBwZXIgZGV0ZWN0ZWQgZmllbGQpXG4gICAgY29uc3Qgc2VnbWVudEdyb3VwczogQXJyYXk8SUZpbHRlclNlZ21lbnRHcm91cD4gPSBbXTtcbiAgICBcbiAgICBmb3IgKGNvbnN0IGRldGVjdGlvbiBvZiBkZXRlY3RlZEZpZWxkcykge1xuICAgICAgICBjb25zdCB7IGZpZWxkIH0gPSBkZXRlY3Rpb247XG4gICAgICAgIFxuICAgICAgICAvLyBHZW5lcmF0ZSBzZWdtZW50cyBmb3IgdGhpcyBmaWVsZFxuICAgICAgICBjb25zdCBzZWdtZW50czogQXJyYXk8SUZpbHRlclNlZ21lbnQ+ID0gW107XG4gICAgICAgIFxuICAgICAgICAvLyBBZGQgXCJBbGxcIiBzZWdtZW50IGlmIGVuYWJsZWRcbiAgICAgICAgaWYgKG1lcmdlZENvbmZpZy5pbmNsdWRlQWxsU2VnbWVudCkge1xuICAgICAgICAgICAgc2VnbWVudHMucHVzaCh7XG4gICAgICAgICAgICAgICAgaWQ6IGBhbGwtJHtmaWVsZC5pZH1gLFxuICAgICAgICAgICAgICAgIGxhYmVsOiAnQWxsJyxcbiAgICAgICAgICAgICAgICBmaWx0ZXJzOiB7fSxcbiAgICAgICAgICAgICAgICBkZWZhdWx0OiB0cnVlXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gR2V0IHZhbHVlcyBmcm9tIGZpZWxkXG4gICAgICAgIGxldCB2YWx1ZXM6IChzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuKVtdID0gW107XG4gICAgICAgIGxldCB2YWx1ZUxhYmVsczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9OyAgLy8gRm9yIGN1c3RvbSBib29sZWFuIGxhYmVsc1xuICAgICAgICBcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZmllbGQudHlwZSkpIHtcbiAgICAgICAgICAgIC8vIEVudW0gdHlwZSBhcnJheVxuICAgICAgICAgICAgdmFsdWVzID0gZmllbGQudHlwZTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZC50eXBlID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgICAgIC8vIEJvb2xlYW4gZmllbGQgd2l0aCBvcHRpb25hbCBjdXN0b20gbGFiZWxzXG4gICAgICAgICAgICB2YWx1ZXMgPSBbdHJ1ZSwgZmFsc2VdO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyAxLiBDaGVjayBmb3IgZXhwbGljaXQgZmllbGQtbGV2ZWwgYm9vbGVhbkxhYmVsc1xuICAgICAgICAgICAgY29uc3QgZmllbGRCb29sZWFuTGFiZWxzID0gJ2Jvb2xlYW5MYWJlbHMnIGluIGZpZWxkID8gZmllbGQuYm9vbGVhbkxhYmVscyA6IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIGlmIChmaWVsZEJvb2xlYW5MYWJlbHMgJiYgdHlwZW9mIGZpZWxkQm9vbGVhbkxhYmVscyA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgICAgICB2YWx1ZUxhYmVsc1sndHJ1ZSddID0gZmllbGRCb29sZWFuTGFiZWxzLnRydWUgfHwgJ1llcyc7XG4gICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbJ2ZhbHNlJ10gPSBmaWVsZEJvb2xlYW5MYWJlbHMuZmFsc2UgfHwgJ05vJztcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gMi4gVHJ5IGludGVsbGlnZW50IGV4dHJhY3Rpb24gZnJvbSBmaWVsZCBuYW1lXG4gICAgICAgICAgICAgICAgY29uc3QgZmllbGROYW1lID0gZmllbGQuaWQ7XG4gICAgICAgICAgICAgICAgY29uc3QgZXh0cmFjdGVkID0gZXh0cmFjdEJvb2xlYW5MYWJlbHNGcm9tRmllbGROYW1lKGZpZWxkTmFtZSk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKGV4dHJhY3RlZCkge1xuICAgICAgICAgICAgICAgICAgICB2YWx1ZUxhYmVsc1sndHJ1ZSddID0gZXh0cmFjdGVkLnRydWVMYWJlbDtcbiAgICAgICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbJ2ZhbHNlJ10gPSBleHRyYWN0ZWQuZmFsc2VMYWJlbDtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAvLyAzLiBUcnkgdG8gbWF0Y2ggYWdhaW5zdCBjb25maWd1cmVkIHBhdHRlcm5zXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhdHRlcm5zID0gbWVyZ2VkQ29uZmlnLmJvb2xlYW5MYWJlbFBhdHRlcm5zO1xuICAgICAgICAgICAgICAgICAgICBsZXQgbWF0Y2hlZCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgaWYgKHBhdHRlcm5zICYmIHBhdHRlcm5zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgcGF0dGVybiBvZiBwYXR0ZXJucykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlZ2V4ID0gcGF0dGVybi5wYXR0ZXJuIGluc3RhbmNlb2YgUmVnRXhwIFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IHBhdHRlcm4ucGF0dGVybiBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgOiBuZXcgUmVnRXhwKHBhdHRlcm4ucGF0dGVybiwgJ2knKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAocmVnZXgudGVzdChmaWVsZE5hbWUpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlTGFiZWxzWyd0cnVlJ10gPSBwYXR0ZXJuLnRydWVMYWJlbDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbJ2ZhbHNlJ10gPSBwYXR0ZXJuLmZhbHNlTGFiZWw7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hdGNoZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgIC8vIDQuIFVzZSBkZWZhdWx0IGZhbGxiYWNrIGlmIG5vIHBhdHRlcm4gbWF0Y2hlZFxuICAgICAgICAgICAgICAgICAgICBpZiAoIW1hdGNoZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRzID0gbWVyZ2VkQ29uZmlnLmRlZmF1bHRCb29sZWFuTGFiZWxzIHx8IHsgdHJ1ZTogJ1llcycsIGZhbHNlOiAnTm8nIH07XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWx1ZUxhYmVsc1sndHJ1ZSddID0gZGVmYXVsdHMudHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlTGFiZWxzWydmYWxzZSddID0gZGVmYXVsdHMuZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoKGZpZWxkLmZpZWxkVHlwZSA9PT0gJ3NlbGVjdCcgfHwgZmllbGQuZmllbGRUeXBlID09PSAncmFkaW8nIHx8IGZpZWxkLmZpZWxkVHlwZSA9PT0gJ2NoZWNrYm94JyB8fCBmaWVsZC5maWVsZFR5cGUgPT09ICdtdWx0aS1zZWxlY3QnKSAmJiBBcnJheS5pc0FycmF5KChmaWVsZCBhcyBhbnkpLm9wdGlvbnMpKSB7XG4gICAgICAgICAgICAvLyBTZWxlY3QvcmFkaW8vY2hlY2tib3ggZmllbGQgd2l0aCBpbmxpbmUgb3B0aW9uc1xuICAgICAgICAgICAgY29uc3Qgb3B0aW9ucyA9IChmaWVsZCBhcyBhbnkpLm9wdGlvbnMgYXMgQXJyYXk8eyBsYWJlbDogc3RyaW5nOyB2YWx1ZTogc3RyaW5nIH0+O1xuICAgICAgICAgICAgdmFsdWVzID0gb3B0aW9ucy5tYXAob3B0ID0+IG9wdC52YWx1ZSk7XG4gICAgICAgICAgICAvLyBTdG9yZSBsYWJlbHMgZm9yIGxhdGVyIHVzZVxuICAgICAgICAgICAgb3B0aW9ucy5mb3JFYWNoKG9wdCA9PiB7XG4gICAgICAgICAgICAgICAgdmFsdWVMYWJlbHNbU3RyaW5nKG9wdC52YWx1ZSldID0gb3B0LmxhYmVsO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIEFwcGx5IGZpZWxkLXNwZWNpZmljIHZhbHVlIGZpbHRlcnMgZmlyc3QsIHRoZW4gZ2xvYmFsXG4gICAgICAgIGNvbnN0IGluY2x1ZGVWYWx1ZXNCeUZpZWxkID0gZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5pbmNsdWRlVmFsdWVzQnlGaWVsZDtcbiAgICAgICAgY29uc3QgaW5jbHVkZVZhbHVlcyA9IGluY2x1ZGVWYWx1ZXNCeUZpZWxkPy5bZmllbGQuaWRdIHx8IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uaW5jbHVkZVZhbHVlcztcbiAgICAgICAgaWYgKGluY2x1ZGVWYWx1ZXMpIHtcbiAgICAgICAgICAgIHZhbHVlcyA9IHZhbHVlcy5maWx0ZXIodiA9PiBpbmNsdWRlVmFsdWVzLmluY2x1ZGVzKFN0cmluZyh2KSkpO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBjb25zdCBleGNsdWRlVmFsdWVzQnlGaWVsZCA9IGVudGl0eVNlZ21lbnRDb25maWc/LnNlZ21lbnRBdXRvR2VuZXJhdGlvbj8uZXhjbHVkZVZhbHVlc0J5RmllbGQ7XG4gICAgICAgIGNvbnN0IGV4Y2x1ZGVWYWx1ZXMgPSBleGNsdWRlVmFsdWVzQnlGaWVsZD8uW2ZpZWxkLmlkXSB8fCBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LmV4Y2x1ZGVWYWx1ZXM7XG4gICAgICAgIGlmIChleGNsdWRlVmFsdWVzKSB7XG4gICAgICAgICAgICB2YWx1ZXMgPSB2YWx1ZXMuZmlsdGVyKHYgPT4gIWV4Y2x1ZGVWYWx1ZXMuaW5jbHVkZXMoU3RyaW5nKHYpKSk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIEFwcGx5IGZpZWxkLXNwZWNpZmljIHNvcnQgb3JkZXIgZmlyc3QsIHRoZW4gZ2xvYmFsXG4gICAgICAgIGNvbnN0IHNvcnRPcmRlckJ5RmllbGQgPSBlbnRpdHlTZWdtZW50Q29uZmlnPy5zZWdtZW50QXV0b0dlbmVyYXRpb24/LnNvcnRPcmRlckJ5RmllbGQ7XG4gICAgICAgIGNvbnN0IHNvcnRPcmRlciA9IHNvcnRPcmRlckJ5RmllbGQ/LltmaWVsZC5pZF0gfHwgZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5zb3J0T3JkZXI7XG4gICAgICAgIGlmIChzb3J0T3JkZXIpIHtcbiAgICAgICAgICAgIHZhbHVlcy5zb3J0KChhLCBiKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgYUluZGV4ID0gc29ydE9yZGVyLmluZGV4T2YoU3RyaW5nKGEpKTtcbiAgICAgICAgICAgICAgICBjb25zdCBiSW5kZXggPSBzb3J0T3JkZXIuaW5kZXhPZihTdHJpbmcoYikpO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIElmIGJvdGggaW4gc29ydE9yZGVyLCB1c2UgdGhhdCBvcmRlclxuICAgICAgICAgICAgICAgIGlmIChhSW5kZXggPj0gMCAmJiBiSW5kZXggPj0gMCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gYUluZGV4IC0gYkluZGV4O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAvLyBJZiBvbmx5IG9uZSBpbiBzb3J0T3JkZXIsIGl0IGNvbWVzIGZpcnN0XG4gICAgICAgICAgICAgICAgaWYgKGFJbmRleCA+PSAwKSByZXR1cm4gLTE7XG4gICAgICAgICAgICAgICAgaWYgKGJJbmRleCA+PSAwKSByZXR1cm4gMTtcbiAgICAgICAgICAgICAgICAvLyBOZWl0aGVyIGluIHNvcnRPcmRlciwgbWFpbnRhaW4gb3JpZ2luYWwgb3JkZXJcbiAgICAgICAgICAgICAgICByZXR1cm4gMDtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBHZW5lcmF0ZSBzZWdtZW50IGZvciBlYWNoIHZhbHVlXG4gICAgICAgIGZvciAoY29uc3QgdmFsdWUgb2YgdmFsdWVzKSB7XG4gICAgICAgICAgICBjb25zdCB2YWx1ZVN0ciA9IFN0cmluZyh2YWx1ZSk7XG4gICAgICAgICAgICBjb25zdCB2YWx1ZUxvd2VyID0gdmFsdWVTdHIudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gVXNlIGN1c3RvbSBsYWJlbCBpZiBhdmFpbGFibGUsIG90aGVyd2lzZSBmb3JtYXQgdGhlIHZhbHVlXG4gICAgICAgICAgICBjb25zdCBzZWdtZW50TGFiZWwgPSB2YWx1ZUxhYmVsc1t2YWx1ZVN0cl0gfHwgcGFzY2FsQ2FzZSh2YWx1ZVN0cik7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHNlZ21lbnRzLnB1c2goe1xuICAgICAgICAgICAgICAgIGlkOiBgJHtmaWVsZC5pZH0tJHt2YWx1ZUxvd2VyLnJlcGxhY2UoL1teYS16MC05XSsvZywgJy0nKX1gLCAgLy8gVW5pcXVlIElEXG4gICAgICAgICAgICAgICAgbGFiZWw6IHNlZ21lbnRMYWJlbCwgIC8vIEN1c3RvbSBvciBmb3JtYXR0ZWQgbGFiZWxcbiAgICAgICAgICAgICAgICBpY29uOiBtZXJnZWRDb25maWcuaWNvbk1hcHBpbmdbdmFsdWVMb3dlcl0sICAvLyBTbWFydCBpY29uIGxvb2t1cFxuICAgICAgICAgICAgICAgIGZpbHRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgW2ZpZWxkLmlkXTogeyBlcTogdmFsdWUgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBPbmx5IGFkZCBncm91cCBpZiB3ZSBoYXZlIHNlZ21lbnRzXG4gICAgICAgIGNvbnN0IG1pblNlZ21lbnRzID0gbWVyZ2VkQ29uZmlnLmluY2x1ZGVBbGxTZWdtZW50ID8gMSA6IDA7XG4gICAgICAgIGlmIChzZWdtZW50cy5sZW5ndGggPiBtaW5TZWdtZW50cykge1xuICAgICAgICAgICAgLy8gQXV0by1nZW5lcmF0ZSBsYWJlbCBvciB1c2UgZXhwbGljaXQgZ3JvdXBMYWJlbHNcbiAgICAgICAgICAgIGNvbnN0IGN1c3RvbUdyb3VwTGFiZWxzID0gZW50aXR5U2VnbWVudENvbmZpZz8uc2VnbWVudEF1dG9HZW5lcmF0aW9uPy5ncm91cExhYmVscztcbiAgICAgICAgICAgIGNvbnN0IGxhYmVsID0gY3VzdG9tR3JvdXBMYWJlbHM/LltmaWVsZC5pZF0gfHwgYEJ5ICR7cGFzY2FsQ2FzZShmaWVsZC5pZCl9YDtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgc2VnbWVudEdyb3Vwcy5wdXNoKHtcbiAgICAgICAgICAgICAgICBpZDogYCR7ZmllbGQuaWR9LWdyb3VwYCxcbiAgICAgICAgICAgICAgICBsYWJlbCxcbiAgICAgICAgICAgICAgICBzZWdtZW50cyxcbiAgICAgICAgICAgICAgICBkZWZhdWx0U2VnbWVudElkOiBzZWdtZW50cy5maW5kKHMgPT4gcy5kZWZhdWx0KT8uaWQsXG4gICAgICAgICAgICAgICAgbWF4VmlzaWJsZTogbWVyZ2VkQ29uZmlnLm1heFNlZ21lbnRzUGVyR3JvdXBcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8vIFJldHVybiBzZWdtZW50IGdyb3VwcyAob3IgdW5kZWZpbmVkIGlmIG5vbmUgZ2VuZXJhdGVkKVxuICAgIGlmIChzZWdtZW50R3JvdXBzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBcbiAgICAvLyBJZiBvbmx5IDEgZ3JvdXAgd2l0aCBzaW1wbGUgY29uZmlnLCByZXR1cm4gZmxhdCBzZWdtZW50cyBmb3IgYmFja3dhcmRzIGNvbXBhdGliaWxpdHlcbiAgICAvLyBUaGlzIG1haW50YWlucyBsZWdhY3kgYmVoYXZpb3Igd2hlbiBtYXhTZWdtZW50R3JvdXBzID0gMVxuICAgIGlmIChzZWdtZW50R3JvdXBzLmxlbmd0aCA9PT0gMSAmJiBtZXJnZWRDb25maWcubWF4U2VnbWVudEdyb3VwcyA9PT0gMSkge1xuICAgICAgICByZXR1cm4gc2VnbWVudEdyb3Vwc1swXS5zZWdtZW50cztcbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIHNlZ21lbnRHcm91cHM7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRU5USVRZIEFUVFJJQlVURSBGT1JNQVRUSU5HXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbChcbiAgICB0aGlzUHJvcDogVElPU2NoZW1hQXR0cmlidXRlLFxuICAgIHR5cGU6ICdjcmVhdGUnIHwgJ3VwZGF0ZScgfCAnZGV0YWlsJyxcbiAgICBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+LFxuICAgIGFsbFByb3BlcnRpZXM/OiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSwgIC8vIE9wdGlvbmFsOiBmb3IgZGV0ZWN0aW5nIGR1cGxpY2F0ZWQgcmVsYXRpb24gZmllbGRzXG4gICAgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyd1aUNvbmZpZ0dlbk9wdGlvbnMnXSAgLy8gT3B0aW9uYWw6IGdsb2JhbCBVSSBjb25maWcgb3B0aW9uc1xuKSB7XG4gICAgY29uc3QgZm9ybWF0dGVkOiBhbnkgPSB7XG4gICAgICAgIC4uLnRoaXNQcm9wLFxuICAgICAgICBsYWJlbDogdGhpc1Byb3AubmFtZSwgIC8vIFJlc3BlY3QgY3VzdG9tIGxhYmVsIGZyb20gZW50aXR5IGF0dHJpYnV0ZVxuICAgICAgICBjb2x1bW46IHRoaXNQcm9wLmlkLFxuICAgICAgICBmaWVsZFR5cGU6IHRoaXNQcm9wLmZpZWxkVHlwZSB8fCAndGV4dCcsICAvLyBmaWVsZFR5cGUgc2hvdWxkIGFscmVhZHkgYmUgaW5mZXJyZWQgaW4gYmFzZS1zZXJ2aWNlXG4gICAgICAgIGhpZGRlbjogdGhpc1Byb3AuaGFzT3duUHJvcGVydHkoJ2lzVmlzaWJsZScpICYmICF0aGlzUHJvcC5pc1Zpc2libGVcbiAgICB9O1xuXG4gICAgLy8gSGFuZGxlIGFkZE5ld09wdGlvbiAoT0xEIC0gZGVwcmVjYXRlZCwgZ2VuZXJhdGVzIGVtYmVkZGVkIGNvbmZpZykgb3IgYWRkTmV3T3B0aW9uQ29uZmlnIChORVcgLSBqdXN0IHBhc3MgdGhyb3VnaCByZWZlcmVuY2UpXG4gICAgaWYgKGlzU2VsZWN0RmllbGRNZXRhZGF0YSh0aGlzUHJvcCkgJiYgWyAnY3JlYXRlJywgJ3VwZGF0ZScgXS5pbmNsdWRlcyh0eXBlKSkge1xuICAgICAgICBjb25zdCBzZWxlY3RGaWVsZCA9IHRoaXNQcm9wIGFzIFNlbGVjdEZpZWxkTWV0YWRhdGE7XG4gICAgICAgIFxuICAgICAgICBpZiAoc2VsZWN0RmllbGQuYWRkTmV3T3B0aW9uQ29uZmlnKSB7XG4gICAgICAgICAgICAvLyBORVcgV0FZOiBVc2VyIHByb3ZpZGVkIGFkZE5ld09wdGlvbkNvbmZpZyByZWZlcmVuY2UgLSBqdXN0IHBhc3MgaXQgdGhyb3VnaFxuICAgICAgICAgICAgZm9ybWF0dGVkWyAnYWRkTmV3T3B0aW9uQ29uZmlnJyBdID0gc2VsZWN0RmllbGQuYWRkTmV3T3B0aW9uQ29uZmlnO1xuICAgICAgICAgICAgXG4gICAgICAgIH0gZWxzZSBpZiAoc2VsZWN0RmllbGQuYWRkTmV3T3B0aW9uKSB7XG4gICAgICAgICAgICAvLyBPTEQgV0FZIChERVBSRUNBVEVEKTogVHJhbnNmb3JtIGFkZE5ld09wdGlvbiB0byBhZGROZXdPcHRpb25Db25maWcgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICAgICAgICAgIGNvbnN0IHsgZW50aXR5TmFtZSwgb3ZlcnJpZGVDb25maWcgfSA9IHNlbGVjdEZpZWxkLmFkZE5ld09wdGlvbjtcblxuICAgICAgICAgICAgaWYgKGVudGl0eU5hbWUgJiYgZW50aXR5U2VydmljZS5oYXNFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKGVudGl0eU5hbWUpKSB7XG4gICAgICAgICAgICAgICAgZm9ybWF0dGVkWyAnYWRkTmV3T3B0aW9uQ29uZmlnJyBdID0ge1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2NyZWF0ZScsXG4gICAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiBvdmVycmlkZUNvbmZpZyB8fCB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdWJtaXRTdWNjZXNzUmVkaXJlY3Q6IHVuZGVmaW5lZCwgIC8vIFN0YXkgaW4gbW9kYWwgYWZ0ZXIgY3JlYXRpb25cbiAgICAgICAgICAgICAgICAgICAgICAgIGZvcm1CdXR0b25zOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgeyB0ZXh0OiBcIkFkZFwiLCBhY3Rpb246IFwic3VibWl0XCIgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7IHRleHQ6IFwiQ2FuY2VsXCIsIGFjdGlvbjogXCJjYW5jZWxcIiB9XG4gICAgICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbDogQ291bGQgbm90IGZpbmQgcmVsYXRlZC1lbnRpdHktc2VydmljZSBmb3IgZW50aXR5IFske2VudGl0eU5hbWV9XSBpbiAke2VudGl0eVNlcnZpY2UuY29uc3RydWN0b3IubmFtZX1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIEhhbmRsZSByZWxhdGlvbiBmaWVsZHMgKERBVEEgTEFZRVIgKyBVSSBMQVlFUilcbiAgICBpZiAodGhpc1Byb3AucmVsYXRpb24gJiYgdHlwZSA9PT0gJ2RldGFpbCcpIHtcbiAgICAgICAgY29uc3QgcmVsYXRpb24gPSB0aGlzUHJvcC5yZWxhdGlvbjtcbiAgICAgICAgY29uc3QgeyBlbnRpdHlOYW1lLCB0eXBlOiByZWxhdGlvblR5cGUsIGlkZW50aWZpZXJzIH0gPSByZWxhdGlvbjtcbiAgICAgICAgY29uc3QgZW50aXR5TmFtZUxvd2VyID0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpO1xuXG4gICAgICAgIGlmICghZW50aXR5U2VydmljZS5oYXNFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKGVudGl0eU5hbWUpKSB7XG4gICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbDogQ291bGQgbm90IGZpbmQgcmVsYXRlZC1lbnRpdHktc2VydmljZSBmb3IgZW50aXR5IFske2VudGl0eU5hbWV9XSBpbiAke2VudGl0eVNlcnZpY2UuY29uc3RydWN0b3IubmFtZX1gKTtcbiAgICAgICAgICAgIHJldHVybiBmb3JtYXR0ZWQ7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZXNvbHZlIGlkZW50aWZpZXJzIChjb3VsZCBiZSBkaXJlY3QgdmFsdWUgb3IgbGF6eSBmdW5jdGlvbilcbiAgICAgICAgY29uc3QgcmVzb2x2ZWRJZGVudGlmaWVycyA9IHR5cGVvZiBpZGVudGlmaWVycyA9PT0gJ2Z1bmN0aW9uJyA/IGlkZW50aWZpZXJzKCkgOiBpZGVudGlmaWVycztcblxuICAgICAgICAvLyBTYWZldHkgY2hlY2sgZm9yIGFycmF5IGlkZW50aWZpZXJzXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHJlc29sdmVkSWRlbnRpZmllcnMpKSB7XG4gICAgICAgICAgICBpZiAocmVzb2x2ZWRJZGVudGlmaWVycy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbDogRW1wdHkgaWRlbnRpZmllcnMgYXJyYXkgZm9yIHJlbGF0aW9uIFske2VudGl0eU5hbWV9XWApO1xuICAgICAgICAgICAgICAgIHJldHVybiBmb3JtYXR0ZWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBIYW5kbGUgYm90aCBzaW5nbGUgYW5kIG11bHRpcGxlIGlkZW50aWZpZXJzIGZvciBjb21wb3NpdGUga2V5c1xuICAgICAgICBjb25zdCBpZGVudGlmaWVyTWFwcGluZ3MgPSBBcnJheS5pc0FycmF5KHJlc29sdmVkSWRlbnRpZmllcnMpIFxuICAgICAgICAgICAgPyByZXNvbHZlZElkZW50aWZpZXJzLm1hcChpZCA9PiAoe1xuICAgICAgICAgICAgICAgIHNvdXJjZTogU3RyaW5nKGlkLnNvdXJjZSksXG4gICAgICAgICAgICAgICAgdGFyZ2V0OiBTdHJpbmcoaWQudGFyZ2V0KVxuICAgICAgICAgICAgICB9KSlcbiAgICAgICAgICAgIDogW3tcbiAgICAgICAgICAgICAgICBzb3VyY2U6IFN0cmluZyhyZXNvbHZlZElkZW50aWZpZXJzLnNvdXJjZSksXG4gICAgICAgICAgICAgICAgdGFyZ2V0OiBTdHJpbmcocmVzb2x2ZWRJZGVudGlmaWVycy50YXJnZXQpXG4gICAgICAgICAgICAgIH1dO1xuXG4gICAgICAgIC8vIEZvciByb3V0ZSBwYXR0ZXJuIGFuZCBkZWZhdWx0IGZpbHRlcnMsIHVzZSB0aGUgZmlyc3QgaWRlbnRpZmllclxuICAgICAgICAvLyAobW9zdCBlbnRpdGllcyBoYXZlIHNpbmdsZSBpZGVudGlmaWVyOyBjb21wb3NpdGUga2V5cyBuZWVkIGV4cGxpY2l0IHJvdXRlUGF0dGVybilcbiAgICAgICAgY29uc3QgcHJpbWFyeUlkZW50aWZpZXIgPSBpZGVudGlmaWVyTWFwcGluZ3NbMF07XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgdXNlciBwcm92aWRlZCBjdXN0b20gVUkgY29uZmlnIGluIHJlbGF0aW9uQ29uZmlnIChvcHRpb25hbCBvdmVycmlkZSlcbiAgICAgICAgY29uc3QgdXNlclJlbGF0aW9uQ29uZmlnID0gdGhpc1Byb3AucmVsYXRpb25Db25maWcgYXMgSVJlbGF0aW9uRmllbGRDb25maWcgfCB1bmRlZmluZWQ7XG5cbiAgICAgICAgLy8gR2V0IHJlbGF0ZWQgZW50aXR5IHNlcnZpY2UgZm9yIG1ldGFkYXRhIChpY29uLCBldGMuKVxuICAgICAgICBjb25zdCByZWxhdGVkRW50aXR5U2VydmljZSA9IGVudGl0eVNlcnZpY2UuaGFzRW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShlbnRpdHlOYW1lKSBcbiAgICAgICAgICAgID8gZW50aXR5U2VydmljZS5nZXRFbnRpdHlTZXJ2aWNlQnlFbnRpdHlOYW1lKGVudGl0eU5hbWUpXG4gICAgICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICAgICAgXG4gICAgICAgIC8vIEdldCBlbnRpdHkgbWV0YWRhdGEgZm9yIGljb24gYW5kIGZhbGxiYWNrIGdlbmVyYXRpb25cbiAgICAgICAgY29uc3QgcmVsYXRlZEVudGl0eU1ldGFkYXRhID0gcmVsYXRlZEVudGl0eVNlcnZpY2U/LmdldEVudGl0eVNjaGVtYT8uKCkubW9kZWw7XG4gICAgICAgIGNvbnN0IGRlZmF1bHRJY29uID0gcmVsYXRlZEVudGl0eU1ldGFkYXRhPy5tZXRhZGF0YT8uaWNvbjtcblxuICAgICAgICBpZiAocmVsYXRpb25UeXBlLmVuZHNXaXRoKCd0by1vbmUnKSkge1xuICAgICAgICAgICAgLy8gVE8tT05FOiBTaG93IHZhbHVlIGFzIGxpbmsgKyBtb2RhbCBpY29uXG4gICAgICAgICAgICAvLyBSb3V0ZSBwYXR0ZXJuOiBVc2UgY3VzdG9tIChmcm9tIHJlbGF0aW9uQ29uZmlnKSBvciBkZWZhdWx0IHRvIC92aWV3LXtlbnRpdHl9Lzp0YXJnZXRJZFxuICAgICAgICAgICAgY29uc3Qgcm91dGVQYXR0ZXJuID0gdXNlclJlbGF0aW9uQ29uZmlnPy5yb3V0ZVBhdHRlcm4gXG4gICAgICAgICAgICAgICAgfHwgYC92aWV3LSR7ZW50aXR5TmFtZUxvd2VyfS86JHtwcmltYXJ5SWRlbnRpZmllci50YXJnZXR9YDtcblxuICAgICAgICAgICAgLy8gR2VuZXJhdGUgZmFsbGJhY2sgY29uZmlndXJhdGlvbiBmb3Igd2hlbiBvbmx5IElEIGlzIGF2YWlsYWJsZVxuICAgICAgICAgICAgY29uc3QgZmFsbGJhY2tDb25maWcgPSBnZW5lcmF0ZVJlbGF0aW9uRmFsbGJhY2soXG4gICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICBwcmltYXJ5SWRlbnRpZmllci5zb3VyY2UsXG4gICAgICAgICAgICAgICAgcmVsYXRlZEVudGl0eVNlcnZpY2VcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIC8vIEF1dG8tZGV0ZWN0IGR1cGxpY2F0ZWQgcmVsYXRpb24gZmllbGQgKGUuZy4sIHRlYW1OYW1lIGZvciB0ZWFtSWQpXG4gICAgICAgICAgICAvLyBORVc6IFVzZSBlbmhhbmNlZCBkZXRlY3Rpb24gd2l0aCBjb25maWcgc3VwcG9ydFxuICAgICAgICAgICAgbGV0IGF1dG9UZW1wbGF0ZTogc3RyaW5nIHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgbGV0IGRldGVjdGlvbk1ldGFkYXRhOiBhbnkgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIENoZWNrIGlmIGF1dG8tZGV0ZWN0aW9uIGlzIGVuYWJsZWQgKGRlZmF1bHQ6IHRydWUpXG4gICAgICAgICAgICBjb25zdCBhdXRvRGV0ZWN0RW5hYmxlZCA9IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uYXV0b0RldGVjdCAhPT0gZmFsc2U7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmIChhdXRvRGV0ZWN0RW5hYmxlZCAmJiBhbGxQcm9wZXJ0aWVzKSB7XG4gICAgICAgICAgICAgICAgLy8gR2V0IGdsb2JhbCBjb25maWcgKHBhc3NlZCBmcm9tIGZ3MjQgaW5pdGlhbGl6YXRpb24pXG4gICAgICAgICAgICAgICAgY29uc3QgZ2xvYmFsQ29uZmlnID0gZ2xvYmFsVUlDb25maWdPcHRpb25zPy5kdXBsaWNhdGVkRmllbGREZXRlY3Rpb247XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gR2V0IGVudGl0eS1sZXZlbCBjb25maWcgZnJvbSBlbnRpdHkgbWV0YWRhdGFcbiAgICAgICAgICAgICAgICBjb25zdCBlbnRpdHlDb25maWcgPSByZWxhdGVkRW50aXR5TWV0YWRhdGE/Lm1ldGFkYXRhPy5kdXBsaWNhdGVkRmllbGREZXRlY3Rpb247XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gR2V0IHJlbGF0aW9uLWxldmVsIGhpbnRzXG4gICAgICAgICAgICAgICAgY29uc3QgcmVsYXRpb25IaW50cyA9IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uYXV0b0RldGVjdEhpbnRzO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIFJ1biBlbmhhbmNlZCBkZXRlY3Rpb25cbiAgICAgICAgICAgICAgICBjb25zdCBkZXRlY3Rpb25SZXN1bHQgPSBkZXRlY3REdXBsaWNhdGVkUmVsYXRpb25GaWVsZHMoXG4gICAgICAgICAgICAgICAgICAgIGFsbFByb3BlcnRpZXMsXG4gICAgICAgICAgICAgICAgICAgIHRoaXNQcm9wLmlkLFxuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBnbG9iYWxDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIGVudGl0eUNvbmZpZyxcbiAgICAgICAgICAgICAgICAgICAgcmVsYXRpb25IaW50c1xuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgaWYgKGRldGVjdGlvblJlc3VsdCkge1xuICAgICAgICAgICAgICAgICAgICBhdXRvVGVtcGxhdGUgPSBkZXRlY3Rpb25SZXN1bHQudGVtcGxhdGU7XG4gICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAvLyBTdG9yZSBtZXRhZGF0YSBmb3IgZGVidWdnaW5nIGFuZCBmdXR1cmUgZmVhdHVyZXNcbiAgICAgICAgICAgICAgICAgICAgZGV0ZWN0aW9uTWV0YWRhdGEgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZXRlY3RlZEZpZWxkczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByaW1hcnk6IGRldGVjdGlvblJlc3VsdC5wcmltYXJ5RmllbGQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWx0ZXJuYXRpdmVzOiBkZXRlY3Rpb25SZXN1bHQuZGV0ZWN0ZWRGaWVsZHMuZGlzcGxheT8uc2xpY2UoMSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlzdWFsOiBkZXRlY3Rpb25SZXN1bHQuZGV0ZWN0ZWRGaWVsZHMudmlzdWFsLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1ldGE6IGRldGVjdGlvblJlc3VsdC5kZXRlY3RlZEZpZWxkcy5tZXRhXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgY29uZmlkZW5jZTogZGV0ZWN0aW9uUmVzdWx0LmNvbmZpZGVuY2UsXG4gICAgICAgICAgICAgICAgICAgICAgICBtZXRob2Q6IGRldGVjdGlvblJlc3VsdC5tZXRob2QsXG4gICAgICAgICAgICAgICAgICAgICAgICBwYXR0ZXJuOiBkZXRlY3Rpb25SZXN1bHQucGF0dGVyblxuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgZ2VuZXJhdGVkUmVsYXRpb25Db25maWc6IElSZWxhdGlvbkZpZWxkQ29uZmlnID0ge1xuICAgICAgICAgICAgICAgIHJvdXRlUGF0dGVybjogcm91dGVQYXR0ZXJuLFxuICAgICAgICAgICAgICAgIC8vIFBhc3MgQUxMIGlkZW50aWZpZXIgbWFwcGluZ3MgKHN1cHBvcnRzIGNvbXBvc2l0ZSBrZXlzKVxuICAgICAgICAgICAgICAgIGlkZW50aWZpZXJNYXBwaW5nOiBpZGVudGlmaWVyTWFwcGluZ3MubGVuZ3RoID09PSAxIFxuICAgICAgICAgICAgICAgICAgICA/IGlkZW50aWZpZXJNYXBwaW5nc1swXSAgLy8gU2luZ2xlOiByZXR1cm4gb2JqZWN0XG4gICAgICAgICAgICAgICAgICAgIDogaWRlbnRpZmllck1hcHBpbmdzLCAgICAgLy8gTXVsdGlwbGU6IHJldHVybiBhcnJheVxuICAgICAgICAgICAgICAgIG1vZGFsQ29uZmlnUmVmOiB1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsQ29uZmlnUmVmIHx8IHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICd2aWV3JyxcbiAgICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHt9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBtb2RhbFdpZHRoOiB1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsV2lkdGgsXG4gICAgICAgICAgICAgICAgbW9kYWxUaXRsZTogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbFRpdGxlLFxuICAgICAgICAgICAgICAgIGRpc3BsYXlDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgLy8gUHJpb3JpdHk6IFVzZXIgY3VzdG9tIHRlbXBsYXRlID4gQXV0by1kZXRlY3RlZCBkdXBsaWNhdGVkIGZpZWxkID4gdW5kZWZpbmVkICh1c2UgZmFsbGJhY2spXG4gICAgICAgICAgICAgICAgICAgIHRlbXBsYXRlOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnRlbXBsYXRlIHx8IGF1dG9UZW1wbGF0ZSxcbiAgICAgICAgICAgICAgICAgICAgLy8gU21hcnQgZmFsbGJhY2sgcHJlLWdlbmVyYXRlZCBmcm9tIGVudGl0eSBtZXRhZGF0YVxuICAgICAgICAgICAgICAgICAgICBmYWxsYmFjazogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5mYWxsYmFjayB8fCBmYWxsYmFja0NvbmZpZyxcbiAgICAgICAgICAgICAgICAgICAgLy8gSWNvbiBmcm9tIGVudGl0eSBtZXRhZGF0YSBvciB1c2VyIG92ZXJyaWRlXG4gICAgICAgICAgICAgICAgICAgIGljb246IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uaWNvbiB8fCBkZWZhdWx0SWNvbiB8fCAnRXllT3V0bGluZWQnLFxuICAgICAgICAgICAgICAgICAgICBzaG93TW9kYWxJY29uOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnNob3dNb2RhbEljb24gIT09IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICBzaG93TGluazogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5zaG93TGluayAhPT0gZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgIC8vIFBhc3MgdGhyb3VnaCBhdXRvRGV0ZWN0IGFuZCBhdXRvRGV0ZWN0SGludHNcbiAgICAgICAgICAgICAgICAgICAgYXV0b0RldGVjdDogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5hdXRvRGV0ZWN0LFxuICAgICAgICAgICAgICAgICAgICBhdXRvRGV0ZWN0SGludHM6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uYXV0b0RldGVjdEhpbnRzLFxuICAgICAgICAgICAgICAgICAgICAvLyBQYXNzIHRocm91Z2ggYW55IGN1c3RvbSBhY3Rpb25zXG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbnM6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uYWN0aW9uc1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBpZihnbG9iYWxVSUNvbmZpZ09wdGlvbnM/LmR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbj8uZGVidWcpIHtcbiAgICAgICAgICAgICAgICBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZy5kaXNwbGF5Q29uZmlnIVsnX2RldGVjdGlvbk1ldGFkYXRhJ10gPSBkZXRlY3Rpb25NZXRhZGF0YTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgZm9ybWF0dGVkWyAncmVsYXRpb25Db25maWcnIF0gPSBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZztcblxuICAgICAgICAgICAgLy8gQmFja3dhcmQgY29tcGF0aWJpbGl0eTogS2VlcCBpc0xpbmsgYW5kIGxpbmtDb25maWdcbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ2lzTGluaycgXSA9IHRydWU7XG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdsaW5rQ29uZmlnJyBdID0ge1xuICAgICAgICAgICAgICAgIHJvdXRlUGF0dGVybjogcm91dGVQYXR0ZXJuXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgIH0gZWxzZSBpZiAocmVsYXRpb25UeXBlLmVuZHNXaXRoKCd0by1tYW55JykpIHtcbiAgICAgICAgICAgIC8vIFRPLU1BTlk6IFNob3cgY291bnQgKyBtb2RhbCBpY29uIChvcGVucyBmaWx0ZXJlZCBsaXN0KVxuICAgICAgICAgICAgLy8gUm91dGUgcGF0dGVybjogVXNlIGN1c3RvbSAoZnJvbSByZWxhdGlvbkNvbmZpZykgb3IgZGVmYXVsdCB0byAvbGlzdC17ZW50aXR5fVxuICAgICAgICAgICAgY29uc3Qgcm91dGVQYXR0ZXJuID0gdXNlclJlbGF0aW9uQ29uZmlnPy5yb3V0ZVBhdHRlcm5cbiAgICAgICAgICAgICAgICB8fCBgL2xpc3QtJHtlbnRpdHlOYW1lTG93ZXJ9YDtcblxuICAgICAgICAgICAgLy8gQnVpbGQgZGVmYXVsdCBmaWx0ZXJzIHRvIHNob3cgb25seSByZWxhdGVkIGl0ZW1zXG4gICAgICAgICAgICAvLyBGb3IgZXhhbXBsZSwgaWYgd2UncmUgdmlld2luZyBhIFRlYW0gYW5kIHRoaXMgZmllbGQgc2hvd3MgR2FtZXMsXG4gICAgICAgICAgICAvLyB3ZSB3YW50IHRvIGZpbHRlciBnYW1lcyB3aGVyZSB0ZWFtSWQgPSBjdXJyZW50IHRlYW0ncyBJRFxuICAgICAgICAgICAgLy8gRm9yIGNvbXBvc2l0ZSBrZXlzLCBhZGQgYWxsIGlkZW50aWZpZXJzIGFzIGZpbHRlcnNcbiAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRGaWx0ZXJzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgICAgICAgICBpZGVudGlmaWVyTWFwcGluZ3MuZm9yRWFjaChtYXBwaW5nID0+IHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0RmlsdGVyc1ttYXBwaW5nLnRhcmdldF0gPSBgOiR7bWFwcGluZy5zb3VyY2V9YDtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBHZW5lcmF0ZSBmYWxsYmFjayBjb25maWd1cmF0aW9uIGZvciB0by1tYW55IChzaG93cyBjb3VudClcbiAgICAgICAgICAgIGNvbnN0IGZhbGxiYWNrQ29uZmlnID0gZ2VuZXJhdGVSZWxhdGlvbkZhbGxiYWNrKFxuICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgcHJpbWFyeUlkZW50aWZpZXIuc291cmNlLFxuICAgICAgICAgICAgICAgIHJlbGF0ZWRFbnRpdHlTZXJ2aWNlXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICBjb25zdCBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZzogSVJlbGF0aW9uRmllbGRDb25maWcgPSB7XG4gICAgICAgICAgICAgICAgcm91dGVQYXR0ZXJuOiByb3V0ZVBhdHRlcm4sXG4gICAgICAgICAgICAgICAgLy8gUGFzcyBBTEwgaWRlbnRpZmllciBtYXBwaW5ncyAoc3VwcG9ydHMgY29tcG9zaXRlIGtleXMpXG4gICAgICAgICAgICAgICAgaWRlbnRpZmllck1hcHBpbmc6IGlkZW50aWZpZXJNYXBwaW5ncy5sZW5ndGggPT09IDEgXG4gICAgICAgICAgICAgICAgICAgID8gaWRlbnRpZmllck1hcHBpbmdzWzBdICAvLyBTaW5nbGU6IHJldHVybiBvYmplY3RcbiAgICAgICAgICAgICAgICAgICAgOiBpZGVudGlmaWVyTWFwcGluZ3MsICAgICAvLyBNdWx0aXBsZTogcmV0dXJuIGFycmF5XG4gICAgICAgICAgICAgICAgbW9kYWxDb25maWdSZWY6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxDb25maWdSZWYgfHwge1xuICAgICAgICAgICAgICAgICAgICBlbnRpdHlOYW1lOiBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgICAgICBwYWdlVHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IGRlZmF1bHRGaWx0ZXJzXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIG1vZGFsV2lkdGg6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxXaWR0aCxcbiAgICAgICAgICAgICAgICBtb2RhbFRpdGxlOiB1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsVGl0bGUsXG4gICAgICAgICAgICAgICAgZGlzcGxheUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAvLyBVc2VyIGNhbiBvdmVycmlkZSB3aXRoIGN1c3RvbSB0ZW1wbGF0ZVxuICAgICAgICAgICAgICAgICAgICB0ZW1wbGF0ZTogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy50ZW1wbGF0ZSxcbiAgICAgICAgICAgICAgICAgICAgLy8gU21hcnQgZmFsbGJhY2sgcHJlLWdlbmVyYXRlZCBmcm9tIGVudGl0eSBtZXRhZGF0YVxuICAgICAgICAgICAgICAgICAgICBmYWxsYmFjazogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5mYWxsYmFjayB8fCBmYWxsYmFja0NvbmZpZyxcbiAgICAgICAgICAgICAgICAgICAgLy8gSWNvbiBmcm9tIGVudGl0eSBtZXRhZGF0YSBvciB1c2VyIG92ZXJyaWRlXG4gICAgICAgICAgICAgICAgICAgIGljb246IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uaWNvbiB8fCBkZWZhdWx0SWNvbiB8fCAnVW5vcmRlcmVkTGlzdE91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICAgICAgc2hvd01vZGFsSWNvbjogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5zaG93TW9kYWxJY29uICE9PSBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgc2hvd0xpbms6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uc2hvd0xpbmsgIT09IHRydWUsIC8vIERlZmF1bHQgZmFsc2UgZm9yIHRvLW1hbnlcbiAgICAgICAgICAgICAgICAgICAgLy8gUGFzcyB0aHJvdWdoIGFueSBjdXN0b20gYWN0aW9uc1xuICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmFjdGlvbnNcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAvLyBJZiB1c2VyIHByb3ZpZGVkIGN1c3RvbSBtb2RhbENvbmZpZ1JlZiwgbWVyZ2UgZGVmYXVsdCBmaWx0ZXJzIHdpdGggdGhlaXIgb3ZlcnJpZGVzXG4gICAgICAgICAgICBpZiAodXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbENvbmZpZ1JlZj8ub3ZlcnJpZGVDb25maWcpIHtcbiAgICAgICAgICAgICAgICBnZW5lcmF0ZWRSZWxhdGlvbkNvbmZpZy5tb2RhbENvbmZpZ1JlZiEub3ZlcnJpZGVDb25maWcgPSB7XG4gICAgICAgICAgICAgICAgICAgIC4uLnVzZXJSZWxhdGlvbkNvbmZpZy5tb2RhbENvbmZpZ1JlZi5vdmVycmlkZUNvbmZpZyxcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLmRlZmF1bHRGaWx0ZXJzLFxuICAgICAgICAgICAgICAgICAgICAgICAgLi4uKHVzZXJSZWxhdGlvbkNvbmZpZy5tb2RhbENvbmZpZ1JlZi5vdmVycmlkZUNvbmZpZy5kZWZhdWx0RmlsdGVycyB8fCB7fSlcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ3JlbGF0aW9uQ29uZmlnJyBdID0gZ2VuZXJhdGVkUmVsYXRpb25Db25maWc7XG4gICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gSGFuZGxlIG5lc3RlZCBzdHJ1Y3R1cmVzIChtYXAgYW5kIGxpc3QgdHlwZXMpXG4gICAgaWYgKHRoaXNQcm9wLnR5cGUgPT09ICdtYXAnICYmIHRoaXNQcm9wLnByb3BlcnRpZXMpIHtcbiAgICAgICAgZm9ybWF0dGVkWyAncHJvcGVydGllcycgXSA9IGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JGb3JtT3JEZXRhaWwodGhpc1Byb3AucHJvcGVydGllcywgdHlwZSwgZW50aXR5U2VydmljZSk7XG4gICAgfSBlbHNlIGlmICh0aGlzUHJvcC50eXBlID09PSAnbGlzdCcpIHtcbiAgICAgICAgLy8gRm9yIGxpc3QgdHlwZXMsIGNoZWNrIGlmIGl0ZW1zIGFyZSBtYXBzIChuZXN0ZWQgc3RydWN0dXJlcylcbiAgICAgICAgLy8gTm90ZTogaXRlbXMgcHJvcGVydHkgZXhpc3RzIG9uIGxpc3QtdHlwZSBhdHRyaWJ1dGVzIGJ1dCBub3QgaW4gYmFzZSBFbnRpdHlBdHRyaWJ1dGUgdHlwZVxuICAgICAgICBjb25zdCBleHRlbmRlZFByb3AgPSB0aGlzUHJvcCBhcyBUSU9TY2hlbWFBdHRyaWJ1dGUgJiB7IGl0ZW1zPzogeyB0eXBlOiBzdHJpbmc7IHByb3BlcnRpZXM/OiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSB9IH07XG4gICAgICAgIGlmIChleHRlbmRlZFByb3AuaXRlbXM/LnR5cGUgPT09ICdtYXAnICYmIGV4dGVuZGVkUHJvcC5pdGVtcy5wcm9wZXJ0aWVzKSB7XG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdpdGVtcycgXSA9IHtcbiAgICAgICAgICAgICAgICAuLi5mb3JtYXR0ZWRbICdpdGVtcycgXSxcbiAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRm9ybU9yRGV0YWlsKGV4dGVuZGVkUHJvcC5pdGVtcy5wcm9wZXJ0aWVzLCB0eXBlLCBlbnRpdHlTZXJ2aWNlKVxuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFRPRE86IGFkZCBzdXBwb3J0IGZvciBzZXQsIGVudW0sIGFuZCBjdXN0b20tdHlwZXNcblxuICAgIHJldHVybiBmb3JtYXR0ZWQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRm9ybU9yRGV0YWlsKFxuICAgIHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLFxuICAgIHR5cGU6ICdjcmVhdGUnIHwgJ3VwZGF0ZScgfCAnZGV0YWlsJyxcbiAgICBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+XG4pIHtcblxuICAgIGlmICh0eXBlID09PSAnY3JlYXRlJykge1xuICAgICAgICByZXR1cm4gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckNyZWF0ZShwcm9wZXJ0aWVzLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICB9XG5cbiAgICBpZiAodHlwZSA9PT0gJ3VwZGF0ZScpIHtcbiAgICAgICAgcmV0dXJuIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JVcGRhdGUocHJvcGVydGllcywgZW50aXR5U2VydmljZSk7XG4gICAgfVxuXG4gICAgaWYgKHR5cGUgPT09ICdkZXRhaWwnKSB7XG4gICAgICAgIHJldHVybiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRGV0YWlsKHByb3BlcnRpZXMsIGVudGl0eVNlcnZpY2UpO1xuICAgIH1cbiAgICB0aHJvdyAoYEludmFsaWQgdHlwZSBbJHt0eXBlfV0gcHJvdmlkZWQgdG8gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckZvcm1PckRldGFpbGApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckNyZWF0ZShwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSwgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PiwgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyd1aUNvbmZpZ0dlbk9wdGlvbnMnXSkge1xuICAgIHJldHVybiBwcm9wZXJ0aWVzXG4gICAgICAgIC5maWx0ZXIocHJvcCA9PiBwcm9wICYmICghcHJvcC5oYXNPd25Qcm9wZXJ0eSgnaXNDcmVhdGFibGUnKSB8fCBwcm9wLmlzQ3JlYXRhYmxlKSlcbiAgICAgICAgLm1hcCgoYXR0KSA9PiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoYXR0LCAnY3JlYXRlJywgZW50aXR5U2VydmljZSwgcHJvcGVydGllcywgZ2xvYmFsVUlDb25maWdPcHRpb25zKSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yVXBkYXRlKHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLCBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+LCBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbJ3VpQ29uZmlnR2VuT3B0aW9ucyddKSB7XG4gICAgcmV0dXJuIHByb3BlcnRpZXNcbiAgICAgICAgLmZpbHRlcihwcm9wID0+IHByb3AgJiYgKCFwcm9wLmhhc093blByb3BlcnR5KCdpc0VkaXRhYmxlJykgfHwgcHJvcC5pc0VkaXRhYmxlKSlcbiAgICAgICAgLm1hcCgoYXR0KSA9PiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoYXR0LCAndXBkYXRlJywgZW50aXR5U2VydmljZSwgcHJvcGVydGllcywgZ2xvYmFsVUlDb25maWdPcHRpb25zKSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRGV0YWlsKHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLCBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+LCBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbJ3VpQ29uZmlnR2VuT3B0aW9ucyddKSB7XG4gICAgcmV0dXJuIHByb3BlcnRpZXNcbiAgICAgICAgLmZpbHRlcihwcm9wID0+IHByb3AgJiYgKCFwcm9wLmhhc093blByb3BlcnR5KCdpc1Zpc2libGUnKSB8fCBwcm9wLmlzVmlzaWJsZSkpXG4gICAgICAgIC5tYXAoKGF0dCkgPT4gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKGF0dCwgJ2RldGFpbCcsIGVudGl0eVNlcnZpY2UsIHByb3BlcnRpZXMsIGdsb2JhbFVJQ29uZmlnT3B0aW9ucykpO1xufVxuXG5leHBvcnQgdHlwZSBMaXN0aW5nUHJvcENvbmZpZyA9IFBpY2s8RmllbGRNZXRhZGF0YSwgJ2ZpZWxkVHlwZScgfCAncGxhY2Vob2xkZXInIHwgJ2hlbHBUZXh0JyB8ICdmaWx0ZXJDb25maWcnPiAmIHtcbiAgICBuYW1lOiBzdHJpbmcsXG4gICAgZGF0YUluZGV4OiBzdHJpbmcsXG4gICAgaGlkZGVuPzogYm9vbGVhbixcbiAgICBhY3Rpb25zPzogQXJyYXk8SUVudGl0eVBhZ2VBY3Rpb24+LFxuICAgIHJlbGF0aW9uQ29uZmlnPzogSVJlbGF0aW9uRmllbGRDb25maWcsICAvLyBGb3IgcmVuZGVyaW5nIHJlbGF0aW9ucyB3aXRoIGxpbmtzL21vZGFsc1xuICAgIHRlbXBsYXRlPzogVGVtcGxhdGUsICAvLyBGb3IgdGVtcGxhdGUtYmFzZWQgcmVuZGVyaW5nXG4gICAgaXNJZGVudGlmaWVyPzogYm9vbGVhbiwgIC8vIEZvciBpZGVudGlmaWVyIGZpZWxkc1xuICAgIGlzTGluaz86IGJvb2xlYW4sICAvLyBGb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxuICAgIGxpbmtDb25maWc/OiB7IHJvdXRlUGF0dGVybjogc3RyaW5nOyBkaXNwbGF5VGV4dD86IHN0cmluZyB9LCAgLy8gRm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbn07XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yTGlzdChcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsIFxuICAgIHByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLCBcbiAgICBlbnRpdHlTZXJ2aWNlOiBCYXNlRW50aXR5U2VydmljZTxhbnk+LFxuICAgIHtcbiAgICBDUlVEQXBpUGF0aCxcbiAgICBleGNsdWRlRnJvbUFkbWluVXBkYXRlLFxuICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZWxldGUsXG4gICAgZXhjbHVkZUZyb21BZG1pbkRldGFpbCxcbiAgICAgICAgY3VzdG9tUm93QWN0aW9ucyxcbiAgICAgICAgZ2xvYmFsVUlDb25maWdPcHRpb25zXG59OiB7XG4gICAgQ1JVREFwaVBhdGg/OiBzdHJpbmcsXG4gICAgZXhjbHVkZUZyb21BZG1pblVwZGF0ZT86IGJvb2xlYW4sXG4gICAgZXhjbHVkZUZyb21BZG1pbkRlbGV0ZT86IGJvb2xlYW4sXG4gICAgZXhjbHVkZUZyb21BZG1pbkRldGFpbD86IGJvb2xlYW4sXG4gICAgY3VzdG9tUm93QWN0aW9ucz86IFJlYWRvbmx5QXJyYXk8SUVudGl0eVBhZ2VBY3Rpb24+IHwgQXJyYXk8SUVudGl0eVBhZ2VBY3Rpb24+LFxuICAgICAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnM/OiBJQXBwbGljYXRpb25Db25maWdbJ3VpQ29uZmlnR2VuT3B0aW9ucyddICAvLyBORVc6IEdsb2JhbCBjb25maWcgb3B0aW9uc1xuICAgIH1cbikge1xuXG4gICAgY29uc3QgZW50aXR5TmFtZUxvd2VyID0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IGVudGl0eU5hbWVQYXNjYWxDYXNlID0gcGFzY2FsQ2FzZShlbnRpdHlOYW1lKTtcblxuICAgIHJldHVybiBwcm9wZXJ0aWVzXG4gICAgICAgIC5maWx0ZXIocHJvcCA9PiBwcm9wICYmIHByb3AuaXNMaXN0YWJsZSlcbiAgICAgICAgLm1hcChwcm9wID0+IHtcbiAgICAgICAgICAgIC8vIFVzZSBzYW1lIGZvcm1hdHRpbmcgbG9naWMgYXMgZGV0YWlscy9mb3JtcyAoaW5jbHVkZXMgcmVsYXRpb25Db25maWcgZ2VuZXJhdGlvbilcbiAgICAgICAgICAgIC8vIFBhc3MgYWxsIHByb3BlcnRpZXMgc28gaXQgY2FuIGRldGVjdCBkdXBsaWNhdGVkIHJlbGF0aW9uIGZpZWxkcyAoZS5nLiwgdGVhbU5hbWUgZm9yIHRlYW1JZClcbiAgICAgICAgICAgIGNvbnN0IGZvcm1hdHRlZCA9IGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbChwcm9wLCAnZGV0YWlsJywgZW50aXR5U2VydmljZSwgcHJvcGVydGllcywgZ2xvYmFsVUlDb25maWdPcHRpb25zKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gQXV0by1nZW5lcmF0ZSBmaWx0ZXJDb25maWcgaWYgbm90IGFscmVhZHkgcHJlc2VudCBhbmQgZmllbGQgaXMgZmlsdGVyYWJsZVxuICAgICAgICAgICAgY29uc3QgYXV0b0dlbmVyYXRlZEZpbHRlckNvbmZpZyA9ICFmb3JtYXR0ZWQuZmlsdGVyQ29uZmlnICYmIHByb3AuaXNGaWx0ZXJhYmxlICE9PSBmYWxzZVxuICAgICAgICAgICAgICAgID8gZ2VuZXJhdGVGaWx0ZXJDb25maWcocHJvcCwgZW50aXR5U2VydmljZSwgZ2xvYmFsVUlDb25maWdPcHRpb25zKVxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBPdmVycmlkZS9hZGQgbGlzdC1zcGVjaWZpYyBwcm9wZXJ0aWVzXG4gICAgICAgICAgICBjb25zdCBwcm9wQ29uZmlnOiBMaXN0aW5nUHJvcENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICAuLi5mb3JtYXR0ZWQsXG4gICAgICAgICAgICAgICAgbmFtZTogZm9ybWF0dGVkLmxhYmVsIHx8IGZvcm1hdHRlZC5uYW1lLCAgLy8gRW5zdXJlIG5hbWUgaXMgc2V0IGZvciB0YWJsZSBjb2x1bW4gaGVhZGVyXG4gICAgICAgICAgICAgICAgZGF0YUluZGV4OiBgJHtwcm9wLmlkfWAsXG4gICAgICAgICAgICAgICAgZmllbGRUeXBlOiBmb3JtYXR0ZWQuZmllbGRUeXBlIHx8ICd0ZXh0JyxcbiAgICAgICAgICAgICAgICBmaWx0ZXJDb25maWc6IGZvcm1hdHRlZC5maWx0ZXJDb25maWcgfHwgYXV0b0dlbmVyYXRlZEZpbHRlckNvbmZpZywgIC8vIFVzZSBleHBsaWNpdCBvciBhdXRvLWdlbmVyYXRlZFxuICAgICAgICAgICAgICAgIGhpZGRlbjogcHJvcC5oYXNPd25Qcm9wZXJ0eSgnaXNWaXNpYmxlJykgJiYgIXByb3AuaXNWaXNpYmxlXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBpZiAocHJvcC5pc0lkZW50aWZpZXIpIHtcbiAgICAgICAgICAgICAgICAvLyBCdWlsZCBkZWZhdWx0IHJvdyBhY3Rpb25zIHdpdGggSURzXG4gICAgICAgICAgICAgICAgY29uc3QgZGVmYXVsdEFjdGlvbnM6IEFycmF5PElFbnRpdHlQYWdlQWN0aW9uPiA9IFtdO1xuXG4gICAgICAgICAgICAgICAgaWYgKCFleGNsdWRlRnJvbUFkbWluRGV0YWlsKSB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRBY3Rpb25zLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgaWQ6ICd2aWV3JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb246ICd2aWV3JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnVmlldycsXG4gICAgICAgICAgICAgICAgICAgICAgICB0ZW1wbGF0ZTogYFZpZXcgeyR7cHJvcC5pZH19YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybDogYC92aWV3LSR7ZW50aXR5TmFtZUxvd2VyfWBcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKCFleGNsdWRlRnJvbUFkbWluVXBkYXRlKSB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRBY3Rpb25zLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgaWQ6ICdlZGl0JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb246ICdlZGl0JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsOiAnRWRpdCcsXG4gICAgICAgICAgICAgICAgICAgICAgICB0ZW1wbGF0ZTogYEVkaXQgeyR7cHJvcC5pZH19YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybDogYC9lZGl0LSR7ZW50aXR5TmFtZUxvd2VyfWBcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKCFleGNsdWRlRnJvbUFkbWluRGVsZXRlKSB7XG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRBY3Rpb25zLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgaWQ6ICdkZWxldGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbjogJ2RlbGV0ZScsXG4gICAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0RlbGV0ZScsXG4gICAgICAgICAgICAgICAgICAgICAgICB0ZW1wbGF0ZTogYERlbGV0ZSB7JHtwcm9wLmlkfX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgb3BlbkluTW9kYWw6IHRydWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBtb2RhbENvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGFsVHlwZTogJ2NvbmZpcm0nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vZGFsUGFnZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aXRsZTogYERlbGV0ZSAke2VudGl0eU5hbWVQYXNjYWxDYXNlfT9gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50OiBgQXJlIHlvdSBzdXJlIHlvdSB3YW50IHRvIGRlbGV0ZSB0aGlzICR7ZW50aXR5TmFtZVBhc2NhbENhc2V9PyBUaGlzIGFjdGlvbiBjYW5ub3QgYmUgdW5kb25lLmBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFwaUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhcGlNZXRob2Q6IGBERUxFVEVgLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXNwb25zZUtleTogZW50aXR5TmFtZUxvd2VyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhcGlVcmw6IGAke0NSVURBcGlQYXRoID8gQ1JVREFwaVBhdGggOiAnJ30vJHtlbnRpdHlOYW1lTG93ZXJ9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3NNZXNzYWdlOiBgJHtlbnRpdHlOYW1lUGFzY2FsQ2FzZX0gZGVsZXRlZCBzdWNjZXNzZnVsbHlgLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yTWVzc2FnZTogYEZhaWxlZCB0byBkZWxldGUgJHtlbnRpdHlOYW1lUGFzY2FsQ2FzZX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1Ym1pdFN1Y2Nlc3NSZWRpcmVjdDogYC9saXN0LSR7ZW50aXR5TmFtZUxvd2VyfWBcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gTWVyZ2UgY3VzdG9tIHJvdyBhY3Rpb25zIHVzaW5nIGlkZW50aWZpZXItYmFzZWQgb3ZlcnJpZGVcbiAgICAgICAgICAgICAgICBwcm9wQ29uZmlnLmFjdGlvbnMgPSBjdXN0b21Sb3dBY3Rpb25zIFxuICAgICAgICAgICAgICAgICAgICA/IG1lcmdlQWN0aW9ucyhkZWZhdWx0QWN0aW9ucywgY3VzdG9tUm93QWN0aW9ucylcbiAgICAgICAgICAgICAgICAgICAgOiBkZWZhdWx0QWN0aW9ucztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHByb3BDb25maWc7XG4gICAgICAgIH0pO1xufVxuXG4vKipcbiAqIE1FUkdFIFVUSUxJVFkgRlVOQ1RJT05TXG4gKiBcbiAqIFRoZXNlIGZ1bmN0aW9ucyBpbXBsZW1lbnQgdGhlIGlkZW50aWZpZXItYmFzZWQgb3ZlcnJpZGUgcGF0dGVybjpcbiAqIC0gRGVmYXVsdHMgaGF2ZSBzdGFuZGFyZCBpZGVudGlmaWVycyAoZS5nLiwgJ3ZpZXcnLCAnZWRpdCcsICdkZWxldGUnKVxuICogLSBDdXN0b20gY29uZmlncyB3aXRoIHNhbWUgaWRlbnRpZmllciBvdmVycmlkZSB0aGUgZGVmYXVsdFxuICogLSBOZXcgaWRlbnRpZmllcnMgZ2V0IGFkZGVkIHRvIHRoZSByZXN1bHRcbiAqL1xuXG4vKipcbiAqIE1lcmdlIGRlZmF1bHQgYnV0dG9ucyB3aXRoIGN1c3RvbSBidXR0b25zIHVzaW5nIGlkZW50aWZpZXItYmFzZWQgb3ZlcnJpZGUuXG4gKiBcbiAqIEBwYXJhbSBkZWZhdWx0cyAtIERlZmF1bHQgYnV0dG9ucyAoZnJvbSBnZW5lcmF0b3IpXG4gKiBAcGFyYW0gY3VzdG9tcyAtIEN1c3RvbSBidXR0b25zIChmcm9tIGVudGl0eSBzY2hlbWEpXG4gKiBAcmV0dXJucyBNZXJnZWQgYnV0dG9uIGFycmF5XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZUJ1dHRvbnM8VCBleHRlbmRzIHsgaWQ/OiBzdHJpbmcgfT4oXG4gICAgZGVmYXVsdHM6IEFycmF5PFQ+LFxuICAgIGN1c3RvbXM6IFJlYWRvbmx5QXJyYXk8VD4gfCBBcnJheTxUPiA9IFtdXG4pOiBBcnJheTxUPiB7XG4gICAgY29uc3QgY3VzdG9tc0FycmF5ID0gWy4uLmN1c3RvbXNdOyAgLy8gQ29udmVydCB0byBtdXRhYmxlIGFycmF5XG4gICAgY29uc3QgY3VzdG9tTWFwID0gbmV3IE1hcChcbiAgICAgICAgY3VzdG9tc0FycmF5LmZpbHRlcihjID0+IGMuaWQpLm1hcChjID0+IFtjLmlkLCBjXSlcbiAgICApO1xuICAgIFxuICAgIC8vIFN0YXJ0IHdpdGggZGVmYXVsdHMsIHJlcGxhY2UgaWYgY3VzdG9tIGhhcyBzYW1lIGlkXG4gICAgY29uc3QgbWVyZ2VkID0gZGVmYXVsdHMubWFwKGRlZmF1bHRCdG4gPT4gXG4gICAgICAgIGRlZmF1bHRCdG4uaWQgJiYgY3VzdG9tTWFwLmhhcyhkZWZhdWx0QnRuLmlkKVxuICAgICAgICAgICAgPyBjdXN0b21NYXAuZ2V0KGRlZmF1bHRCdG4uaWQpISAgLy8gT3ZlcnJpZGVcbiAgICAgICAgICAgIDogZGVmYXVsdEJ0blxuICAgICk7XG4gICAgXG4gICAgLy8gQWRkIGN1c3RvbSBidXR0b25zIHRoYXQgZG9uJ3Qgb3ZlcnJpZGUgZGVmYXVsdHNcbiAgICBjdXN0b21zQXJyYXkuZm9yRWFjaChjdXN0b21CdG4gPT4ge1xuICAgICAgICBpZiAoIWN1c3RvbUJ0bi5pZCB8fCAhZGVmYXVsdHMuc29tZShkID0+IGQuaWQgPT09IGN1c3RvbUJ0bi5pZCkpIHtcbiAgICAgICAgICAgIG1lcmdlZC5wdXNoKGN1c3RvbUJ0bik7ICAvLyBBZGQgbmV3XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICBcbiAgICByZXR1cm4gbWVyZ2VkO1xufVxuXG4vKipcbiAqIE1lcmdlIGRlZmF1bHQgYWN0aW9ucyB3aXRoIGN1c3RvbSBhY3Rpb25zIHVzaW5nIGlkZW50aWZpZXItYmFzZWQgb3ZlcnJpZGUuXG4gKiBTYW1lIGxvZ2ljIGFzIG1lcmdlQnV0dG9ucyBidXQgc2VtYW50aWNhbGx5IG5hbWVkIGZvciBhY3Rpb25zLlxuICogXG4gKiBAcGFyYW0gZGVmYXVsdHMgLSBEZWZhdWx0IGFjdGlvbnMgKGZyb20gZ2VuZXJhdG9yKVxuICogQHBhcmFtIGN1c3RvbXMgLSBDdXN0b20gYWN0aW9ucyAoZnJvbSBlbnRpdHkgc2NoZW1hKVxuICogQHJldHVybnMgTWVyZ2VkIGFjdGlvbiBhcnJheVxuICovXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VBY3Rpb25zPFQgZXh0ZW5kcyB7IGlkPzogc3RyaW5nIH0+KFxuICAgIGRlZmF1bHRzOiBBcnJheTxUPixcbiAgICBjdXN0b21zOiBSZWFkb25seUFycmF5PFQ+IHwgQXJyYXk8VD4gPSBbXVxuKTogQXJyYXk8VD4ge1xuICAgIHJldHVybiBtZXJnZUJ1dHRvbnMoZGVmYXVsdHMsIFsuLi5jdXN0b21zXSk7ICAvLyBTcHJlYWQgdG8gaGFuZGxlIGJvdGggcmVhZG9ubHkgYW5kIG11dGFibGVcbn1cblxuLyoqXG4gKiBNZXJnZSBmaWVsZC1sZXZlbCB2aXNpYmlsaXR5L2VuYWJsZW1lbnQvaGVscFRleHQvcGxhY2Vob2xkZXIgaW50byBiYXNlIHByb3BlcnRpZXMuXG4gKiBcbiAqIEBwYXJhbSBiYXNlUHJvcGVydGllcyAtIEJhc2UgcHJvcGVydGllcyBmcm9tIHNjaGVtYVxuICogQHBhcmFtIGZpZWxkT3ZlcnJpZGVzIC0gRmllbGQgb3ZlcnJpZGVzIGZyb20gZm9ybUNvbmZpZy5maWVsZHNcbiAqIEByZXR1cm5zIFByb3BlcnRpZXMgd2l0aCBvdmVycmlkZXMgbWVyZ2VkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZUZpZWxkVmlzaWJpbGl0eTxUIGV4dGVuZHMgeyBuYW1lOiBzdHJpbmcgfT4oXG4gICAgYmFzZVByb3BlcnRpZXM6IEFycmF5PFQ+LFxuICAgIGZpZWxkT3ZlcnJpZGVzOiBSZWFkb25seUFycmF5PHtcbiAgICAgICAgcmVhZG9ubHkgbmFtZTogc3RyaW5nO1xuICAgICAgICByZWFkb25seSB2aXNpYmlsaXR5PzogYW55O1xuICAgICAgICByZWFkb25seSBlbmFibGVtZW50PzogYW55O1xuICAgICAgICByZWFkb25seSBoZWxwVGV4dD86IHN0cmluZztcbiAgICAgICAgcmVhZG9ubHkgcGxhY2Vob2xkZXI/OiBzdHJpbmc7XG4gICAgfT4gfCBBcnJheTx7XG4gICAgICAgIG5hbWU6IHN0cmluZztcbiAgICAgICAgdmlzaWJpbGl0eT86IGFueTtcbiAgICAgICAgZW5hYmxlbWVudD86IGFueTtcbiAgICAgICAgaGVscFRleHQ/OiBzdHJpbmc7XG4gICAgICAgIHBsYWNlaG9sZGVyPzogc3RyaW5nO1xuICAgIH0+ID0gW11cbik6IEFycmF5PFQ+IHtcbiAgICBjb25zdCBvdmVycmlkZU1hcCA9IG5ldyBNYXAoXG4gICAgICAgIFsuLi5maWVsZE92ZXJyaWRlc10ubWFwKGYgPT4gW2YubmFtZSwgZl0pXG4gICAgKTtcbiAgICBcbiAgICAvLyBWYWxpZGF0aW9uOiBXYXJuIGlmIGZpZWxkIG92ZXJyaWRlIHJlZmVyZW5jZXMgbm9uLWV4aXN0ZW50IGZpZWxkXG4gICAgZmllbGRPdmVycmlkZXMuZm9yRWFjaChvdmVycmlkZSA9PiB7XG4gICAgICAgIGlmICghYmFzZVByb3BlcnRpZXMuc29tZShwID0+IHAubmFtZSA9PT0gb3ZlcnJpZGUubmFtZSkpIHtcbiAgICAgICAgICAgIERlZmF1bHRMb2dnZXIud2FybihgRmllbGQgb3ZlcnJpZGUgXCIke292ZXJyaWRlLm5hbWV9XCIgbm90IGZvdW5kIGluIHNjaGVtYSBwcm9wZXJ0aWVzLiBUaGlzIG92ZXJyaWRlIHdpbGwgYmUgaWdub3JlZC5gKTtcbiAgICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIHJldHVybiBiYXNlUHJvcGVydGllcy5tYXAocHJvcCA9PiB7XG4gICAgICAgIGNvbnN0IG92ZXJyaWRlID0gb3ZlcnJpZGVNYXAuZ2V0KHByb3AubmFtZSk7XG4gICAgICAgIFxuICAgICAgICBpZiAoIW92ZXJyaWRlKSByZXR1cm4gcHJvcDtcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAuLi5wcm9wLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLnZpc2liaWxpdHkgIT09IHVuZGVmaW5lZCAmJiB7IHZpc2liaWxpdHk6IG92ZXJyaWRlLnZpc2liaWxpdHkgfSksXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUuZW5hYmxlbWVudCAhPT0gdW5kZWZpbmVkICYmIHsgZW5hYmxlbWVudDogb3ZlcnJpZGUuZW5hYmxlbWVudCB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS5oZWxwVGV4dCAhPT0gdW5kZWZpbmVkICYmIHsgaGVscFRleHQ6IG92ZXJyaWRlLmhlbHBUZXh0IH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLnBsYWNlaG9sZGVyICE9PSB1bmRlZmluZWQgJiYgeyBwbGFjZWhvbGRlcjogb3ZlcnJpZGUucGxhY2Vob2xkZXIgfSlcbiAgICAgICAgfTtcbiAgICB9KTtcbn1cblxuLyoqXG4gKiBNZXJnZSBjb2x1bW4tbGV2ZWwgdmlzaWJpbGl0eS93aWR0aC9maXhlZCBpbnRvIGJhc2UgcHJvcGVydGllcy5cbiAqIFxuICogQHBhcmFtIGJhc2VQcm9wZXJ0aWVzIC0gQmFzZSBwcm9wZXJ0aWVzIGZyb20gc2NoZW1hXG4gKiBAcGFyYW0gY29sdW1uT3ZlcnJpZGVzIC0gQ29sdW1uIG92ZXJyaWRlcyBmcm9tIHRhYmxlQ29uZmlnLmNvbHVtbnNcbiAqIEByZXR1cm5zIFByb3BlcnRpZXMgd2l0aCBjb2x1bW4gb3ZlcnJpZGVzIG1lcmdlZFxuICovXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VDb2x1bW5WaXNpYmlsaXR5PFQgZXh0ZW5kcyB7IG5hbWU6IHN0cmluZyB9PihcbiAgICBiYXNlUHJvcGVydGllczogQXJyYXk8VD4sXG4gICAgY29sdW1uT3ZlcnJpZGVzOiBSZWFkb25seUFycmF5PHtcbiAgICAgICAgcmVhZG9ubHkgZmllbGQ6IHN0cmluZztcbiAgICAgICAgcmVhZG9ubHkgdmlzaWJpbGl0eT86IGFueTtcbiAgICAgICAgcmVhZG9ubHkgd2lkdGg/OiBzdHJpbmcgfCBudW1iZXI7XG4gICAgICAgIHJlYWRvbmx5IGZpeGVkPzogJ2xlZnQnIHwgJ3JpZ2h0JztcbiAgICAgICAgcmVhZG9ubHkgZ3JvdXBUaXRsZT86IHN0cmluZztcbiAgICB9PiB8IEFycmF5PHtcbiAgICAgICAgZmllbGQ6IHN0cmluZztcbiAgICAgICAgdmlzaWJpbGl0eT86IGFueTtcbiAgICAgICAgd2lkdGg/OiBzdHJpbmcgfCBudW1iZXI7XG4gICAgICAgIGZpeGVkPzogJ2xlZnQnIHwgJ3JpZ2h0JztcbiAgICAgICAgZ3JvdXBUaXRsZT86IHN0cmluZztcbiAgICB9PiA9IFtdXG4pOiBBcnJheTxUPiB7XG4gICAgY29uc3Qgb3ZlcnJpZGVNYXAgPSBuZXcgTWFwKFxuICAgICAgICBbLi4uY29sdW1uT3ZlcnJpZGVzXS5tYXAoYyA9PiBbYy5maWVsZCwgY10pXG4gICAgKTtcbiAgICBcbiAgICAvLyBWYWxpZGF0aW9uOiBXYXJuIGlmIGNvbHVtbiBvdmVycmlkZSByZWZlcmVuY2VzIG5vbi1leGlzdGVudCBjb2x1bW5cbiAgICBjb2x1bW5PdmVycmlkZXMuZm9yRWFjaChvdmVycmlkZSA9PiB7XG4gICAgICAgIGlmICghYmFzZVByb3BlcnRpZXMuc29tZShwID0+IHAubmFtZSA9PT0gb3ZlcnJpZGUuZmllbGQpKSB7XG4gICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYENvbHVtbiBvdmVycmlkZSBcIiR7b3ZlcnJpZGUuZmllbGR9XCIgbm90IGZvdW5kIGluIHNjaGVtYSBwcm9wZXJ0aWVzLiBUaGlzIG92ZXJyaWRlIHdpbGwgYmUgaWdub3JlZC5gKTtcbiAgICAgICAgfVxuICAgIH0pO1xuICAgIFxuICAgIHJldHVybiBiYXNlUHJvcGVydGllcy5tYXAocHJvcCA9PiB7XG4gICAgICAgIGNvbnN0IG92ZXJyaWRlID0gb3ZlcnJpZGVNYXAuZ2V0KHByb3AubmFtZSk7XG4gICAgICAgIFxuICAgICAgICBpZiAoIW92ZXJyaWRlKSByZXR1cm4gcHJvcDtcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAuLi5wcm9wLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLnZpc2liaWxpdHkgIT09IHVuZGVmaW5lZCAmJiB7IHZpc2liaWxpdHk6IG92ZXJyaWRlLnZpc2liaWxpdHkgfSksXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUud2lkdGggIT09IHVuZGVmaW5lZCAmJiB7IHdpZHRoOiBvdmVycmlkZS53aWR0aCB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS5maXhlZCAhPT0gdW5kZWZpbmVkICYmIHsgZml4ZWQ6IG92ZXJyaWRlLmZpeGVkIH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmdyb3VwVGl0bGUgIT09IHVuZGVmaW5lZCAmJiB7IGdyb3VwVGl0bGU6IG92ZXJyaWRlLmdyb3VwVGl0bGUgfSlcbiAgICAgICAgfTtcbiAgICB9KTtcbn1cbiJdfQ==
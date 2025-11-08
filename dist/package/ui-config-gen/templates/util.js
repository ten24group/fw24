"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRelationFallback = generateRelationFallback;
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
        // Override/add list-specific properties
        const propConfig = {
            ...formatted,
            name: formatted.label || formatted.name, // Ensure name is set for table column header
            dataIndex: `${prop.id}`,
            fieldType: formatted.fieldType || 'text',
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy91aS1jb25maWctZ2VuL3RlbXBsYXRlcy91dGlsLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBbWhCQSw0REFnQkM7QUFFRCxvRkFzUkM7QUFFRCxzRkFrQkM7QUFFRCwwRUFJQztBQUVELDBFQUlDO0FBRUQsMEVBSUM7QUFjRCxzRUFpR0M7QUFrQkQsb0NBd0JDO0FBVUQsb0NBS0M7QUFTRCxvREF3Q0M7QUFTRCxzREF3Q0M7QUEzbUNELHlDQVFzQjtBQUd0QiwyQ0FBOEM7QUFDOUMsdUNBQXlDO0FBcUR6Qzs7R0FFRztBQUNIOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBbUJHO0FBQ0gsTUFBTSx3QkFBd0IsR0FBOEM7SUFDeEUsT0FBTyxFQUFFLElBQUk7SUFDYixRQUFRLEVBQUU7UUFDTiw0Q0FBNEM7UUFDNUMsT0FBTyxFQUFFLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsYUFBYSxDQUFDO1FBQ2xELDRDQUE0QztRQUM1QyxNQUFNLEVBQUUsQ0FBQyxNQUFNLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsU0FBUyxDQUFDO1FBQ3RELHdDQUF3QztRQUN4QyxJQUFJLEVBQUUsQ0FBQyxNQUFNLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxZQUFZLEVBQUUsVUFBVSxDQUFDO0tBQzFEO0lBQ0QsUUFBUSxFQUFFO1FBQ04sMENBQTBDO1FBQzFDLFFBQVEsRUFBRSxPQUFPO1FBQ2pCLFFBQVEsRUFBRSxRQUFRLEVBQUUsYUFBYTtRQUNqQyxTQUFTLEVBQUUsV0FBVyxFQUFFLFVBQVU7UUFDbEMsTUFBTSxFQUFFLFdBQVcsRUFBRSxVQUFVO1FBQy9CLE9BQU8sRUFBRSxTQUFTLEVBQUUsVUFBVTtRQUM5QixPQUFPLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxNQUFNO1FBQ2xDLFVBQVUsRUFBRSxNQUFNLEVBQUUsU0FBUztRQUM3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QU8sY0FBYyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRTtRQUM3QixNQUFNLFFBQVEsR0FBRyxXQUFXLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUU1QyxJQUFJLENBQUMsUUFBUTtZQUFFLE9BQU8sSUFBSSxDQUFDO1FBRTNCLE9BQU87WUFDSCxHQUFHLElBQUk7WUFDUCxHQUFHLENBQUMsUUFBUSxDQUFDLFVBQVUsS0FBSyxTQUFTLElBQUksRUFBRSxVQUFVLEVBQUUsUUFBUSxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQzdFLEdBQUcsQ0FBQyxRQUFRLENBQUMsS0FBSyxLQUFLLFNBQVMsSUFBSSxFQUFFLEtBQUssRUFBRSxRQUFRLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDOUQsR0FBRyxDQUFDLFFBQVEsQ0FBQyxLQUFLLEtBQUssU0FBUyxJQUFJLEVBQUUsS0FBSyxFQUFFLFFBQVEsQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUM5RCxHQUFHLENBQUMsUUFBUSxDQUFDLFVBQVUsS0FBSyxTQUFTLElBQUksRUFBRSxVQUFVLEVBQUUsUUFBUSxDQUFDLFVBQVUsRUFBRSxDQUFDO1NBQ2hGLENBQUM7SUFDTixDQUFDLENBQUMsQ0FBQztBQUNQLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBcbiAgICBCYXNlRW50aXR5U2VydmljZSwgXG4gICAgRmllbGRNZXRhZGF0YSwgXG4gICAgVElPU2NoZW1hQXR0cmlidXRlLCBcbiAgICBpc1NlbGVjdEZpZWxkTWV0YWRhdGEsXG4gICAgU2VsZWN0RmllbGRNZXRhZGF0YSxcbiAgICBFbnRpdHlBdHRyaWJ1dGUsXG4gICAgSVJlbGF0aW9uRmllbGRDb25maWdcbn0gZnJvbSBcIi4uLy4uL2VudGl0eVwiO1xuaW1wb3J0IHR5cGUgeyBJRW50aXR5UGFnZUFjdGlvbiwgVGVtcGxhdGUgfSBmcm9tICcuLi8uLi9lbnRpdHkvYmFzZS1lbnRpdHknO1xuaW1wb3J0IHR5cGUgeyBJQXBwbGljYXRpb25Db25maWcsIElEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25Db25maWcgfSBmcm9tICcuLi8uLi9pbnRlcmZhY2VzL2NvbmZpZyc7XG5pbXBvcnQgeyBEZWZhdWx0TG9nZ2VyIH0gZnJvbSBcIi4uLy4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IHBhc2NhbENhc2UgfSBmcm9tIFwiLi4vLi4vdXRpbHNcIjtcbmltcG9ydCB7IG1ha2VDcmVhdGVFbnRpdHlGb3JtQ29uZmlnIH0gZnJvbSBcIi4vY3JlYXRlLWVudGl0eVwiO1xuaW1wb3J0IHsgbWFrZVZpZXdFbnRpdHlMaXN0Q29uZmlnIH0gZnJvbSBcIi4vbGlzdC1lbnRpdHlcIjtcbmltcG9ydCB7IG1ha2VWaWV3RW50aXR5RGV0YWlsQ29uZmlnIH0gZnJvbSBcIi4vdmlldy1lbnRpdHlcIjtcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTTUFSVCBEVVBMSUNBVEVEIEZJRUxEIERFVEVDVElPTiAtIEVOSEFOQ0VEIEFMR09SSVRITVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbi8qKlxuICogRGV0ZWN0aW9uIHJlc3VsdCB3aXRoIHJpY2ggbWV0YWRhdGFcbiAqL1xuaW50ZXJmYWNlIER1cGxpY2F0ZWRGaWVsZERldGVjdGlvblJlc3VsdCB7XG4gICAgLyoqIFByaW1hcnkgZGlzcGxheSBmaWVsZCBkZXRlY3RlZCAoZS5nLiwgJ3RlYW1OYW1lJykgKi9cbiAgICBwcmltYXJ5RmllbGQ/OiBzdHJpbmc7XG4gICAgXG4gICAgLyoqIEdlbmVyYXRlZCB0ZW1wbGF0ZSBzdHJpbmcgKGUuZy4sICd7dGVhbU5hbWV9JyBvciAne3RlYW1OYW1lfSAoe3RlYW1Db2RlfSknKSAqL1xuICAgIHRlbXBsYXRlPzogc3RyaW5nO1xuICAgIFxuICAgIC8qKiBBbGwgZGV0ZWN0ZWQgZmllbGRzIGJ5IGNhdGVnb3J5ICovXG4gICAgZGV0ZWN0ZWRGaWVsZHM6IHtcbiAgICAgICAgLyoqIERpc3BsYXkgZmllbGRzOiBOYW1lLCBUaXRsZSwgTGFiZWwgKi9cbiAgICAgICAgZGlzcGxheT86IHN0cmluZ1tdO1xuICAgICAgICAvKiogVmlzdWFsIGZpZWxkczogTG9nbywgSW1hZ2UsIEljb24gKi9cbiAgICAgICAgdmlzdWFsPzogc3RyaW5nW107XG4gICAgICAgIC8qKiBNZXRhIGZpZWxkczogQ29kZSwgU2x1ZywgS2V5ICovXG4gICAgICAgIG1ldGE/OiBzdHJpbmdbXTtcbiAgICB9O1xuICAgIFxuICAgIC8qKiBDb25maWRlbmNlIGxldmVsICovXG4gICAgY29uZmlkZW5jZTogJ2hpZ2gnIHwgJ21lZGl1bScgfCAnbG93JztcbiAgICBcbiAgICAvKiogRGV0ZWN0aW9uIG1ldGhvZCB1c2VkICovXG4gICAgbWV0aG9kOiBzdHJpbmc7XG4gICAgXG4gICAgLyoqIFBhdHRlcm4gdGhhdCBtYXRjaGVkICovXG4gICAgcGF0dGVybjogc3RyaW5nO1xufVxuXG4vKipcbiAqIFBhcnNlZCBjb21wb25lbnRzIGZyb20gcmVsYXRpb24gZmllbGQgbmFtZVxuICovXG5pbnRlcmZhY2UgUGFyc2VkUmVsYXRpb25GaWVsZCB7XG4gICAgLyoqIFByZWZpeCAoZS5nLiwgJ2hvbWUnLCAnYXdheScsICdjb21wZXRpdG9yMScpICovXG4gICAgcHJlZml4Pzogc3RyaW5nO1xuICAgIC8qKiBCYXNlIG5hbWUgd2l0aG91dCBwcmVmaXggYW5kICdJZCcgc3VmZml4IChlLmcuLCAnVGVhbScpICovXG4gICAgYmFzZU5hbWU6IHN0cmluZztcbiAgICAvKiogV2hldGhlciBmaWVsZCBlbmRzIHdpdGggJ0lkJyAqL1xuICAgIGhhc0lkU3VmZml4OiBib29sZWFuO1xuICAgIC8qKiBPcmlnaW5hbCBmaWVsZCBuYW1lICovXG4gICAgb3JpZ2luYWxGaWVsZDogc3RyaW5nO1xufVxuXG4vKipcbiAqIFNtYXJ0IGRlZmF1bHQgY29uZmlndXJhdGlvblxuICovXG4vKipcbiAqIEZyYW1ld29yay1sZXZlbCBkZWZhdWx0IGRldGVjdGlvbiBjb25maWcuXG4gKiBDb250YWlucyBPTkxZIGRvbWFpbi1hZ25vc3RpYyBwYXR0ZXJucyB0aGF0IHdvcmsgYWNyb3NzIGFueSBhcHBsaWNhdGlvbi5cbiAqIFxuICogQXBwbGljYXRpb25zIHNob3VsZCBwcm92aWRlIGRvbWFpbi1zcGVjaWZpYyBwcmVmaXhlcyB2aWEgdWlDb25maWdPcHRpb25zLlxuICogXG4gKiBAZXhhbXBsZSBBcHBsaWNhdGlvbi1zcGVjaWZpYyBjb25maWcgKGluIGJhY2tlbmQgaW5kZXgudHMpOlxuICogYGBgdHlwZXNjcmlwdFxuICogY29uc3QgdWlDb25maWdPcHRpb25zID0ge1xuICogICBkdXBsaWNhdGVkRmllbGREZXRlY3Rpb246IHtcbiAqICAgICBwcmVmaXhlczogW1xuICogICAgICAgLy8gRG9tYWluLXNwZWNpZmljIHByZWZpeGVzIGZvciB5b3VyIGFwcFxuICogICAgICAgJ3BsYXllcicsICd0ZWFtJywgJ2xlYWd1ZScsICdzZWFzb24nLCAndmVudWUnLCAnc3BvcnQnLCAgLy8gU3BvcnRzIGFwcFxuICogICAgICAgLy8gT1I6ICdjdXN0b21lcicsICdvcmRlcicsICdwcm9kdWN0JywgJ2ludm9pY2UnICAvLyBFLWNvbW1lcmNlIGFwcFxuICogICAgICAgLy8gT1I6ICdhdXRob3InLCAnYm9vaycsICdwdWJsaXNoZXInLCAnZ2VucmUnICAvLyBMaWJyYXJ5IGFwcFxuICogICAgIF1cbiAqICAgfVxuICogfTtcbiAqIGBgYFxuICovXG5jb25zdCBERUZBVUxUX0RFVEVDVElPTl9DT05GSUc6IFJlcXVpcmVkPElEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25Db25maWc+ID0ge1xuICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgc3VmZml4ZXM6IHtcbiAgICAgICAgLy8gR2VuZXJpYyBkaXNwbGF5IHRleHQgcGF0dGVybnMgKHVuaXZlcnNhbClcbiAgICAgICAgZGlzcGxheTogWydOYW1lJywgJ1RpdGxlJywgJ0xhYmVsJywgJ0Rpc3BsYXlOYW1lJ10sXG4gICAgICAgIC8vIEdlbmVyaWMgdmlzdWFsIGFzc2V0IHBhdHRlcm5zICh1bml2ZXJzYWwpXG4gICAgICAgIHZpc3VhbDogWydMb2dvJywgJ0ltYWdlJywgJ0ljb24nLCAnQXZhdGFyJywgJ1BpY3R1cmUnXSxcbiAgICAgICAgLy8gR2VuZXJpYyBtZXRhZGF0YSBwYXR0ZXJucyAodW5pdmVyc2FsKVxuICAgICAgICBtZXRhOiBbJ0NvZGUnLCAnU2x1ZycsICdLZXknLCAnSWRlbnRpZmllcicsICdSZW1vdGVJZCddXG4gICAgfSxcbiAgICBwcmVmaXhlczogW1xuICAgICAgICAvLyBHZW5lcmljIHJlbGF0aW9uYWwgcGF0dGVybnMgKHVuaXZlcnNhbClcbiAgICAgICAgJ3BhcmVudCcsICdjaGlsZCcsXG4gICAgICAgICdzb3VyY2UnLCAndGFyZ2V0JywgJ2Rlc3RpbmF0aW9uJyxcbiAgICAgICAgJ3ByaW1hcnknLCAnc2Vjb25kYXJ5JywgJ3RlcnRpYXJ5JyxcbiAgICAgICAgJ21haW4nLCAnYWx0ZXJuYXRlJywgJ2ZhbGxiYWNrJyxcbiAgICAgICAgJ293bmVyJywgJ2NyZWF0b3InLCAnbW9kaWZpZXInLFxuICAgICAgICAnZmlyc3QnLCAnc2Vjb25kJywgJ3RoaXJkJywgJ2xhc3QnLFxuICAgICAgICAncHJldmlvdXMnLCAnbmV4dCcsICdjdXJyZW50JyxcbiAgICAgICAgJ29sZCcsICduZXcnLFxuICAgICAgICAnb3JpZ2luYWwnLCAnY29weScsICdkcmFmdCcsXG4gICAgICAgIFxuICAgICAgICAvLyBHZW5lcmljIGRpcmVjdGlvbmFsIHBhdHRlcm5zICh1bml2ZXJzYWwpXG4gICAgICAgICdob21lJywgJ2F3YXknLFxuICAgICAgICAnbGVmdCcsICdyaWdodCcsXG4gICAgICAgICd0b3AnLCAnYm90dG9tJyxcbiAgICAgICAgJ2lubmVyJywgJ291dGVyJyxcbiAgICAgICAgXG4gICAgICAgIC8vIEdlbmVyaWMgY29tcGV0aXRpdmUgcGF0dGVybnMgKHVuaXZlcnNhbClcbiAgICAgICAgJ3dpbm5lcicsICdsb3NlcicsXG4gICAgICAgICdjb21wZXRpdG9yJywgJ29wcG9uZW50J1xuICAgICAgICBcbiAgICAgICAgLy8gTk9URTogRG9tYWluLXNwZWNpZmljIHByZWZpeGVzIChwbGF5ZXIsIHRlYW0sIGN1c3RvbWVyLCBvcmRlciwgZXRjLilcbiAgICAgICAgLy8gc2hvdWxkIGJlIHByb3ZpZGVkIHZpYSB1aUNvbmZpZ09wdGlvbnMgaW4geW91ciBhcHBsaWNhdGlvbidzIGJhY2tlbmRcbiAgICBdLFxuICAgIHRlbXBsYXRlU3R5bGU6ICdzaW1wbGUnLFxuICAgIGNvbmZpZGVuY2VUaHJlc2hvbGQ6ICdtZWRpdW0nLFxuICAgIGRlYnVnOiBmYWxzZVxufTtcblxuLyoqXG4gKiBNZXJnZSBjb25maWd1cmF0aW9ucyB3aXRoIHByaW9yaXR5OiBoaW50cyA+IGVudGl0eSA+IGdsb2JhbCA+IGRlZmF1bHRzXG4gKi9cbmZ1bmN0aW9uIG1lcmdlRGV0ZWN0aW9uQ29uZmlncyhcbiAgICBnbG9iYWxDb25maWc/OiBJRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uQ29uZmlnLFxuICAgIGVudGl0eUNvbmZpZz86IElEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25Db25maWcsXG4gICAgcmVsYXRpb25IaW50cz86IHtcbiAgICAgICAgcHJlZmVycmVkRmllbGRzPzogc3RyaW5nW107XG4gICAgICAgIGV4Y2x1ZGVGaWVsZHM/OiBzdHJpbmdbXTtcbiAgICAgICAgdGVtcGxhdGVTdHlsZT86ICdzaW1wbGUnIHwgJ2NvbXBvc2l0ZSc7XG4gICAgfVxuKTogUmVxdWlyZWQ8SUR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbkNvbmZpZz4gJiB7IHByZWZlcnJlZEZpZWxkcz86IHN0cmluZ1tdOyBleGNsdWRlRmllbGRzPzogc3RyaW5nW10gfSB7XG4gICAgLy8gU3RhcnQgd2l0aCBkZWZhdWx0c1xuICAgIGxldCBtZXJnZWQgPSB7IC4uLkRFRkFVTFRfREVURUNUSU9OX0NPTkZJRyB9O1xuICAgIFxuICAgIC8vIEFwcGx5IGdsb2JhbCBjb25maWdcbiAgICBpZiAoZ2xvYmFsQ29uZmlnKSB7XG4gICAgICAgIG1lcmdlZCA9IHtcbiAgICAgICAgICAgIC4uLm1lcmdlZCxcbiAgICAgICAgICAgIC4uLmdsb2JhbENvbmZpZyxcbiAgICAgICAgICAgIHN1ZmZpeGVzOiB7IC4uLm1lcmdlZC5zdWZmaXhlcywgLi4uZ2xvYmFsQ29uZmlnLnN1ZmZpeGVzIH0sXG4gICAgICAgICAgICBwcmVmaXhlczogZ2xvYmFsQ29uZmlnLnByZWZpeGVzIHx8IG1lcmdlZC5wcmVmaXhlc1xuICAgICAgICB9O1xuICAgIH1cbiAgICBcbiAgICAvLyBBcHBseSBlbnRpdHkgY29uZmlnIChoaWdoZXIgcHJpb3JpdHkpXG4gICAgaWYgKGVudGl0eUNvbmZpZykge1xuICAgICAgICBtZXJnZWQgPSB7XG4gICAgICAgICAgICAuLi5tZXJnZWQsXG4gICAgICAgICAgICAuLi5lbnRpdHlDb25maWcsXG4gICAgICAgICAgICBzdWZmaXhlczogeyAuLi5tZXJnZWQuc3VmZml4ZXMsIC4uLmVudGl0eUNvbmZpZy5zdWZmaXhlcyB9LFxuICAgICAgICAgICAgcHJlZml4ZXM6IGVudGl0eUNvbmZpZy5wcmVmaXhlcyB8fCBtZXJnZWQucHJlZml4ZXNcbiAgICAgICAgfTtcbiAgICB9XG4gICAgXG4gICAgLy8gQXBwbHkgcmVsYXRpb24gaGludHMgKGhpZ2hlc3QgcHJpb3JpdHkpXG4gICAgY29uc3QgcmVzdWx0OiBhbnkgPSB7IC4uLm1lcmdlZCB9O1xuICAgIGlmIChyZWxhdGlvbkhpbnRzKSB7XG4gICAgICAgIGlmIChyZWxhdGlvbkhpbnRzLnRlbXBsYXRlU3R5bGUpIHtcbiAgICAgICAgICAgIHJlc3VsdC50ZW1wbGF0ZVN0eWxlID0gcmVsYXRpb25IaW50cy50ZW1wbGF0ZVN0eWxlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChyZWxhdGlvbkhpbnRzLnByZWZlcnJlZEZpZWxkcykge1xuICAgICAgICAgICAgcmVzdWx0LnByZWZlcnJlZEZpZWxkcyA9IHJlbGF0aW9uSGludHMucHJlZmVycmVkRmllbGRzO1xuICAgICAgICB9XG4gICAgICAgIGlmIChyZWxhdGlvbkhpbnRzLmV4Y2x1ZGVGaWVsZHMpIHtcbiAgICAgICAgICAgIHJlc3VsdC5leGNsdWRlRmllbGRzID0gcmVsYXRpb25IaW50cy5leGNsdWRlRmllbGRzO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIHJldHVybiByZXN1bHQ7XG59XG5cbi8qKlxuICogUGFyc2UgcmVsYXRpb24gZmllbGQgdG8gZXh0cmFjdCBwcmVmaXggYW5kIGJhc2UgbmFtZS5cbiAqIFxuICogRXhhbXBsZXM6XG4gKiAtICd0ZWFtSWQnIOKGkiB7IGJhc2VOYW1lOiAnVGVhbScsIGhhc0lkU3VmZml4OiB0cnVlIH1cbiAqIC0gJ2hvbWVUZWFtSWQnIOKGkiB7IHByZWZpeDogJ2hvbWUnLCBiYXNlTmFtZTogJ1RlYW0nLCBoYXNJZFN1ZmZpeDogdHJ1ZSB9XG4gKiAtICdjb21wZXRpdG9yMVRlYW1JZCcg4oaSIHsgcHJlZml4OiAnY29tcGV0aXRvcjEnLCBiYXNlTmFtZTogJ1RlYW0nLCBoYXNJZFN1ZmZpeDogdHJ1ZSB9XG4gKiAtICdzcG9ydCcg4oaSIHsgYmFzZU5hbWU6ICdzcG9ydCcsIGhhc0lkU3VmZml4OiBmYWxzZSB9XG4gKi9cbmZ1bmN0aW9uIHBhcnNlUmVsYXRpb25GaWVsZChcbiAgICBmaWVsZElkOiBzdHJpbmcsXG4gICAgcHJlZml4ZXM6IHN0cmluZ1tdXG4pOiBQYXJzZWRSZWxhdGlvbkZpZWxkIHtcbiAgICAvLyBCdWlsZCByZWdleCBmb3IgcHJlZml4IGRldGVjdGlvbjogXihwcmVmaXgxfHByZWZpeDJ8Li4uKShcXFxcZCopKC4rKSRcbiAgICAvLyBVc2UgY2FzZS1pbnNlbnNpdGl2ZSBtYXRjaGluZ1xuICAgIGNvbnN0IHByZWZpeFBhdHRlcm4gPSBuZXcgUmVnRXhwKFxuICAgICAgICBgXigke3ByZWZpeGVzLmpvaW4oJ3wnKX0pKFxcXFxkKikoLispJGAsXG4gICAgICAgICdpJ1xuICAgICk7XG4gICAgXG4gICAgY29uc3QgbWF0Y2ggPSBmaWVsZElkLm1hdGNoKHByZWZpeFBhdHRlcm4pO1xuICAgIFxuICAgIGlmIChtYXRjaCkge1xuICAgICAgICBjb25zdCBbLCBwcmVmaXgsIG51bSwgcmVzdF0gPSBtYXRjaDtcbiAgICAgICAgY29uc3QgaGFzSWRTdWZmaXggPSByZXN0LnRvTG93ZXJDYXNlKCkuZW5kc1dpdGgoJ2lkJyk7XG4gICAgICAgIGNvbnN0IGJhc2VOYW1lID0gaGFzSWRTdWZmaXggXG4gICAgICAgICAgICA/IHJlc3Quc3Vic3RyaW5nKDAsIHJlc3QubGVuZ3RoIC0gMilcbiAgICAgICAgICAgIDogcmVzdDtcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBwcmVmaXg6IHByZWZpeCArIG51bSwgIC8vICdob21lJyBvciAnY29tcGV0aXRvcjEnXG4gICAgICAgICAgICBiYXNlTmFtZSxcbiAgICAgICAgICAgIGhhc0lkU3VmZml4LFxuICAgICAgICAgICAgb3JpZ2luYWxGaWVsZDogZmllbGRJZFxuICAgICAgICB9O1xuICAgIH1cbiAgICBcbiAgICAvLyBObyBwcmVmaXggZGV0ZWN0ZWRcbiAgICBjb25zdCBoYXNJZFN1ZmZpeCA9IGZpZWxkSWQudG9Mb3dlckNhc2UoKS5lbmRzV2l0aCgnaWQnKTtcbiAgICBjb25zdCBiYXNlTmFtZSA9IGhhc0lkU3VmZml4IFxuICAgICAgICA/IGZpZWxkSWQuc3Vic3RyaW5nKDAsIGZpZWxkSWQubGVuZ3RoIC0gMilcbiAgICAgICAgOiBmaWVsZElkO1xuICAgIFxuICAgIHJldHVybiB7XG4gICAgICAgIGJhc2VOYW1lLFxuICAgICAgICBoYXNJZFN1ZmZpeCxcbiAgICAgICAgb3JpZ2luYWxGaWVsZDogZmllbGRJZFxuICAgIH07XG59XG5cbi8qKlxuICogR2VuZXJhdGUgc2VhcmNoIHBhdHRlcm5zIGZvciBjYW5kaWRhdGUgZmllbGQgbmFtZXMuXG4gKiBcbiAqIFByaW9yaXR5OlxuICogMS4gUHJlZmVycmVkIGZpZWxkcyAoZnJvbSBoaW50cylcbiAqIDIuIEV4YWN0IHByZWZpeCBtYXRjaDoge3ByZWZpeH17YmFzZU5hbWV9e3N1ZmZpeH1cbiAqIDMuIEVudGl0eSBuYW1lIG1hdGNoOiB7ZW50aXR5TmFtZX17c3VmZml4fVxuICogNC4gQmFzZSBuYW1lIG1hdGNoOiB7YmFzZU5hbWV9e3N1ZmZpeH1cbiAqL1xuZnVuY3Rpb24gZ2VuZXJhdGVTZWFyY2hQYXR0ZXJucyhcbiAgICBwYXJzZWQ6IFBhcnNlZFJlbGF0aW9uRmllbGQsXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLFxuICAgIHN1ZmZpeGVzOiBzdHJpbmdbXSxcbiAgICBwcmVmZXJyZWRGaWVsZHM/OiBzdHJpbmdbXVxuKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IHBhdHRlcm5zOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IGVudGl0eU5hbWVMb3dlciA9IGVudGl0eU5hbWUudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBiYXNlTmFtZUxvd2VyID0gcGFyc2VkLmJhc2VOYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgXG4gICAgLy8gUHJpb3JpdHkgMTogUHJlZmVycmVkIGZpZWxkcyAoZXhhY3QgbWF0Y2gpXG4gICAgaWYgKHByZWZlcnJlZEZpZWxkcyAmJiBwcmVmZXJyZWRGaWVsZHMubGVuZ3RoID4gMCkge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKC4uLnByZWZlcnJlZEZpZWxkcyk7XG4gICAgfVxuICAgIFxuICAgIC8vIFByaW9yaXR5IDI6IFdpdGggcHJlZml4IChlLmcuLCBob21lVGVhbU5hbWUsIGF3YXlUZWFtTmFtZSlcbiAgICBpZiAocGFyc2VkLnByZWZpeCkge1xuICAgICAgICBjb25zdCBwcmVmaXhMb3dlciA9IHBhcnNlZC5wcmVmaXgudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgZm9yIChjb25zdCBzdWZmaXggb2Ygc3VmZml4ZXMpIHtcbiAgICAgICAgICAgIHBhdHRlcm5zLnB1c2goYCR7cHJlZml4TG93ZXJ9JHtiYXNlTmFtZUxvd2VyfSR7c3VmZml4LnRvTG93ZXJDYXNlKCl9YCk7XG4gICAgICAgICAgICBwYXR0ZXJucy5wdXNoKGAke3ByZWZpeExvd2VyfSR7ZW50aXR5TmFtZUxvd2VyfSR7c3VmZml4LnRvTG93ZXJDYXNlKCl9YCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLy8gUHJpb3JpdHkgMzogRW50aXR5IG5hbWUgKGUuZy4sIHRlYW1OYW1lIGZvciByZWxhdGlvbiB0byAndGVhbScpXG4gICAgZm9yIChjb25zdCBzdWZmaXggb2Ygc3VmZml4ZXMpIHtcbiAgICAgICAgcGF0dGVybnMucHVzaChgJHtlbnRpdHlOYW1lTG93ZXJ9JHtzdWZmaXgudG9Mb3dlckNhc2UoKX1gKTtcbiAgICB9XG4gICAgXG4gICAgLy8gUHJpb3JpdHkgNDogQmFzZSBuYW1lIChlLmcuLCB0ZWFtTmFtZSBmb3IgJ3RlYW1JZCcpXG4gICAgZm9yIChjb25zdCBzdWZmaXggb2Ygc3VmZml4ZXMpIHtcbiAgICAgICAgcGF0dGVybnMucHVzaChgJHtiYXNlTmFtZUxvd2VyfSR7c3VmZml4LnRvTG93ZXJDYXNlKCl9YCk7XG4gICAgfVxuICAgIFxuICAgIHJldHVybiBwYXR0ZXJucztcbn1cblxuLyoqXG4gKiBTZWFyY2ggZm9yIGZpZWxkcyBtYXRjaGluZyBwYXR0ZXJucywgZXhjbHVkaW5nIHNwZWNpZmllZCBmaWVsZHMuXG4gKi9cbmZ1bmN0aW9uIHNlYXJjaEZpZWxkc0J5UGF0dGVybnMoXG4gICAgYWxsUHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sXG4gICAgcGF0dGVybnM6IHN0cmluZ1tdLFxuICAgIGV4Y2x1ZGVGaWVsZHM/OiBzdHJpbmdbXVxuKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IGV4Y2x1ZGVTZXQgPSBuZXcgU2V0KGV4Y2x1ZGVGaWVsZHM/Lm1hcChmID0+IGYudG9Mb3dlckNhc2UoKSkgfHwgW10pO1xuICAgIGNvbnN0IGZvdW5kOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IHNlZW5Mb3dlciA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgIFxuICAgIGZvciAoY29uc3QgcGF0dGVybiBvZiBwYXR0ZXJucykge1xuICAgICAgICBjb25zdCBwYXR0ZXJuTG93ZXIgPSBwYXR0ZXJuLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIFxuICAgICAgICAvLyBTa2lwIGlmIGFscmVhZHkgZm91bmQgb3IgZXhjbHVkZWRcbiAgICAgICAgaWYgKHNlZW5Mb3dlci5oYXMocGF0dGVybkxvd2VyKSB8fCBleGNsdWRlU2V0LmhhcyhwYXR0ZXJuTG93ZXIpKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gRmluZCBtYXRjaGluZyBmaWVsZCAoY2FzZS1pbnNlbnNpdGl2ZSlcbiAgICAgICAgY29uc3QgbWF0Y2ggPSBhbGxQcm9wZXJ0aWVzLmZpbmQocCA9PiBcbiAgICAgICAgICAgIHAuaWQ/LnRvTG93ZXJDYXNlKCkgPT09IHBhdHRlcm5Mb3dlciAmJlxuICAgICAgICAgICAgIWV4Y2x1ZGVTZXQuaGFzKHAuaWQudG9Mb3dlckNhc2UoKSlcbiAgICAgICAgKTtcbiAgICAgICAgXG4gICAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICAgICAgZm91bmQucHVzaChtYXRjaC5pZCk7XG4gICAgICAgICAgICBzZWVuTG93ZXIuYWRkKG1hdGNoLmlkLnRvTG93ZXJDYXNlKCkpO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIHJldHVybiBmb3VuZDtcbn1cblxuLyoqXG4gKiBDYWxjdWxhdGUgY29uZmlkZW5jZSBiYXNlZCBvbiBkZXRlY3Rpb24gbWV0aG9kIGFuZCBwYXR0ZXJuXG4gKi9cbmZ1bmN0aW9uIGNhbGN1bGF0ZUNvbmZpZGVuY2UoXG4gICAgZGV0ZWN0ZWRGaWVsZDogc3RyaW5nLFxuICAgIHBhcnNlZDogUGFyc2VkUmVsYXRpb25GaWVsZCxcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgbWV0aG9kOiAncHJlZmVycmVkJyB8ICdwcmVmaXgnIHwgJ2VudGl0eScgfCAnYmFzZSdcbik6ICdoaWdoJyB8ICdtZWRpdW0nIHwgJ2xvdycge1xuICAgIC8vIFByZWZlcnJlZCBmaWVsZHMgPSBoaWdoIGNvbmZpZGVuY2UgKGRldmVsb3BlciBleHBsaWNpdGx5IHNwZWNpZmllZClcbiAgICBpZiAobWV0aG9kID09PSAncHJlZmVycmVkJykgcmV0dXJuICdoaWdoJztcbiAgICBcbiAgICBjb25zdCBmaWVsZExvd2VyID0gZGV0ZWN0ZWRGaWVsZC50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IGVudGl0eUxvd2VyID0gZW50aXR5TmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IGJhc2VMb3dlciA9IHBhcnNlZC5iYXNlTmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgIFxuICAgIC8vIEV4YWN0IHByZWZpeCArIGVudGl0eS9iYXNlIG1hdGNoID0gaGlnaFxuICAgIGlmIChtZXRob2QgPT09ICdwcmVmaXgnKSB7XG4gICAgICAgIGlmIChmaWVsZExvd2VyLmluY2x1ZGVzKGVudGl0eUxvd2VyKSB8fCBmaWVsZExvd2VyLmluY2x1ZGVzKGJhc2VMb3dlcikpIHtcbiAgICAgICAgICAgIHJldHVybiAnaGlnaCc7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICdtZWRpdW0nO1xuICAgIH1cbiAgICBcbiAgICAvLyBFbnRpdHkgbmFtZSBtYXRjaCA9IGhpZ2hcbiAgICBpZiAobWV0aG9kID09PSAnZW50aXR5JykgcmV0dXJuICdoaWdoJztcbiAgICBcbiAgICAvLyBCYXNlIG5hbWUgbWF0Y2ggPSBtZWRpdW0gKGNvdWxkIGJlIGNvaW5jaWRlbnRhbClcbiAgICBpZiAobWV0aG9kID09PSAnYmFzZScpIHJldHVybiAnbWVkaXVtJztcbiAgICBcbiAgICByZXR1cm4gJ2xvdyc7XG59XG5cbi8qKlxuICogR2VuZXJhdGUgdGVtcGxhdGUgc3RyaW5nIGZyb20gZGV0ZWN0ZWQgZmllbGRzLlxuICovXG5mdW5jdGlvbiBnZW5lcmF0ZVRlbXBsYXRlKFxuICAgIHByaW1hcnlGaWVsZDogc3RyaW5nLFxuICAgIGFsbERldGVjdGVkRmllbGRzOiBEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25SZXN1bHRbJ2RldGVjdGVkRmllbGRzJ10sXG4gICAgdGVtcGxhdGVTdHlsZTogJ3NpbXBsZScgfCAnY29tcG9zaXRlJ1xuKTogc3RyaW5nIHtcbiAgICBpZiAodGVtcGxhdGVTdHlsZSA9PT0gJ3NpbXBsZScpIHtcbiAgICAgICAgcmV0dXJuIGB7JHtwcmltYXJ5RmllbGR9fWA7XG4gICAgfVxuICAgIFxuICAgIC8vIENvbXBvc2l0ZTogdHJ5IHRvIGluY2x1ZGUgbWV0YSBmaWVsZCAoY29kZS9zbHVnKSBpZiBhdmFpbGFibGVcbiAgICBpZiAodGVtcGxhdGVTdHlsZSA9PT0gJ2NvbXBvc2l0ZScgJiYgYWxsRGV0ZWN0ZWRGaWVsZHMubWV0YSAmJiBhbGxEZXRlY3RlZEZpZWxkcy5tZXRhLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgbWV0YUZpZWxkID0gYWxsRGV0ZWN0ZWRGaWVsZHMubWV0YVswXTtcbiAgICAgICAgcmV0dXJuIGB7JHtwcmltYXJ5RmllbGR9fSAoeyR7bWV0YUZpZWxkfX0pYDtcbiAgICB9XG4gICAgXG4gICAgLy8gRmFsbGJhY2sgdG8gc2ltcGxlIGlmIG5vIG1ldGEgZmllbGRcbiAgICByZXR1cm4gYHske3ByaW1hcnlGaWVsZH19YDtcbn1cblxuLyoqXG4gKiBFbmhhbmNlZCBzbWFydCBkdXBsaWNhdGVkIGZpZWxkIGRldGVjdGlvbi5cbiAqIFxuICogRGV0ZWN0cyBmaWVsZHMgbGlrZSAndGVhbU5hbWUnIGZvciAndGVhbUlkJyByZWxhdGlvbnMgd2l0aCBzdXBwb3J0IGZvcjpcbiAqIC0gUHJlZml4ZXMgKGhvbWUsIGF3YXksIGNvbXBldGl0b3IxLCBldGMuKVxuICogLSBNdWx0aXBsZSBzdWZmaXhlcyAoTmFtZSwgVGl0bGUsIExhYmVsLCBMb2dvLCBDb2RlLCBldGMuKVxuICogLSBQcmVmZXJyZWQgZmllbGRzIGFuZCBleGNsdXNpb25zXG4gKiAtIENvbmZpZGVuY2Ugc2NvcmluZ1xuICogLSBDb21wb3NpdGUgdGVtcGxhdGVzXG4gKiBcbiAqIEBwYXJhbSBhbGxQcm9wZXJ0aWVzIC0gQWxsIHByb3BlcnRpZXMgaW4gdGhlIHBhcmVudCBlbnRpdHlcbiAqIEBwYXJhbSByZWxhdGlvbkZpZWxkSWQgLSBUaGUgcmVsYXRpb24gZmllbGQgbmFtZSAoZS5nLiwgJ3RlYW1JZCcsICdob21lVGVhbUlkJylcbiAqIEBwYXJhbSByZWxhdGVkRW50aXR5TmFtZSAtIFJlbGF0ZWQgZW50aXR5IG5hbWUgKGUuZy4sICd0ZWFtJylcbiAqIEBwYXJhbSBnbG9iYWxDb25maWcgLSBHbG9iYWwgZGV0ZWN0aW9uIGNvbmZpZ3VyYXRpb25cbiAqIEBwYXJhbSBlbnRpdHlDb25maWcgLSBFbnRpdHktbGV2ZWwgZGV0ZWN0aW9uIGNvbmZpZ3VyYXRpb25cbiAqIEBwYXJhbSByZWxhdGlvbkhpbnRzIC0gUmVsYXRpb24tc3BlY2lmaWMgaGludHNcbiAqIEByZXR1cm5zIERldGVjdGlvbiByZXN1bHQgd2l0aCB0ZW1wbGF0ZSBhbmQgbWV0YWRhdGFcbiAqL1xuZnVuY3Rpb24gZGV0ZWN0RHVwbGljYXRlZFJlbGF0aW9uRmllbGRzKFxuICAgIGFsbFByb3BlcnRpZXM6IFRJT1NjaGVtYUF0dHJpYnV0ZVtdLFxuICAgIHJlbGF0aW9uRmllbGRJZDogc3RyaW5nLFxuICAgIHJlbGF0ZWRFbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgZ2xvYmFsQ29uZmlnPzogSUR1cGxpY2F0ZWRGaWVsZERldGVjdGlvbkNvbmZpZyxcbiAgICBlbnRpdHlDb25maWc/OiBJRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uQ29uZmlnLFxuICAgIHJlbGF0aW9uSGludHM/OiB7XG4gICAgICAgIHByZWZlcnJlZEZpZWxkcz86IHN0cmluZ1tdO1xuICAgICAgICBleGNsdWRlRmllbGRzPzogc3RyaW5nW107XG4gICAgICAgIHRlbXBsYXRlU3R5bGU/OiAnc2ltcGxlJyB8ICdjb21wb3NpdGUnO1xuICAgIH1cbik6IER1cGxpY2F0ZWRGaWVsZERldGVjdGlvblJlc3VsdCB8IHVuZGVmaW5lZCB7XG4gICAgLy8gTWVyZ2UgY29uZmlndXJhdGlvbnNcbiAgICBjb25zdCBjb25maWcgPSBtZXJnZURldGVjdGlvbkNvbmZpZ3MoZ2xvYmFsQ29uZmlnLCBlbnRpdHlDb25maWcsIHJlbGF0aW9uSGludHMpO1xuICAgIFxuICAgIC8vIENoZWNrIGlmIGRldGVjdGlvbiBpcyBlbmFibGVkXG4gICAgaWYgKCFjb25maWcuZW5hYmxlZCkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBcbiAgICAvLyBQYXJzZSByZWxhdGlvbiBmaWVsZFxuICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlUmVsYXRpb25GaWVsZChyZWxhdGlvbkZpZWxkSWQsIGNvbmZpZy5wcmVmaXhlcyk7XG4gICAgXG4gICAgLy8gU2VhcmNoIGZvciBkaXNwbGF5IGZpZWxkcyAoTmFtZSwgVGl0bGUsIExhYmVsKVxuICAgIGNvbnN0IGRpc3BsYXlQYXR0ZXJucyA9IGdlbmVyYXRlU2VhcmNoUGF0dGVybnMoXG4gICAgICAgIHBhcnNlZCxcbiAgICAgICAgcmVsYXRlZEVudGl0eU5hbWUsXG4gICAgICAgIGNvbmZpZy5zdWZmaXhlcz8uZGlzcGxheSB8fCBbXSxcbiAgICAgICAgY29uZmlnLnByZWZlcnJlZEZpZWxkc1xuICAgICk7XG4gICAgY29uc3QgZGlzcGxheUZpZWxkcyA9IHNlYXJjaEZpZWxkc0J5UGF0dGVybnMoYWxsUHJvcGVydGllcywgZGlzcGxheVBhdHRlcm5zLCBjb25maWcuZXhjbHVkZUZpZWxkcyk7XG4gICAgXG4gICAgLy8gU2VhcmNoIGZvciB2aXN1YWwgZmllbGRzIChMb2dvLCBJbWFnZSwgSWNvbilcbiAgICBjb25zdCB2aXN1YWxQYXR0ZXJucyA9IGdlbmVyYXRlU2VhcmNoUGF0dGVybnMoXG4gICAgICAgIHBhcnNlZCxcbiAgICAgICAgcmVsYXRlZEVudGl0eU5hbWUsXG4gICAgICAgIGNvbmZpZy5zdWZmaXhlcz8udmlzdWFsIHx8IFtdXG4gICAgKTtcbiAgICBjb25zdCB2aXN1YWxGaWVsZHMgPSBzZWFyY2hGaWVsZHNCeVBhdHRlcm5zKGFsbFByb3BlcnRpZXMsIHZpc3VhbFBhdHRlcm5zLCBjb25maWcuZXhjbHVkZUZpZWxkcyk7XG4gICAgXG4gICAgLy8gU2VhcmNoIGZvciBtZXRhIGZpZWxkcyAoQ29kZSwgU2x1ZywgS2V5KVxuICAgIGNvbnN0IG1ldGFQYXR0ZXJucyA9IGdlbmVyYXRlU2VhcmNoUGF0dGVybnMoXG4gICAgICAgIHBhcnNlZCxcbiAgICAgICAgcmVsYXRlZEVudGl0eU5hbWUsXG4gICAgICAgIGNvbmZpZy5zdWZmaXhlcz8ubWV0YSB8fCBbXVxuICAgICk7XG4gICAgY29uc3QgbWV0YUZpZWxkcyA9IHNlYXJjaEZpZWxkc0J5UGF0dGVybnMoYWxsUHJvcGVydGllcywgbWV0YVBhdHRlcm5zLCBjb25maWcuZXhjbHVkZUZpZWxkcyk7XG4gICAgXG4gICAgLy8gTm8gZmllbGRzIGRldGVjdGVkXG4gICAgaWYgKGRpc3BsYXlGaWVsZHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIFxuICAgIC8vIERldGVybWluZSBkZXRlY3Rpb24gbWV0aG9kXG4gICAgY29uc3QgcHJpbWFyeUZpZWxkID0gZGlzcGxheUZpZWxkc1swXTtcbiAgICBsZXQgbWV0aG9kOiAncHJlZmVycmVkJyB8ICdwcmVmaXgnIHwgJ2VudGl0eScgfCAnYmFzZScgPSAnYmFzZSc7XG4gICAgbGV0IHBhdHRlcm4gPSAndW5rbm93bic7XG4gICAgXG4gICAgaWYgKGNvbmZpZy5wcmVmZXJyZWRGaWVsZHMgJiYgY29uZmlnLnByZWZlcnJlZEZpZWxkcy5pbmNsdWRlcyhwcmltYXJ5RmllbGQpKSB7XG4gICAgICAgIG1ldGhvZCA9ICdwcmVmZXJyZWQnO1xuICAgICAgICBwYXR0ZXJuID0gJ3ByZWZlcnJlZF9maWVsZCc7XG4gICAgfSBlbHNlIGlmIChwYXJzZWQucHJlZml4ICYmIHByaW1hcnlGaWVsZC50b0xvd2VyQ2FzZSgpLnN0YXJ0c1dpdGgocGFyc2VkLnByZWZpeC50b0xvd2VyQ2FzZSgpKSkge1xuICAgICAgICBtZXRob2QgPSAncHJlZml4JztcbiAgICAgICAgcGF0dGVybiA9IGAke3BhcnNlZC5wcmVmaXh9e2VudGl0eX17c3VmZml4fWA7XG4gICAgfSBlbHNlIGlmIChwcmltYXJ5RmllbGQudG9Mb3dlckNhc2UoKS5zdGFydHNXaXRoKHJlbGF0ZWRFbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCkpKSB7XG4gICAgICAgIG1ldGhvZCA9ICdlbnRpdHknO1xuICAgICAgICBwYXR0ZXJuID0gYHtlbnRpdHl9e3N1ZmZpeH1gO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIG1ldGhvZCA9ICdiYXNlJztcbiAgICAgICAgcGF0dGVybiA9IGB7YmFzZX17c3VmZml4fWA7XG4gICAgfVxuICAgIFxuICAgIC8vIENhbGN1bGF0ZSBjb25maWRlbmNlXG4gICAgY29uc3QgY29uZmlkZW5jZSA9IGNhbGN1bGF0ZUNvbmZpZGVuY2UocHJpbWFyeUZpZWxkLCBwYXJzZWQsIHJlbGF0ZWRFbnRpdHlOYW1lLCBtZXRob2QpO1xuICAgIFxuICAgIC8vIENoZWNrIGNvbmZpZGVuY2UgdGhyZXNob2xkXG4gICAgY29uc3QgdGhyZXNob2xkT3JkZXIgPSB7IGxvdzogMCwgbWVkaXVtOiAxLCBoaWdoOiAyIH07XG4gICAgaWYgKHRocmVzaG9sZE9yZGVyW2NvbmZpZGVuY2VdIDwgdGhyZXNob2xkT3JkZXJbY29uZmlnLmNvbmZpZGVuY2VUaHJlc2hvbGRdKSB7XG4gICAgICAgIC8vIENvbmZpZGVuY2UgdG9vIGxvd1xuICAgICAgICBpZiAoY29uZmlnLmRlYnVnKSB7XG4gICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLmluZm8oYFtEdXBsaWNhdGVkRmllbGREZXRlY3Rpb25dIFNraXBwaW5nICR7cmVsYXRpb25GaWVsZElkfTogY29uZmlkZW5jZSAke2NvbmZpZGVuY2V9IDwgdGhyZXNob2xkICR7Y29uZmlnLmNvbmZpZGVuY2VUaHJlc2hvbGR9YCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgXG4gICAgLy8gR2VuZXJhdGUgdGVtcGxhdGVcbiAgICBjb25zdCB0ZW1wbGF0ZSA9IGdlbmVyYXRlVGVtcGxhdGUoXG4gICAgICAgIHByaW1hcnlGaWVsZCxcbiAgICAgICAgeyBkaXNwbGF5OiBkaXNwbGF5RmllbGRzLCB2aXN1YWw6IHZpc3VhbEZpZWxkcywgbWV0YTogbWV0YUZpZWxkcyB9LFxuICAgICAgICBjb25maWcudGVtcGxhdGVTdHlsZVxuICAgICk7XG4gICAgXG4gICAgLy8gRGVidWcgbG9nZ2luZ1xuICAgIGlmIChjb25maWcuZGVidWcpIHtcbiAgICAgICAgRGVmYXVsdExvZ2dlci5pbmZvKGBbRHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uXSAke3JlbGF0aW9uRmllbGRJZH0g4oaSICR7dGVtcGxhdGV9IChjb25maWRlbmNlOiAke2NvbmZpZGVuY2V9LCBtZXRob2Q6ICR7bWV0aG9kfSlgKTtcbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIHtcbiAgICAgICAgcHJpbWFyeUZpZWxkLFxuICAgICAgICB0ZW1wbGF0ZSxcbiAgICAgICAgZGV0ZWN0ZWRGaWVsZHM6IHtcbiAgICAgICAgICAgIGRpc3BsYXk6IGRpc3BsYXlGaWVsZHMsXG4gICAgICAgICAgICB2aXN1YWw6IHZpc3VhbEZpZWxkcy5sZW5ndGggPiAwID8gdmlzdWFsRmllbGRzIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgbWV0YTogbWV0YUZpZWxkcy5sZW5ndGggPiAwID8gbWV0YUZpZWxkcyA6IHVuZGVmaW5lZFxuICAgICAgICB9LFxuICAgICAgICBjb25maWRlbmNlLFxuICAgICAgICBtZXRob2QsXG4gICAgICAgIHBhdHRlcm5cbiAgICB9O1xufVxuXG4vKipcbiAqIExlZ2FjeSB3cmFwcGVyIGZ1bmN0aW9uIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5LlxuICogXG4gKiBAZGVwcmVjYXRlZCBVc2UgZGV0ZWN0RHVwbGljYXRlZFJlbGF0aW9uRmllbGRzKCkgZm9yIHJpY2hlciByZXN1bHRzXG4gKi9cbmZ1bmN0aW9uIGRldGVjdER1cGxpY2F0ZWRSZWxhdGlvbkZpZWxkVGVtcGxhdGUoXG4gICAgYWxsUHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sXG4gICAgcmVsYXRpb25GaWVsZElkOiBzdHJpbmcsXG4gICAgcmVsYXRlZEVudGl0eU5hbWU6IHN0cmluZ1xuKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCByZXN1bHQgPSBkZXRlY3REdXBsaWNhdGVkUmVsYXRpb25GaWVsZHMoXG4gICAgICAgIGFsbFByb3BlcnRpZXMsXG4gICAgICAgIHJlbGF0aW9uRmllbGRJZCxcbiAgICAgICAgcmVsYXRlZEVudGl0eU5hbWVcbiAgICApO1xuICAgIHJldHVybiByZXN1bHQ/LnRlbXBsYXRlO1xufVxuXG4vKipcbiAqIEdlbmVyYXRlIHNtYXJ0IGZhbGxiYWNrIGNvbmZpZ3VyYXRpb24gZm9yIHJlbGF0aW9uIGRpc3BsYXkgd2hlbiBvbmx5IElEIGlzIGF2YWlsYWJsZS5cbiAqIFVzZXMgZW50aXR5IG1ldGFkYXRhIChpY29uLCBlbnRpdHlOYW1lUGx1cmFsKSB0byBjcmVhdGUgdXNlci1mcmllbmRseSBmYWxsYmFjayB0ZXh0LlxuICogXG4gKiBAcGFyYW0gZW50aXR5TmFtZSAtIFJlbGF0ZWQgZW50aXR5IG5hbWUgKGUuZy4sICd0ZWFtJylcbiAqIEBwYXJhbSBpZEZpZWxkIC0gSUQgZmllbGQgbmFtZSAoZS5nLiwgJ3RlYW1JZCcpXG4gKiBAcGFyYW0gZW50aXR5U2VydmljZSAtIEVudGl0eSBzZXJ2aWNlIHRvIGdldCBtZXRhZGF0YSBmcm9tXG4gKiBAcmV0dXJucyBGYWxsYmFjayBjb25maWd1cmF0aW9uIHdpdGggdGVtcGxhdGUsIGxpbmtUZXh0LCBhbmQgbW9kYWxCdXR0b25UZXh0XG4gKiBcbiAqIEBleGFtcGxlXG4gKiAvLyBGb3IgYSB0ZWFtIHJlbGF0aW9uXG4gKiBnZW5lcmF0ZVJlbGF0aW9uRmFsbGJhY2soJ3RlYW0nLCAndGVhbUlkJywgdGVhbVNlcnZpY2UpXG4gKiAvLyBSZXR1cm5zOiB7XG4gKiAvLyAgIHRlbXBsYXRlOiAnVGVhbToge3RlYW1JZH0nLFxuICogLy8gICBsaW5rVGV4dDogJ1ZpZXcgVGVhbScsXG4gKiAvLyAgIG1vZGFsQnV0dG9uVGV4dDogJ1RlYW0gRGV0YWlscydcbiAqIC8vIH1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdlbmVyYXRlUmVsYXRpb25GYWxsYmFjayhcbiAgICBlbnRpdHlOYW1lOiBzdHJpbmcsXG4gICAgaWRGaWVsZDogc3RyaW5nLFxuICAgIGVudGl0eVNlcnZpY2U/OiBCYXNlRW50aXR5U2VydmljZTxhbnk+XG4pOiBOb25OdWxsYWJsZTxJUmVsYXRpb25GaWVsZENvbmZpZ1snZGlzcGxheUNvbmZpZyddPlsnZmFsbGJhY2snXSB7XG4gICAgLy8gVHJ5IHRvIGdldCBlbnRpdHkgbWV0YWRhdGEgZm9yIGJldHRlciBmYWxsYmFjayB0ZXh0XG4gICAgY29uc3QgZW50aXR5TWV0YWRhdGEgPSBlbnRpdHlTZXJ2aWNlPy5nZXRFbnRpdHlTY2hlbWE/LigpLm1vZGVsO1xuICAgIGNvbnN0IGRpc3BsYXlOYW1lID0gZW50aXR5TWV0YWRhdGE/LmVudGl0eU5hbWVQbHVyYWwgfHwgcGFzY2FsQ2FzZShlbnRpdHlOYW1lKTtcbiAgICBcbiAgICByZXR1cm4ge1xuICAgICAgICAvLyBCYWNrZW5kIHByZS1nZW5lcmF0ZXMgZmFsbGJhY2sgdGVtcGxhdGUgKGludGVudGlvbmFsbHkgc3RyaW5nLW9ubHksIG5vdCBUZW1wbGF0ZSB0eXBlKVxuICAgICAgICAvLyBGcm9udGVuZCB3aWxsIHVzZSB0aGlzIHdoZW4gb25seSBJRCBpcyBhdmFpbGFibGVcbiAgICAgICAgdGVtcGxhdGU6IGAke2Rpc3BsYXlOYW1lfTogeyR7aWRGaWVsZH19YCwgIC8vIGUuZy4sIFwiVGVhbToge3RlYW1JZH1cIlxuICAgICAgICBsaW5rVGV4dDogYFZpZXcgJHtkaXNwbGF5TmFtZX1gLCAgICAgICAgICAgLy8gZS5nLiwgXCJWaWV3IFRlYW1cIlxuICAgICAgICBtb2RhbEJ1dHRvblRleHQ6IGAke2Rpc3BsYXlOYW1lfSBEZXRhaWxzYCAgLy8gZS5nLiwgXCJUZWFtIERldGFpbHNcIlxuICAgIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWwoXG4gICAgdGhpc1Byb3A6IFRJT1NjaGVtYUF0dHJpYnV0ZSxcbiAgICB0eXBlOiAnY3JlYXRlJyB8ICd1cGRhdGUnIHwgJ2RldGFpbCcsXG4gICAgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PixcbiAgICBhbGxQcm9wZXJ0aWVzPzogVElPU2NoZW1hQXR0cmlidXRlW10sICAvLyBPcHRpb25hbDogZm9yIGRldGVjdGluZyBkdXBsaWNhdGVkIHJlbGF0aW9uIGZpZWxkc1xuICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sndWlDb25maWdHZW5PcHRpb25zJ10gIC8vIE9wdGlvbmFsOiBnbG9iYWwgVUkgY29uZmlnIG9wdGlvbnNcbikge1xuICAgIGNvbnN0IGZvcm1hdHRlZDogYW55ID0ge1xuICAgICAgICAuLi50aGlzUHJvcCxcbiAgICAgICAgbGFiZWw6IHRoaXNQcm9wLm5hbWUsICAvLyBSZXNwZWN0IGN1c3RvbSBsYWJlbCBmcm9tIGVudGl0eSBhdHRyaWJ1dGVcbiAgICAgICAgY29sdW1uOiB0aGlzUHJvcC5pZCxcbiAgICAgICAgZmllbGRUeXBlOiB0aGlzUHJvcC5maWVsZFR5cGUgfHwgJ3RleHQnLCAgLy8gZmllbGRUeXBlIHNob3VsZCBhbHJlYWR5IGJlIGluZmVycmVkIGluIGJhc2Utc2VydmljZVxuICAgICAgICBoaWRkZW46IHRoaXNQcm9wLmhhc093blByb3BlcnR5KCdpc1Zpc2libGUnKSAmJiAhdGhpc1Byb3AuaXNWaXNpYmxlXG4gICAgfTtcblxuICAgIC8vIEhhbmRsZSBhZGROZXdPcHRpb24gKE9MRCAtIGRlcHJlY2F0ZWQsIGdlbmVyYXRlcyBlbWJlZGRlZCBjb25maWcpIG9yIGFkZE5ld09wdGlvbkNvbmZpZyAoTkVXIC0ganVzdCBwYXNzIHRocm91Z2ggcmVmZXJlbmNlKVxuICAgIGlmIChpc1NlbGVjdEZpZWxkTWV0YWRhdGEodGhpc1Byb3ApICYmIFsgJ2NyZWF0ZScsICd1cGRhdGUnIF0uaW5jbHVkZXModHlwZSkpIHtcbiAgICAgICAgY29uc3Qgc2VsZWN0RmllbGQgPSB0aGlzUHJvcCBhcyBTZWxlY3RGaWVsZE1ldGFkYXRhO1xuICAgICAgICBcbiAgICAgICAgaWYgKHNlbGVjdEZpZWxkLmFkZE5ld09wdGlvbkNvbmZpZykge1xuICAgICAgICAgICAgLy8gTkVXIFdBWTogVXNlciBwcm92aWRlZCBhZGROZXdPcHRpb25Db25maWcgcmVmZXJlbmNlIC0ganVzdCBwYXNzIGl0IHRocm91Z2hcbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ2FkZE5ld09wdGlvbkNvbmZpZycgXSA9IHNlbGVjdEZpZWxkLmFkZE5ld09wdGlvbkNvbmZpZztcbiAgICAgICAgICAgIFxuICAgICAgICB9IGVsc2UgaWYgKHNlbGVjdEZpZWxkLmFkZE5ld09wdGlvbikge1xuICAgICAgICAgICAgLy8gT0xEIFdBWSAoREVQUkVDQVRFRCk6IFRyYW5zZm9ybSBhZGROZXdPcHRpb24gdG8gYWRkTmV3T3B0aW9uQ29uZmlnIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG4gICAgICAgICAgICBjb25zdCB7IGVudGl0eU5hbWUsIG92ZXJyaWRlQ29uZmlnIH0gPSBzZWxlY3RGaWVsZC5hZGROZXdPcHRpb247XG5cbiAgICAgICAgICAgIGlmIChlbnRpdHlOYW1lICYmIGVudGl0eVNlcnZpY2UuaGFzRW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShlbnRpdHlOYW1lKSkge1xuICAgICAgICAgICAgICAgIGZvcm1hdHRlZFsgJ2FkZE5ld09wdGlvbkNvbmZpZycgXSA9IHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdjcmVhdGUnIGFzIGNvbnN0LFxuICAgICAgICAgICAgICAgICAgICBvdmVycmlkZUNvbmZpZzogb3ZlcnJpZGVDb25maWcgfHwge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3VibWl0U3VjY2Vzc1JlZGlyZWN0OiB1bmRlZmluZWQsICAvLyBTdGF5IGluIG1vZGFsIGFmdGVyIGNyZWF0aW9uXG4gICAgICAgICAgICAgICAgICAgICAgICBmb3JtQnV0dG9uczogW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsgdGV4dDogXCJBZGRcIiwgYWN0aW9uOiBcInN1Ym1pdFwiIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgeyB0ZXh0OiBcIkNhbmNlbFwiLCBhY3Rpb246IFwiY2FuY2VsXCIgfVxuICAgICAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWw6IENvdWxkIG5vdCBmaW5kIHJlbGF0ZWQtZW50aXR5LXNlcnZpY2UgZm9yIGVudGl0eSBbJHtlbnRpdHlOYW1lfV0gaW4gJHtlbnRpdHlTZXJ2aWNlLmNvbnN0cnVjdG9yLm5hbWV9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgcmVsYXRpb24gZmllbGRzIChEQVRBIExBWUVSICsgVUkgTEFZRVIpXG4gICAgaWYgKHRoaXNQcm9wLnJlbGF0aW9uICYmIHR5cGUgPT09ICdkZXRhaWwnKSB7XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uID0gdGhpc1Byb3AucmVsYXRpb247XG4gICAgICAgIGNvbnN0IHsgZW50aXR5TmFtZSwgdHlwZTogcmVsYXRpb25UeXBlLCBpZGVudGlmaWVycyB9ID0gcmVsYXRpb247XG4gICAgICAgIGNvbnN0IGVudGl0eU5hbWVMb3dlciA9IGVudGl0eU5hbWUudG9Mb3dlckNhc2UoKTtcblxuICAgICAgICBpZiAoIWVudGl0eVNlcnZpY2UuaGFzRW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShlbnRpdHlOYW1lKSkge1xuICAgICAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWw6IENvdWxkIG5vdCBmaW5kIHJlbGF0ZWQtZW50aXR5LXNlcnZpY2UgZm9yIGVudGl0eSBbJHtlbnRpdHlOYW1lfV0gaW4gJHtlbnRpdHlTZXJ2aWNlLmNvbnN0cnVjdG9yLm5hbWV9YCk7XG4gICAgICAgICAgICByZXR1cm4gZm9ybWF0dGVkO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUmVzb2x2ZSBpZGVudGlmaWVycyAoY291bGQgYmUgZGlyZWN0IHZhbHVlIG9yIGxhenkgZnVuY3Rpb24pXG4gICAgICAgIGNvbnN0IHJlc29sdmVkSWRlbnRpZmllcnMgPSB0eXBlb2YgaWRlbnRpZmllcnMgPT09ICdmdW5jdGlvbicgPyBpZGVudGlmaWVycygpIDogaWRlbnRpZmllcnM7XG5cbiAgICAgICAgLy8gU2FmZXR5IGNoZWNrIGZvciBhcnJheSBpZGVudGlmaWVyc1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShyZXNvbHZlZElkZW50aWZpZXJzKSkge1xuICAgICAgICAgICAgaWYgKHJlc29sdmVkSWRlbnRpZmllcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVGb3JGb3JtT3JEZXRhaWw6IEVtcHR5IGlkZW50aWZpZXJzIGFycmF5IGZvciByZWxhdGlvbiBbJHtlbnRpdHlOYW1lfV1gKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gZm9ybWF0dGVkO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gSGFuZGxlIGJvdGggc2luZ2xlIGFuZCBtdWx0aXBsZSBpZGVudGlmaWVycyBmb3IgY29tcG9zaXRlIGtleXNcbiAgICAgICAgY29uc3QgaWRlbnRpZmllck1hcHBpbmdzID0gQXJyYXkuaXNBcnJheShyZXNvbHZlZElkZW50aWZpZXJzKSBcbiAgICAgICAgICAgID8gcmVzb2x2ZWRJZGVudGlmaWVycy5tYXAoaWQgPT4gKHtcbiAgICAgICAgICAgICAgICBzb3VyY2U6IFN0cmluZyhpZC5zb3VyY2UpLFxuICAgICAgICAgICAgICAgIHRhcmdldDogU3RyaW5nKGlkLnRhcmdldClcbiAgICAgICAgICAgICAgfSkpXG4gICAgICAgICAgICA6IFt7XG4gICAgICAgICAgICAgICAgc291cmNlOiBTdHJpbmcocmVzb2x2ZWRJZGVudGlmaWVycy5zb3VyY2UpLFxuICAgICAgICAgICAgICAgIHRhcmdldDogU3RyaW5nKHJlc29sdmVkSWRlbnRpZmllcnMudGFyZ2V0KVxuICAgICAgICAgICAgICB9XTtcblxuICAgICAgICAvLyBGb3Igcm91dGUgcGF0dGVybiBhbmQgZGVmYXVsdCBmaWx0ZXJzLCB1c2UgdGhlIGZpcnN0IGlkZW50aWZpZXJcbiAgICAgICAgLy8gKG1vc3QgZW50aXRpZXMgaGF2ZSBzaW5nbGUgaWRlbnRpZmllcjsgY29tcG9zaXRlIGtleXMgbmVlZCBleHBsaWNpdCByb3V0ZVBhdHRlcm4pXG4gICAgICAgIGNvbnN0IHByaW1hcnlJZGVudGlmaWVyID0gaWRlbnRpZmllck1hcHBpbmdzWzBdO1xuXG4gICAgICAgIC8vIENoZWNrIGlmIHVzZXIgcHJvdmlkZWQgY3VzdG9tIFVJIGNvbmZpZyBpbiByZWxhdGlvbkNvbmZpZyAob3B0aW9uYWwgb3ZlcnJpZGUpXG4gICAgICAgIGNvbnN0IHVzZXJSZWxhdGlvbkNvbmZpZyA9IHRoaXNQcm9wLnJlbGF0aW9uQ29uZmlnIGFzIElSZWxhdGlvbkZpZWxkQ29uZmlnIHwgdW5kZWZpbmVkO1xuXG4gICAgICAgIC8vIEdldCByZWxhdGVkIGVudGl0eSBzZXJ2aWNlIGZvciBtZXRhZGF0YSAoaWNvbiwgZXRjLilcbiAgICAgICAgY29uc3QgcmVsYXRlZEVudGl0eVNlcnZpY2UgPSBlbnRpdHlTZXJ2aWNlLmhhc0VudGl0eVNlcnZpY2VCeUVudGl0eU5hbWUoZW50aXR5TmFtZSkgXG4gICAgICAgICAgICA/IGVudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2VydmljZUJ5RW50aXR5TmFtZShlbnRpdHlOYW1lKVxuICAgICAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgICAgIFxuICAgICAgICAvLyBHZXQgZW50aXR5IG1ldGFkYXRhIGZvciBpY29uIGFuZCBmYWxsYmFjayBnZW5lcmF0aW9uXG4gICAgICAgIGNvbnN0IHJlbGF0ZWRFbnRpdHlNZXRhZGF0YSA9IHJlbGF0ZWRFbnRpdHlTZXJ2aWNlPy5nZXRFbnRpdHlTY2hlbWE/LigpLm1vZGVsO1xuICAgICAgICBjb25zdCBkZWZhdWx0SWNvbiA9IHJlbGF0ZWRFbnRpdHlNZXRhZGF0YT8ubWV0YWRhdGE/Lmljb247XG5cbiAgICAgICAgaWYgKHJlbGF0aW9uVHlwZS5lbmRzV2l0aCgndG8tb25lJykpIHtcbiAgICAgICAgICAgIC8vIFRPLU9ORTogU2hvdyB2YWx1ZSBhcyBsaW5rICsgbW9kYWwgaWNvblxuICAgICAgICAgICAgLy8gUm91dGUgcGF0dGVybjogVXNlIGN1c3RvbSAoZnJvbSByZWxhdGlvbkNvbmZpZykgb3IgZGVmYXVsdCB0byAvdmlldy17ZW50aXR5fS86dGFyZ2V0SWRcbiAgICAgICAgICAgIGNvbnN0IHJvdXRlUGF0dGVybiA9IHVzZXJSZWxhdGlvbkNvbmZpZz8ucm91dGVQYXR0ZXJuIFxuICAgICAgICAgICAgICAgIHx8IGAvdmlldy0ke2VudGl0eU5hbWVMb3dlcn0vOiR7cHJpbWFyeUlkZW50aWZpZXIudGFyZ2V0fWA7XG5cbiAgICAgICAgICAgIC8vIEdlbmVyYXRlIGZhbGxiYWNrIGNvbmZpZ3VyYXRpb24gZm9yIHdoZW4gb25seSBJRCBpcyBhdmFpbGFibGVcbiAgICAgICAgICAgIGNvbnN0IGZhbGxiYWNrQ29uZmlnID0gZ2VuZXJhdGVSZWxhdGlvbkZhbGxiYWNrKFxuICAgICAgICAgICAgICAgIGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgcHJpbWFyeUlkZW50aWZpZXIuc291cmNlLFxuICAgICAgICAgICAgICAgIHJlbGF0ZWRFbnRpdHlTZXJ2aWNlXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICAvLyBBdXRvLWRldGVjdCBkdXBsaWNhdGVkIHJlbGF0aW9uIGZpZWxkIChlLmcuLCB0ZWFtTmFtZSBmb3IgdGVhbUlkKVxuICAgICAgICAgICAgLy8gTkVXOiBVc2UgZW5oYW5jZWQgZGV0ZWN0aW9uIHdpdGggY29uZmlnIHN1cHBvcnRcbiAgICAgICAgICAgIGxldCBhdXRvVGVtcGxhdGU6IHN0cmluZyB8IHVuZGVmaW5lZCA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIGxldCBkZXRlY3Rpb25NZXRhZGF0YTogYW55ID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBDaGVjayBpZiBhdXRvLWRldGVjdGlvbiBpcyBlbmFibGVkIChkZWZhdWx0OiB0cnVlKVxuICAgICAgICAgICAgY29uc3QgYXV0b0RldGVjdEVuYWJsZWQgPSB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmF1dG9EZXRlY3QgIT09IGZhbHNlO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoYXV0b0RldGVjdEVuYWJsZWQgJiYgYWxsUHJvcGVydGllcykge1xuICAgICAgICAgICAgICAgIC8vIEdldCBnbG9iYWwgY29uZmlnIChwYXNzZWQgZnJvbSBmdzI0IGluaXRpYWxpemF0aW9uKVxuICAgICAgICAgICAgICAgIGNvbnN0IGdsb2JhbENvbmZpZyA9IGdsb2JhbFVJQ29uZmlnT3B0aW9ucz8uZHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIEdldCBlbnRpdHktbGV2ZWwgY29uZmlnIGZyb20gZW50aXR5IG1ldGFkYXRhXG4gICAgICAgICAgICAgICAgY29uc3QgZW50aXR5Q29uZmlnID0gcmVsYXRlZEVudGl0eU1ldGFkYXRhPy5tZXRhZGF0YT8uZHVwbGljYXRlZEZpZWxkRGV0ZWN0aW9uO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIC8vIEdldCByZWxhdGlvbi1sZXZlbCBoaW50c1xuICAgICAgICAgICAgICAgIGNvbnN0IHJlbGF0aW9uSGludHMgPSB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmF1dG9EZXRlY3RIaW50cztcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAvLyBSdW4gZW5oYW5jZWQgZGV0ZWN0aW9uXG4gICAgICAgICAgICAgICAgY29uc3QgZGV0ZWN0aW9uUmVzdWx0ID0gZGV0ZWN0RHVwbGljYXRlZFJlbGF0aW9uRmllbGRzKFxuICAgICAgICAgICAgICAgICAgICBhbGxQcm9wZXJ0aWVzLFxuICAgICAgICAgICAgICAgICAgICB0aGlzUHJvcC5pZCxcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgZ2xvYmFsQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICBlbnRpdHlDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIHJlbGF0aW9uSGludHNcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgIGlmIChkZXRlY3Rpb25SZXN1bHQpIHtcbiAgICAgICAgICAgICAgICAgICAgYXV0b1RlbXBsYXRlID0gZGV0ZWN0aW9uUmVzdWx0LnRlbXBsYXRlO1xuICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgLy8gU3RvcmUgbWV0YWRhdGEgZm9yIGRlYnVnZ2luZyBhbmQgZnV0dXJlIGZlYXR1cmVzXG4gICAgICAgICAgICAgICAgICAgIGRldGVjdGlvbk1ldGFkYXRhID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgZGV0ZWN0ZWRGaWVsZHM6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcmltYXJ5OiBkZXRlY3Rpb25SZXN1bHQucHJpbWFyeUZpZWxkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFsdGVybmF0aXZlczogZGV0ZWN0aW9uUmVzdWx0LmRldGVjdGVkRmllbGRzLmRpc3BsYXk/LnNsaWNlKDEpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZpc3VhbDogZGV0ZWN0aW9uUmVzdWx0LmRldGVjdGVkRmllbGRzLnZpc3VhbCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZXRhOiBkZXRlY3Rpb25SZXN1bHQuZGV0ZWN0ZWRGaWVsZHMubWV0YVxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbmZpZGVuY2U6IGRldGVjdGlvblJlc3VsdC5jb25maWRlbmNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWV0aG9kOiBkZXRlY3Rpb25SZXN1bHQubWV0aG9kLFxuICAgICAgICAgICAgICAgICAgICAgICAgcGF0dGVybjogZGV0ZWN0aW9uUmVzdWx0LnBhdHRlcm5cbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnOiBJUmVsYXRpb25GaWVsZENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICByb3V0ZVBhdHRlcm46IHJvdXRlUGF0dGVybixcbiAgICAgICAgICAgICAgICAvLyBQYXNzIEFMTCBpZGVudGlmaWVyIG1hcHBpbmdzIChzdXBwb3J0cyBjb21wb3NpdGUga2V5cylcbiAgICAgICAgICAgICAgICBpZGVudGlmaWVyTWFwcGluZzogaWRlbnRpZmllck1hcHBpbmdzLmxlbmd0aCA9PT0gMSBcbiAgICAgICAgICAgICAgICAgICAgPyBpZGVudGlmaWVyTWFwcGluZ3NbMF0gIC8vIFNpbmdsZTogcmV0dXJuIG9iamVjdFxuICAgICAgICAgICAgICAgICAgICA6IGlkZW50aWZpZXJNYXBwaW5ncywgICAgIC8vIE11bHRpcGxlOiByZXR1cm4gYXJyYXlcbiAgICAgICAgICAgICAgICBtb2RhbENvbmZpZ1JlZjogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbENvbmZpZ1JlZiB8fCB7XG4gICAgICAgICAgICAgICAgICAgIGVudGl0eU5hbWU6IGVudGl0eU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIHBhZ2VUeXBlOiAndmlldycgYXMgY29uc3QsXG4gICAgICAgICAgICAgICAgICAgIG92ZXJyaWRlQ29uZmlnOiB7fVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgbW9kYWxXaWR0aDogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbFdpZHRoLFxuICAgICAgICAgICAgICAgIG1vZGFsVGl0bGU6IHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxUaXRsZSxcbiAgICAgICAgICAgICAgICBkaXNwbGF5Q29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgIC8vIFByaW9yaXR5OiBVc2VyIGN1c3RvbSB0ZW1wbGF0ZSA+IEF1dG8tZGV0ZWN0ZWQgZHVwbGljYXRlZCBmaWVsZCA+IHVuZGVmaW5lZCAodXNlIGZhbGxiYWNrKVxuICAgICAgICAgICAgICAgICAgICB0ZW1wbGF0ZTogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy50ZW1wbGF0ZSB8fCBhdXRvVGVtcGxhdGUsXG4gICAgICAgICAgICAgICAgICAgIC8vIFNtYXJ0IGZhbGxiYWNrIHByZS1nZW5lcmF0ZWQgZnJvbSBlbnRpdHkgbWV0YWRhdGFcbiAgICAgICAgICAgICAgICAgICAgZmFsbGJhY2s6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uZmFsbGJhY2sgfHwgZmFsbGJhY2tDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIC8vIEljb24gZnJvbSBlbnRpdHkgbWV0YWRhdGEgb3IgdXNlciBvdmVycmlkZVxuICAgICAgICAgICAgICAgICAgICBpY29uOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/Lmljb24gfHwgZGVmYXVsdEljb24gfHwgJ0V5ZU91dGxpbmVkJyxcbiAgICAgICAgICAgICAgICAgICAgc2hvd01vZGFsSWNvbjogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5zaG93TW9kYWxJY29uICE9PSBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgc2hvd0xpbms6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uc2hvd0xpbmsgIT09IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAvLyBQYXNzIHRocm91Z2ggYXV0b0RldGVjdCBhbmQgYXV0b0RldGVjdEhpbnRzXG4gICAgICAgICAgICAgICAgICAgIGF1dG9EZXRlY3Q6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uYXV0b0RldGVjdCxcbiAgICAgICAgICAgICAgICAgICAgYXV0b0RldGVjdEhpbnRzOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmF1dG9EZXRlY3RIaW50cyxcbiAgICAgICAgICAgICAgICAgICAgLy8gUGFzcyB0aHJvdWdoIGFueSBjdXN0b20gYWN0aW9uc1xuICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LmFjdGlvbnNcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgaWYoZ2xvYmFsVUlDb25maWdPcHRpb25zPy5kdXBsaWNhdGVkRmllbGREZXRlY3Rpb24/LmRlYnVnKSB7XG4gICAgICAgICAgICAgICAgZ2VuZXJhdGVkUmVsYXRpb25Db25maWcuZGlzcGxheUNvbmZpZyFbJ19kZXRlY3Rpb25NZXRhZGF0YSddID0gZGV0ZWN0aW9uTWV0YWRhdGE7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGZvcm1hdHRlZFsgJ3JlbGF0aW9uQ29uZmlnJyBdID0gZ2VuZXJhdGVkUmVsYXRpb25Db25maWc7XG5cbiAgICAgICAgICAgIC8vIEJhY2t3YXJkIGNvbXBhdGliaWxpdHk6IEtlZXAgaXNMaW5rIGFuZCBsaW5rQ29uZmlnXG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdpc0xpbmsnIF0gPSB0cnVlO1xuICAgICAgICAgICAgZm9ybWF0dGVkWyAnbGlua0NvbmZpZycgXSA9IHtcbiAgICAgICAgICAgICAgICByb3V0ZVBhdHRlcm46IHJvdXRlUGF0dGVyblxuICAgICAgICAgICAgfTtcblxuICAgICAgICB9IGVsc2UgaWYgKHJlbGF0aW9uVHlwZS5lbmRzV2l0aCgndG8tbWFueScpKSB7XG4gICAgICAgICAgICAvLyBUTy1NQU5ZOiBTaG93IGNvdW50ICsgbW9kYWwgaWNvbiAob3BlbnMgZmlsdGVyZWQgbGlzdClcbiAgICAgICAgICAgIC8vIFJvdXRlIHBhdHRlcm46IFVzZSBjdXN0b20gKGZyb20gcmVsYXRpb25Db25maWcpIG9yIGRlZmF1bHQgdG8gL2xpc3Qte2VudGl0eX1cbiAgICAgICAgICAgIGNvbnN0IHJvdXRlUGF0dGVybiA9IHVzZXJSZWxhdGlvbkNvbmZpZz8ucm91dGVQYXR0ZXJuXG4gICAgICAgICAgICAgICAgfHwgYC9saXN0LSR7ZW50aXR5TmFtZUxvd2VyfWA7XG5cbiAgICAgICAgICAgIC8vIEJ1aWxkIGRlZmF1bHQgZmlsdGVycyB0byBzaG93IG9ubHkgcmVsYXRlZCBpdGVtc1xuICAgICAgICAgICAgLy8gRm9yIGV4YW1wbGUsIGlmIHdlJ3JlIHZpZXdpbmcgYSBUZWFtIGFuZCB0aGlzIGZpZWxkIHNob3dzIEdhbWVzLFxuICAgICAgICAgICAgLy8gd2Ugd2FudCB0byBmaWx0ZXIgZ2FtZXMgd2hlcmUgdGVhbUlkID0gY3VycmVudCB0ZWFtJ3MgSURcbiAgICAgICAgICAgIC8vIEZvciBjb21wb3NpdGUga2V5cywgYWRkIGFsbCBpZGVudGlmaWVycyBhcyBmaWx0ZXJzXG4gICAgICAgICAgICBjb25zdCBkZWZhdWx0RmlsdGVyczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgICAgICAgICAgaWRlbnRpZmllck1hcHBpbmdzLmZvckVhY2gobWFwcGluZyA9PiB7XG4gICAgICAgICAgICAgICAgZGVmYXVsdEZpbHRlcnNbbWFwcGluZy50YXJnZXRdID0gYDoke21hcHBpbmcuc291cmNlfWA7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gR2VuZXJhdGUgZmFsbGJhY2sgY29uZmlndXJhdGlvbiBmb3IgdG8tbWFueSAoc2hvd3MgY291bnQpXG4gICAgICAgICAgICBjb25zdCBmYWxsYmFja0NvbmZpZyA9IGdlbmVyYXRlUmVsYXRpb25GYWxsYmFjayhcbiAgICAgICAgICAgICAgICBlbnRpdHlOYW1lLFxuICAgICAgICAgICAgICAgIHByaW1hcnlJZGVudGlmaWVyLnNvdXJjZSxcbiAgICAgICAgICAgICAgICByZWxhdGVkRW50aXR5U2VydmljZVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgY29uc3QgZ2VuZXJhdGVkUmVsYXRpb25Db25maWc6IElSZWxhdGlvbkZpZWxkQ29uZmlnID0ge1xuICAgICAgICAgICAgICAgIHJvdXRlUGF0dGVybjogcm91dGVQYXR0ZXJuLFxuICAgICAgICAgICAgICAgIC8vIFBhc3MgQUxMIGlkZW50aWZpZXIgbWFwcGluZ3MgKHN1cHBvcnRzIGNvbXBvc2l0ZSBrZXlzKVxuICAgICAgICAgICAgICAgIGlkZW50aWZpZXJNYXBwaW5nOiBpZGVudGlmaWVyTWFwcGluZ3MubGVuZ3RoID09PSAxIFxuICAgICAgICAgICAgICAgICAgICA/IGlkZW50aWZpZXJNYXBwaW5nc1swXSAgLy8gU2luZ2xlOiByZXR1cm4gb2JqZWN0XG4gICAgICAgICAgICAgICAgICAgIDogaWRlbnRpZmllck1hcHBpbmdzLCAgICAgLy8gTXVsdGlwbGU6IHJldHVybiBhcnJheVxuICAgICAgICAgICAgICAgIG1vZGFsQ29uZmlnUmVmOiB1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsQ29uZmlnUmVmIHx8IHtcbiAgICAgICAgICAgICAgICAgICAgZW50aXR5TmFtZTogZW50aXR5TmFtZSxcbiAgICAgICAgICAgICAgICAgICAgcGFnZVR5cGU6ICdsaXN0JyBhcyBjb25zdCxcbiAgICAgICAgICAgICAgICAgICAgb3ZlcnJpZGVDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiBkZWZhdWx0RmlsdGVyc1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBtb2RhbFdpZHRoOiB1c2VyUmVsYXRpb25Db25maWc/Lm1vZGFsV2lkdGgsXG4gICAgICAgICAgICAgICAgbW9kYWxUaXRsZTogdXNlclJlbGF0aW9uQ29uZmlnPy5tb2RhbFRpdGxlLFxuICAgICAgICAgICAgICAgIGRpc3BsYXlDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgLy8gVXNlciBjYW4gb3ZlcnJpZGUgd2l0aCBjdXN0b20gdGVtcGxhdGVcbiAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGU6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8udGVtcGxhdGUsXG4gICAgICAgICAgICAgICAgICAgIC8vIFNtYXJ0IGZhbGxiYWNrIHByZS1nZW5lcmF0ZWQgZnJvbSBlbnRpdHkgbWV0YWRhdGFcbiAgICAgICAgICAgICAgICAgICAgZmFsbGJhY2s6IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uZmFsbGJhY2sgfHwgZmFsbGJhY2tDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIC8vIEljb24gZnJvbSBlbnRpdHkgbWV0YWRhdGEgb3IgdXNlciBvdmVycmlkZVxuICAgICAgICAgICAgICAgICAgICBpY29uOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/Lmljb24gfHwgZGVmYXVsdEljb24gfHwgJ1Vub3JkZXJlZExpc3RPdXRsaW5lZCcsXG4gICAgICAgICAgICAgICAgICAgIHNob3dNb2RhbEljb246IHVzZXJSZWxhdGlvbkNvbmZpZz8uZGlzcGxheUNvbmZpZz8uc2hvd01vZGFsSWNvbiAhPT0gZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgIHNob3dMaW5rOiB1c2VyUmVsYXRpb25Db25maWc/LmRpc3BsYXlDb25maWc/LnNob3dMaW5rICE9PSB0cnVlLCAvLyBEZWZhdWx0IGZhbHNlIGZvciB0by1tYW55XG4gICAgICAgICAgICAgICAgICAgIC8vIFBhc3MgdGhyb3VnaCBhbnkgY3VzdG9tIGFjdGlvbnNcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogdXNlclJlbGF0aW9uQ29uZmlnPy5kaXNwbGF5Q29uZmlnPy5hY3Rpb25zXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgLy8gSWYgdXNlciBwcm92aWRlZCBjdXN0b20gbW9kYWxDb25maWdSZWYsIG1lcmdlIGRlZmF1bHQgZmlsdGVycyB3aXRoIHRoZWlyIG92ZXJyaWRlc1xuICAgICAgICAgICAgaWYgKHVzZXJSZWxhdGlvbkNvbmZpZz8ubW9kYWxDb25maWdSZWY/Lm92ZXJyaWRlQ29uZmlnKSB7XG4gICAgICAgICAgICAgICAgZ2VuZXJhdGVkUmVsYXRpb25Db25maWcubW9kYWxDb25maWdSZWYhLm92ZXJyaWRlQ29uZmlnID0ge1xuICAgICAgICAgICAgICAgICAgICAuLi51c2VyUmVsYXRpb25Db25maWcubW9kYWxDb25maWdSZWYub3ZlcnJpZGVDb25maWcsXG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRGaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAuLi5kZWZhdWx0RmlsdGVycyxcbiAgICAgICAgICAgICAgICAgICAgICAgIC4uLih1c2VyUmVsYXRpb25Db25maWcubW9kYWxDb25maWdSZWYub3ZlcnJpZGVDb25maWcuZGVmYXVsdEZpbHRlcnMgfHwge30pXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBmb3JtYXR0ZWRbICdyZWxhdGlvbkNvbmZpZycgXSA9IGdlbmVyYXRlZFJlbGF0aW9uQ29uZmlnO1xuICAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIEhhbmRsZSBuZXN0ZWQgc3RydWN0dXJlcyAobWFwIGFuZCBsaXN0IHR5cGVzKVxuICAgIGlmICh0aGlzUHJvcC50eXBlID09PSAnbWFwJyAmJiB0aGlzUHJvcC5wcm9wZXJ0aWVzKSB7XG4gICAgICAgIGZvcm1hdHRlZFsgJ3Byb3BlcnRpZXMnIF0gPSBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yRm9ybU9yRGV0YWlsKHRoaXNQcm9wLnByb3BlcnRpZXMsIHR5cGUsIGVudGl0eVNlcnZpY2UpO1xuICAgIH0gZWxzZSBpZiAodGhpc1Byb3AudHlwZSA9PT0gJ2xpc3QnKSB7XG4gICAgICAgIC8vIEZvciBsaXN0IHR5cGVzLCBjaGVjayBpZiBpdGVtcyBhcmUgbWFwcyAobmVzdGVkIHN0cnVjdHVyZXMpXG4gICAgICAgIC8vIE5vdGU6IGl0ZW1zIHByb3BlcnR5IGV4aXN0cyBvbiBsaXN0LXR5cGUgYXR0cmlidXRlcyBidXQgbm90IGluIGJhc2UgRW50aXR5QXR0cmlidXRlIHR5cGVcbiAgICAgICAgY29uc3QgZXh0ZW5kZWRQcm9wID0gdGhpc1Byb3AgYXMgVElPU2NoZW1hQXR0cmlidXRlICYgeyBpdGVtcz86IHsgdHlwZTogc3RyaW5nOyBwcm9wZXJ0aWVzPzogVElPU2NoZW1hQXR0cmlidXRlW10gfSB9O1xuICAgICAgICBpZiAoZXh0ZW5kZWRQcm9wLml0ZW1zPy50eXBlID09PSAnbWFwJyAmJiBleHRlbmRlZFByb3AuaXRlbXMucHJvcGVydGllcykge1xuICAgICAgICAgICAgZm9ybWF0dGVkWyAnaXRlbXMnIF0gPSB7XG4gICAgICAgICAgICAgICAgLi4uZm9ybWF0dGVkWyAnaXRlbXMnIF0sXG4gICAgICAgICAgICAgICAgcHJvcGVydGllczogZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckZvcm1PckRldGFpbChleHRlbmRlZFByb3AuaXRlbXMucHJvcGVydGllcywgdHlwZSwgZW50aXR5U2VydmljZSlcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBUT0RPOiBhZGQgc3VwcG9ydCBmb3Igc2V0LCBlbnVtLCBhbmQgY3VzdG9tLXR5cGVzXG5cbiAgICByZXR1cm4gZm9ybWF0dGVkO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckZvcm1PckRldGFpbChcbiAgICBwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSxcbiAgICB0eXBlOiAnY3JlYXRlJyB8ICd1cGRhdGUnIHwgJ2RldGFpbCcsXG4gICAgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PlxuKSB7XG5cbiAgICBpZiAodHlwZSA9PT0gJ2NyZWF0ZScpIHtcbiAgICAgICAgcmV0dXJuIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JDcmVhdGUocHJvcGVydGllcywgZW50aXR5U2VydmljZSk7XG4gICAgfVxuXG4gICAgaWYgKHR5cGUgPT09ICd1cGRhdGUnKSB7XG4gICAgICAgIHJldHVybiBmb3JtYXRFbnRpdHlBdHRyaWJ1dGVzRm9yVXBkYXRlKHByb3BlcnRpZXMsIGVudGl0eVNlcnZpY2UpO1xuICAgIH1cblxuICAgIGlmICh0eXBlID09PSAnZGV0YWlsJykge1xuICAgICAgICByZXR1cm4gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckRldGFpbChwcm9wZXJ0aWVzLCBlbnRpdHlTZXJ2aWNlKTtcbiAgICB9XG4gICAgdGhyb3cgKGBJbnZhbGlkIHR5cGUgWyR7dHlwZX1dIHByb3ZpZGVkIHRvIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JGb3JtT3JEZXRhaWxgKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVudGl0eUF0dHJpYnV0ZXNGb3JDcmVhdGUocHJvcGVydGllczogVElPU2NoZW1hQXR0cmlidXRlW10sIGVudGl0eVNlcnZpY2U6IEJhc2VFbnRpdHlTZXJ2aWNlPGFueT4sIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sndWlDb25maWdHZW5PcHRpb25zJ10pIHtcbiAgICByZXR1cm4gcHJvcGVydGllc1xuICAgICAgICAuZmlsdGVyKHByb3AgPT4gcHJvcCAmJiAoIXByb3AuaGFzT3duUHJvcGVydHkoJ2lzQ3JlYXRhYmxlJykgfHwgcHJvcC5pc0NyZWF0YWJsZSkpXG4gICAgICAgIC5tYXAoKGF0dCkgPT4gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKGF0dCwgJ2NyZWF0ZScsIGVudGl0eVNlcnZpY2UsIHByb3BlcnRpZXMsIGdsb2JhbFVJQ29uZmlnT3B0aW9ucykpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvclVwZGF0ZShwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSwgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PiwgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyd1aUNvbmZpZ0dlbk9wdGlvbnMnXSkge1xuICAgIHJldHVybiBwcm9wZXJ0aWVzXG4gICAgICAgIC5maWx0ZXIocHJvcCA9PiBwcm9wICYmICghcHJvcC5oYXNPd25Qcm9wZXJ0eSgnaXNFZGl0YWJsZScpIHx8IHByb3AuaXNFZGl0YWJsZSkpXG4gICAgICAgIC5tYXAoKGF0dCkgPT4gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKGF0dCwgJ3VwZGF0ZScsIGVudGl0eVNlcnZpY2UsIHByb3BlcnRpZXMsIGdsb2JhbFVJQ29uZmlnT3B0aW9ucykpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlc0ZvckRldGFpbChwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSwgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PiwgZ2xvYmFsVUlDb25maWdPcHRpb25zPzogSUFwcGxpY2F0aW9uQ29uZmlnWyd1aUNvbmZpZ0dlbk9wdGlvbnMnXSkge1xuICAgIHJldHVybiBwcm9wZXJ0aWVzXG4gICAgICAgIC5maWx0ZXIocHJvcCA9PiBwcm9wICYmICghcHJvcC5oYXNPd25Qcm9wZXJ0eSgnaXNWaXNpYmxlJykgfHwgcHJvcC5pc1Zpc2libGUpKVxuICAgICAgICAubWFwKChhdHQpID0+IGZvcm1hdEVudGl0eUF0dHJpYnV0ZUZvckZvcm1PckRldGFpbChhdHQsICdkZXRhaWwnLCBlbnRpdHlTZXJ2aWNlLCBwcm9wZXJ0aWVzLCBnbG9iYWxVSUNvbmZpZ09wdGlvbnMpKTtcbn1cblxuZXhwb3J0IHR5cGUgTGlzdGluZ1Byb3BDb25maWcgPSBQaWNrPEZpZWxkTWV0YWRhdGEsICdmaWVsZFR5cGUnIHwgJ3BsYWNlaG9sZGVyJyB8ICdoZWxwVGV4dCcgfCAnZmlsdGVyQ29uZmlnJz4gJiB7XG4gICAgbmFtZTogc3RyaW5nLFxuICAgIGRhdGFJbmRleDogc3RyaW5nLFxuICAgIGhpZGRlbj86IGJvb2xlYW4sXG4gICAgYWN0aW9ucz86IEFycmF5PElFbnRpdHlQYWdlQWN0aW9uPixcbiAgICByZWxhdGlvbkNvbmZpZz86IElSZWxhdGlvbkZpZWxkQ29uZmlnLCAgLy8gRm9yIHJlbmRlcmluZyByZWxhdGlvbnMgd2l0aCBsaW5rcy9tb2RhbHNcbiAgICB0ZW1wbGF0ZT86IFRlbXBsYXRlLCAgLy8gRm9yIHRlbXBsYXRlLWJhc2VkIHJlbmRlcmluZ1xuICAgIGlzSWRlbnRpZmllcj86IGJvb2xlYW4sICAvLyBGb3IgaWRlbnRpZmllciBmaWVsZHNcbiAgICBpc0xpbms/OiBib29sZWFuLCAgLy8gRm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICBsaW5rQ29uZmlnPzogeyByb3V0ZVBhdHRlcm46IHN0cmluZzsgZGlzcGxheVRleHQ/OiBzdHJpbmcgfSwgIC8vIEZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG59O1xuXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0RW50aXR5QXR0cmlidXRlc0Zvckxpc3QoXG4gICAgZW50aXR5TmFtZTogc3RyaW5nLCBcbiAgICBwcm9wZXJ0aWVzOiBUSU9TY2hlbWFBdHRyaWJ1dGVbXSwgXG4gICAgZW50aXR5U2VydmljZTogQmFzZUVudGl0eVNlcnZpY2U8YW55PixcbiAgICB7XG4gICAgICAgIENSVURBcGlQYXRoLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluVXBkYXRlLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluRGVsZXRlLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluRGV0YWlsLFxuICAgICAgICBjdXN0b21Sb3dBY3Rpb25zLFxuICAgICAgICBnbG9iYWxVSUNvbmZpZ09wdGlvbnNcbiAgICB9OiB7XG4gICAgICAgIENSVURBcGlQYXRoPzogc3RyaW5nLFxuICAgICAgICBleGNsdWRlRnJvbUFkbWluVXBkYXRlPzogYm9vbGVhbixcbiAgICAgICAgZXhjbHVkZUZyb21BZG1pbkRlbGV0ZT86IGJvb2xlYW4sXG4gICAgICAgIGV4Y2x1ZGVGcm9tQWRtaW5EZXRhaWw/OiBib29sZWFuLFxuICAgICAgICBjdXN0b21Sb3dBY3Rpb25zPzogUmVhZG9ubHlBcnJheTxJRW50aXR5UGFnZUFjdGlvbj4gfCBBcnJheTxJRW50aXR5UGFnZUFjdGlvbj4sXG4gICAgICAgIGdsb2JhbFVJQ29uZmlnT3B0aW9ucz86IElBcHBsaWNhdGlvbkNvbmZpZ1sndWlDb25maWdHZW5PcHRpb25zJ10gIC8vIE5FVzogR2xvYmFsIGNvbmZpZyBvcHRpb25zXG4gICAgfVxuKSB7XG5cbiAgICBjb25zdCBlbnRpdHlOYW1lTG93ZXIgPSBlbnRpdHlOYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgZW50aXR5TmFtZVBhc2NhbENhc2UgPSBwYXNjYWxDYXNlKGVudGl0eU5hbWUpO1xuXG4gICAgcmV0dXJuIHByb3BlcnRpZXNcbiAgICAgICAgLmZpbHRlcihwcm9wID0+IHByb3AgJiYgcHJvcC5pc0xpc3RhYmxlKVxuICAgICAgICAubWFwKHByb3AgPT4ge1xuICAgICAgICAgICAgLy8gVXNlIHNhbWUgZm9ybWF0dGluZyBsb2dpYyBhcyBkZXRhaWxzL2Zvcm1zIChpbmNsdWRlcyByZWxhdGlvbkNvbmZpZyBnZW5lcmF0aW9uKVxuICAgICAgICAgICAgLy8gUGFzcyBhbGwgcHJvcGVydGllcyBzbyBpdCBjYW4gZGV0ZWN0IGR1cGxpY2F0ZWQgcmVsYXRpb24gZmllbGRzIChlLmcuLCB0ZWFtTmFtZSBmb3IgdGVhbUlkKVxuICAgICAgICAgICAgY29uc3QgZm9ybWF0dGVkID0gZm9ybWF0RW50aXR5QXR0cmlidXRlRm9yRm9ybU9yRGV0YWlsKHByb3AsICdkZXRhaWwnLCBlbnRpdHlTZXJ2aWNlLCBwcm9wZXJ0aWVzLCBnbG9iYWxVSUNvbmZpZ09wdGlvbnMpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBPdmVycmlkZS9hZGQgbGlzdC1zcGVjaWZpYyBwcm9wZXJ0aWVzXG4gICAgICAgICAgICBjb25zdCBwcm9wQ29uZmlnOiBMaXN0aW5nUHJvcENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICAuLi5mb3JtYXR0ZWQsXG4gICAgICAgICAgICAgICAgbmFtZTogZm9ybWF0dGVkLmxhYmVsIHx8IGZvcm1hdHRlZC5uYW1lLCAgLy8gRW5zdXJlIG5hbWUgaXMgc2V0IGZvciB0YWJsZSBjb2x1bW4gaGVhZGVyXG4gICAgICAgICAgICAgICAgZGF0YUluZGV4OiBgJHtwcm9wLmlkfWAsXG4gICAgICAgICAgICAgICAgZmllbGRUeXBlOiBmb3JtYXR0ZWQuZmllbGRUeXBlIHx8ICd0ZXh0JyxcbiAgICAgICAgICAgICAgICBoaWRkZW46IHByb3AuaGFzT3duUHJvcGVydHkoJ2lzVmlzaWJsZScpICYmICFwcm9wLmlzVmlzaWJsZVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgaWYgKHByb3AuaXNJZGVudGlmaWVyKSB7XG4gICAgICAgICAgICAgICAgLy8gQnVpbGQgZGVmYXVsdCByb3cgYWN0aW9ucyB3aXRoIElEc1xuICAgICAgICAgICAgICAgIGNvbnN0IGRlZmF1bHRBY3Rpb25zOiBBcnJheTxJRW50aXR5UGFnZUFjdGlvbj4gPSBbXTtcblxuICAgICAgICAgICAgICAgIGlmICghZXhjbHVkZUZyb21BZG1pbkRldGFpbCkge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0QWN0aW9ucy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlkOiAndmlldycsXG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uOiAndmlldycsXG4gICAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ1ZpZXcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGU6IGBWaWV3IHske3Byb3AuaWR9fWAsXG4gICAgICAgICAgICAgICAgICAgICAgICB1cmw6IGAvdmlldy0ke2VudGl0eU5hbWVMb3dlcn1gXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmICghZXhjbHVkZUZyb21BZG1pblVwZGF0ZSkge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0QWN0aW9ucy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlkOiAnZWRpdCcsXG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uOiAnZWRpdCcsXG4gICAgICAgICAgICAgICAgICAgICAgICBsYWJlbDogJ0VkaXQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGU6IGBFZGl0IHske3Byb3AuaWR9fWAsXG4gICAgICAgICAgICAgICAgICAgICAgICB1cmw6IGAvZWRpdC0ke2VudGl0eU5hbWVMb3dlcn1gXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmICghZXhjbHVkZUZyb21BZG1pbkRlbGV0ZSkge1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0QWN0aW9ucy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlkOiAnZGVsZXRlJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb246ICdkZWxldGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdEZWxldGUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGU6IGBEZWxldGUgeyR7cHJvcC5pZH19YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIG9wZW5Jbk1vZGFsOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgbW9kYWxDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RhbFR5cGU6ICdjb25maXJtJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb2RhbFBhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGl0bGU6IGBEZWxldGUgJHtlbnRpdHlOYW1lUGFzY2FsQ2FzZX0/YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudDogYEFyZSB5b3Ugc3VyZSB5b3Ugd2FudCB0byBkZWxldGUgdGhpcyAke2VudGl0eU5hbWVQYXNjYWxDYXNlfT8gVGhpcyBhY3Rpb24gY2Fubm90IGJlIHVuZG9uZS5gXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhcGlDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXBpTWV0aG9kOiBgREVMRVRFYCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzcG9uc2VLZXk6IGVudGl0eU5hbWVMb3dlcixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXBpVXJsOiBgJHtDUlVEQXBpUGF0aCA/IENSVURBcGlQYXRoIDogJyd9LyR7ZW50aXR5TmFtZUxvd2VyfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdWNjZXNzTWVzc2FnZTogYCR7ZW50aXR5TmFtZVBhc2NhbENhc2V9IGRlbGV0ZWQgc3VjY2Vzc2Z1bGx5YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBlcnJvck1lc3NhZ2U6IGBGYWlsZWQgdG8gZGVsZXRlICR7ZW50aXR5TmFtZVBhc2NhbENhc2V9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdWJtaXRTdWNjZXNzUmVkaXJlY3Q6IGAvbGlzdC0ke2VudGl0eU5hbWVMb3dlcn1gXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIC8vIE1lcmdlIGN1c3RvbSByb3cgYWN0aW9ucyB1c2luZyBpZGVudGlmaWVyLWJhc2VkIG92ZXJyaWRlXG4gICAgICAgICAgICAgICAgcHJvcENvbmZpZy5hY3Rpb25zID0gY3VzdG9tUm93QWN0aW9ucyBcbiAgICAgICAgICAgICAgICAgICAgPyBtZXJnZUFjdGlvbnMoZGVmYXVsdEFjdGlvbnMsIGN1c3RvbVJvd0FjdGlvbnMpXG4gICAgICAgICAgICAgICAgICAgIDogZGVmYXVsdEFjdGlvbnM7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBwcm9wQ29uZmlnO1xuICAgICAgICB9KTtcbn1cblxuLyoqXG4gKiBNRVJHRSBVVElMSVRZIEZVTkNUSU9OU1xuICogXG4gKiBUaGVzZSBmdW5jdGlvbnMgaW1wbGVtZW50IHRoZSBpZGVudGlmaWVyLWJhc2VkIG92ZXJyaWRlIHBhdHRlcm46XG4gKiAtIERlZmF1bHRzIGhhdmUgc3RhbmRhcmQgaWRlbnRpZmllcnMgKGUuZy4sICd2aWV3JywgJ2VkaXQnLCAnZGVsZXRlJylcbiAqIC0gQ3VzdG9tIGNvbmZpZ3Mgd2l0aCBzYW1lIGlkZW50aWZpZXIgb3ZlcnJpZGUgdGhlIGRlZmF1bHRcbiAqIC0gTmV3IGlkZW50aWZpZXJzIGdldCBhZGRlZCB0byB0aGUgcmVzdWx0XG4gKi9cblxuLyoqXG4gKiBNZXJnZSBkZWZhdWx0IGJ1dHRvbnMgd2l0aCBjdXN0b20gYnV0dG9ucyB1c2luZyBpZGVudGlmaWVyLWJhc2VkIG92ZXJyaWRlLlxuICogXG4gKiBAcGFyYW0gZGVmYXVsdHMgLSBEZWZhdWx0IGJ1dHRvbnMgKGZyb20gZ2VuZXJhdG9yKVxuICogQHBhcmFtIGN1c3RvbXMgLSBDdXN0b20gYnV0dG9ucyAoZnJvbSBlbnRpdHkgc2NoZW1hKVxuICogQHJldHVybnMgTWVyZ2VkIGJ1dHRvbiBhcnJheVxuICovXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VCdXR0b25zPFQgZXh0ZW5kcyB7IGlkPzogc3RyaW5nIH0+KFxuICAgIGRlZmF1bHRzOiBBcnJheTxUPixcbiAgICBjdXN0b21zOiBSZWFkb25seUFycmF5PFQ+IHwgQXJyYXk8VD4gPSBbXVxuKTogQXJyYXk8VD4ge1xuICAgIGNvbnN0IGN1c3RvbXNBcnJheSA9IFsuLi5jdXN0b21zXTsgIC8vIENvbnZlcnQgdG8gbXV0YWJsZSBhcnJheVxuICAgIGNvbnN0IGN1c3RvbU1hcCA9IG5ldyBNYXAoXG4gICAgICAgIGN1c3RvbXNBcnJheS5maWx0ZXIoYyA9PiBjLmlkKS5tYXAoYyA9PiBbYy5pZCwgY10pXG4gICAgKTtcbiAgICBcbiAgICAvLyBTdGFydCB3aXRoIGRlZmF1bHRzLCByZXBsYWNlIGlmIGN1c3RvbSBoYXMgc2FtZSBpZFxuICAgIGNvbnN0IG1lcmdlZCA9IGRlZmF1bHRzLm1hcChkZWZhdWx0QnRuID0+IFxuICAgICAgICBkZWZhdWx0QnRuLmlkICYmIGN1c3RvbU1hcC5oYXMoZGVmYXVsdEJ0bi5pZClcbiAgICAgICAgICAgID8gY3VzdG9tTWFwLmdldChkZWZhdWx0QnRuLmlkKSEgIC8vIE92ZXJyaWRlXG4gICAgICAgICAgICA6IGRlZmF1bHRCdG5cbiAgICApO1xuICAgIFxuICAgIC8vIEFkZCBjdXN0b20gYnV0dG9ucyB0aGF0IGRvbid0IG92ZXJyaWRlIGRlZmF1bHRzXG4gICAgY3VzdG9tc0FycmF5LmZvckVhY2goY3VzdG9tQnRuID0+IHtcbiAgICAgICAgaWYgKCFjdXN0b21CdG4uaWQgfHwgIWRlZmF1bHRzLnNvbWUoZCA9PiBkLmlkID09PSBjdXN0b21CdG4uaWQpKSB7XG4gICAgICAgICAgICBtZXJnZWQucHVzaChjdXN0b21CdG4pOyAgLy8gQWRkIG5ld1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgXG4gICAgcmV0dXJuIG1lcmdlZDtcbn1cblxuLyoqXG4gKiBNZXJnZSBkZWZhdWx0IGFjdGlvbnMgd2l0aCBjdXN0b20gYWN0aW9ucyB1c2luZyBpZGVudGlmaWVyLWJhc2VkIG92ZXJyaWRlLlxuICogU2FtZSBsb2dpYyBhcyBtZXJnZUJ1dHRvbnMgYnV0IHNlbWFudGljYWxseSBuYW1lZCBmb3IgYWN0aW9ucy5cbiAqIFxuICogQHBhcmFtIGRlZmF1bHRzIC0gRGVmYXVsdCBhY3Rpb25zIChmcm9tIGdlbmVyYXRvcilcbiAqIEBwYXJhbSBjdXN0b21zIC0gQ3VzdG9tIGFjdGlvbnMgKGZyb20gZW50aXR5IHNjaGVtYSlcbiAqIEByZXR1cm5zIE1lcmdlZCBhY3Rpb24gYXJyYXlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlQWN0aW9uczxUIGV4dGVuZHMgeyBpZD86IHN0cmluZyB9PihcbiAgICBkZWZhdWx0czogQXJyYXk8VD4sXG4gICAgY3VzdG9tczogUmVhZG9ubHlBcnJheTxUPiB8IEFycmF5PFQ+ID0gW11cbik6IEFycmF5PFQ+IHtcbiAgICByZXR1cm4gbWVyZ2VCdXR0b25zKGRlZmF1bHRzLCBbLi4uY3VzdG9tc10pOyAgLy8gU3ByZWFkIHRvIGhhbmRsZSBib3RoIHJlYWRvbmx5IGFuZCBtdXRhYmxlXG59XG5cbi8qKlxuICogTWVyZ2UgZmllbGQtbGV2ZWwgdmlzaWJpbGl0eS9lbmFibGVtZW50L2hlbHBUZXh0L3BsYWNlaG9sZGVyIGludG8gYmFzZSBwcm9wZXJ0aWVzLlxuICogXG4gKiBAcGFyYW0gYmFzZVByb3BlcnRpZXMgLSBCYXNlIHByb3BlcnRpZXMgZnJvbSBzY2hlbWFcbiAqIEBwYXJhbSBmaWVsZE92ZXJyaWRlcyAtIEZpZWxkIG92ZXJyaWRlcyBmcm9tIGZvcm1Db25maWcuZmllbGRzXG4gKiBAcmV0dXJucyBQcm9wZXJ0aWVzIHdpdGggb3ZlcnJpZGVzIG1lcmdlZFxuICovXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VGaWVsZFZpc2liaWxpdHk8VCBleHRlbmRzIHsgbmFtZTogc3RyaW5nIH0+KFxuICAgIGJhc2VQcm9wZXJ0aWVzOiBBcnJheTxUPixcbiAgICBmaWVsZE92ZXJyaWRlczogUmVhZG9ubHlBcnJheTx7XG4gICAgICAgIHJlYWRvbmx5IG5hbWU6IHN0cmluZztcbiAgICAgICAgcmVhZG9ubHkgdmlzaWJpbGl0eT86IGFueTtcbiAgICAgICAgcmVhZG9ubHkgZW5hYmxlbWVudD86IGFueTtcbiAgICAgICAgcmVhZG9ubHkgaGVscFRleHQ/OiBzdHJpbmc7XG4gICAgICAgIHJlYWRvbmx5IHBsYWNlaG9sZGVyPzogc3RyaW5nO1xuICAgIH0+IHwgQXJyYXk8e1xuICAgICAgICBuYW1lOiBzdHJpbmc7XG4gICAgICAgIHZpc2liaWxpdHk/OiBhbnk7XG4gICAgICAgIGVuYWJsZW1lbnQ/OiBhbnk7XG4gICAgICAgIGhlbHBUZXh0Pzogc3RyaW5nO1xuICAgICAgICBwbGFjZWhvbGRlcj86IHN0cmluZztcbiAgICB9PiA9IFtdXG4pOiBBcnJheTxUPiB7XG4gICAgY29uc3Qgb3ZlcnJpZGVNYXAgPSBuZXcgTWFwKFxuICAgICAgICBbLi4uZmllbGRPdmVycmlkZXNdLm1hcChmID0+IFtmLm5hbWUsIGZdKVxuICAgICk7XG4gICAgXG4gICAgLy8gVmFsaWRhdGlvbjogV2FybiBpZiBmaWVsZCBvdmVycmlkZSByZWZlcmVuY2VzIG5vbi1leGlzdGVudCBmaWVsZFxuICAgIGZpZWxkT3ZlcnJpZGVzLmZvckVhY2gob3ZlcnJpZGUgPT4ge1xuICAgICAgICBpZiAoIWJhc2VQcm9wZXJ0aWVzLnNvbWUocCA9PiBwLm5hbWUgPT09IG92ZXJyaWRlLm5hbWUpKSB7XG4gICAgICAgICAgICBEZWZhdWx0TG9nZ2VyLndhcm4oYEZpZWxkIG92ZXJyaWRlIFwiJHtvdmVycmlkZS5uYW1lfVwiIG5vdCBmb3VuZCBpbiBzY2hlbWEgcHJvcGVydGllcy4gVGhpcyBvdmVycmlkZSB3aWxsIGJlIGlnbm9yZWQuYCk7XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICBcbiAgICByZXR1cm4gYmFzZVByb3BlcnRpZXMubWFwKHByb3AgPT4ge1xuICAgICAgICBjb25zdCBvdmVycmlkZSA9IG92ZXJyaWRlTWFwLmdldChwcm9wLm5hbWUpO1xuICAgICAgICBcbiAgICAgICAgaWYgKCFvdmVycmlkZSkgcmV0dXJuIHByb3A7XG4gICAgICAgIFxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgLi4ucHJvcCxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS52aXNpYmlsaXR5ICE9PSB1bmRlZmluZWQgJiYgeyB2aXNpYmlsaXR5OiBvdmVycmlkZS52aXNpYmlsaXR5IH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLmVuYWJsZW1lbnQgIT09IHVuZGVmaW5lZCAmJiB7IGVuYWJsZW1lbnQ6IG92ZXJyaWRlLmVuYWJsZW1lbnQgfSksXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUuaGVscFRleHQgIT09IHVuZGVmaW5lZCAmJiB7IGhlbHBUZXh0OiBvdmVycmlkZS5oZWxwVGV4dCB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS5wbGFjZWhvbGRlciAhPT0gdW5kZWZpbmVkICYmIHsgcGxhY2Vob2xkZXI6IG92ZXJyaWRlLnBsYWNlaG9sZGVyIH0pXG4gICAgICAgIH07XG4gICAgfSk7XG59XG5cbi8qKlxuICogTWVyZ2UgY29sdW1uLWxldmVsIHZpc2liaWxpdHkvd2lkdGgvZml4ZWQgaW50byBiYXNlIHByb3BlcnRpZXMuXG4gKiBcbiAqIEBwYXJhbSBiYXNlUHJvcGVydGllcyAtIEJhc2UgcHJvcGVydGllcyBmcm9tIHNjaGVtYVxuICogQHBhcmFtIGNvbHVtbk92ZXJyaWRlcyAtIENvbHVtbiBvdmVycmlkZXMgZnJvbSB0YWJsZUNvbmZpZy5jb2x1bW5zXG4gKiBAcmV0dXJucyBQcm9wZXJ0aWVzIHdpdGggY29sdW1uIG92ZXJyaWRlcyBtZXJnZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlQ29sdW1uVmlzaWJpbGl0eTxUIGV4dGVuZHMgeyBuYW1lOiBzdHJpbmcgfT4oXG4gICAgYmFzZVByb3BlcnRpZXM6IEFycmF5PFQ+LFxuICAgIGNvbHVtbk92ZXJyaWRlczogUmVhZG9ubHlBcnJheTx7XG4gICAgICAgIHJlYWRvbmx5IGZpZWxkOiBzdHJpbmc7XG4gICAgICAgIHJlYWRvbmx5IHZpc2liaWxpdHk/OiBhbnk7XG4gICAgICAgIHJlYWRvbmx5IHdpZHRoPzogc3RyaW5nIHwgbnVtYmVyO1xuICAgICAgICByZWFkb25seSBmaXhlZD86ICdsZWZ0JyB8ICdyaWdodCc7XG4gICAgICAgIHJlYWRvbmx5IGdyb3VwVGl0bGU/OiBzdHJpbmc7XG4gICAgfT4gfCBBcnJheTx7XG4gICAgICAgIGZpZWxkOiBzdHJpbmc7XG4gICAgICAgIHZpc2liaWxpdHk/OiBhbnk7XG4gICAgICAgIHdpZHRoPzogc3RyaW5nIHwgbnVtYmVyO1xuICAgICAgICBmaXhlZD86ICdsZWZ0JyB8ICdyaWdodCc7XG4gICAgICAgIGdyb3VwVGl0bGU/OiBzdHJpbmc7XG4gICAgfT4gPSBbXVxuKTogQXJyYXk8VD4ge1xuICAgIGNvbnN0IG92ZXJyaWRlTWFwID0gbmV3IE1hcChcbiAgICAgICAgWy4uLmNvbHVtbk92ZXJyaWRlc10ubWFwKGMgPT4gW2MuZmllbGQsIGNdKVxuICAgICk7XG4gICAgXG4gICAgLy8gVmFsaWRhdGlvbjogV2FybiBpZiBjb2x1bW4gb3ZlcnJpZGUgcmVmZXJlbmNlcyBub24tZXhpc3RlbnQgY29sdW1uXG4gICAgY29sdW1uT3ZlcnJpZGVzLmZvckVhY2gob3ZlcnJpZGUgPT4ge1xuICAgICAgICBpZiAoIWJhc2VQcm9wZXJ0aWVzLnNvbWUocCA9PiBwLm5hbWUgPT09IG92ZXJyaWRlLmZpZWxkKSkge1xuICAgICAgICAgICAgRGVmYXVsdExvZ2dlci53YXJuKGBDb2x1bW4gb3ZlcnJpZGUgXCIke292ZXJyaWRlLmZpZWxkfVwiIG5vdCBmb3VuZCBpbiBzY2hlbWEgcHJvcGVydGllcy4gVGhpcyBvdmVycmlkZSB3aWxsIGJlIGlnbm9yZWQuYCk7XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICBcbiAgICByZXR1cm4gYmFzZVByb3BlcnRpZXMubWFwKHByb3AgPT4ge1xuICAgICAgICBjb25zdCBvdmVycmlkZSA9IG92ZXJyaWRlTWFwLmdldChwcm9wLm5hbWUpO1xuICAgICAgICBcbiAgICAgICAgaWYgKCFvdmVycmlkZSkgcmV0dXJuIHByb3A7XG4gICAgICAgIFxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgLi4ucHJvcCxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS52aXNpYmlsaXR5ICE9PSB1bmRlZmluZWQgJiYgeyB2aXNpYmlsaXR5OiBvdmVycmlkZS52aXNpYmlsaXR5IH0pLFxuICAgICAgICAgICAgLi4uKG92ZXJyaWRlLndpZHRoICE9PSB1bmRlZmluZWQgJiYgeyB3aWR0aDogb3ZlcnJpZGUud2lkdGggfSksXG4gICAgICAgICAgICAuLi4ob3ZlcnJpZGUuZml4ZWQgIT09IHVuZGVmaW5lZCAmJiB7IGZpeGVkOiBvdmVycmlkZS5maXhlZCB9KSxcbiAgICAgICAgICAgIC4uLihvdmVycmlkZS5ncm91cFRpdGxlICE9PSB1bmRlZmluZWQgJiYgeyBncm91cFRpdGxlOiBvdmVycmlkZS5ncm91cFRpdGxlIH0pXG4gICAgICAgIH07XG4gICAgfSk7XG59XG4iXX0=
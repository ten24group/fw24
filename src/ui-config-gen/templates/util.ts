import { 
    BaseEntityService, 
    FieldMetadata, 
    TIOSchemaAttribute, 
    isSelectFieldMetadata,
    SelectFieldMetadata,
    EntityAttribute,
    IRelationFieldConfig
} from "../../entity";
import type { IEntityPageAction, Template } from '../../entity/base-entity';
import type { IApplicationConfig, IDuplicatedFieldDetectionConfig } from '../../interfaces/config';
import { DefaultLogger } from "../../logging";
import { pascalCase } from "../../utils";
import { makeCreateEntityFormConfig } from "./create-entity";
import { makeViewEntityListConfig } from "./list-entity";
import { makeViewEntityDetailConfig } from "./view-entity";

// =======================================================================================
// SMART DUPLICATED FIELD DETECTION - ENHANCED ALGORITHM
// =======================================================================================

/**
 * Detection result with rich metadata
 */
interface DuplicatedFieldDetectionResult {
    /** Primary display field detected (e.g., 'teamName') */
    primaryField?: string;
    
    /** Generated template string (e.g., '{teamName}' or '{teamName} ({teamCode})') */
    template?: string;
    
    /** All detected fields by category */
    detectedFields: {
        /** Display fields: Name, Title, Label */
        display?: string[];
        /** Visual fields: Logo, Image, Icon */
        visual?: string[];
        /** Meta fields: Code, Slug, Key */
        meta?: string[];
    };
    
    /** Confidence level */
    confidence: 'high' | 'medium' | 'low';
    
    /** Detection method used */
    method: string;
    
    /** Pattern that matched */
    pattern: string;
}

/**
 * Parsed components from relation field name
 */
interface ParsedRelationField {
    /** Prefix (e.g., 'home', 'away', 'competitor1') */
    prefix?: string;
    /** Base name without prefix and 'Id' suffix (e.g., 'Team') */
    baseName: string;
    /** Whether field ends with 'Id' */
    hasIdSuffix: boolean;
    /** Original field name */
    originalField: string;
}

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
const DEFAULT_DETECTION_CONFIG: Required<IDuplicatedFieldDetectionConfig> = {
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
function mergeDetectionConfigs(
    globalConfig?: IDuplicatedFieldDetectionConfig,
    entityConfig?: IDuplicatedFieldDetectionConfig,
    relationHints?: {
        preferredFields?: string[];
        excludeFields?: string[];
        templateStyle?: 'simple' | 'composite';
    }
): Required<IDuplicatedFieldDetectionConfig> & { preferredFields?: string[]; excludeFields?: string[] } {
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
    const result: any = { ...merged };
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
function parseRelationField(
    fieldId: string,
    prefixes: string[]
): ParsedRelationField {
    // Build regex for prefix detection: ^(prefix1|prefix2|...)(\\d*)(.+)$
    // Use case-insensitive matching
    const prefixPattern = new RegExp(
        `^(${prefixes.join('|')})(\\d*)(.+)$`,
        'i'
    );
    
    const match = fieldId.match(prefixPattern);
    
    if (match) {
        const [, prefix, num, rest] = match;
        const hasIdSuffix = rest.toLowerCase().endsWith('id');
        const baseName = hasIdSuffix 
            ? rest.substring(0, rest.length - 2)
            : rest;
        
        return {
            prefix: prefix + num,  // 'home' or 'competitor1'
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
function generateSearchPatterns(
    parsed: ParsedRelationField,
    entityName: string,
    suffixes: string[],
    preferredFields?: string[]
): string[] {
    const patterns: string[] = [];
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
function searchFieldsByPatterns(
    allProperties: TIOSchemaAttribute[],
    patterns: string[],
    excludeFields?: string[]
): string[] {
    const excludeSet = new Set(excludeFields?.map(f => f.toLowerCase()) || []);
    const found: string[] = [];
    const seenLower = new Set<string>();
    
    for (const pattern of patterns) {
        const patternLower = pattern.toLowerCase();
        
        // Skip if already found or excluded
        if (seenLower.has(patternLower) || excludeSet.has(patternLower)) {
            continue;
        }
        
        // Find matching field (case-insensitive)
        const match = allProperties.find(p => 
            p.id?.toLowerCase() === patternLower &&
            !excludeSet.has(p.id.toLowerCase())
        );
        
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
function calculateConfidence(
    detectedField: string,
    parsed: ParsedRelationField,
    entityName: string,
    method: 'preferred' | 'prefix' | 'entity' | 'base'
): 'high' | 'medium' | 'low' {
    // Preferred fields = high confidence (developer explicitly specified)
    if (method === 'preferred') return 'high';
    
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
    if (method === 'entity') return 'high';
    
    // Base name match = medium (could be coincidental)
    if (method === 'base') return 'medium';
    
    return 'low';
}

/**
 * Generate template string from detected fields.
 */
function generateTemplate(
    primaryField: string,
    allDetectedFields: DuplicatedFieldDetectionResult['detectedFields'],
    templateStyle: 'simple' | 'composite'
): string {
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
function detectDuplicatedRelationFields(
    allProperties: TIOSchemaAttribute[],
    relationFieldId: string,
    relatedEntityName: string,
    globalConfig?: IDuplicatedFieldDetectionConfig,
    entityConfig?: IDuplicatedFieldDetectionConfig,
    relationHints?: {
        preferredFields?: string[];
        excludeFields?: string[];
        templateStyle?: 'simple' | 'composite';
    }
): DuplicatedFieldDetectionResult | undefined {
    // Merge configurations
    const config = mergeDetectionConfigs(globalConfig, entityConfig, relationHints);
    
    // Check if detection is enabled
    if (!config.enabled) {
        return undefined;
    }
    
    // Parse relation field
    const parsed = parseRelationField(relationFieldId, config.prefixes);
    
    // Search for display fields (Name, Title, Label)
    const displayPatterns = generateSearchPatterns(
        parsed,
        relatedEntityName,
        config.suffixes?.display || [],
        config.preferredFields
    );
    const displayFields = searchFieldsByPatterns(allProperties, displayPatterns, config.excludeFields);
    
    // Search for visual fields (Logo, Image, Icon)
    const visualPatterns = generateSearchPatterns(
        parsed,
        relatedEntityName,
        config.suffixes?.visual || []
    );
    const visualFields = searchFieldsByPatterns(allProperties, visualPatterns, config.excludeFields);
    
    // Search for meta fields (Code, Slug, Key)
    const metaPatterns = generateSearchPatterns(
        parsed,
        relatedEntityName,
        config.suffixes?.meta || []
    );
    const metaFields = searchFieldsByPatterns(allProperties, metaPatterns, config.excludeFields);
    
    // No fields detected
    if (displayFields.length === 0) {
        return undefined;
    }
    
    // Determine detection method
    const primaryField = displayFields[0];
    let method: 'preferred' | 'prefix' | 'entity' | 'base' = 'base';
    let pattern = 'unknown';
    
    if (config.preferredFields && config.preferredFields.includes(primaryField)) {
        method = 'preferred';
        pattern = 'preferred_field';
    } else if (parsed.prefix && primaryField.toLowerCase().startsWith(parsed.prefix.toLowerCase())) {
        method = 'prefix';
        pattern = `${parsed.prefix}{entity}{suffix}`;
    } else if (primaryField.toLowerCase().startsWith(relatedEntityName.toLowerCase())) {
        method = 'entity';
        pattern = `{entity}{suffix}`;
    } else {
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
            DefaultLogger.info(`[DuplicatedFieldDetection] Skipping ${relationFieldId}: confidence ${confidence} < threshold ${config.confidenceThreshold}`);
        }
        return undefined;
    }
    
    // Generate template
    const template = generateTemplate(
        primaryField,
        { display: displayFields, visual: visualFields, meta: metaFields },
        config.templateStyle
    );
    
    // Debug logging
    if (config.debug) {
        DefaultLogger.info(`[DuplicatedFieldDetection] ${relationFieldId} → ${template} (confidence: ${confidence}, method: ${method})`);
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
function detectDuplicatedRelationFieldTemplate(
    allProperties: TIOSchemaAttribute[],
    relationFieldId: string,
    relatedEntityName: string
): string | undefined {
    const result = detectDuplicatedRelationFields(
        allProperties,
        relationFieldId,
        relatedEntityName
    );
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
export function generateRelationFallback(
    entityName: string,
    idField: string,
    entityService?: BaseEntityService<any>
): NonNullable<IRelationFieldConfig['displayConfig']>['fallback'] {
    // Try to get entity metadata for better fallback text
    const entityMetadata = entityService?.getEntitySchema?.().model;
    const displayName = entityMetadata?.entityNamePlural || pascalCase(entityName);
    
    return {
        // Backend pre-generates fallback template (intentionally string-only, not Template type)
        // Frontend will use this when only ID is available
        template: `${displayName}: {${idField}}`,  // e.g., "Team: {teamId}"
        linkText: `View ${displayName}`,           // e.g., "View Team"
        modalButtonText: `${displayName} Details`  // e.g., "Team Details"
    };
}

export function formatEntityAttributeForFormOrDetail(
    thisProp: TIOSchemaAttribute,
    type: 'create' | 'update' | 'detail',
    entityService: BaseEntityService<any>,
    allProperties?: TIOSchemaAttribute[],  // Optional: for detecting duplicated relation fields
    globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions']  // Optional: global UI config options
) {
    const formatted: any = {
        ...thisProp,
        label: thisProp.name,  // Respect custom label from entity attribute
        column: thisProp.id,
        fieldType: thisProp.fieldType || 'text',  // fieldType should already be inferred in base-service
        hidden: thisProp.hasOwnProperty('isVisible') && !thisProp.isVisible
    };

    // Handle addNewOption (OLD - deprecated, generates embedded config) or addNewOptionConfig (NEW - just pass through reference)
    if (isSelectFieldMetadata(thisProp) && [ 'create', 'update' ].includes(type)) {
        const selectField = thisProp as SelectFieldMetadata;
        
        if (selectField.addNewOptionConfig) {
            // NEW WAY: User provided addNewOptionConfig reference - just pass it through
            formatted[ 'addNewOptionConfig' ] = selectField.addNewOptionConfig;
            
        } else if (selectField.addNewOption) {
            // OLD WAY (DEPRECATED): Transform addNewOption to addNewOptionConfig for backward compatibility
            const { entityName, overrideConfig } = selectField.addNewOption;

            if (entityName && entityService.hasEntityServiceByEntityName(entityName)) {
                formatted[ 'addNewOptionConfig' ] = {
                    entityName: entityName,
                    pageType: 'create' as const,
                    overrideConfig: overrideConfig || {
                        submitSuccessRedirect: undefined,  // Stay in modal after creation
                        formButtons: [
                            { text: "Add", action: "submit" },
                            { text: "Cancel", action: "cancel" }
                        ]
                    }
                };
            } else {
                DefaultLogger.warn(`formatEntityAttributeForFormOrDetail: Could not find related-entity-service for entity [${entityName}] in ${entityService.constructor.name}`);
            }
        }
    }

    // Handle relation fields (DATA LAYER + UI LAYER)
    if (thisProp.relation && type === 'detail') {
        const relation = thisProp.relation;
        const { entityName, type: relationType, identifiers } = relation;
        const entityNameLower = entityName.toLowerCase();

        if (!entityService.hasEntityServiceByEntityName(entityName)) {
            DefaultLogger.warn(`formatEntityAttributeForFormOrDetail: Could not find related-entity-service for entity [${entityName}] in ${entityService.constructor.name}`);
            return formatted;
        }

        // Resolve identifiers (could be direct value or lazy function)
        const resolvedIdentifiers = typeof identifiers === 'function' ? identifiers() : identifiers;

        // Safety check for array identifiers
        if (Array.isArray(resolvedIdentifiers)) {
            if (resolvedIdentifiers.length === 0) {
                DefaultLogger.warn(`formatEntityAttributeForFormOrDetail: Empty identifiers array for relation [${entityName}]`);
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
        const userRelationConfig = thisProp.relationConfig as IRelationFieldConfig | undefined;

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
            const fallbackConfig = generateRelationFallback(
                entityName,
                primaryIdentifier.source,
                relatedEntityService
            );

            // Auto-detect duplicated relation field (e.g., teamName for teamId)
            // NEW: Use enhanced detection with config support
            let autoTemplate: string | undefined = undefined;
            let detectionMetadata: any = undefined;
            
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
                const detectionResult = detectDuplicatedRelationFields(
                    allProperties,
                    thisProp.id,
                    entityName,
                    globalConfig,
                    entityConfig,
                    relationHints
                );
                
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

            const generatedRelationConfig: IRelationFieldConfig = {
                routePattern: routePattern,
                // Pass ALL identifier mappings (supports composite keys)
                identifierMapping: identifierMappings.length === 1 
                    ? identifierMappings[0]  // Single: return object
                    : identifierMappings,     // Multiple: return array
                modalConfigRef: userRelationConfig?.modalConfigRef || {
                    entityName: entityName,
                    pageType: 'view' as const,
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
            if(globalUIConfigOptions?.duplicatedFieldDetection?.debug) {
                generatedRelationConfig.displayConfig!['_detectionMetadata'] = detectionMetadata;
            }

            formatted[ 'relationConfig' ] = generatedRelationConfig;

            // Backward compatibility: Keep isLink and linkConfig
            formatted[ 'isLink' ] = true;
            formatted[ 'linkConfig' ] = {
                routePattern: routePattern
            };

        } else if (relationType.endsWith('to-many')) {
            // TO-MANY: Show count + modal icon (opens filtered list)
            // Route pattern: Use custom (from relationConfig) or default to /list-{entity}
            const routePattern = userRelationConfig?.routePattern
                || `/list-${entityNameLower}`;

            // Build default filters to show only related items
            // For example, if we're viewing a Team and this field shows Games,
            // we want to filter games where teamId = current team's ID
            // For composite keys, add all identifiers as filters
            const defaultFilters: Record<string, any> = {};
            identifierMappings.forEach(mapping => {
                defaultFilters[mapping.target] = `:${mapping.source}`;
            });

            // Generate fallback configuration for to-many (shows count)
            const fallbackConfig = generateRelationFallback(
                entityName,
                primaryIdentifier.source,
                relatedEntityService
            );

            const generatedRelationConfig: IRelationFieldConfig = {
                routePattern: routePattern,
                // Pass ALL identifier mappings (supports composite keys)
                identifierMapping: identifierMappings.length === 1 
                    ? identifierMappings[0]  // Single: return object
                    : identifierMappings,     // Multiple: return array
                modalConfigRef: userRelationConfig?.modalConfigRef || {
                    entityName: entityName,
                    pageType: 'list' as const,
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
                generatedRelationConfig.modalConfigRef!.overrideConfig = {
                    ...userRelationConfig.modalConfigRef.overrideConfig,
                    defaultFilters: {
                        ...defaultFilters,
                        ...(userRelationConfig.modalConfigRef.overrideConfig.defaultFilters || {})
                    }
                };
            }

            formatted[ 'relationConfig' ] = generatedRelationConfig;
         }
    }

    // Handle nested structures (map and list types)
    if (thisProp.type === 'map' && thisProp.properties) {
        formatted[ 'properties' ] = formatEntityAttributesForFormOrDetail(thisProp.properties, type, entityService);
    } else if (thisProp.type === 'list') {
        // For list types, check if items are maps (nested structures)
        // Note: items property exists on list-type attributes but not in base EntityAttribute type
        const extendedProp = thisProp as TIOSchemaAttribute & { items?: { type: string; properties?: TIOSchemaAttribute[] } };
        if (extendedProp.items?.type === 'map' && extendedProp.items.properties) {
            formatted[ 'items' ] = {
                ...formatted[ 'items' ],
                properties: formatEntityAttributesForFormOrDetail(extendedProp.items.properties, type, entityService)
            };
        }
    }

    // TODO: add support for set, enum, and custom-types

    return formatted;
}

export function formatEntityAttributesForFormOrDetail(
    properties: TIOSchemaAttribute[],
    type: 'create' | 'update' | 'detail',
    entityService: BaseEntityService<any>
) {

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

export function formatEntityAttributesForCreate(properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>, globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions']) {
    return properties
        .filter(prop => prop && (!prop.hasOwnProperty('isCreatable') || prop.isCreatable))
        .map((att) => formatEntityAttributeForFormOrDetail(att, 'create', entityService, properties, globalUIConfigOptions));
}

export function formatEntityAttributesForUpdate(properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>, globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions']) {
    return properties
        .filter(prop => prop && (!prop.hasOwnProperty('isEditable') || prop.isEditable))
        .map((att) => formatEntityAttributeForFormOrDetail(att, 'update', entityService, properties, globalUIConfigOptions));
}

export function formatEntityAttributesForDetail(properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>, globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions']) {
    return properties
        .filter(prop => prop && (!prop.hasOwnProperty('isVisible') || prop.isVisible))
        .map((att) => formatEntityAttributeForFormOrDetail(att, 'detail', entityService, properties, globalUIConfigOptions));
}

export type ListingPropConfig = Pick<FieldMetadata, 'fieldType' | 'placeholder' | 'helpText' | 'filterConfig'> & {
    name: string,
    dataIndex: string,
    hidden?: boolean,
    actions?: Array<IEntityPageAction>,
    relationConfig?: IRelationFieldConfig,  // For rendering relations with links/modals
    template?: Template,  // For template-based rendering
    isIdentifier?: boolean,  // For identifier fields
    isLink?: boolean,  // For backward compatibility
    linkConfig?: { routePattern: string; displayText?: string },  // For backward compatibility
};

export function formatEntityAttributesForList(
    entityName: string, 
    properties: TIOSchemaAttribute[], 
    entityService: BaseEntityService<any>,
    {
        CRUDApiPath,
        excludeFromAdminUpdate,
        excludeFromAdminDelete,
        excludeFromAdminDetail,
        customRowActions,
        globalUIConfigOptions
    }: {
        CRUDApiPath?: string,
        excludeFromAdminUpdate?: boolean,
        excludeFromAdminDelete?: boolean,
        excludeFromAdminDetail?: boolean,
        customRowActions?: ReadonlyArray<IEntityPageAction> | Array<IEntityPageAction>,
        globalUIConfigOptions?: IApplicationConfig['uiConfigGenOptions']  // NEW: Global config options
    }
) {

    const entityNameLower = entityName.toLowerCase();
    const entityNamePascalCase = pascalCase(entityName);

    return properties
        .filter(prop => prop && prop.isListable)
        .map(prop => {
            // Use same formatting logic as details/forms (includes relationConfig generation)
            // Pass all properties so it can detect duplicated relation fields (e.g., teamName for teamId)
            const formatted = formatEntityAttributeForFormOrDetail(prop, 'detail', entityService, properties, globalUIConfigOptions);
            
            // Override/add list-specific properties
            const propConfig: ListingPropConfig = {
                ...formatted,
                name: formatted.label || formatted.name,  // Ensure name is set for table column header
                dataIndex: `${prop.id}`,
                fieldType: formatted.fieldType || 'text',
                hidden: prop.hasOwnProperty('isVisible') && !prop.isVisible
            };

            if (prop.isIdentifier) {
                // Build default row actions with IDs
                const defaultActions: Array<IEntityPageAction> = [];

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
export function mergeButtons<T extends { id?: string }>(
    defaults: Array<T>,
    customs: ReadonlyArray<T> | Array<T> = []
): Array<T> {
    const customsArray = [...customs];  // Convert to mutable array
    const customMap = new Map(
        customsArray.filter(c => c.id).map(c => [c.id, c])
    );
    
    // Start with defaults, replace if custom has same id
    const merged = defaults.map(defaultBtn => 
        defaultBtn.id && customMap.has(defaultBtn.id)
            ? customMap.get(defaultBtn.id)!  // Override
            : defaultBtn
    );
    
    // Add custom buttons that don't override defaults
    customsArray.forEach(customBtn => {
        if (!customBtn.id || !defaults.some(d => d.id === customBtn.id)) {
            merged.push(customBtn);  // Add new
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
export function mergeActions<T extends { id?: string }>(
    defaults: Array<T>,
    customs: ReadonlyArray<T> | Array<T> = []
): Array<T> {
    return mergeButtons(defaults, [...customs]);  // Spread to handle both readonly and mutable
}

/**
 * Merge field-level visibility/enablement/helpText/placeholder into base properties.
 * 
 * @param baseProperties - Base properties from schema
 * @param fieldOverrides - Field overrides from formConfig.fields
 * @returns Properties with overrides merged
 */
export function mergeFieldVisibility<T extends { name: string }>(
    baseProperties: Array<T>,
    fieldOverrides: ReadonlyArray<{
        readonly name: string;
        readonly visibility?: any;
        readonly enablement?: any;
        readonly helpText?: string;
        readonly placeholder?: string;
    }> | Array<{
        name: string;
        visibility?: any;
        enablement?: any;
        helpText?: string;
        placeholder?: string;
    }> = []
): Array<T> {
    const overrideMap = new Map(
        [...fieldOverrides].map(f => [f.name, f])
    );
    
    // Validation: Warn if field override references non-existent field
    fieldOverrides.forEach(override => {
        if (!baseProperties.some(p => p.name === override.name)) {
            DefaultLogger.warn(`Field override "${override.name}" not found in schema properties. This override will be ignored.`);
        }
    });
    
    return baseProperties.map(prop => {
        const override = overrideMap.get(prop.name);
        
        if (!override) return prop;
        
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
export function mergeColumnVisibility<T extends { name: string }>(
    baseProperties: Array<T>,
    columnOverrides: ReadonlyArray<{
        readonly field: string;
        readonly visibility?: any;
        readonly width?: string | number;
        readonly fixed?: 'left' | 'right';
        readonly groupTitle?: string;
    }> | Array<{
        field: string;
        visibility?: any;
        width?: string | number;
        fixed?: 'left' | 'right';
        groupTitle?: string;
    }> = []
): Array<T> {
    const overrideMap = new Map(
        [...columnOverrides].map(c => [c.field, c])
    );
    
    // Validation: Warn if column override references non-existent column
    columnOverrides.forEach(override => {
        if (!baseProperties.some(p => p.name === override.field)) {
            DefaultLogger.warn(`Column override "${override.field}" not found in schema properties. This override will be ignored.`);
        }
    });
    
    return baseProperties.map(prop => {
        const override = overrideMap.get(prop.name);
        
        if (!override) return prop;
        
        return {
            ...prop,
            ...(override.visibility !== undefined && { visibility: override.visibility }),
            ...(override.width !== undefined && { width: override.width }),
            ...(override.fixed !== undefined && { fixed: override.fixed }),
            ...(override.groupTitle !== undefined && { groupTitle: override.groupTitle })
        };
    });
}

import {
    BaseEntityService,
    FieldMetadata,
    TIOSchemaAttribute,
    isSelectFieldMetadata,
    SelectFieldMetadata,
    EntityAttribute,
    IRelationFieldConfig,
    TIOSchemaAttributesMap,
    EntitySchema,
    IFilterSegment,
    createFieldOptions
} from "../../entity";
import type { RelationEntityOptionConfig, FieldOptionsAPIConfig, IEntityPageAction, Template, FieldOption, IFilterSegmentGroup, ITableColumns, ITableColumn, ITableColumnConfig } from '../../entity/base-entity';
import { FrameworkError } from "../../errors";
import type { IApplicationConfig, IDuplicatedFieldDetectionConfig, ISegmentAutoGenerationConfig } from '../../interfaces/config';
import { DefaultLogger } from "../../logging";
import { pascalCase, toHumanReadableName } from "../../utils";

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
        display: [ 'Name', 'Title', 'Label', 'DisplayName' ],
        // Generic visual asset patterns (universal)
        visual: [ 'Logo', 'Image', 'Icon', 'Avatar', 'Picture' ],
        // Generic metadata patterns (universal)
        meta: [ 'Code', 'Slug', 'Key', 'Identifier', 'RemoteId' ]
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
        const [ , prefix, num, rest ] = match;
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
    allDetectedFields: DuplicatedFieldDetectionResult[ 'detectedFields' ],
    templateStyle: 'simple' | 'composite'
): string {
    if (templateStyle === 'simple') {
        return `{${primaryField}}`;
    }

    // Composite: try to include meta field (code/slug) if available
    if (templateStyle === 'composite' && allDetectedFields.meta && allDetectedFields.meta.length > 0) {
        const metaField = allDetectedFields.meta[ 0 ];
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
    const primaryField = displayFields[ 0 ];
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
    if (thresholdOrder[ confidence ] < thresholdOrder[ config.confidenceThreshold ]) {
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
export function generateRelationFallback(
    entityName: string,
    idField: string,
    entityService?: BaseEntityService<any>
): NonNullable<IRelationFieldConfig[ 'displayConfig' ]>[ 'fallback' ] {
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

/**
 * Label field detection result with confidence scoring
 */
interface LabelFieldDetectionResult {
    field: string;
    confidence: 'high' | 'medium';  // Only high or medium - no low confidence results returned
    method: 'metadata' | 'common-pattern' | 'entity-pattern' | 'suffix-pattern';
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
function findLabelField(
    schema: EntitySchema<any, any, any>,
    entityName: string,
    options?: {
        /** Minimum confidence level required (default: 'medium') */
        minConfidence?: 'high' | 'medium';
        /** Enable debug logging (default: false) */
        debug?: boolean;
    }
): string | undefined {
    const minConfidence = options?.minConfidence || 'medium';
    const debug = options?.debug || false;

    let result: LabelFieldDetectionResult | undefined;

    // Get all attributes from schema
    const attributes = schema.attributes;
    const attributeNames = Object.keys(attributes);

    // Priority 1: Entity metadata - HIGH confidence
    const entityNameAttribute = schema.model.entityNameAttribute;
    if (entityNameAttribute && attributes[ entityNameAttribute ]) {
        result = {
            field: entityNameAttribute,
            confidence: 'high',
            method: 'metadata'
        };
        if (debug) {
            DefaultLogger.info(`[findLabelField] ${entityName}: Found via metadata - ${entityNameAttribute} (HIGH confidence)`);
        }
    }

    // Priority 2: Common display patterns - HIGH confidence
    if (!result) {
        const commonPatterns = [ 'name', 'title', 'label', 'displayName', 'displayname' ];
        for (const pattern of commonPatterns) {
            const match = attributeNames.find(attr => attr.toLowerCase() === pattern);
            if (match) {
                result = {
                    field: match,
                    confidence: 'high',
                    method: 'common-pattern'
                };
                if (debug) {
                    DefaultLogger.info(`[findLabelField] ${entityName}: Found via common pattern '${pattern}' - ${match} (HIGH confidence)`);
                }
                break;
            }
        }
    }

    // Priority 3: Entity-specific patterns - HIGH confidence
    if (!result) {
        const entityLower = entityName.toLowerCase();
        const entitySpecificSuffixes = [ 'Name', 'Title', 'Label' ];

        for (const suffix of entitySpecificSuffixes) {
            // Try exact match: e.g., 'teamName' for entity 'team'
            const exactMatch = attributeNames.find(attr =>
                attr.toLowerCase() === `${entityLower}${suffix.toLowerCase()}`
            );
            if (exactMatch) {
                result = {
                    field: exactMatch,
                    confidence: 'high',
                    method: 'entity-pattern'
                };
                if (debug) {
                    DefaultLogger.info(`[findLabelField] ${entityName}: Found via entity-specific pattern - ${exactMatch} (HIGH confidence)`);
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

        for (const pattern of [ displayNameSuffixPattern, labelSuffixPattern, titleSuffixPattern, nameSuffixPattern, codeSuffixPattern ]) {
            const match = attributeNames.find(attr => pattern.test(attr));
            if (match) {
                result = {
                    field: match,
                    confidence: 'medium',
                    method: 'suffix-pattern'
                };
                if (debug) {
                    DefaultLogger.info(`[findLabelField] ${entityName}: Found via suffix pattern - ${match} (MEDIUM confidence)`);
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
                DefaultLogger.warn(`[findLabelField] ${entityName}: Field '${result.field}' found with MEDIUM confidence, but HIGH confidence required. Returning undefined.`);
            }
            return undefined;
        }

        return result.field;
    }

    // No suitable field found
    if (debug) {
        DefaultLogger.warn(`[findLabelField] ${entityName}: No suitable label field found with sufficient confidence.`);
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
export function resolveRelationOptionConfig(
    relationConfig: RelationEntityOptionConfig,
    relationAttribute: TIOSchemaAttribute & { relation: NonNullable<TIOSchemaAttribute[ 'relation' ]> },
    entityService: BaseEntityService<any>,
    globalUIConfigOptions?: IApplicationConfig[ 'uiConfigGenOptions' ]
): FieldOptionsAPIConfig<any> | undefined {
    const { entityName, customApiUrl, optionMapping, ...rest } = relationConfig;
    const relation = relationAttribute.relation;

    // Get related entity service
    if (!entityService.hasEntityServiceByEntityName(entityName)) {
        DefaultLogger.warn(`[resolveRelationOptionConfig] Entity service not found for: ${entityName}`);
        return undefined;
    }

    const relatedService = entityService.getEntityServiceByEntityName(entityName);
    const relatedSchema = relatedService?.getEntitySchema?.();

    if (!relatedSchema) {
        DefaultLogger.warn(`[resolveRelationOptionConfig] Schema not found for entity: ${entityName}`);
        return undefined;
    }

    // 1. Resolve API URL
    const entityNameLower = entityName.toLowerCase();
    const crudPath = relatedSchema.model.CRUDApiPath || '';
    const apiUrl = customApiUrl || `${crudPath}/${entityNameLower}`;

    // 2. Resolve value field from relation identifiers
    const resolvedIdentifiers = typeof relation.identifiers === 'function' ? relation.identifiers() : relation.identifiers;
    const identifierMappings = Array.isArray(resolvedIdentifiers) ? resolvedIdentifiers : [ resolvedIdentifiers ];
    const primaryIdentifier = identifierMappings[ 0 ];
    const valueField = String(primaryIdentifier.target);

    // 3. Resolve label field from entity metadata or custom mapping
    let labelField = valueField; // Default fallback to value field

    if (optionMapping?.label) {
        // Custom label provided - use it
        labelField = optionMapping.label as string;
    } else {
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
            value: (optionMapping as any)?.value || valueField
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
export function generateFilterConfig(
    attribute: TIOSchemaAttribute,
    entityService?: BaseEntityService<any>,
    globalUIConfigOptions?: IApplicationConfig[ 'uiConfigGenOptions' ]
): FieldMetadata[ 'filterConfig' ] | undefined {
    // 1. If explicit filterConfig exists, use it (highest priority)
    if (attribute.filterConfig) {
        return attribute.filterConfig;
    }

    // 2. If field has explicit options config, use it
    if ('options' in attribute) {
        const options = (attribute as SelectFieldMetadata).options;

        // RelationEntityOptionConfig (has entityName) → resolve to FieldOptionsAPIConfig
        const isRelationConfig = typeof options === 'object' && !Array.isArray(options) && 'entityName' in options;

        let resolvedConfig: FieldOptionsAPIConfig<any> | FieldOption[] | undefined;

        // Inline array → use as is
        if (Array.isArray(options) && options.length > 0) {
            resolvedConfig = options as FieldOption[];
        }

        // FieldOptionsAPIConfig (has apiMethod, apiUrl, responseKey) → pass through
        const isApiConfig = typeof options === 'object' && !Array.isArray(options) && 'apiMethod' in options;
        if (isApiConfig) {
            resolvedConfig = options as FieldOptionsAPIConfig<any>;
        }

        if (isRelationConfig && attribute.relation && entityService) {
            resolvedConfig = resolveRelationOptionConfig(
                options as RelationEntityOptionConfig,
                attribute as TIOSchemaAttribute & { relation: NonNullable<TIOSchemaAttribute[ 'relation' ]> },
                entityService,
                globalUIConfigOptions
            );
        }

        if (resolvedConfig) {
            return {
                filterType: 'select',
                defaultOperator: 'eq' as const,
                availableOperators: [ 'eq', 'neq', 'inList', 'notInList', 'exists', 'notExists' ],
                predefinedOptions: resolvedConfig
            };
        }

        // else log error
        throw new FrameworkError(`[generateFilterConfig] No resolved config found for attribute: ${attribute.id}`, {
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
    const entityMetadata = entityService?.getEntitySchema?.().model?.metadata as EntitySchema<any, any, any>[ 'model' ][ 'metadata' ];
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
            availableOperators: [ 'eq', 'neq', 'exists', 'notExists' ],
            predefinedOptions: [
                { label: 'Yes', value: "true" },
                { label: 'No', value: "false" }
            ]
        };
    }

    // **2. Enum fields (array of strings/numbers)**
    if (Array.isArray(attrType) && mergedConfig.enumFields?.enabled !== false) {
        const defaultEnumOps = [ 'eq', 'neq', 'inList', 'notInList', 'exists', 'notExists' ] as const;
        const defaultOp = mergedConfig.enumFields?.defaultOperator || ('eq');
        const availableOps = mergedConfig.enumFields?.availableOperators || defaultEnumOps;

        return {
            filterType: 'select',
            defaultOperator: defaultOp,
            availableOperators: availableOps,
            predefinedOptions: attrType.map(val => ({
                label: String(val),
                value: String(val)  // Always convert to string for consistency
            }))
        };
    }


    // **3. Date/Datetime fields**
    if ((fieldType === 'date' || fieldType === 'datetime' || (attrType === 'string' && (attribute.id.toLowerCase().includes('date') || attribute.id.toLowerCase().includes('time'))))
        && mergedConfig.dateFields?.enabled !== false) {
        const defaultDateOps = [ 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'exists', 'notExists' ] as const;
        const operators = mergedConfig.dateFields?.defaultOperators || defaultDateOps;

        const filterConfig: any = {
            filterType: 'datetime',
            defaultOperator: operators[ 0 ] || ('gte'),
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
                { label: 'Custom Date', value: null }  // Triggers datetime-local input
            ];
        }

        return filterConfig;
    }

    // **5. Number fields**
    if (attrType === 'number' && mergedConfig.numberFields?.enabled !== false) {
        const defaultNumberOps = [ 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'exists', 'notExists' ] as const;
        const operators = mergedConfig.numberFields?.defaultOperators || defaultNumberOps;
        return {
            filterType: 'number',
            defaultOperator: operators[ 0 ] || ('eq'),
            availableOperators: operators
        };
    }

    // **4. Relation fields (without explicit options) - auto-generate from relation metadata**
    if (attribute.relation && mergedConfig.relationFields?.enabled !== false && entityService) {
        const relationConfig: RelationEntityOptionConfig = { entityName: attribute.relation.entityName };
        const resolved = resolveRelationOptionConfig(
            relationConfig,
            attribute as TIOSchemaAttribute & { relation: NonNullable<TIOSchemaAttribute[ 'relation' ]> },
            entityService,
            globalUIConfigOptions
        );

        if (resolved) {
            return {
                filterType: 'relation',
                defaultOperator: 'eq' as const,
                availableOperators: [ 'eq', 'neq', 'inList', 'notInList', 'exists', 'notExists' ],
                predefinedOptions: resolved
            };
        }
    }

    // **6. Text fields (default fallback)**
    if (attrType === 'string' && mergedConfig.textFields?.enabled !== false) {
        const defaultTextOps = [ 'contains', 'notContains', 'eq', 'neq', 'startsWith', 'endsWith', 'like', 'exists', 'notExists' ];
        const operators = mergedConfig.textFields?.defaultOperators || defaultTextOps;
        return {
            filterType: 'text',
            defaultOperator: operators[ 0 ] || ('contains'),
            availableOperators: operators
        };
    }

    // Debug logging
    if (mergedConfig.debug) {
        DefaultLogger.info(`[FilterAutoGen] ${attribute.id}: No filter config generated (type: ${attrType})`);
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
const DEFAULT_ICON_MAPPING: Record<string, string> = {
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
function extractBooleanLabelsFromFieldName(fieldName: string): { trueLabel: string; falseLabel: string } | null {
    // Common boolean prefixes with their negative forms
    const patterns = [
        // Pattern: is + XXX
        {
            regex: /^is([A-Z][a-zA-Z0-9]*)/,
            getTrueLabel: (match: RegExpMatchArray) => toHumanReadableName(match[ 1 ]),
            getFalseLabel: (match: RegExpMatchArray) => {
                const base = toHumanReadableName(match[ 1 ]);
                // Special cases for better negation
                if (base.toLowerCase() === 'active') return 'Inactive';
                if (base.toLowerCase() === 'enabled') return 'Disabled';
                if (base.toLowerCase() === 'visible') return 'Hidden';
                if (base.toLowerCase() === 'public') return 'Private';
                if (base.toLowerCase() === 'available') return 'Unavailable';
                return `Not ${base}`;
            }
        },
        // Pattern: has + XXX
        {
            regex: /^has([A-Z][a-zA-Z0-9]*)/,
            getTrueLabel: (match: RegExpMatchArray) => `Has ${toHumanReadableName(match[ 1 ])}`,
            getFalseLabel: (match: RegExpMatchArray) => `No ${toHumanReadableName(match[ 1 ])}`
        },
        // Pattern: can + XXX
        {
            regex: /^can([A-Z][a-zA-Z0-9]*)/,
            getTrueLabel: (match: RegExpMatchArray) => `Can ${toHumanReadableName(match[ 1 ])}`,
            getFalseLabel: (match: RegExpMatchArray) => `Cannot ${toHumanReadableName(match[ 1 ])}`
        },
        // Pattern: should + XXX
        {
            regex: /^should([A-Z][a-zA-Z0-9]*)/,
            getTrueLabel: (match: RegExpMatchArray) => `Should ${toHumanReadableName(match[ 1 ])}`,
            getFalseLabel: (match: RegExpMatchArray) => `Should Not ${toHumanReadableName(match[ 1 ])}`
        },
        // Pattern: will + XXX
        {
            regex: /^will([A-Z][a-zA-Z0-9]*)/,
            getTrueLabel: (match: RegExpMatchArray) => `Will ${toHumanReadableName(match[ 1 ])}`,
            getFalseLabel: (match: RegExpMatchArray) => `Will Not ${toHumanReadableName(match[ 1 ])}`
        },
        // Pattern: allows + XXX
        {
            regex: /^allows([A-Z][a-zA-Z0-9]*)/,
            getTrueLabel: (match: RegExpMatchArray) => `Allows ${toHumanReadableName(match[ 1 ])}`,
            getFalseLabel: (match: RegExpMatchArray) => `Does Not Allow ${toHumanReadableName(match[ 1 ])}`
        },
        // Pattern: needs + XXX
        {
            regex: /^needs([A-Z][a-zA-Z0-9]*)/,
            getTrueLabel: (match: RegExpMatchArray) => `Needs ${toHumanReadableName(match[ 1 ])}`,
            getFalseLabel: (match: RegExpMatchArray) => `Does Not Need ${toHumanReadableName(match[ 1 ])}`
        },
        // Pattern: requires + XXX
        {
            regex: /^requires([A-Z][a-zA-Z0-9]*)/,
            getTrueLabel: (match: RegExpMatchArray) => `Requires ${toHumanReadableName(match[ 1 ])}`,
            getFalseLabel: (match: RegExpMatchArray) => `Does Not Require ${toHumanReadableName(match[ 1 ])}`
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
function getFieldOptionCount(field: TIOSchemaAttribute): number {
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
        const options = (field as any).options;
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
function isViableSegmentField(
    field: TIOSchemaAttribute,
    config: Required<ISegmentAutoGenerationConfig> & { maxSegmentsPerGroup?: number }
): boolean {
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
function detectSegmentFields<S extends EntitySchema<string, string, string>>(
    properties: TIOSchemaAttributesMap<S>,
    globalConfig?: ISegmentAutoGenerationConfig,
    entityConfig?: NonNullable<ReturnType<typeof BaseEntityService.prototype.getEntitySchema>[ 'model' ][ 'metadata' ]>[ 'tableUI' ]
): Array<{ field: TIOSchemaAttribute; score: number; reason: string }> {
    const segmentConfig = entityConfig?.segmentAutoGeneration;

    // Merge configs (entity > global > defaults)
    const mergedConfig: Required<ISegmentAutoGenerationConfig> & { maxSegmentGroups: number; maxSegmentsPerGroup: number } = {
        enabled: segmentConfig?.enabled ?? globalConfig?.enabled ?? true,
        preferredFields: segmentConfig?.preferredFields || globalConfig?.preferredFields || [ 'status', 'state', 'type', 'category', 'priority' ],
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
        const fieldNames = typeof explicitFields === 'string' ? [ explicitFields ] : explicitFields;
        const results: Array<{ field: TIOSchemaAttribute; score: number; reason: string }> = [];

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
        candidateProperties = candidateProperties.filter(p =>
            segmentConfig.includeFields!.includes(p.id)
        );
    }

    // Apply excludeFields filter
    if (segmentConfig?.excludeFields && segmentConfig.excludeFields.length > 0) {
        candidateProperties = candidateProperties.filter(p =>
            !segmentConfig.excludeFields!.includes(p.id)
        );
    }

    // === PRIORITY 2: Preferred fields ===
    const preferredFields = mergedConfig.preferredFields;
    const preferredMatches: Array<{ field: TIOSchemaAttribute; score: number; reason: string }> = [];

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
    const candidates: Array<{ field: TIOSchemaAttribute; score: number; reason: string; optionCount: number }> = [];

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
        const reasons: string[] = [];
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
            score += 5;  // Small bonus since option count already factors in
            reasons.push('boolean field');
        }

        // **Score 4: Name position (earlier = slightly higher priority)**
        const fieldIndex = candidateProperties.indexOf(prop);
        score -= Math.min(fieldIndex, 5);  // Cap penalty at 5

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
        return a.optionCount - b.optionCount;  // Prefer fewer options
    });

    const topNResults = candidates.slice(0, mergedConfig.maxSegmentGroups);

    if (topNResults.length > 0 && mergedConfig.debug) {
        DefaultLogger.info(`[SegmentDetection] Selected ${topNResults.length} field(s):`, topNResults.map(c => ({
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
export function generateSegments<S extends EntitySchema<string, string, string>>(
    properties: TIOSchemaAttributesMap<S>,
    entityService?: BaseEntityService<S>,
    globalUIConfigOptions?: IApplicationConfig[ 'uiConfigGenOptions' ],
    customSegments?: ReadonlyArray<IFilterSegment | IFilterSegmentGroup> | Array<IFilterSegment | IFilterSegmentGroup>
): ReadonlyArray<IFilterSegment | IFilterSegmentGroup> | Array<IFilterSegment | IFilterSegmentGroup> | undefined {
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
            DefaultLogger.info(`[SegmentGeneration] No suitable fields detected for segments`);
        }
        return undefined;
    }

    // Get merged config for this entity
    const mergedConfig: Required<ISegmentAutoGenerationConfig> & { maxSegmentGroups: number; maxSegmentsPerGroup: number } = {
        enabled: entitySegmentConfig?.segmentAutoGeneration?.enabled ?? globalSegmentConfig?.enabled ?? true,
        preferredFields: entitySegmentConfig?.segmentAutoGeneration?.preferredFields || globalSegmentConfig?.preferredFields || [ 'status', 'state', 'type', 'category', 'priority' ],
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
        DefaultLogger.info(`[SegmentGeneration] Generating segments for ${detectedFields.length} field(s):`, detectedFields.map(d => d.field.id));
    }

    // 4. Generate segment groups (one per detected field)
    const segmentGroups: Array<IFilterSegmentGroup> = [];

    for (const detection of detectedFields) {
        const { field } = detection;

        // Generate segments for this field
        const segments: Array<IFilterSegment> = [];

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
        let values: (string | number | boolean)[] = [];
        let valueLabels: Record<string, string> = {};  // For custom boolean labels

        if (Array.isArray(field.type)) {
            // Enum type array
            values = field.type;
        } else if (field.type === 'boolean') {
            // Boolean field with optional custom labels
            values = [ true, false ];

            // 1. Check for explicit field-level booleanLabels
            const fieldBooleanLabels = 'booleanLabels' in field ? field.booleanLabels : undefined;
            if (fieldBooleanLabels && typeof fieldBooleanLabels === 'object') {
                valueLabels[ 'true' ] = fieldBooleanLabels.true || 'Yes';
                valueLabels[ 'false' ] = fieldBooleanLabels.false || 'No';
            } else {
                // 2. Try intelligent extraction from field name
                const fieldName = field.id;
                const extracted = extractBooleanLabelsFromFieldName(fieldName);

                if (extracted) {
                    valueLabels[ 'true' ] = extracted.trueLabel;
                    valueLabels[ 'false' ] = extracted.falseLabel;
                } else {
                    // 3. Try to match against configured patterns
                    const patterns = mergedConfig.booleanLabelPatterns;
                    let matched = false;

                    if (patterns && patterns.length > 0) {
                        for (const pattern of patterns) {
                            const regex = pattern.pattern instanceof RegExp
                                ? pattern.pattern
                                : new RegExp(pattern.pattern, 'i');

                            if (regex.test(fieldName)) {
                                valueLabels[ 'true' ] = pattern.trueLabel;
                                valueLabels[ 'false' ] = pattern.falseLabel;
                                matched = true;
                                break;
                            }
                        }
                    }

                    // 4. Use default fallback if no pattern matched
                    if (!matched) {
                        const defaults = mergedConfig.defaultBooleanLabels || { true: 'Yes', false: 'No' };
                        valueLabels[ 'true' ] = defaults.true;
                        valueLabels[ 'false' ] = defaults.false;
                    }
                }
            }
        } else if ((field.fieldType === 'select' || field.fieldType === 'radio' || field.fieldType === 'checkbox' || field.fieldType === 'multi-select') && Array.isArray((field as any).options)) {
            // Select/radio/checkbox field with inline options
            const options = (field as any).options as Array<{ label: string; value: string }>;
            values = options.map(opt => opt.value);
            // Store labels for later use
            options.forEach(opt => {
                valueLabels[ String(opt.value) ] = opt.label;
            });
        }

        // Apply field-specific value filters first, then global
        const includeValuesByField = entitySegmentConfig?.segmentAutoGeneration?.includeValuesByField;
        const includeValues = includeValuesByField?.[ field.id ] || entitySegmentConfig?.segmentAutoGeneration?.includeValues;
        if (includeValues) {
            values = values.filter(v => includeValues.includes(String(v)));
        }

        const excludeValuesByField = entitySegmentConfig?.segmentAutoGeneration?.excludeValuesByField;
        const excludeValues = excludeValuesByField?.[ field.id ] || entitySegmentConfig?.segmentAutoGeneration?.excludeValues;
        if (excludeValues) {
            values = values.filter(v => !excludeValues.includes(String(v)));
        }

        // Apply field-specific sort order first, then global
        const sortOrderByField = entitySegmentConfig?.segmentAutoGeneration?.sortOrderByField;
        const sortOrder = sortOrderByField?.[ field.id ] || entitySegmentConfig?.segmentAutoGeneration?.sortOrder;
        if (sortOrder) {
            values.sort((a, b) => {
                const aIndex = sortOrder.indexOf(String(a));
                const bIndex = sortOrder.indexOf(String(b));

                // If both in sortOrder, use that order
                if (aIndex >= 0 && bIndex >= 0) {
                    return aIndex - bIndex;
                }
                // If only one in sortOrder, it comes first
                if (aIndex >= 0) return -1;
                if (bIndex >= 0) return 1;
                // Neither in sortOrder, maintain original order
                return 0;
            });
        }

        // Generate segment for each value
        for (const value of values) {
            const valueStr = String(value);
            const valueLower = valueStr.toLowerCase();

            // Use custom label if available, otherwise format the value
            const segmentLabel = valueLabels[ valueStr ] || pascalCase(valueStr);

            segments.push({
                id: `${field.id}-${valueLower.replace(/[^a-z0-9]+/g, '-')}`,  // Unique ID
                label: segmentLabel,  // Custom or formatted label
                icon: mergedConfig.iconMapping[ valueLower ],  // Smart icon lookup
                filters: {
                    [ field.id ]: { eq: value }
                }
            });
        }

        // Only add group if we have segments
        const minSegments = mergedConfig.includeAllSegment ? 1 : 0;
        if (segments.length > minSegments) {
            // Auto-generate label or use explicit groupLabels
            const customGroupLabels = entitySegmentConfig?.segmentAutoGeneration?.groupLabels;
            const label = customGroupLabels?.[ field.id ] || `By ${pascalCase(field.id)}`;

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
        return segmentGroups[ 0 ].segments;
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
export function formatEntityAttributeForFormOrDetail(
    thisProp: TIOSchemaAttribute,
    type: 'create' | 'update' | 'detail',
    entityService: BaseEntityService<any>,
    allProperties?: TIOSchemaAttribute[],  // Optional: for detecting duplicated relation fields
    globalUIConfigOptions?: IApplicationConfig[ 'uiConfigGenOptions' ]  // Optional: global UI config options
) {
    const formatted: any = {
        ...thisProp,
        // Use custom label if provided in schema (thisProp.label), otherwise format the name to human-readable
        label: (thisProp as any).label || toHumanReadableName(thisProp.name),
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
                    pageType: 'create',
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
            : [ {
                source: String(resolvedIdentifiers.source),
                target: String(resolvedIdentifiers.target)
            } ];

        // For route pattern and default filters, use the first identifier
        // (most entities have single identifier; composite keys need explicit routePattern)
        const primaryIdentifier = identifierMappings[ 0 ];

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
                    ? identifierMappings[ 0 ]  // Single: return object
                    : identifierMappings,     // Multiple: return array
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
                generatedRelationConfig.displayConfig![ '_detectionMetadata' ] = detectionMetadata;
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
                defaultFilters[ mapping.target ] = `:${mapping.source}`;
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
                    ? identifierMappings[ 0 ]  // Single: return object
                    : identifierMappings,     // Multiple: return array
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
export function expandPropertyReferences(
    fieldReferences: ReadonlyArray<string | any> | Array<string | any>,
    allProperties: TIOSchemaAttribute[],
    type: 'create' | 'update' | 'detail',
    entityService: BaseEntityService<any>,
    globalUIConfigOptions?: IApplicationConfig[ 'uiConfigGenOptions' ]
): any[] {
    const propertyMap = new Map<string, TIOSchemaAttribute>();
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
                throw new Error(
                    `Field '${propRef}' not found in entity schema. ` +
                    `Available field IDs: ${Array.from(propertyMap.keys()).join(', ')}. ` +
                    `\nFor non-schema fields (JSON paths, custom fields, multiple renderings), use object syntax:\n` +
                    `  { name: 'uniqueName', column: '${propRef}', label: '...', fieldType: '...' }`
                );
            }
            return formatEntityAttributeForFormOrDetail(fieldAttribute, type, entityService, allProperties, globalUIConfigOptions);
        }

        // Case 2-5: Object syntax (permissive - supports everything)
        if (typeof propRef === 'object' && propRef !== null) {
            // Validate minimum required properties
            if (!propRef.name) {
                DefaultLogger.warn(`Property config missing 'name' field (required for UI identification). Skipping:`, propRef);
                return propRef; // Return as-is, let frontend handle
            }

            // Determine the data path (column can be: direct field, JSON path, or custom field)
            const column = propRef.column || propRef.name;

            // Extract just the root field name for schema lookup (handles JSON paths like "user.email" → "user")
            const rootFieldName = column.split('.')[ 0 ];
            const fieldAttribute = propertyMap.get(rootFieldName);

            // If root field exists in schema AND column is the exact field (not a path), merge with schema
            if (fieldAttribute && column === rootFieldName) {
                // Schema field with overrides - merge defaults + overrides
                const schemaDefaults = formatEntityAttributeForFormOrDetail(fieldAttribute, type, entityService, allProperties, globalUIConfigOptions);
                return {
                    ...schemaDefaults,
                    ...propRef,  // User overrides take precedence
                    column  // Ensure column is set
                };
            }

            // Otherwise: JSON path, custom field, or multiple rendering of same field
            // Auto-generate missing properties with proper formatting
            const label = propRef.label || toHumanReadableName(propRef.name);
            const fieldType = propRef.fieldType || 'text';

            // Warn if label was auto-generated
            if (!propRef.label) {
                DefaultLogger.debug(
                    `Property '${propRef.name}' missing 'label'. Auto-generated: '${label}'. ` +
                    `For custom fields, explicitly provide: name, label, column, fieldType.`
                );
            }
            if (!propRef.fieldType) {
                DefaultLogger.debug(
                    `Property '${propRef.name}' missing 'fieldType'. Defaulted to 'text'. ` +
                    `Recommended field types: text, number, select, badge, progress, etc.`
                );
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
        DefaultLogger.warn(`Unknown property reference type:`, propRef);
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
export function processSectionsConfig(
    sectionsConfig: any,
    allProperties: TIOSchemaAttribute[],
    entityService: BaseEntityService<any>,
    globalUIConfigOptions?: IApplicationConfig[ 'uiConfigGenOptions' ]
): any {
    if (!sectionsConfig) return sectionsConfig;

    const processed = { ...sectionsConfig };

    // Process sections in single group format (backward compatible)
    if (processed.sections) {
        processed.sections = Object.entries(processed.sections).reduce((acc, [ key, section ]: [ string, any ]) => {
            acc[ key ] = processSectionConfig(section, allProperties, entityService, globalUIConfigOptions);
            return acc;
        }, {} as Record<string, any>);
    }

    // Process section groups (new format)
    if (processed.sectionGroups) {
        processed.sectionGroups = processed.sectionGroups.map((group: any) => {
            if (!group.sections) return group;

            return {
                ...group,
                sections: Object.entries(group.sections).reduce((acc, [ key, section ]: [ string, any ]) => {
                    acc[ key ] = processSectionConfig(section, allProperties, entityService, globalUIConfigOptions);
                    return acc;
                }, {} as Record<string, any>)
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
function processSectionConfig(
    section: any,
    allProperties: TIOSchemaAttribute[],
    entityService: BaseEntityService<any>,
    globalUIConfigOptions?: IApplicationConfig[ 'uiConfigGenOptions' ]
): any {
    const processed = { ...section };

    // Process detailsPageConfig with propertiesConfig
    if (processed.pageType === 'details' && processed.detailsPageConfig?.propertiesConfig) {
        const config = processed.detailsPageConfig;
        processed.detailsPageConfig = {
            ...config,
            propertiesConfig: expandPropertyReferences(
                config.propertiesConfig,
                allProperties,
                'detail',
                entityService,
                globalUIConfigOptions
            )
        };
    }

    // Process formPageConfig
    if (processed.pageType === 'form' && processed.formPageConfig?.propertiesConfig) {
        const config = processed.formPageConfig;
        // Forms in sections are typically 'create' forms
        processed.formPageConfig = {
            ...config,
            propertiesConfig: expandPropertyReferences(
                config.propertiesConfig,
                allProperties,
                'create',
                entityService,
                globalUIConfigOptions
            )
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
export function formatEntityAttributesForCreate(properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>, globalUIConfigOptions?: IApplicationConfig[ 'uiConfigGenOptions' ]) {
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
export function formatEntityAttributesForUpdate(properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>, globalUIConfigOptions?: IApplicationConfig[ 'uiConfigGenOptions' ]) {
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
export function formatEntityAttributesForDetail(properties: TIOSchemaAttribute[], entityService: BaseEntityService<any>, globalUIConfigOptions?: IApplicationConfig[ 'uiConfigGenOptions' ]) {
    return properties
        .filter(prop => prop && (!prop.hasOwnProperty('isVisible') || prop.isVisible))
        .map((att) => formatEntityAttributeForFormOrDetail(att, 'detail', entityService, properties, globalUIConfigOptions));
}

/**
 * Type definition for list/table column configuration.
 * 
 * Extends FieldMetadata with list-specific properties like actions, templates,
 * and relation rendering configurations.
 */
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
        globalUIConfigOptions?: IApplicationConfig[ 'uiConfigGenOptions' ]  // NEW: Global config options
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

            // Auto-generate filterConfig if not already present and field is filterable
            const autoGeneratedFilterConfig = !formatted.filterConfig && prop.isFilterable !== false
                ? generateFilterConfig(prop, entityService, globalUIConfigOptions)
                : undefined;

            // Override/add list-specific properties
            const propConfig: ListingPropConfig = {
                ...formatted,
                name: formatted.label || formatted.name,  // Ensure name is set for table column header
                dataIndex: `${prop.id}`,
                fieldType: formatted.fieldType || 'text',
                filterConfig: formatted.filterConfig || autoGeneratedFilterConfig,  // Use explicit or auto-generated
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
export function mergeButtons<T extends { id?: string }>(
    defaults: Array<T>,
    customs: ReadonlyArray<T> | Array<T> = []
): Array<T> {
    const customsArray = [ ...customs ];  // Convert to mutable array
    const customMap = new Map(
        customsArray.filter(c => c.id).map(c => [ c.id, c ])
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
export function mergeActions<T extends { id?: string }>(
    defaults: Array<T>,
    customs: ReadonlyArray<T> | Array<T> = []
): Array<T> {
    return mergeButtons(defaults, [ ...customs ]);  // Spread to handle both readonly and mutable
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
export function mergeSegments<T extends { id: string }>(
    defaults: Array<T>,
    customs: ReadonlyArray<T> | Array<T> = []
): Array<T> {
    return mergeButtons(defaults, [ ...customs ]);  // Reuse mergeButtons logic with id-based override
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
        [ ...fieldOverrides ].map(f => [ f.name, f ])
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
 * Merges column-level visibility, width, fixed position, grouping overrides, and ordering into base properties.
 * 
 * Applies custom column configurations from table config to base schema properties.
 * Only merges overrides for columns that exist in base properties (warns about non-existent columns).
 * 
 * **Visibility Logic:**
 * - When columnOverrides is provided:
 *   - Fields IN the array: Use `defaultVisible` (defaults to true if not specified)
 *   - Fields NOT IN the array: Set `defaultVisible: false` (available in Column Settings but not shown by default)
 * - When columnOverrides is empty/undefined: All fields visible (backward compatible)
 * 
 * **Ordering Logic:**
 * - When columnOverrides is provided:
 *   - Columns are ordered according to their position in the columnOverrides array
 *   - Columns not in the array appear at the end in their original order
 * - When columnOverrides is empty/undefined: Original order is preserved
 * 
 * @template T - Property type with required name field
 * @param baseProperties - Base column properties from entity schema
 * @param columnOverrides - Custom column overrides from table configuration
 * @returns Base properties with overrides merged in and reordered
 * 
 * @example
 * ```typescript
 * const baseProps = [
 *   { name: 'orderId', dataIndex: 'orderId', type: 'string' },
 *   { name: 'status', dataIndex: 'status', type: 'string' },
 *   { name: 'userId', dataIndex: 'userId', type: 'string' },
 *   { name: 'metadata', dataIndex: 'metadata', type: 'string' }
 * ];
 * const overrides = [
 *   { field: 'status', defaultVisible: true },         // 1st position
 *   { field: 'orderId', width: 200, defaultVisible: true }, // 2nd position
 *   { field: 'metadata', defaultVisible: false }       // 3rd position (hidden)
 *   // userId not listed - will be at the end and hidden by default
 * ];
 * const merged = mergeColumnVisibility(baseProps, overrides);
 * // Result (in order):
 * // 1. status: defaultVisible: true
 * // 2. orderId: defaultVisible: true, width: 200
 * // 3. metadata: defaultVisible: false
 * // 4. userId: defaultVisible: false (not in overrides, at the end)
 * ```
 */
/**
 * Normalized column configuration with defaultVisible always defined.
 * Internal type for processing column overrides.
 */
type NormalizedColumnConfig = Omit<ITableColumnConfig, 'defaultVisible'> & {
    defaultVisible: boolean;
    _order?: number;
};

/**
 * Normalizes column overrides to a consistent format.
 * Supports both string shorthand ('fieldName') and object syntax ({ field: 'fieldName', ... })
 * 
 * @param columnOverrides - Column configurations (string or object format)
 * @returns Normalized array of column config objects
 */
function normalizeColumnOverrides(
    columnOverrides: ITableColumns
): Array<NormalizedColumnConfig> {
    return (columnOverrides as Array<ITableColumn>).map(col => {
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
export function mergeColumnVisibility<T extends { name: string; dataIndex?: string }>(
    baseProperties: Array<T>,
    columnOverrides: ITableColumns = []
): Array<T> {
    // If no columnOverrides provided, return properties as-is (backward compatible)
    if (!columnOverrides || columnOverrides.length === 0) {
        return baseProperties;
    }

    // Normalize column overrides (handle string shorthand)
    const normalizedOverrides = normalizeColumnOverrides(columnOverrides);

    const overrideMap = new Map(
        normalizedOverrides.map((c, index) => [ c.field, { ...c, _order: index } ])
    );

    // Track which overrides match existing schema columns
    const matchedOverrides = new Set<string>();

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
            defaultVisible: override.defaultVisible !== false,  // Defaults to true
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
                DefaultLogger.debug(`Adding JSON path column: "${override.field}"`);
            } else {
                DefaultLogger.debug(`Adding custom column: "${override.field}" (not in schema, assumes API provides it)`);
            }

            // Add as new custom column
            mergedProperties.push({
                name: override.field,  // Use field as name
                dataIndex: override.field,  // Frontend will use getNestedValue()
                defaultVisible: override.defaultVisible,
                fieldType: 'text',  // Default to text for custom columns
                ...(override.visibility !== undefined && { visibility: override.visibility }),
                ...(override.width !== undefined && { width: override.width }),
                ...(override.fixed !== undefined && { fixed: override.fixed }),
                ...(override.groupTitle !== undefined && { groupTitle: override.groupTitle }),
                _order: override._order
            } as any);
        }
    });

    // Sort by order from columnOverrides (columns not in overrides go to end)
    mergedProperties.sort((a: any, b: any) => (a._order ?? Number.MAX_SAFE_INTEGER) - (b._order ?? Number.MAX_SAFE_INTEGER));

    // Remove temporary _order property
    return mergedProperties.map(({ _order, ...rest }: any) => rest);
}

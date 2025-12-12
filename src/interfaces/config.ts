import { Authorizer } from './../decorators/authorizer';
import type { RemovalPolicy } from "aws-cdk-lib";
import type { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import type { DIContainer } from "../di/container";
import type { ILayerVersion } from "aws-cdk-lib/aws-lambda";
import { IDIContainer } from "./di";
import { AuthorizerTypeMetadata, IControllerConfig } from '../decorators';
import type { IFunctionResourceAccess, TPolicyStatementOrProps, TImportedPolicy } from '../constructs/lambda-function';
import type { IDynamoDBConfig } from '../constructs/dynamodb';

/**
 * Configuration for smart duplicated field detection.
 * Automatically detects fields like 'teamName' for 'teamId' relations.
 */
export interface IDuplicatedFieldDetectionConfig {
    /** Enable/disable auto-detection globally. Default: true */
    enabled?: boolean;

    /** Suffix patterns to search for */
    suffixes?: {
        /** Display field suffixes. Default: ['Name', 'Title', 'Label', 'DisplayName'] */
        display?: string[];
        /** Visual field suffixes. Default: ['Logo', 'Image', 'Icon', 'Avatar', 'Picture'] */
        visual?: string[];
        /** Meta field suffixes. Default: ['Code', 'Slug', 'Key', 'Identifier'] */
        meta?: string[];
    };

    /** 
     * Domain-specific prefixes for pattern matching.
     * Framework provides generic prefixes (parent, child, source, target, owner, etc.)
     * Add your domain-specific patterns here (e.g., 'player', 'team' for sports; 'customer', 'order' for e-commerce)
     * 
     * @example Sports app: ['player', 'team', 'league', 'season', 'venue']
     * @example E-commerce: ['product', 'customer', 'order', 'invoice']
     */
    prefixes?: string[];

    /** 
     * Template generation style. Default: 'simple'
     * - simple: {teamName}
     * - composite: {teamName} ({teamCode}) if both exist
     */
    templateStyle?: 'simple' | 'composite';

    /** Minimum confidence to use detection. Default: 'medium' */
    confidenceThreshold?: 'low' | 'medium' | 'high';

    /** Enable debug logging. Default: false */
    debug?: boolean;
}

/**
 * Configuration for auto-generating column filters.
 * 
 * Follows same pattern as duplicatedFieldDetection:
 * - Global defaults
 * - Entity-level overrides
 * - Attribute-level overrides (via explicit filterConfig)
 */
export interface IFilterAutoGenerationConfig {
    /** Enable/disable globally. Default: true */
    enabled?: boolean;

    /** Date field filter configuration */
    dateFields?: {
        enabled?: boolean;  // Default: true
        /** Default operators for date fields */
        defaultOperators?: Array<'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between'>;  // Default: ['gte', 'lte', 'between']
        /** Generate quick date options (Today, This Week, etc.) */
        quickFilters?: boolean;  // Default: true
    };

    /** Enum/Select field filter configuration */
    enumFields?: {
        enabled?: boolean;  // Default: true
        /** Default operator for enum filters */
        defaultOperator?: 'eq' | 'inList';  // Default: 'eq'
        /** Available operators for enum filters */
        availableOperators?: Array<'eq' | 'neq' | 'inList' | 'notInList'>;  // Default: ['eq', 'neq', 'inList', 'notInList']
    };

    /** Boolean field filter configuration */
    booleanFields?: {
        enabled?: boolean;  // Default: true
    };

    /** Relation field filter configuration */
    relationFields?: {
        enabled?: boolean;  // Default: true
        /** Default operators for relation filters */
        defaultOperators?: Array<'eq' | 'neq' | 'inList' | 'notInList'>;  // Default: ['eq', 'inList']
        /** Limit options shown in selector */
        optionsLimit?: number;  // Default: 100
    };

    /** Number field filter configuration */
    numberFields?: {
        enabled?: boolean;  // Default: true
        defaultOperators?: Array<'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between'>;  // Default: ['eq', 'gte', 'lte']
    };

    /** Text field filter configuration */
    textFields?: {
        enabled?: boolean;  // Default: true
        defaultOperators?: Array<'eq' | 'neq' | 'contains' | 'startsWith' | 'endsWith'>;  // Default: ['contains', 'eq']
    };

    /** Debug logging */
    debug?: boolean;  // Default: false
}

/**
 * Default boolean labels for segment generation.
 * Maps field name patterns to appropriate true/false labels.
 */
export interface BooleanLabelPattern {
    /** Field name pattern (regex or contains) */
    pattern: string | RegExp;
    /** Label for true value */
    trueLabel: string;
    /** Label for false value */
    falseLabel: string;
}

/**
 * Configuration for smart segment field detection.
 * 
 * Intelligently selects which field(s) should be used for auto-generating segments.
 * Supports multiple segment groups for richer filtering UX.
 */
export interface ISegmentAutoGenerationConfig {
    /** Enable/disable globally. Default: true */
    enabled?: boolean;

    /** 
     * Preferred field names for segments (in order of priority).
     * Framework tries these first before applying scoring algorithm.
     * 
     * Default: ['status', 'state', 'type', 'category', 'priority']
     */
    preferredFields?: string[];

    /** 
     * Maximum number of segment groups to generate per table.
     * Each group represents a different field (e.g., one group for "status", another for "league").
     * Set to 1 for legacy single-group behavior.
     * Default: 2
     */
    maxSegmentGroups?: number;

    /** 
     * Maximum number of segment values per group.
     * Default: 10
     */
    maxSegmentsPerGroup?: number;

    /** Minimum number of values required to generate segments. Default: 2 */
    minValues?: number;

    /** 
     * Global icon mapping for segment values.
     * Static map only (functions not supported due to JSON serialization).
     * Entity-level config can override these.
     * 
     * @example
     * iconMapping: {
     *   'active': 'check-circle',
     *   'paused': 'pause-circle',
     *   'completed': 'check',
     *   'cancelled': 'close-circle'
     * }
     */
    iconMapping?: Record<string, string>;

    /**
     * Default boolean label patterns.
     * Framework matches field names against these patterns to generate appropriate labels.
     * Can be overridden per-field using `booleanLabels` in attribute metadata.
     * 
     * @example
     * booleanLabelPatterns: [
     *   { pattern: /active|enabled/i, trueLabel: 'Active', falseLabel: 'Inactive' },
     *   { pattern: /live/i, trueLabel: 'Live', falseLabel: 'Not Live' },
     *   { pattern: /public/i, trueLabel: 'Public', falseLabel: 'Private' }
     * ]
     */
    booleanLabelPatterns?: BooleanLabelPattern[];

    /**
     * Default fallback labels for boolean fields when no pattern matches.
     * Default: { true: 'Yes', false: 'No' }
     */
    defaultBooleanLabels?: { true: string; false: string };

    /** Always include "All" segment in each group. Default: true */
    includeAllSegment?: boolean;

    /** Debug logging */
    debug?: boolean;  // Default: false
}

/**
 * Complete table UI auto-generation config.
 * Added to IApplicationConfig.uiConfigGenOptions
 */
export interface ITableUIAutoGenerationConfig {
    /** Filter auto-generation configuration */
    filterAutoGeneration?: IFilterAutoGenerationConfig;

    /** Segment auto-generation configuration */
    segmentAutoGeneration?: ISegmentAutoGenerationConfig;
}

/**
 * Observability infrastructure configuration (CDK/Application level).
 * 
 * @example Simple - defaults
 * ```typescript
 * observability: true  // Creates 'observabilitylogs' table
 * ```
 * 
 * @example Custom table name
 * ```typescript
 * observability: { dynamodb: { name: 'my-app-logs' } }  // Creates 'my-app-logs' table
 * ```
 * 
 * @example With search indexing (same structure as IDynamoDBConfig['table'])
 * ```typescript
 * observability: {
 *   dynamodb: {
 *     searchIndexing: [{ enabled: true, engineConfig: { type: 'meili', ... } }]
 *   }
 * }
 * ```
 */
export interface IObservabilityInfraConfig {
    /** Stack name (default: 'persistent') */
    stackName?: string;
    /** Parent stack name */
    parentStackName?: string;

    /**
     * DynamoDB table config - same as IDynamoDBConfig['table'] but:
     * - `name` optional (default: 'observabilitylogs')
     * - `props` optional (framework provides pk/sk, 6 GSIs)
     * - `audit` excluded (would be recursive)
     */
    dynamodb?: Omit<IDynamoDBConfig[ 'table' ], 'audit' | 'name' | 'props'> & {
        /** Enable/disable DynamoDB table (default: true) */
        enabled?: boolean;
        /** Table name suffix (default: 'observability') */
        name?: string;
        /** Override default table props */
        props?: Partial<IDynamoDBConfig[ 'table' ][ 'props' ]>;
    };

    /** CloudWatch infrastructure (future) */
    cloudwatch?: {
        enabled?: boolean;
        logGroupName?: string;
        retentionDays?: number;
    };
}

/**
 * - `true`: Create DynamoDB table with defaults
 * - `IObservabilityInfraConfig`: Customize
 */
export type IObservabilityConfig = boolean | IObservabilityInfraConfig;

export interface IApplicationConfig {
    name?: string;
    region?: string;
    account?: string;
    disableUIConfigGen?: boolean;
    uiConfigGenOptions?: {
        authEndpoint?: string;
        disableSignIn?: boolean;
        disableSignUp?: boolean;
        disableForgotPassword?: boolean;
        disableAccountVerification?: boolean;
        signInMethods?: ('EMAIL_PASSWORD' | 'EMAIL_OTP' | 'SMS_OTP' | 'PASSKEY')[];
        customPagesDirectory?: string;

        /** Smart duplicated field detection configuration */
        duplicatedFieldDetection?: IDuplicatedFieldDetectionConfig;

        /** Label field detection configuration for relation options */
        labelFieldDetection?: {
            /** 
             * Minimum confidence level required (default: 'medium')
             * - 'high': Only metadata, exact name/title/label matches
             * - 'medium': Also includes *Name, *Title, *Label, *Code suffixes
             */
            minConfidence?: 'high' | 'medium';
            /** Enable debug logging (default: false) */
            debug?: boolean;
        };

        /** Table UI auto-generation configuration */
        tableUI?: ITableUIAutoGenerationConfig;
    };
    defaultAuthorizationType?: any;
    defaultAdminGroups?: string[];
    environment?: string; // local, dev, prod
    environmentVariables?: Record<string, string>;
    globalEnvironmentVariables?: Record<string, string>;

    /**
     * Global policies that should be attached to ALL Lambda functions in the application.
     * Useful for cross-cutting concerns like observability, logging, or shared resources.
     * 
     * @example
     * globalPolicies: [
     *   // Imported policy by name
     *   { name: 'my-policy', prefix: 'my-module' },
     *   // Direct policy statement props
     *   { effect: Effect.ALLOW, actions: ['s3:GetObject'], resources: ['*'] }
     * ]
     */
    globalPolicies?: Array<TPolicyStatementOrProps | TImportedPolicy>;

    /**
     * Global resource access that should be applied to ALL Lambda functions in the application.
     * Useful for resources that need to be accessed by multiple functions (e.g., shared tables, buckets).
     * 
     * @example
     * globalResourceAccess: {
     *   tables: [
     *     'users-table',  // shorthand for read/write access
     *     { name: 'audit-table', access: ['read'] }  // explicit read-only
     *   ],
     *   buckets: ['assets-bucket'],
     *   queues: ['notifications-queue'],
     *   topics: ['events-topic']
     * }
     */
    globalResourceAccess?: IFunctionResourceAccess;

    logRetentionDays?: number;
    logRemovalPolicy?: RemovalPolicy;
    functionProps?: Omit<NodejsFunctionProps, 'layers'> & {
        readonly layers?: Array<ILayerVersion | string>;
    }

    /**
     * Observability infrastructure configuration.
     * Creates DynamoDB table and grants access to all Lambdas.
     */
    observability?: IObservabilityConfig;

    /**
     * The timeout duration for the Lambda function in seconds.
     * Use this timeout to avoid importing the duration class from aws-cdk-lib.
     */
    functionTimeout?: number;
    appDIContainer?: IDIContainer;
    lambdaEntryPackages?: string[];
    defaultStackName?: string;
    layerStackName?: string;
    multiStack?: boolean;
    // TODO: integrate this into the application
    systemFeatures?: {
        controller?: {
            enabled?: boolean;
            config?: IControllerConfig
        };
        uiConfig?: {
            enabled?: boolean;
            menuGroup?: 'nav' | 'system';
        }
    };
}

// fw24/src/interfaces/system-controller.ts
export interface SystemControllerDefinition {
    path: string; // Base path (e.g., '/system/search')
    filePath: string; // Path to the controller file
    // config?: IControllerConfig;
    uiConfig?: SystemUIPageDefinition;
}

export interface SystemUIPageDefinition {
    pageId: string;
    title: string;
    description?: string;
    icon?: string;
    order?: number;
    config: any; // TODO: UI page configuration
}


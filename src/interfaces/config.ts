import { Authorizer } from './../decorators/authorizer';
import type { RemovalPolicy } from "aws-cdk-lib";
import type { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import type { DIContainer } from "../di/container";
import type { ILayerVersion } from "aws-cdk-lib/aws-lambda";
import { IDIContainer } from "./di";
import { AuthorizerTypeMetadata, IControllerConfig } from '../decorators';

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
    };
    defaultAuthorizationType?: any;
    defaultAdminGroups?: string[];
    environment?: string; // local, dev, prod
    environmentVariables?: Record<string, string>;
    globalEnvironmentVariables?: Record<string, string>;
    logRetentionDays?: number;
    logRemovalPolicy?: RemovalPolicy;
    functionProps?: Omit<NodejsFunctionProps, 'layers'> & {
        readonly layers?: Array<ILayerVersion | string>;
    }
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


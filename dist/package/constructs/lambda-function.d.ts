import { Construct } from "constructs";
import { RemovalPolicy } from "aws-cdk-lib";
import { PolicyStatement, type PolicyStatementProps } from "aws-cdk-lib/aws-iam";
import { ApplicationLogLevel, ILayerVersion } from "aws-cdk-lib/aws-lambda";
import { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { ILogger } from "../logging";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
export type TPolicyStatementOrProps = PolicyStatement | PolicyStatementProps;
export type TImportedPolicy = {
    name: string;
    isOptional?: boolean;
    prefix?: string;
};
export declare function isImportedPolicy(policy: TPolicyStatementOrProps | TImportedPolicy): policy is TImportedPolicy;
/**
 * Represents the properties for a Lambda function.
 */
export interface LambdaFunctionProps {
    /**
     * The entry point for the Lambda function.
     */
    entry: string;
    /**
     * The policies to attach to the Lambda function's execution role.
     */
    policies?: Array<TPolicyStatementOrProps | TImportedPolicy>;
    /**
     * The environment variables to set for the Lambda function.
     */
    environmentVariables?: {
        [key: string]: string;
    };
    /**
     * The resource access configuration for the Lambda function.
     */
    resourceAccess?: IFunctionResourceAccess;
    /**
     * Indicates whether the Lambda function is allowed to send emails.
     */
    allowSendEmail?: boolean;
    /**
     * The number of days to retain the logs for the Lambda function.
     */
    logRetentionDays?: RetentionDays;
    /**
     * The removal policy for the Lambda function's logs.
     */
    logRemovalPolicy?: RemovalPolicy;
    /**
     * The timeout duration for the Lambda function in seconds.
     * Use this timeout to avoid importing the duration class from aws-cdk-lib.
     */
    functionTimeout?: number;
    processorArchitecture?: 'x86_64' | 'arm_64';
    /**
     * Additional properties for the Node.js Lambda function.
     */
    functionProps?: Omit<NodejsFunctionProps, 'layers'> & {
        readonly layers?: Array<ILayerVersion | string>;
    };
    /**
     * Optional name of the class that handles the request.
     */
    handlerClassName?: string;
}
/**
 * Represents a resource access entry - either a simple string name or an object with name and access permissions.
 */
export type TResourceAccessEntry = string | {
    name: string;
    access?: string[];
};
/**
 * Represents the access permissions for various resources that can be accessed by a function.
 */
export interface IFunctionResourceAccess {
    /**
     * Access permissions for tables.
     * Each table can be a string (name only, defaults to readwrite) or an object with name and access permissions.
     * The access permissions can be 'read', 'write', or 'readwrite'.
     * If no access permissions are specified, the default is 'readwrite'.
     *
     * @example
     * tables: ['users-table', { name: 'orders-table', access: ['read'] }]
     */
    tables?: TResourceAccessEntry[];
    /**
     * Access permissions for buckets.
     * Each bucket can be a string (name only, defaults to readwrite) or an object with name and access permissions.
     * The access permissions can be 'read', 'write', or 'readwrite'.
     * If no access permissions are specified, the default is 'readwrite'.
     *
     * @example
     * buckets: ['assets-bucket', { name: 'logs-bucket', access: ['write'] }]
     */
    buckets?: TResourceAccessEntry[];
    /**
     * Access permissions for topics.
     * Each topic can be a string (name only, defaults to publish) or an object with name and access permissions.
     * The access permissions can be 'publish'.
     * If no access permissions are specified, the default is 'publish'.
     *
     * @example
     * topics: ['events-topic', { name: 'notifications-topic', access: ['publish'] }]
     */
    topics?: TResourceAccessEntry[];
    /**
     * Access permissions for queues.
     * Each queue can be a string (name only, defaults to send) or an object with name and access permissions.
     * The access permissions can be 'send', 'receive', or 'delete'.
     * If no access permissions are specified, the default is 'send'.
     *
     * @example
     * queues: ['notifications-queue', { name: 'processing-queue', access: ['send', 'receive'] }]
     */
    queues?: TResourceAccessEntry[];
}
/**
 * Represents a Lambda function construct.
 *
 * @example
 * ```ts
 * // Create a Lambda function with custom properties
 * const lambdaProps: LambdaFunctionProps = {
 *   entry: "index.js",
 *   policies: [{
 *         effect: Effect.ALLOW,
 *         actions: [
 *          "s3:GetObject"
 *         ],
 *         resources: ["arn:aws:s3:::my-bucket/*"],
 *     },
 *     {
 *       policy: "authModule:create-user-auth-record",
 *       isOptional: true
 *     }
 *   ],
 *   environmentVariables: {
 *     MY_ENV_VAR: "my-value",
 *   },
 *   resourceAccess: {
 *     tables: [
 *       {
 *         name: "my-table",
 *         access: ["read", "write"],
 *       },
 *     ],
 *     buckets: ["my-bucket"],
 *     topics: ["my-topic"],
 *     queues: ["my-queue"],
 *   },
 *   allowSendEmail: true,
 *   logRetentionDays: RetentionDays.ONE_WEEK,
 *   logRemovalPolicy: RemovalPolicy.DESTROY,
 *   functionTimeout: 10,
 *   functionProps: {
 *     runtime: Runtime.NODEJS_22_X,
 *     memorySize: 256,
 *   },
 * };
 *
 * const lambdaFunction = new LambdaFunction(stack, "MyLambdaFunction", lambdaProps);
 *
 * ```
 */
export declare function formatLogLevel(logLevel?: string): ApplicationLogLevel;
export declare class LambdaFunction extends Construct {
    readonly logger?: ILogger;
    /**
     * Constructs a new instance of the LambdaFunction class.
     * @param scope - The parent construct.
     * @param id - The ID of the construct.
     * @param props - The Lambda function properties.
     * @returns The Lambda function.
     */
    constructor(scope: Construct, id: string, props: LambdaFunctionProps);
}

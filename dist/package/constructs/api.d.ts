import type { RestApiProps } from "aws-cdk-lib/aws-apigateway";
import { RestApi, ApiKey, Period, UsagePlan } from "aws-cdk-lib/aws-apigateway";
import { RemovalPolicy, Stack } from "aws-cdk-lib";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutput } from "../interfaces/construct";
import { IConstructConfig } from "../interfaces/construct-config";
/**
 * Represents the configuration options for an API construct.
 */
export interface IAPIConstructConfig extends IConstructConfig {
    /**
     * Specifies the CORS configuration for the API.
     * It can be a boolean value, a single string, or an array of strings.
     */
    cors?: boolean | string | string[];
    /**
     * Specifies additional options for the API.
     */
    apiOptions?: RestApiProps;
    /**
     * Specifies the directory where the controllers are located.
     */
    controllersDirectory?: string;
    /**
     * Specifies the properties for the Node.js function.
     */
    functionProps?: NodejsFunctionProps;
    /**
     * Specifies the number of days to retain the API logs.
     */
    logRetentionDays?: RetentionDays;
    /**
     * Specifies the removal policy for the API logs.
     */
    logRemovalPolicy?: RemovalPolicy;
    /**
     * The custom domain name for the API.
     */
    domainName?: string;
    /**
     * The certificate ARN for the custom domain name.
     */
    certificateArn?: string;
    /**
     * API Gateway Lambda integration timeout in seconds.
     */
    integrationTimeout?: number;
    /**
     * The parent stack name for the Controllers.
     */
    controllerParentStackName?: string;
    /**
     * Ownership strategy for shared nested-controller root segments (the first path part of a
     * nested route, e.g. `internal` in `internal/notifications`). In every strategy the owner is
     * decided up front — never by controller registration order — so the shared resource's
     * CloudFormation logical id is stable and the historical 409/ordering bug cannot occur. No
     * hardcoded segment names in any strategy.
     *
     * - `'main-stack'` (default): the main RestApi stack owns every shared root. Zero config, fully
     *   deterministic (no AWS calls) — new apps need nothing. An app already deployed with the root
     *   in a nested stack moves it once per environment via `cdk refactor`.
     * - `'pinned'`: a shared root stays in the controller stack that already owns it — you supply
     *   `nestedControllerRootOwners`. Deterministic and offline; moves no live resource. Roots not
     *   listed fall back to the main stack.
     * - `'auto'`: at build time it looks up deployed CloudFormation to discover which controller
     *   stack currently owns each root (matched by route, not logical id), and keeps it there. No
     *   config and moves no live resource — but the build needs AWS credentials (present in CI/CD
     *   deploy). It fails loud if it cannot resolve an owner (rather than guessing); set a
     *   `nestedControllerRootOwners` entry as an explicit fallback for those cases.
     *
     * @default 'main-stack'
     */
    nestedControllerRootStrategy?: 'main-stack' | 'pinned' | 'auto';
    /**
     * The controller stack that already owns a shared root in the deployed app, e.g.
     * `{ internal: 'internal/team' }`. Required with `'pinned'`; optional with `'auto'` as an
     * explicit fallback when the lookup can't resolve (no creds / ambiguous / unmatched). The named
     * stack keeps creating the root resource (preserving its existing CloudFormation logical id) and
     * every sibling references it — so upgrading moves nothing and stays zero-downtime.
     */
    nestedControllerRootOwners?: Record<string, string>;
    /**
     * Set to false if you want to skip creation of controllers resources and methods
     * This will delete all the controllers resources and methods from the API
     */
    skipControllers?: boolean;
    /**
     * Force a deployment of the API when using imported APIs
     */
    forceDeployment?: boolean;
    /**
     * API key configuration for the API
     */
    apiKeyConfig?: {
        /**
         * List of valid API keys. If empty, keys will be auto-generated
         */
        keys?: string[];
        /**
         * Name of the API key (used when auto-generating)
         */
        keyName?: string;
    };
    /**
     * Usage plan configuration for the API
     */
    usagePlans?: IUsagePlanConfig[];
}
/**
 * Configuration for API key within a usage plan
 */
interface IUsagePlanApiKeyConfig {
    /**
     * List of valid API keys. If empty, keys will be auto-generated
     */
    keys?: string[];
    /**
     * Name prefix for the API keys (used when auto-generating)
     */
    keyNamePrefix?: string;
}
/**
 * Configuration for a usage plan
 */
interface IUsagePlanConfig {
    /**
     * Name of the usage plan
     */
    name: string;
    /**
     * Description of the usage plan
     */
    description?: string;
    /**
     * Rate limit per second
     */
    rateLimit?: number;
    /**
     * Burst limit
     */
    burstLimit?: number;
    /**
     * Quota limit per period
     */
    quotaLimit?: number;
    /**
     * Quota period
     */
    quotaPeriod?: Period;
    /**
     * API key configuration for this usage plan
     */
    apiKeys?: IUsagePlanApiKeyConfig;
}
export declare class APIConstruct implements FW24Construct {
    private readonly apiConstructConfig;
    readonly logger: import("tslog").Logger<import("tslog").ILogObj>;
    readonly fw24: Fw24;
    name: string;
    dependencies: string[];
    output: FW24ConstructOutput;
    api: RestApi;
    mainStack: Stack;
    usagePlans: Map<string, {
        plan: UsagePlan;
        name: string;
    }>;
    apiKeys: Map<string, ApiKey[]>;
    keyValues: Map<string, ApiKey>;
    private resources;
    private methods;
    private readonly controllerStacks;
    /**
     * Shared root segments for nested controllers (e.g. `internal` for `internal/notifications`),
     * each created exactly once in a STABLE owner stack and referenced by every sibling nested stack
     * via the resource-id token. The owner is the main stack by default, or a pinned controller
     * stack (`nestedControllerRootOwners`) for already-deployed apps. Either way the owner is fixed
     * by config — never by registration order — so the segment's CloudFormation logical id is
     * identical on every synth. No 409, no live AWS lookups.
     */
    private readonly sharedControllerRoots;
    /** 'auto' strategy: resolved `rootSegment -> owning controller stack name`, discovered from deployed state. */
    private readonly resolvedAutoRootOwners;
    /** Injectable CloudFormation lookup for the 'auto' strategy (overridable in tests). */
    private nestedRootLookup?;
    /** True once an api-key usage plan was requested while deployment was still deferred. */
    private deferredApiKeyPlanRequested;
    constructor(apiConstructConfig: IAPIConstructConfig);
    construct(): Promise<void>;
    /**
     * Nested-controller layout: controllers live in nested stacks under a shared parent, so the API
     * must publish a single explicit stage after all nested stacks register (not auto-deploy early).
     * Mutually exclusive with multiStack (getStack forbids parentStackName under multiStack).
     */
    private isNestedControllerDeployment;
    /** Set up usage plans deferred during a nested-controller deployment, once the stage exists. */
    private flushDeferredUsagePlans;
    private readonly getAPI;
    private registerControllers;
    private copyAndRegisterSystemControllers;
    private prepareEntryPackages;
    private readonly registerController;
    private readonly getStageName;
    private createDeployments;
    private createSingleDeployment;
    private getCorsPreflightOptions;
    private getCorsOrigins;
    /** Route + stack name for a controller descriptor (mirrors registerController's derivation). */
    private describeController;
    /**
     * 'auto' strategy: for each shared root, discover from deployed CloudFormation which controller
     * stack currently owns it, and record that stack as the owner. The owning controller is matched
     * by ROUTE (a semantic value present in both the deployed template and the app's controllers) —
     * never by CloudFormation logical id (which is an unresolved token at synth) and with no hardcoded
     * segment names. Fails loud rather than guessing; honours a `nestedControllerRootOwners` value as
     * an explicit fallback for the unresolvable cases (no creds / ambiguous / unmatched).
     */
    private resolveAutoSharedRootOwners;
    /** Resolve the controller stack that should own a shared root, per the configured strategy. */
    private resolveSharedRootOwnerStackName;
    /**
     * Create (once) the shared root segment for a nested controller in its STABLE owner stack, and
     * publish its resource-id token so sibling nested stacks can reference it. The owner is decided
     * by the configured strategy (main stack, pinned, or auto-resolved) — never by registration
     * order — so the segment's CloudFormation logical id is identical on every synth. That is what
     * removes the 409/ordering bug.
     */
    private getOrCreateSharedControllerRoot;
    private readonly getOrCreateControllerResource;
    private readonly createLambdaFunction;
    private readonly extractDefaultAuthorizer;
    private readonly getOrCreateRouteResource;
    private readonly extractRouteAuthorizer;
    private readonly createMethodOptions;
    private readonly createSQSIntegration;
    private readonly createSNSIntegration;
    private readonly outputApiEndpoint;
    private setupUsagePlan;
}
export {};

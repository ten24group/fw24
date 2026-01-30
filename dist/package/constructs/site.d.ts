import { Stack } from "aws-cdk-lib";
import { BuildSpec } from "aws-cdk-lib/aws-codebuild";
import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutput } from "../interfaces/construct";
import { IConstructConfig } from "../interfaces/construct-config";
/**
 * Represents the configuration for the site construct.
 */
export interface ISiteConstructConfig extends IConstructConfig {
    /**
     * The name of the application.
     */
    appName: string;
    /**
     * The owner of the GitHub repository.
     */
    githubOwner: string;
    /**
     * The name of the GitHub repository.
     */
    githubRepo: string;
    /**
     * The branch of the GitHub repository.
     */
    githubBranch: string;
    /**
     * The name of the secret key.
     */
    secretKeyName: string;
    /**
     * The build specification for the site.
     */
    buildSpec: BuildSpec;
    /**
     * The domain for the site.
     */
    domain?: string;
    /**
     * The subdomain for the branch. defaults to the branch name.
     */
    subdomain?: string;
    /**
     * Map the domain to the www subdomain.
     * Default is false
     * @default false
     */
    mapRootDomain?: boolean;
}
export declare class SiteConstruct implements FW24Construct {
    private siteConstructConfig;
    readonly logger: import("tslog").Logger<import("tslog").ILogObj>;
    readonly fw24: Fw24;
    name: string;
    dependencies: string[];
    output: FW24ConstructOutput;
    mainStack: Stack;
    constructor(siteConstructConfig: ISiteConstructConfig);
    construct(): Promise<void>;
}

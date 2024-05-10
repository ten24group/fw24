import { SecretValue, CfnOutput } from "aws-cdk-lib";
import { BuildSpec } from "aws-cdk-lib/aws-codebuild";
import { App, CustomRule, GitHubSourceCodeProvider } from '@aws-cdk/aws-amplify-alpha';

import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutout } from "../interfaces/construct";
import { Helper } from "../core/helper";
import { createLogger } from "../logging";

export interface ISiteConstructConfig {
    appName: string;
    githubOwner: string;
    githubRepo: string;
    githubBranch: string;
    secretKeyName: string;
    buildSpec: any; // BuildSpec.fromObject
}

export class SiteConstruct implements FW24Construct{
    readonly logger = createLogger(SiteConstruct.name);
    readonly fw24: Fw24 = Fw24.getInstance();

    name: string = SiteConstruct.name;
    dependencies: string[] = [];
    output!: FW24ConstructOutout;

    // default constructor to initialize the stack configuration
    constructor(private siteConstructConfig: ISiteConstructConfig){
        // hydrate the config object with environment variables ex: AMPLIFY_GITHUB_OWNER
        Helper.hydrateConfig(siteConstructConfig, 'AMPLIFY');
        // hydrate the config object with environment variables ex: AMPLIFY_ADMIN_GITHUB_REPO
        Helper.hydrateConfig(siteConstructConfig, `AMPLIFY_${this.siteConstructConfig.appName.toUpperCase()}`);
    }
    // construct method to create the stack
    public async construct(){
        this.logger.debug(' construct for:', this.siteConstructConfig.appName);
        const fw24 = Fw24.getInstance();
        // get the main stack from the framework
        const mainStack = fw24.getStack('main');
        // create the stack prefix
        const stackPrefix = `${fw24.appName}-${this.siteConstructConfig.appName}`;
        // create the amplify app
        const amplifyApp = new App(mainStack, `${stackPrefix}-amplify`, {
            appName: `${this.siteConstructConfig.appName}`,
            buildSpec: BuildSpec.fromObject(this.siteConstructConfig.buildSpec),
            sourceCodeProvider: new GitHubSourceCodeProvider({
                owner: this.siteConstructConfig.githubOwner,
                repository: this.siteConstructConfig.githubRepo,
                // make sure to store the secret value as **plain-text**
                oauthToken: SecretValue.secretsManager(this.siteConstructConfig.secretKeyName),
            })
        });
        // add the custom rules
        amplifyApp.addCustomRule(CustomRule.SINGLE_PAGE_APPLICATION_REDIRECT);
        // add the branch
        amplifyApp.addBranch(this.siteConstructConfig.githubBranch);
        // add the stack to the framework
        fw24.addStack('amplify', amplifyApp);
        // add the amplify url to the main stack outputs
        new CfnOutput(mainStack, `${stackPrefix}-amplify-url`, {
            value: `https://${this.siteConstructConfig.githubBranch}.${amplifyApp.appId}.amplifyapp.com`
        });
    }
}

import { SecretValue, CfnOutput } from "aws-cdk-lib";
import { BuildSpec } from "aws-cdk-lib/aws-codebuild";
import { App, CustomRule, GitHubSourceCodeProvider } from '@aws-cdk/aws-amplify-alpha';

import { Fw24 } from "../core/fw24";
import { IStack } from "../interfaces/stack";
import { Helper } from "../core/helper";
import { createLogger } from "../logging";

export interface IAmplifyConfig {
    appName: string;
    githubOwner: string;
    githubRepo: string;
    githubBranch: string;
    secretKeyName: string;
    buildSpec: any; // BuildSpec.fromObject
}

export class AmplifyStack implements IStack{
    readonly logger = createLogger(AmplifyStack.name);
    readonly fw24: Fw24 = Fw24.getInstance();
    dependencies: string[] = [];

    // default constructor to initialize the stack configuration
    constructor(private stackConfig: IAmplifyConfig){
        this.logger.debug('constructor:', stackConfig);
        // hydrate the config object with environment variables ex: AMPLIFY_GITHUB_OWNER
        Helper.hydrateConfig(stackConfig, 'AMPLIFY');
        // hydrate the config object with environment variables ex: AMPLIFY_ADMIN_GITHUB_REPO
        Helper.hydrateConfig(stackConfig, `AMPLIFY_${this.stackConfig.appName.toUpperCase()}`);
    }
    // construct method to create the stack
    public async construct(){
        this.logger.debug(' construct for:', this.stackConfig.appName);
        const fw24 = Fw24.getInstance();
        // get the main stack from the framework
        const mainStack = fw24.getStack('main');
        // create the stack prefix
        const stackPrefix = `${fw24.appName}-${this.stackConfig.appName}`;
        // create the amplify app
        const amplifyApp = new App(mainStack, `${stackPrefix}-amplify`, {
            appName: `${this.stackConfig.appName}`,
            buildSpec: BuildSpec.fromObject(this.stackConfig.buildSpec),
            sourceCodeProvider: new GitHubSourceCodeProvider({
                owner: this.stackConfig.githubOwner,
                repository: this.stackConfig.githubRepo,
                // make sure to store the secret value as **plain-text**
                oauthToken: SecretValue.secretsManager(this.stackConfig.secretKeyName),
            })
        });
        // add the custom rules
        amplifyApp.addCustomRule(CustomRule.SINGLE_PAGE_APPLICATION_REDIRECT);
        // add the branch
        amplifyApp.addBranch(this.stackConfig.githubBranch);
        // add the stack to the framework
        fw24.addStack('amplify', amplifyApp);
        // add the amplify url to the main stack outputs
        new CfnOutput(mainStack, `${stackPrefix}-amplify-url`, {
            value: `https://${this.stackConfig.githubBranch}.${amplifyApp.appId}.amplifyapp.com`
        });
    }
}

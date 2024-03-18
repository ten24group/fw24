import { SecretValue, CfnOutput } from "aws-cdk-lib";
import { BuildSpec } from "aws-cdk-lib/aws-codebuild";
import { App, CustomRule, GitHubSourceCodeProvider } from '@aws-cdk/aws-amplify-alpha';

import { IAmplifyConfig } from "../interfaces/amplify";
import { Fw24 } from "../core/fw24";
import { IStack } from "../interfaces/stack";

export class Amplify implements IStack{

    // default contructor to initialize the stack configuration
    constructor(private stackConfig: IAmplifyConfig){
        console.log('Amplify stack constructor', stackConfig);
    }

    // construct method to create the stack
    public construct(fw24: Fw24){
        console.log('Amplify construct for:', this.stackConfig.appName);
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
            value: `https://${this.config.githubBranch}.${amplifyApp.appId}.amplifyapp.com`
        });
    }
}

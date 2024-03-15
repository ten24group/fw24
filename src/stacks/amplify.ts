import { SecretValue, CfnOutput } from "aws-cdk-lib";
import { App, CustomRule, GitHubSourceCodeProvider } from '@aws-cdk/aws-amplify-alpha'
import { BuildSpec } from "aws-cdk-lib/aws-codebuild";

import { IAmplifyConfig } from "../interfaces/amplify.config.interface";
import { Fw24 } from "../core/fw24";

export class Amplify {

    constructor(private stackConfig: IAmplifyConfig){
        console.log('Amplify stack constructor', stackConfig);
        /*
        https://docs.aws.amazon.com/secretsmanager/latest/userguide/create_secret.html

        aws secretsmanager create-secret \
        --name MyTestSecret \
        --description "My test secret created with the CLI." \
        --secret-string "{\"user\":\"diegor\",\"password\":\"EXAMPLE-PASSWORD\"}"           

        */
    }

    public construct(fw24: Fw24){
        console.log('Amplify construct for:', this.stackConfig.appName);

        const mainStack = fw24.getStack('main');
        const stackPrefix = `${fw24.appName}-${this.stackConfig.appName}`;

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

        amplifyApp.addCustomRule(CustomRule.SINGLE_PAGE_APPLICATION_REDIRECT);
        amplifyApp.addBranch(this.stackConfig.githubBranch);

        fw24.addStack('amplify', amplifyApp);

        new CfnOutput(mainStack, `${stackPrefix}-amplify-url`, {
            value: `https://${this.config.githubBranch}.${amplifyApp.appId}.amplifyapp.com`
        });
    }

}



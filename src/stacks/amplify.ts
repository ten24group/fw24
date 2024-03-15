import { SecretValue, CfnOutput } from "aws-cdk-lib";
import { App, CustomRule, GitHubSourceCodeProvider } from '@aws-cdk/aws-amplify-alpha'
import { BuildSpec } from "aws-cdk-lib/aws-codebuild";

import { IApplicationConfig } from "../interfaces/config";
import { IAmplifyConfig } from "../interfaces/amplify";

export class Amplify {

    constructor(private config: IAmplifyConfig){
        console.log('Amplify stack constructor', config);
        /*
        https://docs.aws.amazon.com/secretsmanager/latest/userguide/create_secret.html

        aws secretsmanager create-secret \
        --name MyTestSecret \
        --description "My test secret created with the CLI." \
        --secret-string "{\"user\":\"diegor\",\"password\":\"EXAMPLE-PASSWORD\"}"           

        */
    }

    public construct(appConfig: IApplicationConfig){
        console.log('Amplify construct appConfig, config', appConfig, this.config);

        const mainStack = Reflect.get(globalThis, "mainStack");

        const amplifyApp = new App(mainStack, `${appConfig.name}-amplify`, {
            appName: `${this.config.appName}`,
            buildSpec: BuildSpec.fromObject(this.config.buildSpec),
            sourceCodeProvider: new GitHubSourceCodeProvider({
                owner: this.config.githubOwner,
                repository: this.config.githubRepo,
                // make sure to store the secret value as **plain-text**
                oauthToken: SecretValue.secretsManager(this.config.secretKeyName),
            })
        });

        amplifyApp.addCustomRule(CustomRule.SINGLE_PAGE_APPLICATION_REDIRECT);
        amplifyApp.addBranch(this.config.githubBranch);

        new CfnOutput(mainStack, `AmplifyAppURL-${appConfig.name}`, {
            value: `https://${this.config.githubBranch}.${amplifyApp.appId}.amplifyapp.com`
        });
    }

}



# Amplify

The `Amplify` class is responsible for creating and configuring an Amplify application using AWS CDK. It takes an `IAmplifyConfig` object as a parameter in the constructor and provides a method `construct` to build the Amplify application based on the passed configuration.

## Imports
```typescript
import { SecretValue, CfnOutput } from "aws-cdk-lib";
import { App, CustomRule, GitHubSourceCodeProvider } from '@aws-cdk/aws-amplify-alpha'
import { BuildSpec } from "aws-cdk-lib/aws-codebuild";

import { IApplicationConfig } from "../interfaces/config";
import { IAmplifyConfig } from "../interfaces/amplify";
```

### Constructor
```typescript
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
```

- The constructor takes an `IAmplifyConfig` object as a parameter and logs the configuration details.
- The constructor also includes a comment with a sample CLI command to create a secret using AWS Secrets Manager.

### construct Method
```typescript
public construct(appConfig: IApplicationConfig){
    console.log('Amplify construct appConfig, config', appConfig, this.config);

    const mainStack = Reflect.get(globalThis, "mainStack");

    const amplifyApp = new App(mainStack, `${appConfig.name}-amplify`, {
        appName: `${this.config.appName}`,
        buildSpec: BuildSpec.fromObject(this.config.buildSpec),
        sourceCodeProvider: new GitHubSourceCodeProvider({
            owner: this.config.githubOwner,
            repository: this.config.githubRepo,
            oauthToken: SecretValue.secretsManager(this.config.secretKeyName),
        })
    });

    amplifyApp.addCustomRule(CustomRule.SINGLE_PAGE_APPLICATION_REDIRECT);
    amplifyApp.addBranch(this.config.githubBranch);

    new CfnOutput(mainStack, `AmplifyAppURL-${appConfig.name}`, {
        value: `https://${this.config.githubBranch}.${amplifyApp.appId}.amplifyapp.com`
    });
}
```

- The `construct` method creates an Amplify application based on the provided `appConfig` and the configuration set in the constructor.
- It fetches the main stack using `Reflect.get` and then creates a new `App` instance with the specified parameters.
- The method adds a custom rule for single-page application redirect and a branch for the GitHub repository.
- It creates a CloudFormation output displaying the URL of the deployed Amplify application.

This `Amplify` class encapsulates the logic for setting up and deploying an Amplify application using AWS CDK. It ensures that the configuration is properly set and the application is constructed according to the specified parameters.
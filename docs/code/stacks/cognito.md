# Documentation for cognito.ts

# CognitoStack Class

The `CognitoStack` class is responsible for creating and configuring AWS Cognito user pools, user pool clients, and authentication triggers.

## Dependencies
- `aws-cdk-lib/aws-cognito`: used for creating Cognito user pools and user pool clients.
- `aws-cdk-lib/aws-iam`: used for creating IAM roles and policies.
- `aws-cdk-lib/aws-apigateway`: used for creating Cognito User Pools Authorizer.
- `aws-cdk-lib`: AWS CDK library.
- `fs`: Node.js file system module.

## Interfaces
### ICognitoConfig
- `userPool`: Object containing user pool configuration.
- `policyFilePath` (optional): Path to the policy file.

### ICognitoUserPoolConfig
- `props`: `awsCognito.UserPoolProps`.

## Properties
- `userPool`: `awsCognito.UserPool` instance.
- `userPoolClient`: `awsCognito.UserPoolClient` instance.
- `userPoolAuthorizer`: `CognitoUserPoolsAuthorizer` instance.
- `role`: `iam.Role` instance.

## Constructor
### `constructor(config: ICognitoConfig)`
- Initializes the `CognitoStack` with the provided configuration.

## Methods
### `construct(appConfig: IApplicationConfig)`
- Constructs the Cognito user pool, user pool client, authorizer, identity pool, and IAM role based on the provided `appConfig`.
- Handles the creation of user pool, user pool client, authorizer, identity pool, and IAM role.
- Reads policy file, if specified, and applies the policy to the IAM role.

### `addCognitoTrigger(lambdaFunction: any)`
- Adds a trigger to the Cognito user pool for the specified lambda function.

### `getTenantId(): string`
- Retrieves the tenant ID.

---

The `CognitoStack` class provides functionality for setting up and configuring Cognito resources within an AWS CDK stack. The class includes methods for constructing Cognito components based on the provided configuration and adding triggers to the user pool. Additionally, it allows for the retrieval of the tenant ID.
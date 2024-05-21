# CognitoAuthRole

## Introduction

The `CognitoAuthRole` is a part of the FW24 toolkit, designed to simplify the process of integrating AWS Cognito authentication roles into your application. With `CognitoAuthRole`, you can define a Cognito authentication role with its properties. The configuration involves setting up `identityPool` and `policyFilePaths`:

- `identityPool`: The identity pool for the Cognito authentication role.
- `policyFilePaths`: The file paths for the policy files to be attached to the role.

## Usage

```ts
    import { CognitoAuthRole } from '@ten24group/fw24';

    var cognitoAuthRole = new CognitoAuthRole(
        //scope
        someConstructInstance, 
        // id
        'my-cognito-role', 
        // props
        { 
            identityPool: 'my-identity-pool',
            policyFilePaths: ['policy1.json', 'policy2.json'],
        }
    );

```

In this configuration:

- `someConstructInstance` the scope for this role like the main-stack, some sub-stack or some other construct
- `identityPool` sets the identity pool for the Cognito authentication role.
- `policyFilePaths` sets the file paths for the policy files to be attached to the role.

Feel free to adjust these settings to match your application's requirements.

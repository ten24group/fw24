---
sidebar_position: 1
---
# Auth

The `fw24-auth-cognito` is a robust authentication and authorization module designed specifically for the Framework24 (FW24) project. This module is built on top of AWS Cognito, a powerful user identity and data synchronization service that helps you securely manage and synchronize app data for your users across their mobile devices.

The `fw24-auth-cognito` module provides a comprehensive set of APIs for user management, making it easier to add `sign-up`, `verification`, `sign-in`, `forgot-password`, `reset-password` enhanced security functionality to your FW24 applications. 

Here's a brief overview of these APIs:

1. `sign-up`: This API allows new users to register themselves in the application. It takes user details such as `email`, `password`, and other necessary attributes as input and creates a new user in the AWS Cognito User Pool.

2. `verification`: After signing up, users need to verify their account to confirm their identity. This API sends a verification code to the user's email, which the user must enter to verify their account.

3. `sign-in`: This API allows registered users to log in to the application. It takes the `email` and `password` as input and returns a JWT token if the credentials are valid.

4. `forgot-password`: If a user forgets their password, this API can be used to initiate the password recovery process. It sends a verification code to the user's `email`, which can be used to reset the password.

5. `reset-password`: This API allows users to reset their password. It takes the verification code received from the `forgot-password` API and the new password as input and updates the user's password in the AWS Cognito User Pool.

For a detailed overview of the APIs provided by this module, please refer to the `./src/controllers/auth.ts`. This file contains the implementation of these APIs, including the request parameters, response format, error handling, and interaction with AWS Cognito.

Please note that the actual implementation and usage of these APIs may vary depending on your application's requirements and the configuration of your AWS Cognito User Pool. Always refer to the AWS Cognito documentation and the `fw24-auth-cognito` module documentation for the most accurate and up-to-date information.

## Installation

To install the fw24-auth-cognito module, you can use the npm package manager. Run the following command in your terminal inside your project:

```shell
npm install @ten24group/fw24-auth-cognito
```

## Adding the Module to Your Project Using cli24

You can also add it to your FW24 project using the `cli24`. Navigate to the root directory of your project and run the following command:

```shell
cli24 add-module auth-cognito
```

## Basic usages

Add auth module with default configurations:

```shell
import { AuthModule } from '@ten24group/fw24-auth-cognito';

const authModule = new AuthModule({});
```

## Detail usages

Add auth module with configurations

```ts
  import { AuthModule } from '@ten24group/fw24-auth-cognito';

  const authModule = new AuthModule({
    userPool: {
      props: {
        userPoolName: 'authmodule'
        selfSignUpEnabled: true,
        // all user pool properties available here: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cognito.UserPoolProps.html
      }
    },
    groups: [
      {
        name: 'admin',
        precedence: 0
        policyFilePaths: [
          './src/policy/admin.json',
        ],
        routes: ['mauth/addUserToGroup/', 'mauth/removeUserFromGroup/'],
      },
      {
        name: 'user',
        precedence: 1
        autoUserSignup: true,
        policyFilePaths: [
          './src/policy/user.json',
        ],
      }
    ],
    useAsDefaultAuthorizer: true
  });

```

## Customize the Authentication Flow

The `fw24-auth-cognito` module leverages `AWS Cognito` for authentication, and the customization of the authentication flow largely depends on the features and capabilities provided by AWS Cognito itself.

In the snippet below, you can see that the `AuthModule` is instantiated with a configuration object. This object can include a `userPool` property, which is an object that can have a props property. This props property can contain all the user pool properties available in AWS Cognito. You can find the full list of these properties in the [AWS Cognito UserPoolProps documentation](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cognito.UserPoolProps.html).

For example, to customize the authentication flow to add multi-factor authentication (MFA), you can set the `mfa` and `mfaSecondFactor` properties in the `props` object:

```ts
const authModule = new AuthModule({
  userPool: {
    props: {
      userPoolName: 'authmodule',
      selfSignUpEnabled: true,
      mfa: 'OPTIONAL',
      mfaSecondFactor: {
        sms: true,
        otp: true
      },
      // other user pool properties...
    }
  },
  // other configuration properties...
});
```

In this example, MFA is set to optional, meaning the user has the choice to set up MFA for their account, and both SMS and one-time password (OTP) are enabled as the second factor for MFA.

Remember, any customization of the authentication flow should comply with AWS Cognito's capabilities and limitations.

## Configure user Sign-up Settings

The user sign-up settings can be configured through the `userPool` property in the configuration object passed to the AuthModule constructor.

For example, to enable self sign-up and to specify the attributes that users must provide when they sign up, you can set the `selfSignUpEnabled` and `standardAttributes` properties in the `props` object:

```ts
const authModule = new AuthModule({
  userPool: {
    props: {
      userPoolName: 'authmodule',
      selfSignUpEnabled: true,
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        fullname: {
          required: true,
          mutable: true,
        },
        // other attributes...
      },
      // other user pool properties...
    }
  },
  // other configuration properties...
});
```

In this example, self sign-up is enabled, and users are required to provide their email and full name when they sign up. Both the email and full name attributes are mutable, meaning they can be changed after the user has signed up.

## Customize the Email-templates for Verification and Password-reset

The email templates for user verification and password reset can be customized through the `userPool` property in the configuration object passed to the `AuthModule` constructor.

For example, to customize the verification and password reset email templates, you can set the `userVerification` and `forgotPassword` properties in the `props` object:

```ts
const authModule = new AuthModule({
  userPool: {
    props: {
      userPoolName: 'authmodule',
      selfSignUpEnabled: true,
      userVerification: {
        emailSubject: 'Verify your email for our app',
        emailBody: 'Hello {username}, Thanks for signing up to our app! Your verification code is {####}',
        emailStyle: 'CODE',
        smsMessage: 'Your verification code for our app is {####}'
      },
      forgotPassword: {
        emailSubject: 'Reset your password for our app',
        emailBody: 'Hello {username}, It seems that you forgot your password for our app. Your verification code is {####}',
        emailStyle: 'CODE',
        smsMessage: 'Your verification code to reset your password for our app is {####}'
      },
      // other user pool properties...
    }
  },
  // other configuration properties...
});
```

In this example, the verification and password reset emails are customized with specific subjects and bodies. The `{username}` and `{####}` placeholders in the email body are replaced with the actual username and verification code, respectively.

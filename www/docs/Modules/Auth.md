---
sidebar_position: 1
---

# Auth

## Introduction

The `fw24-auth-cognito` is a robust authentication and authorization module designed specifically for the `Framework24` (FW24) project. This module is built on top of `AWS Cognito`, a powerful user identity and data synchronization service that helps you securely manage and synchronize app data for your users across their mobile devices.

The `fw24-auth-cognito` module provides a comprehensive set of APIs for user management, making it easier to add `sign-up`, `verification`, `sign-in`, forgot-password, reset-password enhanced security functionality to your FW24 applications.

The module is designed to be highly configurable, allowing developers to customize the authentication flow, user `sign-up` settings, and email templates for user `verification` and `password reset`. This flexibility makes it an ideal choice for applications that require a tailored user experience.

In addition to its core functionality, the `fw24-auth-cognito` module also provides a set of helper functions for managing user sessions, handling token refresh, and performing other common tasks related to user authentication and authorization. This makes it a comprehensive solution for managing user identities in FW24 applications.

The module is designed with a focus on security, leveraging `AWS Cognito`'s built-in features such as `multi-factor authentication` (MFA), encryption of user data, and protection against common web threats such as CSRF and XSS attacks. This ensures that your user data is always protected, and your application remains secure.

Whether you're building a small application with a handful of users, or a large-scale project with millions of users, the `fw24-auth-cognito` module provides a scalable, secure, and easy-to-use solution for managing user identities.

## Getting Started

To get started with the `fw24-auth-cognito` module, you'll need to install it, import it into your project, and configure it. Here's a step-by-step guide on how to do this:

### Step 1: Installation

First, you need to install the `fw24-auth-cognito` module. You can do this using the npm package manager. Open your terminal and run the following command:

```shell
npm install @ten24group/fw24-auth-cognito
```

Alternatively, if you're using the `Framework24 CLI`, you can add the module to your project using the add-module command:

```shell
cli24 add-module auth-cognito
```

### Step 2: Importing the Module

Once the module is installed, you can import it into your project. Here's how you can do this:

```ts
import { AuthModule } from '@ten24group/fw24-auth-cognito';
```

### Step 3: Configuring the Module

After importing the module, you need to configure it. You can do this by creating a new instance of the `AuthModule` class and passing a configuration object to the constructor:

```ts
const authModule = new AuthModule({
  userPool: {
    props: {
      userPoolName: 'authmodule',
      selfSignUpEnabled: true,
      // other user pool properties...
    }
  },
  groups: [
    // group configurations...
  ],
  useAsDefaultAuthorizer: true
});
```

The configuration object allows you to customize various aspects of the module, such as the user pool properties, group configurations, and whether to use the module as the default authorizer.

That's it! You're now ready to start using the `fw24-auth-cognito` module in your project.

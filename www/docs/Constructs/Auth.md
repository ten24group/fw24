# Auth Construct

## Introduction

`AuthConstruct` is a powerful construct provided by `FW24`, designed to seamlessly integrate authentication capabilities into your application. This construct abstracts the complexities of user authentication, allowing developers to focus on building their application's core functionalities.

In the provided code, `AuthConstruct` is used to set up an authentication system. It takes in a configuration object that specifies the authentication details such as user pool, identity pool, and user pool client.

With `AuthConstruct`, you can easily manage user sign-up, sign-in, access control, and even multi-factor authentication. It's a versatile tool that not only enhances the security of your application but also improves the user experience by providing a smooth and secure authentication process.

## Getting Started

This guide will walk you through the process of importing, configuring, and using `AuthConstruct` in your project.

### Step 1: Importing

First things first, let's bring AuthConstruct into your project. You can do this by importing it from the FW24 as shown below:

```ts
import { AuthConstruct } from '@ten24group/fw24';
```

### Step 2: Configuration

Now that `AuthConstruct` is part of your project, it's time to configure it to suit your needs. The configuration involves setting up `userPool`, `identityPool`, `userPoolClient`, and other options:

```ts
  var auth = new AuthConstruct({
    userPool: {
      poolName: 'MyUserPool',
      autoVerifiedAttributes: ['email'],
    },
    identityPool: {
      identityPoolName: 'MyIdentityPool',
    },
    userPoolClient: {
      clientName: 'MyUserPoolClient',
    },
    defaultAuthorizationType: 'USER_POOL',
  });
```

In this configuration:

- `userPool` sets up the user pool with a name and auto-verified attributes.
- `identityPool` sets up the identity pool with a name.
- `userPoolClient` sets up the user pool client with a name.
- `defaultAuthorizationType` sets the default authorization type.

Feel free to adjust these settings to match your application's requirements.

### Step 3: Usages

With AuthConstruct configured, it's time to put it to work. Here's how you can incorporate it into your application:

```ts
  app.use(auth).run();
```

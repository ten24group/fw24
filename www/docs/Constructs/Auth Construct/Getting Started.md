---
sidebar_position: 2
---

# Getting Started

`AuthConstruct` is a powerful tool from the FW24 that simplifies the process of setting up and managing authentication in AWS. This guide will walk you through the process of importing, configuring, and using `AuthConstruct` in your project.

## Step 1: Importing

First things first, let's bring AuthConstruct into your project. You can do this by importing it from the FW24 as shown below:

```ts
import { AuthConstruct } from '@ten24group/fw24';
```

## Step 2: Configuration

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

## Step 3: Usages

With AuthConstruct configured, it's time to put it to work. Here's how you can incorporate it into your application:

```ts
  app.use(auth).run();
```

---
sidebar_position: 2
---

# Getting Started

To get started with the `fw24-auth-cognito` module, you'll need to install it, import it into your project, and configure it. Here's a step-by-step guide on how to do this:

## Step 1: Installation

First, you need to install the `fw24-auth-cognito` module. You can do this using the npm package manager. Open your terminal and run the following command:

```shell
npm install @ten24group/fw24-auth-cognito
```

Alternatively, if you're using the `Framework24 CLI`, you can add the module to your project using the add-module command:

```shell
cli24 add-module auth-cognito
```

## Step 2: Importing the Module

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

That's it! You're now ready to start using the `fw24-auth-cognito` module in your project. For more detailed information on how to use the module, please refer to the rest of this documentation.

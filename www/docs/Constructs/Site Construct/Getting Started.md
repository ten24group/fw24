---
sidebar_position: 2
---

# Getting Started

Welcome to the `SiteConstruct` guide! `SiteConstruct` is a robust tool from the FW24 package that simplifies the process of deploying static websites using AWS Amplify in your application. This guide will walk you through the process of importing, configuring, and using `SiteConstruct` in your project.

## Step 1: Importing

First things first, let's bring `SiteConstruct` into your project. You can do this by importing it from the FW24 package as shown below:

```ts
import { SiteConstruct } from '@ten24group/fw24';
```

## Step 2: Configuration

Now that `SiteConstruct` is part of your project, it's time to configure it to suit your needs. The configuration involves setting up `App`, `CustomRule`, `GitHubSourceCodeProvider`, and `ISiteConstructConfig`:

```ts
  var site = new SiteConstruct({
    App: {
      name: 'my-app',
      repository: 'https://github.com/user/repo',
      environmentVariables: {
        'ENV_VAR_NAME': 'value',
        // add more environment variables as needed
      },
    },
    CustomRule: [
      {
        source: '/<source>',
        target: '/<target>',
        status: '302',
      },
    ],
    GitHubSourceCodeProvider: {
      owner: 'github-user',
      repository : 'github-repo',
      oauthToken: cdk.SecretValue.secretsManager('GITHUB_TOKEN'),
    },
    ISiteConstructConfig: {
      env: {
        name: 'my-env',
        prefix: 'my-prefix',
      },
    },
  });
```

In this configuration:

- `App` sets the AWS Amplify application that will host your static website. You can specify the name and repository of the application here.
- `CustomRule` sets the custom rules for the AWS Amplify application, such as redirection rules.
- `GitHubSourceCodeProvider` sets the source code provider for the AWS Amplify application. It's where AWS Amplify expects to find your website's source code.
- `ISiteConstructConfig` sets the interface for the configuration of the site construct. It's where you specify the properties of your static website.

Feel free to adjust these settings to match your application's requirements.

## Step 3: Usages

With `SiteConstruct` configured, it's time to put it to work. Here's how you can incorporate it into your application:

```ts
  app.use(site).run();
```

This will add the configured site to your application. You can now manage static websites in your AWS applications using the `SiteConstruct`.

## Step 4: Continuous Integration and Continuous Delivery (CI/CD)

One of the key features of `SiteConstruct` is its ability to leverage AWS Amplify's CI/CD capabilities. This means that whenever you push changes to the source code repository specified in `GitHubSourceCodeProvider`, AWS Amplify will automatically build and deploy your website. This automation ensures that your website is always up-to-date with the latest changes.

In conclusion, `SiteConstruct` provides a streamlined way to manage static websites, making it easier to deploy and host websites in your AWS applications. Whether you're creating a personal blog, a company website, or a portfolio, `SiteConstruct` simplifies the task of managing static websites in AWS. It's an invaluable tool that not only streamlines website deployment but also enhances the overall efficiency and responsiveness of your application, thanks to the CI/CD capabilities of AWS Amplify.

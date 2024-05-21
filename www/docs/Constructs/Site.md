
# SiteConstruct

## Introduction

`SiteConstruct` is a powerful tool from the FW24 suite designed to streamline the deployment of static websites using AWS Amplify. It abstracts the complexities of setting up AWS Amplify, allowing developers to focus on building their applications rather than managing infrastructure.

With `SiteConstruct`, you can easily configure and deploy your static websites directly from your GitHub repository. It provides a simple interface to specify your `application name`, `GitHub owner`, `repository`, `branch`, and the `secret key name` for your GitHub authentication token.

Moreover, `SiteConstruct` also allows you to define a `buildSpec` for your website, which outlines the build and test settings for your application. This includes the commands to run during each build phase, the location of build output artifacts, and the directories to cache between builds.

In essence, `SiteConstruct` is a robust tool that simplifies the deployment process, making it an excellent choice for developers looking to deploy static websites on AWS Amplify with minimal hassle.

## Getting Started

This guide will walk you through the process of importing, configuring, and using `SiteConstruct` in your project.

### Step 1: Importing

First things first, let's bring `SiteConstruct` into your project. You can do this by importing it from the FW24 as shown below:

```ts
import { SiteConstruct } from '@ten24group/fw24';
```

### Step 2: Configuration

Now that `SiteConstruct` is part of your project, it's time to configure it to suit your needs. The configuration involves setting up `appName`, `githubOwner`, `githubRepo`, `githubBranch`, `secretKeyName`, and the `buildSpec` for your website:

```ts
  var site = new SiteConstruct({
    appName: "My App";
    githubOwner: "my-user";
    githubRepo: "my-app";
    githubBranch: "develop";
    secretKeyName: "my-github-auth-token";
    buildSpec: {
        version: 1,
        frontend: {
            phases: {
              preBuild: {
                commands: [
                      // this command below will pull the token from AWS secretsmanager and export it into the build process
                      "export GITHUB_TOKEN=$(aws secretsmanager get-secret-value --secret-id my-github-auth-token --query 'SecretString' --output text)", 
                      // install the dependencies
                      "npm install"
                    ],
                },
                build: {
                    commands: ["npm run build"],
                },
            },
            artifacts: {
                baseDirectory: "dist",
                files: ["**/*"],
            },
            cache: {
                paths: ["node_modules/**/*"],
            },
        },
    }
  });
```

In this configuration:

- `appName` sets the AWS Amplify application that will host your static website. You can specify the name and repository of the application here.
- `githubOwner` is the username of the GitHub account where the repository for your website is located.
- `githubRepo` is the name of the GitHub repository that contains the code for your website.
- `githubBranch` is the branch in your GitHub repository that AWS Amplify should use to build and deploy your website.
- `secretKeyName` is the name of the AWS Secrets Manager secret that contains your GitHub personal access token. AWS Amplify uses this token to access your GitHub repository.
- `buildSpec` is a configuration object in AWS Amplify that defines the build and test settings for your application. It specifies the commands to run during each build phase (like pre-build, build, and post-build), the location of build output artifacts, and the directories to cache between builds.

Feel free to adjust these settings to match your application's requirements.

### Step 3: Usages

With `SiteConstruct` configured, it's time to put it to work. Here's how you can incorporate it into your application:

```ts
  app.use(site).run();
```

After the deployment of your application, Amplify establishes necessary hooks into the designated repository. Consequently, any modifications pushed to the specified branch and repository in the configuration will initiate an automatic build and deployment of your website via AWS Amplify. This automated process ensures that your website consistently reflects the most recent updates.

---
sidebar_position: 1
---

# Introduction to APIConstruct

APIConstruct is a robust, feature-packed construct designed for FW24, built on the AWS-CDK framework. It is meticulously crafted to seamlessly integrate an API Gateway into your FW24 application, which operates on a serverless architecture.

The primary role of APIConstruct is to establish an API Gateway. However, its capabilities extend far beyond this fundamental function. It takes on the responsibility of setting up routes, authorizers, and policies, as well as orchestrating AWS Lambda functions.

APIConstruct's responsibilities don't end there. It also manages the permissions and environment settings for these Lambdas. This means that with APIConstruct, you are relieved from the intricate details of setting up and managing your API Gateway and its associated components. APIConstruct takes care of these complexities, allowing you to concentrate on what matters most - building your application.

APIConstruct leverages the `IAPIConstructConfig` interface to configure the API construct. This interface, defined in the `api.ts` file, includes options for specifying the CORS configuration for the API, additional options for the API, the directory where the controllers are located, the properties for the Node.js function, the number of days to retain the API logs, and the removal policy for the API logs.

By providing a configuration object that adheres to the `IAPIConstructConfig` interface, you can effortlessly customize the behavior of the API construct to align with your specific needs.

In conclusion, APIConstruct is a comprehensive construct that simplifies the process of setting up and managing an API Gateway in AWS. Whether you're building a small application with a few routes or a large application with complex routing and authorization needs, APIConstruct is equipped to handle it all.

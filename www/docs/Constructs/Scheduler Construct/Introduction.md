---
sidebar_position: 1
---

# Introduction

`SiteConstruct` is a robust construct from the FW24 toolkit, designed to streamline the process of deploying static websites using AWS Amplify. `SiteConstruct` leverages the power of AWS Amplify, a service that not only hosts static websites but also provides continuous integration and continuous delivery (CI/CD) capabilities. This means that with `SiteConstruct`, you can automate the process of deploying updates to your website whenever changes are made to the source code.

The configuration of `SiteConstruct` involves setting up `App`, `CustomRule`, `GitHubSourceCodeProvider`, and `ISiteConstructConfig`:

- `App`: This is the AWS Amplify application that will host your static website.
- `CustomRule`: These are the custom rules for the AWS Amplify application, such as redirection rules.
- `GitHubSourceCodeProvider`: This is the source code provider for the AWS Amplify application. It's where AWS Amplify expects to find your website's source code.
- `ISiteConstructConfig`: This is the interface for the configuration of the site construct. It's where you specify the properties of your static website.

By using `SiteConstruct`, you can manage static websites more efficiently, making it easier to deploy and host websites in your AWS applications. Whether you're creating a personal blog, a company website, or a portfolio, `SiteConstruct` simplifies the task of managing static websites in AWS. It's an invaluable tool that not only streamlines website deployment but also enhances the overall efficiency and responsiveness of your application, thanks to the CI/CD capabilities of AWS Amplify.

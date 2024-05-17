---
sidebar_position: 1
---

# Framework 24

FW24 is a rapid application development framework designed specifically for serverless architectures. It abstracts the complexity of AWS CDK constructs, providing users with a familiar and simple MVC-based structure to work with.

The framework is designed to accelerate the development process, with built-in support for a variety of features that are commonly required in modern web applications.

## Key features

- ***Emails and Templates***: Built-in support for sending emails using non-blocking queues and support for customizable email templates, facilitating consistent and professional communication.

- ***Command-Line Interface (CLI) Support***: FW24 is equipped with a dedicated command-line interface, `cli24`. This interface streamlines various tasks, including setting up the development environment and generating new sites. It allows developers to execute commands directly from the terminal, making it easier to manage and control the application's development process.

- ***CRUD APIs***: FW24 offers out-of-the-box support for `CRUD API` operations. This feature simplifies the process of creating, reading, updating, and deleting resources. It reduces the need for repetitive boilerplate code, enabling seamless data management and efficient implementation of business logic.

- ***Admin Portal***: The framework incorporates a built-in admin portal. This portal provides a user-friendly and `auto-generated` interface for managing your application. It allows administrators to oversee and control various aspects of the application without needing to interact directly with the codebase.

- ***Validation Framework***: FW24 includes a comprehensive, enterprise-grade validation framework. This feature ensures data integrity and consistency across your application. It checks the data against predefined rules and conditions, preventing the entry and propagation of invalid data.

- ***Emails and Templates***: FW24 has built-in support for sending `emails` using non-blocking queues. It also supports customizable `email templates`, facilitating consistent and professional communication with users. This feature enhances the application's ability to engage with its users effectively.

- ***Queues***: FW24 supports asynchronous task management. This feature enhances application performance by allowing for non-blocking operations. It also supports a `fanout` design, which enables the application to handle multiple tasks simultaneously, improving efficiency and responsiveness.

- ***Scheduled Tasks***: FW24 includes built-in functionality for scheduling routine tasks and processes. This feature promotes increased efficiency and automation, allowing the application to perform regular tasks without manual intervention.

- ***S3 Buckets***: FW24 simplifies interaction with AWS S3 for storing and retrieving files. It abstracts away the complexities of direct AWS SDK usage, making it easier for developers to manage file storage and retrieval.

- ***Authentication***: FW24 provides robust, built-in support for secure data access. It includes user authentication and authorization mechanisms based on AWS Cognito. FW24 supports both `JWT` based authentication and `AWS_IAM` based authentication, ensuring secure access to application resources.

- ***Continuous Integration/Continuous Deployment (CI/CD)***: FW24 has built-in support for `CI/CD` operations using `AWS's Amplify`. This feature streamlines the process of integrating changes and deploying the application, promoting a more efficient and reliable development process.

- ***Entity Query Domain Specific Languages (DSLs)***: FW24 incorporates a comprehensive query DSL for URL query parameters, providing robust support for filtering on multiple parameters. It allows for the creation of multiple and nested logical groups [`AND`, `OR`, `NOT`] of filters, offering a high degree of flexibility in data retrieval. Moreover, FW24 provides an even more powerful JSON-based DSL for POST APIs, enhancing the ability to manipulate and interact with data. These DSLs are database agnostic, meaning they can be used with any database system, thereby increasing the versatility of your application.

## Getting Started

### Prerequisites

Ensure that you have Node.js and npm installed on your system. FW24 requires Node.js version 12.x or later and npm version 6.x or later.

### Step 1: Install the CLI24

FW24 provides a command-line interface (CLI) for managing your applications. Install it using npm:

```shell
npm i @ten24group/cli24
```

### Step 2: Generate a New Application

Use the `cli24` create command to generate a new FW24 application. This command creates a new application with a **backend API** and an **admin portal**:

```shell
cli24 create myapp
```

This command creates two new directories: `myapp-backend` and `myapp-admin`. The `myapp-backend` directory contains the code for your backend API, and the `myapp-admin` directory contains the code for your admin portal.

### Step 3: Run Your Application

Navigate to the myapp-backend directory and use the cli24 watch command to start your application in watch mode. This mode automatically restarts your application whenever you make changes to the code:

```shell
cd myapp-backend

cli24 watch local
```

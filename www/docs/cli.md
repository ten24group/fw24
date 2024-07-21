---
sidebar_position: 3
---

# CLI24

CLI24 is a robust command-line interface (CLI) tool, specifically designed to simplify the process of building and deploying FW24 applications. It's your one-stop solution for managing your FW24 projects efficiently.

## Quick and Easy Installation

Get started with CLI24 by installing it globally on your machine. This allows you to access the tool from any directory. Use the following command:

```shell
npm install @ten24group/cli24 --global
```

## Kickstart Your Project

With CLI24, you can effortlessly generate a new FW24 project, complete with a backend API and an admin portal. Use the `create` command followed by your project's name:

```shell
cli24 create myapp
```

This command will create two new directories: `myapp-backend` and `myapp-admin`, setting up the basic structure of your application.

## Deploy Your Project

To deploy your project to AWS, use `deploy` command from inside your project folder:

```shell
cli24 deploy myapp
```

## Real-Time Development with Watch Mode

CLI24's `watch` command allows you to run your backend in watch mode. This means your development server will start and automatically reload whenever you make changes to your code. To use this feature, navigate to the backend directory and run:

```shell
cd myapp-backend
cli24 watch local
```

CLI24 is more than just a tool; it's a powerful ally that makes building and deploying FW24 applications a breeze. Whether you're a seasoned developer or just starting with FW24, CLI24 is designed to enhance your productivity and streamline your development workflow.

## Clean-up
To delete your app and all it's related AWS resources, run the following from outside your project folder:

```shell
cli24 delete myapp
```

## Usage

Here is a list of available commands:

### Project Creation

- `create <projectName>`: Create a new `fw24` project.
  - Example: `cli24 create myProject`
- `create-backend <projectName>`: Create a new `fw24` backend project. Use `-d, --deploy <deploy>` to deploy the project after creation.
  - Example: `cli24 create-backend myBackendProject -d aws`
- `create-admin <projectName>`: Create a new `fw24` admin project. Requires `-b, --backendProjectName <backendProjectName>` to specify the backend project name.

### Module Management

- `add-module <moduleName>`: Add a module to a `fw24` project. Use `-o, --options <options>` to specify module options.

  - Example: `cli24 add-module myModule -o "option1,option2"`

### Site Management

- `add-site <projectName>`: Add a site to a `fw24` project. Requires `-o, --orgName <orgName>` and `-r, --repoName <repoName>` to specify the Github organization and repository names.
  - Example: `cli24 add-site myProject -o myOrg -r myRepo`

### AWS Resource Management

- `add-dynamodb-table <tableName>`: Add a DynamoDB table to a `fw24` project.
- `add-dynamodb-entity <entityName>`: Add a DynamoDB entity to a `fw24` project. Requires `-t, --tableName <tableName>`, `-p, --entityNamePlural <entityNamePlural>`, and `-ep, --entityProperties <entityProperties>` to specify the DynamoDB table name, entity plural name, and entity properties.
- `add-dynamodb-entity-property <entityName> -p <propertyName> -t <propertyType> [wysiwyg|date|string]`: Add property to an entity
- `cli24 add-dynamodb-entity-relationship <entityName> -p <propertyName> -r <relatedEntityName>`: Add a related property to an entity
- `add-mailer <domainName>`: Add a Mailer to a `fw24` project.
- `add-bucket <bucketName>`: Add an S3 bucket to a `fw24` project.
- `add-bucket-withhandler <bucketName> <functionName>`: Add an S3 bucket handler function to a `fw24` project.
- `add-bucket-uiconfig`: Add a UI Config bucket to a `fw24` project.
- `add-queue <queueName>`: Add an SQS queue to a `fw24` project.
- `add-topic <topicName>`: Add an SNS topic to a `fw24` project.
- `add-task <taskName>`: Add a task to a `fw24` project.

### Testing

- `add-controller-test`: Add a test controller to a `fw24` project. Use `-b, --buckets <buckets>`, `-q, --queues <queues>`, and `-t, --topics <topics>` to specify the list of buckets, queues, and topics for resource access.

### Project Management

- `synth <environment>`: Synthesize the CDK project.
  - Example: `cli24 synth dev`
- `deploy <environment>`: Deploy the CDK project.
  - Example: `cli24 deploy prod`
- `start`: Start the React project.
  - Example: `cli24 start`
- `watch <environment>`: Watch the CDK project.
- `open-admin <projectName>`: Open the `fw24` admin app in a browser.
- `download-project <projectName>`: Download a project from Github.
- `delete <projectName>`: Delete a `fw24` project and destroy all resources.
- `delete-backend <projectName>`: Delete a `fw24` backend project and destroy all resources.
- `delete-admin <projectName>`: Delete a `fw24` admin project and destroy all resources.
- `add-cicd -o GITHUBORG -r REPO -b BRANCH -e ENV_FILENAME`: Setup a github workflow action to automatically deploy your project

### Logging

- `tail <logGroupName>`: Tail the log group with matching name. Use `-f, --follow`, `-s, --since <since>`, `-fp, --filterPattern <filterPattern>`, and `-fr, --format <format>` to customize the output.

  - Example: `cli24 tail /aws/lambda/myFunction -f -s 1h -fp "ERROR" -fr "short"`

### Documentation

- `list-routes`: Generate a list of API Gateway endpoints and methods for a given project. Use `-p, --projectName <projectName>` to specify the project name.
- `generate-api-docs <projectName>`: Generate API documentation for a `fw24` project.

### Sample Project

- `generate-sample-project <projectName>`: Generate a sample project.

For more information about each command, use `cli24 help <command>`.

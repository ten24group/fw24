# Dynamo

The `DynamoStack` class is used for creating and managing DynamoDB tables in an AWS CDK application.

## Dependencies
- `aws-cdk-lib/aws-dynamodb`
- `../interfaces/config`

## Interfaces
### `IDynamoConfig`
- `table: IDynamoTableConfig`

### `IDynamoTableConfig`
- `name: string`
- `props: dynamodb.TablePropsV2`

## Methods
### Constructor
```ts
constructor(config: IDynamoConfig)
```
- Initializes a new instance of the `DynamoStack` class with the provided `IDynamoConfig`.
- Logs a message "DynamoDBTable".

### `construct(appConfig: IApplicationConfig)`
```ts
public construct(appConfig: IApplicationConfig)
```
- Constructs and deploys the DynamoDB table based on the configuration provided.
- Logs a message "DynamoDB construct" along with the `appConfig`.
- Retrieves the main stack from the global scope.
- Generates the qualified table name by combining `this.config.table.name` with "_table".
- Logs the `appQualifiedTableName`.
- Creates a new instance of `dynamodb.TableV2` with the provided `this.config.table.props`.
- Registers the table instance in the global scope with the `appQualifiedTableName`.

## Usage
```ts
import { DynamoStack } from 'path/to/DynamoStack';
import { IApplicationConfig } from 'path/to/interfaces/config';

const config = {
    table: {
        name: 'MyDynamoTable',
        props: { tableName: 'MyDynamoTable', partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING } }
    }
};

const dynamoStack = new DynamoStack(config);
dynamoStack.construct({ /* appConfig */ });
```

Ensure to provide the necessary configuration for the DynamoDB table creation.
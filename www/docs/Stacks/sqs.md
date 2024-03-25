# SQS 

The `SQS` class is responsible for setting up and registering SQS queues and associated Lambda functions.

## Imports
```typescript
import { Duration, Stack, CfnOutput } from "aws-cdk-lib";
import Mutable from "../types/mutable";
import { readdirSync } from "fs";
import { resolve, join } from "path";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Architecture, LayerVersion, Runtime } from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { TableV2 } from "aws-cdk-lib/aws-dynamodb";

import QueueDescriptor from "../interfaces/queue-descriptor";
import { IApplicationConfig } from "../interfaces/config";
import { Helper } from "../core/helper";
import { ISQSConfig } from "../interfaces/sqs";
import { QueueProps } from "aws-cdk-lib/aws-sqs";
import { IQLambdaEnvConfig } from "../fw24";
```

## Class Definition
```typescript
export class SQS {
    appConfig: IApplicationConfig | undefined;
    mainStack!: Stack;

    constructor(private config: ISQSConfig) {
        // Constructor function
    }

    public construct(appConfig: IApplicationConfig) {
        // Public method to construct
    }

    private getLayerARN(): string {
        // Private method to get Layer ARN
    }

    private registerQueue(queueInfo: QueueDescriptor) {
        // Private method to register a Queue
    }

    private async registerQueues() {
        // Private method to dynamically register Queues
    }
}
```

### Constructor
- Parameters: `config: ISQSConfig`
- Description: Initializes the `SQS` class with the provided SQS config. If no queues are defined, it sets the default path to "./src/queues".

### Public Method `construct`
- Parameters: `appConfig: IApplicationConfig`
- Description: Constructs the SQS object with the provided application configuration. It throws an error if no queues are defined.

### Private Method `getLayerARN`
- Return Type: `string`
- Description: Generates and returns the Layer ARN based on the application configuration.

### Private Method `registerQueue`
- Parameters: `queueInfo: QueueDescriptor`
- Description: Registers a queue by creating the SQS queue, Lambda function, adding environment variables, event sources, and granting necessary permissions.

### Private Method `registerQueues`
- Description: Dynamically registers queues based on the provided configurations. It checks if the queues configuration is a string or an array and processes accordingly.

---
This class effectively handles the setup and registration of SQS queues and associated Lambda functions based on the provided configurations.
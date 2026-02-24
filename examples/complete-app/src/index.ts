import {
    Application,
    APIConstruct,
    DynamoDBConstruct,
    BucketConstruct,
    SchedulerConstruct,
    QueueConstruct,
    AuthConstruct,
    LambdaFunction,
    registerEntitySchema
} from '@ten24group/fw24';
import { AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { ProductEntity } from './entities/product';

// 0. Initialize DI before anything else
import './di';

const app = new Application({
    name: 'complete-showcase',
    region: 'us-east-1',
    environment: 'local',
    environmentVariables: {
        'CUSTOM_APP_SETTING': 'Hello-from-Config'
    }
});

// Register Entity
registerEntitySchema({
    forEntity: 'product',
    useValue: ProductEntity,
    providedIn: 'ROOT'
});

// 1. Auth (Cognito)
app.use(new AuthConstruct({
    groups: [
        {
            name: 'admin',
            routes: ['products/*']
        }
    ]
}));

// 2. Storage
app.use(new BucketConstruct([
    {
        bucketName: 'assets-bucket'
    }
]));

// 3. Database
app.use(new DynamoDBConstruct({
    table: {
        name: 'store-table',
        props: {
            partitionKey: { name: 'pk', type: AttributeType.STRING },
            sortKey: { name: 'sk', type: AttributeType.STRING }
        }
    }
}));

// 4. Queue (Background Processing)
app.use(new QueueConstruct({
    queuesDirectory: __dirname + '/queues'
}));

// 5. API
app.use(new APIConstruct({
    controllersDirectory: __dirname + '/controllers',
    cors: true
}));

// 6. Tasks (Scheduled)
app.use(new SchedulerConstruct({
    tasksDirectory: __dirname + '/tasks'
}));

// 7. Custom Function (demonstrating pure Lambda)
app.mainStack = app.fw24.getStack();
new LambdaFunction(app.mainStack, 'custom-logic', {
    entry: __dirname + '/handlers/custom.ts'
});

// Simulation logic
if (process.env.SIMULATE === 'true') {
    app.simulate({
        port: 3000,
        hotReload: true
    });
} else {
    app.run();
}

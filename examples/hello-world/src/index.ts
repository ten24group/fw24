import { Application, APIConstruct, DynamoDBConstruct } from '@ten24group/fw24';
import { AttributeType } from 'aws-cdk-lib/aws-dynamodb';

const app = new Application({
    name: 'hello-world-app',
    region: 'us-east-1',
    environment: 'local'
});

// Add a DynamoDB table
app.use(new DynamoDBConstruct({
    table: {
        name: 'users',
        props: {
            partitionKey: { name: 'id', type: AttributeType.STRING }
        }
    }
}));

// Add the API
app.use(new APIConstruct({
    controllersDirectory: __dirname + '/controllers'
}));

// Simulation logic
if (process.env.SIMULATE === 'true') {
    app.simulate({
        port: 3000,
        hotReload: true
    }).then(() => {
        console.log("🚀 Simulator is running at http://localhost:3000");
    });
} else {
    app.run();
}

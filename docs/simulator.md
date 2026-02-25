# FW24 Simulator

The FW24 Simulator provides a high-fidelity local development environment that treats your AWS CDK deployment plan as the single source of truth. Unlike other simulators that require manual resource mocking, the FW24 Simulator parses your synthesized CloudFormation templates to understand exactly how your application is structured.

## Philosophy: CDK-First

The simulator follows a "CDK-First" approach:
1. **Blueprints**: It reads `cdk.out` to discover Lambdas, API routes, DynamoDB tables, SQS queues, and SNS topics.
2. **Parity**: It executes the exact same bundled code that would be deployed to AWS.
3. **Redirection**: It automatically redirects AWS SDK calls to local sidecar containers (DynamoDB Local, Minio, etc.) based on the blueprint.

## Quick Start

To start the simulator, call the `simulate()` method on your `Application` instance:

```typescript
import { Application } from '@ten24group/fw24';

const app = new Application({
  name: 'my-app',
  region: 'us-east-1'
});

// ... register constructs and modules ...

if (process.env.NODE_ENV === 'development') {
  app.simulate({
    port: 3000,
    hotReload: true
  });
} else {
  app.run();
}
```

## Features

### Unified Local Gateway
All your API Gateways are hosted on a single local port. The simulator automatically handles:
- Path parameter resolution (e.g., `/users/{id}`).
- Cognito JWT claim simulation via the `Authorization` header.
- IAM SigV4 header detection for protected routes.

### Isolated Lambda Execution
Each Lambda invocation runs in a dedicated Node.js `worker_thread`. This provides:
- **Clean State**: Each request starts with a fresh environment (optional cache clearing).
- **Fast Feedback**: Code changes are reflected instantly via Hot Module Replacement (HMR).
- **Debugger Support**: Local execution allows you to attach your IDE's debugger to the simulator process.

### Autonomous Sidecars
The simulator manages Docker-based emulators for persistent services:
- **DynamoDB**: Uses `amazon/dynamodb-local`. Tables are automatically created based on your CDK schema.
- **S3**: Uses Minio. Buckets are auto-provisioned.
- **SQS**: Uses ElasticMQ.
- **MeiliSearch**: For smart query routing simulation.

### Event Bridging
- **SNS**: Simulates fan-out to local SQS or Lambda targets based on subscriptions.
- **EventBridge**: Emulates scheduled tasks (cron) using `node-cron`.
- **SES**: Captures outgoing emails and logs them to the console.

## Configuration Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `port` | `number` | `3000` | The port for the API Gateway emulator. |
| `hotReload` | `boolean` | `true` | Enables automatic re-synthesis on source changes. |
| `persistent` | `boolean` | `false` | (Future) Whether to preserve data in sidecars across restarts. |
| `snsPort` | `number` | `4566` | Port for the mock SNS/SES endpoint. |

## Requirements
- **Docker**: Must be running to host sidecar containers.
- **CDK**: The `aws-cdk` CLI must be installed to support `cdk synth`.
- **ts-node**: Required for executing TypeScript handlers locally.

# FW24 Simulator

The FW24 Simulator provides a high-fidelity local development environment that treats your AWS CDK deployment plan as the single source of truth. Unlike other simulators that require manual resource mocking, the FW24 Simulator parses your synthesized CloudFormation templates to understand exactly how your application is structured.

## Philosophy: CDK-First

The simulator follows a **"CDK-First"** approach:
1.  **Blueprints**: It reads `cdk.out` (after running `cdk synth`) to discover Lambdas, API routes, DynamoDB tables, SQS queues, and S3 buckets.
2.  **Parity**: It executes the exact same bundled code that would be deployed to AWS, ensuring that what you see locally is what you get in production.
3.  **Redirection**: It automatically redirects AWS SDK calls to local sidecar containers (DynamoDB Local, Minio, etc.) without any code changes.

## Quick Start

To start the simulator, call the `simulate()` method on your `Application` instance. It is recommended to gate this behind an environment variable like `SIMULATE=true`.

```typescript
import { Application } from '@ten24group/fw24';

const app = new Application({
  name: 'my-app',
  region: 'us-east-1'
});

// ... register constructs and modules ...

if (process.env.SIMULATE === 'true') {
  app.simulate({
    port: 3000,
    hotReload: true
  });
} else {
  app.run();
}
```

Then run your app with the simulate flag:
```bash
SIMULATE=true npx ts-node src/index.ts
```

## Features

### 🏢 Unified Local Gateway
All your API Gateways are hosted on a single local port (default: 3000).
- **Automatic Routing**: Maps HTTP paths and methods to the correct Lambda handlers.
- **Path Parameters**: Full support for parameterized routes like `/users/{userId}`.
- **Auth Simulation**:
    - **Cognito**: Simulates JWT claims from the `Authorization` header.
    - **IAM**: Detects SigV4-like headers and provides a mock IAM user context.

### 🧪 Best-in-Class Sidecars
The simulator orchestrates industry-standard local emulators using Docker:
- **DynamoDB**: Official `amazon/dynamodb-local`. Tables are auto-created based on your schema.
- **S3**: `minio/minio` (High fidelity S3 API). Buckets are auto-provisioned.
- **SQS**: `softwaremill/elasticmq-native`. Queues are auto-created.
- **Cognito**: `jagregory/cognito-local`.
- **MeiliSearch**: For smart query routing simulation.

### 🛡️ Isolated Lambda Execution
Each Lambda invocation runs in a dedicated Node.js `worker_thread`.
- **Environment Fidelity**: Each worker is injected with the exact environment variables parsed from the CDK template.
- **Deep Sanitization**: Complex DI-injected objects are safely passed between threads.
- **HMR Support**: Code changes trigger an automatic `cdk synth`, and the simulator hot-swaps the underlying bundles instantly.
- **Node Paths**: Lambda layers are automatically resolved and added to the local `NODE_PATH`.

### 🌉 Event Bridges
- **SNS**: Simulates fan-out to local SQS or Lambda targets.
- **EventBridge**: Emulates scheduled tasks (cron) using `node-cron`.
- **SES**: Captures outgoing emails and logs them to the console for inspection.

## Configuration Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `port` | `number` | `3000` | The port for the API Gateway emulator. |
| `hotReload` | `boolean` | `true` | Enables automatic re-synthesis on source changes. |
| `snsPort` | `number` | `4566` | Port for the mock SNS/SES endpoint. |

## Requirements
- **Docker**: Must be running to host sidecar containers.
- **CDK**: The `aws-cdk` CLI must be installed to support `cdk synth`.
- **ts-node**: Required for executing your application entry point.

## Showcase Application
Check out `examples/complete-app` for a full demonstration of:
- **ElectroDB Entities** with CRUD.
- **DI-driven Services** and Controllers.
- **S3 File Management** via Minio.
- **Background SQS Jobs**.
- **Scheduled Tasks**.

# FW24 Evolution Roadmap

This roadmap outlines the technical evolution of FW24 towards an "Intelligent Framework" that eliminates boilerplate and maximizes security through build-time intelligence.

## 🧠 Core Architecture: The Build-Time DI Explorer
The cornerstone of FW24's future is shifting dependency resolution and infrastructure discovery from "Runtime-only" to "Build-Time + Runtime."

### 1. Intelligent Build-Time Resolution
- **Dry-Run Resolution**: During `cdk synth`, FW24 will perform a mocked resolution of the DI container.
- **Dynamic Resource Discovery**: Automatically identify AWS resources (DynamoDB Tables, S3 Buckets, SQS Queues) referenced by services.
- **Auto-IAM Provisioning**: Automatically attach the required IAM policies to Lambdas based on the discovered resource requirements.

### 2. Spring-Boot Inspired Configuration
- **`@ConfigurationProperties(prefix)`**: Bind configuration paths to class properties with type safety.
- **`@Value(path)`**: Declarative shorthand for property injection.
- **Build-Time Validation**: Fail the build if required configuration is missing from `.env` or global config.
- **Env-Var Tree Shaking**: Inject only the environment variables that are actually reachable in a Lambda's dependency graph.

## 🚀 Priority Phases

### Phase 1: Boilerplate Reduction & "Zero-Config"
- Implement the `BuildTimeDIExplorer`.
- Introduce `@Value` and `@ConfigurationProperties`.
- Automate DynamoDB table access discovery.
- Implement Environment Variable "Tree Shaking."

### Phase 2: High-Fidelity Local Simulator
- **CDK-Driven Simulation**: Parse `cdk.out` to spin up a local environment that perfectly matches the deployment plan.
- **JS-Based Mocks**: Fast, lightweight local mocks for AWS services.
- **Unified CLI**: `fw24 dev` to start the entire distributed monolith locally.

### Phase 3: Optimized Distribution
- **Deployment Units**: Group/Split logical modules into physical Lambdas without code changes.
- **Tree-Shaken Bundling**: Prune unreachable code from the DI graph during the build process.

## 🛡️ Philosophy
- **Monolith DX, Micro-service Runtime**: Clean code, complex deployment handled by the framework.
- **Convention over Configuration**: Smart assumptions that can be refined with decorators.
- **Least-Privilege by Design**: Secure infrastructure is a byproduct of the dependency graph.

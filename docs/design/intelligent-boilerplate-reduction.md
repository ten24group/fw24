# Design Document: Intelligent Boilerplate Reduction in FW24

## 1. Overview
FW24 currently requires developers to manually wire infrastructure resources (DynamoDB tables, S3 buckets, etc.) to the Lambda functions that use them. This involves:
1. Registering the resource with `Fw24` (build-time).
2. Listing the resource in the `@Controller` or `LambdaFunction` `resourceAccess` property (build-time).
3. Injecting the resource name/ARN into the Service/Controller via DI (runtime).

This document proposes an **Intelligent Discovery Engine** that leverages the metadata-driven DI system to automatically discover these dependencies and perform the necessary wiring (IAM grants and environment variable injection) without manual configuration.

## 2. Core Concepts

### 2.1 Infrastructure-Aware DI
CDK constructs (like `TableV2`, `Bucket`, `Queue`) will be registered in the `DIContainer.ROOT` during CDK synthesis as special `infra` providers.

### 2.2 Build-Time DI Explorer
A new utility will "trace" the dependency graph of a Lambda's entry point (Controller or Handler) during `cdk synth`. It will recursively inspect the class metadata to find all injected dependencies.

### 2.3 Automatic IAM & Environment Injection
If a dependency resolves to an `infra` provider, the `LambdaFunction` construct will automatically:
1. Call the appropriate `grant*` method on the CDK resource.
2. Inject the resource's physical identifier (name or ARN) into the Lambda's environment variables.

## 3. Detailed Design

### 3.1 Marking Infra Providers
We will extend `ProviderOptions` to include an `isInfra` flag and an `infraResource` reference.

```typescript
export interface ProviderOptions<T = any> {
    provide: Token;
    useValue?: T;
    // ...
    isInfra?: boolean;
    infraResource?: any; // The CDK Construct instance
}
```

### 3.2 Construct Registration
Framework constructs (e.g., `DynamoDBConstruct`) will automatically register their physical resources in the `ROOT` container.

```typescript
// src/constructs/dynamodb.ts
const table = new TableV2(this, ...);
DIContainer.ROOT.register({
    provide: 'UserTable',
    useValue: table,
    type: 'infra',
    isInfra: true
});
```

### 3.3 The Dependency Tracer
A recursive function that traverses the metadata collected by `@Inject()` and `@Injectable()`.

```typescript
class DIExplorer {
    static traceInfraDependencies(target: ClassConstructor): InfraDependency[] {
        // 1. Get constructor and property deps from MetadataManager
        // 2. Resolve them in DIContainer.ROOT
        // 3. If resolved provider.isInfra, add to list
        // 4. Recursively trace dependencies of non-infra providers
    }
}
```

### 3.4 Lambda Integration
`LambdaFunction` will call the tracer and apply the findings.

```typescript
// src/constructs/lambda-function.ts
const deps = DIExplorer.traceInfraDependencies(props.handlerClass);
deps.forEach(dep => {
    if (dep.resource instanceof TableV2) {
        dep.resource.grantReadWriteData(fn);
        fn.addEnvironment(dep.token, dep.resource.tableName);
    }
    // ... other resource types
});
```

## 4. Spring-Inspired Enhancements

### 4.1 `@Value` Decorator
Allows injecting configuration properties directly into services with build-time validation.

```typescript
class MyService {
    @Value('app.payments.apiKey')
    private apiKey: string;
}
```

### 4.2 `@ConfigurationProperties`
Binds a configuration prefix to a class.

```typescript
@ConfigurationProperties('app.payments')
class PaymentConfig {
    apiKey: string;
    endpoint: string;
}
```

## 5. Implementation Plan
1. Update `DIContainer` and `MetadataManager` to support `infra` providers.
2. Modify `DynamoDBConstruct` (and others) to auto-register resources.
3. Implement `DIExplorer` utility.
4. Integrate `DIExplorer` into `LambdaFunction`.
5. Implement `@Value` and `@ConfigurationProperties` decorators.

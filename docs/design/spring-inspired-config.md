# Design Document: Spring-Inspired Configuration in FW24

## 1. Overview
FW24 currently uses a manual `resolveConfig` or `resolveEnvValueFor` approach to access configuration. While flexible, it lacks type safety at the property level and requires repetitive code.

Inspired by Spring Boot, this design introduces `@Value` and `@ConfigurationProperties` to make configuration injection declarative, type-safe, and validated at build-time.

## 2. `@Value` Decorator

### 2.1 Usage
```typescript
@Injectable()
export class NotificationService {
  @Value('notification.retryCount', 3) // key, default value
  private retryLimit: number;

  @Value('notification.senderEmail')
  private sender: string;
}
```

### 2.2 Mechanism
1. **Metadata Registration**: The decorator registers the property with a special `isConfig` flag in the `PROPERTY_DEPENDENCY` metadata.
2. **Build-Time Validation**: During `cdk synth`, the `DIExplorer` traces these `@Value` injections and verifies that the keys exist in the `DIContainer`'s config providers.
3. **Runtime Injection**: The `DIContainer.resolve` method detects the `isConfig` flag and uses `resolveConfig(token)` to populate the property.

## 3. `@ConfigurationProperties` Decorator

### 3.1 Usage
```typescript
@ConfigurationProperties('app.mail')
export class MailConfig {
  host: string;
  port: number;
  secure: boolean = true;
}

@Injectable()
export class Mailer {
  constructor(private config: MailConfig) {}
}
```

### 3.2 Mechanism
1. **Metadata Registration**: The `@ConfigurationProperties(prefix)` decorator marks the class.
2. **Provider Generation**: The framework automatically registers a factory provider for this class that:
    - Resolves the configuration at `prefix`.
    - Instantiates the class.
    - Maps the config object to the class properties.
3. **Build-Time Validation**: Validates that the config object at `prefix` contains all required properties (those without defaults).

## 4. Technical Implementation

### 4.1 Decorator Definitions
```typescript
export function Value(token: string, defaultValue?: any) {
  return function(target: any, propertyKey: string | symbol) {
    registerPropertyDependency(target.constructor, propertyKey, token, {
        isConfig: true,
        defaultValue
    });
  };
}

export function ConfigurationProperties(prefix: string) {
  return function(target: Function) {
    registerModuleMetadata(target, {
       providers: [{
          provide: target,
          useFactory: (container: IDIContainer) => {
              const config = container.resolveConfig(prefix);
              return Object.assign(new (target as any)(), config);
          }
       }]
    });
  };
}
```

## 5. Benefits
- **Fail-Fast**: Missing configuration is caught during `cdk synth`, preventing runtime Lambda errors.
- **Type Safety**: Developers interact with typed objects rather than string-keyed maps.
- **Readability**: Dependencies and configurations are clearly declared at the top of the class.

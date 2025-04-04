# FW24 Bootstrap

The bootstrap module provides a simple way to initialize your application's dependency injection container. This is especially useful for serverless applications where you need to ensure that your DI container is properly initialized before your Lambda functions execute.

## Basic Usage

Create a bootstrap file (e.g., `bootstrap.ts` or `di.ts`) in your application:

```typescript
import { bootstrap, DIModule } from '@ten24group/fw24';

// Create your application module
@DIModule()
export class AppModule {}

// Bootstrap your application
export const AppDIContainer = bootstrap({
  // Register AppModule as the root module
  rootModule: AppModule,
  
  // Configure the container
  initialize: (container) => { // container is the root-container
    // Register global dependencies
    container.register({
      provide: 'ConfigService',
      useValue: {
        apiKey: process.env.API_KEY,
        environment: process.env.NODE_ENV
      }
    });
    
    // Import other modules if needed
    container.module(AuthModule);
  }
});

```

## API Reference

### `bootstrap(config: BootstrapConfig): DIContainer`

Initializes the application's DI container. If the container has already been initialized, it returns the existing container.

- **Parameters:**
  - `config: BootstrapConfig` - Configuration for bootstrapping
    - `rootModule?: any` - The root module for your application
    - `initialize?: (container: DIContainer) => void` - Function to configure the container

- **Returns:** The initialized DIContainer

### `getContainer(): DIContainer`

Gets the bootstrapped container. If the container hasn't been initialized yet, it initializes it with default settings.

- **Returns:** The bootstrapped DIContainer

### `createBootstrapModule(config: BootstrapConfig): any`

Creates a bootstrap module and initializes the container with it.

- **Parameters:**
  - `config: BootstrapConfig` - Same as bootstrap()

- **Returns:** The created bootstrap module class

### `resetBootstrap(): void`

Resets the bootstrap state. Mainly used for testing.

## Integration with Lambda Functions

The framework automatically ensures that your bootstrap file is imported when Lambda functions are bundled. This means you don't need to manually import your bootstrap file in each Lambda function.

## Example Controller

```typescript
import { Controller, Get } from '@ten24group/fw24';
import { AppModule } from '../bootstrap';

@Controller('user', {
  module: { providedBy: AppModule }
})
export class UserController {
  constructor(
    @InjectEntityService('user') 
    private userService: UserService
  ) {}
  
  @Get('/users')
  async getUsers() {
    return this.userService.getAll();
  }
}
```

The controller will automatically use the bootstrapped container, so you don't need to worry about initialization.

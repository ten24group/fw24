# Stack Management in FW24

FW24 provides basic stack management capabilities through the Application configuration.

## Stack Configuration

When initializing your application, you can configure stack behavior through the `IApplicationConfig`:

```typescript
const app = new Application({
    // Default stack name for resources if not specified elsewhere
    defaultStackName: 'MyAppStack',
    
    // Stack name for Lambda layers
    layerStackName: 'LayerStack',
    
    // Enable multi-stack support
    multiStack: true
});
```

### Configuration Options

1. **defaultStackName**
   - Optional string that sets the default stack name for your application
   - Used when resources don't specify their own stack name
   - If not provided, a default name will be generated

2. **layerStackName**
   - Optional string that specifies the stack name for Lambda layers
   - Allows separation of layer resources into their own stack
   - Useful for managing layer versions independently

3. **multiStack**
   - Optional boolean flag to enable multi-stack support
   - When true, allows resources to be deployed across multiple stacks
   - When false or undefined, all resources deploy to the default stack

## Usage Examples

### Single Stack Configuration

```typescript
const app = new Application({
    defaultStackName: 'ProductionStack'
});

// All resources will be created in 'ProductionStack'
```

### Multi-Stack Configuration

```typescript
const app = new Application({
    defaultStackName: 'MainStack',
    layerStackName: 'SharedLayersStack',
    multiStack: true
});

// Resources can now be distributed across different stacks
```

### Stack-Specific Resource Configuration

When using constructs, you can specify which stack they belong to:

```typescript
const dynamoDBConfig: IDynamoDBConfig = {
    stackName: 'DatabaseStack',  // This resource will be created in DatabaseStack
    table: {
        name: 'myTable',
        props: {
            partitionKey: { name: 'id', type: 'STRING' }
        }
    }
};
```

## Best Practices

1. **Stack Organization**:
   - Use meaningful stack names that reflect their purpose
   - Consider separating layers into their own stack for better versioning
   - Use multi-stack support for complex applications

2. **Resource Management**:
   - Group related resources in the same stack
   - Use the default stack for simple applications
   - Consider deployment and maintenance implications when splitting resources

3. **Stack Names**:
   - Use consistent naming conventions
   - Include environment or stage information in stack names
   - Avoid special characters in stack names 
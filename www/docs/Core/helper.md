# Helper

The `Helper` class contains a static method `hydrateConfig` used to populate a configuration object with environment variables based on a specified prefix.

## Methods

### hydrateConfig

```typescript
static hydrateConfig<T>(config: T, prefix = "APP")
```

The `hydrateConfig` method takes two parameters:
- `config` (generic type `T`): The configuration object to populate with environment variables.
- `prefix` (string, default "APP"): The prefix used to filter out relevant environment variables.

#### Parameters
- `config`: The configuration object to update.
- `prefix`: The prefix used to filter out relevant environment variables.

#### Description

The `hydrateConfig` method iterates through all keys in the `process.env` object, filters out keys that start with the specified `prefix`, and updates the configuration object with the corresponding values if the key does not already exist in the configuration.

For each matching key:
1. The `prefix` is stripped from the key, and the remaining string is converted to lowercase.
2. Any underscores followed by a letter are replaced with the uppercase version of that letter.
3. If the configuration object does not already have a property with the modified key, the value from the environment variable is added to the configuration.

#### Example

```typescript
const myConfig = {};
Helper.hydrateConfig(myConfig, 'PREFIX');
```

In this example, `myConfig` is an empty object that will be populated with environment variables that start with `'PREFIX'`. The keys will be transformed based on the specified rules before being added to `myConfig`.
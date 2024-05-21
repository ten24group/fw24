
# LayerConstruct

## Introduction

`LayerConstruct` is a key component of the FW24 toolkit, designed to facilitate the creation and management of AWS Lambda Layers in your applications.

Lambda Layers are a distribution mechanism for libraries, custom runtimes, and other function dependencies. They promote code sharing and separation of responsibilities so that you can manage your code in a more modular way.

With `LayerConstruct`, you can define a Lambda Layer with its properties. The configuration involves setting up `layerName`, `layerDirectory`, and `layerProps`:

- `layerName`: This is the name of the Lambda Layer. It's a unique identifier for your layer.
- `layerDirectory`: This is the directory path where the layer's code resides. It's where AWS Lambda expects to find your layer code.
- `layerProps`: These are additional properties for the Lambda Layer, such as `compatibleRuntimes` and `compatibleArchitectures`. These properties allow you to specify the runtime that your layer is compatible with and the architectures that your layer supports.

`LayerConstruct` provides a streamlined way to manage Lambda Layers, making it easier to share code and resources across multiple AWS Lambda functions. Whether you're sharing custom libraries, managing dependencies, or sharing data across multiple functions, `LayerConstruct` simplifies the task of managing Lambda Layers in AWS. It's an invaluable tool that not only streamlines code sharing but also enhances the overall efficiency and responsiveness of your application.

## Getting Started

This guide will walk you through the process of importing, configuring, and using `LayerConstruct` in your project.

### Step 1: Importing

First things first, let's bring `LayerConstruct` into your project. You can do this by importing it from the FW24 package as shown below:

```ts
import { LayerConstruct } from '@ten24group/fw24';
```

### Step 2: Configuration

Now that `LayerConstruct` is part of your project, it's time to configure it to suit your needs. The configuration involves setting up `layerName`, `layerDirectory`, and `layerProps`:

```ts
  var lambdaLayer = new `LayerConstruct`({
    layerName: 'my-layer',
    layerDirectory: '/path/to/layer',
    layerProps: {
      compatibleRuntimes: [Runtime.NODEJS_14_X],
      compatibleArchitectures: [Architecture.ARM_64],
    },
  });
```

In this configuration:

- `layerName` sets the name of the Lambda Layer.
- `layerDirectory` sets the directory path where the layer's code resides.
- `layerProps` sets the properties for the Lambda Layer, such as - `compatibleRuntimes` and `compatibleArchitectures`.

Feel free to adjust these settings to match your application's requirements.

### Step 3: Usages

With `LayerConstruct` configured, it's time to put it to work. Here's how you can incorporate it into your application:

```ts
  app.use(lambdaLayer).run();
```

This will add the configured Lambda Layer to your application. You can now share code and resources across multiple AWS Lambda functions using the `LayerConstruct`.

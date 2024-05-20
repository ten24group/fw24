---
sidebar_position: 2
---

# Getting Started

Welcome to the `LayerConstruct` guide! `LayerConstruct` is a powerful tool from the FW24 package that simplifies the process of setting up and managing AWS Lambda Layers in your application. This guide will walk you through the process of importing, configuring, and using `LayerConstruct` in your project.

## Step 1: Importing

First things first, let's bring `LayerConstruct` into your project. You can do this by importing it from the FW24 package as shown below:

```ts
import { LayerConstruct } from '@ten24group/fw24';
```

## Step 2: Configuration

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

## Step 3: Usages

With `LayerConstruct` configured, it's time to put it to work. Here's how you can incorporate it into your application:

```ts
  app.use(lambdaLayer).run();
```

This will add the configured Lambda Layer to your application. You can now share code and resources across multiple AWS Lambda functions using the `LayerConstruct`.

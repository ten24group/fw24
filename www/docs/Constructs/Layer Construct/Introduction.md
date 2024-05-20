---
sidebar_position: 1
---

# Introduction

`LayerConstruct` is a key component of the FW24 toolkit, designed to facilitate the creation and management of AWS Lambda Layers in your applications.

Lambda Layers are a distribution mechanism for libraries, custom runtimes, and other function dependencies. They promote code sharing and separation of responsibilities so that you can manage your code in a more modular way.

With `LayerConstruct`, you can define a Lambda Layer with its properties. The configuration involves setting up `layerName`, `layerDirectory`, and `layerProps`:

- `layerName`: This is the name of the Lambda Layer. It's a unique identifier for your layer.
- `layerDirectory`: This is the directory path where the layer's code resides. It's where AWS Lambda expects to find your layer code.
- `layerProps`: These are additional properties for the Lambda Layer, such as `compatibleRuntimes` and `compatibleArchitectures`. These properties allow you to specify the runtime that your layer is compatible with and the architectures that your layer supports.

`LayerConstruct` provides a streamlined way to manage Lambda Layers, making it easier to share code and resources across multiple AWS Lambda functions. Whether you're sharing custom libraries, managing dependencies, or sharing data across multiple functions, `LayerConstruct` simplifies the task of managing Lambda Layers in AWS. It's an invaluable tool that not only streamlines code sharing but also enhances the overall efficiency and responsiveness of your application.

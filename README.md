# Framework24 Core Layer

This is a AWS Lambda Layer that contains the core functionality for Framework24.  It is shared across all Framework24 projects.

## Build Layer

Use esbuild to compile the JavaScript files for the Layer, deploy the Layer with CDK

```shell
npm run layer:deploy -- --profile=<YOUR PROFILE>
```

## Build Package

Use `tsc` to create the files for the package when using `npm install`

```shell
npm build
```

Install the package using:

```shell
npm i git+ssh://git@github.com:ten24group/fw24-core
```



Reference: [Creating Lambda Layers with TypeScript and CDK - The Right Way](https://www.shawntorsitano.com/2022/06/19/creating-lambda-layers-with-typescript-and-cdk-the-right-way/)
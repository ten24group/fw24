# Framework24 Core



## Build Layer

Use esbuild to compile the JavaScript files for the Layer, deploy the Layer with CDK

```shell
npm run layer:deploy -- --profile=<YOUR PROFILE>
```

## Build Package

Use `tsc` to create the files for the package when using `npm install`

```shell
npm run fw24:build
```

Install the package using:

```shell
npm i @ten24group/fw24
```



Reference: [Creating Lambda Layers with TypeScript and CDK - The Right Way](https://www.shawntorsitano.com/2022/06/19/creating-lambda-layers-with-typescript-and-cdk-the-right-way/)
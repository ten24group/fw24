# Framework24 Core



## Build Layer & Deploy

Use esbuild to compile the JavaScript files for the Layer, deploy the Layer with CDK

```shell
npm run release:layer -- --profile=<YOUR PROFILE>
```

## Use Framework24

Install the package using:

```shell
npm i @ten24group/fw24
```


## Build Package for development

Use `tsc` to create the files for the package when using `npm install`

```shell
npm run build:fw24
```



Reference: [Creating Lambda Layers with TypeScript and CDK - The Right Way](https://www.shawntorsitano.com/2022/06/19/creating-lambda-layers-with-typescript-and-cdk-the-right-way/)
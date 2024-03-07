import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

import { IApplicationConfig } from "../interfaces/config";

export interface IDynamoConfig {
    table: IDynamoTableConfig;
}

export interface IDynamoTableConfig {
    name: string;
    props: dynamodb.TablePropsV2;
}

export class DynamoStack {
    constructor(private config: IDynamoConfig) {
        console.log("DynamoDBTable");
    }

    public construct(appConfig: IApplicationConfig) {
        console.log("DynamoDB construct", appConfig);

        const mainStack = Reflect.get(globalThis, "mainStack");
        const appQualifiedTableName = `${this.config.table.name}_table`;

        console.log("🚀 ~ DynamoStack ~ construct ~ appQualifiedTableName:", appQualifiedTableName);
        // new dynamodb.Table(mainStack, this.config.table.name, {});

        // See https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_dynamodb-readme.html
        const tableInstance = new dynamodb.TableV2(mainStack, appQualifiedTableName, this.config.table.props);

        // Register the table instance as a global container
        Reflect.set(globalThis, appQualifiedTableName, tableInstance);
    }
}

import { TablePropsV2, TableV2 } from "aws-cdk-lib/aws-dynamodb";

import { IStack } from "../interfaces/stack";
import { Fw24 } from "../core/fw24";

export interface IDynamoConfig {
    table: {
        name: string;
        props: TablePropsV2;
    }
}

export class DynamoDBStack implements IStack {

    // default contructor to initialize the stack configuration
    constructor(private stackConfig: IDynamoConfig) {
        console.log("DynamoDBTable");
    }

    // construct method to create the stack
    public construct() {
        console.log("DynamoDB construct");
        
        const fw24 = Fw24.getInstance();
        const mainStack = fw24.getStack("main");
        const appQualifiedTableName = `${this.stackConfig.table.name}_table`;

        console.log("🚀 ~ DynamoStack ~ construct ~ appQualifiedTableName:", appQualifiedTableName);
        // new dynamodb.Table(mainStack, this.config.table.name, {});

        // See https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_dynamodb-readme.html
        const tableInstance = new TableV2(mainStack, appQualifiedTableName, this.stackConfig.table.props);

        // Register the table instance as a global container
        fw24.addDynamoTable(this.stackConfig.table.name, tableInstance);
    }
}

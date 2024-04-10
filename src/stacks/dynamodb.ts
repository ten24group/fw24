import { TablePropsV2, TableV2 } from "aws-cdk-lib/aws-dynamodb";

import { IStack } from "../interfaces/stack";
import { Fw24 } from "../core/fw24";
import { createLogger, Duration as LogDuration } from "../logging";

export interface IDynamoConfig {
    table: {
        name: string;
        props: TablePropsV2;
    }
}

export class DynamoDBStack implements IStack {
    readonly logger = createLogger(DynamoDBStack.name);
    readonly fw24: Fw24 = Fw24.getInstance();
    
    dependencies: string[] = [];

    // default constructor to initialize the stack configuration
    constructor(private stackConfig: IDynamoConfig) {
        this.logger.debug("DynamoDBTable");
    }

    // construct method to create the stack
    @LogDuration()
    public async construct() {
        this.logger.debug("DynamoDB");
        
        const fw24 = Fw24.getInstance();
        const mainStack = fw24.getStack("main");
        const appQualifiedTableName = `${this.stackConfig.table.name}_table`;

        this.logger.debug("appQualifiedTableName:", appQualifiedTableName);
        // new dynamodb.Table(mainStack, this.config.table.name, {});

        // See https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_dynamodb-readme.html
        const tableInstance = new TableV2(mainStack, appQualifiedTableName, this.stackConfig.table.props);

        // Register the table instance as a global container
        fw24.addDynamoTable(this.stackConfig.table.name, tableInstance);
    }
}

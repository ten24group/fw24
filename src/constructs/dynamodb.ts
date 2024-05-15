import { TablePropsV2, TableV2 } from "aws-cdk-lib/aws-dynamodb";

import { FW24Construct, FW24ConstructOutput } from "../interfaces/construct";
import { Fw24 } from "../core/fw24";
import { createLogger, LogDuration } from "../logging";

/**
 * Represents the configuration for a DynamoDB table.
 */
export interface IDynamoDBConfig {
    table: {
        /**
         * The name of the DynamoDB table.
         */
        name: string;
        /**
         * The properties for the DynamoDB table.
         */
        props: TablePropsV2;
    }
}

export class DynamoDBConstruct implements FW24Construct {
    readonly logger = createLogger(DynamoDBConstruct.name);
    readonly fw24: Fw24 = Fw24.getInstance();
    
    name: string = DynamoDBConstruct.name;
    dependencies: string[] = [];
    output!: FW24ConstructOutput;

    // default constructor to initialize the stack configuration
    constructor(private dynamoDBConfig: IDynamoDBConfig) {
    }

    // construct method to create the stack
    @LogDuration()
    public async construct() {        
        const fw24 = Fw24.getInstance();
        const mainStack = fw24.getStack("main");
        const appQualifiedTableName = `${this.dynamoDBConfig.table.name}_table`;

        this.logger.debug("appQualifiedTableName:", appQualifiedTableName);
        // new dynamodb.Table(mainStack, this.config.table.name, {});

        // See https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_dynamodb-readme.html
        const tableInstance = new TableV2(mainStack, appQualifiedTableName, this.dynamoDBConfig.table.props);

        // Register the table instance as a global container
        fw24.addDynamoTable(this.dynamoDBConfig.table.name, tableInstance);
    }
}

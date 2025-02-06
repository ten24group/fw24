import { TablePropsV2, TableV2 } from "aws-cdk-lib/aws-dynamodb";

import { FW24Construct, FW24ConstructOutput } from "../interfaces/construct";
import { Fw24 } from "../core/fw24";
import { createLogger, LogDuration } from "../logging";
import { ensureNoSpecialChars, ensureSuffix } from "../utils/keys";
import { IConstructConfig } from "../interfaces/construct-config";

/**
 * Represents the configuration for a DynamoDB table.
 */
export interface IDynamoDBConfig extends IConstructConfig {
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

/**
 * @param dynamoDBConfig The configuration object for DynamoDB.
 * @example
 * ```ts
 * 
 * const dynamoDBConfig: IDynamoDBConfig = {
 *   table: {
 *     name: 'myTable',
 *     props: {
 *       partitionKey: { name: 'id', type: 'STRING' },
 *       sortKey: { name: 'timestamp', type: 'NUMBER' },
 *       billingMode: 'PAY_PER_REQUEST',
 *       removalPolicy: cdk.RemovalPolicy.DESTROY
 *     }
 *   }
 * };
 * 
 * const dynamoDB = new DynamoDBConstruct(dynamoDBConfig);
 * 
 * app.use(dynamoDB);
 * 
 * ```
 */
export class DynamoDBConstruct implements FW24Construct {
    readonly logger = createLogger(DynamoDBConstruct.name);
    readonly fw24: Fw24 = Fw24.getInstance();
    
    name: string = DynamoDBConstruct.name;
    dependencies: string[] = [];
    output!: FW24ConstructOutput;

    /**
     * Constructs a new instance of the DynamoDB class.
     * @param dynamoDBConfig The configuration object for DynamoDB.
     * @example
     * const dynamoDBConfig = {
     *   region: 'us-west-2',
     *   tableName: 'myTable'
     * };
     * const dynamoDB = new DynamoDB(dynamoDBConfig);
     */
    constructor(private dynamoDBConfig: IDynamoDBConfig) {
    }

    // construct method to create the stack
    @LogDuration()
    public async construct() {        
        const fw24 = Fw24.getInstance();
        const mainStack = fw24.getStack(this.dynamoDBConfig.stackName || "main");
        const appQualifiedTableName = ensureNoSpecialChars(ensureSuffix(this.dynamoDBConfig.table.name, `table`));

        this.logger.debug("appQualifiedTableName:", appQualifiedTableName);

        // See https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_dynamodb-readme.html
        const tableInstance = new TableV2(mainStack, appQualifiedTableName, this.dynamoDBConfig.table.props);

        // Register the table instance as a global container
        fw24.addDynamoTable(appQualifiedTableName, tableInstance);
    }
}

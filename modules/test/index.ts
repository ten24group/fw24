import { AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { AbstractFw24Module, IModuleConfig, IStack } from '../../src/core/module';
import { DynamoStack } from '../../src/fw24';


export class TestModule extends AbstractFw24Module {
    
    protected stacks: Map<string, IStack>; 

    constructor( protected readonly config: IModuleConfig){
        super(config);
        this.stacks = new Map();

        const dynamo = new DynamoStack({
            table: {
                name: 'test_module_table',
                props: {
                    partitionKey: {
                        name: 'pk',
                        type: AttributeType.STRING,
                    },
                    sortKey: {
                        name: 'sk',
                        type: AttributeType.STRING,
                    },
                    globalSecondaryIndexes: [{
                        indexName: 'gsi1',
                        partitionKey: {
                            name: 'gsi1pk',
                            type: AttributeType.STRING,
                        },
                        sortKey: {
                            name: 'gsi1sk',
                            type: AttributeType.STRING,
                        },
                    }, 
                    {
                        indexName: 'gsi2',
                        partitionKey: {
                            name: 'gsi2pk',
                            type: AttributeType.STRING,
                        },
                        sortKey: {
                            name: 'gsi2sk',
                            type: AttributeType.STRING,
                        },
                    }, 
                    {
                        indexName: 'gsi3',
                        partitionKey: {
                            name: 'gsi3pk',
                            type: AttributeType.STRING,
                        },
                        sortKey: {
                            name: 'gsi3sk',
                            type: AttributeType.STRING,
                        },
                    }]
                },
            },
        });

        this.stacks.set('test_module_tbl', dynamo )
    }

    getName(): string {
        return 'TestModule';
    }

    getBasePath(): string {
        return __dirname;
    }
    
    getStacks(): Map<string, IStack> {
        return this.stacks;
    }
}
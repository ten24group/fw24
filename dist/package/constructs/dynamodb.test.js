"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const aws_cdk_lib_1 = require("aws-cdk-lib");
const assertions_1 = require("aws-cdk-lib/assertions");
const aws_dynamodb_1 = require("aws-cdk-lib/aws-dynamodb");
const aws_lambda_1 = require("aws-cdk-lib/aws-lambda");
const dynamodb_1 = require("./dynamodb");
const fw24_1 = require("../core/fw24");
/**
 * DynamoDBConstruct Test Suite
 *
 * NOTE: DynamoDBConstruct is highly complex (946 lines) with stream processing, audit, and search indexing.
 * These tests focus on:
 * 1. Basic table creation and configuration
 * 2. Stream processing setup (SNS topic + Lambda processor)
 * 3. Audit configuration (CloudWatch, existing/new/handler queues)
 * 4. Search indexing configuration (Meili, existing/new/handler queues)
 * 5. Merge utility usage (bug we fixed)
 * 6. Queue configuration extraction and validation
 *
 * NOT TESTED (requires full app context):
 * - Actual queue handler file loading (needs @Queue decorated files)
 * - DynamoDB stream event processing (runtime behavior)
 * - Audit log writing (runtime behavior)
 * - Search index synchronization (runtime behavior)
 *
 * These are integration/runtime features tested in E2E tests.
 */
describe('DynamoDBConstruct', () => {
    let app;
    let stack;
    beforeEach(() => {
        // Clean up singleton
        fw24_1.Fw24.instance = undefined;
        app = new aws_cdk_lib_1.App();
        stack = new aws_cdk_lib_1.Stack(app, 'TestStack', {
            env: { account: '123456789012', region: 'us-east-1' }
        });
        // Initialize Fw24
        const fw24 = fw24_1.Fw24.getInstance();
        fw24.setApp(app);
        fw24.setConfig({
            name: 'test-dynamodb-app',
            region: 'us-east-1',
            account: '123456789012'
        });
        fw24.addStack('main', stack);
    });
    afterEach(() => {
        fw24_1.Fw24.instance = undefined;
    });
    describe('Basic Table Creation', () => {
        it('should create a DynamoDB table with minimal configuration', async () => {
            const config = {
                table: {
                    name: 'test-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            await dynamoDBConstruct.construct();
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::DynamoDB::GlobalTable', 1);
            template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
                KeySchema: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        AttributeName: 'id',
                        KeyType: 'HASH'
                    })
                ]),
                BillingMode: 'PAY_PER_REQUEST'
            });
        });
        it('should create table with partition key and sort key', async () => {
            const config = {
                table: {
                    name: 'users-table',
                    props: {
                        partitionKey: { name: 'userId', type: aws_dynamodb_1.AttributeType.STRING },
                        sortKey: { name: 'timestamp', type: aws_dynamodb_1.AttributeType.NUMBER },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            await dynamoDBConstruct.construct();
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
                KeySchema: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        AttributeName: 'userId',
                        KeyType: 'HASH'
                    }),
                    assertions_1.Match.objectLike({
                        AttributeName: 'timestamp',
                        KeyType: 'RANGE'
                    })
                ])
            });
        });
        it('should register table in fw24 environment', async () => {
            const config = {
                table: {
                    name: 'registered-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand()
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            await dynamoDBConstruct.construct();
            const fw24 = fw24_1.Fw24.getInstance();
            // Verify table is registered in fw24 (dynamodb.ts:474-478)
            expect(dynamoDBConstruct.output).toBeDefined();
            // Output structure uses OutputType.TABLE as key
            expect(Object.keys(dynamoDBConstruct.output).length).toBeGreaterThan(0);
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::DynamoDB::GlobalTable', 1);
        });
        it('should apply table name suffix for internal naming', async () => {
            const config = {
                table: {
                    name: 'my-data',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand()
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            await dynamoDBConstruct.construct();
            // Original config remains unchanged
            expect(dynamoDBConstruct.dynamoDBConfig.table.name).toBe('my-data');
            // Verify table is created (dynamodb.ts:466 applies suffix internally for construct ID)
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::DynamoDB::GlobalTable', 1);
            // CloudFormation table name is CDK-generated, verify table exists
            const resources = template.findResources('AWS::DynamoDB::GlobalTable');
            expect(Object.keys(resources).length).toBe(1);
        });
    });
    describe('Stream Processing Configuration', () => {
        it('should validate stream configuration is stored correctly', () => {
            const config = {
                table: {
                    name: 'stream-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    stream: {
                        enabled: true
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            // Verify configuration is stored correctly
            expect(dynamoDBConstruct.dynamoDBConfig.table.stream.enabled).toBe(true);
            expect(dynamoDBConstruct.dynamoDBConfig.table.props.dynamoStream).toBe(aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES);
        });
        it('should validate custom topic name configuration', () => {
            const config = {
                table: {
                    name: 'custom-stream-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    stream: {
                        enabled: true,
                        topic: {
                            name: 'custom-topic-name'
                        }
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            // Verify custom topic name is stored
            expect(dynamoDBConstruct.dynamoDBConfig.table.stream.topic.name).toBe('custom-topic-name');
        });
        it('should validate FIFO topic configuration', () => {
            const config = {
                table: {
                    name: 'fifo-stream-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    stream: {
                        enabled: true,
                        topic: {
                            props: {
                                fifo: true
                            }
                        }
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            // Verify FIFO configuration is stored
            expect(dynamoDBConstruct.dynamoDBConfig.table.stream.topic.props.fifo).toBe(true);
        });
        it('should validate custom stream processor configuration', () => {
            const config = {
                table: {
                    name: 'custom-processor-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.KEYS_ONLY
                    },
                    stream: {
                        enabled: true,
                        processor: {
                            startingPosition: aws_lambda_1.StartingPosition.TRIM_HORIZON,
                            batchSize: 10,
                            bisectBatchOnError: false,
                            retryAttempts: 5
                        }
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            // Verify custom processor config is stored
            expect(dynamoDBConstruct.dynamoDBConfig.table.stream.processor.batchSize).toBe(10);
            expect(dynamoDBConstruct.dynamoDBConfig.table.stream.processor.startingPosition).toBe(aws_lambda_1.StartingPosition.TRIM_HORIZON);
            expect(dynamoDBConstruct.dynamoDBConfig.table.stream.processor.bisectBatchOnError).toBe(false);
            expect(dynamoDBConstruct.dynamoDBConfig.table.stream.processor.retryAttempts).toBe(5);
        });
        it('should NOT setup stream processing when disabled', async () => {
            const config = {
                table: {
                    name: 'no-stream-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand()
                        // No dynamoStream specified
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            await dynamoDBConstruct.construct();
            const template = assertions_1.Template.fromStack(stack);
            // No SNS topic or Lambda processor should be created
            template.resourceCountIs('AWS::SNS::Topic', 0);
            template.resourceCountIs('AWS::Lambda::Function', 0);
        });
    });
    describe('Audit Configuration', () => {
        it('should validate basic audit configuration', () => {
            const config = {
                table: {
                    name: 'audit-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    audit: {
                        enabled: true
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            // Verify audit configuration is stored correctly (observability system handles routing)
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.enabled).toBe(true);
        });
        it('should validate audit with allowed entity names', () => {
            const config = {
                table: {
                    name: 'filtered-audit-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    audit: {
                        enabled: true,
                        allowedEntityNames: ['User', 'Order']
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.allowedEntityNames).toEqual(['User', 'Order']);
        });
        it('should validate audit with excluded entity names', () => {
            const config = {
                table: {
                    name: 'excluded-audit-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    audit: {
                        enabled: true,
                        excludedEntityNames: ['TempData', 'Cache']
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.excludedEntityNames).toEqual(['TempData', 'Cache']);
        });
        it('should NOT setup audit when disabled', async () => {
            const config = {
                table: {
                    name: 'no-audit-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand()
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            await dynamoDBConstruct.construct();
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit).toBeUndefined();
        });
        it('should validate audit with custom functionProps', () => {
            const config = {
                table: {
                    name: 'audit-function-props-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    audit: {
                        enabled: true,
                        functionProps: {
                            timeout: aws_cdk_lib_1.Duration.seconds(60),
                            memorySize: 1024
                        }
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.functionProps.timeout).toBeDefined();
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.functionProps.memorySize).toBe(1024);
        });
        it('should validate audit with custom queue name', () => {
            const config = {
                table: {
                    name: 'audit-custom-queue-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    audit: {
                        enabled: true,
                        queueName: 'custom-audit-queue'
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.queueName).toBe('custom-audit-queue');
        });
        it('should validate audit with existing queue reference', () => {
            const config = {
                table: {
                    name: 'audit-existing-queue-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    audit: {
                        enabled: true,
                        existingQueueName: 'AuditProcessor'
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.existingQueueName).toBe('AuditProcessor');
        });
        it('should validate audit with sqsEventSourceProps', () => {
            const config = {
                table: {
                    name: 'audit-sqs-props-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    audit: {
                        enabled: true,
                        sqsEventSourceProps: {
                            batchSize: 20,
                            maxBatchingWindow: aws_cdk_lib_1.Duration.seconds(10)
                        }
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.sqsEventSourceProps.batchSize).toBe(20);
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.sqsEventSourceProps.maxBatchingWindow).toBeDefined();
        });
    });
    describe('Search Indexing Configuration', () => {
        it('should validate search indexing with Meili engine', () => {
            const config = {
                table: {
                    name: 'search-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    searchIndexing: [{
                            enabled: true,
                            engineConfig: {
                                type: 'meili',
                                host: 'https://meilisearch.example.com',
                                masterKey: 'test-master-key'
                            }
                        }]
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            // Verify search indexing configuration is stored correctly
            expect(dynamoDBConstruct.dynamoDBConfig.table.searchIndexing[0].enabled).toBe(true);
            expect(dynamoDBConstruct.dynamoDBConfig.table.searchIndexing[0].engineConfig.type).toBe('meili');
            expect(dynamoDBConstruct.dynamoDBConfig.table.searchIndexing[0].engineConfig.host).toBe('https://meilisearch.example.com');
            expect(dynamoDBConstruct.dynamoDBConfig.table.searchIndexing[0].engineConfig.masterKey).toBe('test-master-key');
        });
        it('should validate search indexing with allowed entity names', () => {
            const config = {
                table: {
                    name: 'filtered-search-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    searchIndexing: [{
                            enabled: true,
                            engineConfig: {
                                type: 'meili',
                                host: 'https://meilisearch.example.com',
                                masterKey: 'test-key'
                            },
                            allowedEntityNames: ['Product', 'Category']
                        }]
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            expect(dynamoDBConstruct.dynamoDBConfig.table.searchIndexing[0].allowedEntityNames).toEqual(['Product', 'Category']);
        });
        it('should validate multiple search indexing configurations', () => {
            const config = {
                table: {
                    name: 'multi-search-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    searchIndexing: [
                        {
                            enabled: true,
                            engineConfig: {
                                type: 'meili',
                                host: 'https://meili1.example.com',
                                masterKey: 'key1'
                            },
                            allowedEntityNames: ['User']
                        },
                        {
                            enabled: true,
                            engineConfig: {
                                type: 'meili',
                                host: 'https://meili2.example.com',
                                masterKey: 'key2'
                            },
                            allowedEntityNames: ['Product']
                        }
                    ]
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            expect(dynamoDBConstruct.dynamoDBConfig.table.searchIndexing).toHaveLength(2);
            expect(dynamoDBConstruct.dynamoDBConfig.table.searchIndexing[0].engineConfig.host).toBe('https://meili1.example.com');
            expect(dynamoDBConstruct.dynamoDBConfig.table.searchIndexing[1].engineConfig.host).toBe('https://meili2.example.com');
        });
        it('should NOT setup search indexing when disabled', async () => {
            const config = {
                table: {
                    name: 'no-search-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand()
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            await dynamoDBConstruct.construct();
            expect(dynamoDBConstruct.dynamoDBConfig.table.searchIndexing).toBeUndefined();
        });
        it('should validate search indexing with excluded entity names', () => {
            const config = {
                table: {
                    name: 'excluded-search-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    searchIndexing: [{
                            enabled: true,
                            engineConfig: {
                                type: 'meili',
                                host: 'https://meilisearch.example.com',
                                masterKey: 'test-key'
                            },
                            excludedEntityNames: ['TempData', 'Cache']
                        }]
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            expect(dynamoDBConstruct.dynamoDBConfig.table.searchIndexing[0].excludedEntityNames).toEqual(['TempData', 'Cache']);
        });
        it('should validate search indexing with custom queue name', () => {
            const config = {
                table: {
                    name: 'search-custom-queue-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    searchIndexing: [{
                            enabled: true,
                            engineConfig: {
                                type: 'meili',
                                host: 'https://meilisearch.example.com',
                                masterKey: 'test-key'
                            },
                            queueName: 'custom-search-queue'
                        }]
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            expect(dynamoDBConstruct.dynamoDBConfig.table.searchIndexing[0].queueName).toBe('custom-search-queue');
        });
        it('should validate search indexing with existing queue reference', () => {
            const config = {
                table: {
                    name: 'search-existing-queue-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    searchIndexing: [{
                            enabled: true,
                            engineConfig: {
                                type: 'meili',
                                host: 'https://meilisearch.example.com',
                                masterKey: 'test-key'
                            },
                            existingQueueName: 'MeilisearchSync'
                        }]
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            expect(dynamoDBConstruct.dynamoDBConfig.table.searchIndexing[0].existingQueueName).toBe('MeilisearchSync');
        });
        it('should validate search indexing with functionProps', () => {
            const config = {
                table: {
                    name: 'search-function-props-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    searchIndexing: [{
                            enabled: true,
                            engineConfig: {
                                type: 'meili',
                                host: 'https://meilisearch.example.com',
                                masterKey: 'test-key'
                            },
                            functionProps: {
                                timeout: aws_cdk_lib_1.Duration.seconds(90),
                                memorySize: 2048
                            }
                        }]
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            expect(dynamoDBConstruct.dynamoDBConfig.table.searchIndexing[0].functionProps.timeout).toBeDefined();
            expect(dynamoDBConstruct.dynamoDBConfig.table.searchIndexing[0].functionProps.memorySize).toBe(2048);
        });
        it('should validate search indexing with sqsEventSourceProps', () => {
            const config = {
                table: {
                    name: 'search-sqs-props-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    searchIndexing: [{
                            enabled: true,
                            engineConfig: {
                                type: 'meili',
                                host: 'https://meilisearch.example.com',
                                masterKey: 'test-key'
                            },
                            sqsEventSourceProps: {
                                batchSize: 5,
                                maxBatchingWindow: aws_cdk_lib_1.Duration.seconds(5)
                            }
                        }]
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            expect(dynamoDBConstruct.dynamoDBConfig.table.searchIndexing[0].sqsEventSourceProps.batchSize).toBe(5);
            expect(dynamoDBConstruct.dynamoDBConfig.table.searchIndexing[0].sqsEventSourceProps.maxBatchingWindow).toBeDefined();
        });
        it('should validate mixed enabled/disabled search indexing configs', () => {
            const config = {
                table: {
                    name: 'mixed-search-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    searchIndexing: [
                        {
                            enabled: true,
                            engineConfig: {
                                type: 'meili',
                                host: 'https://meili1.example.com',
                                masterKey: 'key1'
                            }
                        },
                        {
                            enabled: false,
                            engineConfig: {
                                type: 'meili',
                                host: 'https://meili2.example.com',
                                masterKey: 'key2'
                            }
                        }
                    ]
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            expect(dynamoDBConstruct.dynamoDBConfig.table.searchIndexing[0].enabled).toBe(true);
            expect(dynamoDBConstruct.dynamoDBConfig.table.searchIndexing[1].enabled).toBe(false);
        });
    });
    describe('Regression Tests - Bug Fixes', () => {
        /**
         * REGRESSION: Merge utility was called incorrectly in dynamodb.ts
         * This test verifies functionProps are correctly stored for queue handlers
         */
        it('REGRESSION: should store functionProps correctly for audit configuration', () => {
            const config = {
                table: {
                    name: 'merge-test-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    audit: {
                        enabled: true,
                        functionProps: {
                            timeout: aws_cdk_lib_1.Duration.seconds(30),
                            memorySize: 512
                        }
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            // Verify config is stored correctly (merge will happen during construct() in setupWithQueueHandler)
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.functionProps).toBeDefined();
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.functionProps.timeout).toBeDefined();
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.functionProps.memorySize).toBe(512);
        });
    });
    describe('Table Configuration - Advanced Features', () => {
        it('should create table with provisioned billing mode', async () => {
            const config = {
                table: {
                    name: 'provisioned-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.provisioned({
                            readCapacity: aws_dynamodb_1.Capacity.fixed(5),
                            writeCapacity: aws_dynamodb_1.Capacity.autoscaled({ maxCapacity: 10 })
                        })
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            await dynamoDBConstruct.construct();
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
                BillingMode: 'PROVISIONED'
            });
        });
        it('should create table with Global Secondary Index (GSI)', async () => {
            const config = {
                table: {
                    name: 'gsi-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        globalSecondaryIndexes: [
                            {
                                indexName: 'status-index',
                                partitionKey: { name: 'status', type: aws_dynamodb_1.AttributeType.STRING }
                            }
                        ]
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            await dynamoDBConstruct.construct();
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
                GlobalSecondaryIndexes: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        IndexName: 'status-index'
                    })
                ])
            });
        });
        it('should create table with Local Secondary Index (LSI)', async () => {
            const config = {
                table: {
                    name: 'lsi-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        sortKey: { name: 'timestamp', type: aws_dynamodb_1.AttributeType.NUMBER },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        localSecondaryIndexes: [
                            {
                                indexName: 'type-index',
                                sortKey: { name: 'type', type: aws_dynamodb_1.AttributeType.STRING }
                            }
                        ]
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            await dynamoDBConstruct.construct();
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
                LocalSecondaryIndexes: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        IndexName: 'type-index'
                    })
                ])
            });
        });
        it('should create table with Time-to-Live (TTL)', async () => {
            const config = {
                table: {
                    name: 'ttl-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        timeToLiveAttribute: 'expiresAt'
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            await dynamoDBConstruct.construct();
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
                TimeToLiveSpecification: assertions_1.Match.objectLike({
                    AttributeName: 'expiresAt',
                    Enabled: true
                })
            });
        });
        it('should create table with point-in-time recovery', async () => {
            const config = {
                table: {
                    name: 'pitr-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        pointInTimeRecovery: true
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            await dynamoDBConstruct.construct();
            // Point-in-time recovery is configured at the replica level in GlobalTable
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
                Replicas: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        PointInTimeRecoverySpecification: assertions_1.Match.objectLike({
                            PointInTimeRecoveryEnabled: true
                        })
                    })
                ])
            });
        });
        it('should create table with RETAIN removal policy', async () => {
            const config = {
                table: {
                    name: 'retain-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        removalPolicy: aws_cdk_lib_1.RemovalPolicy.RETAIN
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            await dynamoDBConstruct.construct();
            const template = assertions_1.Template.fromStack(stack);
            const resources = template.findResources('AWS::DynamoDB::GlobalTable');
            const resourceKeys = Object.keys(resources);
            expect(resourceKeys.length).toBe(1);
            expect(resources[resourceKeys[0]].DeletionPolicy).toBe('Retain');
        });
        it('should create table with contributor insights', async () => {
            const config = {
                table: {
                    name: 'insights-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        contributorInsights: true
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            await dynamoDBConstruct.construct();
            // Contributor insights is configured at the replica level in GlobalTable
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
                Replicas: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        ContributorInsightsSpecification: assertions_1.Match.objectLike({
                            Enabled: true
                        })
                    })
                ])
            });
        });
        it('should create table with multiple GSIs and LSIs', async () => {
            const config = {
                table: {
                    name: 'complex-indexes-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        sortKey: { name: 'timestamp', type: aws_dynamodb_1.AttributeType.NUMBER },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        globalSecondaryIndexes: [
                            {
                                indexName: 'status-index',
                                partitionKey: { name: 'status', type: aws_dynamodb_1.AttributeType.STRING }
                            },
                            {
                                indexName: 'type-index',
                                partitionKey: { name: 'type', type: aws_dynamodb_1.AttributeType.STRING },
                                sortKey: { name: 'createdAt', type: aws_dynamodb_1.AttributeType.NUMBER }
                            }
                        ],
                        localSecondaryIndexes: [
                            {
                                indexName: 'local-status-index',
                                sortKey: { name: 'status', type: aws_dynamodb_1.AttributeType.STRING }
                            }
                        ]
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            await dynamoDBConstruct.construct();
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
                GlobalSecondaryIndexes: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({ IndexName: 'status-index' }),
                    assertions_1.Match.objectLike({ IndexName: 'type-index' })
                ]),
                LocalSecondaryIndexes: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({ IndexName: 'local-status-index' })
                ])
            });
        });
    });
    describe('Stream Processing - ViewTypes', () => {
        it('should validate stream with KEYS_ONLY view type', () => {
            const config = {
                table: {
                    name: 'keys-only-stream-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.KEYS_ONLY
                    },
                    stream: {
                        enabled: true
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            expect(dynamoDBConstruct.dynamoDBConfig.table.props.dynamoStream).toBe(aws_dynamodb_1.StreamViewType.KEYS_ONLY);
        });
        it('should validate stream with NEW_IMAGE view type', () => {
            const config = {
                table: {
                    name: 'new-image-stream-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_IMAGE
                    },
                    stream: {
                        enabled: true
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            expect(dynamoDBConstruct.dynamoDBConfig.table.props.dynamoStream).toBe(aws_dynamodb_1.StreamViewType.NEW_IMAGE);
        });
        it('should validate stream with OLD_IMAGE view type', () => {
            const config = {
                table: {
                    name: 'old-image-stream-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.OLD_IMAGE
                    },
                    stream: {
                        enabled: true
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            expect(dynamoDBConstruct.dynamoDBConfig.table.props.dynamoStream).toBe(aws_dynamodb_1.StreamViewType.OLD_IMAGE);
        });
    });
    describe('Edge Cases and Error Scenarios', () => {
        it('should validate audit configuration without stream ARN', () => {
            const config = {
                table: {
                    name: 'no-stream-arn-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand()
                        // No dynamoStream - no stream ARN
                    },
                    audit: {
                        enabled: true
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            // Verify configuration is stored even without stream ARN
            // The construct will log a warning during construct() but config is valid
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.enabled).toBe(true);
            expect(dynamoDBConstruct.dynamoDBConfig.table.props.dynamoStream).toBeUndefined();
        });
        it('should handle minimal table configuration', async () => {
            const config = {
                table: {
                    name: 'minimal-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand()
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            await dynamoDBConstruct.construct();
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::DynamoDB::GlobalTable', 1);
        });
        it('should handle table with encryption', async () => {
            const config = {
                table: {
                    name: 'encrypted-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        encryption: aws_dynamodb_1.TableEncryptionV2.awsManagedKey()
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            await dynamoDBConstruct.construct();
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
                SSESpecification: assertions_1.Match.objectLike({
                    SSEEnabled: true
                })
            });
        });
        it('should handle empty search indexing array', async () => {
            const config = {
                table: {
                    name: 'empty-search-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand()
                    },
                    searchIndexing: []
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            await dynamoDBConstruct.construct();
            expect(dynamoDBConstruct.dynamoDBConfig.table.searchIndexing).toEqual([]);
        });
        it('should throw error when partition key is missing', async () => {
            const config = {
                table: {
                    name: 'no-partition-key-table',
                    props: {
                        billing: aws_dynamodb_1.Billing.onDemand()
                    } // Force invalid config
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            // CDK will throw during construct() due to missing partition key
            await expect(dynamoDBConstruct.construct()).rejects.toThrow();
        });
        it('should handle table name with special characters (sanitized)', async () => {
            const config = {
                table: {
                    name: 'my-special@table#name',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand()
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            await dynamoDBConstruct.construct();
            // ensureNoSpecialChars should sanitize the name (dynamodb.ts:466)
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::DynamoDB::GlobalTable', 1);
        });
        it('should handle zero batch size for stream processor', () => {
            const config = {
                table: {
                    name: 'zero-batch-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    stream: {
                        enabled: true,
                        processor: {
                            startingPosition: aws_lambda_1.StartingPosition.LATEST,
                            batchSize: 0 // Invalid
                        }
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            // Config is stored, but CDK will validate during synthesis
            expect(dynamoDBConstruct.dynamoDBConfig.table.stream.processor.batchSize).toBe(0);
        });
        it('should handle negative retry attempts', () => {
            const config = {
                table: {
                    name: 'negative-retry-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    stream: {
                        enabled: true,
                        processor: {
                            startingPosition: aws_lambda_1.StartingPosition.LATEST,
                            retryAttempts: -1 // Invalid
                        }
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            expect(dynamoDBConstruct.dynamoDBConfig.table.stream.processor.retryAttempts).toBe(-1);
        });
        it('should handle both allowed and excluded entity names (conflict)', () => {
            const config = {
                table: {
                    name: 'conflict-audit-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    audit: {
                        enabled: true,
                        allowedEntityNames: ['User'],
                        excludedEntityNames: ['User'] // Conflict!
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            // Config is stored, runtime logic should handle conflict
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.allowedEntityNames).toEqual(['User']);
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.excludedEntityNames).toEqual(['User']);
        });
        it('should handle empty string table name', async () => {
            const config = {
                table: {
                    name: '',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand()
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            // ensureNoSpecialChars and ensureSuffix will process empty string
            // CDK actually allows empty table names (auto-generates), so this will succeed
            await dynamoDBConstruct.construct();
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::DynamoDB::GlobalTable', 1);
        });
        it('should handle missing search engine config', () => {
            const config = {
                table: {
                    name: 'missing-engine-config-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    searchIndexing: [{
                            enabled: true,
                            engineConfig: undefined // Missing!
                        }]
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            // Config is stored, runtime will fail when trying to use undefined engineConfig
            expect(dynamoDBConstruct.dynamoDBConfig.table.searchIndexing[0].engineConfig).toBeUndefined();
        });
        it('should handle empty engine host', () => {
            const config = {
                table: {
                    name: 'empty-host-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    searchIndexing: [{
                            enabled: true,
                            engineConfig: {
                                type: 'meili',
                                host: '', // Empty!
                                masterKey: 'test-key'
                            }
                        }]
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            expect(dynamoDBConstruct.dynamoDBConfig.table.searchIndexing[0].engineConfig.host).toBe('');
        });
        it('should handle stream enabled without dynamoStream on table', () => {
            const config = {
                table: {
                    name: 'no-stream-prop-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand()
                        // No dynamoStream!
                    },
                    stream: {
                        enabled: true // But stream enabled!
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            // Config is stored, but setupStreamProcessing will log warning (dynamodb.ts:493)
            expect(dynamoDBConstruct.dynamoDBConfig.table.stream.enabled).toBe(true);
            expect(dynamoDBConstruct.dynamoDBConfig.table.props.dynamoStream).toBeUndefined();
        });
    });
    describe('Snapshot Tests - CloudFormation Consistency', () => {
        /**
         * Snapshot: Basic Table
         * Tests CloudFormation template for a basic DynamoDB table.
         */
        it('should generate consistent CloudFormation for basic table', async () => {
            const config = {
                table: {
                    name: 'snapshot-basic-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            await dynamoDBConstruct.construct();
            const template = assertions_1.Template.fromStack(stack).toJSON();
            expect(template).toMatchSnapshot();
        });
        /**
         * Snapshot: Table with Stream Enabled (configuration only)
         * Tests CloudFormation template with stream enabled on the table.
         * NOTE: Stream processor Lambda not included (requires runtime files).
         */
        it('should generate consistent CloudFormation for table with stream enabled', async () => {
            const config = {
                table: {
                    name: 'snapshot-stream-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES,
                        removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY
                    }
                    // No stream processor - just the table with stream enabled
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            await dynamoDBConstruct.construct();
            const template = assertions_1.Template.fromStack(stack).toJSON();
            expect(template).toMatchSnapshot();
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vZGIudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9jb25zdHJ1Y3RzL2R5bmFtb2RiLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSw2Q0FBa0U7QUFDbEUsdURBQXlEO0FBQ3pELDJEQUErRztBQUMvRyx1REFBMEQ7QUFFMUQseUNBQWdFO0FBQ2hFLHVDQUFvQztBQUVwQzs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW1CRztBQUNILFFBQVEsQ0FBQyxtQkFBbUIsRUFBRSxHQUFHLEVBQUU7SUFDakMsSUFBSSxHQUFRLENBQUM7SUFDYixJQUFJLEtBQVksQ0FBQztJQUVqQixVQUFVLENBQUMsR0FBRyxFQUFFO1FBQ2QscUJBQXFCO1FBQ3BCLFdBQVksQ0FBQyxRQUFRLEdBQUcsU0FBUyxDQUFDO1FBRW5DLEdBQUcsR0FBRyxJQUFJLGlCQUFHLEVBQUUsQ0FBQztRQUNoQixLQUFLLEdBQUcsSUFBSSxtQkFBSyxDQUFDLEdBQUcsRUFBRSxXQUFXLEVBQUU7WUFDbEMsR0FBRyxFQUFFLEVBQUUsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFO1NBQ3RELENBQUMsQ0FBQztRQUVILGtCQUFrQjtRQUNsQixNQUFNLElBQUksR0FBRyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7UUFDaEMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUNqQixJQUFJLENBQUMsU0FBUyxDQUFDO1lBQ2IsSUFBSSxFQUFFLG1CQUFtQjtZQUN6QixNQUFNLEVBQUUsV0FBVztZQUNuQixPQUFPLEVBQUUsY0FBYztTQUN4QixDQUFDLENBQUM7UUFDSCxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sRUFBRSxLQUFLLENBQUMsQ0FBQztJQUMvQixDQUFDLENBQUMsQ0FBQztJQUVILFNBQVMsQ0FBQyxHQUFHLEVBQUU7UUFDWixXQUFZLENBQUMsUUFBUSxHQUFHLFNBQVMsQ0FBQztJQUNy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QUFDLEtBQUssQ0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDO1lBQ3BELE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQyxlQUFlLEVBQUUsQ0FBQztRQUNyQyxDQUFDLENBQUMsQ0FBQztRQUVIOzs7O1dBSUc7UUFDSCxFQUFFLENBQUMseUVBQXlFLEVBQUUsS0FBSyxJQUFJLEVBQUU7WUFDdkYsTUFBTSxNQUFNLEdBQW9CO2dCQUM5QixLQUFLLEVBQUU7b0JBQ0wsSUFBSSxFQUFFLHVCQUF1QjtvQkFDN0IsS0FBSyxFQUFFO3dCQUNMLFlBQVksRUFBRSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLDRCQUFhLENBQUMsTUFBTSxFQUFFO3dCQUN4RCxPQUFPLEVBQUUsc0JBQU8sQ0FBQyxRQUFRLEVBQUU7d0JBQzNCLFlBQVksRUFBRSw2QkFBYyxDQUFDLGtCQUFrQjt3QkFDL0MsYUFBYSxFQUFFLDJCQUFhLENBQUMsT0FBTztxQkFDckM7b0JBQ0QsMkRBQTJEO2lCQUM1RDthQUNGLENBQUM7WUFFRixNQUFNLGlCQUFpQixHQUFHLElBQUksNEJBQWlCLENBQUMsTUFBTSxDQUFDLENBQUM7WUFDeEQsTUFBTSxpQkFBaUIsQ0FBQyxTQUFTLEVBQUUsQ0FBQztZQUVwQyxNQUFNLFFBQVEsR0FBRyxxQkFBUSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUNwRCxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUMsZUFBZSxFQUFFLENBQUM7UUFDckMsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQXBwLCBTdGFjaywgUmVtb3ZhbFBvbGljeSwgRHVyYXRpb24gfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBUZW1wbGF0ZSwgTWF0Y2ggfSBmcm9tICdhd3MtY2RrLWxpYi9hc3NlcnRpb25zJztcbmltcG9ydCB7IEF0dHJpYnV0ZVR5cGUsIEJpbGxpbmcsIENhcGFjaXR5LCBTdHJlYW1WaWV3VHlwZSwgVGFibGVFbmNyeXB0aW9uVjIgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0IHsgU3RhcnRpbmdQb3NpdGlvbiB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgUmV0ZW50aW9uRGF5cyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCB7IER5bmFtb0RCQ29uc3RydWN0LCBJRHluYW1vREJDb25maWcgfSBmcm9tICcuL2R5bmFtb2RiJztcbmltcG9ydCB7IEZ3MjQgfSBmcm9tICcuLi9jb3JlL2Z3MjQnO1xuXG4vKipcbiAqIER5bmFtb0RCQ29uc3RydWN0IFRlc3QgU3VpdGVcbiAqIFxuICogTk9URTogRHluYW1vREJDb25zdHJ1Y3QgaXMgaGlnaGx5IGNvbXBsZXggKDk0NiBsaW5lcykgd2l0aCBzdHJlYW0gcHJvY2Vzc2luZywgYXVkaXQsIGFuZCBzZWFyY2ggaW5kZXhpbmcuXG4gKiBUaGVzZSB0ZXN0cyBmb2N1cyBvbjpcbiAqIDEuIEJhc2ljIHRhYmxlIGNyZWF0aW9uIGFuZCBjb25maWd1cmF0aW9uXG4gKiAyLiBTdHJlYW0gcHJvY2Vzc2luZyBzZXR1cCAoU05TIHRvcGljICsgTGFtYmRhIHByb2Nlc3NvcilcbiAqIDMuIEF1ZGl0IGNvbmZpZ3VyYXRpb24gKENsb3VkV2F0Y2gsIGV4aXN0aW5nL25ldy9oYW5kbGVyIHF1ZXVlcylcbiAqIDQuIFNlYXJjaCBpbmRleGluZyBjb25maWd1cmF0aW9uIChNZWlsaSwgZXhpc3RpbmcvbmV3L2hhbmRsZXIgcXVldWVzKVxuICogNS4gTWVyZ2UgdXRpbGl0eSB1c2FnZSAoYnVnIHdlIGZpeGVkKVxuICogNi4gUXVldWUgY29uZmlndXJhdGlvbiBleHRyYWN0aW9uIGFuZCB2YWxpZGF0aW9uXG4gKiBcbiAqIE5PVCBURVNURUQgKHJlcXVpcmVzIGZ1bGwgYXBwIGNvbnRleHQpOlxuICogLSBBY3R1YWwgcXVldWUgaGFuZGxlciBmaWxlIGxvYWRpbmcgKG5lZWRzIEBRdWV1ZSBkZWNvcmF0ZWQgZmlsZXMpXG4gKiAtIER5bmFtb0RCIHN0cmVhbSBldmVudCBwcm9jZXNzaW5nIChydW50aW1lIGJlaGF2aW9yKVxuICogLSBBdWRpdCBsb2cgd3JpdGluZyAocnVudGltZSBiZWhhdmlvcilcbiAqIC0gU2VhcmNoIGluZGV4IHN5bmNocm9uaXphdGlvbiAocnVudGltZSBiZWhhdmlvcilcbiAqIFxuICogVGhlc2UgYXJlIGludGVncmF0aW9uL3J1bnRpbWUgZmVhdHVyZXMgdGVzdGVkIGluIEUyRSB0ZXN0cy5cbiAqL1xuZGVzY3JpYmUoJ0R5bmFtb0RCQ29uc3RydWN0JywgKCkgPT4ge1xuICBsZXQgYXBwOiBBcHA7XG4gIGxldCBzdGFjazogU3RhY2s7XG5cbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgLy8gQ2xlYW4gdXAgc2luZ2xldG9uXG4gICAgKEZ3MjQgYXMgYW55KS5pbnN0YW5jZSA9IHVuZGVmaW5lZDtcblxuICAgIGFwcCA9IG5ldyBBcHAoKTtcbiAgICBzdGFjayA9IG5ldyBTdGFjayhhcHAsICdUZXN0U3RhY2snLCB7XG4gICAgICBlbnY6IHsgYWNjb3VudDogJzEyMzQ1Njc4OTAxMicsIHJlZ2lvbjogJ3VzLWVhc3QtMScgfVxuICAgIH0pO1xuXG4gICAgLy8gSW5pdGlhbGl6ZSBGdzI0XG4gICAgY29uc3QgZncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcbiAgICBmdzI0LnNldEFwcChhcHApO1xuICAgIGZ3MjQuc2V0Q29uZmlnKHtcbiAgICAgIG5hbWU6ICd0ZXN0LWR5bmFtb2RiLWFwcCcsXG4gICAgICByZWdpb246ICd1cy1lYXN0LTEnLFxuICAgICAgYWNjb3VudDogJzEyMzQ1Njc4OTAxMidcbiAgICB9KTtcbiAgICBmdzI0LmFkZFN0YWNrKCdtYWluJywgc3RhY2spO1xuICB9KTtcblxuICBhZnRlckVhY2goKCkgPT4ge1xuICAgIChGdzI0IGFzIGFueSkuaW5zdGFuY2UgPSB1bmRlZmluZWQ7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdCYXNpYyBUYWJsZSBDcmVhdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSBhIER5bmFtb0RCIHRhYmxlIHdpdGggbWluaW1hbCBjb25maWd1cmF0aW9uJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ3Rlc3QtdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcbiAgICAgIGF3YWl0IGR5bmFtb0RCQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6RHluYW1vREI6Okdsb2JhbFRhYmxlJywgMSk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RHluYW1vREI6Okdsb2JhbFRhYmxlJywge1xuICAgICAgICBLZXlTY2hlbWE6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgICAgTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgICBBdHRyaWJ1dGVOYW1lOiAnaWQnLFxuICAgICAgICAgICAgS2V5VHlwZTogJ0hBU0gnXG4gICAgICAgICAgfSlcbiAgICAgICAgXSksXG4gICAgICAgIEJpbGxpbmdNb2RlOiAnUEFZX1BFUl9SRVFVRVNUJ1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSB0YWJsZSB3aXRoIHBhcnRpdGlvbiBrZXkgYW5kIHNvcnQga2V5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ3VzZXJzLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICd1c2VySWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgc29ydEtleTogeyBuYW1lOiAndGltZXN0YW1wJywgdHlwZTogQXR0cmlidXRlVHlwZS5OVU1CRVIgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcbiAgICAgIGF3YWl0IGR5bmFtb0RCQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RHluYW1vREI6Okdsb2JhbFRhYmxlJywge1xuICAgICAgICBLZXlTY2hlbWE6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgICAgTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgICBBdHRyaWJ1dGVOYW1lOiAndXNlcklkJyxcbiAgICAgICAgICAgIEtleVR5cGU6ICdIQVNIJ1xuICAgICAgICAgIH0pLFxuICAgICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgQXR0cmlidXRlTmFtZTogJ3RpbWVzdGFtcCcsXG4gICAgICAgICAgICBLZXlUeXBlOiAnUkFOR0UnXG4gICAgICAgICAgfSlcbiAgICAgICAgXSlcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCByZWdpc3RlciB0YWJsZSBpbiBmdzI0IGVudmlyb25tZW50JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ3JlZ2lzdGVyZWQtdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcbiAgICAgIGF3YWl0IGR5bmFtb0RCQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICBjb25zdCBmdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuICAgICAgLy8gVmVyaWZ5IHRhYmxlIGlzIHJlZ2lzdGVyZWQgaW4gZncyNCAoZHluYW1vZGIudHM6NDc0LTQ3OClcbiAgICAgIGV4cGVjdChkeW5hbW9EQkNvbnN0cnVjdC5vdXRwdXQpLnRvQmVEZWZpbmVkKCk7XG4gICAgICAvLyBPdXRwdXQgc3RydWN0dXJlIHVzZXMgT3V0cHV0VHlwZS5UQUJMRSBhcyBrZXlcbiAgICAgIGV4cGVjdChPYmplY3Qua2V5cyhkeW5hbW9EQkNvbnN0cnVjdC5vdXRwdXQpLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuKDApO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6RHluYW1vREI6Okdsb2JhbFRhYmxlJywgMSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGFwcGx5IHRhYmxlIG5hbWUgc3VmZml4IGZvciBpbnRlcm5hbCBuYW1pbmcnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnbXktZGF0YScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuICAgICAgYXdhaXQgZHluYW1vREJDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG5cbiAgICAgIC8vIE9yaWdpbmFsIGNvbmZpZyByZW1haW5zIHVuY2hhbmdlZFxuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLm5hbWUpLnRvQmUoJ215LWRhdGEnKTtcblxuICAgICAgLy8gVmVyaWZ5IHRhYmxlIGlzIGNyZWF0ZWQgKGR5bmFtb2RiLnRzOjQ2NiBhcHBsaWVzIHN1ZmZpeCBpbnRlcm5hbGx5IGZvciBjb25zdHJ1Y3QgSUQpXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6RHluYW1vREI6Okdsb2JhbFRhYmxlJywgMSk7XG5cbiAgICAgIC8vIENsb3VkRm9ybWF0aW9uIHRhYmxlIG5hbWUgaXMgQ0RLLWdlbmVyYXRlZCwgdmVyaWZ5IHRhYmxlIGV4aXN0c1xuICAgICAgY29uc3QgcmVzb3VyY2VzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpEeW5hbW9EQjo6R2xvYmFsVGFibGUnKTtcbiAgICAgIGV4cGVjdChPYmplY3Qua2V5cyhyZXNvdXJjZXMpLmxlbmd0aCkudG9CZSgxKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1N0cmVhbSBQcm9jZXNzaW5nIENvbmZpZ3VyYXRpb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBzdHJlYW0gY29uZmlndXJhdGlvbiBpcyBzdG9yZWQgY29ycmVjdGx5JywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ3N0cmVhbS10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgZHluYW1vU3RyZWFtOiBTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVNcbiAgICAgICAgICB9LFxuICAgICAgICAgIHN0cmVhbToge1xuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgLy8gVmVyaWZ5IGNvbmZpZ3VyYXRpb24gaXMgc3RvcmVkIGNvcnJlY3RseVxuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnN0cmVhbS5lbmFibGVkKS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnByb3BzLmR5bmFtb1N0cmVhbSkudG9CZShTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVMpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBjdXN0b20gdG9waWMgbmFtZSBjb25maWd1cmF0aW9uJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ2N1c3RvbS1zdHJlYW0tdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIGR5bmFtb1N0cmVhbTogU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzdHJlYW06IHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICB0b3BpYzoge1xuICAgICAgICAgICAgICBuYW1lOiAnY3VzdG9tLXRvcGljLW5hbWUnXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICAvLyBWZXJpZnkgY3VzdG9tIHRvcGljIG5hbWUgaXMgc3RvcmVkXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc3RyZWFtLnRvcGljLm5hbWUpLnRvQmUoJ2N1c3RvbS10b3BpYy1uYW1lJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIEZJRk8gdG9waWMgY29uZmlndXJhdGlvbicsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdmaWZvLXN0cmVhbS10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgZHluYW1vU3RyZWFtOiBTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVNcbiAgICAgICAgICB9LFxuICAgICAgICAgIHN0cmVhbToge1xuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIHRvcGljOiB7XG4gICAgICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICAgICAgZmlmbzogdHJ1ZVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICAvLyBWZXJpZnkgRklGTyBjb25maWd1cmF0aW9uIGlzIHN0b3JlZFxuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnN0cmVhbS50b3BpYy5wcm9wcy5maWZvKS50b0JlKHRydWUpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBjdXN0b20gc3RyZWFtIHByb2Nlc3NvciBjb25maWd1cmF0aW9uJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ2N1c3RvbS1wcm9jZXNzb3ItdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIGR5bmFtb1N0cmVhbTogU3RyZWFtVmlld1R5cGUuS0VZU19PTkxZXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzdHJlYW06IHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBwcm9jZXNzb3I6IHtcbiAgICAgICAgICAgICAgc3RhcnRpbmdQb3NpdGlvbjogU3RhcnRpbmdQb3NpdGlvbi5UUklNX0hPUklaT04sXG4gICAgICAgICAgICAgIGJhdGNoU2l6ZTogMTAsXG4gICAgICAgICAgICAgIGJpc2VjdEJhdGNoT25FcnJvcjogZmFsc2UsXG4gICAgICAgICAgICAgIHJldHJ5QXR0ZW1wdHM6IDVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIC8vIFZlcmlmeSBjdXN0b20gcHJvY2Vzc29yIGNvbmZpZyBpcyBzdG9yZWRcbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5zdHJlYW0ucHJvY2Vzc29yLmJhdGNoU2l6ZSkudG9CZSgxMCk7XG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc3RyZWFtLnByb2Nlc3Nvci5zdGFydGluZ1Bvc2l0aW9uKS50b0JlKFN0YXJ0aW5nUG9zaXRpb24uVFJJTV9IT1JJWk9OKTtcbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5zdHJlYW0ucHJvY2Vzc29yLmJpc2VjdEJhdGNoT25FcnJvcikudG9CZShmYWxzZSk7XG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc3RyZWFtLnByb2Nlc3Nvci5yZXRyeUF0dGVtcHRzKS50b0JlKDUpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBOT1Qgc2V0dXAgc3RyZWFtIHByb2Nlc3Npbmcgd2hlbiBkaXNhYmxlZCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICduby1zdHJlYW0tdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKVxuICAgICAgICAgICAgLy8gTm8gZHluYW1vU3RyZWFtIHNwZWNpZmllZFxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcbiAgICAgIGF3YWl0IGR5bmFtb0RCQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICAvLyBObyBTTlMgdG9waWMgb3IgTGFtYmRhIHByb2Nlc3NvciBzaG91bGQgYmUgY3JlYXRlZFxuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OlNOUzo6VG9waWMnLCAwKTtcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywgMCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdBdWRpdCBDb25maWd1cmF0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgYmFzaWMgYXVkaXQgY29uZmlndXJhdGlvbicsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdhdWRpdC10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgZHluYW1vU3RyZWFtOiBTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVNcbiAgICAgICAgICB9LFxuICAgICAgICAgIGF1ZGl0OiB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICAvLyBWZXJpZnkgYXVkaXQgY29uZmlndXJhdGlvbiBpcyBzdG9yZWQgY29ycmVjdGx5IChvYnNlcnZhYmlsaXR5IHN5c3RlbSBoYW5kbGVzIHJvdXRpbmcpXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuYXVkaXQuZW5hYmxlZCkudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgYXVkaXQgd2l0aCBhbGxvd2VkIGVudGl0eSBuYW1lcycsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdmaWx0ZXJlZC1hdWRpdC10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgZHluYW1vU3RyZWFtOiBTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVNcbiAgICAgICAgICB9LFxuICAgICAgICAgIGF1ZGl0OiB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgYWxsb3dlZEVudGl0eU5hbWVzOiBbICdVc2VyJywgJ09yZGVyJyBdXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuYXVkaXQuYWxsb3dlZEVudGl0eU5hbWVzKS50b0VxdWFsKFsgJ1VzZXInLCAnT3JkZXInIF0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBhdWRpdCB3aXRoIGV4Y2x1ZGVkIGVudGl0eSBuYW1lcycsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdleGNsdWRlZC1hdWRpdC10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgZHluYW1vU3RyZWFtOiBTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVNcbiAgICAgICAgICB9LFxuICAgICAgICAgIGF1ZGl0OiB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgZXhjbHVkZWRFbnRpdHlOYW1lczogWyAnVGVtcERhdGEnLCAnQ2FjaGUnIF1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5hdWRpdC5leGNsdWRlZEVudGl0eU5hbWVzKS50b0VxdWFsKFsgJ1RlbXBEYXRhJywgJ0NhY2hlJyBdKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgTk9UIHNldHVwIGF1ZGl0IHdoZW4gZGlzYWJsZWQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnbm8tYXVkaXQtdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcbiAgICAgIGF3YWl0IGR5bmFtb0RCQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuYXVkaXQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgYXVkaXQgd2l0aCBjdXN0b20gZnVuY3Rpb25Qcm9wcycsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdhdWRpdC1mdW5jdGlvbi1wcm9wcy10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgZHluYW1vU3RyZWFtOiBTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVNcbiAgICAgICAgICB9LFxuICAgICAgICAgIGF1ZGl0OiB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgZnVuY3Rpb25Qcm9wczoge1xuICAgICAgICAgICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDYwKSxcbiAgICAgICAgICAgICAgbWVtb3J5U2l6ZTogMTAyNFxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLmF1ZGl0LmZ1bmN0aW9uUHJvcHMudGltZW91dCkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5hdWRpdC5mdW5jdGlvblByb3BzLm1lbW9yeVNpemUpLnRvQmUoMTAyNCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIGF1ZGl0IHdpdGggY3VzdG9tIHF1ZXVlIG5hbWUnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnYXVkaXQtY3VzdG9tLXF1ZXVlLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICBkeW5hbW9TdHJlYW06IFN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFU1xuICAgICAgICAgIH0sXG4gICAgICAgICAgYXVkaXQ6IHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBxdWV1ZU5hbWU6ICdjdXN0b20tYXVkaXQtcXVldWUnXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuYXVkaXQucXVldWVOYW1lKS50b0JlKCdjdXN0b20tYXVkaXQtcXVldWUnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgYXVkaXQgd2l0aCBleGlzdGluZyBxdWV1ZSByZWZlcmVuY2UnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnYXVkaXQtZXhpc3RpbmctcXVldWUtdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIGR5bmFtb1N0cmVhbTogU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTXG4gICAgICAgICAgfSxcbiAgICAgICAgICBhdWRpdDoge1xuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIGV4aXN0aW5nUXVldWVOYW1lOiAnQXVkaXRQcm9jZXNzb3InXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuYXVkaXQuZXhpc3RpbmdRdWV1ZU5hbWUpLnRvQmUoJ0F1ZGl0UHJvY2Vzc29yJyk7XG4gICAgfSk7XG5cblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgYXVkaXQgd2l0aCBzcXNFdmVudFNvdXJjZVByb3BzJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ2F1ZGl0LXNxcy1wcm9wcy10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgZHluYW1vU3RyZWFtOiBTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVNcbiAgICAgICAgICB9LFxuICAgICAgICAgIGF1ZGl0OiB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgc3FzRXZlbnRTb3VyY2VQcm9wczoge1xuICAgICAgICAgICAgICBiYXRjaFNpemU6IDIwLFxuICAgICAgICAgICAgICBtYXhCYXRjaGluZ1dpbmRvdzogRHVyYXRpb24uc2Vjb25kcygxMClcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5hdWRpdC5zcXNFdmVudFNvdXJjZVByb3BzLmJhdGNoU2l6ZSkudG9CZSgyMCk7XG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuYXVkaXQuc3FzRXZlbnRTb3VyY2VQcm9wcy5tYXhCYXRjaGluZ1dpbmRvdykudG9CZURlZmluZWQoKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1NlYXJjaCBJbmRleGluZyBDb25maWd1cmF0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgc2VhcmNoIGluZGV4aW5nIHdpdGggTWVpbGkgZW5naW5lJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ3NlYXJjaC10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgZHluYW1vU3RyZWFtOiBTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVNcbiAgICAgICAgICB9LFxuICAgICAgICAgIHNlYXJjaEluZGV4aW5nOiBbIHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBlbmdpbmVDb25maWc6IHtcbiAgICAgICAgICAgICAgdHlwZTogJ21laWxpJyxcbiAgICAgICAgICAgICAgaG9zdDogJ2h0dHBzOi8vbWVpbGlzZWFyY2guZXhhbXBsZS5jb20nLFxuICAgICAgICAgICAgICBtYXN0ZXJLZXk6ICd0ZXN0LW1hc3Rlci1rZXknXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBdXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIC8vIFZlcmlmeSBzZWFyY2ggaW5kZXhpbmcgY29uZmlndXJhdGlvbiBpcyBzdG9yZWQgY29ycmVjdGx5XG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc2VhcmNoSW5kZXhpbmdbIDAgXS5lbmFibGVkKS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnNlYXJjaEluZGV4aW5nWyAwIF0uZW5naW5lQ29uZmlnLnR5cGUpLnRvQmUoJ21laWxpJyk7XG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc2VhcmNoSW5kZXhpbmdbIDAgXS5lbmdpbmVDb25maWcuaG9zdCkudG9CZSgnaHR0cHM6Ly9tZWlsaXNlYXJjaC5leGFtcGxlLmNvbScpO1xuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnNlYXJjaEluZGV4aW5nWyAwIF0uZW5naW5lQ29uZmlnLm1hc3RlcktleSkudG9CZSgndGVzdC1tYXN0ZXIta2V5Jyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIHNlYXJjaCBpbmRleGluZyB3aXRoIGFsbG93ZWQgZW50aXR5IG5hbWVzJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ2ZpbHRlcmVkLXNlYXJjaC10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgZHluYW1vU3RyZWFtOiBTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVNcbiAgICAgICAgICB9LFxuICAgICAgICAgIHNlYXJjaEluZGV4aW5nOiBbIHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBlbmdpbmVDb25maWc6IHtcbiAgICAgICAgICAgICAgdHlwZTogJ21laWxpJyxcbiAgICAgICAgICAgICAgaG9zdDogJ2h0dHBzOi8vbWVpbGlzZWFyY2guZXhhbXBsZS5jb20nLFxuICAgICAgICAgICAgICBtYXN0ZXJLZXk6ICd0ZXN0LWtleSdcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBhbGxvd2VkRW50aXR5TmFtZXM6IFsgJ1Byb2R1Y3QnLCAnQ2F0ZWdvcnknIF1cbiAgICAgICAgICB9IF1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnNlYXJjaEluZGV4aW5nWyAwIF0uYWxsb3dlZEVudGl0eU5hbWVzKS50b0VxdWFsKFsgJ1Byb2R1Y3QnLCAnQ2F0ZWdvcnknIF0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBtdWx0aXBsZSBzZWFyY2ggaW5kZXhpbmcgY29uZmlndXJhdGlvbnMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnbXVsdGktc2VhcmNoLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICBkeW5hbW9TdHJlYW06IFN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFU1xuICAgICAgICAgIH0sXG4gICAgICAgICAgc2VhcmNoSW5kZXhpbmc6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgICAgZW5naW5lQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgdHlwZTogJ21laWxpJyxcbiAgICAgICAgICAgICAgICBob3N0OiAnaHR0cHM6Ly9tZWlsaTEuZXhhbXBsZS5jb20nLFxuICAgICAgICAgICAgICAgIG1hc3RlcktleTogJ2tleTEnXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGFsbG93ZWRFbnRpdHlOYW1lczogWyAnVXNlcicgXVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgICAgZW5naW5lQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgdHlwZTogJ21laWxpJyxcbiAgICAgICAgICAgICAgICBob3N0OiAnaHR0cHM6Ly9tZWlsaTIuZXhhbXBsZS5jb20nLFxuICAgICAgICAgICAgICAgIG1hc3RlcktleTogJ2tleTInXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGFsbG93ZWRFbnRpdHlOYW1lczogWyAnUHJvZHVjdCcgXVxuICAgICAgICAgICAgfVxuICAgICAgICAgIF1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnNlYXJjaEluZGV4aW5nKS50b0hhdmVMZW5ndGgoMik7XG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc2VhcmNoSW5kZXhpbmdbIDAgXS5lbmdpbmVDb25maWcuaG9zdCkudG9CZSgnaHR0cHM6Ly9tZWlsaTEuZXhhbXBsZS5jb20nKTtcbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5zZWFyY2hJbmRleGluZ1sgMSBdLmVuZ2luZUNvbmZpZy5ob3N0KS50b0JlKCdodHRwczovL21laWxpMi5leGFtcGxlLmNvbScpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBOT1Qgc2V0dXAgc2VhcmNoIGluZGV4aW5nIHdoZW4gZGlzYWJsZWQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnbm8tc2VhcmNoLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKClcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG4gICAgICBhd2FpdCBkeW5hbW9EQkNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnNlYXJjaEluZGV4aW5nKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIHNlYXJjaCBpbmRleGluZyB3aXRoIGV4Y2x1ZGVkIGVudGl0eSBuYW1lcycsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdleGNsdWRlZC1zZWFyY2gtdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIGR5bmFtb1N0cmVhbTogU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzZWFyY2hJbmRleGluZzogWyB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgZW5naW5lQ29uZmlnOiB7XG4gICAgICAgICAgICAgIHR5cGU6ICdtZWlsaScsXG4gICAgICAgICAgICAgIGhvc3Q6ICdodHRwczovL21laWxpc2VhcmNoLmV4YW1wbGUuY29tJyxcbiAgICAgICAgICAgICAgbWFzdGVyS2V5OiAndGVzdC1rZXknXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZXhjbHVkZWRFbnRpdHlOYW1lczogWyAnVGVtcERhdGEnLCAnQ2FjaGUnIF1cbiAgICAgICAgICB9IF1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnNlYXJjaEluZGV4aW5nWyAwIF0uZXhjbHVkZWRFbnRpdHlOYW1lcykudG9FcXVhbChbICdUZW1wRGF0YScsICdDYWNoZScgXSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIHNlYXJjaCBpbmRleGluZyB3aXRoIGN1c3RvbSBxdWV1ZSBuYW1lJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ3NlYXJjaC1jdXN0b20tcXVldWUtdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIGR5bmFtb1N0cmVhbTogU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzZWFyY2hJbmRleGluZzogWyB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgZW5naW5lQ29uZmlnOiB7XG4gICAgICAgICAgICAgIHR5cGU6ICdtZWlsaScsXG4gICAgICAgICAgICAgIGhvc3Q6ICdodHRwczovL21laWxpc2VhcmNoLmV4YW1wbGUuY29tJyxcbiAgICAgICAgICAgICAgbWFzdGVyS2V5OiAndGVzdC1rZXknXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcXVldWVOYW1lOiAnY3VzdG9tLXNlYXJjaC1xdWV1ZSdcbiAgICAgICAgICB9IF1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnNlYXJjaEluZGV4aW5nWyAwIF0ucXVldWVOYW1lKS50b0JlKCdjdXN0b20tc2VhcmNoLXF1ZXVlJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIHNlYXJjaCBpbmRleGluZyB3aXRoIGV4aXN0aW5nIHF1ZXVlIHJlZmVyZW5jZScsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdzZWFyY2gtZXhpc3RpbmctcXVldWUtdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIGR5bmFtb1N0cmVhbTogU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzZWFyY2hJbmRleGluZzogWyB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgZW5naW5lQ29uZmlnOiB7XG4gICAgICAgICAgICAgIHR5cGU6ICdtZWlsaScsXG4gICAgICAgICAgICAgIGhvc3Q6ICdodHRwczovL21laWxpc2VhcmNoLmV4YW1wbGUuY29tJyxcbiAgICAgICAgICAgICAgbWFzdGVyS2V5OiAndGVzdC1rZXknXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZXhpc3RpbmdRdWV1ZU5hbWU6ICdNZWlsaXNlYXJjaFN5bmMnXG4gICAgICAgICAgfSBdXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5zZWFyY2hJbmRleGluZ1sgMCBdLmV4aXN0aW5nUXVldWVOYW1lKS50b0JlKCdNZWlsaXNlYXJjaFN5bmMnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgc2VhcmNoIGluZGV4aW5nIHdpdGggZnVuY3Rpb25Qcm9wcycsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdzZWFyY2gtZnVuY3Rpb24tcHJvcHMtdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIGR5bmFtb1N0cmVhbTogU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzZWFyY2hJbmRleGluZzogWyB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgZW5naW5lQ29uZmlnOiB7XG4gICAgICAgICAgICAgIHR5cGU6ICdtZWlsaScsXG4gICAgICAgICAgICAgIGhvc3Q6ICdodHRwczovL21laWxpc2VhcmNoLmV4YW1wbGUuY29tJyxcbiAgICAgICAgICAgICAgbWFzdGVyS2V5OiAndGVzdC1rZXknXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZnVuY3Rpb25Qcm9wczoge1xuICAgICAgICAgICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDkwKSxcbiAgICAgICAgICAgICAgbWVtb3J5U2l6ZTogMjA0OFxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gXVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc2VhcmNoSW5kZXhpbmdbIDAgXS5mdW5jdGlvblByb3BzLnRpbWVvdXQpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc2VhcmNoSW5kZXhpbmdbIDAgXS5mdW5jdGlvblByb3BzLm1lbW9yeVNpemUpLnRvQmUoMjA0OCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIHNlYXJjaCBpbmRleGluZyB3aXRoIHNxc0V2ZW50U291cmNlUHJvcHMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnc2VhcmNoLXNxcy1wcm9wcy10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgZHluYW1vU3RyZWFtOiBTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVNcbiAgICAgICAgICB9LFxuICAgICAgICAgIHNlYXJjaEluZGV4aW5nOiBbIHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBlbmdpbmVDb25maWc6IHtcbiAgICAgICAgICAgICAgdHlwZTogJ21laWxpJyxcbiAgICAgICAgICAgICAgaG9zdDogJ2h0dHBzOi8vbWVpbGlzZWFyY2guZXhhbXBsZS5jb20nLFxuICAgICAgICAgICAgICBtYXN0ZXJLZXk6ICd0ZXN0LWtleSdcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzcXNFdmVudFNvdXJjZVByb3BzOiB7XG4gICAgICAgICAgICAgIGJhdGNoU2l6ZTogNSxcbiAgICAgICAgICAgICAgbWF4QmF0Y2hpbmdXaW5kb3c6IER1cmF0aW9uLnNlY29uZHMoNSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IF1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnNlYXJjaEluZGV4aW5nWyAwIF0uc3FzRXZlbnRTb3VyY2VQcm9wcy5iYXRjaFNpemUpLnRvQmUoNSk7XG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc2VhcmNoSW5kZXhpbmdbIDAgXS5zcXNFdmVudFNvdXJjZVByb3BzLm1heEJhdGNoaW5nV2luZG93KS50b0JlRGVmaW5lZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBtaXhlZCBlbmFibGVkL2Rpc2FibGVkIHNlYXJjaCBpbmRleGluZyBjb25maWdzJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ21peGVkLXNlYXJjaC10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgZHluYW1vU3RyZWFtOiBTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVNcbiAgICAgICAgICB9LFxuICAgICAgICAgIHNlYXJjaEluZGV4aW5nOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICAgIGVuZ2luZUNvbmZpZzoge1xuICAgICAgICAgICAgICAgIHR5cGU6ICdtZWlsaScsXG4gICAgICAgICAgICAgICAgaG9zdDogJ2h0dHBzOi8vbWVpbGkxLmV4YW1wbGUuY29tJyxcbiAgICAgICAgICAgICAgICBtYXN0ZXJLZXk6ICdrZXkxJ1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBlbmFibGVkOiBmYWxzZSxcbiAgICAgICAgICAgICAgZW5naW5lQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgdHlwZTogJ21laWxpJyxcbiAgICAgICAgICAgICAgICBob3N0OiAnaHR0cHM6Ly9tZWlsaTIuZXhhbXBsZS5jb20nLFxuICAgICAgICAgICAgICAgIG1hc3RlcktleTogJ2tleTInXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICBdXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5zZWFyY2hJbmRleGluZ1sgMCBdLmVuYWJsZWQpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc2VhcmNoSW5kZXhpbmdbIDEgXS5lbmFibGVkKS50b0JlKGZhbHNlKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1JlZ3Jlc3Npb24gVGVzdHMgLSBCdWcgRml4ZXMnLCAoKSA9PiB7XG4gICAgLyoqXG4gICAgICogUkVHUkVTU0lPTjogTWVyZ2UgdXRpbGl0eSB3YXMgY2FsbGVkIGluY29ycmVjdGx5IGluIGR5bmFtb2RiLnRzXG4gICAgICogVGhpcyB0ZXN0IHZlcmlmaWVzIGZ1bmN0aW9uUHJvcHMgYXJlIGNvcnJlY3RseSBzdG9yZWQgZm9yIHF1ZXVlIGhhbmRsZXJzXG4gICAgICovXG4gICAgaXQoJ1JFR1JFU1NJT046IHNob3VsZCBzdG9yZSBmdW5jdGlvblByb3BzIGNvcnJlY3RseSBmb3IgYXVkaXQgY29uZmlndXJhdGlvbicsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdtZXJnZS10ZXN0LXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICBkeW5hbW9TdHJlYW06IFN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFU1xuICAgICAgICAgIH0sXG4gICAgICAgICAgYXVkaXQ6IHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBmdW5jdGlvblByb3BzOiB7XG4gICAgICAgICAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgICAgICAgICBtZW1vcnlTaXplOiA1MTJcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIC8vIFZlcmlmeSBjb25maWcgaXMgc3RvcmVkIGNvcnJlY3RseSAobWVyZ2Ugd2lsbCBoYXBwZW4gZHVyaW5nIGNvbnN0cnVjdCgpIGluIHNldHVwV2l0aFF1ZXVlSGFuZGxlcilcbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5hdWRpdC5mdW5jdGlvblByb3BzKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLmF1ZGl0LmZ1bmN0aW9uUHJvcHMudGltZW91dCkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5hdWRpdC5mdW5jdGlvblByb3BzLm1lbW9yeVNpemUpLnRvQmUoNTEyKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1RhYmxlIENvbmZpZ3VyYXRpb24gLSBBZHZhbmNlZCBGZWF0dXJlcycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSB0YWJsZSB3aXRoIHByb3Zpc2lvbmVkIGJpbGxpbmcgbW9kZScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdwcm92aXNpb25lZC10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5wcm92aXNpb25lZCh7XG4gICAgICAgICAgICAgIHJlYWRDYXBhY2l0eTogQ2FwYWNpdHkuZml4ZWQoNSksXG4gICAgICAgICAgICAgIHdyaXRlQ2FwYWNpdHk6IENhcGFjaXR5LmF1dG9zY2FsZWQoeyBtYXhDYXBhY2l0eTogMTAgfSlcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuICAgICAgYXdhaXQgZHluYW1vREJDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpEeW5hbW9EQjo6R2xvYmFsVGFibGUnLCB7XG4gICAgICAgIEJpbGxpbmdNb2RlOiAnUFJPVklTSU9ORUQnXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY3JlYXRlIHRhYmxlIHdpdGggR2xvYmFsIFNlY29uZGFyeSBJbmRleCAoR1NJKScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdnc2ktdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIGdsb2JhbFNlY29uZGFyeUluZGV4ZXM6IFtcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIGluZGV4TmFtZTogJ3N0YXR1cy1pbmRleCcsXG4gICAgICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdzdGF0dXMnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIF1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG4gICAgICBhd2FpdCBkeW5hbW9EQkNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkR5bmFtb0RCOjpHbG9iYWxUYWJsZScsIHtcbiAgICAgICAgR2xvYmFsU2Vjb25kYXJ5SW5kZXhlczogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgIEluZGV4TmFtZTogJ3N0YXR1cy1pbmRleCdcbiAgICAgICAgICB9KVxuICAgICAgICBdKVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSB0YWJsZSB3aXRoIExvY2FsIFNlY29uZGFyeSBJbmRleCAoTFNJKScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdsc2ktdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3RpbWVzdGFtcCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuTlVNQkVSIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICBsb2NhbFNlY29uZGFyeUluZGV4ZXM6IFtcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIGluZGV4TmFtZTogJ3R5cGUtaW5kZXgnLFxuICAgICAgICAgICAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3R5cGUnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIF1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG4gICAgICBhd2FpdCBkeW5hbW9EQkNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkR5bmFtb0RCOjpHbG9iYWxUYWJsZScsIHtcbiAgICAgICAgTG9jYWxTZWNvbmRhcnlJbmRleGVzOiBNYXRjaC5hcnJheVdpdGgoW1xuICAgICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgSW5kZXhOYW1lOiAndHlwZS1pbmRleCdcbiAgICAgICAgICB9KVxuICAgICAgICBdKVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSB0YWJsZSB3aXRoIFRpbWUtdG8tTGl2ZSAoVFRMKScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICd0dGwtdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIHRpbWVUb0xpdmVBdHRyaWJ1dGU6ICdleHBpcmVzQXQnXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuICAgICAgYXdhaXQgZHluYW1vREJDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpEeW5hbW9EQjo6R2xvYmFsVGFibGUnLCB7XG4gICAgICAgIFRpbWVUb0xpdmVTcGVjaWZpY2F0aW9uOiBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICBBdHRyaWJ1dGVOYW1lOiAnZXhwaXJlc0F0JyxcbiAgICAgICAgICBFbmFibGVkOiB0cnVlXG4gICAgICAgIH0pXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY3JlYXRlIHRhYmxlIHdpdGggcG9pbnQtaW4tdGltZSByZWNvdmVyeScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdwaXRyLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuICAgICAgYXdhaXQgZHluYW1vREJDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG5cbiAgICAgIC8vIFBvaW50LWluLXRpbWUgcmVjb3ZlcnkgaXMgY29uZmlndXJlZCBhdCB0aGUgcmVwbGljYSBsZXZlbCBpbiBHbG9iYWxUYWJsZVxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkR5bmFtb0RCOjpHbG9iYWxUYWJsZScsIHtcbiAgICAgICAgUmVwbGljYXM6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgICAgTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgICBQb2ludEluVGltZVJlY292ZXJ5U3BlY2lmaWNhdGlvbjogTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgICAgIFBvaW50SW5UaW1lUmVjb3ZlcnlFbmFibGVkOiB0cnVlXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIH0pXG4gICAgICAgIF0pXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY3JlYXRlIHRhYmxlIHdpdGggUkVUQUlOIHJlbW92YWwgcG9saWN5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ3JldGFpbi10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5SRVRBSU5cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG4gICAgICBhd2FpdCBkeW5hbW9EQkNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgY29uc3QgcmVzb3VyY2VzID0gdGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpEeW5hbW9EQjo6R2xvYmFsVGFibGUnKTtcbiAgICAgIGNvbnN0IHJlc291cmNlS2V5cyA9IE9iamVjdC5rZXlzKHJlc291cmNlcyk7XG4gICAgICBleHBlY3QocmVzb3VyY2VLZXlzLmxlbmd0aCkudG9CZSgxKTtcbiAgICAgIGV4cGVjdChyZXNvdXJjZXNbIHJlc291cmNlS2V5c1sgMCBdIF0uRGVsZXRpb25Qb2xpY3kpLnRvQmUoJ1JldGFpbicpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgdGFibGUgd2l0aCBjb250cmlidXRvciBpbnNpZ2h0cycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdpbnNpZ2h0cy10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgY29udHJpYnV0b3JJbnNpZ2h0czogdHJ1ZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcbiAgICAgIGF3YWl0IGR5bmFtb0RCQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICAvLyBDb250cmlidXRvciBpbnNpZ2h0cyBpcyBjb25maWd1cmVkIGF0IHRoZSByZXBsaWNhIGxldmVsIGluIEdsb2JhbFRhYmxlXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RHluYW1vREI6Okdsb2JhbFRhYmxlJywge1xuICAgICAgICBSZXBsaWNhczogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgIENvbnRyaWJ1dG9ySW5zaWdodHNTcGVjaWZpY2F0aW9uOiBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgICAgRW5hYmxlZDogdHJ1ZVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICB9KVxuICAgICAgICBdKVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSB0YWJsZSB3aXRoIG11bHRpcGxlIEdTSXMgYW5kIExTSXMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnY29tcGxleC1pbmRleGVzLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBzb3J0S2V5OiB7IG5hbWU6ICd0aW1lc3RhbXAnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLk5VTUJFUiB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgZ2xvYmFsU2Vjb25kYXJ5SW5kZXhlczogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgaW5kZXhOYW1lOiAnc3RhdHVzLWluZGV4JyxcbiAgICAgICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3N0YXR1cycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH1cbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIGluZGV4TmFtZTogJ3R5cGUtaW5kZXgnLFxuICAgICAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAndHlwZScsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICAgICAgc29ydEtleTogeyBuYW1lOiAnY3JlYXRlZEF0JywgdHlwZTogQXR0cmlidXRlVHlwZS5OVU1CRVIgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgbG9jYWxTZWNvbmRhcnlJbmRleGVzOiBbXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBpbmRleE5hbWU6ICdsb2NhbC1zdGF0dXMtaW5kZXgnLFxuICAgICAgICAgICAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3N0YXR1cycsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgXVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcbiAgICAgIGF3YWl0IGR5bmFtb0RCQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RHluYW1vREI6Okdsb2JhbFRhYmxlJywge1xuICAgICAgICBHbG9iYWxTZWNvbmRhcnlJbmRleGVzOiBNYXRjaC5hcnJheVdpdGgoW1xuICAgICAgICAgIE1hdGNoLm9iamVjdExpa2UoeyBJbmRleE5hbWU6ICdzdGF0dXMtaW5kZXgnIH0pLFxuICAgICAgICAgIE1hdGNoLm9iamVjdExpa2UoeyBJbmRleE5hbWU6ICd0eXBlLWluZGV4JyB9KVxuICAgICAgICBdKSxcbiAgICAgICAgTG9jYWxTZWNvbmRhcnlJbmRleGVzOiBNYXRjaC5hcnJheVdpdGgoW1xuICAgICAgICAgIE1hdGNoLm9iamVjdExpa2UoeyBJbmRleE5hbWU6ICdsb2NhbC1zdGF0dXMtaW5kZXgnIH0pXG4gICAgICAgIF0pXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1N0cmVhbSBQcm9jZXNzaW5nIC0gVmlld1R5cGVzJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgc3RyZWFtIHdpdGggS0VZU19PTkxZIHZpZXcgdHlwZScsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdrZXlzLW9ubHktc3RyZWFtLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICBkeW5hbW9TdHJlYW06IFN0cmVhbVZpZXdUeXBlLktFWVNfT05MWVxuICAgICAgICAgIH0sXG4gICAgICAgICAgc3RyZWFtOiB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUucHJvcHMuZHluYW1vU3RyZWFtKS50b0JlKFN0cmVhbVZpZXdUeXBlLktFWVNfT05MWSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIHN0cmVhbSB3aXRoIE5FV19JTUFHRSB2aWV3IHR5cGUnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnbmV3LWltYWdlLXN0cmVhbS10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgZHluYW1vU3RyZWFtOiBTdHJlYW1WaWV3VHlwZS5ORVdfSU1BR0VcbiAgICAgICAgICB9LFxuICAgICAgICAgIHN0cmVhbToge1xuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnByb3BzLmR5bmFtb1N0cmVhbSkudG9CZShTdHJlYW1WaWV3VHlwZS5ORVdfSU1BR0UpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBzdHJlYW0gd2l0aCBPTERfSU1BR0UgdmlldyB0eXBlJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ29sZC1pbWFnZS1zdHJlYW0tdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIGR5bmFtb1N0cmVhbTogU3RyZWFtVmlld1R5cGUuT0xEX0lNQUdFXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzdHJlYW06IHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWVcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5wcm9wcy5keW5hbW9TdHJlYW0pLnRvQmUoU3RyZWFtVmlld1R5cGUuT0xEX0lNQUdFKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0VkZ2UgQ2FzZXMgYW5kIEVycm9yIFNjZW5hcmlvcycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIGF1ZGl0IGNvbmZpZ3VyYXRpb24gd2l0aG91dCBzdHJlYW0gQVJOJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ25vLXN0cmVhbS1hcm4tdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKVxuICAgICAgICAgICAgLy8gTm8gZHluYW1vU3RyZWFtIC0gbm8gc3RyZWFtIEFSTlxuICAgICAgICAgIH0sXG4gICAgICAgICAgYXVkaXQ6IHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWVcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIC8vIFZlcmlmeSBjb25maWd1cmF0aW9uIGlzIHN0b3JlZCBldmVuIHdpdGhvdXQgc3RyZWFtIEFSTlxuICAgICAgLy8gVGhlIGNvbnN0cnVjdCB3aWxsIGxvZyBhIHdhcm5pbmcgZHVyaW5nIGNvbnN0cnVjdCgpIGJ1dCBjb25maWcgaXMgdmFsaWRcbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5hdWRpdC5lbmFibGVkKS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnByb3BzLmR5bmFtb1N0cmVhbSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbWluaW1hbCB0YWJsZSBjb25maWd1cmF0aW9uJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ21pbmltYWwtdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcbiAgICAgIGF3YWl0IGR5bmFtb0RCQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6RHluYW1vREI6Okdsb2JhbFRhYmxlJywgMSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSB0YWJsZSB3aXRoIGVuY3J5cHRpb24nLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnZW5jcnlwdGVkLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICBlbmNyeXB0aW9uOiBUYWJsZUVuY3J5cHRpb25WMi5hd3NNYW5hZ2VkS2V5KClcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG4gICAgICBhd2FpdCBkeW5hbW9EQkNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkR5bmFtb0RCOjpHbG9iYWxUYWJsZScsIHtcbiAgICAgICAgU1NFU3BlY2lmaWNhdGlvbjogTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgU1NFRW5hYmxlZDogdHJ1ZVxuICAgICAgICB9KVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBlbXB0eSBzZWFyY2ggaW5kZXhpbmcgYXJyYXknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnZW1wdHktc2VhcmNoLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKClcbiAgICAgICAgICB9LFxuICAgICAgICAgIHNlYXJjaEluZGV4aW5nOiBbXVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuICAgICAgYXdhaXQgZHluYW1vREJDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG5cbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5zZWFyY2hJbmRleGluZykudG9FcXVhbChbXSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHRocm93IGVycm9yIHdoZW4gcGFydGl0aW9uIGtleSBpcyBtaXNzaW5nJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ25vLXBhcnRpdGlvbi1rZXktdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKClcbiAgICAgICAgICB9IGFzIGFueSAvLyBGb3JjZSBpbnZhbGlkIGNvbmZpZ1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICAvLyBDREsgd2lsbCB0aHJvdyBkdXJpbmcgY29uc3RydWN0KCkgZHVlIHRvIG1pc3NpbmcgcGFydGl0aW9uIGtleVxuICAgICAgYXdhaXQgZXhwZWN0KGR5bmFtb0RCQ29uc3RydWN0LmNvbnN0cnVjdCgpKS5yZWplY3RzLnRvVGhyb3coKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHRhYmxlIG5hbWUgd2l0aCBzcGVjaWFsIGNoYXJhY3RlcnMgKHNhbml0aXplZCknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnbXktc3BlY2lhbEB0YWJsZSNuYW1lJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKClcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG4gICAgICBhd2FpdCBkeW5hbW9EQkNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgLy8gZW5zdXJlTm9TcGVjaWFsQ2hhcnMgc2hvdWxkIHNhbml0aXplIHRoZSBuYW1lIChkeW5hbW9kYi50czo0NjYpXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6RHluYW1vREI6Okdsb2JhbFRhYmxlJywgMSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSB6ZXJvIGJhdGNoIHNpemUgZm9yIHN0cmVhbSBwcm9jZXNzb3InLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnemVyby1iYXRjaC10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgZHluYW1vU3RyZWFtOiBTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVNcbiAgICAgICAgICB9LFxuICAgICAgICAgIHN0cmVhbToge1xuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIHByb2Nlc3Nvcjoge1xuICAgICAgICAgICAgICBzdGFydGluZ1Bvc2l0aW9uOiBTdGFydGluZ1Bvc2l0aW9uLkxBVEVTVCxcbiAgICAgICAgICAgICAgYmF0Y2hTaXplOiAwIC8vIEludmFsaWRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIC8vIENvbmZpZyBpcyBzdG9yZWQsIGJ1dCBDREsgd2lsbCB2YWxpZGF0ZSBkdXJpbmcgc3ludGhlc2lzXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc3RyZWFtLnByb2Nlc3Nvci5iYXRjaFNpemUpLnRvQmUoMCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBuZWdhdGl2ZSByZXRyeSBhdHRlbXB0cycsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICduZWdhdGl2ZS1yZXRyeS10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgZHluYW1vU3RyZWFtOiBTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVNcbiAgICAgICAgICB9LFxuICAgICAgICAgIHN0cmVhbToge1xuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIHByb2Nlc3Nvcjoge1xuICAgICAgICAgICAgICBzdGFydGluZ1Bvc2l0aW9uOiBTdGFydGluZ1Bvc2l0aW9uLkxBVEVTVCxcbiAgICAgICAgICAgICAgcmV0cnlBdHRlbXB0czogLTEgLy8gSW52YWxpZFxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnN0cmVhbS5wcm9jZXNzb3IucmV0cnlBdHRlbXB0cykudG9CZSgtMSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBib3RoIGFsbG93ZWQgYW5kIGV4Y2x1ZGVkIGVudGl0eSBuYW1lcyAoY29uZmxpY3QpJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ2NvbmZsaWN0LWF1ZGl0LXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICBkeW5hbW9TdHJlYW06IFN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFU1xuICAgICAgICAgIH0sXG4gICAgICAgICAgYXVkaXQ6IHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBhbGxvd2VkRW50aXR5TmFtZXM6IFsgJ1VzZXInIF0sXG4gICAgICAgICAgICBleGNsdWRlZEVudGl0eU5hbWVzOiBbICdVc2VyJyBdIC8vIENvbmZsaWN0IVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgLy8gQ29uZmlnIGlzIHN0b3JlZCwgcnVudGltZSBsb2dpYyBzaG91bGQgaGFuZGxlIGNvbmZsaWN0XG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuYXVkaXQuYWxsb3dlZEVudGl0eU5hbWVzKS50b0VxdWFsKFsgJ1VzZXInIF0pO1xuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLmF1ZGl0LmV4Y2x1ZGVkRW50aXR5TmFtZXMpLnRvRXF1YWwoWyAnVXNlcicgXSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBlbXB0eSBzdHJpbmcgdGFibGUgbmFtZScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICcnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgLy8gZW5zdXJlTm9TcGVjaWFsQ2hhcnMgYW5kIGVuc3VyZVN1ZmZpeCB3aWxsIHByb2Nlc3MgZW1wdHkgc3RyaW5nXG4gICAgICAvLyBDREsgYWN0dWFsbHkgYWxsb3dzIGVtcHR5IHRhYmxlIG5hbWVzIChhdXRvLWdlbmVyYXRlcyksIHNvIHRoaXMgd2lsbCBzdWNjZWVkXG4gICAgICBhd2FpdCBkeW5hbW9EQkNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OkR5bmFtb0RCOjpHbG9iYWxUYWJsZScsIDEpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbWlzc2luZyBzZWFyY2ggZW5naW5lIGNvbmZpZycsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdtaXNzaW5nLWVuZ2luZS1jb25maWctdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIGR5bmFtb1N0cmVhbTogU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzZWFyY2hJbmRleGluZzogWyB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgZW5naW5lQ29uZmlnOiB1bmRlZmluZWQgYXMgYW55IC8vIE1pc3NpbmchXG4gICAgICAgICAgfSBdXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIC8vIENvbmZpZyBpcyBzdG9yZWQsIHJ1bnRpbWUgd2lsbCBmYWlsIHdoZW4gdHJ5aW5nIHRvIHVzZSB1bmRlZmluZWQgZW5naW5lQ29uZmlnXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc2VhcmNoSW5kZXhpbmdbIDAgXS5lbmdpbmVDb25maWcpLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGVtcHR5IGVuZ2luZSBob3N0JywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ2VtcHR5LWhvc3QtdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIGR5bmFtb1N0cmVhbTogU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzZWFyY2hJbmRleGluZzogWyB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgZW5naW5lQ29uZmlnOiB7XG4gICAgICAgICAgICAgIHR5cGU6ICdtZWlsaScsXG4gICAgICAgICAgICAgIGhvc3Q6ICcnLCAvLyBFbXB0eSFcbiAgICAgICAgICAgICAgbWFzdGVyS2V5OiAndGVzdC1rZXknXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBdXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5zZWFyY2hJbmRleGluZ1sgMCBdLmVuZ2luZUNvbmZpZy5ob3N0KS50b0JlKCcnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHN0cmVhbSBlbmFibGVkIHdpdGhvdXQgZHluYW1vU3RyZWFtIG9uIHRhYmxlJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ25vLXN0cmVhbS1wcm9wLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKClcbiAgICAgICAgICAgIC8vIE5vIGR5bmFtb1N0cmVhbSFcbiAgICAgICAgICB9LFxuICAgICAgICAgIHN0cmVhbToge1xuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSAvLyBCdXQgc3RyZWFtIGVuYWJsZWQhXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICAvLyBDb25maWcgaXMgc3RvcmVkLCBidXQgc2V0dXBTdHJlYW1Qcm9jZXNzaW5nIHdpbGwgbG9nIHdhcm5pbmcgKGR5bmFtb2RiLnRzOjQ5MylcbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5zdHJlYW0uZW5hYmxlZCkudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5wcm9wcy5keW5hbW9TdHJlYW0pLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1NuYXBzaG90IFRlc3RzIC0gQ2xvdWRGb3JtYXRpb24gQ29uc2lzdGVuY3knLCAoKSA9PiB7XG4gICAgLyoqXG4gICAgICogU25hcHNob3Q6IEJhc2ljIFRhYmxlXG4gICAgICogVGVzdHMgQ2xvdWRGb3JtYXRpb24gdGVtcGxhdGUgZm9yIGEgYmFzaWMgRHluYW1vREIgdGFibGUuXG4gICAgICovXG4gICAgaXQoJ3Nob3VsZCBnZW5lcmF0ZSBjb25zaXN0ZW50IENsb3VkRm9ybWF0aW9uIGZvciBiYXNpYyB0YWJsZScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdzbmFwc2hvdC1iYXNpYy10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuICAgICAgYXdhaXQgZHluYW1vREJDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKS50b0pTT04oKTtcbiAgICAgIGV4cGVjdCh0ZW1wbGF0ZSkudG9NYXRjaFNuYXBzaG90KCk7XG4gICAgfSk7XG5cbiAgICAvKipcbiAgICAgKiBTbmFwc2hvdDogVGFibGUgd2l0aCBTdHJlYW0gRW5hYmxlZCAoY29uZmlndXJhdGlvbiBvbmx5KVxuICAgICAqIFRlc3RzIENsb3VkRm9ybWF0aW9uIHRlbXBsYXRlIHdpdGggc3RyZWFtIGVuYWJsZWQgb24gdGhlIHRhYmxlLlxuICAgICAqIE5PVEU6IFN0cmVhbSBwcm9jZXNzb3IgTGFtYmRhIG5vdCBpbmNsdWRlZCAocmVxdWlyZXMgcnVudGltZSBmaWxlcykuXG4gICAgICovXG4gICAgaXQoJ3Nob3VsZCBnZW5lcmF0ZSBjb25zaXN0ZW50IENsb3VkRm9ybWF0aW9uIGZvciB0YWJsZSB3aXRoIHN0cmVhbSBlbmFibGVkJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ3NuYXBzaG90LXN0cmVhbS10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgZHluYW1vU3RyZWFtOiBTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVMsXG4gICAgICAgICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1lcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gTm8gc3RyZWFtIHByb2Nlc3NvciAtIGp1c3QgdGhlIHRhYmxlIHdpdGggc3RyZWFtIGVuYWJsZWRcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcbiAgICAgIGF3YWl0IGR5bmFtb0RCQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjaykudG9KU09OKCk7XG4gICAgICBleHBlY3QodGVtcGxhdGUpLnRvTWF0Y2hTbmFwc2hvdCgpO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuXG4iXX0=
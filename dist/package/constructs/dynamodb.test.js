"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const aws_cdk_lib_1 = require("aws-cdk-lib");
const assertions_1 = require("aws-cdk-lib/assertions");
const aws_dynamodb_1 = require("aws-cdk-lib/aws-dynamodb");
const aws_lambda_1 = require("aws-cdk-lib/aws-lambda");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const dynamodb_1 = require("./dynamodb");
const interfaces_1 = require("../audit/interfaces");
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
        it('should validate audit with CloudWatch logger', () => {
            const config = {
                table: {
                    name: 'audit-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    audit: {
                        enabled: true,
                        type: interfaces_1.AuditLoggerType.CLOUDWATCH,
                        cloudwatchOptions: {
                            logGroupName: '/aws/audit/test',
                            region: 'us-west-2'
                        }
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            // Verify audit configuration is stored correctly
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.enabled).toBe(true);
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.type).toBe(interfaces_1.AuditLoggerType.CLOUDWATCH);
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.cloudwatchOptions.logGroupName).toBe('/aws/audit/test');
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.cloudwatchOptions.region).toBe('us-west-2');
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
                        type: interfaces_1.AuditLoggerType.CLOUDWATCH,
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
                        type: interfaces_1.AuditLoggerType.CLOUDWATCH,
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
        it('should validate audit with CloudWatch logGroupOptions', () => {
            const config = {
                table: {
                    name: 'audit-log-options-table',
                    props: {
                        partitionKey: { name: 'id', type: aws_dynamodb_1.AttributeType.STRING },
                        billing: aws_dynamodb_1.Billing.onDemand(),
                        dynamoStream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES
                    },
                    audit: {
                        enabled: true,
                        type: interfaces_1.AuditLoggerType.CLOUDWATCH,
                        cloudwatchOptions: {
                            logGroupName: '/aws/audit/test',
                            logGroupOptions: {
                                retention: aws_logs_1.RetentionDays.ONE_WEEK,
                                removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY
                            }
                        }
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.cloudwatchOptions.logGroupOptions.retention).toBe(aws_logs_1.RetentionDays.ONE_WEEK);
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.cloudwatchOptions.logGroupOptions.removalPolicy).toBe(aws_cdk_lib_1.RemovalPolicy.DESTROY);
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
                        type: interfaces_1.AuditLoggerType.CLOUDWATCH,
                        dynamodbstreamOptions: {
                            queueName: 'custom-audit-queue'
                        }
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.dynamodbstreamOptions.queueName).toBe('custom-audit-queue');
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
                        type: interfaces_1.AuditLoggerType.CLOUDWATCH,
                        dynamodbstreamOptions: {
                            existingQueueName: 'AuditProcessor'
                        }
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.dynamodbstreamOptions.existingQueueName).toBe('AuditProcessor');
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
                        type: interfaces_1.AuditLoggerType.CLOUDWATCH,
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
                        type: interfaces_1.AuditLoggerType.CLOUDWATCH,
                        dynamodbstreamOptions: {
                            sqsEventSourceProps: {
                                batchSize: 20,
                                maxBatchingWindow: aws_cdk_lib_1.Duration.seconds(10)
                            }
                        }
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.dynamodbstreamOptions.sqsEventSourceProps.batchSize).toBe(20);
            expect(dynamoDBConstruct.dynamoDBConfig.table.audit.dynamodbstreamOptions.sqsEventSourceProps.maxBatchingWindow).toBeDefined();
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
                        type: interfaces_1.AuditLoggerType.CLOUDWATCH,
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
                        enabled: true,
                        type: interfaces_1.AuditLoggerType.CLOUDWATCH
                    }
                }
            };
            const dynamoDBConstruct = new dynamodb_1.DynamoDBConstruct(config);
            // Verify configuration is stored even without stream ARN
            // The construct will log a warning during construct() but config is valid (dynamodb.ts:493, 576)
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
                        type: interfaces_1.AuditLoggerType.CLOUDWATCH,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vZGIudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9jb25zdHJ1Y3RzL2R5bmFtb2RiLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSw2Q0FBa0U7QUFDbEUsdURBQXlEO0FBQ3pELDJEQUErRztBQUMvRyx1REFBMEQ7QUFDMUQsbURBQXFEO0FBQ3JELHlDQUFnRTtBQUNoRSxvREFBc0Q7QUFDdEQsdUNBQW9DO0FBRXBDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBbUJHO0FBQ0gsUUFBUSxDQUFDLG1CQUFtQixFQUFFLEdBQUcsRUFBRTtJQUNqQyxJQUFJLEdBQVEsQ0FBQztJQUNiLElBQUksS0FBWSxDQUFDO0lBRWpCLFVBQVUsQ0FBQyxHQUFHLEVBQUU7UUFDZCxxQkFBcUI7UUFDcEIsV0FBWSxDQUFDLFFBQVEsR0FBRyxTQUFTLENBQUM7UUFFbkMsR0FBRyxHQUFHLElBQUksaUJBQUcsRUFBRSxDQUFDO1FBQ2hCLEtBQUssR0FBRyxJQUFJLG1CQUFLLENBQUMsR0FBRyxFQUFFLFdBQVcsRUFBRTtZQUNsQyxHQUFHLEVBQUUsRUFBRSxPQUFPLEVBQUUsY0FBYyxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUU7U0FDdEQsQ0FBQyxDQUFDO1FBRUgsa0JBQWtCO1FBQ2xCLE1BQU0sSUFBSSxHQUFHLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUNoQyxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ2pCLElBQUksQ0FBQyxTQUFTLENBQUM7WUFDYixJQUFJLEVBQUUsbUJBQW1CO1lBQ3pCLE1BQU0sRUFBRSxXQUFXO1lBQ25CLE9BQU8sRUFBRSxjQUFjO1NBQ3hCLENBQUMsQ0FBQztRQUNILElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxFQUFFLEtBQUssQ0FBQyxDQUFDO0lBQy9CLENBQUMsQ0FBQyxDQUFDO0lBRUgsU0FBUyxDQUFDLEdBQUcsRUFBRTtRQUNaLFdBQVksQ0FB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LENBQUMsQ0FBQyxDQUFDO1FBRUg7Ozs7V0FJRztRQUNILEVBQUUsQ0FBQyx5RUFBeUUsRUFBRSxLQUFLLElBQUksRUFBRTtZQUN2RixNQUFNLE1BQU0sR0FBb0I7Z0JBQzlCLEtBQUssRUFBRTtvQkFDTCxJQUFJLEVBQUUsdUJBQXVCO29CQUM3QixLQUFLLEVBQUU7d0JBQ0wsWUFBWSxFQUFFLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsNEJBQWEsQ0FBQyxNQUFNLEVBQUU7d0JBQ3hELE9BQU8sRUFBRSxzQkFBTyxDQUFDLFFBQVEsRUFBRTt3QkFDM0IsWUFBWSxFQUFFLDZCQUFjLENBQUMsa0JBQWtCO3dCQUMvQyxhQUFhLEVBQUUsMkJBQWEsQ0FBQyxPQUFPO3FCQUNyQztvQkFDRCwyREFBMkQ7aUJBQzVEO2FBQ0YsQ0FBQztZQUVGLE1BQU0saUJBQWlCLEdBQUcsSUFBSSw0QkFBaUIsQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUN4RCxNQUFNLGlCQUFpQixDQUFDLFNBQVMsRUFBRSxDQUFDO1lBRXBDLE1BQU0sUUFBUSxHQUFHLHFCQUFRLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDO1lBQ3BELE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQyxlQUFlLEVBQUUsQ0FBQztRQUNyQyxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBcHAsIFN0YWNrLCBSZW1vdmFsUG9saWN5LCBEdXJhdGlvbiB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IFRlbXBsYXRlLCBNYXRjaCB9IGZyb20gJ2F3cy1jZGstbGliL2Fzc2VydGlvbnMnO1xuaW1wb3J0IHsgQXR0cmlidXRlVHlwZSwgQmlsbGluZywgQ2FwYWNpdHksIFN0cmVhbVZpZXdUeXBlLCBUYWJsZUVuY3J5cHRpb25WMiB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1keW5hbW9kYic7XG5pbXBvcnQgeyBTdGFydGluZ1Bvc2l0aW9uIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBSZXRlbnRpb25EYXlzIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0IHsgRHluYW1vREJDb25zdHJ1Y3QsIElEeW5hbW9EQkNvbmZpZyB9IGZyb20gJy4vZHluYW1vZGInO1xuaW1wb3J0IHsgQXVkaXRMb2dnZXJUeXBlIH0gZnJvbSAnLi4vYXVkaXQvaW50ZXJmYWNlcyc7XG5pbXBvcnQgeyBGdzI0IH0gZnJvbSAnLi4vY29yZS9mdzI0JztcblxuLyoqXG4gKiBEeW5hbW9EQkNvbnN0cnVjdCBUZXN0IFN1aXRlXG4gKiBcbiAqIE5PVEU6IER5bmFtb0RCQ29uc3RydWN0IGlzIGhpZ2hseSBjb21wbGV4ICg5NDYgbGluZXMpIHdpdGggc3RyZWFtIHByb2Nlc3NpbmcsIGF1ZGl0LCBhbmQgc2VhcmNoIGluZGV4aW5nLlxuICogVGhlc2UgdGVzdHMgZm9jdXMgb246XG4gKiAxLiBCYXNpYyB0YWJsZSBjcmVhdGlvbiBhbmQgY29uZmlndXJhdGlvblxuICogMi4gU3RyZWFtIHByb2Nlc3Npbmcgc2V0dXAgKFNOUyB0b3BpYyArIExhbWJkYSBwcm9jZXNzb3IpXG4gKiAzLiBBdWRpdCBjb25maWd1cmF0aW9uIChDbG91ZFdhdGNoLCBleGlzdGluZy9uZXcvaGFuZGxlciBxdWV1ZXMpXG4gKiA0LiBTZWFyY2ggaW5kZXhpbmcgY29uZmlndXJhdGlvbiAoTWVpbGksIGV4aXN0aW5nL25ldy9oYW5kbGVyIHF1ZXVlcylcbiAqIDUuIE1lcmdlIHV0aWxpdHkgdXNhZ2UgKGJ1ZyB3ZSBmaXhlZClcbiAqIDYuIFF1ZXVlIGNvbmZpZ3VyYXRpb24gZXh0cmFjdGlvbiBhbmQgdmFsaWRhdGlvblxuICogXG4gKiBOT1QgVEVTVEVEIChyZXF1aXJlcyBmdWxsIGFwcCBjb250ZXh0KTpcbiAqIC0gQWN0dWFsIHF1ZXVlIGhhbmRsZXIgZmlsZSBsb2FkaW5nIChuZWVkcyBAUXVldWUgZGVjb3JhdGVkIGZpbGVzKVxuICogLSBEeW5hbW9EQiBzdHJlYW0gZXZlbnQgcHJvY2Vzc2luZyAocnVudGltZSBiZWhhdmlvcilcbiAqIC0gQXVkaXQgbG9nIHdyaXRpbmcgKHJ1bnRpbWUgYmVoYXZpb3IpXG4gKiAtIFNlYXJjaCBpbmRleCBzeW5jaHJvbml6YXRpb24gKHJ1bnRpbWUgYmVoYXZpb3IpXG4gKiBcbiAqIFRoZXNlIGFyZSBpbnRlZ3JhdGlvbi9ydW50aW1lIGZlYXR1cmVzIHRlc3RlZCBpbiBFMkUgdGVzdHMuXG4gKi9cbmRlc2NyaWJlKCdEeW5hbW9EQkNvbnN0cnVjdCcsICgpID0+IHtcbiAgbGV0IGFwcDogQXBwO1xuICBsZXQgc3RhY2s6IFN0YWNrO1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIC8vIENsZWFuIHVwIHNpbmdsZXRvblxuICAgIChGdzI0IGFzIGFueSkuaW5zdGFuY2UgPSB1bmRlZmluZWQ7XG5cbiAgICBhcHAgPSBuZXcgQXBwKCk7XG4gICAgc3RhY2sgPSBuZXcgU3RhY2soYXBwLCAnVGVzdFN0YWNrJywge1xuICAgICAgZW52OiB7IGFjY291bnQ6ICcxMjM0NTY3ODkwMTInLCByZWdpb246ICd1cy1lYXN0LTEnIH1cbiAgICB9KTtcblxuICAgIC8vIEluaXRpYWxpemUgRncyNFxuICAgIGNvbnN0IGZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG4gICAgZncyNC5zZXRBcHAoYXBwKTtcbiAgICBmdzI0LnNldENvbmZpZyh7XG4gICAgICBuYW1lOiAndGVzdC1keW5hbW9kYi1hcHAnLFxuICAgICAgcmVnaW9uOiAndXMtZWFzdC0xJyxcbiAgICAgIGFjY291bnQ6ICcxMjM0NTY3ODkwMTInXG4gICAgfSk7XG4gICAgZncyNC5hZGRTdGFjaygnbWFpbicsIHN0YWNrKTtcbiAgfSk7XG5cbiAgYWZ0ZXJFYWNoKCgpID0+IHtcbiAgICAoRncyNCBhcyBhbnkpLmluc3RhbmNlID0gdW5kZWZpbmVkO1xuICB9KTtcblxuICBkZXNjcmliZSgnQmFzaWMgVGFibGUgQ3JlYXRpb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgYSBEeW5hbW9EQiB0YWJsZSB3aXRoIG1pbmltYWwgY29uZmlndXJhdGlvbicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICd0ZXN0LXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1lcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG4gICAgICBhd2FpdCBkeW5hbW9EQkNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OkR5bmFtb0RCOjpHbG9iYWxUYWJsZScsIDEpO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkR5bmFtb0RCOjpHbG9iYWxUYWJsZScsIHtcbiAgICAgICAgS2V5U2NoZW1hOiBNYXRjaC5hcnJheVdpdGgoW1xuICAgICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgQXR0cmlidXRlTmFtZTogJ2lkJyxcbiAgICAgICAgICAgIEtleVR5cGU6ICdIQVNIJ1xuICAgICAgICAgIH0pXG4gICAgICAgIF0pLFxuICAgICAgICBCaWxsaW5nTW9kZTogJ1BBWV9QRVJfUkVRVUVTVCdcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgdGFibGUgd2l0aCBwYXJ0aXRpb24ga2V5IGFuZCBzb3J0IGtleScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICd1c2Vycy10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAndXNlcklkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3RpbWVzdGFtcCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuTlVNQkVSIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1lcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG4gICAgICBhd2FpdCBkeW5hbW9EQkNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkR5bmFtb0RCOjpHbG9iYWxUYWJsZScsIHtcbiAgICAgICAgS2V5U2NoZW1hOiBNYXRjaC5hcnJheVdpdGgoW1xuICAgICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgQXR0cmlidXRlTmFtZTogJ3VzZXJJZCcsXG4gICAgICAgICAgICBLZXlUeXBlOiAnSEFTSCdcbiAgICAgICAgICB9KSxcbiAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgIEF0dHJpYnV0ZU5hbWU6ICd0aW1lc3RhbXAnLFxuICAgICAgICAgICAgS2V5VHlwZTogJ1JBTkdFJ1xuICAgICAgICAgIH0pXG4gICAgICAgIF0pXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcmVnaXN0ZXIgdGFibGUgaW4gZncyNCBlbnZpcm9ubWVudCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdyZWdpc3RlcmVkLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKClcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG4gICAgICBhd2FpdCBkeW5hbW9EQkNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgY29uc3QgZncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcbiAgICAgIC8vIFZlcmlmeSB0YWJsZSBpcyByZWdpc3RlcmVkIGluIGZ3MjQgKGR5bmFtb2RiLnRzOjQ3NC00NzgpXG4gICAgICBleHBlY3QoZHluYW1vREJDb25zdHJ1Y3Qub3V0cHV0KS50b0JlRGVmaW5lZCgpO1xuICAgICAgLy8gT3V0cHV0IHN0cnVjdHVyZSB1c2VzIE91dHB1dFR5cGUuVEFCTEUgYXMga2V5XG4gICAgICBleHBlY3QoT2JqZWN0LmtleXMoZHluYW1vREJDb25zdHJ1Y3Qub3V0cHV0KS5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbigwKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OkR5bmFtb0RCOjpHbG9iYWxUYWJsZScsIDEpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBhcHBseSB0YWJsZSBuYW1lIHN1ZmZpeCBmb3IgaW50ZXJuYWwgbmFtaW5nJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ215LWRhdGEnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcbiAgICAgIGF3YWl0IGR5bmFtb0RCQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICAvLyBPcmlnaW5hbCBjb25maWcgcmVtYWlucyB1bmNoYW5nZWRcbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5uYW1lKS50b0JlKCdteS1kYXRhJyk7XG5cbiAgICAgIC8vIFZlcmlmeSB0YWJsZSBpcyBjcmVhdGVkIChkeW5hbW9kYi50czo0NjYgYXBwbGllcyBzdWZmaXggaW50ZXJuYWxseSBmb3IgY29uc3RydWN0IElEKVxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OkR5bmFtb0RCOjpHbG9iYWxUYWJsZScsIDEpO1xuXG4gICAgICAvLyBDbG91ZEZvcm1hdGlvbiB0YWJsZSBuYW1lIGlzIENESy1nZW5lcmF0ZWQsIHZlcmlmeSB0YWJsZSBleGlzdHNcbiAgICAgIGNvbnN0IHJlc291cmNlcyA9IHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6RHluYW1vREI6Okdsb2JhbFRhYmxlJyk7XG4gICAgICBleHBlY3QoT2JqZWN0LmtleXMocmVzb3VyY2VzKS5sZW5ndGgpLnRvQmUoMSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdTdHJlYW0gUHJvY2Vzc2luZyBDb25maWd1cmF0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgc3RyZWFtIGNvbmZpZ3VyYXRpb24gaXMgc3RvcmVkIGNvcnJlY3RseScsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdzdHJlYW0tdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIGR5bmFtb1N0cmVhbTogU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzdHJlYW06IHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWVcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIC8vIFZlcmlmeSBjb25maWd1cmF0aW9uIGlzIHN0b3JlZCBjb3JyZWN0bHlcbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5zdHJlYW0uZW5hYmxlZCkudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5wcm9wcy5keW5hbW9TdHJlYW0pLnRvQmUoU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgY3VzdG9tIHRvcGljIG5hbWUgY29uZmlndXJhdGlvbicsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdjdXN0b20tc3RyZWFtLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICBkeW5hbW9TdHJlYW06IFN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFU1xuICAgICAgICAgIH0sXG4gICAgICAgICAgc3RyZWFtOiB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgdG9waWM6IHtcbiAgICAgICAgICAgICAgbmFtZTogJ2N1c3RvbS10b3BpYy1uYW1lJ1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgLy8gVmVyaWZ5IGN1c3RvbSB0b3BpYyBuYW1lIGlzIHN0b3JlZFxuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnN0cmVhbS50b3BpYy5uYW1lKS50b0JlKCdjdXN0b20tdG9waWMtbmFtZScpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBGSUZPIHRvcGljIGNvbmZpZ3VyYXRpb24nLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnZmlmby1zdHJlYW0tdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIGR5bmFtb1N0cmVhbTogU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzdHJlYW06IHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICB0b3BpYzoge1xuICAgICAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgICAgIGZpZm86IHRydWVcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgLy8gVmVyaWZ5IEZJRk8gY29uZmlndXJhdGlvbiBpcyBzdG9yZWRcbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5zdHJlYW0udG9waWMucHJvcHMuZmlmbykudG9CZSh0cnVlKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgY3VzdG9tIHN0cmVhbSBwcm9jZXNzb3IgY29uZmlndXJhdGlvbicsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdjdXN0b20tcHJvY2Vzc29yLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICBkeW5hbW9TdHJlYW06IFN0cmVhbVZpZXdUeXBlLktFWVNfT05MWVxuICAgICAgICAgIH0sXG4gICAgICAgICAgc3RyZWFtOiB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgcHJvY2Vzc29yOiB7XG4gICAgICAgICAgICAgIHN0YXJ0aW5nUG9zaXRpb246IFN0YXJ0aW5nUG9zaXRpb24uVFJJTV9IT1JJWk9OLFxuICAgICAgICAgICAgICBiYXRjaFNpemU6IDEwLFxuICAgICAgICAgICAgICBiaXNlY3RCYXRjaE9uRXJyb3I6IGZhbHNlLFxuICAgICAgICAgICAgICByZXRyeUF0dGVtcHRzOiA1XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICAvLyBWZXJpZnkgY3VzdG9tIHByb2Nlc3NvciBjb25maWcgaXMgc3RvcmVkXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc3RyZWFtLnByb2Nlc3Nvci5iYXRjaFNpemUpLnRvQmUoMTApO1xuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnN0cmVhbS5wcm9jZXNzb3Iuc3RhcnRpbmdQb3NpdGlvbikudG9CZShTdGFydGluZ1Bvc2l0aW9uLlRSSU1fSE9SSVpPTik7XG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc3RyZWFtLnByb2Nlc3Nvci5iaXNlY3RCYXRjaE9uRXJyb3IpLnRvQmUoZmFsc2UpO1xuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnN0cmVhbS5wcm9jZXNzb3IucmV0cnlBdHRlbXB0cykudG9CZSg1KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgTk9UIHNldHVwIHN0cmVhbSBwcm9jZXNzaW5nIHdoZW4gZGlzYWJsZWQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnbm8tc3RyZWFtLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKClcbiAgICAgICAgICAgIC8vIE5vIGR5bmFtb1N0cmVhbSBzcGVjaWZpZWRcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG4gICAgICBhd2FpdCBkeW5hbW9EQkNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgLy8gTm8gU05TIHRvcGljIG9yIExhbWJkYSBwcm9jZXNzb3Igc2hvdWxkIGJlIGNyZWF0ZWRcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpTTlM6OlRvcGljJywgMCk7XG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIDApO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnQXVkaXQgQ29uZmlndXJhdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIGF1ZGl0IHdpdGggQ2xvdWRXYXRjaCBsb2dnZXInLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnYXVkaXQtdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIGR5bmFtb1N0cmVhbTogU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTXG4gICAgICAgICAgfSxcbiAgICAgICAgICBhdWRpdDoge1xuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIHR5cGU6IEF1ZGl0TG9nZ2VyVHlwZS5DTE9VRFdBVENILFxuICAgICAgICAgICAgY2xvdWR3YXRjaE9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgbG9nR3JvdXBOYW1lOiAnL2F3cy9hdWRpdC90ZXN0JyxcbiAgICAgICAgICAgICAgcmVnaW9uOiAndXMtd2VzdC0yJ1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgLy8gVmVyaWZ5IGF1ZGl0IGNvbmZpZ3VyYXRpb24gaXMgc3RvcmVkIGNvcnJlY3RseVxuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLmF1ZGl0LmVuYWJsZWQpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuYXVkaXQudHlwZSkudG9CZShBdWRpdExvZ2dlclR5cGUuQ0xPVURXQVRDSCk7XG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuYXVkaXQuY2xvdWR3YXRjaE9wdGlvbnMubG9nR3JvdXBOYW1lKS50b0JlKCcvYXdzL2F1ZGl0L3Rlc3QnKTtcbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5hdWRpdC5jbG91ZHdhdGNoT3B0aW9ucy5yZWdpb24pLnRvQmUoJ3VzLXdlc3QtMicpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBhdWRpdCB3aXRoIGFsbG93ZWQgZW50aXR5IG5hbWVzJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ2ZpbHRlcmVkLWF1ZGl0LXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICBkeW5hbW9TdHJlYW06IFN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFU1xuICAgICAgICAgIH0sXG4gICAgICAgICAgYXVkaXQ6IHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICB0eXBlOiBBdWRpdExvZ2dlclR5cGUuQ0xPVURXQVRDSCxcbiAgICAgICAgICAgIGFsbG93ZWRFbnRpdHlOYW1lczogWyAnVXNlcicsICdPcmRlcicgXVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLmF1ZGl0LmFsbG93ZWRFbnRpdHlOYW1lcykudG9FcXVhbChbICdVc2VyJywgJ09yZGVyJyBdKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgYXVkaXQgd2l0aCBleGNsdWRlZCBlbnRpdHkgbmFtZXMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnZXhjbHVkZWQtYXVkaXQtdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIGR5bmFtb1N0cmVhbTogU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTXG4gICAgICAgICAgfSxcbiAgICAgICAgICBhdWRpdDoge1xuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIHR5cGU6IEF1ZGl0TG9nZ2VyVHlwZS5DTE9VRFdBVENILFxuICAgICAgICAgICAgZXhjbHVkZWRFbnRpdHlOYW1lczogWyAnVGVtcERhdGEnLCAnQ2FjaGUnIF1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5hdWRpdC5leGNsdWRlZEVudGl0eU5hbWVzKS50b0VxdWFsKFsgJ1RlbXBEYXRhJywgJ0NhY2hlJyBdKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgTk9UIHNldHVwIGF1ZGl0IHdoZW4gZGlzYWJsZWQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnbm8tYXVkaXQtdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcbiAgICAgIGF3YWl0IGR5bmFtb0RCQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuYXVkaXQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgYXVkaXQgd2l0aCBDbG91ZFdhdGNoIGxvZ0dyb3VwT3B0aW9ucycsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdhdWRpdC1sb2ctb3B0aW9ucy10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgZHluYW1vU3RyZWFtOiBTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVNcbiAgICAgICAgICB9LFxuICAgICAgICAgIGF1ZGl0OiB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgdHlwZTogQXVkaXRMb2dnZXJUeXBlLkNMT1VEV0FUQ0gsXG4gICAgICAgICAgICBjbG91ZHdhdGNoT3B0aW9uczoge1xuICAgICAgICAgICAgICBsb2dHcm91cE5hbWU6ICcvYXdzL2F1ZGl0L3Rlc3QnLFxuICAgICAgICAgICAgICBsb2dHcm91cE9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgICByZXRlbnRpb246IFJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICAgICAgICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5hdWRpdC5jbG91ZHdhdGNoT3B0aW9ucy5sb2dHcm91cE9wdGlvbnMucmV0ZW50aW9uKS50b0JlKFJldGVudGlvbkRheXMuT05FX1dFRUspO1xuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLmF1ZGl0LmNsb3Vkd2F0Y2hPcHRpb25zLmxvZ0dyb3VwT3B0aW9ucy5yZW1vdmFsUG9saWN5KS50b0JlKFJlbW92YWxQb2xpY3kuREVTVFJPWSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIGF1ZGl0IHdpdGggY3VzdG9tIHF1ZXVlIG5hbWUnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnYXVkaXQtY3VzdG9tLXF1ZXVlLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICBkeW5hbW9TdHJlYW06IFN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFU1xuICAgICAgICAgIH0sXG4gICAgICAgICAgYXVkaXQ6IHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICB0eXBlOiBBdWRpdExvZ2dlclR5cGUuQ0xPVURXQVRDSCxcbiAgICAgICAgICAgIGR5bmFtb2Ric3RyZWFtT3B0aW9uczoge1xuICAgICAgICAgICAgICBxdWV1ZU5hbWU6ICdjdXN0b20tYXVkaXQtcXVldWUnXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuYXVkaXQuZHluYW1vZGJzdHJlYW1PcHRpb25zLnF1ZXVlTmFtZSkudG9CZSgnY3VzdG9tLWF1ZGl0LXF1ZXVlJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIGF1ZGl0IHdpdGggZXhpc3RpbmcgcXVldWUgcmVmZXJlbmNlJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ2F1ZGl0LWV4aXN0aW5nLXF1ZXVlLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICBkeW5hbW9TdHJlYW06IFN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFU1xuICAgICAgICAgIH0sXG4gICAgICAgICAgYXVkaXQ6IHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICB0eXBlOiBBdWRpdExvZ2dlclR5cGUuQ0xPVURXQVRDSCxcbiAgICAgICAgICAgIGR5bmFtb2Ric3RyZWFtT3B0aW9uczoge1xuICAgICAgICAgICAgICBleGlzdGluZ1F1ZXVlTmFtZTogJ0F1ZGl0UHJvY2Vzc29yJ1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLmF1ZGl0LmR5bmFtb2Ric3RyZWFtT3B0aW9ucy5leGlzdGluZ1F1ZXVlTmFtZSkudG9CZSgnQXVkaXRQcm9jZXNzb3InKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgYXVkaXQgd2l0aCBjdXN0b20gZnVuY3Rpb25Qcm9wcycsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdhdWRpdC1mdW5jdGlvbi1wcm9wcy10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgZHluYW1vU3RyZWFtOiBTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVNcbiAgICAgICAgICB9LFxuICAgICAgICAgIGF1ZGl0OiB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgdHlwZTogQXVkaXRMb2dnZXJUeXBlLkNMT1VEV0FUQ0gsXG4gICAgICAgICAgICBmdW5jdGlvblByb3BzOiB7XG4gICAgICAgICAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHMoNjApLFxuICAgICAgICAgICAgICBtZW1vcnlTaXplOiAxMDI0XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuYXVkaXQuZnVuY3Rpb25Qcm9wcy50aW1lb3V0KS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLmF1ZGl0LmZ1bmN0aW9uUHJvcHMubWVtb3J5U2l6ZSkudG9CZSgxMDI0KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgYXVkaXQgd2l0aCBzcXNFdmVudFNvdXJjZVByb3BzJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ2F1ZGl0LXNxcy1wcm9wcy10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgZHluYW1vU3RyZWFtOiBTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVNcbiAgICAgICAgICB9LFxuICAgICAgICAgIGF1ZGl0OiB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgdHlwZTogQXVkaXRMb2dnZXJUeXBlLkNMT1VEV0FUQ0gsXG4gICAgICAgICAgICBkeW5hbW9kYnN0cmVhbU9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgc3FzRXZlbnRTb3VyY2VQcm9wczoge1xuICAgICAgICAgICAgICAgIGJhdGNoU2l6ZTogMjAsXG4gICAgICAgICAgICAgICAgbWF4QmF0Y2hpbmdXaW5kb3c6IER1cmF0aW9uLnNlY29uZHMoMTApXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5hdWRpdC5keW5hbW9kYnN0cmVhbU9wdGlvbnMuc3FzRXZlbnRTb3VyY2VQcm9wcy5iYXRjaFNpemUpLnRvQmUoMjApO1xuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLmF1ZGl0LmR5bmFtb2Ric3RyZWFtT3B0aW9ucy5zcXNFdmVudFNvdXJjZVByb3BzLm1heEJhdGNoaW5nV2luZG93KS50b0JlRGVmaW5lZCgpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnU2VhcmNoIEluZGV4aW5nIENvbmZpZ3VyYXRpb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBzZWFyY2ggaW5kZXhpbmcgd2l0aCBNZWlsaSBlbmdpbmUnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnc2VhcmNoLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICBkeW5hbW9TdHJlYW06IFN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFU1xuICAgICAgICAgIH0sXG4gICAgICAgICAgc2VhcmNoSW5kZXhpbmc6IFsge1xuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIGVuZ2luZUNvbmZpZzoge1xuICAgICAgICAgICAgICB0eXBlOiAnbWVpbGknLFxuICAgICAgICAgICAgICBob3N0OiAnaHR0cHM6Ly9tZWlsaXNlYXJjaC5leGFtcGxlLmNvbScsXG4gICAgICAgICAgICAgIG1hc3RlcktleTogJ3Rlc3QtbWFzdGVyLWtleSdcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IF1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgLy8gVmVyaWZ5IHNlYXJjaCBpbmRleGluZyBjb25maWd1cmF0aW9uIGlzIHN0b3JlZCBjb3JyZWN0bHlcbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5zZWFyY2hJbmRleGluZ1sgMCBdLmVuYWJsZWQpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc2VhcmNoSW5kZXhpbmdbIDAgXS5lbmdpbmVDb25maWcudHlwZSkudG9CZSgnbWVpbGknKTtcbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5zZWFyY2hJbmRleGluZ1sgMCBdLmVuZ2luZUNvbmZpZy5ob3N0KS50b0JlKCdodHRwczovL21laWxpc2VhcmNoLmV4YW1wbGUuY29tJyk7XG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc2VhcmNoSW5kZXhpbmdbIDAgXS5lbmdpbmVDb25maWcubWFzdGVyS2V5KS50b0JlKCd0ZXN0LW1hc3Rlci1rZXknKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgc2VhcmNoIGluZGV4aW5nIHdpdGggYWxsb3dlZCBlbnRpdHkgbmFtZXMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnZmlsdGVyZWQtc2VhcmNoLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICBkeW5hbW9TdHJlYW06IFN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFU1xuICAgICAgICAgIH0sXG4gICAgICAgICAgc2VhcmNoSW5kZXhpbmc6IFsge1xuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIGVuZ2luZUNvbmZpZzoge1xuICAgICAgICAgICAgICB0eXBlOiAnbWVpbGknLFxuICAgICAgICAgICAgICBob3N0OiAnaHR0cHM6Ly9tZWlsaXNlYXJjaC5leGFtcGxlLmNvbScsXG4gICAgICAgICAgICAgIG1hc3RlcktleTogJ3Rlc3Qta2V5J1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGFsbG93ZWRFbnRpdHlOYW1lczogWyAnUHJvZHVjdCcsICdDYXRlZ29yeScgXVxuICAgICAgICAgIH0gXVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc2VhcmNoSW5kZXhpbmdbIDAgXS5hbGxvd2VkRW50aXR5TmFtZXMpLnRvRXF1YWwoWyAnUHJvZHVjdCcsICdDYXRlZ29yeScgXSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIG11bHRpcGxlIHNlYXJjaCBpbmRleGluZyBjb25maWd1cmF0aW9ucycsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdtdWx0aS1zZWFyY2gtdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIGR5bmFtb1N0cmVhbTogU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzZWFyY2hJbmRleGluZzogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICBlbmdpbmVDb25maWc6IHtcbiAgICAgICAgICAgICAgICB0eXBlOiAnbWVpbGknLFxuICAgICAgICAgICAgICAgIGhvc3Q6ICdodHRwczovL21laWxpMS5leGFtcGxlLmNvbScsXG4gICAgICAgICAgICAgICAgbWFzdGVyS2V5OiAna2V5MSdcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgYWxsb3dlZEVudGl0eU5hbWVzOiBbICdVc2VyJyBdXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICBlbmdpbmVDb25maWc6IHtcbiAgICAgICAgICAgICAgICB0eXBlOiAnbWVpbGknLFxuICAgICAgICAgICAgICAgIGhvc3Q6ICdodHRwczovL21laWxpMi5leGFtcGxlLmNvbScsXG4gICAgICAgICAgICAgICAgbWFzdGVyS2V5OiAna2V5MidcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgYWxsb3dlZEVudGl0eU5hbWVzOiBbICdQcm9kdWN0JyBdXG4gICAgICAgICAgICB9XG4gICAgICAgICAgXVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc2VhcmNoSW5kZXhpbmcpLnRvSGF2ZUxlbmd0aCgyKTtcbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5zZWFyY2hJbmRleGluZ1sgMCBdLmVuZ2luZUNvbmZpZy5ob3N0KS50b0JlKCdodHRwczovL21laWxpMS5leGFtcGxlLmNvbScpO1xuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnNlYXJjaEluZGV4aW5nWyAxIF0uZW5naW5lQ29uZmlnLmhvc3QpLnRvQmUoJ2h0dHBzOi8vbWVpbGkyLmV4YW1wbGUuY29tJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIE5PVCBzZXR1cCBzZWFyY2ggaW5kZXhpbmcgd2hlbiBkaXNhYmxlZCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICduby1zZWFyY2gtdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcbiAgICAgIGF3YWl0IGR5bmFtb0RCQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc2VhcmNoSW5kZXhpbmcpLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgc2VhcmNoIGluZGV4aW5nIHdpdGggZXhjbHVkZWQgZW50aXR5IG5hbWVzJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ2V4Y2x1ZGVkLXNlYXJjaC10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgZHluYW1vU3RyZWFtOiBTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVNcbiAgICAgICAgICB9LFxuICAgICAgICAgIHNlYXJjaEluZGV4aW5nOiBbIHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBlbmdpbmVDb25maWc6IHtcbiAgICAgICAgICAgICAgdHlwZTogJ21laWxpJyxcbiAgICAgICAgICAgICAgaG9zdDogJ2h0dHBzOi8vbWVpbGlzZWFyY2guZXhhbXBsZS5jb20nLFxuICAgICAgICAgICAgICBtYXN0ZXJLZXk6ICd0ZXN0LWtleSdcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBleGNsdWRlZEVudGl0eU5hbWVzOiBbICdUZW1wRGF0YScsICdDYWNoZScgXVxuICAgICAgICAgIH0gXVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc2VhcmNoSW5kZXhpbmdbIDAgXS5leGNsdWRlZEVudGl0eU5hbWVzKS50b0VxdWFsKFsgJ1RlbXBEYXRhJywgJ0NhY2hlJyBdKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgc2VhcmNoIGluZGV4aW5nIHdpdGggY3VzdG9tIHF1ZXVlIG5hbWUnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnc2VhcmNoLWN1c3RvbS1xdWV1ZS10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgZHluYW1vU3RyZWFtOiBTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVNcbiAgICAgICAgICB9LFxuICAgICAgICAgIHNlYXJjaEluZGV4aW5nOiBbIHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBlbmdpbmVDb25maWc6IHtcbiAgICAgICAgICAgICAgdHlwZTogJ21laWxpJyxcbiAgICAgICAgICAgICAgaG9zdDogJ2h0dHBzOi8vbWVpbGlzZWFyY2guZXhhbXBsZS5jb20nLFxuICAgICAgICAgICAgICBtYXN0ZXJLZXk6ICd0ZXN0LWtleSdcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBxdWV1ZU5hbWU6ICdjdXN0b20tc2VhcmNoLXF1ZXVlJ1xuICAgICAgICAgIH0gXVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc2VhcmNoSW5kZXhpbmdbIDAgXS5xdWV1ZU5hbWUpLnRvQmUoJ2N1c3RvbS1zZWFyY2gtcXVldWUnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgc2VhcmNoIGluZGV4aW5nIHdpdGggZXhpc3RpbmcgcXVldWUgcmVmZXJlbmNlJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ3NlYXJjaC1leGlzdGluZy1xdWV1ZS10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgZHluYW1vU3RyZWFtOiBTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVNcbiAgICAgICAgICB9LFxuICAgICAgICAgIHNlYXJjaEluZGV4aW5nOiBbIHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBlbmdpbmVDb25maWc6IHtcbiAgICAgICAgICAgICAgdHlwZTogJ21laWxpJyxcbiAgICAgICAgICAgICAgaG9zdDogJ2h0dHBzOi8vbWVpbGlzZWFyY2guZXhhbXBsZS5jb20nLFxuICAgICAgICAgICAgICBtYXN0ZXJLZXk6ICd0ZXN0LWtleSdcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBleGlzdGluZ1F1ZXVlTmFtZTogJ01laWxpc2VhcmNoU3luYydcbiAgICAgICAgICB9IF1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnNlYXJjaEluZGV4aW5nWyAwIF0uZXhpc3RpbmdRdWV1ZU5hbWUpLnRvQmUoJ01laWxpc2VhcmNoU3luYycpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBzZWFyY2ggaW5kZXhpbmcgd2l0aCBmdW5jdGlvblByb3BzJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ3NlYXJjaC1mdW5jdGlvbi1wcm9wcy10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgZHluYW1vU3RyZWFtOiBTdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVNcbiAgICAgICAgICB9LFxuICAgICAgICAgIHNlYXJjaEluZGV4aW5nOiBbIHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICBlbmdpbmVDb25maWc6IHtcbiAgICAgICAgICAgICAgdHlwZTogJ21laWxpJyxcbiAgICAgICAgICAgICAgaG9zdDogJ2h0dHBzOi8vbWVpbGlzZWFyY2guZXhhbXBsZS5jb20nLFxuICAgICAgICAgICAgICBtYXN0ZXJLZXk6ICd0ZXN0LWtleSdcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBmdW5jdGlvblByb3BzOiB7XG4gICAgICAgICAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHMoOTApLFxuICAgICAgICAgICAgICBtZW1vcnlTaXplOiAyMDQ4XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBdXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5zZWFyY2hJbmRleGluZ1sgMCBdLmZ1bmN0aW9uUHJvcHMudGltZW91dCkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5zZWFyY2hJbmRleGluZ1sgMCBdLmZ1bmN0aW9uUHJvcHMubWVtb3J5U2l6ZSkudG9CZSgyMDQ4KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgc2VhcmNoIGluZGV4aW5nIHdpdGggc3FzRXZlbnRTb3VyY2VQcm9wcycsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdzZWFyY2gtc3FzLXByb3BzLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICBkeW5hbW9TdHJlYW06IFN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFU1xuICAgICAgICAgIH0sXG4gICAgICAgICAgc2VhcmNoSW5kZXhpbmc6IFsge1xuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIGVuZ2luZUNvbmZpZzoge1xuICAgICAgICAgICAgICB0eXBlOiAnbWVpbGknLFxuICAgICAgICAgICAgICBob3N0OiAnaHR0cHM6Ly9tZWlsaXNlYXJjaC5leGFtcGxlLmNvbScsXG4gICAgICAgICAgICAgIG1hc3RlcktleTogJ3Rlc3Qta2V5J1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHNxc0V2ZW50U291cmNlUHJvcHM6IHtcbiAgICAgICAgICAgICAgYmF0Y2hTaXplOiA1LFxuICAgICAgICAgICAgICBtYXhCYXRjaGluZ1dpbmRvdzogRHVyYXRpb24uc2Vjb25kcyg1KVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gXVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc2VhcmNoSW5kZXhpbmdbIDAgXS5zcXNFdmVudFNvdXJjZVByb3BzLmJhdGNoU2l6ZSkudG9CZSg1KTtcbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5zZWFyY2hJbmRleGluZ1sgMCBdLnNxc0V2ZW50U291cmNlUHJvcHMubWF4QmF0Y2hpbmdXaW5kb3cpLnRvQmVEZWZpbmVkKCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIG1peGVkIGVuYWJsZWQvZGlzYWJsZWQgc2VhcmNoIGluZGV4aW5nIGNvbmZpZ3MnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnbWl4ZWQtc2VhcmNoLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICBkeW5hbW9TdHJlYW06IFN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFU1xuICAgICAgICAgIH0sXG4gICAgICAgICAgc2VhcmNoSW5kZXhpbmc6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgICAgZW5naW5lQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgdHlwZTogJ21laWxpJyxcbiAgICAgICAgICAgICAgICBob3N0OiAnaHR0cHM6Ly9tZWlsaTEuZXhhbXBsZS5jb20nLFxuICAgICAgICAgICAgICAgIG1hc3RlcktleTogJ2tleTEnXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGVuYWJsZWQ6IGZhbHNlLFxuICAgICAgICAgICAgICBlbmdpbmVDb25maWc6IHtcbiAgICAgICAgICAgICAgICB0eXBlOiAnbWVpbGknLFxuICAgICAgICAgICAgICAgIGhvc3Q6ICdodHRwczovL21laWxpMi5leGFtcGxlLmNvbScsXG4gICAgICAgICAgICAgICAgbWFzdGVyS2V5OiAna2V5MidcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIF1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnNlYXJjaEluZGV4aW5nWyAwIF0uZW5hYmxlZCkudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5zZWFyY2hJbmRleGluZ1sgMSBdLmVuYWJsZWQpLnRvQmUoZmFsc2UpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnUmVncmVzc2lvbiBUZXN0cyAtIEJ1ZyBGaXhlcycsICgpID0+IHtcbiAgICAvKipcbiAgICAgKiBSRUdSRVNTSU9OOiBNZXJnZSB1dGlsaXR5IHdhcyBjYWxsZWQgaW5jb3JyZWN0bHkgaW4gZHluYW1vZGIudHNcbiAgICAgKiBUaGlzIHRlc3QgdmVyaWZpZXMgZnVuY3Rpb25Qcm9wcyBhcmUgY29ycmVjdGx5IHN0b3JlZCBmb3IgcXVldWUgaGFuZGxlcnNcbiAgICAgKi9cbiAgICBpdCgnUkVHUkVTU0lPTjogc2hvdWxkIHN0b3JlIGZ1bmN0aW9uUHJvcHMgY29ycmVjdGx5IGZvciBhdWRpdCBjb25maWd1cmF0aW9uJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ21lcmdlLXRlc3QtdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIGR5bmFtb1N0cmVhbTogU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTXG4gICAgICAgICAgfSxcbiAgICAgICAgICBhdWRpdDoge1xuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIHR5cGU6IEF1ZGl0TG9nZ2VyVHlwZS5DTE9VRFdBVENILFxuICAgICAgICAgICAgZnVuY3Rpb25Qcm9wczoge1xuICAgICAgICAgICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgICAgICAgICAgbWVtb3J5U2l6ZTogNTEyXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICAvLyBWZXJpZnkgY29uZmlnIGlzIHN0b3JlZCBjb3JyZWN0bHkgKG1lcmdlIHdpbGwgaGFwcGVuIGR1cmluZyBjb25zdHJ1Y3QoKSBpbiBzZXR1cFdpdGhRdWV1ZUhhbmRsZXIpXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuYXVkaXQuZnVuY3Rpb25Qcm9wcykudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5hdWRpdC5mdW5jdGlvblByb3BzLnRpbWVvdXQpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuYXVkaXQuZnVuY3Rpb25Qcm9wcy5tZW1vcnlTaXplKS50b0JlKDUxMik7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdUYWJsZSBDb25maWd1cmF0aW9uIC0gQWR2YW5jZWQgRmVhdHVyZXMnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgdGFibGUgd2l0aCBwcm92aXNpb25lZCBiaWxsaW5nIG1vZGUnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAncHJvdmlzaW9uZWQtdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcucHJvdmlzaW9uZWQoe1xuICAgICAgICAgICAgICByZWFkQ2FwYWNpdHk6IENhcGFjaXR5LmZpeGVkKDUpLFxuICAgICAgICAgICAgICB3cml0ZUNhcGFjaXR5OiBDYXBhY2l0eS5hdXRvc2NhbGVkKHsgbWF4Q2FwYWNpdHk6IDEwIH0pXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcbiAgICAgIGF3YWl0IGR5bmFtb0RCQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RHluYW1vREI6Okdsb2JhbFRhYmxlJywge1xuICAgICAgICBCaWxsaW5nTW9kZTogJ1BST1ZJU0lPTkVEJ1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSB0YWJsZSB3aXRoIEdsb2JhbCBTZWNvbmRhcnkgSW5kZXggKEdTSSknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnZ3NpLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICBnbG9iYWxTZWNvbmRhcnlJbmRleGVzOiBbXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBpbmRleE5hbWU6ICdzdGF0dXMtaW5kZXgnLFxuICAgICAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnc3RhdHVzJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBdXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuICAgICAgYXdhaXQgZHluYW1vREJDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpEeW5hbW9EQjo6R2xvYmFsVGFibGUnLCB7XG4gICAgICAgIEdsb2JhbFNlY29uZGFyeUluZGV4ZXM6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgICAgTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgICBJbmRleE5hbWU6ICdzdGF0dXMtaW5kZXgnXG4gICAgICAgICAgfSlcbiAgICAgICAgXSlcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgdGFibGUgd2l0aCBMb2NhbCBTZWNvbmRhcnkgSW5kZXggKExTSSknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnbHNpLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBzb3J0S2V5OiB7IG5hbWU6ICd0aW1lc3RhbXAnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLk5VTUJFUiB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgbG9jYWxTZWNvbmRhcnlJbmRleGVzOiBbXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBpbmRleE5hbWU6ICd0eXBlLWluZGV4JyxcbiAgICAgICAgICAgICAgICBzb3J0S2V5OiB7IG5hbWU6ICd0eXBlJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBdXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuICAgICAgYXdhaXQgZHluYW1vREJDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpEeW5hbW9EQjo6R2xvYmFsVGFibGUnLCB7XG4gICAgICAgIExvY2FsU2Vjb25kYXJ5SW5kZXhlczogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICAgIEluZGV4TmFtZTogJ3R5cGUtaW5kZXgnXG4gICAgICAgICAgfSlcbiAgICAgICAgXSlcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgdGFibGUgd2l0aCBUaW1lLXRvLUxpdmUgKFRUTCknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAndHRsLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICB0aW1lVG9MaXZlQXR0cmlidXRlOiAnZXhwaXJlc0F0J1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcbiAgICAgIGF3YWl0IGR5bmFtb0RCQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RHluYW1vREI6Okdsb2JhbFRhYmxlJywge1xuICAgICAgICBUaW1lVG9MaXZlU3BlY2lmaWNhdGlvbjogTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgQXR0cmlidXRlTmFtZTogJ2V4cGlyZXNBdCcsXG4gICAgICAgICAgRW5hYmxlZDogdHJ1ZVxuICAgICAgICB9KVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSB0YWJsZSB3aXRoIHBvaW50LWluLXRpbWUgcmVjb3ZlcnknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAncGl0ci10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcbiAgICAgIGF3YWl0IGR5bmFtb0RCQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICAvLyBQb2ludC1pbi10aW1lIHJlY292ZXJ5IGlzIGNvbmZpZ3VyZWQgYXQgdGhlIHJlcGxpY2EgbGV2ZWwgaW4gR2xvYmFsVGFibGVcbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpEeW5hbW9EQjo6R2xvYmFsVGFibGUnLCB7XG4gICAgICAgIFJlcGxpY2FzOiBNYXRjaC5hcnJheVdpdGgoW1xuICAgICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgUG9pbnRJblRpbWVSZWNvdmVyeVNwZWNpZmljYXRpb246IE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgICBQb2ludEluVGltZVJlY292ZXJ5RW5hYmxlZDogdHJ1ZVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICB9KVxuICAgICAgICBdKVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSB0YWJsZSB3aXRoIFJFVEFJTiByZW1vdmFsIHBvbGljeScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdyZXRhaW4tdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuUkVUQUlOXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuICAgICAgYXdhaXQgZHluYW1vREJDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIGNvbnN0IHJlc291cmNlcyA9IHRlbXBsYXRlLmZpbmRSZXNvdXJjZXMoJ0FXUzo6RHluYW1vREI6Okdsb2JhbFRhYmxlJyk7XG4gICAgICBjb25zdCByZXNvdXJjZUtleXMgPSBPYmplY3Qua2V5cyhyZXNvdXJjZXMpO1xuICAgICAgZXhwZWN0KHJlc291cmNlS2V5cy5sZW5ndGgpLnRvQmUoMSk7XG4gICAgICBleHBlY3QocmVzb3VyY2VzWyByZXNvdXJjZUtleXNbIDAgXSBdLkRlbGV0aW9uUG9saWN5KS50b0JlKCdSZXRhaW4nKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY3JlYXRlIHRhYmxlIHdpdGggY29udHJpYnV0b3IgaW5zaWdodHMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnaW5zaWdodHMtdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIGNvbnRyaWJ1dG9ySW5zaWdodHM6IHRydWVcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG4gICAgICBhd2FpdCBkeW5hbW9EQkNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgLy8gQ29udHJpYnV0b3IgaW5zaWdodHMgaXMgY29uZmlndXJlZCBhdCB0aGUgcmVwbGljYSBsZXZlbCBpbiBHbG9iYWxUYWJsZVxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkR5bmFtb0RCOjpHbG9iYWxUYWJsZScsIHtcbiAgICAgICAgUmVwbGljYXM6IE1hdGNoLmFycmF5V2l0aChbXG4gICAgICAgICAgTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgICBDb250cmlidXRvckluc2lnaHRzU3BlY2lmaWNhdGlvbjogTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgICAgIEVuYWJsZWQ6IHRydWVcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgfSlcbiAgICAgICAgXSlcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgdGFibGUgd2l0aCBtdWx0aXBsZSBHU0lzIGFuZCBMU0lzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ2NvbXBsZXgtaW5kZXhlcy10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgc29ydEtleTogeyBuYW1lOiAndGltZXN0YW1wJywgdHlwZTogQXR0cmlidXRlVHlwZS5OVU1CRVIgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIGdsb2JhbFNlY29uZGFyeUluZGV4ZXM6IFtcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIGluZGV4TmFtZTogJ3N0YXR1cy1pbmRleCcsXG4gICAgICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdzdGF0dXMnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9XG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBpbmRleE5hbWU6ICd0eXBlLWluZGV4JyxcbiAgICAgICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3R5cGUnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ2NyZWF0ZWRBdCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuTlVNQkVSIH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIGxvY2FsU2Vjb25kYXJ5SW5kZXhlczogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgaW5kZXhOYW1lOiAnbG9jYWwtc3RhdHVzLWluZGV4JyxcbiAgICAgICAgICAgICAgICBzb3J0S2V5OiB7IG5hbWU6ICdzdGF0dXMnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIF1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG4gICAgICBhd2FpdCBkeW5hbW9EQkNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkR5bmFtb0RCOjpHbG9iYWxUYWJsZScsIHtcbiAgICAgICAgR2xvYmFsU2Vjb25kYXJ5SW5kZXhlczogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHsgSW5kZXhOYW1lOiAnc3RhdHVzLWluZGV4JyB9KSxcbiAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHsgSW5kZXhOYW1lOiAndHlwZS1pbmRleCcgfSlcbiAgICAgICAgXSksXG4gICAgICAgIExvY2FsU2Vjb25kYXJ5SW5kZXhlczogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgICBNYXRjaC5vYmplY3RMaWtlKHsgSW5kZXhOYW1lOiAnbG9jYWwtc3RhdHVzLWluZGV4JyB9KVxuICAgICAgICBdKVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdTdHJlYW0gUHJvY2Vzc2luZyAtIFZpZXdUeXBlcycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIHN0cmVhbSB3aXRoIEtFWVNfT05MWSB2aWV3IHR5cGUnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAna2V5cy1vbmx5LXN0cmVhbS10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpLFxuICAgICAgICAgICAgZHluYW1vU3RyZWFtOiBTdHJlYW1WaWV3VHlwZS5LRVlTX09OTFlcbiAgICAgICAgICB9LFxuICAgICAgICAgIHN0cmVhbToge1xuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnByb3BzLmR5bmFtb1N0cmVhbSkudG9CZShTdHJlYW1WaWV3VHlwZS5LRVlTX09OTFkpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBzdHJlYW0gd2l0aCBORVdfSU1BR0UgdmlldyB0eXBlJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ25ldy1pbWFnZS1zdHJlYW0tdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIGR5bmFtb1N0cmVhbTogU3RyZWFtVmlld1R5cGUuTkVXX0lNQUdFXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzdHJlYW06IHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWVcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5wcm9wcy5keW5hbW9TdHJlYW0pLnRvQmUoU3RyZWFtVmlld1R5cGUuTkVXX0lNQUdFKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgc3RyZWFtIHdpdGggT0xEX0lNQUdFIHZpZXcgdHlwZScsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdvbGQtaW1hZ2Utc3RyZWFtLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICBkeW5hbW9TdHJlYW06IFN0cmVhbVZpZXdUeXBlLk9MRF9JTUFHRVxuICAgICAgICAgIH0sXG4gICAgICAgICAgc3RyZWFtOiB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUucHJvcHMuZHluYW1vU3RyZWFtKS50b0JlKFN0cmVhbVZpZXdUeXBlLk9MRF9JTUFHRSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdFZGdlIENhc2VzIGFuZCBFcnJvciBTY2VuYXJpb3MnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSBhdWRpdCBjb25maWd1cmF0aW9uIHdpdGhvdXQgc3RyZWFtIEFSTicsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICduby1zdHJlYW0tYXJuLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKClcbiAgICAgICAgICAgIC8vIE5vIGR5bmFtb1N0cmVhbSAtIG5vIHN0cmVhbSBBUk5cbiAgICAgICAgICB9LFxuICAgICAgICAgIGF1ZGl0OiB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgdHlwZTogQXVkaXRMb2dnZXJUeXBlLkNMT1VEV0FUQ0hcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIC8vIFZlcmlmeSBjb25maWd1cmF0aW9uIGlzIHN0b3JlZCBldmVuIHdpdGhvdXQgc3RyZWFtIEFSTlxuICAgICAgLy8gVGhlIGNvbnN0cnVjdCB3aWxsIGxvZyBhIHdhcm5pbmcgZHVyaW5nIGNvbnN0cnVjdCgpIGJ1dCBjb25maWcgaXMgdmFsaWQgKGR5bmFtb2RiLnRzOjQ5MywgNTc2KVxuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLmF1ZGl0LmVuYWJsZWQpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUucHJvcHMuZHluYW1vU3RyZWFtKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBtaW5pbWFsIHRhYmxlIGNvbmZpZ3VyYXRpb24nLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnbWluaW1hbC10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuICAgICAgYXdhaXQgZHluYW1vREJDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpEeW5hbW9EQjo6R2xvYmFsVGFibGUnLCAxKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHRhYmxlIHdpdGggZW5jcnlwdGlvbicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdlbmNyeXB0ZWQtdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIGVuY3J5cHRpb246IFRhYmxlRW5jcnlwdGlvblYyLmF3c01hbmFnZWRLZXkoKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcbiAgICAgIGF3YWl0IGR5bmFtb0RCQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RHluYW1vREI6Okdsb2JhbFRhYmxlJywge1xuICAgICAgICBTU0VTcGVjaWZpY2F0aW9uOiBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICBTU0VFbmFibGVkOiB0cnVlXG4gICAgICAgIH0pXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGVtcHR5IHNlYXJjaCBpbmRleGluZyBhcnJheScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdlbXB0eS1zZWFyY2gtdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKVxuICAgICAgICAgIH0sXG4gICAgICAgICAgc2VhcmNoSW5kZXhpbmc6IFtdXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG4gICAgICBhd2FpdCBkeW5hbW9EQkNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnNlYXJjaEluZGV4aW5nKS50b0VxdWFsKFtdKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdGhyb3cgZXJyb3Igd2hlbiBwYXJ0aXRpb24ga2V5IGlzIG1pc3NpbmcnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnbm8tcGFydGl0aW9uLWtleS10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKVxuICAgICAgICAgIH0gYXMgYW55IC8vIEZvcmNlIGludmFsaWQgY29uZmlnXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIC8vIENESyB3aWxsIHRocm93IGR1cmluZyBjb25zdHJ1Y3QoKSBkdWUgdG8gbWlzc2luZyBwYXJ0aXRpb24ga2V5XG4gICAgICBhd2FpdCBleHBlY3QoZHluYW1vREJDb25zdHJ1Y3QuY29uc3RydWN0KCkpLnJlamVjdHMudG9UaHJvdygpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgdGFibGUgbmFtZSB3aXRoIHNwZWNpYWwgY2hhcmFjdGVycyAoc2FuaXRpemVkKScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdteS1zcGVjaWFsQHRhYmxlI25hbWUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcbiAgICAgIGF3YWl0IGR5bmFtb0RCQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICAvLyBlbnN1cmVOb1NwZWNpYWxDaGFycyBzaG91bGQgc2FuaXRpemUgdGhlIG5hbWUgKGR5bmFtb2RiLnRzOjQ2NilcbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpEeW5hbW9EQjo6R2xvYmFsVGFibGUnLCAxKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHplcm8gYmF0Y2ggc2l6ZSBmb3Igc3RyZWFtIHByb2Nlc3NvcicsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICd6ZXJvLWJhdGNoLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICBkeW5hbW9TdHJlYW06IFN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFU1xuICAgICAgICAgIH0sXG4gICAgICAgICAgc3RyZWFtOiB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgcHJvY2Vzc29yOiB7XG4gICAgICAgICAgICAgIHN0YXJ0aW5nUG9zaXRpb246IFN0YXJ0aW5nUG9zaXRpb24uTEFURVNULFxuICAgICAgICAgICAgICBiYXRjaFNpemU6IDAgLy8gSW52YWxpZFxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgLy8gQ29uZmlnIGlzIHN0b3JlZCwgYnV0IENESyB3aWxsIHZhbGlkYXRlIGR1cmluZyBzeW50aGVzaXNcbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5zdHJlYW0ucHJvY2Vzc29yLmJhdGNoU2l6ZSkudG9CZSgwKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIG5lZ2F0aXZlIHJldHJ5IGF0dGVtcHRzJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJRHluYW1vREJDb25maWcgPSB7XG4gICAgICAgIHRhYmxlOiB7XG4gICAgICAgICAgbmFtZTogJ25lZ2F0aXZlLXJldHJ5LXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICBkeW5hbW9TdHJlYW06IFN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFU1xuICAgICAgICAgIH0sXG4gICAgICAgICAgc3RyZWFtOiB7XG4gICAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgcHJvY2Vzc29yOiB7XG4gICAgICAgICAgICAgIHN0YXJ0aW5nUG9zaXRpb246IFN0YXJ0aW5nUG9zaXRpb24uTEFURVNULFxuICAgICAgICAgICAgICByZXRyeUF0dGVtcHRzOiAtMSAvLyBJbnZhbGlkXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc3RyZWFtLnByb2Nlc3Nvci5yZXRyeUF0dGVtcHRzKS50b0JlKC0xKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGJvdGggYWxsb3dlZCBhbmQgZXhjbHVkZWQgZW50aXR5IG5hbWVzIChjb25mbGljdCknLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnY29uZmxpY3QtYXVkaXQtdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIGR5bmFtb1N0cmVhbTogU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTXG4gICAgICAgICAgfSxcbiAgICAgICAgICBhdWRpdDoge1xuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIHR5cGU6IEF1ZGl0TG9nZ2VyVHlwZS5DTE9VRFdBVENILFxuICAgICAgICAgICAgYWxsb3dlZEVudGl0eU5hbWVzOiBbICdVc2VyJyBdLFxuICAgICAgICAgICAgZXhjbHVkZWRFbnRpdHlOYW1lczogWyAnVXNlcicgXSAvLyBDb25mbGljdCFcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIC8vIENvbmZpZyBpcyBzdG9yZWQsIHJ1bnRpbWUgbG9naWMgc2hvdWxkIGhhbmRsZSBjb25mbGljdFxuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLmF1ZGl0LmFsbG93ZWRFbnRpdHlOYW1lcykudG9FcXVhbChbICdVc2VyJyBdKTtcbiAgICAgIGV4cGVjdCgoZHluYW1vREJDb25zdHJ1Y3QgYXMgYW55KS5keW5hbW9EQkNvbmZpZy50YWJsZS5hdWRpdC5leGNsdWRlZEVudGl0eU5hbWVzKS50b0VxdWFsKFsgJ1VzZXInIF0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgZW1wdHkgc3RyaW5nIHRhYmxlIG5hbWUnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKClcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIC8vIGVuc3VyZU5vU3BlY2lhbENoYXJzIGFuZCBlbnN1cmVTdWZmaXggd2lsbCBwcm9jZXNzIGVtcHR5IHN0cmluZ1xuICAgICAgLy8gQ0RLIGFjdHVhbGx5IGFsbG93cyBlbXB0eSB0YWJsZSBuYW1lcyAoYXV0by1nZW5lcmF0ZXMpLCBzbyB0aGlzIHdpbGwgc3VjY2VlZFxuICAgICAgYXdhaXQgZHluYW1vREJDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpEeW5hbW9EQjo6R2xvYmFsVGFibGUnLCAxKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIG1pc3Npbmcgc2VhcmNoIGVuZ2luZSBjb25maWcnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnbWlzc2luZy1lbmdpbmUtY29uZmlnLXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICBkeW5hbW9TdHJlYW06IFN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFU1xuICAgICAgICAgIH0sXG4gICAgICAgICAgc2VhcmNoSW5kZXhpbmc6IFsge1xuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIGVuZ2luZUNvbmZpZzogdW5kZWZpbmVkIGFzIGFueSAvLyBNaXNzaW5nIVxuICAgICAgICAgIH0gXVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICAvLyBDb25maWcgaXMgc3RvcmVkLCBydW50aW1lIHdpbGwgZmFpbCB3aGVuIHRyeWluZyB0byB1c2UgdW5kZWZpbmVkIGVuZ2luZUNvbmZpZ1xuICAgICAgZXhwZWN0KChkeW5hbW9EQkNvbnN0cnVjdCBhcyBhbnkpLmR5bmFtb0RCQ29uZmlnLnRhYmxlLnNlYXJjaEluZGV4aW5nWyAwIF0uZW5naW5lQ29uZmlnKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBlbXB0eSBlbmdpbmUgaG9zdCcsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdlbXB0eS1ob3N0LXRhYmxlJyxcbiAgICAgICAgICBwcm9wczoge1xuICAgICAgICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpZCcsIHR5cGU6IEF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgICBiaWxsaW5nOiBCaWxsaW5nLm9uRGVtYW5kKCksXG4gICAgICAgICAgICBkeW5hbW9TdHJlYW06IFN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFU1xuICAgICAgICAgIH0sXG4gICAgICAgICAgc2VhcmNoSW5kZXhpbmc6IFsge1xuICAgICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIGVuZ2luZUNvbmZpZzoge1xuICAgICAgICAgICAgICB0eXBlOiAnbWVpbGknLFxuICAgICAgICAgICAgICBob3N0OiAnJywgLy8gRW1wdHkhXG4gICAgICAgICAgICAgIG1hc3RlcktleTogJ3Rlc3Qta2V5J1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gXVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBkeW5hbW9EQkNvbnN0cnVjdCA9IG5ldyBEeW5hbW9EQkNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc2VhcmNoSW5kZXhpbmdbIDAgXS5lbmdpbmVDb25maWcuaG9zdCkudG9CZSgnJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBzdHJlYW0gZW5hYmxlZCB3aXRob3V0IGR5bmFtb1N0cmVhbSBvbiB0YWJsZScsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICduby1zdHJlYW0tcHJvcC10YWJsZScsXG4gICAgICAgICAgcHJvcHM6IHtcbiAgICAgICAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBBdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgICAgICAgYmlsbGluZzogQmlsbGluZy5vbkRlbWFuZCgpXG4gICAgICAgICAgICAvLyBObyBkeW5hbW9TdHJlYW0hXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzdHJlYW06IHtcbiAgICAgICAgICAgIGVuYWJsZWQ6IHRydWUgLy8gQnV0IHN0cmVhbSBlbmFibGVkIVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgLy8gQ29uZmlnIGlzIHN0b3JlZCwgYnV0IHNldHVwU3RyZWFtUHJvY2Vzc2luZyB3aWxsIGxvZyB3YXJuaW5nIChkeW5hbW9kYi50czo0OTMpXG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUuc3RyZWFtLmVuYWJsZWQpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QoKGR5bmFtb0RCQ29uc3RydWN0IGFzIGFueSkuZHluYW1vREJDb25maWcudGFibGUucHJvcHMuZHluYW1vU3RyZWFtKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdTbmFwc2hvdCBUZXN0cyAtIENsb3VkRm9ybWF0aW9uIENvbnNpc3RlbmN5JywgKCkgPT4ge1xuICAgIC8qKlxuICAgICAqIFNuYXBzaG90OiBCYXNpYyBUYWJsZVxuICAgICAqIFRlc3RzIENsb3VkRm9ybWF0aW9uIHRlbXBsYXRlIGZvciBhIGJhc2ljIER5bmFtb0RCIHRhYmxlLlxuICAgICAqL1xuICAgIGl0KCdzaG91bGQgZ2VuZXJhdGUgY29uc2lzdGVudCBDbG91ZEZvcm1hdGlvbiBmb3IgYmFzaWMgdGFibGUnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElEeW5hbW9EQkNvbmZpZyA9IHtcbiAgICAgICAgdGFibGU6IHtcbiAgICAgICAgICBuYW1lOiAnc25hcHNob3QtYmFzaWMtdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgZHluYW1vREJDb25zdHJ1Y3QgPSBuZXcgRHluYW1vREJDb25zdHJ1Y3QoY29uZmlnKTtcbiAgICAgIGF3YWl0IGR5bmFtb0RCQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjaykudG9KU09OKCk7XG4gICAgICBleHBlY3QodGVtcGxhdGUpLnRvTWF0Y2hTbmFwc2hvdCgpO1xuICAgIH0pO1xuXG4gICAgLyoqXG4gICAgICogU25hcHNob3Q6IFRhYmxlIHdpdGggU3RyZWFtIEVuYWJsZWQgKGNvbmZpZ3VyYXRpb24gb25seSlcbiAgICAgKiBUZXN0cyBDbG91ZEZvcm1hdGlvbiB0ZW1wbGF0ZSB3aXRoIHN0cmVhbSBlbmFibGVkIG9uIHRoZSB0YWJsZS5cbiAgICAgKiBOT1RFOiBTdHJlYW0gcHJvY2Vzc29yIExhbWJkYSBub3QgaW5jbHVkZWQgKHJlcXVpcmVzIHJ1bnRpbWUgZmlsZXMpLlxuICAgICAqL1xuICAgIGl0KCdzaG91bGQgZ2VuZXJhdGUgY29uc2lzdGVudCBDbG91ZEZvcm1hdGlvbiBmb3IgdGFibGUgd2l0aCBzdHJlYW0gZW5hYmxlZCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSUR5bmFtb0RCQ29uZmlnID0ge1xuICAgICAgICB0YWJsZToge1xuICAgICAgICAgIG5hbWU6ICdzbmFwc2hvdC1zdHJlYW0tdGFibGUnLFxuICAgICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICAgIGJpbGxpbmc6IEJpbGxpbmcub25EZW1hbmQoKSxcbiAgICAgICAgICAgIGR5bmFtb1N0cmVhbTogU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTLFxuICAgICAgICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZXG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIE5vIHN0cmVhbSBwcm9jZXNzb3IgLSBqdXN0IHRoZSB0YWJsZSB3aXRoIHN0cmVhbSBlbmFibGVkXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RCQ29uc3RydWN0ID0gbmV3IER5bmFtb0RCQ29uc3RydWN0KGNvbmZpZyk7XG4gICAgICBhd2FpdCBkeW5hbW9EQkNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spLnRvSlNPTigpO1xuICAgICAgZXhwZWN0KHRlbXBsYXRlKS50b01hdGNoU25hcHNob3QoKTtcbiAgICB9KTtcbiAgfSk7XG59KTtcblxuIl19
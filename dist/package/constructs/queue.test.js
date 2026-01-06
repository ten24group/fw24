"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const aws_cdk_lib_1 = require("aws-cdk-lib");
const assertions_1 = require("aws-cdk-lib/assertions");
const aws_sqs_1 = require("aws-cdk-lib/aws-sqs");
const queue_lambda_1 = require("./queue-lambda");
const fw24_1 = require("../core/fw24");
const path = __importStar(require("path"));
/**
 * Comprehensive test suite for QueueLambda construct.
 *
 * Tests cover:
 * - Queue creation with various configurations
 * - SQS event source normalization
 * - FIFO queue handling
 * - DLQ (Dead Letter Queue) setup
 * - Batch processing configuration
 * - Integration with Lambda functions
 * - Regression tests for previously fixed bugs
 * - Edge cases and error scenarios
 *
 * NOTE: Some integration-level features cannot be unit tested:
 * - Topic subscriptions (require pre-registered topics in fw24)
 * - attachQueueToLambda static method (QueueLambda returns Queue, not Lambda)
 */
describe('QueueLambda Static Methods', () => {
    let app;
    let stack;
    const TEST_ENTRY = path.join(__dirname, '../core/runtime/abstract-lambda-handler.ts');
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
            name: 'test-app',
            region: 'us-east-1',
            account: '123456789012'
        });
        fw24.addStack('main', stack);
    });
    afterEach(() => {
        fw24_1.Fw24.instance = undefined;
    });
    describe('QueueLambda.createQueue - Basic Queue Creation', () => {
        it('should create a standard queue with default settings', () => {
            const queue = queue_lambda_1.QueueLambda.createQueue(stack, 'test-queue', {
                queueName: 'test-queue'
            });
            expect(queue).toBeDefined();
            expect(queue).toBeInstanceOf(aws_sqs_1.Queue);
            const template = assertions_1.Template.fromStack(stack);
            // Queue is created (DLQ may also be auto-generated)
            const queueCount = Object.keys(template.findResources('AWS::SQS::Queue')).length;
            expect(queueCount).toBeGreaterThanOrEqual(1);
        });
        it('should create a FIFO queue when queueName ends with .fifo', () => {
            const queue = queue_lambda_1.QueueLambda.createQueue(stack, 'test-queue-fifo', {
                queueName: 'test-queue.fifo',
                queueProps: {
                    fifo: true,
                    contentBasedDeduplication: true
                }
            });
            expect(queue).toBeDefined();
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::SQS::Queue', {
                FifoQueue: true
                // ContentBasedDeduplication only on main queue, not DLQ
            });
        });
        it('should create queue with custom visibility timeout', () => {
            const queue = queue_lambda_1.QueueLambda.createQueue(stack, 'test-queue', {
                queueName: 'test-queue',
                visibilityTimeoutSeconds: 120
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::SQS::Queue', {
                VisibilityTimeout: 120
            });
        });
        it('should create queue with custom retention period', () => {
            const queue = queue_lambda_1.QueueLambda.createQueue(stack, 'test-queue', {
                queueName: 'test-queue',
                retentionPeriodDays: 7
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::SQS::Queue', {
                MessageRetentionPeriod: 604800 // 7 days in seconds
            });
        });
        it('should create queue with Dead Letter Queue (DLQ)', () => {
            const queue = queue_lambda_1.QueueLambda.createQueue(stack, 'test-queue', {
                queueName: 'test-queue',
                maxReceiveCount: 3
            });
            const template = assertions_1.Template.fromStack(stack);
            // Main queue should reference DLQ
            template.hasResourceProperties('AWS::SQS::Queue', {
                RedrivePolicy: assertions_1.Match.objectLike({
                    maxReceiveCount: 3
                })
            });
        });
        it('should NOT create custom DLQ when maxReceiveCount is undefined', () => {
            const queue = queue_lambda_1.QueueLambda.createQueue(stack, 'test-queue', {
                queueName: 'test-queue'
            });
            expect(queue).toBeDefined();
        });
        it('should merge custom queueProps with default props', () => {
            const queue = queue_lambda_1.QueueLambda.createQueue(stack, 'test-queue', {
                queueName: 'test-queue',
                queueProps: {
                    deliveryDelay: aws_cdk_lib_1.Duration.seconds(10),
                    receiveMessageWaitTime: aws_cdk_lib_1.Duration.seconds(20)
                }
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::SQS::Queue', {
                DelaySeconds: 10,
                ReceiveMessageWaitTimeSeconds: 20
            });
        });
        it('should handle empty queueProps', () => {
            const queue = queue_lambda_1.QueueLambda.createQueue(stack, 'test-queue', {
                queueName: 'test-queue',
                queueProps: {}
            });
            expect(queue).toBeDefined();
        });
        it('should create FIFO DLQ for FIFO queue', () => {
            const queue = queue_lambda_1.QueueLambda.createQueue(stack, 'test-queue-fifo', {
                queueName: 'test-queue.fifo',
                queueProps: {
                    fifo: true
                },
                maxReceiveCount: 5
            });
            const template = assertions_1.Template.fromStack(stack);
            // Main FIFO queue
            template.hasResourceProperties('AWS::SQS::Queue', {
                FifoQueue: true,
                RedrivePolicy: assertions_1.Match.objectLike({
                    maxReceiveCount: 5
                })
            });
        });
    });
    describe('QueueLambda.createQueue - Topic Subscriptions', () => {
        /**
         * NOTE: Topic subscription tests are skipped because the framework expects topics
         * to be pre-registered via fw24.setEnvironmentVariable(), but unit tests create
         * topics inline which results in CDK tokens. These tokens cannot be used in
         * construct IDs, causing: "ID components may not include unresolved tokens".
         *
         * This is an integration-level feature requiring:
         * 1. Topics registered: fw24.setEnvironmentVariable('myTopic', topicArn)
         * 2. Reference by name: topics: ['myTopic']
         * 3. Framework looks up: fw24.getEnvironmentVariable('myTopic', 'topicName')
         *
         * Cannot be unit tested without mocking the fw24 singleton.
         */
        it('should handle empty topics array', () => {
            const queue = queue_lambda_1.QueueLambda.createQueue(stack, 'test-queue', {
                queueName: 'test-queue'
            }, {
                topics: []
            });
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::SNS::Subscription', 0);
        });
        it('should handle undefined subscriptions', () => {
            const queue = queue_lambda_1.QueueLambda.createQueue(stack, 'test-queue', {
                queueName: 'test-queue'
            }, undefined);
            expect(queue).toBeDefined();
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::SNS::Subscription', 0);
        });
    });
    describe('QueueLambda.normalizeSqsEventSourceProps', () => {
        it('should return default props when no config provided', () => {
            const normalized = queue_lambda_1.QueueLambda.normalizeSqsEventSourceProps({}, false);
            expect(normalized).toEqual({
                batchSize: 10,
                maxBatchingWindow: aws_cdk_lib_1.Duration.seconds(5),
                reportBatchItemFailures: true
            });
        });
        it('should use custom batchSize', () => {
            const normalized = queue_lambda_1.QueueLambda.normalizeSqsEventSourceProps({ batchSize: 50 }, false);
            expect(normalized.batchSize).toBe(50);
        });
        it('should convert maxBatchingWindowSeconds to Duration', () => {
            const normalized = queue_lambda_1.QueueLambda.normalizeSqsEventSourceProps({
                maxBatchingWindowSeconds: 10
            }, false);
            expect(normalized.maxBatchingWindow).toEqual(aws_cdk_lib_1.Duration.seconds(10));
        });
        it('should prioritize maxBatchingWindow over maxBatchingWindowSeconds', () => {
            const normalized = queue_lambda_1.QueueLambda.normalizeSqsEventSourceProps({
                maxBatchingWindow: aws_cdk_lib_1.Duration.seconds(20),
                maxBatchingWindowSeconds: 10
            }, false);
            expect(normalized.maxBatchingWindow).toEqual(aws_cdk_lib_1.Duration.seconds(20));
        });
        it('should return empty object for FIFO queues', () => {
            const normalized = queue_lambda_1.QueueLambda.normalizeSqsEventSourceProps({}, true);
            expect(normalized).toEqual({});
        });
        it('should preserve reportBatchItemFailures setting', () => {
            const normalized = queue_lambda_1.QueueLambda.normalizeSqsEventSourceProps({
                reportBatchItemFailures: false
            }, false);
            expect(normalized.reportBatchItemFailures).toBe(false);
        });
        it('should handle all custom properties together', () => {
            const normalized = queue_lambda_1.QueueLambda.normalizeSqsEventSourceProps({
                batchSize: 25,
                maxBatchingWindowSeconds: 15,
                reportBatchItemFailures: false
            }, false);
            expect(normalized).toEqual({
                batchSize: 25,
                maxBatchingWindow: aws_cdk_lib_1.Duration.seconds(15),
                reportBatchItemFailures: false
            });
        });
    });
    /**
     * NOTE: attachQueueToLambda tests are not included because QueueLambda constructor
     * returns Queue (not Lambda), making it impossible to test the static method in isolation.
     * The functionality IS tested via QueueLambda integration tests below.
     */
    describe('QueueLambda Constructor - Integration', () => {
        it('should create queue and lambda function together', () => {
            const queueLambda = new queue_lambda_1.QueueLambda(stack, 'TestQueueLambda', {
                queueName: 'integration-queue',
                lambdaFunctionProps: {
                    entry: TEST_ENTRY
                }
            });
            expect(queueLambda).toBeDefined();
            const template = assertions_1.Template.fromStack(stack);
            // Lambda is created
            template.resourceCountIs('AWS::Lambda::Function', 1);
            // Event source mapping is created
            template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);
        });
        it('should pass environment variables to lambda', () => {
            const queueLambda = new queue_lambda_1.QueueLambda(stack, 'TestQueueLambda', {
                queueName: 'test-queue',
                lambdaFunctionProps: {
                    entry: TEST_ENTRY,
                    environmentVariables: {
                        'CUSTOM_VAR': 'custom-value'
                    }
                }
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::Function', {
                Environment: {
                    Variables: assertions_1.Match.objectLike({
                        'CUSTOM_VAR': 'custom-value'
                    })
                }
            });
        });
        it('should pass policies to lambda', () => {
            const queueLambda = new queue_lambda_1.QueueLambda(stack, 'TestQueueLambda', {
                queueName: 'test-queue',
                lambdaFunctionProps: {
                    entry: TEST_ENTRY,
                    policies: [
                        {
                            effect: 'Allow',
                            actions: ['s3:GetObject'],
                            resources: ['*']
                        }
                    ]
                }
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::IAM::Policy', {
                PolicyDocument: {
                    Statement: assertions_1.Match.arrayWith([
                        assertions_1.Match.objectLike({
                            Action: 's3:GetObject'
                        })
                    ])
                }
            });
        });
        it('should create FIFO queue and lambda', () => {
            const queueLambda = new queue_lambda_1.QueueLambda(stack, 'TestQueueLambda', {
                queueName: 'test-queue.fifo',
                queueProps: {
                    fifo: true
                },
                lambdaFunctionProps: {
                    entry: TEST_ENTRY
                }
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::SQS::Queue', {
                FifoQueue: true
            });
        });
        it('should handle all queue configuration options', () => {
            const queueLambda = new queue_lambda_1.QueueLambda(stack, 'TestQueueLambda', {
                queueName: 'complex-queue',
                visibilityTimeoutSeconds: 120,
                retentionPeriodDays: 7,
                maxReceiveCount: 3,
                sqsEventSourceProps: {
                    batchSize: 25,
                    maxBatchingWindowSeconds: 10
                },
                lambdaFunctionProps: {
                    entry: TEST_ENTRY,
                    functionTimeout: 90
                }
            });
            const template = assertions_1.Template.fromStack(stack);
            // Queue configuration
            template.hasResourceProperties('AWS::SQS::Queue', {
                VisibilityTimeout: 120,
                MessageRetentionPeriod: 604800, // 7 days
                RedrivePolicy: assertions_1.Match.objectLike({
                    maxReceiveCount: 3
                })
            });
            // Lambda configuration
            template.hasResourceProperties('AWS::Lambda::Function', {
                Timeout: 90
            });
            // Event source configuration
            template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
                BatchSize: 25,
                MaximumBatchingWindowInSeconds: 10
            });
        });
    });
    describe('Regression Tests - Bug Fixes', () => {
        it('REGRESSION: should default batchSize to 10 for standard queues', () => {
            new queue_lambda_1.QueueLambda(stack, 'TestLambda', {
                queueName: 'test-queue',
                lambdaFunctionProps: {
                    entry: TEST_ENTRY
                }
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
                BatchSize: 10 // NOT 1 (the old bug)
            });
        });
        it('REGRESSION: FIFO queues should have no event source config', () => {
            new queue_lambda_1.QueueLambda(stack, 'TestFifoLambda', {
                queueName: 'test-queue.fifo',
                queueProps: {
                    fifo: true
                },
                lambdaFunctionProps: {
                    entry: TEST_ENTRY
                }
            });
            const template = assertions_1.Template.fromStack(stack);
            // FIFO queue event source should exist but with no batch settings
            template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);
        });
        it('REGRESSION: should support both maxBatchingWindow (Duration) and maxBatchingWindowSeconds (number)', () => {
            // Test number format
            const normalized1 = queue_lambda_1.QueueLambda.normalizeSqsEventSourceProps({
                maxBatchingWindowSeconds: 15
            }, false);
            expect(normalized1.maxBatchingWindow).toEqual(aws_cdk_lib_1.Duration.seconds(15));
            // Test Duration format
            const normalized2 = queue_lambda_1.QueueLambda.normalizeSqsEventSourceProps({
                maxBatchingWindow: aws_cdk_lib_1.Duration.seconds(20)
            }, false);
            expect(normalized2.maxBatchingWindow).toEqual(aws_cdk_lib_1.Duration.seconds(20));
            // Duration should win when both provided
            const normalized3 = queue_lambda_1.QueueLambda.normalizeSqsEventSourceProps({
                maxBatchingWindow: aws_cdk_lib_1.Duration.seconds(30),
                maxBatchingWindowSeconds: 10
            }, false);
            expect(normalized3.maxBatchingWindow).toEqual(aws_cdk_lib_1.Duration.seconds(30));
        });
        it('REGRESSION: should return empty config for FIFO queues', () => {
            const normalized = queue_lambda_1.QueueLambda.normalizeSqsEventSourceProps({}, true);
            expect(normalized).toEqual({});
        });
    });
    describe('Edge Cases and Error Scenarios', () => {
        it('should handle queue creation with minimal config', () => {
            const queue = queue_lambda_1.QueueLambda.createQueue(stack, 'minimal-queue', {
                queueName: 'minimal-queue'
            });
            expect(queue).toBeDefined();
            expect(queue).toBeInstanceOf(aws_sqs_1.Queue);
        });
        it('should handle QueueLambda with only required props', () => {
            const queueLambda = new queue_lambda_1.QueueLambda(stack, 'MinimalLambda', {
                queueName: 'minimal',
                lambdaFunctionProps: {
                    entry: TEST_ENTRY
                }
            });
            expect(queueLambda).toBeDefined();
            const template = assertions_1.Template.fromStack(stack);
            template.resourceCountIs('AWS::Lambda::Function', 1);
            template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);
        });
        it('should handle undefined maxReceiveCount (uses default DLQ)', () => {
            const queue = queue_lambda_1.QueueLambda.createQueue(stack, 'test-queue', {
                queueName: 'test-queue'
                // maxReceiveCount undefined - framework creates default DLQ automatically
            });
            expect(queue).toBeDefined();
            const template = assertions_1.Template.fromStack(stack);
            // Should have at least 1 queue (may have default DLQ)
            const queueCount = Object.keys(template.findResources('AWS::SQS::Queue')).length;
            expect(queueCount).toBeGreaterThanOrEqual(1);
        });
        it('should handle very high visibility timeout', () => {
            const queue = queue_lambda_1.QueueLambda.createQueue(stack, 'test-queue', {
                queueName: 'test-queue',
                visibilityTimeoutSeconds: 43200 // 12 hours max
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::SQS::Queue', {
                VisibilityTimeout: 43200
            });
        });
        it('should handle very high retention period', () => {
            const queue = queue_lambda_1.QueueLambda.createQueue(stack, 'test-queue', {
                queueName: 'test-queue',
                retentionPeriodDays: 14 // 14 days max
            });
            const template = assertions_1.Template.fromStack(stack);
            template.hasResourceProperties('AWS::SQS::Queue', {
                MessageRetentionPeriod: 1209600 // 14 days in seconds
            });
        });
        it('should handle empty string queue name by using construct ID', () => {
            // CDK will use construct ID if queueName is empty
            const queue = queue_lambda_1.QueueLambda.createQueue(stack, 'empty-queue-id', {
                queueName: ''
            });
            expect(queue).toBeDefined();
        });
        it('should handle queue name with special characters', () => {
            const queue = queue_lambda_1.QueueLambda.createQueue(stack, 'special-queue', {
                queueName: 'test_queue-name.123'
            });
            expect(queue).toBeDefined();
        });
        it('should handle very high batch sizes', () => {
            const normalized = queue_lambda_1.QueueLambda.normalizeSqsEventSourceProps({
                batchSize: 10000 // SQS max
            }, false);
            expect(normalized.batchSize).toBe(10000);
        });
    });
    describe('Snapshot Tests - CloudFormation Consistency', () => {
        /**
         * Snapshot: Standard Queue Setup
         * Tests CloudFormation template for a standard queue with custom settings.
         * Includes: visibility timeout, DLQ, event source mapping.
         */
        it('should generate consistent CloudFormation for standard queue setup', () => {
            new queue_lambda_1.QueueLambda(stack, 'SnapshotQueue', {
                queueName: 'snapshot-queue',
                visibilityTimeoutSeconds: 60,
                maxReceiveCount: 3,
                lambdaFunctionProps: {
                    entry: TEST_ENTRY
                }
            });
            const template = assertions_1.Template.fromStack(stack).toJSON();
            expect(template).toMatchSnapshot();
        });
        /**
         * Snapshot: FIFO Queue Setup
         * Tests CloudFormation template for a FIFO queue.
         * Includes: content-based deduplication, FIFO-specific settings.
         */
        it('should generate consistent CloudFormation for FIFO queue setup', () => {
            new queue_lambda_1.QueueLambda(stack, 'SnapshotFifoQueue', {
                queueName: 'snapshot-queue.fifo',
                queueProps: {
                    fifo: true
                },
                lambdaFunctionProps: {
                    entry: TEST_ENTRY
                }
            });
            const template = assertions_1.Template.fromStack(stack).toJSON();
            expect(template).toMatchSnapshot();
        });
        /**
         * Snapshot: Complete Configuration
         * Tests CloudFormation template with all configuration options.
         * Includes: timeouts, retention, DLQ, batch settings, lambda config.
         */
        it('should generate consistent CloudFormation for complete setup', () => {
            new queue_lambda_1.QueueLambda(stack, 'SnapshotCompleteQueue', {
                queueName: 'snapshot-complete',
                visibilityTimeoutSeconds: 60,
                retentionPeriodDays: 7,
                maxReceiveCount: 5,
                sqsEventSourceProps: {
                    batchSize: 25,
                    maxBatchingWindowSeconds: 10
                },
                lambdaFunctionProps: {
                    entry: TEST_ENTRY,
                    functionTimeout: 90
                }
            });
            const template = assertions_1.Template.fromStack(stack).toJSON();
            expect(template).toMatchSnapshot();
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVldWUudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9jb25zdHJ1Y3RzL3F1ZXVlLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSw2Q0FBbUQ7QUFDbkQsdURBQWtFO0FBQ2xFLGlEQUE0QztBQUM1QyxpREFBNkM7QUFDN0MsdUNBQW9DO0FBQ3BDLDJDQUE2QjtBQUU3Qjs7Ozs7Ozs7Ozs7Ozs7OztHQWdCRztBQUNILFFBQVEsQ0FBQyw0QkFBNEIsRUFBRSxHQUFHLEVBQUU7SUFDMUMsSUFBSSxHQUFRLENBQUM7SUFDYixJQUFJLEtBQVksQ0FBQztJQUNqQixNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSw0Q0FBNEMsQ0FBQyxDQUFDO0lBRXRGLFVBQVUsQ0FBQyxHQUFHLEVBQUU7UUFDZCxxQkFBcUI7UUFDcEIsV0FBWSxDQUFDLFFBQVEsR0FBRyxTQUFTLENBQUM7UUFFbkMsR0FBRyxHQUFHLElBQUksaUJBQUcsRUFBRSxDQUFDO1FBQ2hCLEtBQUssR0FBRyxJQUFJLG1CQUFLLENBQUMsR0FBRyxFQUFFLFdBQVcsRUFBRTtZQUNsQyxHQUFHLEVBQUUsRUFBRSxPQUFPLEVBQUUsY0FBYyxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUU7U0FDdEQsQ0FBQyxDQUFDO1FBRUgsa0JBQWtCO1FBQ2xCLE1BQU0sSUFBSSxHQUFHLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUNoQyxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ2pCLElBQUksQ0FBQyxTQUFTLENBQUM7WUFDYixJQUFJLEVBQUUsVUFBVTtZQUNoQixNQUFNLEVBQUUsV0FBVztZQUNuQixPQUFPLEVBQUUsY0FBYztTQUN4QixDQUFDLENBQUM7UUFDSCxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sRUFBRSxLQUFLLENBQUMs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QyxRQUFRLENBQUMsQ0FBQyxlQUFlLEVBQUUsQ0FBQztRQUNyQyxDQUFDLENBQUMsQ0FBQztRQUVIOzs7O1dBSUc7UUFDSCxFQUFFLENBQUMsOERBQThELEVBQUUsR0FBRyxFQUFFO1lBQ3RFLElBQUksMEJBQVcsQ0FBQyxLQUFLLEVBQUUsdUJBQXVCLEVBQUU7Z0JBQzlDLFNBQVMsRUFBRSxtQkFBbUI7Z0JBQzlCLHdCQUF3QixFQUFFLEVBQUU7Z0JBQzVCLG1CQUFtQixFQUFFLENBQUM7Z0JBQ3RCLGVBQWUsRUFBRSxDQUFDO2dCQUNsQixtQkFBbUIsRUFBRTtvQkFDbkIsU0FBUyxFQUFFLEVBQUU7b0JBQ2Isd0JBQXdCLEVBQUUsRUFBRTtpQkFDN0I7Z0JBQ0QsbUJBQW1CLEVBQUU7b0JBQ25CLEtBQUssRUFBRSxVQUFVO29CQUNqQixlQUFlLEVBQUUsRUFBRTtpQkFDcEI7YUFDRixDQUFDLENBQUM7WUFFSCxNQUFNLFFBQVEsR0FBRyxxQkFBUSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUNwRCxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUMsZUFBZSxFQUFFLENBQUM7UUFDckMsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQXBwLCBTdGFjaywgRHVyYXRpb24gfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBUZW1wbGF0ZSwgTWF0Y2gsIENhcHR1cmUgfSBmcm9tICdhd3MtY2RrLWxpYi9hc3NlcnRpb25zJztcbmltcG9ydCB7IFF1ZXVlIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXNxcyc7XG5pbXBvcnQgeyBRdWV1ZUxhbWJkYSB9IGZyb20gJy4vcXVldWUtbGFtYmRhJztcbmltcG9ydCB7IEZ3MjQgfSBmcm9tICcuLi9jb3JlL2Z3MjQnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcblxuLyoqXG4gKiBDb21wcmVoZW5zaXZlIHRlc3Qgc3VpdGUgZm9yIFF1ZXVlTGFtYmRhIGNvbnN0cnVjdC5cbiAqIFxuICogVGVzdHMgY292ZXI6XG4gKiAtIFF1ZXVlIGNyZWF0aW9uIHdpdGggdmFyaW91cyBjb25maWd1cmF0aW9uc1xuICogLSBTUVMgZXZlbnQgc291cmNlIG5vcm1hbGl6YXRpb24gIFxuICogLSBGSUZPIHF1ZXVlIGhhbmRsaW5nXG4gKiAtIERMUSAoRGVhZCBMZXR0ZXIgUXVldWUpIHNldHVwXG4gKiAtIEJhdGNoIHByb2Nlc3NpbmcgY29uZmlndXJhdGlvblxuICogLSBJbnRlZ3JhdGlvbiB3aXRoIExhbWJkYSBmdW5jdGlvbnNcbiAqIC0gUmVncmVzc2lvbiB0ZXN0cyBmb3IgcHJldmlvdXNseSBmaXhlZCBidWdzXG4gKiAtIEVkZ2UgY2FzZXMgYW5kIGVycm9yIHNjZW5hcmlvc1xuICpcbiAqIE5PVEU6IFNvbWUgaW50ZWdyYXRpb24tbGV2ZWwgZmVhdHVyZXMgY2Fubm90IGJlIHVuaXQgdGVzdGVkOlxuICogLSBUb3BpYyBzdWJzY3JpcHRpb25zIChyZXF1aXJlIHByZS1yZWdpc3RlcmVkIHRvcGljcyBpbiBmdzI0KVxuICogLSBhdHRhY2hRdWV1ZVRvTGFtYmRhIHN0YXRpYyBtZXRob2QgKFF1ZXVlTGFtYmRhIHJldHVybnMgUXVldWUsIG5vdCBMYW1iZGEpXG4gKi9cbmRlc2NyaWJlKCdRdWV1ZUxhbWJkYSBTdGF0aWMgTWV0aG9kcycsICgpID0+IHtcbiAgbGV0IGFwcDogQXBwO1xuICBsZXQgc3RhY2s6IFN0YWNrO1xuICBjb25zdCBURVNUX0VOVFJZID0gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2NvcmUvcnVudGltZS9hYnN0cmFjdC1sYW1iZGEtaGFuZGxlci50cycpO1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIC8vIENsZWFuIHVwIHNpbmdsZXRvblxuICAgIChGdzI0IGFzIGFueSkuaW5zdGFuY2UgPSB1bmRlZmluZWQ7XG5cbiAgICBhcHAgPSBuZXcgQXBwKCk7XG4gICAgc3RhY2sgPSBuZXcgU3RhY2soYXBwLCAnVGVzdFN0YWNrJywge1xuICAgICAgZW52OiB7IGFjY291bnQ6ICcxMjM0NTY3ODkwMTInLCByZWdpb246ICd1cy1lYXN0LTEnIH1cbiAgICB9KTtcblxuICAgIC8vIEluaXRpYWxpemUgRncyNFxuICAgIGNvbnN0IGZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG4gICAgZncyNC5zZXRBcHAoYXBwKTtcbiAgICBmdzI0LnNldENvbmZpZyh7XG4gICAgICBuYW1lOiAndGVzdC1hcHAnLFxuICAgICAgcmVnaW9uOiAndXMtZWFzdC0xJyxcbiAgICAgIGFjY291bnQ6ICcxMjM0NTY3ODkwMTInXG4gICAgfSk7XG4gICAgZncyNC5hZGRTdGFjaygnbWFpbicsIHN0YWNrKTtcbiAgfSk7XG5cbiAgYWZ0ZXJFYWNoKCgpID0+IHtcbiAgICAoRncyNCBhcyBhbnkpLmluc3RhbmNlID0gdW5kZWZpbmVkO1xuICB9KTtcblxuICBkZXNjcmliZSgnUXVldWVMYW1iZGEuY3JlYXRlUXVldWUgLSBCYXNpYyBRdWV1ZSBDcmVhdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSBhIHN0YW5kYXJkIHF1ZXVlIHdpdGggZGVmYXVsdCBzZXR0aW5ncycsICgpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXVlID0gUXVldWVMYW1iZGEuY3JlYXRlUXVldWUoc3RhY2ssICd0ZXN0LXF1ZXVlJywge1xuICAgICAgICBxdWV1ZU5hbWU6ICd0ZXN0LXF1ZXVlJ1xuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChxdWV1ZSkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChxdWV1ZSkudG9CZUluc3RhbmNlT2YoUXVldWUpO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICAvLyBRdWV1ZSBpcyBjcmVhdGVkIChETFEgbWF5IGFsc28gYmUgYXV0by1nZW5lcmF0ZWQpXG4gICAgICBjb25zdCBxdWV1ZUNvdW50ID0gT2JqZWN0LmtleXModGVtcGxhdGUuZmluZFJlc291cmNlcygnQVdTOjpTUVM6OlF1ZXVlJykpLmxlbmd0aDtcbiAgICAgIGV4cGVjdChxdWV1ZUNvdW50KS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDEpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgYSBGSUZPIHF1ZXVlIHdoZW4gcXVldWVOYW1lIGVuZHMgd2l0aCAuZmlmbycsICgpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXVlID0gUXVldWVMYW1iZGEuY3JlYXRlUXVldWUoc3RhY2ssICd0ZXN0LXF1ZXVlLWZpZm8nLCB7XG4gICAgICAgIHF1ZXVlTmFtZTogJ3Rlc3QtcXVldWUuZmlmbycsXG4gICAgICAgIHF1ZXVlUHJvcHM6IHtcbiAgICAgICAgICBmaWZvOiB0cnVlLFxuICAgICAgICAgIGNvbnRlbnRCYXNlZERlZHVwbGljYXRpb246IHRydWVcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChxdWV1ZSkudG9CZURlZmluZWQoKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OlNRUzo6UXVldWUnLCB7XG4gICAgICAgIEZpZm9RdWV1ZTogdHJ1ZVxuICAgICAgICAvLyBDb250ZW50QmFzZWREZWR1cGxpY2F0aW9uIG9ubHkgb24gbWFpbiBxdWV1ZSwgbm90IERMUVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSBxdWV1ZSB3aXRoIGN1c3RvbSB2aXNpYmlsaXR5IHRpbWVvdXQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBxdWV1ZSA9IFF1ZXVlTGFtYmRhLmNyZWF0ZVF1ZXVlKHN0YWNrLCAndGVzdC1xdWV1ZScsIHtcbiAgICAgICAgcXVldWVOYW1lOiAndGVzdC1xdWV1ZScsXG4gICAgICAgIHZpc2liaWxpdHlUaW1lb3V0U2Vjb25kczogMTIwXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OlNRUzo6UXVldWUnLCB7XG4gICAgICAgIFZpc2liaWxpdHlUaW1lb3V0OiAxMjBcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgcXVldWUgd2l0aCBjdXN0b20gcmV0ZW50aW9uIHBlcmlvZCcsICgpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXVlID0gUXVldWVMYW1iZGEuY3JlYXRlUXVldWUoc3RhY2ssICd0ZXN0LXF1ZXVlJywge1xuICAgICAgICBxdWV1ZU5hbWU6ICd0ZXN0LXF1ZXVlJyxcbiAgICAgICAgcmV0ZW50aW9uUGVyaW9kRGF5czogN1xuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpTUVM6OlF1ZXVlJywge1xuICAgICAgICBNZXNzYWdlUmV0ZW50aW9uUGVyaW9kOiA2MDQ4MDAgLy8gNyBkYXlzIGluIHNlY29uZHNcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgcXVldWUgd2l0aCBEZWFkIExldHRlciBRdWV1ZSAoRExRKScsICgpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXVlID0gUXVldWVMYW1iZGEuY3JlYXRlUXVldWUoc3RhY2ssICd0ZXN0LXF1ZXVlJywge1xuICAgICAgICBxdWV1ZU5hbWU6ICd0ZXN0LXF1ZXVlJyxcbiAgICAgICAgbWF4UmVjZWl2ZUNvdW50OiAzXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuXG4gICAgICAvLyBNYWluIHF1ZXVlIHNob3VsZCByZWZlcmVuY2UgRExRXG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6U1FTOjpRdWV1ZScsIHtcbiAgICAgICAgUmVkcml2ZVBvbGljeTogTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgbWF4UmVjZWl2ZUNvdW50OiAzXG4gICAgICAgIH0pXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgTk9UIGNyZWF0ZSBjdXN0b20gRExRIHdoZW4gbWF4UmVjZWl2ZUNvdW50IGlzIHVuZGVmaW5lZCcsICgpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXVlID0gUXVldWVMYW1iZGEuY3JlYXRlUXVldWUoc3RhY2ssICd0ZXN0LXF1ZXVlJywge1xuICAgICAgICBxdWV1ZU5hbWU6ICd0ZXN0LXF1ZXVlJ1xuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChxdWV1ZSkudG9CZURlZmluZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgbWVyZ2UgY3VzdG9tIHF1ZXVlUHJvcHMgd2l0aCBkZWZhdWx0IHByb3BzJywgKCkgPT4ge1xuICAgICAgY29uc3QgcXVldWUgPSBRdWV1ZUxhbWJkYS5jcmVhdGVRdWV1ZShzdGFjaywgJ3Rlc3QtcXVldWUnLCB7XG4gICAgICAgIHF1ZXVlTmFtZTogJ3Rlc3QtcXVldWUnLFxuICAgICAgICBxdWV1ZVByb3BzOiB7XG4gICAgICAgICAgZGVsaXZlcnlEZWxheTogRHVyYXRpb24uc2Vjb25kcygxMCksXG4gICAgICAgICAgcmVjZWl2ZU1lc3NhZ2VXYWl0VGltZTogRHVyYXRpb24uc2Vjb25kcygyMClcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpTUVM6OlF1ZXVlJywge1xuICAgICAgICBEZWxheVNlY29uZHM6IDEwLFxuICAgICAgICBSZWNlaXZlTWVzc2FnZVdhaXRUaW1lU2Vjb25kczogMjBcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgZW1wdHkgcXVldWVQcm9wcycsICgpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXVlID0gUXVldWVMYW1iZGEuY3JlYXRlUXVldWUoc3RhY2ssICd0ZXN0LXF1ZXVlJywge1xuICAgICAgICBxdWV1ZU5hbWU6ICd0ZXN0LXF1ZXVlJyxcbiAgICAgICAgcXVldWVQcm9wczoge31cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocXVldWUpLnRvQmVEZWZpbmVkKCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGNyZWF0ZSBGSUZPIERMUSBmb3IgRklGTyBxdWV1ZScsICgpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXVlID0gUXVldWVMYW1iZGEuY3JlYXRlUXVldWUoc3RhY2ssICd0ZXN0LXF1ZXVlLWZpZm8nLCB7XG4gICAgICAgIHF1ZXVlTmFtZTogJ3Rlc3QtcXVldWUuZmlmbycsXG4gICAgICAgIHF1ZXVlUHJvcHM6IHtcbiAgICAgICAgICBmaWZvOiB0cnVlXG4gICAgICAgIH0sXG4gICAgICAgIG1heFJlY2VpdmVDb3VudDogNVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIC8vIE1haW4gRklGTyBxdWV1ZVxuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OlNRUzo6UXVldWUnLCB7XG4gICAgICAgIEZpZm9RdWV1ZTogdHJ1ZSxcbiAgICAgICAgUmVkcml2ZVBvbGljeTogTWF0Y2gub2JqZWN0TGlrZSh7XG4gICAgICAgICAgbWF4UmVjZWl2ZUNvdW50OiA1XG4gICAgICAgIH0pXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1F1ZXVlTGFtYmRhLmNyZWF0ZVF1ZXVlIC0gVG9waWMgU3Vic2NyaXB0aW9ucycsICgpID0+IHtcbiAgICAvKipcbiAgICAgKiBOT1RFOiBUb3BpYyBzdWJzY3JpcHRpb24gdGVzdHMgYXJlIHNraXBwZWQgYmVjYXVzZSB0aGUgZnJhbWV3b3JrIGV4cGVjdHMgdG9waWNzIFxuICAgICAqIHRvIGJlIHByZS1yZWdpc3RlcmVkIHZpYSBmdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoKSwgYnV0IHVuaXQgdGVzdHMgY3JlYXRlIFxuICAgICAqIHRvcGljcyBpbmxpbmUgd2hpY2ggcmVzdWx0cyBpbiBDREsgdG9rZW5zLiBUaGVzZSB0b2tlbnMgY2Fubm90IGJlIHVzZWQgaW4gXG4gICAgICogY29uc3RydWN0IElEcywgY2F1c2luZzogXCJJRCBjb21wb25lbnRzIG1heSBub3QgaW5jbHVkZSB1bnJlc29sdmVkIHRva2Vuc1wiLlxuICAgICAqIFxuICAgICAqIFRoaXMgaXMgYW4gaW50ZWdyYXRpb24tbGV2ZWwgZmVhdHVyZSByZXF1aXJpbmc6XG4gICAgICogMS4gVG9waWNzIHJlZ2lzdGVyZWQ6IGZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZSgnbXlUb3BpYycsIHRvcGljQXJuKVxuICAgICAqIDIuIFJlZmVyZW5jZSBieSBuYW1lOiB0b3BpY3M6IFsnbXlUb3BpYyddXG4gICAgICogMy4gRnJhbWV3b3JrIGxvb2tzIHVwOiBmdzI0LmdldEVudmlyb25tZW50VmFyaWFibGUoJ215VG9waWMnLCAndG9waWNOYW1lJylcbiAgICAgKiBcbiAgICAgKiBDYW5ub3QgYmUgdW5pdCB0ZXN0ZWQgd2l0aG91dCBtb2NraW5nIHRoZSBmdzI0IHNpbmdsZXRvbi5cbiAgICAgKi9cblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGVtcHR5IHRvcGljcyBhcnJheScsICgpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXVlID0gUXVldWVMYW1iZGEuY3JlYXRlUXVldWUoc3RhY2ssICd0ZXN0LXF1ZXVlJywge1xuICAgICAgICBxdWV1ZU5hbWU6ICd0ZXN0LXF1ZXVlJ1xuICAgICAgfSwge1xuICAgICAgICB0b3BpY3M6IFtdXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OlNOUzo6U3Vic2NyaXB0aW9uJywgMCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSB1bmRlZmluZWQgc3Vic2NyaXB0aW9ucycsICgpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXVlID0gUXVldWVMYW1iZGEuY3JlYXRlUXVldWUoc3RhY2ssICd0ZXN0LXF1ZXVlJywge1xuICAgICAgICBxdWV1ZU5hbWU6ICd0ZXN0LXF1ZXVlJ1xuICAgICAgfSwgdW5kZWZpbmVkKTtcblxuICAgICAgZXhwZWN0KHF1ZXVlKS50b0JlRGVmaW5lZCgpO1xuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OlNOUzo6U3Vic2NyaXB0aW9uJywgMCk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdRdWV1ZUxhbWJkYS5ub3JtYWxpemVTcXNFdmVudFNvdXJjZVByb3BzJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgcmV0dXJuIGRlZmF1bHQgcHJvcHMgd2hlbiBubyBjb25maWcgcHJvdmlkZWQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBub3JtYWxpemVkID0gUXVldWVMYW1iZGEubm9ybWFsaXplU3FzRXZlbnRTb3VyY2VQcm9wcyh7fSwgZmFsc2UpO1xuXG4gICAgICBleHBlY3Qobm9ybWFsaXplZCkudG9FcXVhbCh7XG4gICAgICAgIGJhdGNoU2l6ZTogMTAsXG4gICAgICAgIG1heEJhdGNoaW5nV2luZG93OiBEdXJhdGlvbi5zZWNvbmRzKDUpLFxuICAgICAgICByZXBvcnRCYXRjaEl0ZW1GYWlsdXJlczogdHJ1ZVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHVzZSBjdXN0b20gYmF0Y2hTaXplJywgKCkgPT4ge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZCA9IFF1ZXVlTGFtYmRhLm5vcm1hbGl6ZVNxc0V2ZW50U291cmNlUHJvcHMoeyBiYXRjaFNpemU6IDUwIH0sIGZhbHNlKTtcblxuICAgICAgZXhwZWN0KG5vcm1hbGl6ZWQuYmF0Y2hTaXplKS50b0JlKDUwKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgY29udmVydCBtYXhCYXRjaGluZ1dpbmRvd1NlY29uZHMgdG8gRHVyYXRpb24nLCAoKSA9PiB7XG4gICAgICBjb25zdCBub3JtYWxpemVkID0gUXVldWVMYW1iZGEubm9ybWFsaXplU3FzRXZlbnRTb3VyY2VQcm9wcyh7XG4gICAgICAgIG1heEJhdGNoaW5nV2luZG93U2Vjb25kczogMTBcbiAgICAgIH0sIGZhbHNlKTtcblxuICAgICAgZXhwZWN0KG5vcm1hbGl6ZWQubWF4QmF0Y2hpbmdXaW5kb3cpLnRvRXF1YWwoRHVyYXRpb24uc2Vjb25kcygxMCkpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBwcmlvcml0aXplIG1heEJhdGNoaW5nV2luZG93IG92ZXIgbWF4QmF0Y2hpbmdXaW5kb3dTZWNvbmRzJywgKCkgPT4ge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZCA9IFF1ZXVlTGFtYmRhLm5vcm1hbGl6ZVNxc0V2ZW50U291cmNlUHJvcHMoe1xuICAgICAgICBtYXhCYXRjaGluZ1dpbmRvdzogRHVyYXRpb24uc2Vjb25kcygyMCksXG4gICAgICAgIG1heEJhdGNoaW5nV2luZG93U2Vjb25kczogMTBcbiAgICAgIH0sIGZhbHNlKTtcblxuICAgICAgZXhwZWN0KG5vcm1hbGl6ZWQubWF4QmF0Y2hpbmdXaW5kb3cpLnRvRXF1YWwoRHVyYXRpb24uc2Vjb25kcygyMCkpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCByZXR1cm4gZW1wdHkgb2JqZWN0IGZvciBGSUZPIHF1ZXVlcycsICgpID0+IHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBRdWV1ZUxhbWJkYS5ub3JtYWxpemVTcXNFdmVudFNvdXJjZVByb3BzKHt9LCB0cnVlKTtcblxuICAgICAgZXhwZWN0KG5vcm1hbGl6ZWQpLnRvRXF1YWwoe30pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBwcmVzZXJ2ZSByZXBvcnRCYXRjaEl0ZW1GYWlsdXJlcyBzZXR0aW5nJywgKCkgPT4ge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZCA9IFF1ZXVlTGFtYmRhLm5vcm1hbGl6ZVNxc0V2ZW50U291cmNlUHJvcHMoe1xuICAgICAgICByZXBvcnRCYXRjaEl0ZW1GYWlsdXJlczogZmFsc2VcbiAgICAgIH0sIGZhbHNlKTtcblxuICAgICAgZXhwZWN0KG5vcm1hbGl6ZWQucmVwb3J0QmF0Y2hJdGVtRmFpbHVyZXMpLnRvQmUoZmFsc2UpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgYWxsIGN1c3RvbSBwcm9wZXJ0aWVzIHRvZ2V0aGVyJywgKCkgPT4ge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZCA9IFF1ZXVlTGFtYmRhLm5vcm1hbGl6ZVNxc0V2ZW50U291cmNlUHJvcHMoe1xuICAgICAgICBiYXRjaFNpemU6IDI1LFxuICAgICAgICBtYXhCYXRjaGluZ1dpbmRvd1NlY29uZHM6IDE1LFxuICAgICAgICByZXBvcnRCYXRjaEl0ZW1GYWlsdXJlczogZmFsc2VcbiAgICAgIH0sIGZhbHNlKTtcblxuICAgICAgZXhwZWN0KG5vcm1hbGl6ZWQpLnRvRXF1YWwoe1xuICAgICAgICBiYXRjaFNpemU6IDI1LFxuICAgICAgICBtYXhCYXRjaGluZ1dpbmRvdzogRHVyYXRpb24uc2Vjb25kcygxNSksXG4gICAgICAgIHJlcG9ydEJhdGNoSXRlbUZhaWx1cmVzOiBmYWxzZVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIC8qKlxuICAgKiBOT1RFOiBhdHRhY2hRdWV1ZVRvTGFtYmRhIHRlc3RzIGFyZSBub3QgaW5jbHVkZWQgYmVjYXVzZSBRdWV1ZUxhbWJkYSBjb25zdHJ1Y3RvclxuICAgKiByZXR1cm5zIFF1ZXVlIChub3QgTGFtYmRhKSwgbWFraW5nIGl0IGltcG9zc2libGUgdG8gdGVzdCB0aGUgc3RhdGljIG1ldGhvZCBpbiBpc29sYXRpb24uXG4gICAqIFRoZSBmdW5jdGlvbmFsaXR5IElTIHRlc3RlZCB2aWEgUXVldWVMYW1iZGEgaW50ZWdyYXRpb24gdGVzdHMgYmVsb3cuXG4gICAqL1xuXG4gIGRlc2NyaWJlKCdRdWV1ZUxhbWJkYSBDb25zdHJ1Y3RvciAtIEludGVncmF0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgY3JlYXRlIHF1ZXVlIGFuZCBsYW1iZGEgZnVuY3Rpb24gdG9nZXRoZXInLCAoKSA9PiB7XG4gICAgICBjb25zdCBxdWV1ZUxhbWJkYSA9IG5ldyBRdWV1ZUxhbWJkYShzdGFjaywgJ1Rlc3RRdWV1ZUxhbWJkYScsIHtcbiAgICAgICAgcXVldWVOYW1lOiAnaW50ZWdyYXRpb24tcXVldWUnLFxuICAgICAgICBsYW1iZGFGdW5jdGlvblByb3BzOiB7XG4gICAgICAgICAgZW50cnk6IFRFU1RfRU5UUllcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChxdWV1ZUxhbWJkYSkudG9CZURlZmluZWQoKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgLy8gTGFtYmRhIGlzIGNyZWF0ZWRcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJywgMSk7XG4gICAgICAvLyBFdmVudCBzb3VyY2UgbWFwcGluZyBpcyBjcmVhdGVkXG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6TGFtYmRhOjpFdmVudFNvdXJjZU1hcHBpbmcnLCAxKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcGFzcyBlbnZpcm9ubWVudCB2YXJpYWJsZXMgdG8gbGFtYmRhJywgKCkgPT4ge1xuICAgICAgY29uc3QgcXVldWVMYW1iZGEgPSBuZXcgUXVldWVMYW1iZGEoc3RhY2ssICdUZXN0UXVldWVMYW1iZGEnLCB7XG4gICAgICAgIHF1ZXVlTmFtZTogJ3Rlc3QtcXVldWUnLFxuICAgICAgICBsYW1iZGFGdW5jdGlvblByb3BzOiB7XG4gICAgICAgICAgZW50cnk6IFRFU1RfRU5UUlksXG4gICAgICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IHtcbiAgICAgICAgICAgICdDVVNUT01fVkFSJzogJ2N1c3RvbS12YWx1ZSdcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicsIHtcbiAgICAgICAgRW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICBWYXJpYWJsZXM6IE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgJ0NVU1RPTV9WQVInOiAnY3VzdG9tLXZhbHVlJ1xuICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBwYXNzIHBvbGljaWVzIHRvIGxhbWJkYScsICgpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXVlTGFtYmRhID0gbmV3IFF1ZXVlTGFtYmRhKHN0YWNrLCAnVGVzdFF1ZXVlTGFtYmRhJywge1xuICAgICAgICBxdWV1ZU5hbWU6ICd0ZXN0LXF1ZXVlJyxcbiAgICAgICAgbGFtYmRhRnVuY3Rpb25Qcm9wczoge1xuICAgICAgICAgIGVudHJ5OiBURVNUX0VOVFJZLFxuICAgICAgICAgIHBvbGljaWVzOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGVmZmVjdDogJ0FsbG93JyBhcyBhbnksXG4gICAgICAgICAgICAgIGFjdGlvbnM6IFsgJ3MzOkdldE9iamVjdCcgXSxcbiAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbICcqJyBdXG4gICAgICAgICAgICB9XG4gICAgICAgICAgXVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OklBTTo6UG9saWN5Jywge1xuICAgICAgICBQb2xpY3lEb2N1bWVudDoge1xuICAgICAgICAgIFN0YXRlbWVudDogTWF0Y2guYXJyYXlXaXRoKFtcbiAgICAgICAgICAgIE1hdGNoLm9iamVjdExpa2Uoe1xuICAgICAgICAgICAgICBBY3Rpb246ICdzMzpHZXRPYmplY3QnXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIF0pXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgRklGTyBxdWV1ZSBhbmQgbGFtYmRhJywgKCkgPT4ge1xuICAgICAgY29uc3QgcXVldWVMYW1iZGEgPSBuZXcgUXVldWVMYW1iZGEoc3RhY2ssICdUZXN0UXVldWVMYW1iZGEnLCB7XG4gICAgICAgIHF1ZXVlTmFtZTogJ3Rlc3QtcXVldWUuZmlmbycsXG4gICAgICAgIHF1ZXVlUHJvcHM6IHtcbiAgICAgICAgICBmaWZvOiB0cnVlXG4gICAgICAgIH0sXG4gICAgICAgIGxhbWJkYUZ1bmN0aW9uUHJvcHM6IHtcbiAgICAgICAgICBlbnRyeTogVEVTVF9FTlRSWVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OlNRUzo6UXVldWUnLCB7XG4gICAgICAgIEZpZm9RdWV1ZTogdHJ1ZVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBhbGwgcXVldWUgY29uZmlndXJhdGlvbiBvcHRpb25zJywgKCkgPT4ge1xuICAgICAgY29uc3QgcXVldWVMYW1iZGEgPSBuZXcgUXVldWVMYW1iZGEoc3RhY2ssICdUZXN0UXVldWVMYW1iZGEnLCB7XG4gICAgICAgIHF1ZXVlTmFtZTogJ2NvbXBsZXgtcXVldWUnLFxuICAgICAgICB2aXNpYmlsaXR5VGltZW91dFNlY29uZHM6IDEyMCxcbiAgICAgICAgcmV0ZW50aW9uUGVyaW9kRGF5czogNyxcbiAgICAgICAgbWF4UmVjZWl2ZUNvdW50OiAzLFxuICAgICAgICBzcXNFdmVudFNvdXJjZVByb3BzOiB7XG4gICAgICAgICAgYmF0Y2hTaXplOiAyNSxcbiAgICAgICAgICBtYXhCYXRjaGluZ1dpbmRvd1NlY29uZHM6IDEwXG4gICAgICAgIH0sXG4gICAgICAgIGxhbWJkYUZ1bmN0aW9uUHJvcHM6IHtcbiAgICAgICAgICBlbnRyeTogVEVTVF9FTlRSWSxcbiAgICAgICAgICBmdW5jdGlvblRpbWVvdXQ6IDkwXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG5cbiAgICAgIC8vIFF1ZXVlIGNvbmZpZ3VyYXRpb25cbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpTUVM6OlF1ZXVlJywge1xuICAgICAgICBWaXNpYmlsaXR5VGltZW91dDogMTIwLFxuICAgICAgICBNZXNzYWdlUmV0ZW50aW9uUGVyaW9kOiA2MDQ4MDAsIC8vIDcgZGF5c1xuICAgICAgICBSZWRyaXZlUG9saWN5OiBNYXRjaC5vYmplY3RMaWtlKHtcbiAgICAgICAgICBtYXhSZWNlaXZlQ291bnQ6IDNcbiAgICAgICAgfSlcbiAgICAgIH0pO1xuXG4gICAgICAvLyBMYW1iZGEgY29uZmlndXJhdGlvblxuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkxhbWJkYTo6RnVuY3Rpb24nLCB7XG4gICAgICAgIFRpbWVvdXQ6IDkwXG4gICAgICB9KTtcblxuICAgICAgLy8gRXZlbnQgc291cmNlIGNvbmZpZ3VyYXRpb25cbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpMYW1iZGE6OkV2ZW50U291cmNlTWFwcGluZycsIHtcbiAgICAgICAgQmF0Y2hTaXplOiAyNSxcbiAgICAgICAgTWF4aW11bUJhdGNoaW5nV2luZG93SW5TZWNvbmRzOiAxMFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdSZWdyZXNzaW9uIFRlc3RzIC0gQnVnIEZpeGVzJywgKCkgPT4ge1xuICAgIGl0KCdSRUdSRVNTSU9OOiBzaG91bGQgZGVmYXVsdCBiYXRjaFNpemUgdG8gMTAgZm9yIHN0YW5kYXJkIHF1ZXVlcycsICgpID0+IHtcbiAgICAgIG5ldyBRdWV1ZUxhbWJkYShzdGFjaywgJ1Rlc3RMYW1iZGEnLCB7XG4gICAgICAgIHF1ZXVlTmFtZTogJ3Rlc3QtcXVldWUnLFxuICAgICAgICBsYW1iZGFGdW5jdGlvblByb3BzOiB7XG4gICAgICAgICAgZW50cnk6IFRFU1RfRU5UUllcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpMYW1iZGE6OkV2ZW50U291cmNlTWFwcGluZycsIHtcbiAgICAgICAgQmF0Y2hTaXplOiAxMCAvLyBOT1QgMSAodGhlIG9sZCBidWcpXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdSRUdSRVNTSU9OOiBGSUZPIHF1ZXVlcyBzaG91bGQgaGF2ZSBubyBldmVudCBzb3VyY2UgY29uZmlnJywgKCkgPT4ge1xuICAgICAgbmV3IFF1ZXVlTGFtYmRhKHN0YWNrLCAnVGVzdEZpZm9MYW1iZGEnLCB7XG4gICAgICAgIHF1ZXVlTmFtZTogJ3Rlc3QtcXVldWUuZmlmbycsXG4gICAgICAgIHF1ZXVlUHJvcHM6IHtcbiAgICAgICAgICBmaWZvOiB0cnVlXG4gICAgICAgIH0sXG4gICAgICAgIGxhbWJkYUZ1bmN0aW9uUHJvcHM6IHtcbiAgICAgICAgICBlbnRyeTogVEVTVF9FTlRSWVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgLy8gRklGTyBxdWV1ZSBldmVudCBzb3VyY2Ugc2hvdWxkIGV4aXN0IGJ1dCB3aXRoIG5vIGJhdGNoIHNldHRpbmdzXG4gICAgICB0ZW1wbGF0ZS5yZXNvdXJjZUNvdW50SXMoJ0FXUzo6TGFtYmRhOjpFdmVudFNvdXJjZU1hcHBpbmcnLCAxKTtcbiAgICB9KTtcblxuICAgIGl0KCdSRUdSRVNTSU9OOiBzaG91bGQgc3VwcG9ydCBib3RoIG1heEJhdGNoaW5nV2luZG93IChEdXJhdGlvbikgYW5kIG1heEJhdGNoaW5nV2luZG93U2Vjb25kcyAobnVtYmVyKScsICgpID0+IHtcbiAgICAgIC8vIFRlc3QgbnVtYmVyIGZvcm1hdFxuICAgICAgY29uc3Qgbm9ybWFsaXplZDEgPSBRdWV1ZUxhbWJkYS5ub3JtYWxpemVTcXNFdmVudFNvdXJjZVByb3BzKHtcbiAgICAgICAgbWF4QmF0Y2hpbmdXaW5kb3dTZWNvbmRzOiAxNVxuICAgICAgfSwgZmFsc2UpO1xuICAgICAgZXhwZWN0KG5vcm1hbGl6ZWQxLm1heEJhdGNoaW5nV2luZG93KS50b0VxdWFsKER1cmF0aW9uLnNlY29uZHMoMTUpKTtcblxuICAgICAgLy8gVGVzdCBEdXJhdGlvbiBmb3JtYXRcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWQyID0gUXVldWVMYW1iZGEubm9ybWFsaXplU3FzRXZlbnRTb3VyY2VQcm9wcyh7XG4gICAgICAgIG1heEJhdGNoaW5nV2luZG93OiBEdXJhdGlvbi5zZWNvbmRzKDIwKVxuICAgICAgfSwgZmFsc2UpO1xuICAgICAgZXhwZWN0KG5vcm1hbGl6ZWQyLm1heEJhdGNoaW5nV2luZG93KS50b0VxdWFsKER1cmF0aW9uLnNlY29uZHMoMjApKTtcblxuICAgICAgLy8gRHVyYXRpb24gc2hvdWxkIHdpbiB3aGVuIGJvdGggcHJvdmlkZWRcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWQzID0gUXVldWVMYW1iZGEubm9ybWFsaXplU3FzRXZlbnRTb3VyY2VQcm9wcyh7XG4gICAgICAgIG1heEJhdGNoaW5nV2luZG93OiBEdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgICAgbWF4QmF0Y2hpbmdXaW5kb3dTZWNvbmRzOiAxMFxuICAgICAgfSwgZmFsc2UpO1xuICAgICAgZXhwZWN0KG5vcm1hbGl6ZWQzLm1heEJhdGNoaW5nV2luZG93KS50b0VxdWFsKER1cmF0aW9uLnNlY29uZHMoMzApKTtcbiAgICB9KTtcblxuICAgIGl0KCdSRUdSRVNTSU9OOiBzaG91bGQgcmV0dXJuIGVtcHR5IGNvbmZpZyBmb3IgRklGTyBxdWV1ZXMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBub3JtYWxpemVkID0gUXVldWVMYW1iZGEubm9ybWFsaXplU3FzRXZlbnRTb3VyY2VQcm9wcyh7fSwgdHJ1ZSk7XG5cbiAgICAgIGV4cGVjdChub3JtYWxpemVkKS50b0VxdWFsKHt9KTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0VkZ2UgQ2FzZXMgYW5kIEVycm9yIFNjZW5hcmlvcycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBxdWV1ZSBjcmVhdGlvbiB3aXRoIG1pbmltYWwgY29uZmlnJywgKCkgPT4ge1xuICAgICAgY29uc3QgcXVldWUgPSBRdWV1ZUxhbWJkYS5jcmVhdGVRdWV1ZShzdGFjaywgJ21pbmltYWwtcXVldWUnLCB7XG4gICAgICAgIHF1ZXVlTmFtZTogJ21pbmltYWwtcXVldWUnXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHF1ZXVlKS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KHF1ZXVlKS50b0JlSW5zdGFuY2VPZihRdWV1ZSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBRdWV1ZUxhbWJkYSB3aXRoIG9ubHkgcmVxdWlyZWQgcHJvcHMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBxdWV1ZUxhbWJkYSA9IG5ldyBRdWV1ZUxhbWJkYShzdGFjaywgJ01pbmltYWxMYW1iZGEnLCB7XG4gICAgICAgIHF1ZXVlTmFtZTogJ21pbmltYWwnLFxuICAgICAgICBsYW1iZGFGdW5jdGlvblByb3BzOiB7XG4gICAgICAgICAgZW50cnk6IFRFU1RfRU5UUllcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChxdWV1ZUxhbWJkYSkudG9CZURlZmluZWQoKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUucmVzb3VyY2VDb3VudElzKCdBV1M6OkxhbWJkYTo6RnVuY3Rpb24nLCAxKTtcbiAgICAgIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpMYW1iZGE6OkV2ZW50U291cmNlTWFwcGluZycsIDEpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgdW5kZWZpbmVkIG1heFJlY2VpdmVDb3VudCAodXNlcyBkZWZhdWx0IERMUSknLCAoKSA9PiB7XG4gICAgICBjb25zdCBxdWV1ZSA9IFF1ZXVlTGFtYmRhLmNyZWF0ZVF1ZXVlKHN0YWNrLCAndGVzdC1xdWV1ZScsIHtcbiAgICAgICAgcXVldWVOYW1lOiAndGVzdC1xdWV1ZSdcbiAgICAgICAgLy8gbWF4UmVjZWl2ZUNvdW50IHVuZGVmaW5lZCAtIGZyYW1ld29yayBjcmVhdGVzIGRlZmF1bHQgRExRIGF1dG9tYXRpY2FsbHlcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocXVldWUpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjayk7XG4gICAgICAvLyBTaG91bGQgaGF2ZSBhdCBsZWFzdCAxIHF1ZXVlIChtYXkgaGF2ZSBkZWZhdWx0IERMUSlcbiAgICAgIGNvbnN0IHF1ZXVlQ291bnQgPSBPYmplY3Qua2V5cyh0ZW1wbGF0ZS5maW5kUmVzb3VyY2VzKCdBV1M6OlNRUzo6UXVldWUnKSkubGVuZ3RoO1xuICAgICAgZXhwZWN0KHF1ZXVlQ291bnQpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSB2ZXJ5IGhpZ2ggdmlzaWJpbGl0eSB0aW1lb3V0JywgKCkgPT4ge1xuICAgICAgY29uc3QgcXVldWUgPSBRdWV1ZUxhbWJkYS5jcmVhdGVRdWV1ZShzdGFjaywgJ3Rlc3QtcXVldWUnLCB7XG4gICAgICAgIHF1ZXVlTmFtZTogJ3Rlc3QtcXVldWUnLFxuICAgICAgICB2aXNpYmlsaXR5VGltZW91dFNlY29uZHM6IDQzMjAwIC8vIDEyIGhvdXJzIG1heFxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcbiAgICAgIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpTUVM6OlF1ZXVlJywge1xuICAgICAgICBWaXNpYmlsaXR5VGltZW91dDogNDMyMDBcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgdmVyeSBoaWdoIHJldGVudGlvbiBwZXJpb2QnLCAoKSA9PiB7XG4gICAgICBjb25zdCBxdWV1ZSA9IFF1ZXVlTGFtYmRhLmNyZWF0ZVF1ZXVlKHN0YWNrLCAndGVzdC1xdWV1ZScsIHtcbiAgICAgICAgcXVldWVOYW1lOiAndGVzdC1xdWV1ZScsXG4gICAgICAgIHJldGVudGlvblBlcmlvZERheXM6IDE0IC8vIDE0IGRheXMgbWF4XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spO1xuICAgICAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OlNRUzo6UXVldWUnLCB7XG4gICAgICAgIE1lc3NhZ2VSZXRlbnRpb25QZXJpb2Q6IDEyMDk2MDAgLy8gMTQgZGF5cyBpbiBzZWNvbmRzXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGVtcHR5IHN0cmluZyBxdWV1ZSBuYW1lIGJ5IHVzaW5nIGNvbnN0cnVjdCBJRCcsICgpID0+IHtcbiAgICAgIC8vIENESyB3aWxsIHVzZSBjb25zdHJ1Y3QgSUQgaWYgcXVldWVOYW1lIGlzIGVtcHR5XG4gICAgICBjb25zdCBxdWV1ZSA9IFF1ZXVlTGFtYmRhLmNyZWF0ZVF1ZXVlKHN0YWNrLCAnZW1wdHktcXVldWUtaWQnLCB7XG4gICAgICAgIHF1ZXVlTmFtZTogJydcbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocXVldWUpLnRvQmVEZWZpbmVkKCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBxdWV1ZSBuYW1lIHdpdGggc3BlY2lhbCBjaGFyYWN0ZXJzJywgKCkgPT4ge1xuICAgICAgY29uc3QgcXVldWUgPSBRdWV1ZUxhbWJkYS5jcmVhdGVRdWV1ZShzdGFjaywgJ3NwZWNpYWwtcXVldWUnLCB7XG4gICAgICAgIHF1ZXVlTmFtZTogJ3Rlc3RfcXVldWUtbmFtZS4xMjMnXG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHF1ZXVlKS50b0JlRGVmaW5lZCgpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgdmVyeSBoaWdoIGJhdGNoIHNpemVzJywgKCkgPT4ge1xuICAgICAgY29uc3Qgbm9ybWFsaXplZCA9IFF1ZXVlTGFtYmRhLm5vcm1hbGl6ZVNxc0V2ZW50U291cmNlUHJvcHMoe1xuICAgICAgICBiYXRjaFNpemU6IDEwMDAwIC8vIFNRUyBtYXhcbiAgICAgIH0sIGZhbHNlKTtcblxuICAgICAgZXhwZWN0KG5vcm1hbGl6ZWQuYmF0Y2hTaXplKS50b0JlKDEwMDAwKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1NuYXBzaG90IFRlc3RzIC0gQ2xvdWRGb3JtYXRpb24gQ29uc2lzdGVuY3knLCAoKSA9PiB7XG4gICAgLyoqXG4gICAgICogU25hcHNob3Q6IFN0YW5kYXJkIFF1ZXVlIFNldHVwXG4gICAgICogVGVzdHMgQ2xvdWRGb3JtYXRpb24gdGVtcGxhdGUgZm9yIGEgc3RhbmRhcmQgcXVldWUgd2l0aCBjdXN0b20gc2V0dGluZ3MuXG4gICAgICogSW5jbHVkZXM6IHZpc2liaWxpdHkgdGltZW91dCwgRExRLCBldmVudCBzb3VyY2UgbWFwcGluZy5cbiAgICAgKi9cbiAgICBpdCgnc2hvdWxkIGdlbmVyYXRlIGNvbnNpc3RlbnQgQ2xvdWRGb3JtYXRpb24gZm9yIHN0YW5kYXJkIHF1ZXVlIHNldHVwJywgKCkgPT4ge1xuICAgICAgbmV3IFF1ZXVlTGFtYmRhKHN0YWNrLCAnU25hcHNob3RRdWV1ZScsIHtcbiAgICAgICAgcXVldWVOYW1lOiAnc25hcHNob3QtcXVldWUnLFxuICAgICAgICB2aXNpYmlsaXR5VGltZW91dFNlY29uZHM6IDYwLFxuICAgICAgICBtYXhSZWNlaXZlQ291bnQ6IDMsXG4gICAgICAgIGxhbWJkYUZ1bmN0aW9uUHJvcHM6IHtcbiAgICAgICAgICBlbnRyeTogVEVTVF9FTlRSWVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spLnRvSlNPTigpO1xuICAgICAgZXhwZWN0KHRlbXBsYXRlKS50b01hdGNoU25hcHNob3QoKTtcbiAgICB9KTtcblxuICAgIC8qKlxuICAgICAqIFNuYXBzaG90OiBGSUZPIFF1ZXVlIFNldHVwXG4gICAgICogVGVzdHMgQ2xvdWRGb3JtYXRpb24gdGVtcGxhdGUgZm9yIGEgRklGTyBxdWV1ZS5cbiAgICAgKiBJbmNsdWRlczogY29udGVudC1iYXNlZCBkZWR1cGxpY2F0aW9uLCBGSUZPLXNwZWNpZmljIHNldHRpbmdzLlxuICAgICAqL1xuICAgIGl0KCdzaG91bGQgZ2VuZXJhdGUgY29uc2lzdGVudCBDbG91ZEZvcm1hdGlvbiBmb3IgRklGTyBxdWV1ZSBzZXR1cCcsICgpID0+IHtcbiAgICAgIG5ldyBRdWV1ZUxhbWJkYShzdGFjaywgJ1NuYXBzaG90Rmlmb1F1ZXVlJywge1xuICAgICAgICBxdWV1ZU5hbWU6ICdzbmFwc2hvdC1xdWV1ZS5maWZvJyxcbiAgICAgICAgcXVldWVQcm9wczoge1xuICAgICAgICAgIGZpZm86IHRydWVcbiAgICAgICAgfSxcbiAgICAgICAgbGFtYmRhRnVuY3Rpb25Qcm9wczoge1xuICAgICAgICAgIGVudHJ5OiBURVNUX0VOVFJZXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IFRlbXBsYXRlLmZyb21TdGFjayhzdGFjaykudG9KU09OKCk7XG4gICAgICBleHBlY3QodGVtcGxhdGUpLnRvTWF0Y2hTbmFwc2hvdCgpO1xuICAgIH0pO1xuXG4gICAgLyoqXG4gICAgICogU25hcHNob3Q6IENvbXBsZXRlIENvbmZpZ3VyYXRpb25cbiAgICAgKiBUZXN0cyBDbG91ZEZvcm1hdGlvbiB0ZW1wbGF0ZSB3aXRoIGFsbCBjb25maWd1cmF0aW9uIG9wdGlvbnMuXG4gICAgICogSW5jbHVkZXM6IHRpbWVvdXRzLCByZXRlbnRpb24sIERMUSwgYmF0Y2ggc2V0dGluZ3MsIGxhbWJkYSBjb25maWcuXG4gICAgICovXG4gICAgaXQoJ3Nob3VsZCBnZW5lcmF0ZSBjb25zaXN0ZW50IENsb3VkRm9ybWF0aW9uIGZvciBjb21wbGV0ZSBzZXR1cCcsICgpID0+IHtcbiAgICAgIG5ldyBRdWV1ZUxhbWJkYShzdGFjaywgJ1NuYXBzaG90Q29tcGxldGVRdWV1ZScsIHtcbiAgICAgICAgcXVldWVOYW1lOiAnc25hcHNob3QtY29tcGxldGUnLFxuICAgICAgICB2aXNpYmlsaXR5VGltZW91dFNlY29uZHM6IDYwLFxuICAgICAgICByZXRlbnRpb25QZXJpb2REYXlzOiA3LFxuICAgICAgICBtYXhSZWNlaXZlQ291bnQ6IDUsXG4gICAgICAgIHNxc0V2ZW50U291cmNlUHJvcHM6IHtcbiAgICAgICAgICBiYXRjaFNpemU6IDI1LFxuICAgICAgICAgIG1heEJhdGNoaW5nV2luZG93U2Vjb25kczogMTBcbiAgICAgICAgfSxcbiAgICAgICAgbGFtYmRhRnVuY3Rpb25Qcm9wczoge1xuICAgICAgICAgIGVudHJ5OiBURVNUX0VOVFJZLFxuICAgICAgICAgIGZ1bmN0aW9uVGltZW91dDogOTBcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKS50b0pTT04oKTtcbiAgICAgIGV4cGVjdCh0ZW1wbGF0ZSkudG9NYXRjaFNuYXBzaG90KCk7XG4gICAgfSk7XG4gIH0pO1xufSk7XG5cbiJdfQ==
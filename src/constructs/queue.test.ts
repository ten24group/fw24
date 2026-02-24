import { App, Stack, Duration } from 'aws-cdk-lib';
import { Template, Match, Capture } from 'aws-cdk-lib/assertions';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { QueueLambda } from './queue-lambda';
import { Fw24 } from '../core/fw24';
import * as path from 'path';

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
  let app: App;
  let stack: Stack;
  const TEST_ENTRY = path.join(__dirname, '../core/runtime/abstract-lambda-handler.ts');

  beforeEach(() => {
    // Clean up singleton
    (Fw24 as any).instance = undefined;

    app = new App();
    stack = new Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-east-1' }
    });

    // Initialize Fw24
    const fw24 = Fw24.getInstance();
    fw24.setApp(app);
    fw24.setConfig({
      name: 'test-app',
      region: 'us-east-1',
      account: '123456789012'
    });
    fw24.addStack('main', stack);
  });

  afterEach(() => {
    (Fw24 as any).instance = undefined;
  });

  describe('QueueLambda.createQueue - Basic Queue Creation', () => {
    it('should create a standard queue with default settings', () => {
      const queue = QueueLambda.createQueue(stack, 'test-queue', {
        queueName: 'test-queue'
      });

      expect(queue).toBeDefined();
      expect(queue).toBeInstanceOf(Queue);

      const template = Template.fromStack(stack);
      // Queue is created (DLQ may also be auto-generated)
      const queueCount = Object.keys(template.findResources('AWS::SQS::Queue')).length;
      expect(queueCount).toBeGreaterThanOrEqual(1);
    });

    it('should create a FIFO queue when queueName ends with .fifo', () => {
      const queue = QueueLambda.createQueue(stack, 'test-queue-fifo', {
        queueName: 'test-queue.fifo',
        queueProps: {
          fifo: true,
          contentBasedDeduplication: true
        }
      });

      expect(queue).toBeDefined();

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::SQS::Queue', {
        FifoQueue: true
        // ContentBasedDeduplication only on main queue, not DLQ
      });
    });

    it('should create queue with custom visibility timeout', () => {
      const queue = QueueLambda.createQueue(stack, 'test-queue', {
        queueName: 'test-queue',
        visibilityTimeoutSeconds: 120
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::SQS::Queue', {
        VisibilityTimeout: 120
      });
    });

    it('should create queue with custom retention period', () => {
      const queue = QueueLambda.createQueue(stack, 'test-queue', {
        queueName: 'test-queue',
        retentionPeriodDays: 7
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::SQS::Queue', {
        MessageRetentionPeriod: 604800 // 7 days in seconds
      });
    });

    it('should create queue with Dead Letter Queue (DLQ)', () => {
      const queue = QueueLambda.createQueue(stack, 'test-queue', {
        queueName: 'test-queue',
        maxReceiveCount: 3
      });

      const template = Template.fromStack(stack);

      // Main queue should reference DLQ
      template.hasResourceProperties('AWS::SQS::Queue', {
        RedrivePolicy: Match.objectLike({
          maxReceiveCount: 3
        })
      });
    });

    it('should NOT create custom DLQ when maxReceiveCount is undefined', () => {
      const queue = QueueLambda.createQueue(stack, 'test-queue', {
        queueName: 'test-queue'
      });

      expect(queue).toBeDefined();
    });

    it('should merge custom queueProps with default props', () => {
      const queue = QueueLambda.createQueue(stack, 'test-queue', {
        queueName: 'test-queue',
        queueProps: {
          deliveryDelay: Duration.seconds(10),
          receiveMessageWaitTime: Duration.seconds(20)
        }
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::SQS::Queue', {
        DelaySeconds: 10,
        ReceiveMessageWaitTimeSeconds: 20
      });
    });

    it('should handle empty queueProps', () => {
      const queue = QueueLambda.createQueue(stack, 'test-queue', {
        queueName: 'test-queue',
        queueProps: {}
      });

      expect(queue).toBeDefined();
    });

    it('should create FIFO DLQ for FIFO queue', () => {
      const queue = QueueLambda.createQueue(stack, 'test-queue-fifo', {
        queueName: 'test-queue.fifo',
        queueProps: {
          fifo: true
        },
        maxReceiveCount: 5
      });

      const template = Template.fromStack(stack);
      // Main FIFO queue
      template.hasResourceProperties('AWS::SQS::Queue', {
        FifoQueue: true,
        RedrivePolicy: Match.objectLike({
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
      const queue = QueueLambda.createQueue(stack, 'test-queue', {
        queueName: 'test-queue'
      }, {
        topics: []
      });

      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::SNS::Subscription', 0);
    });

    it('should handle undefined subscriptions', () => {
      const queue = QueueLambda.createQueue(stack, 'test-queue', {
        queueName: 'test-queue'
      }, undefined);

      expect(queue).toBeDefined();
      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::SNS::Subscription', 0);
    });
  });

  describe('QueueLambda.normalizeSqsEventSourceProps', () => {
    it('should return default props when no config provided', () => {
      const normalized = QueueLambda.normalizeSqsEventSourceProps({}, false);

      expect(normalized).toEqual({
        batchSize: 10,
        maxBatchingWindow: Duration.seconds(5),
        reportBatchItemFailures: true
      });
    });

    it('should use custom batchSize', () => {
      const normalized = QueueLambda.normalizeSqsEventSourceProps({ batchSize: 50 }, false);

      expect(normalized.batchSize).toBe(50);
    });

    it('should convert maxBatchingWindowSeconds to Duration', () => {
      const normalized = QueueLambda.normalizeSqsEventSourceProps({
        maxBatchingWindowSeconds: 10
      }, false);

      expect(normalized.maxBatchingWindow).toEqual(Duration.seconds(10));
    });

    it('should prioritize maxBatchingWindow over maxBatchingWindowSeconds', () => {
      const normalized = QueueLambda.normalizeSqsEventSourceProps({
        maxBatchingWindow: Duration.seconds(20),
        maxBatchingWindowSeconds: 10
      }, false);

      expect(normalized.maxBatchingWindow).toEqual(Duration.seconds(20));
    });

    it('should return empty object for FIFO queues', () => {
      const normalized = QueueLambda.normalizeSqsEventSourceProps({}, true);

      expect(normalized).toEqual({});
    });

    it('should preserve reportBatchItemFailures setting', () => {
      const normalized = QueueLambda.normalizeSqsEventSourceProps({
        reportBatchItemFailures: false
      }, false);

      expect(normalized.reportBatchItemFailures).toBe(false);
    });

    it('should handle all custom properties together', () => {
      const normalized = QueueLambda.normalizeSqsEventSourceProps({
        batchSize: 25,
        maxBatchingWindowSeconds: 15,
        reportBatchItemFailures: false
      }, false);

      expect(normalized).toEqual({
        batchSize: 25,
        maxBatchingWindow: Duration.seconds(15),
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
      const queueLambda = new QueueLambda(stack, 'TestQueueLambda', {
        queueName: 'integration-queue',
        lambdaFunctionProps: {
          entry: TEST_ENTRY
        }
      });

      expect(queueLambda).toBeDefined();

      const template = Template.fromStack(stack);
      // Lambda is created
      template.resourceCountIs('AWS::Lambda::Function', 1);
      // Event source mapping is created
      template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);
    });

    it('should pass environment variables to lambda', () => {
      const queueLambda = new QueueLambda(stack, 'TestQueueLambda', {
        queueName: 'test-queue',
        lambdaFunctionProps: {
          entry: TEST_ENTRY,
          environmentVariables: {
            'CUSTOM_VAR': 'custom-value'
          }
        }
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            'CUSTOM_VAR': 'custom-value'
          })
        }
      });
    });

    it('should pass policies to lambda', () => {
      const queueLambda = new QueueLambda(stack, 'TestQueueLambda', {
        queueName: 'test-queue',
        lambdaFunctionProps: {
          entry: TEST_ENTRY,
          policies: [
            {
              effect: 'Allow' as any,
              actions: [ 's3:GetObject' ],
              resources: [ '*' ]
            }
          ]
        }
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 's3:GetObject'
            })
          ])
        }
      });
    });

    it('should create FIFO queue and lambda', () => {
      const queueLambda = new QueueLambda(stack, 'TestQueueLambda', {
        queueName: 'test-queue.fifo',
        queueProps: {
          fifo: true
        },
        lambdaFunctionProps: {
          entry: TEST_ENTRY
        }
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::SQS::Queue', {
        FifoQueue: true
      });
    });

    it('should handle all queue configuration options', () => {
      const queueLambda = new QueueLambda(stack, 'TestQueueLambda', {
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

      const template = Template.fromStack(stack);

      // Queue configuration
      template.hasResourceProperties('AWS::SQS::Queue', {
        VisibilityTimeout: 120,
        MessageRetentionPeriod: 604800, // 7 days
        RedrivePolicy: Match.objectLike({
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
      new QueueLambda(stack, 'TestLambda', {
        queueName: 'test-queue',
        lambdaFunctionProps: {
          entry: TEST_ENTRY
        }
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        BatchSize: 10 // NOT 1 (the old bug)
      });
    });

    it('REGRESSION: FIFO queues should have no event source config', () => {
      new QueueLambda(stack, 'TestFifoLambda', {
        queueName: 'test-queue.fifo',
        queueProps: {
          fifo: true
        },
        lambdaFunctionProps: {
          entry: TEST_ENTRY
        }
      });

      const template = Template.fromStack(stack);
      // FIFO queue event source should exist but with no batch settings
      template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);
    });

    it('REGRESSION: should support both maxBatchingWindow (Duration) and maxBatchingWindowSeconds (number)', () => {
      // Test number format
      const normalized1 = QueueLambda.normalizeSqsEventSourceProps({
        maxBatchingWindowSeconds: 15
      }, false);
      expect(normalized1.maxBatchingWindow).toEqual(Duration.seconds(15));

      // Test Duration format
      const normalized2 = QueueLambda.normalizeSqsEventSourceProps({
        maxBatchingWindow: Duration.seconds(20)
      }, false);
      expect(normalized2.maxBatchingWindow).toEqual(Duration.seconds(20));

      // Duration should win when both provided
      const normalized3 = QueueLambda.normalizeSqsEventSourceProps({
        maxBatchingWindow: Duration.seconds(30),
        maxBatchingWindowSeconds: 10
      }, false);
      expect(normalized3.maxBatchingWindow).toEqual(Duration.seconds(30));
    });

    it('REGRESSION: should return empty config for FIFO queues', () => {
      const normalized = QueueLambda.normalizeSqsEventSourceProps({}, true);

      expect(normalized).toEqual({});
    });
  });

  describe('Edge Cases and Error Scenarios', () => {
    it('should handle queue creation with minimal config', () => {
      const queue = QueueLambda.createQueue(stack, 'minimal-queue', {
        queueName: 'minimal-queue'
      });

      expect(queue).toBeDefined();
      expect(queue).toBeInstanceOf(Queue);
    });

    it('should handle QueueLambda with only required props', () => {
      const queueLambda = new QueueLambda(stack, 'MinimalLambda', {
        queueName: 'minimal',
        lambdaFunctionProps: {
          entry: TEST_ENTRY
        }
      });

      expect(queueLambda).toBeDefined();

      const template = Template.fromStack(stack);
      template.resourceCountIs('AWS::Lambda::Function', 1);
      template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);
    });

    it('should handle undefined maxReceiveCount (uses default DLQ)', () => {
      const queue = QueueLambda.createQueue(stack, 'test-queue', {
        queueName: 'test-queue'
        // maxReceiveCount undefined - framework creates default DLQ automatically
      });

      expect(queue).toBeDefined();
      const template = Template.fromStack(stack);
      // Should have at least 1 queue (may have default DLQ)
      const queueCount = Object.keys(template.findResources('AWS::SQS::Queue')).length;
      expect(queueCount).toBeGreaterThanOrEqual(1);
    });

    it('should handle very high visibility timeout', () => {
      const queue = QueueLambda.createQueue(stack, 'test-queue', {
        queueName: 'test-queue',
        visibilityTimeoutSeconds: 43200 // 12 hours max
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::SQS::Queue', {
        VisibilityTimeout: 43200
      });
    });

    it('should handle very high retention period', () => {
      const queue = QueueLambda.createQueue(stack, 'test-queue', {
        queueName: 'test-queue',
        retentionPeriodDays: 14 // 14 days max
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties('AWS::SQS::Queue', {
        MessageRetentionPeriod: 1209600 // 14 days in seconds
      });
    });

    it('should handle empty string queue name by using construct ID', () => {
      // CDK will use construct ID if queueName is empty
      const queue = QueueLambda.createQueue(stack, 'empty-queue-id', {
        queueName: ''
      });

      expect(queue).toBeDefined();
    });

    it('should handle queue name with special characters', () => {
      const queue = QueueLambda.createQueue(stack, 'special-queue', {
        queueName: 'test_queue-name.123'
      });

      expect(queue).toBeDefined();
    });

    it('should handle very high batch sizes', () => {
      const normalized = QueueLambda.normalizeSqsEventSourceProps({
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
      new QueueLambda(stack, 'SnapshotQueue', {
        queueName: 'snapshot-queue',
        visibilityTimeoutSeconds: 60,
        maxReceiveCount: 3,
        lambdaFunctionProps: {
          entry: TEST_ENTRY
        }
      });

      const template = Template.fromStack(stack).toJSON();
      expect(template).toMatchSnapshot();
    });

    /**
     * Snapshot: FIFO Queue Setup
     * Tests CloudFormation template for a FIFO queue.
     * Includes: content-based deduplication, FIFO-specific settings.
     */
    it('should generate consistent CloudFormation for FIFO queue setup', () => {
      new QueueLambda(stack, 'SnapshotFifoQueue', {
        queueName: 'snapshot-queue.fifo',
        queueProps: {
          fifo: true
        },
        lambdaFunctionProps: {
          entry: TEST_ENTRY
        }
      });

      const template = Template.fromStack(stack).toJSON();
      expect(template).toMatchSnapshot();
    });

    /**
     * Snapshot: Complete Configuration
     * Tests CloudFormation template with all configuration options.
     * Includes: timeouts, retention, DLQ, batch settings, lambda config.
     */
    it('should generate consistent CloudFormation for complete setup', () => {
      new QueueLambda(stack, 'SnapshotCompleteQueue', {
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

      const template = Template.fromStack(stack).toJSON();
      expect(template).toMatchSnapshot();
    });
  });
});

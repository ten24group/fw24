---
sidebar_position: 7
---

# DynamoDB Streams and Audit Logging

FW24 provides built-in support for DynamoDB streams and audit logging capabilities. This feature allows you to track changes to your DynamoDB tables and process them in real-time.

## Stream Processing

### Basic Configuration

To enable stream processing for a DynamoDB table:

```typescript
const dynamoDBConfig: IDynamoDBConfig = {
  table: {
    name: 'myTable',
    props: {
      partitionKey: { name: 'id', type: AttributeType.STRING },
      dynamoStream: StreamViewType.NEW_AND_OLD_IMAGES  // Enable DynamoDB Streams
    },
    stream: {
      enabled: true,  // Enable stream processing
      topic: {
        name: 'my-stream-topic',  // Optional: defaults to {tableName}-stream
        props: {
          fifo: false  // Optional: use FIFO topics for ordered processing
        }
      },
      processor: {
        batchSize: 5,  // Optional: defaults to 5
        bisectBatchOnError: true,  // Optional: defaults to true
        retryAttempts: 3  // Optional: defaults to 3
      }
    }
  }
};
```

### FIFO Topics

For use cases requiring strict ordering of messages:

```typescript
const dynamoDBConfig: IDynamoDBConfig = {
  table: {
    name: 'myTable',
    props: {
      dynamoStream: StreamViewType.NEW_AND_OLD_IMAGES
    },
    stream: {
      enabled: true,
      topic: {
        props: {
          fifo: true  // Enable FIFO topic
        }
      }
    }
  }
};
```

## Audit Logging

### Basic Configuration

To enable audit logging:

```typescript
const dynamoDBConfig: IDynamoDBConfig = {
  table: {
    name: 'myTable',
    props: {
      dynamoStream: StreamViewType.NEW_AND_OLD_IMAGES
    },
    audit: {
      enabled: true,
      type: AuditLoggerType.CLOUDWATCH  // or DYNAMODB, CONSOLE
    }
  }
};
```

### CloudWatch Audit Logging

```typescript
const dynamoDBConfig: IDynamoDBConfig = {
  table: {
    name: 'myTable',
    props: {
      dynamoStream: StreamViewType.NEW_AND_OLD_IMAGES
    },
    audit: {
      enabled: true,
      type: AuditLoggerType.CLOUDWATCH,
      cloudwatchOptions: {
        logGroupName: '/my-app/audit-logs',  // Optional: defaults to /audit/logs/{appName}
        region: 'us-east-1',  // Optional: defaults to app region
        logGroupOptions: {
          retention: RetentionDays.ONE_YEAR
        }
      }
    }
  }
};
```

### DynamoDB Audit Logging

```typescript
const dynamoDBConfig: IDynamoDBConfig = {
  table: {
    name: 'myTable',
    props: {
      dynamoStream: StreamViewType.NEW_AND_OLD_IMAGES
    },
    audit: {
      enabled: true,
      type: AuditLoggerType.DYNAMODB,
      dynamodbstreamOptions: {
        auditTableName: 'audit-logs',  // Optional: defaults to same table
        queueProps: {
          // SQS Queue properties for audit processing
        },
        sqsEventSourceProps: {
          batchSize: 5,
          maxBatchingWindow: Duration.seconds(5)
        }
      }
    }
  }
};
```

## Architecture

The stream processing architecture consists of:

1. **DynamoDB Stream**: Captures table changes with NEW_AND_OLD_IMAGES view type
2. **Stream Processor Lambda**: Processes stream records and publishes to SNS
3. **SNS Topic**: Distributes events (Standard or FIFO)
4. **SQS Queue**: Buffers events for audit processing
5. **Audit Logger Lambda**: Processes and stores audit logs

### Stream Processing Flow

1. Changes in DynamoDB table trigger stream events
2. Stream Processor Lambda receives batches of events
3. Events are published to SNS topic (with FIFO support if configured)
4. If audit is enabled:
   - Events are sent to SQS queue
   - Audit Logger Lambda processes events
   - Logs are stored in configured destination (CloudWatch/DynamoDB/Console)

## Best Practices

1. **Stream Processing**:
   - Enable `StreamViewType.NEW_AND_OLD_IMAGES` to capture complete change data
   - Use appropriate batch sizes based on record size and processing needs
   - Enable `bisectBatchOnError` for better error handling
   - Configure reasonable retry attempts

2. **FIFO Topics**:
   - Use when strict ordering of messages is required
   - Consider throughput implications
   - Message deduplication is handled automatically using a hash of the record data

3. **Audit Logging**:
   - Choose appropriate audit storage based on requirements:
     - CloudWatch: For searchable, time-based logs
     - DynamoDB: For structured, queryable audit data
     - Console: For development and debugging
   - Configure proper retention periods
   - Monitor audit log storage usage 
import { SQSEvent, SQSRecord } from 'aws-lambda';
import { DynamoDBEventDataExtractor } from './dynamodb-event-data-extractor';
import { describe, expect, it, beforeEach } from '@jest/globals';

const createSQSRecord = (body: any, messageId: string = 'test-msg-id'): SQSRecord => ({
  messageId,
  receiptHandle: 'test-receipt',
  body: JSON.stringify(body),
  attributes: {
    ApproximateReceiveCount: '1',
    SentTimestamp: '1234567890',
    SenderId: 'test-sender',
    ApproximateFirstReceiveTimestamp: '1234567890'
  },
  messageAttributes: {},
  md5OfBody: 'test-md5',
  eventSource: 'aws:sqs',
  eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test-queue',
  awsRegion: 'us-east-1'
});

describe('DynamoDBEventDataExtractor', () => {
  let extractor: DynamoDBEventDataExtractor;

  beforeEach(() => {
    extractor = new DynamoDBEventDataExtractor();
  });

  describe('Direct DynamoDB Event Processing', () => {
    it('should extract data from direct DynamoDB event structure', () => {
      const snsMessage = {
        eventID: '18d146268b51e81c1331492a1b5d79be',
        eventName: 'MODIFY',
        eventSource: 'aws:dynamodb',
        dynamodb: {
          ApproximateCreationDateTime: 1755803435,
          Keys: {
            sk: { S: '$user_1' },
            pk: { S: '$mainservice#userid_6a42ac0e-580b-4c2e-8b9d-e263959bf32b' }
          },
          NewImage: {
            __edb_e__: { S: 'user' },
            userId: { S: '6a42ac0e-580b-4c2e-8b9d-e263959bf32b' },
            firstName: { S: 'John' },
            lastName: { S: 'Doe' },
            email: { S: 'john@example.com' }
          },
          OldImage: {
            __edb_e__: { S: 'user' },
            userId: { S: '6a42ac0e-580b-4c2e-8b9d-e263959bf32b' },
            firstName: { S: 'Jane' },
            lastName: { S: 'Smith' },
            email: { S: 'jane@example.com' }
          }
        }
      };

      const snsBody = {
        Type: 'Notification',
        Message: JSON.stringify(snsMessage)
      };

      const sqsEvent: SQSEvent = {
        Records: [createSQSRecord(snsBody)]
      };

      const records = extractor.extractData(sqsEvent);

      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({
        eventId: '18d146268b51e81c1331492a1b5d79be',
        eventType: 'update',
        timestamp: expect.any(Number),
        eventSource: 'aws:dynamodb',
        payload: {
          newImage: {
            __edb_e__: 'user',
            userId: '6a42ac0e-580b-4c2e-8b9d-e263959bf32b',
            firstName: 'John',
            lastName: 'Doe',
            email: 'john@example.com'
          },
          oldImage: {
            __edb_e__: 'user',
            userId: '6a42ac0e-580b-4c2e-8b9d-e263959bf32b',
            firstName: 'Jane',
            lastName: 'Smith',
            email: 'jane@example.com'
          },
          keys: {
            sk: '$user_1',
            pk: '$mainservice#userid_6a42ac0e-580b-4c2e-8b9d-e263959bf32b'
          }
        },
        entityId: '6a42ac0e-580b-4c2e-8b9d-e263959bf32b',
        entityName: 'user',
        metadata: {
          rawSourceEventName: 'MODIFY',
          awsRegion: 'us-east-1'
        }
      });
    });
  });

  describe('Nested Message Structure Processing', () => {
    it('should extract data from nested message.message structure (from DynamoDB stream processor)', () => {
      // This is the actual structure we saw in the logs - nested message.message
      const nestedSnsMessage = {
        message: {
          eventID: '18d146268b51e81c1331492a1b5d79be',
          eventName: 'MODIFY',
          eventSource: 'aws:dynamodb',
          dynamodb: {
            ApproximateCreationDateTime: 1755803435,
            Keys: {
              sk: { S: '$user_1' },
              pk: { S: '$mainservice#userid_6a42ac0e-580b-4c2e-8b9d-e263959bf32b' }
            },
            NewImage: {
              __edb_e__: { S: 'user' },
              userId: { S: '6a42ac0e-580b-4c2e-8b9d-e263959bf32b' },
              firstName: { S: 'Updated' },
              lastName: { S: 'Name' },
              email: { S: 'updated@example.com' }
            },
            OldImage: {
              __edb_e__: { S: 'user' },
              userId: { S: '6a42ac0e-580b-4c2e-8b9d-e263959bf32b' },
              firstName: { S: 'Original' },
              lastName: { S: 'Name' },
              email: { S: 'original@example.com' }
            }
          },
          messageAttributes: {
            eventType: 'MODIFY'
          }
        }
      };

      const snsBody = {
        Type: 'Notification',
        Message: JSON.stringify(nestedSnsMessage)
      };

      const sqsEvent: SQSEvent = {
        Records: [createSQSRecord(snsBody)]
      };

      const records = extractor.extractData(sqsEvent);

      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({
        eventId: '18d146268b51e81c1331492a1b5d79be',
        eventType: 'update',
        timestamp: expect.any(Number),
        eventSource: 'aws:dynamodb',
        payload: {
          newImage: {
            __edb_e__: 'user',
            userId: '6a42ac0e-580b-4c2e-8b9d-e263959bf32b',
            firstName: 'Updated',
            lastName: 'Name',
            email: 'updated@example.com'
          },
          oldImage: {
            __edb_e__: 'user',
            userId: '6a42ac0e-580b-4c2e-8b9d-e263959bf32b',
            firstName: 'Original',
            lastName: 'Name',
            email: 'original@example.com'
          },
          keys: {
            sk: '$user_1',
            pk: '$mainservice#userid_6a42ac0e-580b-4c2e-8b9d-e263959bf32b'
          }
        },
        entityId: '6a42ac0e-580b-4c2e-8b9d-e263959bf32b',
        entityName: 'user',
        metadata: {
          rawSourceEventName: 'MODIFY',
          awsRegion: 'us-east-1'
        }
      });
    });

    it('should handle both direct and nested message structures', () => {
      // Test both structures in one test to ensure backward compatibility
      const directMessage = {
        eventID: 'direct-event-id',
        eventName: 'INSERT',
        eventSource: 'aws:dynamodb',
        dynamodb: {
          Keys: { id: { S: 'direct-id' } },
          NewImage: { __edb_e__: { S: 'post' }, id: { S: 'direct-id' }, title: { S: 'Direct Post' } }
        }
      };

      const nestedMessage = {
        message: {
          eventID: 'nested-event-id',
          eventName: 'INSERT',
          eventSource: 'aws:dynamodb',
          dynamodb: {
            Keys: { id: { S: 'nested-id' } },
            NewImage: { __edb_e__: { S: 'post' }, id: { S: 'nested-id' }, title: { S: 'Nested Post' } }
          }
        }
      };

      const sqsEvent: SQSEvent = {
        Records: [
          createSQSRecord({
            Type: 'Notification',
            Message: JSON.stringify(directMessage)
          }, 'direct-msg'),
          createSQSRecord({
            Type: 'Notification',
            Message: JSON.stringify(nestedMessage)
          }, 'nested-msg')
        ]
      };

      const records = extractor.extractData(sqsEvent);

      expect(records).toHaveLength(2);

      // Direct message structure
      expect(records[0].entityId).toBe('direct-id');
      expect(records[0].payload.newImage?.title).toBe('Direct Post');

      // Nested message structure
      expect(records[1].entityId).toBe('nested-id');
      expect(records[1].payload.newImage?.title).toBe('Nested Post');
    });
  });

  describe('Event Type Mapping', () => {
    it.each([
      ['INSERT', 'create'],
      ['MODIFY', 'update'],
      ['REMOVE', 'delete']
    ])('should map DynamoDB event "%s" to "%s"', (dynamoEvent, expectedType) => {
      const snsMessage = {
        eventID: 'test-event-id',
        eventName: dynamoEvent,
        eventSource: 'aws:dynamodb',
        dynamodb: {
          Keys: { id: { S: 'test-id' } },
          NewImage: { __edb_e__: { S: 'test' }, id: { S: 'test-id' } }
        }
      };

      const snsBody = {
        Type: 'Notification',
        Message: JSON.stringify(snsMessage)
      };

      const sqsEvent: SQSEvent = {
        Records: [createSQSRecord(snsBody)]
      };

      const records = extractor.extractData(sqsEvent);

      expect(records[0].eventType).toBe(expectedType);
    });
  });

  describe('Error Handling', () => {
    it('should return empty array when SNS Message field is missing', () => {
      const snsBody = {
        Type: 'Notification'
        // Missing Message field
      };

      const sqsEvent: SQSEvent = {
        Records: [createSQSRecord(snsBody)]
      };

      const records = extractor.extractData(sqsEvent);
      expect(records).toEqual([]);
    });

    it('should return empty array when nested message is missing required fields', () => {
      const invalidNestedMessage = {
        message: {
          // Missing eventID, eventName, dynamodb
          someOtherField: 'value'
        }
      };

      const snsBody = {
        Type: 'Notification',
        Message: JSON.stringify(invalidNestedMessage)
      };

      const sqsEvent: SQSEvent = {
        Records: [createSQSRecord(snsBody)]
      };

      const records = extractor.extractData(sqsEvent);
      expect(records).toEqual([]);
    });

    it('should return empty array when direct message is missing required fields', () => {
      const invalidDirectMessage = {
        eventName: 'INSERT'
        // Missing eventID and dynamodb
      };

      const snsBody = {
        Type: 'Notification',
        Message: JSON.stringify(invalidDirectMessage)
      };

      const sqsEvent: SQSEvent = {
        Records: [createSQSRecord(snsBody)]
      };

      const records = extractor.extractData(sqsEvent);
      expect(records).toEqual([]);
    });

    it('should return empty array for invalid JSON in SNS Message', () => {
      const snsBody = {
        Type: 'Notification',
        Message: 'invalid-json{'
      };

      const sqsEvent: SQSEvent = {
        Records: [createSQSRecord(snsBody)]
      };

      const records = extractor.extractData(sqsEvent);
      expect(records).toEqual([]);
    });
  });

  describe('Entity Name and ID Extraction', () => {
    it('should extract entityName from __edb_e__ field', () => {
      const snsMessage = {
        eventID: 'test-event-id',
        eventName: 'INSERT',
        eventSource: 'aws:dynamodb',
        dynamodb: {
          Keys: { id: { S: 'test-id' } },
          NewImage: {
            __edb_e__: { S: 'customEntity' },
            id: { S: 'test-id' },
            name: { S: 'Test Name' }
          }
        }
      };

      const snsBody = {
        Type: 'Notification',
        Message: JSON.stringify(snsMessage)
      };

      const sqsEvent: SQSEvent = {
        Records: [createSQSRecord(snsBody)]
      };

      const records = extractor.extractData(sqsEvent);

      expect(records[0].entityName).toBe('customEntity');
    });

    it('should extract entityId from various ID field patterns', () => {
      const testCases = [
        { idField: 'id', entityName: 'user', expectedId: 'user-123' },
        { idField: 'userId', entityName: 'user', expectedId: 'user-456' },
        { idField: 'postId', entityName: 'post', expectedId: 'post-789' }
      ];

      testCases.forEach(({ idField, entityName, expectedId }) => {
        const snsMessage = {
          eventID: 'test-event-id',
          eventName: 'INSERT',
          eventSource: 'aws:dynamodb',
          dynamodb: {
            Keys: { [idField]: { S: expectedId } },
            NewImage: {
              __edb_e__: { S: entityName },
              [idField]: { S: expectedId }
            }
          }
        };

        const snsBody = {
          Type: 'Notification',
          Message: JSON.stringify(snsMessage)
        };

        const sqsEvent: SQSEvent = {
          Records: [createSQSRecord(snsBody)]
        };

        const records = extractor.extractData(sqsEvent);

        expect(records[0].entityId).toBe(expectedId);
        expect(records[0].entityName).toBe(entityName);
      });
    });
  });
});

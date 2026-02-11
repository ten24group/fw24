"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dynamodb_event_data_extractor_1 = require("./dynamodb-event-data-extractor");
const globals_1 = require("@jest/globals");
const createSQSRecord = (body, messageId = 'test-msg-id') => ({
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
(0, globals_1.describe)('DynamoDBEventDataExtractor', () => {
    let extractor;
    (0, globals_1.beforeEach)(() => {
        extractor = new dynamodb_event_data_extractor_1.DynamoDBEventDataExtractor();
    });
    (0, globals_1.describe)('Direct DynamoDB Event Processing', () => {
        (0, globals_1.it)('should extract data from direct DynamoDB event structure', () => {
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
            const sqsEvent = {
                Records: [createSQSRecord(snsBody)]
            };
            const records = extractor.extractData(sqsEvent);
            (0, globals_1.expect)(records).toHaveLength(1);
            (0, globals_1.expect)(records[0]).toEqual({
                eventId: '18d146268b51e81c1331492a1b5d79be',
                eventType: 'update',
                timestamp: globals_1.expect.any(Number),
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
    (0, globals_1.describe)('Nested Message Structure Processing', () => {
        (0, globals_1.it)('should extract data from nested message.message structure (from DynamoDB stream processor)', () => {
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
            const sqsEvent = {
                Records: [createSQSRecord(snsBody)]
            };
            const records = extractor.extractData(sqsEvent);
            (0, globals_1.expect)(records).toHaveLength(1);
            (0, globals_1.expect)(records[0]).toEqual({
                eventId: '18d146268b51e81c1331492a1b5d79be',
                eventType: 'update',
                timestamp: globals_1.expect.any(Number),
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
        (0, globals_1.it)('should handle both direct and nested message structures', () => {
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
            const sqsEvent = {
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
            (0, globals_1.expect)(records).toHaveLength(2);
            // Direct message structure
            (0, globals_1.expect)(records[0].entityId).toBe('direct-id');
            (0, globals_1.expect)(records[0].payload.newImage?.title).toBe('Direct Post');
            // Nested message structure
            (0, globals_1.expect)(records[1].entityId).toBe('nested-id');
            (0, globals_1.expect)(records[1].payload.newImage?.title).toBe('Nested Post');
        });
    });
    (0, globals_1.describe)('Event Type Mapping', () => {
        globals_1.it.each([
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
            const sqsEvent = {
                Records: [createSQSRecord(snsBody)]
            };
            const records = extractor.extractData(sqsEvent);
            (0, globals_1.expect)(records[0].eventType).toBe(expectedType);
        });
    });
    (0, globals_1.describe)('Error Handling', () => {
        (0, globals_1.it)('should return empty array when SNS Message field is missing', () => {
            const snsBody = {
                Type: 'Notification'
                // Missing Message field
            };
            const sqsEvent = {
                Records: [createSQSRecord(snsBody)]
            };
            const records = extractor.extractData(sqsEvent);
            (0, globals_1.expect)(records).toEqual([]);
        });
        (0, globals_1.it)('should return empty array when nested message is missing required fields', () => {
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
            const sqsEvent = {
                Records: [createSQSRecord(snsBody)]
            };
            const records = extractor.extractData(sqsEvent);
            (0, globals_1.expect)(records).toEqual([]);
        });
        (0, globals_1.it)('should return empty array when direct message is missing required fields', () => {
            const invalidDirectMessage = {
                eventName: 'INSERT'
                // Missing eventID and dynamodb
            };
            const snsBody = {
                Type: 'Notification',
                Message: JSON.stringify(invalidDirectMessage)
            };
            const sqsEvent = {
                Records: [createSQSRecord(snsBody)]
            };
            const records = extractor.extractData(sqsEvent);
            (0, globals_1.expect)(records).toEqual([]);
        });
        (0, globals_1.it)('should return empty array for invalid JSON in SNS Message', () => {
            const snsBody = {
                Type: 'Notification',
                Message: 'invalid-json{'
            };
            const sqsEvent = {
                Records: [createSQSRecord(snsBody)]
            };
            const records = extractor.extractData(sqsEvent);
            (0, globals_1.expect)(records).toEqual([]);
        });
    });
    (0, globals_1.describe)('Entity Name and ID Extraction', () => {
        (0, globals_1.it)('should extract entityName from __edb_e__ field', () => {
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
            const sqsEvent = {
                Records: [createSQSRecord(snsBody)]
            };
            const records = extractor.extractData(sqsEvent);
            (0, globals_1.expect)(records[0].entityName).toBe('customEntity');
        });
        (0, globals_1.it)('should extract entityId from various ID field patterns', () => {
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
                const sqsEvent = {
                    Records: [createSQSRecord(snsBody)]
                };
                const records = extractor.extractData(sqsEvent);
                (0, globals_1.expect)(records[0].entityId).toBe(expectedId);
                (0, globals_1.expect)(records[0].entityName).toBe(entityName);
            });
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZHluYW1vZGItZXZlbnQtZGF0YS1leHRyYWN0b3IudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9jb3JlL3J1bnRpbWUvZXZlbnQtcHJvY2Vzc29yL2R5bmFtb2RiLWV2ZW50LWRhdGEtZXh0cmFjdG9yLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFDQSxtRkFBNkU7QUFDN0UsMkNBQWlFO0FBRWpFLE1BQU0sZUFBZSxHQUFHLENBQUMsSUFBUyxFQUFFLFlBQW9CLGFBQWEsRUFBYSxFQUFFLENBQUMsQ0FBQztJQUNwRixTQUFTO0lBQ1QsYUFBYSxFQUFFLGNBQWM7SUFDN0IsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDO0lBQzFCLFVBQVUsRUFBRTtRQUNWLHVCQUF1QixFQUFFLEdBQUc7UUFDNUIsYUFBYSxFQUFFLFlBQVk7UUFDM0IsUUFBUSxFQUFFLGFBQWE7UUFDdkIsZ0NBQWdDLEVBQUUsWUFBWTtLQUMvQztJQUNELGlCQUFpQixFQUFFLEVBQUU7SUFDckIsU0FBUyxFQUFFLFVBQVU7SUFDckIsV0FBVyxFQUFFLFNBQVM7SUFDdEIsY0FBYyxFQUFFLCtDQUErQztJQUMvRCxTQUFTLEVBQUUsV0FBVztDQUN2QixDQUFDLENBQUM7QUFFSCxJQUFBLGtCQUFRLEVBQUMsNEJBQTRCLEVBQUUsR0FBRyxFQUFFO0lBQzFDLElBQUksU0FBcUMsQ0FBQztJQUUxQyxJQUFBLG9CQUFVLEVBQUMsR0FBRyxFQUFFO1FBQ2QsU0FBUyxHQUFHLElBQUksMERBQTBCLEVBQUUsQ0FBQztJQUMvQyxDQUFDLENBQUMsQ0FBQztJQUVILElBQUEsa0JBQVEsRUFBQyxrQ0FBa0MsRUFBRSxHQUFHLEVBQUU7UUFDaEQsSUFBQSxZQUFFLEVBQUMsMERBQTBELEVBQUUsR0FBRyxFQUFFO1lBQ2xFLE1BQU0sVUFBVSxHQUFHO2dCQUNqQixPQUFPLEVBQUUsa0NBQWtDO2dCQUMzQyxTQUFT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QkFDRjtpQkFDRixDQUFDO2dCQUVGLE1BQU0sT0FBTyxHQUFHO29CQUNkLElBQUksRUFBRSxjQUFjO29CQUNwQixPQUFPLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUM7aUJBQ3BDLENBQUM7Z0JBRUYsTUFBTSxRQUFRLEdBQWE7b0JBQ3pCLE9BQU8sRUFBRSxDQUFDLGVBQWUsQ0FBQyxPQUFPLENBQUMsQ0FBQztpQkFDcEMsQ0FBQztnQkFFRixNQUFNLE9BQU8sR0FBRyxTQUFTLENBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxDQUFDO2dCQUVoRCxJQUFBLGdCQUFNLEVBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQztnQkFDN0MsSUFBQSxnQkFBTSxFQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUM7WUFDakQsQ0FBQyxDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBTUVNFdmVudCwgU1FTUmVjb3JkIH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBEeW5hbW9EQkV2ZW50RGF0YUV4dHJhY3RvciB9IGZyb20gJy4vZHluYW1vZGItZXZlbnQtZGF0YS1leHRyYWN0b3InO1xuaW1wb3J0IHsgZGVzY3JpYmUsIGV4cGVjdCwgaXQsIGJlZm9yZUVhY2ggfSBmcm9tICdAamVzdC9nbG9iYWxzJztcblxuY29uc3QgY3JlYXRlU1FTUmVjb3JkID0gKGJvZHk6IGFueSwgbWVzc2FnZUlkOiBzdHJpbmcgPSAndGVzdC1tc2ctaWQnKTogU1FTUmVjb3JkID0+ICh7XG4gIG1lc3NhZ2VJZCxcbiAgcmVjZWlwdEhhbmRsZTogJ3Rlc3QtcmVjZWlwdCcsXG4gIGJvZHk6IEpTT04uc3RyaW5naWZ5KGJvZHkpLFxuICBhdHRyaWJ1dGVzOiB7XG4gICAgQXBwcm94aW1hdGVSZWNlaXZlQ291bnQ6ICcxJyxcbiAgICBTZW50VGltZXN0YW1wOiAnMTIzNDU2Nzg5MCcsXG4gICAgU2VuZGVySWQ6ICd0ZXN0LXNlbmRlcicsXG4gICAgQXBwcm94aW1hdGVGaXJzdFJlY2VpdmVUaW1lc3RhbXA6ICcxMjM0NTY3ODkwJ1xuICB9LFxuICBtZXNzYWdlQXR0cmlidXRlczoge30sXG4gIG1kNU9mQm9keTogJ3Rlc3QtbWQ1JyxcbiAgZXZlbnRTb3VyY2U6ICdhd3M6c3FzJyxcbiAgZXZlbnRTb3VyY2VBUk46ICdhcm46YXdzOnNxczp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOnRlc3QtcXVldWUnLFxuICBhd3NSZWdpb246ICd1cy1lYXN0LTEnXG59KTtcblxuZGVzY3JpYmUoJ0R5bmFtb0RCRXZlbnREYXRhRXh0cmFjdG9yJywgKCkgPT4ge1xuICBsZXQgZXh0cmFjdG9yOiBEeW5hbW9EQkV2ZW50RGF0YUV4dHJhY3RvcjtcblxuICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICBleHRyYWN0b3IgPSBuZXcgRHluYW1vREJFdmVudERhdGFFeHRyYWN0b3IoKTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0RpcmVjdCBEeW5hbW9EQiBFdmVudCBQcm9jZXNzaW5nJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgZXh0cmFjdCBkYXRhIGZyb20gZGlyZWN0IER5bmFtb0RCIGV2ZW50IHN0cnVjdHVyZScsICgpID0+IHtcbiAgICAgIGNvbnN0IHNuc01lc3NhZ2UgPSB7XG4gICAgICAgIGV2ZW50SUQ6ICcxOGQxNDYyNjhiNTFlODFjMTMzMTQ5MmExYjVkNzliZScsXG4gICAgICAgIGV2ZW50TmFtZTogJ01PRElGWScsXG4gICAgICAgIGV2ZW50U291cmNlOiAnYXdzOmR5bmFtb2RiJyxcbiAgICAgICAgZHluYW1vZGI6IHtcbiAgICAgICAgICBBcHByb3hpbWF0ZUNyZWF0aW9uRGF0ZVRpbWU6IDE3NTU4MDM0MzUsXG4gICAgICAgICAgS2V5czoge1xuICAgICAgICAgICAgc2s6IHsgUzogJyR1c2VyXzEnIH0sXG4gICAgICAgICAgICBwazogeyBTOiAnJG1haW5zZXJ2aWNlI3VzZXJpZF82YTQyYWMwZS01ODBiLTRjMmUtOGI5ZC1lMjYzOTU5YmYzMmInIH1cbiAgICAgICAgICB9LFxuICAgICAgICAgIE5ld0ltYWdlOiB7XG4gICAgICAgICAgICBfX2VkYl9lX186IHsgUzogJ3VzZXInIH0sXG4gICAgICAgICAgICB1c2VySWQ6IHsgUzogJzZhNDJhYzBlLTU4MGItNGMyZS04YjlkLWUyNjM5NTliZjMyYicgfSxcbiAgICAgICAgICAgIGZpcnN0TmFtZTogeyBTOiAnSm9obicgfSxcbiAgICAgICAgICAgIGxhc3ROYW1lOiB7IFM6ICdEb2UnIH0sXG4gICAgICAgICAgICBlbWFpbDogeyBTOiAnam9obkBleGFtcGxlLmNvbScgfVxuICAgICAgICAgIH0sXG4gICAgICAgICAgT2xkSW1hZ2U6IHtcbiAgICAgICAgICAgIF9fZWRiX2VfXzogeyBTOiAndXNlcicgfSxcbiAgICAgICAgICAgIHVzZXJJZDogeyBTOiAnNmE0MmFjMGUtNTgwYi00YzJlLThiOWQtZTI2Mzk1OWJmMzJiJyB9LFxuICAgICAgICAgICAgZmlyc3ROYW1lOiB7IFM6ICdKYW5lJyB9LFxuICAgICAgICAgICAgbGFzdE5hbWU6IHsgUzogJ1NtaXRoJyB9LFxuICAgICAgICAgICAgZW1haWw6IHsgUzogJ2phbmVAZXhhbXBsZS5jb20nIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHNuc0JvZHkgPSB7XG4gICAgICAgIFR5cGU6ICdOb3RpZmljYXRpb24nLFxuICAgICAgICBNZXNzYWdlOiBKU09OLnN0cmluZ2lmeShzbnNNZXNzYWdlKVxuICAgICAgfTtcblxuICAgICAgY29uc3Qgc3FzRXZlbnQ6IFNRU0V2ZW50ID0ge1xuICAgICAgICBSZWNvcmRzOiBbY3JlYXRlU1FTUmVjb3JkKHNuc0JvZHkpXVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVjb3JkcyA9IGV4dHJhY3Rvci5leHRyYWN0RGF0YShzcXNFdmVudCk7XG5cbiAgICAgIGV4cGVjdChyZWNvcmRzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QocmVjb3Jkc1swXSkudG9FcXVhbCh7XG4gICAgICAgIGV2ZW50SWQ6ICcxOGQxNDYyNjhiNTFlODFjMTMzMTQ5MmExYjVkNzliZScsXG4gICAgICAgIGV2ZW50VHlwZTogJ3VwZGF0ZScsXG4gICAgICAgIHRpbWVzdGFtcDogZXhwZWN0LmFueShOdW1iZXIpLFxuICAgICAgICBldmVudFNvdXJjZTogJ2F3czpkeW5hbW9kYicsXG4gICAgICAgIHBheWxvYWQ6IHtcbiAgICAgICAgICBuZXdJbWFnZToge1xuICAgICAgICAgICAgX19lZGJfZV9fOiAndXNlcicsXG4gICAgICAgICAgICB1c2VySWQ6ICc2YTQyYWMwZS01ODBiLTRjMmUtOGI5ZC1lMjYzOTU5YmYzMmInLFxuICAgICAgICAgICAgZmlyc3ROYW1lOiAnSm9obicsXG4gICAgICAgICAgICBsYXN0TmFtZTogJ0RvZScsXG4gICAgICAgICAgICBlbWFpbDogJ2pvaG5AZXhhbXBsZS5jb20nXG4gICAgICAgICAgfSxcbiAgICAgICAgICBvbGRJbWFnZToge1xuICAgICAgICAgICAgX19lZGJfZV9fOiAndXNlcicsXG4gICAgICAgICAgICB1c2VySWQ6ICc2YTQyYWMwZS01ODBiLTRjMmUtOGI5ZC1lMjYzOTU5YmYzMmInLFxuICAgICAgICAgICAgZmlyc3ROYW1lOiAnSmFuZScsXG4gICAgICAgICAgICBsYXN0TmFtZTogJ1NtaXRoJyxcbiAgICAgICAgICAgIGVtYWlsOiAnamFuZUBleGFtcGxlLmNvbSdcbiAgICAgICAgICB9LFxuICAgICAgICAgIGtleXM6IHtcbiAgICAgICAgICAgIHNrOiAnJHVzZXJfMScsXG4gICAgICAgICAgICBwazogJyRtYWluc2VydmljZSN1c2VyaWRfNmE0MmFjMGUtNTgwYi00YzJlLThiOWQtZTI2Mzk1OWJmMzJiJ1xuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgZW50aXR5SWQ6ICc2YTQyYWMwZS01ODBiLTRjMmUtOGI5ZC1lMjYzOTU5YmYzMmInLFxuICAgICAgICBlbnRpdHlOYW1lOiAndXNlcicsXG4gICAgICAgIG1ldGFkYXRhOiB7XG4gICAgICAgICAgcmF3U291cmNlRXZlbnROYW1lOiAnTU9ESUZZJyxcbiAgICAgICAgICBhd3NSZWdpb246ICd1cy1lYXN0LTEnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnTmVzdGVkIE1lc3NhZ2UgU3RydWN0dXJlIFByb2Nlc3NpbmcnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBleHRyYWN0IGRhdGEgZnJvbSBuZXN0ZWQgbWVzc2FnZS5tZXNzYWdlIHN0cnVjdHVyZSAoZnJvbSBEeW5hbW9EQiBzdHJlYW0gcHJvY2Vzc29yKScsICgpID0+IHtcbiAgICAgIC8vIFRoaXMgaXMgdGhlIGFjdHVhbCBzdHJ1Y3R1cmUgd2Ugc2F3IGluIHRoZSBsb2dzIC0gbmVzdGVkIG1lc3NhZ2UubWVzc2FnZVxuICAgICAgY29uc3QgbmVzdGVkU25zTWVzc2FnZSA9IHtcbiAgICAgICAgbWVzc2FnZToge1xuICAgICAgICAgIGV2ZW50SUQ6ICcxOGQxNDYyNjhiNTFlODFjMTMzMTQ5MmExYjVkNzliZScsXG4gICAgICAgICAgZXZlbnROYW1lOiAnTU9ESUZZJyxcbiAgICAgICAgICBldmVudFNvdXJjZTogJ2F3czpkeW5hbW9kYicsXG4gICAgICAgICAgZHluYW1vZGI6IHtcbiAgICAgICAgICAgIEFwcHJveGltYXRlQ3JlYXRpb25EYXRlVGltZTogMTc1NTgwMzQzNSxcbiAgICAgICAgICAgIEtleXM6IHtcbiAgICAgICAgICAgICAgc2s6IHsgUzogJyR1c2VyXzEnIH0sXG4gICAgICAgICAgICAgIHBrOiB7IFM6ICckbWFpbnNlcnZpY2UjdXNlcmlkXzZhNDJhYzBlLTU4MGItNGMyZS04YjlkLWUyNjM5NTliZjMyYicgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIE5ld0ltYWdlOiB7XG4gICAgICAgICAgICAgIF9fZWRiX2VfXzogeyBTOiAndXNlcicgfSxcbiAgICAgICAgICAgICAgdXNlcklkOiB7IFM6ICc2YTQyYWMwZS01ODBiLTRjMmUtOGI5ZC1lMjYzOTU5YmYzMmInIH0sXG4gICAgICAgICAgICAgIGZpcnN0TmFtZTogeyBTOiAnVXBkYXRlZCcgfSxcbiAgICAgICAgICAgICAgbGFzdE5hbWU6IHsgUzogJ05hbWUnIH0sXG4gICAgICAgICAgICAgIGVtYWlsOiB7IFM6ICd1cGRhdGVkQGV4YW1wbGUuY29tJyB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgT2xkSW1hZ2U6IHtcbiAgICAgICAgICAgICAgX19lZGJfZV9fOiB7IFM6ICd1c2VyJyB9LFxuICAgICAgICAgICAgICB1c2VySWQ6IHsgUzogJzZhNDJhYzBlLTU4MGItNGMyZS04YjlkLWUyNjM5NTliZjMyYicgfSxcbiAgICAgICAgICAgICAgZmlyc3ROYW1lOiB7IFM6ICdPcmlnaW5hbCcgfSxcbiAgICAgICAgICAgICAgbGFzdE5hbWU6IHsgUzogJ05hbWUnIH0sXG4gICAgICAgICAgICAgIGVtYWlsOiB7IFM6ICdvcmlnaW5hbEBleGFtcGxlLmNvbScgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0sXG4gICAgICAgICAgbWVzc2FnZUF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAgIGV2ZW50VHlwZTogJ01PRElGWSdcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHNuc0JvZHkgPSB7XG4gICAgICAgIFR5cGU6ICdOb3RpZmljYXRpb24nLFxuICAgICAgICBNZXNzYWdlOiBKU09OLnN0cmluZ2lmeShuZXN0ZWRTbnNNZXNzYWdlKVxuICAgICAgfTtcblxuICAgICAgY29uc3Qgc3FzRXZlbnQ6IFNRU0V2ZW50ID0ge1xuICAgICAgICBSZWNvcmRzOiBbY3JlYXRlU1FTUmVjb3JkKHNuc0JvZHkpXVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVjb3JkcyA9IGV4dHJhY3Rvci5leHRyYWN0RGF0YShzcXNFdmVudCk7XG5cbiAgICAgIGV4cGVjdChyZWNvcmRzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgICBleHBlY3QocmVjb3Jkc1swXSkudG9FcXVhbCh7XG4gICAgICAgIGV2ZW50SWQ6ICcxOGQxNDYyNjhiNTFlODFjMTMzMTQ5MmExYjVkNzliZScsXG4gICAgICAgIGV2ZW50VHlwZTogJ3VwZGF0ZScsXG4gICAgICAgIHRpbWVzdGFtcDogZXhwZWN0LmFueShOdW1iZXIpLFxuICAgICAgICBldmVudFNvdXJjZTogJ2F3czpkeW5hbW9kYicsXG4gICAgICAgIHBheWxvYWQ6IHtcbiAgICAgICAgICBuZXdJbWFnZToge1xuICAgICAgICAgICAgX19lZGJfZV9fOiAndXNlcicsXG4gICAgICAgICAgICB1c2VySWQ6ICc2YTQyYWMwZS01ODBiLTRjMmUtOGI5ZC1lMjYzOTU5YmYzMmInLFxuICAgICAgICAgICAgZmlyc3ROYW1lOiAnVXBkYXRlZCcsXG4gICAgICAgICAgICBsYXN0TmFtZTogJ05hbWUnLFxuICAgICAgICAgICAgZW1haWw6ICd1cGRhdGVkQGV4YW1wbGUuY29tJ1xuICAgICAgICAgIH0sXG4gICAgICAgICAgb2xkSW1hZ2U6IHtcbiAgICAgICAgICAgIF9fZWRiX2VfXzogJ3VzZXInLFxuICAgICAgICAgICAgdXNlcklkOiAnNmE0MmFjMGUtNTgwYi00YzJlLThiOWQtZTI2Mzk1OWJmMzJiJyxcbiAgICAgICAgICAgIGZpcnN0TmFtZTogJ09yaWdpbmFsJyxcbiAgICAgICAgICAgIGxhc3ROYW1lOiAnTmFtZScsXG4gICAgICAgICAgICBlbWFpbDogJ29yaWdpbmFsQGV4YW1wbGUuY29tJ1xuICAgICAgICAgIH0sXG4gICAgICAgICAga2V5czoge1xuICAgICAgICAgICAgc2s6ICckdXNlcl8xJyxcbiAgICAgICAgICAgIHBrOiAnJG1haW5zZXJ2aWNlI3VzZXJpZF82YTQyYWMwZS01ODBiLTRjMmUtOGI5ZC1lMjYzOTU5YmYzMmInXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBlbnRpdHlJZDogJzZhNDJhYzBlLTU4MGItNGMyZS04YjlkLWUyNjM5NTliZjMyYicsXG4gICAgICAgIGVudGl0eU5hbWU6ICd1c2VyJyxcbiAgICAgICAgbWV0YWRhdGE6IHtcbiAgICAgICAgICByYXdTb3VyY2VFdmVudE5hbWU6ICdNT0RJRlknLFxuICAgICAgICAgIGF3c1JlZ2lvbjogJ3VzLWVhc3QtMSdcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBib3RoIGRpcmVjdCBhbmQgbmVzdGVkIG1lc3NhZ2Ugc3RydWN0dXJlcycsICgpID0+IHtcbiAgICAgIC8vIFRlc3QgYm90aCBzdHJ1Y3R1cmVzIGluIG9uZSB0ZXN0IHRvIGVuc3VyZSBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG4gICAgICBjb25zdCBkaXJlY3RNZXNzYWdlID0ge1xuICAgICAgICBldmVudElEOiAnZGlyZWN0LWV2ZW50LWlkJyxcbiAgICAgICAgZXZlbnROYW1lOiAnSU5TRVJUJyxcbiAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6ZHluYW1vZGInLFxuICAgICAgICBkeW5hbW9kYjoge1xuICAgICAgICAgIEtleXM6IHsgaWQ6IHsgUzogJ2RpcmVjdC1pZCcgfSB9LFxuICAgICAgICAgIE5ld0ltYWdlOiB7IF9fZWRiX2VfXzogeyBTOiAncG9zdCcgfSwgaWQ6IHsgUzogJ2RpcmVjdC1pZCcgfSwgdGl0bGU6IHsgUzogJ0RpcmVjdCBQb3N0JyB9IH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgbmVzdGVkTWVzc2FnZSA9IHtcbiAgICAgICAgbWVzc2FnZToge1xuICAgICAgICAgIGV2ZW50SUQ6ICduZXN0ZWQtZXZlbnQtaWQnLFxuICAgICAgICAgIGV2ZW50TmFtZTogJ0lOU0VSVCcsXG4gICAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6ZHluYW1vZGInLFxuICAgICAgICAgIGR5bmFtb2RiOiB7XG4gICAgICAgICAgICBLZXlzOiB7IGlkOiB7IFM6ICduZXN0ZWQtaWQnIH0gfSxcbiAgICAgICAgICAgIE5ld0ltYWdlOiB7IF9fZWRiX2VfXzogeyBTOiAncG9zdCcgfSwgaWQ6IHsgUzogJ25lc3RlZC1pZCcgfSwgdGl0bGU6IHsgUzogJ05lc3RlZCBQb3N0JyB9IH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHNxc0V2ZW50OiBTUVNFdmVudCA9IHtcbiAgICAgICAgUmVjb3JkczogW1xuICAgICAgICAgIGNyZWF0ZVNRU1JlY29yZCh7XG4gICAgICAgICAgICBUeXBlOiAnTm90aWZpY2F0aW9uJyxcbiAgICAgICAgICAgIE1lc3NhZ2U6IEpTT04uc3RyaW5naWZ5KGRpcmVjdE1lc3NhZ2UpXG4gICAgICAgICAgfSwgJ2RpcmVjdC1tc2cnKSxcbiAgICAgICAgICBjcmVhdGVTUVNSZWNvcmQoe1xuICAgICAgICAgICAgVHlwZTogJ05vdGlmaWNhdGlvbicsXG4gICAgICAgICAgICBNZXNzYWdlOiBKU09OLnN0cmluZ2lmeShuZXN0ZWRNZXNzYWdlKVxuICAgICAgICAgIH0sICduZXN0ZWQtbXNnJylcbiAgICAgICAgXVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVjb3JkcyA9IGV4dHJhY3Rvci5leHRyYWN0RGF0YShzcXNFdmVudCk7XG5cbiAgICAgIGV4cGVjdChyZWNvcmRzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgICBcbiAgICAgIC8vIERpcmVjdCBtZXNzYWdlIHN0cnVjdHVyZVxuICAgICAgZXhwZWN0KHJlY29yZHNbMF0uZW50aXR5SWQpLnRvQmUoJ2RpcmVjdC1pZCcpO1xuICAgICAgZXhwZWN0KHJlY29yZHNbMF0ucGF5bG9hZC5uZXdJbWFnZT8udGl0bGUpLnRvQmUoJ0RpcmVjdCBQb3N0Jyk7XG4gICAgICBcbiAgICAgIC8vIE5lc3RlZCBtZXNzYWdlIHN0cnVjdHVyZVxuICAgICAgZXhwZWN0KHJlY29yZHNbMV0uZW50aXR5SWQpLnRvQmUoJ25lc3RlZC1pZCcpO1xuICAgICAgZXhwZWN0KHJlY29yZHNbMV0ucGF5bG9hZC5uZXdJbWFnZT8udGl0bGUpLnRvQmUoJ05lc3RlZCBQb3N0Jyk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdFdmVudCBUeXBlIE1hcHBpbmcnLCAoKSA9PiB7XG4gICAgaXQuZWFjaChbXG4gICAgICBbJ0lOU0VSVCcsICdjcmVhdGUnXSxcbiAgICAgIFsnTU9ESUZZJywgJ3VwZGF0ZSddLFxuICAgICAgWydSRU1PVkUnLCAnZGVsZXRlJ11cbiAgICBdKSgnc2hvdWxkIG1hcCBEeW5hbW9EQiBldmVudCBcIiVzXCIgdG8gXCIlc1wiJywgKGR5bmFtb0V2ZW50LCBleHBlY3RlZFR5cGUpID0+IHtcbiAgICAgIGNvbnN0IHNuc01lc3NhZ2UgPSB7XG4gICAgICAgIGV2ZW50SUQ6ICd0ZXN0LWV2ZW50LWlkJyxcbiAgICAgICAgZXZlbnROYW1lOiBkeW5hbW9FdmVudCxcbiAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6ZHluYW1vZGInLFxuICAgICAgICBkeW5hbW9kYjoge1xuICAgICAgICAgIEtleXM6IHsgaWQ6IHsgUzogJ3Rlc3QtaWQnIH0gfSxcbiAgICAgICAgICBOZXdJbWFnZTogeyBfX2VkYl9lX186IHsgUzogJ3Rlc3QnIH0sIGlkOiB7IFM6ICd0ZXN0LWlkJyB9IH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3Qgc25zQm9keSA9IHtcbiAgICAgICAgVHlwZTogJ05vdGlmaWNhdGlvbicsXG4gICAgICAgIE1lc3NhZ2U6IEpTT04uc3RyaW5naWZ5KHNuc01lc3NhZ2UpXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBzcXNFdmVudDogU1FTRXZlbnQgPSB7XG4gICAgICAgIFJlY29yZHM6IFtjcmVhdGVTUVNSZWNvcmQoc25zQm9keSldXG4gICAgICB9O1xuXG4gICAgICBjb25zdCByZWNvcmRzID0gZXh0cmFjdG9yLmV4dHJhY3REYXRhKHNxc0V2ZW50KTtcblxuICAgICAgZXhwZWN0KHJlY29yZHNbMF0uZXZlbnRUeXBlKS50b0JlKGV4cGVjdGVkVHlwZSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdFcnJvciBIYW5kbGluZycsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHJldHVybiBlbXB0eSBhcnJheSB3aGVuIFNOUyBNZXNzYWdlIGZpZWxkIGlzIG1pc3NpbmcnLCAoKSA9PiB7XG4gICAgICBjb25zdCBzbnNCb2R5ID0ge1xuICAgICAgICBUeXBlOiAnTm90aWZpY2F0aW9uJ1xuICAgICAgICAvLyBNaXNzaW5nIE1lc3NhZ2UgZmllbGRcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHNxc0V2ZW50OiBTUVNFdmVudCA9IHtcbiAgICAgICAgUmVjb3JkczogW2NyZWF0ZVNRU1JlY29yZChzbnNCb2R5KV1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHJlY29yZHMgPSBleHRyYWN0b3IuZXh0cmFjdERhdGEoc3FzRXZlbnQpO1xuICAgICAgZXhwZWN0KHJlY29yZHMpLnRvRXF1YWwoW10pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCByZXR1cm4gZW1wdHkgYXJyYXkgd2hlbiBuZXN0ZWQgbWVzc2FnZSBpcyBtaXNzaW5nIHJlcXVpcmVkIGZpZWxkcycsICgpID0+IHtcbiAgICAgIGNvbnN0IGludmFsaWROZXN0ZWRNZXNzYWdlID0ge1xuICAgICAgICBtZXNzYWdlOiB7XG4gICAgICAgICAgLy8gTWlzc2luZyBldmVudElELCBldmVudE5hbWUsIGR5bmFtb2RiXG4gICAgICAgICAgc29tZU90aGVyRmllbGQ6ICd2YWx1ZSdcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3Qgc25zQm9keSA9IHtcbiAgICAgICAgVHlwZTogJ05vdGlmaWNhdGlvbicsXG4gICAgICAgIE1lc3NhZ2U6IEpTT04uc3RyaW5naWZ5KGludmFsaWROZXN0ZWRNZXNzYWdlKVxuICAgICAgfTtcblxuICAgICAgY29uc3Qgc3FzRXZlbnQ6IFNRU0V2ZW50ID0ge1xuICAgICAgICBSZWNvcmRzOiBbY3JlYXRlU1FTUmVjb3JkKHNuc0JvZHkpXVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVjb3JkcyA9IGV4dHJhY3Rvci5leHRyYWN0RGF0YShzcXNFdmVudCk7XG4gICAgICBleHBlY3QocmVjb3JkcykudG9FcXVhbChbXSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJldHVybiBlbXB0eSBhcnJheSB3aGVuIGRpcmVjdCBtZXNzYWdlIGlzIG1pc3NpbmcgcmVxdWlyZWQgZmllbGRzJywgKCkgPT4ge1xuICAgICAgY29uc3QgaW52YWxpZERpcmVjdE1lc3NhZ2UgPSB7XG4gICAgICAgIGV2ZW50TmFtZTogJ0lOU0VSVCdcbiAgICAgICAgLy8gTWlzc2luZyBldmVudElEIGFuZCBkeW5hbW9kYlxuICAgICAgfTtcblxuICAgICAgY29uc3Qgc25zQm9keSA9IHtcbiAgICAgICAgVHlwZTogJ05vdGlmaWNhdGlvbicsXG4gICAgICAgIE1lc3NhZ2U6IEpTT04uc3RyaW5naWZ5KGludmFsaWREaXJlY3RNZXNzYWdlKVxuICAgICAgfTtcblxuICAgICAgY29uc3Qgc3FzRXZlbnQ6IFNRU0V2ZW50ID0ge1xuICAgICAgICBSZWNvcmRzOiBbY3JlYXRlU1FTUmVjb3JkKHNuc0JvZHkpXVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVjb3JkcyA9IGV4dHJhY3Rvci5leHRyYWN0RGF0YShzcXNFdmVudCk7XG4gICAgICBleHBlY3QocmVjb3JkcykudG9FcXVhbChbXSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHJldHVybiBlbXB0eSBhcnJheSBmb3IgaW52YWxpZCBKU09OIGluIFNOUyBNZXNzYWdlJywgKCkgPT4ge1xuICAgICAgY29uc3Qgc25zQm9keSA9IHtcbiAgICAgICAgVHlwZTogJ05vdGlmaWNhdGlvbicsXG4gICAgICAgIE1lc3NhZ2U6ICdpbnZhbGlkLWpzb257J1xuICAgICAgfTtcblxuICAgICAgY29uc3Qgc3FzRXZlbnQ6IFNRU0V2ZW50ID0ge1xuICAgICAgICBSZWNvcmRzOiBbY3JlYXRlU1FTUmVjb3JkKHNuc0JvZHkpXVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVjb3JkcyA9IGV4dHJhY3Rvci5leHRyYWN0RGF0YShzcXNFdmVudCk7XG4gICAgICBleHBlY3QocmVjb3JkcykudG9FcXVhbChbXSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdFbnRpdHkgTmFtZSBhbmQgSUQgRXh0cmFjdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGV4dHJhY3QgZW50aXR5TmFtZSBmcm9tIF9fZWRiX2VfXyBmaWVsZCcsICgpID0+IHtcbiAgICAgIGNvbnN0IHNuc01lc3NhZ2UgPSB7XG4gICAgICAgIGV2ZW50SUQ6ICd0ZXN0LWV2ZW50LWlkJyxcbiAgICAgICAgZXZlbnROYW1lOiAnSU5TRVJUJyxcbiAgICAgICAgZXZlbnRTb3VyY2U6ICdhd3M6ZHluYW1vZGInLFxuICAgICAgICBkeW5hbW9kYjoge1xuICAgICAgICAgIEtleXM6IHsgaWQ6IHsgUzogJ3Rlc3QtaWQnIH0gfSxcbiAgICAgICAgICBOZXdJbWFnZTogeyBcbiAgICAgICAgICAgIF9fZWRiX2VfXzogeyBTOiAnY3VzdG9tRW50aXR5JyB9LFxuICAgICAgICAgICAgaWQ6IHsgUzogJ3Rlc3QtaWQnIH0sXG4gICAgICAgICAgICBuYW1lOiB7IFM6ICdUZXN0IE5hbWUnIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHNuc0JvZHkgPSB7XG4gICAgICAgIFR5cGU6ICdOb3RpZmljYXRpb24nLFxuICAgICAgICBNZXNzYWdlOiBKU09OLnN0cmluZ2lmeShzbnNNZXNzYWdlKVxuICAgICAgfTtcblxuICAgICAgY29uc3Qgc3FzRXZlbnQ6IFNRU0V2ZW50ID0ge1xuICAgICAgICBSZWNvcmRzOiBbY3JlYXRlU1FTUmVjb3JkKHNuc0JvZHkpXVxuICAgICAgfTtcblxuICAgICAgY29uc3QgcmVjb3JkcyA9IGV4dHJhY3Rvci5leHRyYWN0RGF0YShzcXNFdmVudCk7XG5cbiAgICAgIGV4cGVjdChyZWNvcmRzWzBdLmVudGl0eU5hbWUpLnRvQmUoJ2N1c3RvbUVudGl0eScpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBleHRyYWN0IGVudGl0eUlkIGZyb20gdmFyaW91cyBJRCBmaWVsZCBwYXR0ZXJucycsICgpID0+IHtcbiAgICAgIGNvbnN0IHRlc3RDYXNlcyA9IFtcbiAgICAgICAgeyBpZEZpZWxkOiAnaWQnLCBlbnRpdHlOYW1lOiAndXNlcicsIGV4cGVjdGVkSWQ6ICd1c2VyLTEyMycgfSxcbiAgICAgICAgeyBpZEZpZWxkOiAndXNlcklkJywgZW50aXR5TmFtZTogJ3VzZXInLCBleHBlY3RlZElkOiAndXNlci00NTYnIH0sXG4gICAgICAgIHsgaWRGaWVsZDogJ3Bvc3RJZCcsIGVudGl0eU5hbWU6ICdwb3N0JywgZXhwZWN0ZWRJZDogJ3Bvc3QtNzg5JyB9XG4gICAgICBdO1xuXG4gICAgICB0ZXN0Q2FzZXMuZm9yRWFjaCgoeyBpZEZpZWxkLCBlbnRpdHlOYW1lLCBleHBlY3RlZElkIH0pID0+IHtcbiAgICAgICAgY29uc3Qgc25zTWVzc2FnZSA9IHtcbiAgICAgICAgICBldmVudElEOiAndGVzdC1ldmVudC1pZCcsXG4gICAgICAgICAgZXZlbnROYW1lOiAnSU5TRVJUJyxcbiAgICAgICAgICBldmVudFNvdXJjZTogJ2F3czpkeW5hbW9kYicsXG4gICAgICAgICAgZHluYW1vZGI6IHtcbiAgICAgICAgICAgIEtleXM6IHsgW2lkRmllbGRdOiB7IFM6IGV4cGVjdGVkSWQgfSB9LFxuICAgICAgICAgICAgTmV3SW1hZ2U6IHsgXG4gICAgICAgICAgICAgIF9fZWRiX2VfXzogeyBTOiBlbnRpdHlOYW1lIH0sXG4gICAgICAgICAgICAgIFtpZEZpZWxkXTogeyBTOiBleHBlY3RlZElkIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3Qgc25zQm9keSA9IHtcbiAgICAgICAgICBUeXBlOiAnTm90aWZpY2F0aW9uJyxcbiAgICAgICAgICBNZXNzYWdlOiBKU09OLnN0cmluZ2lmeShzbnNNZXNzYWdlKVxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IHNxc0V2ZW50OiBTUVNFdmVudCA9IHtcbiAgICAgICAgICBSZWNvcmRzOiBbY3JlYXRlU1FTUmVjb3JkKHNuc0JvZHkpXVxuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IHJlY29yZHMgPSBleHRyYWN0b3IuZXh0cmFjdERhdGEoc3FzRXZlbnQpO1xuXG4gICAgICAgIGV4cGVjdChyZWNvcmRzWzBdLmVudGl0eUlkKS50b0JlKGV4cGVjdGVkSWQpO1xuICAgICAgICBleHBlY3QocmVjb3Jkc1swXS5lbnRpdHlOYW1lKS50b0JlKGVudGl0eU5hbWUpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0pO1xufSk7XG4iXX0=
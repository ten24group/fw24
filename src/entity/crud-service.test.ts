import { EntitySchema } from './base-entity';
import { findMatchingIndex, createEntity, updateEntity, deleteEntity, getEntity, listEntity, queryEntity } from './crud-service';
import { Entity } from 'electrodb';
import { IEventDispatcher, IEventPayload } from '../event/event-types';
import { createEntityEventDispatcher } from './entity-events';

describe('findMatchingIndex', () => {
    let entityService: any;
    let repository: any;

    beforeEach(() => {
        // Create a real ElectroDB entity with our schema
        const TestEntity = new Entity({
            model: {
                entity: "testEntity",
                version: "1",
                service: "test"
            },
            attributes: {
                id: {
                    type: "string",
                    required: true
                },
                status: {
                    type: "string",
                    required: true
                },
                type: {
                    type: "string",
                    required: true
                },
                name: {
                    type: "string",
                    required: true
                }
            },
            indexes: {
                primary: {
                    pk: {
                        field: "pk",
                        composite: [ "id" ]
                    },
                    sk: {
                        field: "sk",
                        composite: []
                    }
                },
                byStatus: {
                    index: "gsi1",
                    pk: {
                        field: "gsi1pk",
                        composite: [ "status" ]
                    },
                    sk: {
                        field: "gsi1sk",
                        composite: []
                    }
                },
                byStatusAndType: {
                    index: "gsi2",
                    pk: {
                        field: "gsi2pk",
                        composite: [ "status" ]
                    },
                    sk: {
                        field: "gsi2sk",
                        composite: [ "type" ]
                    }
                },
                byTemplate: {
                    index: "gsi3",
                    pk: {
                        field: "gsi3pk",
                        composite: [],
                        template: "testEntity"
                    },
                    sk: {
                        field: "gsi3sk",
                        composite: []
                    }
                }
            }
        });

        repository = TestEntity;
        entityService = {
            getRepository: () => repository
        };
    });

    it('should return template match when no filters provided', () => {
        const schema: EntitySchema<any, any, any> = {
            indexes: {
                primary: {
                    pk: { composite: [ 'id' ] },
                    sk: { composite: [] }
                },
                byTemplate: {
                    index: 'gsi3',
                    pk: { composite: [], template: 'testEntity' },
                    sk: { composite: [] }
                }
            }
        } as any;

        const result = findMatchingIndex(schema, undefined, 'testEntity', entityService);
        expect(result).toEqual({
            indexName: 'byTemplate',
            indexFilters: {}
        });
    });

    it('should use index when filters match index attributes', () => {
        const schema: EntitySchema<any, any, any> = {
            indexes: {
                primary: {
                    pk: { composite: [ 'id' ] },
                    sk: { composite: [] }
                },
                byStatusAndType: {
                    index: 'gsi2',
                    pk: { composite: [ 'status' ] },
                    sk: { composite: [ 'type' ] }
                }
            }
        } as any;

        const filters = {
            status: { eq: 'active' },
            type: { eq: 'user' }
        };

        const result = findMatchingIndex(schema, filters, 'testEntity', entityService);
        expect(result).toEqual({
            indexName: 'byStatusAndType',
            indexFilters: {
                status: 'active',
                type: 'user'
            }
        });
    });

    it('should handle direct value filters', () => {
        const schema: EntitySchema<any, any, any> = {
            indexes: {
                primary: {
                    pk: { composite: [ 'id' ] },
                    sk: { composite: [] }
                },
                byStatusAndType: {
                    index: 'gsi2',
                    pk: { composite: [ 'status' ] },
                    sk: { composite: [ 'type' ] }
                }
            }
        } as any;

        const filters = {
            status: 'active',
            type: 'user'
        };

        const result = findMatchingIndex(schema, filters, 'testEntity', entityService);
        expect(result).toEqual({
            indexName: 'byStatusAndType',
            indexFilters: {
                status: 'active',
                type: 'user'
            }
        });
    });

    it('should return template match when no index matches and template exists', () => {
        const schema: EntitySchema<any, any, any> = {
            indexes: {
                primary: {
                    pk: { composite: [ 'id' ] },
                    sk: { composite: [] }
                },
                byTemplate: {
                    index: 'gsi3',
                    pk: { composite: [], template: 'testEntity' },
                    sk: { composite: [] }
                }
            }
        } as any;

        const filters = {
            randomField: 'value'
        };

        const result = findMatchingIndex(schema, filters, 'testEntity', entityService);
        expect(result).toEqual({
            indexName: 'byTemplate',
            indexFilters: {}
        });
    });

    it('should return undefined when no index matches and no template exists', () => {
        const schema: EntitySchema<any, any, any> = {
            indexes: {
                primary: {
                    pk: { composite: [ 'id' ] },
                    sk: { composite: [] }
                }
            }
        } as any;

        const filters = {
            randomField: 'value'
        };

        const result = findMatchingIndex(schema, filters, 'nonExistentEntity', entityService);
        expect(result).toBeUndefined();
    });

    it('should handle partial index matches', () => {
        const schema: EntitySchema<any, any, any> = {
            indexes: {
                primary: {
                    pk: { composite: [ 'id' ] },
                    sk: { composite: [] }
                },
                byStatus: {
                    index: 'gsi1',
                    pk: { composite: [ 'status' ] },
                    sk: { composite: [] }
                }
            }
        } as any;

        const filters = {
            status: 'active',
            randomField: 'value'
        };

        const result = findMatchingIndex(schema, filters, 'testEntity', entityService);
        expect(result).toEqual({
            indexName: 'byStatus',
            indexFilters: {
                status: 'active'
            }
        });
    });
});

describe('Entity Event System', () => {
    // Mock event dispatcher that records dispatched events
    class MockEventDispatcher implements IEventDispatcher {
        public dispatchedEvents: IEventPayload<any>[] = [];

        async dispatch<P = any>(eventPayload: IEventPayload<P>): Promise<void> {
            this.dispatchedEvents.push(eventPayload);
        }

        on(): void { }
        onAsync(): void { }
        off(): void { }
        awaitAsyncHandlers(): Promise<void> { return Promise.resolve(); }

        // Helper method to find events by criteria
        findEvents(criteria: { phase?: string; operation?: string; subPhase?: string; successFail?: string; entity?: string }): IEventPayload<any>[] {
            return this.dispatchedEvents.filter(event => {
                const matcher = event.type as any;

                for (const [ key, value ] of Object.entries(criteria)) {
                    if (matcher[ key ] !== value) {
                        return false;
                    }
                }

                return true;
            });
        }

        // Clear events for clean state between tests
        clearEvents(): void {
            this.dispatchedEvents = [];
        }
    }

    describe('Event Dispatching', () => {
        // Set up common test environment
        let mockDispatcher: MockEventDispatcher;
        let mockEntityService: any;
        let mockSchema: EntitySchema<any, any, any>;

        beforeEach(() => {
            mockDispatcher = new MockEventDispatcher();

            // Mock entity repository behavior with more complete mock functions
            const mockRepository = {
                get: jest.fn().mockReturnThis(),
                go: jest.fn().mockResolvedValue({
                    data: { id: '123', name: 'Test Entity' }
                }),
                create: jest.fn().mockReturnThis(),
                update: jest.fn().mockReturnThis(),
                patch: jest.fn().mockReturnThis(),
                delete: jest.fn().mockReturnThis(),
                set: jest.fn().mockReturnThis(),
                // Add composite function to fix the patch chain
                composite: jest.fn().mockReturnThis(),
            };

            // Set up the patch method to return an object with composite method
            mockRepository.patch.mockReturnValue({
                set: jest.fn().mockReturnThis(),
                composite: jest.fn().mockReturnThis(),
                remove: jest.fn().mockReturnThis(),
                go: jest.fn().mockResolvedValue({
                    data: { id: '123', name: 'Updated Test Entity' }
                })
            });

            // Mock schema and service
            mockSchema = {
                model: { entity: 'testEntity' },
                attributes: {
                    id: { type: 'string', required: true },
                    name: { type: 'string' }
                },
                indexes: {
                    primary: {
                        pk: { composite: [ 'id' ] },
                        sk: { composite: [] }
                    }
                }
            } as any;

            mockEntityService = {
                getEntityName: jest.fn().mockReturnValue('testEntity'),
                getEntitySchema: jest.fn().mockReturnValue(mockSchema),
                getRepository: jest.fn().mockReturnValue(mockRepository),
                getEntityPrimaryIdPropertyName: jest.fn().mockReturnValue('id'),
                getEntityValidations: jest.fn().mockReturnValue({}),
                getOverriddenEntityValidationErrorMessages: jest.fn().mockResolvedValue(new Map()),
                extractEntityIdentifiers: jest.fn(id => typeof id === 'object' ? id : { id }),
            };
        });

        afterEach(() => {
            mockDispatcher.clearEvents();
            jest.clearAllMocks();
        });

        describe('getEntity', () => {
            it('should dispatch pre and post events', async () => {
                // Arrange
                const id = { id: '123' };

                // Act
                await getEntity({
                    id,
                    entityName: 'testEntity',
                    entityService: mockEntityService,
                    eventDispatcher: mockDispatcher,
                });

                // Assert
                expect(mockDispatcher.dispatchedEvents.length).toBeGreaterThanOrEqual(4);

                // Check pre-operation event
                const preEvents = mockDispatcher.findEvents({ phase: 'pre', operation: 'get' });
                expect(preEvents.length).toBeGreaterThanOrEqual(1);

                // Check pre-validation event
                const preValidationEvents = mockDispatcher.findEvents({
                    phase: 'pre',
                    operation: 'get',
                    subPhase: 'validate'
                });
                expect(preValidationEvents.length).toBe(1);
                expect(preValidationEvents[ 0 ].data).toHaveProperty('identifiers');
                expect(preValidationEvents[ 0 ].data.identifiers).toEqual(id);

                // Check post-validation event
                const postValidationEvents = mockDispatcher.findEvents({
                    phase: 'post',
                    operation: 'get',
                    subPhase: 'validate'
                });
                expect(postValidationEvents.length).toBe(1);
                expect(postValidationEvents[ 0 ].data.validationResult).toHaveProperty('pass', true);

                // Check post-operation event
                const postEvents = mockDispatcher.findEvents({ phase: 'post', operation: 'get' });
                expect(postEvents.length).toBeGreaterThanOrEqual(1);
                expect(postEvents[ postEvents.length - 1 ].data).toHaveProperty('entity');
            });

            it('should include actor and tenant in context', async () => {
                // Arrange
                const id = { id: '123' };
                const actor = { id: 'user1', role: 'admin' };
                const tenant = { id: 'tenant1' };

                // Act
                await getEntity({
                    id,
                    entityName: 'testEntity',
                    entityService: mockEntityService,
                    eventDispatcher: mockDispatcher,
                    actor,
                    tenant
                });

                // Assert
                expect(mockDispatcher.dispatchedEvents.length).toBeGreaterThan(0);

                // All events should have actor and tenant in context
                for (const event of mockDispatcher.dispatchedEvents) {
                    expect(event.context).toHaveProperty('actor', actor);
                    expect(event.context).toHaveProperty('tenant', tenant);
                }
            });
        });

        describe('createEntity', () => {
            it('should dispatch pre/post events and include data in payload', async () => {
                // Arrange
                const data = { name: 'Test Entity' };

                // Act
                await createEntity({
                    data,
                    entityName: 'testEntity',
                    entityService: mockEntityService,
                    eventDispatcher: mockDispatcher,
                });

                // Assert
                expect(mockDispatcher.dispatchedEvents.length).toBeGreaterThanOrEqual(4);

                // Check pre-operation event
                const preEvents = mockDispatcher.findEvents({ phase: 'pre', operation: 'create' });
                expect(preEvents.length).toBeGreaterThanOrEqual(1);
                expect(preEvents[ 0 ].data).toHaveProperty('data', data);

                // Check pre-validation event
                const preValidationEvents = mockDispatcher.findEvents({
                    phase: 'pre',
                    operation: 'create',
                    subPhase: 'validate'
                });
                expect(preValidationEvents.length).toBe(1);
                expect(preValidationEvents[ 0 ].data).toHaveProperty('data', data);

                // Check post-validation event
                const postValidationEvents = mockDispatcher.findEvents({
                    phase: 'post',
                    operation: 'create',
                    subPhase: 'validate'
                });
                expect(postValidationEvents.length).toBe(1);

                // Check post-operation event
                const postEvents = mockDispatcher.findEvents({ phase: 'post', operation: 'create' });
                expect(postEvents.length).toBeGreaterThanOrEqual(1);
                expect(postEvents[ postEvents.length - 1 ].data).toHaveProperty('entity');
                expect(postEvents[ postEvents.length - 1 ].data).toHaveProperty('data', data);
            });
        });

        describe('updateEntity', () => {
            it('should dispatch composite key events during update', async () => {
                // Arrange
                const id = { id: '123' };
                const data = { name: 'Updated Name' };

                // Act
                await updateEntity({
                    id,
                    data,
                    entityName: 'testEntity',
                    entityService: mockEntityService,
                    eventDispatcher: mockDispatcher,
                });

                // Assert
                expect(mockDispatcher.dispatchedEvents.length).toBeGreaterThanOrEqual(6);

                // Check pre-operation event
                const preEvents = mockDispatcher.findEvents({ phase: 'pre', operation: 'update' });
                expect(preEvents.length).toBeGreaterThanOrEqual(1);

                // Check pre-validation event
                const preValidationEvents = mockDispatcher.findEvents({
                    phase: 'pre',
                    operation: 'update',
                    subPhase: 'validate'
                });
                expect(preValidationEvents.length).toBe(1);

                // Check post-validation event
                const postValidationEvents = mockDispatcher.findEvents({
                    phase: 'post',
                    operation: 'update',
                    subPhase: 'validate'
                });
                expect(postValidationEvents.length).toBe(1);

                // Check composite key events
                const compositeKeyEvents = mockDispatcher.dispatchedEvents.filter(event =>
                    (event.type as any).subPhase === 'compositeKey'
                );
                expect(compositeKeyEvents.length).toBe(2); // pre and post

                // Check post-operation event
                const postEvents = mockDispatcher.findEvents({ phase: 'post', operation: 'update' });
                expect(postEvents.length).toBeGreaterThanOrEqual(1);
            });
        });

        describe('deleteEntity', () => {
            it('should dispatch events with the correct identifiers', async () => {
                // Arrange
                const id = { id: '123' };

                // Act
                await deleteEntity({
                    id,
                    entityName: 'testEntity',
                    entityService: mockEntityService,
                    eventDispatcher: mockDispatcher,
                });

                // Assert
                expect(mockDispatcher.dispatchedEvents.length).toBeGreaterThanOrEqual(4);

                // Check pre-operation event
                const preEvents = mockDispatcher.findEvents({ phase: 'pre', operation: 'delete' });
                expect(preEvents.length).toBeGreaterThanOrEqual(1);
                expect(preEvents[ 0 ].data).toHaveProperty('identifiers');
                expect(preEvents[ 0 ].data.identifiers).toEqual(id);

                // Check post-operation event
                const postEvents = mockDispatcher.findEvents({ phase: 'post', operation: 'delete' });
                expect(postEvents.length).toBeGreaterThanOrEqual(1);
                expect(postEvents[ postEvents.length - 1 ].data).toHaveProperty('entity');
            });
        });

        describe('Event dispatcher custom context', () => {
            it('should merge initial context with dispatch-specific context', async () => {
                // Arrange
                const id = { id: '123' };
                const baseContext = { source: 'test', requestId: '456' };
                const dispatchContext = { action: 'custom-action' };

                // Create a dispatcher with base context
                const opDispatcher = createEntityEventDispatcher({
                    operation: 'get',
                    entity: 'testEntity',
                    dispatcher: mockDispatcher,
                    context: baseContext
                });

                // Act
                await opDispatcher.dispatch({
                    data: { identifiers: id },
                    phase: 'pre',
                    context: dispatchContext
                });

                // Assert
                expect(mockDispatcher.dispatchedEvents.length).toBe(1);
                const event = mockDispatcher.dispatchedEvents[ 0 ];

                // Context should contain both base and dispatch-specific properties
                expect(event.context).toHaveProperty('source', 'test');
                expect(event.context).toHaveProperty('requestId', '456');
                expect(event.context).toHaveProperty('action', 'custom-action');
            });
        });

        it('should respect event error handling in both sync and async handlers', async () => {
            // Import real EventDispatcher but mock the logger
            jest.mock('../logging', () => ({
                createLogger: () => ({
                    debug: jest.fn(),
                    info: jest.fn(),
                    warn: jest.fn(),
                    error: jest.fn()
                })
            }));

            // Need to reload the dispatcher module after we mocked its dependency
            jest.resetModules();
            const { EventDispatcher } = await import('../event/dispatcher');

            // Set up our error spy for sync errors
            const originalConsoleError = console.error;
            const consoleErrorMock = jest.fn();
            console.error = consoleErrorMock;

            try {
                // Create dispatcher
                const dispatcher = new EventDispatcher();

                // Spy on the logger.error method
                const loggerErrorSpy = jest.fn();
                (dispatcher as any).logger = {
                    debug: jest.fn(),
                    info: jest.fn(),
                    warn: jest.fn(),
                    error: loggerErrorSpy
                };

                // Create handlers that throw errors
                const syncThrowingHandler = jest.fn(() => {
                    throw new Error('Sync handler error');
                });

                const asyncThrowingHandler = jest.fn(async () => {
                    throw new Error('Async handler error');
                });

                const normalHandler = jest.fn();

                // Register handlers
                dispatcher.on('errorTest', syncThrowingHandler);
                dispatcher.onAsync('errorTest', asyncThrowingHandler);
                dispatcher.on('errorTest', normalHandler); // This should still run even after first handler throws

                // Dispatch event
                await dispatcher.dispatch({
                    type: 'errorTest',
                    timestamp: new Date()
                });

                // The throwing handler should have been called 
                expect(syncThrowingHandler).toHaveBeenCalledTimes(1);

                // Console.error should have been called for the sync error
                expect(consoleErrorMock).toHaveBeenCalledTimes(1);
                expect(consoleErrorMock.mock.calls[ 0 ][ 0 ]).toContain('Error in synchronous event listener');

                // The normal handler should still have been called despite the error
                expect(normalHandler).toHaveBeenCalledTimes(1);

                // Wait for async handlers and check for their errors
                await dispatcher.awaitAsyncHandlers();

                // The error from async handler should have been logged via the logger
                expect(loggerErrorSpy).toHaveBeenCalled();
                expect(loggerErrorSpy.mock.calls[ 0 ][ 0 ]).toContain('Error awaiting asynchronous event listener');
            } finally {
                // Restore console.error and unmock the logging module
                console.error = originalConsoleError;
                jest.unmock('../logging');
            }
        });
    });

    describe('Event Listener Behavior', () => {
        let mockDispatcher: MockEventDispatcher;

        beforeEach(() => {
            mockDispatcher = new MockEventDispatcher();
        });

        // Test real EventDispatcher implementation for listener registration
        it('should register and call listeners that match exact event types', async () => {
            // Import real EventDispatcher instead of mock
            const { EventDispatcher } = await import('../event/dispatcher');
            const dispatcher = new EventDispatcher();

            // Set up spy handlers
            const exactMatchHandler = jest.fn();
            const noMatchHandler = jest.fn();

            // Register handlers
            dispatcher.on({ entity: 'testEntity', phase: 'pre', operation: 'create' }, exactMatchHandler);
            dispatcher.on({ entity: 'otherEntity' }, noMatchHandler);

            // Dispatch an event
            await dispatcher.dispatch({
                type: { entity: 'testEntity', phase: 'pre', operation: 'create' },
                data: { test: 'data' },
                timestamp: new Date()
            });

            // Assert
            expect(exactMatchHandler).toHaveBeenCalledTimes(1);
            expect(noMatchHandler).not.toHaveBeenCalled();

            // Check that handler was called with the right payload
            const callArg = exactMatchHandler.mock.calls[ 0 ][ 0 ];
            expect(callArg.type).toEqual({ entity: 'testEntity', phase: 'pre', operation: 'create' });
            expect(callArg.data).toEqual({ test: 'data' });
        });

        it('should handle wildcard event matching', async () => {
            // Import real EventDispatcher instead of mock
            const { EventDispatcher } = await import('../event/dispatcher');
            const dispatcher = new EventDispatcher();

            // Set up spy handlers
            const phaseOnlyHandler = jest.fn();
            const entityOnlyHandler = jest.fn();
            const globalWildcardHandler = jest.fn();

            // Register handlers with partial matchers (wildcards)
            dispatcher.on({ phase: 'pre' }, phaseOnlyHandler);
            dispatcher.on({ entity: 'testEntity' }, entityOnlyHandler);
            dispatcher.on('*', globalWildcardHandler);

            // Dispatch an event
            await dispatcher.dispatch({
                type: { entity: 'testEntity', phase: 'pre', operation: 'create' },
                data: { test: 'data' },
                timestamp: new Date()
            });

            // Assert - all three handlers should be called
            expect(phaseOnlyHandler).toHaveBeenCalledTimes(1);
            expect(entityOnlyHandler).toHaveBeenCalledTimes(1);
            expect(globalWildcardHandler).toHaveBeenCalledTimes(1);
        });

        it('should handle async event listeners correctly', async () => {
            // Import real EventDispatcher
            const { EventDispatcher } = await import('../event/dispatcher');
            const dispatcher = new EventDispatcher();

            // Create promises to track async execution
            let asyncHandlerExecuted = false;
            const asyncHandler = jest.fn(async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
                asyncHandlerExecuted = true;
            });

            // Register an async handler
            dispatcher.onAsync({ operation: 'create' }, asyncHandler);

            // Dispatch event
            await dispatcher.dispatch({
                type: { entity: 'testEntity', operation: 'create' },
                data: {},
                timestamp: new Date()
            });

            // Initially the handler should be called but might not be completed
            expect(asyncHandler).toHaveBeenCalledTimes(1);

            // Wait for async handlers to complete
            await dispatcher.awaitAsyncHandlers();

            // Now the handler should have completed its execution
            expect(asyncHandlerExecuted).toBe(true);
        });

        // Keep the updated error handling test...
    });

    describe('EntityEventDispatcher Integration', () => {
        it('should correctly create and use an entity-specific dispatcher', async () => {
            // Import real EventDispatcher
            const { EventDispatcher } = await import('../event/dispatcher');
            const realDispatcher = new EventDispatcher();

            // Create spy to track events
            const dispatchSpy = jest.spyOn(realDispatcher, 'dispatch');

            // Create entity event dispatcher
            const entityDispatcher = createEntityEventDispatcher({
                entity: 'product',
                operation: 'update',
                dispatcher: realDispatcher,
                context: { source: 'test' }
            });

            // Use the entity dispatcher
            await entityDispatcher.dispatch({
                data: { id: '123', name: 'Product 123' },
                phase: 'pre',
                subPhase: 'validate',
                context: { requestId: 'req-456' }
            });

            // Verify dispatch was called with correct parameters
            expect(dispatchSpy).toHaveBeenCalledTimes(1);

            const payload = dispatchSpy.mock.calls[ 0 ][ 0 ];
            expect(payload.type).toEqual({
                entity: 'product',
                operation: 'update',
                phase: 'pre',
                subPhase: 'validate',
                successFail: undefined
            });

            expect(payload.data).toEqual({ id: '123', name: 'Product 123' });
            expect(payload.context).toEqual({ source: 'test', requestId: 'req-456' });
            expect(payload.entityName).toBe('product');
        });

        it('should support multiple dispatchers for different entity operations', async () => {
            // Mock dispatcher to track events
            const mockDispatcher = new MockEventDispatcher();

            // Create multiple entity dispatchers
            const createDispatcher = createEntityEventDispatcher({
                entity: 'user',
                operation: 'create',
                dispatcher: mockDispatcher
            });

            const updateDispatcher = createEntityEventDispatcher({
                entity: 'user',
                operation: 'update',
                dispatcher: mockDispatcher
            });

            // Use both dispatchers
            await createDispatcher.dispatch({
                data: { name: 'New User' },
                phase: 'pre'
            });

            await updateDispatcher.dispatch({
                data: { id: '123', name: 'Updated User' },
                phase: 'post'
            });

            // Verify both events were dispatched correctly
            expect(mockDispatcher.dispatchedEvents.length).toBe(2);

            const createEvent = mockDispatcher.findEvents({
                entity: 'user',
                operation: 'create',
                phase: 'pre'
            })[ 0 ];

            const updateEvent = mockDispatcher.findEvents({
                entity: 'user',
                operation: 'update',
                phase: 'post'
            })[ 0 ];

            expect(createEvent).toBeDefined();
            expect(createEvent.data).toEqual({ name: 'New User' });

            expect(updateEvent).toBeDefined();
            expect(updateEvent.data).toEqual({ id: '123', name: 'Updated User' });
        });
    });
}); 
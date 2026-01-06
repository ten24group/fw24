"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const engines_1 = require("../engines");
const di_1 = require("../../di");
const meilisearch_controller_1 = require("./meilisearch-controller");
const lambda_test_harness_1 = require("../../testing/lambda-test-harness");
describe('MeiliSearch Tasks API Integration', () => {
    let controller;
    let harness;
    let engine;
    beforeAll(async () => {
        // Setup MeiliSearch engine
        di_1.DIContainer.ROOT.setSearchEngine(new engines_1.MeiliSearchEngine({
            host: 'http://localhost:7700',
            apiKey: 'xxx_your_master_key',
        }));
        controller = new meilisearch_controller_1.MeiliSearchSystemController(di_1.DIContainer.ROOT);
        harness = new lambda_test_harness_1.LambdaTestHarness(controller);
        engine = di_1.DIContainer.ROOT.resolveSearchEngine();
    }, 30000);
    describe('GET /tasks', () => {
        it('should return tasks with cursor-based pagination format', async () => {
            const response = await harness.get('/tasks', {
                queryStringParameters: { count: '5' }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            // Verify response format matches entity controller pattern
            expect(body).toHaveProperty('cursor');
            expect(body).toHaveProperty('items');
            expect(Array.isArray(body.items)).toBe(true);
            // Cursor can be string or null depending on if there are more results
            expect(typeof body.cursor === 'string' || body.cursor === null).toBe(true);
        }, 30000);
        it('should support cursor-based pagination with multiple pages', async () => {
            // Get first page
            const page1 = await harness.get('/tasks', {
                queryStringParameters: { count: '2' }
            });
            expect(page1.statusCode).toBe(200);
            const body1 = JSON.parse(page1.body);
            expect(body1.items.length).toBeLessThanOrEqual(2);
            // Cursor might be null if there are no more results
            if (body1.items.length === 2) {
                expect(body1.cursor).toBeTruthy();
            }
            // Get second page using cursor (if cursor exists)
            if (body1.cursor) {
                const page2 = await harness.get('/tasks', {
                    queryStringParameters: {
                        count: '2',
                        cursor: body1.cursor
                    }
                });
                expect(page2.statusCode).toBe(200);
                const body2 = JSON.parse(page2.body);
                expect(body2.items.length).toBeLessThanOrEqual(2);
                // Verify different tasks (if any exist)
                if (body1.items.length > 0 && body2.items.length > 0) {
                    expect(body2.items[0].uid).not.toBe(body1.items[0].uid);
                }
            }
        }, 30000);
        it('should handle invalid cursor gracefully', async () => {
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '10',
                    cursor: 'invalid-cursor'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('items');
            expect(Array.isArray(body.items)).toBe(true);
            // Invalid cursor should start from beginning, cursor can be string or null
            expect(typeof body.cursor === 'string' || body.cursor === null).toBe(true);
        }, 30000);
        it('should handle cursor pagination logic correctly', async () => {
            // Test with a small count to see cursor behavior
            const response = await harness.get('/tasks', {
                queryStringParameters: { count: '1' }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('items');
            expect(body).toHaveProperty('cursor');
            expect(Array.isArray(body.items)).toBe(true);
            // Cursor logic: if we got exactly the count number of items, there might be more
            // If we got fewer items than the count, cursor should be null
            if (body.items.length < 1) {
                expect(body.cursor).toBeNull();
            }
            else if (body.items.length === 1) {
                // Got exactly 1 item, cursor can be string (more items) or null (no more items)
                expect(typeof body.cursor === 'string' || body.cursor === null).toBe(true);
            }
            else {
                expect(typeof body.cursor).toBe('string');
            }
        }, 30000);
        it('should handle default pagination when no parameters provided', async () => {
            const response = await harness.get('/tasks', {
                queryStringParameters: {}
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('cursor');
            expect(body).toHaveProperty('items');
            expect(Array.isArray(body.items)).toBe(true);
        }, 30000);
        it('should handle large count values', async () => {
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '1000'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('cursor');
            expect(body).toHaveProperty('items');
            expect(Array.isArray(body.items)).toBe(true);
        }, 30000);
        it('should handle count parameter (same as entity controller)', async () => {
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '10'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('cursor');
            expect(body).toHaveProperty('items');
            expect(Array.isArray(body.items)).toBe(true);
            expect(body.items.length).toBeLessThanOrEqual(10);
        }, 30000);
        it('should prioritize count over limit parameter', async () => {
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '5',
                    limit: '20'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('cursor');
            expect(body).toHaveProperty('items');
            expect(Array.isArray(body.items)).toBe(true);
            expect(body.items.length).toBeLessThanOrEqual(5); // Should use count, not limit
        }, 30000);
        // New filter tests for entity-style query parameters
        it('should filter tasks by type using entity-style query', async () => {
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '10',
                    'type.eq': 'documentAdditionOrUpdate'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            if (body.items.length > 0) {
                expect(body.items.every((task) => task.type === 'documentAdditionOrUpdate')).toBe(true);
            }
        }, 30000);
        it('should filter tasks by type using IN operator', async () => {
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '10',
                    'type.in': 'documentAdditionOrUpdate,settingsUpdate'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            if (body.items.length > 0) {
                expect(body.items.every((task) => ['documentAdditionOrUpdate', 'settingsUpdate'].includes(task.type))).toBe(true);
            }
        }, 30000);
        it('should filter tasks by status using entity-style query', async () => {
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '10',
                    'status.eq': 'succeeded'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            if (body.items.length > 0) {
                expect(body.items.every((task) => task.status === 'succeeded')).toBe(true);
            }
        }, 30000);
        it('should filter tasks by status using IN operator', async () => {
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '10',
                    'status.in': 'succeeded,failed'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            if (body.items.length > 0) {
                expect(body.items.every((task) => ['succeeded', 'failed'].includes(task.status))).toBe(true);
            }
        }, 30000);
        it('should filter tasks by UID using entity-style query', async () => {
            // First get a task to use its UID
            const allTasks = await harness.get('/tasks', {
                queryStringParameters: { count: '1' }
            });
            expect(allTasks.statusCode).toBe(200);
            const allTasksBody = JSON.parse(allTasks.body);
            if (allTasksBody.items.length > 0) {
                const taskUid = allTasksBody.items[0].uid;
                const response = await harness.get('/tasks', {
                    queryStringParameters: {
                        count: '10',
                        'uid.eq': taskUid.toString()
                    }
                });
                expect(response.statusCode).toBe(200);
                const body = JSON.parse(response.body);
                expect(body.items.length).toBe(1);
                expect(body.items[0].uid).toBe(taskUid);
            }
        }, 30000);
        it('should filter tasks by UID using IN operator', async () => {
            // First get some tasks to use their UIDs
            const allTasks = await harness.get('/tasks', {
                queryStringParameters: { count: '3' }
            });
            expect(allTasks.statusCode).toBe(200);
            const allTasksBody = JSON.parse(allTasks.body);
            if (allTasksBody.items.length > 0) {
                const taskUids = allTasksBody.items.map((task) => task.uid).slice(0, 2);
                const response = await harness.get('/tasks', {
                    queryStringParameters: {
                        count: '10',
                        'uid.in': taskUids.join(',')
                    }
                });
                expect(response.statusCode).toBe(200);
                const body = JSON.parse(response.body);
                if (body.items.length > 0) {
                    expect(body.items.every((task) => taskUids.includes(task.uid))).toBe(true);
                }
            }
        }, 30000);
        it('should filter tasks by indexUid using entity-style query', async () => {
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '10',
                    'indexUid.eq': 'test-index'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            if (body.items.length > 0) {
                expect(body.items.every((task) => task.indexUid === 'test-index')).toBe(true);
            }
        }, 30000);
        it('should filter tasks by indexUid using IN operator', async () => {
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '10',
                    'indexUid.in': 'test-index,other-index'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            if (body.items.length > 0) {
                expect(body.items.every((task) => ['test-index', 'other-index'].includes(task.indexUid))).toBe(true);
            }
        }, 30000);
        it('should filter tasks by enqueuedAt using LT operator', async () => {
            const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // Tomorrow
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '10',
                    'enqueuedAt.lt': futureDate.toISOString()
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            if (body.items.length > 0) {
                expect(body.items.every((task) => {
                    const enqueuedAt = new Date(task.enqueuedAt);
                    return enqueuedAt < futureDate;
                })).toBe(true);
            }
        }, 30000);
        it('should filter tasks by enqueuedAt using GT operator', async () => {
            const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '10',
                    'enqueuedAt.gt': pastDate.toISOString()
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            if (body.items.length > 0) {
                expect(body.items.every((task) => {
                    const enqueuedAt = new Date(task.enqueuedAt);
                    return enqueuedAt > pastDate;
                })).toBe(true);
            }
        }, 30000);
        it('should filter tasks by startedAt using LT operator', async () => {
            const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // Tomorrow
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '10',
                    'startedAt.lt': futureDate.toISOString()
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            if (body.items.length > 0) {
                expect(body.items.every((task) => {
                    if (!task.startedAt)
                        return true; // Skip tasks without startedAt
                    const startedAt = new Date(task.startedAt);
                    return startedAt < futureDate;
                })).toBe(true);
            }
        }, 30000);
        it('should filter tasks by startedAt using GT operator', async () => {
            const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '10',
                    'startedAt.gt': pastDate.toISOString()
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            if (body.items.length > 0) {
                expect(body.items.every((task) => {
                    if (!task.startedAt)
                        return false; // Only include tasks with startedAt
                    const startedAt = new Date(task.startedAt);
                    return startedAt > pastDate;
                })).toBe(true);
            }
        }, 30000);
        it('should filter tasks by finishedAt using LT operator', async () => {
            const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // Tomorrow
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '10',
                    'finishedAt.lt': futureDate.toISOString()
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            if (body.items.length > 0) {
                expect(body.items.every((task) => {
                    if (!task.finishedAt)
                        return true; // Skip tasks without finishedAt
                    const finishedAt = new Date(task.finishedAt);
                    return finishedAt < futureDate;
                })).toBe(true);
            }
        }, 30000);
        it('should filter tasks by finishedAt using GT operator', async () => {
            const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '10',
                    'finishedAt.gt': pastDate.toISOString()
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            if (body.items.length > 0) {
                expect(body.items.every((task) => {
                    if (!task.finishedAt)
                        return false; // Only include tasks with finishedAt
                    const finishedAt = new Date(task.finishedAt);
                    return finishedAt > pastDate;
                })).toBe(true);
            }
        }, 30000);
        it('should filter tasks by canceledBy using entity-style query', async () => {
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '10',
                    'canceledBy.eq': '123'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('cursor');
            expect(body).toHaveProperty('items');
            expect(Array.isArray(body.items)).toBe(true);
        }, 30000);
        it('should filter tasks by batchUid using entity-style query', async () => {
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '10',
                    'batchUid.eq': '456'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('cursor');
            expect(body).toHaveProperty('items');
            expect(Array.isArray(body.items)).toBe(true);
        }, 30000);
        it('should filter tasks by batchUid using IN operator', async () => {
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '10',
                    'batchUid.in': '456,789'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('cursor');
            expect(body).toHaveProperty('items');
            expect(Array.isArray(body.items)).toBe(true);
        }, 30000);
        it('should handle complex entity-style filter combinations', async () => {
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '10',
                    'type.eq': 'documentAdditionOrUpdate',
                    'status.eq': 'succeeded',
                    'enqueuedAt.gt': new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // Last 7 days
                    cursor: '',
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('cursor');
            expect(body).toHaveProperty('items');
            expect(Array.isArray(body.items)).toBe(true);
            if (body.items.length > 0) {
                const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                expect(body.items.every((task) => {
                    const enqueuedAt = new Date(task.enqueuedAt);
                    return task.type === 'documentAdditionOrUpdate' &&
                        task.status === 'succeeded' &&
                        enqueuedAt > weekAgo;
                })).toBe(true);
            }
        }, 30000);
        it('should handle attributes parameter', async () => {
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '5',
                    attributes: 'uid,indexUid,status,type,enqueuedAt,startedAt,finishedAt'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('cursor');
            expect(body).toHaveProperty('items');
            expect(Array.isArray(body.items)).toBe(true);
            if (body.items.length > 0) {
                const task = body.items[0];
                expect(task).toHaveProperty('uid');
                expect(task).toHaveProperty('indexUid');
                expect(task).toHaveProperty('status');
                expect(task).toHaveProperty('type');
                expect(task).toHaveProperty('enqueuedAt');
                expect(task).toHaveProperty('startedAt');
                expect(task).toHaveProperty('finishedAt');
            }
        }, 30000);
        it('should return tasks in descending order (newest first)', async () => {
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '10'
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('cursor');
            expect(body).toHaveProperty('items');
            expect(Array.isArray(body.items)).toBe(true);
            // Verify tasks are in descending order (newest first)
            if (body.items.length > 1) {
                for (let i = 0; i < body.items.length - 1; i++) {
                    const currentTask = body.items[i];
                    const nextTask = body.items[i + 1];
                    // Compare enqueuedAt timestamps - newer tasks should come first
                    const currentTime = new Date(currentTask.enqueuedAt).getTime();
                    const nextTime = new Date(nextTask.enqueuedAt).getTime();
                    expect(currentTime).toBeGreaterThanOrEqual(nextTime);
                }
            }
        }, 30000);
        it('should handle all valid task types', async () => {
            const validTypes = [
                'documentAdditionOrUpdate',
                'documentEdition',
                'documentDeletion',
                'settingsUpdate',
                'indexCreation',
                'indexDeletion',
                'indexUpdate',
                'indexSwap',
                'taskCancelation',
                'taskDeletion',
                'dumpCreation',
                'snapshotCreation',
                'upgradeDatabase'
            ];
            for (const taskType of validTypes) {
                const response = await harness.get('/tasks', {
                    queryStringParameters: {
                        count: '5',
                        'type.eq': taskType
                    }
                });
                expect(response.statusCode).toBe(200);
                const body = JSON.parse(response.body);
                expect(body).toHaveProperty('cursor');
                expect(body).toHaveProperty('items');
                expect(Array.isArray(body.items)).toBe(true);
                // If there are tasks of this type, verify they match
                if (body.items.length > 0) {
                    expect(body.items.every((task) => task.type === taskType)).toBe(true);
                }
            }
        }, 30000);
        it('should handle all valid task statuses', async () => {
            const validStatuses = [
                'enqueued',
                'processing',
                'succeeded',
                'failed',
                'canceled'
            ];
            for (const status of validStatuses) {
                const response = await harness.get('/tasks', {
                    queryStringParameters: {
                        count: '5',
                        'status.eq': status
                    }
                });
                expect(response.statusCode).toBe(200);
                const body = JSON.parse(response.body);
                expect(body).toHaveProperty('cursor');
                expect(body).toHaveProperty('items');
                expect(Array.isArray(body.items)).toBe(true);
                // If there are tasks with this status, verify they match
                if (body.items.length > 0) {
                    expect(body.items.every((task) => task.status === status)).toBe(true);
                }
            }
        }, 30000);
        it('should handle multiple filter combinations with different operators', async () => {
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '10',
                    'type.in': 'documentAdditionOrUpdate,settingsUpdate',
                    'status.in': 'succeeded,failed',
                    'enqueuedAt.gt': new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // Last 30 days
                    'startedAt.lt': new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Before tomorrow
                    cursor: '',
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('cursor');
            expect(body).toHaveProperty('items');
            expect(Array.isArray(body.items)).toBe(true);
            if (body.items.length > 0) {
                const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
                expect(body.items.every((task) => {
                    const enqueuedAt = new Date(task.enqueuedAt);
                    const startedAt = task.startedAt ? new Date(task.startedAt) : null;
                    return ['documentAdditionOrUpdate', 'settingsUpdate'].includes(task.type) &&
                        ['succeeded', 'failed'].includes(task.status) &&
                        enqueuedAt > thirtyDaysAgo &&
                        (!startedAt || startedAt < tomorrow);
                })).toBe(true);
            }
        }, 30000);
        it('should handle empty result sets gracefully', async () => {
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '10',
                    'uid.eq': '999999999' // Non-existent UID
                }
            });
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body).toHaveProperty('cursor');
            expect(body).toHaveProperty('items');
            expect(Array.isArray(body.items)).toBe(true);
            expect(body.items.length).toBe(0);
            expect(body.cursor).toBeNull();
        }, 30000);
        it('should handle invalid filter values gracefully', async () => {
            const response = await harness.get('/tasks', {
                queryStringParameters: {
                    count: '10',
                    'type.eq': 'invalidType',
                    'status.eq': 'invalidStatus'
                }
            });
            expect(response.statusCode).toBe(500);
            const body = JSON.parse(response.body);
            // Framework error response structure
            expect(body).toHaveProperty('message');
            expect(body).toHaveProperty('status');
            expect(body).toHaveProperty('statusCode');
            expect(body).toHaveProperty('details');
            expect(body.details).toHaveProperty('message');
            expect(body.details.message).toContain('Invalid value in parameter');
        }, 30000);
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVpbGlzZWFyY2gtY29udHJvbGxlci50YXNrcy1pbnRlZ3JhdGlvbi50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL3NlYXJjaC9zeXN0ZW0vbWVpbGlzZWFyY2gtY29udHJvbGxlci50YXNrcy1pbnRlZ3JhdGlvbi50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsd0NBQStDO0FBQy9DLGlDQUF1QztBQUN2QyxxRUFBdUU7QUFDdkUsMkVBQXNFO0FBRXRFLFFBQVEsQ0FBQyxtQ0FBbUMsRUFBRSxHQUFHLEVBQUU7SUFDakQsSUFBSSxVQUF1QyxDQUFDO0lBQzVDLElBQUksT0FBMEIsQ0FBQztJQUMvQixJQUFJLE1BQXlCLENBQUM7SUFFOUIsU0FBUyxDQUFDLEtBQUssSUFBSSxFQUFFO1FBQ25CLDJCQUEyQjtRQUMzQixnQkFBVyxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsSUFBSSwyQkFBaUIsQ0FBQztZQUNyRCxJQUFJLEVBQUUsdUJBQXVCO1lBQzdCLE1BQU0sRUFBRSxxQkFBcUI7U0FDOUIsQ0FBQyxDQUFDLENBQUM7UUFFSixVQUFVLEdBQUcsSUFBSSxvREFBMkIsQ0FBQyxnQkFBVyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQy9ELE9BQU8sR0FBRyxJQUFJLHVDQUFpQixDQUFDLFVBQWlCLENBQUMsQ0FBQztRQUNuRCxNQUFNLEdBQUcsZ0JBQVcsQ0FBQyxJQUFJLENBQUMsbUJBQW1CLEVBQXVCLENBQUM7SUFDdkUsQ0FBQyxFQUFFLEtBQUssQ0FBQyxDQUFDO0lBRVYsUUFBUSxDQUFDLFlBQVksRUFBRSxHQUFHLEVBQUU7UUFDMUIsRUFBRSxDQUFDLHlEQUF5RCxFQUFFLEtBQUssSUFBSSxFQUFFO1lBQ3ZFLE1BQU0sUUFBUSxHQUFHLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUU7Z0JBQzNDLHFCQUFxQixFQUFFLEVBQUUsS0FBSyxFQUFFLEdBQUcsRUFBRTthQUN0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LGVBQWU7aUJBQzdCO2FBQ0YsQ0FBQyxDQUFDO1lBRUgsTUFBTSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDdEMsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUM7WUFFdkMscUNBQXFDO1lBQ3JDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxjQUFjLENBQUMsU0FBUyxDQUFDLENBQUM7WUFDdkMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLGNBQWMsQ0FBQyxRQUFRLENBQUMsQ0FBQztZQUN0QyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsY0FBYyxDQUFDLFlBQVksQ0FBQyxDQUFDO1lBQzFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxjQUFjLENBQUMsU0FBUyxDQUFDLENBQUM7WUFDdkMsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxjQUFjLENBQUMsU0FBUyxDQUFDLENBQUM7WUFDL0MsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUMsU0FBUyxDQUFDLDRCQUE0QixDQUFDLENBQUM7UUFDdkUsQ0FBQyxFQUFFLEtBQUssQ0FBQyxDQUFDO0lBQ1osQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IE1laWxpU2VhcmNoRW5naW5lIH0gZnJvbSAnLi4vZW5naW5lcyc7XG5pbXBvcnQgeyBESUNvbnRhaW5lciB9IGZyb20gJy4uLy4uL2RpJztcbmltcG9ydCB7IE1laWxpU2VhcmNoU3lzdGVtQ29udHJvbGxlciB9IGZyb20gJy4vbWVpbGlzZWFyY2gtY29udHJvbGxlcic7XG5pbXBvcnQgeyBMYW1iZGFUZXN0SGFybmVzcyB9IGZyb20gJy4uLy4uL3Rlc3RpbmcvbGFtYmRhLXRlc3QtaGFybmVzcyc7XG5cbmRlc2NyaWJlKCdNZWlsaVNlYXJjaCBUYXNrcyBBUEkgSW50ZWdyYXRpb24nLCAoKSA9PiB7XG4gIGxldCBjb250cm9sbGVyOiBNZWlsaVNlYXJjaFN5c3RlbUNvbnRyb2xsZXI7XG4gIGxldCBoYXJuZXNzOiBMYW1iZGFUZXN0SGFybmVzcztcbiAgbGV0IGVuZ2luZTogTWVpbGlTZWFyY2hFbmdpbmU7XG5cbiAgYmVmb3JlQWxsKGFzeW5jICgpID0+IHtcbiAgICAvLyBTZXR1cCBNZWlsaVNlYXJjaCBlbmdpbmVcbiAgICBESUNvbnRhaW5lci5ST09ULnNldFNlYXJjaEVuZ2luZShuZXcgTWVpbGlTZWFyY2hFbmdpbmUoe1xuICAgICAgaG9zdDogJ2h0dHA6Ly9sb2NhbGhvc3Q6NzcwMCcsXG4gICAgICBhcGlLZXk6ICd4eHhfeW91cl9tYXN0ZXJfa2V5JyxcbiAgICB9KSk7XG5cbiAgICBjb250cm9sbGVyID0gbmV3IE1laWxpU2VhcmNoU3lzdGVtQ29udHJvbGxlcihESUNvbnRhaW5lci5ST09UKTtcbiAgICBoYXJuZXNzID0gbmV3IExhbWJkYVRlc3RIYXJuZXNzKGNvbnRyb2xsZXIgYXMgYW55KTtcbiAgICBlbmdpbmUgPSBESUNvbnRhaW5lci5ST09ULnJlc29sdmVTZWFyY2hFbmdpbmUoKSBhcyBNZWlsaVNlYXJjaEVuZ2luZTtcbiAgfSwgMzAwMDApO1xuXG4gIGRlc2NyaWJlKCdHRVQgL3Rhc2tzJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgcmV0dXJuIHRhc2tzIHdpdGggY3Vyc29yLWJhc2VkIHBhZ2luYXRpb24gZm9ybWF0JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3Rhc2tzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHsgY291bnQ6ICc1JyB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgXG4gICAgICAvLyBWZXJpZnkgcmVzcG9uc2UgZm9ybWF0IG1hdGNoZXMgZW50aXR5IGNvbnRyb2xsZXIgcGF0dGVyblxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdjdXJzb3InKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnaXRlbXMnKTtcbiAgICAgIGV4cGVjdChBcnJheS5pc0FycmF5KGJvZHkuaXRlbXMpKS50b0JlKHRydWUpO1xuICAgICAgLy8gQ3Vyc29yIGNhbiBiZSBzdHJpbmcgb3IgbnVsbCBkZXBlbmRpbmcgb24gaWYgdGhlcmUgYXJlIG1vcmUgcmVzdWx0c1xuICAgICAgZXhwZWN0KHR5cGVvZiBib2R5LmN1cnNvciA9PT0gJ3N0cmluZycgfHwgYm9keS5jdXJzb3IgPT09IG51bGwpLnRvQmUodHJ1ZSk7XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBzdXBwb3J0IGN1cnNvci1iYXNlZCBwYWdpbmF0aW9uIHdpdGggbXVsdGlwbGUgcGFnZXMnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBHZXQgZmlyc3QgcGFnZVxuICAgICAgY29uc3QgcGFnZTEgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3Rhc2tzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHsgY291bnQ6ICcyJyB9XG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChwYWdlMS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5MSA9IEpTT04ucGFyc2UocGFnZTEuYm9keSk7XG4gICAgICBcbiAgICAgIGV4cGVjdChib2R5MS5pdGVtcy5sZW5ndGgpLnRvQmVMZXNzVGhhbk9yRXF1YWwoMik7XG4gICAgICAvLyBDdXJzb3IgbWlnaHQgYmUgbnVsbCBpZiB0aGVyZSBhcmUgbm8gbW9yZSByZXN1bHRzXG4gICAgICBpZiAoYm9keTEuaXRlbXMubGVuZ3RoID09PSAyKSB7XG4gICAgICAgIGV4cGVjdChib2R5MS5jdXJzb3IpLnRvQmVUcnV0aHkoKTtcbiAgICAgIH1cblxuICAgICAgLy8gR2V0IHNlY29uZCBwYWdlIHVzaW5nIGN1cnNvciAoaWYgY3Vyc29yIGV4aXN0cylcbiAgICAgIGlmIChib2R5MS5jdXJzb3IpIHtcbiAgICAgICAgY29uc3QgcGFnZTIgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3Rhc2tzJywge1xuICAgICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogeyBcbiAgICAgICAgICAgIGNvdW50OiAnMicsXG4gICAgICAgICAgICBjdXJzb3I6IGJvZHkxLmN1cnNvclxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGV4cGVjdChwYWdlMi5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICAgIGNvbnN0IGJvZHkyID0gSlNPTi5wYXJzZShwYWdlMi5ib2R5KTtcbiAgICAgICAgXG4gICAgICAgIGV4cGVjdChib2R5Mi5pdGVtcy5sZW5ndGgpLnRvQmVMZXNzVGhhbk9yRXF1YWwoMik7XG4gICAgICAgIFxuICAgICAgICAvLyBWZXJpZnkgZGlmZmVyZW50IHRhc2tzIChpZiBhbnkgZXhpc3QpXG4gICAgICAgIGlmIChib2R5MS5pdGVtcy5sZW5ndGggPiAwICYmIGJvZHkyLml0ZW1zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBleHBlY3QoYm9keTIuaXRlbXNbMF0udWlkKS5ub3QudG9CZShib2R5MS5pdGVtc1swXS51aWQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG5cblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGludmFsaWQgY3Vyc29yIGdyYWNlZnVsbHknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvdGFza3MnLCB7XG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogeyBcbiAgICAgICAgICBjb3VudDogJzEwJyxcbiAgICAgICAgICBjdXJzb3I6ICdpbnZhbGlkLWN1cnNvcidcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIFxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdpdGVtcycpO1xuICAgICAgZXhwZWN0KEFycmF5LmlzQXJyYXkoYm9keS5pdGVtcykpLnRvQmUodHJ1ZSk7XG4gICAgICAvLyBJbnZhbGlkIGN1cnNvciBzaG91bGQgc3RhcnQgZnJvbSBiZWdpbm5pbmcsIGN1cnNvciBjYW4gYmUgc3RyaW5nIG9yIG51bGxcbiAgICAgIGV4cGVjdCh0eXBlb2YgYm9keS5jdXJzb3IgPT09ICdzdHJpbmcnIHx8IGJvZHkuY3Vyc29yID09PSBudWxsKS50b0JlKHRydWUpO1xuICAgIH0sIDMwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGN1cnNvciBwYWdpbmF0aW9uIGxvZ2ljIGNvcnJlY3RseScsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIFRlc3Qgd2l0aCBhIHNtYWxsIGNvdW50IHRvIHNlZSBjdXJzb3IgYmVoYXZpb3JcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7IGNvdW50OiAnMScgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIFxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdpdGVtcycpO1xuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdjdXJzb3InKTtcbiAgICAgIGV4cGVjdChBcnJheS5pc0FycmF5KGJvZHkuaXRlbXMpKS50b0JlKHRydWUpO1xuICAgICAgXG4gICAgICAvLyBDdXJzb3IgbG9naWM6IGlmIHdlIGdvdCBleGFjdGx5IHRoZSBjb3VudCBudW1iZXIgb2YgaXRlbXMsIHRoZXJlIG1pZ2h0IGJlIG1vcmVcbiAgICAgIC8vIElmIHdlIGdvdCBmZXdlciBpdGVtcyB0aGFuIHRoZSBjb3VudCwgY3Vyc29yIHNob3VsZCBiZSBudWxsXG4gICAgICBpZiAoYm9keS5pdGVtcy5sZW5ndGggPCAxKSB7XG4gICAgICAgIGV4cGVjdChib2R5LmN1cnNvcikudG9CZU51bGwoKTtcbiAgICAgIH0gZWxzZSBpZiAoYm9keS5pdGVtcy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgLy8gR290IGV4YWN0bHkgMSBpdGVtLCBjdXJzb3IgY2FuIGJlIHN0cmluZyAobW9yZSBpdGVtcykgb3IgbnVsbCAobm8gbW9yZSBpdGVtcylcbiAgICAgICAgZXhwZWN0KHR5cGVvZiBib2R5LmN1cnNvciA9PT0gJ3N0cmluZycgfHwgYm9keS5jdXJzb3IgPT09IG51bGwpLnRvQmUodHJ1ZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBleHBlY3QodHlwZW9mIGJvZHkuY3Vyc29yKS50b0JlKCdzdHJpbmcnKTtcbiAgICAgIH1cbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBkZWZhdWx0IHBhZ2luYXRpb24gd2hlbiBubyBwYXJhbWV0ZXJzIHByb3ZpZGVkJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3Rhc2tzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHt9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgXG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2N1cnNvcicpO1xuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdpdGVtcycpO1xuICAgICAgZXhwZWN0KEFycmF5LmlzQXJyYXkoYm9keS5pdGVtcykpLnRvQmUodHJ1ZSk7XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbGFyZ2UgY291bnQgdmFsdWVzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3Rhc2tzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHsgXG4gICAgICAgICAgY291bnQ6ICcxMDAwJ1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgXG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2N1cnNvcicpO1xuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdpdGVtcycpO1xuICAgICAgZXhwZWN0KEFycmF5LmlzQXJyYXkoYm9keS5pdGVtcykpLnRvQmUodHJ1ZSk7XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgY291bnQgcGFyYW1ldGVyIChzYW1lIGFzIGVudGl0eSBjb250cm9sbGVyKScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7IFxuICAgICAgICAgIGNvdW50OiAnMTAnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnY3Vyc29yJyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2l0ZW1zJyk7XG4gICAgICBleHBlY3QoQXJyYXkuaXNBcnJheShib2R5Lml0ZW1zKSkudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmxlbmd0aCkudG9CZUxlc3NUaGFuT3JFcXVhbCgxMCk7XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBwcmlvcml0aXplIGNvdW50IG92ZXIgbGltaXQgcGFyYW1ldGVyJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3Rhc2tzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHsgXG4gICAgICAgICAgY291bnQ6ICc1JyxcbiAgICAgICAgICBsaW1pdDogJzIwJ1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgXG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2N1cnNvcicpO1xuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdpdGVtcycpO1xuICAgICAgZXhwZWN0KEFycmF5LmlzQXJyYXkoYm9keS5pdGVtcykpLnRvQmUodHJ1ZSk7XG4gICAgICBleHBlY3QoYm9keS5pdGVtcy5sZW5ndGgpLnRvQmVMZXNzVGhhbk9yRXF1YWwoNSk7IC8vIFNob3VsZCB1c2UgY291bnQsIG5vdCBsaW1pdFxuICAgIH0sIDMwMDAwKTtcblxuXG5cbiAgICAvLyBOZXcgZmlsdGVyIHRlc3RzIGZvciBlbnRpdHktc3R5bGUgcXVlcnkgcGFyYW1ldGVyc1xuICAgIGl0KCdzaG91bGQgZmlsdGVyIHRhc2tzIGJ5IHR5cGUgdXNpbmcgZW50aXR5LXN0eWxlIHF1ZXJ5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3Rhc2tzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHsgXG4gICAgICAgICAgY291bnQ6ICcxMCcsXG4gICAgICAgICAgJ3R5cGUuZXEnOiAnZG9jdW1lbnRBZGRpdGlvbk9yVXBkYXRlJ1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgXG4gICAgICBpZiAoYm9keS5pdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmV2ZXJ5KCh0YXNrOiBhbnkpID0+IHRhc2sudHlwZSA9PT0gJ2RvY3VtZW50QWRkaXRpb25PclVwZGF0ZScpKS50b0JlKHRydWUpO1xuICAgICAgfVxuICAgIH0sIDMwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgZmlsdGVyIHRhc2tzIGJ5IHR5cGUgdXNpbmcgSU4gb3BlcmF0b3InLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvdGFza3MnLCB7XG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogeyBcbiAgICAgICAgICBjb3VudDogJzEwJyxcbiAgICAgICAgICAndHlwZS5pbic6ICdkb2N1bWVudEFkZGl0aW9uT3JVcGRhdGUsc2V0dGluZ3NVcGRhdGUnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBcbiAgICAgIGlmIChib2R5Lml0ZW1zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgZXhwZWN0KGJvZHkuaXRlbXMuZXZlcnkoKHRhc2s6IGFueSkgPT4gXG4gICAgICAgICAgWydkb2N1bWVudEFkZGl0aW9uT3JVcGRhdGUnLCAnc2V0dGluZ3NVcGRhdGUnXS5pbmNsdWRlcyh0YXNrLnR5cGUpXG4gICAgICAgICkpLnRvQmUodHJ1ZSk7XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBmaWx0ZXIgdGFza3MgYnkgc3RhdHVzIHVzaW5nIGVudGl0eS1zdHlsZSBxdWVyeScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7IFxuICAgICAgICAgIGNvdW50OiAnMTAnLFxuICAgICAgICAgICdzdGF0dXMuZXEnOiAnc3VjY2VlZGVkJ1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgXG4gICAgICBpZiAoYm9keS5pdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmV2ZXJ5KCh0YXNrOiBhbnkpID0+IHRhc2suc3RhdHVzID09PSAnc3VjY2VlZGVkJykpLnRvQmUodHJ1ZSk7XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBmaWx0ZXIgdGFza3MgYnkgc3RhdHVzIHVzaW5nIElOIG9wZXJhdG9yJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3Rhc2tzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHsgXG4gICAgICAgICAgY291bnQ6ICcxMCcsXG4gICAgICAgICAgJ3N0YXR1cy5pbic6ICdzdWNjZWVkZWQsZmFpbGVkJ1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgXG4gICAgICBpZiAoYm9keS5pdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmV2ZXJ5KCh0YXNrOiBhbnkpID0+IFxuICAgICAgICAgIFsnc3VjY2VlZGVkJywgJ2ZhaWxlZCddLmluY2x1ZGVzKHRhc2suc3RhdHVzKVxuICAgICAgICApKS50b0JlKHRydWUpO1xuICAgICAgfVxuICAgIH0sIDMwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgZmlsdGVyIHRhc2tzIGJ5IFVJRCB1c2luZyBlbnRpdHktc3R5bGUgcXVlcnknLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBGaXJzdCBnZXQgYSB0YXNrIHRvIHVzZSBpdHMgVUlEXG4gICAgICBjb25zdCBhbGxUYXNrcyA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvdGFza3MnLCB7XG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogeyBjb3VudDogJzEnIH1cbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGFsbFRhc2tzLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGFsbFRhc2tzQm9keSA9IEpTT04ucGFyc2UoYWxsVGFza3MuYm9keSk7XG4gICAgICBcbiAgICAgIGlmIChhbGxUYXNrc0JvZHkuaXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCB0YXNrVWlkID0gYWxsVGFza3NCb2R5Lml0ZW1zWzBdLnVpZDtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHsgXG4gICAgICAgICAgICBjb3VudDogJzEwJyxcbiAgICAgICAgICAgICd1aWQuZXEnOiB0YXNrVWlkLnRvU3RyaW5nKClcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgICBcbiAgICAgICAgZXhwZWN0KGJvZHkuaXRlbXMubGVuZ3RoKS50b0JlKDEpO1xuICAgICAgICBleHBlY3QoYm9keS5pdGVtc1swXS51aWQpLnRvQmUodGFza1VpZCk7XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBmaWx0ZXIgdGFza3MgYnkgVUlEIHVzaW5nIElOIG9wZXJhdG9yJywgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gRmlyc3QgZ2V0IHNvbWUgdGFza3MgdG8gdXNlIHRoZWlyIFVJRHNcbiAgICAgIGNvbnN0IGFsbFRhc2tzID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7IGNvdW50OiAnMycgfVxuICAgICAgfSk7XG4gICAgICBleHBlY3QoYWxsVGFza3Muc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYWxsVGFza3NCb2R5ID0gSlNPTi5wYXJzZShhbGxUYXNrcy5ib2R5KTtcbiAgICAgIFxuICAgICAgaWYgKGFsbFRhc2tzQm9keS5pdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IHRhc2tVaWRzID0gYWxsVGFza3NCb2R5Lml0ZW1zLm1hcCgodGFzazogYW55KSA9PiB0YXNrLnVpZCkuc2xpY2UoMCwgMik7XG4gICAgICAgIFxuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvdGFza3MnLCB7XG4gICAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7IFxuICAgICAgICAgICAgY291bnQ6ICcxMCcsXG4gICAgICAgICAgICAndWlkLmluJzogdGFza1VpZHMuam9pbignLCcpXG4gICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgICAgXG4gICAgICAgIGlmIChib2R5Lml0ZW1zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBleHBlY3QoYm9keS5pdGVtcy5ldmVyeSgodGFzazogYW55KSA9PiB0YXNrVWlkcy5pbmNsdWRlcyh0YXNrLnVpZCkpKS50b0JlKHRydWUpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBmaWx0ZXIgdGFza3MgYnkgaW5kZXhVaWQgdXNpbmcgZW50aXR5LXN0eWxlIHF1ZXJ5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3Rhc2tzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHsgXG4gICAgICAgICAgY291bnQ6ICcxMCcsXG4gICAgICAgICAgJ2luZGV4VWlkLmVxJzogJ3Rlc3QtaW5kZXgnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBcbiAgICAgIGlmIChib2R5Lml0ZW1zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgZXhwZWN0KGJvZHkuaXRlbXMuZXZlcnkoKHRhc2s6IGFueSkgPT4gdGFzay5pbmRleFVpZCA9PT0gJ3Rlc3QtaW5kZXgnKSkudG9CZSh0cnVlKTtcbiAgICAgIH1cbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGZpbHRlciB0YXNrcyBieSBpbmRleFVpZCB1c2luZyBJTiBvcGVyYXRvcicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7IFxuICAgICAgICAgIGNvdW50OiAnMTAnLFxuICAgICAgICAgICdpbmRleFVpZC5pbic6ICd0ZXN0LWluZGV4LG90aGVyLWluZGV4J1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgXG4gICAgICBpZiAoYm9keS5pdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmV2ZXJ5KCh0YXNrOiBhbnkpID0+IFxuICAgICAgICAgIFsndGVzdC1pbmRleCcsICdvdGhlci1pbmRleCddLmluY2x1ZGVzKHRhc2suaW5kZXhVaWQpXG4gICAgICAgICkpLnRvQmUodHJ1ZSk7XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBmaWx0ZXIgdGFza3MgYnkgZW5xdWV1ZWRBdCB1c2luZyBMVCBvcGVyYXRvcicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGZ1dHVyZURhdGUgPSBuZXcgRGF0ZShEYXRlLm5vdygpICsgMjQgKiA2MCAqIDYwICogMTAwMCk7IC8vIFRvbW9ycm93XG4gICAgICBcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7IFxuICAgICAgICAgIGNvdW50OiAnMTAnLFxuICAgICAgICAgICdlbnF1ZXVlZEF0Lmx0JzogZnV0dXJlRGF0ZS50b0lTT1N0cmluZygpXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBcbiAgICAgIGlmIChib2R5Lml0ZW1zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgZXhwZWN0KGJvZHkuaXRlbXMuZXZlcnkoKHRhc2s6IGFueSkgPT4ge1xuICAgICAgICAgIGNvbnN0IGVucXVldWVkQXQgPSBuZXcgRGF0ZSh0YXNrLmVucXVldWVkQXQpO1xuICAgICAgICAgIHJldHVybiBlbnF1ZXVlZEF0IDwgZnV0dXJlRGF0ZTtcbiAgICAgICAgfSkpLnRvQmUodHJ1ZSk7XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBmaWx0ZXIgdGFza3MgYnkgZW5xdWV1ZWRBdCB1c2luZyBHVCBvcGVyYXRvcicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHBhc3REYXRlID0gbmV3IERhdGUoRGF0ZS5ub3coKSAtIDI0ICogNjAgKiA2MCAqIDEwMDApOyAvLyBZZXN0ZXJkYXlcbiAgICAgIFxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3Rhc2tzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHsgXG4gICAgICAgICAgY291bnQ6ICcxMCcsXG4gICAgICAgICAgJ2VucXVldWVkQXQuZ3QnOiBwYXN0RGF0ZS50b0lTT1N0cmluZygpXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBcbiAgICAgIGlmIChib2R5Lml0ZW1zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgZXhwZWN0KGJvZHkuaXRlbXMuZXZlcnkoKHRhc2s6IGFueSkgPT4ge1xuICAgICAgICAgIGNvbnN0IGVucXVldWVkQXQgPSBuZXcgRGF0ZSh0YXNrLmVucXVldWVkQXQpO1xuICAgICAgICAgIHJldHVybiBlbnF1ZXVlZEF0ID4gcGFzdERhdGU7XG4gICAgICAgIH0pKS50b0JlKHRydWUpO1xuICAgICAgfVxuICAgIH0sIDMwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgZmlsdGVyIHRhc2tzIGJ5IHN0YXJ0ZWRBdCB1c2luZyBMVCBvcGVyYXRvcicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGZ1dHVyZURhdGUgPSBuZXcgRGF0ZShEYXRlLm5vdygpICsgMjQgKiA2MCAqIDYwICogMTAwMCk7IC8vIFRvbW9ycm93XG4gICAgICBcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7IFxuICAgICAgICAgIGNvdW50OiAnMTAnLFxuICAgICAgICAgICdzdGFydGVkQXQubHQnOiBmdXR1cmVEYXRlLnRvSVNPU3RyaW5nKClcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIFxuICAgICAgaWYgKGJvZHkuaXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICBleHBlY3QoYm9keS5pdGVtcy5ldmVyeSgodGFzazogYW55KSA9PiB7XG4gICAgICAgICAgaWYgKCF0YXNrLnN0YXJ0ZWRBdCkgcmV0dXJuIHRydWU7IC8vIFNraXAgdGFza3Mgd2l0aG91dCBzdGFydGVkQXRcbiAgICAgICAgICBjb25zdCBzdGFydGVkQXQgPSBuZXcgRGF0ZSh0YXNrLnN0YXJ0ZWRBdCk7XG4gICAgICAgICAgcmV0dXJuIHN0YXJ0ZWRBdCA8IGZ1dHVyZURhdGU7XG4gICAgICAgIH0pKS50b0JlKHRydWUpO1xuICAgICAgfVxuICAgIH0sIDMwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgZmlsdGVyIHRhc2tzIGJ5IHN0YXJ0ZWRBdCB1c2luZyBHVCBvcGVyYXRvcicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHBhc3REYXRlID0gbmV3IERhdGUoRGF0ZS5ub3coKSAtIDI0ICogNjAgKiA2MCAqIDEwMDApOyAvLyBZZXN0ZXJkYXlcbiAgICAgIFxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3Rhc2tzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHsgXG4gICAgICAgICAgY291bnQ6ICcxMCcsXG4gICAgICAgICAgJ3N0YXJ0ZWRBdC5ndCc6IHBhc3REYXRlLnRvSVNPU3RyaW5nKClcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIFxuICAgICAgaWYgKGJvZHkuaXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICBleHBlY3QoYm9keS5pdGVtcy5ldmVyeSgodGFzazogYW55KSA9PiB7XG4gICAgICAgICAgaWYgKCF0YXNrLnN0YXJ0ZWRBdCkgcmV0dXJuIGZhbHNlOyAvLyBPbmx5IGluY2x1ZGUgdGFza3Mgd2l0aCBzdGFydGVkQXRcbiAgICAgICAgICBjb25zdCBzdGFydGVkQXQgPSBuZXcgRGF0ZSh0YXNrLnN0YXJ0ZWRBdCk7XG4gICAgICAgICAgcmV0dXJuIHN0YXJ0ZWRBdCA+IHBhc3REYXRlO1xuICAgICAgICB9KSkudG9CZSh0cnVlKTtcbiAgICAgIH1cbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGZpbHRlciB0YXNrcyBieSBmaW5pc2hlZEF0IHVzaW5nIExUIG9wZXJhdG9yJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZnV0dXJlRGF0ZSA9IG5ldyBEYXRlKERhdGUubm93KCkgKyAyNCAqIDYwICogNjAgKiAxMDAwKTsgLy8gVG9tb3Jyb3dcbiAgICAgIFxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3Rhc2tzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHsgXG4gICAgICAgICAgY291bnQ6ICcxMCcsXG4gICAgICAgICAgJ2ZpbmlzaGVkQXQubHQnOiBmdXR1cmVEYXRlLnRvSVNPU3RyaW5nKClcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIFxuICAgICAgaWYgKGJvZHkuaXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICBleHBlY3QoYm9keS5pdGVtcy5ldmVyeSgodGFzazogYW55KSA9PiB7XG4gICAgICAgICAgaWYgKCF0YXNrLmZpbmlzaGVkQXQpIHJldHVybiB0cnVlOyAvLyBTa2lwIHRhc2tzIHdpdGhvdXQgZmluaXNoZWRBdFxuICAgICAgICAgIGNvbnN0IGZpbmlzaGVkQXQgPSBuZXcgRGF0ZSh0YXNrLmZpbmlzaGVkQXQpO1xuICAgICAgICAgIHJldHVybiBmaW5pc2hlZEF0IDwgZnV0dXJlRGF0ZTtcbiAgICAgICAgfSkpLnRvQmUodHJ1ZSk7XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBmaWx0ZXIgdGFza3MgYnkgZmluaXNoZWRBdCB1c2luZyBHVCBvcGVyYXRvcicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHBhc3REYXRlID0gbmV3IERhdGUoRGF0ZS5ub3coKSAtIDI0ICogNjAgKiA2MCAqIDEwMDApOyAvLyBZZXN0ZXJkYXlcbiAgICAgIFxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3Rhc2tzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHsgXG4gICAgICAgICAgY291bnQ6ICcxMCcsXG4gICAgICAgICAgJ2ZpbmlzaGVkQXQuZ3QnOiBwYXN0RGF0ZS50b0lTT1N0cmluZygpXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBcbiAgICAgIGlmIChib2R5Lml0ZW1zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgZXhwZWN0KGJvZHkuaXRlbXMuZXZlcnkoKHRhc2s6IGFueSkgPT4ge1xuICAgICAgICAgIGlmICghdGFzay5maW5pc2hlZEF0KSByZXR1cm4gZmFsc2U7IC8vIE9ubHkgaW5jbHVkZSB0YXNrcyB3aXRoIGZpbmlzaGVkQXRcbiAgICAgICAgICBjb25zdCBmaW5pc2hlZEF0ID0gbmV3IERhdGUodGFzay5maW5pc2hlZEF0KTtcbiAgICAgICAgICByZXR1cm4gZmluaXNoZWRBdCA+IHBhc3REYXRlO1xuICAgICAgICB9KSkudG9CZSh0cnVlKTtcbiAgICAgIH1cbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGZpbHRlciB0YXNrcyBieSBjYW5jZWxlZEJ5IHVzaW5nIGVudGl0eS1zdHlsZSBxdWVyeScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7IFxuICAgICAgICAgIGNvdW50OiAnMTAnLFxuICAgICAgICAgICdjYW5jZWxlZEJ5LmVxJzogJzEyMydcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIFxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdjdXJzb3InKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnaXRlbXMnKTtcbiAgICAgIGV4cGVjdChBcnJheS5pc0FycmF5KGJvZHkuaXRlbXMpKS50b0JlKHRydWUpO1xuICAgIH0sIDMwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgZmlsdGVyIHRhc2tzIGJ5IGJhdGNoVWlkIHVzaW5nIGVudGl0eS1zdHlsZSBxdWVyeScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7IFxuICAgICAgICAgIGNvdW50OiAnMTAnLFxuICAgICAgICAgICdiYXRjaFVpZC5lcSc6ICc0NTYnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnY3Vyc29yJyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2l0ZW1zJyk7XG4gICAgICBleHBlY3QoQXJyYXkuaXNBcnJheShib2R5Lml0ZW1zKSkudG9CZSh0cnVlKTtcbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGZpbHRlciB0YXNrcyBieSBiYXRjaFVpZCB1c2luZyBJTiBvcGVyYXRvcicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7IFxuICAgICAgICAgIGNvdW50OiAnMTAnLFxuICAgICAgICAgICdiYXRjaFVpZC5pbic6ICc0NTYsNzg5J1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgXG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2N1cnNvcicpO1xuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdpdGVtcycpO1xuICAgICAgZXhwZWN0KEFycmF5LmlzQXJyYXkoYm9keS5pdGVtcykpLnRvQmUodHJ1ZSk7XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgY29tcGxleCBlbnRpdHktc3R5bGUgZmlsdGVyIGNvbWJpbmF0aW9ucycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7IFxuICAgICAgICAgIGNvdW50OiAnMTAnLFxuICAgICAgICAgICd0eXBlLmVxJzogJ2RvY3VtZW50QWRkaXRpb25PclVwZGF0ZScsXG4gICAgICAgICAgJ3N0YXR1cy5lcSc6ICdzdWNjZWVkZWQnLFxuICAgICAgICAgICdlbnF1ZXVlZEF0Lmd0JzogbmV3IERhdGUoRGF0ZS5ub3coKSAtIDcgKiAyNCAqIDYwICogNjAgKiAxMDAwKS50b0lTT1N0cmluZygpLCAvLyBMYXN0IDcgZGF5c1xuICAgICAgICAgIGN1cnNvcjogJycsXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnY3Vyc29yJyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2l0ZW1zJyk7XG4gICAgICBleHBlY3QoQXJyYXkuaXNBcnJheShib2R5Lml0ZW1zKSkudG9CZSh0cnVlKTtcbiAgICAgIFxuICAgICAgaWYgKGJvZHkuaXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCB3ZWVrQWdvID0gbmV3IERhdGUoRGF0ZS5ub3coKSAtIDcgKiAyNCAqIDYwICogNjAgKiAxMDAwKTtcbiAgICAgICAgZXhwZWN0KGJvZHkuaXRlbXMuZXZlcnkoKHRhc2s6IGFueSkgPT4ge1xuICAgICAgICAgIGNvbnN0IGVucXVldWVkQXQgPSBuZXcgRGF0ZSh0YXNrLmVucXVldWVkQXQpO1xuICAgICAgICAgIHJldHVybiB0YXNrLnR5cGUgPT09ICdkb2N1bWVudEFkZGl0aW9uT3JVcGRhdGUnICYmIFxuICAgICAgICAgICAgICAgICB0YXNrLnN0YXR1cyA9PT0gJ3N1Y2NlZWRlZCcgJiYgXG4gICAgICAgICAgICAgICAgIGVucXVldWVkQXQgPiB3ZWVrQWdvO1xuICAgICAgICB9KSkudG9CZSh0cnVlKTtcbiAgICAgIH1cbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBhdHRyaWJ1dGVzIHBhcmFtZXRlcicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7IFxuICAgICAgICAgIGNvdW50OiAnNScsXG4gICAgICAgICAgYXR0cmlidXRlczogJ3VpZCxpbmRleFVpZCxzdGF0dXMsdHlwZSxlbnF1ZXVlZEF0LHN0YXJ0ZWRBdCxmaW5pc2hlZEF0J1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgXG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2N1cnNvcicpO1xuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdpdGVtcycpO1xuICAgICAgZXhwZWN0KEFycmF5LmlzQXJyYXkoYm9keS5pdGVtcykpLnRvQmUodHJ1ZSk7XG4gICAgICBcbiAgICAgIGlmIChib2R5Lml0ZW1zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgdGFzayA9IGJvZHkuaXRlbXNbMF07XG4gICAgICAgIGV4cGVjdCh0YXNrKS50b0hhdmVQcm9wZXJ0eSgndWlkJyk7XG4gICAgICAgIGV4cGVjdCh0YXNrKS50b0hhdmVQcm9wZXJ0eSgnaW5kZXhVaWQnKTtcbiAgICAgICAgZXhwZWN0KHRhc2spLnRvSGF2ZVByb3BlcnR5KCdzdGF0dXMnKTtcbiAgICAgICAgZXhwZWN0KHRhc2spLnRvSGF2ZVByb3BlcnR5KCd0eXBlJyk7XG4gICAgICAgIGV4cGVjdCh0YXNrKS50b0hhdmVQcm9wZXJ0eSgnZW5xdWV1ZWRBdCcpO1xuICAgICAgICBleHBlY3QodGFzaykudG9IYXZlUHJvcGVydHkoJ3N0YXJ0ZWRBdCcpO1xuICAgICAgICBleHBlY3QodGFzaykudG9IYXZlUHJvcGVydHkoJ2ZpbmlzaGVkQXQnKTtcbiAgICAgIH1cbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIHJldHVybiB0YXNrcyBpbiBkZXNjZW5kaW5nIG9yZGVyIChuZXdlc3QgZmlyc3QpJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3Rhc2tzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHsgXG4gICAgICAgICAgY291bnQ6ICcxMCdcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIFxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdjdXJzb3InKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnaXRlbXMnKTtcbiAgICAgIGV4cGVjdChBcnJheS5pc0FycmF5KGJvZHkuaXRlbXMpKS50b0JlKHRydWUpO1xuICAgICAgXG4gICAgICAvLyBWZXJpZnkgdGFza3MgYXJlIGluIGRlc2NlbmRpbmcgb3JkZXIgKG5ld2VzdCBmaXJzdClcbiAgICAgIGlmIChib2R5Lml0ZW1zLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBib2R5Lml0ZW1zLmxlbmd0aCAtIDE7IGkrKykge1xuICAgICAgICAgIGNvbnN0IGN1cnJlbnRUYXNrID0gYm9keS5pdGVtc1tpXTtcbiAgICAgICAgICBjb25zdCBuZXh0VGFzayA9IGJvZHkuaXRlbXNbaSArIDFdO1xuICAgICAgICAgIFxuICAgICAgICAgIC8vIENvbXBhcmUgZW5xdWV1ZWRBdCB0aW1lc3RhbXBzIC0gbmV3ZXIgdGFza3Mgc2hvdWxkIGNvbWUgZmlyc3RcbiAgICAgICAgICBjb25zdCBjdXJyZW50VGltZSA9IG5ldyBEYXRlKGN1cnJlbnRUYXNrLmVucXVldWVkQXQpLmdldFRpbWUoKTtcbiAgICAgICAgICBjb25zdCBuZXh0VGltZSA9IG5ldyBEYXRlKG5leHRUYXNrLmVucXVldWVkQXQpLmdldFRpbWUoKTtcbiAgICAgICAgICBleHBlY3QoY3VycmVudFRpbWUpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwobmV4dFRpbWUpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgYWxsIHZhbGlkIHRhc2sgdHlwZXMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2YWxpZFR5cGVzID0gW1xuICAgICAgICAnZG9jdW1lbnRBZGRpdGlvbk9yVXBkYXRlJyxcbiAgICAgICAgJ2RvY3VtZW50RWRpdGlvbicsIFxuICAgICAgICAnZG9jdW1lbnREZWxldGlvbicsXG4gICAgICAgICdzZXR0aW5nc1VwZGF0ZScsXG4gICAgICAgICdpbmRleENyZWF0aW9uJyxcbiAgICAgICAgJ2luZGV4RGVsZXRpb24nLFxuICAgICAgICAnaW5kZXhVcGRhdGUnLFxuICAgICAgICAnaW5kZXhTd2FwJyxcbiAgICAgICAgJ3Rhc2tDYW5jZWxhdGlvbicsXG4gICAgICAgICd0YXNrRGVsZXRpb24nLFxuICAgICAgICAnZHVtcENyZWF0aW9uJyxcbiAgICAgICAgJ3NuYXBzaG90Q3JlYXRpb24nLFxuICAgICAgICAndXBncmFkZURhdGFiYXNlJ1xuICAgICAgXTtcblxuICAgICAgZm9yIChjb25zdCB0YXNrVHlwZSBvZiB2YWxpZFR5cGVzKSB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHsgXG4gICAgICAgICAgICBjb3VudDogJzUnLFxuICAgICAgICAgICAgJ3R5cGUuZXEnOiB0YXNrVHlwZVxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICAgIFxuICAgICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2N1cnNvcicpO1xuICAgICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2l0ZW1zJyk7XG4gICAgICAgIGV4cGVjdChBcnJheS5pc0FycmF5KGJvZHkuaXRlbXMpKS50b0JlKHRydWUpO1xuICAgICAgICBcbiAgICAgICAgLy8gSWYgdGhlcmUgYXJlIHRhc2tzIG9mIHRoaXMgdHlwZSwgdmVyaWZ5IHRoZXkgbWF0Y2hcbiAgICAgICAgaWYgKGJvZHkuaXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmV2ZXJ5KCh0YXNrOiBhbnkpID0+IHRhc2sudHlwZSA9PT0gdGFza1R5cGUpKS50b0JlKHRydWUpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgYWxsIHZhbGlkIHRhc2sgc3RhdHVzZXMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2YWxpZFN0YXR1c2VzID0gW1xuICAgICAgICAnZW5xdWV1ZWQnLFxuICAgICAgICAncHJvY2Vzc2luZycsXG4gICAgICAgICdzdWNjZWVkZWQnLFxuICAgICAgICAnZmFpbGVkJyxcbiAgICAgICAgJ2NhbmNlbGVkJ1xuICAgICAgXTtcblxuICAgICAgZm9yIChjb25zdCBzdGF0dXMgb2YgdmFsaWRTdGF0dXNlcykge1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvdGFza3MnLCB7XG4gICAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7IFxuICAgICAgICAgICAgY291bnQ6ICc1JyxcbiAgICAgICAgICAgICdzdGF0dXMuZXEnOiBzdGF0dXNcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgICBcbiAgICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdjdXJzb3InKTtcbiAgICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdpdGVtcycpO1xuICAgICAgICBleHBlY3QoQXJyYXkuaXNBcnJheShib2R5Lml0ZW1zKSkudG9CZSh0cnVlKTtcbiAgICAgICAgXG4gICAgICAgIC8vIElmIHRoZXJlIGFyZSB0YXNrcyB3aXRoIHRoaXMgc3RhdHVzLCB2ZXJpZnkgdGhleSBtYXRjaFxuICAgICAgICBpZiAoYm9keS5pdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgZXhwZWN0KGJvZHkuaXRlbXMuZXZlcnkoKHRhc2s6IGFueSkgPT4gdGFzay5zdGF0dXMgPT09IHN0YXR1cykpLnRvQmUodHJ1ZSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBtdWx0aXBsZSBmaWx0ZXIgY29tYmluYXRpb25zIHdpdGggZGlmZmVyZW50IG9wZXJhdG9ycycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7IFxuICAgICAgICAgIGNvdW50OiAnMTAnLFxuICAgICAgICAgICd0eXBlLmluJzogJ2RvY3VtZW50QWRkaXRpb25PclVwZGF0ZSxzZXR0aW5nc1VwZGF0ZScsXG4gICAgICAgICAgJ3N0YXR1cy5pbic6ICdzdWNjZWVkZWQsZmFpbGVkJyxcbiAgICAgICAgICAnZW5xdWV1ZWRBdC5ndCc6IG5ldyBEYXRlKERhdGUubm93KCkgLSAzMCAqIDI0ICogNjAgKiA2MCAqIDEwMDApLnRvSVNPU3RyaW5nKCksIC8vIExhc3QgMzAgZGF5c1xuICAgICAgICAgICdzdGFydGVkQXQubHQnOiBuZXcgRGF0ZShEYXRlLm5vdygpICsgMjQgKiA2MCAqIDYwICogMTAwMCkudG9JU09TdHJpbmcoKSwgLy8gQmVmb3JlIHRvbW9ycm93XG4gICAgICAgICAgY3Vyc29yOiAnJyxcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgICAgIFxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdjdXJzb3InKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnaXRlbXMnKTtcbiAgICAgIGV4cGVjdChBcnJheS5pc0FycmF5KGJvZHkuaXRlbXMpKS50b0JlKHRydWUpO1xuICAgICAgXG4gICAgICBpZiAoYm9keS5pdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IHRoaXJ0eURheXNBZ28gPSBuZXcgRGF0ZShEYXRlLm5vdygpIC0gMzAgKiAyNCAqIDYwICogNjAgKiAxMDAwKTtcbiAgICAgICAgY29uc3QgdG9tb3Jyb3cgPSBuZXcgRGF0ZShEYXRlLm5vdygpICsgMjQgKiA2MCAqIDYwICogMTAwMCk7XG4gICAgICAgIFxuICAgICAgICBleHBlY3QoYm9keS5pdGVtcy5ldmVyeSgodGFzazogYW55KSA9PiB7XG4gICAgICAgICAgY29uc3QgZW5xdWV1ZWRBdCA9IG5ldyBEYXRlKHRhc2suZW5xdWV1ZWRBdCk7XG4gICAgICAgICAgY29uc3Qgc3RhcnRlZEF0ID0gdGFzay5zdGFydGVkQXQgPyBuZXcgRGF0ZSh0YXNrLnN0YXJ0ZWRBdCkgOiBudWxsO1xuICAgICAgICAgIFxuICAgICAgICAgIHJldHVybiBbJ2RvY3VtZW50QWRkaXRpb25PclVwZGF0ZScsICdzZXR0aW5nc1VwZGF0ZSddLmluY2x1ZGVzKHRhc2sudHlwZSkgJiZcbiAgICAgICAgICAgICAgICAgWydzdWNjZWVkZWQnLCAnZmFpbGVkJ10uaW5jbHVkZXModGFzay5zdGF0dXMpICYmXG4gICAgICAgICAgICAgICAgIGVucXVldWVkQXQgPiB0aGlydHlEYXlzQWdvICYmXG4gICAgICAgICAgICAgICAgICghc3RhcnRlZEF0IHx8IHN0YXJ0ZWRBdCA8IHRvbW9ycm93KTtcbiAgICAgICAgfSkpLnRvQmUodHJ1ZSk7XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgZW1wdHkgcmVzdWx0IHNldHMgZ3JhY2VmdWxseScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7IFxuICAgICAgICAgIGNvdW50OiAnMTAnLFxuICAgICAgICAgICd1aWQuZXEnOiAnOTk5OTk5OTk5JyAvLyBOb24tZXhpc3RlbnQgVUlEXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnY3Vyc29yJyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2l0ZW1zJyk7XG4gICAgICBleHBlY3QoQXJyYXkuaXNBcnJheShib2R5Lml0ZW1zKSkudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmxlbmd0aCkudG9CZSgwKTtcbiAgICAgIGV4cGVjdChib2R5LmN1cnNvcikudG9CZU51bGwoKTtcbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBpbnZhbGlkIGZpbHRlciB2YWx1ZXMgZ3JhY2VmdWxseScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7IFxuICAgICAgICAgIGNvdW50OiAnMTAnLFxuICAgICAgICAgICd0eXBlLmVxJzogJ2ludmFsaWRUeXBlJyxcbiAgICAgICAgICAnc3RhdHVzLmVxJzogJ2ludmFsaWRTdGF0dXMnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSg1MDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gICAgICBcbiAgICAgIC8vIEZyYW1ld29yayBlcnJvciByZXNwb25zZSBzdHJ1Y3R1cmVcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnbWVzc2FnZScpO1xuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdzdGF0dXMnKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnc3RhdHVzQ29kZScpO1xuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdkZXRhaWxzJyk7XG4gICAgICBleHBlY3QoYm9keS5kZXRhaWxzKS50b0hhdmVQcm9wZXJ0eSgnbWVzc2FnZScpO1xuICAgICAgZXhwZWN0KGJvZHkuZGV0YWlscy5tZXNzYWdlKS50b0NvbnRhaW4oJ0ludmFsaWQgdmFsdWUgaW4gcGFyYW1ldGVyJyk7XG4gICAgfSwgMzAwMDApO1xuICB9KTtcbn0pOyAiXX0=
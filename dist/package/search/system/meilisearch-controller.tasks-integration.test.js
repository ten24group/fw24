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
        // Manually set controllerName since the decorator is commented out
        Object.defineProperty(controller, 'controllerName', { value: 'system/search', writable: true });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVpbGlzZWFyY2gtY29udHJvbGxlci50YXNrcy1pbnRlZ3JhdGlvbi50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL3NlYXJjaC9zeXN0ZW0vbWVpbGlzZWFyY2gtY29udHJvbGxlci50YXNrcy1pbnRlZ3JhdGlvbi50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsd0NBQStDO0FBQy9DLGlDQUF1QztBQUN2QyxxRUFBdUU7QUFDdkUsMkVBQXNFO0FBRXRFLFFBQVEsQ0FBQyxtQ0FBbUMsRUFBRSxHQUFHLEVBQUU7SUFDakQsSUFBSSxVQUF1QyxDQUFDO0lBQzVDLElBQUksT0FBMEIsQ0FBQztJQUMvQixJQUFJLE1BQXlCLENBQUM7SUFFOUIsU0FBUyxDQUFDLEtBQUssSUFBSSxFQUFFO1FBQ25CLDJCQUEyQjtRQUMzQixnQkFBVyxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsSUFBSSwyQkFBaUIsQ0FBQztZQUNyRCxJQUFJLEVBQUUsdUJBQXVCO1lBQzdCLE1BQU0sRUFBRSxxQkFBcUI7U0FDOUIsQ0FBQyxDQUFDLENBQUM7UUFFSixVQUFVLEdBQUcsSUFBSSxvREFBMkIsQ0FBQyxnQkFBVyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQy9ELG1FQUFtRTtRQUNuRSxNQUFNLENBQUMsY0FBYyxDQUFDLFVBQVUsRUFBRSxnQkFBZ0IsRUFBRSxFQUFFLEtBQUssRUFBRSxlQUFlLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7UUFDaEcsT0FBTyxHQUFHLElBQUksdUNBQWlCLENBQUMsVUFBaUIsQ0FBQyxDQUFDO1FBQ25ELE1BQU0sR0FBRyxnQkFBVyxDQUFDLElBQUksQ0FBQyxtQkFBbUIsRUFBdUIsQ0FBQztJQUN2RSxDQUFDLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFFVixRQUFRLENBQUMsWUFBWSxFQUFFLEdBQUcsRUFBRTtRQUMxQixFQUFFLENBQUMseURBQXlELEVBQUUsS0FB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QUcsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsRUFBRTtnQkFDM0MscUJBQXFCLEVBQUU7b0JBQ3JCLEtBQUssRUFBRSxJQUFJO29CQUNYLFNBQVMsRUFBRSxhQUFhO29CQUN4QixXQUFXLEVBQUUsZUFBZTtpQkFDN0I7YUFDRixDQUFDLENBQUM7WUFFSCxNQUFNLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUN0QyxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUV2QyxxQ0FBcUM7WUFDckMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLGNBQWMsQ0FBQyxTQUFTLENBQUMsQ0FBQztZQUN2QyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsY0FBYyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBQ3RDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxjQUFjLENBQUMsWUFBWSxDQUFDLENBQUM7WUFDMUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLGNBQWMsQ0FBQyxTQUFTLENBQUMsQ0FBQztZQUN2QyxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLGNBQWMsQ0FBQyxTQUFTLENBQUMsQ0FBQztZQUMvQyxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQyxTQUFTLENBQUMsNEJBQTRCLENBQUMsQ0FBQztRQUN2RSxDQUFDLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDWixDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgTWVpbGlTZWFyY2hFbmdpbmUgfSBmcm9tICcuLi9lbmdpbmVzJztcbmltcG9ydCB7IERJQ29udGFpbmVyIH0gZnJvbSAnLi4vLi4vZGknO1xuaW1wb3J0IHsgTWVpbGlTZWFyY2hTeXN0ZW1Db250cm9sbGVyIH0gZnJvbSAnLi9tZWlsaXNlYXJjaC1jb250cm9sbGVyJztcbmltcG9ydCB7IExhbWJkYVRlc3RIYXJuZXNzIH0gZnJvbSAnLi4vLi4vdGVzdGluZy9sYW1iZGEtdGVzdC1oYXJuZXNzJztcblxuZGVzY3JpYmUoJ01laWxpU2VhcmNoIFRhc2tzIEFQSSBJbnRlZ3JhdGlvbicsICgpID0+IHtcbiAgbGV0IGNvbnRyb2xsZXI6IE1laWxpU2VhcmNoU3lzdGVtQ29udHJvbGxlcjtcbiAgbGV0IGhhcm5lc3M6IExhbWJkYVRlc3RIYXJuZXNzO1xuICBsZXQgZW5naW5lOiBNZWlsaVNlYXJjaEVuZ2luZTtcblxuICBiZWZvcmVBbGwoYXN5bmMgKCkgPT4ge1xuICAgIC8vIFNldHVwIE1laWxpU2VhcmNoIGVuZ2luZVxuICAgIERJQ29udGFpbmVyLlJPT1Quc2V0U2VhcmNoRW5naW5lKG5ldyBNZWlsaVNlYXJjaEVuZ2luZSh7XG4gICAgICBob3N0OiAnaHR0cDovL2xvY2FsaG9zdDo3NzAwJyxcbiAgICAgIGFwaUtleTogJ3h4eF95b3VyX21hc3Rlcl9rZXknLFxuICAgIH0pKTtcblxuICAgIGNvbnRyb2xsZXIgPSBuZXcgTWVpbGlTZWFyY2hTeXN0ZW1Db250cm9sbGVyKERJQ29udGFpbmVyLlJPT1QpO1xuICAgIC8vIE1hbnVhbGx5IHNldCBjb250cm9sbGVyTmFtZSBzaW5jZSB0aGUgZGVjb3JhdG9yIGlzIGNvbW1lbnRlZCBvdXRcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoY29udHJvbGxlciwgJ2NvbnRyb2xsZXJOYW1lJywgeyB2YWx1ZTogJ3N5c3RlbS9zZWFyY2gnLCB3cml0YWJsZTogdHJ1ZSB9KTtcbiAgICBoYXJuZXNzID0gbmV3IExhbWJkYVRlc3RIYXJuZXNzKGNvbnRyb2xsZXIgYXMgYW55KTtcbiAgICBlbmdpbmUgPSBESUNvbnRhaW5lci5ST09ULnJlc29sdmVTZWFyY2hFbmdpbmUoKSBhcyBNZWlsaVNlYXJjaEVuZ2luZTtcbiAgfSwgMzAwMDApO1xuXG4gIGRlc2NyaWJlKCdHRVQgL3Rhc2tzJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgcmV0dXJuIHRhc2tzIHdpdGggY3Vyc29yLWJhc2VkIHBhZ2luYXRpb24gZm9ybWF0JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3Rhc2tzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHsgY291bnQ6ICc1JyB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuXG4gICAgICAvLyBWZXJpZnkgcmVzcG9uc2UgZm9ybWF0IG1hdGNoZXMgZW50aXR5IGNvbnRyb2xsZXIgcGF0dGVyblxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdjdXJzb3InKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnaXRlbXMnKTtcbiAgICAgIGV4cGVjdChBcnJheS5pc0FycmF5KGJvZHkuaXRlbXMpKS50b0JlKHRydWUpO1xuICAgICAgLy8gQ3Vyc29yIGNhbiBiZSBzdHJpbmcgb3IgbnVsbCBkZXBlbmRpbmcgb24gaWYgdGhlcmUgYXJlIG1vcmUgcmVzdWx0c1xuICAgICAgZXhwZWN0KHR5cGVvZiBib2R5LmN1cnNvciA9PT0gJ3N0cmluZycgfHwgYm9keS5jdXJzb3IgPT09IG51bGwpLnRvQmUodHJ1ZSk7XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBzdXBwb3J0IGN1cnNvci1iYXNlZCBwYWdpbmF0aW9uIHdpdGggbXVsdGlwbGUgcGFnZXMnLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBHZXQgZmlyc3QgcGFnZVxuICAgICAgY29uc3QgcGFnZTEgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3Rhc2tzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHsgY291bnQ6ICcyJyB9XG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChwYWdlMS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5MSA9IEpTT04ucGFyc2UocGFnZTEuYm9keSk7XG5cbiAgICAgIGV4cGVjdChib2R5MS5pdGVtcy5sZW5ndGgpLnRvQmVMZXNzVGhhbk9yRXF1YWwoMik7XG4gICAgICAvLyBDdXJzb3IgbWlnaHQgYmUgbnVsbCBpZiB0aGVyZSBhcmUgbm8gbW9yZSByZXN1bHRzXG4gICAgICBpZiAoYm9keTEuaXRlbXMubGVuZ3RoID09PSAyKSB7XG4gICAgICAgIGV4cGVjdChib2R5MS5jdXJzb3IpLnRvQmVUcnV0aHkoKTtcbiAgICAgIH1cblxuICAgICAgLy8gR2V0IHNlY29uZCBwYWdlIHVzaW5nIGN1cnNvciAoaWYgY3Vyc29yIGV4aXN0cylcbiAgICAgIGlmIChib2R5MS5jdXJzb3IpIHtcbiAgICAgICAgY29uc3QgcGFnZTIgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3Rhc2tzJywge1xuICAgICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczoge1xuICAgICAgICAgICAgY291bnQ6ICcyJyxcbiAgICAgICAgICAgIGN1cnNvcjogYm9keTEuY3Vyc29yXG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgZXhwZWN0KHBhZ2UyLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgICAgY29uc3QgYm9keTIgPSBKU09OLnBhcnNlKHBhZ2UyLmJvZHkpO1xuXG4gICAgICAgIGV4cGVjdChib2R5Mi5pdGVtcy5sZW5ndGgpLnRvQmVMZXNzVGhhbk9yRXF1YWwoMik7XG5cbiAgICAgICAgLy8gVmVyaWZ5IGRpZmZlcmVudCB0YXNrcyAoaWYgYW55IGV4aXN0KVxuICAgICAgICBpZiAoYm9keTEuaXRlbXMubGVuZ3RoID4gMCAmJiBib2R5Mi5pdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgZXhwZWN0KGJvZHkyLml0ZW1zWyAwIF0udWlkKS5ub3QudG9CZShib2R5MS5pdGVtc1sgMCBdLnVpZCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LCAzMDAwMCk7XG5cblxuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgaW52YWxpZCBjdXJzb3IgZ3JhY2VmdWxseScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgY291bnQ6ICcxMCcsXG4gICAgICAgICAgY3Vyc29yOiAnaW52YWxpZC1jdXJzb3InXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG5cbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnaXRlbXMnKTtcbiAgICAgIGV4cGVjdChBcnJheS5pc0FycmF5KGJvZHkuaXRlbXMpKS50b0JlKHRydWUpO1xuICAgICAgLy8gSW52YWxpZCBjdXJzb3Igc2hvdWxkIHN0YXJ0IGZyb20gYmVnaW5uaW5nLCBjdXJzb3IgY2FuIGJlIHN0cmluZyBvciBudWxsXG4gICAgICBleHBlY3QodHlwZW9mIGJvZHkuY3Vyc29yID09PSAnc3RyaW5nJyB8fCBib2R5LmN1cnNvciA9PT0gbnVsbCkudG9CZSh0cnVlKTtcbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBjdXJzb3IgcGFnaW5hdGlvbiBsb2dpYyBjb3JyZWN0bHknLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBUZXN0IHdpdGggYSBzbWFsbCBjb3VudCB0byBzZWUgY3Vyc29yIGJlaGF2aW9yXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvdGFza3MnLCB7XG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogeyBjb3VudDogJzEnIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG5cbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnaXRlbXMnKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnY3Vyc29yJyk7XG4gICAgICBleHBlY3QoQXJyYXkuaXNBcnJheShib2R5Lml0ZW1zKSkudG9CZSh0cnVlKTtcblxuICAgICAgLy8gQ3Vyc29yIGxvZ2ljOiBpZiB3ZSBnb3QgZXhhY3RseSB0aGUgY291bnQgbnVtYmVyIG9mIGl0ZW1zLCB0aGVyZSBtaWdodCBiZSBtb3JlXG4gICAgICAvLyBJZiB3ZSBnb3QgZmV3ZXIgaXRlbXMgdGhhbiB0aGUgY291bnQsIGN1cnNvciBzaG91bGQgYmUgbnVsbFxuICAgICAgaWYgKGJvZHkuaXRlbXMubGVuZ3RoIDwgMSkge1xuICAgICAgICBleHBlY3QoYm9keS5jdXJzb3IpLnRvQmVOdWxsKCk7XG4gICAgICB9IGVsc2UgaWYgKGJvZHkuaXRlbXMubGVuZ3RoID09PSAxKSB7XG4gICAgICAgIC8vIEdvdCBleGFjdGx5IDEgaXRlbSwgY3Vyc29yIGNhbiBiZSBzdHJpbmcgKG1vcmUgaXRlbXMpIG9yIG51bGwgKG5vIG1vcmUgaXRlbXMpXG4gICAgICAgIGV4cGVjdCh0eXBlb2YgYm9keS5jdXJzb3IgPT09ICdzdHJpbmcnIHx8IGJvZHkuY3Vyc29yID09PSBudWxsKS50b0JlKHRydWUpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZXhwZWN0KHR5cGVvZiBib2R5LmN1cnNvcikudG9CZSgnc3RyaW5nJyk7XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgZGVmYXVsdCBwYWdpbmF0aW9uIHdoZW4gbm8gcGFyYW1ldGVycyBwcm92aWRlZCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7fVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcblxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdjdXJzb3InKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnaXRlbXMnKTtcbiAgICAgIGV4cGVjdChBcnJheS5pc0FycmF5KGJvZHkuaXRlbXMpKS50b0JlKHRydWUpO1xuICAgIH0sIDMwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGxhcmdlIGNvdW50IHZhbHVlcycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgY291bnQ6ICcxMDAwJ1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuXG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2N1cnNvcicpO1xuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdpdGVtcycpO1xuICAgICAgZXhwZWN0KEFycmF5LmlzQXJyYXkoYm9keS5pdGVtcykpLnRvQmUodHJ1ZSk7XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgY291bnQgcGFyYW1ldGVyIChzYW1lIGFzIGVudGl0eSBjb250cm9sbGVyKScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgY291bnQ6ICcxMCdcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcblxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdjdXJzb3InKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnaXRlbXMnKTtcbiAgICAgIGV4cGVjdChBcnJheS5pc0FycmF5KGJvZHkuaXRlbXMpKS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KGJvZHkuaXRlbXMubGVuZ3RoKS50b0JlTGVzc1RoYW5PckVxdWFsKDEwKTtcbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIHByaW9yaXRpemUgY291bnQgb3ZlciBsaW1pdCBwYXJhbWV0ZXInLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvdGFza3MnLCB7XG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczoge1xuICAgICAgICAgIGNvdW50OiAnNScsXG4gICAgICAgICAgbGltaXQ6ICcyMCdcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcblxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdjdXJzb3InKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnaXRlbXMnKTtcbiAgICAgIGV4cGVjdChBcnJheS5pc0FycmF5KGJvZHkuaXRlbXMpKS50b0JlKHRydWUpO1xuICAgICAgZXhwZWN0KGJvZHkuaXRlbXMubGVuZ3RoKS50b0JlTGVzc1RoYW5PckVxdWFsKDUpOyAvLyBTaG91bGQgdXNlIGNvdW50LCBub3QgbGltaXRcbiAgICB9LCAzMDAwMCk7XG5cblxuXG4gICAgLy8gTmV3IGZpbHRlciB0ZXN0cyBmb3IgZW50aXR5LXN0eWxlIHF1ZXJ5IHBhcmFtZXRlcnNcbiAgICBpdCgnc2hvdWxkIGZpbHRlciB0YXNrcyBieSB0eXBlIHVzaW5nIGVudGl0eS1zdHlsZSBxdWVyeScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgY291bnQ6ICcxMCcsXG4gICAgICAgICAgJ3R5cGUuZXEnOiAnZG9jdW1lbnRBZGRpdGlvbk9yVXBkYXRlJ1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuXG4gICAgICBpZiAoYm9keS5pdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmV2ZXJ5KCh0YXNrOiBhbnkpID0+IHRhc2sudHlwZSA9PT0gJ2RvY3VtZW50QWRkaXRpb25PclVwZGF0ZScpKS50b0JlKHRydWUpO1xuICAgICAgfVxuICAgIH0sIDMwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgZmlsdGVyIHRhc2tzIGJ5IHR5cGUgdXNpbmcgSU4gb3BlcmF0b3InLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvdGFza3MnLCB7XG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczoge1xuICAgICAgICAgIGNvdW50OiAnMTAnLFxuICAgICAgICAgICd0eXBlLmluJzogJ2RvY3VtZW50QWRkaXRpb25PclVwZGF0ZSxzZXR0aW5nc1VwZGF0ZSdcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcblxuICAgICAgaWYgKGJvZHkuaXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICBleHBlY3QoYm9keS5pdGVtcy5ldmVyeSgodGFzazogYW55KSA9PlxuICAgICAgICAgIFsgJ2RvY3VtZW50QWRkaXRpb25PclVwZGF0ZScsICdzZXR0aW5nc1VwZGF0ZScgXS5pbmNsdWRlcyh0YXNrLnR5cGUpXG4gICAgICAgICkpLnRvQmUodHJ1ZSk7XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBmaWx0ZXIgdGFza3MgYnkgc3RhdHVzIHVzaW5nIGVudGl0eS1zdHlsZSBxdWVyeScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgY291bnQ6ICcxMCcsXG4gICAgICAgICAgJ3N0YXR1cy5lcSc6ICdzdWNjZWVkZWQnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG5cbiAgICAgIGlmIChib2R5Lml0ZW1zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgZXhwZWN0KGJvZHkuaXRlbXMuZXZlcnkoKHRhc2s6IGFueSkgPT4gdGFzay5zdGF0dXMgPT09ICdzdWNjZWVkZWQnKSkudG9CZSh0cnVlKTtcbiAgICAgIH1cbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGZpbHRlciB0YXNrcyBieSBzdGF0dXMgdXNpbmcgSU4gb3BlcmF0b3InLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvdGFza3MnLCB7XG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczoge1xuICAgICAgICAgIGNvdW50OiAnMTAnLFxuICAgICAgICAgICdzdGF0dXMuaW4nOiAnc3VjY2VlZGVkLGZhaWxlZCdcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcblxuICAgICAgaWYgKGJvZHkuaXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICBleHBlY3QoYm9keS5pdGVtcy5ldmVyeSgodGFzazogYW55KSA9PlxuICAgICAgICAgIFsgJ3N1Y2NlZWRlZCcsICdmYWlsZWQnIF0uaW5jbHVkZXModGFzay5zdGF0dXMpXG4gICAgICAgICkpLnRvQmUodHJ1ZSk7XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBmaWx0ZXIgdGFza3MgYnkgVUlEIHVzaW5nIGVudGl0eS1zdHlsZSBxdWVyeScsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIEZpcnN0IGdldCBhIHRhc2sgdG8gdXNlIGl0cyBVSURcbiAgICAgIGNvbnN0IGFsbFRhc2tzID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7IGNvdW50OiAnMScgfVxuICAgICAgfSk7XG4gICAgICBleHBlY3QoYWxsVGFza3Muc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYWxsVGFza3NCb2R5ID0gSlNPTi5wYXJzZShhbGxUYXNrcy5ib2R5KTtcblxuICAgICAgaWYgKGFsbFRhc2tzQm9keS5pdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IHRhc2tVaWQgPSBhbGxUYXNrc0JvZHkuaXRlbXNbIDAgXS51aWQ7XG5cbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3Rhc2tzJywge1xuICAgICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczoge1xuICAgICAgICAgICAgY291bnQ6ICcxMCcsXG4gICAgICAgICAgICAndWlkLmVxJzogdGFza1VpZC50b1N0cmluZygpXG4gICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcblxuICAgICAgICBleHBlY3QoYm9keS5pdGVtcy5sZW5ndGgpLnRvQmUoMSk7XG4gICAgICAgIGV4cGVjdChib2R5Lml0ZW1zWyAwIF0udWlkKS50b0JlKHRhc2tVaWQpO1xuICAgICAgfVxuICAgIH0sIDMwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgZmlsdGVyIHRhc2tzIGJ5IFVJRCB1c2luZyBJTiBvcGVyYXRvcicsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIEZpcnN0IGdldCBzb21lIHRhc2tzIHRvIHVzZSB0aGVpciBVSURzXG4gICAgICBjb25zdCBhbGxUYXNrcyA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvdGFza3MnLCB7XG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogeyBjb3VudDogJzMnIH1cbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KGFsbFRhc2tzLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGFsbFRhc2tzQm9keSA9IEpTT04ucGFyc2UoYWxsVGFza3MuYm9keSk7XG5cbiAgICAgIGlmIChhbGxUYXNrc0JvZHkuaXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCB0YXNrVWlkcyA9IGFsbFRhc2tzQm9keS5pdGVtcy5tYXAoKHRhc2s6IGFueSkgPT4gdGFzay51aWQpLnNsaWNlKDAsIDIpO1xuXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHtcbiAgICAgICAgICAgIGNvdW50OiAnMTAnLFxuICAgICAgICAgICAgJ3VpZC5pbic6IHRhc2tVaWRzLmpvaW4oJywnKVxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG5cbiAgICAgICAgaWYgKGJvZHkuaXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmV2ZXJ5KCh0YXNrOiBhbnkpID0+IHRhc2tVaWRzLmluY2x1ZGVzKHRhc2sudWlkKSkpLnRvQmUodHJ1ZSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGZpbHRlciB0YXNrcyBieSBpbmRleFVpZCB1c2luZyBlbnRpdHktc3R5bGUgcXVlcnknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvdGFza3MnLCB7XG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczoge1xuICAgICAgICAgIGNvdW50OiAnMTAnLFxuICAgICAgICAgICdpbmRleFVpZC5lcSc6ICd0ZXN0LWluZGV4J1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuXG4gICAgICBpZiAoYm9keS5pdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmV2ZXJ5KCh0YXNrOiBhbnkpID0+IHRhc2suaW5kZXhVaWQgPT09ICd0ZXN0LWluZGV4JykpLnRvQmUodHJ1ZSk7XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBmaWx0ZXIgdGFza3MgYnkgaW5kZXhVaWQgdXNpbmcgSU4gb3BlcmF0b3InLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvdGFza3MnLCB7XG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczoge1xuICAgICAgICAgIGNvdW50OiAnMTAnLFxuICAgICAgICAgICdpbmRleFVpZC5pbic6ICd0ZXN0LWluZGV4LG90aGVyLWluZGV4J1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuXG4gICAgICBpZiAoYm9keS5pdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmV2ZXJ5KCh0YXNrOiBhbnkpID0+XG4gICAgICAgICAgWyAndGVzdC1pbmRleCcsICdvdGhlci1pbmRleCcgXS5pbmNsdWRlcyh0YXNrLmluZGV4VWlkKVxuICAgICAgICApKS50b0JlKHRydWUpO1xuICAgICAgfVxuICAgIH0sIDMwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgZmlsdGVyIHRhc2tzIGJ5IGVucXVldWVkQXQgdXNpbmcgTFQgb3BlcmF0b3InLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBmdXR1cmVEYXRlID0gbmV3IERhdGUoRGF0ZS5ub3coKSArIDI0ICogNjAgKiA2MCAqIDEwMDApOyAvLyBUb21vcnJvd1xuXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvdGFza3MnLCB7XG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczoge1xuICAgICAgICAgIGNvdW50OiAnMTAnLFxuICAgICAgICAgICdlbnF1ZXVlZEF0Lmx0JzogZnV0dXJlRGF0ZS50b0lTT1N0cmluZygpXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG5cbiAgICAgIGlmIChib2R5Lml0ZW1zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgZXhwZWN0KGJvZHkuaXRlbXMuZXZlcnkoKHRhc2s6IGFueSkgPT4ge1xuICAgICAgICAgIGNvbnN0IGVucXVldWVkQXQgPSBuZXcgRGF0ZSh0YXNrLmVucXVldWVkQXQpO1xuICAgICAgICAgIHJldHVybiBlbnF1ZXVlZEF0IDwgZnV0dXJlRGF0ZTtcbiAgICAgICAgfSkpLnRvQmUodHJ1ZSk7XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBmaWx0ZXIgdGFza3MgYnkgZW5xdWV1ZWRBdCB1c2luZyBHVCBvcGVyYXRvcicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHBhc3REYXRlID0gbmV3IERhdGUoRGF0ZS5ub3coKSAtIDI0ICogNjAgKiA2MCAqIDEwMDApOyAvLyBZZXN0ZXJkYXlcblxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3Rhc2tzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHtcbiAgICAgICAgICBjb3VudDogJzEwJyxcbiAgICAgICAgICAnZW5xdWV1ZWRBdC5ndCc6IHBhc3REYXRlLnRvSVNPU3RyaW5nKClcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcblxuICAgICAgaWYgKGJvZHkuaXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICBleHBlY3QoYm9keS5pdGVtcy5ldmVyeSgodGFzazogYW55KSA9PiB7XG4gICAgICAgICAgY29uc3QgZW5xdWV1ZWRBdCA9IG5ldyBEYXRlKHRhc2suZW5xdWV1ZWRBdCk7XG4gICAgICAgICAgcmV0dXJuIGVucXVldWVkQXQgPiBwYXN0RGF0ZTtcbiAgICAgICAgfSkpLnRvQmUodHJ1ZSk7XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBmaWx0ZXIgdGFza3MgYnkgc3RhcnRlZEF0IHVzaW5nIExUIG9wZXJhdG9yJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZnV0dXJlRGF0ZSA9IG5ldyBEYXRlKERhdGUubm93KCkgKyAyNCAqIDYwICogNjAgKiAxMDAwKTsgLy8gVG9tb3Jyb3dcblxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3Rhc2tzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHtcbiAgICAgICAgICBjb3VudDogJzEwJyxcbiAgICAgICAgICAnc3RhcnRlZEF0Lmx0JzogZnV0dXJlRGF0ZS50b0lTT1N0cmluZygpXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG5cbiAgICAgIGlmIChib2R5Lml0ZW1zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgZXhwZWN0KGJvZHkuaXRlbXMuZXZlcnkoKHRhc2s6IGFueSkgPT4ge1xuICAgICAgICAgIGlmICghdGFzay5zdGFydGVkQXQpIHJldHVybiB0cnVlOyAvLyBTa2lwIHRhc2tzIHdpdGhvdXQgc3RhcnRlZEF0XG4gICAgICAgICAgY29uc3Qgc3RhcnRlZEF0ID0gbmV3IERhdGUodGFzay5zdGFydGVkQXQpO1xuICAgICAgICAgIHJldHVybiBzdGFydGVkQXQgPCBmdXR1cmVEYXRlO1xuICAgICAgICB9KSkudG9CZSh0cnVlKTtcbiAgICAgIH1cbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGZpbHRlciB0YXNrcyBieSBzdGFydGVkQXQgdXNpbmcgR1Qgb3BlcmF0b3InLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBwYXN0RGF0ZSA9IG5ldyBEYXRlKERhdGUubm93KCkgLSAyNCAqIDYwICogNjAgKiAxMDAwKTsgLy8gWWVzdGVyZGF5XG5cbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgY291bnQ6ICcxMCcsXG4gICAgICAgICAgJ3N0YXJ0ZWRBdC5ndCc6IHBhc3REYXRlLnRvSVNPU3RyaW5nKClcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcblxuICAgICAgaWYgKGJvZHkuaXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICBleHBlY3QoYm9keS5pdGVtcy5ldmVyeSgodGFzazogYW55KSA9PiB7XG4gICAgICAgICAgaWYgKCF0YXNrLnN0YXJ0ZWRBdCkgcmV0dXJuIGZhbHNlOyAvLyBPbmx5IGluY2x1ZGUgdGFza3Mgd2l0aCBzdGFydGVkQXRcbiAgICAgICAgICBjb25zdCBzdGFydGVkQXQgPSBuZXcgRGF0ZSh0YXNrLnN0YXJ0ZWRBdCk7XG4gICAgICAgICAgcmV0dXJuIHN0YXJ0ZWRBdCA+IHBhc3REYXRlO1xuICAgICAgICB9KSkudG9CZSh0cnVlKTtcbiAgICAgIH1cbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGZpbHRlciB0YXNrcyBieSBmaW5pc2hlZEF0IHVzaW5nIExUIG9wZXJhdG9yJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZnV0dXJlRGF0ZSA9IG5ldyBEYXRlKERhdGUubm93KCkgKyAyNCAqIDYwICogNjAgKiAxMDAwKTsgLy8gVG9tb3Jyb3dcblxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3Rhc2tzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHtcbiAgICAgICAgICBjb3VudDogJzEwJyxcbiAgICAgICAgICAnZmluaXNoZWRBdC5sdCc6IGZ1dHVyZURhdGUudG9JU09TdHJpbmcoKVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuXG4gICAgICBpZiAoYm9keS5pdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmV2ZXJ5KCh0YXNrOiBhbnkpID0+IHtcbiAgICAgICAgICBpZiAoIXRhc2suZmluaXNoZWRBdCkgcmV0dXJuIHRydWU7IC8vIFNraXAgdGFza3Mgd2l0aG91dCBmaW5pc2hlZEF0XG4gICAgICAgICAgY29uc3QgZmluaXNoZWRBdCA9IG5ldyBEYXRlKHRhc2suZmluaXNoZWRBdCk7XG4gICAgICAgICAgcmV0dXJuIGZpbmlzaGVkQXQgPCBmdXR1cmVEYXRlO1xuICAgICAgICB9KSkudG9CZSh0cnVlKTtcbiAgICAgIH1cbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGZpbHRlciB0YXNrcyBieSBmaW5pc2hlZEF0IHVzaW5nIEdUIG9wZXJhdG9yJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcGFzdERhdGUgPSBuZXcgRGF0ZShEYXRlLm5vdygpIC0gMjQgKiA2MCAqIDYwICogMTAwMCk7IC8vIFllc3RlcmRheVxuXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvdGFza3MnLCB7XG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczoge1xuICAgICAgICAgIGNvdW50OiAnMTAnLFxuICAgICAgICAgICdmaW5pc2hlZEF0Lmd0JzogcGFzdERhdGUudG9JU09TdHJpbmcoKVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuXG4gICAgICBpZiAoYm9keS5pdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmV2ZXJ5KCh0YXNrOiBhbnkpID0+IHtcbiAgICAgICAgICBpZiAoIXRhc2suZmluaXNoZWRBdCkgcmV0dXJuIGZhbHNlOyAvLyBPbmx5IGluY2x1ZGUgdGFza3Mgd2l0aCBmaW5pc2hlZEF0XG4gICAgICAgICAgY29uc3QgZmluaXNoZWRBdCA9IG5ldyBEYXRlKHRhc2suZmluaXNoZWRBdCk7XG4gICAgICAgICAgcmV0dXJuIGZpbmlzaGVkQXQgPiBwYXN0RGF0ZTtcbiAgICAgICAgfSkpLnRvQmUodHJ1ZSk7XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBmaWx0ZXIgdGFza3MgYnkgY2FuY2VsZWRCeSB1c2luZyBlbnRpdHktc3R5bGUgcXVlcnknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvdGFza3MnLCB7XG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczoge1xuICAgICAgICAgIGNvdW50OiAnMTAnLFxuICAgICAgICAgICdjYW5jZWxlZEJ5LmVxJzogJzEyMydcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcblxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdjdXJzb3InKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnaXRlbXMnKTtcbiAgICAgIGV4cGVjdChBcnJheS5pc0FycmF5KGJvZHkuaXRlbXMpKS50b0JlKHRydWUpO1xuICAgIH0sIDMwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgZmlsdGVyIHRhc2tzIGJ5IGJhdGNoVWlkIHVzaW5nIGVudGl0eS1zdHlsZSBxdWVyeScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgY291bnQ6ICcxMCcsXG4gICAgICAgICAgJ2JhdGNoVWlkLmVxJzogJzQ1NidcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcblxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdjdXJzb3InKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnaXRlbXMnKTtcbiAgICAgIGV4cGVjdChBcnJheS5pc0FycmF5KGJvZHkuaXRlbXMpKS50b0JlKHRydWUpO1xuICAgIH0sIDMwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgZmlsdGVyIHRhc2tzIGJ5IGJhdGNoVWlkIHVzaW5nIElOIG9wZXJhdG9yJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3Rhc2tzJywge1xuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IHtcbiAgICAgICAgICBjb3VudDogJzEwJyxcbiAgICAgICAgICAnYmF0Y2hVaWQuaW4nOiAnNDU2LDc4OSdcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcblxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdjdXJzb3InKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnaXRlbXMnKTtcbiAgICAgIGV4cGVjdChBcnJheS5pc0FycmF5KGJvZHkuaXRlbXMpKS50b0JlKHRydWUpO1xuICAgIH0sIDMwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGNvbXBsZXggZW50aXR5LXN0eWxlIGZpbHRlciBjb21iaW5hdGlvbnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvdGFza3MnLCB7XG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczoge1xuICAgICAgICAgIGNvdW50OiAnMTAnLFxuICAgICAgICAgICd0eXBlLmVxJzogJ2RvY3VtZW50QWRkaXRpb25PclVwZGF0ZScsXG4gICAgICAgICAgJ3N0YXR1cy5lcSc6ICdzdWNjZWVkZWQnLFxuICAgICAgICAgICdlbnF1ZXVlZEF0Lmd0JzogbmV3IERhdGUoRGF0ZS5ub3coKSAtIDcgKiAyNCAqIDYwICogNjAgKiAxMDAwKS50b0lTT1N0cmluZygpLCAvLyBMYXN0IDcgZGF5c1xuICAgICAgICAgIGN1cnNvcjogJycsXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG5cbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnY3Vyc29yJyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2l0ZW1zJyk7XG4gICAgICBleHBlY3QoQXJyYXkuaXNBcnJheShib2R5Lml0ZW1zKSkudG9CZSh0cnVlKTtcblxuICAgICAgaWYgKGJvZHkuaXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCB3ZWVrQWdvID0gbmV3IERhdGUoRGF0ZS5ub3coKSAtIDcgKiAyNCAqIDYwICogNjAgKiAxMDAwKTtcbiAgICAgICAgZXhwZWN0KGJvZHkuaXRlbXMuZXZlcnkoKHRhc2s6IGFueSkgPT4ge1xuICAgICAgICAgIGNvbnN0IGVucXVldWVkQXQgPSBuZXcgRGF0ZSh0YXNrLmVucXVldWVkQXQpO1xuICAgICAgICAgIHJldHVybiB0YXNrLnR5cGUgPT09ICdkb2N1bWVudEFkZGl0aW9uT3JVcGRhdGUnICYmXG4gICAgICAgICAgICB0YXNrLnN0YXR1cyA9PT0gJ3N1Y2NlZWRlZCcgJiZcbiAgICAgICAgICAgIGVucXVldWVkQXQgPiB3ZWVrQWdvO1xuICAgICAgICB9KSkudG9CZSh0cnVlKTtcbiAgICAgIH1cbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBhdHRyaWJ1dGVzIHBhcmFtZXRlcicsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgY291bnQ6ICc1JyxcbiAgICAgICAgICBhdHRyaWJ1dGVzOiAndWlkLGluZGV4VWlkLHN0YXR1cyx0eXBlLGVucXVldWVkQXQsc3RhcnRlZEF0LGZpbmlzaGVkQXQnXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG5cbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnY3Vyc29yJyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2l0ZW1zJyk7XG4gICAgICBleHBlY3QoQXJyYXkuaXNBcnJheShib2R5Lml0ZW1zKSkudG9CZSh0cnVlKTtcblxuICAgICAgaWYgKGJvZHkuaXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCB0YXNrID0gYm9keS5pdGVtc1sgMCBdO1xuICAgICAgICBleHBlY3QodGFzaykudG9IYXZlUHJvcGVydHkoJ3VpZCcpO1xuICAgICAgICBleHBlY3QodGFzaykudG9IYXZlUHJvcGVydHkoJ2luZGV4VWlkJyk7XG4gICAgICAgIGV4cGVjdCh0YXNrKS50b0hhdmVQcm9wZXJ0eSgnc3RhdHVzJyk7XG4gICAgICAgIGV4cGVjdCh0YXNrKS50b0hhdmVQcm9wZXJ0eSgndHlwZScpO1xuICAgICAgICBleHBlY3QodGFzaykudG9IYXZlUHJvcGVydHkoJ2VucXVldWVkQXQnKTtcbiAgICAgICAgZXhwZWN0KHRhc2spLnRvSGF2ZVByb3BlcnR5KCdzdGFydGVkQXQnKTtcbiAgICAgICAgZXhwZWN0KHRhc2spLnRvSGF2ZVByb3BlcnR5KCdmaW5pc2hlZEF0Jyk7XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCByZXR1cm4gdGFza3MgaW4gZGVzY2VuZGluZyBvcmRlciAobmV3ZXN0IGZpcnN0KScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgY291bnQ6ICcxMCdcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcblxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdjdXJzb3InKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnaXRlbXMnKTtcbiAgICAgIGV4cGVjdChBcnJheS5pc0FycmF5KGJvZHkuaXRlbXMpKS50b0JlKHRydWUpO1xuXG4gICAgICAvLyBWZXJpZnkgdGFza3MgYXJlIGluIGRlc2NlbmRpbmcgb3JkZXIgKG5ld2VzdCBmaXJzdClcbiAgICAgIGlmIChib2R5Lml0ZW1zLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBib2R5Lml0ZW1zLmxlbmd0aCAtIDE7IGkrKykge1xuICAgICAgICAgIGNvbnN0IGN1cnJlbnRUYXNrID0gYm9keS5pdGVtc1sgaSBdO1xuICAgICAgICAgIGNvbnN0IG5leHRUYXNrID0gYm9keS5pdGVtc1sgaSArIDEgXTtcblxuICAgICAgICAgIC8vIENvbXBhcmUgZW5xdWV1ZWRBdCB0aW1lc3RhbXBzIC0gbmV3ZXIgdGFza3Mgc2hvdWxkIGNvbWUgZmlyc3RcbiAgICAgICAgICBjb25zdCBjdXJyZW50VGltZSA9IG5ldyBEYXRlKGN1cnJlbnRUYXNrLmVucXVldWVkQXQpLmdldFRpbWUoKTtcbiAgICAgICAgICBjb25zdCBuZXh0VGltZSA9IG5ldyBEYXRlKG5leHRUYXNrLmVucXVldWVkQXQpLmdldFRpbWUoKTtcbiAgICAgICAgICBleHBlY3QoY3VycmVudFRpbWUpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwobmV4dFRpbWUpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgYWxsIHZhbGlkIHRhc2sgdHlwZXMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2YWxpZFR5cGVzID0gW1xuICAgICAgICAnZG9jdW1lbnRBZGRpdGlvbk9yVXBkYXRlJyxcbiAgICAgICAgJ2RvY3VtZW50RWRpdGlvbicsXG4gICAgICAgICdkb2N1bWVudERlbGV0aW9uJyxcbiAgICAgICAgJ3NldHRpbmdzVXBkYXRlJyxcbiAgICAgICAgJ2luZGV4Q3JlYXRpb24nLFxuICAgICAgICAnaW5kZXhEZWxldGlvbicsXG4gICAgICAgICdpbmRleFVwZGF0ZScsXG4gICAgICAgICdpbmRleFN3YXAnLFxuICAgICAgICAndGFza0NhbmNlbGF0aW9uJyxcbiAgICAgICAgJ3Rhc2tEZWxldGlvbicsXG4gICAgICAgICdkdW1wQ3JlYXRpb24nLFxuICAgICAgICAnc25hcHNob3RDcmVhdGlvbicsXG4gICAgICAgICd1cGdyYWRlRGF0YWJhc2UnXG4gICAgICBdO1xuXG4gICAgICBmb3IgKGNvbnN0IHRhc2tUeXBlIG9mIHZhbGlkVHlwZXMpIHtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBoYXJuZXNzLmdldCgnL3Rhc2tzJywge1xuICAgICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczoge1xuICAgICAgICAgICAgY291bnQ6ICc1JyxcbiAgICAgICAgICAgICd0eXBlLmVxJzogdGFza1R5cGVcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuXG4gICAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnY3Vyc29yJyk7XG4gICAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnaXRlbXMnKTtcbiAgICAgICAgZXhwZWN0KEFycmF5LmlzQXJyYXkoYm9keS5pdGVtcykpLnRvQmUodHJ1ZSk7XG5cbiAgICAgICAgLy8gSWYgdGhlcmUgYXJlIHRhc2tzIG9mIHRoaXMgdHlwZSwgdmVyaWZ5IHRoZXkgbWF0Y2hcbiAgICAgICAgaWYgKGJvZHkuaXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmV2ZXJ5KCh0YXNrOiBhbnkpID0+IHRhc2sudHlwZSA9PT0gdGFza1R5cGUpKS50b0JlKHRydWUpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgYWxsIHZhbGlkIHRhc2sgc3RhdHVzZXMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2YWxpZFN0YXR1c2VzID0gW1xuICAgICAgICAnZW5xdWV1ZWQnLFxuICAgICAgICAncHJvY2Vzc2luZycsXG4gICAgICAgICdzdWNjZWVkZWQnLFxuICAgICAgICAnZmFpbGVkJyxcbiAgICAgICAgJ2NhbmNlbGVkJ1xuICAgICAgXTtcblxuICAgICAgZm9yIChjb25zdCBzdGF0dXMgb2YgdmFsaWRTdGF0dXNlcykge1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvdGFza3MnLCB7XG4gICAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgICBjb3VudDogJzUnLFxuICAgICAgICAgICAgJ3N0YXR1cy5lcSc6IHN0YXR1c1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG5cbiAgICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdjdXJzb3InKTtcbiAgICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdpdGVtcycpO1xuICAgICAgICBleHBlY3QoQXJyYXkuaXNBcnJheShib2R5Lml0ZW1zKSkudG9CZSh0cnVlKTtcblxuICAgICAgICAvLyBJZiB0aGVyZSBhcmUgdGFza3Mgd2l0aCB0aGlzIHN0YXR1cywgdmVyaWZ5IHRoZXkgbWF0Y2hcbiAgICAgICAgaWYgKGJvZHkuaXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmV2ZXJ5KCh0YXNrOiBhbnkpID0+IHRhc2suc3RhdHVzID09PSBzdGF0dXMpKS50b0JlKHRydWUpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSwgMzAwMDApO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbXVsdGlwbGUgZmlsdGVyIGNvbWJpbmF0aW9ucyB3aXRoIGRpZmZlcmVudCBvcGVyYXRvcnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvdGFza3MnLCB7XG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczoge1xuICAgICAgICAgIGNvdW50OiAnMTAnLFxuICAgICAgICAgICd0eXBlLmluJzogJ2RvY3VtZW50QWRkaXRpb25PclVwZGF0ZSxzZXR0aW5nc1VwZGF0ZScsXG4gICAgICAgICAgJ3N0YXR1cy5pbic6ICdzdWNjZWVkZWQsZmFpbGVkJyxcbiAgICAgICAgICAnZW5xdWV1ZWRBdC5ndCc6IG5ldyBEYXRlKERhdGUubm93KCkgLSAzMCAqIDI0ICogNjAgKiA2MCAqIDEwMDApLnRvSVNPU3RyaW5nKCksIC8vIExhc3QgMzAgZGF5c1xuICAgICAgICAgICdzdGFydGVkQXQubHQnOiBuZXcgRGF0ZShEYXRlLm5vdygpICsgMjQgKiA2MCAqIDYwICogMTAwMCkudG9JU09TdHJpbmcoKSwgLy8gQmVmb3JlIHRvbW9ycm93XG4gICAgICAgICAgY3Vyc29yOiAnJyxcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcblxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdjdXJzb3InKTtcbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnaXRlbXMnKTtcbiAgICAgIGV4cGVjdChBcnJheS5pc0FycmF5KGJvZHkuaXRlbXMpKS50b0JlKHRydWUpO1xuXG4gICAgICBpZiAoYm9keS5pdGVtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IHRoaXJ0eURheXNBZ28gPSBuZXcgRGF0ZShEYXRlLm5vdygpIC0gMzAgKiAyNCAqIDYwICogNjAgKiAxMDAwKTtcbiAgICAgICAgY29uc3QgdG9tb3Jyb3cgPSBuZXcgRGF0ZShEYXRlLm5vdygpICsgMjQgKiA2MCAqIDYwICogMTAwMCk7XG5cbiAgICAgICAgZXhwZWN0KGJvZHkuaXRlbXMuZXZlcnkoKHRhc2s6IGFueSkgPT4ge1xuICAgICAgICAgIGNvbnN0IGVucXVldWVkQXQgPSBuZXcgRGF0ZSh0YXNrLmVucXVldWVkQXQpO1xuICAgICAgICAgIGNvbnN0IHN0YXJ0ZWRBdCA9IHRhc2suc3RhcnRlZEF0ID8gbmV3IERhdGUodGFzay5zdGFydGVkQXQpIDogbnVsbDtcblxuICAgICAgICAgIHJldHVybiBbICdkb2N1bWVudEFkZGl0aW9uT3JVcGRhdGUnLCAnc2V0dGluZ3NVcGRhdGUnIF0uaW5jbHVkZXModGFzay50eXBlKSAmJlxuICAgICAgICAgICAgWyAnc3VjY2VlZGVkJywgJ2ZhaWxlZCcgXS5pbmNsdWRlcyh0YXNrLnN0YXR1cykgJiZcbiAgICAgICAgICAgIGVucXVldWVkQXQgPiB0aGlydHlEYXlzQWdvICYmXG4gICAgICAgICAgICAoIXN0YXJ0ZWRBdCB8fCBzdGFydGVkQXQgPCB0b21vcnJvdyk7XG4gICAgICAgIH0pKS50b0JlKHRydWUpO1xuICAgICAgfVxuICAgIH0sIDMwMDAwKTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGVtcHR5IHJlc3VsdCBzZXRzIGdyYWNlZnVsbHknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGhhcm5lc3MuZ2V0KCcvdGFza3MnLCB7XG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczoge1xuICAgICAgICAgIGNvdW50OiAnMTAnLFxuICAgICAgICAgICd1aWQuZXEnOiAnOTk5OTk5OTk5JyAvLyBOb24tZXhpc3RlbnQgVUlEXG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xuICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG5cbiAgICAgIGV4cGVjdChib2R5KS50b0hhdmVQcm9wZXJ0eSgnY3Vyc29yJyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2l0ZW1zJyk7XG4gICAgICBleHBlY3QoQXJyYXkuaXNBcnJheShib2R5Lml0ZW1zKSkudG9CZSh0cnVlKTtcbiAgICAgIGV4cGVjdChib2R5Lml0ZW1zLmxlbmd0aCkudG9CZSgwKTtcbiAgICAgIGV4cGVjdChib2R5LmN1cnNvcikudG9CZU51bGwoKTtcbiAgICB9LCAzMDAwMCk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBpbnZhbGlkIGZpbHRlciB2YWx1ZXMgZ3JhY2VmdWxseScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgaGFybmVzcy5nZXQoJy90YXNrcycsIHtcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgY291bnQ6ICcxMCcsXG4gICAgICAgICAgJ3R5cGUuZXEnOiAnaW52YWxpZFR5cGUnLFxuICAgICAgICAgICdzdGF0dXMuZXEnOiAnaW52YWxpZFN0YXR1cydcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXNDb2RlKS50b0JlKDUwMCk7XG4gICAgICBjb25zdCBib2R5ID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcblxuICAgICAgLy8gRnJhbWV3b3JrIGVycm9yIHJlc3BvbnNlIHN0cnVjdHVyZVxuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdtZXNzYWdlJyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ3N0YXR1cycpO1xuICAgICAgZXhwZWN0KGJvZHkpLnRvSGF2ZVByb3BlcnR5KCdzdGF0dXNDb2RlJyk7XG4gICAgICBleHBlY3QoYm9keSkudG9IYXZlUHJvcGVydHkoJ2RldGFpbHMnKTtcbiAgICAgIGV4cGVjdChib2R5LmRldGFpbHMpLnRvSGF2ZVByb3BlcnR5KCdtZXNzYWdlJyk7XG4gICAgICBleHBlY3QoYm9keS5kZXRhaWxzLm1lc3NhZ2UpLnRvQ29udGFpbignSW52YWxpZCB2YWx1ZSBpbiBwYXJhbWV0ZXInKTtcbiAgICB9LCAzMDAwMCk7XG4gIH0pO1xufSk7ICJdfQ==
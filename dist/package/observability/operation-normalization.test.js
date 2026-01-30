"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("./testing");
const log_1 = require("./observers/log");
const manager_1 = require("./manager");
describe('Operation normalization', () => {
    let backend;
    beforeEach(() => {
        backend = (0, testing_1.setupTestObservability)();
    });
    afterEach(() => {
        (0, testing_1.cleanupTestObservability)();
    });
    it('normalizes high-cardinality operation strings and stores original metadata', async () => {
        await (0, testing_1.createTestContext)(async () => {
            log_1.LogObserver.info('GET /users/2f80c4f0-3ffb-4aa6-9f7b-7c8fd2c3b93a/orders/8fd381f26e14820d', {
                hello: 'world',
            });
            await manager_1.ObservabilityManager.flush();
        });
        const events = backend.getEventsMatching({ type: 'log' });
        expect(events.length).toBe(1);
        const e = events[0];
        expect(e.operation).toBe('GET /users/:uuid/orders/:id');
        expect(e.data && e.data.operationNormalization).toMatchObject({
            from: 'GET /users/2f80c4f0-3ffb-4aa6-9f7b-7c8fd2c3b93a/orders/8fd381f26e14820d',
            to: 'GET /users/:uuid/orders/:id',
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3BlcmF0aW9uLW5vcm1hbGl6YXRpb24udGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L29wZXJhdGlvbi1ub3JtYWxpemF0aW9uLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSx1Q0FLbUI7QUFDbkIseUNBQThDO0FBQzlDLHVDQUFpRDtBQUVqRCxRQUFRLENBQUMseUJBQXlCLEVBQUUsR0FBRyxFQUFFO0lBQ3ZDLElBQUksT0FBb0IsQ0FBQztJQUV6QixVQUFVLENBQUMsR0FBRyxFQUFFO1FBQ2QsT0FBTyxHQUFHLElBQUEsZ0NBQXNCLEdBQUUsQ0FBQztJQUNyQyxDQUFDLENBQUMsQ0FBQztJQUVILFNBQVMsQ0FBQyxHQUFHLEVBQUU7UUFDYixJQUFBLGtDQUF3QixHQUFFLENBQUM7SUFDN0IsQ0FBQyxDQUFDLENBQUM7SUFFSCxFQUFFLENBQUMsNEVBQTRFLEVBQUUsS0FBSyxJQUFJLEVBQUU7UUFDMUYsTUFBTSxJQUFBLDJCQUFpQixFQUFDLEtBQUssSUFBSSxFQUFFO1lBQ2pDLGlCQUFXLENBQUMsSUFBSSxDQUFDLHlFQUF5RSxFQUFFO2dCQUMxRixLQUFLLEVBQUUsT0FBTzthQUNmLENBQUMsQ0FBQztZQUVILE1BQU0sOEJBQW9CLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDckMsQ0FBQyxDQUFDLENBQUM7UUFFSCxNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUMsaUJBQWlCLENBQUMsRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQztRQUMxRCxNQUFNLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUU5QixNQUFNLENBQUMsR0FBRyxNQUFNLENBQUUsQ0FBQyxDQUFFLENBQUM7UUFDdEIsTUFBTSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxJQUFJLENBQUMsNkJBQTZCLENBQUMsQ0FBQztRQUN4RCxNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksSUFBSyxDQUFDLENBQUMsSUFBWSxDQUFDLHNCQUFzQixDQUFDLENBQUMsYUFBYSxDQUFDO1lBQ3JFLElBQUksRUFBRSx5RUFBeUU7WUFDL0UsRUFBRSxFQUFFLDZCQUE2QjtTQUNsQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtcbiAgTW9ja0JhY2tlbmQsXG4gIHNldHVwVGVzdE9ic2VydmFiaWxpdHksXG4gIGNyZWF0ZVRlc3RDb250ZXh0LFxuICBjbGVhbnVwVGVzdE9ic2VydmFiaWxpdHksXG59IGZyb20gJy4vdGVzdGluZyc7XG5pbXBvcnQgeyBMb2dPYnNlcnZlciB9IGZyb20gJy4vb2JzZXJ2ZXJzL2xvZyc7XG5pbXBvcnQgeyBPYnNlcnZhYmlsaXR5TWFuYWdlciB9IGZyb20gJy4vbWFuYWdlcic7XG5cbmRlc2NyaWJlKCdPcGVyYXRpb24gbm9ybWFsaXphdGlvbicsICgpID0+IHtcbiAgbGV0IGJhY2tlbmQ6IE1vY2tCYWNrZW5kO1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgIGJhY2tlbmQgPSBzZXR1cFRlc3RPYnNlcnZhYmlsaXR5KCk7XG4gIH0pO1xuXG4gIGFmdGVyRWFjaCgoKSA9PiB7XG4gICAgY2xlYW51cFRlc3RPYnNlcnZhYmlsaXR5KCk7XG4gIH0pO1xuXG4gIGl0KCdub3JtYWxpemVzIGhpZ2gtY2FyZGluYWxpdHkgb3BlcmF0aW9uIHN0cmluZ3MgYW5kIHN0b3JlcyBvcmlnaW5hbCBtZXRhZGF0YScsIGFzeW5jICgpID0+IHtcbiAgICBhd2FpdCBjcmVhdGVUZXN0Q29udGV4dChhc3luYyAoKSA9PiB7XG4gICAgICBMb2dPYnNlcnZlci5pbmZvKCdHRVQgL3VzZXJzLzJmODBjNGYwLTNmZmItNGFhNi05ZjdiLTdjOGZkMmMzYjkzYS9vcmRlcnMvOGZkMzgxZjI2ZTE0ODIwZCcsIHtcbiAgICAgICAgaGVsbG86ICd3b3JsZCcsXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZmx1c2goKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IGV2ZW50cyA9IGJhY2tlbmQuZ2V0RXZlbnRzTWF0Y2hpbmcoeyB0eXBlOiAnbG9nJyB9KTtcbiAgICBleHBlY3QoZXZlbnRzLmxlbmd0aCkudG9CZSgxKTtcblxuICAgIGNvbnN0IGUgPSBldmVudHNbIDAgXTtcbiAgICBleHBlY3QoZS5vcGVyYXRpb24pLnRvQmUoJ0dFVCAvdXNlcnMvOnV1aWQvb3JkZXJzLzppZCcpO1xuICAgIGV4cGVjdChlLmRhdGEgJiYgKGUuZGF0YSBhcyBhbnkpLm9wZXJhdGlvbk5vcm1hbGl6YXRpb24pLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgZnJvbTogJ0dFVCAvdXNlcnMvMmY4MGM0ZjAtM2ZmYi00YWE2LTlmN2ItN2M4ZmQyYzNiOTNhL29yZGVycy84ZmQzODFmMjZlMTQ4MjBkJyxcbiAgICAgIHRvOiAnR0VUIC91c2Vycy86dXVpZC9vcmRlcnMvOmlkJyxcbiAgICB9KTtcbiAgfSk7XG59KTtcblxuXG4iXX0=
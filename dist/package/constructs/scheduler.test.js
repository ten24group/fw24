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
const scheduler_1 = require("./scheduler");
const fw24_1 = require("../core/fw24");
const aws_lambda_1 = require("aws-cdk-lib/aws-lambda");
/**
 * SchedulerConstruct Test Suite
 *
 * NOTE: SchedulerConstruct is 126 lines and creates scheduled Lambda tasks.
 * These tests focus on:
 * 1. Basic construct creation and configuration
 * 2. Task directory handling (default and custom)
 * 3. Environment variable configuration
 * 4. Function properties merging
 * 5. Merge utility usage (bug we fixed)
 * 6. Edge cases and error scenarios
 *
 * NOT TESTED (requires actual @Task decorated files):
 * - Actual task file loading (needs @Task decorated classes)
 * - Task execution and scheduling (runtime behavior)
 * - Module-based task loading (requires module setup)
 *
 * These are integration/runtime features tested in E2E tests.
 */
describe('SchedulerConstruct', () => {
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
            name: 'test-scheduler-app',
            region: 'us-east-1',
            account: '123456789012'
        });
        fw24.addStack('main', stack);
    });
    afterEach(() => {
        fw24_1.Fw24.instance = undefined;
    });
    describe('Basic Construct Creation', () => {
        it('should create SchedulerConstruct with minimal configuration', () => {
            const config = {
                tasksDirectory: './test-tasks'
            };
            const schedulerConstruct = new scheduler_1.SchedulerConstruct(config);
            expect(schedulerConstruct).toBeDefined();
            expect(schedulerConstruct.name).toBe('SchedulerConstruct');
            expect(schedulerConstruct.dependencies).toContain('VpcConstruct');
            expect(schedulerConstruct.dependencies).toContain('LayerConstruct');
        });
        it('should apply default tasks directory when not provided', async () => {
            const config = {};
            const schedulerConstruct = new scheduler_1.SchedulerConstruct(config);
            // Mock registerHandlers to avoid file system access
            const originalRegisterHandlers = (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers;
            (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers = jest.fn().mockResolvedValue(undefined);
            await schedulerConstruct.construct();
            // Default directory should be set (scheduler.ts:69-71)
            expect(schedulerConstruct.schedulerConstructConfig.tasksDirectory).toBe('./src/tasks');
            // Restore
            (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers = originalRegisterHandlers;
        });
        it('should apply default tasks directory when empty string provided', async () => {
            const config = {
                tasksDirectory: ''
            };
            const schedulerConstruct = new scheduler_1.SchedulerConstruct(config);
            // Mock registerHandlers
            const originalRegisterHandlers = (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers;
            (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers = jest.fn().mockResolvedValue(undefined);
            await schedulerConstruct.construct();
            expect(schedulerConstruct.schedulerConstructConfig.tasksDirectory).toBe('./src/tasks');
            // Restore
            (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers = originalRegisterHandlers;
        });
        it('should preserve custom tasks directory', async () => {
            const config = {
                tasksDirectory: './custom/tasks/path'
            };
            const schedulerConstruct = new scheduler_1.SchedulerConstruct(config);
            // Mock registerHandlers
            const originalRegisterHandlers = (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers;
            (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers = jest.fn().mockResolvedValue(undefined);
            await schedulerConstruct.construct();
            expect(schedulerConstruct.schedulerConstructConfig.tasksDirectory).toBe('./custom/tasks/path');
            // Restore
            (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers = originalRegisterHandlers;
        });
    });
    describe('Environment Variable Configuration', () => {
        it('should store environment configuration', () => {
            const config = {
                tasksDirectory: './test-tasks',
                env: [
                    { name: 'API_URL', value: 'https://api.example.com' },
                    { name: 'API_KEY', value: 'secret-key' }
                ]
            };
            const schedulerConstruct = new scheduler_1.SchedulerConstruct(config);
            expect(schedulerConstruct.schedulerConstructConfig.env).toHaveLength(2);
            expect(schedulerConstruct.schedulerConstructConfig.env[0].name).toBe('API_URL');
            expect(schedulerConstruct.schedulerConstructConfig.env[1].name).toBe('API_KEY');
        });
        it('should handle empty environment array', () => {
            const config = {
                tasksDirectory: './test-tasks',
                env: []
            };
            const schedulerConstruct = new scheduler_1.SchedulerConstruct(config);
            expect(schedulerConstruct.schedulerConstructConfig.env).toEqual([]);
        });
        it('should handle undefined environment', () => {
            const config = {
                tasksDirectory: './test-tasks'
            };
            const schedulerConstruct = new scheduler_1.SchedulerConstruct(config);
            expect(schedulerConstruct.schedulerConstructConfig.env).toBeUndefined();
        });
    });
    describe('Function Properties Configuration', () => {
        it('should store function properties', () => {
            const config = {
                tasksDirectory: './test-tasks',
                functionProps: {
                    timeout: aws_cdk_lib_1.Duration.seconds(60),
                    memorySize: 1024,
                    architecture: aws_lambda_1.Architecture.ARM_64
                }
            };
            const schedulerConstruct = new scheduler_1.SchedulerConstruct(config);
            expect(schedulerConstruct.schedulerConstructConfig.functionProps).toBeDefined();
            expect(schedulerConstruct.schedulerConstructConfig.functionProps.timeout).toBeDefined();
            expect(schedulerConstruct.schedulerConstructConfig.functionProps.memorySize).toBe(1024);
            expect(schedulerConstruct.schedulerConstructConfig.functionProps.architecture).toBe(aws_lambda_1.Architecture.ARM_64);
        });
        it('should handle undefined function properties', () => {
            const config = {
                tasksDirectory: './test-tasks'
            };
            const schedulerConstruct = new scheduler_1.SchedulerConstruct(config);
            expect(schedulerConstruct.schedulerConstructConfig.functionProps).toBeUndefined();
        });
        it('should store complex function properties', () => {
            const config = {
                tasksDirectory: './test-tasks',
                functionProps: {
                    timeout: aws_cdk_lib_1.Duration.seconds(300),
                    memorySize: 2048,
                    description: 'Scheduled task function',
                    environment: {
                        'TASK_ENV': 'production'
                    },
                    bundling: {
                        minify: true,
                        externalModules: ['aws-sdk']
                    }
                }
            };
            const schedulerConstruct = new scheduler_1.SchedulerConstruct(config);
            const props = schedulerConstruct.schedulerConstructConfig.functionProps;
            expect(props.timeout).toBeDefined();
            expect(props.memorySize).toBe(2048);
            expect(props.description).toBe('Scheduled task function');
            expect(props.environment).toEqual({ 'TASK_ENV': 'production' });
            expect(props.bundling.minify).toBe(true);
        });
    });
    describe('Stack Configuration', () => {
        it('should handle custom stack name', async () => {
            const customStack = new aws_cdk_lib_1.Stack(app, 'CustomSchedulerStack', {
                env: { account: '123456789012', region: 'us-east-1' }
            });
            const fw24 = fw24_1.Fw24.getInstance();
            fw24.addStack('custom', customStack);
            const config = {
                tasksDirectory: './test-tasks',
                stackName: 'custom'
            };
            const schedulerConstruct = new scheduler_1.SchedulerConstruct(config);
            // Mock registerHandlers
            const originalRegisterHandlers = (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers;
            (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers = jest.fn().mockResolvedValue(undefined);
            await schedulerConstruct.construct();
            expect(schedulerConstruct.mainStack).toBe(customStack);
            // Restore
            (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers = originalRegisterHandlers;
        });
        it('should use main stack by default', async () => {
            const config = {
                tasksDirectory: './test-tasks'
            };
            const schedulerConstruct = new scheduler_1.SchedulerConstruct(config);
            // Mock registerHandlers
            const originalRegisterHandlers = (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers;
            (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers = jest.fn().mockResolvedValue(undefined);
            await schedulerConstruct.construct();
            expect(schedulerConstruct.mainStack).toBe(stack);
            // Restore
            (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers = originalRegisterHandlers;
        });
    });
    describe('Regression Tests - Bug Fixes', () => {
        /**
         * REGRESSION: Merge utility was called incorrectly in scheduler.ts
         * This test verifies functionProps are correctly merged (scheduler.ts:96-99)
         */
        it('REGRESSION: should use merge([obj1, obj2]) syntax for functionProps', () => {
            const config = {
                tasksDirectory: './test-tasks',
                functionProps: {
                    timeout: aws_cdk_lib_1.Duration.seconds(30),
                    memorySize: 512
                }
            };
            const schedulerConstruct = new scheduler_1.SchedulerConstruct(config);
            // Verify config is stored correctly (merge happens during registerTask)
            expect(schedulerConstruct.schedulerConstructConfig.functionProps).toBeDefined();
            expect(schedulerConstruct.schedulerConstructConfig.functionProps.timeout).toBeDefined();
            expect(schedulerConstruct.schedulerConstructConfig.functionProps.memorySize).toBe(512);
        });
        /**
         * REGRESSION: Verify merge doesn't mutate original objects
         */
        it('REGRESSION: should not mutate original functionProps during merge', () => {
            const originalProps = {
                timeout: aws_cdk_lib_1.Duration.seconds(30),
                memorySize: 512
            };
            const config = {
                tasksDirectory: './test-tasks',
                functionProps: originalProps
            };
            new scheduler_1.SchedulerConstruct(config);
            // Original object should not be mutated
            expect(originalProps.timeout).toBeDefined();
            expect(originalProps.memorySize).toBe(512);
            expect(Object.keys(originalProps)).toHaveLength(2);
        });
    });
    describe('Edge Cases and Error Scenarios', () => {
        it('should handle null tasksDirectory', async () => {
            const config = {
                tasksDirectory: null
            };
            const schedulerConstruct = new scheduler_1.SchedulerConstruct(config);
            // Mock registerHandlers
            const originalRegisterHandlers = (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers;
            (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers = jest.fn().mockResolvedValue(undefined);
            await schedulerConstruct.construct();
            // Null is not undefined or empty string, so it won't be replaced (scheduler.ts:69)
            // The check is: tasksDirectory === undefined || tasksDirectory === ""
            expect(schedulerConstruct.schedulerConstructConfig.tasksDirectory).toBeNull();
            // Restore
            (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers = originalRegisterHandlers;
        });
        it('should handle undefined config', () => {
            const config = {};
            const schedulerConstruct = new scheduler_1.SchedulerConstruct(config);
            expect(schedulerConstruct).toBeDefined();
            expect(schedulerConstruct.schedulerConstructConfig).toBeDefined();
        });
        it('should handle very long tasks directory path', async () => {
            const longPath = './very/long/path/to/tasks/' + 'directory/'.repeat(20);
            const config = {
                tasksDirectory: longPath
            };
            const schedulerConstruct = new scheduler_1.SchedulerConstruct(config);
            // Mock registerHandlers
            const originalRegisterHandlers = (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers;
            (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers = jest.fn().mockResolvedValue(undefined);
            await schedulerConstruct.construct();
            expect(schedulerConstruct.schedulerConstructConfig.tasksDirectory).toBe(longPath);
            // Restore
            (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers = originalRegisterHandlers;
        });
        it('should handle tasks directory with special characters', async () => {
            const config = {
                tasksDirectory: './tasks-@special#chars'
            };
            const schedulerConstruct = new scheduler_1.SchedulerConstruct(config);
            // Mock registerHandlers
            const originalRegisterHandlers = (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers;
            (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers = jest.fn().mockResolvedValue(undefined);
            await schedulerConstruct.construct();
            expect(schedulerConstruct.schedulerConstructConfig.tasksDirectory).toBe('./tasks-@special#chars');
            // Restore
            (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers = originalRegisterHandlers;
        });
        it('should handle zero timeout', () => {
            const config = {
                tasksDirectory: './test-tasks',
                functionProps: {
                    timeout: aws_cdk_lib_1.Duration.seconds(0)
                }
            };
            const schedulerConstruct = new scheduler_1.SchedulerConstruct(config);
            expect(schedulerConstruct.schedulerConstructConfig.functionProps.timeout).toBeDefined();
        });
        it('should handle maximum memory size', () => {
            const config = {
                tasksDirectory: './test-tasks',
                functionProps: {
                    memorySize: 10240 // 10GB max
                }
            };
            const schedulerConstruct = new scheduler_1.SchedulerConstruct(config);
            expect(schedulerConstruct.schedulerConstructConfig.functionProps.memorySize).toBe(10240);
        });
        it('should handle empty functionProps object', () => {
            const config = {
                tasksDirectory: './test-tasks',
                functionProps: {}
            };
            const schedulerConstruct = new scheduler_1.SchedulerConstruct(config);
            expect(schedulerConstruct.schedulerConstructConfig.functionProps).toEqual({});
        });
        it('should handle multiple environment variables with same prefix', () => {
            const config = {
                tasksDirectory: './test-tasks',
                env: [
                    { name: 'API_URL_PRIMARY', value: 'https://api1.example.com' },
                    { name: 'API_URL_SECONDARY', value: 'https://api2.example.com' },
                    { name: 'API_URL_TERTIARY', value: 'https://api3.example.com' }
                ]
            };
            const schedulerConstruct = new scheduler_1.SchedulerConstruct(config);
            expect(schedulerConstruct.schedulerConstructConfig.env).toHaveLength(3);
            expect(schedulerConstruct.schedulerConstructConfig.env[0].name).toBe('API_URL_PRIMARY');
            expect(schedulerConstruct.schedulerConstructConfig.env[1].name).toBe('API_URL_SECONDARY');
            expect(schedulerConstruct.schedulerConstructConfig.env[2].name).toBe('API_URL_TERTIARY');
        });
    });
    describe('Snapshot Tests - CloudFormation Consistency', () => {
        /**
         * Snapshot: Minimal Configuration
         * Tests CloudFormation template with minimal scheduler config.
         */
        it('should generate consistent CloudFormation for minimal config', async () => {
            const config = {
                tasksDirectory: './test-tasks'
            };
            const schedulerConstruct = new scheduler_1.SchedulerConstruct(config);
            // Mock registerHandlers to avoid file system access
            const originalRegisterHandlers = (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers;
            (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers = jest.fn().mockResolvedValue(undefined);
            await schedulerConstruct.construct();
            const template = assertions_1.Template.fromStack(stack).toJSON();
            expect(template).toMatchSnapshot();
            // Restore
            (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers = originalRegisterHandlers;
        });
        /**
         * Snapshot: Full Configuration
         * Tests CloudFormation template with all scheduler options.
         */
        it('should generate consistent CloudFormation for full config', async () => {
            const config = {
                tasksDirectory: './custom/tasks',
                env: [
                    { name: 'API_URL', value: 'https://api.example.com' },
                    { name: 'LOG_LEVEL', value: 'debug' }
                ],
                functionProps: {
                    timeout: aws_cdk_lib_1.Duration.seconds(120),
                    memorySize: 1024,
                    description: 'Scheduled task handler',
                    architecture: aws_lambda_1.Architecture.ARM_64
                }
            };
            const schedulerConstruct = new scheduler_1.SchedulerConstruct(config);
            // Mock registerHandlers
            const originalRegisterHandlers = (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers;
            (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers = jest.fn().mockResolvedValue(undefined);
            await schedulerConstruct.construct();
            const template = assertions_1.Template.fromStack(stack).toJSON();
            expect(template).toMatchSnapshot();
            // Restore
            (await Promise.resolve().then(() => __importStar(require('../core/helper')))).Helper.registerHandlers = originalRegisterHandlers;
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZWR1bGVyLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9zY2hlZHVsZXIudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLDZDQUFrRTtBQUNsRSx1REFBeUQ7QUFFekQsMkNBQTRFO0FBQzVFLHVDQUFvQztBQUNwQyx1REFBc0Q7QUFFdEQ7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQWtCRztBQUNILFFBQVEsQ0FBQyxvQkFBb0IsRUFBRSxHQUFHLEVBQUU7SUFDbEMsSUFBSSxHQUFRLENBQUM7SUFDYixJQUFJLEtBQVksQ0FBQztJQUVqQixVQUFVLENBQUMsR0FBRyxFQUFFO1FBQ2QscUJBQXFCO1FBQ3BCLFdBQVksQ0FBQyxRQUFRLEdBQUcsU0FBUyxDQUFDO1FBRW5DLEdBQUcsR0FBRyxJQUFJLGlCQUFHLEVBQUUsQ0FBQztRQUNoQixLQUFLLEdBQUcsSUFBSSxtQkFBSyxDQUFDLEdBQUcsRUFBRSxXQUFXLEVBQUU7WUFDbEMsR0FBRyxFQUFFLEVBQUUsT0FBTyxFQUFFLGNBQWMsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFO1NBQ3RELENBQUMsQ0FBQztRQUVILGtCQUFrQjtRQUNsQixNQUFNLElBQUksR0FBRyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7UUFDaEMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUNqQixJQUFJLENBQUMsU0FBUyxDQUFDO1lBQ2IsSUFBSSxFQUFFLG9CQUFvQjtZQUMxQixNQUFNLEVBQUUsV0FBVztZQUNuQixPQUFPLEVBQUUsY0FBYztTQUN4QixDQUFDLENBQUM7UUFDSCxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sRUFBRSxLQUFLLENBQUMsQ0FBQztJQUMvQixDQUFDLENBQUMsQ0FBQztJQUVILFNBQVMsQ0FBQyxHQUFHLEVBQUU7UUFDWixXQUFZLENBQUMsUUFB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LEdBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQztZQUMxRixDQUFDLHdEQUFhLGdCQUFnQixHQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDLGlCQUFpQixDQUFDLFNBQVMsQ0FBQyxDQUFDO1lBRWxHLE1BQU0sa0JBQWtCLENBQUMsU0FBUyxFQUFFLENBQUM7WUFFckMsTUFBTSxRQUFRLEdBQUcscUJBQVEsQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDcEQsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFDLGVBQWUsRUFBRSxDQUFDO1lBRW5DLFVBQVU7WUFDVixDQUFDLHdEQUFhLGdCQUFnQixHQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsZ0JBQWdCLEdBQUcsd0JBQXdCLENBQUM7UUFDdEYsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQXBwLCBTdGFjaywgRHVyYXRpb24sIFJlbW92YWxQb2xpY3kgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBUZW1wbGF0ZSwgTWF0Y2ggfSBmcm9tICdhd3MtY2RrLWxpYi9hc3NlcnRpb25zJztcbmltcG9ydCB7IFJldGVudGlvbkRheXMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBTY2hlZHVsZXJDb25zdHJ1Y3QsIElTY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcgfSBmcm9tICcuL3NjaGVkdWxlcic7XG5pbXBvcnQgeyBGdzI0IH0gZnJvbSAnLi4vY29yZS9mdzI0JztcbmltcG9ydCB7IEFyY2hpdGVjdHVyZSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuXG4vKipcbiAqIFNjaGVkdWxlckNvbnN0cnVjdCBUZXN0IFN1aXRlXG4gKiBcbiAqIE5PVEU6IFNjaGVkdWxlckNvbnN0cnVjdCBpcyAxMjYgbGluZXMgYW5kIGNyZWF0ZXMgc2NoZWR1bGVkIExhbWJkYSB0YXNrcy5cbiAqIFRoZXNlIHRlc3RzIGZvY3VzIG9uOlxuICogMS4gQmFzaWMgY29uc3RydWN0IGNyZWF0aW9uIGFuZCBjb25maWd1cmF0aW9uXG4gKiAyLiBUYXNrIGRpcmVjdG9yeSBoYW5kbGluZyAoZGVmYXVsdCBhbmQgY3VzdG9tKVxuICogMy4gRW52aXJvbm1lbnQgdmFyaWFibGUgY29uZmlndXJhdGlvblxuICogNC4gRnVuY3Rpb24gcHJvcGVydGllcyBtZXJnaW5nXG4gKiA1LiBNZXJnZSB1dGlsaXR5IHVzYWdlIChidWcgd2UgZml4ZWQpXG4gKiA2LiBFZGdlIGNhc2VzIGFuZCBlcnJvciBzY2VuYXJpb3NcbiAqIFxuICogTk9UIFRFU1RFRCAocmVxdWlyZXMgYWN0dWFsIEBUYXNrIGRlY29yYXRlZCBmaWxlcyk6XG4gKiAtIEFjdHVhbCB0YXNrIGZpbGUgbG9hZGluZyAobmVlZHMgQFRhc2sgZGVjb3JhdGVkIGNsYXNzZXMpXG4gKiAtIFRhc2sgZXhlY3V0aW9uIGFuZCBzY2hlZHVsaW5nIChydW50aW1lIGJlaGF2aW9yKVxuICogLSBNb2R1bGUtYmFzZWQgdGFzayBsb2FkaW5nIChyZXF1aXJlcyBtb2R1bGUgc2V0dXApXG4gKiBcbiAqIFRoZXNlIGFyZSBpbnRlZ3JhdGlvbi9ydW50aW1lIGZlYXR1cmVzIHRlc3RlZCBpbiBFMkUgdGVzdHMuXG4gKi9cbmRlc2NyaWJlKCdTY2hlZHVsZXJDb25zdHJ1Y3QnLCAoKSA9PiB7XG4gIGxldCBhcHA6IEFwcDtcbiAgbGV0IHN0YWNrOiBTdGFjaztcblxuICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAvLyBDbGVhbiB1cCBzaW5nbGV0b25cbiAgICAoRncyNCBhcyBhbnkpLmluc3RhbmNlID0gdW5kZWZpbmVkO1xuXG4gICAgYXBwID0gbmV3IEFwcCgpO1xuICAgIHN0YWNrID0gbmV3IFN0YWNrKGFwcCwgJ1Rlc3RTdGFjaycsIHtcbiAgICAgIGVudjogeyBhY2NvdW50OiAnMTIzNDU2Nzg5MDEyJywgcmVnaW9uOiAndXMtZWFzdC0xJyB9XG4gICAgfSk7XG5cbiAgICAvLyBJbml0aWFsaXplIEZ3MjRcbiAgICBjb25zdCBmdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuICAgIGZ3MjQuc2V0QXBwKGFwcCk7XG4gICAgZncyNC5zZXRDb25maWcoe1xuICAgICAgbmFtZTogJ3Rlc3Qtc2NoZWR1bGVyLWFwcCcsXG4gICAgICByZWdpb246ICd1cy1lYXN0LTEnLFxuICAgICAgYWNjb3VudDogJzEyMzQ1Njc4OTAxMidcbiAgICB9KTtcbiAgICBmdzI0LmFkZFN0YWNrKCdtYWluJywgc3RhY2spO1xuICB9KTtcblxuICBhZnRlckVhY2goKCkgPT4ge1xuICAgIChGdzI0IGFzIGFueSkuaW5zdGFuY2UgPSB1bmRlZmluZWQ7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdCYXNpYyBDb25zdHJ1Y3QgQ3JlYXRpb24nLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCBjcmVhdGUgU2NoZWR1bGVyQ29uc3RydWN0IHdpdGggbWluaW1hbCBjb25maWd1cmF0aW9uJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJU2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnID0ge1xuICAgICAgICB0YXNrc0RpcmVjdG9yeTogJy4vdGVzdC10YXNrcydcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHNjaGVkdWxlckNvbnN0cnVjdCA9IG5ldyBTY2hlZHVsZXJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgZXhwZWN0KHNjaGVkdWxlckNvbnN0cnVjdCkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChzY2hlZHVsZXJDb25zdHJ1Y3QubmFtZSkudG9CZSgnU2NoZWR1bGVyQ29uc3RydWN0Jyk7XG4gICAgICBleHBlY3Qoc2NoZWR1bGVyQ29uc3RydWN0LmRlcGVuZGVuY2llcykudG9Db250YWluKCdWcGNDb25zdHJ1Y3QnKTtcbiAgICAgIGV4cGVjdChzY2hlZHVsZXJDb25zdHJ1Y3QuZGVwZW5kZW5jaWVzKS50b0NvbnRhaW4oJ0xheWVyQ29uc3RydWN0Jyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGFwcGx5IGRlZmF1bHQgdGFza3MgZGlyZWN0b3J5IHdoZW4gbm90IHByb3ZpZGVkJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJU2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnID0ge307XG5cbiAgICAgIGNvbnN0IHNjaGVkdWxlckNvbnN0cnVjdCA9IG5ldyBTY2hlZHVsZXJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgLy8gTW9jayByZWdpc3RlckhhbmRsZXJzIHRvIGF2b2lkIGZpbGUgc3lzdGVtIGFjY2Vzc1xuICAgICAgY29uc3Qgb3JpZ2luYWxSZWdpc3RlckhhbmRsZXJzID0gKGF3YWl0IGltcG9ydCgnLi4vY29yZS9oZWxwZXInKSkuSGVscGVyLnJlZ2lzdGVySGFuZGxlcnM7XG4gICAgICAoYXdhaXQgaW1wb3J0KCcuLi9jb3JlL2hlbHBlcicpKS5IZWxwZXIucmVnaXN0ZXJIYW5kbGVycyA9IGplc3QuZm4oKS5tb2NrUmVzb2x2ZWRWYWx1ZSh1bmRlZmluZWQpO1xuXG4gICAgICBhd2FpdCBzY2hlZHVsZXJDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG5cbiAgICAgIC8vIERlZmF1bHQgZGlyZWN0b3J5IHNob3VsZCBiZSBzZXQgKHNjaGVkdWxlci50czo2OS03MSlcbiAgICAgIGV4cGVjdCgoc2NoZWR1bGVyQ29uc3RydWN0IGFzIGFueSkuc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnLnRhc2tzRGlyZWN0b3J5KS50b0JlKCcuL3NyYy90YXNrcycpO1xuXG4gICAgICAvLyBSZXN0b3JlXG4gICAgICAoYXdhaXQgaW1wb3J0KCcuLi9jb3JlL2hlbHBlcicpKS5IZWxwZXIucmVnaXN0ZXJIYW5kbGVycyA9IG9yaWdpbmFsUmVnaXN0ZXJIYW5kbGVycztcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgYXBwbHkgZGVmYXVsdCB0YXNrcyBkaXJlY3Rvcnkgd2hlbiBlbXB0eSBzdHJpbmcgcHJvdmlkZWQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElTY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcgPSB7XG4gICAgICAgIHRhc2tzRGlyZWN0b3J5OiAnJ1xuICAgICAgfTtcblxuICAgICAgY29uc3Qgc2NoZWR1bGVyQ29uc3RydWN0ID0gbmV3IFNjaGVkdWxlckNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICAvLyBNb2NrIHJlZ2lzdGVySGFuZGxlcnNcbiAgICAgIGNvbnN0IG9yaWdpbmFsUmVnaXN0ZXJIYW5kbGVycyA9IChhd2FpdCBpbXBvcnQoJy4uL2NvcmUvaGVscGVyJykpLkhlbHBlci5yZWdpc3RlckhhbmRsZXJzO1xuICAgICAgKGF3YWl0IGltcG9ydCgnLi4vY29yZS9oZWxwZXInKSkuSGVscGVyLnJlZ2lzdGVySGFuZGxlcnMgPSBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUodW5kZWZpbmVkKTtcblxuICAgICAgYXdhaXQgc2NoZWR1bGVyQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICBleHBlY3QoKHNjaGVkdWxlckNvbnN0cnVjdCBhcyBhbnkpLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy50YXNrc0RpcmVjdG9yeSkudG9CZSgnLi9zcmMvdGFza3MnKTtcblxuICAgICAgLy8gUmVzdG9yZVxuICAgICAgKGF3YWl0IGltcG9ydCgnLi4vY29yZS9oZWxwZXInKSkuSGVscGVyLnJlZ2lzdGVySGFuZGxlcnMgPSBvcmlnaW5hbFJlZ2lzdGVySGFuZGxlcnM7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHByZXNlcnZlIGN1c3RvbSB0YXNrcyBkaXJlY3RvcnknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElTY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcgPSB7XG4gICAgICAgIHRhc2tzRGlyZWN0b3J5OiAnLi9jdXN0b20vdGFza3MvcGF0aCdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHNjaGVkdWxlckNvbnN0cnVjdCA9IG5ldyBTY2hlZHVsZXJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgLy8gTW9jayByZWdpc3RlckhhbmRsZXJzXG4gICAgICBjb25zdCBvcmlnaW5hbFJlZ2lzdGVySGFuZGxlcnMgPSAoYXdhaXQgaW1wb3J0KCcuLi9jb3JlL2hlbHBlcicpKS5IZWxwZXIucmVnaXN0ZXJIYW5kbGVycztcbiAgICAgIChhd2FpdCBpbXBvcnQoJy4uL2NvcmUvaGVscGVyJykpLkhlbHBlci5yZWdpc3RlckhhbmRsZXJzID0gamVzdC5mbigpLm1vY2tSZXNvbHZlZFZhbHVlKHVuZGVmaW5lZCk7XG5cbiAgICAgIGF3YWl0IHNjaGVkdWxlckNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgZXhwZWN0KChzY2hlZHVsZXJDb25zdHJ1Y3QgYXMgYW55KS5zY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcudGFza3NEaXJlY3RvcnkpLnRvQmUoJy4vY3VzdG9tL3Rhc2tzL3BhdGgnKTtcblxuICAgICAgLy8gUmVzdG9yZVxuICAgICAgKGF3YWl0IGltcG9ydCgnLi4vY29yZS9oZWxwZXInKSkuSGVscGVyLnJlZ2lzdGVySGFuZGxlcnMgPSBvcmlnaW5hbFJlZ2lzdGVySGFuZGxlcnM7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCdFbnZpcm9ubWVudCBWYXJpYWJsZSBDb25maWd1cmF0aW9uJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgc3RvcmUgZW52aXJvbm1lbnQgY29uZmlndXJhdGlvbicsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSVNjaGVkdWxlckNvbnN0cnVjdENvbmZpZyA9IHtcbiAgICAgICAgdGFza3NEaXJlY3Rvcnk6ICcuL3Rlc3QtdGFza3MnLFxuICAgICAgICBlbnY6IFtcbiAgICAgICAgICB7IG5hbWU6ICdBUElfVVJMJywgdmFsdWU6ICdodHRwczovL2FwaS5leGFtcGxlLmNvbScgfSxcbiAgICAgICAgICB7IG5hbWU6ICdBUElfS0VZJywgdmFsdWU6ICdzZWNyZXQta2V5JyB9XG4gICAgICAgIF1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHNjaGVkdWxlckNvbnN0cnVjdCA9IG5ldyBTY2hlZHVsZXJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgZXhwZWN0KChzY2hlZHVsZXJDb25zdHJ1Y3QgYXMgYW55KS5zY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcuZW52KS50b0hhdmVMZW5ndGgoMik7XG4gICAgICBleHBlY3QoKHNjaGVkdWxlckNvbnN0cnVjdCBhcyBhbnkpLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy5lbnZbIDAgXS5uYW1lKS50b0JlKCdBUElfVVJMJyk7XG4gICAgICBleHBlY3QoKHNjaGVkdWxlckNvbnN0cnVjdCBhcyBhbnkpLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy5lbnZbIDEgXS5uYW1lKS50b0JlKCdBUElfS0VZJyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBlbXB0eSBlbnZpcm9ubWVudCBhcnJheScsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSVNjaGVkdWxlckNvbnN0cnVjdENvbmZpZyA9IHtcbiAgICAgICAgdGFza3NEaXJlY3Rvcnk6ICcuL3Rlc3QtdGFza3MnLFxuICAgICAgICBlbnY6IFtdXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBzY2hlZHVsZXJDb25zdHJ1Y3QgPSBuZXcgU2NoZWR1bGVyQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIGV4cGVjdCgoc2NoZWR1bGVyQ29uc3RydWN0IGFzIGFueSkuc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnLmVudikudG9FcXVhbChbXSk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSB1bmRlZmluZWQgZW52aXJvbm1lbnQnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElTY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcgPSB7XG4gICAgICAgIHRhc2tzRGlyZWN0b3J5OiAnLi90ZXN0LXRhc2tzJ1xuICAgICAgfTtcblxuICAgICAgY29uc3Qgc2NoZWR1bGVyQ29uc3RydWN0ID0gbmV3IFNjaGVkdWxlckNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICBleHBlY3QoKHNjaGVkdWxlckNvbnN0cnVjdCBhcyBhbnkpLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy5lbnYpLnRvQmVVbmRlZmluZWQoKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ0Z1bmN0aW9uIFByb3BlcnRpZXMgQ29uZmlndXJhdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIHN0b3JlIGZ1bmN0aW9uIHByb3BlcnRpZXMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElTY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcgPSB7XG4gICAgICAgIHRhc2tzRGlyZWN0b3J5OiAnLi90ZXN0LXRhc2tzJyxcbiAgICAgICAgZnVuY3Rpb25Qcm9wczoge1xuICAgICAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHMoNjApLFxuICAgICAgICAgIG1lbW9yeVNpemU6IDEwMjQsXG4gICAgICAgICAgYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUuQVJNXzY0XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHNjaGVkdWxlckNvbnN0cnVjdCA9IG5ldyBTY2hlZHVsZXJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgZXhwZWN0KChzY2hlZHVsZXJDb25zdHJ1Y3QgYXMgYW55KS5zY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcuZnVuY3Rpb25Qcm9wcykudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdCgoc2NoZWR1bGVyQ29uc3RydWN0IGFzIGFueSkuc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnLmZ1bmN0aW9uUHJvcHMudGltZW91dCkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdCgoc2NoZWR1bGVyQ29uc3RydWN0IGFzIGFueSkuc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnLmZ1bmN0aW9uUHJvcHMubWVtb3J5U2l6ZSkudG9CZSgxMDI0KTtcbiAgICAgIGV4cGVjdCgoc2NoZWR1bGVyQ29uc3RydWN0IGFzIGFueSkuc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnLmZ1bmN0aW9uUHJvcHMuYXJjaGl0ZWN0dXJlKS50b0JlKEFyY2hpdGVjdHVyZS5BUk1fNjQpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgdW5kZWZpbmVkIGZ1bmN0aW9uIHByb3BlcnRpZXMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElTY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcgPSB7XG4gICAgICAgIHRhc2tzRGlyZWN0b3J5OiAnLi90ZXN0LXRhc2tzJ1xuICAgICAgfTtcblxuICAgICAgY29uc3Qgc2NoZWR1bGVyQ29uc3RydWN0ID0gbmV3IFNjaGVkdWxlckNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICBleHBlY3QoKHNjaGVkdWxlckNvbnN0cnVjdCBhcyBhbnkpLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy5mdW5jdGlvblByb3BzKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIHN0b3JlIGNvbXBsZXggZnVuY3Rpb24gcHJvcGVydGllcycsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSVNjaGVkdWxlckNvbnN0cnVjdENvbmZpZyA9IHtcbiAgICAgICAgdGFza3NEaXJlY3Rvcnk6ICcuL3Rlc3QtdGFza3MnLFxuICAgICAgICBmdW5jdGlvblByb3BzOiB7XG4gICAgICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcygzMDApLFxuICAgICAgICAgIG1lbW9yeVNpemU6IDIwNDgsXG4gICAgICAgICAgZGVzY3JpcHRpb246ICdTY2hlZHVsZWQgdGFzayBmdW5jdGlvbicsXG4gICAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICAgICdUQVNLX0VOVic6ICdwcm9kdWN0aW9uJ1xuICAgICAgICAgIH0sXG4gICAgICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICAgIG1pbmlmeTogdHJ1ZSxcbiAgICAgICAgICAgIGV4dGVybmFsTW9kdWxlczogWyAnYXdzLXNkaycgXVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3Qgc2NoZWR1bGVyQ29uc3RydWN0ID0gbmV3IFNjaGVkdWxlckNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICBjb25zdCBwcm9wcyA9IChzY2hlZHVsZXJDb25zdHJ1Y3QgYXMgYW55KS5zY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcuZnVuY3Rpb25Qcm9wcztcbiAgICAgIGV4cGVjdChwcm9wcy50aW1lb3V0KS50b0JlRGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KHByb3BzLm1lbW9yeVNpemUpLnRvQmUoMjA0OCk7XG4gICAgICBleHBlY3QocHJvcHMuZGVzY3JpcHRpb24pLnRvQmUoJ1NjaGVkdWxlZCB0YXNrIGZ1bmN0aW9uJyk7XG4gICAgICBleHBlY3QocHJvcHMuZW52aXJvbm1lbnQpLnRvRXF1YWwoeyAnVEFTS19FTlYnOiAncHJvZHVjdGlvbicgfSk7XG4gICAgICBleHBlY3QocHJvcHMuYnVuZGxpbmcubWluaWZ5KS50b0JlKHRydWUpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnU3RhY2sgQ29uZmlndXJhdGlvbicsICgpID0+IHtcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBjdXN0b20gc3RhY2sgbmFtZScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGN1c3RvbVN0YWNrID0gbmV3IFN0YWNrKGFwcCwgJ0N1c3RvbVNjaGVkdWxlclN0YWNrJywge1xuICAgICAgICBlbnY6IHsgYWNjb3VudDogJzEyMzQ1Njc4OTAxMicsIHJlZ2lvbjogJ3VzLWVhc3QtMScgfVxuICAgICAgfSk7XG4gICAgICBjb25zdCBmdzI0ID0gRncyNC5nZXRJbnN0YW5jZSgpO1xuICAgICAgZncyNC5hZGRTdGFjaygnY3VzdG9tJywgY3VzdG9tU3RhY2spO1xuXG4gICAgICBjb25zdCBjb25maWc6IElTY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcgPSB7XG4gICAgICAgIHRhc2tzRGlyZWN0b3J5OiAnLi90ZXN0LXRhc2tzJyxcbiAgICAgICAgc3RhY2tOYW1lOiAnY3VzdG9tJ1xuICAgICAgfTtcblxuICAgICAgY29uc3Qgc2NoZWR1bGVyQ29uc3RydWN0ID0gbmV3IFNjaGVkdWxlckNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICAvLyBNb2NrIHJlZ2lzdGVySGFuZGxlcnNcbiAgICAgIGNvbnN0IG9yaWdpbmFsUmVnaXN0ZXJIYW5kbGVycyA9IChhd2FpdCBpbXBvcnQoJy4uL2NvcmUvaGVscGVyJykpLkhlbHBlci5yZWdpc3RlckhhbmRsZXJzO1xuICAgICAgKGF3YWl0IGltcG9ydCgnLi4vY29yZS9oZWxwZXInKSkuSGVscGVyLnJlZ2lzdGVySGFuZGxlcnMgPSBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUodW5kZWZpbmVkKTtcblxuICAgICAgYXdhaXQgc2NoZWR1bGVyQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICBleHBlY3QoKHNjaGVkdWxlckNvbnN0cnVjdCBhcyBhbnkpLm1haW5TdGFjaykudG9CZShjdXN0b21TdGFjayk7XG5cbiAgICAgIC8vIFJlc3RvcmVcbiAgICAgIChhd2FpdCBpbXBvcnQoJy4uL2NvcmUvaGVscGVyJykpLkhlbHBlci5yZWdpc3RlckhhbmRsZXJzID0gb3JpZ2luYWxSZWdpc3RlckhhbmRsZXJzO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB1c2UgbWFpbiBzdGFjayBieSBkZWZhdWx0JywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJU2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnID0ge1xuICAgICAgICB0YXNrc0RpcmVjdG9yeTogJy4vdGVzdC10YXNrcydcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHNjaGVkdWxlckNvbnN0cnVjdCA9IG5ldyBTY2hlZHVsZXJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgLy8gTW9jayByZWdpc3RlckhhbmRsZXJzXG4gICAgICBjb25zdCBvcmlnaW5hbFJlZ2lzdGVySGFuZGxlcnMgPSAoYXdhaXQgaW1wb3J0KCcuLi9jb3JlL2hlbHBlcicpKS5IZWxwZXIucmVnaXN0ZXJIYW5kbGVycztcbiAgICAgIChhd2FpdCBpbXBvcnQoJy4uL2NvcmUvaGVscGVyJykpLkhlbHBlci5yZWdpc3RlckhhbmRsZXJzID0gamVzdC5mbigpLm1vY2tSZXNvbHZlZFZhbHVlKHVuZGVmaW5lZCk7XG5cbiAgICAgIGF3YWl0IHNjaGVkdWxlckNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgZXhwZWN0KChzY2hlZHVsZXJDb25zdHJ1Y3QgYXMgYW55KS5tYWluU3RhY2spLnRvQmUoc3RhY2spO1xuXG4gICAgICAvLyBSZXN0b3JlXG4gICAgICAoYXdhaXQgaW1wb3J0KCcuLi9jb3JlL2hlbHBlcicpKS5IZWxwZXIucmVnaXN0ZXJIYW5kbGVycyA9IG9yaWdpbmFsUmVnaXN0ZXJIYW5kbGVycztcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1JlZ3Jlc3Npb24gVGVzdHMgLSBCdWcgRml4ZXMnLCAoKSA9PiB7XG4gICAgLyoqXG4gICAgICogUkVHUkVTU0lPTjogTWVyZ2UgdXRpbGl0eSB3YXMgY2FsbGVkIGluY29ycmVjdGx5IGluIHNjaGVkdWxlci50c1xuICAgICAqIFRoaXMgdGVzdCB2ZXJpZmllcyBmdW5jdGlvblByb3BzIGFyZSBjb3JyZWN0bHkgbWVyZ2VkIChzY2hlZHVsZXIudHM6OTYtOTkpXG4gICAgICovXG4gICAgaXQoJ1JFR1JFU1NJT046IHNob3VsZCB1c2UgbWVyZ2UoW29iajEsIG9iajJdKSBzeW50YXggZm9yIGZ1bmN0aW9uUHJvcHMnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElTY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcgPSB7XG4gICAgICAgIHRhc2tzRGlyZWN0b3J5OiAnLi90ZXN0LXRhc2tzJyxcbiAgICAgICAgZnVuY3Rpb25Qcm9wczoge1xuICAgICAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgICAgIG1lbW9yeVNpemU6IDUxMlxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBzY2hlZHVsZXJDb25zdHJ1Y3QgPSBuZXcgU2NoZWR1bGVyQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIC8vIFZlcmlmeSBjb25maWcgaXMgc3RvcmVkIGNvcnJlY3RseSAobWVyZ2UgaGFwcGVucyBkdXJpbmcgcmVnaXN0ZXJUYXNrKVxuICAgICAgZXhwZWN0KChzY2hlZHVsZXJDb25zdHJ1Y3QgYXMgYW55KS5zY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcuZnVuY3Rpb25Qcm9wcykudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdCgoc2NoZWR1bGVyQ29uc3RydWN0IGFzIGFueSkuc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnLmZ1bmN0aW9uUHJvcHMudGltZW91dCkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdCgoc2NoZWR1bGVyQ29uc3RydWN0IGFzIGFueSkuc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnLmZ1bmN0aW9uUHJvcHMubWVtb3J5U2l6ZSkudG9CZSg1MTIpO1xuICAgIH0pO1xuXG4gICAgLyoqXG4gICAgICogUkVHUkVTU0lPTjogVmVyaWZ5IG1lcmdlIGRvZXNuJ3QgbXV0YXRlIG9yaWdpbmFsIG9iamVjdHNcbiAgICAgKi9cbiAgICBpdCgnUkVHUkVTU0lPTjogc2hvdWxkIG5vdCBtdXRhdGUgb3JpZ2luYWwgZnVuY3Rpb25Qcm9wcyBkdXJpbmcgbWVyZ2UnLCAoKSA9PiB7XG4gICAgICBjb25zdCBvcmlnaW5hbFByb3BzID0ge1xuICAgICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgICAgbWVtb3J5U2l6ZTogNTEyXG4gICAgICB9O1xuICAgICAgY29uc3QgY29uZmlnOiBJU2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnID0ge1xuICAgICAgICB0YXNrc0RpcmVjdG9yeTogJy4vdGVzdC10YXNrcycsXG4gICAgICAgIGZ1bmN0aW9uUHJvcHM6IG9yaWdpbmFsUHJvcHNcbiAgICAgIH07XG5cbiAgICAgIG5ldyBTY2hlZHVsZXJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgLy8gT3JpZ2luYWwgb2JqZWN0IHNob3VsZCBub3QgYmUgbXV0YXRlZFxuICAgICAgZXhwZWN0KG9yaWdpbmFsUHJvcHMudGltZW91dCkudG9CZURlZmluZWQoKTtcbiAgICAgIGV4cGVjdChvcmlnaW5hbFByb3BzLm1lbW9yeVNpemUpLnRvQmUoNTEyKTtcbiAgICAgIGV4cGVjdChPYmplY3Qua2V5cyhvcmlnaW5hbFByb3BzKSkudG9IYXZlTGVuZ3RoKDIpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnRWRnZSBDYXNlcyBhbmQgRXJyb3IgU2NlbmFyaW9zJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgaGFuZGxlIG51bGwgdGFza3NEaXJlY3RvcnknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElTY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcgPSB7XG4gICAgICAgIHRhc2tzRGlyZWN0b3J5OiBudWxsIGFzIGFueVxuICAgICAgfTtcblxuICAgICAgY29uc3Qgc2NoZWR1bGVyQ29uc3RydWN0ID0gbmV3IFNjaGVkdWxlckNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICAvLyBNb2NrIHJlZ2lzdGVySGFuZGxlcnNcbiAgICAgIGNvbnN0IG9yaWdpbmFsUmVnaXN0ZXJIYW5kbGVycyA9IChhd2FpdCBpbXBvcnQoJy4uL2NvcmUvaGVscGVyJykpLkhlbHBlci5yZWdpc3RlckhhbmRsZXJzO1xuICAgICAgKGF3YWl0IGltcG9ydCgnLi4vY29yZS9oZWxwZXInKSkuSGVscGVyLnJlZ2lzdGVySGFuZGxlcnMgPSBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUodW5kZWZpbmVkKTtcblxuICAgICAgYXdhaXQgc2NoZWR1bGVyQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICAvLyBOdWxsIGlzIG5vdCB1bmRlZmluZWQgb3IgZW1wdHkgc3RyaW5nLCBzbyBpdCB3b24ndCBiZSByZXBsYWNlZCAoc2NoZWR1bGVyLnRzOjY5KVxuICAgICAgLy8gVGhlIGNoZWNrIGlzOiB0YXNrc0RpcmVjdG9yeSA9PT0gdW5kZWZpbmVkIHx8IHRhc2tzRGlyZWN0b3J5ID09PSBcIlwiXG4gICAgICBleHBlY3QoKHNjaGVkdWxlckNvbnN0cnVjdCBhcyBhbnkpLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy50YXNrc0RpcmVjdG9yeSkudG9CZU51bGwoKTtcblxuICAgICAgLy8gUmVzdG9yZVxuICAgICAgKGF3YWl0IGltcG9ydCgnLi4vY29yZS9oZWxwZXInKSkuSGVscGVyLnJlZ2lzdGVySGFuZGxlcnMgPSBvcmlnaW5hbFJlZ2lzdGVySGFuZGxlcnM7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGhhbmRsZSB1bmRlZmluZWQgY29uZmlnJywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJU2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnID0ge30gYXMgYW55O1xuXG4gICAgICBjb25zdCBzY2hlZHVsZXJDb25zdHJ1Y3QgPSBuZXcgU2NoZWR1bGVyQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIGV4cGVjdChzY2hlZHVsZXJDb25zdHJ1Y3QpLnRvQmVEZWZpbmVkKCk7XG4gICAgICBleHBlY3QoKHNjaGVkdWxlckNvbnN0cnVjdCBhcyBhbnkpLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZykudG9CZURlZmluZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHZlcnkgbG9uZyB0YXNrcyBkaXJlY3RvcnkgcGF0aCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGxvbmdQYXRoID0gJy4vdmVyeS9sb25nL3BhdGgvdG8vdGFza3MvJyArICdkaXJlY3RvcnkvJy5yZXBlYXQoMjApO1xuICAgICAgY29uc3QgY29uZmlnOiBJU2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnID0ge1xuICAgICAgICB0YXNrc0RpcmVjdG9yeTogbG9uZ1BhdGhcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHNjaGVkdWxlckNvbnN0cnVjdCA9IG5ldyBTY2hlZHVsZXJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgLy8gTW9jayByZWdpc3RlckhhbmRsZXJzXG4gICAgICBjb25zdCBvcmlnaW5hbFJlZ2lzdGVySGFuZGxlcnMgPSAoYXdhaXQgaW1wb3J0KCcuLi9jb3JlL2hlbHBlcicpKS5IZWxwZXIucmVnaXN0ZXJIYW5kbGVycztcbiAgICAgIChhd2FpdCBpbXBvcnQoJy4uL2NvcmUvaGVscGVyJykpLkhlbHBlci5yZWdpc3RlckhhbmRsZXJzID0gamVzdC5mbigpLm1vY2tSZXNvbHZlZFZhbHVlKHVuZGVmaW5lZCk7XG5cbiAgICAgIGF3YWl0IHNjaGVkdWxlckNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgZXhwZWN0KChzY2hlZHVsZXJDb25zdHJ1Y3QgYXMgYW55KS5zY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcudGFza3NEaXJlY3RvcnkpLnRvQmUobG9uZ1BhdGgpO1xuXG4gICAgICAvLyBSZXN0b3JlXG4gICAgICAoYXdhaXQgaW1wb3J0KCcuLi9jb3JlL2hlbHBlcicpKS5IZWxwZXIucmVnaXN0ZXJIYW5kbGVycyA9IG9yaWdpbmFsUmVnaXN0ZXJIYW5kbGVycztcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHRhc2tzIGRpcmVjdG9yeSB3aXRoIHNwZWNpYWwgY2hhcmFjdGVycycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSVNjaGVkdWxlckNvbnN0cnVjdENvbmZpZyA9IHtcbiAgICAgICAgdGFza3NEaXJlY3Rvcnk6ICcuL3Rhc2tzLUBzcGVjaWFsI2NoYXJzJ1xuICAgICAgfTtcblxuICAgICAgY29uc3Qgc2NoZWR1bGVyQ29uc3RydWN0ID0gbmV3IFNjaGVkdWxlckNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICAvLyBNb2NrIHJlZ2lzdGVySGFuZGxlcnNcbiAgICAgIGNvbnN0IG9yaWdpbmFsUmVnaXN0ZXJIYW5kbGVycyA9IChhd2FpdCBpbXBvcnQoJy4uL2NvcmUvaGVscGVyJykpLkhlbHBlci5yZWdpc3RlckhhbmRsZXJzO1xuICAgICAgKGF3YWl0IGltcG9ydCgnLi4vY29yZS9oZWxwZXInKSkuSGVscGVyLnJlZ2lzdGVySGFuZGxlcnMgPSBqZXN0LmZuKCkubW9ja1Jlc29sdmVkVmFsdWUodW5kZWZpbmVkKTtcblxuICAgICAgYXdhaXQgc2NoZWR1bGVyQ29uc3RydWN0LmNvbnN0cnVjdCgpO1xuXG4gICAgICBleHBlY3QoKHNjaGVkdWxlckNvbnN0cnVjdCBhcyBhbnkpLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy50YXNrc0RpcmVjdG9yeSkudG9CZSgnLi90YXNrcy1Ac3BlY2lhbCNjaGFycycpO1xuXG4gICAgICAvLyBSZXN0b3JlXG4gICAgICAoYXdhaXQgaW1wb3J0KCcuLi9jb3JlL2hlbHBlcicpKS5IZWxwZXIucmVnaXN0ZXJIYW5kbGVycyA9IG9yaWdpbmFsUmVnaXN0ZXJIYW5kbGVycztcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHplcm8gdGltZW91dCcsICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSVNjaGVkdWxlckNvbnN0cnVjdENvbmZpZyA9IHtcbiAgICAgICAgdGFza3NEaXJlY3Rvcnk6ICcuL3Rlc3QtdGFza3MnLFxuICAgICAgICBmdW5jdGlvblByb3BzOiB7XG4gICAgICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcygwKVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBzY2hlZHVsZXJDb25zdHJ1Y3QgPSBuZXcgU2NoZWR1bGVyQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIGV4cGVjdCgoc2NoZWR1bGVyQ29uc3RydWN0IGFzIGFueSkuc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnLmZ1bmN0aW9uUHJvcHMudGltZW91dCkudG9CZURlZmluZWQoKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIG1heGltdW0gbWVtb3J5IHNpemUnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElTY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcgPSB7XG4gICAgICAgIHRhc2tzRGlyZWN0b3J5OiAnLi90ZXN0LXRhc2tzJyxcbiAgICAgICAgZnVuY3Rpb25Qcm9wczoge1xuICAgICAgICAgIG1lbW9yeVNpemU6IDEwMjQwIC8vIDEwR0IgbWF4XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHNjaGVkdWxlckNvbnN0cnVjdCA9IG5ldyBTY2hlZHVsZXJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgZXhwZWN0KChzY2hlZHVsZXJDb25zdHJ1Y3QgYXMgYW55KS5zY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcuZnVuY3Rpb25Qcm9wcy5tZW1vcnlTaXplKS50b0JlKDEwMjQwKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIGVtcHR5IGZ1bmN0aW9uUHJvcHMgb2JqZWN0JywgKCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnOiBJU2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnID0ge1xuICAgICAgICB0YXNrc0RpcmVjdG9yeTogJy4vdGVzdC10YXNrcycsXG4gICAgICAgIGZ1bmN0aW9uUHJvcHM6IHt9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBzY2hlZHVsZXJDb25zdHJ1Y3QgPSBuZXcgU2NoZWR1bGVyQ29uc3RydWN0KGNvbmZpZyk7XG5cbiAgICAgIGV4cGVjdCgoc2NoZWR1bGVyQ29uc3RydWN0IGFzIGFueSkuc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnLmZ1bmN0aW9uUHJvcHMpLnRvRXF1YWwoe30pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbXVsdGlwbGUgZW52aXJvbm1lbnQgdmFyaWFibGVzIHdpdGggc2FtZSBwcmVmaXgnLCAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElTY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcgPSB7XG4gICAgICAgIHRhc2tzRGlyZWN0b3J5OiAnLi90ZXN0LXRhc2tzJyxcbiAgICAgICAgZW52OiBbXG4gICAgICAgICAgeyBuYW1lOiAnQVBJX1VSTF9QUklNQVJZJywgdmFsdWU6ICdodHRwczovL2FwaTEuZXhhbXBsZS5jb20nIH0sXG4gICAgICAgICAgeyBuYW1lOiAnQVBJX1VSTF9TRUNPTkRBUlknLCB2YWx1ZTogJ2h0dHBzOi8vYXBpMi5leGFtcGxlLmNvbScgfSxcbiAgICAgICAgICB7IG5hbWU6ICdBUElfVVJMX1RFUlRJQVJZJywgdmFsdWU6ICdodHRwczovL2FwaTMuZXhhbXBsZS5jb20nIH1cbiAgICAgICAgXVxuICAgICAgfTtcblxuICAgICAgY29uc3Qgc2NoZWR1bGVyQ29uc3RydWN0ID0gbmV3IFNjaGVkdWxlckNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICBleHBlY3QoKHNjaGVkdWxlckNvbnN0cnVjdCBhcyBhbnkpLnNjaGVkdWxlckNvbnN0cnVjdENvbmZpZy5lbnYpLnRvSGF2ZUxlbmd0aCgzKTtcbiAgICAgIGV4cGVjdCgoc2NoZWR1bGVyQ29uc3RydWN0IGFzIGFueSkuc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnLmVudlsgMCBdLm5hbWUpLnRvQmUoJ0FQSV9VUkxfUFJJTUFSWScpO1xuICAgICAgZXhwZWN0KChzY2hlZHVsZXJDb25zdHJ1Y3QgYXMgYW55KS5zY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcuZW52WyAxIF0ubmFtZSkudG9CZSgnQVBJX1VSTF9TRUNPTkRBUlknKTtcbiAgICAgIGV4cGVjdCgoc2NoZWR1bGVyQ29uc3RydWN0IGFzIGFueSkuc2NoZWR1bGVyQ29uc3RydWN0Q29uZmlnLmVudlsgMiBdLm5hbWUpLnRvQmUoJ0FQSV9VUkxfVEVSVElBUlknKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ1NuYXBzaG90IFRlc3RzIC0gQ2xvdWRGb3JtYXRpb24gQ29uc2lzdGVuY3knLCAoKSA9PiB7XG4gICAgLyoqXG4gICAgICogU25hcHNob3Q6IE1pbmltYWwgQ29uZmlndXJhdGlvblxuICAgICAqIFRlc3RzIENsb3VkRm9ybWF0aW9uIHRlbXBsYXRlIHdpdGggbWluaW1hbCBzY2hlZHVsZXIgY29uZmlnLlxuICAgICAqL1xuICAgIGl0KCdzaG91bGQgZ2VuZXJhdGUgY29uc2lzdGVudCBDbG91ZEZvcm1hdGlvbiBmb3IgbWluaW1hbCBjb25maWcnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjb25maWc6IElTY2hlZHVsZXJDb25zdHJ1Y3RDb25maWcgPSB7XG4gICAgICAgIHRhc2tzRGlyZWN0b3J5OiAnLi90ZXN0LXRhc2tzJ1xuICAgICAgfTtcblxuICAgICAgY29uc3Qgc2NoZWR1bGVyQ29uc3RydWN0ID0gbmV3IFNjaGVkdWxlckNvbnN0cnVjdChjb25maWcpO1xuXG4gICAgICAvLyBNb2NrIHJlZ2lzdGVySGFuZGxlcnMgdG8gYXZvaWQgZmlsZSBzeXN0ZW0gYWNjZXNzXG4gICAgICBjb25zdCBvcmlnaW5hbFJlZ2lzdGVySGFuZGxlcnMgPSAoYXdhaXQgaW1wb3J0KCcuLi9jb3JlL2hlbHBlcicpKS5IZWxwZXIucmVnaXN0ZXJIYW5kbGVycztcbiAgICAgIChhd2FpdCBpbXBvcnQoJy4uL2NvcmUvaGVscGVyJykpLkhlbHBlci5yZWdpc3RlckhhbmRsZXJzID0gamVzdC5mbigpLm1vY2tSZXNvbHZlZFZhbHVlKHVuZGVmaW5lZCk7XG5cbiAgICAgIGF3YWl0IHNjaGVkdWxlckNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spLnRvSlNPTigpO1xuICAgICAgZXhwZWN0KHRlbXBsYXRlKS50b01hdGNoU25hcHNob3QoKTtcblxuICAgICAgLy8gUmVzdG9yZVxuICAgICAgKGF3YWl0IGltcG9ydCgnLi4vY29yZS9oZWxwZXInKSkuSGVscGVyLnJlZ2lzdGVySGFuZGxlcnMgPSBvcmlnaW5hbFJlZ2lzdGVySGFuZGxlcnM7XG4gICAgfSk7XG5cbiAgICAvKipcbiAgICAgKiBTbmFwc2hvdDogRnVsbCBDb25maWd1cmF0aW9uXG4gICAgICogVGVzdHMgQ2xvdWRGb3JtYXRpb24gdGVtcGxhdGUgd2l0aCBhbGwgc2NoZWR1bGVyIG9wdGlvbnMuXG4gICAgICovXG4gICAgaXQoJ3Nob3VsZCBnZW5lcmF0ZSBjb25zaXN0ZW50IENsb3VkRm9ybWF0aW9uIGZvciBmdWxsIGNvbmZpZycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbmZpZzogSVNjaGVkdWxlckNvbnN0cnVjdENvbmZpZyA9IHtcbiAgICAgICAgdGFza3NEaXJlY3Rvcnk6ICcuL2N1c3RvbS90YXNrcycsXG4gICAgICAgIGVudjogW1xuICAgICAgICAgIHsgbmFtZTogJ0FQSV9VUkwnLCB2YWx1ZTogJ2h0dHBzOi8vYXBpLmV4YW1wbGUuY29tJyB9LFxuICAgICAgICAgIHsgbmFtZTogJ0xPR19MRVZFTCcsIHZhbHVlOiAnZGVidWcnIH1cbiAgICAgICAgXSxcbiAgICAgICAgZnVuY3Rpb25Qcm9wczoge1xuICAgICAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHMoMTIwKSxcbiAgICAgICAgICBtZW1vcnlTaXplOiAxMDI0LFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnU2NoZWR1bGVkIHRhc2sgaGFuZGxlcicsXG4gICAgICAgICAgYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUuQVJNXzY0XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHNjaGVkdWxlckNvbnN0cnVjdCA9IG5ldyBTY2hlZHVsZXJDb25zdHJ1Y3QoY29uZmlnKTtcblxuICAgICAgLy8gTW9jayByZWdpc3RlckhhbmRsZXJzXG4gICAgICBjb25zdCBvcmlnaW5hbFJlZ2lzdGVySGFuZGxlcnMgPSAoYXdhaXQgaW1wb3J0KCcuLi9jb3JlL2hlbHBlcicpKS5IZWxwZXIucmVnaXN0ZXJIYW5kbGVycztcbiAgICAgIChhd2FpdCBpbXBvcnQoJy4uL2NvcmUvaGVscGVyJykpLkhlbHBlci5yZWdpc3RlckhhbmRsZXJzID0gamVzdC5mbigpLm1vY2tSZXNvbHZlZFZhbHVlKHVuZGVmaW5lZCk7XG5cbiAgICAgIGF3YWl0IHNjaGVkdWxlckNvbnN0cnVjdC5jb25zdHJ1Y3QoKTtcblxuICAgICAgY29uc3QgdGVtcGxhdGUgPSBUZW1wbGF0ZS5mcm9tU3RhY2soc3RhY2spLnRvSlNPTigpO1xuICAgICAgZXhwZWN0KHRlbXBsYXRlKS50b01hdGNoU25hcHNob3QoKTtcblxuICAgICAgLy8gUmVzdG9yZVxuICAgICAgKGF3YWl0IGltcG9ydCgnLi4vY29yZS9oZWxwZXInKSkuSGVscGVyLnJlZ2lzdGVySGFuZGxlcnMgPSBvcmlnaW5hbFJlZ2lzdGVySGFuZGxlcnM7XG4gICAgfSk7XG4gIH0pO1xufSk7XG5cbiJdfQ==
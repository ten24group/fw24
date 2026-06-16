import { App, Fn, NestedStack, Stack } from 'aws-cdk-lib';
import { APIConstruct } from './api';
import { Fw24 } from '../core/fw24';
import HandlerDescriptor from '../interfaces/handler-descriptor';
import * as nestedRootResources from './nested-controller-root-resources';

function makeDescriptor(fileName: string, controllerName: string): HandlerDescriptor {
    class TestController {
        controllerName = controllerName;
        controllerConfig = {};
    }

    return {
        handlerClass: TestController,
        fileName,
        filePath: '/app/src/controllers',
        handlerHash: fileName,
    };
}

describe('APIConstruct.setupNestedControllerRootResources', () => {
    beforeEach(() => {
        (Fw24 as any).instance = undefined;

        const app = new App();
        const mainStack = new Stack(app, 'test-app-main-stack', {
            env: { account: '123456789012', region: 'us-east-1' },
        });

        const fw24 = Fw24.getInstance();
        fw24.setApp(app);
        fw24.setConfig({
            name: 'test-app',
            region: 'us-east-1',
            account: '123456789012',
        });
        fw24.addStack('main', mainStack);
    });

    afterEach(() => {
        (Fw24 as any).instance = undefined;
        jest.restoreAllMocks();
    });

    it('pre-binds Fn::ImportValue for shared roots when import planning selects import-from-export', async () => {
        const planSpy = jest.spyOn(nestedRootResources, 'planNestedControllerRootImports').mockResolvedValue([
            {
                rootPath: 'internal',
                exportName: nestedRootResources.buildNestedControllerRootExportName('test-app-main-stack', 'internal'),
                controllerCount: 2,
                strategy: 'import-from-export',
            },
        ]);

        const apiConstruct = new APIConstruct({
            controllerParentStackName: 'main',
            skipControllers: true,
            cors: false,
        });
        await apiConstruct.construct();

        const descriptors = [
            makeDescriptor('internal/notifications.ts', 'notifications'),
            makeDescriptor('internal/verify-access.ts', 'verify-access'),
        ];

        await (apiConstruct as any).setupNestedControllerRootResources(descriptors);

        const fw24 = Fw24.getInstance();
        const nestedStack = fw24.getStack('internal/notifications', 'main');
        const resourceId = fw24.getEnvironmentVariable(
            nestedRootResources.getNestedControllerRootResourceEnvKey('internal'),
            'resource',
            nestedStack
        );

        expect(planSpy).toHaveBeenCalledWith(descriptors, 'test-app-main-stack');
        expect(resourceId).toBeDefined();
        expect(typeof resourceId).toBe('string');
        expect((apiConstruct as any).nestedControllerRootsImportedFromExport.has('internal')).toBe(true);
    });

    it('does not pre-bind imports when planning selects create-on-register', async () => {
        jest.spyOn(nestedRootResources, 'planNestedControllerRootImports').mockResolvedValue([
            {
                rootPath: 'internal',
                exportName: nestedRootResources.buildNestedControllerRootExportName('test-app-main-stack', 'internal'),
                controllerCount: 2,
                strategy: 'create-on-register',
            },
        ]);

        const apiConstruct = new APIConstruct({
            controllerParentStackName: 'main',
            skipControllers: true,
            cors: false,
        });
        await apiConstruct.construct();

        await (apiConstruct as any).setupNestedControllerRootResources([
            makeDescriptor('internal/notifications.ts', 'notifications'),
            makeDescriptor('internal/verify-access.ts', 'verify-access'),
        ]);

        const fw24 = Fw24.getInstance();
        const resourceId = fw24.getEnvironmentVariable(
            nestedRootResources.getNestedControllerRootResourceEnvKey('internal'),
            'resource',
            fw24.getStack('internal/notifications', 'main')
        );

        expect(resourceId).toBeUndefined();
        expect((apiConstruct as any).nestedControllerRootsImportedFromExport.size).toBe(0);
    });
});

describe('APIConstruct controller registration ordering', () => {
    it('sorts nested controller descriptors by fileName before registration', () => {
        const descriptors = [
            makeDescriptor('internal/verify-access.ts', 'verify-access'),
            makeDescriptor('internal/notifications.ts', 'notifications'),
        ];

        const sorted = [ ...descriptors ].sort((left, right) => left.fileName.localeCompare(right.fileName));

        expect(sorted.map((descriptor) => descriptor.fileName)).toEqual([
            'internal/notifications.ts',
            'internal/verify-access.ts',
        ]);
    });
});

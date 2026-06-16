import { APIConstruct } from './api';
import { Fw24 } from '../core/fw24';
import { App, Stack } from 'aws-cdk-lib';
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

    it('marks shared roots for per-stack import without pre-binding a global Fn::ImportValue', async () => {
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
        const resourceId = fw24.getEnvironmentVariable(
            nestedRootResources.getNestedControllerRootResourceEnvKey('internal'),
            'resource',
            fw24.getStack('internal/notifications', 'main')
        );

        expect(planSpy).toHaveBeenCalledWith(descriptors, 'test-app-main-stack');
        expect(resourceId).toBeUndefined();
        expect((apiConstruct as any).nestedControllerRootsImportedFromExport.has('internal')).toBe(true);
    });

    it('does not mark roots for import when planning selects create-on-register', async () => {
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

        expect((apiConstruct as any).nestedControllerRootsImportedFromExport.size).toBe(0);
    });
});

describe('APIConstruct controller registration ordering', () => {
    it('registers owner stacks before siblings when importing an existing shared root', () => {
        const importPlans = new Map([
            [
                'internal',
                {
                    rootPath: 'internal',
                    exportName: 'test-app-main-stack-resourceRESTAPI-CONTROLLER-INTERNALresourceId',
                    controllerCount: 2,
                    strategy: 'import-from-export' as const,
                },
            ],
        ]);
        const descriptors = [
            makeDescriptor('internal/verify-access.ts', 'verify-access'),
            makeDescriptor('internal/notifications.ts', 'notifications'),
        ];

        const sorted = [ ...descriptors ].sort((left, right) =>
            nestedRootResources.compareControllerRegistrationOrder(left, right, importPlans)
        );

        expect(sorted.map((descriptor) => descriptor.fileName)).toEqual([
            'internal/verify-access.ts',
            'internal/notifications.ts',
        ]);
    });
});

import HandlerDescriptor from '../interfaces/handler-descriptor';
import {
    buildNestedControllerRootExportName,
    getControllerRouteName,
    getNestedControllerRootPath,
    getNestedControllerRootResourceEnvKey,
    groupNestedControllerDescriptorsByRoot,
    hasAwsCredentialsForExportLookup,
    planNestedControllerRootImports,
} from './nested-controller-root-resources';

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

describe('nested-controller-root-resources', () => {
    describe('getControllerRouteName', () => {
        it('prefixes folder path for nested controller files', () => {
            const desc = makeDescriptor('internal/notifications.ts', 'notifications');
            expect(getControllerRouteName(desc)).toBe('internal/notifications');
        });

        it('uses controller name only for root-level controllers', () => {
            const desc = makeDescriptor('health.ts', 'health');
            expect(getControllerRouteName(desc)).toBe('health');
        });
    });

    describe('buildNestedControllerRootExportName', () => {
        it('matches setConstructOutput export naming for nested roots', () => {
            expect(
                buildNestedControllerRootExportName('plusfan-app-backend-main-stack', 'internal')
            ).toBe('plusfan-app-backend-main-stack-resourceRESTAPI-CONTROLLER-INTERNALresourceId');
        });
    });

    describe('groupNestedControllerDescriptorsByRoot', () => {
        it('groups nested controllers by their first path segment', () => {
            const descriptors = [
                makeDescriptor('internal/notifications.ts', 'notifications'),
                makeDescriptor('internal/verify-access.ts', 'verify-access'),
                makeDescriptor('admin/user.ts', 'user'),
                makeDescriptor('health.ts', 'health'),
            ];

            const grouped = groupNestedControllerDescriptorsByRoot(descriptors);

            expect(grouped.get('internal')?.map((d) => d.fileName)).toEqual([
                'internal/notifications.ts',
                'internal/verify-access.ts',
            ]);
            expect(grouped.get('admin')?.map((d) => d.fileName)).toEqual([ 'admin/user.ts' ]);
            expect(grouped.has('health')).toBe(false);
        });
    });

    describe('getNestedControllerRootResourceEnvKey', () => {
        it('uses the fw24 nested root resource env key convention', () => {
            expect(getNestedControllerRootResourceEnvKey('internal')).toBe('restAPI_controller_internal_resourceId');
        });
    });

    describe('getNestedControllerRootPath', () => {
        it('returns the first segment for nested routes', () => {
            expect(getNestedControllerRootPath('internal/notifications')).toBe('internal');
        });

        it('returns undefined for top-level routes', () => {
            expect(getNestedControllerRootPath('health')).toBeUndefined();
        });
    });

    describe('hasAwsCredentialsForExportLookup', () => {
        const originalEnv = process.env;

        beforeEach(() => {
            process.env = { ...originalEnv };
            delete process.env.CDK_DEFAULT_ACCOUNT;
            delete process.env.AWS_ACCESS_KEY_ID;
            delete process.env.AWS_PROFILE;
            delete process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
        });

        afterEach(() => {
            process.env = originalEnv;
        });

        it('returns false when no AWS credential signals are present', () => {
            expect(hasAwsCredentialsForExportLookup()).toBe(false);
        });

        it('returns true when CDK account context is set', () => {
            process.env.CDK_DEFAULT_ACCOUNT = '123456789012';
            expect(hasAwsCredentialsForExportLookup()).toBe(true);
        });
    });

    describe('planNestedControllerRootImports', () => {
        const mainStackName = 'test-app-main-stack';
        const exportExists = jest.fn<Promise<boolean>, [string]>();

        beforeEach(() => {
            exportExists.mockReset();
        });

        it('plans create-on-register for a single nested controller folder', async () => {
            const descriptors = [
                makeDescriptor('webhooks/hook.ts', 'hook'),
            ];

            const plans = await planNestedControllerRootImports(descriptors, mainStackName, exportExists);

            expect(plans).toEqual([
                {
                    rootPath: 'webhooks',
                    exportName: buildNestedControllerRootExportName(mainStackName, 'webhooks'),
                    controllerCount: 1,
                    strategy: 'create-on-register',
                },
            ]);
            expect(exportExists).not.toHaveBeenCalled();
        });

        it('plans import-from-export when a shared root already has a CloudFormation export', async () => {
            exportExists.mockResolvedValue(true);
            const descriptors = [
                makeDescriptor('internal/notifications.ts', 'notifications'),
                makeDescriptor('internal/verify-access.ts', 'verify-access'),
            ];

            const plans = await planNestedControllerRootImports(descriptors, mainStackName, exportExists);

            expect(plans).toEqual([
                {
                    rootPath: 'internal',
                    exportName: buildNestedControllerRootExportName(mainStackName, 'internal'),
                    controllerCount: 2,
                    strategy: 'import-from-export',
                },
            ]);
            expect(exportExists).toHaveBeenCalledWith(
                buildNestedControllerRootExportName(mainStackName, 'internal')
            );
        });

        it('plans create-on-register for greenfield folders with multiple controllers and no export', async () => {
            exportExists.mockResolvedValue(false);
            const descriptors = [
                makeDescriptor('internal/notifications.ts', 'notifications'),
                makeDescriptor('internal/verify-access.ts', 'verify-access'),
            ];

            const plans = await planNestedControllerRootImports(descriptors, mainStackName, exportExists);

            expect(plans[ 0 ]?.strategy).toBe('create-on-register');
            expect(plans[ 0 ]?.controllerCount).toBe(2);
        });

        it('does not plan imports for top-level controllers', async () => {
            const descriptors = [
                makeDescriptor('health.ts', 'health'),
                makeDescriptor('status.ts', 'status'),
            ];

            const plans = await planNestedControllerRootImports(descriptors, mainStackName, exportExists);

            expect(plans).toEqual([]);
            expect(exportExists).not.toHaveBeenCalled();
        });

        it('plans each shared root independently', async () => {
            exportExists.mockImplementation(async (exportName) =>
                exportName === buildNestedControllerRootExportName(mainStackName, 'internal')
            );
            const descriptors = [
                makeDescriptor('internal/notifications.ts', 'notifications'),
                makeDescriptor('internal/verify-access.ts', 'verify-access'),
                makeDescriptor('admin/user.ts', 'user'),
                makeDescriptor('admin/team.ts', 'team'),
            ];

            const plans = await planNestedControllerRootImports(descriptors, mainStackName, exportExists);

            expect(plans).toEqual([
                {
                    rootPath: 'internal',
                    exportName: buildNestedControllerRootExportName(mainStackName, 'internal'),
                    controllerCount: 2,
                    strategy: 'import-from-export',
                },
                {
                    rootPath: 'admin',
                    exportName: buildNestedControllerRootExportName(mainStackName, 'admin'),
                    controllerCount: 2,
                    strategy: 'create-on-register',
                },
            ]);
        });
    });
});

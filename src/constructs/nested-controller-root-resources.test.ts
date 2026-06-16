import HandlerDescriptor from '../interfaces/handler-descriptor';
import {
    buildNestedControllerRootExportName,
    getControllerRouteName,
    getNestedControllerRootPath,
    getNestedControllerRootResourceEnvKey,
    groupNestedControllerDescriptorsByRoot,
    hasAwsCredentialsForExportLookup,
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
});

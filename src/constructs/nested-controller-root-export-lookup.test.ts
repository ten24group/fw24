import { ListExportsCommand } from '@aws-sdk/client-cloudformation';
import { cloudFormationExportExists } from './nested-controller-root-resources';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-cloudformation', () => ({
    CloudFormationClient: jest.fn(() => ({ send: mockSend })),
    ListExportsCommand: jest.fn((input) => input),
}));

describe('cloudFormationExportExists', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv, CDK_DEFAULT_ACCOUNT: '123456789012' };
        jest.clearAllMocks();
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('returns true when ListExports finds the export name', async () => {
        mockSend.mockResolvedValue({
            Exports: [
                { Name: 'test-app-main-stack-resourceRESTAPI-CONTROLLER-INTERNALresourceId' },
            ],
        });

        await expect(
            cloudFormationExportExists('test-app-main-stack-resourceRESTAPI-CONTROLLER-INTERNALresourceId')
        ).resolves.toBe(true);

        expect(ListExportsCommand).toHaveBeenCalled();
    });

    it('returns false when ListExports does not include the export name', async () => {
        mockSend.mockResolvedValue({
            Exports: [
                { Name: 'some-other-export' },
            ],
        });

        await expect(
            cloudFormationExportExists('missing-export')
        ).resolves.toBe(false);
    });

    it('returns false when AWS credentials are not available', async () => {
        delete process.env.CDK_DEFAULT_ACCOUNT;
        delete process.env.AWS_ACCESS_KEY_ID;
        delete process.env.AWS_PROFILE;
        delete process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;

        mockSend.mockClear();

        await expect(cloudFormationExportExists('any-export')).resolves.toBe(false);
        expect(mockSend).not.toHaveBeenCalled();
    });

    it('returns false when ListExports throws', async () => {
        mockSend.mockRejectedValue(new Error('AccessDenied'));

        await expect(cloudFormationExportExists('any-export')).resolves.toBe(false);
    });
});

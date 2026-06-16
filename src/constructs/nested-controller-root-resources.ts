import { CloudFormationClient, ListExportsCommand } from '@aws-sdk/client-cloudformation';
import type HandlerDescriptor from '../interfaces/handler-descriptor';
import { OutputType } from '../interfaces/construct';
import { ensureValidEnvKey } from '../utils/keys';

export function getControllerRouteName(desc: HandlerDescriptor): string {
    const { handlerClass, fileName } = desc;
    const folderPath = fileName.split('/').slice(0, -1).join('/');
    const handlerInstance = new handlerClass();
    return fileName.includes('/')
        ? folderPath + '/' + handlerInstance.controllerName
        : handlerInstance.controllerName;
}

export function getNestedControllerRootPath(controllerName: string): string | undefined {
    const pathParts = controllerName.split('/');
    return pathParts.length > 1 ? pathParts[ 0 ] : undefined;
}

export function buildNestedControllerRootExportName(mainStackName: string, rootPath: string): string {
    const key = `restAPI_controller_${rootPath}`;
    const sanitizedKey = ensureValidEnvKey(key, '', '', true);
    const exportKey = `${OutputType.RESOURCE}${sanitizedKey}resourceId`;
    return `${mainStackName}-${exportKey}`;
}

export function getNestedControllerRootResourceEnvKey(rootPath: string): string {
    return `restAPI_controller_${rootPath}_resourceId`;
}

export function groupNestedControllerDescriptorsByRoot(
    descriptors: HandlerDescriptor[]
): Map<string, HandlerDescriptor[]> {
    const byRoot = new Map<string, HandlerDescriptor[]>();

    for (const desc of descriptors) {
        const rootPath = getNestedControllerRootPath(getControllerRouteName(desc));
        if (!rootPath) {
            continue;
        }
        const existing = byRoot.get(rootPath) || [];
        existing.push(desc);
        byRoot.set(rootPath, existing);
    }

    return byRoot;
}

export function hasAwsCredentialsForExportLookup(): boolean {
    return Boolean(
        process.env.CDK_DEFAULT_ACCOUNT
        || process.env.AWS_ACCESS_KEY_ID
        || process.env.AWS_PROFILE
        || process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI
    );
}

export async function cloudFormationExportExists(exportName: string): Promise<boolean> {
    if (!hasAwsCredentialsForExportLookup()) {
        return false;
    }

    try {
        const client = new CloudFormationClient({});
        let nextToken: string | undefined;

        do {
            const response = await client.send(new ListExportsCommand({ NextToken: nextToken }));
            for (const entry of response.Exports ?? []) {
                if (entry.Name === exportName) {
                    return true;
                }
            }
            nextToken = response.NextToken;
        } while (nextToken);

        return false;
    } catch {
        return false;
    }
}

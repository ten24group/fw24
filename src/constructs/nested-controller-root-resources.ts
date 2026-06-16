import { CloudFormationClient, GetTemplateCommand, ListExportsCommand, ListStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import type HandlerDescriptor from '../interfaces/handler-descriptor';
import { OutputType } from '../interfaces/construct';
import { createLogger } from '../logging';
import { ensureValidEnvKey } from '../utils/keys';

const logger = createLogger('nested-controller-root-resources');

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

export type NestedControllerRootImportStrategy = 'import-from-export' | 'create-on-register';

export interface NestedControllerRootImportPlan {
    rootPath: string;
    exportName: string;
    controllerCount: number;
    strategy: NestedControllerRootImportStrategy;
}

export async function planNestedControllerRootImports(
    descriptors: HandlerDescriptor[],
    mainStackName: string,
    exportExists: (exportName: string) => Promise<boolean> = cloudFormationExportExists
): Promise<NestedControllerRootImportPlan[]> {
    const nestedControllersByRoot = groupNestedControllerDescriptorsByRoot(descriptors);
    const plans: NestedControllerRootImportPlan[] = [];

    for (const [ rootPath, controllers ] of nestedControllersByRoot) {
        const exportName = buildNestedControllerRootExportName(mainStackName, rootPath);
        const controllerCount = controllers.length;

        if (controllerCount < 2) {
            const shouldImport = await exportExists(exportName);
            plans.push({
                rootPath,
                exportName,
                controllerCount,
                strategy: shouldImport ? 'import-from-export' : 'create-on-register',
            });
            continue;
        }

        const shouldImport = await exportExists(exportName);
        plans.push({
            rootPath,
            exportName,
            controllerCount,
            strategy: shouldImport ? 'import-from-export' : 'create-on-register',
        });
    }

    return plans;
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
    } catch (error) {
        logger.warn(
            `Could not list CloudFormation exports; nested controller root import planning will assume greenfield: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
        return false;
    }
}

export function nestedControllerRoutesFromStackResourceSummaries(
    summaries: Array<{ LogicalResourceId?: string; ResourceType?: string }>
): string[] {
    const routes: string[] = [];

    for (const resource of summaries) {
        if (resource.ResourceType !== 'AWS::CloudFormation::Stack') {
            continue;
        }
        const logicalId = resource.LogicalResourceId ?? '';
        const route = nestedControllerRouteFromNestedStackLogicalId(logicalId);
        if (route) {
            routes.push(route);
        }
    }

    return routes;
}

export function nestedControllerRouteFromNestedStackLogicalId(logicalId: string): string | undefined {
    const match = logicalId.match(/^([a-z][a-z0-9-]*?)NestedStack/i);
    if (!match) {
        return undefined;
    }

    const compactStackKey = match[ 1 ];
    if (compactStackKey.startsWith('internal')) {
        return `internal/${compactStackKey.slice('internal'.length)}`;
    }
    if (compactStackKey.startsWith('admin')) {
        return `admin/${compactStackKey.slice('admin'.length)}`;
    }

    return undefined;
}

export function nestedStackTemplateOwnsApiGatewayPathPart(templateBody: unknown, pathPart: string): boolean {
    const resources = (templateBody as {
        Resources?: Record<string, { Type?: string; Properties?: { PathPart?: string; ParentId?: unknown } }>;
    }).Resources ?? {};

    for (const resource of Object.values(resources)) {
        if (resource.Type !== 'AWS::ApiGateway::Resource') {
            continue;
        }
        if (resource.Properties?.PathPart !== pathPart) {
            continue;
        }
        const parentId = resource.Properties.ParentId;
        if (parentId && typeof parentId === 'object' && 'Ref' in parentId) {
            const ref = String((parentId as { Ref: string }).Ref);
            if (ref.includes('RootResourceId')) {
                return true;
            }
        }
    }

    return false;
}

export async function listDeployedNestedControllerRootOwners(
    mainStackName: string,
    listOwners: (mainStackName: string) => Promise<Map<string, string>> = cloudFormationNestedControllerRootOwners
): Promise<Map<string, string>> {
    return listOwners(mainStackName);
}

export async function cloudFormationNestedControllerRootOwners(mainStackName: string): Promise<Map<string, string>> {
    const owners = new Map<string, string>();

    if (!hasAwsCredentialsForExportLookup()) {
        return owners;
    }

    try {
        const client = new CloudFormationClient({});
        const response = await client.send(new ListStackResourcesCommand({ StackName: mainStackName }));

        for (const resource of response.StackResourceSummaries ?? []) {
            if (resource.ResourceType !== 'AWS::CloudFormation::Stack') {
                continue;
            }
            const route = nestedControllerRouteFromNestedStackLogicalId(resource.LogicalResourceId ?? '');
            if (!route) {
                continue;
            }
            const rootPath = getNestedControllerRootPath(route);
            if (!rootPath || owners.has(rootPath)) {
                continue;
            }

            const nestedStackId = resource.PhysicalResourceId;
            if (!nestedStackId) {
                continue;
            }

            const template = await client.send(new GetTemplateCommand({ StackName: nestedStackId }));
            const templateBody = typeof template.TemplateBody === 'string'
                ? JSON.parse(template.TemplateBody)
                : template.TemplateBody;

            if (nestedStackTemplateOwnsApiGatewayPathPart(templateBody, rootPath)) {
                owners.set(rootPath, route);
            }
        }
    } catch (error) {
        logger.warn(
            `Could not resolve deployed nested controller root owners on ${mainStackName}: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
    }

    return owners;
}

export async function listDeployedNestedControllerRoutes(
    mainStackName: string,
    listStackResources: (mainStackName: string) => Promise<string[]> = cloudFormationNestedControllerRoutes
): Promise<Set<string>> {
    const routes = await listStackResources(mainStackName);
    return new Set(routes);
}

export async function cloudFormationNestedControllerRoutes(mainStackName: string): Promise<string[]> {
    if (!hasAwsCredentialsForExportLookup()) {
        return [];
    }

    try {
        const client = new CloudFormationClient({});
        const response = await client.send(new ListStackResourcesCommand({ StackName: mainStackName }));
        return nestedControllerRoutesFromStackResourceSummaries(response.StackResourceSummaries ?? []);
    } catch (error) {
        logger.warn(
            `Could not list nested controller stacks on ${mainStackName}; registration order will ignore brownfield deploy state: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
        return [];
    }
}

export function compareControllerRegistrationOrder(
    left: HandlerDescriptor,
    right: HandlerDescriptor,
    importPlansByRoot: Map<string, NestedControllerRootImportPlan>,
    deployedNestedControllerRoutes: Set<string> = new Set()
): number {
    const leftRoute = getControllerRouteName(left);
    const rightRoute = getControllerRouteName(right);
    const leftRoot = getNestedControllerRootPath(leftRoute);
    const rightRoot = getNestedControllerRootPath(rightRoute);

    if (leftRoot && leftRoot === rightRoot) {
        const plan = importPlansByRoot.get(leftRoot);
        if (plan?.strategy === 'import-from-export') {
            const leftDeployed = deployedNestedControllerRoutes.has(leftRoute);
            const rightDeployed = deployedNestedControllerRoutes.has(rightRoute);
            if (leftDeployed && !rightDeployed) {
                return -1;
            }
            if (rightDeployed && !leftDeployed) {
                return 1;
            }
            return right.fileName.localeCompare(left.fileName);
        }
    }

    return left.fileName.localeCompare(right.fileName);
}

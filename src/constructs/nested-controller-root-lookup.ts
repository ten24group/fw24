import { CloudFormationClient, GetTemplateCommand, ListStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import { createLogger } from '../logging';

const logger = createLogger('nested-controller-root-lookup');

/**
 * Minimal CloudFormation surface needed to resolve which deployed stack currently owns a shared
 * nested-controller root segment. Abstracted behind an interface so it can be mocked in tests and
 * so the strategy code never talks to the AWS SDK directly.
 */
export interface NestedRootCloudFormationLookup {
    /** List nested stacks (AWS::CloudFormation::Stack) directly under the given parent stack. */
    listNestedStacks(parentStackName: string): Promise<Array<{ logicalId: string; physicalId: string }>>;
    /** Fetch a stack's processed template body (parsed JSON). */
    getTemplate(stackId: string): Promise<unknown>;
}

/**
 * Resolution of a single shared root's deployed owner. `candidateRoutes` are the controller route
 * paths (e.g. `internal/team`, `internal/team/ping`) found in the owner stack's template — the
 * caller intersects them with the app's actual controller routes to identify the owning controller
 * stack. No logical-id matching, no hardcoded segment names.
 */
export type NestedRootOwnerResolution =
    | { kind: 'owned'; candidateRoutes: string[] }
    | { kind: 'not-found' }
    | { kind: 'ambiguous'; ownerStackLogicalIds: string[] };

type CfnResource = { Type?: string; Properties?: { PathPart?: string; ParentId?: unknown } };

/** Extract the parent reference of an API Gateway resource as either a logical id, or `ROOT`. */
function parentKey(parentId: unknown): string | undefined {
    if (!parentId || typeof parentId !== 'object') {
        return undefined;
    }
    const obj = parentId as Record<string, unknown>;
    if ('Fn::GetAtt' in obj && Array.isArray(obj[ 'Fn::GetAtt' ])) {
        const [ , attr ] = obj[ 'Fn::GetAtt' ] as unknown[];
        return String(attr).includes('RootResourceId') ? 'ROOT' : undefined;
    }
    if ('Ref' in obj) {
        const ref = String(obj.Ref);
        return ref.includes('RootResourceId') ? 'ROOT' : ref;
    }
    return undefined;
}

/**
 * Pure: does this template declare `rootSegment` as a direct child of the REST API root? Generic —
 * works for any segment name.
 */
export function templateOwnsNestedRoot(templateBody: unknown, rootSegment: string): boolean {
    const resources = (templateBody as { Resources?: Record<string, CfnResource> })?.Resources ?? {};
    for (const resource of Object.values(resources)) {
        if (resource.Type === 'AWS::ApiGateway::Resource'
            && resource.Properties?.PathPart === rootSegment
            && parentKey(resource.Properties.ParentId) === 'ROOT') {
            return true;
        }
    }
    return false;
}

/**
 * Pure: walk the API Gateway resource tree in this template starting at `rootSegment` (which must be
 * a child of the API root) and return every full path under it, e.g. for an `internal/team`
 * controller: `['internal/team', 'internal/team/ping']`. These are candidate controller routes; the
 * caller matches them against the app's real controllers. Returns `[]` if the template does not own
 * the root. No hardcoded segment names — every part comes from `PathPart`.
 */
export function controllerRoutePathsUnderRoot(templateBody: unknown, rootSegment: string): string[] {
    const resources = (templateBody as { Resources?: Record<string, CfnResource> })?.Resources ?? {};

    // logicalId -> { pathPart, parent } for every API Gateway resource
    const nodes = new Map<string, { pathPart: string; parent: string | undefined }>();
    for (const [ logicalId, resource ] of Object.entries(resources)) {
        if (resource.Type === 'AWS::ApiGateway::Resource' && typeof resource.Properties?.PathPart === 'string') {
            nodes.set(logicalId, { pathPart: resource.Properties.PathPart, parent: parentKey(resource.Properties.ParentId) });
        }
    }

    // find the root-segment resource (child of API root with matching PathPart)
    let rootLogicalId: string | undefined;
    for (const [ logicalId, node ] of nodes) {
        if (node.parent === 'ROOT' && node.pathPart === rootSegment) {
            rootLogicalId = logicalId;
            break;
        }
    }
    if (!rootLogicalId) {
        return [];
    }

    const childrenOf = new Map<string, string[]>();
    for (const [ logicalId, node ] of nodes) {
        if (node.parent) {
            const list = childrenOf.get(node.parent) ?? [];
            list.push(logicalId);
            childrenOf.set(node.parent, list);
        }
    }

    const paths: string[] = [];
    const walk = (logicalId: string, prefix: string) => {
        for (const childId of childrenOf.get(logicalId) ?? []) {
            const childPath = `${prefix}/${nodes.get(childId)!.pathPart}`;
            paths.push(childPath);
            walk(childId, childPath);
        }
    };
    walk(rootLogicalId, rootSegment);
    return paths;
}

/**
 * For each requested root segment, resolve its deployed owner stack and return the candidate
 * controller routes found in that stack's template. Throws on lookup failure (e.g. missing
 * credentials) so the caller can FAIL LOUD rather than silently guessing.
 */
export async function resolveDeployedNestedRootOwners(
    parentStackName: string,
    rootSegments: string[],
    lookup: NestedRootCloudFormationLookup,
): Promise<Map<string, NestedRootOwnerResolution>> {
    const result = new Map<string, NestedRootOwnerResolution>();
    if (rootSegments.length === 0) {
        return result;
    }

    const nestedStacks = await lookup.listNestedStacks(parentStackName);

    // for each root: which nested stacks own it, and the routes inside the owning template
    const ownersByRoot = new Map<string, Array<{ logicalId: string; routes: string[] }>>();
    for (const segment of rootSegments) {
        ownersByRoot.set(segment, []);
    }

    for (const nested of nestedStacks) {
        const template = await lookup.getTemplate(nested.physicalId);
        for (const segment of rootSegments) {
            if (templateOwnsNestedRoot(template, segment)) {
                ownersByRoot.get(segment)!.push({ logicalId: nested.logicalId, routes: controllerRoutePathsUnderRoot(template, segment) });
            }
        }
    }

    for (const segment of rootSegments) {
        const owners = ownersByRoot.get(segment)!;
        if (owners.length === 0) {
            result.set(segment, { kind: 'not-found' });
        } else if (owners.length === 1) {
            result.set(segment, { kind: 'owned', candidateRoutes: owners[ 0 ].routes });
        } else {
            logger.warn(`Shared root /${segment} is declared by multiple deployed stacks: ${owners.map((o) => o.logicalId).join(', ')}`);
            result.set(segment, { kind: 'ambiguous', ownerStackLogicalIds: owners.map((o) => o.logicalId) });
        }
    }

    return result;
}

/** Default AWS-backed lookup. Uses ambient credentials/region (present in CI/CD deploy). */
export function createCloudFormationNestedRootLookup(): NestedRootCloudFormationLookup {
    const client = new CloudFormationClient({});
    return {
        async listNestedStacks(parentStackName: string) {
            const out: Array<{ logicalId: string; physicalId: string }> = [];
            const response = await client.send(new ListStackResourcesCommand({ StackName: parentStackName }));
            for (const summary of response.StackResourceSummaries ?? []) {
                if (summary.ResourceType === 'AWS::CloudFormation::Stack' && summary.LogicalResourceId && summary.PhysicalResourceId) {
                    out.push({ logicalId: summary.LogicalResourceId, physicalId: summary.PhysicalResourceId });
                }
            }
            return out;
        },
        async getTemplate(stackId: string) {
            const response = await client.send(new GetTemplateCommand({ StackName: stackId }));
            const body = response.TemplateBody;
            if (typeof body === 'string') {
                try {
                    return JSON.parse(body);
                } catch {
                    return {};
                }
            }
            return body ?? {};
        },
    };
}

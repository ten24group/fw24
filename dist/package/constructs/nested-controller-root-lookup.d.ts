/**
 * Minimal CloudFormation surface needed to resolve which deployed stack currently owns a shared
 * nested-controller root segment. Abstracted behind an interface so it can be mocked in tests and
 * so the strategy code never talks to the AWS SDK directly.
 */
export interface NestedRootCloudFormationLookup {
    /** List nested stacks (AWS::CloudFormation::Stack) directly under the given parent stack. */
    listNestedStacks(parentStackName: string): Promise<Array<{
        logicalId: string;
        physicalId: string;
    }>>;
    /** Fetch a stack's processed template body (parsed JSON). */
    getTemplate(stackId: string): Promise<unknown>;
}
/**
 * Resolution of a single shared root's deployed owner. `candidateRoutes` are the controller route
 * paths (e.g. `internal/team`, `internal/team/ping`) found in the owner stack's template — the
 * caller intersects them with the app's actual controller routes to identify the owning controller
 * stack. No logical-id matching, no hardcoded segment names.
 */
export type NestedRootOwnerResolution = {
    kind: 'owned';
    candidateRoutes: string[];
} | {
    kind: 'not-found';
} | {
    kind: 'ambiguous';
    ownerStackLogicalIds: string[];
};
/**
 * Pure: does this template declare `rootSegment` as a direct child of the REST API root? Generic —
 * works for any segment name.
 */
export declare function templateOwnsNestedRoot(templateBody: unknown, rootSegment: string): boolean;
/**
 * Pure: walk the API Gateway resource tree in this template starting at `rootSegment` (which must be
 * a child of the API root) and return every full path under it, e.g. for an `internal/team`
 * controller: `['internal/team', 'internal/team/ping']`. These are candidate controller routes; the
 * caller matches them against the app's real controllers. Returns `[]` if the template does not own
 * the root. No hardcoded segment names — every part comes from `PathPart`.
 */
export declare function controllerRoutePathsUnderRoot(templateBody: unknown, rootSegment: string): string[];
/**
 * For each requested root segment, resolve its deployed owner stack and return the candidate
 * controller routes found in that stack's template. Throws on lookup failure (e.g. missing
 * credentials) so the caller can FAIL LOUD rather than silently guessing.
 */
export declare function resolveDeployedNestedRootOwners(parentStackName: string, rootSegments: string[], lookup: NestedRootCloudFormationLookup): Promise<Map<string, NestedRootOwnerResolution>>;
/** Default AWS-backed lookup. Uses ambient credentials/region (present in CI/CD deploy). */
export declare function createCloudFormationNestedRootLookup(): NestedRootCloudFormationLookup;

import {
    controllerRoutePathsUnderRoot,
    NestedRootCloudFormationLookup,
    resolveDeployedNestedRootOwners,
    templateOwnsNestedRoot,
} from './nested-controller-root-lookup';

// A nested stack template for the `internal/team` controller: it owns /internal (child of API root)
// and declares its own /internal/team + a /internal/team/ping route under it.
const teamOwnerTemplate = {
    Resources: {
        InternalRoot: {
            Type: 'AWS::ApiGateway::Resource',
            Properties: { PathPart: 'internal', ParentId: { 'Fn::GetAtt': [ 'restApi', 'RootResourceId' ] } },
        },
        TeamSeg: {
            Type: 'AWS::ApiGateway::Resource',
            Properties: { PathPart: 'team', ParentId: { Ref: 'InternalRoot' } },
        },
        PingSeg: {
            Type: 'AWS::ApiGateway::Resource',
            Properties: { PathPart: 'ping', ParentId: { Ref: 'TeamSeg' } },
        },
        Method: { Type: 'AWS::ApiGateway::Method', Properties: {} },
    },
};

// A sibling stack that only references /internal (does not own it) and adds its own leaf.
const notificationsSiblingTemplate = {
    Resources: {
        NotifSeg: {
            Type: 'AWS::ApiGateway::Resource',
            Properties: { PathPart: 'notifications', ParentId: { Ref: 'someImportedInternalId' } },
        },
    },
};

describe('templateOwnsNestedRoot', () => {
    it('true when the segment is a child of the API root', () => {
        expect(templateOwnsNestedRoot(teamOwnerTemplate, 'internal')).toBe(true);
    });
    it('false when the segment is not present as a root child', () => {
        expect(templateOwnsNestedRoot(notificationsSiblingTemplate, 'internal')).toBe(false);
    });
    it('generic for any segment name and safe on malformed input', () => {
        expect(templateOwnsNestedRoot({ Resources: { R: { Type: 'AWS::ApiGateway::Resource', Properties: { PathPart: 'webhooks', ParentId: { Ref: 'apiRootResourceId' } } } } }, 'webhooks')).toBe(true);
        expect(templateOwnsNestedRoot(undefined, 'internal')).toBe(false);
    });
});

describe('controllerRoutePathsUnderRoot', () => {
    it('returns every full route path under the owned root (no hardcoded names)', () => {
        expect(controllerRoutePathsUnderRoot(teamOwnerTemplate, 'internal')).toEqual([ 'internal/team', 'internal/team/ping' ]);
    });
    it('returns [] when the template does not own the root', () => {
        expect(controllerRoutePathsUnderRoot(notificationsSiblingTemplate, 'internal')).toEqual([]);
    });
});

describe('resolveDeployedNestedRootOwners', () => {
    const lookupFrom = (stacks: Array<{ logicalId: string; physicalId: string; template: unknown }>): NestedRootCloudFormationLookup => ({
        listNestedStacks: async () => stacks.map(({ logicalId, physicalId }) => ({ logicalId, physicalId })),
        getTemplate: async (id) => stacks.find((s) => s.physicalId === id)?.template ?? {},
    });

    it('returns the candidate routes from the single owning stack', async () => {
        const lookup = lookupFrom([
            { logicalId: 'teamNS', physicalId: 'arn:team', template: teamOwnerTemplate },
            { logicalId: 'notifNS', physicalId: 'arn:notif', template: notificationsSiblingTemplate },
        ]);
        const result = await resolveDeployedNestedRootOwners('app-main', [ 'internal' ], lookup);
        expect(result.get('internal')).toEqual({ kind: 'owned', candidateRoutes: [ 'internal/team', 'internal/team/ping' ] });
    });

    it('not-found for a greenfield root no deployed stack owns', async () => {
        const lookup = lookupFrom([ { logicalId: 'teamNS', physicalId: 'arn:team', template: teamOwnerTemplate } ]);
        expect((await resolveDeployedNestedRootOwners('m', [ 'webhooks' ], lookup)).get('webhooks')).toEqual({ kind: 'not-found' });
    });

    it('ambiguous when two stacks both own the root (dirty/mid-move state)', async () => {
        const lookup = lookupFrom([
            { logicalId: 'aNS', physicalId: 'arn:a', template: teamOwnerTemplate },
            { logicalId: 'bNS', physicalId: 'arn:b', template: teamOwnerTemplate },
        ]);
        expect((await resolveDeployedNestedRootOwners('m', [ 'internal' ], lookup)).get('internal')).toEqual({ kind: 'ambiguous', ownerStackLogicalIds: [ 'aNS', 'bNS' ] });
    });

    it('propagates lookup failures so the caller can fail loud', async () => {
        const failing: NestedRootCloudFormationLookup = {
            listNestedStacks: async () => { throw new Error('no credentials'); },
            getTemplate: async () => ({}),
        };
        await expect(resolveDeployedNestedRootOwners('m', [ 'internal' ], failing)).rejects.toThrow('no credentials');
    });
});

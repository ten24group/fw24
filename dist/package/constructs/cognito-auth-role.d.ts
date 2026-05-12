import { Construct } from "constructs";
import { PolicyStatement, PolicyStatementProps, Role } from "aws-cdk-lib/aws-iam";
import type { CfnIdentityPool } from "aws-cdk-lib/aws-cognito";
export interface ICognitoAuthRoleProps {
    identityPool: CfnIdentityPool;
    policyFilePaths?: string[];
    policies?: Array<PolicyStatementProps | PolicyStatement>;
}
export declare class CognitoAuthRole extends Construct {
    private readonly role;
    private readonly policyCollector;
    private managedPoliciesCreated;
    constructor(scope: Construct, id: string, props: ICognitoAuthRoleProps);
    /**
     * Build ManagedPolicies from the collected statements so each policy stays under the
     * 6144-byte limit, avoiding the 10240-byte inline policy limit on the role.
     */
    private createManagedPolicies;
    /** Expose the IAM Role so Auth can register it and addRouteToRolePolicy can resolve the collector. */
    getRole(): Role;
}

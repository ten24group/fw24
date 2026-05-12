import { Construct } from "constructs";
import { PolicyStatement, PolicyStatementProps, Role } from "aws-cdk-lib/aws-iam";
import type { CfnIdentityPool } from "aws-cdk-lib/aws-cognito";
export interface ICognitoAuthRoleProps {
    identityPool: CfnIdentityPool;
    policyFilePaths?: string[];
    policies?: Array<PolicyStatementProps | PolicyStatement>;
    /**
     * Max IAM managed policy document size (bytes) before splitting into another managed policy.
     * Defaults to {@link IAM_MANAGED_POLICY_DOCUMENT_MAX_BYTES} (6144).
     */
    managedPolicyMaxDocumentBytes?: number;
}
export declare class CognitoAuthRole extends Construct {
    private readonly role;
    private readonly policyCollector;
    private managedPoliciesCreated;
    private readonly managedPolicyMaxDocumentBytes;
    constructor(scope: Construct, id: string, props: ICognitoAuthRoleProps);
    /**
     * Build ManagedPolicies from the collected statements: greedy-pack each document to use
     * nearly the full IAM size limit so fewer managed policies attach to the role.
     */
    private createManagedPolicies;
    /** Expose the IAM Role so Auth can register it and addRouteToRolePolicy can resolve the collector. */
    getRole(): Role;
}

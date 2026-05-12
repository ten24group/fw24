import { Construct } from "constructs";
import { Aspects } from "aws-cdk-lib";
import { ManagedPolicy, PolicyStatement, PolicyStatementProps, Role, FederatedPrincipal } from "aws-cdk-lib/aws-iam";
import { readFileSync } from "fs";
import type { CfnIdentityPool } from "aws-cdk-lib/aws-cognito";
import { Fw24 } from "../core/fw24";
import {
    IAM_MANAGED_POLICY_DOCUMENT_MAX_BYTES,
    packPolicyStatementsIntoManagedPolicyChunks,
} from "../utils/iam-policy-chunking";

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

export class CognitoAuthRole extends Construct {
    private readonly role: Role;
    private readonly policyCollector: PolicyStatement[] = [];
    private managedPoliciesCreated = false;
    private readonly managedPolicyMaxDocumentBytes: number;

    constructor(scope: Construct, id: string, props: ICognitoAuthRoleProps) {
        super(scope, id);
        const { identityPool, policyFilePaths, policies, managedPolicyMaxDocumentBytes } = props;
        this.managedPolicyMaxDocumentBytes =
            managedPolicyMaxDocumentBytes ?? IAM_MANAGED_POLICY_DOCUMENT_MAX_BYTES;

        this.role = new Role(this, "CognitoAuthRole", {
            assumedBy: new FederatedPrincipal("cognito-identity.amazonaws.com", {
                "StringEquals": {
                    "cognito-identity.amazonaws.com:aud": identityPool.ref
                },
                "ForAnyValue:StringLike": {
                    "cognito-identity.amazonaws.com:amr": "authenticated"
                }
            }, "sts:AssumeRoleWithWebIdentity"),
        });

        if (policyFilePaths !== undefined) {
            for (const policyFilePath of policyFilePaths) {
                const policyfile: string = readFileSync(policyFilePath, 'utf8');
                this.policyCollector.push(
                    new PolicyStatement({
                        effect: JSON.parse(policyfile).Effect,
                        actions: JSON.parse(policyfile).Action,
                        resources: JSON.parse(policyfile).Resource,
                    })
                );
            }
        }
        if (policies !== undefined) {
            for (const policy of policies) {
                this.policyCollector.push(new PolicyStatement(policy));
            }
        }

        Fw24.getInstance().registerRolePolicyCollector(this.role, this.policyCollector);

        // Defer creating ManagedPolicies until prepare phase (after all addRouteToRolePolicy calls).
        const self = this;
        Aspects.of(this).add({
            visit(node: Construct): void {
                if (node === self) {
                    self.createManagedPolicies();
                }
            },
        });
    }

    /**
     * Build ManagedPolicies from the collected statements: greedy-pack each document to use
     * nearly the full IAM size limit so fewer managed policies attach to the role.
     */
    private createManagedPolicies(): void {
        if (this.managedPoliciesCreated) return;
        this.managedPoliciesCreated = true;

        const statements = this.policyCollector;
        if (statements.length === 0) return;

        const chunks = packPolicyStatementsIntoManagedPolicyChunks(
            statements,
            this.managedPolicyMaxDocumentBytes,
        );
        chunks.forEach((chunk, i) => {
            new ManagedPolicy(this, `CognitoAuthManagedPolicy${i}`, {
                description: `Cognito auth role policies (chunk ${i + 1})`,
                statements: chunk,
                roles: [ this.role ],
            });
        });
    }

    /** Expose the IAM Role so Auth can register it and addRouteToRolePolicy can resolve the collector. */
    getRole(): Role {
        return this.role;
    }
}   
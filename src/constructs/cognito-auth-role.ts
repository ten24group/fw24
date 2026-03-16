import { Construct } from "constructs";
import { Aspects } from "aws-cdk-lib";
import { ManagedPolicy, PolicyStatement, PolicyStatementProps, Role, FederatedPrincipal } from "aws-cdk-lib/aws-iam";
import { readFileSync } from "fs";
import type { CfnIdentityPool } from "aws-cdk-lib/aws-cognito";
import { Fw24 } from "../core/fw24";

/** AWS IAM managed policy document max size (bytes). We chunk below this to stay safe. */
const MANAGED_POLICY_MAX_BYTES = 6144;
/** Approximate bytes per execute-api statement in serialized policy; used to chunk. */
const BYTES_PER_STATEMENT_ESTIMATE = 120;

export interface ICognitoAuthRoleProps {
    identityPool: CfnIdentityPool;
    policyFilePaths?: string[];
    policies?: Array<PolicyStatementProps | PolicyStatement>;
}

export class CognitoAuthRole extends Construct {
    private readonly role: Role;
    private readonly policyCollector: PolicyStatement[] = [];
    private managedPoliciesCreated = false;

    constructor(scope: Construct, id: string, props: ICognitoAuthRoleProps) {
        super(scope, id);
        const { identityPool, policyFilePaths, policies } = props;

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
     * Build ManagedPolicies from the collected statements so each policy stays under the
     * 6144-byte limit, avoiding the 10240-byte inline policy limit on the role.
     */
    private createManagedPolicies(): void {
        if (this.managedPoliciesCreated) return;
        this.managedPoliciesCreated = true;

        const statements = this.policyCollector;
        if (statements.length === 0) return;

        const statementsPerChunk = Math.max(1, Math.floor((MANAGED_POLICY_MAX_BYTES - 80) / BYTES_PER_STATEMENT_ESTIMATE));
        for (let i = 0; i < statements.length; i += statementsPerChunk) {
            const chunk = statements.slice(i, i + statementsPerChunk);
            new ManagedPolicy(this, `CognitoAuthManagedPolicy${i / statementsPerChunk}`, {
                description: `Cognito auth role policies (chunk ${i / statementsPerChunk + 1})`,
                statements: chunk,
                roles: [ this.role ],
            });
        }
    }

    /** Expose the IAM Role so Auth can register it and addRouteToRolePolicy can resolve the collector. */
    getRole(): Role {
        return this.role;
    }
}   
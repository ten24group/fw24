import { Construct } from "constructs";
import { PolicyStatement, Role, FederatedPrincipal } from "aws-cdk-lib/aws-iam";
import { readFileSync } from "fs";

export class CognitoAuthRole extends Construct {

    constructor(scope: Construct, id: string, props: any) {
        super(scope, id);
        const { identityPool, policyFilePaths, policies } = props;

        const role = new Role(this, "CognitoAuthRole", {
            assumedBy: new FederatedPrincipal("cognito-identity.amazonaws.com", {
                "StringEquals": {
                    "cognito-identity.amazonaws.com:aud": identityPool.ref
                },
                "ForAnyValue:StringLike": {
                    "cognito-identity.amazonaws.com:amr": "authenticated"
                }
            }, "sts:AssumeRoleWithWebIdentity"),
        });

        if(policyFilePaths !== undefined) {
            // apply the policy to the role
            for (const policyFilePath of policyFilePaths) {
                // read file from policyFilePath
                const policyfile: string = readFileSync(policyFilePath, 'utf8');
                role.addToPolicy(
                    new PolicyStatement({
                        effect: JSON.parse(policyfile).Effect,
                        actions: JSON.parse(policyfile).Action,
                        resources: JSON.parse(policyfile).Resource,
                    })
                );
            }
        }
        if(policies !== undefined) {
            for (const policy of policies) {
                role.addToPolicy(new PolicyStatement(policy));
            }
        }
        return role;
    }
}   
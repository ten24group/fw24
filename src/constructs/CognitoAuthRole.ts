import { Construct } from "constructs";
import { PolicyStatement, Role, FederatedPrincipal } from "aws-cdk-lib/aws-iam";
import { readFileSync } from "fs";

export class CognitoAuthRole extends Construct {
    role: Role;

    constructor(scope: Construct, id: string, props: any) {

        super(scope, id);

        const { identityPool, policyFilePaths } = props;

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

        if(policyFilePaths !== undefined) {
            // apply the policy to the role
            for (const policyFilePath of policyFilePaths) {
                // read file from policyFilePath
                const policyfile: string = readFileSync(policyFilePath, 'utf8');
                this.role.addToPolicy(
                    new PolicyStatement({
                        effect: JSON.parse(policyfile).Effect,
                        actions: JSON.parse(policyfile).Action,
                        resources: JSON.parse(policyfile).Resource,
                    })
                );
            }
        }

    }
}   
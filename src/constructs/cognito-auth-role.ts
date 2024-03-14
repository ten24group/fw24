import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import { CfnIdentityPoolRoleAttachment } from "aws-cdk-lib/aws-cognito";

export class CognitoAuthRole extends Construct {
    role: iam.Role;

    constructor(scope: Construct, id: string, props: any) {

        super(scope, id);

        const { identityPool } = props;

        this.role = new iam.Role(this, "CognitoAuthRole", {
            assumedBy: new iam.FederatedPrincipal("cognito-identity.amazonaws.com", {
                "StringEquals": {
                    "cognito-identity.amazonaws.com:aud": identityPool.ref
                },
                "ForAnyValue:StringLike": {
                    "cognito-identity.amazonaws.com:amr": "authenticated"
                }
            }, "sts:AssumeRoleWithWebIdentity"),
        });
        this.role.addToPolicy( 
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    "mobileanalytics:PutEvents",
                    "cognito-sync:*",
                    "cognito-identity:*",
                ],
                resources: ["*"],
            })
        );
        new CfnIdentityPoolRoleAttachment(
            this,
            "IdentityPoolRoleAttachment",
            {
              identityPoolId: identityPool.ref,
              roles: { authenticated: this.role.roleArn },
            }
        );
    }
}   
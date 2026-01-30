import { Construct } from "constructs";
import { PolicyStatement, PolicyStatementProps } from "aws-cdk-lib/aws-iam";
import type { CfnIdentityPool } from "aws-cdk-lib/aws-cognito";
export interface ICognitoAuthRoleProps {
    identityPool: CfnIdentityPool;
    policyFilePaths?: string[];
    policies?: Array<PolicyStatementProps | PolicyStatement>;
}
export declare class CognitoAuthRole extends Construct {
    constructor(scope: Construct, id: string, props: ICognitoAuthRoleProps);
}

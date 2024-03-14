import { UserPoolProps, UserPoolOperation } from "aws-cdk-lib/aws-cognito";

export interface ICognitoConfig {
    userPool: {
        props: UserPoolProps;
    };
    policyFilePath?: string;
    triggers?: {
        trigger: UserPoolOperation;
        lambdaFunctionPath: string;
    }[];
}
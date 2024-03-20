export enum AuthorizationType {
    /**
     * Open access.
     */
    NONE = "NONE",
    /**
     * Use AWS IAM permissions.
     */
    IAM = "AWS_IAM",
    /**
     * Use a custom authorizer.
     */
    CUSTOM = "CUSTOM",
    /**
     * Use an AWS Cognito user pool.
     */
    COGNITO = "COGNITO_USER_POOLS"
}
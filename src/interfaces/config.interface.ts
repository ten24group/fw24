import { RestApiProps } from "aws-cdk-lib/aws-apigateway";

export interface IApplicationConfig {
    name: string;
    coreVersion: number;
    domain?: string;
    cors?: boolean | string | string[];
    host?: string | string[];
    controllers?: string | any[];
    handlers?: string;
    region: string;
    account?: string;
    apiOptions?: RestApiProps;
    use?: any[];
    defaultAuthorizationType?: any;
}

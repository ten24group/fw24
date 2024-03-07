import { RestApiProps } from "aws-cdk-lib/aws-apigateway";

export interface IAPIGatewayConfig {
    cors?: boolean | string | string[];
    apiOptions?: RestApiProps;
}

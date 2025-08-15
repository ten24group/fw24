import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutput } from "../interfaces/construct";
import { VpcProps, IPeer, Port } from 'aws-cdk-lib/aws-ec2';
import { Stack } from "aws-cdk-lib";
import { IConstructConfig } from "../interfaces/construct-config";
export declare enum SecurityGroupType {
    INGRESS = "ingress",
    EGRESS = "egress"
}
export interface ISecurityGroupConfig {
    securityGroupName: string;
    rules: [
        {
            type: SecurityGroupType;
            ip: IPeer;
            port: Port;
            description: string;
        }
    ];
}
/**
 * Represents the configuration for a vpc construct.
 */
export interface IVpcConstructConfig extends IConstructConfig {
    vpcName?: string;
    vpcProps?: VpcProps;
    securityGroups?: ISecurityGroupConfig[];
    enableECREndpoint?: boolean;
    enableECRDockerEndpoint?: boolean;
    enableS3Endpoint?: boolean;
    enableCloudWatchLogsEndpoint?: boolean;
    enableEFSEndpoint?: boolean;
}
export declare class VpcConstruct implements FW24Construct {
    private vpcConstructConfig;
    readonly logger: import("tslog").Logger<import("tslog").ILogObj>;
    readonly fw24: Fw24;
    name: string;
    dependencies: string[];
    output: FW24ConstructOutput;
    mainStack: Stack;
    constructor(vpcConstructConfig: IVpcConstructConfig);
    construct(): Promise<void>;
}

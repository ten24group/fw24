import { Helper } from "../core/helper";
import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutput, OutputType } from "../interfaces/construct";
import { LogDuration, createLogger } from "../logging";
import { Vpc, VpcProps, Subnet, SecurityGroup, SecurityGroupProps, SubnetType, IPeer, Port } from 'aws-cdk-lib/aws-ec2';
import { CfnOutput, Stack } from "aws-cdk-lib";
import { IConstructConfig } from "../interfaces/construct-config";

export enum SecurityGroupType {
    INGRESS = 'ingress',
    EGRESS = 'egress'
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
    ]
}
/**
 * Represents the configuration for a vpc construct.
 */
export interface IVpcConstructConfig extends IConstructConfig {
    vpcName?: string;
    vpcProps?: VpcProps;
    securityGroups?: ISecurityGroupConfig[]
}

export class VpcConstruct implements FW24Construct {
    readonly logger = createLogger(VpcConstruct.name);
    readonly fw24: Fw24 = Fw24.getInstance();
    
    name: string = VpcConstruct.name;
    dependencies: string[] = [];
    output!: FW24ConstructOutput;

    mainStack!: Stack;

    constructor(private vpcConstructConfig: IVpcConstructConfig) {
        Helper.hydrateConfig(vpcConstructConfig,'VPC');
    }

    public async construct() {
        this.mainStack = this.fw24.getStack(this.vpcConstructConfig.stackName || 'main');

        const vpc = new Vpc(this.mainStack, this.fw24.appName+'-vpc', {
            vpcName: this.vpcConstructConfig.vpcName || this.fw24.appName + '-vpc',
            ...this.vpcConstructConfig.vpcProps
        });

        const privateSubnets = vpc.selectSubnets({
            subnetType: SubnetType.PRIVATE_WITH_EGRESS
        });

        const publicSubnets = vpc.selectSubnets({
            subnetType: SubnetType.PUBLIC
        });
        
        const defaultSecurityGroup = SecurityGroup.fromSecurityGroupId(this.mainStack, this.fw24.appName+'-DefaultSecurityGroup', vpc.vpcDefaultSecurityGroup);

        if(this.vpcConstructConfig.securityGroups && this.vpcConstructConfig.securityGroups.length > 0){
            this.vpcConstructConfig.securityGroups.forEach( (securityGroupConfig: ISecurityGroupConfig) => {
                const sg = new SecurityGroup(this.mainStack, this.fw24.appName+securityGroupConfig.securityGroupName, {
                    vpc: vpc,
                    securityGroupName: securityGroupConfig.securityGroupName,
                });

                securityGroupConfig.rules.forEach( (rule) => {
                    if(rule.type === SecurityGroupType.INGRESS){
                        sg.addIngressRule(rule.ip, rule.port, rule.description);
                    } else if(rule.type === SecurityGroupType.EGRESS){
                        sg.addEgressRule(rule.ip, rule.port, rule.description);
                    }
                });
                this.fw24.setConstructOutput(this, securityGroupConfig.securityGroupName, sg, OutputType.SECURITYGROUP);
            });
        }

        this.fw24.setConstructOutput(this, "vpc", vpc, OutputType.VPC, 'vpcId');
        this.fw24.setConstructOutput(this, "defaultSecurityGroup", defaultSecurityGroup, OutputType.SECURITYGROUP, 'securityGroupId');
        this.fw24.setConstructOutput(this, "privateSubnet", privateSubnets, OutputType.SUBNETS);
        this.fw24.setConstructOutput(this, "publicSubnet", publicSubnets, OutputType.SUBNETS);

    }
}   
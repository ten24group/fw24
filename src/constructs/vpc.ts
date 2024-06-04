import { Helper } from "../core/helper";
import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutput, OutputType } from "../interfaces/construct";
import { LogDuration, createLogger } from "../logging";
import { Vpc, VpcProps, Subnet, SecurityGroup, SecurityGroupProps, SubnetType, IPeer, Port } from 'aws-cdk-lib/aws-ec2';
import { CfnOutput } from "aws-cdk-lib";

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
export interface IVpcConstructConfig {
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

    constructor(private vpcConstructConfig: IVpcConstructConfig) {
        Helper.hydrateConfig(vpcConstructConfig,'VPC');
    }

    public async construct() {
        const mainStack = this.fw24.getStack('main');

        const vpc = new Vpc(mainStack, this.fw24.appName+'-vpc', {
            vpcName: this.vpcConstructConfig.vpcName || this.fw24.appName + '-vpc',
            ...this.vpcConstructConfig.vpcProps
        });

        const privateSubnets = vpc.selectSubnets({
            subnetType: SubnetType.PRIVATE_WITH_EGRESS
        });

        const publicSubnets = vpc.selectSubnets({
            subnetType: SubnetType.PUBLIC
        });
        
        const defaultSecurityGroup = SecurityGroup.fromSecurityGroupId(mainStack, this.fw24.appName+'-DefaultSecurityGroup', vpc.vpcDefaultSecurityGroup);

        if(this.vpcConstructConfig.securityGroups && this.vpcConstructConfig.securityGroups.length > 0){
            this.vpcConstructConfig.securityGroups.forEach( (securityGroupConfig: ISecurityGroupConfig) => {
                const sg = new SecurityGroup(mainStack, this.fw24.appName+securityGroupConfig.securityGroupName, {
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

        this.fw24.setConstructOutput(this, "vpc", vpc, OutputType.VPC);
        this.fw24.setConstructOutput(this, "defaultSecurityGroup", defaultSecurityGroup, OutputType.SECURITYGROUP);
        this.fw24.setConstructOutput(this, "privateSubnet", privateSubnets, OutputType.SUBNETS);
        this.fw24.setConstructOutput(this, "publicSubnet", publicSubnets, OutputType.SUBNETS);

        new CfnOutput(mainStack, 'vpcId', {
            value: vpc.vpcId,
        });
    }
}   
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Ec2Construct = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_ec2_1 = require("aws-cdk-lib/aws-ec2");
const aws_ecr_assets_1 = require("aws-cdk-lib/aws-ecr-assets");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const aws_servicediscovery_1 = require("aws-cdk-lib/aws-servicediscovery");
const path = __importStar(require("path"));
const aws_ecr_assets_2 = require("aws-cdk-lib/aws-ecr-assets");
const helper_1 = require("../core/helper");
const fw24_1 = require("../core/fw24");
const construct_1 = require("../interfaces/construct");
const logging_1 = require("../logging");
const vpc_1 = require("./vpc");
class Ec2Construct {
    ec2Config;
    logger = (0, logging_1.createLogger)(Ec2Construct.name);
    fw24 = fw24_1.Fw24.getInstance();
    name = Ec2Construct.name;
    dependencies = [vpc_1.VpcConstruct.name];
    output;
    mainStack;
    instance;
    vpc;
    cloudMapService;
    /**
     * Creates a new EC2 construct with the specified configuration.
     * Initializes default values and merges user-provided configuration.
     *
     * @param ec2Config - The configuration object for the EC2 instance
     */
    constructor(ec2Config) {
        this.ec2Config = ec2Config;
        helper_1.Helper.hydrateConfig(ec2Config, 'EC2');
        // Set default instance configuration if not provided
        if (!this.ec2Config.instanceProps) {
            this.ec2Config.instanceProps = {};
        }
    }
    /**
     * Creates an IAM instance role for the EC2 instance with specified permissions.
     * This role defines what AWS services the instance can access.
     *
     * @returns The created IAM Role instance with configured permissions
     * @private
     */
    createInstanceRole() {
        const role = new aws_iam_1.Role(this.mainStack, `${this.ec2Config.instanceName}-instance-role`, {
            roleName: this.ec2Config.instanceRole?.roleName,
            assumedBy: new aws_iam_1.ServicePrincipal('ec2.amazonaws.com'),
            description: `Instance role for ${this.ec2Config.instanceName} EC2 instance`,
        });
        if (this.ec2Config.instanceRole) {
            // Attach managed policies by ARN
            this.ec2Config.instanceRole.managedPolicyArns?.forEach((policyArn, index) => {
                role.addManagedPolicy(aws_iam_1.ManagedPolicy.fromManagedPolicyArn(this.mainStack, `${this.ec2Config.instanceName}-instance-managed-policy-${index}`, policyArn));
            });
            // Attach managed policies
            this.ec2Config.instanceRole.managedPolicies?.forEach(policy => {
                role.addManagedPolicy(policy);
            });
            // Add inline policies
            this.ec2Config.instanceRole.inlinePolicies?.forEach(statement => {
                role.addToPolicy(statement);
            });
        }
        // Add default permissions for ECR access (to pull Docker images)
        role.addToPolicy(new aws_iam_1.PolicyStatement({
            actions: [
                'ecr:GetAuthorizationToken',
                'ecr:BatchCheckLayerAvailability',
                'ecr:GetDownloadUrlForLayer',
                'ecr:BatchGetImage'
            ],
            resources: ['*']
        }));
        // Add Cloud Map permissions if service discovery is configured
        if (this.ec2Config.serviceDiscovery) {
            role.addToPolicy(new aws_iam_1.PolicyStatement({
                actions: [
                    'servicediscovery:RegisterInstance',
                    'servicediscovery:DeregisterInstance',
                    'servicediscovery:GetInstance',
                    'servicediscovery:UpdateInstanceCustomHealthStatus'
                ],
                resources: ['*']
            }));
        }
        // Add SSM Session Manager permissions (for keyless access via AWS Console)
        role.addToPolicy(new aws_iam_1.PolicyStatement({
            actions: [
                'ssmmessages:CreateControlChannel',
                'ssmmessages:CreateDataChannel',
                'ssmmessages:OpenControlChannel',
                'ssmmessages:OpenDataChannel'
            ],
            resources: ['*']
        }));
        // Add EC2 Instance Connect and SSM permissions
        role.addManagedPolicy(aws_iam_1.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));
        // Add CloudWatch Logs permissions
        role.addToPolicy(new aws_iam_1.PolicyStatement({
            actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
                'logs:DescribeLogStreams'
            ],
            resources: ['*']
        }));
        return role;
    }
    /**
     * Builds Docker user data script to install Docker and run the container
     *
     * @param dockerImageUri - The URI of the Docker image to run
     * @returns The user data script as a string
     * @private
     */
    buildDockerUserData(dockerImageUri) {
        const containerName = this.ec2Config.container.containerName || this.ec2Config.instanceName;
        const containerPort = this.ec2Config.container.containerPort;
        // Build environment variables
        let envVars = '';
        if (this.ec2Config.container.environment) {
            envVars = Object.entries(this.ec2Config.container.environment)
                .map(([key, value]) => `-e ${key}="${value}"`)
                .join(' ');
        }
        // Build docker run options & command
        const dockerRunOptions = this.ec2Config.container.dockerRunOptions?.join(' ') || '';
        const command = this.ec2Config.container.command ? this.ec2Config.container.command.join(' ') : '';
        let dockerRunCmd = `docker run -d --name ${containerName} --restart unless-stopped`;
        if (dockerRunOptions) {
            dockerRunCmd += ` ${dockerRunOptions}`;
        }
        if (envVars) {
            dockerRunCmd += ` ${envVars}`;
        }
        // IMPORTANT: awslogs options must appear BEFORE the image reference
        dockerRunCmd += ` -p ${containerPort}:${containerPort} --log-driver awslogs --log-opt awslogs-region=$REGION --log-opt awslogs-group=$LOG_GROUP --log-opt awslogs-stream=$INSTANCE_ID ${dockerImageUri}`;
        if (command) {
            dockerRunCmd += ` ${command}`;
        }
        // If service discovery is configured, inject the Service ID so registration can be done inline
        const serviceIdLine = this.cloudMapService
            ? `SERVICE_ID="${this.cloudMapService.serviceId}"`
            : `SERVICE_ID=""`;
        return `#!/bin/bash
set -euo pipefail

# -------- Minimal setup: IMDSv2, region, ids --------
TOKEN=$(curl -sS -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" || true)
IMDS_HDR=""
if [ -n "\${TOKEN:-}" ]; then IMDS_HDR="-H X-aws-ec2-metadata-token:\${TOKEN}"; fi

REGION=$(curl -sS \$IMDS_HDR http://169.254.169.254/latest/meta-data/placement/region)
INSTANCE_ID=$(curl -sS \$IMDS_HDR http://169.254.169.254/latest/meta-data/instance-id)
PRIVATE_IP=$(curl -sS \$IMDS_HDR http://169.254.169.254/latest/meta-data/local-ipv4)

# -------- Install Docker + AWS CLI (minimal) --------
dnf -y install docker awscli || (dnf -y update && dnf -y install docker awscli)
systemctl enable --now docker

# -------- ECR login --------
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws ecr get-login-password --region "\$REGION" | docker login --username AWS --password-stdin "\${ACCOUNT_ID}.dkr.ecr.\${REGION}.amazonaws.com"

# -------- CloudWatch Logs: create group for container logs --------
LOG_GROUP="/aws/ec2/${this.ec2Config.instanceName}/container"
aws logs create-log-group --log-group-name "\$LOG_GROUP" --region "\$REGION" 2>/dev/null || true
aws logs put-retention-policy --log-group-name "\$LOG_GROUP" --retention-in-days 7 --region "\$REGION" 2>/dev/null || true

# -------- (Optional) Cloud Map registration --------
${serviceIdLine}
if [ -n "\${SERVICE_ID:-}" ]; then
  # wait briefly for role credentials
  for i in \$(seq 1 18); do
    if aws sts get-caller-identity >/dev/null 2>&1; then break; fi
    sleep 5
  done
  aws servicediscovery register-instance \
    --service-id "\$SERVICE_ID" \
    --instance-id "\$INSTANCE_ID" \
    --attributes AWS_INSTANCE_IPV4="\$PRIVATE_IP",AWS_INSTANCE_PORT="${containerPort}" \
    --region "\$REGION" \
    >/tmp/sd.out 2>/tmp/sd.err || true
fi

# -------- Run container (logs go to CloudWatch via awslogs driver) --------
docker rm -f ${containerName} >/dev/null 2>&1 || true
${dockerRunCmd}
`;
    }
    /**
     * Constructs all necessary AWS resources for the EC2 instance.
     * This includes VPC, security groups, instance configuration, Docker setup, and volumes.
     *
     * @returns Promise that resolves when all resources are created
     * @public
     */
    async construct() {
        this.mainStack = this.fw24.getStack(this.ec2Config.stackName, this.ec2Config.parentStackName);
        // Get VPC first as it's needed for all other resources
        this.vpc = this.getVpc();
        // Get or create Security Group
        const securityGroup = this.getOrCreateSecurityGroup();
        // Get subnet
        const subnet = this.getSubnet();
        // Create instance role
        const instanceRole = this.createInstanceRole();
        // Build Docker image
        const dockerImage = new aws_ecr_assets_1.DockerImageAsset(this.mainStack, `${this.ec2Config.instanceName}-image`, {
            directory: path.dirname(this.ec2Config.container.dockerFilePath),
            file: path.basename(this.ec2Config.container.dockerFilePath),
            platform: this.ec2Config.dockerImageProps?.platform || aws_ecr_assets_2.Platform.LINUX_AMD64,
            ...this.ec2Config.dockerImageProps,
        });
        // Configure service discovery if specified (must be done before user data)
        if (this.ec2Config.serviceDiscovery) {
            this.configureServiceDiscovery();
        }
        // Build user data script
        const userData = aws_ec2_1.UserData.custom(this.buildDockerUserData(dockerImage.imageUri));
        // Merge user-provided user data if exists
        const { userData: customUserData, ...restInstanceProps } = this.ec2Config.instanceProps || {};
        if (customUserData) {
            // Combine user data scripts
            userData.addCommands(...customUserData.render().split('\n').filter(line => line.trim()));
        }
        // Prepare block devices for volumes
        const blockDevices = [];
        if (this.ec2Config.volumes) {
            // Device names for EBS volumes typically start from /dev/sdf
            // Standard EBS device names: sdf, sdg, sdh, sdi, sdj, sdk, sdl, sdm, sdn, sdo, sdp
            const getDefaultDeviceName = (index) => {
                const deviceSuffixes = ['f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p'];
                const suffix = deviceSuffixes[index] || String.fromCharCode(102 + index); // 102 is 'f' in ASCII
                return `/dev/sd${suffix}`;
            };
            this.ec2Config.volumes.forEach((volumeConfig, index) => {
                let volume;
                // If volume is explicitly provided, use it
                if (volumeConfig.volume) {
                    volume = volumeConfig.volume;
                }
                // If only size is provided, create GP3 volume with defaults
                else if (volumeConfig.sizeGiB) {
                    volume = aws_ec2_1.BlockDeviceVolume.ebs(volumeConfig.sizeGiB, {
                        volumeType: aws_ec2_1.EbsDeviceVolumeType.GP3,
                        encrypted: true,
                    });
                }
                // Error if neither is provided
                else {
                    const deviceNameStr = volumeConfig.deviceName || getDefaultDeviceName(index);
                    throw new Error(`Volume configuration for device ${deviceNameStr} must specify either 'volume' or 'sizeGiB'`);
                }
                // Generate device name if not provided
                const deviceName = volumeConfig.deviceName || getDefaultDeviceName(index);
                blockDevices.push({
                    deviceName: deviceName,
                    volume: volume
                });
            });
        }
        // Create EC2 instance, merging with user-provided props
        this.instance = new aws_ec2_1.Instance(this.mainStack, `${this.ec2Config.instanceName}-instance`, {
            vpc: this.vpc,
            vpcSubnets: subnet ? { subnets: [subnet] } : { subnetType: this.ec2Config.subnetConfig?.subnetType || aws_ec2_1.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroup: securityGroup,
            role: instanceRole,
            instanceType: aws_ec2_1.InstanceType.of(aws_ec2_1.InstanceClass.T3, aws_ec2_1.InstanceSize.MICRO),
            machineImage: aws_ec2_1.MachineImage.latestAmazonLinux2023({
                cpuType: aws_ec2_1.AmazonLinuxCpuType.X86_64,
            }),
            userData: userData,
            blockDevices: blockDevices.length > 0 ? blockDevices : undefined,
            ...restInstanceProps,
        });
        // Set outputs
        this.fw24.setConstructOutput(this, this.ec2Config.instanceName, this.instance, construct_1.OutputType.INSTANCE);
        this.fw24.setEnvironmentVariable(`${this.ec2Config.instanceName}InstanceId`, this.instance.instanceId);
        this.fw24.setEnvironmentVariable(`${this.ec2Config.instanceName}InstancePrivateIp`, this.instance.instancePrivateIp);
        this.fw24.setEnvironmentVariable(`${this.ec2Config.instanceName}InstancePublicIp`, this.instance.instancePublicIp || '');
    }
    /**
     * Gets the VPC for the EC2 instance either from the provided configuration or looks it up by name.
     *
     * @returns The VPC instance to be used for the EC2 instance
     * @throws Error if neither VPC name nor VPC instance is provided
     * @private
     */
    getVpc() {
        if (!this.ec2Config.vpcName && !this.ec2Config.vpc) {
            throw new Error('VPC Name or VPC must be specified in the EC2 configuration');
        }
        if (this.ec2Config.vpc) {
            return this.ec2Config.vpc;
        }
        return aws_ec2_1.Vpc.fromLookup(this.mainStack, `${this.ec2Config.instanceName}-vpc`, {
            vpcName: this.ec2Config.vpcName
        });
    }
    /**
     * Gets the subnet for the EC2 instance either from the provided configuration or returns undefined.
     *
     * @returns The subnet instance or undefined if using subnet type
     * @private
     */
    getSubnet() {
        if (this.ec2Config.subnet?.subnetId) {
            return aws_ec2_1.Subnet.fromSubnetId(this.mainStack, `${this.ec2Config.instanceName}-imported-subnet`, this.ec2Config.subnet.subnetId);
        }
        return undefined;
    }
    /**
     * Gets an existing security group or creates a new one for the EC2 instance.
     * If a security group ID is provided, it will use that group.
     * Otherwise, it creates a new security group with appropriate ingress rules.
     *
     * @returns The security group instance
     * @private
     */
    getOrCreateSecurityGroup() {
        if (this.ec2Config.securityGroup?.securityGroupId) {
            return aws_ec2_1.SecurityGroup.fromSecurityGroupId(this.mainStack, `${this.ec2Config.instanceName}-imported-sg`, this.ec2Config.securityGroup.securityGroupId);
        }
        const securityGroup = new aws_ec2_1.SecurityGroup(this.mainStack, `${this.ec2Config.instanceName}-sg`, {
            vpc: this.vpc,
            allowAllOutbound: true,
            description: `Security group for ${this.ec2Config.instanceName} EC2 instance`,
            ...this.ec2Config.securityGroup?.props,
        });
        // Allow inbound traffic on container port from within VPC
        securityGroup.addIngressRule(aws_ec2_1.Peer.ipv4(this.vpc.vpcCidrBlock), aws_ec2_1.Port.tcp(this.ec2Config.container.containerPort), 'Allow inbound traffic on container port from within VPC');
        // Allow SSH access from VPC (optional, can be removed for production)
        securityGroup.addIngressRule(aws_ec2_1.Peer.ipv4(this.vpc.vpcCidrBlock), aws_ec2_1.Port.tcp(22), 'Allow SSH access from within VPC');
        this.fw24.setConstructOutput(this, `${this.ec2Config.instanceName}-sg`, securityGroup, construct_1.OutputType.SECURITYGROUP);
        return securityGroup;
    }
    /**
     * Configures service discovery for the EC2 instance.
     * Creates a private DNS namespace and registers the service for internal discovery.
     *
     * @private
     */
    configureServiceDiscovery() {
        if (!this.ec2Config.serviceDiscovery)
            return;
        const namespace = new aws_servicediscovery_1.PrivateDnsNamespace(this.mainStack, `${this.ec2Config.instanceName}-namespace`, {
            name: this.ec2Config.serviceDiscovery.namespace,
            vpc: this.vpc,
        });
        this.cloudMapService = new aws_servicediscovery_1.Service(this.mainStack, `${this.ec2Config.instanceName}-service`, {
            namespace: namespace,
            name: this.ec2Config.serviceDiscovery.serviceName,
            dnsRecordType: aws_servicediscovery_1.DnsRecordType.A,
            dnsTtl: aws_cdk_lib_1.Duration.seconds(60),
        });
        this.fw24.setConstructOutput(this, `${this.ec2Config.instanceName}-discovery`, this.cloudMapService, construct_1.OutputType.SERVICE_DISCOVERY);
    }
}
exports.Ec2Construct = Ec2Construct;
__decorate([
    (0, logging_1.LogDuration)()
], Ec2Construct.prototype, "construct", null);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWMyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvZWMyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLDZDQUE2RDtBQUM3RCxpREF5QjZCO0FBQzdCLCtEQUFxRjtBQUNyRixpREFBNkY7QUFDN0YsMkVBQStGO0FBQy9GLDJDQUE2QjtBQUM3QiwrREFBc0Q7QUFFdEQsMkNBQXdDO0FBQ3hDLHVDQUFvQztBQUNwQyx1REFBeUY7QUFFekYsd0NBQXVEO0FBQ3ZELCtCQUFxQztBQWlSckMsTUFBYSxZQUFZO0lBbUJEO0lBbEJYLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3pDLElBQUksR0FBUyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7SUFFekMsSUFBSSxHQUFXLFlBQVksQ0FBQyxJQUFJLENBQUM7SUFDakMsWUFBWSxHQUFhLENBQUMsa0JBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUM3QyxNQUFNLENBQXVCO0lBRTdCLFNBQVMsQ0FBUztJQUNWLFFBQVEsQ0FBWTtJQUNwQixHQUFHLENBQVE7SUFDWCxlQUFlLENBQVc7SUFFbEM7Ozs7O09BS0c7SUFDSCxZQUFvQixTQUE4QjtRQUE5QixjQUFTLEdBQVQsU0FBUyxDQUFxQjtRQUM5QyxlQUFNLENBQUMsYUFBYSxDQUFDLFNBQVMsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV2QyxxREFBcUQ7UUFDckQsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDaEMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxhQUFhLEdBQUcsRUFBRSxDQUFDO1FBQ3RDLENBQUM7SUFDTCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0ssa0JBQWtCO1FBQ3RCLE1BQU0sSUFBSSxHQUFHLElBQUksY0FBSSxDQUFDLElB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RUgsSUFBSSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLEVBQUUsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLFlBQVksWUFBWSxFQUFFLElBQUksQ0FBQyxlQUFlLEVBQUUsc0JBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO0lBQ3ZJLENBQUM7Q0FFSjtBQXhhRCxvQ0F3YUM7QUFuTmdCO0lBRFosSUFBQSxxQkFBVyxHQUFFOzZDQXlHYiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFN0YWNrLCBSZW1vdmFsUG9saWN5LCBEdXJhdGlvbiB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHtcbiAgICBWcGMsXG4gICAgSW5zdGFuY2UsXG4gICAgSW5zdGFuY2VUeXBlLFxuICAgIEluc3RhbmNlQ2xhc3MsXG4gICAgSW5zdGFuY2VTaXplLFxuICAgIE1hY2hpbmVJbWFnZSxcbiAgICBTZWN1cml0eUdyb3VwLFxuICAgIFNlY3VyaXR5R3JvdXBQcm9wcyxcbiAgICBQb3J0LFxuICAgIFN1Ym5ldFR5cGUsXG4gICAgSVNlY3VyaXR5R3JvdXAsXG4gICAgUGVlcixcbiAgICBJVnBjLFxuICAgIElTdWJuZXQsXG4gICAgU3VibmV0LFxuICAgIFVzZXJEYXRhLFxuICAgIFZvbHVtZSxcbiAgICBCbG9ja0RldmljZVZvbHVtZSxcbiAgICBFYnNEZXZpY2VWb2x1bWVUeXBlLFxuICAgIElWb2x1bWUsXG4gICAgQW1hem9uTGludXhDcHVUeXBlLFxuICAgIEFtYXpvbkxpbnV4R2VuZXJhdGlvbixcbiAgICBBbWF6b25MaW51eEltYWdlLFxuICAgIEluc3RhbmNlUHJvcHNcbn0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgeyBEb2NrZXJJbWFnZUFzc2V0LCBEb2NrZXJJbWFnZUFzc2V0UHJvcHMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWVjci1hc3NldHNcIjtcbmltcG9ydCB7IFBvbGljeVN0YXRlbWVudCwgTWFuYWdlZFBvbGljeSwgUm9sZSwgU2VydmljZVByaW5jaXBhbCB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0IHsgUHJpdmF0ZURuc05hbWVzcGFjZSwgU2VydmljZSwgRG5zUmVjb3JkVHlwZSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZXJ2aWNlZGlzY292ZXJ5JztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBQbGF0Zm9ybSB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZWNyLWFzc2V0c1wiO1xuXG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tIFwiLi4vY29yZS9oZWxwZXJcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBGVzI0Q29uc3RydWN0LCBGVzI0Q29uc3RydWN0T3V0cHV0LCBPdXRwdXRUeXBlIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvY29uc3RydWN0XCI7XG5pbXBvcnQgeyBJQ29uc3RydWN0Q29uZmlnIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvY29uc3RydWN0LWNvbmZpZ1wiO1xuaW1wb3J0IHsgTG9nRHVyYXRpb24sIGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBWcGNDb25zdHJ1Y3QgfSBmcm9tIFwiLi92cGNcIjtcblxuLyoqXG4gKiBFeGFtcGxlcyBvZiB1c2luZyB0aGUgRUMyIENvbnN0cnVjdFxuICogXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gRXhhbXBsZSAxOiBCYXNpYyBFQzIgaW5zdGFuY2Ugd2l0aCBEb2NrZXIgY29udGFpbmVyXG4gKiBjb25zdCBlYzJJbnN0YW5jZSA9IG5ldyBFYzJDb25zdHJ1Y3Qoe1xuICogICBpbnN0YW5jZU5hbWU6ICdteS1hcHAnLFxuICogICB2cGNOYW1lOiAnbWFpbi12cGMnLFxuICogICBjb250YWluZXI6IHtcbiAqICAgICBkb2NrZXJGaWxlUGF0aDogJy4vc3JjL2FwcC9Eb2NrZXJmaWxlJyxcbiAqICAgICBjb250YWluZXJQb3J0OiAzMDAwLFxuICogICAgIGVudmlyb25tZW50OiB7XG4gKiAgICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxuICogICAgICAgQVBJX1ZFUlNJT046ICd2MSdcbiAqICAgICB9XG4gKiAgIH0sXG4gKiAgIGluc3RhbmNlUHJvcHM6IHtcbiAqICAgICBpbnN0YW5jZVR5cGU6IEluc3RhbmNlVHlwZS5vZihJbnN0YW5jZUNsYXNzLlQzLCBJbnN0YW5jZVNpemUuTUVESVVNKSxcbiAqICAgfSxcbiAqICAgdm9sdW1lczogW3tcbiAqICAgICBzaXplR2lCOiAyMCAgLy8gU2ltcGxpZmllZDogYXV0by1nZW5lcmF0ZXMgZGV2aWNlIG5hbWUgYW5kIGRlZmF1bHRzIHRvIEdQMyB3aXRoIGVuY3J5cHRpb25cbiAqICAgfV1cbiAqICAgLy8gT3Igc3BlY2lmeSBkZXZpY2UgbmFtZSBleHBsaWNpdGx5OlxuICogICAvLyB2b2x1bWVzOiBbe1xuICogICAvLyAgIGRldmljZU5hbWU6ICcvZGV2L3NkZicsXG4gKiAgIC8vICAgc2l6ZUdpQjogMjBcbiAqICAgLy8gfV1cbiAqICAgLy8gT3IgdXNlIGZ1bGwgY29uZmlndXJhdGlvbjpcbiAqICAgLy8gdm9sdW1lczogW3tcbiAqICAgLy8gICBkZXZpY2VOYW1lOiAnL2Rldi9zZGYnLFxuICogICAvLyAgIHZvbHVtZTogQmxvY2tEZXZpY2VWb2x1bWUuZWJzKDIwLCB7XG4gKiAgIC8vICAgICB2b2x1bWVUeXBlOiBFYnNEZXZpY2VWb2x1bWVUeXBlLkdQMyxcbiAqICAgLy8gICAgIGVuY3J5cHRlZDogdHJ1ZVxuICogICAvLyAgIH0pXG4gKiAgIC8vIH1dXG4gKiB9KTtcbiAqIFxuICogLy8gRXhhbXBsZSAyOiBFQzIgaW5zdGFuY2Ugd2l0aCBjdXN0b20gc3VibmV0IGFuZCBzZWN1cml0eSBncm91cFxuICogY29uc3QgY3VzdG9tSW5zdGFuY2UgPSBuZXcgRWMyQ29uc3RydWN0KHtcbiAqICAgaW5zdGFuY2VOYW1lOiAnd29ya2VyJyxcbiAqICAgdnBjTmFtZTogJ21haW4tdnBjJyxcbiAqICAgc3VibmV0OiB7XG4gKiAgICAgc3VibmV0SWQ6ICdzdWJuZXQtMTIzNDUnXG4gKiAgIH0sXG4gKiAgIHNlY3VyaXR5R3JvdXA6IHtcbiAqICAgICBzZWN1cml0eUdyb3VwSWQ6ICdzZy1leGlzdGluZydcbiAqICAgfSxcbiAqICAgY29udGFpbmVyOiB7XG4gKiAgICAgZG9ja2VyRmlsZVBhdGg6ICcuL3NyYy93b3JrZXIvRG9ja2VyZmlsZScsXG4gKiAgICAgY29udGFpbmVyUG9ydDogODA4MCxcbiAqICAgICBlbnZpcm9ubWVudDoge1xuICogICAgICAgUVVFVUVfVVJMOiAnaHR0cHM6Ly9zcXMucmVnaW9uLmFtYXpvbmF3cy5jb20vYWNjb3VudC9xdWV1ZSdcbiAqICAgICB9LFxuICogICAgIGNvbW1hbmQ6IFsnbnBtJywgJ3N0YXJ0J11cbiAqICAgfSxcbiAqICAgaW5zdGFuY2VQcm9wczoge1xuICogICAgIGluc3RhbmNlVHlwZTogSW5zdGFuY2VUeXBlLm9mKEluc3RhbmNlQ2xhc3MuVDMsIEluc3RhbmNlU2l6ZS5MQVJHRSksXG4gKiAgICAgdXNlckRhdGE6IFVzZXJEYXRhLmN1c3RvbSgnIyBDdXN0b20gdXNlciBkYXRhIHNjcmlwdCcpXG4gKiAgIH0sXG4gKiAgIHZvbHVtZXM6IFt7XG4gKiAgICAgZGV2aWNlTmFtZTogJy9kZXYvc2RmJyxcbiAqICAgICB2b2x1bWU6IEJsb2NrRGV2aWNlVm9sdW1lLmVicygxMDAsIHtcbiAqICAgICAgIHZvbHVtZVR5cGU6IEVic0RldmljZVZvbHVtZVR5cGUuSU8xLFxuICogICAgICAgaW9wczogMzAwMCxcbiAqICAgICAgIGVuY3J5cHRlZDogdHJ1ZVxuICogICAgIH0pXG4gKiAgIH1dXG4gKiB9KTtcbiAqIFxuICogLy8gRXhhbXBsZSAzOiBFQzIgaW5zdGFuY2UgaW4gcHJpdmF0ZSBzdWJuZXQgd2l0aCBleGlzdGluZyBWUENcbiAqIGNvbnN0IHByaXZhdGVJbnN0YW5jZSA9IG5ldyBFYzJDb25zdHJ1Y3Qoe1xuICogICBpbnN0YW5jZU5hbWU6ICdpbnRlcm5hbC1zZXJ2aWNlJyxcbiAqICAgdnBjOiBleGlzdGluZ1ZwYyxcbiAqICAgc3VibmV0Q29uZmlnOiB7XG4gKiAgICAgc3VibmV0VHlwZTogU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTXG4gKiAgIH0sXG4gKiAgIGNvbnRhaW5lcjoge1xuICogICAgIGRvY2tlckZpbGVQYXRoOiAnLi9zcmMvaW50ZXJuYWwvRG9ja2VyZmlsZScsXG4gKiAgICAgY29udGFpbmVyUG9ydDogOTAwMFxuICogICB9LFxuICogICBpbnN0YW5jZVByb3BzOiB7XG4gKiAgICAgaW5zdGFuY2VUeXBlOiBJbnN0YW5jZVR5cGUub2YoSW5zdGFuY2VDbGFzcy5UMywgSW5zdGFuY2VTaXplLlNNQUxMKSxcbiAqICAgfVxuICogfSk7XG4gKiBcbiAqIC8vIEFkZCB0byB5b3VyIGFwcGxpY2F0aW9uXG4gKiBjb25zdCBhcHAgPSBuZXcgQXBwbGljYXRpb24oKVxuICogICAudXNlKGVjMkluc3RhbmNlKVxuICogICAudXNlKGN1c3RvbUluc3RhbmNlKVxuICogICAudXNlKHByaXZhdGVJbnN0YW5jZSlcbiAqICAgLnJ1bigpO1xuICogYGBgXG4gKi9cblxuZXhwb3J0IGludGVyZmFjZSBJRWMyQ29udGFpbmVyQ29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBQYXRoIHRvIHRoZSBEb2NrZXJmaWxlXG4gICAgICovXG4gICAgZG9ja2VyRmlsZVBhdGg6IHN0cmluZztcbiAgICAvKipcbiAgICAgKiBDb250YWluZXIgcG9ydCB0byBleHBvc2VcbiAgICAgKi9cbiAgICBjb250YWluZXJQb3J0OiBudW1iZXI7XG4gICAgLyoqXG4gICAgICogRW52aXJvbm1lbnQgdmFyaWFibGVzIHRvIHBhc3MgdG8gdGhlIGNvbnRhaW5lclxuICAgICAqL1xuICAgIGVudmlyb25tZW50PzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgICAvKipcbiAgICAgKiBEb2NrZXIgY29tbWFuZCB0byBydW4gKG9wdGlvbmFsKVxuICAgICAqL1xuICAgIGNvbW1hbmQ/OiBzdHJpbmdbXTtcbiAgICAvKipcbiAgICAgKiBEb2NrZXIgY29udGFpbmVyIG5hbWUgKG9wdGlvbmFsKVxuICAgICAqL1xuICAgIGNvbnRhaW5lck5hbWU/OiBzdHJpbmc7XG4gICAgLyoqXG4gICAgICogQWRkaXRpb25hbCBkb2NrZXIgcnVuIG9wdGlvbnMgKG9wdGlvbmFsKVxuICAgICAqL1xuICAgIGRvY2tlclJ1bk9wdGlvbnM/OiBzdHJpbmdbXTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBJRWMyU2VjdXJpdHlHcm91cENvbmZpZyB7XG4gICAgLyoqXG4gICAgICogSUQgb2YgYW4gZXhpc3Rpbmcgc2VjdXJpdHkgZ3JvdXAgdG8gdXNlXG4gICAgICovXG4gICAgc2VjdXJpdHlHcm91cElkPzogc3RyaW5nO1xuICAgIC8qKlxuICAgICAqIFByb3BlcnRpZXMgZm9yIGNyZWF0aW5nIGEgbmV3IHNlY3VyaXR5IGdyb3VwXG4gICAgICovXG4gICAgcHJvcHM/OiBTZWN1cml0eUdyb3VwUHJvcHM7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSUVjMlN1Ym5ldENvbmZpZyB7XG4gICAgLyoqXG4gICAgICogSUQgb2YgYW4gZXhpc3Rpbmcgc3VibmV0IHRvIHVzZVxuICAgICAqL1xuICAgIHN1Ym5ldElkPzogc3RyaW5nO1xuICAgIC8qKlxuICAgICAqIFN1Ym5ldCB0eXBlIHRvIHVzZSAoaWYgbm90IHVzaW5nIGV4aXN0aW5nIHN1Ym5ldClcbiAgICAgKi9cbiAgICBzdWJuZXRUeXBlPzogU3VibmV0VHlwZTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBJRWMyVm9sdW1lQ29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBEZXZpY2UgbmFtZSBmb3IgdGhlIHZvbHVtZSAoZS5nLiwgJy9kZXYvc2RmJylcbiAgICAgKiBJZiBub3Qgc3BlY2lmaWVkLCB3aWxsIGJlIGF1dG8tZ2VuZXJhdGVkIHN0YXJ0aW5nIGZyb20gJy9kZXYvc2RmJ1xuICAgICAqL1xuICAgIGRldmljZU5hbWU/OiBzdHJpbmc7XG4gICAgLyoqXG4gICAgICogQmxvY2sgZGV2aWNlIHZvbHVtZSBjb25maWd1cmF0aW9uIChvcHRpb25hbCBpZiBzaXplIGlzIHNwZWNpZmllZClcbiAgICAgKi9cbiAgICB2b2x1bWU/OiBCbG9ja0RldmljZVZvbHVtZTtcbiAgICAvKipcbiAgICAgKiBWb2x1bWUgc2l6ZSBpbiBHaUIgKG9wdGlvbmFsIGlmIHZvbHVtZSBpcyBzcGVjaWZpZWQpXG4gICAgICogSWYgb25seSBzaXplIGlzIHNwZWNpZmllZCwgZGVmYXVsdHMgdG8gR1AzIHZvbHVtZSB0eXBlIHdpdGggc3RhbmRhcmQgc2V0dGluZ3NcbiAgICAgKi9cbiAgICBzaXplR2lCPzogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIElFYzJTZXJ2aWNlRGlzY292ZXJ5Q29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBOYW1lIGZvciB0aGUgc2VydmljZSBpbiBzZXJ2aWNlIGRpc2NvdmVyeVxuICAgICAqL1xuICAgIHNlcnZpY2VOYW1lOiBzdHJpbmc7XG4gICAgLyoqXG4gICAgICogTmFtZXNwYWNlIGZvciBzZXJ2aWNlIGRpc2NvdmVyeVxuICAgICAqL1xuICAgIG5hbWVzcGFjZTogc3RyaW5nO1xufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIElBTSByb2xlIHBvbGljaWVzXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSUVjMlJvbGVQb2xpY3lDb25maWcge1xuICAgIC8qKlxuICAgICAqIExpc3Qgb2YgbWFuYWdlZCBwb2xpY3kgQVJOcyB0byBhdHRhY2ggdG8gdGhlIHJvbGVcbiAgICAgKi9cbiAgICBtYW5hZ2VkUG9saWN5QXJucz86IHN0cmluZ1tdO1xuXG4gICAgLyoqXG4gICAgICogTGlzdCBvZiBtYW5hZ2VkIHBvbGljaWVzIHRvIGF0dGFjaCB0byB0aGUgcm9sZVxuICAgICAqL1xuICAgIG1hbmFnZWRQb2xpY2llcz86IE1hbmFnZWRQb2xpY3lbXTtcblxuICAgIC8qKlxuICAgICAqIExpc3Qgb2YgaW5saW5lIHBvbGljeSBzdGF0ZW1lbnRzIHRvIGFkZCB0byB0aGUgcm9sZVxuICAgICAqL1xuICAgIGlubGluZVBvbGljaWVzPzogUG9saWN5U3RhdGVtZW50W107XG59XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBmb3IgaW5zdGFuY2Ugcm9sZXNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJRWMySW5zdGFuY2VSb2xlQ29uZmlnIGV4dGVuZHMgSUVjMlJvbGVQb2xpY3lDb25maWcge1xuICAgIC8qKlxuICAgICAqIEN1c3RvbSByb2xlIG5hbWVcbiAgICAgKi9cbiAgICByb2xlTmFtZT86IHN0cmluZztcbn1cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciB0aGUgRUMyIGNvbnN0cnVjdFxuICovXG5leHBvcnQgaW50ZXJmYWNlIElFYzJDb25zdHJ1Y3RDb25maWcgZXh0ZW5kcyBJQ29uc3RydWN0Q29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBOYW1lIG9mIHRoZSBFQzIgaW5zdGFuY2VcbiAgICAgKi9cbiAgICBpbnN0YW5jZU5hbWU6IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIENvbnRhaW5lciBjb25maWd1cmF0aW9uXG4gICAgICovXG4gICAgY29udGFpbmVyOiBJRWMyQ29udGFpbmVyQ29uZmlnO1xuXG4gICAgLyoqXG4gICAgICogVlBDIE5hbWUgdG8gdXNlIChtdXN0IGV4aXN0KVxuICAgICAqIEBleGFtcGxlICdtYWluLXZwYydcbiAgICAgKi9cbiAgICB2cGNOYW1lPzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogVlBDIGluc3RhbmNlIHRvIHVzZSAoaWYgbm90IHVzaW5nIHZwY05hbWUpXG4gICAgICovXG4gICAgdnBjPzogVnBjO1xuXG4gICAgLyoqXG4gICAgICogU3VibmV0IGNvbmZpZ3VyYXRpb25cbiAgICAgKi9cbiAgICBzdWJuZXQ/OiBJRWMyU3VibmV0Q29uZmlnO1xuXG4gICAgLyoqXG4gICAgICogU3VibmV0IHR5cGUgY29uZmlndXJhdGlvbiAoc2ltcGxpZmllZClcbiAgICAgKi9cbiAgICBzdWJuZXRDb25maWc/OiB7XG4gICAgICAgIHN1Ym5ldFR5cGU6IFN1Ym5ldFR5cGU7XG4gICAgfTtcblxuICAgIC8qKlxuICAgICAqIFNlY3VyaXR5IGdyb3VwIGNvbmZpZ3VyYXRpb25cbiAgICAgKi9cbiAgICBzZWN1cml0eUdyb3VwPzogSUVjMlNlY3VyaXR5R3JvdXBDb25maWc7XG5cbiAgICAvKipcbiAgICAgKiBJQU0gaW5zdGFuY2Ugcm9sZSBjb25maWd1cmF0aW9uXG4gICAgICovXG4gICAgaW5zdGFuY2VSb2xlPzogSUVjMkluc3RhbmNlUm9sZUNvbmZpZztcblxuICAgIC8qKlxuICAgICAqIEVCUyB2b2x1bWUgY29uZmlndXJhdGlvbnNcbiAgICAgKi9cbiAgICB2b2x1bWVzPzogSUVjMlZvbHVtZUNvbmZpZ1tdO1xuXG4gICAgLyoqXG4gICAgICogU2VydmljZSBkaXNjb3ZlcnkgY29uZmlndXJhdGlvbiAoZm9yIGludGVybmFsIEROUyByZXNvbHV0aW9uKVxuICAgICAqL1xuICAgIHNlcnZpY2VEaXNjb3Zlcnk/OiBJRWMyU2VydmljZURpc2NvdmVyeUNvbmZpZztcblxuICAgIC8qKlxuICAgICAqIENESyBJbnN0YW5jZSBjb25zdHJ1Y3QgcHJvcGVydGllc1xuICAgICAqIFRoZXNlIHByb3BlcnRpZXMgd2lsbCBiZSBtZXJnZWQgd2l0aCBvdXIgZGVmYXVsdCBjb25maWd1cmF0aW9uXG4gICAgICovXG4gICAgaW5zdGFuY2VQcm9wcz86IFBhcnRpYWw8SW5zdGFuY2VQcm9wcz47XG5cbiAgICAvKipcbiAgICAgKiBEb2NrZXIgaW1hZ2UgcHJvcGVydGllc1xuICAgICAqL1xuICAgIGRvY2tlckltYWdlUHJvcHM/OiBQYXJ0aWFsPERvY2tlckltYWdlQXNzZXRQcm9wcz47XG59XG5cbmV4cG9ydCBjbGFzcyBFYzJDb25zdHJ1Y3QgaW1wbGVtZW50cyBGVzI0Q29uc3RydWN0IHtcbiAgICByZWFkb25seSBsb2dnZXIgPSBjcmVhdGVMb2dnZXIoRWMyQ29uc3RydWN0Lm5hbWUpO1xuICAgIHJlYWRvbmx5IGZ3MjQ6IEZ3MjQgPSBGdzI0LmdldEluc3RhbmNlKCk7XG4gICAgXG4gICAgbmFtZTogc3RyaW5nID0gRWMyQ29uc3RydWN0Lm5hbWU7XG4gICAgZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFtWcGNDb25zdHJ1Y3QubmFtZV07XG4gICAgb3V0cHV0ITogRlcyNENvbnN0cnVjdE91dHB1dDtcblxuICAgIG1haW5TdGFjayE6IFN0YWNrO1xuICAgIHByaXZhdGUgaW5zdGFuY2UhOiBJbnN0YW5jZTtcbiAgICBwcml2YXRlIHZwYyE6IElWcGM7XG4gICAgcHJpdmF0ZSBjbG91ZE1hcFNlcnZpY2UhOiBTZXJ2aWNlO1xuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIG5ldyBFQzIgY29uc3RydWN0IHdpdGggdGhlIHNwZWNpZmllZCBjb25maWd1cmF0aW9uLlxuICAgICAqIEluaXRpYWxpemVzIGRlZmF1bHQgdmFsdWVzIGFuZCBtZXJnZXMgdXNlci1wcm92aWRlZCBjb25maWd1cmF0aW9uLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBlYzJDb25maWcgLSBUaGUgY29uZmlndXJhdGlvbiBvYmplY3QgZm9yIHRoZSBFQzIgaW5zdGFuY2VcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3Rvcihwcml2YXRlIGVjMkNvbmZpZzogSUVjMkNvbnN0cnVjdENvbmZpZykge1xuICAgICAgICBIZWxwZXIuaHlkcmF0ZUNvbmZpZyhlYzJDb25maWcsICdFQzInKTtcblxuICAgICAgICAvLyBTZXQgZGVmYXVsdCBpbnN0YW5jZSBjb25maWd1cmF0aW9uIGlmIG5vdCBwcm92aWRlZFxuICAgICAgICBpZiAoIXRoaXMuZWMyQ29uZmlnLmluc3RhbmNlUHJvcHMpIHtcbiAgICAgICAgICAgIHRoaXMuZWMyQ29uZmlnLmluc3RhbmNlUHJvcHMgPSB7fTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYW4gSUFNIGluc3RhbmNlIHJvbGUgZm9yIHRoZSBFQzIgaW5zdGFuY2Ugd2l0aCBzcGVjaWZpZWQgcGVybWlzc2lvbnMuXG4gICAgICogVGhpcyByb2xlIGRlZmluZXMgd2hhdCBBV1Mgc2VydmljZXMgdGhlIGluc3RhbmNlIGNhbiBhY2Nlc3MuXG4gICAgICogXG4gICAgICogQHJldHVybnMgVGhlIGNyZWF0ZWQgSUFNIFJvbGUgaW5zdGFuY2Ugd2l0aCBjb25maWd1cmVkIHBlcm1pc3Npb25zXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBwcml2YXRlIGNyZWF0ZUluc3RhbmNlUm9sZSgpOiBSb2xlIHtcbiAgICAgICAgY29uc3Qgcm9sZSA9IG5ldyBSb2xlKHRoaXMubWFpblN0YWNrLCBgJHt0aGlzLmVjMkNvbmZpZy5pbnN0YW5jZU5hbWV9LWluc3RhbmNlLXJvbGVgLCB7XG4gICAgICAgICAgICByb2xlTmFtZTogdGhpcy5lYzJDb25maWcuaW5zdGFuY2VSb2xlPy5yb2xlTmFtZSxcbiAgICAgICAgICAgIGFzc3VtZWRCeTogbmV3IFNlcnZpY2VQcmluY2lwYWwoJ2VjMi5hbWF6b25hd3MuY29tJyksXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogYEluc3RhbmNlIHJvbGUgZm9yICR7dGhpcy5lYzJDb25maWcuaW5zdGFuY2VOYW1lfSBFQzIgaW5zdGFuY2VgLFxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAodGhpcy5lYzJDb25maWcuaW5zdGFuY2VSb2xlKSB7XG4gICAgICAgICAgICAvLyBBdHRhY2ggbWFuYWdlZCBwb2xpY2llcyBieSBBUk5cbiAgICAgICAgICAgIHRoaXMuZWMyQ29uZmlnLmluc3RhbmNlUm9sZS5tYW5hZ2VkUG9saWN5QXJucz8uZm9yRWFjaCgocG9saWN5QXJuLCBpbmRleCkgPT4ge1xuICAgICAgICAgICAgICAgIHJvbGUuYWRkTWFuYWdlZFBvbGljeShNYW5hZ2VkUG9saWN5LmZyb21NYW5hZ2VkUG9saWN5QXJuKFxuICAgICAgICAgICAgICAgICAgICB0aGlzLm1haW5TdGFjayxcbiAgICAgICAgICAgICAgICAgICAgYCR7dGhpcy5lYzJDb25maWcuaW5zdGFuY2VOYW1lfS1pbnN0YW5jZS1tYW5hZ2VkLXBvbGljeS0ke2luZGV4fWAsXG4gICAgICAgICAgICAgICAgICAgIHBvbGljeUFyblxuICAgICAgICAgICAgICAgICkpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIEF0dGFjaCBtYW5hZ2VkIHBvbGljaWVzXG4gICAgICAgICAgICB0aGlzLmVjMkNvbmZpZy5pbnN0YW5jZVJvbGUubWFuYWdlZFBvbGljaWVzPy5mb3JFYWNoKHBvbGljeSA9PiB7XG4gICAgICAgICAgICAgICAgcm9sZS5hZGRNYW5hZ2VkUG9saWN5KHBvbGljeSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gQWRkIGlubGluZSBwb2xpY2llc1xuICAgICAgICAgICAgdGhpcy5lYzJDb25maWcuaW5zdGFuY2VSb2xlLmlubGluZVBvbGljaWVzPy5mb3JFYWNoKHN0YXRlbWVudCA9PiB7XG4gICAgICAgICAgICAgICAgcm9sZS5hZGRUb1BvbGljeShzdGF0ZW1lbnQpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBZGQgZGVmYXVsdCBwZXJtaXNzaW9ucyBmb3IgRUNSIGFjY2VzcyAodG8gcHVsbCBEb2NrZXIgaW1hZ2VzKVxuICAgICAgICByb2xlLmFkZFRvUG9saWN5KG5ldyBQb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICdlY3I6R2V0QXV0aG9yaXphdGlvblRva2VuJyxcbiAgICAgICAgICAgICAgICAnZWNyOkJhdGNoQ2hlY2tMYXllckF2YWlsYWJpbGl0eScsXG4gICAgICAgICAgICAgICAgJ2VjcjpHZXREb3dubG9hZFVybEZvckxheWVyJyxcbiAgICAgICAgICAgICAgICAnZWNyOkJhdGNoR2V0SW1hZ2UnXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBbJyonXVxuICAgICAgICB9KSk7XG5cbiAgICAgICAgLy8gQWRkIENsb3VkIE1hcCBwZXJtaXNzaW9ucyBpZiBzZXJ2aWNlIGRpc2NvdmVyeSBpcyBjb25maWd1cmVkXG4gICAgICAgIGlmICh0aGlzLmVjMkNvbmZpZy5zZXJ2aWNlRGlzY292ZXJ5KSB7XG4gICAgICAgICAgICByb2xlLmFkZFRvUG9saWN5KG5ldyBQb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgICAgICAgJ3NlcnZpY2VkaXNjb3Zlcnk6UmVnaXN0ZXJJbnN0YW5jZScsXG4gICAgICAgICAgICAgICAgICAgICdzZXJ2aWNlZGlzY292ZXJ5OkRlcmVnaXN0ZXJJbnN0YW5jZScsXG4gICAgICAgICAgICAgICAgICAgICdzZXJ2aWNlZGlzY292ZXJ5OkdldEluc3RhbmNlJyxcbiAgICAgICAgICAgICAgICAgICAgJ3NlcnZpY2VkaXNjb3Zlcnk6VXBkYXRlSW5zdGFuY2VDdXN0b21IZWFsdGhTdGF0dXMnXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnKiddXG4gICAgICAgICAgICB9KSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBZGQgU1NNIFNlc3Npb24gTWFuYWdlciBwZXJtaXNzaW9ucyAoZm9yIGtleWxlc3MgYWNjZXNzIHZpYSBBV1MgQ29uc29sZSlcbiAgICAgICAgcm9sZS5hZGRUb1BvbGljeShuZXcgUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgICAnc3NtbWVzc2FnZXM6Q3JlYXRlQ29udHJvbENoYW5uZWwnLFxuICAgICAgICAgICAgICAgICdzc21tZXNzYWdlczpDcmVhdGVEYXRhQ2hhbm5lbCcsXG4gICAgICAgICAgICAgICAgJ3NzbW1lc3NhZ2VzOk9wZW5Db250cm9sQ2hhbm5lbCcsXG4gICAgICAgICAgICAgICAgJ3NzbW1lc3NhZ2VzOk9wZW5EYXRhQ2hhbm5lbCdcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICByZXNvdXJjZXM6IFsnKiddXG4gICAgICAgIH0pKTtcblxuICAgICAgICAvLyBBZGQgRUMyIEluc3RhbmNlIENvbm5lY3QgYW5kIFNTTSBwZXJtaXNzaW9uc1xuICAgICAgICByb2xlLmFkZE1hbmFnZWRQb2xpY3koXG4gICAgICAgICAgICBNYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnQW1hem9uU1NNTWFuYWdlZEluc3RhbmNlQ29yZScpXG4gICAgICAgICk7XG5cbiAgICAgICAgLy8gQWRkIENsb3VkV2F0Y2ggTG9ncyBwZXJtaXNzaW9uc1xuICAgICAgICByb2xlLmFkZFRvUG9saWN5KG5ldyBQb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICdsb2dzOkNyZWF0ZUxvZ0dyb3VwJyxcbiAgICAgICAgICAgICAgICAnbG9nczpDcmVhdGVMb2dTdHJlYW0nLFxuICAgICAgICAgICAgICAgICdsb2dzOlB1dExvZ0V2ZW50cycsXG4gICAgICAgICAgICAgICAgJ2xvZ3M6RGVzY3JpYmVMb2dTdHJlYW1zJ1xuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHJlc291cmNlczogWycqJ11cbiAgICAgICAgfSkpO1xuXG4gICAgICAgIHJldHVybiByb2xlO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEJ1aWxkcyBEb2NrZXIgdXNlciBkYXRhIHNjcmlwdCB0byBpbnN0YWxsIERvY2tlciBhbmQgcnVuIHRoZSBjb250YWluZXJcbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gZG9ja2VySW1hZ2VVcmkgLSBUaGUgVVJJIG9mIHRoZSBEb2NrZXIgaW1hZ2UgdG8gcnVuXG4gICAgICogQHJldHVybnMgVGhlIHVzZXIgZGF0YSBzY3JpcHQgYXMgYSBzdHJpbmdcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIHByaXZhdGUgYnVpbGREb2NrZXJVc2VyRGF0YShkb2NrZXJJbWFnZVVyaTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICAgICAgY29uc3QgY29udGFpbmVyTmFtZSA9IHRoaXMuZWMyQ29uZmlnLmNvbnRhaW5lci5jb250YWluZXJOYW1lIHx8IHRoaXMuZWMyQ29uZmlnLmluc3RhbmNlTmFtZTtcbiAgICAgICAgY29uc3QgY29udGFpbmVyUG9ydCA9IHRoaXMuZWMyQ29uZmlnLmNvbnRhaW5lci5jb250YWluZXJQb3J0O1xuXG4gICAgICAgIC8vIEJ1aWxkIGVudmlyb25tZW50IHZhcmlhYmxlc1xuICAgICAgICBsZXQgZW52VmFycyA9ICcnO1xuICAgICAgICBpZiAodGhpcy5lYzJDb25maWcuY29udGFpbmVyLmVudmlyb25tZW50KSB7XG4gICAgICAgICAgICBlbnZWYXJzID0gT2JqZWN0LmVudHJpZXModGhpcy5lYzJDb25maWcuY29udGFpbmVyLmVudmlyb25tZW50KVxuICAgICAgICAgICAgICAgIC5tYXAoKFtrZXksIHZhbHVlXSkgPT4gYC1lICR7a2V5fT1cIiR7dmFsdWV9XCJgKVxuICAgICAgICAgICAgICAgIC5qb2luKCcgJyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBCdWlsZCBkb2NrZXIgcnVuIG9wdGlvbnMgJiBjb21tYW5kXG4gICAgICAgIGNvbnN0IGRvY2tlclJ1bk9wdGlvbnMgPSB0aGlzLmVjMkNvbmZpZy5jb250YWluZXIuZG9ja2VyUnVuT3B0aW9ucz8uam9pbignICcpIHx8ICcnO1xuICAgICAgICBjb25zdCBjb21tYW5kID0gdGhpcy5lYzJDb25maWcuY29udGFpbmVyLmNvbW1hbmQgPyB0aGlzLmVjMkNvbmZpZy5jb250YWluZXIuY29tbWFuZC5qb2luKCcgJykgOiAnJztcblxuICAgICAgICBsZXQgZG9ja2VyUnVuQ21kID0gYGRvY2tlciBydW4gLWQgLS1uYW1lICR7Y29udGFpbmVyTmFtZX0gLS1yZXN0YXJ0IHVubGVzcy1zdG9wcGVkYDtcbiAgICAgICAgaWYgKGRvY2tlclJ1bk9wdGlvbnMpIHtcbiAgICAgICAgICAgIGRvY2tlclJ1bkNtZCArPSBgICR7ZG9ja2VyUnVuT3B0aW9uc31gO1xuICAgICAgICB9XG4gICAgICAgIGlmIChlbnZWYXJzKSB7XG4gICAgICAgICAgICBkb2NrZXJSdW5DbWQgKz0gYCAke2VudlZhcnN9YDtcbiAgICAgICAgfVxuICAgICAgICAvLyBJTVBPUlRBTlQ6IGF3c2xvZ3Mgb3B0aW9ucyBtdXN0IGFwcGVhciBCRUZPUkUgdGhlIGltYWdlIHJlZmVyZW5jZVxuICAgICAgICBkb2NrZXJSdW5DbWQgKz0gYCAtcCAke2NvbnRhaW5lclBvcnR9OiR7Y29udGFpbmVyUG9ydH0gLS1sb2ctZHJpdmVyIGF3c2xvZ3MgLS1sb2ctb3B0IGF3c2xvZ3MtcmVnaW9uPSRSRUdJT04gLS1sb2ctb3B0IGF3c2xvZ3MtZ3JvdXA9JExPR19HUk9VUCAtLWxvZy1vcHQgYXdzbG9ncy1zdHJlYW09JElOU1RBTkNFX0lEICR7ZG9ja2VySW1hZ2VVcml9YDtcbiAgICAgICAgaWYgKGNvbW1hbmQpIHtcbiAgICAgICAgICAgIGRvY2tlclJ1bkNtZCArPSBgICR7Y29tbWFuZH1gO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gSWYgc2VydmljZSBkaXNjb3ZlcnkgaXMgY29uZmlndXJlZCwgaW5qZWN0IHRoZSBTZXJ2aWNlIElEIHNvIHJlZ2lzdHJhdGlvbiBjYW4gYmUgZG9uZSBpbmxpbmVcbiAgICAgICAgY29uc3Qgc2VydmljZUlkTGluZSA9IHRoaXMuY2xvdWRNYXBTZXJ2aWNlXG4gICAgICAgICAgICA/IGBTRVJWSUNFX0lEPVwiJHt0aGlzLmNsb3VkTWFwU2VydmljZS5zZXJ2aWNlSWR9XCJgXG4gICAgICAgICAgICA6IGBTRVJWSUNFX0lEPVwiXCJgO1xuXG4gICAgICAgIHJldHVybiBgIyEvYmluL2Jhc2hcbnNldCAtZXVvIHBpcGVmYWlsXG5cbiMgLS0tLS0tLS0gTWluaW1hbCBzZXR1cDogSU1EU3YyLCByZWdpb24sIGlkcyAtLS0tLS0tLVxuVE9LRU49JChjdXJsIC1zUyAtWCBQVVQgXCJodHRwOi8vMTY5LjI1NC4xNjkuMjU0L2xhdGVzdC9hcGkvdG9rZW5cIiAtSCBcIlgtYXdzLWVjMi1tZXRhZGF0YS10b2tlbi10dGwtc2Vjb25kczogMjE2MDBcIiB8fCB0cnVlKVxuSU1EU19IRFI9XCJcIlxuaWYgWyAtbiBcIlxcJHtUT0tFTjotfVwiIF07IHRoZW4gSU1EU19IRFI9XCItSCBYLWF3cy1lYzItbWV0YWRhdGEtdG9rZW46XFwke1RPS0VOfVwiOyBmaVxuXG5SRUdJT049JChjdXJsIC1zUyBcXCRJTURTX0hEUiBodHRwOi8vMTY5LjI1NC4xNjkuMjU0L2xhdGVzdC9tZXRhLWRhdGEvcGxhY2VtZW50L3JlZ2lvbilcbklOU1RBTkNFX0lEPSQoY3VybCAtc1MgXFwkSU1EU19IRFIgaHR0cDovLzE2OS4yNTQuMTY5LjI1NC9sYXRlc3QvbWV0YS1kYXRhL2luc3RhbmNlLWlkKVxuUFJJVkFURV9JUD0kKGN1cmwgLXNTIFxcJElNRFNfSERSIGh0dHA6Ly8xNjkuMjU0LjE2OS4yNTQvbGF0ZXN0L21ldGEtZGF0YS9sb2NhbC1pcHY0KVxuXG4jIC0tLS0tLS0tIEluc3RhbGwgRG9ja2VyICsgQVdTIENMSSAobWluaW1hbCkgLS0tLS0tLS1cbmRuZiAteSBpbnN0YWxsIGRvY2tlciBhd3NjbGkgfHwgKGRuZiAteSB1cGRhdGUgJiYgZG5mIC15IGluc3RhbGwgZG9ja2VyIGF3c2NsaSlcbnN5c3RlbWN0bCBlbmFibGUgLS1ub3cgZG9ja2VyXG5cbiMgLS0tLS0tLS0gRUNSIGxvZ2luIC0tLS0tLS0tXG5BQ0NPVU5UX0lEPSQoYXdzIHN0cyBnZXQtY2FsbGVyLWlkZW50aXR5IC0tcXVlcnkgQWNjb3VudCAtLW91dHB1dCB0ZXh0KVxuYXdzIGVjciBnZXQtbG9naW4tcGFzc3dvcmQgLS1yZWdpb24gXCJcXCRSRUdJT05cIiB8IGRvY2tlciBsb2dpbiAtLXVzZXJuYW1lIEFXUyAtLXBhc3N3b3JkLXN0ZGluIFwiXFwke0FDQ09VTlRfSUR9LmRrci5lY3IuXFwke1JFR0lPTn0uYW1hem9uYXdzLmNvbVwiXG5cbiMgLS0tLS0tLS0gQ2xvdWRXYXRjaCBMb2dzOiBjcmVhdGUgZ3JvdXAgZm9yIGNvbnRhaW5lciBsb2dzIC0tLS0tLS0tXG5MT0dfR1JPVVA9XCIvYXdzL2VjMi8ke3RoaXMuZWMyQ29uZmlnLmluc3RhbmNlTmFtZX0vY29udGFpbmVyXCJcbmF3cyBsb2dzIGNyZWF0ZS1sb2ctZ3JvdXAgLS1sb2ctZ3JvdXAtbmFtZSBcIlxcJExPR19HUk9VUFwiIC0tcmVnaW9uIFwiXFwkUkVHSU9OXCIgMj4vZGV2L251bGwgfHwgdHJ1ZVxuYXdzIGxvZ3MgcHV0LXJldGVudGlvbi1wb2xpY3kgLS1sb2ctZ3JvdXAtbmFtZSBcIlxcJExPR19HUk9VUFwiIC0tcmV0ZW50aW9uLWluLWRheXMgNyAtLXJlZ2lvbiBcIlxcJFJFR0lPTlwiIDI+L2Rldi9udWxsIHx8IHRydWVcblxuIyAtLS0tLS0tLSAoT3B0aW9uYWwpIENsb3VkIE1hcCByZWdpc3RyYXRpb24gLS0tLS0tLS1cbiR7c2VydmljZUlkTGluZX1cbmlmIFsgLW4gXCJcXCR7U0VSVklDRV9JRDotfVwiIF07IHRoZW5cbiAgIyB3YWl0IGJyaWVmbHkgZm9yIHJvbGUgY3JlZGVudGlhbHNcbiAgZm9yIGkgaW4gXFwkKHNlcSAxIDE4KTsgZG9cbiAgICBpZiBhd3Mgc3RzIGdldC1jYWxsZXItaWRlbnRpdHkgPi9kZXYvbnVsbCAyPiYxOyB0aGVuIGJyZWFrOyBmaVxuICAgIHNsZWVwIDVcbiAgZG9uZVxuICBhd3Mgc2VydmljZWRpc2NvdmVyeSByZWdpc3Rlci1pbnN0YW5jZSBcXFxuICAgIC0tc2VydmljZS1pZCBcIlxcJFNFUlZJQ0VfSURcIiBcXFxuICAgIC0taW5zdGFuY2UtaWQgXCJcXCRJTlNUQU5DRV9JRFwiIFxcXG4gICAgLS1hdHRyaWJ1dGVzIEFXU19JTlNUQU5DRV9JUFY0PVwiXFwkUFJJVkFURV9JUFwiLEFXU19JTlNUQU5DRV9QT1JUPVwiJHtjb250YWluZXJQb3J0fVwiIFxcXG4gICAgLS1yZWdpb24gXCJcXCRSRUdJT05cIiBcXFxuICAgID4vdG1wL3NkLm91dCAyPi90bXAvc2QuZXJyIHx8IHRydWVcbmZpXG5cbiMgLS0tLS0tLS0gUnVuIGNvbnRhaW5lciAobG9ncyBnbyB0byBDbG91ZFdhdGNoIHZpYSBhd3Nsb2dzIGRyaXZlcikgLS0tLS0tLS1cbmRvY2tlciBybSAtZiAke2NvbnRhaW5lck5hbWV9ID4vZGV2L251bGwgMj4mMSB8fCB0cnVlXG4ke2RvY2tlclJ1bkNtZH1cbmA7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ29uc3RydWN0cyBhbGwgbmVjZXNzYXJ5IEFXUyByZXNvdXJjZXMgZm9yIHRoZSBFQzIgaW5zdGFuY2UuXG4gICAgICogVGhpcyBpbmNsdWRlcyBWUEMsIHNlY3VyaXR5IGdyb3VwcywgaW5zdGFuY2UgY29uZmlndXJhdGlvbiwgRG9ja2VyIHNldHVwLCBhbmQgdm9sdW1lcy5cbiAgICAgKiBcbiAgICAgKiBAcmV0dXJucyBQcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2hlbiBhbGwgcmVzb3VyY2VzIGFyZSBjcmVhdGVkXG4gICAgICogQHB1YmxpY1xuICAgICAqL1xuICAgIEBMb2dEdXJhdGlvbigpXG4gICAgcHVibGljIGFzeW5jIGNvbnN0cnVjdCgpIHtcbiAgICAgICAgdGhpcy5tYWluU3RhY2sgPSB0aGlzLmZ3MjQuZ2V0U3RhY2sodGhpcy5lYzJDb25maWcuc3RhY2tOYW1lLCB0aGlzLmVjMkNvbmZpZy5wYXJlbnRTdGFja05hbWUpO1xuXG4gICAgICAgIC8vIEdldCBWUEMgZmlyc3QgYXMgaXQncyBuZWVkZWQgZm9yIGFsbCBvdGhlciByZXNvdXJjZXNcbiAgICAgICAgdGhpcy52cGMgPSB0aGlzLmdldFZwYygpO1xuXG4gICAgICAgIC8vIEdldCBvciBjcmVhdGUgU2VjdXJpdHkgR3JvdXBcbiAgICAgICAgY29uc3Qgc2VjdXJpdHlHcm91cCA9IHRoaXMuZ2V0T3JDcmVhdGVTZWN1cml0eUdyb3VwKCk7XG5cbiAgICAgICAgLy8gR2V0IHN1Ym5ldFxuICAgICAgICBjb25zdCBzdWJuZXQgPSB0aGlzLmdldFN1Ym5ldCgpO1xuXG4gICAgICAgIC8vIENyZWF0ZSBpbnN0YW5jZSByb2xlXG4gICAgICAgIGNvbnN0IGluc3RhbmNlUm9sZSA9IHRoaXMuY3JlYXRlSW5zdGFuY2VSb2xlKCk7XG5cbiAgICAgICAgLy8gQnVpbGQgRG9ja2VyIGltYWdlXG4gICAgICAgIGNvbnN0IGRvY2tlckltYWdlID0gbmV3IERvY2tlckltYWdlQXNzZXQodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZWMyQ29uZmlnLmluc3RhbmNlTmFtZX0taW1hZ2VgLCB7XG4gICAgICAgICAgICBkaXJlY3Rvcnk6IHBhdGguZGlybmFtZSh0aGlzLmVjMkNvbmZpZy5jb250YWluZXIuZG9ja2VyRmlsZVBhdGgpLFxuICAgICAgICAgICAgZmlsZTogcGF0aC5iYXNlbmFtZSh0aGlzLmVjMkNvbmZpZy5jb250YWluZXIuZG9ja2VyRmlsZVBhdGgpLFxuICAgICAgICAgICAgcGxhdGZvcm06IHRoaXMuZWMyQ29uZmlnLmRvY2tlckltYWdlUHJvcHM/LnBsYXRmb3JtIHx8IFBsYXRmb3JtLkxJTlVYX0FNRDY0LFxuICAgICAgICAgICAgLi4udGhpcy5lYzJDb25maWcuZG9ja2VySW1hZ2VQcm9wcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gQ29uZmlndXJlIHNlcnZpY2UgZGlzY292ZXJ5IGlmIHNwZWNpZmllZCAobXVzdCBiZSBkb25lIGJlZm9yZSB1c2VyIGRhdGEpXG4gICAgICAgIGlmICh0aGlzLmVjMkNvbmZpZy5zZXJ2aWNlRGlzY292ZXJ5KSB7XG4gICAgICAgICAgICB0aGlzLmNvbmZpZ3VyZVNlcnZpY2VEaXNjb3ZlcnkoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEJ1aWxkIHVzZXIgZGF0YSBzY3JpcHRcbiAgICAgICAgY29uc3QgdXNlckRhdGEgPSBVc2VyRGF0YS5jdXN0b20oXG4gICAgICAgICAgICB0aGlzLmJ1aWxkRG9ja2VyVXNlckRhdGEoZG9ja2VySW1hZ2UuaW1hZ2VVcmkpXG4gICAgICAgICk7XG5cblxuICAgICAgICAvLyBNZXJnZSB1c2VyLXByb3ZpZGVkIHVzZXIgZGF0YSBpZiBleGlzdHNcbiAgICAgICAgY29uc3QgeyB1c2VyRGF0YTogY3VzdG9tVXNlckRhdGEsIC4uLnJlc3RJbnN0YW5jZVByb3BzIH0gPSB0aGlzLmVjMkNvbmZpZy5pbnN0YW5jZVByb3BzIHx8IHt9O1xuICAgICAgICBpZiAoY3VzdG9tVXNlckRhdGEpIHtcbiAgICAgICAgICAgIC8vIENvbWJpbmUgdXNlciBkYXRhIHNjcmlwdHNcbiAgICAgICAgICAgIHVzZXJEYXRhLmFkZENvbW1hbmRzKFxuICAgICAgICAgICAgICAgIC4uLmN1c3RvbVVzZXJEYXRhLnJlbmRlcigpLnNwbGl0KCdcXG4nKS5maWx0ZXIobGluZSA9PiBsaW5lLnRyaW0oKSlcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBQcmVwYXJlIGJsb2NrIGRldmljZXMgZm9yIHZvbHVtZXNcbiAgICAgICAgY29uc3QgYmxvY2tEZXZpY2VzOiBBcnJheTx7IGRldmljZU5hbWU6IHN0cmluZzsgdm9sdW1lOiBCbG9ja0RldmljZVZvbHVtZSB9PiA9IFtdO1xuICAgICAgICBpZiAodGhpcy5lYzJDb25maWcudm9sdW1lcykge1xuICAgICAgICAgICAgLy8gRGV2aWNlIG5hbWVzIGZvciBFQlMgdm9sdW1lcyB0eXBpY2FsbHkgc3RhcnQgZnJvbSAvZGV2L3NkZlxuICAgICAgICAgICAgLy8gU3RhbmRhcmQgRUJTIGRldmljZSBuYW1lczogc2RmLCBzZGcsIHNkaCwgc2RpLCBzZGosIHNkaywgc2RsLCBzZG0sIHNkbiwgc2RvLCBzZHBcbiAgICAgICAgICAgIGNvbnN0IGdldERlZmF1bHREZXZpY2VOYW1lID0gKGluZGV4OiBudW1iZXIpOiBzdHJpbmcgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGRldmljZVN1ZmZpeGVzID0gWydmJywgJ2cnLCAnaCcsICdpJywgJ2onLCAnaycsICdsJywgJ20nLCAnbicsICdvJywgJ3AnXTtcbiAgICAgICAgICAgICAgICBjb25zdCBzdWZmaXggPSBkZXZpY2VTdWZmaXhlc1tpbmRleF0gfHwgU3RyaW5nLmZyb21DaGFyQ29kZSgxMDIgKyBpbmRleCk7IC8vIDEwMiBpcyAnZicgaW4gQVNDSUlcbiAgICAgICAgICAgICAgICByZXR1cm4gYC9kZXYvc2Qke3N1ZmZpeH1gO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5lYzJDb25maWcudm9sdW1lcy5mb3JFYWNoKCh2b2x1bWVDb25maWcsIGluZGV4KSA9PiB7XG4gICAgICAgICAgICAgICAgbGV0IHZvbHVtZTogQmxvY2tEZXZpY2VWb2x1bWU7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gSWYgdm9sdW1lIGlzIGV4cGxpY2l0bHkgcHJvdmlkZWQsIHVzZSBpdFxuICAgICAgICAgICAgICAgIGlmICh2b2x1bWVDb25maWcudm9sdW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIHZvbHVtZSA9IHZvbHVtZUNvbmZpZy52b2x1bWU7XG4gICAgICAgICAgICAgICAgfSBcbiAgICAgICAgICAgICAgICAvLyBJZiBvbmx5IHNpemUgaXMgcHJvdmlkZWQsIGNyZWF0ZSBHUDMgdm9sdW1lIHdpdGggZGVmYXVsdHNcbiAgICAgICAgICAgICAgICBlbHNlIGlmICh2b2x1bWVDb25maWcuc2l6ZUdpQikge1xuICAgICAgICAgICAgICAgICAgICB2b2x1bWUgPSBCbG9ja0RldmljZVZvbHVtZS5lYnModm9sdW1lQ29uZmlnLnNpemVHaUIsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZvbHVtZVR5cGU6IEVic0RldmljZVZvbHVtZVR5cGUuR1AzLFxuICAgICAgICAgICAgICAgICAgICAgICAgZW5jcnlwdGVkOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9IFxuICAgICAgICAgICAgICAgIC8vIEVycm9yIGlmIG5laXRoZXIgaXMgcHJvdmlkZWRcbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGV2aWNlTmFtZVN0ciA9IHZvbHVtZUNvbmZpZy5kZXZpY2VOYW1lIHx8IGdldERlZmF1bHREZXZpY2VOYW1lKGluZGV4KTtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBWb2x1bWUgY29uZmlndXJhdGlvbiBmb3IgZGV2aWNlICR7ZGV2aWNlTmFtZVN0cn0gbXVzdCBzcGVjaWZ5IGVpdGhlciAndm9sdW1lJyBvciAnc2l6ZUdpQidgKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgLy8gR2VuZXJhdGUgZGV2aWNlIG5hbWUgaWYgbm90IHByb3ZpZGVkXG4gICAgICAgICAgICAgICAgY29uc3QgZGV2aWNlTmFtZSA9IHZvbHVtZUNvbmZpZy5kZXZpY2VOYW1lIHx8IGdldERlZmF1bHREZXZpY2VOYW1lKGluZGV4KTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBibG9ja0RldmljZXMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgIGRldmljZU5hbWU6IGRldmljZU5hbWUsXG4gICAgICAgICAgICAgICAgICAgIHZvbHVtZTogdm9sdW1lXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENyZWF0ZSBFQzIgaW5zdGFuY2UsIG1lcmdpbmcgd2l0aCB1c2VyLXByb3ZpZGVkIHByb3BzXG4gICAgICAgIHRoaXMuaW5zdGFuY2UgPSBuZXcgSW5zdGFuY2UodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZWMyQ29uZmlnLmluc3RhbmNlTmFtZX0taW5zdGFuY2VgLCB7XG4gICAgICAgICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgICAgICAgdnBjU3VibmV0czogc3VibmV0ID8geyBzdWJuZXRzOiBbc3VibmV0XSB9IDogeyBzdWJuZXRUeXBlOiB0aGlzLmVjMkNvbmZpZy5zdWJuZXRDb25maWc/LnN1Ym5ldFR5cGUgfHwgU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTIH0sXG4gICAgICAgICAgICBzZWN1cml0eUdyb3VwOiBzZWN1cml0eUdyb3VwLFxuICAgICAgICAgICAgcm9sZTogaW5zdGFuY2VSb2xlLFxuICAgICAgICAgICAgaW5zdGFuY2VUeXBlOiBJbnN0YW5jZVR5cGUub2YoSW5zdGFuY2VDbGFzcy5UMywgSW5zdGFuY2VTaXplLk1JQ1JPKSxcbiAgICAgICAgICAgIG1hY2hpbmVJbWFnZTogTWFjaGluZUltYWdlLmxhdGVzdEFtYXpvbkxpbnV4MjAyMyh7XG4gICAgICAgICAgICAgICAgY3B1VHlwZTogQW1hem9uTGludXhDcHVUeXBlLlg4Nl82NCxcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgdXNlckRhdGE6IHVzZXJEYXRhLFxuICAgICAgICAgICAgYmxvY2tEZXZpY2VzOiBibG9ja0RldmljZXMubGVuZ3RoID4gMCA/IGJsb2NrRGV2aWNlcyA6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgIC4uLnJlc3RJbnN0YW5jZVByb3BzLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBTZXQgb3V0cHV0c1xuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIHRoaXMuZWMyQ29uZmlnLmluc3RhbmNlTmFtZSwgdGhpcy5pbnN0YW5jZSwgT3V0cHV0VHlwZS5JTlNUQU5DRSk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKGAke3RoaXMuZWMyQ29uZmlnLmluc3RhbmNlTmFtZX1JbnN0YW5jZUlkYCwgdGhpcy5pbnN0YW5jZS5pbnN0YW5jZUlkKTtcbiAgICAgICAgdGhpcy5mdzI0LnNldEVudmlyb25tZW50VmFyaWFibGUoYCR7dGhpcy5lYzJDb25maWcuaW5zdGFuY2VOYW1lfUluc3RhbmNlUHJpdmF0ZUlwYCwgdGhpcy5pbnN0YW5jZS5pbnN0YW5jZVByaXZhdGVJcCk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKGAke3RoaXMuZWMyQ29uZmlnLmluc3RhbmNlTmFtZX1JbnN0YW5jZVB1YmxpY0lwYCwgdGhpcy5pbnN0YW5jZS5pbnN0YW5jZVB1YmxpY0lwIHx8ICcnKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXRzIHRoZSBWUEMgZm9yIHRoZSBFQzIgaW5zdGFuY2UgZWl0aGVyIGZyb20gdGhlIHByb3ZpZGVkIGNvbmZpZ3VyYXRpb24gb3IgbG9va3MgaXQgdXAgYnkgbmFtZS5cbiAgICAgKiBcbiAgICAgKiBAcmV0dXJucyBUaGUgVlBDIGluc3RhbmNlIHRvIGJlIHVzZWQgZm9yIHRoZSBFQzIgaW5zdGFuY2VcbiAgICAgKiBAdGhyb3dzIEVycm9yIGlmIG5laXRoZXIgVlBDIG5hbWUgbm9yIFZQQyBpbnN0YW5jZSBpcyBwcm92aWRlZFxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgcHJpdmF0ZSBnZXRWcGMoKTogSVZwYyB7XG4gICAgICAgIGlmICghdGhpcy5lYzJDb25maWcudnBjTmFtZSAmJiAhdGhpcy5lYzJDb25maWcudnBjKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1ZQQyBOYW1lIG9yIFZQQyBtdXN0IGJlIHNwZWNpZmllZCBpbiB0aGUgRUMyIGNvbmZpZ3VyYXRpb24nKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLmVjMkNvbmZpZy52cGMpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmVjMkNvbmZpZy52cGM7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gVnBjLmZyb21Mb29rdXAodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZWMyQ29uZmlnLmluc3RhbmNlTmFtZX0tdnBjYCwge1xuICAgICAgICAgICAgdnBjTmFtZTogdGhpcy5lYzJDb25maWcudnBjTmFtZVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBHZXRzIHRoZSBzdWJuZXQgZm9yIHRoZSBFQzIgaW5zdGFuY2UgZWl0aGVyIGZyb20gdGhlIHByb3ZpZGVkIGNvbmZpZ3VyYXRpb24gb3IgcmV0dXJucyB1bmRlZmluZWQuXG4gICAgICogXG4gICAgICogQHJldHVybnMgVGhlIHN1Ym5ldCBpbnN0YW5jZSBvciB1bmRlZmluZWQgaWYgdXNpbmcgc3VibmV0IHR5cGVcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIHByaXZhdGUgZ2V0U3VibmV0KCk6IElTdWJuZXQgfCB1bmRlZmluZWQge1xuICAgICAgICBpZiAodGhpcy5lYzJDb25maWcuc3VibmV0Py5zdWJuZXRJZCkge1xuICAgICAgICAgICAgcmV0dXJuIFN1Ym5ldC5mcm9tU3VibmV0SWQoXG4gICAgICAgICAgICAgICAgdGhpcy5tYWluU3RhY2ssXG4gICAgICAgICAgICAgICAgYCR7dGhpcy5lYzJDb25maWcuaW5zdGFuY2VOYW1lfS1pbXBvcnRlZC1zdWJuZXRgLFxuICAgICAgICAgICAgICAgIHRoaXMuZWMyQ29uZmlnLnN1Ym5ldC5zdWJuZXRJZFxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0cyBhbiBleGlzdGluZyBzZWN1cml0eSBncm91cCBvciBjcmVhdGVzIGEgbmV3IG9uZSBmb3IgdGhlIEVDMiBpbnN0YW5jZS5cbiAgICAgKiBJZiBhIHNlY3VyaXR5IGdyb3VwIElEIGlzIHByb3ZpZGVkLCBpdCB3aWxsIHVzZSB0aGF0IGdyb3VwLlxuICAgICAqIE90aGVyd2lzZSwgaXQgY3JlYXRlcyBhIG5ldyBzZWN1cml0eSBncm91cCB3aXRoIGFwcHJvcHJpYXRlIGluZ3Jlc3MgcnVsZXMuXG4gICAgICogXG4gICAgICogQHJldHVybnMgVGhlIHNlY3VyaXR5IGdyb3VwIGluc3RhbmNlXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBwcml2YXRlIGdldE9yQ3JlYXRlU2VjdXJpdHlHcm91cCgpOiBJU2VjdXJpdHlHcm91cCB7XG4gICAgICAgIGlmICh0aGlzLmVjMkNvbmZpZy5zZWN1cml0eUdyb3VwPy5zZWN1cml0eUdyb3VwSWQpIHtcbiAgICAgICAgICAgIHJldHVybiBTZWN1cml0eUdyb3VwLmZyb21TZWN1cml0eUdyb3VwSWQoXG4gICAgICAgICAgICAgICAgdGhpcy5tYWluU3RhY2ssIFxuICAgICAgICAgICAgICAgIGAke3RoaXMuZWMyQ29uZmlnLmluc3RhbmNlTmFtZX0taW1wb3J0ZWQtc2dgLFxuICAgICAgICAgICAgICAgIHRoaXMuZWMyQ29uZmlnLnNlY3VyaXR5R3JvdXAuc2VjdXJpdHlHcm91cElkXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc2VjdXJpdHlHcm91cCA9IG5ldyBTZWN1cml0eUdyb3VwKHRoaXMubWFpblN0YWNrLCBgJHt0aGlzLmVjMkNvbmZpZy5pbnN0YW5jZU5hbWV9LXNnYCwge1xuICAgICAgICAgICAgdnBjOiB0aGlzLnZwYyxcbiAgICAgICAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IHRydWUsXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogYFNlY3VyaXR5IGdyb3VwIGZvciAke3RoaXMuZWMyQ29uZmlnLmluc3RhbmNlTmFtZX0gRUMyIGluc3RhbmNlYCxcbiAgICAgICAgICAgIC4uLnRoaXMuZWMyQ29uZmlnLnNlY3VyaXR5R3JvdXA/LnByb3BzLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBBbGxvdyBpbmJvdW5kIHRyYWZmaWMgb24gY29udGFpbmVyIHBvcnQgZnJvbSB3aXRoaW4gVlBDXG4gICAgICAgIHNlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoXG4gICAgICAgICAgICBQZWVyLmlwdjQodGhpcy52cGMudnBjQ2lkckJsb2NrKSxcbiAgICAgICAgICAgIFBvcnQudGNwKHRoaXMuZWMyQ29uZmlnLmNvbnRhaW5lci5jb250YWluZXJQb3J0KSxcbiAgICAgICAgICAgICdBbGxvdyBpbmJvdW5kIHRyYWZmaWMgb24gY29udGFpbmVyIHBvcnQgZnJvbSB3aXRoaW4gVlBDJ1xuICAgICAgICApO1xuXG4gICAgICAgIC8vIEFsbG93IFNTSCBhY2Nlc3MgZnJvbSBWUEMgKG9wdGlvbmFsLCBjYW4gYmUgcmVtb3ZlZCBmb3IgcHJvZHVjdGlvbilcbiAgICAgICAgc2VjdXJpdHlHcm91cC5hZGRJbmdyZXNzUnVsZShcbiAgICAgICAgICAgIFBlZXIuaXB2NCh0aGlzLnZwYy52cGNDaWRyQmxvY2spLFxuICAgICAgICAgICAgUG9ydC50Y3AoMjIpLFxuICAgICAgICAgICAgJ0FsbG93IFNTSCBhY2Nlc3MgZnJvbSB3aXRoaW4gVlBDJ1xuICAgICAgICApO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgYCR7dGhpcy5lYzJDb25maWcuaW5zdGFuY2VOYW1lfS1zZ2AsIHNlY3VyaXR5R3JvdXAsIE91dHB1dFR5cGUuU0VDVVJJVFlHUk9VUCk7XG4gICAgICAgIHJldHVybiBzZWN1cml0eUdyb3VwO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENvbmZpZ3VyZXMgc2VydmljZSBkaXNjb3ZlcnkgZm9yIHRoZSBFQzIgaW5zdGFuY2UuXG4gICAgICogQ3JlYXRlcyBhIHByaXZhdGUgRE5TIG5hbWVzcGFjZSBhbmQgcmVnaXN0ZXJzIHRoZSBzZXJ2aWNlIGZvciBpbnRlcm5hbCBkaXNjb3ZlcnkuXG4gICAgICogXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBwcml2YXRlIGNvbmZpZ3VyZVNlcnZpY2VEaXNjb3ZlcnkoKSB7XG4gICAgICAgIGlmICghdGhpcy5lYzJDb25maWcuc2VydmljZURpc2NvdmVyeSkgcmV0dXJuO1xuXG4gICAgICAgIGNvbnN0IG5hbWVzcGFjZSA9IG5ldyBQcml2YXRlRG5zTmFtZXNwYWNlKHRoaXMubWFpblN0YWNrLCBgJHt0aGlzLmVjMkNvbmZpZy5pbnN0YW5jZU5hbWV9LW5hbWVzcGFjZWAsIHtcbiAgICAgICAgICAgIG5hbWU6IHRoaXMuZWMyQ29uZmlnLnNlcnZpY2VEaXNjb3ZlcnkubmFtZXNwYWNlLFxuICAgICAgICAgICAgdnBjOiB0aGlzLnZwYyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5jbG91ZE1hcFNlcnZpY2UgPSBuZXcgU2VydmljZSh0aGlzLm1haW5TdGFjaywgYCR7dGhpcy5lYzJDb25maWcuaW5zdGFuY2VOYW1lfS1zZXJ2aWNlYCwge1xuICAgICAgICAgICAgbmFtZXNwYWNlOiBuYW1lc3BhY2UsXG4gICAgICAgICAgICBuYW1lOiB0aGlzLmVjMkNvbmZpZy5zZXJ2aWNlRGlzY292ZXJ5LnNlcnZpY2VOYW1lLFxuICAgICAgICAgICAgZG5zUmVjb3JkVHlwZTogRG5zUmVjb3JkVHlwZS5BLFxuICAgICAgICAgICAgZG5zVHRsOiBEdXJhdGlvbi5zZWNvbmRzKDYwKSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCBgJHt0aGlzLmVjMkNvbmZpZy5pbnN0YW5jZU5hbWV9LWRpc2NvdmVyeWAsIHRoaXMuY2xvdWRNYXBTZXJ2aWNlLCBPdXRwdXRUeXBlLlNFUlZJQ0VfRElTQ09WRVJZKTtcbiAgICB9XG5cbn1cblxuIl19
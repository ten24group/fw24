import { Stack, RemovalPolicy, Duration } from "aws-cdk-lib";
import {
    Vpc,
    Instance,
    InstanceType,
    InstanceClass,
    InstanceSize,
    MachineImage,
    SecurityGroup,
    SecurityGroupProps,
    Port,
    SubnetType,
    ISecurityGroup,
    Peer,
    IVpc,
    ISubnet,
    Subnet,
    UserData,
    Volume,
    BlockDeviceVolume,
    EbsDeviceVolumeType,
    IVolume,
    AmazonLinuxCpuType,
    AmazonLinuxGeneration,
    AmazonLinuxImage,
    InstanceProps
} from 'aws-cdk-lib/aws-ec2';
import { DockerImageAsset, DockerImageAssetProps } from "aws-cdk-lib/aws-ecr-assets";
import { PolicyStatement, ManagedPolicy, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { PrivateDnsNamespace, Service, DnsRecordType } from 'aws-cdk-lib/aws-servicediscovery';
import * as path from 'path';
import { Platform } from "aws-cdk-lib/aws-ecr-assets";

import { Helper } from "../core/helper";
import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutput, OutputType } from "../interfaces/construct";
import { IConstructConfig } from "../interfaces/construct-config";
import { LogDuration, createLogger } from "../logging";
import { VpcConstruct } from "./vpc";

/**
 * Examples of using the EC2 Construct
 * 
 * @example
 * ```typescript
 * // Example 1: Basic EC2 instance with Docker container
 * const ec2Instance = new Ec2Construct({
 *   instanceName: 'my-app',
 *   vpcName: 'main-vpc',
 *   container: {
 *     dockerFilePath: './src/app/Dockerfile',
 *     containerPort: 3000,
 *     environment: {
 *       NODE_ENV: 'production',
 *       API_VERSION: 'v1'
 *     }
 *   },
 *   instanceProps: {
 *     instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.MEDIUM),
 *   },
 *   volumes: [{
 *     sizeGiB: 20  // Simplified: auto-generates device name and defaults to GP3 with encryption
 *   }]
 *   // Or specify device name explicitly:
 *   // volumes: [{
 *   //   deviceName: '/dev/sdf',
 *   //   sizeGiB: 20
 *   // }]
 *   // Or use full configuration:
 *   // volumes: [{
 *   //   deviceName: '/dev/sdf',
 *   //   volume: BlockDeviceVolume.ebs(20, {
 *   //     volumeType: EbsDeviceVolumeType.GP3,
 *   //     encrypted: true
 *   //   })
 *   // }]
 * });
 * 
 * // Example 2: EC2 instance with custom subnet and security group
 * const customInstance = new Ec2Construct({
 *   instanceName: 'worker',
 *   vpcName: 'main-vpc',
 *   subnet: {
 *     subnetId: 'subnet-12345'
 *   },
 *   securityGroup: {
 *     securityGroupId: 'sg-existing'
 *   },
 *   container: {
 *     dockerFilePath: './src/worker/Dockerfile',
 *     containerPort: 8080,
 *     environment: {
 *       QUEUE_URL: 'https://sqs.region.amazonaws.com/account/queue'
 *     },
 *     command: ['npm', 'start']
 *   },
 *   instanceProps: {
 *     instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
 *     userData: UserData.custom('# Custom user data script')
 *   },
 *   volumes: [{
 *     deviceName: '/dev/sdf',
 *     volume: BlockDeviceVolume.ebs(100, {
 *       volumeType: EbsDeviceVolumeType.IO1,
 *       iops: 3000,
 *       encrypted: true
 *     })
 *   }]
 * });
 * 
 * // Example 3: EC2 instance in private subnet with existing VPC
 * const privateInstance = new Ec2Construct({
 *   instanceName: 'internal-service',
 *   vpc: existingVpc,
 *   subnetConfig: {
 *     subnetType: SubnetType.PRIVATE_WITH_EGRESS
 *   },
 *   container: {
 *     dockerFilePath: './src/internal/Dockerfile',
 *     containerPort: 9000
 *   },
 *   instanceProps: {
 *     instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.SMALL),
 *   }
 * });
 * 
 * // Add to your application
 * const app = new Application()
 *   .use(ec2Instance)
 *   .use(customInstance)
 *   .use(privateInstance)
 *   .run();
 * ```
 */

export interface IEc2ContainerConfig {
    /**
     * Path to the Dockerfile
     */
    dockerFilePath: string;
    /**
     * Container port to expose
     */
    containerPort: number;
    /**
     * Environment variables to pass to the container
     */
    environment?: Record<string, string>;
    /**
     * Docker command to run (optional)
     */
    command?: string[];
    /**
     * Docker container name (optional)
     */
    containerName?: string;
    /**
     * Additional docker run options (optional)
     */
    dockerRunOptions?: string[];
}

export interface IEc2SecurityGroupConfig {
    /**
     * ID of an existing security group to use
     */
    securityGroupId?: string;
    /**
     * Properties for creating a new security group
     */
    props?: SecurityGroupProps;
}

export interface IEc2SubnetConfig {
    /**
     * ID of an existing subnet to use
     */
    subnetId?: string;
    /**
     * Subnet type to use (if not using existing subnet)
     */
    subnetType?: SubnetType;
}

export interface IEc2VolumeConfig {
    /**
     * Device name for the volume (e.g., '/dev/sdf')
     * If not specified, will be auto-generated starting from '/dev/sdf'
     */
    deviceName?: string;
    /**
     * Block device volume configuration (optional if size is specified)
     */
    volume?: BlockDeviceVolume;
    /**
     * Volume size in GiB (optional if volume is specified)
     * If only size is specified, defaults to GP3 volume type with standard settings
     */
    sizeGiB?: number;
}

export interface IEc2ServiceDiscoveryConfig {
    /**
     * Name for the service in service discovery
     */
    serviceName: string;
    /**
     * Namespace for service discovery
     */
    namespace: string;
}

/**
 * Configuration for IAM role policies
 */
export interface IEc2RolePolicyConfig {
    /**
     * List of managed policy ARNs to attach to the role
     */
    managedPolicyArns?: string[];

    /**
     * List of managed policies to attach to the role
     */
    managedPolicies?: ManagedPolicy[];

    /**
     * List of inline policy statements to add to the role
     */
    inlinePolicies?: PolicyStatement[];
}

/**
 * Configuration for instance roles
 */
export interface IEc2InstanceRoleConfig extends IEc2RolePolicyConfig {
    /**
     * Custom role name
     */
    roleName?: string;
}

/**
 * Configuration for the EC2 construct
 */
export interface IEc2ConstructConfig extends IConstructConfig {
    /**
     * Name of the EC2 instance
     */
    instanceName: string;

    /**
     * Container configuration
     */
    container: IEc2ContainerConfig;

    /**
     * VPC Name to use (must exist)
     * @example 'main-vpc'
     */
    vpcName?: string;

    /**
     * VPC instance to use (if not using vpcName)
     */
    vpc?: Vpc;

    /**
     * Subnet configuration
     */
    subnet?: IEc2SubnetConfig;

    /**
     * Subnet type configuration (simplified)
     */
    subnetConfig?: {
        subnetType: SubnetType;
    };

    /**
     * Security group configuration
     */
    securityGroup?: IEc2SecurityGroupConfig;

    /**
     * IAM instance role configuration
     */
    instanceRole?: IEc2InstanceRoleConfig;

    /**
     * EBS volume configurations
     */
    volumes?: IEc2VolumeConfig[];

    /**
     * Service discovery configuration (for internal DNS resolution)
     */
    serviceDiscovery?: IEc2ServiceDiscoveryConfig;

    /**
     * CDK Instance construct properties
     * These properties will be merged with our default configuration
     */
    instanceProps?: Partial<InstanceProps>;

    /**
     * Docker image properties
     */
    dockerImageProps?: Partial<DockerImageAssetProps>;
}

export class Ec2Construct implements FW24Construct {
    readonly logger = createLogger(Ec2Construct.name);
    readonly fw24: Fw24 = Fw24.getInstance();
    
    name: string = Ec2Construct.name;
    dependencies: string[] = [VpcConstruct.name];
    output!: FW24ConstructOutput;

    mainStack!: Stack;
    private instance!: Instance;
    private vpc!: IVpc;
    private cloudMapService!: Service;

    /**
     * Creates a new EC2 construct with the specified configuration.
     * Initializes default values and merges user-provided configuration.
     * 
     * @param ec2Config - The configuration object for the EC2 instance
     */
    constructor(private ec2Config: IEc2ConstructConfig) {
        Helper.hydrateConfig(ec2Config, 'EC2');

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
    private createInstanceRole(): Role {
        const role = new Role(this.mainStack, `${this.ec2Config.instanceName}-instance-role`, {
            roleName: this.ec2Config.instanceRole?.roleName,
            assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
            description: `Instance role for ${this.ec2Config.instanceName} EC2 instance`,
        });

        if (this.ec2Config.instanceRole) {
            // Attach managed policies by ARN
            this.ec2Config.instanceRole.managedPolicyArns?.forEach((policyArn, index) => {
                role.addManagedPolicy(ManagedPolicy.fromManagedPolicyArn(
                    this.mainStack,
                    `${this.ec2Config.instanceName}-instance-managed-policy-${index}`,
                    policyArn
                ));
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
        role.addToPolicy(new PolicyStatement({
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
            role.addToPolicy(new PolicyStatement({
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
        role.addToPolicy(new PolicyStatement({
            actions: [
                'ssmmessages:CreateControlChannel',
                'ssmmessages:CreateDataChannel',
                'ssmmessages:OpenControlChannel',
                'ssmmessages:OpenDataChannel'
            ],
            resources: ['*']
        }));

        // Add EC2 Instance Connect and SSM permissions
        role.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
        );

        // Add CloudWatch Logs permissions
        role.addToPolicy(new PolicyStatement({
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
    private buildDockerUserData(dockerImageUri: string): string {
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
    @LogDuration()
    public async construct() {
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
        const dockerImage = new DockerImageAsset(this.mainStack, `${this.ec2Config.instanceName}-image`, {
            directory: path.dirname(this.ec2Config.container.dockerFilePath),
            file: path.basename(this.ec2Config.container.dockerFilePath),
            platform: this.ec2Config.dockerImageProps?.platform || Platform.LINUX_AMD64,
            ...this.ec2Config.dockerImageProps,
        });

        // Configure service discovery if specified (must be done before user data)
        if (this.ec2Config.serviceDiscovery) {
            this.configureServiceDiscovery();
        }

        // Build user data script
        const userData = UserData.custom(
            this.buildDockerUserData(dockerImage.imageUri)
        );


        // Merge user-provided user data if exists
        const { userData: customUserData, ...restInstanceProps } = this.ec2Config.instanceProps || {};
        if (customUserData) {
            // Combine user data scripts
            userData.addCommands(
                ...customUserData.render().split('\n').filter(line => line.trim())
            );
        }

        // Prepare block devices for volumes
        const blockDevices: Array<{ deviceName: string; volume: BlockDeviceVolume }> = [];
        if (this.ec2Config.volumes) {
            // Device names for EBS volumes typically start from /dev/sdf
            // Standard EBS device names: sdf, sdg, sdh, sdi, sdj, sdk, sdl, sdm, sdn, sdo, sdp
            const getDefaultDeviceName = (index: number): string => {
                const deviceSuffixes = ['f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p'];
                const suffix = deviceSuffixes[index] || String.fromCharCode(102 + index); // 102 is 'f' in ASCII
                return `/dev/sd${suffix}`;
            };
            
            this.ec2Config.volumes.forEach((volumeConfig, index) => {
                let volume: BlockDeviceVolume;
                
                // If volume is explicitly provided, use it
                if (volumeConfig.volume) {
                    volume = volumeConfig.volume;
                } 
                // If only size is provided, create GP3 volume with defaults
                else if (volumeConfig.sizeGiB) {
                    volume = BlockDeviceVolume.ebs(volumeConfig.sizeGiB, {
                        volumeType: EbsDeviceVolumeType.GP3,
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
        this.instance = new Instance(this.mainStack, `${this.ec2Config.instanceName}-instance`, {
            vpc: this.vpc,
            vpcSubnets: subnet ? { subnets: [subnet] } : { subnetType: this.ec2Config.subnetConfig?.subnetType || SubnetType.PRIVATE_WITH_EGRESS },
            securityGroup: securityGroup,
            role: instanceRole,
            instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.MICRO),
            machineImage: MachineImage.latestAmazonLinux2023({
                cpuType: AmazonLinuxCpuType.X86_64,
            }),
            userData: userData,
            blockDevices: blockDevices.length > 0 ? blockDevices : undefined,
            ...restInstanceProps,
        });

        // Set outputs
        this.fw24.setConstructOutput(this, this.ec2Config.instanceName, this.instance, OutputType.INSTANCE);
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
    private getVpc(): IVpc {
        if (!this.ec2Config.vpcName && !this.ec2Config.vpc) {
            throw new Error('VPC Name or VPC must be specified in the EC2 configuration');
        }

        if (this.ec2Config.vpc) {
            return this.ec2Config.vpc;
        }

        return Vpc.fromLookup(this.mainStack, `${this.ec2Config.instanceName}-vpc`, {
            vpcName: this.ec2Config.vpcName
        });
    }

    /**
     * Gets the subnet for the EC2 instance either from the provided configuration or returns undefined.
     * 
     * @returns The subnet instance or undefined if using subnet type
     * @private
     */
    private getSubnet(): ISubnet | undefined {
        if (this.ec2Config.subnet?.subnetId) {
            return Subnet.fromSubnetId(
                this.mainStack,
                `${this.ec2Config.instanceName}-imported-subnet`,
                this.ec2Config.subnet.subnetId
            );
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
    private getOrCreateSecurityGroup(): ISecurityGroup {
        if (this.ec2Config.securityGroup?.securityGroupId) {
            return SecurityGroup.fromSecurityGroupId(
                this.mainStack, 
                `${this.ec2Config.instanceName}-imported-sg`,
                this.ec2Config.securityGroup.securityGroupId
            );
        }

        const securityGroup = new SecurityGroup(this.mainStack, `${this.ec2Config.instanceName}-sg`, {
            vpc: this.vpc,
            allowAllOutbound: true,
            description: `Security group for ${this.ec2Config.instanceName} EC2 instance`,
            ...this.ec2Config.securityGroup?.props,
        });

        // Allow inbound traffic on container port from within VPC
        securityGroup.addIngressRule(
            Peer.ipv4(this.vpc.vpcCidrBlock),
            Port.tcp(this.ec2Config.container.containerPort),
            'Allow inbound traffic on container port from within VPC'
        );

        // Allow SSH access from VPC (optional, can be removed for production)
        securityGroup.addIngressRule(
            Peer.ipv4(this.vpc.vpcCidrBlock),
            Port.tcp(22),
            'Allow SSH access from within VPC'
        );

        this.fw24.setConstructOutput(this, `${this.ec2Config.instanceName}-sg`, securityGroup, OutputType.SECURITYGROUP);
        return securityGroup;
    }

    /**
     * Configures service discovery for the EC2 instance.
     * Creates a private DNS namespace and registers the service for internal discovery.
     * 
     * @private
     */
    private configureServiceDiscovery() {
        if (!this.ec2Config.serviceDiscovery) return;

        const namespace = new PrivateDnsNamespace(this.mainStack, `${this.ec2Config.instanceName}-namespace`, {
            name: this.ec2Config.serviceDiscovery.namespace,
            vpc: this.vpc,
        });

        this.cloudMapService = new Service(this.mainStack, `${this.ec2Config.instanceName}-service`, {
            namespace: namespace,
            name: this.ec2Config.serviceDiscovery.serviceName,
            dnsRecordType: DnsRecordType.A,
            dnsTtl: Duration.seconds(60),
        });

        this.fw24.setConstructOutput(this, `${this.ec2Config.instanceName}-discovery`, this.cloudMapService, OutputType.SERVICE_DISCOVERY);
    }

}


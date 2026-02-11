import { Stack } from "aws-cdk-lib";
import { Vpc, SecurityGroupProps, SubnetType, BlockDeviceVolume, InstanceProps } from 'aws-cdk-lib/aws-ec2';
import { DockerImageAssetProps } from "aws-cdk-lib/aws-ecr-assets";
import { PolicyStatement, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutput } from "../interfaces/construct";
import { IConstructConfig } from "../interfaces/construct-config";
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
 *     sizeGiB: 20,
 *     mountPoint: '/data' // Simplified: auto-generates device name and mounts before container starts
 *   }]
 *   // Or specify device name explicitly:
 *   // volumes: [{
 *   //   deviceName: '/dev/sdf',
 *   //   sizeGiB: 20,
 *   //   mountPoint: '/data'
 *   // }]
 *   // Or use full configuration:
 *   // volumes: [{
 *   //   deviceName: '/dev/sdf',
 *   //   volume: BlockDeviceVolume.ebs(20, {
 *   //     volumeType: EbsDeviceVolumeType.GP3,
 *   //     encrypted: true
 *   //   }),
 *   //   mountPoint: '/data'
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
 *     }),
 *     mountPoint: '/data'
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
     * Existing EBS volume ID to attach (optional)
     * If provided, the volume will be attached and not created by the instance.
     */
    volumeId?: string;
    /**
     * Volume size in GiB (optional if volume is specified)
     * If only size is specified, defaults to GP3 volume type with standard settings
     */
    sizeGiB?: number;
    /**
     * Mount point for the volume (optional). When provided, the construct will
     * format (if needed) and mount before the container starts.
     */
    mountPoint?: string;
    /**
     * Filesystem type to use when formatting (defaults to 'ext4')
     */
    fileSystem?: string;
    /**
     * Whether to delete the volume on instance termination (only applies to created volumes)
     * Defaults to false.
     */
    deleteOnTermination?: boolean;
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
export declare class Ec2Construct implements FW24Construct {
    private ec2Config;
    readonly logger: import("tslog").Logger<import("tslog").ILogObj>;
    readonly fw24: Fw24;
    name: string;
    dependencies: string[];
    output: FW24ConstructOutput;
    mainStack: Stack;
    private instance;
    private vpc;
    private cloudMapService;
    /**
     * Creates a new EC2 construct with the specified configuration.
     * Initializes default values and merges user-provided configuration.
     *
     * @param ec2Config - The configuration object for the EC2 instance
     */
    constructor(ec2Config: IEc2ConstructConfig);
    /**
     * Creates an IAM instance role for the EC2 instance with specified permissions.
     * This role defines what AWS services the instance can access.
     *
     * @returns The created IAM Role instance with configured permissions
     * @private
     */
    private createInstanceRole;
    private getDefaultDeviceName;
    /**
     * Builds Docker user data script to install Docker and run the container
     *
     * @param dockerImageUri - The URI of the Docker image to run
     * @returns The user data script as a string
     * @private
     */
    private buildDockerUserData;
    private buildVolumeUserData;
    /**
     * Constructs all necessary AWS resources for the EC2 instance.
     * This includes VPC, security groups, instance configuration, Docker setup, and volumes.
     *
     * @returns Promise that resolves when all resources are created
     * @public
     */
    construct(): Promise<void>;
    /**
     * Gets the VPC for the EC2 instance either from the provided configuration or looks it up by name.
     *
     * @returns The VPC instance to be used for the EC2 instance
     * @throws Error if neither VPC name nor VPC instance is provided
     * @private
     */
    private getVpc;
    /**
     * Gets the subnet for the EC2 instance either from the provided configuration or returns undefined.
     *
     * @returns The subnet instance or undefined if using subnet type
     * @private
     */
    private getSubnet;
    /**
     * Gets an existing security group or creates a new one for the EC2 instance.
     * If a security group ID is provided, it will use that group.
     * Otherwise, it creates a new security group with appropriate ingress rules.
     *
     * @returns The security group instance
     * @private
     */
    private getOrCreateSecurityGroup;
    /**
     * Configures service discovery for the EC2 instance.
     * Creates a private DNS namespace and registers the service for internal discovery.
     *
     * @private
     */
    private configureServiceDiscovery;
}

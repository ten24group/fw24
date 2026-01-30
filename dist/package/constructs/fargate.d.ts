import { Stack } from "aws-cdk-lib";
import { Vpc, SecurityGroupProps } from 'aws-cdk-lib/aws-ec2';
import { FargateServiceProps, FargateTaskDefinitionProps, ContainerDefinitionOptions } from 'aws-cdk-lib/aws-ecs';
import { DockerImageAssetProps } from "aws-cdk-lib/aws-ecr-assets";
import { FileSystemProps } from 'aws-cdk-lib/aws-efs';
import { PolicyStatement, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutput } from "../interfaces/construct";
import { IConstructConfig } from "../interfaces/construct-config";
/**
 * Examples of using the Fargate Construct
 *
 * @example
 * ```typescript
 * // Example 1: Basic Fargate service with ALB and custom roles
 * const fargateService = new FargateConstruct({
 *   serviceName: 'my-api',
 *   vpcName: 'main-vpc',
 *   container: {
 *     dockerFilePath: './src/api/Dockerfile',
 *     containerPort: 3000,
 *     containerProps: {
 *       environment: {
 *         NODE_ENV: 'production',
 *         API_VERSION: 'v1'
 *       },
 *       healthCheck: {
 *         command: ['CMD-SHELL', 'curl -f http://localhost:3000/health || exit 1'],
 *         interval: Duration.seconds(30),
 *         timeout: Duration.seconds(5),
 *         retries: 3
 *       }
 *     }
 *   },
 *   loadBalancer: {
 *     domainName: 'api.example.com',
 *     certificateArn: 'arn:aws:acm:region:account:certificate/certificate-id'
 *   },
 *   taskRole: {
 *     roleName: 'my-api-task-role',
 *     managedPolicyArns: [
 *       'arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess',
 *       'arn:aws:iam::aws:policy/AWSAppMeshEnvoyAccess'
 *     ],
 *     inlinePolicies: [
 *       new PolicyStatement({
 *         actions: ['s3:GetObject', 's3:PutObject'],
 *         resources: ['arn:aws:s3:::my-bucket/*']
 *       })
 *     ]
 *   },
 *   executionRole: {
 *     managedPolicyArns: [
 *       'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
 *       'arn:aws:iam::aws:policy/CloudWatchLogsFullAccess'
 *     ],
 *     inlinePolicies: [
 *       new PolicyStatement({
 *         actions: ['secretsmanager:GetSecretValue'],
 *         resources: ['arn:aws:secretsmanager:region:account:secret:my-secret-*']
 *       })
 *     ]
 *   },
 *   taskDefinitionProps: {
 *     cpu: 512,
 *     memoryLimitMiB: 1024,
 *   },
 *   serviceProps: {
 *     desiredCount: 2,
 *     minHealthyPercent: 50,
 *     maxHealthyPercent: 200,
 *     minCapacity: 2,
 *     maxCapacity: 10,
 *     targetCpuUtilization: 70,
 *     circuitBreaker: { rollback: true }
 *   }
 * });
 *
 * // Example 2: Internal service with service discovery and EFS
 * const internalService = new FargateConstruct({
 *   serviceName: 'internal-service',
 *   vpcName: 'main-vpc',
 *   container: {
 *     dockerFilePath: './src/internal/Dockerfile',
 *     containerPort: 8080,
 *     containerProps: {
 *       healthCheck: {
 *         command: ['CMD-SHELL', 'curl -f http://localhost:8080/health || exit 1'],
 *         interval: Duration.seconds(30),
 *         timeout: Duration.seconds(5),
 *         retries: 3
 *       },
 *       logging: new AwsLogDriver({
 *         streamPrefix: 'internal-service',
 *         logRetention: RetentionDays.TWO_WEEKS
 *       })
 *     }
 *   },
 *   serviceDiscovery: {
 *     namespace: 'internal.local',
 *     serviceName: 'backend'
 *   },
 *   efs: {
 *     name: 'shared-storage',
 *     containerPath: '/data',
 *     rootDirectory: '/shared',
 *     performanceMode: PerformanceMode.GENERAL_PURPOSE,
 *     throughputMode: ThroughputMode.BURSTING,
 *     encrypted: true,
 *     enableAutomaticBackups: true
 *   },
 *   rootVolume: {
 *     sizeGiB: 30
 *   },
 *   taskDefinitionProps: {
 *     ephemeralStorageGiB: 50,
 *     cpu: '1024',
 *     memoryLimitMiB: '2048'
 *   }
 * });
 *
 * // Example 3: Using existing cluster and security group with EFS
 * const serviceInExistingCluster = new FargateConstruct({
 *   serviceName: 'worker',
 *   vpcName: 'main-vpc',
 *   cluster: {
 *     name: 'existing-cluster'
 *   },
 *   securityGroup: {
 *     securityGroupId: 'sg-existing'
 *   },
 *   container: {
 *     dockerFilePath: './src/worker/Dockerfile',
 *     containerPort: 9000,
 *     containerProps: {
 *       environment: {
 *         QUEUE_URL: 'https://sqs.region.amazonaws.com/account/queue'
 *       },
 *       secrets: {
 *         API_KEY: Secret.fromSecretsManager(secret, 'api-key')
 *       }
 *     }
 *   },
 *   efs: {
 *     containerPath: '/shared-data',
 *     performanceMode: PerformanceMode.MAX_IO,
 *     throughputMode: ThroughputMode.PROVISIONED,
 *     lifecyclePolicy: LifecyclePolicy.AFTER_14_DAYS
 *   },
 *   serviceProps: {
 *     enableExecuteCommand: true,
 *     capacityProviderStrategies: [{
 *       capacityProvider: 'FARGATE_SPOT',
 *       weight: 1
 *     }]
 *   }
 * });
 *
 * // Add to your application
 * const app = new Application()
 *   .use(fargateService)
 *   .use(internalService)
 *   .use(serviceInExistingCluster)
 *   .run();
 * ```
 */
/**
 * Extended FargateService properties that include auto-scaling configuration
 */
export interface ExtendedFargateServiceProps extends FargateServiceProps {
    /**
     * Minimum capacity for auto-scaling
     */
    minCapacity?: number;
    /**
     * Maximum capacity for auto-scaling
     */
    maxCapacity?: number;
    /**
     * Target CPU utilization percentage for auto-scaling
     */
    targetCpuUtilization?: number;
    /**
     * Target memory utilization percentage for auto-scaling
     */
    targetMemoryUtilization?: number;
}
export interface IFargateContainerConfig {
    /**
     * Path to the Dockerfile
     */
    dockerFilePath: string;
    /**
     * Container port to expose
     */
    containerPort: number;
    /**
     * Container definition options from CDK
     */
    containerProps?: ContainerDefinitionOptions;
}
export interface IFargateServiceDiscoveryConfig {
    /**
     * Name for the service in service discovery
     */
    serviceName: string;
    /**
     * Namespace for service discovery
     */
    namespace: string;
}
export interface IFargateLoadBalancerConfig {
    /**
     * Domain name for the ALB
     */
    domainName?: string;
    /**
     * Certificate ARN for HTTPS
     */
    certificateArn?: string;
    /**
     * Path patterns to route to this service
     */
    pathPatterns?: string[];
    /**
     * Host headers to route to this service
     */
    hostHeaders?: string[];
}
export interface IFargateSecurityGroupConfig {
    /**
     * ID of an existing security group to use
     */
    securityGroupId?: string;
    /**
     * Properties for creating a new security group
     */
    props?: SecurityGroupProps;
}
export interface IClusterConfig {
    /**
     * Name of the cluster
     */
    name: string;
}
export interface IFargateEfsConfig {
    /**
     * Name of the EFS file system
     */
    name?: string;
    /**
     * Container path where EFS will be mounted
     */
    containerPath: string;
    /**
     * EFS root directory to mount
     * @default "/"
     */
    rootDirectory?: string;
    /**
     * Additional properties for the EFS file system
     * These properties will be merged with our default configuration
     * @see aws-cdk-lib/aws-efs/FileSystemProps
     */
    fileSystemProps?: Partial<FileSystemProps>;
    /**
     * Access point configuration for the EFS file system
     */
    accessPointProps?: {
        /**
         * The POSIX user and group applied to all file system requests
         */
        posixUser?: {
            uid: string;
            gid: string;
        };
        /**
         * Creation info for the access point
         */
        createAcl?: {
            ownerUid: string;
            ownerGid: string;
            permissions: string;
        };
    };
}
export interface IFargateRootVolumeConfig {
    /**
     * Size of the root volume in GiB
     * @default 20
     */
    sizeGiB?: number;
}
/**
 * Configuration for IAM role policies
 */
export interface IFargateRolePolicyConfig {
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
 * Configuration for task roles
 */
export interface IFargateTaskRoleConfig extends IFargateRolePolicyConfig {
    /**
     * Custom role name
     */
    roleName?: string;
}
/**
 * Configuration for the Fargate service construct
 */
export interface IFargateConstructConfig extends IConstructConfig {
    /**
     * Name of the service
     */
    serviceName: string;
    /**
     * Container configuration
     */
    container: IFargateContainerConfig;
    /**
     * Cluster configuration
     */
    cluster?: IClusterConfig;
    /**
     * VPC Name to use (must exist)
     * @example 'main-vpc'
     */
    vpcName?: string;
    /**
     * VPC
     */
    vpc?: Vpc;
    /**
     * Security group configuration
     */
    securityGroup?: IFargateSecurityGroupConfig;
    /**
     * Load balancer configuration (if using ALB)
     */
    loadBalancer?: IFargateLoadBalancerConfig;
    /**
     * Service discovery configuration (if not using ALB)
     */
    serviceDiscovery?: IFargateServiceDiscoveryConfig;
    /**
     * EFS configuration
     */
    efs?: IFargateEfsConfig;
    /**
     * Root volume configuration
     */
    rootVolume?: IFargateRootVolumeConfig;
    /**
     * Task role configuration
     */
    taskRole?: IFargateTaskRoleConfig;
    /**
     * Execution role configuration
     */
    executionRole?: IFargateRolePolicyConfig;
    /**
     * CDK FargateService construct properties with additional auto-scaling options
     * These properties will be merged with our default configuration
     */
    serviceProps?: Partial<ExtendedFargateServiceProps>;
    /**
     * CDK FargateTaskDefinition construct properties
     * These properties will be merged with our default configuration
     */
    taskDefinitionProps?: Partial<FargateTaskDefinitionProps>;
    /**
     * Docker image properties
     */
    dockerImageProps?: Partial<DockerImageAssetProps>;
}
export declare class FargateConstruct implements FW24Construct {
    private fargateConfig;
    readonly logger: import("tslog").Logger<import("tslog").ILogObj>;
    readonly fw24: Fw24;
    name: string;
    dependencies: string[];
    output: FW24ConstructOutput;
    mainStack: Stack;
    private taskDefinition;
    private container;
    private cluster;
    private vpc;
    /**
     * Creates a new Fargate construct with the specified configuration.
     * Initializes default values and merges user-provided configuration.
     *
     * @param fargateConfig - The configuration object for the Fargate service
     */
    constructor(fargateConfig: IFargateConstructConfig);
    /**
     * Creates an IAM task role for the Fargate service with specified permissions.
     * This role defines what AWS services the container can access.
     *
     * @returns The created IAM Role instance with configured permissions
     * @private
     */
    private createTaskRole;
    /**
     * Creates an IAM execution role for the Fargate service.
     * This role is used by ECS to pull container images and publish logs to CloudWatch.
     *
     * @returns The created IAM Role instance with necessary permissions for task execution
     * @private
     */
    private createExecutionRole;
    /**
     * Constructs all necessary AWS resources for the Fargate service.
     * This includes VPC, security groups, ECS cluster, task definition, container configuration,
     * load balancer (if specified), and service discovery (if specified).
     *
     * @returns Promise that resolves when all resources are created
     * @public
     */
    construct(): Promise<void>;
    /**
     * Gets the VPC for the Fargate service either from the provided configuration or looks it up by name.
     *
     * @returns The VPC instance to be used for the Fargate service
     * @throws Error if neither VPC name nor VPC instance is provided
     * @private
     */
    private getVpc;
    /**
     * Gets an existing cluster or creates a new one based on the configuration.
     * If a cluster name is provided in the config, it will look up and use that cluster.
     * Otherwise, it creates a new cluster with container insights enabled.
     *
     * @returns The ECS cluster instance
     * @private
     */
    private getOrCreateCluster;
    /**
     * Gets an existing security group or creates a new one for the Fargate service.
     * If a security group ID is provided, it will use that group.
     * Otherwise, it creates a new security group with appropriate ingress rules.
     *
     * @returns The security group instance
     * @private
     */
    private getOrCreateSecurityGroup;
    /**
     * Creates a security group for the Application Load Balancer.
     * This security group allows inbound HTTP/HTTPS traffic and outbound traffic to the Fargate service.
     *
     * @param vpc - The VPC where the security group will be created
     * @returns The created security group for the ALB
     * @private
     */
    private createAlbSecurityGroup;
    /**
     * Configures security group rules between the ALB and Fargate service.
     * Sets up ingress rules to allow traffic from ALB to the container port.
     *
     * @param serviceSecurityGroup - The security group attached to the Fargate service
     * @param albSecurityGroup - The security group attached to the ALB
     * @private
     */
    private configureSecurityGroupRules;
    /**
     * Configures the Application Load Balancer for the Fargate service.
     * Sets up listeners, target groups, and routing rules for HTTPS traffic.
     *
     * @param fargateService - The Fargate service to attach to the ALB
     * @param serviceSecurityGroup - The security group for the Fargate service
     * @returns Promise that resolves when ALB configuration is complete
     * @private
     */
    private configureLoadBalancer;
    /**
     * Gets an existing certificate or creates a new one for HTTPS.
     * If a certificate ARN is provided, it will use that certificate.
     * Otherwise, it creates a new certificate using the CertificateConstruct.
     *
     * @returns Promise that resolves to the certificate or undefined if not needed
     * @private
     */
    private getOrCreateCertificate;
    /**
     * Configures service discovery for the Fargate service.
     * Creates a private DNS namespace and registers the service for internal discovery.
     *
     * @param fargateService - The Fargate service to configure service discovery for
     * @private
     */
    private configureServiceDiscovery;
    /**
     * Creates an EFS file system for persistent storage.
     * Sets up security groups, mount targets, and encryption settings.
     *
     * @param serviceSecurityGroup - The security group for the Fargate service
     * @returns The created FileSystem instance or undefined if EFS is not configured
     * @private
     */
    private createEfsFileSystem;
    /**
     * Creates an EFS Access Point for the Fargate service.
     * This access point provides application-specific entry points to the EFS file system
     * with specified permissions and root directory configurations.
     *
     * @param fileSystem - The EFS FileSystem to create the access point for
     * @returns The created AccessPoint instance or undefined if EFS is not configured
     * @throws Error if fileSystem is not provided or if root directory path is invalid
     */
    private createEfsAccessPoint;
    /**
     * Configures the EFS volume for the task definition.
     * Sets up the volume configuration with the specified access point and mount options.
     *
     * @param fileSystem - The EFS file system to mount
     * @param accessPoint - The access point to use for the mount
     * @private
     */
    private configureEfsVolume;
    /**
     * Configures the root volume for the task definition.
     * Sets up ephemeral storage with the specified size and configuration.
     *
     * @param taskDefinition - The task definition to configure the root volume for
     * @private
     */
    private configureRootVolume;
}

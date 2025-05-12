import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { 
    Vpc,
    SecurityGroup,
    SecurityGroupProps,
    Port,
    SubnetType,
    ISecurityGroup,
    Peer,
    IVpc
} from 'aws-cdk-lib/aws-ec2';
import {
    Cluster,
    ContainerImage,
    FargateService,
    FargateTaskDefinition,
    Protocol,
    AwsLogDriver,
    ICluster,
    Volume,
    EfsVolumeConfiguration,
    ContainerDefinition,
    Scope,
    FargateServiceProps,
    FargateTaskDefinitionProps,
    ContainerDefinitionOptions,
    ContainerInsights
} from 'aws-cdk-lib/aws-ecs';
import {
    ApplicationLoadBalancer,
    ApplicationProtocol
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import {
    Certificate,
    ICertificate
} from 'aws-cdk-lib/aws-certificatemanager';
import {
    PrivateDnsNamespace
} from 'aws-cdk-lib/aws-servicediscovery';
import { DockerImageAsset, DockerImageAssetProps } from "aws-cdk-lib/aws-ecr-assets";
import { FileSystem, AccessPoint, LifecyclePolicy, PerformanceMode, ThroughputMode, FileSystemProps } from 'aws-cdk-lib/aws-efs';
import { PolicyStatement, ManagedPolicy, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import { CfnMountTarget } from 'aws-cdk-lib/aws-efs';

import { Helper } from "../core/helper";
import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutput, OutputType } from "../interfaces/construct";
import { IConstructConfig } from "../interfaces/construct-config";
import { LogDuration, createLogger } from "../logging";
import { CertificateConstruct } from "./certificate";
import { VpcConstruct } from "./vpc";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";

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

export class FargateConstruct implements FW24Construct {
    readonly logger = createLogger(FargateConstruct.name);
    readonly fw24: Fw24 = Fw24.getInstance();
    
    name: string = FargateConstruct.name;
    dependencies: string[] = [VpcConstruct.name];
    output!: FW24ConstructOutput;

    mainStack!: Stack;
    private taskDefinition!: FargateTaskDefinition;
    private container!: ContainerDefinition;
    private cluster!: ICluster;
    private vpc!: IVpc;

    /**
     * Creates a new Fargate construct with the specified configuration.
     * Initializes default values and merges user-provided configuration.
     * 
     * @param fargateConfig - The configuration object for the Fargate service
     */
    constructor(private fargateConfig: IFargateConstructConfig) {
        Helper.hydrateConfig(fargateConfig, 'FARGATE');

        // Set default service configuration if not provided
        if (!this.fargateConfig.serviceProps) {
            this.fargateConfig.serviceProps = {};
        }

        // Create default service configuration
        const defaultServiceProps = {
            circuitBreaker: {
                rollback: true
            },
            deploymentConfiguration: {
                alarms: { alarmNames: [], enable: true, rollback: true },
                maxHealthyPercent: 200,
                minHealthyPercent: 100
            }
        };

        // Merge default configuration with user-provided configuration
        this.fargateConfig.serviceProps = {
            ...defaultServiceProps,
            ...this.fargateConfig.serviceProps
        };
    }

    /**
     * Creates an IAM task role for the Fargate service with specified permissions.
     * This role defines what AWS services the container can access.
     * 
     * @returns The created IAM Role instance with configured permissions
     * @private
     */
    private createTaskRole(): Role {
        const role = new Role(this.mainStack, `${this.fargateConfig.serviceName}-task-role`, {
            roleName: this.fargateConfig.taskRole?.roleName,
            assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
            description: `Task role for ${this.fargateConfig.serviceName} Fargate service`,
        });

        if (this.fargateConfig.taskRole) {
            // Attach managed policies by ARN
            this.fargateConfig.taskRole.managedPolicyArns?.forEach((policyArn, index) => {
                role.addManagedPolicy(ManagedPolicy.fromManagedPolicyArn(
                    this.mainStack,
                    `${this.fargateConfig.serviceName}-task-managed-policy-${index}`,
                    policyArn
                ));
            });

            // Attach managed policies
            this.fargateConfig.taskRole.managedPolicies?.forEach(policy => {
                role.addManagedPolicy(policy);
            });

            // Add inline policies
            this.fargateConfig.taskRole.inlinePolicies?.forEach(statement => {
                role.addToPolicy(statement);
            });
        }

        // Add default permissions for ECS task role
        role.addToPolicy(new PolicyStatement({
            actions: [
                'ecr:GetAuthorizationToken',
                'ecr:BatchCheckLayerAvailability',
                'ecr:GetDownloadUrlForLayer',
                'ecr:BatchGetImage'
            ],
            resources: ['*']
        }));

        // If EFS is configured, add EFS permissions
        if (this.fargateConfig.efs) {
            role.addToPolicy(new PolicyStatement({
                actions: [
                    'elasticfilesystem:ClientMount',
                    'elasticfilesystem:ClientWrite',
                    'elasticfilesystem:ClientRootAccess',
                    'elasticfilesystem:DescribeMountTargets'
                ],
                resources: ['*']
            }));
        }

        return role;
    }

    /**
     * Creates an IAM execution role for the Fargate service.
     * This role is used by ECS to pull container images and publish logs to CloudWatch.
     * 
     * @returns The created IAM Role instance with necessary permissions for task execution
     * @private
     */
    private createExecutionRole(): Role {
        const role = new Role(this.mainStack, `${this.fargateConfig.serviceName}-execution-role`, {
            assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
            description: `Execution role for ${this.fargateConfig.serviceName} Fargate service`,
        });

        // Add default execution role policy (always required)
        role.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
        );

        // Add CloudWatch Logs permissions (always required for container logs)
        role.addToPolicy(new PolicyStatement({
            actions: [
                'logs:CreateLogStream',
                'logs:PutLogEvents'
            ],
            resources: ['*']
        }));

        if (this.fargateConfig.executionRole) {
            // Attach managed policies by ARN
            this.fargateConfig.executionRole.managedPolicyArns?.forEach((policyArn, index) => {
                role.addManagedPolicy(ManagedPolicy.fromManagedPolicyArn(
                    this.mainStack,
                    `${this.fargateConfig.serviceName}-execution-managed-policy-${index}`,
                    policyArn
                ));
            });

            // Attach managed policies
            this.fargateConfig.executionRole.managedPolicies?.forEach(policy => {
                role.addManagedPolicy(policy);
            });

            // Add inline policies
            this.fargateConfig.executionRole.inlinePolicies?.forEach(statement => {
                role.addToPolicy(statement);
            });
        }

        return role;
    }

    /**
     * Constructs all necessary AWS resources for the Fargate service.
     * This includes VPC, security groups, ECS cluster, task definition, container configuration,
     * load balancer (if specified), and service discovery (if specified).
     * 
     * @returns Promise that resolves when all resources are created
     * @public
     */
    @LogDuration()
    public async construct() {
        this.mainStack = this.fw24.getStack(this.fargateConfig.stackName, this.fargateConfig.parentStackName);

        // Get VPC first as it's needed for all other resources
        this.vpc = this.getVpc();

        // Get or create Security Group
        const securityGroup = this.getOrCreateSecurityGroup();

        // Get or create ECS Cluster
        this.cluster = this.getOrCreateCluster();

        // Create task and execution roles
        const taskRole = this.createTaskRole();
        const executionRole = this.createExecutionRole();

        // Create Task Definition with roles, merging with user-provided props
        this.taskDefinition = new FargateTaskDefinition(this.mainStack, `${this.fargateConfig.serviceName}-task`, {
            cpu: 256,
            memoryLimitMiB: 512,
            taskRole,
            executionRole,
            ...this.fargateConfig.taskDefinitionProps,
        });

        // Build Docker image
        const dockerImage = new DockerImageAsset(this.mainStack, `${this.fargateConfig.serviceName}-image`, {
            directory: path.dirname(this.fargateConfig.container.dockerFilePath),
            file: path.basename(this.fargateConfig.container.dockerFilePath),
            platform: this.fargateConfig.dockerImageProps?.platform || Platform.LINUX_AMD64,
            ...this.fargateConfig.dockerImageProps,
        });

        // Add container to task, merging with user-provided props
        this.container = this.taskDefinition.addContainer(`${this.fargateConfig.serviceName}-container`, {
            image: ContainerImage.fromDockerImageAsset(dockerImage),
            logging: new AwsLogDriver({
                streamPrefix: this.fargateConfig.serviceName,
                logRetention: RetentionDays.ONE_WEEK,
            }),
            ...this.fargateConfig.container.containerProps,
        });

        this.container.addPortMappings({
            containerPort: this.fargateConfig.container.containerPort,
            protocol: Protocol.TCP,
        });

        // Configure root volume if specified
        this.configureRootVolume(this.taskDefinition);

        // Create Fargate Service, merging with user-provided props
        const fargateService = new FargateService(this.mainStack, `${this.fargateConfig.serviceName}-service`, {
            cluster: this.cluster,
            taskDefinition: this.taskDefinition,
            assignPublicIp: false,
            securityGroups: [securityGroup],
            vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
            minHealthyPercent: 100,
            maxHealthyPercent: 200,
            capacityProviderStrategies: [
                {
                    capacityProvider: 'FARGATE_SPOT',
                    base: 1,
                    weight: 1
                }
            ],
            ...this.fargateConfig.serviceProps,
        });

        // Create EFS if config exists
        if (this.fargateConfig.efs) {
            const fileSystem = this.createEfsFileSystem(securityGroup);
            const accessPoint = this.createEfsAccessPoint(fileSystem!);
            if (fileSystem && accessPoint) {
                this.configureEfsVolume(fileSystem, accessPoint);
            }
        }

        // Configure either ALB or Service Discovery
        if (this.fargateConfig.loadBalancer) {
            await this.configureLoadBalancer(fargateService, securityGroup);
        } else if (this.fargateConfig.serviceDiscovery) {
            this.configureServiceDiscovery(fargateService);
        }

        // Configure Auto Scaling if specified in serviceProps
        if (this.fargateConfig.serviceProps?.maxCapacity || this.fargateConfig.serviceProps?.minCapacity) {
            const scaling = fargateService.autoScaleTaskCount({
                minCapacity: this.fargateConfig.serviceProps.minCapacity || 1,
                maxCapacity: this.fargateConfig.serviceProps.maxCapacity || 10,
            });

            // If CPU utilization target is specified
            if (this.fargateConfig.serviceProps.targetCpuUtilization) {
                scaling.scaleOnCpuUtilization('CpuScaling', {
                    targetUtilizationPercent: this.fargateConfig.serviceProps.targetCpuUtilization,
                });
            }

            // If memory utilization target is specified
            if (this.fargateConfig.serviceProps.targetMemoryUtilization) {
                scaling.scaleOnMemoryUtilization('MemoryScaling', {
                    targetUtilizationPercent: this.fargateConfig.serviceProps.targetMemoryUtilization,
                });
            }
        }

        // Set outputs
        this.fw24.setConstructOutput(this, this.fargateConfig.serviceName, fargateService, OutputType.SERVICE);
        this.fw24.setEnvironmentVariable(`${this.fargateConfig.serviceName}ServiceArn`, fargateService.serviceArn);
    }

    /**
     * Gets the VPC for the Fargate service either from the provided configuration or looks it up by name.
     * 
     * @returns The VPC instance to be used for the Fargate service
     * @throws Error if neither VPC name nor VPC instance is provided
     * @private
     */
    private getVpc(): IVpc {
        if (!this.fargateConfig.vpcName && !this.fargateConfig.vpc) {
            throw new Error('VPC Name or VPC must be specified in the Fargate configuration');
        }

        if (this.fargateConfig.vpc) {
            return this.fargateConfig.vpc;
        }

        return Vpc.fromLookup(this.mainStack, `${this.fargateConfig.serviceName}-vpc`, {
            vpcName: this.fargateConfig.vpcName
        });
    }

    /**
     * Gets an existing cluster or creates a new one based on the configuration.
     * If a cluster name is provided in the config, it will look up and use that cluster.
     * Otherwise, it creates a new cluster with container insights enabled.
     * 
     * @returns The ECS cluster instance
     * @private
     */
    private getOrCreateCluster(): ICluster {
        if (this.fargateConfig.cluster?.name) {
            return Cluster.fromClusterAttributes(this.mainStack, `${this.fargateConfig.serviceName}-imported-cluster`, {
                clusterName: this.fargateConfig.cluster.name,
                vpc: this.vpc
            });
        }

        const clusterName = this.fargateConfig.cluster?.name || `${this.fargateConfig.serviceName}-cluster`;
        const cluster = new Cluster(this.mainStack, clusterName, {
            vpc: this.vpc,
            containerInsights: true,
            clusterName,
        });

        this.fw24.setConstructOutput(this, clusterName, cluster, OutputType.CLUSTER);
        return cluster;
    }

    /**
     * Gets an existing security group or creates a new one for the Fargate service.
     * If a security group ID is provided, it will use that group.
     * Otherwise, it creates a new security group with appropriate ingress rules.
     * 
     * @returns The security group instance
     * @private
     */
    private getOrCreateSecurityGroup(): ISecurityGroup {
        if (this.fargateConfig.securityGroup?.securityGroupId) {
            return SecurityGroup.fromSecurityGroupId(
                this.mainStack, 
                `${this.fargateConfig.serviceName}-imported-sg`,
                this.fargateConfig.securityGroup.securityGroupId
            );
        }

        const securityGroup = new SecurityGroup(this.mainStack, `${this.fargateConfig.serviceName}-sg`, {
            vpc: this.vpc,
            allowAllOutbound: true,
            description: `Security group for ${this.fargateConfig.serviceName} Fargate service`,
            ...this.fargateConfig.securityGroup?.props,
        });

        // If not using ALB, allow inbound traffic on container port from within VPC
        if (!this.fargateConfig.loadBalancer) {
            securityGroup.addIngressRule(
                Peer.ipv4(this.vpc.vpcCidrBlock),
                Port.tcp(this.fargateConfig.container.containerPort),
                'Allow inbound traffic on container port from within VPC'
            );
        }

        this.fw24.setConstructOutput(this, `${this.fargateConfig.serviceName}-sg`, securityGroup, OutputType.SECURITYGROUP);
        return securityGroup;
    }

    /**
     * Creates a security group for the Application Load Balancer.
     * This security group allows inbound HTTP/HTTPS traffic and outbound traffic to the Fargate service.
     * 
     * @param vpc - The VPC where the security group will be created
     * @returns The created security group for the ALB
     * @private
     */
    private createAlbSecurityGroup(vpc: IVpc): SecurityGroup {
        // Create ALB security group
        const albSecurityGroup = new SecurityGroup(this.mainStack, `${this.fargateConfig.serviceName}-alb-sg`, {
            vpc,
            allowAllOutbound: true,
            description: `Security group for ${this.fargateConfig.serviceName} ALB`,
        });

        // Allow inbound HTTPS traffic from anywhere to ALB
        albSecurityGroup.addIngressRule(
            Peer.anyIpv4(),
            Port.tcp(443),
            'Allow HTTPS traffic'
        );

        this.fw24.setConstructOutput(this, `${this.fargateConfig.serviceName}-alb-sg`, albSecurityGroup, OutputType.SECURITYGROUP);
        return albSecurityGroup;
    }

    /**
     * Configures security group rules between the ALB and Fargate service.
     * Sets up ingress rules to allow traffic from ALB to the container port.
     * 
     * @param serviceSecurityGroup - The security group attached to the Fargate service
     * @param albSecurityGroup - The security group attached to the ALB
     * @private
     */
    private configureSecurityGroupRules(serviceSecurityGroup: ISecurityGroup, albSecurityGroup: SecurityGroup) {
        // Allow inbound traffic from ALB to service on container port
        serviceSecurityGroup.addIngressRule(
            albSecurityGroup,
            Port.tcp(this.fargateConfig.container.containerPort),
            'Allow inbound from ALB'
        );
    }

    /**
     * Configures the Application Load Balancer for the Fargate service.
     * Sets up listeners, target groups, and routing rules for HTTPS traffic.
     * 
     * @param fargateService - The Fargate service to attach to the ALB
     * @param serviceSecurityGroup - The security group for the Fargate service
     * @returns Promise that resolves when ALB configuration is complete
     * @private
     */
    private async configureLoadBalancer(fargateService: FargateService, serviceSecurityGroup: ISecurityGroup) {
        // Create ALB security group with proper rules
        const albSecurityGroup = this.createAlbSecurityGroup(this.vpc);

        // Configure security group rules between ALB and service
        this.configureSecurityGroupRules(serviceSecurityGroup, albSecurityGroup);

        const lb = new ApplicationLoadBalancer(this.mainStack, `${this.fargateConfig.serviceName}-alb`, {
            vpc: this.vpc,
            internetFacing: true,
            securityGroup: albSecurityGroup,
        });

        const certificate = await this.getOrCreateCertificate();

        const listener = lb.addListener(`${this.fargateConfig.serviceName}-listener`, {
            port: 443,
            protocol: ApplicationProtocol.HTTPS,
            certificates: certificate ? [{ certificateArn: certificate.certificateArn }] : undefined,
        });

        // Create target group and add it to the listener
        const targetGroup = listener.addTargets(`${this.fargateConfig.serviceName}-target`, {
            port: this.fargateConfig.container.containerPort,
            protocol: ApplicationProtocol.HTTP,
            targets: [fargateService],
            healthCheck: {
                path: '/health',
                interval: Duration.seconds(30),
                timeout: Duration.seconds(5),
                healthyThresholdCount: 2,
                unhealthyThresholdCount: 3,
            }
        });

        this.fw24.setConstructOutput(this, `${this.fargateConfig.serviceName}-alb`, lb, OutputType.LOADBALANCER);
    }

    /**
     * Gets an existing certificate or creates a new one for HTTPS.
     * If a certificate ARN is provided, it will use that certificate.
     * Otherwise, it creates a new certificate using the CertificateConstruct.
     * 
     * @returns Promise that resolves to the certificate or undefined if not needed
     * @private
     */
    private async getOrCreateCertificate(): Promise<ICertificate | undefined> {
        if (!this.fargateConfig.loadBalancer) return undefined;

        if (this.fargateConfig.loadBalancer.domainName) {
            const certificateConstruct = new CertificateConstruct({
                domainName: this.fargateConfig.loadBalancer.domainName,
                certificateArn: this.fargateConfig.loadBalancer.certificateArn
            });

            certificateConstruct.construct();
            
            const certificate = certificateConstruct.output[OutputType.CERTIFICATE][this.fargateConfig.loadBalancer.domainName];
            return certificate;
        }

        return undefined;
    }

    /**
     * Configures service discovery for the Fargate service.
     * Creates a private DNS namespace and registers the service for internal discovery.
     * 
     * @param fargateService - The Fargate service to configure service discovery for
     * @private
     */
    private configureServiceDiscovery(fargateService: FargateService) {
        if (!this.fargateConfig.serviceDiscovery) return;

        const namespace = new PrivateDnsNamespace(this.mainStack, `${this.fargateConfig.serviceName}-namespace`, {
            name: this.fargateConfig.serviceDiscovery.namespace,
            vpc: this.vpc,
        });

        const service = fargateService.enableCloudMap({
            cloudMapNamespace: namespace,
            name: this.fargateConfig.serviceDiscovery.serviceName,
        });

        this.fw24.setConstructOutput(this, `${this.fargateConfig.serviceName}-discovery`, service, OutputType.SERVICE_DISCOVERY);
    }

    /**
     * Creates an EFS file system for persistent storage.
     * Sets up security groups, mount targets, and encryption settings.
     * 
     * @param serviceSecurityGroup - The security group for the Fargate service
     * @returns The created FileSystem instance or undefined if EFS is not configured
     * @private
     */
    private createEfsFileSystem(serviceSecurityGroup: ISecurityGroup): FileSystem | undefined {
        if (!this.fargateConfig.efs) {
            return undefined;
        }

        const efsSecurityGroup = new SecurityGroup(this.mainStack, `${this.fargateConfig.serviceName}-efs-sg`, {
            vpc: this.vpc,
            allowAllOutbound: true,
            description: `Security group for ${this.fargateConfig.serviceName} EFS`,
        });

        efsSecurityGroup.addIngressRule(
            Peer.securityGroupId(serviceSecurityGroup.securityGroupId),
            Port.tcp(2049),
            'Allow NFS access from Fargate service'
        );

        const fileSystem = new FileSystem(this.mainStack, `${this.fargateConfig.serviceName}-efs`, {
            vpc: this.vpc,
            vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
            securityGroup: efsSecurityGroup,
            encrypted: true,
            removalPolicy: RemovalPolicy.DESTROY,
            fileSystemName: this.fargateConfig.efs.name || `${this.fargateConfig.serviceName}-efs`,
            ...this.fargateConfig.efs.fileSystemProps,
        });

        this.fw24.setConstructOutput(this, 'efs', fileSystem, OutputType.EFS);

        return fileSystem;
    }

    /**
     * Creates an EFS Access Point for the Fargate service.
     * This access point provides application-specific entry points to the EFS file system
     * with specified permissions and root directory configurations.
     * 
     * @param fileSystem - The EFS FileSystem to create the access point for
     * @returns The created AccessPoint instance or undefined if EFS is not configured
     * @throws Error if fileSystem is not provided or if root directory path is invalid
     */
    private createEfsAccessPoint(fileSystem: FileSystem) {
        if (!this.fargateConfig.efs) {
            this.logger.debug('No EFS configuration found, skipping access point creation');
            return undefined;
        }

        if (!fileSystem) {
            throw new Error('FileSystem is required for creating an access point');
        }

        // Validate and normalize path
        const path = this.fargateConfig.efs.rootDirectory || '/';
        if (!path.startsWith('/')) {
            throw new Error('Root directory path must start with /');
        }

        this.logger.debug(`Creating EFS access point for service ${this.fargateConfig.serviceName} with path ${path}`);

        const accessPoint = new AccessPoint(this.mainStack, `${this.fargateConfig.serviceName}-ap`, {
            fileSystem,
            path,
            posixUser: this.fargateConfig.efs.accessPointProps?.posixUser || {
                uid: '1000',
                gid: '1000'
            },
            createAcl: this.fargateConfig.efs.accessPointProps?.createAcl || {
                ownerUid: '1000',
                ownerGid: '1000',
                permissions: '755'
            },
        });

        this.logger.debug(`Access point created with ID: ${accessPoint.accessPointId}`);
        this.fw24.setConstructOutput(this, 'efs-ap', accessPoint, OutputType.EFS);

        return accessPoint;
    }

    /**
     * Configures the EFS volume for the task definition.
     * Sets up the volume configuration with the specified access point and mount options.
     * 
     * @param fileSystem - The EFS file system to mount
     * @param accessPoint - The access point to use for the mount
     * @private
     */
    private configureEfsVolume(fileSystem: FileSystem, accessPoint: AccessPoint) {
        if (!this.fargateConfig.efs) {
            return;
        }

        const efsConfig = this.fargateConfig.efs;
        const accessPointId = accessPoint.accessPointId;

        // Add EFS volume to task definition
        const volume: Volume = {
            name: 'efs-volume',
            efsVolumeConfiguration: {
                fileSystemId: fileSystem.fileSystemId,
                transitEncryption: 'ENABLED',
                authorizationConfig: {
                    accessPointId,
                    iam: 'ENABLED'
                },
                rootDirectory: '/'
            }
        };

        // Add volume to task definition
        this.taskDefinition.addVolume(volume);

        // Mount volume in container
        this.container.addMountPoints({
            sourceVolume: 'efs-volume',
            containerPath: efsConfig.containerPath,
            readOnly: false
        });
    }

    /**
     * Configures the root volume for the task definition.
     * Sets up ephemeral storage with the specified size and configuration.
     * 
     * @param taskDefinition - The task definition to configure the root volume for
     * @private
     */
    private configureRootVolume(taskDefinition: FargateTaskDefinition) {
        const rootVolumeConfig = this.fargateConfig.rootVolume;
        if (rootVolumeConfig?.sizeGiB) {
            taskDefinition.addVolume({
                name: 'root',
                dockerVolumeConfiguration: {
                    scope: Scope.SHARED,
                    autoprovision: true,
                    driver: 'local',
                    driverOpts: {
                        'type': 'gp2',
                        'size': rootVolumeConfig.sizeGiB.toString()
                    }
                }
            });
        }
    }
} 
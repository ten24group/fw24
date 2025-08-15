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
exports.FargateConstruct = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const aws_ec2_1 = require("aws-cdk-lib/aws-ec2");
const aws_ecs_1 = require("aws-cdk-lib/aws-ecs");
const aws_elasticloadbalancingv2_1 = require("aws-cdk-lib/aws-elasticloadbalancingv2");
const aws_servicediscovery_1 = require("aws-cdk-lib/aws-servicediscovery");
const aws_ecr_assets_1 = require("aws-cdk-lib/aws-ecr-assets");
const aws_efs_1 = require("aws-cdk-lib/aws-efs");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const path = __importStar(require("path"));
const helper_1 = require("../core/helper");
const fw24_1 = require("../core/fw24");
const construct_1 = require("../interfaces/construct");
const logging_1 = require("../logging");
const certificate_1 = require("./certificate");
const vpc_1 = require("./vpc");
const aws_ecr_assets_2 = require("aws-cdk-lib/aws-ecr-assets");
class FargateConstruct {
    fargateConfig;
    logger = (0, logging_1.createLogger)(FargateConstruct.name);
    fw24 = fw24_1.Fw24.getInstance();
    name = FargateConstruct.name;
    dependencies = [vpc_1.VpcConstruct.name];
    output;
    mainStack;
    taskDefinition;
    container;
    cluster;
    vpc;
    /**
     * Creates a new Fargate construct with the specified configuration.
     * Initializes default values and merges user-provided configuration.
     *
     * @param fargateConfig - The configuration object for the Fargate service
     */
    constructor(fargateConfig) {
        this.fargateConfig = fargateConfig;
        helper_1.Helper.hydrateConfig(fargateConfig, 'FARGATE');
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
    createTaskRole() {
        const role = new aws_iam_1.Role(this.mainStack, `${this.fargateConfig.serviceName}-task-role`, {
            roleName: this.fargateConfig.taskRole?.roleName,
            assumedBy: new aws_iam_1.ServicePrincipal('ecs-tasks.amazonaws.com'),
            description: `Task role for ${this.fargateConfig.serviceName} Fargate service`,
        });
        if (this.fargateConfig.taskRole) {
            // Attach managed policies by ARN
            this.fargateConfig.taskRole.managedPolicyArns?.forEach((policyArn, index) => {
                role.addManagedPolicy(aws_iam_1.ManagedPolicy.fromManagedPolicyArn(this.mainStack, `${this.fargateConfig.serviceName}-task-managed-policy-${index}`, policyArn));
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
        role.addToPolicy(new aws_iam_1.PolicyStatement({
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
            role.addToPolicy(new aws_iam_1.PolicyStatement({
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
    createExecutionRole() {
        const role = new aws_iam_1.Role(this.mainStack, `${this.fargateConfig.serviceName}-execution-role`, {
            assumedBy: new aws_iam_1.ServicePrincipal('ecs-tasks.amazonaws.com'),
            description: `Execution role for ${this.fargateConfig.serviceName} Fargate service`,
        });
        // Add default execution role policy (always required)
        role.addManagedPolicy(aws_iam_1.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'));
        // Add CloudWatch Logs permissions (always required for container logs)
        role.addToPolicy(new aws_iam_1.PolicyStatement({
            actions: [
                'logs:CreateLogStream',
                'logs:PutLogEvents'
            ],
            resources: ['*']
        }));
        if (this.fargateConfig.executionRole) {
            // Attach managed policies by ARN
            this.fargateConfig.executionRole.managedPolicyArns?.forEach((policyArn, index) => {
                role.addManagedPolicy(aws_iam_1.ManagedPolicy.fromManagedPolicyArn(this.mainStack, `${this.fargateConfig.serviceName}-execution-managed-policy-${index}`, policyArn));
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
    async construct() {
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
        this.taskDefinition = new aws_ecs_1.FargateTaskDefinition(this.mainStack, `${this.fargateConfig.serviceName}-task`, {
            cpu: 256,
            memoryLimitMiB: 512,
            taskRole,
            executionRole,
            ...this.fargateConfig.taskDefinitionProps,
        });
        // Build Docker image
        const dockerImage = new aws_ecr_assets_1.DockerImageAsset(this.mainStack, `${this.fargateConfig.serviceName}-image`, {
            directory: path.dirname(this.fargateConfig.container.dockerFilePath),
            file: path.basename(this.fargateConfig.container.dockerFilePath),
            platform: this.fargateConfig.dockerImageProps?.platform || aws_ecr_assets_2.Platform.LINUX_AMD64,
            ...this.fargateConfig.dockerImageProps,
        });
        // Add container to task, merging with user-provided props
        this.container = this.taskDefinition.addContainer(`${this.fargateConfig.serviceName}-container`, {
            image: aws_ecs_1.ContainerImage.fromDockerImageAsset(dockerImage),
            logging: new aws_ecs_1.AwsLogDriver({
                streamPrefix: this.fargateConfig.serviceName,
                logRetention: aws_logs_1.RetentionDays.ONE_WEEK,
            }),
            ...this.fargateConfig.container.containerProps,
        });
        this.container.addPortMappings({
            containerPort: this.fargateConfig.container.containerPort,
            protocol: aws_ecs_1.Protocol.TCP,
        });
        // Configure root volume if specified
        this.configureRootVolume(this.taskDefinition);
        // Create Fargate Service, merging with user-provided props
        const fargateService = new aws_ecs_1.FargateService(this.mainStack, `${this.fargateConfig.serviceName}-service`, {
            cluster: this.cluster,
            taskDefinition: this.taskDefinition,
            assignPublicIp: false,
            securityGroups: [securityGroup],
            vpcSubnets: { subnetType: aws_ec2_1.SubnetType.PRIVATE_WITH_EGRESS },
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
            const accessPoint = this.createEfsAccessPoint(fileSystem);
            if (fileSystem && accessPoint) {
                this.configureEfsVolume(fileSystem, accessPoint);
            }
        }
        // Configure either ALB or Service Discovery
        if (this.fargateConfig.loadBalancer) {
            await this.configureLoadBalancer(fargateService, securityGroup);
        }
        else if (this.fargateConfig.serviceDiscovery) {
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
        this.fw24.setConstructOutput(this, this.fargateConfig.serviceName, fargateService, construct_1.OutputType.SERVICE);
        this.fw24.setEnvironmentVariable(`${this.fargateConfig.serviceName}ServiceArn`, fargateService.serviceArn);
    }
    /**
     * Gets the VPC for the Fargate service either from the provided configuration or looks it up by name.
     *
     * @returns The VPC instance to be used for the Fargate service
     * @throws Error if neither VPC name nor VPC instance is provided
     * @private
     */
    getVpc() {
        if (!this.fargateConfig.vpcName && !this.fargateConfig.vpc) {
            throw new Error('VPC Name or VPC must be specified in the Fargate configuration');
        }
        if (this.fargateConfig.vpc) {
            return this.fargateConfig.vpc;
        }
        return aws_ec2_1.Vpc.fromLookup(this.mainStack, `${this.fargateConfig.serviceName}-vpc`, {
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
    getOrCreateCluster() {
        if (this.fargateConfig.cluster?.name) {
            return aws_ecs_1.Cluster.fromClusterAttributes(this.mainStack, `${this.fargateConfig.serviceName}-imported-cluster`, {
                clusterName: this.fargateConfig.cluster.name,
                vpc: this.vpc
            });
        }
        const clusterName = this.fargateConfig.cluster?.name || `${this.fargateConfig.serviceName}-cluster`;
        const cluster = new aws_ecs_1.Cluster(this.mainStack, clusterName, {
            vpc: this.vpc,
            containerInsights: true,
            clusterName,
        });
        this.fw24.setConstructOutput(this, clusterName, cluster, construct_1.OutputType.CLUSTER);
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
    getOrCreateSecurityGroup() {
        if (this.fargateConfig.securityGroup?.securityGroupId) {
            return aws_ec2_1.SecurityGroup.fromSecurityGroupId(this.mainStack, `${this.fargateConfig.serviceName}-imported-sg`, this.fargateConfig.securityGroup.securityGroupId);
        }
        const securityGroup = new aws_ec2_1.SecurityGroup(this.mainStack, `${this.fargateConfig.serviceName}-sg`, {
            vpc: this.vpc,
            allowAllOutbound: true,
            description: `Security group for ${this.fargateConfig.serviceName} Fargate service`,
            ...this.fargateConfig.securityGroup?.props,
        });
        // If not using ALB, allow inbound traffic on container port from within VPC
        if (!this.fargateConfig.loadBalancer) {
            securityGroup.addIngressRule(aws_ec2_1.Peer.ipv4(this.vpc.vpcCidrBlock), aws_ec2_1.Port.tcp(this.fargateConfig.container.containerPort), 'Allow inbound traffic on container port from within VPC');
        }
        this.fw24.setConstructOutput(this, `${this.fargateConfig.serviceName}-sg`, securityGroup, construct_1.OutputType.SECURITYGROUP);
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
    createAlbSecurityGroup(vpc) {
        // Create ALB security group
        const albSecurityGroup = new aws_ec2_1.SecurityGroup(this.mainStack, `${this.fargateConfig.serviceName}-alb-sg`, {
            vpc,
            allowAllOutbound: true,
            description: `Security group for ${this.fargateConfig.serviceName} ALB`,
        });
        // Allow inbound HTTPS traffic from anywhere to ALB
        albSecurityGroup.addIngressRule(aws_ec2_1.Peer.anyIpv4(), aws_ec2_1.Port.tcp(443), 'Allow HTTPS traffic');
        this.fw24.setConstructOutput(this, `${this.fargateConfig.serviceName}-alb-sg`, albSecurityGroup, construct_1.OutputType.SECURITYGROUP);
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
    configureSecurityGroupRules(serviceSecurityGroup, albSecurityGroup) {
        // Allow inbound traffic from ALB to service on container port
        serviceSecurityGroup.addIngressRule(albSecurityGroup, aws_ec2_1.Port.tcp(this.fargateConfig.container.containerPort), 'Allow inbound from ALB');
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
    async configureLoadBalancer(fargateService, serviceSecurityGroup) {
        // Create ALB security group with proper rules
        const albSecurityGroup = this.createAlbSecurityGroup(this.vpc);
        // Configure security group rules between ALB and service
        this.configureSecurityGroupRules(serviceSecurityGroup, albSecurityGroup);
        const lb = new aws_elasticloadbalancingv2_1.ApplicationLoadBalancer(this.mainStack, `${this.fargateConfig.serviceName}-alb`, {
            vpc: this.vpc,
            internetFacing: true,
            securityGroup: albSecurityGroup,
        });
        const certificate = await this.getOrCreateCertificate();
        const listener = lb.addListener(`${this.fargateConfig.serviceName}-listener`, {
            port: 443,
            protocol: aws_elasticloadbalancingv2_1.ApplicationProtocol.HTTPS,
            certificates: certificate ? [{ certificateArn: certificate.certificateArn }] : undefined,
        });
        // Create target group and add it to the listener
        const targetGroup = listener.addTargets(`${this.fargateConfig.serviceName}-target`, {
            port: this.fargateConfig.container.containerPort,
            protocol: aws_elasticloadbalancingv2_1.ApplicationProtocol.HTTP,
            targets: [fargateService],
            healthCheck: {
                path: '/health',
                interval: aws_cdk_lib_1.Duration.seconds(30),
                timeout: aws_cdk_lib_1.Duration.seconds(5),
                healthyThresholdCount: 2,
                unhealthyThresholdCount: 3,
            }
        });
        this.fw24.setConstructOutput(this, `${this.fargateConfig.serviceName}-alb`, lb, construct_1.OutputType.LOADBALANCER);
    }
    /**
     * Gets an existing certificate or creates a new one for HTTPS.
     * If a certificate ARN is provided, it will use that certificate.
     * Otherwise, it creates a new certificate using the CertificateConstruct.
     *
     * @returns Promise that resolves to the certificate or undefined if not needed
     * @private
     */
    async getOrCreateCertificate() {
        if (!this.fargateConfig.loadBalancer)
            return undefined;
        if (this.fargateConfig.loadBalancer.domainName) {
            const certificateConstruct = new certificate_1.CertificateConstruct({
                domainName: this.fargateConfig.loadBalancer.domainName,
                certificateArn: this.fargateConfig.loadBalancer.certificateArn
            });
            certificateConstruct.construct();
            const certificate = certificateConstruct.output[construct_1.OutputType.CERTIFICATE][this.fargateConfig.loadBalancer.domainName];
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
    configureServiceDiscovery(fargateService) {
        if (!this.fargateConfig.serviceDiscovery)
            return;
        const namespace = new aws_servicediscovery_1.PrivateDnsNamespace(this.mainStack, `${this.fargateConfig.serviceName}-namespace`, {
            name: this.fargateConfig.serviceDiscovery.namespace,
            vpc: this.vpc,
        });
        const service = fargateService.enableCloudMap({
            cloudMapNamespace: namespace,
            name: this.fargateConfig.serviceDiscovery.serviceName,
        });
        this.fw24.setConstructOutput(this, `${this.fargateConfig.serviceName}-discovery`, service, construct_1.OutputType.SERVICE_DISCOVERY);
    }
    /**
     * Creates an EFS file system for persistent storage.
     * Sets up security groups, mount targets, and encryption settings.
     *
     * @param serviceSecurityGroup - The security group for the Fargate service
     * @returns The created FileSystem instance or undefined if EFS is not configured
     * @private
     */
    createEfsFileSystem(serviceSecurityGroup) {
        if (!this.fargateConfig.efs) {
            return undefined;
        }
        const efsSecurityGroup = new aws_ec2_1.SecurityGroup(this.mainStack, `${this.fargateConfig.serviceName}-efs-sg`, {
            vpc: this.vpc,
            allowAllOutbound: true,
            description: `Security group for ${this.fargateConfig.serviceName} EFS`,
        });
        efsSecurityGroup.addIngressRule(aws_ec2_1.Peer.securityGroupId(serviceSecurityGroup.securityGroupId), aws_ec2_1.Port.tcp(2049), 'Allow NFS access from Fargate service');
        const fileSystem = new aws_efs_1.FileSystem(this.mainStack, `${this.fargateConfig.serviceName}-efs`, {
            vpc: this.vpc,
            vpcSubnets: { subnetType: aws_ec2_1.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroup: efsSecurityGroup,
            encrypted: true,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            fileSystemName: this.fargateConfig.efs.name || `${this.fargateConfig.serviceName}-efs`,
            ...this.fargateConfig.efs.fileSystemProps,
        });
        this.fw24.setConstructOutput(this, 'efs', fileSystem, construct_1.OutputType.EFS);
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
    createEfsAccessPoint(fileSystem) {
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
        const accessPoint = new aws_efs_1.AccessPoint(this.mainStack, `${this.fargateConfig.serviceName}-ap`, {
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
        this.fw24.setConstructOutput(this, 'efs-ap', accessPoint, construct_1.OutputType.EFS);
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
    configureEfsVolume(fileSystem, accessPoint) {
        if (!this.fargateConfig.efs) {
            return;
        }
        const efsConfig = this.fargateConfig.efs;
        const accessPointId = accessPoint.accessPointId;
        // Add EFS volume to task definition
        const volume = {
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
    configureRootVolume(taskDefinition) {
        const rootVolumeConfig = this.fargateConfig.rootVolume;
        if (rootVolumeConfig?.sizeGiB) {
            taskDefinition.addVolume({
                name: 'root',
                dockerVolumeConfiguration: {
                    scope: aws_ecs_1.Scope.SHARED,
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
exports.FargateConstruct = FargateConstruct;
__decorate([
    (0, logging_1.LogDuration)()
], FargateConstruct.prototype, "construct", null);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmFyZ2F0ZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9jb25zdHJ1Y3RzL2ZhcmdhdGUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsNkNBQTZEO0FBQzdELG1EQUFxRDtBQUNyRCxpREFTNkI7QUFDN0IsaURBZ0I2QjtBQUM3Qix1RkFHZ0Q7QUFLaEQsMkVBRTBDO0FBQzFDLCtEQUFxRjtBQUNyRixpREFBaUk7QUFDakksaURBQTZGO0FBQzdGLDJDQUE2QjtBQUc3QiwyQ0FBd0M7QUFDeEMsdUNBQW9DO0FBQ3BDLHVEQUF5RjtBQUV6Rix3Q0FBdUQ7QUFDdkQsK0NBQXFEO0FBQ3JELCtCQUFxQztBQUNyQywrREFBc0Q7QUE0WnRELE1BQWEsZ0JBQWdCO0lBb0JMO0lBbkJYLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDN0MsSUFBSSxHQUFTLFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUV6QyxJQUFJLEdBQVcsZ0JBQWdCLENBQUMsSUFBSSxDQUFDO0lBQ3JDLFlBQVksR0FBYSxDQUFDLGtCQUFZLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDN0MsTUFBTSxDQUF1QjtJQUU3QixTQUFTLENBQVM7SUFDVixjQUFjLENBQXlCO0lBQ3ZDLFNBQVMsQ0FBdUI7SUFDaEMsT0FBTyxDQUFZO0lBQ25CLEdBQUcsQ0FBUTtJQUVuQjs7Ozs7T0FLRztJQUNILFlBQW9CLGFBQXNDO1FBQXRDLGtCQUFhLEdBQWIsYUFBYSxDQUF5QjtRQUN0RCxlQUFNLENBQUMsYUFBYSxDQUFDLGFBQWEsRUFBRSxTQUFTLENBQUMsQ0FBQztRQUUvQyxvREFBb0Q7UUFDcEQsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDbkMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxZQUFZLEdB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Z0JBQ1oseUJBQXlCLEVBQUU7b0JBQ3ZCLEtBQUssRUFBRSxlQUFLLENBQUMsTUFBTTtvQkFDbkIsYUFBYSxFQUFFLElBQUk7b0JBQ25CLE1BQU0sRUFBRSxPQUFPO29CQUNmLFVBQVUsRUFBRTt3QkFDUixNQUFNLEVBQUUsS0FBSzt3QkFDYixNQUFNLEVBQUUsZ0JBQWdCLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRTtxQkFDOUM7aUJBQ0o7YUFDSixDQUFDLENBQUM7UUFDUCxDQUFDO0lBQ0wsQ0FBQztDQUNKO0FBbnBCRCw0Q0FtcEJDO0FBMWVnQjtJQURaLElBQUEscUJBQVcsR0FBRTtpREFnSGIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBEdXJhdGlvbiwgUmVtb3ZhbFBvbGljeSwgU3RhY2sgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IFJldGVudGlvbkRheXMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxvZ3NcIjtcbmltcG9ydCB7IFxuICAgIFZwYyxcbiAgICBTZWN1cml0eUdyb3VwLFxuICAgIFNlY3VyaXR5R3JvdXBQcm9wcyxcbiAgICBQb3J0LFxuICAgIFN1Ym5ldFR5cGUsXG4gICAgSVNlY3VyaXR5R3JvdXAsXG4gICAgUGVlcixcbiAgICBJVnBjXG59IGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0IHtcbiAgICBDbHVzdGVyLFxuICAgIENvbnRhaW5lckltYWdlLFxuICAgIEZhcmdhdGVTZXJ2aWNlLFxuICAgIEZhcmdhdGVUYXNrRGVmaW5pdGlvbixcbiAgICBQcm90b2NvbCxcbiAgICBBd3NMb2dEcml2ZXIsXG4gICAgSUNsdXN0ZXIsXG4gICAgVm9sdW1lLFxuICAgIEVmc1ZvbHVtZUNvbmZpZ3VyYXRpb24sXG4gICAgQ29udGFpbmVyRGVmaW5pdGlvbixcbiAgICBTY29wZSxcbiAgICBGYXJnYXRlU2VydmljZVByb3BzLFxuICAgIEZhcmdhdGVUYXNrRGVmaW5pdGlvblByb3BzLFxuICAgIENvbnRhaW5lckRlZmluaXRpb25PcHRpb25zLFxuICAgIENvbnRhaW5lckluc2lnaHRzXG59IGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3MnO1xuaW1wb3J0IHtcbiAgICBBcHBsaWNhdGlvbkxvYWRCYWxhbmNlcixcbiAgICBBcHBsaWNhdGlvblByb3RvY29sXG59IGZyb20gJ2F3cy1jZGstbGliL2F3cy1lbGFzdGljbG9hZGJhbGFuY2luZ3YyJztcbmltcG9ydCB7XG4gICAgQ2VydGlmaWNhdGUsXG4gICAgSUNlcnRpZmljYXRlXG59IGZyb20gJ2F3cy1jZGstbGliL2F3cy1jZXJ0aWZpY2F0ZW1hbmFnZXInO1xuaW1wb3J0IHtcbiAgICBQcml2YXRlRG5zTmFtZXNwYWNlXG59IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZXJ2aWNlZGlzY292ZXJ5JztcbmltcG9ydCB7IERvY2tlckltYWdlQXNzZXQsIERvY2tlckltYWdlQXNzZXRQcm9wcyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZWNyLWFzc2V0c1wiO1xuaW1wb3J0IHsgRmlsZVN5c3RlbSwgQWNjZXNzUG9pbnQsIExpZmVjeWNsZVBvbGljeSwgUGVyZm9ybWFuY2VNb2RlLCBUaHJvdWdocHV0TW9kZSwgRmlsZVN5c3RlbVByb3BzIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWVmcyc7XG5pbXBvcnQgeyBQb2xpY3lTdGF0ZW1lbnQsIE1hbmFnZWRQb2xpY3ksIFJvbGUsIFNlcnZpY2VQcmluY2lwYWwgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBDZm5Nb3VudFRhcmdldCB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1lZnMnO1xuXG5pbXBvcnQgeyBIZWxwZXIgfSBmcm9tIFwiLi4vY29yZS9oZWxwZXJcIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQgeyBGVzI0Q29uc3RydWN0LCBGVzI0Q29uc3RydWN0T3V0cHV0LCBPdXRwdXRUeXBlIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvY29uc3RydWN0XCI7XG5pbXBvcnQgeyBJQ29uc3RydWN0Q29uZmlnIH0gZnJvbSBcIi4uL2ludGVyZmFjZXMvY29uc3RydWN0LWNvbmZpZ1wiO1xuaW1wb3J0IHsgTG9nRHVyYXRpb24sIGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBDZXJ0aWZpY2F0ZUNvbnN0cnVjdCB9IGZyb20gXCIuL2NlcnRpZmljYXRlXCI7XG5pbXBvcnQgeyBWcGNDb25zdHJ1Y3QgfSBmcm9tIFwiLi92cGNcIjtcbmltcG9ydCB7IFBsYXRmb3JtIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1lY3ItYXNzZXRzXCI7XG5cbi8qKlxuICogRXhhbXBsZXMgb2YgdXNpbmcgdGhlIEZhcmdhdGUgQ29uc3RydWN0XG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBFeGFtcGxlIDE6IEJhc2ljIEZhcmdhdGUgc2VydmljZSB3aXRoIEFMQiBhbmQgY3VzdG9tIHJvbGVzXG4gKiBjb25zdCBmYXJnYXRlU2VydmljZSA9IG5ldyBGYXJnYXRlQ29uc3RydWN0KHtcbiAqICAgc2VydmljZU5hbWU6ICdteS1hcGknLFxuICogICB2cGNOYW1lOiAnbWFpbi12cGMnLFxuICogICBjb250YWluZXI6IHtcbiAqICAgICBkb2NrZXJGaWxlUGF0aDogJy4vc3JjL2FwaS9Eb2NrZXJmaWxlJyxcbiAqICAgICBjb250YWluZXJQb3J0OiAzMDAwLFxuICogICAgIGNvbnRhaW5lclByb3BzOiB7XG4gKiAgICAgICBlbnZpcm9ubWVudDoge1xuICogICAgICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxuICogICAgICAgICBBUElfVkVSU0lPTjogJ3YxJ1xuICogICAgICAgfSxcbiAqICAgICAgIGhlYWx0aENoZWNrOiB7XG4gKiAgICAgICAgIGNvbW1hbmQ6IFsnQ01ELVNIRUxMJywgJ2N1cmwgLWYgaHR0cDovL2xvY2FsaG9zdDozMDAwL2hlYWx0aCB8fCBleGl0IDEnXSxcbiAqICAgICAgICAgaW50ZXJ2YWw6IER1cmF0aW9uLnNlY29uZHMoMzApLFxuICogICAgICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDUpLFxuICogICAgICAgICByZXRyaWVzOiAzXG4gKiAgICAgICB9XG4gKiAgICAgfVxuICogICB9LFxuICogICBsb2FkQmFsYW5jZXI6IHtcbiAqICAgICBkb21haW5OYW1lOiAnYXBpLmV4YW1wbGUuY29tJyxcbiAqICAgICBjZXJ0aWZpY2F0ZUFybjogJ2Fybjphd3M6YWNtOnJlZ2lvbjphY2NvdW50OmNlcnRpZmljYXRlL2NlcnRpZmljYXRlLWlkJ1xuICogICB9LFxuICogICB0YXNrUm9sZToge1xuICogICAgIHJvbGVOYW1lOiAnbXktYXBpLXRhc2stcm9sZScsXG4gKiAgICAgbWFuYWdlZFBvbGljeUFybnM6IFtcbiAqICAgICAgICdhcm46YXdzOmlhbTo6YXdzOnBvbGljeS9BV1NYUmF5RGFlbW9uV3JpdGVBY2Nlc3MnLFxuICogICAgICAgJ2Fybjphd3M6aWFtOjphd3M6cG9saWN5L0FXU0FwcE1lc2hFbnZveUFjY2VzcydcbiAqICAgICBdLFxuICogICAgIGlubGluZVBvbGljaWVzOiBbXG4gKiAgICAgICBuZXcgUG9saWN5U3RhdGVtZW50KHtcbiAqICAgICAgICAgYWN0aW9uczogWydzMzpHZXRPYmplY3QnLCAnczM6UHV0T2JqZWN0J10sXG4gKiAgICAgICAgIHJlc291cmNlczogWydhcm46YXdzOnMzOjo6bXktYnVja2V0LyonXVxuICogICAgICAgfSlcbiAqICAgICBdXG4gKiAgIH0sXG4gKiAgIGV4ZWN1dGlvblJvbGU6IHtcbiAqICAgICBtYW5hZ2VkUG9saWN5QXJuczogW1xuICogICAgICAgJ2Fybjphd3M6aWFtOjphd3M6cG9saWN5L3NlcnZpY2Utcm9sZS9BbWF6b25FQ1NUYXNrRXhlY3V0aW9uUm9sZVBvbGljeScsXG4gKiAgICAgICAnYXJuOmF3czppYW06OmF3czpwb2xpY3kvQ2xvdWRXYXRjaExvZ3NGdWxsQWNjZXNzJ1xuICogICAgIF0sXG4gKiAgICAgaW5saW5lUG9saWNpZXM6IFtcbiAqICAgICAgIG5ldyBQb2xpY3lTdGF0ZW1lbnQoe1xuICogICAgICAgICBhY3Rpb25zOiBbJ3NlY3JldHNtYW5hZ2VyOkdldFNlY3JldFZhbHVlJ10sXG4gKiAgICAgICAgIHJlc291cmNlczogWydhcm46YXdzOnNlY3JldHNtYW5hZ2VyOnJlZ2lvbjphY2NvdW50OnNlY3JldDpteS1zZWNyZXQtKiddXG4gKiAgICAgICB9KVxuICogICAgIF1cbiAqICAgfSxcbiAqICAgdGFza0RlZmluaXRpb25Qcm9wczoge1xuICogICAgIGNwdTogNTEyLFxuICogICAgIG1lbW9yeUxpbWl0TWlCOiAxMDI0LFxuICogICB9LFxuICogICBzZXJ2aWNlUHJvcHM6IHtcbiAqICAgICBkZXNpcmVkQ291bnQ6IDIsXG4gKiAgICAgbWluSGVhbHRoeVBlcmNlbnQ6IDUwLFxuICogICAgIG1heEhlYWx0aHlQZXJjZW50OiAyMDAsXG4gKiAgICAgbWluQ2FwYWNpdHk6IDIsXG4gKiAgICAgbWF4Q2FwYWNpdHk6IDEwLFxuICogICAgIHRhcmdldENwdVV0aWxpemF0aW9uOiA3MCxcbiAqICAgICBjaXJjdWl0QnJlYWtlcjogeyByb2xsYmFjazogdHJ1ZSB9XG4gKiAgIH1cbiAqIH0pO1xuICogXG4gKiAvLyBFeGFtcGxlIDI6IEludGVybmFsIHNlcnZpY2Ugd2l0aCBzZXJ2aWNlIGRpc2NvdmVyeSBhbmQgRUZTXG4gKiBjb25zdCBpbnRlcm5hbFNlcnZpY2UgPSBuZXcgRmFyZ2F0ZUNvbnN0cnVjdCh7XG4gKiAgIHNlcnZpY2VOYW1lOiAnaW50ZXJuYWwtc2VydmljZScsXG4gKiAgIHZwY05hbWU6ICdtYWluLXZwYycsXG4gKiAgIGNvbnRhaW5lcjoge1xuICogICAgIGRvY2tlckZpbGVQYXRoOiAnLi9zcmMvaW50ZXJuYWwvRG9ja2VyZmlsZScsXG4gKiAgICAgY29udGFpbmVyUG9ydDogODA4MCxcbiAqICAgICBjb250YWluZXJQcm9wczoge1xuICogICAgICAgaGVhbHRoQ2hlY2s6IHtcbiAqICAgICAgICAgY29tbWFuZDogWydDTUQtU0hFTEwnLCAnY3VybCAtZiBodHRwOi8vbG9jYWxob3N0OjgwODAvaGVhbHRoIHx8IGV4aXQgMSddLFxuICogICAgICAgICBpbnRlcnZhbDogRHVyYXRpb24uc2Vjb25kcygzMCksXG4gKiAgICAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHMoNSksXG4gKiAgICAgICAgIHJldHJpZXM6IDNcbiAqICAgICAgIH0sXG4gKiAgICAgICBsb2dnaW5nOiBuZXcgQXdzTG9nRHJpdmVyKHtcbiAqICAgICAgICAgc3RyZWFtUHJlZml4OiAnaW50ZXJuYWwtc2VydmljZScsXG4gKiAgICAgICAgIGxvZ1JldGVudGlvbjogUmV0ZW50aW9uRGF5cy5UV09fV0VFS1NcbiAqICAgICAgIH0pXG4gKiAgICAgfVxuICogICB9LFxuICogICBzZXJ2aWNlRGlzY292ZXJ5OiB7XG4gKiAgICAgbmFtZXNwYWNlOiAnaW50ZXJuYWwubG9jYWwnLFxuICogICAgIHNlcnZpY2VOYW1lOiAnYmFja2VuZCdcbiAqICAgfSxcbiAqICAgZWZzOiB7XG4gKiAgICAgbmFtZTogJ3NoYXJlZC1zdG9yYWdlJyxcbiAqICAgICBjb250YWluZXJQYXRoOiAnL2RhdGEnLFxuICogICAgIHJvb3REaXJlY3Rvcnk6ICcvc2hhcmVkJyxcbiAqICAgICBwZXJmb3JtYW5jZU1vZGU6IFBlcmZvcm1hbmNlTW9kZS5HRU5FUkFMX1BVUlBPU0UsXG4gKiAgICAgdGhyb3VnaHB1dE1vZGU6IFRocm91Z2hwdXRNb2RlLkJVUlNUSU5HLFxuICogICAgIGVuY3J5cHRlZDogdHJ1ZSxcbiAqICAgICBlbmFibGVBdXRvbWF0aWNCYWNrdXBzOiB0cnVlXG4gKiAgIH0sXG4gKiAgIHJvb3RWb2x1bWU6IHtcbiAqICAgICBzaXplR2lCOiAzMFxuICogICB9LFxuICogICB0YXNrRGVmaW5pdGlvblByb3BzOiB7XG4gKiAgICAgZXBoZW1lcmFsU3RvcmFnZUdpQjogNTAsXG4gKiAgICAgY3B1OiAnMTAyNCcsXG4gKiAgICAgbWVtb3J5TGltaXRNaUI6ICcyMDQ4J1xuICogICB9XG4gKiB9KTtcbiAqIFxuICogLy8gRXhhbXBsZSAzOiBVc2luZyBleGlzdGluZyBjbHVzdGVyIGFuZCBzZWN1cml0eSBncm91cCB3aXRoIEVGU1xuICogY29uc3Qgc2VydmljZUluRXhpc3RpbmdDbHVzdGVyID0gbmV3IEZhcmdhdGVDb25zdHJ1Y3Qoe1xuICogICBzZXJ2aWNlTmFtZTogJ3dvcmtlcicsXG4gKiAgIHZwY05hbWU6ICdtYWluLXZwYycsXG4gKiAgIGNsdXN0ZXI6IHtcbiAqICAgICBuYW1lOiAnZXhpc3RpbmctY2x1c3RlcidcbiAqICAgfSxcbiAqICAgc2VjdXJpdHlHcm91cDoge1xuICogICAgIHNlY3VyaXR5R3JvdXBJZDogJ3NnLWV4aXN0aW5nJ1xuICogICB9LFxuICogICBjb250YWluZXI6IHtcbiAqICAgICBkb2NrZXJGaWxlUGF0aDogJy4vc3JjL3dvcmtlci9Eb2NrZXJmaWxlJyxcbiAqICAgICBjb250YWluZXJQb3J0OiA5MDAwLFxuICogICAgIGNvbnRhaW5lclByb3BzOiB7XG4gKiAgICAgICBlbnZpcm9ubWVudDoge1xuICogICAgICAgICBRVUVVRV9VUkw6ICdodHRwczovL3Nxcy5yZWdpb24uYW1hem9uYXdzLmNvbS9hY2NvdW50L3F1ZXVlJ1xuICogICAgICAgfSxcbiAqICAgICAgIHNlY3JldHM6IHtcbiAqICAgICAgICAgQVBJX0tFWTogU2VjcmV0LmZyb21TZWNyZXRzTWFuYWdlcihzZWNyZXQsICdhcGkta2V5JylcbiAqICAgICAgIH1cbiAqICAgICB9XG4gKiAgIH0sXG4gKiAgIGVmczoge1xuICogICAgIGNvbnRhaW5lclBhdGg6ICcvc2hhcmVkLWRhdGEnLFxuICogICAgIHBlcmZvcm1hbmNlTW9kZTogUGVyZm9ybWFuY2VNb2RlLk1BWF9JTyxcbiAqICAgICB0aHJvdWdocHV0TW9kZTogVGhyb3VnaHB1dE1vZGUuUFJPVklTSU9ORUQsXG4gKiAgICAgbGlmZWN5Y2xlUG9saWN5OiBMaWZlY3ljbGVQb2xpY3kuQUZURVJfMTRfREFZU1xuICogICB9LFxuICogICBzZXJ2aWNlUHJvcHM6IHtcbiAqICAgICBlbmFibGVFeGVjdXRlQ29tbWFuZDogdHJ1ZSxcbiAqICAgICBjYXBhY2l0eVByb3ZpZGVyU3RyYXRlZ2llczogW3tcbiAqICAgICAgIGNhcGFjaXR5UHJvdmlkZXI6ICdGQVJHQVRFX1NQT1QnLFxuICogICAgICAgd2VpZ2h0OiAxXG4gKiAgICAgfV1cbiAqICAgfVxuICogfSk7XG4gKiBcbiAqIC8vIEFkZCB0byB5b3VyIGFwcGxpY2F0aW9uXG4gKiBjb25zdCBhcHAgPSBuZXcgQXBwbGljYXRpb24oKVxuICogICAudXNlKGZhcmdhdGVTZXJ2aWNlKVxuICogICAudXNlKGludGVybmFsU2VydmljZSlcbiAqICAgLnVzZShzZXJ2aWNlSW5FeGlzdGluZ0NsdXN0ZXIpXG4gKiAgIC5ydW4oKTtcbiAqIGBgYFxuICovXG5cbi8qKlxuICogRXh0ZW5kZWQgRmFyZ2F0ZVNlcnZpY2UgcHJvcGVydGllcyB0aGF0IGluY2x1ZGUgYXV0by1zY2FsaW5nIGNvbmZpZ3VyYXRpb25cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBFeHRlbmRlZEZhcmdhdGVTZXJ2aWNlUHJvcHMgZXh0ZW5kcyBGYXJnYXRlU2VydmljZVByb3BzIHtcbiAgICAvKipcbiAgICAgKiBNaW5pbXVtIGNhcGFjaXR5IGZvciBhdXRvLXNjYWxpbmdcbiAgICAgKi9cbiAgICBtaW5DYXBhY2l0eT86IG51bWJlcjtcbiAgICAvKipcbiAgICAgKiBNYXhpbXVtIGNhcGFjaXR5IGZvciBhdXRvLXNjYWxpbmdcbiAgICAgKi9cbiAgICBtYXhDYXBhY2l0eT86IG51bWJlcjtcbiAgICAvKipcbiAgICAgKiBUYXJnZXQgQ1BVIHV0aWxpemF0aW9uIHBlcmNlbnRhZ2UgZm9yIGF1dG8tc2NhbGluZ1xuICAgICAqL1xuICAgIHRhcmdldENwdVV0aWxpemF0aW9uPzogbnVtYmVyO1xuICAgIC8qKlxuICAgICAqIFRhcmdldCBtZW1vcnkgdXRpbGl6YXRpb24gcGVyY2VudGFnZSBmb3IgYXV0by1zY2FsaW5nXG4gICAgICovXG4gICAgdGFyZ2V0TWVtb3J5VXRpbGl6YXRpb24/OiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSUZhcmdhdGVDb250YWluZXJDb25maWcge1xuICAgIC8qKlxuICAgICAqIFBhdGggdG8gdGhlIERvY2tlcmZpbGVcbiAgICAgKi9cbiAgICBkb2NrZXJGaWxlUGF0aDogc3RyaW5nO1xuICAgIC8qKlxuICAgICAqIENvbnRhaW5lciBwb3J0IHRvIGV4cG9zZVxuICAgICAqL1xuICAgIGNvbnRhaW5lclBvcnQ6IG51bWJlcjtcbiAgICAvKipcbiAgICAgKiBDb250YWluZXIgZGVmaW5pdGlvbiBvcHRpb25zIGZyb20gQ0RLXG4gICAgICovXG4gICAgY29udGFpbmVyUHJvcHM/OiBDb250YWluZXJEZWZpbml0aW9uT3B0aW9ucztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBJRmFyZ2F0ZVNlcnZpY2VEaXNjb3ZlcnlDb25maWcge1xuICAgIC8qKlxuICAgICAqIE5hbWUgZm9yIHRoZSBzZXJ2aWNlIGluIHNlcnZpY2UgZGlzY292ZXJ5XG4gICAgICovXG4gICAgc2VydmljZU5hbWU6IHN0cmluZztcbiAgICAvKipcbiAgICAgKiBOYW1lc3BhY2UgZm9yIHNlcnZpY2UgZGlzY292ZXJ5XG4gICAgICovXG4gICAgbmFtZXNwYWNlOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSUZhcmdhdGVMb2FkQmFsYW5jZXJDb25maWcge1xuICAgIC8qKlxuICAgICAqIERvbWFpbiBuYW1lIGZvciB0aGUgQUxCXG4gICAgICovXG4gICAgZG9tYWluTmFtZT86IHN0cmluZztcbiAgICAvKipcbiAgICAgKiBDZXJ0aWZpY2F0ZSBBUk4gZm9yIEhUVFBTXG4gICAgICovXG4gICAgY2VydGlmaWNhdGVBcm4/OiBzdHJpbmc7XG4gICAgLyoqXG4gICAgICogUGF0aCBwYXR0ZXJucyB0byByb3V0ZSB0byB0aGlzIHNlcnZpY2VcbiAgICAgKi9cbiAgICBwYXRoUGF0dGVybnM/OiBzdHJpbmdbXTtcbiAgICAvKipcbiAgICAgKiBIb3N0IGhlYWRlcnMgdG8gcm91dGUgdG8gdGhpcyBzZXJ2aWNlXG4gICAgICovXG4gICAgaG9zdEhlYWRlcnM/OiBzdHJpbmdbXTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBJRmFyZ2F0ZVNlY3VyaXR5R3JvdXBDb25maWcge1xuICAgIC8qKlxuICAgICAqIElEIG9mIGFuIGV4aXN0aW5nIHNlY3VyaXR5IGdyb3VwIHRvIHVzZVxuICAgICAqL1xuICAgIHNlY3VyaXR5R3JvdXBJZD86IHN0cmluZztcbiAgICAvKipcbiAgICAgKiBQcm9wZXJ0aWVzIGZvciBjcmVhdGluZyBhIG5ldyBzZWN1cml0eSBncm91cFxuICAgICAqL1xuICAgIHByb3BzPzogU2VjdXJpdHlHcm91cFByb3BzO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIElDbHVzdGVyQ29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBOYW1lIG9mIHRoZSBjbHVzdGVyXG4gICAgICovXG4gICAgbmFtZTogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIElGYXJnYXRlRWZzQ29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBOYW1lIG9mIHRoZSBFRlMgZmlsZSBzeXN0ZW1cbiAgICAgKi9cbiAgICBuYW1lPzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogQ29udGFpbmVyIHBhdGggd2hlcmUgRUZTIHdpbGwgYmUgbW91bnRlZFxuICAgICAqL1xuICAgIGNvbnRhaW5lclBhdGg6IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIEVGUyByb290IGRpcmVjdG9yeSB0byBtb3VudFxuICAgICAqIEBkZWZhdWx0IFwiL1wiXG4gICAgICovXG4gICAgcm9vdERpcmVjdG9yeT86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIEFkZGl0aW9uYWwgcHJvcGVydGllcyBmb3IgdGhlIEVGUyBmaWxlIHN5c3RlbVxuICAgICAqIFRoZXNlIHByb3BlcnRpZXMgd2lsbCBiZSBtZXJnZWQgd2l0aCBvdXIgZGVmYXVsdCBjb25maWd1cmF0aW9uXG4gICAgICogQHNlZSBhd3MtY2RrLWxpYi9hd3MtZWZzL0ZpbGVTeXN0ZW1Qcm9wc1xuICAgICAqL1xuICAgIGZpbGVTeXN0ZW1Qcm9wcz86IFBhcnRpYWw8RmlsZVN5c3RlbVByb3BzPjtcblxuICAgIC8qKlxuICAgICAqIEFjY2VzcyBwb2ludCBjb25maWd1cmF0aW9uIGZvciB0aGUgRUZTIGZpbGUgc3lzdGVtXG4gICAgICovXG4gICAgYWNjZXNzUG9pbnRQcm9wcz86IHtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRoZSBQT1NJWCB1c2VyIGFuZCBncm91cCBhcHBsaWVkIHRvIGFsbCBmaWxlIHN5c3RlbSByZXF1ZXN0c1xuICAgICAgICAgKi9cbiAgICAgICAgcG9zaXhVc2VyPzoge1xuICAgICAgICAgICAgdWlkOiBzdHJpbmc7XG4gICAgICAgICAgICBnaWQ6IHN0cmluZztcbiAgICAgICAgfTtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIENyZWF0aW9uIGluZm8gZm9yIHRoZSBhY2Nlc3MgcG9pbnRcbiAgICAgICAgICovXG4gICAgICAgIGNyZWF0ZUFjbD86IHtcbiAgICAgICAgICAgIG93bmVyVWlkOiBzdHJpbmc7XG4gICAgICAgICAgICBvd25lckdpZDogc3RyaW5nO1xuICAgICAgICAgICAgcGVybWlzc2lvbnM6IHN0cmluZztcbiAgICAgICAgfTtcbiAgICB9O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIElGYXJnYXRlUm9vdFZvbHVtZUNvbmZpZyB7XG4gICAgLyoqXG4gICAgICogU2l6ZSBvZiB0aGUgcm9vdCB2b2x1bWUgaW4gR2lCXG4gICAgICogQGRlZmF1bHQgMjBcbiAgICAgKi9cbiAgICBzaXplR2lCPzogbnVtYmVyO1xufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIElBTSByb2xlIHBvbGljaWVzXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSUZhcmdhdGVSb2xlUG9saWN5Q29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBMaXN0IG9mIG1hbmFnZWQgcG9saWN5IEFSTnMgdG8gYXR0YWNoIHRvIHRoZSByb2xlXG4gICAgICovXG4gICAgbWFuYWdlZFBvbGljeUFybnM/OiBzdHJpbmdbXTtcblxuICAgIC8qKlxuICAgICAqIExpc3Qgb2YgbWFuYWdlZCBwb2xpY2llcyB0byBhdHRhY2ggdG8gdGhlIHJvbGVcbiAgICAgKi9cbiAgICBtYW5hZ2VkUG9saWNpZXM/OiBNYW5hZ2VkUG9saWN5W107XG5cbiAgICAvKipcbiAgICAgKiBMaXN0IG9mIGlubGluZSBwb2xpY3kgc3RhdGVtZW50cyB0byBhZGQgdG8gdGhlIHJvbGVcbiAgICAgKi9cbiAgICBpbmxpbmVQb2xpY2llcz86IFBvbGljeVN0YXRlbWVudFtdO1xufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIHRhc2sgcm9sZXNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJRmFyZ2F0ZVRhc2tSb2xlQ29uZmlnIGV4dGVuZHMgSUZhcmdhdGVSb2xlUG9saWN5Q29uZmlnIHtcbiAgICAvKipcbiAgICAgKiBDdXN0b20gcm9sZSBuYW1lXG4gICAgICovXG4gICAgcm9sZU5hbWU/OiBzdHJpbmc7XG59XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBmb3IgdGhlIEZhcmdhdGUgc2VydmljZSBjb25zdHJ1Y3RcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJRmFyZ2F0ZUNvbnN0cnVjdENvbmZpZyBleHRlbmRzIElDb25zdHJ1Y3RDb25maWcge1xuICAgIC8qKlxuICAgICAqIE5hbWUgb2YgdGhlIHNlcnZpY2VcbiAgICAgKi9cbiAgICBzZXJ2aWNlTmFtZTogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogQ29udGFpbmVyIGNvbmZpZ3VyYXRpb25cbiAgICAgKi9cbiAgICBjb250YWluZXI6IElGYXJnYXRlQ29udGFpbmVyQ29uZmlnO1xuXG4gICAgLyoqXG4gICAgICogQ2x1c3RlciBjb25maWd1cmF0aW9uXG4gICAgICovXG4gICAgY2x1c3Rlcj86IElDbHVzdGVyQ29uZmlnO1xuXG4gICAgLyoqXG4gICAgICogVlBDIE5hbWUgdG8gdXNlIChtdXN0IGV4aXN0KVxuICAgICAqIEBleGFtcGxlICdtYWluLXZwYydcbiAgICAgKi9cbiAgICB2cGNOYW1lPzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogVlBDXG4gICAgICovXG4gICAgdnBjPzogVnBjO1xuXG4gICAgLyoqXG4gICAgICogU2VjdXJpdHkgZ3JvdXAgY29uZmlndXJhdGlvblxuICAgICAqL1xuICAgIHNlY3VyaXR5R3JvdXA/OiBJRmFyZ2F0ZVNlY3VyaXR5R3JvdXBDb25maWc7XG5cbiAgICAvKipcbiAgICAgKiBMb2FkIGJhbGFuY2VyIGNvbmZpZ3VyYXRpb24gKGlmIHVzaW5nIEFMQilcbiAgICAgKi9cbiAgICBsb2FkQmFsYW5jZXI/OiBJRmFyZ2F0ZUxvYWRCYWxhbmNlckNvbmZpZztcblxuICAgIC8qKlxuICAgICAqIFNlcnZpY2UgZGlzY292ZXJ5IGNvbmZpZ3VyYXRpb24gKGlmIG5vdCB1c2luZyBBTEIpXG4gICAgICovXG4gICAgc2VydmljZURpc2NvdmVyeT86IElGYXJnYXRlU2VydmljZURpc2NvdmVyeUNvbmZpZztcblxuICAgIC8qKlxuICAgICAqIEVGUyBjb25maWd1cmF0aW9uXG4gICAgICovXG4gICAgZWZzPzogSUZhcmdhdGVFZnNDb25maWc7XG5cbiAgICAvKipcbiAgICAgKiBSb290IHZvbHVtZSBjb25maWd1cmF0aW9uXG4gICAgICovXG4gICAgcm9vdFZvbHVtZT86IElGYXJnYXRlUm9vdFZvbHVtZUNvbmZpZztcblxuICAgIC8qKlxuICAgICAqIFRhc2sgcm9sZSBjb25maWd1cmF0aW9uXG4gICAgICovXG4gICAgdGFza1JvbGU/OiBJRmFyZ2F0ZVRhc2tSb2xlQ29uZmlnO1xuXG4gICAgLyoqXG4gICAgICogRXhlY3V0aW9uIHJvbGUgY29uZmlndXJhdGlvblxuICAgICAqL1xuICAgIGV4ZWN1dGlvblJvbGU/OiBJRmFyZ2F0ZVJvbGVQb2xpY3lDb25maWc7XG5cbiAgICAvKipcbiAgICAgKiBDREsgRmFyZ2F0ZVNlcnZpY2UgY29uc3RydWN0IHByb3BlcnRpZXMgd2l0aCBhZGRpdGlvbmFsIGF1dG8tc2NhbGluZyBvcHRpb25zXG4gICAgICogVGhlc2UgcHJvcGVydGllcyB3aWxsIGJlIG1lcmdlZCB3aXRoIG91ciBkZWZhdWx0IGNvbmZpZ3VyYXRpb25cbiAgICAgKi9cbiAgICBzZXJ2aWNlUHJvcHM/OiBQYXJ0aWFsPEV4dGVuZGVkRmFyZ2F0ZVNlcnZpY2VQcm9wcz47XG5cbiAgICAvKipcbiAgICAgKiBDREsgRmFyZ2F0ZVRhc2tEZWZpbml0aW9uIGNvbnN0cnVjdCBwcm9wZXJ0aWVzXG4gICAgICogVGhlc2UgcHJvcGVydGllcyB3aWxsIGJlIG1lcmdlZCB3aXRoIG91ciBkZWZhdWx0IGNvbmZpZ3VyYXRpb25cbiAgICAgKi9cbiAgICB0YXNrRGVmaW5pdGlvblByb3BzPzogUGFydGlhbDxGYXJnYXRlVGFza0RlZmluaXRpb25Qcm9wcz47XG5cbiAgICAvKipcbiAgICAgKiBEb2NrZXIgaW1hZ2UgcHJvcGVydGllc1xuICAgICAqL1xuICAgIGRvY2tlckltYWdlUHJvcHM/OiBQYXJ0aWFsPERvY2tlckltYWdlQXNzZXRQcm9wcz47XG59XG5cbmV4cG9ydCBjbGFzcyBGYXJnYXRlQ29uc3RydWN0IGltcGxlbWVudHMgRlcyNENvbnN0cnVjdCB7XG4gICAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKEZhcmdhdGVDb25zdHJ1Y3QubmFtZSk7XG4gICAgcmVhZG9ubHkgZncyNDogRncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcbiAgICBcbiAgICBuYW1lOiBzdHJpbmcgPSBGYXJnYXRlQ29uc3RydWN0Lm5hbWU7XG4gICAgZGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFtWcGNDb25zdHJ1Y3QubmFtZV07XG4gICAgb3V0cHV0ITogRlcyNENvbnN0cnVjdE91dHB1dDtcblxuICAgIG1haW5TdGFjayE6IFN0YWNrO1xuICAgIHByaXZhdGUgdGFza0RlZmluaXRpb24hOiBGYXJnYXRlVGFza0RlZmluaXRpb247XG4gICAgcHJpdmF0ZSBjb250YWluZXIhOiBDb250YWluZXJEZWZpbml0aW9uO1xuICAgIHByaXZhdGUgY2x1c3RlciE6IElDbHVzdGVyO1xuICAgIHByaXZhdGUgdnBjITogSVZwYztcblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYSBuZXcgRmFyZ2F0ZSBjb25zdHJ1Y3Qgd2l0aCB0aGUgc3BlY2lmaWVkIGNvbmZpZ3VyYXRpb24uXG4gICAgICogSW5pdGlhbGl6ZXMgZGVmYXVsdCB2YWx1ZXMgYW5kIG1lcmdlcyB1c2VyLXByb3ZpZGVkIGNvbmZpZ3VyYXRpb24uXG4gICAgICogXG4gICAgICogQHBhcmFtIGZhcmdhdGVDb25maWcgLSBUaGUgY29uZmlndXJhdGlvbiBvYmplY3QgZm9yIHRoZSBGYXJnYXRlIHNlcnZpY2VcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3Rvcihwcml2YXRlIGZhcmdhdGVDb25maWc6IElGYXJnYXRlQ29uc3RydWN0Q29uZmlnKSB7XG4gICAgICAgIEhlbHBlci5oeWRyYXRlQ29uZmlnKGZhcmdhdGVDb25maWcsICdGQVJHQVRFJyk7XG5cbiAgICAgICAgLy8gU2V0IGRlZmF1bHQgc2VydmljZSBjb25maWd1cmF0aW9uIGlmIG5vdCBwcm92aWRlZFxuICAgICAgICBpZiAoIXRoaXMuZmFyZ2F0ZUNvbmZpZy5zZXJ2aWNlUHJvcHMpIHtcbiAgICAgICAgICAgIHRoaXMuZmFyZ2F0ZUNvbmZpZy5zZXJ2aWNlUHJvcHMgPSB7fTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENyZWF0ZSBkZWZhdWx0IHNlcnZpY2UgY29uZmlndXJhdGlvblxuICAgICAgICBjb25zdCBkZWZhdWx0U2VydmljZVByb3BzID0ge1xuICAgICAgICAgICAgY2lyY3VpdEJyZWFrZXI6IHtcbiAgICAgICAgICAgICAgICByb2xsYmFjazogdHJ1ZVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGRlcGxveW1lbnRDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICAgICAgYWxhcm1zOiB7IGFsYXJtTmFtZXM6IFtdLCBlbmFibGU6IHRydWUsIHJvbGxiYWNrOiB0cnVlIH0sXG4gICAgICAgICAgICAgICAgbWF4SGVhbHRoeVBlcmNlbnQ6IDIwMCxcbiAgICAgICAgICAgICAgICBtaW5IZWFsdGh5UGVyY2VudDogMTAwXG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gTWVyZ2UgZGVmYXVsdCBjb25maWd1cmF0aW9uIHdpdGggdXNlci1wcm92aWRlZCBjb25maWd1cmF0aW9uXG4gICAgICAgIHRoaXMuZmFyZ2F0ZUNvbmZpZy5zZXJ2aWNlUHJvcHMgPSB7XG4gICAgICAgICAgICAuLi5kZWZhdWx0U2VydmljZVByb3BzLFxuICAgICAgICAgICAgLi4udGhpcy5mYXJnYXRlQ29uZmlnLnNlcnZpY2VQcm9wc1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYW4gSUFNIHRhc2sgcm9sZSBmb3IgdGhlIEZhcmdhdGUgc2VydmljZSB3aXRoIHNwZWNpZmllZCBwZXJtaXNzaW9ucy5cbiAgICAgKiBUaGlzIHJvbGUgZGVmaW5lcyB3aGF0IEFXUyBzZXJ2aWNlcyB0aGUgY29udGFpbmVyIGNhbiBhY2Nlc3MuXG4gICAgICogXG4gICAgICogQHJldHVybnMgVGhlIGNyZWF0ZWQgSUFNIFJvbGUgaW5zdGFuY2Ugd2l0aCBjb25maWd1cmVkIHBlcm1pc3Npb25zXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBwcml2YXRlIGNyZWF0ZVRhc2tSb2xlKCk6IFJvbGUge1xuICAgICAgICBjb25zdCByb2xlID0gbmV3IFJvbGUodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZmFyZ2F0ZUNvbmZpZy5zZXJ2aWNlTmFtZX0tdGFzay1yb2xlYCwge1xuICAgICAgICAgICAgcm9sZU5hbWU6IHRoaXMuZmFyZ2F0ZUNvbmZpZy50YXNrUm9sZT8ucm9sZU5hbWUsXG4gICAgICAgICAgICBhc3N1bWVkQnk6IG5ldyBTZXJ2aWNlUHJpbmNpcGFsKCdlY3MtdGFza3MuYW1hem9uYXdzLmNvbScpLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246IGBUYXNrIHJvbGUgZm9yICR7dGhpcy5mYXJnYXRlQ29uZmlnLnNlcnZpY2VOYW1lfSBGYXJnYXRlIHNlcnZpY2VgLFxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAodGhpcy5mYXJnYXRlQ29uZmlnLnRhc2tSb2xlKSB7XG4gICAgICAgICAgICAvLyBBdHRhY2ggbWFuYWdlZCBwb2xpY2llcyBieSBBUk5cbiAgICAgICAgICAgIHRoaXMuZmFyZ2F0ZUNvbmZpZy50YXNrUm9sZS5tYW5hZ2VkUG9saWN5QXJucz8uZm9yRWFjaCgocG9saWN5QXJuLCBpbmRleCkgPT4ge1xuICAgICAgICAgICAgICAgIHJvbGUuYWRkTWFuYWdlZFBvbGljeShNYW5hZ2VkUG9saWN5LmZyb21NYW5hZ2VkUG9saWN5QXJuKFxuICAgICAgICAgICAgICAgICAgICB0aGlzLm1haW5TdGFjayxcbiAgICAgICAgICAgICAgICAgICAgYCR7dGhpcy5mYXJnYXRlQ29uZmlnLnNlcnZpY2VOYW1lfS10YXNrLW1hbmFnZWQtcG9saWN5LSR7aW5kZXh9YCxcbiAgICAgICAgICAgICAgICAgICAgcG9saWN5QXJuXG4gICAgICAgICAgICAgICAgKSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gQXR0YWNoIG1hbmFnZWQgcG9saWNpZXNcbiAgICAgICAgICAgIHRoaXMuZmFyZ2F0ZUNvbmZpZy50YXNrUm9sZS5tYW5hZ2VkUG9saWNpZXM/LmZvckVhY2gocG9saWN5ID0+IHtcbiAgICAgICAgICAgICAgICByb2xlLmFkZE1hbmFnZWRQb2xpY3kocG9saWN5KTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBBZGQgaW5saW5lIHBvbGljaWVzXG4gICAgICAgICAgICB0aGlzLmZhcmdhdGVDb25maWcudGFza1JvbGUuaW5saW5lUG9saWNpZXM/LmZvckVhY2goc3RhdGVtZW50ID0+IHtcbiAgICAgICAgICAgICAgICByb2xlLmFkZFRvUG9saWN5KHN0YXRlbWVudCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFkZCBkZWZhdWx0IHBlcm1pc3Npb25zIGZvciBFQ1MgdGFzayByb2xlXG4gICAgICAgIHJvbGUuYWRkVG9Qb2xpY3kobmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgJ2VjcjpHZXRBdXRob3JpemF0aW9uVG9rZW4nLFxuICAgICAgICAgICAgICAgICdlY3I6QmF0Y2hDaGVja0xheWVyQXZhaWxhYmlsaXR5JyxcbiAgICAgICAgICAgICAgICAnZWNyOkdldERvd25sb2FkVXJsRm9yTGF5ZXInLFxuICAgICAgICAgICAgICAgICdlY3I6QmF0Y2hHZXRJbWFnZSdcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICByZXNvdXJjZXM6IFsnKiddXG4gICAgICAgIH0pKTtcblxuICAgICAgICAvLyBJZiBFRlMgaXMgY29uZmlndXJlZCwgYWRkIEVGUyBwZXJtaXNzaW9uc1xuICAgICAgICBpZiAodGhpcy5mYXJnYXRlQ29uZmlnLmVmcykge1xuICAgICAgICAgICAgcm9sZS5hZGRUb1BvbGljeShuZXcgUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgICAgICdlbGFzdGljZmlsZXN5c3RlbTpDbGllbnRNb3VudCcsXG4gICAgICAgICAgICAgICAgICAgICdlbGFzdGljZmlsZXN5c3RlbTpDbGllbnRXcml0ZScsXG4gICAgICAgICAgICAgICAgICAgICdlbGFzdGljZmlsZXN5c3RlbTpDbGllbnRSb290QWNjZXNzJyxcbiAgICAgICAgICAgICAgICAgICAgJ2VsYXN0aWNmaWxlc3lzdGVtOkRlc2NyaWJlTW91bnRUYXJnZXRzJ1xuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbJyonXVxuICAgICAgICAgICAgfSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJvbGU7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhbiBJQU0gZXhlY3V0aW9uIHJvbGUgZm9yIHRoZSBGYXJnYXRlIHNlcnZpY2UuXG4gICAgICogVGhpcyByb2xlIGlzIHVzZWQgYnkgRUNTIHRvIHB1bGwgY29udGFpbmVyIGltYWdlcyBhbmQgcHVibGlzaCBsb2dzIHRvIENsb3VkV2F0Y2guXG4gICAgICogXG4gICAgICogQHJldHVybnMgVGhlIGNyZWF0ZWQgSUFNIFJvbGUgaW5zdGFuY2Ugd2l0aCBuZWNlc3NhcnkgcGVybWlzc2lvbnMgZm9yIHRhc2sgZXhlY3V0aW9uXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBwcml2YXRlIGNyZWF0ZUV4ZWN1dGlvblJvbGUoKTogUm9sZSB7XG4gICAgICAgIGNvbnN0IHJvbGUgPSBuZXcgUm9sZSh0aGlzLm1haW5TdGFjaywgYCR7dGhpcy5mYXJnYXRlQ29uZmlnLnNlcnZpY2VOYW1lfS1leGVjdXRpb24tcm9sZWAsIHtcbiAgICAgICAgICAgIGFzc3VtZWRCeTogbmV3IFNlcnZpY2VQcmluY2lwYWwoJ2Vjcy10YXNrcy5hbWF6b25hd3MuY29tJyksXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogYEV4ZWN1dGlvbiByb2xlIGZvciAke3RoaXMuZmFyZ2F0ZUNvbmZpZy5zZXJ2aWNlTmFtZX0gRmFyZ2F0ZSBzZXJ2aWNlYCxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gQWRkIGRlZmF1bHQgZXhlY3V0aW9uIHJvbGUgcG9saWN5IChhbHdheXMgcmVxdWlyZWQpXG4gICAgICAgIHJvbGUuYWRkTWFuYWdlZFBvbGljeShcbiAgICAgICAgICAgIE1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQW1hem9uRUNTVGFza0V4ZWN1dGlvblJvbGVQb2xpY3knKVxuICAgICAgICApO1xuXG4gICAgICAgIC8vIEFkZCBDbG91ZFdhdGNoIExvZ3MgcGVybWlzc2lvbnMgKGFsd2F5cyByZXF1aXJlZCBmb3IgY29udGFpbmVyIGxvZ3MpXG4gICAgICAgIHJvbGUuYWRkVG9Qb2xpY3kobmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgJ2xvZ3M6Q3JlYXRlTG9nU3RyZWFtJyxcbiAgICAgICAgICAgICAgICAnbG9nczpQdXRMb2dFdmVudHMnXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBbJyonXVxuICAgICAgICB9KSk7XG5cbiAgICAgICAgaWYgKHRoaXMuZmFyZ2F0ZUNvbmZpZy5leGVjdXRpb25Sb2xlKSB7XG4gICAgICAgICAgICAvLyBBdHRhY2ggbWFuYWdlZCBwb2xpY2llcyBieSBBUk5cbiAgICAgICAgICAgIHRoaXMuZmFyZ2F0ZUNvbmZpZy5leGVjdXRpb25Sb2xlLm1hbmFnZWRQb2xpY3lBcm5zPy5mb3JFYWNoKChwb2xpY3lBcm4sIGluZGV4KSA9PiB7XG4gICAgICAgICAgICAgICAgcm9sZS5hZGRNYW5hZ2VkUG9saWN5KE1hbmFnZWRQb2xpY3kuZnJvbU1hbmFnZWRQb2xpY3lBcm4oXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubWFpblN0YWNrLFxuICAgICAgICAgICAgICAgICAgICBgJHt0aGlzLmZhcmdhdGVDb25maWcuc2VydmljZU5hbWV9LWV4ZWN1dGlvbi1tYW5hZ2VkLXBvbGljeS0ke2luZGV4fWAsXG4gICAgICAgICAgICAgICAgICAgIHBvbGljeUFyblxuICAgICAgICAgICAgICAgICkpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIEF0dGFjaCBtYW5hZ2VkIHBvbGljaWVzXG4gICAgICAgICAgICB0aGlzLmZhcmdhdGVDb25maWcuZXhlY3V0aW9uUm9sZS5tYW5hZ2VkUG9saWNpZXM/LmZvckVhY2gocG9saWN5ID0+IHtcbiAgICAgICAgICAgICAgICByb2xlLmFkZE1hbmFnZWRQb2xpY3kocG9saWN5KTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBBZGQgaW5saW5lIHBvbGljaWVzXG4gICAgICAgICAgICB0aGlzLmZhcmdhdGVDb25maWcuZXhlY3V0aW9uUm9sZS5pbmxpbmVQb2xpY2llcz8uZm9yRWFjaChzdGF0ZW1lbnQgPT4ge1xuICAgICAgICAgICAgICAgIHJvbGUuYWRkVG9Qb2xpY3koc3RhdGVtZW50KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJvbGU7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ29uc3RydWN0cyBhbGwgbmVjZXNzYXJ5IEFXUyByZXNvdXJjZXMgZm9yIHRoZSBGYXJnYXRlIHNlcnZpY2UuXG4gICAgICogVGhpcyBpbmNsdWRlcyBWUEMsIHNlY3VyaXR5IGdyb3VwcywgRUNTIGNsdXN0ZXIsIHRhc2sgZGVmaW5pdGlvbiwgY29udGFpbmVyIGNvbmZpZ3VyYXRpb24sXG4gICAgICogbG9hZCBiYWxhbmNlciAoaWYgc3BlY2lmaWVkKSwgYW5kIHNlcnZpY2UgZGlzY292ZXJ5IChpZiBzcGVjaWZpZWQpLlxuICAgICAqIFxuICAgICAqIEByZXR1cm5zIFByb21pc2UgdGhhdCByZXNvbHZlcyB3aGVuIGFsbCByZXNvdXJjZXMgYXJlIGNyZWF0ZWRcbiAgICAgKiBAcHVibGljXG4gICAgICovXG4gICAgQExvZ0R1cmF0aW9uKClcbiAgICBwdWJsaWMgYXN5bmMgY29uc3RydWN0KCkge1xuICAgICAgICB0aGlzLm1haW5TdGFjayA9IHRoaXMuZncyNC5nZXRTdGFjayh0aGlzLmZhcmdhdGVDb25maWcuc3RhY2tOYW1lLCB0aGlzLmZhcmdhdGVDb25maWcucGFyZW50U3RhY2tOYW1lKTtcblxuICAgICAgICAvLyBHZXQgVlBDIGZpcnN0IGFzIGl0J3MgbmVlZGVkIGZvciBhbGwgb3RoZXIgcmVzb3VyY2VzXG4gICAgICAgIHRoaXMudnBjID0gdGhpcy5nZXRWcGMoKTtcblxuICAgICAgICAvLyBHZXQgb3IgY3JlYXRlIFNlY3VyaXR5IEdyb3VwXG4gICAgICAgIGNvbnN0IHNlY3VyaXR5R3JvdXAgPSB0aGlzLmdldE9yQ3JlYXRlU2VjdXJpdHlHcm91cCgpO1xuXG4gICAgICAgIC8vIEdldCBvciBjcmVhdGUgRUNTIENsdXN0ZXJcbiAgICAgICAgdGhpcy5jbHVzdGVyID0gdGhpcy5nZXRPckNyZWF0ZUNsdXN0ZXIoKTtcblxuICAgICAgICAvLyBDcmVhdGUgdGFzayBhbmQgZXhlY3V0aW9uIHJvbGVzXG4gICAgICAgIGNvbnN0IHRhc2tSb2xlID0gdGhpcy5jcmVhdGVUYXNrUm9sZSgpO1xuICAgICAgICBjb25zdCBleGVjdXRpb25Sb2xlID0gdGhpcy5jcmVhdGVFeGVjdXRpb25Sb2xlKCk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIFRhc2sgRGVmaW5pdGlvbiB3aXRoIHJvbGVzLCBtZXJnaW5nIHdpdGggdXNlci1wcm92aWRlZCBwcm9wc1xuICAgICAgICB0aGlzLnRhc2tEZWZpbml0aW9uID0gbmV3IEZhcmdhdGVUYXNrRGVmaW5pdGlvbih0aGlzLm1haW5TdGFjaywgYCR7dGhpcy5mYXJnYXRlQ29uZmlnLnNlcnZpY2VOYW1lfS10YXNrYCwge1xuICAgICAgICAgICAgY3B1OiAyNTYsXG4gICAgICAgICAgICBtZW1vcnlMaW1pdE1pQjogNTEyLFxuICAgICAgICAgICAgdGFza1JvbGUsXG4gICAgICAgICAgICBleGVjdXRpb25Sb2xlLFxuICAgICAgICAgICAgLi4udGhpcy5mYXJnYXRlQ29uZmlnLnRhc2tEZWZpbml0aW9uUHJvcHMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEJ1aWxkIERvY2tlciBpbWFnZVxuICAgICAgICBjb25zdCBkb2NrZXJJbWFnZSA9IG5ldyBEb2NrZXJJbWFnZUFzc2V0KHRoaXMubWFpblN0YWNrLCBgJHt0aGlzLmZhcmdhdGVDb25maWcuc2VydmljZU5hbWV9LWltYWdlYCwge1xuICAgICAgICAgICAgZGlyZWN0b3J5OiBwYXRoLmRpcm5hbWUodGhpcy5mYXJnYXRlQ29uZmlnLmNvbnRhaW5lci5kb2NrZXJGaWxlUGF0aCksXG4gICAgICAgICAgICBmaWxlOiBwYXRoLmJhc2VuYW1lKHRoaXMuZmFyZ2F0ZUNvbmZpZy5jb250YWluZXIuZG9ja2VyRmlsZVBhdGgpLFxuICAgICAgICAgICAgcGxhdGZvcm06IHRoaXMuZmFyZ2F0ZUNvbmZpZy5kb2NrZXJJbWFnZVByb3BzPy5wbGF0Zm9ybSB8fCBQbGF0Zm9ybS5MSU5VWF9BTUQ2NCxcbiAgICAgICAgICAgIC4uLnRoaXMuZmFyZ2F0ZUNvbmZpZy5kb2NrZXJJbWFnZVByb3BzLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBBZGQgY29udGFpbmVyIHRvIHRhc2ssIG1lcmdpbmcgd2l0aCB1c2VyLXByb3ZpZGVkIHByb3BzXG4gICAgICAgIHRoaXMuY29udGFpbmVyID0gdGhpcy50YXNrRGVmaW5pdGlvbi5hZGRDb250YWluZXIoYCR7dGhpcy5mYXJnYXRlQ29uZmlnLnNlcnZpY2VOYW1lfS1jb250YWluZXJgLCB7XG4gICAgICAgICAgICBpbWFnZTogQ29udGFpbmVySW1hZ2UuZnJvbURvY2tlckltYWdlQXNzZXQoZG9ja2VySW1hZ2UpLFxuICAgICAgICAgICAgbG9nZ2luZzogbmV3IEF3c0xvZ0RyaXZlcih7XG4gICAgICAgICAgICAgICAgc3RyZWFtUHJlZml4OiB0aGlzLmZhcmdhdGVDb25maWcuc2VydmljZU5hbWUsXG4gICAgICAgICAgICAgICAgbG9nUmV0ZW50aW9uOiBSZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAuLi50aGlzLmZhcmdhdGVDb25maWcuY29udGFpbmVyLmNvbnRhaW5lclByb3BzLFxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmNvbnRhaW5lci5hZGRQb3J0TWFwcGluZ3Moe1xuICAgICAgICAgICAgY29udGFpbmVyUG9ydDogdGhpcy5mYXJnYXRlQ29uZmlnLmNvbnRhaW5lci5jb250YWluZXJQb3J0LFxuICAgICAgICAgICAgcHJvdG9jb2w6IFByb3RvY29sLlRDUCxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gQ29uZmlndXJlIHJvb3Qgdm9sdW1lIGlmIHNwZWNpZmllZFxuICAgICAgICB0aGlzLmNvbmZpZ3VyZVJvb3RWb2x1bWUodGhpcy50YXNrRGVmaW5pdGlvbik7XG5cbiAgICAgICAgLy8gQ3JlYXRlIEZhcmdhdGUgU2VydmljZSwgbWVyZ2luZyB3aXRoIHVzZXItcHJvdmlkZWQgcHJvcHNcbiAgICAgICAgY29uc3QgZmFyZ2F0ZVNlcnZpY2UgPSBuZXcgRmFyZ2F0ZVNlcnZpY2UodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZmFyZ2F0ZUNvbmZpZy5zZXJ2aWNlTmFtZX0tc2VydmljZWAsIHtcbiAgICAgICAgICAgIGNsdXN0ZXI6IHRoaXMuY2x1c3RlcixcbiAgICAgICAgICAgIHRhc2tEZWZpbml0aW9uOiB0aGlzLnRhc2tEZWZpbml0aW9uLFxuICAgICAgICAgICAgYXNzaWduUHVibGljSXA6IGZhbHNlLFxuICAgICAgICAgICAgc2VjdXJpdHlHcm91cHM6IFtzZWN1cml0eUdyb3VwXSxcbiAgICAgICAgICAgIHZwY1N1Ym5ldHM6IHsgc3VibmV0VHlwZTogU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTIH0sXG4gICAgICAgICAgICBtaW5IZWFsdGh5UGVyY2VudDogMTAwLFxuICAgICAgICAgICAgbWF4SGVhbHRoeVBlcmNlbnQ6IDIwMCxcbiAgICAgICAgICAgIGNhcGFjaXR5UHJvdmlkZXJTdHJhdGVnaWVzOiBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBjYXBhY2l0eVByb3ZpZGVyOiAnRkFSR0FURV9TUE9UJyxcbiAgICAgICAgICAgICAgICAgICAgYmFzZTogMSxcbiAgICAgICAgICAgICAgICAgICAgd2VpZ2h0OiAxXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIC4uLnRoaXMuZmFyZ2F0ZUNvbmZpZy5zZXJ2aWNlUHJvcHMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIENyZWF0ZSBFRlMgaWYgY29uZmlnIGV4aXN0c1xuICAgICAgICBpZiAodGhpcy5mYXJnYXRlQ29uZmlnLmVmcykge1xuICAgICAgICAgICAgY29uc3QgZmlsZVN5c3RlbSA9IHRoaXMuY3JlYXRlRWZzRmlsZVN5c3RlbShzZWN1cml0eUdyb3VwKTtcbiAgICAgICAgICAgIGNvbnN0IGFjY2Vzc1BvaW50ID0gdGhpcy5jcmVhdGVFZnNBY2Nlc3NQb2ludChmaWxlU3lzdGVtISk7XG4gICAgICAgICAgICBpZiAoZmlsZVN5c3RlbSAmJiBhY2Nlc3NQb2ludCkge1xuICAgICAgICAgICAgICAgIHRoaXMuY29uZmlndXJlRWZzVm9sdW1lKGZpbGVTeXN0ZW0sIGFjY2Vzc1BvaW50KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENvbmZpZ3VyZSBlaXRoZXIgQUxCIG9yIFNlcnZpY2UgRGlzY292ZXJ5XG4gICAgICAgIGlmICh0aGlzLmZhcmdhdGVDb25maWcubG9hZEJhbGFuY2VyKSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmNvbmZpZ3VyZUxvYWRCYWxhbmNlcihmYXJnYXRlU2VydmljZSwgc2VjdXJpdHlHcm91cCk7XG4gICAgICAgIH0gZWxzZSBpZiAodGhpcy5mYXJnYXRlQ29uZmlnLnNlcnZpY2VEaXNjb3ZlcnkpIHtcbiAgICAgICAgICAgIHRoaXMuY29uZmlndXJlU2VydmljZURpc2NvdmVyeShmYXJnYXRlU2VydmljZSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDb25maWd1cmUgQXV0byBTY2FsaW5nIGlmIHNwZWNpZmllZCBpbiBzZXJ2aWNlUHJvcHNcbiAgICAgICAgaWYgKHRoaXMuZmFyZ2F0ZUNvbmZpZy5zZXJ2aWNlUHJvcHM/Lm1heENhcGFjaXR5IHx8IHRoaXMuZmFyZ2F0ZUNvbmZpZy5zZXJ2aWNlUHJvcHM/Lm1pbkNhcGFjaXR5KSB7XG4gICAgICAgICAgICBjb25zdCBzY2FsaW5nID0gZmFyZ2F0ZVNlcnZpY2UuYXV0b1NjYWxlVGFza0NvdW50KHtcbiAgICAgICAgICAgICAgICBtaW5DYXBhY2l0eTogdGhpcy5mYXJnYXRlQ29uZmlnLnNlcnZpY2VQcm9wcy5taW5DYXBhY2l0eSB8fCAxLFxuICAgICAgICAgICAgICAgIG1heENhcGFjaXR5OiB0aGlzLmZhcmdhdGVDb25maWcuc2VydmljZVByb3BzLm1heENhcGFjaXR5IHx8IDEwLFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIElmIENQVSB1dGlsaXphdGlvbiB0YXJnZXQgaXMgc3BlY2lmaWVkXG4gICAgICAgICAgICBpZiAodGhpcy5mYXJnYXRlQ29uZmlnLnNlcnZpY2VQcm9wcy50YXJnZXRDcHVVdGlsaXphdGlvbikge1xuICAgICAgICAgICAgICAgIHNjYWxpbmcuc2NhbGVPbkNwdVV0aWxpemF0aW9uKCdDcHVTY2FsaW5nJywge1xuICAgICAgICAgICAgICAgICAgICB0YXJnZXRVdGlsaXphdGlvblBlcmNlbnQ6IHRoaXMuZmFyZ2F0ZUNvbmZpZy5zZXJ2aWNlUHJvcHMudGFyZ2V0Q3B1VXRpbGl6YXRpb24sXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIElmIG1lbW9yeSB1dGlsaXphdGlvbiB0YXJnZXQgaXMgc3BlY2lmaWVkXG4gICAgICAgICAgICBpZiAodGhpcy5mYXJnYXRlQ29uZmlnLnNlcnZpY2VQcm9wcy50YXJnZXRNZW1vcnlVdGlsaXphdGlvbikge1xuICAgICAgICAgICAgICAgIHNjYWxpbmcuc2NhbGVPbk1lbW9yeVV0aWxpemF0aW9uKCdNZW1vcnlTY2FsaW5nJywge1xuICAgICAgICAgICAgICAgICAgICB0YXJnZXRVdGlsaXphdGlvblBlcmNlbnQ6IHRoaXMuZmFyZ2F0ZUNvbmZpZy5zZXJ2aWNlUHJvcHMudGFyZ2V0TWVtb3J5VXRpbGl6YXRpb24sXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBTZXQgb3V0cHV0c1xuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIHRoaXMuZmFyZ2F0ZUNvbmZpZy5zZXJ2aWNlTmFtZSwgZmFyZ2F0ZVNlcnZpY2UsIE91dHB1dFR5cGUuU0VSVklDRSk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKGAke3RoaXMuZmFyZ2F0ZUNvbmZpZy5zZXJ2aWNlTmFtZX1TZXJ2aWNlQXJuYCwgZmFyZ2F0ZVNlcnZpY2Uuc2VydmljZUFybik7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0cyB0aGUgVlBDIGZvciB0aGUgRmFyZ2F0ZSBzZXJ2aWNlIGVpdGhlciBmcm9tIHRoZSBwcm92aWRlZCBjb25maWd1cmF0aW9uIG9yIGxvb2tzIGl0IHVwIGJ5IG5hbWUuXG4gICAgICogXG4gICAgICogQHJldHVybnMgVGhlIFZQQyBpbnN0YW5jZSB0byBiZSB1c2VkIGZvciB0aGUgRmFyZ2F0ZSBzZXJ2aWNlXG4gICAgICogQHRocm93cyBFcnJvciBpZiBuZWl0aGVyIFZQQyBuYW1lIG5vciBWUEMgaW5zdGFuY2UgaXMgcHJvdmlkZWRcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIHByaXZhdGUgZ2V0VnBjKCk6IElWcGMge1xuICAgICAgICBpZiAoIXRoaXMuZmFyZ2F0ZUNvbmZpZy52cGNOYW1lICYmICF0aGlzLmZhcmdhdGVDb25maWcudnBjKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1ZQQyBOYW1lIG9yIFZQQyBtdXN0IGJlIHNwZWNpZmllZCBpbiB0aGUgRmFyZ2F0ZSBjb25maWd1cmF0aW9uJyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGhpcy5mYXJnYXRlQ29uZmlnLnZwYykge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZmFyZ2F0ZUNvbmZpZy52cGM7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gVnBjLmZyb21Mb29rdXAodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZmFyZ2F0ZUNvbmZpZy5zZXJ2aWNlTmFtZX0tdnBjYCwge1xuICAgICAgICAgICAgdnBjTmFtZTogdGhpcy5mYXJnYXRlQ29uZmlnLnZwY05hbWVcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0cyBhbiBleGlzdGluZyBjbHVzdGVyIG9yIGNyZWF0ZXMgYSBuZXcgb25lIGJhc2VkIG9uIHRoZSBjb25maWd1cmF0aW9uLlxuICAgICAqIElmIGEgY2x1c3RlciBuYW1lIGlzIHByb3ZpZGVkIGluIHRoZSBjb25maWcsIGl0IHdpbGwgbG9vayB1cCBhbmQgdXNlIHRoYXQgY2x1c3Rlci5cbiAgICAgKiBPdGhlcndpc2UsIGl0IGNyZWF0ZXMgYSBuZXcgY2x1c3RlciB3aXRoIGNvbnRhaW5lciBpbnNpZ2h0cyBlbmFibGVkLlxuICAgICAqIFxuICAgICAqIEByZXR1cm5zIFRoZSBFQ1MgY2x1c3RlciBpbnN0YW5jZVxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgcHJpdmF0ZSBnZXRPckNyZWF0ZUNsdXN0ZXIoKTogSUNsdXN0ZXIge1xuICAgICAgICBpZiAodGhpcy5mYXJnYXRlQ29uZmlnLmNsdXN0ZXI/Lm5hbWUpIHtcbiAgICAgICAgICAgIHJldHVybiBDbHVzdGVyLmZyb21DbHVzdGVyQXR0cmlidXRlcyh0aGlzLm1haW5TdGFjaywgYCR7dGhpcy5mYXJnYXRlQ29uZmlnLnNlcnZpY2VOYW1lfS1pbXBvcnRlZC1jbHVzdGVyYCwge1xuICAgICAgICAgICAgICAgIGNsdXN0ZXJOYW1lOiB0aGlzLmZhcmdhdGVDb25maWcuY2x1c3Rlci5uYW1lLFxuICAgICAgICAgICAgICAgIHZwYzogdGhpcy52cGNcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgY2x1c3Rlck5hbWUgPSB0aGlzLmZhcmdhdGVDb25maWcuY2x1c3Rlcj8ubmFtZSB8fCBgJHt0aGlzLmZhcmdhdGVDb25maWcuc2VydmljZU5hbWV9LWNsdXN0ZXJgO1xuICAgICAgICBjb25zdCBjbHVzdGVyID0gbmV3IENsdXN0ZXIodGhpcy5tYWluU3RhY2ssIGNsdXN0ZXJOYW1lLCB7XG4gICAgICAgICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgICAgICAgY29udGFpbmVySW5zaWdodHM6IHRydWUsXG4gICAgICAgICAgICBjbHVzdGVyTmFtZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCBjbHVzdGVyTmFtZSwgY2x1c3RlciwgT3V0cHV0VHlwZS5DTFVTVEVSKTtcbiAgICAgICAgcmV0dXJuIGNsdXN0ZXI7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0cyBhbiBleGlzdGluZyBzZWN1cml0eSBncm91cCBvciBjcmVhdGVzIGEgbmV3IG9uZSBmb3IgdGhlIEZhcmdhdGUgc2VydmljZS5cbiAgICAgKiBJZiBhIHNlY3VyaXR5IGdyb3VwIElEIGlzIHByb3ZpZGVkLCBpdCB3aWxsIHVzZSB0aGF0IGdyb3VwLlxuICAgICAqIE90aGVyd2lzZSwgaXQgY3JlYXRlcyBhIG5ldyBzZWN1cml0eSBncm91cCB3aXRoIGFwcHJvcHJpYXRlIGluZ3Jlc3MgcnVsZXMuXG4gICAgICogXG4gICAgICogQHJldHVybnMgVGhlIHNlY3VyaXR5IGdyb3VwIGluc3RhbmNlXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBwcml2YXRlIGdldE9yQ3JlYXRlU2VjdXJpdHlHcm91cCgpOiBJU2VjdXJpdHlHcm91cCB7XG4gICAgICAgIGlmICh0aGlzLmZhcmdhdGVDb25maWcuc2VjdXJpdHlHcm91cD8uc2VjdXJpdHlHcm91cElkKSB7XG4gICAgICAgICAgICByZXR1cm4gU2VjdXJpdHlHcm91cC5mcm9tU2VjdXJpdHlHcm91cElkKFxuICAgICAgICAgICAgICAgIHRoaXMubWFpblN0YWNrLCBcbiAgICAgICAgICAgICAgICBgJHt0aGlzLmZhcmdhdGVDb25maWcuc2VydmljZU5hbWV9LWltcG9ydGVkLXNnYCxcbiAgICAgICAgICAgICAgICB0aGlzLmZhcmdhdGVDb25maWcuc2VjdXJpdHlHcm91cC5zZWN1cml0eUdyb3VwSWRcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzZWN1cml0eUdyb3VwID0gbmV3IFNlY3VyaXR5R3JvdXAodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZmFyZ2F0ZUNvbmZpZy5zZXJ2aWNlTmFtZX0tc2dgLCB7XG4gICAgICAgICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgICAgICAgYWxsb3dBbGxPdXRib3VuZDogdHJ1ZSxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBgU2VjdXJpdHkgZ3JvdXAgZm9yICR7dGhpcy5mYXJnYXRlQ29uZmlnLnNlcnZpY2VOYW1lfSBGYXJnYXRlIHNlcnZpY2VgLFxuICAgICAgICAgICAgLi4udGhpcy5mYXJnYXRlQ29uZmlnLnNlY3VyaXR5R3JvdXA/LnByb3BzLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBJZiBub3QgdXNpbmcgQUxCLCBhbGxvdyBpbmJvdW5kIHRyYWZmaWMgb24gY29udGFpbmVyIHBvcnQgZnJvbSB3aXRoaW4gVlBDXG4gICAgICAgIGlmICghdGhpcy5mYXJnYXRlQ29uZmlnLmxvYWRCYWxhbmNlcikge1xuICAgICAgICAgICAgc2VjdXJpdHlHcm91cC5hZGRJbmdyZXNzUnVsZShcbiAgICAgICAgICAgICAgICBQZWVyLmlwdjQodGhpcy52cGMudnBjQ2lkckJsb2NrKSxcbiAgICAgICAgICAgICAgICBQb3J0LnRjcCh0aGlzLmZhcmdhdGVDb25maWcuY29udGFpbmVyLmNvbnRhaW5lclBvcnQpLFxuICAgICAgICAgICAgICAgICdBbGxvdyBpbmJvdW5kIHRyYWZmaWMgb24gY29udGFpbmVyIHBvcnQgZnJvbSB3aXRoaW4gVlBDJ1xuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgYCR7dGhpcy5mYXJnYXRlQ29uZmlnLnNlcnZpY2VOYW1lfS1zZ2AsIHNlY3VyaXR5R3JvdXAsIE91dHB1dFR5cGUuU0VDVVJJVFlHUk9VUCk7XG4gICAgICAgIHJldHVybiBzZWN1cml0eUdyb3VwO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYSBzZWN1cml0eSBncm91cCBmb3IgdGhlIEFwcGxpY2F0aW9uIExvYWQgQmFsYW5jZXIuXG4gICAgICogVGhpcyBzZWN1cml0eSBncm91cCBhbGxvd3MgaW5ib3VuZCBIVFRQL0hUVFBTIHRyYWZmaWMgYW5kIG91dGJvdW5kIHRyYWZmaWMgdG8gdGhlIEZhcmdhdGUgc2VydmljZS5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gdnBjIC0gVGhlIFZQQyB3aGVyZSB0aGUgc2VjdXJpdHkgZ3JvdXAgd2lsbCBiZSBjcmVhdGVkXG4gICAgICogQHJldHVybnMgVGhlIGNyZWF0ZWQgc2VjdXJpdHkgZ3JvdXAgZm9yIHRoZSBBTEJcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIHByaXZhdGUgY3JlYXRlQWxiU2VjdXJpdHlHcm91cCh2cGM6IElWcGMpOiBTZWN1cml0eUdyb3VwIHtcbiAgICAgICAgLy8gQ3JlYXRlIEFMQiBzZWN1cml0eSBncm91cFxuICAgICAgICBjb25zdCBhbGJTZWN1cml0eUdyb3VwID0gbmV3IFNlY3VyaXR5R3JvdXAodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZmFyZ2F0ZUNvbmZpZy5zZXJ2aWNlTmFtZX0tYWxiLXNnYCwge1xuICAgICAgICAgICAgdnBjLFxuICAgICAgICAgICAgYWxsb3dBbGxPdXRib3VuZDogdHJ1ZSxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBgU2VjdXJpdHkgZ3JvdXAgZm9yICR7dGhpcy5mYXJnYXRlQ29uZmlnLnNlcnZpY2VOYW1lfSBBTEJgLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBBbGxvdyBpbmJvdW5kIEhUVFBTIHRyYWZmaWMgZnJvbSBhbnl3aGVyZSB0byBBTEJcbiAgICAgICAgYWxiU2VjdXJpdHlHcm91cC5hZGRJbmdyZXNzUnVsZShcbiAgICAgICAgICAgIFBlZXIuYW55SXB2NCgpLFxuICAgICAgICAgICAgUG9ydC50Y3AoNDQzKSxcbiAgICAgICAgICAgICdBbGxvdyBIVFRQUyB0cmFmZmljJ1xuICAgICAgICApO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgYCR7dGhpcy5mYXJnYXRlQ29uZmlnLnNlcnZpY2VOYW1lfS1hbGItc2dgLCBhbGJTZWN1cml0eUdyb3VwLCBPdXRwdXRUeXBlLlNFQ1VSSVRZR1JPVVApO1xuICAgICAgICByZXR1cm4gYWxiU2VjdXJpdHlHcm91cDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDb25maWd1cmVzIHNlY3VyaXR5IGdyb3VwIHJ1bGVzIGJldHdlZW4gdGhlIEFMQiBhbmQgRmFyZ2F0ZSBzZXJ2aWNlLlxuICAgICAqIFNldHMgdXAgaW5ncmVzcyBydWxlcyB0byBhbGxvdyB0cmFmZmljIGZyb20gQUxCIHRvIHRoZSBjb250YWluZXIgcG9ydC5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gc2VydmljZVNlY3VyaXR5R3JvdXAgLSBUaGUgc2VjdXJpdHkgZ3JvdXAgYXR0YWNoZWQgdG8gdGhlIEZhcmdhdGUgc2VydmljZVxuICAgICAqIEBwYXJhbSBhbGJTZWN1cml0eUdyb3VwIC0gVGhlIHNlY3VyaXR5IGdyb3VwIGF0dGFjaGVkIHRvIHRoZSBBTEJcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIHByaXZhdGUgY29uZmlndXJlU2VjdXJpdHlHcm91cFJ1bGVzKHNlcnZpY2VTZWN1cml0eUdyb3VwOiBJU2VjdXJpdHlHcm91cCwgYWxiU2VjdXJpdHlHcm91cDogU2VjdXJpdHlHcm91cCkge1xuICAgICAgICAvLyBBbGxvdyBpbmJvdW5kIHRyYWZmaWMgZnJvbSBBTEIgdG8gc2VydmljZSBvbiBjb250YWluZXIgcG9ydFxuICAgICAgICBzZXJ2aWNlU2VjdXJpdHlHcm91cC5hZGRJbmdyZXNzUnVsZShcbiAgICAgICAgICAgIGFsYlNlY3VyaXR5R3JvdXAsXG4gICAgICAgICAgICBQb3J0LnRjcCh0aGlzLmZhcmdhdGVDb25maWcuY29udGFpbmVyLmNvbnRhaW5lclBvcnQpLFxuICAgICAgICAgICAgJ0FsbG93IGluYm91bmQgZnJvbSBBTEInXG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ29uZmlndXJlcyB0aGUgQXBwbGljYXRpb24gTG9hZCBCYWxhbmNlciBmb3IgdGhlIEZhcmdhdGUgc2VydmljZS5cbiAgICAgKiBTZXRzIHVwIGxpc3RlbmVycywgdGFyZ2V0IGdyb3VwcywgYW5kIHJvdXRpbmcgcnVsZXMgZm9yIEhUVFBTIHRyYWZmaWMuXG4gICAgICogXG4gICAgICogQHBhcmFtIGZhcmdhdGVTZXJ2aWNlIC0gVGhlIEZhcmdhdGUgc2VydmljZSB0byBhdHRhY2ggdG8gdGhlIEFMQlxuICAgICAqIEBwYXJhbSBzZXJ2aWNlU2VjdXJpdHlHcm91cCAtIFRoZSBzZWN1cml0eSBncm91cCBmb3IgdGhlIEZhcmdhdGUgc2VydmljZVxuICAgICAqIEByZXR1cm5zIFByb21pc2UgdGhhdCByZXNvbHZlcyB3aGVuIEFMQiBjb25maWd1cmF0aW9uIGlzIGNvbXBsZXRlXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBwcml2YXRlIGFzeW5jIGNvbmZpZ3VyZUxvYWRCYWxhbmNlcihmYXJnYXRlU2VydmljZTogRmFyZ2F0ZVNlcnZpY2UsIHNlcnZpY2VTZWN1cml0eUdyb3VwOiBJU2VjdXJpdHlHcm91cCkge1xuICAgICAgICAvLyBDcmVhdGUgQUxCIHNlY3VyaXR5IGdyb3VwIHdpdGggcHJvcGVyIHJ1bGVzXG4gICAgICAgIGNvbnN0IGFsYlNlY3VyaXR5R3JvdXAgPSB0aGlzLmNyZWF0ZUFsYlNlY3VyaXR5R3JvdXAodGhpcy52cGMpO1xuXG4gICAgICAgIC8vIENvbmZpZ3VyZSBzZWN1cml0eSBncm91cCBydWxlcyBiZXR3ZWVuIEFMQiBhbmQgc2VydmljZVxuICAgICAgICB0aGlzLmNvbmZpZ3VyZVNlY3VyaXR5R3JvdXBSdWxlcyhzZXJ2aWNlU2VjdXJpdHlHcm91cCwgYWxiU2VjdXJpdHlHcm91cCk7XG5cbiAgICAgICAgY29uc3QgbGIgPSBuZXcgQXBwbGljYXRpb25Mb2FkQmFsYW5jZXIodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZmFyZ2F0ZUNvbmZpZy5zZXJ2aWNlTmFtZX0tYWxiYCwge1xuICAgICAgICAgICAgdnBjOiB0aGlzLnZwYyxcbiAgICAgICAgICAgIGludGVybmV0RmFjaW5nOiB0cnVlLFxuICAgICAgICAgICAgc2VjdXJpdHlHcm91cDogYWxiU2VjdXJpdHlHcm91cCxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgY2VydGlmaWNhdGUgPSBhd2FpdCB0aGlzLmdldE9yQ3JlYXRlQ2VydGlmaWNhdGUoKTtcblxuICAgICAgICBjb25zdCBsaXN0ZW5lciA9IGxiLmFkZExpc3RlbmVyKGAke3RoaXMuZmFyZ2F0ZUNvbmZpZy5zZXJ2aWNlTmFtZX0tbGlzdGVuZXJgLCB7XG4gICAgICAgICAgICBwb3J0OiA0NDMsXG4gICAgICAgICAgICBwcm90b2NvbDogQXBwbGljYXRpb25Qcm90b2NvbC5IVFRQUyxcbiAgICAgICAgICAgIGNlcnRpZmljYXRlczogY2VydGlmaWNhdGUgPyBbeyBjZXJ0aWZpY2F0ZUFybjogY2VydGlmaWNhdGUuY2VydGlmaWNhdGVBcm4gfV0gOiB1bmRlZmluZWQsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIENyZWF0ZSB0YXJnZXQgZ3JvdXAgYW5kIGFkZCBpdCB0byB0aGUgbGlzdGVuZXJcbiAgICAgICAgY29uc3QgdGFyZ2V0R3JvdXAgPSBsaXN0ZW5lci5hZGRUYXJnZXRzKGAke3RoaXMuZmFyZ2F0ZUNvbmZpZy5zZXJ2aWNlTmFtZX0tdGFyZ2V0YCwge1xuICAgICAgICAgICAgcG9ydDogdGhpcy5mYXJnYXRlQ29uZmlnLmNvbnRhaW5lci5jb250YWluZXJQb3J0LFxuICAgICAgICAgICAgcHJvdG9jb2w6IEFwcGxpY2F0aW9uUHJvdG9jb2wuSFRUUCxcbiAgICAgICAgICAgIHRhcmdldHM6IFtmYXJnYXRlU2VydmljZV0sXG4gICAgICAgICAgICBoZWFsdGhDaGVjazoge1xuICAgICAgICAgICAgICAgIHBhdGg6ICcvaGVhbHRoJyxcbiAgICAgICAgICAgICAgICBpbnRlcnZhbDogRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICAgICAgICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcyg1KSxcbiAgICAgICAgICAgICAgICBoZWFsdGh5VGhyZXNob2xkQ291bnQ6IDIsXG4gICAgICAgICAgICAgICAgdW5oZWFsdGh5VGhyZXNob2xkQ291bnQ6IDMsXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgYCR7dGhpcy5mYXJnYXRlQ29uZmlnLnNlcnZpY2VOYW1lfS1hbGJgLCBsYiwgT3V0cHV0VHlwZS5MT0FEQkFMQU5DRVIpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldHMgYW4gZXhpc3RpbmcgY2VydGlmaWNhdGUgb3IgY3JlYXRlcyBhIG5ldyBvbmUgZm9yIEhUVFBTLlxuICAgICAqIElmIGEgY2VydGlmaWNhdGUgQVJOIGlzIHByb3ZpZGVkLCBpdCB3aWxsIHVzZSB0aGF0IGNlcnRpZmljYXRlLlxuICAgICAqIE90aGVyd2lzZSwgaXQgY3JlYXRlcyBhIG5ldyBjZXJ0aWZpY2F0ZSB1c2luZyB0aGUgQ2VydGlmaWNhdGVDb25zdHJ1Y3QuXG4gICAgICogXG4gICAgICogQHJldHVybnMgUHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSBjZXJ0aWZpY2F0ZSBvciB1bmRlZmluZWQgaWYgbm90IG5lZWRlZFxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgcHJpdmF0ZSBhc3luYyBnZXRPckNyZWF0ZUNlcnRpZmljYXRlKCk6IFByb21pc2U8SUNlcnRpZmljYXRlIHwgdW5kZWZpbmVkPiB7XG4gICAgICAgIGlmICghdGhpcy5mYXJnYXRlQ29uZmlnLmxvYWRCYWxhbmNlcikgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgICAgICBpZiAodGhpcy5mYXJnYXRlQ29uZmlnLmxvYWRCYWxhbmNlci5kb21haW5OYW1lKSB7XG4gICAgICAgICAgICBjb25zdCBjZXJ0aWZpY2F0ZUNvbnN0cnVjdCA9IG5ldyBDZXJ0aWZpY2F0ZUNvbnN0cnVjdCh7XG4gICAgICAgICAgICAgICAgZG9tYWluTmFtZTogdGhpcy5mYXJnYXRlQ29uZmlnLmxvYWRCYWxhbmNlci5kb21haW5OYW1lLFxuICAgICAgICAgICAgICAgIGNlcnRpZmljYXRlQXJuOiB0aGlzLmZhcmdhdGVDb25maWcubG9hZEJhbGFuY2VyLmNlcnRpZmljYXRlQXJuXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY2VydGlmaWNhdGVDb25zdHJ1Y3QuY29uc3RydWN0KCk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGNvbnN0IGNlcnRpZmljYXRlID0gY2VydGlmaWNhdGVDb25zdHJ1Y3Qub3V0cHV0W091dHB1dFR5cGUuQ0VSVElGSUNBVEVdW3RoaXMuZmFyZ2F0ZUNvbmZpZy5sb2FkQmFsYW5jZXIuZG9tYWluTmFtZV07XG4gICAgICAgICAgICByZXR1cm4gY2VydGlmaWNhdGU7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENvbmZpZ3VyZXMgc2VydmljZSBkaXNjb3ZlcnkgZm9yIHRoZSBGYXJnYXRlIHNlcnZpY2UuXG4gICAgICogQ3JlYXRlcyBhIHByaXZhdGUgRE5TIG5hbWVzcGFjZSBhbmQgcmVnaXN0ZXJzIHRoZSBzZXJ2aWNlIGZvciBpbnRlcm5hbCBkaXNjb3ZlcnkuXG4gICAgICogXG4gICAgICogQHBhcmFtIGZhcmdhdGVTZXJ2aWNlIC0gVGhlIEZhcmdhdGUgc2VydmljZSB0byBjb25maWd1cmUgc2VydmljZSBkaXNjb3ZlcnkgZm9yXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBwcml2YXRlIGNvbmZpZ3VyZVNlcnZpY2VEaXNjb3ZlcnkoZmFyZ2F0ZVNlcnZpY2U6IEZhcmdhdGVTZXJ2aWNlKSB7XG4gICAgICAgIGlmICghdGhpcy5mYXJnYXRlQ29uZmlnLnNlcnZpY2VEaXNjb3ZlcnkpIHJldHVybjtcblxuICAgICAgICBjb25zdCBuYW1lc3BhY2UgPSBuZXcgUHJpdmF0ZURuc05hbWVzcGFjZSh0aGlzLm1haW5TdGFjaywgYCR7dGhpcy5mYXJnYXRlQ29uZmlnLnNlcnZpY2VOYW1lfS1uYW1lc3BhY2VgLCB7XG4gICAgICAgICAgICBuYW1lOiB0aGlzLmZhcmdhdGVDb25maWcuc2VydmljZURpc2NvdmVyeS5uYW1lc3BhY2UsXG4gICAgICAgICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCBzZXJ2aWNlID0gZmFyZ2F0ZVNlcnZpY2UuZW5hYmxlQ2xvdWRNYXAoe1xuICAgICAgICAgICAgY2xvdWRNYXBOYW1lc3BhY2U6IG5hbWVzcGFjZSxcbiAgICAgICAgICAgIG5hbWU6IHRoaXMuZmFyZ2F0ZUNvbmZpZy5zZXJ2aWNlRGlzY292ZXJ5LnNlcnZpY2VOYW1lLFxuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIGAke3RoaXMuZmFyZ2F0ZUNvbmZpZy5zZXJ2aWNlTmFtZX0tZGlzY292ZXJ5YCwgc2VydmljZSwgT3V0cHV0VHlwZS5TRVJWSUNFX0RJU0NPVkVSWSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhbiBFRlMgZmlsZSBzeXN0ZW0gZm9yIHBlcnNpc3RlbnQgc3RvcmFnZS5cbiAgICAgKiBTZXRzIHVwIHNlY3VyaXR5IGdyb3VwcywgbW91bnQgdGFyZ2V0cywgYW5kIGVuY3J5cHRpb24gc2V0dGluZ3MuXG4gICAgICogXG4gICAgICogQHBhcmFtIHNlcnZpY2VTZWN1cml0eUdyb3VwIC0gVGhlIHNlY3VyaXR5IGdyb3VwIGZvciB0aGUgRmFyZ2F0ZSBzZXJ2aWNlXG4gICAgICogQHJldHVybnMgVGhlIGNyZWF0ZWQgRmlsZVN5c3RlbSBpbnN0YW5jZSBvciB1bmRlZmluZWQgaWYgRUZTIGlzIG5vdCBjb25maWd1cmVkXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBwcml2YXRlIGNyZWF0ZUVmc0ZpbGVTeXN0ZW0oc2VydmljZVNlY3VyaXR5R3JvdXA6IElTZWN1cml0eUdyb3VwKTogRmlsZVN5c3RlbSB8IHVuZGVmaW5lZCB7XG4gICAgICAgIGlmICghdGhpcy5mYXJnYXRlQ29uZmlnLmVmcykge1xuICAgICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGVmc1NlY3VyaXR5R3JvdXAgPSBuZXcgU2VjdXJpdHlHcm91cCh0aGlzLm1haW5TdGFjaywgYCR7dGhpcy5mYXJnYXRlQ29uZmlnLnNlcnZpY2VOYW1lfS1lZnMtc2dgLCB7XG4gICAgICAgICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgICAgICAgYWxsb3dBbGxPdXRib3VuZDogdHJ1ZSxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBgU2VjdXJpdHkgZ3JvdXAgZm9yICR7dGhpcy5mYXJnYXRlQ29uZmlnLnNlcnZpY2VOYW1lfSBFRlNgLFxuICAgICAgICB9KTtcblxuICAgICAgICBlZnNTZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKFxuICAgICAgICAgICAgUGVlci5zZWN1cml0eUdyb3VwSWQoc2VydmljZVNlY3VyaXR5R3JvdXAuc2VjdXJpdHlHcm91cElkKSxcbiAgICAgICAgICAgIFBvcnQudGNwKDIwNDkpLFxuICAgICAgICAgICAgJ0FsbG93IE5GUyBhY2Nlc3MgZnJvbSBGYXJnYXRlIHNlcnZpY2UnXG4gICAgICAgICk7XG5cbiAgICAgICAgY29uc3QgZmlsZVN5c3RlbSA9IG5ldyBGaWxlU3lzdGVtKHRoaXMubWFpblN0YWNrLCBgJHt0aGlzLmZhcmdhdGVDb25maWcuc2VydmljZU5hbWV9LWVmc2AsIHtcbiAgICAgICAgICAgIHZwYzogdGhpcy52cGMsXG4gICAgICAgICAgICB2cGNTdWJuZXRzOiB7IHN1Ym5ldFR5cGU6IFN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyB9LFxuICAgICAgICAgICAgc2VjdXJpdHlHcm91cDogZWZzU2VjdXJpdHlHcm91cCxcbiAgICAgICAgICAgIGVuY3J5cHRlZDogdHJ1ZSxcbiAgICAgICAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgICAgIGZpbGVTeXN0ZW1OYW1lOiB0aGlzLmZhcmdhdGVDb25maWcuZWZzLm5hbWUgfHwgYCR7dGhpcy5mYXJnYXRlQ29uZmlnLnNlcnZpY2VOYW1lfS1lZnNgLFxuICAgICAgICAgICAgLi4udGhpcy5mYXJnYXRlQ29uZmlnLmVmcy5maWxlU3lzdGVtUHJvcHMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgJ2VmcycsIGZpbGVTeXN0ZW0sIE91dHB1dFR5cGUuRUZTKTtcblxuICAgICAgICByZXR1cm4gZmlsZVN5c3RlbTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIGFuIEVGUyBBY2Nlc3MgUG9pbnQgZm9yIHRoZSBGYXJnYXRlIHNlcnZpY2UuXG4gICAgICogVGhpcyBhY2Nlc3MgcG9pbnQgcHJvdmlkZXMgYXBwbGljYXRpb24tc3BlY2lmaWMgZW50cnkgcG9pbnRzIHRvIHRoZSBFRlMgZmlsZSBzeXN0ZW1cbiAgICAgKiB3aXRoIHNwZWNpZmllZCBwZXJtaXNzaW9ucyBhbmQgcm9vdCBkaXJlY3RvcnkgY29uZmlndXJhdGlvbnMuXG4gICAgICogXG4gICAgICogQHBhcmFtIGZpbGVTeXN0ZW0gLSBUaGUgRUZTIEZpbGVTeXN0ZW0gdG8gY3JlYXRlIHRoZSBhY2Nlc3MgcG9pbnQgZm9yXG4gICAgICogQHJldHVybnMgVGhlIGNyZWF0ZWQgQWNjZXNzUG9pbnQgaW5zdGFuY2Ugb3IgdW5kZWZpbmVkIGlmIEVGUyBpcyBub3QgY29uZmlndXJlZFxuICAgICAqIEB0aHJvd3MgRXJyb3IgaWYgZmlsZVN5c3RlbSBpcyBub3QgcHJvdmlkZWQgb3IgaWYgcm9vdCBkaXJlY3RvcnkgcGF0aCBpcyBpbnZhbGlkXG4gICAgICovXG4gICAgcHJpdmF0ZSBjcmVhdGVFZnNBY2Nlc3NQb2ludChmaWxlU3lzdGVtOiBGaWxlU3lzdGVtKSB7XG4gICAgICAgIGlmICghdGhpcy5mYXJnYXRlQ29uZmlnLmVmcykge1xuICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoJ05vIEVGUyBjb25maWd1cmF0aW9uIGZvdW5kLCBza2lwcGluZyBhY2Nlc3MgcG9pbnQgY3JlYXRpb24nKTtcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWZpbGVTeXN0ZW0pIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignRmlsZVN5c3RlbSBpcyByZXF1aXJlZCBmb3IgY3JlYXRpbmcgYW4gYWNjZXNzIHBvaW50Jyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBWYWxpZGF0ZSBhbmQgbm9ybWFsaXplIHBhdGhcbiAgICAgICAgY29uc3QgcGF0aCA9IHRoaXMuZmFyZ2F0ZUNvbmZpZy5lZnMucm9vdERpcmVjdG9yeSB8fCAnLyc7XG4gICAgICAgIGlmICghcGF0aC5zdGFydHNXaXRoKCcvJykpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignUm9vdCBkaXJlY3RvcnkgcGF0aCBtdXN0IHN0YXJ0IHdpdGggLycpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYENyZWF0aW5nIEVGUyBhY2Nlc3MgcG9pbnQgZm9yIHNlcnZpY2UgJHt0aGlzLmZhcmdhdGVDb25maWcuc2VydmljZU5hbWV9IHdpdGggcGF0aCAke3BhdGh9YCk7XG5cbiAgICAgICAgY29uc3QgYWNjZXNzUG9pbnQgPSBuZXcgQWNjZXNzUG9pbnQodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZmFyZ2F0ZUNvbmZpZy5zZXJ2aWNlTmFtZX0tYXBgLCB7XG4gICAgICAgICAgICBmaWxlU3lzdGVtLFxuICAgICAgICAgICAgcGF0aCxcbiAgICAgICAgICAgIHBvc2l4VXNlcjogdGhpcy5mYXJnYXRlQ29uZmlnLmVmcy5hY2Nlc3NQb2ludFByb3BzPy5wb3NpeFVzZXIgfHwge1xuICAgICAgICAgICAgICAgIHVpZDogJzEwMDAnLFxuICAgICAgICAgICAgICAgIGdpZDogJzEwMDAnXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgY3JlYXRlQWNsOiB0aGlzLmZhcmdhdGVDb25maWcuZWZzLmFjY2Vzc1BvaW50UHJvcHM/LmNyZWF0ZUFjbCB8fCB7XG4gICAgICAgICAgICAgICAgb3duZXJVaWQ6ICcxMDAwJyxcbiAgICAgICAgICAgICAgICBvd25lckdpZDogJzEwMDAnLFxuICAgICAgICAgICAgICAgIHBlcm1pc3Npb25zOiAnNzU1J1xuICAgICAgICAgICAgfSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYEFjY2VzcyBwb2ludCBjcmVhdGVkIHdpdGggSUQ6ICR7YWNjZXNzUG9pbnQuYWNjZXNzUG9pbnRJZH1gKTtcbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCAnZWZzLWFwJywgYWNjZXNzUG9pbnQsIE91dHB1dFR5cGUuRUZTKTtcblxuICAgICAgICByZXR1cm4gYWNjZXNzUG9pbnQ7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ29uZmlndXJlcyB0aGUgRUZTIHZvbHVtZSBmb3IgdGhlIHRhc2sgZGVmaW5pdGlvbi5cbiAgICAgKiBTZXRzIHVwIHRoZSB2b2x1bWUgY29uZmlndXJhdGlvbiB3aXRoIHRoZSBzcGVjaWZpZWQgYWNjZXNzIHBvaW50IGFuZCBtb3VudCBvcHRpb25zLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBmaWxlU3lzdGVtIC0gVGhlIEVGUyBmaWxlIHN5c3RlbSB0byBtb3VudFxuICAgICAqIEBwYXJhbSBhY2Nlc3NQb2ludCAtIFRoZSBhY2Nlc3MgcG9pbnQgdG8gdXNlIGZvciB0aGUgbW91bnRcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIHByaXZhdGUgY29uZmlndXJlRWZzVm9sdW1lKGZpbGVTeXN0ZW06IEZpbGVTeXN0ZW0sIGFjY2Vzc1BvaW50OiBBY2Nlc3NQb2ludCkge1xuICAgICAgICBpZiAoIXRoaXMuZmFyZ2F0ZUNvbmZpZy5lZnMpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGVmc0NvbmZpZyA9IHRoaXMuZmFyZ2F0ZUNvbmZpZy5lZnM7XG4gICAgICAgIGNvbnN0IGFjY2Vzc1BvaW50SWQgPSBhY2Nlc3NQb2ludC5hY2Nlc3NQb2ludElkO1xuXG4gICAgICAgIC8vIEFkZCBFRlMgdm9sdW1lIHRvIHRhc2sgZGVmaW5pdGlvblxuICAgICAgICBjb25zdCB2b2x1bWU6IFZvbHVtZSA9IHtcbiAgICAgICAgICAgIG5hbWU6ICdlZnMtdm9sdW1lJyxcbiAgICAgICAgICAgIGVmc1ZvbHVtZUNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICAgICAgICBmaWxlU3lzdGVtSWQ6IGZpbGVTeXN0ZW0uZmlsZVN5c3RlbUlkLFxuICAgICAgICAgICAgICAgIHRyYW5zaXRFbmNyeXB0aW9uOiAnRU5BQkxFRCcsXG4gICAgICAgICAgICAgICAgYXV0aG9yaXphdGlvbkNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICBhY2Nlc3NQb2ludElkLFxuICAgICAgICAgICAgICAgICAgICBpYW06ICdFTkFCTEVEJ1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcm9vdERpcmVjdG9yeTogJy8nXG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gQWRkIHZvbHVtZSB0byB0YXNrIGRlZmluaXRpb25cbiAgICAgICAgdGhpcy50YXNrRGVmaW5pdGlvbi5hZGRWb2x1bWUodm9sdW1lKTtcblxuICAgICAgICAvLyBNb3VudCB2b2x1bWUgaW4gY29udGFpbmVyXG4gICAgICAgIHRoaXMuY29udGFpbmVyLmFkZE1vdW50UG9pbnRzKHtcbiAgICAgICAgICAgIHNvdXJjZVZvbHVtZTogJ2Vmcy12b2x1bWUnLFxuICAgICAgICAgICAgY29udGFpbmVyUGF0aDogZWZzQ29uZmlnLmNvbnRhaW5lclBhdGgsXG4gICAgICAgICAgICByZWFkT25seTogZmFsc2VcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ29uZmlndXJlcyB0aGUgcm9vdCB2b2x1bWUgZm9yIHRoZSB0YXNrIGRlZmluaXRpb24uXG4gICAgICogU2V0cyB1cCBlcGhlbWVyYWwgc3RvcmFnZSB3aXRoIHRoZSBzcGVjaWZpZWQgc2l6ZSBhbmQgY29uZmlndXJhdGlvbi5cbiAgICAgKiBcbiAgICAgKiBAcGFyYW0gdGFza0RlZmluaXRpb24gLSBUaGUgdGFzayBkZWZpbml0aW9uIHRvIGNvbmZpZ3VyZSB0aGUgcm9vdCB2b2x1bWUgZm9yXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBwcml2YXRlIGNvbmZpZ3VyZVJvb3RWb2x1bWUodGFza0RlZmluaXRpb246IEZhcmdhdGVUYXNrRGVmaW5pdGlvbikge1xuICAgICAgICBjb25zdCByb290Vm9sdW1lQ29uZmlnID0gdGhpcy5mYXJnYXRlQ29uZmlnLnJvb3RWb2x1bWU7XG4gICAgICAgIGlmIChyb290Vm9sdW1lQ29uZmlnPy5zaXplR2lCKSB7XG4gICAgICAgICAgICB0YXNrRGVmaW5pdGlvbi5hZGRWb2x1bWUoe1xuICAgICAgICAgICAgICAgIG5hbWU6ICdyb290JyxcbiAgICAgICAgICAgICAgICBkb2NrZXJWb2x1bWVDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICAgICAgICAgIHNjb3BlOiBTY29wZS5TSEFSRUQsXG4gICAgICAgICAgICAgICAgICAgIGF1dG9wcm92aXNpb246IHRydWUsXG4gICAgICAgICAgICAgICAgICAgIGRyaXZlcjogJ2xvY2FsJyxcbiAgICAgICAgICAgICAgICAgICAgZHJpdmVyT3B0czoge1xuICAgICAgICAgICAgICAgICAgICAgICAgJ3R5cGUnOiAnZ3AyJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICdzaXplJzogcm9vdFZvbHVtZUNvbmZpZy5zaXplR2lCLnRvU3RyaW5nKClcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxufSAiXX0=
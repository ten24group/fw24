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
    getDefaultDeviceName(index) {
        const deviceSuffixes = ['f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p'];
        const suffix = deviceSuffixes[index] || String.fromCharCode(102 + index); // 102 is 'f' in ASCII
        return `/dev/sd${suffix}`;
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
        const volumeSetup = this.buildVolumeUserData();
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

${volumeSetup}

# -------- Run container (logs go to CloudWatch via awslogs driver) --------
docker rm -f ${containerName} >/dev/null 2>&1 || true
${dockerRunCmd}
`;
    }
    buildVolumeUserData() {
        const volumeConfigs = this.ec2Config.volumes || [];
        const setupCalls = volumeConfigs
            .map((volumeConfig, index) => {
            if (!volumeConfig.mountPoint)
                return '';
            const deviceName = volumeConfig.deviceName || this.getDefaultDeviceName(index);
            const fileSystem = volumeConfig.fileSystem || 'ext4';
            const volumeId = volumeConfig.volumeId || '';
            return `setup_volume "${deviceName}" "${volumeConfig.mountPoint}" "${fileSystem}" "${volumeId}"`;
        })
            .filter(line => line)
            .join('\n');
        if (!setupCalls)
            return '';
        return `# -------- EBS volume setup --------
setup_volume() {
  local device="$1"
  local mount_point="$2"
  local fs_type="$3"
  local volume_id="$4"

  for i in $(seq 1 30); do
    if [ -n "$volume_id" ]; then
      volume_id_clean="\${volume_id//-/}"
      if [ -e "/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_\${volume_id_clean}" ]; then
        device="/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_\${volume_id_clean}"
        break
      fi
    fi

    if [ -e "$device" ]; then
      break
    fi

    if [ -e /dev/nvme1n1 ] && [ "$device" != "/dev/nvme1n1" ]; then
      device="/dev/nvme1n1"
      break
    fi

    alt=$(lsblk -dpno NAME,TYPE | awk '$2=="disk"{print $1}' | grep -v /dev/nvme0n1 | head -n 1 || true)
    if [ -n "$alt" ]; then
      device="$alt"
      break
    fi

    echo "Waiting for volume $device to be attached... ($i/30)"
    sleep 2
  done

  if [ ! -e "$device" ]; then
    echo "ERROR: Volume device not found for $mount_point"
    exit 1
  fi

  if ! blkid "$device" > /dev/null 2>&1; then
    echo "Formatting volume $device as $fs_type..."
    mkfs -t "$fs_type" -F "$device"
  else
    echo "Volume $device is already formatted"
  fi

  mkdir -p "$mount_point"
  echo "Mounting $device to $mount_point..."
  mount "$device" "$mount_point"

  chown -R ec2-user:ec2-user "$mount_point"
  chmod -R 755 "$mount_point"

  if ! grep -q "$mount_point" /etc/fstab; then
    UUID=$(blkid -s UUID -o value "$device" || true)
    if [ -n "$UUID" ]; then
      echo "UUID=$UUID $mount_point $fs_type defaults,nofail 0 2" >> /etc/fstab
    else
      echo "$device $mount_point $fs_type defaults,nofail 0 2" >> /etc/fstab
    fi
  fi

  echo "Volume mounted successfully at $mount_point"
}

${setupCalls}
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
        const volumeAttachments = [];
        if (this.ec2Config.volumes) {
            this.ec2Config.volumes.forEach((volumeConfig, index) => {
                // Generate device name if not provided
                const deviceName = volumeConfig.deviceName || this.getDefaultDeviceName(index);
                // Attach existing volume by ID (do not create a new one)
                if (volumeConfig.volumeId) {
                    volumeAttachments.push({
                        deviceName,
                        volumeId: volumeConfig.volumeId
                    });
                    return;
                }
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
                        deleteOnTermination: volumeConfig.deleteOnTermination ?? false,
                    });
                }
                // Error if neither is provided
                else {
                    throw new Error(`Volume configuration for device ${deviceName} must specify either 'volumeId', 'volume', or 'sizeGiB'`);
                }
                blockDevices.push({
                    deviceName,
                    volume
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
        // Attach existing EBS volumes (must be in the same AZ as the instance)
        if (volumeAttachments.length > 0) {
            volumeAttachments.forEach((attachment, index) => {
                new aws_ec2_1.CfnVolumeAttachment(this.mainStack, `${this.ec2Config.instanceName}-volume-attachment-${index}`, {
                    instanceId: this.instance.instanceId,
                    volumeId: attachment.volumeId,
                    device: attachment.deviceName
                });
            });
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWMyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvZWMyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLDZDQUE2RDtBQUM3RCxpREEwQjZCO0FBQzdCLCtEQUFxRjtBQUNyRixpREFBNkY7QUFDN0YsMkVBQStGO0FBQy9GLDJDQUE2QjtBQUM3QiwrREFBc0Q7QUFFdEQsMkNBQXdDO0FBQ3hDLHVDQUFvQztBQUNwQyx1REFBeUY7QUFFekYsd0NBQXVEO0FBQ3ZELCtCQUFxQztBQXdTckMsTUFBYSxZQUFZO0lBbUJEO0lBbEJYLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3pDLElBQUksR0FBUyxXQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7SUFFekMsSUFBSSxHQUFXLFlBQVksQ0FBQyxJQUFJLENBQUM7SUFDakMsWUFBWSxHQUFhLENBQUMsa0JBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUM3QyxNQUFNLENBQXVCO0lBRTdCLFNBQVMsQ0FBUztJQUNWLFFBQVEsQ0FBWTtJQUNwQixHQUFHLENBQVE7SUFDWCxlQUFlLENBQVc7SUFFbEM7Ozs7O09BS0c7SUFDSCxZQUFvQixTQUE4QjtRQUE5QixjQUFTLEdBQVQsU0FBUyxDQUFxQjtRQUM5QyxlQUFNLENBQUMsYUFBYSxDQUFDLFNBQVMsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV2QyxxREFBcUQ7UUFDckQsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDaEMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxhQUFhLEdBQUcsRUFBRSxDQUFDO1FBQ3RDLENBQUM7SUFDTCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0ssa0JBQWtCO1FBQ3RCLE1BQU0sSUFBSSxHQUFHLElBQUksY0FBSSxDQUFDLElB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UztZQUMvQyxHQUFHLEVBQUUsSUFBSSxDQUFDLEdBQUc7U0FDaEIsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLGVBQWUsR0FBRyxJQUFJLDhCQUFPLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsWUFBWSxVQUFVLEVBQUU7WUFDekYsU0FBUyxFQUFFLFNBQVM7WUFDcEIsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsZ0JBQWdCLENBQUMsV0FBVztZQUNqRCxhQUFhLEVBQUUsb0NBQWEsQ0FBQyxDQUFDO1lBQzlCLE1BQU0sRUFBRSxzQkFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7U0FDL0IsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLEVBQUUsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLFlBQVksWUFBWSxFQUFFLElBQUksQ0FBQyxlQUFlLEVBQUUsc0JBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO0lBQ3ZJLENBQUM7Q0FFSjtBQXBoQkQsb0NBb2hCQztBQWhPZ0I7SUFEWixJQUFBLHFCQUFXLEdBQUU7NkNBc0hiIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU3RhY2ssIFJlbW92YWxQb2xpY3ksIER1cmF0aW9uIH0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQge1xuICAgIFZwYyxcbiAgICBJbnN0YW5jZSxcbiAgICBJbnN0YW5jZVR5cGUsXG4gICAgSW5zdGFuY2VDbGFzcyxcbiAgICBJbnN0YW5jZVNpemUsXG4gICAgTWFjaGluZUltYWdlLFxuICAgIFNlY3VyaXR5R3JvdXAsXG4gICAgU2VjdXJpdHlHcm91cFByb3BzLFxuICAgIFBvcnQsXG4gICAgU3VibmV0VHlwZSxcbiAgICBJU2VjdXJpdHlHcm91cCxcbiAgICBQZWVyLFxuICAgIElWcGMsXG4gICAgSVN1Ym5ldCxcbiAgICBTdWJuZXQsXG4gICAgVXNlckRhdGEsXG4gICAgVm9sdW1lLFxuICAgIEJsb2NrRGV2aWNlVm9sdW1lLFxuICAgIENmblZvbHVtZUF0dGFjaG1lbnQsXG4gICAgRWJzRGV2aWNlVm9sdW1lVHlwZSxcbiAgICBJVm9sdW1lLFxuICAgIEFtYXpvbkxpbnV4Q3B1VHlwZSxcbiAgICBBbWF6b25MaW51eEdlbmVyYXRpb24sXG4gICAgQW1hem9uTGludXhJbWFnZSxcbiAgICBJbnN0YW5jZVByb3BzXG59IGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0IHsgRG9ja2VySW1hZ2VBc3NldCwgRG9ja2VySW1hZ2VBc3NldFByb3BzIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1lY3ItYXNzZXRzXCI7XG5pbXBvcnQgeyBQb2xpY3lTdGF0ZW1lbnQsIE1hbmFnZWRQb2xpY3ksIFJvbGUsIFNlcnZpY2VQcmluY2lwYWwgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCB7IFByaXZhdGVEbnNOYW1lc3BhY2UsIFNlcnZpY2UsIERuc1JlY29yZFR5cGUgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VydmljZWRpc2NvdmVyeSc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHsgUGxhdGZvcm0gfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWVjci1hc3NldHNcIjtcblxuaW1wb3J0IHsgSGVscGVyIH0gZnJvbSBcIi4uL2NvcmUvaGVscGVyXCI7XG5pbXBvcnQgeyBGdzI0IH0gZnJvbSBcIi4uL2NvcmUvZncyNFwiO1xuaW1wb3J0IHsgRlcyNENvbnN0cnVjdCwgRlcyNENvbnN0cnVjdE91dHB1dCwgT3V0cHV0VHlwZSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdFwiO1xuaW1wb3J0IHsgSUNvbnN0cnVjdENvbmZpZyB9IGZyb20gXCIuLi9pbnRlcmZhY2VzL2NvbnN0cnVjdC1jb25maWdcIjtcbmltcG9ydCB7IExvZ0R1cmF0aW9uLCBjcmVhdGVMb2dnZXIgfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgVnBjQ29uc3RydWN0IH0gZnJvbSBcIi4vdnBjXCI7XG5cbi8qKlxuICogRXhhbXBsZXMgb2YgdXNpbmcgdGhlIEVDMiBDb25zdHJ1Y3RcbiAqIFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEV4YW1wbGUgMTogQmFzaWMgRUMyIGluc3RhbmNlIHdpdGggRG9ja2VyIGNvbnRhaW5lclxuICogY29uc3QgZWMySW5zdGFuY2UgPSBuZXcgRWMyQ29uc3RydWN0KHtcbiAqICAgaW5zdGFuY2VOYW1lOiAnbXktYXBwJyxcbiAqICAgdnBjTmFtZTogJ21haW4tdnBjJyxcbiAqICAgY29udGFpbmVyOiB7XG4gKiAgICAgZG9ja2VyRmlsZVBhdGg6ICcuL3NyYy9hcHAvRG9ja2VyZmlsZScsXG4gKiAgICAgY29udGFpbmVyUG9ydDogMzAwMCxcbiAqICAgICBlbnZpcm9ubWVudDoge1xuICogICAgICAgTk9ERV9FTlY6ICdwcm9kdWN0aW9uJyxcbiAqICAgICAgIEFQSV9WRVJTSU9OOiAndjEnXG4gKiAgICAgfVxuICogICB9LFxuICogICBpbnN0YW5jZVByb3BzOiB7XG4gKiAgICAgaW5zdGFuY2VUeXBlOiBJbnN0YW5jZVR5cGUub2YoSW5zdGFuY2VDbGFzcy5UMywgSW5zdGFuY2VTaXplLk1FRElVTSksXG4gKiAgIH0sXG4gKiAgIHZvbHVtZXM6IFt7XG4gKiAgICAgc2l6ZUdpQjogMjAsXG4gKiAgICAgbW91bnRQb2ludDogJy9kYXRhJyAvLyBTaW1wbGlmaWVkOiBhdXRvLWdlbmVyYXRlcyBkZXZpY2UgbmFtZSBhbmQgbW91bnRzIGJlZm9yZSBjb250YWluZXIgc3RhcnRzXG4gKiAgIH1dXG4gKiAgIC8vIE9yIHNwZWNpZnkgZGV2aWNlIG5hbWUgZXhwbGljaXRseTpcbiAqICAgLy8gdm9sdW1lczogW3tcbiAqICAgLy8gICBkZXZpY2VOYW1lOiAnL2Rldi9zZGYnLFxuICogICAvLyAgIHNpemVHaUI6IDIwLFxuICogICAvLyAgIG1vdW50UG9pbnQ6ICcvZGF0YSdcbiAqICAgLy8gfV1cbiAqICAgLy8gT3IgdXNlIGZ1bGwgY29uZmlndXJhdGlvbjpcbiAqICAgLy8gdm9sdW1lczogW3tcbiAqICAgLy8gICBkZXZpY2VOYW1lOiAnL2Rldi9zZGYnLFxuICogICAvLyAgIHZvbHVtZTogQmxvY2tEZXZpY2VWb2x1bWUuZWJzKDIwLCB7XG4gKiAgIC8vICAgICB2b2x1bWVUeXBlOiBFYnNEZXZpY2VWb2x1bWVUeXBlLkdQMyxcbiAqICAgLy8gICAgIGVuY3J5cHRlZDogdHJ1ZVxuICogICAvLyAgIH0pLFxuICogICAvLyAgIG1vdW50UG9pbnQ6ICcvZGF0YSdcbiAqICAgLy8gfV1cbiAqIH0pO1xuICogXG4gKiAvLyBFeGFtcGxlIDI6IEVDMiBpbnN0YW5jZSB3aXRoIGN1c3RvbSBzdWJuZXQgYW5kIHNlY3VyaXR5IGdyb3VwXG4gKiBjb25zdCBjdXN0b21JbnN0YW5jZSA9IG5ldyBFYzJDb25zdHJ1Y3Qoe1xuICogICBpbnN0YW5jZU5hbWU6ICd3b3JrZXInLFxuICogICB2cGNOYW1lOiAnbWFpbi12cGMnLFxuICogICBzdWJuZXQ6IHtcbiAqICAgICBzdWJuZXRJZDogJ3N1Ym5ldC0xMjM0NSdcbiAqICAgfSxcbiAqICAgc2VjdXJpdHlHcm91cDoge1xuICogICAgIHNlY3VyaXR5R3JvdXBJZDogJ3NnLWV4aXN0aW5nJ1xuICogICB9LFxuICogICBjb250YWluZXI6IHtcbiAqICAgICBkb2NrZXJGaWxlUGF0aDogJy4vc3JjL3dvcmtlci9Eb2NrZXJmaWxlJyxcbiAqICAgICBjb250YWluZXJQb3J0OiA4MDgwLFxuICogICAgIGVudmlyb25tZW50OiB7XG4gKiAgICAgICBRVUVVRV9VUkw6ICdodHRwczovL3Nxcy5yZWdpb24uYW1hem9uYXdzLmNvbS9hY2NvdW50L3F1ZXVlJ1xuICogICAgIH0sXG4gKiAgICAgY29tbWFuZDogWyducG0nLCAnc3RhcnQnXVxuICogICB9LFxuICogICBpbnN0YW5jZVByb3BzOiB7XG4gKiAgICAgaW5zdGFuY2VUeXBlOiBJbnN0YW5jZVR5cGUub2YoSW5zdGFuY2VDbGFzcy5UMywgSW5zdGFuY2VTaXplLkxBUkdFKSxcbiAqICAgICB1c2VyRGF0YTogVXNlckRhdGEuY3VzdG9tKCcjIEN1c3RvbSB1c2VyIGRhdGEgc2NyaXB0JylcbiAqICAgfSxcbiAqICAgdm9sdW1lczogW3tcbiAqICAgICBkZXZpY2VOYW1lOiAnL2Rldi9zZGYnLFxuICogICAgIHZvbHVtZTogQmxvY2tEZXZpY2VWb2x1bWUuZWJzKDEwMCwge1xuICogICAgICAgdm9sdW1lVHlwZTogRWJzRGV2aWNlVm9sdW1lVHlwZS5JTzEsXG4gKiAgICAgICBpb3BzOiAzMDAwLFxuICogICAgICAgZW5jcnlwdGVkOiB0cnVlXG4gKiAgICAgfSksXG4gKiAgICAgbW91bnRQb2ludDogJy9kYXRhJ1xuICogICB9XVxuICogfSk7XG4gKiBcbiAqIC8vIEV4YW1wbGUgMzogRUMyIGluc3RhbmNlIGluIHByaXZhdGUgc3VibmV0IHdpdGggZXhpc3RpbmcgVlBDXG4gKiBjb25zdCBwcml2YXRlSW5zdGFuY2UgPSBuZXcgRWMyQ29uc3RydWN0KHtcbiAqICAgaW5zdGFuY2VOYW1lOiAnaW50ZXJuYWwtc2VydmljZScsXG4gKiAgIHZwYzogZXhpc3RpbmdWcGMsXG4gKiAgIHN1Ym5ldENvbmZpZzoge1xuICogICAgIHN1Ym5ldFR5cGU6IFN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTU1xuICogICB9LFxuICogICBjb250YWluZXI6IHtcbiAqICAgICBkb2NrZXJGaWxlUGF0aDogJy4vc3JjL2ludGVybmFsL0RvY2tlcmZpbGUnLFxuICogICAgIGNvbnRhaW5lclBvcnQ6IDkwMDBcbiAqICAgfSxcbiAqICAgaW5zdGFuY2VQcm9wczoge1xuICogICAgIGluc3RhbmNlVHlwZTogSW5zdGFuY2VUeXBlLm9mKEluc3RhbmNlQ2xhc3MuVDMsIEluc3RhbmNlU2l6ZS5TTUFMTCksXG4gKiAgIH1cbiAqIH0pO1xuICogXG4gKiAvLyBBZGQgdG8geW91ciBhcHBsaWNhdGlvblxuICogY29uc3QgYXBwID0gbmV3IEFwcGxpY2F0aW9uKClcbiAqICAgLnVzZShlYzJJbnN0YW5jZSlcbiAqICAgLnVzZShjdXN0b21JbnN0YW5jZSlcbiAqICAgLnVzZShwcml2YXRlSW5zdGFuY2UpXG4gKiAgIC5ydW4oKTtcbiAqIGBgYFxuICovXG5cbmV4cG9ydCBpbnRlcmZhY2UgSUVjMkNvbnRhaW5lckNvbmZpZyB7XG4gICAgLyoqXG4gICAgICogUGF0aCB0byB0aGUgRG9ja2VyZmlsZVxuICAgICAqL1xuICAgIGRvY2tlckZpbGVQYXRoOiBzdHJpbmc7XG4gICAgLyoqXG4gICAgICogQ29udGFpbmVyIHBvcnQgdG8gZXhwb3NlXG4gICAgICovXG4gICAgY29udGFpbmVyUG9ydDogbnVtYmVyO1xuICAgIC8qKlxuICAgICAqIEVudmlyb25tZW50IHZhcmlhYmxlcyB0byBwYXNzIHRvIHRoZSBjb250YWluZXJcbiAgICAgKi9cbiAgICBlbnZpcm9ubWVudD86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gICAgLyoqXG4gICAgICogRG9ja2VyIGNvbW1hbmQgdG8gcnVuIChvcHRpb25hbClcbiAgICAgKi9cbiAgICBjb21tYW5kPzogc3RyaW5nW107XG4gICAgLyoqXG4gICAgICogRG9ja2VyIGNvbnRhaW5lciBuYW1lIChvcHRpb25hbClcbiAgICAgKi9cbiAgICBjb250YWluZXJOYW1lPzogc3RyaW5nO1xuICAgIC8qKlxuICAgICAqIEFkZGl0aW9uYWwgZG9ja2VyIHJ1biBvcHRpb25zIChvcHRpb25hbClcbiAgICAgKi9cbiAgICBkb2NrZXJSdW5PcHRpb25zPzogc3RyaW5nW107XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSUVjMlNlY3VyaXR5R3JvdXBDb25maWcge1xuICAgIC8qKlxuICAgICAqIElEIG9mIGFuIGV4aXN0aW5nIHNlY3VyaXR5IGdyb3VwIHRvIHVzZVxuICAgICAqL1xuICAgIHNlY3VyaXR5R3JvdXBJZD86IHN0cmluZztcbiAgICAvKipcbiAgICAgKiBQcm9wZXJ0aWVzIGZvciBjcmVhdGluZyBhIG5ldyBzZWN1cml0eSBncm91cFxuICAgICAqL1xuICAgIHByb3BzPzogU2VjdXJpdHlHcm91cFByb3BzO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIElFYzJTdWJuZXRDb25maWcge1xuICAgIC8qKlxuICAgICAqIElEIG9mIGFuIGV4aXN0aW5nIHN1Ym5ldCB0byB1c2VcbiAgICAgKi9cbiAgICBzdWJuZXRJZD86IHN0cmluZztcbiAgICAvKipcbiAgICAgKiBTdWJuZXQgdHlwZSB0byB1c2UgKGlmIG5vdCB1c2luZyBleGlzdGluZyBzdWJuZXQpXG4gICAgICovXG4gICAgc3VibmV0VHlwZT86IFN1Ym5ldFR5cGU7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSUVjMlZvbHVtZUNvbmZpZyB7XG4gICAgLyoqXG4gICAgICogRGV2aWNlIG5hbWUgZm9yIHRoZSB2b2x1bWUgKGUuZy4sICcvZGV2L3NkZicpXG4gICAgICogSWYgbm90IHNwZWNpZmllZCwgd2lsbCBiZSBhdXRvLWdlbmVyYXRlZCBzdGFydGluZyBmcm9tICcvZGV2L3NkZidcbiAgICAgKi9cbiAgICBkZXZpY2VOYW1lPzogc3RyaW5nO1xuICAgIC8qKlxuICAgICAqIEJsb2NrIGRldmljZSB2b2x1bWUgY29uZmlndXJhdGlvbiAob3B0aW9uYWwgaWYgc2l6ZSBpcyBzcGVjaWZpZWQpXG4gICAgICovXG4gICAgdm9sdW1lPzogQmxvY2tEZXZpY2VWb2x1bWU7XG4gICAgLyoqXG4gICAgICogRXhpc3RpbmcgRUJTIHZvbHVtZSBJRCB0byBhdHRhY2ggKG9wdGlvbmFsKVxuICAgICAqIElmIHByb3ZpZGVkLCB0aGUgdm9sdW1lIHdpbGwgYmUgYXR0YWNoZWQgYW5kIG5vdCBjcmVhdGVkIGJ5IHRoZSBpbnN0YW5jZS5cbiAgICAgKi9cbiAgICB2b2x1bWVJZD86IHN0cmluZztcbiAgICAvKipcbiAgICAgKiBWb2x1bWUgc2l6ZSBpbiBHaUIgKG9wdGlvbmFsIGlmIHZvbHVtZSBpcyBzcGVjaWZpZWQpXG4gICAgICogSWYgb25seSBzaXplIGlzIHNwZWNpZmllZCwgZGVmYXVsdHMgdG8gR1AzIHZvbHVtZSB0eXBlIHdpdGggc3RhbmRhcmQgc2V0dGluZ3NcbiAgICAgKi9cbiAgICBzaXplR2lCPzogbnVtYmVyO1xuICAgIC8qKlxuICAgICAqIE1vdW50IHBvaW50IGZvciB0aGUgdm9sdW1lIChvcHRpb25hbCkuIFdoZW4gcHJvdmlkZWQsIHRoZSBjb25zdHJ1Y3Qgd2lsbFxuICAgICAqIGZvcm1hdCAoaWYgbmVlZGVkKSBhbmQgbW91bnQgYmVmb3JlIHRoZSBjb250YWluZXIgc3RhcnRzLlxuICAgICAqL1xuICAgIG1vdW50UG9pbnQ/OiBzdHJpbmc7XG4gICAgLyoqXG4gICAgICogRmlsZXN5c3RlbSB0eXBlIHRvIHVzZSB3aGVuIGZvcm1hdHRpbmcgKGRlZmF1bHRzIHRvICdleHQ0JylcbiAgICAgKi9cbiAgICBmaWxlU3lzdGVtPzogc3RyaW5nO1xuICAgIC8qKlxuICAgICAqIFdoZXRoZXIgdG8gZGVsZXRlIHRoZSB2b2x1bWUgb24gaW5zdGFuY2UgdGVybWluYXRpb24gKG9ubHkgYXBwbGllcyB0byBjcmVhdGVkIHZvbHVtZXMpXG4gICAgICogRGVmYXVsdHMgdG8gZmFsc2UuXG4gICAgICovXG4gICAgZGVsZXRlT25UZXJtaW5hdGlvbj86IGJvb2xlYW47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSUVjMlNlcnZpY2VEaXNjb3ZlcnlDb25maWcge1xuICAgIC8qKlxuICAgICAqIE5hbWUgZm9yIHRoZSBzZXJ2aWNlIGluIHNlcnZpY2UgZGlzY292ZXJ5XG4gICAgICovXG4gICAgc2VydmljZU5hbWU6IHN0cmluZztcbiAgICAvKipcbiAgICAgKiBOYW1lc3BhY2UgZm9yIHNlcnZpY2UgZGlzY292ZXJ5XG4gICAgICovXG4gICAgbmFtZXNwYWNlOiBzdHJpbmc7XG59XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBmb3IgSUFNIHJvbGUgcG9saWNpZXNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJRWMyUm9sZVBvbGljeUNvbmZpZyB7XG4gICAgLyoqXG4gICAgICogTGlzdCBvZiBtYW5hZ2VkIHBvbGljeSBBUk5zIHRvIGF0dGFjaCB0byB0aGUgcm9sZVxuICAgICAqL1xuICAgIG1hbmFnZWRQb2xpY3lBcm5zPzogc3RyaW5nW107XG5cbiAgICAvKipcbiAgICAgKiBMaXN0IG9mIG1hbmFnZWQgcG9saWNpZXMgdG8gYXR0YWNoIHRvIHRoZSByb2xlXG4gICAgICovXG4gICAgbWFuYWdlZFBvbGljaWVzPzogTWFuYWdlZFBvbGljeVtdO1xuXG4gICAgLyoqXG4gICAgICogTGlzdCBvZiBpbmxpbmUgcG9saWN5IHN0YXRlbWVudHMgdG8gYWRkIHRvIHRoZSByb2xlXG4gICAgICovXG4gICAgaW5saW5lUG9saWNpZXM/OiBQb2xpY3lTdGF0ZW1lbnRbXTtcbn1cblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciBpbnN0YW5jZSByb2xlc1xuICovXG5leHBvcnQgaW50ZXJmYWNlIElFYzJJbnN0YW5jZVJvbGVDb25maWcgZXh0ZW5kcyBJRWMyUm9sZVBvbGljeUNvbmZpZyB7XG4gICAgLyoqXG4gICAgICogQ3VzdG9tIHJvbGUgbmFtZVxuICAgICAqL1xuICAgIHJvbGVOYW1lPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gZm9yIHRoZSBFQzIgY29uc3RydWN0XG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSUVjMkNvbnN0cnVjdENvbmZpZyBleHRlbmRzIElDb25zdHJ1Y3RDb25maWcge1xuICAgIC8qKlxuICAgICAqIE5hbWUgb2YgdGhlIEVDMiBpbnN0YW5jZVxuICAgICAqL1xuICAgIGluc3RhbmNlTmFtZTogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogQ29udGFpbmVyIGNvbmZpZ3VyYXRpb25cbiAgICAgKi9cbiAgICBjb250YWluZXI6IElFYzJDb250YWluZXJDb25maWc7XG5cbiAgICAvKipcbiAgICAgKiBWUEMgTmFtZSB0byB1c2UgKG11c3QgZXhpc3QpXG4gICAgICogQGV4YW1wbGUgJ21haW4tdnBjJ1xuICAgICAqL1xuICAgIHZwY05hbWU/OiBzdHJpbmc7XG5cbiAgICAvKipcbiAgICAgKiBWUEMgaW5zdGFuY2UgdG8gdXNlIChpZiBub3QgdXNpbmcgdnBjTmFtZSlcbiAgICAgKi9cbiAgICB2cGM/OiBWcGM7XG5cbiAgICAvKipcbiAgICAgKiBTdWJuZXQgY29uZmlndXJhdGlvblxuICAgICAqL1xuICAgIHN1Ym5ldD86IElFYzJTdWJuZXRDb25maWc7XG5cbiAgICAvKipcbiAgICAgKiBTdWJuZXQgdHlwZSBjb25maWd1cmF0aW9uIChzaW1wbGlmaWVkKVxuICAgICAqL1xuICAgIHN1Ym5ldENvbmZpZz86IHtcbiAgICAgICAgc3VibmV0VHlwZTogU3VibmV0VHlwZTtcbiAgICB9O1xuXG4gICAgLyoqXG4gICAgICogU2VjdXJpdHkgZ3JvdXAgY29uZmlndXJhdGlvblxuICAgICAqL1xuICAgIHNlY3VyaXR5R3JvdXA/OiBJRWMyU2VjdXJpdHlHcm91cENvbmZpZztcblxuICAgIC8qKlxuICAgICAqIElBTSBpbnN0YW5jZSByb2xlIGNvbmZpZ3VyYXRpb25cbiAgICAgKi9cbiAgICBpbnN0YW5jZVJvbGU/OiBJRWMySW5zdGFuY2VSb2xlQ29uZmlnO1xuXG4gICAgLyoqXG4gICAgICogRUJTIHZvbHVtZSBjb25maWd1cmF0aW9uc1xuICAgICAqL1xuICAgIHZvbHVtZXM/OiBJRWMyVm9sdW1lQ29uZmlnW107XG5cbiAgICAvKipcbiAgICAgKiBTZXJ2aWNlIGRpc2NvdmVyeSBjb25maWd1cmF0aW9uIChmb3IgaW50ZXJuYWwgRE5TIHJlc29sdXRpb24pXG4gICAgICovXG4gICAgc2VydmljZURpc2NvdmVyeT86IElFYzJTZXJ2aWNlRGlzY292ZXJ5Q29uZmlnO1xuXG4gICAgLyoqXG4gICAgICogQ0RLIEluc3RhbmNlIGNvbnN0cnVjdCBwcm9wZXJ0aWVzXG4gICAgICogVGhlc2UgcHJvcGVydGllcyB3aWxsIGJlIG1lcmdlZCB3aXRoIG91ciBkZWZhdWx0IGNvbmZpZ3VyYXRpb25cbiAgICAgKi9cbiAgICBpbnN0YW5jZVByb3BzPzogUGFydGlhbDxJbnN0YW5jZVByb3BzPjtcblxuICAgIC8qKlxuICAgICAqIERvY2tlciBpbWFnZSBwcm9wZXJ0aWVzXG4gICAgICovXG4gICAgZG9ja2VySW1hZ2VQcm9wcz86IFBhcnRpYWw8RG9ja2VySW1hZ2VBc3NldFByb3BzPjtcbn1cblxuZXhwb3J0IGNsYXNzIEVjMkNvbnN0cnVjdCBpbXBsZW1lbnRzIEZXMjRDb25zdHJ1Y3Qge1xuICAgIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcihFYzJDb25zdHJ1Y3QubmFtZSk7XG4gICAgcmVhZG9ubHkgZncyNDogRncyNCA9IEZ3MjQuZ2V0SW5zdGFuY2UoKTtcbiAgICBcbiAgICBuYW1lOiBzdHJpbmcgPSBFYzJDb25zdHJ1Y3QubmFtZTtcbiAgICBkZXBlbmRlbmNpZXM6IHN0cmluZ1tdID0gW1ZwY0NvbnN0cnVjdC5uYW1lXTtcbiAgICBvdXRwdXQhOiBGVzI0Q29uc3RydWN0T3V0cHV0O1xuXG4gICAgbWFpblN0YWNrITogU3RhY2s7XG4gICAgcHJpdmF0ZSBpbnN0YW5jZSE6IEluc3RhbmNlO1xuICAgIHByaXZhdGUgdnBjITogSVZwYztcbiAgICBwcml2YXRlIGNsb3VkTWFwU2VydmljZSE6IFNlcnZpY2U7XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIGEgbmV3IEVDMiBjb25zdHJ1Y3Qgd2l0aCB0aGUgc3BlY2lmaWVkIGNvbmZpZ3VyYXRpb24uXG4gICAgICogSW5pdGlhbGl6ZXMgZGVmYXVsdCB2YWx1ZXMgYW5kIG1lcmdlcyB1c2VyLXByb3ZpZGVkIGNvbmZpZ3VyYXRpb24uXG4gICAgICogXG4gICAgICogQHBhcmFtIGVjMkNvbmZpZyAtIFRoZSBjb25maWd1cmF0aW9uIG9iamVjdCBmb3IgdGhlIEVDMiBpbnN0YW5jZVxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgZWMyQ29uZmlnOiBJRWMyQ29uc3RydWN0Q29uZmlnKSB7XG4gICAgICAgIEhlbHBlci5oeWRyYXRlQ29uZmlnKGVjMkNvbmZpZywgJ0VDMicpO1xuXG4gICAgICAgIC8vIFNldCBkZWZhdWx0IGluc3RhbmNlIGNvbmZpZ3VyYXRpb24gaWYgbm90IHByb3ZpZGVkXG4gICAgICAgIGlmICghdGhpcy5lYzJDb25maWcuaW5zdGFuY2VQcm9wcykge1xuICAgICAgICAgICAgdGhpcy5lYzJDb25maWcuaW5zdGFuY2VQcm9wcyA9IHt9O1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhbiBJQU0gaW5zdGFuY2Ugcm9sZSBmb3IgdGhlIEVDMiBpbnN0YW5jZSB3aXRoIHNwZWNpZmllZCBwZXJtaXNzaW9ucy5cbiAgICAgKiBUaGlzIHJvbGUgZGVmaW5lcyB3aGF0IEFXUyBzZXJ2aWNlcyB0aGUgaW5zdGFuY2UgY2FuIGFjY2Vzcy5cbiAgICAgKiBcbiAgICAgKiBAcmV0dXJucyBUaGUgY3JlYXRlZCBJQU0gUm9sZSBpbnN0YW5jZSB3aXRoIGNvbmZpZ3VyZWQgcGVybWlzc2lvbnNcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIHByaXZhdGUgY3JlYXRlSW5zdGFuY2VSb2xlKCk6IFJvbGUge1xuICAgICAgICBjb25zdCByb2xlID0gbmV3IFJvbGUodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZWMyQ29uZmlnLmluc3RhbmNlTmFtZX0taW5zdGFuY2Utcm9sZWAsIHtcbiAgICAgICAgICAgIHJvbGVOYW1lOiB0aGlzLmVjMkNvbmZpZy5pbnN0YW5jZVJvbGU/LnJvbGVOYW1lLFxuICAgICAgICAgICAgYXNzdW1lZEJ5OiBuZXcgU2VydmljZVByaW5jaXBhbCgnZWMyLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBgSW5zdGFuY2Ugcm9sZSBmb3IgJHt0aGlzLmVjMkNvbmZpZy5pbnN0YW5jZU5hbWV9IEVDMiBpbnN0YW5jZWAsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmICh0aGlzLmVjMkNvbmZpZy5pbnN0YW5jZVJvbGUpIHtcbiAgICAgICAgICAgIC8vIEF0dGFjaCBtYW5hZ2VkIHBvbGljaWVzIGJ5IEFSTlxuICAgICAgICAgICAgdGhpcy5lYzJDb25maWcuaW5zdGFuY2VSb2xlLm1hbmFnZWRQb2xpY3lBcm5zPy5mb3JFYWNoKChwb2xpY3lBcm4sIGluZGV4KSA9PiB7XG4gICAgICAgICAgICAgICAgcm9sZS5hZGRNYW5hZ2VkUG9saWN5KE1hbmFnZWRQb2xpY3kuZnJvbU1hbmFnZWRQb2xpY3lBcm4oXG4gICAgICAgICAgICAgICAgICAgIHRoaXMubWFpblN0YWNrLFxuICAgICAgICAgICAgICAgICAgICBgJHt0aGlzLmVjMkNvbmZpZy5pbnN0YW5jZU5hbWV9LWluc3RhbmNlLW1hbmFnZWQtcG9saWN5LSR7aW5kZXh9YCxcbiAgICAgICAgICAgICAgICAgICAgcG9saWN5QXJuXG4gICAgICAgICAgICAgICAgKSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gQXR0YWNoIG1hbmFnZWQgcG9saWNpZXNcbiAgICAgICAgICAgIHRoaXMuZWMyQ29uZmlnLmluc3RhbmNlUm9sZS5tYW5hZ2VkUG9saWNpZXM/LmZvckVhY2gocG9saWN5ID0+IHtcbiAgICAgICAgICAgICAgICByb2xlLmFkZE1hbmFnZWRQb2xpY3kocG9saWN5KTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBBZGQgaW5saW5lIHBvbGljaWVzXG4gICAgICAgICAgICB0aGlzLmVjMkNvbmZpZy5pbnN0YW5jZVJvbGUuaW5saW5lUG9saWNpZXM/LmZvckVhY2goc3RhdGVtZW50ID0+IHtcbiAgICAgICAgICAgICAgICByb2xlLmFkZFRvUG9saWN5KHN0YXRlbWVudCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFkZCBkZWZhdWx0IHBlcm1pc3Npb25zIGZvciBFQ1IgYWNjZXNzICh0byBwdWxsIERvY2tlciBpbWFnZXMpXG4gICAgICAgIHJvbGUuYWRkVG9Qb2xpY3kobmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgJ2VjcjpHZXRBdXRob3JpemF0aW9uVG9rZW4nLFxuICAgICAgICAgICAgICAgICdlY3I6QmF0Y2hDaGVja0xheWVyQXZhaWxhYmlsaXR5JyxcbiAgICAgICAgICAgICAgICAnZWNyOkdldERvd25sb2FkVXJsRm9yTGF5ZXInLFxuICAgICAgICAgICAgICAgICdlY3I6QmF0Y2hHZXRJbWFnZSdcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICByZXNvdXJjZXM6IFsnKiddXG4gICAgICAgIH0pKTtcblxuICAgICAgICAvLyBBZGQgQ2xvdWQgTWFwIHBlcm1pc3Npb25zIGlmIHNlcnZpY2UgZGlzY292ZXJ5IGlzIGNvbmZpZ3VyZWRcbiAgICAgICAgaWYgKHRoaXMuZWMyQ29uZmlnLnNlcnZpY2VEaXNjb3ZlcnkpIHtcbiAgICAgICAgICAgIHJvbGUuYWRkVG9Qb2xpY3kobmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICAgICAnc2VydmljZWRpc2NvdmVyeTpSZWdpc3Rlckluc3RhbmNlJyxcbiAgICAgICAgICAgICAgICAgICAgJ3NlcnZpY2VkaXNjb3Zlcnk6RGVyZWdpc3Rlckluc3RhbmNlJyxcbiAgICAgICAgICAgICAgICAgICAgJ3NlcnZpY2VkaXNjb3Zlcnk6R2V0SW5zdGFuY2UnLFxuICAgICAgICAgICAgICAgICAgICAnc2VydmljZWRpc2NvdmVyeTpVcGRhdGVJbnN0YW5jZUN1c3RvbUhlYWx0aFN0YXR1cydcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogWycqJ11cbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFkZCBTU00gU2Vzc2lvbiBNYW5hZ2VyIHBlcm1pc3Npb25zIChmb3Iga2V5bGVzcyBhY2Nlc3MgdmlhIEFXUyBDb25zb2xlKVxuICAgICAgICByb2xlLmFkZFRvUG9saWN5KG5ldyBQb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICdzc21tZXNzYWdlczpDcmVhdGVDb250cm9sQ2hhbm5lbCcsXG4gICAgICAgICAgICAgICAgJ3NzbW1lc3NhZ2VzOkNyZWF0ZURhdGFDaGFubmVsJyxcbiAgICAgICAgICAgICAgICAnc3NtbWVzc2FnZXM6T3BlbkNvbnRyb2xDaGFubmVsJyxcbiAgICAgICAgICAgICAgICAnc3NtbWVzc2FnZXM6T3BlbkRhdGFDaGFubmVsJ1xuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHJlc291cmNlczogWycqJ11cbiAgICAgICAgfSkpO1xuXG4gICAgICAgIC8vIEFkZCBFQzIgSW5zdGFuY2UgQ29ubmVjdCBhbmQgU1NNIHBlcm1pc3Npb25zXG4gICAgICAgIHJvbGUuYWRkTWFuYWdlZFBvbGljeShcbiAgICAgICAgICAgIE1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdBbWF6b25TU01NYW5hZ2VkSW5zdGFuY2VDb3JlJylcbiAgICAgICAgKTtcblxuICAgICAgICAvLyBBZGQgQ2xvdWRXYXRjaCBMb2dzIHBlcm1pc3Npb25zXG4gICAgICAgIHJvbGUuYWRkVG9Qb2xpY3kobmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgJ2xvZ3M6Q3JlYXRlTG9nR3JvdXAnLFxuICAgICAgICAgICAgICAgICdsb2dzOkNyZWF0ZUxvZ1N0cmVhbScsXG4gICAgICAgICAgICAgICAgJ2xvZ3M6UHV0TG9nRXZlbnRzJyxcbiAgICAgICAgICAgICAgICAnbG9nczpEZXNjcmliZUxvZ1N0cmVhbXMnXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBbJyonXVxuICAgICAgICB9KSk7XG5cbiAgICAgICAgcmV0dXJuIHJvbGU7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBnZXREZWZhdWx0RGV2aWNlTmFtZShpbmRleDogbnVtYmVyKTogc3RyaW5nIHtcbiAgICAgICAgY29uc3QgZGV2aWNlU3VmZml4ZXMgPSBbJ2YnLCAnZycsICdoJywgJ2knLCAnaicsICdrJywgJ2wnLCAnbScsICduJywgJ28nLCAncCddO1xuICAgICAgICBjb25zdCBzdWZmaXggPSBkZXZpY2VTdWZmaXhlc1tpbmRleF0gfHwgU3RyaW5nLmZyb21DaGFyQ29kZSgxMDIgKyBpbmRleCk7IC8vIDEwMiBpcyAnZicgaW4gQVNDSUlcbiAgICAgICAgcmV0dXJuIGAvZGV2L3NkJHtzdWZmaXh9YDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBCdWlsZHMgRG9ja2VyIHVzZXIgZGF0YSBzY3JpcHQgdG8gaW5zdGFsbCBEb2NrZXIgYW5kIHJ1biB0aGUgY29udGFpbmVyXG4gICAgICogXG4gICAgICogQHBhcmFtIGRvY2tlckltYWdlVXJpIC0gVGhlIFVSSSBvZiB0aGUgRG9ja2VyIGltYWdlIHRvIHJ1blxuICAgICAqIEByZXR1cm5zIFRoZSB1c2VyIGRhdGEgc2NyaXB0IGFzIGEgc3RyaW5nXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBwcml2YXRlIGJ1aWxkRG9ja2VyVXNlckRhdGEoZG9ja2VySW1hZ2VVcmk6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgICAgIGNvbnN0IGNvbnRhaW5lck5hbWUgPSB0aGlzLmVjMkNvbmZpZy5jb250YWluZXIuY29udGFpbmVyTmFtZSB8fCB0aGlzLmVjMkNvbmZpZy5pbnN0YW5jZU5hbWU7XG4gICAgICAgIGNvbnN0IGNvbnRhaW5lclBvcnQgPSB0aGlzLmVjMkNvbmZpZy5jb250YWluZXIuY29udGFpbmVyUG9ydDtcblxuICAgICAgICAvLyBCdWlsZCBlbnZpcm9ubWVudCB2YXJpYWJsZXNcbiAgICAgICAgbGV0IGVudlZhcnMgPSAnJztcbiAgICAgICAgaWYgKHRoaXMuZWMyQ29uZmlnLmNvbnRhaW5lci5lbnZpcm9ubWVudCkge1xuICAgICAgICAgICAgZW52VmFycyA9IE9iamVjdC5lbnRyaWVzKHRoaXMuZWMyQ29uZmlnLmNvbnRhaW5lci5lbnZpcm9ubWVudClcbiAgICAgICAgICAgICAgICAubWFwKChba2V5LCB2YWx1ZV0pID0+IGAtZSAke2tleX09XCIke3ZhbHVlfVwiYClcbiAgICAgICAgICAgICAgICAuam9pbignICcpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQnVpbGQgZG9ja2VyIHJ1biBvcHRpb25zICYgY29tbWFuZFxuICAgICAgICBjb25zdCBkb2NrZXJSdW5PcHRpb25zID0gdGhpcy5lYzJDb25maWcuY29udGFpbmVyLmRvY2tlclJ1bk9wdGlvbnM/LmpvaW4oJyAnKSB8fCAnJztcbiAgICAgICAgY29uc3QgY29tbWFuZCA9IHRoaXMuZWMyQ29uZmlnLmNvbnRhaW5lci5jb21tYW5kID8gdGhpcy5lYzJDb25maWcuY29udGFpbmVyLmNvbW1hbmQuam9pbignICcpIDogJyc7XG5cbiAgICAgICAgbGV0IGRvY2tlclJ1bkNtZCA9IGBkb2NrZXIgcnVuIC1kIC0tbmFtZSAke2NvbnRhaW5lck5hbWV9IC0tcmVzdGFydCB1bmxlc3Mtc3RvcHBlZGA7XG4gICAgICAgIGlmIChkb2NrZXJSdW5PcHRpb25zKSB7XG4gICAgICAgICAgICBkb2NrZXJSdW5DbWQgKz0gYCAke2RvY2tlclJ1bk9wdGlvbnN9YDtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZW52VmFycykge1xuICAgICAgICAgICAgZG9ja2VyUnVuQ21kICs9IGAgJHtlbnZWYXJzfWA7XG4gICAgICAgIH1cbiAgICAgICAgLy8gSU1QT1JUQU5UOiBhd3Nsb2dzIG9wdGlvbnMgbXVzdCBhcHBlYXIgQkVGT1JFIHRoZSBpbWFnZSByZWZlcmVuY2VcbiAgICAgICAgZG9ja2VyUnVuQ21kICs9IGAgLXAgJHtjb250YWluZXJQb3J0fToke2NvbnRhaW5lclBvcnR9IC0tbG9nLWRyaXZlciBhd3Nsb2dzIC0tbG9nLW9wdCBhd3Nsb2dzLXJlZ2lvbj0kUkVHSU9OIC0tbG9nLW9wdCBhd3Nsb2dzLWdyb3VwPSRMT0dfR1JPVVAgLS1sb2ctb3B0IGF3c2xvZ3Mtc3RyZWFtPSRJTlNUQU5DRV9JRCAke2RvY2tlckltYWdlVXJpfWA7XG4gICAgICAgIGlmIChjb21tYW5kKSB7XG4gICAgICAgICAgICBkb2NrZXJSdW5DbWQgKz0gYCAke2NvbW1hbmR9YDtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIElmIHNlcnZpY2UgZGlzY292ZXJ5IGlzIGNvbmZpZ3VyZWQsIGluamVjdCB0aGUgU2VydmljZSBJRCBzbyByZWdpc3RyYXRpb24gY2FuIGJlIGRvbmUgaW5saW5lXG4gICAgICAgIGNvbnN0IHNlcnZpY2VJZExpbmUgPSB0aGlzLmNsb3VkTWFwU2VydmljZVxuICAgICAgICAgICAgPyBgU0VSVklDRV9JRD1cIiR7dGhpcy5jbG91ZE1hcFNlcnZpY2Uuc2VydmljZUlkfVwiYFxuICAgICAgICAgICAgOiBgU0VSVklDRV9JRD1cIlwiYDtcblxuICAgICAgICBjb25zdCB2b2x1bWVTZXR1cCA9IHRoaXMuYnVpbGRWb2x1bWVVc2VyRGF0YSgpO1xuXG4gICAgICAgIHJldHVybiBgIyEvYmluL2Jhc2hcbnNldCAtZXVvIHBpcGVmYWlsXG5cbiMgLS0tLS0tLS0gTWluaW1hbCBzZXR1cDogSU1EU3YyLCByZWdpb24sIGlkcyAtLS0tLS0tLVxuVE9LRU49JChjdXJsIC1zUyAtWCBQVVQgXCJodHRwOi8vMTY5LjI1NC4xNjkuMjU0L2xhdGVzdC9hcGkvdG9rZW5cIiAtSCBcIlgtYXdzLWVjMi1tZXRhZGF0YS10b2tlbi10dGwtc2Vjb25kczogMjE2MDBcIiB8fCB0cnVlKVxuSU1EU19IRFI9XCJcIlxuaWYgWyAtbiBcIlxcJHtUT0tFTjotfVwiIF07IHRoZW4gSU1EU19IRFI9XCItSCBYLWF3cy1lYzItbWV0YWRhdGEtdG9rZW46XFwke1RPS0VOfVwiOyBmaVxuXG5SRUdJT049JChjdXJsIC1zUyBcXCRJTURTX0hEUiBodHRwOi8vMTY5LjI1NC4xNjkuMjU0L2xhdGVzdC9tZXRhLWRhdGEvcGxhY2VtZW50L3JlZ2lvbilcbklOU1RBTkNFX0lEPSQoY3VybCAtc1MgXFwkSU1EU19IRFIgaHR0cDovLzE2OS4yNTQuMTY5LjI1NC9sYXRlc3QvbWV0YS1kYXRhL2luc3RhbmNlLWlkKVxuUFJJVkFURV9JUD0kKGN1cmwgLXNTIFxcJElNRFNfSERSIGh0dHA6Ly8xNjkuMjU0LjE2OS4yNTQvbGF0ZXN0L21ldGEtZGF0YS9sb2NhbC1pcHY0KVxuXG4jIC0tLS0tLS0tIEluc3RhbGwgRG9ja2VyICsgQVdTIENMSSAobWluaW1hbCkgLS0tLS0tLS1cbmRuZiAteSBpbnN0YWxsIGRvY2tlciBhd3NjbGkgfHwgKGRuZiAteSB1cGRhdGUgJiYgZG5mIC15IGluc3RhbGwgZG9ja2VyIGF3c2NsaSlcbnN5c3RlbWN0bCBlbmFibGUgLS1ub3cgZG9ja2VyXG5cbiMgLS0tLS0tLS0gRUNSIGxvZ2luIC0tLS0tLS0tXG5BQ0NPVU5UX0lEPSQoYXdzIHN0cyBnZXQtY2FsbGVyLWlkZW50aXR5IC0tcXVlcnkgQWNjb3VudCAtLW91dHB1dCB0ZXh0KVxuYXdzIGVjciBnZXQtbG9naW4tcGFzc3dvcmQgLS1yZWdpb24gXCJcXCRSRUdJT05cIiB8IGRvY2tlciBsb2dpbiAtLXVzZXJuYW1lIEFXUyAtLXBhc3N3b3JkLXN0ZGluIFwiXFwke0FDQ09VTlRfSUR9LmRrci5lY3IuXFwke1JFR0lPTn0uYW1hem9uYXdzLmNvbVwiXG5cbiMgLS0tLS0tLS0gQ2xvdWRXYXRjaCBMb2dzOiBjcmVhdGUgZ3JvdXAgZm9yIGNvbnRhaW5lciBsb2dzIC0tLS0tLS0tXG5MT0dfR1JPVVA9XCIvYXdzL2VjMi8ke3RoaXMuZWMyQ29uZmlnLmluc3RhbmNlTmFtZX0vY29udGFpbmVyXCJcbmF3cyBsb2dzIGNyZWF0ZS1sb2ctZ3JvdXAgLS1sb2ctZ3JvdXAtbmFtZSBcIlxcJExPR19HUk9VUFwiIC0tcmVnaW9uIFwiXFwkUkVHSU9OXCIgMj4vZGV2L251bGwgfHwgdHJ1ZVxuYXdzIGxvZ3MgcHV0LXJldGVudGlvbi1wb2xpY3kgLS1sb2ctZ3JvdXAtbmFtZSBcIlxcJExPR19HUk9VUFwiIC0tcmV0ZW50aW9uLWluLWRheXMgNyAtLXJlZ2lvbiBcIlxcJFJFR0lPTlwiIDI+L2Rldi9udWxsIHx8IHRydWVcblxuIyAtLS0tLS0tLSAoT3B0aW9uYWwpIENsb3VkIE1hcCByZWdpc3RyYXRpb24gLS0tLS0tLS1cbiR7c2VydmljZUlkTGluZX1cbmlmIFsgLW4gXCJcXCR7U0VSVklDRV9JRDotfVwiIF07IHRoZW5cbiAgIyB3YWl0IGJyaWVmbHkgZm9yIHJvbGUgY3JlZGVudGlhbHNcbiAgZm9yIGkgaW4gXFwkKHNlcSAxIDE4KTsgZG9cbiAgICBpZiBhd3Mgc3RzIGdldC1jYWxsZXItaWRlbnRpdHkgPi9kZXYvbnVsbCAyPiYxOyB0aGVuIGJyZWFrOyBmaVxuICAgIHNsZWVwIDVcbiAgZG9uZVxuICBhd3Mgc2VydmljZWRpc2NvdmVyeSByZWdpc3Rlci1pbnN0YW5jZSBcXFxuICAgIC0tc2VydmljZS1pZCBcIlxcJFNFUlZJQ0VfSURcIiBcXFxuICAgIC0taW5zdGFuY2UtaWQgXCJcXCRJTlNUQU5DRV9JRFwiIFxcXG4gICAgLS1hdHRyaWJ1dGVzIEFXU19JTlNUQU5DRV9JUFY0PVwiXFwkUFJJVkFURV9JUFwiLEFXU19JTlNUQU5DRV9QT1JUPVwiJHtjb250YWluZXJQb3J0fVwiIFxcXG4gICAgLS1yZWdpb24gXCJcXCRSRUdJT05cIiBcXFxuICAgID4vdG1wL3NkLm91dCAyPi90bXAvc2QuZXJyIHx8IHRydWVcbmZpXG5cbiR7dm9sdW1lU2V0dXB9XG5cbiMgLS0tLS0tLS0gUnVuIGNvbnRhaW5lciAobG9ncyBnbyB0byBDbG91ZFdhdGNoIHZpYSBhd3Nsb2dzIGRyaXZlcikgLS0tLS0tLS1cbmRvY2tlciBybSAtZiAke2NvbnRhaW5lck5hbWV9ID4vZGV2L251bGwgMj4mMSB8fCB0cnVlXG4ke2RvY2tlclJ1bkNtZH1cbmA7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBidWlsZFZvbHVtZVVzZXJEYXRhKCk6IHN0cmluZyB7XG4gICAgICAgIGNvbnN0IHZvbHVtZUNvbmZpZ3MgPSB0aGlzLmVjMkNvbmZpZy52b2x1bWVzIHx8IFtdO1xuICAgICAgICBjb25zdCBzZXR1cENhbGxzID0gdm9sdW1lQ29uZmlnc1xuICAgICAgICAgICAgLm1hcCgodm9sdW1lQ29uZmlnLCBpbmRleCkgPT4ge1xuICAgICAgICAgICAgICAgIGlmICghdm9sdW1lQ29uZmlnLm1vdW50UG9pbnQpIHJldHVybiAnJztcbiAgICAgICAgICAgICAgICBjb25zdCBkZXZpY2VOYW1lID0gdm9sdW1lQ29uZmlnLmRldmljZU5hbWUgfHwgdGhpcy5nZXREZWZhdWx0RGV2aWNlTmFtZShpbmRleCk7XG4gICAgICAgICAgICAgICAgY29uc3QgZmlsZVN5c3RlbSA9IHZvbHVtZUNvbmZpZy5maWxlU3lzdGVtIHx8ICdleHQ0JztcbiAgICAgICAgICAgICAgICBjb25zdCB2b2x1bWVJZCA9IHZvbHVtZUNvbmZpZy52b2x1bWVJZCB8fCAnJztcbiAgICAgICAgICAgICAgICByZXR1cm4gYHNldHVwX3ZvbHVtZSBcIiR7ZGV2aWNlTmFtZX1cIiBcIiR7dm9sdW1lQ29uZmlnLm1vdW50UG9pbnR9XCIgXCIke2ZpbGVTeXN0ZW19XCIgXCIke3ZvbHVtZUlkfVwiYDtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAuZmlsdGVyKGxpbmUgPT4gbGluZSlcbiAgICAgICAgICAgIC5qb2luKCdcXG4nKTtcblxuICAgICAgICBpZiAoIXNldHVwQ2FsbHMpIHJldHVybiAnJztcblxuICAgICAgICByZXR1cm4gYCMgLS0tLS0tLS0gRUJTIHZvbHVtZSBzZXR1cCAtLS0tLS0tLVxuc2V0dXBfdm9sdW1lKCkge1xuICBsb2NhbCBkZXZpY2U9XCIkMVwiXG4gIGxvY2FsIG1vdW50X3BvaW50PVwiJDJcIlxuICBsb2NhbCBmc190eXBlPVwiJDNcIlxuICBsb2NhbCB2b2x1bWVfaWQ9XCIkNFwiXG5cbiAgZm9yIGkgaW4gJChzZXEgMSAzMCk7IGRvXG4gICAgaWYgWyAtbiBcIiR2b2x1bWVfaWRcIiBdOyB0aGVuXG4gICAgICB2b2x1bWVfaWRfY2xlYW49XCJcXCR7dm9sdW1lX2lkLy8tL31cIlxuICAgICAgaWYgWyAtZSBcIi9kZXYvZGlzay9ieS1pZC9udm1lLUFtYXpvbl9FbGFzdGljX0Jsb2NrX1N0b3JlX1xcJHt2b2x1bWVfaWRfY2xlYW59XCIgXTsgdGhlblxuICAgICAgICBkZXZpY2U9XCIvZGV2L2Rpc2svYnktaWQvbnZtZS1BbWF6b25fRWxhc3RpY19CbG9ja19TdG9yZV9cXCR7dm9sdW1lX2lkX2NsZWFufVwiXG4gICAgICAgIGJyZWFrXG4gICAgICBmaVxuICAgIGZpXG5cbiAgICBpZiBbIC1lIFwiJGRldmljZVwiIF07IHRoZW5cbiAgICAgIGJyZWFrXG4gICAgZmlcblxuICAgIGlmIFsgLWUgL2Rldi9udm1lMW4xIF0gJiYgWyBcIiRkZXZpY2VcIiAhPSBcIi9kZXYvbnZtZTFuMVwiIF07IHRoZW5cbiAgICAgIGRldmljZT1cIi9kZXYvbnZtZTFuMVwiXG4gICAgICBicmVha1xuICAgIGZpXG5cbiAgICBhbHQ9JChsc2JsayAtZHBubyBOQU1FLFRZUEUgfCBhd2sgJyQyPT1cImRpc2tcIntwcmludCAkMX0nIHwgZ3JlcCAtdiAvZGV2L252bWUwbjEgfCBoZWFkIC1uIDEgfHwgdHJ1ZSlcbiAgICBpZiBbIC1uIFwiJGFsdFwiIF07IHRoZW5cbiAgICAgIGRldmljZT1cIiRhbHRcIlxuICAgICAgYnJlYWtcbiAgICBmaVxuXG4gICAgZWNobyBcIldhaXRpbmcgZm9yIHZvbHVtZSAkZGV2aWNlIHRvIGJlIGF0dGFjaGVkLi4uICgkaS8zMClcIlxuICAgIHNsZWVwIDJcbiAgZG9uZVxuXG4gIGlmIFsgISAtZSBcIiRkZXZpY2VcIiBdOyB0aGVuXG4gICAgZWNobyBcIkVSUk9SOiBWb2x1bWUgZGV2aWNlIG5vdCBmb3VuZCBmb3IgJG1vdW50X3BvaW50XCJcbiAgICBleGl0IDFcbiAgZmlcblxuICBpZiAhIGJsa2lkIFwiJGRldmljZVwiID4gL2Rldi9udWxsIDI+JjE7IHRoZW5cbiAgICBlY2hvIFwiRm9ybWF0dGluZyB2b2x1bWUgJGRldmljZSBhcyAkZnNfdHlwZS4uLlwiXG4gICAgbWtmcyAtdCBcIiRmc190eXBlXCIgLUYgXCIkZGV2aWNlXCJcbiAgZWxzZVxuICAgIGVjaG8gXCJWb2x1bWUgJGRldmljZSBpcyBhbHJlYWR5IGZvcm1hdHRlZFwiXG4gIGZpXG5cbiAgbWtkaXIgLXAgXCIkbW91bnRfcG9pbnRcIlxuICBlY2hvIFwiTW91bnRpbmcgJGRldmljZSB0byAkbW91bnRfcG9pbnQuLi5cIlxuICBtb3VudCBcIiRkZXZpY2VcIiBcIiRtb3VudF9wb2ludFwiXG5cbiAgY2hvd24gLVIgZWMyLXVzZXI6ZWMyLXVzZXIgXCIkbW91bnRfcG9pbnRcIlxuICBjaG1vZCAtUiA3NTUgXCIkbW91bnRfcG9pbnRcIlxuXG4gIGlmICEgZ3JlcCAtcSBcIiRtb3VudF9wb2ludFwiIC9ldGMvZnN0YWI7IHRoZW5cbiAgICBVVUlEPSQoYmxraWQgLXMgVVVJRCAtbyB2YWx1ZSBcIiRkZXZpY2VcIiB8fCB0cnVlKVxuICAgIGlmIFsgLW4gXCIkVVVJRFwiIF07IHRoZW5cbiAgICAgIGVjaG8gXCJVVUlEPSRVVUlEICRtb3VudF9wb2ludCAkZnNfdHlwZSBkZWZhdWx0cyxub2ZhaWwgMCAyXCIgPj4gL2V0Yy9mc3RhYlxuICAgIGVsc2VcbiAgICAgIGVjaG8gXCIkZGV2aWNlICRtb3VudF9wb2ludCAkZnNfdHlwZSBkZWZhdWx0cyxub2ZhaWwgMCAyXCIgPj4gL2V0Yy9mc3RhYlxuICAgIGZpXG4gIGZpXG5cbiAgZWNobyBcIlZvbHVtZSBtb3VudGVkIHN1Y2Nlc3NmdWxseSBhdCAkbW91bnRfcG9pbnRcIlxufVxuXG4ke3NldHVwQ2FsbHN9XG5gO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENvbnN0cnVjdHMgYWxsIG5lY2Vzc2FyeSBBV1MgcmVzb3VyY2VzIGZvciB0aGUgRUMyIGluc3RhbmNlLlxuICAgICAqIFRoaXMgaW5jbHVkZXMgVlBDLCBzZWN1cml0eSBncm91cHMsIGluc3RhbmNlIGNvbmZpZ3VyYXRpb24sIERvY2tlciBzZXR1cCwgYW5kIHZvbHVtZXMuXG4gICAgICogXG4gICAgICogQHJldHVybnMgUHJvbWlzZSB0aGF0IHJlc29sdmVzIHdoZW4gYWxsIHJlc291cmNlcyBhcmUgY3JlYXRlZFxuICAgICAqIEBwdWJsaWNcbiAgICAgKi9cbiAgICBATG9nRHVyYXRpb24oKVxuICAgIHB1YmxpYyBhc3luYyBjb25zdHJ1Y3QoKSB7XG4gICAgICAgIHRoaXMubWFpblN0YWNrID0gdGhpcy5mdzI0LmdldFN0YWNrKHRoaXMuZWMyQ29uZmlnLnN0YWNrTmFtZSwgdGhpcy5lYzJDb25maWcucGFyZW50U3RhY2tOYW1lKTtcblxuICAgICAgICAvLyBHZXQgVlBDIGZpcnN0IGFzIGl0J3MgbmVlZGVkIGZvciBhbGwgb3RoZXIgcmVzb3VyY2VzXG4gICAgICAgIHRoaXMudnBjID0gdGhpcy5nZXRWcGMoKTtcblxuICAgICAgICAvLyBHZXQgb3IgY3JlYXRlIFNlY3VyaXR5IEdyb3VwXG4gICAgICAgIGNvbnN0IHNlY3VyaXR5R3JvdXAgPSB0aGlzLmdldE9yQ3JlYXRlU2VjdXJpdHlHcm91cCgpO1xuXG4gICAgICAgIC8vIEdldCBzdWJuZXRcbiAgICAgICAgY29uc3Qgc3VibmV0ID0gdGhpcy5nZXRTdWJuZXQoKTtcblxuICAgICAgICAvLyBDcmVhdGUgaW5zdGFuY2Ugcm9sZVxuICAgICAgICBjb25zdCBpbnN0YW5jZVJvbGUgPSB0aGlzLmNyZWF0ZUluc3RhbmNlUm9sZSgpO1xuXG4gICAgICAgIC8vIEJ1aWxkIERvY2tlciBpbWFnZVxuICAgICAgICBjb25zdCBkb2NrZXJJbWFnZSA9IG5ldyBEb2NrZXJJbWFnZUFzc2V0KHRoaXMubWFpblN0YWNrLCBgJHt0aGlzLmVjMkNvbmZpZy5pbnN0YW5jZU5hbWV9LWltYWdlYCwge1xuICAgICAgICAgICAgZGlyZWN0b3J5OiBwYXRoLmRpcm5hbWUodGhpcy5lYzJDb25maWcuY29udGFpbmVyLmRvY2tlckZpbGVQYXRoKSxcbiAgICAgICAgICAgIGZpbGU6IHBhdGguYmFzZW5hbWUodGhpcy5lYzJDb25maWcuY29udGFpbmVyLmRvY2tlckZpbGVQYXRoKSxcbiAgICAgICAgICAgIHBsYXRmb3JtOiB0aGlzLmVjMkNvbmZpZy5kb2NrZXJJbWFnZVByb3BzPy5wbGF0Zm9ybSB8fCBQbGF0Zm9ybS5MSU5VWF9BTUQ2NCxcbiAgICAgICAgICAgIC4uLnRoaXMuZWMyQ29uZmlnLmRvY2tlckltYWdlUHJvcHMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIENvbmZpZ3VyZSBzZXJ2aWNlIGRpc2NvdmVyeSBpZiBzcGVjaWZpZWQgKG11c3QgYmUgZG9uZSBiZWZvcmUgdXNlciBkYXRhKVxuICAgICAgICBpZiAodGhpcy5lYzJDb25maWcuc2VydmljZURpc2NvdmVyeSkge1xuICAgICAgICAgICAgdGhpcy5jb25maWd1cmVTZXJ2aWNlRGlzY292ZXJ5KCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBCdWlsZCB1c2VyIGRhdGEgc2NyaXB0XG4gICAgICAgIGNvbnN0IHVzZXJEYXRhID0gVXNlckRhdGEuY3VzdG9tKFxuICAgICAgICAgICAgdGhpcy5idWlsZERvY2tlclVzZXJEYXRhKGRvY2tlckltYWdlLmltYWdlVXJpKVxuICAgICAgICApO1xuXG5cbiAgICAgICAgLy8gTWVyZ2UgdXNlci1wcm92aWRlZCB1c2VyIGRhdGEgaWYgZXhpc3RzXG4gICAgICAgIGNvbnN0IHsgdXNlckRhdGE6IGN1c3RvbVVzZXJEYXRhLCAuLi5yZXN0SW5zdGFuY2VQcm9wcyB9ID0gdGhpcy5lYzJDb25maWcuaW5zdGFuY2VQcm9wcyB8fCB7fTtcbiAgICAgICAgaWYgKGN1c3RvbVVzZXJEYXRhKSB7XG4gICAgICAgICAgICAvLyBDb21iaW5lIHVzZXIgZGF0YSBzY3JpcHRzXG4gICAgICAgICAgICB1c2VyRGF0YS5hZGRDb21tYW5kcyhcbiAgICAgICAgICAgICAgICAuLi5jdXN0b21Vc2VyRGF0YS5yZW5kZXIoKS5zcGxpdCgnXFxuJykuZmlsdGVyKGxpbmUgPT4gbGluZS50cmltKCkpXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUHJlcGFyZSBibG9jayBkZXZpY2VzIGZvciB2b2x1bWVzXG4gICAgICAgIGNvbnN0IGJsb2NrRGV2aWNlczogQXJyYXk8eyBkZXZpY2VOYW1lOiBzdHJpbmc7IHZvbHVtZTogQmxvY2tEZXZpY2VWb2x1bWUgfT4gPSBbXTtcbiAgICAgICAgY29uc3Qgdm9sdW1lQXR0YWNobWVudHM6IEFycmF5PHsgZGV2aWNlTmFtZTogc3RyaW5nOyB2b2x1bWVJZDogc3RyaW5nIH0+ID0gW107XG4gICAgICAgIGlmICh0aGlzLmVjMkNvbmZpZy52b2x1bWVzKSB7XG4gICAgICAgICAgICB0aGlzLmVjMkNvbmZpZy52b2x1bWVzLmZvckVhY2goKHZvbHVtZUNvbmZpZywgaW5kZXgpID0+IHtcbiAgICAgICAgICAgICAgICAvLyBHZW5lcmF0ZSBkZXZpY2UgbmFtZSBpZiBub3QgcHJvdmlkZWRcbiAgICAgICAgICAgICAgICBjb25zdCBkZXZpY2VOYW1lID0gdm9sdW1lQ29uZmlnLmRldmljZU5hbWUgfHwgdGhpcy5nZXREZWZhdWx0RGV2aWNlTmFtZShpbmRleCk7XG5cbiAgICAgICAgICAgICAgICAvLyBBdHRhY2ggZXhpc3Rpbmcgdm9sdW1lIGJ5IElEIChkbyBub3QgY3JlYXRlIGEgbmV3IG9uZSlcbiAgICAgICAgICAgICAgICBpZiAodm9sdW1lQ29uZmlnLnZvbHVtZUlkKSB7XG4gICAgICAgICAgICAgICAgICAgIHZvbHVtZUF0dGFjaG1lbnRzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgZGV2aWNlTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHZvbHVtZUlkOiB2b2x1bWVDb25maWcudm9sdW1lSWRcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBsZXQgdm9sdW1lOiBCbG9ja0RldmljZVZvbHVtZTtcblxuICAgICAgICAgICAgICAgIC8vIElmIHZvbHVtZSBpcyBleHBsaWNpdGx5IHByb3ZpZGVkLCB1c2UgaXRcbiAgICAgICAgICAgICAgICBpZiAodm9sdW1lQ29uZmlnLnZvbHVtZSkge1xuICAgICAgICAgICAgICAgICAgICB2b2x1bWUgPSB2b2x1bWVDb25maWcudm9sdW1lO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAvLyBJZiBvbmx5IHNpemUgaXMgcHJvdmlkZWQsIGNyZWF0ZSBHUDMgdm9sdW1lIHdpdGggZGVmYXVsdHNcbiAgICAgICAgICAgICAgICBlbHNlIGlmICh2b2x1bWVDb25maWcuc2l6ZUdpQikge1xuICAgICAgICAgICAgICAgICAgICB2b2x1bWUgPSBCbG9ja0RldmljZVZvbHVtZS5lYnModm9sdW1lQ29uZmlnLnNpemVHaUIsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZvbHVtZVR5cGU6IEVic0RldmljZVZvbHVtZVR5cGUuR1AzLFxuICAgICAgICAgICAgICAgICAgICAgICAgZW5jcnlwdGVkOiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlT25UZXJtaW5hdGlvbjogdm9sdW1lQ29uZmlnLmRlbGV0ZU9uVGVybWluYXRpb24gPz8gZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAvLyBFcnJvciBpZiBuZWl0aGVyIGlzIHByb3ZpZGVkXG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVm9sdW1lIGNvbmZpZ3VyYXRpb24gZm9yIGRldmljZSAke2RldmljZU5hbWV9IG11c3Qgc3BlY2lmeSBlaXRoZXIgJ3ZvbHVtZUlkJywgJ3ZvbHVtZScsIG9yICdzaXplR2lCJ2ApO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGJsb2NrRGV2aWNlcy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgZGV2aWNlTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgdm9sdW1lXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENyZWF0ZSBFQzIgaW5zdGFuY2UsIG1lcmdpbmcgd2l0aCB1c2VyLXByb3ZpZGVkIHByb3BzXG4gICAgICAgIHRoaXMuaW5zdGFuY2UgPSBuZXcgSW5zdGFuY2UodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZWMyQ29uZmlnLmluc3RhbmNlTmFtZX0taW5zdGFuY2VgLCB7XG4gICAgICAgICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgICAgICAgdnBjU3VibmV0czogc3VibmV0ID8geyBzdWJuZXRzOiBbc3VibmV0XSB9IDogeyBzdWJuZXRUeXBlOiB0aGlzLmVjMkNvbmZpZy5zdWJuZXRDb25maWc/LnN1Ym5ldFR5cGUgfHwgU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTIH0sXG4gICAgICAgICAgICBzZWN1cml0eUdyb3VwOiBzZWN1cml0eUdyb3VwLFxuICAgICAgICAgICAgcm9sZTogaW5zdGFuY2VSb2xlLFxuICAgICAgICAgICAgaW5zdGFuY2VUeXBlOiBJbnN0YW5jZVR5cGUub2YoSW5zdGFuY2VDbGFzcy5UMywgSW5zdGFuY2VTaXplLk1JQ1JPKSxcbiAgICAgICAgICAgIG1hY2hpbmVJbWFnZTogTWFjaGluZUltYWdlLmxhdGVzdEFtYXpvbkxpbnV4MjAyMyh7XG4gICAgICAgICAgICAgICAgY3B1VHlwZTogQW1hem9uTGludXhDcHVUeXBlLlg4Nl82NCxcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgdXNlckRhdGE6IHVzZXJEYXRhLFxuICAgICAgICAgICAgYmxvY2tEZXZpY2VzOiBibG9ja0RldmljZXMubGVuZ3RoID4gMCA/IGJsb2NrRGV2aWNlcyA6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgIC4uLnJlc3RJbnN0YW5jZVByb3BzLFxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBBdHRhY2ggZXhpc3RpbmcgRUJTIHZvbHVtZXMgKG11c3QgYmUgaW4gdGhlIHNhbWUgQVogYXMgdGhlIGluc3RhbmNlKVxuICAgICAgICBpZiAodm9sdW1lQXR0YWNobWVudHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgdm9sdW1lQXR0YWNobWVudHMuZm9yRWFjaCgoYXR0YWNobWVudCwgaW5kZXgpID0+IHtcbiAgICAgICAgICAgICAgICBuZXcgQ2ZuVm9sdW1lQXR0YWNobWVudCh0aGlzLm1haW5TdGFjaywgYCR7dGhpcy5lYzJDb25maWcuaW5zdGFuY2VOYW1lfS12b2x1bWUtYXR0YWNobWVudC0ke2luZGV4fWAsIHtcbiAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2VJZDogdGhpcy5pbnN0YW5jZS5pbnN0YW5jZUlkLFxuICAgICAgICAgICAgICAgICAgICB2b2x1bWVJZDogYXR0YWNobWVudC52b2x1bWVJZCxcbiAgICAgICAgICAgICAgICAgICAgZGV2aWNlOiBhdHRhY2htZW50LmRldmljZU5hbWVcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gU2V0IG91dHB1dHNcbiAgICAgICAgdGhpcy5mdzI0LnNldENvbnN0cnVjdE91dHB1dCh0aGlzLCB0aGlzLmVjMkNvbmZpZy5pbnN0YW5jZU5hbWUsIHRoaXMuaW5zdGFuY2UsIE91dHB1dFR5cGUuSU5TVEFOQ0UpO1xuICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZShgJHt0aGlzLmVjMkNvbmZpZy5pbnN0YW5jZU5hbWV9SW5zdGFuY2VJZGAsIHRoaXMuaW5zdGFuY2UuaW5zdGFuY2VJZCk7XG4gICAgICAgIHRoaXMuZncyNC5zZXRFbnZpcm9ubWVudFZhcmlhYmxlKGAke3RoaXMuZWMyQ29uZmlnLmluc3RhbmNlTmFtZX1JbnN0YW5jZVByaXZhdGVJcGAsIHRoaXMuaW5zdGFuY2UuaW5zdGFuY2VQcml2YXRlSXApO1xuICAgICAgICB0aGlzLmZ3MjQuc2V0RW52aXJvbm1lbnRWYXJpYWJsZShgJHt0aGlzLmVjMkNvbmZpZy5pbnN0YW5jZU5hbWV9SW5zdGFuY2VQdWJsaWNJcGAsIHRoaXMuaW5zdGFuY2UuaW5zdGFuY2VQdWJsaWNJcCB8fCAnJyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0cyB0aGUgVlBDIGZvciB0aGUgRUMyIGluc3RhbmNlIGVpdGhlciBmcm9tIHRoZSBwcm92aWRlZCBjb25maWd1cmF0aW9uIG9yIGxvb2tzIGl0IHVwIGJ5IG5hbWUuXG4gICAgICogXG4gICAgICogQHJldHVybnMgVGhlIFZQQyBpbnN0YW5jZSB0byBiZSB1c2VkIGZvciB0aGUgRUMyIGluc3RhbmNlXG4gICAgICogQHRocm93cyBFcnJvciBpZiBuZWl0aGVyIFZQQyBuYW1lIG5vciBWUEMgaW5zdGFuY2UgaXMgcHJvdmlkZWRcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIHByaXZhdGUgZ2V0VnBjKCk6IElWcGMge1xuICAgICAgICBpZiAoIXRoaXMuZWMyQ29uZmlnLnZwY05hbWUgJiYgIXRoaXMuZWMyQ29uZmlnLnZwYykge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdWUEMgTmFtZSBvciBWUEMgbXVzdCBiZSBzcGVjaWZpZWQgaW4gdGhlIEVDMiBjb25maWd1cmF0aW9uJyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGhpcy5lYzJDb25maWcudnBjKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5lYzJDb25maWcudnBjO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIFZwYy5mcm9tTG9va3VwKHRoaXMubWFpblN0YWNrLCBgJHt0aGlzLmVjMkNvbmZpZy5pbnN0YW5jZU5hbWV9LXZwY2AsIHtcbiAgICAgICAgICAgIHZwY05hbWU6IHRoaXMuZWMyQ29uZmlnLnZwY05hbWVcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2V0cyB0aGUgc3VibmV0IGZvciB0aGUgRUMyIGluc3RhbmNlIGVpdGhlciBmcm9tIHRoZSBwcm92aWRlZCBjb25maWd1cmF0aW9uIG9yIHJldHVybnMgdW5kZWZpbmVkLlxuICAgICAqIFxuICAgICAqIEByZXR1cm5zIFRoZSBzdWJuZXQgaW5zdGFuY2Ugb3IgdW5kZWZpbmVkIGlmIHVzaW5nIHN1Ym5ldCB0eXBlXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBwcml2YXRlIGdldFN1Ym5ldCgpOiBJU3VibmV0IHwgdW5kZWZpbmVkIHtcbiAgICAgICAgaWYgKHRoaXMuZWMyQ29uZmlnLnN1Ym5ldD8uc3VibmV0SWQpIHtcbiAgICAgICAgICAgIHJldHVybiBTdWJuZXQuZnJvbVN1Ym5ldElkKFxuICAgICAgICAgICAgICAgIHRoaXMubWFpblN0YWNrLFxuICAgICAgICAgICAgICAgIGAke3RoaXMuZWMyQ29uZmlnLmluc3RhbmNlTmFtZX0taW1wb3J0ZWQtc3VibmV0YCxcbiAgICAgICAgICAgICAgICB0aGlzLmVjMkNvbmZpZy5zdWJuZXQuc3VibmV0SWRcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdldHMgYW4gZXhpc3Rpbmcgc2VjdXJpdHkgZ3JvdXAgb3IgY3JlYXRlcyBhIG5ldyBvbmUgZm9yIHRoZSBFQzIgaW5zdGFuY2UuXG4gICAgICogSWYgYSBzZWN1cml0eSBncm91cCBJRCBpcyBwcm92aWRlZCwgaXQgd2lsbCB1c2UgdGhhdCBncm91cC5cbiAgICAgKiBPdGhlcndpc2UsIGl0IGNyZWF0ZXMgYSBuZXcgc2VjdXJpdHkgZ3JvdXAgd2l0aCBhcHByb3ByaWF0ZSBpbmdyZXNzIHJ1bGVzLlxuICAgICAqIFxuICAgICAqIEByZXR1cm5zIFRoZSBzZWN1cml0eSBncm91cCBpbnN0YW5jZVxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgcHJpdmF0ZSBnZXRPckNyZWF0ZVNlY3VyaXR5R3JvdXAoKTogSVNlY3VyaXR5R3JvdXAge1xuICAgICAgICBpZiAodGhpcy5lYzJDb25maWcuc2VjdXJpdHlHcm91cD8uc2VjdXJpdHlHcm91cElkKSB7XG4gICAgICAgICAgICByZXR1cm4gU2VjdXJpdHlHcm91cC5mcm9tU2VjdXJpdHlHcm91cElkKFxuICAgICAgICAgICAgICAgIHRoaXMubWFpblN0YWNrLCBcbiAgICAgICAgICAgICAgICBgJHt0aGlzLmVjMkNvbmZpZy5pbnN0YW5jZU5hbWV9LWltcG9ydGVkLXNnYCxcbiAgICAgICAgICAgICAgICB0aGlzLmVjMkNvbmZpZy5zZWN1cml0eUdyb3VwLnNlY3VyaXR5R3JvdXBJZFxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNlY3VyaXR5R3JvdXAgPSBuZXcgU2VjdXJpdHlHcm91cCh0aGlzLm1haW5TdGFjaywgYCR7dGhpcy5lYzJDb25maWcuaW5zdGFuY2VOYW1lfS1zZ2AsIHtcbiAgICAgICAgICAgIHZwYzogdGhpcy52cGMsXG4gICAgICAgICAgICBhbGxvd0FsbE91dGJvdW5kOiB0cnVlLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246IGBTZWN1cml0eSBncm91cCBmb3IgJHt0aGlzLmVjMkNvbmZpZy5pbnN0YW5jZU5hbWV9IEVDMiBpbnN0YW5jZWAsXG4gICAgICAgICAgICAuLi50aGlzLmVjMkNvbmZpZy5zZWN1cml0eUdyb3VwPy5wcm9wcyxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gQWxsb3cgaW5ib3VuZCB0cmFmZmljIG9uIGNvbnRhaW5lciBwb3J0IGZyb20gd2l0aGluIFZQQ1xuICAgICAgICBzZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKFxuICAgICAgICAgICAgUGVlci5pcHY0KHRoaXMudnBjLnZwY0NpZHJCbG9jayksXG4gICAgICAgICAgICBQb3J0LnRjcCh0aGlzLmVjMkNvbmZpZy5jb250YWluZXIuY29udGFpbmVyUG9ydCksXG4gICAgICAgICAgICAnQWxsb3cgaW5ib3VuZCB0cmFmZmljIG9uIGNvbnRhaW5lciBwb3J0IGZyb20gd2l0aGluIFZQQydcbiAgICAgICAgKTtcblxuICAgICAgICAvLyBBbGxvdyBTU0ggYWNjZXNzIGZyb20gVlBDIChvcHRpb25hbCwgY2FuIGJlIHJlbW92ZWQgZm9yIHByb2R1Y3Rpb24pXG4gICAgICAgIHNlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoXG4gICAgICAgICAgICBQZWVyLmlwdjQodGhpcy52cGMudnBjQ2lkckJsb2NrKSxcbiAgICAgICAgICAgIFBvcnQudGNwKDIyKSxcbiAgICAgICAgICAgICdBbGxvdyBTU0ggYWNjZXNzIGZyb20gd2l0aGluIFZQQydcbiAgICAgICAgKTtcblxuICAgICAgICB0aGlzLmZ3MjQuc2V0Q29uc3RydWN0T3V0cHV0KHRoaXMsIGAke3RoaXMuZWMyQ29uZmlnLmluc3RhbmNlTmFtZX0tc2dgLCBzZWN1cml0eUdyb3VwLCBPdXRwdXRUeXBlLlNFQ1VSSVRZR1JPVVApO1xuICAgICAgICByZXR1cm4gc2VjdXJpdHlHcm91cDtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDb25maWd1cmVzIHNlcnZpY2UgZGlzY292ZXJ5IGZvciB0aGUgRUMyIGluc3RhbmNlLlxuICAgICAqIENyZWF0ZXMgYSBwcml2YXRlIEROUyBuYW1lc3BhY2UgYW5kIHJlZ2lzdGVycyB0aGUgc2VydmljZSBmb3IgaW50ZXJuYWwgZGlzY292ZXJ5LlxuICAgICAqIFxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgcHJpdmF0ZSBjb25maWd1cmVTZXJ2aWNlRGlzY292ZXJ5KCkge1xuICAgICAgICBpZiAoIXRoaXMuZWMyQ29uZmlnLnNlcnZpY2VEaXNjb3ZlcnkpIHJldHVybjtcblxuICAgICAgICBjb25zdCBuYW1lc3BhY2UgPSBuZXcgUHJpdmF0ZURuc05hbWVzcGFjZSh0aGlzLm1haW5TdGFjaywgYCR7dGhpcy5lYzJDb25maWcuaW5zdGFuY2VOYW1lfS1uYW1lc3BhY2VgLCB7XG4gICAgICAgICAgICBuYW1lOiB0aGlzLmVjMkNvbmZpZy5zZXJ2aWNlRGlzY292ZXJ5Lm5hbWVzcGFjZSxcbiAgICAgICAgICAgIHZwYzogdGhpcy52cGMsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuY2xvdWRNYXBTZXJ2aWNlID0gbmV3IFNlcnZpY2UodGhpcy5tYWluU3RhY2ssIGAke3RoaXMuZWMyQ29uZmlnLmluc3RhbmNlTmFtZX0tc2VydmljZWAsIHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogbmFtZXNwYWNlLFxuICAgICAgICAgICAgbmFtZTogdGhpcy5lYzJDb25maWcuc2VydmljZURpc2NvdmVyeS5zZXJ2aWNlTmFtZSxcbiAgICAgICAgICAgIGRuc1JlY29yZFR5cGU6IERuc1JlY29yZFR5cGUuQSxcbiAgICAgICAgICAgIGRuc1R0bDogRHVyYXRpb24uc2Vjb25kcyg2MCksXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuZncyNC5zZXRDb25zdHJ1Y3RPdXRwdXQodGhpcywgYCR7dGhpcy5lYzJDb25maWcuaW5zdGFuY2VOYW1lfS1kaXNjb3ZlcnlgLCB0aGlzLmNsb3VkTWFwU2VydmljZSwgT3V0cHV0VHlwZS5TRVJWSUNFX0RJU0NPVkVSWSk7XG4gICAgfVxuXG59XG5cbiJdfQ==
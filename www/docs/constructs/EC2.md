# EC2

The EC2 Construct provides a high-level abstraction for deploying EC2 instances with Docker containers on AWS. It handles instance configuration, security groups, VPC networking, volume management, and automatic Docker container deployment from Dockerfiles.

## Features

- EC2 instance deployment with Docker
- Automatic Docker installation and container deployment
- VPC and subnet configuration
- Security group management
- EBS volume management with flexible configuration
- IAM role configuration
- User data script generation
- CloudWatch logging support
- ECR integration for pulling Docker images

## Basic Usage

```typescript
const instance = new Ec2Construct({
  instanceName: 'my-app',
  vpcName: 'main-vpc',
  container: {
    dockerFilePath: './Dockerfile',
    containerPort: 3000,
    environment: {
      NODE_ENV: 'production'
    }
  },
  instanceProps: {
    instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.MICRO)
  }
});
```

## Configuration Options

### Container Configuration

```typescript
interface IContainerConfig {
  // Path to your Dockerfile
  dockerFilePath: string;
  
  // Port your container listens on
  containerPort: number;
  
  // Environment variables to pass to the container
  environment?: { [key: string]: string };
  
  // Docker command to run (optional)
  command?: string[];
  
  // Docker container name (optional)
  containerName?: string;
  
  // Additional docker run options (optional)
  dockerRunOptions?: string[];
}
```

### Volume Configuration

The volume configuration supports three levels of customization:

**Simplest (size only):**
```typescript
volumes: [{
  sizeGiB: 20  // Auto-generates device name and defaults to GP3 with encryption
}]
```

**With device name:**
```typescript
volumes: [{
  deviceName: '/dev/sdf',
  sizeGiB: 20
}]
```

**Full configuration:**
```typescript
volumes: [{
  deviceName: '/dev/sdf',
  volume: BlockDeviceVolume.ebs(20, {
    volumeType: EbsDeviceVolumeType.GP3,
    encrypted: true,
    iops: 3000  // For IO1/IO2 volumes
  })
}]
```

### Security Group Configuration

```typescript
interface ISecurityGroupConfig {
  // Use existing security group by ID
  securityGroupId?: string;
  
  // Or create new security group with custom properties
  props?: {
    description?: string;
    allowAllOutbound?: boolean;
  };
}
```

### Subnet Configuration

```typescript
interface ISubnetConfig {
  // Use existing subnet by ID
  subnetId?: string;
  
  // Or specify subnet type
  subnetType?: SubnetType;
}

// Or use simplified configuration
subnetConfig?: {
  subnetType: SubnetType;
}
```

### Instance Role Configuration

```typescript
interface IInstanceRoleConfig {
  // Custom role name
  roleName?: string;
  
  // Managed policy ARNs
  managedPolicyArns?: string[];
  
  // Managed policies
  managedPolicies?: ManagedPolicy[];
  
  // Inline policy statements
  inlinePolicies?: PolicyStatement[];
}
```

## Examples

### Basic EC2 Instance with Docker Container

```typescript
const instance = new Ec2Construct({
  instanceName: 'api-server',
  vpcName: 'main-vpc',
  container: {
    dockerFilePath: './src/api/Dockerfile',
    containerPort: 3000,
    environment: {
      NODE_ENV: 'production',
      PORT: '3000'
    }
  },
  instanceProps: {
    instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.MEDIUM)
  },
  volumes: [{
    sizeGiB: 20  // Auto-generates /dev/sdf with GP3 encryption
  }]
});
```

### EC2 Instance with Multiple Volumes

```typescript
const instance = new Ec2Construct({
  instanceName: 'data-server',
  vpcName: 'main-vpc',
  container: {
    dockerFilePath: './src/app/Dockerfile',
    containerPort: 8080,
    environment: {
      DATA_DIR: '/data',
      CACHE_DIR: '/cache'
    }
  },
  instanceProps: {
    instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE)
  },
  volumes: [
    { sizeGiB: 50 },    // Auto-generates /dev/sdf
    { sizeGiB: 100 },   // Auto-generates /dev/sdg
    {                    // Custom device name
      deviceName: '/dev/sdh',
      sizeGiB: 200
    }
  ]
});
```

### EC2 Instance with Custom Security Group and Subnet

```typescript
const instance = new Ec2Construct({
  instanceName: 'worker',
  vpcName: 'main-vpc',
  subnet: {
    subnetId: 'subnet-12345678'
  },
  securityGroup: {
    securityGroupId: 'sg-existing'
  },
  container: {
    dockerFilePath: './src/worker/Dockerfile',
    containerPort: 9000,
    environment: {
      QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/123456789/queue'
    },
    command: ['npm', 'start']
  },
  instanceProps: {
    instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.SMALL)
  }
});
```

### EC2 Instance with High-Performance Volumes

```typescript
import { BlockDeviceVolume, EbsDeviceVolumeType } from 'aws-cdk-lib/aws-ec2';

const instance = new Ec2Construct({
  instanceName: 'database-server',
  vpcName: 'main-vpc',
  container: {
    dockerFilePath: './src/db/Dockerfile',
    containerPort: 5432
  },
  instanceProps: {
    instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.XLARGE)
  },
  volumes: [{
    deviceName: '/dev/sdf',
    volume: BlockDeviceVolume.ebs(500, {
      volumeType: EbsDeviceVolumeType.IO1,
      iops: 4000,
      encrypted: true,
      deleteOnTermination: false
    })
  }]
});
```

### EC2 Instance with Custom IAM Role

```typescript
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

const instance = new Ec2Construct({
  instanceName: 's3-processor',
  vpcName: 'main-vpc',
  container: {
    dockerFilePath: './src/processor/Dockerfile',
    containerPort: 8080
  },
  instanceRole: {
    roleName: 's3-processor-role',
    managedPolicyArns: [
      'arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess'
    ],
    inlinePolicies: [
      new PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject'],
        resources: ['arn:aws:s3:::my-bucket/*']
      })
    ]
  },
  instanceProps: {
    instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.MEDIUM)
  }
});
```

### EC2 Instance in Private Subnet

```typescript
import { SubnetType } from 'aws-cdk-lib/aws-ec2';

const instance = new Ec2Construct({
  instanceName: 'internal-service',
  vpcName: 'main-vpc',
  subnetConfig: {
    subnetType: SubnetType.PRIVATE_WITH_EGRESS
  },
  container: {
    dockerFilePath: './src/internal/Dockerfile',
    containerPort: 9000
  },
  instanceProps: {
    instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.SMALL)
  }
});
```

### EC2 Instance with Existing VPC

```typescript
import { Vpc } from 'aws-cdk-lib/aws-ec2';

const existingVpc = Vpc.fromLookup(stack, 'ExistingVPC', {
  vpcName: 'production-vpc'
});

const instance = new Ec2Construct({
  instanceName: 'production-app',
  vpc: existingVpc,
  container: {
    dockerFilePath: './src/app/Dockerfile',
    containerPort: 3000
  },
  instanceProps: {
    instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE)
  }
});
```

## Volume Configuration Details

### Auto-Generated Device Names

When `deviceName` is not specified, the construct automatically generates sequential device names starting from `/dev/sdf`:

- First volume: `/dev/sdf`
- Second volume: `/dev/sdg`
- Third volume: `/dev/sdh`
- And so on...

### Default Volume Settings

When only `sizeGiB` is specified (without full `volume` configuration), the construct uses these defaults:

- **Volume Type**: GP3 (General Purpose SSD)
- **Encryption**: Enabled
- **Delete on Termination**: Default AWS behavior

### Supported Volume Types

- **GP3**: General Purpose SSD (default when using `sizeGiB`)
- **GP2**: General Purpose SSD (legacy)
- **IO1**: Provisioned IOPS SSD
- **IO2**: Provisioned IOPS SSD (next generation)
- **ST1**: Throughput Optimized HDD
- **SC1**: Cold HDD

## Security Groups

The construct creates and configures security groups based on your instance's needs:

1. **Default Security Group** (when creating new):
   - Allows inbound traffic on container port from within VPC CIDR
   - Allows SSH access (port 22) from within VPC CIDR
   - Allows all outbound traffic

2. **Existing Security Group** (when using `securityGroupId`):
   - Uses the specified security group as-is
   - Ensure it has appropriate rules for your container port

## Docker Container Deployment

The construct automatically:

1. **Installs Docker** on the EC2 instance via user data
2. **Configures AWS CLI** for ECR access
3. **Logs into ECR** using the instance role
4. **Pulls the Docker image** built from your Dockerfile
5. **Runs the container** with your specified configuration

### Container Runtime Behavior

- Container runs with `--restart unless-stopped` policy
- Container port is mapped to the same port on the host
- Environment variables are passed to the container
- Custom commands can be specified
- Container name defaults to instance name (customizable)

## IAM Permissions

The instance role automatically includes permissions for:

- ECR access (to pull Docker images)
- CloudWatch Logs (for logging)
- Additional permissions can be added via `instanceRole` configuration

## Best Practices

1. **Instance Configuration**
   - Choose appropriate instance type for your workload
   - Use private subnets for internal services
   - Enable detailed monitoring for production instances
   - Use spot instances for non-critical workloads (via `instanceProps`)

2. **Volume Management**
   - Use GP3 volumes for most workloads (default)
   - Use IO1/IO2 for high-performance databases
   - Enable encryption for sensitive data
   - Set `deleteOnTermination: false` for persistent data

3. **Security**
   - Use security groups to restrict access
   - Place instances in private subnets
   - Use IAM roles instead of access keys
   - Enable VPC Flow Logs for network monitoring
   - Regularly update AMIs and Docker images

4. **Container Configuration**
   - Use environment variables for configuration
   - Keep Docker images small and optimized
   - Implement health checks in your application
   - Use container logs for debugging

5. **Networking**
   - Use existing VPCs when possible
   - Place instances in appropriate subnets
   - Configure security groups properly
   - Use VPC endpoints for AWS services

6. **Monitoring**
   - Enable CloudWatch monitoring
   - Set up CloudWatch alarms
   - Monitor instance metrics and container logs
   - Track volume performance metrics

## Troubleshooting

Common issues and solutions:

1. **Container Not Starting**
   - Check instance logs: `sudo journalctl -u docker`
   - Verify Docker installation in user data
   - Check ECR login success
   - Verify container port configuration
   - Check environment variables

2. **Volume Issues**
   - Verify device names are not conflicting
   - Check volume attachment in AWS console
   - Ensure volumes are formatted if needed
   - Verify volume size and type compatibility

3. **Security Group Issues**
   - Verify security group rules allow container port
   - Check VPC CIDR blocks
   - Ensure security group is attached to instance
   - Verify subnet security group associations

4. **ECR Access Issues**
   - Verify instance role has ECR permissions
   - Check ECR repository exists and image is pushed
   - Verify ECR login in user data script
   - Check VPC endpoints for ECR (if using private subnets)

5. **Networking Issues**
   - Verify VPC configuration
   - Check route tables
   - Ensure internet gateway/NAT gateway for outbound traffic
   - Verify DNS resolution

6. **User Data Script Issues**
   - Check CloudWatch Logs for user data output
   - Verify script syntax
   - Check file permissions
   - Review script execution logs

7. **Instance Launch Failures**
   - Check IAM role permissions
   - Verify security group rules
   - Check subnet availability
   - Review instance launch logs

## Outputs

The construct automatically provides these outputs:

- **Instance ID**: `${instanceName}InstanceId`
- **Instance Private IP**: `${instanceName}InstancePrivateIp`
- **Instance Public IP**: `${instanceName}InstancePublicIp` (if in public subnet)
- **Instance Object**: Available via construct output with key `${instanceName}`

## Limitations

- Maximum of 11 auto-generated device names (sdf through sdp)
- Docker installation and container startup happens via user data (may take a few minutes)
- Instance must have internet access (direct or via NAT) for ECR pull during startup
- Custom user data will be appended to Docker setup script


# VPC Construct

The `VpcConstruct` in FW24 provides a streamlined way to create and configure Amazon VPC (Virtual Private Cloud) resources. It supports creating VPCs with customizable configurations, security groups, and subnet arrangements.

## Basic Configuration

To create a VPC with default settings:

```typescript
const vpcConfig: IVpcConstructConfig = {
    vpcName: 'my-application-vpc'
};

const vpc = new VpcConstruct(vpcConfig);
app.use(vpc);
```

## Advanced Configuration

For more complex VPC setups with custom properties and security groups:

```typescript
import { SubnetType, Peer, Port } from 'aws-cdk-lib/aws-ec2';

const vpcConfig: IVpcConstructConfig = {
    vpcName: 'my-custom-vpc',
    vpcProps: {
        maxAzs: 2,
        natGateways: 1,
        subnetConfiguration: [
            {
                cidrMask: 24,
                name: 'Private',
                subnetType: SubnetType.PRIVATE_WITH_EGRESS,
            },
            {
                cidrMask: 24,
                name: 'Public',
                subnetType: SubnetType.PUBLIC,
            }
        ]
    },
    securityGroups: [
        {
            securityGroupName: 'web-security-group',
            rules: [
                {
                    type: SecurityGroupType.INGRESS,
                    ip: Peer.anyIpv4(),
                    port: Port.tcp(80),
                    description: 'Allow HTTP traffic'
                },
                {
                    type: SecurityGroupType.INGRESS,
                    ip: Peer.anyIpv4(),
                    port: Port.tcp(443),
                    description: 'Allow HTTPS traffic'
                }
            ]
        }
    ]
};
```

## Configuration Options

### IVpcConstructConfig

The main configuration interface for the VPC construct:

| Property | Type | Description |
|----------|------|-------------|
| vpcName | string | Optional name for the VPC |
| vpcProps | VpcProps | AWS CDK VPC properties |
| securityGroups | ISecurityGroupConfig[] | Array of security group configurations |
| stackName | string | Optional stack name for the VPC resources |
| parentStackName | string | Optional parent stack name |

### Security Group Configuration

The `ISecurityGroupConfig` interface allows you to define security groups and their rules:

```typescript
interface ISecurityGroupConfig {
    securityGroupName: string;
    rules: [
        {
            type: SecurityGroupType;  // 'ingress' or 'egress'
            ip: IPeer;                // IP range or peer
            port: Port;               // Port or port range
            description: string;      // Rule description
        }
    ]
}
```

## Outputs

The VPC construct automatically creates and manages several outputs:

1. **VPC ID**: Available through the construct output with type `OutputType.VPC`
2. **Default Security Group**: Created automatically and available with type `OutputType.SECURITYGROUP`
3. **Subnet Information**:
   - Private subnets: `OutputType.SUBNETS` for private subnet selection
   - Public subnets: `OutputType.SUBNETS` for public subnet selection

## Best Practices

1. **VPC Design**:
   - Choose appropriate CIDR ranges for your VPC and subnets
   - Consider future growth when planning subnet sizes
   - Use meaningful names for VPCs and security groups

2. **Security Groups**:
   - Follow the principle of least privilege
   - Use descriptive names and descriptions for rules
   - Regularly review and audit security group rules

3. **Subnet Configuration**:
   - Plan your subnet strategy based on your application needs
   - Consider availability zone distribution
   - Use appropriate subnet types (PUBLIC, PRIVATE_WITH_EGRESS, etc.)

## Example Usage

### Basic VPC with Custom Security Group

```typescript
const vpcConfig: IVpcConstructConfig = {
    vpcName: 'application-vpc',
    securityGroups: [
        {
            securityGroupName: 'app-security-group',
            rules: [
                {
                    type: SecurityGroupType.INGRESS,
                    ip: Peer.ipv4('10.0.0.0/16'),
                    port: Port.tcp(3000),
                    description: 'Allow application traffic'
                }
            ]
        }
    ]
};

const vpc = new VpcConstruct(vpcConfig);
app.use(vpc);
```

### Multi-Stack VPC Configuration

```typescript
const vpcConfig: IVpcConstructConfig = {
    stackName: 'NetworkStack',
    vpcName: 'shared-vpc',
    vpcProps: {
        maxAzs: 3,
        natGateways: 1
    }
};

const vpc = new VpcConstruct(vpcConfig);
app.use(vpc);
``` 
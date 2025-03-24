# Fargate Construct

The Fargate Construct provides a high-level abstraction for deploying containerized applications on AWS ECS Fargate. It handles the complexities of container deployment, load balancing, service discovery, and auto-scaling.

## Features

- Container deployment with Docker
- Application Load Balancer integration
- Auto-scaling configuration
- Service discovery for internal services
- Health check management
- Security group configuration
- CloudWatch logging
- ECS task definitions
- Custom domain and SSL/TLS support
- EFS integration for persistent storage
- Circuit breaker for deployment safety
- Fargate Spot support for cost optimization

## Basic Usage

```typescript
const service = new FargateConstruct({
  serviceName: 'api',
  container: {
    dockerFilePath: './Dockerfile',
    containerPort: 3000,
    containerProps: {
      environment: {
        NODE_ENV: 'production'
      }
    }
  },
  taskDefinitionProps: {
    cpu: 512,
    memoryLimitMiB: 1024
  },
  serviceProps: {
    desiredCount: 2
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
  
  // Additional container properties
  containerProps?: {
    environment?: { [key: string]: string };
    healthCheck?: {
      command: string[];
      interval?: Duration;
      timeout?: Duration;
      retries?: number;
    };
    logging?: {
      driver: string;
      options: { [key: string]: string };
    };
    secrets?: { [key: string]: Secret };
  };
}
```

### Load Balancer Configuration

```typescript
interface ILoadBalancerConfig {
  // Custom domain for the ALB
  domainName?: string;
  
  // ACM certificate ARN for HTTPS
  certificateArn?: string;
  
  // Path-based routing patterns
  pathPatterns?: string[];
  
  // Host-based routing headers
  hostHeaders?: string[];
}
```

### Service Discovery Configuration

```typescript
interface IServiceDiscoveryConfig {
  // Service name in service discovery
  serviceName: string;
  
  // Private DNS namespace
  namespace: string;
}
```

### EFS Configuration

```typescript
interface IEFSConfig {
  // Name of the EFS file system
  name?: string;
  
  // Container path where EFS will be mounted
  containerPath: string;
  
  // EFS root directory to mount
  rootDirectory?: string;
  
  // Additional EFS properties
  fileSystemProps?: {
    performanceMode?: PerformanceMode;
    throughputMode?: ThroughputMode;
    removalPolicy?: RemovalPolicy;
  };
  
  // Access point configuration
  accessPointProps?: {
    posixUser?: {
      uid: string;
      gid: string;
    };
    createAcl?: {
      ownerUid: string;
      ownerGid: string;
      permissions: string;
    };
  };
}
```

### Service Properties

```typescript
interface IServiceProps {
  // Desired number of tasks
  desiredCount?: number;
  
  // Minimum healthy percentage
  minHealthyPercent?: number;
  
  // Maximum healthy percentage
  maxHealthyPercent?: number;
  
  // Auto-scaling configuration
  minCapacity?: number;
  maxCapacity?: number;
  targetCpuUtilization?: number;
  targetMemoryUtilization?: number;
  
  // Circuit breaker configuration
  circuitBreaker?: {
    rollback: boolean;
  };
}
```

## Examples

### Public-Facing API with HTTPS

```typescript
const api = new FargateConstruct({
  serviceName: 'api',
  vpcName: 'main-vpc',
  container: {
    dockerFilePath: './api/Dockerfile',
    containerPort: 3000,
    containerProps: {
      environment: {
        NODE_ENV: 'production'
      },
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:3000/health || exit 1'],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3
      }
    }
  },
  loadBalancer: {
    domainName: 'api.example.com',
    certificateArn: 'arn:aws:acm:region:account:certificate/id',
    pathPatterns: ['/api/*']
  },
  taskDefinitionProps: {
    cpu: 512,
    memoryLimitMiB: 1024
  },
  serviceProps: {
    desiredCount: 2,
    minCapacity: 2,
    maxCapacity: 10,
    targetCpuUtilization: 70,
    circuitBreaker: { rollback: true }
  }
});
```

### Internal Service with EFS and Service Discovery

```typescript
const worker = new FargateConstruct({
  serviceName: 'worker',
  vpcName: 'main-vpc',
  container: {
    dockerFilePath: './worker/Dockerfile',
    containerPort: 8080,
    containerProps: {
      environment: {
        QUEUE_URL: process.env.QUEUE_URL,
        DATA_DIR: '/data'
      }
    }
  },
  efs: {
    containerPath: '/data',
    rootDirectory: '/',
    accessPointProps: {
      posixUser: {
        uid: '1000',
        gid: '1000'
      },
      createAcl: {
        ownerUid: '1000',
        ownerGid: '1000',
        permissions: '755'
      }
    }
  },
  serviceDiscovery: {
    namespace: 'internal.local',
    serviceName: 'worker'
  },
  taskDefinitionProps: {
    cpu: 256,
    memoryLimitMiB: 512
  },
  serviceProps: {
    desiredCount: 1
  }
});
```

### Using Existing Resources

```typescript
const service = new FargateConstruct({
  serviceName: 'service',
  cluster: {
    name: 'existing-cluster'
  },
  securityGroup: {
    securityGroupId: 'sg-existing'
  },
  container: {
    dockerFilePath: './Dockerfile',
    containerPort: 3000
  }
});
```

## Security Groups

The construct creates and configures security groups based on your service's needs:

1. **Service Security Group**
   - For services with ALB: Allows inbound traffic only from the ALB security group on the container port
   - For internal services: Allows inbound traffic from within the VPC CIDR on the container port
   - For EFS: Allows inbound NFS traffic (2049) from the service security group

2. **ALB Security Group** (when using load balancer)
   - Allows inbound HTTPS (443) from anywhere
   - Automatically associated with the ALB

## Best Practices

1. **Container Configuration**
   - Always include health checks
   - Use environment variables for configuration
   - Keep container images small
   - Use multi-stage Dockerfiles
   - Set appropriate resource limits

2. **Networking**
   - Use private subnets for containers
   - Implement proper security group rules
   - Enable service discovery for internal services
   - Use VPC endpoints for AWS services

3. **Storage**
   - Use EFS for persistent storage needs
   - Configure proper POSIX permissions
   - Enable encryption at rest
   - Use appropriate performance mode

4. **Scaling**
   - Set appropriate CPU/memory limits
   - Configure auto-scaling based on metrics
   - Use target tracking scaling policies
   - Enable circuit breaker for deployments

5. **Monitoring**
   - Enable container insights
   - Set up proper logging
   - Monitor service metrics
   - Configure CloudWatch alarms

6. **Cost Optimization**
   - Use Fargate Spot for non-critical workloads
   - Right-size container resources
   - Implement proper scaling policies
   - Monitor EFS storage usage

## Troubleshooting

Common issues and solutions:

1. **Container Health Check Failures**
   - Verify health check endpoint is working
   - Check container logs
   - Ensure proper timeout/interval settings
   - Verify container port configuration

2. **Load Balancer Issues**
   - Verify security group rules
   - Check target group health
   - Validate SSL/TLS certificate
   - Check ALB listener configuration

3. **Service Discovery Problems**
   - Confirm namespace exists
   - Verify DNS resolution
   - Check VPC DNS settings
   - Validate service name uniqueness

4. **EFS Mount Issues**
   - Verify security group rules
   - Check POSIX permissions
   - Validate access point configuration
   - Ensure proper VPC connectivity

5. **Auto-Scaling Issues**
   - Review scaling policies
   - Check CloudWatch metrics
   - Verify capacity settings
   - Monitor service quotas

6. **Circuit Breaker Failures**
   - Check deployment logs
   - Verify task definition
   - Review service events
   - Check container health 
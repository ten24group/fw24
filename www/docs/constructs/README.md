# FW24 Constructs

FW24 provides a set of high-level constructs that abstract common AWS infrastructure patterns. These constructs are designed to work together seamlessly while following best practices for security, scalability, and maintainability.

## Core Constructs

### [API Construct](Api.md)
Creates API Gateway with Lambda integrations and supports:
- REST API endpoints with Lambda backend
- Custom domain names with SSL/TLS
- CORS configuration
- API key management
- Request/response validation
- Integration with Cognito authentication

### [Auth Construct](Auth.md)
Sets up AWS Cognito authentication with:
- User pools and identity pools
- Social sign-in (Google, Facebook)
- Custom email/SMS messages
- User groups and permissions
- MFA configuration
- Custom authentication flows

### [DynamoDB Construct](Dynamo.md)
Creates DynamoDB tables with advanced features:
- Automatic table creation
- Stream processing
- Audit logging
- Backup configuration
- Auto-scaling
- TTL settings

### [Fargate Construct](Fargate.md)
Deploys containerized applications on ECS Fargate:
- Container deployment
- Load balancer integration
- Auto-scaling
- Service discovery
- Health checks
- Security groups

### [Topic Construct](Topic.md)
Creates SNS topics for pub/sub messaging:
- Email/SMS subscriptions
- FIFO topics
- Message filtering
- Dead letter queues
- Cross-account access

### [VPC Construct](vpc.md)
Sets up VPC networking infrastructure:
- Multi-AZ deployment
- Public/private subnets
- NAT gateways
- Security groups
- Network ACLs

### [Queue Construct](Queue.md)
Creates SQS queues with:
- Standard and FIFO queues
- Dead letter queues
- Message retention
- Visibility timeout
- Lambda triggers

### [Bucket Construct](Bucket.md)
Sets up S3 buckets with:
- Lifecycle policies
- Versioning
- Encryption
- CORS configuration
- Event notifications

### [Layer Construct](Layer.md)
Creates Lambda layers for code sharing:
- Dependency management
- Version control
- Cross-runtime support
- Size optimization

### [Mailer Construct](Mailer.md)
Configures email sending via SES:
- Email templates
- Bounce handling
- Delivery tracking
- Domain verification
- DKIM setup

### [Scheduler Construct](Scheduler.md)
Creates EventBridge schedules:
- Cron jobs
- Rate-based schedules
- Target invocation
- Error handling
- State management

### [Site Construct](Site.md)
Deploys static websites:
- S3 hosting
- CloudFront distribution
- SSL/TLS certificates
- Custom domains
- Cache configuration

## Common Patterns

### Microservices Architecture
```typescript
// Create shared VPC
const vpc = new VpcConstruct({
  vpcName: 'main',
  vpcProps: { maxAzs: 2 }
});

// Auth service with Cognito
const auth = new AuthConstruct({
  userPool: {
    props: { selfSignUpEnabled: true }
  }
});

// API Gateway for public endpoints
const api = new APIConstruct({
  cors: true,
  apiOptions: {
    deployOptions: { stageName: 'v1' }
  }
});

// Microservices on Fargate
const userService = new FargateConstruct({
  serviceName: 'users',
  vpcName: vpc.name,
  container: {
    dockerFilePath: './services/users/Dockerfile',
    containerPort: 3000
  }
});

// DynamoDB tables
const userTable = new DynamoDBConstruct({
  table: {
    name: 'Users',
    props: {
      partitionKey: { name: 'id', type: 'STRING' }
    }
  }
});
```

### Event-Driven Architecture
```typescript
// Create table with streams
const table = new DynamoDBConstruct({
  table: {
    name: 'Events',
    stream: {
      topic: { name: 'data-changes' }
    },
    dynamoStream: StreamViewType.NEW_AND_OLD_IMAGES,
  }
});

// Create topics for different event types
const topics = new TopicConstruct([
  { topicName: 'user-events' },
  { topicName: 'order-events' }
]);

// Create queues for processing
const queues = new QueueConstruct();

```

## Best Practices

1. **Security**
   - Use VPC endpoints for AWS services
   - Enable encryption at rest
   - Implement least privilege access
   - Use security groups effectively

2. **Scalability**
   - Enable auto-scaling where appropriate
   - Use DynamoDB on-demand capacity
   - Implement caching strategies
   - Design for horizontal scaling

3. **Reliability**
   - Deploy across multiple AZs
   - Implement health checks
   - Use dead letter queues
   - Enable automated backups

4. **Cost Optimization**
   - Use Fargate Spot for non-critical workloads
   - Implement lifecycle policies
   - Monitor and adjust capacity
   - Clean up unused resources

5. **Operational Excellence**
   - Enable logging and monitoring
   - Implement proper tagging
   - Use Infrastructure as Code
   - Document configurations
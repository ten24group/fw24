import { APIGatewayClient, GetResourcesCommand, DeleteResourceCommand } from '@aws-sdk/client-api-gateway';
import { CloudFormationClient, ListStackResourcesCommand, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

/**
 * Event payload passed to the Lambda from the CDK Custom Resource
 */
interface ResourceMigrationEvent {
  restApiId: string;
  rootPaths: string[];
  mainStackName: string;
  mode: 'migrate';
  Payload?: string;
  body?: string;
}

/**
 * Response returned to CloudFormation Custom Resource
 */
interface ResourceMigrationResponse {
  statusCode: number;
  body: string;
}

/**
 * API Gateway resource representation from AWS SDK
 */
interface ApiGatewayResource {
  id?: string;
  pathPart?: string;
  path?: string;
}

/**
 * Lambda handler for API Gateway resource migration.
 * 
 * This function queries actual AWS state to detect when resources exist in the wrong stack.
 * It only deletes resources when a genuine conflict is detected (resource in nested stack
 * but needs to be in main stack). This allows CloudFormation to recreate them correctly.
 * 
 * The function is idempotent - running it multiple times is safe. It queries real AWS state
 * on every invocation, making it reliable across CI/CD, multiple developers, and environments.
 * 
 * @param event - Contains restApiId, rootPaths, and mainStackName
 * @returns Response indicating success and actions taken
 */
export const handler = async (event: ResourceMigrationEvent): Promise<ResourceMigrationResponse> => {
  console.log('Resource migration handler invoked:', JSON.stringify(event, null, 2));

  // Parse payload - handle different invocation formats (direct, wrapped in Payload, or body)
  let restApiId: string;
  let rootPaths: string[];
  let mainStackName: string;

  if (event.Payload) {
    const payload = JSON.parse(event.Payload);
    restApiId = payload.restApiId;
    rootPaths = payload.rootPaths;
    mainStackName = payload.mainStackName;
  } else if (event.body) {
    const body = JSON.parse(event.body);
    restApiId = body.restApiId;
    rootPaths = body.rootPaths;
    mainStackName = body.mainStackName;
  } else {
    restApiId = event.restApiId;
    rootPaths = event.rootPaths;
    mainStackName = event.mainStackName;
  }

  // Validate required parameters
  if (!restApiId || !rootPaths || rootPaths.length === 0 || !mainStackName) {
    console.log('No migration needed - missing parameters');
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'No migration needed' })
    };
  }

  console.log(`Starting resource migration check for API: ${restApiId}`);
  console.log(`Main stack: ${mainStackName}`);
  console.log(`Root paths to migrate: ${rootPaths.join(', ')}`);

  const apiGatewayClient = new APIGatewayClient({});
  const cloudFormationClient = new CloudFormationClient({});

  try {
    // Step 1: Get all existing resources from API Gateway
    console.log('Fetching all API Gateway resources...');
    const getResourcesResponse = await apiGatewayClient.send(new GetResourcesCommand({
      restApiId: restApiId,
      limit: 500 // Max allowed by API Gateway
    }));

    const resources: ApiGatewayResource[] = getResourcesResponse.items || [];
    console.log(`Found ${resources.length} total resources in API Gateway`);

    // Step 2: For each root path, check if it exists and who owns it
    const conflictingResources: ApiGatewayResource[] = [];

    for (const rootPath of rootPaths) {
      const targetPath = `/${rootPath}`;
      const existingResource = resources.find(r => r.path === targetPath);

      if (!existingResource) {
        console.log(`✓ ${targetPath} - does not exist yet (will be created fresh)`);
        continue;
      }

      // Step 3: Find which CloudFormation stack owns this resource
      console.log(`Checking ownership for ${targetPath} (id: ${existingResource.id})...`);
      const ownerStack = await findResourceOwnerStack(
        cloudFormationClient,
        existingResource.id!,
        mainStackName
      );

      if (!ownerStack) {
        console.log(`✓ ${targetPath} - not managed by CloudFormation (will reuse)`);
        continue;
      }

      // Step 4: Check if resource is in the correct stack
      if (ownerStack === mainStackName) {
        // Resource is in main stack (correct location)
        console.log(`✓ ${targetPath} - already in main stack (reusing)`);
        continue;
      }

      // Step 5: Conflict detected - resource is in a nested stack
      console.log(`⚠️  CONFLICT DETECTED: ${targetPath} owned by ${ownerStack} (needs to be in ${mainStackName})`);

      // Find ALL child resources under this path
      const childResources = resources.filter(r => {
        return r.path === targetPath || r.path?.startsWith(`${targetPath}/`);
      });

      conflictingResources.push(...childResources);
      console.log(`   Will delete ${childResources.length} resources: ${childResources.map(r => r.path).join(', ')}`);
    }

    // Step 6: Delete conflicting resources
    if (conflictingResources.length === 0) {
      console.log('✅ No conflicts detected - all resources are correctly placed');
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No conflicts detected',
          action: 'none',
          rootPaths: rootPaths
        })
      };
    }

    console.log(`Deleting ${conflictingResources.length} conflicting resources...`);

    // Sort by path depth (deepest first) to avoid parent-child deletion issues
    conflictingResources.sort((a, b) => {
      const depthA = (a.path?.match(/\//g) || []).length;
      const depthB = (b.path?.match(/\//g) || []).length;
      return depthB - depthA;
    });

    let deletedCount = 0;
    for (const resource of conflictingResources) {
      console.log(`Deleting conflicting resource: ${resource.path} (id: ${resource.id})`);
      try {
        await apiGatewayClient.send(new DeleteResourceCommand({
          restApiId: restApiId,
          resourceId: resource.id!
        }));
        console.log(`✅ Successfully deleted: ${resource.path}`);
        deletedCount++;
      } catch (error) {
        if ((error as Error).name === 'NotFoundException') {
          console.log(`⚠️  Resource ${resource.path} not found (may be already deleted)`);
        } else {
          console.error(`❌ Failed to delete ${resource.path}:`, error);
          throw error;
        }
      }
    }

    console.log(`Migration complete: deleted ${deletedCount}/${conflictingResources.length} resources`);
    console.log('CloudFormation will now create these resources in the main stack');

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Migration completed successfully',
        action: 'deleted-conflicting-resources',
        deletedCount: deletedCount,
        rootPaths: rootPaths
      })
    };
  } catch (error) {
    console.error('❌ Error during resource migration:', error);
    throw error;
  }
};

/**
 * Finds which CloudFormation stack owns a specific API Gateway resource.
 * 
 * This function queries CloudFormation stacks to find which stack created
 * the given resource ID. It helps determine if a resource is in the main stack
 * or a nested stack.
 * 
 * @param cfClient - CloudFormation client instance
 * @param resourceId - The API Gateway resource ID to look up
 * @param mainStackName - The name of the main stack (for filtering)
 * @returns Stack name that owns the resource, or null if not found
 */
async function findResourceOwnerStack(
  cfClient: CloudFormationClient,
  resourceId: string,
  mainStackName: string
): Promise<string | null> {
  try {
    // Get all stacks (we'll filter to only related stacks)
    const describeStacksResponse = await cfClient.send(new DescribeStacksCommand({}));
    const allStacks = describeStacksResponse.Stacks || [];

    // Filter to stacks that are related to our main stack (main stack + its nested stacks)
    const relatedStacks = allStacks.filter(stack => {
      const stackName = stack.StackName || '';
      return stackName === mainStackName || stackName.startsWith(`${mainStackName}-`);
    });

    console.log(`Checking ${relatedStacks.length} related stacks for resource ${resourceId}`);

    // Check each stack's resources to find the owner
    for (const stack of relatedStacks) {
      const stackName = stack.StackName!;

      try {
        const listResourcesResponse = await cfClient.send(new ListStackResourcesCommand({
          StackName: stackName
        }));

        const resources = listResourcesResponse.StackResourceSummaries || [];
        const found = resources.find(r => r.PhysicalResourceId === resourceId);

        if (found) {
          console.log(`Resource ${resourceId} is owned by stack: ${stackName}`);
          return stackName;
        }
      } catch (error) {
        // Stack might be in a state where we can't list resources (e.g., DELETE_COMPLETE)
        // This is fine - continue checking other stacks
        console.log(`Skipping stack ${stackName}: ${(error as Error).message}`);
      }
    }

    console.log(`Resource ${resourceId} not found in any CloudFormation stack`);
    return null;
  } catch (error) {
    console.error(`Error finding resource owner:`, error);
    return null;
  }
}

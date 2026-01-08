"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_api_gateway_1 = require("@aws-sdk/client-api-gateway");
const client_cloudformation_1 = require("@aws-sdk/client-cloudformation");
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
const handler = async (event) => {
    console.log('Resource migration handler invoked:', JSON.stringify(event, null, 2));
    // Parse payload - handle different invocation formats (direct, wrapped in Payload, or body)
    let restApiId;
    let rootPaths;
    let mainStackName;
    if (event.Payload) {
        const payload = JSON.parse(event.Payload);
        restApiId = payload.restApiId;
        rootPaths = payload.rootPaths;
        mainStackName = payload.mainStackName;
    }
    else if (event.body) {
        const body = JSON.parse(event.body);
        restApiId = body.restApiId;
        rootPaths = body.rootPaths;
        mainStackName = body.mainStackName;
    }
    else {
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
    const apiGatewayClient = new client_api_gateway_1.APIGatewayClient({});
    const cloudFormationClient = new client_cloudformation_1.CloudFormationClient({});
    try {
        // Step 1: Get all existing resources from API Gateway
        console.log('Fetching all API Gateway resources...');
        const getResourcesResponse = await apiGatewayClient.send(new client_api_gateway_1.GetResourcesCommand({
            restApiId: restApiId,
            limit: 500 // Max allowed by API Gateway
        }));
        const resources = getResourcesResponse.items || [];
        console.log(`Found ${resources.length} total resources in API Gateway`);
        // Step 2: For each root path, check if it exists and who owns it
        const conflictingResources = [];
        for (const rootPath of rootPaths) {
            const targetPath = `/${rootPath}`;
            const existingResource = resources.find(r => r.path === targetPath);
            if (!existingResource) {
                console.log(`✓ ${targetPath} - does not exist yet (will be created fresh)`);
                continue;
            }
            // Step 3: Find which CloudFormation stack owns this resource
            console.log(`Checking ownership for ${targetPath} (id: ${existingResource.id})...`);
            const ownerStack = await findResourceOwnerStack(cloudFormationClient, existingResource.id, mainStackName);
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
                await apiGatewayClient.send(new client_api_gateway_1.DeleteResourceCommand({
                    restApiId: restApiId,
                    resourceId: resource.id
                }));
                console.log(`✅ Successfully deleted: ${resource.path}`);
                deletedCount++;
            }
            catch (error) {
                if (error.name === 'NotFoundException') {
                    console.log(`⚠️  Resource ${resource.path} not found (may be already deleted)`);
                }
                else {
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
    }
    catch (error) {
        console.error('❌ Error during resource migration:', error);
        throw error;
    }
};
exports.handler = handler;
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
async function findResourceOwnerStack(cfClient, resourceId, mainStackName) {
    try {
        // Get all stacks (we'll filter to only related stacks)
        const describeStacksResponse = await cfClient.send(new client_cloudformation_1.DescribeStacksCommand({}));
        const allStacks = describeStacksResponse.Stacks || [];
        // Filter to stacks that are related to our main stack (main stack + its nested stacks)
        const relatedStacks = allStacks.filter(stack => {
            const stackName = stack.StackName || '';
            return stackName === mainStackName || stackName.startsWith(`${mainStackName}-`);
        });
        console.log(`Checking ${relatedStacks.length} related stacks for resource ${resourceId}`);
        // Check each stack's resources to find the owner
        for (const stack of relatedStacks) {
            const stackName = stack.StackName;
            try {
                const listResourcesResponse = await cfClient.send(new client_cloudformation_1.ListStackResourcesCommand({
                    StackName: stackName
                }));
                const resources = listResourcesResponse.StackResourceSummaries || [];
                const found = resources.find(r => r.PhysicalResourceId === resourceId);
                if (found) {
                    console.log(`Resource ${resourceId} is owned by stack: ${stackName}`);
                    return stackName;
                }
            }
            catch (error) {
                // Stack might be in a state where we can't list resources (e.g., DELETE_COMPLETE)
                // This is fine - continue checking other stacks
                console.log(`Skipping stack ${stackName}: ${error.message}`);
            }
        }
        console.log(`Resource ${resourceId} not found in any CloudFormation stack`);
        return null;
    }
    catch (error) {
        console.error(`Error finding resource owner:`, error);
        return null;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWdhdGV3YXktcmVzb3VyY2UtbWlncmF0aW9uLWhhbmRsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9hcGktZ2F0ZXdheS1yZXNvdXJjZS1taWdyYXRpb24taGFuZGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxvRUFBMkc7QUFDM0csMEVBQXdIO0FBK0J4SDs7Ozs7Ozs7Ozs7O0dBWUc7QUFDSSxNQUFNLE9BQU8sR0FBRyxLQUFLLEVBQUUsS0FBNkIsRUFBc0MsRUFBRTtJQUNqRyxPQUFPLENBQUMsR0FBRyxDQUFDLHFDQUFxQyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBRW5GLDRGQUE0RjtJQUM1RixJQUFJLFNBQWlCLENBQUM7SUFDdEIsSUFBSSxTQUFtQixDQUFDO0lBQ3hCLElBQUksYUFBcUIsQ0FBQztJQUUxQixJQUFJLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUNsQixNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUMxQyxTQUFTLEdBQUcsT0FBTyxDQUFDLFNBQVMsQ0FBQztRQUM5QixTQUFTLEdBQUcsT0FBTyxDQUFDLFNBQVMsQ0FBQztRQUM5QixhQUFhLEdBQUcsT0FBTyxDQUFDLGFBQWEsQ0FBQztJQUN4QyxDQUFDO1NBQU0sSUFBSSxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDdEIsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDcEMsU0FBUyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUM7UUFDM0IsU0FBUyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUM7UUFDM0IsYUFBYSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUM7SUFDckMsQ0FBQztT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LENBQUM7SUFDZCxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFQSUdhdGV3YXlDbGllbnQsIEdldFJlc291cmNlc0NvbW1hbmQsIERlbGV0ZVJlc291cmNlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1hcGktZ2F0ZXdheSc7XG5pbXBvcnQgeyBDbG91ZEZvcm1hdGlvbkNsaWVudCwgTGlzdFN0YWNrUmVzb3VyY2VzQ29tbWFuZCwgRGVzY3JpYmVTdGFja3NDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWNsb3VkZm9ybWF0aW9uJztcblxuLyoqXG4gKiBFdmVudCBwYXlsb2FkIHBhc3NlZCB0byB0aGUgTGFtYmRhIGZyb20gdGhlIENESyBDdXN0b20gUmVzb3VyY2VcbiAqL1xuaW50ZXJmYWNlIFJlc291cmNlTWlncmF0aW9uRXZlbnQge1xuICByZXN0QXBpSWQ6IHN0cmluZztcbiAgcm9vdFBhdGhzOiBzdHJpbmdbXTtcbiAgbWFpblN0YWNrTmFtZTogc3RyaW5nO1xuICBtb2RlOiAnbWlncmF0ZSc7XG4gIFBheWxvYWQ/OiBzdHJpbmc7XG4gIGJvZHk/OiBzdHJpbmc7XG59XG5cbi8qKlxuICogUmVzcG9uc2UgcmV0dXJuZWQgdG8gQ2xvdWRGb3JtYXRpb24gQ3VzdG9tIFJlc291cmNlXG4gKi9cbmludGVyZmFjZSBSZXNvdXJjZU1pZ3JhdGlvblJlc3BvbnNlIHtcbiAgc3RhdHVzQ29kZTogbnVtYmVyO1xuICBib2R5OiBzdHJpbmc7XG59XG5cbi8qKlxuICogQVBJIEdhdGV3YXkgcmVzb3VyY2UgcmVwcmVzZW50YXRpb24gZnJvbSBBV1MgU0RLXG4gKi9cbmludGVyZmFjZSBBcGlHYXRld2F5UmVzb3VyY2Uge1xuICBpZD86IHN0cmluZztcbiAgcGF0aFBhcnQ/OiBzdHJpbmc7XG4gIHBhdGg/OiBzdHJpbmc7XG59XG5cbi8qKlxuICogTGFtYmRhIGhhbmRsZXIgZm9yIEFQSSBHYXRld2F5IHJlc291cmNlIG1pZ3JhdGlvbi5cbiAqIFxuICogVGhpcyBmdW5jdGlvbiBxdWVyaWVzIGFjdHVhbCBBV1Mgc3RhdGUgdG8gZGV0ZWN0IHdoZW4gcmVzb3VyY2VzIGV4aXN0IGluIHRoZSB3cm9uZyBzdGFjay5cbiAqIEl0IG9ubHkgZGVsZXRlcyByZXNvdXJjZXMgd2hlbiBhIGdlbnVpbmUgY29uZmxpY3QgaXMgZGV0ZWN0ZWQgKHJlc291cmNlIGluIG5lc3RlZCBzdGFja1xuICogYnV0IG5lZWRzIHRvIGJlIGluIG1haW4gc3RhY2spLiBUaGlzIGFsbG93cyBDbG91ZEZvcm1hdGlvbiB0byByZWNyZWF0ZSB0aGVtIGNvcnJlY3RseS5cbiAqIFxuICogVGhlIGZ1bmN0aW9uIGlzIGlkZW1wb3RlbnQgLSBydW5uaW5nIGl0IG11bHRpcGxlIHRpbWVzIGlzIHNhZmUuIEl0IHF1ZXJpZXMgcmVhbCBBV1Mgc3RhdGVcbiAqIG9uIGV2ZXJ5IGludm9jYXRpb24sIG1ha2luZyBpdCByZWxpYWJsZSBhY3Jvc3MgQ0kvQ0QsIG11bHRpcGxlIGRldmVsb3BlcnMsIGFuZCBlbnZpcm9ubWVudHMuXG4gKiBcbiAqIEBwYXJhbSBldmVudCAtIENvbnRhaW5zIHJlc3RBcGlJZCwgcm9vdFBhdGhzLCBhbmQgbWFpblN0YWNrTmFtZVxuICogQHJldHVybnMgUmVzcG9uc2UgaW5kaWNhdGluZyBzdWNjZXNzIGFuZCBhY3Rpb25zIHRha2VuXG4gKi9cbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKGV2ZW50OiBSZXNvdXJjZU1pZ3JhdGlvbkV2ZW50KTogUHJvbWlzZTxSZXNvdXJjZU1pZ3JhdGlvblJlc3BvbnNlPiA9PiB7XG4gIGNvbnNvbGUubG9nKCdSZXNvdXJjZSBtaWdyYXRpb24gaGFuZGxlciBpbnZva2VkOicsIEpTT04uc3RyaW5naWZ5KGV2ZW50LCBudWxsLCAyKSk7XG5cbiAgLy8gUGFyc2UgcGF5bG9hZCAtIGhhbmRsZSBkaWZmZXJlbnQgaW52b2NhdGlvbiBmb3JtYXRzIChkaXJlY3QsIHdyYXBwZWQgaW4gUGF5bG9hZCwgb3IgYm9keSlcbiAgbGV0IHJlc3RBcGlJZDogc3RyaW5nO1xuICBsZXQgcm9vdFBhdGhzOiBzdHJpbmdbXTtcbiAgbGV0IG1haW5TdGFja05hbWU6IHN0cmluZztcblxuICBpZiAoZXZlbnQuUGF5bG9hZCkge1xuICAgIGNvbnN0IHBheWxvYWQgPSBKU09OLnBhcnNlKGV2ZW50LlBheWxvYWQpO1xuICAgIHJlc3RBcGlJZCA9IHBheWxvYWQucmVzdEFwaUlkO1xuICAgIHJvb3RQYXRocyA9IHBheWxvYWQucm9vdFBhdGhzO1xuICAgIG1haW5TdGFja05hbWUgPSBwYXlsb2FkLm1haW5TdGFja05hbWU7XG4gIH0gZWxzZSBpZiAoZXZlbnQuYm9keSkge1xuICAgIGNvbnN0IGJvZHkgPSBKU09OLnBhcnNlKGV2ZW50LmJvZHkpO1xuICAgIHJlc3RBcGlJZCA9IGJvZHkucmVzdEFwaUlkO1xuICAgIHJvb3RQYXRocyA9IGJvZHkucm9vdFBhdGhzO1xuICAgIG1haW5TdGFja05hbWUgPSBib2R5Lm1haW5TdGFja05hbWU7XG4gIH0gZWxzZSB7XG4gICAgcmVzdEFwaUlkID0gZXZlbnQucmVzdEFwaUlkO1xuICAgIHJvb3RQYXRocyA9IGV2ZW50LnJvb3RQYXRocztcbiAgICBtYWluU3RhY2tOYW1lID0gZXZlbnQubWFpblN0YWNrTmFtZTtcbiAgfVxuXG4gIC8vIFZhbGlkYXRlIHJlcXVpcmVkIHBhcmFtZXRlcnNcbiAgaWYgKCFyZXN0QXBpSWQgfHwgIXJvb3RQYXRocyB8fCByb290UGF0aHMubGVuZ3RoID09PSAwIHx8ICFtYWluU3RhY2tOYW1lKSB7XG4gICAgY29uc29sZS5sb2coJ05vIG1pZ3JhdGlvbiBuZWVkZWQgLSBtaXNzaW5nIHBhcmFtZXRlcnMnKTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBtZXNzYWdlOiAnTm8gbWlncmF0aW9uIG5lZWRlZCcgfSlcbiAgICB9O1xuICB9XG5cbiAgY29uc29sZS5sb2coYFN0YXJ0aW5nIHJlc291cmNlIG1pZ3JhdGlvbiBjaGVjayBmb3IgQVBJOiAke3Jlc3RBcGlJZH1gKTtcbiAgY29uc29sZS5sb2coYE1haW4gc3RhY2s6ICR7bWFpblN0YWNrTmFtZX1gKTtcbiAgY29uc29sZS5sb2coYFJvb3QgcGF0aHMgdG8gbWlncmF0ZTogJHtyb290UGF0aHMuam9pbignLCAnKX1gKTtcblxuICBjb25zdCBhcGlHYXRld2F5Q2xpZW50ID0gbmV3IEFQSUdhdGV3YXlDbGllbnQoe30pO1xuICBjb25zdCBjbG91ZEZvcm1hdGlvbkNsaWVudCA9IG5ldyBDbG91ZEZvcm1hdGlvbkNsaWVudCh7fSk7XG5cbiAgdHJ5IHtcbiAgICAvLyBTdGVwIDE6IEdldCBhbGwgZXhpc3RpbmcgcmVzb3VyY2VzIGZyb20gQVBJIEdhdGV3YXlcbiAgICBjb25zb2xlLmxvZygnRmV0Y2hpbmcgYWxsIEFQSSBHYXRld2F5IHJlc291cmNlcy4uLicpO1xuICAgIGNvbnN0IGdldFJlc291cmNlc1Jlc3BvbnNlID0gYXdhaXQgYXBpR2F0ZXdheUNsaWVudC5zZW5kKG5ldyBHZXRSZXNvdXJjZXNDb21tYW5kKHtcbiAgICAgIHJlc3RBcGlJZDogcmVzdEFwaUlkLFxuICAgICAgbGltaXQ6IDUwMCAvLyBNYXggYWxsb3dlZCBieSBBUEkgR2F0ZXdheVxuICAgIH0pKTtcblxuICAgIGNvbnN0IHJlc291cmNlczogQXBpR2F0ZXdheVJlc291cmNlW10gPSBnZXRSZXNvdXJjZXNSZXNwb25zZS5pdGVtcyB8fCBbXTtcbiAgICBjb25zb2xlLmxvZyhgRm91bmQgJHtyZXNvdXJjZXMubGVuZ3RofSB0b3RhbCByZXNvdXJjZXMgaW4gQVBJIEdhdGV3YXlgKTtcblxuICAgIC8vIFN0ZXAgMjogRm9yIGVhY2ggcm9vdCBwYXRoLCBjaGVjayBpZiBpdCBleGlzdHMgYW5kIHdobyBvd25zIGl0XG4gICAgY29uc3QgY29uZmxpY3RpbmdSZXNvdXJjZXM6IEFwaUdhdGV3YXlSZXNvdXJjZVtdID0gW107XG5cbiAgICBmb3IgKGNvbnN0IHJvb3RQYXRoIG9mIHJvb3RQYXRocykge1xuICAgICAgY29uc3QgdGFyZ2V0UGF0aCA9IGAvJHtyb290UGF0aH1gO1xuICAgICAgY29uc3QgZXhpc3RpbmdSZXNvdXJjZSA9IHJlc291cmNlcy5maW5kKHIgPT4gci5wYXRoID09PSB0YXJnZXRQYXRoKTtcblxuICAgICAgaWYgKCFleGlzdGluZ1Jlc291cmNlKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGDinJMgJHt0YXJnZXRQYXRofSAtIGRvZXMgbm90IGV4aXN0IHlldCAod2lsbCBiZSBjcmVhdGVkIGZyZXNoKWApO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgLy8gU3RlcCAzOiBGaW5kIHdoaWNoIENsb3VkRm9ybWF0aW9uIHN0YWNrIG93bnMgdGhpcyByZXNvdXJjZVxuICAgICAgY29uc29sZS5sb2coYENoZWNraW5nIG93bmVyc2hpcCBmb3IgJHt0YXJnZXRQYXRofSAoaWQ6ICR7ZXhpc3RpbmdSZXNvdXJjZS5pZH0pLi4uYCk7XG4gICAgICBjb25zdCBvd25lclN0YWNrID0gYXdhaXQgZmluZFJlc291cmNlT3duZXJTdGFjayhcbiAgICAgICAgY2xvdWRGb3JtYXRpb25DbGllbnQsXG4gICAgICAgIGV4aXN0aW5nUmVzb3VyY2UuaWQhLFxuICAgICAgICBtYWluU3RhY2tOYW1lXG4gICAgICApO1xuXG4gICAgICBpZiAoIW93bmVyU3RhY2spIHtcbiAgICAgICAgY29uc29sZS5sb2coYOKckyAke3RhcmdldFBhdGh9IC0gbm90IG1hbmFnZWQgYnkgQ2xvdWRGb3JtYXRpb24gKHdpbGwgcmV1c2UpYCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBTdGVwIDQ6IENoZWNrIGlmIHJlc291cmNlIGlzIGluIHRoZSBjb3JyZWN0IHN0YWNrXG4gICAgICBpZiAob3duZXJTdGFjayA9PT0gbWFpblN0YWNrTmFtZSkge1xuICAgICAgICAvLyBSZXNvdXJjZSBpcyBpbiBtYWluIHN0YWNrIChjb3JyZWN0IGxvY2F0aW9uKVxuICAgICAgICBjb25zb2xlLmxvZyhg4pyTICR7dGFyZ2V0UGF0aH0gLSBhbHJlYWR5IGluIG1haW4gc3RhY2sgKHJldXNpbmcpYCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBTdGVwIDU6IENvbmZsaWN0IGRldGVjdGVkIC0gcmVzb3VyY2UgaXMgaW4gYSBuZXN0ZWQgc3RhY2tcbiAgICAgIGNvbnNvbGUubG9nKGDimqDvuI8gIENPTkZMSUNUIERFVEVDVEVEOiAke3RhcmdldFBhdGh9IG93bmVkIGJ5ICR7b3duZXJTdGFja30gKG5lZWRzIHRvIGJlIGluICR7bWFpblN0YWNrTmFtZX0pYCk7XG5cbiAgICAgIC8vIEZpbmQgQUxMIGNoaWxkIHJlc291cmNlcyB1bmRlciB0aGlzIHBhdGhcbiAgICAgIGNvbnN0IGNoaWxkUmVzb3VyY2VzID0gcmVzb3VyY2VzLmZpbHRlcihyID0+IHtcbiAgICAgICAgcmV0dXJuIHIucGF0aCA9PT0gdGFyZ2V0UGF0aCB8fCByLnBhdGg/LnN0YXJ0c1dpdGgoYCR7dGFyZ2V0UGF0aH0vYCk7XG4gICAgICB9KTtcblxuICAgICAgY29uZmxpY3RpbmdSZXNvdXJjZXMucHVzaCguLi5jaGlsZFJlc291cmNlcyk7XG4gICAgICBjb25zb2xlLmxvZyhgICAgV2lsbCBkZWxldGUgJHtjaGlsZFJlc291cmNlcy5sZW5ndGh9IHJlc291cmNlczogJHtjaGlsZFJlc291cmNlcy5tYXAociA9PiByLnBhdGgpLmpvaW4oJywgJyl9YCk7XG4gICAgfVxuXG4gICAgLy8gU3RlcCA2OiBEZWxldGUgY29uZmxpY3RpbmcgcmVzb3VyY2VzXG4gICAgaWYgKGNvbmZsaWN0aW5nUmVzb3VyY2VzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgY29uc29sZS5sb2coJ+KchSBObyBjb25mbGljdHMgZGV0ZWN0ZWQgLSBhbGwgcmVzb3VyY2VzIGFyZSBjb3JyZWN0bHkgcGxhY2VkJyk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBtZXNzYWdlOiAnTm8gY29uZmxpY3RzIGRldGVjdGVkJyxcbiAgICAgICAgICBhY3Rpb246ICdub25lJyxcbiAgICAgICAgICByb290UGF0aHM6IHJvb3RQYXRoc1xuICAgICAgICB9KVxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjb25zb2xlLmxvZyhgRGVsZXRpbmcgJHtjb25mbGljdGluZ1Jlc291cmNlcy5sZW5ndGh9IGNvbmZsaWN0aW5nIHJlc291cmNlcy4uLmApO1xuXG4gICAgLy8gU29ydCBieSBwYXRoIGRlcHRoIChkZWVwZXN0IGZpcnN0KSB0byBhdm9pZCBwYXJlbnQtY2hpbGQgZGVsZXRpb24gaXNzdWVzXG4gICAgY29uZmxpY3RpbmdSZXNvdXJjZXMuc29ydCgoYSwgYikgPT4ge1xuICAgICAgY29uc3QgZGVwdGhBID0gKGEucGF0aD8ubWF0Y2goL1xcLy9nKSB8fCBbXSkubGVuZ3RoO1xuICAgICAgY29uc3QgZGVwdGhCID0gKGIucGF0aD8ubWF0Y2goL1xcLy9nKSB8fCBbXSkubGVuZ3RoO1xuICAgICAgcmV0dXJuIGRlcHRoQiAtIGRlcHRoQTtcbiAgICB9KTtcblxuICAgIGxldCBkZWxldGVkQ291bnQgPSAwO1xuICAgIGZvciAoY29uc3QgcmVzb3VyY2Ugb2YgY29uZmxpY3RpbmdSZXNvdXJjZXMpIHtcbiAgICAgIGNvbnNvbGUubG9nKGBEZWxldGluZyBjb25mbGljdGluZyByZXNvdXJjZTogJHtyZXNvdXJjZS5wYXRofSAoaWQ6ICR7cmVzb3VyY2UuaWR9KWApO1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgYXBpR2F0ZXdheUNsaWVudC5zZW5kKG5ldyBEZWxldGVSZXNvdXJjZUNvbW1hbmQoe1xuICAgICAgICAgIHJlc3RBcGlJZDogcmVzdEFwaUlkLFxuICAgICAgICAgIHJlc291cmNlSWQ6IHJlc291cmNlLmlkIVxuICAgICAgICB9KSk7XG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgU3VjY2Vzc2Z1bGx5IGRlbGV0ZWQ6ICR7cmVzb3VyY2UucGF0aH1gKTtcbiAgICAgICAgZGVsZXRlZENvdW50Kys7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoKGVycm9yIGFzIEVycm9yKS5uYW1lID09PSAnTm90Rm91bmRFeGNlcHRpb24nKSB7XG4gICAgICAgICAgY29uc29sZS5sb2coYOKaoO+4jyAgUmVzb3VyY2UgJHtyZXNvdXJjZS5wYXRofSBub3QgZm91bmQgKG1heSBiZSBhbHJlYWR5IGRlbGV0ZWQpYCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc29sZS5lcnJvcihg4p2MIEZhaWxlZCB0byBkZWxldGUgJHtyZXNvdXJjZS5wYXRofTpgLCBlcnJvcik7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zb2xlLmxvZyhgTWlncmF0aW9uIGNvbXBsZXRlOiBkZWxldGVkICR7ZGVsZXRlZENvdW50fS8ke2NvbmZsaWN0aW5nUmVzb3VyY2VzLmxlbmd0aH0gcmVzb3VyY2VzYCk7XG4gICAgY29uc29sZS5sb2coJ0Nsb3VkRm9ybWF0aW9uIHdpbGwgbm93IGNyZWF0ZSB0aGVzZSByZXNvdXJjZXMgaW4gdGhlIG1haW4gc3RhY2snKTtcblxuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIG1lc3NhZ2U6ICdNaWdyYXRpb24gY29tcGxldGVkIHN1Y2Nlc3NmdWxseScsXG4gICAgICAgIGFjdGlvbjogJ2RlbGV0ZWQtY29uZmxpY3RpbmctcmVzb3VyY2VzJyxcbiAgICAgICAgZGVsZXRlZENvdW50OiBkZWxldGVkQ291bnQsXG4gICAgICAgIHJvb3RQYXRoczogcm9vdFBhdGhzXG4gICAgICB9KVxuICAgIH07XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcign4p2MIEVycm9yIGR1cmluZyByZXNvdXJjZSBtaWdyYXRpb246JywgZXJyb3IpO1xuICAgIHRocm93IGVycm9yO1xuICB9XG59O1xuXG4vKipcbiAqIEZpbmRzIHdoaWNoIENsb3VkRm9ybWF0aW9uIHN0YWNrIG93bnMgYSBzcGVjaWZpYyBBUEkgR2F0ZXdheSByZXNvdXJjZS5cbiAqIFxuICogVGhpcyBmdW5jdGlvbiBxdWVyaWVzIENsb3VkRm9ybWF0aW9uIHN0YWNrcyB0byBmaW5kIHdoaWNoIHN0YWNrIGNyZWF0ZWRcbiAqIHRoZSBnaXZlbiByZXNvdXJjZSBJRC4gSXQgaGVscHMgZGV0ZXJtaW5lIGlmIGEgcmVzb3VyY2UgaXMgaW4gdGhlIG1haW4gc3RhY2tcbiAqIG9yIGEgbmVzdGVkIHN0YWNrLlxuICogXG4gKiBAcGFyYW0gY2ZDbGllbnQgLSBDbG91ZEZvcm1hdGlvbiBjbGllbnQgaW5zdGFuY2VcbiAqIEBwYXJhbSByZXNvdXJjZUlkIC0gVGhlIEFQSSBHYXRld2F5IHJlc291cmNlIElEIHRvIGxvb2sgdXBcbiAqIEBwYXJhbSBtYWluU3RhY2tOYW1lIC0gVGhlIG5hbWUgb2YgdGhlIG1haW4gc3RhY2sgKGZvciBmaWx0ZXJpbmcpXG4gKiBAcmV0dXJucyBTdGFjayBuYW1lIHRoYXQgb3ducyB0aGUgcmVzb3VyY2UsIG9yIG51bGwgaWYgbm90IGZvdW5kXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGZpbmRSZXNvdXJjZU93bmVyU3RhY2soXG4gIGNmQ2xpZW50OiBDbG91ZEZvcm1hdGlvbkNsaWVudCxcbiAgcmVzb3VyY2VJZDogc3RyaW5nLFxuICBtYWluU3RhY2tOYW1lOiBzdHJpbmdcbik6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICB0cnkge1xuICAgIC8vIEdldCBhbGwgc3RhY2tzICh3ZSdsbCBmaWx0ZXIgdG8gb25seSByZWxhdGVkIHN0YWNrcylcbiAgICBjb25zdCBkZXNjcmliZVN0YWNrc1Jlc3BvbnNlID0gYXdhaXQgY2ZDbGllbnQuc2VuZChuZXcgRGVzY3JpYmVTdGFja3NDb21tYW5kKHt9KSk7XG4gICAgY29uc3QgYWxsU3RhY2tzID0gZGVzY3JpYmVTdGFja3NSZXNwb25zZS5TdGFja3MgfHwgW107XG5cbiAgICAvLyBGaWx0ZXIgdG8gc3RhY2tzIHRoYXQgYXJlIHJlbGF0ZWQgdG8gb3VyIG1haW4gc3RhY2sgKG1haW4gc3RhY2sgKyBpdHMgbmVzdGVkIHN0YWNrcylcbiAgICBjb25zdCByZWxhdGVkU3RhY2tzID0gYWxsU3RhY2tzLmZpbHRlcihzdGFjayA9PiB7XG4gICAgICBjb25zdCBzdGFja05hbWUgPSBzdGFjay5TdGFja05hbWUgfHwgJyc7XG4gICAgICByZXR1cm4gc3RhY2tOYW1lID09PSBtYWluU3RhY2tOYW1lIHx8IHN0YWNrTmFtZS5zdGFydHNXaXRoKGAke21haW5TdGFja05hbWV9LWApO1xuICAgIH0pO1xuXG4gICAgY29uc29sZS5sb2coYENoZWNraW5nICR7cmVsYXRlZFN0YWNrcy5sZW5ndGh9IHJlbGF0ZWQgc3RhY2tzIGZvciByZXNvdXJjZSAke3Jlc291cmNlSWR9YCk7XG5cbiAgICAvLyBDaGVjayBlYWNoIHN0YWNrJ3MgcmVzb3VyY2VzIHRvIGZpbmQgdGhlIG93bmVyXG4gICAgZm9yIChjb25zdCBzdGFjayBvZiByZWxhdGVkU3RhY2tzKSB7XG4gICAgICBjb25zdCBzdGFja05hbWUgPSBzdGFjay5TdGFja05hbWUhO1xuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBsaXN0UmVzb3VyY2VzUmVzcG9uc2UgPSBhd2FpdCBjZkNsaWVudC5zZW5kKG5ldyBMaXN0U3RhY2tSZXNvdXJjZXNDb21tYW5kKHtcbiAgICAgICAgICBTdGFja05hbWU6IHN0YWNrTmFtZVxuICAgICAgICB9KSk7XG5cbiAgICAgICAgY29uc3QgcmVzb3VyY2VzID0gbGlzdFJlc291cmNlc1Jlc3BvbnNlLlN0YWNrUmVzb3VyY2VTdW1tYXJpZXMgfHwgW107XG4gICAgICAgIGNvbnN0IGZvdW5kID0gcmVzb3VyY2VzLmZpbmQociA9PiByLlBoeXNpY2FsUmVzb3VyY2VJZCA9PT0gcmVzb3VyY2VJZCk7XG5cbiAgICAgICAgaWYgKGZvdW5kKSB7XG4gICAgICAgICAgY29uc29sZS5sb2coYFJlc291cmNlICR7cmVzb3VyY2VJZH0gaXMgb3duZWQgYnkgc3RhY2s6ICR7c3RhY2tOYW1lfWApO1xuICAgICAgICAgIHJldHVybiBzdGFja05hbWU7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIC8vIFN0YWNrIG1pZ2h0IGJlIGluIGEgc3RhdGUgd2hlcmUgd2UgY2FuJ3QgbGlzdCByZXNvdXJjZXMgKGUuZy4sIERFTEVURV9DT01QTEVURSlcbiAgICAgICAgLy8gVGhpcyBpcyBmaW5lIC0gY29udGludWUgY2hlY2tpbmcgb3RoZXIgc3RhY2tzXG4gICAgICAgIGNvbnNvbGUubG9nKGBTa2lwcGluZyBzdGFjayAke3N0YWNrTmFtZX06ICR7KGVycm9yIGFzIEVycm9yKS5tZXNzYWdlfWApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnNvbGUubG9nKGBSZXNvdXJjZSAke3Jlc291cmNlSWR9IG5vdCBmb3VuZCBpbiBhbnkgQ2xvdWRGb3JtYXRpb24gc3RhY2tgKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKGBFcnJvciBmaW5kaW5nIHJlc291cmNlIG93bmVyOmAsIGVycm9yKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuIl19
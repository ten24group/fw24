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
            // Step 4: Check if resource is managed by the correct stack
            if (ownerStack === mainStackName) {
                // Resource is in main stack (correct location)
                console.log(`✓ ${targetPath} - already in main stack (reusing)`);
                continue;
            }
            // Step 5: Conflict detected - resource is either orphaned or in wrong stack
            if (!ownerStack) {
                console.log(`⚠️  CONFLICT DETECTED: ${targetPath} exists but not managed by CloudFormation (orphaned resource)`);
            }
            else {
                console.log(`⚠️  CONFLICT DETECTED: ${targetPath} owned by ${ownerStack} (needs to be in ${mainStackName})`);
            }
            // Add ONLY the parent resource for deletion
            // API Gateway will automatically cascade-delete all child resources
            conflictingResources.push(existingResource);
            // Log how many children will be cascade-deleted
            const childCount = resources.filter(r => r.path?.startsWith(`${targetPath}/`)).length;
            console.log(`   Will delete ${targetPath} (${childCount} children will be cascade-deleted automatically)`);
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
        console.log(`Deleting ${conflictingResources.length} parent resource(s) (children will cascade-delete automatically)...`);
        let deletedCount = 0;
        const DELAY_BETWEEN_DELETES = 500; // 500ms between deletions for safety (only deleting 2-3 resources typically)
        const MAX_RETRIES = 5;
        for (const resource of conflictingResources) {
            console.log(`Deleting conflicting resource: ${resource.path} (id: ${resource.id})`);
            let retries = 0;
            let deleted = false;
            while (!deleted && retries <= MAX_RETRIES) {
                try {
                    await apiGatewayClient.send(new client_api_gateway_1.DeleteResourceCommand({
                        restApiId: restApiId,
                        resourceId: resource.id
                    }));
                    console.log(`✅ Successfully deleted: ${resource.path}`);
                    deletedCount++;
                    deleted = true;
                    // Rate limiting: wait before next deletion
                    if (conflictingResources.indexOf(resource) < conflictingResources.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_DELETES));
                    }
                }
                catch (error) {
                    const errorName = error.name;
                    if (errorName === 'NotFoundException') {
                        console.log(`⚠️  Resource ${resource.path} not found (may be already deleted)`);
                        deleted = true; // Consider it deleted
                    }
                    else if (errorName === 'TooManyRequestsException') {
                        retries++;
                        const waitTime = Math.min(1000 * Math.pow(2, retries), 10000); // Exponential backoff, max 10s
                        console.warn(`⚠️  Rate limit hit for ${resource.path}. Retry ${retries}/${MAX_RETRIES} after ${waitTime}ms...`);
                        if (retries <= MAX_RETRIES) {
                            await new Promise(resolve => setTimeout(resolve, waitTime));
                        }
                        else {
                            console.error(`❌ Failed to delete ${resource.path} after ${MAX_RETRIES} retries:`, error);
                            throw error;
                        }
                    }
                    else {
                        console.error(`❌ Failed to delete ${resource.path}:`, error);
                        throw error;
                    }
                }
            }
        }
        console.log(`Migration complete: deleted ${deletedCount}/${conflictingResources.length} parent resource(s)`);
        // Step 7: Verify deletions propagated (wait up to 30 seconds)
        // We only need to verify parent resources are gone (children cascade-delete automatically)
        console.log('Waiting for deletions to propagate in API Gateway...');
        const maxWaitTime = 30000; // 30 seconds
        const startTime = Date.now();
        let allDeleted = false;
        while (!allDeleted && (Date.now() - startTime < maxWaitTime)) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
            const checkResponse = await apiGatewayClient.send(new client_api_gateway_1.GetResourcesCommand({
                restApiId: restApiId,
                limit: 500
            }));
            const remainingResources = checkResponse.items || [];
            const deletedResourceIds = conflictingResources.map(r => r.id);
            const stillExist = remainingResources.filter(r => deletedResourceIds.includes(r.id));
            if (stillExist.length === 0) {
                allDeleted = true;
                console.log('✅ All deleted resources confirmed gone from API Gateway');
            }
            else {
                console.log(`⏳ Still waiting for ${stillExist.length} resource(s) to be deleted...`);
            }
        }
        if (!allDeleted) {
            console.warn('⚠️  Deletion verification timeout - proceeding anyway');
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWdhdGV3YXktcmVzb3VyY2UtbWlncmF0aW9uLWhhbmRsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9hcGktZ2F0ZXdheS1yZXNvdXJjZS1taWdyYXRpb24taGFuZGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxvRUFBMkc7QUFDM0csMEVBQXdIO0FBK0J4SDs7Ozs7Ozs7Ozs7O0dBWUc7QUFDSSxNQUFNLE9BQU8sR0FBRyxLQUFLLEVBQUUsS0FBNkIsRUFBc0MsRUFBRTtJQUNqRyxPQUFPLENBQUMsR0FBRyxDQUFDLHFDQUFxQyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBRW5GLDRGQUE0RjtJQUM1RixJQUFJLFNBQWlCLENBQUM7SUFDdEIsSUFBSSxTQUFtQixDQUFDO0lBQ3hCLElBQUksYUFBcUIsQ0FBQztJQUUxQixJQUFJLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUNsQixNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUMxQyxTQUFTLEdBQUcsT0FBTyxDQUFDLFNBQVMsQ0FBQztRQUM5QixTQUFTLEdBQUcsT0FBTyxDQUFDLFNBQVMsQ0FBQztRQUM5QixhQUFhLEdBQUcsT0FBTyxDQUFDLGFBQWEsQ0FBQztJQUN4QyxDQUFDO1NBQU0sSUFBSSxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDdEIsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDcEMsU0FBUyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUM7UUFDM0IsU0FBUyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUM7UUFDM0IsYUFBYSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUM7SUFDckMsQ0FBQztT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ZCwgRGVsZXRlUmVzb3VyY2VDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWFwaS1nYXRld2F5JztcbmltcG9ydCB7IENsb3VkRm9ybWF0aW9uQ2xpZW50LCBMaXN0U3RhY2tSZXNvdXJjZXNDb21tYW5kLCBEZXNjcmliZVN0YWNrc0NvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtY2xvdWRmb3JtYXRpb24nO1xuXG4vKipcbiAqIEV2ZW50IHBheWxvYWQgcGFzc2VkIHRvIHRoZSBMYW1iZGEgZnJvbSB0aGUgQ0RLIEN1c3RvbSBSZXNvdXJjZVxuICovXG5pbnRlcmZhY2UgUmVzb3VyY2VNaWdyYXRpb25FdmVudCB7XG4gIHJlc3RBcGlJZDogc3RyaW5nO1xuICByb290UGF0aHM6IHN0cmluZ1tdO1xuICBtYWluU3RhY2tOYW1lOiBzdHJpbmc7XG4gIG1vZGU6ICdtaWdyYXRlJztcbiAgUGF5bG9hZD86IHN0cmluZztcbiAgYm9keT86IHN0cmluZztcbn1cblxuLyoqXG4gKiBSZXNwb25zZSByZXR1cm5lZCB0byBDbG91ZEZvcm1hdGlvbiBDdXN0b20gUmVzb3VyY2VcbiAqL1xuaW50ZXJmYWNlIFJlc291cmNlTWlncmF0aW9uUmVzcG9uc2Uge1xuICBzdGF0dXNDb2RlOiBudW1iZXI7XG4gIGJvZHk6IHN0cmluZztcbn1cblxuLyoqXG4gKiBBUEkgR2F0ZXdheSByZXNvdXJjZSByZXByZXNlbnRhdGlvbiBmcm9tIEFXUyBTREtcbiAqL1xuaW50ZXJmYWNlIEFwaUdhdGV3YXlSZXNvdXJjZSB7XG4gIGlkPzogc3RyaW5nO1xuICBwYXRoUGFydD86IHN0cmluZztcbiAgcGF0aD86IHN0cmluZztcbn1cblxuLyoqXG4gKiBMYW1iZGEgaGFuZGxlciBmb3IgQVBJIEdhdGV3YXkgcmVzb3VyY2UgbWlncmF0aW9uLlxuICogXG4gKiBUaGlzIGZ1bmN0aW9uIHF1ZXJpZXMgYWN0dWFsIEFXUyBzdGF0ZSB0byBkZXRlY3Qgd2hlbiByZXNvdXJjZXMgZXhpc3QgaW4gdGhlIHdyb25nIHN0YWNrLlxuICogSXQgb25seSBkZWxldGVzIHJlc291cmNlcyB3aGVuIGEgZ2VudWluZSBjb25mbGljdCBpcyBkZXRlY3RlZCAocmVzb3VyY2UgaW4gbmVzdGVkIHN0YWNrXG4gKiBidXQgbmVlZHMgdG8gYmUgaW4gbWFpbiBzdGFjaykuIFRoaXMgYWxsb3dzIENsb3VkRm9ybWF0aW9uIHRvIHJlY3JlYXRlIHRoZW0gY29ycmVjdGx5LlxuICogXG4gKiBUaGUgZnVuY3Rpb24gaXMgaWRlbXBvdGVudCAtIHJ1bm5pbmcgaXQgbXVsdGlwbGUgdGltZXMgaXMgc2FmZS4gSXQgcXVlcmllcyByZWFsIEFXUyBzdGF0ZVxuICogb24gZXZlcnkgaW52b2NhdGlvbiwgbWFraW5nIGl0IHJlbGlhYmxlIGFjcm9zcyBDSS9DRCwgbXVsdGlwbGUgZGV2ZWxvcGVycywgYW5kIGVudmlyb25tZW50cy5cbiAqIFxuICogQHBhcmFtIGV2ZW50IC0gQ29udGFpbnMgcmVzdEFwaUlkLCByb290UGF0aHMsIGFuZCBtYWluU3RhY2tOYW1lXG4gKiBAcmV0dXJucyBSZXNwb25zZSBpbmRpY2F0aW5nIHN1Y2Nlc3MgYW5kIGFjdGlvbnMgdGFrZW5cbiAqL1xuZXhwb3J0IGNvbnN0IGhhbmRsZXIgPSBhc3luYyAoZXZlbnQ6IFJlc291cmNlTWlncmF0aW9uRXZlbnQpOiBQcm9taXNlPFJlc291cmNlTWlncmF0aW9uUmVzcG9uc2U+ID0+IHtcbiAgY29uc29sZS5sb2coJ1Jlc291cmNlIG1pZ3JhdGlvbiBoYW5kbGVyIGludm9rZWQ6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQsIG51bGwsIDIpKTtcblxuICAvLyBQYXJzZSBwYXlsb2FkIC0gaGFuZGxlIGRpZmZlcmVudCBpbnZvY2F0aW9uIGZvcm1hdHMgKGRpcmVjdCwgd3JhcHBlZCBpbiBQYXlsb2FkLCBvciBib2R5KVxuICBsZXQgcmVzdEFwaUlkOiBzdHJpbmc7XG4gIGxldCByb290UGF0aHM6IHN0cmluZ1tdO1xuICBsZXQgbWFpblN0YWNrTmFtZTogc3RyaW5nO1xuXG4gIGlmIChldmVudC5QYXlsb2FkKSB7XG4gICAgY29uc3QgcGF5bG9hZCA9IEpTT04ucGFyc2UoZXZlbnQuUGF5bG9hZCk7XG4gICAgcmVzdEFwaUlkID0gcGF5bG9hZC5yZXN0QXBpSWQ7XG4gICAgcm9vdFBhdGhzID0gcGF5bG9hZC5yb290UGF0aHM7XG4gICAgbWFpblN0YWNrTmFtZSA9IHBheWxvYWQubWFpblN0YWNrTmFtZTtcbiAgfSBlbHNlIGlmIChldmVudC5ib2R5KSB7XG4gICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UoZXZlbnQuYm9keSk7XG4gICAgcmVzdEFwaUlkID0gYm9keS5yZXN0QXBpSWQ7XG4gICAgcm9vdFBhdGhzID0gYm9keS5yb290UGF0aHM7XG4gICAgbWFpblN0YWNrTmFtZSA9IGJvZHkubWFpblN0YWNrTmFtZTtcbiAgfSBlbHNlIHtcbiAgICByZXN0QXBpSWQgPSBldmVudC5yZXN0QXBpSWQ7XG4gICAgcm9vdFBhdGhzID0gZXZlbnQucm9vdFBhdGhzO1xuICAgIG1haW5TdGFja05hbWUgPSBldmVudC5tYWluU3RhY2tOYW1lO1xuICB9XG5cbiAgLy8gVmFsaWRhdGUgcmVxdWlyZWQgcGFyYW1ldGVyc1xuICBpZiAoIXJlc3RBcGlJZCB8fCAhcm9vdFBhdGhzIHx8IHJvb3RQYXRocy5sZW5ndGggPT09IDAgfHwgIW1haW5TdGFja05hbWUpIHtcbiAgICBjb25zb2xlLmxvZygnTm8gbWlncmF0aW9uIG5lZWRlZCAtIG1pc3NpbmcgcGFyYW1ldGVycycpO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IG1lc3NhZ2U6ICdObyBtaWdyYXRpb24gbmVlZGVkJyB9KVxuICAgIH07XG4gIH1cblxuICBjb25zb2xlLmxvZyhgU3RhcnRpbmcgcmVzb3VyY2UgbWlncmF0aW9uIGNoZWNrIGZvciBBUEk6ICR7cmVzdEFwaUlkfWApO1xuICBjb25zb2xlLmxvZyhgTWFpbiBzdGFjazogJHttYWluU3RhY2tOYW1lfWApO1xuICBjb25zb2xlLmxvZyhgUm9vdCBwYXRocyB0byBtaWdyYXRlOiAke3Jvb3RQYXRocy5qb2luKCcsICcpfWApO1xuXG4gIGNvbnN0IGFwaUdhdGV3YXlDbGllbnQgPSBuZXcgQVBJR2F0ZXdheUNsaWVudCh7fSk7XG4gIGNvbnN0IGNsb3VkRm9ybWF0aW9uQ2xpZW50ID0gbmV3IENsb3VkRm9ybWF0aW9uQ2xpZW50KHt9KTtcblxuICB0cnkge1xuICAgIC8vIFN0ZXAgMTogR2V0IGFsbCBleGlzdGluZyByZXNvdXJjZXMgZnJvbSBBUEkgR2F0ZXdheVxuICAgIGNvbnNvbGUubG9nKCdGZXRjaGluZyBhbGwgQVBJIEdhdGV3YXkgcmVzb3VyY2VzLi4uJyk7XG4gICAgY29uc3QgZ2V0UmVzb3VyY2VzUmVzcG9uc2UgPSBhd2FpdCBhcGlHYXRld2F5Q2xpZW50LnNlbmQobmV3IEdldFJlc291cmNlc0NvbW1hbmQoe1xuICAgICAgcmVzdEFwaUlkOiByZXN0QXBpSWQsXG4gICAgICBsaW1pdDogNTAwIC8vIE1heCBhbGxvd2VkIGJ5IEFQSSBHYXRld2F5XG4gICAgfSkpO1xuXG4gICAgY29uc3QgcmVzb3VyY2VzOiBBcGlHYXRld2F5UmVzb3VyY2VbXSA9IGdldFJlc291cmNlc1Jlc3BvbnNlLml0ZW1zIHx8IFtdO1xuICAgIGNvbnNvbGUubG9nKGBGb3VuZCAke3Jlc291cmNlcy5sZW5ndGh9IHRvdGFsIHJlc291cmNlcyBpbiBBUEkgR2F0ZXdheWApO1xuXG4gICAgLy8gU3RlcCAyOiBGb3IgZWFjaCByb290IHBhdGgsIGNoZWNrIGlmIGl0IGV4aXN0cyBhbmQgd2hvIG93bnMgaXRcbiAgICBjb25zdCBjb25mbGljdGluZ1Jlc291cmNlczogQXBpR2F0ZXdheVJlc291cmNlW10gPSBbXTtcblxuICAgIGZvciAoY29uc3Qgcm9vdFBhdGggb2Ygcm9vdFBhdGhzKSB7XG4gICAgICBjb25zdCB0YXJnZXRQYXRoID0gYC8ke3Jvb3RQYXRofWA7XG4gICAgICBjb25zdCBleGlzdGluZ1Jlc291cmNlID0gcmVzb3VyY2VzLmZpbmQociA9PiByLnBhdGggPT09IHRhcmdldFBhdGgpO1xuXG4gICAgICBpZiAoIWV4aXN0aW5nUmVzb3VyY2UpIHtcbiAgICAgICAgY29uc29sZS5sb2coYOKckyAke3RhcmdldFBhdGh9IC0gZG9lcyBub3QgZXhpc3QgeWV0ICh3aWxsIGJlIGNyZWF0ZWQgZnJlc2gpYCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBTdGVwIDM6IEZpbmQgd2hpY2ggQ2xvdWRGb3JtYXRpb24gc3RhY2sgb3ducyB0aGlzIHJlc291cmNlXG4gICAgICBjb25zb2xlLmxvZyhgQ2hlY2tpbmcgb3duZXJzaGlwIGZvciAke3RhcmdldFBhdGh9IChpZDogJHtleGlzdGluZ1Jlc291cmNlLmlkfSkuLi5gKTtcbiAgICAgIGNvbnN0IG93bmVyU3RhY2sgPSBhd2FpdCBmaW5kUmVzb3VyY2VPd25lclN0YWNrKFxuICAgICAgICBjbG91ZEZvcm1hdGlvbkNsaWVudCxcbiAgICAgICAgZXhpc3RpbmdSZXNvdXJjZS5pZCEsXG4gICAgICAgIG1haW5TdGFja05hbWVcbiAgICAgICk7XG5cbiAgICAgIC8vIFN0ZXAgNDogQ2hlY2sgaWYgcmVzb3VyY2UgaXMgbWFuYWdlZCBieSB0aGUgY29ycmVjdCBzdGFja1xuICAgICAgaWYgKG93bmVyU3RhY2sgPT09IG1haW5TdGFja05hbWUpIHtcbiAgICAgICAgLy8gUmVzb3VyY2UgaXMgaW4gbWFpbiBzdGFjayAoY29ycmVjdCBsb2NhdGlvbilcbiAgICAgICAgY29uc29sZS5sb2coYOKckyAke3RhcmdldFBhdGh9IC0gYWxyZWFkeSBpbiBtYWluIHN0YWNrIChyZXVzaW5nKWApO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgLy8gU3RlcCA1OiBDb25mbGljdCBkZXRlY3RlZCAtIHJlc291cmNlIGlzIGVpdGhlciBvcnBoYW5lZCBvciBpbiB3cm9uZyBzdGFja1xuICAgICAgaWYgKCFvd25lclN0YWNrKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGDimqDvuI8gIENPTkZMSUNUIERFVEVDVEVEOiAke3RhcmdldFBhdGh9IGV4aXN0cyBidXQgbm90IG1hbmFnZWQgYnkgQ2xvdWRGb3JtYXRpb24gKG9ycGhhbmVkIHJlc291cmNlKWApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc29sZS5sb2coYOKaoO+4jyAgQ09ORkxJQ1QgREVURUNURUQ6ICR7dGFyZ2V0UGF0aH0gb3duZWQgYnkgJHtvd25lclN0YWNrfSAobmVlZHMgdG8gYmUgaW4gJHttYWluU3RhY2tOYW1lfSlgKTtcbiAgICAgIH1cblxuICAgICAgLy8gQWRkIE9OTFkgdGhlIHBhcmVudCByZXNvdXJjZSBmb3IgZGVsZXRpb25cbiAgICAgIC8vIEFQSSBHYXRld2F5IHdpbGwgYXV0b21hdGljYWxseSBjYXNjYWRlLWRlbGV0ZSBhbGwgY2hpbGQgcmVzb3VyY2VzXG4gICAgICBjb25mbGljdGluZ1Jlc291cmNlcy5wdXNoKGV4aXN0aW5nUmVzb3VyY2UpO1xuXG4gICAgICAvLyBMb2cgaG93IG1hbnkgY2hpbGRyZW4gd2lsbCBiZSBjYXNjYWRlLWRlbGV0ZWRcbiAgICAgIGNvbnN0IGNoaWxkQ291bnQgPSByZXNvdXJjZXMuZmlsdGVyKHIgPT4gci5wYXRoPy5zdGFydHNXaXRoKGAke3RhcmdldFBhdGh9L2ApKS5sZW5ndGg7XG4gICAgICBjb25zb2xlLmxvZyhgICAgV2lsbCBkZWxldGUgJHt0YXJnZXRQYXRofSAoJHtjaGlsZENvdW50fSBjaGlsZHJlbiB3aWxsIGJlIGNhc2NhZGUtZGVsZXRlZCBhdXRvbWF0aWNhbGx5KWApO1xuICAgIH1cblxuICAgIC8vIFN0ZXAgNjogRGVsZXRlIGNvbmZsaWN0aW5nIHJlc291cmNlc1xuICAgIGlmIChjb25mbGljdGluZ1Jlc291cmNlcy5sZW5ndGggPT09IDApIHtcbiAgICAgIGNvbnNvbGUubG9nKCfinIUgTm8gY29uZmxpY3RzIGRldGVjdGVkIC0gYWxsIHJlc291cmNlcyBhcmUgY29ycmVjdGx5IHBsYWNlZCcpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgbWVzc2FnZTogJ05vIGNvbmZsaWN0cyBkZXRlY3RlZCcsXG4gICAgICAgICAgYWN0aW9uOiAnbm9uZScsXG4gICAgICAgICAgcm9vdFBhdGhzOiByb290UGF0aHNcbiAgICAgICAgfSlcbiAgICAgIH07XG4gICAgfVxuXG4gICAgY29uc29sZS5sb2coYERlbGV0aW5nICR7Y29uZmxpY3RpbmdSZXNvdXJjZXMubGVuZ3RofSBwYXJlbnQgcmVzb3VyY2UocykgKGNoaWxkcmVuIHdpbGwgY2FzY2FkZS1kZWxldGUgYXV0b21hdGljYWxseSkuLi5gKTtcblxuICAgIGxldCBkZWxldGVkQ291bnQgPSAwO1xuICAgIGNvbnN0IERFTEFZX0JFVFdFRU5fREVMRVRFUyA9IDUwMDsgLy8gNTAwbXMgYmV0d2VlbiBkZWxldGlvbnMgZm9yIHNhZmV0eSAob25seSBkZWxldGluZyAyLTMgcmVzb3VyY2VzIHR5cGljYWxseSlcbiAgICBjb25zdCBNQVhfUkVUUklFUyA9IDU7XG5cbiAgICBmb3IgKGNvbnN0IHJlc291cmNlIG9mIGNvbmZsaWN0aW5nUmVzb3VyY2VzKSB7XG4gICAgICBjb25zb2xlLmxvZyhgRGVsZXRpbmcgY29uZmxpY3RpbmcgcmVzb3VyY2U6ICR7cmVzb3VyY2UucGF0aH0gKGlkOiAke3Jlc291cmNlLmlkfSlgKTtcblxuICAgICAgbGV0IHJldHJpZXMgPSAwO1xuICAgICAgbGV0IGRlbGV0ZWQgPSBmYWxzZTtcblxuICAgICAgd2hpbGUgKCFkZWxldGVkICYmIHJldHJpZXMgPD0gTUFYX1JFVFJJRVMpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCBhcGlHYXRld2F5Q2xpZW50LnNlbmQobmV3IERlbGV0ZVJlc291cmNlQ29tbWFuZCh7XG4gICAgICAgICAgICByZXN0QXBpSWQ6IHJlc3RBcGlJZCxcbiAgICAgICAgICAgIHJlc291cmNlSWQ6IHJlc291cmNlLmlkIVxuICAgICAgICAgIH0pKTtcbiAgICAgICAgICBjb25zb2xlLmxvZyhg4pyFIFN1Y2Nlc3NmdWxseSBkZWxldGVkOiAke3Jlc291cmNlLnBhdGh9YCk7XG4gICAgICAgICAgZGVsZXRlZENvdW50Kys7XG4gICAgICAgICAgZGVsZXRlZCA9IHRydWU7XG5cbiAgICAgICAgICAvLyBSYXRlIGxpbWl0aW5nOiB3YWl0IGJlZm9yZSBuZXh0IGRlbGV0aW9uXG4gICAgICAgICAgaWYgKGNvbmZsaWN0aW5nUmVzb3VyY2VzLmluZGV4T2YocmVzb3VyY2UpIDwgY29uZmxpY3RpbmdSZXNvdXJjZXMubGVuZ3RoIC0gMSkge1xuICAgICAgICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIERFTEFZX0JFVFdFRU5fREVMRVRFUykpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICBjb25zdCBlcnJvck5hbWUgPSAoZXJyb3IgYXMgRXJyb3IpLm5hbWU7XG5cbiAgICAgICAgICBpZiAoZXJyb3JOYW1lID09PSAnTm90Rm91bmRFeGNlcHRpb24nKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhg4pqg77iPICBSZXNvdXJjZSAke3Jlc291cmNlLnBhdGh9IG5vdCBmb3VuZCAobWF5IGJlIGFscmVhZHkgZGVsZXRlZClgKTtcbiAgICAgICAgICAgIGRlbGV0ZWQgPSB0cnVlOyAvLyBDb25zaWRlciBpdCBkZWxldGVkXG4gICAgICAgICAgfSBlbHNlIGlmIChlcnJvck5hbWUgPT09ICdUb29NYW55UmVxdWVzdHNFeGNlcHRpb24nKSB7XG4gICAgICAgICAgICByZXRyaWVzKys7XG4gICAgICAgICAgICBjb25zdCB3YWl0VGltZSA9IE1hdGgubWluKDEwMDAgKiBNYXRoLnBvdygyLCByZXRyaWVzKSwgMTAwMDApOyAvLyBFeHBvbmVudGlhbCBiYWNrb2ZmLCBtYXggMTBzXG4gICAgICAgICAgICBjb25zb2xlLndhcm4oYOKaoO+4jyAgUmF0ZSBsaW1pdCBoaXQgZm9yICR7cmVzb3VyY2UucGF0aH0uIFJldHJ5ICR7cmV0cmllc30vJHtNQVhfUkVUUklFU30gYWZ0ZXIgJHt3YWl0VGltZX1tcy4uLmApO1xuXG4gICAgICAgICAgICBpZiAocmV0cmllcyA8PSBNQVhfUkVUUklFUykge1xuICAgICAgICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgd2FpdFRpbWUpKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYOKdjCBGYWlsZWQgdG8gZGVsZXRlICR7cmVzb3VyY2UucGF0aH0gYWZ0ZXIgJHtNQVhfUkVUUklFU30gcmV0cmllczpgLCBlcnJvcik7XG4gICAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGDinYwgRmFpbGVkIHRvIGRlbGV0ZSAke3Jlc291cmNlLnBhdGh9OmAsIGVycm9yKTtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnNvbGUubG9nKGBNaWdyYXRpb24gY29tcGxldGU6IGRlbGV0ZWQgJHtkZWxldGVkQ291bnR9LyR7Y29uZmxpY3RpbmdSZXNvdXJjZXMubGVuZ3RofSBwYXJlbnQgcmVzb3VyY2UocylgKTtcblxuICAgIC8vIFN0ZXAgNzogVmVyaWZ5IGRlbGV0aW9ucyBwcm9wYWdhdGVkICh3YWl0IHVwIHRvIDMwIHNlY29uZHMpXG4gICAgLy8gV2Ugb25seSBuZWVkIHRvIHZlcmlmeSBwYXJlbnQgcmVzb3VyY2VzIGFyZSBnb25lIChjaGlsZHJlbiBjYXNjYWRlLWRlbGV0ZSBhdXRvbWF0aWNhbGx5KVxuICAgIGNvbnNvbGUubG9nKCdXYWl0aW5nIGZvciBkZWxldGlvbnMgdG8gcHJvcGFnYXRlIGluIEFQSSBHYXRld2F5Li4uJyk7XG4gICAgY29uc3QgbWF4V2FpdFRpbWUgPSAzMDAwMDsgLy8gMzAgc2Vjb25kc1xuICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gICAgbGV0IGFsbERlbGV0ZWQgPSBmYWxzZTtcblxuICAgIHdoaWxlICghYWxsRGVsZXRlZCAmJiAoRGF0ZS5ub3coKSAtIHN0YXJ0VGltZSA8IG1heFdhaXRUaW1lKSkge1xuICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDIwMDApKTsgLy8gV2FpdCAyIHNlY29uZHNcblxuICAgICAgY29uc3QgY2hlY2tSZXNwb25zZSA9IGF3YWl0IGFwaUdhdGV3YXlDbGllbnQuc2VuZChuZXcgR2V0UmVzb3VyY2VzQ29tbWFuZCh7XG4gICAgICAgIHJlc3RBcGlJZDogcmVzdEFwaUlkLFxuICAgICAgICBsaW1pdDogNTAwXG4gICAgICB9KSk7XG5cbiAgICAgIGNvbnN0IHJlbWFpbmluZ1Jlc291cmNlcyA9IGNoZWNrUmVzcG9uc2UuaXRlbXMgfHwgW107XG4gICAgICBjb25zdCBkZWxldGVkUmVzb3VyY2VJZHMgPSBjb25mbGljdGluZ1Jlc291cmNlcy5tYXAociA9PiByLmlkKTtcbiAgICAgIGNvbnN0IHN0aWxsRXhpc3QgPSByZW1haW5pbmdSZXNvdXJjZXMuZmlsdGVyKHIgPT4gZGVsZXRlZFJlc291cmNlSWRzLmluY2x1ZGVzKHIuaWQpKTtcblxuICAgICAgaWYgKHN0aWxsRXhpc3QubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIGFsbERlbGV0ZWQgPSB0cnVlO1xuICAgICAgICBjb25zb2xlLmxvZygn4pyFIEFsbCBkZWxldGVkIHJlc291cmNlcyBjb25maXJtZWQgZ29uZSBmcm9tIEFQSSBHYXRld2F5Jyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zb2xlLmxvZyhg4o+zIFN0aWxsIHdhaXRpbmcgZm9yICR7c3RpbGxFeGlzdC5sZW5ndGh9IHJlc291cmNlKHMpIHRvIGJlIGRlbGV0ZWQuLi5gKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWFsbERlbGV0ZWQpIHtcbiAgICAgIGNvbnNvbGUud2Fybign4pqg77iPICBEZWxldGlvbiB2ZXJpZmljYXRpb24gdGltZW91dCAtIHByb2NlZWRpbmcgYW55d2F5Jyk7XG4gICAgfVxuXG4gICAgY29uc29sZS5sb2coJ0Nsb3VkRm9ybWF0aW9uIHdpbGwgbm93IGNyZWF0ZSB0aGVzZSByZXNvdXJjZXMgaW4gdGhlIG1haW4gc3RhY2snKTtcblxuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIG1lc3NhZ2U6ICdNaWdyYXRpb24gY29tcGxldGVkIHN1Y2Nlc3NmdWxseScsXG4gICAgICAgIGFjdGlvbjogJ2RlbGV0ZWQtY29uZmxpY3RpbmctcmVzb3VyY2VzJyxcbiAgICAgICAgZGVsZXRlZENvdW50OiBkZWxldGVkQ291bnQsXG4gICAgICAgIHJvb3RQYXRoczogcm9vdFBhdGhzXG4gICAgICB9KVxuICAgIH07XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcign4p2MIEVycm9yIGR1cmluZyByZXNvdXJjZSBtaWdyYXRpb246JywgZXJyb3IpO1xuICAgIHRocm93IGVycm9yO1xuICB9XG59O1xuXG4vKipcbiAqIEZpbmRzIHdoaWNoIENsb3VkRm9ybWF0aW9uIHN0YWNrIG93bnMgYSBzcGVjaWZpYyBBUEkgR2F0ZXdheSByZXNvdXJjZS5cbiAqIFxuICogVGhpcyBmdW5jdGlvbiBxdWVyaWVzIENsb3VkRm9ybWF0aW9uIHN0YWNrcyB0byBmaW5kIHdoaWNoIHN0YWNrIGNyZWF0ZWRcbiAqIHRoZSBnaXZlbiByZXNvdXJjZSBJRC4gSXQgaGVscHMgZGV0ZXJtaW5lIGlmIGEgcmVzb3VyY2UgaXMgaW4gdGhlIG1haW4gc3RhY2tcbiAqIG9yIGEgbmVzdGVkIHN0YWNrLlxuICogXG4gKiBAcGFyYW0gY2ZDbGllbnQgLSBDbG91ZEZvcm1hdGlvbiBjbGllbnQgaW5zdGFuY2VcbiAqIEBwYXJhbSByZXNvdXJjZUlkIC0gVGhlIEFQSSBHYXRld2F5IHJlc291cmNlIElEIHRvIGxvb2sgdXBcbiAqIEBwYXJhbSBtYWluU3RhY2tOYW1lIC0gVGhlIG5hbWUgb2YgdGhlIG1haW4gc3RhY2sgKGZvciBmaWx0ZXJpbmcpXG4gKiBAcmV0dXJucyBTdGFjayBuYW1lIHRoYXQgb3ducyB0aGUgcmVzb3VyY2UsIG9yIG51bGwgaWYgbm90IGZvdW5kXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGZpbmRSZXNvdXJjZU93bmVyU3RhY2soXG4gIGNmQ2xpZW50OiBDbG91ZEZvcm1hdGlvbkNsaWVudCxcbiAgcmVzb3VyY2VJZDogc3RyaW5nLFxuICBtYWluU3RhY2tOYW1lOiBzdHJpbmdcbik6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICB0cnkge1xuICAgIC8vIEdldCBhbGwgc3RhY2tzICh3ZSdsbCBmaWx0ZXIgdG8gb25seSByZWxhdGVkIHN0YWNrcylcbiAgICBjb25zdCBkZXNjcmliZVN0YWNrc1Jlc3BvbnNlID0gYXdhaXQgY2ZDbGllbnQuc2VuZChuZXcgRGVzY3JpYmVTdGFja3NDb21tYW5kKHt9KSk7XG4gICAgY29uc3QgYWxsU3RhY2tzID0gZGVzY3JpYmVTdGFja3NSZXNwb25zZS5TdGFja3MgfHwgW107XG5cbiAgICAvLyBGaWx0ZXIgdG8gc3RhY2tzIHRoYXQgYXJlIHJlbGF0ZWQgdG8gb3VyIG1haW4gc3RhY2sgKG1haW4gc3RhY2sgKyBpdHMgbmVzdGVkIHN0YWNrcylcbiAgICBjb25zdCByZWxhdGVkU3RhY2tzID0gYWxsU3RhY2tzLmZpbHRlcihzdGFjayA9PiB7XG4gICAgICBjb25zdCBzdGFja05hbWUgPSBzdGFjay5TdGFja05hbWUgfHwgJyc7XG4gICAgICByZXR1cm4gc3RhY2tOYW1lID09PSBtYWluU3RhY2tOYW1lIHx8IHN0YWNrTmFtZS5zdGFydHNXaXRoKGAke21haW5TdGFja05hbWV9LWApO1xuICAgIH0pO1xuXG4gICAgY29uc29sZS5sb2coYENoZWNraW5nICR7cmVsYXRlZFN0YWNrcy5sZW5ndGh9IHJlbGF0ZWQgc3RhY2tzIGZvciByZXNvdXJjZSAke3Jlc291cmNlSWR9YCk7XG5cbiAgICAvLyBDaGVjayBlYWNoIHN0YWNrJ3MgcmVzb3VyY2VzIHRvIGZpbmQgdGhlIG93bmVyXG4gICAgZm9yIChjb25zdCBzdGFjayBvZiByZWxhdGVkU3RhY2tzKSB7XG4gICAgICBjb25zdCBzdGFja05hbWUgPSBzdGFjay5TdGFja05hbWUhO1xuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBsaXN0UmVzb3VyY2VzUmVzcG9uc2UgPSBhd2FpdCBjZkNsaWVudC5zZW5kKG5ldyBMaXN0U3RhY2tSZXNvdXJjZXNDb21tYW5kKHtcbiAgICAgICAgICBTdGFja05hbWU6IHN0YWNrTmFtZVxuICAgICAgICB9KSk7XG5cbiAgICAgICAgY29uc3QgcmVzb3VyY2VzID0gbGlzdFJlc291cmNlc1Jlc3BvbnNlLlN0YWNrUmVzb3VyY2VTdW1tYXJpZXMgfHwgW107XG4gICAgICAgIGNvbnN0IGZvdW5kID0gcmVzb3VyY2VzLmZpbmQociA9PiByLlBoeXNpY2FsUmVzb3VyY2VJZCA9PT0gcmVzb3VyY2VJZCk7XG5cbiAgICAgICAgaWYgKGZvdW5kKSB7XG4gICAgICAgICAgY29uc29sZS5sb2coYFJlc291cmNlICR7cmVzb3VyY2VJZH0gaXMgb3duZWQgYnkgc3RhY2s6ICR7c3RhY2tOYW1lfWApO1xuICAgICAgICAgIHJldHVybiBzdGFja05hbWU7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIC8vIFN0YWNrIG1pZ2h0IGJlIGluIGEgc3RhdGUgd2hlcmUgd2UgY2FuJ3QgbGlzdCByZXNvdXJjZXMgKGUuZy4sIERFTEVURV9DT01QTEVURSlcbiAgICAgICAgLy8gVGhpcyBpcyBmaW5lIC0gY29udGludWUgY2hlY2tpbmcgb3RoZXIgc3RhY2tzXG4gICAgICAgIGNvbnNvbGUubG9nKGBTa2lwcGluZyBzdGFjayAke3N0YWNrTmFtZX06ICR7KGVycm9yIGFzIEVycm9yKS5tZXNzYWdlfWApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnNvbGUubG9nKGBSZXNvdXJjZSAke3Jlc291cmNlSWR9IG5vdCBmb3VuZCBpbiBhbnkgQ2xvdWRGb3JtYXRpb24gc3RhY2tgKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKGBFcnJvciBmaW5kaW5nIHJlc291cmNlIG93bmVyOmAsIGVycm9yKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuIl19
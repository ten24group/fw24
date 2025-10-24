"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractManifestViaReflection = extractManifestViaReflection;
const metadata_registry_1 = require("./metadata-registry");
const fs_1 = require("fs");
const path_1 = require("path");
/**
 * Extract manifest data using reflection and decorator metadata
 * This is the CLEAN, SCALABLE way to do it!
 */
function extractManifestViaReflection(rootDir) {
    console.log('[ReflectionExtractor] Starting reflection-based extraction...');
    // Import the application's DI file to trigger decorator execution
    const diFilePath = (0, path_1.join)(rootDir, 'src/di.ts');
    if ((0, fs_1.existsSync)(diFilePath)) {
        console.log('[ReflectionExtractor] Importing DI file to trigger decorators...');
        try {
            // Dynamic import to trigger decorator execution
            require(diFilePath);
        }
        catch (error) {
            console.warn('[ReflectionExtractor] Could not import DI file:', error);
        }
    }
    // Import all controllers to trigger @Controller decorators
    const controllersDir = (0, path_1.join)(rootDir, 'src/controllers');
    if ((0, fs_1.existsSync)(controllersDir)) {
        console.log('[ReflectionExtractor] Importing controllers to trigger decorators...');
        try {
            const fs = require('fs');
            const controllerFiles = fs.readdirSync(controllersDir)
                .filter((file) => file.endsWith('.controller.ts') || file.endsWith('.controller.js'));
            for (const file of controllerFiles) {
                try {
                    require((0, path_1.join)(controllersDir, file));
                }
                catch (error) {
                    console.warn(`[ReflectionExtractor] Could not import controller ${file}:`, error);
                }
            }
        }
        catch (error) {
            console.warn('[ReflectionExtractor] Could not scan controllers directory:', error);
        }
    }
    // Import all services to trigger @Service decorators
    const servicesDir = (0, path_1.join)(rootDir, 'src/services');
    if ((0, fs_1.existsSync)(servicesDir)) {
        console.log('[ReflectionExtractor] Importing services to trigger decorators...');
        try {
            const fs = require('fs');
            const serviceFiles = fs.readdirSync(servicesDir)
                .filter((file) => file.endsWith('.ts') || file.endsWith('.js'));
            for (const file of serviceFiles) {
                try {
                    require((0, path_1.join)(servicesDir, file));
                }
                catch (error) {
                    console.warn(`[ReflectionExtractor] Could not import service ${file}:`, error);
                }
            }
        }
        catch (error) {
            console.warn('[ReflectionExtractor] Could not scan services directory:', error);
        }
    }
    // Import all entities to trigger @EntitySchema decorators
    const entitiesDir = (0, path_1.join)(rootDir, 'src/entities');
    if ((0, fs_1.existsSync)(entitiesDir)) {
        console.log('[ReflectionExtractor] Importing entities to trigger decorators...');
        try {
            const fs = require('fs');
            const entityFiles = fs.readdirSync(entitiesDir)
                .filter((file) => file.endsWith('.schema.ts') || file.endsWith('.schema.js'));
            for (const file of entityFiles) {
                try {
                    require((0, path_1.join)(entitiesDir, file));
                }
                catch (error) {
                    console.warn(`[ReflectionExtractor] Could not import entity ${file}:`, error);
                }
            }
        }
        catch (error) {
            console.warn('[ReflectionExtractor] Could not scan entities directory:', error);
        }
    }
    // Get all metadata from the registry
    const metadata = metadata_registry_1.metadataRegistry.exportMetadata();
    console.log('[ReflectionExtractor] Extracted metadata:', {
        modules: metadata.modules.length,
        entities: metadata.entities.length,
        providers: metadata.providers.length,
        capabilities: metadata.capabilities.length
    });
    // TODO: Extract resource intents from controller metadata
    const resourceIntents = [];
    return {
        modules: metadata.modules,
        entities: metadata.entities,
        capabilities: metadata.capabilities,
        resourceIntents
    };
}
// Removed duplicate Controller decorator - using the enhanced one in decorators/controller.ts
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVmbGVjdGlvbi1leHRyYWN0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvbWFuaWZlc3QvcmVmbGVjdGlvbi1leHRyYWN0b3IudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFvQkEsb0VBaUdDO0FBckhELDJEQUF1RDtBQUV2RCwyQkFBZ0M7QUFDaEMsK0JBQTRCO0FBYTVCOzs7R0FHRztBQUNILFNBQWdCLDRCQUE0QixDQUFDLE9BQWU7SUFDMUQsT0FBTyxDQUFDLEdBQUcsQ0FBQywrREFBK0QsQ0FBQyxDQUFDO0lBRTdFLGtFQUFrRTtJQUNsRSxNQUFNLFVBQVUsR0FBRyxJQUFBLFdBQUksRUFBQyxPQUFPLEVBQUUsV0FBVyxDQUFDLENBQUM7SUFDOUMsSUFBSSxJQUFBLGVBQVUsRUFBQyxVQUFVLENBQUMsRUFBRSxDQUFDO1FBQzNCLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0VBQWtFLENBQUMsQ0FBQztRQUNoRixJQUFJLENBQUM7WUFDSCxnREFBZ0Q7WUFDaEQsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQ3RCLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsT0FBTyxDQUFDLElBQUksQ0FBQyxpREFBaUQsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUN6RSxDQUFDO0lBQ0gsQ0FBQztJQUVELDJEQUEyRDtJQUMzRCxNQUFNLGNBQWMsR0FBRyxJQUFBLFdBQUksRUFBQyxPQUFPLEVBQUUsaUJBQWlCLENBQUMsQ0FBQztJQUN4RCxJQUFJLElBQUEsZUFBVSxFQUFDLGNBQWMsQ0FBQyxFQUFFLENBQUM7UUFDL0IsT0FBTyxDQUFDLEdBQUcsQ0FBQyxzRUFBc0UsQ0FBQyxDQUFDO1FBQ3BGLElBQUksQ0FBQztZQUNILE1BQU0sRUFBRSxHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUN6QixNQUFNLGVBQWUsR0FBRyxFQUFFLENBQUMsV0FBVyxDQUFDLGNBQWMsQ0FBQztpQkFDbkQsTUFB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QUssQ0FBQyxDQUFDO2dCQUNoRixDQUFDO1lBQ0gsQ0FBQztRQUNILENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsT0FBTyxDQUFDLElBQUksQ0FBQywwREFBMEQsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUNsRixDQUFDO0lBQ0gsQ0FBQztJQUVELHFDQUFxQztJQUNyQyxNQUFNLFFBQVEsR0FBRyxvQ0FBZ0IsQ0FBQyxjQUFjLEVBQUUsQ0FBQztJQUVuRCxPQUFPLENBQUMsR0FBRyxDQUFDLDJDQUEyQyxFQUFFO1FBQ3ZELE9BQU8sRUFBRSxRQUFRLENBQUMsT0FBTyxDQUFDLE1BQU07UUFDaEMsUUFBUSxFQUFFLFFBQVEsQ0FBQyxRQUFRLENBQUMsTUFBTTtRQUNsQyxTQUFTLEVBQUUsUUFBUSxDQUFDLFNBQVMsQ0FBQyxNQUFNO1FBQ3BDLFlBQVksRUFBRSxRQUFRLENBQUMsWUFBWSxDQUFDLE1BQU07S0FDM0MsQ0FBQyxDQUFDO0lBRUgsMERBQTBEO0lBQzFELE1BQU0sZUFBZSxHQUFxQixFQUFFLENBQUM7SUFFN0MsT0FBTztRQUNMLE9BQU8sRUFBRSxRQUFRLENBQUMsT0FBTztRQUN6QixRQUFRLEVBQUUsUUFBUSxDQUFDLFFBQVE7UUFDM0IsWUFBWSxFQUFFLFFBQVEsQ0FBQyxZQUFZO1FBQ25DLGVBQWU7S0FDaEIsQ0FBQztBQUNKLENBQUM7QUFFRCw4RkFBOEYiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBtZXRhZGF0YVJlZ2lzdHJ5IH0gZnJvbSAnLi9tZXRhZGF0YS1yZWdpc3RyeSc7XG5pbXBvcnQgeyBNYW5pZmVzdCwgQ2FwYWJpbGl0eURlc2NyaXB0b3IsIFJlc291cmNlSW50ZW50IH0gZnJvbSAnLi90eXBlcyc7XG5pbXBvcnQgeyBleGlzdHNTeW5jIH0gZnJvbSAnZnMnO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gJ3BhdGgnO1xuXG4vKipcbiAqIFBST1BFUiByZWZsZWN0aW9uLWJhc2VkIG1hbmlmZXN0IGV4dHJhY3Rpb25cbiAqIFVzZXMgZGVjb3JhdG9yIG1ldGFkYXRhIGluc3RlYWQgb2YgaGFja3kgQVNUIHBhcnNpbmdcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBSZWZsZWN0aW9uRXh0cmFjdGlvblJlc3VsdCB7XG4gIG1vZHVsZXM6IGFueVtdO1xuICBlbnRpdGllczogYW55W107XG4gIGNhcGFiaWxpdGllczogQ2FwYWJpbGl0eURlc2NyaXB0b3JbXTtcbiAgcmVzb3VyY2VJbnRlbnRzOiBSZXNvdXJjZUludGVudFtdO1xufVxuXG4vKipcbiAqIEV4dHJhY3QgbWFuaWZlc3QgZGF0YSB1c2luZyByZWZsZWN0aW9uIGFuZCBkZWNvcmF0b3IgbWV0YWRhdGFcbiAqIFRoaXMgaXMgdGhlIENMRUFOLCBTQ0FMQUJMRSB3YXkgdG8gZG8gaXQhXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0TWFuaWZlc3RWaWFSZWZsZWN0aW9uKHJvb3REaXI6IHN0cmluZyk6IFJlZmxlY3Rpb25FeHRyYWN0aW9uUmVzdWx0IHtcbiAgY29uc29sZS5sb2coJ1tSZWZsZWN0aW9uRXh0cmFjdG9yXSBTdGFydGluZyByZWZsZWN0aW9uLWJhc2VkIGV4dHJhY3Rpb24uLi4nKTtcbiAgXG4gIC8vIEltcG9ydCB0aGUgYXBwbGljYXRpb24ncyBESSBmaWxlIHRvIHRyaWdnZXIgZGVjb3JhdG9yIGV4ZWN1dGlvblxuICBjb25zdCBkaUZpbGVQYXRoID0gam9pbihyb290RGlyLCAnc3JjL2RpLnRzJyk7XG4gIGlmIChleGlzdHNTeW5jKGRpRmlsZVBhdGgpKSB7XG4gICAgY29uc29sZS5sb2coJ1tSZWZsZWN0aW9uRXh0cmFjdG9yXSBJbXBvcnRpbmcgREkgZmlsZSB0byB0cmlnZ2VyIGRlY29yYXRvcnMuLi4nKTtcbiAgICB0cnkge1xuICAgICAgLy8gRHluYW1pYyBpbXBvcnQgdG8gdHJpZ2dlciBkZWNvcmF0b3IgZXhlY3V0aW9uXG4gICAgICByZXF1aXJlKGRpRmlsZVBhdGgpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLndhcm4oJ1tSZWZsZWN0aW9uRXh0cmFjdG9yXSBDb3VsZCBub3QgaW1wb3J0IERJIGZpbGU6JywgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIC8vIEltcG9ydCBhbGwgY29udHJvbGxlcnMgdG8gdHJpZ2dlciBAQ29udHJvbGxlciBkZWNvcmF0b3JzXG4gIGNvbnN0IGNvbnRyb2xsZXJzRGlyID0gam9pbihyb290RGlyLCAnc3JjL2NvbnRyb2xsZXJzJyk7XG4gIGlmIChleGlzdHNTeW5jKGNvbnRyb2xsZXJzRGlyKSkge1xuICAgIGNvbnNvbGUubG9nKCdbUmVmbGVjdGlvbkV4dHJhY3Rvcl0gSW1wb3J0aW5nIGNvbnRyb2xsZXJzIHRvIHRyaWdnZXIgZGVjb3JhdG9ycy4uLicpO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJyk7XG4gICAgICBjb25zdCBjb250cm9sbGVyRmlsZXMgPSBmcy5yZWFkZGlyU3luYyhjb250cm9sbGVyc0RpcilcbiAgICAgICAgLmZpbHRlcigoZmlsZTogc3RyaW5nKSA9PiBmaWxlLmVuZHNXaXRoKCcuY29udHJvbGxlci50cycpIHx8IGZpbGUuZW5kc1dpdGgoJy5jb250cm9sbGVyLmpzJykpO1xuICAgICAgXG4gICAgICBmb3IgKGNvbnN0IGZpbGUgb2YgY29udHJvbGxlckZpbGVzKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmVxdWlyZShqb2luKGNvbnRyb2xsZXJzRGlyLCBmaWxlKSk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgY29uc29sZS53YXJuKGBbUmVmbGVjdGlvbkV4dHJhY3Rvcl0gQ291bGQgbm90IGltcG9ydCBjb250cm9sbGVyICR7ZmlsZX06YCwgZXJyb3IpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUud2FybignW1JlZmxlY3Rpb25FeHRyYWN0b3JdIENvdWxkIG5vdCBzY2FuIGNvbnRyb2xsZXJzIGRpcmVjdG9yeTonLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgLy8gSW1wb3J0IGFsbCBzZXJ2aWNlcyB0byB0cmlnZ2VyIEBTZXJ2aWNlIGRlY29yYXRvcnNcbiAgY29uc3Qgc2VydmljZXNEaXIgPSBqb2luKHJvb3REaXIsICdzcmMvc2VydmljZXMnKTtcbiAgaWYgKGV4aXN0c1N5bmMoc2VydmljZXNEaXIpKSB7XG4gICAgY29uc29sZS5sb2coJ1tSZWZsZWN0aW9uRXh0cmFjdG9yXSBJbXBvcnRpbmcgc2VydmljZXMgdG8gdHJpZ2dlciBkZWNvcmF0b3JzLi4uJyk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKTtcbiAgICAgIGNvbnN0IHNlcnZpY2VGaWxlcyA9IGZzLnJlYWRkaXJTeW5jKHNlcnZpY2VzRGlyKVxuICAgICAgICAuZmlsdGVyKChmaWxlOiBzdHJpbmcpID0+IGZpbGUuZW5kc1dpdGgoJy50cycpIHx8IGZpbGUuZW5kc1dpdGgoJy5qcycpKTtcbiAgICAgIFxuICAgICAgZm9yIChjb25zdCBmaWxlIG9mIHNlcnZpY2VGaWxlcykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHJlcXVpcmUoam9pbihzZXJ2aWNlc0RpciwgZmlsZSkpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGNvbnNvbGUud2FybihgW1JlZmxlY3Rpb25FeHRyYWN0b3JdIENvdWxkIG5vdCBpbXBvcnQgc2VydmljZSAke2ZpbGV9OmAsIGVycm9yKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLndhcm4oJ1tSZWZsZWN0aW9uRXh0cmFjdG9yXSBDb3VsZCBub3Qgc2NhbiBzZXJ2aWNlcyBkaXJlY3Rvcnk6JywgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIC8vIEltcG9ydCBhbGwgZW50aXRpZXMgdG8gdHJpZ2dlciBARW50aXR5U2NoZW1hIGRlY29yYXRvcnNcbiAgY29uc3QgZW50aXRpZXNEaXIgPSBqb2luKHJvb3REaXIsICdzcmMvZW50aXRpZXMnKTtcbiAgaWYgKGV4aXN0c1N5bmMoZW50aXRpZXNEaXIpKSB7XG4gICAgY29uc29sZS5sb2coJ1tSZWZsZWN0aW9uRXh0cmFjdG9yXSBJbXBvcnRpbmcgZW50aXRpZXMgdG8gdHJpZ2dlciBkZWNvcmF0b3JzLi4uJyk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGZzID0gcmVxdWlyZSgnZnMnKTtcbiAgICAgIGNvbnN0IGVudGl0eUZpbGVzID0gZnMucmVhZGRpclN5bmMoZW50aXRpZXNEaXIpXG4gICAgICAgIC5maWx0ZXIoKGZpbGU6IHN0cmluZykgPT4gZmlsZS5lbmRzV2l0aCgnLnNjaGVtYS50cycpIHx8IGZpbGUuZW5kc1dpdGgoJy5zY2hlbWEuanMnKSk7XG4gICAgICBcbiAgICAgIGZvciAoY29uc3QgZmlsZSBvZiBlbnRpdHlGaWxlcykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHJlcXVpcmUoam9pbihlbnRpdGllc0RpciwgZmlsZSkpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGNvbnNvbGUud2FybihgW1JlZmxlY3Rpb25FeHRyYWN0b3JdIENvdWxkIG5vdCBpbXBvcnQgZW50aXR5ICR7ZmlsZX06YCwgZXJyb3IpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUud2FybignW1JlZmxlY3Rpb25FeHRyYWN0b3JdIENvdWxkIG5vdCBzY2FuIGVudGl0aWVzIGRpcmVjdG9yeTonLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgLy8gR2V0IGFsbCBtZXRhZGF0YSBmcm9tIHRoZSByZWdpc3RyeVxuICBjb25zdCBtZXRhZGF0YSA9IG1ldGFkYXRhUmVnaXN0cnkuZXhwb3J0TWV0YWRhdGEoKTtcbiAgXG4gIGNvbnNvbGUubG9nKCdbUmVmbGVjdGlvbkV4dHJhY3Rvcl0gRXh0cmFjdGVkIG1ldGFkYXRhOicsIHtcbiAgICBtb2R1bGVzOiBtZXRhZGF0YS5tb2R1bGVzLmxlbmd0aCxcbiAgICBlbnRpdGllczogbWV0YWRhdGEuZW50aXRpZXMubGVuZ3RoLFxuICAgIHByb3ZpZGVyczogbWV0YWRhdGEucHJvdmlkZXJzLmxlbmd0aCxcbiAgICBjYXBhYmlsaXRpZXM6IG1ldGFkYXRhLmNhcGFiaWxpdGllcy5sZW5ndGhcbiAgfSk7XG5cbiAgLy8gVE9ETzogRXh0cmFjdCByZXNvdXJjZSBpbnRlbnRzIGZyb20gY29udHJvbGxlciBtZXRhZGF0YVxuICBjb25zdCByZXNvdXJjZUludGVudHM6IFJlc291cmNlSW50ZW50W10gPSBbXTtcblxuICByZXR1cm4ge1xuICAgIG1vZHVsZXM6IG1ldGFkYXRhLm1vZHVsZXMsXG4gICAgZW50aXRpZXM6IG1ldGFkYXRhLmVudGl0aWVzLFxuICAgIGNhcGFiaWxpdGllczogbWV0YWRhdGEuY2FwYWJpbGl0aWVzLFxuICAgIHJlc291cmNlSW50ZW50c1xuICB9O1xufVxuXG4vLyBSZW1vdmVkIGR1cGxpY2F0ZSBDb250cm9sbGVyIGRlY29yYXRvciAtIHVzaW5nIHRoZSBlbmhhbmNlZCBvbmUgaW4gZGVjb3JhdG9ycy9jb250cm9sbGVyLnRzXG4iXX0=
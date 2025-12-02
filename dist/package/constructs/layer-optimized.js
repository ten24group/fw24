"use strict";
/**
 * OPTIMIZED Layer Construct Implementation
 *
 * Performance improvements:
 * 1. Source hash checking (fast path: <100ms for unchanged layers)
 * 2. Persistent npm cache reuse (avoid reinstalling packages)
 * 3. Better logging with progress indicators
 * 4. Reliable across all environments (local, CI/CD)
 */
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
/**
 * Calculate a stable hash of layer source inputs
 * This determines if we need to rebuild the layer
 */
function calculateLayerSourceHash(sourceFile, externalPackages, projectPackageJsonPath) {
    const hash = (0, crypto_1.createHash)('sha256');
    // 1. Hash the source file content
    if ((0, fs_1.existsSync)(sourceFile)) {
        hash.update((0, fs_1.readFileSync)(sourceFile));
    }
    // 2. Hash the external package list (sorted for stability)
    const packageNames = externalPackages
        .filter((pkg) => typeof pkg === 'string')
        .sort();
    hash.update(JSON.stringify(packageNames));
    // 3. Hash the versions from project package.json (ONLY runtime dependencies!)
    if ((0, fs_1.existsSync)(projectPackageJsonPath)) {
        const projectPkg = JSON.parse((0, fs_1.readFileSync)(projectPackageJsonPath, 'utf-8'));
        const runtimeDeps = projectPkg.dependencies || {};
        // Only hash the versions of packages we're actually using
        const relevantDeps = {};
        packageNames.forEach(pkg => {
            if (runtimeDeps[pkg]) {
                relevantDeps[pkg] = runtimeDeps[pkg];
            }
        });
        hash.update(JSON.stringify(relevantDeps, Object.keys(relevantDeps).sort()));
    }
    return hash.digest('hex');
}
/**
 * Check if layer needs rebuilding by comparing source hash
 * Returns: { needsRebuild: boolean, reason: string }
 */
function checkIfLayerNeedsRebuild(layerName, bundleDir, currentHash, logger) {
    const hashFile = (0, path_1.join)(bundleDir, '.build-hash');
    const outputDir = (0, path_1.join)(bundleDir, 'nodejs');
    // If output doesn't exist, we need to build
    if (!(0, fs_1.existsSync)(outputDir)) {
        return { needsRebuild: true, reason: 'Output directory does not exist (first build)' };
    }
    // If hash file doesn't exist, rebuild (legacy or corrupted state)
    if (!(0, fs_1.existsSync)(hashFile)) {
        logger.warn(`No build hash found for layer ${layerName}, rebuilding`);
        return { needsRebuild: true, reason: 'Build hash missing (rebuilding for safety)' };
    }
    // Compare hashes
    const previousHash = (0, fs_1.readFileSync)(hashFile, 'utf-8').trim();
    if (previousHash !== currentHash) {
        return { needsRebuild: true, reason: 'Source code or dependencies changed' };
    }
    return { needsRebuild: false, reason: 'No changes detected' };
}
/**
 * OPTIMIZED: Install external dependencies with caching
 *
 * Strategy:
 * 1. Check if node_modules already has correct packages (via package.json hash)
 * 2. If yes: skip npm install (saves 11+ seconds!)
 * 3. If no: run npm install with proper caching
 */
async function installExternalDependenciesOptimized(layerOutputDir, // Use OUTPUT dir, not temp!
externalPackages, projectPackageJsonPath, logger) {
    // Filter packages (same as before)
    const packageNames = externalPackages.filter(pkg => typeof pkg === 'string' &&
        !pkg.startsWith('@aws-sdk') &&
        !pkg.startsWith('@smithy') &&
        !pkg.startsWith('aws-cdk-lib') &&
        pkg !== 'esbuild' &&
        pkg !== '@ten24group/fw24');
    if (packageNames.length === 0) {
        return;
    }
    const nodejsDir = (0, path_1.join)(layerOutputDir, 'nodejs');
    const nodeModulesDir = (0, path_1.join)(nodejsDir, 'node_modules');
    const packageJsonPath = (0, path_1.join)(nodejsDir, 'package.json');
    const packageHashPath = (0, path_1.join)(nodejsDir, '.package-hash');
    // Build desired package.json content
    const packageJson = {
        name: 'layer-dependencies',
        version: '1.0.0',
        dependencies: {}
    };
    if ((0, fs_1.existsSync)(projectPackageJsonPath)) {
        const projectPkg = JSON.parse((0, fs_1.readFileSync)(projectPackageJsonPath, 'utf-8'));
        // ONLY use runtime dependencies - devDependencies are build-time tools, not Lambda runtime!
        const runtimeDeps = projectPkg.dependencies || {};
        packageNames.forEach(pkg => {
            if (runtimeDeps[pkg]) {
                packageJson.dependencies[pkg] = runtimeDeps[pkg];
            }
            else {
                logger.warn(`⚠️  Package "${pkg}" not found in dependencies (only checking runtime deps, not devDependencies)`);
                logger.warn(`   If this is intentional, add "${pkg}" to dependencies in package.json`);
                packageJson.dependencies[pkg] = 'latest';
            }
        });
    }
    else {
        packageNames.forEach(pkg => {
            packageJson.dependencies[pkg] = 'latest';
        });
    }
    const packageJsonContent = JSON.stringify(packageJson, null, 2);
    const currentPackageHash = (0, crypto_1.createHash)('sha256').update(packageJsonContent).digest('hex');
    // FAST PATH: Check if we can skip npm install
    if ((0, fs_1.existsSync)(packageHashPath) && (0, fs_1.existsSync)(nodeModulesDir)) {
        const previousHash = (0, fs_1.readFileSync)(packageHashPath, 'utf-8').trim();
        if (previousHash === currentPackageHash) {
            logger.info(`✓ Dependencies already installed for ${packageNames.join(', ')}, skipping npm install`);
            return; // SAVED 11+ SECONDS!
        }
    }
    // SLOW PATH: Need to run npm install
    logger.info(`Installing ${packageNames.length} external dependencies: ${packageNames.join(', ')}`);
    logger.info('⏱  This will take ~10-15 seconds (npm install from registry)...');
    const startTime = Date.now();
    // Ensure directory exists
    if (!(0, fs_1.existsSync)(nodejsDir)) {
        (0, fs_2.mkdirSync)(nodejsDir, { recursive: true });
    }
    // Write package.json
    (0, fs_1.writeFileSync)(packageJsonPath, packageJsonContent);
    try {
        // Use npm ci if package-lock exists, otherwise npm install
        // Add --prefer-offline to use local npm cache when possible
        const npmCommand = 'npm install --omit=dev --no-package-lock --prefer-offline';
        (0, child_process_1.execSync)(npmCommand, {
            cwd: nodejsDir,
            stdio: 'inherit'
        });
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        logger.info(`✓ Dependencies installed successfully in ${elapsed}s`);
        // Save hash for next run
        (0, fs_1.writeFileSync)(packageHashPath, currentPackageHash);
    }
    catch (error) {
        logger.error('Failed to install external dependencies:', error);
        throw error;
    }
}
/**
 * MAIN OPTIMIZATION: Modified tryCreateLayerForFile
 *
 * New flow:
 * 1. Calculate source hash
 * 2. Check if rebuild needed (fast!)
 * 3. If no: skip everything, done in <100ms
 * 4. If yes: bundle + install (but reuse npm cache)
 */
async function tryCreateLayerForFileOptimized(file, distDirectory, layerConfig, logger) {
    const fileBaseName = (0, path_2.basename)(file, (0, path_2.extname)(file));
    const layerName = fileBaseName; // Simplified for example
    const bundleDir = (0, path_1.join)(distDirectory, layerName);
    const buildOptions = { external: layerConfig.external || [] }; // Simplified
    const projectPackageJsonPath = (0, path_1.join)((0, path_1.resolve)(process.cwd()), 'package.json');
    // ═══════════════════════════════════════════════════════════════
    // STEP 1: Calculate source hash
    // ═══════════════════════════════════════════════════════════════
    logger.info(`[${layerName}] Checking if rebuild is needed...`);
    const currentHash = calculateLayerSourceHash(file, buildOptions.external, projectPackageJsonPath);
    // ═══════════════════════════════════════════════════════════════
    // STEP 2: Check if rebuild needed
    // ═══════════════════════════════════════════════════════════════
    const rebuildCheck = checkIfLayerNeedsRebuild(layerName, bundleDir, currentHash, logger);
    if (!rebuildCheck.needsRebuild) {
        logger.info(`[${layerName}] ✓ ${rebuildCheck.reason} - using cached build`);
        logger.info(`[${layerName}] ⚡ Skipped rebuild (saved ~15 seconds!)`);
        // Still need to register the layer with CDK, but no rebuild needed
        // ... (CDK layer registration code here) ...
        return;
    }
    // ═══════════════════════════════════════════════════════════════
    // STEP 3: Rebuild needed - do the work
    // ═══════════════════════════════════════════════════════════════
    logger.info(`[${layerName}] Rebuild required: ${rebuildCheck.reason}`);
    logger.info(`[${layerName}] Starting build process...`);
    const buildStartTime = Date.now();
    // 3a. Bundle with esbuild (fast)
    logger.info(`[${layerName}] [1/3] Bundling with esbuild...`);
    const outputDir = (0, path_1.join)(bundleDir, 'nodejs/node_modules', fileBaseName);
    const outputFile = (0, path_1.join)(outputDir, 'index.js');
    if (!(0, fs_1.existsSync)(outputDir)) {
        (0, fs_2.mkdirSync)(outputDir, { recursive: true });
    }
    await bundleWithEsbuild(file, outputFile, buildOptions);
    logger.info(`[${layerName}] ✓ Bundling complete`);
    // 3b. Install dependencies (with caching!)
    if (buildOptions.external && buildOptions.external.length > 0) {
        logger.info(`[${layerName}] [2/3] Installing external dependencies...`);
        await installExternalDependenciesOptimized(bundleDir, buildOptions.external, projectPackageJsonPath, logger);
    }
    // 3c. Save hash for next run
    logger.info(`[${layerName}] [3/3] Saving build metadata...`);
    const hashFile = (0, path_1.join)(bundleDir, '.build-hash');
    (0, fs_1.writeFileSync)(hashFile, currentHash);
    const buildElapsed = ((Date.now() - buildStartTime) / 1000).toFixed(1);
    logger.info(`[${layerName}] ✓ Build complete in ${buildElapsed}s`);
    // ... (CDK layer registration code here) ...
}
/**
 * USAGE EXAMPLE:
 *
 * First run (nothing cached):
 * [di] Checking if rebuild is needed...
 * [di] Rebuild required: Output directory does not exist (first build)
 * [di] Starting build process...
 * [di] [1/3] Bundling with esbuild...
 * [di] ✓ Bundling complete
 * [di] [2/3] Installing external dependencies...
 * [di] Installing 4 external dependencies: axios, firebase-admin, stripe, razorpay
 * [di] ⏱  This will take ~10-15 seconds (npm install from registry)...
 * [di] ✓ Dependencies installed successfully in 12.3s
 * [di] [3/3] Saving build metadata...
 * [di] ✓ Build complete in 12.8s
 *
 * Second run (nothing changed):
 * [di] Checking if rebuild is needed...
 * [di] ✓ No changes detected - using cached build
 * [di] ⚡ Skipped rebuild (saved ~15 seconds!)
 *
 * Third run (source changed):
 * [di] Checking if rebuild is needed...
 * [di] Rebuild required: Source code or dependencies changed
 * [di] Starting build process...
 * [di] [1/3] Bundling with esbuild...
 * [di] ✓ Bundling complete
 * [di] [2/3] Installing external dependencies...
 * [di] ✓ Dependencies already installed for axios, firebase-admin, stripe, razorpay, skipping npm install
 * [di] [3/3] Saving build metadata...
 * [di] ✓ Build complete in 0.3s  ← FAST! Reused npm cache
 */
// Imports needed (add these to the top of the actual file)
const fs_2 = require("fs");
const child_process_1 = require("child_process");
const path_2 = require("path");
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGF5ZXItb3B0aW1pemVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvbGF5ZXItb3B0aW1pemVkLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7Ozs7R0FRRzs7QUFFSCxtQ0FBb0M7QUFDcEMsMkJBQXVFO0FBQ3ZFLCtCQUFnRTtBQUVoRTs7O0dBR0c7QUFDSCxTQUFTLHdCQUF3QixDQUM3QixVQUFrQixFQUNsQixnQkFBcUMsRUFDckMsc0JBQThCO0lBRTlCLE1BQU0sSUFBSSxHQUFHLElBQUEsbUJBQVUsRUFBQyxRQUFRLENBQUMsQ0FBQztJQUVsQyxrQ0FBa0M7SUFDbEMsSUFBSSxJQUFBLGVBQVUsRUFBQyxVQUFVLENBQUMsRUFBRSxDQUFDO1FBQ3pCLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBQSxpQkFBWSxFQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUM7SUFDMUMsQ0FBQztJQUVELDJEQUEyRDtJQUMzRCxNQUFNLFlBQVksR0FBRyxnQkFBZ0I7U0FDaEMsTUFBTSxDQUFDLENBQUMsR0FBRyxFQUFpQixFQUFFLENBQUMsT0FBTyxHQUFHLEtBQUssUUFBUSxDQUFDO1NBQ3ZELElBQUksRUFBRSxDQUFDO0lBQ1osSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUM7SUFFMUMsOEVBQThFO0lBQzlFLElBQUksSUFBQSxlQUFVLEVBQUMsc0JBQXNCLENBQUMsRUFBRSxDQUFDO1FBQ3JDLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBQSxpQkFBWSxFQUFDLHNCQUFzQixFQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUM7UUFDN0UsTUFBTSxXQUFXLEdBQUcsVUFBVSxDQUFDLFlBQVksSUFBSSxFQUFFLENBQUM7UUFFbEQsMERBQTBEO1FBQzFELE1BQU0sWUFBWSxHQUEyQixFQUFFLENBQUM7UUFDaEQsWUFBWSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsRUFBRTtZQUN2QixJQUFJLFdBQVcsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUNuQixZQUFZLENBQUMsR0FBRyxDQUFDLEdBQUcsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ3pDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxZQUFZLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFDaEYsQ0FBQztJQUVELE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUM5QixDQUFDO0FBRUQ7OztHQUdHO0FBQ0gsU0FBUyx3QkFBd0IsQ0FDN0IsU0FBaUIsRUFDakIsU0FBaUIsRUFDakIsV0FBbUIsRUFDbkIsTUFBVztJQUVYLE1BQU0sUUFBUSxHQUFHLElBQUEsV0FBUSxFQUFDLFNBQVMsRUFBRSxhQUFhLENBQUMsQ0FBQztJQUNwRCxNQUFNLFNBQVMsR0FBRyxJQUFBLFdBQVEsRUFBQyxTQUFTLEVBQUUsUUFBUSxDQUFDLENBQUM7SUFFaEQsNENBQTRDO0lBQzVDLElBQUksQ0FBQyxJQUFBLGVBQVUsRUFBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1FBQ3pCLE9BQU8sRUFBRSxZQUFZLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSwrQ0FBK0MsRUFBRSxDQUFDO0lBQzNGLENBQUM7SUFFRCxrRUFBa0U7SUFDbEUsSUFBSSxDQUFDLElBQUEsZUFBVSxFQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUM7UUFDeEIsTUFBTSxDQUFDLElBQUksQ0FBQyxpQ0FBaUMsU0FBUyxjQUFjLENBQUMsQ0FBQztRQUN0RSxPQUFPLEVBQUUsWUFBWSxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsNENBQTRDLEVBQUUsQ0FBQztJQUN4RixDQUFDO0lBRUQsaUJBQWlCO0lBQ2pCLE1BQU0sWUFBWSxHQUFHLElBQUEsaUJBQVksRUFBQyxRQUFRLEVBQUUsT0FBTyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUM7SUFDNUQsSUFBSSxZQUFZLEtBQUssV0FBVyxFQUFFLENBQUM7UUFDL0IsT0FBTyxFQUFFLFlBQVksRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLHFDQUFxQyxFQUFFLENBQUM7SUFDakYsQ0FBQztJQUVELE9BQU8sRUFBRSxZQUFZLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxxQkFBcUIsRUFBRSxDQUFDO0FBQ2xFLENBQUM7QUFFRDs7Ozs7OztHQU9HO0FBQ0gsS0FBSyxVQUFVLG9DQUFvQyxDQUMvQyxjQUFzQixFQUFHLDRCQUE0QjtBQUNyRCxnQkFBcUMsRUFDckMsc0JBQThCLEVBQzlCLE1BQVc7SUFFWCxtQ0FBbUM7SUFDbkMsTUFBTSxZQUFZLEdBQUcsZ0JBQWdCLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQy9DLE9BQU8sR0FBRyxLQUFLLFFBQVE7UUFDdkIsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQztRQUMzQixDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDO1FBQzFCLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxhQUFhLENBQUM7UUFDOUIsR0FBRyxLQUFLLFNBQVM7UUFDakIsR0FBRyxLQUFLLGtCQUFrQixDQUNqQixDQUFDO0lBRWQsSUFBSSxZQUFZLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQzVCLE9BQU87SUFDWCxDQUFDO0lBRUQsTUFBTSxTQUFTLEdBQUcsSUFBQSxXQUFRLEVBQUMsY0FBYyxFQUFFLFFBQVEsQ0FBQyxDQUFDO0lBQ3JELE1BQU0sY0FBYyxHQUFHLElBQUEsV0FBUSxFQUFDLFNBQVMsRUFBRSxjQUFjLENBQUMsQ0FBQztJQUMzRCxNQUFNLGVBQWUsR0FBRyxJQUFBLFdBQVEsRUFBQyxTQUFTLEVBQUUsY0FBYyxDQUFDLENBQUM7SUFDNUQsTUFBTSxlQUFlLEdBQUcsSUFBQSxXQUFRLEVBQUMsU0FBUyxFQUFFLGVBQWUsQ0FBQyxDQUFDO0lBRTdELHFDQUFxQztJQUNyQyxNQUFNLFdBQVcsR0FBUTtRQUNyQixJQUFJLEVBQUUsb0JBQW9CO1FBQzFCLE9BQU8sRUFBRSxPQUFPO1FBQ2hCLFlBQVksRUFBRSxFQUFFO0tBQ25CLENBQUM7SUFFRixJQUFJLElBQUEsZUFBVSxFQUFDLHNCQUFzQixDQUFDLEVBQUUsQ0FBQztRQUNyQyxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUEsaUJBQVksRUFBQyxzQkFBc0IsRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDO1FBQzdFLDRGQUE0RjtRQUM1RixNQUFNLFdBQVcsR0FBRyxVQUFVLENBQUMsWUFBWSxJQUFJLEVBQUUsQ0FBQztRQUVsRCxZQUFZLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxFQUFFO1lBQ3ZCLElBQUksV0FBVyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQ25CLFdBQVcsQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLEdBQUcsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ3JELENBQUM7aUJBQU0sQ0FBQztnQkFDSixNQUFNLENBQUMsSUFBSSxDQUFDLGdCQUFnQixHQUFHLCtFQUErRSxDQUFDLENBQUM7Z0JBQ2hILE1BQU0sQ0FBQyxJQUFJLENBQUMsbUNBQW1DLEdBQUcsbUNBQW1DLENBQUMsQ0FBQztnQkFDdkYsV0FBVyxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsR0FBRyxRQUFRLENBQUM7WUFDN0MsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztTQUFNLENBQUM7UUFDSixZQUFZLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxFQUFFO1lBQ3ZCLFdBQVcsQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLEdBQUcsUUFBUSxDQUFDO1FBQzdDLENBQUMsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztJQUVELE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxXQUFXLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDO0lBQ2hFLE1BQU0sa0JBQWtCLEdBQUcsSUFBQSxtQkFBVSxFQUFDLFFBQVEsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUV6Riw4Q0FBOEM7SUFDOUMsSUFBSSxJQUFBLGVBQVUsRUFBQyxlQUFlLENBQUMsSUFBSSxJQUFBLGVBQVUsRUFBQyxjQUFjLENBQUMsRUFBRSxDQUFDO1FBQzVELE1BQU0sWUFBWSxHQUFHLElBQUEsaUJBQVksRUFBQyxlQUFlLEVBQUUsT0FBTyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDbkUsSUFBSSxZQUFZLEtBQUssa0JBQWtCLEVBQUUsQ0FBQztZQUN0QyxNQUFNLENBQUMsSUFBSSxDQUFDLHdDQUF3QyxZQUFZLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDO1lBQ3JHLE9BQU8sQ0FBQyxxQkFBcUI7UUFDakMsQ0FBQztJQUNMLENBQUM7SUFFRCxxQ0FBcUM7SUFDckMsTUFBTSxDQUFDLElBQUksQ0FBQyxjQUFjLFlBQVksQ0FBQyxNQUFNLDJCQUEyQixZQUFZLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUNuRyxNQUFNLENBQUMsSUFBSSxDQUFDLGlFQUFpRSxDQUFDLENBQUM7SUFFL0UsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO0lBRTdCLDBCQUEwQjtJQUMxQixJQUFJLENBQUMsSUFBQSxlQUFVLEVBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztRQUN6QixJQUFBLGNBQVMsRUFBQyxTQUFTLEVBQUUsRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztJQUM5QyxDQUFDO0lBRUQscUJBQXFCO0lBQ3JCLElBQUEsa0JBQWEsRUFBQyxlQUFlLEVBQUUsa0JBQWtCLENBQUMsQ0FBQztJQUVuRCxJQUFJLENBQUM7UUFDRCwyREFBMkQ7UUFDM0QsNERBQTREO1FBQzVELE1BQU0sVUFBVSxHQUFHLDJEQUEyRCxDQUFDO1FBRS9FLElBQUEsd0JBQVEsRUFBQyxVQUFVLEVBQUU7WUFDakIsR0FBRyxFQUFFLFNBQVM7WUFDZCxLQUFLLEVBQUUsU0FBUztTQUNuQixDQUFDLENBQUM7UUFFSCxNQUFNLE9BQU8sR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLFNBQVMsQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUM3RCxNQUFNLENBQUMsSUFBSSxDQUFDLDRDQUE0QyxPQUFPLEdBQUcsQ0FBQyxDQUFDO1FBRXBFLHlCQUF5QjtRQUN6QixJQUFBLGtCQUFhLEVBQUMsZUFBZSxFQUFFLGtCQUFrQixDQUFDLENBQUM7SUFFdkQsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDYixNQUFNLENBQUMsS0FBSyxDQUFDLDBDQUEwQyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ2hFLE1BQU0sS0FBSyxDQUFDO0lBQ2hCLENBQUM7QUFDTCxDQUFDO0FBRUQ7Ozs7Ozs7O0dBUUc7QUFDSCxLQUFLLFVBQVUsOEJBQThCLENBQ3pDLElBQVksRUFDWixhQUFxQixFQUNyQixXQUFnQixFQUNoQixNQUFXO0lBRVgsTUFBTSxZQUFZLEdBQUcsSUFBQSxlQUFZLEVBQUMsSUFBSSxFQUFFLElBQUEsY0FBVyxFQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7SUFDM0QsTUFBTSxTQUFTLEdBQUcsWUFBWSxDQUFDLENBQUMseUJBQXlCO0lBQ3pELE1BQU0sU0FBUyxHQUFHLElBQUEsV0FBUSxFQUFDLGFBQWEsRUFBRSxTQUFTLENBQUMsQ0FBQztJQUVyRCxNQUFNLFlBQVksR0FBRyxFQUFFLFFBQVEsRUFBRSxXQUFXLENBQUMsUUFBUSxJQUFJLEVBQUUsRUFBRSxDQUFDLENBQUMsYUFBYTtJQUU1RSxNQUFNLHNCQUFzQixHQUFHLElBQUEsV0FBUSxFQUFDLElBQUEsY0FBVyxFQUFDLE9BQU8sQ0FBQyxHQUFHLEVBQUUsQ0FBQyxFQUFFLGNBQWMsQ0FBQyxDQUFDO0lBRXBGLGtFQUFrRTtJQUNsRSxnQ0FBZ0M7SUFDaEMsa0VBQWtFO0lBQ2xFLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxTQUFTLG9DQUFvQyxDQUFDLENBQUM7SUFFL0QsTUFBTSxXQUFXLEdBQUcsd0JBQXdCLENBQ3hDLElBQUksRUFDSixZQUFZLENBQUMsUUFBUSxFQUNyQixzQkFBc0IsQ0FDekIsQ0FBQztJQUVGLGtFQUFrRTtJQUNsRSxrQ0FBa0M7SUFDbEMsa0VBQWtFO0lBQ2xFLE1BQU0sWUFBWSxHQUFHLHdCQUF3QixDQUFDLFNBQVMsRUFBRSxTQUFTLEVBQUUsV0FBVyxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBRXpGLElBQUksQ0FBQyxZQUFZLENBQUMsWUFBWSxFQUFFLENBQUM7UUFDN0IsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLFNBQVMsT0FBTyxZQUFZLENBQUMsTUFBTSx1QkFBdUIsQ0FBQyxDQUFDO1FBQzVFLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxTQUFTLDBDQUEwQyxDQUFDLENBQUM7UUFFckUsbUVBQW1FO1FBQ25FLDZDQUE2QztRQUU3QyxPQUFPO0lBQ1gsQ0FBQztJQUVELGtFQUFrRTtJQUNsRSx1Q0FBdUM7SUFDdkMsa0VBQWtFO0lBQ2xFLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxTQUFTLHVCQUF1QixZQUFZLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQztJQUN2RSxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksU0FBUyw2QkFBNkIsQ0FBQyxDQUFDO0lBRXhELE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztJQUVsQyxpQ0FBaUM7SUFDakMsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLFNBQVMsa0NBQWtDLENBQUMsQ0FBQztJQUM3RCxNQUFNLFNBQVMsR0FBRyxJQUFBLFdBQVEsRUFBQyxTQUFTLEVBQUUscUJBQXFCLEVBQUUsWUFBWSxDQUFDLENBQUM7SUFDM0UsTUFBTSxVQUFVLEdBQUcsSUFBQSxXQUFRLEVBQUMsU0FBUyxFQUFFLFVBQVUsQ0FBQyxDQUFDO0lBRW5ELElBQUksQ0FBQyxJQUFBLGVBQVUsRUFBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1FBQ3pCLElBQUEsY0FBUyxFQUFDLFNBQVMsRUFBRSxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO0lBQzlDLENBQUM7SUFFRCxNQUFNLGlCQUFpQixDQUFDLElBQUksRUFBRSxVQUFVLEVBQUUsWUFBWSxDQUFDLENBQUM7SUFDeEQsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLFNBQVMsdUJBQXVCLENBQUMsQ0FBQztJQUVsRCwyQ0FBMkM7SUFDM0MsSUFBSSxZQUFZLENBQUMsUUFBUSxJQUFJLFlBQVksQ0FBQyxRQUFRLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQzVELE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxTQUFTLDZDQUE2QyxDQUFDLENBQUM7UUFDeEUsTUFBTSxvQ0FBb0MsQ0FDdEMsU0FBUyxFQUNULFlBQVksQ0FBQyxRQUFRLEVBQ3JCLHNCQUFzQixFQUN0QixNQUFNLENBQ1QsQ0FBQztJQUNOLENBQUM7SUFFRCw2QkFBNkI7SUFDN0IsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLFNBQVMsa0NBQWtDLENBQUMsQ0FBQztJQUM3RCxNQUFNLFFBQVEsR0FBRyxJQUFBLFdBQVEsRUFBQyxTQUFTLEVBQUUsYUFBYSxDQUFDLENBQUM7SUFDcEQsSUFBQSxrQkFBYSxFQUFDLFFBQVEsRUFBRSxXQUFXLENBQUMsQ0FBQztJQUVyQyxNQUFNLFlBQVksR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLGNBQWMsQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUN2RSxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksU0FBUyx5QkFBeUIsWUFBWSxHQUFHLENBQUMsQ0FBQztJQUVuRSw2Q0FBNkM7QUFDakQsQ0FBQztBQUVEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBK0JHO0FBRUgsMkRBQTJEO0FBQzNELDJCQUErQjtBQUMvQixpREFBeUM7QUFDekMsK0JBQXdFIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBPUFRJTUlaRUQgTGF5ZXIgQ29uc3RydWN0IEltcGxlbWVudGF0aW9uXG4gKiBcbiAqIFBlcmZvcm1hbmNlIGltcHJvdmVtZW50czpcbiAqIDEuIFNvdXJjZSBoYXNoIGNoZWNraW5nIChmYXN0IHBhdGg6IDwxMDBtcyBmb3IgdW5jaGFuZ2VkIGxheWVycylcbiAqIDIuIFBlcnNpc3RlbnQgbnBtIGNhY2hlIHJldXNlIChhdm9pZCByZWluc3RhbGxpbmcgcGFja2FnZXMpXG4gKiAzLiBCZXR0ZXIgbG9nZ2luZyB3aXRoIHByb2dyZXNzIGluZGljYXRvcnNcbiAqIDQuIFJlbGlhYmxlIGFjcm9zcyBhbGwgZW52aXJvbm1lbnRzIChsb2NhbCwgQ0kvQ0QpXG4gKi9cblxuaW1wb3J0IHsgY3JlYXRlSGFzaCB9IGZyb20gXCJjcnlwdG9cIjtcbmltcG9ydCB7IHJlYWRGaWxlU3luYywgZXhpc3RzU3luYywgd3JpdGVGaWxlU3luYywgc3RhdFN5bmMgfSBmcm9tICdmcyc7XG5pbXBvcnQgeyBqb2luIGFzIHBhdGhKb2luLCByZXNvbHZlIGFzIHBhdGhSZXNvbHZlIH0gZnJvbSAncGF0aCc7XG5cbi8qKlxuICogQ2FsY3VsYXRlIGEgc3RhYmxlIGhhc2ggb2YgbGF5ZXIgc291cmNlIGlucHV0c1xuICogVGhpcyBkZXRlcm1pbmVzIGlmIHdlIG5lZWQgdG8gcmVidWlsZCB0aGUgbGF5ZXJcbiAqL1xuZnVuY3Rpb24gY2FsY3VsYXRlTGF5ZXJTb3VyY2VIYXNoKFxuICAgIHNvdXJjZUZpbGU6IHN0cmluZyxcbiAgICBleHRlcm5hbFBhY2thZ2VzOiAoc3RyaW5nIHwgUmVnRXhwKVtdLFxuICAgIHByb2plY3RQYWNrYWdlSnNvblBhdGg6IHN0cmluZ1xuKTogc3RyaW5nIHtcbiAgICBjb25zdCBoYXNoID0gY3JlYXRlSGFzaCgnc2hhMjU2Jyk7XG4gICAgXG4gICAgLy8gMS4gSGFzaCB0aGUgc291cmNlIGZpbGUgY29udGVudFxuICAgIGlmIChleGlzdHNTeW5jKHNvdXJjZUZpbGUpKSB7XG4gICAgICAgIGhhc2gudXBkYXRlKHJlYWRGaWxlU3luYyhzb3VyY2VGaWxlKSk7XG4gICAgfVxuICAgIFxuICAgIC8vIDIuIEhhc2ggdGhlIGV4dGVybmFsIHBhY2thZ2UgbGlzdCAoc29ydGVkIGZvciBzdGFiaWxpdHkpXG4gICAgY29uc3QgcGFja2FnZU5hbWVzID0gZXh0ZXJuYWxQYWNrYWdlc1xuICAgICAgICAuZmlsdGVyKChwa2cpOiBwa2cgaXMgc3RyaW5nID0+IHR5cGVvZiBwa2cgPT09ICdzdHJpbmcnKVxuICAgICAgICAuc29ydCgpO1xuICAgIGhhc2gudXBkYXRlKEpTT04uc3RyaW5naWZ5KHBhY2thZ2VOYW1lcykpO1xuICAgIFxuICAgIC8vIDMuIEhhc2ggdGhlIHZlcnNpb25zIGZyb20gcHJvamVjdCBwYWNrYWdlLmpzb24gKE9OTFkgcnVudGltZSBkZXBlbmRlbmNpZXMhKVxuICAgIGlmIChleGlzdHNTeW5jKHByb2plY3RQYWNrYWdlSnNvblBhdGgpKSB7XG4gICAgICAgIGNvbnN0IHByb2plY3RQa2cgPSBKU09OLnBhcnNlKHJlYWRGaWxlU3luYyhwcm9qZWN0UGFja2FnZUpzb25QYXRoLCAndXRmLTgnKSk7XG4gICAgICAgIGNvbnN0IHJ1bnRpbWVEZXBzID0gcHJvamVjdFBrZy5kZXBlbmRlbmNpZXMgfHwge307XG4gICAgICAgIFxuICAgICAgICAvLyBPbmx5IGhhc2ggdGhlIHZlcnNpb25zIG9mIHBhY2thZ2VzIHdlJ3JlIGFjdHVhbGx5IHVzaW5nXG4gICAgICAgIGNvbnN0IHJlbGV2YW50RGVwczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuICAgICAgICBwYWNrYWdlTmFtZXMuZm9yRWFjaChwa2cgPT4ge1xuICAgICAgICAgICAgaWYgKHJ1bnRpbWVEZXBzW3BrZ10pIHtcbiAgICAgICAgICAgICAgICByZWxldmFudERlcHNbcGtnXSA9IHJ1bnRpbWVEZXBzW3BrZ107XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgaGFzaC51cGRhdGUoSlNPTi5zdHJpbmdpZnkocmVsZXZhbnREZXBzLCBPYmplY3Qua2V5cyhyZWxldmFudERlcHMpLnNvcnQoKSkpO1xuICAgIH1cbiAgICBcbiAgICByZXR1cm4gaGFzaC5kaWdlc3QoJ2hleCcpO1xufVxuXG4vKipcbiAqIENoZWNrIGlmIGxheWVyIG5lZWRzIHJlYnVpbGRpbmcgYnkgY29tcGFyaW5nIHNvdXJjZSBoYXNoXG4gKiBSZXR1cm5zOiB7IG5lZWRzUmVidWlsZDogYm9vbGVhbiwgcmVhc29uOiBzdHJpbmcgfVxuICovXG5mdW5jdGlvbiBjaGVja0lmTGF5ZXJOZWVkc1JlYnVpbGQoXG4gICAgbGF5ZXJOYW1lOiBzdHJpbmcsXG4gICAgYnVuZGxlRGlyOiBzdHJpbmcsXG4gICAgY3VycmVudEhhc2g6IHN0cmluZyxcbiAgICBsb2dnZXI6IGFueVxuKTogeyBuZWVkc1JlYnVpbGQ6IGJvb2xlYW47IHJlYXNvbjogc3RyaW5nIH0ge1xuICAgIGNvbnN0IGhhc2hGaWxlID0gcGF0aEpvaW4oYnVuZGxlRGlyLCAnLmJ1aWxkLWhhc2gnKTtcbiAgICBjb25zdCBvdXRwdXREaXIgPSBwYXRoSm9pbihidW5kbGVEaXIsICdub2RlanMnKTtcbiAgICBcbiAgICAvLyBJZiBvdXRwdXQgZG9lc24ndCBleGlzdCwgd2UgbmVlZCB0byBidWlsZFxuICAgIGlmICghZXhpc3RzU3luYyhvdXRwdXREaXIpKSB7XG4gICAgICAgIHJldHVybiB7IG5lZWRzUmVidWlsZDogdHJ1ZSwgcmVhc29uOiAnT3V0cHV0IGRpcmVjdG9yeSBkb2VzIG5vdCBleGlzdCAoZmlyc3QgYnVpbGQpJyB9O1xuICAgIH1cbiAgICBcbiAgICAvLyBJZiBoYXNoIGZpbGUgZG9lc24ndCBleGlzdCwgcmVidWlsZCAobGVnYWN5IG9yIGNvcnJ1cHRlZCBzdGF0ZSlcbiAgICBpZiAoIWV4aXN0c1N5bmMoaGFzaEZpbGUpKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKGBObyBidWlsZCBoYXNoIGZvdW5kIGZvciBsYXllciAke2xheWVyTmFtZX0sIHJlYnVpbGRpbmdgKTtcbiAgICAgICAgcmV0dXJuIHsgbmVlZHNSZWJ1aWxkOiB0cnVlLCByZWFzb246ICdCdWlsZCBoYXNoIG1pc3NpbmcgKHJlYnVpbGRpbmcgZm9yIHNhZmV0eSknIH07XG4gICAgfVxuICAgIFxuICAgIC8vIENvbXBhcmUgaGFzaGVzXG4gICAgY29uc3QgcHJldmlvdXNIYXNoID0gcmVhZEZpbGVTeW5jKGhhc2hGaWxlLCAndXRmLTgnKS50cmltKCk7XG4gICAgaWYgKHByZXZpb3VzSGFzaCAhPT0gY3VycmVudEhhc2gpIHtcbiAgICAgICAgcmV0dXJuIHsgbmVlZHNSZWJ1aWxkOiB0cnVlLCByZWFzb246ICdTb3VyY2UgY29kZSBvciBkZXBlbmRlbmNpZXMgY2hhbmdlZCcgfTtcbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIHsgbmVlZHNSZWJ1aWxkOiBmYWxzZSwgcmVhc29uOiAnTm8gY2hhbmdlcyBkZXRlY3RlZCcgfTtcbn1cblxuLyoqXG4gKiBPUFRJTUlaRUQ6IEluc3RhbGwgZXh0ZXJuYWwgZGVwZW5kZW5jaWVzIHdpdGggY2FjaGluZ1xuICogXG4gKiBTdHJhdGVneTpcbiAqIDEuIENoZWNrIGlmIG5vZGVfbW9kdWxlcyBhbHJlYWR5IGhhcyBjb3JyZWN0IHBhY2thZ2VzICh2aWEgcGFja2FnZS5qc29uIGhhc2gpXG4gKiAyLiBJZiB5ZXM6IHNraXAgbnBtIGluc3RhbGwgKHNhdmVzIDExKyBzZWNvbmRzISlcbiAqIDMuIElmIG5vOiBydW4gbnBtIGluc3RhbGwgd2l0aCBwcm9wZXIgY2FjaGluZ1xuICovXG5hc3luYyBmdW5jdGlvbiBpbnN0YWxsRXh0ZXJuYWxEZXBlbmRlbmNpZXNPcHRpbWl6ZWQoXG4gICAgbGF5ZXJPdXRwdXREaXI6IHN0cmluZywgIC8vIFVzZSBPVVRQVVQgZGlyLCBub3QgdGVtcCFcbiAgICBleHRlcm5hbFBhY2thZ2VzOiAoc3RyaW5nIHwgUmVnRXhwKVtdLFxuICAgIHByb2plY3RQYWNrYWdlSnNvblBhdGg6IHN0cmluZyxcbiAgICBsb2dnZXI6IGFueVxuKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gRmlsdGVyIHBhY2thZ2VzIChzYW1lIGFzIGJlZm9yZSlcbiAgICBjb25zdCBwYWNrYWdlTmFtZXMgPSBleHRlcm5hbFBhY2thZ2VzLmZpbHRlcihwa2cgPT4gXG4gICAgICAgIHR5cGVvZiBwa2cgPT09ICdzdHJpbmcnICYmIFxuICAgICAgICAhcGtnLnN0YXJ0c1dpdGgoJ0Bhd3Mtc2RrJykgJiYgXG4gICAgICAgICFwa2cuc3RhcnRzV2l0aCgnQHNtaXRoeScpICYmXG4gICAgICAgICFwa2cuc3RhcnRzV2l0aCgnYXdzLWNkay1saWInKSAmJlxuICAgICAgICBwa2cgIT09ICdlc2J1aWxkJyAmJlxuICAgICAgICBwa2cgIT09ICdAdGVuMjRncm91cC9mdzI0J1xuICAgICkgYXMgc3RyaW5nW107XG5cbiAgICBpZiAocGFja2FnZU5hbWVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgbm9kZWpzRGlyID0gcGF0aEpvaW4obGF5ZXJPdXRwdXREaXIsICdub2RlanMnKTtcbiAgICBjb25zdCBub2RlTW9kdWxlc0RpciA9IHBhdGhKb2luKG5vZGVqc0RpciwgJ25vZGVfbW9kdWxlcycpO1xuICAgIGNvbnN0IHBhY2thZ2VKc29uUGF0aCA9IHBhdGhKb2luKG5vZGVqc0RpciwgJ3BhY2thZ2UuanNvbicpO1xuICAgIGNvbnN0IHBhY2thZ2VIYXNoUGF0aCA9IHBhdGhKb2luKG5vZGVqc0RpciwgJy5wYWNrYWdlLWhhc2gnKTtcbiAgICBcbiAgICAvLyBCdWlsZCBkZXNpcmVkIHBhY2thZ2UuanNvbiBjb250ZW50XG4gICAgY29uc3QgcGFja2FnZUpzb246IGFueSA9IHtcbiAgICAgICAgbmFtZTogJ2xheWVyLWRlcGVuZGVuY2llcycsXG4gICAgICAgIHZlcnNpb246ICcxLjAuMCcsXG4gICAgICAgIGRlcGVuZGVuY2llczoge31cbiAgICB9O1xuICAgIFxuICAgIGlmIChleGlzdHNTeW5jKHByb2plY3RQYWNrYWdlSnNvblBhdGgpKSB7XG4gICAgICAgIGNvbnN0IHByb2plY3RQa2cgPSBKU09OLnBhcnNlKHJlYWRGaWxlU3luYyhwcm9qZWN0UGFja2FnZUpzb25QYXRoLCAndXRmLTgnKSk7XG4gICAgICAgIC8vIE9OTFkgdXNlIHJ1bnRpbWUgZGVwZW5kZW5jaWVzIC0gZGV2RGVwZW5kZW5jaWVzIGFyZSBidWlsZC10aW1lIHRvb2xzLCBub3QgTGFtYmRhIHJ1bnRpbWUhXG4gICAgICAgIGNvbnN0IHJ1bnRpbWVEZXBzID0gcHJvamVjdFBrZy5kZXBlbmRlbmNpZXMgfHwge307XG4gICAgICAgIFxuICAgICAgICBwYWNrYWdlTmFtZXMuZm9yRWFjaChwa2cgPT4ge1xuICAgICAgICAgICAgaWYgKHJ1bnRpbWVEZXBzW3BrZ10pIHtcbiAgICAgICAgICAgICAgICBwYWNrYWdlSnNvbi5kZXBlbmRlbmNpZXNbcGtnXSA9IHJ1bnRpbWVEZXBzW3BrZ107XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGxvZ2dlci53YXJuKGDimqDvuI8gIFBhY2thZ2UgXCIke3BrZ31cIiBub3QgZm91bmQgaW4gZGVwZW5kZW5jaWVzIChvbmx5IGNoZWNraW5nIHJ1bnRpbWUgZGVwcywgbm90IGRldkRlcGVuZGVuY2llcylgKTtcbiAgICAgICAgICAgICAgICBsb2dnZXIud2FybihgICAgSWYgdGhpcyBpcyBpbnRlbnRpb25hbCwgYWRkIFwiJHtwa2d9XCIgdG8gZGVwZW5kZW5jaWVzIGluIHBhY2thZ2UuanNvbmApO1xuICAgICAgICAgICAgICAgIHBhY2thZ2VKc29uLmRlcGVuZGVuY2llc1twa2ddID0gJ2xhdGVzdCc7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHBhY2thZ2VOYW1lcy5mb3JFYWNoKHBrZyA9PiB7XG4gICAgICAgICAgICBwYWNrYWdlSnNvbi5kZXBlbmRlbmNpZXNbcGtnXSA9ICdsYXRlc3QnO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgXG4gICAgY29uc3QgcGFja2FnZUpzb25Db250ZW50ID0gSlNPTi5zdHJpbmdpZnkocGFja2FnZUpzb24sIG51bGwsIDIpO1xuICAgIGNvbnN0IGN1cnJlbnRQYWNrYWdlSGFzaCA9IGNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZShwYWNrYWdlSnNvbkNvbnRlbnQpLmRpZ2VzdCgnaGV4Jyk7XG4gICAgXG4gICAgLy8gRkFTVCBQQVRIOiBDaGVjayBpZiB3ZSBjYW4gc2tpcCBucG0gaW5zdGFsbFxuICAgIGlmIChleGlzdHNTeW5jKHBhY2thZ2VIYXNoUGF0aCkgJiYgZXhpc3RzU3luYyhub2RlTW9kdWxlc0RpcikpIHtcbiAgICAgICAgY29uc3QgcHJldmlvdXNIYXNoID0gcmVhZEZpbGVTeW5jKHBhY2thZ2VIYXNoUGF0aCwgJ3V0Zi04JykudHJpbSgpO1xuICAgICAgICBpZiAocHJldmlvdXNIYXNoID09PSBjdXJyZW50UGFja2FnZUhhc2gpIHtcbiAgICAgICAgICAgIGxvZ2dlci5pbmZvKGDinJMgRGVwZW5kZW5jaWVzIGFscmVhZHkgaW5zdGFsbGVkIGZvciAke3BhY2thZ2VOYW1lcy5qb2luKCcsICcpfSwgc2tpcHBpbmcgbnBtIGluc3RhbGxgKTtcbiAgICAgICAgICAgIHJldHVybjsgLy8gU0FWRUQgMTErIFNFQ09ORFMhXG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgLy8gU0xPVyBQQVRIOiBOZWVkIHRvIHJ1biBucG0gaW5zdGFsbFxuICAgIGxvZ2dlci5pbmZvKGBJbnN0YWxsaW5nICR7cGFja2FnZU5hbWVzLmxlbmd0aH0gZXh0ZXJuYWwgZGVwZW5kZW5jaWVzOiAke3BhY2thZ2VOYW1lcy5qb2luKCcsICcpfWApO1xuICAgIGxvZ2dlci5pbmZvKCfij7EgIFRoaXMgd2lsbCB0YWtlIH4xMC0xNSBzZWNvbmRzIChucG0gaW5zdGFsbCBmcm9tIHJlZ2lzdHJ5KS4uLicpO1xuICAgIFxuICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gICAgXG4gICAgLy8gRW5zdXJlIGRpcmVjdG9yeSBleGlzdHNcbiAgICBpZiAoIWV4aXN0c1N5bmMobm9kZWpzRGlyKSkge1xuICAgICAgICBta2RpclN5bmMobm9kZWpzRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICB9XG4gICAgXG4gICAgLy8gV3JpdGUgcGFja2FnZS5qc29uXG4gICAgd3JpdGVGaWxlU3luYyhwYWNrYWdlSnNvblBhdGgsIHBhY2thZ2VKc29uQ29udGVudCk7XG4gICAgXG4gICAgdHJ5IHtcbiAgICAgICAgLy8gVXNlIG5wbSBjaSBpZiBwYWNrYWdlLWxvY2sgZXhpc3RzLCBvdGhlcndpc2UgbnBtIGluc3RhbGxcbiAgICAgICAgLy8gQWRkIC0tcHJlZmVyLW9mZmxpbmUgdG8gdXNlIGxvY2FsIG5wbSBjYWNoZSB3aGVuIHBvc3NpYmxlXG4gICAgICAgIGNvbnN0IG5wbUNvbW1hbmQgPSAnbnBtIGluc3RhbGwgLS1vbWl0PWRldiAtLW5vLXBhY2thZ2UtbG9jayAtLXByZWZlci1vZmZsaW5lJztcbiAgICAgICAgXG4gICAgICAgIGV4ZWNTeW5jKG5wbUNvbW1hbmQsIHtcbiAgICAgICAgICAgIGN3ZDogbm9kZWpzRGlyLFxuICAgICAgICAgICAgc3RkaW86ICdpbmhlcml0J1xuICAgICAgICB9KTtcbiAgICAgICAgXG4gICAgICAgIGNvbnN0IGVsYXBzZWQgPSAoKERhdGUubm93KCkgLSBzdGFydFRpbWUpIC8gMTAwMCkudG9GaXhlZCgxKTtcbiAgICAgICAgbG9nZ2VyLmluZm8oYOKckyBEZXBlbmRlbmNpZXMgaW5zdGFsbGVkIHN1Y2Nlc3NmdWxseSBpbiAke2VsYXBzZWR9c2ApO1xuICAgICAgICBcbiAgICAgICAgLy8gU2F2ZSBoYXNoIGZvciBuZXh0IHJ1blxuICAgICAgICB3cml0ZUZpbGVTeW5jKHBhY2thZ2VIYXNoUGF0aCwgY3VycmVudFBhY2thZ2VIYXNoKTtcbiAgICAgICAgXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgbG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gaW5zdGFsbCBleHRlcm5hbCBkZXBlbmRlbmNpZXM6JywgZXJyb3IpO1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG59XG5cbi8qKlxuICogTUFJTiBPUFRJTUlaQVRJT046IE1vZGlmaWVkIHRyeUNyZWF0ZUxheWVyRm9yRmlsZVxuICogXG4gKiBOZXcgZmxvdzpcbiAqIDEuIENhbGN1bGF0ZSBzb3VyY2UgaGFzaFxuICogMi4gQ2hlY2sgaWYgcmVidWlsZCBuZWVkZWQgKGZhc3QhKVxuICogMy4gSWYgbm86IHNraXAgZXZlcnl0aGluZywgZG9uZSBpbiA8MTAwbXNcbiAqIDQuIElmIHllczogYnVuZGxlICsgaW5zdGFsbCAoYnV0IHJldXNlIG5wbSBjYWNoZSlcbiAqL1xuYXN5bmMgZnVuY3Rpb24gdHJ5Q3JlYXRlTGF5ZXJGb3JGaWxlT3B0aW1pemVkKFxuICAgIGZpbGU6IHN0cmluZyxcbiAgICBkaXN0RGlyZWN0b3J5OiBzdHJpbmcsXG4gICAgbGF5ZXJDb25maWc6IGFueSxcbiAgICBsb2dnZXI6IGFueVxuKSB7XG4gICAgY29uc3QgZmlsZUJhc2VOYW1lID0gcGF0aEJhc2VOYW1lKGZpbGUsIHBhdGhFeHRuYW1lKGZpbGUpKTtcbiAgICBjb25zdCBsYXllck5hbWUgPSBmaWxlQmFzZU5hbWU7IC8vIFNpbXBsaWZpZWQgZm9yIGV4YW1wbGVcbiAgICBjb25zdCBidW5kbGVEaXIgPSBwYXRoSm9pbihkaXN0RGlyZWN0b3J5LCBsYXllck5hbWUpO1xuICAgIFxuICAgIGNvbnN0IGJ1aWxkT3B0aW9ucyA9IHsgZXh0ZXJuYWw6IGxheWVyQ29uZmlnLmV4dGVybmFsIHx8IFtdIH07IC8vIFNpbXBsaWZpZWRcbiAgICBcbiAgICBjb25zdCBwcm9qZWN0UGFja2FnZUpzb25QYXRoID0gcGF0aEpvaW4ocGF0aFJlc29sdmUocHJvY2Vzcy5jd2QoKSksICdwYWNrYWdlLmpzb24nKTtcbiAgICBcbiAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICAvLyBTVEVQIDE6IENhbGN1bGF0ZSBzb3VyY2UgaGFzaFxuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgIGxvZ2dlci5pbmZvKGBbJHtsYXllck5hbWV9XSBDaGVja2luZyBpZiByZWJ1aWxkIGlzIG5lZWRlZC4uLmApO1xuICAgIFxuICAgIGNvbnN0IGN1cnJlbnRIYXNoID0gY2FsY3VsYXRlTGF5ZXJTb3VyY2VIYXNoKFxuICAgICAgICBmaWxlLFxuICAgICAgICBidWlsZE9wdGlvbnMuZXh0ZXJuYWwsXG4gICAgICAgIHByb2plY3RQYWNrYWdlSnNvblBhdGhcbiAgICApO1xuICAgIFxuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgIC8vIFNURVAgMjogQ2hlY2sgaWYgcmVidWlsZCBuZWVkZWRcbiAgICAvLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZBcbiAgICBjb25zdCByZWJ1aWxkQ2hlY2sgPSBjaGVja0lmTGF5ZXJOZWVkc1JlYnVpbGQobGF5ZXJOYW1lLCBidW5kbGVEaXIsIGN1cnJlbnRIYXNoLCBsb2dnZXIpO1xuICAgIFxuICAgIGlmICghcmVidWlsZENoZWNrLm5lZWRzUmVidWlsZCkge1xuICAgICAgICBsb2dnZXIuaW5mbyhgWyR7bGF5ZXJOYW1lfV0g4pyTICR7cmVidWlsZENoZWNrLnJlYXNvbn0gLSB1c2luZyBjYWNoZWQgYnVpbGRgKTtcbiAgICAgICAgbG9nZ2VyLmluZm8oYFske2xheWVyTmFtZX1dIOKaoSBTa2lwcGVkIHJlYnVpbGQgKHNhdmVkIH4xNSBzZWNvbmRzISlgKTtcbiAgICAgICAgXG4gICAgICAgIC8vIFN0aWxsIG5lZWQgdG8gcmVnaXN0ZXIgdGhlIGxheWVyIHdpdGggQ0RLLCBidXQgbm8gcmVidWlsZCBuZWVkZWRcbiAgICAgICAgLy8gLi4uIChDREsgbGF5ZXIgcmVnaXN0cmF0aW9uIGNvZGUgaGVyZSkgLi4uXG4gICAgICAgIFxuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIFxuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgIC8vIFNURVAgMzogUmVidWlsZCBuZWVkZWQgLSBkbyB0aGUgd29ya1xuICAgIC8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkFxuICAgIGxvZ2dlci5pbmZvKGBbJHtsYXllck5hbWV9XSBSZWJ1aWxkIHJlcXVpcmVkOiAke3JlYnVpbGRDaGVjay5yZWFzb259YCk7XG4gICAgbG9nZ2VyLmluZm8oYFske2xheWVyTmFtZX1dIFN0YXJ0aW5nIGJ1aWxkIHByb2Nlc3MuLi5gKTtcbiAgICBcbiAgICBjb25zdCBidWlsZFN0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gICAgXG4gICAgLy8gM2EuIEJ1bmRsZSB3aXRoIGVzYnVpbGQgKGZhc3QpXG4gICAgbG9nZ2VyLmluZm8oYFske2xheWVyTmFtZX1dIFsxLzNdIEJ1bmRsaW5nIHdpdGggZXNidWlsZC4uLmApO1xuICAgIGNvbnN0IG91dHB1dERpciA9IHBhdGhKb2luKGJ1bmRsZURpciwgJ25vZGVqcy9ub2RlX21vZHVsZXMnLCBmaWxlQmFzZU5hbWUpO1xuICAgIGNvbnN0IG91dHB1dEZpbGUgPSBwYXRoSm9pbihvdXRwdXREaXIsICdpbmRleC5qcycpO1xuICAgIFxuICAgIGlmICghZXhpc3RzU3luYyhvdXRwdXREaXIpKSB7XG4gICAgICAgIG1rZGlyU3luYyhvdXRwdXREaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIH1cbiAgICBcbiAgICBhd2FpdCBidW5kbGVXaXRoRXNidWlsZChmaWxlLCBvdXRwdXRGaWxlLCBidWlsZE9wdGlvbnMpO1xuICAgIGxvZ2dlci5pbmZvKGBbJHtsYXllck5hbWV9XSDinJMgQnVuZGxpbmcgY29tcGxldGVgKTtcbiAgICBcbiAgICAvLyAzYi4gSW5zdGFsbCBkZXBlbmRlbmNpZXMgKHdpdGggY2FjaGluZyEpXG4gICAgaWYgKGJ1aWxkT3B0aW9ucy5leHRlcm5hbCAmJiBidWlsZE9wdGlvbnMuZXh0ZXJuYWwubGVuZ3RoID4gMCkge1xuICAgICAgICBsb2dnZXIuaW5mbyhgWyR7bGF5ZXJOYW1lfV0gWzIvM10gSW5zdGFsbGluZyBleHRlcm5hbCBkZXBlbmRlbmNpZXMuLi5gKTtcbiAgICAgICAgYXdhaXQgaW5zdGFsbEV4dGVybmFsRGVwZW5kZW5jaWVzT3B0aW1pemVkKFxuICAgICAgICAgICAgYnVuZGxlRGlyLFxuICAgICAgICAgICAgYnVpbGRPcHRpb25zLmV4dGVybmFsLFxuICAgICAgICAgICAgcHJvamVjdFBhY2thZ2VKc29uUGF0aCxcbiAgICAgICAgICAgIGxvZ2dlclxuICAgICAgICApO1xuICAgIH1cbiAgICBcbiAgICAvLyAzYy4gU2F2ZSBoYXNoIGZvciBuZXh0IHJ1blxuICAgIGxvZ2dlci5pbmZvKGBbJHtsYXllck5hbWV9XSBbMy8zXSBTYXZpbmcgYnVpbGQgbWV0YWRhdGEuLi5gKTtcbiAgICBjb25zdCBoYXNoRmlsZSA9IHBhdGhKb2luKGJ1bmRsZURpciwgJy5idWlsZC1oYXNoJyk7XG4gICAgd3JpdGVGaWxlU3luYyhoYXNoRmlsZSwgY3VycmVudEhhc2gpO1xuICAgIFxuICAgIGNvbnN0IGJ1aWxkRWxhcHNlZCA9ICgoRGF0ZS5ub3coKSAtIGJ1aWxkU3RhcnRUaW1lKSAvIDEwMDApLnRvRml4ZWQoMSk7XG4gICAgbG9nZ2VyLmluZm8oYFske2xheWVyTmFtZX1dIOKckyBCdWlsZCBjb21wbGV0ZSBpbiAke2J1aWxkRWxhcHNlZH1zYCk7XG4gICAgXG4gICAgLy8gLi4uIChDREsgbGF5ZXIgcmVnaXN0cmF0aW9uIGNvZGUgaGVyZSkgLi4uXG59XG5cbi8qKlxuICogVVNBR0UgRVhBTVBMRTpcbiAqIFxuICogRmlyc3QgcnVuIChub3RoaW5nIGNhY2hlZCk6XG4gKiBbZGldIENoZWNraW5nIGlmIHJlYnVpbGQgaXMgbmVlZGVkLi4uXG4gKiBbZGldIFJlYnVpbGQgcmVxdWlyZWQ6IE91dHB1dCBkaXJlY3RvcnkgZG9lcyBub3QgZXhpc3QgKGZpcnN0IGJ1aWxkKVxuICogW2RpXSBTdGFydGluZyBidWlsZCBwcm9jZXNzLi4uXG4gKiBbZGldIFsxLzNdIEJ1bmRsaW5nIHdpdGggZXNidWlsZC4uLlxuICogW2RpXSDinJMgQnVuZGxpbmcgY29tcGxldGVcbiAqIFtkaV0gWzIvM10gSW5zdGFsbGluZyBleHRlcm5hbCBkZXBlbmRlbmNpZXMuLi5cbiAqIFtkaV0gSW5zdGFsbGluZyA0IGV4dGVybmFsIGRlcGVuZGVuY2llczogYXhpb3MsIGZpcmViYXNlLWFkbWluLCBzdHJpcGUsIHJhem9ycGF5XG4gKiBbZGldIOKPsSAgVGhpcyB3aWxsIHRha2UgfjEwLTE1IHNlY29uZHMgKG5wbSBpbnN0YWxsIGZyb20gcmVnaXN0cnkpLi4uXG4gKiBbZGldIOKckyBEZXBlbmRlbmNpZXMgaW5zdGFsbGVkIHN1Y2Nlc3NmdWxseSBpbiAxMi4zc1xuICogW2RpXSBbMy8zXSBTYXZpbmcgYnVpbGQgbWV0YWRhdGEuLi5cbiAqIFtkaV0g4pyTIEJ1aWxkIGNvbXBsZXRlIGluIDEyLjhzXG4gKiBcbiAqIFNlY29uZCBydW4gKG5vdGhpbmcgY2hhbmdlZCk6XG4gKiBbZGldIENoZWNraW5nIGlmIHJlYnVpbGQgaXMgbmVlZGVkLi4uXG4gKiBbZGldIOKckyBObyBjaGFuZ2VzIGRldGVjdGVkIC0gdXNpbmcgY2FjaGVkIGJ1aWxkXG4gKiBbZGldIOKaoSBTa2lwcGVkIHJlYnVpbGQgKHNhdmVkIH4xNSBzZWNvbmRzISlcbiAqIFxuICogVGhpcmQgcnVuIChzb3VyY2UgY2hhbmdlZCk6XG4gKiBbZGldIENoZWNraW5nIGlmIHJlYnVpbGQgaXMgbmVlZGVkLi4uXG4gKiBbZGldIFJlYnVpbGQgcmVxdWlyZWQ6IFNvdXJjZSBjb2RlIG9yIGRlcGVuZGVuY2llcyBjaGFuZ2VkXG4gKiBbZGldIFN0YXJ0aW5nIGJ1aWxkIHByb2Nlc3MuLi5cbiAqIFtkaV0gWzEvM10gQnVuZGxpbmcgd2l0aCBlc2J1aWxkLi4uXG4gKiBbZGldIOKckyBCdW5kbGluZyBjb21wbGV0ZVxuICogW2RpXSBbMi8zXSBJbnN0YWxsaW5nIGV4dGVybmFsIGRlcGVuZGVuY2llcy4uLlxuICogW2RpXSDinJMgRGVwZW5kZW5jaWVzIGFscmVhZHkgaW5zdGFsbGVkIGZvciBheGlvcywgZmlyZWJhc2UtYWRtaW4sIHN0cmlwZSwgcmF6b3JwYXksIHNraXBwaW5nIG5wbSBpbnN0YWxsXG4gKiBbZGldIFszLzNdIFNhdmluZyBidWlsZCBtZXRhZGF0YS4uLlxuICogW2RpXSDinJMgQnVpbGQgY29tcGxldGUgaW4gMC4zcyAg4oaQIEZBU1QhIFJldXNlZCBucG0gY2FjaGVcbiAqL1xuXG4vLyBJbXBvcnRzIG5lZWRlZCAoYWRkIHRoZXNlIHRvIHRoZSB0b3Agb2YgdGhlIGFjdHVhbCBmaWxlKVxuaW1wb3J0IHsgbWtkaXJTeW5jIH0gZnJvbSAnZnMnO1xuaW1wb3J0IHsgZXhlY1N5bmMgfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IGJhc2VuYW1lIGFzIHBhdGhCYXNlTmFtZSwgZXh0bmFtZSBhcyBwYXRoRXh0bmFtZSB9IGZyb20gJ3BhdGgnO1xuXG4vLyBUaGVzZSB3b3VsZCBiZSByZWZlcmVuY2VzIHRvIGV4aXN0aW5nIGZ1bmN0aW9ucyBpbiBsYXllci50c1xuZGVjbGFyZSBmdW5jdGlvbiBidW5kbGVXaXRoRXNidWlsZChmaWxlOiBzdHJpbmcsIG91dHB1dDogc3RyaW5nLCBvcHRpb25zOiBhbnkpOiBQcm9taXNlPHZvaWQ+O1xuXG4iXX0=
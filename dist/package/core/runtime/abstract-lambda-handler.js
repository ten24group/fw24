"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AbstractLambdaHandler = void 0;
const logging_1 = require("../../logging");
const validation_1 = require("../../validation");
const observability_1 = require("../../observability");
const decorator_utils_1 = require("../../decorators/decorator-utils");
class AbstractLambdaHandler {
    logger = (0, logging_1.createLogger)(this.constructor.name);
    validator = validation_1.DefaultValidator;
    /**
     * Binds the LambdaHandler method to the instance of the class.
     */
    constructor() {
        this.LambdaHandler = this.LambdaHandler.bind(this);
    }
    /**
     * Initialize observability for this invocation.
     * Called at the start of each handler execution.
     *
     * Ensure entry packages are loaded proeprly, before
     * before observability initialization attempts to resolve config.
     */
    initializeEntryPackagesAndObservability() {
        // Load entry packages (idempotent - safe to call multiple times)
        // This ensures DI config is available for bundled framework handlers
        (0, decorator_utils_1.tryImportingEntryPackagesFor)(this.constructor.name);
        // Now initialize observability with proper DI config
        observability_1.ObservabilityManager.initializeInvocation();
    }
    /**
     * Flush observability data at the end of handler execution.
     */
    async flushObservability() {
        await observability_1.ObservabilityManager.flush();
    }
    /**
     * Creates a new instance of the controller and returns its LambdaHandler method.
     * @returns The LambdaHandler method of the controller.
     */
    static CreateHandler(handlerFunc) {
        const instance = new handlerFunc();
        return instance.LambdaHandler;
    }
}
exports.AbstractLambdaHandler = AbstractLambdaHandler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWJzdHJhY3QtbGFtYmRhLWhhbmRsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL2Fic3RyYWN0LWxhbWJkYS1oYW5kbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDJDQUE2QztBQUM3QyxpREFBZ0U7QUFDaEUsdURBQTJEO0FBQzNELHNFQUFnRjtBQUVoRixNQUFzQixxQkFBcUI7SUFDaEMsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzVDLFNBQVMsR0FBZSw2QkFBZ0IsQ0FBQztJQUVuRDs7T0FFRztJQUNIO1FBQ0UsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQTtJQUNwRCxDQUFDO0lBSUQ7Ozs7OztPQU1HO0lBQ08sdUNBQXVDO1FBQy9DLGlFQUFpRTtRQUNqRSxxRUFBcUU7UUFDckUsSUFBQSw4Q0FBNEIsRUFBQyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBRXBELHFEQUFxRDtRQUNyRCxvQ0FBb0IsQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO0lBQzlDLENBQUM7SUFFRDs7T0FFRztJQUNPLEtBQUssQ0FBQyxrQkFBa0I7UUFDaEMsTUFBTSxvQ0FBb0IsQ0FBQyxLQUFLLEVBQUUsQ0FBQztJQUNyQyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsTUFBTSxDQUFDLGFBQWEsQ0FBQyxXQUE2QztRQUNoRSxNQUFNLFFBQVEsR0FBRyxJQUFJLFdBQVcsRUFBRSxDQUFDO1FBQ25DLE9BQU8sUUFBUSxDQUFDLGFBQWEsQ0FBQztJQUNoQyxDQUFDO0NBQ0Y7QUE1Q0Qsc0RBNENDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcIi4uLy4uL2xvZ2dpbmdcIjtcbmltcG9ydCB7IERlZmF1bHRWYWxpZGF0b3IsIElWYWxpZGF0b3IgfSBmcm9tIFwiLi4vLi4vdmFsaWRhdGlvblwiO1xuaW1wb3J0IHsgT2JzZXJ2YWJpbGl0eU1hbmFnZXIgfSBmcm9tIFwiLi4vLi4vb2JzZXJ2YWJpbGl0eVwiO1xuaW1wb3J0IHsgdHJ5SW1wb3J0aW5nRW50cnlQYWNrYWdlc0ZvciB9IGZyb20gXCIuLi8uLi9kZWNvcmF0b3JzL2RlY29yYXRvci11dGlsc1wiO1xuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIHtcbiAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKHRoaXMuY29uc3RydWN0b3IubmFtZSk7XG4gIHByb3RlY3RlZCB2YWxpZGF0b3I6IElWYWxpZGF0b3IgPSBEZWZhdWx0VmFsaWRhdG9yO1xuXG4gIC8qKlxuICAgKiBCaW5kcyB0aGUgTGFtYmRhSGFuZGxlciBtZXRob2QgdG8gdGhlIGluc3RhbmNlIG9mIHRoZSBjbGFzcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMuTGFtYmRhSGFuZGxlciA9IHRoaXMuTGFtYmRhSGFuZGxlci5iaW5kKHRoaXMpXG4gIH1cblxuICBhYnN0cmFjdCBMYW1iZGFIYW5kbGVyKGV2ZW50OiBhbnksIGNvbnRleHQ6IGFueSk6IFByb21pc2U8YW55PjtcblxuICAvKipcbiAgICogSW5pdGlhbGl6ZSBvYnNlcnZhYmlsaXR5IGZvciB0aGlzIGludm9jYXRpb24uXG4gICAqIENhbGxlZCBhdCB0aGUgc3RhcnQgb2YgZWFjaCBoYW5kbGVyIGV4ZWN1dGlvbi5cbiAgICogXG4gICAqIEVuc3VyZSBlbnRyeSBwYWNrYWdlcyBhcmUgbG9hZGVkIHByb2Vwcmx5LCBiZWZvcmUgXG4gICAqIGJlZm9yZSBvYnNlcnZhYmlsaXR5IGluaXRpYWxpemF0aW9uIGF0dGVtcHRzIHRvIHJlc29sdmUgY29uZmlnLlxuICAgKi9cbiAgcHJvdGVjdGVkIGluaXRpYWxpemVFbnRyeVBhY2thZ2VzQW5kT2JzZXJ2YWJpbGl0eSgpOiB2b2lkIHtcbiAgICAvLyBMb2FkIGVudHJ5IHBhY2thZ2VzIChpZGVtcG90ZW50IC0gc2FmZSB0byBjYWxsIG11bHRpcGxlIHRpbWVzKVxuICAgIC8vIFRoaXMgZW5zdXJlcyBESSBjb25maWcgaXMgYXZhaWxhYmxlIGZvciBidW5kbGVkIGZyYW1ld29yayBoYW5kbGVyc1xuICAgIHRyeUltcG9ydGluZ0VudHJ5UGFja2FnZXNGb3IodGhpcy5jb25zdHJ1Y3Rvci5uYW1lKTtcblxuICAgIC8vIE5vdyBpbml0aWFsaXplIG9ic2VydmFiaWxpdHkgd2l0aCBwcm9wZXIgREkgY29uZmlnXG4gICAgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuaW5pdGlhbGl6ZUludm9jYXRpb24oKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBGbHVzaCBvYnNlcnZhYmlsaXR5IGRhdGEgYXQgdGhlIGVuZCBvZiBoYW5kbGVyIGV4ZWN1dGlvbi5cbiAgICovXG4gIHByb3RlY3RlZCBhc3luYyBmbHVzaE9ic2VydmFiaWxpdHkoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZmx1c2goKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgbmV3IGluc3RhbmNlIG9mIHRoZSBjb250cm9sbGVyIGFuZCByZXR1cm5zIGl0cyBMYW1iZGFIYW5kbGVyIG1ldGhvZC5cbiAgICogQHJldHVybnMgVGhlIExhbWJkYUhhbmRsZXIgbWV0aG9kIG9mIHRoZSBjb250cm9sbGVyLlxuICAgKi9cbiAgc3RhdGljIENyZWF0ZUhhbmRsZXIoaGFuZGxlckZ1bmM6IHsgbmV3KCk6IEFic3RyYWN0TGFtYmRhSGFuZGxlciB9KSB7XG4gICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgaGFuZGxlckZ1bmMoKTtcbiAgICByZXR1cm4gaW5zdGFuY2UuTGFtYmRhSGFuZGxlcjtcbiAgfVxufSJdfQ==
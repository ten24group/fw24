"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AbstractLambdaHandler = void 0;
const logging_1 = require("../../logging");
const validation_1 = require("../../validation");
const observability_1 = require("../../observability");
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
     */
    initializeObservability() {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWJzdHJhY3QtbGFtYmRhLWhhbmRsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL2Fic3RyYWN0LWxhbWJkYS1oYW5kbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDJDQUE2QztBQUM3QyxpREFBZ0U7QUFDaEUsdURBQTJEO0FBRTNELE1BQXNCLHFCQUFxQjtJQUNoQyxNQUFNLEdBQUcsSUFBQSxzQkFBWSxFQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDNUMsU0FBUyxHQUFlLDZCQUFnQixDQUFDO0lBRW5EOztPQUVHO0lBQ0g7UUFDRSxJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBO0lBQ3BELENBQUM7SUFJRDs7O09BR0c7SUFDTyx1QkFBdUI7UUFDL0Isb0NBQW9CLENBQUMsb0JBQW9CLEVBQUUsQ0FBQztJQUM5QyxDQUFDO0lBRUQ7O09BRUc7SUFDTyxLQUFLLENBQUMsa0JBQWtCO1FBQ2hDLE1BQU0sb0NBQW9CLENBQUMsS0FBSyxFQUFFLENBQUM7SUFDckMsQ0FBQztJQUVEOzs7T0FHRztJQUNILE1BQU0sQ0FBQyxhQUFhLENBQUMsV0FBNkM7UUFDaEUsTUFBTSxRQUFRLEdBQUcsSUFBSSxXQUFXLEVBQUUsQ0FBQztRQUNuQyxPQUFPLFFBQVEsQ0FBQyxhQUFhLENBQUM7SUFDaEMsQ0FBQztDQUNGO0FBcENELHNEQW9DQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuLi8uLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBEZWZhdWx0VmFsaWRhdG9yLCBJVmFsaWRhdG9yIH0gZnJvbSBcIi4uLy4uL3ZhbGlkYXRpb25cIjtcbmltcG9ydCB7IE9ic2VydmFiaWxpdHlNYW5hZ2VyIH0gZnJvbSBcIi4uLy4uL29ic2VydmFiaWxpdHlcIjtcblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEFic3RyYWN0TGFtYmRhSGFuZGxlciB7XG4gIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcih0aGlzLmNvbnN0cnVjdG9yLm5hbWUpO1xuICBwcm90ZWN0ZWQgdmFsaWRhdG9yOiBJVmFsaWRhdG9yID0gRGVmYXVsdFZhbGlkYXRvcjtcblxuICAvKipcbiAgICogQmluZHMgdGhlIExhbWJkYUhhbmRsZXIgbWV0aG9kIHRvIHRoZSBpbnN0YW5jZSBvZiB0aGUgY2xhc3MuXG4gICAqL1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICB0aGlzLkxhbWJkYUhhbmRsZXIgPSB0aGlzLkxhbWJkYUhhbmRsZXIuYmluZCh0aGlzKVxuICB9XG5cbiAgYWJzdHJhY3QgTGFtYmRhSGFuZGxlcihldmVudDogYW55LCBjb250ZXh0OiBhbnkpOiBQcm9taXNlPGFueT47XG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemUgb2JzZXJ2YWJpbGl0eSBmb3IgdGhpcyBpbnZvY2F0aW9uLlxuICAgKiBDYWxsZWQgYXQgdGhlIHN0YXJ0IG9mIGVhY2ggaGFuZGxlciBleGVjdXRpb24uXG4gICAqL1xuICBwcm90ZWN0ZWQgaW5pdGlhbGl6ZU9ic2VydmFiaWxpdHkoKTogdm9pZCB7XG4gICAgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuaW5pdGlhbGl6ZUludm9jYXRpb24oKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBGbHVzaCBvYnNlcnZhYmlsaXR5IGRhdGEgYXQgdGhlIGVuZCBvZiBoYW5kbGVyIGV4ZWN1dGlvbi5cbiAgICovXG4gIHByb3RlY3RlZCBhc3luYyBmbHVzaE9ic2VydmFiaWxpdHkoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgT2JzZXJ2YWJpbGl0eU1hbmFnZXIuZmx1c2goKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgbmV3IGluc3RhbmNlIG9mIHRoZSBjb250cm9sbGVyIGFuZCByZXR1cm5zIGl0cyBMYW1iZGFIYW5kbGVyIG1ldGhvZC5cbiAgICogQHJldHVybnMgVGhlIExhbWJkYUhhbmRsZXIgbWV0aG9kIG9mIHRoZSBjb250cm9sbGVyLlxuICAgKi9cbiAgc3RhdGljIENyZWF0ZUhhbmRsZXIoaGFuZGxlckZ1bmM6IHsgbmV3KCk6IEFic3RyYWN0TGFtYmRhSGFuZGxlciB9KSB7XG4gICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgaGFuZGxlckZ1bmMoKTtcbiAgICByZXR1cm4gaW5zdGFuY2UuTGFtYmRhSGFuZGxlcjtcbiAgfVxufSJdfQ==
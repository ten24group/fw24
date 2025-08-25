"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AbstractLambdaHandler = void 0;
const logging_1 = require("../../logging");
const validation_1 = require("../../validation");
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
       * Creates a new instance of the controller and returns its LambdaHandler method.
       * @returns The LambdaHandler method of the controller.
       */
    static CreateHandler(handlerFunc) {
        const instance = new handlerFunc();
        return instance.LambdaHandler;
    }
}
exports.AbstractLambdaHandler = AbstractLambdaHandler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWJzdHJhY3QtbGFtYmRhLWhhbmRsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL2Fic3RyYWN0LWxhbWJkYS1oYW5kbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDJDQUE2QztBQUM3QyxpREFBZ0U7QUFFaEUsTUFBc0IscUJBQXFCO0lBQ2hDLE1BQU0sR0FBRyxJQUFBLHNCQUFZLEVBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUM1QyxTQUFTLEdBQWUsNkJBQWdCLENBQUM7SUFFbkQ7O09BRUc7SUFDSDtRQUNFLElBQUksQ0FBQyxhQUFhLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUE7SUFDcEQsQ0FBQztJQUlIOzs7U0FHSztJQUNILE1BQU0sQ0FBQyxhQUFhLENBQUUsV0FBNkM7UUFDakUsTUFBTSxRQUFRLEdBQUcsSUFBSSxXQUFXLEVBQUUsQ0FBQztRQUNuQyxPQUFPLFFBQVEsQ0FBQyxhQUFhLENBQUM7SUFDaEMsQ0FBQztDQUNGO0FBckJELHNEQXFCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGNyZWF0ZUxvZ2dlciB9IGZyb20gXCIuLi8uLi9sb2dnaW5nXCI7XG5pbXBvcnQgeyBEZWZhdWx0VmFsaWRhdG9yLCBJVmFsaWRhdG9yIH0gZnJvbSBcIi4uLy4uL3ZhbGlkYXRpb25cIjtcblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEFic3RyYWN0TGFtYmRhSGFuZGxlciB7XG4gIHJlYWRvbmx5IGxvZ2dlciA9IGNyZWF0ZUxvZ2dlcih0aGlzLmNvbnN0cnVjdG9yLm5hbWUpO1xuICBwcm90ZWN0ZWQgdmFsaWRhdG9yOiBJVmFsaWRhdG9yID0gRGVmYXVsdFZhbGlkYXRvcjtcblxuICAvKipcbiAgICogQmluZHMgdGhlIExhbWJkYUhhbmRsZXIgbWV0aG9kIHRvIHRoZSBpbnN0YW5jZSBvZiB0aGUgY2xhc3MuXG4gICAqL1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICB0aGlzLkxhbWJkYUhhbmRsZXIgPSB0aGlzLkxhbWJkYUhhbmRsZXIuYmluZCh0aGlzKVxuICB9XG5cbiAgYWJzdHJhY3QgTGFtYmRhSGFuZGxlciggZXZlbnQ6IGFueSwgY29udGV4dDogYW55KTogUHJvbWlzZTxhbnk+O1xuXG4vKipcbiAgICogQ3JlYXRlcyBhIG5ldyBpbnN0YW5jZSBvZiB0aGUgY29udHJvbGxlciBhbmQgcmV0dXJucyBpdHMgTGFtYmRhSGFuZGxlciBtZXRob2QuXG4gICAqIEByZXR1cm5zIFRoZSBMYW1iZGFIYW5kbGVyIG1ldGhvZCBvZiB0aGUgY29udHJvbGxlci5cbiAgICovXG4gIHN0YXRpYyBDcmVhdGVIYW5kbGVyKCBoYW5kbGVyRnVuYzogeyBuZXcgKCk6IEFic3RyYWN0TGFtYmRhSGFuZGxlcn0gKSB7XG4gICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgaGFuZGxlckZ1bmMoKTtcbiAgICByZXR1cm4gaW5zdGFuY2UuTGFtYmRhSGFuZGxlcjtcbiAgfVxufSJdfQ==
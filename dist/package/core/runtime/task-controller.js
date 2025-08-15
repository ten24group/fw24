"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskController = void 0;
const abstract_lambda_handler_1 = require("./abstract-lambda-handler");
/**
 * Base class for handling Schedule Tasks.
 */
class TaskController extends abstract_lambda_handler_1.AbstractLambdaHandler {
    /**
     * Lambda handler for the task.
     */
    async LambdaHandler() {
        // hook for the application to initialize it's state, Dependencies, config etc
        await this.initialize();
        // Execute the associated function
        await this.process();
    }
}
exports.TaskController = TaskController;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGFzay1jb250cm9sbGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2NvcmUvcnVudGltZS90YXNrLWNvbnRyb2xsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsdUVBQWtFO0FBRWxFOztHQUVHO0FBQ0gsTUFBZSxjQUFlLFNBQVEsK0NBQXFCO0lBTXpEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLGFBQWE7UUFDZiw4RUFBOEU7UUFDOUUsTUFBTSxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7UUFDeEIsa0NBQWtDO1FBQ2xDLE1BQU0sSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO0lBQ3pCLENBQUM7Q0FDRjtBQUVRLHdDQUFjIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIH0gZnJvbSBcIi4vYWJzdHJhY3QtbGFtYmRhLWhhbmRsZXJcIjtcblxuLyoqXG4gKiBCYXNlIGNsYXNzIGZvciBoYW5kbGluZyBTY2hlZHVsZSBUYXNrcy5cbiAqL1xuYWJzdHJhY3QgY2xhc3MgVGFza0NvbnRyb2xsZXIgZXh0ZW5kcyBBYnN0cmFjdExhbWJkYUhhbmRsZXIge1xuXG4gIGFic3RyYWN0IGluaXRpYWxpemUoKTogUHJvbWlzZTxhbnk+O1xuXG4gIGFic3RyYWN0IHByb2Nlc3MoKTogUHJvbWlzZTxhbnk+O1xuXG4gIC8qKlxuICAgKiBMYW1iZGEgaGFuZGxlciBmb3IgdGhlIHRhc2suXG4gICAqL1xuICBhc3luYyBMYW1iZGFIYW5kbGVyKCk6IFByb21pc2U8YW55PiB7XG4gICAgICAvLyBob29rIGZvciB0aGUgYXBwbGljYXRpb24gdG8gaW5pdGlhbGl6ZSBpdCdzIHN0YXRlLCBEZXBlbmRlbmNpZXMsIGNvbmZpZyBldGNcbiAgICAgIGF3YWl0IHRoaXMuaW5pdGlhbGl6ZSgpO1xuICAgICAgLy8gRXhlY3V0ZSB0aGUgYXNzb2NpYXRlZCBmdW5jdGlvblxuICAgICAgYXdhaXQgdGhpcy5wcm9jZXNzKCk7XG4gIH1cbn1cblxuZXhwb3J0IHsgVGFza0NvbnRyb2xsZXIgfTsiXX0=
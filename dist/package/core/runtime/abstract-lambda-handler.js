"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AbstractLambdaHandler = void 0;
const logging_1 = require("../../logging");
class AbstractLambdaHandler {
    logger = (0, logging_1.createLogger)(this.constructor.name);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWJzdHJhY3QtbGFtYmRhLWhhbmRsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvY29yZS9ydW50aW1lL2Fic3RyYWN0LWxhbWJkYS1oYW5kbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDJDQUE2QztBQUU3QyxNQUFzQixxQkFBcUI7SUFDaEMsTUFBTSxHQUFHLElBQUEsc0JBQVksRUFBQyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBRXREOztPQUVHO0lBQ0g7UUFDRSxJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFBO0lBQ3BELENBQUM7SUFJSDs7O1NBR0s7SUFDSCxNQUFNLENBQUMsYUFBYSxDQUFFLFdBQTZDO1FBQ2pFLE1BQU0sUUFBUSxHQUFHLElBQUksV0FBVyxFQUFFLENBQUM7UUFDbkMsT0FBTyxRQUFRLENBQUMsYUFBYSxDQUFDO0lBQ2hDLENBQUM7Q0FDRjtBQXBCRCxzREFvQkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBjcmVhdGVMb2dnZXIgfSBmcm9tIFwiLi4vLi4vbG9nZ2luZ1wiO1xuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgQWJzdHJhY3RMYW1iZGFIYW5kbGVyIHtcbiAgcmVhZG9ubHkgbG9nZ2VyID0gY3JlYXRlTG9nZ2VyKHRoaXMuY29uc3RydWN0b3IubmFtZSk7XG5cbiAgLyoqXG4gICAqIEJpbmRzIHRoZSBMYW1iZGFIYW5kbGVyIG1ldGhvZCB0byB0aGUgaW5zdGFuY2Ugb2YgdGhlIGNsYXNzLlxuICAgKi9cbiAgY29uc3RydWN0b3IoKSB7XG4gICAgdGhpcy5MYW1iZGFIYW5kbGVyID0gdGhpcy5MYW1iZGFIYW5kbGVyLmJpbmQodGhpcylcbiAgfVxuXG4gIGFic3RyYWN0IExhbWJkYUhhbmRsZXIoIGV2ZW50OiBhbnksIGNvbnRleHQ6IGFueSk6IFByb21pc2U8YW55PjtcblxuLyoqXG4gICAqIENyZWF0ZXMgYSBuZXcgaW5zdGFuY2Ugb2YgdGhlIGNvbnRyb2xsZXIgYW5kIHJldHVybnMgaXRzIExhbWJkYUhhbmRsZXIgbWV0aG9kLlxuICAgKiBAcmV0dXJucyBUaGUgTGFtYmRhSGFuZGxlciBtZXRob2Qgb2YgdGhlIGNvbnRyb2xsZXIuXG4gICAqL1xuICBzdGF0aWMgQ3JlYXRlSGFuZGxlciggaGFuZGxlckZ1bmM6IHsgbmV3ICgpOiBBYnN0cmFjdExhbWJkYUhhbmRsZXJ9ICkge1xuICAgIGNvbnN0IGluc3RhbmNlID0gbmV3IGhhbmRsZXJGdW5jKCk7XG4gICAgcmV0dXJuIGluc3RhbmNlLkxhbWJkYUhhbmRsZXI7XG4gIH1cbn0iXX0=
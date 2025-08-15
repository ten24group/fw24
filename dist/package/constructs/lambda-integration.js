"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LambdaIntegration = void 0;
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const apigateway = __importStar(require("aws-cdk-lib/aws-apigateway"));
class LambdaIntegration extends apigateway.LambdaIntegration {
    constructor(handler, options) {
        super(handler, options);
        handler.addPermission('BaseRoutesHandler_ApiGatewayPermissions', {
            principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
            action: 'lambda:InvokeFunction',
            sourceArn: options.restApi.arnForExecuteApi('*', `/${options.path}`, '*')
        });
        handler.addPermission('AllRoutesHandler_ApiGatewayPermissions', {
            principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
            action: 'lambda:InvokeFunction',
            sourceArn: options.restApi.arnForExecuteApi('*', `/${options.path}`, '*') + '/*'
        });
    }
    bind(method) {
        const integrationConfig = super.bind(method);
        // Remove all AWS::Lambda::Permission on methods
        const permissions = method.node.children.filter(c => c instanceof lambda.CfnPermission);
        permissions.forEach(p => method.node.tryRemoveChild(p.node.id));
        return integrationConfig;
    }
}
exports.LambdaIntegration = LambdaIntegration;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLWludGVncmF0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvbnN0cnVjdHMvbGFtYmRhLWludGVncmF0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLHlEQUEyQztBQUMzQywrREFBaUQ7QUFDakQsdUVBQXlEO0FBT3pELE1BQWEsaUJBQWtCLFNBQVEsVUFBVSxDQUFDLGlCQUFpQjtJQUVqRSxZQUFZLE9BQXlCLEVBQUUsT0FBa0Q7UUFDdkYsS0FBSyxDQUFDLE9BQU8sRUFBRSxPQUFPLENBQUMsQ0FBQztRQUV4QixPQUFPLENBQUMsYUFBYSxDQUFDLHlDQUF5QyxFQUFFO1lBQy9ELFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQywwQkFBMEIsQ0FBQztZQUMvRCxNQUFNLEVBQUUsdUJBQXVCO1lBQy9CLFNBQVMsRUFBRSxPQUFPLENBQUMsT0FBTyxDQUFDLGdCQUFnQixDQUFDLEdBQUcsRUFBQyxJQUFJLE9BQU8sQ0FBQyxJQUFJLEVBQUUsRUFBQyxHQUFHLENBQUM7U0FDeEUsQ0FBQyxDQUFDO1FBRUgsT0FBTyxDQUFDLGFBQWEsQ0FBQyx3Q0FBd0MsRUFBRTtZQUM5RCxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsZ0JBQWdCLENBQUMsMEJBQTBCLENBQUM7WUFDL0QsTUFBTSxFQUFFLHVCQUF1QjtZQUMvQixTQUFTLEVBQUUsT0FBTyxDQUFDLE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLEVBQUMsSUFBSSxPQUFPLENBQUMsSUFBSSxFQUFFLEVBQUMsR0FBRyxDQUFDLEdBQUcsSUFBSTtTQUMvRSxDQUFDLENBQUM7SUFFTCxDQUFDO0lBRUQsSUFBSSxDQUFDLE1BQXlCO1FBQzVCLE1BQU0saUJBQWlCLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUU3QyxnREFBZ0Q7UUFDaEQsTUFBTSxXQUFXLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxZQUFZLE1BQU0sQ0FBQyxhQUFhLENBQUMsQ0FBQztRQUN4RixXQUFXLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO1FBQ2hFLE9BQU8saUJBQWlCLENBQUM7SUFDM0IsQ0FBQztDQUNGO0FBM0JELDhDQTJCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xuXG5leHBvcnQgaW50ZXJmYWNlIExhbWJkYUludGVncmF0aW9uT25lUGVybWlzc2lvbk9ubHlPcHRpb25zIGV4dGVuZHMgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbk9wdGlvbnMge1xuICByZXN0QXBpOiBhcGlnYXRld2F5LklSZXN0QXBpLFxuICBwYXRoOiBzdHJpbmdcbn1cblxuZXhwb3J0IGNsYXNzIExhbWJkYUludGVncmF0aW9uIGV4dGVuZHMgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbiB7XG5cbiAgY29uc3RydWN0b3IoaGFuZGxlcjogbGFtYmRhLklGdW5jdGlvbiwgb3B0aW9uczogTGFtYmRhSW50ZWdyYXRpb25PbmVQZXJtaXNzaW9uT25seU9wdGlvbnMpIHtcbiAgICBzdXBlcihoYW5kbGVyLCBvcHRpb25zKTtcblxuICAgIGhhbmRsZXIuYWRkUGVybWlzc2lvbignQmFzZVJvdXRlc0hhbmRsZXJfQXBpR2F0ZXdheVBlcm1pc3Npb25zJywge1xuICAgICAgcHJpbmNpcGFsOiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2FwaWdhdGV3YXkuYW1hem9uYXdzLmNvbScpLFxuICAgICAgYWN0aW9uOiAnbGFtYmRhOkludm9rZUZ1bmN0aW9uJyxcbiAgICAgIHNvdXJjZUFybjogb3B0aW9ucy5yZXN0QXBpLmFybkZvckV4ZWN1dGVBcGkoJyonLGAvJHtvcHRpb25zLnBhdGh9YCwnKicpXG4gICAgfSk7ICAgXG4gICAgXG4gICAgaGFuZGxlci5hZGRQZXJtaXNzaW9uKCdBbGxSb3V0ZXNIYW5kbGVyX0FwaUdhdGV3YXlQZXJtaXNzaW9ucycsIHtcbiAgICAgIHByaW5jaXBhbDogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdhcGlnYXRld2F5LmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIGFjdGlvbjogJ2xhbWJkYTpJbnZva2VGdW5jdGlvbicsXG4gICAgICBzb3VyY2VBcm46IG9wdGlvbnMucmVzdEFwaS5hcm5Gb3JFeGVjdXRlQXBpKCcqJyxgLyR7b3B0aW9ucy5wYXRofWAsJyonKSArICcvKidcbiAgICB9KTsgICBcblxuICB9XG5cbiAgYmluZChtZXRob2Q6IGFwaWdhdGV3YXkuTWV0aG9kKTogYXBpZ2F0ZXdheS5JbnRlZ3JhdGlvbkNvbmZpZyB7XG4gICAgY29uc3QgaW50ZWdyYXRpb25Db25maWcgPSBzdXBlci5iaW5kKG1ldGhvZCk7XG5cbiAgICAvLyBSZW1vdmUgYWxsIEFXUzo6TGFtYmRhOjpQZXJtaXNzaW9uIG9uIG1ldGhvZHNcbiAgICBjb25zdCBwZXJtaXNzaW9ucyA9IG1ldGhvZC5ub2RlLmNoaWxkcmVuLmZpbHRlcihjID0+IGMgaW5zdGFuY2VvZiBsYW1iZGEuQ2ZuUGVybWlzc2lvbik7XG4gICAgcGVybWlzc2lvbnMuZm9yRWFjaChwID0+IG1ldGhvZC5ub2RlLnRyeVJlbW92ZUNoaWxkKHAubm9kZS5pZCkpO1xuICAgIHJldHVybiBpbnRlZ3JhdGlvbkNvbmZpZztcbiAgfVxufSJdfQ==
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CognitoAuthRole = void 0;
const constructs_1 = require("constructs");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const fs_1 = require("fs");
class CognitoAuthRole extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        const { identityPool, policyFilePaths, policies } = props;
        const role = new aws_iam_1.Role(this, "CognitoAuthRole", {
            assumedBy: new aws_iam_1.FederatedPrincipal("cognito-identity.amazonaws.com", {
                "StringEquals": {
                    "cognito-identity.amazonaws.com:aud": identityPool.ref
                },
                "ForAnyValue:StringLike": {
                    "cognito-identity.amazonaws.com:amr": "authenticated"
                }
            }, "sts:AssumeRoleWithWebIdentity"),
        });
        if (policyFilePaths !== undefined) {
            // apply the policy to the role
            for (const policyFilePath of policyFilePaths) {
                // read file from policyFilePath
                const policyfile = (0, fs_1.readFileSync)(policyFilePath, 'utf8');
                role.addToPolicy(new aws_iam_1.PolicyStatement({
                    effect: JSON.parse(policyfile).Effect,
                    actions: JSON.parse(policyfile).Action,
                    resources: JSON.parse(policyfile).Resource,
                }));
            }
        }
        if (policies !== undefined) {
            for (const policy of policies) {
                role.addToPolicy(new aws_iam_1.PolicyStatement(policy));
            }
        }
        return role;
    }
}
exports.CognitoAuthRole = CognitoAuthRole;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29nbml0by1hdXRoLXJvbGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9jb2duaXRvLWF1dGgtcm9sZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSwyQ0FBdUM7QUFDdkMsaURBQXNHO0FBQ3RHLDJCQUFrQztBQVNsQyxNQUFhLGVBQWdCLFNBQVEsc0JBQVM7SUFFMUMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUE0QjtRQUNsRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBQ2pCLE1BQU0sRUFBRSxZQUFZLEVBQUUsZUFBZSxFQUFFLFFBQVEsRUFBRSxHQUFHLEtBQUssQ0FBQztRQUUxRCxNQUFNLElBQUksR0FBRyxJQUFJLGNBQUksQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDM0MsU0FBUyxFQUFFLElBQUksNEJBQWtCLENBQUMsZ0NBQWdDLEVBQUU7Z0JBQ2hFLGNBQWMsRUFBRTtvQkFDWixvQ0FBb0MsRUFBRSxZQUFZLENBQUMsR0FBRztpQkFDekQ7Z0JBQ0Qsd0JBQXdCLEVBQUU7b0JBQ3RCLG9DQUFvQyxFQUFFLGVBQWU7aUJBQ3hEO2FBQ0osRUFBRSwrQkFBK0IsQ0FBQztTQUN0QyxDQUFDLENBQUM7UUFFSCxJQUFJLGVBQWUsS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUNoQywrQkFBK0I7WUFDL0IsS0FBSyxNQUFNLGNBQWMsSUFBSSxlQUFlLEVBQUUsQ0FBQztnQkFDM0MsZ0NBQWdDO2dCQUNoQyxNQUFNLFVBQVUsR0FBVyxJQUFBLGlCQUFZLEVBQUMsY0FBYyxFQUFFLE1BQU0sQ0FBQyxDQUFDO2dCQUNoRSxJQUFJLENBQUMsV0FBVyxDQUNaLElBQUkseUJBQWUsQ0FBQztvQkFDaEIsTUFBTSxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUMsTUFBTTtvQkFDckMsT0FBTyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUMsTUFBTTtvQkFDdEMsU0FBUyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUMsUUFBUTtpQkFDN0MsQ0FBQyxDQUNMLENBQUM7WUFDTixDQUFDO1FBQ0wsQ0FBQztRQUNELElBQUksUUFBUSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ3pCLEtBQUssTUFBTSxNQUFNLElBQUksUUFBUSxFQUFFLENBQUM7Z0JBQzVCLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSx5QkFBZSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7WUFDbEQsQ0FBQztRQUNMLENBQUM7UUFDRCxPQUFPLElBQUksQ0FBQztJQUNoQixDQUFDO0NBQ0o7QUF0Q0QsMENBc0NDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcbmltcG9ydCB7IFBvbGljeVN0YXRlbWVudCwgUG9saWN5U3RhdGVtZW50UHJvcHMsIFJvbGUsIEZlZGVyYXRlZFByaW5jaXBhbCB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtaWFtXCI7XG5pbXBvcnQgeyByZWFkRmlsZVN5bmMgfSBmcm9tIFwiZnNcIjtcbmltcG9ydCB0eXBlIHsgQ2ZuSWRlbnRpdHlQb29sIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1jb2duaXRvXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgSUNvZ25pdG9BdXRoUm9sZVByb3BzIHtcbiAgICBpZGVudGl0eVBvb2w6IENmbklkZW50aXR5UG9vbDtcbiAgICBwb2xpY3lGaWxlUGF0aHM/OiBzdHJpbmdbXTtcbiAgICBwb2xpY2llcz86IEFycmF5PFBvbGljeVN0YXRlbWVudFByb3BzIHwgUG9saWN5U3RhdGVtZW50Pjtcbn1cblxuZXhwb3J0IGNsYXNzIENvZ25pdG9BdXRoUm9sZSBleHRlbmRzIENvbnN0cnVjdCB7XG5cbiAgICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogSUNvZ25pdG9BdXRoUm9sZVByb3BzKSB7XG4gICAgICAgIHN1cGVyKHNjb3BlLCBpZCk7XG4gICAgICAgIGNvbnN0IHsgaWRlbnRpdHlQb29sLCBwb2xpY3lGaWxlUGF0aHMsIHBvbGljaWVzIH0gPSBwcm9wcztcblxuICAgICAgICBjb25zdCByb2xlID0gbmV3IFJvbGUodGhpcywgXCJDb2duaXRvQXV0aFJvbGVcIiwge1xuICAgICAgICAgICAgYXNzdW1lZEJ5OiBuZXcgRmVkZXJhdGVkUHJpbmNpcGFsKFwiY29nbml0by1pZGVudGl0eS5hbWF6b25hd3MuY29tXCIsIHtcbiAgICAgICAgICAgICAgICBcIlN0cmluZ0VxdWFsc1wiOiB7XG4gICAgICAgICAgICAgICAgICAgIFwiY29nbml0by1pZGVudGl0eS5hbWF6b25hd3MuY29tOmF1ZFwiOiBpZGVudGl0eVBvb2wucmVmXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBcIkZvckFueVZhbHVlOlN0cmluZ0xpa2VcIjoge1xuICAgICAgICAgICAgICAgICAgICBcImNvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbTphbXJcIjogXCJhdXRoZW50aWNhdGVkXCJcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LCBcInN0czpBc3N1bWVSb2xlV2l0aFdlYklkZW50aXR5XCIpLFxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAocG9saWN5RmlsZVBhdGhzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIC8vIGFwcGx5IHRoZSBwb2xpY3kgdG8gdGhlIHJvbGVcbiAgICAgICAgICAgIGZvciAoY29uc3QgcG9saWN5RmlsZVBhdGggb2YgcG9saWN5RmlsZVBhdGhzKSB7XG4gICAgICAgICAgICAgICAgLy8gcmVhZCBmaWxlIGZyb20gcG9saWN5RmlsZVBhdGhcbiAgICAgICAgICAgICAgICBjb25zdCBwb2xpY3lmaWxlOiBzdHJpbmcgPSByZWFkRmlsZVN5bmMocG9saWN5RmlsZVBhdGgsICd1dGY4Jyk7XG4gICAgICAgICAgICAgICAgcm9sZS5hZGRUb1BvbGljeShcbiAgICAgICAgICAgICAgICAgICAgbmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBlZmZlY3Q6IEpTT04ucGFyc2UocG9saWN5ZmlsZSkuRWZmZWN0LFxuICAgICAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogSlNPTi5wYXJzZShwb2xpY3lmaWxlKS5BY3Rpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICByZXNvdXJjZXM6IEpTT04ucGFyc2UocG9saWN5ZmlsZSkuUmVzb3VyY2UsXG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAocG9saWNpZXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBwb2xpY3kgb2YgcG9saWNpZXMpIHtcbiAgICAgICAgICAgICAgICByb2xlLmFkZFRvUG9saWN5KG5ldyBQb2xpY3lTdGF0ZW1lbnQocG9saWN5KSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJvbGU7XG4gICAgfVxufSAgICJdfQ==
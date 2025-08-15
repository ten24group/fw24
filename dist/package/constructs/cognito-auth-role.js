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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29nbml0by1hdXRoLXJvbGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9jb2duaXRvLWF1dGgtcm9sZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSwyQ0FBdUM7QUFDdkMsaURBQWdGO0FBQ2hGLDJCQUFrQztBQUVsQyxNQUFhLGVBQWdCLFNBQVEsc0JBQVM7SUFFMUMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFVO1FBQ2hELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFDakIsTUFBTSxFQUFFLFlBQVksRUFBRSxlQUFlLEVBQUUsUUFBUSxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRTFELE1BQU0sSUFBSSxHQUFHLElBQUksY0FBSSxDQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBRTtZQUMzQyxTQUFTLEVBQUUsSUFBSSw0QkFBa0IsQ0FBQyxnQ0FBZ0MsRUFBRTtnQkFDaEUsY0FBYyxFQUFFO29CQUNaLG9DQUFvQyxFQUFFLFlBQVksQ0FBQyxHQUFHO2lCQUN6RDtnQkFDRCx3QkFBd0IsRUFBRTtvQkFDdEIsb0NBQW9DLEVBQUUsZUFBZTtpQkFDeEQ7YUFDSixFQUFFLCtCQUErQixDQUFDO1NBQ3RDLENBQUMsQ0FBQztRQUVILElBQUcsZUFBZSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQy9CLCtCQUErQjtZQUMvQixLQUFLLE1BQU0sY0FBYyxJQUFJLGVBQWUsRUFBRSxDQUFDO2dCQUMzQyxnQ0FBZ0M7Z0JBQ2hDLE1BQU0sVUFBVSxHQUFXLElBQUEsaUJBQVksRUFBQyxjQUFjLEVBQUUsTUFBTSxDQUFDLENBQUM7Z0JBQ2hFLElBQUksQ0FBQyxXQUFXLENBQ1osSUFBSSx5QkFBZSxDQUFDO29CQUNoQixNQUFNLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQyxNQUFNO29CQUNyQyxPQUFPLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQyxNQUFNO29CQUN0QyxTQUFTLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsQ0FBQyxRQUFRO2lCQUM3QyxDQUFDLENBQ0wsQ0FBQztZQUNOLENBQUM7UUFDTCxDQUFDO1FBQ0QsSUFBRyxRQUFRLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDeEIsS0FBSyxNQUFNLE1BQU0sSUFBSSxRQUFRLEVBQUUsQ0FBQztnQkFDNUIsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLHlCQUFlLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztZQUNsRCxDQUFDO1FBQ0wsQ0FBQztRQUNELE9BQU8sSUFBSSxDQUFDO0lBQ2hCLENBQUM7Q0FDSjtBQXRDRCwwQ0FzQ0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tIFwiY29uc3RydWN0c1wiO1xuaW1wb3J0IHsgUG9saWN5U3RhdGVtZW50LCBSb2xlLCBGZWRlcmF0ZWRQcmluY2lwYWwgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWlhbVwiO1xuaW1wb3J0IHsgcmVhZEZpbGVTeW5jIH0gZnJvbSBcImZzXCI7XG5cbmV4cG9ydCBjbGFzcyBDb2duaXRvQXV0aFJvbGUgZXh0ZW5kcyBDb25zdHJ1Y3Qge1xuXG4gICAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IGFueSkge1xuICAgICAgICBzdXBlcihzY29wZSwgaWQpO1xuICAgICAgICBjb25zdCB7IGlkZW50aXR5UG9vbCwgcG9saWN5RmlsZVBhdGhzLCBwb2xpY2llcyB9ID0gcHJvcHM7XG5cbiAgICAgICAgY29uc3Qgcm9sZSA9IG5ldyBSb2xlKHRoaXMsIFwiQ29nbml0b0F1dGhSb2xlXCIsIHtcbiAgICAgICAgICAgIGFzc3VtZWRCeTogbmV3IEZlZGVyYXRlZFByaW5jaXBhbChcImNvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbVwiLCB7XG4gICAgICAgICAgICAgICAgXCJTdHJpbmdFcXVhbHNcIjoge1xuICAgICAgICAgICAgICAgICAgICBcImNvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbTphdWRcIjogaWRlbnRpdHlQb29sLnJlZlxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXCJGb3JBbnlWYWx1ZTpTdHJpbmdMaWtlXCI6IHtcbiAgICAgICAgICAgICAgICAgICAgXCJjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb206YW1yXCI6IFwiYXV0aGVudGljYXRlZFwiXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSwgXCJzdHM6QXNzdW1lUm9sZVdpdGhXZWJJZGVudGl0eVwiKSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYocG9saWN5RmlsZVBhdGhzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIC8vIGFwcGx5IHRoZSBwb2xpY3kgdG8gdGhlIHJvbGVcbiAgICAgICAgICAgIGZvciAoY29uc3QgcG9saWN5RmlsZVBhdGggb2YgcG9saWN5RmlsZVBhdGhzKSB7XG4gICAgICAgICAgICAgICAgLy8gcmVhZCBmaWxlIGZyb20gcG9saWN5RmlsZVBhdGhcbiAgICAgICAgICAgICAgICBjb25zdCBwb2xpY3lmaWxlOiBzdHJpbmcgPSByZWFkRmlsZVN5bmMocG9saWN5RmlsZVBhdGgsICd1dGY4Jyk7XG4gICAgICAgICAgICAgICAgcm9sZS5hZGRUb1BvbGljeShcbiAgICAgICAgICAgICAgICAgICAgbmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBlZmZlY3Q6IEpTT04ucGFyc2UocG9saWN5ZmlsZSkuRWZmZWN0LFxuICAgICAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogSlNPTi5wYXJzZShwb2xpY3lmaWxlKS5BY3Rpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICByZXNvdXJjZXM6IEpTT04ucGFyc2UocG9saWN5ZmlsZSkuUmVzb3VyY2UsXG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZihwb2xpY2llcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHBvbGljeSBvZiBwb2xpY2llcykge1xuICAgICAgICAgICAgICAgIHJvbGUuYWRkVG9Qb2xpY3kobmV3IFBvbGljeVN0YXRlbWVudChwb2xpY3kpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcm9sZTtcbiAgICB9XG59ICAgIl19
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CognitoAuthRole = void 0;
const constructs_1 = require("constructs");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const fs_1 = require("fs");
const fw24_1 = require("../core/fw24");
/** AWS IAM managed policy document max size (bytes). We chunk below this to stay safe. */
const MANAGED_POLICY_MAX_BYTES = 6144;
/** Approximate bytes per execute-api statement in serialized policy; used to chunk. */
const BYTES_PER_STATEMENT_ESTIMATE = 120;
class CognitoAuthRole extends constructs_1.Construct {
    role;
    policyCollector = [];
    managedPoliciesCreated = false;
    constructor(scope, id, props) {
        super(scope, id);
        const { identityPool, policyFilePaths, policies } = props;
        this.role = new aws_iam_1.Role(this, "CognitoAuthRole", {
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
            for (const policyFilePath of policyFilePaths) {
                const policyfile = (0, fs_1.readFileSync)(policyFilePath, 'utf8');
                this.policyCollector.push(new aws_iam_1.PolicyStatement({
                    effect: JSON.parse(policyfile).Effect,
                    actions: JSON.parse(policyfile).Action,
                    resources: JSON.parse(policyfile).Resource,
                }));
            }
        }
        if (policies !== undefined) {
            for (const policy of policies) {
                this.policyCollector.push(new aws_iam_1.PolicyStatement(policy));
            }
        }
        fw24_1.Fw24.getInstance().registerRolePolicyCollector(this.role, this.policyCollector);
        // Defer creating ManagedPolicies until prepare phase (after all addRouteToRolePolicy calls).
        const self = this;
        aws_cdk_lib_1.Aspects.of(this).add({
            visit(node) {
                if (node === self) {
                    self.createManagedPolicies();
                }
            },
        });
    }
    /**
     * Build ManagedPolicies from the collected statements so each policy stays under the
     * 6144-byte limit, avoiding the 10240-byte inline policy limit on the role.
     */
    createManagedPolicies() {
        if (this.managedPoliciesCreated)
            return;
        this.managedPoliciesCreated = true;
        const statements = this.policyCollector;
        if (statements.length === 0)
            return;
        const statementsPerChunk = Math.max(1, Math.floor((MANAGED_POLICY_MAX_BYTES - 80) / BYTES_PER_STATEMENT_ESTIMATE));
        for (let i = 0; i < statements.length; i += statementsPerChunk) {
            const chunk = statements.slice(i, i + statementsPerChunk);
            new aws_iam_1.ManagedPolicy(this, `CognitoAuthManagedPolicy${i / statementsPerChunk}`, {
                description: `Cognito auth role policies (chunk ${i / statementsPerChunk + 1})`,
                statements: chunk,
                roles: [this.role],
            });
        }
    }
    /** Expose the IAM Role so Auth can register it and addRouteToRolePolicy can resolve the collector. */
    getRole() {
        return this.role;
    }
}
exports.CognitoAuthRole = CognitoAuthRole;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29nbml0by1hdXRoLXJvbGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9jb2duaXRvLWF1dGgtcm9sZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSwyQ0FBdUM7QUFDdkMsNkNBQXNDO0FBQ3RDLGlEQUFxSDtBQUNySCwyQkFBa0M7QUFFbEMsdUNBQW9DO0FBRXBDLDBGQUEwRjtBQUMxRixNQUFNLHdCQUF3QixHQUFHLElBQUksQ0FBQztBQUN0Qyx1RkFBdUY7QUFDdkYsTUFBTSw0QkFBNEIsR0FBRyxHQUFHLENBQUM7QUFRekMsTUFBYSxlQUFnQixTQUFRLHNCQUFTO0lBQ3pCLElBQUksQ0FBTztJQUNYLGVBQWUsR0FBc0IsRUFBRSxDQUFDO0lBQ2pELHNCQUFzQixHQUFHLEtBQUssQ0FBQztJQUV2QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQTRCO1FBQ2xFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFDakIsTUFBTSxFQUFFLFlBQVksRUFBRSxlQUFlLEVBQUUsUUFBUSxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRTFELElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxjQUFJLENBQUMsSUFBSSxFQUFFLGlCQUFpQixFQUFFO1lBQzFDLFNBQVMsRUFBRSxJQUFJLDRCQUFrQixDQUFDLGdDQUFnQyxFQUFFO2dCQUNoRSxjQUFjLEVBQUU7b0JBQ1osb0NBQW9DLEVBQUUsWUFBWSxDQUFDLEdBQUc7aUJBQ3pEO2dCQUNELHdCQUF3QixFQUFFO29CQUN0QixvQ0FBb0MsRUFBRSxlQUFlO2lCQUN4RDthQUNKLEVBQUUsK0JBQStCLENBQUM7U0FDdEMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxlQUFlLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDaEMsS0FBSyxNQUFNLGNBQWMsSUFBSSxlQUFlLEVBQUUsQ0FBQztnQkFDM0MsTUFBTSxVQUFVLEdBQVcsSUFBQSxpQkFBWSxFQUFDLGNBQWMsRUFBRSxNQUFNLENBQUMsQ0FBQztnQkFDaEUsSUFBSSxDQUFDLGVBQWUsQ0FBQyxJQUFJLENBQ3JCLElBQUkseUJBQWUsQ0FBQztvQkFDaEIsTUFBTSxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUMsTUFBTTtvQkFDckMsT0FBTyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUMsTUFBTTtvQkFDdEMsU0FBUyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUMsUUFBUTtpQkFDN0MsQ0FBQyxDQUNMLENBQUM7WUFDTixDQUFDO1FBQ0wsQ0FBQztRQUNELElBQUksUUFBUSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ3pCLEtBQUssTUFBTSxNQUFNLElBQUksUUFBUSxFQUFFLENBQUM7Z0JBQzVCLElBQUksQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDLElBQUkseUJBQWUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO1lBQzNELENBQUM7UUFDTCxDQUFDO1FBRUQsV0FBSSxDQUFDLFdBQVcsRUFBRSxDQUFDLDJCQUEyQixDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLGVBQWUsQ0FBQyxDQUFDO1FBRWhGLDZGQUE2RjtRQUM3RixNQUFNLElBQUksR0FBRyxJQUFJLENBQUM7UUFDbEIscUJBQU8sQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDO1lBQ2pCLEtBQUssQ0FBQyxJQUFlO2dCQUNqQixJQUFJLElBQUksS0FBSyxJQUFJLEVBQUUsQ0FBQztvQkFDaEIsSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUM7Z0JBQ2pDLENBQUM7WUFDTCxDQUFDO1NBQ0osQ0FBQyxDQUFDO0lBQ1AsQ0FBQztJQUVEOzs7T0FHRztJQUNLLHFCQUFxQjtRQUN6QixJQUFJLElBQUksQ0FBQyxzQkFBc0I7WUFBRSxPQUFPO1FBQ3hDLElBQUksQ0FBQyxzQkFBc0IsR0FBRyxJQUFJLENBQUM7UUFFbkMsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLGVBQWUsQ0FBQztRQUN4QyxJQUFJLFVBQVUsQ0FBQyxNQUFNLEtBQUssQ0FBQztZQUFFLE9BQU87UUFFcEMsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsd0JBQXdCLEdBQUcsRUFBRSxDQUFDLEdBQUcsNEJBQTRCLENBQUMsQ0FBQyxDQUFDO1FBQ25ILEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxVQUFVLENBQUMsTUFBTSxFQUFFLENBQUMsSUFBSSxrQkFBa0IsRUFBRSxDQUFDO1lBQzdELE1BQU0sS0FBSyxHQUFHLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxrQkFBa0IsQ0FBQyxDQUFDO1lBQzFELElBQUksdUJBQWEsQ0FBQyxJQUFJLEVBQUUsMkJBQTJCLENBQUMsR0FBRyxrQkFBa0IsRUFBRSxFQUFFO2dCQUN6RSxXQUFXLEVBQUUscUNBQXFDLENBQUMsR0FBRyxrQkFBa0IsR0FBRyxDQUFDLEdBQUc7Z0JBQy9FLFVBQVUsRUFBRSxLQUFLO2dCQUNqQixLQUFLLEVBQUUsQ0FBRSxJQUFJLENBQUMsSUFBSSxDQUFFO2FBQ3ZCLENBQUMsQ0FBQztRQUNQLENBQUM7SUFDTCxDQUFDO0lBRUQsc0dBQXNHO0lBQ3RHLE9BQU87UUFDSCxPQUFPLElBQUksQ0FBQyxJQUFJLENBQUM7SUFDckIsQ0FBQztDQUNKO0FBN0VELDBDQTZFQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gXCJjb25zdHJ1Y3RzXCI7XG5pbXBvcnQgeyBBc3BlY3RzIH0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgeyBNYW5hZ2VkUG9saWN5LCBQb2xpY3lTdGF0ZW1lbnQsIFBvbGljeVN0YXRlbWVudFByb3BzLCBSb2xlLCBGZWRlcmF0ZWRQcmluY2lwYWwgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWlhbVwiO1xuaW1wb3J0IHsgcmVhZEZpbGVTeW5jIH0gZnJvbSBcImZzXCI7XG5pbXBvcnQgdHlwZSB7IENmbklkZW50aXR5UG9vbCB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtY29nbml0b1wiO1xuaW1wb3J0IHsgRncyNCB9IGZyb20gXCIuLi9jb3JlL2Z3MjRcIjtcblxuLyoqIEFXUyBJQU0gbWFuYWdlZCBwb2xpY3kgZG9jdW1lbnQgbWF4IHNpemUgKGJ5dGVzKS4gV2UgY2h1bmsgYmVsb3cgdGhpcyB0byBzdGF5IHNhZmUuICovXG5jb25zdCBNQU5BR0VEX1BPTElDWV9NQVhfQllURVMgPSA2MTQ0O1xuLyoqIEFwcHJveGltYXRlIGJ5dGVzIHBlciBleGVjdXRlLWFwaSBzdGF0ZW1lbnQgaW4gc2VyaWFsaXplZCBwb2xpY3k7IHVzZWQgdG8gY2h1bmsuICovXG5jb25zdCBCWVRFU19QRVJfU1RBVEVNRU5UX0VTVElNQVRFID0gMTIwO1xuXG5leHBvcnQgaW50ZXJmYWNlIElDb2duaXRvQXV0aFJvbGVQcm9wcyB7XG4gICAgaWRlbnRpdHlQb29sOiBDZm5JZGVudGl0eVBvb2w7XG4gICAgcG9saWN5RmlsZVBhdGhzPzogc3RyaW5nW107XG4gICAgcG9saWNpZXM/OiBBcnJheTxQb2xpY3lTdGF0ZW1lbnRQcm9wcyB8IFBvbGljeVN0YXRlbWVudD47XG59XG5cbmV4cG9ydCBjbGFzcyBDb2duaXRvQXV0aFJvbGUgZXh0ZW5kcyBDb25zdHJ1Y3Qge1xuICAgIHByaXZhdGUgcmVhZG9ubHkgcm9sZTogUm9sZTtcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBvbGljeUNvbGxlY3RvcjogUG9saWN5U3RhdGVtZW50W10gPSBbXTtcbiAgICBwcml2YXRlIG1hbmFnZWRQb2xpY2llc0NyZWF0ZWQgPSBmYWxzZTtcblxuICAgIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBJQ29nbml0b0F1dGhSb2xlUHJvcHMpIHtcbiAgICAgICAgc3VwZXIoc2NvcGUsIGlkKTtcbiAgICAgICAgY29uc3QgeyBpZGVudGl0eVBvb2wsIHBvbGljeUZpbGVQYXRocywgcG9saWNpZXMgfSA9IHByb3BzO1xuXG4gICAgICAgIHRoaXMucm9sZSA9IG5ldyBSb2xlKHRoaXMsIFwiQ29nbml0b0F1dGhSb2xlXCIsIHtcbiAgICAgICAgICAgIGFzc3VtZWRCeTogbmV3IEZlZGVyYXRlZFByaW5jaXBhbChcImNvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbVwiLCB7XG4gICAgICAgICAgICAgICAgXCJTdHJpbmdFcXVhbHNcIjoge1xuICAgICAgICAgICAgICAgICAgICBcImNvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbTphdWRcIjogaWRlbnRpdHlQb29sLnJlZlxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXCJGb3JBbnlWYWx1ZTpTdHJpbmdMaWtlXCI6IHtcbiAgICAgICAgICAgICAgICAgICAgXCJjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb206YW1yXCI6IFwiYXV0aGVudGljYXRlZFwiXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSwgXCJzdHM6QXNzdW1lUm9sZVdpdGhXZWJJZGVudGl0eVwiKSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKHBvbGljeUZpbGVQYXRocyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHBvbGljeUZpbGVQYXRoIG9mIHBvbGljeUZpbGVQYXRocykge1xuICAgICAgICAgICAgICAgIGNvbnN0IHBvbGljeWZpbGU6IHN0cmluZyA9IHJlYWRGaWxlU3luYyhwb2xpY3lGaWxlUGF0aCwgJ3V0ZjgnKTtcbiAgICAgICAgICAgICAgICB0aGlzLnBvbGljeUNvbGxlY3Rvci5wdXNoKFxuICAgICAgICAgICAgICAgICAgICBuZXcgUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVmZmVjdDogSlNPTi5wYXJzZShwb2xpY3lmaWxlKS5FZmZlY3QsXG4gICAgICAgICAgICAgICAgICAgICAgICBhY3Rpb25zOiBKU09OLnBhcnNlKHBvbGljeWZpbGUpLkFjdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc291cmNlczogSlNPTi5wYXJzZShwb2xpY3lmaWxlKS5SZXNvdXJjZSxcbiAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmIChwb2xpY2llcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHBvbGljeSBvZiBwb2xpY2llcykge1xuICAgICAgICAgICAgICAgIHRoaXMucG9saWN5Q29sbGVjdG9yLnB1c2gobmV3IFBvbGljeVN0YXRlbWVudChwb2xpY3kpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIEZ3MjQuZ2V0SW5zdGFuY2UoKS5yZWdpc3RlclJvbGVQb2xpY3lDb2xsZWN0b3IodGhpcy5yb2xlLCB0aGlzLnBvbGljeUNvbGxlY3Rvcik7XG5cbiAgICAgICAgLy8gRGVmZXIgY3JlYXRpbmcgTWFuYWdlZFBvbGljaWVzIHVudGlsIHByZXBhcmUgcGhhc2UgKGFmdGVyIGFsbCBhZGRSb3V0ZVRvUm9sZVBvbGljeSBjYWxscykuXG4gICAgICAgIGNvbnN0IHNlbGYgPSB0aGlzO1xuICAgICAgICBBc3BlY3RzLm9mKHRoaXMpLmFkZCh7XG4gICAgICAgICAgICB2aXNpdChub2RlOiBDb25zdHJ1Y3QpOiB2b2lkIHtcbiAgICAgICAgICAgICAgICBpZiAobm9kZSA9PT0gc2VsZikge1xuICAgICAgICAgICAgICAgICAgICBzZWxmLmNyZWF0ZU1hbmFnZWRQb2xpY2llcygpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEJ1aWxkIE1hbmFnZWRQb2xpY2llcyBmcm9tIHRoZSBjb2xsZWN0ZWQgc3RhdGVtZW50cyBzbyBlYWNoIHBvbGljeSBzdGF5cyB1bmRlciB0aGVcbiAgICAgKiA2MTQ0LWJ5dGUgbGltaXQsIGF2b2lkaW5nIHRoZSAxMDI0MC1ieXRlIGlubGluZSBwb2xpY3kgbGltaXQgb24gdGhlIHJvbGUuXG4gICAgICovXG4gICAgcHJpdmF0ZSBjcmVhdGVNYW5hZ2VkUG9saWNpZXMoKTogdm9pZCB7XG4gICAgICAgIGlmICh0aGlzLm1hbmFnZWRQb2xpY2llc0NyZWF0ZWQpIHJldHVybjtcbiAgICAgICAgdGhpcy5tYW5hZ2VkUG9saWNpZXNDcmVhdGVkID0gdHJ1ZTtcblxuICAgICAgICBjb25zdCBzdGF0ZW1lbnRzID0gdGhpcy5wb2xpY3lDb2xsZWN0b3I7XG4gICAgICAgIGlmIChzdGF0ZW1lbnRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gICAgICAgIGNvbnN0IHN0YXRlbWVudHNQZXJDaHVuayA9IE1hdGgubWF4KDEsIE1hdGguZmxvb3IoKE1BTkFHRURfUE9MSUNZX01BWF9CWVRFUyAtIDgwKSAvIEJZVEVTX1BFUl9TVEFURU1FTlRfRVNUSU1BVEUpKTtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzdGF0ZW1lbnRzLmxlbmd0aDsgaSArPSBzdGF0ZW1lbnRzUGVyQ2h1bmspIHtcbiAgICAgICAgICAgIGNvbnN0IGNodW5rID0gc3RhdGVtZW50cy5zbGljZShpLCBpICsgc3RhdGVtZW50c1BlckNodW5rKTtcbiAgICAgICAgICAgIG5ldyBNYW5hZ2VkUG9saWN5KHRoaXMsIGBDb2duaXRvQXV0aE1hbmFnZWRQb2xpY3kke2kgLyBzdGF0ZW1lbnRzUGVyQ2h1bmt9YCwge1xuICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBgQ29nbml0byBhdXRoIHJvbGUgcG9saWNpZXMgKGNodW5rICR7aSAvIHN0YXRlbWVudHNQZXJDaHVuayArIDF9KWAsXG4gICAgICAgICAgICAgICAgc3RhdGVtZW50czogY2h1bmssXG4gICAgICAgICAgICAgICAgcm9sZXM6IFsgdGhpcy5yb2xlIF0sXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKiBFeHBvc2UgdGhlIElBTSBSb2xlIHNvIEF1dGggY2FuIHJlZ2lzdGVyIGl0IGFuZCBhZGRSb3V0ZVRvUm9sZVBvbGljeSBjYW4gcmVzb2x2ZSB0aGUgY29sbGVjdG9yLiAqL1xuICAgIGdldFJvbGUoKTogUm9sZSB7XG4gICAgICAgIHJldHVybiB0aGlzLnJvbGU7XG4gICAgfVxufSAgICJdfQ==
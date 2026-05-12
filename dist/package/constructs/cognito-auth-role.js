"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CognitoAuthRole = void 0;
const constructs_1 = require("constructs");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const fs_1 = require("fs");
const fw24_1 = require("../core/fw24");
const iam_policy_chunking_1 = require("../utils/iam-policy-chunking");
class CognitoAuthRole extends constructs_1.Construct {
    role;
    policyCollector = [];
    managedPoliciesCreated = false;
    managedPolicyMaxDocumentBytes;
    constructor(scope, id, props) {
        super(scope, id);
        const { identityPool, policyFilePaths, policies, managedPolicyMaxDocumentBytes } = props;
        this.managedPolicyMaxDocumentBytes =
            managedPolicyMaxDocumentBytes ?? iam_policy_chunking_1.IAM_MANAGED_POLICY_DOCUMENT_MAX_BYTES;
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
     * Build ManagedPolicies from the collected statements: greedy-pack each document to use
     * nearly the full IAM size limit so fewer managed policies attach to the role.
     */
    createManagedPolicies() {
        if (this.managedPoliciesCreated)
            return;
        this.managedPoliciesCreated = true;
        const statements = this.policyCollector;
        if (statements.length === 0)
            return;
        const chunks = (0, iam_policy_chunking_1.packPolicyStatementsIntoManagedPolicyChunks)(statements, this.managedPolicyMaxDocumentBytes);
        chunks.forEach((chunk, i) => {
            new aws_iam_1.ManagedPolicy(this, `CognitoAuthManagedPolicy${i}`, {
                description: `Cognito auth role policies (chunk ${i + 1})`,
                statements: chunk,
                roles: [this.role],
            });
        });
    }
    /** Expose the IAM Role so Auth can register it and addRouteToRolePolicy can resolve the collector. */
    getRole() {
        return this.role;
    }
}
exports.CognitoAuthRole = CognitoAuthRole;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29nbml0by1hdXRoLXJvbGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29uc3RydWN0cy9jb2duaXRvLWF1dGgtcm9sZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSwyQ0FBdUM7QUFDdkMsNkNBQXNDO0FBQ3RDLGlEQUFxSDtBQUNySCwyQkFBa0M7QUFFbEMsdUNBQW9DO0FBQ3BDLHNFQUdzQztBQWF0QyxNQUFhLGVBQWdCLFNBQVEsc0JBQVM7SUFDekIsSUFBSSxDQUFPO0lBQ1gsZUFBZSxHQUFzQixFQUFFLENBQUM7SUFDakQsc0JBQXNCLEdBQUcsS0FBSyxDQUFDO0lBQ3RCLDZCQUE2QixDQUFTO0lBRXZELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBNEI7UUFDbEUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUNqQixNQUFNLEVBQUUsWUFBWSxFQUFFLGVBQWUsRUFBRSxRQUFRLEVBQUUsNkJBQTZCLEVBQUUsR0FBRyxLQUFLLENBQUM7UUFDekYsSUFBSSxDQUFDLDZCQUE2QjtZQUM5Qiw2QkFBNkIsSUFBSSwyREFBcUMsQ0FBQztRQUUzRSxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksY0FBSSxDQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBRTtZQUMxQyxTQUFTLEVBQUUsSUFBSSw0QkFBa0IsQ0FBQyxnQ0FBZ0MsRUFBRTtnQkFDaEUsY0FBYyxFQUFFO29CQUNaLG9DQUFvQyxFQUFFLFlBQVksQ0FBQyxHQUFHO2lCQUN6RDtnQkFDRCx3QkFBd0IsRUFBRTtvQkFDdEIsb0NBQW9DLEVBQUUsZUFBZTtpQkFDeEQ7YUFDSixFQUFFLCtCQUErQixDQUFDO1NBQ3RDLENBQUMsQ0FBQztRQUVILElBQUksZUFBZSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ2hDLEtBQUssTUFBTSxjQUFjLElBQUksZUFBZSxFQUFFLENBQUM7Z0JBQzNDLE1BQU0sVUFBVSxHQUFXLElBQUEsaUJBQVksRUFBQyxjQUFjLEVBQUUsTUFBTSxDQUFDLENBQUM7Z0JBQ2hFLElBQUksQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUNyQixJQUFJLHlCQUFlLENBQUM7b0JBQ2hCLE1BQU0sRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDLE1BQU07b0JBQ3JDLE9BQU8sRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDLE1BQU07b0JBQ3RDLFNBQVMsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDLFFBQVE7aUJBQzdDLENBQUMsQ0FDTCxDQUFDO1lBQ04sQ0FBQztRQUNMLENBQUM7UUFDRCxJQUFJLFFBQVEsS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUN6QixLQUFLLE1BQU0sTUFBTSxJQUFJLFFBQVEsRUFBRSxDQUFDO2dCQUM1QixJQUFJLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxJQUFJLHlCQUFlLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztZQUMzRCxDQUFDO1FBQ0wsQ0FBQztRQUVELFdBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQywyQkFBMkIsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQztRQUVoRiw2RkFBNkY7UUFDN0YsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDO1FBQ2xCLHFCQUFPLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQztZQUNqQixLQUFLLENBQUMsSUFBZTtnQkFDakIsSUFBSSxJQUFJLEtBQUssSUFBSSxFQUFFLENBQUM7b0JBQ2hCLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO2dCQUNqQyxDQUFDO1lBQ0wsQ0FBQztTQUNKLENBQUMsQ0FBQztJQUNQLENBQUM7SUFFRDs7O09BR0c7SUFDSyxxQkFBcUI7UUFDekIsSUFBSSxJQUFJLENBQUMsc0JBQXNCO1lBQUUsT0FBTztRQUN4QyxJQUFJLENBQUMsc0JBQXNCLEdBQUcsSUFBSSxDQUFDO1FBRW5DLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxlQUFlLENBQUM7UUFDeEMsSUFBSSxVQUFVLENBQUMsTUFBTSxLQUFLLENBQUM7WUFBRSxPQUFPO1FBRXBDLE1BQU0sTUFBTSxHQUFHLElBQUEsaUVBQTJDLEVBQ3RELFVBQVUsRUFDVixJQUFJLENBQUMsNkJBQTZCLENBQ3JDLENBQUM7UUFDRixNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsS0FBSyxFQUFFLENBQUMsRUFBRSxFQUFFO1lBQ3hCLElBQUksdUJBQWEsQ0FBQyxJQUFJLEVBQUUsMkJBQTJCLENBQUMsRUFBRSxFQUFFO2dCQUNwRCxXQUFXLEVBQUUscUNBQXFDLENBQUMsR0FBRyxDQUFDLEdBQUc7Z0JBQzFELFVBQVUsRUFBRSxLQUFLO2dCQUNqQixLQUFLLEVBQUUsQ0FBRSxJQUFJLENBQUMsSUFBSSxDQUFFO2FBQ3ZCLENBQUMsQ0FBQztRQUNQLENBQUMsQ0FBQyxDQUFDO0lBQ1AsQ0FBQztJQUVELHNHQUFzRztJQUN0RyxPQUFPO1FBQ0gsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDO0lBQ3JCLENBQUM7Q0FDSjtBQWxGRCwwQ0FrRkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tIFwiY29uc3RydWN0c1wiO1xuaW1wb3J0IHsgQXNwZWN0cyB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgTWFuYWdlZFBvbGljeSwgUG9saWN5U3RhdGVtZW50LCBQb2xpY3lTdGF0ZW1lbnRQcm9wcywgUm9sZSwgRmVkZXJhdGVkUHJpbmNpcGFsIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1pYW1cIjtcbmltcG9ydCB7IHJlYWRGaWxlU3luYyB9IGZyb20gXCJmc1wiO1xuaW1wb3J0IHR5cGUgeyBDZm5JZGVudGl0eVBvb2wgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWNvZ25pdG9cIjtcbmltcG9ydCB7IEZ3MjQgfSBmcm9tIFwiLi4vY29yZS9mdzI0XCI7XG5pbXBvcnQge1xuICAgIElBTV9NQU5BR0VEX1BPTElDWV9ET0NVTUVOVF9NQVhfQllURVMsXG4gICAgcGFja1BvbGljeVN0YXRlbWVudHNJbnRvTWFuYWdlZFBvbGljeUNodW5rcyxcbn0gZnJvbSBcIi4uL3V0aWxzL2lhbS1wb2xpY3ktY2h1bmtpbmdcIjtcblxuZXhwb3J0IGludGVyZmFjZSBJQ29nbml0b0F1dGhSb2xlUHJvcHMge1xuICAgIGlkZW50aXR5UG9vbDogQ2ZuSWRlbnRpdHlQb29sO1xuICAgIHBvbGljeUZpbGVQYXRocz86IHN0cmluZ1tdO1xuICAgIHBvbGljaWVzPzogQXJyYXk8UG9saWN5U3RhdGVtZW50UHJvcHMgfCBQb2xpY3lTdGF0ZW1lbnQ+O1xuICAgIC8qKlxuICAgICAqIE1heCBJQU0gbWFuYWdlZCBwb2xpY3kgZG9jdW1lbnQgc2l6ZSAoYnl0ZXMpIGJlZm9yZSBzcGxpdHRpbmcgaW50byBhbm90aGVyIG1hbmFnZWQgcG9saWN5LlxuICAgICAqIERlZmF1bHRzIHRvIHtAbGluayBJQU1fTUFOQUdFRF9QT0xJQ1lfRE9DVU1FTlRfTUFYX0JZVEVTfSAoNjE0NCkuXG4gICAgICovXG4gICAgbWFuYWdlZFBvbGljeU1heERvY3VtZW50Qnl0ZXM/OiBudW1iZXI7XG59XG5cbmV4cG9ydCBjbGFzcyBDb2duaXRvQXV0aFJvbGUgZXh0ZW5kcyBDb25zdHJ1Y3Qge1xuICAgIHByaXZhdGUgcmVhZG9ubHkgcm9sZTogUm9sZTtcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBvbGljeUNvbGxlY3RvcjogUG9saWN5U3RhdGVtZW50W10gPSBbXTtcbiAgICBwcml2YXRlIG1hbmFnZWRQb2xpY2llc0NyZWF0ZWQgPSBmYWxzZTtcbiAgICBwcml2YXRlIHJlYWRvbmx5IG1hbmFnZWRQb2xpY3lNYXhEb2N1bWVudEJ5dGVzOiBudW1iZXI7XG5cbiAgICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogSUNvZ25pdG9BdXRoUm9sZVByb3BzKSB7XG4gICAgICAgIHN1cGVyKHNjb3BlLCBpZCk7XG4gICAgICAgIGNvbnN0IHsgaWRlbnRpdHlQb29sLCBwb2xpY3lGaWxlUGF0aHMsIHBvbGljaWVzLCBtYW5hZ2VkUG9saWN5TWF4RG9jdW1lbnRCeXRlcyB9ID0gcHJvcHM7XG4gICAgICAgIHRoaXMubWFuYWdlZFBvbGljeU1heERvY3VtZW50Qnl0ZXMgPVxuICAgICAgICAgICAgbWFuYWdlZFBvbGljeU1heERvY3VtZW50Qnl0ZXMgPz8gSUFNX01BTkFHRURfUE9MSUNZX0RPQ1VNRU5UX01BWF9CWVRFUztcblxuICAgICAgICB0aGlzLnJvbGUgPSBuZXcgUm9sZSh0aGlzLCBcIkNvZ25pdG9BdXRoUm9sZVwiLCB7XG4gICAgICAgICAgICBhc3N1bWVkQnk6IG5ldyBGZWRlcmF0ZWRQcmluY2lwYWwoXCJjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb21cIiwge1xuICAgICAgICAgICAgICAgIFwiU3RyaW5nRXF1YWxzXCI6IHtcbiAgICAgICAgICAgICAgICAgICAgXCJjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb206YXVkXCI6IGlkZW50aXR5UG9vbC5yZWZcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIFwiRm9yQW55VmFsdWU6U3RyaW5nTGlrZVwiOiB7XG4gICAgICAgICAgICAgICAgICAgIFwiY29nbml0by1pZGVudGl0eS5hbWF6b25hd3MuY29tOmFtclwiOiBcImF1dGhlbnRpY2F0ZWRcIlxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sIFwic3RzOkFzc3VtZVJvbGVXaXRoV2ViSWRlbnRpdHlcIiksXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmIChwb2xpY3lGaWxlUGF0aHMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBwb2xpY3lGaWxlUGF0aCBvZiBwb2xpY3lGaWxlUGF0aHMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBwb2xpY3lmaWxlOiBzdHJpbmcgPSByZWFkRmlsZVN5bmMocG9saWN5RmlsZVBhdGgsICd1dGY4Jyk7XG4gICAgICAgICAgICAgICAgdGhpcy5wb2xpY3lDb2xsZWN0b3IucHVzaChcbiAgICAgICAgICAgICAgICAgICAgbmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBlZmZlY3Q6IEpTT04ucGFyc2UocG9saWN5ZmlsZSkuRWZmZWN0LFxuICAgICAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogSlNPTi5wYXJzZShwb2xpY3lmaWxlKS5BY3Rpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICByZXNvdXJjZXM6IEpTT04ucGFyc2UocG9saWN5ZmlsZSkuUmVzb3VyY2UsXG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAocG9saWNpZXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBwb2xpY3kgb2YgcG9saWNpZXMpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnBvbGljeUNvbGxlY3Rvci5wdXNoKG5ldyBQb2xpY3lTdGF0ZW1lbnQocG9saWN5KSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBGdzI0LmdldEluc3RhbmNlKCkucmVnaXN0ZXJSb2xlUG9saWN5Q29sbGVjdG9yKHRoaXMucm9sZSwgdGhpcy5wb2xpY3lDb2xsZWN0b3IpO1xuXG4gICAgICAgIC8vIERlZmVyIGNyZWF0aW5nIE1hbmFnZWRQb2xpY2llcyB1bnRpbCBwcmVwYXJlIHBoYXNlIChhZnRlciBhbGwgYWRkUm91dGVUb1JvbGVQb2xpY3kgY2FsbHMpLlxuICAgICAgICBjb25zdCBzZWxmID0gdGhpcztcbiAgICAgICAgQXNwZWN0cy5vZih0aGlzKS5hZGQoe1xuICAgICAgICAgICAgdmlzaXQobm9kZTogQ29uc3RydWN0KTogdm9pZCB7XG4gICAgICAgICAgICAgICAgaWYgKG5vZGUgPT09IHNlbGYpIHtcbiAgICAgICAgICAgICAgICAgICAgc2VsZi5jcmVhdGVNYW5hZ2VkUG9saWNpZXMoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBCdWlsZCBNYW5hZ2VkUG9saWNpZXMgZnJvbSB0aGUgY29sbGVjdGVkIHN0YXRlbWVudHM6IGdyZWVkeS1wYWNrIGVhY2ggZG9jdW1lbnQgdG8gdXNlXG4gICAgICogbmVhcmx5IHRoZSBmdWxsIElBTSBzaXplIGxpbWl0IHNvIGZld2VyIG1hbmFnZWQgcG9saWNpZXMgYXR0YWNoIHRvIHRoZSByb2xlLlxuICAgICAqL1xuICAgIHByaXZhdGUgY3JlYXRlTWFuYWdlZFBvbGljaWVzKCk6IHZvaWQge1xuICAgICAgICBpZiAodGhpcy5tYW5hZ2VkUG9saWNpZXNDcmVhdGVkKSByZXR1cm47XG4gICAgICAgIHRoaXMubWFuYWdlZFBvbGljaWVzQ3JlYXRlZCA9IHRydWU7XG5cbiAgICAgICAgY29uc3Qgc3RhdGVtZW50cyA9IHRoaXMucG9saWN5Q29sbGVjdG9yO1xuICAgICAgICBpZiAoc3RhdGVtZW50cy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgICAgICBjb25zdCBjaHVua3MgPSBwYWNrUG9saWN5U3RhdGVtZW50c0ludG9NYW5hZ2VkUG9saWN5Q2h1bmtzKFxuICAgICAgICAgICAgc3RhdGVtZW50cyxcbiAgICAgICAgICAgIHRoaXMubWFuYWdlZFBvbGljeU1heERvY3VtZW50Qnl0ZXMsXG4gICAgICAgICk7XG4gICAgICAgIGNodW5rcy5mb3JFYWNoKChjaHVuaywgaSkgPT4ge1xuICAgICAgICAgICAgbmV3IE1hbmFnZWRQb2xpY3kodGhpcywgYENvZ25pdG9BdXRoTWFuYWdlZFBvbGljeSR7aX1gLCB7XG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246IGBDb2duaXRvIGF1dGggcm9sZSBwb2xpY2llcyAoY2h1bmsgJHtpICsgMX0pYCxcbiAgICAgICAgICAgICAgICBzdGF0ZW1lbnRzOiBjaHVuayxcbiAgICAgICAgICAgICAgICByb2xlczogWyB0aGlzLnJvbGUgXSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvKiogRXhwb3NlIHRoZSBJQU0gUm9sZSBzbyBBdXRoIGNhbiByZWdpc3RlciBpdCBhbmQgYWRkUm91dGVUb1JvbGVQb2xpY3kgY2FuIHJlc29sdmUgdGhlIGNvbGxlY3Rvci4gKi9cbiAgICBnZXRSb2xlKCk6IFJvbGUge1xuICAgICAgICByZXR1cm4gdGhpcy5yb2xlO1xuICAgIH1cbn0gICAiXX0=
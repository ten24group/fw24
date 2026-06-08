"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.meiliSearchTaskDetailPage = void 0;
exports.meiliSearchTaskDetailPage = {
    pageTitle: "MeiliSearch Task Details",
    pageType: "details",
    routePattern: "/system/search/tasks/:uid",
    breadcrumbs: [
        { label: "Home", url: "/" },
        { label: "Search", url: "/system/search" },
        { label: "Tasks", url: "/system/search/tasks" },
        { label: "Task Details" }
    ],
    pageHeaderActions: [
        {
            label: "Cancel Task",
            openInModal: true,
            modalConfig: {
                modalType: "confirm",
                modalPageConfig: {
                    title: "Cancel Task",
                    content: "Are you sure you want to cancel this task?"
                },
                apiConfig: {
                    apiMethod: "GET", apiUrl: "/system/search/tasks/:uid/cancel"
                },
                submitSuccessRedirect: "/system/search/tasks"
            }
        },
        {
            label: "Delete Task",
            openInModal: true,
            modalConfig: {
                modalType: "confirm",
                modalPageConfig: {
                    title: "Delete Task",
                    content: "Are you sure you want to delete this task?"
                },
                apiConfig: {
                    apiMethod: "DELETE",
                    apiUrl: "/system/search/tasks/:uid"
                },
                submitSuccessRedirect: "/system/search/tasks"
            }
        }
    ],
    detailsPageConfig: {
        detailApiConfig: { apiMethod: "GET", responseKey: "", apiUrl: "/system/search/tasks/:uid", },
        columnsConfig: {
            columns: [
                { sortOrder: 1, fields: ["uid", "indexUid", "type", "status", "batchUid", "canceledBy", "duration"] },
                { sortOrder: 2, fields: ["enqueuedAt", "startedAt", "finishedAt", "details", "error"] }
            ]
        },
        propertiesConfig: [
            { name: "uid", label: "Task UID", id: "uid", column: "uid", fieldType: "number", isIdentifier: true },
            { name: "indexUid", label: "Index UID", id: "indexUid", column: "indexUid", fieldType: "text" },
            { name: "type", label: "Type", id: "type", column: "type", fieldType: "text" },
            { name: "status", label: "Status", id: "status", column: "status", fieldType: "text" },
            {
                name: "batchUid",
                label: "Batch UID",
                id: "batchUid",
                column: "batchUid",
                fieldType: "number",
                readOnly: true,
                isLink: true,
                linkConfig: {
                    routePattern: "/system/search/batches/:batchUid",
                    displayText: "View Batch Details"
                }
            },
            { name: "canceledBy", label: "Canceled By", id: "canceledBy", column: "canceledBy", fieldType: "number" },
            { name: "duration", label: "Duration", id: "duration", column: "duration", fieldType: "text" },
            { name: "enqueuedAt", label: "Enqueued At", id: "enqueuedAt", column: "enqueuedAt", fieldType: "datetime" },
            { name: "startedAt", label: "Started At", id: "startedAt", column: "startedAt", fieldType: "datetime" },
            { name: "finishedAt", label: "Finished At", id: "finishedAt", column: "finishedAt", fieldType: "datetime" },
            { name: "details", label: "Task Details", id: "details", column: "details", fieldType: "json" },
            { name: "error", label: "Error Information", id: "error", column: "error", fieldType: "json" }
        ]
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVpbGktc2VhcmNoLXRhc2stZGV0YWlsLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL3NlYXJjaC9zeXN0ZW0vY3VzdG9tLXBhZ2VzLWNvbmZpZy9tZWlsaS1zZWFyY2gtdGFzay1kZXRhaWwudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBRWEsUUFBQSx5QkFBeUIsR0FBc0I7SUFDMUQsU0FBUyxFQUFFLDBCQUEwQjtJQUNyQyxRQUFRLEVBQUUsU0FBUztJQUNuQixZQUFZLEVBQUUsMkJBQTJCO0lBQ3pDLFdBQVcsRUFBRTtRQUNYLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFO1FBQzNCLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxHQUFHLEVBQUUsZ0JBQWdCLEVBQUU7UUFDMUMsRUFBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLEdBQUcsRUFBRSxzQkFBc0IsRUFBRTtRQUMvQyxFQUFFLEtBQUssRUFBRSxjQUFjLEVBQUU7S0FDMUI7SUFDRCxpQkFBaUIsRUFBRTtRQUNqQjtZQUNFLEtBQUssRUFBRSxhQUFhO1lBQ3BCLFdBQVcsRUFBRSxJQUFJO1lBQ2pCLFdBQVcsRUFBRTtnQkFDWCxTQUFTLEVBQUUsU0FBUztnQkFDcEIsZUFBZSxFQUFFO29CQUNmLEtBQUssRUFBRSxhQUFhO29CQUNwQixPQUFPLEVBQUUsNENBQTRDO2lCQUN0RDtnQkFDRCxTQUFTLEVBQUU7b0JBQ1QsU0FBUyxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsa0NBQWtDO2lCQUM3RDtnQkFDRCxxQkFBcUIsRUFBRSxzQkFBc0I7YUFDOUM7U0FDRjtRQUNEO1lBQ0UsS0FBSyxFQUFFLGFBQWE7WUFDcEIsV0FBVyxFQUFFLElBQUk7WUFDakIsV0FBVyxFQUFFO2dCQUNYLFNBQVMsRUFBRSxTQUFTO2dCQUNwQixlQUFlLEVBQUU7b0JBQ2YsS0FBSyxFQUFFLGFBQWE7b0JBQ3BCLE9BQU8sRUFBRSw0Q0FB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RSxFQUFFLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxTQUFTLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRTtZQUMvRixFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLG1CQUFtQixFQUFFLEVBQUUsRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFO1NBQy9GO0tBQ0Y7Q0FDRixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRGV0YWlsc1BhZ2VDb25maWcgfSBmcm9tIFwiLi4vLi4vLi4vdWktY29uZmlnLWdlblwiO1xuXG5leHBvcnQgY29uc3QgbWVpbGlTZWFyY2hUYXNrRGV0YWlsUGFnZTogRGV0YWlsc1BhZ2VDb25maWcgPSB7XG4gIHBhZ2VUaXRsZTogXCJNZWlsaVNlYXJjaCBUYXNrIERldGFpbHNcIixcbiAgcGFnZVR5cGU6IFwiZGV0YWlsc1wiLFxuICByb3V0ZVBhdHRlcm46IFwiL3N5c3RlbS9zZWFyY2gvdGFza3MvOnVpZFwiLFxuICBicmVhZGNydW1iczogW1xuICAgIHsgbGFiZWw6IFwiSG9tZVwiLCB1cmw6IFwiL1wiIH0sXG4gICAgeyBsYWJlbDogXCJTZWFyY2hcIiwgdXJsOiBcIi9zeXN0ZW0vc2VhcmNoXCIgfSxcbiAgICB7IGxhYmVsOiBcIlRhc2tzXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaC90YXNrc1wiIH0sXG4gICAgeyBsYWJlbDogXCJUYXNrIERldGFpbHNcIiB9XG4gIF0sXG4gIHBhZ2VIZWFkZXJBY3Rpb25zOiBbXG4gICAge1xuICAgICAgbGFiZWw6IFwiQ2FuY2VsIFRhc2tcIixcbiAgICAgIG9wZW5Jbk1vZGFsOiB0cnVlLFxuICAgICAgbW9kYWxDb25maWc6IHtcbiAgICAgICAgbW9kYWxUeXBlOiBcImNvbmZpcm1cIixcbiAgICAgICAgbW9kYWxQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgdGl0bGU6IFwiQ2FuY2VsIFRhc2tcIixcbiAgICAgICAgICBjb250ZW50OiBcIkFyZSB5b3Ugc3VyZSB5b3Ugd2FudCB0byBjYW5jZWwgdGhpcyB0YXNrP1wiXG4gICAgICAgIH0sXG4gICAgICAgIGFwaUNvbmZpZzoge1xuICAgICAgICAgIGFwaU1ldGhvZDogXCJHRVRcIiwgYXBpVXJsOiBcIi9zeXN0ZW0vc2VhcmNoL3Rhc2tzLzp1aWQvY2FuY2VsXCJcbiAgICAgICAgfSxcbiAgICAgICAgc3VibWl0U3VjY2Vzc1JlZGlyZWN0OiBcIi9zeXN0ZW0vc2VhcmNoL3Rhc2tzXCJcbiAgICAgIH1cbiAgICB9LFxuICAgIHtcbiAgICAgIGxhYmVsOiBcIkRlbGV0ZSBUYXNrXCIsXG4gICAgICBvcGVuSW5Nb2RhbDogdHJ1ZSxcbiAgICAgIG1vZGFsQ29uZmlnOiB7XG4gICAgICAgIG1vZGFsVHlwZTogXCJjb25maXJtXCIsXG4gICAgICAgIG1vZGFsUGFnZUNvbmZpZzoge1xuICAgICAgICAgIHRpdGxlOiBcIkRlbGV0ZSBUYXNrXCIsXG4gICAgICAgICAgY29udGVudDogXCJBcmUgeW91IHN1cmUgeW91IHdhbnQgdG8gZGVsZXRlIHRoaXMgdGFzaz9cIlxuICAgICAgICB9LFxuICAgICAgICBhcGlDb25maWc6IHtcbiAgICAgICAgICBhcGlNZXRob2Q6IFwiREVMRVRFXCIsXG4gICAgICAgICAgYXBpVXJsOiBcIi9zeXN0ZW0vc2VhcmNoL3Rhc2tzLzp1aWRcIlxuICAgICAgICB9LFxuICAgICAgICBzdWJtaXRTdWNjZXNzUmVkaXJlY3Q6IFwiL3N5c3RlbS9zZWFyY2gvdGFza3NcIlxuICAgICAgfVxuICAgIH1cbiAgXSxcbiAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICBkZXRhaWxBcGlDb25maWc6IHsgYXBpTWV0aG9kOiBcIkdFVFwiLCByZXNwb25zZUtleTogXCJcIiwgYXBpVXJsOiBcIi9zeXN0ZW0vc2VhcmNoL3Rhc2tzLzp1aWRcIiwgIH0sXG4gICAgY29sdW1uc0NvbmZpZzoge1xuICAgICAgY29sdW1uczogW1xuICAgICAgICB7IHNvcnRPcmRlcjogMSwgZmllbGRzOiBbIFwidWlkXCIsIFwiaW5kZXhVaWRcIiwgXCJ0eXBlXCIsIFwic3RhdHVzXCIsIFwiYmF0Y2hVaWRcIiwgXCJjYW5jZWxlZEJ5XCIsIFwiZHVyYXRpb25cIiBdIH0sXG4gICAgICAgIHsgc29ydE9yZGVyOiAyLCBmaWVsZHM6IFsgXCJlbnF1ZXVlZEF0XCIsIFwic3RhcnRlZEF0XCIsIFwiZmluaXNoZWRBdFwiLCBcImRldGFpbHNcIiwgXCJlcnJvclwiXSB9XG4gICAgICBdXG4gICAgfSxcbiAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gICAgICB7IG5hbWU6IFwidWlkXCIsIGxhYmVsOiBcIlRhc2sgVUlEXCIsIGlkOiBcInVpZFwiLCBjb2x1bW46IFwidWlkXCIsIGZpZWxkVHlwZTogXCJudW1iZXJcIiwgaXNJZGVudGlmaWVyOiB0cnVlIH0sXG4gICAgICB7IG5hbWU6IFwiaW5kZXhVaWRcIiwgbGFiZWw6IFwiSW5kZXggVUlEXCIsIGlkOiBcImluZGV4VWlkXCIsIGNvbHVtbjogXCJpbmRleFVpZFwiLCBmaWVsZFR5cGU6IFwidGV4dFwiIH0sXG4gICAgICB7IG5hbWU6IFwidHlwZVwiLCBsYWJlbDogXCJUeXBlXCIsIGlkOiBcInR5cGVcIiwgY29sdW1uOiBcInR5cGVcIiwgZmllbGRUeXBlOiBcInRleHRcIiB9LFxuICAgICAgeyBuYW1lOiBcInN0YXR1c1wiLCBsYWJlbDogXCJTdGF0dXNcIiwgaWQ6IFwic3RhdHVzXCIsIGNvbHVtbjogXCJzdGF0dXNcIiwgZmllbGRUeXBlOiBcInRleHRcIiB9LFxuICAgICAge1xuICAgICAgICBuYW1lOiBcImJhdGNoVWlkXCIsXG4gICAgICAgIGxhYmVsOiBcIkJhdGNoIFVJRFwiLFxuICAgICAgICBpZDogXCJiYXRjaFVpZFwiLFxuICAgICAgICBjb2x1bW46IFwiYmF0Y2hVaWRcIixcbiAgICAgICAgZmllbGRUeXBlOiBcIm51bWJlclwiLFxuICAgICAgICByZWFkT25seTogdHJ1ZSxcbiAgICAgICAgaXNMaW5rOiB0cnVlLFxuICAgICAgICBsaW5rQ29uZmlnOiB7XG4gICAgICAgICAgcm91dGVQYXR0ZXJuOiBcIi9zeXN0ZW0vc2VhcmNoL2JhdGNoZXMvOmJhdGNoVWlkXCIsXG4gICAgICAgICAgZGlzcGxheVRleHQ6IFwiVmlldyBCYXRjaCBEZXRhaWxzXCJcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHsgbmFtZTogXCJjYW5jZWxlZEJ5XCIsIGxhYmVsOiBcIkNhbmNlbGVkIEJ5XCIsIGlkOiBcImNhbmNlbGVkQnlcIiwgY29sdW1uOiBcImNhbmNlbGVkQnlcIiwgZmllbGRUeXBlOiBcIm51bWJlclwiIH0sXG4gICAgICB7IG5hbWU6IFwiZHVyYXRpb25cIiwgbGFiZWw6IFwiRHVyYXRpb25cIiwgaWQ6IFwiZHVyYXRpb25cIiwgY29sdW1uOiBcImR1cmF0aW9uXCIsIGZpZWxkVHlwZTogXCJ0ZXh0XCIgfSxcbiAgICAgIHsgbmFtZTogXCJlbnF1ZXVlZEF0XCIsIGxhYmVsOiBcIkVucXVldWVkIEF0XCIsIGlkOiBcImVucXVldWVkQXRcIiwgY29sdW1uOiBcImVucXVldWVkQXRcIiwgZmllbGRUeXBlOiBcImRhdGV0aW1lXCIgfSxcbiAgICAgIHsgbmFtZTogXCJzdGFydGVkQXRcIiwgbGFiZWw6IFwiU3RhcnRlZCBBdFwiLCBpZDogXCJzdGFydGVkQXRcIiwgY29sdW1uOiBcInN0YXJ0ZWRBdFwiLCBmaWVsZFR5cGU6IFwiZGF0ZXRpbWVcIiB9LFxuICAgICAgeyBuYW1lOiBcImZpbmlzaGVkQXRcIiwgbGFiZWw6IFwiRmluaXNoZWQgQXRcIiwgaWQ6IFwiZmluaXNoZWRBdFwiLCBjb2x1bW46IFwiZmluaXNoZWRBdFwiLCBmaWVsZFR5cGU6IFwiZGF0ZXRpbWVcIiB9LFxuICAgICAgeyBuYW1lOiBcImRldGFpbHNcIiwgbGFiZWw6IFwiVGFzayBEZXRhaWxzXCIsIGlkOiBcImRldGFpbHNcIiwgY29sdW1uOiBcImRldGFpbHNcIiwgZmllbGRUeXBlOiBcImpzb25cIiB9LFxuICAgICAgeyBuYW1lOiBcImVycm9yXCIsIGxhYmVsOiBcIkVycm9yIEluZm9ybWF0aW9uXCIsIGlkOiBcImVycm9yXCIsIGNvbHVtbjogXCJlcnJvclwiLCBmaWVsZFR5cGU6IFwianNvblwiIH1cbiAgICBdXG4gIH1cbn07ICJdfQ==
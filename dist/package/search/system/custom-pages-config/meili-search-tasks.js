"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.meiliSearchTasksPage = void 0;
exports.meiliSearchTasksPage = {
    pageTitle: "MeiliSearch Tasks",
    pageType: "list",
    routePattern: "/system/search/tasks",
    breadcrumbs: [
        { label: "Home", url: "/" },
        { label: "Search", url: "/system/search" },
        { label: "MeiliSearch Tasks" }
    ],
    pageHeaderActions: [],
    listPageConfig: {
        apiConfig: { apiMethod: "GET", responseKey: "items", apiUrl: "/system/search/tasks" },
        propertiesConfig: [
            {
                name: "Task UID",
                dataIndex: "uid",
                id: "uid",
                fieldType: "number",
                isListable: true,
                isFilterable: true,
                isIdentifier: true,
                filterConfig: {
                    defaultOperator: "eq",
                    availableOperators: ["eq", "in", "nin"],
                    filterType: "number"
                },
                actions: [
                    { icon: "view", label: "Details", url: "/system/search/tasks/:uid" }
                ]
            },
            {
                name: "Index UID",
                dataIndex: "indexUid",
                id: "indexUid",
                fieldType: "text",
                isListable: true,
                isFilterable: true,
                filterConfig: {
                    defaultOperator: "eq",
                    availableOperators: ["eq", "in", "nin"],
                }
            },
            {
                name: "Status",
                dataIndex: "status",
                id: "status",
                fieldType: "text",
                isListable: true,
                isFilterable: true,
                filterConfig: {
                    defaultOperator: "eq",
                    availableOperators: ["eq", "in", "nin"],
                    predefinedOptions: [
                        { label: "Enqueued", value: "enqueued" },
                        { label: "Processing", value: "processing" },
                        { label: "Succeeded", value: "succeeded" },
                        { label: "Failed", value: "failed" },
                        { label: "Canceled", value: "canceled" }
                    ],
                    filterType: "select"
                }
            },
            {
                name: "Type",
                dataIndex: "type",
                id: "type",
                fieldType: "text",
                isListable: true,
                isFilterable: true,
                filterConfig: {
                    defaultOperator: "eq",
                    availableOperators: ["eq", "in", "nin"],
                    predefinedOptions: [
                        { label: "Document Addition/Update", value: "documentAdditionOrUpdate" },
                        { label: "Document Edition", value: "documentEdition" },
                        { label: "Document Deletion", value: "documentDeletion" },
                        { label: "Settings Update", value: "settingsUpdate" },
                        { label: "Index Creation", value: "indexCreation" },
                        { label: "Index Deletion", value: "indexDeletion" },
                        { label: "Index Update", value: "indexUpdate" },
                        { label: "Index Swap", value: "indexSwap" },
                        { label: "Task Cancellation", value: "taskCancelation" },
                        { label: "Task Deletion", value: "taskDeletion" },
                        { label: "Dump Creation", value: "dumpCreation" },
                        { label: "Snapshot Creation", value: "snapshotCreation" },
                        { label: "Database Upgrade", value: "upgradeDatabase" }
                    ],
                    filterType: "select"
                }
            },
            {
                name: "Enqueued At",
                dataIndex: "enqueuedAt",
                id: "enqueuedAt",
                fieldType: "datetime",
                isListable: true,
                isFilterable: true,
                filterConfig: {
                    defaultOperator: "gt",
                    availableOperators: ["gt", "lt", "eq"],
                    filterType: "datetime"
                }
            },
            {
                name: "Started At",
                dataIndex: "startedAt",
                id: "startedAt",
                fieldType: "datetime",
                isListable: true,
                isFilterable: true,
                filterConfig: {
                    defaultOperator: "gt",
                    availableOperators: ["gt", "lt", "eq"],
                    filterType: "datetime"
                }
            },
            {
                name: "Finished At",
                dataIndex: "finishedAt",
                id: "finishedAt",
                fieldType: "datetime",
                isListable: true,
                isFilterable: true,
                filterConfig: {
                    defaultOperator: "gt",
                    availableOperators: ["gt", "lt", "eq"],
                    filterType: "datetime"
                }
            }
        ]
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVpbGktc2VhcmNoLXRhc2tzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL3NlYXJjaC9zeXN0ZW0vY3VzdG9tLXBhZ2VzLWNvbmZpZy9tZWlsaS1zZWFyY2gtdGFza3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBRWEsUUFBQSxvQkFBb0IsR0FBbUI7SUFDbEQsU0FBUyxFQUFFLG1CQUFtQjtJQUM5QixRQUFRLEVBQUUsTUFBTTtJQUNoQixZQUFZLEVBQUUsc0JBQXNCO0lBQ3BDLFdBQVcsRUFBRTtRQUNYLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFO1FBQzNCLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxHQUFHLEVBQUUsZ0JBQWdCLEVBQUU7UUFDMUMsRUFBRSxLQUFLLEVBQUUsbUJBQW1CLEVBQUU7S0FDL0I7SUFDRCxpQkFBaUIsRUFBRSxFQUFFO0lBQ3JCLGNBQWMsRUFBRTtRQUNkLFNBQVMsRUFBRSxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUUsV0FBVyxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsc0JBQXNCLEVBQUU7UUFDckYsZ0JBQWdCLEVBQUU7WUFDaEI7Z0JBQ0UsSUFBSSxFQUFFLFVBQVU7Z0JBQ2hCLFNBQVMsRUFBRSxLQUFLO2dCQUNoQixFQUFFLEVBQUUsS0FBSztnQkFDVCxTQUFTLEVBQUUsUUFBUTtnQkFDbkIsVUFBVSxFQUFFLElBQUk7Z0JBQ2hCLFlBQVksRUFBRSxJQUFJO2dCQUNsQixZQUFZLEVBQUUsSUFBSTtnQkFDbEIsWUFBWSxFQUFFO29CQUNaLGVBQWUsRUFBRSxJQUFJO29CQUNyQixrQkFBa0IsRUFBRSxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsS0FBSyxDQUFDO29CQUN2QyxVQUFVLEVBQUUsUUFBUTtpQkFDckI7Z0JBQ0QsT0FBTyxFQUFFO29CQUNQLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsU0FB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LFFBQVE7aUJBQ3JCO2FBQ0Y7WUFDRDtnQkFDRSxJQUFJLEVBQUUsYUFBYTtnQkFDbkIsU0FBUyxFQUFFLFlBQVk7Z0JBQ3ZCLEVBQUUsRUFBRSxZQUFZO2dCQUNoQixTQUFTLEVBQUUsVUFBVTtnQkFDckIsVUFBVSxFQUFFLElBQUk7Z0JBQ2hCLFlBQVksRUFBRSxJQUFJO2dCQUNsQixZQUFZLEVBQUU7b0JBQ1osZUFBZSxFQUFFLElBQUk7b0JBQ3JCLGtCQUFrQixFQUFFLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLENBQUM7b0JBQ3RDLFVBQVUsRUFBRSxVQUFVO2lCQUN2QjthQUNGO1lBQ0Q7Z0JBQ0UsSUFBSSxFQUFFLFlBQVk7Z0JBQ2xCLFNBQVMsRUFBRSxXQUFXO2dCQUN0QixFQUFFLEVBQUUsV0FBVztnQkFDZixTQUFTLEVBQUUsVUFBVTtnQkFDckIsVUFBVSxFQUFFLElBQUk7Z0JBQ2hCLFlBQVksRUFBRSxJQUFJO2dCQUNsQixZQUFZLEVBQUU7b0JBQ1osZUFBZSxFQUFFLElBQUk7b0JBQ3JCLGtCQUFrQixFQUFFLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLENBQUM7b0JBQ3RDLFVBQVUsRUFBRSxVQUFVO2lCQUN2QjthQUNGO1lBQ0Q7Z0JBQ0UsSUFBSSxFQUFFLGFBQWE7Z0JBQ25CLFNBQVMsRUFBRSxZQUFZO2dCQUN2QixFQUFFLEVBQUUsWUFBWTtnQkFDaEIsU0FBUyxFQUFFLFVBQVU7Z0JBQ3JCLFVBQVUsRUFBRSxJQUFJO2dCQUNoQixZQUFZLEVBQUUsSUFBSTtnQkFDbEIsWUFBWSxFQUFFO29CQUNaLGVBQWUsRUFBRSxJQUFJO29CQUNyQixrQkFBa0IsRUFBRSxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDO29CQUN0QyxVQUFVLEVBQUUsVUFBVTtpQkFDdkI7YUFDRjtTQUNGO0tBQ0Y7Q0FDRixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgTGlzdFBhZ2VDb25maWcgfSBmcm9tIFwiLi4vLi4vLi4vdWktY29uZmlnLWdlblwiO1xuXG5leHBvcnQgY29uc3QgbWVpbGlTZWFyY2hUYXNrc1BhZ2U6IExpc3RQYWdlQ29uZmlnID0ge1xuICBwYWdlVGl0bGU6IFwiTWVpbGlTZWFyY2ggVGFza3NcIixcbiAgcGFnZVR5cGU6IFwibGlzdFwiLFxuICByb3V0ZVBhdHRlcm46IFwiL3N5c3RlbS9zZWFyY2gvdGFza3NcIixcbiAgYnJlYWRjcnVtYnM6IFtcbiAgICB7IGxhYmVsOiBcIkhvbWVcIiwgdXJsOiBcIi9cIiB9LFxuICAgIHsgbGFiZWw6IFwiU2VhcmNoXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaFwiIH0sXG4gICAgeyBsYWJlbDogXCJNZWlsaVNlYXJjaCBUYXNrc1wiIH1cbiAgXSxcbiAgcGFnZUhlYWRlckFjdGlvbnM6IFtdLFxuICBsaXN0UGFnZUNvbmZpZzoge1xuICAgIGFwaUNvbmZpZzogeyBhcGlNZXRob2Q6IFwiR0VUXCIsIHJlc3BvbnNlS2V5OiBcIml0ZW1zXCIsIGFwaVVybDogXCIvc3lzdGVtL3NlYXJjaC90YXNrc1wiIH0sXG4gICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgeyBcbiAgICAgICAgbmFtZTogXCJUYXNrIFVJRFwiLCBcbiAgICAgICAgZGF0YUluZGV4OiBcInVpZFwiLCBcbiAgICAgICAgaWQ6IFwidWlkXCIsIFxuICAgICAgICBmaWVsZFR5cGU6IFwibnVtYmVyXCIsIFxuICAgICAgICBpc0xpc3RhYmxlOiB0cnVlLCBcbiAgICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgICBpc0lkZW50aWZpZXI6IHRydWUsXG4gICAgICAgIGZpbHRlckNvbmZpZzoge1xuICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogXCJlcVwiLFxuICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogW1wiZXFcIiwgXCJpblwiLCBcIm5pblwiXSxcbiAgICAgICAgICBmaWx0ZXJUeXBlOiBcIm51bWJlclwiXG4gICAgICAgIH0sXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICB7IGljb246IFwidmlld1wiLCBsYWJlbDogXCJEZXRhaWxzXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaC90YXNrcy86dWlkXCIgfVxuICAgICAgICBdXG4gICAgICB9LFxuICAgICAgeyBcbiAgICAgICAgbmFtZTogXCJJbmRleCBVSURcIiwgXG4gICAgICAgIGRhdGFJbmRleDogXCJpbmRleFVpZFwiLCBcbiAgICAgICAgaWQ6IFwiaW5kZXhVaWRcIiwgXG4gICAgICAgIGZpZWxkVHlwZTogXCJ0ZXh0XCIsIFxuICAgICAgICBpc0xpc3RhYmxlOiB0cnVlLFxuICAgICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAgIGZpbHRlckNvbmZpZzoge1xuICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogXCJlcVwiLFxuICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogW1wiZXFcIiwgXCJpblwiLCBcIm5pblwiXSxcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHsgXG4gICAgICAgIG5hbWU6IFwiU3RhdHVzXCIsIFxuICAgICAgICBkYXRhSW5kZXg6IFwic3RhdHVzXCIsIFxuICAgICAgICBpZDogXCJzdGF0dXNcIiwgXG4gICAgICAgIGZpZWxkVHlwZTogXCJ0ZXh0XCIsIFxuICAgICAgICBpc0xpc3RhYmxlOiB0cnVlLFxuICAgICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAgIGZpbHRlckNvbmZpZzoge1xuICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogXCJlcVwiLFxuICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogW1wiZXFcIiwgXCJpblwiLCBcIm5pblwiXSxcbiAgICAgICAgICBwcmVkZWZpbmVkT3B0aW9uczogW1xuICAgICAgICAgICAgeyBsYWJlbDogXCJFbnF1ZXVlZFwiLCB2YWx1ZTogXCJlbnF1ZXVlZFwiIH0sXG4gICAgICAgICAgICB7IGxhYmVsOiBcIlByb2Nlc3NpbmdcIiwgdmFsdWU6IFwicHJvY2Vzc2luZ1wiIH0sXG4gICAgICAgICAgICB7IGxhYmVsOiBcIlN1Y2NlZWRlZFwiLCB2YWx1ZTogXCJzdWNjZWVkZWRcIiB9LFxuICAgICAgICAgICAgeyBsYWJlbDogXCJGYWlsZWRcIiwgdmFsdWU6IFwiZmFpbGVkXCIgfSxcbiAgICAgICAgICAgIHsgbGFiZWw6IFwiQ2FuY2VsZWRcIiwgdmFsdWU6IFwiY2FuY2VsZWRcIiB9XG4gICAgICAgICAgXSxcbiAgICAgICAgICBmaWx0ZXJUeXBlOiBcInNlbGVjdFwiXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICB7IFxuICAgICAgICBuYW1lOiBcIlR5cGVcIiwgXG4gICAgICAgIGRhdGFJbmRleDogXCJ0eXBlXCIsIFxuICAgICAgICBpZDogXCJ0eXBlXCIsIFxuICAgICAgICBmaWVsZFR5cGU6IFwidGV4dFwiLCBcbiAgICAgICAgaXNMaXN0YWJsZTogdHJ1ZSxcbiAgICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgICBmaWx0ZXJDb25maWc6IHtcbiAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IFwiZXFcIixcbiAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IFtcImVxXCIsIFwiaW5cIiwgXCJuaW5cIl0sXG4gICAgICAgICAgcHJlZGVmaW5lZE9wdGlvbnM6IFtcbiAgICAgICAgICAgIHsgbGFiZWw6IFwiRG9jdW1lbnQgQWRkaXRpb24vVXBkYXRlXCIsIHZhbHVlOiBcImRvY3VtZW50QWRkaXRpb25PclVwZGF0ZVwiIH0sXG4gICAgICAgICAgICB7IGxhYmVsOiBcIkRvY3VtZW50IEVkaXRpb25cIiwgdmFsdWU6IFwiZG9jdW1lbnRFZGl0aW9uXCIgfSxcbiAgICAgICAgICAgIHsgbGFiZWw6IFwiRG9jdW1lbnQgRGVsZXRpb25cIiwgdmFsdWU6IFwiZG9jdW1lbnREZWxldGlvblwiIH0sXG4gICAgICAgICAgICB7IGxhYmVsOiBcIlNldHRpbmdzIFVwZGF0ZVwiLCB2YWx1ZTogXCJzZXR0aW5nc1VwZGF0ZVwiIH0sXG4gICAgICAgICAgICB7IGxhYmVsOiBcIkluZGV4IENyZWF0aW9uXCIsIHZhbHVlOiBcImluZGV4Q3JlYXRpb25cIiB9LFxuICAgICAgICAgICAgeyBsYWJlbDogXCJJbmRleCBEZWxldGlvblwiLCB2YWx1ZTogXCJpbmRleERlbGV0aW9uXCIgfSxcbiAgICAgICAgICAgIHsgbGFiZWw6IFwiSW5kZXggVXBkYXRlXCIsIHZhbHVlOiBcImluZGV4VXBkYXRlXCIgfSxcbiAgICAgICAgICAgIHsgbGFiZWw6IFwiSW5kZXggU3dhcFwiLCB2YWx1ZTogXCJpbmRleFN3YXBcIiB9LFxuICAgICAgICAgICAgeyBsYWJlbDogXCJUYXNrIENhbmNlbGxhdGlvblwiLCB2YWx1ZTogXCJ0YXNrQ2FuY2VsYXRpb25cIiB9LFxuICAgICAgICAgICAgeyBsYWJlbDogXCJUYXNrIERlbGV0aW9uXCIsIHZhbHVlOiBcInRhc2tEZWxldGlvblwiIH0sXG4gICAgICAgICAgICB7IGxhYmVsOiBcIkR1bXAgQ3JlYXRpb25cIiwgdmFsdWU6IFwiZHVtcENyZWF0aW9uXCIgfSxcbiAgICAgICAgICAgIHsgbGFiZWw6IFwiU25hcHNob3QgQ3JlYXRpb25cIiwgdmFsdWU6IFwic25hcHNob3RDcmVhdGlvblwiIH0sXG4gICAgICAgICAgICB7IGxhYmVsOiBcIkRhdGFiYXNlIFVwZ3JhZGVcIiwgdmFsdWU6IFwidXBncmFkZURhdGFiYXNlXCIgfVxuICAgICAgICAgIF0sXG4gICAgICAgICAgZmlsdGVyVHlwZTogXCJzZWxlY3RcIlxuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgeyBcbiAgICAgICAgbmFtZTogXCJFbnF1ZXVlZCBBdFwiLCBcbiAgICAgICAgZGF0YUluZGV4OiBcImVucXVldWVkQXRcIiwgXG4gICAgICAgIGlkOiBcImVucXVldWVkQXRcIiwgXG4gICAgICAgIGZpZWxkVHlwZTogXCJkYXRldGltZVwiLCBcbiAgICAgICAgaXNMaXN0YWJsZTogdHJ1ZSxcbiAgICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgICBmaWx0ZXJDb25maWc6IHtcbiAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IFwiZ3RcIixcbiAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IFtcImd0XCIsIFwibHRcIiwgXCJlcVwiXSxcbiAgICAgICAgICBmaWx0ZXJUeXBlOiBcImRhdGV0aW1lXCJcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHsgXG4gICAgICAgIG5hbWU6IFwiU3RhcnRlZCBBdFwiLCBcbiAgICAgICAgZGF0YUluZGV4OiBcInN0YXJ0ZWRBdFwiLCBcbiAgICAgICAgaWQ6IFwic3RhcnRlZEF0XCIsIFxuICAgICAgICBmaWVsZFR5cGU6IFwiZGF0ZXRpbWVcIiwgXG4gICAgICAgIGlzTGlzdGFibGU6IHRydWUsXG4gICAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgICAgZmlsdGVyQ29uZmlnOiB7XG4gICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBcImd0XCIsXG4gICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBbXCJndFwiLCBcImx0XCIsIFwiZXFcIl0sXG4gICAgICAgICAgZmlsdGVyVHlwZTogXCJkYXRldGltZVwiXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICB7IFxuICAgICAgICBuYW1lOiBcIkZpbmlzaGVkIEF0XCIsIFxuICAgICAgICBkYXRhSW5kZXg6IFwiZmluaXNoZWRBdFwiLCBcbiAgICAgICAgaWQ6IFwiZmluaXNoZWRBdFwiLCBcbiAgICAgICAgZmllbGRUeXBlOiBcImRhdGV0aW1lXCIsIFxuICAgICAgICBpc0xpc3RhYmxlOiB0cnVlLFxuICAgICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAgIGZpbHRlckNvbmZpZzoge1xuICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogXCJndFwiLFxuICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogW1wiZ3RcIiwgXCJsdFwiLCBcImVxXCJdLFxuICAgICAgICAgIGZpbHRlclR5cGU6IFwiZGF0ZXRpbWVcIlxuICAgICAgICB9XG4gICAgICB9XG4gICAgXVxuICB9XG59OyAiXX0=
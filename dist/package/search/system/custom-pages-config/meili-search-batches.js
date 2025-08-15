"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.meiliSearchBatchesPage = void 0;
exports.meiliSearchBatchesPage = {
    pageTitle: "MeiliSearch Batches",
    pageType: "list",
    routePattern: "/system/search/batches",
    breadcrumbs: [
        { label: "Home", url: "/" },
        { label: "Search", url: "/system/search" },
        { label: "Batches" }
    ],
    listPageConfig: {
        apiConfig: { apiMethod: "GET", responseKey: "items", apiUrl: "/system/search/batches" },
        propertiesConfig: [
            {
                name: "UID",
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
                    { icon: "view", label: "Details", url: "/system/search/batches/:uid" }
                ]
            },
            {
                name: "Total Tasks",
                dataIndex: "stats.totalNbTasks",
                id: "totalNbTasks",
                fieldType: "json",
                isListable: true,
                isFilterable: false
            },
            {
                name: "Status",
                dataIndex: "status",
                id: "status",
                fieldType: "json",
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
                dataIndex: "types",
                id: "type",
                fieldType: "json",
                isListable: true,
                isFilterable: true,
                filterConfig: {
                    defaultOperator: "eq",
                    availableOperators: ["eq", "in", "nin"],
                    predefinedOptions: [
                        { label: "Index Creation", value: "indexCreation" },
                        { label: "Index Update", value: "indexUpdate" },
                        { label: "Index Deletion", value: "indexDeletion" },
                        { label: "Index Swap", value: "indexSwap" },
                        { label: "Document Addition/Update", value: "documentAdditionOrUpdate" },
                        { label: "Document Deletion", value: "documentDeletion" },
                        { label: "Document Edition", value: "documentEdition" },
                        { label: "Settings Update", value: "settingsUpdate" },
                        { label: "Dump Creation", value: "dumpCreation" },
                        { label: "Task Cancelation", value: "taskCancelation" },
                        { label: "Task Deletion", value: "taskDeletion" },
                        { label: "Database Upgrade", value: "databaseUpgrade" },
                        { label: "Snapshot Creation", value: "snapshotCreation" }
                    ],
                    filterType: "select"
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
            },
            {
                name: "Duration",
                dataIndex: "duration",
                id: "duration",
                fieldType: "text",
                isListable: true,
                isFilterable: false
            }
        ]
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVpbGktc2VhcmNoLWJhdGNoZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvc2VhcmNoL3N5c3RlbS9jdXN0b20tcGFnZXMtY29uZmlnL21laWxpLXNlYXJjaC1iYXRjaGVzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVhLFFBQUEsc0JBQXNCLEdBQW1CO0lBQ3BELFNBQVMsRUFBRSxxQkFBcUI7SUFDaEMsUUFBUSxFQUFFLE1BQU07SUFDaEIsWUFBWSxFQUFFLHdCQUF3QjtJQUN0QyxXQUFXLEVBQUU7UUFDWCxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRTtRQUMzQixFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLGdCQUFnQixFQUFFO1FBQzFDLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRTtLQUNyQjtJQUNELGNBQWMsRUFBRTtRQUNkLFNBQVMsRUFBRSxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUUsV0FBVyxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsd0JBQXdCLEVBQUU7UUFDdkYsZ0JBQWdCLEVBQUU7WUFDaEI7Z0JBQ0UsSUFBSSxFQUFFLEtBQUs7Z0JBQ1gsU0FBUyxFQUFFLEtBQUs7Z0JBQ2hCLEVBQUUsRUFBRSxLQUFLO2dCQUNULFNBQVMsRUFBRSxRQUFRO2dCQUNuQixVQUFVLEVBQUUsSUFBSTtnQkFDaEIsWUFBWSxFQUFFLElBQUk7Z0JBQ2xCLFlBQVksRUFBRSxJQUFJO2dCQUNsQixZQUFZLEVBQUU7b0JBQ1osZUFBZSxFQUFFLElBQUk7b0JBQ3JCLGtCQUFrQixFQUFFLENBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxLQUFLLENBQUU7b0JBQ3pDLFVBQVUsRUFBRSxRQUFRO2lCQUNyQjtnQkFDRCxPQUFPLEVBQUU7b0JBQ1AsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsR0FBRyxFQUFFLDZCQUE2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QUFVLEVBQUUsSUFBSTtnQkFDaEIsWUFBWSxFQUFFLElBQUk7Z0JBQ2xCLFlBQVksRUFBRTtvQkFDWixlQUFlLEVBQUUsSUFBSTtvQkFDckIsa0JBQWtCLEVBQUUsQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQztvQkFDdEMsVUFBVSxFQUFFLFVBQVU7aUJBQ3ZCO2FBQ0Y7WUFDRDtnQkFDRSxJQUFJLEVBQUUsYUFBYTtnQkFDbkIsU0FBUyxFQUFFLFlBQVk7Z0JBQ3ZCLEVBQUUsRUFBRSxZQUFZO2dCQUNoQixTQUFTLEVBQUUsVUFBVTtnQkFDckIsVUFBVSxFQUFFLElBQUk7Z0JBQ2hCLFlBQVksRUFBRSxJQUFJO2dCQUNsQixZQUFZLEVBQUU7b0JBQ1osZUFBZSxFQUFFLElBQUk7b0JBQ3JCLGtCQUFrQixFQUFFLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLENBQUM7b0JBQ3RDLFVBQVUsRUFBRSxVQUFVO2lCQUN2QjthQUNGO1lBQ0Q7Z0JBQ0UsSUFBSSxFQUFFLFVBQVU7Z0JBQ2hCLFNBQVMsRUFBRSxVQUFVO2dCQUNyQixFQUFFLEVBQUUsVUFBVTtnQkFDZCxTQUFTLEVBQUUsTUFBTTtnQkFDakIsVUFBVSxFQUFFLElBQUk7Z0JBQ2hCLFlBQVksRUFBRSxLQUFLO2FBQ3BCO1NBQ0Y7S0FDRjtDQUNGLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBMaXN0UGFnZUNvbmZpZyB9IGZyb20gXCIuLi8uLi8uLi91aS1jb25maWctZ2VuXCI7XG5cbmV4cG9ydCBjb25zdCBtZWlsaVNlYXJjaEJhdGNoZXNQYWdlOiBMaXN0UGFnZUNvbmZpZyA9IHtcbiAgcGFnZVRpdGxlOiBcIk1laWxpU2VhcmNoIEJhdGNoZXNcIixcbiAgcGFnZVR5cGU6IFwibGlzdFwiLFxuICByb3V0ZVBhdHRlcm46IFwiL3N5c3RlbS9zZWFyY2gvYmF0Y2hlc1wiLFxuICBicmVhZGNydW1iczogW1xuICAgIHsgbGFiZWw6IFwiSG9tZVwiLCB1cmw6IFwiL1wiIH0sXG4gICAgeyBsYWJlbDogXCJTZWFyY2hcIiwgdXJsOiBcIi9zeXN0ZW0vc2VhcmNoXCIgfSxcbiAgICB7IGxhYmVsOiBcIkJhdGNoZXNcIiB9XG4gIF0sXG4gIGxpc3RQYWdlQ29uZmlnOiB7XG4gICAgYXBpQ29uZmlnOiB7IGFwaU1ldGhvZDogXCJHRVRcIiwgcmVzcG9uc2VLZXk6IFwiaXRlbXNcIiwgYXBpVXJsOiBcIi9zeXN0ZW0vc2VhcmNoL2JhdGNoZXNcIiB9LFxuICAgIHByb3BlcnRpZXNDb25maWc6IFtcbiAgICAgIHtcbiAgICAgICAgbmFtZTogXCJVSURcIixcbiAgICAgICAgZGF0YUluZGV4OiBcInVpZFwiLFxuICAgICAgICBpZDogXCJ1aWRcIixcbiAgICAgICAgZmllbGRUeXBlOiBcIm51bWJlclwiLFxuICAgICAgICBpc0xpc3RhYmxlOiB0cnVlLFxuICAgICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAgIGlzSWRlbnRpZmllcjogdHJ1ZSxcbiAgICAgICAgZmlsdGVyQ29uZmlnOiB7XG4gICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBcImVxXCIsXG4gICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBbIFwiZXFcIiwgXCJpblwiLCBcIm5pblwiIF0sXG4gICAgICAgICAgZmlsdGVyVHlwZTogXCJudW1iZXJcIlxuICAgICAgICB9LFxuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgeyBpY29uOiBcInZpZXdcIiwgbGFiZWw6IFwiRGV0YWlsc1wiLCB1cmw6IFwiL3N5c3RlbS9zZWFyY2gvYmF0Y2hlcy86dWlkXCIgfVxuICAgICAgICBdXG4gICAgICB9LFxuICAgICAgeyBcbiAgICAgICAgbmFtZTogXCJUb3RhbCBUYXNrc1wiLCBcbiAgICAgICAgZGF0YUluZGV4OiBcInN0YXRzLnRvdGFsTmJUYXNrc1wiLCBcbiAgICAgICAgaWQ6IFwidG90YWxOYlRhc2tzXCIsIFxuICAgICAgICBmaWVsZFR5cGU6IFwianNvblwiLCBcbiAgICAgICAgaXNMaXN0YWJsZTogdHJ1ZSxcbiAgICAgICAgaXNGaWx0ZXJhYmxlOiBmYWxzZVxuICAgICAgfSxcbiAgICAgIHsgXG4gICAgICAgIG5hbWU6IFwiU3RhdHVzXCIsIFxuICAgICAgICBkYXRhSW5kZXg6IFwic3RhdHVzXCIsIFxuICAgICAgICBpZDogXCJzdGF0dXNcIiwgXG4gICAgICAgIGZpZWxkVHlwZTogXCJqc29uXCIsIFxuICAgICAgICBpc0xpc3RhYmxlOiB0cnVlLFxuICAgICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAgIGZpbHRlckNvbmZpZzoge1xuICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogXCJlcVwiLFxuICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogW1wiZXFcIiwgXCJpblwiLCBcIm5pblwiXSxcbiAgICAgICAgICBwcmVkZWZpbmVkT3B0aW9uczogW1xuICAgICAgICAgICAgeyBsYWJlbDogXCJFbnF1ZXVlZFwiLCB2YWx1ZTogXCJlbnF1ZXVlZFwiIH0sXG4gICAgICAgICAgICB7IGxhYmVsOiBcIlByb2Nlc3NpbmdcIiwgdmFsdWU6IFwicHJvY2Vzc2luZ1wiIH0sXG4gICAgICAgICAgICB7IGxhYmVsOiBcIlN1Y2NlZWRlZFwiLCB2YWx1ZTogXCJzdWNjZWVkZWRcIiB9LFxuICAgICAgICAgICAgeyBsYWJlbDogXCJGYWlsZWRcIiwgdmFsdWU6IFwiZmFpbGVkXCIgfSxcbiAgICAgICAgICAgIHsgbGFiZWw6IFwiQ2FuY2VsZWRcIiwgdmFsdWU6IFwiY2FuY2VsZWRcIiB9XG4gICAgICAgICAgXSxcbiAgICAgICAgICBmaWx0ZXJUeXBlOiBcInNlbGVjdFwiXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICB7IFxuICAgICAgICBuYW1lOiBcIlR5cGVcIiwgXG4gICAgICAgIGRhdGFJbmRleDogXCJ0eXBlc1wiLCBcbiAgICAgICAgaWQ6IFwidHlwZVwiLCBcbiAgICAgICAgZmllbGRUeXBlOiBcImpzb25cIiwgXG4gICAgICAgIGlzTGlzdGFibGU6IHRydWUsXG4gICAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgICAgZmlsdGVyQ29uZmlnOiB7XG4gICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBcImVxXCIsXG4gICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBbXCJlcVwiLCBcImluXCIsIFwibmluXCJdLFxuICAgICAgICAgIHByZWRlZmluZWRPcHRpb25zOiBbXG4gICAgICAgICAgICB7IGxhYmVsOiBcIkluZGV4IENyZWF0aW9uXCIsIHZhbHVlOiBcImluZGV4Q3JlYXRpb25cIiB9LFxuICAgICAgICAgICAgeyBsYWJlbDogXCJJbmRleCBVcGRhdGVcIiwgdmFsdWU6IFwiaW5kZXhVcGRhdGVcIiB9LFxuICAgICAgICAgICAgeyBsYWJlbDogXCJJbmRleCBEZWxldGlvblwiLCB2YWx1ZTogXCJpbmRleERlbGV0aW9uXCIgfSxcbiAgICAgICAgICAgIHsgbGFiZWw6IFwiSW5kZXggU3dhcFwiLCB2YWx1ZTogXCJpbmRleFN3YXBcIiB9LFxuICAgICAgICAgICAgeyBsYWJlbDogXCJEb2N1bWVudCBBZGRpdGlvbi9VcGRhdGVcIiwgdmFsdWU6IFwiZG9jdW1lbnRBZGRpdGlvbk9yVXBkYXRlXCIgfSxcbiAgICAgICAgICAgIHsgbGFiZWw6IFwiRG9jdW1lbnQgRGVsZXRpb25cIiwgdmFsdWU6IFwiZG9jdW1lbnREZWxldGlvblwiIH0sXG4gICAgICAgICAgICB7IGxhYmVsOiBcIkRvY3VtZW50IEVkaXRpb25cIiwgdmFsdWU6IFwiZG9jdW1lbnRFZGl0aW9uXCIgfSxcbiAgICAgICAgICAgIHsgbGFiZWw6IFwiU2V0dGluZ3MgVXBkYXRlXCIsIHZhbHVlOiBcInNldHRpbmdzVXBkYXRlXCIgfSxcbiAgICAgICAgICAgIHsgbGFiZWw6IFwiRHVtcCBDcmVhdGlvblwiLCB2YWx1ZTogXCJkdW1wQ3JlYXRpb25cIiB9LFxuICAgICAgICAgICAgeyBsYWJlbDogXCJUYXNrIENhbmNlbGF0aW9uXCIsIHZhbHVlOiBcInRhc2tDYW5jZWxhdGlvblwiIH0sXG4gICAgICAgICAgICB7IGxhYmVsOiBcIlRhc2sgRGVsZXRpb25cIiwgdmFsdWU6IFwidGFza0RlbGV0aW9uXCIgfSxcbiAgICAgICAgICAgIHsgbGFiZWw6IFwiRGF0YWJhc2UgVXBncmFkZVwiLCB2YWx1ZTogXCJkYXRhYmFzZVVwZ3JhZGVcIiB9LFxuICAgICAgICAgICAgeyBsYWJlbDogXCJTbmFwc2hvdCBDcmVhdGlvblwiLCB2YWx1ZTogXCJzbmFwc2hvdENyZWF0aW9uXCIgfVxuICAgICAgICAgIF0sXG4gICAgICAgICAgZmlsdGVyVHlwZTogXCJzZWxlY3RcIlxuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgeyBcbiAgICAgICAgbmFtZTogXCJTdGFydGVkIEF0XCIsIFxuICAgICAgICBkYXRhSW5kZXg6IFwic3RhcnRlZEF0XCIsIFxuICAgICAgICBpZDogXCJzdGFydGVkQXRcIiwgXG4gICAgICAgIGZpZWxkVHlwZTogXCJkYXRldGltZVwiLCBcbiAgICAgICAgaXNMaXN0YWJsZTogdHJ1ZSxcbiAgICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgICBmaWx0ZXJDb25maWc6IHtcbiAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IFwiZ3RcIixcbiAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IFtcImd0XCIsIFwibHRcIiwgXCJlcVwiXSxcbiAgICAgICAgICBmaWx0ZXJUeXBlOiBcImRhdGV0aW1lXCJcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHsgXG4gICAgICAgIG5hbWU6IFwiRmluaXNoZWQgQXRcIiwgXG4gICAgICAgIGRhdGFJbmRleDogXCJmaW5pc2hlZEF0XCIsIFxuICAgICAgICBpZDogXCJmaW5pc2hlZEF0XCIsIFxuICAgICAgICBmaWVsZFR5cGU6IFwiZGF0ZXRpbWVcIiwgXG4gICAgICAgIGlzTGlzdGFibGU6IHRydWUsXG4gICAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgICAgZmlsdGVyQ29uZmlnOiB7XG4gICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBcImd0XCIsXG4gICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBbXCJndFwiLCBcImx0XCIsIFwiZXFcIl0sXG4gICAgICAgICAgZmlsdGVyVHlwZTogXCJkYXRldGltZVwiXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICB7IFxuICAgICAgICBuYW1lOiBcIkR1cmF0aW9uXCIsIFxuICAgICAgICBkYXRhSW5kZXg6IFwiZHVyYXRpb25cIiwgXG4gICAgICAgIGlkOiBcImR1cmF0aW9uXCIsIFxuICAgICAgICBmaWVsZFR5cGU6IFwidGV4dFwiLCBcbiAgICAgICAgaXNMaXN0YWJsZTogdHJ1ZSxcbiAgICAgICAgaXNGaWx0ZXJhYmxlOiBmYWxzZVxuICAgICAgfVxuICAgIF1cbiAgfVxufTsiXX0=
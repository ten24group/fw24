"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.meiliSearchBatchDetailPage = void 0;
exports.meiliSearchBatchDetailPage = {
    pageTitle: "MeiliSearch Batch Detail",
    pageType: "accordion",
    routePattern: "/system/search/batches/:uid",
    breadcrumbs: [
        { label: "Home", url: "/" },
        { label: "Search", url: "/system/search" },
        { label: "Batches", url: "/system/search/batches" },
        { label: "Batch Detail" }
    ],
    accordionPageConfig: {
        accordions: {
            "batchDetails": {
                pageTitle: "Batch Details",
                pageType: "details",
                detailsPageConfig: {
                    detailApiConfig: {
                        apiMethod: "GET",
                        responseKey: "",
                        apiUrl: "/system/search/batches/:uid"
                    },
                    columnsConfig: {
                        columns: [
                            { sortOrder: 1, fields: ["uid", "batchStrategy", "startedAt", "finishedAt", "duration", "progress", "details", "stats"] },
                        ]
                    },
                    propertiesConfig: [
                        { name: "uid", label: "UID", id: "uid", column: "uid", fieldType: "number" },
                        { name: "batchStrategy", label: "Batch Strategy", id: "batchStrategy", column: "batchStrategy", fieldType: "text" },
                        { name: "startedAt", label: "Started At", id: "startedAt", column: "startedAt", fieldType: "datetime" },
                        { name: "finishedAt", label: "Finished At", id: "finishedAt", column: "finishedAt", fieldType: "datetime" },
                        { name: "duration", label: "Duration", id: "duration", column: "duration", fieldType: "text" },
                        { name: "stats", label: "Stats", id: "stats", column: "stats", fieldType: "json" },
                        { name: "progress", label: "Progress", id: "progress", column: "progress", fieldType: "json" },
                        { name: "details", label: "Details", id: "details", column: "details", fieldType: "json" }
                    ]
                }
            },
            "batchTasks": {
                pageTitle: "Batch Tasks",
                pageType: "list",
                listPageConfig: {
                    apiConfig: {
                        apiMethod: "GET",
                        responseKey: "items",
                        apiUrl: "/system/search/tasks?batchUid.eq=:uid"
                    },
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
            }
        }
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVpbGktc2VhcmNoLWJhdGNoLWRldGFpbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9zZWFyY2gvc3lzdGVtL2N1c3RvbS1wYWdlcy1jb25maWcvbWVpbGktc2VhcmNoLWJhdGNoLWRldGFpbC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFFYSxRQUFBLDBCQUEwQixHQUF3QjtJQUM3RCxTQUFTLEVBQUUsMEJBQTBCO0lBQ3JDLFFBQVEsRUFBRSxXQUFXO0lBQ3JCLFlBQVksRUFBRSw2QkFBNkI7SUFDM0MsV0FBVyxFQUFFO1FBQ1gsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUU7UUFDM0IsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLEdBQUcsRUFBRSxnQkFBZ0IsRUFBRTtRQUMxQyxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsR0FBRyxFQUFFLHdCQUF3QixFQUFFO1FBQ25ELEVBQUUsS0FBSyxFQUFFLGNBQWMsRUFBRTtLQUMxQjtJQUNELG1CQUFtQixFQUFFO1FBQ25CLFVBQVUsRUFBRTtZQUNWLGNBQWMsRUFBRTtnQkFDZCxTQUFTLEVBQUUsZUFBZTtnQkFDMUIsUUFBUSxFQUFFLFNBQVM7Z0JBQ25CLGlCQUFpQixFQUFFO29CQUNqQixlQUFlLEVBQUU7d0JBQ2YsU0FBUyxFQUFFLEtBQUs7d0JBQ2hCLFdBQVcsRUFBRSxFQUFFO3dCQUNmLE1BQU0sRUFBRSw2QkFBNkI7cUJBQ3RDO29CQUNELGFBQWEsRUFBRTt3QkFDYixPQUFPLEVBQUU7NEJBQ1AsRUFBRSxTQUFTLEVBQUUsQ0FBQyxFQUFFLE1BQU0sRUFBRSxDQUFFLEtBQUssRUFBRSxlQUFlLEVBQUUsV0FBVyxFQUFFLFlBQVksRUFBRSxVQUFVLEVBQUUsVUFBVSxFQUFFLFNBQVMsRUFBRSxPQUFPLENBQUUsRUFBRTt5QkFDNUg7cUJBQ0Y7b0JBQ0QsZ0JBQWdCLEVBQUU7d0JBQ2hCLEVBQUUsSUFBSSxF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VTs0QkFDckIsVUFBVSxFQUFFLElBQUk7NEJBQ2hCLFlBQVksRUFBRSxJQUFJOzRCQUNsQixZQUFZLEVBQUU7Z0NBQ1osZUFBZSxFQUFFLElBQUk7Z0NBQ3JCLGtCQUFrQixFQUFFLENBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLENBQUU7Z0NBQ3hDLFVBQVUsRUFBRSxVQUFVOzZCQUN2Qjt5QkFDRjt3QkFDRDs0QkFDRSxJQUFJLEVBQUUsYUFBYTs0QkFDbkIsU0FBUyxFQUFFLFlBQVk7NEJBQ3ZCLEVBQUUsRUFBRSxZQUFZOzRCQUNoQixTQUFTLEVBQUUsVUFBVTs0QkFDckIsVUFBVSxFQUFFLElBQUk7NEJBQ2hCLFlBQVksRUFBRSxJQUFJOzRCQUNsQixZQUFZLEVBQUU7Z0NBQ1osZUFBZSxFQUFFLElBQUk7Z0NBQ3JCLGtCQUFrQixFQUFFLENBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLENBQUU7Z0NBQ3hDLFVBQVUsRUFBRSxVQUFVOzZCQUN2Qjt5QkFDRjtxQkFDRjtpQkFDRjthQUNGO1NBQ0Y7S0FDRjtDQUNGLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBY2NvcmRpb25QYWdlQ29uZmlnIH0gZnJvbSBcIi4uLy4uLy4uL3VpLWNvbmZpZy1nZW5cIjtcblxuZXhwb3J0IGNvbnN0IG1laWxpU2VhcmNoQmF0Y2hEZXRhaWxQYWdlOiBBY2NvcmRpb25QYWdlQ29uZmlnID0ge1xuICBwYWdlVGl0bGU6IFwiTWVpbGlTZWFyY2ggQmF0Y2ggRGV0YWlsXCIsXG4gIHBhZ2VUeXBlOiBcImFjY29yZGlvblwiLFxuICByb3V0ZVBhdHRlcm46IFwiL3N5c3RlbS9zZWFyY2gvYmF0Y2hlcy86dWlkXCIsXG4gIGJyZWFkY3J1bWJzOiBbXG4gICAgeyBsYWJlbDogXCJIb21lXCIsIHVybDogXCIvXCIgfSxcbiAgICB7IGxhYmVsOiBcIlNlYXJjaFwiLCB1cmw6IFwiL3N5c3RlbS9zZWFyY2hcIiB9LFxuICAgIHsgbGFiZWw6IFwiQmF0Y2hlc1wiLCB1cmw6IFwiL3N5c3RlbS9zZWFyY2gvYmF0Y2hlc1wiIH0sXG4gICAgeyBsYWJlbDogXCJCYXRjaCBEZXRhaWxcIiB9XG4gIF0sXG4gIGFjY29yZGlvblBhZ2VDb25maWc6IHtcbiAgICBhY2NvcmRpb25zOiB7XG4gICAgICBcImJhdGNoRGV0YWlsc1wiOiB7XG4gICAgICAgIHBhZ2VUaXRsZTogXCJCYXRjaCBEZXRhaWxzXCIsXG4gICAgICAgIHBhZ2VUeXBlOiBcImRldGFpbHNcIixcbiAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICBkZXRhaWxBcGlDb25maWc6IHsgXG4gICAgICAgICAgICBhcGlNZXRob2Q6IFwiR0VUXCIsIFxuICAgICAgICAgICAgcmVzcG9uc2VLZXk6IFwiXCIsIFxuICAgICAgICAgICAgYXBpVXJsOiBcIi9zeXN0ZW0vc2VhcmNoL2JhdGNoZXMvOnVpZFwiIFxuICAgICAgICAgIH0sXG4gICAgICAgICAgY29sdW1uc0NvbmZpZzoge1xuICAgICAgICAgICAgY29sdW1uczogW1xuICAgICAgICAgICAgICB7IHNvcnRPcmRlcjogMSwgZmllbGRzOiBbIFwidWlkXCIsIFwiYmF0Y2hTdHJhdGVneVwiLCBcInN0YXJ0ZWRBdFwiLCBcImZpbmlzaGVkQXRcIiwgXCJkdXJhdGlvblwiLCBcInByb2dyZXNzXCIsIFwiZGV0YWlsc1wiLCBcInN0YXRzXCIgXSB9LFxuICAgICAgICAgICAgXVxuICAgICAgICAgIH0sXG4gICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAgeyBuYW1lOiBcInVpZFwiLCBsYWJlbDogXCJVSURcIiwgaWQ6IFwidWlkXCIsIGNvbHVtbjogXCJ1aWRcIiwgZmllbGRUeXBlOiBcIm51bWJlclwiIH0sXG4gICAgICAgICAgICB7IG5hbWU6IFwiYmF0Y2hTdHJhdGVneVwiLCBsYWJlbDogXCJCYXRjaCBTdHJhdGVneVwiLCBpZDogXCJiYXRjaFN0cmF0ZWd5XCIsIGNvbHVtbjogXCJiYXRjaFN0cmF0ZWd5XCIsIGZpZWxkVHlwZTogXCJ0ZXh0XCIgfSxcbiAgICAgICAgICAgIHsgbmFtZTogXCJzdGFydGVkQXRcIiwgbGFiZWw6IFwiU3RhcnRlZCBBdFwiLCBpZDogXCJzdGFydGVkQXRcIiwgY29sdW1uOiBcInN0YXJ0ZWRBdFwiLCBmaWVsZFR5cGU6IFwiZGF0ZXRpbWVcIiB9LFxuICAgICAgICAgICAgeyBuYW1lOiBcImZpbmlzaGVkQXRcIiwgbGFiZWw6IFwiRmluaXNoZWQgQXRcIiwgaWQ6IFwiZmluaXNoZWRBdFwiLCBjb2x1bW46IFwiZmluaXNoZWRBdFwiLCBmaWVsZFR5cGU6IFwiZGF0ZXRpbWVcIiB9LFxuICAgICAgICAgICAgeyBuYW1lOiBcImR1cmF0aW9uXCIsIGxhYmVsOiBcIkR1cmF0aW9uXCIsIGlkOiBcImR1cmF0aW9uXCIsIGNvbHVtbjogXCJkdXJhdGlvblwiLCBmaWVsZFR5cGU6IFwidGV4dFwiIH0sXG4gICAgICAgICAgICB7IG5hbWU6IFwic3RhdHNcIiwgbGFiZWw6IFwiU3RhdHNcIiwgaWQ6IFwic3RhdHNcIiwgY29sdW1uOiBcInN0YXRzXCIsIGZpZWxkVHlwZTogXCJqc29uXCIgfSxcbiAgICAgICAgICAgIHsgbmFtZTogXCJwcm9ncmVzc1wiLCBsYWJlbDogXCJQcm9ncmVzc1wiLCBpZDogXCJwcm9ncmVzc1wiLCBjb2x1bW46IFwicHJvZ3Jlc3NcIiwgZmllbGRUeXBlOiBcImpzb25cIiB9LFxuICAgICAgICAgICAgeyBuYW1lOiBcImRldGFpbHNcIiwgbGFiZWw6IFwiRGV0YWlsc1wiLCBpZDogXCJkZXRhaWxzXCIsIGNvbHVtbjogXCJkZXRhaWxzXCIsIGZpZWxkVHlwZTogXCJqc29uXCIgfVxuICAgICAgICAgIF1cbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIFwiYmF0Y2hUYXNrc1wiOiB7XG4gICAgICAgIHBhZ2VUaXRsZTogXCJCYXRjaCBUYXNrc1wiLFxuICAgICAgICBwYWdlVHlwZTogXCJsaXN0XCIsXG4gICAgICAgIGxpc3RQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgYXBpQ29uZmlnOiB7XG4gICAgICAgICAgICBhcGlNZXRob2Q6IFwiR0VUXCIsXG4gICAgICAgICAgICByZXNwb25zZUtleTogXCJpdGVtc1wiLFxuICAgICAgICAgICAgYXBpVXJsOiBcIi9zeXN0ZW0vc2VhcmNoL3Rhc2tzP2JhdGNoVWlkLmVxPTp1aWRcIlxuICAgICAgICAgIH0sXG4gICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBuYW1lOiBcIlRhc2sgVUlEXCIsXG4gICAgICAgICAgICAgIGRhdGFJbmRleDogXCJ1aWRcIixcbiAgICAgICAgICAgICAgaWQ6IFwidWlkXCIsXG4gICAgICAgICAgICAgIGZpZWxkVHlwZTogXCJudW1iZXJcIixcbiAgICAgICAgICAgICAgaXNMaXN0YWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICBpc0lkZW50aWZpZXI6IHRydWUsXG4gICAgICAgICAgICAgIGZpbHRlckNvbmZpZzoge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogXCJlcVwiLFxuICAgICAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogWyBcImVxXCIsIFwiaW5cIiwgXCJuaW5cIiBdLFxuICAgICAgICAgICAgICAgIGZpbHRlclR5cGU6IFwibnVtYmVyXCJcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgIHsgaWNvbjogXCJ2aWV3XCIsIGxhYmVsOiBcIkRldGFpbHNcIiwgdXJsOiBcIi9zeXN0ZW0vc2VhcmNoL3Rhc2tzLzp1aWRcIiB9XG4gICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIG5hbWU6IFwiSW5kZXggVUlEXCIsXG4gICAgICAgICAgICAgIGRhdGFJbmRleDogXCJpbmRleFVpZFwiLFxuICAgICAgICAgICAgICBpZDogXCJpbmRleFVpZFwiLFxuICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwidGV4dFwiLFxuICAgICAgICAgICAgICBpc0xpc3RhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAgICAgICAgIGZpbHRlckNvbmZpZzoge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogXCJlcVwiLFxuICAgICAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogWyBcImVxXCIsIFwiaW5cIiwgXCJuaW5cIiBdLFxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBuYW1lOiBcIlN0YXR1c1wiLFxuICAgICAgICAgICAgICBkYXRhSW5kZXg6IFwic3RhdHVzXCIsXG4gICAgICAgICAgICAgIGlkOiBcInN0YXR1c1wiLFxuICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwidGV4dFwiLFxuICAgICAgICAgICAgICBpc0xpc3RhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAgICAgICAgIGZpbHRlckNvbmZpZzoge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogXCJlcVwiLFxuICAgICAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogWyBcImVxXCIsIFwiaW5cIiwgXCJuaW5cIiBdLFxuICAgICAgICAgICAgICAgIHByZWRlZmluZWRPcHRpb25zOiBbXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIkVucXVldWVkXCIsIHZhbHVlOiBcImVucXVldWVkXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiUHJvY2Vzc2luZ1wiLCB2YWx1ZTogXCJwcm9jZXNzaW5nXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiU3VjY2VlZGVkXCIsIHZhbHVlOiBcInN1Y2NlZWRlZFwiIH0sXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIkZhaWxlZFwiLCB2YWx1ZTogXCJmYWlsZWRcIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJDYW5jZWxlZFwiLCB2YWx1ZTogXCJjYW5jZWxlZFwiIH1cbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIGZpbHRlclR5cGU6IFwic2VsZWN0XCJcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgbmFtZTogXCJUeXBlXCIsXG4gICAgICAgICAgICAgIGRhdGFJbmRleDogXCJ0eXBlXCIsXG4gICAgICAgICAgICAgIGlkOiBcInR5cGVcIixcbiAgICAgICAgICAgICAgZmllbGRUeXBlOiBcInRleHRcIixcbiAgICAgICAgICAgICAgaXNMaXN0YWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICBmaWx0ZXJDb25maWc6IHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IFwiZXFcIixcbiAgICAgICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IFsgXCJlcVwiLCBcImluXCIsIFwibmluXCIgXSxcbiAgICAgICAgICAgICAgICBwcmVkZWZpbmVkT3B0aW9uczogW1xuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJEb2N1bWVudCBBZGRpdGlvbi9VcGRhdGVcIiwgdmFsdWU6IFwiZG9jdW1lbnRBZGRpdGlvbk9yVXBkYXRlXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiRG9jdW1lbnQgRWRpdGlvblwiLCB2YWx1ZTogXCJkb2N1bWVudEVkaXRpb25cIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJEb2N1bWVudCBEZWxldGlvblwiLCB2YWx1ZTogXCJkb2N1bWVudERlbGV0aW9uXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiU2V0dGluZ3MgVXBkYXRlXCIsIHZhbHVlOiBcInNldHRpbmdzVXBkYXRlXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiSW5kZXggQ3JlYXRpb25cIiwgdmFsdWU6IFwiaW5kZXhDcmVhdGlvblwiIH0sXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIkluZGV4IERlbGV0aW9uXCIsIHZhbHVlOiBcImluZGV4RGVsZXRpb25cIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJJbmRleCBVcGRhdGVcIiwgdmFsdWU6IFwiaW5kZXhVcGRhdGVcIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJJbmRleCBTd2FwXCIsIHZhbHVlOiBcImluZGV4U3dhcFwiIH0sXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIlRhc2sgQ2FuY2VsbGF0aW9uXCIsIHZhbHVlOiBcInRhc2tDYW5jZWxhdGlvblwiIH0sXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIlRhc2sgRGVsZXRpb25cIiwgdmFsdWU6IFwidGFza0RlbGV0aW9uXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiRHVtcCBDcmVhdGlvblwiLCB2YWx1ZTogXCJkdW1wQ3JlYXRpb25cIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJTbmFwc2hvdCBDcmVhdGlvblwiLCB2YWx1ZTogXCJzbmFwc2hvdENyZWF0aW9uXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiRGF0YWJhc2UgVXBncmFkZVwiLCB2YWx1ZTogXCJ1cGdyYWRlRGF0YWJhc2VcIiB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBmaWx0ZXJUeXBlOiBcInNlbGVjdFwiXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIG5hbWU6IFwiRW5xdWV1ZWQgQXRcIixcbiAgICAgICAgICAgICAgZGF0YUluZGV4OiBcImVucXVldWVkQXRcIixcbiAgICAgICAgICAgICAgaWQ6IFwiZW5xdWV1ZWRBdFwiLFxuICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwiZGF0ZXRpbWVcIixcbiAgICAgICAgICAgICAgaXNMaXN0YWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICBmaWx0ZXJDb25maWc6IHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IFwiZ3RcIixcbiAgICAgICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IFsgXCJndFwiLCBcImx0XCIsIFwiZXFcIiBdLFxuICAgICAgICAgICAgICAgIGZpbHRlclR5cGU6IFwiZGF0ZXRpbWVcIlxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBuYW1lOiBcIlN0YXJ0ZWQgQXRcIixcbiAgICAgICAgICAgICAgZGF0YUluZGV4OiBcInN0YXJ0ZWRBdFwiLFxuICAgICAgICAgICAgICBpZDogXCJzdGFydGVkQXRcIixcbiAgICAgICAgICAgICAgZmllbGRUeXBlOiBcImRhdGV0aW1lXCIsXG4gICAgICAgICAgICAgIGlzTGlzdGFibGU6IHRydWUsXG4gICAgICAgICAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgZmlsdGVyQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBcImd0XCIsXG4gICAgICAgICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBbIFwiZ3RcIiwgXCJsdFwiLCBcImVxXCIgXSxcbiAgICAgICAgICAgICAgICBmaWx0ZXJUeXBlOiBcImRhdGV0aW1lXCJcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgbmFtZTogXCJGaW5pc2hlZCBBdFwiLFxuICAgICAgICAgICAgICBkYXRhSW5kZXg6IFwiZmluaXNoZWRBdFwiLFxuICAgICAgICAgICAgICBpZDogXCJmaW5pc2hlZEF0XCIsXG4gICAgICAgICAgICAgIGZpZWxkVHlwZTogXCJkYXRldGltZVwiLFxuICAgICAgICAgICAgICBpc0xpc3RhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAgICAgICAgIGZpbHRlckNvbmZpZzoge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogXCJndFwiLFxuICAgICAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogWyBcImd0XCIsIFwibHRcIiwgXCJlcVwiIF0sXG4gICAgICAgICAgICAgICAgZmlsdGVyVHlwZTogXCJkYXRldGltZVwiXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICBdXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cbn07Il19
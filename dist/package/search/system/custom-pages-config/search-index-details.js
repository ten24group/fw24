"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchIndexDetailsConfig = void 0;
exports.searchIndexDetailsConfig = {
    pageTitle: "Search Index Details",
    pageType: "accordion",
    routePattern: "/system/search/indices/:entityName",
    breadcrumbs: [
        { label: "Home", url: "/" },
        { label: "Search", url: "/system/search" },
        { label: "Indices", url: "/system/search/indices" },
        { label: "Index Details" }
    ],
    pageHeaderActions: [
        { label: "View Settings", url: "/system/search/indices/:entityName/settings-details", type: "button" },
        {
            label: "Resync Records",
            openInModal: true,
            modalConfig: {
                modalType: "confirm",
                modalPageConfig: {
                    title: "Re-sync All Records",
                    content: "This will re-sync all records from the database to the search index. This may take some time."
                },
                apiConfig: {
                    apiMethod: "POST",
                    apiUrl: "/system/search/indices/:entityName/resync"
                },
                submitSuccessRedirect: "/system/search/indices/:entityName"
            }
        },
        {
            label: "Clear Documents",
            openInModal: true,
            modalConfig: {
                modalType: "confirm",
                modalPageConfig: {
                    title: "Clear All Documents",
                    content: "This will remove all documents from the search index. This action cannot be undone."
                },
                apiConfig: {
                    apiMethod: "DELETE",
                    apiUrl: "/system/search/indices/:entityName/documents"
                },
                submitSuccessRedirect: "/system/search/indices/:entityName"
            }
        },
        {
            label: "Delete Index",
            openInModal: true,
            modalConfig: {
                modalType: "confirm",
                modalPageConfig: {
                    title: "Delete Index",
                    content: "This will permanently delete the search index and all its data. This action cannot be undone."
                },
                apiConfig: {
                    apiMethod: "DELETE",
                    apiUrl: "/system/search/indices/:entityName"
                },
                submitSuccessRedirect: "/system/search/indices"
            }
        }
    ],
    accordionPageConfig: {
        accordions: {
            "indexDetails": {
                pageTitle: "Index Details",
                pageType: "details",
                detailsPageConfig: {
                    detailApiConfig: { apiMethod: "GET", responseKey: "details", apiUrl: "/system/search/indices/:entityName" },
                    columnsConfig: {
                        columns: [
                            { sortOrder: 1, fields: ["entityName", "indexInfo"] },
                            { sortOrder: 2, fields: ["indexStats"] }
                        ]
                    },
                    propertiesConfig: [
                        { name: "entityName", label: "Entity Name", id: "entityName", column: "entityName", fieldType: "text" },
                        // Index Info
                        { name: "indexInfo", label: "Index Info", id: "indexInfo", column: "indexInfo", fieldType: "json" },
                        // Index Stats
                        { name: "indexStats", label: "Index Stats", id: "indexStats", column: "indexStats", fieldType: "json" },
                    ]
                }
            },
            "indexTasks": {
                pageTitle: "Index Tasks",
                pageType: "list",
                listPageConfig: {
                    apiConfig: {
                        apiMethod: "GET",
                        responseKey: "items",
                        apiUrl: "/system/search/tasks?entityName.eq=:entityName"
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
            },
            "indexBatches": {
                pageTitle: "Index Batches",
                pageType: "list",
                listPageConfig: {
                    apiConfig: {
                        apiMethod: "GET",
                        responseKey: "items",
                        apiUrl: "/system/search/batches?entityName.eq=:entityName"
                    },
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
            },
            "indexDocuments": {
                pageTitle: "Index Documents",
                pageType: "list",
                listPageConfig: {
                    apiConfig: {
                        apiMethod: "GET",
                        useSearch: true,
                        responseKey: "items",
                        apiUrl: "/system/search/records/:entityName"
                    },
                    propertiesConfig: [
                        {
                            id: "id",
                            name: "ID",
                            dataIndex: "id",
                            fieldType: "text",
                            isListable: true,
                            isSortable: false,
                            isFilterable: false,
                            isIdentifier: true,
                            actions: [
                                { icon: "view", label: "View Details", url: "/system/search/records/:entityName/:id" }
                            ]
                        },
                        {
                            name: "Full Record",
                            dataIndex: "fullRecord",
                            id: "fullRecord",
                            isSortable: false,
                            isFilterable: false,
                            fieldType: "json",
                            isListable: true
                        }
                    ]
                }
            }
        }
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VhcmNoLWluZGV4LWRldGFpbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvc2VhcmNoL3N5c3RlbS9jdXN0b20tcGFnZXMtY29uZmlnL3NlYXJjaC1pbmRleC1kZXRhaWxzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVhLFFBQUEsd0JBQXdCLEdBQXdCO0lBQzNELFNBQVMsRUFBRSxzQkFBc0I7SUFDakMsUUFBUSxFQUFFLFdBQVc7SUFDckIsWUFBWSxFQUFFLG9DQUFvQztJQUNsRCxXQUFXLEVBQUU7UUFDWCxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRTtRQUMzQixFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLGdCQUFnQixFQUFFO1FBQzFDLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRSxHQUFHLEVBQUUsd0JBQXdCLEVBQUU7UUFDbkQsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFO0tBQzNCO0lBQ0QsaUJBQWlCLEVBQUU7UUFDakIsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFLEdBQUcsRUFBRSxxREFBcUQsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFO1FBQ3RHO1lBQ0UsS0FBSyxFQUFFLGdCQUFnQjtZQUN2QixXQUFXLEVBQUUsSUFBSTtZQUNqQixXQUFXLEVBQUU7Z0JBQ1gsU0FBUyxFQUFFLFNBQVM7Z0JBQ3BCLGVBQWUsRUFBRTtvQkFDZixLQUFLLEVBQUUscUJBQXFCO29CQUM1QixPQUFPLEVBQUUsK0ZBQStGO2lCQUN6RztnQkFDRCxTQUFTLEVBQUU7b0JBQ1QsU0FBUyxFQUFFLE1BQU07b0JBQ2pCLE1BQU0sRUFBRSwyQ0FBMkM7aUJBQ3BEO2dCQUNELHFCQUFxQixFQUFFLG9DQUFvQzthQUM1RDtTQUNGO1FBQ0Q7WUFDRSxLQUFLLEVBQUUsaUJBQWlCO1lBQ3hCLFdBQVcsRUFBRSxJQUFJO1lBQ2pCLFdBQVcsRUFBRTtnQkFDWCxT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RUFBRSxJQUFJO3dCQUNmLFdBQVcsRUFBRSxPQUFPO3dCQUNwQixNQUFNLEVBQUUsb0NBQW9DO3FCQUM3QztvQkFDRCxnQkFBZ0IsRUFBRTt3QkFDaEI7NEJBQ0UsRUFBRSxFQUFFLElBQUk7NEJBQ1IsSUFBSSxFQUFFLElBQUk7NEJBQ1YsU0FBUyxFQUFFLElBQUk7NEJBQ2YsU0FBUyxFQUFFLE1BQU07NEJBQ2pCLFVBQVUsRUFBRSxJQUFJOzRCQUNoQixVQUFVLEVBQUUsS0FBSzs0QkFDakIsWUFBWSxFQUFFLEtBQUs7NEJBQ25CLFlBQVksRUFBRSxJQUFJOzRCQUNsQixPQUFPLEVBQUU7Z0NBQ1AsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxjQUFjLEVBQUUsR0FBRyxFQUFFLHdDQUF3QyxFQUFFOzZCQUN2Rjt5QkFDRjt3QkFDRDs0QkFDRSxJQUFJLEVBQUUsYUFBYTs0QkFDbkIsU0FBUyxFQUFFLFlBQVk7NEJBQ3ZCLEVBQUUsRUFBRSxZQUFZOzRCQUNoQixVQUFVLEVBQUUsS0FBSzs0QkFDakIsWUFBWSxFQUFFLEtBQUs7NEJBQ25CLFNBQVMsRUFBRSxNQUFNOzRCQUNqQixVQUFVLEVBQUUsSUFBSTt5QkFDakI7cUJBQ0Y7aUJBQ0Y7YUFDRjtTQUNGO0tBQ0Y7Q0FDRixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQWNjb3JkaW9uUGFnZUNvbmZpZyB9IGZyb20gXCIuLi8uLi8uLi91aS1jb25maWctZ2VuXCI7XG5cbmV4cG9ydCBjb25zdCBzZWFyY2hJbmRleERldGFpbHNDb25maWc6IEFjY29yZGlvblBhZ2VDb25maWcgPSB7XG4gIHBhZ2VUaXRsZTogXCJTZWFyY2ggSW5kZXggRGV0YWlsc1wiLFxuICBwYWdlVHlwZTogXCJhY2NvcmRpb25cIixcbiAgcm91dGVQYXR0ZXJuOiBcIi9zeXN0ZW0vc2VhcmNoL2luZGljZXMvOmVudGl0eU5hbWVcIixcbiAgYnJlYWRjcnVtYnM6IFtcbiAgICB7IGxhYmVsOiBcIkhvbWVcIiwgdXJsOiBcIi9cIiB9LFxuICAgIHsgbGFiZWw6IFwiU2VhcmNoXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaFwiIH0sXG4gICAgeyBsYWJlbDogXCJJbmRpY2VzXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaC9pbmRpY2VzXCIgfSxcbiAgICB7IGxhYmVsOiBcIkluZGV4IERldGFpbHNcIiB9XG4gIF0sXG4gIHBhZ2VIZWFkZXJBY3Rpb25zOiBbXG4gICAgeyBsYWJlbDogXCJWaWV3IFNldHRpbmdzXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaC9pbmRpY2VzLzplbnRpdHlOYW1lL3NldHRpbmdzLWRldGFpbHNcIiwgdHlwZTogXCJidXR0b25cIiB9LFxuICAgIHsgXG4gICAgICBsYWJlbDogXCJSZXN5bmMgUmVjb3Jkc1wiLCBcbiAgICAgIG9wZW5Jbk1vZGFsOiB0cnVlLFxuICAgICAgbW9kYWxDb25maWc6IHtcbiAgICAgICAgbW9kYWxUeXBlOiBcImNvbmZpcm1cIixcbiAgICAgICAgbW9kYWxQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgdGl0bGU6IFwiUmUtc3luYyBBbGwgUmVjb3Jkc1wiLFxuICAgICAgICAgIGNvbnRlbnQ6IFwiVGhpcyB3aWxsIHJlLXN5bmMgYWxsIHJlY29yZHMgZnJvbSB0aGUgZGF0YWJhc2UgdG8gdGhlIHNlYXJjaCBpbmRleC4gVGhpcyBtYXkgdGFrZSBzb21lIHRpbWUuXCJcbiAgICAgICAgfSxcbiAgICAgICAgYXBpQ29uZmlnOiB7XG4gICAgICAgICAgYXBpTWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgICBhcGlVcmw6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlcy86ZW50aXR5TmFtZS9yZXN5bmNcIlxuICAgICAgICB9LFxuICAgICAgICBzdWJtaXRTdWNjZXNzUmVkaXJlY3Q6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlcy86ZW50aXR5TmFtZVwiXG4gICAgICB9XG4gICAgfSxcbiAgICB7IFxuICAgICAgbGFiZWw6IFwiQ2xlYXIgRG9jdW1lbnRzXCIsIFxuICAgICAgb3BlbkluTW9kYWw6IHRydWUsXG4gICAgICBtb2RhbENvbmZpZzoge1xuICAgICAgICBtb2RhbFR5cGU6IFwiY29uZmlybVwiLFxuICAgICAgICBtb2RhbFBhZ2VDb25maWc6IHtcbiAgICAgICAgICB0aXRsZTogXCJDbGVhciBBbGwgRG9jdW1lbnRzXCIsXG4gICAgICAgICAgY29udGVudDogXCJUaGlzIHdpbGwgcmVtb3ZlIGFsbCBkb2N1bWVudHMgZnJvbSB0aGUgc2VhcmNoIGluZGV4LiBUaGlzIGFjdGlvbiBjYW5ub3QgYmUgdW5kb25lLlwiXG4gICAgICAgIH0sXG4gICAgICAgIGFwaUNvbmZpZzoge1xuICAgICAgICAgIGFwaU1ldGhvZDogXCJERUxFVEVcIixcbiAgICAgICAgICBhcGlVcmw6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlcy86ZW50aXR5TmFtZS9kb2N1bWVudHNcIlxuICAgICAgICB9LFxuICAgICAgICBzdWJtaXRTdWNjZXNzUmVkaXJlY3Q6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlcy86ZW50aXR5TmFtZVwiXG4gICAgICB9XG4gICAgfSxcbiAgICB7IFxuICAgICAgbGFiZWw6IFwiRGVsZXRlIEluZGV4XCIsIFxuICAgICAgb3BlbkluTW9kYWw6IHRydWUsXG4gICAgICBtb2RhbENvbmZpZzoge1xuICAgICAgICBtb2RhbFR5cGU6IFwiY29uZmlybVwiLFxuICAgICAgICBtb2RhbFBhZ2VDb25maWc6IHtcbiAgICAgICAgICB0aXRsZTogXCJEZWxldGUgSW5kZXhcIixcbiAgICAgICAgICBjb250ZW50OiBcIlRoaXMgd2lsbCBwZXJtYW5lbnRseSBkZWxldGUgdGhlIHNlYXJjaCBpbmRleCBhbmQgYWxsIGl0cyBkYXRhLiBUaGlzIGFjdGlvbiBjYW5ub3QgYmUgdW5kb25lLlwiXG4gICAgICAgIH0sXG4gICAgICAgIGFwaUNvbmZpZzoge1xuICAgICAgICAgIGFwaU1ldGhvZDogXCJERUxFVEVcIixcbiAgICAgICAgICBhcGlVcmw6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlcy86ZW50aXR5TmFtZVwiXG4gICAgICAgIH0sXG4gICAgICAgIHN1Ym1pdFN1Y2Nlc3NSZWRpcmVjdDogXCIvc3lzdGVtL3NlYXJjaC9pbmRpY2VzXCJcbiAgICAgIH1cbiAgICB9XG4gIF0sXG4gIGFjY29yZGlvblBhZ2VDb25maWc6IHtcbiAgICBhY2NvcmRpb25zOiB7XG4gICAgICBcImluZGV4RGV0YWlsc1wiOiB7XG4gICAgICAgIHBhZ2VUaXRsZTogXCJJbmRleCBEZXRhaWxzXCIsXG4gICAgICAgIHBhZ2VUeXBlOiBcImRldGFpbHNcIixcbiAgICAgICAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICAgICAgICBkZXRhaWxBcGlDb25maWc6IHsgYXBpTWV0aG9kOiBcIkdFVFwiLCByZXNwb25zZUtleTogXCJkZXRhaWxzXCIsIGFwaVVybDogXCIvc3lzdGVtL3NlYXJjaC9pbmRpY2VzLzplbnRpdHlOYW1lXCIgfSxcbiAgICAgICAgICBjb2x1bW5zQ29uZmlnOiB7XG4gICAgICAgICAgICBjb2x1bW5zOiBbXG4gICAgICAgICAgICAgIHsgc29ydE9yZGVyOiAxLCBmaWVsZHM6IFsgXCJlbnRpdHlOYW1lXCIsIFwiaW5kZXhJbmZvXCIgXSB9LFxuICAgICAgICAgICAgICB7IHNvcnRPcmRlcjogMiwgZmllbGRzOiBbIFwiaW5kZXhTdGF0c1wiIF0gfVxuICAgICAgICAgICAgXVxuICAgICAgICAgIH0sXG4gICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAgeyBuYW1lOiBcImVudGl0eU5hbWVcIiwgbGFiZWw6IFwiRW50aXR5IE5hbWVcIiwgaWQ6IFwiZW50aXR5TmFtZVwiLCBjb2x1bW46IFwiZW50aXR5TmFtZVwiLCBmaWVsZFR5cGU6IFwidGV4dFwiIH0sXG4gICAgICAgICAgICAvLyBJbmRleCBJbmZvXG4gICAgICAgICAgICB7IG5hbWU6IFwiaW5kZXhJbmZvXCIsIGxhYmVsOiBcIkluZGV4IEluZm9cIiwgaWQ6IFwiaW5kZXhJbmZvXCIsIGNvbHVtbjogXCJpbmRleEluZm9cIiwgZmllbGRUeXBlOiBcImpzb25cIiB9LFxuICAgICAgICAgICAgLy8gSW5kZXggU3RhdHNcbiAgICAgICAgICAgIHsgbmFtZTogXCJpbmRleFN0YXRzXCIsIGxhYmVsOiBcIkluZGV4IFN0YXRzXCIsIGlkOiBcImluZGV4U3RhdHNcIiwgY29sdW1uOiBcImluZGV4U3RhdHNcIiwgZmllbGRUeXBlOiBcImpzb25cIiB9LFxuICAgICAgICAgIF1cbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIFwiaW5kZXhUYXNrc1wiOiB7XG4gICAgICAgIHBhZ2VUaXRsZTogXCJJbmRleCBUYXNrc1wiLFxuICAgICAgICBwYWdlVHlwZTogXCJsaXN0XCIsXG4gICAgICAgIGxpc3RQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgYXBpQ29uZmlnOiB7XG4gICAgICAgICAgICBhcGlNZXRob2Q6IFwiR0VUXCIsXG4gICAgICAgICAgICByZXNwb25zZUtleTogXCJpdGVtc1wiLFxuICAgICAgICAgICAgYXBpVXJsOiBcIi9zeXN0ZW0vc2VhcmNoL3Rhc2tzP2VudGl0eU5hbWUuZXE9OmVudGl0eU5hbWVcIlxuICAgICAgICAgIH0sXG4gICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBuYW1lOiBcIlRhc2sgVUlEXCIsXG4gICAgICAgICAgICAgIGRhdGFJbmRleDogXCJ1aWRcIixcbiAgICAgICAgICAgICAgaWQ6IFwidWlkXCIsXG4gICAgICAgICAgICAgIGZpZWxkVHlwZTogXCJudW1iZXJcIixcbiAgICAgICAgICAgICAgaXNMaXN0YWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICBpc0lkZW50aWZpZXI6IHRydWUsXG4gICAgICAgICAgICAgIGZpbHRlckNvbmZpZzoge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogXCJlcVwiLFxuICAgICAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogWyBcImVxXCIsIFwiaW5cIiwgXCJuaW5cIiBdLFxuICAgICAgICAgICAgICAgIGZpbHRlclR5cGU6IFwibnVtYmVyXCJcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgIHsgaWNvbjogXCJ2aWV3XCIsIGxhYmVsOiBcIkRldGFpbHNcIiwgdXJsOiBcIi9zeXN0ZW0vc2VhcmNoL3Rhc2tzLzp1aWRcIiB9XG4gICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIG5hbWU6IFwiU3RhdHVzXCIsXG4gICAgICAgICAgICAgIGRhdGFJbmRleDogXCJzdGF0dXNcIixcbiAgICAgICAgICAgICAgaWQ6IFwic3RhdHVzXCIsXG4gICAgICAgICAgICAgIGZpZWxkVHlwZTogXCJ0ZXh0XCIsXG4gICAgICAgICAgICAgIGlzTGlzdGFibGU6IHRydWUsXG4gICAgICAgICAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgZmlsdGVyQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBcImVxXCIsXG4gICAgICAgICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBbIFwiZXFcIiwgXCJpblwiLCBcIm5pblwiIF0sXG4gICAgICAgICAgICAgICAgcHJlZGVmaW5lZE9wdGlvbnM6IFtcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiRW5xdWV1ZWRcIiwgdmFsdWU6IFwiZW5xdWV1ZWRcIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJQcm9jZXNzaW5nXCIsIHZhbHVlOiBcInByb2Nlc3NpbmdcIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJTdWNjZWVkZWRcIiwgdmFsdWU6IFwic3VjY2VlZGVkXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiRmFpbGVkXCIsIHZhbHVlOiBcImZhaWxlZFwiIH0sXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIkNhbmNlbGVkXCIsIHZhbHVlOiBcImNhbmNlbGVkXCIgfVxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgZmlsdGVyVHlwZTogXCJzZWxlY3RcIlxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBuYW1lOiBcIlR5cGVcIixcbiAgICAgICAgICAgICAgZGF0YUluZGV4OiBcInR5cGVcIixcbiAgICAgICAgICAgICAgaWQ6IFwidHlwZVwiLFxuICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwidGV4dFwiLFxuICAgICAgICAgICAgICBpc0xpc3RhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAgICAgICAgIGZpbHRlckNvbmZpZzoge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogXCJlcVwiLFxuICAgICAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogWyBcImVxXCIsIFwiaW5cIiwgXCJuaW5cIiBdLFxuICAgICAgICAgICAgICAgIHByZWRlZmluZWRPcHRpb25zOiBbXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIkRvY3VtZW50IEFkZGl0aW9uL1VwZGF0ZVwiLCB2YWx1ZTogXCJkb2N1bWVudEFkZGl0aW9uT3JVcGRhdGVcIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJEb2N1bWVudCBFZGl0aW9uXCIsIHZhbHVlOiBcImRvY3VtZW50RWRpdGlvblwiIH0sXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIkRvY3VtZW50IERlbGV0aW9uXCIsIHZhbHVlOiBcImRvY3VtZW50RGVsZXRpb25cIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJTZXR0aW5ncyBVcGRhdGVcIiwgdmFsdWU6IFwic2V0dGluZ3NVcGRhdGVcIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJJbmRleCBDcmVhdGlvblwiLCB2YWx1ZTogXCJpbmRleENyZWF0aW9uXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiSW5kZXggRGVsZXRpb25cIiwgdmFsdWU6IFwiaW5kZXhEZWxldGlvblwiIH0sXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIkluZGV4IFVwZGF0ZVwiLCB2YWx1ZTogXCJpbmRleFVwZGF0ZVwiIH0sXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIkluZGV4IFN3YXBcIiwgdmFsdWU6IFwiaW5kZXhTd2FwXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiVGFzayBDYW5jZWxsYXRpb25cIiwgdmFsdWU6IFwidGFza0NhbmNlbGF0aW9uXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiVGFzayBEZWxldGlvblwiLCB2YWx1ZTogXCJ0YXNrRGVsZXRpb25cIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJEdW1wIENyZWF0aW9uXCIsIHZhbHVlOiBcImR1bXBDcmVhdGlvblwiIH0sXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIlNuYXBzaG90IENyZWF0aW9uXCIsIHZhbHVlOiBcInNuYXBzaG90Q3JlYXRpb25cIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJEYXRhYmFzZSBVcGdyYWRlXCIsIHZhbHVlOiBcInVwZ3JhZGVEYXRhYmFzZVwiIH1cbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIGZpbHRlclR5cGU6IFwic2VsZWN0XCJcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgbmFtZTogXCJFbnF1ZXVlZCBBdFwiLFxuICAgICAgICAgICAgICBkYXRhSW5kZXg6IFwiZW5xdWV1ZWRBdFwiLFxuICAgICAgICAgICAgICBpZDogXCJlbnF1ZXVlZEF0XCIsXG4gICAgICAgICAgICAgIGZpZWxkVHlwZTogXCJkYXRldGltZVwiLFxuICAgICAgICAgICAgICBpc0xpc3RhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAgICAgICAgIGZpbHRlckNvbmZpZzoge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogXCJndFwiLFxuICAgICAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogWyBcImd0XCIsIFwibHRcIiwgXCJlcVwiIF0sXG4gICAgICAgICAgICAgICAgZmlsdGVyVHlwZTogXCJkYXRldGltZVwiXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIG5hbWU6IFwiU3RhcnRlZCBBdFwiLFxuICAgICAgICAgICAgICBkYXRhSW5kZXg6IFwic3RhcnRlZEF0XCIsXG4gICAgICAgICAgICAgIGlkOiBcInN0YXJ0ZWRBdFwiLFxuICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwiZGF0ZXRpbWVcIixcbiAgICAgICAgICAgICAgaXNMaXN0YWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICBmaWx0ZXJDb25maWc6IHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IFwiZ3RcIixcbiAgICAgICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IFsgXCJndFwiLCBcImx0XCIsIFwiZXFcIiBdLFxuICAgICAgICAgICAgICAgIGZpbHRlclR5cGU6IFwiZGF0ZXRpbWVcIlxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBuYW1lOiBcIkZpbmlzaGVkIEF0XCIsXG4gICAgICAgICAgICAgIGRhdGFJbmRleDogXCJmaW5pc2hlZEF0XCIsXG4gICAgICAgICAgICAgIGlkOiBcImZpbmlzaGVkQXRcIixcbiAgICAgICAgICAgICAgZmllbGRUeXBlOiBcImRhdGV0aW1lXCIsXG4gICAgICAgICAgICAgIGlzTGlzdGFibGU6IHRydWUsXG4gICAgICAgICAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgZmlsdGVyQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBcImd0XCIsXG4gICAgICAgICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBbIFwiZ3RcIiwgXCJsdFwiLCBcImVxXCIgXSxcbiAgICAgICAgICAgICAgICBmaWx0ZXJUeXBlOiBcImRhdGV0aW1lXCJcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIF1cbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIFwiaW5kZXhCYXRjaGVzXCI6IHtcbiAgICAgICAgcGFnZVRpdGxlOiBcIkluZGV4IEJhdGNoZXNcIixcbiAgICAgICAgcGFnZVR5cGU6IFwibGlzdFwiLFxuICAgICAgICBsaXN0UGFnZUNvbmZpZzoge1xuICAgICAgICAgIGFwaUNvbmZpZzoge1xuICAgICAgICAgICAgYXBpTWV0aG9kOiBcIkdFVFwiLFxuICAgICAgICAgICAgcmVzcG9uc2VLZXk6IFwiaXRlbXNcIixcbiAgICAgICAgICAgIGFwaVVybDogXCIvc3lzdGVtL3NlYXJjaC9iYXRjaGVzP2VudGl0eU5hbWUuZXE9OmVudGl0eU5hbWVcIlxuICAgICAgICAgIH0sXG4gICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBuYW1lOiBcIlVJRFwiLFxuICAgICAgICAgICAgICBkYXRhSW5kZXg6IFwidWlkXCIsXG4gICAgICAgICAgICAgIGlkOiBcInVpZFwiLFxuICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwibnVtYmVyXCIsXG4gICAgICAgICAgICAgIGlzTGlzdGFibGU6IHRydWUsXG4gICAgICAgICAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgaXNJZGVudGlmaWVyOiB0cnVlLFxuICAgICAgICAgICAgICBmaWx0ZXJDb25maWc6IHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IFwiZXFcIixcbiAgICAgICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IFsgXCJlcVwiLCBcImluXCIsIFwibmluXCIgXSxcbiAgICAgICAgICAgICAgICBmaWx0ZXJUeXBlOiBcIm51bWJlclwiXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgICB7IGljb246IFwidmlld1wiLCBsYWJlbDogXCJEZXRhaWxzXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaC9iYXRjaGVzLzp1aWRcIiB9XG4gICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIG5hbWU6IFwiVG90YWwgVGFza3NcIixcbiAgICAgICAgICAgICAgZGF0YUluZGV4OiBcInN0YXRzLnRvdGFsTmJUYXNrc1wiLFxuICAgICAgICAgICAgICBpZDogXCJ0b3RhbE5iVGFza3NcIixcbiAgICAgICAgICAgICAgZmllbGRUeXBlOiBcImpzb25cIixcbiAgICAgICAgICAgICAgaXNMaXN0YWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlOiBmYWxzZVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgbmFtZTogXCJTdGF0dXNcIixcbiAgICAgICAgICAgICAgZGF0YUluZGV4OiBcInN0YXR1c1wiLFxuICAgICAgICAgICAgICBpZDogXCJzdGF0dXNcIixcbiAgICAgICAgICAgICAgZmllbGRUeXBlOiBcImpzb25cIixcbiAgICAgICAgICAgICAgaXNMaXN0YWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICBmaWx0ZXJDb25maWc6IHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IFwiZXFcIixcbiAgICAgICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IFsgXCJlcVwiLCBcImluXCIsIFwibmluXCIgXSxcbiAgICAgICAgICAgICAgICBwcmVkZWZpbmVkT3B0aW9uczogW1xuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJFbnF1ZXVlZFwiLCB2YWx1ZTogXCJlbnF1ZXVlZFwiIH0sXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIlByb2Nlc3NpbmdcIiwgdmFsdWU6IFwicHJvY2Vzc2luZ1wiIH0sXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIlN1Y2NlZWRlZFwiLCB2YWx1ZTogXCJzdWNjZWVkZWRcIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJGYWlsZWRcIiwgdmFsdWU6IFwiZmFpbGVkXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiQ2FuY2VsZWRcIiwgdmFsdWU6IFwiY2FuY2VsZWRcIiB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBmaWx0ZXJUeXBlOiBcInNlbGVjdFwiXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIG5hbWU6IFwiVHlwZVwiLFxuICAgICAgICAgICAgICBkYXRhSW5kZXg6IFwidHlwZXNcIixcbiAgICAgICAgICAgICAgaWQ6IFwidHlwZVwiLFxuICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwianNvblwiLFxuICAgICAgICAgICAgICBpc0xpc3RhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAgICAgICAgIGZpbHRlckNvbmZpZzoge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogXCJlcVwiLFxuICAgICAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogWyBcImVxXCIsIFwiaW5cIiwgXCJuaW5cIiBdLFxuICAgICAgICAgICAgICAgIHByZWRlZmluZWRPcHRpb25zOiBbXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIkluZGV4IENyZWF0aW9uXCIsIHZhbHVlOiBcImluZGV4Q3JlYXRpb25cIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJJbmRleCBVcGRhdGVcIiwgdmFsdWU6IFwiaW5kZXhVcGRhdGVcIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJJbmRleCBEZWxldGlvblwiLCB2YWx1ZTogXCJpbmRleERlbGV0aW9uXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiSW5kZXggU3dhcFwiLCB2YWx1ZTogXCJpbmRleFN3YXBcIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJEb2N1bWVudCBBZGRpdGlvbi9VcGRhdGVcIiwgdmFsdWU6IFwiZG9jdW1lbnRBZGRpdGlvbk9yVXBkYXRlXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiRG9jdW1lbnQgRGVsZXRpb25cIiwgdmFsdWU6IFwiZG9jdW1lbnREZWxldGlvblwiIH0sXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIkRvY3VtZW50IEVkaXRpb25cIiwgdmFsdWU6IFwiZG9jdW1lbnRFZGl0aW9uXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiU2V0dGluZ3MgVXBkYXRlXCIsIHZhbHVlOiBcInNldHRpbmdzVXBkYXRlXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiRHVtcCBDcmVhdGlvblwiLCB2YWx1ZTogXCJkdW1wQ3JlYXRpb25cIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJUYXNrIENhbmNlbGF0aW9uXCIsIHZhbHVlOiBcInRhc2tDYW5jZWxhdGlvblwiIH0sXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIlRhc2sgRGVsZXRpb25cIiwgdmFsdWU6IFwidGFza0RlbGV0aW9uXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiRGF0YWJhc2UgVXBncmFkZVwiLCB2YWx1ZTogXCJkYXRhYmFzZVVwZ3JhZGVcIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJTbmFwc2hvdCBDcmVhdGlvblwiLCB2YWx1ZTogXCJzbmFwc2hvdENyZWF0aW9uXCIgfVxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgZmlsdGVyVHlwZTogXCJzZWxlY3RcIlxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBuYW1lOiBcIlN0YXJ0ZWQgQXRcIixcbiAgICAgICAgICAgICAgZGF0YUluZGV4OiBcInN0YXJ0ZWRBdFwiLFxuICAgICAgICAgICAgICBpZDogXCJzdGFydGVkQXRcIixcbiAgICAgICAgICAgICAgZmllbGRUeXBlOiBcImRhdGV0aW1lXCIsXG4gICAgICAgICAgICAgIGlzTGlzdGFibGU6IHRydWUsXG4gICAgICAgICAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgZmlsdGVyQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBcImd0XCIsXG4gICAgICAgICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBbIFwiZ3RcIiwgXCJsdFwiLCBcImVxXCIgXSxcbiAgICAgICAgICAgICAgICBmaWx0ZXJUeXBlOiBcImRhdGV0aW1lXCJcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgbmFtZTogXCJGaW5pc2hlZCBBdFwiLFxuICAgICAgICAgICAgICBkYXRhSW5kZXg6IFwiZmluaXNoZWRBdFwiLFxuICAgICAgICAgICAgICBpZDogXCJmaW5pc2hlZEF0XCIsXG4gICAgICAgICAgICAgIGZpZWxkVHlwZTogXCJkYXRldGltZVwiLFxuICAgICAgICAgICAgICBpc0xpc3RhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAgICAgICAgIGZpbHRlckNvbmZpZzoge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogXCJndFwiLFxuICAgICAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogWyBcImd0XCIsIFwibHRcIiwgXCJlcVwiIF0sXG4gICAgICAgICAgICAgICAgZmlsdGVyVHlwZTogXCJkYXRldGltZVwiXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIG5hbWU6IFwiRHVyYXRpb25cIixcbiAgICAgICAgICAgICAgZGF0YUluZGV4OiBcImR1cmF0aW9uXCIsXG4gICAgICAgICAgICAgIGlkOiBcImR1cmF0aW9uXCIsXG4gICAgICAgICAgICAgIGZpZWxkVHlwZTogXCJ0ZXh0XCIsXG4gICAgICAgICAgICAgIGlzTGlzdGFibGU6IHRydWUsXG4gICAgICAgICAgICAgIGlzRmlsdGVyYWJsZTogZmFsc2VcbiAgICAgICAgICAgIH1cbiAgICAgICAgICBdXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBcImluZGV4RG9jdW1lbnRzXCI6IHtcbiAgICAgICAgcGFnZVRpdGxlOiBcIkluZGV4IERvY3VtZW50c1wiLFxuICAgICAgICBwYWdlVHlwZTogXCJsaXN0XCIsXG4gICAgICAgIGxpc3RQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgYXBpQ29uZmlnOiB7XG4gICAgICAgICAgICBhcGlNZXRob2Q6IFwiR0VUXCIsXG4gICAgICAgICAgICB1c2VTZWFyY2g6IHRydWUsXG4gICAgICAgICAgICByZXNwb25zZUtleTogXCJpdGVtc1wiLFxuICAgICAgICAgICAgYXBpVXJsOiBcIi9zeXN0ZW0vc2VhcmNoL3JlY29yZHMvOmVudGl0eU5hbWVcIlxuICAgICAgICAgIH0sXG4gICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBpZDogXCJpZFwiLFxuICAgICAgICAgICAgICBuYW1lOiBcIklEXCIsXG4gICAgICAgICAgICAgIGRhdGFJbmRleDogXCJpZFwiLFxuICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwidGV4dFwiLFxuICAgICAgICAgICAgICBpc0xpc3RhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICBpc1NvcnRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgICAgaXNJZGVudGlmaWVyOiB0cnVlLFxuICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgeyBpY29uOiBcInZpZXdcIiwgbGFiZWw6IFwiVmlldyBEZXRhaWxzXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaC9yZWNvcmRzLzplbnRpdHlOYW1lLzppZFwiIH1cbiAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgbmFtZTogXCJGdWxsIFJlY29yZFwiLFxuICAgICAgICAgICAgICBkYXRhSW5kZXg6IFwiZnVsbFJlY29yZFwiLFxuICAgICAgICAgICAgICBpZDogXCJmdWxsUmVjb3JkXCIsXG4gICAgICAgICAgICAgIGlzU29ydGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgICBpc0ZpbHRlcmFibGU6IGZhbHNlLFxuICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwianNvblwiLFxuICAgICAgICAgICAgICBpc0xpc3RhYmxlOiB0cnVlXG4gICAgICAgICAgICB9XG4gICAgICAgICAgXVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG59OyAiXX0=
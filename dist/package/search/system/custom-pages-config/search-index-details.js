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
            label: "Initialize Index",
            openInModal: true,
            modalConfig: {
                modalType: "confirm",
                modalPageConfig: {
                    title: "Initialize Search Index",
                    content: "This will initialize/update the search index configuration from code. Existing data will be preserved."
                },
                apiConfig: {
                    apiMethod: "POST",
                    apiUrl: "/system/search/indices/:entityName/init"
                },
                responseConfig: {
                    showModal: true,
                    modalTitle: "Index Initialized",
                },
                submitSuccessRedirect: "/system/search/indices/:entityName"
            }
        },
        {
            label: "Recreate Index",
            openInModal: true,
            modalConfig: {
                modalType: "form",
                modalPageConfig: {
                    title: "Recreate Search Index",
                    helpText: "⚠️ This will delete and recreate the index with new configuration. Use when primary key or other structural changes are needed.",
                    propertiesConfig: [
                        {
                            name: "resyncDocuments",
                            label: "Resync Documents",
                            column: "resyncDocuments",
                            fieldType: "switch",
                            required: false,
                            defaultValue: false,
                            helpText: "Automatically resync all documents after recreation"
                        },
                        {
                            name: "syncMethod",
                            label: "Sync Method",
                            column: "syncMethod",
                            fieldType: "select",
                            required: false,
                            defaultValue: "direct",
                            options: [
                                { label: "Direct (Synchronous)", value: "direct" },
                                { label: "Queue (Asynchronous via SQS)", value: "queue" }
                            ],
                            helpText: "Choose how to resync documents"
                        },
                        {
                            name: "batchSize",
                            label: "Batch Size",
                            column: "batchSize",
                            fieldType: "number",
                            required: false,
                            defaultValue: 50,
                            helpText: "Number of records to process per batch"
                        }
                    ],
                    apiConfig: {
                        apiMethod: "POST",
                        apiUrl: "/system/search/indices/:entityName/recreate"
                    },
                    formButtons: ["submit", "reset", "cancel"]
                },
                responseConfig: {
                    showModal: true,
                    modalTitle: "Index Recreation Result",
                }
            }
        },
        {
            label: "Resync Records",
            openInModal: true,
            modalConfig: {
                modalType: "confirm",
                modalPageConfig: {
                    title: "Re-sync All Records",
                    content: "This will queue all records for re-indexing. Processing happens asynchronously via SQS."
                },
                apiConfig: {
                    apiMethod: "POST",
                    apiUrl: "/system/search/indices/:entityName/resync"
                },
                responseConfig: {
                    showModal: true,
                    modalTitle: "Resync Queued",
                    modalWidth: 700
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VhcmNoLWluZGV4LWRldGFpbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvc2VhcmNoL3N5c3RlbS9jdXN0b20tcGFnZXMtY29uZmlnL3NlYXJjaC1pbmRleC1kZXRhaWxzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVhLFFBQUEsd0JBQXdCLEdBQXdCO0lBQzNELFNBQVMsRUFBRSxzQkFBc0I7SUFDakMsUUFBUSxFQUFFLFdBQVc7SUFDckIsWUFBWSxFQUFFLG9DQUFvQztJQUNsRCxXQUFXLEVBQUU7UUFDWCxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRTtRQUMzQixFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLGdCQUFnQixFQUFFO1FBQzFDLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRSxHQUFHLEVBQUUsd0JBQXdCLEVBQUU7UUFDbkQsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFO0tBQzNCO0lBQ0QsaUJBQWlCLEVBQUU7UUFDakIsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFLEdBQUcsRUFBRSxxREFBcUQsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFO1FBQ3RHO1lBQ0UsS0FBSyxFQUFFLGtCQUFrQjtZQUN6QixXQUFXLEVBQUUsSUFBSTtZQUNqQixXQUFXLEVBQUU7Z0JBQ1gsU0FBUyxFQUFFLFNBQVM7Z0JBQ3BCLGVBQWUsRUFBRTtvQkFDZixLQUFLLEVBQUUseUJBQXlCO29CQUNoQyxPQUFPLEVBQUUsd0dBQXdHO2lCQUNsSDtnQkFDRCxTQUFTLEVBQUU7b0JBQ1QsU0FBUyxFQUFFLE1BQU07b0JBQ2pCLE1BQU0sRUFBRSx5Q0FBeUM7aUJBQ2xEO2dCQUNELGNBQWMsRUFBRTtvQkFDZCxTQUFTLEVBQUUsSUFBSTtvQkFDZixVQUFVLEVBQUUsbUJBQW1CO2lCQUNoQztnQkFDRCxxQkFBcUIsRUFBRSxvQ0FBb0M7YUFDNUQ7U0FDRjtRQUNE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Q0UsSUFBSSxFQUFFLGFBQWE7NEJBQ25CLFNBQVMsRUFBRSxZQUFZOzRCQUN2QixFQUFFLEVBQUUsWUFBWTs0QkFDaEIsVUFBVSxFQUFFLEtBQUs7NEJBQ2pCLFlBQVksRUFBRSxLQUFLOzRCQUNuQixTQUFTLEVBQUUsTUFBTTs0QkFDakIsVUFBVSxFQUFFLElBQUk7eUJBQ2pCO3FCQUNGO2lCQUNGO2FBQ0Y7U0FDRjtLQUNGO0NBQ0YsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFjY29yZGlvblBhZ2VDb25maWcgfSBmcm9tIFwiLi4vLi4vLi4vdWktY29uZmlnLWdlblwiO1xuXG5leHBvcnQgY29uc3Qgc2VhcmNoSW5kZXhEZXRhaWxzQ29uZmlnOiBBY2NvcmRpb25QYWdlQ29uZmlnID0ge1xuICBwYWdlVGl0bGU6IFwiU2VhcmNoIEluZGV4IERldGFpbHNcIixcbiAgcGFnZVR5cGU6IFwiYWNjb3JkaW9uXCIsXG4gIHJvdXRlUGF0dGVybjogXCIvc3lzdGVtL3NlYXJjaC9pbmRpY2VzLzplbnRpdHlOYW1lXCIsXG4gIGJyZWFkY3J1bWJzOiBbXG4gICAgeyBsYWJlbDogXCJIb21lXCIsIHVybDogXCIvXCIgfSxcbiAgICB7IGxhYmVsOiBcIlNlYXJjaFwiLCB1cmw6IFwiL3N5c3RlbS9zZWFyY2hcIiB9LFxuICAgIHsgbGFiZWw6IFwiSW5kaWNlc1wiLCB1cmw6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlc1wiIH0sXG4gICAgeyBsYWJlbDogXCJJbmRleCBEZXRhaWxzXCIgfVxuICBdLFxuICBwYWdlSGVhZGVyQWN0aW9uczogW1xuICAgIHsgbGFiZWw6IFwiVmlldyBTZXR0aW5nc1wiLCB1cmw6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlcy86ZW50aXR5TmFtZS9zZXR0aW5ncy1kZXRhaWxzXCIsIHR5cGU6IFwiYnV0dG9uXCIgfSxcbiAgICB7XG4gICAgICBsYWJlbDogXCJJbml0aWFsaXplIEluZGV4XCIsXG4gICAgICBvcGVuSW5Nb2RhbDogdHJ1ZSxcbiAgICAgIG1vZGFsQ29uZmlnOiB7XG4gICAgICAgIG1vZGFsVHlwZTogXCJjb25maXJtXCIsXG4gICAgICAgIG1vZGFsUGFnZUNvbmZpZzoge1xuICAgICAgICAgIHRpdGxlOiBcIkluaXRpYWxpemUgU2VhcmNoIEluZGV4XCIsXG4gICAgICAgICAgY29udGVudDogXCJUaGlzIHdpbGwgaW5pdGlhbGl6ZS91cGRhdGUgdGhlIHNlYXJjaCBpbmRleCBjb25maWd1cmF0aW9uIGZyb20gY29kZS4gRXhpc3RpbmcgZGF0YSB3aWxsIGJlIHByZXNlcnZlZC5cIlxuICAgICAgICB9LFxuICAgICAgICBhcGlDb25maWc6IHtcbiAgICAgICAgICBhcGlNZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgICAgIGFwaVVybDogXCIvc3lzdGVtL3NlYXJjaC9pbmRpY2VzLzplbnRpdHlOYW1lL2luaXRcIlxuICAgICAgICB9LFxuICAgICAgICByZXNwb25zZUNvbmZpZzoge1xuICAgICAgICAgIHNob3dNb2RhbDogdHJ1ZSxcbiAgICAgICAgICBtb2RhbFRpdGxlOiBcIkluZGV4IEluaXRpYWxpemVkXCIsXG4gICAgICAgIH0sXG4gICAgICAgIHN1Ym1pdFN1Y2Nlc3NSZWRpcmVjdDogXCIvc3lzdGVtL3NlYXJjaC9pbmRpY2VzLzplbnRpdHlOYW1lXCJcbiAgICAgIH1cbiAgICB9LFxuICAgIHtcbiAgICAgIGxhYmVsOiBcIlJlY3JlYXRlIEluZGV4XCIsXG4gICAgICBvcGVuSW5Nb2RhbDogdHJ1ZSxcbiAgICAgIG1vZGFsQ29uZmlnOiB7XG4gICAgICAgIG1vZGFsVHlwZTogXCJmb3JtXCIsXG4gICAgICAgIG1vZGFsUGFnZUNvbmZpZzoge1xuICAgICAgICAgIHRpdGxlOiBcIlJlY3JlYXRlIFNlYXJjaCBJbmRleFwiLFxuICAgICAgICAgIGhlbHBUZXh0OiBcIuKaoO+4jyBUaGlzIHdpbGwgZGVsZXRlIGFuZCByZWNyZWF0ZSB0aGUgaW5kZXggd2l0aCBuZXcgY29uZmlndXJhdGlvbi4gVXNlIHdoZW4gcHJpbWFyeSBrZXkgb3Igb3RoZXIgc3RydWN0dXJhbCBjaGFuZ2VzIGFyZSBuZWVkZWQuXCIsXG4gICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBuYW1lOiBcInJlc3luY0RvY3VtZW50c1wiLFxuICAgICAgICAgICAgICBsYWJlbDogXCJSZXN5bmMgRG9jdW1lbnRzXCIsXG4gICAgICAgICAgICAgIGNvbHVtbjogXCJyZXN5bmNEb2N1bWVudHNcIixcbiAgICAgICAgICAgICAgZmllbGRUeXBlOiBcInN3aXRjaFwiLFxuICAgICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICAgIGRlZmF1bHRWYWx1ZTogZmFsc2UsXG4gICAgICAgICAgICAgIGhlbHBUZXh0OiBcIkF1dG9tYXRpY2FsbHkgcmVzeW5jIGFsbCBkb2N1bWVudHMgYWZ0ZXIgcmVjcmVhdGlvblwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBuYW1lOiBcInN5bmNNZXRob2RcIixcbiAgICAgICAgICAgICAgbGFiZWw6IFwiU3luYyBNZXRob2RcIixcbiAgICAgICAgICAgICAgY29sdW1uOiBcInN5bmNNZXRob2RcIixcbiAgICAgICAgICAgICAgZmllbGRUeXBlOiBcInNlbGVjdFwiLFxuICAgICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICAgIGRlZmF1bHRWYWx1ZTogXCJkaXJlY3RcIixcbiAgICAgICAgICAgICAgb3B0aW9uczogW1xuICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiRGlyZWN0IChTeW5jaHJvbm91cylcIiwgdmFsdWU6IFwiZGlyZWN0XCIgfSxcbiAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIlF1ZXVlIChBc3luY2hyb25vdXMgdmlhIFNRUylcIiwgdmFsdWU6IFwicXVldWVcIiB9XG4gICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgIGhlbHBUZXh0OiBcIkNob29zZSBob3cgdG8gcmVzeW5jIGRvY3VtZW50c1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBuYW1lOiBcImJhdGNoU2l6ZVwiLFxuICAgICAgICAgICAgICBsYWJlbDogXCJCYXRjaCBTaXplXCIsXG4gICAgICAgICAgICAgIGNvbHVtbjogXCJiYXRjaFNpemVcIixcbiAgICAgICAgICAgICAgZmllbGRUeXBlOiBcIm51bWJlclwiLFxuICAgICAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgICAgIGRlZmF1bHRWYWx1ZTogNTAsXG4gICAgICAgICAgICAgIGhlbHBUZXh0OiBcIk51bWJlciBvZiByZWNvcmRzIHRvIHByb2Nlc3MgcGVyIGJhdGNoXCJcbiAgICAgICAgICAgIH1cbiAgICAgICAgICBdLFxuICAgICAgICAgIGFwaUNvbmZpZzoge1xuICAgICAgICAgICAgYXBpTWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgICAgIGFwaVVybDogXCIvc3lzdGVtL3NlYXJjaC9pbmRpY2VzLzplbnRpdHlOYW1lL3JlY3JlYXRlXCJcbiAgICAgICAgICB9LFxuICAgICAgICAgIGZvcm1CdXR0b25zOiBbXCJzdWJtaXRcIiwgXCJyZXNldFwiLCBcImNhbmNlbFwiXVxuICAgICAgICB9LFxuICAgICAgICByZXNwb25zZUNvbmZpZzoge1xuICAgICAgICAgIHNob3dNb2RhbDogdHJ1ZSxcbiAgICAgICAgICBtb2RhbFRpdGxlOiBcIkluZGV4IFJlY3JlYXRpb24gUmVzdWx0XCIsXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LFxuICAgIHsgXG4gICAgICBsYWJlbDogXCJSZXN5bmMgUmVjb3Jkc1wiLCBcbiAgICAgIG9wZW5Jbk1vZGFsOiB0cnVlLFxuICAgICAgbW9kYWxDb25maWc6IHtcbiAgICAgICAgbW9kYWxUeXBlOiBcImNvbmZpcm1cIixcbiAgICAgICAgbW9kYWxQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgdGl0bGU6IFwiUmUtc3luYyBBbGwgUmVjb3Jkc1wiLFxuICAgICAgICAgIGNvbnRlbnQ6IFwiVGhpcyB3aWxsIHF1ZXVlIGFsbCByZWNvcmRzIGZvciByZS1pbmRleGluZy4gUHJvY2Vzc2luZyBoYXBwZW5zIGFzeW5jaHJvbm91c2x5IHZpYSBTUVMuXCJcbiAgICAgICAgfSxcbiAgICAgICAgYXBpQ29uZmlnOiB7XG4gICAgICAgICAgYXBpTWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgICBhcGlVcmw6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlcy86ZW50aXR5TmFtZS9yZXN5bmNcIlxuICAgICAgICB9LFxuICAgICAgICByZXNwb25zZUNvbmZpZzoge1xuICAgICAgICAgIHNob3dNb2RhbDogdHJ1ZSxcbiAgICAgICAgICBtb2RhbFRpdGxlOiBcIlJlc3luYyBRdWV1ZWRcIixcbiAgICAgICAgICBtb2RhbFdpZHRoOiA3MDBcbiAgICAgICAgfSxcbiAgICAgICAgc3VibWl0U3VjY2Vzc1JlZGlyZWN0OiBcIi9zeXN0ZW0vc2VhcmNoL2luZGljZXMvOmVudGl0eU5hbWVcIlxuICAgICAgfVxuICAgIH0sXG4gICAgeyBcbiAgICAgIGxhYmVsOiBcIkNsZWFyIERvY3VtZW50c1wiLCBcbiAgICAgIG9wZW5Jbk1vZGFsOiB0cnVlLFxuICAgICAgbW9kYWxDb25maWc6IHtcbiAgICAgICAgbW9kYWxUeXBlOiBcImNvbmZpcm1cIixcbiAgICAgICAgbW9kYWxQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgdGl0bGU6IFwiQ2xlYXIgQWxsIERvY3VtZW50c1wiLFxuICAgICAgICAgIGNvbnRlbnQ6IFwiVGhpcyB3aWxsIHJlbW92ZSBhbGwgZG9jdW1lbnRzIGZyb20gdGhlIHNlYXJjaCBpbmRleC4gVGhpcyBhY3Rpb24gY2Fubm90IGJlIHVuZG9uZS5cIlxuICAgICAgICB9LFxuICAgICAgICBhcGlDb25maWc6IHtcbiAgICAgICAgICBhcGlNZXRob2Q6IFwiREVMRVRFXCIsXG4gICAgICAgICAgYXBpVXJsOiBcIi9zeXN0ZW0vc2VhcmNoL2luZGljZXMvOmVudGl0eU5hbWUvZG9jdW1lbnRzXCJcbiAgICAgICAgfSxcbiAgICAgICAgc3VibWl0U3VjY2Vzc1JlZGlyZWN0OiBcIi9zeXN0ZW0vc2VhcmNoL2luZGljZXMvOmVudGl0eU5hbWVcIlxuICAgICAgfVxuICAgIH0sXG4gICAgeyBcbiAgICAgIGxhYmVsOiBcIkRlbGV0ZSBJbmRleFwiLCBcbiAgICAgIG9wZW5Jbk1vZGFsOiB0cnVlLFxuICAgICAgbW9kYWxDb25maWc6IHtcbiAgICAgICAgbW9kYWxUeXBlOiBcImNvbmZpcm1cIixcbiAgICAgICAgbW9kYWxQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgdGl0bGU6IFwiRGVsZXRlIEluZGV4XCIsXG4gICAgICAgICAgY29udGVudDogXCJUaGlzIHdpbGwgcGVybWFuZW50bHkgZGVsZXRlIHRoZSBzZWFyY2ggaW5kZXggYW5kIGFsbCBpdHMgZGF0YS4gVGhpcyBhY3Rpb24gY2Fubm90IGJlIHVuZG9uZS5cIlxuICAgICAgICB9LFxuICAgICAgICBhcGlDb25maWc6IHtcbiAgICAgICAgICBhcGlNZXRob2Q6IFwiREVMRVRFXCIsXG4gICAgICAgICAgYXBpVXJsOiBcIi9zeXN0ZW0vc2VhcmNoL2luZGljZXMvOmVudGl0eU5hbWVcIlxuICAgICAgICB9LFxuICAgICAgICBzdWJtaXRTdWNjZXNzUmVkaXJlY3Q6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlc1wiXG4gICAgICB9XG4gICAgfVxuICBdLFxuICBhY2NvcmRpb25QYWdlQ29uZmlnOiB7XG4gICAgYWNjb3JkaW9uczoge1xuICAgICAgXCJpbmRleERldGFpbHNcIjoge1xuICAgICAgICBwYWdlVGl0bGU6IFwiSW5kZXggRGV0YWlsc1wiLFxuICAgICAgICBwYWdlVHlwZTogXCJkZXRhaWxzXCIsXG4gICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgZGV0YWlsQXBpQ29uZmlnOiB7IGFwaU1ldGhvZDogXCJHRVRcIiwgcmVzcG9uc2VLZXk6IFwiZGV0YWlsc1wiLCBhcGlVcmw6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlcy86ZW50aXR5TmFtZVwiIH0sXG4gICAgICAgICAgY29sdW1uc0NvbmZpZzoge1xuICAgICAgICAgICAgY29sdW1uczogW1xuICAgICAgICAgICAgICB7IHNvcnRPcmRlcjogMSwgZmllbGRzOiBbIFwiZW50aXR5TmFtZVwiLCBcImluZGV4SW5mb1wiIF0gfSxcbiAgICAgICAgICAgICAgeyBzb3J0T3JkZXI6IDIsIGZpZWxkczogWyBcImluZGV4U3RhdHNcIiBdIH1cbiAgICAgICAgICAgIF1cbiAgICAgICAgICB9LFxuICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFtcbiAgICAgICAgICAgIHsgbmFtZTogXCJlbnRpdHlOYW1lXCIsIGxhYmVsOiBcIkVudGl0eSBOYW1lXCIsIGlkOiBcImVudGl0eU5hbWVcIiwgY29sdW1uOiBcImVudGl0eU5hbWVcIiwgZmllbGRUeXBlOiBcInRleHRcIiB9LFxuICAgICAgICAgICAgLy8gSW5kZXggSW5mb1xuICAgICAgICAgICAgeyBuYW1lOiBcImluZGV4SW5mb1wiLCBsYWJlbDogXCJJbmRleCBJbmZvXCIsIGlkOiBcImluZGV4SW5mb1wiLCBjb2x1bW46IFwiaW5kZXhJbmZvXCIsIGZpZWxkVHlwZTogXCJqc29uXCIgfSxcbiAgICAgICAgICAgIC8vIEluZGV4IFN0YXRzXG4gICAgICAgICAgICB7IG5hbWU6IFwiaW5kZXhTdGF0c1wiLCBsYWJlbDogXCJJbmRleCBTdGF0c1wiLCBpZDogXCJpbmRleFN0YXRzXCIsIGNvbHVtbjogXCJpbmRleFN0YXRzXCIsIGZpZWxkVHlwZTogXCJqc29uXCIgfSxcbiAgICAgICAgICBdXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBcImluZGV4VGFza3NcIjoge1xuICAgICAgICBwYWdlVGl0bGU6IFwiSW5kZXggVGFza3NcIixcbiAgICAgICAgcGFnZVR5cGU6IFwibGlzdFwiLFxuICAgICAgICBsaXN0UGFnZUNvbmZpZzoge1xuICAgICAgICAgIGFwaUNvbmZpZzoge1xuICAgICAgICAgICAgYXBpTWV0aG9kOiBcIkdFVFwiLFxuICAgICAgICAgICAgcmVzcG9uc2VLZXk6IFwiaXRlbXNcIixcbiAgICAgICAgICAgIGFwaVVybDogXCIvc3lzdGVtL3NlYXJjaC90YXNrcz9lbnRpdHlOYW1lLmVxPTplbnRpdHlOYW1lXCJcbiAgICAgICAgICB9LFxuICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgbmFtZTogXCJUYXNrIFVJRFwiLFxuICAgICAgICAgICAgICBkYXRhSW5kZXg6IFwidWlkXCIsXG4gICAgICAgICAgICAgIGlkOiBcInVpZFwiLFxuICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwibnVtYmVyXCIsXG4gICAgICAgICAgICAgIGlzTGlzdGFibGU6IHRydWUsXG4gICAgICAgICAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgaXNJZGVudGlmaWVyOiB0cnVlLFxuICAgICAgICAgICAgICBmaWx0ZXJDb25maWc6IHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IFwiZXFcIixcbiAgICAgICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IFsgXCJlcVwiLCBcImluXCIsIFwibmluXCIgXSxcbiAgICAgICAgICAgICAgICBmaWx0ZXJUeXBlOiBcIm51bWJlclwiXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgICB7IGljb246IFwidmlld1wiLCBsYWJlbDogXCJEZXRhaWxzXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaC90YXNrcy86dWlkXCIgfVxuICAgICAgICAgICAgICBdXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBuYW1lOiBcIlN0YXR1c1wiLFxuICAgICAgICAgICAgICBkYXRhSW5kZXg6IFwic3RhdHVzXCIsXG4gICAgICAgICAgICAgIGlkOiBcInN0YXR1c1wiLFxuICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwidGV4dFwiLFxuICAgICAgICAgICAgICBpc0xpc3RhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAgICAgICAgIGZpbHRlckNvbmZpZzoge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogXCJlcVwiLFxuICAgICAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogWyBcImVxXCIsIFwiaW5cIiwgXCJuaW5cIiBdLFxuICAgICAgICAgICAgICAgIHByZWRlZmluZWRPcHRpb25zOiBbXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIkVucXVldWVkXCIsIHZhbHVlOiBcImVucXVldWVkXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiUHJvY2Vzc2luZ1wiLCB2YWx1ZTogXCJwcm9jZXNzaW5nXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiU3VjY2VlZGVkXCIsIHZhbHVlOiBcInN1Y2NlZWRlZFwiIH0sXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIkZhaWxlZFwiLCB2YWx1ZTogXCJmYWlsZWRcIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJDYW5jZWxlZFwiLCB2YWx1ZTogXCJjYW5jZWxlZFwiIH1cbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIGZpbHRlclR5cGU6IFwic2VsZWN0XCJcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgbmFtZTogXCJUeXBlXCIsXG4gICAgICAgICAgICAgIGRhdGFJbmRleDogXCJ0eXBlXCIsXG4gICAgICAgICAgICAgIGlkOiBcInR5cGVcIixcbiAgICAgICAgICAgICAgZmllbGRUeXBlOiBcInRleHRcIixcbiAgICAgICAgICAgICAgaXNMaXN0YWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICBmaWx0ZXJDb25maWc6IHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IFwiZXFcIixcbiAgICAgICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IFsgXCJlcVwiLCBcImluXCIsIFwibmluXCIgXSxcbiAgICAgICAgICAgICAgICBwcmVkZWZpbmVkT3B0aW9uczogW1xuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJEb2N1bWVudCBBZGRpdGlvbi9VcGRhdGVcIiwgdmFsdWU6IFwiZG9jdW1lbnRBZGRpdGlvbk9yVXBkYXRlXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiRG9jdW1lbnQgRWRpdGlvblwiLCB2YWx1ZTogXCJkb2N1bWVudEVkaXRpb25cIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJEb2N1bWVudCBEZWxldGlvblwiLCB2YWx1ZTogXCJkb2N1bWVudERlbGV0aW9uXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiU2V0dGluZ3MgVXBkYXRlXCIsIHZhbHVlOiBcInNldHRpbmdzVXBkYXRlXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiSW5kZXggQ3JlYXRpb25cIiwgdmFsdWU6IFwiaW5kZXhDcmVhdGlvblwiIH0sXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIkluZGV4IERlbGV0aW9uXCIsIHZhbHVlOiBcImluZGV4RGVsZXRpb25cIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJJbmRleCBVcGRhdGVcIiwgdmFsdWU6IFwiaW5kZXhVcGRhdGVcIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJJbmRleCBTd2FwXCIsIHZhbHVlOiBcImluZGV4U3dhcFwiIH0sXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIlRhc2sgQ2FuY2VsbGF0aW9uXCIsIHZhbHVlOiBcInRhc2tDYW5jZWxhdGlvblwiIH0sXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIlRhc2sgRGVsZXRpb25cIiwgdmFsdWU6IFwidGFza0RlbGV0aW9uXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiRHVtcCBDcmVhdGlvblwiLCB2YWx1ZTogXCJkdW1wQ3JlYXRpb25cIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJTbmFwc2hvdCBDcmVhdGlvblwiLCB2YWx1ZTogXCJzbmFwc2hvdENyZWF0aW9uXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiRGF0YWJhc2UgVXBncmFkZVwiLCB2YWx1ZTogXCJ1cGdyYWRlRGF0YWJhc2VcIiB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBmaWx0ZXJUeXBlOiBcInNlbGVjdFwiXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIG5hbWU6IFwiRW5xdWV1ZWQgQXRcIixcbiAgICAgICAgICAgICAgZGF0YUluZGV4OiBcImVucXVldWVkQXRcIixcbiAgICAgICAgICAgICAgaWQ6IFwiZW5xdWV1ZWRBdFwiLFxuICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwiZGF0ZXRpbWVcIixcbiAgICAgICAgICAgICAgaXNMaXN0YWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICBmaWx0ZXJDb25maWc6IHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IFwiZ3RcIixcbiAgICAgICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IFsgXCJndFwiLCBcImx0XCIsIFwiZXFcIiBdLFxuICAgICAgICAgICAgICAgIGZpbHRlclR5cGU6IFwiZGF0ZXRpbWVcIlxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBuYW1lOiBcIlN0YXJ0ZWQgQXRcIixcbiAgICAgICAgICAgICAgZGF0YUluZGV4OiBcInN0YXJ0ZWRBdFwiLFxuICAgICAgICAgICAgICBpZDogXCJzdGFydGVkQXRcIixcbiAgICAgICAgICAgICAgZmllbGRUeXBlOiBcImRhdGV0aW1lXCIsXG4gICAgICAgICAgICAgIGlzTGlzdGFibGU6IHRydWUsXG4gICAgICAgICAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgZmlsdGVyQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBcImd0XCIsXG4gICAgICAgICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBbIFwiZ3RcIiwgXCJsdFwiLCBcImVxXCIgXSxcbiAgICAgICAgICAgICAgICBmaWx0ZXJUeXBlOiBcImRhdGV0aW1lXCJcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgbmFtZTogXCJGaW5pc2hlZCBBdFwiLFxuICAgICAgICAgICAgICBkYXRhSW5kZXg6IFwiZmluaXNoZWRBdFwiLFxuICAgICAgICAgICAgICBpZDogXCJmaW5pc2hlZEF0XCIsXG4gICAgICAgICAgICAgIGZpZWxkVHlwZTogXCJkYXRldGltZVwiLFxuICAgICAgICAgICAgICBpc0xpc3RhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAgICAgICAgIGZpbHRlckNvbmZpZzoge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogXCJndFwiLFxuICAgICAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogWyBcImd0XCIsIFwibHRcIiwgXCJlcVwiIF0sXG4gICAgICAgICAgICAgICAgZmlsdGVyVHlwZTogXCJkYXRldGltZVwiXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICBdXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBcImluZGV4QmF0Y2hlc1wiOiB7XG4gICAgICAgIHBhZ2VUaXRsZTogXCJJbmRleCBCYXRjaGVzXCIsXG4gICAgICAgIHBhZ2VUeXBlOiBcImxpc3RcIixcbiAgICAgICAgbGlzdFBhZ2VDb25maWc6IHtcbiAgICAgICAgICBhcGlDb25maWc6IHtcbiAgICAgICAgICAgIGFwaU1ldGhvZDogXCJHRVRcIixcbiAgICAgICAgICAgIHJlc3BvbnNlS2V5OiBcIml0ZW1zXCIsXG4gICAgICAgICAgICBhcGlVcmw6IFwiL3N5c3RlbS9zZWFyY2gvYmF0Y2hlcz9lbnRpdHlOYW1lLmVxPTplbnRpdHlOYW1lXCJcbiAgICAgICAgICB9LFxuICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgbmFtZTogXCJVSURcIixcbiAgICAgICAgICAgICAgZGF0YUluZGV4OiBcInVpZFwiLFxuICAgICAgICAgICAgICBpZDogXCJ1aWRcIixcbiAgICAgICAgICAgICAgZmllbGRUeXBlOiBcIm51bWJlclwiLFxuICAgICAgICAgICAgICBpc0xpc3RhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAgICAgICAgIGlzSWRlbnRpZmllcjogdHJ1ZSxcbiAgICAgICAgICAgICAgZmlsdGVyQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBcImVxXCIsXG4gICAgICAgICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBbIFwiZXFcIiwgXCJpblwiLCBcIm5pblwiIF0sXG4gICAgICAgICAgICAgICAgZmlsdGVyVHlwZTogXCJudW1iZXJcIlxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICAgeyBpY29uOiBcInZpZXdcIiwgbGFiZWw6IFwiRGV0YWlsc1wiLCB1cmw6IFwiL3N5c3RlbS9zZWFyY2gvYmF0Y2hlcy86dWlkXCIgfVxuICAgICAgICAgICAgICBdXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBuYW1lOiBcIlRvdGFsIFRhc2tzXCIsXG4gICAgICAgICAgICAgIGRhdGFJbmRleDogXCJzdGF0cy50b3RhbE5iVGFza3NcIixcbiAgICAgICAgICAgICAgaWQ6IFwidG90YWxOYlRhc2tzXCIsXG4gICAgICAgICAgICAgIGZpZWxkVHlwZTogXCJqc29uXCIsXG4gICAgICAgICAgICAgIGlzTGlzdGFibGU6IHRydWUsXG4gICAgICAgICAgICAgIGlzRmlsdGVyYWJsZTogZmFsc2VcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIG5hbWU6IFwiU3RhdHVzXCIsXG4gICAgICAgICAgICAgIGRhdGFJbmRleDogXCJzdGF0dXNcIixcbiAgICAgICAgICAgICAgaWQ6IFwic3RhdHVzXCIsXG4gICAgICAgICAgICAgIGZpZWxkVHlwZTogXCJqc29uXCIsXG4gICAgICAgICAgICAgIGlzTGlzdGFibGU6IHRydWUsXG4gICAgICAgICAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgZmlsdGVyQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBcImVxXCIsXG4gICAgICAgICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBbIFwiZXFcIiwgXCJpblwiLCBcIm5pblwiIF0sXG4gICAgICAgICAgICAgICAgcHJlZGVmaW5lZE9wdGlvbnM6IFtcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiRW5xdWV1ZWRcIiwgdmFsdWU6IFwiZW5xdWV1ZWRcIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJQcm9jZXNzaW5nXCIsIHZhbHVlOiBcInByb2Nlc3NpbmdcIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJTdWNjZWVkZWRcIiwgdmFsdWU6IFwic3VjY2VlZGVkXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiRmFpbGVkXCIsIHZhbHVlOiBcImZhaWxlZFwiIH0sXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIkNhbmNlbGVkXCIsIHZhbHVlOiBcImNhbmNlbGVkXCIgfVxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgZmlsdGVyVHlwZTogXCJzZWxlY3RcIlxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBuYW1lOiBcIlR5cGVcIixcbiAgICAgICAgICAgICAgZGF0YUluZGV4OiBcInR5cGVzXCIsXG4gICAgICAgICAgICAgIGlkOiBcInR5cGVcIixcbiAgICAgICAgICAgICAgZmllbGRUeXBlOiBcImpzb25cIixcbiAgICAgICAgICAgICAgaXNMaXN0YWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICBmaWx0ZXJDb25maWc6IHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IFwiZXFcIixcbiAgICAgICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IFsgXCJlcVwiLCBcImluXCIsIFwibmluXCIgXSxcbiAgICAgICAgICAgICAgICBwcmVkZWZpbmVkT3B0aW9uczogW1xuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJJbmRleCBDcmVhdGlvblwiLCB2YWx1ZTogXCJpbmRleENyZWF0aW9uXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiSW5kZXggVXBkYXRlXCIsIHZhbHVlOiBcImluZGV4VXBkYXRlXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiSW5kZXggRGVsZXRpb25cIiwgdmFsdWU6IFwiaW5kZXhEZWxldGlvblwiIH0sXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIkluZGV4IFN3YXBcIiwgdmFsdWU6IFwiaW5kZXhTd2FwXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiRG9jdW1lbnQgQWRkaXRpb24vVXBkYXRlXCIsIHZhbHVlOiBcImRvY3VtZW50QWRkaXRpb25PclVwZGF0ZVwiIH0sXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIkRvY3VtZW50IERlbGV0aW9uXCIsIHZhbHVlOiBcImRvY3VtZW50RGVsZXRpb25cIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJEb2N1bWVudCBFZGl0aW9uXCIsIHZhbHVlOiBcImRvY3VtZW50RWRpdGlvblwiIH0sXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIlNldHRpbmdzIFVwZGF0ZVwiLCB2YWx1ZTogXCJzZXR0aW5nc1VwZGF0ZVwiIH0sXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIkR1bXAgQ3JlYXRpb25cIiwgdmFsdWU6IFwiZHVtcENyZWF0aW9uXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiVGFzayBDYW5jZWxhdGlvblwiLCB2YWx1ZTogXCJ0YXNrQ2FuY2VsYXRpb25cIiB9LFxuICAgICAgICAgICAgICAgICAgeyBsYWJlbDogXCJUYXNrIERlbGV0aW9uXCIsIHZhbHVlOiBcInRhc2tEZWxldGlvblwiIH0sXG4gICAgICAgICAgICAgICAgICB7IGxhYmVsOiBcIkRhdGFiYXNlIFVwZ3JhZGVcIiwgdmFsdWU6IFwiZGF0YWJhc2VVcGdyYWRlXCIgfSxcbiAgICAgICAgICAgICAgICAgIHsgbGFiZWw6IFwiU25hcHNob3QgQ3JlYXRpb25cIiwgdmFsdWU6IFwic25hcHNob3RDcmVhdGlvblwiIH1cbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIGZpbHRlclR5cGU6IFwic2VsZWN0XCJcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgbmFtZTogXCJTdGFydGVkIEF0XCIsXG4gICAgICAgICAgICAgIGRhdGFJbmRleDogXCJzdGFydGVkQXRcIixcbiAgICAgICAgICAgICAgaWQ6IFwic3RhcnRlZEF0XCIsXG4gICAgICAgICAgICAgIGZpZWxkVHlwZTogXCJkYXRldGltZVwiLFxuICAgICAgICAgICAgICBpc0xpc3RhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAgICAgICAgIGZpbHRlckNvbmZpZzoge1xuICAgICAgICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogXCJndFwiLFxuICAgICAgICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogWyBcImd0XCIsIFwibHRcIiwgXCJlcVwiIF0sXG4gICAgICAgICAgICAgICAgZmlsdGVyVHlwZTogXCJkYXRldGltZVwiXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIG5hbWU6IFwiRmluaXNoZWQgQXRcIixcbiAgICAgICAgICAgICAgZGF0YUluZGV4OiBcImZpbmlzaGVkQXRcIixcbiAgICAgICAgICAgICAgaWQ6IFwiZmluaXNoZWRBdFwiLFxuICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwiZGF0ZXRpbWVcIixcbiAgICAgICAgICAgICAgaXNMaXN0YWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICBmaWx0ZXJDb25maWc6IHtcbiAgICAgICAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IFwiZ3RcIixcbiAgICAgICAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IFsgXCJndFwiLCBcImx0XCIsIFwiZXFcIiBdLFxuICAgICAgICAgICAgICAgIGZpbHRlclR5cGU6IFwiZGF0ZXRpbWVcIlxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBuYW1lOiBcIkR1cmF0aW9uXCIsXG4gICAgICAgICAgICAgIGRhdGFJbmRleDogXCJkdXJhdGlvblwiLFxuICAgICAgICAgICAgICBpZDogXCJkdXJhdGlvblwiLFxuICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwidGV4dFwiLFxuICAgICAgICAgICAgICBpc0xpc3RhYmxlOiB0cnVlLFxuICAgICAgICAgICAgICBpc0ZpbHRlcmFibGU6IGZhbHNlXG4gICAgICAgICAgICB9XG4gICAgICAgICAgXVxuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgXCJpbmRleERvY3VtZW50c1wiOiB7XG4gICAgICAgIHBhZ2VUaXRsZTogXCJJbmRleCBEb2N1bWVudHNcIixcbiAgICAgICAgcGFnZVR5cGU6IFwibGlzdFwiLFxuICAgICAgICBsaXN0UGFnZUNvbmZpZzoge1xuICAgICAgICAgIGFwaUNvbmZpZzoge1xuICAgICAgICAgICAgYXBpTWV0aG9kOiBcIkdFVFwiLFxuICAgICAgICAgICAgdXNlU2VhcmNoOiB0cnVlLFxuICAgICAgICAgICAgcmVzcG9uc2VLZXk6IFwiaXRlbXNcIixcbiAgICAgICAgICAgIGFwaVVybDogXCIvc3lzdGVtL3NlYXJjaC9yZWNvcmRzLzplbnRpdHlOYW1lXCJcbiAgICAgICAgICB9LFxuICAgICAgICAgIHByb3BlcnRpZXNDb25maWc6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgaWQ6IFwiaWRcIixcbiAgICAgICAgICAgICAgbmFtZTogXCJJRFwiLFxuICAgICAgICAgICAgICBkYXRhSW5kZXg6IFwiaWRcIixcbiAgICAgICAgICAgICAgZmllbGRUeXBlOiBcInRleHRcIixcbiAgICAgICAgICAgICAgaXNMaXN0YWJsZTogdHJ1ZSxcbiAgICAgICAgICAgICAgaXNTb3J0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICAgIGlzRmlsdGVyYWJsZTogZmFsc2UsXG4gICAgICAgICAgICAgIGlzSWRlbnRpZmllcjogdHJ1ZSxcbiAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgIHsgaWNvbjogXCJ2aWV3XCIsIGxhYmVsOiBcIlZpZXcgRGV0YWlsc1wiLCB1cmw6IFwiL3N5c3RlbS9zZWFyY2gvcmVjb3Jkcy86ZW50aXR5TmFtZS86aWRcIiB9XG4gICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIG5hbWU6IFwiRnVsbCBSZWNvcmRcIixcbiAgICAgICAgICAgICAgZGF0YUluZGV4OiBcImZ1bGxSZWNvcmRcIixcbiAgICAgICAgICAgICAgaWQ6IFwiZnVsbFJlY29yZFwiLFxuICAgICAgICAgICAgICBpc1NvcnRhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgICAgaXNGaWx0ZXJhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgICAgZmllbGRUeXBlOiBcImpzb25cIixcbiAgICAgICAgICAgICAgaXNMaXN0YWJsZTogdHJ1ZVxuICAgICAgICAgICAgfVxuICAgICAgICAgIF1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxufTsgIl19
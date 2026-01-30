"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchIndexSettingsDetailsConfig = void 0;
exports.searchIndexSettingsDetailsConfig = {
    pageTitle: "Search Index Settings",
    pageType: "details",
    routePattern: "/system/search/indices/:entityName/settings-details",
    breadcrumbs: [
        { label: "Home", url: "/" },
        { label: "Search", url: "/system/search" },
        { label: "Indices", url: "/system/search/indices" },
        { label: "Index Details", url: "/system/search/indices/:entityName" },
        { label: "Settings" }
    ],
    pageHeaderActions: [
        {
            label: "Edit Settings",
            url: "/system/search/indices/:entityName/settings-edit",
            type: "button"
        },
        {
            label: "Sync from Schema",
            openInModal: true,
            modalConfig: {
                modalType: "confirm",
                modalPageConfig: {
                    title: "Sync Settings from Entity Schema",
                    content: "This will update index settings to match your entity schema (searchable/filterable/sortable attributes). This will overwrite manually configured settings. Use this when you've updated your entity schema and want to sync those changes to the index."
                },
                apiConfig: {
                    apiMethod: "POST",
                    apiUrl: "/system/search/indices/:entityName/apply-default-settings"
                },
                responseConfig: {
                    showModal: true,
                    modalTitle: "Settings Synced from Schema"
                },
                submitSuccessRedirect: "/system/search/indices/:entityName/settings-details"
            }
        },
        {
            label: "Reset to Meilisearch Defaults",
            openInModal: true,
            modalConfig: {
                modalType: "confirm",
                modalPageConfig: {
                    title: "Reset to Meilisearch Defaults",
                    content: "This will reset all index settings to Meilisearch's default values (searchableAttributes: ['*'], filterableAttributes: [], etc.). Use this to clear all custom configuration. This action cannot be undone."
                },
                apiConfig: {
                    apiMethod: "POST",
                    apiUrl: "/system/search/indices/:entityName/reset-settings"
                },
                submitSuccessRedirect: "/system/search/indices/:entityName/settings-details"
            }
        },
    ],
    detailsPageConfig: {
        detailApiConfig: {
            apiMethod: "GET",
            apiUrl: "/system/search/indices/:entityName/settings"
        },
        propertiesConfig: [
            {
                name: "status",
                label: "📊 Comparison Status",
                id: "status",
                column: "status",
                fieldType: "text",
                helpText: "Shows differences between current index settings and entity schema configuration. This is informational - manual changes to index settings are common and expected."
            }
        ],
        sectionsConfig: {
            renderMode: "tabs",
            lazyLoad: false,
            keepMounted: true,
            sections: {
                diff: {
                    label: "🔍 Schema vs Index",
                    sortOrder: 1,
                    pageType: "details",
                    detailsPageConfig: {
                        useParentData: true,
                        propertiesConfig: [
                            {
                                name: "diff",
                                label: "Differences",
                                id: "diff",
                                column: "diff",
                                fieldType: "json",
                                helpText: "Comparison of searchable/filterable/sortable attributes. 'added' = fields in entity schema but not in index, 'removed' = fields in index but not in schema. Manual differences are normal if you've customized settings."
                            }
                        ]
                    }
                },
                schema: {
                    label: "📋 Default Settings",
                    sortOrder: 2,
                    pageType: "details",
                    detailsPageConfig: {
                        useParentData: true,
                        propertiesConfig: [
                            {
                                name: "schemaSettings",
                                label: "Schema-Derived Settings",
                                id: "schemaSettings",
                                column: "schemaSettings",
                                fieldType: "json",
                                helpText: "Settings derived from your entity schema. These reflect what fields are marked as searchable/filterable/sortable in your code. Use 'Sync from Schema' if you want to apply these."
                            }
                        ]
                    }
                },
                index: {
                    label: "🎯 Live Settings",
                    sortOrder: 3,
                    pageType: "details",
                    detailsPageConfig: {
                        useParentData: true,
                        propertiesConfig: [
                            {
                                name: "settings",
                                label: "Current Index Settings",
                                id: "settings",
                                column: "settings",
                                fieldType: "json",
                                helpText: "Complete settings currently active in your Meilisearch index. Includes both framework-managed fields and any manual Meilisearch-specific configuration you've added."
                            }
                        ]
                    }
                }
            }
        }
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VhcmNoLWluZGV4LXNldHRpbmdzLWRldGFpbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvc2VhcmNoL3N5c3RlbS9jdXN0b20tcGFnZXMtY29uZmlnL3NlYXJjaC1pbmRleC1zZXR0aW5ncy1kZXRhaWxzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVhLFFBQUEsZ0NBQWdDLEdBQXNCO0lBQ2pFLFNBQVMsRUFBRSx1QkFBdUI7SUFDbEMsUUFBUSxFQUFFLFNBQVM7SUFDbkIsWUFBWSxFQUFFLHFEQUFxRDtJQUNuRSxXQUFXLEVBQUU7UUFDWCxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRTtRQUMzQixFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLGdCQUFnQixFQUFFO1FBQzFDLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRSxHQUFHLEVBQUUsd0JBQXdCLEVBQUU7UUFDbkQsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFLEdBQUcsRUFBRSxvQ0FBb0MsRUFBRTtRQUNyRSxFQUFFLEtBQUssRUFBRSxVQUFVLEVBQUU7S0FDdEI7SUFDRCxpQkFBaUIsRUFBRTtRQUNqQjtZQUNFLEtBQUssRUFBRSxlQUFlO1lBQ3RCLEdBQUcsRUFBRSxrREFBa0Q7WUFDdkQsSUFBSSxFQUFFLFFBQVE7U0FDZjtRQUNEO1lBQ0UsS0FBSyxFQUFFLGtCQUFrQjtZQUN6QixXQUFXLEVBQUUsSUFBSTtZQUNqQixXQUFXLEVBQUU7Z0JBQ1gsU0FBUyxFQUFFLFNBQVM7Z0JBQ3BCLGVBQWUsRUFBRTtvQkFDZixLQUFLLEVBQUUsa0NBQWtDO29CQUN6QyxPQUFPLEVBQUUseVBBQXlQO2lCQUNuUTtnQkFDRCxTQUFTLEVBQUU7b0JBQ1QsU0FBUyxFQUFFLE1BQU07b0JBQ2pCLE1BQU0sRUFBRSwyREFBMkQ7aUJBQ3BFO2dCQUNELGNBQWMsRUFBRTtvQkFDZCxTQUFTLEVBQUUsSUFBSTtvQkFDZixVQUFVLEVBQUUsNkJBQTZCO2lCQUMxQztnQkFDRCxxQkFBcUIsRUFBRSxxREFBcUQ7YUFDN0U7U0FDRjtRQUNEO1lBQ0UsS0FBSyxFQUFFLCtCQUErQjtZQUN0QyxXQUFXLEVBQUUsSUFBSTtZQUNqQixXQUFXLEVBQUU7Z0JBQ1gsU0FBUyxFQUFFLFNBQVM7Z0JBQ3BCLGVBQWUsRUFBRTtvQkFDZixLQUFLLEVBQUUsK0JBQStCO29CQUN0QyxPQUFPLEVBQUUsNk1BQTZNO2lCQUN2TjtnQkFDRCxTQUFTLEVBQUU7b0JBQ1QsU0FBUyxFQUFFLE1BQU07b0JBQ2pCLE1BQU0sRUFBRSxtREFBbUQ7aUJBQzVEO2dCQUNELHFCQUFxQixFQUFFLHFEQUFxRDthQUM3RTtTQUNGO0tBQ0Y7SUFDRCxpQkFBaUIsRUFBRTtRQUNqQixlQUFlLEVBQUU7WUFDZixTQUFTLEVBQUUsS0FBSztZQUNoQixNQUFNLEVBQUUsNkNBQTZDO1NBQ3REO1FBQ0QsZ0JBQWdCLEVBQUU7WUFDaEI7Z0JBQ0UsSUFBSSxFQUFFLFFBQVE7Z0JBQ2QsS0FBSyxFQUFFLHNCQUFzQjtnQkFDN0IsRUFBRSxFQUFFLFFBQVE7Z0JBQ1osTUFBTSxFQUFFLFFBQVE7Z0JBQ2hCLFNBQVMsRUFBRSxNQUFNO2dCQUNqQixRQUFRLEVBQUUscUtBQXFLO2FBQ2hMO1NBQ0Y7UUFDRCxjQUFjLEVBQUU7WUFDZCxVQUFVLEVBQUUsTUFBTTtZQUNsQixRQUFRLEVBQUUsS0FBSztZQUNmLFdBQVcsRUFBRSxJQUFJO1lBQ2pCLFFBQVEsRUFBRTtnQkFDUixJQUFJLEVBQUU7b0JBQ0osS0FBSyxFQUFFLG9CQUFvQjtvQkFDM0IsU0FBUyxFQUFFLENBQUM7b0JBQ1osUUFBUSxFQUFFLFNBQVM7b0JBQ25CLGlCQUFpQixFQUFFO3dCQUNqQixhQUFhLEVBQUUsSUFBSTt3QkFDbkIsZ0JBQWdCLEVBQUU7NEJBQ2hCO2dDQUNFLElBQUksRUFBRSxNQUFNO2dDQUNaLEtBQUssRUFBRSxhQUFhO2dDQUNwQixFQUFFLEVBQUUsTUFBTTtnQ0FDVixNQUFNLEVBQUUsTUFBTTtnQ0FDZCxTQUFTLEVBQUUsTUFBTTtnQ0FDakIsUUFBUSxFQUFFLDBOQUEwTjs2QkFDck87eUJBQ0Y7cUJBQ0Y7aUJBQ0Y7Z0JBQ0QsTUFBTSxFQUFFO29CQUNOLEtBQUssRUFBRSxxQkFBcUI7b0JBQzVCLFNBQVMsRUFBRSxDQUFDO29CQUNaLFFBQVEsRUFBRSxTQUFTO29CQUNuQixpQkFBaUIsRUFBRTt3QkFDakIsYUFBYSxFQUFFLElBQUk7d0JBQ25CLGdCQUFnQixFQUFFOzRCQUNoQjtnQ0FDRSxJQUFJLEVBQUUsZ0JBQWdCO2dDQUN0QixLQUFLLEVBQUUseUJBQXlCO2dDQUNoQyxFQUFFLEVBQUUsZ0JBQWdCO2dDQUNwQixNQUFNLEVBQUUsZ0JBQWdCO2dDQUN4QixTQUFTLEVBQUUsTUFBTTtnQ0FDakIsUUFBUSxFQUFFLG1MQUFtTDs2QkFDOUw7eUJBQ0Y7cUJBQ0Y7aUJBQ0Y7Z0JBQ0QsS0FBSyxFQUFFO29CQUNMLEtBQUssRUFBRSxrQkFBa0I7b0JBQ3pCLFNBQVMsRUFBRSxDQUFDO29CQUNaLFFBQVEsRUFBRSxTQUFTO29CQUNuQixpQkFBaUIsRUFBRTt3QkFDakIsYUFBYSxFQUFFLElBQUk7d0JBQ25CLGdCQUFnQixFQUFFOzRCQUNoQjtnQ0FDRSxJQUFJLEVBQUUsVUFBVTtnQ0FDaEIsS0FBSyxFQUFFLHdCQUF3QjtnQ0FDL0IsRUFBRSxFQUFFLFVBQVU7Z0NBQ2QsTUFBTSxFQUFFLFVBQVU7Z0NBQ2xCLFNBQVMsRUFBRSxNQUFNO2dDQUNqQixRQUFRLEVBQUUsc0tBQXNLOzZCQUNqTDt5QkFDRjtxQkFDRjtpQkFDRjthQUNGO1NBQ0Y7S0FDRjtDQUNGLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBEZXRhaWxzUGFnZUNvbmZpZyB9IGZyb20gXCIuLi8uLi8uLi91aS1jb25maWctZ2VuXCI7XG5cbmV4cG9ydCBjb25zdCBzZWFyY2hJbmRleFNldHRpbmdzRGV0YWlsc0NvbmZpZzogRGV0YWlsc1BhZ2VDb25maWcgPSB7XG4gIHBhZ2VUaXRsZTogXCJTZWFyY2ggSW5kZXggU2V0dGluZ3NcIixcbiAgcGFnZVR5cGU6IFwiZGV0YWlsc1wiLFxuICByb3V0ZVBhdHRlcm46IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlcy86ZW50aXR5TmFtZS9zZXR0aW5ncy1kZXRhaWxzXCIsXG4gIGJyZWFkY3J1bWJzOiBbXG4gICAgeyBsYWJlbDogXCJIb21lXCIsIHVybDogXCIvXCIgfSxcbiAgICB7IGxhYmVsOiBcIlNlYXJjaFwiLCB1cmw6IFwiL3N5c3RlbS9zZWFyY2hcIiB9LFxuICAgIHsgbGFiZWw6IFwiSW5kaWNlc1wiLCB1cmw6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlc1wiIH0sXG4gICAgeyBsYWJlbDogXCJJbmRleCBEZXRhaWxzXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaC9pbmRpY2VzLzplbnRpdHlOYW1lXCIgfSxcbiAgICB7IGxhYmVsOiBcIlNldHRpbmdzXCIgfVxuICBdLFxuICBwYWdlSGVhZGVyQWN0aW9uczogW1xuICAgIHsgXG4gICAgICBsYWJlbDogXCJFZGl0IFNldHRpbmdzXCIsIFxuICAgICAgdXJsOiBcIi9zeXN0ZW0vc2VhcmNoL2luZGljZXMvOmVudGl0eU5hbWUvc2V0dGluZ3MtZWRpdFwiLCBcbiAgICAgIHR5cGU6IFwiYnV0dG9uXCIgXG4gICAgfSxcbiAgICB7XG4gICAgICBsYWJlbDogXCJTeW5jIGZyb20gU2NoZW1hXCIsXG4gICAgICBvcGVuSW5Nb2RhbDogdHJ1ZSxcbiAgICAgIG1vZGFsQ29uZmlnOiB7XG4gICAgICAgIG1vZGFsVHlwZTogXCJjb25maXJtXCIsXG4gICAgICAgIG1vZGFsUGFnZUNvbmZpZzoge1xuICAgICAgICAgIHRpdGxlOiBcIlN5bmMgU2V0dGluZ3MgZnJvbSBFbnRpdHkgU2NoZW1hXCIsXG4gICAgICAgICAgY29udGVudDogXCJUaGlzIHdpbGwgdXBkYXRlIGluZGV4IHNldHRpbmdzIHRvIG1hdGNoIHlvdXIgZW50aXR5IHNjaGVtYSAoc2VhcmNoYWJsZS9maWx0ZXJhYmxlL3NvcnRhYmxlIGF0dHJpYnV0ZXMpLiBUaGlzIHdpbGwgb3ZlcndyaXRlIG1hbnVhbGx5IGNvbmZpZ3VyZWQgc2V0dGluZ3MuIFVzZSB0aGlzIHdoZW4geW91J3ZlIHVwZGF0ZWQgeW91ciBlbnRpdHkgc2NoZW1hIGFuZCB3YW50IHRvIHN5bmMgdGhvc2UgY2hhbmdlcyB0byB0aGUgaW5kZXguXCJcbiAgICAgICAgfSxcbiAgICAgICAgYXBpQ29uZmlnOiB7XG4gICAgICAgICAgYXBpTWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgICBhcGlVcmw6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlcy86ZW50aXR5TmFtZS9hcHBseS1kZWZhdWx0LXNldHRpbmdzXCJcbiAgICAgICAgfSxcbiAgICAgICAgcmVzcG9uc2VDb25maWc6IHtcbiAgICAgICAgICBzaG93TW9kYWw6IHRydWUsXG4gICAgICAgICAgbW9kYWxUaXRsZTogXCJTZXR0aW5ncyBTeW5jZWQgZnJvbSBTY2hlbWFcIlxuICAgICAgICB9LFxuICAgICAgICBzdWJtaXRTdWNjZXNzUmVkaXJlY3Q6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlcy86ZW50aXR5TmFtZS9zZXR0aW5ncy1kZXRhaWxzXCJcbiAgICAgIH1cbiAgICB9LFxuICAgIHtcbiAgICAgIGxhYmVsOiBcIlJlc2V0IHRvIE1laWxpc2VhcmNoIERlZmF1bHRzXCIsXG4gICAgICBvcGVuSW5Nb2RhbDogdHJ1ZSxcbiAgICAgIG1vZGFsQ29uZmlnOiB7XG4gICAgICAgIG1vZGFsVHlwZTogXCJjb25maXJtXCIsXG4gICAgICAgIG1vZGFsUGFnZUNvbmZpZzoge1xuICAgICAgICAgIHRpdGxlOiBcIlJlc2V0IHRvIE1laWxpc2VhcmNoIERlZmF1bHRzXCIsXG4gICAgICAgICAgY29udGVudDogXCJUaGlzIHdpbGwgcmVzZXQgYWxsIGluZGV4IHNldHRpbmdzIHRvIE1laWxpc2VhcmNoJ3MgZGVmYXVsdCB2YWx1ZXMgKHNlYXJjaGFibGVBdHRyaWJ1dGVzOiBbJyonXSwgZmlsdGVyYWJsZUF0dHJpYnV0ZXM6IFtdLCBldGMuKS4gVXNlIHRoaXMgdG8gY2xlYXIgYWxsIGN1c3RvbSBjb25maWd1cmF0aW9uLiBUaGlzIGFjdGlvbiBjYW5ub3QgYmUgdW5kb25lLlwiXG4gICAgICAgIH0sXG4gICAgICAgIGFwaUNvbmZpZzoge1xuICAgICAgICAgIGFwaU1ldGhvZDogXCJQT1NUXCIsXG4gICAgICAgICAgYXBpVXJsOiBcIi9zeXN0ZW0vc2VhcmNoL2luZGljZXMvOmVudGl0eU5hbWUvcmVzZXQtc2V0dGluZ3NcIlxuICAgICAgICB9LFxuICAgICAgICBzdWJtaXRTdWNjZXNzUmVkaXJlY3Q6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlcy86ZW50aXR5TmFtZS9zZXR0aW5ncy1kZXRhaWxzXCJcbiAgICAgIH1cbiAgICB9LFxuICBdLFxuICBkZXRhaWxzUGFnZUNvbmZpZzoge1xuICAgIGRldGFpbEFwaUNvbmZpZzogeyBcbiAgICAgIGFwaU1ldGhvZDogXCJHRVRcIiwgXG4gICAgICBhcGlVcmw6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlcy86ZW50aXR5TmFtZS9zZXR0aW5nc1wiIFxuICAgIH0sXG4gICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAge1xuICAgICAgICBuYW1lOiBcInN0YXR1c1wiLFxuICAgICAgICBsYWJlbDogXCLwn5OKIENvbXBhcmlzb24gU3RhdHVzXCIsXG4gICAgICAgIGlkOiBcInN0YXR1c1wiLFxuICAgICAgICBjb2x1bW46IFwic3RhdHVzXCIsXG4gICAgICAgIGZpZWxkVHlwZTogXCJ0ZXh0XCIsXG4gICAgICAgIGhlbHBUZXh0OiBcIlNob3dzIGRpZmZlcmVuY2VzIGJldHdlZW4gY3VycmVudCBpbmRleCBzZXR0aW5ncyBhbmQgZW50aXR5IHNjaGVtYSBjb25maWd1cmF0aW9uLiBUaGlzIGlzIGluZm9ybWF0aW9uYWwgLSBtYW51YWwgY2hhbmdlcyB0byBpbmRleCBzZXR0aW5ncyBhcmUgY29tbW9uIGFuZCBleHBlY3RlZC5cIlxuICAgICAgfVxuICAgIF0sXG4gICAgc2VjdGlvbnNDb25maWc6IHtcbiAgICAgIHJlbmRlck1vZGU6IFwidGFic1wiLFxuICAgICAgbGF6eUxvYWQ6IGZhbHNlLFxuICAgICAga2VlcE1vdW50ZWQ6IHRydWUsXG4gICAgICBzZWN0aW9uczoge1xuICAgICAgICBkaWZmOiB7XG4gICAgICAgICAgbGFiZWw6IFwi8J+UjSBTY2hlbWEgdnMgSW5kZXhcIixcbiAgICAgICAgICBzb3J0T3JkZXI6IDEsXG4gICAgICAgICAgcGFnZVR5cGU6IFwiZGV0YWlsc1wiLFxuICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAgICB7IFxuICAgICAgICAgICAgICAgIG5hbWU6IFwiZGlmZlwiLCBcbiAgICAgICAgICAgICAgICBsYWJlbDogXCJEaWZmZXJlbmNlc1wiLFxuICAgICAgICAgICAgICAgIGlkOiBcImRpZmZcIiwgXG4gICAgICAgICAgICAgICAgY29sdW1uOiBcImRpZmZcIiwgXG4gICAgICAgICAgICAgICAgZmllbGRUeXBlOiBcImpzb25cIixcbiAgICAgICAgICAgICAgICBoZWxwVGV4dDogXCJDb21wYXJpc29uIG9mIHNlYXJjaGFibGUvZmlsdGVyYWJsZS9zb3J0YWJsZSBhdHRyaWJ1dGVzLiAnYWRkZWQnID0gZmllbGRzIGluIGVudGl0eSBzY2hlbWEgYnV0IG5vdCBpbiBpbmRleCwgJ3JlbW92ZWQnID0gZmllbGRzIGluIGluZGV4IGJ1dCBub3QgaW4gc2NoZW1hLiBNYW51YWwgZGlmZmVyZW5jZXMgYXJlIG5vcm1hbCBpZiB5b3UndmUgY3VzdG9taXplZCBzZXR0aW5ncy5cIlxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBdXG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBzY2hlbWE6IHtcbiAgICAgICAgICBsYWJlbDogXCLwn5OLIERlZmF1bHQgU2V0dGluZ3NcIixcbiAgICAgICAgICBzb3J0T3JkZXI6IDIsXG4gICAgICAgICAgcGFnZVR5cGU6IFwiZGV0YWlsc1wiLFxuICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAgICB7IFxuICAgICAgICAgICAgICAgIG5hbWU6IFwic2NoZW1hU2V0dGluZ3NcIiwgXG4gICAgICAgICAgICAgICAgbGFiZWw6IFwiU2NoZW1hLURlcml2ZWQgU2V0dGluZ3NcIiwgXG4gICAgICAgICAgICAgICAgaWQ6IFwic2NoZW1hU2V0dGluZ3NcIiwgXG4gICAgICAgICAgICAgICAgY29sdW1uOiBcInNjaGVtYVNldHRpbmdzXCIsIFxuICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogXCJqc29uXCIsXG4gICAgICAgICAgICAgICAgaGVscFRleHQ6IFwiU2V0dGluZ3MgZGVyaXZlZCBmcm9tIHlvdXIgZW50aXR5IHNjaGVtYS4gVGhlc2UgcmVmbGVjdCB3aGF0IGZpZWxkcyBhcmUgbWFya2VkIGFzIHNlYXJjaGFibGUvZmlsdGVyYWJsZS9zb3J0YWJsZSBpbiB5b3VyIGNvZGUuIFVzZSAnU3luYyBmcm9tIFNjaGVtYScgaWYgeW91IHdhbnQgdG8gYXBwbHkgdGhlc2UuXCJcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgXVxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgaW5kZXg6IHtcbiAgICAgICAgICBsYWJlbDogXCLwn46vIExpdmUgU2V0dGluZ3NcIixcbiAgICAgICAgICBzb3J0T3JkZXI6IDMsXG4gICAgICAgICAgcGFnZVR5cGU6IFwiZGV0YWlsc1wiLFxuICAgICAgICAgIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICB1c2VQYXJlbnREYXRhOiB0cnVlLFxuICAgICAgICAgICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgICAgICAgICB7IFxuICAgICAgICAgICAgICAgIG5hbWU6IFwic2V0dGluZ3NcIiwgXG4gICAgICAgICAgICAgICAgbGFiZWw6IFwiQ3VycmVudCBJbmRleCBTZXR0aW5nc1wiLCBcbiAgICAgICAgICAgICAgICBpZDogXCJzZXR0aW5nc1wiLCBcbiAgICAgICAgICAgICAgICBjb2x1bW46IFwic2V0dGluZ3NcIiwgXG4gICAgICAgICAgICAgICAgZmllbGRUeXBlOiBcImpzb25cIixcbiAgICAgICAgICAgICAgICBoZWxwVGV4dDogXCJDb21wbGV0ZSBzZXR0aW5ncyBjdXJyZW50bHkgYWN0aXZlIGluIHlvdXIgTWVpbGlzZWFyY2ggaW5kZXguIEluY2x1ZGVzIGJvdGggZnJhbWV3b3JrLW1hbmFnZWQgZmllbGRzIGFuZCBhbnkgbWFudWFsIE1laWxpc2VhcmNoLXNwZWNpZmljIGNvbmZpZ3VyYXRpb24geW91J3ZlIGFkZGVkLlwiXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIF1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cbn07ICJdfQ==
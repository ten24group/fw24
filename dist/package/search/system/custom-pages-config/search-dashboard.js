"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchDashboardPage = void 0;
exports.searchDashboardPage = {
    pageTitle: "Search Dashboard",
    pageType: "dashboard",
    routePattern: "/system/search",
    breadcrumbs: [
        { label: "Home", url: "/" },
        { label: "System", url: "/system" },
        { label: "Search Dashboard" }
    ],
    dashboardPageConfig: {
        widgets: [
            {
                type: 'description',
                title: 'Engine Health',
                colSpan: 4,
                dataConfig: {
                    apiUrl: '/system/search/is-healthy',
                    apiMethod: 'GET'
                },
                options: {
                    bordered: true,
                    size: 'small',
                    items: [
                        { key: 'isHealthy', label: 'Is Healthy' }
                    ]
                }
            },
            {
                type: 'description',
                title: 'Engine Version',
                colSpan: 4,
                dataConfig: {
                    apiUrl: '/system/search/version',
                    apiMethod: 'GET'
                },
                options: {
                    bordered: true,
                    size: 'small',
                    items: [
                        { key: 'pkgVersion', label: 'Version' },
                        { key: 'commitSha', label: 'Commit SHA' },
                        { key: 'commitDate', label: 'Commit Date' },
                    ]
                }
            },
            {
                type: 'description',
                title: 'Database Statistics',
                colSpan: 4,
                dataConfig: {
                    apiUrl: '/system/search/stats?includeIndexes=false',
                    apiMethod: 'GET'
                },
                options: {
                    bordered: true,
                    size: 'small',
                    items: [
                        { key: 'databaseSize', label: 'Database Size' },
                        { key: 'usedDatabaseSize', label: 'Used Database Size' },
                        { key: 'lastUpdate', label: 'Last Update' },
                    ]
                }
            },
            // add a description widget to show queue info
            {
                type: 'description',
                title: 'Queue Info',
                colSpan: 4,
                dataConfig: {
                    apiUrl: '/system/search/queue-info',
                    apiMethod: 'GET',
                    responseKey: 'info'
                },
                options: {
                    bordered: true,
                    size: 'small',
                    items: [
                        { key: 'messageCount', label: 'Message Count' },
                        { key: 'delaySeconds', label: 'Delay Seconds' },
                        { key: 'messageCountDelayed', label: 'Message Count Delayed' },
                        { key: 'messageCountNotVisible', label: 'Message Count Not Visible' },
                    ]
                }
            },
            {
                type: 'actions',
                title: 'Search Management',
                colSpan: 4,
                options: {
                    actions: [
                        { label: 'Search Indices', url: '/system/search/indices' },
                        { label: 'Searchable Entities', url: '/system/search/entities' },
                        { label: 'View Tasks', url: '/system/search/tasks' },
                        { label: 'View Batches', url: '/system/search/batches' },
                        { label: 'View API Keys', url: '/system/search/api-keys' },
                    ]
                }
            },
            {
                type: 'actions',
                title: 'Advanced Operations',
                colSpan: 4,
                options: {
                    actions: [
                        { label: 'Experimental Features', url: '/system/search/experimental-features' },
                        {
                            label: 'Create Dump',
                            openInModal: true,
                            modalConfig: {
                                modalType: "confirm",
                                modalPageConfig: {
                                    title: "Create Database Dump",
                                    content: "This will create a full database dump. This operation may take some time."
                                },
                                apiConfig: {
                                    apiMethod: "POST",
                                    apiUrl: "/system/search/dumps"
                                },
                                submitSuccessRedirect: "/system/search/tasks/:taskUid"
                            }
                        },
                        {
                            label: 'Create Snapshot',
                            openInModal: true,
                            modalConfig: {
                                modalType: "confirm",
                                modalPageConfig: {
                                    title: "Create Database Snapshot",
                                    content: "This will create a database snapshot. This operation may take some time. Note: Snapshot functionality requires Meilisearch to be configured with snapshot support."
                                },
                                apiConfig: {
                                    apiMethod: "POST",
                                    apiUrl: "/system/search/snapshots"
                                },
                                submitSuccessRedirect: "/system/search/tasks/:taskUid",
                            }
                        }
                    ]
                }
            },
        ]
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VhcmNoLWRhc2hib2FyZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9zZWFyY2gvc3lzdGVtL2N1c3RvbS1wYWdlcy1jb25maWcvc2VhcmNoLWRhc2hib2FyZC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFFYSxRQUFBLG1CQUFtQixHQUF3QjtJQUN0RCxTQUFTLEVBQUUsa0JBQWtCO0lBQzdCLFFBQVEsRUFBRSxXQUFXO0lBQ3JCLFlBQVksRUFBRSxnQkFBZ0I7SUFDOUIsV0FBVyxFQUFFO1FBQ1gsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUU7UUFDM0IsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLEdBQUcsRUFBRSxTQUFTLEVBQUU7UUFDbkMsRUFBRSxLQUFLLEVBQUUsa0JBQWtCLEVBQUU7S0FDOUI7SUFDRCxtQkFBbUIsRUFBRTtRQUNuQixPQUFPLEVBQUU7WUFDUDtnQkFDRSxJQUFJLEVBQUUsYUFBYTtnQkFDbkIsS0FBSyxFQUFFLGVBQWU7Z0JBQ3RCLE9BQU8sRUFBRSxDQUFDO2dCQUNWLFVBQVUsRUFBRTtvQkFDVixNQUFNLEVBQUUsMkJBQTJCO29CQUNuQyxTQUFTLEVBQUUsS0FBSztpQkFDakI7Z0JBQ0QsT0FBTyxFQUFFO29CQUNQLFFBQVEsRUFBRSxJQUFJO29CQUNkLElBQUksRUFBRSxPQUFPO29CQUNiLEtBQUssRUFBRTt3QkFDTCxFQUFFLEdBQUcsRUFBRSxXQUFXLEVBQUUsS0FBSyxFQUFFLFlBQVksRUFBRTtxQkFDMUM7aUJBQ0Y7YUFDRjtZQUVEO2dCQUNFLElBQUksRUFBRSxhQUFhO2dCQUNuQixLQUFLLEVBQUUsZ0JBQWdCO2dCQUN2QixPQUFPLEVBQUUsQ0FBQztnQkFDVixVQUFVLEVBQUU7b0JBQ1YsTUFBTSxFQUFFLHdCQUF3QjtvQkFDaEMsU0FBUyxFQUFFLEtBQUs7aUJBQ2pCO2dCQUNELE9BQU8sRUFBRTtvQkFDUCxRQUFRLEVB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Z0NBQ0QsU0FBUyxFQUFFO29DQUNULFNBQVMsRUFBRSxNQUFNO29DQUNqQixNQUFNLEVBQUUsc0JBQXNCO2lDQUMvQjtnQ0FDRCxxQkFBcUIsRUFBRSwrQkFBK0I7NkJBQ3ZEO3lCQUNGO3dCQUNEOzRCQUNFLEtBQUssRUFBRSxpQkFBaUI7NEJBQ3hCLFdBQVcsRUFBRSxJQUFJOzRCQUNqQixXQUFXLEVBQUU7Z0NBQ1gsU0FBUyxFQUFFLFNBQVM7Z0NBQ3BCLGVBQWUsRUFBRTtvQ0FDZixLQUFLLEVBQUUsMEJBQTBCO29DQUNqQyxPQUFPLEVBQUUsb0tBQW9LO2lDQUM5SztnQ0FDRCxTQUFTLEVBQUU7b0NBQ1QsU0FBUyxFQUFFLE1BQU07b0NBQ2pCLE1BQU0sRUFBRSwwQkFBMEI7aUNBQ25DO2dDQUNELHFCQUFxQixFQUFFLCtCQUErQjs2QkFDdkQ7eUJBQ0Y7cUJBQ0Y7aUJBQ0Y7YUFDRjtTQUNGO0tBQ0Y7Q0FDRixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRGFzaGJvYXJkUGFnZUNvbmZpZyB9IGZyb20gXCIuLi8uLi8uLi91aS1jb25maWctZ2VuXCI7XG5cbmV4cG9ydCBjb25zdCBzZWFyY2hEYXNoYm9hcmRQYWdlOiBEYXNoYm9hcmRQYWdlQ29uZmlnID0ge1xuICBwYWdlVGl0bGU6IFwiU2VhcmNoIERhc2hib2FyZFwiLFxuICBwYWdlVHlwZTogXCJkYXNoYm9hcmRcIixcbiAgcm91dGVQYXR0ZXJuOiBcIi9zeXN0ZW0vc2VhcmNoXCIsXG4gIGJyZWFkY3J1bWJzOiBbXG4gICAgeyBsYWJlbDogXCJIb21lXCIsIHVybDogXCIvXCIgfSxcbiAgICB7IGxhYmVsOiBcIlN5c3RlbVwiLCB1cmw6IFwiL3N5c3RlbVwiIH0sXG4gICAgeyBsYWJlbDogXCJTZWFyY2ggRGFzaGJvYXJkXCIgfVxuICBdLFxuICBkYXNoYm9hcmRQYWdlQ29uZmlnOiB7XG4gICAgd2lkZ2V0czogW1xuICAgICAge1xuICAgICAgICB0eXBlOiAnZGVzY3JpcHRpb24nLFxuICAgICAgICB0aXRsZTogJ0VuZ2luZSBIZWFsdGgnLFxuICAgICAgICBjb2xTcGFuOiA0LFxuICAgICAgICBkYXRhQ29uZmlnOiB7XG4gICAgICAgICAgYXBpVXJsOiAnL3N5c3RlbS9zZWFyY2gvaXMtaGVhbHRoeScsXG4gICAgICAgICAgYXBpTWV0aG9kOiAnR0VUJ1xuICAgICAgICB9LFxuICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgYm9yZGVyZWQ6IHRydWUsXG4gICAgICAgICAgc2l6ZTogJ3NtYWxsJyxcbiAgICAgICAgICBpdGVtczogW1xuICAgICAgICAgICAgeyBrZXk6ICdpc0hlYWx0aHknLCBsYWJlbDogJ0lzIEhlYWx0aHknIH1cbiAgICAgICAgICBdXG4gICAgICAgIH1cbiAgICAgIH0sXG5cbiAgICAgIHtcbiAgICAgICAgdHlwZTogJ2Rlc2NyaXB0aW9uJyxcbiAgICAgICAgdGl0bGU6ICdFbmdpbmUgVmVyc2lvbicsXG4gICAgICAgIGNvbFNwYW46IDQsXG4gICAgICAgIGRhdGFDb25maWc6IHtcbiAgICAgICAgICBhcGlVcmw6ICcvc3lzdGVtL3NlYXJjaC92ZXJzaW9uJyxcbiAgICAgICAgICBhcGlNZXRob2Q6ICdHRVQnXG4gICAgICAgIH0sXG4gICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICBib3JkZXJlZDogdHJ1ZSxcbiAgICAgICAgICBzaXplOiAnc21hbGwnLFxuICAgICAgICAgIGl0ZW1zOiBbXG4gICAgICAgICAgICB7IGtleTogJ3BrZ1ZlcnNpb24nLCBsYWJlbDogJ1ZlcnNpb24nIH0sXG4gICAgICAgICAgICB7IGtleTogJ2NvbW1pdFNoYScsIGxhYmVsOiAnQ29tbWl0IFNIQScgfSxcbiAgICAgICAgICAgIHsga2V5OiAnY29tbWl0RGF0ZScsIGxhYmVsOiAnQ29tbWl0IERhdGUnIH0sXG4gICAgICAgICAgXVxuICAgICAgICB9XG4gICAgICB9LFxuXG4gICAgICB7XG4gICAgICAgIHR5cGU6ICdkZXNjcmlwdGlvbicsXG4gICAgICAgIHRpdGxlOiAnRGF0YWJhc2UgU3RhdGlzdGljcycsXG4gICAgICAgIGNvbFNwYW46IDQsXG4gICAgICAgIGRhdGFDb25maWc6IHtcbiAgICAgICAgICBhcGlVcmw6ICcvc3lzdGVtL3NlYXJjaC9zdGF0cz9pbmNsdWRlSW5kZXhlcz1mYWxzZScsXG4gICAgICAgICAgYXBpTWV0aG9kOiAnR0VUJ1xuICAgICAgICB9LFxuICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgYm9yZGVyZWQ6IHRydWUsXG4gICAgICAgICAgc2l6ZTogJ3NtYWxsJyxcbiAgICAgICAgICBpdGVtczogW1xuICAgICAgICAgICAgeyBrZXk6ICdkYXRhYmFzZVNpemUnLCBsYWJlbDogJ0RhdGFiYXNlIFNpemUnIH0sXG4gICAgICAgICAgICB7IGtleTogJ3VzZWREYXRhYmFzZVNpemUnLCBsYWJlbDogJ1VzZWQgRGF0YWJhc2UgU2l6ZScgfSxcbiAgICAgICAgICAgIHsga2V5OiAnbGFzdFVwZGF0ZScsIGxhYmVsOiAnTGFzdCBVcGRhdGUnIH0sXG4gICAgICAgICAgXVxuICAgICAgICB9XG4gICAgICB9LFxuXG4gICAgICAvLyBhZGQgYSBkZXNjcmlwdGlvbiB3aWRnZXQgdG8gc2hvdyBxdWV1ZSBpbmZvXG4gICAgICB7XG4gICAgICAgIHR5cGU6ICdkZXNjcmlwdGlvbicsXG4gICAgICAgIHRpdGxlOiAnUXVldWUgSW5mbycsXG4gICAgICAgIGNvbFNwYW46IDQsXG4gICAgICAgIGRhdGFDb25maWc6IHtcbiAgICAgICAgICBhcGlVcmw6ICcvc3lzdGVtL3NlYXJjaC9xdWV1ZS1pbmZvJywgIFxuICAgICAgICAgIGFwaU1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgcmVzcG9uc2VLZXk6ICdpbmZvJ1xuICAgICAgICB9LFxuICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgYm9yZGVyZWQ6IHRydWUsXG4gICAgICAgICAgc2l6ZTogJ3NtYWxsJyxcbiAgICAgICAgICBpdGVtczogWyAgXG4gICAgICAgICAgICB7IGtleTogJ21lc3NhZ2VDb3VudCcsIGxhYmVsOiAnTWVzc2FnZSBDb3VudCcgfSxcbiAgICAgICAgICAgIHsga2V5OiAnZGVsYXlTZWNvbmRzJywgbGFiZWw6ICdEZWxheSBTZWNvbmRzJyB9LFxuICAgICAgICAgICAgeyBrZXk6ICdtZXNzYWdlQ291bnREZWxheWVkJywgbGFiZWw6ICdNZXNzYWdlIENvdW50IERlbGF5ZWQnIH0sXG4gICAgICAgICAgICB7IGtleTogJ21lc3NhZ2VDb3VudE5vdFZpc2libGUnLCBsYWJlbDogJ01lc3NhZ2UgQ291bnQgTm90IFZpc2libGUnIH0sXG4gICAgICAgICAgXVxuICAgICAgICB9XG4gICAgICB9LFxuXG4gICAgICB7XG4gICAgICAgIHR5cGU6ICdhY3Rpb25zJyxcbiAgICAgICAgdGl0bGU6ICdTZWFyY2ggTWFuYWdlbWVudCcsXG4gICAgICAgIGNvbFNwYW46IDQsXG4gICAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICB7IGxhYmVsOiAnU2VhcmNoIEluZGljZXMnLCB1cmw6ICcvc3lzdGVtL3NlYXJjaC9pbmRpY2VzJyB9LFxuICAgICAgICAgICAgeyBsYWJlbDogJ1NlYXJjaGFibGUgRW50aXRpZXMnLCB1cmw6ICcvc3lzdGVtL3NlYXJjaC9lbnRpdGllcycgfSxcbiAgICAgICAgICAgIHsgbGFiZWw6ICdWaWV3IFRhc2tzJywgdXJsOiAnL3N5c3RlbS9zZWFyY2gvdGFza3MnIH0sXG4gICAgICAgICAgICB7IGxhYmVsOiAnVmlldyBCYXRjaGVzJywgdXJsOiAnL3N5c3RlbS9zZWFyY2gvYmF0Y2hlcycgfSxcbiAgICAgICAgICAgIHsgbGFiZWw6ICdWaWV3IEFQSSBLZXlzJywgdXJsOiAnL3N5c3RlbS9zZWFyY2gvYXBpLWtleXMnIH0sXG4gICAgICAgICAgXVxuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgXG4gICAgICB7XG4gICAgICAgIHR5cGU6ICdhY3Rpb25zJyxcbiAgICAgICAgdGl0bGU6ICdBZHZhbmNlZCBPcGVyYXRpb25zJyxcbiAgICAgICAgY29sU3BhbjogNCxcbiAgICAgICAgb3B0aW9uczoge1xuICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgIHsgbGFiZWw6ICdFeHBlcmltZW50YWwgRmVhdHVyZXMnLCB1cmw6ICcvc3lzdGVtL3NlYXJjaC9leHBlcmltZW50YWwtZmVhdHVyZXMnIH0sXG4gICAgICAgICAgICB7IFxuICAgICAgICAgICAgICBsYWJlbDogJ0NyZWF0ZSBEdW1wJywgXG4gICAgICAgICAgICAgIG9wZW5Jbk1vZGFsOiB0cnVlLFxuICAgICAgICAgICAgICBtb2RhbENvbmZpZzoge1xuICAgICAgICAgICAgICAgIG1vZGFsVHlwZTogXCJjb25maXJtXCIsXG4gICAgICAgICAgICAgICAgbW9kYWxQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICB0aXRsZTogXCJDcmVhdGUgRGF0YWJhc2UgRHVtcFwiLFxuICAgICAgICAgICAgICAgICAgY29udGVudDogXCJUaGlzIHdpbGwgY3JlYXRlIGEgZnVsbCBkYXRhYmFzZSBkdW1wLiBUaGlzIG9wZXJhdGlvbiBtYXkgdGFrZSBzb21lIHRpbWUuXCJcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGFwaUNvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgYXBpTWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgICAgICAgICAgIGFwaVVybDogXCIvc3lzdGVtL3NlYXJjaC9kdW1wc1wiXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBzdWJtaXRTdWNjZXNzUmVkaXJlY3Q6IFwiL3N5c3RlbS9zZWFyY2gvdGFza3MvOnRhc2tVaWRcIlxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgeyBcbiAgICAgICAgICAgICAgbGFiZWw6ICdDcmVhdGUgU25hcHNob3QnLCBcbiAgICAgICAgICAgICAgb3BlbkluTW9kYWw6IHRydWUsXG4gICAgICAgICAgICAgIG1vZGFsQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgbW9kYWxUeXBlOiBcImNvbmZpcm1cIixcbiAgICAgICAgICAgICAgICBtb2RhbFBhZ2VDb25maWc6IHtcbiAgICAgICAgICAgICAgICAgIHRpdGxlOiBcIkNyZWF0ZSBEYXRhYmFzZSBTbmFwc2hvdFwiLFxuICAgICAgICAgICAgICAgICAgY29udGVudDogXCJUaGlzIHdpbGwgY3JlYXRlIGEgZGF0YWJhc2Ugc25hcHNob3QuIFRoaXMgb3BlcmF0aW9uIG1heSB0YWtlIHNvbWUgdGltZS4gTm90ZTogU25hcHNob3QgZnVuY3Rpb25hbGl0eSByZXF1aXJlcyBNZWlsaXNlYXJjaCB0byBiZSBjb25maWd1cmVkIHdpdGggc25hcHNob3Qgc3VwcG9ydC5cIlxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgYXBpQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICBhcGlNZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgICAgICAgICAgICAgYXBpVXJsOiBcIi9zeXN0ZW0vc2VhcmNoL3NuYXBzaG90c1wiXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBzdWJtaXRTdWNjZXNzUmVkaXJlY3Q6IFwiL3N5c3RlbS9zZWFyY2gvdGFza3MvOnRhc2tVaWRcIixcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIF1cbiAgICAgICAgfVxuICAgICAgfSxcbiAgICBdXG4gIH1cbn07ICJdfQ==
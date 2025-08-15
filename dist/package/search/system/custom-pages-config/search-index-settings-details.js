"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchIndexSettingsDetailsConfig = void 0;
exports.searchIndexSettingsDetailsConfig = {
    pageTitle: "Search Index Settings Details",
    pageType: "details",
    routePattern: "/system/search/indices/:entityName/settings-details",
    breadcrumbs: [
        { label: "Home", url: "/" },
        { label: "Search", url: "/system/search" },
        { label: "Indices", url: "/system/search/indices" },
        { label: "Index Details", url: "/system/search/indices/:entityName" },
        { label: "Settings Details" }
    ],
    pageHeaderActions: [
        {
            label: "Edit Settings",
            url: "/system/search/indices/:entityName/settings-edit",
            type: "button"
        },
        {
            label: "Reset Settings",
            openInModal: true,
            modalConfig: {
                modalType: "confirm",
                modalPageConfig: {
                    title: "Reset Index Settings",
                    content: "This will reset all index settings to their default values. This action cannot be undone."
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
                name: "settings",
                label: "Displayed Attributes",
                id: "settings",
                column: "settings",
                fieldType: "json"
            }
        ]
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VhcmNoLWluZGV4LXNldHRpbmdzLWRldGFpbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvc2VhcmNoL3N5c3RlbS9jdXN0b20tcGFnZXMtY29uZmlnL3NlYXJjaC1pbmRleC1zZXR0aW5ncy1kZXRhaWxzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVhLFFBQUEsZ0NBQWdDLEdBQXNCO0lBQ2pFLFNBQVMsRUFBRSwrQkFBK0I7SUFDMUMsUUFBUSxFQUFFLFNBQVM7SUFDbkIsWUFBWSxFQUFFLHFEQUFxRDtJQUNuRSxXQUFXLEVBQUU7UUFDWCxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRTtRQUMzQixFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLGdCQUFnQixFQUFFO1FBQzFDLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRSxHQUFHLEVBQUUsd0JBQXdCLEVBQUU7UUFDbkQsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFLEdBQUcsRUFBRSxvQ0FBb0MsRUFBRTtRQUNyRSxFQUFFLEtBQUssRUFBRSxrQkFBa0IsRUFBRTtLQUM5QjtJQUNELGlCQUFpQixFQUFFO1FBQ2pCO1lBQ0UsS0FBSyxFQUFFLGVBQWU7WUFDdEIsR0FBRyxFQUFFLGtEQUFrRDtZQUN2RCxJQUFJLEVBQUUsUUFBUTtTQUNmO1FBQ0Q7WUFDRSxLQUFLLEVBQUUsZ0JBQWdCO1lBQ3ZCLFdBQVcsRUFBRSxJQUFJO1lBQ2pCLFdBQVcsRUFBRTtnQkFDWCxTQUFTLEVBQUUsU0FBUztnQkFDcEIsZUFBZSxFQUFFO29CQUNmLEtBQUssRUFBRSxzQkFBc0I7b0JBQzdCLE9BQU8sRUFBRSwyRkFBMkY7aUJBQ3JHO2dCQUNELFNBQVMsRUFBRTtvQkFDVCxTQUFTLEVBQUUsTUFBTTtvQkFDakIsTUFBTSxFQUFFLG1EQUFtRDtpQkFDNUQ7Z0JBQ0QscUJBQXFCLEVBQUUscURBQXFEO2FBQzdFO1NBQ0Y7S0FDRjtJQUNELGlCQUFpQixFQUFFO1FBQ2pCLGVBQWUsRUFBRTtZQUNmLFNBQVMsRUFBRSxLQUFLO1lBQ2hCLE1BQU0sRUFBRSw2Q0FBNkM7U0FDdEQ7UUFDRCxnQkFBZ0IsRUFBRTtZQUNoQjtnQkFDRSxJQUFJLEVBQUUsVUFBVTtnQkFDaEIsS0FBSyxFQUFFLHNCQUFzQjtnQkFDN0IsRUFBRSxFQUFFLFVBQVU7Z0JBQ2QsTUFBTSxFQUFFLFVBQVU7Z0JBQ2xCLFNBQVMsRUFBRSxNQUFNO2FBQ2xCO1NBQ0Y7S0FDRjtDQUNGLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBEZXRhaWxzUGFnZUNvbmZpZyB9IGZyb20gXCIuLi8uLi8uLi91aS1jb25maWctZ2VuXCI7XG5cbmV4cG9ydCBjb25zdCBzZWFyY2hJbmRleFNldHRpbmdzRGV0YWlsc0NvbmZpZzogRGV0YWlsc1BhZ2VDb25maWcgPSB7XG4gIHBhZ2VUaXRsZTogXCJTZWFyY2ggSW5kZXggU2V0dGluZ3MgRGV0YWlsc1wiLFxuICBwYWdlVHlwZTogXCJkZXRhaWxzXCIsXG4gIHJvdXRlUGF0dGVybjogXCIvc3lzdGVtL3NlYXJjaC9pbmRpY2VzLzplbnRpdHlOYW1lL3NldHRpbmdzLWRldGFpbHNcIixcbiAgYnJlYWRjcnVtYnM6IFtcbiAgICB7IGxhYmVsOiBcIkhvbWVcIiwgdXJsOiBcIi9cIiB9LFxuICAgIHsgbGFiZWw6IFwiU2VhcmNoXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaFwiIH0sXG4gICAgeyBsYWJlbDogXCJJbmRpY2VzXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaC9pbmRpY2VzXCIgfSxcbiAgICB7IGxhYmVsOiBcIkluZGV4IERldGFpbHNcIiwgdXJsOiBcIi9zeXN0ZW0vc2VhcmNoL2luZGljZXMvOmVudGl0eU5hbWVcIiB9LFxuICAgIHsgbGFiZWw6IFwiU2V0dGluZ3MgRGV0YWlsc1wiIH1cbiAgXSxcbiAgcGFnZUhlYWRlckFjdGlvbnM6IFtcbiAgICB7IFxuICAgICAgbGFiZWw6IFwiRWRpdCBTZXR0aW5nc1wiLCBcbiAgICAgIHVybDogXCIvc3lzdGVtL3NlYXJjaC9pbmRpY2VzLzplbnRpdHlOYW1lL3NldHRpbmdzLWVkaXRcIiwgXG4gICAgICB0eXBlOiBcImJ1dHRvblwiIFxuICAgIH0sXG4gICAge1xuICAgICAgbGFiZWw6IFwiUmVzZXQgU2V0dGluZ3NcIixcbiAgICAgIG9wZW5Jbk1vZGFsOiB0cnVlLFxuICAgICAgbW9kYWxDb25maWc6IHtcbiAgICAgICAgbW9kYWxUeXBlOiBcImNvbmZpcm1cIixcbiAgICAgICAgbW9kYWxQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgdGl0bGU6IFwiUmVzZXQgSW5kZXggU2V0dGluZ3NcIixcbiAgICAgICAgICBjb250ZW50OiBcIlRoaXMgd2lsbCByZXNldCBhbGwgaW5kZXggc2V0dGluZ3MgdG8gdGhlaXIgZGVmYXVsdCB2YWx1ZXMuIFRoaXMgYWN0aW9uIGNhbm5vdCBiZSB1bmRvbmUuXCJcbiAgICAgICAgfSxcbiAgICAgICAgYXBpQ29uZmlnOiB7XG4gICAgICAgICAgYXBpTWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgICBhcGlVcmw6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlcy86ZW50aXR5TmFtZS9yZXNldC1zZXR0aW5nc1wiXG4gICAgICAgIH0sXG4gICAgICAgIHN1Ym1pdFN1Y2Nlc3NSZWRpcmVjdDogXCIvc3lzdGVtL3NlYXJjaC9pbmRpY2VzLzplbnRpdHlOYW1lL3NldHRpbmdzLWRldGFpbHNcIlxuICAgICAgfVxuICAgIH0sXG4gIF0sXG4gIGRldGFpbHNQYWdlQ29uZmlnOiB7XG4gICAgZGV0YWlsQXBpQ29uZmlnOiB7IFxuICAgICAgYXBpTWV0aG9kOiBcIkdFVFwiLCBcbiAgICAgIGFwaVVybDogXCIvc3lzdGVtL3NlYXJjaC9pbmRpY2VzLzplbnRpdHlOYW1lL3NldHRpbmdzXCIgXG4gICAgfSxcbiAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gICAgICB7IFxuICAgICAgICBuYW1lOiBcInNldHRpbmdzXCIsIFxuICAgICAgICBsYWJlbDogXCJEaXNwbGF5ZWQgQXR0cmlidXRlc1wiLCBcbiAgICAgICAgaWQ6IFwic2V0dGluZ3NcIiwgXG4gICAgICAgIGNvbHVtbjogXCJzZXR0aW5nc1wiLCBcbiAgICAgICAgZmllbGRUeXBlOiBcImpzb25cIiBcbiAgICAgIH1cbiAgICBdXG4gIH1cbn07ICJdfQ==
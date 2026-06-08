"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchIndicesConfig = void 0;
exports.searchIndicesConfig = {
    pageTitle: "Search Indices",
    pageType: "list",
    routePattern: "/system/search/indices",
    breadcrumbs: [
        { label: "Home", url: "/" },
        { label: "Search", url: "/system/search" },
        { label: "Indices" }
    ],
    pageHeaderActions: [
        {
            label: "Initialize All Indices",
            openInModal: true,
            modalConfig: {
                modalType: "confirm",
                modalPageConfig: {
                    title: "Are you sure you want to initialize all indices?",
                },
                apiConfig: {
                    apiMethod: "POST",
                    responseKey: "message",
                    apiUrl: "/system/search/initIndices"
                },
                submitSuccessRedirect: "/system/search/indices"
            }
        }
    ],
    listPageConfig: {
        apiConfig: { apiMethod: "GET", responseKey: "indices", apiUrl: "/system/search/indices" },
        propertiesConfig: [
            {
                name: "Entity Name",
                dataIndex: "entityName",
                id: "entityName",
                fieldType: "text",
                isListable: true,
                isIdentifier: true,
                actions: [
                    { icon: "view", label: "Details", url: "/system/search/indices/:entityName" }
                ]
            },
            { name: "Index Name", dataIndex: "indexName", id: "indexName", fieldType: "text", isListable: true },
            { name: "Primary Key", dataIndex: "primaryKey", id: "primaryKey", fieldType: "text", isListable: true },
            { name: "Created At", dataIndex: "createdAt", id: "createdAt", fieldType: "datetime", isListable: true },
            { name: "Updated At", dataIndex: "updatedAt", id: "updatedAt", fieldType: "datetime", isListable: true },
            { name: "Error", dataIndex: "error", id: "error", fieldType: "text", isListable: true }
        ]
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VhcmNoLWluZGljZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvc2VhcmNoL3N5c3RlbS9jdXN0b20tcGFnZXMtY29uZmlnL3NlYXJjaC1pbmRpY2VzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVhLFFBQUEsbUJBQW1CLEdBQW1CO0lBQ2pELFNBQVMsRUFBRSxnQkFBZ0I7SUFDM0IsUUFBUSxFQUFFLE1BQU07SUFDaEIsWUFBWSxFQUFFLHdCQUF3QjtJQUN0QyxXQUFXLEVBQUU7UUFDWCxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRTtRQUMzQixFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLGdCQUFnQixFQUFFO1FBQzFDLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRTtLQUNyQjtJQUNELGlCQUFpQixFQUFFO1FBQ2pCO1lBQ0UsS0FBSyxFQUFFLHdCQUF3QjtZQUMvQixXQUFXLEVBQUUsSUFBSTtZQUNqQixXQUFXLEVBQUU7Z0JBQ1gsU0FBUyxFQUFFLFNBQVM7Z0JBQ3BCLGVBQWUsRUFBRTtvQkFDZixLQUFLLEVBQUUsa0RBQWtEO2lCQUMxRDtnQkFDRCxTQUFTLEVBQUU7b0JBQ1QsU0FBUyxFQUFFLE1BQU07b0JBQ2pCLFdBQVcsRUFBRSxTQUFTO29CQUN0QixNQUFNLEVBQUUsNEJBQTRCO2lCQUNyQztnQkFDRCxxQkFBcUIsRUFBRSx3QkFBd0I7YUFDaEQ7U0FDRjtLQUNGO0lBQ0QsY0FBYyxFQUFFO1FBQ2QsU0FBUyxFQUFFLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBRSxXQUFXLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSx3QkFBd0IsRUFBRTtRQUN6RixnQkFBZ0IsRUFBRTtZQUNoQjtnQkFDRSxJQUFJLEVBQUUsYUFBYTtnQkFDbkIsU0FBUyxFQUFFLFlBQVk7Z0JBQ3ZCLEVBQUUsRUFBRSxZQUFZO2dCQUNoQixTQUFTLEVBQUUsTUFBTTtnQkFDakIsVUFBVSxFQUFFLElBQUk7Z0JBQ2hCLFlBQVksRUFBRSxJQUFJO2dCQUNsQixPQUFPLEVBQUU7b0JBQ1AsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsR0FBRyxFQUFFLG9DQUFvQyxFQUFFO2lCQUM5RTthQUNGO1lBQ0QsRUFBRSxJQUFJLEVBQUUsWUFBWSxFQUFFLFNBQVMsRUFBRSxXQUFXLEVBQUUsRUFBRSxFQUFFLFdBQVcsRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFLFVBQVUsRUFBRSxJQUFJLEVBQUU7WUFDcEcsRUFBRSxJQUFJLEVBQUUsYUFBYSxFQUFFLFNBQVMsRUFBRSxZQUFZLEVBQUUsRUFBRSxFQUFFLFlBQVksRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFLFVBQVUsRUFBRSxJQUFJLEVBQUU7WUFDdkcsRUFBRSxJQUFJLEVBQUUsWUFBWSxFQUFFLFNBQVMsRUFBRSxXQUFXLEVBQUUsRUFBRSxFQUFFLFdBQVcsRUFBRSxTQUFTLEVBQUUsVUFBVSxFQUFFLFVBQVUsRUFBRSxJQUFJLEVBQUU7WUFDeEcsRUFBRSxJQUFJLEVBQUUsWUFBWSxFQUFFLFNBQVMsRUFBRSxXQUFXLEVBQUUsRUFBRSxFQUFFLFdBQVcsRUFBRSxTQUFTLEVBQUUsVUFBVSxFQUFFLFVBQVUsRUFBRSxJQUFJLEVBQUU7WUFDeEcsRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFFLFNBQVMsRUFBRSxPQUFPLEVBQUUsRUFBRSxFQUFFLE9BQU8sRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFLFVBQVUsRUFBRSxJQUFJLEVBQUU7U0FFeEY7S0FDRjtDQUNGLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBMaXN0UGFnZUNvbmZpZyB9IGZyb20gXCIuLi8uLi8uLi91aS1jb25maWctZ2VuXCI7XG5cbmV4cG9ydCBjb25zdCBzZWFyY2hJbmRpY2VzQ29uZmlnOiBMaXN0UGFnZUNvbmZpZyA9IHtcbiAgcGFnZVRpdGxlOiBcIlNlYXJjaCBJbmRpY2VzXCIsXG4gIHBhZ2VUeXBlOiBcImxpc3RcIixcbiAgcm91dGVQYXR0ZXJuOiBcIi9zeXN0ZW0vc2VhcmNoL2luZGljZXNcIixcbiAgYnJlYWRjcnVtYnM6IFtcbiAgICB7IGxhYmVsOiBcIkhvbWVcIiwgdXJsOiBcIi9cIiB9LFxuICAgIHsgbGFiZWw6IFwiU2VhcmNoXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaFwiIH0sXG4gICAgeyBsYWJlbDogXCJJbmRpY2VzXCIgfVxuICBdLFxuICBwYWdlSGVhZGVyQWN0aW9uczogW1xuICAgIHtcbiAgICAgIGxhYmVsOiBcIkluaXRpYWxpemUgQWxsIEluZGljZXNcIixcbiAgICAgIG9wZW5Jbk1vZGFsOiB0cnVlLFxuICAgICAgbW9kYWxDb25maWc6IHtcbiAgICAgICAgbW9kYWxUeXBlOiBcImNvbmZpcm1cIixcbiAgICAgICAgbW9kYWxQYWdlQ29uZmlnOiB7XG4gICAgICAgICAgdGl0bGU6IFwiQXJlIHlvdSBzdXJlIHlvdSB3YW50IHRvIGluaXRpYWxpemUgYWxsIGluZGljZXM/XCIsXG4gICAgICAgIH0sXG4gICAgICAgIGFwaUNvbmZpZzoge1xuICAgICAgICAgIGFwaU1ldGhvZDogXCJQT1NUXCIsXG4gICAgICAgICAgcmVzcG9uc2VLZXk6IFwibWVzc2FnZVwiLFxuICAgICAgICAgIGFwaVVybDogXCIvc3lzdGVtL3NlYXJjaC9pbml0SW5kaWNlc1wiXG4gICAgICAgIH0sXG4gICAgICAgIHN1Ym1pdFN1Y2Nlc3NSZWRpcmVjdDogXCIvc3lzdGVtL3NlYXJjaC9pbmRpY2VzXCJcbiAgICAgIH1cbiAgICB9XG4gIF0sXG4gIGxpc3RQYWdlQ29uZmlnOiB7XG4gICAgYXBpQ29uZmlnOiB7IGFwaU1ldGhvZDogXCJHRVRcIiwgcmVzcG9uc2VLZXk6IFwiaW5kaWNlc1wiLCBhcGlVcmw6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlc1wiIH0sXG4gICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgeyBcbiAgICAgICAgbmFtZTogXCJFbnRpdHkgTmFtZVwiLCBcbiAgICAgICAgZGF0YUluZGV4OiBcImVudGl0eU5hbWVcIiwgXG4gICAgICAgIGlkOiBcImVudGl0eU5hbWVcIiwgXG4gICAgICAgIGZpZWxkVHlwZTogXCJ0ZXh0XCIsIFxuICAgICAgICBpc0xpc3RhYmxlOiB0cnVlLCBcbiAgICAgICAgaXNJZGVudGlmaWVyOiB0cnVlLFxuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgeyBpY29uOiBcInZpZXdcIiwgbGFiZWw6IFwiRGV0YWlsc1wiLCB1cmw6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlcy86ZW50aXR5TmFtZVwiIH1cbiAgICAgICAgXVxuICAgICAgfSxcbiAgICAgIHsgbmFtZTogXCJJbmRleCBOYW1lXCIsIGRhdGFJbmRleDogXCJpbmRleE5hbWVcIiwgaWQ6IFwiaW5kZXhOYW1lXCIsIGZpZWxkVHlwZTogXCJ0ZXh0XCIsIGlzTGlzdGFibGU6IHRydWUgfSxcbiAgICAgIHsgbmFtZTogXCJQcmltYXJ5IEtleVwiLCBkYXRhSW5kZXg6IFwicHJpbWFyeUtleVwiLCBpZDogXCJwcmltYXJ5S2V5XCIsIGZpZWxkVHlwZTogXCJ0ZXh0XCIsIGlzTGlzdGFibGU6IHRydWUgfSxcbiAgICAgIHsgbmFtZTogXCJDcmVhdGVkIEF0XCIsIGRhdGFJbmRleDogXCJjcmVhdGVkQXRcIiwgaWQ6IFwiY3JlYXRlZEF0XCIsIGZpZWxkVHlwZTogXCJkYXRldGltZVwiLCBpc0xpc3RhYmxlOiB0cnVlIH0sXG4gICAgICB7IG5hbWU6IFwiVXBkYXRlZCBBdFwiLCBkYXRhSW5kZXg6IFwidXBkYXRlZEF0XCIsIGlkOiBcInVwZGF0ZWRBdFwiLCBmaWVsZFR5cGU6IFwiZGF0ZXRpbWVcIiwgaXNMaXN0YWJsZTogdHJ1ZSB9LFxuICAgICAgeyBuYW1lOiBcIkVycm9yXCIsIGRhdGFJbmRleDogXCJlcnJvclwiLCBpZDogXCJlcnJvclwiLCBmaWVsZFR5cGU6IFwidGV4dFwiLCBpc0xpc3RhYmxlOiB0cnVlIH1cbiAgICAgIFxuICAgIF1cbiAgfVxufTsgIl19
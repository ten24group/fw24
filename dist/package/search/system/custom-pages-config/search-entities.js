"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchEntitiesConfig = void 0;
exports.searchEntitiesConfig = {
    pageTitle: "Search Entities",
    pageType: "list",
    routePattern: "/system/search/entities",
    breadcrumbs: [
        { label: "Home", url: "/" },
        { label: "Search", url: "/system/search" },
        { label: "Entities" }
    ],
    listPageConfig: {
        apiConfig: { apiMethod: "GET", responseKey: "entities", apiUrl: "/system/search/entities" },
        propertiesConfig: [
            {
                name: "Entity Name",
                dataIndex: "entityName",
                id: "entityName",
                fieldType: "text",
                isListable: true,
                isIdentifier: true,
                actions: [
                    { icon: "view", label: "View Records", url: "/system/search/records/:entityName" },
                    { icon: "setting", label: "Index Details", url: "/system/search/indices/:entityName" }
                ]
            },
            { name: "Search Enabled", dataIndex: "searchEnabled", id: "searchEnabled", fieldType: "boolean", isListable: true },
            { name: "Index Exists", dataIndex: "indexExists", id: "indexExists", fieldType: "boolean", isListable: true },
            { name: "Index Name", dataIndex: "indexName", id: "indexName", fieldType: "text", isListable: true },
            { name: "Error", dataIndex: "error", id: "error", fieldType: "text", isListable: true }
        ]
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VhcmNoLWVudGl0aWVzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL3NlYXJjaC9zeXN0ZW0vY3VzdG9tLXBhZ2VzLWNvbmZpZy9zZWFyY2gtZW50aXRpZXMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBRWEsUUFBQSxvQkFBb0IsR0FBbUI7SUFDbEQsU0FBUyxFQUFFLGlCQUFpQjtJQUM1QixRQUFRLEVBQUUsTUFBTTtJQUNoQixZQUFZLEVBQUUseUJBQXlCO0lBQ3ZDLFdBQVcsRUFBRTtRQUNYLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFO1FBQzNCLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxHQUFHLEVBQUUsZ0JBQWdCLEVBQUU7UUFDMUMsRUFBRSxLQUFLLEVBQUUsVUFBVSxFQUFFO0tBQ3RCO0lBQ0QsY0FBYyxFQUFFO1FBQ2QsU0FBUyxFQUFFLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBRSxXQUFXLEVBQUUsVUFBVSxFQUFFLE1BQU0sRUFBRSx5QkFBeUIsRUFBRTtRQUMzRixnQkFBZ0IsRUFBRTtZQUNoQjtnQkFDRSxJQUFJLEVBQUUsYUFBYTtnQkFDbkIsU0FBUyxFQUFFLFlBQVk7Z0JBQ3ZCLEVBQUUsRUFBRSxZQUFZO2dCQUNoQixTQUFTLEVBQUUsTUFBTTtnQkFDakIsVUFBVSxFQUFFLElBQUk7Z0JBQ2hCLFlBQVksRUFBRSxJQUFJO2dCQUNsQixPQUFPLEVBQUU7b0JBQ1AsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxjQUFjLEVBQUUsR0FBRyxFQUFFLG9DQUFvQyxFQUFFO29CQUNsRixFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFLGVBQWUsRUFBRSxHQUFHLEVBQUUsb0NBQW9DLEVBQUU7aUJBQ3ZGO2FBQ0Y7WUFDRCxFQUFFLElBQUksRUFBRSxnQkFBZ0IsRUFBRSxTQUFTLEVBQUUsZUFBZSxFQUFFLEVBQUUsRUFBRSxlQUFlLEVBQUUsU0FBUyxFQUFFLFNBQVMsRUFBRSxVQUFVLEVBQUUsSUFBSSxFQUFFO1lBQ25ILEVBQUUsSUFBSSxFQUFFLGNBQWMsRUFBRSxTQUFTLEVBQUUsYUFBYSxFQUFFLEVBQUUsRUFBRSxhQUFhLEVBQUUsU0FBUyxFQUFFLFNBQVMsRUFBRSxVQUFVLEVBQUUsSUFBSSxFQUFFO1lBQzdHLEVBQUUsSUFBSSxFQUFFLFlBQVksRUFBRSxTQUFTLEVBQUUsV0FBVyxFQUFFLEVBQUUsRUFBRSxXQUFXLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxVQUFVLEVBQUUsSUFBSSxFQUFFO1lBQ3BHLEVBQUUsSUFBSSxFQUFFLE9BQU8sRUFBRSxTQUFTLEVBQUUsT0FBTyxFQUFFLEVBQUUsRUFBRSxPQUFPLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxVQUFVLEVBQUUsSUFBSSxFQUFFO1NBQ3hGO0tBQ0Y7Q0FDRixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgTGlzdFBhZ2VDb25maWcgfSBmcm9tIFwiLi4vLi4vLi4vdWktY29uZmlnLWdlblwiO1xuXG5leHBvcnQgY29uc3Qgc2VhcmNoRW50aXRpZXNDb25maWc6IExpc3RQYWdlQ29uZmlnID0ge1xuICBwYWdlVGl0bGU6IFwiU2VhcmNoIEVudGl0aWVzXCIsXG4gIHBhZ2VUeXBlOiBcImxpc3RcIixcbiAgcm91dGVQYXR0ZXJuOiBcIi9zeXN0ZW0vc2VhcmNoL2VudGl0aWVzXCIsXG4gIGJyZWFkY3J1bWJzOiBbXG4gICAgeyBsYWJlbDogXCJIb21lXCIsIHVybDogXCIvXCIgfSxcbiAgICB7IGxhYmVsOiBcIlNlYXJjaFwiLCB1cmw6IFwiL3N5c3RlbS9zZWFyY2hcIiB9LFxuICAgIHsgbGFiZWw6IFwiRW50aXRpZXNcIiB9XG4gIF0sXG4gIGxpc3RQYWdlQ29uZmlnOiB7XG4gICAgYXBpQ29uZmlnOiB7IGFwaU1ldGhvZDogXCJHRVRcIiwgcmVzcG9uc2VLZXk6IFwiZW50aXRpZXNcIiwgYXBpVXJsOiBcIi9zeXN0ZW0vc2VhcmNoL2VudGl0aWVzXCIgfSxcbiAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gICAgICB7IFxuICAgICAgICBuYW1lOiBcIkVudGl0eSBOYW1lXCIsIFxuICAgICAgICBkYXRhSW5kZXg6IFwiZW50aXR5TmFtZVwiLCBcbiAgICAgICAgaWQ6IFwiZW50aXR5TmFtZVwiLCBcbiAgICAgICAgZmllbGRUeXBlOiBcInRleHRcIiwgXG4gICAgICAgIGlzTGlzdGFibGU6IHRydWUsIFxuICAgICAgICBpc0lkZW50aWZpZXI6IHRydWUsXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICB7IGljb246IFwidmlld1wiLCBsYWJlbDogXCJWaWV3IFJlY29yZHNcIiwgdXJsOiBcIi9zeXN0ZW0vc2VhcmNoL3JlY29yZHMvOmVudGl0eU5hbWVcIiB9LFxuICAgICAgICAgIHsgaWNvbjogXCJzZXR0aW5nXCIsIGxhYmVsOiBcIkluZGV4IERldGFpbHNcIiwgdXJsOiBcIi9zeXN0ZW0vc2VhcmNoL2luZGljZXMvOmVudGl0eU5hbWVcIiB9XG4gICAgICAgIF1cbiAgICAgIH0sXG4gICAgICB7IG5hbWU6IFwiU2VhcmNoIEVuYWJsZWRcIiwgZGF0YUluZGV4OiBcInNlYXJjaEVuYWJsZWRcIiwgaWQ6IFwic2VhcmNoRW5hYmxlZFwiLCBmaWVsZFR5cGU6IFwiYm9vbGVhblwiLCBpc0xpc3RhYmxlOiB0cnVlIH0sXG4gICAgICB7IG5hbWU6IFwiSW5kZXggRXhpc3RzXCIsIGRhdGFJbmRleDogXCJpbmRleEV4aXN0c1wiLCBpZDogXCJpbmRleEV4aXN0c1wiLCBmaWVsZFR5cGU6IFwiYm9vbGVhblwiLCBpc0xpc3RhYmxlOiB0cnVlIH0sXG4gICAgICB7IG5hbWU6IFwiSW5kZXggTmFtZVwiLCBkYXRhSW5kZXg6IFwiaW5kZXhOYW1lXCIsIGlkOiBcImluZGV4TmFtZVwiLCBmaWVsZFR5cGU6IFwidGV4dFwiLCBpc0xpc3RhYmxlOiB0cnVlIH0sXG4gICAgICB7IG5hbWU6IFwiRXJyb3JcIiwgZGF0YUluZGV4OiBcImVycm9yXCIsIGlkOiBcImVycm9yXCIsIGZpZWxkVHlwZTogXCJ0ZXh0XCIsIGlzTGlzdGFibGU6IHRydWUgfVxuICAgIF1cbiAgfVxufTsgIl19
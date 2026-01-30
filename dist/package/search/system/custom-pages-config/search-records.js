"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchRecordsConfig = void 0;
exports.searchRecordsConfig = {
    pageTitle: "Search Records",
    pageType: "list",
    routePattern: "/system/search/records/:entityName",
    breadcrumbs: [
        { label: "Home", url: "/" },
        { label: "Search", url: "/system/search" },
        { label: "Entities", url: "/system/search/entities" },
        { label: "Records" }
    ],
    pageHeaderActions: [],
    listPageConfig: {
        apiConfig: { apiMethod: "GET", useSearch: true, responseKey: "items", apiUrl: "/system/search/records/:entityName" },
        propertiesConfig: [
            {
                id: "id",
                name: "ID",
                dataIndex: "id",
                fieldType: "text",
                isListable: true,
                isFilterable: false,
                isSortable: false,
                isIdentifier: true,
                actions: [
                    { icon: "view", label: "View Details", url: "/system/search/records/:entityName/:id" }
                ]
            },
            {
                name: "Full Record",
                dataIndex: "fullRecord",
                id: "fullRecord",
                fieldType: "json",
                isListable: true,
                isFilterable: false,
                isSortable: false,
                actions: [
                    { icon: "view", label: "View Details", url: "/system/search/records/:entityName/:id" }
                ]
            }
        ]
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VhcmNoLXJlY29yZHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvc2VhcmNoL3N5c3RlbS9jdXN0b20tcGFnZXMtY29uZmlnL3NlYXJjaC1yZWNvcmRzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVhLFFBQUEsbUJBQW1CLEdBQW1CO0lBQ2pELFNBQVMsRUFBRSxnQkFBZ0I7SUFDM0IsUUFBUSxFQUFFLE1BQU07SUFDaEIsWUFBWSxFQUFFLG9DQUFvQztJQUNsRCxXQUFXLEVBQUU7UUFDWCxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRTtRQUMzQixFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLGdCQUFnQixFQUFFO1FBQzFDLEVBQUUsS0FBSyxFQUFFLFVBQVUsRUFBRSxHQUFHLEVBQUUseUJBQXlCLEVBQUU7UUFDckQsRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFO0tBQ3JCO0lBQ0QsaUJBQWlCLEVBQUUsRUFBRTtJQUNyQixjQUFjLEVBQUU7UUFDZCxTQUFTLEVBQUUsRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUUsV0FBVyxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsb0NBQW9DLEVBQUU7UUFDcEgsZ0JBQWdCLEVBQUU7WUFDaEI7Z0JBQ0UsRUFBRSxFQUFFLElBQUk7Z0JBQ1IsSUFBSSxFQUFFLElBQUk7Z0JBQ1YsU0FBUyxFQUFFLElBQUk7Z0JBQ2YsU0FBUyxFQUFFLE1BQU07Z0JBQ2pCLFVBQVUsRUFBRSxJQUFJO2dCQUNoQixZQUFZLEVBQUUsS0FBSztnQkFDbkIsVUFBVSxFQUFFLEtBQUs7Z0JBQ2pCLFlBQVksRUFBRSxJQUFJO2dCQUNsQixPQUFPLEVBQUU7b0JBQ1AsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxjQUFjLEVBQUUsR0FBRyxFQUFFLHdDQUF3QyxFQUFFO2lCQUN2RjthQUNGO1lBQ0Q7Z0JBQ0UsSUFBSSxFQUFFLGFBQWE7Z0JBQ25CLFNBQVMsRUFBRSxZQUFZO2dCQUN2QixFQUFFLEVBQUUsWUFBWTtnQkFDaEIsU0FBUyxFQUFFLE1BQU07Z0JBQ2pCLFVBQVUsRUFBRSxJQUFJO2dCQUNoQixZQUFZLEVBQUUsS0FBSztnQkFDbkIsVUFBVSxFQUFFLEtBQUs7Z0JBQ2pCLE9BQU8sRUFBRTtvQkFDUCxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLGNBQWMsRUFBRSxHQUFHLEVBQUUsd0NBQXdDLEVBQUU7aUJBQ3ZGO2FBQ0Y7U0FDRjtLQUNGO0NBQ0YsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IExpc3RQYWdlQ29uZmlnIH0gZnJvbSBcIi4uLy4uLy4uL3VpLWNvbmZpZy1nZW5cIjtcblxuZXhwb3J0IGNvbnN0IHNlYXJjaFJlY29yZHNDb25maWc6IExpc3RQYWdlQ29uZmlnID0ge1xuICBwYWdlVGl0bGU6IFwiU2VhcmNoIFJlY29yZHNcIixcbiAgcGFnZVR5cGU6IFwibGlzdFwiLFxuICByb3V0ZVBhdHRlcm46IFwiL3N5c3RlbS9zZWFyY2gvcmVjb3Jkcy86ZW50aXR5TmFtZVwiLFxuICBicmVhZGNydW1iczogW1xuICAgIHsgbGFiZWw6IFwiSG9tZVwiLCB1cmw6IFwiL1wiIH0sXG4gICAgeyBsYWJlbDogXCJTZWFyY2hcIiwgdXJsOiBcIi9zeXN0ZW0vc2VhcmNoXCIgfSxcbiAgICB7IGxhYmVsOiBcIkVudGl0aWVzXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaC9lbnRpdGllc1wiIH0sXG4gICAgeyBsYWJlbDogXCJSZWNvcmRzXCIgfVxuICBdLFxuICBwYWdlSGVhZGVyQWN0aW9uczogW10sXG4gIGxpc3RQYWdlQ29uZmlnOiB7XG4gICAgYXBpQ29uZmlnOiB7IGFwaU1ldGhvZDogXCJHRVRcIiwgdXNlU2VhcmNoOiB0cnVlLCByZXNwb25zZUtleTogXCJpdGVtc1wiLCBhcGlVcmw6IFwiL3N5c3RlbS9zZWFyY2gvcmVjb3Jkcy86ZW50aXR5TmFtZVwiIH0sXG4gICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgeyBcbiAgICAgICAgaWQ6IFwiaWRcIiwgXG4gICAgICAgIG5hbWU6IFwiSURcIiwgXG4gICAgICAgIGRhdGFJbmRleDogXCJpZFwiLCBcbiAgICAgICAgZmllbGRUeXBlOiBcInRleHRcIiwgXG4gICAgICAgIGlzTGlzdGFibGU6IHRydWUsIFxuICAgICAgICBpc0ZpbHRlcmFibGU6IGZhbHNlLFxuICAgICAgICBpc1NvcnRhYmxlOiBmYWxzZSxcbiAgICAgICAgaXNJZGVudGlmaWVyOiB0cnVlLFxuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgeyBpY29uOiBcInZpZXdcIiwgbGFiZWw6IFwiVmlldyBEZXRhaWxzXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaC9yZWNvcmRzLzplbnRpdHlOYW1lLzppZFwiIH1cbiAgICAgICAgXVxuICAgICAgfSxcbiAgICAgIHsgXG4gICAgICAgIG5hbWU6IFwiRnVsbCBSZWNvcmRcIiwgXG4gICAgICAgIGRhdGFJbmRleDogXCJmdWxsUmVjb3JkXCIsIFxuICAgICAgICBpZDogXCJmdWxsUmVjb3JkXCIsIFxuICAgICAgICBmaWVsZFR5cGU6IFwianNvblwiLCBcbiAgICAgICAgaXNMaXN0YWJsZTogdHJ1ZSxcbiAgICAgICAgaXNGaWx0ZXJhYmxlOiBmYWxzZSxcbiAgICAgICAgaXNTb3J0YWJsZTogZmFsc2UsXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICB7IGljb246IFwidmlld1wiLCBsYWJlbDogXCJWaWV3IERldGFpbHNcIiwgdXJsOiBcIi9zeXN0ZW0vc2VhcmNoL3JlY29yZHMvOmVudGl0eU5hbWUvOmlkXCIgfVxuICAgICAgICBdXG4gICAgICB9XG4gICAgXVxuICB9XG59OyAiXX0=
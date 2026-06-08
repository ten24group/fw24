"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchRecordDetailConfig = void 0;
exports.searchRecordDetailConfig = {
    pageTitle: "Search Record Details",
    pageType: "details",
    routePattern: "/system/search/records/:entityName/:id",
    breadcrumbs: [
        { label: "Home", url: "/" },
        { label: "Search", url: "/system/search" },
        { label: "Entities", url: "/system/search/entities" },
        { label: "Records", url: "/system/search/records/:entityName" },
        { label: "Details" }
    ],
    pageHeaderActions: [
        {
            label: "Delete Record",
            openInModal: true,
            modalConfig: {
                modalType: "confirm",
                modalPageConfig: {
                    title: "Delete Record",
                    content: "Are you sure you want to delete this record?"
                },
                apiConfig: {
                    apiMethod: "DELETE",
                    apiUrl: "/system/search/records/:entityName/:id"
                },
                submitSuccessRedirect: "/system/search/records/:entityName"
            }
        }
    ],
    detailsPageConfig: {
        detailApiConfig: { apiMethod: "GET", apiUrl: "/system/search/records/:entityName/:id" },
        propertiesConfig: [
            { name: "id", label: "ID", id: "id", column: "id", fieldType: "text", isIdentifier: true },
            { name: "_indexedAt", label: "Index At", id: "_indexedAt", column: "_indexedAt", fieldType: "text" },
            { name: "entityName", label: "Entity Name", id: "entityName", column: "entityName", fieldType: "text" },
            { name: "fullRecord", label: "Full Record", id: "fullRecord", column: "fullRecord", fieldType: "json" },
        ]
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VhcmNoLXJlY29yZC1kZXRhaWwuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvc2VhcmNoL3N5c3RlbS9jdXN0b20tcGFnZXMtY29uZmlnL3NlYXJjaC1yZWNvcmQtZGV0YWlsLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVhLFFBQUEsd0JBQXdCLEdBQXNCO0lBQ3pELFNBQVMsRUFBRSx1QkFBdUI7SUFDbEMsUUFBUSxFQUFFLFNBQVM7SUFDbkIsWUFBWSxFQUFFLHdDQUF3QztJQUN0RCxXQUFXLEVBQUU7UUFDWCxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRTtRQUMzQixFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLGdCQUFnQixFQUFFO1FBQzFDLEVBQUUsS0FBSyxFQUFFLFVBQVUsRUFBRSxHQUFHLEVBQUUseUJBQXlCLEVBQUU7UUFDckQsRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLEdBQUcsRUFBRSxvQ0FBb0MsRUFBRTtRQUMvRCxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUU7S0FDckI7SUFDRCxpQkFBaUIsRUFBRTtRQUNqQjtZQUNFLEtBQUssRUFBRSxlQUFlO1lBQ3RCLFdBQVcsRUFBRSxJQUFJO1lBQ2pCLFdBQVcsRUFBRTtnQkFDWCxTQUFTLEVBQUUsU0FBUztnQkFDcEIsZUFBZSxFQUFFO29CQUNmLEtBQUssRUFBRSxlQUFlO29CQUN0QixPQUFPLEVBQUUsOENBQThDO2lCQUN4RDtnQkFDRCxTQUFTLEVBQUU7b0JBQ1QsU0FBUyxFQUFFLFFBQVE7b0JBQ25CLE1BQU0sRUFBRSx3Q0FBd0M7aUJBQ2pEO2dCQUNELHFCQUFxQixFQUFFLG9DQUFvQzthQUM1RDtTQUNGO0tBQ0Y7SUFDRCxpQkFBaUIsRUFBRTtRQUNqQixlQUFlLEVBQUUsRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSx3Q0FBd0MsRUFBRTtRQUN2RixnQkFBZ0IsRUFBRTtZQUNoQixFQUFFLElBQUksRUFBRSxJQUFJLEVBQUcsS0FBSyxFQUFFLElBQUksRUFBRSxFQUFFLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUUsSUFBSSxFQUFFO1lBQzNGLEVBQUUsSUFBSSxFQUFFLFlBQVksRUFBRSxLQUFLLEVBQUUsVUFBVSxFQUFFLEVBQUUsRUFBRSxZQUFZLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFO1lBQ3BHLEVBQUUsSUFBSSxFQUFFLFlBQVksRUFBRSxLQUFLLEVBQUUsYUFBYSxFQUFFLEVBQUUsRUFBRSxZQUFZLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFO1lBQ3ZHLEVBQUUsSUFBSSxFQUFFLFlBQVksRUFBRSxLQUFLLEVBQUUsYUFBYSxFQUFFLEVBQUUsRUFBRSxZQUFZLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFO1NBQ3hHO0tBQ0Y7Q0FDRixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRGV0YWlsc1BhZ2VDb25maWcgfSBmcm9tIFwiLi4vLi4vLi4vdWktY29uZmlnLWdlblwiO1xuXG5leHBvcnQgY29uc3Qgc2VhcmNoUmVjb3JkRGV0YWlsQ29uZmlnOiBEZXRhaWxzUGFnZUNvbmZpZyA9IHtcbiAgcGFnZVRpdGxlOiBcIlNlYXJjaCBSZWNvcmQgRGV0YWlsc1wiLFxuICBwYWdlVHlwZTogXCJkZXRhaWxzXCIsXG4gIHJvdXRlUGF0dGVybjogXCIvc3lzdGVtL3NlYXJjaC9yZWNvcmRzLzplbnRpdHlOYW1lLzppZFwiLFxuICBicmVhZGNydW1iczogW1xuICAgIHsgbGFiZWw6IFwiSG9tZVwiLCB1cmw6IFwiL1wiIH0sXG4gICAgeyBsYWJlbDogXCJTZWFyY2hcIiwgdXJsOiBcIi9zeXN0ZW0vc2VhcmNoXCIgfSxcbiAgICB7IGxhYmVsOiBcIkVudGl0aWVzXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaC9lbnRpdGllc1wiIH0sXG4gICAgeyBsYWJlbDogXCJSZWNvcmRzXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaC9yZWNvcmRzLzplbnRpdHlOYW1lXCIgfSxcbiAgICB7IGxhYmVsOiBcIkRldGFpbHNcIiB9XG4gIF0sXG4gIHBhZ2VIZWFkZXJBY3Rpb25zOiBbXG4gICAge1xuICAgICAgbGFiZWw6IFwiRGVsZXRlIFJlY29yZFwiLFxuICAgICAgb3BlbkluTW9kYWw6IHRydWUsXG4gICAgICBtb2RhbENvbmZpZzoge1xuICAgICAgICBtb2RhbFR5cGU6IFwiY29uZmlybVwiLFxuICAgICAgICBtb2RhbFBhZ2VDb25maWc6IHsgIFxuICAgICAgICAgIHRpdGxlOiBcIkRlbGV0ZSBSZWNvcmRcIixcbiAgICAgICAgICBjb250ZW50OiBcIkFyZSB5b3Ugc3VyZSB5b3Ugd2FudCB0byBkZWxldGUgdGhpcyByZWNvcmQ/XCJcbiAgICAgICAgfSxcbiAgICAgICAgYXBpQ29uZmlnOiB7XG4gICAgICAgICAgYXBpTWV0aG9kOiBcIkRFTEVURVwiLFxuICAgICAgICAgIGFwaVVybDogXCIvc3lzdGVtL3NlYXJjaC9yZWNvcmRzLzplbnRpdHlOYW1lLzppZFwiICBcbiAgICAgICAgfSxcbiAgICAgICAgc3VibWl0U3VjY2Vzc1JlZGlyZWN0OiBcIi9zeXN0ZW0vc2VhcmNoL3JlY29yZHMvOmVudGl0eU5hbWVcIlxuICAgICAgfVxuICAgIH1cbiAgXSxcbiAgZGV0YWlsc1BhZ2VDb25maWc6IHtcbiAgICBkZXRhaWxBcGlDb25maWc6IHsgYXBpTWV0aG9kOiBcIkdFVFwiLCBhcGlVcmw6IFwiL3N5c3RlbS9zZWFyY2gvcmVjb3Jkcy86ZW50aXR5TmFtZS86aWRcIiB9LFxuICAgIHByb3BlcnRpZXNDb25maWc6IFtcbiAgICAgIHsgbmFtZTogXCJpZFwiLCAgbGFiZWw6IFwiSURcIiwgaWQ6IFwiaWRcIiwgY29sdW1uOiBcImlkXCIsIGZpZWxkVHlwZTogXCJ0ZXh0XCIsIGlzSWRlbnRpZmllcjogdHJ1ZSB9LFxuICAgICAgeyBuYW1lOiBcIl9pbmRleGVkQXRcIiwgbGFiZWw6IFwiSW5kZXggQXRcIiwgaWQ6IFwiX2luZGV4ZWRBdFwiLCBjb2x1bW46IFwiX2luZGV4ZWRBdFwiLCBmaWVsZFR5cGU6IFwidGV4dFwiIH0sXG4gICAgICB7IG5hbWU6IFwiZW50aXR5TmFtZVwiLCBsYWJlbDogXCJFbnRpdHkgTmFtZVwiLCBpZDogXCJlbnRpdHlOYW1lXCIsIGNvbHVtbjogXCJlbnRpdHlOYW1lXCIsIGZpZWxkVHlwZTogXCJ0ZXh0XCIgfSxcbiAgICAgIHsgbmFtZTogXCJmdWxsUmVjb3JkXCIsIGxhYmVsOiBcIkZ1bGwgUmVjb3JkXCIsIGlkOiBcImZ1bGxSZWNvcmRcIiwgY29sdW1uOiBcImZ1bGxSZWNvcmRcIiwgZmllbGRUeXBlOiBcImpzb25cIiB9LFxuICAgIF1cbiAgfVxufTsgIl19
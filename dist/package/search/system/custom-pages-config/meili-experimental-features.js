"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.meiliSearchExperimentalFeaturesPage = void 0;
exports.meiliSearchExperimentalFeaturesPage = {
    pageTitle: "MeiliSearch Experimental Features",
    pageType: "form",
    routePattern: "/system/search/experimental-features",
    breadcrumbs: [
        { label: "Home", url: "/" },
        { label: "Search", url: "/system/search" },
        { label: "Experimental Features" }
    ],
    formPageConfig: {
        apiConfig: { apiMethod: "POST", apiUrl: "/system/search/experimental-features" },
        detailApiConfig: { apiMethod: "GET", apiUrl: "/system/search/experimental-features" },
        formButtons: ["submit", "reset", { text: "Cancel", url: "/system/search" }],
        propertiesConfig: [
            { name: "metrics", column: "metrics", fieldType: "boolean", label: "Metrics" },
            { name: "network", column: "network", fieldType: "boolean", label: "Network" },
            { name: "logsRoute", column: "logsRoute", fieldType: "boolean", label: "Logs Route" },
            { name: "containsFilter", column: "containsFilter", fieldType: "boolean", label: "Contains Filter" },
            { name: "editDocumentsByFunction", column: "editDocumentsByFunction", fieldType: "boolean", label: "Edit Documents By Function" }
        ],
        submitSuccessRedirect: "/system/search/experimental-features"
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVpbGktZXhwZXJpbWVudGFsLWZlYXR1cmVzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL3NlYXJjaC9zeXN0ZW0vY3VzdG9tLXBhZ2VzLWNvbmZpZy9tZWlsaS1leHBlcmltZW50YWwtZmVhdHVyZXMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBRWEsUUFBQSxtQ0FBbUMsR0FBbUI7SUFDakUsU0FBUyxFQUFFLG1DQUFtQztJQUM5QyxRQUFRLEVBQUUsTUFBTTtJQUNoQixZQUFZLEVBQUUsc0NBQXNDO0lBQ3BELFdBQVcsRUFBRTtRQUNYLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFO1FBQzNCLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxHQUFHLEVBQUUsZ0JBQWdCLEVBQUU7UUFDMUMsRUFBRSxLQUFLLEVBQUUsdUJBQXVCLEVBQUU7S0FDbkM7SUFDRCxjQUFjLEVBQUU7UUFDZCxTQUFTLEVBQUUsRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxzQ0FBc0MsRUFBRTtRQUNoRixlQUFlLEVBQUUsRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxzQ0FBc0MsRUFBRTtRQUNyRixXQUFXLEVBQUUsQ0FBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxHQUFHLEVBQUUsZ0JBQWdCLEVBQUUsQ0FBRTtRQUM3RSxnQkFBZ0IsRUFBRTtZQUNoQixFQUFFLElBQUksRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUU7WUFDOUUsRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxTQUFTLEVBQUUsU0FBUyxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFO1lBQzlFLEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFLFlBQVksRUFBRTtZQUNyRixFQUFFLElBQUksRUFBRSxnQkFBZ0IsRUFBRSxNQUFNLEVBQUUsZ0JBQWdCLEVBQUUsU0FBUyxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUUsaUJBQWlCLEVBQUU7WUFDcEcsRUFBRSxJQUFJLEVBQUUseUJBQXlCLEVBQUUsTUFBTSxFQUFFLHlCQUF5QixFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFLDRCQUE0QixFQUFFO1NBQ2xJO1FBQ0QscUJBQXFCLEVBQUUsc0NBQXNDO0tBQzlEO0NBQ0YsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEZvcm1QYWdlQ29uZmlnIH0gZnJvbSBcIi4uLy4uLy4uL3VpLWNvbmZpZy1nZW5cIjtcblxuZXhwb3J0IGNvbnN0IG1laWxpU2VhcmNoRXhwZXJpbWVudGFsRmVhdHVyZXNQYWdlOiBGb3JtUGFnZUNvbmZpZyA9IHtcbiAgcGFnZVRpdGxlOiBcIk1laWxpU2VhcmNoIEV4cGVyaW1lbnRhbCBGZWF0dXJlc1wiLFxuICBwYWdlVHlwZTogXCJmb3JtXCIsXG4gIHJvdXRlUGF0dGVybjogXCIvc3lzdGVtL3NlYXJjaC9leHBlcmltZW50YWwtZmVhdHVyZXNcIixcbiAgYnJlYWRjcnVtYnM6IFtcbiAgICB7IGxhYmVsOiBcIkhvbWVcIiwgdXJsOiBcIi9cIiB9LFxuICAgIHsgbGFiZWw6IFwiU2VhcmNoXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaFwiIH0sXG4gICAgeyBsYWJlbDogXCJFeHBlcmltZW50YWwgRmVhdHVyZXNcIiB9XG4gIF0sXG4gIGZvcm1QYWdlQ29uZmlnOiB7XG4gICAgYXBpQ29uZmlnOiB7IGFwaU1ldGhvZDogXCJQT1NUXCIsIGFwaVVybDogXCIvc3lzdGVtL3NlYXJjaC9leHBlcmltZW50YWwtZmVhdHVyZXNcIiB9LFxuICAgIGRldGFpbEFwaUNvbmZpZzogeyBhcGlNZXRob2Q6IFwiR0VUXCIsIGFwaVVybDogXCIvc3lzdGVtL3NlYXJjaC9leHBlcmltZW50YWwtZmVhdHVyZXNcIiB9LFxuICAgIGZvcm1CdXR0b25zOiBbIFwic3VibWl0XCIsIFwicmVzZXRcIiwgeyB0ZXh0OiBcIkNhbmNlbFwiLCB1cmw6IFwiL3N5c3RlbS9zZWFyY2hcIiB9IF0sXG4gICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgeyBuYW1lOiBcIm1ldHJpY3NcIiwgY29sdW1uOiBcIm1ldHJpY3NcIiwgZmllbGRUeXBlOiBcImJvb2xlYW5cIiwgbGFiZWw6IFwiTWV0cmljc1wiIH0sXG4gICAgICB7IG5hbWU6IFwibmV0d29ya1wiLCBjb2x1bW46IFwibmV0d29ya1wiLCBmaWVsZFR5cGU6IFwiYm9vbGVhblwiLCBsYWJlbDogXCJOZXR3b3JrXCIgfSxcbiAgICAgIHsgbmFtZTogXCJsb2dzUm91dGVcIiwgY29sdW1uOiBcImxvZ3NSb3V0ZVwiLCBmaWVsZFR5cGU6IFwiYm9vbGVhblwiLCBsYWJlbDogXCJMb2dzIFJvdXRlXCIgfSxcbiAgICAgIHsgbmFtZTogXCJjb250YWluc0ZpbHRlclwiLCBjb2x1bW46IFwiY29udGFpbnNGaWx0ZXJcIiwgZmllbGRUeXBlOiBcImJvb2xlYW5cIiwgbGFiZWw6IFwiQ29udGFpbnMgRmlsdGVyXCIgfSxcbiAgICAgIHsgbmFtZTogXCJlZGl0RG9jdW1lbnRzQnlGdW5jdGlvblwiLCBjb2x1bW46IFwiZWRpdERvY3VtZW50c0J5RnVuY3Rpb25cIiwgZmllbGRUeXBlOiBcImJvb2xlYW5cIiwgbGFiZWw6IFwiRWRpdCBEb2N1bWVudHMgQnkgRnVuY3Rpb25cIiB9XG4gICAgXSxcbiAgICBzdWJtaXRTdWNjZXNzUmVkaXJlY3Q6IFwiL3N5c3RlbS9zZWFyY2gvZXhwZXJpbWVudGFsLWZlYXR1cmVzXCJcbiAgfVxufTsgIl19
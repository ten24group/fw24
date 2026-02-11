"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.meiliSearchEditApiKeyPage = void 0;
exports.meiliSearchEditApiKeyPage = {
    pageTitle: "Edit MeiliSearch API Key",
    pageType: "form",
    routePattern: "/system/search/api-keys/:keyOrUid/edit",
    breadcrumbs: [
        { label: "Home", url: "/" },
        { label: "Search", url: "/system/search" },
        { label: "API Keys", url: "/system/search/api-keys" },
        { label: "Edit API Key" }
    ],
    formPageConfig: {
        detailApiConfig: { apiMethod: "GET", responseKey: "", apiUrl: "/system/search/api-keys/:keyOrUid" },
        apiConfig: { apiMethod: "PUT", responseKey: "", apiUrl: "/system/search/api-keys/:keyOrUid" },
        formButtons: ["submit", "reset", { text: "Cancel", url: "/system/search/api-keys" }],
        propertiesConfig: [
            {
                name: "name",
                label: "Name",
                id: "name",
                column: "name",
                fieldType: "text",
                placeholder: "Enter a descriptive name for this API key",
                helpText: "Optional: A human-readable name for the API key"
            },
            {
                name: "description",
                label: "Description",
                id: "description",
                column: "description",
                fieldType: "textarea",
                placeholder: "Enter a description of what this API key will be used for",
                helpText: "Optional: A detailed description of the API key's purpose"
            }
        ],
        submitSuccessRedirect: "/system/search/api-keys"
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVpbGktc2VhcmNoLWVkaXQtYXBpLWtleS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9zZWFyY2gvc3lzdGVtL2N1c3RvbS1wYWdlcy1jb25maWcvbWVpbGktc2VhcmNoLWVkaXQtYXBpLWtleS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFFYSxRQUFBLHlCQUF5QixHQUFtQjtJQUN2RCxTQUFTLEVBQUUsMEJBQTBCO0lBQ3JDLFFBQVEsRUFBRSxNQUFNO0lBQ2hCLFlBQVksRUFBRSx3Q0FBd0M7SUFDdEQsV0FBVyxFQUFFO1FBQ1gsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUU7UUFDM0IsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLEdBQUcsRUFBRSxnQkFBZ0IsRUFBRTtRQUMxQyxFQUFFLEtBQUssRUFBRSxVQUFVLEVBQUUsR0FBRyxFQUFFLHlCQUF5QixFQUFFO1FBQ3JELEVBQUUsS0FBSyxFQUFFLGNBQWMsRUFBRTtLQUMxQjtJQUNELGNBQWMsRUFBRTtRQUNkLGVBQWUsRUFBRSxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUUsV0FBVyxFQUFFLEVBQUUsRUFBRSxNQUFNLEVBQUUsbUNBQW1DLEVBQUU7UUFDbkcsU0FBUyxFQUFFLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBRSxXQUFXLEVBQUUsRUFBRSxFQUFFLE1BQU0sRUFBRSxtQ0FBbUMsRUFBRTtRQUM3RixXQUFXLEVBQUUsQ0FBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxHQUFHLEVBQUUseUJBQXlCLEVBQUUsQ0FBRTtRQUN0RixnQkFBZ0IsRUFBRTtZQUNoQjtnQkFDRSxJQUFJLEVBQUUsTUFBTTtnQkFDWixLQUFLLEVBQUUsTUFBTTtnQkFDYixFQUFFLEVBQUUsTUFBTTtnQkFDVixNQUFNLEVBQUUsTUFBTTtnQkFDZCxTQUFTLEVBQUUsTUFBTTtnQkFDakIsV0FBVyxFQUFFLDJDQUEyQztnQkFDeEQsUUFBUSxFQUFFLGlEQUFpRDthQUM1RDtZQUNEO2dCQUNFLElBQUksRUFBRSxhQUFhO2dCQUNuQixLQUFLLEVBQUUsYUFBYTtnQkFDcEIsRUFBRSxFQUFFLGFBQWE7Z0JBQ2pCLE1BQU0sRUFBRSxhQUFhO2dCQUNyQixTQUFTLEVBQUUsVUFBVTtnQkFDckIsV0FBVyxFQUFFLDJEQUEyRDtnQkFDeEUsUUFBUSxFQUFFLDJEQUEyRDthQUN0RTtTQUNGO1FBQ0QscUJBQXFCLEVBQUUseUJBQXlCO0tBQ2pEO0NBQ0YsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEZvcm1QYWdlQ29uZmlnIH0gZnJvbSBcIi4uLy4uLy4uL3VpLWNvbmZpZy1nZW5cIjtcblxuZXhwb3J0IGNvbnN0IG1laWxpU2VhcmNoRWRpdEFwaUtleVBhZ2U6IEZvcm1QYWdlQ29uZmlnID0ge1xuICBwYWdlVGl0bGU6IFwiRWRpdCBNZWlsaVNlYXJjaCBBUEkgS2V5XCIsXG4gIHBhZ2VUeXBlOiBcImZvcm1cIixcbiAgcm91dGVQYXR0ZXJuOiBcIi9zeXN0ZW0vc2VhcmNoL2FwaS1rZXlzLzprZXlPclVpZC9lZGl0XCIsXG4gIGJyZWFkY3J1bWJzOiBbXG4gICAgeyBsYWJlbDogXCJIb21lXCIsIHVybDogXCIvXCIgfSxcbiAgICB7IGxhYmVsOiBcIlNlYXJjaFwiLCB1cmw6IFwiL3N5c3RlbS9zZWFyY2hcIiB9LFxuICAgIHsgbGFiZWw6IFwiQVBJIEtleXNcIiwgdXJsOiBcIi9zeXN0ZW0vc2VhcmNoL2FwaS1rZXlzXCIgfSxcbiAgICB7IGxhYmVsOiBcIkVkaXQgQVBJIEtleVwiIH1cbiAgXSxcbiAgZm9ybVBhZ2VDb25maWc6IHtcbiAgICBkZXRhaWxBcGlDb25maWc6IHsgYXBpTWV0aG9kOiBcIkdFVFwiLCByZXNwb25zZUtleTogXCJcIiwgYXBpVXJsOiBcIi9zeXN0ZW0vc2VhcmNoL2FwaS1rZXlzLzprZXlPclVpZFwiIH0sXG4gICAgYXBpQ29uZmlnOiB7IGFwaU1ldGhvZDogXCJQVVRcIiwgcmVzcG9uc2VLZXk6IFwiXCIsIGFwaVVybDogXCIvc3lzdGVtL3NlYXJjaC9hcGkta2V5cy86a2V5T3JVaWRcIiB9LFxuICAgIGZvcm1CdXR0b25zOiBbIFwic3VibWl0XCIsIFwicmVzZXRcIiwgeyB0ZXh0OiBcIkNhbmNlbFwiLCB1cmw6IFwiL3N5c3RlbS9zZWFyY2gvYXBpLWtleXNcIiB9IF0sXG4gICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgeyBcbiAgICAgICAgbmFtZTogXCJuYW1lXCIsIFxuICAgICAgICBsYWJlbDogXCJOYW1lXCIsIFxuICAgICAgICBpZDogXCJuYW1lXCIsIFxuICAgICAgICBjb2x1bW46IFwibmFtZVwiLCBcbiAgICAgICAgZmllbGRUeXBlOiBcInRleHRcIixcbiAgICAgICAgcGxhY2Vob2xkZXI6IFwiRW50ZXIgYSBkZXNjcmlwdGl2ZSBuYW1lIGZvciB0aGlzIEFQSSBrZXlcIixcbiAgICAgICAgaGVscFRleHQ6IFwiT3B0aW9uYWw6IEEgaHVtYW4tcmVhZGFibGUgbmFtZSBmb3IgdGhlIEFQSSBrZXlcIlxuICAgICAgfSxcbiAgICAgIHsgXG4gICAgICAgIG5hbWU6IFwiZGVzY3JpcHRpb25cIiwgXG4gICAgICAgIGxhYmVsOiBcIkRlc2NyaXB0aW9uXCIsIFxuICAgICAgICBpZDogXCJkZXNjcmlwdGlvblwiLCBcbiAgICAgICAgY29sdW1uOiBcImRlc2NyaXB0aW9uXCIsIFxuICAgICAgICBmaWVsZFR5cGU6IFwidGV4dGFyZWFcIixcbiAgICAgICAgcGxhY2Vob2xkZXI6IFwiRW50ZXIgYSBkZXNjcmlwdGlvbiBvZiB3aGF0IHRoaXMgQVBJIGtleSB3aWxsIGJlIHVzZWQgZm9yXCIsXG4gICAgICAgIGhlbHBUZXh0OiBcIk9wdGlvbmFsOiBBIGRldGFpbGVkIGRlc2NyaXB0aW9uIG9mIHRoZSBBUEkga2V5J3MgcHVycG9zZVwiXG4gICAgICB9XG4gICAgXSxcbiAgICBzdWJtaXRTdWNjZXNzUmVkaXJlY3Q6IFwiL3N5c3RlbS9zZWFyY2gvYXBpLWtleXNcIlxuICB9XG59OyAiXX0=
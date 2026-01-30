"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.meiliSearchCreateApiKeyPage = void 0;
exports.meiliSearchCreateApiKeyPage = {
    pageTitle: "Create API Key",
    pageType: "form",
    routePattern: "/system/search/create-api-keys",
    breadcrumbs: [
        { label: "Home", url: "/" },
        { label: "Search", url: "/system/search" },
        { label: "API Keys", url: "/system/search/api-keys" },
        { label: "Create Key" }
    ],
    formPageConfig: {
        apiConfig: { apiMethod: "POST", responseKey: "", apiUrl: "/system/search/api-keys" },
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
            },
            {
                name: "actions",
                label: "Actions",
                id: "actions",
                column: "actions",
                fieldType: "json",
                defaultValue: "[\"search\", \"documents.get\"]",
                placeholder: "[\"search\", \"documents.get\"]",
                helpText: "Required: Array of allowed actions. Common actions: search, documents.get, documents.add, documents.update, documents.delete, indexes.create, indexes.update, indexes.delete, settings.get, settings.update"
            },
            {
                name: "indexes",
                label: "Indexes",
                id: "indexes",
                column: "indexes",
                fieldType: "json",
                defaultValue: "[\"*\"]",
                placeholder: "[\"*\"]",
                helpText: "Required: Array of index UIDs this key can access. Use [\"*\"] for all indexes, or specify individual index UIDs like [\"my-index\", \"another-index\"]"
            },
            {
                name: "expiresAt",
                label: "Expires At",
                id: "expiresAt",
                column: "expiresAt",
                fieldType: "datetime",
                defaultValue: "2025-12-31T23:59:59Z",
                placeholder: "2025-12-31T23:59:59Z",
                helpText: "Optional: ISO 8601 datetime when this key expires. Leave empty for no expiration"
            }
        ],
        submitSuccessRedirect: "/system/search/api-keys"
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVpbGktc2VhcmNoLWNyZWF0ZS1hcGkta2V5LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL3NlYXJjaC9zeXN0ZW0vY3VzdG9tLXBhZ2VzLWNvbmZpZy9tZWlsaS1zZWFyY2gtY3JlYXRlLWFwaS1rZXkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBRWEsUUFBQSwyQkFBMkIsR0FBbUI7SUFDekQsU0FBUyxFQUFFLGdCQUFnQjtJQUMzQixRQUFRLEVBQUUsTUFBTTtJQUNoQixZQUFZLEVBQUUsZ0NBQWdDO0lBQzlDLFdBQVcsRUFBRTtRQUNYLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFO1FBQzNCLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxHQUFHLEVBQUUsZ0JBQWdCLEVBQUU7UUFDMUMsRUFBRSxLQUFLLEVBQUUsVUFBVSxFQUFFLEdBQUcsRUFBRSx5QkFBeUIsRUFBRTtRQUNyRCxFQUFFLEtBQUssRUFBRSxZQUFZLEVBQUU7S0FDeEI7SUFDRCxjQUFjLEVBQUU7UUFDZCxTQUFTLEVBQUUsRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFFLFdBQVcsRUFBRSxFQUFFLEVBQUUsTUFBTSxFQUFFLHlCQUF5QixFQUFFO1FBQ3BGLFdBQVcsRUFBRSxDQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLEdBQUcsRUFBRSx5QkFBeUIsRUFBRSxDQUFFO1FBQ3RGLGdCQUFnQixFQUFFO1lBQ2hCO2dCQUNFLElBQUksRUFBRSxNQUFNO2dCQUNaLEtBQUssRUFBRSxNQUFNO2dCQUNiLEVBQUUsRUFBRSxNQUFNO2dCQUNWLE1BQU0sRUFBRSxNQUFNO2dCQUNkLFNBQVMsRUFBRSxNQUFNO2dCQUNqQixXQUFXLEVBQUUsMkNBQTJDO2dCQUN4RCxRQUFRLEVBQUUsaURBQWlEO2FBQzVEO1lBQ0Q7Z0JBQ0UsSUFBSSxFQUFFLGFBQWE7Z0JBQ25CLEtBQUssRUFBRSxhQUFhO2dCQUNwQixFQUFFLEVBQUUsYUFBYTtnQkFDakIsTUFBTSxFQUFFLGFBQWE7Z0JBQ3JCLFNBQVMsRUFBRSxVQUFVO2dCQUNyQixXQUFXLEVBQUUsMkRBQTJEO2dCQUN4RSxRQUFRLEVBQUUsMkRBQTJEO2FBQ3RFO1lBQ0Q7Z0JBQ0UsSUFBSSxFQUFFLFNBQVM7Z0JBQ2YsS0FBSyxFQUFFLFNBQVM7Z0JBQ2hCLEVBQUUsRUFBRSxTQUFTO2dCQUNiLE1BQU0sRUFBRSxTQUFTO2dCQUNqQixTQUFTLEVBQUUsTUFBTTtnQkFDakIsWUFBWSxFQUFFLGlDQUFpQztnQkFDL0MsV0FBVyxFQUFFLGlDQUFpQztnQkFDOUMsUUFBUSxFQUFFLDZNQUE2TTthQUN4TjtZQUNEO2dCQUNFLElBQUksRUFBRSxTQUFTO2dCQUNmLEtBQUssRUFBRSxTQUFTO2dCQUNoQixFQUFFLEVBQUUsU0FBUztnQkFDYixNQUFNLEVBQUUsU0FBUztnQkFDakIsU0FBUyxFQUFFLE1BQU07Z0JBQ2pCLFlBQVksRUFBRSxTQUFTO2dCQUN2QixXQUFXLEVBQUUsU0FBUztnQkFDdEIsUUFBUSxFQUFFLHlKQUF5SjthQUNwSztZQUNEO2dCQUNFLElBQUksRUFBRSxXQUFXO2dCQUNqQixLQUFLLEVBQUUsWUFBWTtnQkFDbkIsRUFBRSxFQUFFLFdBQVc7Z0JBQ2YsTUFBTSxFQUFFLFdBQVc7Z0JBQ25CLFNBQVMsRUFBRSxVQUFVO2dCQUNyQixZQUFZLEVBQUUsc0JBQXNCO2dCQUNwQyxXQUFXLEVBQUUsc0JBQXNCO2dCQUNuQyxRQUFRLEVBQUUsa0ZBQWtGO2FBQzdGO1NBQ0Y7UUFDRCxxQkFBcUIsRUFBRSx5QkFBeUI7S0FDakQ7Q0FDRixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRm9ybVBhZ2VDb25maWcgfSBmcm9tIFwiLi4vLi4vLi4vdWktY29uZmlnLWdlblwiO1xuXG5leHBvcnQgY29uc3QgbWVpbGlTZWFyY2hDcmVhdGVBcGlLZXlQYWdlOiBGb3JtUGFnZUNvbmZpZyA9IHtcbiAgcGFnZVRpdGxlOiBcIkNyZWF0ZSBBUEkgS2V5XCIsXG4gIHBhZ2VUeXBlOiBcImZvcm1cIixcbiAgcm91dGVQYXR0ZXJuOiBcIi9zeXN0ZW0vc2VhcmNoL2NyZWF0ZS1hcGkta2V5c1wiLFxuICBicmVhZGNydW1iczogW1xuICAgIHsgbGFiZWw6IFwiSG9tZVwiLCB1cmw6IFwiL1wiIH0sXG4gICAgeyBsYWJlbDogXCJTZWFyY2hcIiwgdXJsOiBcIi9zeXN0ZW0vc2VhcmNoXCIgfSxcbiAgICB7IGxhYmVsOiBcIkFQSSBLZXlzXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaC9hcGkta2V5c1wiIH0sXG4gICAgeyBsYWJlbDogXCJDcmVhdGUgS2V5XCIgfVxuICBdLFxuICBmb3JtUGFnZUNvbmZpZzoge1xuICAgIGFwaUNvbmZpZzogeyBhcGlNZXRob2Q6IFwiUE9TVFwiLCByZXNwb25zZUtleTogXCJcIiwgYXBpVXJsOiBcIi9zeXN0ZW0vc2VhcmNoL2FwaS1rZXlzXCIgfSxcbiAgICBmb3JtQnV0dG9uczogWyBcInN1Ym1pdFwiLCBcInJlc2V0XCIsIHsgdGV4dDogXCJDYW5jZWxcIiwgdXJsOiBcIi9zeXN0ZW0vc2VhcmNoL2FwaS1rZXlzXCIgfSBdLFxuICAgIHByb3BlcnRpZXNDb25maWc6IFtcbiAgICAgIHsgXG4gICAgICAgIG5hbWU6IFwibmFtZVwiLCBcbiAgICAgICAgbGFiZWw6IFwiTmFtZVwiLCBcbiAgICAgICAgaWQ6IFwibmFtZVwiLCBcbiAgICAgICAgY29sdW1uOiBcIm5hbWVcIiwgXG4gICAgICAgIGZpZWxkVHlwZTogXCJ0ZXh0XCIsXG4gICAgICAgIHBsYWNlaG9sZGVyOiBcIkVudGVyIGEgZGVzY3JpcHRpdmUgbmFtZSBmb3IgdGhpcyBBUEkga2V5XCIsXG4gICAgICAgIGhlbHBUZXh0OiBcIk9wdGlvbmFsOiBBIGh1bWFuLXJlYWRhYmxlIG5hbWUgZm9yIHRoZSBBUEkga2V5XCJcbiAgICAgIH0sXG4gICAgICB7IFxuICAgICAgICBuYW1lOiBcImRlc2NyaXB0aW9uXCIsIFxuICAgICAgICBsYWJlbDogXCJEZXNjcmlwdGlvblwiLCBcbiAgICAgICAgaWQ6IFwiZGVzY3JpcHRpb25cIiwgXG4gICAgICAgIGNvbHVtbjogXCJkZXNjcmlwdGlvblwiLCBcbiAgICAgICAgZmllbGRUeXBlOiBcInRleHRhcmVhXCIsXG4gICAgICAgIHBsYWNlaG9sZGVyOiBcIkVudGVyIGEgZGVzY3JpcHRpb24gb2Ygd2hhdCB0aGlzIEFQSSBrZXkgd2lsbCBiZSB1c2VkIGZvclwiLFxuICAgICAgICBoZWxwVGV4dDogXCJPcHRpb25hbDogQSBkZXRhaWxlZCBkZXNjcmlwdGlvbiBvZiB0aGUgQVBJIGtleSdzIHB1cnBvc2VcIlxuICAgICAgfSxcbiAgICAgIHsgXG4gICAgICAgIG5hbWU6IFwiYWN0aW9uc1wiLCBcbiAgICAgICAgbGFiZWw6IFwiQWN0aW9uc1wiLCBcbiAgICAgICAgaWQ6IFwiYWN0aW9uc1wiLCBcbiAgICAgICAgY29sdW1uOiBcImFjdGlvbnNcIiwgXG4gICAgICAgIGZpZWxkVHlwZTogXCJqc29uXCIsIFxuICAgICAgICBkZWZhdWx0VmFsdWU6IFwiW1xcXCJzZWFyY2hcXFwiLCBcXFwiZG9jdW1lbnRzLmdldFxcXCJdXCIsXG4gICAgICAgIHBsYWNlaG9sZGVyOiBcIltcXFwic2VhcmNoXFxcIiwgXFxcImRvY3VtZW50cy5nZXRcXFwiXVwiLFxuICAgICAgICBoZWxwVGV4dDogXCJSZXF1aXJlZDogQXJyYXkgb2YgYWxsb3dlZCBhY3Rpb25zLiBDb21tb24gYWN0aW9uczogc2VhcmNoLCBkb2N1bWVudHMuZ2V0LCBkb2N1bWVudHMuYWRkLCBkb2N1bWVudHMudXBkYXRlLCBkb2N1bWVudHMuZGVsZXRlLCBpbmRleGVzLmNyZWF0ZSwgaW5kZXhlcy51cGRhdGUsIGluZGV4ZXMuZGVsZXRlLCBzZXR0aW5ncy5nZXQsIHNldHRpbmdzLnVwZGF0ZVwiXG4gICAgICB9LFxuICAgICAgeyBcbiAgICAgICAgbmFtZTogXCJpbmRleGVzXCIsIFxuICAgICAgICBsYWJlbDogXCJJbmRleGVzXCIsIFxuICAgICAgICBpZDogXCJpbmRleGVzXCIsIFxuICAgICAgICBjb2x1bW46IFwiaW5kZXhlc1wiLCBcbiAgICAgICAgZmllbGRUeXBlOiBcImpzb25cIiwgXG4gICAgICAgIGRlZmF1bHRWYWx1ZTogXCJbXFxcIipcXFwiXVwiLFxuICAgICAgICBwbGFjZWhvbGRlcjogXCJbXFxcIipcXFwiXVwiLFxuICAgICAgICBoZWxwVGV4dDogXCJSZXF1aXJlZDogQXJyYXkgb2YgaW5kZXggVUlEcyB0aGlzIGtleSBjYW4gYWNjZXNzLiBVc2UgW1xcXCIqXFxcIl0gZm9yIGFsbCBpbmRleGVzLCBvciBzcGVjaWZ5IGluZGl2aWR1YWwgaW5kZXggVUlEcyBsaWtlIFtcXFwibXktaW5kZXhcXFwiLCBcXFwiYW5vdGhlci1pbmRleFxcXCJdXCJcbiAgICAgIH0sXG4gICAgICB7IFxuICAgICAgICBuYW1lOiBcImV4cGlyZXNBdFwiLCBcbiAgICAgICAgbGFiZWw6IFwiRXhwaXJlcyBBdFwiLCBcbiAgICAgICAgaWQ6IFwiZXhwaXJlc0F0XCIsIFxuICAgICAgICBjb2x1bW46IFwiZXhwaXJlc0F0XCIsIFxuICAgICAgICBmaWVsZFR5cGU6IFwiZGF0ZXRpbWVcIixcbiAgICAgICAgZGVmYXVsdFZhbHVlOiBcIjIwMjUtMTItMzFUMjM6NTk6NTlaXCIsXG4gICAgICAgIHBsYWNlaG9sZGVyOiBcIjIwMjUtMTItMzFUMjM6NTk6NTlaXCIsXG4gICAgICAgIGhlbHBUZXh0OiBcIk9wdGlvbmFsOiBJU08gODYwMSBkYXRldGltZSB3aGVuIHRoaXMga2V5IGV4cGlyZXMuIExlYXZlIGVtcHR5IGZvciBubyBleHBpcmF0aW9uXCJcbiAgICAgIH1cbiAgICBdLFxuICAgIHN1Ym1pdFN1Y2Nlc3NSZWRpcmVjdDogXCIvc3lzdGVtL3NlYXJjaC9hcGkta2V5c1wiXG4gIH1cbn07ICJdfQ==
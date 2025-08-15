"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.meiliSearchApiKeysPage = void 0;
exports.meiliSearchApiKeysPage = {
    pageTitle: "MeiliSearch API Keys",
    pageType: "list",
    routePattern: "/system/search/api-keys",
    breadcrumbs: [
        { label: "Home", url: "/" },
        { label: "Search", url: "/system/search" },
        { label: "API Keys" }
    ],
    pageHeaderActions: [
        { label: "Create API Key", url: "/system/search/create-api-keys", type: "button" }
    ],
    listPageConfig: {
        apiConfig: { apiMethod: "GET", responseKey: "items", apiUrl: "/system/search/api-keys" },
        propertiesConfig: [
            {
                name: "UID",
                dataIndex: "uid",
                id: "uid",
                fieldType: "text",
                isListable: true,
                isVisible: false,
                isFilterable: true,
                isIdentifier: true,
                filterConfig: {
                    defaultOperator: "eq",
                    availableOperators: ["eq", "in", "nin"],
                    filterType: "text"
                },
                actions: [
                    { icon: "view", label: "Details", url: "/system/search/api-keys/:uid" },
                    { icon: "edit", label: "Edit", url: "/system/search/api-keys/:uid/edit" }
                ]
            },
            {
                name: "Name",
                dataIndex: "name",
                id: "name",
                fieldType: "text",
                isListable: true,
                isFilterable: true,
                filterConfig: {
                    defaultOperator: "contains",
                    availableOperators: ["contains", "eq", "startsWith", "in", "nin"],
                    filterType: "text"
                }
            },
            {
                name: "Description",
                dataIndex: "description",
                id: "description",
                fieldType: "text",
                isListable: true,
                isFilterable: true,
                filterConfig: {
                    defaultOperator: "contains",
                    availableOperators: ["contains", "eq", "in", "nin"],
                    filterType: "text"
                }
            },
            {
                name: "Actions",
                dataIndex: "actions",
                id: "actions",
                fieldType: "text",
                isListable: true,
                isFilterable: true,
                filterConfig: {
                    defaultOperator: "in",
                    availableOperators: ["in", "nin"],
                    predefinedOptions: [
                        { label: "Search", value: "search" },
                        { label: "Documents Add", value: "documents.add" },
                        { label: "Documents Get", value: "documents.get" },
                        { label: "Documents Delete", value: "documents.delete" },
                        { label: "Indexes Create", value: "indexes.create" },
                        { label: "Indexes Get", value: "indexes.get" },
                        { label: "Indexes Update", value: "indexes.update" },
                        { label: "Indexes Delete", value: "indexes.delete" },
                        { label: "Indexes Swap", value: "indexes.swap" },
                        { label: "Tasks Get", value: "tasks.get" },
                        { label: "Tasks Cancel", value: "tasks.cancel" },
                        { label: "Tasks Delete", value: "tasks.delete" },
                        { label: "Settings Get", value: "settings.get" },
                        { label: "Settings Update", value: "settings.update" },
                        { label: "Stats Get", value: "stats.get" },
                        { label: "Dumps Create", value: "dumps.create" },
                        { label: "All Actions", value: "*" }
                    ],
                    filterType: "select"
                }
            },
            {
                name: "Expires At",
                dataIndex: "expiresAt",
                id: "expiresAt",
                fieldType: "datetime",
                isListable: true,
                isFilterable: true,
                filterConfig: {
                    defaultOperator: "gt",
                    availableOperators: ["gt", "lt", "eq"],
                    filterType: "datetime"
                }
            },
            {
                name: "Created At",
                dataIndex: "createdAt",
                id: "createdAt",
                fieldType: "datetime",
                isListable: true,
                isFilterable: true,
                filterConfig: {
                    defaultOperator: "gt",
                    availableOperators: ["gt", "lt", "eq"],
                    filterType: "datetime"
                }
            },
            {
                name: "Updated At",
                dataIndex: "updatedAt",
                id: "updatedAt",
                fieldType: "datetime",
                isListable: true,
                isFilterable: true,
                filterConfig: {
                    defaultOperator: "gt",
                    availableOperators: ["gt", "lt", "eq"],
                    filterType: "datetime"
                }
            }
        ]
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVpbGktc2VhcmNoLWFwaS1rZXlzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL3NlYXJjaC9zeXN0ZW0vY3VzdG9tLXBhZ2VzLWNvbmZpZy9tZWlsaS1zZWFyY2gtYXBpLWtleXMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBRWEsUUFBQSxzQkFBc0IsR0FBbUI7SUFDcEQsU0FBUyxFQUFFLHNCQUFzQjtJQUNqQyxRQUFRLEVBQUUsTUFBTTtJQUNoQixZQUFZLEVBQUUseUJBQXlCO0lBQ3ZDLFdBQVcsRUFBRTtRQUNYLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFO1FBQzNCLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxHQUFHLEVBQUUsZ0JBQWdCLEVBQUU7UUFDMUMsRUFBRSxLQUFLLEVBQUUsVUFBVSxFQUFFO0tBQ3RCO0lBQ0QsaUJBQWlCLEVBQUU7UUFDakIsRUFBRSxLQUFLLEVBQUUsZ0JBQWdCLEVBQUUsR0FBRyxFQUFFLGdDQUFnQyxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUU7S0FDbkY7SUFDRCxjQUFjLEVBQUU7UUFDZCxTQUFTLEVBQUUsRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFLFdBQVcsRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFLHlCQUF5QixFQUFFO1FBQ3hGLGdCQUFnQixFQUFFO1lBQ2hCO2dCQUNFLElBQUksRUFBRSxLQUFLO2dCQUNYLFNBQVMsRUFBRSxLQUFLO2dCQUNoQixFQUFFLEVBQUUsS0FBSztnQkFDVCxTQUFTLEVBQUUsTUFBTTtnQkFDakIsVUFBVSxFQUFFLElBQUk7Z0JBQ2hCLFNBQVMsRUFBRSxLQUFLO2dCQUNoQixZQUFZLEVBQUUsSUFBSTtnQkFDbEIsWUFBWSxFQUFFLElBQUk7Z0JBQ2xCLFlBQVksRUFBRTtvQkFDWixlQUFlLEVBQUUsSUFBSTtvQkFDckIsa0JBQWtCLEVBQUUsQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFF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QyxVQUFVLEVBQUUsVUFBVTtpQkFDdkI7YUFDRjtTQUNGO0tBQ0Y7Q0FDRixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgTGlzdFBhZ2VDb25maWcgfSBmcm9tIFwiLi4vLi4vLi4vdWktY29uZmlnLWdlblwiO1xuXG5leHBvcnQgY29uc3QgbWVpbGlTZWFyY2hBcGlLZXlzUGFnZTogTGlzdFBhZ2VDb25maWcgPSB7XG4gIHBhZ2VUaXRsZTogXCJNZWlsaVNlYXJjaCBBUEkgS2V5c1wiLFxuICBwYWdlVHlwZTogXCJsaXN0XCIsXG4gIHJvdXRlUGF0dGVybjogXCIvc3lzdGVtL3NlYXJjaC9hcGkta2V5c1wiLFxuICBicmVhZGNydW1iczogW1xuICAgIHsgbGFiZWw6IFwiSG9tZVwiLCB1cmw6IFwiL1wiIH0sXG4gICAgeyBsYWJlbDogXCJTZWFyY2hcIiwgdXJsOiBcIi9zeXN0ZW0vc2VhcmNoXCIgfSxcbiAgICB7IGxhYmVsOiBcIkFQSSBLZXlzXCIgfVxuICBdLFxuICBwYWdlSGVhZGVyQWN0aW9uczogW1xuICAgIHsgbGFiZWw6IFwiQ3JlYXRlIEFQSSBLZXlcIiwgdXJsOiBcIi9zeXN0ZW0vc2VhcmNoL2NyZWF0ZS1hcGkta2V5c1wiLCB0eXBlOiBcImJ1dHRvblwiIH1cbiAgXSxcbiAgbGlzdFBhZ2VDb25maWc6IHtcbiAgICBhcGlDb25maWc6IHsgYXBpTWV0aG9kOiBcIkdFVFwiLCByZXNwb25zZUtleTogXCJpdGVtc1wiLCBhcGlVcmw6IFwiL3N5c3RlbS9zZWFyY2gvYXBpLWtleXNcIiB9LFxuICAgIHByb3BlcnRpZXNDb25maWc6IFtcbiAgICAgIHsgXG4gICAgICAgIG5hbWU6IFwiVUlEXCIsIFxuICAgICAgICBkYXRhSW5kZXg6IFwidWlkXCIsIFxuICAgICAgICBpZDogXCJ1aWRcIiwgXG4gICAgICAgIGZpZWxkVHlwZTogXCJ0ZXh0XCIsIFxuICAgICAgICBpc0xpc3RhYmxlOiB0cnVlLCBcbiAgICAgICAgaXNWaXNpYmxlOiBmYWxzZSxcbiAgICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgICBpc0lkZW50aWZpZXI6IHRydWUsXG4gICAgICAgIGZpbHRlckNvbmZpZzoge1xuICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogXCJlcVwiLFxuICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogW1wiZXFcIiwgXCJpblwiLCBcIm5pblwiXSxcbiAgICAgICAgICBmaWx0ZXJUeXBlOiBcInRleHRcIlxuICAgICAgICB9LFxuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgeyBpY29uOiBcInZpZXdcIiwgbGFiZWw6IFwiRGV0YWlsc1wiLCB1cmw6IFwiL3N5c3RlbS9zZWFyY2gvYXBpLWtleXMvOnVpZFwiIH0sXG4gICAgICAgICAgeyBpY29uOiBcImVkaXRcIiwgbGFiZWw6IFwiRWRpdFwiLCB1cmw6IFwiL3N5c3RlbS9zZWFyY2gvYXBpLWtleXMvOnVpZC9lZGl0XCIgfVxuICAgICAgICBdXG4gICAgICB9LFxuICAgICAgeyBcbiAgICAgICAgbmFtZTogXCJOYW1lXCIsIFxuICAgICAgICBkYXRhSW5kZXg6IFwibmFtZVwiLCBcbiAgICAgICAgaWQ6IFwibmFtZVwiLCBcbiAgICAgICAgZmllbGRUeXBlOiBcInRleHRcIiwgXG4gICAgICAgIGlzTGlzdGFibGU6IHRydWUsXG4gICAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgICAgZmlsdGVyQ29uZmlnOiB7XG4gICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBcImNvbnRhaW5zXCIsXG4gICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBbXCJjb250YWluc1wiLCBcImVxXCIsIFwic3RhcnRzV2l0aFwiLCBcImluXCIsIFwibmluXCJdLFxuICAgICAgICAgIGZpbHRlclR5cGU6IFwidGV4dFwiXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICB7IFxuICAgICAgICBuYW1lOiBcIkRlc2NyaXB0aW9uXCIsIFxuICAgICAgICBkYXRhSW5kZXg6IFwiZGVzY3JpcHRpb25cIiwgXG4gICAgICAgIGlkOiBcImRlc2NyaXB0aW9uXCIsIFxuICAgICAgICBmaWVsZFR5cGU6IFwidGV4dFwiLCBcbiAgICAgICAgaXNMaXN0YWJsZTogdHJ1ZSxcbiAgICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgICBmaWx0ZXJDb25maWc6IHtcbiAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IFwiY29udGFpbnNcIixcbiAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IFtcImNvbnRhaW5zXCIsIFwiZXFcIiwgXCJpblwiLCBcIm5pblwiXSxcbiAgICAgICAgICBmaWx0ZXJUeXBlOiBcInRleHRcIlxuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgeyBcbiAgICAgICAgbmFtZTogXCJBY3Rpb25zXCIsIFxuICAgICAgICBkYXRhSW5kZXg6IFwiYWN0aW9uc1wiLCBcbiAgICAgICAgaWQ6IFwiYWN0aW9uc1wiLCBcbiAgICAgICAgZmllbGRUeXBlOiBcInRleHRcIiwgXG4gICAgICAgIGlzTGlzdGFibGU6IHRydWUsXG4gICAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgICAgZmlsdGVyQ29uZmlnOiB7XG4gICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBcImluXCIsXG4gICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBbXCJpblwiLCBcIm5pblwiXSxcbiAgICAgICAgICBwcmVkZWZpbmVkT3B0aW9uczogW1xuICAgICAgICAgICAgeyBsYWJlbDogXCJTZWFyY2hcIiwgdmFsdWU6IFwic2VhcmNoXCIgfSxcbiAgICAgICAgICAgIHsgbGFiZWw6IFwiRG9jdW1lbnRzIEFkZFwiLCB2YWx1ZTogXCJkb2N1bWVudHMuYWRkXCIgfSxcbiAgICAgICAgICAgIHsgbGFiZWw6IFwiRG9jdW1lbnRzIEdldFwiLCB2YWx1ZTogXCJkb2N1bWVudHMuZ2V0XCIgfSxcbiAgICAgICAgICAgIHsgbGFiZWw6IFwiRG9jdW1lbnRzIERlbGV0ZVwiLCB2YWx1ZTogXCJkb2N1bWVudHMuZGVsZXRlXCIgfSxcbiAgICAgICAgICAgIHsgbGFiZWw6IFwiSW5kZXhlcyBDcmVhdGVcIiwgdmFsdWU6IFwiaW5kZXhlcy5jcmVhdGVcIiB9LFxuICAgICAgICAgICAgeyBsYWJlbDogXCJJbmRleGVzIEdldFwiLCB2YWx1ZTogXCJpbmRleGVzLmdldFwiIH0sXG4gICAgICAgICAgICB7IGxhYmVsOiBcIkluZGV4ZXMgVXBkYXRlXCIsIHZhbHVlOiBcImluZGV4ZXMudXBkYXRlXCIgfSxcbiAgICAgICAgICAgIHsgbGFiZWw6IFwiSW5kZXhlcyBEZWxldGVcIiwgdmFsdWU6IFwiaW5kZXhlcy5kZWxldGVcIiB9LFxuICAgICAgICAgICAgeyBsYWJlbDogXCJJbmRleGVzIFN3YXBcIiwgdmFsdWU6IFwiaW5kZXhlcy5zd2FwXCIgfSxcbiAgICAgICAgICAgIHsgbGFiZWw6IFwiVGFza3MgR2V0XCIsIHZhbHVlOiBcInRhc2tzLmdldFwiIH0sXG4gICAgICAgICAgICB7IGxhYmVsOiBcIlRhc2tzIENhbmNlbFwiLCB2YWx1ZTogXCJ0YXNrcy5jYW5jZWxcIiB9LFxuICAgICAgICAgICAgeyBsYWJlbDogXCJUYXNrcyBEZWxldGVcIiwgdmFsdWU6IFwidGFza3MuZGVsZXRlXCIgfSxcbiAgICAgICAgICAgIHsgbGFiZWw6IFwiU2V0dGluZ3MgR2V0XCIsIHZhbHVlOiBcInNldHRpbmdzLmdldFwiIH0sXG4gICAgICAgICAgICB7IGxhYmVsOiBcIlNldHRpbmdzIFVwZGF0ZVwiLCB2YWx1ZTogXCJzZXR0aW5ncy51cGRhdGVcIiB9LFxuICAgICAgICAgICAgeyBsYWJlbDogXCJTdGF0cyBHZXRcIiwgdmFsdWU6IFwic3RhdHMuZ2V0XCIgfSxcbiAgICAgICAgICAgIHsgbGFiZWw6IFwiRHVtcHMgQ3JlYXRlXCIsIHZhbHVlOiBcImR1bXBzLmNyZWF0ZVwiIH0sXG4gICAgICAgICAgICB7IGxhYmVsOiBcIkFsbCBBY3Rpb25zXCIsIHZhbHVlOiBcIipcIiB9XG4gICAgICAgICAgXSxcbiAgICAgICAgICBmaWx0ZXJUeXBlOiBcInNlbGVjdFwiXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICB7IFxuICAgICAgICBuYW1lOiBcIkV4cGlyZXMgQXRcIiwgXG4gICAgICAgIGRhdGFJbmRleDogXCJleHBpcmVzQXRcIiwgXG4gICAgICAgIGlkOiBcImV4cGlyZXNBdFwiLCBcbiAgICAgICAgZmllbGRUeXBlOiBcImRhdGV0aW1lXCIsIFxuICAgICAgICBpc0xpc3RhYmxlOiB0cnVlLFxuICAgICAgICBpc0ZpbHRlcmFibGU6IHRydWUsXG4gICAgICAgIGZpbHRlckNvbmZpZzoge1xuICAgICAgICAgIGRlZmF1bHRPcGVyYXRvcjogXCJndFwiLFxuICAgICAgICAgIGF2YWlsYWJsZU9wZXJhdG9yczogW1wiZ3RcIiwgXCJsdFwiLCBcImVxXCJdLFxuICAgICAgICAgIGZpbHRlclR5cGU6IFwiZGF0ZXRpbWVcIlxuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgeyBcbiAgICAgICAgbmFtZTogXCJDcmVhdGVkIEF0XCIsIFxuICAgICAgICBkYXRhSW5kZXg6IFwiY3JlYXRlZEF0XCIsIFxuICAgICAgICBpZDogXCJjcmVhdGVkQXRcIiwgXG4gICAgICAgIGZpZWxkVHlwZTogXCJkYXRldGltZVwiLCBcbiAgICAgICAgaXNMaXN0YWJsZTogdHJ1ZSxcbiAgICAgICAgaXNGaWx0ZXJhYmxlOiB0cnVlLFxuICAgICAgICBmaWx0ZXJDb25maWc6IHtcbiAgICAgICAgICBkZWZhdWx0T3BlcmF0b3I6IFwiZ3RcIixcbiAgICAgICAgICBhdmFpbGFibGVPcGVyYXRvcnM6IFtcImd0XCIsIFwibHRcIiwgXCJlcVwiXSxcbiAgICAgICAgICBmaWx0ZXJUeXBlOiBcImRhdGV0aW1lXCJcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHsgXG4gICAgICAgIG5hbWU6IFwiVXBkYXRlZCBBdFwiLCBcbiAgICAgICAgZGF0YUluZGV4OiBcInVwZGF0ZWRBdFwiLCBcbiAgICAgICAgaWQ6IFwidXBkYXRlZEF0XCIsIFxuICAgICAgICBmaWVsZFR5cGU6IFwiZGF0ZXRpbWVcIiwgXG4gICAgICAgIGlzTGlzdGFibGU6IHRydWUsXG4gICAgICAgIGlzRmlsdGVyYWJsZTogdHJ1ZSxcbiAgICAgICAgZmlsdGVyQ29uZmlnOiB7XG4gICAgICAgICAgZGVmYXVsdE9wZXJhdG9yOiBcImd0XCIsXG4gICAgICAgICAgYXZhaWxhYmxlT3BlcmF0b3JzOiBbXCJndFwiLCBcImx0XCIsIFwiZXFcIl0sXG4gICAgICAgICAgZmlsdGVyVHlwZTogXCJkYXRldGltZVwiXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICBdXG4gIH1cbn07ICJdfQ==
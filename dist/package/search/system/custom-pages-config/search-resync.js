"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchResyncPage = void 0;
exports.searchResyncPage = {
    pageTitle: "Re-sync Records",
    pageType: "form",
    routePattern: "/system/search/indices/:entityName/resync",
    breadcrumbs: [
        { label: "Home", url: "/" },
        { label: "Search", url: "/system/search" },
        { label: "Indices", url: "/system/search/indices" },
        { label: "Re-sync Records" }
    ],
    formPageConfig: {
        apiConfig: { apiMethod: "POST", responseKey: "", apiUrl: "/system/search/indices/:entityName/resync" },
        formButtons: ["Submit"],
        propertiesConfig: [
            {
                name: "batchSize",
                label: "Batch Size",
                id: "batchSize",
                column: "batchSize",
                fieldType: "text",
                defaultValue: "25"
            },
            {
                name: "queueUrl",
                label: "Queue URL (optional)",
                id: "queueUrl",
                column: "queueUrl",
                fieldType: "text"
            }
        ],
        submitSuccessRedirect: "/system/search/indices/:entityName"
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VhcmNoLXJlc3luYy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9zZWFyY2gvc3lzdGVtL2N1c3RvbS1wYWdlcy1jb25maWcvc2VhcmNoLXJlc3luYy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFFYSxRQUFBLGdCQUFnQixHQUFtQjtJQUM5QyxTQUFTLEVBQUUsaUJBQWlCO0lBQzVCLFFBQVEsRUFBRSxNQUFNO0lBQ2hCLFlBQVksRUFBRSwyQ0FBMkM7SUFDekQsV0FBVyxFQUFFO1FBQ1gsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUU7UUFDM0IsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLEdBQUcsRUFBRSxnQkFBZ0IsRUFBRTtRQUMxQyxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsR0FBRyxFQUFFLHdCQUF3QixFQUFFO1FBQ25ELEVBQUUsS0FBSyxFQUFFLGlCQUFpQixFQUFFO0tBQzdCO0lBQ0QsY0FBYyxFQUFFO1FBQ2QsU0FBUyxFQUFFLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUUsRUFBRSxFQUFFLE1BQU0sRUFBRSwyQ0FBMkMsRUFBRTtRQUN0RyxXQUFXLEVBQUUsQ0FBRSxRQUFRLENBQUU7UUFDekIsZ0JBQWdCLEVBQUU7WUFDaEI7Z0JBQ0UsSUFBSSxFQUFFLFdBQVc7Z0JBQ2pCLEtBQUssRUFBRSxZQUFZO2dCQUNuQixFQUFFLEVBQUUsV0FBVztnQkFDZixNQUFNLEVBQUUsV0FBVztnQkFDbkIsU0FBUyxFQUFFLE1BQU07Z0JBQ2pCLFlBQVksRUFBRSxJQUFJO2FBQ25CO1lBQ0Q7Z0JBQ0UsSUFBSSxFQUFFLFVBQVU7Z0JBQ2hCLEtBQUssRUFBRSxzQkFBc0I7Z0JBQzdCLEVBQUUsRUFBRSxVQUFVO2dCQUNkLE1BQU0sRUFBRSxVQUFVO2dCQUNsQixTQUFTLEVBQUUsTUFBTTthQUNsQjtTQUNGO1FBQ0QscUJBQXFCLEVBQUUsb0NBQW9DO0tBQzVEO0NBQ0YsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEZvcm1QYWdlQ29uZmlnIH0gZnJvbSBcIi4uLy4uLy4uL3VpLWNvbmZpZy1nZW5cIjtcblxuZXhwb3J0IGNvbnN0IHNlYXJjaFJlc3luY1BhZ2U6IEZvcm1QYWdlQ29uZmlnID0ge1xuICBwYWdlVGl0bGU6IFwiUmUtc3luYyBSZWNvcmRzXCIsXG4gIHBhZ2VUeXBlOiBcImZvcm1cIixcbiAgcm91dGVQYXR0ZXJuOiBcIi9zeXN0ZW0vc2VhcmNoL2luZGljZXMvOmVudGl0eU5hbWUvcmVzeW5jXCIsXG4gIGJyZWFkY3J1bWJzOiBbXG4gICAgeyBsYWJlbDogXCJIb21lXCIsIHVybDogXCIvXCIgfSxcbiAgICB7IGxhYmVsOiBcIlNlYXJjaFwiLCB1cmw6IFwiL3N5c3RlbS9zZWFyY2hcIiB9LFxuICAgIHsgbGFiZWw6IFwiSW5kaWNlc1wiLCB1cmw6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlc1wiIH0sXG4gICAgeyBsYWJlbDogXCJSZS1zeW5jIFJlY29yZHNcIiB9XG4gIF0sXG4gIGZvcm1QYWdlQ29uZmlnOiB7XG4gICAgYXBpQ29uZmlnOiB7IGFwaU1ldGhvZDogXCJQT1NUXCIsIHJlc3BvbnNlS2V5OiBcIlwiLCBhcGlVcmw6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlcy86ZW50aXR5TmFtZS9yZXN5bmNcIiB9LFxuICAgIGZvcm1CdXR0b25zOiBbIFwiU3VibWl0XCIgXSxcbiAgICBwcm9wZXJ0aWVzQ29uZmlnOiBbXG4gICAgICB7IFxuICAgICAgICBuYW1lOiBcImJhdGNoU2l6ZVwiLCBcbiAgICAgICAgbGFiZWw6IFwiQmF0Y2ggU2l6ZVwiLCBcbiAgICAgICAgaWQ6IFwiYmF0Y2hTaXplXCIsIFxuICAgICAgICBjb2x1bW46IFwiYmF0Y2hTaXplXCIsIFxuICAgICAgICBmaWVsZFR5cGU6IFwidGV4dFwiLCBcbiAgICAgICAgZGVmYXVsdFZhbHVlOiBcIjI1XCIgXG4gICAgICB9LFxuICAgICAgeyBcbiAgICAgICAgbmFtZTogXCJxdWV1ZVVybFwiLCBcbiAgICAgICAgbGFiZWw6IFwiUXVldWUgVVJMIChvcHRpb25hbClcIiwgXG4gICAgICAgIGlkOiBcInF1ZXVlVXJsXCIsIFxuICAgICAgICBjb2x1bW46IFwicXVldWVVcmxcIiwgXG4gICAgICAgIGZpZWxkVHlwZTogXCJ0ZXh0XCIgXG4gICAgICB9XG4gICAgXSxcbiAgICBzdWJtaXRTdWNjZXNzUmVkaXJlY3Q6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlcy86ZW50aXR5TmFtZVwiXG4gIH1cbn07ICJdfQ==
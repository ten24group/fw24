import { DetailsPageConfig } from "../../../ui-config-gen";

export const meiliSearchTaskDetailPage: DetailsPageConfig = {
  pageTitle: "MeiliSearch Task Details",
  pageType: "details",
  routePattern: "/system/search/meili/tasks/:taskId",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "Tasks", url: "/system/search/meili/tasks" },
    { label: "Task Details" }
  ],
  detailsPageConfig: {
    detailApiConfig: { apiMethod: "GET", responseKey: "", apiUrl: "/system/search/meili/tasks/:taskId" },
    propertiesConfig: [
      { name: "uid", label: "Task UID", id: "uid", column: "1", fieldType: "text" },
      { name: "indexUid", label: "Index UID", id: "indexUid", column: "1", fieldType: "text" },
      { name: "type", label: "Type", id: "type", column: "1", fieldType: "text" },
      { name: "status", label: "Status", id: "status", column: "1", fieldType: "text" },
      { name: "enqueuedAt", label: "Enqueued At", id: "enqueuedAt", column: "1", fieldType: "datetime" },
      { name: "startedAt", label: "Started At", id: "startedAt", column: "1", fieldType: "datetime" },
      { name: "finishedAt", label: "Finished At", id: "finishedAt", column: "1", fieldType: "datetime" },
      { name: "details", label: "Details", id: "details", column: "12", fieldType: "json" },
      { name: "error", label: "Error", id: "error", column: "12", fieldType: "json" }
    ]
  }
}; 
import { DetailsPageConfig } from "../../../ui-config-gen";

export const meiliSearchTaskDetailPage: DetailsPageConfig = {
  pageTitle: "MeiliSearch Task Details",
  pageType: "details",
  routePattern: "/system/search/tasks/:uid",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "Tasks", url: "/system/search/tasks" },
    { label: "Task Details" }
  ],
  pageHeaderActions: [
    {
      label: "Cancel Task",
      openInModal: true,
      modalConfig: {
        modalType: "confirm",
        modalPageConfig: {
          title: "Cancel Task",
          content: "Are you sure you want to cancel this task?"
        },
        apiConfig: {
          apiMethod: "GET", apiUrl: "/system/search/tasks/:uid/cancel"
        },
        submitSuccessRedirect: "/system/search/tasks"
      }
    },
    {
      label: "Delete Task",
      openInModal: true,
      modalConfig: {
        modalType: "confirm",
        modalPageConfig: {
          title: "Delete Task",
          content: "Are you sure you want to delete this task?"
        },
        apiConfig: {
          apiMethod: "DELETE",
          apiUrl: "/system/search/tasks/:uid"
        },
        submitSuccessRedirect: "/system/search/tasks"
      }
    }
  ],
  detailsPageConfig: {
    detailApiConfig: { apiMethod: "GET", responseKey: "", apiUrl: "/system/search/tasks/:uid",  },
    propertiesConfig: [
      { name: "uid", label: "Task UID", id: "uid", column: "uid", fieldType: "text", isIdentifier: true },
      { name: "indexUid", label: "Index UID", id: "indexUid", column: "indexUid", fieldType: "text" },
      { name: "type", label: "Type", id: "type", column: "type", fieldType: "text" },
      { name: "status", label: "Status", id: "status", column: "status", fieldType: "text" },
      { name: "enqueuedAt", label: "Enqueued At", id: "enqueuedAt", column: "enqueuedAt", fieldType: "datetime" },
      { name: "startedAt", label: "Started At", id: "startedAt", column: "startedAt", fieldType: "datetime" },
      { name: "finishedAt", label: "Finished At", id: "finishedAt", column: "finishedAt", fieldType: "datetime" },
      { name: "details", label: "Details", id: "details", column: "details", fieldType: "json" },
      { name: "error", label: "Error", id: "error", column: "error", fieldType: "json" }
    ]
  }
}; 
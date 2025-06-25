import { ListPageConfig } from "../../../ui-config-gen";

export const meiliSearchTasksPage: ListPageConfig = {
  pageTitle: "MeiliSearch Tasks",
  pageType: "list",
  routePattern: "/system/search/meili/tasks",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "MeiliSearch Tasks" }
  ],
  pageHeaderActions: [
    { label: "Cancel Tasks", url: "/system/search/meili/tasks/cancel", type: "button" },
    { label: "Delete Tasks", url: "/system/search/meili/tasks/delete", type: "button" }
  ],
  listPageConfig: {
    apiConfig: { apiMethod: "GET", responseKey: "tasks", apiUrl: "/system/search/meili/tasks" },
    propertiesConfig: [
      { name: "Task UID", dataIndex: "uid", id: "uid", fieldType: "text", isListable: true, isIdentifier: true },
      { name: "Index UID", dataIndex: "indexUid", id: "indexUid", fieldType: "text", isListable: true },
      { name: "Status", dataIndex: "status", id: "status", fieldType: "text", isListable: true },
      { name: "Type", dataIndex: "type", id: "type", fieldType: "text", isListable: true },
      { name: "Enqueued At", dataIndex: "enqueuedAt", id: "enqueuedAt", fieldType: "datetime", isListable: true },
      { name: "Started At", dataIndex: "startedAt", id: "startedAt", fieldType: "datetime", isListable: true },
      { name: "Finished At", dataIndex: "finishedAt", id: "finishedAt", fieldType: "datetime", isListable: true },
      {
        name: "Actions",
        dataIndex: "actions",
        id: "actions",
        fieldType: "text",
        isListable: true,
        actions: [
          { icon: "view", label: "Details", url: "/system/search/meili/tasks/:uid" }
        ]
      }
    ]
  }
}; 
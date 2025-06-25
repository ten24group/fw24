import { ListPageConfig } from "../../../ui-config-gen";

export const searchTasksConfig: ListPageConfig = {
  pageTitle: "Search Engine Tasks",
  pageType: "list",
  routePattern: "/system/search/meili/tasks",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "Tasks" }
  ],
  listPageConfig: {
    apiConfig: { apiMethod: "GET", responseKey: "tasks", apiUrl: "/system/search/meili/tasks" },
    propertiesConfig: [
      { name: "Task UID", dataIndex: "uid", id: "uid", fieldType: "text", isListable: true, isIdentifier: true },
      { name: "Index UID", dataIndex: "indexUid", id: "indexUid", fieldType: "text", isListable: true },
      { name: "Status", dataIndex: "status", id: "status", fieldType: "text", isListable: true },
      { name: "Type", dataIndex: "type", id: "type", fieldType: "text", isListable: true },
      { name: "Actions", dataIndex: "actions", id: "actions", fieldType: "text", isListable: false, actions: [ { icon: "view", label: "Details", url: "/system/search/meili/tasks/:taskId" } ] }
    ]
  }
}; 
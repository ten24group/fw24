import { ListPageConfig } from "../../../ui-config-gen";

export const meiliSearchTasksPage: ListPageConfig = {
  pageTitle: "MeiliSearch Tasks",
  pageType: "list",
  routePattern: "/system/search/tasks",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "MeiliSearch Tasks" }
  ],
  pageHeaderActions: [],
  listPageConfig: {
    apiConfig: { apiMethod: "GET", responseKey: "items", apiUrl: "/system/search/tasks" },
    propertiesConfig: [
      {
        name: "Task UID",
        dataIndex: "uid",
        id: "uid",
        fieldType: "number",
        isListable: true,
        isFilterable: true,
        isIdentifier: true,
        filterConfig: {
          defaultOperator: "eq",
          availableOperators: ["eq", "in", "nin"],
          filterType: "number"
        },
        actions: [
          { icon: "view", label: "Details", url: "/system/search/tasks/:uid" }
        ]
      },
      {
        name: "Index UID",
        dataIndex: "indexUid",
        id: "indexUid",
        fieldType: "text",
        isListable: true,
        isFilterable: true,
        filterConfig: {
          defaultOperator: "eq",
          availableOperators: ["eq", "in", "nin"],
        }
      },
      {
        name: "Status",
        dataIndex: "status",
        id: "status",
        fieldType: "text",
        isListable: true,
        isFilterable: true,
        filterConfig: {
          defaultOperator: "eq",
          availableOperators: ["eq", "in", "nin"],
          predefinedOptions: [
            { label: "Enqueued", value: "enqueued" },
            { label: "Processing", value: "processing" },
            { label: "Succeeded", value: "succeeded" },
            { label: "Failed", value: "failed" },
            { label: "Canceled", value: "canceled" }
          ],
          filterType: "select"
        }
      },
      {
        name: "Type",
        dataIndex: "type",
        id: "type",
        fieldType: "text",
        isListable: true,
        isFilterable: true,
        filterConfig: {
          defaultOperator: "eq",
          availableOperators: ["eq", "in", "nin"],
          predefinedOptions: [
            { label: "Document Addition/Update", value: "documentAdditionOrUpdate" },
            { label: "Document Edition", value: "documentEdition" },
            { label: "Document Deletion", value: "documentDeletion" },
            { label: "Settings Update", value: "settingsUpdate" },
            { label: "Index Creation", value: "indexCreation" },
            { label: "Index Deletion", value: "indexDeletion" },
            { label: "Index Update", value: "indexUpdate" },
            { label: "Index Swap", value: "indexSwap" },
            { label: "Task Cancellation", value: "taskCancelation" },
            { label: "Task Deletion", value: "taskDeletion" },
            { label: "Dump Creation", value: "dumpCreation" },
            { label: "Snapshot Creation", value: "snapshotCreation" },
            { label: "Database Upgrade", value: "upgradeDatabase" }
          ],
          filterType: "select"
        }
      },
      {
        name: "Enqueued At",
        dataIndex: "enqueuedAt",
        id: "enqueuedAt",
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
        name: "Started At",
        dataIndex: "startedAt",
        id: "startedAt",
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
        name: "Finished At",
        dataIndex: "finishedAt",
        id: "finishedAt",
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
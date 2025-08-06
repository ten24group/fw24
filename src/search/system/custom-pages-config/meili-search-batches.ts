import { ListPageConfig } from "../../../ui-config-gen";

export const meiliSearchBatchesPage: ListPageConfig = {
  pageTitle: "MeiliSearch Batches",
  pageType: "list",
  routePattern: "/system/search/batches",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "Batches" }
  ],
  listPageConfig: {
    apiConfig: { apiMethod: "GET", responseKey: "items", apiUrl: "/system/search/batches" },
    propertiesConfig: [
      {
        name: "UID",
        dataIndex: "uid",
        id: "uid",
        fieldType: "number",
        isListable: true,
        isFilterable: true,
        isIdentifier: true,
        filterConfig: {
          defaultOperator: "eq",
          availableOperators: [ "eq", "in", "nin" ],
          filterType: "number"
        },
        actions: [
          { icon: "view", label: "Details", url: "/system/search/batches/:uid" }
        ]
      },
      { 
        name: "Total Tasks", 
        dataIndex: "stats.totalNbTasks", 
        id: "totalNbTasks", 
        fieldType: "number", 
        isListable: true,
        isFilterable: false
      },
      { 
        name: "Status", 
        dataIndex: "status", 
        id: "status", 
        fieldType: "json", 
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
        dataIndex: "types", 
        id: "type", 
        fieldType: "json", 
        isListable: true,
        isFilterable: true,
        filterConfig: {
          defaultOperator: "eq",
          availableOperators: ["eq", "in", "nin"],
          predefinedOptions: [
            { label: "Index Creation", value: "indexCreation" },
            { label: "Index Update", value: "indexUpdate" },
            { label: "Index Deletion", value: "indexDeletion" },
            { label: "Index Swap", value: "indexSwap" },
            { label: "Document Addition/Update", value: "documentAdditionOrUpdate" },
            { label: "Document Deletion", value: "documentDeletion" },
            { label: "Document Edition", value: "documentEdition" },
            { label: "Settings Update", value: "settingsUpdate" },
            { label: "Dump Creation", value: "dumpCreation" },
            { label: "Task Cancelation", value: "taskCancelation" },
            { label: "Task Deletion", value: "taskDeletion" },
            { label: "Database Upgrade", value: "databaseUpgrade" },
            { label: "Snapshot Creation", value: "snapshotCreation" }
          ],
          filterType: "select"
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
      },
      { 
        name: "Duration", 
        dataIndex: "duration", 
        id: "duration", 
        fieldType: "text", 
        isListable: true,
        isFilterable: false
      }
    ]
  }
};
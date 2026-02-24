import { AccordionPageConfig } from "../../../ui-config-gen";

export const searchIndexDetailsConfig: AccordionPageConfig = {
  pageTitle: "Search Index Details",
  pageType: "accordion",
  routePattern: "/system/search/indices/:entityName",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "Indices", url: "/system/search/indices" },
    { label: "Index Details" }
  ],
  pageHeaderActions: [
    { label: "View Settings", url: "/system/search/indices/:entityName/settings-details", type: "button" },
    {
      label: "Initialize Index",
      openInModal: true,
      modalConfig: {
        modalType: "confirm",
        modalPageConfig: {
          title: "Initialize Search Index",
          content: "This will initialize/update the search index configuration from code. Existing data will be preserved."
        },
        apiConfig: {
          apiMethod: "POST",
          apiUrl: "/system/search/indices/:entityName/init"
        },
        responseConfig: {
          showModal: true,
          modalTitle: "Index Initialized",
        },
        submitSuccessRedirect: "/system/search/indices/:entityName"
      }
    },
    {
      label: "Recreate Index",
      openInModal: true,
      modalConfig: {
        modalType: "form",
        modalPageConfig: {
          title: "Recreate Search Index",
          helpText: "⚠️ This will delete and recreate the index with new configuration. Use when primary key or other structural changes are needed.",
          propertiesConfig: [
            {
              name: "resyncDocuments",
              label: "Resync Documents",
              column: "resyncDocuments",
              fieldType: "switch",
              required: false,
              defaultValue: false,
              helpText: "Automatically resync all documents after recreation"
            },
            {
              name: "syncMethod",
              label: "Sync Method",
              column: "syncMethod",
              fieldType: "select",
              required: false,
              defaultValue: "direct",
              options: [
                { label: "Direct (Synchronous)", value: "direct" },
                { label: "Queue (Asynchronous via SQS)", value: "queue" }
              ],
              helpText: "Choose how to resync documents"
            },
            {
              name: "batchSize",
              label: "Batch Size",
              column: "batchSize",
              fieldType: "number",
              required: false,
              defaultValue: 50,
              helpText: "Number of records to process per batch"
            }
          ],
          apiConfig: {
            apiMethod: "POST",
            apiUrl: "/system/search/indices/:entityName/recreate"
          },
          formButtons: ["submit", "reset", "cancel"]
        },
        responseConfig: {
          showModal: true,
          modalTitle: "Index Recreation Result",
        }
      }
    },
    {
      label: "Resync Records",
      openInModal: true,
      modalConfig: {
        modalType: "confirm",
        modalPageConfig: {
          title: "Re-sync All Records",
          content: "This will queue all records for re-indexing. Processing happens asynchronously via SQS."
        },
        apiConfig: {
          apiMethod: "POST",
          apiUrl: "/system/search/indices/:entityName/resync"
        },
        responseConfig: {
          showModal: true,
          modalTitle: "Resync Queued",
          modalWidth: 700
        },
        submitSuccessRedirect: "/system/search/indices/:entityName"
      }
    },
    {
      label: "Clear Documents",
      openInModal: true,
      modalConfig: {
        modalType: "confirm",
        modalPageConfig: {
          title: "Clear All Documents",
          content: "This will remove all documents from the search index. This action cannot be undone."
        },
        apiConfig: {
          apiMethod: "DELETE",
          apiUrl: "/system/search/indices/:entityName/documents"
        },
        submitSuccessRedirect: "/system/search/indices/:entityName"
      }
    },
    {
      label: "Delete Index",
      openInModal: true,
      modalConfig: {
        modalType: "confirm",
        modalPageConfig: {
          title: "Delete Index",
          content: "This will permanently delete the search index and all its data. This action cannot be undone."
        },
        apiConfig: {
          apiMethod: "DELETE",
          apiUrl: "/system/search/indices/:entityName"
        },
        submitSuccessRedirect: "/system/search/indices"
      }
    }
  ],
  accordionPageConfig: {
    accordions: {
      "indexDetails": {
        pageTitle: "Index Details",
        pageType: "details",
        detailsPageConfig: {
          detailApiConfig: { apiMethod: "GET", responseKey: "details", apiUrl: "/system/search/indices/:entityName" },
          columnsConfig: {
            columns: [
              { sortOrder: 1, fields: [ "entityName", "indexInfo" ] },
              { sortOrder: 2, fields: [ "indexStats" ] }
            ]
          },
          propertiesConfig: [
            { name: "entityName", label: "Entity Name", id: "entityName", column: "entityName", fieldType: "text" },
            // Index Info
            { name: "indexInfo", label: "Index Info", id: "indexInfo", column: "indexInfo", fieldType: "json" },
            // Index Stats
            { name: "indexStats", label: "Index Stats", id: "indexStats", column: "indexStats", fieldType: "json" },
          ]
        }
      },
      "indexTasks": {
        pageTitle: "Index Tasks",
        pageType: "list",
        listPageConfig: {
          apiConfig: {
            apiMethod: "GET",
            responseKey: "items",
            apiUrl: "/system/search/tasks?entityName.eq=:entityName"
          },
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
                availableOperators: [ "eq", "in", "nin" ],
                filterType: "number"
              },
              actions: [
                { icon: "view", label: "Details", url: "/system/search/tasks/:uid" }
              ]
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
                availableOperators: [ "eq", "in", "nin" ],
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
                availableOperators: [ "eq", "in", "nin" ],
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
                availableOperators: [ "gt", "lt", "eq" ],
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
                availableOperators: [ "gt", "lt", "eq" ],
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
                availableOperators: [ "gt", "lt", "eq" ],
                filterType: "datetime"
              }
            }
          ]
        }
      },
      "indexBatches": {
        pageTitle: "Index Batches",
        pageType: "list",
        listPageConfig: {
          apiConfig: {
            apiMethod: "GET",
            responseKey: "items",
            apiUrl: "/system/search/batches?entityName.eq=:entityName"
          },
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
              fieldType: "json",
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
                availableOperators: [ "eq", "in", "nin" ],
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
                availableOperators: [ "eq", "in", "nin" ],
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
                availableOperators: [ "gt", "lt", "eq" ],
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
                availableOperators: [ "gt", "lt", "eq" ],
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
      },
      "indexDocuments": {
        pageTitle: "Index Documents",
        pageType: "list",
        listPageConfig: {
          apiConfig: {
            apiMethod: "GET",
            useSearch: true,
            responseKey: "items",
            apiUrl: "/system/search/records/:entityName"
          },
          propertiesConfig: [
            {
              id: "id",
              name: "ID",
              dataIndex: "id",
              fieldType: "text",
              isListable: true,
              isSortable: false,
              isFilterable: false,
              isIdentifier: true,
              actions: [
                { icon: "view", label: "View Details", url: "/system/search/records/:entityName/:id" }
              ]
            },
            {
              name: "Full Record",
              dataIndex: "fullRecord",
              id: "fullRecord",
              isSortable: false,
              isFilterable: false,
              fieldType: "json",
              isListable: true
            }
          ]
        }
      }
    }
  }
};
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
    { label: "Edit Settings", url: "/system/search/indices/:entityName/settings", type: "button" },
    { 
      label: "Reset Settings", 
      openInModal: true,
      modalConfig: {
        modalType: "confirm",
        modalPageConfig: {
          title: "Reset Index Settings",
          content: "This will reset all index settings to their default values. This action cannot be undone."
        },
        apiConfig: {
          apiMethod: "POST",
          apiUrl: "/system/search/indices/:entityName/reset-settings"
        },
        submitSuccessRedirect: "/system/search/indices/:entityName"
      }
    },
    { 
      label: "Resync Records", 
      openInModal: true,
      modalConfig: {
        modalType: "confirm",
        modalPageConfig: {
          title: "Re-sync All Records",
          content: "This will re-sync all records from the database to the search index. This may take some time."
        },
        apiConfig: {
          apiMethod: "POST",
          apiUrl: "/system/search/indices/:entityName/resync"
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
          propertiesConfig: [
            { name: "entityName", label: "Entity Name", id: "entityName", column: "entityName", fieldType: "text" },
            // Index Info
            { name: "indexInfo.uid", label: "Index UID", id: "uid", column: "indexInfo.uid", fieldType: "text" },
            { name: "indexInfo.primaryKey", label: "Primary Key", id: "primaryKey", column: "indexInfo.primaryKey", fieldType: "text" },
            { name: "indexInfo.createdAt", label: "Created At", id: "createdAt", column: "indexInfo.createdAt", fieldType: "datetime" },
            { name: "indexInfo.updatedAt", label: "Updated At", id: "updatedAt", column: "indexInfo.updatedAt", fieldType: "datetime" },
            // Index Stats
            { name: "indexStats.numberOfDocuments", label: "Document Count", id: "numberOfDocuments", column: "indexStats.numberOfDocuments", fieldType: "number" },
            { name: "indexStats.isIndexing", label: "Is Indexing", id: "isIndexing", column: "indexStats.isIndexing", fieldType: "boolean" },
            { name: "indexStats.fieldDistribution", label: "Field Distribution", id: "fieldDistribution", column: "indexStats.fieldDistribution", fieldType: "json" },
            // Index Settings
            { name: "indexSettings.filterableAttributes", label: "Filterable Attributes", id: "filterableAttributes", column: "indexSettings.filterableAttributes", fieldType: "json" },
            { name: "indexSettings.sortableAttributes", label: "Sortable Attributes", id: "sortableAttributes", column: "indexSettings.sortableAttributes", fieldType: "json" },
            { name: "indexSettings.searchableAttributes", label: "Searchable Attributes", id: "searchableAttributes", column: "indexSettings.searchableAttributes", fieldType: "json" },
            { name: "indexSettings.displayedAttributes", label: "Displayed Attributes", id: "displayedAttributes", column: "indexSettings.displayedAttributes", fieldType: "json" },
            { name: "indexSettings.rankingRules", label: "Ranking Rules", id: "rankingRules", column: "indexSettings.rankingRules", fieldType: "json" },
            { name: "indexSettings.distinctAttribute", label: "Distinct Attribute", id: "distinctAttribute", column: "indexSettings.distinctAttribute", fieldType: "text" },
            { name: "indexSettings.stopWords", label: "Stop Words", id: "stopWords", column: "indexSettings.stopWords", fieldType: "json" },
            { name: "indexSettings.synonyms", label: "Synonyms", id: "synonyms", column: "indexSettings.synonyms", fieldType: "json" }
          ]
        }
      },
      "indexTasks": {
        pageTitle: "Index Tasks",
        pageType: "list",
        listPageConfig: {
          apiConfig: {
            apiMethod: "GET",
            useSearch: true,
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
              name: "Index UID",
              dataIndex: "indexUid",
              id: "indexUid",
              fieldType: "text",
              isListable: true,
              isFilterable: true,
              filterConfig: {
                defaultOperator: "eq",
                availableOperators: [ "eq", "in", "nin" ],
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
            useSearch: true,
            responseKey: "items",
            apiUrl: "/system/search/batches?entityName.eq=:entityName"
          },
          propertiesConfig: [
            {
              name: "Batch UID",
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
              name: "Index UID",
              dataIndex: "indexUid",
              id: "indexUid",
              fieldType: "text",
              isListable: true,
              isFilterable: true,
              filterConfig: {
                defaultOperator: "eq",
                availableOperators: [ "eq", "in", "nin" ],
              }
            },
            {
              name: "Batch Strategy",
              dataIndex: "batchStrategy",
              id: "batchStrategy",
              fieldType: "text",
              isListable: true,
              isFilterable: true,
              filterConfig: {
                defaultOperator: "eq",
                availableOperators: [ "eq", "in", "nin" ],
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
            },
            {
              name: "Progress",
              dataIndex: "progress",
              id: "progress",
              fieldType: "json",
              isListable: true,
              isFilterable: false
            }
          ]
        }
      }
    }
  }
}; 
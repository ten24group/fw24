import { AccordionPageConfig } from "../../../ui-config-gen";

export const meiliSearchBatchDetailPage: AccordionPageConfig = {
  pageTitle: "MeiliSearch Batch Detail",
  pageType: "accordion",
  routePattern: "/system/search/batches/:uid",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "Batches", url: "/system/search/batches" },
    { label: "Batch Detail" }
  ],
  accordionPageConfig: {
    accordions: {
      "batchDetails": {
        pageTitle: "Batch Details",
        pageType: "details",
        detailsPageConfig: {
          detailApiConfig: { 
            apiMethod: "GET", 
            responseKey: "", 
            apiUrl: "/system/search/batches/:uid" 
          },
          columnsConfig: {
            columns: [
              { sortOrder: 1, fields: [ "uid", "batchStrategy", "startedAt", "finishedAt", "duration", "progress", "details", "stats" ] },
            ]
          },
          propertiesConfig: [
            { name: "uid", label: "UID", id: "uid", column: "uid", fieldType: "number" },
            { name: "batchStrategy", label: "Batch Strategy", id: "batchStrategy", column: "batchStrategy", fieldType: "text" },
            { name: "startedAt", label: "Started At", id: "startedAt", column: "startedAt", fieldType: "datetime" },
            { name: "finishedAt", label: "Finished At", id: "finishedAt", column: "finishedAt", fieldType: "datetime" },
            { name: "duration", label: "Duration", id: "duration", column: "duration", fieldType: "text" },
            { name: "stats", label: "Stats", id: "stats", column: "stats", fieldType: "json" },
            { name: "progress", label: "Progress", id: "progress", column: "progress", fieldType: "json" },
            { name: "details", label: "Details", id: "details", column: "details", fieldType: "json" }
          ]
        }
      },
      "batchTasks": {
        pageTitle: "Batch Tasks",
        pageType: "list",
        listPageConfig: {
          apiConfig: {
            apiMethod: "GET",
            useSearch: true,
            responseKey: "items",
            apiUrl: "/system/search/tasks?batchUid.eq=:uid"
          },
          propertiesConfig: [
            { 
              name: "uid", 
              dataIndex: "uid", 
              fieldType: "number",
              isFilterable: true,
              filterConfig: {
                defaultOperator: "eq",
                filterType: "number"
              }
            },
            { 
              name: "batchUid", 
              dataIndex: "batchUid", 
              fieldType: "number",
              isFilterable: true,
              filterConfig: {
                defaultOperator: "eq",
                filterType: "number"
              }
            },
            { 
              name: "type", 
              dataIndex: "type", 
              fieldType: "text",
              isFilterable: true,
              filterConfig: {
                defaultOperator: "eq",
                filterType: "select",
                predefinedOptions: [
                  { label: "Document Addition/Update", value: "documentAdditionOrUpdate" },
                  { label: "Document Deletion", value: "documentDeletion" },
                  { label: "Settings Update", value: "settingsUpdate" },
                  { label: "Index Creation", value: "indexCreation" },
                  { label: "Index Deletion", value: "indexDeletion" },
                  { label: "Index Swap", value: "indexSwap" },
                  { label: "Dump Creation", value: "dumpCreation" }
                ]
              }
            },
            { 
              name: "status", 
              dataIndex: "status", 
              fieldType: "text",
              isFilterable: true,
              filterConfig: {
                defaultOperator: "eq",
                filterType: "select",
                predefinedOptions: [
                  { label: "Succeeded", value: "succeeded" },
                  { label: "Failed", value: "failed" },
                  { label: "Processing", value: "processing" },
                  { label: "Enqueued", value: "enqueued" }
                ]
              }
            },
            { 
              name: "indexUid", 
              dataIndex: "indexUid", 
              fieldType: "text",
              isFilterable: true,
              filterConfig: {
                defaultOperator: "eq",
                filterType: "text"
              }
            },
            { 
              name: "startedAt", 
              dataIndex: "startedAt", 
              fieldType: "datetime",
              isFilterable: true,
              filterConfig: {
                defaultOperator: "gt",
                filterType: "datetime"
              }
            },
            { 
              name: "finishedAt", 
              dataIndex: "finishedAt", 
              fieldType: "datetime",
              isFilterable: true,
              filterConfig: {
                defaultOperator: "gt",
                filterType: "datetime"
              }
            },
            { 
              name: "duration", 
              dataIndex: "duration", 
              fieldType: "text"
            },
            { 
              name: "error", 
              dataIndex: "error", 
              fieldType: "json"
            },
            { 
              name: "details", 
              dataIndex: "details", 
              fieldType: "json"
            }
          ]
        }
      }
    }
  }
};
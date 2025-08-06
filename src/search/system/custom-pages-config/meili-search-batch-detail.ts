import { DetailsPageConfig } from "../../../ui-config-gen";

export const meiliSearchBatchDetailPage: DetailsPageConfig = {
  pageTitle: "MeiliSearch Batch Detail",
  pageType: "details",
  routePattern: "/system/search/batches/:uid",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "Batches", url: "/system/search/batches" },
    { label: "Batch Detail" }
  ],
  detailsPageConfig: {
    detailApiConfig: { apiMethod: "GET", responseKey: "", apiUrl: "/system/search/batches/:uid" },
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
};
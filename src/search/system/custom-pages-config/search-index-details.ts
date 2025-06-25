import { DetailsPageConfig } from "../../../ui-config-gen";

export const searchIndexDetailsConfig: DetailsPageConfig = {
  pageTitle: "Search Index Details",
  pageType: "details",
  routePattern: "/system/search/indices/:entityName",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "Indices", url: "/system/search/indices" },
    { label: "Index Details" }
  ],
  pageHeaderActions: [
    { label: "Edit Settings", url: "/system/search/indices/:entityName/settings", type: "button" },
    { label: "Reset Settings", url: "/system/search/indices/:entityName/reset-settings", type: "button" },
    { label: "Resync Records", url: "/system/search/indices/:entityName/resync", type: "button" },
    { label: "Clear Documents", url: "/system/search/indices/:entityName/documents", type: "button" },
    { label: "Delete Index", url: "/system/search/indices/:entityName", type: "button" }
  ],
  detailsPageConfig: {
    detailApiConfig: { apiMethod: "GET", responseKey: "", apiUrl: "/system/search/indices/:entityName" },
    propertiesConfig: [
      { name: "entityName", label: "Entity Name", id: "entityName", column: "1", fieldType: "text" },
      // Index Info
      { name: "indexInfo.uid", label: "Index UID", id: "uid", column: "1", fieldType: "text" },
      { name: "indexInfo.primaryKey", label: "Primary Key", id: "primaryKey", column: "1", fieldType: "text" },
      { name: "indexInfo.createdAt", label: "Created At", id: "createdAt", column: "1", fieldType: "datetime" },
      { name: "indexInfo.updatedAt", label: "Updated At", id: "updatedAt", column: "1", fieldType: "datetime" },
      // Index Stats
      { name: "indexStats.numberOfDocuments", label: "Document Count", id: "numberOfDocuments", column: "1", fieldType: "number" },
      { name: "indexStats.isIndexing", label: "Is Indexing", id: "isIndexing", column: "1", fieldType: "boolean" },
      { name: "indexStats.fieldDistribution", label: "Field Distribution", id: "fieldDistribution", column: "12", fieldType: "json" },
      // Index Settings
      { name: "indexSettings.filterableAttributes", label: "Filterable Attributes", id: "filterableAttributes", column: "6", fieldType: "json" },
      { name: "indexSettings.sortableAttributes", label: "Sortable Attributes", id: "sortableAttributes", column: "6", fieldType: "json" },
      { name: "indexSettings.searchableAttributes", label: "Searchable Attributes", id: "searchableAttributes", column: "6", fieldType: "json" },
      { name: "indexSettings.displayedAttributes", label: "Displayed Attributes", id: "displayedAttributes", column: "6", fieldType: "json" },
      { name: "indexSettings.rankingRules", label: "Ranking Rules", id: "rankingRules", column: "6", fieldType: "json" },
      { name: "indexSettings.distinctAttribute", label: "Distinct Attribute", id: "distinctAttribute", column: "6", fieldType: "text" },
      { name: "indexSettings.stopWords", label: "Stop Words", id: "stopWords", column: "6", fieldType: "json" },
      { name: "indexSettings.synonyms", label: "Synonyms", id: "synonyms", column: "12", fieldType: "json" }
    ]
  }
}; 
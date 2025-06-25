import { DetailsPageConfig } from "../../../ui-config-gen";

export const meiliSearchStatsPage: DetailsPageConfig = {
  pageTitle: "MeiliSearch Stats",
  pageType: "details",
  routePattern: "/system/search/meili/stats",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search/indices" },
    { label: "Meili Stats" }
  ],
  detailsPageConfig: {
    detailApiConfig: { apiMethod: "GET", responseKey: "", apiUrl: "/system/search/meili/stats" },
    propertiesConfig: [
      { name: "databaseSize", label: "Database Size", id: "databaseSize", column: "1", fieldType: "number" },
      { name: "lastUpdate", label: "Last Update", id: "lastUpdate", column: "1", fieldType: "datetime" },
      { name: "indexes", label: "Indexes", id: "indexes", column: "12", fieldType: "json" }
    ]
  }
}; 
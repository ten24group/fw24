import { DetailsPageConfig } from "../../../ui-config-gen";

export const meiliSearchHealthPage: DetailsPageConfig = {
  pageTitle: "MeiliSearch Health",
  pageType: "details",
  routePattern: "/system/search/meili/health",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search/indices" },
    { label: "Meili Health" }
  ],
  detailsPageConfig: {
    detailApiConfig: { apiMethod: "GET", responseKey: "", apiUrl: "/system/search/meili/health" },
    propertiesConfig: [
      { name: "status", label: "Status", id: "status", column: "1", fieldType: "text" }
    ]
  }
}; 
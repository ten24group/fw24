import { DetailsPageConfig } from "../../../ui-config-gen";

export const meiliSearchIsHealthyPage: DetailsPageConfig = {
  pageTitle: "MeiliSearch Is Healthy?",
  pageType: "details",
  routePattern: "/system/search/meili/is-healthy",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search/indices" },
    { label: "Meili Health" }
  ],
  detailsPageConfig: {
    detailApiConfig: { apiMethod: "GET", responseKey: "isHealthy", apiUrl: "/system/search/meili/is-healthy" },
    propertiesConfig: [
      { name: "isHealthy", label: "Is Healthy", id: "isHealthy", column: "1", fieldType: "boolean" }
    ]
  }
}; 
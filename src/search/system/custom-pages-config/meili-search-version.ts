import { DetailsPageConfig } from "../../../ui-config-gen";

export const meiliSearchVersionPage: DetailsPageConfig = {
  pageTitle: "MeiliSearch Version",
  pageType: "details",
  routePattern: "/system/search/meili/version",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search/indices" },
    { label: "Meili Version" }
  ],
  detailsPageConfig: {
    detailApiConfig: { apiMethod: "GET", responseKey: "", apiUrl: "/system/search/meili/version" },
    propertiesConfig: [
      { name: "pkgVersion", label: "Package Version", id: "pkgVersion", column: "1", fieldType: "text" },
      { name: "commitSha", label: "Commit SHA", id: "commitSha", column: "1", fieldType: "text" },
      { name: "buildDate", label: "Build Date", id: "buildDate", column: "1", fieldType: "datetime" }
    ]
  }
}; 
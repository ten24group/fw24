import { FormPageConfig } from "../../../ui-config-gen";

export const meiliSearchExperimentalFeaturesPage: FormPageConfig = {
  pageTitle: "MeiliSearch Experimental Features",
  pageType: "form",
  routePattern: "/system/search/experimental-features",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "Experimental Features" }
  ],
  formPageConfig: {
    apiConfig: { apiMethod: "POST", apiUrl: "/system/search/experimental-features" },
    detailApiConfig: { apiMethod: "GET", apiUrl: "/system/search/experimental-features" },
    formButtons: [ "submit", "reset", { text: "Cancel", url: "/system/search" } ],
    propertiesConfig: [
      { name: "metrics", column: "metrics", fieldType: "boolean", label: "Metrics" },
      { name: "network", column: "network", fieldType: "boolean", label: "Network" },
      { name: "logsRoute", column: "logsRoute", fieldType: "boolean", label: "Logs Route" },
      { name: "containsFilter", column: "containsFilter", fieldType: "boolean", label: "Contains Filter" },
      { name: "editDocumentsByFunction", column: "editDocumentsByFunction", fieldType: "boolean", label: "Edit Documents By Function" }
    ],
    submitSuccessRedirect: "/system/search/experimental-features"
  }
};
import { FormPageConfig } from "../../../ui-config-gen";

export const meiliSearchExperimentalFeaturesPage: FormPageConfig = {
  pageTitle: "MeiliSearch Experimental Features",
  pageType: "form",
  routePattern: "/system/search/meili/experimental-features",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search/indices" },
    { label: "Experimental Features" }
  ],
  formPageConfig: {
    apiConfig: { apiMethod: "POST", responseKey: "", apiUrl: "/system/search/meili/experimental-features" },
    formButtons: [ "Submit" ],
    propertiesConfig: [
      { name: "metrics", column: "1", fieldType: "boolean", label: "Metrics" },
      { name: "network", column: "1", fieldType: "boolean", label: "Network" },
      { name: "logsRoute", column: "1", fieldType: "boolean", label: "Logs Route" },
      { name: "containsFilter", column: "1", fieldType: "boolean", label: "Contains Filter" },
      { name: "editDocumentsByFunction", column: "1", fieldType: "boolean", label: "Edit Documents By Function" }
    ],
    submitSuccessRedirect: "/system/search/meili/experimental-features"
  }
}; 
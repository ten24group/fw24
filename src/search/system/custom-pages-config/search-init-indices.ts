import { FormPageConfig } from "../../../ui-config-gen";

export const searchInitIndicesPage: FormPageConfig = {
  pageTitle: "Initialize Search Indices",
  pageType: "form",
  routePattern: "/system/search/initIndices",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search/indices" },
    { label: "Init Indices" }
  ],
  formPageConfig: {
    apiConfig: { apiMethod: "POST", responseKey: "results", apiUrl: "/system/search/initIndices" },
    formButtons: [ "Submit" ],
    propertiesConfig: [
      { name: "entities", label: "Entities to Initialize (JSON array)", id: "entities", column: "1", fieldType: "textarea", defaultValue: "[\"entity1\", \"entity2\"]" }
    ],
    submitSuccessRedirect: "/system/search/indices"
  }
}; 
import { FormPageConfig } from "../../../ui-config-gen";

export const searchResyncPage: FormPageConfig = {
  pageTitle: "Re-sync Records",
  pageType: "form",
  routePattern: "/system/search/indices/:entityName/resync",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "Indices", url: "/system/search/indices" },
    { label: "Re-sync Records" }
  ],
  formPageConfig: {
    apiConfig: { apiMethod: "POST", responseKey: "", apiUrl: "/system/search/indices/:entityName/resync" },
    formButtons: [ "Submit" ],
    propertiesConfig: [
      {
        name: "batchSize",
        label: "Batch Size",
        id: "batchSize",
        column: "batchSize",
        fieldType: "text",
        defaultValue: "25"
      },
      {
        name: "queueUrl",
        label: "Queue URL (optional)",
        id: "queueUrl",
        column: "queueUrl",
        fieldType: "text"
      }
    ],
    submitSuccessRedirect: "/system/search/indices/:entityName"
  }
};
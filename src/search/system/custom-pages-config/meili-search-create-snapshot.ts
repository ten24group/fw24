import { FormPageConfig } from "../../../ui-config-gen";

export const meiliSearchCreateSnapshotPage: FormPageConfig = {
  pageTitle: "Create MeiliSearch Snapshot",
  pageType: "form",
  routePattern: "/system/search/meili/snapshots",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search/indices" },
    { label: "Create Snapshot" }
  ],
  formPageConfig: {
    apiConfig: { apiMethod: "POST", responseKey: "", apiUrl: "/system/search/meili/snapshots" },
    formButtons: [ "Create" ],
    propertiesConfig: [],
    submitSuccessRedirect: "/system/search/meili/tasks"
  }
}; 
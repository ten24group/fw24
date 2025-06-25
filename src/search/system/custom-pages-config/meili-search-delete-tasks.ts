import { FormPageConfig } from "../../../ui-config-gen";

export const meiliSearchDeleteTasksPage: FormPageConfig = {
  pageTitle: "Delete MeiliSearch Tasks",
  pageType: "form",
  routePattern: "/system/search/meili/tasks/delete",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search/indices" },
    { label: "Delete Tasks" }
  ],
  formPageConfig: {
    apiConfig: { apiMethod: "DELETE", responseKey: "", apiUrl: "/system/search/meili/tasks" },
    formButtons: [ "Delete" ],
    propertiesConfig: [
      { name: "uids", label: "Task UIDs (JSON array)", id: "uids", column: "1", fieldType: "textarea", defaultValue: "[1, 2, 3]" }
    ],
    submitSuccessRedirect: "/system/search/meili/tasks"
  }
}; 
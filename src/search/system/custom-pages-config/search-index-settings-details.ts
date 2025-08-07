import { DetailsPageConfig } from "../../../ui-config-gen";

export const searchIndexSettingsDetailsConfig: DetailsPageConfig = {
  pageTitle: "Search Index Settings Details",
  pageType: "details",
  routePattern: "/system/search/indices/:entityName/settings-details",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "Indices", url: "/system/search/indices" },
    { label: "Index Details", url: "/system/search/indices/:entityName" },
    { label: "Settings Details" }
  ],
  pageHeaderActions: [
    { 
      label: "Edit Settings", 
      url: "/system/search/indices/:entityName/settings-edit", 
      type: "button" 
    },
    {
      label: "Reset Settings",
      openInModal: true,
      modalConfig: {
        modalType: "confirm",
        modalPageConfig: {
          title: "Reset Index Settings",
          content: "This will reset all index settings to their default values. This action cannot be undone."
        },
        apiConfig: {
          apiMethod: "POST",
          apiUrl: "/system/search/indices/:entityName/reset-settings"
        },
        submitSuccessRedirect: "/system/search/indices/:entityName/settings-details"
      }
    },
  ],
  detailsPageConfig: {
    detailApiConfig: { 
      apiMethod: "GET", 
      responseKey: "settings", 
      apiUrl: "/system/search/indices/:entityName/settings" 
    },
    propertiesConfig: [
      { 
        name: "displayedAttributes", 
        label: "Displayed Attributes", 
        id: "displayedAttributes", 
        column: "displayedAttributes", 
        fieldType: "json" 
      },
      { 
        name: "searchableAttributes", 
        label: "Searchable Attributes", 
        id: "searchableAttributes", 
        column: "searchableAttributes", 
        fieldType: "json" 
      },
      { 
        name: "filterableAttributes", 
        label: "Filterable Attributes", 
        id: "filterableAttributes", 
        column: "filterableAttributes", 
        fieldType: "json" 
      },
      { 
        name: "sortableAttributes", 
        label: "Sortable Attributes", 
        id: "sortableAttributes", 
        column: "sortableAttributes", 
        fieldType: "json" 
      },
      { 
        name: "rankingRules", 
        label: "Ranking Rules", 
        id: "rankingRules", 
        column: "rankingRules", 
        fieldType: "json" 
      },
      { 
        name: "stopWords", 
        label: "Stop Words", 
        id: "stopWords", 
        column: "stopWords", 
        fieldType: "json" 
      },
      { 
        name: "nonSeparatorTokens", 
        label: "Non-Separator Tokens", 
        id: "nonSeparatorTokens", 
        column: "nonSeparatorTokens", 
        fieldType: "json" 
      },
      { 
        name: "separatorTokens", 
        label: "Separator Tokens", 
        id: "separatorTokens", 
        column: "separatorTokens", 
        fieldType: "json" 
      },
      { 
        name: "dictionary", 
        label: "Dictionary", 
        id: "dictionary", 
        column: "dictionary", 
        fieldType: "json" 
      },
      { 
        name: "synonyms", 
        label: "Synonyms", 
        id: "synonyms", 
        column: "synonyms", 
        fieldType: "json" 
      },
      { 
        name: "distinctAttribute", 
        label: "Distinct Attribute", 
        id: "distinctAttribute", 
        column: "distinctAttribute", 
        fieldType: "text" 
      },
      { 
        name: "proximityPrecision", 
        label: "Proximity Precision", 
        id: "proximityPrecision", 
        column: "proximityPrecision", 
        fieldType: "text" 
      },
      { 
        name: "typoTolerance", 
        label: "Typo Tolerance", 
        id: "typoTolerance", 
        column: "typoTolerance", 
        fieldType: "json" 
      },
      { 
        name: "faceting", 
        label: "Faceting", 
        id: "faceting", 
        column: "faceting", 
        fieldType: "json" 
      },
      { 
        name: "pagination", 
        label: "Pagination", 
        id: "pagination", 
        column: "pagination", 
        fieldType: "json" 
      },
      { 
        name: "embedders", 
        label: "Embedders", 
        id: "embedders", 
        column: "embedders", 
        fieldType: "json" 
      },
      { 
        name: "searchCutoffMs", 
        label: "Search Cutoff (ms)", 
        id: "searchCutoffMs", 
        column: "searchCutoffMs", 
        fieldType: "number" 
      },
      { 
        name: "localizedAttributes", 
        label: "Localized Attributes", 
        id: "localizedAttributes", 
        column: "localizedAttributes", 
        fieldType: "json" 
      },
      { 
        name: "facetSearch", 
        label: "Facet Search", 
        id: "facetSearch", 
        column: "facetSearch", 
        fieldType: "boolean" 
      },
      { 
        name: "prefixSearch", 
        label: "Prefix Search", 
        id: "prefixSearch", 
        column: "prefixSearch", 
        fieldType: "text" 
      }
    ]
  }
}; 
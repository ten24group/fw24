"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchIndexSettingsFormConfig = void 0;
exports.searchIndexSettingsFormConfig = {
    pageTitle: "Search Index Settings",
    pageType: "form",
    routePattern: "/system/search/indices/:entityName/settings-edit",
    breadcrumbs: [
        { label: "Home", url: "/" },
        { label: "Search", url: "/system/search" },
        { label: "Indices", url: "/system/search/indices" },
        { label: "Index Details", url: "/system/search/indices/:entityName" },
        { label: "Settings Details", url: "/system/search/indices/:entityName/settings-details" },
        { label: "Edit Settings" }
    ],
    formPageConfig: {
        detailApiConfig: {
            apiMethod: "GET",
            apiUrl: "/system/search/indices/:entityName/settings"
        },
        apiConfig: {
            apiMethod: "PUT",
            responseKey: "result",
            apiUrl: "/system/search/indices/:entityName/settings"
        },
        formButtons: ["submit", "reset", { text: "Cancel", url: "/system/search/indices/:entityName/settings-details" }],
        propertiesConfig: [
            {
                name: "settings",
                label: "Search Index Settings",
                column: "settings",
                fieldType: "object",
                type: 'map',
                helpText: "Configure all search index settings for this index.",
                properties: [
                    {
                        name: "displayedAttributes",
                        label: "Displayed Attributes",
                        column: "displayedAttributes",
                        fieldType: "list",
                        type: 'list',
                        items: { type: 'text' },
                        helpText: "List of attributes to display in the search results. Use '*' for all attributes.",
                        defaultValue: ["*"]
                    },
                    {
                        name: "searchableAttributes",
                        label: "Searchable Attributes",
                        column: "searchableAttributes",
                        fieldType: "list",
                        type: 'list',
                        items: { type: 'text' },
                        helpText: "List of attributes that the search engine can search through. Use '*' for all attributes.",
                        defaultValue: ["*"]
                    },
                    {
                        name: "filterableAttributes",
                        label: "Filterable Attributes",
                        column: "filterableAttributes",
                        fieldType: "list",
                        type: 'list',
                        items: { type: 'text' },
                        helpText: "List of attributes that can be used as filters.",
                        defaultValue: []
                    },
                    {
                        name: "sortableAttributes",
                        label: "Sortable Attributes",
                        column: "sortableAttributes",
                        fieldType: "list",
                        type: 'list',
                        items: { type: 'text' },
                        helpText: "List of attributes that can be used for sorting search results.",
                        defaultValue: []
                    },
                    {
                        name: "rankingRules",
                        label: "Ranking Rules",
                        column: "rankingRules",
                        fieldType: "multi-select",
                        options: [
                            { value: "words", label: "Words" },
                            { value: "typo", label: "Typo" },
                            { value: "proximity", label: "Proximity" },
                            { value: "attribute", label: "Attribute" },
                            { value: "sort", label: "Sort" },
                            { value: "exactness", label: "Exactness" }
                        ],
                        helpText: "The order of ranking rules for search results. Order matters.",
                        defaultValue: ["words", "typo", "proximity", "attribute", "sort", "exactness"]
                    },
                    {
                        name: "stopWords",
                        label: "Stop Words",
                        column: "stopWords",
                        fieldType: "list",
                        type: 'list',
                        items: { type: 'text' },
                        helpText: "List of words that will be ignored by the search engine.",
                        defaultValue: []
                    },
                    {
                        name: "nonSeparatorTokens",
                        label: "Non-Separator Tokens",
                        column: "nonSeparatorTokens",
                        fieldType: "list",
                        type: 'list',
                        items: { type: 'text' },
                        helpText: "List of tokens that should not be treated as separators.",
                        defaultValue: []
                    },
                    {
                        name: "separatorTokens",
                        label: "Separator Tokens",
                        column: "separatorTokens",
                        fieldType: "list",
                        type: 'list',
                        items: { type: 'text' },
                        helpText: "List of tokens that should be treated as separators.",
                        defaultValue: []
                    },
                    {
                        name: "dictionary",
                        label: "Dictionary",
                        column: "dictionary",
                        fieldType: "list",
                        type: 'list',
                        items: { type: 'text' },
                        helpText: "List of words to be added to the dictionary.",
                        defaultValue: []
                    },
                    {
                        name: "synonyms",
                        label: "Synonyms",
                        column: "synonyms",
                        fieldType: "json",
                        placeholder: "{\"wolverine\": [\"xmen\", \"logan\"], \"logan\": [\"wolverine\", \"xmen\"]}",
                        helpText: "Define sets of words that should be considered equivalent. Each key should map to an array of strings. Example: {\"wolverine\": [\"xmen\", \"logan\"]}",
                        defaultValue: "{}"
                    },
                    {
                        name: "distinctAttribute",
                        label: "Distinct Attribute",
                        column: "distinctAttribute",
                        fieldType: "text",
                        placeholder: "Enter attribute name or leave empty for null",
                        helpText: "An attribute to ensure there are no duplicate documents in the results. Can be null.",
                        defaultValue: null
                    },
                    {
                        name: "typoTolerance",
                        label: "Typo Tolerance",
                        column: "typoTolerance",
                        fieldType: "object",
                        type: 'map',
                        helpText: "Configure the tolerance for typos in search queries.",
                        properties: [
                            {
                                name: "enabled",
                                label: "Enabled",
                                column: "enabled",
                                fieldType: "boolean",
                                helpText: "Enable or disable typo tolerance.",
                                defaultValue: true
                            },
                            {
                                name: "minWordSizeForTypos",
                                label: "Minimum Word Size for Typos",
                                column: "minWordSizeForTypos",
                                fieldType: "object",
                                type: 'map',
                                helpText: "Configure minimum word size for typo tolerance.",
                                properties: [
                                    {
                                        name: "oneTypo",
                                        label: "One Typo",
                                        column: "oneTypo",
                                        fieldType: "number",
                                        helpText: "Minimum word size for one typo.",
                                        defaultValue: 5
                                    },
                                    {
                                        name: "twoTypos",
                                        label: "Two Typos",
                                        column: "twoTypos",
                                        fieldType: "number",
                                        helpText: "Minimum word size for two typos.",
                                        defaultValue: 9
                                    }
                                ]
                            },
                            {
                                name: "disableOnWords",
                                label: "Disable On Words",
                                column: "disableOnWords",
                                fieldType: "list",
                                type: 'list',
                                items: { type: 'text' },
                                helpText: "List of words to disable typo tolerance on.",
                                defaultValue: []
                            },
                            {
                                name: "disableOnAttributes",
                                label: "Disable On Attributes",
                                column: "disableOnAttributes",
                                fieldType: "list",
                                type: 'list',
                                items: { type: 'text' },
                                helpText: "List of attributes to disable typo tolerance on.",
                                defaultValue: []
                            }
                        ]
                    },
                    {
                        name: "faceting",
                        label: "Faceting",
                        column: "faceting",
                        fieldType: "object",
                        type: 'map',
                        helpText: "Configure settings for faceted search.",
                        properties: [
                            {
                                name: "maxValuesPerFacet",
                                label: "Max Values Per Facet",
                                column: "maxValuesPerFacet",
                                fieldType: "number",
                                helpText: "Maximum number of values per facet.",
                                defaultValue: 100
                            },
                            {
                                name: "sortFacetValuesBy",
                                label: "Sort Facet Values By",
                                column: "sortFacetValuesBy",
                                fieldType: "json",
                                placeholder: "{\"*\": \"alpha\", \"price\": \"desc\", \"name\": \"asc\"}",
                                helpText: "Configure how facet values are sorted. Each attribute maps to 'alpha' or 'count'. Example: {\"*\": \"alpha\", \"price\": \"desc\"}",
                                defaultValue: "{}"
                            }
                        ]
                    },
                    {
                        name: "pagination",
                        label: "Pagination",
                        column: "pagination",
                        fieldType: "object",
                        type: 'map',
                        helpText: "Configure pagination settings.",
                        properties: [
                            {
                                name: "maxTotalHits",
                                label: "Max Total Hits",
                                column: "maxTotalHits",
                                fieldType: "number",
                                helpText: "Maximum total hits for pagination.",
                                defaultValue: 1000
                            }
                        ]
                    },
                    {
                        name: "proximityPrecision",
                        label: "Proximity Precision",
                        column: "proximityPrecision",
                        fieldType: "select",
                        options: [
                            { value: "byWord", label: "By Word" },
                            { value: "byAttribute", label: "By Attribute" }
                        ],
                        helpText: "Configure how proximity is calculated.",
                        defaultValue: "byWord"
                    },
                    {
                        name: "embedders",
                        label: "Embedders",
                        column: "embedders",
                        fieldType: "json",
                        placeholder: "{\"default\": {\"source\": \"openAi\", \"model\": \"text-embedding-ada-002\", \"apiKey\": \"your-api-key\"}}",
                        helpText: "Configure embedders for semantic search. Each embedder should have source, model, and apiKey properties.",
                        defaultValue: "{}"
                    },
                    {
                        name: "searchCutoffMs",
                        label: "Search Cutoff (ms)",
                        column: "searchCutoffMs",
                        fieldType: "number",
                        placeholder: "Enter milliseconds or leave empty for null",
                        helpText: "Maximum time in milliseconds to spend on a search query. Can be null for no limit.",
                        defaultValue: null
                    },
                    {
                        name: "localizedAttributes",
                        label: "Localized Attributes",
                        column: "localizedAttributes",
                        fieldType: "json",
                        placeholder: "{\"title\": {\"fr\": \"titre\", \"en\": \"title\"}, \"description\": {\"fr\": \"description\", \"en\": \"description\"}}",
                        helpText: "Configure localized attributes for multi-language support. Each attribute maps to language codes. Can be null.",
                        defaultValue: null
                    },
                    {
                        name: "facetSearch",
                        label: "Facet Search",
                        column: "facetSearch",
                        fieldType: "boolean",
                        helpText: "Enable or disable facet search functionality.",
                        defaultValue: true
                    },
                    {
                        name: "prefixSearch",
                        label: "Prefix Search",
                        column: "prefixSearch",
                        fieldType: "select",
                        options: [
                            { value: "indexingTime", label: "Indexing Time" },
                            { value: "searchTime", label: "Search Time" }
                        ],
                        helpText: "Configure when prefix search is performed.",
                        defaultValue: "indexingTime"
                    },
                ]
            }
        ],
        submitSuccessRedirect: "/system/search/indices/:entityName/settings-details"
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VhcmNoLWluZGV4LXNldHRpbmdzLWVkaXQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvc2VhcmNoL3N5c3RlbS9jdXN0b20tcGFnZXMtY29uZmlnL3NlYXJjaC1pbmRleC1zZXR0aW5ncy1lZGl0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVhLFFBQUEsNkJBQTZCLEdBQW1CO0lBQzNELFNBQVMsRUFBRSx1QkFBdUI7SUFDbEMsUUFBUSxFQUFFLE1BQU07SUFDaEIsWUFBWSxFQUFFLGtEQUFrRDtJQUNoRSxXQUFXLEVBQUU7UUFDWCxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRTtRQUMzQixFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLGdCQUFnQixFQUFFO1FBQzFDLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRSxHQUFHLEVBQUUsd0JBQXdCLEVBQUU7UUFDbkQsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFLEdBQUcsRUFBRSxvQ0FBb0MsRUFBRTtRQUNyRSxFQUFFLEtBQUssRUFBRSxrQkFBa0IsRUFBRSxHQUFHLEVBQUUscURBQXFELEVBQUU7UUFDekYsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFO0tBQzNCO0lBQ0QsY0FBYyxFQUFFO1FBQ2QsZUFBZSxFQUFFO1lBQ2YsU0FBUyxFQUFFLEtBQUs7WUFDaEIsTUFBTSxFQUFFLDZDQUE2QztTQUN0RDtRQUNELFNBQVMsRUFBRTtZQUNULFNBQVMsRUFBRSxLQUFLO1lBQ2hCLFdBQVcsRUFBRSxRQUFRO1lBQ3JCLE1BQU0sRUFBRSw2Q0FBNkM7U0FDdEQ7UUFDRCxXQUFXLEVBQUUsQ0FBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxHQUFHLEVBQUUscURBQXFELEVBQUUsQ0FBRTtRQUNsSCxnQkFBZ0IsRUFBRTtZQUNoQjtnQkFDRSxJQUFJLEVBQUUsVUFBVTtn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SSxFQUFFLHFCQUFxQjt3QkFDM0IsS0FBSyxFQUFFLHNCQUFzQjt3QkFDN0IsTUFBTSxFQUFFLHFCQUFxQjt3QkFDN0IsU0FBUyxFQUFFLE1BQU07d0JBQ2pCLFdBQVcsRUFBRSwwSEFBMEg7d0JBQ3ZJLFFBQVEsRUFBRSxnSEFBZ0g7d0JBQzFILFlBQVksRUFBRSxJQUFJO3FCQUNuQjtvQkFDRDt3QkFDRSxJQUFJLEVBQUUsYUFBYTt3QkFDbkIsS0FBSyxFQUFFLGNBQWM7d0JBQ3JCLE1BQU0sRUFBRSxhQUFhO3dCQUNyQixTQUFTLEVBQUUsU0FBUzt3QkFDcEIsUUFBUSxFQUFFLCtDQUErQzt3QkFDekQsWUFBWSxFQUFFLElBQUk7cUJBQ25CO29CQUNEO3dCQUNFLElBQUksRUFBRSxjQUFjO3dCQUNwQixLQUFLLEVBQUUsZUFBZTt3QkFDdEIsTUFBTSxFQUFFLGNBQWM7d0JBQ3RCLFNBQVMsRUFBRSxRQUFRO3dCQUNuQixPQUFPLEVBQUU7NEJBQ0wsRUFBRSxLQUFLLEVBQUUsY0FBYyxFQUFFLEtBQUssRUFBRSxlQUFlLEVBQUU7NEJBQ2pELEVBQUUsS0FBSyxFQUFFLFlBQVksRUFBRSxLQUFLLEVBQUUsYUFBYSxFQUFFO3lCQUNoRDt3QkFDRCxRQUFRLEVBQUUsNENBQTRDO3dCQUN0RCxZQUFZLEVBQUUsY0FBYztxQkFDN0I7aUJBRUY7YUFDRjtTQUNGO1FBQ0QscUJBQXFCLEVBQUUscURBQXFEO0tBQzdFO0NBQ0YsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEZvcm1QYWdlQ29uZmlnIH0gZnJvbSBcIi4uLy4uLy4uL3VpLWNvbmZpZy1nZW5cIjtcblxuZXhwb3J0IGNvbnN0IHNlYXJjaEluZGV4U2V0dGluZ3NGb3JtQ29uZmlnOiBGb3JtUGFnZUNvbmZpZyA9IHtcbiAgcGFnZVRpdGxlOiBcIlNlYXJjaCBJbmRleCBTZXR0aW5nc1wiLFxuICBwYWdlVHlwZTogXCJmb3JtXCIsXG4gIHJvdXRlUGF0dGVybjogXCIvc3lzdGVtL3NlYXJjaC9pbmRpY2VzLzplbnRpdHlOYW1lL3NldHRpbmdzLWVkaXRcIixcbiAgYnJlYWRjcnVtYnM6IFtcbiAgICB7IGxhYmVsOiBcIkhvbWVcIiwgdXJsOiBcIi9cIiB9LFxuICAgIHsgbGFiZWw6IFwiU2VhcmNoXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaFwiIH0sXG4gICAgeyBsYWJlbDogXCJJbmRpY2VzXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaC9pbmRpY2VzXCIgfSxcbiAgICB7IGxhYmVsOiBcIkluZGV4IERldGFpbHNcIiwgdXJsOiBcIi9zeXN0ZW0vc2VhcmNoL2luZGljZXMvOmVudGl0eU5hbWVcIiB9LFxuICAgIHsgbGFiZWw6IFwiU2V0dGluZ3MgRGV0YWlsc1wiLCB1cmw6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlcy86ZW50aXR5TmFtZS9zZXR0aW5ncy1kZXRhaWxzXCIgfSxcbiAgICB7IGxhYmVsOiBcIkVkaXQgU2V0dGluZ3NcIiB9XG4gIF0sXG4gIGZvcm1QYWdlQ29uZmlnOiB7XG4gICAgZGV0YWlsQXBpQ29uZmlnOiB7XG4gICAgICBhcGlNZXRob2Q6IFwiR0VUXCIsXG4gICAgICBhcGlVcmw6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlcy86ZW50aXR5TmFtZS9zZXR0aW5nc1wiXG4gICAgfSxcbiAgICBhcGlDb25maWc6IHtcbiAgICAgIGFwaU1ldGhvZDogXCJQVVRcIixcbiAgICAgIHJlc3BvbnNlS2V5OiBcInJlc3VsdFwiLFxuICAgICAgYXBpVXJsOiBcIi9zeXN0ZW0vc2VhcmNoL2luZGljZXMvOmVudGl0eU5hbWUvc2V0dGluZ3NcIlxuICAgIH0sXG4gICAgZm9ybUJ1dHRvbnM6IFsgXCJzdWJtaXRcIiwgXCJyZXNldFwiLCB7IHRleHQ6IFwiQ2FuY2VsXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaC9pbmRpY2VzLzplbnRpdHlOYW1lL3NldHRpbmdzLWRldGFpbHNcIiB9IF0sXG4gICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgeyBcbiAgICAgICAgbmFtZTogXCJzZXR0aW5nc1wiLCBcbiAgICAgICAgbGFiZWw6IFwiU2VhcmNoIEluZGV4IFNldHRpbmdzXCIsIFxuICAgICAgICBjb2x1bW46IFwic2V0dGluZ3NcIiwgXG4gICAgICAgIGZpZWxkVHlwZTogXCJvYmplY3RcIixcbiAgICAgICAgdHlwZTogJ21hcCcsXG4gICAgICAgIGhlbHBUZXh0OiBcIkNvbmZpZ3VyZSBhbGwgc2VhcmNoIGluZGV4IHNldHRpbmdzIGZvciB0aGlzIGluZGV4LlwiLFxuICAgICAgICBwcm9wZXJ0aWVzOiBbXG4gICAgICAgICAgeyBcbiAgICAgICAgICAgIG5hbWU6IFwiZGlzcGxheWVkQXR0cmlidXRlc1wiLCBcbiAgICAgICAgICAgIGxhYmVsOiBcIkRpc3BsYXllZCBBdHRyaWJ1dGVzXCIsIFxuICAgICAgICAgICAgY29sdW1uOiBcImRpc3BsYXllZEF0dHJpYnV0ZXNcIiwgXG4gICAgICAgICAgICBmaWVsZFR5cGU6IFwibGlzdFwiLFxuICAgICAgICAgICAgdHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgaXRlbXM6IHsgdHlwZTogJ3RleHQnIH0sXG4gICAgICAgICAgICBoZWxwVGV4dDogXCJMaXN0IG9mIGF0dHJpYnV0ZXMgdG8gZGlzcGxheSBpbiB0aGUgc2VhcmNoIHJlc3VsdHMuIFVzZSAnKicgZm9yIGFsbCBhdHRyaWJ1dGVzLlwiLFxuICAgICAgICAgICAgZGVmYXVsdFZhbHVlOiBbXCIqXCJdXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7IFxuICAgICAgICAgICAgbmFtZTogXCJzZWFyY2hhYmxlQXR0cmlidXRlc1wiLCBcbiAgICAgICAgICAgIGxhYmVsOiBcIlNlYXJjaGFibGUgQXR0cmlidXRlc1wiLCBcbiAgICAgICAgICAgIGNvbHVtbjogXCJzZWFyY2hhYmxlQXR0cmlidXRlc1wiLCBcbiAgICAgICAgICAgIGZpZWxkVHlwZTogXCJsaXN0XCIsXG4gICAgICAgICAgICB0eXBlOiAnbGlzdCcsXG4gICAgICAgICAgICBpdGVtczogeyB0eXBlOiAndGV4dCcgfSxcbiAgICAgICAgICAgIGhlbHBUZXh0OiBcIkxpc3Qgb2YgYXR0cmlidXRlcyB0aGF0IHRoZSBzZWFyY2ggZW5naW5lIGNhbiBzZWFyY2ggdGhyb3VnaC4gVXNlICcqJyBmb3IgYWxsIGF0dHJpYnV0ZXMuXCIsXG4gICAgICAgICAgICBkZWZhdWx0VmFsdWU6IFtcIipcIl1cbiAgICAgICAgICB9LFxuICAgICAgICAgIHsgXG4gICAgICAgICAgICBuYW1lOiBcImZpbHRlcmFibGVBdHRyaWJ1dGVzXCIsIFxuICAgICAgICAgICAgbGFiZWw6IFwiRmlsdGVyYWJsZSBBdHRyaWJ1dGVzXCIsIFxuICAgICAgICAgICAgY29sdW1uOiBcImZpbHRlcmFibGVBdHRyaWJ1dGVzXCIsIFxuICAgICAgICAgICAgZmllbGRUeXBlOiBcImxpc3RcIixcbiAgICAgICAgICAgIHR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgIGl0ZW1zOiB7IHR5cGU6ICd0ZXh0JyB9LFxuICAgICAgICAgICAgaGVscFRleHQ6IFwiTGlzdCBvZiBhdHRyaWJ1dGVzIHRoYXQgY2FuIGJlIHVzZWQgYXMgZmlsdGVycy5cIixcbiAgICAgICAgICAgIGRlZmF1bHRWYWx1ZTogW11cbiAgICAgICAgICB9LFxuICAgICAgICAgIHsgXG4gICAgICAgICAgICBuYW1lOiBcInNvcnRhYmxlQXR0cmlidXRlc1wiLCBcbiAgICAgICAgICAgIGxhYmVsOiBcIlNvcnRhYmxlIEF0dHJpYnV0ZXNcIiwgXG4gICAgICAgICAgICBjb2x1bW46IFwic29ydGFibGVBdHRyaWJ1dGVzXCIsIFxuICAgICAgICAgICAgZmllbGRUeXBlOiBcImxpc3RcIixcbiAgICAgICAgICAgIHR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgIGl0ZW1zOiB7IHR5cGU6ICd0ZXh0JyB9LFxuICAgICAgICAgICAgaGVscFRleHQ6IFwiTGlzdCBvZiBhdHRyaWJ1dGVzIHRoYXQgY2FuIGJlIHVzZWQgZm9yIHNvcnRpbmcgc2VhcmNoIHJlc3VsdHMuXCIsXG4gICAgICAgICAgICBkZWZhdWx0VmFsdWU6IFtdXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7IFxuICAgICAgICAgICAgbmFtZTogXCJyYW5raW5nUnVsZXNcIiwgXG4gICAgICAgICAgICBsYWJlbDogXCJSYW5raW5nIFJ1bGVzXCIsIFxuICAgICAgICAgICAgY29sdW1uOiBcInJhbmtpbmdSdWxlc1wiLCBcbiAgICAgICAgICAgIGZpZWxkVHlwZTogXCJtdWx0aS1zZWxlY3RcIixcbiAgICAgICAgICAgIG9wdGlvbnM6IFtcbiAgICAgICAgICAgICAgICB7IHZhbHVlOiBcIndvcmRzXCIsIGxhYmVsOiBcIldvcmRzXCIgfSxcbiAgICAgICAgICAgICAgICB7IHZhbHVlOiBcInR5cG9cIiwgbGFiZWw6IFwiVHlwb1wiIH0sXG4gICAgICAgICAgICAgICAgeyB2YWx1ZTogXCJwcm94aW1pdHlcIiwgbGFiZWw6IFwiUHJveGltaXR5XCIgfSxcbiAgICAgICAgICAgICAgICB7IHZhbHVlOiBcImF0dHJpYnV0ZVwiLCBsYWJlbDogXCJBdHRyaWJ1dGVcIiB9LFxuICAgICAgICAgICAgICAgIHsgdmFsdWU6IFwic29ydFwiLCBsYWJlbDogXCJTb3J0XCIgfSxcbiAgICAgICAgICAgICAgICB7IHZhbHVlOiBcImV4YWN0bmVzc1wiLCBsYWJlbDogXCJFeGFjdG5lc3NcIiB9XG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgaGVscFRleHQ6IFwiVGhlIG9yZGVyIG9mIHJhbmtpbmcgcnVsZXMgZm9yIHNlYXJjaCByZXN1bHRzLiBPcmRlciBtYXR0ZXJzLlwiLFxuICAgICAgICAgICAgZGVmYXVsdFZhbHVlOiBbXCJ3b3Jkc1wiLCBcInR5cG9cIiwgXCJwcm94aW1pdHlcIiwgXCJhdHRyaWJ1dGVcIiwgXCJzb3J0XCIsIFwiZXhhY3RuZXNzXCJdXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7IFxuICAgICAgICAgICAgbmFtZTogXCJzdG9wV29yZHNcIiwgXG4gICAgICAgICAgICBsYWJlbDogXCJTdG9wIFdvcmRzXCIsIFxuICAgICAgICAgICAgY29sdW1uOiBcInN0b3BXb3Jkc1wiLCBcbiAgICAgICAgICAgIGZpZWxkVHlwZTogXCJsaXN0XCIsXG4gICAgICAgICAgICB0eXBlOiAnbGlzdCcsXG4gICAgICAgICAgICBpdGVtczogeyB0eXBlOiAndGV4dCcgfSxcbiAgICAgICAgICAgIGhlbHBUZXh0OiBcIkxpc3Qgb2Ygd29yZHMgdGhhdCB3aWxsIGJlIGlnbm9yZWQgYnkgdGhlIHNlYXJjaCBlbmdpbmUuXCIsXG4gICAgICAgICAgICBkZWZhdWx0VmFsdWU6IFtdXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7IFxuICAgICAgICAgICAgbmFtZTogXCJub25TZXBhcmF0b3JUb2tlbnNcIiwgXG4gICAgICAgICAgICBsYWJlbDogXCJOb24tU2VwYXJhdG9yIFRva2Vuc1wiLCBcbiAgICAgICAgICAgIGNvbHVtbjogXCJub25TZXBhcmF0b3JUb2tlbnNcIiwgXG4gICAgICAgICAgICBmaWVsZFR5cGU6IFwibGlzdFwiLFxuICAgICAgICAgICAgdHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgaXRlbXM6IHsgdHlwZTogJ3RleHQnIH0sXG4gICAgICAgICAgICBoZWxwVGV4dDogXCJMaXN0IG9mIHRva2VucyB0aGF0IHNob3VsZCBub3QgYmUgdHJlYXRlZCBhcyBzZXBhcmF0b3JzLlwiLFxuICAgICAgICAgICAgZGVmYXVsdFZhbHVlOiBbXVxuICAgICAgICAgIH0sXG4gICAgICAgICAgeyBcbiAgICAgICAgICAgIG5hbWU6IFwic2VwYXJhdG9yVG9rZW5zXCIsIFxuICAgICAgICAgICAgbGFiZWw6IFwiU2VwYXJhdG9yIFRva2Vuc1wiLCBcbiAgICAgICAgICAgIGNvbHVtbjogXCJzZXBhcmF0b3JUb2tlbnNcIiwgXG4gICAgICAgICAgICBmaWVsZFR5cGU6IFwibGlzdFwiLFxuICAgICAgICAgICAgdHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgaXRlbXM6IHsgdHlwZTogJ3RleHQnIH0sXG4gICAgICAgICAgICBoZWxwVGV4dDogXCJMaXN0IG9mIHRva2VucyB0aGF0IHNob3VsZCBiZSB0cmVhdGVkIGFzIHNlcGFyYXRvcnMuXCIsXG4gICAgICAgICAgICBkZWZhdWx0VmFsdWU6IFtdXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7IFxuICAgICAgICAgICAgbmFtZTogXCJkaWN0aW9uYXJ5XCIsIFxuICAgICAgICAgICAgbGFiZWw6IFwiRGljdGlvbmFyeVwiLCBcbiAgICAgICAgICAgIGNvbHVtbjogXCJkaWN0aW9uYXJ5XCIsIFxuICAgICAgICAgICAgZmllbGRUeXBlOiBcImxpc3RcIixcbiAgICAgICAgICAgIHR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgIGl0ZW1zOiB7IHR5cGU6ICd0ZXh0JyB9LFxuICAgICAgICAgICAgaGVscFRleHQ6IFwiTGlzdCBvZiB3b3JkcyB0byBiZSBhZGRlZCB0byB0aGUgZGljdGlvbmFyeS5cIixcbiAgICAgICAgICAgIGRlZmF1bHRWYWx1ZTogW11cbiAgICAgICAgICB9LFxuICAgICAgICAgIHsgXG4gICAgICAgICAgICBuYW1lOiBcInN5bm9ueW1zXCIsIFxuICAgICAgICAgICAgbGFiZWw6IFwiU3lub255bXNcIiwgXG4gICAgICAgICAgICBjb2x1bW46IFwic3lub255bXNcIiwgXG4gICAgICAgICAgICBmaWVsZFR5cGU6IFwianNvblwiLFxuICAgICAgICAgICAgcGxhY2Vob2xkZXI6IFwie1xcXCJ3b2x2ZXJpbmVcXFwiOiBbXFxcInhtZW5cXFwiLCBcXFwibG9nYW5cXFwiXSwgXFxcImxvZ2FuXFxcIjogW1xcXCJ3b2x2ZXJpbmVcXFwiLCBcXFwieG1lblxcXCJdfVwiLFxuICAgICAgICAgICAgaGVscFRleHQ6IFwiRGVmaW5lIHNldHMgb2Ygd29yZHMgdGhhdCBzaG91bGQgYmUgY29uc2lkZXJlZCBlcXVpdmFsZW50LiBFYWNoIGtleSBzaG91bGQgbWFwIHRvIGFuIGFycmF5IG9mIHN0cmluZ3MuIEV4YW1wbGU6IHtcXFwid29sdmVyaW5lXFxcIjogW1xcXCJ4bWVuXFxcIiwgXFxcImxvZ2FuXFxcIl19XCIsXG4gICAgICAgICAgICBkZWZhdWx0VmFsdWU6IFwie31cIlxuICAgICAgICAgIH0sXG4gICAgICAgICAgeyBcbiAgICAgICAgICAgIG5hbWU6IFwiZGlzdGluY3RBdHRyaWJ1dGVcIiwgXG4gICAgICAgICAgICBsYWJlbDogXCJEaXN0aW5jdCBBdHRyaWJ1dGVcIiwgXG4gICAgICAgICAgICBjb2x1bW46IFwiZGlzdGluY3RBdHRyaWJ1dGVcIiwgXG4gICAgICAgICAgICBmaWVsZFR5cGU6IFwidGV4dFwiLFxuICAgICAgICAgICAgcGxhY2Vob2xkZXI6IFwiRW50ZXIgYXR0cmlidXRlIG5hbWUgb3IgbGVhdmUgZW1wdHkgZm9yIG51bGxcIixcbiAgICAgICAgICAgIGhlbHBUZXh0OiBcIkFuIGF0dHJpYnV0ZSB0byBlbnN1cmUgdGhlcmUgYXJlIG5vIGR1cGxpY2F0ZSBkb2N1bWVudHMgaW4gdGhlIHJlc3VsdHMuIENhbiBiZSBudWxsLlwiLFxuICAgICAgICAgICAgZGVmYXVsdFZhbHVlOiBudWxsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7IFxuICAgICAgICAgICAgbmFtZTogXCJ0eXBvVG9sZXJhbmNlXCIsIFxuICAgICAgICAgICAgbGFiZWw6IFwiVHlwbyBUb2xlcmFuY2VcIiwgXG4gICAgICAgICAgICBjb2x1bW46IFwidHlwb1RvbGVyYW5jZVwiLCBcbiAgICAgICAgICAgIGZpZWxkVHlwZTogXCJvYmplY3RcIixcbiAgICAgICAgICAgIHR5cGU6ICdtYXAnLFxuICAgICAgICAgICAgaGVscFRleHQ6IFwiQ29uZmlndXJlIHRoZSB0b2xlcmFuY2UgZm9yIHR5cG9zIGluIHNlYXJjaCBxdWVyaWVzLlwiLFxuICAgICAgICAgICAgcHJvcGVydGllczogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogXCJlbmFibGVkXCIsXG4gICAgICAgICAgICAgICAgbGFiZWw6IFwiRW5hYmxlZFwiLFxuICAgICAgICAgICAgICAgIGNvbHVtbjogXCJlbmFibGVkXCIsXG4gICAgICAgICAgICAgICAgZmllbGRUeXBlOiBcImJvb2xlYW5cIixcbiAgICAgICAgICAgICAgICBoZWxwVGV4dDogXCJFbmFibGUgb3IgZGlzYWJsZSB0eXBvIHRvbGVyYW5jZS5cIixcbiAgICAgICAgICAgICAgICBkZWZhdWx0VmFsdWU6IHRydWVcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6IFwibWluV29yZFNpemVGb3JUeXBvc1wiLFxuICAgICAgICAgICAgICAgIGxhYmVsOiBcIk1pbmltdW0gV29yZCBTaXplIGZvciBUeXBvc1wiLFxuICAgICAgICAgICAgICAgIGNvbHVtbjogXCJtaW5Xb3JkU2l6ZUZvclR5cG9zXCIsXG4gICAgICAgICAgICAgICAgZmllbGRUeXBlOiBcIm9iamVjdFwiLFxuICAgICAgICAgICAgICAgIHR5cGU6ICdtYXAnLFxuICAgICAgICAgICAgICAgIGhlbHBUZXh0OiBcIkNvbmZpZ3VyZSBtaW5pbXVtIHdvcmQgc2l6ZSBmb3IgdHlwbyB0b2xlcmFuY2UuXCIsXG4gICAgICAgICAgICAgICAgcHJvcGVydGllczogW1xuICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBuYW1lOiBcIm9uZVR5cG9cIixcbiAgICAgICAgICAgICAgICAgICAgbGFiZWw6IFwiT25lIFR5cG9cIixcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uOiBcIm9uZVR5cG9cIixcbiAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiBcIm51bWJlclwiLFxuICAgICAgICAgICAgICAgICAgICBoZWxwVGV4dDogXCJNaW5pbXVtIHdvcmQgc2l6ZSBmb3Igb25lIHR5cG8uXCIsXG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRWYWx1ZTogNVxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogXCJ0d29UeXBvc1wiLFxuICAgICAgICAgICAgICAgICAgICBsYWJlbDogXCJUd28gVHlwb3NcIixcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uOiBcInR3b1R5cG9zXCIsXG4gICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogXCJudW1iZXJcIixcbiAgICAgICAgICAgICAgICAgICAgaGVscFRleHQ6IFwiTWluaW11bSB3b3JkIHNpemUgZm9yIHR3byB0eXBvcy5cIixcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdFZhbHVlOiA5XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogXCJkaXNhYmxlT25Xb3Jkc1wiLFxuICAgICAgICAgICAgICAgIGxhYmVsOiBcIkRpc2FibGUgT24gV29yZHNcIixcbiAgICAgICAgICAgICAgICBjb2x1bW46IFwiZGlzYWJsZU9uV29yZHNcIixcbiAgICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwibGlzdFwiLFxuICAgICAgICAgICAgICAgIHR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICBpdGVtczogeyB0eXBlOiAndGV4dCcgfSxcbiAgICAgICAgICAgICAgICBoZWxwVGV4dDogXCJMaXN0IG9mIHdvcmRzIHRvIGRpc2FibGUgdHlwbyB0b2xlcmFuY2Ugb24uXCIsXG4gICAgICAgICAgICAgICAgZGVmYXVsdFZhbHVlOiBbXVxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogXCJkaXNhYmxlT25BdHRyaWJ1dGVzXCIsXG4gICAgICAgICAgICAgICAgbGFiZWw6IFwiRGlzYWJsZSBPbiBBdHRyaWJ1dGVzXCIsXG4gICAgICAgICAgICAgICAgY29sdW1uOiBcImRpc2FibGVPbkF0dHJpYnV0ZXNcIixcbiAgICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwibGlzdFwiLFxuICAgICAgICAgICAgICAgIHR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICBpdGVtczogeyB0eXBlOiAndGV4dCcgfSxcbiAgICAgICAgICAgICAgICBoZWxwVGV4dDogXCJMaXN0IG9mIGF0dHJpYnV0ZXMgdG8gZGlzYWJsZSB0eXBvIHRvbGVyYW5jZSBvbi5cIixcbiAgICAgICAgICAgICAgICBkZWZhdWx0VmFsdWU6IFtdXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIF1cbiAgICAgICAgICB9LFxuICAgICAgICAgIHsgXG4gICAgICAgICAgICBuYW1lOiBcImZhY2V0aW5nXCIsIFxuICAgICAgICAgICAgbGFiZWw6IFwiRmFjZXRpbmdcIiwgXG4gICAgICAgICAgICBjb2x1bW46IFwiZmFjZXRpbmdcIiwgXG4gICAgICAgICAgICBmaWVsZFR5cGU6IFwib2JqZWN0XCIsXG4gICAgICAgICAgICB0eXBlOiAnbWFwJyxcbiAgICAgICAgICAgIGhlbHBUZXh0OiBcIkNvbmZpZ3VyZSBzZXR0aW5ncyBmb3IgZmFjZXRlZCBzZWFyY2guXCIsXG4gICAgICAgICAgICBwcm9wZXJ0aWVzOiBbXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiBcIm1heFZhbHVlc1BlckZhY2V0XCIsXG4gICAgICAgICAgICAgICAgbGFiZWw6IFwiTWF4IFZhbHVlcyBQZXIgRmFjZXRcIixcbiAgICAgICAgICAgICAgICBjb2x1bW46IFwibWF4VmFsdWVzUGVyRmFjZXRcIixcbiAgICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwibnVtYmVyXCIsXG4gICAgICAgICAgICAgICAgaGVscFRleHQ6IFwiTWF4aW11bSBudW1iZXIgb2YgdmFsdWVzIHBlciBmYWNldC5cIixcbiAgICAgICAgICAgICAgICBkZWZhdWx0VmFsdWU6IDEwMFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogXCJzb3J0RmFjZXRWYWx1ZXNCeVwiLFxuICAgICAgICAgICAgICAgIGxhYmVsOiBcIlNvcnQgRmFjZXQgVmFsdWVzIEJ5XCIsXG4gICAgICAgICAgICAgICAgY29sdW1uOiBcInNvcnRGYWNldFZhbHVlc0J5XCIsXG4gICAgICAgICAgICAgICAgZmllbGRUeXBlOiBcImpzb25cIixcbiAgICAgICAgICAgICAgICBwbGFjZWhvbGRlcjogXCJ7XFxcIipcXFwiOiBcXFwiYWxwaGFcXFwiLCBcXFwicHJpY2VcXFwiOiBcXFwiZGVzY1xcXCIsIFxcXCJuYW1lXFxcIjogXFxcImFzY1xcXCJ9XCIsXG4gICAgICAgICAgICAgICAgaGVscFRleHQ6IFwiQ29uZmlndXJlIGhvdyBmYWNldCB2YWx1ZXMgYXJlIHNvcnRlZC4gRWFjaCBhdHRyaWJ1dGUgbWFwcyB0byAnYWxwaGEnIG9yICdjb3VudCcuIEV4YW1wbGU6IHtcXFwiKlxcXCI6IFxcXCJhbHBoYVxcXCIsIFxcXCJwcmljZVxcXCI6IFxcXCJkZXNjXFxcIn1cIixcbiAgICAgICAgICAgICAgICBkZWZhdWx0VmFsdWU6IFwie31cIlxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBdXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7IFxuICAgICAgICAgICAgbmFtZTogXCJwYWdpbmF0aW9uXCIsIFxuICAgICAgICAgICAgbGFiZWw6IFwiUGFnaW5hdGlvblwiLCBcbiAgICAgICAgICAgIGNvbHVtbjogXCJwYWdpbmF0aW9uXCIsIFxuICAgICAgICAgICAgZmllbGRUeXBlOiBcIm9iamVjdFwiLFxuICAgICAgICAgICAgdHlwZTogJ21hcCcsXG4gICAgICAgICAgICBoZWxwVGV4dDogXCJDb25maWd1cmUgcGFnaW5hdGlvbiBzZXR0aW5ncy5cIixcbiAgICAgICAgICAgIHByb3BlcnRpZXM6IFtcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6IFwibWF4VG90YWxIaXRzXCIsXG4gICAgICAgICAgICAgICAgbGFiZWw6IFwiTWF4IFRvdGFsIEhpdHNcIixcbiAgICAgICAgICAgICAgICBjb2x1bW46IFwibWF4VG90YWxIaXRzXCIsXG4gICAgICAgICAgICAgICAgZmllbGRUeXBlOiBcIm51bWJlclwiLFxuICAgICAgICAgICAgICAgIGhlbHBUZXh0OiBcIk1heGltdW0gdG90YWwgaGl0cyBmb3IgcGFnaW5hdGlvbi5cIixcbiAgICAgICAgICAgICAgICBkZWZhdWx0VmFsdWU6IDEwMDBcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgXVxuICAgICAgICAgIH0sXG4gICAgICAgICAgeyBcbiAgICAgICAgICAgIG5hbWU6IFwicHJveGltaXR5UHJlY2lzaW9uXCIsIFxuICAgICAgICAgICAgbGFiZWw6IFwiUHJveGltaXR5IFByZWNpc2lvblwiLCBcbiAgICAgICAgICAgIGNvbHVtbjogXCJwcm94aW1pdHlQcmVjaXNpb25cIiwgXG4gICAgICAgICAgICBmaWVsZFR5cGU6IFwic2VsZWN0XCIsXG4gICAgICAgICAgICBvcHRpb25zOiBbXG4gICAgICAgICAgICAgICAgeyB2YWx1ZTogXCJieVdvcmRcIiwgbGFiZWw6IFwiQnkgV29yZFwiIH0sXG4gICAgICAgICAgICAgICAgeyB2YWx1ZTogXCJieUF0dHJpYnV0ZVwiLCBsYWJlbDogXCJCeSBBdHRyaWJ1dGVcIiB9XG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgaGVscFRleHQ6IFwiQ29uZmlndXJlIGhvdyBwcm94aW1pdHkgaXMgY2FsY3VsYXRlZC5cIixcbiAgICAgICAgICAgIGRlZmF1bHRWYWx1ZTogXCJieVdvcmRcIlxuICAgICAgICAgIH0sXG4gICAgICAgICAgeyBcbiAgICAgICAgICAgIG5hbWU6IFwiZW1iZWRkZXJzXCIsIFxuICAgICAgICAgICAgbGFiZWw6IFwiRW1iZWRkZXJzXCIsIFxuICAgICAgICAgICAgY29sdW1uOiBcImVtYmVkZGVyc1wiLCBcbiAgICAgICAgICAgIGZpZWxkVHlwZTogXCJqc29uXCIsXG4gICAgICAgICAgICBwbGFjZWhvbGRlcjogXCJ7XFxcImRlZmF1bHRcXFwiOiB7XFxcInNvdXJjZVxcXCI6IFxcXCJvcGVuQWlcXFwiLCBcXFwibW9kZWxcXFwiOiBcXFwidGV4dC1lbWJlZGRpbmctYWRhLTAwMlxcXCIsIFxcXCJhcGlLZXlcXFwiOiBcXFwieW91ci1hcGkta2V5XFxcIn19XCIsXG4gICAgICAgICAgICBoZWxwVGV4dDogXCJDb25maWd1cmUgZW1iZWRkZXJzIGZvciBzZW1hbnRpYyBzZWFyY2guIEVhY2ggZW1iZWRkZXIgc2hvdWxkIGhhdmUgc291cmNlLCBtb2RlbCwgYW5kIGFwaUtleSBwcm9wZXJ0aWVzLlwiLFxuICAgICAgICAgICAgZGVmYXVsdFZhbHVlOiBcInt9XCJcbiAgICAgICAgICB9LFxuICAgICAgICAgIHsgXG4gICAgICAgICAgICBuYW1lOiBcInNlYXJjaEN1dG9mZk1zXCIsIFxuICAgICAgICAgICAgbGFiZWw6IFwiU2VhcmNoIEN1dG9mZiAobXMpXCIsIFxuICAgICAgICAgICAgY29sdW1uOiBcInNlYXJjaEN1dG9mZk1zXCIsIFxuICAgICAgICAgICAgZmllbGRUeXBlOiBcIm51bWJlclwiLFxuICAgICAgICAgICAgcGxhY2Vob2xkZXI6IFwiRW50ZXIgbWlsbGlzZWNvbmRzIG9yIGxlYXZlIGVtcHR5IGZvciBudWxsXCIsXG4gICAgICAgICAgICBoZWxwVGV4dDogXCJNYXhpbXVtIHRpbWUgaW4gbWlsbGlzZWNvbmRzIHRvIHNwZW5kIG9uIGEgc2VhcmNoIHF1ZXJ5LiBDYW4gYmUgbnVsbCBmb3Igbm8gbGltaXQuXCIsXG4gICAgICAgICAgICBkZWZhdWx0VmFsdWU6IG51bGxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHsgXG4gICAgICAgICAgICBuYW1lOiBcImxvY2FsaXplZEF0dHJpYnV0ZXNcIiwgXG4gICAgICAgICAgICBsYWJlbDogXCJMb2NhbGl6ZWQgQXR0cmlidXRlc1wiLCBcbiAgICAgICAgICAgIGNvbHVtbjogXCJsb2NhbGl6ZWRBdHRyaWJ1dGVzXCIsIFxuICAgICAgICAgICAgZmllbGRUeXBlOiBcImpzb25cIixcbiAgICAgICAgICAgIHBsYWNlaG9sZGVyOiBcIntcXFwidGl0bGVcXFwiOiB7XFxcImZyXFxcIjogXFxcInRpdHJlXFxcIiwgXFxcImVuXFxcIjogXFxcInRpdGxlXFxcIn0sIFxcXCJkZXNjcmlwdGlvblxcXCI6IHtcXFwiZnJcXFwiOiBcXFwiZGVzY3JpcHRpb25cXFwiLCBcXFwiZW5cXFwiOiBcXFwiZGVzY3JpcHRpb25cXFwifX1cIixcbiAgICAgICAgICAgIGhlbHBUZXh0OiBcIkNvbmZpZ3VyZSBsb2NhbGl6ZWQgYXR0cmlidXRlcyBmb3IgbXVsdGktbGFuZ3VhZ2Ugc3VwcG9ydC4gRWFjaCBhdHRyaWJ1dGUgbWFwcyB0byBsYW5ndWFnZSBjb2Rlcy4gQ2FuIGJlIG51bGwuXCIsXG4gICAgICAgICAgICBkZWZhdWx0VmFsdWU6IG51bGxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHsgXG4gICAgICAgICAgICBuYW1lOiBcImZhY2V0U2VhcmNoXCIsIFxuICAgICAgICAgICAgbGFiZWw6IFwiRmFjZXQgU2VhcmNoXCIsIFxuICAgICAgICAgICAgY29sdW1uOiBcImZhY2V0U2VhcmNoXCIsIFxuICAgICAgICAgICAgZmllbGRUeXBlOiBcImJvb2xlYW5cIixcbiAgICAgICAgICAgIGhlbHBUZXh0OiBcIkVuYWJsZSBvciBkaXNhYmxlIGZhY2V0IHNlYXJjaCBmdW5jdGlvbmFsaXR5LlwiLFxuICAgICAgICAgICAgZGVmYXVsdFZhbHVlOiB0cnVlXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7IFxuICAgICAgICAgICAgbmFtZTogXCJwcmVmaXhTZWFyY2hcIiwgXG4gICAgICAgICAgICBsYWJlbDogXCJQcmVmaXggU2VhcmNoXCIsIFxuICAgICAgICAgICAgY29sdW1uOiBcInByZWZpeFNlYXJjaFwiLCBcbiAgICAgICAgICAgIGZpZWxkVHlwZTogXCJzZWxlY3RcIixcbiAgICAgICAgICAgIG9wdGlvbnM6IFtcbiAgICAgICAgICAgICAgICB7IHZhbHVlOiBcImluZGV4aW5nVGltZVwiLCBsYWJlbDogXCJJbmRleGluZyBUaW1lXCIgfSxcbiAgICAgICAgICAgICAgICB7IHZhbHVlOiBcInNlYXJjaFRpbWVcIiwgbGFiZWw6IFwiU2VhcmNoIFRpbWVcIiB9XG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgaGVscFRleHQ6IFwiQ29uZmlndXJlIHdoZW4gcHJlZml4IHNlYXJjaCBpcyBwZXJmb3JtZWQuXCIsXG4gICAgICAgICAgICBkZWZhdWx0VmFsdWU6IFwiaW5kZXhpbmdUaW1lXCJcbiAgICAgICAgICB9LFxuXG4gICAgICAgIF1cbiAgICAgIH1cbiAgICBdLFxuICAgIHN1Ym1pdFN1Y2Nlc3NSZWRpcmVjdDogXCIvc3lzdGVtL3NlYXJjaC9pbmRpY2VzLzplbnRpdHlOYW1lL3NldHRpbmdzLWRldGFpbHNcIlxuICB9XG59OyJdfQ==
declare module "@edition-routes" {
  export default function EditionRoutes(): React.JSX.Element;
}

declare module "@edition-help" {
  const helpCatalogue: import("../features/help/guide").HelpCatalogue;
  export default helpCatalogue;
}

declare module "@edition-course-offers" {
  export const changeCandidatesQuery: typeof import("../features/changes/api").changeCandidatesQuery;
  export const lifecycleQuery: typeof import("../features/jobs/lifecycle-api").lifecycleQuery;
  export const refreshJobState: typeof import("../features/jobs/lifecycle-api").refreshJobState;
  export const OfferPublicationAction: typeof import("../features/jobs/publish-draft").OfferPublicationAction;
}

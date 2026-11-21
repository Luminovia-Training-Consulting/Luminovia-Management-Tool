declare module "@edition-routes" {
  export default function EditionRoutes(): React.JSX.Element;
}

declare module "@edition-help" {
  const helpCatalogue: import("../features/help/guide").HelpCatalogue;
  export default helpCatalogue;
}

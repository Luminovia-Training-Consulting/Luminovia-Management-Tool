declare module "@edition-routes" {
  export default function EditionRoutes(): React.JSX.Element;
}

declare module "@edition-help" {
  const helpCatalogue: import("../features/help/guide").HelpCatalogue;
  export default helpCatalogue;
}

declare module "@edition-demo-guides" {
  const demoGuides: import("../features/help/guide").GuideModule[];
  export default demoGuides;
}

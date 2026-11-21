declare module "swagger-ui-react" {
  import type { ComponentType } from "react";

  const SwaggerUI: ComponentType<{
    spec: object;
    filter: boolean;
    queryConfigEnabled: boolean;
    requestSnippetsEnabled: boolean;
    supportedSubmitMethods: string[];
    showMutatedRequest: boolean;
    persistAuthorization: boolean;
    requestInterceptor: (
      request: import("./requests").ExplorerRequest,
    ) => Promise<import("./requests").ExplorerRequest>;
  }>;
  export default SwaggerUI;
}

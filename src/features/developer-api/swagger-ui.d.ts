declare module "swagger-ui-dist/swagger-ui-bundle.js" {
  type Request = import("./request-boundary").ExplorerRequest;

  export default function SwaggerUI(options: {
    domNode: HTMLElement;
    docExpansion: "list";
    defaultModelsExpandDepth: number;
    plugins: (() => {
      wrapComponents: {
        App: (
          app: import("react").ComponentType<Record<string, unknown>>,
          system: { React: typeof import("react") },
        ) => import("react").ComponentType<Record<string, unknown>>;
      };
    })[];
    validatorUrl: null;
    queryConfigEnabled: false;
    requestSnippetsEnabled: false;
    showMutatedRequest: false;
    persistAuthorization: false;
    supportedSubmitMethods: readonly string[];
    requestInterceptor: (request: Request) => Promise<Request>;
  }): {
    specActions: {
      updateSpec(spec: string): void;
      updateLoadingStatus(status: "success"): void;
    };
  };
}

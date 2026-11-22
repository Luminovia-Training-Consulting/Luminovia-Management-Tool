import { useEffect, useEffectEvent, useRef } from "react";
import SwaggerUI from "swagger-ui-dist/swagger-ui-bundle.js";
import "swagger-ui-dist/swagger-ui.css";
import type { ExplorerRequest } from "./request-boundary";

type SwaggerViewProps = {
  spec: object;
  supportedSubmitMethods: readonly string[];
  requestInterceptor: (request: ExplorerRequest) => Promise<ExplorerRequest>;
};

/** Mount the standalone Swagger renderer in its own DOM subtree. */
export function SwaggerView({
  spec,
  supportedSubmitMethods,
  requestInterceptor,
}: SwaggerViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<ReturnType<typeof SwaggerUI> | null>(null);
  const intercept = useEffectEvent(requestInterceptor);

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    const lifetime = new AbortController();
    const subscribe = (onClose: () => void) => {
      lifetime.signal.addEventListener("abort", onClose);
      return () => lifetime.signal.removeEventListener("abort", onClose);
    };
    const active = () => !lifetime.signal.aborted;
    const target = document.createElement("div");
    host.append(target);
    instance.current = SwaggerUI({
      domNode: target,
      plugins: [
        () => ({
          wrapComponents: {
            App: (App, { React }) =>
              function MountedSwagger(props) {
                return React.useSyncExternalStore(subscribe, active)
                  ? React.createElement(App, props)
                  : null;
              },
          },
        }),
      ],
      validatorUrl: null,
      queryConfigEnabled: false,
      requestSnippetsEnabled: false,
      showMutatedRequest: false,
      persistAuthorization: false,
      supportedSubmitMethods,
      requestInterceptor: (request) => intercept(request),
    });
    return () => {
      instance.current = null;
      lifetime.abort();
      target.remove();
    };
  }, [supportedSubmitMethods]);

  useEffect(() => {
    instance.current?.specActions.updateLoadingStatus("success");
    instance.current?.specActions.updateSpec(JSON.stringify(spec));
  }, [spec, supportedSubmitMethods]);

  return <div ref={container} />;
}

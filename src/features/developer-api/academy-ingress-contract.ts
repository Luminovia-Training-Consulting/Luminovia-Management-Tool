/** Rejections from dedicated Envoy and the Caddy maintenance fence. */
const gatewayRejections = {
  "429": {
    description:
      "The installation-wide signed request allowance is exhausted. Envoy replenishes the shared bucket every 60 seconds.",
    body: "local_rate_limited",
  },
  "503": {
    description: "The academy is briefly unavailable for maintenance.",
    body: "Kurze Wartung. Bitte gleich erneut versuchen. / Brief maintenance. Please try again shortly.",
  },
};

type ApiResponse = {
  description: string;
  headers?: Record<string, object>;
  content?: Record<string, object>;
};

function ingressResponse(
  rejection: (typeof gatewayRejections)[keyof typeof gatewayRejections],
  upstream?: ApiResponse,
) {
  return {
    description: upstream
      ? `${rejection.description} ${upstream.description}`
      : rejection.description,
    headers: {
      ...upstream?.headers,
      "Retry-After": {
        description:
          "Delay in seconds. Present with value 60 for this ingress response. An upstream error may omit it.",
        schema: { type: "integer", minimum: 0 },
        example: 60,
      },
    },
    content: {
      ...upstream?.content,
      "text/plain": { schema: { type: "string", const: rejection.body } },
    },
  };
}

type Routes = Record<
  string,
  Record<string, { responses: Record<string, ApiResponse> }>
>;
type WithIngressResponses<T extends Routes> = {
  [Path in keyof T]: {
    [Method in keyof T[Path]]: T[Path][Method] & {
      responses: Record<
        keyof typeof gatewayRejections,
        ReturnType<typeof ingressResponse>
      >;
    };
  };
};

/** Keep handler-specific JSON responses and describe the extra gateway responses on every operation. */
export function withAcademyIngressResponses<T extends Routes>(paths: T) {
  return Object.fromEntries(
    Object.entries(paths).map(([path, operations]) => [
      path,
      Object.fromEntries(
        Object.entries(operations).map(([method, operation]) => [
          method,
          {
            ...operation,
            responses: {
              ...operation.responses,
              "429": ingressResponse(
                gatewayRejections["429"],
                operation.responses["429"],
              ),
              "503": ingressResponse(
                gatewayRejections["503"],
                operation.responses["503"],
              ),
            },
          },
        ]),
      ),
    ]),
  ) as WithIngressResponses<T>;
}

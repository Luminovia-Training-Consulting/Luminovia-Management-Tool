/**
 * Selfhost Edge router based on the documented Supabase template. Load only known portal functions; JWT checks and bounded worker restarts complement each handler's Auth/RLS checks.
 */
import * as jose from "jsr:@panva/jose@6.2.17";
import {startMemoryPressureLoop} from "./memory-pressure.ts";
import {logRuntimeFailure} from "./safe-log.ts";
import {dispatchToWorker} from "./worker-dispatch.mjs";

console.log("main function started");
startMemoryPressureLoop();

addEventListener("unhandledrejection", (ev) => {
    // Without preventDefault(), a floating rejection destroys the main worker and the process exits.
    // Sync throws inside timer callbacks are still fatal; wrap them in try/catch.
    ev.preventDefault();
    logRuntimeFailure("unhandled_rejection", ev.reason);
});

const MAX_WORKER_RETRIES = 3;

// Only reviewed application workers are executable, including through the private gateway.
const PORTAL_FUNCTIONS = new Set([
    "files",
    "invite-lecturer",
    "accounts",
    "course-documents",
    "learning-lti",
    "calendar-feed",
    "website-enquiries",
    "mail-admin",
    "human-login",
    "human-recovery",
    "company-integration",
    "portal-api",
]);

const legacyJwtSigningKey = Deno.env.get("JWT_SECRET");
const SUPABASE_JWKS = parseJwks(Deno.env.get("SUPABASE_JWKS"));
const LOCAL_JWKS = SUPABASE_JWKS ? jose.createLocalJWKSet(SUPABASE_JWKS) : null;
const VERIFY_JWT = Deno.env.get("VERIFY_JWT") === "true";

type AuthFailure = {
    code: RequestErrors;
    message?: string;
};

type FunctionFailure = {
    code: RequestErrors;
    message: string;
    status: number;
};

export enum RequestErrors {
    InvalidLegacyJWT = "UNAUTHORIZED_LEGACY_JWT",
    InvalidAsymmetricJWT = "UNAUTHORIZED_ASYMMETRIC_JWT",
    InvalidTokenFormat = "UNAUTHORIZED_INVALID_JWT_FORMAT",
    UnsupportedTokenAlgorithm = "UNAUTHORIZED_UNSUPPORTED_TOKEN_ALGORITHM",
    MissingAuthHeader = "UNAUTHORIZED_NO_AUTH_HEADER",
    NotFound = "NOT_FOUND",
    BootError = "BOOT_ERROR",
    EdgeFunctionError = "EDGE_FUNCTION_ERROR",
    IdleTimeout = "IDLE_TIMEOUT",
    WorkerResourceLimit = "WORKER_RESOURCE_LIMIT",
    WorkerError = "WORKER_ERROR",
    InvalidResponseStatusCode = "INVALID_RESPONSE_STATUS_CODE",
}

// Errors from this router stay readable from browsers, as on the platform.
// Function responses keep the function's own CORS headers.
const ERROR_CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey",
    "Access-Control-Expose-Headers": "sb-error-code",
};

// Return stable router codes and browser-readable error headers; business handlers retain their own responses.
function getFunctionErrorResponse({
                                      code,
                                      message,
                                      status,
                                  }: FunctionFailure): Response {
    return Response.json(
        {code, message},
        {
            status,
            headers: {
                ...ERROR_CORS_HEADERS,
                "sb-error-code": code,
            },
        },
    );
}

// Associate an unhandled router error with a random reference and return a bounded client error.
function onError(e: unknown): Response {
    const ref = crypto.randomUUID();
    logRuntimeFailure("request_handler_failed", e, ref);
    return getFunctionErrorResponse({
        code: RequestErrors.BootError,
        message: `Internal Server Error (ref: ${ref})`,
        status: 503,
    });
}

// Preserve the worker response, adding the diagnostic code only for server errors.
function handleWorkerResponse(response: Response): Response {
    if (response.status < 500) return response;

    const headers = new Headers(response.headers);
    headers.set("sb-error-code", RequestErrors.EdgeFunctionError);

    const exposedHeaders = (headers.get("Access-Control-Expose-Headers") ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
    if (!exposedHeaders.some((name) => name.toLowerCase() === "sb-error-code")) {
        exposedHeaders.push("sb-error-code");
    }
    headers.set("Access-Control-Expose-Headers", exposedHeaders.join(", "));

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

// Map actual Edge Runtime errors to their documented HTTP statuses/error codes.
function resolveRuntimeError(e: unknown): FunctionFailure {
    // These error classes are supplied by Edge Runtime, rather than stock Deno.
    if (e instanceof Deno.errors.InvalidWorkerCreation) {
        return {
            code: RequestErrors.BootError,
            message: "Function failed to start (please check logs)",
            status: 503,
        };
    }
    if (e instanceof Deno.errors.WorkerRequestCancelled) {
        return {
            code: RequestErrors.WorkerResourceLimit,
            message:
                "Function failed due to not having enough compute resources (please check logs)",
            status: 546,
        };
    }
    if (e instanceof Deno.errors.WorkerRequestIdleTimeout) {
        return {
            code: RequestErrors.IdleTimeout,
            message: "Request idle timeout limit (150s) reached",
            status: 504,
        };
    }
    // No dedicated runtime error class exists for invalid response statuses.
    // The Response constructor throws directly here or inside the user worker.
    if (
        (e instanceof RangeError ||
            e instanceof Deno.errors.InvalidWorkerResponse) &&
        e.message.includes("is not equal to 101 and outside the range [200, 599]")
    ) {
        return {
            code: RequestErrors.InvalidResponseStatusCode,
            message:
                "Function returned an invalid HTTP status code (please check logs)",
            status: 500,
        };
    }
    if (
        e instanceof Deno.errors.WorkerAlreadyRetired ||
        e instanceof Deno.errors.InvalidWorkerResponse
    ) {
        return {
            code: RequestErrors.WorkerError,
            message: "Function exited due to an error (please check logs)",
            status: 500,
        };
    }
    return {
        code: RequestErrors.EdgeFunctionError,
        message: "Internal Server Error",
        status: 500,
    };
}

// NOTE:(kallebysantos) We don't check for valid keys but just the bare array parsing,
// let this for 'jose' lib verification
// Check only JWKS container structure; jose performs cryptographic key/signature validation.
export function parseJwks(raw: string | undefined): jose.JSONWebKeySet | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (parsed?.keys && Array.isArray(parsed.keys)) {
            return parsed as jose.JSONWebKeySet;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Extract JWT token from 'Authorization' header or fallback to 'sb-api-key' compatibility
 *
 * Parses the Authorization header to extract the Bearer token.
 * Expects format: "Bearer <token>"
 *
 * @param req - The HTTP request object
 * @returns The JWT token string or an authentication failure
 */
// Accept exactly one nonempty bearer value; decide key compatibility separately afterward.
function extractBearerToken(authHeader: string | null): string | null {
    const tokenParts = (authHeader ?? "").trim().split(/\s+/);
    const [bearer, token] = tokenParts;
    if (bearer.toLowerCase() !== "bearer" || tokenParts.length !== 2 || !token) {
        return null;
    }
    return token;
}

// Prefer the caller's JWT and use the gateway compatibility value only in the intended key path.
function getAuthToken(req: Request): string | AuthFailure {
    const authHeader = req.headers.get("authorization");
    const sbApiKeyCompatibilityToken = req.headers.get("sb-api-key");

    if (!authHeader && !sbApiKeyCompatibilityToken) {
        return {
            code: RequestErrors.MissingAuthHeader,
            message: "Missing authorization header",
        };
    }

    // NOTE:(kallebysantos) Compatibility mode is triggered when all conditions match:
    // - API proxy mints a temp token
    // - Original bearer is not present or is ApiKey
    const bearerToken = extractBearerToken(authHeader);
    const token =
        !bearerToken || bearerToken.startsWith("sb_")
            ? sbApiKeyCompatibilityToken
            : bearerToken;

    if (!token) {
        return {
            code: RequestErrors.InvalidTokenFormat,
            message: "Invalid JWT format",
        };
    }

    return token;
}

// Return stable 401 JSON with the compatibility field and error code clients still need.
function getAuthErrorResponse({code, message = "Invalid JWT"}: AuthFailure) {
    return Response.json(
        {
            code,
            message,
            // DEPRECATED: Retained for backward compatibility.
            msg: message,
        },
        {
            status: 401,
            headers: {
                ...ERROR_CORS_HEADERS,
                "sb-error-code": code,
            },
        },
    );
}

// Verify a legacy JWT with the server-side symmetric key; missing configuration fails closed.
async function isValidLegacyJWT(jwt: string): Promise<AuthFailure | null> {
    if (!legacyJwtSigningKey) {
        console.error("JWT_SECRET not available for HS256 token verification");
        return {code: RequestErrors.InvalidLegacyJWT};
    }

    const encoder = new TextEncoder();
    const secretKey = encoder.encode(legacyJwtSigningKey);

    try {
        await jose.jwtVerify(jwt, secretKey);
    } catch (e) {
        logRuntimeFailure("legacy_jwt_verification_failed", e);
        return {code: RequestErrors.InvalidLegacyJWT};
    }
    return null;
}

// Verify an asymmetric JWT against the locally configured public key set.
async function isValidJWT(jwt: string): Promise<AuthFailure | null> {
    if (!LOCAL_JWKS) {
        console.error("JWKS not available for ES256/RS256 token verification");
        return {code: RequestErrors.InvalidAsymmetricJWT};
    }

    try {
        await jose.jwtVerify(jwt, LOCAL_JWKS);
    } catch (e) {
        logRuntimeFailure("asymmetric_jwt_verification_failed", e);
        return {code: RequestErrors.InvalidAsymmetricJWT};
    }

    return null;
}

/**
 * Verify JWT token, handling both legacy (HS256) and newer (ES256/RS256) algorithms
 *
 * This function automatically detects the algorithm used in the token and applies
 * the appropriate verification method:
 * - HS256: Uses JWT_SECRET (symmetric key)
 * - ES256/RS256: Uses JWKS endpoint (asymmetric public keys)
 *
 * This fix ensures compatibility with both legacy tokens and newer asymmetric tokens,
 * resolving the "Key for the ES256 algorithm must be of type CryptoKey" error.
 *
 * @param jwt - The JWT token string to verify
 * @returns Authentication failure details, or null when verification succeeds
 */
// Select only supported verification paths from the protected algorithm header; decoding alone is not verification.
async function isValidHybridJWT(jwt: string): Promise<AuthFailure | null> {
    let jwtAlgorithm: string | undefined;
    try {
        jwtAlgorithm = jose.decodeProtectedHeader(jwt).alg;
    } catch (e) {
        logRuntimeFailure("jwt_format_invalid", e);
        return {
            code: RequestErrors.InvalidTokenFormat,
            message: "Invalid JWT format",
        };
    }

    if (typeof jwtAlgorithm !== "string" || !jwtAlgorithm) {
        return {
            code: RequestErrors.InvalidTokenFormat,
            message: "Invalid JWT format",
        };
    }

    if (jwtAlgorithm === "HS256") {
        console.log(
            `Legacy token type detected, attempting ${jwtAlgorithm} verification.`,
        );

        return await isValidLegacyJWT(jwt);
    }

    if (jwtAlgorithm === "ES256" || jwtAlgorithm === "RS256") {
        return await isValidJWT(jwt);
    }

    return {
        code: RequestErrors.UnsupportedTokenAlgorithm,
        message: `Unsupported JWT algorithm ${jwtAlgorithm}`,
    };
}

Deno.serve({onError}, async (req: Request) => {
    const url = new URL(req.url);
    const {pathname} = url;
    const path_parts = pathname.split("/");
    const service_name = path_parts[1];
    // Browser credential and recovery endpoints enforce their own online rate
    // checks. The calendar GET uses an owner-issued revocable capability.
    // Other methods and suffixes retain the normal JWT boundary.
    const credentialExchange =
        (service_name === "human-login" || service_name === "human-recovery") &&
        pathname === `/${service_name}` &&
        (req.method === "POST" || req.method === "OPTIONS");
    const capabilityFeed =
        service_name === "calendar-feed" &&
        pathname === "/calendar-feed" &&
        req.method === "GET";
    const publicLtiKeys = pathname === "/learning-lti/jwks" && req.method === "GET";
    const ltiAgs = /^\/learning-lti\/ags\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/lineitems(?:\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?:\/(scores|results))?)?$/i.exec(pathname);
    const ltiAgsMethod = ltiAgs?.[2] === "scores"
        ? req.method === "POST"
        : ltiAgs?.[2] === "results"
        ? req.method === "GET"
        : ltiAgs?.[1]
        ? ["GET", "PUT", "DELETE"].includes(req.method)
        : ["GET", "POST"].includes(req.method);
    const ltiToolService =
        (ltiAgs !== null && ltiAgsMethod) ||
        (["/learning-lti/token", "/learning-lti/deep-link-return", "/learning-lti/registration"].includes(pathname) && req.method === "POST") ||
        (pathname === "/learning-lti/registration/configuration" && req.method === "GET") ||
        (req.method === "GET" &&
            /^\/learning-lti\/memberships\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(pathname));
    const fileMode = url.searchParams.get("mode");
    const academyPwaAsset = pathname === "/files" && (req.method === "GET" || req.method === "HEAD") &&
        (fileMode === "academy-pwa-manifest" || fileMode === "academy-pwa-image");
    const companyIntegrationMethod =
        pathname === "/company-integration" || pathname === "/company-integration/participation"
            ? "GET"
            : pathname === "/company-integration/enrolments"
                ? "POST"
                : null;
    // Reject unsupported methods on these exact capability routes before JWT
    // verification. Valid methods still use the worker's scoped key checks.
    if (companyIntegrationMethod && req.method !== companyIntegrationMethod) {
        return Response.json({error: "method_not_allowed"}, {
            status: 405,
            headers: {
                "allow": companyIntegrationMethod,
                "cache-control": "no-store",
                "x-content-type-options": "nosniff",
            },
        });
    }
    if (req.method !== "OPTIONS" && VERIFY_JWT && !capabilityFeed && !publicLtiKeys && !ltiToolService && !credentialExchange && !companyIntegrationMethod && !academyPwaAsset) {
        const token = getAuthToken(req);
        if (typeof token !== "string") {
            return getAuthErrorResponse(token);
        }
        const authFailure = await isValidHybridJWT(token);
        if (authFailure) {
            return getAuthErrorResponse(authFailure);
        }
    }

    if (!PORTAL_FUNCTIONS.has(service_name)) {
        return getFunctionErrorResponse({
            code: RequestErrors.NotFound,
            message: "Requested function was not found",
            status: 404,
        });
    }

    const servicePath = `/home/deno/functions/${service_name}`;

    try {
        const serviceInfo = await Deno.stat(servicePath);
        if (!serviceInfo.isDirectory) {
            return getFunctionErrorResponse({
                code: RequestErrors.NotFound,
                message: "Requested function was not found",
                status: 404,
            });
        }
    } catch (e) {
        if (e instanceof Deno.errors.NotFound) {
            return getFunctionErrorResponse({
                code: RequestErrors.NotFound,
                message: "Requested function was not found",
                status: 404,
            });
        }
        logRuntimeFailure("worker_path_unavailable", e);
        return getFunctionErrorResponse({
            code: RequestErrors.BootError,
            message: "Function failed to start (please check logs)",
            status: 503,
        });
    }

    // Local portal adaptation: future files can need more memory; this is a ceiling, not a reservation.
    const memoryLimitMb =
        service_name === "files"
            ? 1024
            : service_name === "course-documents"
                ? 512
                : 128;
    // Keep the wall clock above the 150s request idle timeout configured in Compose.
    const workerTimeoutMs = 400_000;
    const requestAbsentTimeoutMs = 60_000;
    const noModuleCache = false;
    // Using a common Import Map for all functions
    // to use a scope 'deno.json' it must be dinamically resolved base on the 'service_name'
    const importMapPath = `/home/deno/functions/deno.jsonc`;
    // SUPABASE_FUNCTION_SLUG is listed after the container env snapshot so
    // nothing in it can shadow the value, and it is per-request because only this
    // worker knows which function the request resolved to.
    const envVarsObj = {
        ...Deno.env.toObject(),
        SUPABASE_FUNCTION_SLUG: service_name,
    };
    if (service_name !== "learning-lti") {
        delete envVarsObj.LTI_PLATFORM_RSA_PRIVATE_JWK;
    }
    const envVars = Object.keys(envVarsObj).map((k) => [k, envVarsObj[k]]);

    try {
        const response = await dispatchToWorker(req, {
            createWorker: () => EdgeRuntime.userWorkers.create({
                servicePath,
                memoryLimitMb,
                workerTimeoutMs,
                context: {supervisor: {requestAbsentTimeoutMs}},
                noModuleCache,
                staticPatterns:
                    service_name === "course-documents"
                        ? ["/home/deno/functions/course-documents/assets/DejaVuSans.ttf"]
                        : [],
                importMapPath,
                envVars,
            }),
            prepareRequest(request) {
                // The gateway-minted JWT belongs only to the router; retain the
                // client connection tag for input and output streaming.
                const userRequest = new Request(request);
                userRequest.headers.delete("sb-api-key");
                EdgeRuntime.applySupabaseTag(request, userRequest);
                return userRequest;
            },
            isRetired: (error) => error instanceof Deno.errors.WorkerAlreadyRetired,
            onRetry(retriesLeft) {
                console.warn(
                    `${service_name}: worker retired before dispatch; retrying (${retriesLeft} left)`,
                );
            },
            maxRetries: MAX_WORKER_RETRIES,
        });
        return handleWorkerResponse(response);
    } catch (error) {
        logRuntimeFailure("worker_fetch_failed", error);
        return getFunctionErrorResponse(resolveRuntimeError(error));
    }
});

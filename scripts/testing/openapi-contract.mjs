import {z} from "zod";
import {accountOpenApi} from "../../supabase/functions/accounts/openapi.ts";
import {portalOpenApi} from "../../src/features/developer-api/contract.ts";

const {paths} = portalOpenApi("https://portal.example.invalid");

/** Validate a parsed PostgREST response against the published internal contract. */
export function rpcResponse(name) {
    const operation = paths[`/rest/v1/rpc/${name}`].post;
    return parseResponse(operation, "200");
}

/** Verify parsed JSON from an internal Edge or RPC operation against its published status schema. */
export function portalJsonResponse(path, status, payload) {
    return parseResponse(paths[path].post, String(status))(JSON.stringify(payload));
}

/** Account HTTP operations forward native projections or confirmed worker receipts. */
export function accountResponse(path, method, status = "200") {
    return parseResponse(accountOpenApi.paths[path][method], status);
}

function parseResponse(operation, status) {
    const schema = z.fromJSONSchema(operation.responses[status].content["application/json"].schema);
    return (json) => schema.parse(JSON.parse(json));
}

/** Validate a request's plain JSON values against the published internal contract. */
export function rpcRequest(name) {
    const operation = paths[`/rest/v1/rpc/${name}`].post;
    const schema = z.fromJSONSchema(operation.requestBody.content["application/json"].schema);
    return (body) => schema.parse(body);
}

/** Confirm the same account contract against success bodies returned by the HTTP stack. */
export function verifyAccountHttpResponse(relativePath, method, status, payload) {
    if (status < 200 || status >= 300 || status === 204) return;
    const route = "/v1/" + relativePath.split("?")[0];
    const template = Object.keys(accountOpenApi.paths).find((path) => {
        const pattern = path.replace(/\{[a-zA-Z]+\}/g, "[^/]+");
        return new RegExp(`^${pattern}$`).test(route);
    });
    if (!template) throw new Error(`Missing account contract for ${method} ${route}`);
    accountResponse(template, method.toLowerCase(), String(status))(JSON.stringify(payload));
}

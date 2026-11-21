import {z} from "zod";
import {portalOpenApi} from "../../src/features/developer-api/contract.ts";

const {paths} = portalOpenApi("https://portal.example.invalid");

/** Validate a parsed PostgREST response against the published internal contract. */
export function rpcResponse(name) {
    const operation = paths[`/rest/v1/rpc/${name}`].post;
    const schema = z.fromJSONSchema(operation.responses["200"].content["application/json"].schema);
    return (json) => schema.parse(JSON.parse(json));
}

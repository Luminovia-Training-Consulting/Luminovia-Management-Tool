import { StringDecoder } from "node:string_decoder";

/** Collect child-process output without corrupting UTF-8 characters split across stream chunks. */
export function collectUtf8(stream) {
  const decoder = new StringDecoder("utf8");
  let output = "";
  stream.on("data", (chunk) => {
    output += decoder.write(chunk);
  });
  return () => output + decoder.end();
}

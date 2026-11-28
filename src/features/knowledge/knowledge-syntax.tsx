import { Fragment, type ReactNode } from "react";
import { common, createLowlight } from "lowlight";

export const lowlight = createLowlight(common);

type Token = ReturnType<typeof lowlight.highlight>["children"][number];

function renderToken(token: Token): ReactNode {
  if (token.type === "text") return token.value;
  if (token.type !== "element") return null;
  const classes = token.properties.className;
  return (
    <span className={Array.isArray(classes) ? classes.join(" ") : undefined}>
      {token.children.map((child, index) => (
        <Fragment key={index}>{renderToken(child)}</Fragment>
      ))}
    </span>
  );
}

/** Process only explicit supported languages and limit optional work on long blocks. */
export function highlightCode(language: string, code: string): ReactNode {
  if (code.length > 8_000 || !lowlight.registered(language)) return code;
  try {
    return lowlight
      .highlight(language, code)
      .children.map((token, index) => (
        <Fragment key={index}>{renderToken(token)}</Fragment>
      ));
  } catch {
    return code;
  }
}

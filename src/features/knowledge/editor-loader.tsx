import { useEffect, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, Loading, Notice } from "../../components/common";
import { useOnline } from "../../lib/online";
import type { KnowledgeEditor as EditorComponent } from "./knowledge-editor";

let loadedEditor: typeof EditorComponent | undefined;
let pendingEditor: Promise<typeof EditorComponent> | undefined;

function loadEditor() {
  pendingEditor ??= import("./knowledge-editor")
    .then(({ KnowledgeEditor }) => {
      loadedEditor = KnowledgeEditor;
      return KnowledgeEditor;
    })
    .catch((error: unknown) => {
      pendingEditor = undefined;
      throw error;
    });
  return pendingEditor;
}

/** Keep the writer off reading routes. Reconnect without clearing a loaded draft. */
export function KnowledgeEditor(props: ComponentProps<typeof EditorComponent>) {
  const online = useOnline();
  const { t } = useTranslation();
  const [Editor, setEditor] = useState(() => loadedEditor);
  const [state, setState] = useState<"loading" | "error" | "retry">("loading");
  useEffect(() => {
    if (!online || Editor || state === "error") return;
    let active = true;
    void loadEditor().then(
      (component) => {
        if (active) setEditor(() => component);
      },
      () => {
        if (active) setState("error");
      },
    );
    return () => {
      active = false;
    };
  }, [Editor, online, state]);

  if (Editor) return <Editor {...props} />;
  if (!online) return <Notice>{t("offline")}</Notice>;
  if (state === "error") return <ErrorState retry={() => setState("retry")} />;
  return <Loading />;
}

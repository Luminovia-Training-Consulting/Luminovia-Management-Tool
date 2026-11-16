import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FileUpload, SubjectDocuments } from "./files";
import "./i18n";
export function ProfileEvidence({
  ownerId,
  readOnly = false,
  kinds = ["cv", "certificate"],
}: {
  ownerId: string;
  readOnly?: boolean;
  kinds?: ("cv" | "certificate")[];
}) {
  const { t } = useTranslation("files");
  const client = useQueryClient();
  return (
    <div className="profile-evidence">
      {kinds.map((kind) => (
        <section className="panel" key={kind}>
          <h2>{t(kind)}</h2>
          {!readOnly && (
            <FileUpload
              context={{ scope: "personal", kind }}
              onDone={
                kind === "certificate"
                  ? () => {
                      void client.invalidateQueries({
                        queryKey: ["qualification-certificates", ownerId],
                      });
                    }
                  : undefined
              }
            />
          )}
          <SubjectDocuments ownerId={ownerId} kind={kind} />
        </section>
      ))}
    </div>
  );
}

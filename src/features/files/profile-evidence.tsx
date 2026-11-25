/**
 * CV/certificate files in a person's evidence context. The selected person does
 * not replace server authorization; qualification downloads use their separate
 * exact-version evidence binding rather than a general foreign-file grant.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FileUpload, SubjectDocuments } from "./files";
import "./i18n";

/** Show the person's CV/certificate links under the existing document-permission contract. */
export function ProfileEvidence({
  ownerId,
  readOnly = false,
  onBehalf = false,
  kinds = ["cv", "certificate"],
}: {
  ownerId: string;
  readOnly?: boolean;
  onBehalf?: boolean;
  kinds?: ("cv" | "certificate")[];
}) {
  const { t } = useTranslation("files");
  const client = useQueryClient();
  return (
    <div className="profile-evidence">
      {kinds.map((kind) => (
        <section className="panel" key={kind} aria-label={t(kind)}>
          <h2>{t(kind)}</h2>
          {!readOnly && (
            <FileUpload
              context={{
                scope: "personal",
                kind,
                ...(onBehalf && { ownerId }),
              }}
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

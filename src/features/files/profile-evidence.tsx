import { useTranslation } from "react-i18next";
import { FileUpload, SubjectDocuments } from "./files";
import "./i18n";
export function ProfileEvidence({
  ownerId,
  readOnly = false,
}: {
  ownerId: string;
  readOnly?: boolean;
}) {
  const { t } = useTranslation("files");
  return (
    <div className="profile-evidence">
      {["cv", "certificate"].map((kind) => (
        <section className="panel" key={kind}>
          <h2>{t(kind)}</h2>
          {!readOnly && <FileUpload context={{ scope: "personal", kind }} />}
          <SubjectDocuments ownerId={ownerId} kind={kind} />
        </section>
      ))}
    </div>
  );
}

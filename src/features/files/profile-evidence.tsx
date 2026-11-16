/**
 * CV-/Zertifikatsdateien im persönlichen Nachweiskontext. Die übergebene Person bezeichnet die fachliche Zuordnung; sie ersetzt weder Ressourcenrechte noch Uploadprüfung auf dem Server.
 */
import { useTranslation } from "react-i18next";
import { FileUpload, SubjectDocuments } from "./files";
import "./i18n";
/** Zeigt die CV-/Zertifikatszuordnung der angegebenen Person unter dem bestehenden Dokumentrechtevertrag. */
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

import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Loading } from "../../components/common";
import { useOnline } from "../../lib/online";
import { accountMemberships } from "../accounts/api";
import { clientOrganisationsQuery } from "../commercial/commission-api";
import { CompanyContracts } from "../operations/company-contract-trigger";

/** Show only the active company memberships of this profile's signed-in actor. */
export function ProfileCompanyContracts({ actor }: { actor: string }) {
  const { t } = useTranslation("operations");
  const heading = useId();
  const online = useOnline();
  const memberships = useQuery({
    queryKey: ["profile-company-memberships", actor],
    queryFn: () => accountMemberships(actor),
    enabled: online,
  });
  const hasMemberships = memberships.isSuccess && memberships.data.length > 0;
  const organisations = useQuery({
    ...clientOrganisationsQuery(actor),
    enabled: online && hasMemberships,
  });
  if (!online) return null;
  if (memberships.isError)
    return <ErrorState retry={() => void memberships.refetch()} />;
  if (memberships.isPending || (hasMemberships && organisations.isPending))
    return <Loading />;
  if (!hasMemberships) return null;
  if (organisations.isError)
    return <ErrorState retry={() => void organisations.refetch()} />;

  // A member who is also authorised to see gross revenue may receive a wider directory.
  const ownIds = new Set(
    memberships.data.map(({ organisation_id }) => organisation_id),
  );
  const companies = organisations.data?.filter(({ id }) => ownIds.has(id));
  if (!companies?.length) return null;

  return (
    <section className="panel" aria-labelledby={heading}>
      <h2 id={heading}>{t("companyContracts")}</h2>
      <div className="page-actions">
        {companies.map((company) => (
          <CompanyContracts
            key={`${actor}:${company.id}`}
            actor={actor}
            organisationId={company.id}
            organisationName={company.name}
            archived={false}
            showOrganisationName
          />
        ))}
      </div>
    </section>
  );
}

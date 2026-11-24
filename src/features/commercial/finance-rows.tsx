import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LoadMore } from "../../components/load-more";
import "./i18n";

const batchSize = 12;

/** Bound the rendered rows while reports and downloads use the complete result set. */
export function FinanceRows({
  label,
  total,
  children,
  panel = false,
}: {
  label: string;
  total: number;
  children: (count: number) => ReactNode;
  panel?: boolean;
}) {
  const { t } = useTranslation("commercial");
  const [limit, setLimit] = useState(batchSize);
  const shown = Math.min(total, limit);

  return (
    <div className={panel ? "panel finance-rows" : "finance-rows"}>
      <div
        className="commercial-table-scroll finance-rows-scroll"
        role="region"
        aria-label={label}
        tabIndex={0}
      >
        {children(shown)}
        {shown < total && (
          <div className="finance-rows-more">
            <LoadMore
              pageKey={shown}
              onLoad={() => setLimit(shown + batchSize)}
            >
              {t("moreFinanceRows")}
            </LoadMore>
          </div>
        )}
      </div>
      {total > batchSize && (
        <p className="muted commercial-small finance-rows-count" role="status">
          {t("financeRowsCount", { shown, total })}
        </p>
      )}
    </div>
  );
}

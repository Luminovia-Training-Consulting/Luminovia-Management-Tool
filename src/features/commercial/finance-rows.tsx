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
  scroll = true,
}: {
  label: string;
  total: number;
  children: (count: number) => ReactNode;
  panel?: boolean;
  scroll?: boolean;
}) {
  const { t } = useTranslation("commercial");
  const [limit, setLimit] = useState(batchSize);
  const shown = Math.min(total, limit);

  return (
    <div className={panel ? "panel finance-rows" : "finance-rows"}>
      <div
        className={
          scroll ? "commercial-table-scroll finance-rows-scroll" : undefined
        }
        role="region"
        aria-label={label}
        tabIndex={scroll ? 0 : undefined}
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

/** Administrators maintain future recipient-specific terms; accepted agreements remain snapshots. */
import { currencyCodes, type CurrencyCode } from "../../lib/currencies.ts";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/auth-context";
import { permissionsQuery } from "../../lib/queries";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";

interface Compensation {
  mode: "percent" | "daily";
  percent: number;
  daily_rate: number;
  currency: CurrencyCode;
  version: number;
  is_customized: boolean;
}

function Editor({
  userId,
  value,
  onSaved,
}: {
  userId: string;
  value: Compensation;
  onSaved: () => void;
}) {
  const { i18n } = useTranslation();
  const de = i18n.language.startsWith("de"),
    online = useOnline(),
    client = useQueryClient();
  const [mode, setMode] = useState(value.mode),
    [percent, setPercent] = useState(String(value.percent)),
    [daily, setDaily] = useState(String(value.daily_rate)),
    [currency, setCurrency] = useState(value.currency);
  const valid =
    percent !== "" &&
    daily !== "" &&
    Number(percent) >= 0 &&
    Number(percent) <= 100 &&
    Number(daily) >= 0 &&
    Number.isFinite(Number(daily));
  const save = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (!valid) throw Error("Invalid compensation");
      const { data, error } = await db().rpc("save_lecturer_compensation", {
        p_user_id: userId,
        p_mode: mode,
        p_percent: Number(percent),
        p_daily_rate: Number(daily),
        p_currency: currency,
        p_expected_version: value.version,
      });
      if (error) throw error;
      return data as Compensation;
    },
    onSuccess: async () => {
      onSaved();
      await client.invalidateQueries();
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <p>
        {de
          ? "Das hinterlegte Honorar gilt für künftige Übernahmen und manuelle Zuweisungen. Bereits angenommene Vereinbarungen behalten ihr Honorar."
          : "These terms apply to future claims and manual assignments. Accepted agreements keep their original compensation."}
      </p>
      <p className="muted">
        {value.is_customized
          ? de
            ? "Dies ist ein individueller Override für diese Lehrkraft."
            : "This is an individual override for this lecturer."
          : de
            ? "Dies ist der aktuelle rollenabhängige Standard. Persönliche Angebote behalten ihren bei Veröffentlichung gespeicherten Satz."
            : "This is the current role-based default. Individual offers retain the rate captured when published."}
      </p>
      <div className="form-row">
        <Field
          id={`pay-mode-${userId}`}
          label={de ? "Honorarart" : "Compensation mode"}
        >
          <select
            id={`pay-mode-${userId}`}
            value={mode}
            onChange={(e) => setMode(e.target.value as Compensation["mode"])}
          >
            <option value="percent">
              {de ? "Prozentualer Anteil" : "Percentage share"}
            </option>
            <option value="daily">
              {de ? "Fester Tagessatz" : "Fixed daily rate"}
            </option>
          </select>
        </Field>
        {mode === "percent" ? (
          <Field
            id={`pay-percent-${userId}`}
            label={
              de
                ? "Anteil am Unternehmensbudget (%)"
                : "Share of company budget (%)"
            }
          >
            <input
              id={`pay-percent-${userId}`}
              type="number"
              min="0"
              max="100"
              step="0.01"
              required
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
            />
          </Field>
        ) : (
          <>
            <Field
              id={`pay-daily-${userId}`}
              label={
                de
                  ? "Honorar pro Unterrichtstag"
                  : "Compensation per teaching day"
              }
            >
              <input
                id={`pay-daily-${userId}`}
                type="number"
                min="0"
                step="0.01"
                required
                value={daily}
                onChange={(e) => setDaily(e.target.value)}
              />
            </Field>
            <Field
              id={`pay-currency-${userId}`}
              label={de ? "Währung" : "Currency"}
            >
              <select
                id={`pay-currency-${userId}`}
                value={currency}
                onChange={(e) =>
                  setCurrency(e.target.value as Compensation["currency"])
                }
              >
                {currencyCodes.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
      </div>
      {mode === "daily" && (
        <p className="muted">
          {de
            ? "Der Tagessatz wird für jeden Unterrichtstag des gesamten Auftrags berechnet. Währung und Unternehmensbudget müssen dazu passen."
            : "The daily rate applies to each teaching day in the complete assignment. Currency and company budget must match."}
        </p>
      )}
      <Button disabled={!online || !valid || save.isPending}>
        {de ? "Honorar speichern" : "Save compensation"}
      </Button>
      {save.isError && (
        <Notice kind="error">
          {de
            ? "Das Honorar wurde nicht gespeichert. Lade das Profil neu und prüfe die Angaben."
            : "Compensation was not saved. Reload the profile and check the values."}
        </Notice>
      )}
    </form>
  );
}

export function LecturerCompensation({ userId }: { userId: string }) {
  const [savedFor, setSavedFor] = useState<string | null>(null);
  const actor = useAuth().session!.user.id,
    { i18n } = useTranslation(),
    permissions = useQuery(permissionsQuery(actor));
  const allowed = Boolean(permissions.data?.includes("finance.gross.read"));
  const query = useQuery({
    queryKey: ["lecturer-compensation", actor, userId],
    enabled: allowed,
    retry: false,
    queryFn: async () => {
      const { data, error } = await db().rpc("lecturer_compensation", {
        p_user_id: userId,
      });
      if (error) throw error;
      return data as Compensation;
    },
  });
  if (!allowed) return null;
  return (
    <section className="panel">
      <h2>
        {i18n.language.startsWith("de")
          ? "Dozentenhonorar"
          : "Lecturer compensation"}
      </h2>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : (
        <Editor
          key={query.data.version}
          userId={userId}
          value={query.data}
          onSaved={() => setSavedFor(userId)}
        />
      )}
      {savedFor === userId && (
        <Notice>
          {i18n.language.startsWith("de")
            ? "Honorar gespeichert."
            : "Compensation saved."}
        </Notice>
      )}
    </section>
  );
}

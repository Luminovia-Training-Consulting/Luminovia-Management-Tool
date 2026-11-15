import { useState } from "react";
import { Link } from "react-router-dom";
import { DateTime } from "luxon";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { useAuth } from "../auth/auth-context";
import {
  permissionsQuery,
  profileQuery,
  userRolesQuery,
} from "../../lib/queries";
import { dateTime } from "../../lib/dates";
import { useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import {
  availabilitySchema,
  availabilityRange,
  myAvailabilityQuery,
  sharedAvailabilityQuery,
  saveAvailability,
  removeAvailability,
  type AvailabilityValues,
  type AvailabilityWindow,
} from "./api";
import "./i18n";
import "./availability.css";
function failure(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error ? error.code : null;
  return code === "23P01" ? "conflict" : code === "40001" ? "stale" : "error";
}
function AvailabilityForm({
  item,
  zone,
  onDone,
}: {
  item: AvailabilityWindow | null;
  zone: string;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation("availability"),
    online = useOnline();
  const [id] = useState(() => item?.id ?? crypto.randomUUID());
  const [invalid, setInvalid] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AvailabilityValues>({
    resolver: zodResolver(availabilitySchema),
    defaultValues: {
      kind: item?.kind ?? "available",
      starts_at: item
        ? DateTime.fromISO(item.starts_at)
            .setZone(item.time_zone)
            .toFormat("yyyy-MM-dd'T'HH:mm")
        : "",
      ends_at: item
        ? DateTime.fromISO(item.ends_at)
            .setZone(item.time_zone)
            .toFormat("yyyy-MM-dd'T'HH:mm")
        : "",
      time_zone: item?.time_zone ?? zone,
      notes: item?.notes ?? "",
      share_with_management: item?.share_with_management ?? false,
    },
  });
  const save = useMutation({
    mutationFn: (values: AvailabilityValues) =>
      saveAvailability(id, item?.version ?? 0, values, item ?? undefined),
    onSuccess: onDone,
  });
  return (
    <form
      className="availability-form"
      onSubmit={handleSubmit(
        (values) => {
          setInvalid(false);
          save.mutate(values);
        },
        () => setInvalid(true),
      )}
    >
      <Field id="availability-kind" label={t("kind")}>
        <select {...register("kind")}>
          <option value="available">{t("available")}</option>
          <option value="unavailable">{t("unavailable")}</option>
        </select>
      </Field>
      <div className="form-row">
        <Field
          id="availability-start"
          label={t("start")}
          error={Boolean(errors.starts_at)}
        >
          <input type="datetime-local" required {...register("starts_at")} />
        </Field>
        <Field
          id="availability-end"
          label={t("end")}
          error={Boolean(errors.ends_at)}
        >
          <input type="datetime-local" required {...register("ends_at")} />
        </Field>
      </div>
      <Field
        id="availability-zone"
        label={t("zone")}
        error={Boolean(errors.time_zone)}
      >
        <input list="availability-zones" {...register("time_zone")} />
      </Field>
      <datalist id="availability-zones">
        <option>Europe/Berlin</option>
        <option>Australia/Brisbane</option>
        <option>UTC</option>
      </datalist>
      <Field
        id="availability-notes"
        label={t("notes")}
        error={Boolean(errors.notes)}
      >
        <textarea maxLength={2000} {...register("notes")} />
      </Field>
      <label className="checkbox-label">
        <input type="checkbox" {...register("share_with_management")} />
        {t("share")}
      </label>
      {invalid && <Notice kind="error">{t("invalid")}</Notice>}
      {save.isError && (
        <Notice kind="error">
          {t(
            save.error instanceof Error && save.error.message === "invalid-time"
              ? "invalid"
              : failure(save.error),
          )}
        </Notice>
      )}
      <Button disabled={!online || save.isPending}>
        {t(save.isPending ? "saving" : "save")}
      </Button>
    </form>
  );
}
function ReadyAvailability({
  actor,
  zone,
  canEdit,
  canManage,
}: {
  actor: string;
  zone: string;
  canEdit: boolean;
  canManage: boolean;
}) {
  const { t, i18n } = useTranslation("availability"),
    online = useOnline(),
    client = useQueryClient();
  const [from, setFrom] = useState(() =>
    DateTime.now().setZone(zone).startOf("month").toISODate()!,
  );
  const [to, setTo] = useState(() =>
    DateTime.now().setZone(zone).endOf("month").toISODate()!,
  );
  const [editing, setEditing] = useState<
    AvailabilityWindow | null | undefined
  >();
  const [removing, setRemoving] = useState<AvailabilityWindow>();
  const [saved, setSaved] = useState(false);
  const range = availabilityRange(from, to, zone);
  const own = useQuery({
    ...myAvailabilityQuery(actor, range?.from ?? "", range?.to ?? ""),
    enabled: Boolean(range),
  });
  const shared = useQuery({
    ...sharedAvailabilityQuery(actor, range?.from ?? "", range?.to ?? ""),
    enabled: Boolean(range) && canManage,
  });
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["availability", actor] }),
      client.invalidateQueries({ queryKey: ["shared-availability"] }),
    ]);
  };
  const finish = async () => {
    await refresh();
    setEditing(undefined);
    setSaved(true);
  };
  const remove = useMutation({
    mutationFn: removeAvailability,
    onSuccess: async () => {
      await refresh();
      setRemoving(undefined);
      setSaved(true);
    },
  });
  return (
    <>
      <PageHeading
        title={t("title")}
        description={t("help")}
        action={
          <Button asChild variant="secondary">
            <Link to="/calendar">{t("back")}</Link>
          </Button>
        }
      />
      <div className="panel availability-range">
        <Field id="availability-from" label={t("from")} hint={t("rangeHelp")}>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field id="availability-to" label={t("to")}>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
      </div>
      {!range && <Notice kind="error">{t("invalidRange")}</Notice>}
      {saved && <Notice>{t("saved")}</Notice>}
      <div className="availability-toolbar">
        <h2>{t("own")}</h2>
        <Button
          variant="ghost"
          disabled={!online || own.isFetching}
          onClick={() => void refresh()}
        >
          {t("reload")}
        </Button>
        {canEdit ? (
          <Button
            disabled={!online}
            onClick={() => {
              setSaved(false);
              setEditing(null);
            }}
          >
            <Plus size={18} />
            {t("create")}
          </Button>
        ) : (
          <p>{t("readOnly")}</p>
        )}
      </div>
      {range &&
        (own.isPending ? (
          <Loading />
        ) : own.isError ? (
          <ErrorState retry={() => void own.refetch()} />
        ) : !own.data.length ? (
          <Notice>{t("empty")}</Notice>
        ) : (
          <div className="availability-grid">
            {own.data.map((item) => (
              <article
                className="panel availability-card"
                data-kind={item.kind}
                key={item.id}
              >
                <h3>{t(item.kind)}</h3>
                <p>
                  {dateTime(item.starts_at, i18n.language, item.time_zone)} –{" "}
                  {dateTime(item.ends_at, i18n.language, item.time_zone)}
                </p>
                <small>{item.time_zone}</small>
                <span className="badge">
                  {t(item.share_with_management ? "sharedBadge" : "private")}
                </span>
                {item.notes && <p>{item.notes}</p>}
                <div className="availability-actions">
                  {canEdit && (
                    <Button
                      variant="secondary"
                      disabled={!online}
                      onClick={() => {
                        setSaved(false);
                        setEditing(item);
                      }}
                    >
                      {t("edit")}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    disabled={!online}
                    onClick={() => {
                      remove.reset();
                      setRemoving(item);
                    }}
                  >
                    {t("remove")}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ))}
      {canManage && (
        <section className="panel" style={{ marginTop: 24 }}>
          <h2>{t("shared")}</h2>
          <p>{t("sharedHelp")}</p>
          {range &&
            (shared.isPending ? (
              <Loading />
            ) : shared.isError ? (
              <ErrorState retry={() => void shared.refetch()} />
            ) : !shared.data.length ? (
              <Notice>{t("empty")}</Notice>
            ) : (
              <div className="availability-grid">
                {shared.data.map((item) => (
                  <article
                    className="panel availability-card"
                    data-kind={item.kind}
                    key={item.id}
                  >
                    <h3>{item.display_name}</h3>
                    <strong>{t(item.kind)}</strong>
                    <p>
                      {dateTime(item.starts_at, i18n.language, item.time_zone)}{" "}
                      – {dateTime(item.ends_at, i18n.language, item.time_zone)}
                    </p>
                    <small>{item.time_zone}</small>
                  </article>
                ))}
              </div>
            ))}
        </section>
      )}
      <p>{t("sharedLimit")}</p>
      {editing !== undefined && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(undefined);
          }}
          title={t(editing ? "edit" : "create")}
          description={t("help")}
        >
          <AvailabilityForm
            key={editing ? `${editing.id}:${editing.version}` : "new"}
            item={editing}
            zone={zone}
            onDone={finish}
          />
        </Dialog>
      )}
      {removing && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !remove.isPending) setRemoving(undefined);
          }}
          title={t("removeTitle")}
          description={t("removeHelp")}
        >
          {remove.isError && (
            <Notice kind="error">{t(failure(remove.error))}</Notice>
          )}
          <div className="availability-actions">
            <Button
              disabled={!online || remove.isPending}
              onClick={() => remove.mutate(removing)}
            >
              {t(remove.isPending ? "saving" : "remove")}
            </Button>
            <Button
              variant="secondary"
              disabled={remove.isPending}
              onClick={() => setRemoving(undefined)}
            >
              {t("cancel")}
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
export function AvailabilityPage() {
  const { session } = useAuth(),
    actor = session!.user.id;
  const profile = useQuery(profileQuery(actor)),
    roles = useQuery(userRolesQuery(actor)),
    permissions = useQuery(permissionsQuery(actor));
  if (profile.isPending || roles.isPending || permissions.isPending)
    return <Loading />;
  if (profile.isError || roles.isError || permissions.isError || !profile.data)
    return (
      <ErrorState
        retry={() => {
          void profile.refetch();
          void roles.refetch();
          void permissions.refetch();
        }}
      />
    );
  return (
    <ReadyAvailability
      actor={actor}
      zone={profile.data.time_zone}
      canEdit={roles.data.some((role) =>
        [
          "owner",
          "admin",
          "management",
          "senior_lecturer",
          "lecturer",
        ].includes(role),
      )}
      canManage={permissions.data.includes("availability.read_shared")}
    />
  );
}

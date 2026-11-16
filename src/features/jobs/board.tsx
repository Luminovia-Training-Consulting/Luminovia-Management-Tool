/**
 * Management Kanban for versioned offer state. Drag and keyboard changes share the server
 * contract; actual claims determine filled state, which is never a manual drop target.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { GripVertical, RefreshCw } from "lucide-react";
import { DragDropProvider, useDraggable, useDroppable } from "@dnd-kit/react";
import type {
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
} from "@dnd-kit/react";
import { Accessibility } from "@dnd-kit/dom";
import { db } from "../../lib/supabase";
import { useOnline } from "../../lib/online";
import { useAuth } from "../auth/auth-context";
import { Button } from "../../components/ui/button";
import { ErrorState, Loading, Notice } from "../../components/common";
import { manageOffer } from "./lifecycle-api";
import "./lifecycle-i18n";
import "./board.css";

/** Fixed offer-state presentation; the filled column remains server-derived. */
const statuses = ["draft", "published", "filled", "archived"] as const;
/** Four visible board columns; only the permitted subset is manually mutable. */
type Status = (typeof statuses)[number];
/** Reduced authorized board projection with version and explicit transition capability. */
interface BoardOffer {
  id: string;
  title: string;
  status: Status;
  version: number;
  capacity: number;
  confirmed_count: number;
  can_transition: boolean;
}
/** Allow manual draft/published/archived transitions only; actual claims determine filled state. */
const mutableStatus = (s: string): s is Exclude<Status, "filled"> =>
  s === "draft" || s === "published" || s === "archived";
/** Register allowed drop destinations without exposing filled as a manual transition target. */
function Column({
  status,
  children,
  disabled,
}: {
  status: Status;
  children: React.ReactNode;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const { ref, isDropTarget } = useDroppable({
    id: status,
    disabled: disabled || status === "filled",
  });
  return (
    <section
      ref={ref}
      className={`offer-column offer-column-${status}${isDropTarget ? " offer-column-target" : ""}`}
      aria-label={t(status)}
      data-board-column={status}
    >
      <h3>{t(status)}</h3>
      {children}
    </section>
  );
}
/** Shared data/action contract for mouse and keyboard interaction with one offer card. */
type CardProps = {
  offer: BoardOffer;
  disabled: boolean;
  change: (offer: BoardOffer, status: Exclude<Status, "filled">) => void;
};
/** Use the same allowed offer states for keyboard selection and the drag handle. */
function CardContent({
  offer,
  disabled,
  change,
  handleRef,
}: { handleRef?: (element: Element | null) => void } & CardProps) {
  const { t } = useTranslation();
  const lifecycle = useTranslation("jobLifecycle").t;
  return (
    <>
      <div className="offer-card-heading">
        <Link to={`/jobs/${offer.id}`}>{offer.title}</Link>
        {offer.can_transition && (
          <Button
            type="button"
            ref={handleRef}
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label={lifecycle("drag", { title: offer.title })}
          >
            <GripVertical size={18} aria-hidden="true" />
          </Button>
        )}
      </div>
      <p>
        {lifecycle("positions")}: {offer.confirmed_count}/{offer.capacity}
      </p>
      {offer.can_transition && mutableStatus(offer.status) ? (
        <select
          aria-label={`${t("status")}: ${offer.title}`}
          value={offer.status}
          disabled={disabled}
          onChange={(e) => {
            if (mutableStatus(e.target.value)) change(offer, e.target.value);
          }}
        >
          {statuses.filter(mutableStatus).map((s) => (
            <option key={s} value={s}>
              {t(s)}
            </option>
          ))}
        </select>
      ) : (
        <p className="muted">{lifecycle("readOnly")}</p>
      )}
    </>
  );
}
/** Register only a movable offer as draggable, with its own explicit handle. */
function MovableCard(props: CardProps) {
  const { offer, disabled } = props;
  const { ref, handleRef, isDragging } = useDraggable({
    id: offer.id,
    disabled,
    data: { title: offer.title },
  });
  return (
    <article
      ref={ref}
      className={`offer-card${isDragging ? " offer-card-dragging" : ""}`}
      data-offer-id={offer.id}
    >
      <CardContent {...props} handleRef={handleRef} />
    </article>
  );
}
/** Keep historical cards as ordinary articles/links without artificial drag-button semantics. */
function Card(props: CardProps) {
  // Historical/accepted cards never register as draggables: this also avoids
  // adding synthetic button/tab semantics around their ordinary detail link.
  return props.offer.can_transition ? (
    <MovableCard {...props} />
  ) : (
    <article className="offer-card" data-offer-id={props.offer.id}>
      <CardContent {...props} />
    </article>
  );
}
/**
 * Read one server-scoped batch without per-card polling. Confirm versioned publication transitions
 * online without optimistic card moves; dragging never allocates an assignment.
 */
export function OfferBoard() {
  const { session } = useAuth();
  const { t } = useTranslation();
  const lifecycle = useTranslation("jobLifecycle").t;
  const online = useOnline();
  const client = useQueryClient();
  const [failed, setFailed] = useState<{
    offer: BoardOffer;
    status: Exclude<Status, "filled">;
    request: string;
  } | null>(null);
  const offers = useQuery({
    queryKey: ["job-board", session!.user.id],
    queryFn: async ({ signal }) => {
      const { data, error } = await db().rpc("job_board").abortSignal(signal);
      if (error) throw error;
      return data as BoardOffer[];
    },
  });
  const mutation = useMutation({
    mutationFn: async (input: NonNullable<typeof failed>) =>
      manageOffer({
        job: input.offer.id,
        action: input.status,
        version: input.offer.version,
        request: input.request,
      }),
    onSuccess: async () => {
      setFailed(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["job-board"] }),
        client.invalidateQueries({ queryKey: ["jobs"] }),
        client.invalidateQueries({ queryKey: ["job-lifecycle"] }),
      ]);
    },
    onError: (_error, input) => setFailed(input),
  });
  const change = (offer: BoardOffer, status: Exclude<Status, "filled">) => {
    if (
      !online ||
      mutation.isPending ||
      !offer.can_transition ||
      offer.status === status
    )
      return;
    const input =
      failed?.offer.id === offer.id &&
      failed.status === status &&
      failed.offer.version === offer.version
        ? failed
        : { offer, status, request: crypto.randomUUID() };
    mutation.mutate(input);
  };
  const disabled = !online || mutation.isPending || offers.isFetching;
  return (
    <section className="panel offer-board" aria-label={lifecycle("board")}>
      <div className="section-heading">
        <h2>{lifecycle("board")}</h2>
        <Button
          variant="secondary"
          type="button"
          disabled={!online || offers.isFetching || mutation.isPending}
          onClick={() => void offers.refetch()}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {lifecycle("boardRefresh")}
        </Button>
      </div>
      <p>{lifecycle("boardHelp")}</p>
      {offers.isPending ? (
        <Loading />
      ) : offers.isError ? (
        <ErrorState retry={() => void offers.refetch()} />
      ) : (
        <>
          {offers.data.length >= 500 && (
            <Notice>{lifecycle("boardLimit")}</Notice>
          )}
          <DragDropProvider
            plugins={(defaults) => [
              ...defaults.filter(
                (plugin) =>
                  (typeof plugin === "function" ? plugin : plugin.plugin) !==
                  Accessibility,
              ),
              {
                plugin: Accessibility,
                options: {
                  screenReaderInstructions: {
                    draggable: lifecycle("dragInstructions"),
                  },
                  announcements: {
                    dragstart: (event: DragStartEvent) =>
                      lifecycle("dragStart", {
                        title: String(event.operation.source?.data.title ?? ""),
                      }),
                    dragover: (event: DragOverEvent) =>
                      event.operation.target
                        ? lifecycle("dragOver", {
                            status: t(String(event.operation.target.id)),
                          })
                        : undefined,
                    dragend: (event: DragEndEvent) =>
                      lifecycle(
                        event.canceled || !event.operation.target
                          ? "dragCancelled"
                          : "dragEnd",
                      ),
                  },
                },
              },
            ]}
            onDragEnd={(event) => {
              if (event.canceled || !event.operation.target) return;
              const offer = offers.data.find(
                  (item) => item.id === event.operation.source?.id,
                ),
                status = String(event.operation.target.id);
              if (offer && mutableStatus(status)) change(offer, status);
            }}
          >
            <div className="offer-board-grid">
              {statuses.map((status) => (
                <Column key={status} status={status} disabled={disabled}>
                  {offers.data
                    .filter((o) => o.status === status)
                    .map((offer) => (
                      <Card
                        key={offer.id}
                        offer={offer}
                        disabled={disabled}
                        change={change}
                      />
                    ))}
                  {!offers.data.some((o) => o.status === status) && (
                    <p className="muted">{lifecycle("boardEmpty")}</p>
                  )}
                </Column>
              ))}
            </div>
          </DragDropProvider>
        </>
      )}
      {mutation.isError && <Notice kind="error">{lifecycle("failed")}</Notice>}
      {mutation.isSuccess && <Notice>{lifecycle("saved")}</Notice>}
    </section>
  );
}

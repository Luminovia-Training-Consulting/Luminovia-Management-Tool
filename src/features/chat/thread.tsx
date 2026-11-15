import { useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  BellOff,
  BellRing,
  MessagesSquare,
  Search,
  UsersRound,
} from "lucide-react";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { profileQuery } from "../../lib/queries";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { DocumentAttachment } from "../files/document-attachment";
import {
  chatAccessDenied,
  chatKeys,
  chatMessagesQuery,
  orderedMessages,
} from "./api";
import { MessageComposer } from "./composer";
import { MembersPanel, RoomIcon } from "./manage";
import { MessageBubble } from "./message";
import { useChatRealtime } from "./realtime";
import type { ChatRoom } from "./types";
import "./i18n";
export function ChatThread({
  actor,
  room,
  canManageCourses,
  onBack,
}: {
  actor: string;
  room: ChatRoom;
  canManageCourses: boolean;
  onBack: () => void;
}) {
  const { t } = useTranslation("chat");
  const online = useOnline();
  const client = useQueryClient();
  const profile = useQuery(profileQuery(actor));
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const [searchInput, setSearchInput] = useState("");
  const [membersOpen, setMembersOpen] = useState(false);
  const { status, revoked } = useChatRealtime(actor, room.id);
  const messages = useInfiniteQuery({
    ...chatMessagesQuery(actor, room.id, search),
    enabled: !revoked,
  });
  const ordered = orderedMessages(messages.data?.pages);
  const latest = ordered[ordered.length - 1];
  const marked = useRef("");
  const end = useRef<HTMLDivElement>(null);
  const canManage =
    room.kind !== "dm" &&
    room.kind !== "general" &&
    (room.owner_id === actor ||
      (canManageCourses &&
        ["lecturer_course", "participant_course"].includes(room.kind)));
  const read = useMutation({
    mutationFn: async (messageId: string) => {
      requireOnline();
      const { error } = await db().rpc("mark_chat_read", {
        p_room_id: room.id,
        p_message_id: messageId,
        p_muted: null,
      });
      if (error) throw error;
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: chatKeys.rooms(actor) }),
    onError: (_error, messageId) => {
      // The guard prevents duplicate in-flight receipts, not a permanent local
      // acknowledgement. An uncertain request must remain retryable.
      if (marked.current === messageId) marked.current = "";
    },
  });
  const mark = read.mutate;
  useEffect(() => {
    const observeRead = () => {
      if (
        !latest ||
        search ||
        revoked ||
        !online ||
        document.visibilityState !== "visible" ||
        marked.current === latest.id
      )
        return;
      marked.current = latest.id;
      mark(latest.id);
    };
    observeRead();
    document.addEventListener("visibilitychange", observeRead);
    return () => document.removeEventListener("visibilitychange", observeRead);
  }, [latest, search, revoked, online, mark]);
  const previousLatest = useRef("");
  useEffect(() => {
    if (!latest || latest.id === previousLatest.current || search) return;
    previousLatest.current = latest.id;
    end.current?.scrollIntoView({ behavior: "instant", block: "nearest" });
  }, [latest, search]);
  const mute = useMutation({
    mutationFn: async () => {
      requireOnline();
      const { error } = await db().rpc("mark_chat_read", {
        p_room_id: room.id,
        p_message_id: null,
        p_muted: !room.muted,
      });
      if (error) throw error;
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: chatKeys.rooms(actor) }),
  });
  const lost = revoked || chatAccessDenied(messages.error);
  if (lost)
    return (
      <section className="chat-room-denied">
        <Notice kind="error">{t("accessLost")}</Notice>
        <p>{t("accessLostHint")}</p>
        <Button variant="secondary" onClick={onBack}>
          {t("rooms")}
        </Button>
      </section>
    );
  return (
    <section
      className="chat-thread"
      data-realtime-status={status}
      aria-label={
        room.kind === "general"
          ? t("kind_general")
          : room.title || t(`kind_${room.kind}`)
      }
    >
      <header className="chat-thread-header">
        <Button
          className="chat-mobile-back"
          variant="ghost"
          size="icon"
          aria-label={t("rooms")}
          onClick={onBack}
        >
          <ArrowLeft size={20} />
        </Button>
        <span
          className={`chat-room-symbol chat-kind-${room.kind}`}
          aria-hidden="true"
        >
          <RoomIcon kind={room.kind} />
        </span>
        <div className="chat-thread-title">
          <h2>
            {room.kind === "general"
              ? t("kind_general")
              : room.title || t(`kind_${room.kind}`)}
          </h2>
          <span>
            {t(`kind_${room.kind}`)} ·{" "}
            {profile.data?.time_zone ?? "Europe/Berlin"}
          </span>
        </div>
        <div className="chat-thread-controls">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t(room.muted ? "unmute" : "mute")}
            onClick={() => mute.mutate()}
            disabled={!online || mute.isPending}
          >
            {room.muted ? <BellOff size={19} /> : <BellRing size={19} />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t(canManage ? "manageMembers" : "members")}
            onClick={() => setMembersOpen(true)}
          >
            <UsersRound size={20} />
          </Button>
        </div>
      </header>
      {room.kind === "participant_course" && (
        <div className="chat-channel-note">{t("participantNote")}</div>
      )}
      {room.kind === "lecturer_course" && (
        <div className="chat-channel-note">{t("lecturerNote")}</div>
      )}
      {room.kind === "dm" && (
        <div className="chat-channel-note">{t("messagePrivate")}</div>
      )}
      {room.kind !== "dm" && (
        <div className="chat-channel-note">{t("groupModerationPolicy")}</div>
      )}
      <form
        className="chat-message-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(searchInput.trim());
        }}
      >
        <Search size={17} />
        <Field id="chat-message-search" label={t("searchMessages")}>
          <input
            id="chat-message-search"
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            maxLength={200}
          />
        </Field>
        <Button variant="ghost" size="sm">
          {t("runSearch")}
        </Button>
        {search && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setSearchInput("");
            }}
          >
            {t("clearSearch")}
          </Button>
        )}
      </form>
      <div
        className="chat-message-scroll"
        aria-busy={messages.isFetching && !messages.isFetchingNextPage}
      >
        {messages.isPending ? (
          <Loading />
        ) : messages.isError ? (
          <ErrorState retry={() => void messages.refetch()} />
        ) : (
          <>
            {messages.hasNextPage && (
              <div className="chat-load-older">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={messages.isFetchingNextPage || !online}
                  onClick={() => void messages.fetchNextPage()}
                >
                  {t("loadOlder")}
                </Button>
              </div>
            )}
            {ordered.length === 0 ? (
              <div className="chat-thread-empty">
                <MessagesSquare size={34} />
                <h3>{t(search ? "noSearch" : "noMessages")}</h3>
                {!search && <p>{t("noMessagesHint")}</p>}
              </div>
            ) : (
              <ol className="chat-message-list" aria-label={t("title")}>
                {ordered.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    actor={actor}
                    now={now}
                    zone={profile.data?.time_zone ?? "Europe/Berlin"}
                    attachment={
                      message.document_id && !message.deleted_at ? (
                        <DocumentAttachment documentId={message.document_id} />
                      ) : undefined
                    }
                  />
                ))}
              </ol>
            )}
            <div ref={end} />
          </>
        )}
      </div>
      {mute.isError && <Notice kind="error">{t("actionError")}</Notice>}
      {read.isError && (
        <ErrorState
          retry={
            online && latest
              ? () => {
                  marked.current = latest.id;
                  mark(latest.id);
                }
              : undefined
          }
        />
      )}
      {status === "retrying" && online && (
        <div className="chat-reconnect" role="status">
          {t("reconnecting")}
        </div>
      )}
      <MessageComposer
        key={`composer:${room.id}`}
        actor={actor}
        room={room.id}
      />
      <MembersPanel
        key={`members:${room.id}`}
        actor={actor}
        room={room}
        canManage={canManage}
        open={membersOpen}
        onOpenChange={setMembersOpen}
      />
    </section>
  );
}

/**
 * Active conversation with search, history, read state, mute and member controls. Access loss
 * hides retained data; report messages read only online and in the visible tab.
 */
import { isDatabasePermissionDenied } from "../../lib/database-errors";
import { canRetryNextPage } from "../../lib/paged-read";
import { orderedCursorRows } from "../../lib/cursor-rows";
import { Fragment, useEffect, useEffectEvent, useRef, useState } from "react";
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
  Info,
  MessagesSquare,
  Search,
  UsersRound,
} from "lucide-react";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { profileQuery } from "../../lib/queries";
import { Button } from "../../components/ui/button";
import {
  ErrorState,
  Field,
  Loading,
  NextPageError,
  Notice,
} from "../../components/common";
import { DocumentAttachment } from "../files/document-attachment";
import { chatKeys, chatMessagesQuery } from "./api";
import { MessageComposer } from "./composer";
import { GroupSettings } from "./group-settings";
import { MembersPanel, RoomIcon } from "./manage";
import { MessageBubble } from "./message";
import { TopicMessagePins } from "./topic-message-pins";
import { useTopicMessagePins } from "./topic-message-pins-api";
import { messageDay, messageDayLabel } from "./message-days";
import "./message-days.css";
import { useChatRealtime } from "./realtime";
import type { ChatRoom } from "./types";
import "./i18n";

/** Bind history, read state, search, Realtime and attachments to one active room. */
export function ChatThread({
  actor,
  room,
  canManageCourses,
  onBack,
  messageId,
  draft,
  onDraftChange,
}: {
  actor: string;
  room: ChatRoom;
  canManageCourses: boolean;
  onBack: () => void;
  messageId?: string | null;
  draft?: string;
  onDraftChange?: (text: string, sentText?: string) => void;
}) {
  const { t, i18n } = useTranslation("chat");
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
  const [replyId, setReplyId] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { status, revoked } = useChatRealtime(actor, room.id);
  const pinText = useTranslation("topicMessagePins").t;
  const topicPins = useTopicMessagePins(
    actor,
    room.id,
    room.kind === "topic" && !revoked && online,
  );
  const [jumping, setJumping] = useState(false);
  const [jumpFailed, setJumpFailed] = useState(false);
  const [jumpId, setJumpId] = useState<string | null>(null);
  const threadElement = useRef<HTMLElement>(null);
  const [following, setFollowing] = useState(true);
  const [linkedTarget, setLinkedTarget] = useState<string | null>(null);
  const [newMessages, setNewMessages] = useState(false);
  const messages = useInfiniteQuery({
    ...chatMessagesQuery(actor, room.id, search),
    enabled: !revoked,
  });
  const retryOlder = canRetryNextPage(messages);
  const historyUnavailable = messages.isError && !retryOlder;
  const ordered = orderedCursorRows(messages.data?.pages, "ascending");
  const pinnedIds = new Set((topicPins.query.data ?? []).map((pin) => pin.id));
  const latest = ordered[ordered.length - 1];
  // Jump only to history that has just been fetched through the existing ACL-checked RPC.
  // Bound one action to 20 pages; another click may continue where it stopped.
  const jumpToMessage = async (id: string) => {
    setFollowing(false);
    setJumping(true);
    setJumpFailed(false);
    try {
      let found = ordered.some(
        (message) => message.id === id && !message.deleted_at,
      );
      let hasNext = messages.hasNextPage;
      for (let count = 0; !found && hasNext && count < 20; count++) {
        const next = await messages.fetchNextPage();
        if (next.isError) throw next.error;
        found = (next.data?.pages ?? []).some((page) =>
          page.some((message) => message.id === id && !message.deleted_at),
        );
        hasNext = next.hasNextPage;
      }
      if (found) {
        setLinkedTarget(id);
        setJumpId(id);
      } else setJumpFailed(true);
    } catch {
      setJumpFailed(true);
    } finally {
      setJumping(false);
    }
  };
  useEffect(() => {
    if (!jumpId) return;
    const item = [
      ...(threadElement.current?.querySelectorAll<HTMLElement>(
        "[data-message-id]",
      ) ?? []),
    ].find((element) => element.dataset.messageId === jumpId);
    if (item) {
      item.scrollIntoView({ block: "center" });
      item.focus();
      setJumpId(null);
    }
  }, [jumpId, ordered]);
  const openLinkedMessage = useEffectEvent((id: string) => {
    void jumpToMessage(id);
  });
  useEffect(() => {
    if (!messageId || !messages.isSuccess || !online || revoked) return;
    const request = setTimeout(() => openLinkedMessage(messageId), 0);
    return () => clearTimeout(request);
  }, [messageId, messages.isSuccess, online, revoked]);
  const zone = profile.data?.time_zone ?? "Europe/Berlin";
  const marked = useRef("");
  const end = useRef<HTMLDivElement>(null);
  // Room management is not a blanket administrator read bypass for private DMs.
  // The UI follows distinct room types; the server checks each action again.
  const canManage =
    room.kind !== "dm" &&
    room.kind !== "general" &&
    (room.owner_id === actor ||
      (canManageCourses &&
        ["lecturer_course", "participant_course"].includes(room.kind)));
  const read = useMutation({
    mutationFn: async (messageId: string | null) => {
      requireOnline();
      const { error } =
        messageId === null
          ? await db().rpc("clear_chat_manual_unread", { p_room_id: room.id })
          : await db().rpc("mark_chat_read", {
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
      if (marked.current === (messageId ?? "empty")) marked.current = "";
    },
  });
  const mark = read.mutate;
  useEffect(() => {
    // Search results or an invisible tab do not confirm that new messages were read.
    // The ref prevents concurrent duplicates only; onError allows an uncertain receipt to retry.
    const observeRead = () => {
      const emptyMarked = messages.isSuccess && !latest && room.manual_unread;
      const target = latest?.id ?? (emptyMarked ? "empty" : "");
      if (
        !target ||
        search ||
        !following ||
        historyUnavailable ||
        (messageId && !linkedTarget) ||
        revoked ||
        !online ||
        document.visibilityState !== "visible" ||
        marked.current === target
      )
        return;
      marked.current = target;
      mark(latest?.id ?? null);
    };
    observeRead();
    document.addEventListener("visibilitychange", observeRead);
    return () => document.removeEventListener("visibilitychange", observeRead);
  }, [
    latest,
    messages.isSuccess,
    room.manual_unread,
    following,
    historyUnavailable,
    messageId,
    linkedTarget,
    search,
    revoked,
    online,
    mark,
  ]);
  const previousLatest = useRef("");
  useEffect(() => {
    if (!latest || latest.id === previousLatest.current || search) return;
    const initial = !previousLatest.current;
    previousLatest.current = latest.id;
    if (following && (!initial || !messageId))
      end.current?.scrollIntoView({ behavior: "instant", block: "nearest" });
    else if (!initial) setNewMessages(true);
  }, [latest, search, following, messageId]);
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
  // Revocation outranks a previously successful history response.
  // Retained query data must not conceal the revoked state.
  const lost =
    revoked ||
    isDatabasePermissionDenied(messages.error) ||
    (room.kind === "topic" &&
      isDatabasePermissionDenied(topicPins.query.error));
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
      ref={threadElement}
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
          {!["dm", "general"].includes(room.kind) && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={i18n.t("title", { ns: "chatGroupSettings" })}
              onClick={() => setSettingsOpen(true)}
            >
              <Info size={19} />
            </Button>
          )}
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
      <details className="chat-thread-tools">
        <summary>
          {t("conversationTools")}
          {search && <span className="badge">{t("searchActive")}</span>}
        </summary>
        <div className="chat-thread-tools-content">
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
            <div className="chat-channel-note">
              {t("groupModerationPolicy")}
            </div>
          )}
          {room.kind === "topic" && online && status === "connected" && (
            <TopicMessagePins
              pins={
                topicPins.query.isSuccess && !topicPins.query.isFetching
                  ? topicPins.query.data
                  : []
              }
              loading={topicPins.query.isPending || topicPins.query.isFetching}
              error={topicPins.query.isError}
              onRetry={() => void topicPins.query.refetch()}
              onJump={(id) => void jumpToMessage(id)}
              jumping={
                jumping || messages.isFetchingNextPage || messages.isError
              }
              searchActive={Boolean(search)}
              jumpFailed={jumpFailed}
            />
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
        </div>
      </details>
      {topicPins.toggle.isError && (
        <Notice kind="error">{pinText("failed")}</Notice>
      )}
      <div
        className="chat-message-scroll"
        onScroll={(event) => {
          const area = event.currentTarget;
          const isAtEnd =
            area.scrollHeight - area.scrollTop - area.clientHeight <= 12;
          setFollowing(isAtEnd);
          if (isAtEnd) setNewMessages(false);
        }}
        aria-busy={messages.isFetching && !messages.isFetchingNextPage}
      >
        {messages.isPending ? (
          <Loading />
        ) : historyUnavailable ? (
          <ErrorState retry={() => void messages.refetch()} />
        ) : (
          <>
            {retryOlder ? (
              <NextPageError
                retry={() =>
                  void messages.fetchNextPage({ cancelRefetch: false })
                }
                disabled={!online || messages.isFetching}
              />
            ) : (
              messages.hasNextPage && (
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
              )
            )}
            {ordered.length === 0 ? (
              <div className="chat-thread-empty">
                <MessagesSquare size={34} />
                <h3>{t(search ? "noSearch" : "noMessages")}</h3>
                {!search && <p>{t("noMessagesHint")}</p>}
              </div>
            ) : (
              <ol className="chat-message-list" aria-label={t("title")}>
                {ordered.map((message, index) => {
                  const day = messageDay(message.created_at, zone);
                  const previous = ordered[index - 1];
                  const showDay =
                    !previous || messageDay(previous.created_at, zone) !== day;
                  return (
                    <Fragment key={message.id}>
                      {showDay && (
                        <li className="chat-date-separator">
                          <time dateTime={day}>
                            {messageDayLabel(
                              message.created_at,
                              zone,
                              i18n.resolvedLanguage ?? i18n.language,
                            )}
                          </time>
                        </li>
                      )}
                      <MessageBubble
                        message={message}
                        highlighted={message.id === linkedTarget}
                        onReply={(target) => setReplyId(target.id)}
                        topicPin={
                          room.kind === "topic" &&
                          message.can_moderate &&
                          topicPins.query.isSuccess &&
                          !topicPins.query.isFetching &&
                          online &&
                          status === "connected"
                            ? {
                                pinned: pinnedIds.has(message.id),
                                disabled: topicPins.toggle.isPending,
                                toggle: () =>
                                  topicPins.toggle.mutate({
                                    id: message.id,
                                    pinned: !pinnedIds.has(message.id),
                                  }),
                              }
                            : undefined
                        }
                        actor={actor}
                        now={now}
                        zone={zone}
                        attachment={
                          message.document_id && !message.deleted_at ? (
                            <DocumentAttachment
                              documentId={message.document_id}
                            />
                          ) : undefined
                        }
                      />
                    </Fragment>
                  );
                })}
              </ol>
            )}
            <div ref={end} />
          </>
        )}
      </div>
      {messageId && jumpFailed && (
        <div className="chat-reconnect">
          <Notice kind="error">{t("linkedMessageUnavailable")}</Notice>
          {messages.hasNextPage && (
            <Button
              variant="secondary"
              onClick={() => void jumpToMessage(messageId)}
              disabled={jumping || !online}
            >
              {t("loadOlder")}
            </Button>
          )}
        </div>
      )}
      {!following && newMessages && (
        <Button
          variant="secondary"
          onClick={() => {
            end.current?.scrollIntoView({ block: "nearest" });
            setFollowing(true);
            setNewMessages(false);
          }}
        >
          {t("jumpToNewMessages")}
        </Button>
      )}
      {mute.isError && <Notice kind="error">{t("actionError")}</Notice>}
      {read.isError && (
        <ErrorState
          retry={
            online && (latest || (messages.isSuccess && room.manual_unread))
              ? () => {
                  marked.current = latest?.id ?? "empty";
                  mark(latest?.id ?? null);
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
        draft={draft}
        onDraftChange={onDraftChange}
        replyId={replyId}
        replyTarget={
          historyUnavailable
            ? undefined
            : ordered.find((item) => item.id === replyId)
        }
        onCancelReply={() => setReplyId(null)}
      />
      {settingsOpen && (
        <GroupSettings
          key={`settings:${room.id}`}
          actor={actor}
          room={room.id}
          canManage={canManage}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      )}
      <MembersPanel
        key={`members:${room.id}`}
        actor={actor}
        room={room}
        onLeft={onBack}
        canManage={canManage}
        open={membersOpen}
        onOpenChange={setMembersOpen}
      />
    </section>
  );
}

/**
 * Room directory, direct-message creation and active conversation selection. Selection owns
 * thread lifetime; contacts and membership come from authorized server projections.
 */
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  BellOff,
  MessageCirclePlus,
  MessagesSquare,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { readPreference, writePreference } from "../../lib/preferences";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import {
  permissionsQuery,
  profileQuery,
  userRolesQuery,
} from "../../lib/queries";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import {
  chatDirectoryFiltersQuery,
  chatKeys,
  chatRoomsQuery,
  type ChatDirectoryFacet,
} from "./api";
import { ContactPicker, CreateGroup, RoomIcon } from "./manage";
import { ChatThread } from "./thread";
import type { ChatRoom } from "./types";
import { RoomActivity } from "./room-activity";
import { RoomUnread } from "./room-unread";
import { TopicInvitationInbox } from "./topic-invitations";
import "./room-unread-i18n";
import "./i18n";
import "./pins-i18n";
import "./room-archive-i18n";
import "./chat.css";

const filterCategories = ["company", "staff", "course", "lecturer"] as const;
type DirectoryPreference = {
  category: ChatDirectoryFacet["category"] | "";
  key: string;
  archived: boolean;
  unread: boolean;
};
const defaultDirectory: DirectoryPreference = {
  category: "",
  key: "",
  archived: false,
  unread: false,
};

function readDirectory(actor: string): DirectoryPreference {
  try {
    const saved = JSON.parse(
      readPreference(`chat-directory.${actor}`) ?? "null",
    );
    const category =
      filterCategories.find((value) => value === saved?.category) ?? "";
    return {
      category,
      key: category && typeof saved?.key === "string" ? saved.key : "",
      archived: saved?.archived === true,
      unread: saved?.unread === true,
    };
  } catch {
    return defaultDirectory;
  }
}

/** Select rooms and start DMs using authorized contact/room projections. */
export function ChatPage() {
  const { session } = useAuth();
  const actor = session!.user.id;
  return <ChatDirectory key={actor} actor={actor} />;
}

function ChatDirectory({ actor }: { actor: string }) {
  const { t, i18n } = useTranslation("chat");
  const common = useTranslation().t;
  const online = useOnline();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("room");
  const messageId = params.get("message");
  const rooms = useQuery(chatRoomsQuery(actor));
  const directoryFilters = useQuery(chatDirectoryFiltersQuery(actor));
  // The shell owns the profile request; observe its cached zone without initiating another request.
  const profile = useQuery({ ...profileQuery(actor), enabled: false });
  const permissions = useQuery(permissionsQuery(actor));
  const roles = useQuery(userRolesQuery(actor));
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState(() => readDirectory(actor));
  const showArchived = filter.archived;
  function changeFilter(changes: Partial<DirectoryPreference>) {
    const next = { ...filter, ...changes };
    setFilter(next);
    // Historical company facets can contain a name instead of an identifier.
    writePreference(
      `chat-directory.${actor}`,
      JSON.stringify({
        ...next,
        key: next.key.startsWith("job-name:") ? "" : next.key,
      }),
    );
  }
  const archiveText = useTranslation("chatRoomArchive").t;
  const [contactsOpen, setContactsOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [roomToClear, setRoomToClear] = useState<ChatRoom | null>(null);
  const [clearTrigger, setClearTrigger] = useState<HTMLButtonElement | null>(
    null,
  );
  const [roomSearch, setRoomSearch] = useState<HTMLInputElement | null>(null);
  const previousRooms = useRef(new Set<string>());
  const previousDeleted = useRef(new Set<string>());
  const selected = rooms.data?.find((room) => room.id === selectedId);
  const canManageCourses =
    permissions.data?.includes("courses.manage") ?? false;
  const staff =
    roles.data?.some((role) =>
      ["owner", "admin", "management", "lecturer", "senior_lecturer"].includes(
        role,
      ),
    ) ?? false;
  const lecturer =
    roles.data?.some((role) =>
      ["owner", "admin", "lecturer", "senior_lecturer"].includes(role),
    ) ?? false;
  const selectRoom = (room: string | null) => {
    const next = new URLSearchParams(params);
    next.delete("message");
    if (room) next.set("room", room);
    else next.delete("room");
    setParams(next);
  };
  const contact = params.get("contact");
  const { mutate: openContactDm, isError: contactFailed } = useMutation({
    mutationFn: async (userId: string) => {
      requireOnline();
      const { data, error } = await db().rpc("create_dm", {
        p_user_id: userId,
      });
      if (error || !data) throw error ?? new Error("unconfirmed");
      return data as string;
    },
    onSuccess: async (id) => {
      await client.invalidateQueries({ queryKey: chatKeys.rooms(actor) });
      setParams({ room: id }, { replace: true });
    },
  });
  useEffect(() => {
    if (contact && /^[0-9a-f-]{36}$/i.test(contact) && online)
      openContactDm(contact);
  }, [contact, online, openContactDm]);
  useEffect(() => {
    if (!rooms.data) return;
    const current = new Set(rooms.data.map((room) => room.id));
    for (const id of previousRooms.current) {
      if (current.has(id)) continue;
      client.removeQueries({ queryKey: chatKeys.messages(actor, id) });
      client.removeQueries({ queryKey: chatKeys.members(actor, id) });
      client.removeQueries({ queryKey: chatKeys.draft(actor, id) });
    }
    const deleted = new Set(
      rooms.data.filter((room) => room.personal_deleted).map((room) => room.id),
    );
    for (const id of deleted)
      if (!previousDeleted.current.has(id))
        client.removeQueries({ queryKey: chatKeys.draft(actor, id) });
    previousDeleted.current = deleted;
    previousRooms.current = current;
  }, [rooms.data, actor, client]);
  const general = useMutation({
    mutationFn: async () => {
      requireOnline();
      const { data, error } = await db().rpc("ensure_general_chat");
      if (error || !data) throw error ?? new Error("unconfirmed");
      return data as string;
    },
    onSuccess: async (room) => {
      await client.invalidateQueries({ queryKey: chatKeys.rooms(actor) });
      selectRoom(room);
    },
  });
  const pin = useMutation({
    mutationFn: async ({ room, pinned }: { room: string; pinned: boolean }) => {
      requireOnline();
      const { error } = await db().rpc("set_chat_pin", {
        p_room_id: room,
        p_pinned: pinned,
      });
      if (error) throw error;
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: chatKeys.rooms(actor) }),
  });
  const archive = useMutation({
    mutationFn: async ({
      room,
      archived,
    }: {
      room: string;
      archived: boolean;
    }) => {
      requireOnline();
      const { error } = await db().rpc("set_chat_personal_archive", {
        p_room_id: room,
        p_archived: archived,
      });
      if (error) throw error;
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: chatKeys.rooms(actor) }),
  });
  const clearRoom = useMutation({
    mutationFn: async (room: string) => {
      requireOnline();
      const { error } = await db().rpc("clear_personal_chat", {
        p_room_id: room,
      });
      if (error) throw error;
    },
    onSuccess: async (_, room) => {
      if (selectedId === room) selectRoom(null);
      client.removeQueries({ queryKey: chatKeys.draft(actor, room) });
      const history = chatKeys.messages(actor, room);
      client.removeQueries({ queryKey: history, type: "inactive" });
      await Promise.all([
        client.invalidateQueries({ queryKey: chatKeys.rooms(actor) }),
        client.invalidateQueries({ queryKey: history }),
        client.invalidateQueries({ queryKey: ["course-chat-messages", actor] }),
        client.invalidateQueries({ queryKey: ["course-chat-rooms", actor] }),
        client.invalidateQueries({ queryKey: ["unified-search", actor] }),
      ]);
      setRoomToClear(null);
    },
  });
  const pinnedOrder = (rooms.data ?? [])
    .filter((room) => room.pinned)
    .sort((a, b) => (a.pinOrder ?? 0) - (b.pinOrder ?? 0))
    .map((room) => room.id);
  const movePin = useMutation({
    mutationFn: async ({
      room,
      direction,
    }: {
      room: string;
      direction: "up" | "down";
    }) => {
      requireOnline();
      const { error } = await db().rpc("move_chat_pin", {
        p_room_id: room,
        p_direction: direction,
        p_expected_order: pinnedOrder,
      });
      if (error) throw error;
    },
    onSettled: () =>
      client.invalidateQueries({ queryKey: chatKeys.rooms(actor) }),
  });
  const directoryRooms = (rooms.data ?? []).filter(
    (room) =>
      !room.personal_deleted &&
      Boolean(room.personal_archived) === showArchived,
  );
  const directoryIds = new Set(directoryRooms.map(({ id }) => id));
  const facetsByRoom = new Map<string, ChatDirectoryFacet[]>();
  const options = new Map<string, string>();
  const category = directoryFilters.isSuccess ? filter.category : "";
  for (const facet of directoryFilters.isSuccess ? directoryFilters.data : []) {
    if (!directoryIds.has(facet.room_id)) continue;
    const facets = facetsByRoom.get(facet.room_id) ?? [];
    facets.push(facet);
    facetsByRoom.set(facet.room_id, facets);
    if (facet.category === category) options.set(facet.facet_key, facet.label);
  }
  const key = options.has(filter.key) ? filter.key : "";
  const needle = search.trim().toLocaleLowerCase(i18n.language);
  const filtered = directoryRooms
    .filter((room) => {
      const facets = facetsByRoom.get(room.id) ?? [];
      const title = room.kind === "general" ? t("kind_general") : room.title;
      return (
        (!filter.unread || room.unread_count > 0 || room.manual_unread) &&
        (!category ||
          facets.some(
            (facet) =>
              facet.category === category && (!key || facet.facet_key === key),
          )) &&
        (!needle ||
          [title, ...facets.map(({ label }) => label)].some((label) =>
            label.toLocaleLowerCase(i18n.language).includes(needle),
          ))
      );
    })
    .sort(
      (a, b) =>
        Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
        (a.pinned && b.pinned ? (a.pinOrder ?? 0) - (b.pinOrder ?? 0) : 0),
    );
  const hasFilter = Boolean(needle || category || filter.unread);
  return (
    <section
      className={`chat-page ${selectedId ? "chat-page-has-selection" : ""}`}
    >
      {contactFailed && <Notice kind="error">{t("error")}</Notice>}
      <header className="chat-page-heading">
        <h1>{t("title")}</h1>
        <div className="chat-page-actions">
          <Button
            variant="secondary"
            onClick={() => setContactsOpen(true)}
            disabled={!online}
          >
            <MessageCirclePlus size={17} aria-hidden="true" />
            {t("newMessage")}
          </Button>
          {staff && (
            <Button onClick={() => setGroupOpen(true)} disabled={!online}>
              <Plus size={17} aria-hidden="true" />
              {t("newGroup")}
            </Button>
          )}
        </div>
      </header>
      <div
        className={`chat-workspace ${selectedId ? "chat-has-selection" : ""}`}
      >
        <aside className="chat-directory" aria-label={t("rooms")}>
          <div className="chat-directory-tools">
            <div className="chat-directory-heading">
              <h2>{t("rooms")}</h2>
              <span className="badge" aria-live="polite">
                {filtered.length}
              </span>
            </div>
            <div className="chat-room-search">
              <Search size={17} />
              <label className="sr-only" htmlFor="chat-room-search">
                {t("searchRooms")}
              </label>
              <input
                id="chat-room-search"
                ref={setRoomSearch}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("searchRooms")}
              />
            </div>
            <div className="chat-directory-filters">
              <Field id="chat-directory-category" label={t("filterCategory")}>
                <select
                  value={category}
                  disabled={!directoryFilters.isSuccess}
                  onChange={(event) => {
                    const category =
                      filterCategories.find(
                        (item) => item === event.target.value,
                      ) ?? "";
                    changeFilter({ category, key: "" });
                  }}
                >
                  <option value="">{t("filterAll")}</option>
                  {filterCategories.map((item) => (
                    <option key={item} value={item}>
                      {t(`filter_${item}`)}
                    </option>
                  ))}
                </select>
              </Field>
              {category && options.size > 0 && (
                <Field
                  id="chat-directory-value"
                  label={t(`filterValue_${category}`)}
                >
                  <select
                    value={key}
                    onChange={(event) =>
                      changeFilter({ key: event.target.value })
                    }
                  >
                    <option value="">{t("filterAllMatches")}</option>
                    {[...options]
                      .sort(([, a], [, b]) => a.localeCompare(b, i18n.language))
                      .map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
            </div>
            {directoryFilters.isError && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void directoryFilters.refetch()}
              >
                {t("retryFilters")}
              </Button>
            )}
            <div
              className="chat-room-tabs"
              role="group"
              aria-label={archiveText("filter")}
            >
              <Button
                type="button"
                variant={!showArchived ? "default" : "secondary"}
                aria-pressed={!showArchived}
                onClick={() => changeFilter({ archived: false })}
              >
                {archiveText("active")}
              </Button>
              <Button
                type="button"
                variant={showArchived ? "default" : "secondary"}
                aria-pressed={showArchived}
                onClick={() => changeFilter({ archived: true })}
              >
                {archiveText("archived")}
              </Button>
              <Button
                type="button"
                variant={filter.unread ? "default" : "secondary"}
                aria-pressed={filter.unread}
                onClick={() => changeFilter({ unread: !filter.unread })}
              >
                {t("filterUnread")}
              </Button>
            </div>
          </div>
          <div className="chat-directory-results">
            {lecturer && !hasFilter && !showArchived && (
              <button
                className="chat-lounge"
                type="button"
                onClick={() => general.mutate()}
                disabled={!online || general.isPending}
              >
                <span aria-hidden="true">✳</span>
                <span>
                  <strong>{t("lecturerLounge")}</strong>
                  <small>{t("lecturerLoungeHint")}</small>
                </span>
              </button>
            )}
            {general.isError && (
              <Notice kind="error">{t("actionError")}</Notice>
            )}
            {staff && (
              <TopicInvitationInbox actor={actor} onRoom={selectRoom} />
            )}
            {archive.isError && (
              <Notice kind="error">{archiveText("failed")}</Notice>
            )}
            {(pin.isError || movePin.isError) && (
              <Notice kind="error">{t("pinError")}</Notice>
            )}
            {rooms.isPending ? (
              <Loading />
            ) : rooms.isError ? (
              <ErrorState retry={() => void rooms.refetch()} />
            ) : filtered.length ? (
              <ul className="chat-room-list">
                {filtered.map((room) => (
                  <li key={room.id} className="chat-room-row">
                    <button
                      type="button"
                      className={`chat-room-button ${room.id === selectedId ? "is-selected" : ""}`}
                      aria-pressed={room.id === selectedId}
                      onClick={() => selectRoom(room.id)}
                    >
                      <span
                        className={`chat-room-symbol chat-kind-${room.kind}`}
                        aria-hidden="true"
                      >
                        <RoomIcon kind={room.kind} />
                      </span>
                      <span className="chat-room-copy">
                        <strong>
                          {room.kind === "general"
                            ? t("kind_general")
                            : room.title || t(`kind_${room.kind}`)}
                        </strong>
                        <small>{t(`kind_${room.kind}`)}</small>
                        {room.last_message_preview && (
                          <small
                            className="chat-room-preview"
                            title={room.last_message_preview}
                          >
                            <span className="sr-only">
                              {t("lastMessagePreview")}:
                            </span>
                            {room.last_message_preview}
                          </small>
                        )}
                        <RoomActivity
                          instant={room.last_message_at}
                          zone={profile.data?.time_zone}
                        />
                      </span>
                      <span className="chat-room-indicators">
                        {room.unread_count > 0 && (
                          <span
                            className="chat-unread"
                            aria-label={t("unread", {
                              count: Number(room.unread_count),
                            })}
                          >
                            {room.unread_count}
                          </span>
                        )}
                        {room.manual_unread && (
                          <span
                            className="chat-unread"
                            aria-label={i18n.t("marked", {
                              ns: "chatRoomUnread",
                            })}
                            title={i18n.t("marked", { ns: "chatRoomUnread" })}
                          >
                            ●
                          </span>
                        )}
                        {room.muted && (
                          <BellOff size={13} aria-label={t("muted")} />
                        )}
                      </span>
                    </button>
                    {(room.kind === "dm" || room.kind === "topic") && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={archiveText(
                          room.personal_archived ? "restore" : "archive",
                          { title: room.title },
                        )}
                        title={
                          room.id === selectedId && !room.personal_archived
                            ? archiveText("closeFirst")
                            : archiveText(
                                room.personal_archived ? "restore" : "archive",
                                { title: room.title },
                              )
                        }
                        disabled={
                          !online ||
                          archive.isPending ||
                          (room.id === selectedId && !room.personal_archived)
                        }
                        onClick={() =>
                          archive.mutate({
                            room: room.id,
                            archived: !room.personal_archived,
                          })
                        }
                      >
                        {room.personal_archived ? (
                          <ArchiveRestore size={16} />
                        ) : (
                          <Archive size={16} />
                        )}
                      </Button>
                    )}
                    <RoomUnread
                      actor={actor}
                      room={room}
                      selected={room.id === selectedId}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t(room.pinned ? "unpinRoom" : "pinRoom", {
                        title: room.title || t(`kind_${room.kind}`),
                      })}
                      aria-pressed={Boolean(room.pinned)}
                      disabled={!online || pin.isPending || movePin.isPending}
                      onClick={() =>
                        pin.mutate({ room: room.id, pinned: !room.pinned })
                      }
                    >
                      {room.pinned ? <PinOff size={16} /> : <Pin size={16} />}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("clearRoomLabel", {
                        title: room.title || t(`kind_${room.kind}`),
                      })}
                      title={t("clearRoom")}
                      disabled={!online || clearRoom.isPending}
                      onClick={(event) => {
                        setClearTrigger(event.currentTarget);
                        clearRoom.reset();
                        setRoomToClear(room);
                      }}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </Button>
                    {room.pinned && (
                      <div className="chat-pin-reorder">
                        {(["up", "down"] as const).map((direction) => (
                          <Button
                            key={direction}
                            variant="ghost"
                            size="icon"
                            aria-label={t(
                              direction === "up" ? "movePinUp" : "movePinDown",
                              { title: room.title || t(`kind_${room.kind}`) },
                            )}
                            disabled={
                              !online ||
                              pin.isPending ||
                              movePin.isPending ||
                              !filtered.some(
                                (item) =>
                                  item.id ===
                                  pinnedOrder[
                                    pinnedOrder.indexOf(room.id) +
                                      (direction === "up" ? -1 : 1)
                                  ],
                              ) ||
                              (direction === "up"
                                ? pinnedOrder[0] === room.id
                                : pinnedOrder.at(-1) === room.id)
                            }
                            onClick={() =>
                              movePin.mutate({ room: room.id, direction })
                            }
                          >
                            {direction === "up" ? (
                              <ArrowUp size={14} />
                            ) : (
                              <ArrowDown size={14} />
                            )}
                          </Button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="chat-list-empty">
                <MessagesSquare size={28} />
                {hasFilter ? (
                  <>
                    <h3>{t("noFilterMatches")}</h3>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setSearch("");
                        changeFilter({ category: "", key: "", unread: false });
                      }}
                    >
                      {t("clearFilters")}
                    </Button>
                  </>
                ) : (
                  <>
                    <h3>
                      {showArchived ? archiveText("empty") : t("noRooms")}
                    </h3>
                    <p>
                      {showArchived
                        ? archiveText("emptyHint")
                        : t("noRoomsHint")}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </aside>
        <div className="chat-conversation">
          {rooms.isPending ? (
            <Loading />
          ) : selected ? (
            <ChatThread
              key={`${selected.id}:${messageId ?? ""}`}
              actor={actor}
              room={selected}
              canManageCourses={canManageCourses}
              messageId={messageId}
              draft={client.getQueryData(chatKeys.draft(actor, selected.id))}
              onDraftChange={(text, sentText) =>
                client.setQueryData<string>(
                  chatKeys.draft(actor, selected.id),
                  (current) =>
                    sentText !== undefined && current !== sentText
                      ? current
                      : text,
                )
              }
              onBack={() => selectRoom(null)}
            />
          ) : selectedId ? (
            <div className="chat-room-denied">
              <Notice kind="error">{t("roomUnavailable")}</Notice>
              <Button variant="secondary" onClick={() => selectRoom(null)}>
                {t("rooms")}
              </Button>
            </div>
          ) : (
            <div className="chat-welcome">
              <div className="chat-welcome-motif" aria-hidden="true">
                <MessagesSquare size={46} />
                <span>✳</span>
              </div>
              <h2>{t("chooseRoom")}</h2>
              <p>{t("chooseRoomHint")}</p>
            </div>
          )}
        </div>
      </div>
      <Dialog
        open={Boolean(roomToClear)}
        onOpenChange={(open) => {
          if (!open && !clearRoom.isPending) setRoomToClear(null);
        }}
        title={t("clearRoom")}
        description={t("clearRoomDescription", {
          title:
            roomToClear?.title ||
            (roomToClear ? t(`kind_${roomToClear.kind}`) : ""),
        })}
        closeDisabled={clearRoom.isPending}
        returnFocusTo={clearTrigger?.isConnected ? clearTrigger : roomSearch}
      >
        <div className="form-actions">
          <Button
            variant="secondary"
            onClick={() => setRoomToClear(null)}
            disabled={clearRoom.isPending}
          >
            {common("cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={() => roomToClear && clearRoom.mutate(roomToClear.id)}
            disabled={!online || clearRoom.isPending}
          >
            {t("clearRoom")}
          </Button>
        </div>
        {clearRoom.isError && (
          <Notice kind="error">{t("clearRoomError")}</Notice>
        )}
      </Dialog>
      <ContactPicker
        actor={actor}
        open={contactsOpen}
        onOpenChange={setContactsOpen}
        onRoom={selectRoom}
      />
      {staff && (
        <CreateGroup
          actor={actor}
          canManageCourses={canManageCourses}
          open={groupOpen}
          onOpenChange={setGroupOpen}
          onRoom={selectRoom}
        />
      )}
    </section>
  );
}

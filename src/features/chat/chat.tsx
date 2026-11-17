/**
 * Room directory, direct-message creation and active conversation selection. Selection owns
 * thread lifetime; contacts and membership come from authorized server projections.
 */
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  BellOff,
  MessageCirclePlus,
  Pin,
  PinOff,
  MessagesSquare,
  Plus,
  Search,
} from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import {
  permissionsQuery,
  profileQuery,
  userRolesQuery,
} from "../../lib/queries";
import { Button } from "../../components/ui/button";
import {
  ErrorState,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { chatKeys, chatRoomsQuery } from "./api";
import { ContactPicker, CreateGroup, RoomIcon } from "./manage";
import { ChatThread } from "./thread";
import { RoomActivity } from "./room-activity";
import { RoomUnread } from "./room-unread";
import { TopicInvitationInbox } from "./topic-invitations";
import "./room-unread-i18n";
import "./i18n";
import "./pins-i18n";
import "./chat.css";
/** Select rooms and start DMs using authorized contact/room projections. */
export function ChatPage() {
  const { t, i18n } = useTranslation("chat");
  const online = useOnline();
  const { session } = useAuth();
  const actor = session!.user.id;
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("room");
  const rooms = useQuery(chatRoomsQuery(actor));
  // The shell owns the profile request; observe its cached zone without initiating another request.
  const profile = useQuery({ ...profileQuery(actor), enabled: false });
  const permissions = useQuery(permissionsQuery(actor));
  const roles = useQuery(userRolesQuery(actor));
  const [search, setSearch] = useState("");
  const [contactsOpen, setContactsOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const previousRooms = useRef<string[]>([]);
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
    const current = rooms.data.map((room) => room.id);
    for (const id of previousRooms.current.filter(
      (id) => !current.includes(id),
    )) {
      client.removeQueries({ queryKey: chatKeys.messages(actor, id) });
      client.removeQueries({ queryKey: chatKeys.members(actor, id) });
    }
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
  const filtered =
    rooms.data
      ?.filter((room) =>
        room.title
          .toLocaleLowerCase(i18n.language)
          .includes(search.toLocaleLowerCase(i18n.language)),
      )
      .sort(
        (a, b) =>
          Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
          (a.pinned && b.pinned ? (a.pinOrder ?? 0) - (b.pinOrder ?? 0) : 0),
      ) ?? [];
  return (
    <>
      {contactFailed && <Notice kind="error">{t("error")}</Notice>}
      <PageHeading
        title={t("title")}
        description={t("intro")}
        action={
          <div className="chat-page-actions">
            <Button
              variant="secondary"
              onClick={() => setContactsOpen(true)}
              disabled={!online}
            >
              <MessageCirclePlus size={17} />
              {t("newMessage")}
            </Button>
            {staff && (
              <Button onClick={() => setGroupOpen(true)} disabled={!online}>
                <Plus size={17} />
                {t("newGroup")}
              </Button>
            )}
          </div>
        }
      />
      <div
        className={`chat-workspace ${selectedId ? "chat-has-selection" : ""}`}
      >
        <aside className="chat-directory" aria-label={t("rooms")}>
          <div className="chat-directory-heading">
            <h2>{t("rooms")}</h2>
            <span className="badge">{rooms.data?.length ?? 0}</span>
          </div>
          <div className="chat-room-search">
            <Search size={17} />
            <label className="sr-only" htmlFor="chat-room-search">
              {t("searchRooms")}
            </label>
            <input
              id="chat-room-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("searchRooms")}
            />
          </div>
          {lecturer && (
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
          {general.isError && <Notice kind="error">{t("actionError")}</Notice>}
          {staff && <TopicInvitationInbox actor={actor} onRoom={selectRoom} />}
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
              <h3>{t("noRooms")}</h3>
              <p>{t("noRoomsHint")}</p>
            </div>
          )}
        </aside>
        <div className="chat-conversation">
          {rooms.isPending ? (
            <Loading />
          ) : selected ? (
            <ChatThread
              key={selected.id}
              actor={actor}
              room={selected}
              canManageCourses={canManageCourses}
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
    </>
  );
}

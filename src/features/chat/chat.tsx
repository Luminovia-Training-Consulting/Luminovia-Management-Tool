import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  BellOff,
  MessageCirclePlus,
  MessagesSquare,
  Plus,
  Search,
} from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { permissionsQuery } from "../../lib/queries";
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
import "./i18n";
import "./chat.css";
export function ChatPage() {
  const { t, i18n } = useTranslation("chat");
  const online = useOnline();
  const { session } = useAuth();
  const actor = session!.user.id;
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("room");
  const rooms = useQuery(chatRoomsQuery(actor));
  const permissions = useQuery(permissionsQuery(actor));
  const roles = useQuery({
    queryKey: ["chat-own-roles", actor],
    queryFn: async () => {
      const { data, error } = await db()
        .from("user_roles")
        .select("role")
        .eq("user_id", actor);
      if (error) throw error;
      return (data ?? []).map((row) => row.role as string);
    },
  });
  const [search, setSearch] = useState("");
  const [contactsOpen, setContactsOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const previousRooms = useRef<string[]>([]);
  const selected = rooms.data?.find((room) => room.id === selectedId);
  const canManageCourses =
    permissions.data?.includes("courses.manage") ?? false;
  const staff =
    roles.data?.some((role) =>
      ["admin", "management", "lecturer", "senior_lecturer"].includes(role),
    ) ?? false;
  const lecturer =
    roles.data?.some((role) =>
      ["lecturer", "senior_lecturer"].includes(role),
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
  const filtered =
    rooms.data?.filter((room) =>
      room.title
        .toLocaleLowerCase(i18n.language)
        .includes(search.toLocaleLowerCase(i18n.language)),
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
          {rooms.isPending ? (
            <Loading />
          ) : rooms.isError ? (
            <ErrorState retry={() => void rooms.refetch()} />
          ) : filtered.length ? (
            <ul className="chat-room-list">
              {filtered.map((room) => (
                <li key={room.id}>
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
                      {room.muted && (
                        <BellOff size={13} aria-label={t("muted")} />
                      )}
                    </span>
                  </button>
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

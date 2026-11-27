/**
 * Contact selection, group creation and visible membership controls. DMs, the general staff room
 * and course rooms retain their distinct management rules.
 */
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search, UserPlus, UsersRound, X } from "lucide-react";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { PersonRatingButton } from "../people/person-rating";
import { JobPicker } from "../jobs/picker";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { chatContactsQuery, chatKeys, chatMembersQuery } from "./api";
import type { ChatContact, ChatRoom } from "./types";
import { GroupOwnership } from "./group-ownership";
import { TopicInvitationManager } from "./topic-invitations";
import { TopicInviteOnly } from "./topic-invite-only";
import { useTopicInviteOnly } from "./topic-invite-only-api";
import "./topic-invite-only-i18n";
import "./i18n";

/** Use the permitted display name or translated fallback for unnamed contacts. */
const contactName = (
  contact: Pick<ChatContact, "display_name">,
  fallback: string,
) => contact.display_name || fallback;

/** Offer a controlled selection from contacts already returned by the authorized query. */
export function ContactPicker({
  actor,
  open,
  onOpenChange,
  onRoom,
}: {
  actor: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRoom: (room: string) => void;
}) {
  const { t } = useTranslation("chat");
  const client = useQueryClient();
  const contacts = useQuery({ ...chatContactsQuery(actor), enabled: open });
  const [search, setSearch] = useState("");
  const online = useOnline();
  const start = useMutation({
    mutationFn: async (person: string) => {
      requireOnline();
      const { data, error } = await db().rpc("create_dm", {
        p_user_id: person,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: async (room) => {
      await client.invalidateQueries({ queryKey: chatKeys.rooms(actor) });
      onOpenChange(false);
      onRoom(room);
    },
  });
  const filtered =
    contacts.data?.filter(
      (contact) =>
        contact.id !== actor &&
        contact.display_name
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()),
    ) ?? [];
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("contactTitle")}
      description={t("contactHint")}
    >
      <Field id="chat-contact-search" label={t("searchPeople")}>
        <input
          id="chat-contact-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Field>
      {contacts.isPending ? (
        <Loading />
      ) : contacts.isError ? (
        <ErrorState retry={() => void contacts.refetch()} />
      ) : (
        <ul className="chat-contact-list">
          {filtered.map((contact, index) => (
            <li key={contact.id}>
              <button
                type="button"
                className="chat-contact-button"
                aria-label={t("startDm", {
                  name: contactName(contact, t("unnamed")),
                })}
                onClick={() => start.mutate(contact.id)}
                disabled={!online || start.isPending}
              >
                <span
                  className={`chat-contact-avatar chat-avatar-${index % 4}`}
                  aria-hidden="true"
                >
                  {contactName(contact, "?").slice(0, 1).toUpperCase()}
                </span>
                <span>{contactName(contact, t("unnamed"))}</span>
                <UserPlus size={17} />
              </button>
              <PersonRatingButton
                actor={actor}
                person={contact.id}
                name={contactName(contact, t("unnamed"))}
              />
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="chat-list-empty">{t("noContacts")}</li>
          )}
        </ul>
      )}
      {start.isError && <Notice kind="error">{t("actionError")}</Notice>}
    </Dialog>
  );
}

/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
const groupSchema = z.object({
  title: z.string().trim().min(1).max(120),
  kind: z.enum(["topic", "participant_course"]),
  job: z.string(),
  members: z.array(z.string()).max(60),
  invitationOnly: z.boolean(),
});

/** Create an explicit group with selected members through the chat server contract. */
export function CreateGroup({
  actor,
  canManageCourses,
  open,
  onOpenChange,
  onRoom,
}: {
  actor: string;
  canManageCourses: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRoom: (room: string) => void;
}) {
  const { t } = useTranslation("chat");
  const strictText = useTranslation("topicInviteOnly").t;
  const online = useOnline();
  const client = useQueryClient();
  const contacts = useQuery({ ...chatContactsQuery(actor), enabled: open });
  const form = useForm<z.infer<typeof groupSchema>>({
    resolver: zodResolver(groupSchema),
    defaultValues: {
      title: "",
      kind: "topic",
      job: "",
      members: [],
      invitationOnly: false,
    },
  });
  const kind = useWatch({ control: form.control, name: "kind" });
  const invitationOnly = useWatch({
    control: form.control,
    name: "invitationOnly",
  });
  const selectedJob = useWatch({ control: form.control, name: "job" });
  const create = useMutation({
    mutationFn: async (values: z.infer<typeof groupSchema>) => {
      requireOnline();
      if (
        values.kind === "participant_course" &&
        (!canManageCourses || !values.job)
      )
        throw new Error("missing_course");
      const { data, error } =
        values.kind === "topic" && values.invitationOnly
          ? await db().rpc("create_invitation_only_topic", {
              p_title: values.title,
              p_invitee_ids: values.members,
            })
          : await db().rpc("create_chat_group", {
              p_title: values.title,
              p_member_ids: values.members,
              p_kind: values.kind,
              p_job_id:
                values.kind === "participant_course" ? values.job : null,
            });
      if (error) throw error;
      return data as string;
    },
    onSuccess: async (room) => {
      await client.invalidateQueries({ queryKey: chatKeys.rooms(actor) });
      form.reset();
      onOpenChange(false);
      onRoom(room);
    },
  });
  const available =
    contacts.data?.filter(
      (contact) =>
        contact.id !== actor &&
        (kind === "participant_course" ||
          contact.roles.some((role) =>
            ["admin", "management", "lecturer", "senior_lecturer"].includes(
              role,
            ),
          )),
    ) ?? [];
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("groupTitle")}
      description={t("groupHint")}
    >
      <form
        noValidate
        onSubmit={form.handleSubmit((values) => create.mutate(values))}
      >
        <Field
          id="chat-group-title"
          label={t("groupName")}
          error={Boolean(form.formState.errors.title)}
        >
          <input
            id="chat-group-title"
            {...form.register("title")}
            maxLength={120}
            disabled={create.isPending}
          />
        </Field>
        {canManageCourses && (
          <Field id="chat-group-kind" label={t("groupKind")}>
            <select
              id="chat-group-kind"
              {...form.register("kind", {
                onChange: () => {
                  form.setValue("members", []);
                  form.setValue("job", "");
                },
              })}
              disabled={create.isPending}
            >
              <option value="topic">{t("kind_topic")}</option>
              <option value="participant_course">
                {t("kind_participant_course")}
              </option>
            </select>
          </Field>
        )}
        {kind === "topic" && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              {...form.register("invitationOnly")}
              disabled={create.isPending}
            />
            {strictText("create")}
          </label>
        )}
        {kind === "topic" && invitationOnly && (
          <p>{strictText("createHint")}</p>
        )}
        <fieldset className="chat-member-fieldset">
          <legend>{t("selectMembers")}</legend>
          {contacts.isPending ? (
            <Loading />
          ) : contacts.isError ? (
            <ErrorState retry={() => void contacts.refetch()} />
          ) : (
            available.map((contact) => (
              <label className="checkbox-label" key={contact.id}>
                <input
                  type="checkbox"
                  value={contact.id}
                  {...form.register("members")}
                  disabled={create.isPending}
                />
                {contactName(contact, t("unnamed"))}
              </label>
            ))
          )}
        </fieldset>
        {kind === "participant_course" ? (
          canManageCourses && (
            <JobPicker
              actor={actor}
              purpose="participant_course"
              value={selectedJob}
              onChange={(id) => form.setValue("job", id)}
            >
              {(selected) => (
                <Button
                  disabled={
                    !selected ||
                    !online ||
                    create.isPending ||
                    contacts.isPending ||
                    contacts.isError
                  }
                >
                  {t("groupCreate")}
                </Button>
              )}
            </JobPicker>
          )
        ) : (
          <Button
            disabled={
              !online ||
              create.isPending ||
              contacts.isPending ||
              contacts.isError
            }
          >
            {t("groupCreate")}
          </Button>
        )}
        {create.isError && <Notice kind="error">{t("groupError")}</Notice>}
      </form>
    </Dialog>
  );
}

/** Display current members and offer applicable management actions that the server independently checks. */
export function MembersPanel({
  actor,
  room,
  onLeft,
  canManage,
  open,
  onOpenChange,
}: {
  actor: string;
  room: ChatRoom;
  onLeft: () => void;
  canManage: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("chat");
  const common = useTranslation().t;
  const online = useOnline();
  const client = useQueryClient();
  const members = useQuery({
    ...chatMembersQuery(actor, room.id),
    enabled: open,
  });
  const contacts = useQuery({
    ...chatContactsQuery(actor),
    enabled: open && canManage,
  });
  const inviteMode = useTopicInviteOnly(
    actor,
    room.id,
    open && room.kind === "topic",
  );
  const [person, setPerson] = useState("");
  const [remove, setRemove] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [originPerson, setOriginPerson] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const origin = useMutation({
    mutationFn: async (independent: boolean) => {
      requireOnline();
      if (!originPerson) throw new Error("Missing member");
      const { error } = await db().rpc("resolve_participant_chat_origin", {
        p_room: room.id,
        p_user: originPerson.id,
        p_independent: independent,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setOriginPerson(null);
      setSaved(true);
    },
  });
  const [saved, setSaved] = useState(false);
  const change = useMutation({
    mutationFn: async ({ id, remove }: { id: string; remove: boolean }) => {
      requireOnline();
      setSaved(false);
      const { error } = await db().rpc("manage_chat_member", {
        p_room_id: room.id,
        p_user_id: id,
        p_remove: remove,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({
          queryKey: chatKeys.members(actor, room.id),
        }),
        client.invalidateQueries({ queryKey: chatKeys.rooms(actor) }),
      ]);
      setRemove(null);
      setPerson("");
      setSaved(true);
    },
  });
  const available =
    contacts.data?.filter(
      (contact) =>
        !members.data?.some((member) => member.user_id === contact.id) &&
        (room.kind === "participant_course" ||
          contact.roles.some((role) =>
            ["admin", "management", "lecturer", "senior_lecturer"].includes(
              role,
            ),
          )),
    ) ?? [];
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={canManage ? t("manageMembers") : t("members")}
        description={t("membersHint")}
      >
        {members.isPending ? (
          <Loading />
        ) : members.isError ? (
          <ErrorState retry={() => void members.refetch()} />
        ) : (
          <ul className="chat-members-list">
            {members.data.map((member) => (
              <li key={member.user_id}>
                <span>
                  <strong>{member.display_name || t("unnamed")}</strong>
                  {room.owner_id === member.user_id && (
                    <small>{t("owner")}</small>
                  )}
                </span>
                {member.user_id !== actor && (
                  <PersonRatingButton
                    actor={actor}
                    person={member.user_id}
                    name={member.display_name || t("unnamed")}
                  />
                )}
                {canManage &&
                  member.user_id !== room.owner_id &&
                  (room.kind === "participant_course" ||
                    member.user_id !== actor) && (
                    <div className="chat-member-actions">
                      {room.kind === "participant_course" && (
                        <Button
                          variant="ghost"
                          disabled={!online || origin.isPending}
                          onClick={() => {
                            origin.reset();
                            setOriginPerson({
                              id: member.user_id,
                              name: member.display_name || t("unnamed"),
                            });
                          }}
                        >
                          {t("resolveOrigin")}
                        </Button>
                      )}
                      {member.user_id !== actor && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("removeMember", {
                            name: member.display_name || t("unnamed"),
                          })}
                          disabled={!online || change.isPending}
                          onClick={() => {
                            change.reset();
                            setRemove({
                              id: member.user_id,
                              name: member.display_name || t("unnamed"),
                            });
                          }}
                        >
                          <X size={17} />
                        </Button>
                      )}
                    </div>
                  )}
              </li>
            ))}
          </ul>
        )}
        {room.kind === "topic" && (
          <TopicInviteOnly
            actor={actor}
            room={room.id}
            owner={room.owner_id === actor}
            mode={inviteMode}
          />
        )}
        {canManage &&
          (room.kind !== "topic" ||
            (inviteMode.isSuccess && !inviteMode.data)) && (
            <form
              className="chat-member-add"
              onSubmit={(event) => {
                event.preventDefault();
                if (person) change.mutate({ id: person, remove: false });
              }}
            >
              <Field id="chat-add-member" label={t("memberToAdd")}>
                <select
                  id="chat-add-member"
                  value={person}
                  onChange={(event) => setPerson(event.target.value)}
                  disabled={change.isPending}
                >
                  <option value="">{t("memberToAdd")}</option>
                  {available.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contactName(contact, t("unnamed"))}
                    </option>
                  ))}
                </select>
              </Field>
              <Button
                disabled={
                  !person || !online || change.isPending || contacts.isError
                }
              >
                <UserPlus size={16} />
                {t("addMember")}
              </Button>
              {contacts.isError && (
                <Notice kind="error">{common("error")}</Notice>
              )}
            </form>
          )}
        {room.kind === "topic" &&
          room.owner_id === actor &&
          members.isSuccess &&
          contacts.isSuccess && (
            <TopicInvitationManager
              actor={actor}
              room={room.id}
              candidates={available}
            />
          )}
        {room.kind === "topic" && members.isSuccess && (
          <GroupOwnership
            actor={actor}
            room={room}
            members={members.data}
            onLeft={onLeft}
          />
        )}
        {saved && <Notice>{t("membershipSaved")}</Notice>}
        {change.isError && <Notice kind="error">{t("actionError")}</Notice>}
      </Dialog>
      <Dialog
        open={originPerson !== null}
        onOpenChange={(next) => {
          if (!next && !origin.isPending) setOriginPerson(null);
        }}
        title={t("resolveOriginTitle", { name: originPerson?.name ?? "" })}
        description={t("resolveOriginHint")}
      >
        <div className="form-actions">
          <Button
            variant="secondary"
            disabled={!online || origin.isPending}
            onClick={() => origin.mutate(false)}
          >
            {t("originAssignment")}
          </Button>
          <Button
            disabled={!online || origin.isPending}
            onClick={() => origin.mutate(true)}
          >
            {t("originIndependent")}
          </Button>
        </div>
        {origin.isError && <Notice kind="error">{t("actionError")}</Notice>}
      </Dialog>
      <Dialog
        open={remove !== null}
        onOpenChange={(next) => {
          if (!next && !change.isPending) setRemove(null);
        }}
        title={t("removeConfirm")}
        description={t("removeDescription", { name: remove?.name ?? "" })}
      >
        <div className="form-actions">
          <Button
            variant="secondary"
            disabled={change.isPending}
            onClick={() => setRemove(null)}
          >
            {common("cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={!online || change.isPending}
            onClick={() => {
              if (remove) change.mutate({ id: remove.id, remove: true });
            }}
          >
            {t("remove")}
          </Button>
        </div>
        {change.isError && <Notice kind="error">{t("actionError")}</Notice>}
      </Dialog>
    </>
  );
}

/** Map room type to a presentation-only icon. */
export function RoomIcon({
  kind,
  size = 20,
}: {
  kind: ChatRoom["kind"];
  size?: number;
}) {
  return kind === "dm" ? (
    <UserPlus size={size} />
  ) : kind === "topic" ? (
    <Search size={size} />
  ) : (
    <UsersRound size={size} />
  );
}

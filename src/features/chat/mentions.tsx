import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { db } from "../../lib/supabase";
import { useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { ErrorState, Loading } from "../../components/common";
import type { ChatMention } from "./types";
import "./i18n";

/** Mentions select actual room members, never infer recipients from typed names. */
export function MentionPicker({
  actor,
  room,
  value,
  onChange,
  disabled = false,
}: {
  actor: string;
  room: string;
  value: ChatMention[];
  onChange: (value: ChatMention[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("chat");
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const members = useQuery({
    queryKey: ["chat-mention-candidates", actor, room],
    queryFn: async () => {
      const { data, error } = await db().rpc("chat_mention_candidates", {
        p_room_id: room,
      });
      if (error) throw error;
      return data as ChatMention[];
    },
    enabled: open && online && !disabled,
    staleTime: 0,
    retry: false,
  });
  return (
    <div className="chat-mention-picker">
      <Button
        type="button"
        variant="ghost"
        disabled={disabled || !online}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {t("mentionPeople")}
      </Button>
      {value.length > 0 && (
        <ul
          className="chat-mention-selection"
          aria-label={t("selectedMentions")}
        >
          {value.map((person) => (
            <li key={person.user_id}>
              <span>@{person.display_name}</span>
              <Button
                type="button"
                variant="ghost"
                disabled={disabled || !online}
                aria-label={t("removeMention", { name: person.display_name })}
                onClick={() =>
                  onChange(
                    value.filter((item) => item.user_id !== person.user_id),
                  )
                }
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="chat-mention-options">
          <p>{t("mentionHint")}</p>
          {members.isPending ? (
            <Loading />
          ) : members.isError ? (
            <ErrorState retry={() => void members.refetch()} />
          ) : members.data?.length ? (
            <fieldset disabled={disabled || !online}>
              <legend>{t("currentMembers")}</legend>
              {members.data.map((person) => (
                <label key={person.user_id}>
                  <input
                    type="checkbox"
                    checked={value.some(
                      (item) => item.user_id === person.user_id,
                    )}
                    disabled={
                      !value.some((item) => item.user_id === person.user_id) &&
                      value.length >= 20
                    }
                    onChange={(event) =>
                      onChange(
                        event.target.checked
                          ? [...value, person]
                          : value.filter(
                              (item) => item.user_id !== person.user_id,
                            ),
                      )
                    }
                  />
                  {person.display_name}
                </label>
              ))}
            </fieldset>
          ) : (
            <p>{t("noMentionMembers")}</p>
          )}
        </div>
      )}
    </div>
  );
}

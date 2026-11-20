/**
 * Searchable people directory and permitted profiles with courses/reviews. Start DMs through the
 * existing RPC; moderation remains a separate reasoned action.
 */
import {useState} from "react";
import {Link, useParams} from "react-router-dom";
import {useQuery, useMutation, useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {MessageCircle, Star} from "lucide-react";
import {UnavailablePerson} from "../accounts/unavailable-person";
import {PersonManagementActions} from "../accounts/person-actions";
import {Avatar} from "../profile/avatar";
import {PersonContact} from "./person-contact";
import {useAuth} from "../auth/auth-context";
import {topicsQuery} from "../../lib/queries";
import {dateTime} from "../../lib/dates";
import {useOnline, requireOnline} from "../../lib/online";
import {Button} from "../../components/ui/button";
import {Dialog} from "../../components/ui/dialog";
import {
    Field,
    Loading,
    ErrorState,
    Notice,
    PageHeading,
} from "../../components/common";
import {
    peopleDirectoryQuery,
    personQuery,
    profileCoursesQuery,
    reviewsQuery,
    peopleRpc,
    type CourseReview,
} from "./api";
import "./i18n";
import "./people.css";

/** Filter the permitted projection by search, label and expertise instead of assembling private profiles in the browser. */
export function PeopleDirectory() {
    const {t, i18n} = useTranslation("people");
    const {session} = useAuth();
    const [search, setSearch] = useState("");
    const [topic, setTopic] = useState("");
    const people = useQuery(
        peopleDirectoryQuery(session!.user.id, search, "", topic),
    );
    const topics = useQuery(topicsQuery);
    return (
        <>
            <PageHeading title={t("people")} description={t("directoryHelp")}/>
            <div className="panel people-filters">
                <Field id="people-search" label={t("search")}>
                    <input
                        id="people-search"
                        type="search"
                        maxLength={100}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </Field>
                <Field id="people-topic" label={t("topicFilter")}>
                    <select
                        id="people-topic"
                        value={topic}
                        onChange={(e) => setTopic(e.target.value)}
                    >
                        <option value="">{t("allTopics")}</option>
                        {topics.data?.map((item) => (
                            <option key={item.id} value={item.id}>
                                {i18n.language === "de" ? item.label_de : item.label_en}
                            </option>
                        ))}
                    </select>
                </Field>
            </div>
            {people.isPending ? (
                <Loading/>
            ) : people.isError ? (
                <ErrorState retry={() => void people.refetch()}/>
            ) : !people.data.length ? (
                <div className="empty-state">{t("empty")}</div>
            ) : (
                <div className="people-grid">
                    {people.data.map((person) => (
                        <article key={person.id} className="panel person-card">
                            <Avatar
                                userId={person.id}
                                name={person.display_name}
                                decorative
                            />
                            <h2>
                                <Link to={`/people/${person.id}`}>{person.display_name}</Link>
                            </h2>
                            <small className="public-user-id">
                                {t("publicId")}: <code>{person.luminovia_user_id}</code>
                            </small>
                            <p>
                                {(person.bio_de || person.bio_en).slice(0, 180) || t("noBio")}
                            </p>
                            <small>
                                {person.country}
                                {person.languages.length
                                    ? ` · ${person.languages.join(", ")}`
                                    : ""}
                            </small>
                            <span>
                <Star aria-hidden="true" size={16}/>{" "}
                                {person.review_count
                                    ? t("ratingValue", {
                                        value: Number(person.rating_average).toLocaleString(
                                            i18n.language,
                                            {maximumFractionDigits: 1},
                                        ),
                                    })
                                    : t("noReviews")}
                                {person.review_count > 0 &&
                                    ` · ${t("ratingCount", {count: person.review_count})}`}
              </span>
                            <Button asChild variant="secondary">
                                <Link to={`/people/${person.id}`}>{t("open")}</Link>
                            </Button>
                        </article>
                    ))}
                </div>
            )}
        </>
    );
}

/** Request reasoned moderation rather than silently deleting a review in the browser. */
function ModerateReview({review}: { review: CourseReview }) {
    const {t} = useTranslation("people");
    const online = useOnline();
    const client = useQueryClient();
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState("");
    const mutation = useMutation({
        mutationFn: async () => {
            requireOnline();
            await peopleRpc("moderate_course_review", {
                p_review_id: review.id,
                p_hidden: !review.hidden,
                p_reason: reason,
            });
        },
        onSuccess: async () => {
            await client.invalidateQueries({queryKey: ["lecturer-reviews"]});
            await client.invalidateQueries({queryKey: ["people-directory"]});
            setOpen(false);
            setReason("");
        },
    });
    return (
        <>
            <Button variant="ghost" disabled={!online} onClick={() => setOpen(true)}>
                {t(review.hidden ? "restore" : "hide")}
            </Button>
            <Dialog
                open={open}
                onOpenChange={setOpen}
                title={t("moderation")}
                description={t("moderationHelp")}
            >
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        mutation.mutate();
                    }}
                >
                    <Field id={`review-reason-${review.id}`} label={t("reason")}>
            <textarea
                id={`review-reason-${review.id}`}
                required
                minLength={1}
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
            />
                    </Field>
                    <Button disabled={!online || mutation.isPending || !reason.trim()}>
                        {t("save")}
                    </Button>
                    {mutation.isError && <Notice kind="error">{t("error")}</Notice>}
                </form>
            </Dialog>
        </>
    );
}

/** Combine permitted profile details, courses and reviews and request actual authorized DMs. */
export function PersonProfile() {
    const {id = ""} = useParams();
    const {t, i18n} = useTranslation("people");
    const {session} = useAuth();
    const actor = session!.user.id;
    const person = useQuery(personQuery(actor, id));
    const courses = useQuery({
        ...profileCoursesQuery(actor, id),
        enabled: person.isSuccess,
    });
    const reviews = useQuery({
        ...reviewsQuery(actor, id),
        enabled: person.isSuccess,
    });
    const contacts = useQuery({
        queryKey: ["profile-chat-contacts", actor],
        queryFn: () => peopleRpc<{ id: string }[]>("chat_contacts"),
    });
    const [state, setState] = useState("");
    if (person.isPending) return <Loading/>;
    if (person.isError)
        return <UnavailablePerson id={id} retry={() => void person.refetch()}/>;
    const details = person.data;
    const bio = details.bio_de || details.bio_en;
    return (
        <>
            <PageHeading
                title={details.display_name}
                description={details.country || details.time_zone}
            />
            <p className="public-user-id">
                <strong>{t("publicId")}:</strong>{" "}
                <code>{details.luminovia_user_id}</code>
            </p>
            <Avatar userId={id} name={details.display_name} size="large"/>
            <div className="page-actions people-profile-actions">
                <PersonManagementActions id={id} name={details.display_name}/>
                <Button asChild variant="ghost">
                    <Link to="/people">{t("back")}</Link>
                </Button>
                {id !== actor &&
                    contacts.data?.some((contact) => contact.id === id) && (
                        <Button asChild>
                            <Link to={`/chats?contact=${id}`}>
                                <MessageCircle size={17}/>
                                {t("message")}
                            </Link>
                        </Button>
                    )}
            </div>

            <PersonContact actor={actor} target={id}/>
            <div className="people-details-grid">
                <section className="panel">
                    <h2>{t("details")}</h2>
                    <p className="person-prose">{bio || t("noBio")}</p>

                    {details.languages.length > 0 && (
                        <p>{details.languages.join(", ")}</p>
                    )}
                    {details.teaching_experience && (
                        <>
                            <h3>{t("experience")}</h3>
                            <p className="person-prose">{details.teaching_experience}</p>
                        </>
                    )}
                </section>
                <section className="panel">
                    <h2>{t("expertise")}</h2>
                    {!details.topics.length ? (
                        <p>{t("noTopics")}</p>
                    ) : (
                        <ul>
                            {details.topics.map((topic) => (
                                <li key={topic.id}>
                                    {i18n.language === "de" ? topic.label_de : topic.label_en} ·{" "}
                                    {t(topic.verified ? "verified" : "selfDeclared")}
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            </div>
            <section className="panel">
                <h2>{t("courses")}</h2>
                <Field id="profile-course-state" label={t("state")}>
                    <select
                        id="profile-course-state"
                        value={state}
                        onChange={(e) => setState(e.target.value)}
                    >
                        <option value="">{t("allStates")}</option>
                        {(["current", "upcoming", "past"] as const).map((value) => (
                            <option key={value} value={value}>
                                {t(value)}
                            </option>
                        ))}
                    </select>
                </Field>
                {courses.isPending ? (
                    <Loading/>
                ) : courses.isError ? (
                    <ErrorState retry={() => void courses.refetch()}/>
                ) : (
                    (["current", "upcoming", "past"] as const)
                        .filter((value) => !state || state === value)
                        .map((value) => (
                            <div key={value}>
                                <h3>{t(value)}</h3>
                                {!courses.data.some((item) => item.state === value) ? (
                                    <p>{t("noCourses")}</p>
                                ) : (
                                    <ul className="people-course-list">
                                        {courses.data
                                            .filter((item) => item.state === value)
                                            .map((item) => (
                                                <li key={item.course_run_id}>
                                                    <h3>
                                                        {item.can_open ? (
                                                            <Link to={`/courses?run=${item.course_run_id}`}>
                                                                {item.title}
                                                            </Link>
                                                        ) : (
                                                            item.title
                                                        )}
                                                    </h3>
                                                    <small>
                                                        {dateTime(
                                                            item.starts_at,
                                                            i18n.language,
                                                            item.time_zone,
                                                        )}{" "}
                                                        —{" "}
                                                        {dateTime(
                                                            item.ends_at,
                                                            i18n.language,
                                                            item.time_zone,
                                                        )}{" "}
                                                        · {item.time_zone}
                                                    </small>
                                                </li>
                                            ))}
                                    </ul>
                                )}
                            </div>
                        ))
                )}
            </section>
            <section className="panel" style={{marginTop: 24}}>
                <h2>{t("ratings")}</h2>
                <p className="muted">{t("recentReviews")}</p>
                {reviews.isPending ? (
                    <Loading/>
                ) : reviews.isError ? (
                    <ErrorState retry={() => void reviews.refetch()}/>
                ) : !reviews.data.length ? (
                    <p>{t("noReviews")}</p>
                ) : (
                    <ul className="people-review-list">
                        {reviews.data.map((review) => (
                            <li key={review.id}>
                                <div className="people-review-heading">
                                    <strong>
                                        {t("ratingValue", {value: review.rating})} ·{" "}
                                        {review.course_title}
                                    </strong>
                                    <small>{t(review.reviewer_label)}</small>
                                </div>
                                <p className="person-prose">{review.comment}</p>
                                <small>
                                    {dateTime(
                                        review.created_at,
                                        i18n.language,
                                        details.time_zone,
                                    )}
                                </small>
                                {review.hidden && (
                                    <Notice>
                                        {t("hidden")}
                                        {review.moderation_reason &&
                                            ` · ${review.moderation_reason}`}
                                    </Notice>
                                )}
                                {details.can_moderate && <ModerateReview review={review}/>}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </>
    );
}
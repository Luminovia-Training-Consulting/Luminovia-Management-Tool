/**
 * Own reviews for courses the server marks reviewable. Server eligibility and existing-review
 * state govern editing; confirm save/withdrawal only after a successful response.
 */
import {useState} from "react";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {Link} from "react-router-dom";
import {useAuth} from "../auth/auth-context";
import {requireOnline, useOnline} from "../../lib/online";
import {Button} from "../../components/ui/button";
import {Dialog} from "../../components/ui/dialog";
import {ErrorState, Field, Loading, Notice, PageHeading,} from "../../components/common";
import {dateTime} from "../../lib/dates";
import {peopleRpc, type ReviewableCourse} from "./api";
import "./i18n";
import "./people.css";

/** Edit the server-authorized course/lecturer review through explicit save/withdrawal actions. */
function ReviewForm({course}: { course: ReviewableCourse }) {
    const {t, i18n} = useTranslation("people");
    const online = useOnline();
    const client = useQueryClient();
    const previous =
        course.review && !course.review.deleted ? course.review : null;
    const [rating, setRating] = useState(previous ? String(previous.rating) : "");
    const [comment, setComment] = useState(previous?.comment ?? "");
    const [deleting, setDeleting] = useState(false);
    const invalidate = async () => {
        await client.invalidateQueries({queryKey: ["reviewable-courses"]});
        await client.invalidateQueries({queryKey: ["lecturer-reviews"]});
        await client.invalidateQueries({queryKey: ["people-directory"]});
        setDeleting(false);
    };
    const save = useMutation({
        mutationFn: async () => {
            requireOnline();
            await peopleRpc("submit_course_review", {
                p_course_run_id: course.course_run_id,
                p_lecturer_id: course.lecturer_id,
                p_rating: Number(rating),
                p_comment: comment,
                p_version: course.review?.version ?? 0,
            });
        },
        onSuccess: invalidate,
    });
    const remove = useMutation({
        mutationFn: async () => {
            requireOnline();
            if (!previous) throw new Error("missing_review");
            await peopleRpc("delete_course_review", {
                p_review_id: previous.id,
                p_version: previous.version,
            });
        },
        onSuccess: invalidate,
    });
    const failed = save.isError || remove.isError;
    const conflict = [save.error, remove.error].some((error) =>
        String((error as { message?: string })?.message ?? "").includes(
            "review_version_conflict",
        ),
    );
    return (
        <article className="panel">
            <h2>{course.title}</h2>
            <p>
                <Link to={`/people/${course.lecturer_id}`}>{course.lecturer_name}</Link>{" "}
                · {dateTime(course.ends_at, i18n.language, "Europe/Berlin")}
            </p>
            {previous?.hidden && (
                <Notice>
                    {t("hidden")} · {previous.moderation_reason}
                </Notice>
            )}
            <form
                className="people-review-form"
                onSubmit={(e) => {
                    e.preventDefault();
                    save.mutate();
                }}
            >
                <Field
                    id={`review-rating-${course.course_run_id}-${course.lecturer_id}`}
                    label={t("rating")}
                >
                    <select
                        id={`review-rating-${course.course_run_id}-${course.lecturer_id}`}
                        required
                        value={rating}
                        onChange={(e) => setRating(e.target.value)}
                    >
                        <option value="">{t("choose")}</option>
                        {[1, 2, 3, 4, 5].map((value) => (
                            <option key={value} value={value}>
                                {t("ratingValue", {value})}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field
                    id={`review-comment-${course.course_run_id}-${course.lecturer_id}`}
                    label={t("comment")}
                >
          <textarea
              id={`review-comment-${course.course_run_id}-${course.lecturer_id}`}
              maxLength={2000}
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
          />
                </Field>
                <div className="form-actions">
                    <Button
                        disabled={!online || save.isPending || remove.isPending || !rating}
                    >
                        {t("submit")}
                    </Button>
                    {previous && (
                        <Button
                            type="button"
                            variant="secondary"
                            disabled={!online || remove.isPending}
                            onClick={() => setDeleting(true)}
                        >
                            {t("deleteReview")}
                        </Button>
                    )}
                </div>
                {save.isSuccess && <Notice>{t("saved")}</Notice>}
                {failed && (
                    <Notice kind="error">{t(conflict ? "conflict" : "error")}</Notice>
                )}
            </form>
            <Dialog
                open={deleting}
                onOpenChange={setDeleting}
                title={t("deleteReview")}
                description={t("deleteHelp")}
            >
                <Button
                    disabled={!online || remove.isPending}
                    onClick={() => remove.mutate()}
                >
                    {t("deleteReview")}
                </Button>
                {remove.isError && <Notice kind="error">{t("error")}</Notice>}
            </Dialog>
        </article>
    );
}

/** Read only currently reviewable courses with their existing own-review state. */
export function MyCourseReviews() {
    const {t} = useTranslation("people");
    const {session} = useAuth();
    const query = useQuery({
        queryKey: ["reviewable-courses", session!.user.id],
        queryFn: () => peopleRpc<ReviewableCourse[]>("reviewable_courses"),
    });
    return (
        <>
            <PageHeading title={t("reviewTasks")} description={t("reviewHelp")}/>
            {query.isPending ? (
                <Loading/>
            ) : query.isError ? (
                <ErrorState retry={() => void query.refetch()}/>
            ) : !query.data.length ? (
                <div className="empty-state">{t("noReviewTasks")}</div>
            ) : (
                <div className="people-profile-extra">
                    {query.data.map((course) => (
                        <ReviewForm
                            key={`${course.course_run_id}:${course.lecturer_id}:${course.review?.version ?? 0}`}
                            course={course}
                        />
                    ))}
                </div>
            )}
        </>
    );
}
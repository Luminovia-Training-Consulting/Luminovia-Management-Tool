/** Parse the narrow course-material multipart transport before file-side effects. */
export const assignmentSubmissionQuery = "?mode=assignment-submission";
export const courseSubmissionQuery = "?mode=course-submission";
export const courseScormQuery = "?mode=scorm-package";
export const academyMaterialQuery = "?mode=academy-material";
export const academyStudentExamQuery = "?mode=academy-student-exam";
export const academyCourseChatQuery = "?mode=academy-course-chat";
export const academyAttendanceQuery = "?mode=academy-attendance";
export const academyAnswerKeyQuery = "?mode=academy-answer-key";
export const academyMaterialMaxBytes = 10 * 1024 * 1024;

export function academyMaterialCourse(form: FormData, intake: boolean): string | null {
    return scopedTarget(form, intake, "academy_course_id");
}

export function academyChatRoom(form: FormData, intake: boolean): string | null {
    return scopedTarget(form, intake, "academy_room_id");
}

/** Parse the run and, for assignment intake, admit exactly one assignment ID field. */
export function courseSubmissionRun(form: FormData, intake: boolean, assignment = false): string | null {
    return scopedTarget(form, intake, "course_run_id", assignment ? ["assignment_id"] : []);
}

/** Use a separate multipart field so a ZIP cannot enter generic course submissions. */
export function courseScormRun(form: FormData, intake: boolean): string | null {
    return scopedTarget(form, intake, "scorm_course_id");
}

export function academyAttendanceSession(form: FormData, intake: boolean): string | null {
    return scopedTarget(form, intake, "academy_session_id");
}

function scopedTarget(form: FormData, intake: boolean, field: "academy_course_id" | "academy_room_id" | "academy_session_id" | "course_run_id" | "scorm_course_id", extra: string[] = []) {
    const course = form.get(field);
    if (!intake && course === null) return null;
    if (
        !intake || typeof course !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(course) ||
        Array.from(form.keys()).sort().join(",") !== `${[field, "client_id", "file", ...extra].sort().join(",")}`
    ) throw new Error("invalid_request");
    return course;
}

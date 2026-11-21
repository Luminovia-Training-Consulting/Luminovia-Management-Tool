/** Parse the narrow course-material multipart transport before file-side effects. */
export const academyMaterialQuery = "?mode=academy-material";
export const academyStudentExamQuery = "?mode=academy-student-exam";
export const academyCourseChatQuery = "?mode=academy-course-chat";
export const academyAnswerKeyQuery = "?mode=academy-answer-key";
export const academyMaterialMaxBytes = 10 * 1024 * 1024;

export function academyMaterialCourse(form: FormData, intake: boolean): string | null {
    return scopedTarget(form, intake, "academy_course_id");
}

export function academyChatRoom(form: FormData, intake: boolean): string | null {
    return scopedTarget(form, intake, "academy_room_id");
}

function scopedTarget(form: FormData, intake: boolean, field: "academy_course_id" | "academy_room_id") {
    const course = form.get(field);
    if (!intake && course === null) return null;
    if (
        !intake || typeof course !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(course) ||
        Array.from(form.keys()).sort().join(",") !== `${field},client_id,file`
    ) throw new Error("invalid_request");
    return course;
}

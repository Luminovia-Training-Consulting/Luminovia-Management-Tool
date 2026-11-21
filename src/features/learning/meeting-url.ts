import { teachingLink } from "../dashboard/personal-api";
import type { CourseWorkspace } from "./api";

// Match the database grammar. Preserve the complete invitation, including its query and fragment.
const httpsAuthority =
  /^https:\/\/((?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?::([0-9]{1,5}))?(?:[/?#]|$)/;
export const maxMeetingUrlLength = 2048;

export function isMeetingUrl(url: string) {
  if (
    url.length > maxMeetingUrlLength ||
    /[^!-~]/.test(url) ||
    url.includes("\\")
  )
    return false;
  const authority = httpsAuthority.exec(url);
  if (!authority || authority[1].length > 253) return false;
  const port = authority[2];
  return !port || (Number(port) >= 1 && Number(port) <= 65535);
}

export function courseClassroom(course: CourseWorkspace) {
  if (course.delivery_type !== "online") return null;
  const published = course.meeting_link?.url;
  if (published) return isMeetingUrl(published) ? published : null;
  return teachingLink(course.venue);
}

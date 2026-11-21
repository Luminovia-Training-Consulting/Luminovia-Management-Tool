/** Fictional course data and restricted learner routes for the public demo. */
import guideModules from "@edition-demo-guides";
import type { GuideModule } from "../help/guide";

export const courses = [
  {
    id: "linux-basics",
    title: "course",
    phase: "upcoming",
    dates: ["2030-05-06T08:00:00Z", "2030-05-07T08:00:00Z"],
    welcome: "welcomeLinux",
    resource: "resourceLinux",
    resourceBody: "resourceLinuxBody",
    exam: true,
    question: "question",
    answers: ["pwd", "cd"],
    correct: "pwd",
  },
  {
    id: "network-basics",
    title: "samplePastCourse",
    phase: "completed",
    dates: ["2030-04-18T08:00:00Z"],
    welcome: "welcomeNetwork",
    resource: "resourceNetwork",
    resourceBody: "resourceNetworkBody",
    exam: false,
    question: "networkQuestion",
    answers: ["2", "4"],
    correct: "4",
  },
] as const;

export type FictionalCourse = (typeof courses)[number];

export type DemoRole =
  "lecturer" | "management" | "admin" | "client" | "participant";

export const attendanceValues = [
  "unmarked",
  "present",
  "absent",
  "excused",
] as const;
export type Attendance = (typeof attendanceValues)[number];
export type CourseMessage = { role: DemoRole; text: string };

export const demoLearner = "Demo Alex";
export const inviteCandidates = ["Sam Beispiel", "Kim Beispiel"];

export type CoursePractice = {
  welcome: string;
  meeting: boolean;
  materials: boolean;
  examRequired: boolean;
  examPublished: boolean;
  className: string;
  invited: string[];
  enrolled: string[];
  attendance: Record<string, Record<string, Attendance>>;
  messages: CourseMessage[];
};

/** An independent set of examples for each course, destroyed by the demo reset. */
export function initialCoursePractice(): Record<string, CoursePractice> {
  return Object.fromEntries(
    courses.map((course): [string, CoursePractice] => [
      course.id,
      {
        welcome: "",
        meeting: false,
        materials: false,
        examRequired: course.exam,
        examPublished: course.exam,
        className: "",
        invited: [],
        enrolled: [demoLearner],
        attendance: {},
        messages: [],
      },
    ]),
  );
}

export const demoCoursePath = (course: FictionalCourse) =>
  `/demo/courses/${course.id}/workspace`;

export const demoRoleLabel = {
  lecturer: "lecturer",
  management: "management",
  admin: "roleAdmin",
  client: "roleCompany",
  participant: "participant",
} as const;

/** Run IDs are slugs of the two fictional courses rather than arbitrary portal IDs. */
export function findFictionalCourse(path: string) {
  const id = /^\/courses\/([^/]+)\/workspace\/?$/.exec(path)?.[1];
  return courses.find((course) => course.id === id);
}

/** Supply an authored tour stop for the participant home and reuse existing guide copy for the other stops. */
const participantHome: GuideModule = {
  ...guideModules.find((module) => module.id === "courses")!,
  id: "learning",
  path: "/learning",
  title: { de: "Meine Kurse", en: "My courses" },
  summary: {
    de: "Öffne die Lernbereiche deiner freigegebenen Kurse und finde Termine, Materialien, Kurschat und Lernaktivitäten.",
    en: "Open your available course workspaces to find schedules, materials, course chat and learning activities.",
  },
};

export const learnerDemoModules = [
  participantHome,
  ...["my-reviews", "notifications", "profile"].map((id) =>
    guideModules.find((module) => module.id === id)!,
  ),
];

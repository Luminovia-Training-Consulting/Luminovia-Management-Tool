/** Fictional course data and restricted learner routes for the public demo. */
import { guideModules, type GuideModule } from "../help/catalog";

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

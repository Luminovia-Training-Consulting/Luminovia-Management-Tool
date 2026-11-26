/** Reconcile independent draft edits while retaining the server's revision check. */
import {
  normalizeCourseCurriculum,
  type CourseCurriculum,
  type CourseLesson,
  type CourseModule,
} from "./course-authoring-schema";

const same = (first: unknown, second: unknown) =>
  JSON.stringify(first) === JSON.stringify(second);

class ConcurrentCurriculumEdit extends Error {}

function mergeValue<Value>(base: Value, local: Value, remote: Value): Value {
  if (same(base, local) || same(local, remote)) return remote;
  if (same(base, remote)) return local;
  throw new ConcurrentCurriculumEdit();
}

function mergeProperties<RecordType extends object>(
  base: RecordType,
  local: RecordType,
  remote: RecordType,
): RecordType {
  const result = { ...remote };
  for (const key of Object.keys({ ...base, ...local, ...remote }) as Array<
    keyof RecordType
  >) {
    const value = mergeValue(base[key], local[key], remote[key]);
    if (value === undefined) delete result[key];
    else result[key] = value;
  }
  return result;
}

function mergeById<Item extends { id: string }>(
  base: Item[],
  local: Item[],
  remote: Item[],
  merge: (original: Item, own: Item, incoming: Item) => Item,
) {
  const ids = (items: Item[]) => items.map(({ id }) => id);
  const order = mergeValue(ids(base), ids(local), ids(remote));
  const maps = [base, local, remote].map(
    (items) => new Map(items.map((item) => [item.id, item])),
  );
  // Evaluate removals as well, so deleting an object somebody edited is a conflict.
  const values = new Map<string, Item>();
  for (const id of new Set([...ids(base), ...ids(local), ...ids(remote)])) {
    const [original, own, incoming] = maps.map((items) => items.get(id));
    const result =
      original && own && incoming
        ? merge(original, own, incoming)
        : mergeValue(original, own, incoming);
    if (result) values.set(id, result);
  }
  return order.map((id) => values.get(id)!);
}

function mergeModule(
  { lessons: originalLessons, ...original }: CourseModule,
  { lessons: localLessons, ...local }: CourseModule,
  { lessons: remoteLessons, ...remote }: CourseModule,
): CourseModule {
  return {
    ...mergeProperties(original, local, remote),
    lessons: mergeById<CourseLesson>(
      originalLessons,
      localLessons,
      remoteLessons,
      mergeProperties,
    ),
  };
}

/** Return a valid merged draft only when neither author's edits would be lost. */
export function mergeCourseCurriculum(
  base: CourseCurriculum,
  local: CourseCurriculum,
  remote: CourseCurriculum,
): CourseCurriculum | null {
  try {
    return normalizeCourseCurriculum({
      modules: mergeById(
        base.modules,
        local.modules,
        remote.modules,
        mergeModule,
      ),
    });
  } catch {
    return null;
  }
}

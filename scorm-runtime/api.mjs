/** SCORM 1.2 synchronous SCO interface. The host separately acknowledges durable writes. */
const failure = "false";
const success = "true";
const status = new Set([
  "passed",
  "completed",
  "failed",
  "incomplete",
  "browsed",
  "not attempted",
]);
const exit = new Set(["", "time-out", "suspend", "logout"]);
const grade = (value) =>
  value === "" ||
  (/^(?:\d{1,3}(?:\.\d{1,7})?|\.\d{1,7})$/.test(value) && Number(value) <= 100);
const duration = /^(?:\d{2,4}):[0-5]\d:[0-5]\d(?:\.\d{1,2})?$/;
const messages = new Map([
  ["0", "No error"],
  ["101", "General exception"],
  ["201", "Invalid argument error"],
  ["202", "Element cannot have children"],
  ["203", "Element is not an array"],
  ["301", "Not initialized"],
  ["401", "Not implemented error"],
  ["402", "Invalid set value, element is a keyword"],
  ["403", "Element is read only"],
  ["404", "Element is write only"],
  ["405", "Incorrect data type"],
]);
const fields = new Map([
  [
    "cmi.core.lesson_status",
    { initial: "not attempted", valid: (value) => status.has(value) },
  ],
  [
    "cmi.core.lesson_location",
    { initial: "", valid: (value) => value.length <= 255 },
  ],
  ["cmi.suspend_data", { initial: "", valid: (value) => value.length <= 4096 }],
  ["cmi.core.score.raw", { initial: "", valid: grade }],
  ["cmi.core.score.min", { initial: "", valid: grade }],
  ["cmi.core.score.max", { initial: "", valid: grade }],
  [
    "cmi.core.exit",
    { initial: "", valid: (value) => exit.has(value), writeOnly: true },
  ],
  [
    "cmi.core.session_time",
    {
      initial: "0000:00:00.00",
      valid: (value) => duration.test(value),
      writeOnly: true,
    },
  ],
]);

/** Exposed SCO keys are independent of the portal's identity, network and credentials. */
export function createScormApi(saved, options) {
  const state = new Map(
    Array.from(fields, ([name, rule]) => [name, rule.initial]),
  );
  for (const [name, value] of Object.entries(saved)) {
    if (
      name !== "cmi.core.session_time" &&
      typeof value === "string" &&
      fields.get(name)?.valid(value)
    )
      state.set(name, value);
  }
  const readOnly = new Map([
    ["cmi._children", "core,suspend_data,launch_data,student_data"],
    [
      "cmi.core._children",
      "student_id,student_name,lesson_location,credit,lesson_status,entry,score,total_time,lesson_mode,exit,session_time",
    ],
    ["cmi.core.score._children", "raw,min,max"],
    ["cmi.core.student_id", options.studentId],
    ["cmi.core.student_name", options.studentName],
    ["cmi.core.credit", options.preview ? "no-credit" : "credit"],
    ["cmi.core.lesson_mode", options.preview ? "browse" : "normal"],
    [
      "cmi.core.entry",
      state.get("cmi.core.exit") === "suspend"
        ? "resume"
        : options.hasPreviousState
          ? ""
          : "ab-initio",
    ],
    ["cmi.core.total_time", options.totalTime],
    ["cmi.launch_data", options.launchData],
  ]);
  if (options.masteryScore !== null)
    readOnly.set("cmi.student_data.mastery_score", options.masteryScore);
  state.set("cmi.core.exit", "");
  let initialized = false;
  let closed = false;
  let error = "0";
  const result = (value, code = "0") => {
    error = code;
    return value;
  };
  const commit = () => {
    try {
      options.commit(Object.fromEntries(state));
      return result(success);
    } catch {
      return result(failure, "101");
    }
  };
  return Object.freeze({
    LMSInitialize(argument) {
      if (argument !== "") return result(failure, "201");
      if (closed || initialized) return result(failure, "101");
      initialized = true;
      return result(success);
    },
    LMSFinish(argument) {
      if (argument !== "") return result(failure, "201");
      if (!initialized || closed) return result(failure, "301");
      if (commit() === failure) return failure;
      closed = true;
      return result(success);
    },
    LMSGetValue(name) {
      if (!initialized || closed) return result("", "301");
      if (typeof name !== "string" || !name) return result("", "201");
      if (readOnly.has(name)) return result(readOnly.get(name));
      if (fields.get(name)?.writeOnly) return result("", "404");
      if (state.has(name)) return result(state.get(name));
      if (name.endsWith("._children")) return result("", "202");
      if (name.endsWith("._count")) return result("", "203");
      return result("", "401");
    },
    LMSSetValue(name, value) {
      if (!initialized || closed) return result(failure, "301");
      if (typeof name !== "string" || !name) return result(failure, "201");
      if (name.endsWith("._children") || name.endsWith("._count"))
        return result(failure, "402");
      if (readOnly.has(name)) return result(failure, "403");
      const field = fields.get(name);
      if (!field) return result(failure, "401");
      if (
        typeof value !== "string" ||
        !field.valid(value) ||
        value.includes("\u0000")
      )
        return result(failure, "405");
      state.set(name, value);
      return result(success);
    },
    LMSCommit(argument) {
      if (argument !== "") return result(failure, "201");
      if (!initialized || closed) return result(failure, "301");
      return commit();
    },
    LMSGetLastError: () => error,
    LMSGetErrorString: (code) => messages.get(code) ?? "",
    LMSGetDiagnostic: (code) => messages.get(code || error) ?? "",
  });
}

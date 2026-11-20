const classes = new Set([
    "Error", "TypeError", "RangeError", "SyntaxError", "DOMException",
    "InvalidWorkerCreation", "WorkerRequestCancelled", "WorkerRequestIdleTimeout",
    "WorkerAlreadyRetired", "InvalidWorkerResponse", "NotFound", "PermissionDenied",
]);

export function runtimeDiagnostic(event: string, error: unknown, reference?: string): string {
    let classification = "UnknownError";
    try {
        if (error instanceof Error && classes.has(error.name)) classification = error.name;
    } catch { /* A hostile getter must not make logging disclose an object. */
    }
    return JSON.stringify({
        event: /^[a-z_]{1,50}$/.test(event) ? event : "unknown_event",
        error_class: classification,
        ...reference && /^[0-9a-f-]{36}$/i.test(reference) ? {reference} : {},
    });
}

export function logRuntimeFailure(event: string, error: unknown, reference?: string, write: (line: string) => void = console.error): void {
    write(runtimeDiagnostic(event, error, reference));
}
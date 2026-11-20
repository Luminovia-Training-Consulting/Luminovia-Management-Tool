/**
 * Selection/revocation cases inject document/version/Storage responses. Recheck visibility after reading and before returning any avatar bytes.
 */
import {selectedAvatarBytes} from "./avatar-download.ts";

const png = Uint8Array.from(
    atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgYPj/HwADAgH/xCAAOgAAAABJRU5ErkJggg==",
    ),
    (c) => c.charCodeAt(0),
);

// Fail a specific fixture condition as a real test failure; never substitute silent success.
function assert(value: unknown, message = "assertion failed"): asserts value {
    if (!value) throw new Error(message);
}

// Require the operation to reject and optionally check its stable failure reason.
async function rejects(request: Promise<unknown>, message: string) {
    try {
        await request;
    } catch (error) {
        assert(error instanceof Error && error.message === message);
        return;
    }
    throw new Error("Expected the avatar read to be denied");
}

// Create controlled owned fixtures with replaceable external responses.
function fixture() {
    let current: string | null = "selected",
        visible = true,
        downloads = 0;
    const dependencies = {
        selection: async (_target: string) => {
            if (!visible) throw new Error("access_denied");
            return current ? {version_id: current} : null;
        },
        version: async (id: string) => ({
            id,
            document_id: "image",
            object_path: "private/image/version",
            status: "clean",
            mime_type: "image/png",
            size_bytes: png.length,
        }),
        document: async (_id: string) => ({
            owner_id: "teacher",
            scope: "personal",
            kind: "avatar",
            deleted_at: null,
        }),
        download: async (_path: string) => {
            downloads++;
            return png;
        },
    };
    return {
        dependencies,
        select: (id: string | null) => {
            current = id;
        },
        revoke: () => {
            visible = false;
        },
        downloads: () => downloads,
    };
}

Deno.test(
    "avatar gateway returns only a selected exact clean personal image and never an unrelated personal document",
    async () => {
        const state = fixture();
        const result = await selectedAvatarBytes("teacher", state.dependencies);
        assert(result === png);
        assert(state.downloads() === 1);
        state.dependencies.document = async () => ({
            owner_id: "another-person",
            scope: "personal",
            kind: "avatar",
            deleted_at: null,
        });
        await rejects(
            selectedAvatarBytes("teacher", state.dependencies),
            "access_denied",
        );
        assert(state.downloads() === 1, "Foreign bytes must not be fetched");
    },
);
Deno.test(
    "replacement or removal during Storage read prevents the previous avatar bytes from returning",
    async () => {
        for (const next of ["replacement", null]) {
            const state = fixture();
            state.dependencies.download = async () => {
                state.select(next);
                return png;
            };
            await rejects(
                selectedAvatarBytes("teacher", state.dependencies),
                "access_denied",
            );
        }
    },
);
Deno.test(
    "revocation during Storage read is rechecked and missing pictures avoid all Storage work",
    async () => {
        const revoked = fixture();
        revoked.dependencies.download = async () => {
            revoked.revoke();
            return png;
        };
        await rejects(
            selectedAvatarBytes("teacher", revoked.dependencies),
            "access_denied",
        );
        const missing = fixture();
        missing.select(null);
        await rejects(
            selectedAvatarBytes("teacher", missing.dependencies),
            "avatar_unavailable",
        );
        assert(missing.downloads() === 0);
    },
);
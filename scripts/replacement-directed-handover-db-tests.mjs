/** Real directed/marketplace cross-RPC regression on the combined migrated
 * source. Both actual public handover APIs compete for one original claim;
 * observed database locks establish each winner order. Missing real module
 * prerequisites fail instead of silently skipping. No product SQL is imported
 * or accepted-main/native Auth status inferred from this SQL-only fixture.
 */
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {setTimeout as pause} from "node:timers/promises";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

assert.match(
    process.env.PORTAL_DB_CONTAINER ?? "",
    /^supabase_db_luminovia-portal-test-[a-zA-Z0-9_-]+$/,
    "An explicitly owned disposable PostgreSQL fixture is required.",
);

await withTestDatabase(
    "directed_market_race",
    async ({sql, actor, container, database}) => {
        // Missing real prerequisites are fatal, never a silently skipped green case.
        for (const signature of [
            "public.configure_compensation_policy(numeric,numeric,integer)",
            "public.create_capacity_job(jsonb,integer,uuid,uuid,numeric)",
            "public.propose_job_substitution(uuid,uuid,text,uuid)",
            "public.respond_job_substitution(uuid,text,text,uuid,boolean)",
            "public.claim_replacement(uuid,integer,integer,uuid)",
        ])
            assert.equal(
                await sql(`select to_regprocedure(${q(signature)}) is not null`),
                "t",
                `Missing actual combined source: ${signature}`,
            );
        assert.equal(
            await sql(
                "select exists(select 1 from pg_trigger where tgrelid='private.job_substitutions'::regclass and tgname='reconcile_directed_marketplace_offer' and not tgisinternal and tgenabled<>'D')",
            ),
            "t",
            "The actual PR24 forward migration must run after accepted directed source; no synthetic trigger installation is permitted.",
        );

        const [admin, original, marketLecturer, directedLecturer, organisation] =
            Array.from({length: 5}, () => randomUUID());
        await sql(`insert into auth.users(id,email) values${[admin, original, marketLecturer, directedLecturer].map((id) => `(${q(id)},${q(`fictional-handover-${id}@example.invalid`)})`).join(",")};
    insert into public.user_roles(user_id,role) values(${q(admin)},'admin'),(${q(original)},'lecturer'),(${q(marketLecturer)},'lecturer'),(${q(directedLecturer)},'senior_lecturer');
    insert into public.organisations(id,name) values(${q(organisation)},'Fictional cross-RPC academy');`);
        /** Calls only the public boundary under the actual test actor and current AAL. */
        const rpc = async (who, name, args = [], aal = "aal1", applicationName) => {
            const result = await actor(
                who,
                `${applicationName ? `set local application_name=${q(applicationName)};set local statement_timeout='15s';` : ""}select public.${name}(${args.join(",")})`,
                aal,
            );
            try {
                return JSON.parse(result);
            } catch {
                return result;
            }
        };
        await rpc(
            admin,
            "configure_compensation_policy",
            ["29.17", "76.43", "0"],
            "aal1",
        );
        // Current quotes use private per-lecturer settings, so make the two
        // competing recipients deliberately distinct in the actual fixture.
        await rpc(
            admin,
            "save_lecturer_compensation",
            [q(marketLecturer), q("daily"), "50", "400", q("AUD"), "1"],
            "aal1",
        );
        await rpc(
            admin,
            "save_lecturer_compensation",
            [q(directedLecturer), q("daily"), "50", "500", q("AUD"), "1"],
            "aal1",
        );

        /** Polls an observable lock fact with a bounded deadline, not a timing guess. */
        const observe = async (query, message) => {
            const deadline = Date.now() + 8000;
            while (Date.now() < deadline) {
                if ((await sql(query)) === "t") return;
                await pause(20);
            }
            assert.fail(message);
        };

        /** Holds only the real job row. The winning RPC first acquires its actual
         * lecturer advisory locks and blocks here; the losing RPC must then be
         * observed waiting on that exact winner PID. No business rows are changed. */
        const holdJob = async (job, name) => {
            const child = spawn(
                "docker",
                [
                    "exec",
                    "-i",
                    container,
                    "psql",
                    "-U",
                    "postgres",
                    "-d",
                    database,
                    "-X",
                    "-qAt",
                    "-v",
                    "ON_ERROR_STOP=1",
                ],
                {stdio: ["pipe", "pipe", "pipe"]},
            );
            let out = "",
                err = "";
            child.stdout.on("data", (data) => (out += data));
            child.stderr.on("data", (data) => (err += data));
            const completion = new Promise((resolve, reject) => {
                child.on("error", reject);
                child.on("close", (code) =>
                    code === 0
                        ? resolve()
                        : reject(new Error(err || out || `Lock barrier exited ${code}`)),
                );
            });
            // Attach immediately so an early fixture failure cannot leak an unhandled rejection.
            completion.catch(() => {
            });
            child.stdin.on("error", () => {
            });
            child.stdin.write(
                `begin;set local application_name=${q(name)};set local idle_in_transaction_session_timeout='20s';select id from public.jobs where id=${q(job)} for update;select 'barrier_ready';\n`,
            );
            try {
                const deadline = Date.now() + 8000;
                while (!out.includes("barrier_ready") && Date.now() < deadline)
                    await pause(20);
                assert.ok(
                    out.includes("barrier_ready"),
                    `Job barrier did not acquire its actual row: ${err}`,
                );
            } catch (error) {
                child.stdin.end("rollback;\n");
                await completion.catch(() => {
                });
                throw error;
            }
            let released = false;
            return {
                release: () => {
                    if (!released) {
                        released = true;
                        child.stdin.end("commit;\n");
                    }
                },
                completion,
            };
        };

        let sequence = 0;
        /** Creates the commissioned job, original acceptance, both offers and both
         * room kinds through the same real public APIs used by the application. */
        const make = async () => {
            const start = Date.UTC(2072, 0, 1) + ++sequence * 7 * 86400000;
            const payload = {
                title: "Fictional cross-RPC complete block",
                delivery_type: "online",
                location: "https://meeting.example.invalid/cross-rpc",
                time_zone: "Europe/Berlin",
                status: "published",
                gross_amount: 1234.57,
                gross_total_amount: 2469.13,
                currency: "AUD",
                rate_unit: "per_day",
                terms: "Fictional immutable original terms",
                requires_contract: false,
                topic_ids: [],
                sessions: [0, 1].map((day) => ({
                    starts_at: new Date(start + day * 86400000).toISOString(),
                    ends_at: new Date(start + day * 86400000 + 3600000).toISOString(),
                })),
            };
            const job = await rpc(
                admin,
                "create_capacity_job",
                [
                    `${q(JSON.stringify(payload))}::jsonb`,
                    "1",
                    q(randomUUID()),
                    q(organisation),
                    "null",
                ],
                "aal1",
            );
            const originalQuote = (await rpc(original, "job_offers")).find(
                (row) => row.id === job,
            );
            assert.ok(
                originalQuote,
                "Original actor must receive its own role-priced quote",
            );
            const accepted = await rpc(original, "claim_job", [
                q(job),
                q(randomUUID()),
                String(originalQuote.terms_version),
            ]);
            assert.equal(accepted.status, "confirmed");
            const claim = accepted.claim_id;
            const participantRoom = await rpc(
                admin,
                "create_chat_group",
                [
                    q("Fictional participant room"),
                    `array[${q(original)}]::uuid[]`,
                    q("participant_course"),
                    q(job),
                ],
                "aal1",
            );
            const rooms = JSON.parse(
                await sql(
                    `select jsonb_agg(jsonb_build_object('id',id,'kind',kind) order by kind) from public.chat_rooms where (job_id=${q(job)} and kind='lecturer_course') or id=${q(participantRoom)}`,
                ),
            );
            assert.deepEqual(
                rooms.map((room) => room.kind),
                ["lecturer_course", "participant_course"],
            );
            const marketOffer = await rpc(original, "request_replacement", [
                q(claim),
                q("Fictional marketplace replacement request"),
                q("open"),
                "'{}'::uuid[]",
                "false",
                q(randomUUID()),
            ]);
            const directedOffer = await rpc(original, "propose_job_substitution", [
                q(claim),
                q(directedLecturer),
                q("Fictional directed replacement request"),
                q(randomUUID()),
            ]);
            const market = (
                await rpc(marketLecturer, "replacement_marketplace")
            ).find((row) => row.id === marketOffer);
            const directed = (await rpc(directedLecturer, "job_substitutions")).find(
                (row) => row.id === directedOffer,
            );
            assert.ok(market?.can_claim && market.quote);
            assert.ok(directed?.can_accept && directed.quote_hash && directed.quote);
            // Deliberately different individual rates prove preserving history does
            // not force the old lecturer's net onto a different recipient quote.
            assert.notEqual(
                Number(market.quote.total_amount),
                Number(directed.quote.total_amount),
            );
            const originalAccepted = JSON.parse(
                await sql(
                    `select to_jsonb(c) from public.job_claims c where id=${q(claim)}`,
                ),
            );
            const originalLedger = await sql(
                `select to_jsonb(l) from private.claim_revenue_ledger l where claim_id=${q(claim)}`,
            );
            const sessions = await sql(
                `select jsonb_agg(jsonb_build_array(starts_at,ends_at) order by starts_at,ends_at) from public.assignment_sessions where claim_id=${q(claim)}`,
            );
            return {
                job,
                claim,
                rooms,
                marketOffer,
                directedOffer,
                market,
                directed,
                originalAccepted,
                originalLedger,
                sessions,
            };
        };

        for (const winner of ["market", "directed"]) {
            const f = await make(),
                marketKey = randomUUID(),
                directedKey = randomUUID();
            const prefix = `cross_${randomUUID().replaceAll("-", "")}`;
            const names = {
                barrier: `${prefix}_barrier`,
                market: `${prefix}_market`,
                directed: `${prefix}_directed`,
            };
            const loser = winner === "market" ? "directed" : "market";
            const call = {
                market: (named = false) =>
                    rpc(
                        marketLecturer,
                        "claim_replacement",
                        [
                            q(f.marketOffer),
                            String(f.market.version),
                            String(f.market.quote.terms_version),
                            q(marketKey),
                        ],
                        "aal1",
                        named ? names.market : undefined,
                    ),
                directed: (named = false) =>
                    rpc(
                        directedLecturer,
                        "respond_job_substitution",
                        [
                            q(f.directedOffer),
                            q("accept"),
                            q(f.directed.quote_hash),
                            q(directedKey),
                            "true",
                        ],
                        "aal1",
                        named ? names.directed : undefined,
                    ),
            };
            const barrier = await holdJob(f.job, names.barrier);
            const pending = [];
            let result;
            try {
                const first = call[winner](true);
                first.catch(() => {
                });
                pending.push(first);
                await observe(
                    `select exists(select 1 from pg_stat_activity w join pg_stat_activity b on b.pid=any(pg_blocking_pids(w.pid)) where w.datname=current_database() and w.application_name=${q(names[winner])} and b.application_name=${q(names.barrier)} and w.wait_event_type='Lock')`,
                    `${winner} RPC must hold its real lecturer locks and wait on the named job barrier`,
                );
                const second = call[loser](true);
                second.catch(() => {
                });
                pending.push(second);
                await observe(
                    `select exists(select 1 from pg_stat_activity l join pg_stat_activity w on w.pid=any(pg_blocking_pids(l.pid)) where l.datname=current_database() and l.application_name=${q(names[loser])} and w.application_name=${q(names[winner])} and l.wait_event_type='Lock' and l.wait_event='advisory')`,
                    `${loser} RPC must wait on the exact winning RPC PID's lecturer advisory lock`,
                );
                barrier.release();
                const [won, lost] = await Promise.all(pending);
                assert.equal(won.status, "confirmed");
                assert.equal(lost.status, "unavailable");
                result = won;
            } finally {
                // The normal commit and failure rollback are both read-only barriers.
                // Terminate only these explicitly named, disposable database sessions if
                // an assertion fails; never leave hanging transactions for fixture drop.
                barrier.release();
                await barrier.completion.catch(() => {
                });
                await sql(
                    `select pg_terminate_backend(pid) from pg_stat_activity where datname=current_database() and application_name in(${q(names.market)},${q(names.directed)}) and pid<>pg_backend_pid()`,
                );
                await Promise.allSettled(pending);
            }

            const recipient = winner === "market" ? marketLecturer : directedLecturer;
            const quote = f[winner].quote;
            assert.equal(
                await sql(
                    `select count(*) from public.job_claims where job_id=${q(f.job)} and status='confirmed'`,
                ),
                "1",
            );
            assert.equal(
                await sql(
                    `select lecturer_id from public.job_claims where id=${q(result.claim_id)} and job_id=${q(f.job)} and status='confirmed'`,
                ),
                recipient,
            );
            assert.equal(
                await sql(
                    `select count(*) from public.assignment_sessions where claim_id=${q(f.claim)} and released_at is null`,
                ),
                "0",
            );
            assert.equal(
                await sql(
                    `select count(*) from public.assignment_sessions where claim_id=${q(result.claim_id)} and released_at is null`,
                ),
                "2",
            );
            assert.equal(
                await sql(
                    `select jsonb_agg(jsonb_build_array(starts_at,ends_at) order by starts_at,ends_at) from public.assignment_sessions where claim_id=${q(result.claim_id)} and released_at is null`,
                ),
                f.sessions,
            );
            assert.deepEqual(
                JSON.parse(
                    await sql(
                        `select to_jsonb(c) from public.job_claims c where id=${q(f.claim)}`,
                    ),
                ),
                {...f.originalAccepted, status: "cancelled"},
            );
            assert.equal(
                await sql(
                    `select to_jsonb(l) from private.claim_revenue_ledger l where claim_id=${q(f.claim)}`,
                ),
                f.originalLedger,
            );
            assert.equal(
                await sql(
                    `select exists(select 1 from public.job_claims c join private.claim_revenue_ledger n on n.claim_id=c.id join private.claim_revenue_ledger old on old.claim_id=${q(f.claim)} where c.id=${q(result.claim_id)} and c.amount=${q(quote.amount)}::numeric and c.total_amount=${q(quote.total_amount)}::numeric and c.currency=${q(quote.currency)} and c.terms=${q(quote.terms)} and row(n.organisation_id,n.gross_amount,n.gross_total_amount,n.currency) is not distinct from row(old.organisation_id,old.gross_amount,old.gross_total_amount,old.currency) and n.lecturer_net_amount=c.amount and n.lecturer_net_total_amount=c.total_amount and n.platform_total_amount=n.gross_total_amount-n.lecturer_net_total_amount)`,
                ),
                "t",
                "Actual recipient quote/revenue must match without rewriting the original customer snapshot",
            );
            for (const room of f.rooms) {
                assert.equal(
                    await sql(
                        `select exists(select 1 from public.chat_members where room_id=${q(room.id)} and user_id=${q(recipient)} and removed_at is null)`,
                    ),
                    "t",
                    `${room.kind}: successor receives membership`,
                );
                assert.equal(
                    await sql(
                        `select exists(select 1 from public.chat_members where room_id=${q(room.id)} and user_id=${q(original)} and removed_at is null)`,
                    ),
                    room.kind === "participant_course" ? "t" : "f",
                    `${room.kind}: explicit participant-room membership is retained`,
                );
                assert.equal(
                    await sql(
                        `select exists(select 1 from public.chat_members where room_id=${q(room.id)} and user_id=${q(loser === "market" ? marketLecturer : directedLecturer)} and removed_at is null)`,
                    ),
                    "f",
                    `${room.kind}: losing candidate gets no membership`,
                );
            }
            // Check the public permission-filtered room projection as well as owner
            // inspection of membership rows; table state alone cannot prove access.
            const visibleRooms = async (who) =>
                JSON.parse(
                    await actor(
                        who,
                        "select coalesce(jsonb_agg(r.id),'[]'::jsonb) from public.chat_rooms_list() r",
                    ),
                );
            const successorRooms = await visibleRooms(recipient);
            const originalRooms = await visibleRooms(original);
            const losingRooms = await visibleRooms(
                loser === "market" ? marketLecturer : directedLecturer,
            );
            for (const room of f.rooms) {
                assert.ok(
                    successorRooms.includes(room.id),
                    `${room.kind}: public projection grants the successor`,
                );
                assert.equal(
                    originalRooms.includes(room.id),
                    room.kind === "participant_course",
                    `${room.kind}: public projection retains only explicit membership`,
                );
                assert.equal(
                    losingRooms.includes(room.id),
                    false,
                    `${room.kind}: public projection excludes the loser`,
                );
            }
            assert.equal(
                await sql(
                    `select status from private.replacement_offers where id=${q(f.marketOffer)}`,
                ),
                winner === "market" ? "completed" : "cancelled",
            );
            assert.equal(
                await sql(
                    `select status from private.job_substitutions where id=${q(f.directedOffer)}`,
                ),
                winner === "directed" ? "accepted" : "superseded",
            );
            assert.equal(
                await sql(
                    `select (select count(*) from private.replacement_offers where original_claim_id=${q(f.claim)} and status='open')+(select count(*) from private.job_substitutions where original_claim_id=${q(f.claim)} and status in('pending','accepting'))`,
                ),
                "0",
            );
            const liveReceipt = await call[winner]();
            assert.equal(liveReceipt.status, "confirmed");
            assert.equal(liveReceipt.claim_id, result.claim_id);
            assert.equal((await call[loser]()).status, "unavailable");
            const history = await sql(
                `select jsonb_build_object('market',(select to_jsonb(o) from private.replacement_offers o where id=${q(f.marketOffer)}),'directed',(select to_jsonb(s) from private.job_substitutions s where id=${q(f.directedOffer)}),'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by actor_id,request_id),'[]'::jsonb) from private.replacement_requests r where request_id in(${q(marketKey)},${q(directedKey)})))`,
            );
            await rpc(recipient, "cancel_job_assignment", [
                q(result.claim_id),
                q("Fictional explicit later cancellation"),
                q(randomUUID()),
            ]);
            const participant = f.rooms.find(
                (room) => room.kind === "participant_course",
            );
            assert.ok(participant);
            assert.equal(
                await sql(
                    `select exists(select 1 from public.chat_members where room_id=${q(participant.id)} and user_id=${q(recipient)} and removed_at is null)`,
                ),
                "f",
                "Cancellation removes the successor's assignment-only participant access",
            );
            assert.equal(
                await sql(
                    `select exists(select 1 from public.chat_members where room_id=${q(participant.id)} and user_id=${q(original)} and removed_at is null)`,
                ),
                "t",
                "Original explicitly invited member remains",
            );
            const replay = await call[winner]();
            assert.equal(
                replay.status,
                "cancelled",
                "Historical handover receipt must report its current cancelled allocation",
            );
            assert.equal(replay.claim_id, result.claim_id);
            assert.equal((await call[loser]()).status, "unavailable");
            assert.equal(
                await sql(
                    `select count(*) from public.job_claims where job_id=${q(f.job)} and status='confirmed'`,
                ),
                "0",
            );
            assert.equal(
                await sql(
                    `select jsonb_build_object('market',(select to_jsonb(o) from private.replacement_offers o where id=${q(f.marketOffer)}),'directed',(select to_jsonb(s) from private.job_substitutions s where id=${q(f.directedOffer)}),'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by actor_id,request_id),'[]'::jsonb) from private.replacement_requests r where request_id in(${q(marketKey)},${q(directedKey)})))`,
                ),
                history,
                "Retry responses must not rewrite terminal offer/receipt history or resurrect confirmation",
            );
            assert.equal(
                await sql(
                    `select to_jsonb(l) from private.claim_revenue_ledger l where claim_id=${q(f.claim)}`,
                ),
                f.originalLedger,
            );
            console.log(
                `PASS real cross-RPC ${winner}-first observed-lock race: unique successor, immutable pricing, both chats, terminal offers, current historical receipt`,
            );
        }
    },
);
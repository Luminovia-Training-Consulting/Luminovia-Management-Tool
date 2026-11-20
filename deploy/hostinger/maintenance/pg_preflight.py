# Probe a same-major PostgreSQL image against a private copy of the stopped cluster. Expose no candidate network ports and never mount active original data into the candidate.
"""Validate a same-major engine against a private, stopped-cluster copy.

The active source cluster is never mounted into the candidate. This hook runs
only while the caller holds the maintenance lock, has stopped the API writers,
and has created its fresh complete update backup. No network ports are opened.
See https://www.postgresql.org/docs/17/backup-file.html.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import shutil
import tempfile
import time
import uuid
from pathlib import Path

IMAGE = re.compile(r"supabase/postgres:17\.[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}\Z")
DB = "luminovia-supabase-db-1"
LABEL = "org.luminovia.postgres-preflight"
SCHEMAS = "n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%'"


class PreflightError(Exception):
    pass


# Accept only an immutable PostgreSQL 17 pin; another major requires a separate migration.
def validate_image(image):
    if not isinstance(image, str) or not IMAGE.fullmatch(image):
        raise PreflightError("postgres_major_or_unpinned_image_requires_migration")


# Reject external tablespaces, symlinks and special files before copying the cluster.
def assert_plain_tree(path):
    path = Path(path)
    if path.is_symlink() or not path.is_dir() or any(p.is_symlink() for p in path.parents):
        raise PreflightError("unsafe_postgres_source_directory")
    for entry in path.rglob("*"):
        if entry.is_symlink() or not (entry.is_file() or entry.is_dir()):
            raise PreflightError("postgres_external_tablespace_or_special_file_requires_review")


# Build server-side summaries, hashing row contents, role passwords and definitions for comparison rather than returning their raw values.
def fingerprint_sql():
    # Row values, role password hashes and definitions remain in the server-side
    # aggregate; only their digests leave PostgreSQL. Physical OIDs are retained.
    return """
BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL extra_float_digits=3;
CREATE TEMP TABLE cms_preflight_fingerprints(name text, rows bigint, hash text) ON COMMIT DROP;
DO $check$ DECLARE r record; v_count bigint; v_hash text; BEGIN
  FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p') AND """ + SCHEMAS + """ ORDER BY 1,2 LOOP
    EXECUTE format('SELECT count(*),coalesce(md5(string_agg(h,%L ORDER BY h)),md5(%L)) FROM (SELECT md5(row_to_json(t)::text) h FROM %I.%I t) s','','',r.nspname,r.relname) INTO v_count,v_hash;
    INSERT INTO cms_preflight_fingerprints VALUES(r.nspname||'.'||r.relname,v_count,v_hash);
  END LOOP;
END $check$;
SELECT json_build_object(
 'tables',(SELECT json_agg(t ORDER BY name) FROM cms_preflight_fingerprints t),
 'roles',(SELECT md5(coalesce(json_agg(t ORDER BY rolname)::text,'')) FROM
   (SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolconnlimit,rolpassword,rolvaliduntil,rolbypassrls FROM pg_authid WHERE rolname NOT LIKE 'pg_%') t),
 'roleSettings',(SELECT md5(coalesce(json_agg(t ORDER BY setdatabase,setrole)::text,'')) FROM (SELECT * FROM pg_db_role_setting) t),
 'memberships',(SELECT md5(coalesce(json_agg(t ORDER BY roleid,member,grantor)::text,'')) FROM (SELECT * FROM pg_auth_members) t),
 'policies',(SELECT md5(coalesce(json_agg(t ORDER BY schemaname,tablename,policyname)::text,'')) FROM (SELECT * FROM pg_policies) t),
 'functions',(SELECT md5(coalesce(json_agg(t ORDER BY schema,name,args)::text,'')) FROM
   (SELECT n.nspname schema,p.proname name,pg_get_function_identity_arguments(p.oid) args,pg_get_functiondef(p.oid) definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind IN ('f','p') AND """ + SCHEMAS + """) t)
)::text;
COMMIT;
"""


# Hash the canonically ordered check object for the result witness.
def canonical(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


# Probe an owned networkless cluster copy after quiescence and a fresh backup; resume the old database before starting the candidate.
def run_preflight(updater, tree, candidate_image):
    validate_image(candidate_image)
    root = Path(updater.root).resolve()
    maintenance = root / "www/maintenance.enabled"
    if not maintenance.is_file():
        raise PreflightError("postgres_preflight_requires_maintenance")
    for service in ("auth", "rest", "realtime", "storage", "api-gw", "functions"):
        running = updater.command(["docker", "inspect", "--format", "{{.State.Running}}", "luminovia-supabase-" + service + "-1"]).decode().strip()
        if running != "false":
            raise PreflightError("postgres_preflight_requires_stopped_writers")
    backup = Path(updater.state.get("lastBackup", ""))
    if not backup.is_relative_to(root / "private/update-backups") or not (backup / "manifest.json").is_file():
        raise PreflightError("postgres_preflight_requires_fresh_update_backup")
    metadata = json.loads((backup / "manifest.json").read_text())
    stamp = dt.datetime.fromisoformat(metadata.get("createdAt", ""))
    if metadata.get("status") != "complete" or stamp.tzinfo is None or not 0 <= (dt.datetime.now(dt.timezone.utc) - stamp).total_seconds() < 1200:
        raise PreflightError("postgres_preflight_requires_fresh_update_backup")

    mounts = json.loads(updater.command(["docker", "inspect", "--format", "{{json .Mounts}}", DB]))
    by_destination = {row["Destination"]: row for row in mounts}
    data = Path(by_destination["/var/lib/postgresql/data"]["Source"])
    config = Path(by_destination["/etc/postgresql-custom"]["Source"])
    if data.resolve() != root / "data/postgres":
        raise PreflightError("unexpected_postgres_data_directory")
    assert_plain_tree(data)
    assert_plain_tree(config)
    size = sum(p.stat().st_size for p in data.rglob("*") if p.is_file())
    if size > 1024 ** 3:
        raise PreflightError("postgres_preflight_development_size_limit")
    if shutil.disk_usage(root).free < 2 * size + 2 * 1024 ** 3:
        raise PreflightError("insufficient_space_for_postgres_preflight")

    databases = json.loads(updater.sql("SELECT json_agg(datname ORDER BY datname)::text FROM pg_database WHERE datallowconn;", user="supabase_admin"))
    if not databases or any(not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,62}", name) for name in databases):
        raise PreflightError("unsupported_postgres_database_name")
    baseline = {name: json.loads(updater.sql(fingerprint_sql(), database=name, user="supabase_admin")) for name in databases}
    settings = json.loads(updater.compose("backend", ["config", "--format", "json"], tree=tree))["services"]["db"]
    if settings["image"] != candidate_image:
        raise PreflightError("postgres_candidate_configuration_mismatch")
    environment = settings["environment"]
    if any(not re.fullmatch(r"[A-Z_][A-Z0-9_]*", key) or "\n" in str(value) or "\r" in str(value) for key, value in environment.items()):
        raise PreflightError("unsafe_postgres_candidate_environment")

    private = root / "private/postgres-preflight"
    private.mkdir(mode=0o700, parents=True, exist_ok=True)
    private.chmod(0o700)
    name = "luminovia-pg-preflight-" + uuid.uuid4().hex
    created = False
    old_stopped = False
    temporary = Path(tempfile.mkdtemp(prefix="candidate-", dir=private))
    try:
        clone_data, clone_config = temporary / "data", temporary / "config"
        clone_data.mkdir(mode=0o700);
        clone_config.mkdir(mode=0o700)
        try:
            old_stopped = True
            updater.compose("backend", ["stop", "db"])
            updater.command(["cp", "-a", "--reflink=auto", str(data) + "/.", str(clone_data)], timeout=600)
            updater.command(["cp", "-a", "--reflink=auto", str(config) + "/.", str(clone_config)], timeout=120)
        finally:
            updater.compose("backend", ["up", "-d", "--wait", "db"])
            old_stopped = False

        env_file = temporary / "candidate.env"
        fd = os.open(env_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as stream:
            stream.write("".join(key + "=" + str(value) + "\n" for key, value in environment.items()))
        updater.command(["docker", "create", "--name", name, "--label", LABEL + "=" + name,
                         "--network", "none", "--log-driver", "none", "--memory", "384m", "--pids-limit", "256",
                         "--security-opt", "no-new-privileges:true", "--env-file", str(env_file),
                         "--mount", "type=bind,source=" + str(clone_data) + ",target=/var/lib/postgresql/data",
                         "--mount", "type=bind,source=" + str(clone_config) + ",target=/etc/postgresql-custom",
                         candidate_image, *settings.get("command", [])], timeout=120)
        created = True
        updater.command(["docker", "start", name])
        ready = False
        for _ in range(120):
            try:
                updater.command(["docker", "exec", name, "pg_isready", "-U", "postgres"], timeout=5)
                ready = True
                break
            except Exception:
                time.sleep(1)
        if not ready:
            raise PreflightError("postgres_candidate_not_ready")

        # Query only the owned candidate container with a timeout and ON_ERROR_STOP.
        def sql(query, database="postgres"):
            raw = updater.command(["docker", "exec", "-i", name, "psql", "-U", "supabase_admin", "-d", database,
                                   "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], data=query.encode(), timeout=120).decode().strip()
            return raw

        version = sql("SHOW server_version_num;")
        if not version.isdigit() or int(version) // 10000 != 17:
            raise PreflightError("postgres_candidate_wrong_major")
        for database in databases:
            if json.loads(sql(fingerprint_sql(), database)) != baseline[database]:
                raise PreflightError("postgres_candidate_data_or_permissions_changed")
            mismatch = sql("SELECT count(*) FROM pg_collation WHERE collversion IS NOT NULL AND collversion IS DISTINCT FROM pg_collation_actual_version(oid);", database)
            if mismatch != "0":
                raise PreflightError("postgres_collation_migration_requires_review")
        if sql("SELECT count(*) FROM pg_database WHERE datcollversion IS NOT NULL AND datcollversion IS DISTINCT FROM pg_database_collation_actual_version(oid);") != "0":
            raise PreflightError("postgres_collation_migration_requires_review")
        return {"status": "passed", "candidateImage": candidate_image, "major": 17,
                "databasesChecked": len(databases), "baselineDigest": canonical(baseline),
                "dataAndPermissionsExact": True, "network": "none", "sourceClusterNeverMounted": True}
    finally:
        if old_stopped:
            updater.compose("backend", ["up", "-d", "--wait", "db"])
        if created:
            owner = updater.command(["docker", "inspect", "--format", '{{index .Config.Labels "' + LABEL + '"}}', name]).decode().strip()
            if owner != name:
                raise PreflightError("postgres_preflight_cleanup_ownership_mismatch")
            updater.command(["docker", "rm", "--force", name])
        shutil.rmtree(temporary)
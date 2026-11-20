#!/usr/bin/env python3
# Build a synthetic complete backup for native recovery testing. The subclass replaces real installation inventory/path access with owned fixtures.
"""Test fixture only: accepts an owned networkless recovery container, never VPS."""
import argparse
import json
import os
import re
import subprocess
from pathlib import Path

import complete_backup as module
from complete_backup import CompleteBackup, private_dir

parser = argparse.ArgumentParser()
parser.add_argument('--container', required=True)
parser.add_argument('--directory', type=Path, required=True)
parser.add_argument('--age', required=True)
parser.add_argument('--recipient-file', type=Path, required=True)
args = parser.parse_args()
assert re.fullmatch(r'portal-restore-[a-f0-9-]{36}', args.container)
row = json.loads(subprocess.check_output(['docker', 'inspect', args.container]))[0]
assert row['Config']['Labels']['org.luminovia.portal.restore-validation'] == args.container.removeprefix('portal-restore-')
assert row['HostConfig']['NetworkMode'] == 'none' and not row['HostConfig'].get('PortBindings')
private_dir(args.directory)
portal = args.directory / 'fictional-portal'
for name in ['source', 'www', 'control', 'private/backups', 'data/storage', 'data/mailpit', 'postgres-custom', 'caddy-tls']:
    private_dir(portal / name)
fixtures = {'private/selfhost.env': b'FICTIONAL_AUTH_KEY=never-log-this\n', 'data/storage/private-fixture.txt': b'Fictional private object\x00\xff\n', 'data/mailpit/mailpit.db': b'Fictional stopped mail capture', 'postgres-custom/vault-key': b'Fictional encryption key', 'caddy-tls/private.key': b'Fictional TLS key'}
fixtures['private/selfhost.env.notification.env'] = b"PORTAL_NOTIFICATION_MAIL_ENABLED='false'\nPORTAL_NOTIFICATION_SERVICE_KEY='FICTIONAL_SERVICE_KEY'\nPORTAL_NOTIFICATION_SMTP_PASSWORD='FICTIONAL_RELAY_PASSWORD'\n"
for name, data in fixtures.items():
    path = portal / name
    path.write_bytes(data)
    path.chmod(0o600)
(portal / 'www/current').symlink_to('../source')
(portal / 'private/backups/recipient.txt').write_text(args.recipient_file.read_text())
(portal / 'private/backups/recipient.txt').chmod(0o600)
module.DB = args.container
original_run = module.run


# Run the supplied process without a shell and preserve a real failure status.
def command(arguments, **kwargs):
    if arguments[0] in ['dpkg-query', 'apt-mark', 'systemctl']:
        return b'fictional reconstructible inventory\n'
    return original_run(arguments, **kwargs)


module.run = command


# Replace deployment inventories with isolated synthetic recovery sources.
class FixtureBackup(CompleteBackup):
    # Return only the known fixture image; do not inspect a real development container.
    def inspect(self):
        self.containers = [row]
        return row['Config']['Image']

    # Limit backup sources to file trees created for this drill.
    def paths(self):
        return [portal], [], []


result = FixtureBackup(portal, args.directory / 'sets', age=args.age, reserve=0, host_root=args.directory / 'unrelated-host').create()
print(json.dumps({'status': result['status'], 'backup': str(args.directory / 'sets' / result['backup'])}))
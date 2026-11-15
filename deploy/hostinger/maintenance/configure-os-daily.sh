#!/usr/bin/env bash
# Distribution-supported stable updates; no release upgrade or new repository.
set -euo pipefail

if [[ ${1:-} != --apply || $(id -u) != 0 ]]; then
  echo 'Policy: complete backup02:00UTC; official Ubuntu updates03:00UTC; required reboot03:30UTC.'
  echo 'Apply as root with --apply after the complete backup and restore drill pass.'
  exit 0
fi

backup_program=/opt/luminovia-portal/source/deploy/hostinger/backups/complete_backup.py
test -f "$backup_program"
/usr/bin/python3 "$backup_program" --check-fresh --max-age-hours 26

private_root=/opt/luminovia-portal/private/os-updates
install -d -m 0700 "$private_root"
if [[ ! -f "$private_root/automatic-policy.before" ]]; then
  cp /etc/apt/apt.conf.d/52luminovia-automatic-updates "$private_root/automatic-policy.before"
  chmod 0600 "$private_root/automatic-policy.before"
fi

cat > /etc/apt/apt.conf.d/52luminovia-automatic-updates <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
#clear Unattended-Upgrade::Allowed-Origins;
Unattended-Upgrade::Allowed-Origins {
  "${distro_id}:${distro_codename}";
  "${distro_id}:${distro_codename}-security";
  "${distro_id}:${distro_codename}-updates";
};
Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::MinimalSteps "true";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "false";
# The separate03:30 unit shares the deployment/backup lock. An asynchronous
# reboot scheduled by unattended-upgrade could interrupt later maintenance.
Unattended-Upgrade::Automatic-Reboot "false";
EOF
chmod 0644 /etc/apt/apt.conf.d/52luminovia-automatic-updates

install -d -m 0755 /etc/systemd/system/apt-daily-upgrade.service.d
cat > /usr/local/sbin/luminovia-apt-upgrade <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ ! -e /run/luminovia-reboot-pending ]] || exit 0
# ExecStartPre may have waited behind another maintenance task. This read-only
# check does not acquire locks, and now runs under the already-held global lock.
/usr/bin/python3 /opt/luminovia-portal/source/deploy/hostinger/backups/complete_backup.py --check-fresh --max-age-hours 26
# Refresh now instead of relying on the independently randomised list timer.
apt-get update -q -o APT::Update::Error-Mode=any
exec /usr/lib/apt/apt.systemd.daily install
EOF
chmod 0755 /usr/local/sbin/luminovia-apt-upgrade
cat > /etc/systemd/system/apt-daily-upgrade.service.d/luminovia-coordination.conf <<'EOF'
[Service]
# The backup acquires global→application locks itself. Run before apt's flock.
ExecStartPre=/usr/bin/python3 /opt/luminovia-portal/source/deploy/hostinger/backups/complete_backup.py --ensure-fresh --max-age-hours 26
ExecStart=
ExecStart=/usr/bin/flock --wait 1800 /run/lock/luminovia-maintenance.lock /usr/local/sbin/luminovia-apt-upgrade
Nice=10
IOSchedulingClass=idle
CPUWeight=25
EOF

cat > /usr/local/sbin/luminovia-required-reboot <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ -e /run/reboot-required ]] || exit 0
/usr/bin/python3 /opt/luminovia-portal/source/deploy/hostinger/backups/complete_backup.py --check-fresh --max-age-hours 26
umask 077
: > /run/luminovia-reboot-pending
if ! systemctl --no-block reboot; then
  rm -f /run/luminovia-reboot-pending
  exit 1
fi
# Keep the global lock until shutdown stops this unit. The /run marker also
# fences newly queued maintenance and disappears on the next boot.
while :; do sleep 10; done
EOF
chmod 0755 /usr/local/sbin/luminovia-required-reboot
cat > /etc/systemd/system/luminovia-required-reboot.service <<'EOF'
[Unit]
Description=Activate required Ubuntu updates in the coordinated maintenance window
After=docker.service
Requires=docker.service
ConditionPathExists=/run/reboot-required

[Service]
Type=simple
User=root
UMask=0077
ExecStartPre=/usr/bin/python3 /opt/luminovia-portal/source/deploy/hostinger/backups/complete_backup.py --ensure-fresh --max-age-hours 26
ExecStart=/usr/bin/flock --wait 1800 /run/lock/luminovia-maintenance.lock /usr/local/sbin/luminovia-required-reboot
TimeoutStartSec=45min
TimeoutStopSec=20s
RuntimeMaxSec=45min
NoNewPrivileges=true
EOF
cat > /etc/systemd/system/luminovia-required-reboot.timer <<'EOF'
[Unit]
Description=Daily03:30UTC activation of required updates after a fresh backup

[Timer]
OnCalendar=*-*-* 03:30:00 UTC
RandomizedDelaySec=0
AccuracySec=1min
Persistent=true

[Install]
WantedBy=timers.target
EOF
install -d -m 0755 /etc/systemd/system/apt-daily-upgrade.timer.d
cat > /etc/systemd/system/apt-daily-upgrade.timer.d/luminovia-daily.conf <<'EOF'
[Timer]
OnCalendar=
OnCalendar=*-*-* 03:00:00 UTC
RandomizedDelaySec=0
AccuracySec=1min
Persistent=true
EOF

apt-config dump > "$private_root/effective-apt-policy.log"
apt-get update -o APT::Update::Error-Mode=any > "$private_root/daily-index-validation.log" 2>&1
unattended-upgrade --dry-run > "$private_root/daily-upgrade-dry-run.log" 2>&1
systemctl daemon-reload
# Installing a new persistent reboot timer must not reboot immediately during
# setup. Start its history now; the first activation is the next03:30 window.
install -d -m 0755 /var/lib/systemd/timers
if [[ ! -e /var/lib/systemd/timers/stamp-luminovia-required-reboot.timer ]]; then
  touch /var/lib/systemd/timers/stamp-luminovia-required-reboot.timer
fi
systemd-analyze verify /etc/systemd/system/luminovia-required-reboot.service /etc/systemd/system/luminovia-required-reboot.timer
systemctl enable --now apt-daily.timer apt-daily-upgrade.timer luminovia-required-reboot.timer > "$private_root/daily-timers.log" 2>&1
systemctl restart apt-daily-upgrade.timer
systemctl is-active --quiet apt-daily.timer apt-daily-upgrade.timer luminovia-required-reboot.timer
echo 'Daily official stable Ubuntu updates configured; fresh complete backup required first, required reboots03:30UTC.'

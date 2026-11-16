#!/usr/bin/env bash
# Install official Ubuntu security-update policy for the authorized development instance, retaining repository/service safety checks and shared maintenance locking.
set -euo pipefail
if [[ $(id -u) != 0 ]]; then
  echo "Run this reviewed installer as the VPS administrator." >&2
  exit 1
fi
private_root=/opt/luminovia-portal/private/os-updates
install -d -m 0700 "$private_root"

# The provisioned Ubuntu 26.10 template registered a nonexistent Monarx feed.
# Preserve it; do not disable or reconfigure an installed protection service.
source_path=/etc/apt/sources.list.d/monarx.list
if [[ -f "$source_path" ]] && grep -q 'repository.monarx.com/repository/ubuntu-stonking' "$source_path"; then
  if dpkg-query -W -f='${Status}\n' 'monarx*' 2>/dev/null | grep -q 'install ok installed' || systemctl is-active --quiet monarx-agent.service monarx-protect.service; then
    echo "Existing Monarx protection needs an operator-reviewed repository repair." >&2
    exit 1
  fi
  cp -p "$source_path" "$private_root/monarx.list.before"
  chmod 0600 "$private_root/monarx.list.before"
  mv "$source_path" /etc/apt/sources.list.d/monarx.list.disabled
fi

cat > /etc/apt/apt.conf.d/52luminovia-automatic-updates <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
Unattended-Upgrade::Automatic-Reboot "false";
EOF
chmod 0644 /etc/apt/apt.conf.d/52luminovia-automatic-updates
install -d -m 0755 /etc/systemd/system/apt-daily-upgrade.service.d
cat > /etc/systemd/system/apt-daily-upgrade.service.d/luminovia-coordination.conf <<'EOF'
[Service]
ExecStart=
ExecStart=/usr/bin/flock --wait 1800 /run/lock/luminovia-maintenance.lock /usr/lib/apt/apt.systemd.daily install
EOF
systemctl daemon-reload
apt-get update -o APT::Update::Error-Mode=any > "$private_root/index-update.log" 2>&1
unattended-upgrade --dry-run > "$private_root/security-dry-run.log" 2>&1
systemctl enable --now apt-daily.timer apt-daily-upgrade.timer > "$private_root/timers.log" 2>&1
systemctl is-active --quiet apt-daily.timer apt-daily-upgrade.timer
echo "Official Ubuntu security updates enabled; package-index refresh and dry run passed. Automatic reboot remains disabled."

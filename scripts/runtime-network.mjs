/**
 * Besitzgeprüfte Docker-Netzverwaltung für die lokale Supabase-Laufzeit.
 * Veröffentlichte Dienstports müssen an Loopback gebunden bleiben; fremde Netze werden nicht verändert.
 */
import { command } from "./runtime-lib.mjs";

const ownerLabel = "org.luminovia.portal";
const purposeLabel = "org.luminovia.portal.network";
const bindingOption = "com.docker.network.bridge.host_binding_ipv4";

/** Leitet den Netzwerknamen ausschließlich aus einer begrenzten sicheren Projektkennung ab. */
export function networkName(project) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(project ?? ""))
    throw new Error(
      "A safe local project ID is required for the Docker network.",
    );
  return `portal_network_${project}`;
}

/** Prüft Besitzlabels, Bridge-Treiber und ausschließliches Loopback-Binding vor jeder Netzänderung. */
export function assertNetworkDefinition(network, project) {
  if (
    network.Name !== networkName(project) ||
    network.Labels?.[ownerLabel] !== project ||
    network.Labels?.[purposeLabel] !== "loopback-v1"
  )
    throw new Error("Refusing to change an unowned Docker network.");
  if (
    network.Driver !== "bridge" ||
    network.Options?.[bindingOption] !== "127.0.0.1" ||
    network.EnableIPv6
  )
    throw new Error(
      "The owned Docker network must bind published ports to loopback only.",
    );
}

/** Liest das benannte Netz erst nach Abgleich mit dem tatsächlichen Docker-Netzbestand. */
async function inspectNetwork(project) {
  const names = (
    await command("docker", ["network", "ls", "--format", "{{.Name}}"], {
      quiet: true,
    })
  )
    .trim()
    .split("\n");
  if (!names.includes(networkName(project))) return null;
  return JSON.parse(
    await command("docker", ["network", "inspect", networkName(project)], {
      quiet: true,
    }),
  )[0];
}

/** Erzeugt bei Bedarf das eigene Netz und bestätigt anschließend dessen tatsächliche Definition. */
export async function ensureLoopbackNetwork(project) {
  let network = await inspectNetwork(project);
  if (!network) {
    await command(
      "docker",
      [
        "network",
        "create",
        "--driver",
        "bridge",
        "--label",
        `${ownerLabel}=${project}`,
        "--label",
        `${purposeLabel}=loopback-v1`,
        "--opt",
        `${bindingOption}=127.0.0.1`,
        networkName(project),
      ],
      { quiet: true },
    );
    network = await inspectNetwork(project);
  }
  assertNetworkDefinition(network, project);
  return network.Name;
}

/** Entfernt nur ein geprüftes eigenes, vollständig unbenutztes Netz; Container werden nicht abgehängt. */
export async function removeLoopbackNetwork(project) {
  const network = await inspectNetwork(project);
  if (!network) return;
  assertNetworkDefinition(network, project);
  if (Object.keys(network.Containers ?? {}).length)
    throw new Error(
      "The owned Docker network is still in use; no containers were detached.",
    );
  await command("docker", ["network", "rm", network.Name], { quiet: true });
}

/** Ermittelt projektmarkierte Container und liest deren begrenzte Netzwerkinformationen. */
async function projectContainers(project) {
  const ids = (
    await command(
      "docker",
      [
        "ps",
        "--all",
        "--filter",
        `label=com.supabase.cli.project=${project}`,
        "--format",
        "{{.ID}}",
      ],
      { quiet: true },
    )
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  return await Promise.all(ids.map(containerInfo));
}

/** Liest gezielt Netzwerk-/Besitzfelder statt einer vollständigen Inspektion mit möglichen Geheimnissen. */
async function containerInfo(id) {
  // Inspect only networking/ownership fields: a full container inspection includes credentials.
  const format =
    '{"Name":{{json .Name}},"Labels":{{json .Config.Labels}},"Networks":{{json .NetworkSettings.Networks}},"Ports":{{json .NetworkSettings.Ports}},"Running":{{json .State.Running}}}';
  return JSON.parse(
    await command("docker", ["inspect", "--format", format, id], {
      quiet: true,
    }),
  );
}

/** Bestätigt genau ein eigenes Netz und ausschließlich erlaubte Hostbindungen; Scannerports bleiben intern. */
export function assertContainerBindings(
  container,
  project,
  { scanner = false } = {},
) {
  const label = scanner ? ownerLabel : "com.supabase.cli.project";
  if (container.Labels?.[label] !== project)
    throw new Error("Refusing to inspect an unowned local service.");
  const networks = Object.keys(container.Networks ?? {});
  if (networks.length !== 1 || networks[0] !== networkName(project))
    throw new Error(
      `Local service ${container.Name} is outside its owned loopback network.`,
    );
  for (const bindings of Object.values(container.Ports ?? {})) {
    for (const binding of bindings ?? []) {
      if (scanner || !["127.0.0.1", "::1"].includes(binding.HostIp))
        throw new Error(
          `Local service ${container.Name} publishes a port outside loopback.`,
        );
    }
  }
}

/** Erkennt veraltete Netzbindungen als Neustartbedarf, ohne fremde Dienste umzubauen. */
export async function stackNeedsNetworkMigration(project) {
  return (await projectContainers(project)).some((container) => {
    try {
      assertContainerBindings(container, project);
      return false;
    } catch {
      return true;
    }
  });
}

/** Prüft den tatsächlich laufenden Dienstbestand und die geforderten DB-/Gateway-/Edge-/Scannergrenzen. */
export async function verifyLoopbackBindings(
  project,
  { scanner = false, edge = false } = {},
) {
  const network = await inspectNetwork(project);
  if (!network) throw new Error("The owned Docker network is missing.");
  assertNetworkDefinition(network, project);
  const containers = await projectContainers(project);
  for (const container of containers) {
    if (container.Running) assertContainerBindings(container, project);
  }
  for (const service of ["db", "kong", ...(edge ? ["edge_runtime"] : [])]) {
    if (
      !containers.some(
        (container) =>
          container.Running &&
          container.Name === `/supabase_${service}_${project}`,
      )
    )
      throw new Error(`Expected local service ${service} is not running.`);
  }
  if (scanner) {
    const container = await containerInfo(`portal_scanner_${project}`);
    if (!container.Running)
      throw new Error("The internal scanner is not running.");
    assertContainerBindings(container, project, { scanner: true });
  }
}

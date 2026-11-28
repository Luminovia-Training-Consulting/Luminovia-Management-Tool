/**
 * Ownership-checked Docker network management for the local Supabase runtime.
 * Published service ports must remain on loopback; unrelated networks are not changed.
 */
import {createServer} from "node:net";
import {command, localUrl} from "./runtime-lib.mjs";

const ownerLabel = "org.luminovia.portal";
const purposeLabel = "org.luminovia.portal.network";
const bindingOption = "com.docker.network.bridge.host_binding_ipv4";

/** Derives the network name only from a constrained, safe project identifier. */
export function networkName(project) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(project ?? ""))
        throw new Error(
            "A safe local project ID is required for the Docker network.",
        );
    return `portal_network_${project}`;
}

const otherCheckoutHelp = "If another Luminovia checkout is running, run ./portal stop in that checkout, then retry here. Use ./portal github for a separate preview.";

export async function assertLocalPortalPortAvailable(site) {
    const port = Number(localUrl(site, "Portal URL").port || 80);
    await new Promise((resolve, reject) => {
        const server = createServer();
        server.once("error", (cause) => {
            const message = cause.code === "EADDRINUSE"
                ? `Local portal port ${port} is already in use. ${otherCheckoutHelp}`
                : `Cannot bind local portal port ${port} (${cause.code ?? "unknown error"}).`;
            reject(Object.assign(new Error(message, {cause}), {code: "PORTAL_BIND_FAILED"}));
        });
        server.listen(port, "127.0.0.1", () => server.close(resolve));
    });
}

/** Detects a fully started local project even if the other checkout uses a different browser port. */
export async function assertNoRunningProject(project) {
    networkName(project);
    const edge = `supabase_edge_runtime_${project}`;
    const running = await command(
        "docker",
        ["ps", "--filter", `name=^/${edge}$`, "--format", "{{.Names}}"],
        {quiet: true, timeoutMs: 10000},
    );
    if (running.trim().split("\n").includes(edge))
        throw Object.assign(
            new Error(`Local project ${project} is already running. ${otherCheckoutHelp}`),
            {code: "PORTAL_PROJECT_RUNNING"},
        );
}

/** Checks ownership labels, bridge driver and loopback-only publishing before changing a network. */
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

/** Inspects the named network only after matching it against Docker's actual network inventory. */
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

/** Creates the owned network when needed and then confirms its actual definition. */
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
            {quiet: true},
        );
        network = await inspectNetwork(project);
    }
    assertNetworkDefinition(network, project);
    return network.Name;
}

/** Removes only a verified, entirely unused owned network; containers are never detached to force removal. */
export async function removeLoopbackNetwork(project) {
    const network = await inspectNetwork(project);
    if (!network) return;
    assertNetworkDefinition(network, project);
    if (Object.keys(network.Containers ?? {}).length)
        throw new Error(
            "The owned Docker network is still in use; no containers were detached.",
        );
    await command("docker", ["network", "rm", network.Name], {quiet: true});
}

/** Finds project-labelled containers and reads their bounded network metadata. */
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
            {quiet: true},
        )
    )
        .trim()
        .split("\n")
        .filter(Boolean);
    return inspectContainers(ids);
}

/** Reads projected fields for the whole inventory without spawning Docker once per container. */
async function inspectContainers(ids) {
    if (!ids.length) return [];
    // Full container inspection includes credentials. Keep this projection bounded.
    const format =
        '{"Name":{{json .Name}},"Labels":{{json .Config.Labels}},"Networks":{{json .NetworkSettings.Networks}},"Ports":{{json .NetworkSettings.Ports}},"Running":{{json .State.Running}}}';
    const output = await command(
        "docker",
        ["inspect", "--type", "container", "--format", format, "--", ...ids],
        {quiet: true},
    );
    const lines = output.trim().split("\n");
    if (lines.length !== ids.length)
        throw new Error("Incomplete Docker container inspection.");
    return lines.map((line) => JSON.parse(line));
}

/** Requires exactly one owned network and only permitted host bindings; scanner ports stay internal. */
export function assertContainerBindings(
    container,
    project,
    {scanner = false} = {},
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

/** Recognises stale network bindings as requiring restart without rebuilding unrelated services. */
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

/** Checks actual running services and the required database/gateway/Edge/scanner boundaries. */
export async function verifyLoopbackBindings(
    project,
    {scanner = false, edge = false} = {},
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
        const [container] = await inspectContainers([`portal_scanner_${project}`]);
        if (!container.Running)
            throw new Error("The internal scanner is not running.");
        assertContainerBindings(container, project, {scanner: true});
    }
}
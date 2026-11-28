/**
 * Static frontend connection checks using TypeScript syntax and symbols.
 * Inspects routes, local imports, assets, export usage and RPC names without starting the app.
 */
import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {dirname, join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import ts from "typescript";
import editionModules from "./edition-modules.json" with {type: "json"};

const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".css"];
const script = /\.(?:tsx?|jsx?|mjs)$/;
const excluded = /(?:^|\/)test(?:\/|$)|\.(?:test|spec)\.[^.]+$|\.d\.ts$/;

/** Collects files recursively; later filters decide which belong to the frontend graph. */
function filesUnder(directory) {
    return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? filesUnder(path) : [path];
    });
}

/** Resolves relative imports against delivered extensions and index files. */
function localTarget(file, specifier) {
    const target = resolve(dirname(file), specifier);
    return [
        target,
        ...extensions.map((extension) => `${target}${extension}`),
        ...extensions.map((extension) => join(target, `index${extension}`)),
    ].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

/** Reads only statically identifiable JSX attributes; dynamic values are not invented. */
function attribute(node, name) {
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node))
        return null;
    const value = node.attributes.properties.find(
        (item) => ts.isJsxAttribute(item) && item.name.getText() === name,
    );
    if (!value) return null;
    if (!value.initializer) return true;
    if (ts.isStringLiteral(value.initializer)) return value.initializer.text;
    if (
        ts.isJsxExpression(value.initializer) &&
        value.initializer.expression &&
        ts.isStringLiteral(value.initializer.expression)
    )
        return value.initializer.expression.text;
    return null;
}

/**
 * Follows code/type and literal lazy imports from the frontend and Vite entry points.
 * JSX routes, links and assets are checked only when their values are static;
 * this syntax graph does not evaluate routing or execute server/tool entry points.
 */

export function auditFrontend(root) {
    const source = join(root, "src");
    const files = filesUnder(source).filter(
        (file) => script.test(file) && !excluded.test(relative(source, file)),
    );
    // Vite builds the public OpenAPI document from first-party source modules.
    const buildEntry = join(root, "vite.config.ts");
    const entries = [join(source, "main.tsx")];
    if (existsSync(buildEntry)) entries.push(buildEntry);
    const modules = new Map();
    const unresolved = [];
    const links = [];
    const assets = [];
    const rpcNames = new Set();
    const edges = [];
    const routes = new Set(["/"]);
    for (const file of existsSync(buildEntry) ? [...files, buildEntry] : files) {
        const ast = ts.createSourceFile(
            file,
            readFileSync(file, "utf8"),
            ts.ScriptTarget.Latest,
            true,
        );
        const imports = new Set();
        /** Attaches each finding to its actual source position for an inspectable diagnostic. */
        const location = (node) =>
            `${relative(root, file)}:${ast.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
        /** Records relative source connections and reports unresolved references. */
        const registerImport = (node, specifier) => {
            if (Object.hasOwn(editionModules, specifier)) {
                for (const entry of Object.values(editionModules[specifier])) {
                    const target = resolve(root, entry);
                    if (existsSync(target)) imports.add(target);
                    else unresolved.push({source: location(node), specifier: entry});
                }
                return;
            }
            if (!specifier.startsWith(".")) return;
            const target = localTarget(file, specifier);
            if (!target) unresolved.push({source: location(node), specifier});
            else imports.add(target);
        };

        /** Carries the enclosing JSX route path into nested Route declarations. */
        function visit(node, routeBase = "") {
            if (
                ts.isNewExpression(node) &&
                ts.isIdentifier(node.expression) &&
                ["SharedWorker", "Worker"].includes(node.expression.text)
            ) {
                const moduleUrl = node.arguments?.[0];
                if (
                    moduleUrl &&
                    ts.isNewExpression(moduleUrl) &&
                    ts.isIdentifier(moduleUrl.expression) &&
                    moduleUrl.expression.text === "URL"
                ) {
                    const specifier = moduleUrl.arguments?.[0];
                    if (
                        specifier &&
                        (ts.isStringLiteral(specifier) ||
                            ts.isNoSubstitutionTemplateLiteral(specifier))
                    )
                        registerImport(specifier, specifier.text);
                }
            }
            if (
                (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
                node.moduleSpecifier &&
                ts.isStringLiteral(node.moduleSpecifier)
            )
                registerImport(node, node.moduleSpecifier.text);
            if (ts.isCallExpression(node)) {
                const first = node.arguments[0];
                if (
                    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
                    first &&
                    (ts.isStringLiteral(first) ||
                        ts.isNoSubstitutionTemplateLiteral(first))
                )
                    registerImport(node, first.text);
                if (
                    ts.isPropertyAccessExpression(node.expression) &&
                    first &&
                    ts.isStringLiteral(first)
                ) {
                    if (node.expression.name.text === "rpc") rpcNames.add(first.text);
                    if (node.expression.name.text === "invoke")
                        edges.push({source: location(node), name: first.text});
                }
            }
            const opening = ts.isJsxElement(node)
                ? node.openingElement
                : ts.isJsxSelfClosingElement(node)
                    ? node
                    : null;
            let childRouteBase = routeBase;
            if (opening) {
                const tag = opening.tagName.getText();
                const path = attribute(opening, "path");
                if (tag === "Route" && typeof path === "string") {
                    childRouteBase = path.startsWith("/")
                        ? path
                        : `${routeBase}/${path}`.replace(/\/+/g, "/");
                    if (path !== "*") routes.add(childRouteBase);
                }
                if (
                    (tag === "Link" || tag === "NavLink") &&
                    typeof attribute(opening, "to") === "string"
                )
                    links.push({
                        source: location(opening),
                        path: attribute(opening, "to"),
                    });
                const src = attribute(opening, "src");
                if (
                    typeof src === "string" &&
                    src.startsWith("/") &&
                    !src.startsWith("//")
                )
                    assets.push({source: location(opening), path: src});
            }
            ts.forEachChild(node, (child) => visit(child, childRouteBase));
        }

        visit(ast);
        modules.set(file, imports);
    }
    const visited = new Set();

    /** Traverses the module graph with a visited set so import cycles cannot recurse indefinitely. */
    function follow(file) {
        if (visited.has(file)) return;
        visited.add(file);
        for (const dependency of modules.get(file) ?? []) follow(dependency);
    }

    for (const entry of entries) follow(entry);
    const routePatterns = [...routes].map((route) => {
        // React Router's terminal splat includes its base path and descendants.
        // Keep the separator inside the optional group: /preview/* must not match
        // /previewgraphy. Other stars remain escaped literals, not global wildcards.
        const splat = route.endsWith("/*");
        const base = splat ? route.slice(0, -2) : route;
        const pattern = base
            .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
            .replace(/:[^/]+/g, "[^/]+");
        return new RegExp(`^${pattern}${splat ? "(?:/.*)?" : "/?"}$`);
    });
    const invalidLinks = links.filter(({path}) => {
        const pathname = path.split(/[?#]/)[0];
        return (
            pathname.startsWith("/") &&
            !routePatterns.some((pattern) => pattern.test(pathname))
        );
    });
    return {
        modules: files.map((file) => relative(root, file)).sort(),
        unreachable: files
            .filter((file) => !visited.has(file))
            .map((file) => relative(root, file))
            .sort(),
        unresolved,
        routes: [...routes].sort(),
        links,
        invalidLinks,
        missingAssets: assets.filter(
            ({path}) => !existsSync(join(root, "public", path.split(/[?#]/)[0])),
        ),
        rpcNames: [...rpcNames].sort(),
        edgeCalls: edges,
    };
}

/** Builds the compiler program and symbol resolution for actual source references. */
function sourceProgram(root, edition, useBuildEntry = false) {
    const files = filesUnder(join(root, "src")).filter(
        (file) =>
            script.test(file) && !excluded.test(relative(join(root, "src"), file)),
    );
    // The delivered Vite config also calls application code to emit public
    // artifacts, including OpenAPI. Count its uses without adding its own
    // declarations to the frontend inventory.
    const buildEntry = useBuildEntry ? join(root, "vite.config.ts") : null;
    const hasBuildEntry = buildEntry && existsSync(buildEntry);
    const program = ts.createProgram(hasBuildEntry ? [...files, buildEntry] : files, {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        jsx: ts.JsxEmit.ReactJSX,
        skipLibCheck: true,
        allowImportingTsExtensions: true,
        ...(edition && {
            paths: Object.fromEntries(
                Object.entries(editionModules).map(([name, entries]) => [
                    name,
                    [resolve(root, entries[edition])],
                ]),
            ),
        }),
    });
    const checker = program.getTypeChecker();
    const sources = program
        .getSourceFiles()
        .filter((file) => files.includes(file.fileName));
    const buildSource = hasBuildEntry ? program.getSourceFile(buildEntry) : undefined;
    return {checker, sources, buildSource};
}

/** Merge the alternative browser builds without requiring a declaration to be used in both. */
export function scanRuntimeDeclarations(root) {
    const declarations = new Map();
    for (const edition of ["internal", "academy"]) {
        for (const entry of scanEditionDeclarations(root, edition)) {
            const key = entry.file + ":" + entry.line + ":" + entry.name;
            const current = declarations.get(key);
            declarations.set(key, current
                ? {
                    ...entry,
                    local: Math.max(entry.local, current.local),
                    external: Math.max(entry.external, current.external),
                    reachable: entry.reachable || current.reachable,
                }
                : entry);
        }
    }
    return [...declarations.values()].sort(
        (a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name) || a.line - b.line,
    );
}

export function scanRuntimeExports(root) {
    return scanRuntimeDeclarations(root).filter((entry) => entry.exported);
}

function exported(node) {
    return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function functionValue(node) {
    return node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isClassExpression(node));
}

/** Module initializers execute even when nobody consumes their result. Function bodies are deferred. */
function eagerInitializer(node) {
    if (!node || functionValue(node) || ts.isTypeNode(node)) return false;
    if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node)
        || ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)
        || ts.isAwaitExpression(node)) return true;
    return ts.forEachChild(node, (child) => eagerInitializer(child) || undefined) ?? false;
}

function executesOnLoad(node) {
    if (ts.isVariableDeclaration(node)) return eagerInitializer(node.initializer);
    if (!ts.isClassDeclaration(node)) return false;
    return Boolean(
        node.heritageClauses?.some((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
        || node.members.some((member) => ts.isClassStaticBlockDeclaration(member)
            || (member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)
                && eagerInitializer(member.initializer))),
    );
}

function scanEditionDeclarations(root, edition) {
    const {checker, sources, buildSource} = sourceProgram(root, edition, true);
    const bySymbol = new Map();
    const byDeclaration = new Map();
    const roots = new Set();

    function symbol(node) {
        const parent = node.parent;
        let value;
        if (ts.isBindingElement(parent) && ts.isObjectBindingPattern(parent.parent)
            && !parent.dotDotDotToken && node === (parent.propertyName ?? parent.name)) {
            // A binding name has a local symbol. The runtime read also uses
            // the source property, including a named export of a lazy import.
            value = checker.getPropertyOfType(checker.getTypeAtLocation(parent.parent), node.text);
        }
        value ??= ts.isShorthandPropertyAssignment(parent)
            ? checker.getShorthandAssignmentValueSymbol(parent)
            : checker.getSymbolAtLocation(node);
        return value && value.flags & ts.SymbolFlags.Alias
            ? checker.getAliasedSymbol(value)
            : value;
    }

    for (const source of sources) {
        function register(node) {
            const variables = ts.isVariableDeclaration(node) && ts.isVariableStatement(node.parent.parent)
                ? node.parent.parent : undefined;
            const topLevel = (variables ?? node).parent?.kind === ts.SyntaxKind.SourceFile;
            const callable = (ts.isFunctionDeclaration(node) && Boolean(node.body))
                || ts.isClassDeclaration(node)
                || Boolean(variables && functionValue(node.initializer));
            if ((callable || (variables && topLevel)) && node.name && ts.isIdentifier(node.name)) {
                const value = symbol(node.name);
                if (value) {
                    const entry = {
                        name: node.name.text,
                        file: source.fileName,
                        line: source.getLineAndCharacterOfPosition(node.name.getStart(source)).line + 1,
                        node: node.name,
                        exported: topLevel && exported(variables ?? node),
                        callable,
                        local: 0,
                        external: 0,
                        dependencies: new Set(),
                    };
                    bySymbol.set(value, entry);
                    byDeclaration.set(node, entry);
                    if (topLevel && executesOnLoad(node)) roots.add(entry);
                }
            }
            ts.forEachChild(node, register);
        }
        register(source);
    }

    for (const source of buildSource ? [...sources, buildSource] : sources) {
        function visit(node, owner) {
            // A class's extends expression executes, while generic arguments
            // and implements/interface heritage are erased.
            if (ts.isExpressionWithTypeArguments(node) && ts.isHeritageClause(node.parent)
                && node.parent.token === ts.SyntaxKind.ExtendsKeyword
                && (ts.isClassDeclaration(node.parent.parent) || ts.isClassExpression(node.parent.parent))) {
                visit(node.expression, owner);
                return;
            }
            if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)
                || ts.isExportDeclaration(node) || (ts.isExportAssignment(node) && source !== buildSource)
                || ts.isTypeNode(node)) return;
            owner = byDeclaration.get(node) ?? owner;
            let target;
            if (ts.isIdentifier(node)) target = bySymbol.get(symbol(node));
            if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
                && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])
                && ts.isArrowFunction(node.parent) && node.parent.body === node
                && ts.isCallExpression(node.parent.parent)
                && node.parent.parent.arguments[0] === node.parent
                && ts.isIdentifier(node.parent.parent.expression)) {
                // React.lazy loads the module's default export when its loader
                // directly returns import(). A bare import alone does not use it.
                const loader = checker.getSymbolAtLocation(node.parent.parent.expression);
                const reactLazy = loader?.declarations?.some((declaration) =>
                    ts.isImportSpecifier(declaration)
                    && (declaration.propertyName ?? declaration.name).text === "lazy"
                    && declaration.parent.parent.parent.moduleSpecifier.text === "react");
                const module = reactLazy && checker.getSymbolAtLocation(node.arguments[0]);
                if (module) {
                    const exportedDefault = checker.getExportsOfModule(module).find((entry) => entry.name === "default");
                    const value = exportedDefault && exportedDefault.flags & ts.SymbolFlags.Alias
                        ? checker.getAliasedSymbol(exportedDefault) : exportedDefault;
                    target = bySymbol.get(value);
                }
            }
            if (target && target.node !== node) {
                target[target.file === source.fileName ? "local" : "external"]++;
                if (owner) owner.dependencies.add(target);
                else roots.add(target);
            }
            ts.forEachChild(node, (child) => visit(child, owner));
        }
        visit(source);
    }

    // A strongly connected group is still unused when no executable entry
    // reaches it. Mark forward from the roots instead of counting callers.
    const reachable = new Set();
    const pending = [...roots];
    while (pending.length) {
        const entry = pending.pop();
        if (reachable.has(entry)) continue;
        reachable.add(entry);
        pending.push(...entry.dependencies);
    }
    return [...byDeclaration.values()].map((entry) => ({
        name: entry.name,
        file: relative(root, entry.file),
        line: entry.line,
        exported: entry.exported,
        callable: entry.callable,
        local: entry.local,
        external: entry.external,
        reachable: reachable.has(entry),
    }));
}

/** Discover forwarding wrappers by symbols, so renamed imports/new domain helpers
 * cannot silently fall outside the actual database binding check. */

export function scanFrontendRpcReferences(root) {
    const {checker, sources} = sourceProgram(root);
    const calls = [];
    const wrappers = new Map();
    /** Resolves renamed imports to the underlying function or parameter symbol. */
    const symbol = (node) => {
        const value = checker.getSymbolAtLocation(node);
        return value && value.flags & ts.SymbolFlags.Alias
            ? checker.getAliasedSymbol(value)
            : value;
    };

    /** Collects call expressions for the later direct-call and wrapper analysis. */
    function collect(node, source) {
        if (ts.isCallExpression(node)) calls.push({node, source});
        ts.forEachChild(node, (child) => collect(child, source));
    }

    for (const source of sources) collect(source, source);
    /** Recognises a direct call connection from the syntax and symbol contract. */
    const direct = (call) =>
        ts.isPropertyAccessExpression(call.expression) &&
        call.expression.name.text === "rpc";

    /** Finds both the RPC name and the body bound by a direct or forwarding call. */
    function binding(call) {
        if (direct(call)) return {name: call.arguments[0], body: call.arguments[1]};
        const wrapper = wrappers.get(symbol(call.expression));
        if (!wrapper) return null;
        return {
            name: call.arguments[wrapper.index],
            body: wrapper.parameter
                ? call.arguments[wrapper.parameter.index] ?? wrapper.parameter.initializer
                : wrapper.body,
        };
    }

    /** Finds the function context that actually forwards this RPC reference. */
    function forwardingFunction(argument) {
        const target = symbol(argument);
        if (!target || !ts.isIdentifier(argument)) return null;
        for (let parent = argument.parent; parent; parent = parent.parent) {
            if (!ts.isFunctionLike(parent) || !parent.parameters) continue;
            const index = parent.parameters.findIndex(
                (parameter) => symbol(parameter.name) === target,
            );
            if (index < 0) continue;
            const name =
                parent.name ??
                (ts.isVariableDeclaration(parent.parent) ? parent.parent.name : null);
            return name
                ? {symbol: symbol(name), index, owner: parent}
                : null;
        }
        return null;
    }

    // A fixed point includes wrapper-of-wrapper forwarding and arbitrary parameter
    // positions rather than a manually maintained list of helper names.
    let changed = true;
    while (changed) {
        changed = false;
        for (const {node} of calls) {
            const bound = binding(node);
            const forward = bound?.name ? forwardingFunction(bound.name) : null;
            if (forward?.symbol && !wrappers.has(forward.symbol)) {
                const body = bound.body ? forwardingFunction(bound.body) : null;
                wrappers.set(forward.symbol, {
                    index: forward.index,
                    body: bound.body,
                    parameter: body?.owner === forward.owner
                        ? {index: body.index, initializer: body.owner.parameters[body.index].initializer}
                        : null,
                });
                changed = true;
            }
        }
    }

    /** Keep finite payload shapes and leave unbounded keys for runtime verification. */
    function argumentShapes(body) {
        if (!body || body.kind === ts.SyntaxKind.NullKeyword || body.getText() === "undefined")
            return [{required: [], possible: []}];
        const type = checker.getTypeAtLocation(body);
        const choices = type.isUnion() ? type.types : [type];
        return choices.map((choice) => {
            if (!(choice.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) ||
                checker.getIndexInfosOfType(choice).length)
                return null;
            const properties = checker.getPropertiesOfType(choice);
            return {
                required: properties.filter((key) => !(key.flags & ts.SymbolFlags.Optional)).map((key) => key.name).sort(),
                possible: properties.map((key) => key.name).sort(),
            };
        });
    }

    const references = [];
    for (const {node, source} of calls) {
        const bound = binding(node);
        const argument = bound?.name;
        if (!argument || forwardingFunction(argument)) continue;
        const type = checker.getTypeAtLocation(argument);
        const choices = type.isUnion() ? type.types : [type];
        // Follow finite typed dispatch choices without labeling a dynamic string
        // as a real API. The wrapper call site remains the owning source.
        const names = ts.isStringLiteralLike(argument)
            ? [argument.text]
            : choices.every((choice) => choice.isStringLiteral())
                ? choices.map((choice) => choice.value)
                : [];
        for (const name of names)
            references.push({
                name,
                file: relative(root, source.fileName),
                line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                // Several dispatchers derive the name and payload from the same
                // action. A union of names alone cannot pair those branches.
                argumentShapes: names.length === 1 ? argumentShapes(bound.body) : [],
            });
    }
    return references;
}

// Importing this module runs no audit; direct CLI execution prints diagnostics
// and reports broken static connections through the exit status.
if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const report = auditFrontend(root);
    if (process.argv.includes("--exports")) {
        const declarations = scanRuntimeDeclarations(root);
        report.runtimeExports = declarations.filter((entry) => entry.exported);
        report.unusedRuntimeExports = report.runtimeExports.filter((entry) => !entry.reachable);
        report.unreachableFunctions = declarations.filter((entry) => entry.callable && !entry.exported && !entry.reachable);
    }
    console.log(JSON.stringify(report, null, 2));
    if (
        report.unreachable.length ||
        report.unresolved.length ||
        report.invalidLinks.length ||
        report.missingAssets.length ||
        report.unusedRuntimeExports?.length ||
        report.unreachableFunctions?.length
    )
        process.exitCode = 1;
}

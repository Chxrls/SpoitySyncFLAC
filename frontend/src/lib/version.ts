interface ParsedVersion {
    core: number[];
    prerelease: Array<number | string>;
}
const VERSION_IDENTIFIER_PATTERN = /^[0-9A-Za-z-]+$/;
function parseVersion(value: string): ParsedVersion | null {
    let normalized = value.trim().replace(/^v/i, "");
    if (!normalized)
        return null;
    const buildIndex = normalized.indexOf("+");
    if (buildIndex >= 0) {
        const build = normalized.slice(buildIndex + 1);
        if (!build || build.split(".").some((identifier) => !VERSION_IDENTIFIER_PATTERN.test(identifier)))
            return null;
        normalized = normalized.slice(0, buildIndex);
    }
    const prereleaseIndex = normalized.indexOf("-");
    const corePart = prereleaseIndex >= 0 ? normalized.slice(0, prereleaseIndex) : normalized;
    const prereleasePart = prereleaseIndex >= 0 ? normalized.slice(prereleaseIndex + 1) : "";
    const coreIdentifiers = corePart.split(".");
    if (coreIdentifiers.length === 0 || coreIdentifiers.some((identifier) => !/^\d+$/.test(identifier)))
        return null;
    const core = coreIdentifiers.map(Number);
    if (core.some((identifier) => !Number.isSafeInteger(identifier)))
        return null;
    if (prereleaseIndex >= 0 && (!prereleasePart || prereleasePart.split(".").some((identifier) => !VERSION_IDENTIFIER_PATTERN.test(identifier))))
        return null;
    const prerelease = prereleasePart
        ? prereleasePart.split(".").map((identifier) => /^\d+$/.test(identifier) ? Number(identifier) : identifier)
        : [];
    return { core, prerelease };
}
export function isNewerVersion(latestValue: string, currentValue: string): boolean {
    const latest = parseVersion(latestValue);
    const current = parseVersion(currentValue);
    if (!latest || !current)
        return false;
    for (let i = 0; i < Math.max(latest.core.length, current.core.length); i++) {
        const latestIdentifier = latest.core[i] ?? 0;
        const currentIdentifier = current.core[i] ?? 0;
        if (latestIdentifier !== currentIdentifier)
            return latestIdentifier > currentIdentifier;
    }
    if (latest.prerelease.length === 0 || current.prerelease.length === 0)
        return latest.prerelease.length === 0 && current.prerelease.length > 0;
    for (let i = 0; i < Math.max(latest.prerelease.length, current.prerelease.length); i++) {
        const latestIdentifier = latest.prerelease[i];
        const currentIdentifier = current.prerelease[i];
        if (latestIdentifier === undefined)
            return false;
        if (currentIdentifier === undefined)
            return true;
        if (latestIdentifier === currentIdentifier)
            continue;
        const latestIsNumber = typeof latestIdentifier === "number";
        const currentIsNumber = typeof currentIdentifier === "number";
        if (latestIsNumber && currentIsNumber)
            return latestIdentifier > currentIdentifier;
        if (latestIsNumber !== currentIsNumber)
            return !latestIsNumber;
        return latestIdentifier > currentIdentifier;
    }
    return false;
}

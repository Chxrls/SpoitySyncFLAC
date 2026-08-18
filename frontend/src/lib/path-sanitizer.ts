export function sanitizePath(input: string, os: string): string {
    let sanitized = input.trim();
    if (os === "Windows") {
        sanitized = sanitized.replace(/\?/g, "？");
    }
    return sanitized.replace(/[<>:"/\\|*]/g, "_");
}

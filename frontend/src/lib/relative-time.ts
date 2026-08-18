import { t } from "@/i18n";
export function formatRelativeTime(date: Date | string | number): string {
    const now = new Date();
    const target = new Date(date);
    const diffMs = now.getTime() - target.getTime();
    if (diffMs < 0)
        return t("translation.time.justNow");
    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);
    const parts: string[] = [];
    if (years > 0) {
        parts.push(t("translation.time.year", { count: years }));
        const remainingMonths = Math.floor((days % 365) / 30);
        if (remainingMonths > 0) {
            parts.push(t("translation.time.month", { count: remainingMonths }));
        }
    }
    else if (months > 0) {
        parts.push(t("translation.time.month", { count: months }));
        const remainingDays = days % 30;
        if (remainingDays > 0) {
            parts.push(t("translation.time.day", { count: remainingDays }));
        }
    }
    else if (weeks > 0) {
        parts.push(t("translation.time.week", { count: weeks }));
        const remainingDays = days % 7;
        if (remainingDays > 0) {
            parts.push(t("translation.time.day", { count: remainingDays }));
        }
    }
    else if (days > 0) {
        parts.push(t("translation.time.day", { count: days }));
        const remainingHours = hours % 24;
        if (remainingHours > 0) {
            parts.push(t("translation.time.hour", { count: remainingHours }));
        }
    }
    else if (hours > 0) {
        parts.push(t("translation.time.hour", { count: hours }));
        const remainingMinutes = minutes % 60;
        if (remainingMinutes > 0) {
            parts.push(t("translation.time.minute", { count: remainingMinutes }));
        }
    }
    else if (minutes > 0) {
        parts.push(t("translation.time.minute", { count: minutes }));
    }
    else {
        return t("translation.time.justNow");
    }
    return t("translation.time.releasedAgo", { value: parts.slice(0, 2).join(" ") });
}

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import es419 from "@/locales/es-419.json";
import fr from "@/locales/fr.json";
import id from "@/locales/id.json";
import it from "@/locales/it.json";
import nl from "@/locales/nl.json";
import ptBR from "@/locales/pt-BR.json";
import ru from "@/locales/ru.json";
import tr from "@/locales/tr.json";
import vi from "@/locales/vi.json";
export type AppLanguage = "en" | "id" | "nl" | "de" | "es-419" | "fr" | "it" | "pt-BR" | "ru" | "tr" | "vi";
export const APP_LANGUAGES: Array<{
    value: AppLanguage;
    label: string;
    flag: string;
}> = [
    { value: "en", label: "English", flag: "gb" },
    { value: "id", label: "Bahasa Indonesia", flag: "id" },
    { value: "nl", label: "Nederlands", flag: "nl" },
    { value: "de", label: "Deutsch", flag: "de" },
    { value: "es-419", label: "Español (Latinoamérica)", flag: "mx" },
    { value: "fr", label: "Français", flag: "fr" },
    { value: "it", label: "Italiano", flag: "it" },
    { value: "pt-BR", label: "Português (Brasil)", flag: "br" },
    { value: "ru", label: "Русский", flag: "ru" },
    { value: "tr", label: "Türkçe", flag: "tr" },
    { value: "vi", label: "Tiếng Việt", flag: "vn" },
];
export function isAppLanguage(value: unknown): value is AppLanguage {
    return APP_LANGUAGES.some((language) => language.value === value);
}
function flattenMessages(value: unknown, prefix = ""): Array<[
    string,
    string
]> {
    if (typeof value === "string")
        return [[prefix, value]];
    if (!value || typeof value !== "object")
        return [];
    return Object.entries(value).flatMap(([key, child]) => flattenMessages(child, prefix ? `${prefix}.${key}` : key));
}
export const englishMessageKeys = new Map(flattenMessages(en).map(([key, value]) => [value, key]));
const messagePlaceholderPattern = /{{\s*([^{}]+?)\s*}}/g;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const englishMessageTemplates = flattenMessages(en).flatMap(([key, value]) => {
    const matches = [...value.matchAll(messagePlaceholderPattern)];
    if (matches.length === 0 || value.replace(messagePlaceholderPattern, "").replace(/\s/g, "").length < 4) {
        return [];
    }
    let cursor = 0;
    let source = "^";
    const placeholders: string[] = [];
    for (const match of matches) {
        const index = match.index ?? 0;
        source += escapeRegExp(value.slice(cursor, index));
        source += "([\\s\\S]+?)";
        placeholders.push(match[1]);
        cursor = index + match[0].length;
    }
    source += escapeRegExp(value.slice(cursor)) + "$";
    return [{ key, placeholders, pattern: new RegExp(source) }];
});
void i18n.use(initReactI18next).init({
    resources: {
        de: { translation: de },
        en: { translation: en },
        "es-419": { translation: es419 },
        fr: { translation: fr },
        id: { translation: id },
        it: { translation: it },
        nl: { translation: nl },
        "pt-BR": { translation: ptBR },
        ru: { translation: ru },
        tr: { translation: tr },
        vi: { translation: vi },
    },
    lng: "en",
    fallbackLng: "en",
    supportedLngs: APP_LANGUAGES.map((language) => language.value),
    load: "currentOnly",
    interpolation: {
        escapeValue: false,
    },
});
export const t = i18n.t.bind(i18n);
export function translateMessage(message: string): string {
    const key = englishMessageKeys.get(message);
    if (key) {
        return t(key);
    }
    for (const template of englishMessageTemplates) {
        const match = template.pattern.exec(message);
        if (!match) {
            continue;
        }
        const values = Object.fromEntries(template.placeholders.map((placeholder, index) => [placeholder, match[index + 1]]));
        return t(template.key, values);
    }
    return message;
}
export default i18n;

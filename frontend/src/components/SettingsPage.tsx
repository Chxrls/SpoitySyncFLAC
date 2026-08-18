import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputWithContext } from "@/components/ui/input-with-context";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger, } from "@/components/ui/tooltip";
import { FolderOpen, Save, RotateCcw, CircleHelp, ArrowRight, MonitorCog, FolderCog, Router, FolderLock, Plus, Trash2, ExternalLink, PlugZap, Download, Tags, FileSignature, DatabaseBackup, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { getSettings, getSettingsWithDefaults, loadSettings, saveSettings, resetToDefaultSettings, applyThemeMode, applyFont, getFontOptions, parseGoogleFontUrl, loadGoogleFontUrl, loadCustomFonts, saveCustomFonts, TEMPLATE_VARIABLES, DEFAULT_SETTINGS, sanitizeAutoOrder, type Settings as SettingsType, type MetadataTagToggles, type FontFamily, type CustomFontFamily, type ExistingFileCheckMode, } from "@/lib/settings";
import { FormatEditor } from "@/components/FormatEditor";
import { baseColors, getThemesForBaseColor, normalizeThemeName, applyTheme, type BaseColorName } from "@/lib/themes";
import { BackupSettings, RestoreSettings, SelectFolder, OpenConfigFolder, CheckCustomTidalAPI, CheckCustomQobuzAPI } from "../../wailsjs/go/main/App";
import { connectSpotifyAccount, disconnectSpotifyAccount, getSpotifyAuthStatus, getSpotifyRedirectURI, type SpotifyAuthStatus } from "@/lib/spotifyAuth";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { openExternal } from "@/lib/utils";
import { ApiStatusTab } from "./ApiStatusTab";
import { AmazonIcon, QobuzIcon, SonglinkIcon, SongstatsIcon, TidalIcon } from "./PlatformIcons";
import i18n, { APP_LANGUAGES, type AppLanguage } from "@/i18n";
import chatGPTIcon from "@/assets/icons/chatgpt.svg";
import geminiIcon from "@/assets/icons/gemini.png";
interface SettingsPageProps {
    onUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void;
    onResetRequest?: (resetFn: () => void) => void;
}
type CustomTidalApiStatus = "idle" | "checking" | "online" | "offline";
const AUTO_CONVERT_BITRATES: SettingsType["autoConvertBitrate"][] = ["320k", "256k", "192k", "128k"];
const THEME_PREVIEW_DEBOUNCE_MS = 50;
const LYRICS_TRANSLATION_LANGUAGES = [
    { code: "en", labelKey: "translation.sources.english", flag: "gb" },
    { code: "id", labelKey: "translation.sources.indonesian", flag: "id" },
    { code: "ms", labelKey: "translation.sources.malay", flag: "my" },
    { code: "es", labelKey: "translation.sources.spanish", flag: "es" },
    { code: "pt", labelKey: "translation.sources.portuguese", flag: "pt" },
    { code: "fr", labelKey: "translation.sources.french", flag: "fr" },
    { code: "de", labelKey: "translation.sources.german", flag: "de" },
    { code: "it", labelKey: "translation.sources.italian", flag: "it" },
    { code: "nl", labelKey: "translation.sources.dutch", flag: "nl" },
    { code: "pl", labelKey: "translation.sources.polish", flag: "pl" },
    { code: "ro", labelKey: "translation.sources.romanian", flag: "ro" },
    { code: "hu", labelKey: "translation.sources.hungarian", flag: "hu" },
    { code: "cs", labelKey: "translation.sources.czech", flag: "cz" },
    { code: "sv", labelKey: "translation.sources.swedish", flag: "se" },
    { code: "da", labelKey: "translation.sources.danish", flag: "dk" },
    { code: "fi", labelKey: "translation.sources.finnish", flag: "fi" },
    { code: "no", labelKey: "translation.sources.norwegian", flag: "no" },
    { code: "el", labelKey: "translation.sources.greek", flag: "gr" },
    { code: "ru", labelKey: "translation.sources.russian", flag: "ru" },
    { code: "uk", labelKey: "translation.sources.ukrainian", flag: "ua" },
    { code: "tr", labelKey: "translation.sources.turkish", flag: "tr" },
    { code: "ar", labelKey: "translation.sources.arabic", flag: "sa" },
    { code: "he", labelKey: "translation.sources.hebrew", flag: "il" },
    { code: "fa", labelKey: "translation.sources.persian", flag: "ir" },
    { code: "hi", labelKey: "translation.sources.hindi", flag: "in" },
    { code: "bn", labelKey: "translation.sources.bengali", flag: "bd" },
    { code: "ta", labelKey: "translation.sources.tamil", flag: "in" },
    { code: "th", labelKey: "translation.sources.thai", flag: "th" },
    { code: "vi", labelKey: "translation.sources.vietnamese", flag: "vn" },
    { code: "ja", labelKey: "translation.sources.japanese", flag: "jp" },
    { code: "ko", labelKey: "translation.sources.korean", flag: "kr" },
    { code: "zh", labelKey: "translation.sources.chinese", flag: "cn" },
    { code: "tl", labelKey: "translation.sources.tagalog", flag: "ph" },
] as const;
const METADATA_TAG_OPTIONS: Array<{
    key: keyof MetadataTagToggles;
    labelKey: string;
    example: string;
}> = [
    { key: "title", labelKey: "translation.common.title", example: "Golden" },
    { key: "artist", labelKey: "translation.common.artist", example: "HUNTR/X / EJAE / AUDREY NUNA / REI AMI" },
    { key: "album", labelKey: "translation.common.album", example: "KPop Demon Hunters (Soundtrack from the Netflix Film)" },
    { key: "albumArtist", labelKey: "translation.common.albumArtist", example: "KPop Demon Hunters Cast / HUNTR/X / Saja Boys" },
    { key: "date", labelKey: "translation.settings.dateYear", example: "2025-06-20" },
    { key: "trackNumber", labelKey: "translation.settings.trackNumber", example: "4/12" },
    { key: "discNumber", labelKey: "translation.settings.discNumber", example: "1/1" },
    { key: "genre", labelKey: "translation.settings.genre", example: "K-Pop" },
    { key: "composer", labelKey: "translation.settings.composer", example: "EJAE / Mark Sonnenblick / Joong Gyu Kwak" },
    { key: "copyright", labelKey: "translation.common.copyright", example: "© 2025 Visva Records / Republic Records" },
    { key: "label", labelKey: "translation.settings.labelPublisher", example: "K-Pop Demon Hunters" },
    { key: "isrc", labelKey: "literal.common.isrc", example: "QZ8BZ2513510" },
    { key: "upc", labelKey: "literal.common.upc", example: "00602478398346" },
    { key: "comment", labelKey: "translation.settings.comment", example: "https://open.spotify.com/track/1CPZ5BxNNd0n0nF4Orb9JS" },
];
export function SettingsPage({ onUnsavedChangesChange, onResetRequest, }: SettingsPageProps) {
    const { t } = useTranslation();
    const [savedSettings, setSavedSettings] = useState<SettingsType>(getSettings());
    const [tempSettings, setTempSettings] = useState<SettingsType>(savedSettings);
    const [isDark, setIsDark] = useState(document.documentElement.classList.contains("dark"));
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [showMetadataAdvanced, setShowMetadataAdvanced] = useState(false);
    const [showLyricsAdvanced, setShowLyricsAdvanced] = useState(false);
    const [lyricsLanguageSearch, setLyricsLanguageSearch] = useState("");
    const [showBackupDialog, setShowBackupDialog] = useState(false);
    const [backupAction, setBackupAction] = useState<"backup" | "restore" | "open" | null>(null);
    const [showAddFontDialog, setShowAddFontDialog] = useState(false);
    const [showCustomTidalApiDialog, setShowCustomTidalApiDialog] = useState(false);
    const [showCustomQobuzApiDialog, setShowCustomQobuzApiDialog] = useState(false);
    const [addFontUrl, setAddFontUrl] = useState("");
    const [customTidalApiStatus, setCustomTidalApiStatus] = useState<CustomTidalApiStatus>("idle");
    const [customQobuzApiStatus, setCustomQobuzApiStatus] = useState<CustomTidalApiStatus>("idle");
    const [spotifyAuthStatus, setSpotifyAuthStatus] = useState<SpotifyAuthStatus | null>(null);
    const [spotifyConnecting, setSpotifyConnecting] = useState(false);
    const [spotifyRedirectURI, setSpotifyRedirectURI] = useState("");
    const parsedAddFont = parseGoogleFontUrl(addFontUrl);
    const fontOptions = getFontOptions(tempSettings.customFonts);
    const availableThemes = getThemesForBaseColor(tempSettings.baseColor);
    const hasUnsavedChanges = JSON.stringify(savedSettings) !== JSON.stringify(tempSettings);
    const themePreviewTimerRef = useRef<number | null>(null);
    const selectedThemeConfigRef = useRef({
        baseColor: tempSettings.baseColor,
        theme: tempSettings.theme,
    });
    const normalizedLyricsLanguageSearch = lyricsLanguageSearch.trim().toLocaleLowerCase();
    const filteredLyricsTranslationLanguages = normalizedLyricsLanguageSearch
        ? LYRICS_TRANSLATION_LANGUAGES.filter((language) => language.code.includes(normalizedLyricsLanguageSearch)
            || t(language.labelKey).toLocaleLowerCase().includes(normalizedLyricsLanguageSearch))
        : LYRICS_TRANSLATION_LANGUAGES;
    const effectiveDownloader = tempSettings.downloader;
    const effectiveAutoOrder = sanitizeAutoOrder(tempSettings.autoOrder);
    const autoAtmosAvailable = !effectiveAutoOrder.includes("qobuz") &&
        (effectiveAutoOrder.includes("tidal") || effectiveAutoOrder.includes("amazon"));
    const isAtmosSelected = (effectiveDownloader === "tidal" && tempSettings.tidalQuality === "ATMOS") ||
        (effectiveDownloader === "amazon" && tempSettings.amazonQuality === "atmos") ||
        (effectiveDownloader === "auto" && tempSettings.autoQuality === "atmos");
    const cancelThemePreview = useCallback(() => {
        if (themePreviewTimerRef.current !== null) {
            window.clearTimeout(themePreviewTimerRef.current);
            themePreviewTimerRef.current = null;
        }
    }, []);
    const previewThemeConfig = useCallback((themeName: SettingsType["theme"], baseColorName: BaseColorName) => {
        cancelThemePreview();
        themePreviewTimerRef.current = window.setTimeout(() => {
            themePreviewTimerRef.current = null;
            applyTheme(themeName, baseColorName);
        }, THEME_PREVIEW_DEBOUNCE_MS);
    }, [cancelThemePreview]);
    const previewTheme = useCallback((themeName: SettingsType["theme"]) => {
        previewThemeConfig(themeName, selectedThemeConfigRef.current.baseColor);
    }, [previewThemeConfig]);
    const previewBaseColor = useCallback((baseColorName: BaseColorName) => {
        const themeName = normalizeThemeName(selectedThemeConfigRef.current.theme, baseColorName);
        previewThemeConfig(themeName, baseColorName);
    }, [previewThemeConfig]);
    const restoreSelectedTheme = useCallback(() => {
        cancelThemePreview();
        const selectedTheme = selectedThemeConfigRef.current;
        applyTheme(selectedTheme.theme, selectedTheme.baseColor);
    }, [cancelThemePreview]);
    const handleThemeChange = useCallback((themeName: SettingsType["theme"]) => {
        cancelThemePreview();
        const baseColorName = selectedThemeConfigRef.current.baseColor;
        selectedThemeConfigRef.current = { baseColor: baseColorName, theme: themeName };
        applyTheme(themeName, baseColorName);
        setTempSettings((prev) => ({ ...prev, theme: themeName }));
    }, [cancelThemePreview]);
    const handleBaseColorChange = useCallback((baseColorName: BaseColorName) => {
        cancelThemePreview();
        const themeName = normalizeThemeName(selectedThemeConfigRef.current.theme, baseColorName);
        selectedThemeConfigRef.current = { baseColor: baseColorName, theme: themeName };
        applyTheme(themeName, baseColorName);
        setTempSettings((prev) => ({ ...prev, baseColor: baseColorName, theme: themeName }));
    }, [cancelThemePreview]);
    const resetToSaved = useCallback(() => {
        cancelThemePreview();
        const freshSavedSettings = getSettings();
        selectedThemeConfigRef.current = {
            baseColor: freshSavedSettings.baseColor,
            theme: freshSavedSettings.theme,
        };
        flushSync(() => {
            setTempSettings(freshSavedSettings);
            setIsDark(document.documentElement.classList.contains("dark"));
        });
    }, [cancelThemePreview]);
    useEffect(() => {
        selectedThemeConfigRef.current = {
            baseColor: tempSettings.baseColor,
            theme: tempSettings.theme,
        };
    }, [tempSettings.baseColor, tempSettings.theme]);
    useEffect(() => () => {
        cancelThemePreview();
        const persistedSettings = getSettings();
        applyTheme(persistedSettings.theme, persistedSettings.baseColor);
    }, [cancelThemePreview]);
    useEffect(() => {
        if (onResetRequest) {
            onResetRequest(resetToSaved);
        }
    }, [onResetRequest, resetToSaved]);
    useEffect(() => {
        onUnsavedChangesChange?.(hasUnsavedChanges);
    }, [hasUnsavedChanges, onUnsavedChangesChange]);
    useEffect(() => {
        void i18n.changeLanguage(tempSettings.language);
    }, [tempSettings.language]);
    useEffect(() => {
        applyThemeMode(savedSettings.themeMode);
        applyTheme(savedSettings.theme, savedSettings.baseColor);
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        const handleChange = () => {
            if (savedSettings.themeMode === "auto") {
                applyThemeMode("auto");
                applyTheme(savedSettings.theme, savedSettings.baseColor);
            }
        };
        mediaQuery.addEventListener("change", handleChange);
        return () => mediaQuery.removeEventListener("change", handleChange);
    }, [savedSettings.themeMode, savedSettings.baseColor, savedSettings.theme]);
    useEffect(() => {
        applyThemeMode(tempSettings.themeMode);
        applyTheme(tempSettings.theme, tempSettings.baseColor);
        applyFont(tempSettings.fontFamily, tempSettings.customFonts);
        setTimeout(() => {
            setIsDark(document.documentElement.classList.contains("dark"));
        }, 0);
    }, [tempSettings.themeMode, tempSettings.baseColor, tempSettings.theme, tempSettings.fontFamily, tempSettings.customFonts]);
    useEffect(() => {
        if (showAddFontDialog && parsedAddFont) {
            loadGoogleFontUrl(parsedAddFont.url, "spotiflac-add-font-preview");
        }
    }, [showAddFontDialog, parsedAddFont]);
    useEffect(() => {
        const loadDefaults = async () => {
            const currentSettings = getSettings();
            if (!currentSettings.downloadPath) {
                const settingsWithDefaults = await getSettingsWithDefaults();
                setSavedSettings(settingsWithDefaults);
                setTempSettings(settingsWithDefaults);
                await saveSettings(settingsWithDefaults);
            }
        };
        loadDefaults();
    }, []);
    useEffect(() => {
        const syncCustomFonts = async () => {
            const customFonts = await loadCustomFonts();
            setSavedSettings((prev) => ({ ...prev, customFonts }));
            setTempSettings((prev) => ({ ...prev, customFonts }));
        };
        void syncCustomFonts();
    }, []);
    const handleSave = async () => {
        await saveSettings(tempSettings);
        await i18n.changeLanguage(tempSettings.language);
        const persistedSettings = getSettings();
        setSavedSettings(persistedSettings);
        setTempSettings(persistedSettings);
        toast.success(t("translation.settings.settingsSaved"));
        onUnsavedChangesChange?.(false);
    };
    const handleReset = async () => {
        const defaultSettings = await resetToDefaultSettings();
        setTempSettings(defaultSettings);
        setSavedSettings(defaultSettings);
        applyThemeMode(defaultSettings.themeMode);
        applyTheme(defaultSettings.theme, defaultSettings.baseColor);
        applyFont(defaultSettings.fontFamily, defaultSettings.customFonts);
        await i18n.changeLanguage(defaultSettings.language);
        setShowResetConfirm(false);
        toast.success(t("translation.settings.settingsResetDefault"));
    };
    const handleBrowseFolder = async () => {
        try {
            const selectedPath = await SelectFolder(tempSettings.downloadPath || "");
            if (selectedPath && selectedPath.trim() !== "") {
                setTempSettings((prev) => ({ ...prev, downloadPath: selectedPath }));
            }
        }
        catch (error) {
            console.error("Error selecting folder:", error);
            toast.error(t("translation.migrated.SettingsPage.errorSelectingFolder", { value1: error }));
        }
    };
    const handleOpenConfigFolder = async () => {
        setBackupAction("open");
        try {
            await OpenConfigFolder();
        }
        catch (error) {
            toast.error(t("translation.settings.errorOpeningConfigFolderValue1", { value1: error }));
        }
        finally {
            setBackupAction(null);
        }
    };
    const handleBackupSettings = async () => {
        setBackupAction("backup");
        try {
            if (await BackupSettings()) {
                toast.success(t("translation.settings.backupSettingsSuccess"));
            }
        }
        catch (error) {
            toast.error(t("translation.settings.backupSettingsError", { value1: error }));
        }
        finally {
            setBackupAction(null);
        }
    };
    const handleRestoreSettings = async () => {
        setBackupAction("restore");
        try {
            if (!(await RestoreSettings())) {
                return;
            }
            const restoredSettings = await loadSettings();
            await saveSettings(restoredSettings);
            setSavedSettings(restoredSettings);
            setTempSettings(restoredSettings);
            await i18n.changeLanguage(restoredSettings.language);
            applyThemeMode(restoredSettings.themeMode);
            applyTheme(restoredSettings.theme, restoredSettings.baseColor);
            applyFont(restoredSettings.fontFamily, restoredSettings.customFonts);
            setShowBackupDialog(false);
            toast.success(t("translation.settings.restoreSettingsSuccess"));
            onUnsavedChangesChange?.(false);
        }
        catch (error) {
            toast.error(t("translation.settings.restoreSettingsError", { value1: error }));
        }
        finally {
            setBackupAction(null);
        }
    };
    const closeAddFontDialog = () => {
        setShowAddFontDialog(false);
        setAddFontUrl("");
    };
    const handleAddFont = async () => {
        if (!parsedAddFont) {
            toast.error(t("translation.settings.enterValidGoogleFontsUrl2"));
            return;
        }
        const existingFonts = tempSettings.customFonts || [];
        const existingIndex = existingFonts.findIndex((font) => font.value === parsedAddFont.value || font.url === parsedAddFont.url);
        const customFonts = existingIndex >= 0
            ? existingFonts.map((font, index) => index === existingIndex ? parsedAddFont : font)
            : [...existingFonts, parsedAddFont];
        const savedCustomFonts = await saveCustomFonts(customFonts);
        setSavedSettings((prev) => ({ ...prev, customFonts: savedCustomFonts }));
        setTempSettings((prev) => ({
            ...prev,
            customFonts: savedCustomFonts,
            fontFamily: parsedAddFont.value,
        }));
        closeAddFontDialog();
        toast.success(t("translation.migrated.SettingsPage.added", { value1: parsedAddFont.label }));
    };
    const handleDeleteCustomFont = async (fontValue: CustomFontFamily) => {
        const customFonts = (tempSettings.customFonts || []).filter((font) => font.value !== fontValue);
        const savedCustomFonts = await saveCustomFonts(customFonts);
        const shouldResetSavedFont = savedSettings.fontFamily === fontValue;
        const shouldResetTempFont = tempSettings.fontFamily === fontValue;
        const nextSavedSettings: SettingsType = {
            ...savedSettings,
            customFonts: savedCustomFonts,
            fontFamily: shouldResetSavedFont ? "google-sans" : savedSettings.fontFamily,
        };
        setSavedSettings(nextSavedSettings);
        setTempSettings((prev) => ({
            ...prev,
            customFonts: savedCustomFonts,
            fontFamily: shouldResetTempFont ? "google-sans" : prev.fontFamily,
        }));
        if (shouldResetSavedFont) {
            await saveSettings(nextSavedSettings);
        }
        toast.success(t("translation.settings.fontDeleted"));
    };
    const handleTidalQualityChange = async (value: "LOSSLESS" | "HI_RES_LOSSLESS" | "ATMOS") => {
        setTempSettings((prev) => ({ ...prev, tidalQuality: value }));
    };
    const handleQobuzQualityChange = (value: "6" | "7" | "27") => {
        setTempSettings((prev) => ({ ...prev, qobuzQuality: value }));
    };
    const handleAmazonQualityChange = (value: "16" | "24" | "atmos") => {
        setTempSettings((prev) => ({ ...prev, amazonQuality: value }));
    };
    const handleAutoQualityChange = async (value: "16" | "24" | "atmos") => {
        setTempSettings((prev) => ({ ...prev, autoQuality: value }));
    };
    const persistCustomTidalApi = useCallback(async (nextValue: string) => {
        const normalizedValue = nextValue.trim().replace(/\/+$/g, "");
        const persistedSettings = getSettings();
        const nextSavedSettings: SettingsType = {
            ...persistedSettings,
            customTidalApi: normalizedValue,
        };
        await saveSettings(nextSavedSettings);
        const nextSavedState = getSettings();
        setSavedSettings(nextSavedState);
        setTempSettings((prev) => ({
            ...prev,
            customTidalApi: nextSavedState.customTidalApi,
        }));
    }, []);
    const persistCustomQobuzApi = useCallback(async (nextValue: string) => {
        const normalizedValue = nextValue.trim().replace(/\/+$/g, "");
        const persistedSettings = getSettings();
        const nextSavedSettings: SettingsType = {
            ...persistedSettings,
            customQobuzApi: normalizedValue,
        };
        await saveSettings(nextSavedSettings);
        const nextSavedState = getSettings();
        setSavedSettings(nextSavedState);
        setTempSettings((prev) => ({
            ...prev,
            customQobuzApi: nextSavedState.customQobuzApi,
        }));
    }, []);
    const persistSpotifyClientID = useCallback(async (nextValue: string) => {
        const normalizedValue = nextValue.trim();
        const persistedSettings = getSettings();
        const nextSavedSettings: SettingsType = {
            ...persistedSettings,
            spotifyClientID: normalizedValue,
        };
        await saveSettings(nextSavedSettings);
        const nextSavedState = getSettings();
        setSavedSettings(nextSavedState);
        setTempSettings((prev) => ({
            ...prev,
            spotifyClientID: nextSavedState.spotifyClientID,
        }));
    }, []);
    useEffect(() => {
        (async () => {
            try {
                const [status, redirectURI] = await Promise.all([getSpotifyAuthStatus(), getSpotifyRedirectURI()]);
                setSpotifyAuthStatus(status);
                setSpotifyRedirectURI(redirectURI);
            }
            catch (error) {
                console.error("Failed to load Spotify auth status:", error);
            }
        })();
    }, []);
    const handleConnectSpotify = async () => {
        setSpotifyConnecting(true);
        try {
            const status = await connectSpotifyAccount();
            setSpotifyAuthStatus(status);
            if (status.connected) {
                toast.success(t("translation.migrated.SettingsPage.spotifyConnected", { value1: status.display_name || "" }));
            }
        }
        catch (error) {
            console.error("Failed to connect Spotify account:", error);
            toast.error(String(error));
        }
        finally {
            setSpotifyConnecting(false);
        }
    };
    const handleDisconnectSpotify = async () => {
        try {
            await disconnectSpotifyAccount();
        }
        catch (error) {
            console.error("Failed to disconnect Spotify account:", error);
        }
        setSpotifyAuthStatus({ connected: false });
    };
    const handleCheckCustomTidalApi = async () => {
        const normalizedCustomTidalApi = (tempSettings.customTidalApi || "").trim().replace(/\/+$/g, "");
        if (!normalizedCustomTidalApi.startsWith("https://")) {
            toast.error(t("translation.migrated.SettingsPage.enterAValidHTTPSHiFiAPIURL"));
            return;
        }
        setCustomTidalApiStatus("checking");
        try {
            const isOnline = await CheckCustomTidalAPI(normalizedCustomTidalApi);
            setCustomTidalApiStatus(isOnline ? "online" : "offline");
            if (isOnline) {
                toast.success(t("translation.migrated.SettingsPage.hifiAPIInstanceIsOnline"));
            }
            else {
                toast.error(t("translation.migrated.SettingsPage.hifiAPIInstanceIsOffline"));
            }
        }
        catch (error) {
            console.error("Failed to check custom Tidal API:", error);
            setCustomTidalApiStatus("offline");
            toast.error(t("translation.migrated.SettingsPage.failedToCheckHiFiAPIInstance", { value1: error }));
        }
    };
    const handleCheckCustomQobuzApi = async () => {
        const normalizedCustomQobuzApi = (tempSettings.customQobuzApi || "").trim().replace(/\/+$/g, "");
        if (!normalizedCustomQobuzApi.startsWith("https://")) {
            toast.error(t("translation.migrated.SettingsPage.enterAValidHTTPSQobuzDLInstance"));
            return;
        }
        setCustomQobuzApiStatus("checking");
        try {
            const isOnline = await CheckCustomQobuzAPI(normalizedCustomQobuzApi);
            setCustomQobuzApiStatus(isOnline ? "online" : "offline");
            if (isOnline) {
                toast.success(t("translation.migrated.SettingsPage.qobuzDLInstanceIsOnline"));
            }
            else {
                toast.error(t("translation.migrated.SettingsPage.qobuzDLInstanceIsOffline"));
            }
        }
        catch (error) {
            console.error("Failed to check custom Qobuz API:", error);
            setCustomQobuzApiStatus("offline");
            toast.error(t("translation.migrated.SettingsPage.failedToCheckQobuzDLInstance", { value1: error }));
        }
    };
    const [activeTab, setActiveTab] = useState<"general" | "download" | "naming" | "files" | "metadata" | "status">("general");
    return (<div className="space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between shrink-0">
        <h1 className="text-2xl font-bold">{t("translation.common.settings")}</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowResetConfirm(true)} className="gap-1.5">
            <RotateCcw className="h-4 w-4"/>
            {t("translation.common.resetDefault")}
          </Button>
          <Button onClick={handleSave} className="gap-1.5">
            <Save className="h-4 w-4"/>
            {t("translation.common.saveChanges")}
          </Button>
        </div>
      </div>

      <div className="flex gap-2 border-b shrink-0">
        <Button variant={activeTab === "general" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("general")} className="rounded-b-none gap-2">
          <MonitorCog className="h-4 w-4"/>
          {t("translation.settings.general")}
        </Button>
        <Button variant={activeTab === "download" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("download")} className="rounded-b-none gap-2">
          <Download className="h-4 w-4"/>
          {t("translation.trackInfo.download")}
        </Button>
        <Button variant={activeTab === "naming" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("naming")} className="rounded-b-none gap-2">
          <FileSignature className="h-4 w-4"/>
          {t("translation.settings.naming")}
        </Button>
        <Button variant={activeTab === "files" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("files")} className="rounded-b-none gap-2">
          <FolderCog className="h-4 w-4"/>
          {t("translation.settings.fileManagement")}
        </Button>
        <Button variant={activeTab === "metadata" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("metadata")} className="rounded-b-none gap-2">
          <Tags className="h-4 w-4"/>
          {t("translation.common.metadata")}
        </Button>
        <Button variant={activeTab === "status" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("status")} className="rounded-b-none gap-2">
          <Router className="h-4 w-4"/>
          {t("translation.queue.status")}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto pt-4">
        {activeTab === "general" && (<div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
            <div className="space-y-4 md:pr-8 md:border-r border-border">
              <div className="space-y-2">
                <Label htmlFor="language">{t("translation.settings.language")}</Label>
                <Select value={tempSettings.language} onValueChange={(value: AppLanguage) => setTempSettings((prev) => ({ ...prev, language: value }))}>
                  <SelectTrigger id="language">
                    <SelectValue placeholder={t("translation.settings.selectLanguage")}/>
                  </SelectTrigger>
                  <SelectContent>
                    {APP_LANGUAGES.map((language) => (<SelectItem key={language.value} value={language.value}>
                        <span className="flex items-center gap-2">
                          <img src={`/assets/flags/${language.flag}.svg`} alt="" className="h-3.5 w-5 rounded-[2px] object-cover"/>
                          {language.label}
                        </span>
                      </SelectItem>))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-[8rem_8rem] gap-4">
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="theme-mode">{t("translation.settings.mode")}</Label>
                  <Select value={tempSettings.themeMode} onValueChange={(value: "auto" | "light" | "dark") => setTempSettings((prev) => ({ ...prev, themeMode: value }))}>
                    <SelectTrigger id="theme-mode" className="w-full">
                      <SelectValue placeholder={t("translation.settings.selectThemeMode")}/>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">{t("translation.settings.auto")}</SelectItem>
                      <SelectItem value="light">{t("translation.settings.light")}</SelectItem>
                      <SelectItem value="dark">{t("translation.settings.dark")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="min-w-0 space-y-2">
                  <Label htmlFor="base-color">{t("translation.settings.baseColor")}</Label>
                  <Select value={tempSettings.baseColor} onValueChange={(value) => handleBaseColorChange(value as BaseColorName)} onOpenChange={(open) => {
                if (!open) {
                    restoreSelectedTheme();
                }
            }}>
                    <SelectTrigger id="base-color" className="w-full">
                      <SelectValue placeholder={t("translation.settings.selectBaseColor")}/>
                    </SelectTrigger>
                    <SelectContent onMouseLeave={restoreSelectedTheme}>
                      {baseColors.map((baseColor) => (<SelectItem key={baseColor.name} value={baseColor.name} onMouseMove={() => previewBaseColor(baseColor.name)} onFocus={() => previewBaseColor(baseColor.name)}>
                          <span className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full border border-border" style={{
                    backgroundColor: isDark
                        ? baseColor.cssVars.dark["muted-foreground"]
                        : baseColor.cssVars.light["muted-foreground"],
                }}/>
                            {baseColor.label}
                          </span>
                        </SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="theme">{t("translation.settings.theme")}</Label>
                <Select value={tempSettings.theme} onValueChange={(value) => handleThemeChange(value as SettingsType["theme"])} onOpenChange={(open) => {
                if (!open) {
                    restoreSelectedTheme();
                }
            }}>
                  <SelectTrigger id="theme" className="w-32">
                    <SelectValue placeholder={t("translation.settings.selectTheme")}/>
                  </SelectTrigger>
                  <SelectContent onMouseLeave={restoreSelectedTheme}>
                    {availableThemes.map((theme) => (<SelectItem key={theme.name} value={theme.name} onMouseMove={() => previewTheme(theme.name)} onFocus={() => previewTheme(theme.name)}>
                        <span className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full border border-border" style={{
                    backgroundColor: isDark
                        ? theme.cssVars.dark[theme.name === tempSettings.baseColor ? "muted-foreground" : "primary"]
                        : theme.cssVars.light[theme.name === tempSettings.baseColor ? "muted-foreground" : "primary"],
                }}/>
                          {theme.label}
                        </span>
                      </SelectItem>))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="font">{t("translation.settings.font")}</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={tempSettings.fontFamily} onValueChange={(value: FontFamily) => setTempSettings((prev) => ({ ...prev, fontFamily: value }))}>
                    <SelectTrigger id="font" className="max-w-full min-w-40">
                      <SelectValue placeholder={t("translation.settings.selectFont")}/>
                    </SelectTrigger>
                    <SelectContent>
                      {fontOptions.map((font) => {
                const isCustomFont = font.value.startsWith("custom-");
                return (<SelectItem key={font.value} value={font.value} indicatorPosition="inline" trailingAction={isCustomFont ? (<Button type="button" variant="ghost" size="icon" className="h-8 w-8 cursor-pointer text-muted-foreground hover:bg-transparent hover:text-destructive" aria-label={t("translation.migrated.SettingsPage.delete", { value1: font.label })} onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                        }} onPointerUp={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                        }} onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void handleDeleteCustomFont(font.value as CustomFontFamily);
                        }}>
                              <Trash2 className="h-3.5 w-3.5 text-inherit"/>
                            </Button>) : undefined}>
                          <span style={{ fontFamily: font.fontFamily }}>
                            {font.label}
                          </span>
                        </SelectItem>);
            })}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" onClick={() => setShowAddFontDialog(true)} className="shrink-0 gap-1.5">
                    <Plus className="h-4 w-4"/>
                    {t("translation.settings.addFont")}
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Switch id="sfx-enabled" checked={tempSettings.sfxEnabled} onCheckedChange={(checked) => setTempSettings((prev) => ({
                ...prev,
                sfxEnabled: checked,
            }))}/>
                <Label htmlFor="sfx-enabled" className="cursor-pointer text-sm font-normal">
                  {t("translation.settings.soundEffects")}
                </Label>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <Switch id="show-update-notifications" checked={tempSettings.showUpdateNotifications} onCheckedChange={(checked) => setTempSettings((prev) => ({
                ...prev,
                showUpdateNotifications: checked,
            }))}/>
                <Label htmlFor="show-update-notifications" className="cursor-pointer text-sm font-normal">
                  {t("translation.settings.updateNotifications")}
                </Label>
              </div>
            </div>

            <div className="space-y-4 md:pl-8">
              <div className="space-y-2">
                <Label htmlFor="download-path">{t("translation.settings.downloadPath")}</Label>
                <div className="flex gap-2">
                  <InputWithContext id="download-path" value={tempSettings.downloadPath} onChange={(e) => setTempSettings((prev) => ({
                ...prev,
                downloadPath: e.target.value,
            }))} placeholder={t("literal.settings.cUsersYourusernameMusic")}/>
                  <Button type="button" onClick={handleBrowseFolder} className="gap-1.5">
                    <FolderOpen className="h-4 w-4"/>
                    {t("translation.common.browse")}
                  </Button>
                </div>
              </div>

              <div className="space-y-4 pt-2">
                <div className="relative flex min-h-5 items-center gap-3 pr-28">
                  <Switch id="embed-lyrics" checked={tempSettings.embedLyrics} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, embedLyrics: checked }))}/>
                  <Label htmlFor="embed-lyrics" className="cursor-pointer text-sm font-normal">{t("translation.sources.embedLyrics")}</Label>
                  {tempSettings.embedLyrics && (<Button type="button" variant="outline" size="sm" className="absolute right-0 top-1/2 -translate-y-1/2" onClick={() => setShowLyricsAdvanced(true)}>
                    {t("translation.settings.advanced")}
                  </Button>)}
                </div>
                <div className="flex items-center gap-3">
                  <Switch id="embed-max-quality-cover" checked={tempSettings.embedMaxQualityCover} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, embedMaxQualityCover: checked }))}/>
                  <Label htmlFor="embed-max-quality-cover" className="cursor-pointer text-sm font-normal">{t("translation.migrated.SettingsPage.embedMaxQualityCover")}</Label>
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <div className="flex items-center gap-3">
                    <Switch id="embed-genre" checked={tempSettings.embedGenre} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, embedGenre: checked }))}/>
                    <Label htmlFor="embed-genre" className="cursor-pointer text-sm font-normal">{t("translation.migrated.SettingsPage.embedGenre")}</Label>
                  </div>
                  {tempSettings.embedGenre && (<div className="flex items-center gap-3">
                    <Switch id="use-single-genre" checked={tempSettings.useSingleGenre} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, useSingleGenre: checked }))}/>
                    <Label htmlFor="use-single-genre" className="cursor-pointer text-sm font-normal">{t("translation.migrated.SettingsPage.useSingleGenre")}</Label>
                  </div>)}
                </div>
                <div className="flex items-center gap-3">
                  <Switch id="use-first-artist-only" checked={tempSettings.useFirstArtistOnly} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, useFirstArtistOnly: checked }))}/>
                  <Label htmlFor="use-first-artist-only" className="cursor-pointer text-sm font-normal">{t("translation.migrated.SettingsPage.useFirstArtistOnly")}</Label>
                </div>
                {!tempSettings.useFirstArtistOnly && (<div className="space-y-2">
                  <Label className="text-sm">{t("translation.migrated.SettingsPage.artistSeparator")}</Label>
                  <Select value={tempSettings.separator} onValueChange={(value: "comma" | "semicolon") => setTempSettings((prev) => ({ ...prev, separator: value }))}>
                    <SelectTrigger className="h-9 w-fit"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="comma">{t("translation.sources.comma")}</SelectItem>
                      <SelectItem value="semicolon">{t("translation.sources.semicolon")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>)}
                <div className="space-y-2 pt-1">
                  <Label>{t("translation.settings.config")}</Label>
                  <Button type="button" variant="outline" onClick={() => setShowBackupDialog(true)} className="w-fit">
                    {t("translation.settings.backupSettings")}
                  </Button>
                </div>
              </div>
            </div>
          </div>)}

        {activeTab === "download" && (<div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] lg:gap-8 items-start">
            <div className="space-y-4 lg:pr-8 lg:border-r">
              <div className="space-y-2">
                <Label htmlFor="link-resolver">{t("translation.migrated.SettingsPage.linkResolver")}</Label>
                <div className="flex items-center gap-3 flex-wrap">
                  <Select value={tempSettings.linkResolver} onValueChange={(value: "songstats" | "songlink") => setTempSettings((prev) => ({
                ...prev,
                linkResolver: value,
            }))}>
                    <SelectTrigger id="link-resolver" className="h-9 w-fit min-w-35">
                      <SelectValue placeholder={t("translation.migrated.SettingsPage.selectALinkResolver")}/>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="songlink">
                        <span className="flex items-center gap-2">
                          <SonglinkIcon className="h-4 w-4 shrink-0"/>
                          {t("translation.migrated.SettingsPage.songlink")}
                        </span>
                      </SelectItem>
                      <SelectItem value="songstats">
                        <span className="flex items-center gap-2">
                          <SongstatsIcon className="h-4 w-4 shrink-0"/>
                          {t("literal.platformIcons.songstats")}
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Switch id="allow-link-resolver-fallback" checked={tempSettings.allowResolverFallback} onCheckedChange={(checked) => setTempSettings((prev) => ({
                ...prev,
                allowResolverFallback: checked,
            }))}/>
                <Label htmlFor="allow-link-resolver-fallback" className="text-sm font-normal cursor-pointer">
                  {t("translation.migrated.SettingsPage.allowResolverFallback")}
                </Label>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Label className="text-base font-semibold">{t("translation.sources.community")}</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <CircleHelp className="h-3.5 w-3.5 text-muted-foreground cursor-help"/>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p className="text-xs whitespace-nowrap">{t("translation.migrated.SettingsPage.1Track30s")}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="downloader">{t("translation.history.source")}</Label>
                <div className="flex items-center gap-3 flex-wrap lg:flex-nowrap">
                  <Select value={effectiveDownloader} onValueChange={(value: SettingsType["downloader"]) => setTempSettings((prev) => ({
                ...prev,
                downloader: value,
            }))}>
                    <SelectTrigger id="downloader" className="h-9 w-fit">
                      <SelectValue placeholder={t("translation.migrated.SettingsPage.selectASource")}/>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">{t("translation.settings.auto")}</SelectItem>
                      <SelectItem value="tidal">
                        <span className="flex items-center gap-2">
                          <TidalIcon />
                          {t("literal.common.tidal")}
                        </span>
                      </SelectItem>
                      <SelectItem value="qobuz">
                        <span className="flex items-center gap-2">
                          <QobuzIcon />
                          {t("literal.common.qobuz")}
                        </span>
                      </SelectItem>
                      <SelectItem value="amazon">
                        <span className="flex items-center gap-2">
                          <AmazonIcon />
                          {t("literal.common.amazonMusic")}
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>

                  {effectiveDownloader === "auto" && (<>
                      <Select value={effectiveAutoOrder} onValueChange={(value: string) => setTempSettings((prev) => ({
                    ...prev,
                    autoOrder: value,
                    autoQuality: value.includes("qobuz") && prev.autoQuality === "atmos" ? "24" : prev.autoQuality,
                }))}>
                        <SelectTrigger className="h-9 w-auto">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="w-fit min-w-max">
                          <SelectItem value="tidal-qobuz-amazon">
                                <span className="flex items-center gap-1.5">
                                  <TidalIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <QobuzIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <AmazonIcon className="fill-current"/>
                                </span>
                              </SelectItem>
                              <SelectItem value="tidal-amazon-qobuz">
                                <span className="flex items-center gap-1.5">
                                  <TidalIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <AmazonIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <QobuzIcon className="fill-current"/>
                                </span>
                              </SelectItem>
                              <SelectItem value="qobuz-tidal-amazon">
                                <span className="flex items-center gap-1.5">
                                  <QobuzIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <TidalIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <AmazonIcon className="fill-current"/>
                                </span>
                              </SelectItem>
                              <SelectItem value="qobuz-amazon-tidal">
                                <span className="flex items-center gap-1.5">
                                  <QobuzIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <AmazonIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <TidalIcon className="fill-current"/>
                                </span>
                              </SelectItem>
                              <SelectItem value="amazon-tidal-qobuz">
                                <span className="flex items-center gap-1.5">
                                  <AmazonIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <TidalIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <QobuzIcon className="fill-current"/>
                                </span>
                              </SelectItem>
                              <SelectItem value="amazon-qobuz-tidal">
                                <span className="flex items-center gap-1.5">
                                  <AmazonIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <QobuzIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <TidalIcon className="fill-current"/>
                                </span>
                              </SelectItem>
                              <SelectItem value="tidal-qobuz">
                                <span className="flex items-center gap-1.5">
                                  <TidalIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <QobuzIcon className="fill-current"/>
                                </span>
                              </SelectItem>
                              <SelectItem value="tidal-amazon">
                                <span className="flex items-center gap-1.5">
                                  <TidalIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <AmazonIcon className="fill-current"/>
                                </span>
                              </SelectItem>
                              <SelectItem value="qobuz-tidal">
                                <span className="flex items-center gap-1.5">
                                  <QobuzIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <TidalIcon className="fill-current"/>
                                </span>
                              </SelectItem>
                              <SelectItem value="amazon-tidal">
                                <span className="flex items-center gap-1.5">
                                  <AmazonIcon className="fill-current"/>
                                  <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                                  <TidalIcon className="fill-current"/>
                                </span>
                              </SelectItem>
                          <SelectItem value="qobuz-amazon">
                            <span className="flex items-center gap-1.5">
                              <QobuzIcon className="fill-current"/>
                              <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                              <AmazonIcon className="fill-current"/>
                            </span>
                          </SelectItem>
                          <SelectItem value="amazon-qobuz">
                            <span className="flex items-center gap-1.5">
                              <AmazonIcon className="fill-current"/>
                              <ArrowRight className="h-3 w-3 text-muted-foreground"/>
                              <QobuzIcon className="fill-current"/>
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>

                      <Select value={tempSettings.autoQuality || "16"} onValueChange={handleAutoQualityChange}>
                        <SelectTrigger className="h-9 w-fit shrink-0 whitespace-nowrap">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="16">{t("literal.backend.value16BitValue441khz")}</SelectItem>
                          <SelectItem value="24">{t("translation.migrated.SettingsPage.24Bit48kHz192kHz")}</SelectItem>
                          {autoAtmosAvailable && (<SelectItem value="atmos">{t("literal.backend.dolbyAtmos")}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </>)}

                  {effectiveDownloader === "tidal" && (<Select value={tempSettings.tidalQuality} onValueChange={handleTidalQualityChange}>
                        <SelectTrigger className="h-9 w-fit">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="LOSSLESS">{t("literal.backend.value16BitValue441khz")}</SelectItem>
                          <SelectItem value="HI_RES_LOSSLESS">{t("translation.migrated.SettingsPage.24Bit48kHz192kHz")}</SelectItem>
                          <SelectItem value="ATMOS">{t("literal.backend.dolbyAtmos")}</SelectItem>
                        </SelectContent>
                      </Select>)}

                  {effectiveDownloader === "qobuz" && (<Select value={tempSettings.qobuzQuality} onValueChange={handleQobuzQualityChange}>
                      <SelectTrigger className="h-9 w-fit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="6">{t("literal.backend.value16BitValue441khz")}</SelectItem>
                        <SelectItem value="27">{t("translation.migrated.SettingsPage.24Bit48kHz192kHz")}</SelectItem>
                      </SelectContent>
                    </Select>)}

                  {effectiveDownloader === "amazon" && (<Select value={tempSettings.amazonQuality} onValueChange={handleAmazonQualityChange}>
                      <SelectTrigger className="h-9 w-fit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="16">{t("literal.backend.value16BitValue441khz")}</SelectItem>
                        <SelectItem value="24">{t("translation.migrated.SettingsPage.24Bit48kHz192kHz")}</SelectItem>
                        <SelectItem value="atmos">{t("literal.backend.dolbyAtmos")}</SelectItem>
                      </SelectContent>
                    </Select>)}
                </div>

                {isAtmosSelected && (<div className="flex flex-wrap items-center gap-3 pt-2">
                    <Switch id="allow-atmos-fallback" checked={tempSettings.allowAtmosFallback} onCheckedChange={(checked) => setTempSettings((prev) => ({
                    ...prev,
                    allowAtmosFallback: checked,
                }))}/>
                    <Label htmlFor="allow-atmos-fallback" className="text-sm font-normal cursor-pointer">
                      {t("translation.sources.fallbackFlac")}
                    </Label>
                    {tempSettings.allowAtmosFallback && (<Select value={tempSettings.atmosFallbackQuality} onValueChange={(value: "16" | "24") => setTempSettings((prev) => ({
                        ...prev,
                        atmosFallbackQuality: value,
                    }))}>
                        <SelectTrigger className="h-8 w-fit">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="16">{t("literal.backend.value16BitValue441khz")}</SelectItem>
                          <SelectItem value="24">{t("translation.migrated.SettingsPage.24Bit48kHz192kHz")}</SelectItem>
                        </SelectContent>
                      </Select>)}
                  </div>)}

                {((effectiveDownloader === "tidal" &&
                tempSettings.tidalQuality === "HI_RES_LOSSLESS") ||
                (effectiveDownloader === "qobuz" &&
                    tempSettings.qobuzQuality === "27") ||
                (effectiveDownloader === "amazon" &&
                    tempSettings.amazonQuality === "24") ||
                (effectiveDownloader === "auto" &&
                    tempSettings.autoQuality === "24") ||
                (isAtmosSelected && tempSettings.allowAtmosFallback && tempSettings.atmosFallbackQuality === "24")) && (<div className="flex items-center gap-3 pt-2">
                      <Switch id="allow-fallback" checked={tempSettings.allowFallback} onCheckedChange={(checked) => setTempSettings((prev) => ({
                    ...prev,
                    allowFallback: checked,
                }))}/>
                      <Label htmlFor="allow-fallback" className="text-sm font-normal cursor-pointer">
                        {t("translation.migrated.SettingsPage.allowQualityFallback16Bit")}
                      </Label>
                  </div>)}
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <Label className="text-base font-semibold">{t("translation.sources.custom")}</Label>
              </div>

              <div className="space-y-2">
                <Label>{t("literal.common.tidal")}</Label>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button type="button" variant="outline" onClick={() => setShowCustomTidalApiDialog(true)} className="gap-2">
                    <TidalIcon />
                    {tempSettings.customTidalApi ? t("translation.migrated.SettingsPage.changeInstance") : t("translation.migrated.SettingsPage.addInstance")}
                  </Button>
                  {tempSettings.customTidalApi && (<span className="max-w-65 truncate text-xs text-muted-foreground" title={tempSettings.customTidalApi}>
                      {tempSettings.customTidalApi}
                    </span>)}
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("literal.common.qobuz")}</Label>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button type="button" variant="outline" onClick={() => setShowCustomQobuzApiDialog(true)} className="gap-2">
                    <QobuzIcon />
                    {tempSettings.customQobuzApi ? t("translation.migrated.SettingsPage.changeInstance") : t("translation.migrated.SettingsPage.addInstance")}
                  </Button>
                  {tempSettings.customQobuzApi && (<span className="max-w-65 truncate text-xs text-muted-foreground" title={tempSettings.customQobuzApi}>
                      {tempSettings.customQobuzApi}
                    </span>)}
                </div>
              </div>

              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold">{t("translation.migrated.SettingsPage.spotifyAccount")}</Label>
                  <button type="button" onClick={() => openExternal("https://developer.spotify.com/dashboard")} className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
                    {t("translation.migrated.SettingsPage.howDoICreateOne")}
                    <ExternalLink className="h-3 w-3"/>
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">{t("translation.migrated.SettingsPage.spotifyAccountDescription")}</p>

                <div className="space-y-2">
                  <Label htmlFor="spotify-redirect-uri">{t("translation.migrated.SettingsPage.spotifyRedirectUri")}</Label>
                  <div className="flex gap-2">
                    <Input id="spotify-redirect-uri" readOnly value={spotifyRedirectURI} className="font-mono text-xs"/>
                    <Button type="button" variant="outline" size="icon" onClick={() => void navigator.clipboard.writeText(spotifyRedirectURI)}>
                      <FileSignature className="h-4 w-4"/>
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="spotify-client-id">{t("translation.migrated.SettingsPage.spotifyClientId")}</Label>
                  <Input id="spotify-client-id" value={tempSettings.spotifyClientID || ""} onChange={(e) => void persistSpotifyClientID(e.target.value)} placeholder="e.g. 8b1c...e42a"/>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {spotifyAuthStatus?.connected ? (<>
                      <span className="text-sm text-green-600 dark:text-green-400">
                        {t("translation.migrated.SettingsPage.spotifyConnectedAs", { value1: spotifyAuthStatus.display_name || "" })}
                      </span>
                      <Button type="button" variant="outline" size="sm" onClick={() => void handleDisconnectSpotify()}>
                        {t("translation.migrated.SettingsPage.spotifyDisconnect")}
                      </Button>
                    </>) : (<Button type="button" variant="outline" className="gap-2" onClick={() => void handleConnectSpotify()} disabled={spotifyConnecting || !(tempSettings.spotifyClientID || "").trim()}>
                      <PlugZap className="h-4 w-4"/>
                      {spotifyConnecting ? t("translation.migrated.SettingsPage.checking") : t("translation.migrated.SettingsPage.spotifyConnect")}
                    </Button>)}
                </div>
              </div>
            </div>
          </div>)}

        {activeTab === "naming" && (() => {
            const separateToggle = (<div className="flex items-center gap-2">
              <Label htmlFor="separate-album-filename" className="text-sm cursor-pointer font-normal">{t("translation.settings.separateFilename")}</Label>
              <Switch id="separate-album-filename" checked={tempSettings.useSeparateAlbumFilename} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, useSeparateAlbumFilename: checked }))}/>
            </div>);
            const folderSingleTrackToggle = (<div className="flex items-center gap-2">
              <Label htmlFor="apply-folder-single-track" className="text-sm cursor-pointer font-normal">{t("translation.settings.singleTrack")}</Label>
              <Switch id="apply-folder-single-track" checked={tempSettings.applyFolderToSingleTrack} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, applyFolderToSingleTrack: checked }))}/>
            </div>);
            return (<div className="space-y-6">
              <FormatEditor tokens={TEMPLATE_VARIABLES} fields={[
                    ...(tempSettings.useSeparateAlbumFilename ? [
                        { title: t("translation.settings.filenameSingleTrack"), titleAccessory: separateToggle, value: tempSettings.filenameTemplate, defaultValue: DEFAULT_SETTINGS.filenameTemplate, suffix: ".flac", placeholder: "{artist} - {title}", column: "left" as const, onChange: (next: string) => setTempSettings((prev) => ({ ...prev, filenameTemplate: next })) },
                        { title: t("translation.settings.filenameAlbumPlaylistTrack"), value: tempSettings.albumFilenameTemplate, defaultValue: DEFAULT_SETTINGS.albumFilenameTemplate, suffix: ".flac", placeholder: "{track}. {title}", column: "left" as const, onChange: (next: string) => setTempSettings((prev) => ({ ...prev, albumFilenameTemplate: next })) },
                    ] : [
                        { title: t("translation.settings.filename"), titleAccessory: separateToggle, value: tempSettings.filenameTemplate, defaultValue: DEFAULT_SETTINGS.filenameTemplate, suffix: ".flac", placeholder: "{track}. {artist} - {title}", column: "left" as const, onChange: (next: string) => setTempSettings((prev) => ({ ...prev, filenameTemplate: next })) },
                    ]),
                    { title: t("translation.settings.folderStructure"), titleAccessory: folderSingleTrackToggle, value: tempSettings.folderTemplate, defaultValue: DEFAULT_SETTINGS.folderTemplate, suffix: "/", placeholder: "{album_artist}/{album}", column: "right" as const, onChange: (next: string) => setTempSettings((prev) => ({ ...prev, folderTemplate: next })) },
                ]}/>
            </div>);
        })()}

        {activeTab === "files" && (<div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-8 items-start">
            <div className="space-y-4 lg:pr-8 lg:border-r">
              <h3 className="text-sm font-semibold text-muted-foreground">{t("translation.settings.fileOutput")}</h3>

              <div className="flex items-center gap-3">
                <Switch id="create-playlist-folder" checked={tempSettings.createPlaylistFolder} onCheckedChange={(checked) => setTempSettings((prev) => ({
                ...prev,
                createPlaylistFolder: checked,
            }))}/>
                <Label htmlFor="create-playlist-folder" className="text-sm cursor-pointer font-normal">
                  {t("translation.settings.playlistFolder")}
                </Label>
              </div>

              {tempSettings.createPlaylistFolder && (<div className="flex items-center gap-3 pl-7">
                <Switch id="playlist-owner-folder-name" checked={tempSettings.playlistOwnerFolderName} onCheckedChange={(checked) => setTempSettings((prev) => ({
                    ...prev,
                    playlistOwnerFolderName: checked,
                }))}/>
                <Label htmlFor="playlist-owner-folder-name" className="text-sm cursor-pointer font-normal">
                  {t("translation.settings.playlistOwnerFolderName")}
                </Label>
              </div>)}

              <div className="flex items-center gap-3">
                <Switch id="save-cover" checked={tempSettings.saveCover} onCheckedChange={(checked) => setTempSettings((prev) => ({
                ...prev,
                saveCover: checked,
            }))}/>
                <Label htmlFor="save-cover" className="text-sm cursor-pointer font-normal">
                  {t("translation.settings.autoDownloadSeparateCover")}
                </Label>
              </div>

              <div className="space-y-2">
                <Label htmlFor="existing-file-check-mode">{t("translation.settings.existingFileCheck")}</Label>
                <Select value={tempSettings.existingFileCheckMode} onValueChange={(value: ExistingFileCheckMode) => setTempSettings((prev) => ({
                ...prev,
                existingFileCheckMode: value,
            }))}>
                  <SelectTrigger id="existing-file-check-mode">
                    <SelectValue placeholder={t("translation.settings.selectExistingFileCheckMode")}/>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="filename">{t("translation.settings.filename")}</SelectItem>
                    <SelectItem value="isrc">ISRC</SelectItem>
                    <SelectItem value="hybrid">{t("translation.settings.hybrid")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-3">
                <Switch id="redownload-with-suffix" checked={tempSettings.redownloadWithSuffix} onCheckedChange={(checked) => setTempSettings((prev) => ({
                ...prev,
                redownloadWithSuffix: checked,
            }))}/>
                <Label htmlFor="redownload-with-suffix" className="text-sm cursor-pointer font-normal">
                  {t("translation.settings.redownloadSuffix")}
                </Label>
              </div>

              <div className="flex items-center gap-3">
                <Switch id="export-logs-file" checked={tempSettings.exportLogsFile} onCheckedChange={(checked) => setTempSettings((prev) => ({
                ...prev,
                exportLogsFile: checked,
            }))}/>
                <Label htmlFor="export-logs-file" className="text-sm cursor-pointer font-normal">
                  {t("translation.settings.generateFailedLogs")}
                </Label>
              </div>
            </div>

            <div className="space-y-6 lg:pl-0">
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-muted-foreground">{t("translation.settings.audioProcessing")}</h3>
                <div className="flex items-center gap-3">
                  <Switch id="auto-convert-audio" checked={tempSettings.autoConvertAudio} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, autoConvertAudio: checked }))}/>
                  <Label htmlFor="auto-convert-audio" className="text-sm font-normal cursor-pointer">{t("translation.settings.autoConvertAudio")}</Label>
                </div>
                {tempSettings.autoConvertAudio && (<div className="space-y-4 pl-7">
                  <div className="flex gap-3 flex-wrap">
                    <div className="space-y-2"><Label htmlFor="auto-convert-format">{t("translation.common.format")}</Label><Select value={tempSettings.autoConvertFormat} onValueChange={(value: SettingsType["autoConvertFormat"]) => setTempSettings((prev) => ({ ...prev, autoConvertFormat: value }))}>
                      <SelectTrigger id="auto-convert-format" className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="mp3">{t("literal.common.mp3")}</SelectItem><SelectItem value="m4a-aac">{t("literal.settings.m4aAac")}</SelectItem><SelectItem value="m4a-alac">{t("literal.settings.m4aAlac")}</SelectItem><SelectItem value="wav">{t("literal.common.wav")}</SelectItem><SelectItem value="aiff">{t("literal.common.aiff")}</SelectItem><SelectItem value="opus">{t("literal.common.opus")}</SelectItem></SelectContent>
                    </Select></div>
                    {!(["m4a-alac", "wav", "aiff"] as string[]).includes(tempSettings.autoConvertFormat) && (<div className="space-y-2"><Label htmlFor="auto-convert-bitrate">{t("translation.settings.bitrate")}</Label><Select value={tempSettings.autoConvertBitrate} onValueChange={(value: SettingsType["autoConvertBitrate"]) => setTempSettings((prev) => ({ ...prev, autoConvertBitrate: value }))}>
                      <SelectTrigger id="auto-convert-bitrate" className="w-32"><SelectValue /></SelectTrigger><SelectContent>{AUTO_CONVERT_BITRATES.map((bitrate) => <SelectItem key={bitrate} value={bitrate}>{bitrate}</SelectItem>)}</SelectContent>
                    </Select></div>)}
                  </div>
                  <div className="flex items-center gap-3"><Switch id="auto-convert-delete-original" checked={tempSettings.autoConvertDeleteOriginal} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, autoConvertDeleteOriginal: checked }))}/><Label htmlFor="auto-convert-delete-original" className="text-sm font-normal cursor-pointer">{t("translation.settings.deleteOriginalFileAfterConvert")}</Label></div>
                </div>)}
                <div className="flex items-center gap-3">
                  <Switch id="auto-resample-audio" checked={tempSettings.autoResampleAudio} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, autoResampleAudio: checked }))}/>
                  <Label htmlFor="auto-resample-audio" className="text-sm font-normal cursor-pointer">{t("translation.settings.autoResampleAudio")}</Label>
                </div>
                {tempSettings.autoResampleAudio && (<div className="space-y-4 pl-7">
                  <div className="flex gap-3 flex-wrap">
                    <div className="space-y-2"><Label htmlFor="auto-resample-bit-depth">{t("translation.settings.bitDepth")}</Label><Select value={tempSettings.autoResampleBitDepth} onValueChange={(value: SettingsType["autoResampleBitDepth"]) => setTempSettings((prev) => ({ ...prev, autoResampleBitDepth: value }))}>
                      <SelectTrigger id="auto-resample-bit-depth" className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="16">{t("literal.common.value16Bit")}</SelectItem><SelectItem value="24">{t("literal.common.value24Bit")}</SelectItem></SelectContent>
                    </Select></div>
                    <div className="space-y-2"><Label htmlFor="auto-resample-rate">{t("translation.settings.sampleRate")}</Label><Select value={tempSettings.autoResampleSampleRate} onValueChange={(value: SettingsType["autoResampleSampleRate"]) => setTempSettings((prev) => ({ ...prev, autoResampleSampleRate: value }))}>
                      <SelectTrigger id="auto-resample-rate" className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="44100">{t("literal.settings.value44Value1Khz")}</SelectItem><SelectItem value="48000">{t("literal.settings.value48Khz")}</SelectItem><SelectItem value="96000">{t("literal.settings.value96Khz")}</SelectItem><SelectItem value="192000">{t("literal.settings.value192Khz")}</SelectItem></SelectContent>
                    </Select></div>
                  </div>
                  <div className="flex items-center gap-3"><Switch id="auto-resample-delete-original" checked={tempSettings.autoResampleDeleteOriginal} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, autoResampleDeleteOriginal: checked }))}/><Label htmlFor="auto-resample-delete-original" className="text-sm font-normal cursor-pointer">{t("translation.settings.deleteOriginalFileAfterResample")}</Label></div>
                </div>)}
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Switch id="auto-replaygain-tags" checked={tempSettings.autoReplayGainTags} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, autoReplayGainTags: checked }))}/>
                    <Label htmlFor="auto-replaygain-tags" className="cursor-pointer text-sm font-normal">{t("translation.settings.autoWriteReplayGainTags")}</Label>
                  </div>
                  {tempSettings.autoReplayGainTags && (<div className="max-w-xs space-y-2 pl-7">
                    <Label htmlFor="auto-replaygain-mode">{t("translation.settings.replayGainMode")}</Label>
                    <Select value={tempSettings.autoReplayGainMode} onValueChange={(value: SettingsType["autoReplayGainMode"]) => setTempSettings((prev) => ({ ...prev, autoReplayGainMode: value }))}>
                      <SelectTrigger id="auto-replaygain-mode"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="track">{t("translation.settings.replayGainTrackMode")}</SelectItem>
                        <SelectItem value="album">{t("translation.settings.replayGainAlbumMode")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>)}
                </div>
              </div>

              <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground">{t("translation.settings.m3u8Playlist")}</h3>

              <div className="flex items-center gap-3">
                <Switch id="create-m3u8-file" checked={tempSettings.createM3u8File} onCheckedChange={(checked) => setTempSettings((prev) => ({
                ...prev,
                createM3u8File: checked,
            }))}/>
                <Label htmlFor="create-m3u8-file" className="text-sm cursor-pointer font-normal">
                  {t("translation.settings.createM3u8PlaylistFile")}
                </Label>
              </div>
              </div>
            </div>
          </div>)}

        {activeTab === "metadata" && (<div className="min-w-0 overflow-hidden space-y-6">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-muted-foreground">{t("translation.settings.embeddedTags")}</h3>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setTempSettings((prev) => ({ ...prev, metadataTags: Object.fromEntries(METADATA_TAG_OPTIONS.map(({ key }) => [key, true])) as unknown as MetadataTagToggles }))}>{t("translation.settings.enableAll")}</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setTempSettings((prev) => ({ ...prev, metadataTags: Object.fromEntries(METADATA_TAG_OPTIONS.map(({ key }) => [key, false])) as unknown as MetadataTagToggles }))}>{t("translation.settings.disableAll")}</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowMetadataAdvanced(true)}>{t("translation.settings.advanced")}</Button>
              </div>
            </div>
            <div className="grid min-w-0 grid-cols-1 md:grid-cols-2 md:gap-x-8">
              {[METADATA_TAG_OPTIONS.slice(0, 7), METADATA_TAG_OPTIONS.slice(7)].map((column, columnIndex) => (<div key={columnIndex} className={`min-w-0 ${columnIndex === 1 ? "md:border-l md:pl-8" : ""}`}>
                {column.map((option) => (<div key={option.key} className="flex min-w-0 items-center gap-3 overflow-hidden py-2">
                  <Switch id={`metadata-tag-${option.key}`} checked={tempSettings.metadataTags[option.key]} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, metadataTags: { ...prev.metadataTags, [option.key]: checked } }))}/>
                  <Label htmlFor={`metadata-tag-${option.key}`} className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-1 overflow-hidden text-sm font-normal">
                    <span className="shrink-0">{t(option.labelKey)}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">(e.g. {option.example})</span>
                  </Label>
                </div>))}
              </div>))}
            </div>
          </div>

        </div>)}

        {activeTab === "status" && (<ApiStatusTab />)}
      </div>

      <Dialog open={showAddFontDialog} onOpenChange={(open) => open ? setShowAddFontDialog(true) : closeAddFontDialog()}>
        <DialogContent className="sm:max-w-115 [&>button]:hidden">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>{t("translation.settings.addFont")}</DialogTitle>
              <button type="button" onClick={() => openExternal("https://fonts.google.com")} className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
                {t("translation.settings.openGoogleFonts")}
                <ExternalLink className="h-3 w-3"/>
              </button>
            </div>
            <DialogDescription />
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="google-font-url">{t("translation.settings.googleFontUrl")}</Label>
              <Input id="google-font-url" value={addFontUrl} onChange={(event) => setAddFontUrl(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter" && parsedAddFont) {
                void handleAddFont();
            }
        }} placeholder={t("literal.settings.httpsFontsGoogleComSpecimen")} autoFocus/>
              {addFontUrl.trim() && !parsedAddFont && (<p className="text-xs text-destructive">
                  {t("translation.settings.enterValidGoogleFontsUrl")}
                </p>)}
            </div>
            <div className="rounded-md border bg-muted/20 p-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                {t("translation.common.preview")}
              </p>
              <p className="text-2xl font-semibold leading-tight" style={{ fontFamily: parsedAddFont?.fontFamily }}>
                {t("literal.settings.aaQuickBrownFox")}
              </p>
              <p className="mt-2 text-sm text-muted-foreground" style={{ fontFamily: parsedAddFont?.fontFamily }}>
                {t("literal.settings.kendrickLamarAllStars")}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeAddFontDialog}>
              {t("translation.common.cancel")}
            </Button>
            <Button onClick={() => void handleAddFont()} disabled={!parsedAddFont}>
              {t("translation.common.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCustomTidalApiDialog} onOpenChange={setShowCustomTidalApiDialog}>
        <DialogContent className="sm:max-w-md [&>button]:hidden">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>{t("translation.migrated.SettingsPage.tidalSource")}</DialogTitle>
              <button type="button" onClick={() => openExternal("https://github.com/binimum/hifi-api")} className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
                {t("translation.migrated.SettingsPage.howDoICreateOne")}
                <ExternalLink className="h-3 w-3"/>
              </button>
            </div>
            <DialogDescription />
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="custom-tidal-api">{t("translation.migrated.SettingsPage.instanceURL")}</Label>
              <div className="flex gap-2">
                <Input id="custom-tidal-api" type="url" value={tempSettings.customTidalApi || ""} onChange={(e) => {
            const nextValue = e.target.value.replace(/\/+$/g, "");
            setCustomTidalApiStatus("idle");
            void persistCustomTidalApi(nextValue);
        }} placeholder="https://your-hifi-api.example"/>
                <Button type="button" variant="outline" className="gap-2" onClick={() => void handleCheckCustomTidalApi()} disabled={!((tempSettings.customTidalApi || "").trim().startsWith("https://")) || customTidalApiStatus === "checking"}>
                  {customTidalApiStatus === "checking" ? t("translation.migrated.SettingsPage.checking") : <><PlugZap className="h-4 w-4"/>{t("translation.common.check")}</>}
                </Button>
                {tempSettings.customTidalApi && (<Button type="button" variant="destructive" size="icon" onClick={() => {
                setCustomTidalApiStatus("idle");
                void persistCustomTidalApi("");
            }}>
                    <Trash2 className="h-4 w-4"/>
                  </Button>)}
              </div>
            </div>
            {customTidalApiStatus !== "idle" && (<p className={`text-xs ${customTidalApiStatus === "online"
                ? "text-green-600 dark:text-green-400"
                : customTidalApiStatus === "offline"
                    ? "text-destructive"
                    : "text-muted-foreground"}`}>
                {customTidalApiStatus === "online"
                ? t("translation.migrated.SettingsPage.customHiFiAPIInstanceIsOnline")
                : customTidalApiStatus === "offline"
                    ? t("translation.migrated.SettingsPage.customHiFiAPIInstanceIsOfflineOr")
                    : t("translation.migrated.SettingsPage.checkingCustomHiFiAPIInstance")}
              </p>)}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCustomTidalApiDialog(false)}>
              {t("translation.common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCustomQobuzApiDialog} onOpenChange={setShowCustomQobuzApiDialog}>
        <DialogContent className="sm:max-w-md [&>button]:hidden">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>{t("translation.migrated.SettingsPage.qobuzSource")}</DialogTitle>
              <button type="button" onClick={() => openExternal("https://github.com/QobuzDL/Qobuz-DL")} className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
                {t("translation.migrated.SettingsPage.howDoICreateOne")}
                <ExternalLink className="h-3 w-3"/>
              </button>
            </div>
            <DialogDescription />
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="custom-qobuz-api">{t("translation.migrated.SettingsPage.instanceURL")}</Label>
              <div className="flex gap-2">
                <Input id="custom-qobuz-api" type="url" value={tempSettings.customQobuzApi || ""} onChange={(e) => {
            const nextValue = e.target.value.replace(/\/+$/g, "");
            setCustomQobuzApiStatus("idle");
            void persistCustomQobuzApi(nextValue);
        }} placeholder="https://your-qobuz-dl.example"/>
                <Button type="button" variant="outline" className="gap-2" onClick={() => void handleCheckCustomQobuzApi()} disabled={!((tempSettings.customQobuzApi || "").trim().startsWith("https://")) || customQobuzApiStatus === "checking"}>
                  {customQobuzApiStatus === "checking" ? t("translation.migrated.SettingsPage.checking") : <><PlugZap className="h-4 w-4"/>{t("translation.common.check")}</>}
                </Button>
                {tempSettings.customQobuzApi && (<Button type="button" variant="destructive" size="icon" onClick={() => {
                setCustomQobuzApiStatus("idle");
                void persistCustomQobuzApi("");
            }}>
                    <Trash2 className="h-4 w-4"/>
                  </Button>)}
              </div>
            </div>
            {customQobuzApiStatus !== "idle" && (<p className={`text-xs ${customQobuzApiStatus === "online"
                ? "text-green-600 dark:text-green-400"
                : customQobuzApiStatus === "offline"
                    ? "text-destructive"
                    : "text-muted-foreground"}`}>
                {customQobuzApiStatus === "online"
                ? t("translation.migrated.SettingsPage.customQobuzDLInstanceIsOnline")
                : customQobuzApiStatus === "offline"
                    ? t("translation.migrated.SettingsPage.customQobuzDLInstanceIsOfflineOr")
                    : t("translation.migrated.SettingsPage.checkingCustomQobuzDLInstance")}
              </p>)}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCustomQobuzApiDialog(false)}>
              {t("translation.common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showMetadataAdvanced} onOpenChange={setShowMetadataAdvanced}>
        <DialogContent className="sm:max-w-md [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>{t("translation.settings.advancedMetadata")}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <Label>{t("translation.settings.dateFormat")}</Label>
            <div className="flex w-fit rounded-lg bg-muted p-1">
              <button type="button" onClick={() => setTempSettings((prev) => ({ ...prev, metadataDateFormat: "full" }))} className={`cursor-pointer rounded-md px-3 py-1 text-sm font-medium transition-colors ${tempSettings.metadataDateFormat === "full" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{t("translation.settings.fullDateFormat")}</button>
              <button type="button" onClick={() => setTempSettings((prev) => ({ ...prev, metadataDateFormat: "year" }))} className={`cursor-pointer rounded-md px-3 py-1 text-sm font-medium transition-colors ${tempSettings.metadataDateFormat === "year" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{t("translation.settings.yearOnlyFormat")}</button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowMetadataAdvanced(false)}>{t("translation.common.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showLyricsAdvanced} onOpenChange={setShowLyricsAdvanced}>
        <DialogContent className="sm:max-w-md [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>{t("translation.settings.advanced")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="lrclib-title-fallback" className="cursor-pointer">{t("translation.sources.lrclibTitleFallback")}</Label>
              <Switch id="lrclib-title-fallback" checked={tempSettings.lrclibTitleFallback} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, lrclibTitleFallback: checked }))}/>
            </div>
            <div className="space-y-2">
              <Label>{t("translation.sources.lyricsTranslation")}</Label>
              <Select value={tempSettings.lyricsTranslationMode} onValueChange={(value: SettingsType["lyricsTranslationMode"]) => setTempSettings((prev) => ({ ...prev, lyricsTranslationMode: value }))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">{t("translation.sources.translationOff")}</SelectItem>
                  <SelectItem value="chatgpt"><span className="flex items-center gap-2"><img src={chatGPTIcon} alt="" className="h-4 w-4 object-contain brightness-0 dark:invert"/>{t("translation.sources.chatGPT")}</span></SelectItem>
                  <SelectItem value="gemini"><span className="flex items-center gap-2"><img src={geminiIcon} alt="" className="h-4 w-4 object-contain"/>{t("translation.sources.googleGemini")}</span></SelectItem>
                </SelectContent>
              </Select>
            </div>
            {tempSettings.lyricsTranslationMode !== "off" && (<>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="lyrics-translation-auto-fallback" className="cursor-pointer">{t("translation.sources.translationAutoFallback")}</Label>
                <Switch id="lyrics-translation-auto-fallback" checked={tempSettings.lyricsTranslationAutoFallback} onCheckedChange={(checked) => setTempSettings((prev) => ({ ...prev, lyricsTranslationAutoFallback: checked }))}/>
              </div>
              <div className="space-y-2">
                <Label>{t("translation.sources.translationLanguage")}</Label>
                <Select value={tempSettings.lyricsTranslationLang} onValueChange={(value) => setTempSettings((prev) => ({ ...prev, lyricsTranslationLang: value }))} onOpenChange={(open) => {
                if (!open)
                    setLyricsLanguageSearch("");
            }}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-56">
                    <div className="sticky top-0 z-10 bg-popover p-1" onKeyDown={(event) => event.stopPropagation()}>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/>
                        <Input value={lyricsLanguageSearch} onChange={(event) => setLyricsLanguageSearch(event.target.value)} placeholder={t("translation.sources.searchLanguage")} className="h-8 pl-8" autoFocus/>
                      </div>
                    </div>
                    {filteredLyricsTranslationLanguages.map((language) => (<SelectItem key={language.code} value={language.code} textValue={t(language.labelKey)}>
                      <span className="flex items-center gap-2">
                        <img src={`/assets/flags/${language.flag}.svg`} alt="" className="h-3 w-4 shrink-0 rounded-[1px] object-cover"/>
                        {t(language.labelKey)}
                      </span>
                    </SelectItem>))}
                    {filteredLyricsTranslationLanguages.length === 0 && (<div className="px-2 py-6 text-center text-sm text-muted-foreground">{t("translation.sources.noLanguageFound")}</div>)}
                  </SelectContent>
                </Select>
              </div>
            </>)}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowLyricsAdvanced(false)}>{t("translation.common.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <DialogContent className="max-w-md [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>{t("translation.migrated.SettingsPage.resetToDefault")}</DialogTitle>
            <DialogDescription>
              {t("translation.migrated.SettingsPage.thisWillResetAllSettingsToTheir")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResetConfirm(false)}>
              {t("translation.common.cancel")}
            </Button>
            <Button onClick={handleReset}>{t("translation.common.reset")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showBackupDialog} onOpenChange={setShowBackupDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("translation.settings.backupSettings")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Button type="button" variant="outline" onClick={() => void handleBackupSettings()} disabled={backupAction !== null} className="justify-start gap-2">
              <Save className="h-4 w-4 shrink-0"/>
              <span className="font-medium">{t("translation.settings.backup")}</span>
            </Button>
            <Button type="button" variant="outline" onClick={() => void handleRestoreSettings()} disabled={backupAction !== null} className="justify-start gap-2">
              <DatabaseBackup className="h-4 w-4 shrink-0"/>
              <span className="font-medium">{t("translation.settings.restore")}</span>
            </Button>
            <Button type="button" variant="outline" onClick={() => void handleOpenConfigFolder()} disabled={backupAction !== null} className="justify-start gap-2">
              <FolderLock className="h-4 w-4 shrink-0"/>
              <span className="font-medium">{t("translation.settings.openConfigFolder")}</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>);
}

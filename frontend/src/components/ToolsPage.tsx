import { useRef } from "react";
import { Activity, ChevronRight, Tags, WandSparkles } from "lucide-react";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { ActivityIcon } from "@/components/ui/activity";
import { AudioLinesIcon } from "@/components/ui/audio-lines";
import { AudioWaveformIcon } from "@/components/ui/audio-waveform";
import { FileMusicIcon } from "@/components/ui/file-music";
import { FilePenIcon } from "@/components/ui/file-pen";
import { FileTextIcon } from "@/components/ui/file-text";
import { GaugeIcon } from "@/components/ui/gauge";
import { TagPlusIcon } from "@/components/ui/tag-plus";
import type { PageType } from "@/components/Sidebar";
export type ToolGroup = "analysis" | "processing" | "management";
type ToolPage = Extract<PageType, "audio-analysis" | "tempo-key-analyzer" | "replaygain" | "audio-converter" | "audio-resampler" | "file-manager" | "lyrics-manager" | "enrich">;
interface ToolDefinition {
    page: ToolPage;
    titleKey: string;
    descriptionKey: string;
    icon: React.ElementType;
    iconClassName: string;
}
interface AnimatedIconHandle {
    startAnimation: () => void;
    stopAnimation: () => void;
}
interface ToolGroupDefinition {
    id: ToolGroup;
    labelKey: string;
    icon: React.ElementType;
    tools: ToolDefinition[];
}
const TOOL_GROUPS: ToolGroupDefinition[] = [
    {
        id: "analysis",
        labelKey: "translation.tools.analysis",
        icon: Activity,
        tools: [
            {
                page: "audio-analysis",
                titleKey: "translation.common.audioQualityAnalyzer",
                descriptionKey: "translation.tools.audioQualityDescription",
                icon: ActivityIcon,
                iconClassName: "bg-emerald-700 text-emerald-50 dark:bg-emerald-800 dark:text-emerald-50",
            },
            {
                page: "tempo-key-analyzer",
                titleKey: "translation.common.bpmKeyAnalyzer",
                descriptionKey: "translation.tools.tempoKeyDescription",
                icon: GaugeIcon,
                iconClassName: "bg-violet-700 text-violet-50 dark:bg-violet-800 dark:text-violet-50",
            },
            {
                page: "replaygain",
                titleKey: "translation.replayGain.title",
                descriptionKey: "translation.tools.replayGainDescription",
                icon: AudioWaveformIcon,
                iconClassName: "bg-rose-700 text-rose-50 dark:bg-rose-800 dark:text-rose-50",
            },
        ],
    },
    {
        id: "processing",
        labelKey: "translation.tools.processing",
        icon: WandSparkles,
        tools: [
            {
                page: "audio-converter",
                titleKey: "translation.common.audioConverter",
                descriptionKey: "translation.tools.audioConverterDescription",
                icon: FileMusicIcon,
                iconClassName: "bg-orange-700 text-orange-50 dark:bg-orange-800 dark:text-orange-50",
            },
            {
                page: "audio-resampler",
                titleKey: "translation.common.audioResampler",
                descriptionKey: "translation.tools.audioResamplerDescription",
                icon: AudioLinesIcon,
                iconClassName: "bg-cyan-700 text-cyan-50 dark:bg-cyan-800 dark:text-cyan-50",
            },
        ],
    },
    {
        id: "management",
        labelKey: "translation.tools.management",
        icon: Tags,
        tools: [
            {
                page: "file-manager",
                titleKey: "translation.common.fileManager",
                descriptionKey: "translation.tools.fileManagerDescription",
                icon: FilePenIcon,
                iconClassName: "bg-blue-700 text-blue-50 dark:bg-blue-800 dark:text-blue-50",
            },
            {
                page: "lyrics-manager",
                titleKey: "translation.common.lyricsManager",
                descriptionKey: "translation.tools.lyricsManagerDescription",
                icon: FileTextIcon,
                iconClassName: "bg-fuchsia-700 text-fuchsia-50 dark:bg-fuchsia-800 dark:text-fuchsia-50",
            },
            {
                page: "enrich",
                titleKey: "translation.enrich.title",
                descriptionKey: "translation.tools.metadataEnricherDescription",
                icon: TagPlusIcon,
                iconClassName: "bg-lime-400 text-lime-900 dark:bg-lime-500 dark:text-lime-900",
            },
        ],
    },
];
function ToolCard({ tool, onOpen }: {
    tool: ToolDefinition;
    onOpen: (page: ToolPage) => void;
}) {
    const Icon = tool.icon;
    const iconRef = useRef<AnimatedIconHandle>(null);
    const title = t(tool.titleKey);
    return (<button type="button" onClick={() => onOpen(tool.page)} onMouseEnter={() => iconRef.current?.startAnimation()} onMouseLeave={() => iconRef.current?.stopAnimation()} onFocus={() => iconRef.current?.startAnimation()} onBlur={() => iconRef.current?.stopAnimation()} className="flex h-20 w-full cursor-pointer items-center justify-between rounded-xl border bg-card p-4 text-left text-card-foreground shadow-sm hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={title}>
            <span className="flex min-w-0 items-center gap-4">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md shadow-sm ${tool.iconClassName}`}>
                    <Icon ref={iconRef} size={18} className="flex items-center justify-center" aria-hidden="true"/>
                </span>
                <span className="flex min-w-0 flex-col overflow-hidden">
                    <span className="truncate text-base font-semibold">{title}</span>
                    <span className="mt-0.5 truncate whitespace-nowrap text-sm capitalize text-muted-foreground">
                        {t(tool.descriptionKey)}
                    </span>
                </span>
            </span>
            <ChevronRight className="ml-4 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true"/>
        </button>);
}
interface ToolsPageProps {
    activeGroup: ToolGroup;
    onActiveGroupChange: (group: ToolGroup) => void;
    onPageChange: (page: PageType) => void;
}
export function ToolsPage({ activeGroup, onActiveGroupChange, onPageChange }: ToolsPageProps) {
    const selectedGroup = TOOL_GROUPS.find((group) => group.id === activeGroup) ?? TOOL_GROUPS[0];
    return (<div className="flex h-full flex-col space-y-6 pb-4">
            <div className="flex shrink-0 items-center justify-between">
                <h1 className="text-2xl font-bold tracking-tight">{t("translation.sidebar.tools")}</h1>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2 border-b">
                {TOOL_GROUPS.map((group) => {
            const Icon = group.icon;
            return (<Button key={group.id} variant={activeGroup === group.id ? "default" : "ghost"} size="sm" onClick={() => onActiveGroupChange(group.id)} className="gap-2 rounded-b-none">
                            <Icon className="h-4 w-4" aria-hidden="true"/>
                            {t(group.labelKey)}
                        </Button>);
        })}
            </div>

            <div className="flex flex-1 flex-col overflow-hidden pb-8 pr-2">
                <div className="max-h-80 overflow-y-auto pr-2 custom-scrollbar xl:max-h-none">
                    <div className="grid grid-cols-1 gap-4 pb-1 md:grid-cols-2">
                        {selectedGroup.tools.map((tool) => (<ToolCard key={tool.page} tool={tool} onOpen={onPageChange}/>))}
                    </div>
                </div>
            </div>
        </div>);
}

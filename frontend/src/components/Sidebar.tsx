import { useState } from "react";
import { useTranslation } from "react-i18next";
import { HomeIcon } from "@/components/ui/home";
import { HistoryIcon } from "@/components/ui/history-icon";
import { ListOrderedIcon } from "@/components/ui/list-ordered-icon";
import { SettingsIcon } from "@/components/ui/settings";
import { TerminalIcon } from "@/components/ui/terminal";
import { BugReportIcon } from "@/components/ui/bug-report-icon";
import { CoffeeIcon } from "@/components/ui/coffee";
import { BlocksIcon } from "@/components/ui/blocks-icon";
import { ToolCaseIcon } from "@/components/ui/tool-case";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger, } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { ListMusic } from "lucide-react";
import { openExternal } from "@/lib/utils";
export type PageType = "main" | "settings" | "debug" | "tools" | "audio-analysis" | "tempo-key-analyzer" | "replaygain" | "audio-converter" | "audio-resampler" | "file-manager" | "lyrics-manager" | "enrich" | "projects" | "support" | "history" | "queue" | "library";
interface SidebarProps {
    currentPage: PageType;
    onPageChange: (page: PageType) => void;
    queueBadgeCount?: number;
}
const TOOL_PAGES: PageType[] = ["tools", "audio-analysis", "tempo-key-analyzer", "replaygain", "audio-converter", "audio-resampler", "file-manager", "lyrics-manager", "enrich"];
export function Sidebar({ currentPage, onPageChange, queueBadgeCount = 0 }: SidebarProps) {
    const { t } = useTranslation();
    const [isIssuesDialogOpen, setIsIssuesDialogOpen] = useState(false);
    const [hasIssueAgreement, setHasIssueAgreement] = useState(false);
    const handleIssuesDialogChange = (open: boolean) => {
        setIsIssuesDialogOpen(open);
        if (!open) {
            setHasIssueAgreement(false);
        }
    };
    const handleOpenIssues = () => {
        openExternal("https://github.com/spotbye/SpotiFLAC/issues");
        handleIssuesDialogChange(false);
    };
    return (<div className="fixed left-0 top-0 h-full w-14 bg-card border-r border-border flex flex-col items-center py-14 z-30">
            <div className="flex flex-col gap-2 flex-1">
                <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                        <Button variant={currentPage === "main" ? "secondary" : "ghost"} size="icon" className={`h-10 w-10 ${currentPage === "main" ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-primary/10 hover:text-primary"}`} onClick={() => onPageChange("main")}>
                            <HomeIcon size={20}/>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                        <p>{t("translation.sidebar.home")}</p>
                    </TooltipContent>
                </Tooltip>

                <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                        <Button variant={currentPage === "queue" ? "secondary" : "ghost"} size="icon" className={`relative h-10 w-10 ${currentPage === "queue" ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-primary/10 hover:text-primary"}`} onClick={() => onPageChange("queue")}>
                            <ListOrderedIcon size={20}/>
                            {queueBadgeCount > 0 && (<span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{queueBadgeCount > 99 ? "99+" : queueBadgeCount}</span>)}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right"><p>{t("translation.queue.queue")}</p></TooltipContent>
                </Tooltip>

                <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                        <Button variant={currentPage === "history" ? "secondary" : "ghost"} size="icon" className={`h-10 w-10 ${currentPage === "history" ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-primary/10 hover:text-primary"}`} onClick={() => onPageChange("history")}>
                            <HistoryIcon size={20}/>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                        <p>{t("translation.sidebar.history")}</p>
                    </TooltipContent>
                </Tooltip>

                <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                        <Button variant={currentPage === "library" ? "secondary" : "ghost"} size="icon" className={`h-10 w-10 ${currentPage === "library" ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-primary/10 hover:text-primary"}`} onClick={() => onPageChange("library")}>
                            <ListMusic size={20}/>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                        <p>{t("translation.sidebar.library")}</p>
                    </TooltipContent>
                </Tooltip>

                <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                        <Button variant={currentPage === "settings" ? "secondary" : "ghost"} size="icon" className={`h-10 w-10 ${currentPage === "settings" ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-primary/10 hover:text-primary"}`} onClick={() => onPageChange("settings")}>
                            <SettingsIcon size={20}/>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                        <p>{t("translation.sidebar.settings")}</p>
                    </TooltipContent>
                </Tooltip>

                <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                        <Button variant={currentPage === "debug" ? "secondary" : "ghost"} size="icon" className={`h-10 w-10 ${currentPage === "debug" ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-primary/10 hover:text-primary"}`} onClick={() => onPageChange("debug")}>
                            <TerminalIcon size={20} loop={true}/>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                        <p>{t("translation.sidebar.debugLogs")}</p>
                    </TooltipContent>
                </Tooltip>

                <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                        <Button variant={TOOL_PAGES.includes(currentPage) ? "secondary" : "ghost"} size="icon" className={`h-10 w-10 ${TOOL_PAGES.includes(currentPage) ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-primary/10 hover:text-primary"}`} onClick={() => onPageChange("tools")}>
                            <ToolCaseIcon size={20}/>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                        <p>{t("translation.sidebar.tools")}</p>
                    </TooltipContent>
                </Tooltip>
            </div>

            <div className="mt-auto flex flex-col gap-2">
                <Dialog open={isIssuesDialogOpen} onOpenChange={handleIssuesDialogChange}>
                    <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-10 w-10 hover:bg-primary/10 hover:text-primary" onClick={() => setIsIssuesDialogOpen(true)}>
                                <BugReportIcon size={20} loop={true}/>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                            <p>{t("translation.sidebar.reportBugsRequestFeatures")}</p>
                        </TooltipContent>
                    </Tooltip>
                    <DialogContent className="max-w-xl">
                        <DialogHeader>
                            <DialogTitle>{t("translation.sidebar.beforeOpeningIssues")}</DialogTitle>
                            <DialogDescription />
                        </DialogHeader>

                        <div className="space-y-4 text-sm">
                            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
                                <p className="font-semibold text-amber-900 dark:text-amber-200">{t("translation.sidebar.important")}</p>
                                <p className="mt-1 text-amber-950/90 dark:text-amber-100/90">
                                    {t("translation.sidebar.searchIssuesFirst")}
                                </p>
                            </div>

                            <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-4">
                                <Checkbox className="shrink-0" checked={hasIssueAgreement} onCheckedChange={(checked) => setHasIssueAgreement(checked === true)}/>
                                <span className="leading-5 text-foreground/90">
                                    {t("translation.sidebar.issueAgreement")}
                                </span>
                            </label>
                        </div>

                        <DialogFooter className="sm:justify-between gap-2">
                            <Button variant="outline" onClick={() => handleIssuesDialogChange(false)}>
                                {t("translation.sidebar.cancel")}
                            </Button>
                            <Button disabled={!hasIssueAgreement} onClick={handleOpenIssues}>
                                {t("translation.sidebar.openIssues")}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                        <Button variant={currentPage === "projects" ? "secondary" : "ghost"} size="icon" className={`h-10 w-10 ${currentPage === "projects" ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-primary/10 hover:text-primary"}`} onClick={() => onPageChange("projects")}>
                            <BlocksIcon size={20} loop={true}/>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                        <p>{t("translation.sidebar.otherProjects")}</p>
                    </TooltipContent>
                </Tooltip>

                <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                        <Button variant={currentPage === "support" ? "secondary" : "ghost"} size="icon" className={`h-10 w-10 ${currentPage === "support" ? "bg-primary/10 text-primary hover:bg-primary/20" : "hover:bg-primary/10 hover:text-primary"}`} onClick={() => onPageChange("support")}>
                            <CoffeeIcon size={20} loop={true}/>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                        <p>{t("translation.sidebar.supportMe")}</p>
                    </TooltipContent>
                </Tooltip>
            </div>
        </div>);
}

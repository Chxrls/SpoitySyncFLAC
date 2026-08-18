import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StopCircle, Clock } from "lucide-react";
import { useDownloadProgress } from "@/hooks/useDownloadProgress";
import { openExternal } from "@/lib/utils";
const SERVER_DETAILS_URL = "https://spotbye.qzz.io";
interface DownloadProgressProps {
    progress: number;
    remainingCount?: number;
    currentTrack: {
        name: string;
        artists: string;
    } | null;
    onStop: () => void;
}
export function DownloadProgress({ progress, remainingCount = 0, currentTrack, onStop }: DownloadProgressProps) {
    const liveProgress = useDownloadProgress();
    const isCooldown = Boolean(liveProgress.cooldown) && (liveProgress.cooldown_secs ?? 0) > 0;
    const cooldownSecs = liveProgress.cooldown_secs ?? 0;
    const cooldownMinutes = Math.max(1, Math.ceil(cooldownSecs / 60));
    const isRateLimited = Boolean(liveProgress.rate_limited) && (liveProgress.rate_limit_secs ?? 0) > 0;
    const rateLimitSecs = liveProgress.rate_limit_secs ?? 0;
    const clampedProgress = Math.min(100, Math.max(0, progress));
    const safeRemainingCount = Math.max(0, remainingCount);
    const remainingLabel = t("translation.downloadProgress.tracksLeft", { count: safeRemainingCount });
    return (<div className="w-full space-y-2 mt-4">
      <div className="flex items-center gap-2">
        <Progress value={clampedProgress} className="h-2 flex-1"/>
        <Button variant="destructive" size="sm" onClick={onStop} className="gap-1.5">
          <StopCircle className="h-4 w-4"/>
          {t("translation.common.stop")}
        </Button>
      </div>
      {isCooldown ? (<p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <Clock className="h-3.5 w-3.5 shrink-0"/>
          <span>
            {t("translation.migrated.CooldownBanner.scheduledBreak", { count: cooldownMinutes })} {t("translation.migrated.DownloadProgress.backIn")} {cooldownSecs}s){" "}
            <button type="button" onClick={() => openExternal(SERVER_DETAILS_URL)} className="cursor-pointer font-medium underline underline-offset-2 hover:text-amber-800 dark:hover:text-amber-200">
              {t("translation.migrated.CooldownBanner.checkDetails")}
            </button>
          </span>
        </p>) : isRateLimited ? (<p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <Clock className="h-3.5 w-3.5 shrink-0"/>
          {t("translation.migrated.DownloadProgress.rateLimitedPleaseWaitRetryingIn")} {rateLimitSecs}s...
        </p>) : (<p className="text-xs text-muted-foreground">
        {clampedProgress}% • {remainingLabel} -{" "}
        {currentTrack
                ? t("translation.migrated.DownloadProgress.text", { value1: currentTrack.name, value2: currentTrack.artists })
                : t("translation.migrated.DownloadProgress.preparingDownload")}
      </p>)}
    </div>);
}

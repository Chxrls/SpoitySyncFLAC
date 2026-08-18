import { t } from "@/i18n";
import { useDownloadProgress } from "@/hooks/useDownloadProgress";
import { Download } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
interface DownloadProgressToastProps {
    isPreparing?: boolean;
    onOpenQueue?: () => void;
}
export function DownloadProgressToast({ isPreparing = false, onOpenQueue }: DownloadProgressToastProps) {
    const progress = useDownloadProgress();
    const hasTransfer = progress.is_downloading && progress.mb_downloaded > 0;
    if (!progress.is_downloading && !isPreparing) {
        return null;
    }
    return (<div className="fixed bottom-4 left-[calc(56px+1rem)] z-50 animate-in slide-in-from-bottom-5 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom-5">
      <button type="button" onClick={onOpenQueue} className="h-auto cursor-pointer rounded-lg border border-border bg-background p-3 text-left text-foreground shadow-lg transition-colors hover:bg-muted dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100 dark:hover:bg-blue-900" aria-label={t("translation.queue.openQueue")}>
        <div className="flex items-center gap-3">
          {hasTransfer ? (<Download className="h-4 w-4 text-blue-600 dark:text-blue-400 animate-bounce"/>) : (<Spinner className="h-4 w-4 text-blue-600 dark:text-blue-400"/>)}
          <div className="flex flex-col min-w-[80px]">
            {hasTransfer ? (<>
              <p className="text-sm font-medium font-mono tabular-nums">
                {progress.mb_downloaded.toFixed(2)} {t("literal.common.mb")}
              </p>
              {progress.speed_mbps > 0 && (<p className="text-xs font-mono tabular-nums text-muted-foreground dark:text-blue-300">
                  {progress.speed_mbps.toFixed(2)} {t("literal.downloadProgressToast.mbS")}
                </p>)}
            </>) : (<p className="text-sm font-medium">{t("translation.queue.preparing")}</p>)}
          </div>
        </div>
      </button>
    </div>);
}

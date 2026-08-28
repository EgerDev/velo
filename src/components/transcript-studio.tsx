import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { type ResolvedVideo } from "@/lib/youtube";
import { AI_PROMPT_TEMPLATES, type TranscriptCue } from "@/lib/transcript";
import { type NLEExportFormat } from "@/lib/nle-export";
import { fetchTranscript, resolveVideo } from "@/lib/resolve-video";
import { TranscriptView } from "@/components/transcript-view";
import { copyAiPrompt as copyAiPromptExport, copyTranscript, downloadTranscriptFile as downloadTranscriptExport, exportNleFile } from "@/lib/transcript-export";

type TranscriptStudioProps = {
  initialUrl?: string;
  preferredLang?: string | null;
  onOpenInDownloader?: (url: string) => void;
};

const SAMPLE_PODCASTS = [
  { label: "Lex Fridman", tag: "podcast · 2h+", query: "https://www.youtube.com/watch?v=L_Guz73e6fw" },
  { label: "Huberman Lab", tag: "podcast · chapters", query: "https://www.youtube.com/watch?v=gXDMoiEkyuQ" },
  { label: "Veritasium", tag: "math · captions", query: "https://www.youtube.com/watch?v=HeQX2HjkcNo" },
  { label: "3Blue1Brown", tag: "lecture · math", query: "https://www.youtube.com/watch?v=aircAruvnKk" },
];

export function TranscriptStudio({ initialUrl = "", preferredLang = null, onOpenInDownloader }: TranscriptStudioProps) {
  const [urlInput, setUrlInput] = useState(initialUrl);
  const [loading, setLoading] = useState(false);
  const [video, setVideo] = useState<ResolvedVideo | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("");
  // YouTube auto-translate target ("" = original). Kept across track changes;
  // a track that can't be translated just shows its original text.
  const [translateTo, setTranslateTo] = useState<string>("");
  const [translatedTo, setTranslatedTo] = useState<{ code: string; name: string } | null>(null);
  const [cues, setCues] = useState<TranscriptCue[]>([]);
  const [deletedCueIds, setDeletedCueIds] = useState<Set<number>>(new Set());
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [playingTime, setPlayingTime] = useState<number | null>(null);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const [copiedFormat, setCopiedFormat] = useState<string | null>(null);
  const [showNleMenu, setShowNleMenu] = useState(false);
  const [fps, setFps] = useState<number>(30);
  const [error, setError] = useState<string | null>(null);

  // Active cues excluding deleted/removed sections
  const activeCues = useMemo(() => {
    return cues.filter((cue) => !deletedCueIds.has(cue.id));
  }, [cues, deletedCueIds]);

  // Search filtered cues (showing all cues with deleted styling)
  const filteredCues = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return cues;
    return cues.filter((cue) => cue.text.toLowerCase().includes(q));
  }, [cues, searchQuery]);

  // Word statistics & estimated reading time
  const stats = useMemo(() => {
    const fullText = activeCues.map((c) => c.text).join(" ");
    const words = fullText.trim() ? fullText.trim().split(/\s+/).length : 0;
    const readingMinutes = Math.max(1, Math.round(words / 200));
    return {
      words,
      readingMinutes,
      cuesCount: activeCues.length,
      excludedCount: deletedCueIds.size,
    };
  }, [activeCues, deletedCueIds]);

  // Distinct from reqIdRef (which guards caption fetches): guards the whole
  // resolve→setVideo flow so a slow first URL can't overwrite a newer one the
  // user submitted after it.
  const videoReqRef = useRef(0);

  async function loadVideoTranscript(targetUrl: string) {
    const cleanUrl = targetUrl.trim();
    if (!cleanUrl) return;

    const currentReq = ++videoReqRef.current;
    setError(null);
    setLoading(true);
    try {
      const resolved = await resolveVideo({ data: { url: cleanUrl } });
      if (currentReq !== videoReqRef.current) return;
      setVideo(resolved);

      if (!resolved.captions || resolved.captions.length === 0) {
        setError("No subtitle or transcript tracks found for this video.");
        setCues([]);
        return;
      }

      const wantedLang =
        preferredLang ||
        (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("lang") : null);
      const defaultTrack =
        (wantedLang ? resolved.captions.find((c) => c.languageCode === wantedLang) : undefined) ??
        resolved.captions.find((c) => c.languageCode === "en") ??
        resolved.captions[0];
      setSelectedLanguage(defaultTrack.vssId);
      await loadCaptionContent(resolved, defaultTrack.vssId, translateTo);
    } catch (err) {
      if (currentReq !== videoReqRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load video transcripts.");
      setVideo(null);
      setCues([]);
    } finally {
      if (currentReq === videoReqRef.current) setLoading(false);
    }
  }

  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current || !initialUrl.trim()) return;
    bootedRef.current = true;
    void loadVideoTranscript(initialUrl);
  }, [initialUrl]);

  const reqIdRef = useRef(0);

  function seekTo(time: number) {
    setPlayingTime(time);
    const iframe = document.getElementById("transcript-studio-iframe") as HTMLIFrameElement | null;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(
        JSON.stringify({
          event: "command",
          func: "seekTo",
          args: [time, true],
        }),
        "*",
      );
    }
  }

  async function loadCaptionContent(target: ResolvedVideo, vssId: string, tlang: string) {
    const currentReq = ++reqIdRef.current;
    setLoadingTranscript(true);
    setDeletedCueIds(new Set());
    try {
      // Both ids: the server only trusts the pair, and by vssId alone it used
      // to fall back to the first manual track (English picked, Arabic shown).
      const track = target.captions.find((c) => c.vssId === vssId);
      const wantTlang = tlang && track?.translatable ? tlang : undefined;
      const fetchCues = (translate: string | undefined) =>
        fetchTranscript({
          data: { id: target.id, vssId, languageCode: track?.languageCode, tlang: translate },
        });
      let res: Awaited<ReturnType<typeof fetchTranscript>>;
      try {
        res = await fetchCues(wantTlang);
      } catch (err) {
        // YouTube sometimes refuses the translated track (429) while the
        // original still serves — show the original rather than nothing.
        if (!wantTlang) throw err;
        res = await fetchCues(undefined);
        if (currentReq === reqIdRef.current) {
          toast.warning("YouTube refused the translation right now — showing the original text.");
        }
      }
      if (currentReq !== reqIdRef.current) return;
      setCues(res.cues);
      setTranslatedTo(res.translatedTo);
    } catch (err) {
      if (currentReq !== reqIdRef.current) return;
      toast.error(err instanceof Error ? err.message : "Could not fetch transcript text.");
      setCues([]);
    } finally {
      if (currentReq === reqIdRef.current) {
        setLoadingTranscript(false);
      }
    }
  }

  function handleLanguageChange(vssId: string) {
    if (!video || vssId === selectedLanguage) return;
    setSelectedLanguage(vssId);
    void loadCaptionContent(video, vssId, translateTo);
  }

  function handleTranslateChange(code: string) {
    if (!video || code === translateTo) return;
    setTranslateTo(code);
    void loadCaptionContent(video, selectedLanguage, code);
  }

  const selectedTrack = video?.captions.find((c) => c.vssId === selectedLanguage) ?? null;
  const translationLanguages = video?.translationLanguages ?? [];
  const canTranslate = Boolean(selectedTrack?.translatable) && translationLanguages.length > 0;

  function toggleDeleteCue(id: number) {
    setDeletedCueIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function restoreAllCues() {
    setDeletedCueIds(new Set());
    toast.success("Restored all deleted segments.");
  }

  async function copyFormattedTranscript(format: "plain" | "timestamped" | "srt" | "vtt" | "json") {
    await copyTranscript(format, activeCues, (f) => {
      setCopiedFormat(f);
      setTimeout(() => setCopiedFormat(null), 2000);
    });
  }

  function downloadTranscriptFile(format: "txt" | "srt" | "vtt" | "json") {
    if (video) downloadTranscriptExport(format, activeCues, video);
  }

  function handleNleExport(formatId: NLEExportFormat) {
    if (video) {
      exportNleFile(formatId, activeCues, video, fps);
      setShowNleMenu(false);
    }
  }

  async function copyAiPrompt(template: (typeof AI_PROMPT_TEMPLATES)[0]) {
    if (video) {
      await copyAiPromptExport(template, activeCues, video, (id) => {
        setCopiedPromptId(id);
        setTimeout(() => setCopiedPromptId(null), 2500);
      });
    }
  }

  return (
    <TranscriptView
      urlInput={urlInput}
      setUrlInput={setUrlInput}
      loadVideoTranscript={loadVideoTranscript}
      loading={loading}
      samples={SAMPLE_PODCASTS}
      error={error}
      setError={setError}
      video={video}
      selectedLanguage={selectedLanguage}
      handleLanguageChange={handleLanguageChange}
      translationLanguages={translationLanguages}
      canTranslate={canTranslate}
      translateTo={translateTo}
      handleTranslateChange={handleTranslateChange}
      selectedTrack={selectedTrack}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      copyFormattedTranscript={copyFormattedTranscript}
      copiedFormat={copiedFormat}
      downloadTranscriptFile={downloadTranscriptFile}
      cues={cues}
      deletedCueIds={deletedCueIds}
      toggleDeleteCue={toggleDeleteCue}
      restoreAllCues={restoreAllCues}
      seekTo={seekTo}
      handleNleExport={handleNleExport}
      copyAiPrompt={copyAiPrompt}
      copiedPromptId={copiedPromptId}
      loadingTranscript={loadingTranscript}
      filteredCues={filteredCues}
      activeCues={activeCues}
      excludedCount={stats.excludedCount}
      fps={fps}
      setFps={setFps}
      showNleMenu={showNleMenu}
      setShowNleMenu={setShowNleMenu}
      onOpenInDownloader={onOpenInDownloader}
      translatedTo={translatedTo}
      readingMinutes={stats.readingMinutes}
      playingTime={playingTime}
      stats={stats}
    />
  );
}

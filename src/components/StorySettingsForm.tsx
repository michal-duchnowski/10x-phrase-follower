import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { useApi } from "../lib/hooks/useApi";

interface StorySettings {
  is_configured: boolean;
  model: string;
  prompt: string;
  temperature: number;
  max_tokens: number;
  thinking_enabled: boolean;
  thinking_effort: "low" | "high" | "max";
  tts_speaking_rate: number;
  tts_voice_id: string;
}

const STORY_TTS_VOICES = [
  { id: "en-GB-Chirp3-HD-Aoede", label: "Aoede — female" },
  { id: "en-GB-Chirp3-HD-Charon", label: "Charon — male" },
  { id: "en-GB-Chirp3-HD-Kore", label: "Kore — female" },
  { id: "en-GB-Chirp3-HD-Puck", label: "Puck — male" },
  { id: "en-GB-Chirp3-HD-Sulafat", label: "Sulafat — female" },
  { id: "en-GB-Chirp3-HD-Umbriel", label: "Umbriel — male" },
] as const;

const STORY_TTS_SPEEDS = [
  { value: 0.75, label: "0.75× — slow" },
  { value: 0.9, label: "0.9× — slightly slow" },
  { value: 1, label: "1× — normal" },
  { value: 1.1, label: "1.1× — slightly fast" },
  { value: 1.25, label: "1.25× — fast" },
] as const;

export default function StorySettingsForm() {
  const { apiCall } = useApi();
  const [settings, setSettings] = useState<StorySettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [temperature, setTemperature] = useState("0.8");
  const [maxTokens, setMaxTokens] = useState("800");
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [thinkingEffort, setThinkingEffort] = useState<StorySettings["thinking_effort"]>("low");
  const [ttsVoiceId, setTtsVoiceId] = useState("en-GB-Chirp3-HD-Kore");
  const [ttsSpeakingRate, setTtsSpeakingRate] = useState(1);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    void apiCall<StorySettings>("/api/stories/settings")
      .then((data) => {
        setSettings(data);
        setModel(data.model);
        setPrompt(data.prompt);
        setTemperature(String(data.temperature));
        setMaxTokens(String(data.max_tokens));
        setThinkingEnabled(data.thinking_enabled);
        setThinkingEffort(data.thinking_effort);
        setTtsVoiceId(data.tts_voice_id);
        setTtsSpeakingRate(data.tts_speaking_rate);
      })
      .catch((error) =>
        setMessage({ type: "error", text: error instanceof Error ? error.message : "Could not load settings." })
      );
  }, [apiCall]);

  const parsedTemperature = Number(temperature.replace(",", "."));
  const parsedMaxTokens = Number(maxTokens);
  const hasValidTemperature = Number.isFinite(parsedTemperature) && parsedTemperature >= 0 && parsedTemperature <= 2;
  const hasValidMaxTokens = Number.isInteger(parsedMaxTokens) && parsedMaxTokens >= 100 && parsedMaxTokens <= 64_000;

  const save = async () => {
    if (!hasValidTemperature || !hasValidMaxTokens) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await apiCall<StorySettings>("/api/stories/settings", {
        method: "PUT",
        body: JSON.stringify({
          api_key: apiKey || undefined,
          model,
          prompt,
          temperature: parsedTemperature,
          max_tokens: parsedMaxTokens,
          thinking_enabled: thinkingEnabled,
          thinking_effort: thinkingEffort,
          tts_voice_id: ttsVoiceId,
          tts_speaking_rate: ttsSpeakingRate,
        }),
      });
      setSettings(result);
      setApiKey("");
      setMessage({ type: "success", text: "Story settings saved." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Could not save settings." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {settings?.is_configured ? (
        <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-200">
          DeepSeek API key is configured. Leave the field below empty to keep it unchanged.
        </p>
      ) : (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          Add a DeepSeek API key to generate stories.
        </p>
      )}
      <div>
        <label htmlFor="story-api-key" className="mb-2 block text-sm font-medium text-foreground">
          DeepSeek API Key
        </label>
        <input
          id="story-api-key"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="Enter your DeepSeek API key"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground"
        />
        <p className="mt-1 text-xs text-muted-foreground">The key is encrypted before it is stored.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-foreground" htmlFor="story-temperature">
          Temperature
          <input
            id="story-temperature"
            type="text"
            inputMode="decimal"
            value={temperature}
            onChange={(event) => setTemperature(event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-foreground"
          />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            Lower values make word usage more consistent. You can use a dot or comma.
          </span>
        </label>
        <label className="text-sm font-medium text-foreground" htmlFor="story-max-tokens">
          Max tokens
          <input
            id="story-max-tokens"
            type="text"
            inputMode="numeric"
            value={maxTokens}
            onChange={(event) => setMaxTokens(event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-foreground"
          />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">From 100 to 64,000.</span>
        </label>
      </div>
      <div className="flex items-start gap-3 rounded-md border border-border p-3 text-sm text-foreground">
        <input
          id="story-thinking"
          type="checkbox"
          checked={thinkingEnabled}
          onChange={(event) => setThinkingEnabled(event.target.checked)}
          className="mt-0.5 size-4"
        />
        <label htmlFor="story-thinking">
          <span className="block font-medium">Enable thinking</span>
          <span className="block text-xs text-muted-foreground">
            The model can plan how to use the selected expressions before writing.
          </span>
        </label>
      </div>
      <div>
        <label htmlFor="story-thinking-effort" className="mb-2 block text-sm font-medium text-foreground">
          Thinking effort
        </label>
        <select
          id="story-thinking-effort"
          value={thinkingEffort}
          disabled={!thinkingEnabled}
          onChange={(event) => setThinkingEffort(event.target.value as StorySettings["thinking_effort"])}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="low">Low — faster, lower token use</option>
          <option value="high">High — more planning</option>
          <option value="max">Max — slowest, highest token use</option>
        </select>
        <p className="mt-1 text-xs text-muted-foreground">Used only when thinking is enabled.</p>
      </div>
      <div>
        <label htmlFor="story-model" className="mb-2 block text-sm font-medium text-foreground">
          Model
        </label>
        <input
          id="story-model"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="deepseek-v4-flash"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground"
        />
      </div>
      <div>
        <label htmlFor="story-tts-voice" className="mb-2 block text-sm font-medium text-foreground">
          Story narration voice
        </label>
        <select
          id="story-tts-voice"
          value={ttsVoiceId}
          onChange={(event) => setTtsVoiceId(event.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground"
        >
          {STORY_TTS_VOICES.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {voice.label} (British English, Chirp 3: HD)
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">Used when you select the speaker on a generated story.</p>
      </div>
      <div>
        <label htmlFor="story-tts-speed" className="mb-2 block text-sm font-medium text-foreground">
          Narration speed
        </label>
        <select
          id="story-tts-speed"
          value={ttsSpeakingRate}
          onChange={(event) => setTtsSpeakingRate(Number(event.target.value))}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground"
        >
          {STORY_TTS_SPEEDS.map((speed) => (
            <option key={speed.value} value={speed.value}>
              {speed.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="story-prompt" className="mb-2 block text-sm font-medium text-foreground">
          Story prompt
        </label>
        <textarea
          id="story-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={7}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          This is the complete instruction for the model. Define the Markdown sections and format you want; the app only
          adds the vocabulary data.
        </p>
      </div>
      {message && (
        <p
          className={
            message.type === "success" ? "text-sm text-green-700 dark:text-green-300" : "text-sm text-destructive"
          }
        >
          {message.text}
        </p>
      )}
      <Button
        onClick={() => void save()}
        disabled={saving || !model.trim() || !prompt.trim() || !hasValidTemperature || !hasValidMaxTokens}
      >
        {saving ? "Saving..." : "Save story settings"}
      </Button>
    </div>
  );
}

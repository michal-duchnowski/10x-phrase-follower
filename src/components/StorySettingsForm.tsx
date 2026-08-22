import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { useApi } from "../lib/hooks/useApi";

interface StorySettings {
  is_configured: boolean;
  model: string;
  prompt: string;
}

export default function StorySettingsForm() {
  const { apiCall } = useApi();
  const [settings, setSettings] = useState<StorySettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    void apiCall<StorySettings>("/api/stories/settings")
      .then((data) => {
        setSettings(data);
        setModel(data.model);
        setPrompt(data.prompt);
      })
      .catch((error) =>
        setMessage({ type: "error", text: error instanceof Error ? error.message : "Could not load settings." })
      );
  }, [apiCall]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await apiCall<StorySettings>("/api/stories/settings", {
        method: "PUT",
        body: JSON.stringify({ api_key: apiKey || undefined, model, prompt }),
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
      <Button onClick={() => void save()} disabled={saving || !model.trim() || !prompt.trim()}>
        {saving ? "Saving..." : "Save story settings"}
      </Button>
    </div>
  );
}

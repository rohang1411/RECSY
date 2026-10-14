'use client';

import { useId, useState } from 'react';

import {
  CLIENT_SETTING_DEFAULTS,
  CLIENT_SETTING_KEYS,
  useClientSetting,
} from '@/lib/client-settings';
import { cn } from '@/lib/utils';

export function SettingsClient() {
  return (
    <section className="mt-8 space-y-8">
      {/* AI Model Gateway & Reasoning Tier */}
      <fieldset className="border-outline-variant bg-background border">
        <legend className="meta-label text-primary ml-5 px-2">
          AI Model Gateway & Reasoning Tier
        </legend>
        <div className="space-y-6 p-5">
          <ReasoningModeSelector />
          <hr className="border-outline-variant" />
          <ByokKeyConfig />
        </div>
      </fieldset>

      {/* Chat input preferences */}
      <fieldset className="border-outline-variant bg-background border">
        <legend className="meta-label text-primary ml-5 px-2">Chat input</legend>
        <div className="p-5">
          <EnterToSendToggle />
        </div>
      </fieldset>
    </section>
  );
}

function ReasoningModeSelector() {
  const [mode, setMode] = useClientSetting<'fast' | 'deep'>(
    CLIENT_SETTING_KEYS.reasoningMode,
    CLIENT_SETTING_DEFAULTS[CLIENT_SETTING_KEYS.reasoningMode],
  );
  const isDeep = mode === 'deep';

  return (
    <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-start">
      <div className="min-w-0">
        <p className="text-primary font-mono text-sm tracking-[0.12em] uppercase">
          Reasoning Execution Mode
        </p>
        <p className="text-muted-foreground mt-2 max-w-2xl text-xs leading-5">
          <strong>⚡ Fast Turbo Mode:</strong> Sub-second extraction and recommendations using
          high-speed LPUs (Groq Llama 3.1 8B, Gemini Flash).
          <br />
          <strong>🧠 Deep Reasoning Mode:</strong> Multi-aspect trade-off matrix evaluation and
          conflict reconciliation using frontier reasoning models (Gemini 2.5 Pro, NVIDIA NIM
          DeepSeek-R1).
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMode('fast')}
          className={cn(
            'border px-3 py-1.5 font-mono text-xs tracking-wider uppercase transition-colors',
            !isDeep
              ? 'border-primary bg-primary text-primary-foreground font-semibold'
              : 'border-outline hover:border-primary text-muted-foreground',
          )}
        >
          ⚡ Fast
        </button>
        <button
          type="button"
          onClick={() => setMode('deep')}
          className={cn(
            'border px-3 py-1.5 font-mono text-xs tracking-wider uppercase transition-colors',
            isDeep
              ? 'border-primary bg-primary text-primary-foreground font-semibold'
              : 'border-outline hover:border-primary text-muted-foreground',
          )}
        >
          🧠 Deep
        </button>
      </div>
    </div>
  );
}

function ByokKeyConfig() {
  const [byokKey, setByokKey] = useClientSetting<string>(
    CLIENT_SETTING_KEYS.byokKey,
    CLIENT_SETTING_DEFAULTS[CLIENT_SETTING_KEYS.byokKey],
  );
  const [byokProvider, setByokProvider] = useClientSetting<
    'gemini' | 'groq' | 'nvidia' | 'cerebras' | 'openai'
  >(CLIENT_SETTING_KEYS.byokProvider, CLIENT_SETTING_DEFAULTS[CLIENT_SETTING_KEYS.byokProvider]);

  const [inputVal, setInputVal] = useState(byokKey);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setByokKey(inputVal.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClear = () => {
    setInputVal('');
    setByokKey('');
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-primary font-mono text-sm tracking-[0.12em] uppercase">
          Bring Your Own Key (BYOK)
        </p>
        <p className="text-muted-foreground mt-1 max-w-2xl text-xs leading-5">
          RECSY runs 100% on free server tiers. Provide your own free API key to unlock unlimited
          frontier reasoning without hitting shared server rate limits. Keys are stored locally in
          your browser and strictly redacted from server logs.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[160px_1fr_auto]">
        <select
          value={byokProvider}
          onChange={(e) =>
            setByokProvider(
              e.target.value as 'gemini' | 'groq' | 'nvidia' | 'cerebras' | 'openai' | 'openrouter',
            )
          }
          className="border-outline bg-background text-primary focus:border-primary border px-3 py-2 font-mono text-xs tracking-wider uppercase focus:outline-none"
        >
          <option value="gemini">Google Gemini</option>
          <option value="groq">Groq Cloud</option>
          <option value="nvidia">NVIDIA NIM</option>
          <option value="cerebras">Cerebras</option>
          <option value="openai">OpenAI / Compatible</option>
        </select>

        <input
          type="password"
          placeholder={
            byokKey ? '••••••••••••••••••••••••' : 'Enter API Key (e.g. AIzaSy... or gsk_...)'
          }
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          className="border-outline bg-background text-primary focus:border-primary border px-3 py-2 font-mono text-xs focus:outline-none"
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            className="border-primary bg-primary text-primary-foreground px-4 py-2 font-mono text-xs tracking-wider uppercase transition-opacity hover:opacity-90"
          >
            {saved ? 'Saved ✓' : 'Save Key'}
          </button>
          {byokKey ? (
            <button
              type="button"
              onClick={handleClear}
              className="border-outline hover:border-destructive text-muted-foreground hover:text-destructive border px-3 py-2 font-mono text-xs tracking-wider uppercase transition-colors"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>
      {byokKey ? (
        <p className="font-mono text-[11px] tracking-wide text-emerald-500">
          ✓ Active BYOK key configured for {byokProvider.toUpperCase()}. All requests bypass server
          rate limits.
        </p>
      ) : null}
    </div>
  );
}

function EnterToSendToggle() {
  const [enabled, setEnabled] = useClientSetting<boolean>(
    CLIENT_SETTING_KEYS.enterToSend,
    CLIENT_SETTING_DEFAULTS[CLIENT_SETTING_KEYS.enterToSend],
  );
  const labelId = useId();
  const descId = useId();

  return (
    <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-start">
      <div className="min-w-0">
        <p id={labelId} className="text-primary font-mono text-sm tracking-[0.12em] uppercase">
          Enter key sends message
        </p>
        <p id={descId} className="text-muted-foreground mt-3 max-w-2xl text-xs leading-5">
          When enabled, pressing Enter submits messages on recommend and phone Q&A pages. Use
          Shift+Enter for a newline. When disabled, Enter always inserts a newline.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-labelledby={labelId}
        aria-describedby={descId}
        onClick={() => setEnabled(!enabled)}
        className={cn(
          'relative inline-flex h-8 w-16 shrink-0 cursor-pointer items-center border transition-colors focus-visible:outline-none',
          enabled ? 'border-primary bg-primary' : 'border-outline bg-background',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'bg-background inline-block size-6 transform transition-transform',
            enabled ? 'translate-x-9' : 'translate-x-1',
          )}
        />
      </button>
    </div>
  );
}

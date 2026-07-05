import type { AgentModelDefinition } from "../../agent-sdk-types.js";

export const ANTIGRAVITY_MODELS: AgentModelDefinition[] = [
  {
    provider: "antigravity",
    id: "default",
    label: "Default",
    description: "Use the model last selected in the agy TUI",
    isDefault: true,
  },
  {
    provider: "antigravity",
    id: "Gemini 3.1 Pro (High)",
    label: "Gemini 3.1 Pro (High)",
    description: "Gemini 3.1 Pro (High) model",
  },
  {
    provider: "antigravity",
    id: "Gemini 3.1 Pro (Low)",
    label: "Gemini 3.1 Pro (Low)",
    description: "Gemini 3.1 Pro (Low) model",
  },
  {
    provider: "antigravity",
    id: "Gemini 3.5 Flash (High)",
    label: "Gemini 3.5 Flash (High)",
    description: "Gemini 3.5 Flash (High) model",
  },
  {
    provider: "antigravity",
    id: "Gemini 3.5 Flash (Medium)",
    label: "Gemini 3.5 Flash (Medium)",
    description: "Gemini 3.5 Flash (Medium) model",
  },
  {
    provider: "antigravity",
    id: "Gemini 3.5 Flash (Low)",
    label: "Gemini 3.5 Flash (Low)",
    description: "Gemini 3.5 Flash (Low) model",
  },
  {
    provider: "antigravity",
    id: "Claude Sonnet 4.6 (Thinking)",
    label: "Claude Sonnet 4.6 (Thinking)",
    description: "Claude Sonnet 4.6 (Thinking) model",
  },
  {
    provider: "antigravity",
    id: "Claude Opus 4.6 (Thinking)",
    label: "Claude Opus 4.6 (Thinking)",
    description: "Claude Opus 4.6 (Thinking) model",
  },
  {
    provider: "antigravity",
    id: "GPT-OSS 120B (Medium)",
    label: "GPT-OSS 120B (Medium)",
    description: "GPT-OSS 120B (Medium) model",
  },
];

export function getAntigravityModels(): AgentModelDefinition[] {
  return ANTIGRAVITY_MODELS.map((model) => Object.assign({}, model));
}

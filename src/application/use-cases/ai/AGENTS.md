<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-24 -->

# ai

## Purpose

AI-assisted signage management. Provides a chat interface where users interact with an LLM that has tools to create/edit/delete content, playlists, and schedules. Uses Vercel AI SDK v6 for streaming responses with tool calling.

## Key Files

| File                          | Description                                                            |
| ----------------------------- | ---------------------------------------------------------------------- |
| `ai-chat.use-case.ts`         | Main chat use case — calls `streamText()` with tools and system prompt |
| `ai-tool-registry.ts`         | All AI tool definitions with Zod input schemas                         |
| `ai-tool-executor.ts`         | Dispatches tool calls to domain use cases                              |
| `ai-credentials.use-cases.ts` | AI provider API key management (encrypted storage)                     |
| `system-prompt.ts`            | System prompt, injection detection, input sanitization                 |
| `tiptap-convert.ts`           | Plain text to TipTap rich text format conversion                       |
| `index.ts`                    | Barrel export                                                          |

## For AI Agents

### Working In This Directory

- Tool schemas in `ai-tool-registry.ts` must stay in sync with: executor and system prompt
- `create_schedule` uses `z.discriminatedUnion("kind", ...)` — PLAYLIST vs FLASH variants
- `edit_content` accepts plain `text` field — auto-converted to TipTap format
- System prompt is strictly scoped to digital signage tasks with injection detection

### Testing Requirements

- Tool schema tests: verify Zod schemas accept/reject expected inputs
- TipTap conversion tests in `tests/application/ai/tiptap-convert.test.ts`
- AI tool executor tests in `tests/application/ai/ai-tool-executor.test.ts`

<!-- MANUAL: -->

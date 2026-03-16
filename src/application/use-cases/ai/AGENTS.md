<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-16 | Updated: 2026-03-16 -->

# ai

## Purpose

AI-assisted signage management. Provides a chat interface where users interact with an LLM that has tools to create/edit/delete content, playlists, and schedules. Uses Vercel AI SDK v6 for streaming responses with tool calling.

## Key Files

| File                             | Description                                                                |
| -------------------------------- | -------------------------------------------------------------------------- |
| `ai-chat.use-case.ts`            | Main chat use case — calls `streamText()` with tools and system prompt     |
| `ai-tool-registry.ts`            | All 13 AI tool definitions with Zod input schemas                          |
| `ai-tool-executor.ts`            | Dispatches tool calls to domain use cases                                  |
| `ai-confirm.use-case.ts`         | Pending action confirmation flow (Redis-backed) for destructive operations |
| `ai-credentials.use-cases.ts`    | AI provider API key management (encrypted storage)                         |
| `manage-credentials.use-case.ts` | CRUD for AI credentials                                                    |
| `system-prompt.ts`               | System prompt, injection detection, input sanitization                     |
| `tiptap-convert.ts`              | Plain text → TipTap rich text format conversion                            |
| `index.ts`                       | Barrel export                                                              |

## For AI Agents

### Working In This Directory

- Tool schemas in `ai-tool-registry.ts` must stay in sync with: executor, confirm handler, and system prompt
- Destructive tools (edit/delete) use `requiresConfirmation: true` — routed through Redis pending action store
- `create_schedule` uses `z.discriminatedUnion("kind", ...)` — PLAYLIST vs FLASH variants
- `edit_content` accepts plain `text` field — auto-converted to TipTap format in confirm handler
- System prompt is strictly scoped to digital signage tasks with injection detection

### Testing Requirements

- Tool schema tests: verify Zod schemas accept/reject expected inputs
- TipTap conversion tests in `tests/application/ai/tiptap-convert.test.ts`

<!-- MANUAL: -->

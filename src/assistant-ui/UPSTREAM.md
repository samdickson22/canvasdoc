# assistant-ui components

Adapted from [assistant-ui](https://github.com/assistant-ui/assistant-ui), including
`templates/minimal`, `apps/docs/components/pages/examples/chatgpt.tsx`, and the
registry's tool components. The upstream MIT notice is retained in [LICENSE](LICENSE).

Canvasdoc supplies the runtime and browser persistence in `src/conversation.tsx`.
The components use local imports, Base UI, and shadow-root menu containers.
Tailwind is compiled into Canvasdoc's shadow roots to isolate it from Canvas.
Canvas supplies navigation, so the demo thread list and decorative buttons are omitted.

`run-activity.tsx` renders reasoning and tool calls in one collapsible work history
through `MessagePrimitive.GroupedParts`. `canvasdoc-tools.tsx` renders each Codex item
inside that group with rows adapted from the registry's tool-call, terminal-block,
file-tree, and tool-error elements; unknown and MCP tools keep `ToolFallback`.
`surfaces.tsx`, `approval-card.tsx`, `empty-state.tsx`, `connection-state.tsx`,
`artifact-card.tsx`, and `mermaid-diagram.tsx` are adapted from the same elements
registry (`r.assistant-ui.com`) with local imports and Canvasdoc's palette. Mermaid
renders through `beautiful-mermaid`, built separately as `dist/mermaid.js` and
imported on demand. Conversation behavior stays with assistant-ui primitives.

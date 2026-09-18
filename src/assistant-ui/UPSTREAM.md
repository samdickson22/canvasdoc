# assistant-ui components

Adapted from [assistant-ui](https://github.com/assistant-ui/assistant-ui), including
`templates/minimal`, `apps/docs/components/pages/examples/chatgpt.tsx`, and the
registry's tool components. The upstream MIT notice is retained in [LICENSE](LICENSE).

Canvasdoc supplies the runtime and browser persistence in `src/conversation.tsx`.
The components use local imports, Base UI, and shadow-root menu containers.
Tailwind is compiled into Canvasdoc's shadow roots to isolate it from Canvas.
Canvas supplies navigation, so the demo thread list and decorative buttons are omitted.

`run-activity.tsx` renders reasoning and tool calls in one collapsible work history
through `MessagePrimitive.GroupedParts`. The individual tool renderer remains
inside that group. Conversation behavior stays with assistant-ui primitives.

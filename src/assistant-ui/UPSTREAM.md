# assistant-ui starter components

Copied from https://github.com/assistant-ui/assistant-ui/tree/main/templates/minimal on 2026-09-14.

The Thread, Composer, message, Markdown, attachment, and tool components use the upstream starter. Imports resolve within this directory. Canvasdoc supplies its runtime and browser persistence in src/conversation.tsx. Tailwind is compiled into the existing shadow roots so the starter's CSS stays isolated from Canvas.

Keep product layout changes outside these components until the baseline has been reviewed. Do not replace library behaviors with custom handlers.

The active chat now uses apps/docs/components/pages/examples/chatgpt.tsx from the same upstream repository. Its separate demo thread-list shell is omitted because Canvas supplies navigation. Imports and shadow-root menu containers are adapted locally, the disclaimer names Canvasdoc, and decorative Share/voice-mode buttons without handlers are omitted. Both dashboard and assignment conversations use this component.

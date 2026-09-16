# Canvasdoc privacy

Canvasdoc connects your Canvas browser session to an agent running on your computer. It currently supports Cal Poly Canvas.

Course information and accessible materials are read using your existing Canvas login. Downloaded materials and agent-generated files are stored in your chosen Canvasdoc folder. Conversations, drafts, personal tasks, and preferences are stored in browser extension storage; recovery exports are also written to your local workspace.

When you send a message, Canvasdoc forwards it and references to relevant workspace files to your local Codex runtime. Codex can read files as part of fulfilling your request and send their contents to its model provider. That provider's terms and data policies apply. Canvasdoc is not an offline inference product.

Canvas session cookies are used by the browser for authenticated Canvas requests. Canvasdoc does not forward those cookies to the model provider or ask you to create a Canvas API token. The local bridge uses a connection credential stored on your computer.

Canvasdoc does not include an analytics or advertising service. It does not sell data. It does not automatically submit coursework or change official submissions during material synchronization. Clicking a to-do completion control updates your Canvas planner checkmark.

Removing the extension removes its browser-managed storage. Local workspace files, recovery exports, and Codex's own session records remain until you delete them. Clear or remove those separately if desired.

Questions and privacy reports: https://github.com/samdickson22/canvasdoc/issues . Do not include passwords, session cookies, or private course content in public reports.

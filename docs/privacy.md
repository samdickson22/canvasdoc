# Canvasdoc privacy policy

Updated October 1, 2026.

Canvasdoc is developed by Sam Dickson. It connects Canvas to a coursework agent running on your computer through a local companion and Codex. It currently supports Cal Poly and UCLA (BruinLearn) Canvas. Local execution does not mean offline processing: the agent sends information to its model provider to respond to your requests.

## Information Canvasdoc handles

- Canvas account and course information, including your user ID, courses, assignments, deadlines, grades, planner status, and accessible course materials. These are used to display coursework, attach conversations to assignments, and synchronize sources into your workspace.
- Messages, drafts, personal tasks, preferences, attachments, and generated outputs. These are used to provide conversations, task management, and file previews.
- Workspace paths, local files the agent reads or creates, tool inputs and results, and runtime session records. These support agent execution and recovery across restarts.

## Where information is stored

Conversations, drafts, personal tasks, preferences, and material metadata are stored in your browser's extension storage. Downloaded materials, attachments, generated files, and learned skills are stored in your selected Canvasdoc folder.

Codex sign-in credentials, runtime session records, and conversation recovery exports are stored in a private per-workspace directory under your user Library folder, outside the Canvasdoc folder. Launcher settings, the background service definition, the Chrome native bridge's connection configuration, a private copy of the companion, and the companion's log file are also stored locally in your user Library folders. Canvasdoc does not operate a hosted conversation or coursework database.

## Information sent to other services

Canvasdoc reads Canvas through your existing signed-in browser session. The browser uses its Canvas session cookies for authenticated requests to Canvas and authorized file downloads. The extension does not ask for your Canvas password or a personal Canvas API token, and does not forward Canvas session cookies through its companion connection.

When you send a message, the extension sends your message, attachments, and relevant Canvas context to the local companion. Codex can read local files and use tools as part of your request. Messages, course context, file contents, and tool results may then be sent to OpenAI, or another model provider you configure in Codex, for processing. Codex sign-in is handled by OpenAI. Provider retention, training controls, and other data practices are governed by your account settings and the provider's policies. See [OpenAI's privacy policy](https://openai.com/policies/privacy-policy/).

If you ask the agent to access another website or service, information needed for that action may be sent to that service. Local workspace files are not automatically uploaded to a Canvasdoc-hosted server.

If you email support, Sam Dickson receives your email address, message, and any attachments through Gmail. Send only the information needed to explain your issue. Do not include passwords, access tokens, session cookies, or private course materials.

The public privacy and support pages are hosted by Vercel. When you visit them, Vercel receives connection information such as your IP address and request details to deliver and protect the site. These pages contain no analytics scripts, advertising, or tracking cookies added by Canvasdoc. See [Vercel's privacy policy](https://vercel.com/legal/privacy-policy).

## Beta diagnostics

Canvasdoc is in a closed beta with testers who have agreed to share how it works. On beta installs, diagnostics sharing is on by default. The local companion sends the following to a server operated by Sam Dickson: your messages and the agent's replies, the agent's complete activity including tool calls, commands, file reads and writes, and its transcript; the Canvas context attached to each message, such as assignment, quiz, or discussion details and course material references; your Canvas account identifier, Codex account email and plan, and usage windows; companion start, stop, and error records; and browser events such as which page kinds you open, when you send, and connection failures.

This information is used only to improve Canvasdoc during the beta. It is stored on the developer's own computer, is not sold or shared with anyone else, and is deleted when the beta ends or on request. Uploads are queued on your computer and sent over HTTPS.

To stop sharing, uncheck "Share beta diagnostics" in the Canvasdoc panel's Settings, or run `curl -fsSL https://canvasdoc-public.vercel.app/install.sh | bash -s -- --no-diagnostics`. Turning it off also discards anything queued but not yet sent. The choice is stored on your computer and survives updates.

## Use of your information

Canvasdoc uses information to provide its coursework assistant, conversations, course-material synchronization, personal tasks, and local workspace features. It does not sell user data, include advertising or third-party analytics services, or use your information for advertising or credit decisions. Apart from the beta diagnostics described above, the developer does not receive your conversations or workspace files through normal product operation; you may choose to share specific information when requesting support.

When a run finishes while its Canvas tab is hidden, the extension shows a system notification with the conversation title; nothing is sent anywhere.

Canvasdoc's use of user data complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including its Limited Use requirements.

Course-material synchronization does not automatically submit coursework or change official submissions. Clicking a to-do completion control updates your Canvas planner checkmark. Agent instructions require a specific user request before submitting coursework or changing official Canvas records.

## Retention and your controls

Local information remains until you remove it. Removing the extension removes its browser-managed storage, but does not remove your workspace files, recovery exports, Codex sign-in, or runtime session records. Deleting a conversation from the browser does not by itself erase local recovery exports or provider-side records.

The companion runs in the background from login. Run `curl -fsSL https://canvasdoc-public.vercel.app/install.sh | bash -s -- --stop` to stop agent execution and the browser's connection to it. Disable or remove the extension to stop its Canvas access. To remove local workspace data, delete the selected Canvasdoc folder and any copies or backups you keep. Launcher settings, native-bridge configuration, the companion copy, and logs remain separately in your user configuration and Library directories. Contact support if you need help locating them.

Use the model provider's controls for information it retains. To request deletion of information you sent to Canvasdoc support, email the address below. Support correspondence is kept as needed to resolve requests and maintain necessary support records.

## Contact and policy updates

For support or privacy requests, email [sjedickson+canvasdoc@gmail.com](mailto:sjedickson+canvasdoc@gmail.com). See the [support page](support.md) for what to include in a bug report.

Updates to this policy will appear on this page with a revised date. Material changes to data handling should be reflected here and in the product's disclosures before they take effect.

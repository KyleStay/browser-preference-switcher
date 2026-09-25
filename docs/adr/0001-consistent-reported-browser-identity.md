# Change request headers without attaching a debugger

The initial design attached Chrome's debugger protocol to matched tabs so the extension could override browser identity in JavaScript as well as in request headers. The user then saw Chrome's “debugging” notification and preferred to remove that behavior.

The current design uses declarative request rules to change the User-Agent and selected User-Agent Client Hint headers. It does not request the `debugger` permission or attach to tabs. Page JavaScript still sees Brave's Chromium identity, so sites that inspect JavaScript properties or high-entropy hints may detect Brave. This favors a quieter, narrower extension permission over fully aligned browser identity.

# Feishu Bridge — end-to-end demo.
# Renders: assets/demo.gif

Output assets/demo.gif

Set Theme "Catppuccin Mocha"
Set FontFamily "Menlo"
Set FontSize 14
Set Width 1100
Set Height 680
Set Padding 18
Set TypingSpeed 35ms
Set PlaybackSpeed 1.0

# --- hidden bootstrap: put local shims on PATH (run `vhs assets/demo.tape` from repo root) ---
Hide
Type "export PATH=$PWD/assets/bin:$PATH"
Enter
Type "clear"
Enter
Show

Sleep 300ms

# === Section 1 — the pitch ===
Type "# Feishu Bridge — one core, two surfaces (CLI + MCP)."
Sleep 400ms
Enter

Type "feishu-bridge ping"
Sleep 200ms
Enter
Sleep 1100ms

# === Section 2 — CLI form pulls real Feishu data ===
Type "# 1) CLI form — your shell can call it directly."
Sleep 400ms
Enter

Type "feishu-bridge user-recent-work --user-id ou_3de3e555c2c803d3561d7a325c89002f --days 30 | jq -rf assets/format.jq"
Sleep 200ms
Enter
Sleep 3000ms

# === Section 3 — MCP form, same core ===
Type "# 2) MCP form — the SAME core, exposed over JSON-RPC."
Sleep 400ms
Enter

Type "head -1 assets/mcp-call.jsonl"
Sleep 200ms
Enter
Sleep 1000ms

Type "cat assets/mcp-call.jsonl | feishu-bridge-mcp | tail -1 | jq -rf assets/format-mcp.jq"
Sleep 200ms
Enter
Sleep 3000ms

# === Section 4 — the final artifact ===
Type "# 3) End-to-end: a real meeting brief, generated from the bridge."
Sleep 400ms
Enter

Type "cat examples-meeting-brief.md"
Sleep 200ms
Enter
Sleep 2500ms

# === Section 5 — wrap-up ===
Type "# Same business logic. Two surfaces. AI Friendly is design, not protocol."
Sleep 700ms
Enter
Sleep 1200ms

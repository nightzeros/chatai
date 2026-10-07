# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.1.x | Yes |
| 1.0.x | Security fixes only; please upgrade to 1.1 |
| < 1.0 | No (pre-release; upgrade to 1.1) |

Voice is a **preview** feature in 1.1. Security reports about Voice are in scope and handled like any other report.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Email **hello@nightzeros.com** (or open a private [GitHub Security Advisory](https://github.com/nightzeros/chatai/security/advisories/new) if available) with:

- A description of the issue and impact
- Steps to reproduce or a proof of concept
- Affected version / commit if known

We aim to acknowledge reports within **72 hours** and provide a remediation timeline after triage.

## Scope

In scope for ChatAI:

- Authentication / authorization bypass, including the admin API
- Widget abuse (origin spoofing past allowlist, signature bypass, rate-limit bypass)
- Secret leakage (API keys, provider keys, encryption keys, conversation data)
- Voice session abuse: minting sessions for an assistant you don't control, exceeding usage limits, accessing another owner's transcripts or recordings
- Usage metering or billing bypass (for example avoiding enforced limits or forging Polar webhooks)
- Injection against the dashboard or public API

Out of scope:

- Denial of service against a self-hosted instance you control
- Issues in third-party LLM providers
- Model answers that drift off-topic or ignore instructions without exposing data or bypassing a control (report these as bugs)
- Social engineering

## Disclosure

We prefer coordinated disclosure. After a fix is released, we will credit reporters who wish to be named in the advisory or release notes.

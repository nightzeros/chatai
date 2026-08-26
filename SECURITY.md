# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | Yes |
| < 1.0 | No (pre-release; upgrade to 1.x) |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Email **security@master-tecs.dev** (or open a private [GitHub Security Advisory](https://github.com/master-tecs/chatai/security/advisories/new) if available) with:

- A description of the issue and impact
- Steps to reproduce or a proof of concept
- Affected version / commit if known

We aim to acknowledge reports within **72 hours** and provide a remediation timeline after triage.

## Scope

In scope for ChatAI:

- Authentication / authorization bypass
- Widget abuse (origin spoofing past allowlist, signature bypass)
- Secret leakage (API keys, encryption keys, conversation data)
- Injection against the dashboard or public API

Out of scope:

- Denial of service against a self-hosted instance you control
- Issues in third-party LLM providers
- Social engineering

## Disclosure

We prefer coordinated disclosure. After a fix is released, we will credit reporters who wish to be named in the advisory or release notes.

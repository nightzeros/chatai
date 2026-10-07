# Roadmap

Public product roadmap for ChatAI, an open-source project maintained by [NightZeros](https://nightzeros.com). For discussion, use [GitHub Discussions](https://github.com/nightzeros/chatai/discussions). For bugs and features, open an [issue](https://github.com/nightzeros/chatai/issues).

## Shipped

| Milestone | Highlights |
| --- | --- |
| **v0.1** Core RAG | Assistants, knowledge upload, playground, citations, hallucination modes |
| **v0.2** Embeddable | Hosted widget, React package, customize + install |
| **v0.3** Observability | Conversations, feedback, analytics, RAG debugger |
| **v0.4** Knowledge | Website crawler, more formats, source management |
| **v0.5** RAG quality | Hybrid search, reranking, evals, answer verifier |
| **v0.6** Developer platform | Providers, API keys, REST + OpenAPI, TypeScript SDK |
| **v0.7** Self-hosting | Docker Compose, docs site, Ollama profile |
| **v0.8** Security + privacy | Domain allowlist, rate limits, encryption, retention, audit log |
| **v0.9–v1.0** Stabilization | API/schema freeze, semver guarantees, load tests, community infra |
| **v1.1** Public preview | Voice (preview) in the widget, Purpose and scope enforcement, assistant Profile and Key facts, hosted usage metering and plans, Polar billing, npm packages under `@nightzeros`, Apache-2.0 |

## Next

Prioritized by expected demand. None of these break the v1 API contract without a major bump.

1. **Voice GA** — complete acceptance testing, then stabilize Voice configuration and remove the preview label
2. **AI Actions / Tools** — function calling, webhooks, MCP
3. **Human handoff** — escalate to Slack/email, then helpdesks
4. **Leads** — optional in-chat contact capture
5. **Teams / organizations** — multi-user ownership (additive schema)
6. **Multi-language** — detect language, answer in the visitor’s language

## How we prioritize

- Security and stability bugs first
- Issues labeled `good first issue` for new contributors
- Community votes on Discussions and feature requests inform ordering

See also [CHANGELOG.md](./CHANGELOG.md) and [docs/RELEASE.md](./docs/RELEASE.md).

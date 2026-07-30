# Security policy

## Supported versions

The latest minor release on the `main` branch receives security fixes. Until 1.0, older
minors are not patched.

## Reporting a vulnerability

Please report privately, not in a public issue:

1. Preferred: open a [private security advisory](https://github.com/open-moderation-lexicon/open-moderation-lexicon/security/advisories/new)
   on GitHub.
2. Alternative: email the maintainers listed in `package.json`.

Please include the affected version, reproduction steps or a proof of concept, and the impact
you believe it has. We aim to acknowledge within 3 working days and to ship a fix or a
mitigation plan within 30 days for anything we can reproduce. We will credit you in the
release notes unless you would rather stay anonymous.

Please do not include real user content in a report.

## What is in scope

- Remote crashes, hangs or unbounded memory growth triggered by a request body, including
  algorithmic complexity attacks against the matcher or the normalizer.
- Bypassing `MAX_TEXT_LENGTH`, `MAX_BODY_BYTES`, `BATCH_MAX_ITEMS`, the rate limiter or
  `API_TOKEN` authentication.
- Leaking a server path, a stack trace, an environment variable or another request's data in
  a response or a log line.
- Reading or writing a file outside the package as a result of client-supplied input.
- Any way to modify the loaded lexicon at runtime through the API.

## What is not in scope

**Detection quality is not a vulnerability.** A term that should have matched and did not, or
matched and should not have, is a false negative or a false positive. Please report those as
regular issues — see [CONTRIBUTING.md](./CONTRIBUTING.md). Evading a keyword filter is
expected to be possible; this project makes no claim otherwise, and a novel evasion technique
is a feature request for `fuzzy` mode rather than a security report.

Also out of scope:

- Running the server with `LOG_TEXT=true` and observing user content in the logs. That is
  documented behaviour of an option that is off by default.
- Exposing the server to the internet without `API_TOKEN`, without a rate limit, or with
  `CORS_ORIGIN=*`. These are deployment choices; the defaults are conservative.
- Content of the upstream lexicon. Take those to
  [konsheng/Sensitive-lexicon](https://github.com/konsheng/Sensitive-lexicon).
- Vulnerabilities in dependencies without a demonstrated path through this project's code.
  Dependency updates are automated; open a regular issue if one is missed.

## Hardening notes for operators

- Set `API_TOKEN` and put the service behind TLS. The server speaks plain HTTP by design and
  expects a reverse proxy.
- Set `ENABLE_DOCS=false` in production if you do not want the schema published.
- Leave `LOG_TEXT=false`. Logs then contain a request id, a duration, a text length, a hit
  count and category names — never the submitted text and never the matched terms.
- Set `TRUST_PROXY=true` only when a proxy you control sets `X-Forwarded-For`; otherwise a
  client can spoof it and defeat the rate limiter.
- The in-memory rate limiter is per process. Behind several instances, enforce limits at the
  proxy.
- The container runs as a non-root user and needs no write access to its filesystem; mount it
  read-only if your platform supports that.

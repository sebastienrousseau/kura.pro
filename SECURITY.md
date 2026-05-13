# Security Policy

CloudCDN takes the integrity of the assets we deliver and the systems we run very seriously. This document explains how to report vulnerabilities responsibly and what to expect in response.

## Supported versions

CloudCDN is delivered as a continuously deployed service from `main`. There are no long-lived release branches — the only supported version of the code is the current `HEAD` of `main` on this repository. Security fixes are rolled forward, never backported.

The published API exposes a date-based version (`X-API-Version`, currently `2026-04-01`). When a new API version is published, the previous version is supported for **at least 12 months** before sunset. Sunset dates are announced via the `Deprecation` and `Sunset` response headers (RFC 8594) at least 90 days in advance.

## Reporting a vulnerability

Please report suspected vulnerabilities to **security@cloudcdn.pro**. Encrypt sensitive details using the PGP key published at <https://cloudcdn.pro/.well-known/security.txt>.

When reporting, please include:

- A description of the issue and the impact you observed
- A minimal reproduction (URL, request, payload)
- The affected endpoint(s) or component(s)
- Your environment (browser, region, time of observation)
- Whether you have disclosed the issue elsewhere

**Do not** open a public GitHub issue, post on social media, or share the finding with third parties before we have had a chance to respond.

## What to expect

| Stage | Target |
|---|---|
| Acknowledgement of receipt | within **3 business days** |
| Initial severity assessment | within **7 days** |
| Status update cadence during investigation | every **14 days** |
| Coordinated disclosure window | **90 days** from report, extendable by mutual agreement |

We will credit reporters in the release notes for the fix unless you ask us not to. We do not currently run a paid bug bounty programme, but we routinely thank researchers publicly and via in-product acknowledgement.

## Scope

In scope:

- The CloudCDN API and its endpoints (`/api/*`)
- The asset delivery surface served from `cloudcdn.pro` and configured custom domains
- The MCP server (`@cloudcdn/mcp-server`) published to npm
- The asset dashboard (`/dashboard/*`) and supporting client libraries
- The CI/CD pipeline and its supply chain (signed commits, SLSA provenance)

Out of scope:

- Denial-of-service attacks (please do not run load tests against production)
- Findings that depend on a compromised user device, browser, or third-party account
- Self-XSS in the dashboard that requires the victim to paste payloads into their own console
- Reports based solely on the absence of a defence-in-depth header where the underlying class of attack is otherwise mitigated
- Outdated dependency reports without a working exploit chain — please file these as a Dependabot alert or PR instead

## Disclosure principles

- We will not pursue legal action against good-faith security research conducted in accordance with this policy.
- We will keep you informed of progress and target dates for remediation.
- We will give you the option to review the fix and the public advisory text before disclosure.
- Critical fixes ship as soon as a verified mitigation is available; the advisory follows once the fleet is patched.

Thank you for helping keep CloudCDN and its users safe.

# CloudCDN — Compliance & Privacy

## Data Processing

### What Data Does CloudCDN Handle?
CloudCDN serves static files (images, icons, fonts). It does not process, store, or transmit personal user data. The only data flow is:
1. A browser requests a static file URL.
2. Cloudflare's edge serves the cached file.
3. Standard HTTP logs are generated (IP, timestamp, URL, user-agent).

### Where Is Data Stored?
- **Source files:** GitHub repository (hosted in US by GitHub/Microsoft).
- **Edge cache:** Cloudflare's 300+ global PoPs. Cached copies are distributed worldwide for performance.
- **AI Concierge data:** Conversations are not stored. The chat widget uses in-memory session state only — no server-side logging of user queries.
- **Rate limiting counters:** Stored in Cloudflare Workers KV (aggregate counts only, no personal data).

## GDPR Compliance

### Status
CloudCDN is GDPR compliant. We use Cloudflare as our infrastructure provider, which maintains GDPR compliance through:
- EU-US Data Privacy Framework certification.
- Standard Contractual Clauses (SCCs) for international data transfers.
- Data Processing Agreements available on request.

### Data Minimization
- No cookies are set by CloudCDN.
- No user tracking or analytics pixels.
- No personal data is collected, stored, or processed.
- HTTP access logs are handled by Cloudflare under their privacy policy.

### Data Subject Rights
Since CloudCDN does not collect personal data, there is no personal data to access, correct, or delete. If you believe your personal data has been inadvertently included in an asset (e.g., a photo), contact support@cloudcdn.pro for removal.

### DPA (Data Processing Agreement)
Enterprise customers can request a formal DPA. Contact sales@cloudcdn.pro.

## CCPA / CPRA (California)
CloudCDN does not sell, share, or use personal information for targeted advertising. No opt-out mechanism is required as no personal data is collected.

## SOC 2 / ISO 27001
CloudCDN leverages Cloudflare's infrastructure, which maintains:
- SOC 2 Type II certification.
- ISO 27001 certification.
- PCI DSS Level 1 compliance.
These certifications cover the edge delivery infrastructure used by CloudCDN.

## Security Measures
- **Encryption in transit:** TLS 1.3 on all connections.
- **DDoS protection:** Cloudflare's automatic DDoS mitigation on all plans.
- **WAF:** Cloudflare Web Application Firewall active on all endpoints.
- **Bot mitigation:** Cloudflare Bot Management protects against scraping and abuse.
- **Signed commits:** All asset changes require cryptographic verification.
- **Branch protection:** Force pushes and history rewrites are blocked.
- **Secret management:** API tokens stored as encrypted GitHub Secrets, never in code.

## Asset Integrity
Every asset served by CloudCDN is traceable to a signed Git commit. This provides:
- **Provenance:** Every file change is linked to a verified contributor.
- **Audit trail:** Full Git history with signed commit verification.
- **Tamper detection:** Any unauthorized modification breaks the signature chain.

## Acceptable Use
CloudCDN is for static asset delivery only. Prohibited uses include:
- Hosting malware or phishing content.
- Video streaming or large file distribution (>25 MB).
- Storing personal data, credentials, or sensitive information in assets.
- Using the service to circumvent other services' terms.

Violations result in account suspension with 24-hour notice (except for illegal content, which is removed immediately).

## Incident Response
- Security incidents are reported within 72 hours per GDPR requirements.
- Contact security@cloudcdn.pro to report vulnerabilities.
- Enterprise customers receive direct notification via their dedicated Slack channel.

## Contact
- **Privacy inquiries:** privacy@cloudcdn.pro
- **Security reports:** security@cloudcdn.pro
- **DPA requests:** sales@cloudcdn.pro

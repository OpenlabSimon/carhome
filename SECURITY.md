# Security Policy

## Supported Scope

This repository is a demo / MVP codebase for car-image analysis workflows.

Please report:

- exposed credentials
- prompt-injection paths that can leak secrets
- server-side request issues
- unsafe file handling
- remote call configuration flaws

## Reporting

Do not open a public issue for secrets or exploitable vulnerabilities.

Report privately to the repository owner first. If a private security contact
is added later, this document should be updated to point to it.

## Operational Reminder

Never commit:

- `.env.local`
- real production keys
- private image datasets
- customer-generated reports with sensitive business data

# Contributing

SDK integration instructions are in the [README](README.md) and
[user guides](mkdocs/docs/index.md). This page covers repository development.

## Development

Use Node.js 26 and pnpm 12.20.0 for contributor tooling and CI validation.
These tool versions do not set a new minimum runtime for SDK consumers.

Install dependencies with the declared package manager:

```bash
pnpm install --frozen-lockfile
```

Format and lint the project:

```bash
pnpm exec biome check --write .
```

Run the pull-request-safe validation suite:

```bash
pnpm validate
```

Documentation builds and CI use Python 3.15. Create an isolated environment, then install and serve the documentation:

```bash
python3.15 -m venv .venv
source .venv/bin/activate
python -m pip install -r mkdocs/requirements.txt
mkdocs serve -f mkdocs/mkdocs.yml
```

Build documentation strictly:

```bash
mkdocs build --strict -f mkdocs/mkdocs.yml
```

## End-to-end tests with real credentials

The integration tests under `tests/e2e/` use two SIP accounts. Put them in
`.env`:

```bash
SIP_A_DOMAIN=sip.ringcentral.com
SIP_A_OUTBOUND_PROXY=sip10.ringcentral.com:5096
SIP_A_USERNAME=1650...
SIP_A_PASSWORD=...
SIP_A_AUTHORIZATION_ID=...

SIP_B_DOMAIN=sip.ringcentral.com
SIP_B_OUTBOUND_PROXY=sip10.ringcentral.com:5096
SIP_B_USERNAME=1650...
SIP_B_PASSWORD=...
SIP_B_AUTHORIZATION_ID=...

# Available external callee for the signaling-only transfer scenario:
ANOTHER_CALLEE_FOR_TESTING=1650...
```

Run it with:

```bash
NODE_OPTIONS='--import tsx --import ./demos/load-env.ts' pnpm test:e2e
```

The suite runs serially. Avoid overlapping local runs and hosted CI against the
same accounts. Missing credentials or an unavailable external callee fail the
affected scenario; they are not successful verification.

The transfer scenario calls the external callee from A, then transfers that call
to B. B answers and initiates hangup, including in failure cleanup. It checks
signaling only and makes no audio assertion on any leg. Separate audio tests do
not prove transferred audio. CI supplies the external callee through the
`ANOTHER_CALLEE_FOR_TESTING` repository secret.

## Documentation

- Keep the README focused on installation, first calls, common controls, and key limitations.
- Maintain complete public API usage and behavior in `mkdocs/docs/`.
- Put protocol mechanics in [implementation notes](docs/implementation.md) and
  dated verification evidence in `docs/validation/`.
- When behavior changes, update the relevant guide and any affected README examples.

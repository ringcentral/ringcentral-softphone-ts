# SIP exchange compatibility verification

Verified on November 18, 2026 for [#109](https://github.com/ringcentral/ringcentral-softphone-ts/issues/109)
and [#114](https://github.com/ringcentral/ringcentral-softphone-ts/issues/114),
after behavior changes through `72a308b7115d31a44bc0f25c39db286b67797d3e`.
The final integration commit and its hosted results are recorded on #114.

## Local checks

- `pnpm validate`: passed 227 controlled tests, formatting/lint, demo/test type
  checks, build, packaged consumer types, and ESM/CommonJS runtime checks.
- `git grep -niE 'cloud[ _-]*phone' -- README.md mkdocs`: no matches.
- `mkdocs build --strict -f mkdocs/mkdocs.yml`: passed using the declared
  documentation requirements in an isolated Python environment.
- `NODE_OPTIONS='--import tsx --import ./demos/load-env.ts' pnpm test:e2e`:
  passed all 12 tests in nine files, serially, in 76.82 seconds. Existing audio,
  DTMF, hold/unhold, sequential calls, identifiers, decline, shared-registration,
  and signaling-recovery checks ran alongside the two new scenarios.
- After strengthening transaction-identity, callback-ordering, ordinary-ending,
  and configuration-failure cleanup checks,
  reran the dedicated file with the same environment loader and
  `pnpm exec vitest run tests/e2e/call-cancellation-transfer.test.ts --no-file-parallelism --reporter=verbose --silent=false`:
  both tests passed in 7.28 seconds.

## Normal RingCentral observations

Incoming cancellation: A ended its call while B's invitation remained unanswered.
RingCentral can already have answered A's separate leg while B rings; the test
uses ordinary hangup for that answered leg, or CANCEL if it is still pending.
B sent `200 OK` for CANCEL and `487 Request Terminated` for the original INVITE
before `inviteCanceled`. Replies retained the original Call-ID, numeric CSeq,
Via, From, and local To identity. The event carried the original opaque
invitation object. Subsequent answer and decline attempts rejected.

Transfer: two controlled SIP accounts registered as A and B; B's invite listener
was installed before A called the configured external callee. After A's call
was answered, A transferred it to B. The direct REFER response was successful;
two transfer NOTIFY requests arrived and received `200 OK`, including the
successful terminal sipfrag that resolved the existing transfer Promise. B
received and answered the resulting transferred call, then initiated normal
hangup. A's ordinary remote BYE received `200 OK` and disposed its session.
Cleanup attempts normal B hangup before revocation if an assertion fails.

The external callee setting is wired through the existing environment pattern
and the `ANOTHER_CALLEE_FOR_TESTING` repository secret. Missing configuration
fails the scenario rather than skipping it. Local and hosted runs were serialized
against the shared accounts. No required reply was withheld, delayed, or dropped.

## Hosted checks before integration

Each completed behavior commit passed both hosted workflows:

| Child | Test | Documentation |
| --- | --- | --- |
| #111 | [passed](https://github.com/ringcentral/ringcentral-softphone-ts/actions/runs/44410961982) | [passed](https://github.com/ringcentral/ringcentral-softphone-ts/actions/runs/44410961879) |
| #110 | [passed](https://github.com/ringcentral/ringcentral-softphone-ts/actions/runs/44411385370) | [passed](https://github.com/ringcentral/ringcentral-softphone-ts/actions/runs/44411384639) |
| #113 | [passed](https://github.com/ringcentral/ringcentral-softphone-ts/actions/runs/44411695859) | [passed](https://github.com/ringcentral/ringcentral-softphone-ts/actions/runs/44411695821) |
| #112 | [passed](https://github.com/ringcentral/ringcentral-softphone-ts/actions/runs/44412461817) | [passed](https://github.com/ringcentral/ringcentral-softphone-ts/actions/runs/44412461895) |

## Limits

The transfer scenario verifies signaling only, using three numbers and two SIP
credential sets. It makes no audio assertion on any leg. Independent audio-suite
results do not prove transferred audio, network delivery beyond the observed
exchanges, or general interoperability. Controlled tests cover explicit rejection
and race cases; normal live observations do not establish those cases in
production. This work adds no retransmission handling, replay cache, full dialog
matching, or new retry/timeout policy to the SDK. No credentials, identifiers,
authentication material, SDP, or SRTP keys are published here.

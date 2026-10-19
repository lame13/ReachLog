# ReachLog 1.0.0

ReachLog now runs three AI jobs against the mailbox and pipeline it already
tracks. It is not a chat box bolted onto the composer. The worker reads new
replies, changes state when the evidence is strong, writes the next follow-up
from the actual thread, and captures inbound mail that never matched a target.

## Bring your own provider

Open **Settings → Connections → AI automation** and enter a base URL, API key,
and model. ReachLog uses `POST /v1/chat/completions`, so OpenAI, DeepSeek, MiMo,
OpenRouter, Ollama, LM Studio, and compatible gateways work without code
changes. Claude can be used through an OpenAI-compatible gateway.

The provider stays optional. With AI disabled, ReachLog behaves as before.

## Reply triage

Every new inbound message is classified as interested, a question, not now, a
decline, a referral, an out-of-office reply, a vendor pitch, automated mail, or
unclear. The worker extracts the ask, any commitment, and exact supporting
quotes, then:

- moves the pipeline forward at high confidence;
- records the suggested stage even when it does not apply it;
- creates the next follow-up with a reply draft;
- sends ambiguous or negative replies to **AI review**.

It never auto-marks Won. It does not overwrite a stage changed by hand in the
previous seven days. Explicit opt-out language blocks future sending.

## Follow-up autopilot

Due follow-ups are no longer generic reminders. The worker reads the thread and
writes the next email: the unresolved question, the promised material, and one
clear next step. The draft appears on the follow-up and in the send composer.

Auto-send is off by default. When enabled, it applies only inside an existing
thread, only when there is no newer reply, only within the daily limit, and only
after the normal do-not-contact, bounce, and email-verification checks. Cold
outreach is never sent automatically.

## Inbound lead capture

Mail that does not match a target is no longer only an event row. The worker
classifies it, extracts the company, person, need, budget, and timeline, and
creates a target for a high-confidence business lead. Everything else goes to
**AI review** with the source message attached.

## Upgrade

```sh
npm install --global reachlog@1.0.0
```

Migrations through 0009 run on first start. Existing targets, contacts,
accounts, threads, drafts, follow-ups, and schedules are retained. The AI
schedule starts paused. Configure a provider, run the connection test, enable
**AI automation** under **Settings → Background tasks**, and leave auto-send off
until the drafts look right.

Back up the data directory first. Node.js 22 or 24 is required.

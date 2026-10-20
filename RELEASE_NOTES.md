# ReachLog 1.0.0

ReachLog 1.0.0 brings self-hosted AI automation to business conversations. The
worker reads new replies, advances the pipeline when the evidence is strong,
drafts the next follow-up, and captures inbound leads that never matched a target.

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
- saves a reply draft or schedules the next follow-up;
- sends ambiguous or negative replies to **AI review**.

It never auto-marks Won. It does not overwrite a stage changed by hand in the
previous seven days. High-confidence explicit opt-outs block future sending.

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
creates a target for a high-confidence business lead. Uncertain leads go to
**AI review** with the sender, subject, and assessment. Non-lead mail is ignored.

## Upgrade

This release also fixes AI review loading and acceptance, cached-result reuse,
stale follow-up sends after a conversation changes, interrupted worker recovery,
and failure reporting. The npm README now leads with AI automation and fresh
screenshots of the review queue and conversation assessments.

```sh
npm install --global reachlog@1.0.0
```

Migrations through 0009 run on first start. Existing targets, contacts,
accounts, threads, drafts, follow-ups, and schedules are retained. The AI
schedule starts paused. Configure a provider, run the connection test, enable
**AI automation** under **Settings → Background tasks**, and leave auto-send off
until the drafts look right.

Back up the data directory first. Node.js 22 or 24 is required.

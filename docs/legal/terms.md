STATUS: DRAFT — requires review by a qualified person before publication

# Terms of service

HackBuddy is a Discord bot plus a small web console that schools and other
organizations use to run hackathons. These terms cover using the hosted service.

Plain-language first: this is a small community service run in good faith, not a
corporate product. These terms are written to be honest about that. They are **not
legal advice to you**, and having readable terms is not a substitute for the review of
a qualified person (that review is still pending — see the note at the end).

## Who may use it

- A bot is installed into a Discord server by someone who administers that server
  (Manage Server or Administrator permission on the Discord side).
- Installing it means you accept these terms on behalf of the organization running
  the event — usually your school. That organization, not the individual who clicked
  "install", is responsible for the event and its data.
- Participants don't need an account with us. They interact through Discord and
  their data is covered by the privacy policy.

## Who is accountable for what

**The organization (the school) runs its own event.** You decide the event's rules,
the signup questions, who may participate, and how minors' participation is handled
(see the privacy policy for the age-of-consent question). You are responsible for
having the right to process your participants' data — including parental consent
where required. You are also responsible for complying with Discord's own Terms of
Service and Community Rules on your server; we operate inside Discord, and neither of
us can exempt the other from them.

**Participants follow the event's rules and Discord's rules.** The bot is a tool for
your event; it does not replace a code of conduct, and it will not moderate your
community for you.

**We (the operator) run the hosting.** We keep the service working, keep the data
inside the EU, keep it isolated between organizations, and honour the privacy policy.
We do not use your data, we do not look at your event content except to fix a problem
you have asked us to fix or to investigate abuse, and we cannot log in as one of your
organizers — there is deliberately no such feature.

## Acceptable use

Do not use the service to:

- harass, spam, or harm people;
- process personal data of people who have not agreed to your event's signup, or
  data you have no right to process;
- scrape, hammer, or automate the web console or the bot in ways that degrade the
  service for other organizations (the bot's Discord capacity is shared by everyone
  hosted on it — one tenant's burst slows every tenant);
- attempt to access another organization's data, or break the isolation between
  tenants;
- use the service for anything unlawful.

## Suspension

We may pause a server's bot activity — suspend it — if it is abused, broken, or
putting other tenants at risk. What that means, plainly:

- Suspension **stops the bot acting** for that server: no announcements, no
  reminders, no scheduled actions.
- Suspension **does not delete data** and **does not give us access to it**. Your
  organizers keep their accounts and their access throughout.
- We tell you, with a reason and a way to reach us — except where telling you would
  prolong active abuse; in that case the reason is recorded and you can still ask for
  it.
- You can ask us to reverse a suspension, and we will answer.
- Suspension is not a data-access mechanism and not a backdoor: we still cannot act
  as your organizers, and missing scheduled work while suspended is skipped, never
  buffered and replayed.

## The service is best-effort

- The service is provided **as is**, with no warranty and no service-level
  agreement. Hackathons are busy, weird events; we fix things as fast as we reasonably
  can, but we do not guarantee uptime, and a failed event feature is not something we
  can compensate.
- Discord's own outages and rate limits are Discord's; they affect us and you.
- We may change or discontinue the service. If the hosted service ever shuts down,
  we will give organizations notice and a chance to export their data first.

## If something goes wrong

Ask us. A real person reads it. For data requests (export, deletion), see the
privacy policy — it is meant to be a one-step request, not a maze.

## For the maintainer

Keep this section out of any published copy.

### (a) Claims not verified against the code

- **"We cannot log in as one of your organizers / no impersonation"** — this is the
  design decision recorded in issues #22 and #23; the host-operator surface does not
  exist yet, so it is a promise, not a code fact.
- **"Data stays inside the EU"** — owner's stated intent; the deployment must match.
- **"We will give notice and a chance to export before shutdown"** — a commitment
  this service has never had to keep; it is stated intent, not an implemented process.
- **"Data isolated between organizations"** — today enforced at the application
  level; database-enforced isolation (row-level security, issue #19) is not shipped,
  so the isolation guarantee is currently as strong as the application code.
- **"One tenant's burst slows every tenant"** — true today (shared token, no
  per-guild fairness queue, issue #23 R4); the sentence is deliberately honest about
  the current limitation.
- **"Missing scheduled work while suspended is skipped, never buffered"** — the
  freeze contract from issue #23 (FR3); the freeze feature is not built yet.
- **"A real person reads it"** — assume the owner reads the contact inbox; no
  support process exists yet.

### (b) Promises not yet implemented

- Suspension/freeze (flag, notify/silent modes, skip-not-buffer, host control) —
  issue #23 FR1–FR8.
- OAuth-only console sign-in (removal of the shared `ADMIN_PASSWORD`) — issue #22,
  mid-migration; the terms describe the target state.
- Export-before-shutdown tooling — depends on issue #23 R2.

### (c) Numbers that must be updated if configuration changes

- No numeric guarantees are made in this document by design. The retention numbers
  (48 h cleanup default, 72 h/24 h warnings, 7-day session TTL, 30-day proposed grace
  period) live in `docs/legal/privacy.md` and must stay consistent with it; their
  sources are listed there with file and line references.

This draft was machine-drafted for a small community service. It is not legal advice
to the reader, and it still needs review by a qualified person before publication.

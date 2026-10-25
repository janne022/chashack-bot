# Cloudflare Tunnel origin for production Compose

## Goal

Let an existing Unraid `cloudflared` connector reach the application through the Compose stack without publishing Caddy's public HTTP/HTTPS ports or requiring Caddy to obtain a public certificate. Cloudflare terminates browser HTTPS; Caddy serves HTTP on a host port bound to the Unraid LAN address and continues to proxy to the app.

## Requirements

- Keep the existing `cloudflared` connector external to Compose.
- Make the connector's origin URL configurable as a host bind address and port.
- Serve the canonical hostname over HTTP only at Caddy's origin, avoiding an HTTPS redirect loop.
- Trust forwarded headers only from a configured connector source CIDR; keep the app trusting only Caddy's fixed Compose IP.
- Document the Cloudflare published-hostname route, Unraid `.env` values, callback URL, and the no-public-port-forwarding model.
- Use the actual published GHCR `latest` reference in the env example, per the operator's request.

## Implementation checklist

- [x] Add connector origin bind/port/proxy CIDR settings to the Compose env example and Caddy service.
- [x] Remove Caddy ACME email and public 80/443 mappings; configure its site as HTTP-only with trusted-proxy handling.
- [x] Update the production runbook for existing Tunnel connectors and Unraid.
- [ ] Review the Compose/Caddy diff and run non-destructive configuration checks where possible.

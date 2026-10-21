# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the "Secret header (token)" of each sensor is a `secret` field
  of the Gladys configuration. The integration reads it from Gladys, keeps it
  in memory, sends it only in the requests of that sensor, and never writes it
  to `/data` nor to the logs. The scene action "Call an address" can reuse it
  only towards the address of that sensor (same scheme, host and port) (a scene is readable by every user, and
  must not be a way to send the secret elsewhere). An address with credentials
  inside (`http://user:pass@…`) is refused.
- **Logs**: only the host of an address is logged, never its path nor its
  query string (an API key often sits there), nor a header.
- **Stored in `/data`**: `http-json-state.json`, the failures already announced
  to the scenes and the last text read by each text sensor. No secret.
- **Network**: requests go only to the addresses typed by the user, private
  addresses included (they are the main use). Each answer is capped at 1 MB and
  10 seconds (20 seconds for a scene call); redirects are followed on the same host only, never from https to http (3 at most), a redirect to another host is refused and reported.
  HTTPS certificates are verified unless the user unticks "Check the
  certificate". A regular expression typed by the user runs with a deadline of
  half a second. The integration opens no port.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the addresses the user chooses to read or call.

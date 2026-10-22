# Personal Garmin for ChatGPT

Read-only Garmin MCP endpoint deployed as a Node.js Vercel Function. It reuses
`garmin-personal-mcp@0.1.1` and its 25 tools. WorkOS AuthKit handles OAuth login;
the gateway verifies signatures, issuer, resource audience, expiration, the
`openid` scope, and one explicitly allowed WorkOS user ID before running a tool.

## Vercel environment variables

Set these for Production using Vercel's environment-variable settings or CLI.
Keep `GARMIN_PERSONAL_API_KEY` as a Sensitive secret. Never put it in chat, source,
a URL, or the ChatGPT plugin form.

| Name | Value |
| --- | --- |
| `GARMIN_PERSONAL_API_KEY` | Your existing Garmin Personal API key |
| `AUTHKIT_ISSUER` | The HTTPS AuthKit domain, without a trailing slash |
| `AUTHKIT_USER_ID` | Your application login user's `user_…` ID, not the dashboard admin ID |
| `MCP_RESOURCE_URL` | The stable production URL ending in `/mcp` |

The application returns HTTP 503 until all four values are configured. Other
WorkOS users receive HTTP 403 even if they can sign in to the same AuthKit project.
There is no anonymous-data mode or fixed-token fallback.

## WorkOS configuration

1. Use the same WorkOS environment as `AUTHKIT_ISSUER`.
2. Enable AuthKit hosted sign-in and your preferred authentication method.
3. In **Connect → Configuration**, enable **Client ID Metadata Document (CIMD)**.
   Enable DCR only if your ChatGPT connection needs the older registration flow.
4. Add the exact `MCP_RESOURCE_URL` as a **Resource Indicator**. Set it as the
   default as well if desired. Do not use a preview URL.
5. Create your own app login user under **Users** and set `AUTHKIT_USER_ID` to
   that user's ID. Set the user's password yourself or enable an appropriate
   passwordless sign-in method.

Use production AuthKit configuration for ongoing use. A staging AuthKit domain
is suitable for initial integration testing and is not a production environment.

## ChatGPT connection

From ChatGPT web, open **Plugins → Add custom MCP server**. Name it **Personal
Garmin**, supply the stable `/mcp` URL, and select **OAuth**. Use CIMD if the form
offers client registration choices. Complete the WorkOS login using the allowed
app user. Install the resulting personal plugin. Then use it from the same
ChatGPT account in the Android app, subject to account/workspace availability.

## Verification

`npm ci` then `npm test` verifies real JWT signing and validation, denial of
other users, OAuth discovery, closed-state behavior, and the real 25-tool catalog.
These tests use a fake Garmin key and make no Garmin API request.

For live completion, verify OAuth sign-in, invoke `get_profile` through the
deployed endpoint, and then invoke `list_activities` from ChatGPT. A successful
deployment alone does not establish that mobile access works.

## Endpoints

- `/mcp`: protected stateless Streamable HTTP MCP
- `/.well-known/oauth-protected-resource`: OAuth resource metadata
- `/.well-known/oauth-protected-resource/mcp`: equivalent path-specific metadata
- `/`: public service description, with no Garmin data

## References

- https://github.com/Shape-Calendar/garmin-personal-mcp
- https://workos.com/docs/authkit/mcp
- https://developers.openai.com/api/docs/guides/custom-mcp-server
- https://vercel.com/docs/functions/runtimes/node-js

# ConnectLive starter project

A consent-based live audio/video website with two modes:
- Two-way call: both people may share camera and microphone.
- One-way viewing: the invited guest shares; the host receives the guest's stream.

## Run locally
1. Install Node.js 18 or newer.
2. In this folder, run `npm install`
3. Run `npm start`
4. Open `http://localhost:3000`

For real camera/microphone access on phones, use HTTPS when deployed. Localhost is also treated as a secure context on the same device.

## Deploy
Deploy this Node.js project to a host that supports a persistent Node server and WebSockets. Set the start command to `npm start`. The service must support HTTPS and WebSockets. Keep the server running during sessions.

## Important production notes
- This is a starter, not a finished production service. Room records are held in memory and disappear when the server restarts.
- The host authorization token is kept in the host page URL. Do not share the host page URL; share only the invitation link shown in the dashboard.
- The app uses a public STUN server. Some networks require a TURN relay server for reliable connectivity. Add a reputable TURN service before relying on this for real users.
- For production, add rate limiting, abuse reporting, stronger session expiry, and a privacy policy.
- Browser camera/microphone permissions are requested only after the invited guest checks consent and presses Join. Two-way mode requests host media only after the guest has joined.
- Never use this software to record, monitor, or stream someone without their informed consent.

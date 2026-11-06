# Stream

A browser-based screen-sharing site. Media travels peer-to-peer over WebRTC; Supabase Realtime is used only for room signaling and presence. No media is recorded or stored.

## Deploy with GitHub Pages

1. Create a new GitHub repository named `stream`.
2. Upload/push the contents of this project to its `main` branch, keeping the `.github/workflows/pages.yml` file.
3. In GitHub, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**.
4. The included workflow deploys the `public/` directory automatically on each push. The live URL appears under **Actions** or **Settings → Pages**.

The Supabase project is already configured in `public/app.js` with its public publishable key. That key is intended for browser use; never place a Supabase service-role key in frontend code.

## Use

- Open the deployed site and choose **Start a stream**.
- Pick a screen, window, or browser tab. Enable tab audio in the browser picker if you want viewers to hear it.
- Copy the invite link and send it to viewers.
- Keep the host browser tab open while streaming.

## Notes

- Screen capture requires HTTPS; GitHub Pages provides HTTPS.
- Supabase Realtime carries room signaling and presence, not the screen/audio itself.
- WebRTC uses public STUN servers. Some restrictive networks require a TURN relay; a large audience needs an SFU rather than one peer connection per viewer.
- Browser/OS support determines whether tab or system audio can be captured.
- Refreshing the host page ends that host session. Start a new stream for a new invite link.

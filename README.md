# Stream

A browser-based screen-sharing site. Media travels peer-to-peer over WebRTC; Supabase Realtime is used only for room signaling and presence. No media is recorded or stored.

## Deploy with GitHub Pages

The GitHub Actions workflow publishes the contents of `public/` to the `gh-pages` branch whenever `main` is updated.

One-time setup:
1. Open **Settings → Pages** in the repository.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch **gh-pages** and folder **/(root)**, then click **Save**.
4. GitHub Pages will publish the site at `https://ichigo137.github.io/stream/`.

## Supabase

The frontend uses the Supabase project URL and its public publishable key. Publishable keys are designed for browser use; never put a Supabase secret or service-role key in frontend code.

Realtime signaling uses a public, unguessable room topic and presence. Keep the project's Realtime **Allow public access** option enabled for this link-based/no-login experience. A viewer only needs the invite link; screen/audio media does not pass through Supabase.

## Use

- Open the deployed site and choose **Start a stream**.
- Pick a screen, window, or browser tab. Enable tab audio in the browser picker if you want viewers to hear it.
- Copy the invite link and send it to viewers.
- Keep the host browser tab open while streaming.

## Notes

- Screen capture requires HTTPS; GitHub Pages provides HTTPS.
- WebRTC uses public STUN servers. Some restrictive networks require a TURN relay; a large audience needs an SFU rather than one peer connection per viewer.
- Browser/OS support determines whether tab or system audio can be captured.
- Refreshing the host page ends the stream. Start a new stream for a new invite link.

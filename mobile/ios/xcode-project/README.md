# Streamulus for iPhone & iPad

A native iOS / iPadOS app (SwiftUI, Liquid Glass) for your Streamulus server. The web admin panel isn't
included — use Streamulus in a browser for that.

## What's in it

- **Connect** to your server by its home address (e.g. `192.168.1.20:8096`) or its public address
  (e.g. `https://streamulus.your-tailnet.ts.net`). After connecting at home once, the app learns the server's
  public address (Admin › Settings › Remote Access) and **switches to it by itself** when the home address
  doesn't answer — and back again when you're home.
- **Sign in** with a username and password, or **Quick Login**: the app shows a code; approve it from
  Streamulus in a browser or this app on another device.
- **Approve a sign-in** for an Apple TV, another phone or a browser: Profile & Settings → *Approve a Sign-In*,
  enter the code it shows.
- **Who's watching?** with Streamlings (kids profiles) and the PIN / password lock.
- **Home**: rotating featured banner (title logo, Play / More Info), Continue Watching with a frame from where
  you stopped, recently added movies and shows. Pull to refresh.
- **Movies** and **TV Shows**: A–Z grids with an index down the right edge (tap or drag), plus a filter box.
- **Genres** (incl. Anime) with an All / Movies / TV Shows switch, and a **Search** tab.
- **Movie / show pages**: Resume, Play from Beginning, Mark as Watched, "Ends at", cast, More Like This;
  season picker and episode list (long-press an episode to play from the beginning or mark it watched).
- **Player**: tap to show / hide the controls, double-tap left / right to skip 10 s, drag the progress bar
  (shows what's buffered), subtitles, **AirPlay**, **Picture in Picture** (also starts automatically when you
  leave the app), Up Next for episodes. Progress is saved as you watch.
- **Profile & Settings** (your picture, top-right): switch profile, Titles in English, server details,
  change server, sign out.
- **iPad**: every orientation, Split View / Stage Manager, larger layouts, and a tab bar that can turn into a
  sidebar.
- Follows **Admin › Settings › Branding** (logo and/or STREAMULUS text, custom logo).

## Requirements

- Xcode 26 or later on a Mac. The app targets **iOS / iPadOS 26.0+** (Liquid Glass).
- An Apple ID added in Xcode → Settings → Accounts (a free one works for your own devices).

## Run it on your iPhone or iPad

1. Open `mobile/ios/xcode-project/Streamulus-iOS.xcodeproj` in Xcode. Everything the app needs is inside this
   folder, so you can also copy the folder anywhere and open it from there.
2. Select the **Streamulus** target → **Signing & Capabilities** → choose your **Team**. If Xcode says the
   bundle ID is taken, change `com.streamulus.ios` to something unique, e.g. `com.yourname.streamulus`.
3. Connect the device (or pick a simulator), choose it as the run destination and press **Run** (⌘R).
   On a device, allow **Developer Mode** when asked (Settings → Privacy & Security).
4. In the app: enter your server address, then sign in or use Quick Login. iOS asks once for permission to
   find devices on your **local network** — allow it so the app can reach your server at home.

## Sharing it with friends (no VPN)

1. Give your server a public HTTPS address, e.g. with Tailscale Funnel: `tailscale funnel 8096`.
2. Put that address in **Admin › Settings › Remote Access** on the web.
3. Either friends type the public address when the app asks, or build it into the app: open
   `Streamulus/Info.plist` and set **StreamulusServerURL** to it (e.g. `https://streamulus.your-tailnet.ts.net`).
   With that set, the app connects straight away without asking.
4. Install it on their devices from Xcode, or distribute it through TestFlight with a paid Apple Developer
   account.

## Notes

- `Streamulus/Shared` holds code the Apple TV app also uses (API client, models, session and server switching,
  playback, image loading, branding). `tv/appletv/generate_project.rb` copies it into the Apple TV project —
  after changing it here, run that script to update the Apple TV copy.
- Plain `http://` to your server is allowed (`Info.plist` → App Transport Security), since home servers rarely
  have HTTPS.
- Your sign-in token is stored in the Keychain; the server addresses in app settings.
- The app icon (`Assets.xcassets/AppIcon`) has standard, dark and tinted versions, made from
  [`branding/`](../../../branding).
- `generate_project.rb` rebuilds `Streamulus-iOS.xcodeproj` from the files in `Streamulus/`. You only need it
  if files are added outside Xcode (`gem install xcodeproj && ruby generate_project.rb`).

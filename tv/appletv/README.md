# Streamulus for Apple TV

A native tvOS app (SwiftUI, Liquid Glass) for your Streamulus server. The web admin
panel isn't included — use Streamulus in a browser for that.

## What's in it

- **Connect** to your server by address (e.g. `192.168.1.20:8096`).
- **Sign in** with a username and password, or **Quick Login**: the TV shows a code and a QR
  code; approve it from Streamulus on your phone or computer (profile menu → *Quick Login*,
  or just scan the QR code) and the TV signs itself in.
- **Who's watching?** with round profile pictures, Streamlings (kids profiles), a remote-friendly
  PIN pad, and the account password when the parental lock asks for it.
- **Home**: a featured banner (artwork, title logo, Play Now / More Info), Continue Watching with a
  frame from where you stopped, recently added movies and shows.
- **Movies** and **TV Shows**: 7-across grids grouped A–Z, with an alphabet rail on the right and a
  big letter while you scroll.
- **Movie / show pages**: title logo, Resume, Play from Beginning, Mark as Watched, runtime and
  "Ends at", cast, and More Like This. Shows have a season picker and episode list.
- **Player**: custom controls (click = play/pause, left/right = 10 s, Back = close), progress bar
  with "Ends at", and an **Up Next** card near the end of episodes (Play Now / Hide). Progress
  saves every 10 seconds and when you leave; the next episode starts from the beginning.
- **Liquid Glass**: glass buttons, labels and panels; the system tab bar is glass too and shows
  your profile picture.

## Requirements

- Xcode 26 or later on a Mac (Xcode 27 for tvOS 27). The app targets **tvOS 26.0+**, which
  is where Liquid Glass is available.
- An Apple ID added in Xcode → Settings → Accounts (a free one works for running on your own TV).
- Your Streamulus server on the same network as the Apple TV.

## Run it on your Apple TV

1. Open `tv/appletv/Streamulus.xcodeproj` in Xcode.
2. Select the **Streamulus** target → **Signing & Capabilities** → choose your **Team**.
   If Xcode says the bundle ID is taken, change `com.streamulus.appletv` to something unique,
   e.g. `com.yourname.streamulus`.
3. Pair the Apple TV: on the TV open **Settings → Remotes and Devices → Remote App and Devices**.
   In Xcode open **Window → Devices and Simulators**, select the Apple TV and enter the code it
   shows. (Mac and TV on the same network.)
4. Pick the Apple TV as the run destination at the top of the Xcode window and press **Run** (⌘R).
5. On the TV: enter your server address, then sign in or use Quick Login.

You can also try it first in the **Apple TV simulator** (pick it as the run destination). Use
your Mac's LAN address for the server (e.g. `192.168.1.20:8096`), not `localhost`, if the
server runs in Docker.

## Notes

- Plain `http://` to your server is allowed (`Info.plist` → App Transport Security), since home
  servers rarely have HTTPS.
- Your sign-in token is stored in the Keychain; the server address in app settings.
- The app icon and Top Shelf images (`Assets.xcassets`) are the web logo on black, as layered
  images so the icon tilts when focused.
- `generate_project.rb` rebuilds the Xcode project from the files in `Streamulus/`. You only need
  it if files are added outside Xcode (`gem install xcodeproj && ruby generate_project.rb`).

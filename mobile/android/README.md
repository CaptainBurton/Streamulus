# Streamulus for Android

A native Android app (Kotlin, Jetpack Compose, Material 3) for your Streamulus server, for phones and tablets.
It targets **Android 16** (API 36) and runs on **Android 8.0 and newer**. The web admin panel isn't included —
use Streamulus in a browser for that.

## What's in it

The same as the iPhone & iPad app:

- **Connect** to your server by its home address (e.g. `192.168.0.114:8081`) or its public address
  (e.g. `https://streamulus.your-tailnet.ts.net`). After connecting at home once, the app learns the server's public
  address (Admin › Settings › Remote Access) and **switches to it by itself** when the home address doesn't
  answer — and back again when you're home.
- **Sign in** with a username and password, or **Quick Login**: the app shows a code and QR code; approve it from
  Streamulus in a browser or the app on another device.
- **Create Account**: a display name and password. Your admin then makes you a single-use **Admin Passphrase**
  (Admin › Users › Account Requests — usually within 5–10 minutes); enter it at your first sign-in. It works for
  1 hour.
- **Who's watching?** with Streamlings (kids profiles) in their own section, and the PIN / password lock.
- **Home**: rotating featured banner (title logo, Play / More Info), Continue Watching with a frame from where you
  stopped, recently added movies and shows. Pull to refresh. The logo stays put at the top.
- **Movies** and **TV Shows**: A–Z grids with an index down the right edge (tap or drag), plus a filter box.
- **Genres** (incl. Anime) with an All / Movies / TV Shows switch, and a **Search** tab.
- **Movie / show pages**: Resume, Play from Beginning, Mark as Watched, "Ends at", cast, More Like This; season
  chips and episode list (long-press an episode to play from the beginning or mark it watched).
- **Player**: tap to show / hide the controls, double-tap left / right to skip 10 s, drag the progress bar (shows
  what's buffered), subtitles, an **Audio** menu for files with several audio tracks (e.g. Japanese / English), **Google Cast** (Chromecast / Google TV — the Android counterpart of AirPlay),
  **Picture in Picture** (also starts automatically when you leave the app while a video plays), Up Next for
  episodes, play / pause from headphones. Progress is saved as you watch.
- **Profile & Settings** (your picture, top-right): **choose a picture** from the ones your admin provides
  (Streamlings too), switch profile, Titles in English, Audio Language, English Subtitles for Other Languages, **Approve a Sign-In** (scan the QR code another device
  shows, or type its code), **Feedback** (send feedback or app suggestions and read the admin's replies), server
  details, change server, sign out.
- **Tablets and foldables**: a navigation rail instead of the bottom bar, larger layouts, any orientation.
- Follows **Admin › Settings › Branding** (logo and/or STREAMULUS text, custom logo).

## Requirements

- **Android Studio** (a 2025 release or newer) on Windows, macOS or Linux. It brings its own Java.
- A phone or tablet with Android 8.0+ (or an emulator). **Google Play services** are needed for Cast and for the
  QR scanner; without them you can still type sign-in codes.

## Run it on your phone

1. In Android Studio choose **File › Open** and pick the `mobile/android` folder. Let it **sync** — the first time
   it downloads Gradle and the libraries, which takes a few minutes. If it offers to update the Android Gradle
   Plugin or libraries, accepting is fine.
2. On the phone, turn on **Developer options** (Settings › About phone › tap *Build number* 7 times), then
   **USB debugging** (or *Wireless debugging*).
3. Connect the phone, pick it in the device list at the top, and press **Run** (▶).
4. In the app: enter your server address (e.g. `192.168.0.114:8081` at home), then sign in or use Quick Login.

## Sharing it with friends

1. Make sure your server has a public address (Admin › Settings › Remote Access, e.g. your Tailscale Funnel URL).
2. Optionally build that address into the app so it connects straight away: open
   `app/src/main/res/values/config.xml` and set **streamulus_server_url**, e.g.
   `https://streamulus.your-tailnet.ts.net`.
3. Get an APK. Every change to `mobile/android` builds one on GitHub (**Actions › Android APK**, or start it there
   with **Run workflow**); it's under **Artifacts** at the bottom of the run's page (open it in a browser — the
   GitHub app doesn't show artifacts). The APK is never committed to the repo.
   To put it in a **GitHub release** instead (e.g. next to the iPhone build), run the workflow with a tag such as
   `v1.4` in its *release* box: the APK is added to a draft release with that tag, ready for the other files and
   **Publish release**.
4. Send them the APK. On their phone they open it and allow **Install unknown apps** for the app they opened it
   with (Files, Chrome, …).

### Updates install over the old version

Android only installs a new APK over an old one when both are signed with **the same key** and the new one has a
**higher version code**. The GitHub build numbers each APK (1.0.*run number*) and signs it with your release key,
taken from two repository secrets (**Settings › Secrets and variables › Actions › New repository secret**):

- `ANDROID_KEYSTORE_BASE64` — the key file (`.jks`), base64-encoded
- `ANDROID_KEYSTORE_PASSWORD` — its password

Without them the build still works but uses a throwaway key, so each APK has to be uninstalled before the next.
To build signed APKs in Android Studio too, put the `.jks` file and `keystore.properties` (storeFile, storePassword,
keyAlias, keyPassword) in `mobile/android/` — both are git-ignored. **Keep a backup of the key**: without it, an
update can't be installed over the old app.

## Notes

- Your sign-in token is encrypted with a key kept in the Android Keystore; server addresses are in the app's
  private settings. Backups of the app's data are turned off.
- Plain `http://` to your server is allowed (`res/xml/network_security_config.xml`), since home servers rarely
  have HTTPS.
- Cast uses Google's Default Media Receiver, which plays the server's HLS streams; the Cast device has to be able
  to reach the server's address (at home, the home address works).
- The launcher icon (with a themed version for Android 13+) and the in-app logo are made from
  [`branding/`](../../branding).

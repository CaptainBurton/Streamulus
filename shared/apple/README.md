# Shared Apple code

`StreamulusCore/` is the master copy of the Swift code used by both the Apple TV app (`tv/appletv`) and the
iPhone & iPad app (`mobile/ios/xcode-project`): API client, models, session (sign-in, profiles, home / public
address switching), playback controller, player parts, image loading and branding.

Each app keeps a copy in its own `Streamulus/Shared` folder so its Xcode project builds on its own. After
changing a file here, refresh both copies:

```sh
cd tv/appletv && ruby generate_project.rb
cd ../../mobile/ios/xcode-project && ruby generate_project.rb
```

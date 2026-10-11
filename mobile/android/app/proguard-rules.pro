# Release builds aren't minified (see app/build.gradle.kts). If you turn minify on,
# keep the Cast options provider, which is only named in the manifest:
-keep class com.streamulus.android.player.CastOptionsProvider { *; }
